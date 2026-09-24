#!/bin/bash
# Boots DuckStation into the operator's disc image. No desktop apps or setup wizard.
set -euo pipefail

/defaults/require-media.sh

settings_src="/defaults/settings.ini"
user_dir="${HOME}/.local/share/duckstation"
mkdir -p "${user_dir}/bios"
cp "$settings_src" "${user_dir}/settings.ini"

if [[ -d /bios ]]; then
  find /bios -type f -maxdepth 1 -print0 2>/dev/null | while IFS= read -r -d '' bios_file; do
    ln -sfn "$bios_file" "${user_dir}/bios/$(basename "$bios_file")"
  done
fi

runner="/opt/duckstation/AppRun"
if [[ ! -x "$runner" ]]; then
  echo "ps1-room: DuckStation is not installed in the image." >&2
  exit 1
fi

# Selkies injects browser pads through this interposer. Force it so AppRun
# always sees virtual js0/js1 even if s6 env did not propagate.
interposer="/usr/lib/selkies_joystick_interposer.so"
fake_udev="/opt/lib/libudev.so.1.0.0-fake"
if [[ -f "$interposer" && -f "$fake_udev" ]]; then
  export LD_PRELOAD="${interposer}:${fake_udev}${LD_PRELOAD:+:${LD_PRELOAD}}"
fi

/defaults/maximize-game.sh &

exec "$runner" -nogui -fullscreen -fastboot -- "${GAMES_DIR:-/games}/${GAME_FILE}"
