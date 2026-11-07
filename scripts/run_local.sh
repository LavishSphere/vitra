#!/usr/bin/env bash
# Start Vitra on this machine: model server, API and web app, all on 127.0.0.1.
#
#   scripts/run_local.sh [--dev-web | --no-web] [--no-browser] [--predictions SETS] [model.gguf]
#
# 1. llama-server on 127.0.0.1:8080, only if nothing healthy is already there.
#    Model: the argument, else VITRA_MODEL_PATH (environment or .env), else
#    models/Llama-3.2-3B-Instruct-Q4_K_M.gguf if present. Without a model the API
#    still starts, and transcript intake reports an error instead of a result.
# 2. The API on 127.0.0.1:8000 with a fresh random token. By default it also
#    serves the prebuilt web app (web/dist) from the same origin, and the browser
#    opens http://127.0.0.1:8000/#t=<token>. The page reads the token from the
#    fragment, which the browser never sends to any server. No node process runs.
#    --dev-web instead starts the vite dev server on 127.0.0.1:5173 from the
#    installed web/node_modules (for working on the frontend).
# 3. --predictions picks the prediction sets the API loads ("all", "none", or
#    e.g. "test,unlabeled"); same as VITRA_PREDICTIONS.
# Ctrl+C stops everything this script started. Each stage prints its timing.
#
# run_offline.sh sources this file for its functions. Bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${VITRA_PYTHON:-$ROOT/.venv/bin/python}"
[[ -x "$PY" ]] || PY="$(command -v python3)"
LLM_PORT="${VITRA_LLM_PORT:-8080}"
API_PORT="${VITRA_API_PORT:-8000}"
DEV_WEB_PORT=5173   # the only dev-server port the API's CORS policy allows
WEB_DIST="${VITRA_WEB_DIST:-$ROOT/web/dist}"
DEFAULT_MODEL="models/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
RUN_DIR="${TMPDIR:-/tmp}/vitra-run.$$"
STARTED_PIDS=""
API_PID=""
WEB_PID=""
WEB_MODE=""      # dist | dev | none
T0_MS=0

now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time*1000'; }
stage() { # stage <message>: print with seconds since launch
  local t; t=$(now_ms)
  printf '[vitra %6.1fs] %s\n' "$(perl -e "printf '%.1f', ($t - $T0_MS) / 1000")" "$*"
}
die() { stage "ERROR: $*" >&2; exit 1; }

load_env() {
  # .env holds local config only (model path, prompt version).
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    set +a
  fi
  export VITRA_LLM_URL="http://127.0.0.1:${LLM_PORT}"
  mkdir -p "$RUN_DIR"
  chmod 700 "$RUN_DIR"
}

