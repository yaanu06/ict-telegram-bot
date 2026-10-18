'use strict';

/*
 * Deterministic V2 qualification research layer.
 *
 * This module deliberately does not create a second trade engine.  It
 * evaluates an already-existing V2 opportunity against a chronological
 * storyline.  The replay can therefore compare the current selector with
 * progressively stricter interpretations without changing the V2 detector,
 * scoring, target, or simulator semantics.
 */

const { build4HStateHistory, getActive4HState } = require('./market-state');
const { buildExecutionPrimitives } = require('./execution-structure');

const MODES = Object.freeze([
    'CURRENT_V2',
    'STRICT_CRT',
    'CRT_TBS',
    'CRT_TBS_MSNR',
    'CRT_TBS_MSNR_FRESH',
    'FULL_INTEGRATED'
]);

const TF_MS = Object.freeze({
    '5M': 300000,
    '15M': 900000,
    '1H': 3600000,
    '4H': 14400000,
    '1D': 86400000
});

function upper(value) { return String(value || '').toUpperCase(); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function directionOf(value) { const direction = upper(value?.direction || value); return ['BUY', 'SELL'].includes(direction) ? direction : null; }
function timeOf(value) {
    const explicit = finite(value?.first_knowable_ms ?? value?.firstKnowableMs);
    if (explicit != null) return explicit;
    for (const candidate of [value?.first_knowable_time, value?.confirmation_time, value?.event_time, value?.reclaim_time, value?.sweep_time, value?.created_time]) {
        const parsed = Date.parse(candidate || '');
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}
function candleTime(candle, timeframe) {
    const start = finite(candle?.t ?? candle?.timestamp);
    const close = finite(candle?.close_time_ms ?? candle?.close_time);
    return close ?? (start == null ? null : start + TF_MS[upper(timeframe)]);
}
function closedVisible(block, asOfMs) {
    const timeframe = upper(block?.timeframe);
    return (block?.candles || [])
        .filter(candle => candle && candle.is_closed !== false && candle.forming !== true && candle.closed !== false)
        .filter(candle => {
            const close = candleTime(candle, timeframe);
            return close != null && close <= asOfMs;
        })
        .map(candle => ({ ...candle, close_time_ms: candleTime(candle, timeframe) }));
}
function barsFor(blocks, timeframe, asOfMs) {
    const block = (blocks || []).find(item => upper(item.timeframe) === upper(timeframe));
    return closedVisible(block, asOfMs);
}
function chronology(events, asOfMs, direction) {
    return (events || []).filter(event => directionOf(event) === direction && (timeOf(event) ?? Infinity) <= asOfMs)
        .sort((left, right) => (timeOf(left) || 0) - (timeOf(right) || 0));
}
function eventRef(event) {
    return event?.id || event?.ref || event?.structure_event_id || event?.sweep_id || event?.impulse_id || null;
}
function latest(events) { return events.length ? events[events.length - 1] : null; }

function localDateParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).formatToParts(new Date(timestamp));
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { hour: Number(map.hour), minute: Number(map.minute), weekday: map.weekday };
}

function sessionContext(asOfMs, candles = []) {
    const timestamp = finite(asOfMs);
    if (timestamp == null) return { session: 'OTHER', killzone_active: false, session_open_distance: null, session_high: null, session_low: null };
    const london = localDateParts(timestamp, 'Europe/London');
    const newYork = localDateParts(timestamp, 'America/New_York');
    const hour = london.hour + london.minute / 60;
    const nyHour = newYork.hour + newYork.minute / 60;
    let session = 'OTHER';
    if (hour >= 0 && hour < 8) session = 'ASIA';
    if (hour >= 8 && hour < 13) session = 'LONDON';
    if (nyHour >= 8 && nyHour < 17) session = session === 'LONDON' ? 'LONDON_NEW_YORK_OVERLAP' : 'NEW_YORK';
    const killzoneActive = (hour >= 7 && hour < 10) || (nyHour >= 8.5 && nyHour < 11) || (nyHour >= 13.5 && nyHour < 16);
    const dayStart = new Date(timestamp);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayBars = candles.filter(candle => finite(candle.t ?? candle.timestamp) >= dayStart.getTime() && candleTime(candle, '5M') <= timestamp);
    const highs = dayBars.map(candle => finite(candle.h)).filter(Number.isFinite);
    const lows = dayBars.map(candle => finite(candle.l)).filter(Number.isFinite);
    return {
        session,
        killzone_active: killzoneActive,
        session_open_distance: null,
        session_high: highs.length ? Math.max(...highs) : null,
        session_low: lows.length ? Math.min(...lows) : null,
        london_local_hour: hour,
        new_york_local_hour: nyHour
    };
}

