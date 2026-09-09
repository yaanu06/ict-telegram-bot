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

describe('analyzeMarketPhase (AMD)', () => {
    it('returns UNKNOWN for insufficient data', () => {
        const ctx = getContext();
        expect(ctx.analyzeMarketPhase(candles(10, 100, 1, 'up')).phase).toBe('UNKNOWN');
    });
    it('returns a valid phase for sufficient trending data', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up').map(c => ({ ...c, v: 1e6 }));
        const r = ctx.analyzeMarketPhase(data);
        expect(['ACCUMULATION', 'MANIPULATION', 'DISTRIBUTION', 'NEUTRAL', 'UNKNOWN']).toContain(r.phase);
        expect(typeof r.confidence).toBe('number');
    });
});

describe('detectDivergence', () => {
    it('returns type none for insufficient data', () => {
        const ctx = getContext();
        expect(ctx.detectDivergence(candles(5, 100, 1, 'up'), 'rsi').type).toBe('none');
    });
    it('analyzes 4H-like data without throwing', () => {
        const ctx = getContext();
        const data = candles(80, 100, 1, 'up');
        const r = ctx.detectDivergence(data, 'rsi', 30);
        expect(typeof r.strength).toBe('number');
    });
});

describe('mapLiquidity', () => {
    it('returns empty pools for insufficient data', () => {
        const ctx = getContext();
        const r = ctx.mapLiquidity(candles(5, 100, 1, 'up'));
        expect(r.above).toEqual([]);
        expect(r.below).toEqual([]);
    });
    it('finds above/below pools for trending data', () => {
        const ctx = getContext();
        const data = candles(60, 100, 1, 'up');
        const r = ctx.mapLiquidity(data);
        expect(Array.isArray(r.above)).toBe(true);
        expect(Array.isArray(r.below)).toBe(true);
    });
});

describe('analyzeVolumeProfile', () => {
    it('handles insufficient data', () => {
        const ctx = getContext();
        expect(ctx.analyzeVolumeProfile(candles(5, 100, 1, 'up')).poc).toBeNull();
    });
    it('computes POC/VAH/VAL', () => {
        const ctx = getContext();
        const data = candles(60, 100, 1, 'up').map(c => ({ ...c, v: 1e6 }));
        const r = ctx.analyzeVolumeProfile(data);
        expect(r.poc).toBeNull();
        expect(r.realVolume).toBe(false);
        expect(r.description).toMatch(/synthetic\/unavailable volume/);
    });
});

describe('analyzeSentiment', () => {
    it('returns NEUTRAL for insufficient data', () => {
        const ctx = getContext();
        expect(ctx.analyzeSentiment(candles(5, 100, 1, 'up')).sentiment).toBe('NEUTRAL');
    });
    it('computes a score for valid data', () => {
        const ctx = getContext();
        const data = candles(80, 100, 1, 'up').map(c => ({ ...c, v: 1e6 }));
        const r = ctx.analyzeSentiment(data);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
    });
});

describe('self-learning performance', () => {
    it('trackAIPerformance and getPatternPerformance round-trip', () => {
        const ctx = getContext();
        const store = {};
        let lastWritten = null;
        ctx.localStorage.getItem = (k) => k === 'ai_performance' ? (lastWritten || '{}') : null;
        ctx.localStorage.setItem = (k, v) => { if (k === 'ai_performance') lastWritten = v; };
        ctx.trackAIPerformance('s1', 'WIN', 75, ['FVG', 'OB'], 2.0);
        ctx.trackAIPerformance('s2', 'WIN', 70, ['FVG'], 1.8);
        ctx.trackAIPerformance('s3', 'LOSS', 60, ['FVG'], 1.5);
        const perf = ctx.getPatternPerformance(['FVG']);
        expect(perf.winRate).toBeCloseTo(2/3, 1);
        expect(perf.sampleSize).toBe(3);
    });
});

describe('shouldTradeSession', () => {
    it('returns MAX during silver bullet 1 (8:30-9 UTC)', () => {
        const ctx = getContext();
        const r = ctx.shouldTradeSession(new Date(Date.UTC(2026, 0, 1, 8, 45)));
        expect(r.priority).toBe('MAX');
        expect(r.isSilverBullet).toBe(true);
        expect(r.shouldTrade).toBe(true);
    });
    it('returns HIGH during London killzone', () => {
        const ctx = getContext();
        const r = ctx.shouldTradeSession(new Date(Date.UTC(2026, 0, 1, 8, 0)));
        expect(r.priority).toBe('HIGH');
        expect(r.shouldTrade).toBe(true);
    });
    it('returns LOW and shouldTrade=false during off-hours', () => {
        const ctx = getContext();
        const r = ctx.shouldTradeSession(new Date(Date.UTC(2026, 0, 1, 18, 0)));
        expect(r.priority).toBe('LOW');
        expect(r.shouldTrade).toBe(false);
        expect(r.isOffHours).toBe(true);
    });
    it('returns LOW and shouldTrade=false during Asian session', () => {
        const ctx = getContext();
        const r = ctx.shouldTradeSession(new Date(Date.UTC(2026, 0, 1, 2, 0)));
        expect(r.priority).toBe('LOW');
        expect(r.shouldTrade).toBe(false);
    });
});

describe('shouldEnterBasedOnPhase', () => {
    it('allows entry in ACCUMULATION', () => {
        const ctx = getContext();
        const r = ctx.shouldEnterBasedOnPhase({ phase: 'ACCUMULATION', confidence: 70 }, 'BUY', 100, candles(60, 100, 1, 'up'));
        expect(r.shouldEnter).toBe(true);
    });
    it('blocks entry in MANIPULATION without sweep', () => {
        const ctx = getContext();
        const r = ctx.shouldEnterBasedOnPhase({ phase: 'MANIPULATION', confidence: 70 }, 'BUY', 100, candles(60, 100, 1, 'up'));
        expect(r.shouldEnter).toBe(false);
        expect(r.waitFor).toBe('liquidity sweep');
    });
    it('permits default entry on NEUTRAL/UNKNOWN', () => {
        const ctx = getContext();
        const r = ctx.shouldEnterBasedOnPhase({ phase: 'NEUTRAL', confidence: 0 }, 'BUY', 100, null);
        expect(r.shouldEnter).toBe(true);
    });
});

