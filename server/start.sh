#!/bin/sh
set -eu

# The hosted container owns the tvdatafeed-enhanced process, so phone users
# only need the public Mini App URL. Twelve Data remains optional and is never
# contacted unless the browser explicitly selects TWELVE_DATA.
export TVKIT_HOST="${TVKIT_HOST:-0.0.0.0}"
export TVKIT_PORT="${TVKIT_PORT:-8790}"
export TVKIT_BASE_URL="${TVKIT_BASE_URL:-http://127.0.0.1:${TVKIT_PORT}}"
PYTHON="${PYTHON:-python3}"

"$PYTHON" tools/tvkit_service.py &
tvkit_pid=$!

cleanup() {
    kill "$tvkit_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait briefly so the first browser/proxy request does not race the Python
# service's socket bind. The proxy uses the same TVKIT_BASE_URL value. If the
# service never becomes healthy, fail the container start instead of running a
# Node proxy that can only return 502 for every market request.
if ! "$PYTHON" -c "
import sys, time, urllib.request
url = '${TVKIT_BASE_URL}/health'
for _ in range(30):
    try:
        urllib.request.urlopen(url, timeout=1).read()
        print('market-data service is ready at ' + url, file=sys.stderr)
        sys.exit(0)
    except Exception:
        time.sleep(1)
print('market-data service did not become ready at ' + url, file=sys.stderr)
sys.exit(1)
"; then
    echo "FATAL: market-data service failed to start; see Python output above" >&2
    exit 1
fi

exec node server/proxy.js
