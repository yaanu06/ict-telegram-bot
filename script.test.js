const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('script.js', 'utf8');

const getContext = (overrides = {}) => {
    const context = {
        window: { Telegram: { WebApp: null } },
        document: {
            getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '' }),
            addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null
        },
        console: { log: () => {}, error: () => {} },
        fetch: jest.fn(),
        setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        ...overrides
    };
    vm.createContext(context);
    // Top-level const arrow functions (ema, rsi, atr) live in the script's lexical
    // scope, not on the context global — export them from the same script run.
    vm.runInContext(code, context);
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

describe('checkSniperEntry MSNR+TBS alternative path', () => {
    const context = getContext();
    // 15 candles: flat lows at 100, a sweep candle (idx 11) pierces to 98.9,
    // last candle closes back above the key level -> turtle soup BUY
    const candles = Array.from({ length: 15 }, (_, i) => ({
        o: 100.4, h: 101.2, l: 100.0, c: 100.8, v: 1e6
    }));
    candles[11] = { o: 100.3, h: 100.9, l: 98.9, c: 100.4, v: 1e6 };
    candles[14] = { o: 100.2, h: 101.4, l: 100.1, c: 101.0, v: 1e6 };

    it('qualifies an aligned turtle soup at a fresh MSNR zone as sniper', () => {
        const zone = { low: 99.0, high: 99.6, p: 99.3, src: 'MSNR', confluence: 'MSNR+Swing' };
        const res = context.checkSniperEntry(candles, 101, 'BUY', zone, null);
        expect(res.isSniper).toBe(true);
        expect(res.path).toBe('MSNR+TBS');
        expect(res.checks.find(c => c.name === 'TBS at MSNR level (alt path)').passed).toBe(true);
    });

    it('does not qualify when the zone has no MSNR confluence', () => {
        const zone = { low: 99.0, high: 99.6, p: 99.3, src: 'FVG', confluence: 'FVG' };
        const res = context.checkSniperEntry(candles, 101, 'BUY', zone, null);
        expect(res.checks.find(c => c.name === 'TBS at MSNR level (alt path)').passed).toBe(false);
    });
});

describe('getPrecisionEntryCRT CE placement', () => {
    const context = getContext();
    const candles = [{ o: 110, h: 112, l: 108, c: 111, v: 1e6 }];
    const crtRange = { low: 95, high: 125 };
    const zone = { low: 100, high: 102 };

    it('places the BUY entry at the zone midpoint (CE)', () => {
        const r = context.getPrecisionEntryCRT(candles, zone, 'BUY', crtRange, 1);
        expect(r.entry).toBeCloseTo(101);
    });

    it('places the SELL entry at the zone midpoint (CE)', () => {
        const r = context.getPrecisionEntryCRT(candles, { low: 118, high: 120 }, 'SELL', crtRange, 1);
        expect(r.entry).toBeCloseTo(119);
    });

    it('keeps the SL beyond the zone on the correct side', () => {
        const buy = context.getPrecisionEntryCRT(candles, zone, 'BUY', crtRange, 1);
        expect(buy.sl).toBeLessThan(zone.low);
        const sell = context.getPrecisionEntryCRT(candles, { low: 118, high: 120 }, 'SELL', crtRange, 1);
        expect(sell.sl).toBeGreaterThan(120);
    });
});