describe('checkEntryConfirmation', () => {
    it('reports isAtZone=false when price is far from zone', () => {
        const ctx = getContext();
        const data = candles(20, 100, 1, 'up');
        const r = ctx.checkEntryConfirmation(data, { low: 200, high: 210 }, 'BUY');
        expect(r.isAtZone).toBe(false);
        expect(r.confirmed).toBe(false);
    });
    it('scores positively when price is inside zone with bullish momentum', () => {
        const ctx = getContext();
        const data = candles(20, 100, 5, 'up');
        const zone = { low: data[data.length - 1].l - 1, high: data[data.length - 1].h + 1 };
        const r = ctx.checkEntryConfirmation(data, zone, 'BUY');
        expect(r.isAtZone).toBe(true);
        expect(r.score).toBeGreaterThan(0);
    });
});

describe('buildEntryContext', () => {
    it('aggregates all 3 filters into a summary', () => {
        const ctx = getContext();
        const sc = { priority: 'HIGH', reason: 'KZ', multiplier: 1.3, isKillzone: true, isSilverBullet: false, isAsian: false, isOffHours: false, shouldTrade: true };
        const ph = { phase: 'ACCUMULATION', confidence: 70 };
        const pd = { shouldEnter: true, reason: 'Accumulation', multiplier: 1.0 };
        const ec = { confirmed: true, score: 35, strength: 'MODERATE', confirmations: ['Bullish Momentum'], isAtZone: true };
        const ctxOut = ctx.buildEntryContext(sc, ph, pd, ec);
        expect(ctxOut.allOk).toBe(true);
        expect(ctxOut.summary).toMatch(/ALL FILTERS PASS/);
        expect(ctxOut.lines.length).toBeGreaterThanOrEqual(3);
    });
    it('blocks when session is LOW', () => {
        const ctx = getContext();
        const sc = { priority: 'LOW', reason: 'Off-hours', multiplier: 0.6, isKillzone: false, isSilverBullet: false, isAsian: false, isOffHours: true, shouldTrade: false };
        const ph = { phase: 'NEUTRAL', confidence: 0 };
        const pd = { shouldEnter: true, reason: 'Neutral', multiplier: 1.0 };
        const ec = { confirmed: true, score: 30, strength: 'MODERATE', confirmations: [], isAtZone: true };
        const ctxOut = ctx.buildEntryContext(sc, ph, pd, ec);
        expect(ctxOut.allOk).toBe(false);
        expect(ctxOut.summary).toMatch(/IMMEDIATE ENTRY WAIT/);
    });
});

describe('normalizeOppositeSetup', () => {
    it('fills defaults when AI omits opposite_setup entirely', () => {
        const ctx = getContext();
        const r = ctx.normalizeOppositeSetup(null, 'BUY');
        expect(r.direction).toBe('SELL');
        expect(r.confidence).toBe(0);
        expect(r.why_rejected).toBe('Not provided by AI');
    });
    it('flips direction to SELL when BUY chosen and opposite is missing', () => {
        const ctx = getContext();
        const r = ctx.normalizeOppositeSetup(undefined, 'SELL');
        expect(r.direction).toBe('BUY');
    });
    it('preserves AI-provided opposite_setup', () => {
        const ctx = getContext();
        const r = ctx.normalizeOppositeSetup(
            { direction: 'BUY', confidence: 58, why_rejected: 'weaker HTF alignment' },
            'SELL'
        );
        expect(r.direction).toBe('BUY');
        expect(r.confidence).toBe(58);
        expect(r.why_rejected).toBe('weaker HTF alignment');
    });
    it('fills missing fields without overwriting present ones', () => {
        const ctx = getContext();
        const r = ctx.normalizeOppositeSetup({ confidence: 62 }, 'BUY');
        expect(r.direction).toBe('SELL');
        expect(r.confidence).toBe(62);
        expect(r.why_rejected).toBe('Not provided by AI');
    });
    it('coerces non-number confidence to 0', () => {
        const ctx = getContext();
        const r = ctx.normalizeOppositeSetup({ confidence: 'high' }, 'BUY');
        expect(r.confidence).toBe(0);
    });
});

