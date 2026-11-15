"""Ghost Machine strategy embedded in the Mini App's AI Market Pack PDF.

This is a prompt document, not an executable trading bot. The PDF also
contains factual multi-timeframe charts and the exact closed OHLCV rows.
"""

STRATEGY_NAME = "Ghost Machine - Raw Candle Edition"
STRATEGY_VERSION = "V6.5-ADAPTIVE-RAW-CANDLE"
PROMPT_CONTRACT_VERSION = "GHOST_MACHINE_ADAPTIVE_RAW_CANDLE_V4"
REQUIRED_TIMEFRAMES = ("1D", "4H", "1H", "15M", "5M")

STRATEGY_PROMPT = r"""
=== GHOST MACHINE STRATEGY RULES === V6.5 ADAPTIVE RAW CANDLE EDITION
PROMPT_CONTRACT_VERSION=GHOST_MACHINE_ADAPTIVE_RAW_CANDLE_V4

ROLE AND INPUTS
Analyze the attached raw closed OHLCV data using these rules. This is a
pending-limit strategy, not a guarantee that a trade exists every scan.
Map supported zones, evaluate their entry/stop/targets, and offer a candidate
only when every required check passes. Never manufacture a setup to avoid
NO_TRADE. All price evidence must come from the supplied packet.
Do not use web search, news, outside quotes or screenshots to add price facts.


MANDATORY ANALYSIS ORDER
1. READ THE ENTIRE PACKET FIRST. Identify symbol, server time, timeframe
boundaries, row ordering and available coverage. Validate rows and select the
latest truly closed 5M reference. Do not select a trade before reading data.
2. UNDERSTAND MARKET STRUCTURE. Apply the daily bias rule, then map confirmed
4H and 1H swings, trend or range, breaks and conflicts. Distinguish a current
retracement from the prevailing trend. Record swing source and confirmation
timestamps; a swing requiring two following bars is known only at the second
following bar's close. Do not infer structure from a majority timeframe vote.
3. MAP LIQUIDITY. Locate eligible HIGH/LOW pools and check their lifecycle.
Identify the potential directional draw without assuming that a trade exists.
4. CALCULATE VOLATILITY AND MOMENTUM from the correct indexed rows.
5. SCAN EVERY 1H/4H TRIPLE AND MAP SUPPORTED OBs. Establish bounds, formation
timestamps, lifecycle, displacement and any CRT/MSNR confluence.
6. EVALUATE ALL CANDIDATES. Apply the same scenario and distance rules for
every supported symbol, calculate structural stops and nearest eligible
targets, and compute RR. Cascade according to the defined ordering.
7. APPLY SESSION HANDLING AND VALIDATE OUTPUT. Produce the required JSON
only after factual arrays and top-level fields agree. Missing computations
mean INCOMPLETE, not a verified claim of no setup.
These steps define the analysis sequence, not a request for private reasoning.
Report concise findings and source/calculation evidence in the JSON.

SUPPORTED SYMBOLS
Crypto: BTC/USD only (Bitcoin). No ETH or other crypto.
Metals: XAU/USD (Gold), XAG/USD (Silver).
Forex: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD,
EUR/GBP, EUR/JPY, GBP/JPY.
Retain the packet symbol exactly. If an exact provider symbol is supplied,
report it separately. BTC/USD must not be silently relabeled BTCUSDT:
if provider_symbol=BINANCE:BTCUSDT is supplied, state that the candles are
Binance BTC/USDT underlying the app's BTC/USD label. Do not invent a venue.
An unsupported custom symbol has no configured profile: return NO_TRADE with
reason unsupported_symbol instead of borrowing Gold or BTC parameters.

INPUT VALIDATION AND REFERENCE
Rows are time,open,high,low,close,volume, chronological, UTC bar-open times.
Verify finite OHLC values, high >= max(open,close), low <= min(open,close),
high >= low, nonnegative volume, ascending unique times and interval spacing.
A row is closed only if bar-open + timeframe duration <= SERVER_TIME_UTC.
For UTC daily candles use the next UTC midnight. Reject unclosed rows even
if a header calls them CLOSED_ONLY. Report exclusions/gaps. Do not bridge
missing bars to form a three-candle FVG. Do not fabricate missing candles.
Reference = close of the newest valid closed 5M row. Report its open and
close timestamps. This is a CLOSED_5M_REFERENCE, not a live executable quote.
If a supplied reference header disagrees with that row, report the mismatch
and use the row. Missing valid 5M reference or server timestamp means NO_TRADE.
A reference older than 15 minutes at packet server time is stale for arming:
map the structure but return NO_TRADE with stale_reference.
Record actual row counts and latest open/close time per timeframe.
A daily candle still forming is correctly absent; do not call it missing.
Every cited price must identify an actual timeframe and row timestamp.
Never combine a 1H or 15M high with a nonexistent 4H candle.

STRICT RESPONSE FORMAT
Return exactly one markdown code block labeled json containing one valid,
pretty-printed JSON object with two-space indentation. No text or citations
outside it. Double-quoted strings; real null for missing values, not "null".
Keep explanations concise factual calculation summaries, not private reasoning.
Check JSON field values against the evidence and reason before responding.

1. DIRECTION, VOLATILITY AND VOLUME
Daily BULLISH: newest of last three closed daily candles has both high and
low above third-newest. BEARISH: both below. Otherwise RANGE.
Confirm with 4H structure; report conflicts rather than changing the daily
test silently. A confirmed swing high exceeds the highs of two preceding and
two following closed candles; invert for swing lows. Equal values form an
equal-level pool rather than a strict pivot. Two rising confirmed highs and
lows imply an uptrend; two falling highs and lows imply a downtrend.
If insufficient confirmed swings, report UNCLEAR, do not invent them.
Describe TRENDING, RETRACING, RANGING or TRANSITIONING from this evidence.

ATR convention for this entire strategy: arithmetic mean of the newest
14 true ranges, TR=max(high-low,abs(high-previousClose),abs(low-previousClose)).
Requires 15 consecutive closed candles. This is SMA ATR, not Wilder ATR.
Compute ATR separately for 1H and 4H where needed. No arbitrary fallback stop
if required ATR cannot be calculated: reject that candidate for missing ATR.

Volume baseline = mean of the 20 closed 1H candles immediately preceding
the newest three closed 1H candles (23 candles required).
STRONG_IMPULSE requires each of those three volumes >1.5*baseline, each body
abs(close-open) >=0.6*its range, and each body >= the mean absolute body of
the baseline 20 candles. All three bodies must point in the trend direction.
If complete evidence fails any condition, momentum_check=WEAK_RANGE; this
label means impulse test failed, not that the broader trend must be ranging.
Missing/nonpositive/unusable volume baseline means UNKNOWN.
Report baseline, three volumes and ratios. Never label STRONG_IMPULSE after
a failed test. A normal structural trend retest can qualify without the
three-candle impulse test. State this explicitly and reduce confidence.
Volume is relative within one instrument/feed; do not compare volume units
across symbols. If volume type is absent, say unspecified, not tick/real.

2. MARKET-ADAPTIVE DISTANCE AND STOP PROFILES
All distances are absolute quote-price units, never broker "points".
Use these explicit profiles; do not improvise different multipliers:
BTC/USD: minimum entry distance=0.10*ATR(1H); maximum=3.0*ATR(1H).
XAU/USD: minimum=0.10*ATR(1H); maximum=3.0*ATR(1H).
XAG/USD: minimum=0.10*ATR(1H); maximum=3.0*ATR(1H).
All listed forex pairs: minimum=0.10*ATR(1H); maximum=3.0*ATR(1H).
These are configurable strategy design parameters, not proven profitable
thresholds. There is no universal 20-200 price-unit gate.
Report the actual ATR and numeric permitted distance range every analysis.
Never change a threshold after seeing a candidate in order to force a trade.
The candidate must be outside the zone, on the correct side of reference,
and within this distance range at the reference timestamp.
For a 1H POI use ATR(1H); for a 4H POI use ATR(4H) for stop sizing.
ALL supported symbols use the SAME buffer formula:
buffer=0.5*POI-timeframe ATR, floored at one verified tick if supplied.
There is no Gold-only absolute floor. This deliberately replaces the old
Gold 4.50 rule: volatility scaling, not symbol name, determines the buffer.
The SAME scenarios, FVG/OB rules, RR threshold, candidate ordering and
confidence rules apply to every symbol. Only its own candles, price scale,
verified tick size and trading calendar change the calculated values.
Entry distance ALWAYS uses ATR(1H), even for a 4H POI. Stop buffer uses the
POI timeframe ATR. Never substitute the 4H ATR in the entry-distance gate.
For display, retain source price precision; do not invent execution tick size.
Absent bid/ask/spread or venue order rules does not prevent a reference-based
analysis, but execution must recheck price, spread, precision and order rules.

3. COMPLETE FVG AND ORDER BLOCK MAP
Scan ALL consecutive triples in supplied closed 1H and 4H rows, in time order
A,B,C. BEARISH if A.low>C.high: zone [C.high,A.low], width=A.low-C.high.
BULLISH if A.high<C.low: zone [A.high,C.low], width=C.low-A.high.
Record triple timestamps, compared values, bounds and width.
formation_time_utc is the ISO8601 timestamp at which C CLOSES, computed as
C open timestamp + timeframe duration. formation_price is C's numeric close.
For OBs, formation_time_utc is displacement candle close TIME; formation_price
is displacement candle close PRICE. Never use a price as a timestamp.
All later references to formation mean formation_time_utc.
For each zone examine valid closed candles whose OPEN time is >= formation
close time. Equality is included: the first bar opening at formation close
is a subsequent bar. Use finer timeframe rows to cover time since the latest
closed HTF candle. Do not use bars opening before formation to infer a touch.
Coverage ends at the latest supplied closed 5M close, not at server time;
the ordinary unfinished 5M interval is not a missing-data gap.
Never count the formation candles as a subsequent mitigation.
Bearish lifecycle: UNTOUCHED if all later highs < low edge; PARTIAL if any
later high >= low edge but none >= high edge; FILLED if any >= high edge.
Bullish: UNTOUCHED if all later lows > high edge; PARTIAL if any <= high edge
but none <= low edge; FILLED if any <= low edge.
INVALIDATED takes precedence when a later closed candle on the POI timeframe
closes beyond its far edge (above high for bearish, below low for bullish).
Evaluate ALL later POI-timeframe closes before assigning final lifecycle.
Precedence: INVALIDATED > FILLED > PARTIAL > UNTOUCHED. Do not stop at the
first touch and overlook later invalidation. Record first touch/fill and the
first invalidating close timestamps separately where applicable.
Missing post-formation coverage means UNKNOWN, not proven UNTOUCHED.
At the formation close with no elapsed later interval, UNTOUCHED is valid.
UNTOUCHED zones can arm. PARTIAL zones can qualify for a repeat retest only
if price has subsequently closed back OUTSIDE the proximal edge toward the
intended trade direction, with a closed POI-timeframe rejection candle whose
body points in that direction, and no subsequent far-edge fill/invalidation.
Entry remains the ORIGINAL proximal edge, stop beyond ORIGINAL far edge;
do not invent a narrower zone or move entry to force RR. Label repeat_retest
and record touch/rejection timestamps. A zone currently containing reference
cannot arm. FILLED, INVALIDATED and UNKNOWN zones cannot arm.
Do not use "mitigated" as an ambiguous synonym for all lifecycle states.

Order Block definition: last opposite-direction candle in the three bars
preceding a displacement candle on 1H/4H. Displacement body >=1.0*the prior
14-bar SMA ATR, body/range >=0.6, and close beyond the extreme of the three
closed candles immediately preceding displacement (above their highest high
for bullish, below their lowest low for bearish). Record those three rows.
A break of an already confirmed swing adds confluence but is not an
additional mandatory OB gate. An unavailable prerequisite means
NOT_CONFIRMED. Use the opposing candle's full high-low bounds. Formation is
the displacement close timestamp (with its closing price stored separately). Apply the same touch/fill/invalidation lifecycle.
Map overlapping zones as confluence without creating unsupported new bounds.
List ALL detected gaps and supported OBs with source timestamps; include
triple counts (N-2 for contiguous N rows), including rejected/filled zones.
A "NONE" claim must be supported by completed scan counts.

4. SCENARIOS, CRT/MSNR AND CANDIDATE CASCADE
Scenario A: trend-aligned displacement POI awaiting an eligible retest;
CHoCH not required. A historic displacement can remain valid when current
impulse volume has cooled. An impulse label alone does not qualify a POI.
Scenario B: range-edge liquidity sweep and a closed structure shift;
countertrend orders require this evidence and must be labeled reversal.
Bullish sweep: candle low below a previously established low pool and close
back above it; bearish inverse. CHoCH: subsequent closed 1H or 4H body closes
beyond an already confirmed opposing swing. Cite the swing and break times.
Use 15M/5M for confirmation/refinement only; eligible POIs remain 1H/4H.
Do not silently create a lower-timeframe strategy to produce an order.

Operational CRT definition here: on 1H or 15M, a closed reference candle A,
followed by B that sweeps one edge of A and closes back inside A's range;
a later closed C breaks B's opposite high/low in the reversal direction
without first closing beyond the swept extreme. Cite A/B/C and levels.
Operational MSNR definition here: on 1H or 15M, a previously confirmed swing
level is body-close broken, then a later candle retests that level and closes
on the breakout side. Cite the confirmed swing, breakout and retest.
These are explicit conventions for this file; do not imply a universal
definition. CRT/MSNR are confluence evidence, not mandatory gates on every
Scenario A setup. Use NOT_VISIBLE for insufficient coverage and
NOT_CONFIRMED when coverage exists but the defined sequence does not qualify.

Evaluate EVERY eligible zone in the distance range, nearest proximal edge
first; use newer formation, then confluence to break distance ties.
SELL_LIMIT above reference enters at zone low; BUY_LIMIT below enters at high.
Reject wrong side, reference inside zone, ineligible lifecycle, scenario failure or RR
failure; evaluate all candidates and record outcomes. Select the first
passing candidate under the stated ordering after the full review.
Do not stop after three failed candidates. Summarize best three in prose,
but report total evaluated and the rejection reason for every candidate.
Select the first passing candidate under this ordering. Never fabricate
additional zones or extend distance limits to avoid NO_TRADE.

5. LIQUIDITY, STOP AND RR
Liquidity sources: confirmed swings, equal highs/lows (difference <=0.05*
ATR on their timeframe), closed prior-day high/low, and session extremes only
where complete session coverage is supplied. FVGs/OBs are not liquidity.
An equal-level pool requires two distinct confirmed pivot touches within
the tolerance, separated by at least three bars. Establish it at the second
pivot confirmation; those two defining touches do not consume their own
pool. Later touches consume it. Report both source times and confirmation.
A newly confirmed swing pool must be evaluated using candles after its source
extreme; its formation candle touching its own price is not a later sweep.
For a HIGH pool, a later high >= level consumes it; LOW pool, later low <=
level consumes it. Record source and touch timestamps; missing lifecycle
coverage means UNKNOWN. Never claim a forming daily candle is prior-day data.
SELL targets are UNUSED LOW pools below entry; BUY targets UNUSED HIGH pools
above entry. Compare target side to ENTRY, not reference. A pool between
reference and pending entry may be eligible only if still unused; explain
that subsequent price movement before fill can consume it and cancel setup.
Select nearest eligible pool in trade direction for TP1, next distinct pools
for TP2/TP3; never skip nearest merely to manufacture RR.
Stop for SELL=POI high+buffer; for BUY=POI low-buffer.
Risk=abs(entry-stop); reward=abs(entry-TP1); RR=reward/risk. Require correct
directional ordering, positive risk/reward and RR>=2.00 after rounding.
If no confirmed unused target, reject with missing_eligible_liquidity.
Report each rejected candidate's calculated RR where calculation is possible.
PRE-SUBMISSION LIMIT CHECK (not a post-fill cancellation rule):
SELL_LIMIT is pending/nonmarketable when live BID < entry. It is immediately
marketable when BID >= entry. A price BELOW sell entry does NOT trigger
cancellation for marketability.
BUY_LIMIT is pending/nonmarketable when live ASK > entry. It is immediately
marketable when ASK <= entry. A price ABOVE buy entry does NOT trigger
cancellation for marketability.
If bid/ask are absent, execution status is UNKNOWN until a fresh quote;
reference-only checks use reference < sell entry or reference > buy entry
for analysis, never claim a live fill or executable quote.
Before submission, do not submit a marketable limit under this pending-only
strategy; rescan. Once a pending order is resting, price reaching entry is
its intended fill event, not automatically a reason to cancel. Check broker
fill status before issuing any cancellation. Cancel only unfilled orders for
target consumption, zone invalidation or expiry; filled trades require their
own stop/target management. Never apply pending expiry to a filled position.
A scan cannot promise that a distant zone will fill today.

6. SESSION, EXPIRY AND CONFIDENCE
UTC daily windows: PRIME 07:00-15:00; SHOULDER 06:00-07:00 and 15:00-17:00;
OFF_SESSION otherwise. Verify header against SERVER_TIME_UTC.
BTC uses these liquidity/confidence windows seven days a week; next PRIME
can be Saturday/Sunday. Metals/forex PRIME means Monday-Friday; weekends are
OFF_SESSION. Broker holidays/hours remain unknown unless explicitly supplied.
If header conflicts with this symbol calendar, report both and apply this
explicit calendar. Do not invent broker holidays.
PRIME: normal confidence, order_tag=prime, expiry at the next applicable PRIME open strictly after server time.
SHOULDER: subtract 15, cap70, order_tag=shoulder; arm only with the latest
closed 15M volume >1.5 times preceding 20 closed 15M mean. State values.
OFF_SESSION: cap50, order_tag=armed_off_session, expiry=next applicable PRIME
open. Use the same ATR distance gate; no separate Gold 20-point veto.
Session UNKNOWN alone need not erase a structural map; do not invent expiry.
A missing valid server timestamp prevents order arming.
Compute evidence score explicitly: bias alignment 0-30, momentum 0-30,
POI quality 0-25, volume confirmation 0-15, then session modifier.
It is an evidence score, not a probability or profit claim.

FINAL AUDIT AND NO_TRADE
NO_TRADE is valid when no supported candidate survives the defined checks,
or required reference/ATR/source evidence is missing. State actual failures.
Before responding verify: latest 5M reference exact; every cited row exists;
no open HTF candle imported; all triples scanned; all candidate decisions
accounted for; momentum enum agrees with its numeric test; price ordering
and RR correct; correct instrument profile and calendar applied.
Lack of screenshots or computed indicators is not a failure.
Keep packet inputs factual: candles, symbol/source, times, session and optional
volume/tick/quote metadata. Do not require precomputed POIs, SL, TP or setups.
If source/volume/tick metadata is absent, disclose it, do not fabricate it.


CALCULATION PROTOCOL (REQUIRED BEFORE SETUP SELECTION)
Index valid rows separately per timeframe from zero, oldest first.
Use full ISO timestamps including dates; bare T16 or "latest" is not a source.
If code execution is available, parse the attachment and calculate with it.
If unavailable, calculate from rows; never claim a tool was used or verified.
For N 1H rows, ATR uses rows N-14 through N-1 with prior close row N-15.
There are EXACTLY 14 TR values and 15 source candles. Sum TR then divide by14.
Apply the same indexing independently to 4H. Keep full precision internally.
Volume baseline uses rows N-23 through N-4 inclusive (20 rows); newest three
are N-3,N-2,N-1. Baseline and tested rows MUST NOT overlap.
Body direction is sign(close-open); a bearish candle aligns with bearish bias.
For each valid consecutive triple i,i+1,i+2 record:
[i,i+1,i+2,A.low-C.high,C.low-A.high].
A positive fourth number means bearish gap; positive fifth means bullish.
Zero means no gap. Do not invert inequalities. Include EVERY triple, even
when no gap exists. Triple count alone is not evidence of a completed scan.
Each positive difference MUST have a corresponding zone record, even if
that zone is later filled, invalidated or outside the candidate distance band.
Do not confuse detected_gap_count with eligible_candidate_count.
If the scan/calculation cannot be completed, use audit_status=INCOMPLETE,
action=NO_TRADE, reason=analysis_incomplete, and report the exact limitation.
This is an unavailable analysis, not a market claim that no setup exists.
Never claim completed verification when evidence arrays are absent.

STRUCTURED EVIDENCE CONTRACT
In addition to the summary fields, include these JSON fields with real arrays
and objects (not strings containing JSON). Empty arrays mean checked and none;
unknown/uncomputed numeric values are null, never fabricated zeros.
- audit_status: COMPLETE or INCOMPLETE.
- calculation_audit: object with atr_1h and atr_4h objects. Each contains
  timeframe, source_times (15 ISO open timestamps), true_ranges (14 numbers),
  tr_sum, period=14, value. Include volume_1h object with baseline_times
  (20 ISO timestamps), baseline_values (20 numbers), sum, mean, test_times
  (3 timestamps), test_values, ratios, body_values, body_range_ratios,
  baseline_body_mean, aligned_directions (3 booleans), impulse_pass.
- scan_audit: array of two objects, one per 1H/4H timeframe, each with
  timeframe, row_count, row_times (ISO timestamps in index order),
  triples (arrays defined above), skipped_triples (indices and gap reason),
  detected_gap_count. With continuous N rows triples must contain N-2 entries.
- zones: array of objects with id, timeframe, type, direction, source_indices,
  formation_time_utc (ISO8601 string), formation_price (number), low, high, width, lifecycle, lifecycle_evidence
  (source timeframe/time/high/low/close for relevant touches or rejection).
  Include every detected FVG and every supported OB.
- candidates: array with one object per evaluated zone: zone_id, scenario,
  retest_type, entry, distance, min_distance, max_distance, stop, buffer,
  target_pool_id, tp1, risk, reward, rr, eligible, rejection_reason.
  Preserve failed-candidate calculations even for NO_TRADE; top-level trade
  prices remain null in NO_TRADE. Missing target means null RR, not zero.
- pools: array of id, type HIGH/LOW, level, source_timeframe, source_times,
  confirmation_time, lifecycle UNUSED/CONSUMED/UNKNOWN, consumed_at.
- confidence_components: bias, momentum, poi, volume, base, session_adjusted.
Candidate count must equal candidates array length. Every selected zone and
target must reference a zones/pools entry. COMPLETE means the numerical audit
and source coverage are complete, not that a trade passes.
All summary strings and top-level fields MUST agree with these arrays.
The structured audit is calculation evidence, not private chain of thought.

JSON CONTRACT
Return every field below PLUS every structured evidence field defined above.
Required top-level evidence keys: audit_status, structure_audit,
calculation_audit, scan_audit, zones, candidates, pools, confidence_components.
Never omit audit_status. Validate its presence before sending.
In this candle-only workflow execution_status=REFERENCE_ONLY unless actual
timestamped bid/ask are supplied; only those quotes support NONMARKETABLE or
MARKETABLE. PENDING_QUOTE_CHECK means a specifically requested execution check
could not be completed.
formation_time_utc must parse as UTC ISO8601 and formation_price must be numeric.
Do not emit the old ambiguous formation_close key.
COMPLETE is allowed only if all requested calculations and scans are accounted
for; a skipped OB scan or unsupported lifecycle means INCOMPLETE. For NO_TRADE, set action-specific prices, risk, and
RR to null; setup to NONE; poi_timeframe to NONE; order_tag to none; confidence
to 0; and explain the actual failure. Use data_limitations instead of visual
limitations because this analysis is candle-file based.
{
  "audit_status": "COMPLETE" | "INCOMPLETE",
  "structure_audit": "<daily test, confirmed 4H/1H swings with full timestamps, trend/range and conflicts>",
  "execution_status": "REFERENCE_ONLY" | "PENDING_QUOTE_CHECK" | "NONMARKETABLE" | "MARKETABLE",
  "input_audit": "<row counts, latest times, exclusions and source metadata>",
  "instrument_profile": "<symbol, ATRs, distance limits, buffer and calendar>",
  "reference_close_time": <UTC ISO8601 string|null>,
  "volume_audit": "<baseline, volumes, ratios and impulse test>",
  "candidate_count_evaluated": <integer>,
  "management": "<expiry and prefill cancellation conditions or NONE>",
  "action": "BUY_LIMIT" | "SELL_LIMIT" | "NO_TRADE",
  "symbol": "<symbol from packet>",
  "reference_price": <number|null>,
  "price_read_quality": "CLOSED_5M_REFERENCE" | "UNAVAILABLE",
  "htf_bias": "BULLISH" | "BEARISH" | "RANGE" | "UNCLEAR",
  "market_phase": "TRENDING" | "RETRACING" | "RANGING" | "TRANSITIONING" | "UNCLEAR",
  "momentum_check": "STRONG_IMPULSE" | "WEAK_RANGE" | "UNKNOWN",
  "setup": "OB_RETEST" | "FVG_FILL" | "LIQUIDITY_SWEEP" | "NONE",
  "poi_timeframe": "4H" | "1H" | "NONE",
  "poi_low": <number|null>,
  "poi_high": <number|null>,
  "proximal_edge": <number|null>,
  "entry_distance": <number|null>,
  "entry": <number|null>,
  "stop_loss": <number|null>,
  "tp1": <number|null>,
  "tp2": <number|null>,
  "tp3": <number|null>,
  "risk": <number|null>,
  "rr_tp1": <number|null>,
  "tp1_pool_type": "LOW" | "HIGH" | null,
  "session_quality": "PRIME" | "SHOULDER" | "OFF_SESSION" | "UNKNOWN",
  "order_tag": "prime" | "shoulder" | "armed_off_session" | "none",
  "expires_at": <ISO8601 UTC string|null>,
  "choch_detected": true | false | null,
  "fvg_scan": "<auditable 1H/4H FVG arithmetic and mitigation>",
  "poi_candidate_review": "<ranked POIs, bounds, proximal edges, distances, and cascade decisions>",
  "liquidity_pool_audit": "<typed candidate pools, lifecycle, selected target, and skipped pools>",
  "crt_status": "CONFIRMED" | "NOT_CONFIRMED" | "NOT_VISIBLE",
  "msnr_status": "CONFIRMED" | "NOT_CONFIRMED" | "NOT_VISIBLE",
  "liquidity_draw": "<nearest eligible opposing liquidity pool and lifecycle, or UNKNOWN>",
  "stop_method": "<symbol-specific structural buffer with POI-timeframe SMA ATR evidence>",
  "confidence": <integer 0-100>,
  "reason": "<concise evidence-based justification>",
  "data_limitations": "<missing/uncertain input facts, or NONE>"
}

Return only the single JSON code block. Do not add chart or screenshot
requirements to the response.
"""


def get_strategy_prompt() -> str:
    """Return the raw-candle strategy prompt for file upload."""
    return STRATEGY_PROMPT.strip()


if __name__ == "__main__":
    print(get_strategy_prompt())


