#!/bin/bash
# Force the DuckStation window to fill the virtual display.
set -u

DISPLAY="${DISPLAY:-:1}"
export DISPLAY

for _ in $(seq 1 60); do
  sleep 1
  if ! command -v wmctrl >/dev/null 2>&1; then
    continue
  fi
  while IFS= read -r line; do
    id="${line%% *}"
    title="$line"
    if echo "$title" | grep -Eqi 'tekken|duckstation'; then
      wmctrl -i -r "$id" -b add,fullscreen,above || true
      wmctrl -i -r "$id" -b add,maximized_vert,maximized_horz || true
      wmctrl -i -r "$id" -e 0,0,0,"${SELKIES_MANUAL_WIDTH:-960}","${SELKIES_MANUAL_HEIGHT:-540}" || true
      if command -v xdotool >/dev/null 2>&1; then
        xdotool windowactivate --sync "$id" 2>/dev/null || true
        xdotool key --window "$id" F11 2>/dev/null || true
      fi
      exit 0
    fi
  done < <(wmctrl -l 2>/dev/null || true)
done

exit 0
