'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Kronos = require('./kronos-client');

function bar(timestamp, high, low, close = (high + low) / 2) {
    return { timestamp, open: close, high, low, close, is_closed: true };
}

function forecast(paths) {
    return {
        status: 'OK', model: 'NeoQuasar/Kronos-small', device: 'cpu', timeframe: '1h',
        lookback: 4, horizon: 3, paths: paths.length, seed: 42, start_price: 100,
        paths_data: paths
    };
}

describe('official Kronos adapter contract', () => {
    test('uses only closed candles within the max context and excludes future candles', () => {
        const visible = Kronos.closedCandleWindow([
            bar('2026-10-17T00:00:00Z', 101, 99, 100),
            { ...bar('2026-10-17T01:00:00Z', 102, 100, 101), is_closed: false },
            bar('2026-10-17T02:00:00Z', 103, 101, 102),
            bar('2026-10-17T03:00:00Z', 104, 102, 103)
        ], '1h', Date.parse('2026-10-17T04:00:00Z'), 2);
        expect(visible.map(item => item.timestamp)).toEqual(['2026-10-17T02:00:00Z', '2026-10-17T03:00:00Z']);
    });

    test('BUY and SELL alignment is directional, not a probability claim', () => {
        const bullish = forecast([[bar('2026-10-17T04:00:00Z', 105, 101, 104)]]);
        const bearish = forecast([[bar('2026-10-17T04:00:00Z', 99, 95, 96)]]);
        expect(Kronos.summarizeForecast(bullish, { action: 'BUY_LIMIT', entry: 99, stop_loss: 95, tp1: 103 }, { timeframe: '1h' }).kronos_alignment).toBe('ALIGNED');
        expect(Kronos.summarizeForecast(bearish, { action: 'SELL_LIMIT', entry: 101, stop_loss: 105, tp1: 97 }, { timeframe: '1h' }).kronos_alignment).toBe('ALIGNED');
    });

    test('pending BUY evaluates TP/SL only after the forecast first touches entry', () => {
        const raw = forecast([[
            bar('2026-10-17T04:00:00Z', 110, 105, 108), // target before entry is ignored
            bar('2026-10-17T05:00:00Z', 102, 98, 100),
            bar('2026-10-17T06:00:00Z', 106, 103, 105)
        ]]);
        const result = Kronos.summarizeForecast(raw, { action: 'BUY_LIMIT', entry: 100, stop_loss: 95, tp1: 105 }, { timeframe: '1h' });
        expect(result.kronos_tp1_first).toBe(1);
        expect(result.kronos_not_filled).toBe(0);
    });

    test('pending SELL that never reaches entry is NOT_FILLED', () => {
        const raw = forecast([[
            bar('2026-10-17T04:00:00Z', 99, 95, 97),
            bar('2026-10-17T05:00:00Z', 98, 94, 96)
        ]]);
        const result = Kronos.summarizeForecast(raw, { action: 'SELL_LIMIT', entry: 101, stop_loss: 105, tp1: 97 }, { timeframe: '1h' });
        expect(result.kronos_not_filled).toBe(1);
        expect(result.kronos_fill_path_support).toBe(0);
    });

    test('same forecast candle touching both TP1 and SL is AMBIGUOUS', () => {
        const raw = forecast([[
            bar('2026-10-17T04:00:00Z', 106, 94, 100)
        ]]);
        const result = Kronos.summarizeForecast(raw, { action: 'BUY_LIMIT', entry: 100, stop_loss: 95, tp1: 105 }, { timeframe: '1h' });
        expect(result.kronos_ambiguous).toBe(1);
        expect(result.kronos_tp1_path_support).toBe(0);
    });

    test('cache key includes market state and forecast settings', () => {
        const key = Kronos.cacheKey({ symbol: 'XAU/USD', timeframe: '1h', lastClosedTimestamp: '2026-10-17T03:00:00Z', model: 'NeoQuasar/Kronos-small', lookback: 400, horizon: 12, paths: 10, seed: 42 });
        expect(key).toContain('XAU/USD|1h|2026-10-17T03:00:00Z');
        expect(key).toContain('NeoQuasar/Kronos-small|400|12|10|42');
    });

    test('RAW instructions disable deterministic confluence and require the ACTION contract', () => {
        const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
        expect(source).toContain('DETERMINISTIC_POI_ENGINE=DISABLED');
        expect(source).toContain('CANDIDATE_LIST_ENGINE=DISABLED');
        expect(source).toContain('=== OUTPUT CONTRACT ===');
        expect(source).toContain('ACTION: BUY_LIMIT | SELL_LIMIT | NO_TRADE');
    });
});
