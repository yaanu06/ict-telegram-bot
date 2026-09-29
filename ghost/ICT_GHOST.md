# ICT Ghost Trading Specification

## Identity and authority

ICT Ghost is a separate, AI-readable representation of the current ICT Trading Bot Pro. The production repository is the source of truth: script.js, server/proxy.js, tools/tvkit_service.py, render.yaml, index.html, server/README.md, and relevant tests were inspected.

This package does not replace the Telegram Mini App, submit orders, read Scan Replay, or contain today's market state. It describes the current analysis contract. AI interpretation is never deterministic proof.

The current architecture is:

    TVKit closed candles
      -> one canonical snapshot
      -> normalized history and data-quality checks
      -> deterministic structure, liquidity, POI and target evidence
      -> historical plus current regenerated candidates
      -> compact semantic AI context
      -> market phase and opportunity-role interpretation
      -> deterministic evidence and geometry verification
      -> exact entry, structural SL, real TP ladder and RR
      -> lifecycle, risk and status checks
      -> one opportunity or NO_TRADE

Core rule: AI discovers and interprets; code proves and executes.

## Direction -> Location -> Execution

Direction is the current evidence-backed thesis. Location is a real deterministic POI. Execution is a deterministic order model and price construction. A directional opinion alone is never a trade.

The AI may choose supplied candidate/evidence IDs and explain a thesis. It must not invent an entry, stop, target, RR, candidate ID, or evidence ID. Code resolves exact prices from the referenced structures and re-verifies them before publication.

## Required current data

Obtain one quote and closed OHLC history for exactly:

| Bot timeframe | TVKit interval | Role |
|---|---|---|
| 1D | 1day | macro direction and dealing range |
| 4H | 4h | primary structure, liquidity and major POIs |
| 1H | 1h | intermediate/current structure and continuation POIs |
| 15M | 15min | execution structure and fresh retracements |
| 5M | 5min | refinement and confirmation context |

The production request normally uses outputsize 200. A candle contains timestamp, open, high, low, close and optional volume. The normalizer converts provider fields to internal t/o/h/l/c/v fields, parses timestamps, marks forming candles, removes forming candles, validates finite OHLC and timestamps, rejects impossible OHLC geometry, sorts oldest-to-newest, and rejects duplicate/unordered times.

All five histories, the quote, evidence IDs and verification must refer to one scan snapshot/as-of. Never claim a live result without successful current data. Never use weekly history in this Ghost trading workflow.

For XAU/USD the current TVKit service maps the user symbol to OANDA:XAUUSD. The current Render deployment documented by index.html is https://ict-telegram-bot-temf.onrender.com. No credential belongs in this package.

## Timeframe interpretation

All timeframes need not agree. 1D is macro context; 4H is primary location; 1H is intermediate location; 15M is execution structure; 5M refines execution. A bullish 15M/5M movement may be a retracement within a bearish 1D/4H/1H thesis. Disagreement is evidence to interpret, not an automatic rejection.

## Direction evidence

Use only retrieved/derived evidence:

- structural and effective/momentum trend;
- swings and HH/HL/LH/LL;
- BOS, MSS and CHoCH;
- displacement;
- liquidity sweeps, reclaims, buy-side and sell-side liquidity;
- equal highs/lows;
- dealing range, equilibrium and premium/discount;
- structural objectives and liquidity draw;
- ADX, RSI, MACD, EMA, Supertrend and ATR as context;
- timeframe conflicts.

The implementation combines closed-candle EMA/range/displacement direction helpers with the richer market context. Do not reduce the bot to one indicator. Direction may be BUY, SELL or unclear.

## Market phase and opportunity roles

The production phase vocabulary is:

ORIGINAL_SETUP, EARLY_DELIVERY, EXPANSION, RETRACEMENT, CONTINUATION_READY, LATE_DELIVERY, TRANSITION_WAIT.

Phase is a combined sequence interpretation, not RSI, ADX, ATR distance or any single formula.

Selectable roles are:

- ORIGINAL_THESIS_POI: the original thesis location;
- FRESH_RETRACEMENT_POI: a fresh current location for a deeper/current retracement;
- FRESH_CONTINUATION_POI: a fresh location formed during the current directional sequence;
- CONFIRMATION_POI: a location whose execution model needs confirmation.

The system compares old and regenerated current candidates. Consumed, expired, stale or invalid records are not resurrected. If an AI-preferred role fails hard verification, use only an explicitly authorized supplied fallback; otherwise return NO_TRADE. Never retain reasoning for candidate A while publishing geometry from unrelated candidate B.

## Deterministic structures and setup labels

The canonical evidence package may contain swings, structure, BOS/MSS/CHoCH, displacement, FVG, OB, supply/demand, flips/reclaims, MSNR, CRT, TBS/Turtle Soup, liquidity, previous-period levels, dealing range, premium/discount, target evidence and invalidation evidence.

A location and a model are separate:

