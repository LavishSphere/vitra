"""Start Vitra on Windows, macOS or Linux: model server, API and web app, all on 127.0.0.1.

    python -m app.launch [--warn-only] [serve] [--no-web] [--no-browser] [--predictions SETS] [model.gguf]
        offline cold start: confirm the network is off, start llama-server with a fresh
        per-launch key (or reuse a healthy one), start the API, which also serves the
        prebuilt web app (web/dist), then open http://127.0.0.1:8000/#t=<token>.
        Nothing is built or installed, and no node process runs.
    python -m app.launch [--warn-only] --check [--no-intake] [--no-web] [model.gguf]
        test mode: start everything, run a smoke sequence (health, evidence, trends,
        the web page and every asset it references, one SYNTHETIC transcript intake),
        audit every socket the whole time, stop everything, and exit non-zero if any
        step touched the network or a node process appeared
    python -m app.launch [--warn-only] predict <dev|test|unlabeled> [--no-model] [--workers N] [--out PATH]
        run the pipeline predict CLI on a package split; dev is also scored
    python -m app.launch local [--dev-web | --no-web] [--no-browser] [--predictions SETS] [model.gguf]
        everyday start with no network check, sinkhole or audit (scripts/run_local.sh)

Common options: --llm-port N (VITRA_LLM_PORT, default 8080), --api-port N
(VITRA_API_PORT, default 8000). llama-server comes from VITRA_LLAMA_SERVER or PATH
(llama-server.exe on Windows). The model comes from the argument, VITRA_MODEL_PATH,
models/Llama-3.2-3B-Instruct-Q4_K_M.gguf, or else the first models/*.gguf.

Network check: a TCP connection to example.com:443 must fail. If it succeeds the
launcher stops (exit 3), unless --warn-only (or VITRA_OFFLINE_WARN_ONLY=1) is given.
While running, every proxy variable points at a closed loopback port, so any tool
that honors them fails fast instead of reaching out. A socket audit samples every
0.3 s, with psutil, each process in the launcher's tree (plus a reused model server)
and flags any socket that is not loopback-to-loopback, including UDP. Any non-loopback
socket fails the run (exit 4). Limits: a sample can miss a socket that opens and closes
between two polls (the proxy sinkhole covers most of those). DNS lookups through the
system resolver run in a system service (mDNSResponder on macOS, the DNS Client on
Windows, often systemd-resolved on Linux), outside the audited tree; a connection to
the resolved address is inside it. Windows reports no remote address for UDP and lists
a connected UDP socket as 0.0.0.0:port, so on Windows every UDP socket is flagged, even
one that only talks to loopback. That errs toward failing the run.

Ctrl+C stops everything this launcher started. Each stage prints its timing.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import IO, Any

import psutil

from .config import is_loopback_ip

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = Path("models") / "Llama-3.2-3B-Instruct-Q4_K_M.gguf"
DEV_WEB_PORT = 5173  # the only dev-server port the API's CORS policy allows
LLM_SLOTS = 4
LLM_CTX_PER_SLOT = 8192
AUDIT_INTERVAL_S = 0.3
SINKHOLE = "http://127.0.0.1:9"  # port 9 (discard) has no listener
NO_PROXY = "127.0.0.1,localhost,::1"
IS_WINDOWS = os.name == "nt"

EXIT_ERROR = 1
EXIT_ONLINE = 3
EXIT_AUDIT = 4
EXIT_INTERRUPTED = 130

SYNTHETIC_INTAKE = {
    "title": "SYNTHETIC launcher check",
    "product": "B",
    "text": "SYNTHETIC TRANSCRIPT, invented for a launcher test. An invented oncologist said "
    "the subcutaneous injection cut chair time from hours to minutes, and patients preferred it.",
}

# Local HTTP only: an opener with no proxy handler, like `curl --noproxy '*'`.
_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class LaunchError(Exception):
    def __init__(self, message: str, code: int = EXIT_ERROR) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- pure helpers


def probe_online(
    host: str = "example.com",
    port: int = 443,
    timeout: float = 3.0,
    connect: Callable[..., socket.socket] = socket.create_connection,
) -> bool:
    """True if a TCP connection to host:port succeeds (DNS failure or refusal = offline)."""
    try:
        conn = connect((host, port), timeout=timeout)
    except OSError:
        return False
    conn.close()
    return True


def endpoint_is_loopback(addr: Any) -> bool:
    """A psutil address (ip, port) or an empty tuple (unconnected remote side)."""
    if not addr:
        return True
    ip = addr[0] if isinstance(addr, tuple) else getattr(addr, "ip", str(addr))
    return ip == "localhost" or is_loopback_ip(str(ip).split("%", 1)[0])


def _fmt_addr(addr: Any) -> str:
    if not addr:
        return ""
    ip, port = addr[0], addr[1]
    return f"[{ip}]:{port}" if ":" in str(ip) else f"{ip}:{port}"


def _conn_type(conn: Any) -> str:
    return "UDP" if conn.type == socket.SOCK_DGRAM else "TCP"


def non_loopback_sockets(procs: Iterable[Any]) -> tuple[list[str], list[int]]:
    """Audit the inet sockets of the given psutil processes.

    Returns (findings, unaudited pids). A finding is "name pid TYPE local->remote" for
    any socket whose local side, or remote side when connected, is not loopback.
    """
    findings: list[str] = []
    unaudited: list[int] = []
    for p in procs:
        try:
            name = p.name()
            conns = p.net_connections(kind="inet")
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied:
            unaudited.append(p.pid)
            continue
        for c in conns:
            if not c.raddr and (not c.laddr or c.laddr[1] == 0):
                # Created but neither bound nor connected (a sample taken between socket()
                # and connect()): it has no address and has sent nothing. Once it connects,
                # the next sample sees its real endpoints.
                continue
            if endpoint_is_loopback(c.laddr) and endpoint_is_loopback(c.raddr):
                continue
            ends = _fmt_addr(c.laddr) + (("->" + _fmt_addr(c.raddr)) if c.raddr else "")
            findings.append(f"{name} {p.pid} {_conn_type(c)} {ends}")
    return findings, unaudited


def process_tree(root_pids: Iterable[int]) -> list[Any]:
    """The given processes and all their descendants, deduplicated, as psutil objects."""
    seen: dict[int, Any] = {}
    for pid in root_pids:
        try:
            p = psutil.Process(pid)
            kids = p.children(recursive=True)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        for q in [p, *kids]:
            seen.setdefault(q.pid, q)
    return list(seen.values())


def listener_pid(port: int) -> int | None:
    """Best-effort pid of whatever listens on 127.0.0.1:port (None if unknown)."""

    def listens(c: Any) -> bool:
        return c.status == psutil.CONN_LISTEN and bool(c.laddr) and c.laddr[1] == port

    try:
        for c in psutil.net_connections(kind="tcp"):
            if listens(c) and c.pid:
                return int(c.pid)
        return None
    except (psutil.AccessDenied, OSError):
        pass
    # macOS needs root for the system-wide table; per-process works for our own user.
    for p in psutil.process_iter():
        try:
            if any(listens(c) for c in p.net_connections(kind="tcp")):
                return p.pid
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
            continue
    return None


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Something accepts on host:port, or the port cannot be bound there."""
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # Bind the way the servers do. On POSIX, SO_REUSEADDR ignores TIME_WAIT leftovers
        # from a previous run but still fails against a live listener. On Windows the same
        # flag would allow sharing a live port, so ask for exclusive use instead.
        if IS_WINDOWS:
            s.setsockopt(socket.SOL_SOCKET, getattr(socket, "SO_EXCLUSIVEADDRUSE", -5), 1)
        else:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            return True
    return False


