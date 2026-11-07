from pipeline.api import classify_item

TEXT = (
    "Synthetic advisory board note. Thoracic oncologist: The subcutaneous version cuts chair "
    "time from hours to minutes. The rash is still a real concern for my patients. "
    "Payer representative: prior authorization for the combination has been slow."
)
TRANSCRIPT = {
    "item_id": "SYN-T1",
    "source": "transcript",
    "product": "B",
    "title": "",
    "text": TEXT,
}
NEWS = {**TRANSCRIPT, "item_id": "SYN-N1", "source": "news"}

RAW = {
    "signal_type": "none",
    "actionable": "no",
    "efficacy": {"polarity": 1, "speaker": "hcp", "span": "cuts chair time from hours to minutes"},
    "safety": {"polarity": -1, "speaker": "hcp", "span": "still a real concern for my patients"},
    "convenience": {
        "polarity": 1,
        "speaker": "hcp",
        "span": "cuts chair time from hours to minutes",
    },
    "access_cost": {
        "polarity": -1,
        "speaker": "payer",
        "span": "prior authorization for the combination has been slow",
    },
    "evidence_quality": None,
}


def fake_model(output):
    def run(item, pool):
        return dict(output), {"model": "stub", "prompt_version": "test", "latency_ms": 1}

    return run


def test_transcript_keeps_convenience_and_access():
    out = classify_item(TRANSCRIPT, model_fn=fake_model(RAW))
    assert out["_meta"]["merge_policy"] == "transcript"
    assert out["convenience"]["span"] == "cuts chair time from hours to minutes"
    assert out["access_cost"]["polarity"] == -1
    assert out["safety"]["polarity"] == -1


def test_transcript_uses_each_quote_once():
    out = classify_item(TRANSCRIPT, model_fn=fake_model(RAW))
    assert out["efficacy"] is None  # same quote went to the more specific convenience aspect
    reasons = [d["reason"] for d in out["_meta"]["dropped_spans"]]
    assert "same quote already used for convenience" in reasons


def test_scoring_policy_unchanged_for_other_sources():
    out = classify_item(NEWS, model_fn=fake_model(RAW))
    assert out["_meta"]["merge_policy"] == "hybrid-evq-eff2"
    assert out["convenience"] is None and out["access_cost"] is None


def test_every_span_is_in_the_text():
    out = classify_item(TRANSCRIPT, model_fn=fake_model(RAW))
    for key in ("efficacy", "safety", "convenience", "access_cost", "evidence_quality"):
        if out[key]:
            assert out[key]["span"] in TEXT
