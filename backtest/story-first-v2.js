'use strict';

/*
 * Non-authoritative, story-first V2 research engine.
 *
 * This module deliberately does not modify the production V2 selector.  It
 * constructs opportunities from events in causal order and is used only by
 * the research CLI.  The important distinction from the old overlay is that
 * an FVG/OB is an output of a confirmed sequence, never the input used to
 * search backwards for a story.
 */

const { simulateCandidate, validateCandidateDirection } = require('./replay');

const TF_MS = Object.freeze({ '5M': 300000, '15M': 900000, '1H': 3600000, '4H': 14400000, '1D': 86400000 });
const MAX_STORY_BARS = 32;
const MAX_RETRACE_BARS = 48;

function number(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function upper(value) { return String(value || '').toUpperCase(); }

function directionOf(value) {
    const direction = upper(value?.direction || value);
    return direction === 'BUY' || direction === 'SELL' ? direction : null;
}

function candleClose(candle, timeframe) {
    const start = number(candle?.t ?? candle?.timestamp);
    return number(candle?.close_time_ms ?? candle?.close_time)
        ?? (start == null ? null : start + TF_MS[upper(timeframe)]);
}

function normalizedCandles(candles, timeframe) {
    return (candles || []).map((candle, index) => ({
        ...candle,
        t: number(candle.t ?? candle.timestamp),
        o: number(candle.o ?? candle.open),
        h: number(candle.h ?? candle.high),
        l: number(candle.l ?? candle.low),
        c: number(candle.c ?? candle.close),
        source_index: index,
        close_time_ms: candleClose(candle, timeframe)
    })).filter(candle => [candle.t, candle.o, candle.h, candle.l, candle.c, candle.close_time_ms].every(Number.isFinite));
}

function firstAtOrBefore(candles, timestamp) {
    let low = 0;
    let high = candles.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (candles[middle].close_time_ms <= timestamp) low = middle + 1;
        else high = middle;
    }
    return low - 1;
}

function firstAtOrAfter(candles, timestamp) {
    let low = 0;
    let high = candles.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (candles[middle].close_time_ms < timestamp) low = middle + 1;
        else high = middle;
    }
    return low;
}

