#!/bin/bash
# Stop X11 capture and leave /tmp/ps1-match.mp4 on disk.
set -u

PIDFILE="${PS1_RECORD_PID:-/tmp/ps1-record.pid}"
OUT="${PS1_RECORD_PATH:-/tmp/ps1-match.mp4}"

if [[ ! -f "$PIDFILE" ]]; then
  echo "ps1-record: not running"
  exit 0
fi

pid="$(cat "$PIDFILE" 2>/dev/null || true)"
rm -f "$PIDFILE"
if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
  kill -INT "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  kill -KILL "$pid" 2>/dev/null || true
fi

if [[ -f "$OUT" ]]; then
  echo "ps1-record: stopped size=$(wc -c < "$OUT")"
else
  echo "ps1-record: stopped but file missing" >&2
  exit 1
fi
