# Trading Assistant Architecture Report

## Current repository

This repository is a browser Telegram Mini App. `index.html` and `style.css` provide the UI; `script.js` contains the current application, data, analysis, AI, validation, paper-order, audit, and replay logic; `script.test.js` runs the deterministic test suite. `data/setups/` contains recorded setup artifacts.

There is no backend service, database, broker adapter, server-side secret store, or live order endpoint in this repository. The application is therefore paper-only. API keys are currently entered into the browser and stored in local storage; this remains a production security limitation.

## Runtime flow

1. **Data layer** — Twelve Data quote and time-series requests are normalized into internal candles. Requests are rate-limited and cached by symbol/timeframe.
2. **Normalization and quality** — Symbols are normalized without restricting analysis to the built-in selector. OHLC geometry, ordering, duplicates, timestamps, quote age, required history, ATR, and closed-candle state are checked before planning.
3. **Market analysis** — Closed candles produce EMA/RSI/ATR and other local indicators, swings, BOS/MSS, liquidity, FVG/OB/MSNR/CRT/TBS zones, regime, and multi-timeframe context.
4. **Opportunity planning** — Deterministic rules derive candidate limit zones, stops, targets, lifecycle state, reachability, reward-to-risk, and explicit rejection codes.
5. **AI interpretation** — DeepSeek receives structured evidence and can select or explain supplied candidates. JSON is parsed, schema-checked, retried once on invalid output, and rejected safely after the retry. AI cannot create prices or geometry.
6. **Validation and risk** — Final consistency, data, news, spread, lifecycle, target, reward-to-risk, account-risk, and execution-mode checks run in code. Paper mode is the only enabled execution mode.
7. **UI and audit** — The public signal is compact and includes opportunity status, data/news/risk state, and rejection reason. A bounded local audit record and deterministic replay capture the decision path.
8. **Backtesting** — Pending-limit simulation uses closed candles, future-only fills, spread, slippage, fees, expiry, and conservative same-candle stop handling.

## Important invariants

- A forming provider candle is filtered before structure or indicator analysis.
- Indicator calculations use the already-fetched closed OHLCV data; the scan no longer spends seven provider indicator requests per timeframe.
- `BUY_LIMIT`, `SELL_LIMIT`, and `WAIT` remain separate decisions; the system never converts a pending limit into a market order.
- A high-impact news state is always exposed as `NEWS_BLOCKED` in the public status mapper.
- Invalid, stale, incomplete, contradictory, or unsafe data produces a blocked or no-trade result.
- AI output cannot override deterministic candidate validation or risk controls.

## Remaining production boundary

The browser implementation still needs a server-side data/AI proxy, encrypted secret storage, persistent database-backed audit records, authenticated user approvals, and a separately reviewed broker adapter before live execution could be considered. The current code intentionally does not submit broker orders.

Account risk limits are evaluated by one shared deterministic gate when account state is supplied. It supports open risk, daily loss, weekly loss, consecutive losses, active-order count, and per-symbol exposure. The browser cannot infer omitted account state, so live sizing remains blocked without equity, risk, and symbol tick metadata; paper mode remains available unless an explicitly supplied limit is breached.

## Recent operational safeguards

- Optional `1M` history is supported by the normalized timeframe registry but is excluded from the default scan to preserve the Twelve Data 55-credit budget.
- Live quotes and candles require usable timestamps; stale, future-dated, undated, or expired cached price data is blocked.
- Supplied symbol metadata and quote bid/ask conditions are preserved through the live context and public signal.
- A known excessive spread rejects candidate construction before AI selection and is exposed as `RISK_BLOCKED`.
- Paper orders carry deterministic idempotency keys, and persisted keys are checked against the stored order geometry before monitoring.
- Backtest reports include partial-fill scaling and grouped performance by symbol, timeframe, regime, and session.
