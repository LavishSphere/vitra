"""Pubmed efficacy judgments from guide phrases. Synthetic abstracts, no package text."""

from __future__ import annotations

import pytest

from pipeline.api import POLICIES, classify_item
from pipeline.rules import apply_rules, efficacy_cue, safety_anchor


@pytest.mark.parametrize(
    ("text", "polarity", "span"),
    [
        (
            "RESULTS: Osimertinib significantly prolonged progression-free survival.",
            2,
            "Osimertinib significantly prolonged progression-free survival",
        ),
        (
            "Amivantamab showed encouraging activity in this cohort.",
            1,
            "Amivantamab showed encouraging activity in this cohort",
        ),
        (
            "Lazertinib did not meet its primary endpoint.",
            -1,
            "Lazertinib did not meet its primary endpoint",
        ),
        (
            "The osimertinib combination failed to improve overall survival.",
            -2,
            "The osimertinib combination failed to improve overall survival",
        ),
    ],
)
def test_guide_phrases_give_polarity_and_an_exact_span(text: str, polarity: int, span: str) -> None:
    out = efficacy_cue(text)
    assert out == (polarity, span)
    assert out[1] in text


def test_sentence_must_name_our_product() -> None:
    assert efficacy_cue("Chemotherapy significantly improved overall survival.") is None


def test_abbreviation_defined_for_our_regimen_counts_as_our_product() -> None:
    text = (
        "We studied amivantamab plus chemotherapy (ACP) in 90 patients. "
        "CONCLUSIONS: ACP was superior to standard care."
    )
    assert efficacy_cue(text) == (1, "ACP was superior to standard care")


def test_conclusions_are_read_before_results_and_background_is_skipped() -> None:
    text = (
        "BACKGROUND: Osimertinib significantly prolonged survival in earlier trials. "
        "RESULTS: Osimertinib significantly improved median PFS (8 vs 5 months). "
        "CONCLUSIONS: Osimertinib was superior to chemotherapy in this setting."
    )
    assert efficacy_cue(text) == (1, "Osimertinib was superior to chemotherapy in this setting")


def test_negated_cue_is_ignored() -> None:
    assert efficacy_cue("Osimertinib was not significantly improved over placebo.") is None


def test_lab_studies_get_no_rule_efficacy() -> None:
    item = {
        "item_id": "x",
        "source": "pubmed",
        "title": "Resistance in cell lines",
        "text": "In xenograft models, osimertinib significantly prolonged tumor control.",
    }
    assert apply_rules(item).prediction["efficacy"] is None


ITEM = {
    "item_id": "PM-T",
    "source": "pubmed",
    "product": "A",
    "title": "Osimertinib in a real-world cohort",
    "text": (
        "METHODS: We compared osimertinib with chemotherapy. "
        "RESULTS: Osimertinib-treated patients had significantly improved PFS (9 vs 4 months)."
    ),
}


def _model(raw: dict) -> object:
    return lambda item, pool: (raw, {"model": "fake", "prompt_version": "t"})


def _raw(efficacy: dict | None) -> dict:
    base = {a: None for a in ("safety", "convenience", "access_cost", "evidence_quality")}
    return {"signal_type": "efficacy", "actionable": "no", "efficacy": efficacy, **base}


@pytest.mark.parametrize(
    "efficacy",
    [None, {"span": "a phrase copied from somewhere else entirely", "polarity": 2}],
)
def test_rule_fills_efficacy_when_model_is_empty_or_unquotable(efficacy: dict | None) -> None:
    out = classify_item(ITEM, model_fn=_model(_raw(efficacy)), policy=POLICIES["hybrid-evq-eff"])
    assert out["efficacy"] == {
        "polarity": 2,
        "speaker": "researcher",
        "span": "Osimertinib-treated patients had significantly improved PFS",
    }
    assert out["efficacy"]["span"] in ITEM["text"]


def test_model_efficacy_wins_when_its_quote_is_valid() -> None:
    raw = _raw({"span": "We compared osimertinib with chemotherapy", "polarity": 0})
    out = classify_item(ITEM, model_fn=_model(raw), policy=POLICIES["hybrid-evq-eff"])
    assert out["efficacy"]["span"] == "We compared osimertinib with chemotherapy"


def test_previous_policy_keeps_model_only_efficacy() -> None:
    out = classify_item(ITEM, model_fn=_model(_raw(None)), policy=POLICIES["hybrid-evq"])
    assert out["efficacy"] is None


@pytest.mark.parametrize(
    ("text", "polarity", "span"),
    [
        ("Osimertinib had a manageable safety profile.", 1, "a manageable safety profile"),
        ("Amivantamab was well tolerated in all cohorts.", 1, "well tolerated"),
        ("Lazertinib showed no new safety signals.", 0, "no new safety signals"),
        (
            "Osimertinib safety was consistent with the known safety profile.",
            0,
            "consistent with the known safety profile",
        ),
    ],
)
def test_ruling_8_safety_anchors(text: str, polarity: int, span: str) -> None:
    assert safety_anchor(text) == (polarity, span)


def test_safety_anchor_needs_our_product_and_no_negation() -> None:
    assert safety_anchor("Docetaxel was well tolerated.") is None
    assert safety_anchor("Osimertinib was not well tolerated by older patients.") is None


SAFE_ITEM = {
    "item_id": "PM-S",
    "source": "pubmed",
    "product": "B",
    "title": "Amivantamab in practice",
    "text": (
        "METHODS: Baseline variables were adjusted using propensity scores. "
        "RESULTS: Amivantamab did not meet the primary endpoint. Amivantamab showed manageable safety."
    ),
}


def test_rule_guide_phrases_replace_the_model_quotes_in_eff2() -> None:
    raw = _raw({"span": "Baseline variables were adjusted using propensity scores", "polarity": 0})
    raw["safety"] = {
        "span": "Baseline variables were adjusted using propensity scores",
        "polarity": 1,
    }
    out = classify_item(SAFE_ITEM, model_fn=_model(raw), policy=POLICIES["hybrid-evq-eff2"])
    assert out["safety"]["span"] == "manageable safety"
    assert out["safety"]["polarity"] == 1
    assert out["efficacy"]["polarity"] == -1
    assert "did not meet" in out["efficacy"]["span"]
    for a in ("efficacy", "safety"):
        assert out[a]["span"] in SAFE_ITEM["text"]
    kept = classify_item(SAFE_ITEM, model_fn=_model(raw), policy=POLICIES["hybrid-evq-eff"])
    assert kept["safety"]["span"].startswith("Baseline variables")
