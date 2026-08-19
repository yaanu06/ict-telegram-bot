# Session Context — AI-First Setup Generation (2026-08-19)

> Read this file when resuming work on this project. It records what was done
> in the last session so we can pick up where we left off.

## Project
- **ICT Pro Trader Bot** — Telegram mini app trading XAU/USD (and other pairs)
- Folder: `D:\telegram mini app` | Repo: `github.com/yaanu06/ict-telegram-bot` (branch `main`)
- Stack: plain HTML/CSS/JS (`index.html`, `style.css`, `script.js`), jest tests (`script.test.js`), data in `data/`
- Run tests: `npx jest` | Syntax check: `node --check script.js`

## What was done in the last session

### Core change: AI now creates the COMPLETE setup from scratch
Previously the bot used rule-based logic to find setups and AI only reviewed the decision.
Now the AI (DeepSeek) is the **primary analyst** and builds the entire setup.

Files changed: `script.js` only (431 insertions, 173 deletions).

New functions added BEFORE `runAutoScan()`:
1. `askAIToFindSetup(marketData, price)` — script.js:2422
   - Sends full market snapshot (trends, indicators, patterns, session, news) to
     DeepSeek (`DEEPSEEK_API_URL`, key from `DEEPSEEK_API_KEY`, stored in localStorage via setup UI)
   - Validates required fields: direction, entry, entry_zone, stop_loss, TP1-3, confidence, reasoning
   - Fills defaults for missing fields (entry_zone, reasoning, patterns, ai_decision, probability, zone_quality, risk_reward, stop_loss_reason)
   - Returns null on any failure (triggers fallback)

2. `runFallbackScan(price, historyCache)` — script.js:2533
   - Rule-based scan of 4H + 1H only (uses existing `analyzeTimeframe`)
   - Picks best confidence result, builds output + `analysis`, enables execute button
   - Called when AI fails, returns nothing, or throws

3. `runAutoScan()` — script.js:2618 (fully replaced)
   - Flow: getPrice → collect 5M/15M/1H/4H/1D/1W history → updateMTFDisplay →
     indicators (4H,1H) → patterns (FVG/swings/turtleSoup/CRT/OB/MSNR/trend/ADX on 4H/1H/15M/5M) →
     session + news → 1D/4H/1H quote direction → build big `scanTextData` prompt →
     `askAIToFindSetup()` → on success build `trade_signal` output, `lastSetupSummary`
     (timeframe: 'AI'), `analysis`, `syncSetupToGitHub(..., 'ai_scan')`, enable execute
     button with `🤖 AI Setup: <dir>` label, purple gradient (#5856d6→#007aff)
   - Tradeable gate: `ai_decision !== 'skip' && confidence >= 58`
   - On AI failure → warning + `runFallbackScan` fallback
   - Note: AI prompt rules: entry within 3x ATR, logical SL, min RR 1:1.5

4. `handleLimit()` — script.js:3232 (updated)
   - Added `source: analysis.aiDecision ? 'AI-Generated' : 'Rule-Based'` to the order object
   - Notification now shows `🤖 AI Setup:` or `📊 Rule-Based:` label

### Important: AI advisory mode
- `AI_ADVISORY_ONLY = true` (script.js:41) is still defined but the new AI-first flow
  no longer uses `getAIExecutionDecision()` / `AI_ADVISORY_ONLY` (old advisory code was removed with old runAutoScan). The old `getAIExecutionDecision()` function still exists (script.js:1584) and is unused by the new scan flow.

### Encoding gotcha (IMPORTANT for future edits)
- File is UTF-8 **without BOM**, CRLF line endings.
- NEVER edit script.js via PowerShell `Get-Content`/`Set-Content` (PS 5.1 defaults to ANSI → corrupts every emoji). Use the Edit/Write tools, or if scripting is needed use `[System.IO.File]::ReadAllLines(path, [System.Text.Encoding]::UTF8)` + `WriteAllLines(path, lines, New-Object System.Text.UTF8Encoding($false))`.

## Verification
- `node --check script.js` — SYNTAX OK
- `npx jest` — 8/8 tests pass
- Committed + pushed: `294d74f` "feat: AI-first setup generation - AI creates complete setup from scratch, rule-based fallback" (rebased onto auto-record commits d43c8c3 + 9 more)

## Git notes
- The bot auto-pushes "🤖 Auto-record ICT setup" commits to `data/` frequently → always `git pull --rebase` (or fetch+rebase) before pushing.

## Possible follow-ups (not done)
- AI output has no server-side sanitization; keys stored client-side (known limitation, IMPROVEMENTS.md)
- `scanFill` (progress bar) is fetched in new runAutoScan but no longer updated — could remove or wire up
- Fallback `runFallbackScan` in the catch block may get undefined `price`/`historyCache` if the error happens before they're set (e.g. getPrice throws) — could guard with defaults
