const { getMarketSettings } = require('../script.js');

describe('getMarketSettings', () => {
    test('returns correct settings for Gold (XAU)', () => {
        const result = getMarketSettings('XAU/USD');
        expect(result.slBuffer).toBe(3);
        expect(result.minSL).toBe(3);
        expect(result.maxSLPct).toBe(0.008);
        expect(result.targetRR).toBe(4);
        expect(result.prec).toBe(2);
        expect(result.slBuffers['1H']).toBe(5);
    });

    test('returns correct settings for Silver (XAG)', () => {
        const result = getMarketSettings('XAG/USD');
        expect(result.slBuffer).toBe(0.05);
        expect(result.minSL).toBe(0.03);
        expect(result.maxSLPct).toBe(0.01);
        expect(result.prec).toBe(2);
        expect(result.slBuffers['4H']).toBe(0.12);
    });

    test('returns correct settings for JPY pairs', () => {
        const result = getMarketSettings('USD/JPY');
        expect(result.slBuffer).toBe(0.15);
        expect(result.minSL).toBe(0.10);
        expect(result.maxSLPct).toBe(0.005);
        expect(result.prec).toBe(3);
        expect(result.slBuffers['15M']).toBe(0.12);
    });

    test('returns correct settings for BTC/USD', () => {
        const result = getMarketSettings('BTC/USD');
        expect(result.slBuffer).toBe(50);
        expect(result.minSL).toBe(30);
        expect(result.maxSLPct).toBe(0.015);
        expect(result.prec).toBe(2);
        expect(result.slBuffers['1D']).toBe(200);
    });

    test('returns default settings for other pairs', () => {
        const result = getMarketSettings('EUR/USD');
        expect(result.slBuffer).toBe(0.0005);
        expect(result.minSL).toBe(0.0003);
        expect(result.maxSLPct).toBe(0.005);
        expect(result.prec).toBe(5);
        expect(result.slBuffers['5M']).toBe(0.0003);
    });
});
