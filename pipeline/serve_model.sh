#!/usr/bin/env bash
# Start the local model server on loopback only.
#   pipeline/serve_model.sh models/SmolLM3-3B-Q4_K_M.gguf [parallel_slots] [ctx_per_slot]
# Uses VITRA_LLM_KEY as the API key when set. Never binds a public interface.
set -euo pipefail
MODEL="${1:?usage: serve_model.sh <model.gguf> [slots] [ctx_per_slot]}"
SLOTS="${2:-4}"
CTX_PER_SLOT="${3:-8192}"
PORT="${VITRA_LLM_PORT:-8080}"
ARGS=(-m "$MODEL" --host 127.0.0.1 --port "$PORT" -ngl 99 -fa on
      -np "$SLOTS" -c "$((SLOTS * CTX_PER_SLOT))" --no-webui)
if [[ -n "${VITRA_LLM_KEY:-}" ]]; then ARGS+=(--api-key "$VITRA_LLM_KEY"); fi
exec llama-server "${ARGS[@]}"
