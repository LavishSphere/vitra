"""The cross-platform launcher (app/launch.py) and its wrappers.

Runs on Windows, macOS and Linux with no llama-server, model or organizer data. The
network probe is mocked. The one real socket test uses a UDP socket "connected" to
192.0.2.1 (TEST-NET-1, reserved for documentation): connect() on UDP sends no packet.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from collections import namedtuple
from pathlib import Path

import psutil
import pytest

from app import launch

REPO = Path(__file__).resolve().parents[2]
IS_WINDOWS = os.name == "nt"

Conn = namedtuple("Conn", "fd family type laddr raddr status")
Addr = namedtuple("Addr", "ip port")


class FakeProc:
    def __init__(self, pid: int, name: str, conns: list[Conn], denied: bool = False) -> None:
        self.pid, self._name, self._conns, self._denied = pid, name, conns, denied

    def name(self) -> str:
        return self._name

    def net_connections(self, kind: str = "inet") -> list[Conn]:
        if self._denied:
            raise psutil.AccessDenied(self.pid)
        return self._conns


def tcp(laddr: tuple, raddr: tuple = (), status: str = "ESTABLISHED") -> Conn:
    la = Addr(*laddr) if laddr else ()
    ra = Addr(*raddr) if raddr else ()
    return Conn(3, socket.AF_INET, socket.SOCK_STREAM, la, ra, status)


def udp(laddr: tuple, raddr: tuple = ()) -> Conn:
    la = Addr(*laddr) if laddr else ()
    ra = Addr(*raddr) if raddr else ()
    return Conn(4, socket.AF_INET, socket.SOCK_DGRAM, la, ra, "NONE")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _opts(**kw) -> launch.Options:
    return launch.Options(**kw)


# ---------------------------------------------------------------- audit logic


def test_audit_flags_non_loopback_sockets() -> None:
    procs = [
        FakeProc(10, "python", [tcp(("127.0.0.1", 8000), status="LISTEN")]),
        FakeProc(11, "llama-server", [tcp(("10.0.0.5", 50000), ("93.184.216.34", 443))]),
        FakeProc(12, "python", [udp(("0.0.0.0", 5353))]),
        FakeProc(13, "python", [tcp(("::", 8000), status="LISTEN")]),
    ]
    findings, unaudited = launch.non_loopback_sockets(procs)
    assert unaudited == []
    assert "llama-server 11 TCP 10.0.0.5:50000->93.184.216.34:443" in findings
    assert "python 12 UDP 0.0.0.0:5353" in findings
    assert "python 13 TCP [::]:8000" in findings
    assert not any(" 10 " in f for f in findings)


def test_audit_accepts_loopback_and_unbound_sockets() -> None:
    procs = [
        FakeProc(
            20,
            "python",
            [
                tcp(("127.0.0.1", 8000), status="LISTEN"),
                tcp(("127.0.0.1", 51000), ("127.0.0.1", 8080)),
                tcp(("::1", 51001), ("::1", 8080)),
                udp(("127.0.0.1", 51002), ("127.0.0.1", 9)),
                tcp(("0.0.0.0", 0), status="NONE"),  # created, not yet bound or connected
            ],
        )
    ]
    assert launch.non_loopback_sockets(procs) == ([], [])


def test_audit_reports_processes_it_cannot_read() -> None:
    findings, unaudited = launch.non_loopback_sockets([FakeProc(30, "x", [], denied=True)])
    assert findings == [] and unaudited == [30]


HOLD_UDP = (
    "import socket, sys, time\n"
    "s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)\n"
    "s.connect((sys.argv[1], 9))\n"
    "print('ready', flush=True)\n"
    "time.sleep(30)\n"
)


def _audit_real_child(addr: str) -> list[str] | None:
    holder = subprocess.Popen(
        [sys.executable, "-c", HOLD_UDP, addr],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        assert holder.stdout is not None
        if holder.stdout.readline().strip() != "ready":
            return None  # connect() failed: no route on this machine
        findings, _ = launch.non_loopback_sockets(launch.process_tree([holder.pid]))
        return findings
    finally:
        holder.kill()
        holder.wait()


def test_audit_flags_a_real_non_loopback_socket() -> None:
    findings = _audit_real_child("192.0.2.1")
    if findings is None:
        pytest.skip("no route for a UDP connect to TEST-NET-1 on this machine")
    assert findings, "a UDP socket aimed at 192.0.2.1 must be flagged"
    if not IS_WINDOWS:  # Windows' UDP table has no remote address; its local IP is flagged
        assert any("192.0.2.1:9" in f for f in findings), findings


def test_audit_ignores_a_real_loopback_socket() -> None:
    findings = _audit_real_child("127.0.0.1")
    if IS_WINDOWS:
        # Windows lists a connected UDP socket as 0.0.0.0:port with no remote address, so
        # the audit cannot prove it is loopback and flags it. Failing safe is intended.
        assert findings and all(" UDP 0.0.0.0:" in f for f in findings), findings
    else:
        assert findings == []


def test_audit_ignores_a_real_loopback_tcp_connection() -> None:
    """The case Vitra actually uses: TCP between two loopback sockets, on every OS."""
    with socket.socket() as srv:
        srv.bind(("127.0.0.1", 0))
        srv.listen()
        code = (
            "import socket, sys, time\n"
            "s = socket.create_connection(('127.0.0.1', int(sys.argv[1])))\n"
            "print('ready', flush=True)\n"
            "time.sleep(30)\n"
        )
        holder = subprocess.Popen(
            [sys.executable, "-c", code, str(srv.getsockname()[1])],
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            assert holder.stdout is not None and holder.stdout.readline().strip() == "ready"
            findings, _ = launch.non_loopback_sockets(launch.process_tree([holder.pid]))
        finally:
            holder.kill()
            holder.wait()
    assert findings == []


def test_process_tree_includes_descendants() -> None:
    code = (
        "import subprocess, sys, time\n"
        "c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
        "print(c.pid, flush=True)\n"
        "time.sleep(30)\n"
    )
    parent = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    try:
        assert parent.stdout is not None
        child_pid = int(parent.stdout.readline())
        pids = {p.pid for p in launch.process_tree([parent.pid])}
        assert {parent.pid, child_pid} <= pids
    finally:
        for p in reversed(launch.process_tree([parent.pid])):
            p.kill()
        parent.wait()


# ---------------------------------------------------------------- offline probe


def test_probe_online_true_when_connect_succeeds() -> None:
    closed: list[bool] = []

    class Sock:
        def close(self) -> None:
            closed.append(True)

    assert launch.tcp_reachable(connect=lambda *a, **k: Sock()) is True
    assert closed == [True]


def test_probe_online_false_on_dns_or_connect_failure() -> None:
    def gai(*a, **k):
        raise socket.gaierror("no DNS")

    def refused(*a, **k):
        raise ConnectionRefusedError

    def timeout(*a, **k):
        raise TimeoutError

    assert launch.tcp_reachable(connect=gai) is False
    assert launch.tcp_reachable(connect=refused) is False
    assert launch.tcp_reachable(connect=timeout) is False


def test_probe_runs_in_a_child_process() -> None:
    calls: list[list[str]] = []

    def run(cmd, **kw):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0)

    assert launch.probe_online(run=run) is True
    assert calls and calls[0][0] == sys.executable and "tcp_reachable" in calls[0][-1]
    assert launch.probe_online(run=lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1)) is False

    def hang(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 30)

    assert launch.probe_online(run=hang) is False


def test_offline_check_refuses_when_online(monkeypatch) -> None:
    monkeypatch.setattr(launch, "probe_online", lambda: True)
    lz = launch.Launcher(_opts(mode="check"))
    try:
        with pytest.raises(launch.LaunchError) as exc:
            lz.check_offline()
    finally:
        lz.cleanup()
    assert exc.value.code == launch.EXIT_ONLINE
    assert "reachable" in str(exc.value)


def test_offline_check_warn_only_continues(monkeypatch, capsys) -> None:
    monkeypatch.setattr(launch, "probe_online", lambda: True)
    lz = launch.Launcher(_opts(mode="check", warn_only=True))
    try:
        lz.check_offline()
    finally:
        lz.cleanup()
    assert "NOT an offline run" in capsys.readouterr().out


def test_offline_check_passes_when_offline(monkeypatch, capsys) -> None:
    monkeypatch.setattr(launch, "probe_online", lambda: False)
    lz = launch.Launcher(_opts(mode="check"))
    try:
        lz.check_offline()
    finally:
        lz.cleanup()
    assert "offline confirmed" in capsys.readouterr().out


@pytest.fixture()
def no_env_changes(monkeypatch):
    """main() would set VITRA_LLM_URL and the proxy sinkhole in this test process."""
    monkeypatch.setattr(launch.Launcher, "load_env", lambda self: None)
    monkeypatch.setattr(launch, "sinkhole_network", lambda env=None: None)


def test_main_exits_3_when_online(monkeypatch, no_env_changes) -> None:
    monkeypatch.setattr(launch, "probe_online", lambda: True)
    assert launch.main(["--check"]) == launch.EXIT_ONLINE


def test_main_exits_4_when_the_audit_fails(monkeypatch, no_env_changes) -> None:
    """The audit verdict, not the smoke tests, decides exit 4."""
    monkeypatch.setattr(launch, "probe_online", lambda: False)
    for stage in ("choose_web_mode", "ensure_llm", "start_api", "smoke", "no_node_running"):
        monkeypatch.setattr(launch.Launcher, stage, lambda self, *a: None)
    bad = FakeProc(99, "llama-server", [tcp(("10.0.0.5", 50000), ("93.184.216.34", 443))])
    monkeypatch.setattr(launch, "process_tree", lambda pids: [bad])
    assert launch.main(["--check", "--no-web"]) == launch.EXIT_AUDIT


# ---------------------------------------------------------------- paths


def test_llama_server_from_env_var(tmp_path: Path) -> None:
    exe = tmp_path / "llama.cpp" / "bin" / "llama-server.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    assert launch.find_llama_server({"VITRA_LLAMA_SERVER": str(exe), "PATH": ""}) == exe
    missing = {"VITRA_LLAMA_SERVER": str(tmp_path / "nope.exe"), "PATH": ""}
    assert launch.find_llama_server(missing) is None


def test_llama_server_on_path(tmp_path: Path) -> None:
    name = "llama-server.exe" if IS_WINDOWS else "llama-server"
    exe = tmp_path / name
    exe.write_bytes(b"")
    exe.chmod(0o755)
    found = launch.find_llama_server({"PATH": str(tmp_path)})
    assert found is not None
    assert found.parent == tmp_path and found.name.lower() == name


def test_model_resolution_order(tmp_path: Path) -> None:
    models = tmp_path / "models"
    models.mkdir()
    other = models / "Other-Q4.gguf"
    other.write_bytes(b"")
    # No argument, no env, no default file: the first models/*.gguf.
    assert launch.resolve_model(None, tmp_path, {}) == other
    default = tmp_path / launch.DEFAULT_MODEL
    default.write_bytes(b"")
    assert launch.resolve_model(None, tmp_path, {}) == default
    # VITRA_MODEL_PATH beats the default; the argument beats both.
    assert launch.resolve_model(None, tmp_path, {"VITRA_MODEL_PATH": str(other)}) == other
    env = {"VITRA_MODEL_PATH": str(other)}
    assert launch.resolve_model(str(default), tmp_path, env) == default
    # An explicit path that does not exist means no model, not a silent fallback.
    assert launch.resolve_model(None, tmp_path, {"VITRA_MODEL_PATH": "missing.gguf"}) is None


def test_relative_model_path_with_native_separators(tmp_path: Path) -> None:
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "m.gguf").write_bytes(b"")
    rel = "models" + os.sep + "m.gguf"  # models\m.gguf on Windows
    assert launch.resolve_model(rel, tmp_path, {}) == tmp_path / rel


@pytest.mark.skipif(not IS_WINDOWS, reason="backslash paths and drive letters are Windows-only")
def test_windows_backslash_and_drive_paths(tmp_path: Path) -> None:
    m = tmp_path / "models" / "m.gguf"
    m.parent.mkdir()
    m.write_bytes(b"")
    assert launch.resolve_model("models\\m.gguf", tmp_path, {}) == m
    assert str(tmp_path)[1] == ":"  # an absolute path with a drive letter
    assert launch.resolve_model(str(m), Path("C:\\elsewhere"), {}) == m


def test_split_items_paths() -> None:
    pkg = Path("pkg")
    assert launch.split_items("dev", pkg) == pkg / "data" / "dev.full.jsonl"
    assert launch.split_items("test", pkg) == pkg / "data" / "test_inputs.full.jsonl"


def test_run_dir_is_private_and_removed() -> None:
    lz = launch.Launcher(_opts())
    run_dir = lz.run_dir
    assert run_dir.is_dir()
    if not IS_WINDOWS:
        assert run_dir.stat().st_mode & 0o077 == 0
    lz.cleanup()
    assert not run_dir.exists()


# ---------------------------------------------------------------- other stages


def test_launcher_refuses_a_busy_port() -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        lz = launch.Launcher(_opts())
        try:
            with pytest.raises(launch.LaunchError) as exc:
                lz.port_free(port, "API")
        finally:
            lz.cleanup()
    assert f"port {port} (API) is already in use" in str(exc.value)


def test_free_port_is_free() -> None:
    assert launch.port_in_use(_free_port()) is False


def test_sinkhole_points_proxies_at_a_closed_loopback_port() -> None:
    env: dict[str, str] = {}
    launch.sinkhole_network(env)
    assert env["HTTPS_PROXY"] == env["http_proxy"] == "http://127.0.0.1:9"
    assert env["NO_PROXY"] == "127.0.0.1,localhost,::1"
    assert env["npm_config_offline"] == "true" and env["PIP_NO_INDEX"] == "1"


def test_demo_mode_requires_a_prebuilt_web_app(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VITRA_WEB_DIST", str(tmp_path / "none"))
    lz = launch.Launcher(_opts())
    try:
        with pytest.raises(launch.LaunchError, match="no prebuilt web app"):
            lz.choose_web_mode("dist")
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<!doctype html>")
        monkeypatch.setenv("VITRA_WEB_DIST", str(dist))
        lz.choose_web_mode("dist")
        assert lz.web_mode == "dist"
    finally:
        lz.cleanup()


def test_asset_paths_keep_same_origin_only() -> None:
    html = (
        '<script src="./assets/a.js"></script><link href="/assets/b.css">'
        '<link href="https://fonts.example/x.css"><script src="//cdn.example/y.js"></script>'
    )
    assert launch.asset_paths(html) == ["/assets/a.js", "/assets/b.css"]


def test_dotenv_does_not_override_the_environment(tmp_path: Path) -> None:
    f = tmp_path / ".env"
    f.write_text('# local\nexport VITRA_MODEL_PATH="models/a.gguf"\nVITRA_X=1\n')
    env = {"VITRA_X": "keep"}
    launch.load_dotenv(f, env)
    assert env == {"VITRA_X": "keep", "VITRA_MODEL_PATH": "models/a.gguf"}


def test_parse_args_matches_the_bash_flags() -> None:
    o = launch.parse_args(["--warn-only", "--check", "--no-intake", "--no-web", "m.gguf"], {})
    assert (o.mode, o.warn_only, o.intake, o.web, o.model) == (
        "check",
        True,
        False,
        "none",
        "m.gguf",
    )
    o = launch.parse_args(["--api-port", "8010", "predict", "dev", "--no-model", "--out", "x"], {})
    assert o.mode == "predict" and o.api_port == 8010
    assert o.predict_args == ["dev", "--no-model", "--out", "x"]
    assert launch.parse_args([], {"VITRA_OFFLINE_WARN_ONLY": "1"}).warn_only is True
    assert launch.parse_args(["local"], {}).web == "auto"
    env: dict[str, str] = {}
    launch.parse_args(["--predictions", "test,unlabeled"], env)
    assert env["VITRA_PREDICTIONS"] == "test,unlabeled"
    with pytest.raises(launch.LaunchError):
        launch.parse_args(["--dev-web"], {})
    with pytest.raises(launch.LaunchError):
        launch.parse_args(["--nope"], {})


def test_cleanup_stops_every_child(tmp_path: Path) -> None:
    lz = launch.Launcher(_opts())
    code = (
        "import subprocess, sys, time\n"
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
        "time.sleep(60)\n"
    )
    proc = lz.spawn("sleeper", [sys.executable, "-c", code], cwd=tmp_path)
    deadline = time.monotonic() + 15
    tree: list[psutil.Process] = []
    while time.monotonic() < deadline and len(tree) < 2:
        tree = launch.process_tree([proc.pid])
        time.sleep(0.1)
    assert len(tree) == 2
    lz.cleanup()
    assert proc.poll() is not None
    _, alive = psutil.wait_procs(tree, timeout=10)
    assert not [p for p in alive if p.status() != psutil.STATUS_ZOMBIE]


# ---------------------------------------------------------------- the real launcher


def _launcher_env(tmp_path: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("VITRA_")}
    env.update(
        VITRA_MODEL_PATH=str(tmp_path / "no-model.gguf"),  # explicit and missing: no llama-server
        VITRA_PREDICTIONS_DIR=str(tmp_path / "none"),
        PYTHONUNBUFFERED="1",
    )
    return env


def test_check_mode_end_to_end_without_a_model(tmp_path: Path) -> None:
    """Starts the real API, runs the smoke and the psutil audit, and stops everything."""
    api, llm = _free_port(), _free_port()
    r = subprocess.run(
        [sys.executable, "-m", "app.launch", "--check", "--warn-only", "--no-intake", "--no-web",
         "--api-port", str(api), "--llm-port", str(llm)],
        cwd=REPO, env=_launcher_env(tmp_path), capture_output=True, text=True, timeout=180,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    assert "API smoke: token enforced" in r.stdout
    assert "network audit passed" in r.stdout
    assert "CHECK PASSED" in r.stdout
    assert launch.port_in_use(api) is False, "the API must be stopped after --check"


def test_serve_mode_stops_children_on_ctrl_c(tmp_path: Path) -> None:
    api, llm = _free_port(), _free_port()
    kw: dict = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if IS_WINDOWS
        else {"start_new_session": True}
    )
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.launch", "serve", "--warn-only", "--no-web", "--no-browser",
         "--api-port", str(api), "--llm-port", str(llm)],
        cwd=REPO, env=_launcher_env(tmp_path), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, **kw,
    )  # fmt: skip
    seen: list[str] = []
    children: list[psutil.Process] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            seen.append(line)
            if "cold start complete" in line:
                break
        assert any("cold start complete" in ln for ln in seen), "".join(seen)
        children = launch.process_tree([proc.pid])[1:]
        assert children, "the API should run as a child of the launcher"
        # On Windows a process group can receive CTRL_BREAK_EVENT; the launcher treats it
        # like Ctrl+C. On POSIX this is the SIGINT a terminal sends.
        proc.send_signal(signal.CTRL_BREAK_EVENT if IS_WINDOWS else signal.SIGINT)
        rest, _ = proc.communicate(timeout=60)
        seen.append(rest)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    assert proc.returncode == launch.EXIT_INTERRUPTED, "".join(seen)
    assert "stopping (Ctrl+C)" in "".join(seen)
    _, alive = psutil.wait_procs(children, timeout=10)
    assert not [p for p in alive if p.status() != psutil.STATUS_ZOMBIE]
    assert launch.port_in_use(api) is False


# ---------------------------------------------------------------- wrappers


def _wrapper(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "VITRA_PYTHON": sys.executable}
    return subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=60)


@pytest.mark.skipif(IS_WINDOWS, reason="bash wrappers are for macOS, Linux and WSL")
@pytest.mark.parametrize("script", ["run_offline.sh", "run_local.sh"])
def test_bash_wrappers_reach_the_launcher(script: str) -> None:
    r = _wrapper(["bash", str(REPO / "scripts" / script), "--help"])
    assert r.returncode == 0, r.stderr
    assert "python -m app.launch" in r.stdout


@pytest.mark.skipif(not IS_WINDOWS, reason="cmd.exe is Windows-only")
def test_cmd_wrapper_reaches_the_launcher() -> None:
    r = _wrapper(["cmd.exe", "/c", str(REPO / "scripts" / "run_offline.cmd"), "--help"])
    assert r.returncode == 0, r.stdout + r.stderr
    assert "python -m app.launch" in r.stdout


@pytest.mark.skipif(not IS_WINDOWS, reason="cmd.exe is Windows-only")
def test_cmd_wrapper_passes_the_exit_code() -> None:
    r = _wrapper(["cmd.exe", "/c", str(REPO / "scripts" / "run_offline.cmd"), "--bogus"])
    assert r.returncode == 1, r.stdout + r.stderr


@pytest.mark.skipif(not IS_WINDOWS, reason="Windows PowerShell is Windows-only")
def test_powershell_wrapper_reaches_the_launcher() -> None:
    script = str(REPO / "scripts" / "run_offline.ps1")
    r = _wrapper(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "--help"]
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "python -m app.launch" in r.stdout


@pytest.mark.skipif(not IS_WINDOWS, reason="Windows PowerShell is Windows-only")
def test_powershell_wrapper_passes_the_exit_code() -> None:
    script = str(REPO / "scripts" / "run_offline.ps1")
    r = _wrapper(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "--bogus"]
    )
    assert r.returncode == 1, r.stdout + r.stderr
