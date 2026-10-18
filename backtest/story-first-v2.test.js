'use strict';

const { detectCausalCrtTbs, firstRetrace, sessionContext } = require('./story-first-v2');

function candle(index, open, high, low, close, timeframe = '15M') {
    const interval = timeframe === '5M' ? 300000 : 900000;
    const t = index * interval;
    return { t, o: open, h: high, l: low, c: close, close_time_ms: t + interval, is_closed: true };
}

describe('story-first causal research primitives', () => {
    test('CRT sweep supplies the liquidity event and shared TBS evidence', () => {
        const candles = Array.from({ length: 28 }, (_, index) => candle(index, 1, 1.01, 0.99, 1));
        candles[10] = candle(10, 1, 1.08, 0.92, 1.02);
        candles[11] = candle(11, 1.01, 1.02, 0.89, 0.96);
        candles[12] = candle(12, 0.96, 1.05, 0.95, 1.03);
        const result = detectCausalCrtTbs({}, candles, '15M', 'TEST');
        expect(result.crt.some(event => event.direction === 'BUY' && event.liquidity_source === 'CRT')).toBe(true);
        expect(result.tbs.some(event => event.direction === 'BUY' && event.liquidity_source === 'TBS')).toBe(true);
        expect(result.crt.every(event => event.first_knowable_ms >= event.sweep_time_ms)).toBe(true);
        expect(result.tbs.every(event => event.first_knowable_ms >= event.sweep_timestamp)).toBe(true);
    });

    test('first retracement is measured only after price leaves the new zone', () => {
        const candles = [
            candle(0, 3, 3.2, 3, 3.1),
            candle(1, 3.1, 3.3, 3.1, 3.2),
            candle(2, 3.2, 3.8, 3.2, 3.7),
            candle(3, 3.7, 3.9, 3.6, 3.8),
            candle(4, 3.8, 3.9, 2.9, 3.1)
        ];
        expect(firstRetrace(candles, { low: 3, high: 3.2 }, 2)).toEqual(expect.objectContaining({ index: 4, retrace_number: 1 }));
    });

    test('session labels use DST-aware IANA zones', () => {
        const candles = [];
        const londonSummer = Date.parse('2025-07-01T08:30:00.000Z');
        const londonWinter = Date.parse('2025-01-15T08:30:00.000Z');
        expect(sessionContext(londonSummer, candles).source).toBe('DST_AWARE_IANA');
        expect(sessionContext(londonSummer, candles).london_hour).not.toBe(sessionContext(londonWinter, candles).london_hour);
    });
});
