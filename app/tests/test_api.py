from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.tests.conftest import BASE_URL, TEST_TOKEN, make_client

PROTECTED = [
    ("GET", "/api/evidence"),
    ("GET", "/api/evidence/SYN-0001"),
    ("GET", "/api/trends"),
    ("GET", "/api/insights"),
    ("GET", "/api/gaps"),
    ("POST", "/api/whatif"),
    ("POST", "/api/intake"),
    ("POST", "/api/reset"),
    ("GET", "/api/privacy/status"),
]


def test_health_is_open(synthetic_settings: Settings) -> None:
    with make_client(synthetic_settings) as c:
        r = c.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["n_items"] == 10 and body["model_loaded"] is False


@pytest.mark.parametrize("method,path", PROTECTED)
def test_token_required(synthetic_settings: Settings, method: str, path: str) -> None:
    with make_client(synthetic_settings) as c:
        assert c.request(method, path, json={}).status_code == 401
        assert (
            c.request(
                method, path, json={}, headers={"X-Vitra-Token": "wrong-token-value-123"}
            ).status_code
            == 401
        )
        ok = c.request(
            method,
            path,
            json={"excluded_ids": []} if path.endswith("whatif") else {"text": "hello"},
            headers={"X-Vitra-Token": TEST_TOKEN},
        )
        assert ok.status_code == 200


def test_cors_allows_only_local_web_origins(synthetic_settings: Settings) -> None:
    with make_client(synthetic_settings) as c:
        for origin in ("http://127.0.0.1:5173", "http://localhost:5173"):
            r = c.options(
                "/api/trends",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "x-vitra-token",
                },
            )
            assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin
        for origin in ("http://evil.example", "http://127.0.0.1:3000", "null"):
            r = c.options(
                "/api/trends", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
            )
            assert "access-control-allow-origin" not in r.headers
            r = c.get("/api/health", headers={"Origin": origin})
            assert "access-control-allow-origin" not in r.headers
        # A 401 still carries CORS headers for the real origin, so the UI can show the error.
        r = c.get("/api/trends", headers={"Origin": "http://127.0.0.1:5173"})
        assert (
            r.status_code == 401
            and r.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        )


def test_non_loopback_connections_are_refused(synthetic_settings: Settings) -> None:
    app_client = make_client(synthetic_settings)
    remote = TestClient(
        app_client.app, base_url="http://192.168.1.20:8000", headers={"Host": "127.0.0.1:8000"}
    )
    assert remote.get("/api/health").status_code == 403
    remote_client = TestClient(app_client.app, base_url=BASE_URL, client=("10.1.2.3", 50000))
    assert remote_client.get("/api/health").status_code == 403
    rebinding = TestClient(app_client.app, base_url=BASE_URL, headers={"Host": "attacker.example"})
    assert rebinding.get("/api/health").status_code == 403


def test_evidence_list_truncates_and_filters(client: TestClient) -> None:
    items = client.get("/api/evidence").json()
    assert len(items) == 10 and all(len(i["text"]) <= 400 for i in items)
    b = client.get("/api/evidence", params={"product": "B,both"}).json()
    assert {i["product"] for i in b} == {"B", "both"}
    assert [
        i["item_id"] for i in client.get("/api/evidence", params={"speaker": "payer"}).json()
    ] == ["SYN-0104"]
    w = client.get("/api/evidence", params={"week_from": "2025-W12", "week_to": "2025-W12"}).json()
    assert {i["iso_week"] for i in w} == {"2025-W12"}
    assert client.get("/api/evidence", params={"product": "C"}).status_code == 400
    assert client.get("/api/evidence", params={"week_from": "March"}).status_code == 400
    assert client.get("/api/evidence/NOPE").status_code == 404
    one = client.get("/api/evidence/SYN-0003").json()
    a = one["aspects"][0]
    assert one["text"][a["span_start"] : a["span_end"]] == a["span"]
    assert client.get("/api/evidence").headers["cache-control"] == "no-store"


def test_whatif_matches_get_and_restores(client: TestClient) -> None:
    base = client.post("/api/whatif", json={"excluded_ids": []}).json()
    ex = client.post("/api/whatif", json={"excluded_ids": ["SYN-0003"]}).json()
    assert ex["trends"] == client.get("/api/trends", params={"excluded": "SYN-0003"}).json()
    assert ex["insights"] == client.get("/api/insights", params={"excluded": "SYN-0003"}).json()
    assert "card-SYN-0003" not in {c["id"] for c in ex["insights"]}
    assert ex != base
    assert client.post("/api/whatif", json={"excluded_ids": []}).json() == base
    small = client.post(
        "/api/whatif",
        json={"excluded_ids": [], "product": "A", "aspect": "safety", "speaker": "all"},
    ).json()
    assert {(t["product"], t["aspect"], t["speaker"]) for t in small["trends"]} == {
        ("A", "safety", "all")
    }


def test_gaps_endpoint(client: TestClient) -> None:
    gaps = client.get("/api/gaps", params={"window_weeks": 2}).json()
    assert gaps and all(g["window_weeks"] == 2 for g in gaps)
    assert client.get("/api/gaps", params={"window_weeks": 0}).status_code == 422


def test_privacy_status_reports_checked_facts(client: TestClient) -> None:
    body = client.get("/api/privacy/status").json()
    assert body["bind_host"] == "127.0.0.1" and body["outbound_allowed"] is False
    assert body["transcripts_persisted"] is False
    checks = {c["name"]: c for c in body["checks"]}
    assert checks["bind_host_is_loopback"]["ok"] is True
    assert checks["token_required"]["ok"] is True
    assert checks["llm_url_is_loopback"]["ok"] is True
    assert checks["cors_local_origins_only"]["ok"] is True
    assert checks["this_request_on_loopback"]["ok"] is True
    # Design properties are labeled as such, never shown as a passed runtime check.
    for name in ("transcripts_memory_only", "no_outbound_calls"):
        assert checks[name]["kind"] == "by_design" and checks[name]["ok"] is None


def test_privacy_status_flags_remote_llm(synthetic_settings: Settings) -> None:
    from dataclasses import replace

    remote = replace(synthetic_settings, llm_url="http://10.0.0.9:8080")
    with make_client(remote) as c:
        body = c.get("/api/privacy/status", headers={"X-Vitra-Token": TEST_TOKEN}).json()
        health = c.get("/api/health").json()
    assert {c["name"]: c for c in body["checks"]}["llm_url_is_loopback"]["ok"] is False
    assert health["model_loaded"] is False  # a non-loopback model URL is never probed


def test_cached_results_follow_evidence_changes(client: TestClient) -> None:
    from app.evidence import build_item

    params = {"product": "B", "aspect": "efficacy", "speaker": "all"}
    first = client.get("/api/trends", params=params).json()
    assert client.get("/api/trends", params=params).json() == first  # served from cache
    store = client.app.state.store
    item = {
        "item_id": "PT-9001",
        "source": "transcript",
        "url": "",
        "published": "2025-03-31",
        "product": "B",
        "title": "SYNTHETIC",
        "text": "SYNTHETIC: it worked.",
    }
    label = {
        "signal_type": "efficacy",
        "actionable": "no",
        "efficacy": {"polarity": 1, "speaker": "hcp", "span": "it worked"},
    }
    store.add_transcript(build_item(item, label, origin="private_transcript", method="model"))
    after = client.get("/api/trends", params=params).json()
    assert any("PT-9001" in c["item_ids"] for c in after)
    client.post("/api/reset")
    assert client.get("/api/trends", params=params).json() == first