- FVG, OB, supply, demand, flip, liquidity, BOS/MSS/CHoCH and displacement are structural/location evidence.
- CRT, TBS and MSNR are executable strategy/model evidence when their deterministic requirements pass.
- Current mechanics can become executable only after code verifies POI, direction, invalidation, targets, lifecycle and geometry.
- Specific labels may be CURRENT_FVG, CURRENT_OB, CURRENT_MSNR, CRT, TBS, MSNR, MSNR+CRT, TBS+MSNR or CRT+MSNR where production supports them.
- ICT is the umbrella methodology and is only a generic display fallback.

Do not turn the models into mutually exclusive generic pattern names. Confluence is evidence; repeated labels must not replace deterministic proof.

### CRT

The detector uses closed-candle range/manipulation/sweep/reclaim evidence. It records range high/low, manipulation side, sweep extreme, reclaim, direction and freshness. The execution zone is built around the reclaim level; invalidation uses the sweep extreme or range boundary. Its strategy-native objective may be CRT_OPPOSITE_RANGE and still must pass target lifecycle and RR.

### TBS / Turtle Soup

The detector finds an aged swing high/low, a sweep beyond that reference and a reclaim. Swept/reclaimed lows produce BUY evidence; swept/reclaimed highs produce SELL evidence. It records liquidity/reference level, sweep extreme, reclaim, event age and freshness. Targets come from the existing target/liquidity pool.

### MSNR

Structural MSNR levels derive from pivots/transitions with zone bounds, midpoint, direction, origin, break/retest provenance, mitigation/touch state, score and invalidation. Only structural MSNR evidence can back a standalone MSNR setup. Pivot-reference or ATR-fallback levels are not standalone MSNR trades.

### FVG, OB and current structure

FVG is a confirmed three-candle gap subject to the production gap threshold. OB uses an opposing candle followed by directional displacement and structural break. Current regeneration derives fresh FVG/OB/MSNR and other existing POIs from the same snapshot, then uses the existing adaptive candidate builder. A CURRENT_FVG label is a specific setup/location label; it does not replace PENDING_LIMIT.

A market-mechanics candidate becomes executable only after deterministic code proves its POI, direction, structural invalidation, genuine targets, lifecycle and geometry.

## Execution modes

### LIMIT / PENDING_LIMIT

A pending limit waits for price to reach a verified zone and may be away from current price. It does not require current zone occupancy, a reaction candle, current 5M/15M confirmation, or a killzone unless the selected model explicitly requires confirmation.

It does require a valid thesis, real POI, correct entry geometry, structural invalidation/SL, real unconsumed target, minimum RR, valid data/lifecycle and real risk/spread/news/account safety. Reachability/distance remains context and quality in the current system; it cannot create a zone or synthetic price.

### CONFIRMATION_ENTRY

A confirmation entry requires its defined location-specific confirmation, such as reclaim, MSS, CHoCH, BOS, displacement or rejection. Without that confirmation the state is WAITING_CONFIRMATION and execution is false. Do not turn every candidate into confirmation mode.

## Entry, stop and invalidation

AI references a supplied candidate. Code resolves entry from the verified zone/model, commonly a deterministic zone midpoint or model reclaim level, with symbol precision. Entry must belong to the POI geometry.

BUY invalidation is below the verified demand/POI/sweep extreme; SELL invalidation is above supply/POI/sweep extreme. Structural SL and any configured buffer must be on the correct side. ATR is context/sanity/buffer only where the implementation uses it; it is not an ATR-first stop and must not be moved to manufacture RR.

## Targets, lifecycle and RR

Targets are genuine structural/liquidity objectives: buy-side or sell-side liquidity, opposing structural zones/MSNR, supported FVG/OB/supply-demand objectives, swings, previous-period levels, CRT objectives, or other provenance-backed targets.

A target must be directionally beyond the deterministic entry, temporally valid and lifecycle-valid. The current lifecycle states are:

- UNFULFILLED: no later closed candle delivered through it;
- PARTIALLY_DELIVERED: touched but not crossed/completed by closed-candle delivery;
- CONSUMED: closed-candle delivery crossed/completed it;
- INVALIDATED: source/level is invalid;
- UNKNOWN: lifecycle cannot be proved.

Consumed, invalidated and unknown targets are not executable TP1. For a pending limit, current price being beyond a target does not alone prove pre-fill consumption; closed-candle lifecycle and entry/target timing are authoritative.

TP1 is the nearest appropriate genuine target that passes lifecycle, reachability and minimum RR. TP2/TP3 are farther genuine objectives when available. If no target passes, reject with the applicable production reason such as NO_VALID_TP1, NO_UNFULFILLED_TARGET, TARGETS_EXIST_BUT_RR_TOO_LOW, TARGETS_EXIST_BUT_UNREACHABLE or TARGET_PROVENANCE_INVALID.

RR is reward/risk from structural entry, structural stop and real TP1. Never use entry plus/minus risk times a multiplier to make a target.

## Confidence, warnings and hard rejection

Confidence is a quality score after structural validity. It uses production factors such as freshness, remaining reward, reachability, HTF alignment, strategy confluence, context, countertrend evidence and obstacles. It is not a probability guarantee and is not permission to invent an opportunity. A structurally valid pending limit may be medium quality. A high-confidence candidate still fails hard geometry/lifecycle/data/risk checks.

