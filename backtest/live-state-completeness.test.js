'use strict';

const { loadStrategyContext } = require('./strategy-adapter');

function candle(time, closed = true) {
    return { t: new Date(time).toISOString(), o: 100, h: 101, l: 99, c: 100.5, is_closed: closed };
}

function history(count = 120, asOfMs = Date.parse('2026-01-10T00:00:00Z')) {
    const result = {};
    const timeframes = { '1D': 86400000, '4H': 14400000, '1H': 3600000, '15M': 900000, '5M': 300000 };
    for (const [timeframe, interval] of Object.entries(timeframes)) {
        result[timeframe] = Array.from({ length: count }, (_, index) => candle(asOfMs - (count - index) * interval));
    }
    return result;
}

describe('MODEL_ROUTER live state completeness', () => {
    test('uses the detector lookback as the bounded completeness contract', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const complete = context.buildModelRouterStateCompleteness(history(), Date.parse('2026-01-10T00:00:00Z'));
        expect(complete.complete).toBe(true);
        expect(complete.state_reconstruction_mode).toBe('BOUNDED_CLOSED_CANDLE_LOOKBACK');
        expect(complete.required_closed_bars).toEqual({ '1D': 120, '4H': 120, '1H': 120, '15M': 120, '5M': 120 });
    });

    test('reports the first missing timeframe instead of silently reconstructing partial state', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const input = history();
        input['1H'] = input['1H'].slice(1);
        const result = context.buildModelRouterStateCompleteness(input, Date.parse('2026-01-10T00:00:00Z'));
        expect(result.complete).toBe(false);
        expect(result.reasons).toContain('INSUFFICIENT_MODEL_LOOKBACK:1H');
        expect(result.counts['1H']).toBe(119);
    });

    test('rejects future and open candles without changing the as-of boundary', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const asOf = Date.parse('2026-01-10T00:00:00Z');
        const input = history(121, asOf);
        input['15M'][120] = candle(asOf + 3600000, true);
        input['5M'][119] = candle(asOf - 300000, false);
        const result = context.buildModelRouterStateCompleteness(input, asOf);
        expect(result.complete).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining(['FUTURE_CANDLE_DATA:15M', 'OPEN_CANDLE_DATA:5M']));
        expect(result.as_of_ms).toBe(asOf);
    });

    test('serializes compact active state with stable evidence references', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const snapshot = context.buildModelRouterStateSnapshot({
            historyCache: history(),
            asOfMs: Date.parse('2026-01-10T00:00:00Z'),
            crtAudit: { records: [{ ref: 'CRT:4H:SELL:1', direction: 'SELL', timeframe: '4H', status: 'VALID', first_knowable_ms: 1, range_low: 98, range_high: 102 }] },
            tbsAudit: { records: [{ ref: 'TBS:15M:SELL:2', direction: 'SELL', timeframe: '15M', status: 'CONFIRMED', first_knowable_ms: 2 }] },
            msnrAudit: { records: [{ ref: 'MSNR:4H:SELL:3', direction: 'SELL', timeframe: '4H', status: 'VALID', first_knowable_ms: 3, zone_low: 101, zone_high: 103 }] },
            modelAuthority: {
                current_records: [{
                    strategy_model: 'CRT_LTF_CONFIRMATION',
                    model_router: { entry_zone_ref: 'ENTRY_ZONE:1', structure_ref: 'STRUCTURE:1', chronology: { zone_time: 4 } },
                    candidate: { action: 'SELL_LIMIT', structural_objective: { ref: 'DOL:1', price: 95 } },
                    current: { opportunity_status: 'ACTIVE_PENDING' }
                }]
            }
        });
        expect(snapshot.active_crt[0].id).toBe('CRT:4H:SELL:1');
        expect(snapshot.active_liquidity.map(item => item.liquidity_ref)).toEqual(expect.arrayContaining(['CRT:4H:SELL:1', 'TBS:15M:SELL:2']));
        expect(snapshot.active_entry_zone[0].id).toBe('ENTRY_ZONE:1');
        expect(snapshot.active_setup_model).toEqual(['CRT_LTF_CONFIRMATION']);
        expect(snapshot.active_objective[0].ref).toBe('DOL:1');
    });
});
