# Trading Assistant Architecture Report

## Current repository

This repository is a browser Telegram Mini App. `index.html` and `style.css` provide the UI; `script.js` contains the current application, data, analysis, AI, validation, manual-trade tracking, optional paper simulation, audit, and replay logic; `script.test.js` runs the deterministic test suite. `data/setups/` contains recorded setup artifacts.

The repository has no broker adapter or live order endpoint. Its normal workflow is manual user execution, with optional local paper simulation for testing. It also includes an optional dependency-free Node 20 proxy in `server/proxy.js` for server-held Twelve Data and DeepSeek credentials. Without that proxy, the browser compatibility path still accepts keys in local storage; production deployments should configure `window.__ICT_PROXY_BASE_URL__` and keep provider keys only in the proxy environment.

## Runtime flow

1. **Data layer** — Twelve Data quote and time-series requests are normalized into internal candles. Requests are rate-limited and cached by symbol/timeframe.
2. **Normalization and quality** — Symbols are normalized without restricting analysis to the built-in selector. OHLC geometry, ordering, duplicates, timestamps, quote age, required history, ATR, and closed-candle state are checked before planning.
3. **Market analysis** — Closed candles produce EMA/RSI/ATR and other local indicators, swings, BOS/MSS, liquidity, FVG/OB/MSNR/CRT/TBS zones, regime, and multi-timeframe context.
4. **Market evidence package** — The live scan builds one canonical package from the same normalized closed Twelve Data candles used by the structure detectors. It includes raw recent candles and deterministic structure, swings, HH/HL/LH/LL sequence, BOS/MSS/CHoCH, displacement, FVG, OB, MSNR, structural POIs, liquidity, dealing range, premium/discount, previous-period levels, and ATR context for 1D, 4H, 1H, 15M, and 5M.
5. **AI market thesis** — DeepSeek receives the full evidence package before the final candidate selector. It can discover a coherent CRT, TBS, MSNR, or market-mechanics thesis and choose LIMIT versus CONFIRMATION_ENTRY. It references deterministic evidence IDs; it cannot manufacture executable prices.
6. **Deterministic verification and pricing** — Code proves the referenced POI, structural invalidation, genuine target, direction, lifecycle, entry geometry, stop, target ladder, and RR. CRT/TBS/MSNR remain executable strategy backing. A market-mechanics thesis is executable only when `ai_verified`, `market_mechanics_verified`, the POI, structural invalidation, and target evidence all exist. FVG/OB/FLIP/SUPPLY/DEMAND remain informational until that proof exists.
7. **Validation and risk** — Final consistency, data, news, spread, lifecycle, target, reward-to-risk, account-risk, and execution-mode checks run in code. A pending LIMIT does not require current price to be inside the POI, current LTF confirmation, killzone session, or unanimity across timeframes. Confirmation entries retain their confirmation requirement. The normal public mode is manual user execution; optional paper simulation remains available for testing.
8. **UI and audit** — The public signal is compact and includes opportunity status, data/news/risk state, and rejection reason. Analyst request payloads, bounded raw responses, parsed theses, hard rejections, quality warnings, deterministic references, and production trace data are retained in debug/audit output. A bounded local audit record and deterministic replay capture the decision path.
9. **Backtesting** — Pending-limit simulation uses closed candles, future-only fills, spread, slippage, fees, expiry, and conservative same-candle stop handling.

## Analyze decision authority

Before this refactor, the production path constructed a CRT/TBS/MSNR candidate funnel first, treated market-mechanics records as informational, and sent DeepSeek a restricted hypothesis contract. `LTF_ISOLATED`, missing current execution confirmation, and strategy-only lifecycle decisions could therefore prevent a coherent future POI from reaching the analyst or executable candidate stage.

The current path is:

```text
Telegram Analyze
  -> Twelve Data quote and closed 1D/4H/1H/15M/5M history
  -> canonical candle normalization and data quality
  -> deterministic structure, liquidity, POI, CRT/TBS/MSNR evidence
  -> Market Evidence Package
  -> DeepSeek thesis/opportunity discovery
  -> evidence-reference and geometry verification
  -> deterministic exact entry, structural SL, genuine TP1/TP2/TP3, RR
  -> lifecycle, price-safety, data, spread, slippage, news validation
  -> candidate ranking and non-vetoing final selector
  -> canonical setup JSON and existing Telegram Mini App rendering
```