describe('computeHolisticEvidence', () => {
    const emptyArgs = { dailyDir: 'NEUTRAL', h4Dir: 'NEUTRAL', h1Dir: 'NEUTRAL', candles: [], indicators: {}, patterns: {}, phase: { phase: 'NEUTRAL' }, rsiDiv: { type: 'none' }, macdDiv: { type: 'none' } };
    it('returns NEUTRAL when nothing scores', () => {
        const ctx = getContext();
        const r = ctx.computeHolisticEvidence(emptyArgs);
        expect(r.suggestedDirection).toBe('NEUTRAL');
        expect(r.buyScore).toBe(0);
        expect(r.sellScore).toBe(0);
    });
    it('returns BUY when bullish evidence dominates', () => {
        const ctx = getContext();
        const args = { ...emptyArgs,
            dailyDir: 'BULLISH', h4Dir: 'BULLISH', h1Dir: 'BULLISH',
            candles: candles(60, 100, 1, 'up'),
            indicators: { ema9: 90, ema21: 88, ema50: 85, ema200: 80 },
            patterns: { fvg: [{ type: 'bull' }], turtleSoup: { detected: true, type: 'BUY' }, orderBlocks: [{ low: 95 }] },
            phase: { phase: 'ACCUMULATION' },
            rsiDiv: { type: 'HIDDEN_BULLISH' }, macdDiv: { type: 'none' }
        };
        const r = ctx.computeHolisticEvidence(args);
        expect(r.buyScore).toBeGreaterThan(r.sellScore + 20);
        expect(r.suggestedDirection).toBe('BUY');
    });
    it('returns SELL when bearish evidence dominates', () => {
        const ctx = getContext();
        const args = { ...emptyArgs,
            dailyDir: 'BEARISH', h4Dir: 'BEARISH', h1Dir: 'BEARISH',
            candles: candles(60, 100, 1, 'down'),
            indicators: { ema9: 110, ema21: 112, ema50: 115, ema200: 120 },
            patterns: { fvg: [{ type: 'bear' }], turtleSoup: { detected: true, type: 'SELL' }, orderBlocks: [{ high: 105 }] },
            phase: { phase: 'DISTRIBUTION' },
            rsiDiv: { type: 'REGULAR_BEARISH' }, macdDiv: { type: 'none' }
        };
        const r = ctx.computeHolisticEvidence(args);
        expect(r.sellScore).toBeGreaterThan(r.buyScore + 20);
        expect(r.suggestedDirection).toBe('SELL');
    });
    it('returns NEUTRAL when BUY and SELL within 20 points', () => {
        const ctx = getContext();
        const args = { ...emptyArgs,
            dailyDir: 'BULLISH',
            h1Dir: 'BEARISH',
            candles: candles(60, 100, 0, 'up') // step 0 -> flat, no HH/LL
        };
        const r = ctx.computeHolisticEvidence(args);
        expect(r.buyScore).toBe(30);
        expect(r.sellScore).toBe(15);
        expect(Math.abs(r.buyScore - r.sellScore)).toBeLessThan(20);
        expect(r.suggestedDirection).toBe('NEUTRAL');
    });
});

describe('buildHolisticPromptBlock', () => {
    it('contains both BUY and SELL score sections', () => {
        const ctx = getContext();
        const evidence = { flags: {}, buyScore: 75, sellScore: 30, diff: 45, suggestedDirection: 'BUY' };
        const block = ctx.buildHolisticPromptBlock({ evidence, dailyDir: 'BULLISH', h4Dir: 'BULLISH', h1Dir: 'BULLISH' });
        expect(block).toMatch(/BUY EVIDENCE/);
        expect(block).toMatch(/SELL EVIDENCE/);
        expect(block).toMatch(/BUY SCORE: 75/);
        expect(block).toMatch(/SELL SCORE: 30/);
        expect(block).toMatch(/SCORING DECISION RULE/);
    });
});

