'use strict';

const { TIMEFRAME_MS, canonicalTimeframe } = require('./data-provider');
const { analyzeVisibleHistory } = require('./strategy-adapter');
const { build4HStateHistory, getActive4HState } = require('./market-state');
const { MODES: V2_ALCHEMIST_MODES, buildQualificationIndex } = require('./v2-alchemist-sequence');

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

function visibleBars(series, timeframe, asOfMs, maxBars = null) {
    const interval = TIMEFRAME_MS[canonicalTimeframe(timeframe)];
    const rows = series || [];
    // Replay series are normalized chronologically. Locate the visible prefix
    // first so deep-history runs do not repeatedly scan the entire history at
    // every clock; the returned candles and closed-bar semantics are unchanged.
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const start = Number(rows[middle]?.t ?? rows[middle]?.timestamp);
        const close = Number(rows[middle]?.close_time_ms ?? start + interval);
        if (Number.isFinite(close) && close <= asOfMs) low = middle + 1;
        else high = middle;
    }
    let start = 0;
    if (Number.isInteger(maxBars) && maxBars > 0 && low > maxBars) {
        start = low;
        let validCount = 0;
        while (start > 0 && validCount < maxBars) {
            start -= 1;
            const bar = rows[start];
            const barStart = Number(bar?.t ?? bar?.timestamp);
            const barClose = Number(bar?.close_time_ms ?? barStart + interval);
            if (bar && Number.isFinite(barStart) && Number.isFinite(barClose) && barClose <= asOfMs && bar.is_closed !== false) validCount += 1;
        }
    }
    return rows.slice(start, low).filter(bar => {
        const start = Number(bar.t ?? bar.timestamp);
        const close = Number(bar.close_time_ms ?? start + interval);
        return bar && Number.isFinite(start) && Number.isFinite(close) && close <= asOfMs && bar.is_closed !== false;
    }).map(bar => canonicalCandle(bar, timeframe));
}

