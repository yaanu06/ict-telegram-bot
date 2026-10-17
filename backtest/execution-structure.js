'use strict';

const { TIMEFRAME_MS, canonicalTimeframe } = require('./data-provider');

function number(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function directionOf(value) {
    const direction = String(value?.direction || value || '').toUpperCase();
    return direction === 'BUY' || direction === 'SELL' ? direction : null;
}

function tfName(timeframe) {
    return String(timeframe || '').toUpperCase() === '15M' ? '15M' : String(timeframe || '').toUpperCase();
}

function closeTime(candle, timeframe) {
    const start = number(candle?.t ?? candle?.timestamp);
    const supplied = number(candle?.close_time_ms ?? candle?.close_time);
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    return supplied ?? (start != null && interval ? start + interval : null);
}

function normalizeCandles(candles = [], timeframe) {
    return (Array.isArray(candles) ? candles : [])
        .filter(candle => candle && candle.is_closed !== false && candle.closed !== false && candle.forming !== true)
        .map((candle, index) => ({
            ...candle,
            t: number(candle.t ?? candle.timestamp),
            o: number(candle.o ?? candle.open),
            h: number(candle.h ?? candle.high),
            l: number(candle.l ?? candle.low),
            c: number(candle.c ?? candle.close),
            source_index: index,
            close_time_ms: closeTime(candle, timeframe)
        }))
        .filter(candle => [candle.t, candle.o, candle.h, candle.l, candle.c, candle.close_time_ms].every(Number.isFinite))
        .sort((left, right) => left.t - right.t);
}

function eventTime(event, candles, timeframe) {
    const explicit = number(event?.first_knowable_ms ?? event?.firstKnowableMs);
    if (explicit != null) return explicit;
    const index = number(event?.index ?? event?.source_index ?? event?.formation_index);
    if (Number.isInteger(index) && candles[index]) return candles[index].close_time_ms;
    const parsed = Date.parse(event?.first_knowable_time ?? event?.confirmation_time ?? event?.event_time ?? '');
    return Number.isFinite(parsed) ? parsed : null;
}

function eventIndex(event) {
    const index = number(event?.index ?? event?.source_index ?? event?.formation_index);
    return Number.isInteger(index) ? index : null;
}

function buildFastStructureEvents({ context, candles, timeframe, symbol }) {
    if (!context || typeof context.findSwings !== 'function') return [];
    const tf = tfName(timeframe);
    const swings = context.findSwings(candles, 2) || { H: [], L: [] };
    const highs = [...(swings.H || [])].sort((left, right) => left.i - right.i);
    const lows = [...(swings.L || [])].sort((left, right) => left.i - right.i);
    const broken = new Set();
    const events = [];
    let highCursor = 0;
    let lowCursor = 0;
    for (let index = 0; index < candles.length; index += 1) {
        const candle = candles[index];
        while (highCursor < highs.length && highs[highCursor].i < index
            && (number(highs[highCursor].first_knowable_time) ?? Date.parse(highs[highCursor].first_knowable_time || '')) < candle.t) highCursor += 1;
        while (lowCursor < lows.length && lows[lowCursor].i < index
            && (number(lows[lowCursor].first_knowable_time) ?? Date.parse(lows[lowCursor].first_knowable_time || '')) < candle.t) lowCursor += 1;
        const knownHighs = highs.slice(0, highCursor).filter(item => item.i < index);
        const knownLows = lows.slice(0, lowCursor).filter(item => item.i < index);
        const latestHigh = knownHighs.at(-1);
        const latestLow = knownLows.at(-1);
        for (const [target, direction] of [[latestHigh, 'BUY'], [latestLow, 'SELL']]) {
            if (!target) continue;
            const targetId = `${direction === 'BUY' ? 'SWING_HIGH' : 'SWING_LOW'}:${tf}:${target.i}:${target.p}`;
            const broke = direction === 'BUY' ? candle.c > Number(target.p) : candle.c < Number(target.p);
            if (!broke || broken.has(targetId)) continue;
            const previousHigh = knownHighs.at(-2);
            const previousLow = knownLows.at(-2);
            const bullish = previousHigh && previousLow && Number(latestHigh.p) > Number(previousHigh.p) && Number(latestLow.p) > Number(previousLow.p);
            const bearish = previousHigh && previousLow && Number(latestHigh.p) < Number(previousHigh.p) && Number(latestLow.p) < Number(previousLow.p);
            const priorState = bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'MIXED';
            const type = priorState === (direction === 'BUY' ? 'BULLISH' : 'BEARISH') ? 'BOS' : 'MSS';
            const id = `${type}:${tf}:${index}:${direction}`;
            broken.add(targetId);
            events.push({
                structure_event_id: id,
                id,
                type,
                event_type: type,
                direction,
                timeframe: tf,
                index,
                level: Number(target.p),
                break_price: Number(candle.c),
                swing_ref: targetId,
                first_knowable_ms: candle.close_time_ms,
                first_knowable: new Date(candle.close_time_ms).toISOString(),
                event_time: new Date(candle.close_time_ms).toISOString(),
                prior_structural_state: priorState,
                evidence_ids: [id, targetId]
            });
        }
    }
    return events.sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.id.localeCompare(right.id));
}

