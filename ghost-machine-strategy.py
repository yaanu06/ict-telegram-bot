"""Ghost Machine strategy embedded in the Mini App's AI Market Pack.

This is a prompt document, not an executable trading bot. The Markdown also
contains factual multi-timeframe OHLCV rows and the MACRO CONTEXT levels.
Design: CRT/TBS-FIRST PENDING-LIMIT. The model hunts a CRT/TBS trigger,
then maps the FVG/OB inside it as the trade. Raw candles only.
"""

STRATEGY_NAME = "Ghost Machine - CRT/TBS First Edition"
STRATEGY_VERSION = "V3.0-CRT-TBS-FIRST"
PROMPT_CONTRACT_VERSION = "CRT_TBS_CLEAR_V1"
REQUIRED_TIMEFRAMES = ("1D", "4H", "1H", "15M", "5M")

STRATEGY_PROMPT = r"""
=== GHOST MACHINE STRATEGY RULES === CRT/TBS-FIRST PENDING-LIMIT EDITION
RM/1. UNIVERSE: use only the CSV candles in this packet. Never invent a
candle, price, timestamp, volume or level. The levels in MACRO CONTEXT are
context only. The raw 1D/4H/1H/15M/5M rows are the only price facts.

RM/2. PENDING-LIMIT SEMANTICS (read first): this is a PENDING-LIMIT strategy.
Entry sits AHEAD of the current price and fills only when price reaches the
zone. Do NOT require any live confirmation at the current tick. Zone-interest
must be evaluated from (a) the candle pattern that formed the zone, (b) fresh
lifecycle, (c) volume/wick of the DISPLACEMENT candle. A zone is never
rejected because "price is not there yet".

=== TOP-DOWN CASCADE ===

TIER 1 - DIRECTION (1D, then 4H):
  Section L bias from the last three contiguous closed 1D candles; the 4H MSS
  tiebreaker confirms or downgrades to RANGE. A confirmed bias is mandatory.
  RANGE means no directional trade unless a named 4H MSS supplies direction.

TIER 2 - TRIGGERS (find the CRT/TBS FIRST, then the zone inside it):
  The bot uses ONLY these as triggers:

  A. CRT (Candle Range Theory - sweep + reclaim bar):
     1. REFERENCE CANDLE (A): the most recent CLOSED 4H or 1D candle whose
        high/low defines the reference range. 1H may be the sweep candle (B)
        or the reclaim candle (C), never A.
     2. SWEEP (B): the next CLOSED candle B wicks beyond A's high or A's low
        AND closes BACK INSIDE A's range. If B closes BEYOND A's edge, that
        is a breakout, not a CRT.
     3. RECLAIM (C): a later CLOSED candle C breaks B's opposite high/low in
        the reversal direction WITHOUT first closing beyond the swept extreme.
     A CRT trigger = A -> B -> C. Cite A, B, C with timestamps and levels.
     The tradeable zone is the FVG or OB created by the displacement leg C;
     it is the FIRST imbalance formed immediately after the sweep wick B.

  B. TBS (Time-Based Supply - classic ICT pre-session boundary pool):
     Pools = ASIA_HIGH / ASIA_LOW (in MACRO CONTEXT). When the LONDON or
     NEW YORK killzone wicks beyond the Asia high (or Asia low) and closes
     BACK INSIDE the Asia range, that session swept TBS. The tradeable zone
     is the FVG or OB created by that session's reversal leg, again the
     FIRST imbalance formed by the displacement.

  Co-plan: Once a CRT or TBS trigger is located, map the nested FVG/OB
  INSIDE that displacement leg - those zones are the trade; a bare FVG/OB
  with NO CRT/TBS parent is NOT a setup. If a trigger exists but every
  nested zone is exhausted/misoriented/too far/RR<2, or none exists at all,
  return NO_TRADE.

TIER 3 - ENTRY (15M and 5M preferred inside the nested zone):
  The pending-limit entry belongs at the proximal edge of the nested zone:
  for BUY_LIMIT the BOTTOM (proximal) edge of a bullish zone; for SELL_LIMIT
  the TOP (proximal) edge of a bearish zone. If price is already inside the
  HTF zone (FVG or OB), find the nested 15M/5M imbalance inside or just
  below/above it (whichever the direction requires) and use that as the
  pending candidate. Fallback: the proximal edge of the HTF zone itself.

=== CANDIDATE CONSTRUCTION ===
For each surviving trigger, compute:
  Entry = proximal edge of the nested zone (bullish: zone high; bearish:
  zone low). Entry must be AHEAD of current price (BUY_LIMIT: entry < price;
  SELL_LIMIT: entry > price). Ward off: entry at, or beyond, the opposite
  edge is a distal-edge error - do NOT use it.
  Stop = beyond the sweep wick + 0.50 buffer, minimum 4.50 points for XAU
  (wider for Asia: minimum 7.00 points).
  TP1 = opposite edge of A's range (CRT) or opposite Asia boundary (TBS), OR
  the nearest unused opposing liquidity pool (UNUSED pool strictly beyond
  entry), whichever gives the better RR. Never target a CONSUMED pool;
  if the nearest pool is consumed, cascade to the next unused pool.
  risk = |entry - stop|; reward = |entry - TP1|; RR = reward / risk >= 2.00.
  entry_distance = |entry - reference price|; must satisfy 0.10*ATR(1H) <=
  distance <= 3.0*ATR(1H) (ATR from closed 1H rows).
  Age = bars since the trigger's displacement candle; zones older than 24h
  never qualify.

=== INVALIDATION (trigger dead) ===
  - Price retraced ALL the way back to the sweep wick B after the reclaim
    before moving to target: the trap is played out. Skip.
  - Nested zone fully traversed/filled before entry: skip.
  - 4H/1H CHoCH or MSS invalidates the reference: skip.
  - If price has already entered the nested zone completely (no proximal
    edge remains): skip that entry candidate.

=== SELECTION & RANKING ===
  1. Tier 1 bias alignment is mandatory (counter-bias CRT/TBS are valid ONLY
     when a named 4H/1H MSS/CHoCH confirms the reversal).
  2. Trigger freshness: prefer the trigger formed in the last few candles
     (1H/15M/5M) - a CRT/TBS already many candles old has dead momentum.
  3. Distance: nearest proximal edge.
  4. RR: highest wins ties.
  Never select an exhausted trigger. Never fabricate a candidate.

=== SESSIONS ===
  - LONDON 07:00-11:00 UTC, OVERLAP 11:00-12:00, NEW YORK 12:00-15:00.
  - Killzone is informational only: NONE never blocks a trade. If NONE,
    confidence <= 50 and the window is reported in audit.killzone.
  - ASIA (00:00-07:00 UTC): same rules as London/NY, minimum 7.00-point XAU
    stop. Asian-range targeting is optional only (Asia-high/low opposing
    edge as TP), never mandatory.

=== OUTPUT CONTRACT ===
Reply with ONLY a single JSON object wrapped in a Markdown code block using
the language identifier `json`. Start with ```json and end with ```.
Do NOT write any prose outside the code block.

{
  "action": "BUY_LIMIT|SELL_LIMIT|NO_TRADE",
  "setup": "CANDLE_RANGE_SWEEP|FVG_FILL|OB_RETEST|TBS_SWEEP|LIQUIDITY_SWEEP|NONE",
  "current_market_context": "<TRENDING_BULLISH|TRENDING_BEARISH|RANGING|CONSOLIDATING>",
  "crt_msnr_confirmation": "<1 sentence naming the CRT trigger (A/B/C timestamps) or the TBS sweep, and the MSNR trap that formed the zone; write 'MSNR: NOT_CONFIRMED' when absent>",
  "sniper_zone_justification": "<1 sentence proving the entry is at an FVG/imbalance or the proximal edge of the CRT/TBS displacement leg, and the displacement was aggressive>",
  "price_action_confirmation": "<1 sentence explaining the rejection wick size (body vs wick) and the volume spike (>= 1.2x the average of the prior 3 candles) of the DISPLACEMENT candle>",
  "session_volatility_check": "<1 sentence explaining if the SL and TP are sized correctly for the current session's ATR>",
  "entry": <number|null>,
  "stop_loss": <number|null>,
  "tp1": <number|null>,
  "tp2": <number|null>,
  "tp3": <number|null>,
  "risk": <number|null>,
  "rr_tp1": <number|null>,
  "confidence": <integer 0-100>,
  "timeframe_used": "1d|4h|1h|15m|5m|NONE",
  "management": "<text instruction or NONE>",
  "audit": {
    "daily_bias": {
      "direction": "BULLISH|BEARISH|RANGE",
      "d3_h": <number>, "d3_l": <number>,
      "d2_h": <number>, "d2_l": <number>,
      "d1_h": <number>, "d1_l": <number>,
      "four_hour_mss": "<timestamp or NONE>"
    },
    "sweeps": [
      {"tf": "1d",  "bullish": "<tf ts level direction tier>", "bearish": "<tf ts level direction tier>"},
      {"tf": "4h",  "bullish": "...", "bearish": "..."},
      {"tf": "1h",  "bullish": "...", "bearish": "..."},
      {"tf": "15m", "bullish": "...", "bearish": "..."},
      {"tf": "5m",  "bullish": "...", "bearish": "..."}
    ],
    "breaks": [
      "<BREAKOUT: tf ts level>",
      "<BREAKDOWN: tf ts level>",
      "<FAILED_BREAKOUT: tf ts level>",
      "<FAILED_BREAKDOWN: tf ts level>"
    ],
    "killzone": {
      "server_time_utc": "<timestamp>",
      "computed_window": "ASIA|LONDON|OVERLAP|NEW_YORK|NONE",
      "inside": true
    }
  },
  "reason": "<evidence: A/B/C or Asia sweep ts + levels, nested-zone bounds, stop, TP1 pool why unused, RR calc, bias justification>"
}

VALIDATION RULES (the parser will enforce these):
- BUY_LIMIT: entry < current_price, stop_loss < entry, entry < tp1 < tp2 < tp3
- SELL_LIMIT: entry > current_price, stop_loss > entry, entry > tp1 > tp2 > tp3
- rr_tp1 must equal (|tp1 - entry| / |entry - stop_loss|) to two decimals
- rr_tp1 must be >= 2.00 for BUY_LIMIT or SELL_LIMIT
- For XAU/USD, |entry - stop_loss| must be >= 4.50
- crt_msnr_confirmation must name the CRT A/B/C or the TBS sweep and the MSNR trap (or 'MSNR: NOT_CONFIRMED')
- audit.sweeps must contain exactly 5 entries (1d, 4h, 1h, 15m, 5m)
- Killzone is informational only; NONE caps confidence at 50, never forces NO_TRADE
- On NO_TRADE: entry, stop_loss, tp1, tp2, tp3, risk, rr_tp1 = 0; confidence = 0; timeframe_used = "NONE"; management = "NONE"
- On BUY_LIMIT/SELL_LIMIT: every price must trace to a candle in the supplied blocks. Never invent a level
- sniper_zone_justification must explicitly mention an FVG/imbalance or the proximal edge
- If entry is at the 50% equilibrium or distal edge, it is a contract violation
- price_action_confirmation must mention the candle body/wick ratio and volume spikes
- session_volatility_check must state whether the SL and TP are sized correctly for the current session ATR
- Do NOT include extra fields
"""


def get_strategy_prompt() -> str:
    """Return the CRT/TBS-first strategy prompt for file upload."""
    return STRATEGY_PROMPT.strip()
