=== OUTPUT CONTRACT (STRICT) ===
Reply with ONE markdown code block containing a single JSON object and nothing
else. No prose before or after. Use these exact keys and no others. Numbers are
plain numbers rounded to 2 decimals. Start the final reply with the literal
opening fence ```json on its own line. Indent the object with two spaces,
keep the keys in the order below, and finish with the closing fence.

{
  "action": "BUY_LIMIT" | "SELL_LIMIT" | "NO_TRADE",
  "reason_code": "NONE" | "<one allowed code>",
  "grade": "A" | "B" | "NONE",
  "entry": number,
  "stop_loss": number,
  "tp1": number,
  "tp2": number,
  "tp3": number,
  "risk": number,
  "rr_tp1": number,
  "confidence": integer 0-100,
  "poi_zone_low": number,
  "poi_zone_high": number,
  "dol_level": number,
  "expiry_hours": 24 | 48,
  "htf_context": "1-2 sentences: 1D structure, bias, and the DOL with level and timestamp",
  "ltf_confirmation": "1 sentence on any 15M/5M sweep or rejection, or NONE if the POI stands alone",
  "citations": ["each cited price/level with its candle timestamp or named level"],
  "citations_verified": true | false,
  "fail_reasons": ["NONE, or the failed checks"],
  "reason": "evidence chain: DOL -> POI body range and source candle -> entry edge -> stop anchor and buffer -> TP1 pool and why it is unused",
  "notes": "warnings (stale quote, gap, rr_below_preferred, unknown spread/tick, session NONE) or NONE",
  "watch_next": "for NO_TRADE: the nearest zone/level to monitor for a future setup"
}

JSON RULES
- On NO_TRADE: entry, stop_loss, tp1, tp2, tp3, risk, rr_tp1 = 0;
  confidence = 0; grade = "NONE"; reason_code = the allowed code; fail_reasons
  must contain that code.
- On NO_TRADE with no identifiable POI, use 0 for both zone bounds. Use 0
  for an unavailable DOL and false for citations_verified if evidence is missing.
- For an identified POI, poi_zone_low < poi_zone_high. dol_level is a single number (use the
  midpoint of a cluster).
- risk and rr_tp1 must equal the arithmetic from your own numbers. Recompute
  before replying; if they do not match, fix them.
- Do not add, remove, or rename keys. Do not wrap the JSON in prose.

=== SELF-CHECK BEFORE OUTPUT ===
1. Direction came from 1D, confirmed by 4H; any conflict is noted.
2. DOL exists, is unmitigated, and matches the trade direction.
3. POI is unmitigated, cited to a candle timestamp, and its proximal edge is on
   the correct side of price.
4. Stop is beyond invalidation plus the symbol-aware buffer, never in the wick.
5. TP1 is the nearest unused, not body-broken pool; TP ordering is correct.
6. RR arithmetic appears twice and matches risk/rr_tp1.
7. Every cited price has a timestamp or named level.
8. If any check fails and cannot be fixed, return NO_TRADE with a valid code.
