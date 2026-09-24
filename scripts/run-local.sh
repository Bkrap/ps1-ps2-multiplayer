#!/usr/bin/env bash
# One shot: ensure Docker → build image if needed → LAN lobby on :8791.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/lobby"

PORT="${PORT:-8791}"
export GAMES_DIR="${GAMES_DIR:-$HOME/ps1-rooms/games}"
export BIOS_DIR="${BIOS_DIR:-$HOME/ps1-rooms/bios}"
export ROOM_IMAGE="${ROOM_IMAGE:-ps1-room:local}"
export DOCKER_NETWORK="${DOCKER_NETWORK:-ps1-rooms}"
export BIND_HOST="${BIND_HOST:-0.0.0.0}"
export MAX_ROOMS="${MAX_ROOMS:-1}"
export PREVIEW="${PREVIEW:-false}"
export REQUIRE_MEDIA="${REQUIRE_MEDIA:-true}"
export TLS="${TLS:-true}"
export ROOM_CPUS="${ROOM_CPUS:-3.5}"
export ROOM_MEMORY="${ROOM_MEMORY:-3g}"
export LIGA_REQUIRE_AUTH="${LIGA_REQUIRE_AUTH:-false}"
export PORT

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

wait_for_docker
docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true

if ! docker image inspect "$ROOM_IMAGE" >/dev/null 2>&1; then
  echo "Building $ROOM_IMAGE (first run)..."
  bash "$ROOT/scripts/build-room-image.sh"
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
