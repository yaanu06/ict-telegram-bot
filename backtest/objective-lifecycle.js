'use strict';

const { TIMEFRAME_MS, canonicalTimeframe } = require('./data-provider');
const {
    build4HStateHistory,
    getActive4HState,
    buildImpulseLineage
} = require('./market-state');

function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeBars(rows = [], timeframe) {
    const tf = canonicalTimeframe(timeframe);
    const interval = TIMEFRAME_MS[tf];
    return (Array.isArray(rows) ? rows : []).map(row => {
        const t = finite(row?.t ?? row?.timestamp);
        return {
            ...row,
            t,
            o: finite(row?.o ?? row?.open),
            h: finite(row?.h ?? row?.high),
            l: finite(row?.l ?? row?.low),
            c: finite(row?.c ?? row?.close),
            close_time_ms: finite(row?.close_time_ms ?? row?.close_time) ?? (t != null && interval ? t + interval : null),
            is_closed: row?.is_closed !== false
        };
    }).filter(row => row.t != null && row.close_time_ms != null && [row.o, row.h, row.l, row.c].every(Number.isFinite))
        .sort((left, right) => left.t - right.t);
}

function visibleBars(series = [], timeframe, asOfMs) {
    const source = Array.isArray(series) && series.length && Number.isFinite(Number(series[0]?.close_time_ms))
        ? series : normalizeBars(series, timeframe);
    return source.filter(bar => bar.is_closed !== false && bar.close_time_ms <= asOfMs);
}

function eventTime(event, candles = [], timeframe = '1h') {
    const explicit = finite(event?.first_knowable_ms ?? event?.firstKnowableMs);
    if (explicit != null) return explicit;
    const raw = event?.first_knowable_time ?? event?.confirmation_time ?? event?.event_time;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) return parsed;
    }
    const index = Number(event?.index ?? event?.source_index ?? event?.formation_index ?? event?.i);
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    return Number.isInteger(index) && candles[index] && interval ? candles[index].t + interval : null;
}

function directionOf(value) {
    const direction = String(value?.direction || value || '').toUpperCase();
    return direction === 'BUY' || direction === 'SELL' ? direction : null;
}

function eventRole(event) {
    const type = String(event.event_type || event.structure_event_type || event.bridge_type || '').toUpperCase();
    if (event.bridge_type === 'DISPLACEMENT') return 'DISPLACEMENT';
    if (['MSS', 'CHOCH', 'CHoCH'].includes(type)) return 'REVERSAL_EVENT';
    if (['BOS', 'STRUCTURE_BREAK', 'STRUCTURAL_CONTINUATION', 'RECLAIM', 'RANGE_ESCAPE'].includes(type)) return 'CONTINUATION_EVENT';
    return 'STRUCTURAL_EVENT';
}

function build1HEvents({ symbol, candles = [], context } = {}) {
    const closed = normalizeBars(candles, '1h');
    if (!context) return [];
    const displacements = typeof context.buildInstitutionalDisplacementFacts === 'function'
        ? context.buildInstitutionalDisplacementFacts(closed, '1H', symbol, {}) : [];
    const structures = typeof context.buildInstitutionalStructureFacts === 'function'
        ? context.buildInstitutionalStructureFacts(closed, '1H') : [];
    const rows = [
        ...displacements.map(event => ({ ...event, bridge_type: 'DISPLACEMENT' })),
        ...structures.map(event => ({ ...event, bridge_type: 'STRUCTURE' }))
    ].map(event => ({
        ...event,
        direction: directionOf(event),
        first_knowable_ms: eventTime(event, closed, '1h'),
        event_ref: event.id || `${event.bridge_type}:1H:${event.index}:${event.direction}`,
        event_role: eventRole(event)
    })).filter(event => event.direction && event.first_knowable_ms != null);
    return [...new Map(rows.map(event => [`${event.event_ref}:${event.bridge_type}`, event])).values()]
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.event_ref.localeCompare(right.event_ref));
}

