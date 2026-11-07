import random

import pytest

from pipeline.data import DEV_GOLD, DEV_ITEMS, by_id
from pipeline.schema import ASPECTS
from pipeline.spans import locate_span, sentence_bounds, snap_span
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
