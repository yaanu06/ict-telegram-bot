#!/bin/sh
set -eu

# The hosted container owns the tvkit process, so phone users only need the
# public Mini App URL. Twelve Data remains optional and is never contacted
# unless the browser explicitly selects TWELVE_DATA.
export TVKIT_HOST="${TVKIT_HOST:-127.0.0.1}"
export TVKIT_PORT="${TVKIT_PORT:-8790}"
export TVKIT_BASE_URL="${TVKIT_BASE_URL:-http://127.0.0.1:${TVKIT_PORT}}"

python3 tools/tvkit_service.py &
tvkit_pid=$!

cleanup() {
    kill "$tvkit_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec node server/proxy.js