function swingObjectiveUniverse({ symbol, timeframe, candles, context, asOfMs, price, direction } = {}) {
    const closed = normalizeBars(candles, timeframe);
    if (!context || typeof context.findSwings !== 'function') return [];
    const swings = context.findSwings(closed, timeframe === '4h' ? 2 : 2);
    const values = direction === 'BUY' ? swings.H || [] : swings.L || [];
    return values.filter(swing => {
        const firstKnowable = eventTime(swing, closed, timeframe);
        return firstKnowable != null && firstKnowable <= asOfMs
            && (direction === 'BUY' ? Number(swing.p) > price : Number(swing.p) < price);
    }).map(swing => {
        const firstKnowable = eventTime(swing, closed, timeframe);
        const side = direction === 'BUY' ? 'HIGH' : 'LOW';
        return {
            objective_id: `OBJECTIVE:${symbol}:${String(timeframe).toUpperCase()}:${direction}:${swing.i}:${swing.p}`,
            type: timeframe === '4h' ? (direction === 'BUY' ? 'BUY_SIDE_LIQUIDITY' : 'SELL_SIDE_LIQUIDITY') : 'LOCAL_SWING',
            tf: String(timeframe).toUpperCase(),
            price: Number(swing.p),
            ref: `SWING:${symbol}:${String(timeframe).toUpperCase()}:${side}:${swing.i}:${swing.p}`,
            first_knowable_ms: firstKnowable,
            distance: Math.abs(Number(swing.p) - price),
            status: 'AVAILABLE',
            delivered: 'NO',
            invalidated: 'NO',
            structural_significance: timeframe === '4h' ? 'HTF_CONFIRMED_SWING' : 'LOCAL_CONFIRMED_SWING',
            direction,
            source_index: swing.i
        };
    });
}

function zoneObjectiveUniverse({ symbol, series, context, asOfMs, price, direction, precision = 5 } = {}) {
    if (!context || typeof context.buildRawTextSupplyDemandAudit !== 'function') return [];
    const blocks = ['4h', '1h'].map(timeframe => ({
        timeframe: timeframe.toUpperCase(),
        candles: visibleBars(series[timeframe] || [], timeframe, asOfMs)
    })).filter(block => block.candles.length > 0);
    const records = context.buildRawTextSupplyDemandAudit(blocks, precision, asOfMs) || [];
    return records.map(record => {
        const type = String(record.type || '').toUpperCase();
        const isSellTarget = direction === 'SELL' && type === 'DEMAND';
        const isBuyTarget = direction === 'BUY' && type === 'SUPPLY';
        if (!isSellTarget && !isBuyTarget) return null;
        const target = direction === 'BUY' ? Number(record.high) : Number(record.low);
        if (!Number.isFinite(target) || (direction === 'BUY' ? target <= price : target >= price)) return null;
        return {
            objective_id: `OBJECTIVE:${symbol}:${record.ref}:${direction}`,
            type: `${type}_BOUNDARY`,
            tf: String(record.timeframe || '').toUpperCase(),
            price: target,
            ref: record.ref,
            first_knowable_ms: Number(record.first_knowable_ms),
            distance: Math.abs(target - price),
            status: record.status === 'INVALIDATED' ? 'INVALIDATED' : 'AVAILABLE',
            delivered: 'NO',
            invalidated: record.status === 'INVALIDATED' ? 'YES' : 'NO',
            structural_significance: 'ACTIVE_STRUCTURAL_BOUNDARY',
            direction
        };
    }).filter(Boolean).filter(objective => objective.first_knowable_ms <= asOfMs);
}

function objectiveChain({ symbol, direction, price, asOfMs, series, context, precision = 5 } = {}) {
    const candidates = [
        ...swingObjectiveUniverse({ symbol, timeframe: '1h', candles: series['1h'], context, asOfMs, price, direction }),
        ...swingObjectiveUniverse({ symbol, timeframe: '4h', candles: series['4h'], context, asOfMs, price, direction }),
        ...zoneObjectiveUniverse({ symbol, series, context, asOfMs, price, direction, precision })
    ];
    const unique = [...new Map(candidates.map(item => [item.objective_id, item])).values()]
        .sort((left, right) => {
            const distanceOrder = left.distance - right.distance;
            if (distanceOrder !== 0) return distanceOrder;
            if (left.tf !== right.tf) return left.tf === '4H' ? -1 : 1;
            return left.objective_id.localeCompare(right.objective_id);
        });
    const chainId = `OBJECTIVE_CHAIN:${symbol}:${direction}:${asOfMs}`;
    const fourH = unique.filter(objective => objective.tf === '4H');
    const primary4H = fourH[0]?.objective_id || null;
    return unique.map((objective, index) => ({
        ...objective,
        objective_rank: index + 1,
        nearer_objective_id: unique[index - 1]?.objective_id || null,
        farther_objective_id: unique[index + 1]?.objective_id || null,
        objective_chain_id: chainId,
        // Diagnostic hierarchy only: nearest 4H level is PRIMARY, farther 4H
        // levels are EXTENDED, and 1H levels are INTERMEDIATE waypoints.
        classification: objective.tf === '1H' ? 'INTERMEDIATE' : objective.objective_id === primary4H ? 'PRIMARY' : 'EXTENDED'
    }));
}

