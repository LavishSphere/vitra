"""Weekly sentiment trends (contract section 4). Pure functions, no state.

- Bucket: ISO week of the item's `published` date.
- Grid: every ISO week from the earliest to the latest week in the evidence
  passed in (before exclusion), so a what-if exclusion empties cells instead
  of removing them, and before/after grids line up cell for cell.
- Dimensions: product (A, B, both; "both" stays its own value), speaker (each
  of the 7 plus "all"), aspect (each of the 5 plus "all").
- mean_polarity is the mean over aspect observations in the cell, rounded to
  3 decimals. One item adds one observation per aspect it judges, so in the
  aspect="all" rollup an item judging two aspects counts twice in the mean
  but once in n_items.
- n_items: distinct items. n_sources: distinct source types (pubmed, news...).
- An empty cell has mean_polarity None and n_items 0. It is never 0.0, and
  nothing is interpolated or smoothed across empty weeks.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable
from dataclasses import dataclass, field

from .evidence import week_from_index, week_index
from .models import ASPECTS, PRODUCTS, SPEAKERS, EvidenceItem, TrendCell

ALL = "all"
CellKey = tuple[str, str, str, str]  # (week, product, speaker, aspect)


@dataclass
class _Acc:
    total: int = 0
    count: int = 0
    item_ids: dict[str, None] = field(default_factory=dict)  # ordered set
    sources: set[str] = field(default_factory=set)


def week_range(evidence: Iterable[EvidenceItem]) -> list[str]:
    idx = [week_index(e.iso_week) for e in evidence]
    if not idx:
        return []
    return [week_from_index(i) for i in range(min(idx), max(idx) + 1)]


def included(evidence: Iterable[EvidenceItem], excluded: Collection[str]) -> list[EvidenceItem]:
    ex = set(excluded)
    return [e for e in evidence if e.item_id not in ex]


def accumulate(evidence: Iterable[EvidenceItem]) -> dict[CellKey, _Acc]:
    cells: dict[CellKey, _Acc] = {}
    for e in evidence:
        for a in e.aspects:
            for sp in (a.speaker, ALL):
                for asp in (a.aspect, ALL):
                    acc = cells.setdefault((e.iso_week, e.product, sp, asp), _Acc())
                    acc.total += a.polarity
                    acc.count += 1
                    acc.item_ids[e.item_id] = None
                    acc.sources.add(e.source)
    return cells


def _cell(key: CellKey, acc: _Acc | None) -> TrendCell:
    week, product, speaker, aspect = key
    if acc is None or acc.count == 0:
        return TrendCell(
            week=week,
            product=product,
            speaker=speaker,
            aspect=aspect,  # type: ignore[arg-type]
            mean_polarity=None,
            n_items=0,
            n_sources=0,
            item_ids=[],
        )
    return TrendCell(
        week=week,
        product=product,
        speaker=speaker,
        aspect=aspect,  # type: ignore[arg-type]
        mean_polarity=round(acc.total / acc.count, 3),
        n_items=len(acc.item_ids),
        n_sources=len(acc.sources),
        item_ids=list(acc.item_ids),
    )


def compute_trends(
    evidence: list[EvidenceItem],
    excluded: Collection[str] = (),
    *,
    products: Collection[str] | None = None,
    aspects: Collection[str] | None = None,
    speakers: Collection[str] | None = None,
) -> list[TrendCell]:
    """All trend cells for the evidence minus `excluded`, optionally filtered.

    Filters take dimension values, including "all" for the rollups. None means
    no filter. Order: product, aspect, speaker, week.
    """
    weeks = week_range(evidence)
    cells = accumulate(included(evidence, excluded))
    prods = [p for p in PRODUCTS if products is None or p in products]
    asps = [a for a in (*ASPECTS, ALL) if aspects is None or a in aspects]
    sps = [s for s in (*SPEAKERS, ALL) if speakers is None or s in speakers]
    return [
        _cell(k, cells.get(k))
        for p in prods
        for a in asps
        for s in sps
        for w in weeks
        for k in [(w, p, s, a)]
    ]
