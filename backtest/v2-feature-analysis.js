'use strict';

const { canonicalTimeframe } = require('./data-provider');
const { build4HStateHistory, getActive4HState } = require('./market-state');
const { build1HEvents } = require('./objective-lifecycle');
const { buildExecutionPrimitives, normalizeCandles } = require('./execution-structure');

function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function directionOf(value) {
    const direction = String(value?.direction || value?.side || value || '').toUpperCase();
    return ['BUY', 'SELL'].includes(direction) ? direction : null;
}

function timeOf(value) {
    const explicit = finite(value?.first_knowable_ms ?? value?.firstKnowableMs ?? value?.close_time_ms);
    if (explicit != null) return explicit;
    const parsed = Date.parse(value?.first_knowable || value?.first_knowable_time || value?.event_time || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function visible(candles, asOfMs) {
    return candles.filter(candle => candle.close_time_ms <= asOfMs);
}

function trueRange(candle, previous) {
    if (!previous) return candle.h - candle.l;
    return Math.max(candle.h - candle.l, Math.abs(candle.h - previous.c), Math.abs(candle.l - previous.c));
}

function atrAt(candles, asOfMs, period = 14) {
    const rows = visible(candles, asOfMs);
    if (rows.length < period) return null;
    const start = Math.max(0, rows.length - period);
    const ranges = rows.slice(start).map((candle, index, selected) => trueRange(candle, index ? selected[index - 1] : rows[start - 1]));
    return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function latest(events, asOfMs, predicate = () => true) {
    return events.filter(event => (timeOf(event) ?? Infinity) <= asOfMs && predicate(event))
        .sort((left, right) => (timeOf(right) || 0) - (timeOf(left) || 0) || String(right.id || '').localeCompare(String(left.id || '')))[0] || null;
}

function eventKind(event) {
    const type = String(event?.type || event?.event_type || event?.bridge_type || '').toUpperCase();
    return type === 'CHOCH' ? 'MSS' : type;
}

function sessionForHour(hour) {
    if (hour >= 0 && hour < 7) return 'ASIA';
    if (hour >= 7 && hour < 12) return 'LONDON';
    if (hour >= 12 && hour < 17) return 'OVERLAP';
    if (hour >= 17 && hour < 22) return 'NEW_YORK';
    return 'OTHER';
}

function outcomeFlags(simulation) {
    const highest = Number(simulation?.highest_target_reached || 0);
    const outcome = simulation?.final_outcome;
    return {
        outcome,
        sl: outcome === 'SL',
        tp1_plus: highest >= 1,
        tp2_plus: highest >= 2,
        tp3: highest >= 3,
        sl_before_tp1: outcome === 'SL' && simulation?.tp1_before_sl !== true
    };
}

function zoneContains(zone, price) {
    return zone && finite(zone.low) != null && finite(zone.high) != null && price >= zone.low && price <= zone.high;
}

function nearestSequence(sequences, direction, entry, asOfMs) {
    const known = sequences.filter(sequence => sequence.direction === direction && sequence.first_knowable_ms <= asOfMs);
    return known.sort((left, right) => {
        const leftZone = left.refined_zone || { low: left.ob.zone_low, high: left.ob.zone_high };
        const rightZone = right.refined_zone || { low: right.ob.zone_low, high: right.ob.zone_high };
        const leftDistance = zoneContains(leftZone, entry) ? 0 : Math.min(Math.abs(entry - leftZone.low), Math.abs(entry - leftZone.high));
        const rightDistance = zoneContains(rightZone, entry) ? 0 : Math.min(Math.abs(entry - rightZone.low), Math.abs(entry - rightZone.high));
        return leftDistance - rightDistance || right.first_knowable_ms - left.first_knowable_ms;
    })[0] || null;
}

function local5mFeatures(index, trade, asOfMs) {
    const direction = directionOf(trade.side);
    const entry = finite(trade.entry);
    const risk = Math.abs(entry - finite(trade.stop_loss));
    const events = [...index.primitives['5m'].structures, ...index.primitives['5m'].displacements]
        .filter(event => directionOf(event) === direction && timeOf(event) <= asOfMs)
        .map(event => {
            const candle = index.primitives['5m'].candles[event.index];
            const local = candle && candle.l <= entry + risk && candle.h >= entry - risk;
            return { event, local, time: timeOf(event) };
        })
        .filter(item => item.local)
        .sort((left, right) => right.time - left.time);
    const event = events[0]?.event || null;
    const structures = events.filter(item => ['BOS', 'MSS'].includes(eventKind(item.event)));
    const displacement = events.find(item => String(item.event.id || '').startsWith('DISPLACEMENT:'));
    return {
        '5M_BOS_PRESENT': structures.some(item => eventKind(item.event) === 'BOS'),
        '5M_MSS_PRESENT': structures.some(item => eventKind(item.event) === 'MSS'),
        '5M_DISPLACEMENT_PRESENT': !!displacement,
        '5M_CONFIRMATION_ALIGNED': String(trade.execution_5m || '').toUpperCase() === 'CONFIRMED' && !!event,
        '5M_CONFIRMATION_AGE': event ? Math.max(0, asOfMs - timeOf(event)) : null,
        '5M_CONFIRMATION_LOCAL_TO_ENTRY': !!event,
        '5M_CONFIRMATION_REF': event?.id || event?.structure_event_id || null
    };
}

function buildFeatureIndex({ context, series, symbol }) {
    const normalized = Object.fromEntries(Object.entries(series).map(([tf, candles]) => [canonicalTimeframe(tf), normalizeCandles(candles, tf)]));
    const stateHistory = build4HStateHistory({ symbol, candles: normalized['4h'] || [], context });
    const oneHEvents = build1HEvents({ symbol, candles: normalized['1h'] || [], context });
    const primitives = {};
    for (const timeframe of ['1h', '15m', '5m']) {
        primitives[timeframe] = buildExecutionPrimitives({ context, candles: normalized[timeframe] || [], timeframe, symbol });
    }
    return { normalized, stateHistory, oneHEvents, primitives };
}

function enrichTrade({ trade, index, symbol }) {
    const decisionMs = finite(trade.first_knowable_ms ?? trade.first_selected_at_ms);
    const direction = directionOf(trade.side);
    const entry = finite(trade.entry);
    const state = getActive4HState(index.stateHistory, decisionMs);
    const stateAligned = !!state && state.direction === direction;
    const oneH = latest(index.oneHEvents, decisionMs);
    const oneHAligned = !!oneH && directionOf(oneH) === direction;
    const oneHStructures = index.primitives['1h'].structures;
    const oneHDisplacements = index.primitives['1h'].displacements;
    const oneHStructure = latest(oneHStructures, decisionMs, event => directionOf(event) === direction);
    const oneHDisplacement = latest(oneHDisplacements, decisionMs, event => directionOf(event) === direction);
    const fifteen = index.primitives['15m'];
    const fifteenStructure = latest(fifteen.structures, decisionMs, event => directionOf(event) === direction);
    const fifteenDisplacement = latest(fifteen.displacements, decisionMs, event => directionOf(event) === direction);
    const sequence = nearestSequence(fifteen.sequences, direction, entry, decisionMs);
    const sequenceZone = sequence?.refined_zone || (sequence ? { low: sequence.ob.zone_low, high: sequence.ob.zone_high } : null);
    const sweepCandidates = [...fifteen.sweeps, ...index.primitives['1h'].sweeps]
        .filter(event => timeOf(event) <= decisionMs && directionOf(event) === direction)
        .sort((left, right) => timeOf(right) - timeOf(left));
    const sweep = sweepCandidates[0] || null;
    const fvgLow = finite(trade.fvg_zone_low);
    const fvgHigh = finite(trade.fvg_zone_high);
    const fvgWidth = fvgLow != null && fvgHigh != null ? Math.abs(fvgHigh - fvgLow) : null;
    const atr15 = atrAt(fifteen.candles, decisionMs);
    const displacement = fifteenDisplacement || oneHDisplacement;
    const displacementCandle = displacement && index.primitives[displacement.timeframe === '1H' ? '1h' : '15m'].candles[displacement.index];
    const displacementRange = displacementCandle ? displacementCandle.h - displacementCandle.l : null;
    const displacementBodyRatio = finite(displacement?.body_ratio);
    const timestamp = new Date(decisionMs);
    const pd = String(trade.premium_discount || '').toUpperCase();
    const pathBarrier = String(trade.opposing_4h_barrier_before_tp1 || '').toUpperCase();
    const outcome = outcomeFlags(trade.simulation);
    const sequenceKnown = !!sequence;
    const sequenceRetraceKnown = sequenceKnown && sequence.retracement && sequence.retracement.time_ms <= decisionMs;
    const sequenceFvg = sequence?.fvg || null;
    const sequenceOverlap = !!sequence?.refined_zone;
    const allKnown1H = [...oneHStructures, ...oneHDisplacements].filter(event => timeOf(event) <= decisionMs);
    return {
        symbol,
        candidate_id: trade.candidate_id,
        candidate_timestamp: new Date(decisionMs).toISOString(),
        decision_time_ms: decisionMs,
        fill_time_ms: trade.simulation?.fill_time_ms ?? null,
        direction,
        setup: trade.setup || trade.fvg_type || null,
        timeframe: trade.timeframe,
        entry,
        stop: finite(trade.stop_loss),
        tp1: finite(trade.tp1),
        tp2: finite(trade.tp2),
        tp3: finite(trade.tp3),
        final_outcome: outcome.outcome,
        terminal_r: finite(trade.simulation?.r_result),
        SL: outcome.sl,
        TP1_OR_BETTER: outcome.tp1_plus,
        TP2_OR_BETTER: outcome.tp2_plus,
        TP3: outcome.tp3,
        SL_BEFORE_TP1: outcome.sl_before_tp1,
        candidate_refs: { fvg_c1: trade.fvg_c1, fvg_c2: trade.fvg_c2, fvg_c3: trade.fvg_c3, candidate_id: trade.candidate_id },
        HTF_4H_STATE: state?.direction || 'NONE',
        HTF_STATE_ID: state?.state_id || null,
        HTF_STATE_ALIGNED_WITH_TRADE: stateAligned,
        HTF_STATE_AGE_BARS: state?.age_bars ?? null,
        HTF_STATE_STRENGTH_CONTEXT: state ? state.source || 'DETERMINISTIC_4H_SEQUENCE' : 'NONE',
        OPPOSING_HTF_STATE_PRESENT: !!state && !stateAligned,
        '1H_BOS_PRESENT': allKnown1H.some(event => eventKind(event) === 'BOS' && directionOf(event) === direction),
        '1H_MSS_PRESENT': allKnown1H.some(event => eventKind(event) === 'MSS' && directionOf(event) === direction),
        '1H_DISPLACEMENT_PRESENT': !!oneHDisplacement,
        '1H_EVENT_DIRECTION': directionOf(oneH) || 'NONE',
        '1H_EVENT_ALIGNED': oneHAligned,
        '1H_EVENT_AGE': oneH ? Math.max(0, decisionMs - timeOf(oneH)) : null,
        '1H_CONTINUATION_EVENT': String(oneH?.event_role || '').toUpperCase() === 'CONTINUATION_EVENT',
        '1H_EVENT_REF': oneH?.event_ref || oneH?.id || null,
        '15M_BOS_PRESENT': !!fifteenStructure && eventKind(fifteenStructure) === 'BOS',
        '15M_MSS_PRESENT': !!fifteenStructure && eventKind(fifteenStructure) === 'MSS',
        '15M_DISPLACEMENT_PRESENT': !!fifteenDisplacement,
        '15M_IMPULSE_ID': fifteenDisplacement?.impulse_id || null,
        '15M_IMPULSE_ALIGNED': !!fifteenDisplacement,
        '15M_ORIGINATING_OB_PRESENT': !!sequence?.ob,
        '15M_OB_ID': sequence?.ob?.ob_id || null,
        '15M_OB_OVERLAPS_ENTRY': !!sequence?.ob && zoneContains({ low: sequence.ob.zone_low, high: sequence.ob.zone_high }, entry),
        '15M_OB_FVG_OVERLAP': sequenceOverlap,
        '15M_FVG_LINKED_TO_IMPULSE': !!sequenceFvg,
        LIQUIDITY_SWEEP_PRESENT: !!sweep,
        SWEEP_DIRECTION: sweep?.direction || 'NONE',
        SWEEP_TF: sweep?.timeframe || 'NONE',
        SWEEP_ALIGNED_WITH_TRADE: !!sweep && directionOf(sweep) === direction,
        SWEEP_AGE: sweep ? Math.max(0, decisionMs - timeOf(sweep)) : null,
        RETRACE_NUMBER: sequenceRetraceKnown ? sequence.retrace_number : (String(trade.fvg_status || '').toUpperCase() === 'UNTOUCHED' ? 0 : null),
        FIRST_RETRACE: sequenceRetraceKnown ? sequence.retrace_number === 1 : String(trade.fvg_status || '').toUpperCase() === 'UNTOUCHED',
        MITIGATION_COUNT: sequence?.ob?.mitigation_count ?? null,
        ZONE_ALREADY_TOUCHED: String(trade.fvg_status || '').toUpperCase() !== 'UNTOUCHED',
        ZONE_PARTIAL_OR_FRESH: String(trade.fvg_status || '').toUpperCase() === 'PARTIAL' ? 'PARTIAL' : 'FRESH',
        ZONE_AGE_BARS: trade.formation_age_hours != null ? Number(trade.formation_age_hours) * 4 : null,
        FVG_WIDTH: fvgWidth,
        FVG_WIDTH_ATR: fvgWidth != null && atr15 ? fvgWidth / atr15 : null,
        FVG_REMAINING_PERCENT: String(trade.fvg_status || '').toUpperCase() === 'UNTOUCHED' ? 100 : String(trade.fvg_status || '').toUpperCase() === 'PARTIAL' ? 50 : null,
        FVG_LIFECYCLE: trade.fvg_status || 'UNKNOWN',
        FVG_FIRST_TOUCH: String(trade.fvg_status || '').toUpperCase() !== 'UNTOUCHED',
        FVG_LINKED_TO_DISPLACEMENT: !!sequenceFvg,
        FVG_LINKED_TO_BOS_MSS: !!sequenceFvg && !!sequence?.structure_event,
        FVG_OVERLAPS_OB: sequenceOverlap,
        DISPLACEMENT_RANGE: displacementRange,
        DISPLACEMENT_RANGE_ATR: displacementRange != null && atr15 ? displacementRange / atr15 : null,
        DISPLACEMENT_BODY_RATIO: displacementBodyRatio,
        DISPLACEMENT_CANDLE_COUNT: displacement ? 1 : 0,
        DISPLACEMENT_BREAKS_STRUCTURE: !!displacement && !!fifteenStructure,
        DISPLACEMENT_ALIGNED: !!displacement && directionOf(displacement) === direction,
        ENTRY_PREMIUM_DISCOUNT_STATE: pd || 'UNKNOWN',
        ENTRY_PREMIUM_DISCOUNT_ALIGNED: (direction === 'BUY' && pd === 'DISCOUNT') || (direction === 'SELL' && pd === 'PREMIUM'),
        ENTRY_INSIDE_OPPOSING_4H: trade.entry_inside_opposing_4h || 'UNKNOWN',
        OPPOSING_4H_BARRIER_BEFORE_TP1: pathBarrier || 'UNKNOWN',
        BARRIER_DISTANCE_R: finite(trade.barrier_distance_r),
        CLEAR_PATH_TO_TP1: trade.clear_path_to_tp1 || 'UNKNOWN',
        PATH_QUALITY_PENALTY: finite(trade.path_quality_penalty) ?? 0,
        NEAREST_OPPOSING_1H_DISTANCE_R: null,
        ...local5mFeatures(index, trade, decisionMs),
        SESSION: sessionForHour(timestamp.getUTCHours()),
        HOUR_UTC: timestamp.getUTCHours(),
        DAY_OF_WEEK: timestamp.getUTCDay(),
        CURRENT_V2: {
            quality: trade.quality,
            score: trade.score,
            current_score: trade.current_score,
            current_opportunity: trade.current_opportunity,
            today_opportunity: trade.today_opportunity,
            daily_bias: trade.daily_bias,
            premium_discount: trade.premium_discount,
            crt_refs: trade.crt_refs || [],
            msnr_refs: trade.msnr_refs || [],
            supply_demand: trade.supply_demand,
            displacement: trade.displacement,
            timeframe: trade.timeframe,
            path_penalty: trade.path_quality_penalty
        }
    };
}

function metric(rows) {
    const values = rows.map(row => row.terminal_r).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return {
        n: rows.length,
        filled: rows.filter(row => row.fill_time_ms != null).length,
        sl: rows.filter(row => row.SL).length,
        sl_rate: rows.length ? rows.filter(row => row.SL).length / rows.length : null,
        tp1_plus: rows.filter(row => row.TP1_OR_BETTER).length,
        tp1_plus_rate: rows.length ? rows.filter(row => row.TP1_OR_BETTER).length / rows.length : null,
        tp2_plus: rows.filter(row => row.TP2_OR_BETTER).length,
        tp3: rows.filter(row => row.TP3).length,
        total_r: values.reduce((sum, value) => sum + value, 0),
        average_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        median_r: values.length ? (values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) : null,
        sl_before_tp1: rows.filter(row => row.SL_BEFORE_TP1).length
    };
}

function groupedFeatureReport(rows, feature) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[feature] == null ? 'UNKNOWN' : String(row[feature]);
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(row);
    }
    return Object.fromEntries([...groups.entries()].map(([value, items]) => [value, metric(items)]));
}

function reportFeatures(rows, features) {
    return Object.fromEntries(features.map(feature => [feature, groupedFeatureReport(rows, feature)]));
}

function numericFeatureReport(rows, feature) {
    const known = rows.filter(row => Number.isFinite(Number(row[feature])));
    const values = known.map(row => Number(row[feature])).sort((left, right) => left - right);
    if (!values.length) return { n: 0, average: null, median: null, min: null, max: null, outcomes: metric([]) };
    const middle = Math.floor(values.length / 2);
    return {
        n: values.length,
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
        min: values[0],
        max: values.at(-1),
        outcomes: metric(known)
    };
}

function interaction(rows, name, predicate) {
    const selected = rows.filter(predicate);
    return { name, included: metric(selected), excluded: metric(rows.filter(row => !predicate(row))) };
}

function candidateRuleReports(rows) {
    const rules = [
        { name: 'REQUIRE_HTF_ALIGNMENT', predicate: row => row.HTF_STATE_ALIGNED_WITH_TRADE === true },
        { name: 'REQUIRE_1H_ALIGNMENT', predicate: row => row['1H_EVENT_ALIGNED'] === true },
        { name: 'REQUIRE_1H_CONTINUATION_EVENT', predicate: row => row['1H_CONTINUATION_EVENT'] === true },
        { name: 'REQUIRE_15M_BOS', predicate: row => row['15M_BOS_PRESENT'] === true },
        { name: 'REQUIRE_FIRST_RETRACE', predicate: row => row.FIRST_RETRACE === true },
        { name: 'REQUIRE_OB_FVG_OVERLAP', predicate: row => row.OB_FVG_OVERLAP === true },
        { name: 'REQUIRE_PREMIUM_DISCOUNT_ALIGNMENT', predicate: row => row.ENTRY_PREMIUM_DISCOUNT_ALIGNED === true },
        { name: 'REQUIRE_LOCAL_5M_CONFIRMATION', predicate: row => row['5M_CONFIRMATION_ALIGNED'] === true },
        { name: 'REQUIRE_CLEAR_PATH', predicate: row => row.CLEAR_PATH_TO_TP1 === 'YES' }
    ];
    return rules.map(rule => {
        const kept = rows.filter(rule.predicate);
        const removed = rows.filter(row => !rule.predicate(row));
        return { name: rule.name, retained: kept.length, retention_percent: rows.length ? kept.length / rows.length * 100 : 0, kept: metric(kept), removed: metric(removed), removed_winners: removed.filter(row => row.TP1_OR_BETTER).length, removed_losers: removed.filter(row => row.SL).length };
    });
}

function analyzeRows(rows) {
    const features = [
        'HTF_4H_STATE', 'HTF_STATE_ALIGNED_WITH_TRADE', 'OPPOSING_HTF_STATE_PRESENT', 'HTF_STATE_STRENGTH_CONTEXT', '1H_BOS_PRESENT', '1H_MSS_PRESENT', '1H_DISPLACEMENT_PRESENT',
        '1H_EVENT_ALIGNED', '1H_CONTINUATION_EVENT', '15M_BOS_PRESENT', '15M_MSS_PRESENT',
        '15M_DISPLACEMENT_PRESENT', '15M_ORIGINATING_OB_PRESENT', '15M_OB_OVERLAPS_ENTRY',
        '15M_OB_FVG_OVERLAP', '15M_FVG_LINKED_TO_IMPULSE', 'LIQUIDITY_SWEEP_PRESENT',
        'SWEEP_ALIGNED_WITH_TRADE', 'FIRST_RETRACE', 'ZONE_ALREADY_TOUCHED', 'FVG_FIRST_TOUCH',
        'FVG_OVERLAPS_OB', 'DISPLACEMENT_ALIGNED', 'ENTRY_PREMIUM_DISCOUNT_ALIGNED',
        'CLEAR_PATH_TO_TP1', '5M_CONFIRMATION_ALIGNED', '5M_CONFIRMATION_LOCAL_TO_ENTRY', 'SESSION', 'QUALITY'
    ];
    const enriched = rows.map(row => ({ ...row, QUALITY: row.CURRENT_V2.quality || 'UNKNOWN' }));
    const interactions = [
        interaction(enriched, 'FIRST_RETRACE_AND_15M_BOS', row => row.FIRST_RETRACE === true && row['15M_BOS_PRESENT'] === true),
        interaction(enriched, 'OB_FVG_OVERLAP_AND_FIRST_RETRACE', row => row['15M_OB_FVG_OVERLAP'] === true && row.FIRST_RETRACE === true),
        interaction(enriched, 'HTF_ALIGNED_AND_CLEAR_PATH', row => row.HTF_STATE_ALIGNED_WITH_TRADE === true && row.CLEAR_PATH_TO_TP1 === 'YES'),
        interaction(enriched, '5M_CONFIRMATION_AND_FIRST_RETRACE', row => row['5M_CONFIRMATION_ALIGNED'] === true && row.FIRST_RETRACE === true),
        interaction(enriched, 'DISPLACEMENT_AND_OB_OVERLAP', row => row.DISPLACEMENT_ALIGNED === true && row['15M_OB_FVG_OVERLAP'] === true)
    ];
    const numericFeatures = ['HTF_STATE_AGE_BARS', '1H_EVENT_AGE', 'ZONE_AGE_BARS', 'FVG_WIDTH', 'FVG_WIDTH_ATR', 'DISPLACEMENT_RANGE', 'DISPLACEMENT_RANGE_ATR', 'DISPLACEMENT_BODY_RATIO', 'BARRIER_DISTANCE_R', '5M_CONFIRMATION_AGE'];
    const symbols = [...new Set(enriched.map(row => row.symbol))];
    const perSymbol = Object.fromEntries(symbols.map(symbol => [symbol, metric(enriched.filter(row => row.symbol === symbol))]));
    const bySymbolFeatures = Object.fromEntries(symbols.map(symbol => [symbol, reportFeatures(enriched.filter(row => row.symbol === symbol), features)]));
    const bySymbolRules = Object.fromEntries(symbols.map(symbol => [symbol, candidateRuleReports(enriched.filter(row => row.symbol === symbol))]));
    const ordered = [...enriched].sort((left, right) => left.decision_time_ms - right.decision_time_ms);
    const splitIndex = Math.max(1, Math.min(ordered.length - 1, Math.floor(ordered.length * 0.6)));
    const discovery = ordered.slice(0, splitIndex);
    const validation = ordered.slice(splitIndex);
    const ruleSet = candidateRuleReports(enriched);
    const validationRules = candidateRuleReports(validation);
    const leaveOneSymbolOut = Object.fromEntries(symbols.map(heldOut => {
        const train = enriched.filter(row => row.symbol !== heldOut);
        const heldOutRows = enriched.filter(row => row.symbol === heldOut);
        return [heldOut, { trained_on_other_symbols: candidateRuleReports(train), held_out: candidateRuleReports(heldOutRows) }];
    }));
    return {
        overall: metric(enriched), by_symbol: perSymbol, features: reportFeatures(enriched, features), numeric_features: Object.fromEntries(numericFeatures.map(feature => [feature, numericFeatureReport(enriched, feature)])), by_symbol_features: bySymbolFeatures,
        interactions, candidate_rules: ruleSet, by_symbol_candidate_rules: bySymbolRules,
        chronological_split: { discovery_count: discovery.length, validation_count: validation.length, discovery: metric(discovery), validation: metric(validation), validation_rules: validationRules },
        leave_one_symbol_out: leaveOneSymbolOut
    };
}

module.exports = { finite, outcomeFlags, sessionForHour, buildFeatureIndex, enrichTrade, metric, groupedFeatureReport, analyzeRows };