Hard rejection covers missing/corrupt data, unavailable evidence/POI, invalid direction/entry, invalidated or consumed entry/POI, invalid structural stop, missing/consumed/invalid/unknown target, insufficient RR, lifecycle/time inconsistency and genuine spread/news/account/risk blocks.

Quality warnings include timeframe disagreement, LTF isolation, low ADX/volatility, MACD disagreement, session quality, weak momentum, imperfect confluence, reachability quality and absent optional patterns. Warnings may lower confidence but are not structural proof.

## Candidate universe and AI contract

The deterministic engine creates historical and current regenerated candidates. Each has a stable ID, role, source evidence, zone, entry model, entry, structural invalidation, stop, target map, lifecycle, delivery/relevance, RR, rejection codes and warnings.

The compact AI package includes snapshot identity, current price, concise evidence for all five timeframes, directional context, phase evidence, every selectable candidate, relevant target IDs/types, and compact rejection counts. It omits raw candle arrays and full rejected candidate objects.

The AI may return market_phase, directional_thesis, thesis_status, original_thesis_status, preferred role, supplied candidate IDs, fallback IDs/role, fallback authorization, evidence/conflict IDs and qualitative reasoning. It must return only IDs in the package. Code resolves and reverifies them. Unknown IDs, role mismatch, absent evidence, bad geometry, stale lifecycle, invalid SL, consumed targets or bad RR reject the preference.

If AI is unavailable, the existing deterministic fallback may evaluate the complete merged selectable universe, with all hard rules unchanged.

## Final states

Use the most specific production state:

- PENDING_LIMIT: verified future limit and no hard block;
- WAITING_CONFIRMATION: valid confirmation model awaiting confirmation;
- WAIT: no coherent/verifiable opportunity or an explicit AI/non-trade path;
- RISK_BLOCKED: a valid setup blocked by a genuine risk/execution condition;
- INVALID: deterministic verification proves it invalid;
- DATA_UNAVAILABLE: required current data cannot be retrieved or validated.

A valid directional thesis may still end in WAIT because context is not an order.

## Anti-hallucination contract

Never invent market data, candles, timestamps, quotes, evidence, structures, POIs, CRT/TBS/MSNR, invalidations, stops, targets or RR. Never claim current analysis without successful current data. Never use stale data silently. Never resurrect consumed/expired/stale locations. Never manufacture a setup because a user requested a trade. If required data fails, return DATA_UNAVAILABLE. If data is valid but no candidate passes, return NO_TRADE. Separate retrieved facts, deterministic derivations and AI interpretation.

## Runtime workflow

1. Normalize the symbol.
2. Get the current TVKit quote.
3. Get time series for 1day, 4h, 1h, 15min and 5min with outputsize 200.
4. Keep only valid closed candles and form one snapshot.
5. Derive structure, direction evidence, phase evidence, POIs, target lifecycle and candidates.
6. Construct exact geometry only from verified structures.
7. Reject consumed/invalid/unknown/insufficient-RR candidates.
8. Compare the full valid universe and select one role/candidate.
9. Return the canonical opportunity or NO_TRADE/DATA_UNAVAILABLE.

## Output contract

Return JSON-compatible data with these fields where they can be proven:

- schema_version, symbol, provider, snapshot_id, market_data_as_of, current_price;
- direction;
- specific setup/model label;
- state and execution_mode;
- entry and entry_zone;
- structural_invalidation and stop_loss;
- TP1/TP2/TP3 only when genuine;
- risk_reward;
- market_phase and liquidity_draw;
- market narrative;
- per-timeframe evidence;
- supporting/conflicting evidence IDs;
- confidence and quality;
- quality_warnings and hard_rejections;
- invalidation condition and reason.

For WAIT, no trade geometry is invented. For DATA_UNAVAILABLE, identify the failed required data. A null TP2/TP3 means no genuine farther objective was proven.

## Current reachability parameter note

The current implementation records entry distance/ATR and reachability. Its general candidate constants include a 6 ATR maximum for non-pending-limit entry validation and a 3 ATR pending-later reachability reference. The pending-limit lifecycle path does not reject a structurally valid future limit only because it is not reachable in the current session; confirmation entries retain same-day reachability requirements. These are existing implementation details, not permission to invent or move a POI.


# Production-faithful implementation appendix

This appendix is part of the authoritative Ghost file. The separate openapi.yaml and README.md are reference artifacts only; an AI runtime needs this file plus a host HTTP/action tool.

## Host tool requirement

Markdown cannot make network requests. The host AI must be given an HTTP, OpenAPI, plugin, or action-capable tool that can call the documented Render routes. Attaching this file alone does not provide network access. The tool must be read-only for Ghost. It must not be given provider credentials, broker credentials, or an order endpoint.

## Exact Render/TVKit tool contract

The repository-proven Render server is:

    https://ict-telegram-bot-temf.onrender.com

