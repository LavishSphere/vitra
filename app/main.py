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
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

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
from .trends import ALL, compute_trends

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


def _ids(raw: str | None) -> set[str]:
    return {v.strip() for v in (raw or "").split(",") if v.strip()}


def _week(raw: str | None, name: str) -> str | None:
    if raw and not WEEK_RE.match(raw):
        raise HTTPException(400, f"{name} must look like 2025-W23")
    return raw or None


def _listening_sockets() -> tuple[bool | None, str]:
    """Ask lsof which TCP addresses this process is listening on."""
    lsof = shutil.which("lsof")
    if not lsof:
        return None, "lsof not available; not checked"
    try:
        out = subprocess.run(
            [lsof, "-nP", "-a", "-p", str(os.getpid()), "-iTCP", "-sTCP:LISTEN", "-Fn"],
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"lsof failed ({type(exc).__name__}); not checked"
    addrs = sorted({line[1:] for line in out.splitlines() if line.startswith("n")})
    if not addrs:
        return (
            None,
            "no listening TCP socket found for this process (e.g. running under a test client)",
        )
    ok = all(is_loopback_ip(a.rsplit(":", 1)[0]) for a in addrs)
    return ok, "listening on " + ", ".join(addrs)


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

    def _trends(
        excluded: set[str], product: str | None, aspect: str | None, speaker: str | None
    ) -> list[TrendCell]:
        return compute_trends(
            store.raw(),
            excluded,
            products=_csv(product, PRODUCTS, "product"),
            aspects=_csv(aspect, (*ASPECTS, ALL), "aspect"),
            speakers=_csv(speaker, (*SPEAKERS, ALL), "speaker"),
        )

    def _insights(excluded: set[str], product: str | None) -> list[InsightCard]:
        return build_insights(store.raw(), excluded, products=_csv(product, PRODUCTS, "product"))

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
        max_items: int = Query(1, ge=0, le=100),
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

    @api.post("/reset")
    def reset() -> dict[str, int]:
        """Drop every transcript result held in memory (the UI's "Reset to source data")."""
        return {"transcripts_cleared": store.reset_transcripts()}

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
    return app


def _privacy_checks(
    app: FastAPI, request: Request, settings: Settings, store: EvidenceStore
) -> list[PrivacyCheck]:
    require_token: Callable[..., None] = app.state.require_token
    unguarded = [
        r.path
        for r in app.routes
        if isinstance(r, APIRoute)
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
            name="transcripts_memory_only",
            ok=None,
            kind="by_design",
            detail=f"{store.n_transcripts} transcript result(s) held in process memory, cleared on "
            "POST /api/reset and at exit; logs record only length and a sha256 prefix "
            "(tested in app/tests/test_intake.py; not checkable at runtime)",
        ),
        PrivacyCheck(
            name="no_outbound_calls",
            ok=None,
            kind="by_design",
            detail="the API only calls the loopback model URL; confirm with the socket audit in "
            "`scripts/run_offline.sh --check` (not checkable from inside the process)",
        ),
    ]
