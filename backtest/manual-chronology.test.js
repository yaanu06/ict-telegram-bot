'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayManualPacket } = require('./manual-packet-replay');

const hour = 3600000;
const start = Date.parse('2026-10-19T08:00:00Z');
const bar = (time, low = 102, high = 105) => ({ t: time, o: 103, h: high, l: low, c: 104, is_closed: true });
function fixture(ctx, direction = 'BUY', count = 6) {
    const history = { '1H': Array.from({ length: count }, (_, i) => bar(start + i * hour)) };
    const zone = { id: 'OWNER-MSNR', type: 'MSNR', timeframe: '1H', direction,
        low: direction === 'BUY' ? 99 : 109, high: direction === 'BUY' ? 101 : 111,
        midpoint: direction === 'BUY' ? 100 : 110, first_knowable_time: start, freshness: 'FRESH' };
    const setup = { id: 'MODEL-1', primary: 'ICT', timeframe: '1H', execution_timeframe: '15M', direction,
        event_time: start, execution_zone: zone, execution_model: 'PENDING_LIMIT', entry_model: 'MARKET_SHIFT',
        execution_confirmed: true, setup_formation_confirmed: true };
    setup.formation_chronology = ctx.marketMechanicsFormationChronology(setup, history);
    setup.first_actionable_time = setup.formation_chronology.first_actionable_time;
    const context = { pair: 'BTC/USD', historyCache: history, price: 104,
        as_of_time: start + count * hour, strategy_mode: 'MARKET_MECHANICS' };
    const candidate = { strategy_setup: setup, zone, direction, execution_model: 'PENDING_LIMIT',
        entry: zone.midpoint, zone_low: zone.low, zone_high: zone.high, tp1: direction === 'BUY' ? 130 : 80 };
    return { history, setup, context, candidate };
}

