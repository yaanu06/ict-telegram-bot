# Server-side market and AI proxy

This optional Node 20 service keeps provider credentials outside the browser. It does not place orders. The Mini App can use the local tvkit service as its primary market source, while Twelve Data remains available as an explicit fallback.

For phone-only use, deploy the repository with the included `Dockerfile` and
`render.yaml`. The container starts tvkit and the Node proxy together and also
serves the Mini App from the same URL. After the first deployment, open that
URL in the Telegram Mini App; no terminal or local service is required.

## Run

```powershell
$env:TWELVE_DATA_API_KEY = '...'
$env:AI_PROVIDER = 'GEMINI'
$env:GEMINI_API_KEY = '...'
$env:GEMINI_MODEL = 'gemini-3.5-flash-lite'
$env:DEEPSEEK_API_KEY = '...'
$env:TVKIT_BASE_URL = 'http://127.0.0.1:8790'
$env:PROXY_CORS_ORIGIN = 'https://your-mini-app.example'
npm run proxy
```

For local setup, copy `server/.env.example` to `.env` and load those values
through the process manager or shell. Never commit the copied `.env` file.

Routes:

- `GET /health`
- `GET /api/tvkit/quote?symbol=OANDA%3AXAUUSD`
- `GET /api/tvkit/time_series?symbol=OANDA%3AXAUUSD&interval=1h&outputsize=200`
- `GET /api/twelve/quote?symbol=EUR%2FUSD`
- `GET /api/twelve/time_series?symbol=EUR%2FUSD&interval=1h&outputsize=200`
- `POST /api/deepseek/chat`
- `POST /api/gemini/chat` (server-side Gemini provider)
- `POST /api/ai/chat` (routes to `AI_PROVIDER`)
- `POST /api/audit` (requires `AUDIT_WRITE_TOKEN` and `X-Audit-Token`)
- `GET /api/audit?limit=100` (requires the separate `AUDIT_READ_TOKEN`)

The proxy validates symbols, intervals, output size, request bodies, provider configuration, and rate limits. Set `AI_PROVIDER=GEMINI` for the production Gemini path or `AI_PROVIDER=DEEPSEEK` for rollback/testing; a scan calls only the selected provider. Gemini uses the server-side `GEMINI_API_KEY` and configurable `GEMINI_MODEL`, while DeepSeek remains available through its existing route. Twelve Data routes have a separate 50-request-per-minute default account budget (`PROXY_TWELVE_GLOBAL_MAX_REQUESTS`) plus a per-client abuse budget (`PROXY_TWELVE_MAX_REQUESTS`) to stay below the Grow 55 plan limit. tvkit routes have a separate per-client budget (`PROXY_TVKIT_MAX_REQUESTS`, 120 per minute by default) and forward to `TVKIT_BASE_URL`; they require no paid provider key. Upstream provider calls are bounded by `PROXY_UPSTREAM_TIMEOUT_MS` (40 seconds by default). Authenticated audit records are appended to `AUDIT_FILE_PATH` as JSON Lines with credential-like fields removed. It never returns provider credentials and has no broker or order route.

To use it from a separately hosted Mini App, set `window.__ICT_PROXY_BASE_URL__` before `script.js` loads. For the default same-origin deployment, the server injects that value automatically and the client calls `/api/tvkit/*`. To intentionally use the paid fallback, run `setMarketDataProvider('TWELVE_DATA')`; the client then calls `/api/twelve/*`. Set `window.__ICT_AUDIT_WRITE_TOKEN__` only if you want the browser's sanitized analysis records forwarded to the proxy; keep `AUDIT_READ_TOKEN` private.
