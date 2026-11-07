#!/usr/bin/env bash
# List internet sockets for llama-server, Python, and vitra that are not loopback.
# Read only. This does not start, stop, or restart any process.
#
#   scripts/check_loopback.sh
#
# Exit 0 when every matching socket is 127.0.0.0/8, ::1, or localhost, or when
# none of those commands hold an internet socket. Exit 1 when a matching socket
# is something else. Exit 2 when lsof is not available.
set -euo pipefail

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof not found" >&2
  exit 2
fi

# lsof truncates command names (llama-server shows up as llama-ser). -c matches
# a prefix. -a keeps only internet sockets for that set.
raw=$(lsof -nP -i -a -c llama -c Python -c python -c vitra 2>/dev/null || true)

# BSD awk on macOS only accepts statements inside an action block.
hits=$(printf '%s\n' "$raw" | awk '
  NR == 1 && $1 == "COMMAND" { next }
  NF < 9 { next }
  {
    name = $9
    split(name, ends, "->")
    ok = 1
    for (i in ends) if (ends[i] !~ /^(127\.[0-9.]+|\[::1\]|localhost):/) ok = 0
    if (!ok) print
  }
')

if [[ -n "$hits" ]]; then
  printf '%s\n' "$hits"
  echo "non-loopback sockets: llama, python, or vitra" >&2
  exit 1
fi

echo "no non-loopback sockets for llama, python, or vitra"
exit 0
