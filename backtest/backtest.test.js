'use strict';

const { normalizeBars, validateRawRows, validateSeries } = require('./data-provider');
const { simulateCandidate, replayClocks, visibleBars, validateCandidateDirection, symbolPrecision, symbolExecutionSemantics } = require('./replay');
const { summarize } = require('./metrics');
const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');

function bar(timestamp, high, low, close = (high + low) / 2) {
    return { timestamp, open: close, high, low, close, volume: 1 };
}

describe('historical backtest data and execution replay', () => {
    test('normalizes candles chronologically and reports quality issues', () => {
        const rows = [bar(300000, 11, 9), bar(0, 10, 8), bar(300000, 11, 9), bar(600000, 12, 10)];
        const raw = validateRawRows(rows, '5m');
        expect(raw.duplicate_timestamps).toEqual([300000]);
        expect(raw.unsorted).toBe(true);
        const normalized = normalizeBars(rows, '5m');
        expect(normalized.map(item => item.t)).toEqual([0, 300000, 600000]);
        expect(validateSeries(normalized, '5m').gaps).toHaveLength(0);
    });

    test('higher timeframe bars are invisible before their close', () => {
        const series = [bar(0, 110, 90, 100), bar(14400000, 120, 100, 110)].map(item => ({ ...item, t: item.timestamp, close_time_ms: item.timestamp + 14400000 }));
        expect(visibleBars(series, '4h', 14399999)).toHaveLength(0);
        expect(visibleBars(series, '4h', 14400000)).toHaveLength(1);
    });

    test('replay clock uses execution candle close times', () => {
        const series = { '5m': [0, 300000, 600000].map(timestamp => ({ t: timestamp, close_time_ms: timestamp + 300000 })) };
        expect(replayClocks(series, '5m', 0, 900000)).toEqual([300000, 600000, 900000]);
    });

    test('market-state snapshots are opt-in and do not alter candidate selection', () => {
        const context = loadStrategyContext();
        const makeHistory = interval => Array.from({ length: 4 }, (_, index) => {
            const timestamp = (index - 3) * interval;
            return { ...bar(timestamp, 101, 99, 100), t: timestamp, close_time_ms: timestamp + interval };
        });
        const series = {
            '1d': makeHistory(86400000),
            '4h': makeHistory(14400000),
            '1h': makeHistory(3600000),
            '5m': [0, 300000, 600000].map(timestamp => ({ ...bar(timestamp, 101, 99, 100), t: timestamp, close_time_ms: timestamp + 300000 }))
        };
        const result = require('./replay').replayHistory({ context, series, symbol: 'AUD/USD', from: 900000, to: 900000, precision: 5, replayTimeframe: '5m', includeMarketStateDiagnostics: true });
        expect(result.selected).toEqual([]);
        expect(result.market_state.snapshots).toHaveLength(1);
        expect(result.market_state.snapshots[0].active_4h_direction).toBe('NEUTRAL');
    });

    test('replay checkpoint resumes at the next clock without changing output', () => {
        const context = loadStrategyContext();
        const makeHistory = interval => Array.from({ length: 4 }, (_, index) => {
            const timestamp = (index - 3) * interval;
            return { ...bar(timestamp, 101, 99, 100), t: timestamp, close_time_ms: timestamp + interval };
        });
        const series = {
            '1d': makeHistory(86400000),
            '4h': makeHistory(14400000),
            '1h': makeHistory(3600000),
            '5m': [0, 300000, 600000, 900000].map(timestamp => ({ ...bar(timestamp, 101, 99, 100), t: timestamp, close_time_ms: timestamp + 300000 }))
        };
        const full = require('./replay').replayHistory({ context, series, symbol: 'AUD/USD', from: 900000, to: 1200000, precision: 5 });
        let checkpointState = null;
        require('./replay').replayHistory({ context, series, symbol: 'AUD/USD', from: 900000, to: 1200000, precision: 5, progress: () => {}, checkpoint: state => { if (state.next_clock_index === 1) checkpointState = state; } });
        expect(checkpointState).not.toBeNull();
        const resumed = require('./replay').replayHistory({ context, series, symbol: 'AUD/USD', from: 900000, to: 1200000, precision: 5, resumeState: checkpointState });
        expect(resumed.candidates).toEqual(full.candidates);
        expect(resumed.selected).toEqual(full.selected);
        expect(resumed.observations).toEqual(full.observations);
    });

    test('BUY_LIMIT fills only when a later candle reaches entry and records TP1', () => {
        const candidate = { candidate_id: 'buy', side: 'BUY', timeframe: '1h', first_knowable_ms: 0, entry: 100, stop_loss: 95, tp1: 105, tp2: 110, tp3: 115, risk: 5 };
        const series = { '5m': [bar(300000, 101, 99, 100), bar(600000, 106, 100, 105)] };
        const result = simulateCandidate(candidate, series, { executionTimeframe: '5m', ambiguity: 'exclude' });
        expect(result.final_outcome).toBe('TP1');
        expect(result.fill_time_ms).toBe(600000);
    });

    test('SELL_LIMIT fill and stop are symmetric', () => {
        const candidate = { candidate_id: 'sell', side: 'SELL', timeframe: '1h', first_knowable_ms: 0, entry: 100, stop_loss: 105, tp1: 95, tp2: 90, tp3: 85, risk: 5 };
        const series = { '5m': [bar(300000, 101, 99, 100), bar(600000, 105, 94, 100)] };
        const result = simulateCandidate(candidate, series, { executionTimeframe: '5m', ambiguity: 'adverse-first' });
        expect(result.final_outcome).toBe('SL');
    });

    test('target direction invariants reject a SELL objective above entry before simulation', () => {
        const candidate = { candidate_id: 'invalid-sell-target', side: 'SELL', first_knowable_ms: 0, entry: 100, stop_loss: 105, tp1: 101, tp2: null, tp3: null, risk: 5 };
        expect(validateCandidateDirection(candidate).valid).toBe(false);
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 101, 99, 100)] });
        expect(result.final_outcome).toBe('INVALID_TARGET_DIRECTION');
        expect(result.trade_qualified).toBe(false);
        expect(result.rejection_reason).toBe('INVALID_TARGET_DIRECTION');
    });

    test('target direction invariants reject a BUY stop above entry and upside target is required', () => {
        const candidate = { candidate_id: 'invalid-buy-geometry', side: 'BUY', first_knowable_ms: 0, entry: 100, stop_loss: 101, tp1: 105, tp2: null, tp3: null, risk: 1 };
        expect(validateCandidateDirection(candidate).valid).toBe(false);
        expect(simulateCandidate(candidate, { '5m': [bar(300000, 106, 99, 105)] }).final_outcome).toBe('INVALID_TARGET_DIRECTION');
    });

    test('missing BUY secondary targets remain absent and do not suppress a real stop', () => {
        const candidate = { candidate_id: 'buy-null-targets', side: 'BUY', timeframe: '1h', first_knowable_ms: 0, entry: 100, stop_loss: 95, tp1: 105, tp2: null, tp3: null, risk: 5 };
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 101, 99, 100), bar(600000, 102, 94, 96)] }, { executionTimeframe: '5m', ambiguity: 'exclude' });
        expect(result.tp2).toBeNull();
        expect(result.tp3).toBeNull();
        expect(result.final_outcome).toBe('SL');
        expect(result.r_result).toBe(-1);
    });

    test('missing SELL secondary targets remain absent and do not suppress a real stop', () => {
        const candidate = { candidate_id: 'sell-null-targets', side: 'SELL', timeframe: '1h', first_knowable_ms: 0, entry: 100, stop_loss: 105, tp1: 95, tp2: undefined, tp3: '', risk: 5 };
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 101, 99, 100), bar(600000, 106, 98, 104)] }, { executionTimeframe: '5m', ambiguity: 'exclude' });
        expect(result.tp2).toBeNull();
        expect(result.tp3).toBeNull();
        expect(result.final_outcome).toBe('SL');
        expect(result.r_result).toBe(-1);
    });

    test('a partial target set ends at its highest present target without creating zero targets', () => {
        const candidate = { candidate_id: 'buy-only-tp1', side: 'BUY', timeframe: '1h', first_knowable_ms: 0, entry: 100, stop_loss: 95, tp1: 105, tp2: null, tp3: NaN, risk: 5 };
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 106, 99, 105)] }, { executionTimeframe: '5m', ambiguity: 'exclude' });
        expect(result.final_outcome).toBe('TP1');
        expect(result.targets_reached).toEqual([true, false, false]);
        expect(result.tp2).toBeNull();
        expect(result.tp3).toBeNull();
    });

    test('ambiguous target and stop ordering is not counted as a winner', () => {
        const candidate = { candidate_id: 'ambiguous', side: 'BUY', timeframe: '4h', first_knowable_ms: 0, entry: 100, stop_loss: 95, tp1: 105, tp2: 110, tp3: 115, risk: 5 };
        const series = { '5m': [bar(300000, 106, 94, 100)] };
        const result = simulateCandidate(candidate, series, { executionTimeframe: '5m', ambiguity: 'exclude' });
        expect(result.final_outcome).toBe('AMBIGUOUS');
        expect(result.r_result).toBe(0);
    });

    test('never-filled pending order remains not filled', () => {
        const candidate = { candidate_id: 'none', side: 'BUY', timeframe: '1h', first_knowable_ms: 0, entry: 90, stop_loss: 85, tp1: 95, tp2: 100, tp3: 105, risk: 5 };
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 101, 99, 100)] }, { executionTimeframe: '5m' });
        expect(result.final_outcome).toBe('NOT_FILLED');
    });

    test('symbol-aware execution semantics keep provider metadata authoritative', () => {
        expect(symbolExecutionSemantics('XAU/USD')).toMatchObject({ assetClass: 'METAL', precision: 2, tickSize: 0.1, expiryHours: 24 });
        expect(symbolExecutionSemantics('BTC/USD')).toMatchObject({ assetClass: 'CRYPTO', precision: 2, tickSize: 0.01 });
        expect(symbolExecutionSemantics('EUR/USD')).toMatchObject({ assetClass: 'FOREX', precision: 5, tickSize: 0.0001 });
        expect(symbolExecutionSemantics('NASDAQ:AAPL')).toMatchObject({ assetClass: 'EQUITY', precision: 4, tickSize: 0.01 });
        expect(symbolExecutionSemantics('SPX500')).toMatchObject({ assetClass: 'INDEX', precision: 4 });
        expect(symbolExecutionSemantics('XAU/USD', { price_precision: 3, tick_size: 0.5, commission_per_unit: 0.02, expiry_hours: 8 }))
            .toMatchObject({ precision: 3, tickSize: 0.5, commissionPerUnit: 0.02, expiryHours: 8 });
        expect(symbolExecutionSemantics('CUSTOM:ZZZ', { asset_class: 'UNKNOWN' })).toMatchObject({ tickSize: null, precision: 6 });
        expect(symbolPrecision('XAU/USD', 5)).toBe(2);
        expect(symbolPrecision('BTC/USD', 500)).toBe(2);
        expect(symbolPrecision('AUD/USD', 1)).toBe(5);
        expect(symbolPrecision('NASDAQ:AAPL', 1)).toBe(4);
        expect(symbolPrecision('XAU/USD', 2000, { price_precision: 3 })).toBe(3);
    });

    test('never fills a candidate on candles visible only before first_knowable_ms', () => {
        const candidate = { candidate_id: 'no-lookahead', side: 'BUY', timeframe: '5m', first_knowable_ms: 600000, entry: 100, stop_loss: 95, tp1: 105, tp2: null, tp3: null, risk: 5 };
        // The 300000 bar would have filled and hit TP1, but it closed before the
        // candidate was knowable. The 600000 bar is the forming bar itself and is
        // also excluded; only the 900000 bar may act.
        const series = { '5m': [bar(300000, 200, 99, 100), bar(600000, 200, 99, 100), bar(900000, 102, 101, 101)] };
        const result = simulateCandidate(candidate, series, { executionTimeframe: '5m' });
        expect(result.fill_time_ms).toBeNull();
        expect(result.final_outcome).toBe('NOT_FILLED');
        const laterFill = simulateCandidate({ ...candidate, first_knowable_ms: 600000 }, { '5m': [bar(300000, 200, 99, 100), bar(900000, 101, 99, 100), bar(1200000, 106, 99, 105)] }, { executionTimeframe: '5m' });
        expect(laterFill.fill_time_ms).toBe(1200000);
        expect(laterFill.final_outcome).toBe('TP1');
    });

    test('expires an unfilled pending order at the supplied expiry without filling after it', () => {
        const candidate = { candidate_id: 'expiring', side: 'BUY', timeframe: '5m', first_knowable_ms: 0, entry: 90, stop_loss: 85, tp1: 95, expires_at_ms: 800000, risk: 5 };
        const result = simulateCandidate(candidate, { '5m': [bar(300000, 101, 99, 100), bar(600000, 106, 99, 105)] }, { executionTimeframe: '5m' });
        expect(result.fill_time_ms).toBeNull();
        expect(result.final_outcome).toBe('EXPIRED');
    });

    test('metrics preserve descriptive baseline counts', () => {
        const result = summarize([{ simulation: { final_outcome: 'SL', r_result: -1, mfe_r: 0.2, mae_r: -1 } }, { simulation: { final_outcome: 'TP2', r_result: 2, mfe_r: 2, mae_r: -0.1 } }]);
        expect(result.sample_size).toBe(2);
        expect(result.sl).toBe(1);
        expect(result.tp2).toBe(1);
        expect(result.total_r).toBe(1);
    });

    test('strategy adapter executes the existing deterministic analysis functions', () => {
        const context = loadStrategyContext();
        const start = Date.parse('2026-01-01T00:00:00Z');
        const blocks = [
            ['1D', 86400000], ['4H', 14400000], ['1H', 3600000], ['15M', 900000], ['5M', 300000
            ]
        ].map(([timeframe, interval]) => ({
            timeframe,
            candles: Array.from({ length: 40 }, (_, index) => {
                const timestamp = start + index * interval;
                const close = 100 + index * 0.01;
                return { t: new Date(timestamp).toISOString(), o: close, h: close + 0.02, l: close - 0.02, c: close, v: 1, is_closed: true };
            })
        }));
        const result = analyzeVisibleHistory(context, { blocks, symbol: 'AUD/USD', currentPrice: 100.4, asOfMs: start + 40 * 86400000, precision: 5 });
        expect(result.role_audit).toHaveProperty('daily_bias');
        expect(result.market_context).toHaveProperty('as_of_ms');
        expect(result.zones).toHaveProperty('all_records');
    });
});