describe('production Market Mechanics formation chronology', () => {
    let ctx;
    beforeAll(() => { ctx = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' }); });

    test.each(['BUY', 'SELL'])('%s standing limit uses owning candles, not a missing LTF index', direction => {
        const f = fixture(ctx, direction);
        f.setup.execution_event_index = 999;
        const result = ctx.evaluateSetupLifecycle(f.candidate, f.context);
        expect(result.rejection_code).toBeNull();
        expect(result.lifecycle_classification).toBe('ACTIVE_UNTOUCHED');
        expect(result.lifecycle_diagnostics).toMatchObject({ execution_event_index: 0,
            index_timeframe: '1H', execution_event_index_resolved: 'YES', timestamp_chronology_available: 'YES' });
        expect(result.first_actionable_time).toBe(start + hour);
        expect(result.entry_consumed).toBe(false);
    });

    test('an old standing zone survives verified history without index-age expiry', () => {
        const f = fixture(ctx, 'BUY', 110);
        const result = ctx.evaluateSetupLifecycle(f.candidate, f.context);
        expect(result.rejection_code).toBeNull();
        expect(result.lifecycle_diagnostics.documented_age_rule_applied).toBe('NO');
    });

    test('real open-session coverage gap stays UNKNOWN, not expired or untouched', () => {
        const f = fixture(ctx);
        f.history['1H'].splice(2, 1);
        const result = ctx.evaluateSetupLifecycle(f.candidate, f.context);
        expect(result.rejection_code).toBe('CHRONOLOGY_UNKNOWN');
        expect(result.lifecycle_diagnostics.chronology_reason).toBe('POST_FORMATION_HISTORY_GAP');
        expect(result.lifecycle_diagnostics.missing_from).toBe(start + 2 * hour);
        expect(result.entry_freshness).toBe('UNKNOWN');
        const malformed = fixture(ctx);
        malformed.history['1H'][2].l = null;
        expect(ctx.evaluateSetupLifecycle(malformed.candidate, malformed.context).rejection_code).toBe('CHRONOLOGY_UNKNOWN');
    });

    test('fine candles cannot double-count a coarse interval', () => {
        const f = fixture(ctx);
        f.history['5M'] = Array.from({ length: 18 }, (_, i) => bar(start + hour + i * 300000));
        const result = ctx.marketMechanicsEntryChronology(f.setup, f.context);
        expect(result.known).toBe(true);
        expect(result.observations.some(b => b._timeframe === '5M')).toBe(true);
        expect(result.observations.some(b => b._timeframe === '1H')).toBe(true);
        result.observations.slice(1).forEach((b, i) => expect(b.t).toBe(result.observations[i]._close_time));
        expect(result.observations.reduce((sum, b) => sum + b._close_time - b.t, 0)).toBe(5 * hour);
    });

    test.each(['BUY', 'SELL'])('%s crossed entry cannot recycle, pre-formation touch is not a fill', direction => {
        const f = fixture(ctx, direction);
        f.history['1H'][0] = bar(start, 90, 120);
        expect(ctx.evaluateSetupLifecycle(f.candidate, f.context).entry_consumed).toBe(false);
        f.history['1H'][3] = bar(start + 3 * hour, direction === 'BUY' ? 99.9 : 102, direction === 'SELL' ? 110.1 : 105);
        const result = ctx.evaluateSetupLifecycle(f.candidate, f.context);
        expect(result.entry_consumed).toBe(true);
        expect(result.rejection_code).toBe('ENTRY_ALREADY_CONSUMED');
        expect(result.entry_first_crossed_time).toBe(start + 3 * hour);
    });

    test('future marked-closed candles cannot supply missing chronology or cause a fill', () => {
        const f = fixture(ctx);
        const before = ctx.marketMechanicsEntryChronology(f.setup, f.context);
        f.history['1H'].push(bar(f.context.as_of_time, 10, 150));
        expect(ctx.marketMechanicsEntryChronology(f.setup, f.context)).toEqual(before);
        f.setup.formation_chronology.first_actionable_time = f.context.as_of_time + hour;
        expect(ctx.marketMechanicsEntryChronology(f.setup, f.context)).toMatchObject({ known: false, reason: 'FORMATION_NOT_CLOSED' });
    });

    test('close-timestamped owner confirmation is not delayed another interval', () => {
        const f = fixture(ctx);
        f.history['1H'].provider_metadata = { timestamp_semantics: 'CLOSE' };
        const formation = ctx.marketMechanicsFormationChronology(f.setup, f.history);
        expect(formation.timestamp_semantics).toBe('CLOSE');
        expect(formation.first_actionable_time).toBe(start);
        expect(ctx.feedTimestampSemantics(ctx.marketMechanicsClosed(f.history['1H'], '1H', start + hour))).toBe('CLOSE');
    });

    test('later causal confirmation owns actionable price; earlier zone touches do not invalidate it', () => {
        const f = fixture(ctx);
        f.setup.event_time = start + 2 * hour;
        f.history['1H'][1] = bar(start + hour, 90, 105);
        f.setup.formation_chronology = ctx.marketMechanicsFormationChronology(f.setup, f.history);
        expect(f.setup.formation_chronology.first_actionable_time).toBe(start + 3 * hour);
        expect(ctx.evaluateSetupLifecycle(f.candidate, f.context).entry_consumed).toBe(false);
        f.history['1H'][2].c = 99;
        f.setup.formation_chronology = ctx.marketMechanicsFormationChronology(f.setup, f.history);
        expect(ctx.evaluateSetupLifecycle(f.candidate, f.context).rejection_code).toBe('INITIAL_PENDING_SIDE_INVALID');
    });

    test('both directions reach manual review despite plan/stop warnings; terminal duplicates cannot revive', () => {
        const common = { timeframe: '1H', model: 'MARKET_SHIFT', setup_formation_confirmed: 'YES',
            entry_zone_touched: 'NO', entry_consumed: 'NO', primary_blocker: 'NO_STRUCTURAL_STOP' };
        const buy = { ...common, id: 'BUY', source_setup_id: 'BUY-SOURCE', direction: 'BUY', proposed_entry: 95 };
        const sell = { ...common, id: 'SELL', direction: 'SELL', proposed_entry: 105 };
        const source = { pair: 'BTC/USD', market_plan: { direction: 'BUY' }, market_mechanics: {
            manual_model_states: [buy, sell], candidate_catalog: { raw_candidates: [] } } };
        expect(ctx.buildManualMarketMechanicsOpportunityShortlist(source, 100)).toHaveLength(2);
        expect(ctx.buildManualMarketMechanicsOpportunityShortlist(source, 100)[1].quality_warnings)
            .toEqual(expect.arrayContaining(['NO_STRUCTURAL_STOP', 'PREFERRED_MARKET_PLAN_DIRECTION_CONFLICT']));
        source.market_mechanics.manual_model_states[0] = { ...buy, setup_lifecycle: { rejection_code: 'ENTRY_ALREADY_CONSUMED' } };
        source.market_mechanics.candidate_catalog.raw_candidates = [buy];
        expect(ctx.buildManualMarketMechanicsOpportunityShortlist(source, 100).map(r => r.opportunity_id)).toEqual(['SELL']);
        for (const state of ['EXPIRED', 'INVALIDATED', 'CONSUMED']) {
            source.market_mechanics.manual_model_states = [{ ...sell, state }];
            source.market_mechanics.candidate_catalog.raw_candidates = [];
            expect(ctx.buildManualMarketMechanicsOpportunityShortlist(source, 100)).toHaveLength(0);
        }
        source.market_mechanics.manual_model_states = [{ ...buy, setup_formation_confirmed: 'NO' }, { ...sell, proposed_entry: 90 }];
        expect(ctx.buildManualMarketMechanicsOpportunityShortlist(source, 100)).toHaveLength(0);
    });

    test('manual Copy button accepts an equivalent closed-candle cache with different object identity', async () => {
        const asOf = Date.parse('2026-10-19T17:00:00Z');
        const durations = { '1D': 86400000, '4H': 14400000, '1H': 3600000, '15M': 900000, '5M': 300000 };
        const history = Object.fromEntries(Object.entries(durations).map(([tf, duration]) => [tf,
            Array.from({ length: 60 }, (_, i) => {
                const close = 100 + i * 0.02;
                return { t: asOf - (60 - i) * duration, o: close - 0.01, h: close + 0.04,
                    l: close - 0.04, c: close, is_closed: true };
            })]));
        const completeness = ctx.assessMarketSnapshotCompleteness({ historyCache: history, price: 102 });
        expect(completeness.complete).toBe(true);
        const live = ctx.buildLiveMarketContext({ pair: 'BTC/USD', price: 102, historyCache: history,
            indicators: {}, patterns: ctx.buildReplayPatterns(history, 102, 'BTC/USD'), enhancedAnalysis: {}, holistic: {},
            as_of_ms: asOf, snapshot_completeness: completeness,
            quote_snapshot: { price: 102, provider_timestamp: asOf, timestamp: new Date(asOf).toISOString() } });
        expect(live.historyCache).not.toBe(history);
        expect(ctx.marketSnapshotHistoryEquivalent(live.historyCache, history, asOf)).toBe(true);
        const output = ctx.buildManualExternalAIReviewOutput({ liveMarketContext: live, pairLocal: 'BTC/USD',
            price: 102, scanAsOfMs: asOf, historyCache: history });
        expect(output.trade_signal).toMatchObject({ status: 'MANUAL_EXTERNAL_AI_REVIEW',
            snapshot_id: live.snapshot_id, snapshot_completeness: { complete: true } });
        const replay = ctx.createScanReplay(live, output);
        const publicSignal = ctx.buildPublicTradeSignal(output.trade_signal);
        expect(ctx.buildRawTextMarketAnalysisPacket({ signal: publicSignal, replay }))
            .toContain('=== AI TRADING PACKET: RAW CANDLE AI ===');
        ctx.navigator = { clipboard: { writeText: jest.fn(() => Promise.resolve()) } };
        ctx.__copyReplay = replay;
        ctx.__copySignal = publicSignal;
        vm.runInContext("pair = 'BTC/USD'; currentScanArtifact = { symbol: 'BTC/USD', signal: __copySignal, replay: __copyReplay }", ctx);
        ctx.copyRawMarketAnalysisPacket();
        await Promise.resolve();
        await Promise.resolve();
        expect(ctx.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        expect(ctx.navigator.clipboard.writeText.mock.calls[0][0]).toContain('=== AI TRADING PACKET: RAW CANDLE AI ===');
    });
});

// Never copy user packets into tracked fixtures. CI explicitly skips this
// external regression when the private source file is not supplied.
const packetPath = process.env.MANUAL_PACKET_FIXTURE || path.join(__dirname, '..', 'packet', '=== AI TRADING PACKET ===.txt');
const realTest = fs.existsSync(packetPath) ? test : test.skip;
realTest('supplied EUR/USD 17:04 packet: candles -> actual production builder -> manual packet', () => {
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(packetPath)).digest('hex');
    const before = digest();
    const result = replayManualPacket(fs.readFileSync(packetPath, 'utf8'));
    expect(result.input.pair).toBe('EUR/USD');
    expect(result.input.opportunities).toHaveLength(24);
    expect(result.input.opportunities.every(row => row.quality_warnings.includes('CHRONOLOGY_UNKNOWN'))).toBe(true);
    for (const tf of ['4H', '1H', '15M', '5M']) {
        expect(result.input.history[tf]).toHaveLength(119);
        expect(result.live.data_quality.timeframe_status[tf]).toBe('FRESH');
    }
    expect(result.live.data_quality.status).toBe('INCOMPLETE'); // No daily OHLC in this text export.
    expect(result.live.data_quality.quote_status).toBe('INCOMPLETE'); // No fabricated provider quote timestamp.
    const states = result.live.market_mechanics.manual_model_states;
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(s => s.setup_lifecycle?.lifecycle_diagnostics.timestamp_chronology_available === 'YES')).toBe(true);
    const msnr = states.find(s => s.execution_poi_id === '1H-BUY-MSNR-1.12047-1.12087');
    expect(msnr.setup_lifecycle).toMatchObject({ entry_consumed: true, rejection_code: 'ENTRY_ALREADY_CONSUMED' });
    expect(msnr.first_actionable_time).toBe(Date.parse('2026-10-19T16:00:00Z'));
    expect(result.shortlist.some(r => r.execution_poi === msnr.execution_poi_id)).toBe(false);
    expect(result.shortlist.map(r => r.execution_poi)).toEqual(expect.arrayContaining([
        '1H-BUY-MSNR-1.11497-1.11547', '4H-BUY-FVG-1.11408-1.11517'
    ]));
    result.shortlist.forEach(row => {
        expect(row.entry_touched).toBe('NO');
        expect(row.index_mapping_status).toBe('YES');
        expect(row.quality_warnings).not.toContain('CHRONOLOGY_UNKNOWN');
        expect(row.quality_warnings).toContain('MARKET_DATA_INCOMPLETE');
        expect(row.suggested_entry).toBeLessThan(result.input.price);
        const target = row.directional_liquidity_targets.find(t => t.level === row.proposed_objective);
        expect(target.source).toBe(row.target_sources);
    });
    const printed = result.packet.split(/\r?\n/).filter(line => line.startsWith('OPPORTUNITY_EVIDENCE='))
        .map(line => JSON.parse(line.slice('OPPORTUNITY_EVIDENCE='.length)));
    expect(printed).toEqual(JSON.parse(JSON.stringify(result.shortlist)));
    expect(result.packet).toContain('LIVE rows are not required');
    expect(result.packet).not.toContain('exact canonical setup components supplied by the selected live candidate');
    expect(result.packet).toContain('LEGACY_TRADE_AUTHORITY=DISABLED');
    expect(result.packet.split(/\r?\n/).filter(line => line.startsWith('FORMATION_LIFECYCLE='))).toHaveLength(states.length);

    const rebuild = (history, price) => {
        const live = result.ctx.buildLiveMarketContext({ pair: result.input.pair, price, historyCache: history,
            as_of_ms: result.input.asOf, patterns: result.ctx.buildReplayPatterns(history, price, result.input.pair),
            indicators: {}, holistic: {}, enhancedAnalysis: {},
            quote_snapshot: { price, timestamp: new Date(result.input.asOf).toISOString(), quote_source: 'PACKET_OBSERVED_PRICE' } });
        return result.ctx.buildManualMarketMechanicsOpportunityShortlist(result.ctx.createScanReplay(live), price);
    };
    const withFuture = Object.fromEntries(Object.entries(result.input.history).map(([tf, bars]) =>
        [tf, [...bars, { t: result.input.asOf + 86400000, o: 3, h: 9, l: 0.1, c: 5, is_closed: true }]]));
    expect(rebuild(withFuture, result.input.price)).toEqual(result.shortlist);

    // Explicitly synthetic mirror: actual detectors and production entry
    // point must support SELL too. This is not a claimed real SELL signal.
    const mirrored = Object.fromEntries(Object.entries(result.input.history).map(([tf, bars]) => [tf,
        bars.map(b => ({ ...b, o: 2.4 - b.o, h: 2.4 - b.l, l: 2.4 - b.h, c: 2.4 - b.c }))]));
    const sellRows = rebuild(mirrored, 2.4 - result.input.price);
    expect(sellRows.length).toBeGreaterThan(0);
    sellRows.forEach(row => {
        expect(row.direction).toBe('SELL');
        expect(row.suggested_entry).toBeGreaterThan(row.current_price);
        expect(row.recomputed_lifecycle_status).toBe('ACTIVE_UNTOUCHED');
        expect(row.entry_touched).toBe('NO');
    });
    expect(digest()).toBe(before);
}, 30000);
