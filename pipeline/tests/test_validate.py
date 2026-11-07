from pipeline.data import TEST_ITEMS, read_jsonl
from pipeline.predict import predict_items
from pipeline.schema import (
    ACTIONABLE,
    ASPECTS,
    SIGNAL_TYPES,
    SPEAKERS,
    empty_prediction,
    public_prediction,
)
from pipeline.tests.conftest import needs_data
from pipeline.validate import validate

ITEMS = [
    {"item_id": f"T-{i}", "source": "news", "text": f"Item {i} says osimertinib worked."}
    for i in range(240)
]


def test_valid_240_lines():
    preds = [empty_prediction(it["item_id"]) for it in ITEMS]
    preds[0]["efficacy"] = {"polarity": 1, "speaker": "media", "span": "osimertinib worked"}
    r = validate(preds, ITEMS)
    assert r["valid"] and r["n_lines"] == 240 and r["span_in_text"] == 1.0


def test_detects_every_problem_kind():
    preds = [empty_prediction(it["item_id"]) for it in ITEMS[:239]]
    assert not validate(preds, ITEMS)["valid"]  # missing line
    preds = [empty_prediction(it["item_id"]) for it in ITEMS]
    del preds[1]["safety"]  # missing key
    preds[2]["signal_type"] = "hype"  # bad enum
    preds[3]["actionable"] = "maybe"
    preds[4]["efficacy"] = {"polarity": 3, "speaker": "media", "span": "worked"}
    preds[5]["efficacy"] = {"polarity": 1, "speaker": "blogger", "span": "worked"}
    preds[6]["efficacy"] = {"polarity": 1, "speaker": "media", "span": "invented quote"}
    preds[7]["efficacy"] = {"polarity": True, "speaker": "media", "span": "worked"}
    r = validate(preds, ITEMS)
    assert not r["valid"] and r["rows_with_errors"] == 7 and r["span_in_text"] < 1.0


def test_enums_match_package_spec():
    assert set(SIGNAL_TYPES) == {
        "efficacy",
        "safety",
        "regulatory",
        "trial_update",
        "competitor_move",
        "access_pricing",
        "guideline",
        "expert_opinion",
        "none",
    }
    assert set(ACTIONABLE) == {"yes", "no"}
    assert set(SPEAKERS) == {
        "researcher",
        "hcp",
        "patient",
        "company",
        "regulator",
        "payer",
        "media",
    }
    assert ASPECTS == ("efficacy", "safety", "convenience", "access_cost", "evidence_quality")


@needs_data
def test_rules_only_test_submission_is_240_valid_lines():
    # format-only check on the real test inputs; no text is printed or inspected
    items = read_jsonl(TEST_ITEMS)
    preds = [public_prediction(r) for r in predict_items(items, use_model=False)]
    r = validate(preds, items)
    assert len(preds) == 240 and r["valid"], {
        k: r[k] for k in ("missing", "extra", "rows_with_errors", "error_kinds")
    }
    for p in preds:
        assert all(k in p for k in ("item_id", "signal_type", "actionable", *ASPECTS))
