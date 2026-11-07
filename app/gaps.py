"""Evidence gaps (contract section 6): Within3's "where's the gap" question.

A gap is a product x speaker x aspect cell with few or no items in the last
`window_weeks` ISO weeks of the data. The window ends at the latest week in the
evidence passed in (before exclusion), so excluding items can open a gap.

- Products: A and B. An item tagged "both" counts toward A and toward B,
  because it speaks about each of them.
- n_items_in_window counts distinct items whose aspect judgment has that
  speaker and aspect inside the window.
- last_seen_week is the latest week the cell had any item, or None if never.
- Returned: cells with n_items_in_window <= max_items, emptiest first.
"""

from __future__ import annotations

from collections.abc import Collection

from .evidence import week_index
from .models import ASPECTS, SPEAKERS, EvidenceGap, EvidenceItem
from .trends import included

GAP_PRODUCTS = ("A", "B")


def compute_gaps(
    evidence: list[EvidenceItem],
    excluded: Collection[str] = (),
    *,
    window_weeks: int = 8,
    max_items: int = 1,
) -> list[EvidenceGap]:
    if window_weeks < 1:
        raise ValueError("window_weeks must be >= 1")
    if not evidence:
        return []
    end = max(week_index(e.iso_week) for e in evidence)
    start = end - window_weeks + 1

    in_window: dict[tuple[str, str, str], set[str]] = {}
    last_seen: dict[tuple[str, str, str], str] = {}
    for e in included(evidence, excluded):
        w = week_index(e.iso_week)
        targets = GAP_PRODUCTS if e.product == "both" else (e.product,)
        for a in e.aspects:
            for p in targets:
                key = (p, a.speaker, a.aspect)
                if key not in last_seen or w > week_index(last_seen[key]):
                    last_seen[key] = e.iso_week
                if start <= w <= end:
                    in_window.setdefault(key, set()).add(e.item_id)

    gaps = []
    for p in GAP_PRODUCTS:
        for s in SPEAKERS:
            for a in ASPECTS:
                key = (p, s, a)
                n = len(in_window.get(key, ()))
                if n <= max_items:
                    gaps.append(
                        EvidenceGap(
                            product=p,
                            speaker=s,
                            aspect=a,  # type: ignore[arg-type]
                            window_weeks=window_weeks,
                            n_items_in_window=n,
                            last_seen_week=last_seen.get(key),
                        )
                    )
    gaps.sort(
        key=lambda g: (
            g.n_items_in_window,
            g.last_seen_week is not None,
            g.last_seen_week or "",
            g.product,
            g.aspect,
            g.speaker,
        )
    )
    return gaps
