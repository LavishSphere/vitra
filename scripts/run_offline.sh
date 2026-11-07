#!/usr/bin/env bash
# Offline entry point: confirm the network is off, then run Vitra with nothing able to reach out.
#
#   scripts/run_offline.sh [--warn-only] [serve] [--no-web] [--no-browser] [--predictions SETS] [model.gguf]
#       cold start: model server, then the API, which also serves the prebuilt web
#       app (web/dist) on the same origin; then open http://127.0.0.1:8000/#t=<token>.
#       Nothing is built or installed, and no node process runs.
#   scripts/run_offline.sh [--warn-only] --check [--no-intake] [--no-web] [model.gguf]
#       test mode: start everything, run a smoke sequence (health, evidence, trends,
#       the web page and every asset it references, one SYNTHETIC transcript
#       intake), audit every socket the whole time, stop everything, and exit
#       non-zero if any step touched the network or a node process appeared
#   scripts/run_offline.sh [--warn-only] predict <dev|test|unlabeled> [--no-model] [--workers N] [--out PATH]
#       run the pipeline predict CLI on a package split; dev is also scored
#
# Network check: `curl https://example.com` must fail. If it succeeds the script
# stops, unless --warn-only (or VITRA_OFFLINE_WARN_ONLY=1) is given for development.
#
# While running, every proxy variable points at a closed loopback port, so any tool
# that honors them (pip, npm, curl, Python urllib/httpx) fails fast instead of
# reaching out. Loopback addresses are exempt. A socket audit polls `lsof` on every
# process this script started (and their children) and flags any socket that is
# not loopback-to-loopback, including UDP (DNS lookups). Polling is a sample every
# 0.3 s: it catches connections that stay open, and can miss one that opens and
# closes between samples; the proxy sinkhole covers most of those.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=run_local.sh
. "$ROOT/scripts/run_local.sh"

WARN_ONLY="${VITRA_OFFLINE_WARN_ONLY:-0}"
AUDIT_PID=""
AUDIT_FILE=""
INTAKE_SUMMARY_PY='
import json, sys
d = json.load(sys.stdin)
stages = ", ".join("%s %d ms" % (s["name"], s["ms"]) for s in d["stages"])
err = (" error: " + d["error"]) if d.get("error") else ""
spans = len(d["evidence"]["aspects"]) if d.get("evidence") else 0
print("[vitra]         intake status=%s, %d verified span(s) (%s)%s" % (d["status"], spans, stages, err))
sys.exit(0 if d["status"] in ("complete", "abstained") else 1)
'

check_offline() {
  if curl -sS --noproxy '*' --max-time 3 -o /dev/null https://example.com 2>/dev/null; then
    if [[ "$WARN_ONLY" == "1" ]]; then
      stage "WARNING: https://example.com is reachable, so this is NOT an offline run (--warn-only)"
    else
      stage "https://example.com is reachable. Turn the network off, or pass --warn-only for development."
      exit 3
    fi
  else
    stage "offline confirmed: https://example.com is unreachable"
  fi
}

sinkhole_network() {
  local dead="http://127.0.0.1:9"   # port 9 (discard) has no listener
  export HTTP_PROXY="$dead" HTTPS_PROXY="$dead" ALL_PROXY="$dead"
  export http_proxy="$dead" https_proxy="$dead" all_proxy="$dead"
  export NO_PROXY="127.0.0.1,localhost,::1" no_proxy="127.0.0.1,localhost,::1"
  export npm_config_offline=true PIP_NO_INDEX=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
  export DO_NOT_TRACK=1 VITE_CJS_IGNORE_WARNING=1
}

descendants() { # every descendant pid of the given pids
  local p c
  for p in "$@"; do
    for c in $(pgrep -P "$p" 2>/dev/null || true); do
      echo "$c"
      descendants "$c"
    done
  done
}

audit_pids() {
  local pids="$STARTED_PIDS" llama
  llama=$(lsof -nP -t -iTCP:"$LLM_PORT" -sTCP:LISTEN 2>/dev/null || true)
  # shellcheck disable=SC2086
  { for p in $pids $llama; do echo "$p"; done; descendants $pids $llama; } | sort -u | paste -sd, -
}

audit_once() {
  local pids; pids="$(audit_pids)"
  [[ -z "$pids" ]] && return 0
  # NAME is the 9th column onward. A socket is fine only if its local side (and remote
  # side, when connected) is loopback.
  lsof -nP -i -a -p "$pids" 2>/dev/null | awk 'NR > 1 {
      name = $9
      split(name, ends, "->")
      ok = 1
      for (i in ends) if (ends[i] !~ /^(127\.[0-9.]+|\[::1\]|localhost):/) ok = 0
      if (!ok) print $1, $2, $8, name
    }' || true
}

start_audit() {
  AUDIT_FILE="$RUN_DIR/audit.txt"
  : >"$AUDIT_FILE"
  ( while :; do audit_once >>"$AUDIT_FILE"; sleep 0.3; done ) &
  AUDIT_PID=$!
  stage "socket audit running (lsof every 0.3 s on all Vitra processes)"
}

stop_audit() {
  [[ -n "$AUDIT_PID" ]] && kill "$AUDIT_PID" 2>/dev/null && wait "$AUDIT_PID" 2>/dev/null || true
  AUDIT_PID=""
}

audit_report() { # returns 1 if anything non-loopback was seen
  stop_audit
  audit_once >>"$AUDIT_FILE"
  if [[ -s "$AUDIT_FILE" ]]; then
    stage "NETWORK AUDIT FAILED: non-loopback sockets seen:"
    sort -u "$AUDIT_FILE" | sed 's/^/    /'
    return 1
  fi
  stage "network audit passed: every socket seen was loopback only"
}