function makeCounters() {
    return {
        replay_points: 0,
        htf_storyline: 0,
        valid_location: 0,
        msnr_interaction: 0,
        crt_formed: 0,
        liquidity_swept: 0,
        tbs_reclaimed: 0,
        direction_confirmed: 0,
        displacement_structure: 0,
        fresh_entry_zone: 0,
        first_retracement: 0,
        execution_5m_confirmation: 0,
        path_valid: 0,
        selected: 0,
        filled: 0,
        outcomes: {},
        rejection_reasons: {}
    };
}

function increment(counter, name) {
    counter[name] = (counter[name] || 0) + 1;
}

function blockKey(block, candles) {
    const last = candles.at(-1);
    return `${upper(block?.timeframe)}:${candles.length}:${last?.t ?? ''}:${last?.close_time_ms ?? ''}`;
}

function makeIndex({ context, blocks, symbol, asOfMs, stateHistory, symbolMetadata = {}, mode = 'CURRENT_V2', cache = null } = {}) {
    const directionStates = {};
    const primitives = {};
    const primitiveTimeframes = mode === 'FULL_INTEGRATED' ? ['1H', '15M'] : [];
    for (const tf of primitiveTimeframes) {
        const candles = barsFor(blocks, tf, asOfMs);
        if (candles.length < 20) {
            primitives[tf] = { structures: [], displacements: [], sweeps: [], sequences: [], retracements: [] };
            continue;
        }
        const key = `${symbol}|${blockKey({ timeframe: tf }, candles)}`;
        primitives[tf] = cache?.primitives?.get(key) || buildExecutionPrimitives({ context, candles, timeframe: tf, symbol, pair: symbol, symbolMetadata });
        if (cache?.primitives && !cache.primitives.has(key)) cache.primitives.set(key, primitives[tf]);
    }
    const candidates = {};
    for (const tf of ['1H', '15M']) {
        const candles = barsFor(blocks, tf, asOfMs);
        if (candles.length < 20) {
            candidates[tf] = { crt: [], tbs: [], msnr: [] };
            continue;
        }
        const key = `${symbol}|${blockKey({ timeframe: tf }, candles)}`;
        const cached = cache?.candidates?.get(key);
        if (cached) { candidates[tf] = cached; continue; }
        const crt = typeof context.detectCRTEvents === 'function' ? context.detectCRTEvents(candles, tf, symbol, symbolMetadata) : [];
        const tbs = typeof context.detectTurtleSoupEvents === 'function' ? context.detectTurtleSoupEvents(candles, tf, symbol, symbolMetadata) : [];
        const currentPrice = finite(candles.at(-1)?.c);
        const msnr = typeof context.calculateMSNR === 'function' ? context.calculateMSNR(candles, currentPrice, tf, symbol, symbolMetadata).structural_levels || [] : [];
        candidates[tf] = { crt, tbs, msnr };
        if (cache?.candidates) cache.candidates.set(key, candidates[tf]);
    }
    const activeState = stateHistory ? getActive4HState(stateHistory, asOfMs) : null;
    directionStates.active = activeState;
    return { primitives, candidates, directionStates, session: sessionContext(asOfMs, barsFor(blocks, '5M', asOfMs)) };
}

