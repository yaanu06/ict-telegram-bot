# Server-side market and AI proxy

This optional Node 20 service keeps Twelve Data and DeepSeek credentials outside the browser. It does not place orders.

## Run

```powershell
$env:TWELVE_DATA_API_KEY = '...'
$env:DEEPSEEK_API_KEY = '...'
$env:PROXY_CORS_ORIGIN = 'https://your-mini-app.example'
npm run proxy
```

Routes:

- `GET /health`
- `GET /api/twelve/quote?symbol=EUR%2FUSD`
- `GET /api/twelve/time_series?symbol=EUR%2FUSD&interval=1h&outputsize=200`
- `POST /api/deepseek/chat`
- `POST /api/audit` (requires `AUDIT_WRITE_TOKEN` and `X-Audit-Token`)
- `GET /api/audit?limit=100` (requires the separate `AUDIT_READ_TOKEN`)

The proxy validates symbols, intervals, output size, request bodies, provider configuration, and per-client rate limits. Twelve Data routes have a separate 50-request-per-minute default budget (`PROXY_TWELVE_MAX_REQUESTS`) to stay below the Grow 55 plan limit. Upstream provider calls are bounded by `PROXY_UPSTREAM_TIMEOUT_MS` (10 seconds by default). Authenticated audit records are appended to `AUDIT_FILE_PATH` as JSON Lines with credential-like fields removed. It never returns provider credentials and has no broker or order route.

To use it from the Mini App, set `window.__ICT_PROXY_BASE_URL__` before `script.js` loads. The client then calls `/api/twelve/*` and `/api/deepseek/chat` and does not send provider keys. Set `window.__ICT_AUDIT_WRITE_TOKEN__` only if you want the browser's sanitized analysis records forwarded to the proxy; keep `AUDIT_READ_TOKEN` private.