smoke() { # smoke <with_intake>
  local api="http://127.0.0.1:${API_PORT}" tok="$VITRA_API_TOKEN" code n
  code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "$api/api/trends")
  [[ "$code" == "401" ]] || die "expected 401 without a token, got $code"
  n=$(curl -fsS --noproxy '*' -H "X-Vitra-Token: $tok" "$api/api/evidence" \
      | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)))')
  stage "API smoke: token enforced, $n evidence items served"
  curl -fsS --noproxy '*' -H "X-Vitra-Token: $tok" -o /dev/null "$api/api/trends?aspect=all&speaker=all"
  curl -fsS --noproxy '*' -H "X-Vitra-Token: $tok" -o /dev/null "$api/api/insights"
  curl -fsS --noproxy '*' -H "X-Vitra-Token: $tok" -o /dev/null "$api/api/gaps"
  stage "API smoke: trends, insights and gaps answered"
  if [[ "$WEB_MODE" == "dist" ]]; then web_smoke; fi
  if [[ "$1" == "1" ]]; then
    stage "intake smoke: one SYNTHETIC transcript through the local model"
    curl -fsS --noproxy '*' -H "X-Vitra-Token: $tok" -H 'Content-Type: application/json' \
      --data '{"title":"SYNTHETIC launcher check","product":"B","text":"SYNTHETIC TRANSCRIPT, invented for a launcher test. An invented oncologist said the subcutaneous injection cut chair time from hours to minutes, and patients preferred it."}' \
      "$api/api/intake" \
      | "$PY" -c "$INTAKE_SUMMARY_PY" || die "intake smoke failed (see the line above)"
    curl -fsS --noproxy '*' -X POST -H "X-Vitra-Token: $tok" -o /dev/null "$api/api/reset"
  fi
}

web_smoke() {
  local base="http://127.0.0.1:${API_PORT}" headers asset n=0
  headers=$(curl -fsS --noproxy '*' -D - -o "$RUN_DIR/index.html" "$base/") || die "web page did not load"
  echo "$headers" | grep -qi "^content-security-policy: default-src 'self'" \
    || die "web page is missing its Content-Security-Policy header"
  for asset in $(grep -oE '(src|href)="/[^"]+"' "$RUN_DIR/index.html" | sed -E 's/^(src|href)="//; s/"$//'); do
    curl -fsS --noproxy '*' -o /dev/null "$base$asset" || die "web asset $asset did not load"
    n=$((n + 1))
  done
  stage "web smoke: page + $n referenced asset(s) served same-origin, CSP present"
}

no_node_running() {
  local pids p
  pids="$(audit_pids | tr ',' ' ')"
  for p in $pids; do
    if [[ "$(ps -o comm= -p "$p" 2>/dev/null)" == *node* ]]; then
      die "a node process (pid $p) is running under the launcher; demo mode must not need one"
    fi
  done
  stage "no node process running under the launcher"
}

predict() {
  local split="${1:?usage: run_offline.sh predict <dev|test|unlabeled> [options]}"; shift
  local pkg="${VITRA_PACKAGE_DIR:-$ROOT/starter/hackathon_package_2026-11-05}"
  local items="$pkg/data/${split}.full.jsonl"
  [[ "$split" == "test" ]] && items="$pkg/data/test_inputs.full.jsonl"
  [[ -f "$items" ]] || die "missing $items"
  local out="$ROOT/data/derived/${split}_pred.jsonl" args=() use_model=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --out) out="$2"; shift 2 ;;
      --no-model) use_model=0; args+=("$1"); shift ;;
      *) args+=("$1"); shift ;;
    esac
  done
  if [[ "$use_model" == "1" ]]; then ensure_llm ""; fi
  stage "predicting $(wc -l <"$items" | tr -d ' ') $split items"
  (cd "$ROOT" && "$PY" -m pipeline.predict --items "$items" --out "$out" ${args[@]+"${args[@]}"})
  stage "predict done: $out"
  if [[ "$split" == "dev" ]]; then
    python3 -I "$pkg/scoring/score.py" --gold "$pkg/data/dev.jsonl" --pred "$out" --items "$items"
  fi
}

offline_main() {
  local mode=serve browser=1 intake=1 web=dist model="" rest=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --warn-only) WARN_ONLY=1 ;;
      --check) mode=check ;;
      --no-browser) browser=0 ;;
      --no-intake) intake=0 ;;
      --no-web) web=none ;;
      --predictions) export VITRA_PREDICTIONS="${2:?--predictions needs a value}"; shift ;;
      serve) mode=serve ;;
      predict) mode=predict; shift; rest=("$@"); break ;;
      *) model="$1" ;;
    esac
    shift
  done
  T0_MS=$(now_ms)
  trap 'stop_audit; cleanup' EXIT
  trap 'exit 130' INT TERM
  load_env
  check_offline
  sinkhole_network
  case "$mode" in
    predict)
      start_audit
      predict ${rest[@]+"${rest[@]}"}
      audit_report
      ;;
    check)
      start_audit
      choose_web_mode "$web"
      ensure_llm "$model"
      start_api
      stage "cold start complete (browser would open now)"
      smoke "$intake"
      no_node_running
      audit_report || exit 4
      stage "CHECK PASSED"
      ;;
    serve)
      start_audit
      choose_web_mode "$web"
      ensure_llm "$model"
      start_api
      if (( browser )); then open_browser; fi
      stage "cold start complete"
      print_summary
      stage "socket audit keeps running; any non-loopback socket is reported on exit"
      wait "$API_PID" || true
      audit_report || exit 4
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  offline_main "$@"
fi