function candidateZone(candidate) {
    const low = finite(candidate?.fvg_zone_low);
    const high = finite(candidate?.fvg_zone_high);
    if (low == null || high == null) return null;
    return { low: Math.min(low, high), high: Math.max(low, high), midpoint: finite(candidate.entry) ?? (low + high) / 2 };
}
function inZonePrice(zone, price) { return zone && price != null && price >= zone.low && price <= zone.high; }
function overlapping(a, b) { return a && b && a.high >= b.low && a.low <= b.high; }
function matchingLocation(index, direction, zone, asOfMs) {
    const levels = ['1H', '15M'].flatMap(tf => index.candidates[tf]?.msnr || [])
        .filter(level => directionOf(level) === direction && level.invalidated !== true && (timeOf(level) ?? Infinity) <= asOfMs)
        .filter(level => ['FRESH', 'TESTED'].includes(upper(level.freshness)) && overlapping(zone, { low: finite(level.zone_low), high: finite(level.zone_high) }))
        .sort((a, b) => (a.mitigation_count || 0) - (b.mitigation_count || 0) || (timeOf(b) || 0) - (timeOf(a) || 0));
    return levels[0] || null;
}
function matchingCrt(index, direction, asOfMs) {
    return latest(['1H', '15M'].flatMap(tf => chronology(index.candidates[tf]?.crt || [], asOfMs, direction)));
}
function matchingTbs(index, direction, asOfMs, crt) {
    const events = ['1H', '15M'].flatMap(tf => chronology(index.candidates[tf]?.tbs || [], asOfMs, direction));
    return latest(events.filter(event => !crt || Math.abs(Number(event.reclaim_level) - Number(crt.reclaim_level)) < Math.max(Math.abs(Number(crt.range_size)) * 0.35, 1e-12)));
}
function latestAligned1H(index, direction, asOfMs) {
    const structures = chronology(index.primitives['1H']?.structures || [], asOfMs, direction);
    const displacements = chronology(index.primitives['1H']?.displacements || [], asOfMs, direction);
    return latest(structures.filter(structure => structure.type === 'BOS' || displacements.some(item => item.index >= structure.index && item.index <= structure.index + 4))) || latest(displacements);
}
function linked15mSequence(index, direction, asOfMs, zone) {
    const sequences = (index.primitives['15M']?.sequences || [])
        .filter(sequence => sequence.direction === direction && sequence.structure_event?.type === 'BOS' && (sequence.first_knowable_ms ?? Infinity) <= asOfMs)
        .filter(sequence => {
            const sequenceZone = sequence.refined_zone || { low: sequence.ob.zone_low, high: sequence.ob.zone_high };
            return overlapping(zone, sequenceZone);
        })
        .sort((a, b) => (b.first_knowable_ms || 0) - (a.first_knowable_ms || 0));
    return sequences[0] || null;
}
function local5mConfirmation(candidate) {
    const value = upper(candidate?.execution_5m || candidate?.execution5m || candidate?.execution_confirmation);
    return value === 'CONFIRMED' || value === 'READY' || value === 'YES'
        ? { ref: candidate?.execution_5m_ref || null, type: value }
        : null;
}

