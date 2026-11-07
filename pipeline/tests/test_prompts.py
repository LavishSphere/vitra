"""Prompt shape. No model server and no organizer data."""

from __future__ import annotations

import json

from pipeline.prompts import N_FEWSHOT, N_FEWSHOT_TRANSCRIPT, build_messages, fewshot_k
from pipeline.schema import ASPECTS

SPAN = "significantly improved progression-free survival"


def _example(item_id: str, source: str, aspect: str) -> dict:
    text = (
        f"Invented {source} note {item_id}. The oral tablet was easier than the infusion. "
        f"A clinician said the result {SPAN}."
    )
    row: dict = {
        "item_id": item_id,
        "source": source,
        "product": "A",
        "title": "Synthetic labeled note",
        "text": text,
        "signal_type": aspect if aspect in ("efficacy", "safety") else "expert_opinion",
        "actionable": "no",
    }
    for name in ASPECTS:
        row[name] = None
    row[aspect] = {"span": SPAN, "polarity": 1, "speaker": "hcp"}
    return row


POOL = [
    _example("EX-1", "pubmed", "efficacy"),
    _example("EX-2", "pubmed", "safety"),
    _example("EX-3", "pubmed", "convenience"),
    _example("EX-4", "news", "efficacy"),
    _example("EX-5", "press_release", "access_cost"),
]

TRANSCRIPT = {
    "item_id": "SYN-T",
    "source": "transcript",
    "product": "both",
    "title": "Synthetic transcript",
    "published": "2026-11-07",
    "text": (
        "SYNTHETIC board note. An invented oncologist said the oral tablet was easier "
        "than the infusion, and that the result significantly improved progression-free survival."
    ),
}

PUBMED = {
    "item_id": "SYN-P",
    "source": "pubmed",
    "product": "A",
    "title": "Synthetic abstract",
    "published": "2026-11-07",
    "text": "Invented abstract. The oral tablet was easier than the infusion in this cohort.",
}


def test_fewshot_k_is_one_for_transcripts_and_three_for_scored_sources():
    assert N_FEWSHOT_TRANSCRIPT == 1
    assert N_FEWSHOT == 3
    assert fewshot_k("transcript") == 1
    assert fewshot_k("pubmed") == 3
    assert fewshot_k("news") == 3
    assert fewshot_k("press_release") == 3


def test_transcript_prompt_carries_one_example_and_copies_its_span():
    msgs = build_messages(TRANSCRIPT, POOL)
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert TRANSCRIPT["text"] in msgs[-1]["content"]
    payload = json.loads(msgs[2]["content"])
    copied = [block["span"] for name, block in payload.items() if name in ASPECTS and block]
    assert copied
    assert all(span in msgs[1]["content"] for span in copied)


def test_pubmed_prompt_keeps_three_examples():
    msgs = build_messages(PUBMED, POOL)
    assert sum(m["role"] == "assistant" for m in msgs) == 3
    assert len(msgs) == 1 + 3 * 2 + 1


def test_transcript_without_a_pool_has_no_example():
    msgs = build_messages(TRANSCRIPT, [])
    assert [m["role"] for m in msgs] == ["system", "user"]
