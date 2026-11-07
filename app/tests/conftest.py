"""Shared fixtures: a tiny SYNTHETIC package (invented text, SYN- ids).

The unit and API tests never read the organizer package, so they run from a
clean clone. Weeks used: 2025-W10 (Mon 2025-03-03) through 2025-W14.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.data import EvidenceStore
from app.models import EvidenceItem

ASPECT_KEYS = ("efficacy", "safety", "convenience", "access_cost", "evidence_quality")
TEST_TOKEN = "test-token-0123456789abcdef"
BASE_URL = "http://127.0.0.1:8000"


def _item(
    iid: str, source: str, product: str, published: str, title: str, text: str
) -> dict[str, Any]:
    return {
        "item_id": iid,
        "source": source,
        "source_id": iid,
        "url": f"https://example.invalid/{iid}",
        "published": published,
        "product": product,
        "title": title,
        "text": text,
        "text_sha256": "x",
    }


def _label(
    iid: str, signal: str, actionable: str, **aspects: tuple[int, str, str]
) -> dict[str, Any]:
    row: dict[str, Any] = {"item_id": iid, "signal_type": signal, "actionable": actionable}
    for k in ASPECT_KEYS:
        v = aspects.get(k)
        row[k] = None if v is None else {"polarity": v[0], "speaker": v[1], "span": v[2]}
    return row


DEV_ITEMS = [
    _item(
        "SYN-0001",
        "pubmed",
        "A",
        "2025-03-03",
        "Synthetic trial reports longer survival",
        "Invented abstract. Drug A extended survival by a wide margin in this made-up cohort.",
    ),
    _item(
        "SYN-0002",
        "news",
        "A",
        "2025-03-05",
        "Synthetic news on drug A",
        "A made-up outlet said drug A worked well but some patients had mild rash.",
    ),
    _item(
        "SYN-0003",
        "fda_label",
        "A",
        "2025-03-17",
        "Synthetic label update",
        "Invented label text. Warning: severe lung inflammation was reported.",
    ),
    _item(
        "SYN-0004",
        "press_release",
        "B",
        "2025-03-18",
        "Synthetic company news for drug B",
        "The fictional company announced drug B met its primary endpoint.",
    ),
    _item(
        "SYN-0005",
        "ctgov",
        "B",
        "2025-03-31",
        "Synthetic registry entry",
        "NCT00000000. Status: RECRUITING. Nothing judged here.",
    ),
    _item(
        "SYN-0006",
        "pubmed",
        "A",
        "2025-03-12",
        "Synthetic paper with a bad quote",
        "This invented abstract has no matching phrase for its label.",
    ),
]
DEV_GOLD = [
    _label(
        "SYN-0001",
        "efficacy",
        "yes",
        efficacy=(2, "researcher", "extended survival by a wide margin"),
    ),
    _label(
        "SYN-0002",
        "efficacy",
        "no",
        efficacy=(1, "media", "drug A worked well"),
        safety=(-1, "media", "some patients had mild rash"),
    ),
    _label(
        "SYN-0003",
        "regulatory",
        "yes",
        safety=(-2, "regulator", "severe lung inflammation was reported"),
    ),
    _label(
        "SYN-0004", "efficacy", "yes", efficacy=(2, "company", "drug B met its primary endpoint")
    ),
    _label("SYN-0005", "trial_update", "no"),
    _label(
        "SYN-0006",
        "efficacy",
        "yes",
        efficacy=(1, "researcher", "a phrase that is not in the text"),
    ),
]
UNLABELED_ITEMS = [
    _item(
        "SYN-0101",
        "news",
        "A",
        "2025-03-11",
        "Synthetic doctor quote",
        "An invented oncologist warned the rash can be serious.",
    ),
    _item(
        "SYN-0102",
        "pubmed",
        "A",
        "2025-03-10",
        "Synthetic negative study",
        "In this made-up study drug A showed shorter benefit than hoped.",
    ),
    _item(
        "SYN-0103",
        "news",
        "A",
        "2025-03-12",
        "Synthetic neutral item",
        "A fictional writer said the benefit of drug A was unchanged.",
    ),
    _item(
        "SYN-0104",
        "news",
        "both",
        "2025-03-31",
        "Synthetic payer note",
        "An invented insurer said both drugs cost too much.",
    ),
]
PREDICTIONS = [
    {
        **_label("SYN-0101", "safety", "no", safety=(-2, "hcp", "the rash can be serious")),
        "_meta": {"method": "model"},
    },
    {
        **_label(
            "SYN-0102",
            "efficacy",
            "no",
            efficacy=(-1, "researcher", "showed shorter benefit than hoped"),
        ),
        "_meta": {"method": "mixed"},
    },
    _label(
        "SYN-0103", "efficacy", "no", efficacy=(0, "media", "the benefit of drug A was unchanged")
    ),
    {
        **_label(
            "SYN-0104",
            "access_pricing",
            "yes",
            access_cost=(-2, "payer", "both drugs cost too much"),
        ),
        "_meta": {"method": "model"},
    },
    # Covered by gold, so this prediction must be ignored.
    {
        **_label("SYN-0001", "safety", "no", safety=(-2, "media", "Drug A")),
        "_meta": {"method": "model"},
    },
    # Unknown id: skipped and counted.
    _label("SYN-9999", "none", "no"),
]


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


@pytest.fixture()
def synthetic_settings(tmp_path: Path) -> Settings:
    pkg = tmp_path / "pkg"
    _write_jsonl(
        pkg / "data" / "dev.full.jsonl",
        [{**i, **g} for i, g in zip(DEV_ITEMS, DEV_GOLD, strict=True)],
    )
    _write_jsonl(
        pkg / "data" / "dev.jsonl", [{**i, **g} for i, g in zip(DEV_ITEMS, DEV_GOLD, strict=True)]
    )
    _write_jsonl(pkg / "data" / "unlabeled.full.jsonl", UNLABELED_ITEMS)
    preds = tmp_path / "predictions"
    _write_jsonl(preds / "unlabeled.jsonl", PREDICTIONS)
    return Settings(
        package_dir=pkg, predictions_dir=preds, token=TEST_TOKEN, llm_url="http://127.0.0.1:1"
    )  # port 1: nothing listens, so health says model_loaded false


@pytest.fixture()
def store(synthetic_settings: Settings) -> EvidenceStore:
    s = EvidenceStore(synthetic_settings)
    s.load()
    return s


@pytest.fixture()
def evidence(store: EvidenceStore) -> list[EvidenceItem]:
    return store.raw()


@pytest.fixture()
def by_id(store: EvidenceStore) -> dict[str, EvidenceItem]:
    return {e.item_id: e for e in store.annotated()}


class FakePipeline:
    """Stands in for pipeline.api; the real model server is never contacted in tests."""

    def __init__(self, respond: Any) -> None:
        self.respond = respond
        self.calls = 0

    def classify_item(self, item: dict[str, Any], *, use_model: bool = True) -> dict[str, Any]:
        self.calls += 1
        return self.respond(item)


def make_client(settings: Settings, pipeline: Any = None, **kw: Any) -> Any:
    # Imported here so the pure evidence/trends tests don't need the HTTP layer.
    from fastapi.testclient import TestClient

    from app.main import create_app

    loader = (lambda: pipeline) if pipeline is not None else _missing_pipeline
    app = create_app(settings, pipeline_loader=loader)
    return TestClient(app, base_url=BASE_URL, **kw)


def _missing_pipeline() -> Any:
    raise ModuleNotFoundError("No module named 'pipeline.api'")


@pytest.fixture()
def client(synthetic_settings: Settings):
    with make_client(synthetic_settings) as c:
        c.headers["X-Vitra-Token"] = TEST_TOKEN
        yield c
