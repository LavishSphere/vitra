"""Paths and JSONL loading for the organizer package."""

from __future__ import annotations

import json
import os
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = Path(
    os.environ.get("VITRA_PACKAGE_DIR", REPO_ROOT / "starter" / "hackathon_package_2026-11-05")
)
DATA_DIR = PACKAGE_DIR / "data"
DEV_ITEMS = DATA_DIR / "dev.full.jsonl"
DEV_GOLD = DATA_DIR / "dev.jsonl"
TEST_ITEMS = DATA_DIR / "test_inputs.full.jsonl"
UNLABELED_ITEMS = DATA_DIR / "unlabeled.full.jsonl"
SCORER = PACKAGE_DIR / "scoring" / "score.py"
DERIVED_DIR = REPO_ROOT / "data" / "derived"

# Item fields; gold files carry these plus the labels.
ITEM_FIELDS = (
    "item_id",
    "source",
    "source_id",
    "url",
    "published",
    "product",
    "title",
    "text",
    "text_sha256",
)


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def iter_jsonl(path: str | Path) -> Iterator[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def write_jsonl(path: str | Path, rows: Iterable[dict[str, Any]]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def by_id(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {r["item_id"]: r for r in rows}


def as_item(row: dict[str, Any]) -> dict[str, Any]:
    """Keep only input fields, so gold labels can never leak into a prompt."""
    return {k: row.get(k) for k in ITEM_FIELDS}
