"""Transcript intake (contract section 7).

Stages, each timed with a monotonic clock:
  received_locally  -> validate the body, build a pseudo-item (source "transcript")
  classifying       -> pipeline.api.classify_item (imported lazily)
  validating_quotes -> exact-substring check of every span; failures are rejected
  incorporating     -> hold the EvidenceItem in memory and recompute confidence

Outcomes:
- complete:  at least one aspect span verified; the item joins trends and cards
             while this process holds it.
- abstained: the pipeline ran but produced no verifiable quote. Nothing is held.
- error:     the body was invalid, the model URL is not loopback, the pipeline
             could not be imported, the pipeline raised, or the model call
             failed (`_meta.error`). A rules
             fallback is never presented as a model result.

Privacy: the transcript text lives only in this request and, on success, in
the in-memory store. Logs get its length and a sha256 prefix, nothing else.
Exception messages are not logged either, only their type.
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
import time
from collections.abc import Callable
from datetime import date
from types import ModuleType
from typing import Any

import httpx

from .config import REPO_ROOT, Settings
from .data import EvidenceStore
from .evidence import build_item, verify_aspects
from .models import IntakeRequest, IntakeResult, IntakeStage, RejectedSpan

log = logging.getLogger("vitra.intake")

PipelineLoader = Callable[[], ModuleType]
DEFAULT_TITLE = "Private transcript"
DEFAULT_PRODUCT = "both"


def load_pipeline() -> ModuleType:
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    return importlib.import_module("pipeline.api")


class _Clock:
    def __init__(self) -> None:
        self.stages: list[IntakeStage] = []
        self._t = time.perf_counter()

    def lap(self, name: str) -> None:
        now = time.perf_counter()
        self.stages.append(IntakeStage(name=name, ms=round((now - self._t) * 1000)))  # type: ignore[arg-type]
        self._t = now


def _error(clock: _Clock, reason: str, fingerprint: str) -> IntakeResult:
    log.info("intake %s -> error", fingerprint)
    return IntakeResult(
        status="error", stages=clock.stages, evidence=None, rejected_spans=[], error=reason
    )


def run_intake(
    req: IntakeRequest,
    store: EvidenceStore,
    settings: Settings,
    *,
    loader: PipelineLoader = load_pipeline,
) -> IntakeResult:
    from .security import body_fingerprint

    clock = _Clock()
    text = req.text
    fp = body_fingerprint(text)
    log.info("intake received %s", fp)

    if not text.strip():
        clock.lap("received_locally")
        return _error(clock, "transcript text is empty", fp)
    if len(text) > settings.max_transcript_chars:
        clock.lap("received_locally")
        return _error(
            clock, f"transcript is longer than {settings.max_transcript_chars} characters", fp
        )
    item: dict[str, Any] = {
        "item_id": store.next_transcript_id(),
        "source": "transcript",
        "source_id": None,
        "url": "",
        "published": date.today().isoformat(),
        "product": req.product or DEFAULT_PRODUCT,
        "title": (req.title or "").strip() or DEFAULT_TITLE,
        "text": text,
    }
    clock.lap("received_locally")

    if not settings.llm_url_is_loopback:
        clock.lap("classifying")
        return _error(
            clock,
            f"refusing to send a transcript to a non-loopback model URL ({settings.llm_url})",
            fp,
        )
    try:
        api = loader()
        classify = api.classify_item
    except Exception as exc:
        clock.lap("classifying")
        return _error(
            clock, f"pipeline unavailable ({type(exc).__name__}); nothing was classified", fp
        )
    try:
        pred = classify(item, use_model=True)
    except Exception as exc:
        clock.lap("classifying")
        return _error(clock, f"pipeline raised {type(exc).__name__}; no result was produced", fp)
    clock.lap("classifying")

    meta = pred.get("_meta") if isinstance(pred.get("_meta"), dict) else {}
    if meta.get("error"):
        return _error(clock, f"model step failed: {str(meta['error'])[:300]}", fp)
    if meta.get("method") == "rule":
        # The model was not consulted, so this is not a model reading of the transcript.
        return _error(
            clock,
            "the pipeline returned a rules-only result for this transcript; "
            "no model output to show",
            fp,
        )

    rejected = [
        RejectedSpan(
            aspect=str(d.get("aspect", "")),
            span=str(d.get("span", "")),
            reason=str(d.get("reason", "")),
        )
        for d in meta.get("dropped_spans") or []
        if isinstance(d, dict)
    ]
    try:
        _, dropped_here = verify_aspects(pred, text)
        method = meta.get("method") if meta.get("method") in ("model", "mixed") else "model"
        ev = build_item(item, pred, origin="private_transcript", method=method)
    except Exception as exc:
        clock.lap("validating_quotes")
        return _error(
            clock, f"pipeline output did not match the prediction format ({type(exc).__name__})", fp
        )
    rejected += [RejectedSpan(**d) for d in dropped_here]
    clock.lap("validating_quotes")

    if not ev.aspects:
        log.info("intake %s -> abstained (%d rejected)", fp, len(rejected))
        reason = (
            "no aspect span could be verified in the transcript"
            if rejected
            else "the model found no aspect of either product judged in the transcript"
        )
        return IntakeResult(
            status="abstained",
            stages=clock.stages,
            evidence=None,
            rejected_spans=rejected,
            error=None,
            reason=reason,
        )

    store.add_transcript(ev)
    held = store.get(ev.item_id)  # re-annotates the full set, so corroboration includes this item
    clock.lap("incorporating")
    log.info("intake %s -> complete (%d verified, %d rejected)", fp, len(ev.aspects), len(rejected))
    return IntakeResult(
        status="complete", stages=clock.stages, evidence=held, rejected_spans=rejected, error=None
    )


# ---- model server probe (for /api/health) ---------------------------------

_probe_cache: dict[str, tuple[float, bool, str | None]] = {}
PROBE_TTL_S = 5.0


def llm_server_status(settings: Settings) -> tuple[bool, str | None]:
    """(server healthy, served model id). Only ever contacts a loopback URL.

    GET <llm_url>/health, then GET <llm_url>/v1/models with VITRA_LLM_KEY as the
    bearer token when set. Cached for PROBE_TTL_S seconds.
    """
    if not settings.llm_url_is_loopback:
        return False, None
    hit = _probe_cache.get(settings.llm_url)
    now = time.monotonic()
    if hit and now - hit[0] < PROBE_TTL_S:
        return hit[1], hit[2]
    base = settings.llm_url.rstrip("/")
    ok, model = False, None
    try:
        ok = httpx.get(base + "/health", timeout=0.5).status_code == 200
        if ok:
            key = os.environ.get("VITRA_LLM_KEY")
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            r = httpx.get(base + "/v1/models", headers=headers, timeout=0.5)
            if r.status_code == 200:
                data = r.json().get("data") or []
                model = str(data[0].get("id")) if data else None
    except (httpx.HTTPError, ValueError, AttributeError):
        pass
    _probe_cache[settings.llm_url] = (now, ok, model)
    return ok, model