function trueRange(candle, previous) {
    if (!previous) return candle.h - candle.l;
    return Math.max(candle.h - candle.l, Math.abs(candle.h - previous.c), Math.abs(candle.l - previous.c));
}

function atrAt(candles, asOfMs, period = 14) {
    const visible = visibleBars(candles, '4h', asOfMs);
    if (visible.length < period) return null;
    const ranges = visible.slice(-period).map((candle, index, rows) => trueRange(candle, index ? rows[index - 1] : visible.at(-period - 1)));
    return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function firstDelivery({ objective, direction, candles, afterMs, toMs }) {
    return normalizeBars(candles, '5m').find(candle => candle.close_time_ms > afterMs && candle.close_time_ms <= toMs
        && (direction === 'BUY' ? candle.h >= objective.price : candle.l <= objective.price))?.close_time_ms || null;
}

function firstTouch({ zone, candles, afterMs, toMs }) {
    return normalizeBars(candles, '15m').find(candle => candle.close_time_ms > afterMs && candle.close_time_ms <= toMs
        && candle.h >= zone.low && candle.l <= zone.high)?.close_time_ms || null;
}

function durationMs(start, end) {
    return start != null && end != null && end >= start ? end - start : null;
}

function summarize(values) {
    const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!numbers.length) return { count: 0, median: null, average: null };
    const middle = Math.floor(numbers.length / 2);
    return {
        count: numbers.length,
        median: numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2,
        average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    };
}

