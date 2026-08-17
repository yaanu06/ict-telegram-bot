const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('script.js', 'utf8');

const getContext = () => {
    const fakeEl = () => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        style: {},
        innerHTML: '',
        textContent: '',
        dataset: { category: 'metals' },
        value: ''
    });
    const context = {
        window: { Telegram: null },
        document: {
            getElementById: () => fakeEl(),
            addEventListener: () => {},
            querySelector: () => fakeEl(),
            querySelectorAll: () => [],
            body: { insertAdjacentHTML: () => {} }
        },
        console: { log: () => {}, error: () => {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval: () => {},
        clearTimeout: () => {},
        Date,
        Math,
        JSON,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64')
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    return context;
};

const candles = (n, start, step, dir) => {
    const out = [];
    let p = start;
    for(let i = 0; i < n; i++) {
        const o = p;
        const c = dir === 'up' ? p + step : p - step;
        out.push({ o, c, h: Math.max(o, c) + Math.abs(step) * 0.3, l: Math.min(o, c) - Math.abs(step) * 0.3, v: 1e6 });
        p = c;
    }
    return out;
};

describe('computeRSI (Wilder)', () => {
    it('returns 100 for a straight up run', () => {
        const ctx = getContext();
        const closes = candles(30, 100, 1, 'up').map(c => c.c);
        expect(ctx.computeRSI(closes, 14)).toBe(100);
    });
    it('returns ~0 for a straight down run', () => {
        const ctx = getContext();
        const closes = candles(30, 100, 1, 'down').map(c => c.c);
        expect(ctx.computeRSI(closes, 14)).toBe(0);
    });
});

describe('detectTrend', () => {
    it('detects uptrend', () => {
        const ctx = getContext();
        const data = candles(80, 100, 1, 'up');
        expect(ctx.detectTrend(data)).toBe('BULLISH');
    });
    it('detects downtrend', () => {
        const ctx = getContext();
        const data = candles(80, 300, 1, 'down');
        expect(ctx.detectTrend(data)).toBe('BEARISH');
    });
});

describe('detectCHoCH', () => {
    it('returns false for insufficient data', () => {
        const ctx = getContext();
        expect(ctx.detectCHoCH(candles(10, 100, 1, 'up'), 'BUY')).toBe(false);
    });
    it('returns false when no swing break happens', () => {
        const ctx = getContext();
        const data = candles(30, 100, 1, 'up');
        expect(ctx.detectCHoCH(data, 'BUY')).toBe(false);
    });
});

describe('detectFVG', () => {
    it('finds a bullish FVG', () => {
        const ctx = getContext();
        const data = candles(20, 100, 1, 'up');
        // Manufacture a gap: prev.h < next.l
        data[10] = { o: 110, c: 111, h: 112, l: 109, v: 1e6 };
        data[11] = { o: 120, c: 121, h: 122, l: 119, v: 1e6 };
        const fvgs = ctx.detectFVG(data);
        expect(fvgs.some(f => f.type === 'bull')).toBe(true);
    });
});

describe('getQuoteDirection', () => {
    it('returns NEUTRAL for short data (no more 1-candle guessing)', async () => {
        const ctx = getContext();
        const result = await ctx.getQuoteDirection('1H', candles(3, 100, 1, 'up'));
        expect(result).toBe('NEUTRAL');
    });
});