function makeBlocks(seriesByTimeframe, asOfMs) {
    return STRATEGY_TIMEFRAMES.map(timeframe => {
        const sourceTf = timeframe.toLowerCase();
        const limit = LIVE_HISTORY_LIMITS[sourceTf] || 50;
        const visible = visibleBars(seriesByTimeframe[sourceTf] || [], sourceTf, asOfMs, limit);
        // Match the live compact packet's history window. The replay still
        // advances through every execution candle; each historical moment is
        // analyzed with the same bounded input the live strategy receives.
        return { timeframe, candles: visible };
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

function candidateSnapshot(record, asOfMs, firstObservedMs, selected, dailyBias = null, qualification = null) {
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
        selected_at_observation: selected === true,
        ...(qualification ? {
            v2_sequence_mode: qualification.mode,
            v2_sequence_qualified: qualification.qualified,
            v2_sequence_rejection_reason: qualification.rejection_reason,
            v2_sequence_blockers: qualification.blockers,
            htf_storyline: qualification.htf_storyline,
            htf_state_id: qualification.htf_state_id,
            htf_direction: qualification.htf_direction,
            msnr_state: qualification.msnr_state,
            crt_state: qualification.crt_state,
            tbs_state: qualification.tbs_state,
            liquidity_event: qualification.liquidity_event,
            direction_confirmation: qualification.direction_confirmation,
            displacement_ref: qualification.displacement_ref,
            bos_ref: qualification.bos_ref,
            setup_family: qualification.setup_family || null,
            entry_zone_state: qualification.entry_zone_state,
            first_retrace: qualification.first_retrace,
            session_context: qualification.session,
            sequence_evidence_refs: qualification.evidence_refs
        } : {})
    };
}

function collectCandidateRows(result, asOfMs, registry, context, blocks, options = {}) {
    const records = result?.zones?.all_records || result?.zones?.records || [];
    const knownKeys = new Set(records.map(fvgKey));
    for (const record of records) {
        const key = fvgKey(record);
        const existing = registry.get(key);
        const firstObserved = existing?.first_observed_ms || asOfMs;
        const qualification = options.qualificationMap?.get(key) || null;
        const selectedByV2 = result.zones.current_records?.some(item => fvgKey(item) === key) === true;
        const selected = options.selectionMode && options.selectionMode !== 'CURRENT_V2'
            ? selectedByV2 && qualification?.qualified === true
            : selectedByV2;
        const snapshot = candidateSnapshot(record, asOfMs, firstObserved, selected, result.role_audit?.daily_bias, qualification);
        if (!existing) registry.set(key, { ...snapshot, observations: 1, first_selected_at_ms: snapshot.selected_at_observation ? asOfMs : null });
        else {
            existing.observations += 1;
            existing.last_observed_at_ms = asOfMs;
            if (options.retainLastState !== false) existing.last_state = snapshot;
            if (snapshot.selected_at_observation && !existing.first_selected_at_ms) existing.first_selected_at_ms = asOfMs;
        }
    }
    // Preserve detected formations that could not become complete pending
    // candidates at that historical moment (wrong side of price, consumed,
    // invalid geometry, etc.) without reimplementing strategy rules.
    for (const block of (blocks || []).filter(item => ['4H', '1H'].includes(item.timeframe))) {
        const last = block.candles?.at(-1);
        const fvgCacheKey = `${block.timeframe}:${block.candles?.length || 0}:${last?.t || last?.timestamp || ''}`;
        const cachedFvgs = options.fvgCache?.get(fvgCacheKey);
        const fvgs = cachedFvgs || context.detectRawTextFvgs(block.candles, block.timeframe);
        if (!cachedFvgs && options.fvgCache) options.fvgCache.set(fvgCacheKey, fvgs);
        for (const fvg of fvgs) {
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

function makeBlocksReference(seriesByTimeframe, asOfMs) {
    return STRATEGY_TIMEFRAMES.map(timeframe => {
        const sourceTf = timeframe.toLowerCase();
        const visible = visibleBars(seriesByTimeframe[sourceTf] || [], sourceTf, asOfMs);
        return { timeframe, candles: visible.slice(-(LIVE_HISTORY_LIMITS[sourceTf] || 50)) };
    }).filter(block => block.candles.length > 0);
}

function pruneReplayCaches(cache, limit = 64) {
    for (const value of Object.values(cache || {})) {
        if (!(value instanceof Map)) continue;
        while (value.size > limit) value.delete(value.keys().next().value);
    }
}

function firstBarAfter(series, timestamp) {
    let low = 0;
    let high = (series || []).length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const value = Number(series[middle]?.t ?? series[middle]?.timestamp);
        if (Number.isFinite(value) && value <= timestamp) low = middle + 1;
        else high = middle;
    }
    return low;
}

function simulateCandidate(candidate, series, options = {}) {
    const executionTimeframe = canonicalTimeframe(options.executionTimeframe || '5m');
    const candidateAvailableAt = Number(candidate.first_selected_at_ms || candidate.first_knowable_ms);
    const executionSeries = series[executionTimeframe] || [];
    const executionStart = firstBarAfter(executionSeries, candidateAvailableAt);
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
    for (let executionIndex = executionStart; executionIndex < executionSeries.length; executionIndex += 1) {
        const source = executionSeries[executionIndex];
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

function replayHistory({ context, series, symbol, from, to, precision, replayTimeframe = '5m', ambiguity = 'exclude', includeMarketStateDiagnostics = false, retainLastState = true, progress = null, optimized = true, resumeState = null, checkpoint = null, sequenceMode = 'CURRENT_V2', symbolMetadata = {} }) {
    const fromMs = toMs(from);
    const toMsValue = toMs(to);
    const clocks = replayClocks(series, replayTimeframe, fromMs, toMsValue);
    const registry = new Map(Array.isArray(resumeState?.registry)
        ? resumeState.registry.filter(row => row?.candidate_id).map(row => [row.candidate_id, row])
        : []);
    const observations = Array.isArray(resumeState?.observations) ? resumeState.observations : [];
    const analysisCache = optimized ? {
        roleAudits: new Map(),
        crtAudits: new Map(),
        fvgByBlock: new Map(),
        orderBlocksByBlock: new Map(),
        staticZoneRecords: new Map()
    } : null;
    const sequenceEnabled = V2_ALCHEMIST_MODES.includes(sequenceMode) && sequenceMode !== 'CURRENT_V2';
    const marketStateHistory = (includeMarketStateDiagnostics || sequenceEnabled)
        ? build4HStateHistory({ symbol, candles: series['4h'] || [], context, symbolMetadata })
        : null;
    const sequenceCounters = {
        mode: sequenceMode,
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
    const sequenceCache = sequenceEnabled ? { candidates: new Map(), primitives: new Map() } : null;
    const marketStateSnapshots = Array.isArray(resumeState?.market_state_snapshots)
        ? resumeState.market_state_snapshots
        : [];
    const resumeClockIndex = Math.max(0, Math.min(clocks.length, Number(resumeState?.next_clock_index) || 0));
    for (let clockIndex = resumeClockIndex; clockIndex < clocks.length; clockIndex += 1) {
        const asOfMs = clocks[clockIndex];
        const blocks = optimized ? makeBlocks(series, asOfMs) : makeBlocksReference(series, asOfMs);
        const executionBars = blocks.find(block => block.timeframe === '5M')?.candles || [];
        const currentPrice = Number(executionBars.at(-1)?.c);
        if (!Number.isFinite(currentPrice) || blocks.filter(block => ['1D', '4H', '1H'].includes(block.timeframe)).some(block => block.candles.length < 3)) continue;
        const result = analyzeVisibleHistory(context, { blocks, symbol, currentPrice, asOfMs, precision, cache: analysisCache });
        let qualificationMap = null;
        if (sequenceEnabled) {
            const unqualifiedOrUnseen = (result.zones.current_records || []).filter(record => {
                const prior = registry.get(fvgKey(record));
                return !prior || prior.first_selected_at_ms == null;
            });
            const qualification = buildQualificationIndex({
                context,
                blocks,
                symbol,
                asOfMs,
                stateHistory: marketStateHistory,
                symbolMetadata,
                mode: sequenceMode,
                records: unqualifiedOrUnseen,
                keyOf: fvgKey,
                cache: sequenceCache
            });
            qualificationMap = qualification.map;
            sequenceCounters.replay_points += 1;
            for (const [key, value] of Object.entries(qualification.counters || {})) {
                if (key === 'rejection_reasons' || key === 'outcomes') {
                    for (const [reason, count] of Object.entries(value || {})) sequenceCounters[key][reason] = (sequenceCounters[key][reason] || 0) + count;
                } else if (Number.isFinite(value)) sequenceCounters[key] += value;
            }
        }
        collectCandidateRows(result, asOfMs, registry, context, blocks, { retainLastState, fvgCache: analysisCache?.fvgByBlock, qualificationMap, selectionMode: sequenceMode });
        if (optimized) pruneReplayCaches(analysisCache);
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
        if (typeof progress === 'function' && (clockIndex === 0 || (clockIndex + 1) % 1000 === 0 || clockIndex === clocks.length - 1)) {
            progress({
                clock_index: clockIndex + 1,
                clock_count: clocks.length,
                as_of_ms: asOfMs,
                candidate_count: registry.size,
                selected_count: [...registry.values()].filter(row => row.first_selected_at_ms != null).length
            });
            if (typeof checkpoint === 'function') {
                checkpoint({
                    next_clock_index: clockIndex + 1,
                    clock_count: clocks.length,
                    last_replay_timestamp: asOfMs,
                    registry: [...registry.values()].map(row => ({ ...row })),
                    observations: observations.slice(),
                    market_state_snapshots: marketStateSnapshots.slice()
                });
            }
        }
    }
    const candidates = [...registry.values()].map(row => ({ ...row, last_state: row.last_state || row }));
    const selected = candidates.filter(row => row.first_selected_at_ms != null);
    const rejected = candidates.filter(row => row.first_selected_at_ms == null);
    const trades = selected.map(candidate => ({ ...candidate, simulation: simulateCandidate(candidate, series, { executionTimeframe: replayTimeframe, ambiguity }) }));
    if (sequenceEnabled) {
        for (const trade of trades) {
            sequenceCounters.filled += trade.simulation.fill_time_ms != null ? 1 : 0;
            const outcome = trade.simulation.final_outcome || 'NOT_FILLED';
            sequenceCounters.outcomes[outcome] = (sequenceCounters.outcomes[outcome] || 0) + 1;
        }
    }
    return {
        candidates,
        selected,
        rejected,
        trades,
        observations,
        clocks: clocks.length,
        ...(sequenceEnabled ? { sequence_diagnostics: sequenceCounters } : {}),
        ...(marketStateHistory ? { market_state: { history: marketStateHistory, snapshots: marketStateSnapshots } } : {})
    };
}

module.exports = { LIVE_TIMEFRAMES, STRATEGY_TIMEFRAMES, visibleBars, makeBlocks, makeBlocksReference, replayClocks, simulateCandidate, replayHistory, symbolPrecision, normalizeOptionalPrice, normalizeCandidateTargets, validateCandidateDirection };
