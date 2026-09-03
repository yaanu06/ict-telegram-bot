# Session Context — AI-First Setup Generation (2026-08-19) + Entry Filters (2026-09-03) + Direction Compare (2026-09-03) + Holistic Evidence + Raw Candles

> Read this file when resuming work on this project. It records what was done
> in the last sessions so we can pick up where we left off.

## Project
- **ICT Pro Trader Bot** — Telegram mini app trading XAU/USD (and other pairs)
- Folder: `D:\telegram mini app` | Repo: `github.com/yaanu06/ict-telegram-bot` (branch `main`)
- Stack: plain HTML/CSS/JS (`index.html`, `style.css`, `script.js`), jest tests (`script.test.js`), data in `data/`
- Run tests: `npx jest` | Syntax check: `node --check script.js`

---

## What was done in the 2026-09-03 session (most recent)

### 1. Repo review + pull from remote
- Working tree was clean, `origin/main` was 1 commit ahead (auto-record `1e4a56b`).
- `git pull --rebase` brought in 13 auto-recorded setup JSONs in `data/setups/` (XAU, EUR, BTC, AUD). No code changes from remote.
- No new local commits before this session.

### 2. Enhanced AI intelligence (commit `d610c72` → pushed)
Added 6 new analysis functions AFTER the existing `runAutoScan` block, before the JSON OUTPUT section:

1. `analyzeMarketPhase(data)` — script.js:3124ish — AMD (Accumulation / Manipulation / Distribution) with confidence, volatility, volume ratio, sweep detection.
2. `detectDivergence(data, indicator, lookback)` — RSI & MACD regular + hidden divergences.
3. `mapLiquidity(data)` — swing-based liquidity pools above/below + equal highs/lows.
4. `analyzeVolumeProfile(data)` — POC, VAH, VAL (70% value area).
5. `analyzeSentiment(data)` — composite RSI + trend + volume + MACD score (0–100). **Fixed divide-by-zero** in the original `(recentVolume/avgVolume).toFixed(2)` by guarding `avgVolume > 0`.
6. `trackAIPerformance()` + `getPatternPerformance()` — localStorage self-learning keyed by setup id.

Wired into `runAutoScan`:
- Right after `await updateMTFDisplay(historyCache)` (script.js:2651), computes all 5 analyses on 4H (sentiment also on 1H) into an `enhancedAnalysis` object.
- New prompt section "🧠 ENHANCED AI INTELLIGENCE" injected into `scanTextData` (script.js:~2803).
- After AI returns, `getPatternPerformance` is applied to nudge confidence (only when `sampleSize >= 5` and `|adjustment| >= 1`).

Wired self-learning:
- `markRecentOutcome()` (script.js:3025) now calls `trackAIPerformance` on Win/Loss with patterns, confidence, and parsed RR.

### 3. 4 Entry Filters (commit `b259044` → pushed `a99bd7c`)

User reported SL hits → asked for entry confirmation, smart SL, phase-based entry, session filter.

**Decisions taken (user answered multi-choice):**
- **SL**: keep current `calcStopLoss` (2.0x ATR for XAU, 1.5x others) — proposed version was *tighter* (0.5x buffer + 1.5x/1.8x min), not wider. Reject.
- **Integration**: AI prompt only (not `analyzeTimeframe`) — the legacy wrapper is unused by the AI-first flow.
- **Session logic**: ICT canonical windows — drop the non-existent 3rd silver bullet.
- **Confirmation**: advisory only — surface signals to AI, don't hard-block (limit orders at zone price must still fire).

**4 new functions + aggregator** (script.js:3263+):
1. `shouldTradeSession(now)` — London KZ 7–10, NY KZ 12–15, Lon-close 15–17, Asian 0–4, silver bullet 8:30–9 and 15–16 UTC. Returns `priority` (MAX/HIGH/LOW), `shouldTrade`, `multiplier`, `isKillzone/isSilverBullet/isAsian/isOffHours`. **Fixed** the `shouldTrade = priority !== 'LOW' || isSilverBullet` short-circuit → now `priority === 'MAX' || priority === 'HIGH'`.
2. `shouldEnterBasedOnPhase(phase, direction, price, data)` — ACCUMULATION allow; MANIPULATION block until sweep; DISTRIBUTION block until displacement; NEUTRAL default.
3. `checkEntryConfirmation(data, zone, direction)` — price-action on LTF (15M/5M). Scores 9 signals (engulfing, pin bar, momentum, EMA alignment, sweep, BOS, close outside zone, volume spike) only when price is *at* the zone. Threshold: 25.
4. `buildEntryContext(sessionCheck, marketPhase, phaseDecision, entryConfirmation)` — aggregator → `allOk`, formatted `lines` for prompt, `summary`.

