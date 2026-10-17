'use strict';

const { TIMEFRAME_MS, canonicalTimeframe } = require('./data-provider');
const { analyzeVisibleHistory } = require('./strategy-adapter');
const { build4HStateHistory, getActive4HState } = require('./market-state');

const LIVE_TIMEFRAMES = ['1d', '4h', '1h', '15m', '5m'];
const STRATEGY_TIMEFRAMES = ['1D', '4H', '1H', '15M', '5M'];
const LIVE_HISTORY_LIMITS = Object.freeze({ '1d': 100, '4h': 100, '1h': 80, '15m': 50, '5m': 50 });

function toMs(value) {
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function symbolPrecision(symbol, price) {
    if (/XAU|XAG|BTC|ETH/i.test(symbol)) return Number(price) >= 1000 ? 2 : 4;
    if (/USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF/i.test(symbol)) return 5;
    return 2;
}

function canonicalCandle(bar, timeframe) {
    const timestamp = Number(bar.t ?? bar.timestamp);
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    return {
        t: new Date(timestamp).toISOString(),
        timestamp,
        o: Number(bar.o ?? bar.open),
        h: Number(bar.h ?? bar.high),
        l: Number(bar.l ?? bar.low),
        c: Number(bar.c ?? bar.close),
        v: Number(bar.v ?? bar.volume ?? 0),
        is_closed: bar.is_closed !== false,
        close_time_ms: Number(bar.close_time_ms ?? timestamp + interval)
    };
}

function normalizeOptionalPrice(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeCandidateTargets(candidate = {}) {
    return [
        normalizeOptionalPrice(candidate.tp1),
        normalizeOptionalPrice(candidate.tp2),
        normalizeOptionalPrice(candidate.tp3)
    ];
}

function validateCandidateDirection(candidate = {}) {
    const direction = String(candidate.side || candidate.direction || '').toUpperCase();
    const entry = normalizeOptionalPrice(candidate.entry);
    const stop = normalizeOptionalPrice(candidate.stop_loss ?? candidate.stopLoss);
    const targets = normalizeCandidateTargets(candidate);
    if (!['BUY', 'SELL'].includes(direction) || entry == null || stop == null) {
        return { valid: false, reason: 'INVALID_TARGET_DIRECTION', direction, entry, stop, targets };
    }
    const stopValid = direction === 'BUY' ? stop < entry : stop > entry;
    const targetsValid = targets.filter(target => target != null).every(target => direction === 'BUY' ? target > entry : target < entry);
    if (!stopValid || !targetsValid || !targets.some(target => target != null)) {
        return { valid: false, reason: 'INVALID_TARGET_DIRECTION', direction, entry, stop, targets };
    }
    return { valid: true, reason: null, direction, entry, stop, targets };
}

function visibleBars(series, timeframe, asOfMs) {
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    return (series || []).filter(bar => {
        const start = Number(bar.t ?? bar.timestamp);
        const close = Number(bar.close_time_ms ?? start + interval);
        return bar && Number.isFinite(start) && Number.isFinite(close) && close <= asOfMs && bar.is_closed !== false;
    }).map(bar => canonicalCandle(bar, timeframe));
}

function makeBlocks(seriesByTimeframe, asOfMs) {
    return STRATEGY_TIMEFRAMES.map(timeframe => {
        const sourceTf = timeframe.toLowerCase();
        const visible = visibleBars(seriesByTimeframe[sourceTf] || [], sourceTf, asOfMs);
        // Match the live compact packet's history window. The replay still
        // advances through every execution candle; each historical moment is
        // analyzed with the same bounded input the live strategy receives.
        return { timeframe, candles: visible.slice(-(LIVE_HISTORY_LIMITS[sourceTf] || 50)) };
    }).filter(block => block.candles.length > 0);
}

function replayClocks(series, replayTimeframe, fromMs, toMs) {
    const tf = canonicalTimeframe(replayTimeframe);
    const values = (series[tf] || []).map(bar => Number(bar.close_time_ms ?? Number(bar.t ?? bar.timestamp) + TIMEFRAME_MS[tf]))
        .filter(value => Number.isFinite(value) && value >= fromMs && value <= toMs);
    return [...new Set(values)].sort((a, b) => a - b);
}

function fvgKey(record) {
    const fvg = record.fvg || {};
    return [fvg.timeframe, fvg.type, fvg.c1, fvg.c2, fvg.c3, fvg.lower, fvg.upper].join('|');
}

function formationKnowableMs(record) {
    const fvg = record.fvg || {};
    const start = Date.parse(fvg.c3);
    const interval = TIMEFRAME_MS[String(record.block?.timeframe || '').toLowerCase()];
    return Number.isFinite(start) && interval ? start + interval : null;
}

function candidateSnapshot(record, asOfMs, firstObservedMs, selected, dailyBias = null) {
    const fvg = record.fvg || {};
    const candidate = record.candidate || {};
    const current = record.current || {};
    const confluence = record.confluence || {};
    return {
        candidate_id: fvgKey(record),
        first_knowable_ms: formationKnowableMs(record) || firstObservedMs,
        first_knowable: new Date(formationKnowableMs(record) || firstObservedMs).toISOString(),
        first_observed_ms: firstObservedMs,
        observed_at_ms: asOfMs,
        observed_at: new Date(asOfMs).toISOString(),
        side: candidate.action === 'BUY_LIMIT' ? 'BUY' : 'SELL',
        action: candidate.action,
        timeframe: record.block?.timeframe?.toLowerCase(),
        fvg_type: fvg.type,
        fvg_status: fvg.status,
        fvg_c1: fvg.c1,
        fvg_c2: fvg.c2,
        fvg_c3: fvg.c3,
        fvg_zone_low: fvg.lower,
        fvg_zone_high: fvg.upper,
        entry: candidate.entry,
        stop_loss: candidate.stop_loss,
        tp1: candidate.tp1,
        tp2: candidate.tp2,
        tp3: candidate.tp3,
        risk: candidate.risk,
        score: record.score,
        current_score: record.current_score,
        quality: record.quality,
        daily_bias: dailyBias || null,
        structurally_valid: current.structurally_valid === true,
        current_opportunity: current.current_opportunity === true,
        today_opportunity: current.today_opportunity === true,
        opportunity_status: current.opportunity_status,
        entry_state: record.delivery?.entry_state,
        delivery_status: record.delivery?.delivery_status,
        pre_entry_progress: record.delivery?.pre_entry_progress,
        entry_distance_atr: current.entry_distance_atr,
        approach_state: current.approach_state,
        formation_age_hours: current.formation_age_hours,
        crt_refs: (confluence.crt || []).map(item => item.ref),
        msnr_refs: (confluence.msnr || []).map(item => item.ref),
        supply_demand: record.supplyDemand?.supporting_type || null,
        displacement: record.displacement?.label || null,
        premium_discount: record.premiumDiscount?.location || null,
        execution_15m: record.execution?.exec_15m || null,
        execution_5m: record.execution?.exec_5m || null,
        trade_qualified: record.path_quality?.trade_qualified !== false,
        entry_inside_opposing_4h: record.path_quality?.entry_inside_opposing_4h || 'NO',
        opposing_4h_barrier_before_tp1: record.path_quality?.opposing_4h_barrier_before_tp1 || 'NO',
        nearest_opposing_4h_ref: record.path_quality?.nearest_opposing_4h_ref || 'NONE',
        nearest_opposing_4h_type: record.path_quality?.nearest_opposing_4h_type || 'NONE',
        nearest_opposing_4h_zone: record.path_quality?.nearest_opposing_4h_zone || 'NONE',
        barrier_distance_r: record.path_quality?.barrier_distance_r ?? null,
        clear_path_to_tp1: record.path_quality?.clear_path_to_tp1 || 'YES',
        path_quality_penalty: Number(record.path_quality?.path_quality_penalty) || 0,
        qualification_blockers: record.path_quality?.qualification_blockers || [],
        score_breakdown: record.breakdown || {},
        selected_at_observation: selected === true
    };
}

function collectCandidateRows(result, asOfMs, registry, context, blocks) {
    const records = result?.zones?.all_records || result?.zones?.records || [];
    const knownKeys = new Set(records.map(fvgKey));
    for (const record of records) {
        const key = fvgKey(record);
        const existing = registry.get(key);
        const firstObserved = existing?.first_observed_ms || asOfMs;
        const snapshot = candidateSnapshot(record, asOfMs, firstObserved, result.zones.current_records?.some(item => fvgKey(item) === key), result.role_audit?.daily_bias);
        if (!existing) registry.set(key, { ...snapshot, observations: 1, first_selected_at_ms: snapshot.selected_at_observation ? asOfMs : null });
        else {
            existing.observations += 1;
            existing.last_observed_at_ms = asOfMs;
            existing.last_state = snapshot;
            if (snapshot.selected_at_observation && !existing.first_selected_at_ms) existing.first_selected_at_ms = asOfMs;
        }
    }
    // Preserve detected formations that could not become complete pending
    // candidates at that historical moment (wrong side of price, consumed,
    // invalid geometry, etc.) without reimplementing strategy rules.
    for (const block of (blocks || []).filter(item => ['4H', '1H'].includes(item.timeframe))) {
        for (const fvg of context.detectRawTextFvgs(block.candles, block.timeframe)) {
            const key = [fvg.timeframe, fvg.type, fvg.c1, fvg.c2, fvg.c3, fvg.lower, fvg.upper].join('|');
            if (knownKeys.has(key) || registry.has(key)) continue;
            registry.set(key, {
                candidate_id: key,
                first_knowable_ms: (() => { const value = Date.parse(fvg.c3); const interval = TIMEFRAME_MS[block.timeframe.toLowerCase()]; return Number.isFinite(value) && interval ? value + interval : asOfMs; })(),
                first_knowable: new Date((() => { const value = Date.parse(fvg.c3); const interval = TIMEFRAME_MS[block.timeframe.toLowerCase()]; return Number.isFinite(value) && interval ? value + interval : asOfMs; })()).toISOString(),
                first_observed_ms: asOfMs,
                observed_at_ms: asOfMs,
                observed_at: new Date(asOfMs).toISOString(),
                side: fvg.type === 'BULLISH' ? 'BUY' : 'SELL',
                action: null,
                timeframe: block.timeframe.toLowerCase(),
                fvg_type: fvg.type,
                fvg_status: fvg.status,
                fvg_c1: fvg.c1,
                fvg_c2: fvg.c2,
                fvg_c3: fvg.c3,
                fvg_zone_low: fvg.lower,
                fvg_zone_high: fvg.upper,
                current_opportunity: false,
                today_opportunity: false,
                structurally_valid: false,
                opportunity_status: 'REJECTED_BY_PENDING_GEOMETRY',
                rejection_reason: 'FORMATION_DETECTED_BUT_COMPLETE_PENDING_CANDIDATE_UNAVAILABLE',
                observations: 1,
                first_selected_at_ms: null
            });
        }
    }
}

function allVisiblePrimaryFvgs(context, blocks) {
    const result = [];
    for (const block of blocks.filter(item => ['4H', '1H'].includes(item.timeframe))) {
        for (const fvg of context.detectRawTextFvgs(block.candles, block.timeframe)) result.push({ fvg, block });
    }
    return result;
}

function simulateCandidate(candidate, series, options = {}) {
    const executionTimeframe = canonicalTimeframe(options.executionTimeframe || '5m');
    const candidateAvailableAt = Number(candidate.first_selected_at_ms || candidate.first_knowable_ms);
    const execution = (series[executionTimeframe] || []).filter(bar => Number(bar.t ?? bar.timestamp) > candidateAvailableAt);
    const direction = candidate.side;
    const entry = Number(candidate.entry);
    const stop = Number(candidate.stop_loss);
    const targets = normalizeCandidateTargets(candidate);
    const geometry = validateCandidateDirection(candidate);
    if (!geometry.valid) {
        return {
            candidate_id: candidate.candidate_id,
            side: direction,
            timeframe: candidate.timeframe,
            entry,
            stop_loss: stop,
            tp1: targets[0],
            tp2: targets[1],
            tp3: targets[2],
            first_knowable_ms: candidate.first_knowable_ms,
            fill_time_ms: null,
            final_outcome: 'INVALID_TARGET_DIRECTION',
            highest_target_reached: 0,
            targets_reached: [false, false, false],
            r_result: 0,
            ambiguous: false,
            trade_qualified: false,
            rejection_reason: geometry.reason,
            execution_timeframe: executionTimeframe
        };
    }
    const terminalTargetIndex = targets.reduce((last, target, index) => target == null ? last : index, -1);
    const risk = Number(candidate.risk) > 0 ? Number(candidate.risk) : Math.abs(entry - stop);
    let filled = false;
    let fillMs = null;
    let highestTarget = 0;
    let mfe = 0;
    let mae = 0;
    let outcome = 'NOT_FILLED';
    let ambiguous = false;
    const targetReachedAt = [null, null, null];
    const ambiguity = options.ambiguity || 'exclude';
    const directionalMove = (price) => direction === 'BUY' ? price - entry : entry - price;
    const hit = (bar, level) => direction === 'BUY' ? Number(bar.h) >= level : Number(bar.l) <= level;
    const stopHit = bar => direction === 'BUY' ? Number(bar.l) <= stop : Number(bar.h) >= stop;
    const entryHit = bar => direction === 'BUY' ? Number(bar.l) <= entry : Number(bar.h) >= entry;
    for (const source of execution) {
        const bar = canonicalCandle(source, executionTimeframe);
        if (!filled) {
            if (!entryHit(bar)) continue;
            filled = true;
            fillMs = bar.close_time_ms;
            const favorable = directionalMove(direction === 'BUY' ? bar.h : bar.l);
            const adverse = directionalMove(direction === 'BUY' ? bar.l : bar.h);
            mfe = Math.max(mfe, favorable / risk);
            mae = Math.min(mae, adverse / risk);
            const stopReached = stopHit(bar);
            const targetReached = targets.some(target => target != null && hit(bar, target));
            if (stopReached && targetReached) {
                ambiguous = true;
                if (ambiguity === 'exclude') { outcome = 'AMBIGUOUS'; break; }
                outcome = 'SL';
                break;
            }
            if (stopReached) { outcome = 'SL'; break; }
            for (let index = 0; index < targets.length; index += 1) {
                if (targets[index] != null && hit(bar, targets[index])) {
                    highestTarget = Math.max(highestTarget, index + 1);
                    if (targetReachedAt[index] == null) targetReachedAt[index] = bar.close_time_ms;
                }
            }
            if (terminalTargetIndex >= 0 && highestTarget >= terminalTargetIndex + 1) {
                outcome = `TP${terminalTargetIndex + 1}`;
                break;
            }
            continue;
        }
        const favorable = directionalMove(direction === 'BUY' ? bar.h : bar.l);
        const adverse = directionalMove(direction === 'BUY' ? bar.l : bar.h);
        mfe = Math.max(mfe, favorable / risk);
        mae = Math.min(mae, adverse / risk);
        const stopReached = stopHit(bar);
        const newTarget = targets.map((target, index) => target != null && hit(bar, target) ? index + 1 : 0).reduce((max, value) => Math.max(max, value), 0);
        if (stopReached && newTarget > 0) {
            ambiguous = true;
            if (ambiguity === 'exclude') { outcome = 'AMBIGUOUS'; break; }
            outcome = 'SL';
            break;
        }
        if (stopReached) { outcome = 'SL'; break; }
        highestTarget = Math.max(highestTarget, newTarget);
        for (let index = 0; index < targets.length; index += 1) {
            if (targets[index] != null && hit(bar, targets[index]) && targetReachedAt[index] == null) targetReachedAt[index] = bar.close_time_ms;
        }
        if (terminalTargetIndex >= 0 && highestTarget >= terminalTargetIndex + 1) {
            outcome = `TP${terminalTargetIndex + 1}`;
            break;
        }
    }
    if (!filled) outcome = 'NOT_FILLED';
    else if (outcome === 'NOT_FILLED') outcome = highestTarget ? `TP${highestTarget}` : 'OPEN_AT_END';
    const rResult = outcome === 'SL' ? -1 : outcome === 'TP1' ? 1 : outcome === 'TP2' ? 2 : outcome === 'TP3' ? 3 : 0;
    return {
        candidate_id: candidate.candidate_id,
        side: direction,
        timeframe: candidate.timeframe,
        entry,
        stop_loss: stop,
        tp1: targets[0],
        tp2: targets[1],
        tp3: targets[2],
        first_knowable_ms: candidate.first_knowable_ms,
        fill_time_ms: fillMs,
        time_to_fill_ms: fillMs == null ? null : fillMs - candidate.first_knowable_ms,
        final_outcome: outcome,
        highest_target_reached: highestTarget,
        targets_reached: targetReachedAt.map(value => value != null),
        time_to_tp1_ms: targetReachedAt[0] == null || fillMs == null ? null : targetReachedAt[0] - fillMs,
        tp1_before_sl: targetReachedAt[0] != null && outcome === 'SL',
        tp2_before_sl: targetReachedAt[1] != null && outcome === 'SL',
        tp3_before_sl: targetReachedAt[2] != null && outcome === 'SL',
        r_result: rResult,
        mfe_r: Number.isFinite(mfe) ? Number(mfe.toFixed(4)) : null,
        mae_r: Number.isFinite(mae) ? Number(mae.toFixed(4)) : null,
        ambiguous,
        execution_timeframe: executionTimeframe
    };
}

function replayHistory({ context, series, symbol, from, to, precision, replayTimeframe = '5m', ambiguity = 'exclude', includeMarketStateDiagnostics = false }) {
    const fromMs = toMs(from);
    const toMsValue = toMs(to);
    const clocks = replayClocks(series, replayTimeframe, fromMs, toMsValue);
    const registry = new Map();
    const observations = [];
    const marketStateHistory = includeMarketStateDiagnostics
        ? build4HStateHistory({ symbol, candles: series['4h'] || [], context })
        : null;
    const marketStateSnapshots = [];
    for (const asOfMs of clocks) {
        const blocks = makeBlocks(series, asOfMs);
        const executionBars = blocks.find(block => block.timeframe === '5M')?.candles || [];
        const currentPrice = Number(executionBars.at(-1)?.c);
        if (!Number.isFinite(currentPrice) || blocks.filter(block => ['1D', '4H', '1H'].includes(block.timeframe)).some(block => block.candles.length < 3)) continue;
        const result = analyzeVisibleHistory(context, { blocks, symbol, currentPrice, asOfMs, precision });
        collectCandidateRows(result, asOfMs, registry, context, blocks);
        observations.push({ as_of_ms: asOfMs, candidate_count: result.zones.records.length, current_count: result.zones.current_records.length });
        if (marketStateHistory) {
            const activeState = getActive4HState(marketStateHistory, asOfMs);
            marketStateSnapshots.push({
                as_of_ms: asOfMs,
                active_4h_state_id: activeState?.state_id || null,
                active_4h_direction: activeState?.direction || 'NEUTRAL',
                active_4h_state_age_bars: activeState?.age_bars ?? null
            });
        }
    }
    const candidates = [...registry.values()].map(row => ({ ...row, last_state: row.last_state || row }));
    const selected = candidates.filter(row => row.first_selected_at_ms != null);
    const rejected = candidates.filter(row => row.first_selected_at_ms == null);
    const trades = selected.map(candidate => ({ ...candidate, simulation: simulateCandidate(candidate, series, { executionTimeframe: replayTimeframe, ambiguity }) }));
    return {
        candidates,
        selected,
        rejected,
        trades,
        observations,
        clocks: clocks.length,
        ...(marketStateHistory ? { market_state: { history: marketStateHistory, snapshots: marketStateSnapshots } } : {})
    };
}

module.exports = { LIVE_TIMEFRAMES, STRATEGY_TIMEFRAMES, visibleBars, makeBlocks, replayClocks, simulateCandidate, replayHistory, symbolPrecision, normalizeOptionalPrice, normalizeCandidateTargets, validateCandidateDirection };