function evaluateCandidate({ candidate, blocks, context, symbol, asOfMs, stateHistory, mode = 'CURRENT_V2', symbolMetadata = {}, index = null } = {}) {
    const counters = makeCounters();
    const direction = directionOf(candidate?.side);
    const zone = candidateZone(candidate);
    const activeState = index?.directionStates?.active || null;
    const result = {
        mode,
        qualified: mode === 'CURRENT_V2',
        rejection_reason: null,
        blockers: [],
        htf_storyline: activeState ? 'PRESENT' : 'NONE',
        htf_state_id: activeState?.state_id || null,
        htf_direction: activeState?.direction || null,
        msnr_state: null,
        crt_state: null,
        tbs_state: null,
        liquidity_event: null,
        direction_confirmation: null,
        displacement_ref: null,
        bos_ref: null,
        entry_zone_state: candidate?.fvg_status || null,
        first_retrace: upper(candidate?.fvg_status) === 'UNTOUCHED',
        session: index?.session || null,
        clear_path: candidate?.clear_path_to_tp1 || 'YES',
        evidence_refs: []
    };
    if (mode === 'CURRENT_V2') return result;
    const fail = reason => { result.qualified = false; result.rejection_reason = result.rejection_reason || reason; result.blockers.push(reason); };
    if (!activeState) fail('NO_HTF_STORYLINE');
    else if (activeState.direction !== direction) fail('HTF_DIRECTION_CONFLICT');
    else increment(counters, 'htf_storyline');
    if (!zone) fail('NO_ENTRY_ZONE');
    const crt = matchingCrt(index, direction, asOfMs);
    if (crt) { result.crt_state = 'CONFIRMED'; result.evidence_refs.push(eventRef(crt)); increment(counters, 'crt_formed'); }
    const tbs = matchingTbs(index, direction, asOfMs, crt);
    if (tbs) { result.tbs_state = 'CONFIRMED'; result.liquidity_event = eventRef(tbs); result.evidence_refs.push(eventRef(tbs)); increment(counters, 'tbs_reclaimed'); }
    if (mode === 'STRICT_CRT' && !crt) fail('CRT_NOT_CONFIRMED');
    if (mode === 'CRT_TBS' && (!crt || !tbs)) fail(!crt ? 'CRT_NOT_CONFIRMED' : 'TBS_NOT_RECLAIMED');
    if (['CRT_TBS_MSNR', 'CRT_TBS_MSNR_FRESH'].includes(mode) && (!crt || !tbs)) fail(!crt ? 'CRT_NOT_CONFIRMED' : 'TBS_NOT_RECLAIMED');
    const location = matchingLocation(index, direction, zone, asOfMs);
    if (location) { result.msnr_state = upper(location.freshness); result.evidence_refs.push(eventRef(location)); increment(counters, 'msnr_interaction'); }
    if (['CRT_TBS_MSNR', 'CRT_TBS_MSNR_FRESH'].includes(mode) && !location) fail('NO_VALID_MSNR_LOCATION');
    if (['CRT_TBS_MSNR_FRESH'].includes(mode)) {
        if (upper(candidate?.fvg_status) !== 'UNTOUCHED' || candidate?.pre_entry_progress > 50) fail('ZONE_NOT_FRESH');
        else increment(counters, 'fresh_entry_zone');
    }
    if (mode === 'FULL_INTEGRATED') {
        // Complete story is an OR over causal evidence roles. CRT, TBS and
        // MSNR are not three mandatory votes: CRT can supply manipulation,
        // TBS can supply failed-breakout confirmation, and MSNR can supply
        // location. The selected family is recorded explicitly.
        const liquidity = tbs || crt;
        if (!liquidity) fail('NO_LIQUIDITY_EVENT');
        const locationEvidence = location || crt || tbs;
        if (!locationEvidence) fail('NO_VALID_LOCATION');
        else increment(counters, 'valid_location');
        const alignment = latestAligned1H(index, direction, asOfMs);
        if (!alignment && !crt && !tbs) fail('NO_DIRECTION_CONFIRMATION');
        else { result.direction_confirmation = eventRef(alignment || tbs || crt); result.evidence_refs.push(eventRef(alignment || tbs || crt)); increment(counters, 'direction_confirmed'); }
        const sequence = linked15mSequence(index, direction, asOfMs, zone);
        const formationTime = finite(candidate?.first_knowable_ms);
        const eventTimestamp = timeOf(liquidity || alignment);
        const causalZone = eventTimestamp == null || formationTime == null || formationTime >= eventTimestamp;
        if (sequence) {
            result.bos_ref = sequence.structure_event_id;
            result.displacement_ref = sequence.impulse_id;
            result.evidence_refs.push(sequence.sequence_id);
            increment(counters, 'displacement_structure');
        } else if (!causalZone) fail('ZONE_PRECEDES_LIQUIDITY_EVENT');
        else {
            const linkedRefs = new Set([...(candidate?.crt_refs || []), ...(candidate?.tbs_refs || []), ...(candidate?.msnr_refs || [])]);
            const causalRef = [crt, tbs, location].filter(Boolean).map(eventRef).find(ref => ref && linkedRefs.has(ref));
            if (!causalRef) fail('NO_CAUSAL_EXECUTION_ZONE');
            else result.evidence_refs.push(causalRef);
        }
        const confirmation = local5mConfirmation(candidate);
        if (!confirmation) fail('NO_5M_CONFIRMATION');
        else { result.execution_confirmation = confirmation.ref || confirmation.type; increment(counters, 'execution_5m_confirmation'); }
        if (upper(candidate?.fvg_status) !== 'UNTOUCHED' || candidate?.pre_entry_progress > 50) fail('ZONE_NOT_FRESH');
        else increment(counters, 'fresh_entry_zone');
        const target = finite(candidate?.tp1);
        const entry = finite(candidate?.entry);
        const stop = finite(candidate?.stop_loss);
        const validGeometry = direction === 'BUY' ? stop < entry && target > entry : stop > entry && target < entry;
        if (!validGeometry) fail('INVALID_TARGET_DIRECTION');
        if (upper(candidate?.entry_inside_opposing_4h) === 'YES' || upper(candidate?.clear_path_to_tp1) === 'NO') fail('PATH_BLOCKED');
        const family = [location ? 'MSNR' : null, crt ? 'CRT' : null, tbs ? 'TBS' : null, candidate?.fvg_zone_low != null ? 'FVG' : 'OB'].filter(Boolean);
        result.setup_family = family.join('+');
    }
    result.qualified = result.blockers.length === 0;
    if (!result.qualified && !result.rejection_reason) result.rejection_reason = 'INCOMPLETE_STORYLINE';
    return result;
}

