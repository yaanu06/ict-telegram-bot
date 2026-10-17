'use strict';

const { TIMEFRAME_MS, canonicalTimeframe } = require('./data-provider');

const STATE_TIMEFRAME = '4H';
const MAX_DISPLACEMENT_TO_STRUCTURE_BARS = 10;

function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function candleStart(candle) {
    return finite(candle?.t ?? candle?.timestamp);
}

function candleClose(candle, timeframe = '4h') {
    const start = candleStart(candle);
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    return start == null || !interval ? null : finite(candle?.close_time_ms ?? candle?.close_time ?? start + interval);
}

function closedCandles(candles = [], timeframe = '4h') {
    return (Array.isArray(candles) ? candles : [])
        .filter(candle => candle && candle.is_closed !== false && candle.closed !== false && candle.is_forming !== true && candle.forming !== true)
        .map(candle => ({
            ...candle,
            t: candleStart(candle),
            close_time_ms: candleClose(candle, timeframe)
        }))
        .filter(candle => candle.t != null && candle.close_time_ms != null)
        .sort((left, right) => left.t - right.t);
}

function eventTime(event, candles, timeframe = '4h') {
    const explicit = finite(event?.first_knowable_ms ?? event?.firstKnowableMs);
    if (explicit != null) return explicit;
    const index = Number(event?.index ?? event?.source_index);
    if (Number.isInteger(index) && candles[index]) return candleClose(candles[index], timeframe);
    const parsed = Date.parse(event?.first_knowable_time ?? event?.confirmation_time ?? event?.event_time ?? '');
    return Number.isFinite(parsed) ? parsed : null;
}

function eventIndex(event) {
    const value = Number(event?.index ?? event?.source_index);
    return Number.isInteger(value) ? value : null;
}

function directionOf(event) {
    const value = String(event?.direction || '').toUpperCase();
    return value === 'BUY' || value === 'SELL' ? value : null;
}

function makeStateId(symbol, direction, originRefs) {
    return `4H_STATE:${symbol}:${direction}:${[...new Set(originRefs.filter(Boolean))].join('+')}`;
}

function normalizeActivationEvent(event, candles, symbol) {
    const direction = directionOf(event);
    const index = eventIndex(event);
    const firstKnowable = eventTime(event, candles);
    if (!direction || firstKnowable == null) return null;
    const originRefs = [event.origin_event_ref, event.displacement_ref, event.structural_ref, event.id].filter(Boolean);
    if (!originRefs.length) return null;
    const invalidationPrice = finite(event.invalidation_price);
    return {
        id: event.id || makeStateId(symbol, direction, originRefs),
        symbol,
        direction,
        index,
        first_knowable_ms: firstKnowable,
        first_knowable: new Date(firstKnowable).toISOString(),
        start_time: new Date(firstKnowable).toISOString(),
        origin_event_ref: event.origin_event_ref || event.id,
        origin_refs: [...new Set(originRefs)],
        supporting_refs: [...new Set(event.supporting_refs || [])],
        invalidation_price: invalidationPrice,
        invalidation_ref: event.invalidation_ref || null,
        source: event.source || 'DETERMINISTIC_4H_SEQUENCE'
    };
}

function derive4HActivationEvents({ symbol, candles = [], context, symbolMetadata = {} } = {}) {
    if (!context || typeof context.buildInstitutionalDisplacementFacts !== 'function' || typeof context.buildInstitutionalStructureFacts !== 'function') return [];
    const closed = closedCandles(candles);
    const displacements = context.buildInstitutionalDisplacementFacts(closed, STATE_TIMEFRAME, symbol, symbolMetadata) || [];
    const structures = context.buildInstitutionalStructureFacts(closed, STATE_TIMEFRAME) || [];
    const events = [];
    for (const displacement of displacements) {
        const index = eventIndex(displacement);
        const consequence = structures.find(item => directionOf(item) === directionOf(displacement)
            && eventIndex(item) != null && index != null
            && eventIndex(item) > index
            && eventIndex(item) - index <= MAX_DISPLACEMENT_TO_STRUCTURE_BARS);
        if (!consequence) continue;
        const range = closed.slice(index, eventIndex(consequence) + 1);
        const invalidationPrice = directionOf(displacement) === 'BUY'
            ? Math.min(...range.map(candle => Number(candle.l)).filter(Number.isFinite))
            : Math.max(...range.map(candle => Number(candle.h)).filter(Number.isFinite));
        const activation = normalizeActivationEvent({
            id: `4H_SEQUENCE:${symbol}:${directionOf(displacement)}:${displacement.id}:${consequence.id}`,
            direction: directionOf(displacement),
            index: eventIndex(consequence),
            first_knowable_ms: eventTime(consequence, closed),
            origin_event_ref: displacement.id,
            displacement_ref: displacement.id,
            structural_ref: consequence.id,
            supporting_refs: [...(displacement.evidence_ids || []), ...(consequence.evidence_ids || [])],
            invalidation_price: Number.isFinite(invalidationPrice) ? invalidationPrice : null,
            invalidation_ref: `${displacement.id}:INVALIDATION_RANGE`,
            source: 'DISPLACEMENT_THEN_STRUCTURE'
        }, closed, symbol);
        if (activation) events.push(activation);
    }
    return [...new Map(events.map(event => [event.id, event])).values()]
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms);
}

