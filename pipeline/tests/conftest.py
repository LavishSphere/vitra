"""Shared test helpers. Tests that read the organizer package skip when it is absent (CI)."""

from __future__ import annotations

from typing import Any

import pytest

from pipeline.data import DEV_GOLD, DEV_ITEMS, TEST_ITEMS, read_jsonl

HAVE_DATA = DEV_GOLD.exists() and DEV_ITEMS.exists() and TEST_ITEMS.exists()
needs_data = pytest.mark.skipif(not HAVE_DATA, reason="organizer package not present")


def load_or_empty(path) -> list[dict[str, Any]]:
    return read_jsonl(path) if path.exists() else []
