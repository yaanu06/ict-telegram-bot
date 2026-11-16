"""Ghost Machine hybrid chart-and-candle strategy for DeepSeek uploads.

The Mini App sends this file in a Markdown pack together with exact closed
1D/4H/1H/15M/5M candles and separate factual 1D/4H/1H PNG charts.
"""

STRATEGY_NAME = "Ghost Machine - Hybrid Chart and Candle Edition"
STRATEGY_VERSION = "V7.1-HYBRID-CHART-CANDLE"
PROMPT_CONTRACT_VERSION = "GHOST_MACHINE_HYBRID_V1"
REQUIRED_TIMEFRAMES = ("1D", "4H", "1H", "15M", "5M")

STRATEGY_PROMPT = r"""
=== GHOST MACHINE STRATEGY RULES === V7.1 HYBRID CHART + RAW CANDLE EDITION
PROMPT_CONTRACT_VERSION=GHOST_MACHINE_HYBRID_V1

=== ABSOLUTE OUTPUT RULE ===
Return exactly ONE valid, pretty-printed JSON object inside ONE markdown code
block labelled json. Use two-space indentation, double-quoted keys/strings and
real JSON null values. Do not write any prose before or after the code block.

=== INPUT AUTHORITY ===
This upload contains one Markdown market pack and three separate factual PNG
charts: 1D, 4H and 1H. The Markdown also contains CLOSED_ONLY raw OHLCV rows
for 1D, 4H, 1H, 15M and 5M.

1. Read the entire Markdown pack and inspect ALL three chart images first.
2. Use charts for structure, displacement, FVG/OB location, liquidity, CRT,
   MSNR and whether a POI is fresh, filled or invalidated.
3. Use raw candle rows for exact prices, timestamps, stop/target arithmetic,
   reference price and RR. Do not use web search/news/outside prices.
4. There is NO pre-calculated candidate list, NO `candidate_math`, and NO
   `LOCAL VERIFIED MATH FACTS` in this workflow. Never return NO_TRADE merely
   because those fields are absent. Map the valid POIs yourself from the charts
   and confirm exact bounds from the supplied candle rows.
5. The charts and rows are factual inputs, not trade recommendations. A pending
   limit setup may be distant from current price, but it must still be a genuine
   future retest. Never invent a trade to avoid NO_TRADE.

=== ANALYSIS SEQUENCE ===

STEP 1 — READ THE CURRENT MARKET
- Confirm all inputs are for the same symbol and identify SERVER_TIME_UTC,
  current/reference price and the newest closed 5M row.
- Use 1D for macro context, 4H for prevailing structure/liquidity, 1H for the
  selected POI, and 15M/5M only for confirmation/refinement.
- Classify structure from confirmed swing progression: BULLISH HH/HL, BEARISH
  LH/LL, RANGE or TRANSITIONING. A BOS/CHoCH requires a body close beyond a
  confirmed swing; a wick alone is a liquidity sweep.

STEP 2 — MAP LIQUIDITY
- Map visible prior-day highs/lows, session highs/lows, equal highs/lows and
  confirmed swing pools. FVGs and OBs are POIs, NEVER liquidity pools.
- Treat a pool as consumed if a later closed candle trades through it. TP1 must
  be the nearest UNUSED opposing liquidity pool from entry, not a farther pool
  chosen only to manufacture RR.

STEP 3 — MAP POIs FROM THE CHARTS
- Find visible 1H/4H FVGs, order blocks, breakers/flips and displacement zones.
- Bearish FVG: A.low > C.high, zone [C.high, A.low]. Bullish FVG: A.high <
  C.low, zone [A.high, C.low]. Use raw rows to verify exact zone edges when
  readable; do not confuse an arbitrary candle gap with an FVG.
- OB: final opposing candle before a clear displacement which breaks structure.
- Mark lifecycle: FRESH/UNTOUCHED, PARTIAL, FILLED, INVALIDATED or UNCLEAR.
  FILLED and INVALIDATED zones cannot be armed. PARTIAL requires visible
  rejection and departure before it can be a repeat retest.
- Prefer a 4H/1H confluence POI, fresh displacement origin, correct structure
  direction and a clear liquidity draw. Do not automatically reuse yesterday's
  old zone when a fresher opportunity exists.

STEP 4 — CRT, MSNR AND SCENARIO
- CRT CONFIRMED only when a reference range is swept on one side, price closes
  back inside, then breaks the opposite side. Cite the levels/times.
- MSNR CONFIRMED only when confirmed support/resistance body-close breaks, then
  retests from the other side with rejection. Cite the level/times.
- Scenario A TREND_RETEST: a trend-aligned 1H/4H FVG/OB retest. CHoCH is not
  required, though CRT/MSNR improve confluence.
- Scenario B SWEEP_REVERSAL: a range-edge sweep plus a confirmed CHoCH. A
  countertrend limit without this evidence is invalid.
- CRT/MSNR are confluence, not mandatory gates for a valid trend retest.

STEP 5 — SELECT THE BEST CURRENT PENDING LIMIT
- Rank every eligible POI nearest first while prioritising freshness, 4H/1H
  confluence and structural quality. Include at least the best three in
  candidate_review whenever they exist.
- SELL_LIMIT entry must be ABOVE reference price at the POI low/proximal edge.
  BUY_LIMIT entry must be BELOW reference price at the POI high/proximal edge.
- If price is inside a POI, it is not a new pending-limit opportunity. If the
  nearest POI is filled, invalidated, on the wrong side, too close to arm, or
  fails RR, cascade to the next eligible POI.
- A distant but fresh valid zone is allowed. Do not reject it merely because it
  is above/below current price; that is how a pending limit works. Label it
  ESTABLISHED_PENDING_ZONE if it is valid but not newly formed.

STEP 6 — RISK AND TARGETS
- Entry = selected POI proximal edge.
- SELL stop = POI far/high edge plus a structural buffer. BUY stop = POI
  far/low edge minus a structural buffer. Never put SL inside the zone.
- If 14 closed same-timeframe rows make ATR practical, use 0.5 x ATR as a
  buffer and state the arithmetic. Otherwise use the next clear structural
  invalidation beyond the far edge and state ATR_UNAVAILABLE; never invent ATR.
- TP1 = nearest unused opposing liquidity pool. TP2/TP3 are the next distinct
  unused pools in the same direction when visible.
- Risk=abs(entry-stop_loss); reward=abs(entry-tp1); rr_tp1=reward/risk.
  Require RR >= 2.00. Do not skip a nearer valid target to force RR.

STEP 7 — SESSION AND CONFIDENCE
- PRIME=07:00–15:00 UTC: order_tag prime.
- SHOULDER=06:00–07:00 or 15:00–17:00 UTC: order_tag shoulder, confidence cap 70.
- OFF_SESSION otherwise: order_tag armed_off_session, confidence cap 50 and
  expires_at next PRIME open when server time is available.
- Session changes confidence/order handling; it is never the sole reason to
  erase a structurally valid pending setup.
- Confidence is evidence quality, not profit probability: structure 0–30,
  POI/freshness 0–25, liquidity/CRT/MSNR 0–20, displacement 0–15, data clarity
  0–10, then session cap.

=== NO_TRADE ===
Return NO_TRADE only if no visible, still-eligible 1H/4H POI has correct pending
side, structural scenario support, valid stop, unused TP1 and RR >= 2.00. State
the actual failed gate. Do not cite missing pre-calculated facts or missing
candidate_math as a failure.

=== JSON CONTRACT ===
{
  "audit_status": "COMPLETE|INCOMPLETE",
  "action": "BUY_LIMIT|SELL_LIMIT|NO_TRADE",
  "symbol": "<packet symbol>",
  "server_time_utc": "<ISO8601 or null>",
  "reference_price": <number|null>,
  "timeframes_reviewed": ["1D", "4H", "1H", "15M", "5M"],
  "htf_bias": "BULLISH|BEARISH|RANGE|UNCLEAR",
  "market_phase": "TRENDING|RETRACING|RANGING|TRANSITIONING|UNCLEAR",
  "setup": "FVG_FILL|OB_RETEST|FVG_OB_CONFLUENCE|CRT_SWEEP|MSNR_RETEST|LIQUIDITY_SWEEP|NONE",
  "scenario": "TREND_RETEST|SWEEP_REVERSAL|NONE",
  "opportunity_status": "FRESH_OPPORTUNITY|ESTABLISHED_PENDING_ZONE|NO_VALID_OPPORTUNITY",
  "poi_timeframe": "4H|1H|NONE",
  "poi_type": "FVG|OB|FVG_OB_CONFLUENCE|BREAKER|SUPPLY|DEMAND|NONE",
  "poi_low": <number|null>,
  "poi_high": <number|null>,
  "poi_lifecycle": "FRESH|UNTOUCHED|PARTIAL|FILLED|INVALIDATED|UNCLEAR|NONE",
  "entry": <number|null>,
  "stop_loss": <number|null>,
  "tp1": <number|null>,
  "tp2": <number|null>,
  "tp3": <number|null>,
  "risk": <number|null>,
  "reward_tp1": <number|null>,
  "rr_tp1": <number|null>,
  "rr_calculation": "<exact arithmetic or NONE>",
  "liquidity_draw": "<TP1 pool and lifecycle or NONE>",
  "choch_detected": <true|false|null>,
  "crt_status": "CONFIRMED|NOT_CONFIRMED|NOT_VISIBLE",
  "msnr_status": "CONFIRMED|NOT_CONFIRMED|NOT_VISIBLE",
  "session_quality": "PRIME|SHOULDER|OFF_SESSION|UNKNOWN",
  "order_tag": "prime|shoulder|armed_off_session|none",
  "expires_at": "<ISO8601 UTC or null>",
  "confidence": <integer 0-100>,
  "candidate_review": [
    {"rank": 1, "poi": "<timeframe/type/bounds>", "lifecycle": "<state>", "decision": "SELECTED|REJECTED", "reason": "<concise>"}
  ],
  "analysis": "<concise structure, liquidity, POI and price-action evidence>",
  "reason": "<final setup or NO_TRADE rationale>",
  "data_limitations": "<missing/unclear inputs or NONE>"
}

For NO_TRADE: set entry, stop_loss, tp1, tp2, tp3, risk, reward_tp1 and rr_tp1
to null; setup/scenario to NONE; order_tag none; confidence 0. Do not omit keys.
"""


def get_strategy_prompt() -> str:
    """Return the hybrid chart-and-candle strategy prompt."""
    return STRATEGY_PROMPT.strip()


if __name__ == "__main__":
    print(get_strategy_prompt())