new_secret() { "$PY" -c 'import secrets; print(secrets.token_urlsafe(32))'; }
http_ok() { curl -fsS --noproxy '*' --max-time 2 -o /dev/null "$1" 2>/dev/null; }
wait_for() { # wait_for <url> <seconds> <pid or empty>
  local i=0 limit=$(( $2 * 4 ))
  while (( i < limit )); do
    http_ok "$1" && return 0
    if [[ -n "$3" ]] && ! kill -0 "$3" 2>/dev/null; then return 1; fi
    sleep 0.25; i=$((i + 1))
  done
  return 1
}
track() { STARTED_PIDS="$STARTED_PIDS $1"; }
port_free() { # port_free <port> <what>: refuse to start on top of another process
  local holder
  holder=$(lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  if [[ -n "$holder" ]]; then
    die "port $1 ($2) is already in use by pid $holder ($(ps -o comm= -p "$holder" 2>/dev/null)). Stop it first."
  fi
}

cleanup() {
  local pid
  for pid in $STARTED_PIDS; do kill "$pid" 2>/dev/null || true; done
  for pid in $STARTED_PIDS; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$RUN_DIR"
}

resolve_model() {
  local m="${1:-${VITRA_MODEL_PATH:-}}"
  [[ -z "$m" && -f "$ROOT/$DEFAULT_MODEL" ]] && m="$DEFAULT_MODEL"
  [[ -z "$m" ]] && return 0
  [[ -f "$m" ]] || m="$ROOT/$m"
  [[ -f "$m" ]] && echo "$m"
  return 0
}

ensure_llm() {
  if http_ok "$VITRA_LLM_URL/health"; then
    stage "model server already running on 127.0.0.1:${LLM_PORT}, reusing it"
    # A server started by pipeline/ keeps its per-launch key in data/derived/llm_key.txt (mode 600).
    if [[ -z "${VITRA_LLM_KEY:-}" && -r "$ROOT/data/derived/llm_key.txt" ]]; then
      VITRA_LLM_KEY="$(tr -d '[:space:]' <"$ROOT/data/derived/llm_key.txt")"
      export VITRA_LLM_KEY
    fi
    local code
    code=$(curl -s --noproxy '*' --max-time 2 -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${VITRA_LLM_KEY:-none}" "$VITRA_LLM_URL/v1/models" || true)
    [[ "$code" == "200" ]] \
      || stage "WARNING: the running model server rejects our key (HTTP $code). Intake will report an error."
    return 0
  fi
  local model; model="$(resolve_model "${1:-}")"
  if [[ -z "$model" ]]; then
    stage "WARNING: no model file found (set VITRA_MODEL_PATH). Intake will report an error."
    return 0
  fi
  command -v llama-server >/dev/null || die "llama-server not found on PATH"
  port_free "$LLM_PORT" "model server"
  # A fresh key for this launch, shared with the API process through the environment only.
  VITRA_LLM_KEY="$(new_secret)"
  export VITRA_LLM_KEY VITRA_MODEL_PATH="$model"
  stage "starting model server: $(basename "$model") on 127.0.0.1:${LLM_PORT}"
  VITRA_LLM_PORT="$LLM_PORT" "$ROOT/pipeline/serve_model.sh" "$model" >"$RUN_DIR/llama.log" 2>&1 &
  local pid=$!
  track "$pid"
  wait_for "$VITRA_LLM_URL/health" 180 "$pid" \
    || { tail -5 "$RUN_DIR/llama.log" >&2; die "model server did not become healthy"; }
  stage "model server ready"
}

choose_web_mode() { # choose_web_mode <requested: auto|dist|dev|none>
  case "$1" in
    none) WEB_MODE=none ;;
    dev) WEB_MODE=dev ;;
    dist)
      [[ -f "$WEB_DIST/index.html" ]] \
        || die "no prebuilt web app at $WEB_DIST. Build it while online: (cd web && npm run build)"
      WEB_MODE=dist ;;
    auto)
      if [[ -f "$WEB_DIST/index.html" ]]; then WEB_MODE=dist
      elif [[ -x "$ROOT/web/node_modules/.bin/vite" ]]; then WEB_MODE=dev
      else WEB_MODE=none; stage "WARNING: no web build and no web/node_modules; starting the API only"
      fi ;;
  esac
  if [[ "$WEB_MODE" == "dist" ]]; then
    stage "web app: prebuilt $(du -sh "$WEB_DIST" | cut -f1 | tr -d ' ') bundle from $(date -r "$WEB_DIST/index.html" '+%a %H:%M'), served by the API"
  fi
}

