#!/usr/bin/env bash
# One shot: ensure Docker → build image if needed → LAN lobby on :8791.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/lobby"

# Server/local overrides (e.g. /opt/ps1-ps2-multiplayer/.env with GAMES_DIR=/var/lib/...).
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PORT="${PORT:-8791}"
export GAMES_DIR="${GAMES_DIR:-$HOME/ps1-rooms/games}"
export BIOS_DIR="${BIOS_DIR:-$HOME/ps1-rooms/bios}"
export GAMES_DIR_PS2="${GAMES_DIR_PS2:-$HOME/ps1-rooms/games-ps2}"
export BIOS_DIR_PS2="${BIOS_DIR_PS2:-$HOME/ps1-rooms/bios-ps2}"
export ROOM_IMAGE="${ROOM_IMAGE:-ps1-room:local}"
export DOCKER_NETWORK="${DOCKER_NETWORK:-ps1-rooms}"
export BIND_HOST="${BIND_HOST:-0.0.0.0}"
export MAX_ROOMS="${MAX_ROOMS:-1}"
export PREVIEW="${PREVIEW:-false}"
export REQUIRE_MEDIA="${REQUIRE_MEDIA:-true}"
export TLS="${TLS:-true}"
export ROOM_CPUS="${ROOM_CPUS:-3.5}"
export ROOM_MEMORY="${ROOM_MEMORY:-3g}"
export ROOM_CPUS_PS2="${ROOM_CPUS_PS2:-4}"
export ROOM_MEMORY_PS2="${ROOM_MEMORY_PS2:-6g}"
export LIGA_REQUIRE_AUTH="${LIGA_REQUIRE_AUTH:-true}"
export LIGA_TEKKEN3_SLUG="${LIGA_TEKKEN3_SLUG:-tekken-3}"
export PORT

# Optional local secrets (never commit). See lobby/env.liga.example and docs/LIGA_SYNC.md.
if [[ -f "$ROOT/lobby/.env.liga" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/lobby/.env.liga"
  set +a
fi
# Re-apply require-auth default after sourcing so empty file cannot unset intentionally.
export LIGA_REQUIRE_AUTH="${LIGA_REQUIRE_AUTH:-true}"

if [[ "${LIGA_REQUIRE_AUTH}" == "true" ]]; then
  if [[ -z "${LIGA_WP_URL:-}" ]]; then
    echo "liga sync: set LIGA_WP_URL in lobby/.env.liga" >&2
  elif [[ -z "${LIGA_WP_SYNC_SECRET:-}" && -z "${LIGA_WP_APP_PASSWORD:-}" ]]; then
    echo "liga sync: set LIGA_WP_SYNC_SECRET (local) or LIGA_WP_APP_PASSWORD in lobby/.env.liga" >&2
    echo "  On HTTP localhost, sync secret is preferred (same value as LIGA_SYNC_SECRET in wp-config)." >&2
  fi
fi

wait_for_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  echo "Starting Docker Desktop..."
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  local i
  for i in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      echo "Docker ready."
      return 0
    fi
    sleep 2
  done
  echo "Docker did not become ready in time. Open Docker Desktop and retry." >&2
  exit 1
}

if [[ ! -d "$GAMES_DIR" || ! -d "$BIOS_DIR" ]]; then
  echo "Missing media dirs." >&2
  echo "  GAMES_DIR=$GAMES_DIR" >&2
  echo "  BIOS_DIR=$BIOS_DIR" >&2
  exit 1
fi
# PS2 dirs are optional until you enable a ps2 catalog entry.
mkdir -p "$GAMES_DIR_PS2" "$BIOS_DIR_PS2"

wait_for_docker
docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true

# Rebuild when the image is missing or room-image/ sources changed (PS2/PCSX2, etc.).
stamp_file="$ROOT/lobby/.room-image-stamp"
src_hash="$(
  find "$ROOT/room-image" -type f ! -name '.DS_Store' -print0 \
    | sort -z \
    | xargs -0 shasum 2>/dev/null \
    | shasum \
    | awk '{print $1}'
)"
if ! docker image inspect "$ROOM_IMAGE" >/dev/null 2>&1 \
  || [[ "$(cat "$stamp_file" 2>/dev/null || true)" != "$src_hash" ]]; then
  echo "Building $ROOM_IMAGE..."
  bash "$ROOT/scripts/build-room-image.sh"
  printf '%s\n' "$src_hash" > "$stamp_file"
fi

PID="$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "${PID:-}" ]]; then
  echo "Stopping old lobby on :$PORT (pid $PID)..."
  kill $PID 2>/dev/null || true
  sleep 1
fi

# Free leftover rooms so MAX_ROOMS is not stuck.
docker rm -f $(docker ps -aq --filter name=ps1-room) >/dev/null 2>&1 || true

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "Lobby starting..."
echo "  Local: https://127.0.0.1:${PORT}"
if [[ -n "${LAN_IP:-}" ]]; then
  echo "  LAN:   https://${LAN_IP}:${PORT}  ← use this on the other machine (accept cert once)"
fi

exec node src/index.js