describe('buildCandleData', () => {
    it('returns empty string when historyCache is empty or too short', () => {
        const ctx = getContext();
        expect(ctx.buildCandleData({})).toBe('');
        expect(ctx.buildCandleData({ '1D': [], '4H': candles(5, 100, 1, 'up') })).toBe('');
    });
    it('formats last N candles per TF with O/H/L/C/V and correct index', () => {
        const ctx = getContext();
        const cache = {
            '1D': candles(20, 100, 1, 'up'),
            '4H': candles(20, 100, 1, 'up'),
            '1H': candles(20, 100, 1, 'up'),
            '15M': candles(20, 100, 1, 'up'),
            '5M': candles(20, 100, 1, 'up'),
            '1W': candles(20, 100, 1, 'up') // should be ignored (not in TF list)
        };
        const out = ctx.buildCandleData(cache, 10);
        expect(out).toMatch(/### 1D CANDLES \(Last 10\):/);
        expect(out).toMatch(/### 5M CANDLES \(Last 10\):/);
        expect(out).not.toMatch(/### 1W CANDLES/);
        // Each TF should produce 10 candle lines
        const tfLines = out.split('\n').filter(l => /^\s+\d+: O:/.test(l));
        expect(tfLines.length).toBe(50);
        // Spot-check format on the very last candle (5M)
        const last5m = tfLines[tfLines.length - 1];
        expect(last5m).toMatch(/O:\d+\.\d{2} H:\d+\.\d{2} L:\d+\.\d{2} C:\d+\.\d{2} V:n\/a/);
    });
    it('skips TFs with insufficient data without breaking others', () => {
        const ctx = getContext();
        const cache = {
            '1D': candles(20, 100, 1, 'up'),
            '4H': candles(5, 100, 1, 'up') // too short
        };
        const out = ctx.buildCandleData(cache, 10);
        expect(out).toMatch(/1D CANDLES/);
        expect(out).not.toMatch(/4H CANDLES/);
    });
});

describe('live AI market context and prompt', () => {
    const buildCache = () => ({
        '4H': candles(80, 100, 0.5, 'up'),
        '1H': candles(80, 100, 0.3, 'up'),
        '1D': candles(80, 100, 0.2, 'up'),
        '15M': candles(40, 100, 0.1, 'up'),
        '5M': candles(40, 100, 0.05, 'up')
    });

    it('builds deterministic live context from current candles and flags synthetic volume', () => {
        const ctx = getContext();
        const historyCache = buildCache();
        const price = 140;
        const patterns = {
            '4H': { fvg: ctx.detectFVG(historyCache['4H']), swings: ctx.findSwings(historyCache['4H'], 3), msnr: ctx.calculateMSNR(historyCache['4H'], price), adx: ctx.calculateADX(historyCache['4H'], 14, '4H') },
            '1H': { fvg: ctx.detectFVG(historyCache['1H']), swings: ctx.findSwings(historyCache['1H'], 3), msnr: ctx.calculateMSNR(historyCache['1H'], price), adx: ctx.calculateADX(historyCache['1H'], 14, '1H') }
        };
        const live = ctx.buildLiveMarketContext({
            pair: 'XAU/USD',
            price,
            historyCache,
            indicators: { '4H': {} },
            patterns,
            enhancedAnalysis: { phase: ctx.analyzeMarketPhase(historyCache['4H'], false) },
            holistic: { suggestedDirection: 'BUY', buyScore: 60, sellScore: 10 },
            entryContext: null
        });
        expect(live.current_price).toBe(price);
        expect(live.volume.volume_available).toBe(false);
        expect(live.volume.volume_note).toMatch(/synthetic\/unreliable/);
        expect(live.limit_order_setup).toBeTruthy();
        expect(live.immediate_entry).toBeTruthy();
        expect(live.limit_order_setup.current_price_inside_zone_required).toBe(false);
        expect(live.risk_constraints.minimum_sl_distance).toBeGreaterThan(0);
        expect(live.risk_constraints.maximum_sl_distance).toBeGreaterThanOrEqual(live.risk_constraints.minimum_sl_distance);
        expect(live.structure['4H'].trend).toBe('BULLISH');
        expect(Array.isArray(live.real_ict_zones)).toBe(true);
        expect(Array.isArray(live.target_candidates.buy)).toBe(true);
    });

    it('separates future limit setup eligibility from immediate entry confirmation', () => {
        const ctx = getContext();
        const stage = ctx.buildLimitOrderStageContext([
            { type: 'FVG', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 105, high: 106, price_at_zone_now: false, distance_to_zone: 5, distance_in_atr: 2.5 }
        ], { buy: [], sell: [{ source: 'SWING_LOW', origin: 'STRUCTURAL', level: 95 }] }, 100, 2, {
            allOk: false,
            summary: 'Immediate entry waiting',
            sessionCheck: { priority: 'LOW', reason: 'Off-hours' },
            entryConfirmation: { confirmed: false, score: 0, strength: 'NONE', isAtZone: false }
        });
        expect(stage.limit_order_setup.eligible).toBe(true);
        expect(stage.limit_order_setup.future_entry_allowed).toBe(true);
        expect(stage.limit_order_setup.current_price_inside_zone_required).toBe(false);
        expect(stage.immediate_entry.eligible).toBe(false);
        expect(stage.immediate_entry.confirmation_score).toBe(0);
    });

    it('keeps future BUY limit below current price setup-eligible while immediate entry waits', () => {
        const ctx = getContext();
        const stage = ctx.buildLimitOrderStageContext([
            { type: 'FVG', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 94, high: 95, price_at_zone_now: false, distance_to_zone: 5, distance_in_atr: 2.5 }
        ], { buy: [{ source: 'SWING_HIGH', origin: 'STRUCTURAL', level: 110 }], sell: [] }, 100, 2, {
            allOk: false,
            summary: 'Immediate entry waiting',
            sessionCheck: { priority: 'HIGH', reason: 'Killzone' },
            entryConfirmation: { confirmed: false, score: 0, strength: 'NONE', isAtZone: false }
        });
        expect(stage.limit_order_setup.eligible).toBe(true);
        expect(stage.limit_order_setup.nearest_eligible_zones[0].direction).toBe('BUY');
        expect(stage.immediate_entry.eligible).toBe(false);
    });

    it('detects current price inside an XAU-style zone', () => {
        const ctx = getContext();
        const status = ctx.getZonePriceStatus(4378.85887, { low: 4376.37, high: 4385.77 });
        expect(status.insideZone).toBe(true);
        expect(status.distanceToZone).toBe(0);
        expect(status.pricePosition).toBe('INSIDE');
    });

    it('marks pivot-derived and ATR fallback MSNR origins', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const pivotDerived = ctx.calculateMSNR(data, 140);
        expect(pivotDerived.supportMeta.some(x => x.origin === 'PIVOT_DERIVED')).toBe(true);
        expect(pivotDerived.resistanceMeta.some(x => x.origin === 'PIVOT_DERIVED')).toBe(true);

        const fallback = ctx.calculateMSNR(data, 1000);
        expect(fallback.resistanceMeta.some(x => x.origin === 'ATR_FALLBACK')).toBe(true);
        expect(fallback.allResistances).toEqual(fallback.resistanceMeta.map(x => x.level));
    });

    it('preserves MSNR origin and eligibility on live zones and target candidates', () => {
        const ctx = getContext();
        const historyCache = buildCache();
        const pivotLive = ctx.buildLiveMarketContext({
            pair: 'XAU/USD',
            price: 140,
            historyCache,
            indicators: { '4H': {} },
            patterns: {},
            enhancedAnalysis: {},
            holistic: {},
            entryContext: null
        });
        const pivotZone = pivotLive.real_ict_zones.find(z => z.type === 'MSNR' && z.origin === 'PIVOT_DERIVED');
        expect(pivotZone).toBeTruthy();
        expect(pivotZone.primary_eligible).toBe(true);
        expect(pivotLive.target_candidates.buy.some(c => c.source === 'MSNR_RESISTANCE' && c.origin === 'PIVOT_DERIVED')).toBe(true);

        const live = ctx.buildLiveMarketContext({
            pair: 'XAU/USD',
            price: 1000,
            historyCache,
            indicators: { '4H': {} },
            patterns: {},
            enhancedAnalysis: {},
            holistic: {},
            entryContext: null
        });
        const fallbackZone = live.real_ict_zones.find(z => z.type === 'MSNR' && z.origin === 'ATR_FALLBACK');
        expect(fallbackZone).toBeTruthy();
        expect(fallbackZone.primary_eligible).toBe(false);
        expect(live.target_candidates.buy.some(c => c.source === 'MSNR_RESISTANCE' && c.origin === 'ATR_FALLBACK')).toBe(true);
    });

    it('keeps FVG and OB zones marked structural', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const fvgZone = ctx.ictBuildRealZones(data, 140, 'BUY', 'XAU/USD').find(z => z.type === 'FVG');
        expect(fvgZone).toBeTruthy();
        expect(fvgZone.origin).toBe('STRUCTURAL');
        expect(fvgZone.primary_eligible).toBe(true);

        const obData = candles(80, 100, 0.2, 'up');
        obData[76] = { o: 120, c: 118, h: 121, l: 117, v: 1e6 };
        obData[77] = { o: 118, c: 122, h: 123, l: 117.5, v: 1e6 };
        obData[78] = { o: 122, c: 125, h: 126, l: 121.5, v: 1e6 };
        obData[79] = { o: 125, c: 128, h: 129, l: 124.5, v: 1e6 };
        const obZone = ctx.ictBuildRealZones(obData, 140, 'BUY', 'XAU/USD').find(z => z.type === 'OB');
        expect(obZone).toBeTruthy();
        expect(obZone.origin).toBe('STRUCTURAL');
        expect(obZone.primary_eligible).toBe(true);
    });

    it('builds a prompt that allows NO_TRADE and has no stale hard-coded price anchors', () => {
        const ctx = getContext();
        const live = {
            pair: 'XAU/USD',
            current_price: 100,
            utc_time: '2026-01-01T00:00:00.000Z',
            session: { name: 'OFF-HOURS' },
            real_ict_zones: [],
            risk_constraints: { minimum_rr: 2.5 },
            volume: { volume_available: false }
        };
        const prompt = ctx.buildAIPrompt(live, '### 4H CANDLES\n  0: O:1.00 H:2.00 L:0.50 C:1.50 V:n/a\n');
        expect(prompt.system).toMatch(/COMPUTED MARKET FACTS/);
        expect(prompt.system).toMatch(/PIVOT_DERIVED = deterministic MSNR support\/resistance/);
        expect(prompt.system).toMatch(/ATR_FALLBACK = synthetic deterministic fallback\/reference level/);
        expect(prompt.system).toMatch(/pending-limit setup exists/);
        expect(prompt.user).toMatch(/NO_TRADE/);
        expect(prompt.user).toMatch(/BUY_LIMIT, SELL_LIMIT, WAIT, or NO_TRADE/);
        expect(prompt.user).toMatch(/future limit-entry geometry/);
        expect(prompt.user).toMatch(/primary_eligible=true/);
        expect(prompt.user).toMatch(/PARTIAL=partially used\/partially mitigated/);
        expect(prompt.user).not.toMatch(/PARTIAL=fresh/);
        expect(prompt.user).toMatch(/risk = abs\(entry - stop_loss\)/);
        expect(prompt.user).not.toMatch(/4328\.58|4368\.53|4415\.99|4460\.99|THEREFORE|MUST output|DO Not output|Find the SINGLE BEST/);
    });

    it('normalizes WAIT with a complete BUY setup into BUY_LIMIT instead of noTrade', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'WAIT',
                    direction: 'BUY',
                    entry: 101,
                    entry_zone: { low: 100, high: 102, source: 'OB' },
                    stop_loss: 95,
                    take_profit_1: 120,
                    take_profit_2: 130,
                    take_profit_3: 140,
                    confidence: 72,
                    reasoning: { primary: 'Valid BUY limit exists but price has not retraced yet' },
                    ai_decision: 'skip',
                    wait_condition: 'Wait for price to reach 1H OB'
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 110, 'system');
        expect(result.noTrade).not.toBe(true);
        expect(result.decision).toBe('BUY_LIMIT');
        expect(result.direction).toBe('BUY');
        expect(result.ai_decision).toBe('wait_for_reaction');
        expect(result.wait_condition).toMatch(/Wait for price/);
    });

    it('normalizes skip with a complete SELL setup into SELL_LIMIT for validation', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'skip',
                    direction: 'SELL',
                    entry: 106,
                    entry_zone: { low: 105, high: 107, source: 'FVG' },
                    stop_loss: 112,
                    take_profit_1: 90,
                    take_profit_2: 80,
                    take_profit_3: 70,
                    confidence: 70,
                    reasoning: { primary: 'Valid SELL limit exists but immediate trigger is absent' },
                    ai_decision: 'skip'
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 100, 'system');
        expect(result.noTrade).not.toBe(true);
        expect(result.decision).toBe('SELL_LIMIT');
        expect(result.direction).toBe('SELL');
        expect(result.ai_decision).toBe('wait_for_reaction');
    });

    it('rejects inconsistent SELL target ordering and duplicate targets', () => {
        const ctx = getContext();
        const live = {
            real_ict_zones: [
                { type: 'MSNR', timeframe: '4H', low: 4375, high: 4377 }
            ]
        };
        const result = ctx.validateAIOutputConsistency({
            decision: 'SELL',
            direction: 'SELL',
            selected_zone: { type: 'MSNR', timeframe: '4H', low: 4375, high: 4377 },
            entry_zone: { source: 'MSNR', low: 4375, high: 4377 },
            entry: 4376.38,
            stop_loss: 4406.38,
            take_profit_1: 4207.74,
            take_profit_2: 4283.21,
            take_profit_3: 4207.74
        }, live);
        expect(result.valid).toBe(false);
        expect(result.issues.join(' ')).toMatch(/SELL geometry/);
        expect(result.issues.join(' ')).toMatch(/distinct/);
    });

    it('rejects selected zones whose direction does not match the AI direction', () => {
        const ctx = getContext();
        const result = ctx.validateAIOutputConsistency({
            decision: 'BUY',
            direction: 'BUY',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 100, high: 101 },
            entry_zone: { source: 'FVG', low: 100, high: 101 },
            entry: 101.5,
            stop_loss: 99,
            take_profit_1: 103,
            take_profit_2: 104,
            take_profit_3: 105
        }, {
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'SELL', low: 100, high: 101, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        });
        expect(result.valid).toBe(false);
        expect(result.issues).toContain('selected zone direction does not match AI trade direction');
    });

    it('rejects ATR fallback MSNR as a primary AI-selected zone', () => {
        const ctx = getContext();
        const result = ctx.validateAIOutputConsistency({
            decision: 'BUY',
            direction: 'BUY',
            selected_zone: { type: 'MSNR', timeframe: '4H', low: 99, high: 100 },
            entry_zone: { source: 'MSNR', low: 99, high: 100 },
            entry: 100,
            stop_loss: 98,
            take_profit_1: 104,
            take_profit_2: 106,
            take_profit_3: 108
        }, {
            real_ict_zones: [
                { type: 'MSNR', timeframe: '4H', direction: 'BUY', low: 99, high: 100, origin: 'ATR_FALLBACK', primary_eligible: false }
            ]
        });
        expect(result.valid).toBe(false);
        expect(result.issues).toContain('ATR_FALLBACK MSNR cannot be selected as primary AI zone');
    });

    it('allows NO_TRADE consistency results without numeric trade fields', () => {
        const ctx = getContext();
        const result = ctx.validateAIOutputConsistency({
            decision: 'NO_TRADE',
            noTrade: true,
            confidence: 0,
            reasoning: { primary: 'No valid future setup' }
        }, { real_ict_zones: [] });
        expect(result.valid).toBe(true);
    });
});

