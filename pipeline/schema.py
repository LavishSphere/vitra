"""Organizer prediction format: enums, empty prediction, and a strict validator.

The format is fixed by the hackathon package README. Nothing here may change it.
"""

from __future__ import annotations

from typing import Any

ASPECTS: tuple[str, ...] = ("efficacy", "safety", "convenience", "access_cost", "evidence_quality")
SIGNAL_TYPES: tuple[str, ...] = (
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
ACTIONABLE: tuple[str, ...] = ("yes", "no")
SPEAKERS: tuple[str, ...] = (
    "researcher",
    "hcp",
    "patient",
    "company",
    "regulator",
    "payer",
    "media",
)
POLARITIES: tuple[int, ...] = (-2, -1, 0, 1, 2)
SOURCES: tuple[str, ...] = (
    "pubmed",
    "ctgov",
    "fda_event",
    "fda_label",
    "fda_notice",
    "press_release",
    "news",
)

PREDICTION_KEYS: tuple[str, ...] = ("item_id", "signal_type", "actionable", *ASPECTS)


def empty_prediction(item_id: str) -> dict[str, Any]:
    """The all-blank prediction: signal none, not actionable, every aspect null."""
    return {
        "item_id": item_id,
        "signal_type": "none",
        "actionable": "no",
        **{a: None for a in ASPECTS},
    }


def aspect(polarity: int, speaker: str, span: str) -> dict[str, Any]:
    return {"polarity": int(polarity), "speaker": speaker, "span": span}


def prediction_errors(pred: dict[str, Any], text: str | None) -> list[str]:
    """Return every format problem with one prediction (empty list means valid).

    `text` is the item text; when given, each span must be an exact substring of it.
    """
    errs: list[str] = []
    for k in PREDICTION_KEYS:
        if k not in pred:
            errs.append(f"missing key {k}")
    if pred.get("signal_type") not in SIGNAL_TYPES:
        errs.append(f"bad signal_type {pred.get('signal_type')!r}")
    if pred.get("actionable") not in ACTIONABLE:
        errs.append(f"bad actionable {pred.get('actionable')!r}")
    for a in ASPECTS:
        v = pred.get(a)
        if v is None:
            continue
        if not isinstance(v, dict):
            errs.append(f"{a}: not an object or null")
            continue
        pol = v.get("polarity")
        if not isinstance(pol, int) or isinstance(pol, bool) or pol not in POLARITIES:
            errs.append(f"{a}: bad polarity {pol!r}")
        if v.get("speaker") not in SPEAKERS:
            errs.append(f"{a}: bad speaker {v.get('speaker')!r}")
        span = v.get("span")
        if not isinstance(span, str) or not span.strip():
            errs.append(f"{a}: empty span")
        elif text is not None and span not in text:
            errs.append(f"{a}: span not in text")
    return errs


def public_prediction(pred: dict[str, Any]) -> dict[str, Any]:
    """Strip private keys (e.g. `_meta`) and order keys like the organizer sample."""
    return {k: pred.get(k) for k in PREDICTION_KEYS}