Current read-only routes:

    GET /api/tvkit/quote?symbol=OANDA%3AXAUUSD
    GET /api/tvkit/time_series?symbol=OANDA%3AXAUUSD&interval=1h&outputsize=200

Quote request:
- method: GET;
- required query: symbol;
- allowed proxy symbol form: uppercase letters, digits, dot, underscore, colon, slash and hyphen, maximum 32 characters;
- user XAU/USD maps to OANDA:XAUUSD;
- response fields from the adapter: price, timestamp, symbol, provider;
- provider is TVKIT for the current adapter.

Time-series request:
- method: GET;
- required query: symbol and interval;
- optional outputsize defaults to 200;
- proxy accepts integer outputsize 20 through 5000;
- Ghost requests only: 1day, 4h, 1h, 15min and 5min;
- adapter response: values array and meta object;
- each value contains datetime, timestamp in Unix milliseconds, open, high, low, close, volume when available, and is_closed;
- adapter metadata includes provider, provider_symbol, interval, timezone and raw_count.

The proxy route currently validates compatibility intervals 1min and 1week as well. They are outside this Ghost trading workflow and must never be requested for semantic analysis.

Route/data errors:
- 400: invalid symbol, interval or outputsize;
- 429: proxy request budget exceeded;
- 502: TVKit/provider failure;
- 503: TVKit is not configured.
Any required route failure or unvalidated response is DATA_UNAVAILABLE. There is no Ghost broker/order endpoint.

## Exact market-data and snapshot behavior

The production client uses getMarketDataProvider() with TVKIT as the current default and maps each semantic timeframe with:

    1M -> 1min
    5M -> 5min
    15M -> 15min
    1H -> 1h
    4H -> 4h
    1D -> 1day

The Ghost semantic set is exactly 1D, 4H, 1H, 15M and 5M.

getRequiredHistoryOutputSize() returns the maximum of 200, the MSNR lookback, the TBS lookback, the CRT reference lookback and 60. Current values therefore request 200 bars.

Current browser cache lifetimes are quote 5 seconds; 5M and 15M 60 seconds; 1H 120 seconds; 4H 300 seconds; 1D 900 seconds. These are cache freshness aids, not permission to call old cached data live when it fails the quality check.

fetchHistoryUncached() converts provider bars to t/o/h/l/c/v. Intraday closure is timestamp plus interval duration less than or equal to the current time. Period-bucket closure uses a newer bucket or elapsed duration; the Ghost scan does not request the weekly period. Forming bars are removed. Values are reversed into ascending time order after validation.

validateMarketDataQuality() checks required timeframe availability, minimum closed history, finite current price, finite OHLC, timestamp ordering, duplicates, impossible high/low geometry, stale/future times and quote/data consistency. A data-quality failure blocks planning rather than being filled with invented values.

The canonical live context includes snapshot_id, as-of milliseconds/UTC, provider, quote snapshot, history cache, structure, timeframe context, daily bias, zones, target candidates, strategy setups, risk constraints and deterministic validation context. Candidate generation, compact AI context, AI ID resolution and final verification must use that same snapshot.

## Exact deterministic constants

The production STRATEGY_SPEC_VERSION is 1.0.0. Current STRATEGY_SPEC values are:

TIME:
- futureToleranceMs = 120000;
- candleMatchToleranceMs = 300000.

LIFECYCLE:
- maxEntryTouches = 0;
- minRemainingRewardFraction = 0.50;
- maxMSNREventAgeBars = 8.

FRESHNESS:
- max15mEventAgeHours = 12;
- max1hEventAgeHours = 30;
- max4hEventAgeHours = 72;
- maxPendingDistanceAtr = 3;
- minRemainingRewardFraction = 0.50;
- normalRemainingRewardFraction = 0.70;
- pendingLaterDistanceAtr = 3;
- lowEntryReachabilityScore = 40;
- mediumEntryReachabilityScore = 70.

CONFIDENCE:
- baseScore = 50;
- freshEvent = +8;
- normalReward = +8;
- partialReward = -10;
- entryDistanceWeight = 0.16;
- targetReachabilityWeight = 0.12;
- htfAlignment = 4 per alignment unit;
- confluence = 5 per unique executable component;
- countertrendPenalty = -8;
- seriousObstaclePenalty = -10;
- highQualityMinimum = 70;
- alignedPendingLimitMinimum = 65;
- mediumQualityMinimum = 55.

CRT:
- referenceLookback = 18 bars;
- eventLookahead = 10 bars;
- minReferenceAtr = 0.35;
- maxEventAgeBars = 8;
- minSweepAtr = 0.04;
- dedupeAtr = 0.2;
- maximum events per timeframe = 8.

TBS:
- lookback = 80 bars;
- referenceMinAgeBars = 4;
- maxEventAgeBars = 8;
- minSweepAtr = 0.04;
- minSweepPips = 2;
- dedupeAtr = 0.2;
- maximum events per timeframe = 8.