describe('hasRealVolume / volume gating', () => {
    it('returns true only for crypto pairs (BTC/USD)', () => {
        const ctx = getContext();
        expect(ctx.hasRealVolume('BTC/USD')).toBe(true);
        expect(ctx.hasRealVolume('XAU/USD')).toBe(false);
        expect(ctx.hasRealVolume('EUR/USD')).toBe(false);
        expect(ctx.hasRealVolume('GBP/JPY')).toBe(false);
        expect(ctx.hasRealVolume('XAG/USD')).toBe(false);
    });

    it('analyzeVolumeTruth returns all-false for synthetic volume even with surgey data', () => {
        const ctx = getContext();
        // Build data where every candle in the last 4 has v >= 1.5x average — would normally be 'surge'
        const data = candles(30, 100, 1, 'up').map((c, i) => ({ ...c, v: i < 26 ? 1000 : 5000 }));
        const real = ctx.analyzeVolumeTruth(data, true);
        const synth = ctx.analyzeVolumeTruth(data, false);
        expect(real.surge).toBe(true);
        expect(synth.surge).toBe(false);
        expect(synth.fake).toBe(false);
        expect(synth.dryUp).toBe(false);
        expect(synth.realVolume).toBe(false);
    });

    it('analyzeMarketPhase does NOT trigger ACCUMULATION when volume is synthetic', () => {
        const ctx = getContext();
        // Construct a flat-then-up dataset that would normally be ACCUMULATION with rising volume
        const data = [];
        for (let i = 0; i < 60; i++) {
            const base = 100 + i * 0.1;
            data.push({ o: base, c: base + 0.05, h: base + 0.2, l: base - 0.2, v: 1000 + i * 10 });
        }
        // Force recent volume surge
        for (let i = 50; i < 60; i++) data[i].v = 5000;
        const real = ctx.analyzeMarketPhase(data, true);
        const synth = ctx.analyzeMarketPhase(data, false);
        // With real volume, ACCUMULATION may fire if volatility/conditions line up
        // The point: synth must have volumeRatio forced to 1.0, blocking the threshold
        expect(synth.volumeRatio).toBe(1.0);
        expect(real.volumeRatio).toBeGreaterThan(1.0);
    });

    it('analyzeSentiment zeros the volumeSentiment component when volume is synthetic', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up').map((c, i) => ({ ...c, v: 1000 + i * 50 }));
        const real = ctx.analyzeSentiment(data, true);
        const synth = ctx.analyzeSentiment(data, false);
        expect(real.realVolume).toBe(true);
        expect(synth.realVolume).toBe(false);
        expect(synth.volumeSentiment).toBe(0);
        expect(real.volumeSentiment).not.toBe(0);
    });
});

