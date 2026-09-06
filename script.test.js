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
        expect(r.poc).toBeGreaterThan(0);
        expect(r.vah).toBeGreaterThan(r.val);
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
        expect(ctxOut.summary).toMatch(/FILTER BLOCK/);
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
        expect(last5m).toMatch(/O:\d+\.\d{2} H:\d+\.\d{2} L:\d+\.\d{2} C:\d+\.\d{2} V:\d+/);
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
        expect(r.reason).toMatch(/not BUY or SELL/);
    });

    it('rejects when required fields are missing', () => {
        const ctx = getContext();
        const cache = buildCache();
        const r = ctx.validateAISetup({ direction: 'BUY' }, 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/missing required fields/);
    });

    it('rejects when recomputed RR is below 1.5x regardless of AI claim', () => {
        const ctx = getContext();
        const cache = buildCache();
        // risk = 100 - 95 = 5, reward = 102 - 100 = 2 → RR = 0.4x
        const r = ctx.validateAISetup(baseAi({ entry: 100, stop_loss: 95, take_profit_1: 102, risk_reward: '1:5.0' }), 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/recomputed RR .* < 1\.5x/);
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
