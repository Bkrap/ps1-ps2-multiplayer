#!/bin/bash
# Proves the pad contract, then prints the two-browser check for the VPS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/lobby" && node --test --test-name-pattern "Pad|pads")
cat <<'EOF'

VPS check once the disc image, BIOS, and two gamepads are connected:
  1. Open the site, create a Tekken 3 room, and press Start match.
  2. Join that code in a second browser. Each pad must move only its own fighter.
  3. Join again in a third browser. That person sees the same picture and cannot move either fighter.
If both pads move the same fighter, stop and fix room-image/root/defaults/settings.ini before adding games.
EOF
