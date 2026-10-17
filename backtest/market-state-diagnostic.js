'use strict';

/*
 * Diagnostic-only coverage report for the persistent 4H state and lineage
 * foundation. It never selects or simulates trades and does not feed the live
 * strategy or packet.
 */
const fs = require('fs');
const path = require('path');
const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');
const { canonicalSeries } = require('./path-quality-ab');
const { makeBlocks, replayClocks, symbolPrecision } = require('./replay');
const {
    build4HStateHistory,
    getActive4HState,
    buildImpulseLineage,
    align1HEventsTo4HState
} = require('./market-state');

const CONFIGS = [
    { symbol: 'AUD/USD', run: 'backtest-results/20261017T123857Z_AUD_USD' },
    { symbol: 'GBP/JPY', run: 'backtest-results/20261017T124556Z_GBP_JPY' },
    { symbol: 'XAU/USD', run: 'backtest-results/20261017T125537Z_XAU_USD' }
];
const DIAGNOSTIC_FROM = Date.parse('2026-09-30T00:00:00Z');
const DIAGNOSTIC_TO = Date.parse('2026-10-16T20:35:00Z');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function priceOf(blocks) {
    return Number(blocks.find(block => block.timeframe === '5M')?.candles.at(-1)?.c
        ?? blocks.find(block => block.timeframe === '1H')?.candles.at(-1)?.c);
}

function objectiveCandidates(context, blocks, price) {
    if (!Number.isFinite(price) || typeof context.findSwings !== 'function') return [];
    const result = [];
    for (const block of blocks.filter(item => ['4H', '1H'].includes(item.timeframe))) {
        const swings = context.findSwings(block.candles, 2) || {};
        for (const high of swings.H || []) if (Number(high.p) > price) result.push({ direction: 'BUY', timeframe: block.timeframe, price: Number(high.p), ref: `SWING_HIGH:${block.timeframe}:${high.i}:${high.p}` });
        for (const low of swings.L || []) if (Number(low.p) < price) result.push({ direction: 'SELL', timeframe: block.timeframe, price: Number(low.p), ref: `SWING_LOW:${block.timeframe}:${low.i}:${low.p}` });
    }
    return [...new Map(result.map(item => [item.ref, item])).values()];
}

function uniqueById(items, key) {
    return [...new Map(items.filter(item => item?.[key]).map(item => [item[key], item])).values()];
}

