"""Checkpoint / resume for the predict CLI (no organizer data, no model)."""

from __future__ import annotations

import threading
from pathlib import Path

from pipeline.predict import (
    append_checkpoint,
    checkpoint_path,
    load_checkpoint,
    predict_items,
    rewrite_checkpoint,
)
from pipeline.schema import public_prediction

ITEMS = [
    {"item_id": "A", "source": "news", "text": "Tagrisso helped in clinic today."},
    {"item_id": "B", "source": "news", "text": "Rybrevant rash was discussed."},
    {"item_id": "C", "source": "news", "text": "Access and cost came up on the call."},
]


def _fake(item, pool):  # noqa: ANN001
    return (
        {
            "item_id": item["item_id"],
            "signal_type": "other",
            "actionable": False,
            "efficacy": None,
            "safety": None,
            "convenience": None,
            "access_cost": None,
            "evidence_quality": None,
        },
        {"model": "fake", "prompt_version": "test", "latency_ms": 1},
    )


def test_checkpoint_roundtrip(tmp_path: Path) -> None:
    ckpt = tmp_path / "out.jsonl.ckpt.jsonl"
    lock = threading.Lock()
    row = {"item_id": "A", "signal_type": "other", "actionable": False}
    append_checkpoint(ckpt, row, lock)
    append_checkpoint(ckpt, {**row, "item_id": "B"}, lock)
    loaded = load_checkpoint(ckpt)
    assert set(loaded) == {"A", "B"}


def test_resume_skips_checkpointed(tmp_path: Path) -> None:
    ckpt = checkpoint_path(tmp_path / "pred.jsonl")
    calls: list[str] = []

    def model_fn(item, pool):  # noqa: ANN001
        calls.append(item["item_id"])
        raw, info = _fake(item, pool)
        return raw, info

    first = predict_items(
        ITEMS[:2],
        use_model=True,
        workers=2,
        model_fn=model_fn,
        checkpoint=ckpt,
    )
    assert {r["item_id"] for r in first} == {"A", "B"}
    assert set(calls) == {"A", "B"}

    calls.clear()
    prior = load_checkpoint(ckpt)
    second = predict_items(
        ITEMS,
        use_model=True,
        workers=2,
        model_fn=model_fn,
        checkpoint=ckpt,
        prior=prior,
    )
    assert [r["item_id"] for r in second] == ["A", "B", "C"]
    assert calls == ["C"]
    assert all("item_id" in public_prediction(r) for r in second)
    rewrite_checkpoint(ckpt, second)
    assert set(load_checkpoint(ckpt)) == {"A", "B", "C"}
