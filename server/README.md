# Server-side market and AI proxy

This optional Node 20 service keeps provider credentials outside the browser. It does not place orders. The Mini App can use the local tvkit service as its primary market source, while Twelve Data remains available as an explicit fallback.

For phone-only use, deploy the repository with the included `Dockerfile` and
`render.yaml`. The container starts tvkit and the Node proxy together and also
serves the Mini App from the same URL. After the first deployment, open that
URL in the Telegram Mini App; no terminal or local service is required.

## Run

```powershell
$env:TWELVE_DATA_API_KEY = '...'
$env:AI_PROVIDER = 'DEEPSEEK'
$env:DEEPSEEK_API_KEY = '...'
$env:DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
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
- `GET|POST|DELETE /mcp` (read-only ICT Ghost Streamable HTTP MCP endpoint; standards-compliant remote MCP clients may use the SDK-supported methods on this path)
- `POST /api/audit` (requires `AUDIT_WRITE_TOKEN` and `X-Audit-Token`)
- `GET /api/audit?limit=100` (requires the separate `AUDIT_READ_TOKEN`)

The proxy validates symbols, intervals, output size, request bodies, provider configuration, and rate limits. Production uses `AI_PROVIDER=DEEPSEEK`, the server-side `DEEPSEEK_API_KEY`, and `DEEPSEEK_API_URL`; a scan calls only the selected provider. The explicit Gemini route remains available only for controlled rollback/comparison when separately configured and is not required by production. Twelve Data routes have a separate 50-request-per-minute default account budget (`PROXY_TWELVE_GLOBAL_MAX_REQUESTS`) plus a per-client abuse budget (`PROXY_TWELVE_MAX_REQUESTS`) to stay below the Grow 55 plan limit. tvkit routes have a separate per-client budget (`PROXY_TVKIT_MAX_REQUESTS`, 120 per minute by default) and forward to `TVKIT_BASE_URL`; they require no paid provider key. Upstream provider calls are bounded by `PROXY_UPSTREAM_TIMEOUT_MS` (40 seconds by default). Authenticated audit records are appended to `AUDIT_FILE_PATH` as JSON Lines with credential-like fields removed. It never returns provider credentials and has no broker or order route.

To use it from a separately hosted Mini App, set `window.__ICT_PROXY_BASE_URL__` before `script.js` loads. For the default same-origin deployment, the server injects that value automatically and the client calls `/api/tvkit/*`. To intentionally use the paid fallback, run `setMarketDataProvider('TWELVE_DATA')`; the client then calls `/api/twelve/*`. Set `window.__ICT_AUDIT_WRITE_TOKEN__` only if you want the browser's sanitized analysis records forwarded to the proxy; keep `AUDIT_READ_TOKEN` private.

## ICT Ghost MCP

The existing Render service also exposes a read-only remote MCP endpoint:

`https://ict-telegram-bot-temf.onrender.com/mcp`

It exposes the deployable specification resource `ict://ghost/specification`
from `ghost/ICT_GHOST.md`, plus `get_quote`, `get_time_series`, and
`get_market_snapshot` tools backed by the existing TVKit path. Ghost semantic
intervals are exactly `1day`, `4h`, `1h`, `15min`, and `5min`; the snapshot
tool requests 200 bars for each. The MCP surface has no order, broker,
credential, filesystem, shell, or arbitrary HTTP capability.

Use a standards-compliant MCP-capable client configured with the URL above.
Clients may require user approval for tool calls and their setup varies by
product. The MCP server provides current market data and the authoritative
Ghost methodology; it does not place trades.
