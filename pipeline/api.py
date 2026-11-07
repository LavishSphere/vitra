"""Public interface used by the app (contracts/CONTRACT.md section 2).

classify_item(item, *, use_model=True) -> Prediction + "_meta"
locate_span(span, text) -> (start, end) | None
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from . import rules
from .schema import (
    ACTIONABLE,
    ASPECTS,
    POLARITIES,
    SIGNAL_TYPES,
    SPEAKERS,
    aspect,
    empty_prediction,
    prediction_errors,
)
from .spans import (
    locate_span,
    locate_span_detail,
    shift_later_clause,
    shorten_span,
    trim_numeric_tail,
)

__all__ = ["classify_item", "locate_span", "merge_model_output", "MergePolicy", "POLICIES"]

# A model call takes (item, fewshot_pool) and returns the raw parsed JSON dict plus info.
ModelFn = Callable[
    [dict[str, Any], Sequence[dict[str, Any]] | None], tuple[dict[str, Any], dict[str, Any]]
]


def _coerce_polarity(v: Any) -> int | None:
    try:
        p = int(v)
    except (TypeError, ValueError):
        return None
    return max(min(p, 2), -2) if p in range(-5, 6) else None


_ALL_MODEL = frozenset(rules.MODEL_SOURCES)


@dataclass(frozen=True)
class MergePolicy:
    """Which fields the model may set, per source. Everything else comes from the rules."""

    name: str
    signal_sources: frozenset[str] = _ALL_MODEL
    actionable_sources: frozenset[str] = _ALL_MODEL
    aspect_sources: frozenset[str] = _ALL_MODEL
    aspects: frozenset[str] = frozenset(ASPECTS)
    span_methods: frozenset[str] = frozenset({"exact", "case", "normalized", "fuzzy"})
    max_span_words: int = 40
    trim_numeric: bool = True
    shorten_words: int = 0  # 0 = off; else cut spans longer than this at a clause boundary
    anchors: bool = True  # guide polarity anchors + lab-study and placeholder checks
    extra: dict[str, Any] = field(default_factory=dict, compare=False)


_TEXT_SOURCES = frozenset({"news", "press_release", "transcript"})

POLICIES: dict[str, MergePolicy] = {
    # default: rules for signal everywhere and actionable on pubmed; the model sets actionable
    # for news/press/transcripts and the efficacy + safety aspects (guide anchors applied).
    "hybrid": MergePolicy(
        "hybrid",
        signal_sources=frozenset(),
        actionable_sources=_TEXT_SOURCES,
        aspects=frozenset({"efficacy", "safety"}),
        shorten_words=12,
    ),
    "full": MergePolicy("full"),
    "full-notrim": MergePolicy("full-notrim", trim_numeric=False),
    "aspects-only-notrim": MergePolicy(
        "aspects-only-notrim",
        signal_sources=frozenset(),
        actionable_sources=frozenset(),
        trim_numeric=False,
    ),
    "aspects-only-short": MergePolicy(
        "aspects-only-short",
        signal_sources=frozenset(),
        actionable_sources=frozenset(),
        shorten_words=12,
    ),
    "aspects-only": MergePolicy(
        "aspects-only", signal_sources=frozenset(), actionable_sources=frozenset()
    ),
    "aspects-only-exact": MergePolicy(
        "aspects-only-exact",
        signal_sources=frozenset(),
        actionable_sources=frozenset(),
        span_methods=frozenset({"exact", "case", "normalized"}),
        max_span_words=20,
    ),
}
DEFAULT_POLICY = "hybrid"


def get_policy(name: str | None = None) -> MergePolicy:
    return POLICIES[name or os.environ.get("VITRA_MERGE_POLICY") or DEFAULT_POLICY]


def merge_model_output(
    item: dict[str, Any],
    rule: rules.RuleResult,
    raw: dict[str, Any],
    policy: MergePolicy | None = None,
) -> tuple[dict[str, Any], list[dict[str, str]], bool]:
    """Combine model JSON with the rules. Rules win where the guide is explicit.

    Returns (prediction, dropped_spans, rules_overrode_something).
    """
    policy = policy or get_policy()
    source = item.get("source") or ""
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    dropped: list[dict[str, str]] = []
    overrode = False
    sig = raw.get("signal_type")
    use_sig = source in policy.signal_sources and sig in SIGNAL_TYPES
    pred["signal_type"] = sig if use_sig else rule.prediction["signal_type"]
    act = raw.get("actionable")
    use_act = source in policy.actionable_sources and act in ACTIONABLE
    pred["actionable"] = act if use_act else rule.prediction["actionable"]
    if source not in policy.aspect_sources:
        for a in ASPECTS:
            pred[a] = rule.prediction.get(a)
    for k, v in rule.hard.items():
        if pred.get(k) != v:
            overrode = True
        pred[k] = v
    fixed_speaker = (
        None if item.get("source") in rules.FREE_SPEAKER_SOURCES else rules.speaker_for(item)
    )
    default_speaker = rules.speaker_for(item)
    for a in ASPECTS:
        v = raw.get(a)
        if not isinstance(v, dict) or source not in policy.aspect_sources:
            continue
        if a not in policy.aspects:
            dropped.append(
                {
                    "aspect": a,
                    "span": str(v.get("span")),
                    "reason": f"aspect off in policy {policy.name}",
                }
            )
            continue
        pol = _coerce_polarity(v.get("polarity"))
        span = v.get("span")
        if pol is None or pol not in POLARITIES:
            dropped.append({"aspect": a, "span": str(span), "reason": "bad polarity"})
            continue
        hit = locate_span_detail(span, text) if isinstance(span, str) else None
        if hit is None:
            dropped.append(
                {"aspect": a, "span": str(span), "reason": "span not verifiable in text"}
            )
            continue
        s0, e0 = trim_numeric_tail(text, hit[0], hit[1]) if policy.trim_numeric else hit[:2]
        if policy.shorten_words:
            s0, e0 = shorten_span(text, s0, e0, policy.shorten_words)
        s0, e0 = shift_later_clause(text, hit[0], hit[1], s0, e0)
        snapped = text[s0:e0]
        if hit[2] not in policy.span_methods or len(snapped.split()) > policy.max_span_words:
            dropped.append(
                {"aspect": a, "span": str(span), "reason": f"span rejected by policy {policy.name}"}
            )
            continue
        if policy.anchors:
            checked, why = rules.check_aspect(item, rule, a, pol, snapped)
            if checked is None:
                dropped.append({"aspect": a, "span": snapped, "reason": why})
                continue
            pol = checked
        speaker = fixed_speaker or (
            v.get("speaker") if v.get("speaker") in SPEAKERS else default_speaker
        )
        if source == "news" and speaker != "media" and not rules.is_attributed(text, s0, e0):
            speaker = "media"  # guide: the writer's own framing is media
            overrode = True
        if fixed_speaker and v.get("speaker") not in (None, fixed_speaker):
            overrode = True
        pred[a] = aspect(pol, speaker, snapped)
    return pred, dropped, overrode


def _final_check(pred: dict[str, Any], text: str, dropped: list[dict[str, str]]) -> dict[str, Any]:
    """Last line of defence: drop any aspect whose span is not an exact substring."""
    for a in ASPECTS:
        v = pred.get(a)
        if v is not None and (
            not isinstance(v.get("span"), str) or v["span"] not in text or not v["span"].strip()
        ):
            dropped.append(
                {"aspect": a, "span": str(v.get("span")), "reason": "failed final span check"}
            )
            pred[a] = None
    errs = prediction_errors(pred, text)
    if errs:  # should be unreachable; degrade to the blank prediction instead of raising
        dropped.append(
            {"aspect": "*", "span": "", "reason": "invalid prediction: " + "; ".join(errs)[:200]}
        )
        pred = empty_prediction(str(pred.get("item_id")))
    return pred


def classify_item(
    item: dict[str, Any],
    *,
    use_model: bool = True,
    model_fn: ModelFn | None = None,
    fewshot_pool: Sequence[dict[str, Any]] | None = None,
    policy: MergePolicy | None = None,
) -> dict[str, Any]:
    """Classify one package item. Never raises on bad model output.

    `model_fn` and `fewshot_pool` are optional hooks for evaluation and tests; by default
    the local llama-server adapter and the full dev pool are used.
    On model failure the rules prediction is returned with the reason in `_meta.error`.
    """
    t0 = time.perf_counter()
    text = item.get("text") or ""
    meta: dict[str, Any] = {
        "method": "rule",
        "model": None,
        "prompt_version": None,
        "latency_ms": 0,
        "dropped_spans": [],
        "rules_version": rules.RULES_VERSION,
        "error": None,
    }
    try:
        rule = rules.apply_rules(item)
    except Exception as exc:  # malformed item: keep the contract, never raise
        pred = empty_prediction(str(item.get("item_id")))
        meta["error"] = f"rules failed: {type(exc).__name__}: {exc}"
        meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        return {**pred, "_meta": meta}

    pred = rule.prediction
    if use_model and not rule.final and text:
        if model_fn is None:
            from .model import classify_with_model as model_fn  # lazy: rules-only needs no server
        try:
            raw, info = model_fn(item, fewshot_pool)
            meta["model"] = info.get("model")
            meta["prompt_version"] = info.get("prompt_version")
            meta["model_latency_ms"] = info.get("latency_ms")
            merged, dropped, overrode = merge_model_output(item, rule, raw, policy or get_policy())
            meta["merge_policy"] = (policy or get_policy()).name
            pred = merged
            meta["dropped_spans"].extend(dropped)
            meta["method"] = "mixed" if overrode else "model"
        except Exception as exc:
            meta["error"] = f"model failed, rules fallback: {type(exc).__name__}: {exc}"[:300]
    pred = _final_check(dict(pred), text, meta["dropped_spans"])
    meta["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    return {**pred, "_meta": meta}
