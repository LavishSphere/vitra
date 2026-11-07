"""Few-shot example selection: deterministic, never the item itself, never its own fold."""

from __future__ import annotations

import random

import pytest

from pipeline.data import DEV_GOLD, DEV_ITEMS, as_item, read_jsonl
from pipeline.evaluate import assign_folds
from pipeline.prompts import FEWSHOT_METHODS, fewshot_method, select_fewshot
from pipeline.schema import ASPECTS
from pipeline.tests.conftest import needs_data


def _row(item_id: str, source: str, title: str, text: str, signal: str = "efficacy") -> dict:
    row = {
        "item_id": item_id,
        "source": source,
        "product": "A",
        "title": title,
        "text": text,
        "signal_type": signal,
        "actionable": "no",
    }
    for a in ASPECTS:
        row[a] = None
    return row


QUERY = _row("Q-1", "news", "Osimertinib survival update", "Osimertinib overall survival data.")
POOL = [
    QUERY,  # the item itself must never come back
    _row("P-1", "press_release", "Osimertinib survival update", "Osimertinib overall survival."),
    _row("N-1", "news", "Amivantamab price", "Payers discuss amivantamab price.", "access_pricing"),
    _row("N-2", "news", "Osimertinib survival", "Osimertinib survival news.", "efficacy"),
    _row("N-3", "news", "Osimertinib survival trial", "Osimertinib overall survival.", "efficacy"),
    _row("N-4", "news", "Osimertinib survival again", "Osimertinib overall survival.", "efficacy"),
    _row("M-1", "pubmed", "Osimertinib survival update", "Osimertinib overall survival data."),
]


def _ids(rows: list[dict]) -> list[str]:
    return [r["item_id"] for r in rows]


@pytest.mark.parametrize("method", FEWSHOT_METHODS)
def test_selection_is_deterministic_and_order_free(method: str) -> None:
    first = _ids(select_fewshot(QUERY, POOL, 3, method))
    shuffled = POOL[:]
    random.Random(7).shuffle(shuffled)
    assert _ids(select_fewshot(QUERY, POOL, 3, method)) == first
    assert _ids(select_fewshot(QUERY, shuffled, 3, method)) == first


@pytest.mark.parametrize("method", FEWSHOT_METHODS)
def test_never_selects_the_item_or_an_incompatible_source(method: str) -> None:
    chosen = _ids(select_fewshot(QUERY, POOL, 3, method))
    assert "Q-1" not in chosen
    assert "M-1" not in chosen  # pubmed is not an example source for news
    assert len(chosen) == 3


def test_tfidf_prefers_the_same_source_and_caps_each_signal_at_two() -> None:
    chosen = select_fewshot(QUERY, POOL, 3, "tfidf")
    assert [r["source"] for r in chosen[:2]] == ["news", "news"]
    assert sum(r["signal_type"] == "efficacy" for r in chosen) <= 2


def test_unknown_method_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VITRA_FEWSHOT_METHOD", "bogus")
    assert fewshot_method() == "jaccard"
    monkeypatch.setenv("VITRA_FEWSHOT_METHOD", "tfidf")
    assert fewshot_method() == "tfidf"


@needs_data
@pytest.mark.parametrize("method", FEWSHOT_METHODS)
def test_dev_folds_never_leak_into_examples(method: str) -> None:
    gold = read_jsonl(DEV_GOLD)
    folds = assign_folds(gold, 5)
    items = {r["item_id"]: as_item(r) for r in read_jsonl(DEV_ITEMS)}
    for g in gold:
        fold = folds[g["item_id"]]
        pool = [p for p in gold if folds[p["item_id"]] != fold]
        chosen = select_fewshot(items[g["item_id"]], pool, 3, method)
        assert all(folds[c["item_id"]] != fold for c in chosen)
        assert g["item_id"] not in _ids(chosen)