def find_llama_server(env: dict[str, str] | None = None) -> Path | None:
    """VITRA_LLAMA_SERVER if set, else llama-server (llama-server.exe) on PATH."""
    env = os.environ if env is None else env
    explicit = env.get("VITRA_LLAMA_SERVER")
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_file() else None
    found = shutil.which("llama-server", path=env.get("PATH"))
    return Path(found) if found else None


def resolve_model(
    arg: str | None, root: Path = ROOT, env: dict[str, str] | None = None
) -> Path | None:
    """The argument, else VITRA_MODEL_PATH, else the default file, else the first models/*.gguf.

    A relative path is tried as given, then under the repo root. An explicit path that
    does not exist means "no model" (the API still starts; intake reports an error).
    """
    env = os.environ if env is None else env
    raw = arg or env.get("VITRA_MODEL_PATH") or ""
    if not raw:
        default = root / DEFAULT_MODEL
        if default.is_file():
            return default
        found = sorted((root / "models").glob("*.gguf"))
        return found[0] if found else None
    p = Path(raw).expanduser()
    for cand in (p, root / p):
        if cand.is_file():
            return cand
    return None


def split_items(split: str, package_dir: Path) -> Path:
    name = "test_inputs" if split == "test" else split
    return package_dir / "data" / f"{name}.full.jsonl"


