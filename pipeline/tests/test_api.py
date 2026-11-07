from pipeline.api import POLICIES, classify_item, locate_span
from pipeline.schema import ASPECTS, prediction_errors

PUBMED = {
    "item_id": "PM-X",
    "source": "pubmed",
    "product": "A",
    "title": "A phase 3 trial of osimertinib",
    "text": "Osimertinib significantly prolonged PFS. Toxicity was manageable. "
    "This was a retrospective cohort.",
}
NEWS = {
    "item_id": "NW-X",
    "source": "news",
    "product": "B",
    "title": "Doctors praise amivantamab",
    "text": "Dr. Lee said amivantamab is practice-changing for patients. "
    "Payers say they worry about the price. Analysts call it a breakthrough.",
}


def fake_model(output):
    def fn(item, pool):
        return output, {"model": "fake", "prompt_version": "test", "latency_ms": 1}

    return fn


def test_model_output_merged_with_rules():
    raw = {
        "signal_type": "efficacy",
        "actionable": "yes",
        "efficacy": {
            "polarity": 2,
            "speaker": "media",
            "span": "osimertinib significantly prolonged PFS",
        },
        "safety": {"polarity": 1, "span": "Toxicity was manageable."},
        "evidence_quality": {"polarity": -1, "span": "this paper is weak"},  # paraphrase: dropped
        "convenience": None,
        "access_cost": None,
    }
    out = classify_item(PUBMED, model_fn=fake_model(raw))
    assert out["signal_type"] == "efficacy" and out["actionable"] == "yes"
    assert out["efficacy"] == {
        "polarity": 2,
        "speaker": "researcher",
        "span": "Osimertinib significantly prolonged PFS",
    }
    assert out["safety"]["span"] == "Toxicity was manageable"
    assert out["evidence_quality"] is None
    assert [d["aspect"] for d in out["_meta"]["dropped_spans"]] == ["evidence_quality"]
    assert out["_meta"]["method"] in {"model", "mixed"}
    assert prediction_errors(out, PUBMED["text"]) == []


def test_news_keeps_model_speaker():
    raw = {
        "signal_type": "efficacy",
        "actionable": "no",
        "efficacy": {"polarity": 2, "speaker": "hcp", "span": "amivantamab is practice-changing"},
        "access_cost": {
            "polarity": -1,
            "speaker": "payer",
            "span": "Payers say they worry about the price",
        },
    }
    out = classify_item(NEWS, model_fn=fake_model(raw), policy=POLICIES["full"])
    assert out["efficacy"]["speaker"] == "hcp" and out["access_cost"]["speaker"] == "payer"


def test_news_unattributed_framing_is_media():
    raw = {
        "signal_type": "efficacy",
        "actionable": "no",
        "efficacy": {
            "polarity": 2,
            "speaker": "researcher",
            "span": "Analysts call it a breakthrough",
        },
    }
    out = classify_item(NEWS, model_fn=fake_model(raw))
    assert out["efficacy"]["speaker"] == "media"


def test_bad_model_output_never_raises():
    def boom(item, pool):
        raise ValueError("not json")

    out = classify_item(PUBMED, model_fn=boom)
    assert out["_meta"]["error"] and prediction_errors(out, PUBMED["text"]) == []
    out = classify_item(
        PUBMED,
        model_fn=fake_model(
            {
                "signal_type": "hype",
                "actionable": 3,
                "efficacy": "x",
                "safety": {"polarity": "very", "span": 5},
            }
        ),
    )
    assert out["signal_type"] in {"efficacy", "safety", "none", "trial_update"}
    assert prediction_errors(out, PUBMED["text"]) == []


def test_rules_only_needs_no_server():
    out = classify_item(PUBMED, use_model=False)
    assert out["_meta"]["method"] == "rule" and out["_meta"]["model"] is None
    assert set(ASPECTS) <= set(out)


def test_malformed_item_never_raises():
    out = classify_item({"item_id": "BAD", "source": "fda_event", "text": None})
    assert out["signal_type"] in {"none", "safety"}


def test_locate_span_contract():
    t = NEWS["text"]
    s, e = locate_span("PAYERS say they worry about the price", t)
    assert t[s:e] == "Payers say they worry about the price"
    assert locate_span("nothing like this", t) is None


def test_transcript_takes_model_speaker_with_hcp_default():
    item = {
        "item_id": "PT-0001",
        "source": "transcript",
        "product": "A",
        "title": "",
        "text": "I find osimertinib very well tolerated in my clinic. "
        "Patients like the oral dosing.",
    }
    raw = {
        "signal_type": "expert_opinion",
        "actionable": "no",
        "safety": {"polarity": 1, "speaker": "hcp", "span": "osimertinib very well tolerated"},
        "convenience": {
            "polarity": 1,
            "speaker": "nobody",
            "span": "Patients like the oral dosing",
        },
    }
    out = classify_item(item, model_fn=fake_model(raw), policy=POLICIES["full"])
    assert out["safety"]["speaker"] == "hcp" and out["convenience"]["speaker"] == "hcp"


def test_hybrid_moves_short_numeric_stub_to_later_clause():
    item = {
        "item_id": "PM-SHIFT",
        "source": "pubmed",
        "product": "A",
        "title": "Osimertinib outcomes",
        "text": (
            "ORR reached 67% (95% CI 50 to 80). "
            "Treatment was significantly better for patients who continued therapy."
        ),
    }
    raw = {
        "signal_type": "efficacy",
        "actionable": "yes",
        "efficacy": {
            "polarity": 1,
            "speaker": "researcher",
            "span": "ORR reached 67% (95% CI 50 to 80)",
        },
    }
    out = classify_item(item, model_fn=fake_model(raw))
    assert out["efficacy"]["span"] == (
        "Treatment was significantly better for patients who continued therapy"
    )
    assert out["efficacy"]["span"] in item["text"]
    assert prediction_errors(out, item["text"]) == []


def test_default_hybrid_policy_keeps_rules_where_explicit():
    raw = {
        "signal_type": "regulatory",
        "actionable": "no",
        "efficacy": {"polarity": 2, "span": "osimertinib significantly prolonged PFS"},
        "evidence_quality": {"polarity": -1, "span": "This was a retrospective cohort"},
    }
    out = classify_item(PUBMED, model_fn=fake_model(raw))
    # pubmed: signal and actionable from rules (phase 3 title -> actionable yes)
    assert out["signal_type"] == "efficacy" and out["actionable"] == "yes"
    assert out["efficacy"]["polarity"] == 2
    assert out["evidence_quality"] is None  # hybrid keeps efficacy + safety only


def test_guide_anchors_make_polarity_milder():
    raw = {
        "signal_type": "efficacy",
        "actionable": "no",
        "efficacy": {"polarity": 2, "span": "Toxicity was manageable"},
        "safety": {"polarity": -2, "span": "Toxicity was manageable"},
        "evidence_quality": {"polarity": 1, "span": "This was a retrospective cohort"},
        "convenience": {"polarity": 0, "span": "none"},
    }
    out = classify_item(PUBMED, model_fn=fake_model(raw), policy=POLICIES["full"])
    assert out["efficacy"]["polarity"] == 1  # +2 needs a strong cue
    assert out["safety"]["polarity"] == -1  # -2 needs a strong cue
    assert out["evidence_quality"]["polarity"] == -1  # author caveat anchor
    assert out["convenience"] is None  # placeholder span
