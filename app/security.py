"""Local-only access controls and privacy-safe request logging.

- Token: every route except GET /api/health requires header X-Vitra-Token to
  equal the per-launch token (constant-time compare).
- CORS: only the configured local web origins (default http://127.0.0.1:5173
  and http://localhost:5173).
- Loopback guard: a request whose local socket address (ASGI scope "server")
  or client address is a non-loopback IP is refused with 403. This backs up
  the bind-host refusal in config.py if the app is ever served some other way.
- Host header: only 127.0.0.1 / localhost / ::1 (blocks DNS-rebinding pages).
- Logging: method, path, status and duration only. Query strings and request
  bodies are never logged. Responses carry Cache-Control: no-store so the
  browser doesn't cache transcript-derived results.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import Settings, is_loopback_ip

log = logging.getLogger("vitra.http")

TOKEN_HEADER = "X-Vitra-Token"
OPEN_PATHS = frozenset({"/api/health"})
ALLOWED_HOST_NAMES = frozenset({"127.0.0.1", "localhost", "[::1]", "::1"})


def body_fingerprint(text: str) -> str:
    """The only thing ever logged about a private body: its length and a short hash."""
    return f"len={len(text)} sha256-8={hashlib.sha256(text.encode('utf-8')).hexdigest()[:8]}"


def make_token_dependency(settings: Settings) -> Callable[[Request], None]:
    expected = settings.token.encode()

    def require_token(request: Request) -> None:
        got = request.headers.get(TOKEN_HEADER, "").encode()
        if not hmac.compare_digest(got, expected):
            raise HTTPException(status_code=401, detail=f"missing or invalid {TOKEN_HEADER} header")

    return require_token


def _host_name(host_header: str) -> str:
    if host_header.startswith("["):
        return host_header.split("]")[0] + "]"
    return host_header.rsplit(":", 1)[0] if host_header.count(":") == 1 else host_header


def _non_loopback_ip(addr: str | None) -> bool:
    """True only for a parseable IP that is not loopback (test harness names pass)."""
    if not addr:
        return False
    try:
        ipaddress.ip_address(addr)
    except ValueError:
        return False
    return not is_loopback_ip(addr)


def install(app: FastAPI, settings: Settings) -> None:
    @app.middleware("http")
    async def guard_and_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        t0 = time.perf_counter()
        server = request.scope.get("server") or (None, None)
        client = request.scope.get("client") or (None, None)
        if _non_loopback_ip(server[0]) or _non_loopback_ip(client[0]):
            log.warning("refused non-loopback connection on %s", request.url.path)
            return JSONResponse(
                {"detail": "Vitra only serves loopback connections"}, status_code=403
            )
        if _host_name(request.headers.get("host", "")) not in ALLOWED_HOST_NAMES:
            log.warning("refused unexpected Host header on %s", request.url.path)
            return JSONResponse({"detail": "unexpected Host header"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        log.info(
            "%s %s -> %d (%.0f ms)",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - t0) * 1000,
        )
        return response

    # Added last so it is the outermost layer: 401/403 responses still carry CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=[TOKEN_HEADER, "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )
