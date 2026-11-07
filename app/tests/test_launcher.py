"""The offline launcher's own safety checks (scripts/run_offline.sh, scripts/run_local.sh).

No real network is used: a UDP socket "connected" to 192.0.2.1 (TEST-NET-1,
reserved for documentation) appears in lsof with that remote address, but
connect() on UDP sends no packet.
"""

from __future__ import annotations

import shutil
import socket
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
pytestmark = pytest.mark.skipif(
    not (shutil.which("bash") and shutil.which("lsof") and shutil.which("perl")),
    reason="needs bash, lsof and perl",
)

HOLD_UDP = (
    "import socket, sys, time\n"
    "s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)\n"
    "s.connect((sys.argv[1], 9))\n"
    "print('ready', flush=True)\n"
    "time.sleep(30)\n"
)


def _bash(script: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-c", f'set -euo pipefail; . "{REPO}/scripts/run_offline.sh"; {script}'],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": SYSTEM_PATH, "TMPDIR": str(tmp_path), "HOME": str(tmp_path)},
    )


def _audit_with_socket_to(addr: str, tmp_path: Path) -> str:
    holder = subprocess.Popen(
        [sys.executable, "-c", HOLD_UDP, addr], stdout=subprocess.PIPE, text=True
    )
    try:
        assert holder.stdout is not None and holder.stdout.readline().strip() == "ready"
        r = _bash(f'LLM_PORT=1; STARTED_PIDS="{holder.pid}"; audit_once', tmp_path)
        assert r.returncode == 0, r.stderr
        return r.stdout
    finally:
        holder.kill()
        holder.wait()


def test_audit_flags_non_loopback_socket(tmp_path: Path) -> None:
    assert "192.0.2.1:9" in _audit_with_socket_to("192.0.2.1", tmp_path)


def test_audit_ignores_loopback_socket(tmp_path: Path) -> None:
    assert _audit_with_socket_to("127.0.0.1", tmp_path).strip() == ""


def test_launcher_refuses_a_busy_port(tmp_path: Path) -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        r = _bash(f'T0_MS=$(now_ms); port_free {port} "API"', tmp_path)
    assert r.returncode != 0
    assert f"port {port} (API) is already in use" in r.stderr


def test_sinkhole_points_proxies_at_a_closed_loopback_port(tmp_path: Path) -> None:
    r = _bash('sinkhole_network; echo "$HTTPS_PROXY|$NO_PROXY|$npm_config_offline"', tmp_path)
    assert r.stdout.strip() == "http://127.0.0.1:9|127.0.0.1,localhost,::1|true"


def test_demo_mode_requires_a_prebuilt_web_app(tmp_path: Path) -> None:
    r = _bash(f'T0_MS=$(now_ms); WEB_DIST="{tmp_path}/none"; choose_web_mode dist', tmp_path)
    assert r.returncode != 0 and "no prebuilt web app" in r.stderr
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "index.html").write_text("<!doctype html>")
    r = _bash(
        f'T0_MS=$(now_ms); WEB_DIST="{tmp_path}/dist"; choose_web_mode dist; echo "$WEB_MODE"',
        tmp_path,
    )
    assert r.returncode == 0 and r.stdout.strip().endswith("dist")
