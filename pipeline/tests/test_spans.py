import random

import pytest

from pipeline.data import DEV_GOLD, DEV_ITEMS, by_id
from pipeline.schema import ASPECTS
from pipeline.spans import locate_span, sentence_bounds, shift_later_clause, snap_span
from pipeline.tests.conftest import load_or_empty, needs_data

TEXT = (
    "Osimertinib showed a manageable safety profile. The median PFS was 18.9 months… "
    "Grade ≥3 adverse events occurred in 12% of patients; ILD was rare."
)


def _dev_pairs():
    items = by_id(load_or_empty(DEV_ITEMS))
    for g in load_or_empty(DEV_GOLD):
        for a in ASPECTS:
            if g.get(a):
                yield g["item_id"], a, g[a]["span"], items[g["item_id"]]["text"]


@pytest.mark.parametrize("iid,asp,span,text", list(_dev_pairs()))
def test_every_dev_gold_span_snaps_to_itself(iid, asp, span, text):
    assert span in text
    s, e = locate_span(span, text)
    assert text[s:e] == span, (iid, asp)


def test_exact_case_whitespace_and_fuzzy():
    assert snap_span("a manageable safety profile", TEXT) == "a manageable safety profile"
    assert snap_span("A MANAGEABLE safety profile", TEXT) == "a manageable safety profile"
    assert snap_span("a  manageable\nsafety   profile", TEXT) == "a manageable safety profile"
    assert snap_span("“a manageable safety profile.”", TEXT) == "a manageable safety profile"
    assert (
        snap_span("osimertinib showed manageable safety profile", TEXT)
        == "Osimertinib showed a manageable safety profile"
    )


def test_never_crosses_ellipsis_or_sentence():
    out = snap_span("The median PFS was 18.9 months… Grade ≥3 adverse events occurred", TEXT)
    assert out is not None and "…" not in out
    out = snap_span("safety profile. The median PFS", TEXT)
    assert out is not None and ". " not in out


def test_unverifiable_returns_none():
    assert locate_span("completely unrelated invented quote about tiramisu", TEXT) is None
    assert locate_span("", TEXT) is None
    assert locate_span("anything", "") is None


@needs_data
def test_random_snippets_are_invariant():
    rng = random.Random(7)
    texts = [it["text"] for it in load_or_empty(DEV_ITEMS) if it.get("text")]
    for _ in range(300):
        t = rng.choice(texts)
        bounds = sentence_bounds(t)
        s0, e0 = rng.choice(bounds)
        words = t[s0:e0].split()
        if len(words) < 3:
            continue
        i = rng.randrange(0, len(words) - 2)
        cand = " ".join(words[i : i + rng.randint(2, 8)])
        if rng.random() < 0.5:
            cand = cand.upper()
        out = snap_span(cand, t)
        if out is not None:
            assert out in t


def test_sentence_bounds_respect_abbreviations():
    t = "Results were reported by Smith et al. in 2024. Second sentence here."
    assert len(sentence_bounds(t)) == 2


def test_later_clause_shifts_a_short_numeric_stub():
    text = (
        "Response rate was 67% in cohort A. "
        "Treatment was significantly better for patients who continued therapy."
    )
    quote_end = text.index(".")
    stub_end = text.index("%") + 1
    start, end = shift_later_clause(text, 0, quote_end, 0, stub_end)
    got = text[start:end]
    assert got == "Treatment was significantly better for patients who continued therapy"
    assert got in text
    assert ". " not in got


def test_later_clause_keeps_a_longer_span_and_a_digit_free_sentence():
    text = (
        "Response rate was 67% in cohort A overall. "
        "Treatment was significantly better for patients who continued therapy."
    )
    quote_end = text.index(".")
    start, end = shift_later_clause(text, 0, quote_end, 0, quote_end)
    assert text[start:end] == "Response rate was 67% in cohort A overall"

    plain = "Response was high here. Treatment was significantly better for patients who continued."
    cut = plain.index(".")
    start, end = shift_later_clause(plain, 0, cut, 0, cut)
    assert plain[start:end] == "Response was high here"


def test_later_clause_skips_a_digit_sentence_and_prefers_a_judgment_piece():
    text = (
        "Response rate was 67% in cohort A. "
        "Grade 3 events were uncommon in follow up. "
        "Patients continued therapy and the benefit was durable for responders."
    )
    quote_end = text.index(".")
    stub_end = text.index("%") + 1
    start, end = shift_later_clause(text, 0, quote_end, 0, stub_end)
    assert text[start:end] == "the benefit was durable for responders"
    assert text[start:end] in text


def test_later_clause_uses_first_digit_free_piece_without_a_judgment_word():
    text = "Response rate was 67% in cohort A. Patients stayed on treatment through the full year."
    start, end = shift_later_clause(text, 0, text.index("."), 0, text.index("%") + 1)
    assert text[start:end] == "Patients stayed on treatment through the full year"


def test_later_clause_keeps_the_stub_when_nothing_later_qualifies():
    text = "Response rate was 67% in cohort A. See Table 2 for the listing."
    start, end = shift_later_clause(text, 0, text.index("."), 0, text.index("%") + 1)
    assert text[start:end] == "Response rate was 67%"
