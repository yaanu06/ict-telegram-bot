const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('script.js', 'utf8');

const getContext = () => {
    const context = {
        window: { Telegram: { WebApp: null } },
        document: {
            getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, style: {} }),
            addEventListener: () => {}
        },
        console: { log: () => {}, error: () => {} },
        fetch: jest.fn(),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    };
    vm.createContext(context);
    // Top-level const arrow functions (ema, rsi, atr) live in the script's lexical
    // scope, not on the context global — export them from the same script run.
    const exported = vm.runInContext(code + '\n;({ ema, rsi, atr });', context);
    Object.assign(context, exported);
    return context;
};

describe('ema (SMA-seeded)', () => {
    const context = getContext();

    it('seeds with the SMA of the first n periods', () => {
        const e = context.ema([2, 4, 6, 8], 3);
        // running averages while seeding: 2, 3, 4 — then standard EMA
        expect(e[0]).toBe(2);
        expect(e[1]).toBe(3);
        expect(e[2]).toBe(4);
        expect(e[3]).toBeCloseTo((8 - 4) * 0.5 + 4);
    });

    it('returns one value per input price', () => {
        expect(context.ema([1, 2, 3, 4, 5], 20)).toHaveLength(5);
    });
});

describe('rsi (Wilder smoothing)', () => {
    const context = getContext();

    it('returns 50 when there is not enough data', () => {
        expect(context.rsi([1, 2, 3], 14)).toBe(50);
    });

    it('returns 100 for monotonically rising prices', () => {
        const p = Array.from({ length: 30 }, (_, i) => 100 + i);
        expect(context.rsi(p, 14)).toBe(100);
    });

    it('returns near 0 for monotonically falling prices', () => {
        const p = Array.from({ length: 30 }, (_, i) => 100 - i);
        expect(context.rsi(p, 14)).toBeLessThan(1);
    });

    it('matches the classic Wilder worked example', () => {
        // Well-known 14-period example from Wilder's book / StockCharts
        const p = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
                   45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
                   46.03, 46.41, 46.22, 45.64];
        const v = context.rsi(p, 14);
        expect(v).toBeGreaterThan(57);
        expect(v).toBeLessThan(63);
    });
});

describe('checkSniperEntry', () => {
    const context = getContext();
    // trending-up candles with no sweep/MSS pattern
    const flat = Array.from({ length: 60 }, (_, i) => {
        const o = 100 + i * 0.1;
        return { t: new Date(2026, 0, 1, i).toISOString(), o, h: o + 0.3, l: o - 0.3, c: o + 0.1, v: 1e6 };
    });
    const zone = { low: 99, high: 100, confluence: 'FVG+OTE' };

    it('is not sniper when no sweep or MSS exists', () => {
        const res = context.checkSniperEntry(flat, 106, 'BUY', zone, { isKillzone: true });
        expect(res.isSniper).toBe(false);
    });

    it('scores OTE and killzone components', () => {
        const res = context.checkSniperEntry(flat, 106, 'BUY', zone, { isKillzone: true });
        const ote = res.checks.find(c => c.name === 'Zone in OTE band');
        const kz = res.checks.find(c => c.name === 'Killzone session');
        expect(ote.passed).toBe(true);
        expect(kz.passed).toBe(true);
    });

    it('reports all five checks with critical flags', () => {
        const res = context.checkSniperEntry(flat, 106, 'BUY', zone, null);
        expect(res.checks).toHaveLength(5);
        expect(res.checks.filter(c => c.critical)).toHaveLength(3);
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
    });
});

