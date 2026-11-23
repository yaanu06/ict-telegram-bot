# MORNING REPORT — Market-Pack / Manual-Monitor continuation

Date: 2026-11-23
Base commit: `a2baf01` (Document market pack continuation handoff)
Branch: `main`
Status: remaining handoff slices implemented in the working tree; **not committed**
(packet/ was not staged, modified, renamed, or deleted).

## What changed

### 1. RAW packet fixture + generated-Markdown tests
- Added a shared pack-fixture builder and per-pair pack matrix tests.
- Added swing-map regressions for PREMIUM / DISCOUNT / EQUILIBRIUM /
  OUTSIDE_RANGE and for a broken swing never becoming an active range bound.
- Added stale-quote and closed-candle-reference-age tests.
- Added a generated-Markdown assertion that the only
  `PROMPT_CONTRACT_VERSION=` occurrence comes from the strategy contract, not
  the packet payload.

### 2. FACTS contract completion (`buildRawCandleAiFacts`)
- `MARKET_STATUS`, `MARKET_STATUS_SOURCE`.
- `MARKET_HOURS`, `MARKET_HOURS_SOURCE`, `SESSION_RELEVANCE` (asset-aware:
  crypto 24/7, FX/metal killzone relevance, equity/index cash-session state).
- `PROVIDER_METADATA_SOURCE`, `PROVIDER_METADATA_COMPLETE` (unknown stays
  `UNKNOWN`).
- `PREVIOUS_WEEK_RANGE` as an ISO `YYYY-MM-DD..YYYY-MM-DD` UTC week range.
- `REFERENCE_TIME`, `REFERENCE_AGE_SOURCE`, `QUOTE_AGE_SOURCE`.
- Reference price field is now truthful: `CLOSED_5M_CLOSE` only when the
  reference equals the last closed 5M close, otherwise
  `CALLER_SUPPLIED_PRICE`.
- Removed the duplicate `MARKET_STATUS` header from the manual packet so the
  FACTS block is the single source.
- Fixed a null-coercion bug in monitor helpers: `null` option fields are now
  `null`, never `0` (prevents a missing DOL from becoming a 0-level tap).

### 3. Pack-level per-pair matrix
- Added `NASDAQ:AAPL` (EQUITY), `SPX500` (INDEX), `BINANCE:BTC/USD` (CRYPTO),
  and a custom provider symbol with unresolved metadata.
- Confirms candle counts/limits, closed-only policy, provider symbol, tick,
  precision, market status/source and weekly range.

### 4. Scan-log UI + outcome editing
- Added a metrics view (`#manualScanMetrics`): total, fill rate, TP1 rate, SL
  rate, expectancy R, citation-verification rate.
- Added pure `manualScanLogJson()` / `manualScanLogCsv()` builders (quoted CSV)
  with round-trip and eviction tests; exports reuse them.
- Resting-limit list now includes both `PENDING` and `FILLED` records, shows
  MFE/MAE excursions, an editable Result R field, and Fill / TP1 / SL / Close /
  Cancel actions.
- Added `resolveManualScanOutcome(scanId, outcome, resultR)` with timestamps and
  manual R provenance.
- Monitor-derived outcomes now record `filled_at`, `closed_at`,
  `last_monitored_at`, `result_R`, `result_R_source`, `mfe_R`, `mae_R`.

### 5. Monitor + alert integration tests
- Fill from closed candle, excursion/R derivation, persisted outcome.
- Authenticated `/api/telegram/notify` call with the exact closed-candle
  timestamp and current R in the text.
- Alert idempotency across a simulated reload (persisted `(scan_id,event)` key).
- Sell-side zone-consumed / DOL-tapped / fill semantics and expiry.
- Forming candles are never monitored.
- Proxy: authenticated notify success (sender chat only) and oversized document
  body rejected with `413 REQUEST_BODY_TOO_LARGE` before any Telegram call.

### 6. Backtest audit
- Added `symbolExecutionSemantics()` and `assetClassForSymbol()` to
  `backtest/replay.js`, exposing asset class, precision, tick, commission,
  slippage and expiry hours; unknown metadata stays `null`.
- `symbolPrecision()` now honours provider `price_precision`/`tick_size` and
  falls back to asset-aware defaults aligned with the front-end.
- `simulateCandidate()` supports explicit `expires_at_ms` / `valid_until_ms` /
  `options.expiryAtMs` and returns `EXPIRED` for unfilled orders.
- Added no-lookahead regressions: no fill on the forming or pre-knowable candle.

### 7. Telegram pack caption
- Pack caption now includes market status, staleness and data warnings.
- Markdown header now carries schema, market status/source, quote staleness,
  reference age and data warnings. Document-only delivery and secrets rules are
  unchanged.

## Per-pair semantics table

| Symbol | Asset class | Precision | Tick | Volume reliable | Session relevance |
|---|---|---|---|---|---|
| XAU/USD | METAL | 2 | 0.1 | NO | killzone quality |
| XAG/USD | METAL | 3 | 0.001 | NO | killzone quality |
| BTC/USD | CRYPTO | 2 | 0.01 | YES | 24/7 no session gate |
| EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/CAD, USD/CHF, EUR/GBP | FOREX | 5 | 0.0001 | NO | killzone quality |
| USD/JPY, EUR/JPY, GBP/JPY | FOREX | 3 | 0.01 | NO | killzone quality |
| NASDAQ:AAPL (custom) | EQUITY | provider or 4 | provider or 0.01 | YES | cash session open/closed |
| SPX500 (custom) | INDEX | provider or 4 | provider or 0.01 | YES | cash session open/closed |
| unresolved custom | UNKNOWN | UNKNOWN | UNKNOWN | NO | UNKNOWN |

## Verification

| Check | Result |
|---|---|
| `node --check script.js` | OK |
| `node --check server/proxy.js` | OK |
| `node --check backtest/replay.js` | OK |
| `npx jest --runInBand --silent` | 23 suites passed, 901 passed, 3 skipped |
| `python -m unittest discover -s tools -p "test_*.py"` | 15 passed |
| `git diff --check` | clean (only CRLF advisory warnings) |

Baseline before this work: 23 suites, 875 passed, 3 skipped.

## Limitations / not done

- Backtest still does not charge commission/slippage inside P&L; the new
  semantics expose `commission_per_unit` and `slippage_estimate` but the replay
  R multiple remains gross. Wiring costs into `r_result` is a deliberate,
  separate behavior change.
- No new commit was created (instructions require explicit approval to commit).
  Changes are in the working tree off `a2baf01`.
- `packet/` diagnostics remain user-owned and untouched.
- Smoke tests cover module syntax, unit suites and the Python tool suite; no
  live provider/Telegram network call was made.

## Rollback

Working-tree only:

```
git checkout -- script.js script.test.js index.html server/proxy.test.js backtest/replay.js backtest/backtest.test.js
rm MORNING_REPORT.md
```