function analyzeObjectiveLifecycle({ context, series, symbol, from, to, precision = 5 } = {}) {
    const normalized = Object.fromEntries(Object.entries(series || {}).map(([tf, bars]) => [canonicalTimeframe(tf), normalizeBars(bars, tf)]));
    const clocks = normalized['5m'].map(bar => bar.close_time_ms).filter(time => time >= from && time <= to);
    const stateHistory = build4HStateHistory({ symbol, candles: normalized['4h'], context });
    const events = build1HEvents({ symbol, candles: normalized['1h'], context });
    const lineage15 = buildImpulseLineage({ symbol, timeframe: '15M', candles: normalized['15m'], context });
    const replayStateCounts = clocks.reduce((counts, timestamp) => {
        const state = getActive4HState(stateHistory, timestamp);
        const key = state?.direction || 'NONE';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, { BUY: 0, SELL: 0, NONE: 0 });
    const bridge = events.map(event => {
        const state = getActive4HState(stateHistory, event.first_knowable_ms);
        return {
            ...event,
            active_4h_state_id: state?.state_id || null,
            active_4h_direction: state?.direction || 'NEUTRAL',
            state_age_bars: state?.age_bars ?? null,
            alignment: !state ? 'NO_ACTIVE_4H_STATE' : state.direction === event.direction ? 'ALIGNED' : 'CONFLICT'
        };
    });
    const aligned = bridge.filter(event => event.alignment === 'ALIGNED');
    const byState = new Map();
    for (const event of aligned) if (!byState.has(event.active_4h_state_id)) byState.set(event.active_4h_state_id, event);
    const potentialCampaigns = [];
    for (const event of aligned) {
        const price = normalizeBars(normalized['1h'], '1h').find(bar => bar.close_time_ms === event.first_knowable_ms)?.c
            ?? normalizeBars(normalized['5m'], '5m').filter(bar => bar.close_time_ms <= event.first_knowable_ms).at(-1)?.c;
        if (!Number.isFinite(price)) continue;
        const chain = objectiveChain({ symbol, direction: event.direction, price, asOfMs: event.first_knowable_ms, series: normalized, context, precision });
        const fourH = chain.filter(objective => objective.tf === '4H' && objective.status === 'AVAILABLE');
        const selected = fourH[0] || null;
        const eventWindowStart = normalizeBars(normalized['1h'], '1h').find(bar => bar.close_time_ms === event.first_knowable_ms)?.t ?? event.first_knowable_ms - TIMEFRAME_MS['1h'];
        const firstImpulse = lineage15.impulses.filter(impulse => impulse.direction === event.direction && impulse.first_knowable_ms > event.first_knowable_ms).sort((a, b) => a.first_knowable_ms - b.first_knowable_ms)[0] || null;
        const firstSetup = lineage15.setup_events.filter(setup => setup.direction === event.direction && setup.first_knowable_ms > event.first_knowable_ms && setup.parent_impulse_id).sort((a, b) => a.first_knowable_ms - b.first_knowable_ms)[0] || null;
        const linkedZone = firstSetup ? lineage15.zones.find(zone => zone.setup_zone_ref === firstSetup.setup_zone_ref) : null;
        const nestedImpulses = lineage15.impulses.filter(impulse => impulse.direction === event.direction && impulse.first_knowable_ms >= eventWindowStart && impulse.first_knowable_ms <= event.first_knowable_ms);
        const nestedSetups = lineage15.setup_events.filter(setup => setup.direction === event.direction && setup.first_knowable_ms >= eventWindowStart && setup.first_knowable_ms <= event.first_knowable_ms && setup.parent_impulse_id);
        const deliveryTime = selected ? firstDelivery({ objective: selected, direction: event.direction, candles: normalized['5m'], afterMs: event.first_knowable_ms, toMs: to }) : null;
        const setupTouchTime = linkedZone ? firstTouch({ zone: linkedZone, candles: normalized['15m'], afterMs: firstSetup.first_knowable_ms, toMs: to }) : null;
        const farther = selected
            ? chain.filter(objective => objective.status === 'AVAILABLE' && objective.distance > selected.distance)
            : [];
        const stateAtDelivery = deliveryTime ? getActive4HState(stateHistory, deliveryTime) : null;
        const continuationAfterDelivery = deliveryTime
            ? bridge.filter(candidate => candidate.first_knowable_ms > deliveryTime && candidate.first_knowable_ms <= to && candidate.direction === event.direction && candidate.alignment === 'ALIGNED' && candidate.event_role !== 'REVERSAL_EVENT')
            : [];
        const setupAfterDelivery = deliveryTime
            ? lineage15.setup_events.filter(setup => setup.direction === event.direction && setup.parent_impulse_id && setup.first_knowable_ms > deliveryTime && setup.first_knowable_ms <= to)
            : [];
        const row = {
            campaign_event_ref: event.event_ref,
            state_id: event.active_4h_state_id,
            direction: event.direction,
            campaign_start_ms: event.first_knowable_ms,
            campaign_start: new Date(event.first_knowable_ms).toISOString(),
            state_age_bars: event.state_age_bars,
            event_role: event.event_role,
            objective_candidates: chain,
            selected_objective: selected,
            first_impulse_after: firstImpulse,
            first_linked_setup_after: firstSetup,
            nested_impulses: nestedImpulses,
            nested_setups: nestedSetups,
            objective_delivery_ms: deliveryTime,
            objective_delivery: deliveryTime ? new Date(deliveryTime).toISOString() : null,
            first_setup_touch_ms: setupTouchTime,
            first_setup_touch: setupTouchTime ? new Date(setupTouchTime).toISOString() : null,
            objective_before_setup: !!(deliveryTime && (!firstSetup || deliveryTime < firstSetup.first_knowable_ms)),
            setup_before_objective: !!(firstSetup && (!deliveryTime || firstSetup.first_knowable_ms < deliveryTime)),
            simultaneous: !!(firstSetup && deliveryTime && firstSetup.first_knowable_ms === deliveryTime),
            state_after_delivery: stateAtDelivery ? { state_id: stateAtDelivery.state_id, direction: stateAtDelivery.direction, age_bars: stateAtDelivery.age_bars } : null,
            farther_objectives_available: farther,
            farther_objective_available: farther.length > 0,
            continuation_after_delivery: continuationAfterDelivery,
            setup_after_delivery: setupAfterDelivery,
            objective_distance_at_start: selected?.distance ?? null,
            objective_distance_atr: selected ? (selected.distance / (atrAt(normalized['4h'], event.first_knowable_ms) || NaN)) : null,
            time_to_objective_ms: durationMs(event.first_knowable_ms, deliveryTime),
            time_to_first_impulse_ms: durationMs(event.first_knowable_ms, firstImpulse?.first_knowable_ms),
            time_to_first_setup_ms: durationMs(event.first_knowable_ms, firstSetup?.first_knowable_ms),
            time_to_setup_touch_ms: durationMs(event.first_knowable_ms, setupTouchTime),
            post_delivery_continuation: continuationAfterDelivery.length > 0,
            post_delivery_setup: setupAfterDelivery.length > 0,
            could_continue_diagnostically: !!(deliveryTime && stateAtDelivery && stateAtDelivery.direction === event.direction && farther.length && continuationAfterDelivery.length)
        };
        potentialCampaigns.push(row);
    }
    const selectedCampaigns = [...byState.values()].map(event => potentialCampaigns.find(row => row.campaign_event_ref === event.event_ref)).filter(Boolean);
    const timing = {
        objective_before_setup: potentialCampaigns.filter(row => row.objective_before_setup).length,
        setup_before_objective: potentialCampaigns.filter(row => row.setup_before_objective).length,
        neither: potentialCampaigns.filter(row => !row.objective_before_setup && !row.setup_before_objective && !row.simultaneous).length,
        simultaneous: potentialCampaigns.filter(row => row.simultaneous).length
    };
    const objectiveDeliveries = potentialCampaigns.filter(row => row.objective_delivery_ms != null);
    return {
        symbol,
        from,
        to,
        replay_points: clocks.length,
        replay_state_counts: replayStateCounts,
        replay_state_coverage: clocks.length ? (clocks.length - replayStateCounts.NONE) / clocks.length : 0,
        state_history: stateHistory,
        bridge,
        events,
        lineage15,
        potential_campaigns: potentialCampaigns,
        selected_campaigns: selectedCampaigns,
        timing,
        funnel: {
            active_4h_state: bridge.filter(event => event.active_4h_state_id).length,
            aligned_1h_events: aligned.length,
            objective_candidates: potentialCampaigns.reduce((sum, row) => sum + row.objective_candidates.length, 0),
            primary_objectives: potentialCampaigns.filter(row => row.selected_objective).length,
            campaigns_formed: selectedCampaigns.length,
            objective_reached_before_impulse: selectedCampaigns.filter(row => row.objective_delivery_ms && (!row.first_impulse_after || row.objective_delivery_ms < row.first_impulse_after.first_knowable_ms)).length,
            impulse_before_objective: selectedCampaigns.filter(row => row.first_impulse_after && (!row.objective_delivery_ms || row.first_impulse_after.first_knowable_ms < row.objective_delivery_ms)).length,
            linked_setup_before_objective: selectedCampaigns.filter(row => row.setup_before_objective).length,
            delivered_intermediate: potentialCampaigns.filter(row => row.objective_delivery_ms && row.selected_objective?.classification === 'INTERMEDIATE').length,
            farther_objective_available: potentialCampaigns.filter(row => row.farther_objective_available).length,
            continuation_after_delivery: objectiveDeliveries.filter(row => row.post_delivery_continuation).length,
            campaign_could_continue: objectiveDeliveries.filter(row => row.could_continue_diagnostically).length,
            nested_15m_impulse: potentialCampaigns.filter(row => row.nested_impulses.length > 0).length,
            nested_15m_setup: potentialCampaigns.filter(row => row.nested_setups.length > 0).length,
            later_15m_setup: objectiveDeliveries.filter(row => row.post_delivery_setup).length
        },
        latency: {
            to_first_impulse_ms: summarize(potentialCampaigns.map(row => row.time_to_first_impulse_ms)),
            to_first_setup_ms: summarize(potentialCampaigns.map(row => row.time_to_first_setup_ms)),
            to_setup_touch_ms: summarize(potentialCampaigns.map(row => row.time_to_setup_touch_ms)),
            to_objective_ms: summarize(potentialCampaigns.map(row => row.time_to_objective_ms))
        },
        event_taxonomy: Object.fromEntries([...new Set(bridge.map(event => event.event_role))].map(role => [role, bridge.filter(event => event.event_role === role).length])),
        alignment_taxonomy: Object.fromEntries([...new Set(bridge.map(event => event.alignment))].map(value => [value, bridge.filter(event => event.alignment === value).length]))
    };
}

module.exports = {
    normalizeBars,
    eventTime,
    build1HEvents,
    swingObjectiveUniverse,
    zoneObjectiveUniverse,
    objectiveChain,
    analyzeObjectiveLifecycle,
    eventRole,
    summarize
};
