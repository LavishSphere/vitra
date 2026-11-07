#!/usr/bin/env bash
# Offline entry point: confirm the network is off, then run Vitra with nothing able to reach out.
# A thin wrapper around the cross-platform launcher (app/launch.py), which Windows uses
# too (scripts/run_offline.ps1, scripts/run_offline.cmd), so every OS runs the same code.
#
#   scripts/run_offline.sh [--warn-only] [serve] [--no-web] [--no-browser] [--predictions SETS] [model.gguf]
#   scripts/run_offline.sh [--warn-only] --check [--no-intake] [--no-web] [model.gguf]
#   scripts/run_offline.sh [--warn-only] predict <dev|test|unlabeled> [--no-model] [--workers N] [--out PATH]
#
# Also: --llm-port N, --api-port N. Run with --help for the full description, including
# the network check (exit 3 when online), the proxy sinkhole and the socket audit (exit 4).
# Python: VITRA_PYTHON, else .venv/bin/python, else python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${VITRA_PYTHON:-$ROOT/.venv/bin/python}"
[[ -x "$PY" ]] || PY="$(command -v python3)"
cd "$ROOT"
exec "$PY" -m app.launch "$@"