describe('validateAIResult', () => {
    const context = getContext();
    const best = { direction: 'BUY', entry: 100, zone: { low: 99, high: 101 } };
    const price = 105;
    const mk = (ts) => ({ trade_signal_Theghostmachine: ts });

    it('returns null for a malformed response', () => {
        expect(context.validateAIResult({}, best, price)).toBeNull();
        expect(context.validateAIResult(null, best, price)).toBeNull();
    });

    it('clamps confidence_adjustment to +-25', () => {
        const r = context.validateAIResult(mk({ confidence_adjustment: 80 }), best, price);
        expect(r.trade_signal_Theghostmachine.confidence_adjustment).toBe(25);
        const r2 = context.validateAIResult(mk({ confidence_adjustment: -99 }), best, price);
        expect(r2.trade_signal_Theghostmachine.confidence_adjustment).toBe(-25);
    });

    it('drops an entry refinement on the wrong side of price', () => {
        // BUY refinement above current price would fill instantly at a worse level
        const r = context.validateAIResult(mk({ entry_refinement: { low: 106, high: 107 } }), best, price);
        expect(r.trade_signal_Theghostmachine.entry_refinement).toBeUndefined();
    });

    it('drops an entry refinement far from the original zone', () => {
        const r = context.validateAIResult(mk({ entry_refinement: { low: 50, high: 52 } }), best, price);
        expect(r.trade_signal_Theghostmachine.entry_refinement).toBeUndefined();
    });

    it('keeps a sane entry refinement', () => {
        const r = context.validateAIResult(mk({ entry_refinement: { low: 99.5, high: 100.5 } }), best, price);
        expect(r.trade_signal_Theghostmachine.entry_refinement).toEqual({ low: 99.5, high: 100.5 });
    });

    it('drops an invalidation price on the wrong side of entry', () => {
        // for a BUY, invalidation must be below entry
        const r = context.validateAIResult(mk({ invalidation_price: 103 }), best, price);
        expect(r.trade_signal_Theghostmachine.invalidation_price).toBeUndefined();
        const r2 = context.validateAIResult(mk({ invalidation_price: 97 }), best, price);
        expect(r2.trade_signal_Theghostmachine.invalidation_price).toBe(97);
    });

    it('removes an unknown execution_decision so the caller falls back', () => {
        const r = context.validateAIResult(mk({ execution_decision: 'yolo_full_send' }), best, price);
        expect(r.trade_signal_Theghostmachine.execution_decision).toBeUndefined();
        const r2 = context.validateAIResult(mk({ execution_decision: 'skip' }), best, price);
        expect(r2.trade_signal_Theghostmachine.execution_decision).toBe('skip');
    });
});

describe('getLiveCandleDirection', () => {
    let context;

    beforeEach(() => {
        context = getContext();
        context.getHistory = jest.fn().mockResolvedValue(null);
        context.getPrice = jest.fn().mockResolvedValue(null);
    });

    it('returns NEUTRAL when cachedData is null and history is empty', async () => {
        const result = await context.getLiveCandleDirection('1H', null);
        expect(result).toBe('NEUTRAL');
    });

    it('returns NEUTRAL when cachedData is an empty array', async () => {
        const result = await context.getLiveCandleDirection('1H', []);
        expect(result).toBe('NEUTRAL');
    });

    it('returns NEUTRAL when cachedData has less than 2 items', async () => {
        const result = await context.getLiveCandleDirection('1H', [{ o: 100, c: 105 }]);
        expect(result).toBe('NEUTRAL');
    });

    it('returns BULLISH when current price > current candle open', async () => {
        context.getPrice.mockResolvedValue(110);
        const result = await context.getLiveCandleDirection('1H', [{ o: 90, c: 95 }, { o: 100, c: 105 }]);
        expect(result).toBe('BULLISH');
    });

    it('returns BEARISH when current price < current candle open', async () => {
        context.getPrice.mockResolvedValue(95);
        const result = await context.getLiveCandleDirection('1H', [{ o: 90, c: 95 }, { o: 100, c: 105 }]);
        expect(result).toBe('BEARISH');
    });

    it('returns NEUTRAL when current price equals current candle open', async () => {
        context.getPrice.mockResolvedValue(100);
        const result = await context.getLiveCandleDirection('1H', [{ o: 90, c: 95 }, { o: 100, c: 105 }]);
        expect(result).toBe('NEUTRAL');
    });

    it('returns NEUTRAL when currentPrice is not available', async () => {
        context.getPrice.mockResolvedValue(null);
        const result = await context.getLiveCandleDirection('1H', [{ o: 90, c: 95 }, { o: 100, c: 105 }]);
        expect(result).toBe('NEUTRAL');
    });
});
