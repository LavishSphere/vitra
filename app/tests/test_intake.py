"""Transcript intake: verified spans or an explicit abstention, and no body in logs.

All transcripts here are invented. The classifier is a fake; the model server is
never contacted.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from app.config import Settings
from app.tests.conftest import TEST_TOKEN, FakePipeline, make_client

PHRASE = "zebra-cobalt-synthetic-phrase-4471"
TRANSCRIPT = (
    f"SYNTHETIC advisory board note. One invented oncologist said the new oral dosing "
    f"was much easier for patients. Marker {PHRASE}. Another said rash management was a concern."
)
EMPTY = {
    "efficacy": None,
    "safety": None,
    "convenience": None,
    "access_cost": None,
    "evidence_quality": None,
}


def _pred(
    item: dict[str, Any], meta: dict[str, Any] | None = None, **aspects: Any
) -> dict[str, Any]:
    return {
        "item_id": item["item_id"],
        "signal_type": "expert_opinion",
        "actionable": "yes",
        **EMPTY,
        **aspects,
        "_meta": {
            "method": "model",
            "model": "fake",
            "dropped_spans": [],
            "error": None,
            **(meta or {}),
        },
    }


def good(item: dict[str, Any]) -> dict[str, Any]:
    return _pred(
        item,
        convenience={"polarity": 2, "speaker": "hcp", "span": "much easier for patients"},
        safety={"polarity": -1, "speaker": "hcp", "span": "a quote the model invented"},
        meta={
            "dropped_spans": [
                {"aspect": "efficacy", "span": "made up", "reason": "span not verifiable"}
            ]
        },
    )


def nothing_verifiable(item: dict[str, Any]) -> dict[str, Any]:
    return _pred(item, safety={"polarity": -1, "speaker": "hcp", "span": "not in the transcript"})


def no_aspects(item: dict[str, Any]) -> dict[str, Any]:
    return {**_pred(item), "signal_type": "none", "actionable": "no"}


def model_failed(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **_pred(
            item, meta={"error": "model failed, rules fallback: ConnectError", "method": "rule"}
        ),
        "signal_type": "none",
    }


def raises(item: dict[str, Any]) -> dict[str, Any]:
    raise RuntimeError(f"boom with {item['text']}")  # must not reach logs or the response


def _post(settings: Settings, respond: Any, text: str = TRANSCRIPT, **extra: Any):
    fake = FakePipeline(respond) if respond is not None else None
    with make_client(settings, fake) as c:
        c.headers["X-Vitra-Token"] = TEST_TOKEN
        r = c.post("/api/intake", json={"text": text, **extra})
        return r, c, fake


def test_complete_returns_verified_spans_and_rejections(synthetic_settings: Settings) -> None:
    fake = FakePipeline(good)
    with make_client(synthetic_settings, fake) as c:
        c.headers["X-Vitra-Token"] = TEST_TOKEN
        r = c.post(
            "/api/intake", json={"text": TRANSCRIPT, "product": "B", "title": "Synthetic ad board"}
        ).json()
        assert r["status"] == "complete" and r["error"] is None
        assert [s["name"] for s in r["stages"]] == [
            "received_locally",
            "classifying",
            "validating_quotes",
            "incorporating",
        ]
        assert all(isinstance(s["ms"], int) and s["ms"] >= 0 for s in r["stages"])
        ev = r["evidence"]
        assert (
            ev["origin"] == "private_transcript"
            and ev["source"] == "transcript"
            and ev["product"] == "B"
        )
        assert [a["aspect"] for a in ev["aspects"]] == ["convenience"]
        a = ev["aspects"][0]
        assert TRANSCRIPT[a["span_start"] : a["span_end"]] == a["span"]
        rejected = {x["aspect"]: x for x in r["rejected_spans"]}
        assert set(rejected) == {"efficacy", "safety"}  # pipeline-dropped + failed exact check
        assert ev["confidence"]["span_verified"] is False  # one of its spans was dropped
        # Held in memory and folded into trends and the evidence list.
        iid = ev["item_id"]
        cells = c.get(
            "/api/trends", params={"product": "B", "aspect": "convenience", "speaker": "hcp"}
        ).json()
        assert any(iid in cell["item_ids"] for cell in cells)
        assert c.get(f"/api/evidence/{iid}").status_code == 200
        assert c.get("/api/health").json()["n_items"] == 11
        # Reset drops it everywhere.
        assert c.post("/api/reset").json() == {"transcripts_cleared": 1}
        assert c.get(f"/api/evidence/{iid}").status_code == 404
        assert c.get("/api/health").json()["n_items"] == 10
        # Ids are not reused after a reset.
        assert c.post("/api/intake", json={"text": TRANSCRIPT}).json()["evidence"]["item_id"] != iid
    assert fake.calls == 2


@pytest.mark.parametrize(
    "respond,reason_part",
    [
        (nothing_verifiable, "could be verified"),
        (no_aspects, "no aspect"),
    ],
)
def test_abstention_is_explicit(
    synthetic_settings: Settings, respond: Any, reason_part: str
) -> None:
    r, c, _ = _post(synthetic_settings, respond)
    body = r.json()
    assert body["status"] == "abstained" and body["evidence"] is None and body["error"] is None
    assert reason_part in body["reason"]
    assert [s["name"] for s in body["stages"]] == [
        "received_locally",
        "classifying",
        "validating_quotes",
    ]


@pytest.mark.parametrize(
    "respond,error_part",
    [
        (None, "pipeline unavailable"),
        (model_failed, "model step failed"),
        (raises, "pipeline raised RuntimeError"),
    ],
)
def test_errors_are_reported_never_faked(
    synthetic_settings: Settings, respond: Any, error_part: str
) -> None:
    r, _, _ = _post(synthetic_settings, respond)
    body = r.json()
    assert body["status"] == "error" and body["evidence"] is None
    assert error_part in body["error"]
    assert PHRASE not in r.text


def test_rejects_empty_and_oversized(synthetic_settings: Settings) -> None:
    assert _post(synthetic_settings, good, text="   ")[0].json()["status"] == "error"
    big = "x" * (synthetic_settings.max_transcript_chars + 1)
    body = _post(synthetic_settings, good, text=big)[0].json()
    assert body["status"] == "error" and "longer than" in body["error"]


def test_no_request_body_in_logs(
    synthetic_settings: Settings,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)  # every logger, every level
    for respond in (good, nothing_verifiable, model_failed, raises, None):
        _post(synthetic_settings, respond)
    # Invalid body (bad product): FastAPI answers 422; the body must still not be logged.
    _post(synthetic_settings, good, product="Z")
    out, err = capfd.readouterr()
    logged = caplog.text + out + err
    assert "intake received len=" in caplog.text  # we did log something about each request...
    assert PHRASE not in logged  # ...but never the text itself
    assert "much easier for patients" not in logged


def test_refuses_non_loopback_model_url(synthetic_settings: Settings) -> None:
    from dataclasses import replace

    r, _, fake = _post(replace(synthetic_settings, llm_url="https://api.example.com"), good)
    body = r.json()
    assert body["status"] == "error" and "non-loopback" in body["error"]
    assert fake.calls == 0


def test_real_pipeline_path_with_fake_model(
    synthetic_settings: Settings,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """Real pipeline.api (rules, merge, span snapping); only the HTTP model call is faked."""
    api = pytest.importorskip("pipeline.api")
    caplog.set_level(logging.DEBUG)

    def fake_model(item: dict[str, Any], pool: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        raw = {
            "signal_type": "expert_opinion",
            "actionable": "yes",
            **EMPTY,
            "convenience": {"polarity": 2, "speaker": "hcp", "span": "much easier for patients"},
            "safety": {"polarity": -1, "speaker": "hcp", "span": "a sentence the model made up"},
        }
        return raw, {"model": "fake-3b", "prompt_version": "test", "latency_ms": 1}

    class RealWithFakeModel:
        @staticmethod
        def classify_item(item: dict[str, Any], *, use_model: bool = True) -> dict[str, Any]:
            return api.classify_item(
                item, use_model=use_model, model_fn=fake_model, fewshot_pool=[]
            )

    with make_client(synthetic_settings, RealWithFakeModel()) as c:
        c.headers["X-Vitra-Token"] = TEST_TOKEN
        body = c.post("/api/intake", json={"text": TRANSCRIPT, "product": "A"}).json()
    assert body["status"] in ("complete", "abstained"), body.get("error")
    if body["status"] == "complete":
        for a in body["evidence"]["aspects"]:
            assert TRANSCRIPT[a["span_start"] : a["span_end"]] == a["span"]
    assert any(x["aspect"] == "safety" for x in body["rejected_spans"])
    out, err = capfd.readouterr()
    assert PHRASE not in caplog.text + out + err
