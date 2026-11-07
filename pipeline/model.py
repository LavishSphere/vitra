"""Local model adapter: OpenAI-compatible chat call to llama-server on loopback.

Config (env): VITRA_LLM_URL (default http://127.0.0.1:8080), VITRA_LLM_KEY,
VITRA_PROMPT_VERSION, VITRA_LLM_TIMEOUT (s), VITRA_MAX_TOKENS.
Standard library only. Refuses any non-loopback URL: there is no cloud fallback.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Sequence
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from .data import DEV_GOLD, read_jsonl
from .prompts import PROMPT_VERSION, build_messages, output_schema

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ModelError(RuntimeError):
    pass


def llm_url() -> str:
    url = os.environ.get("VITRA_LLM_URL", "http://127.0.0.1:8080").rstrip("/")
    host = urlparse(url).hostname or ""
    if host not in LOOPBACK_HOSTS:
        raise ModelError(f"refusing non-loopback model URL host {host!r}")
    return url


def _request(path: str, payload: dict[str, Any] | None, timeout: float) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("VITRA_LLM_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        llm_url() + path, data=data, headers=headers, method="POST" if data else "GET"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ModelError(f"HTTP {exc.code}: {exc.read()[:200]!r}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ModelError(f"model server unreachable: {exc}") from exc


@lru_cache(maxsize=1)
def served_model_name() -> str:
    """Model file name reported by llama-server (e.g. 'SmolLM3-3B-Q4_K_M.gguf')."""
    try:
        data = _request("/v1/models", None, timeout=5)
        mid = data["data"][0]["id"]
        return os.path.basename(str(mid))
    except Exception:
        return os.path.basename(os.environ.get("VITRA_MODEL_PATH", "unknown"))


@lru_cache(maxsize=1)
def default_pool() -> tuple[dict[str, Any], ...]:
    try:
        return tuple(read_jsonl(DEV_GOLD))
    except OSError:
        return ()


def prompt_version() -> str:
    return os.environ.get("VITRA_PROMPT_VERSION") or PROMPT_VERSION


def classify_with_model(
    item: dict[str, Any], pool: Sequence[dict[str, Any]] | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Ask the local model for the judgment fields of one item. Returns (raw_json, info)."""
    if pool is None:
        pool = [p for p in default_pool() if p["item_id"] != item.get("item_id")]
    name = served_model_name()
    no_think = "smollm" in name.lower()
    payload: dict[str, Any] = {
        "messages": build_messages(item, pool, no_think=no_think, version=prompt_version()),
        "temperature": 0,
        "seed": 0,
        "max_tokens": int(os.environ.get("VITRA_MAX_TOKENS", "450")),
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "vitra_labels",
                "strict": True,
                "schema": output_schema(item.get("source") or "news"),
            },
        },
        "cache_prompt": True,
    }
    if no_think:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    timeout = float(os.environ.get("VITRA_LLM_TIMEOUT", "180"))
    t0 = time.perf_counter()
    last: Exception | None = None
    for _attempt in range(2):
        try:
            resp = _request("/v1/chat/completions", payload, timeout)
            content = resp["choices"][0]["message"]["content"]
            raw = json.loads(content)
            if not isinstance(raw, dict):
                raise ModelError("model output is not a JSON object")
            usage = resp.get("usage", {})
            timings = resp.get("timings", {})
            return raw, {
                "model": name,
                "prompt_version": prompt_version(),
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "cached_tokens": timings.get("cache_n"),
            }
        except (ModelError, KeyError, IndexError, json.JSONDecodeError) as exc:
            last = exc
    raise ModelError(f"model call failed: {last}")
