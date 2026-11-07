"""Undo a pasted transcript: DELETE /api/intake/{item_id} restores the baseline exactly.

All transcripts here are invented. The classifier is a fake; the model server is
never contacted.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.tests.conftest import TEST_TOKEN, FakePipeline, make_client
from app.tests.test_intake import PHRASE, TRANSCRIPT, good

OTHER_PHRASE = "heron-umber-synthetic-phrase-9902"
OTHER = (
    f"SYNTHETIC payer call. An invented insurer said the copay was far too high. "
    f"Marker {OTHER_PHRASE}."
)


def other(item: dict[str, Any]) -> dict[str, Any]:
    pred = good(item)
    return {
        **pred,
        "signal_type": "access_pricing",
        "convenience": None,
        "safety": None,
        "access_cost": {"polarity": -2, "speaker": "payer", "span": "the copay was far too high"},
        "_meta": {**pred["_meta"], "dropped_spans": []},
    }


def respond(item: dict[str, Any]) -> dict[str, Any]:
    return other(item) if OTHER_PHRASE in item["text"] else good(item)


# Every view the UI shows, with and without filters, so "exactly equal" covers them all.
VIEWS: list[tuple[str, dict[str, str]]] = [
    ("/api/trends", {}),
    ("/api/trends", {"product": "B", "aspect": "convenience", "speaker": "hcp"}),
    ("/api/trends", {"aspect": "all", "speaker": "all"}),
    ("/api/insights", {}),
    ("/api/insights", {"product": "B"}),
    ("/api/gaps", {}),
    ("/api/gaps", {"window_weeks": "4", "max_items": "1"}),
    ("/api/evidence", {}),
]


def snapshot(c: TestClient) -> dict[str, Any]:
    state: dict[str, Any] = {}
    for path, params in VIEWS:
        r = c.get(path, params=params)
        assert r.status_code == 200, (path, r.text)
        state[f"{path}?{sorted(params.items())}"] = r.json()
    state["n_items"] = c.get("/api/health").json()["n_items"]
    return state


def _client(settings: Settings) -> TestClient:
    c = make_client(settings, FakePipeline(respond))
    c.headers["X-Vitra-Token"] = TEST_TOKEN
    return c


def _intake(c: TestClient, text: str = TRANSCRIPT, product: str = "B") -> str:
    body = c.post("/api/intake", json={"text": text, "product": product}).json()
    assert body["status"] == "complete", body
    return body["evidence"]["item_id"]


def test_undo_restores_baseline_exactly(synthetic_settings: Settings) -> None:
    with _client(synthetic_settings) as c:
        baseline = snapshot(c)
        iid = _intake(c)
        assert iid.startswith("PT-")
        changed = snapshot(c)
        for key in (
            "/api/trends?[]",
            "/api/insights?[]",
            "/api/gaps?[]",
            "/api/evidence?[]",
            "n_items",
        ):
            assert changed[key] != baseline[key], key

        r = c.delete(f"/api/intake/{iid}")
        assert r.status_code == 200
        assert r.json() == {"ok": True, "removed": iid, "trends_changed": True}
        assert snapshot(c) == baseline
        assert c.get(f"/api/evidence/{iid}").status_code == 404
        # A second undo of the same id has nothing to remove.
        assert c.delete(f"/api/intake/{iid}").status_code == 404


def test_unknown_id_is_404(synthetic_settings: Settings) -> None:
    with _client(synthetic_settings) as c:
        baseline = snapshot(c)
        for iid in ("PT-9999", "nope", "SYN-0001"):  # base evidence is never removable
            r = c.delete(f"/api/intake/{iid}")
            assert r.status_code == 404
            assert r.json() == {"detail": "no held transcript with that id"}
        assert snapshot(c) == baseline


def test_token_required(synthetic_settings: Settings) -> None:
    with _client(synthetic_settings) as c:
        iid = _intake(c)
        del c.headers["X-Vitra-Token"]
        assert c.delete(f"/api/intake/{iid}").status_code == 401
        bad = {"X-Vitra-Token": "wrong-token-value-123"}
        assert c.delete(f"/api/intake/{iid}", headers=bad).status_code == 401
        # Still held after the refused attempts.
        ok = {"X-Vitra-Token": TEST_TOKEN}
        assert c.get(f"/api/evidence/{iid}", headers=ok).status_code == 200
        assert c.delete(f"/api/intake/{iid}", headers=ok).status_code == 200


def test_two_transcripts_delete_one_keeps_the_other(synthetic_settings: Settings) -> None:
    with _client(synthetic_settings) as c:
        baseline = snapshot(c)
        first = _intake(c)
        second = _intake(c, OTHER, product="A")
        assert first != second

        assert c.delete(f"/api/intake/{first}").json()["removed"] == first
        assert c.get(f"/api/evidence/{first}").status_code == 404
        kept = c.get(f"/api/evidence/{second}").json()
        assert kept["aspects"][0]["span"] == "the copay was far too high"
        assert c.get("/api/health").json()["n_items"] == baseline["n_items"] + 1
        ids = {e["item_id"] for e in c.get("/api/evidence").json()}
        assert second in ids and first not in ids
        cells = c.get("/api/trends", params={"aspect": "access_cost", "speaker": "payer"}).json()
        assert any(second in cell["item_ids"] for cell in cells)
        assert not any(first in cell["item_ids"] for cell in c.get("/api/trends").json())

        assert c.delete(f"/api/intake/{second}").json()["trends_changed"] is True
        assert snapshot(c) == baseline


def test_dev_web_origin_may_send_delete(synthetic_settings: Settings) -> None:
    with _client(synthetic_settings) as c:
        r = c.options(
            "/api/intake/PT-0001",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "x-vitra-token",
            },
        )
        assert r.status_code == 200
        assert "DELETE" in r.headers["access-control-allow-methods"]


def test_no_transcript_text_in_logs(
    synthetic_settings: Settings,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)  # every logger, every level
    with _client(synthetic_settings) as c:
        a = _intake(c)
        b = _intake(c, OTHER, product="A")
        assert c.delete(f"/api/intake/{a}").status_code == 200
        assert c.delete("/api/intake/PT-9999").status_code == 404
        assert c.delete(f"/api/intake/{b}").status_code == 200
    out, err = capfd.readouterr()
    logged = caplog.text + out + err
    assert f"DELETE /api/intake/{a} -> 200" in caplog.text  # the request itself is logged...
    for secret in (PHRASE, OTHER_PHRASE, "much easier for patients", "copay was far too high"):
        assert secret not in logged  # ...but never what the transcript said