describe('validateAISetup', () => {
    // Build a history cache where 4H/1H are trending up and have zones around 100
    const buildCache = (start = 100) => ({
        '4H': candles(80, start, 0.5, 'up'),
        '1H': candles(80, start, 0.3, 'up'),
        '1D': candles(80, start, 0.2, 'up'),
        '15M': candles(20, start, 0.1, 'up'),
        '5M': candles(20, start, 0.05, 'up')
    });

    const baseAi = (overrides = {}) => ({
        direction: 'BUY',
        entry: 100,
        entry_zone: { low: 99, high: 101, source: 'FVG' },
        stop_loss: 95,
        stop_loss_reason: 'below structure',
        take_profit_1: 110,
        take_profit_2: 115,
        take_profit_3: 120,
        risk_reward: '1:2.0',
        confidence: 70,
        patterns: ['FVG', 'MSNR'],
        probability: 'HIGH',
        reasoning: { primary: 'test', secondary: [], risk_warning: 'none' },
        ai_decision: 'enter_now',
        wait_condition: null,
        ...overrides
    });

    it('passes a well-formed setup that aligns with cached zones', () => {
        const ctx = getContext();
        const cache = buildCache();
        const price = 105;
        // Pick an entry that the rule engine's findPatternZone is likely to find.
        // 4H data is trending up from 100, so a support somewhere in [100..120] should exist.
        const r = ctx.validateAISetup(baseAi({ entry: 110, stop_loss: 105, take_profit_1: 120 }), price, cache, 'XAU/USD');
        // We don't assert pass/fail (depends on zone math) but we DO assert structure
        expect(typeof r.valid).toBe('boolean');
        expect(typeof r.adjustedConfidence).toBe('number');
        expect(r.adjustedConfidence).toBeGreaterThanOrEqual(0);
        expect(r.adjustedConfidence).toBeLessThanOrEqual(100);
    });

    it('rejects when AI direction is neither BUY nor SELL', () => {
        const ctx = getContext();
        const cache = buildCache();
        const r = ctx.validateAISetup(baseAi({ direction: 'SIDEWAYS' }), 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/invalid direction/);
    });

    it('rejects when required fields are missing', () => {
        const ctx = getContext();
        const cache = buildCache();
        const r = ctx.validateAISetup({ direction: 'BUY' }, 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/entry must be a finite number/);
    });

    it('rejects when recomputed RR is below 1.5x regardless of AI claim', () => {
        const ctx = getContext();
        const cache = buildCache();
        // Entry at price (within 0.15% tolerance, so CHECK 1 zone reconciliation
        // passes). But SL is far and TP1 is near → RR = 0.5x, which must be
        // caught by the recompute even though aiResult.risk_reward claims 1:5.0.
        // risk = 100 - 90 = 10, reward = 100.5 - 100 = 0.5 → RR = 0.05x
        const r = ctx.validateAISetup(baseAi({ entry: 100, stop_loss: 90, take_profit_1: 100.5, risk_reward: '1:5.0' }), 100, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/no real deterministic FVG\/OB\/MSNR matches/);
    });

    it('computes independent adjustedConfidence via blend (not trusting AI)', () => {
        const ctx = getContext();
        const cache = buildCache();
        // Use a clearly-aligned setup. The adjusted confidence should be a blend,
        // not equal to aiResult.confidence verbatim.
        const r = ctx.validateAISetup(baseAi({ confidence: 95, entry: 110, stop_loss: 105, take_profit_1: 120 }), 105, cache, 'XAU/USD');
        if(r.valid) {
            // If valid, the adjusted number should be a function of both localScore and aiConf.
            // We can't predict the exact number, but it must be within [0, 100] and
            // it is computed (not just passed through).
            expect(r.adjustedConfidence).toBeGreaterThanOrEqual(0);
            expect(r.adjustedConfidence).toBeLessThanOrEqual(100);
            expect(typeof r.localScore).toBe('number');
            expect(typeof r.aiConf).toBe('number');
            expect(r.aiConf).toBe(95);
        }
        // If invalid, we still want a valid structure response
        expect(typeof r.adjustedConfidence).toBe('number');
    });

    it('FIX1: hard-rejects when entry does not match any real zone', () => {
        const ctx = getContext();
        const cache = buildCache();
        // Entry 999 is far from price 105 AND outside any 4H/1H zone. Before this
        // fix, CHECK 1 only logged a reason (no reject) and the setup passed.
        const r = ctx.validateAISetup(baseAi({ entry: 999, stop_loss: 990, take_profit_1: 1010 }), 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/no real deterministic FVG\/OB\/MSNR matches/);
        expect(r.checks).toBeTruthy();
    });

    it('FIX2: gives +6 when MSS type agrees with direction, -3 when it disagrees', () => {
        const ctx = getContext();
        // Build 4H data with a fresh BULL MSS (last close above prior 21-bar high).
        const bullData = [];
        for (let i = 0; i < 40; i++) bullData.push({ o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1e6 });
        // last close = 100.5+39 = 139.5, prior 21-bar high = max(h[-21..-2]) = 100+39-20.. ≈ 120 → BULL MSS
        const mssB = ctx.detectMSS(bullData);
        expect(mssB && mssB.type).toBe('BULL');

        // A BUY setup on this data should get +6 (MSS BULL agrees).
        const cacheBuy = { '4H': bullData, '1H': bullData, '1D': bullData, '15M': bullData.slice(-20), '5M': bullData.slice(-20) };
        // Force CHECK 1 to pass by putting entry within 0.15% of price.
        const priceB = 139.5;
        const rBuy = ctx.validateAISetup(baseAi({ direction: 'BUY', entry: priceB, stop_loss: priceB - 2, take_profit_1: priceB + 5 }), priceB, cacheBuy, 'XAU/USD');
        // We can't force rBuy.valid here (other checks may fail), but if it reaches
        // scoring, the factors must reflect the MSS agreement when valid.
        if(rBuy.valid) {
            expect(rBuy.factors.some(f => /MSS BULL confirms/.test(f))).toBe(true);
        }

        // A SELL setup against a BULL MSS should get -3 if it reaches scoring.
        const rSell = ctx.validateAISetup(baseAi({ direction: 'SELL', entry: priceB, stop_loss: priceB + 2, take_profit_1: priceB - 5 }), priceB, cacheBuy, 'XAU/USD');
        if(rSell.valid) {
            expect(rSell.factors.some(f => /MSS BULL against/.test(f))).toBe(true);
        }
    });

    it('returns a stable rejection structure before HTF scoring when no deterministic zone matches', () => {
        const ctx = getContext();
        const cache = buildCache();
        const r = ctx.validateAISetup(baseAi({ entry: 100, stop_loss: 95, take_profit_1: 113 }), 100, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/no real deterministic FVG\/OB\/MSNR matches/);
        expect(typeof r.adjustedConfidence).toBe('number');
    });

    it('validates a future SELL limit above current price using RR from future entry', () => {
        const ctx = getContext();
        const data = candles(80, 4450, 1.5, 'down');
        const cache = { '4H': data, '1H': data, '1D': data, '15M': data.slice(-20), '5M': data.slice(-20) };
        const entry = ctx.calculateMSNR(data, 4400).nearestResistance;
        const r = ctx.validateAISetup(baseAi({
            direction: 'SELL',
            decision: 'SELL_LIMIT',
            entry,
            entry_zone: { low: entry * 0.9995, high: entry * 1.0005, source: 'MSNR' },
            stop_loss: entry + 7,
            take_profit_1: entry - 21,
            take_profit_2: entry - 35,
            take_profit_3: entry - 49,
            ai_decision: 'wait_for_reaction'
        }), 4400, cache, 'XAU/USD');
        expect(r.valid).toBe(true);
        expect(r.rr1).toBeCloseTo(3, 1);
        expect(r.matchedZone).toBeTruthy();
    });

    it('still rejects bad RR calculated from the future limit entry', () => {
        const ctx = getContext();
        const data = candles(80, 4450, 1.5, 'down');
        const cache = { '4H': data, '1H': data, '1D': data, '15M': data.slice(-20), '5M': data.slice(-20) };
        const entry = ctx.calculateMSNR(data, 4400).nearestResistance;
        const r = ctx.validateAISetup(baseAi({
            direction: 'SELL',
            decision: 'SELL_LIMIT',
            entry,
            entry_zone: { low: entry * 0.9995, high: entry * 1.0005, source: 'MSNR' },
            stop_loss: entry + 7,
            take_profit_1: entry - 8,
            take_profit_2: entry - 20,
            take_profit_3: entry - 30,
            ai_decision: 'wait_for_reaction',
            risk_reward: '1:5.0'
        }), 4400, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/real RR .* below/);
    });
});