function breachState(state, candle) {
    if (state.invalidation_price == null) return false;
    return state.direction === 'BUY'
        ? Number(candle.c) < state.invalidation_price
        : Number(candle.c) > state.invalidation_price;
}

function build4HStateHistory({ symbol = 'UNKNOWN', candles = [], context = null, activationEvents = null, symbolMetadata = {} } = {}) {
    const closed = closedCandles(candles);
    const events = (activationEvents || derive4HActivationEvents({ symbol, candles: closed, context, symbolMetadata }))
        .map(event => normalizeActivationEvent(event, closed, symbol))
        .filter(Boolean)
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.id.localeCompare(right.id));
    const states = [];
    let active = null;
    let lastProcessedIndex = -1;

    const invalidateThrough = (endIndex) => {
        if (!active) return;
        const limit = Math.min(endIndex, closed.length - 1);
        for (let index = Math.max(lastProcessedIndex + 1, 0); index <= limit; index += 1) {
            const candle = closed[index];
            if (index > (active.index ?? -1) && breachState(active, candle)) {
                active.status = 'INVALIDATED';
                active.invalidated_at_ms = candle.close_time_ms;
                active.end_time = new Date(candle.close_time_ms).toISOString();
                active.invalidation_reason = 'INVALIDATION_PRICE_BREACHED';
                active.invalidation_ref = active.invalidation_ref || `4H_CANDLE:${candle.t}`;
                active = null;
                break;
            }
        }
        lastProcessedIndex = Math.max(lastProcessedIndex, limit);
    };

    for (const event of events) {
        const eventIndexValue = event.index == null ? closed.findIndex(candle => candle.close_time_ms >= event.first_knowable_ms) : event.index;
        invalidateThrough(eventIndexValue - 1);
        if (active && active.direction !== event.direction) {
            active.status = 'SUPERSEDED';
            active.superseded_by_ref = event.id;
            active.end_time = event.start_time;
            active.invalidation_reason = 'OPPOSITE_4H_STATE_SUPERSEDED';
            active = null;
        }
        if (active && active.direction === event.direction) {
            active.last_confirmed_time = event.start_time;
            active.last_confirmed_ms = event.first_knowable_ms;
            active.supporting_refs = [...new Set([...active.supporting_refs, ...event.supporting_refs, ...event.origin_refs])];
            continue;
        }
        const state = {
            ...event,
            state_id: makeStateId(symbol, event.direction, event.origin_refs),
            status: 'ACTIVE',
            last_confirmed_time: event.start_time,
            last_confirmed_ms: event.first_knowable_ms,
            age_bars: 0,
            end_time: null,
            invalidated_at_ms: null,
            superseded_by_ref: null,
            invalidation_reason: null
        };
        states.push(state);
        active = state;
    }
    invalidateThrough(closed.length - 1);
    return { states, events, candles: closed };
}

function getActive4HState(history, asOfMs) {
    const timestamp = finite(asOfMs);
    if (!history || timestamp == null) return null;
    const active = (history.states || []).filter(state => state.first_knowable_ms <= timestamp
        && (state.end_time == null || Date.parse(state.end_time) > timestamp));
    if (!active.length) return null;
    const state = active.at(-1);
    const candles = history.candles || [];
    const currentIndex = candles.findIndex(candle => candle.close_time_ms > timestamp);
    const endIndex = currentIndex < 0 ? candles.length - 1 : Math.max(0, currentIndex - 1);
    return { ...state, age_bars: Math.max(0, endIndex - (state.index ?? endIndex)) };
}

function makeImpulseId(symbol, timeframe, displacement) {
    return `IMPULSE:${symbol}:${String(timeframe).toUpperCase()}:${displacement.id || displacement.index}:${displacement.direction}`;
}

