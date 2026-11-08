"""Pubmed author caveats -> evidence_quality. Invented sentences built around the guide's caveat phrases."""

from __future__ import annotations

import pytest

from pipeline.rules import apply_rules, evidence_caveat


@pytest.mark.parametrize(
    ("text", "span"),
    [
        (
            "Methods: the team ran a retrospective cohort study of 52 invented cases.",
            "retrospective cohort study",
        ),
        (
            "The present study retrospectively analyzed frontline treatments.",
            "retrospectively analyzed",
        ),
        (
            "Survival missed significance in this toy example, possibly due to immature data.",
            "possibly due to immature data",
        ),
        ("Results are limited by a small sample size.", "small sample size"),
        ("This single-center study enrolled 40 patients.", "single-center study"),
        (
            "Further prospective studies are needed to confirm this.",
            "Further prospective studies are needed",
        ),
        ("Longer follow-up is needed to assess survival.", "Longer follow-up is needed"),
    ],
)
def test_caveat_phrases_give_minus_one_with_the_shortest_span(text: str, span: str) -> None:
    out = evidence_caveat(text)
    assert out == (-1, span)
    assert out[1] in text


def test_clause_cue_keeps_the_limiting_clause() -> None:
    text = "Median PFS was longer, although early unblinding prevented the authors demonstrating a survival gain."
    pol, span = evidence_caveat(text) or (None, "")
    assert pol == -1
    assert (
        span in text and "prevented the authors demonstrating" in span and "Median PFS" not in span
    )


@pytest.mark.parametrize(
    "text",
    [
        "More testing of the doublet is not warranted for these subgroups.",  # efficacy call
        "Previous retrospective studies suggested a benefit; we ran a randomized trial.",
        "Real-world outcomes were compared between two cohorts.",
        "Enrollment in trials was explored but limited by availability.",
        "This was a prospective, not retrospective, analysis of the phase 3 trial.",
        "Osimertinib significantly prolonged progression-free survival.",
    ],
)
def test_no_caveat_when_the_text_does_not_judge_its_own_evidence(text: str) -> None:
    assert evidence_caveat(text) is None


def test_design_strength_gives_plus_one() -> None:
    assert evidence_caveat("This well-designed randomized trial adds to the record.") == (
        1,
        "well-designed randomized",
    )


def _item(source: str, title: str, text: str) -> dict:
    return {"item_id": "X-1", "source": source, "product": "A", "title": title, "text": text}


def test_rule_fills_pubmed_evidence_quality_with_researcher_speaker() -> None:
    item = _item(
        "pubmed", "Osimertinib outcomes", "We report a retrospective analysis of 50 patients."
    )
    eq = apply_rules(item).prediction["evidence_quality"]
    assert eq == {"polarity": -1, "speaker": "researcher", "span": "retrospective analysis"}


@pytest.mark.parametrize(
    ("source", "title"),
    [
        ("news", "Osimertinib outcomes"),
        ("press_release", "Osimertinib outcomes"),
        ("pubmed", "Osimertinib in cell lines"),
    ],
)
def test_rule_skips_other_sources_and_lab_studies(source: str, title: str) -> None:
    item = _item(source, title, "A retrospective analysis in xenograft mice and cell lines.")
    assert apply_rules(item).prediction["evidence_quality"] is None