function runSymbol(config, context) {
    const runDir = path.resolve(config.run);
    const runConfig = readJson(path.join(runDir, 'config.json'));
    const series = canonicalSeries(runConfig);
    const stateHistory = build4HStateHistory({ symbol: config.symbol, candles: series['4h'], context });
    const lineage15 = buildImpulseLineage({ symbol: config.symbol, timeframe: '15M', candles: series['15m'], context });
    const lineage5 = buildImpulseLineage({ symbol: config.symbol, timeframe: '5M', candles: series['5m'], context });
    const oneHEvents = context.buildInstitutionalStructureFacts(series['1h'], '1H') || [];
    const aligned1H = align1HEventsTo4HState({ events: oneHEvents, stateHistory });
    const clocks = replayClocks(series, '1h', DIAGNOSTIC_FROM, DIAGNOSTIC_TO);
    const coverage = { BUY: 0, SELL: 0, NONE: 0 };
    const objectiveCounts = { found: 0, valid: 0, already_delivered: 0 };
    const campaignReady = new Set();
    let evaluationPoints = 0;
    let activeStateAtEvaluation = 0;
    for (const asOfMs of clocks) {
        const blocks = makeBlocks(series, asOfMs);
        const price = priceOf(blocks);
        if (!Number.isFinite(price)) continue;
        evaluationPoints += 1;
        const state = getActive4HState(stateHistory, asOfMs);
        if (state) {
            coverage[state.direction] += 1;
            activeStateAtEvaluation += 1;
        } else coverage.NONE += 1;
        const objectives = objectiveCandidates(context, blocks, price);
        objectiveCounts.found += objectives.length;
        objectiveCounts.valid += objectives.filter(item => item.direction === 'BUY' ? item.price > price : item.price < price).length;
        for (const event of aligned1H.filter(item => item.relation === 'ALIGNED' && item.event_time_ms <= asOfMs)) {
            if (objectives.some(objective => objective.direction === event.direction)) campaignReady.add(event.event_id);
        }
        // This calls the existing deterministic analysis only for coverage and
        // chronology checks; its result is never selected or simulated.
        analyzeVisibleHistory(context, {
            blocks,
            symbol: config.symbol,
            currentPrice: price,
            asOfMs,
            precision: symbolPrecision(config.symbol, price)
        });
    }
    const alignedEvents = aligned1H.filter(item => item.relation === 'ALIGNED');
    const conflictEvents = aligned1H.filter(item => item.relation === 'CONFLICT');
    const noStateEvents = aligned1H.filter(item => item.relation === 'NO_ACTIVE_4H_STATE');
    const freshImpulses = uniqueById(lineage15.impulses.filter(impulse => {
        const state = getActive4HState(stateHistory, impulse.first_knowable_ms);
        return state && state.direction === impulse.direction && impulse.first_knowable_ms >= DIAGNOSTIC_FROM && impulse.first_knowable_ms <= DIAGNOSTIC_TO;
    }), 'impulse_id');
    const linkedZones = uniqueById(lineage15.zones.filter(zone => {
        if (!zone.parent_impulse_id || zone.first_knowable_ms == null) return false;
        const state = getActive4HState(stateHistory, zone.first_knowable_ms);
        return state && state.direction === zone.direction && zone.first_knowable_ms >= DIAGNOSTIC_FROM && zone.first_knowable_ms <= DIAGNOSTIC_TO;
    }), 'setup_zone_ref');
    const linkedSetupEvents = uniqueById(lineage15.setup_events.filter(event => linkedZones.some(zone => zone.setup_zone_ref === event.setup_zone_ref)), 'setup_event_id');
    const fresh5mSupport = linkedSetupEvents.filter(event => lineage5.impulses.some(impulse => impulse.direction === event.direction
        && impulse.first_knowable_ms > event.first_knowable_ms
        && impulse.first_knowable_ms <= DIAGNOSTIC_TO));
    const linkedCountsByType = lineage15.zones.reduce((counts, zone) => {
        const key = zone.setup_zone_type || 'OTHER';
        counts[key] ||= { total: 0, linked: 0, unlinked: 0 };
        counts[key].total += 1;
        if (zone.parent_impulse_id) counts[key].linked += 1;
        else counts[key].unlinked += 1;
        return counts;
    }, {});
    return {
        symbol: config.symbol,
        diagnostic_from: new Date(DIAGNOSTIC_FROM).toISOString(),
        diagnostic_to: new Date(DIAGNOSTIC_TO).toISOString(),
        replay_timeframe: '1h',
        evaluation_points: evaluationPoints,
        active_state_coverage: {
            BUY: coverage.BUY,
            SELL: coverage.SELL,
            NONE: coverage.NONE,
            BUY_pct: evaluationPoints ? coverage.BUY / evaluationPoints : 0,
            SELL_pct: evaluationPoints ? coverage.SELL / evaluationPoints : 0,
            NONE_pct: evaluationPoints ? coverage.NONE / evaluationPoints : 0
        },
        objectives: objectiveCounts,
        one_h_confirmations: { total: aligned1H.length, aligned: alignedEvents.length, conflict: conflictEvents.length, no_active_4h_state: noStateEvents.length },
        state_count: stateHistory.states.length,
        states_by_status: stateHistory.states.reduce((counts, state) => { counts[state.status] = (counts[state.status] || 0) + 1; return counts; }, {}),
        stages: {
            objective_candidates: objectiveCounts.found,
            objectives_valid: objectiveCounts.valid,
            active_4h_state_available: activeStateAtEvaluation,
            valid_1h_confirmation_inside_active_state: alignedEvents.length,
            campaign_ready_structural_sequences: campaignReady.size,
            fresh_impulses: freshImpulses.length,
            linked_15m_zones: linkedZones.length,
            setup_events: linkedSetupEvents.length,
            fresh_5m_execution_support: fresh5mSupport.length,
            final_trade_opportunities: 0
        },
        lineage_coverage: {
            impulses_15m: lineage15.impulses.length,
            zones_15m: lineage15.zones.length,
            zones_with_parent_impulse: lineage15.zones.filter(zone => zone.parent_impulse_id).length,
            zones_without_parent_impulse: lineage15.zones.filter(zone => !zone.parent_impulse_id).length,
            setup_events_with_stable_id: lineage15.setup_events.filter(event => event.setup_event_id).length,
            by_type: linkedCountsByType
        },
        state_refs: stateHistory.states.map(state => ({ state_id: state.state_id, direction: state.direction, status: state.status, first_knowable: state.first_knowable, end_time: state.end_time, origin_refs: state.origin_refs })),
        samples: {
            aligned_1h: alignedEvents.slice(0, 3),
            linked_15m: linkedZones.slice(0, 3).map(zone => ({ setup_zone_ref: zone.setup_zone_ref, parent_impulse_id: zone.parent_impulse_id, first_knowable: zone.first_knowable, direction: zone.direction })),
            no_state_1h: noStateEvents.slice(0, 3)
        }
    };
}

function main() {
    const context = loadStrategyContext();
    const results = CONFIGS.map(config => runSymbol(config, context));
    console.log(JSON.stringify({ diagnostic: 'NON_AUTHORITATIVE_MARKET_STATE_AND_LINEAGE', results }, null, 2));
}

if (require.main === module) main();

module.exports = { objectiveCandidates, runSymbol };
