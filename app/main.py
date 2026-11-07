"""Vitra local API (contract section 8). Serve with `python -m app`.

Every derived view (trends, insights, gaps, what-if) is recomputed from the
evidence list by the same pure functions, with `excluded` ids removed. Nothing
patches an aggregate in place.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request
from fastapi.routing import APIRoute

from . import security
from .config import Settings, is_loopback_ip, is_loopback_url
from .data import EvidenceStore
from .gaps import compute_gaps
from .insights import build_insights
from .intake import PipelineLoader, llm_server_status, load_pipeline, run_intake
from .models import (
    ASPECTS,
    PRODUCTS,
    SPEAKERS,
    EvidenceGap,
    EvidenceItem,
    HealthResponse,
    InsightCard,
    IntakeRequest,
    IntakeResult,
    PrivacyCheck,
    PrivacyStatus,
    TrendCell,
    WhatIfRequest,
    WhatIfResponse,
)
from .static import CSP, install_static, web_available
from .trends import ALL, compute_trends

T = TypeVar("T")
LIST_TEXT_CHARS = 400
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
SOURCES = (
    "pubmed",
    "ctgov",
    "fda_event",
    "fda_label",
    "fda_notice",
    "press_release",
    "news",
    "transcript",
)
SIGNALS = (
    "efficacy",
    "safety",
    "regulatory",
    "trial_update",
    "competitor_move",
    "access_pricing",
    "guideline",
    "expert_opinion",
    "none",
)


def _csv(raw: str | None, allowed: tuple[str, ...], name: str) -> set[str] | None:
    """Parse a comma-separated filter; None/empty means no filter. Unknown values are a 400."""
    if raw is None or not raw.strip():
        return None
    vals = {v.strip() for v in raw.split(",") if v.strip()}
    bad = sorted(vals - set(allowed))
    if bad:
        raise HTTPException(
            400, f"unknown {name} value(s): {', '.join(bad)}; allowed: {', '.join(allowed)}"
        )
    return vals


def _key(values: set[str] | None) -> tuple[str, ...] | None:
    return None if values is None else tuple(sorted(values))


class ResultCache:
    """Small LRU for derived results. Keys include the store version, so any change
    to the evidence (a held transcript, a reset) makes old entries unreachable."""

    def __init__(self, maxsize: int) -> None:
        self._data: OrderedDict[tuple[Any, ...], Any] = OrderedDict()
        self._max = maxsize
        self._lock = threading.Lock()

    def get_or_compute(self, key: tuple[Any, ...], compute: Callable[[], T]) -> T:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
                return self._data[key]
        value = compute()
        with self._lock:
            self._data[key] = value
            while len(self._data) > self._max:
                self._data.popitem(last=False)
        return value

    def clear(self) -> None:
        """Drop every entry. Old-version entries are unreachable anyway; this also
        frees results derived from a transcript that is no longer held."""
        with self._lock:
            self._data.clear()


def _ids(raw: str | None) -> set[str]:
    return {v.strip() for v in (raw or "").split(",") if v.strip()}


def _week(raw: str | None, name: str) -> str | None:
    if raw and not WEEK_RE.match(raw):
        raise HTTPException(400, f"{name} must look like 2025-W23")
    return raw or None


def _lsof_listen_addrs() -> list[str] | None:
    """TCP addresses this process listens on, per lsof (None if lsof is missing or fails)."""
    lsof = shutil.which("lsof")
    if not lsof:
        return None
    try:
        out = subprocess.run(
            [lsof, "-nP", "-a", "-p", str(os.getpid()), "-iTCP", "-sTCP:LISTEN", "-Fn"],
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    return sorted({line[1:] for line in out.splitlines() if line.startswith("n")})


def _psutil_listen_addrs() -> list[str] | None:
    """The same list from psutil, for systems without lsof (Windows, minimal Linux)."""
    try:
        import psutil
    except ImportError:
        return None
    try:
        conns = psutil.Process().net_connections(kind="tcp")
    except (psutil.Error, OSError):
        return None
    addrs = set()
    for c in conns:
        if c.status == psutil.CONN_LISTEN and c.laddr:
            ip, port = c.laddr[0], c.laddr[1]
            addrs.add(f"[{ip}]:{port}" if ":" in ip else f"{ip}:{port}")
    return sorted(addrs)


def _listening_sockets() -> tuple[bool | None, str]:
    """Which TCP addresses this process listens on: lsof if present, else psutil."""
    addrs, tool = _lsof_listen_addrs(), "lsof"
    if addrs is None:
        addrs, tool = _psutil_listen_addrs(), "psutil"
    if addrs is None:
        return None, "neither lsof nor psutil could list this process's sockets; not checked"
    if not addrs:
        return (
            None,
            "no listening TCP socket found for this process (e.g. running under a test client)",
        )
    ok = all(is_loopback_ip(a.rsplit(":", 1)[0]) for a in addrs)
    return ok, f"listening on {', '.join(addrs)} ({tool})"


def create_app(
    settings: Settings | None = None,
    store: EvidenceStore | None = None,
    pipeline_loader: PipelineLoader = load_pipeline,
) -> FastAPI:
    settings = settings or Settings.from_env()  # Settings refuses non-loopback bind hosts
    store = store or EvidenceStore(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        store.load()
        store.annotated()
        yield
        store.reset_transcripts()  # private transcripts never outlive the process

    app = FastAPI(
        title="Vitra local API",
        version="1",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.store = store
    security.install(app, settings)
    require_token = security.make_token_dependency(settings)
    app.state.require_token = require_token

    open_api = APIRouter(prefix="/api")
    api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])

    @open_api.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        up, served = llm_server_status(settings)
        return HealthResponse(
            status="ok",
            model_loaded=up,
            model=Path(settings.model_path).name if settings.model_path else served,
            prompt_version=settings.prompt_version,
            n_items=len(store.raw()),
        )

    @api.get("/evidence", response_model=list[EvidenceItem])
    def evidence(
        product: str | None = None,
        aspect: str | None = None,
        speaker: str | None = None,
        source: str | None = None,
        signal_type: str | None = None,
        week_from: str | None = None,
        week_to: str | None = None,
        actionable: str | None = None,
    ) -> list[EvidenceItem]:
        products = _csv(product, PRODUCTS, "product")
        aspects = _csv(aspect, ASPECTS, "aspect")
        speakers = _csv(speaker, SPEAKERS, "speaker")
        sources = _csv(source, SOURCES, "source")
        signals = _csv(signal_type, SIGNALS, "signal_type")
        acts = _csv(actionable, ("yes", "no"), "actionable")
        wf, wt = _week(week_from, "week_from"), _week(week_to, "week_to")
        out = []
        for e in store.annotated():
            if products and e.product not in products:
                continue
            if aspects and not any(a.aspect in aspects for a in e.aspects):
                continue
            if speakers and not any(a.speaker in speakers for a in e.aspects):
                continue
            if (sources and e.source not in sources) or (signals and e.signal_type not in signals):
                continue
            if (
                (acts and e.actionable not in acts)
                or (wf and e.iso_week < wf)
                or (wt and e.iso_week > wt)
            ):
                continue
            out.append(
                e.model_copy(update={"text": e.text[:LIST_TEXT_CHARS]})
                if len(e.text) > LIST_TEXT_CHARS
                else e
            )
        return out

    @api.get("/evidence/{item_id}", response_model=EvidenceItem)
    def evidence_one(item_id: str) -> EvidenceItem:
        e = store.get(item_id)
        if e is None:
            raise HTTPException(404, "no such item")
        return e

    cache = ResultCache(maxsize=64)

    def _trends(
        excluded: set[str], product: str | None, aspect: str | None, speaker: str | None
    ) -> list[TrendCell]:
        products = _csv(product, PRODUCTS, "product")
        aspects = _csv(aspect, (*ASPECTS, ALL), "aspect")
        speakers = _csv(speaker, (*SPEAKERS, ALL), "speaker")
        key = (
            "trends",
            store.version,
            frozenset(excluded),
            _key(products),
            _key(aspects),
            _key(speakers),
        )
        return cache.get_or_compute(
            key,
            lambda: compute_trends(
                store.raw(), excluded, products=products, aspects=aspects, speakers=speakers
            ),
        )

    def _insights(excluded: set[str], product: str | None) -> list[InsightCard]:
        products = _csv(product, PRODUCTS, "product")
        key = ("insights", store.version, frozenset(excluded), _key(products))
        return cache.get_or_compute(
            key, lambda: build_insights(store.raw(), excluded, products=products)
        )

    @api.get("/trends", response_model=list[TrendCell])
    def trends(
        product: str | None = None,
        aspect: str | None = None,
        speaker: str | None = None,
        excluded: str | None = None,
    ) -> list[TrendCell]:
        return _trends(_ids(excluded), product, aspect, speaker)

    @api.get("/insights", response_model=list[InsightCard])
    def insights(product: str | None = None, excluded: str | None = None) -> list[InsightCard]:
        return _insights(_ids(excluded), product)

    @api.get("/gaps", response_model=list[EvidenceGap])
    def gaps(
        window_weeks: int = Query(8, ge=1, le=104),
        max_items: int = Query(0, ge=0, le=100),
        excluded: str | None = None,
    ) -> list[EvidenceGap]:
        return compute_gaps(
            store.raw(), _ids(excluded), window_weeks=window_weeks, max_items=max_items
        )

    @api.post("/whatif", response_model=WhatIfResponse)
    def whatif(body: WhatIfRequest) -> WhatIfResponse:
        ex = set(body.excluded_ids)
        return WhatIfResponse(
            trends=_trends(ex, body.product, body.aspect, body.speaker),
            insights=_insights(ex, body.product),
        )

    @api.post("/intake", response_model=IntakeResult)
    def intake(body: IntakeRequest) -> IntakeResult:
        return run_intake(body, store, settings, loader=pipeline_loader)

    @api.delete("/intake/{item_id}")
    def intake_undo(item_id: str) -> dict[str, bool | str]:
        """Undo one pasted transcript: drop it from memory and report whether the
        unfiltered trends moved. Every view is recomputed from the remaining evidence,
        so the result equals the state before that transcript was added."""
        before = _trends(set(), None, None, None)
        if not store.remove_transcript(item_id):
            raise HTTPException(404, "no held transcript with that id")
        cache.clear()
        after = _trends(set(), None, None, None)
        return {"ok": True, "removed": item_id, "trends_changed": before != after}

    @api.post("/reset")
    def reset() -> dict[str, bool | int]:
        """Back to source data: drop every held transcript result.

        Exclusions are never stored server side (each request passes its own), so
        clearing them is the client's half of the reset.
        """
        n = store.reset_transcripts()
        cache.clear()
        return {"ok": True, "transcripts_cleared": n}

    @api.get("/privacy/status", response_model=PrivacyStatus)
    def privacy_status(request: Request) -> PrivacyStatus:
        return PrivacyStatus(
            bind_host=settings.bind_host,
            llm_url=settings.llm_url,
            outbound_allowed=False,
            transcripts_persisted=False,
            checks=_privacy_checks(app, request, settings, store),
        )

    app.include_router(open_api)
    app.include_router(api)
    install_static(app, settings.web_dist)  # last: the catch-all must not shadow /api
    return app


def _privacy_checks(
    app: FastAPI, request: Request, settings: Settings, store: EvidenceStore
) -> list[PrivacyCheck]:
    require_token: Callable[..., None] = app.state.require_token
    unguarded = [
        r.path
        for r in app.routes
        if isinstance(r, APIRoute)
        and r.path.startswith("/api/")
        and r.path not in security.OPEN_PATHS
        and not any(d.dependency is require_token for d in r.dependant.dependencies)
    ]
    server = (request.scope.get("server") or ("?", 0))[0]
    sockets_ok, sockets_detail = _listening_sockets()
    bad_origins = [o for o in settings.allowed_origins if not is_loopback_url(o)]
    return [
        PrivacyCheck(
            name="bind_host_is_loopback",
            ok=is_loopback_ip(settings.bind_host),
            kind="runtime_check",
            detail=f"configured bind host {settings.bind_host}; "
            "non-loopback hosts are refused at startup",
        ),
        PrivacyCheck(
            name="listening_sockets_loopback",
            ok=sockets_ok,
            kind="runtime_check",
            detail=sockets_detail,
        ),
        PrivacyCheck(
            name="this_request_on_loopback",
            ok=is_loopback_ip(str(server)) if server else None,
            kind="runtime_check",
            detail=f"request arrived on local address {server}",
        ),
        PrivacyCheck(
            name="llm_url_is_loopback",
            ok=settings.llm_url_is_loopback,
            kind="runtime_check",
            detail=f"model server URL {settings.llm_url}",
        ),
        PrivacyCheck(
            name="cors_local_origins_only",
            ok=not bad_origins,
            kind="runtime_check",
            detail="allowed origins: " + ", ".join(settings.allowed_origins),
        ),
        PrivacyCheck(
            name="token_required",
            ok=not unguarded,
            kind="runtime_check",
            detail="every route except /api/health requires X-Vitra-Token"
            if not unguarded
            else "routes without the token check: " + ", ".join(unguarded),
        ),
        PrivacyCheck(
            name="web_app_same_origin_csp",
            ok=web_available(settings.web_dist) or None,
            kind="runtime_check",
            detail=f"web app served from this origin with Content-Security-Policy: {CSP}"
            if web_available(settings.web_dist)
            else "web/dist not built; the API is serving no web app",
        ),
        PrivacyCheck(
            name="transcripts_memory_only",
            ok=None,
            kind="by_design",
            detail=f"{store.n_transcripts} transcript result(s) held in process memory, cleared on "
            "POST /api/reset, one at a time on DELETE /api/intake/{id}, and at exit; "
            "logs record only length and a sha256 prefix "
            "(tested in app/tests/test_intake.py; not checkable at runtime)",
        ),
        PrivacyCheck(
            name="no_outbound_calls",
            ok=None,
            kind="by_design",
            detail="the API only calls the loopback model URL; confirm with the socket audit in "
            "`python -m app.launch --check` (scripts/run_offline.sh or .ps1; "
            "not checkable from inside the process)",
        ),
    ]
