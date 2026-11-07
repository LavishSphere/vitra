from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import NonLoopbackError, Settings, assert_loopback_bind, is_loopback_url

REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "host", ["0.0.0.0", "::", "192.168.1.5", "10.0.0.1", "localhost", "example.com", ""]
)
def test_non_loopback_bind_refused(host: str) -> None:
    with pytest.raises(NonLoopbackError):
        assert_loopback_bind(host)
    with pytest.raises(NonLoopbackError):
        Settings(bind_host=host)


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.2", "::1"])
def test_loopback_bind_allowed(host: str) -> None:
    assert Settings(bind_host=host).bind_host == host


def test_server_entry_point_refuses_all_interfaces() -> None:
    env = {**os.environ, "VITRA_API_HOST": "0.0.0.0", "VITRA_API_PORT": "18999"}
    p = subprocess.run(
        [sys.executable, "-m", "app"], cwd=REPO, env=env, capture_output=True, text=True, timeout=30
    )
    assert p.returncode == 2
    assert "Refusing to bind" in p.stderr
    assert "Token" not in p.stdout  # it exits before generating or printing a token


def test_short_token_rejected() -> None:
    with pytest.raises(ValueError):
        Settings(token="short")


def test_tokens_differ_per_launch() -> None:
    assert Settings().token != Settings().token


def test_llm_url_loopback_detection() -> None:
    assert is_loopback_url("http://127.0.0.1:8080")
    assert is_loopback_url("http://localhost:8080/v1")
    assert not is_loopback_url("https://api.example.com/v1")
    assert not is_loopback_url("http://192.168.0.4:8080")


def test_listening_check_falls_back_to_psutil_without_lsof(monkeypatch) -> None:
    """Windows has no lsof: the privacy status still reports facts, from psutil."""
    import socket

    from app import main

    monkeypatch.setattr(main.shutil, "which", lambda name: None)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        ok, detail = main._listening_sockets()
    assert ok is True
    assert f"127.0.0.1:{port}" in detail and "(psutil)" in detail
