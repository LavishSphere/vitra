from __future__ import annotations

from app.insights import build_insights
from app.models import EvidenceItem
from app.trends import compute_trends


def _cell(cells, week, product, speaker, aspect):
    [c] = [
        c
        for c in cells
        if (c.week, c.product, c.speaker, c.aspect) == (week, product, speaker, aspect)
    ]
    return c


def test_empty_cell_is_null_never_zero(evidence: list[EvidenceItem]) -> None:
    cells = compute_trends(evidence)
    # W13 has no items at all: present in the grid, but null.
    empty = _cell(cells, "2025-W13", "A", "all", "all")
    assert empty.mean_polarity is None and empty.n_items == 0 and empty.item_ids == []
    # A real polarity of 0 is 0.0 with n=1, which is different from empty.
    neutral = _cell(cells, "2025-W11", "A", "media", "efficacy")
    assert neutral.mean_polarity == 0.0 and neutral.n_items == 1
    assert all((c.mean_polarity is None) == (c.n_items == 0) for c in cells)


def test_grid_is_contiguous_weeks(evidence: list[EvidenceItem]) -> None:
    weeks = sorted({c.week for c in compute_trends(evidence)})
    assert weeks == ["2025-W10", "2025-W11", "2025-W12", "2025-W13", "2025-W14"]


def test_cell_values_and_rollups(evidence: list[EvidenceItem]) -> None:
    cells = compute_trends(evidence)
    eff = _cell(cells, "2025-W10", "A", "all", "efficacy")
    assert eff.mean_polarity == 1.5 and eff.n_items == 2 and eff.n_sources == 2
    assert sorted(eff.item_ids) == ["SYN-0001", "SYN-0002"]
    # aspect=all mixes observations: SYN-0002 adds efficacy +1 and safety -1.
    allw10 = _cell(cells, "2025-W10", "A", "all", "all")
    assert allw10.n_items == 2 and allw10.mean_polarity == round((2 + 1 - 1) / 3, 3)
    # "both" stays its own product.
    both = _cell(cells, "2025-W14", "both", "payer", "access_cost")
    assert both.mean_polarity == -2.0
    assert _cell(cells, "2025-W14", "B", "payer", "access_cost").n_items == 0


def test_filters(evidence: list[EvidenceItem]) -> None:
    cells = compute_trends(evidence, products={"B"}, aspects={"efficacy"}, speakers={"all"})
    assert {(c.product, c.aspect, c.speaker) for c in cells} == {("B", "efficacy", "all")}
    assert len(cells) == 5


def test_exclude_restore_equivalence(evidence: list[EvidenceItem]) -> None:
    base = compute_trends(evidence)
    excluded = {"SYN-0001", "SYN-0101"}
    after = compute_trends(evidence, excluded)
    # Same grid, and the excluded items vanish from every cell.
    assert [(c.week, c.product, c.speaker, c.aspect) for c in after] == [
        (c.week, c.product, c.speaker, c.aspect) for c in base
    ]
    assert not any(set(c.item_ids) & excluded for c in after)
    # Excluding is the same as recomputing from the filtered list (same function).
    filtered = [e for e in evidence if e.item_id not in excluded]
    direct = {(c.week, c.product, c.speaker, c.aspect): c for c in compute_trends(filtered)}
    for c in after:
        key = (c.week, c.product, c.speaker, c.aspect)
        assert c == direct.get(
            key,
            c.model_copy(
                update={"mean_polarity": None, "n_items": 0, "n_sources": 0, "item_ids": []}
            ),
        )
    # A cell emptied by exclusion becomes null, not 0.
    researcher = _cell(after, "2025-W10", "A", "researcher", "efficacy")
    assert researcher.mean_polarity is None and researcher.n_items == 0
    # Restore = recompute with nothing excluded = identical to the original.
    assert compute_trends(evidence, set()) == base
    assert build_insights(evidence, set()) == build_insights(evidence)
    assert build_insights(evidence, excluded) == build_insights(filtered)