MSNR:
- lookback = 120 bars;
- maxMitigationCount = 2;
- breakCloseBufferAtr = 0.03;
- retestToleranceAtr = 0.15;
- zoneAtrWidth = 0.08;
- minStructuralScore = 35;
- maximum levels per timeframe = 12.

COMBINATION:
- minScore = 60;
- sameTfBars = 20;
- crossTfHours = 18;
- maximum setups = 24.

EXECUTION:
- maxStopsPerZone = 8;
- maxTargetsPerEvaluation = 20;
- maxFreshFVGZones = 5;
- maxFreshOBZones = 5;
- maxFreshMSNRZones = 5;
- maxFreshExecutionZones = 8;
- maxFreshExecutionSetups = 24.

TARGET:
- maxAtrDistance = 12;
- firstObjectiveBonus = 14;
- seriousObstaclePenalty = 22;
- weakObstaclePenalty = 7.

Global legacy/immediate constants still present in script.js:
- MIN_CONFIDENCE = 58;
- LIMIT_ORDER_MAX_DIST_ATR = 6.0.

The canonical pending-limit candidate path treats confidence as quality after validity. The older immediate execution helper can return skip below MIN_CONFIDENCE, and non-pending entry distance can be a hard quality/validation issue. A pending future limit is not rejected merely because current price is outside its zone or because same-day reachability is low. Do not erase these existing distinctions or reinterpret the legacy helper as permission to manufacture a trade.

## Market settings and minimum RR

getMarketSettings() supplies precision, tick/pip size, stop buffer, minimum stop distance, maximum stop percentage, targetRR and a minimum stop ATR multiplier. Metadata overrides are accepted when valid.

Defaults currently include:
- METAL: precision 2, pip/tick 0.1, stop buffer 3, minimum stop distance 3, maximum stop percentage 0.015, targetRR 2.5, minimum stop ATR multiplier 2.0;
- JPY forex: precision 3, pip/tick 0.01, stop buffer 0.15, minimum stop distance 0.10, maximum stop percentage 0.01, targetRR 2.5;
- crypto: precision 8, targetRR 2.5;
- equity/index: precision 4, targetRR 2.5;
- ordinary forex: precision 5, pip/tick 0.0001, stop buffer 0.0005, minimum stop distance 0.0003, maximum stop percentage 0.01, targetRR 2.5.

Supplied symbol metadata can override these values. The effective minimum RR is risk_constraints.minimum_rr, then symbol settings targetRR, then 2.5.

RR is:

    risk = abs(entry - stop_loss)
    reward = abs(tp1 - entry)
    actual_rr = reward / risk

Target selection first requires a genuine target at or beyond risk times minimum RR. It does not create a target to meet that threshold.

## Exact structure algorithms

All structure helpers call closedStructureCandles() first. A candle is closed only when it is not marked is_closed=false, closed=false, is_forming=true or forming=true.

findSwings(data, lb):
- default lb is 3 in structure snapshots and target construction; some event detectors use lb 2;
- a high is a swing high when its high is greater than each of lb candles on both sides;
- a low is a swing low when its low is less than each of lb candles on both sides;
- returned values retain price and index.

analyzeMarketStructure():
- requires at least 20 closed candles;
- uses swing lb 2;
- compares the last two of the last four highs and lows;
- rising highs produce HH, falling highs LH;
- falling lows produce LL, rising lows HL.

detectBOS(data, direction):
- requires at least 20 closed candles;
- uses the last 20 bars;
- BUY is true when the latest close is above the maximum high in the first 15 of those bars;
- SELL is true when the latest close is below the minimum low in the first 15.

detectMSS(data):
- requires at least 21 closed candles;
- compares the latest close with the maximum high and minimum low of the prior 20 bars;
- above prior high returns BULL; below prior low returns BEAR.

detectCHoCH(data, direction):
- requires at least 15 closed candles;
- finds swings with lb 3 on all but the latest candle;
- BUY requires one of the last five candles to sweep below the minimum of the last three swing lows, the latest close to reclaim that low, and the latest close to break above the maximum recent swing high;
- SELL is the symmetric high sweep/reclaim and low break.

getDirectionBias(data):
- requires at least 40 closed candles;
- if at least 50 closes exist, EMA20 above EMA50 adds 2 and below subtracts 2;
- a latest close breaking the prior 29-bar high/low adds or subtracts 2;
- otherwise position above 60 percent of that range adds 1 and below 40 percent subtracts 1;
- a latest candle body greater than 60 percent of its range adds/subtracts 1 by candle direction;
- score at least 2 is BULLISH, at most -2 BEARISH, otherwise NEUTRAL.

detectDisplacement(data, direction):
- requires at least 10 closed candles;
- compares the latest directional body with the average body of the last 10;
- true when body is at least 2.5 times average body and candle direction agrees.

detectLiquiditySweep(data, price, direction):
- requires at least 26 closed candles;
- excludes the latest six bars from swing reference data;
- finds lb-2 swings and examines the last four relevant highs/lows;
- BUY requires a recent low below a swing low followed by a close above it;
- SELL requires a recent high above a swing high followed by a close below it.

