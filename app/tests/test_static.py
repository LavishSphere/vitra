"""The API serves the prebuilt web app at / (same origin); /api stays the API."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings
from app.tests.conftest import TEST_TOKEN, make_client

INDEX = '<!doctype html><title>Vitra</title><script type="module" src="/assets/app.js"></script>'


@pytest.fixture()
def web_settings(synthetic_settings: Settings, tmp_path: Path) -> Settings:
    dist = tmp_path / "site" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "app.js").write_text("console.log('synthetic bundle')")
    (tmp_path / "site" / "secret.txt").write_text("outside-dist-secret")
    return replace(synthetic_settings, web_dist=dist)


def test_index_and_spa_fallback(web_settings: Settings) -> None:
    with make_client(web_settings) as c:
        for path in ("/", "/journey/station-3", "/index.html"):
            r = c.get(path)  # no token: the page must load before it reads #t=
            assert r.status_code == 200 and r.text == INDEX
            assert r.headers["content-type"].startswith("text/html")
            csp = r.headers["content-security-policy"]
            assert "default-src 'self'" in csp and "connect-src 'self'" in csp
            assert "frame-ancestors 'none'" in csp
        js = c.get("/assets/app.js")
        assert js.status_code == 200 and "javascript" in js.headers["content-type"]
        assert c.head("/").status_code == 200


def test_missing_files_and_api_paths_never_fall_back(web_settings: Settings) -> None:
    with make_client(web_settings) as c:
        assert c.get("/assets/missing.js").status_code == 404
        for path in ("/api", "/api/nope", "/api/evidence/x/y"):
            r = c.get(path, headers={"X-Vitra-Token": TEST_TOKEN})
            assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
        assert c.get("/api/trends").status_code == 401  # the API still needs the token


@pytest.mark.parametrize(
    "path", ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]
)
def test_no_path_traversal(web_settings: Settings, path: str) -> None:
    with make_client(web_settings) as c:
        r = c.get(path)
    assert "outside-dist-secret" not in r.text


def test_without_a_build_the_api_still_works(synthetic_settings: Settings, tmp_path: Path) -> None:
    with make_client(replace(synthetic_settings, web_dist=tmp_path / "nope")) as c:
        r = c.get("/")
        assert r.status_code == 404 and "not built" in r.json()["detail"]
        assert c.get("/api/health").status_code == 200


def test_privacy_status_with_web_app(web_settings: Settings) -> None:
    with make_client(web_settings) as c:
        body = c.get("/api/privacy/status", headers={"X-Vitra-Token": TEST_TOKEN}).json()
    checks = {x["name"]: x for x in body["checks"]}
    assert checks["token_required"]["ok"] is True  # the open web route is not an API route
    assert checks["web_app_same_origin_csp"]["ok"] is True
