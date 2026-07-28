const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('script.js', 'utf8');

const getContext = (overrides = {}) => {
    const context = {
        window: { Telegram: { WebApp: null } },
        document: {
            getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, querySelectorAll: () => [], querySelector: () => null, querySelectorAll: () => [], querySelector: () => null, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '' }),
            addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, querySelectorAll: () => [], querySelector: () => null
        },
        console: { log: () => {}, error: () => {} },
        fetch: jest.fn(),
        setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0, setInterval: () => 0, clearInterval: () => 0,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        ...overrides
    };
    vm.createContext(context);
    // Top-level const arrow functions (ema, atr) live in the script's lexical
    // scope, not on the context global — export them from the same script run.
    const exported = vm.runInContext(code + '\n;({ ema, atr });', context);
    Object.assign(context, exported);
    return context;
};

const mockDate = (iso) => {
    const RealDate = Date;
    return class extends RealDate {
        constructor(...args) {
            return args.length ? new RealDate(...args) : new RealDate(iso);
        }
        static now() { return new RealDate(iso).getTime(); }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
    };
};



describe('trade journal storage', () => {
    let context, store;

    beforeEach(() => {
        store = {};
        context = getContext({
            localStorage: {
                getItem: k => (k in store ? store[k] : null),
                setItem: (k, v) => { store[k] = String(v); },
                removeItem: k => { delete store[k]; }
            }
        });
    });

    const seedRecent = (id, extra = {}) => context.setRecents([{ id, pair: 'XAU/USD', direction: 'LONG', timeframe: '1H', quality: 'A', confidence: 80, entry: 2400, sl: 2390, tp1: 2440, outcome: null, out: { x: 1 }, ...extra }]);

    it('returns empty lists when storage is empty or corrupted', () => {
        expect(context.getJournal()).toEqual([]);
        expect(context.getRecents()).toEqual([]);
        store['ict_journal'] = 'not valid json{';
        store['ict_recent_saved'] = 'not valid json{';
        expect(context.getJournal()).toEqual([]);
        expect(context.getRecents()).toEqual([]);
    });

    it('caps recents at 10 and journal at 30', () => {
        context.setRecents(Array.from({ length: 20 }, (_, i) => ({ id: i })));
        expect(context.getRecents()).toHaveLength(10);
        context.setJournal(Array.from({ length: 45 }, (_, i) => ({ id: i })));
        expect(context.getJournal()).toHaveLength(30);
    });

    it('marks a saved setup WIN and toggles back off', () => {
        seedRecent(7);
        context.markRecentOutcome(7, 'WIN');
        expect(context.getRecents()[0].outcome).toBe('WIN');
        context.markRecentOutcome(7, 'WIN'); // same button again untoggles
        expect(context.getRecents()[0].outcome).toBeNull();
    });

    it('refuses to journal a setup with no outcome', () => {
        seedRecent(8);
        context.journalRecent(8);
        expect(context.getJournal()).toHaveLength(0);
        expect(context.getRecents()).toHaveLength(1); // still in recents
    });

    it('moves a marked setup entirely from recents to the journal', () => {
        seedRecent(9);
        context.markRecentOutcome(9, 'LOSS');
        context.journalRecent(9);
        expect(context.getRecents()).toHaveLength(0);
        const j = context.getJournal();
        expect(j).toHaveLength(1);
        expect(j[0].id).toBe(9);
        expect(j[0].status).toBe('LOSS');
        expect(j[0].out).toBeUndefined(); // heavy JSON payload not carried into the journal
    });

    it('deletes from recents and journal independently', () => {
        seedRecent(1);
        context.deleteRecent(1);
        expect(context.getRecents()).toHaveLength(0);
        context.setJournal([{ id: 2, pair: 'BTC/USD', direction: 'SHORT', timeframe: '4H', quality: 'B', confidence: 70, entry: 1, sl: 1, tp1: 1, status: 'WIN' }]);
        context.deleteJournalEntry(2);
        expect(context.getJournal()).toHaveLength(0);
    });
});




describe('orderCrossedInCandles (missed-fill detection)', () => {
    const context = getContext();
    const mkCandle = (minsAgo, l, h) => ({ t: new Date(Date.now() - minsAgo * 60000).toISOString(), o: (l + h) / 2, h, l, c: (l + h) / 2, v: 1e6 });
    const longOrder = { signalType: 'LONG', idealEntry: 4100, createdAt: new Date(Date.now() - 60 * 60000).toISOString() };
    const shortOrder = { signalType: 'SHORT', idealEntry: 4180, createdAt: new Date(Date.now() - 60 * 60000).toISOString() };

    it('detects a LONG fill when a candle low pierced the entry after creation', () => {
        const candles = [mkCandle(50, 4120, 4130), mkCandle(30, 4095, 4125), mkCandle(10, 4110, 4140)];
        expect(context.orderCrossedInCandles(longOrder, candles)).toBe(true);
    });

    it('detects a SHORT fill when a candle high pierced the entry', () => {
        const candles = [mkCandle(40, 4150, 4185), mkCandle(20, 4140, 4160)];
        expect(context.orderCrossedInCandles(shortOrder, candles)).toBe(true);
    });

    it('ignores candles from before the order existed', () => {
        const candles = [mkCandle(120, 4090, 4130), mkCandle(20, 4110, 4130)];
        expect(context.orderCrossedInCandles(longOrder, candles)).toBe(false);
    });

    it('returns false when price never reached the entry', () => {
        const candles = [mkCandle(40, 4110, 4150), mkCandle(20, 4105, 4140)];
        expect(context.orderCrossedInCandles(longOrder, candles)).toBe(false);
    });

    it('parses timezone-less Twelve Data timestamps as UTC', () => {
        const utcNoZ = new Date(Date.now() - 20 * 60000).toISOString().replace('T', ' ').slice(0, 19);
        const candles = [{ t: utcNoZ, o: 4105, h: 4110, l: 4095, c: 4100, v: 1e6 }];
        expect(context.orderCrossedInCandles(longOrder, candles)).toBe(true);
    });
});




describe('getSession Silver Bullet timing', () => {
    it('does not mark 08:15 UTC as Silver Bullet', () => {
        const context = getContext({ Date: mockDate('2026-01-01T08:15:00Z') });
        expect(context.getSession().isSilverBullet).toBe(false);
    });

    it('marks 08:30 UTC as Silver Bullet', () => {
        const context = getContext({ Date: mockDate('2026-01-01T08:30:00Z') });
        expect(context.getSession().isSilverBullet).toBe(true);
    });
});

describe('loadLimitOrder persistence', () => {
    it('restores an order without auto-cancelling it', () => {
        const removeItem = jest.fn();
        const context = getContext({
            localStorage: {
                getItem: () => JSON.stringify({
                    id: 1,
                    pair: 'XAU/USD',
                    signalType: 'LONG',
                    idealEntry: 2400,
                    stopLoss: 2390,
                    createdAt: '2026-01-01T00:00:00Z'
                }),
                setItem: jest.fn(),
                removeItem
            }
        });
        context.loadLimitOrder();
        expect(removeItem).not.toHaveBeenCalled();
    });
});









