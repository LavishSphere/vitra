#!/usr/bin/env bash
# Start Vitra on this machine: model server, API and web app, all on 127.0.0.1.
# A thin wrapper around `python -m app.launch local` (app/launch.py).
#
#   scripts/run_local.sh [--dev-web | --no-web] [--no-browser] [--predictions SETS] [model.gguf]
#
# 1. llama-server on 127.0.0.1:8080, only if nothing healthy is already there.
#    Model: the argument, else VITRA_MODEL_PATH (environment or .env), else
#    models/Llama-3.2-3B-Instruct-Q4_K_M.gguf, else the first models/*.gguf. Without a
#    model the API still starts, and transcript intake reports an error instead of a result.
# 2. The API on 127.0.0.1:8000 with a fresh random token. By default it also
#    serves the prebuilt web app (web/dist) from the same origin, and the browser
#    opens http://127.0.0.1:8000/#t=<token>. The page reads the token from the
#    fragment, which the browser never sends to any server. No node process runs.
#    --dev-web instead starts the vite dev server on 127.0.0.1:5173 from the
#    installed web/node_modules (for working on the frontend).
# 3. --predictions picks the prediction sets the API loads ("all", "none", or
#    e.g. "test,unlabeled"); same as VITRA_PREDICTIONS.
# Ctrl+C stops everything this script started. Each stage prints its timing.
# Python: VITRA_PYTHON, else .venv/bin/python, else python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${VITRA_PYTHON:-$ROOT/.venv/bin/python}"
[[ -x "$PY" ]] || PY="$(command -v python3)"
cd "$ROOT"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  exec "$PY" -m app.launch --help
fi
exec "$PY" -m app.launch local "$@"