function buildImpulseLineage({ symbol = 'UNKNOWN', timeframe = '15M', candles = [], context, symbolMetadata = {} } = {}) {
    const closed = closedCandles(candles, timeframe).map(candle => ({ ...candle, close_time_ms: candleClose(candle, timeframe) }));
    if (!context || typeof context.buildInstitutionalDisplacementFacts !== 'function' || typeof context.detectFVG !== 'function') return { impulses: [], zones: [], setup_events: [] };
    const displacements = context.buildInstitutionalDisplacementFacts(closed, String(timeframe).toUpperCase(), symbol, symbolMetadata) || [];
    const impulses = displacements.map(displacement => {
        const index = eventIndex(displacement);
        const candle = index == null ? null : closed[index];
        const firstKnowable = eventTime(displacement, closed, timeframe);
        return {
            impulse_id: makeImpulseId(symbol, timeframe, displacement),
            symbol,
            timeframe: String(timeframe).toUpperCase(),
            direction: directionOf(displacement),
            start_time: candle ? new Date(candle.t).toISOString() : displacement.event_time,
            end_time: firstKnowable == null ? null : new Date(firstKnowable).toISOString(),
            first_knowable_ms: firstKnowable,
            first_knowable: firstKnowable == null ? null : new Date(firstKnowable).toISOString(),
            origin_ref: displacement.id,
            liquidity_event_ref: null,
            displacement_ref: displacement.id,
            price_low: candle ? Number(candle.l) : null,
            price_high: candle ? Number(candle.h) : null,
            status: 'FORMED',
            evidence_ids: displacement.evidence_ids || [displacement.id],
            index
        };
    });
    const impulseByIndex = impulses.filter(impulse => impulse.index != null);
    const zones = (context.detectFVG(closed, symbol, symbolMetadata) || []).map((fvg, index) => {
        const sourceIndex = eventIndex(fvg);
        const zoneDirection = fvg.type === 'bull' ? 'BUY' : 'SELL';
        const parent = impulseByIndex.find(impulse => impulse.direction === zoneDirection
            && (impulse.index === sourceIndex || impulse.index + 1 === sourceIndex));
        const zoneRef = `FVG:${String(timeframe).toUpperCase()}:${fvg.type}:${sourceIndex}:${fvg.l}:${fvg.h}`;
        const firstKnowable = eventTime({ first_knowable_time: fvg.first_knowable_time, source_index: sourceIndex }, closed, timeframe);
        return {
            setup_zone_ref: zoneRef,
            setup_zone_type: 'FVG',
            timeframe: String(timeframe).toUpperCase(),
            direction: zoneDirection,
            low: Number(fvg.l),
            high: Number(fvg.h),
            first_knowable_ms: firstKnowable,
            first_knowable: firstKnowable == null ? null : new Date(firstKnowable).toISOString(),
            source_index: sourceIndex,
            parent_impulse_id: parent?.impulse_id || null,
            relation_to_impulse: parent ? 'CREATED_BY_IMPULSE' : 'NONE',
            evidence_ids: [zoneRef, ...(parent?.evidence_ids || [])]
        };
    });
    const setup_events = zones.map(zone => ({
        setup_event_id: `SETUP_EVENT:${symbol}:${zone.timeframe}:${zone.setup_zone_ref}`,
        opportunity_id: `OPPORTUNITY:${symbol}:${zone.timeframe}:${zone.setup_zone_ref}`,
        setup_zone_ref: zone.setup_zone_ref,
        parent_impulse_id: zone.parent_impulse_id,
        relation_to_impulse: zone.relation_to_impulse,
        direction: zone.direction,
        first_knowable_ms: zone.first_knowable_ms,
        first_knowable: zone.first_knowable,
        status: 'AVAILABLE'
    }));
    return { impulses, zones, setup_events };
}

function align1HEventsTo4HState({ events = [], stateHistory, asOfMs = null } = {}) {
    return events.map(event => {
        const eventTimeMs = eventTime(event, stateHistory?.candles || [], '1h');
        const state = getActive4HState(stateHistory, eventTimeMs);
        const direction = directionOf(event);
        return {
            event_id: event.id || null,
            event_time_ms: eventTimeMs,
            direction,
            state_id: state?.state_id || null,
            state_direction: state?.direction || null,
            relation: !state ? 'NO_ACTIVE_4H_STATE' : state.direction === direction ? 'ALIGNED' : 'CONFLICT',
            state_age_bars: state?.age_bars ?? null,
            as_of_ms: asOfMs ?? eventTimeMs
        };
    });
}

module.exports = {
    MAX_DISPLACEMENT_TO_STRUCTURE_BARS,
    closedCandles,
    derive4HActivationEvents,
    build4HStateHistory,
    getActive4HState,
    buildImpulseLineage,
    align1HEventsTo4HState,
    normalizeActivationEvent
};
