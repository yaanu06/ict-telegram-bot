'use strict';

const { aggregateBars, summarizeRows, bootstrapMean, rollingExpectancy } = require('./deep-history-cli');

describe('deep history diagnostics', () => {
    test('aggregates UTC 5m bars without filling gaps', () => {
        const rows = [0, 300000, 600000, 1200000].map((timestamp, index) => ({ timestamp, open: 1 + index, high: 2 + index, low: 0.5 + index, close: 1.5 + index, volume: 1 }));
        const bars = aggregateBars(rows, '15m');
        expect(bars).toHaveLength(2);
        expect(bars[0]).toMatchObject({ timestamp: 0, o: 1, h: 4, l: 0.5, c: 3.5, source_bar_count: 3 });
        expect(bars[1].source_bar_count).toBe(1);
    });

    test('deep summary preserves target outcomes and drawdown', () => {
        const rows = [1, -1, 3].map((r, index) => ({ simulation: { fill_time_ms: index + 1, r_result: r, final_outcome: r < 0 ? 'SL' : `TP${r}` } }));
        expect(summarizeRows(rows)).toMatchObject({ trades: 3, filled: 3, sl: 1, tp1_plus: 2, tp3: 1, total_r: 3, max_drawdown_r: 1, max_losing_streak: 1 });
        expect(bootstrapMean(rows).low).not.toBeNull();
        expect(rollingExpectancy(rows, 2).observations).toBe(2);
    });
});
