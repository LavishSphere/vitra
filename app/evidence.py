"""Build EvidenceItems (contract section 3) and score their confidence.

Span verification
-----------------
Every aspect span is located with an exact, case-sensitive `text.find(span)`.
If the span is empty or not found, the aspect is dropped and a note is added.
An EvidenceItem therefore never carries a quote that isn't in its source text,
and `text[span_start:span_end] == span` always holds.

Confidence rubric (a documented rule, never a probability)
-----------------------------------------------------------
Four components are reported as-is, so the UI can show them instead of a badge:

1. method: how the label was produced.
   gold (organizer dev label) = +2, rule (deterministic code) = +1,
   mixed (rules plus model) = +1, model (local LLM only) = +0.
2. span_verified: true when the label had at least one aspect and every aspect
   span was found verbatim in the text. Items with no quoted aspect, or with a
   dropped span, have span_verified = false.
3. source_authority, from the item source:
   fda_label, fda_notice -> regulator (+2); ctgov -> registry (+2);
   pubmed -> peer_reviewed (+1); press_release -> company (+0);
   news, fda_event -> news (+0); transcript -> private (+0, ranked below news
   because a pasted transcript is unpublished and unreviewed).
   fda_event is spontaneous adverse-event reporting (FAERS), so it is not ranked
   as a regulator statement.
4. corroborating_items: the number of OTHER items in the same evidence set that
   share at least one (aspect, polarity sign) with this item, are about the same
   product (equal product, or either side is "both"), and were published within
   +/-2 ISO weeks. Corroboration of 2 or more adds +1.

Level:
- low    if span_verified is false (nothing quotable backs the item), else
- high   if points >= 4,
- medium if points >= 2,
- low    otherwise.

Examples: a gold PubMed label scores 3 (medium) and 4 with corroboration (high);
a model-only news label scores 0 (low); a rule-derived ClinicalTrials.gov label
scores 3 (medium).

Corroboration depends on which items are in the set, so `annotate()` is
re-run on the included items whenever a what-if exclusion changes the set.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from typing import Any

from .models import ASPECTS, AspectEvidence, Confidence, EvidenceItem

SOURCE_AUTHORITY: dict[str, str] = {
    "fda_label": "regulator",
    "fda_notice": "regulator",
    "ctgov": "registry",
    "pubmed": "peer_reviewed",
    "press_release": "company",
    "news": "news",
    "fda_event": "news",
    "transcript": "private",
}
AUTHORITY_POINTS: dict[str, int] = {
    "regulator": 2,
    "registry": 2,
    "peer_reviewed": 1,
    "company": 0,
    "news": 0,
    "private": 0,
}
METHOD_POINTS: dict[str, int] = {"gold": 2, "rule": 1, "mixed": 1, "model": 0}
AUTHORITY_RANK: dict[str, int] = {
    "regulator": 4,
    "registry": 3,
    "peer_reviewed": 2,
    "company": 1,
    "news": 0,
    "private": -1,
}
CORROBORATION_WINDOW_WEEKS = 2
CORROBORATION_MIN = 2
LEVEL_HIGH_POINTS = 4
LEVEL_MEDIUM_POINTS = 2


# ---- ISO weeks -------------------------------------------------------------


def iso_week(published: str) -> str:
    """ISO week label (YYYY-Www) of a YYYY-MM-DD date string."""
    y, w, _ = date.fromisoformat(published[:10]).isocalendar()
    return f"{y}-W{w:02d}"


def week_index(week: str) -> int:
    """Consecutive integer per ISO week, so week arithmetic is plain subtraction."""
    y, w = week.split("-W")
    return date.fromisocalendar(int(y), int(w), 1).toordinal() // 7


def week_from_index(idx: int) -> str:
    # Ordinal 1 (0001-01-01) is a Monday, so Mondays are exactly the ordinals 7k+1.
    y, w, _ = date.fromordinal(idx * 7 + 1).isocalendar()
    return f"{y}-W{w:02d}"


def sign(x: int) -> int:
    return (x > 0) - (x < 0)


# ---- span verification -----------------------------------------------------


def verify_aspects(
    label: dict[str, Any], text: str
) -> tuple[list[AspectEvidence], list[dict[str, str]]]:
    """Return verified aspects (exact offsets) and the dropped ones with a reason."""
    kept: list[AspectEvidence] = []
    dropped: list[dict[str, str]] = []
    for name in ASPECTS:
        a = label.get(name)
        if a is None:
            continue
        span = a.get("span") if isinstance(a, dict) else None
        if not isinstance(span, str) or not span:
            dropped.append({"aspect": name, "span": "", "reason": "empty span"})
            continue
        start = text.find(span)
        if start < 0:
            dropped.append(
                {
                    "aspect": name,
                    "span": span,
                    "reason": "span is not an exact substring of the text",
                }
            )
            continue
        try:
            kept.append(
                AspectEvidence(
                    aspect=name,
                    polarity=int(a["polarity"]),
                    speaker=a["speaker"],
                    span=span,
                    span_start=start,
                    span_end=start + len(span),
                )
            )
        except (KeyError, TypeError, ValueError):
            dropped.append({"aspect": name, "span": span, "reason": "invalid polarity or speaker"})
    return kept, dropped


# ---- building --------------------------------------------------------------


def build_item(
    item: dict[str, Any],
    label: dict[str, Any],
    *,
    origin: str,
    method: str,
    extra_notes: Iterable[str] = (),
) -> EvidenceItem:
    """Build one EvidenceItem. Corroboration is filled in later by `annotate`."""
    text = item.get("text") or ""
    aspects, dropped = verify_aspects(label, text)
    notes = list(extra_notes)
    notes += [f"dropped {d['aspect']}: {d['reason']}" for d in dropped]
    span_verified = bool(aspects) and not dropped
    if not aspects and not dropped:
        notes.append("no aspect is judged in this item, so there is no quote to verify")
    authority = SOURCE_AUTHORITY.get(item["source"], "news")
    if item["source"] == "transcript":
        notes.append("private transcript: unpublished and unreviewed, lowest authority tier")
    confidence = Confidence(
        level="low",
        method=method,
        span_verified=span_verified,  # type: ignore[arg-type]
        source_authority=authority,
        corroborating_items=0,
        notes=notes,  # type: ignore[arg-type]
    )
    return EvidenceItem(
        item_id=item["item_id"],
        source=item["source"],
        url=item.get("url") or "",
        published=item["published"][:10],
        iso_week=iso_week(item["published"]),
        product=item["product"],
        title=item.get("title") or "",
        text=text,
        signal_type=label["signal_type"],
        actionable=label["actionable"],
        origin=origin,
        aspects=aspects,
        confidence=confidence,  # type: ignore[arg-type]
    )


def score_level(
    method: str, span_verified: bool, authority: str, corroborating: int
) -> tuple[str, int]:
    points = (
        METHOD_POINTS[method]
        + AUTHORITY_POINTS[authority]
        + (1 if corroborating >= CORROBORATION_MIN else 0)
    )
    if not span_verified:
        return "low", points
    if points >= LEVEL_HIGH_POINTS:
        return "high", points
    if points >= LEVEL_MEDIUM_POINTS:
        return "medium", points
    return "low", points


def _products_overlap(a: str, b: str) -> bool:
    return a == b or a == "both" or b == "both"


def corroboration_counts(items: list[EvidenceItem]) -> dict[str, int]:
    """Count corroborating items for each item (see the module docstring)."""
    index: dict[tuple[str, int, int], list[EvidenceItem]] = defaultdict(list)
    for it in items:
        w = week_index(it.iso_week)
        for a in it.aspects:
            index[(a.aspect, sign(a.polarity), w)].append(it)
    counts: dict[str, int] = {}
    for it in items:
        w = week_index(it.iso_week)
        seen: set[str] = set()
        for a in it.aspects:
            s = sign(a.polarity)
            for dw in range(-CORROBORATION_WINDOW_WEEKS, CORROBORATION_WINDOW_WEEKS + 1):
                for other in index.get((a.aspect, s, w + dw), ()):
                    if other.item_id != it.item_id and _products_overlap(other.product, it.product):
                        seen.add(other.item_id)
        counts[it.item_id] = len(seen)
    return counts


def annotate(items: list[EvidenceItem]) -> list[EvidenceItem]:
    """Return copies with corroboration and level computed over exactly `items`."""
    counts = corroboration_counts(items)
    out: list[EvidenceItem] = []
    for it in items:
        c = it.confidence
        n = counts[it.item_id]
        level, points = score_level(c.method, c.span_verified, c.source_authority, n)
        base_notes = [x for x in c.notes if not x.startswith("rubric:")]
        rubric = (
            f"rubric: method {c.method} +{METHOD_POINTS[c.method]}, "
            f"authority {c.source_authority} +{AUTHORITY_POINTS[c.source_authority]}, "
            f"corroboration {n} item(s) +{1 if n >= CORROBORATION_MIN else 0}; "
            f"{points} point(s){'' if c.span_verified else ', capped at low (no verified quote)'}"
        )
        out.append(
            it.model_copy(
                update={
                    "confidence": c.model_copy(
                        update={
                            "level": level,
                            "corroborating_items": n,
                            "notes": base_notes + [rubric],
                        }
                    )
                }
            )
        )
    return out


def strongest_authority(authorities: Iterable[str]) -> str:
    return max(authorities, key=lambda a: AUTHORITY_RANK[a], default="private")
