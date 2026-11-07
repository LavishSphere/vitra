#!/usr/bin/env bash
# Start the local model server on loopback only.
#   pipeline/serve_model.sh models/<model>.gguf [parallel_slots] [ctx_per_slot]
# Writes the key this process passes to --api-key into data/derived/llm_key.txt
# (mode 600) before exec, so a later reuse reads the same key.
# Never binds a public interface.
set -euo pipefail
MODEL="${1:?usage: serve_model.sh <model.gguf> [slots] [ctx_per_slot]}"
SLOTS="${2:-4}"
CTX_PER_SLOT="${3:-8192}"
PORT="${VITRA_LLM_PORT:-8080}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="$ROOT/data/derived/llm_key.txt"

if lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "serve_model.sh: port $PORT is already in use; leaving the key file unchanged" >&2
  exit 1
fi

if [[ -z "${VITRA_LLM_KEY:-}" && -r "$KEY_FILE" ]]; then
  VITRA_LLM_KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
fi
if [[ -z "${VITRA_LLM_KEY:-}" ]]; then
  VITRA_LLM_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
fi
export VITRA_LLM_KEY
mkdir -p "$(dirname "$KEY_FILE")"
umask 077
printf '%s\n' "$VITRA_LLM_KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

ARGS=(-m "$MODEL" --host 127.0.0.1 --port "$PORT" -ngl 99 -fa on
      -np "$SLOTS" -c "$((SLOTS * CTX_PER_SLOT))" --no-webui
      --api-key "$VITRA_LLM_KEY")
exec llama-server "${ARGS[@]}"
