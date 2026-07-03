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