describe('recomputeTradeLevels', () => {
    const context = getContext();
    const base = {
        direction: 'SELL',
        zone: { low: 4130, high: 4131, p: 4130.5, src: 'MSNR', confluence: 'x', cc: 2, quality: 'A', hasImbalance: true },
        msnr: { allResistances: [] },
        timeframe: '5M',
        entryTF: '5M',
        entryATR: 20,
        entryData: [
            { o: 4120, h: 4121, l: 4119, c: 4120 },
            { o: 4121, h: 4122, l: 4120, c: 4121 },
            { o: 4122, h: 4123, l: 4121, c: 4122 },
            { o: 4123, h: 4124, l: 4122, c: 4123 },
            { o: 4124, h: 4125, l: 4123, c: 4124 }
        ]
    };

    it('keeps a refined SELL stop above the refined entry', () => {
        const r = context.recomputeTradeLevels({ ...base, twelveIndicators: { atr_api: 2 } }, 4134.97, 4136.46, 4123.8814, 'XAU/USD', base.entryData);
        expect(r.entry).toBe(4135.72);
        expect(r.sl).toBeGreaterThan(r.entry);
        expect(r.sl).toBe(4137.46);
        expect(r.slResult.reason).toBe('Above Zone');
    });

    it('prefers Twelve Data ATR over the wider local ATR when recalculating the stop', () => {
        const withApiAtr = context.recomputeTradeLevels({ ...base, twelveIndicators: { atr_api: 2 } }, 4134.97, 4136.46, 4123.8814, 'XAU/USD', base.entryData);
        const withoutApiAtr = context.recomputeTradeLevels({ ...base, twelveIndicators: {} }, 4134.97, 4136.46, 4123.8814, 'XAU/USD', base.entryData);
        expect(withApiAtr.sl).toBe(4137.46);
        expect(withoutApiAtr.sl).toBe(4139.46);
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

describe('Ghost Machine hard rules', () => {
    const context = getContext();

    it('accepts a fully aligned Silver Bullet BUY setup', () => {
        const rules = context.getGhostHardRules(
            'BUY',
            [{ direction: 'BULLISH' }],
            { detected: false, type: 'BUY' },
            { type: 'BULL', displaced: true },
            { isKillzone: false, isSilverBullet: true },
            { fresh: false, partiallyUsed: true, violations: 0 },
            { quality: 'A' }
        );
        expect(rules).toEqual({
            hasSweep: true,
            hasMSS: true,
            hasKillzone: true,
            zoneFresh: true,
            zoneQuality: true
        });
    });

    it('rejects a C-quality zone even when the other rules pass', () => {
        const rules = context.getGhostHardRules(
            'SELL',
            [{ direction: 'BEARISH' }],
            { detected: false, type: 'SELL' },
            { type: 'BEAR', displaced: true },
            { isKillzone: true, isSilverBullet: false },
            { fresh: true, partiallyUsed: false, violations: 0 },
            { quality: 'C' }
        );
        expect(rules.zoneQuality).toBe(false);
    });
});

describe('analyzeTimeframe Ghost Machine pattern matching', () => {
    const mkCandle = (o, h, l, c) => ({ o, h, l, c, v: 1e6, t: '2026-01-01T08:30:00Z' });
    const buildCandles = () => ([
        ...Array.from({ length: 18 }, () => mkCandle(100, 101, 99, 100)),
        mkCandle(101, 101, 99, 100),
        mkCandle(98, 103, 97, 102)
    ]);

    const wireGhostStubs = (context, session = { session: 'LONDON KZ + SB', multiplier: 1.5, emoji: '🏹', isKillzone: true, isSilverBullet: true, isMacro: false }) => {
        context.atr = () => 2;
        context.getTechnicalIndicators = jest.fn().mockResolvedValue({ rsi: 55 });
        context.score = jest.fn(() => ({ dir: 'BUY', conf: 10 }));
        context.detectTurtleSoup = jest.fn(() => ({ detected: false, type: null }));
        context.detectLiquiditySweeps = jest.fn(() => [{ direction: 'BULLISH', distance: 1 }]);
        context.detectMSS = jest.fn(() => ({ type: 'BULL', displaced: true }));
        context.calculateMSNR = jest.fn(() => ({
            pivot: 100,
            supports: { S1: 95, S2: 94, S3: 93 },
            resistances: { R1: 105, R2: 106, R3: 107 },
            allSupports: [99, 98],
            allResistances: [101, 102]
        }));
        context.findPrecisionEntry = jest.fn(() => ({ low: 98, high: 100, p: 99, src: 'MSNR', confluence: 'MSNR', cc: 1, quality: 'C', hasImbalance: false }));
        context.checkZoneFreshness = jest.fn(() => ({ fresh: true, partiallyUsed: false, used: false, touches: 0, violations: 0 }));
        context.getSession = jest.fn(() => session);
        context.detectCRT = jest.fn(() => ({ detected: true, pattern: 'CRT' }));
        context.gradeTBS = jest.fn(() => ({ grade: 'A', score: 80 }));
        context.getCRTState = jest.fn(() => ({ state: 'EXPANDING', momentum: 'STRONG', isContracting: false }));
        context.detectOrderBlocks = jest.fn(() => []);
        context.detectFVG = jest.fn(() => []);
        context.detectBreakers = jest.fn(() => []);
        context.findImbalances = jest.fn(() => []);
        context.findSwings = jest.fn(() => ({ L: [], H: [] }));
        context.detectDisplacement = jest.fn(() => ({ detected: true }));
        context.analyzeAMD = jest.fn(() => ({ phase: 'UNKNOWN' }));
        context.getVolatilityLevel = jest.fn(() => ({ level: 'High', desc: 'Large candles' }));
        context.calcVolumeProfile = jest.fn(() => null);
        context.calcDeltaProxy = jest.fn(() => ({ cvd: 0, direction: 'NEUTRAL' }));
        context.isHTFPremiumDiscount = jest.fn(() => ({ inPremiumDiscount: false }));
        context.detectTrend = jest.fn(() => 'BULLISH');
        context.checkCHoCH = jest.fn(() => true);
        context.detectInducement = jest.fn(() => true);
        context.checkEntryTiming = jest.fn(() => ({ valid: true }));
        context.checkZoneMagnetism = jest.fn(() => ({ magnetism: 'STRONG', score: 80, summary: 'Strong', checks: [], likelyToReach: true }));
        context.checkPathClearance = jest.fn(() => ({ clear: true, obstacles: [] }));
        context.checkSniperRejection = jest.fn().mockResolvedValue({ confirmed: true });
        context.checkSniperEntry = jest.fn(() => ({ isSniper: true, path: 'ICT', score: 80, grade: 'S', checks: [] }));
        context.validateBreakerBlock = jest.fn(() => false);
        context.findPDArrays = jest.fn(() => []);
        context.isZoneWithinHTFArray = jest.fn(() => ({ contained: false, partial: false, parentArray: null }));
    };

    it('returns a Ghost Machine BUY setup using score-based dual-direction analysis', async () => {
        const context = getContext();
        const candles = buildCandles();
        // Use the real atr (called before stubs override context.atr) to match
        // the value analyzeTimeframe computes internally from the lexical atr binding.
        const atrValue = context.atr(candles, 14);
        // Entry: zone.low + ATR*0.1 (zone.low=98)
        const expectedEntry = Math.min(98 + atrValue * 0.1, 100);
        // SL: min(zone.low - ATR*0.3, crtRange.low) where crtRange.low = min of candle lows = 97
        const crtLow = Math.min(...candles.slice(-20).map(c => c.l));
        const expectedSl = Math.min(98 - atrValue * 0.3, crtLow);
        const expectedRisk = Math.abs(expectedEntry - expectedSl);
        // Entry-distance label is computed inside analyzeTimeframe using the same atr
        const entryDistanceLabel = `Entry ${((100 - expectedEntry) / atrValue).toFixed(1)}x ATR away`;
        wireGhostStubs(context);

        const res = await context.analyzeTimeframe('1H', 100, { '5M': candles, '15M': candles, '1H': candles, '4H': candles, '1D': candles });

        expect(res.direction).toBe('BUY');
        expect(res.entry).toBeCloseTo(expectedEntry);
        expect(res.sl).toBeCloseTo(expectedSl);
        expect(res.tp1).toBeCloseTo(expectedEntry + expectedRisk * 2);
        expect(res.tp2).toBeCloseTo(expectedEntry + expectedRisk * 4);
        expect(res.tp3).toBe(103);
        expect(res.confidence).toBe(95);
        expect(res.confirmation).toBe(false);
        expect(res.hasSweep).toBe(true);
        expect(res.rrUsed).toBe(4);
        expect(res.score).toBe(85);
        expect(res.confBreakdown).toEqual([
            { adj: 25, reason: 'Liquidity Sweep' },
            { adj: 25, reason: '5x BOS confirmed' },
            { adj: 15, reason: 'MSS with displacement' },
            { adj: 10, reason: 'Fresh zone' },
            { adj: 10, reason: entryDistanceLabel }
        ]);
    });

    it('finds a setup regardless of session (Silver Bullet gate removed)', async () => {
        const context = getContext();
        const candles = buildCandles();
        wireGhostStubs(context, { session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true, isSilverBullet: false, isMacro: false });

        const res = await context.analyzeTimeframe('1H', 100, { '5M': candles, '15M': candles, '1H': candles, '4H': candles, '1D': candles });

        expect(res).not.toBeNull();
        expect(res.direction).toBe('BUY');
        expect(res.score).toBeGreaterThanOrEqual(65);
        expect(res.session.isSilverBullet).toBe(false);
    });
});

describe('runAutoScan Ghost Machine timeframe handling', () => {
    const makeElements = () => {
        const mk = () => ({ addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '', className: '', disabled: true });
        return {
            analyzeBtn: mk(),
            scanStatus: mk(),
            scanText: mk(),
            scanProgressFill: mk(),
            currentPrice: mk(),
            priceChange: mk(),
            executeBtn: mk()
        };
    };

    const makeSetup = (timeframe, confidence, extra = {}) => ({
        timeframe,
        direction: 'BUY',
        entry: 100,
        sl: 99,
        tp1: 102,
        tp2: 104,
        tp3: 106,
        confidence,
        zone: { low: 99.5, high: 100.5, p: 100, src: 'MSNR', confluence: 'MSNR', cc: 1, quality: 'A', hasImbalance: false },
        slResult: { reason: 'Below Zone' },
        risk: 1,
        rrDisplay: '2.0',
        rrUsed: 2,
        premiumDiscount: false,
        ghostRules: null,
        breakerValid: false,
        freshness: { fresh: true, partiallyUsed: false, violations: 0 },
        confirmation: true,
        hasSweep: true,
        mss: { type: 'BULL', displaced: true },
        session: { session: 'LONDON KZ + SB', emoji: '🏹', multiplier: 1.5, isSilverBullet: true },
        mtf: { direction: 'BULLISH', strength: 5 },
        volatility: { level: 'High', desc: 'Large candles' },
        entryTF: timeframe,
        trendTF: '1D',
        structureTF: '1H',
        sniperTF: timeframe,
        tfAlign: 'ALIGNED',
        entryReady: true,
        invalidationPrice: 98,
        zoneTouches: 0,
        htfValidation: { passed: true, parentArray: null },
        alternativeZones: [],
        zonesEvaluated: 1,
        magnetism: { magnetism: 'STRONG', score: 80, summary: 'Strong', checks: [] },
        pathCheck: { clear: true, obstacles: [] },
        probCheck: { probability: 'HIGH' },
        sniperEntry: { isSniper: true, path: 'ICT', score: 80, grade: 'S', checks: [] },
        sniperRej: { confirmed: true },
        turtleSoup: { detected: false, type: 'NONE' },
        obsAll: [],
        fvgsAll: [],
        twelveIndicators: { rsi: 55, atr_api: 1.2 },
        volumeProfile: null,
        deltaProxy: { cvd: 0, direction: 'NEUTRAL' },
        msnr: { pivot: 100, supports: {}, resistances: {} },
        sweeps: [{ type: 'BULLISH', level: 99, distance: 0.5 }],
        apiATR: 1.2,
        displacement: { detected: true },
        crt: { detected: true, pattern: 'CRT' },
        crtState: { state: 'EXPANDING', momentum: 'STRONG', isExpanding: true },
        crtRange: { high: 106, low: 98 },
        isInOptimalZone: true,
        tbsQuality: { grade: 'A', score: 80 },
        msnrDistance: 0,
        isNearMSNR: false,
        entryTiming: { valid: true, reason: 'OK' },
        setupScore: 80,
        winProbability: 70,
        expectedValue: 1,
        signalGrade: 'A',
        context: {},
        tradeLevels: { stopLoss: 99, takeProfit: 102, partialTP: 104, invalidation: 98, pipsRisk: 10, pipsReward: 20, riskReward: 2 },
        zoneReaction: { type: 'Bounce' },
        amd: { phase: 'ACCUMULATION' },
        confBreakdown: [],
        ...extra
    });

    const setupScanContext = (analyzeTimeframe, qualityFor = r => r.mockQuality ?? 0) => {
        const elements = makeElements();
        let jsonOut = null;
        const context = getContext({
            document: {
                getElementById: id => elements[id] || (elements[id] = { addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '', className: '', disabled: true }),
                addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null
            }
        });
        vm.runInContext("TWELVE_DATA_KEY = 'demo-key';", context);
        context.getPrice = jest.fn().mockResolvedValue(100);
        context.getHistory = jest.fn().mockResolvedValue([{ o: 100, h: 101, l: 99, c: 100, v: 1e6, t: '2026-01-01T08:30:00Z' }]);
        context.getQuoteDirection = jest.fn().mockResolvedValue('BULLISH');
        context.updateMTFDisplay = jest.fn().mockResolvedValue();
        context.analyzeTimeframe = jest.fn(analyzeTimeframe);
        context.calculateSetupQuality = jest.fn(qualityFor);
        context.askAIWithAllResults = jest.fn().mockResolvedValue(null);
        context.checkHTFConfluenceAsync = jest.fn().mockResolvedValue({ level: 'FULL', daily: 'BULLISH', h4: 'BULLISH', penalty: 0 });
        context.setJsonOutput = jest.fn(out => { jsonOut = out; });
        context.showNotif = jest.fn();
        context.isSetupStillValid = jest.fn(() => true);
        context.getSession = jest.fn(() => ({ session: 'LONDON KZ + SB', emoji: '🏹', multiplier: 1.5, isSilverBullet: true }));
        return { context, elements, getJson: () => jsonOut };
    };

    it('keeps a lower timeframe Ghost Machine setup when it outranks a higher timeframe one', async () => {
        const day = makeSetup('1D', 80, { mockQuality: 95 });
        const five = makeSetup('5M', 90, { mockQuality: 10 });
        const { context, elements, getJson } = setupScanContext(async tf => ({ '1D': day, '5M': five }[tf] || null), r => r.mockQuality);

        await context.runAutoScan();

        const out = getJson().auto_scan_result;
        expect(out.best_timeframe).toBe('5M');
        expect(out.total_setups_found).toBe(2);
        expect(out.trade_signal.confidence).toBe(90);
        expect(out.status).toBe('GHOST_MACHINE_SETUP');
        expect(elements.executeBtn.disabled).toBe(false);
    });

    it('does not reject a valid lower timeframe setup because of a low quality score', async () => {
        const five = makeSetup('5M', 90, { mockQuality: 12 });
        const { context, getJson } = setupScanContext(async tf => (tf === '5M' ? five : null), r => r.mockQuality);

        await context.runAutoScan();

        const out = getJson().auto_scan_result;
        expect(out.best_timeframe).toBe('5M');
        expect(out.quality_score).toBe(12);
        expect(out.status).toBe('GHOST_MACHINE_SETUP');
        expect(out.trade_signal.confidence).toBe(90);
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

describe('checkHTFConfluenceAsync PARTIAL asymmetry', () => {
    const context = getContext();
    const trend = (up) => Array.from({ length: 60 }, (_, i) => {
        const c = up ? 100 + i : 160 - i;
        return { o: c - 0.5, h: c + 1, l: c - 1, c, v: 1e6 };
    });

    it('penalizes less when the 1D agrees and only 4H opposes', async () => {
        const r = await context.checkHTFConfluenceAsync(trend(true), trend(false), 'BUY');
        expect(r.level).toBe('PARTIAL');
        expect(r.alignedTF).toBe('1D');
        expect(r.penalty).toBe(8);
    });

    it('penalizes more when only the 4H agrees', async () => {
        const r = await context.checkHTFConfluenceAsync(trend(false), trend(true), 'BUY');
        expect(r.level).toBe('PARTIAL');
        expect(r.alignedTF).toBe('4H');
        expect(r.penalty).toBe(15);
    });

    it('still skips-worthy on full conflict', async () => {
        const r = await context.checkHTFConfluenceAsync(trend(false), trend(false), 'BUY');
        expect(r.level).toBe('CONFLICT');
        expect(r.penalty).toBe(30);
    });
});

describe('checkZoneMagnetism primary-method zones', () => {
    const context = getContext();
    const trend = Array.from({ length: 60 }, (_, i) => {
        const base = 100 + i * 0.2;
        return { o: base, h: base + 0.4, l: base - 0.2, c: base + 0.1, v: 1e6 };
    });

    it('keeps a nearby MSNR multi-confluence zone reachable even without a sweep magnet', () => {
        const zone = { src: 'MSNR', confluence: 'MSNR+Swing', quality: 'A', cc: 2 };
        const res = context.checkZoneMagnetism(trend, 112.56, 112.0, 'BUY', zone);
        expect(res.score).toBeGreaterThanOrEqual(35);
        expect(res.likelyToReach).toBe(true);
    });

    it('does not promote a generic single-confluence zone on the same price action', () => {
        const zone = { src: 'FVG', confluence: 'FVG', quality: 'C', cc: 1 };
        const res = context.checkZoneMagnetism(trend, 112.56, 112.0, 'BUY', zone);
        expect(res.score).toBeLessThan(35);
        expect(res.likelyToReach).toBe(false);
    });
});

describe('OTE band orientation', () => {
    const context = getContext();
    // clean range: 40 candles spanning exactly 100..120, price mid-range
    const candles = Array.from({ length: 40 }, (_, i) => {
        const o = 105 + (i % 5);
        return { o, h: Math.min(o + 8, 120), l: Math.max(o - 8, 100), c: o + 1, v: 1e6 };
    });
    candles[10] = { o: 100, h: 120, l: 100, c: 119, v: 1e6 }; // pin the extremes

    it('BUY fallback OTE zone sits in discount (lower half of the range)', () => {
        const price = 110;
        const msnr = context.calculateMSNR(candles, price);
        // force the fallback by asking in a structure-free window
        const flat = Array.from({ length: 25 }, () => ({ o: 110, h: 120, l: 100, c: 110, v: 1e6 }));
        const zone = context.findPrecisionEntry(flat, price, 'BUY', msnr);
        if (zone.src === 'OTE') {
            const mid = 110; // range midpoint of 100..120
            expect(zone.high).toBeLessThan(mid);   // discount side
            expect(zone.low).toBeGreaterThanOrEqual(100);
        }
    });

    it('SELL fallback OTE zone sits in premium (upper half of the range)', () => {
        const price = 110;
        const msnr = context.calculateMSNR(candles, price);
        const flat = Array.from({ length: 25 }, () => ({ o: 110, h: 120, l: 100, c: 110, v: 1e6 }));
        const zone = context.findPrecisionEntry(flat, price, 'SELL', msnr);
        if (zone.src === 'OTE') {
            const mid = 110;
            expect(zone.low).toBeGreaterThan(mid); // premium side
            expect(zone.high).toBeLessThanOrEqual(120);
        }
    });
});

describe('findPrecisionEntry zone side', () => {
    const context = getContext();
    // downtrend then sharp rally: bullish OBs form near the top, above where
    // price sits after a pullback - those must NOT be offered as BUY zones
    const candles = [];
    let p = 120;
    for (let i = 0; i < 40; i++) { candles.push({ o: p, h: p + 1, l: p - 2, c: p - 1.5, v: 1e6 }); p -= 1.5; }
    for (let i = 0; i < 10; i++) { candles.push({ o: p, h: p + 3.5, l: p - 0.5, c: p + 3, v: 1e6 }); p += 3; }

    it('never returns a BUY zone at or above current price', () => {
        const price = candles[candles.length - 1].c - 5; // price pulled back below the rally
        const msnr = context.calculateMSNR(candles, price);
        const zone = context.findPrecisionEntry(candles, price, 'BUY', msnr);
        // OB/FVG/MSNR zones must sit below price; only the OTE fallback may straddle
        if (zone.src !== 'OTE') expect(zone.high).toBeLessThan(price);
    });
});

describe('calcVolumeProfile', () => {
    const context = getContext();
    // 30 candles ranging 100-124, with heavy volume concentrated around 110-112
    const candles = [];
    for (let i = 0; i < 30; i++) {
        const base = 100 + (i % 12) * 2;
        const heavy = base >= 110 && base <= 112;
        candles.push({ o: base, h: base + 2, l: base, c: base + 1, v: heavy ? 10000 : 1000 });
    }

    it('returns null when there is not enough data', () => {
        expect(context.calcVolumeProfile([])).toBeNull();
        expect(context.calcVolumeProfile(candles.slice(0, 5))).toBeNull();
    });

    it('puts the POC inside the heavy-volume area', () => {
        const vp = context.calcVolumeProfile(candles);
        expect(vp.poc).toBeGreaterThanOrEqual(109);
        expect(vp.poc).toBeLessThanOrEqual(114);
    });

    it('keeps VAL <= POC <= VAH within the data range', () => {
        const vp = context.calcVolumeProfile(candles);
        expect(vp.val).toBeLessThanOrEqual(vp.poc);
        expect(vp.vah).toBeGreaterThanOrEqual(vp.poc);
        expect(vp.low).toBe(100);
        expect(vp.high).toBe(124);
    });

    it('finds low-volume nodes away from the concentration', () => {
        const vp = context.calcVolumeProfile(candles);
        expect(vp.lvns.length).toBeGreaterThan(0);
        // heavy candles open at 110-112 and span two points, so bins from
        // 110 up to ~115 carry the concentration; LVNs must sit outside it
        expect(vp.lvns.every(p => p < 110 || p > 115)).toBe(true);
    });
});

describe('calcDeltaProxy', () => {
    const context = getContext();

    it('is bullish when up-candle volume dominates', () => {
        const up = Array.from({ length: 20 }, () => ({ o: 100, c: 101, h: 101, l: 100, v: 500 }));
        expect(context.calcDeltaProxy(up).direction).toBe('BULLISH');
    });

    it('is bearish when down-candle volume dominates', () => {
        const down = Array.from({ length: 20 }, () => ({ o: 101, c: 100, h: 101, l: 100, v: 500 }));
        expect(context.calcDeltaProxy(down).direction).toBe('BEARISH');
    });

    it('is always labeled as a proxy', () => {
        expect(context.calcDeltaProxy([]).proxy).toBe(true);
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

    it('reports all six checks with critical flags', () => {
        const res = context.checkSniperEntry(flat, 106, 'BUY', zone, null);
        expect(res.checks).toHaveLength(6);
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

    it('drops selected_timeframe when not in the allowed list', () => {
        const r = context.validateAIResult(mk({ selected_timeframe: '3M' }), best, price, ['1H', '4H']);
        expect(r.trade_signal_Theghostmachine.selected_timeframe).toBeUndefined();
        const r2 = context.validateAIResult(mk({ selected_timeframe: '4H' }), best, price, ['1H', '4H']);
        expect(r2.trade_signal_Theghostmachine.selected_timeframe).toBe('4H');
    });

    it('drops rule_checks when not an array', () => {
        const r = context.validateAIResult(mk({ rule_checks: 'all good' }), best, price);
        expect(r.trade_signal_Theghostmachine.rule_checks).toBeUndefined();
        const checks = [{ rule: 1, verdict: 'PASS', note: 'ok' }];
        const r2 = context.validateAIResult(mk({ rule_checks: checks }), best, price);
        expect(r2.trade_signal_Theghostmachine.rule_checks).toEqual(checks);
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