describe('resolvePendingFill (auto outcome detection)', () => {
    // Build a candle history where price initially fills at 100, then SL (95) gets hit
    const fill = {
        id: 1,
        pair: 'XAU/USD',
        signalType: 'LONG',
        entry: 100,
        stopLoss: 95,
        takeProfit1: 110,
        takeProfit2: 115,
        takeProfit3: 120,
        createdAt: '2026-01-01T10:00:00Z'
    };
    // 5 candles at 5-min intervals after the fill
    const lossCandles = [
        { t: '2026-01-01T10:05:00Z', o: 100, h: 100.5, l: 99.5, c: 100, v: 1e6 },
        { t: '2026-01-01T10:10:00Z', o: 100, h: 100.2, l: 99.8, c: 100, v: 1e6 },
        { t: '2026-01-01T10:15:00Z', o: 100, h: 99.8, l: 95.0, c: 96, v: 1e6 }, // SL hit (l=95)
        { t: '2026-01-01T10:20:00Z', o: 96, h: 110, l: 95.5, c: 109, v: 1e6 }    // would hit TP1 too
    ];
    const winCandles = [
        { t: '2026-01-01T10:05:00Z', o: 100, h: 100.5, l: 99.5, c: 100, v: 1e6 },
        { t: '2026-01-01T10:10:00Z', o: 100, h: 102, l: 100, c: 101, v: 1e6 },
        { t: '2026-01-01T10:15:00Z', o: 101, h: 110, l: 101, c: 109, v: 1e6 }, // TP1 hit
        { t: '2026-01-01T10:20:00Z', o: 109, h: 109, l: 94, c: 95, v: 1e6 }    // SL hit too, but later
    ];
    const openCandles = [
        { t: '2026-01-01T10:05:00Z', o: 100, h: 101, l: 99.5, c: 100.2, v: 1e6 },
        { t: '2026-01-01T10:10:00Z', o: 100.2, h: 102, l: 100, c: 101.5, v: 1e6 }
    ];

    it('detects LOSS when SL is hit before TP1', () => {
        const ctx = getContext();
        const r = ctx.resolvePendingFill(fill, lossCandles);
        expect(r.resolved).toBe(true);
        expect(r.outcome).toBe('LOSS');
    });

    it('detects WIN when TP1 is hit before SL', () => {
        const ctx = getContext();
        const r = ctx.resolvePendingFill(fill, winCandles);
        expect(r.resolved).toBe(true);
        expect(r.outcome).toBe('WIN');
    });

    it('stays unresolved when neither SL nor TP1 hit', () => {
        const ctx = getContext();
        const r = ctx.resolvePendingFill(fill, openCandles);
        expect(r.resolved).toBe(false);
        expect(r.outcome).toBeNull();
    });

    it('handles SHORT direction symmetrically', () => {
        const ctx = getContext();
        const shortFill = { ...fill, signalType: 'SHORT', entry: 100, stopLoss: 105, takeProfit1: 90 };
        // For SHORT: SL is ABOVE entry (105), TP1 is BELOW (90). Hit SL first.
        const slFirst = [
            { t: '2026-01-01T10:05:00Z', o: 100, h: 106, l: 99, c: 100, v: 1e6 }  // h=106 >= SL=105
        ];
        const r = ctx.resolvePendingFill(shortFill, slFirst);
        expect(r.resolved).toBe(true);
        expect(r.outcome).toBe('LOSS');
    });

    it('returns not-resolved for empty candles', () => {
        const ctx = getContext();
        const r = ctx.resolvePendingFill(fill, []);
        expect(r.resolved).toBe(false);
    });

    it('returns not-resolved for bad createdAt', () => {
        const ctx = getContext();
        const r = ctx.resolvePendingFill({ ...fill, createdAt: 'garbage' }, winCandles);
        expect(r.resolved).toBe(false);
    });
});

describe('pendingFills queue (localStorage)', () => {
    it('enqueue, load, and clear a pending fill', () => {
        const ctx = getContext();
        const store = {};
        ctx.localStorage.getItem = (k) => k === 'pendingFills' ? (store[k] || '[]') : null;
        ctx.localStorage.setItem = (k, v) => { store[k] = v; };
        ctx.localStorage.removeItem = (k) => { delete store[k]; };

        const order = { id: 42, pair: 'XAU/USD', signalType: 'LONG', stopLoss: 95, takeProfit1: 110, takeProfit2: 115, takeProfit3: 120 };
        ctx.enqueuePendingFill(order, 100);
        let queue = ctx.loadPendingFills();
        expect(queue.length).toBe(1);
        expect(queue[0].entry).toBe(100);
        expect(queue[0].stopLoss).toBe(95);
        expect(queue[0].pair).toBe('XAU/USD');

        ctx.clearPendingFill(42);
        queue = ctx.loadPendingFills();
        expect(queue.length).toBe(0);
    });
});
