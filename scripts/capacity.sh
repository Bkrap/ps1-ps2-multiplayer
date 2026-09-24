#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HOST_CPUS="${HOST_CPUS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
node "$ROOT/scripts/capacity.mjs"