detectLiquidityPools():
- requires at least 15 candles;
- compares the last 15 highs/lows and records equal high/low pools according to the production tolerance.

buildStructureSnapshot():
- returns INSUFFICIENT and NEUTRAL fields when fewer than 20 candles exist;
- calculates structural trend from the last two lb-3 highs/lows: rising both BULLISH, falling both BEARISH, otherwise MIXED/NEUTRAL;
- calculates momentum trend using the production trend helper;
- combines structural trend, HH/HL or LH/LL sequence, momentum, direction bias, MSS/BOS/CHoCH into effective_trend;
- reports structure_state CONFIRMED, CONFLICTING, TRANSITION or INSUFFICIENT;
- includes MSS, BOS buy/sell, CHoCH buy/sell and recent swing records.

## Exact FVG and OB algorithms

detectFVG():
- uses closed candles;
- examines each three-candle sequence;
- bullish FVG when previous high is below next low and the gap exceeds max(pip size, ATR times 0.02, current close times 0.00005);
- bearish FVG when previous low is above next high with the same threshold;
- records bounds, midpoint and confirmed source index.

detectOrderBlocks():
- BUY OB: current candle is bearish, next candle bullish, and next high exceeds current high; zone is current candle high/low;
- SELL OB: current candle is bullish, next candle bearish, and next low is below current low; zone is current candle high/low;
- the next directional displacement is the confirmation.

buildLiveZonesForTf():
- uses existing real-zone builders for BUY and SELL;
- rounds bounds using symbol precision;
- records primary eligibility, direction, timeframe, price-at-zone, distance, distance in ATR, created index/time, freshness, touch count, invalidation and violations;
- keeps the nearest bounded zones per direction for each construction pass.

## Exact CRT, TBS and MSNR algorithms

CRT:
- requires at least 20 valid closed candles;
- scans the last referenceLookback plus eventLookahead window;
- reference range must be positive and at least 0.35 ATR when ATR is available;
- sweep threshold is max(two pip sizes, ATR times 0.04);
- BUY event: candle low below reference low minus threshold, then a close above reference low;
- SELL event: candle high above reference high plus threshold, then a close below reference high;
- reclaim must occur within the bounded lookahead;
- event freshness uses maxEventAgeBars 8;
- invalidated/expired events are not executable;
- invalidation is sweep extreme;
- primary objective is the opposite range boundary;
- event records include SWEEP_RECLAIM state, range, sweep, reclaim and target provenance;
- narrative deduplication and an eight-event bound apply.

TBS:
- requires at least 20 valid closed candles;
- scans up to 80 bars and uses lb-2 swings;
- reference swing must be at least four bars old;
- BUY sweeps a reference low by max(pip size times 2, ATR times 0.04) and reclaims above it;
- SELL sweeps a reference high by the same threshold and reclaims below it;
- reclaim is searched for up to five candles after the sweep;
- event freshness expires after eight bars;
- invalidated/expired events do not create executable setups;
- structural invalidation is the sweep extreme;
- the target bias is opposite-side liquidity;
- narrative deduplication and an eight-event bound apply.

MSNR:
- calculates pivot references plus structural levels over a 120-bar lookback;
- structural zone width uses max(pip size times 2, ATR times 0.08, current price times 0.00002);
- break close buffer uses max(pip size, ATR times 0.03);
- retest tolerance uses ATR times 0.15;
- max mitigation count is 2;
- structural score must reach 35 unless the level is a qualified flip/retest;
- fresh/tested/mitigated/invalidated state is derived from touches and invalidation;
- structural levels are bounded to 12 per timeframe;
- PIVOT_REFERENCE and ATR_FALLBACK levels are context only, not standalone MSNR strategy evidence.

## Target catalog and lifecycle algorithm

buildTargetCandidates() creates and deduplicates candidates from:
- previous closed daily high/low;
- opposing structural MSNR levels on 4H/1H;
- mapped above/below liquidity;
- recent swing highs/lows;
- opposing FVG midpoints;
- opposing OB midpoints.

It keeps provenance, source timeframe/index, structural priority, direction, ahead-of-price state and lifecycle-required metadata. The all-target catalog is capped at 60; directional buy/sell views are capped at 10.

selectAdaptiveTargets():
1. uses only finite, provenance-valid sources; ATR_FALLBACK, PIVOT_REFERENCE and PIVOT_DERIVED are excluded;
2. deduplicates by direction, timeframe and rounded level while retaining target confluence;
3. keeps targets beyond the entry in the trade direction;
4. for pending limits, it evaluates the future entry, so the target need not be beyond the current quote;
5. assesses lifecycle with source time and later closed candles;
6. calculates reachability and structural obstacles;
7. removes CONSUMED, INVALIDATED and UNKNOWN targets;
8. requires the target to meet the effective minimum RR and not be hard-unreachable;
9. sorts valid targets by distance from entry, then strategy-native status, structural priority and reachability;
10. selects TP1 and then up to two farther genuine levels for TP2/TP3.

