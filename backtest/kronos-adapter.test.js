'use strict';

const { createHistoricalKronosAdapter, evaluateHistoricalKronosForecast } = require('./kronos-adapter');

describe('shared live/historical Kronos adapter', () => {
    test('historical evaluation uses the same entry-aware path summary as live', () => {
        const result = evaluateHistoricalKronosForecast({
            status: 'OK', model: 'NeoQuasar/Kronos-small', device: 'cpu', timeframe: '1h', lookback: 2, horizon: 2, paths: 1, seed: 42, start_price: 100,
            paths_data: [[{ high: 101, low: 99, close: 100 }, { high: 106, low: 100, close: 105 }]]
        }, { action: 'BUY_LIMIT', entry: 100, stop_loss: 95, tp1: 105 }, { timeframe: '1h' });
        expect(result.kronos_status).toBe('OK');
        expect(result.kronos_tp1_first).toBe(1);
        expect(result.kronos_path_outcomes).toBeUndefined();
    });

    test('historical worker uses the same official service and degrades explicitly', async () => {
        const adapter = createHistoricalKronosAdapter({ env: { KRONOS_ENABLED: 'false' } });
        try {
            const result = await adapter.requestForecast({ timeframe: '1h', candles: [{ timestamp: '2026-10-17T00:00:00Z', open: 1, high: 2, low: .5, close: 1 }, { timestamp: '2026-10-17T01:00:00Z', open: 1, high: 2, low: .5, close: 1 }] });
            expect(result.status).toBe('UNAVAILABLE');
        } finally {
            adapter.close();
        }
    });
});