**Wired into the AI-first flow (runAutoScan):**
- Context computed right after `enhancedAnalysis` (script.js:~2676).
- New prompt section "🎯 ENTRY FILTERS (SESSION / PHASE / CONFIRMATION)" with explicit AI rules.
- **Hard client-side safety net** (script.js:~2979): if filters block but AI returned `enter_now`, override to `wait_for_reaction` and set `aiResult.filterOverride = entryContext.summary`. Execute button also disabled when `sessionCheck.priority === 'LOW'`.
- Limit orders at zone price still work: when price is not at zone, `isAtZone: false` and the filter is informational (won't block).

### Tests
- 19 → **30 passing** (+11 for the 3 filters + aggregator).
- `node --check script.js` clean.
- File changes: `script.js` +359, `script.test.js` +99.

### Git
- Both commits rebased onto auto-record commits, pushed to `origin/main`.
- Local HEAD after session: `a99bd7c` (push of `b259044`).

### 4. AI compares BOTH directions (commit `e039098`)

User reported: AI was finding the first setup (e.g. Turtle Soup BUY) and outputting it without comparing to the opposite (e.g. Hidden Bearish Divergence → SELL). Missed opportunities.

**Fix:** added a new prompt section "⚖️ CRITICAL: COMPARE BOTH DIRECTIONS" (script.js:~2860) right before "🎯 YOUR TASK". It tells the AI to:
- Build a BUY setup AND a SELL setup independently
- Compare them on confidence / RR / patterns / HTF alignment / probability
- Output only the winner (or `skip` if both < 58 confidence)
- Include `reasoning.why_best` and `opposite_setup.{direction,confidence,why_rejected}` in the JSON

**New function `normalizeOppositeSetup(input, chosenDirection)`** (script.js:2422) — extracted to module scope for testability. Fills defaults when AI omits the field:
- `direction` → opposite of chosen
- `confidence` → 0 (or coerced to number if AI sent string)
- `why_rejected` → 'Not provided by AI'

Called from `askAIToFindSetup` (script.js:~2498) after the reasoning defaults block.

**Wired into trade_signal output** (script.js:~2953): added `opposite_setup: aiResult.opposite_setup` to the out object, so the field is visible in the JSON tab and persisted to `data/setups/*.json` via `syncSetupToGitHub`.

**NOT done (intentionally):**
- Did NOT make `opposite_setup` required — would break the build if DeepSeek omits it.
- Did NOT add a client-side BUY-vs-SELL re-comparison — the AI is the right place.

**Tests:** 30 → **35 passing** (+5 for `normalizeOppositeSetup`: null, direction flip, partial, non-numeric confidence, full input).

**File changes:** `script.js` +74, `script.test.js` +57.

### 5. Holistic BUY vs SELL evidence scoring (commit `3f0f004` → pushed `5c887a9`)

User reported: AI was finding one pattern (e.g. Turtle Soup) and running with it, ignoring contradictory evidence. Needed to force the AI to weigh ALL evidence first.

**Two new pure functions (script.js:2437, 2559):**

1. `computeHolisticEvidence({ dailyDir, h4Dir, h1Dir, candles, indicators, patterns, phase, rsiDiv, macdDiv })` — scores 10 BUY and 10 SELL signals (1D/4H/1H trend, HH/LL, above/below EMAs, FVG/OB by direction, Turtle Soup, divergence, phase). Returns `{ flags, buyScore, sellScore, diff, suggestedDirection }`. `suggestedDirection === 'NEUTRAL'` when `|diff| < 20`.

2. `buildHolisticPromptBlock({ evidence, dailyDir, h4Dir, h1Dir })` — formats the exact "### BUY EVIDENCE" / "### SELL EVIDENCE" table with `✅ +pts` / `❌ 0` lines.

**Scoring weights:**
- 1D direction: 30 | 4H: 20 | 1H: 15
- HH/LL price action: 25
- Above/below all 4 key EMAs: 15
- Bull/Bear FVG: 10 | Bull/Bear OB: 10
- Turtle Soup BUY/SELL: 20
- Bull/Bear Divergence (RSI or MACD): 15
- Accumulation/Distribution: 10

**Wired into `runAutoScan` (script.js:~2906):**
- Computed right after the dirs.
- New prompt section "📊 HOLISTIC EVIDENCE ANALYSIS (BUY vs SELL)" injected between entry filters and direction-compare. Tells AI: "Do NOT anchor on a single pattern."

**Client-side safety net (script.js:~3166):** if `holistic.suggestedDirection === 'NEUTRAL'` but AI said `enter_now`, override to `wait_for_reaction` and set `aiResult.filterOverride = 'Holistic score too close (BUY X vs SELL Y, diff Z)'`. Execute button disabled.

**Tests:** 35 → 40 passing (+5: NEUTRAL empty, BUY dominates, SELL dominates, NEUTRAL when within 20, prompt block format).

**File changes:** `script.js` +213, `script.test.js` +99.

### 6. Raw OHLC candle data in AI prompt (commit `d93a303` → pushed `ad66511`)

User reported: AI was only seeing summarized data, not actual candles. Wanted to give the AI raw price action.

**New pure function `buildCandleData(historyCache, count = 10)`** (script.js:2560) — iterates `['1D', '4H', '1H', '15M', '5M']`, skips TFs with < 10 candles, formats each as:
```
### 4H CANDLES (Last 10):
  220: O:4280.50 H:4295.20 L:4278.10 C:4290.30 V:12345
  ...
```
Volume included, indices are absolute (not relative), OHLC 2-decimal fixed.

**Wired into `runAutoScan` (script.js:~2915):** computed right after `holistic`, then injected as new prompt section "📊 RAW CANDLE DATA (YOU CAN SEE EVERYTHING)" between holistic block and direction-compare. Includes 6-bullet guidance: engulfing, pin bars, price action at zones, momentum shifts, market structure, professional judgments.

**Token budget kept at 2000** (per user). 10 candles × 5 TFs ≈ 3.5KB. Fits well in 8K context.

**Tests:** 40 → 43 passing (+3: empty input, full format with 50 lines across 5 TFs, partial input where 4H too short is skipped). **Note:** I actually added 3 tests, not the planned 2 — the 3rd (partial input skip) was a freebie that caught a real edge case.

**File changes:** `script.js` +50, `script.test.js` +43.

---

## Earlier session (2026-08-19) — still relevant

### Core change: AI now creates the COMPLETE setup from scratch
Previously the bot used rule-based logic to find setups and AI only reviewed the decision.
Now the AI (DeepSeek) is the **primary analyst** and builds the entire setup.

Files changed: `script.js` only.

New functions added BEFORE `runAutoScan()`:
1. `askAIToFindSetup(marketData, price)` — script.js:2422
2. `runFallbackScan(price, historyCache)` — script.js:2533
3. `runAutoScan()` — script.js:2618 (fully replaced)
   - Flow: getPrice → 5M/15M/1H/4H/1D/1W history → MTF display → indicators → patterns → session+news → quote direction → big prompt → `askAIToFindSetup` → build `trade_signal`, `lastSetupSummary`, `analysis`, `syncSetupToGitHub`, enable execute button with `🤖 AI Setup: <dir>` label, purple gradient.
   - Tradeable gate (now strengthened in 2026-09-03 session): `ai_decision !== 'skip' && confidence >= 58 && sessionCheck.priority !== 'LOW'`.
4. `handleLimit()` — script.js:3232 — `source: 'AI-Generated' | 'Rule-Based'`.

### AI advisory mode
- `AI_ADVISORY_ONLY = true` (script.js:41) still defined but **unused** by the new flow.
- The old `getAIExecutionDecision()` function was removed at some point (grep returns no matches now).

### Encoding gotcha (IMPORTANT for future edits)
- File is UTF-8 **without BOM**, CRLF line endings.
- NEVER edit script.js via PowerShell `Get-Content`/`Set-Content`. Use Edit/Write tools, or `[System.IO.File]::ReadAllLines(path, [System.Text.Encoding]::UTF8)` + `WriteAllLines(path, lines, New-Object System.Text.UTF8Encoding($false))`.

## Verification
- `node --check script.js` — SYNTAX OK
- `npx jest` — 43/43 tests pass

## Git notes
- The bot auto-pushes "🤖 Auto-record ICT setup" commits to `data/` frequently → always `git pull --rebase` (or fetch+rebase) before pushing.
- **Current local HEAD:** `ad66511` (push of `d93a303`)
- **Recent commits this session (in order):**
  - `d610c72` — feat: enhanced AI intelligence (AMD, divergence, liquidity, volume profile, sentiment, self-learning)
  - `b259044` — feat: 4 entry filters (session, phase, confirmation, build entry context)
  - `190be6e` → `3e4cd67` — docs: update SESSION_CONTEXT
  - `e039098` — feat: AI compares both directions, returns opposite_setup + why_best
  - `f2ea3d1` — docs: update SESSION_CONTEXT
  - `3f0f004` → `5c887a9` — feat: holistic BUY vs SELL evidence scoring
  - `d93a303` → `ad66511` — feat: feed raw OHLC candle data to AI

## Possible follow-ups (not done)
- **No ground-truth trade outcomes are stored** — `data/journal/` and `data/trade_history/` don't exist. Without user marking recents as Win/Loss, self-learning never gets data. Consider adding automatic TP-hit/SL-hit detection by polling live price.
- **Filter override is silent** — only sets `aiResult.filterOverride` field. Consider showing a UI notification "Trade blocked: Off-hours" (or "Holistic score too close") so the user knows why the execute button is disabled.
- **Add client-side sanity check on direction** — the AI now claims to compare, but we could cross-check `aiResult.direction` against the dominant HTF trend (1D/4H/1H) from `getQuoteDirection` and downgrade confidence if they conflict.
- **Expose `opposite_setup` in the UI** — currently only visible in the JSON tab. Could add a "Why not the other direction?" expandable section in the analysis panel.
- **Expose `holistic` scores in the UI** — currently buried in the prompt. Would help the user see WHY the AI picked (or didn't pick) a direction.
- **No server-side sanitization**; keys stored client-side (known limitation, IMPROVEMENTS.md)
- **`scanFill` progress bar** is fetched in new runAutoScan but no longer updated — could remove or wire up.
- **Fallback `runFallbackScan`** in the catch block may get undefined `price`/`historyCache` if the error happens before they're set.