assessTargetLifecycle() compares the target source candle/time with later closed candles:
- a later candle crossing/delivering through the level marks CONSUMED;
- a touch without closed delivery through it can remain PARTIALLY_DELIVERED;
- no later delivery is UNFULFILLED;
- unresolved source timing is UNKNOWN;
- invalidated source/structure is INVALIDATED.

A pending setup with an UNFULFILLED or PARTIALLY_DELIVERED target preserves full remaining reward at the future fill. Current price alone does not consume a pending target.

## Exact candidate construction and regeneration

buildLiveMarketContext():
1. validates quote/history quality;
2. builds structure snapshots for the five semantic timeframes;
3. builds 4H/1H zones and target catalog;
4. builds liquidity, sweeps, dealing range, premium/discount, volatility and momentum facts;
5. builds market mechanics and executable CRT/TBS/MSNR strategy narratives;
6. builds the historical adaptive candidate result;
7. runs buildCurrentOpportunityRegenerationSetups() over the same snapshot;
8. sends regenerated setup structures through the same buildAdaptiveSetupCandidates() builder;
9. merges historical and regenerated results;
10. extends deterministic validation context with all strategy setups and zones;
11. assigns candidate role and current-opportunity relevance;
12. ranks valid candidates and exposes selectable candidates to AI/fallback.

Current regeneration does not revive rejected records. It derives fresh 4H/1H/15M current zones, including FVG/OB/MSNR and supported current POIs, then constructs new stable IDs and sends them through normal stop, target, lifecycle, RR and invariant checks. A fresh candidate can be FRESH_CONTINUATION_POI or FRESH_RETRACEMENT_POI; matching direction alone does not make it ORIGINAL_THESIS_POI.

Each candidate carries:
- candidate ID and source IDs;
- role and current-opportunity source;
- direction, strategy label/family and confluence;
- setup and execution timeframes;
- execution model/entry model;
- zone bounds and midpoint;
- formation/event time and age;
- freshness/mitigation/entry-consumed state;
- structural invalidation;
- exact entry and structural stop;
- target map and lifecycle records;
- actual RR and minimum RR;
- delivery fraction and remaining reward;
- current-opportunity relevance;
- deterministic validity, hard rejection codes and quality warnings.

## Exact lifecycle and candidate validity sequence

evaluateSetupLifecycle() checks:
- event and zone timestamps are not in the future beyond the 2-minute tolerance;
- event age against timeframe freshness limits;
- zone/event index and source data existence;
- entry touches after the event; maxEntryTouches is zero;
- target completion/delivery;
- timestamp consistency;
- market-open state;
- pending-limit versus confirmation-entry semantics;
- whether a candidate is FRESH_NOW, FRESH_PENDING_TODAY, FRESH_PENDING_LATER, COMPLETED, CONSUMED, EXPIRED, DELIVERY_ADVANCED or INVALID.

A pending limit can be prepared while the venue is closed or the zone is not currently occupied; it remains subject to the final execution/risk state. A confirmation entry keeps same-day and confirmation conditions.

validateExecutableCandidateInvariant() then checks:
- executable strategy or AI-verified market-mechanics backing;
- top-down classification consistency;
- LTF isolation for confirmation models;
- reversal models require CONFIRMATION_ENTRY;
- finite entry, stop and TP1;
- BUY stop below entry and TP1 above entry;
- SELL stop above entry and TP1 below entry;
- stop outside the authoritative structural invalidation;
- event/zone time consistency;
- target lifecycle and remaining reward;
- actual RR against the effective minimum;
- hard target, data and geometry invariants.

Hard failures are retained with their production rejection codes. Quality warnings do not become hidden hard gates.

## Exact market phase and selection sequence

The compact package contains all selectable candidates, five-timeframe evidence, phase evidence, relevant targets, rejection summaries and snapshot identity. The AI can return:

- decision;
- market_phase;
- directional_thesis;
- thesis_status;
- original_thesis_status;
- preferred_opportunity_role;
- preferred_candidate_ids;
- fallback_candidate_ids;
- fallback_opportunity_role;
- fallback_allowed;
- wait_if_preferred_candidates_fail;
- phase_evidence_ids;
- conflicting_evidence_ids;
- reasoning.

resolvePhaseAwareCandidateSelection():
1. normalizes the AI response;
2. resolves phase/conflict evidence IDs against the canonical snapshot;
3. resolves candidate IDs against adaptive_setup_candidates;
4. rejects unknown IDs as AI_CANDIDATE_REFERENCE_NOT_FOUND;
5. rejects role conflicts as ROLE_MISMATCH or AI_SELECTED_ROLE_MISMATCH;
6. re-verifies every preferred candidate with validateExecutableCandidateInvariant();
7. selects the first valid preferred candidate;
8. if no preferred candidate survives, uses fallback only when fallback_allowed is true and the fallback role/IDs are supplied;
9. re-verifies fallback candidates using the same hard rules;
10. otherwise returns NO_VALID_CANDIDATE/WAIT.

