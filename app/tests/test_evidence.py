from __future__ import annotations

from datetime import date, timedelta

from app.data import EvidenceStore
from app.evidence import iso_week, score_level, week_from_index, week_index
from app.models import EvidenceItem


def test_span_offsets_are_exact(store: EvidenceStore) -> None:
    items = store.annotated()
    assert items
    for e in items:
        for a in e.aspects:
            assert e.text[a.span_start : a.span_end] == a.span
            assert a.span_end - a.span_start == len(a.span)


def test_unverifiable_span_is_dropped_with_a_note(by_id: dict[str, EvidenceItem]) -> None:
    bad = by_id["SYN-0006"]
    assert bad.aspects == []
    assert bad.confidence.span_verified is False
    assert bad.confidence.level == "low"
    assert any(n.startswith("dropped efficacy") for n in bad.confidence.notes)


def test_label_priority_and_origin(store: EvidenceStore, by_id: dict[str, EvidenceItem]) -> None:
    assert by_id["SYN-0001"].origin == "gold_dev"
    assert by_id["SYN-0001"].confidence.method == "gold"
    # The prediction for a gold item is ignored, not merged.
    assert [a.aspect for a in by_id["SYN-0001"].aspects] == ["efficacy"]
    assert by_id["SYN-0101"].origin == "predicted"
    assert by_id["SYN-0101"].confidence.method == "model"
    assert by_id["SYN-0102"].confidence.method == "mixed"
    # No _meta: treated as model, and says so.
    assert by_id["SYN-0103"].confidence.method == "model"
    assert any("not recorded" in n for n in by_id["SYN-0103"].confidence.notes)
    r = store.report
    assert r.gold_labels == 6
    assert r.predicted_labels == {"unlabeled.jsonl": 4}
    assert r.skipped["prediction: unknown item_id"] == 1
    assert r.skipped["prediction: item already labeled by a higher-priority source"] == 1


def test_iso_weeks() -> None:
    assert iso_week("2025-03-03") == "2025-W10"
    assert iso_week("2025-03-09") == "2025-W10"  # Sunday stays in the same ISO week
    assert iso_week("2026-01-01") == "2026-W01"
    assert iso_week("2027-01-01") == "2026-W53"  # 2026 has 53 ISO weeks
    assert iso_week("2024-12-30") == "2025-W01"
    d = date(2024, 12, 1)
    for _ in range(120):
        w = iso_week(d.isoformat())
        assert week_from_index(week_index(w)) == w
        d += timedelta(days=7)
    assert week_index("2026-W01") - week_index("2025-W52") == 1


def test_confidence_rubric(by_id: dict[str, EvidenceItem]) -> None:
    label = by_id["SYN-0003"].confidence  # gold fda_label: 2 + 2, plus corroboration
    assert label.source_authority == "regulator"
    assert (
        label.corroborating_items == 2
    )  # SYN-0002 (W10) and SYN-0101 (W11): safety, negative, product A
    assert label.level == "high"
    assert by_id["SYN-0101"].confidence.source_authority == "news"
    assert by_id["SYN-0001"].confidence.source_authority == "peer_reviewed"
    assert by_id["SYN-0004"].confidence.source_authority == "company"
    assert by_id["SYN-0005"].confidence.source_authority == "registry"
    no_quote = by_id["SYN-0005"].confidence
    assert no_quote.span_verified is False and no_quote.level == "low"
    for e in by_id.values():
        assert any(n.startswith("rubric:") for n in e.confidence.notes)
    assert score_level("model", True, "news", 0) == ("low", 0)
    assert score_level("gold", True, "peer_reviewed", 0) == ("medium", 3)
    assert score_level("gold", True, "peer_reviewed", 2) == ("high", 4)
    assert score_level("gold", False, "regulator", 5)[0] == "low"


def test_corroboration_respects_product_and_window(by_id: dict[str, EvidenceItem]) -> None:
    # SYN-0004 is the only product-B efficacy item, so nothing corroborates it.
    assert by_id["SYN-0004"].confidence.corroborating_items == 0


def test_predict_cli_sidecar_supplies_method(synthetic_settings) -> None:
    import json

    from app.data import load_evidence

    preds = synthetic_settings.predictions_dir
    (preds / "extra.jsonl").write_text(
        json.dumps(
            {
                "item_id": "SYN-0103",
                "signal_type": "none",
                "actionable": "no",
                "efficacy": None,
                "safety": None,
                "convenience": None,
                "access_cost": None,
                "evidence_quality": None,
            }
        )
        + "\n"
    )
    (preds / "unlabeled.jsonl").unlink()
    (preds / "extra.meta.jsonl").write_text(
        json.dumps({"item_id": "SYN-0103", "method": "rule"}) + "\n"
    )
    evidence, report = load_evidence(synthetic_settings)
    [e] = [e for e in evidence if e.item_id == "SYN-0103"]
    assert e.confidence.method == "rule"
    assert report.predicted_labels == {"extra.jsonl": 1}  # the sidecar is not read as predictions


def test_prediction_set_selection(synthetic_settings) -> None:
    import json
    from dataclasses import replace

    from app.config import parse_prediction_sets
    from app.data import load_evidence

    assert parse_prediction_sets("all") is None and parse_prediction_sets("") is None
    assert parse_prediction_sets("none") == ()
    assert parse_prediction_sets(" test, unlabeled ") == ("test", "unlabeled")

    only_gold, r = load_evidence(replace(synthetic_settings, predictions=()))
    assert {e.origin for e in only_gold} == {"gold_dev"} and r.predicted_labels == {}

    preds = synthetic_settings.predictions_dir
    row = {
        "item_id": "SYN-0101",
        "signal_type": "none",
        "actionable": "no",
        "efficacy": None,
        "safety": None,
        "convenience": None,
        "access_cost": None,
        "evidence_quality": None,
    }
    (preds / "other.jsonl").write_text(json.dumps(row) + "\n")
    # Earlier sets win: "other" first means SYN-0101 has no aspects.
    ev, r = load_evidence(
        replace(synthetic_settings, predictions=("other", "unlabeled", "missing"))
    )
    by = {e.item_id: e for e in ev}
    assert by["SYN-0101"].aspects == [] and by["SYN-0101"].origin == "predicted"
    assert r.predicted_labels == {"other.jsonl": 1, "unlabeled.jsonl": 3}
    assert any(m.endswith("missing.jsonl") for m in r.missing_files)
    ev, _ = load_evidence(
        replace(synthetic_settings, predictions=(str(preds / "unlabeled.jsonl"),))
    )
    assert by["SYN-0101"].item_id in {e.item_id for e in ev}
