"""End-to-end checks against the real process, the real repo and (if present) the package.

Tests that need the organizer package, the eval log, the web build or git skip
themselves when it is missing, so a clean clone still passes. No test prints
item text: failures report file paths and item ids only.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest

REPO = Path(__file__).resolve().parents[2]
PKG = Path(os.environ.get("VITRA_PACKAGE_DIR", REPO / "starter" / "hackathon_package_2026-11-05"))
# Path to the team's local results log (markdown table); not part of the repo.
EVAL_LOG = Path(os.environ["VITRA_EVAL_LOG"]) if os.environ.get("VITRA_EVAL_LOG") else None
CANARY = "HACK1984-T1-" + "CANARY"  # split so this file never contains the literal string


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _listening_addrs(pid: int) -> list[str] | None:
    lsof = shutil.which("lsof")
    if not lsof:
        return None
    out = subprocess.run(
        [lsof, "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
        capture_output=True,
        text=True,
    ).stdout
    return sorted({ln[1:] for ln in out.splitlines() if ln.startswith("n")})


@pytest.fixture()
def live_server(tmp_path: Path):
    port = _free_port()
    env = {
        **os.environ,
        "VITRA_API_PORT": str(port),
        "VITRA_PREDICTIONS_DIR": str(tmp_path / "none"),
        "VITRA_LLM_URL": "http://127.0.0.1:1",
        "PYTHONUNBUFFERED": "1",
    }
    env.pop("VITRA_API_TOKEN", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "app"],
        cwd=REPO,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    lines: queue.Queue[str] = queue.Queue()
    threading.Thread(target=lambda: [lines.put(ln) for ln in proc.stdout], daemon=True).start()  # type: ignore[union-attr]
    token, log_lines, deadline = None, [], time.monotonic() + 30
    base = f"http://127.0.0.1:{port}"
    try:
        while time.monotonic() < deadline:
            try:
                ln = lines.get(timeout=0.2)
                log_lines.append(ln)
                if m := re.search(r"X-Vitra-Token for this launch: (\S+)", ln):
                    token = m.group(1)
            except queue.Empty:
                pass
            if token:
                try:
                    if httpx.get(base + "/api/health", timeout=0.5).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
        else:
            pytest.fail("API did not come up within 30 s")
        yield base, token, proc, log_lines
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_live_server_health_auth_and_loopback_sockets(live_server) -> None:
    base, token, proc, _ = live_server
    health = httpx.get(base + "/api/health").json()
    assert health["status"] == "ok" and isinstance(health["n_items"], int)
    assert httpx.get(base + "/api/trends").status_code == 401
    r = httpx.get(
        base + "/api/trends",
        params={"aspect": "all", "speaker": "all"},
        headers={"X-Vitra-Token": token},
    )
    assert r.status_code == 200
    assert all((c["mean_polarity"] is None) == (c["n_items"] == 0) for c in r.json())
    addrs = _listening_addrs(proc.pid)
    if addrs is None:
        pytest.skip("lsof not available")
    assert addrs and all(a.startswith(("127.0.0.1:", "[::1]:")) for a in addrs), addrs
    status = httpx.get(base + "/api/privacy/status", headers={"X-Vitra-Token": token}).json()
    checks = {c["name"]: c for c in status["checks"]}
    assert checks["listening_sockets_loopback"]["ok"] is True
    assert checks["this_request_on_loopback"]["ok"] is True


# Remote URL strings the bundle may contain because nothing ever fetches them.
# Exact strings, reviewed by hand: anything new fails the test until someone looks at it.
INERT_URL_PATTERNS = [
    # XML namespace identifiers: the DOM compares them as strings.
    r"http://www\.w3\.org/[\w/.#-]*",
    # React's minified error messages embed this decoder link as text.
    r"https://react\.dev/errors/",
    # Synthetic fixture citation links. example.org is reserved (RFC 2606) and only
    # opens if a person clicks it; the page never requests it.
    r"https://example\.org/synthetic/SYN-\d{4}",
]
INERT_URLS = {
    # Link in the public demo banner to the README setup steps; opened by a person, never fetched.
    "https://github.com/LavishSphere/vitra#setup-and-run-local-offline",
    # @react-three/fiber's package.json metadata, bundled as plain strings.
    "https://github.com/pmndrs/react-three-fiber#readme",
    "https://github.com/pmndrs/react-three-fiber/issues",
    "https://github.com/pmndrs/react-three-fiber.git",
    "https://opencollective.com/react-three-fiber",
    "https://github.com/drcmda",
    "https://github.com/codyjasonbennett",
    "https://github.com/joshuaellis",
    "https://github.com/krispya",
    # A comment-like hint string inside react-use-measure's error text.
    "https://github.com/react-spring/react-use-measure/#resize-observer-polyfills",
}
LOCAL_URL = re.compile(r"^https?://(127\.0\.0\.1|localhost|\[::1\])([:/]|$)")
# Protocol-relative references in markup or CSS would load from the network too.
PROTOCOL_RELATIVE = re.compile(r"""(?:src|href)\s*=\s*["']//|url\(\s*["']?//""")


def remote_urls_in_bundle(dist: Path) -> dict[str, set[str]]:
    inert = re.compile("^(?:" + "|".join(INERT_URL_PATTERNS) + ")$")
    hits: dict[str, set[str]] = {}
    for f in dist.rglob("*"):
        if not f.is_file() or f.suffix not in {".js", ".html", ".css", ".json", ".svg", ".txt"}:
            continue
        if f.suffix == ".txt" and "licen" in f.name.lower():
            continue
        text = f.read_text(errors="ignore")
        found = set(re.findall(r"https?://[^\s\"'`)<>,;]+", text))
        bad = {u for u in found if not (LOCAL_URL.match(u) or u in INERT_URLS or inert.match(u))}
        bad |= {f"protocol-relative: {m}" for m in PROTOCOL_RELATIVE.findall(text)}
        if bad:
            hits[str(f.relative_to(dist))] = bad
    return hits


def test_frontend_bundle_has_no_remote_urls() -> None:
    dist = REPO / "web" / "dist"
    if not dist.is_dir():
        pytest.skip("web/dist not built")
    hits = remote_urls_in_bundle(dist)
    assert not hits, {k: sorted(v)[:10] for k, v in hits.items()}


def test_bundle_check_catches_a_remote_font(tmp_path: Path) -> None:
    (tmp_path / "a.css").write_text("@import url(https://fonts.googleapis.com/css2?family=Inter);")
    (tmp_path / "b.html").write_text('<script src="//cdn.example.net/x.js"></script>')
    (tmp_path / "c.js").write_text('x="https://react.dev/errors/";y="http://www.w3.org/2000/svg"')
    hits = remote_urls_in_bundle(tmp_path)
    assert set(hits) == {"a.css", "b.html"}


def _git(*args: str) -> list[str]:
    return [
        ln
        for ln in subprocess.run(
            ["git", *args], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.splitlines()
        if ln
    ]


def test_git_tracks_no_package_data() -> None:
    if not shutil.which("git") or not (REPO / ".git").exists():
        pytest.skip("not a git checkout")
    tracked = _git("ls-files")
    # Also files `git add -A` would pick up (untracked, not ignored): catch leaks before staging.
    candidates = sorted(set(tracked) | set(_git("ls-files", "--others", "--exclude-standard")))
    bad_path = re.compile(
        r"(^|/)(starter|hackathon_package[^/]*)/|^data/(derived|private)/(?!\.gitkeep$)"
        r"|\.(zip|gguf|safetensors)$"
    )
    assert not [p for p in candidates if bad_path.search(p)]
    jsonl = [
        p
        for p in candidates
        if p.endswith(".jsonl") and "/fixtures/" not in p and not p.startswith("data/demo/")
    ]
    assert not jsonl, jsonl

    probes: dict[str, str] = {}
    data = PKG / "data"
    for name in ("dev.full.jsonl", "test_inputs.full.jsonl", "unlabeled.full.jsonl"):
        if (data / name).exists():
            for line in (data / name).open(encoding="utf-8"):
                row = json.loads(line)
                text = row.get("text") or ""
                if len(text) >= 80:
                    probes[row["item_id"]] = text[10:70]  # a 60-char window, never printed
    leaks: list[tuple[str, str]] = []
    for p in candidates:
        f = REPO / p
        if not f.is_file() or f.stat().st_size > 5_000_000:
            continue
        content = f.read_text(errors="ignore")
        if CANARY in content:
            leaks.append((p, "canary"))
        leaks += [(p, iid) for iid, probe in probes.items() if probe in content]
    assert not leaks, leaks[:20]


def _logged_rules_composite(rules_version: str) -> float | None:
    """Latest eval-log row for a rules-only run (no model) of this rules version."""
    if EVAL_LOG is None or not EVAL_LOG.exists():
        return None
    found = None
    for line in EVAL_LOG.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if (
            len(cells) < 15
            or cells[3] != "none"
            or cells[5] != rules_version
            or not cells[6].startswith("rules")
        ):
            continue
        m = re.search(r"[\d.]+", cells[14])
        if m:
            found = float(m.group())
    return found


def test_predict_cli_on_dev_matches_logged_rules_run(tmp_path: Path) -> None:
    if not (PKG / "data" / "dev.full.jsonl").exists():
        pytest.skip("organizer package not present")
    rules = pytest.importorskip("pipeline.rules")
    logged = _logged_rules_composite(rules.RULES_VERSION)
    if logged is None:
        pytest.skip(
            "set VITRA_EVAL_LOG to the results log with a rules-only row for "
            f"rules {rules.RULES_VERSION} to compare against"
        )
    out = tmp_path / "dev_pred.jsonl"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pipeline.predict",
            "--items",
            str(PKG / "data" / "dev.full.jsonl"),
            "--out",
            str(out),
            "--no-model",
        ],
        cwd=REPO,
        check=True,
        capture_output=True,
        timeout=300,
    )
    score = json.loads(
        subprocess.run(
            [
                sys.executable,
                "-I",
                str(PKG / "scoring" / "score.py"),
                "--gold",
                str(PKG / "data" / "dev.jsonl"),
                "--pred",
                str(out),
                "--items",
                str(PKG / "data" / "dev.full.jsonl"),
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    assert round(score["all"]["composite"], 4) == round(logged, 4)
