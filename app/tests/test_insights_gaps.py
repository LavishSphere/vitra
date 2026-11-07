from __future__ import annotations

from app.gaps import compute_gaps
from app.insights import build_insights
from app.models import EvidenceItem


def _text_fields(card) -> list[str]:
    return [
        card.headline,
        card.why_it_matters,
        card.fact,
        card.observed_sentiment,
        card.interpretation,
    ]


def test_card_citations_are_verified_spans(evidence: list[EvidenceItem]) -> None:
    texts = {e.item_id: e.text for e in evidence}
    cards = build_insights(evidence)
    assert cards
    for card in cards:
        assert card.citations, card.id
        for c in card.citations:
            assert c.span in texts[c.item_id]
            assert texts[c.item_id][c.span_start : c.span_end] == c.span


def test_item_cards_only_for_actionable_items_with_quotes(evidence: list[EvidenceItem]) -> None:
    ids = {c.id for c in build_insights(evidence)}
    assert {"card-SYN-0001", "card-SYN-0003", "card-SYN-0004", "card-SYN-0104"} <= ids
    assert "card-SYN-0002" not in ids  # not actionable
    assert "card-SYN-0006" not in ids  # actionable, but its only quote failed verification


def test_card_text_is_templated_and_separated(evidence: list[EvidenceItem]) -> None:
    for card in build_insights(evidence):
        fields = _text_fields(card)
        assert all(f.strip() for f in fields)
        assert len(set(fields)) == len(fields)  # fact / sentiment / interpretation stay separate
        assert not any(ch in f for f in fields for ch in ("\u2013", "\u2014"))  # no en/em dashes
    card = next(c for c in build_insights(evidence) if c.id == "card-SYN-0003")
    assert "Synthetic label update" in card.headline  # noun comes from the item title
    assert "Regulatory update" in card.headline
    assert card.confidence.level == "high"


def test_shift_card_and_its_removal_by_exclusion(evidence: list[EvidenceItem]) -> None:
    cards = {c.id: c for c in build_insights(evidence)}
    shift = cards["shift-A-efficacy-all-2025-W11"]  # W10 mean +1.5 (n=2) -> W11 mean -0.5 (n=2)
    assert "fell 2.0 points" in shift.headline
    assert {c.item_id for c in shift.citations} == {"SYN-0001", "SYN-0002", "SYN-0102", "SYN-0103"}
    # Per-speaker duplicates of the same item set are not emitted.
    assert not any(k.startswith("shift-A-efficacy-media") for k in cards)
    after = {c.id for c in build_insights(evidence, {"SYN-0102"})}
    assert "shift-A-efficacy-all-2025-W11" not in after


def test_insights_product_filter(evidence: list[EvidenceItem]) -> None:
    cards = build_insights(evidence, products={"B"})
    assert cards and all(c.product == "B" for c in cards)


def test_gaps(evidence: list[EvidenceItem]) -> None:
    # Default (contract v1.1): only empty cells are gaps.
    assert all(g.n_items_in_window == 0 for g in compute_gaps(evidence, window_weeks=2))
    thin = compute_gaps(evidence, window_weeks=2, max_items=1)
    gaps = {(g.product, g.speaker, g.aspect): g for g in thin}
    # Window = W13..W14. SYN-0104 ("both") gives payer access_cost one item for A and for B.
    assert gaps[("B", "payer", "access_cost")].n_items_in_window == 1
    assert gaps[("A", "payer", "access_cost")].last_seen_week == "2025-W14"
    never = gaps[("B", "patient", "convenience")]
    assert never.n_items_in_window == 0 and never.last_seen_week is None
    # Seen earlier but not in the window: listed with its last week.
    assert gaps[("A", "researcher", "efficacy")].n_items_in_window == 0
    assert gaps[("A", "researcher", "efficacy")].last_seen_week == "2025-W11"
    # Emptiest first.
    ns = [g.n_items_in_window for g in thin]
    assert ns == sorted(ns)


def test_exclusion_opens_a_gap(evidence: list[EvidenceItem]) -> None:
    def key(gs):
        return {(g.product, g.speaker, g.aspect): g.n_items_in_window for g in gs}

    before = key(compute_gaps(evidence, window_weeks=2, max_items=5))
    after = key(compute_gaps(evidence, {"SYN-0104"}, window_weeks=2, max_items=5))
    assert before[("B", "payer", "access_cost")] == 1 and after[("B", "payer", "access_cost")] == 0