def asset_paths(index_html: str) -> list[str]:
    """Same-origin asset paths referenced by src= or href= in the page.

    Vite builds with base "./", so "./assets/x.js" counts as "/assets/x.js". Absolute
    and protocol-relative URLs ("https://", "//host") are not assets of this origin.
    """
    out = []
    for ref in re.findall(r'(?:src|href)="([^"]+)"', index_html):
        if ref.startswith("./"):
            out.append(ref[1:])
        elif ref.startswith("/") and not ref.startswith("//"):
            out.append(ref)
    return out


def load_dotenv(path: Path, env: dict[str, str] | None = None) -> None:
    """KEY=VALUE lines from .env into the environment. Existing variables win."""
    env = os.environ if env is None else env
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        env.setdefault(key, value)


def sinkhole_network(env: dict[str, str] | None = None) -> None:
    env = os.environ if env is None else env
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env[k] = SINKHOLE
    env["NO_PROXY"] = env["no_proxy"] = NO_PROXY
    env.update(
        npm_config_offline="true",
        PIP_NO_INDEX="1",
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        DO_NOT_TRACK="1",
    )


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n} B"


def _detached() -> dict[str, Any]:
    """Keep Ctrl+C away from children: the launcher stops them itself, in order."""
    if IS_WINDOWS:
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


# ---------------------------------------------------------------- HTTP


@dataclass
class Reply:
    status: int | None
    headers: dict[str, str]
    body: bytes

    @property
    def ok(self) -> bool:
        return self.status is not None and self.status < 400

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))


def http(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float = 5.0,
) -> Reply:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with _HTTP.open(req, timeout=timeout) as resp:
            return Reply(resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read())
    except urllib.error.HTTPError as exc:
        return Reply(exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read())
    except (urllib.error.URLError, OSError, TimeoutError):
        return Reply(None, {}, b"")


# ---------------------------------------------------------------- audit


