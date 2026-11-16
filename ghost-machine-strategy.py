"""Ghost Machine strategy for RAW CANDLE NATIVE mode (ChatGPT/DeepSeek test).

This is a prompt document, not an executable trading bot. The model receives
raw closed OHLCV rows ONLY and must perform the full mechanical audit itself:
ATR, FVG triples, order blocks, CRT/MSNR, liquidity pools, distance and RR.
No locally pre-calculated facts are supplied.
"""

STRATEGY_NAME = "Ghost Machine - Raw Native Edition"
STRATEGY_VERSION = "RAW-NATIVE-V1"
PROMPT_CONTRACT_VERSION = "GHOST_MACHINE_RAW_CANDLE_NATIVE_V1"
REQUIRED_TIMEFRAMES = ("1D", "4H", "1H", "15M", "5M")

STRATEGY_PROMPT = r"""
=== GHOST MACHINE STRATEGY RULES === RAW CANDLE NATIVE EDITION
PROMPT_CONTRACT_VERSION=GHOST_MACHINE_RAW_CANDLE_NATIVE_V1

ROLE AND INPUTS
Analyze the attached raw closed OHLCV data using these rules. This is a
pending-limit strategy, not a guarantee that a trade exists every scan.
All price evidence must come from the supplied CLOSED rows only.
Do not use web search, news, outside quotes or screenshots to add price facts.
CANDLE_FORMAT=time,open,high,low,close,volume per row. Rows are in
chronological order and every listed row is closed.

MANDATORY ANALYSIS ORDER (do this explicitly, then output only JSON)
1. READ THE ENTIRE PACKET FIRST. Identify symbol, server time, timeframe
boundaries, row ordering and available coverage. Do not select a trade
before reading data. Report row coverage per timeframe.
2. UNDERSTAND MARKET STRUCTURE. Apply the daily bias rule: compare the
last closed daily candle against the third-newest closed daily candle
(lower high + lower low = BEARISH; higher high + higher low = BULLISH;
otherwise RANGE). Then map confirmed 4H and 1H swings with a two-bar
fractal (a swing high is a high strictly greater than the two highs on
each side; a swing low is a low strictly less than the two lows on each
side). Do not infer structure from a timeframe vote.
3. CALCULATE ATR(14) for 4H and 1H using Wilder's smoothing over the CLOSED
rows of each timeframe. State the ATR values in your workings.
4. SCAN EVERY 1H/4H CANDLE TRIPLE for Fair Value Gaps.
   BEARISH FVG (gap down): A.low > C.high -> Zone = [C.high, A.low].
   BULLISH FVG (gap up):   C.low > A.high -> Zone = [A.high, C.low].
   Only wick extremes count. List every FVG with: timeframe, direction,
   zone bounds [low, high], formation_time (close of candle C in UTC).
   Classify lifecycle of each FVG from later candles: UNTOUCHED (no later
   candle traded into the zone), PARTIAL (touched but not fully crossed),
   FULLY_TRAVERSED (later candle traded through the full zone). A FVG
   whose lifecycle is FULLY_TRAVERSED is dead and must never be armed.
5. SCAN FOR ORDER BLOCKS. A BUY OB is a down candle followed by an up
candle whose high exceeds the down candle's high. A SELL OB is an up
candle followed by a down candle whose low undercuts the up candle's low.
Lifecycle: INVALIDATED if a later candle closes beyond the OB far edge;
otherwise RETESTED (later candles touched it) or UNTOUCHED.
6. CRT AND MSNR (optional confluence only). On 1H or 15M, CRT = reference
candle A closed, candle B sweeps one edge of A and closes back inside A's
range, a later closed C breaks B's opposite high/low in the reversal
direction. MSNR = a previously confirmed swing level is body-close broken,
then a later candle retests that level and closes on the breakout side.
If coverage is insufficient or the sequence does not qualify, mark
NOT_VISIBLE / NOT_CONFIRMED. Never fabricate either.
7. MAP LIQUIDITY. Confirmed swings are pools. For every pool, list:
timeframe, type HIGH/LOW, level, source time, confirmation time (the close
of the second bar after the swing extreme - a swing is knowable only then),
lifecycle UNUSED or CONSUMED. A pool is CONSUMED if any candle after its
confirmation closed with a high at or above (HIGH pool) or a low at or
below (LOW pool) the level. Equal highs/lows within 0.05*ATR on their
timeframe and separated by at least three bars count as one pool; report
both source times.
8. EVALUATE EVERY CANDIDATE POI (FVG or OB, plus CRT/MSNR confluence if
any). For each candidate compute:
   entry = proximal edge (BUY_LIMIT: zone_high / SELL_LIMIT: zone_low);
   action = BUY_LIMIT only if entry < reference price, else SELL_LIMIT;
   stop beyond the far edge with buffer max(3.0, 0.5*ATR(POI timeframe));
   stop must be a structural far-edge + buffer, not a round number;
   target = NEAREST pool with lifecycle UNUSED (skip CONSUMED pools; never
   target a consumed pool, dead liquidity is not a target);
   risk = |entry - stop|; reward = |entry - TP1|; RR = reward / risk;
   entry_distance = |entry - reference|;
   age = bars from formation_time to scan time * timeframe duration.
Reject any candidate that fails one of these hard filters:
   - age > 24 hours (stale);
   - lifecycle FULLY_TRAVERSED / INVALIDATED (already played out - the
     setup is a post-mortem, never arm it);
   - entry already consumed: for a sell, any candle after formation closed
     with high > zone_high; for a buy, any candle after formation closed
     with low < zone_low (price already went through the zone);
   - TP1 pool CONSUMED or no UNUSED pool remains on the profitable side;
   - chase: current price already at or within 10% of the remaining reward
     to TP1 (the edge is gone);
   - entry_distance < 0.25*ATR(1H) or entry_distance > 3.0*ATR(1H)
     (minimum distance and maximum distance);
   - RR after rounding to 2 decimals < 2.00;
   - worthless direction (BUY above reference or SELL below it).
Rank surviving candidates by: 1) FRESHNESS (newest formation first),
2) DISTANCE (nearest entry first), 3) CONFLUENCE (same-direction FVG +
OB/CRT/MSNR overlap). Never pick a stale candidate just because it is
closer; if every candidate fails, return NO_TRADE.

SESSION HANDLING
Sessions (UTC): PRIME = london open 07:00-11:00 and new_york 13:00-15:00
(overlap counts as PRIME); SHOULDER = pre-london 06:00-07:00,
non-prime 11:00-13:00, post-new_york 15:00-17:00; OFF_SESSION = everything
else. A setup in SHOULDER caps confidence at 70 and OFF_SESSION caps it at
50. PRIME has no confidence cap. Session never vetoes a trade; it only
caps confidence and sets order_tag ("prime" / "shoulder" /
"armed_off_session").

OUTPUT CONTRACT
If NO candidate passes every hard filter, output action=NO_TRADE with all
trade fields null and a factual explanation in reason. Otherwise select
ONE candidate and output only this single JSON block and no text outside
it:
{
  "action": "BUY_LIMIT|SELL_LIMIT|NO_TRADE",
  "entry": <number|null>,
  "stop_loss": <number|null>,
  "tp1": <number|null>,
  "tp2": null,
  "tp3": null,
  "risk": <number|null>,
  "rr_tp1": <number|null>,
  "confidence": <integer 0-100>,
  "analysis": "<maximum 240 characters; factual setup/no-trade explanation>",
  "selected_candidate_id": "<candidate id or null>",
  "opportunity_status": "FRESH_OPPORTUNITY|ESTABLISHED_PENDING_ZONE|NO_TRADE",
  "setup_fingerprint": "<symbol|timeframe|poi_type|action|zone_low|zone_high|formation_time or null>",
  "symbol": "<packet symbol>",
  "htf_bias": "BULLISH|BEARISH|RANGE|UNCLEAR",
  "setup": "FVG_FILL|OB_RETEST|CRT_SWEEP|MSNR_RETEST|LIQUIDITY_SWEEP|NONE",
  "session_quality": "PRIME|SHOULDER|OFF_SESSION|UNKNOWN",
  "order_tag": "prime|shoulder|armed_off_session|none",
  "expires_at": "<ISO8601 UTC or null>",
  "reason": "<same concise factual text as analysis>"
}
Copy entry, stop_loss, tp1, risk and rr_tp1 exactly from your own computed
candidate as JSON numbers. Confidence caps above are hard output rules.
Return ONLY one ```json code block with this object inside it.
Name candidates "CANDIDATE-<TF>-<TYPE>-<index>", e.g. CANDIDATE-1H-BEARISH-27.
Do NOT output an array of candidates; output only the selected one.
Never manufacture a trade to avoid NO_TRADE.
"""


def get_strategy_prompt() -> str:
    """Return the raw-candle native strategy prompt for file upload."""
    return STRATEGY_PROMPT.strip()
