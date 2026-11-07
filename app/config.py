"""Runtime configuration for the local API.

Everything comes from environment variables with safe defaults. The API must
only ever listen on a loopback address, so `Settings` refuses anything else at
construction time; the server entry point and the app factory both build a
`Settings`, which makes the refusal impossible to skip.
"""

from __future__ import annotations

import ipaddress
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_PACKAGE_DIR = REPO_ROOT / "starter" / "hackathon_package_2026-11-05"
DEFAULT_PREDICTIONS_DIR = REPO_ROOT / "data" / "derived" / "predictions"
DEFAULT_ALLOWED_ORIGINS: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")


class NonLoopbackError(ValueError):
    """Raised when a bind host or model URL is not a loopback address."""


def is_loopback_ip(host: str) -> bool:
    """True only for a literal loopback IP (127.0.0.0/8 or ::1).

    Host names, including "localhost", are refused for binding because their
    resolution can be changed outside the app (e.g. /etc/hosts).
    """
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def is_loopback_url(url: str) -> bool:
    """True when the URL's host is a loopback IP or the name "localhost"."""
    host = urlsplit(url).hostname or ""
    return host == "localhost" or is_loopback_ip(host)


def assert_loopback_bind(host: str) -> None:
    if not is_loopback_ip(host):
        raise NonLoopbackError(
            f"Refusing to bind the Vitra API to {host!r}: "
            "only loopback IPs (127.0.0.1, ::1) are allowed."
        )


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    bind_host: str = "127.0.0.1"
    port: int = 8000
    llm_url: str = "http://127.0.0.1:8080"
    model_path: str | None = None
    prompt_version: str | None = None
    package_dir: Path = DEFAULT_PACKAGE_DIR
    predictions_dir: Path = DEFAULT_PREDICTIONS_DIR
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS
    # Per-launch secret. A launcher script may pass one in (so it can hand the
    # same value to the web dev server); otherwise a fresh one is generated.
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    max_transcript_chars: int = 20_000

    def __post_init__(self) -> None:
        assert_loopback_bind(self.bind_host)
        if not self.token or len(self.token) < 16:
            raise ValueError("VITRA_API_TOKEN must be at least 16 characters.")

    @property
    def data_dir(self) -> Path:
        return self.package_dir / "data"

    @property
    def llm_url_is_loopback(self) -> bool:
        return is_loopback_url(self.llm_url)

    @classmethod
    def from_env(cls) -> Settings:
        kwargs: dict[str, object] = {
            "bind_host": os.environ.get("VITRA_API_HOST", "127.0.0.1"),
            "port": _env_int("VITRA_API_PORT", 8000),
            "llm_url": os.environ.get("VITRA_LLM_URL", "http://127.0.0.1:8080"),
            "model_path": os.environ.get("VITRA_MODEL_PATH") or None,
            "prompt_version": os.environ.get("VITRA_PROMPT_VERSION") or None,
            "package_dir": Path(os.environ.get("VITRA_PACKAGE_DIR", DEFAULT_PACKAGE_DIR)),
            "predictions_dir": Path(
                os.environ.get("VITRA_PREDICTIONS_DIR", DEFAULT_PREDICTIONS_DIR)
            ),
        }
        token = os.environ.get("VITRA_API_TOKEN")
        if token:
            kwargs["token"] = token
        return cls(**kwargs)  # type: ignore[arg-type]