class SocketAudit:
    """Polls the launcher's process tree (and extra pids) for non-loopback sockets."""

    def __init__(self, extra_pids: Callable[[], Iterable[int]] = lambda: ()) -> None:
        self.extra_pids = extra_pids
        self.findings: set[str] = set()
        self.unaudited: set[int] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def pids(self) -> list[int]:
        return [p.pid for p in process_tree([os.getpid(), *self.extra_pids()])]

    def once(self) -> None:
        found, unaudited = non_loopback_sockets(process_tree([os.getpid(), *self.extra_pids()]))
        with self._lock:
            self.findings.update(found)
            self.unaudited.update(unaudited)

    def _run(self) -> None:
        while not self._stop.wait(AUDIT_INTERVAL_S):
            self.once()

    def start(self) -> None:
        self.once()
        self._thread = threading.Thread(target=self._run, name="vitra-audit", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None


# ---------------------------------------------------------------- launcher


@dataclass
class Options:
    mode: str = "serve"  # serve | check | predict | local
    warn_only: bool = False
    browser: bool = True
    intake: bool = True
    web: str = "dist"  # dist | dev | none | auto
    model: str | None = None
    predict_args: list[str] = field(default_factory=list)
    llm_port: int = 8080
    api_port: int = 8000


@dataclass
class Child:
    name: str
    proc: subprocess.Popen[bytes]
    log: IO[bytes] | None


class Launcher:
    def __init__(self, opts: Options, root: Path = ROOT) -> None:
        self.opts = opts
        self.root = root
        self.t0 = time.monotonic()
        self.children: list[Child] = []
        self.run_dir = Path(tempfile.mkdtemp(prefix="vitra-run."))  # mode 700 on POSIX
        self.web_mode = "none"
        self.api_token = ""
        self.llm_url = f"http://127.0.0.1:{opts.llm_port}"
        self.reused_llm_pid: int | None = None
        self.audit: SocketAudit | None = None

    # -- output
    def stage(self, msg: str, stream: IO[str] | None = None) -> None:
        print(
            f"[vitra {time.monotonic() - self.t0:6.1f}s] {msg}",
            file=stream or sys.stdout,
            flush=True,
        )

    @staticmethod
    def die(msg: str, code: int = EXIT_ERROR) -> LaunchError:
        return LaunchError(msg, code)

    # -- processes
    def spawn(
        self, name: str, args: Sequence[str | Path], *, cwd: Path, env: dict[str, str] | None = None
    ) -> subprocess.Popen[bytes]:
        log = (self.run_dir / f"{name}.log").open("wb")
        proc = subprocess.Popen(
            [str(a) for a in args],
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            **_detached(),
        )
        self.children.append(Child(name, proc, log))
        return proc

    def log_tail(self, name: str, n: int = 5, drop: str | None = None) -> str:
        path = self.run_dir / f"{name}.log"
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return ""
        if drop:
            lines = [ln for ln in lines if drop not in ln]
        return "\n".join(lines[-n:])

    def cleanup(self) -> None:
        if self.audit is not None:
            self.audit.stop()
        procs: list[psutil.Process] = []
        for child in reversed(self.children):
            if child.proc.poll() is None:
                procs.extend(process_tree([child.proc.pid]))
        for p in procs:
            try:
                p.terminate()
            except psutil.NoSuchProcess:
                pass
        _, alive = psutil.wait_procs(procs, timeout=5)
        for p in alive:
            try:
                p.kill()
            except psutil.NoSuchProcess:
                pass
        psutil.wait_procs(alive, timeout=5)
        for child in self.children:
            try:
                child.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.proc.kill()
            if child.log is not None:
                child.log.close()
        self.children.clear()
        shutil.rmtree(self.run_dir, ignore_errors=True)

    def wait_for(self, url: str, seconds: float, proc: subprocess.Popen[bytes] | None) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if http(url, timeout=2).ok:
                return True
            if proc is not None and proc.poll() is not None:
                return False
            time.sleep(0.25)
        return False

    def port_free(self, port: int, what: str) -> None:
        if not port_in_use(port):
            return
        pid = listener_pid(port)
        holder = ""
        if pid:
            try:
                holder = f" by pid {pid} ({psutil.Process(pid).name()})"
            except psutil.Error:
                holder = f" by pid {pid}"
        raise self.die(f"port {port} ({what}) is already in use{holder}. Stop it first.")

    # -- stages
    def load_env(self) -> None:
        load_dotenv(self.root / ".env")
        os.environ["VITRA_LLM_URL"] = self.llm_url

    def check_offline(self) -> None:
        if probe_online():
            if self.opts.warn_only:
                self.stage(
                    "WARNING: example.com:443 is reachable, so this is NOT an offline run (--warn-only)"
                )
                return
            raise self.die(
                "example.com:443 is reachable. Turn the network off, or pass --warn-only for development.",
                EXIT_ONLINE,
            )
        self.stage("offline confirmed: example.com:443 is unreachable")

    def start_audit(self) -> None:
        self.audit = SocketAudit(
            extra_pids=lambda: [self.reused_llm_pid] if self.reused_llm_pid else []
        )
        self.audit.start()
        self.stage(
            f"socket audit running (psutil every {AUDIT_INTERVAL_S} s on all Vitra processes)"
        )

    def audit_report(self) -> bool:
        assert self.audit is not None
        self.audit.stop()
        self.audit.once()
        if self.audit.unaudited:
            pids = ", ".join(str(p) for p in sorted(self.audit.unaudited))
            self.stage(
                f"WARNING: no permission to audit pid(s) {pids}; their sockets were not checked"
            )
        if self.audit.findings:
            self.stage("NETWORK AUDIT FAILED: non-loopback sockets seen:")
            for line in sorted(self.audit.findings):
                print(f"    {line}", flush=True)
            return False
        self.stage("network audit passed: every socket seen was loopback only")
        return True

    def ensure_llm(self) -> None:
        if http(self.llm_url + "/health", timeout=2).ok:
            self.stage(
                f"model server already running on 127.0.0.1:{self.opts.llm_port}, reusing it"
            )
            self.reused_llm_pid = listener_pid(self.opts.llm_port)
            key_file = self.root / "data" / "derived" / "llm_key.txt"
            if not os.environ.get("VITRA_LLM_KEY") and key_file.is_file():
                os.environ["VITRA_LLM_KEY"] = key_file.read_text(encoding="utf-8").strip()
            r = http(
                self.llm_url + "/v1/models",
                headers={"Authorization": f"Bearer {os.environ.get('VITRA_LLM_KEY', 'none')}"},
                timeout=2,
            )
            if r.status != 200:
                self.stage(
                    f"WARNING: the running model server rejects our key (HTTP {r.status}). "
                    "Intake will report an error."
                )
            return
        model = resolve_model(self.opts.model, self.root)
        if model is None:
            self.stage(
                "WARNING: no model file found (set VITRA_MODEL_PATH). Intake will report an error."
            )
            return
        llama = find_llama_server()
        if llama is None:
            raise self.die(
                "llama-server not found on PATH (set VITRA_LLAMA_SERVER to its full path)"
            )
        self.port_free(self.opts.llm_port, "model server")
        # A fresh key for this launch, shared with the API through the environment. It is
        # also written to data/derived/llm_key.txt (mode 600) so a later launch can reuse
        # this server, as pipeline/serve_model.sh does.
        key = new_secret()
        os.environ["VITRA_LLM_KEY"] = key
        os.environ["VITRA_MODEL_PATH"] = str(model)
        key_file = self.root / "data" / "derived" / "llm_key.txt"
        key_file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(key + "\n")
        os.chmod(key_file, 0o600)
        self.stage(f"starting model server: {model.name} on 127.0.0.1:{self.opts.llm_port}")
        args: list[str | Path] = [
            llama, "-m", model, "--host", "127.0.0.1", "--port", str(self.opts.llm_port),
            "-ngl", "99", "-fa", "on", "-np", str(LLM_SLOTS), "-c", str(LLM_SLOTS * LLM_CTX_PER_SLOT),
            "--no-webui", "--api-key", key,
        ]  # fmt: skip
        proc = self.spawn("llama", args, cwd=self.root)
        if not self.wait_for(self.llm_url + "/health", 180, proc):
            print(self.log_tail("llama"), file=sys.stderr)
            raise self.die("model server did not become healthy")
        self.stage("model server ready")

    def web_dist(self) -> Path:
        return Path(os.environ.get("VITRA_WEB_DIST") or self.root / "web" / "dist")

    def vite_js(self) -> Path:
        return self.root / "web" / "node_modules" / "vite" / "bin" / "vite.js"

    def choose_web_mode(self, requested: str) -> None:
        dist = self.web_dist()
        if requested == "dist" and not (dist / "index.html").is_file():
            raise self.die(
                f"no prebuilt web app at {dist}. Build it while online: (cd web && npm ci && npm run build)"
            )
        if requested == "auto":
            if (dist / "index.html").is_file():
                requested = "dist"
            elif self.vite_js().is_file():
                requested = "dev"
            else:
                requested = "none"
                self.stage("WARNING: no web build and no web/node_modules; starting the API only")
        self.web_mode = requested
        if requested == "dist":
            size = sum(f.stat().st_size for f in dist.rglob("*") if f.is_file())
            built = datetime.fromtimestamp((dist / "index.html").stat().st_mtime)
            self.stage(
                f"web app: prebuilt {_human_size(size)} bundle from {built:%a %H:%M}, served by the API"
            )

    def start_api(self) -> None:
        missing = [
            m for m in ("fastapi", "uvicorn", "pydantic") if importlib.util.find_spec(m) is None
        ]
        if missing:
            raise self.die(
                f"API dependencies missing in {sys.executable}: {', '.join(missing)} "
                "(install requirements.txt while online, before the demo)"
            )
        port = self.opts.api_port
        self.port_free(port, "API")
        self.api_token = new_secret()
        os.environ.update(
            VITRA_API_TOKEN=self.api_token,
            VITRA_API_HOST="127.0.0.1",
            VITRA_API_PORT=str(port),
            VITRA_WEB_DIST=str(self.web_dist()),
            PYTHONUNBUFFERED="1",
        )
        self.stage(f"starting API on 127.0.0.1:{port}")
        # The API log holds no request bodies (lengths and hashes only); it lives in a
        # private temp dir that is deleted on exit.
        proc = self.spawn("api", [sys.executable, "-m", "app"], cwd=self.root)
        base = f"http://127.0.0.1:{port}"
        if not self.wait_for(base + "/api/health", 60, proc):
            print(self.log_tail("api", drop="X-Vitra-Token"), file=sys.stderr)
            raise self.die("API did not start")
        h = http(base + "/api/health").json()
        model = f", {h['model']}" if h.get("model") else ""
        up = "up" if h["model_loaded"] else "down"
        self.stage(f"API ready ({h['n_items']} items, model server {up}{model})")
        if self.web_mode == "dist":
            if not http(base + "/").ok:
                raise self.die("the API did not serve the web app")
            self.stage(f"web app ready: {base}/ (same origin as the API)")

    def start_dev_web(self) -> None:
        node = shutil.which("node")
        vite = self.vite_js()
        if not node or not vite.is_file():
            raise self.die(
                "web/node_modules or node is missing (run 'npm ci' in web/ while online)"
            )
        self.port_free(DEV_WEB_PORT, "web dev server")
        self.stage(f"starting web dev server on 127.0.0.1:{DEV_WEB_PORT}")
        env = {
            **os.environ,
            "VITE_DATA_SOURCE": "api",
            "VITE_VITRA_TOKEN": self.api_token,
            "VITE_API_BASE": f"http://127.0.0.1:{self.opts.api_port}",
        }
        args = [node, vite, "--host", "127.0.0.1", "--port", str(DEV_WEB_PORT), "--strictPort"]
        proc = self.spawn("web", args, cwd=self.root / "web", env=env)
        if not self.wait_for(f"http://127.0.0.1:{DEV_WEB_PORT}/", 60, proc):
            print(self.log_tail("web"), file=sys.stderr)
            raise self.die("web dev server did not start")
        self.stage(f"web dev server ready: http://127.0.0.1:{DEV_WEB_PORT}/")

    def app_url(self) -> str:
        if self.web_mode == "dist":
            return f"http://127.0.0.1:{self.opts.api_port}/#t={self.api_token}"
        if self.web_mode == "dev":
            return f"http://127.0.0.1:{DEV_WEB_PORT}/"
        return ""

    def open_browser(self) -> None:
        url = self.app_url()
        if not url:
            return
        if not webbrowser.open(url):
            self.stage("no browser opener found; open the URL below by hand")
            return
        self.stage(f"browser opened on {url.split('#', 1)[0]}")

    def print_summary(self) -> None:
        print(f"[vitra] X-Vitra-Token for this launch: {self.api_token}", flush=True)
        if self.web_mode == "dist":
            print(f"[vitra] app: {self.app_url()}", flush=True)
        print(
            f"[vitra] logs for this launch: {self.run_dir} (deleted on exit). "
            "Ctrl+C stops everything.",
            flush=True,
        )

    def wait_api(self) -> None:
        api = next((c.proc for c in self.children if c.name == "api"), None)
        if api is None:
            return
        # A short timeout keeps Ctrl+C responsive on Windows.
        while True:
            try:
                api.wait(timeout=0.5)
                return
            except subprocess.TimeoutExpired:
                continue

    # -- smoke tests
    def smoke(self) -> None:
        base = f"http://127.0.0.1:{self.opts.api_port}"
        auth = {"X-Vitra-Token": self.api_token}
        r = http(base + "/api/trends")
        if r.status != 401:
            raise self.die(f"expected 401 without a token, got {r.status}")
        r = http(base + "/api/evidence", headers=auth, timeout=30)
        if not r.ok:
            raise self.die(f"/api/evidence failed (HTTP {r.status})")
        self.stage(f"API smoke: token enforced, {len(r.json())} evidence items served")
        for path in ("/api/trends?aspect=all&speaker=all", "/api/insights", "/api/gaps"):
            r = http(base + path, headers=auth, timeout=30)
            if not r.ok:
                raise self.die(f"{path} failed (HTTP {r.status})")
        self.stage("API smoke: trends, insights and gaps answered")
        if self.web_mode == "dist":
            self.web_smoke(base)
        if self.opts.intake:
            self.intake_smoke(base, auth)

    def web_smoke(self, base: str) -> None:
        r = http(base + "/")
        if not r.ok:
            raise self.die("web page did not load")
        if not r.headers.get("content-security-policy", "").startswith("default-src 'self'"):
            raise self.die("web page is missing its Content-Security-Policy header")
        assets = asset_paths(r.body.decode("utf-8", errors="replace"))
        for asset in assets:
            if not http(base + asset, timeout=10).ok:
                raise self.die(f"web asset {asset} did not load")
        self.stage(
            f"web smoke: page + {len(assets)} referenced asset(s) served same-origin, CSP present"
        )

    def intake_smoke(self, base: str, auth: dict[str, str]) -> None:
        self.stage("intake smoke: one SYNTHETIC transcript through the local model")
        r = http(
            base + "/api/intake",
            headers={**auth, "Content-Type": "application/json"},
            data=json.dumps(SYNTHETIC_INTAKE).encode(),
            timeout=300,
        )
        if not r.ok:
            raise self.die(f"intake smoke failed (HTTP {r.status})")
        d = r.json()
        stages = ", ".join(f"{s['name']} {s['ms']} ms" for s in d["stages"])
        err = f" error: {d['error']}" if d.get("error") else ""
        spans = len(d["evidence"]["aspects"]) if d.get("evidence") else 0
        print(
            f"[vitra]         intake status={d['status']}, {spans} verified span(s) ({stages}){err}",
            flush=True,
        )
        if d["status"] not in ("complete", "abstained"):
            raise self.die("intake smoke failed (see the line above)")
        http(base + "/api/reset", headers=auth, method="POST", data=b"")

    def no_node_running(self) -> None:
        assert self.audit is not None
        for pid in self.audit.pids():
            try:
                name = psutil.Process(pid).name()
            except psutil.Error:
                continue
            if "node" in name.lower():
                raise self.die(
                    f"a node process (pid {pid}) is running under the launcher; "
                    "demo mode must not need one"
                )
        self.stage("no node process running under the launcher")

    # -- predict
    def predict(self) -> None:
        if not self.opts.predict_args:
            raise self.die("usage: python -m app.launch predict <dev|test|unlabeled> [options]")
        split, *rest = self.opts.predict_args
        pkg = Path(
            os.environ.get("VITRA_PACKAGE_DIR")
            or self.root / "starter" / "hackathon_package_2026-11-05"
        )
        items = split_items(split, pkg)
        if not items.is_file():
            raise self.die(f"missing {items}")
        out = self.root / "data" / "derived" / f"{split}_pred.jsonl"
        args: list[str] = []
        use_model = True
        i = 0
        while i < len(rest):
            if rest[i] == "--out" and i + 1 < len(rest):
                out = Path(rest[i + 1])
                i += 2
                continue
            if rest[i] == "--no-model":
                use_model = False
            args.append(rest[i])
            i += 1
        if use_model:
            self.ensure_llm()
        with items.open(encoding="utf-8") as fh:
            n = sum(1 for _ in fh)
        self.stage(f"predicting {n} {split} items")
        cmd = [
            sys.executable,
            "-m",
            "pipeline.predict",
            "--items",
            str(items),
            "--out",
            str(out),
            *args,
        ]
        if subprocess.run(cmd, cwd=self.root).returncode != 0:
            raise self.die("predict failed")
        self.stage(f"predict done: {out}")
        if split == "dev":
            score = pkg / "scoring" / "score.py"
            subprocess.run(
                [sys.executable, "-I", str(score), "--gold", str(pkg / "data" / "dev.jsonl"),
                 "--pred", str(out), "--items", str(items)],
                cwd=self.root,
            )  # fmt: skip

    # -- modes
    def run(self) -> int:
        o = self.opts
        self.load_env()
        if o.mode == "local":
            self.choose_web_mode(o.web)
            self.ensure_llm()
            self.start_api()
            if self.web_mode == "dev":
                self.start_dev_web()
            if o.browser:
                self.open_browser()
            self.print_summary()
            self.wait_api()
            return 0
        self.check_offline()
        sinkhole_network()
        self.start_audit()
        if o.mode == "predict":
            self.predict()
            return 0 if self.audit_report() else EXIT_AUDIT
        self.choose_web_mode(o.web)
        self.ensure_llm()
        self.start_api()
        if o.mode == "check":
            self.stage("cold start complete (browser would open now)")
            self.smoke()
            self.no_node_running()
            if not self.audit_report():
                return EXIT_AUDIT
            self.stage("CHECK PASSED")
            return 0
        if o.browser:
            self.open_browser()
        self.stage("cold start complete")
        self.print_summary()
        self.stage("socket audit keeps running; any non-loopback socket is reported on exit")
        self.wait_api()
        return 0 if self.audit_report() else EXIT_AUDIT


# ---------------------------------------------------------------- CLI


def _port(raw: str, flag: str) -> int:
    try:
        port = int(raw)
    except ValueError:
        raise LaunchError(f"{flag} needs a port number, got {raw!r}") from None
    if not 0 < port < 65536:
        raise LaunchError(f"{flag} out of range: {port}")
    return port


def parse_args(argv: Sequence[str], env: dict[str, str] | None = None) -> Options:
    """The same flags as scripts/run_offline.sh and scripts/run_local.sh, in any order."""
    env = os.environ if env is None else env
    o = Options(
        warn_only=env.get("VITRA_OFFLINE_WARN_ONLY") == "1",
        llm_port=_port(env.get("VITRA_LLM_PORT") or "8080", "VITRA_LLM_PORT"),
        api_port=_port(env.get("VITRA_API_PORT") or "8000", "VITRA_API_PORT"),
    )
    web_set = False
    args = list(argv)
    i = 0

    def value(flag: str) -> str:
        if i + 1 >= len(args):
            raise LaunchError(f"{flag} needs a value")
        return args[i + 1]

    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            o.mode = "help"
            return o
        if a == "--warn-only":
            o.warn_only = True
        elif a == "--check":
            o.mode = "check"
        elif a == "--no-browser":
            o.browser = False
        elif a == "--no-intake":
            o.intake = False
        elif a in ("--no-web", "--dev-web"):
            o.web, web_set = ("none" if a == "--no-web" else "dev"), True
        elif a == "--predictions":
            env["VITRA_PREDICTIONS"] = value(a)
            i += 1
        elif a in ("--llm-port", "--api-port"):
            port = _port(value(a), a)
            if a == "--llm-port":
                o.llm_port = port
            else:
                o.api_port = port
            i += 1
        elif a in ("serve", "local"):
            o.mode = a
        elif a == "predict":
            o.mode = "predict"
            o.predict_args = args[i + 1 :]
            break
        elif a.startswith("-"):
            raise LaunchError(f"unknown option {a} (see --help)")
        else:
            o.model = a
        i += 1
    if o.mode == "local" and not web_set:
        o.web = "auto"
    if o.web == "dev" and o.mode != "local":
        raise LaunchError("--dev-web only works with the local mode (scripts/run_local.sh)")
    return o


def main(argv: Sequence[str] | None = None) -> int:
    try:
        opts = parse_args(sys.argv[1:] if argv is None else argv)
    except LaunchError as exc:
        print(f"[vitra] ERROR: {exc}", file=sys.stderr)
        return exc.code
    if opts.mode == "help":
        print(__doc__)
        return 0
    launcher = Launcher(opts)
    # Ctrl+C arrives as KeyboardInterrupt (SIGINT on POSIX, CTRL_C_EVENT on Windows).
    # SIGTERM and Windows Ctrl+Break take the same path so children are always stopped.
    for name in ("SIGTERM", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is not None:
            signal.signal(sig, signal.default_int_handler)
    try:
        return launcher.run()
    except LaunchError as exc:
        launcher.stage(f"ERROR: {exc}", sys.stderr)
        return exc.code
    except KeyboardInterrupt:
        launcher.stage("stopping (Ctrl+C)")
        return EXIT_INTERRUPTED
    finally:
        launcher.cleanup()


if __name__ == "__main__":
    sys.exit(main())
