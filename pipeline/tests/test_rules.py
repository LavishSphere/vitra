import pytest

from pipeline.data import DEV_GOLD, DEV_ITEMS, as_item, by_id
from pipeline.rules import apply_rules, speaker_for
from pipeline.schema import ASPECTS, prediction_errors
from pipeline.tests.conftest import load_or_empty, needs_data

GOLD = load_or_empty(DEV_GOLD)
ITEMS = by_id(load_or_empty(DEV_ITEMS))
RULE_SOURCES = {"ctgov", "fda_event", "fda_label", "fda_notice"}


@pytest.mark.parametrize(
    "g", [g for g in GOLD if g["source"] in RULE_SOURCES], ids=lambda g: g["item_id"]
)
def test_rule_sources_match_dev_gold_labels(g):
    res = apply_rules(as_item(ITEMS[g["item_id"]]))
    p = res.prediction
    assert res.final
    assert p["signal_type"] == g["signal_type"]
    assert p["actionable"] == g["actionable"]
    for a in ASPECTS:
        assert bool(p[a]) == bool(g[a]), a
        if g[a]:
            assert p[a]["polarity"] == g[a]["polarity"]
            assert p[a]["speaker"] == g[a]["speaker"]


@pytest.mark.parametrize("g", GOLD, ids=lambda g: g["item_id"])
def test_every_rule_prediction_is_valid(g):
    it = as_item(ITEMS[g["item_id"]])
    assert prediction_errors(apply_rules(it).prediction, it["text"]) == []


@needs_data
def test_speaker_by_source():
    for g in GOLD:
        if g["source"] == "news":
            continue
        for a in ASPECTS:
            if g[a]:
                assert speaker_for(ITEMS[g["item_id"]]) == g[a]["speaker"], g["item_id"]


def _evt(reactions: str, reporter: str = "physician") -> dict:
    return {
        "item_id": "X",
        "source": "fda_event",
        "text": f"Suspect product: osimertinib. Reactions: {reactions}. "
        f"Serious: yes; outcome: death. Reporter: {reporter}.",
    }


def test_fda_event_special_reactions():
    p = apply_rules(_evt("Off label use")).prediction
    assert p["safety"] is None and p["signal_type"] == "safety" and p["actionable"] == "no"
    p = apply_rules(_evt("Malignant neoplasm progression, Rash", "consumer")).prediction
    assert p["efficacy"] == {
        "polarity": -1,
        "speaker": "patient",
        "span": "Malignant neoplasm progression",
    }
    assert p["safety"]["span"] == "Rash"
    p = apply_rules(_evt("Inability to afford medication")).prediction
    assert p["access_cost"]["polarity"] == -1 and p["safety"] is None
    p = apply_rules(
        _evt("Death, Pneumonitis, Off label use, Skin fragility", "pharmacist")
    ).prediction
    assert p["safety"] == {"polarity": -1, "speaker": "hcp", "span": "Death, Pneumonitis"}


def _ct(status_part: str, phase: str = "PHASE2") -> dict:
    return {
        "item_id": "C",
        "source": "ctgov",
        "product": "A",
        "text": f"NCT0 · {phase} · Sponsor: X. Title. {status_part} "
        "Interventions: Osimertinib. Results posted: no.",
    }


def test_ctgov_stop_reasons():
    p = apply_rules(
        _ct(
            "Status as of last update (2025-01-01): TERMINATED. "
            'Reason given: "Terminated for futility at interim".'
        )
    ).prediction
    assert p["efficacy"]["polarity"] == -2 and p["actionable"] == "yes" and p["safety"] is None
    p = apply_rules(
        _ct(
            "Status as of last update (2025-01-01): TERMINATED. "
            'Reason given: "Sponsor decision, not related to safety concerns".'
        )
    ).prediction
    assert p["safety"] is None and p["efficacy"] is None
    p = apply_rules(
        _ct("New registration first posted on 2026-01-01. Status: RECRUITING.", "PHASE3")
    ).prediction
    assert p["actionable"] == "yes"
    p = apply_rules(_ct("Status as of last update (2025-01-01): COMPLETED.", "PHASE3")).prediction
    assert p["actionable"] == "no"


def test_earnings_release_ruling_5():
    it = {
        "item_id": "P",
        "source": "press_release",
        "title": "Johnson & Johnson Reports Q3 2026 Results",
        "text": "RYBREVANT sales grew.",
    }
    res = apply_rules(it)
    assert res.final and res.prediction["signal_type"] == "competitor_move"
    assert all(res.prediction[a] is None for a in ASPECTS)