function normalizeStructureEvents({ context, candles, timeframe, symbol }) {
    if (!context || typeof context.findSwings !== 'function') return [];
    const tf = tfName(timeframe);
    return buildFastStructureEvents({ context, candles, timeframe, symbol })
        .map(event => {
            const rawType = String(event.event_type || event.structure_event_type || '').toUpperCase();
            const type = rawType === 'CHOCH' ? 'MSS' : rawType;
            const index = eventIndex(event);
            const firstKnowable = eventTime(event, candles, timeframe);
            if (!['BOS', 'MSS'].includes(type) || !directionOf(event) || index == null || firstKnowable == null) return null;
            const id = event.id || `${type}:${tf}:${index}:${directionOf(event)}`;
            return {
                ...event,
                structure_event_id: id,
                id,
                type,
                direction: directionOf(event),
                timeframe: tf,
                index,
                break_price: number(event.level ?? event.broken_level),
                first_knowable_ms: firstKnowable,
                first_knowable: new Date(firstKnowable).toISOString(),
                swing_ref: event.broken_swing_id || null,
                evidence_ids: [...new Set([id, ...(event.evidence_ids || [])])]
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.id.localeCompare(right.id));
}

function normalizeDisplacements({ context, candles, timeframe, symbol, pair = symbol, symbolMetadata = {} }) {
    if (!context || typeof context.buildInstitutionalDisplacementFacts !== 'function') return [];
    const tf = tfName(timeframe);
    return (context.buildInstitutionalDisplacementFacts(candles, tf, pair, symbolMetadata) || [])
        .map(event => {
            const index = eventIndex(event);
            const direction = directionOf(event);
            const firstKnowable = eventTime(event, candles, timeframe);
            if (index == null || !direction || firstKnowable == null) return null;
            const id = `IMPULSE:${symbol}:${tf}:${index}:${direction}`;
            return {
                ...event,
                impulse_id: id,
                id: event.id || id,
                direction,
                timeframe: tf,
                index,
                first_knowable_ms: firstKnowable,
                first_knowable: new Date(firstKnowable).toISOString(),
                price_low: candles[index]?.l ?? null,
                price_high: candles[index]?.h ?? null
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.impulse_id.localeCompare(right.impulse_id));
}

function confirmedPriorSwings(context, candles, index) {
    if (!context || typeof context.findSwings !== 'function' || index < 5) return { H: [], L: [] };
    // The sweep candle is excluded. Therefore every pivot returned here was
    // confirmed before the sweep was knowable.
    return context.findSwings(candles.slice(0, index), 2) || { H: [], L: [] };
}

function buildLiquiditySweeps({ context, candles, timeframe, symbol }) {
    const tf = tfName(timeframe);
    const sweeps = [];
    const allSwings = context && typeof context.findSwings === 'function'
        ? (context.findSwings(candles, 2) || { H: [], L: [] }) : { H: [], L: [] };
    for (let index = 5; index < candles.length; index += 1) {
        const candle = candles[index];
        const knownBeforeSweep = item => {
            const known = number(item.first_knowable_time) ?? Date.parse(item.first_knowable_time || '');
            return item.i < index && (!Number.isFinite(known) || known <= candle.t);
        };
        const highs = (allSwings.H || []).filter(knownBeforeSweep).slice(-8);
        const lows = (allSwings.L || []).filter(knownBeforeSweep).slice(-8);
        const high = highs.filter(item => candle.h > Number(item.p) && candle.c < Number(item.p)).sort((a, b) => Number(b.p) - Number(a.p))[0];
        const low = lows.filter(item => candle.l < Number(item.p) && candle.c > Number(item.p)).sort((a, b) => Number(a.p) - Number(b.p))[0];
        for (const [liquidity, reactionDirection] of [[high, 'SELL'], [low, 'BUY']]) {
            if (!liquidity) continue;
            const side = reactionDirection === 'SELL' ? 'BUY_SIDE' : 'SELL_SIDE';
            const id = `SWEEP:${symbol}:${tf}:${side}:${liquidity.i}:${index}:${reactionDirection}`;
            sweeps.push({
                sweep_id: id,
                id,
                direction: reactionDirection,
                timeframe: tf,
                liquidity_ref: `SWING:${symbol}:${tf}:${side}:${liquidity.i}:${liquidity.p}`,
                liquidity_side: side,
                liquidity_price: Number(liquidity.p),
                sweep_price: reactionDirection === 'SELL' ? candle.h : candle.l,
                sweep_time: new Date(candle.t).toISOString(),
                reclaimed: true,
                index,
                first_knowable_ms: candle.close_time_ms,
                first_knowable: new Date(candle.close_time_ms).toISOString(),
                pivot_first_knowable_ms: Date.parse(liquidity.first_knowable_time),
                evidence_ids: [id, `SWING:${symbol}:${tf}:${side}:${liquidity.i}:${liquidity.p}`]
            });
        }
    }
    return sweeps;
}

function findDisplacementForStructure(structure, displacements, maxBars = 4) {
    return displacements
        .filter(item => item.direction === structure.direction && item.index >= structure.index && item.index <= structure.index + maxBars)
        .sort((left, right) => left.index - right.index || left.impulse_id.localeCompare(right.impulse_id))[0] || null;
}

function findOriginCandle(candles, displacementIndex, direction) {
    const opposite = direction === 'BUY' ? candle => candle.c < candle.o : candle => candle.c > candle.o;
    // A compact opposite candle sequence is allowed, but the selected origin
    // must be immediately adjacent to the displacement leg, with no unrelated
    // gap. This is deliberately causal rather than a retrospective zone scan.
    for (let index = displacementIndex - 1; index >= Math.max(0, displacementIndex - 3); index -= 1) {
        if (opposite(candles[index])) return { candle: candles[index], index };
        if (direction === 'BUY' && candles[index].c < candles[index].o) return { candle: candles[index], index };
        if (direction === 'SELL' && candles[index].c > candles[index].o) return { candle: candles[index], index };
    }
    return null;
}

function fvgCandidates({ fvgs = [], timeframe, direction, displacement }) {
    const wanted = direction === 'BUY' ? 'bull' : 'bear';
    return fvgs
        .map((fvg, index) => ({ fvg, index, source_index: eventIndex(fvg) }))
        .filter(item => item.fvg.type === wanted && item.source_index != null
            && item.source_index >= displacement.index && item.source_index <= displacement.index + 1)
        .sort((left, right) => left.source_index - right.source_index || left.index - right.index);
}

function buildExecutionSequences({ context, candles, timeframe, symbol, pair = symbol, symbolMetadata = {}, maxDisplacementBars = 4 }) {
    const tf = tfName(timeframe);
    const structures = normalizeStructureEvents({ context, candles, timeframe, symbol });
    const displacements = normalizeDisplacements({ context, candles, timeframe, symbol, pair, symbolMetadata });
    const sweeps = buildLiquiditySweeps({ context, candles, timeframe, symbol });
    const fvgs = context && typeof context.detectFVG === 'function' ? context.detectFVG(candles, pair, symbolMetadata) || [] : [];
    const sequences = [];
    for (const structure of structures) {
        const displacement = findDisplacementForStructure(structure, displacements, maxDisplacementBars);
        if (!displacement) continue;
        const sweep = sweeps.filter(item => item.direction === structure.direction && item.index < structure.index && structure.index - item.index <= 12)
            .sort((left, right) => right.index - left.index)[0] || null;
        const reversal = structure.type === 'MSS' && !!sweep;
        const continuation = structure.type === 'BOS';
        if (!reversal && !continuation) continue;
        const origin = findOriginCandle(candles, displacement.index, structure.direction);
        if (!origin) continue;
        const obId = `OB:${symbol}:${tf}:${structure.structure_event_id}:${displacement.impulse_id}:${origin.index}:${structure.direction}`;
        const fvg = fvgCandidates({ fvgs, timeframe, direction: structure.direction, displacement })[0] || null;
        const obLow = Number(origin.candle.l);
        const obHigh = Number(origin.candle.h);
        const fvgLow = fvg ? Number(fvg.fvg.l) : null;
        const fvgHigh = fvg ? Number(fvg.fvg.h) : null;
        const overlap = fvg && Math.max(obLow, fvgLow) < Math.min(obHigh, fvgHigh)
            ? { low: Math.max(obLow, fvgLow), high: Math.min(obHigh, fvgHigh) } : null;
        const firstKnowable = Math.max(structure.first_knowable_ms, displacement.first_knowable_ms, origin.candle.close_time_ms);
        const sequenceId = `EXECUTION:${symbol}:${tf}:${structure.structure_event_id}:${displacement.impulse_id}:${obId}`;
        sequences.push({
            sequence_id: sequenceId,
            setup_event_id: `SETUP_EVENT:${symbol}:${tf}:${obId}:${displacement.impulse_id}`,
            opportunity_id: `OPPORTUNITY:${symbol}:${tf}:${obId}:${displacement.impulse_id}`,
            setup_family: reversal ? 'REVERSAL' : 'CONTINUATION',
            direction: structure.direction,
            timeframe: tf,
            sweep: sweep ? { ...sweep } : null,
            structure_event: { ...structure },
            structure_event_id: structure.structure_event_id,
            bos_present: structure.type === 'BOS',
            mss_present: structure.type === 'MSS',
            displacement: { ...displacement },
            impulse_id: displacement.impulse_id,
            ob: {
                ob_id: obId,
                direction: structure.direction,
                timeframe: tf,
                zone_low: obLow,
                zone_high: obHigh,
                origin_candle_ref: `${tf}:${origin.index}:${origin.candle.t}`,
                origin_index: origin.index,
                parent_structure_event_id: structure.structure_event_id,
                parent_impulse_id: displacement.impulse_id,
                first_knowable_ms: firstKnowable,
                first_knowable: new Date(firstKnowable).toISOString(),
                status: 'FRESH',
                mitigation_count: 0,
                invalidated: false
            },
            fvg: fvg ? {
                ref: `FVG:${tf}:${fvg.fvg.type}:${fvg.source_index}:${fvg.fvg.l}:${fvg.fvg.h}`,
                low: fvgLow,
                high: fvgHigh,
                source_index: fvg.source_index
            } : null,
            refined_zone: overlap ? { low: overlap.low, high: overlap.high, type: 'OB_FVG_OVERLAP' } : null,
            first_knowable_ms: firstKnowable,
            first_knowable: new Date(firstKnowable).toISOString(),
            source_index: origin.index,
            retrace_number: 0,
            lineage: {
                sweep_id: sweep?.sweep_id || null,
                structure_event_id: structure.structure_event_id,
                impulse_id: displacement.impulse_id,
                ob_id: obId
            }
        });
    }
    return [...new Map(sequences.map(item => [item.sequence_id, item])).values()]
        .sort((left, right) => left.first_knowable_ms - right.first_knowable_ms || left.sequence_id.localeCompare(right.sequence_id));
}

function buildRetracementEvents({ sequences, candles }) {
    return sequences.map(sequence => {
        const zone = sequence.refined_zone || { low: sequence.ob.zone_low, high: sequence.ob.zone_high };
        const startIndex = Math.max(sequence.displacement.index ?? sequence.source_index, sequence.ob.origin_index) + 1;
        let touch = null;
        let retraceNumber = 0;
        let outside = false;
        for (let index = startIndex; index < candles.length; index += 1) {
            const candle = candles[index];
            const overlaps = candle.h >= zone.low && candle.l <= zone.high;
            if (!overlaps) { outside = true; continue; }
            if (!outside && retraceNumber === 0) continue;
            retraceNumber += 1;
            if (!touch) touch = { index, time_ms: candle.close_time_ms, time: new Date(candle.close_time_ms).toISOString() };
            break;
        }
        return { ...sequence, retracement: touch, retrace_number: retraceNumber, setup_zone_low: zone.low, setup_zone_high: zone.high };
    });
}

function buildExecutionPrimitives({ context, candles, timeframe = '15m', symbol, pair = symbol, symbolMetadata = {} } = {}) {
    const normalized = normalizeCandles(candles, timeframe);
    const sequences = buildExecutionSequences({ context, candles: normalized, timeframe, symbol, pair, symbolMetadata });
    const retracements = buildRetracementEvents({ sequences, candles: normalized });
    return { candles: normalized, structures: normalizeStructureEvents({ context, candles: normalized, timeframe, symbol }), displacements: normalizeDisplacements({ context, candles: normalized, timeframe, symbol, pair, symbolMetadata }), sweeps: buildLiquiditySweeps({ context, candles: normalized, timeframe, symbol }), sequences, retracements };
}

module.exports = {
    normalizeCandles,
    eventTime,
    buildFastStructureEvents,
    normalizeStructureEvents,
    normalizeDisplacements,
    buildLiquiditySweeps,
    buildExecutionSequences,
    buildRetracementEvents,
    buildExecutionPrimitives
};