### Executable and informational boundaries

- **Executable strategy backing:** CRT, TBS, and MSNR, including their existing strategy-specific evidence and geometry.
- **AI-verified market mechanics:** a separate executable candidate only after code verifies a deterministic POI, structural invalidation, target, direction, and lifecycle. This is the route that lets DeepSeek identify a valid FVG/OB/supply/demand/reclaim opportunity without pretending that the location itself is a strategy.
- **Informational context:** ICT, MARKET_MECHANICS before verification, FVG, OB, FLIP, SUPPLY, DEMAND, ORDER_BLOCK, FAIR_VALUE_GAP, liquidity, BOS, MSS, CHoCH, displacement, premium/discount, and trend. These facts can inform the thesis and diagnostics but cannot authorize an order alone.

### Hard rejection versus quality evidence

Hard rejection remains reserved for missing/corrupt data, missing or invalid referenced POI, invalid direction, invalid structural stop, missing genuine target, impossible RR, consumed/invalidated/expired lifecycle, spread/slippage/news blocks, and final invariant failures. HTF disagreement, LTF isolation, lack of immediate confirmation for a pending LIMIT, session quality, and volatility are recorded as quality evidence unless the selected setup explicitly requires confirmation.

## Important invariants

- A forming provider candle is filtered before structure or indicator analysis.
- Indicator calculations use the already-fetched closed OHLCV data; the scan no longer spends seven provider indicator requests per timeframe.
- `BUY_LIMIT`, `SELL_LIMIT`, and `WAIT` remain separate decisions; the system never converts a pending limit into a market order or submits a broker order.
- A high-impact news state is always exposed as `NEWS_BLOCKED` in the public status mapper.
- Invalid, stale, incomplete, contradictory, or unsafe data produces a blocked or no-trade result.
- AI output cannot override deterministic candidate validation or risk controls.

## Remaining production boundary

The optional proxy supplies server-side data/AI routing and authenticated append-only audit storage. A database-backed audit service and a separately reviewed broker adapter are still required before live execution could be considered. The current code intentionally does not submit broker orders; the user places any accepted setup manually with their broker.

Account risk limits are evaluated by one shared deterministic gate when account state is supplied. It supports open risk, daily loss, weekly loss, consecutive losses, active-order count, and per-symbol exposure. Paper loss state is persisted locally across refreshes and checked before a new paper order is created, so daily, weekly, and consecutive-loss limits do not reset when the app reloads. The browser cannot infer omitted account state, so live sizing remains blocked without equity, risk, and symbol tick metadata; paper mode remains available unless an explicitly supplied limit is breached.

## Recent operational safeguards

- The optional `server/proxy.js` isolates Twelve Data and DeepSeek credentials, validates proxy inputs, limits clients and request bodies, enforces a global Twelve Data account budget plus a per-client abuse budget, and exposes no order route. Manual user execution is the normal workflow; persistent audit storage is available through the authenticated audit route, while a broker adapter remains intentionally outside this repository.
- When configured with `window.__ICT_PROXY_BASE_URL__` and a write-only audit token, the browser forwards sanitized analysis records to the persistent audit store; audit reads require a separate server-only token.

- Optional `1M` and `1W` history are supported by the normalized timeframe registry but are excluded from the default opportunity scan to preserve the Twelve Data 55-credit budget. The default scan requests one quote plus closed `5M`, `15M`, `1H`, `4H`, and `1D` candles; weekly or one-minute data is fetched only when explicitly requested.
- Live quotes and candles require usable timestamps; stale, future-dated, undated, or expired cached price data is blocked.
- Supplied symbol metadata and quote bid/ask conditions are preserved through the live context and public signal.
- When supplied, symbol-session metadata (`open_days`, `open_utc`, and `close_utc`) is evaluated before the generic asset calendar; provider market-open state remains authoritative.
- A known excessive spread rejects candidate construction before AI selection and is exposed as `RISK_BLOCKED`.
- Paper orders carry deterministic idempotency keys, and persisted keys are checked against the stored order geometry before monitoring. Manual tracking records use a separate `MANUAL:` key namespace so they cannot be confused with simulated orders.
- Backtest reports include partial-fill scaling and grouped performance by symbol, timeframe, regime, and session.
