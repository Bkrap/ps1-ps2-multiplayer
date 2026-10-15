#!/bin/bash
# Boots DuckStation (PS1) or PCSX2 (PS2) into the operator's disc image.
set -euo pipefail

/defaults/require-media.sh

GAME_SYSTEM="$(printf '%s' "${GAME_SYSTEM:-ps1}" | tr '[:upper:]' '[:lower:]')"
game_path="${GAMES_DIR:-/games}/${GAME_FILE}"

# Selkies injects browser pads through this interposer. Force it so the
# emulator always sees virtual js0/js1 even if s6 env did not propagate.
interposer="/usr/lib/selkies_joystick_interposer.so"
fake_udev="/opt/lib/libudev.so.1.0.0-fake"
if [[ -f "$interposer" && -f "$fake_udev" ]]; then
  export LD_PRELOAD="${interposer}:${fake_udev}${LD_PRELOAD:+:${LD_PRELOAD}}"
fi

/defaults/maximize-game.sh &

if [[ "$GAME_SYSTEM" == "ps2" ]]; then
  cfg_root="${XDG_CONFIG_HOME:-${HOME}/.config}/PCSX2"
  bios_rw="${cfg_root}/bios"
  mkdir -p "${cfg_root}/inis" "$bios_rw" "${cfg_root}/memcards"
  # /bios is mounted read-only; PCSX2 must write .MEC next to the BIOS dump.
  if [[ -d /bios ]]; then
    find /bios -type f -maxdepth 1 -print0 2>/dev/null | while IFS= read -r -d '' bios_file; do
      cp -f "$bios_file" "${bios_rw}/$(basename "$bios_file")"
    done
  fi
  cp /defaults/pcsx2/PCSX2.ini "${cfg_root}/inis/PCSX2.ini"
  # Point Folders.Bios at the writable copy (ini ships with /bios placeholder).
  sed -i "s|^Bios = .*|Bios = ${bios_rw}|" "${cfg_root}/inis/PCSX2.ini"

  runner="/opt/pcsx2/AppRun"
  if [[ ! -x "$runner" ]]; then
    echo "ps1-room: PCSX2 is not installed in the image." >&2
    exit 1
  fi

  exec "$runner" -batch -fullscreen -- "$game_path"
fi

# PS1 — DuckStation
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

exec "$runner" -nogui -fullscreen -fastboot -- "$game_path"