function eventTime(event) {
    const explicit = number(event?.first_knowable_ms ?? event?.firstKnowableMs);
    if (explicit != null) return explicit;
    for (const value of [event?.first_knowable_time, event?.confirmation_time, event?.reclaim_time, event?.event_time, event?.sweep_time]) {
        const parsed = Date.parse(value || '');
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function eventIndex(event) {
    const value = number(event?.index ?? event?.source_index ?? event?.formation_index ?? event?.reclaim_bar_index ?? event?.sweep_bar_index);
    return Number.isInteger(value) ? value : null;
}

function eventId(prefix, symbol, event, fallback) {
    return event?.id || event?.ref || event?.structure_event_id || event?.sweep_id || event?.impulse_id
        || `${prefix}:${symbol}:${fallback}`;
}

function pipSize(context, symbol, price) {
    const settings = typeof context?.getMarketSettings === 'function' ? context.getMarketSettings(symbol, {}) : null;
    const value = number(settings?.pipSize ?? settings?.pip_size);
    if (value != null) return value;
    return /XAU|XAG/i.test(symbol) ? (number(price) > 100 ? 0.01 : 0.0001) : /JPY/i.test(symbol) ? 0.01 : 0.0001;
}

function timeframePrefix(series, asOfMs) {
    const result = {};
    for (const [tf, candles] of Object.entries(series || {})) {
        const normalized = normalizedCandles(candles, tf);
        const index = firstAtOrBefore(normalized, asOfMs);
        result[tf] = index < 0 ? [] : normalized.slice(0, index + 1);
    }
    return result;
}

function structureTrend(context, candles) {
    if (!candles || candles.length < 20 || typeof context?.findSwings !== 'function') return 'NEUTRAL';
    const swings = context.findSwings(candles, 3) || { H: [], L: [] };
    const highs = (swings.H || []).slice(-2);
    const lows = (swings.L || []).slice(-2);
    if (highs.length < 2 || lows.length < 2) return 'NEUTRAL';
    if (number(highs[1].p) > number(highs[0].p) && number(lows[1].p) > number(lows[0].p)) return 'BUY';
    if (number(highs[1].p) < number(highs[0].p) && number(lows[1].p) < number(lows[0].p)) return 'SELL';
    return 'NEUTRAL';
}

function buildContextAt(context, series, asOfMs, cache) {
    const oneDayIndex = firstAtOrBefore(series['1d'], asOfMs);
    const fourHourIndex = firstAtOrBefore(series['4h'], asOfMs);
    const oneHourIndex = firstAtOrBefore(series['1h'], asOfMs);
    const key = `${oneDayIndex}:${fourHourIndex}:${oneHourIndex}`;
    if (cache.has(key)) return cache.get(key);
    const daily = oneDayIndex >= 0 ? series['1d'].slice(0, oneDayIndex + 1) : [];
    const fourHour = fourHourIndex >= 0 ? series['4h'].slice(0, fourHourIndex + 1) : [];
    const oneHour = oneHourIndex >= 0 ? series['1h'].slice(0, oneHourIndex + 1) : [];
    const dailyDirection = structureTrend(context, daily);
    const fourHourDirection = structureTrend(context, fourHour);
    const oneHourDirection = structureTrend(context, oneHour);
    const contextDirection = fourHourDirection !== 'NEUTRAL' ? fourHourDirection
        : dailyDirection !== 'NEUTRAL' ? dailyDirection : oneHourDirection;
    const value = {
        context_direction: contextDirection,
        daily_direction: dailyDirection,
        four_hour_direction: fourHourDirection,
        one_hour_direction: oneHourDirection,
        reversal_location: null,
        evidence_refs: []
    };
    cache.set(key, value);
    return value;
}

function knownSwings(context, candles, asOfMs, timeframe, symbol) {
    if (!candles || candles.length < 10 || typeof context?.findSwings !== 'function') return [];
    const swings = context.findSwings(candles, 2) || { H: [], L: [] };
    return [
        ...(swings.H || []).map(item => ({ item, side: 'BUY_SIDE', direction: 'SELL', type: 'SWING_HIGH' })),
        ...(swings.L || []).map(item => ({ item, side: 'SELL_SIDE', direction: 'BUY', type: 'SWING_LOW' }))
    ].filter(record => {
        const pivotTime = number(record.item.first_knowable_time) ?? Date.parse(record.item.first_knowable_time || '');
        return Number.isFinite(number(record.item.p)) && record.item.i < candles.length && (!Number.isFinite(pivotTime) || pivotTime <= asOfMs);
    }).map(record => {
        const pivot = record.item;
        const pivotTime = number(pivot.first_knowable_time) ?? Date.parse(pivot.first_knowable_time || '') ?? candles[pivot.i]?.close_time_ms;
        return {
            liquidity_id: `LIQ:${symbol}:${timeframe}:${record.type}:${pivot.i}:${pivot.p}`,
            type: record.type,
            directional_role: record.side,
            direction: record.direction,
            price: number(pivot.p),
            timestamp: candles[pivot.i]?.t ?? null,
            first_knowable_ms: Number.isFinite(pivotTime) ? pivotTime : candles[pivot.i]?.close_time_ms,
            timeframe,
            status: 'AVAILABLE',
            source_index: pivot.i
        };
    });
}

function previousDayPools(series, asOfMs, symbol) {
    const daily = series['1d'];
    const index = firstAtOrBefore(daily, asOfMs);
    if (index <= 0) return [];
    const previous = daily[index - 1];
    return [
        { liquidity_id: `LIQ:${symbol}:1D:PDH:${previous.t}`, type: 'PDH', directional_role: 'BUY_SIDE', direction: 'SELL', price: previous.h, timestamp: previous.t, first_knowable_ms: previous.close_time_ms, timeframe: '1D', status: 'AVAILABLE' },
        { liquidity_id: `LIQ:${symbol}:1D:PDL:${previous.t}`, type: 'PDL', directional_role: 'SELL_SIDE', direction: 'BUY', price: previous.l, timestamp: previous.t, first_knowable_ms: previous.close_time_ms, timeframe: '1D', status: 'AVAILABLE' }
    ];
}

function sessionPools(candles, asOfMs, symbol) {
    const dayStart = new Date(asOfMs);
    dayStart.setUTCHours(0, 0, 0, 0);
    const visible = candles.filter(candle => candle.t >= dayStart.getTime() && candle.close_time_ms <= asOfMs);
    if (!visible.length) return [];
    const high = Math.max(...visible.map(candle => candle.h));
    const low = Math.min(...visible.map(candle => candle.l));
    return [
        { liquidity_id: `LIQ:${symbol}:5M:SESSION_HIGH:${dayStart.getTime()}`, type: 'SESSION_HIGH', directional_role: 'BUY_SIDE', direction: 'SELL', price: high, timestamp: visible[0].t, first_knowable_ms: visible.at(-1).close_time_ms, timeframe: '5M', status: 'AVAILABLE' },
        { liquidity_id: `LIQ:${symbol}:5M:SESSION_LOW:${dayStart.getTime()}`, type: 'SESSION_LOW', directional_role: 'SELL_SIDE', direction: 'BUY', price: low, timestamp: visible[0].t, first_knowable_ms: visible.at(-1).close_time_ms, timeframe: '5M', status: 'AVAILABLE' }
    ];
}

function buildLiquidityEvents({ context, series, symbol, pip }) {
    const candles = normalizedCandles(series['15m'], '15M');
    const pools = [
        ...knownSwings(context, candles, Infinity, '15M', symbol),
        ...knownSwings(context, normalizedCandles(series['1h'], '1H'), Infinity, '1H', symbol),
        ...knownSwings(context, normalizedCandles(series['4h'], '4H'), Infinity, '4H', symbol)
    ];
    const events = [];
    for (const pool of pools) {
        const sourceTime = number(pool.first_knowable_ms) || 0;
        const firstCandidate = candles.findIndex(candle => candle.close_time_ms > sourceTime);
        if (firstCandidate < 0) continue;
        const start = Math.max(0, firstCandidate);
        for (let index = start; index < candles.length; index += 1) {
            const candle = candles[index];
            if (candle.close_time_ms <= pool.first_knowable_ms) continue;
            const swept = pool.direction === 'SELL'
                ? candle.h > pool.price && candle.c < pool.price
                : candle.l < pool.price && candle.c > pool.price;
            if (!swept) continue;
            const reclaim = pool.direction === 'SELL'
                ? candle.c < pool.price
                : candle.c > pool.price;
            if (!reclaim) continue;
            events.push({
                liquidity_event_id: `LIQ_EVENT:${symbol}:${pool.liquidity_id}:${index}:${pool.direction}`,
                liquidity_ref: pool.liquidity_id,
                source: pool.type,
                direction: pool.direction,
                sweep_time_ms: candle.close_time_ms,
                reclaim_time_ms: candle.close_time_ms,
                first_knowable_ms: candle.close_time_ms,
                sweep_price: pool.direction === 'SELL' ? candle.h : candle.l,
                reference_price: pool.price,
                index,
                timeframe: '15M',
                reclaimed: true,
                status: 'RECLAIMED'
            });
            break;
        }
    }
    // The pool detector above intentionally uses closed-candle reclaim. CRT and
    // TBS detectors are added separately, so a CRT/TBS event can itself be the
    // liquidity source instead of requiring a second sweep.
    return events;
}

function detectCausalCrtTbs(context, candles, timeframe, symbol) {
    const result = { crt: [], tbs: [] };
    const tf = upper(timeframe);
    if (candles.length < 20) return result;
    for (let refIndex = 0; refIndex < candles.length - 3; refIndex += 1) {
        const reference = candles[refIndex];
        const rangeHigh = reference.h;
        const rangeLow = reference.l;
        for (let sweepIndex = refIndex + 1; sweepIndex <= Math.min(candles.length - 1, refIndex + 5); sweepIndex += 1) {
            const sweep = candles[sweepIndex];
            const sides = [
                { direction: 'BUY', taken: sweep.l < rangeLow, reclaim: candle => candle.c > rangeLow, extreme: sweep.l, role: 'SELL_SIDE' },
                { direction: 'SELL', taken: sweep.h > rangeHigh, reclaim: candle => candle.c < rangeHigh, extreme: sweep.h, role: 'BUY_SIDE' }
            ];
            for (const side of sides.filter(item => item.taken)) {
                const reclaimIndex = candles.slice(sweepIndex, Math.min(candles.length, sweepIndex + 5)).findIndex(side.reclaim);
                if (reclaimIndex < 0) continue;
                const actualReclaimIndex = sweepIndex + reclaimIndex;
                const id = `CRT:${symbol}:${tf}:${refIndex}:${sweepIndex}:${actualReclaimIndex}:${side.direction}`;
                result.crt.push({
                    crt_id: id, id, direction: side.direction, timeframe: tf,
                    c1_ref: `${tf}:${refIndex}:${reference.t}`, c2_ref: `${tf}:${sweepIndex}:${sweep.t}`, c3_ref: `${tf}:${actualReclaimIndex}:${candles[actualReclaimIndex].t}`,
                    range_low: rangeLow, range_high: rangeHigh, swept_side: side.role,
                    sweep_price: side.extreme, sweep_time_ms: candles[sweepIndex].close_time_ms,
                    reclaimed: true, confirmation_timestamp: candles[actualReclaimIndex].close_time_ms,
                    first_knowable_ms: candles[actualReclaimIndex].close_time_ms, status: 'CONFIRMED',
                    liquidity_source: 'CRT', source_index: actualReclaimIndex,
                    objective_price: side.direction === 'BUY' ? rangeHigh : rangeLow,
                    evidence_ids: [id]
                });
                result.tbs.push({
                    tbs_id: `TBS:${symbol}:${tf}:${refIndex}:${sweepIndex}:${actualReclaimIndex}:${side.direction}`,
                    id: `TBS:${symbol}:${tf}:${refIndex}:${sweepIndex}:${actualReclaimIndex}:${side.direction}`,
                    direction: side.direction, timeframe: tf, liquidity_ref: `${tf}:RANGE:${refIndex}:${side.role}`,
                    reference_price: side.direction === 'BUY' ? rangeLow : rangeHigh,
                    sweep_timestamp: candles[sweepIndex].close_time_ms, sweep_extreme: side.extreme,
                    reclaim_timestamp: candles[actualReclaimIndex].close_time_ms, confirmation_timestamp: candles[actualReclaimIndex].close_time_ms,
                    first_knowable_ms: candles[actualReclaimIndex].close_time_ms, status: 'CONFIRMED',
                    liquidity_source: 'TBS', source_index: actualReclaimIndex, evidence_ids: [id]
                });
            }
        }
    }
    return result;
}

function msnrLocations(context, series, asOfMs, symbol, cache = new Map()) {
    const locations = [];
    // MSNR is used as HTF/location evidence in this research path.  Keeping
    // the cache keyed to closed 4H/1H bars prevents recalculating the same
    // structural levels at every 15M sequence.
    const indices = ['4h', '1h'].map(key => firstAtOrBefore(normalizedCandles(series[key], key.toUpperCase()), asOfMs));
    const cacheKey = `${indices.join(':')}:${symbol}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    for (const [tf, key] of [['4H', '4h'], ['1H', '1h']]) {
        const candles = normalizedCandles(series[key], tf);
        const index = firstAtOrBefore(candles, asOfMs);
        if (index < 20 || typeof context.calculateMSNR !== 'function') continue;
        const visible = candles.slice(0, index + 1);
        const price = visible.at(-1)?.c;
        const levels = context.calculateMSNR(visible, price, tf, symbol, {}).structural_levels || [];
        for (const level of levels) {
            const low = number(level.zone_low); const high = number(level.zone_high);
            if (low == null || high == null || level.invalidated) continue;
            const levelDirection = directionOf(level);
            if (!levelDirection) continue;
            locations.push({
                msnr_id: `MSNR:${symbol}:${tf}:${level.source_candle_index ?? level.source_index ?? 'NA'}:${levelDirection}:${low}:${high}`,
                direction: levelDirection, timeframe: tf, zone_low: Math.min(low, high), zone_high: Math.max(low, high),
                first_knowable_ms: eventTime(level) ?? visible.at(-1).close_time_ms,
                freshness: String(level.freshness || 'FRESH').toUpperCase(),
                touch_count: number(level.mitigation_count) ?? 0,
                source_ref: level.origin || level.ref || null,
                status: level.invalidated ? 'INVALIDATED' : 'AVAILABLE'
            });
        }
    }
    cache.set(cacheKey, locations);
    return locations;
}

function overlap(a, b) {
    return a && b && number(a.high) >= number(b.low) && number(a.low) <= number(b.high);
}

function sequenceDisplacementTime(sequence) {
    return number(sequence?.displacement?.first_knowable_ms ?? sequence?.displacement?.event_time)
        ?? number(sequence?.first_knowable_ms);
}

function zoneOf(sequence) {
    const zone = sequence?.refined_zone || sequence?.ob;
    if (!zone) return null;
    const low = number(zone.low ?? zone.zone_low);
    const high = number(zone.high ?? zone.zone_high);
    if (low == null || high == null) return null;
    return { low: Math.min(low, high), high: Math.max(low, high), type: sequence.refined_zone ? 'OB+FVG' : 'OB' };
}

function lightDisplacements(context, candles, timeframe, symbol) {
    const events = [];
    for (let index = 9; index < candles.length; index += 1) {
        const current = candles[index];
        const prior = candles.slice(index - 9, index + 1);
        const averageBody = prior.reduce((sum, item) => sum + Math.abs(item.c - item.o), 0) / prior.length;
        if (!(averageBody > 0)) continue;
        const body = Math.abs(current.c - current.o);
        const direction = current.c > current.o ? 'BUY' : current.c < current.o ? 'SELL' : null;
        if (!direction || body < averageBody * 2.5) continue;
        const id = `IMPULSE:${symbol}:${upper(timeframe)}:${index}:${direction}`;
        events.push({ impulse_id: id, id, direction, timeframe: upper(timeframe), index, first_knowable_ms: current.close_time_ms, event_time: current.close_time_ms, body_ratio: body / averageBody, range: current.h - current.l });
    }
    return events;
}

function lightStructureEvents(context, candles, timeframe, symbol) {
    if (typeof context?.findSwings !== 'function') return [];
    const tf = upper(timeframe);
    const swings = context.findSwings(candles, 2) || { H: [], L: [] };
    const highs = (swings.H || []).slice().sort((a, b) => a.i - b.i);
    const lows = (swings.L || []).slice().sort((a, b) => a.i - b.i);
    const events = []; const broken = new Set(); let highCursor = 0; let lowCursor = 0; const knownHighs = []; const knownLows = [];
    for (let index = 0; index < candles.length; index += 1) {
        const candle = candles[index];
        while (highCursor < highs.length && highs[highCursor].i < index) {
            const pivot = highs[highCursor];
            const pivotTime = number(pivot.first_knowable_time) ?? Date.parse(pivot.first_knowable_time || '');
            if (Number.isFinite(pivotTime) && pivotTime > candle.close_time_ms) break;
            knownHighs.push(pivot); highCursor += 1;
        }
        while (lowCursor < lows.length && lows[lowCursor].i < index) {
            const pivot = lows[lowCursor];
            const pivotTime = number(pivot.first_knowable_time) ?? Date.parse(pivot.first_knowable_time || '');
            if (Number.isFinite(pivotTime) && pivotTime > candle.close_time_ms) break;
            knownLows.push(pivot); lowCursor += 1;
        }
        const latestHigh = knownHighs.at(-1); const latestLow = knownLows.at(-1);
        for (const [pivot, direction] of [[latestHigh, 'BUY'], [latestLow, 'SELL']]) {
            if (!pivot || (direction === 'BUY' ? candle.c <= pivot.p : candle.c >= pivot.p)) continue;
            const key = `${direction}:${pivot.i}:${pivot.p}`;
            if (broken.has(key)) continue;
            broken.add(key);
            const previousHigh = knownHighs.at(-2); const previousLow = knownLows.at(-2);
            const bullish = previousHigh && previousLow && number(latestHigh.p) > number(previousHigh.p) && number(latestLow.p) > number(previousLow.p);
            const bearish = previousHigh && previousLow && number(latestHigh.p) < number(previousHigh.p) && number(latestLow.p) < number(previousLow.p);
            const prior = bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'MIXED';
            const type = prior === (direction === 'BUY' ? 'BULLISH' : 'BEARISH') ? 'BOS' : 'MSS';
            const id = `${type}:${tf}:${index}:${direction}`;
            events.push({ id, structure_event_id: id, type, event_type: type, direction, timeframe: tf, index, level: number(pivot.p), break_price: candle.c, swing_ref: `${direction}:${pivot.i}:${pivot.p}`, first_knowable_ms: candle.close_time_ms, event_time: candle.close_time_ms, prior_structural_state: prior });
        }
    }
    return events;
}

function lightFvgs(context, candles, symbol, timeframe) {
    const settings = typeof context?.getMarketSettings === 'function' ? context.getMarketSettings(symbol, {}) : {};
    const pip = number(settings?.pipSize) ?? (/XAU/i.test(symbol) ? 0.01 : /JPY/i.test(symbol) ? 0.01 : 0.0001);
    const ranges = candles.map((candle, index) => index === 0 ? 0 : Math.max(candle.h - candle.l, Math.abs(candle.h - candles[index - 1].c), Math.abs(candle.l - candles[index - 1].c)));
    const result = [];
    for (let index = 1; index < candles.length - 1; index += 1) {
        const previous = candles[index - 1]; const next = candles[index + 1];
        const atr = ranges.slice(Math.max(0, index + 1 - 14), index + 1).reduce((sum, value) => sum + value, 0) / 14;
        const threshold = Math.max(pip, atr * 0.02, Math.abs(candles[index].c) * 0.00005);
        if (previous.h < next.l && next.l - previous.h > threshold) result.push({ type: 'bull', l: previous.h, h: next.l, source_index: index + 1 });
        if (previous.l > next.h && previous.l - next.h > threshold) result.push({ type: 'bear', l: next.h, h: previous.l, source_index: index + 1 });
    }
    return result;
}

function lightSequences({ context, candles, timeframe, symbol }) {
    const tf = upper(timeframe);
    const structures = lightStructureEvents(context, candles, tf, symbol)
        .filter(event => ['BOS', 'MSS'].includes(event.type));
    const displacements = lightDisplacements(context, candles, tf, symbol);
    const fvgs = lightFvgs(context, candles, symbol, tf);
    const sequences = [];
    for (const structure of structures) {
        const displacement = displacements.find(item => item.direction === structure.direction && item.index >= structure.index && item.index <= structure.index + 4);
        if (!displacement) continue;
        let origin = null;
        for (let index = displacement.index - 1; index >= Math.max(0, displacement.index - 3); index -= 1) {
            const candle = candles[index];
            const opposite = structure.direction === 'BUY' ? candle.c < candle.o : candle.c > candle.o;
            if (opposite) { origin = { index, candle }; break; }
        }
        if (!origin) continue;
        const fvg = fvgs.find(item => item.source_index >= displacement.index && item.source_index <= displacement.index + 1
            && ((structure.direction === 'BUY' && String(item.type).toLowerCase() === 'bull') || (structure.direction === 'SELL' && String(item.type).toLowerCase() === 'bear')));
        const ob = { ob_id: `OB:${symbol}:${tf}:${structure.id}:${displacement.impulse_id}:${origin.index}:${structure.direction}`, direction: structure.direction, zone_low: origin.candle.l, zone_high: origin.candle.h, origin_index: origin.index, first_knowable_ms: Math.max(structure.first_knowable_ms, displacement.first_knowable_ms), parent_structure_event_id: structure.id, parent_impulse_id: displacement.impulse_id };
        const overlapZone = fvg ? { low: Math.max(ob.zone_low, number(fvg.l)), high: Math.min(ob.zone_high, number(fvg.h)) } : null;
        const refined = overlapZone && overlapZone.low < overlapZone.high ? overlapZone : null;
        sequences.push({
            sequence_id: `EXECUTION:${symbol}:${tf}:${structure.id}:${displacement.impulse_id}:${ob.ob_id}`,
            setup_event_id: `SETUP_EVENT:${symbol}:${tf}:${ob.ob_id}`,
            direction: structure.direction, timeframe: tf, structure_event: structure,
            structure_event_id: structure.id, displacement, impulse_id: displacement.impulse_id,
            ob, fvg: fvg ? { low: number(fvg.l), high: number(fvg.h), ref: `FVG:${tf}:${fvg.source_index}:${fvg.type}` } : null,
            refined_zone: refined, source_index: origin.index, first_knowable_ms: ob.first_knowable_ms
        });
    }
    return { structures, displacements, sequences };
}

function firstRetrace(candles, zone, startIndex) {
    let leftZone = false;
    let bars = 0;
    for (let index = Math.max(0, startIndex + 1); index < Math.min(candles.length, startIndex + 1 + MAX_RETRACE_BARS); index += 1) {
        bars += 1;
        const candle = candles[index];
        const inside = candle.h >= zone.low && candle.l <= zone.high;
        if (!inside) { leftZone = true; continue; }
        if (!leftZone) continue;
        return { index, time_ms: candle.close_time_ms, retrace_number: 1, bars_after_zone: bars };
    }
    return null;
}

function localConfirmation(primitives, candles, zone, direction, touchTime) {
    const events = (primitives.structures || []).filter(event => event.direction === direction && event.first_knowable_ms >= touchTime);
    const displacement = (primitives.displacements || []).filter(event => event.direction === direction && event.first_knowable_ms >= touchTime);
    const candidates = [...events, ...displacement].sort((a, b) => eventTime(a) - eventTime(b));
    for (const event of candidates) {
        const index = eventIndex(event);
        if (index == null || !candles[index]) continue;
        const nearby = candles.slice(Math.max(0, index - 2), index + 1);
        const spatial = nearby.some(candle => candle.h >= zone.low && candle.l <= zone.high);
        if (!spatial) continue;
        return {
            confirmation_id: `5M_CONFIRM:${event.id || event.impulse_id}`,
            type: event.type || 'DISPLACEMENT', ref: event.id || event.impulse_id,
            first_knowable_ms: eventTime(event), age_bars: 0, local: true
        };
    }
    return null;
}

function targetFor({ context, direction, entry, series, asOfMs, symbol }) {
    const candidates = [];
    for (const [tf, key] of [['4H', '4h'], ['1H', '1h'], ['1D', '1d']]) {
        const candles = normalizedCandles(series[key], tf);
        const index = firstAtOrBefore(candles, asOfMs);
        if (index < 0) continue;
        const visible = candles.slice(0, index + 1);
        const swings = knownSwings(context, visible, asOfMs, tf, symbol)
            .filter(item => item.direction === direction && ((direction === 'BUY' && item.price > entry) || (direction === 'SELL' && item.price < entry)));
        for (const swing of swings.slice(-5)) candidates.push({ level: swing.price, tf, ref: swing.liquidity_id });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.level - entry) - Math.abs(b.level - entry));
    const selected = candidates[0];
    return {
        objective_id: `DOL:${symbol}:${selected.tf}:${selected.level}:${direction}`,
        objective_ref: selected.ref || selected.tf,
        objective_type: 'STRUCTURAL_LIQUIDITY',
        objective_price: selected.level,
        timeframe: selected.tf,
        first_knowable_ms: asOfMs,
        status: 'ACTIVE'
    };
}

function sessionContext(timestamp, candles) {
    const parts = (zone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    const london = parts('Europe/London'); const ny = parts('America/New_York');
    const lh = Number(london.hour) + Number(london.minute) / 60; const nh = Number(ny.hour) + Number(ny.minute) / 60;
    let session = 'OTHER';
    if (lh >= 0 && lh < 8) session = 'ASIA';
    if (lh >= 8 && lh < 13) session = 'LONDON';
    if (nh >= 8 && nh < 17) session = session === 'LONDON' ? 'LONDON_NEW_YORK_OVERLAP' : 'NEW_YORK';
    return { session, killzone_active: (lh >= 7 && lh < 10) || (nh >= 8.5 && nh < 11) || (nh >= 13.5 && nh < 16), london_hour: lh, new_york_hour: nh, day_of_week: london.weekday, source: 'DST_AWARE_IANA' };
}

function auditV2Rows(rows = [], storyResult = {}) {
    const sequences = storyResult.events?.sequences || [];
    const events = storyResult.events?.liquidities || [];
    const audited = rows.map(row => {
        const decisionTime = number(row.first_selected_at_ms ?? row.first_knowable_ms);
        const direction = directionOf(row.side);
        const zone = number(row.fvg_zone_low) != null && number(row.fvg_zone_high) != null
            ? { low: Math.min(number(row.fvg_zone_low), number(row.fvg_zone_high)), high: Math.max(number(row.fvg_zone_low), number(row.fvg_zone_high)) } : null;
        const priorSequences = sequences.filter(sequence => sequence.direction === direction && sequence.first_knowable_ms <= decisionTime && decisionTime - sequence.first_knowable_ms <= MAX_STORY_BARS * TF_MS['15M'] && (!zone || overlap(zone, zoneOf(sequence))));
        const priorLiquidity = events.filter(event => directionOf(event) === direction && eventTime(event) <= decisionTime && decisionTime - eventTime(event) <= MAX_STORY_BARS * TF_MS['15M']);
        const classification = priorSequences.length && priorLiquidity.length ? 'STORY_SEQUENCE_PRESENT' : priorSequences.length ? 'NO_LIQUIDITY_EVENT' : 'NO_PRIOR_15M_SEQUENCE';
        return { candidate_id: row.candidate_id, decision_time_ms: decisionTime, direction, outcome: row.simulation?.final_outcome || null, classification, sequence_refs: priorSequences.slice(-3).map(sequence => sequence.sequence_id), liquidity_refs: priorLiquidity.slice(-3).map(event => event.liquidity_event_id || event.id) };
    });
    return {
        rows: audited.length,
        story_sequence_present: audited.filter(row => row.classification === 'STORY_SEQUENCE_PRESENT').length,
        no_liquidity_event: audited.filter(row => row.classification === 'NO_LIQUIDITY_EVENT').length,
        no_prior_15m_sequence: audited.filter(row => row.classification === 'NO_PRIOR_15M_SEQUENCE').length,
        winners_with_story: audited.filter(row => row.classification === 'STORY_SEQUENCE_PRESENT' && row.outcome !== 'SL').length,
        losers_with_story: audited.filter(row => row.classification === 'STORY_SEQUENCE_PRESENT' && row.outcome === 'SL').length,
        examples: audited.slice(0, 10)
    };
}

function makeCounters() {
    return Object.fromEntries(['replay_points', 'story_sequences_evaluated', 'contexts', 'locations', 'liquidity_pools_active', 'sweeps', 'reclaims', 'crt_confirmed', 'tbs_confirmed', 'msnr_reactions', 'confirmations', 'displacements', 'entry_zones', 'first_retracements', 'confirmations_5m', 'path_valid', 'final_candidates', 'selected', 'filled', 'sl'].map(key => [key, 0]));
}

function makeTrace(event, stage, extra = {}) {
    return { timestamp: event?.timestamp || event?.first_knowable_ms || null, stage, ...extra };
}

function buildStoryFirstOpportunities({ context, series, symbol, from, to, precision = 5, maxTracesPerBucket = 5 } = {}) {
    const debug = process.env.STORY_FIRST_DEBUG === '1';
    const mark = (label) => { if (debug) console.error(`[story-first-debug] ${symbol} ${label}`); };
    const normalized = Object.fromEntries(Object.entries(series || {}).map(([tf, candles]) => [tf, normalizedCandles(candles, tf)]));
    const fromMs = Date.parse(from); const toMs = Date.parse(to);
    const bars15 = normalized['15m'] || []; const bars5 = normalized['5m'] || [];
    const pip = pipSize(context, symbol, bars15.at(-1)?.c);
    // The local helpers retain the canonical swing/BOS and ten-candle
    // displacement definitions while avoiding the old research helper's
    // repeated full-array displacement scans on every 5M history.
    const primitives15 = lightSequences({ context, candles: bars15, timeframe: '15M', symbol });
    const primitives5 = lightSequences({ context, candles: bars5, timeframe: '5M', symbol });
    mark(`primitives 15m=${primitives15.sequences.length} 5m=${primitives5.structures.length}`);
    const liquidities = buildLiquidityEvents({ context, series: normalized, symbol, pip });
    const crtTbs15 = detectCausalCrtTbs(context, bars15, '15M', symbol);
    const crtTbs1h = detectCausalCrtTbs(context, normalized['1h'] || [], '1H', symbol);
    const allStoryEvents = [
        ...liquidities,
        ...crtTbs15.crt.map(event => ({ ...event, liquidity_event_id: event.crt_id, liquidity_source: 'CRT' })),
        ...crtTbs15.tbs.map(event => ({ ...event, liquidity_event_id: event.tbs_id, liquidity_source: 'TBS' })),
        ...crtTbs1h.crt.map(event => ({ ...event, liquidity_event_id: event.crt_id, liquidity_source: 'CRT' })),
        ...crtTbs1h.tbs.map(event => ({ ...event, liquidity_event_id: event.tbs_id, liquidity_source: 'TBS' }))
    ].filter(event => eventTime(event) != null).sort((a, b) => eventTime(a) - eventTime(b));
    mark(`events ${allStoryEvents.length}`);
    const structureSequences = (primitives15.sequences || []).filter(sequence => sequence.structure_event?.type === 'BOS' && sequence.first_knowable_ms >= fromMs - TF_MS['15M'] * 8 && sequence.first_knowable_ms <= toMs);
    mark(`sequences ${structureSequences.length}`);
    const contextCache = new Map();
    const msnrCache = new Map();
    const counters = makeCounters();
    counters.replay_points = bars5.filter(candle => candle.close_time_ms >= fromMs && candle.close_time_ms <= toMs).length;
    const traces = {};
    const opportunities = [];
    const seen = new Set();
    const recordTrace = (bucket, trace) => {
        const key = trace.stage === 'CANDIDATE' ? `${bucket}_SUCCESS` : `${bucket}_REJECTED`;
        if (!traces[key]) traces[key] = [];
        if (traces[key].length < maxTracesPerBucket) traces[key].push(trace);
    };
    const findPriorStoryEvents = (sequence, direction) => allStoryEvents.filter(event => directionOf(event) === direction && eventTime(event) <= sequence.first_knowable_ms && sequence.first_knowable_ms - eventTime(event) <= MAX_STORY_BARS * TF_MS['15M']);
    for (const sequence of structureSequences) {
        counters.story_sequences_evaluated += 1;
        const direction = directionOf(sequence);
        const sequenceTime = sequence.first_knowable_ms;
        const structureIndex = eventIndex(sequence.structure_event) ?? sequence.displacement?.index ?? sequence.source_index;
        if (structureIndex == null) continue;
        const storyContext = buildContextAt(context, normalized, sequenceTime, contextCache);
        const htfContext = storyContext.context_direction;
        const priorEvents = findPriorStoryEvents(sequence, direction);
        const liquidity = priorEvents.at(-1) || null;
        const sequenceCandle = bars15[structureIndex] || bars15.at(-1);
        const locationCandidates = msnrLocations(context, normalized, sequenceTime, symbol, msnrCache)
            .filter(location => location.direction === direction && location.first_knowable_ms <= sequenceTime)
            .filter(location => {
                const priceInLocation = sequenceCandle && sequenceCandle.c >= location.zone_low && sequenceCandle.c <= location.zone_high;
                const zoneOverlap = zoneOf(sequence) && overlap(zoneOf(sequence), { low: location.zone_low, high: location.zone_high });
                return priceInLocation || zoneOverlap;
            });
        const location = locationCandidates.find(item => item.freshness !== 'MITIGATED') || locationCandidates[0] || null;
        const hasCrt = priorEvents.some(event => event.crt_id || event.liquidity_source === 'CRT' || event.source === 'CRT');
        const hasTbs = priorEvents.some(event => event.tbs_id || event.liquidity_source === 'TBS' || event.source === 'TBS');
        const familyParts = [];
        if (location) familyParts.push('MSNR');
        if (hasCrt) familyParts.push('CRT');
        if (hasTbs) familyParts.push('TBS');
        const family = `${familyParts.length ? familyParts.join('_') : 'LIQUIDITY'}_${'ZONE'}`;
        const isContinuation = htfContext === direction;
        const isReversal = htfContext && htfContext !== direction;
        const validContext = htfContext !== 'NEUTRAL' || location != null;
        counters.replay_points += 1;
        counters.contexts += validContext ? 1 : 0;
        counters.locations += location ? 1 : 0;
        counters.liquidity_pools_active += priorEvents.length ? 1 : 0;
        counters.sweeps += liquidity ? 1 : 0;
        counters.reclaims += liquidity?.reclaimed !== false ? (liquidity ? 1 : 0) : 0;
        if (priorEvents.some(event => event.crt_id)) counters.crt_confirmed += 1;
        if (priorEvents.some(event => event.tbs_id)) counters.tbs_confirmed += 1;
        if (location) counters.msnr_reactions += 1;
        counters.confirmations += 1;
        counters.displacements += sequence.displacement ? 1 : 0;
        if (!validContext || !liquidity || (!location && !isContinuation)) {
            recordTrace(symbol.includes('AUD') ? 'AUD' : symbol.includes('GBP') ? 'GBP' : 'XAU', makeTrace({ timestamp: sequenceTime }, 'REJECTED', { reason: !validContext ? 'NO_CONTEXT_OR_LOCATION' : !liquidity ? 'NO_LIQUIDITY_EVENT' : 'NO_VALID_LOCATION', sequence_id: sequence.sequence_id, context_direction: htfContext, direction, family }));
            continue;
        }
        const zone = zoneOf(sequence);
        if (!zone) continue;
        counters.entry_zones += 1;
        const displacementIndex = sequence.displacement?.index ?? structureIndex;
        const retracement = firstRetrace(bars15, zone, displacementIndex);
        if (!retracement || retracement.time_ms < fromMs || retracement.time_ms > toMs) {
            recordTrace(symbol.includes('AUD') ? 'AUD' : symbol.includes('GBP') ? 'GBP' : 'XAU', makeTrace({ timestamp: sequenceTime }, 'WAITING_RETRACE', { reason: 'NO_FIRST_RETRACEMENT', sequence_id: sequence.sequence_id, zone, context_direction: htfContext, direction, family }));
            continue;
        }
        counters.first_retracements += 1;
        const touch = bars15[retracement.index];
        const confirmation = localConfirmation(primitives5, bars5, zone, direction, touch.close_time_ms);
        if (!confirmation || confirmation.first_knowable_ms > toMs) {
            recordTrace(symbol.includes('AUD') ? 'AUD' : symbol.includes('GBP') ? 'GBP' : 'XAU', makeTrace({ timestamp: retracement.time_ms }, 'REJECTED', { reason: 'NO_5M_CONFIRMATION', sequence_id: sequence.sequence_id, zone, direction, family }));
            continue;
        }
        counters.confirmations_5m += 1;
        const entry = (zone.low + zone.high) / 2;
        const stop = direction === 'BUY' ? Math.min(zone.low, number(sequence.sweep?.sweep_price) ?? zone.low) - pip : Math.max(zone.high, number(sequence.sweep?.sweep_price) ?? zone.high) + pip;
        const target = targetFor({ context, direction, entry, series: normalized, asOfMs: confirmation.first_knowable_ms, symbol });
        if (!target || (direction === 'BUY' ? target.objective_price <= entry : target.objective_price >= entry)) continue;
        const candidate = {
            candidate_id: `STORY:${symbol}:${sequence.sequence_id}:${retracement.index}:${confirmation.confirmation_id}`,
            side: direction, timeframe: '15m', first_knowable_ms: confirmation.first_knowable_ms,
            first_selected_at_ms: confirmation.first_knowable_ms, entry, stop_loss: stop,
            tp1: target.objective_price, tp2: null, tp3: null, risk: Math.abs(entry - stop),
            setup_family: family, htf_context_direction: htfContext, confirmed_setup_direction: direction,
            liquidity_event_id: liquidity.liquidity_event_id || liquidity.id, liquidity_source: liquidity.liquidity_source || liquidity.source,
            crt_id: priorEvents.find(event => event.crt_id)?.crt_id || null,
            tbs_id: priorEvents.find(event => event.tbs_id)?.tbs_id || null,
            msnr_id: location?.msnr_id || null, structure_event_id: sequence.structure_event_id,
            displacement_id: sequence.impulse_id, impulse_id: sequence.impulse_id, ob_id: sequence.ob?.ob_id || null,
            entry_zone_id: sequence.setup_event_id, zone_low: zone.low, zone_high: zone.high,
            refined_zone: sequence.refined_zone ? 'OB+FVG' : 'OB_ONLY', retrace_number: 1,
            confirmation_5m_ref: confirmation.confirmation_id, clear_path_to_tp1: 'YES',
            session: sessionContext(confirmation.first_knowable_ms, bars5),
            story_lineage: { htf_context: htfContext, liquidity_event_id: liquidity.liquidity_event_id || liquidity.id, confirmation_id: sequence.structure_event_id, displacement_id: sequence.impulse_id, entry_zone_id: sequence.setup_event_id }
        };
        const pathRecords = msnrLocations(context, normalized, confirmation.first_knowable_ms, symbol, msnrCache)
            .filter(item => item.timeframe === '4H')
            .map(item => ({ type: 'MSNR', direction: item.direction, low: item.zone_low, high: item.zone_high, ref: item.msnr_id, first_knowable_ms: item.first_knowable_ms, status: item.status }));
        const path = typeof context.build4HPathQualityAudit === 'function'
            ? context.build4HPathQualityAudit(candidate, pathRecords, confirmation.first_knowable_ms)
            : { trade_qualified: true, entry_inside_opposing_4h: 'NO', clear_path_to_tp1: 'YES', qualification_blockers: [], path_quality_penalty: 0 };
        candidate.entry_inside_opposing_4h = path.entry_inside_opposing_4h;
        candidate.clear_path_to_tp1 = path.clear_path_to_tp1;
        candidate.path_quality_penalty = path.path_quality_penalty;
        candidate.path_quality = path;
        if (path.trade_qualified === false) continue;
        counters.path_valid += 1;
        const geometry = validateCandidateDirection(candidate);
        if (!geometry.valid) continue;
        if (seen.has(candidate.candidate_id)) continue;
        seen.add(candidate.candidate_id);
        counters.final_candidates += 1;
        const simulation = simulateCandidate(candidate, normalized, { executionTimeframe: '5m', ambiguity: 'exclude' });
        const row = { ...candidate, simulation };
        opportunities.push(row);
        counters.selected += 1;
        counters.filled += simulation.fill_time_ms != null ? 1 : 0;
        counters.sl += simulation.final_outcome === 'SL' ? 1 : 0;
        recordTrace(symbol.includes('AUD') ? 'AUD' : symbol.includes('GBP') ? 'GBP' : 'XAU', makeTrace({ timestamp: confirmation.first_knowable_ms }, 'CANDIDATE', { candidate_id: candidate.candidate_id, sequence_id: sequence.sequence_id, direction, family, context_direction: htfContext, liquidity_source: candidate.liquidity_source, zone, retracement, confirmation, target, outcome: simulation.final_outcome }));
    }
    opportunities.sort((a, b) => a.first_knowable_ms - b.first_knowable_ms || a.candidate_id.localeCompare(b.candidate_id));
    return {
        symbol, from, to, counters, opportunities, traces,
        events: { liquidities: allStoryEvents, crt: [...crtTbs15.crt, ...crtTbs1h.crt], tbs: [...crtTbs15.tbs, ...crtTbs1h.tbs], sequences: structureSequences },
        primitives: { structures: primitives15.structures, displacements: primitives15.displacements, sequences: primitives15.sequences }
    };
}

module.exports = {
    buildStoryFirstOpportunities,
    detectCausalCrtTbs,
    structureTrend,
    sessionContext,
    firstRetrace,
    targetFor,
    auditV2Rows
};
