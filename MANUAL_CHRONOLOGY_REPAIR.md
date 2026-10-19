# Manual opportunity chronology repair — 2026-10-19

## Verified failure

Starting main/origin main: `080afe7a8e9cf959366f284de04bfdd8231fdb6f`.
The supplied EUR/USD packet was generated at `2026-10-19T17:04:29.579Z`
and identifies build `c36be2990737c1b0e0eb161ae1062edf5f6de11a`.
It contains 24 manual opportunities with unknown chronology.

Earlier fixes wired timestamps into `buildStrategySetups`, but active Market
Mechanics discovery uses `buildMarketMechanicsStrategySetups`. On that path,
1H/4H formations were mapped against shorter 15M/5M buffers. MSNR confirmation
timestamps existed even when `created_time` was null. A missing lower-timeframe
index consequently became UNKNOWN despite available owning-timeframe history.
The pending diagnostic adapter also lost lifecycle results flattened onto raw
candidates. Helper tests did not exercise this complete handoff.

## Production path repaired

`buildLiveMarketContext`
→ closed history at evaluation time
→ `buildMarketMechanicsStrategySetups`
→ detector confirmation time on its owning timeframe
→ `marketMechanicsFormationChronology`
→ `marketMechanicsEntryChronology` / `evaluateSetupLifecycle`
→ canonical candidate qualification AND manual model evidence records
→ `createScanReplay`
→ `buildRawTextMarketAnalysisPacket`
→ manual DeepSeek review.

- First actionability is the close of the required confirmation candle, not
  the opening timestamp, nor an unrelated rolling candle index.
- Later causal confirmation uses its own close price for initial pending side.
- Chronology covers post-formation time with available closed OHLC. Complete
  finer intervals refine coarse ones without overlapping/double-counting bars.
- Existing instrument session scheduling handles closed intervals. A genuine
  uncovered open-session interval or malformed OHLC remains UNKNOWN.
- Future/open bars cannot contribute to the production calculation, including
  caller patterns computed from those bars. Provider timestamp metadata survives.
- Manual records preserve formation/lifecycle evidence before preferred-plan
  filtering and discretionary quality rejection. Each formation is reviewed
  separately; a terminal campaign representative cannot hide its siblings.
- Terminal canonical records cannot be revived by less-complete duplicates.
- Stop-distance warnings remain visible. Proposed objective provenance now
  matches its actual level rather than a different nearest target.
- The manual output contract now consistently permits evidenced analysis of
  active opportunities, not only LIVE rows. No API or order execution was added.
- RAW packets include available daily OHLC and a per-formation lifecycle audit.

## Real packet replay

Read-only command:

```powershell
node backtest/manual-packet-replay.js 'packet/=== AI TRADING PACKET ===.txt'
```

119 supplied bars per 4H/1H/15M/5M timeframe were processed through the real
production entry point, detectors, lifecycle evaluation and RAW serializer.
Each supplied timeframe is FRESH and has zero missing-session candles.

The text does **not** include daily OHLC, the original provider quote timestamp,
bid/ask or a full runtime snapshot. Replay therefore correctly reports missing
daily/quote evidence rather than inventing FRESH data. This is a partial-input
production replay, not proof of full historical runtime or live deployment parity.

| Recomputed model lifecycle | Records |
| --- | ---: |
| Active untouched | 2 |
| Entry consumed | 8 |
| Already completed | 17 |
| Delivery advanced under existing policy | 7 |
| Initially wrong-side | 1 |
| Unknown chronology | 0 |

The 35 records include model-backed opposite-direction diagnostics before
preferred-plan filtering. They are not directly comparable with the old
24-row, filtered manual shortlist.

| Manual review zone | First actionable UTC | Suggested entry |
| --- | --- | ---: |
| 4H BUY FVG 1.11408–1.11517 | October 15, 02:00 | 1.11462 |
| 1H BUY MSNR 1.11497–1.11547 | October 15, 00:00 | 1.11522 |

Both remain untouched in supplied closed-candle history through 17:00 UTC.
They reach manual review with data limitations and structural target evidence;
they are **not approved orders**. Suggested stop is 1.11112 and the suggested
objective is 1.12275 (OPPOSING_MSNR), not a mislabeled opposing OB. Path, target
availability, current quote and overall risk still require review. No threshold
was loosened and no trade was forced.

The recent 1H MSNR 1.12047–1.12087 becomes actionable at 16:00 after its 15:00
confirmation candle closes. The 16:00 post-formation candle crosses its entry.
It remains excluded as consumed; it is not falsely recovered as untouched.

## Verification

- Jest: 23 suites passed; 944 tests passed, 2 skipped (946 total).
- New chronology/production regressions: 12 passed, including the supplied file.
- Python: 7 tests passed using `python -m unittest discover -s tools -p 'test_*.py' -v`.
- `node --check script.js` and replay-harness syntax: passed.
- `git diff --check`: passed.
- Candle-driven synthetic SELL mirror: same production detectors recover two
  untouched SELL review zones. This is a symmetry test, not a real SELL signal.
- Future-candle mutation leaves the prior production shortlist unchanged.
- Tests cover owner/LTF mismatch, genuine gaps, malformed bars, both sides,
  post-formation crossing, pre-formation touches, old standing zones,
  close-timestamp semantics, duplicate terminal safety, unconfirmed formations,
  wrong-side exclusion, manual output and exact packet serialization.
- Existing NZD manual-review regressions pass; the original NZD source packet
  is not present, so no new real NZD replay is claimed.

## Safety and limits

No strategy thresholds, structural stop/target rules, path/risk safeguards,
session calendar policies, fetched candle counts, broker execution or API
integration were changed. V2 Market Mechanics remains the deterministic LIVE
authority; legacy remains disabled and Kronos remains informational.

This repair demonstrates the reported chronology/handoff defect is corrected
on available evidence. It does not guarantee a trade, profitability, or that
Render has deployed the commit. A fresh production scan with full daily and
quote inputs is still required to verify the deployed build. Closed candles
cannot prove every tick inside the currently open candle; verified-through
timestamps are explicit. Existing target-delivery and trade-quality policies
were preserved, not re-tuned to obtain more opportunities.

The user packet was neither copied into tracked fixtures nor edited. SHA256:
`9AC9BFD4CDE29CBD021A991649A0E36A2D554FE8AB2C3C5FA4C7A7A342A4BEA9`.
The real-file test explicitly skips when that private fixture is unavailable in
CI; locally it ran. Set `MANUAL_PACKET_FIXTURE` to supply the same capture elsewhere.

## Copy-button regression follow-up

The closed-candle boundary added by this repair intentionally creates a
canonical history object. The manual Copy gate still compared that object with
the fetched cache using JavaScript reference identity. Consequently, two
content-identical complete snapshots were treated as different and Copy showed
`RAW market snapshot is incomplete or unavailable`.

The gate now compares exact required-timeframe closed-candle content at the scan
cutoff (timestamp and OHLCV), while retaining the snapshot ID, count and
completeness checks. A production-path test covers analysis → replay → RAW
packet → Copy clipboard. Real missing timeframes, mismatched candle content,
missing snapshot IDs and incomplete snapshots remain blocked.
