# OpenCode continuation handoff

Branch: `main`  
Remote: `origin/main`  
Latest pushed commit at handoff: `f5eba7e Verify per-pair market pack facts`

## Non-negotiable safety rules

- `packet/` is user diagnostic data: read-only, never stage/delete/rename.
- Stage explicit files only; never use `git add -A`.
- Manual workflow only: no broker adapter, order route, trade selector, or
  inferred AI response.
- Structure, ATR, and monitor outcomes use closed candles only. Unknown
  metadata must stay `UNKNOWN`/`null` rather than becoming zero/default data.

## Completed and pushed

- Replaced the delivered legacy V2.7.2/DeepSeek JSON strategy with the single
  readable manual-review contract in `ghost-machine-strategy.py`:
  `PROMPT_CONTRACT_VERSION=RAW_CANDLE_AI_V4.0`.
- Removed the duplicate packet prompt version headers; data builders use
  `MARKET_PACK_SCHEMA_VERSION=MARKET_PACK_SCHEMA_V1`.
- Added prompt lint coverage; it rejects retired V2.7.2/DeepSeek/parser and
  JSON-only language.
- Expanded RAW packet FACTS: asset class, provider symbol, reference price and
  age, quote staleness, market/gap semantics, session facts, ATR, dated levels,
  unknown spread/news/tick handling, and data warnings.
- BTC defaults now use `0.01` tick / 2 display decimals; crypto has 24/7 gap
  language. JPY, FX, metal, and all built-in pair settings are covered by tests.
- SWING MAP emits ISO timestamps, does not use broken swings as active range
  bounds, and produces `OUTSIDE_RANGE` where applicable.
- Added manual scan observation logging (bounded localStorage cap 500), manual
  AI review fields, JSON/CSV export, metrics helper, and a resting-manual-limit
  list/cancel UI.
- Closed-candle monitor handles zone consumed -> DOL tapped -> expiry -> fill;
  same-candle entry/stop resolves to SL. Filled records continue monitoring for
  later TP1/SL.
- Added authenticated, rate-limited `/api/telegram/notify` server route and
  local `(scan_id,event)` alert idempotency. It has no broker/order function.

## Important current files

- `script.js`: packet builders (`buildRawCandleAiPacket`,
  `buildRawTextMarketAnalysisPacket`), FACTS/SWING MAP, logging, monitor.
- `ghost-machine-strategy.py`: the only delivered strategy contract.
- `index.html`: manual result form and resting limit list.
- `server/proxy.js`: `/api/telegram/notify` route.
- `script.test.js`, `server/proxy.test.js`: regression coverage.
- `PLAN.md`: original repair order.

## Verification already run successfully before handoff

- `node --check script.js`
- `node --check server/proxy.js`
- `npm.cmd test -- --runInBand --silent`: 23 suites passed, 875 tests passed,
  3 skipped (run before the final per-pair test-only commit).
- `python -m unittest discover -s tools -p "test_*.py"`: 15 passed.
- `git diff --check`.

## Still required to finish the user's full request

1. Add robust RAW packet fixture tests for BTC premium/discount/outside-range
   examples, broken-swing active-range prevention, stale quote behavior, and
   one prompt-version in the *generated Markdown* (not merely source lint).
2. Complete FACTS contract fields: exact market status/hours/source detail,
   provider metadata provenance, weekly ISO date range, reliable quote/reference
   age semantics, and asset-aware session relevance. Avoid fabricated defaults
   for all custom/provider symbols.
3. Add a true pack-level per-pair fixture matrix, including a custom
   equity/index/crypto provider symbol, counts/limits, unknown metadata, stale
   flags, and prompt lint.
4. Finish scan-log UI: metrics view, outcome timestamps/R excursions/result R,
   editable/manual outcome flow, and full CSV/JSON round-trip/eviction tests.
5. Complete monitor integration: persisted state testing, alert idempotency
   across reloads, zone/DOL semantics for both sides, expiry tests, alert text
   with closed-candle timestamp/current R, and successful notify-route tests.
6. Audit/update paper/backtest to share symbol-aware tick/cost/expiry semantics
   and add no-lookahead regression tests.
7. Complete Telegram pack caption metadata/stale warnings and safe oversized
   document handling tests. Keep document delivery only and secrets out.
8. Run final full checks, then write `MORNING_REPORT.md` with actual commit
   hashes, results, limitations, per-pair table, smoke-test status, and rollback.

## Workspace state at handoff

Only user-owned diagnostic files remain dirty/untracked:

- `packet/xauusd new.txt` (modified)
- `packet/eurusd.txt` (untracked)
- `packet/ghost-machine-raw-chatgpt-test.md` (untracked)
- `packet/raw-test-ground-truth-private.json` (untracked)

Do not stage them.