start_api() {
  "$PY" -c 'import fastapi, uvicorn, pydantic' 2>/dev/null \
    || die "API dependencies missing in $PY (install requirements.txt while online, before the demo)"
  port_free "$API_PORT" "API"
  VITRA_API_TOKEN="$(new_secret)"
  export VITRA_API_TOKEN VITRA_API_HOST=127.0.0.1 VITRA_API_PORT="$API_PORT" VITRA_WEB_DIST="$WEB_DIST"
  stage "starting API on 127.0.0.1:${API_PORT}"
  # The API log holds no request bodies (lengths and hashes only); it lives in a private temp dir.
  (cd "$ROOT" && exec "$PY" -m app) >"$RUN_DIR/api.log" 2>&1 &
  API_PID=$!
  track "$API_PID"
  wait_for "http://127.0.0.1:${API_PORT}/api/health" 60 "$API_PID" \
    || { grep -v 'X-Vitra-Token' "$RUN_DIR/api.log" | tail -5 >&2; die "API did not start"; }
  stage "API ready ($(curl -fsS --noproxy '*' "http://127.0.0.1:${API_PORT}/api/health" \
    | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print("%d items, model server %s%s" % (d["n_items"], "up" if d["model_loaded"] else "down", (", " + d["model"]) if d["model"] else ""))'))"
  if [[ "$WEB_MODE" == "dist" ]]; then
    http_ok "http://127.0.0.1:${API_PORT}/" || die "the API did not serve the web app"
    stage "web app ready: http://127.0.0.1:${API_PORT}/ (same origin as the API)"
  fi
}

start_dev_web() {
  local vite="$ROOT/web/node_modules/.bin/vite"
  [[ -x "$vite" ]] || die "web/node_modules is missing (run 'npm ci' in web/ while online)"
  port_free "$DEV_WEB_PORT" "web dev server"
  stage "starting web dev server on 127.0.0.1:${DEV_WEB_PORT}"
  (cd "$ROOT/web" && VITE_DATA_SOURCE=api VITE_VITRA_TOKEN="$VITRA_API_TOKEN" \
     VITE_API_BASE="http://127.0.0.1:${API_PORT}" \
     exec "$vite" --host 127.0.0.1 --port "$DEV_WEB_PORT" --strictPort) >"$RUN_DIR/web.log" 2>&1 &
  WEB_PID=$!
  track "$WEB_PID"
  wait_for "http://127.0.0.1:${DEV_WEB_PORT}/" 60 "$WEB_PID" \
    || { tail -5 "$RUN_DIR/web.log" >&2; die "web dev server did not start"; }
  stage "web dev server ready: http://127.0.0.1:${DEV_WEB_PORT}/"
}

app_url() {
  case "$WEB_MODE" in
    dist) echo "http://127.0.0.1:${API_PORT}/#t=${VITRA_API_TOKEN}" ;;
    dev) echo "http://127.0.0.1:${DEV_WEB_PORT}/" ;;
    *) echo "" ;;
  esac
}

open_browser() {
  local url; url="$(app_url)"
  [[ -z "$url" ]] && return 0
  if command -v open >/dev/null; then open "$url"
  elif command -v xdg-open >/dev/null; then xdg-open "$url"
  else stage "no browser opener found; open the URL below by hand"; return 0
  fi
  stage "browser opened on http://127.0.0.1:$([[ "$WEB_MODE" == dist ]] && echo "$API_PORT" || echo "$DEV_WEB_PORT")/"
}

print_summary() {
  echo "[vitra] X-Vitra-Token for this launch: ${VITRA_API_TOKEN}"
  [[ "$WEB_MODE" == "dist" ]] && echo "[vitra] app: $(app_url)"
  echo "[vitra] logs for this launch: $RUN_DIR (deleted on exit). Ctrl+C stops everything."
}

main() {
  local web=auto browser=1 model=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-web) web=none ;;
      --dev-web) web=dev ;;
      --no-browser) browser=0 ;;
      --predictions) export VITRA_PREDICTIONS="${2:?--predictions needs a value}"; shift ;;
      *) model="$1" ;;
    esac
    shift
  done
  T0_MS=$(now_ms)
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  load_env
  choose_web_mode "$web"
  ensure_llm "$model"
  start_api
  [[ "$WEB_MODE" == "dev" ]] && start_dev_web
  (( browser )) && open_browser
  print_summary
  wait "$API_PID"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
