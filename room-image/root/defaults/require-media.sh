#!/bin/bash
# Exit before any desktop starts when the operator's disc image or BIOS is missing.
set -euo pipefail

BIOS_DIR="${BIOS_DIR:-/bios}"
GAMES_DIR="${GAMES_DIR:-/games}"
GAME_FILE="${GAME_FILE:-}"

fail() {
  echo "ps1-room: $*" >&2
  exit 1
}

if [[ ! -d "$BIOS_DIR" ]]; then
  fail "PS1 BIOS directory is missing. Mount your own dumped BIOS at ${BIOS_DIR}."
fi

bios_found=0
while IFS= read -r -d '' bios_file; do
  if [[ -s "$bios_file" ]]; then
    bios_found=1
    break
  fi
done < <(find "$BIOS_DIR" -type f -print0 2>/dev/null || true)

if [[ "$bios_found" -ne 1 ]]; then
  fail "PS1 BIOS directory is empty. Copy your own dumped BIOS into ${BIOS_DIR} and start again."
fi

if [[ -z "$GAME_FILE" ]]; then
  fail "GAME_FILE is not set. Refusing to open a desktop without a game."
fi

case "$GAME_FILE" in
  */*) fail "GAME_FILE must be a file name inside the games directory, not a path." ;;
esac

game_path="${GAMES_DIR}/${GAME_FILE}"
if [[ ! -f "$game_path" || ! -s "$game_path" ]]; then
  fail "Game image is missing (${GAME_FILE}). Place your own disc image in the games directory."
fi

shopt -s nocasematch
if [[ "$GAME_FILE" == *.cue ]]; then
  shopt -u nocasematch
  game_dir="$(dirname "$game_path")"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ FILE[[:space:]]+\"([^\"]+)\" ]]; then
      referenced="${BASH_REMATCH[1]}"
      if [[ "$referenced" == /* || "$referenced" == *..* ]]; then
        fail "Cue sheet references a path outside the games directory."
      fi
      if [[ ! -f "${game_dir}/${referenced}" || ! -s "${game_dir}/${referenced}" ]]; then
        fail "Cue sheet references a missing file (${referenced})."
      fi
    fi
  done < "$game_path"
else
  shopt -u nocasematch
fi

echo "ps1-room: media check ok (${GAME_FILE})"
