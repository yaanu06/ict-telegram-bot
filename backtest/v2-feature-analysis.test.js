'use strict';

const { outcomeFlags, sessionForHour, metric, analyzeRows, enrichTrade } = require('./v2-feature-analysis');

describe('V2 trade feature analysis helpers', () => {
    test('outcome groups preserve TP progression and SL-before-TP1', () => {
        expect(outcomeFlags({ final_outcome: 'SL', highest_target_reached: 0, tp1_before_sl: false })).toEqual({ outcome: 'SL', sl: true, tp1_plus: false, tp2_plus: false, tp3: false, sl_before_tp1: true });
        expect(outcomeFlags({ final_outcome: 'TP3', highest_target_reached: 3, tp1_before_sl: false }).tp3).toBe(true);
    });

    test('session classification is deterministic UTC', () => {
        expect(sessionForHour(2)).toBe('ASIA');
        expect(sessionForHour(8)).toBe('LONDON');
        expect(sessionForHour(13)).toBe('OVERLAP');
        expect(sessionForHour(18)).toBe('NEW_YORK');
        expect(sessionForHour(23)).toBe('OTHER');
    });

    test('feature report does not use outcome to construct a feature group', () => {
        const rows = [
            { symbol: 'AUD/USD', terminal_r: -1, SL: true, TP1_OR_BETTER: false, TP2_OR_BETTER: false, TP3: false, SL_BEFORE_TP1: true, HTF_STATE_ALIGNED_WITH_TRADE: true, CURRENT_V2: { quality: 'HIGH' } },
            { symbol: 'AUD/USD', terminal_r: 3, SL: false, TP1_OR_BETTER: true, TP2_OR_BETTER: true, TP3: true, SL_BEFORE_TP1: false, HTF_STATE_ALIGNED_WITH_TRADE: false, CURRENT_V2: { quality: 'LOW' } }
        ];
        const report = analyzeRows(rows);
        expect(report.overall.n).toBe(2);
        expect(report.features.HTF_STATE_ALIGNED_WITH_TRADE.true.total_r).toBe(-1);
        expect(report.features.HTF_STATE_ALIGNED_WITH_TRADE.false.total_r).toBe(3);
    });

    test('metric is explicit about empty groups', () => {
        expect(metric([])).toMatchObject({ n: 0, filled: 0, total_r: 0, average_r: null, median_r: null });
    });

    test('enrichment excludes structural events first knowable after the decision timestamp', () => {
        const candle = { close_time_ms: 1000, l: 99, h: 101, c: 100 };
        const empty = { candles: [candle], structures: [], displacements: [], sweeps: [], sequences: [] };
        const index = {
            normalized: {},
            stateHistory: { states: [], candles: [] },
            oneHEvents: [{ event_ref: 'FUTURE_1H', direction: 'BUY', first_knowable_ms: 2000, event_role: 'CONTINUATION_EVENT' }],
            primitives: { '1h': empty, '15m': empty, '5m': empty }
        };
        const row = enrichTrade({
            symbol: 'TEST',
            index,
            trade: { candidate_id: 'future-check', first_knowable_ms: 1000, side: 'BUY', entry: 100, stop_loss: 99, tp1: 101, execution_5m: 'NONE', simulation: { final_outcome: 'SL', r_result: -1, highest_target_reached: 0, tp1_before_sl: false } }
        });
        expect(row['1H_EVENT_ALIGNED']).toBe(false);
        expect(row['1H_EVENT_REF']).toBeNull();
    });
});