function buildQualificationIndex(options = {}) {
    const mode = options.mode || 'CURRENT_V2';
    const counters = makeCounters();
    counters.replay_points = 1;
    const map = new Map();
    const records = options.records || [];
    if (!records.length) return { index: null, map, counters };
    const index = makeIndex({ ...options, cache: options.cache });
    for (const record of records) {
        const raw = record.candidate || record;
        const action = upper(raw.action || record.action);
        const candidate = {
            ...raw,
            side: raw.side || record.side || (action === 'BUY_LIMIT' ? 'BUY' : action === 'SELL_LIMIT' ? 'SELL' : null),
            fvg_zone_low: raw.fvg_zone_low ?? record.fvg?.lower,
            fvg_zone_high: raw.fvg_zone_high ?? record.fvg?.upper,
            fvg_status: raw.fvg_status ?? record.fvg?.status,
            pre_entry_progress: raw.pre_entry_progress ?? record.delivery?.pre_entry_progress,
            clear_path_to_tp1: raw.clear_path_to_tp1 ?? record.path_quality?.clear_path_to_tp1,
            entry_inside_opposing_4h: raw.entry_inside_opposing_4h ?? record.path_quality?.entry_inside_opposing_4h,
            execution_5m: raw.execution_5m ?? record.execution?.exec_5m,
            execution_5m_ref: raw.execution_5m_ref ?? record.execution?.exec_5m_ref,
            crt_refs: raw.crt_refs ?? (record.confluence?.crt || []).map(item => item.ref).filter(Boolean),
            tbs_refs: raw.tbs_refs ?? (record.confluence?.tbs || []).map(item => item.ref).filter(Boolean),
            msnr_refs: raw.msnr_refs ?? (record.confluence?.msnr || []).map(item => item.ref).filter(Boolean),
            first_knowable_ms: raw.first_knowable_ms ?? timeOf(record)
        };
        const qualification = evaluateCandidate({ ...options, candidate, mode, index });
        if (qualification.qualified) increment(counters, 'selected');
        else if (qualification.rejection_reason) increment(counters.rejection_reasons, qualification.rejection_reason);
        map.set(options.keyOf ? options.keyOf(record) : record.candidate_id || record.id || JSON.stringify(record), qualification);
    }
    return { index, map, counters };
}

function buildStateHistory({ context, symbol, candles, symbolMetadata = {} } = {}) {
    return build4HStateHistory({ symbol, candles, context, symbolMetadata });
}

module.exports = {
    MODES,
    makeCounters,
    makeIndex,
    buildStateHistory,
    buildQualificationIndex,
    evaluateCandidate,
    sessionContext,
    localDateParts
};
