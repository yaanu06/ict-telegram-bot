# Session Context — AI-First Setup Generation (2026-08-19) + Entry Filters (2026-09-03)

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
- `npx jest` — 30/30 tests pass

## Git notes
- The bot auto-pushes "🤖 Auto-record ICT setup" commits to `data/` frequently → always `git pull --rebase` (or fetch+rebase) before pushing.

## Possible follow-ups (not done)
- No server-side sanitization; keys stored client-side (known limitation, IMPROVEMENTS.md)
- `scanFill` (progress bar) is fetched in new runAutoScan but no longer updated — could remove or wire up
- Fallback `runFallbackScan` in the catch block may get undefined `price`/`historyCache` if the error happens before they're set
- **New**: no ground-truth trade outcomes are stored — `data/journal/` and `data/trade_history/` don't exist. Without user marking recents as Win/Loss, self-learning never gets data. Consider adding automatic TP-hit/SL-hit detection by polling live price.
- **New**: filter override is silent (only sets `aiResult.filterOverride` field). Consider showing a UI notification "Trade blocked: Off-hours" so the user knows why the execute button is disabled.
