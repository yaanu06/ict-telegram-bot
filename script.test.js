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
    vm.runInContext(code, context);
    return context;
};

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