The code never combines candidate A reasoning with candidate B geometry. If the AI is unavailable, deterministic fallback evaluates the complete merged selectable universe. If the AI explicitly returns WAIT, the public state remains WAIT with an AI-selected reason unless the existing preservation path has a valid complete deterministic candidate under its current policy.

## Exact confidence semantics

calculateCandidateConfidence() starts at 50 and adds/subtracts:
- fresh actionable event +8;
- remaining reward at least 0.70 +8;
- reward between configured partial and normal levels -10;
- entry reachability adjustment (score minus 50) times 0.16;
- target reachability adjustment (score minus 50) times 0.12;
- top-down alignment times 4;
- unique strategy confirmations/confluence times 5;
- top-down continuation alignment bonus +8 when alignment is 3;
- countertrend context -8;
- serious target obstacles -10 each.

The score is bounded from 0 through 95 and receives HIGH, MEDIUM or LOW according to the candidate's configured execution minimum and medium minimum 55. This is descriptive quality after the candidate has passed structural checks; it is not a probability and must not invent geometry.

## Exact final public separation

Keep these dimensions separate:

- methodology: ICT;
- specific setup label: CRT, TBS, MSNR, MSNR+CRT, CURRENT_FVG, CURRENT_OB, etc.;
- order type: LIMIT;
- execution/setup state: PENDING_LIMIT or WAITING_CONFIRMATION;
- candidate role: ORIGINAL_THESIS_POI, FRESH_RETRACEMENT_POI, FRESH_CONTINUATION_POI or CONFIRMATION_POI;
- direction: BUY or SELL;
- deterministic prices: entry, structural SL, TP1/TP2/TP3;
- quality: confidence and quality band;
- status/reason: PENDING_LIMIT, WAITING_CONFIRMATION, WAIT, RISK_BLOCKED, INVALID or DATA_UNAVAILABLE.

The displayed Type must use the specific selected setup label before generic ICT. A CURRENT_FVG pending limit therefore remains methodology ICT, specific Type CURRENT_FVG, order LIMIT, state PENDING_LIMIT and role FRESH_RETRACEMENT_POI.

## Standalone decision checklist

Before publishing BUY or SELL, prove:
- all five required timeframe histories are current, normalized and closed;
- quote and histories share one snapshot;
- direction is supported by evidence;
- POI exists in that snapshot;
- candidate role and source are known;
- entry belongs to the POI;
- structural invalidation and stop are valid;
- TP1 is a real, directionally correct, lifecycle-valid objective;
- TP1 passes minimum RR and reachability;
- any TP2/TP3 is independently genuine;
- lifecycle is valid;
- pending/confirmation semantics are respected;
- spread/news/account/risk controls pass;
- confidence is treated as quality, not proof.

If any hard fact cannot be proven, do not fill the gap with AI confidence. Return the most accurate WAIT/INVALID/RISK_BLOCKED/DATA_UNAVAILABLE state.



## Additional exact freshness, liquidity and stop rules

detectLiquidityPools() requires 15 closed candles and examines the last 15 highs and lows. Two highs are equal when their relative difference is below 0.0008; equal lows use the same threshold. Compression is true when the last five average ranges are below 90 percent of the prior five-bar average and every recent range is below 110 percent of that prior average.

checkZoneFreshness() starts after the exact zone creation timestamp/index, not across arbitrary older candles. A close inside the zone counts as a touch and engages the zone. After engagement:
- BUY violation is a close below zone low;
- SELL violation is a close above zone high.
Fresh means touches at most 2 and zero violations. Partially used means touches at most 5 and at most 1 violation. Used means more than 5 touches or more than 1 violation. Candidate-specific lifecycle and structural invalidation can apply additional rejection.

getAuthoritativeStructuralInvalidation() chooses execution_structural_invalidation for a pending execution model when present, then strategy invalidation detail, then model-specific anchors:
- TBS uses sweep extreme;
- CRT uses sweep extreme;
- MSNR uses MSNR zone invalidation.
The invalidation level remains the authoritative reference even when a stop receives a normal-noise buffer.

getAdaptiveStopCandidates() keeps the authoritative invalidation anchor and calculates a buffer from pip/tick, half-spread and 5 percent ATR noise, with a minimum price-based pad. The stop uses the larger of anchor risk and the preferred volatility distance, then rounds to precision. The stop is not moved to create a target or improve RR.

evaluateStructuralStop() rejects:
- non-finite entry/stop;
- wrong-side BUY/SELL stop;
- stop inside the authoritative invalidation;
- risk distance at or below the absolute minimum;
- risk distance above the setup-timeframe maximum reasonable distance.
A valid result is VALID_STRUCTURAL_STOP. TIGHT_BUT_STRUCTURAL and WIDE_BUT_STRUCTURAL are classifications/warnings when the geometry remains structurally valid; EXTREME_TOO_TIGHT and EXTREME_TOO_WIDE are hard failures.

Risk constraints also expose minimum stop distance, preferred stop distance, maximum stop distance, current/maximum spread and optional slippage limits. A known excessive spread, configured slippage failure, news block, account loss protection, active-order/exposure limit, or trade-gap rule is a genuine execution/risk block, not a quality warning.

