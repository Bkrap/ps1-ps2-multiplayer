#!/bin/bash
# Start X11 capture of the Selkies display into /tmp/ps1-match.mp4
set -u

DISPLAY="${DISPLAY:-:1}"
WIDTH="${SELKIES_MANUAL_WIDTH:-960}"
HEIGHT="${SELKIES_MANUAL_HEIGHT:-540}"
OUT="${PS1_RECORD_PATH:-/tmp/ps1-match.mp4}"
PIDFILE="${PS1_RECORD_PID:-/tmp/ps1-record.pid}"

if [[ -f "$PIDFILE" ]]; then
  old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
    echo "ps1-record: already running pid=$old"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

rm -f "$OUT"
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ps1-record: ffmpeg missing" >&2
  exit 1
fi

# Give the desktop a moment after DuckStation fullscreen.
sleep 2

# Keep files under typical local PHP upload caps (was ~45MB for short matches).
ffmpeg -y -loglevel error \
  -f x11grab -video_size "${WIDTH}x${HEIGHT}" -framerate 20 -i "${DISPLAY}.0" \
  -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p \
  -movflags +faststart \
  -an "$OUT" </dev/null >/tmp/ps1-record.log 2>&1 &
echo $! > "$PIDFILE"
sleep 1
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "ps1-record: ffmpeg failed to stay up" >&2
  cat /tmp/ps1-record.log >&2 || true
  rm -f "$PIDFILE"
  exit 1
fi
echo "ps1-record: started pid=$(cat "$PIDFILE") -> $OUT"
