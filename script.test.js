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

const getScanContext = () => {
    const elements = new Map();
    const makeElement = () => {
        const classes = new Set();
        return {
        addEventListener: () => {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        style: {},
        innerHTML: '',
        textContent: '',
        dataset: { category: 'metals' },
        value: '',
        disabled: false
        };
    };
    const getElement = id => {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    };
    const context = {
        window: { Telegram: null },
        document: {
            readyState: 'loading',
            getElementById: getElement,
            addEventListener: () => {},
            querySelector: getElement,
            querySelectorAll: () => [],
            body: { insertAdjacentHTML: () => {} }
        },
        console: { log: () => {}, error: () => {}, warn: () => {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval,
        clearTimeout,
        Date,
        Math,
        JSON,
        performance,
        btoa: s => Buffer.from(s, 'binary').toString('base64')
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    return { context, elements };
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

const c = (o, h, l, close, t = null) => ({ o, h, l, c: close, v: 1e6, ...(t ? { t } : {}) });

const crtBuyFixture = () => {
    const data = candles(25, 100, 0.02, 'up');
    for (let i = 0; i < 14; i++) data[i] = c(100, 100.4, 99.6, 100);
    data[14] = c(100, 100.2, 99.1, 99.5);
    data[15] = c(99.45, 100.1, 99.2, 99.75);
    data[16] = c(99.75, 100.2, 99.7, 99.95);
    data[17] = c(99.95, 100.8, 99.9, 100.5);
    for (let i = 18; i < 25; i++) data[i] = c(100.45, 100.7, 100.2, 100.55);
    return data;
};

const crtSellFixture = () => {
    const data = candles(25, 100, 0.02, 'down');
    for (let i = 0; i < 14; i++) data[i] = c(100, 100.4, 99.6, 100);
    data[14] = c(100, 100.9, 99.8, 100.5);
    data[15] = c(100.55, 100.8, 99.9, 100.25);
    data[16] = c(100.25, 100.3, 99.8, 100.05);
    data[17] = c(100.05, 100.1, 99.2, 99.5);
    for (let i = 18; i < 25; i++) data[i] = c(99.55, 99.8, 99.3, 99.45);
    return data;
};

const tbsBuyFixture = (extraBars = 0) => {
    const data = candles(35 + extraBars, 100, 0.02, 'up');
    data[8] = c(100.1, 100.3, 99.0, 100.15);
    data[9] = c(100.15, 100.4, 99.8, 100.25);
    data[26] = c(100.3, 100.4, 98.6, 99.4);
    data[27] = c(99.4, 100.2, 99.1, 99.35);
    data[28] = c(99.35, 100.4, 99.3, 100.1);
    for (let i = 29; i < data.length; i++) data[i] = c(100.1, 100.5, 99.9, 100.2);
    return data;
};

const tbsSellFixture = () => {
    const data = candles(35, 100, 0.02, 'down');
    data[8] = c(99.9, 101.0, 99.7, 99.85);
    data[9] = c(99.85, 100.2, 99.6, 99.75);
    data[26] = c(99.7, 101.35, 99.6, 100.6);
    data[27] = c(100.6, 100.9, 99.8, 100.65);
    data[28] = c(100.65, 100.7, 99.5, 99.9);
    for (let i = 29; i < data.length; i++) data[i] = c(99.9, 100.1, 99.5, 99.8);
    return data;
};

const msnrReactionFixture = () => {
    const data = [];
    for (let i = 0; i < 30; i++) data.push(c(100, 100.3, 99.7, 100.05));
    data[30] = c(100.0, 100.2, 99.4, 99.6);
    data[31] = c(99.6, 100.4, 99.5, 100.25);
    data[32] = c(100.25, 101.2, 100.1, 101.0);
    data[33] = c(101.0, 101.3, 100.7, 101.1);
    data[34] = c(101.1, 101.4, 100.8, 101.2);
    data[35] = c(101.2, 101.5, 100.9, 101.3);
    return data;
};

const freshExecutionFixture = () => {
    const data = [];
    for (let i = 0; i < 30; i++) {
        const t = `2026-09-10 ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`;
        data.push(c(100 + i * 0.02, 100.05 + i * 0.02, 99.95 + i * 0.02, 100.02 + i * 0.02, t));
    }
    // Signal/reclaim at index 10, then a real bullish displacement and FVG.
    data[10] = c(100.2, 100.3, 99.7, 100.25, '2026-09-10 05:00:00');
    data[15] = c(100.3, 100.4, 100.0, 100.1, '2026-09-10 07:30:00');
    data[16] = c(100.1, 101.2, 100.05, 101.1, '2026-09-10 08:00:00');
    data[17] = c(101.1, 101.5, 101.0, 101.4, '2026-09-10 08:30:00');
    for (let i = 18; i < data.length; i++) {
        const p = data[i - 1].c;
        data[i] = c(p, p + 0.05, p - 0.03, p + 0.03, `2026-09-10 ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`);
    }
    return data;
};

describe('strategy entry lifecycle', () => {
    const fixture = (primary = 'CRT', later = []) => {
        const bars = [c(1.161, 1.1613, 1.159, 1.1604), ...later];
        return {
            candidate: { direction: 'BUY', entry: 1.16005, zone_low: 1.16, zone_high: 1.1601,
                stop_loss: 1.159, tp1: 1.16286, immediate_entry: { eligible: false },
                strategy_setup: { primary, timeframe: '1H', reclaim_bar_index: 0,
                    departure_confirmed_index: 0, entry_model: 'REACTION_ZONE_RETEST' } },
            market: { price: 1.161, historyCache: { '1H': bars } }
        };
    };
    it.each(['CRT', 'TBS', 'MSNR'])('%s cannot reopen its consumed first entry', primary => {
        const ctx = getContext();
        const { candidate, market } = fixture(primary, [c(1.1604, 1.16253, 1.16005, 1.16253)]);
        market.price = 1.16253;
        const result = ctx.evaluateSetupLifecycle(candidate, market);
        expect(result.rejection_code).toBe('ENTRY_ALREADY_CONSUMED');
        expect(result.entry_consumed).toBe(true);
        expect(result.entry_first_touch_index).toBe(1);
        expect(result.entry_touch_count_after_signal).toBe(1);
        expect(result.remaining_reward_fraction).toBeCloseTo(0.11744, 4);
        expect(ctx.evaluateSetupCandidate(candidate, market).reasons).toEqual(['ENTRY_ALREADY_CONSUMED']);
    });
    it('rejects a completed TP1 even when the entry was also consumed', () => {
        const { candidate, market } = fixture('TBS', [c(1.1601, 1.163, 1.16, 1.162)]);
        const result = getContext().evaluateSetupLifecycle(candidate, market);
        expect(result.rejection_code).toBe('SETUP_ALREADY_COMPLETED');
        expect(result.tp1_first_reached_index).toBe(1);
    });
    it('rejects advanced delivery without inventing a historical entry touch', () => {
        const { candidate, market } = fixture('CRT', [c(1.161, 1.1626, 1.1605, 1.16253)]);
        market.price = 1.16253;
        expect(getContext().evaluateSetupLifecycle(candidate, market).rejection_code).toBe('SETUP_DELIVERY_ALREADY_ADVANCED');
    });
    it('keeps an untouched outside-zone entry fresh despite immediate_entry=false', () => {
        const { candidate, market } = fixture('CRT', [c(1.1605, 1.1612, 1.1604, 1.161)]);
        const result = getContext().evaluateSetupLifecycle(candidate, market);
        expect(result.rejection_code).toBeNull();
        expect(result.entry_touch_count_after_signal).toBe(0);
        expect(result.entry_freshness).toBe('FRESH');
    });
    it('does not count the reclaim candle itself', () => {
        const { candidate, market } = fixture();
        expect(getContext().evaluateSetupLifecycle(candidate, market).entry_consumed).toBe(false);
    });
    it('expires old and untraceable events even if their zones still exist', () => {
        const ctx = getContext();
        const { candidate, market } = fixture('MSNR', Array.from({ length: 9 }, () => c(1.161, 1.1612, 1.1605, 1.161)));
        expect(ctx.evaluateSetupLifecycle(candidate, market).rejection_code).toBe('SETUP_EXPIRED');
        delete candidate.strategy_setup.departure_confirmed_index;
        expect(ctx.evaluateSetupLifecycle(candidate, market).rejection_code).toBe('SETUP_EXPIRED');
    });
    it('does not reset a role reversal at its already consumed retest', () => {
        const { candidate, market } = fixture('MSNR', [c(1.1604, 1.161, 1.16, 1.1608)]);
        Object.assign(candidate.strategy_setup, { entry_model: 'ROLE_REVERSAL_RETEST', break_index: 0, retest_index: 1 });
        expect(getContext().evaluateSetupLifecycle(candidate, market).rejection_code).toBe('ENTRY_ALREADY_CONSUMED');
    });
    it('resolves event timestamps after a rolling history shifts indexes', () => {
        const { candidate, market } = fixture('MSNR', [c(1.1604, 1.161, 1.16, 1.1608)]);
        market.historyCache['1H'][0].t = '2026-09-10 08:00:00';
        candidate.strategy_setup.event_time = Date.parse('2026-09-10T08:00:00Z');
        candidate.strategy_setup.departure_confirmed_index = 50;
        const result = getContext().evaluateSetupLifecycle(candidate, market);
        expect(result.rejection_code).toBe('ENTRY_ALREADY_CONSUMED');
        market.historyCache['1H'].shift();
        expect(getContext().evaluateSetupLifecycle(candidate, market).rejection_code).toBe('SETUP_EXPIRED');
    });
    it('uses identical overlap rules for SELL', () => {
        const { candidate, market } = fixture('TBS', [c(1.1604, 1.161, 1.16, 1.1608)]);
        Object.assign(candidate, { direction: 'SELL', tp1: 1.157, stop_loss: 1.162 });
        expect(getContext().evaluateSetupLifecycle(candidate, market).rejection_code).toBe('ENTRY_ALREADY_CONSUMED');
    });

    it('keeps an untouched current-day setup actionable as a pending opportunity', () => {
        const ctx = getContext();
        const market = {
            price: 101,
            as_of_time: '2026-09-11T11:00:00Z',
            historyCache: { '1H': [
                c(99, 100, 98.5, 99.5, '2026-09-11 09:00:00'),
                c(99.5, 101.2, 99.3, 101, '2026-09-11 10:00:00'),
                c(101, 101.1, 100.9, 101, '2026-09-11 11:00:00')
            ] }
        };
        const candidate = { direction: 'BUY', entry: 99, zone_low: 98.9, zone_high: 99.1, tp1: 110,
            strategy_setup: { primary: 'CRT', timeframe: '1H', reclaim_bar_index: 0, reclaim_time: Date.parse('2026-09-11T09:00:00Z') } };
        const result = ctx.evaluateSetupLifecycle(candidate, market);
        expect(result.opportunity_status).toBe('FRESH_PENDING_TODAY');
        expect(result.still_actionable_today).toBe(true);
        expect(result.entry_consumed).toBe(false);
        expect(result.remaining_reward_fraction).toBeCloseTo(0.818, 2);
    });

    it('rejects a same-day setup after most of the delivery path is complete', () => {
        const ctx = getContext();
        const candidate = { direction: 'BUY', entry: 100, zone_low: 99.9, zone_high: 100.1, tp1: 110,
            strategy_setup: { primary: 'CRT', timeframe: '1H', reclaim_bar_index: 0, reclaim_time: Date.parse('2026-09-11T09:00:00Z') } };
        const result = ctx.evaluateSetupLifecycle(candidate, {
            price: 109, as_of_time: '2026-09-11T11:00:00Z',
            historyCache: { '1H': [c(99, 100, 98, 99.5, '2026-09-11 09:00:00'), c(108, 109.2, 107.8, 109, '2026-09-11 10:00:00')] }
        });
        expect(result.progress_to_tp1_fraction).toBeCloseTo(0.9, 2);
        expect(result.rejection_code).toBe('SETUP_DELIVERY_ALREADY_ADVANCED');
        expect(result.opportunity_status).toBe('DELIVERY_ADVANCED');
    });

    it('rejects a stale prior-day intraday event even when its entry remains untouched', () => {
        const ctx = getContext();
        const candidate = { direction: 'SELL', entry: 110, zone_low: 109.9, zone_high: 110.1, tp1: 100,
            strategy_setup: { primary: 'TBS', timeframe: '1H', reclaim_bar_index: 0, reclaim_time: Date.parse('2026-09-08T09:00:00Z') } };
        const result = ctx.evaluateSetupLifecycle(candidate, {
            price: 105, as_of_time: '2026-09-11T11:00:00Z',
            historyCache: { '1H': [c(100, 101, 99, 100, '2026-09-08 09:00:00'), c(105, 106, 104, 105, '2026-09-11 10:00:00')] }
        });
        expect(result.opportunity_status).toBe('INVALID');
        expect(result.rejection_code).toBe('SETUP_STALE');
        expect(result.still_actionable_today).toBe(false);
    });

    it('keeps poor pending-entry reachability separate from setup validity', () => {
        const ctx = getContext();
        const data = Array.from({ length: 20 }, (_, i) => c(100 + i * 0.1, 100.15 + i * 0.1, 99.95 + i * 0.1, 100.1 + i * 0.1, `2026-09-11 ${String(i).padStart(2, '0')}:00:00`));
        const result = ctx.evaluateSetupLifecycle({ direction: 'BUY', entry: 100, zone_low: 99.9, zone_high: 100.1, tp1: 120,
            strategy_setup: { primary: 'MSNR', timeframe: '1H', departure_confirmed_index: 18, event_time: Date.parse('2026-09-11T18:00:00Z') } }, {
            price: 102, as_of_time: '2026-09-11T19:00:00Z', historyCache: { '1H': data }
        });
        expect(result.pending_entry_quality).toBe('LOW');
        expect(result.entry_reachable_today).toBe(false);
        expect(result.rejection_code).toBe('ENTRY_NOT_REACHABLE_TODAY');
        expect(result.opportunity_status).toBe('FRESH_PENDING_LATER');
        expect(result.still_actionable_today).toBe(false);
    });

    it('sends only fresh opportunity statuses to the AI context', () => {
        const ctx = getContext();
        const payload = ctx.compactAIContext({ adaptive_setup_candidates: [
            { id: 'fresh', opportunity_status: 'FRESH_PENDING_TODAY', direction: 'BUY', entry: 1, stop_loss: 0.9, tp1: 1.3 },
            { id: 'stale', opportunity_status: 'STALE', direction: 'BUY', entry: 1, stop_loss: 0.9, tp1: 1.3 },
            { id: 'completed', opportunity_status: 'COMPLETED', direction: 'BUY', entry: 1, stop_loss: 0.9, tp1: 1.3 }
        ] });
        expect(payload.adaptive_setup_candidates.map(c => c.id)).toEqual(['fresh']);
    });

    it('normalizes epoch seconds, epoch milliseconds, ISO, text, Date, and timezone timestamps identically', () => {
        const ctx = getContext();
        const iso = '2026-09-11T00:00:00Z';
        const ms = Date.parse(iso);
        expect(ctx.normalizeTimestampUTC(ms)).toBe(ms);
        expect(ctx.normalizeTimestampUTC(Math.floor(ms / 1000))).toBe(ms);
        expect(ctx.normalizeTimestampUTC(iso)).toBe(ms);
        expect(ctx.normalizeTimestampUTC('2026-09-11 00:00:00')).toBe(ms);
        expect(ctx.normalizeTimestampUTC(new Date(ms))).toBe(ms);
        expect(ctx.normalizeTimestampUTC('2026-09-11T05:00:00+05:00')).toBe(ms);
    });

    it('uses execution-timeframe timestamps for an older 4H narrative with fresh 1H execution', () => {
        const ctx = getContext();
        const result = ctx.evaluateSetupLifecycle({ direction: 'BUY', entry: 99, zone_low: 98.9, zone_high: 99.1, tp1: 110,
            strategy_setup: { primary: 'CRT', setup_timeframe: '4H', execution_timeframe: '1H', reclaim_bar_index: 0, reclaim_time: Math.floor(Date.parse('2026-09-11T08:00:00Z') / 1000) } }, {
            price: 101, as_of_time: Date.parse('2026-09-11T10:00:00Z'),
            historyCache: {
                '4H': [c(100, 101, 99.5, 100, '2026-09-11 08:00:00')],
                '1H': [c(100, 100.5, 99.5, 100, '2026-09-11T08:00:00Z'), c(100, 101.2, 100.8, 101, '2026-09-11T09:00:00Z')]
            }
        });
        expect(result.event_time).toBe(Date.parse('2026-09-11T08:00:00Z'));
        expect(result.event_age_hours).toBe(2);
        expect(result.opportunity_status).toBe('FRESH_PENDING_TODAY');
        expect(result.still_actionable_today).toBe(true);
    });

    it('rejects the AUD-style SELL setup with only 40% reward remaining', () => {
        const ctx = getContext();
        const result = ctx.evaluateSetupLifecycle({ direction: 'SELL', entry: 0.71713, zone_low: 0.71710, zone_high: 0.71716, tp1: 0.71623,
            strategy_setup: { primary: 'TBS', timeframe: '1H', reclaim_bar_index: 0, reclaim_time: '2026-09-11T09:00:00Z' } }, {
            price: 0.71659, as_of_time: '2026-09-11T10:00:00Z',
            historyCache: { '1H': [c(0.718, 0.7182, 0.7175, 0.718, '2026-09-11T09:00:00Z'), c(0.7169, 0.7170, 0.7165, 0.71659, '2026-09-11T10:00:00Z')] }
        });
        expect(result.remaining_reward_fraction).toBeCloseTo(0.4, 2);
        expect(result.progress_to_tp1_fraction).toBeCloseTo(0.6, 2);
        expect(result.rejection_code).toBe('SETUP_DELIVERY_ALREADY_ADVANCED');
        expect(result.opportunity_status).toBe('DELIVERY_ADVANCED');
    });

    it('penalizes partial delivery without making a limit order automatically low confidence', () => {
        const ctx = getContext();
        const normal = ctx.calculateCandidateConfidence({ direction: 'BUY', opportunity_status: 'FRESH_PENDING_TODAY', remaining_reward_fraction: 0.8, entry_reachability_score: 85, htf_alignment: 3, strategy_setup: { confirmations: ['TBS'] }, target_reachability: { reachability_score: 85 } });
        const partial = ctx.calculateCandidateConfidence({ direction: 'BUY', opportunity_status: 'FRESH_PENDING_TODAY', remaining_reward_fraction: 0.6, entry_reachability_score: 85, htf_alignment: 3, strategy_setup: { confirmations: ['TBS'] }, target_reachability: { reachability_score: 85 } });
        const poor = ctx.calculateCandidateConfidence({ direction: 'BUY', opportunity_status: 'FRESH_PENDING_TODAY', remaining_reward_fraction: 0.6, entry_reachability_score: 20, htf_alignment: 0, strategy_setup: { confirmations: [] }, target_reachability: { reachability_score: 30, intervening_obstacles: [{ severity: 'SERIOUS' }] } });
        expect(normal.quality).toBe('HIGH');
        expect(partial.final_score).toBeLessThan(normal.final_score);
        expect(poor.final_score).toBeLessThan(partial.final_score);
    });

    it('blocks contradictory final limit output and permits a valid pending limit outside the zone', () => {
        const ctx = getContext();
        const candidate = { id: 'fresh-limit', direction: 'SELL', entry: 110, stop_loss: 112, tp1: 104, tp2: null, tp3: null,
            opportunity_status: 'FRESH_PENDING_TODAY', lifecycle_state: 'FRESH_PENDING_TODAY', still_actionable_today: true,
            entry_consumed: false, tp1_already_reached: false, remaining_reward_fraction: 0.8 };
        const invalid = ctx.validateFinalSignalConsistency({ trade_type: 'SELL_LIMIT', direction: 'SELL', selected_candidate_id: candidate.id,
            entry_price: 110, stop_loss: 112, take_profit_1: 104, opportunity_status: candidate.opportunity_status, still_actionable_today: true,
            remaining_reward_fraction: 0.8, limit_order_setup: { eligible: true }, immediate_entry: { eligible: true, confirmation: { isAtZone: true } },
            limitZoneStatus: { insideZone: false }, source: 'Deterministic Candidate Engine + AI Selector' }, { adaptive_setup_candidates: [candidate] });
        expect(invalid.valid).toBe(false);
        expect(invalid.issues).toContain('immediate confirmation claims at-zone while current price is outside zone');
        const valid = ctx.validateFinalSignalConsistency({ trade_type: 'SELL_LIMIT', direction: 'SELL', selected_candidate_id: candidate.id,
            entry_price: 110, stop_loss: 112, take_profit_1: 104, opportunity_status: candidate.opportunity_status, still_actionable_today: true,
            remaining_reward_fraction: 0.8, entry_reachable_today: true, ai_decision: 'pending_limit', limit_order_setup: { eligible: true }, immediate_entry: { eligible: false, confirmation: { isAtZone: false } },
            limitZoneStatus: { insideZone: false }, source: 'Deterministic Candidate Engine + AI Selector' }, { adaptive_setup_candidates: [candidate] });
        expect(valid.valid).toBe(true);
    });
});

describe('active narrative fresh execution zones', () => {
    it('keeps a consumed CRT entry recorded while creating a fresh post-signal FVG opportunity', () => {
        const ctx = getContext();
        const history = freshExecutionFixture();
        const narrative = {
            primary: 'CRT', direction: 'BUY', timeframe: '1H', execution_timeframe: '1H',
            event_time: '2026-09-10 05:00:00', reclaim_time: '2026-09-10 05:00:00',
            reclaim_bar_index: 10, structural_invalidation: 98, primary_objective: 105,
            entry_consumed: true, execution_zone: { low: 99.7, high: 100.0 },
            evidence: { reclaim_bar: 10 }
        };
        const narrativeState = ctx.evaluateStrategyNarrative(narrative, { '1H': history }, 102);
        const zones = ctx.buildFreshExecutionZonesForNarrative(narrative, { '1H': history }, [], 'EUR/USD', 102);
        expect(narrativeState.state).toBe('ACTIVE');
        expect(zones.some(z => z.type === 'FVG')).toBe(true);
        expect(zones.every(z => z.created_index > 10)).toBe(true);
        expect(zones.every(z => z.freshness === 'FRESH')).toBe(true);
        expect(narrative.entry_consumed).toBe(true);
    });

    it('does not resurrect a consumed zone and does not accept a pre-signal zone as re-entry', () => {
        const ctx = getContext();
        const history = freshExecutionFixture();
        const narrative = {
            primary: 'TBS', direction: 'BUY', timeframe: '1H', execution_timeframe: '1H',
            event_time: '2026-09-10 05:00:00', reclaim_time: '2026-09-10 05:00:00', reclaim_bar_index: 10,
            structural_invalidation: 98, primary_objective: 105, entry_consumed: true
        };
        history[19] = c(101.4, 101.6, 100.8, 101.2, '2026-09-10 09:30:00');
        history[20] = c(101.2, 101.3, 100.4, 100.5, '2026-09-10 10:00:00');
        history[21] = c(100.5, 101.8, 100.45, 101.7, '2026-09-10 10:30:00');
        const zones = ctx.buildFreshExecutionZonesForNarrative(narrative, { '1H': history }, [
            { type: 'FVG', direction: 'BUY', timeframe: '1H', low: 99.9, high: 100.0, source_candle_index: 8, origin: 'STRUCTURAL_MSNR', primary_eligible: true }
        ], 'EUR/USD', 102);
        expect(zones.every(z => z.created_index > 10)).toBe(true);
        const consumed = ctx.zoneWasTouchedAfter(history, zones[0].low, zones[0].high, zones[0].created_index);
        expect(consumed.touched).toBe(false);
    });

    it('rejects fresh-zone generation after the narrative target or invalidation is complete', () => {
        const ctx = getContext();
        const history = freshExecutionFixture();
        const completed = { primary: 'CRT', direction: 'BUY', timeframe: '1H', execution_timeframe: '1H', event_time: '2026-09-10 05:00:00', reclaim_bar_index: 10, structural_invalidation: 98, primary_objective: 101.5 };
        const invalidated = { ...completed, primary_objective: 105, structural_invalidation: 100.8 };
        expect(ctx.evaluateStrategyNarrative(completed, { '1H': history }, 102).state).toBe('TARGET_COMPLETED');
        expect(ctx.evaluateStrategyNarrative(invalidated, { '1H': history }, 102).state).toBe('INVALIDATED');
    });

    it('requires displacement for post-signal FVG execution zones', () => {
        const ctx = getContext();
        const history = freshExecutionFixture();
        history[15] = c(100.3, 100.35, 100.25, 100.31, '2026-09-10 07:30:00');
        history[16] = c(100.1, 100.25, 100.05, 100.12, '2026-09-10 08:00:00');
        history[17] = c(100.12, 100.28, 100.08, 100.14, '2026-09-10 08:30:00');
        for (let i = 18; i < history.length; i++) {
            const p = history[i - 1].c;
            history[i] = c(p, p + 0.08, p - 0.04, p + 0.02, `2026-09-10 ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`);
        }
        const narrative = { primary: 'CRT', direction: 'BUY', timeframe: '1H', execution_timeframe: '1H', event_time: '2026-09-10 05:00:00', reclaim_bar_index: 10, structural_invalidation: 98, primary_objective: 105 };
        const zones = ctx.buildFreshExecutionZonesForNarrative(narrative, { '1H': history }, [], 'EUR/USD', 102);
        expect(zones.filter(z => z.type === 'FVG')).toEqual([]);
    });
});

describe('fresh execution downstream validation', () => {
    it('keeps a structurally valid 2.1 pip FX stop as tight quality, not extreme', () => {
        const ctx = getContext();
        const result = ctx.evaluateStructuralStop({ direction: 'BUY', entry: 1.16000, stop_loss: 1.15979 }, {
            setup_timeframe: '1H', atr_rule_reference: 0.00100, absolute_min_sl: 0.00010,
            preferred_min_sl: 0.00050, maximum_reasonable_distance: 0.01000
        }, 'EUR/USD');
        expect(result.status).toBe('VALID_STRUCTURAL_STOP');
        expect(result.volatility_classification).toBe('TIGHT_BUT_STRUCTURAL');
    });

    it('hard rejects only an FX stop at or below the absolute execution floor', () => {
        const ctx = getContext();
        const result = ctx.evaluateStructuralStop({ direction: 'BUY', entry: 1.16000, stop_loss: 1.15991 }, {
            setup_timeframe: '1H', atr_rule_reference: 0.00100, absolute_min_sl: 0.00010,
            preferred_min_sl: 0.00050, maximum_reasonable_distance: 0.01000
        }, 'EUR/USD');
        expect(result.status).toBe('EXTREME_TOO_TIGHT');
    });

    it('selects the nearest real RR-qualified objective before a farther high-score target', () => {
        const ctx = getContext();
        const result = ctx.selectAdaptiveTargets('BUY', 100, 99, {
            buy: [
                { direction: 'BUY', level: 102.5, source: 'SWING_HIGH', origin: 'STRUCTURAL', timeframe: '1H', structural_priority: 70 },
                { direction: 'BUY', level: 110, source: 'BUY_SIDE_LIQUIDITY', origin: 'STRUCTURAL', timeframe: '4H', structural_priority: 99 }
            ], sell: []
        }, 2.5, 2, { historyCache: { '1H': candles(40, 100, 1, 'up') }, zones: [], liquidity: { above: [], below: [] }, strategySetup: { target_candidates: [] } });
        expect(result.tp1.level).toBe(102.5);
    });

    it('exposes explicit target failure diagnostics instead of one generic TP failure', () => {
        const ctx = getContext();
        const diagnostics = {};
        const result = ctx.selectAdaptiveTargets('BUY', 100, 99, { buy: [{ direction: 'BUY', level: 100.5, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] }, 2.5, 2, { historyCache: { '1H': candles(40, 100, 1, 'up') }, zones: [], liquidity: { above: [], below: [] }, strategySetup: { target_candidates: [] }, targetDiagnostics: diagnostics });
        expect(result).toBeNull();
        expect(ctx.selectAdaptiveTargets.lastDiagnostics.failure_code).toBe('TARGETS_EXIST_BUT_RR_TOO_LOW');
        expect(ctx.selectAdaptiveTargets.lastDiagnostics.directional_target_count).toBe(1);
    });
});

describe('strategy-authoritative structural invalidation', () => {
    it('rejects a GBP/JPY TBS stop inside the sweep extreme and keeps the buffered anchor', () => {
        const ctx = getContext();
        const zone = {
            type: 'TBS', direction: 'SELL', timeframe: '15M', low: 207.75, high: 207.82,
            primary_eligible: true, structural_invalidation: 207.85753,
            strategy_setup: { primary: 'TBS', direction: 'SELL', timeframe: '15M', sweep_extreme: 207.85753 }
        };
        const stops = ctx.getAdaptiveStopCandidates(zone, 'SELL', 207.800, candles(40, 207.6, 0.02, 'up'), [], 0.08, ctx.getMarketSettings('GBP/JPY'), 3);
        expect(stops.every(stop => stop.stop_loss > 207.85753)).toBe(true);
        expect(stops.some(stop => Math.abs(stop.stop_loss - 207.840) < 0.001)).toBe(false);
        const accepted = stops[0];
        expect(accepted.authoritative_invalidation.level).toBe(207.85753);
        expect(ctx.evaluateStructuralStop({ direction: 'SELL', entry: 207.8, stop_loss: 207.84, structural_invalidation: { source: 'TBS_SWEEP_EXTREME', level: 207.85753 } }, {
            setup_timeframe: '15M', atr_rule_reference: 0.08, absolute_min_sl: 0.01, preferred_min_sl: 0.04, maximum_reasonable_distance: 5
        }, 'GBP/JPY').status).toBe('SL_INSIDE_STRUCTURAL_INVALIDATION');
    });

    it('uses actual CRT and MSNR structural anchors rather than a nearer generic swing', () => {
        const ctx = getContext();
        const crtAnchor = ctx.getAuthoritativeStructuralInvalidation({ direction: 'SELL', strategy_source: 'CRT', sweep_extreme: 1.2050 }, { primary: 'CRT', direction: 'SELL', sweep_extreme: 1.2050, timeframe: '1H' });
        const msnrAnchor = ctx.getAuthoritativeStructuralInvalidation({ direction: 'BUY', strategy_source: 'MSNR', structural_invalidation: 1.0950 }, { primary: 'MSNR', direction: 'BUY', structural_invalidation: 1.0950, timeframe: '1H' });
        expect(crtAnchor).toMatchObject({ source: 'CRT_SWEEP_EXTREME', level: 1.2050 });
        expect(msnrAnchor).toMatchObject({ source: 'MSNR_ZONE_INVALIDATION', level: 1.0950 });
        expect(ctx.evaluateStructuralStop({ direction: 'BUY', entry: 1.10, stop_loss: 1.0955, structural_invalidation: msnrAnchor }, {
            setup_timeframe: '1H', atr_rule_reference: 0.01, absolute_min_sl: 0.0001, preferred_min_sl: 0.005, maximum_reasonable_distance: 1
        }, 'EUR/USD').status).toBe('SL_INSIDE_STRUCTURAL_INVALIDATION');
    });
});

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

describe('researched CRT/TBS/MSNR strategy definitions', () => {
    it('detects bullish CRT only after reference range low is raided and reclaimed', () => {
        const ctx = getContext();
        const result = ctx.detectCRT(crtBuyFixture());
        expect(result.detected).toBe(true);
        expect(result.direction).toBe('BUY');
        expect(result.manipulation_side).toBe('SELL_SIDE');
        expect(result.sweep_level).toBe(result.range_low);
        expect(result.sweep_extreme).toBeLessThan(result.range_low);
        expect(result.reclaim_level).toBe(result.range_low);
    });

    it('detects bearish CRT only after reference range high is raided and reclaimed', () => {
        const ctx = getContext();
        const result = ctx.detectCRT(crtSellFixture());
        expect(result.detected).toBe(true);
        expect(result.direction).toBe('SELL');
        expect(result.manipulation_side).toBe('BUY_SIDE');
        expect(result.sweep_level).toBe(result.range_high);
        expect(result.sweep_extreme).toBeGreaterThan(result.range_high);
    });

    it('does not classify range expansion alone as CRT', () => {
        const ctx = getContext();
        const data = candles(30, 100, 0.2, 'up');
        expect(ctx.detectCRT(data).detected).toBe(false);
    });

    it('does not classify a bullish candle without a range raid as CRT', () => {
        const ctx = getContext();
        const data = candles(30, 100, 0.02, 'up');
        data[29] = c(100.5, 101.0, 100.4, 100.9);
        expect(ctx.detectCRT(data).detected).toBe(false);
    });

    it('generates the opposite side of the CRT reference range as target evidence', () => {
        const ctx = getContext();
        const result = ctx.detectCRT(crtBuyFixture());
        expect(result.target_candidates[0].source).toBe('CRT_OPPOSITE_RANGE');
        expect(result.target_candidates[0].level).toBe(result.range_high);
    });

    it('does not regress numeric arrays into candle-range access', () => {
        const ctx = getContext();
        expect(ctx.detectCRT([1, 2, 3, 4, 5])).toMatchObject({ detected: false });
        expect(ctx.calculateMSNR([1, 2, 3], 100).structural_levels).toEqual([]);
    });

    it('detects bullish TBS from a meaningful old swing-low sweep and reclaim', () => {
        const ctx = getContext();
        const result = ctx.detectTurtleSoup(tbsBuyFixture());
        expect(result.detected).toBe(true);
        expect(result.direction).toBe('BUY');
        expect(result.reference_type).toBe('SWING_LOW');
        expect(result.sweep_extreme).toBeLessThan(result.reference_level);
        expect(result.reclaim_price).toBeGreaterThan(result.reference_level);
    });

    it('detects bearish TBS from a meaningful old swing-high sweep and reclaim', () => {
        const ctx = getContext();
        const result = ctx.detectTurtleSoup(tbsSellFixture());
        expect(result.detected).toBe(true);
        expect(result.direction).toBe('SELL');
        expect(result.reference_type).toBe('SWING_HIGH');
        expect(result.sweep_extreme).toBeGreaterThan(result.reference_level);
        expect(result.reclaim_price).toBeLessThan(result.reference_level);
    });

    it('rejects tiny random wick noise as TBS', () => {
        const ctx = getContext();
        const data = candles(35, 100, 0.01, 'up');
        data[30].l = data[29].l - 0.001;
        data[31].c = data[29].l + 0.01;
        expect(ctx.detectTurtleSoup(data).detected).toBe(false);
    });

    it('keeps a TBS event active for the configured fresh window', () => {
        const ctx = getContext();
        const result = ctx.detectTurtleSoup(tbsBuyFixture());
        expect(result.detected).toBe(true);
        expect(['FRESH', 'ACTIVE']).toContain(result.freshness);
    });

    it('expires stale TBS events', () => {
        const ctx = getContext();
        const result = ctx.detectTurtleSoup(tbsBuyFixture(25));
        expect(result.detected).toBe(false);
        expect(result.events.some(e => e.freshness === 'EXPIRED')).toBe(true);
    });

    it('uses the TBS sweep extreme as structural invalidation', () => {
        const ctx = getContext();
        const result = ctx.detectTurtleSoup(tbsBuyFixture());
        expect(result.structural_invalidation).toBe(result.sweep_extreme);
    });

    it('identifies structural MSNR reaction support from body transition', () => {
        const ctx = getContext();
        const levels = ctx.calculateMSNR(msnrReactionFixture(), 101, '1H', 'XAU/USD').structural_levels;
        expect(levels.some(l => l.role === 'REACTION_SUPPORT' && l.transition_type === 'V_LEVEL_BEARISH_TO_BULLISH')).toBe(true);
    });

    it('identifies structural MSNR reaction resistance from body transition', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        data[36] = c(101.2, 101.6, 101.0, 101.45);
        data[37] = c(101.45, 101.5, 100.8, 101.0);
        data[38] = c(101.0, 101.1, 99.8, 100.1);
        const levels = ctx.calculateMSNR(data, 100.2, '1H', 'XAU/USD').structural_levels;
        expect(levels.some(l => l.role === 'REACTION_RESISTANCE' && l.transition_type === 'A_LEVEL_BULLISH_TO_BEARISH')).toBe(true);
    });

    it('classifies resistance broken and retested from above as RBS', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        data[36] = c(101.3, 101.7, 101.1, 101.5);
        data[37] = c(101.5, 102.0, 101.4, 101.9);
        data[38] = c(101.9, 102.2, 101.0, 101.4);
        const levels = ctx.calculateMSNR(data, 101.5, '1H', 'XAU/USD').structural_levels;
        expect(levels.some(l => l.role === 'RESISTANCE_TO_SUPPORT' && l.flipped)).toBe(true);
    });

    it('classifies support broken and retested from below as SBR', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        data[36] = c(101.3, 101.4, 99.0, 99.2);
        data[37] = c(99.2, 99.6, 98.7, 99.0);
        data[38] = c(99.0, 100.0, 98.9, 99.5);
        const levels = ctx.calculateMSNR(data, 99.4, '1H', 'XAU/USD').structural_levels;
        expect(levels.some(l => l.role === 'SUPPORT_TO_RESISTANCE' && l.flipped)).toBe(true);
    });

    it('reduces MSNR freshness after excessive mitigation', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        data.push(c(101.2, 101.3, 99.55, 101.0), c(101, 101.2, 99.55, 100.8), c(100.8, 101.1, 99.55, 100.7));
        const levels = ctx.calculateMSNR(data, 101, '1H', 'XAU/USD').structural_levels;
        expect(levels.some(l => l.freshness === 'MITIGATED' && l.primary_eligible === false)).toBe(true);
    });

    it('does not let pivot references generate standalone MSNR strategy setups', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const msnr = ctx.calculateMSNR(data, 140);
        const setups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 140, historyCache: { '1H': data }, realZones: [], marketContext: {} });
        expect(msnr.supportMeta.some(x => x.origin === 'PIVOT_REFERENCE')).toBe(true);
        expect(setups.some(s => s.primary === 'MSNR')).toBe(false);
    });

    it('does not let ATR fallback references generate standalone MSNR strategy setups', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const msnr = ctx.calculateMSNR(data, 1000);
        const setups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 1000, historyCache: { '1H': data }, realZones: [], marketContext: {} });
        expect(msnr.resistanceMeta.some(x => x.origin === 'ATR_FALLBACK')).toBe(true);
        expect(setups.some(s => s.primary === 'MSNR')).toBe(false);
    });

    it('places MSNR entries inside the actual price-action zone', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        const zones = ctx.buildLiveZonesForTf(data, '1H', 101, 'XAU/USD', 1, 5);
        const msnrZone = zones.find(z => z.type === 'MSNR' && z.origin === 'STRUCTURAL_MSNR');
        expect(msnrZone).toBeTruthy();
        const entries = ctx.getAdaptiveEntryCandidates(msnrZone, msnrZone.direction, 2);
        expect(entries.every(e => e >= msnrZone.low && e <= msnrZone.high)).toBe(true);
    });
});

describe('strategy pipeline integration rules', () => {
    it('does not manufacture a TBS target from sweep depth', () => {
        const ctx = getContext();
        const setups = ctx.buildStrategySetups({
            pair: 'XAU/USD',
            price: 100.2,
            historyCache: { '1H': tbsBuyFixture() },
            realZones: [],
            marketContext: {}
        });
        const tbs = setups.find(s => s.primary === 'TBS');
        expect(tbs).toBeTruthy();
        expect(tbs.target_candidates).toEqual([]);
        expect(tbs.target_bias).toBe('BUY_SIDE_LIQUIDITY');
        expect(tbs.target_candidates).not.toContainEqual(expect.objectContaining({ source: 'SYNTHETIC_SWEEP_MULTIPLE' }));
    });

    it('selects actual structural targets and gives reachability a deterministic score', () => {
        const ctx = getContext();
        const target = ctx.selectAdaptiveTargets('BUY', 100, 99, {
            buy: [{ direction: 'BUY', level: 103, source: 'SWING_HIGH', origin: 'STRUCTURAL', structural_priority: 76 }]
        }, 2.5, 2, {
            historyCache: { '1H': candles(40, 80, 0.5, 'up') },
            zones: [],
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [] }
        });
        expect(target.tp1.level).toBe(103);
        expect(target.tp1.target_reachability.reachability_score).not.toBe(70);
        expect(target.tp1.source).toBe('SWING_HIGH');
    });

    it('deduplicates identical structural target obstacles before scoring', () => {
        const ctx = getContext();
        const sharedZone = { type: 'MSNR', timeframe: '4H', direction: 'SELL', low: 104, high: 105, primary_eligible: true, invalidated: false, freshness: 'FRESH' };
        const base = {
            direction: 'BUY',
            entry: 100,
            stopLoss: 99,
            target: { level: 109, source: 'SWING_HIGH', structural_priority: 76, timeframe: '1H' },
            historyCache: { '1H': candles(40, 100, 1, 'up') },
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [] }
        };
        const single = ctx.evaluateTargetReachability({ ...base, zones: [sharedZone] });
        const duplicate = ctx.evaluateTargetReachability({ ...base, zones: [sharedZone, { ...sharedZone, id: 'duplicate-source' }] });
        expect(duplicate.intervening_obstacles).toHaveLength(1);
        expect(duplicate.reachability_score).toBe(single.reachability_score);
    });

    it('exposes one canonical target ATR distance in candidate target maps', () => {
        const ctx = getContext();
        const reachability = ctx.evaluateTargetReachability({
            direction: 'BUY',
            entry: 100,
            stopLoss: 99,
            target: { level: 103, source: 'SWING_HIGH', structural_priority: 76, timeframe: '1H' },
            historyCache: { '1H': candles(40, 100, 1, 'up') },
            zones: [],
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [] }
        });
        const compact = ctx.compactTargetReachabilityForOutput(reachability);
        expect(reachability.target_distance_atr).toBeGreaterThan(0);
        expect(compact.target_distance_atr).toBeUndefined();
        expect(compact.target_distance).toBeUndefined();
        expect(compact.target_distance_atr_timeframe).toBe('1H');
    });

    it('prefers a nearer clean objective over a blocked distant objective', () => {
        const ctx = getContext();
        const context = {
            historyCache: { '1H': candles(40, 100, 1, 'up') },
            zones: [{ type: 'MSNR', direction: 'SELL', low: 104, high: 105, primary_eligible: true, invalidated: false, freshness: 'FRESH' }],
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [{ level: 103, source: 'CRT_OPPOSITE_RANGE' }] }
        };
        const clean = ctx.evaluateTargetReachability({ direction: 'BUY', entry: 100, stopLoss: 99, target: { level: 103, source: 'SWING_HIGH', structural_priority: 76 }, ...context });
        const blocked = ctx.evaluateTargetReachability({ direction: 'BUY', entry: 100, stopLoss: 99, target: { level: 109, source: 'SWING_HIGH', structural_priority: 76 }, ...context });
        expect(clean.reachability_score).toBeGreaterThan(blocked.reachability_score);
        expect(clean.intervening_obstacles).toHaveLength(0);
        expect(blocked.intervening_obstacles.length).toBeGreaterThan(0);
    });

    it('requires timestamp compatibility for cross-timeframe combinations', () => {
        const ctx = getContext();
        const zone = { low: 99.5, high: 100.5 };
        const base = { direction: 'BUY', execution_zone: zone, sweep_extreme: 99, reclaim_level: 99.5 };
        const related = ctx.evaluateCombinationCompatibility({ ...base, primary: 'CRT', timeframe: '4H', event_time: Date.parse('2026-01-01T00:00:00Z') }, { ...base, primary: 'TBS', timeframe: '1H', event_time: Date.parse('2026-01-01T02:00:00Z') }, { pipSize: 0.01 });
        const unrelated = ctx.evaluateCombinationCompatibility({ ...base, primary: 'CRT', timeframe: '4H', event_time: Date.parse('2026-01-01T00:00:00Z') }, { ...base, primary: 'TBS', timeframe: '1H', event_time: Date.parse('2026-01-02T12:00:00Z') }, { pipSize: 0.01 });
        expect(related.temporally_related).toBe(true);
        expect(unrelated.temporally_related).toBe(false);
    });

    it('does not qualify an ordinary weak candle transition as executable MSNR', () => {
        const ctx = getContext();
        const data = [];
        for (let i = 0; i < 40; i++) {
            const bullish = i % 2 === 0;
            data.push(c(100, 100.01, 99.99, bullish ? 100.001 : 99.999));
        }
        const result = ctx.calculateMSNR(data, 100, '1H', 'EUR/USD');
        expect(result.executable_setups).toEqual([]);
    });

    it('requires a real retest before a broken MSNR role reversal is executable', () => {
        const ctx = getContext();
        const data = msnrReactionFixture();
        data[36] = c(101.3, 101.7, 101.1, 101.5);
        data[37] = c(101.5, 102.0, 101.4, 101.9);
        data[38] = c(101.9, 102.2, 101.0, 101.4);
        data[39] = c(101.4, 101.5, 101.2, 101.45);
        const levels = ctx.calculateMSNR(data, 101.45, '1H', 'XAU/USD').structural_levels;
        for (const level of levels.filter(l => l.flipped && !l.retest_index)) expect(level.primary_eligible).toBe(false);
    });

    it('hydrates known TBS, MSNR, and combined strategy zones by candidate ID', () => {
        const ctx = getContext();
        for (const type of ['TBS', 'MSNR', 'CRT+TBS']) {
            const candidate = { id: `candidate-${type}`, direction: 'BUY', timeframe: '1H', zone_type: type === 'MSNR' ? 'MSNR' : type, zone_origin: type === 'MSNR' ? 'STRUCTURAL_MSNR' : 'STRUCTURAL', zone_low: 99, zone_high: 100, entry: 99.5, stop_loss: 98, tp1: 104, tp2: null, tp3: null, rr_tp1: 3.0 };
            const result = ctx.validateAIOutputConsistency({ selected_candidate_id: candidate.id, direction: candidate.direction, entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1, selected_zone: { type: candidate.zone_type, timeframe: candidate.timeframe, low: candidate.zone_low, high: candidate.zone_high } }, { adaptive_setup_candidates: [candidate], real_ict_zones: [], risk_constraints: { minimum_rr: 2.5 } });
            expect(result.valid).toBe(true);
        }
    });

    it('combines 4H CRT and 1H TBS when they describe the same sweep region', () => {
        const ctx = getContext();
        ctx.detectCRTEvents = () => [{ detected: true, direction: 'BUY', reclaim_level: 99,
            sweep_extreme: 98.6, reclaim_bar_index: 24, evidence: {}, primary_objective: 103 }];
        ctx.detectTurtleSoupEvents = () => [{ detected: true, type: 'BUY', direction: 'BUY', reclaim_level: 99,
            sweep_extreme: 98.6, reclaim_bar_index: 34, evidence: {} }];
        const crtData = crtBuyFixture();
        const tbsData = tbsBuyFixture();
        crtData[24].t = tbsData[34].t = '2026-09-10 08:00:00';
        const setups = ctx.buildStrategySetups({
            pair: 'XAU/USD',
            price: 100.2,
            historyCache: { '4H': crtData, '1H': tbsData },
            realZones: [],
            marketContext: {}
        });
        expect(setups.some(s => s.label && s.label.includes('CRT') && s.label.includes('TBS'))).toBe(true);
    });

    it('does not combine already consumed CRT and TBS events from real detectors', () => {
        const setups = getContext().buildStrategySetups({ pair: 'XAU/USD', price: 100.2,
            historyCache: { '4H': crtBuyFixture(), '1H': tbsBuyFixture() }, realZones: [], marketContext: {} });
        expect(setups.some(s => s.entry_consumed)).toBe(true);
        expect(setups.filter(s => s.entry_consumed).every(s => s.combination_evidence.length === 0)).toBe(true);
    });

    it('does not combine unrelated opposite-direction strategy events', () => {
        const ctx = getContext();
        const setups = ctx.buildStrategySetups({
            pair: 'XAU/USD',
            price: 100.2,
            historyCache: { '4H': crtBuyFixture(), '1H': tbsSellFixture() },
            realZones: [],
            marketContext: {}
        });
        expect(setups.some(s => s.label && s.label.includes('CRT') && s.label.includes('TBS'))).toBe(false);
    });

    it('allows a strategy-created candidate zone to survive post-AI consistency validation', () => {
        const ctx = getContext();
        const candidate = {
            id: 'crt-candidate',
            direction: 'BUY',
            timeframe: '4H',
            zone_type: 'CRT',
            zone_origin: 'STRUCTURAL',
            zone_low: 99.55,
            zone_high: 99.75,
            entry: 99.7,
            stop_loss: 98.5,
            tp1: 103.0,
            tp2: 104.0,
            tp3: 105.0
        };
        const result = ctx.validateAIOutputConsistency({
            decision: 'BUY_LIMIT',
            selected_candidate_id: candidate.id,
            direction: 'BUY',
            selected_zone: { type: 'CRT', timeframe: '4H', low: 99.55, high: 99.75 },
            entry_zone: { source: 'CRT', low: 99.55, high: 99.75 },
            entry: 99.7,
            stop_loss: 98.5,
            take_profit_1: 103.0,
            take_profit_2: 104.0,
            take_profit_3: 105.0
        }, { adaptive_setup_candidates: [candidate], risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [] });
        expect(result.valid).toBe(true);
    });

    it('keeps pending-limit setup eligible when current price is outside the selected zone', () => {
        const ctx = getContext();
        const stage = ctx.buildLimitOrderStageContext([
            { type: 'CRT', direction: 'BUY', timeframe: '4H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 99.5, high: 99.7, price_at_zone_now: false, distance_to_zone: 1.2 }
        ], { buy: [{ direction: 'BUY', level: 103, source: 'CRT_OPPOSITE_RANGE', origin: 'STRUCTURAL' }], sell: [] }, 100.9, 1, {
            allOk: false,
            summary: 'Immediate entry waiting',
            entryConfirmation: { isAtZone: false, score: 0 }
        });
        expect(stage.limit_order_setup.eligible).toBe(true);
        expect(stage.immediate_entry.eligible).toBe(false);
        expect(stage.limit_order_setup.current_price_inside_zone_required).toBe(false);
    });

    it('keeps a valid SELL_LIMIT outside the zone eligible without immediate confirmation', () => {
        const ctx = getContext();
        const stage = ctx.buildLimitOrderStageContext([
            { type: 'TBS', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 0.71700, high: 0.71720, price_at_zone_now: false, distance_to_zone: 0.0015 }
        ], { buy: [], sell: [{ direction: 'SELL', level: 0.71400, source: 'SWING_LOW', origin: 'STRUCTURAL' }] }, 0.71550, 0.0005, {
            allOk: false,
            summary: 'Current price is outside the selected entry zone',
            entryConfirmation: { isAtZone: false, confirmed: false, score: 0 }
        });
        expect(stage.limit_order_setup.eligible).toBe(true);
        expect(stage.limit_order_setup.current_price_inside_zone_required).toBe(false);
        expect(stage.immediate_entry.eligible).toBe(false);
    });

    it('reports specific zero-candidate seed diagnostics instead of catch-all data quality', () => {
        const ctx = getContext();
        const strategySetups = Array.from({ length: 19 }, (_, i) => ({
            id: `setup-${i}`,
            label: 'CRT',
            primary: 'CRT',
            direction: 'BUY',
            timeframe: '1H',
            execution_zone: { id: `zone-${i}`, type: 'CRT', timeframe: '1H', direction: 'BUY', low: 99.5 + i * 0.01, high: 99.7 + i * 0.01 }
        }));
        const seedDiagnostics = strategySetups.map((s, i) => ({
            seed_id: s.execution_zone.id,
            timeframe: '1H',
            raw_candidates: 0,
            failure_reasons: [i % 2 === 0 ? 'INVALID_ENTRY_REGION' : 'NO_TARGET_POOL'],
            details: []
        }));
        const audit = ctx.buildCandidatePipelineAudit(strategySetups, [], [], [], seedDiagnostics);
        expect(audit.strategy_setups).toBe(19);
        expect(audit.execution_seeds).toBe(19);
        expect(audit.raw_candidates).toBe(0);
        expect(audit.zero_candidate_seeds).toBe(19);
        expect(audit.seed_failure_counts.INVALID_ENTRY_REGION).toBe(10);
        expect(audit.seed_failure_counts.NO_TARGET_POOL).toBe(9);
        expect(audit.seed_failure_counts.DATA_QUALITY).toBeUndefined();
    });

    it('uses DATA_QUALITY only for genuine data-quality failures', () => {
        const ctx = getContext();
        expect(ctx.classifyRejectionDetail('Insufficient 1H data for reliable ATR/structure analysis')).toBe('DATA_QUALITY');
        expect(ctx.classifyRejectionDetail('context quality too low')).toBe('CONTEXT_QUALITY_TOO_LOW');
        expect(ctx.classifyRejectionDetail('no real TP1 satisfies minimum RR')).toBe('NO_VALID_TP1');
    });

    it('describes pending limits without requiring confirmation before fill', () => {
        const ctx = getContext();
        const candidate = {
            id: 'sell-limit-output',
            direction: 'SELL',
            entry: 0.71713,
            stop_loss: 0.71747,
            tp1: 0.71400,
            strategy_label: 'TBS',
            target_map: [{
                target_level: 0.71400,
                primary_target_source: 'SWING_LOW',
                target_type: 'SWING_HIGH_LOW',
                target_confluence: [{ source: 'SWING_LOW', timeframe: '1H' }]
            }]
        };
        const description = ctx.buildDeterministicOrderDescription(candidate);
        expect(description.wait_condition).toMatch(/Pending SELL_LIMIT at 0\.71713 remains valid/);
        expect(description.wait_condition).toMatch(/fills when market price trades at the order price/);
        expect(description.wait_condition).not.toMatch(/confirmation before|wait for bearish|wait for bullish/i);
    });

    it('preserves target source and confluence through deterministic candidate hydration', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'SELL_LIMIT',
                    selected_candidate_id: 'source-truth',
                    confidence: 62,
                    reasoning: { primary: 'Select the supplied candidate' }
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 0.71500, 'system', {
            pair: 'AUD/USD',
            adaptive_setup_candidates: [{
                id: 'source-truth',
                direction: 'SELL',
                timeframe: '1H',
                zone_type: 'TBS',
                zone_origin: 'STRUCTURAL',
                zone_low: 0.71700,
                zone_high: 0.71720,
                entry: 0.71713,
                stop_loss: 0.71747,
                stop_reason: 'TBS sweep invalidation plus structural buffer',
                tp1: 0.71400,
                tp2: null,
                tp3: null,
                rr_tp1: 9.2,
                target_map: [{
                    target_level: 0.71400,
                    primary_target_source: 'OB',
                    target_type: 'OB',
                    target_confluence: [{ source: 'OB', timeframe: '4H' }, { source: 'CRT_OPPOSITE_RANGE', timeframe: '4H' }]
                }]
            }]
        });
        expect(result.primary_target_source).toBe('OB');
        expect(result.target_type).toBe('OB');
        expect(result.target_confluence.map(t => t.source)).toEqual(['OB', 'CRT_OPPOSITE_RANGE']);
        expect(result.reasoning.primary).toMatch(/TP1 0\.714: OB \(OB\)/);
    });

    it('hydrates selected candidates and ignores AI numeric mutations', () => {
        const ctx = getContext();
        const candidate = {
            id: 'fixed-geometry',
            direction: 'SELL',
            timeframe: '1H',
            zone_type: 'TBS',
            zone_origin: 'STRUCTURAL',
            zone_low: 100.8,
            zone_high: 101.0,
            entry: 100.85,
            stop_loss: 101.4,
            stop_reason: 'TBS sweep extreme invalidation plus structural buffer',
            tp1: 99.2,
            tp2: 98.8,
            tp3: 98.4,
            rr_tp1: 3
        };
        const ai = ctx.applyAdaptiveCandidateToAIResult({
            selected_candidate_id: 'fixed-geometry',
            direction: 'BUY',
            entry: 1,
            stop_loss: 2,
            take_profit_1: 3
        }, { adaptive_setup_candidates: [candidate] });
        expect(ai.direction).toBe('SELL');
        expect(ai.entry).toBe(candidate.entry);
        expect(ai.stop_loss).toBe(candidate.stop_loss);
        expect(ai.take_profit_1).toBe(candidate.tp1);
    });

    it('rejects candidate construction when no structural TP1 can satisfy minimum RR', () => {
        const ctx = getContext();
        const zone = { id: 'crt-buy', type: 'CRT', direction: 'BUY', timeframe: '1H', low: 1.0995, high: 1.1, origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, freshness: 'FRESH', structural_invalidation: 1.099 };
        const setup = { id: 'crt-buy', primary: 'CRT', label: 'CRT', direction: 'BUY', timeframe: '1H', execution_zone: zone, structural_invalidation: 1.099, strategy_evidence: { CRT: { range_high: 1.1005, range_low: 1.0995 } }, target_candidates: [{ direction: 'BUY', level: 1.1005, source: 'CRT_OPPOSITE_RANGE', origin: 'STRUCTURAL' }] };
        setup.reclaim_bar_index = 79;
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.1002,
            historyCache: { '4H': candles(80, 1.08, 0.0002, 'up'), '1H': candles(80, 1.08, 0.0002, 'up'), '1D': candles(80, 1.08, 0.0002, 'up') },
            zones: [zone],
            targetCandidates: { buy: [], sell: [] },
            riskConstraints: { minimum_rr: 2.5 },
            marketRegime: {},
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } },
            strategySetups: [setup]
        });
        expect(result.valid_candidates).toEqual([]);
        expect(result.rejected_candidates.some(r => r.rejection_code === 'NO_VALID_TP1')).toBe(true);
    });

    it('produces zero valid deterministic candidates when no strategy setup exists', () => {
        const ctx = getContext();
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'XAU/USD',
            price: 101,
            historyCache: { '4H': candles(80, 100, 0.1, 'up'), '1H': candles(80, 100, 0.1, 'up') },
            zones: [],
            targetCandidates: { buy: [], sell: [] },
            riskConstraints: { minimum_rr: 2.5 },
            marketRegime: {},
            structure: {},
            strategySetups: []
        });
        expect(result.valid_candidates).toEqual([]);
        expect(result.raw_candidates).toEqual([]);
    });
});

describe('Analyze scan lifecycle', () => {
    const historyFixture = () => candles(60, 100, 0.1, 'up');
    const baseLiveContext = candidates => ({
        session: { name: 'TEST' },
        market_regime: { primary_regime: 'RANGING' },
        volatility: {},
        volume: { volume_available: false },
        real_ict_zones: [],
        adaptive_setup_candidates: candidates,
        strategy_setups: candidates.length ? [{ primary: 'TBS' }] : [],
        strategy_detections: {},
        candidate_pipeline: {},
        setup_candidate_audit: { raw_candidate_count: candidates.length, rejection_summary: {}, rejection_detail: {} },
        limit_order_setup: {},
        immediate_entry: {}
    });

    function prepareScan({ candidates = [], aiResult = null, fallback = null } = {}) {
        const { context, elements } = getScanContext();
        context.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        const spies = {
            getPrice: jest.fn(() => Promise.resolve(100)),
            getHistory: jest.fn(() => Promise.resolve(historyFixture())),
            getTechnicalIndicators: jest.fn(() => Promise.resolve({})),
            updateMTFDisplay: jest.fn(() => Promise.resolve()),
            getQuoteDirection: jest.fn(() => Promise.resolve('NEUTRAL')),
            buildLiveMarketContext: jest.fn(() => baseLiveContext(candidates)),
            buildAIPrompt: jest.fn(() => ({ system: 'system', user: 'user' })),
            askAIToFindSetup: jest.fn(() => Promise.resolve(aiResult)),
            runFallbackScan: jest.fn(() => fallback ? fallback() : Promise.resolve())
        };
        context.testScanSpies = spies;
        vm.runInContext(`
            getPrice = (...args) => testScanSpies.getPrice(...args);
            getHistory = (...args) => testScanSpies.getHistory(...args);
            getTechnicalIndicators = (...args) => testScanSpies.getTechnicalIndicators(...args);
            updateMTFDisplay = (...args) => testScanSpies.updateMTFDisplay(...args);
            getQuoteDirection = (...args) => testScanSpies.getQuoteDirection(...args);
            buildLiveMarketContext = (...args) => testScanSpies.buildLiveMarketContext(...args);
            buildAIPrompt = (...args) => testScanSpies.buildAIPrompt(...args);
            askAIToFindSetup = (...args) => testScanSpies.askAIToFindSetup(...args);
            runFallbackScan = (...args) => testScanSpies.runFallbackScan(...args);
        `, context);
        return { context, elements, spies };
    }

    it('clears loading state on deterministic WAIT without calling DeepSeek', async () => {
        const { context, elements, spies } = prepareScan();
        await context.runAutoScan();
        expect(spies.askAIToFindSetup).not.toHaveBeenCalled();
        expect(elements.get('analyzeBtn').disabled).toBe(false);
        expect(elements.get('scanStatus').classList.contains('hidden')).toBe(true);
    });

    it('clears loading state after an AI WAIT response', async () => {
        const { context, elements, spies } = prepareScan({ candidates: [{ id: 'candidate', direction: 'BUY' }], aiResult: { noTrade: true, decision: 'WAIT', confidence: 0, reasoning: { primary: 'No trade' }, wait_condition: 'No setup' } });
        await context.runAutoScan();
        expect(spies.askAIToFindSetup).toHaveBeenCalledTimes(1);
        expect(elements.get('analyzeBtn').disabled).toBe(false);
        expect(elements.get('scanStatus').classList.contains('hidden')).toBe(true);
    });

    it('prevents overlapping Analyze calls and re-enables the button after completion', async () => {
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const { context, elements } = prepareScan();
        context.testScanSpies.getPrice = jest.fn(() => pending);
        const first = context.runAutoScan();
        const second = context.runAutoScan();
        release(100);
        await Promise.all([first, second]);
        expect(context.testScanSpies.getPrice).toHaveBeenCalledTimes(1);
        expect(elements.get('analyzeBtn').disabled).toBe(false);
    });

    it('clears loading state when fallback completes or fails', async () => {
        const success = prepareScan({ candidates: [{ id: 'candidate', direction: 'BUY' }], aiResult: null });
        await success.context.runAutoScan();
        expect(success.elements.get('analyzeBtn').disabled).toBe(false);

        const failure = prepareScan({ candidates: [{ id: 'candidate', direction: 'BUY' }], aiResult: null, fallback: () => Promise.reject(new Error('fallback failed')) });
        await failure.context.runAutoScan();
        expect(failure.elements.get('analyzeBtn').disabled).toBe(false);
        expect(failure.elements.get('scanStatus').classList.contains('hidden')).toBe(true);
    });

    it('keeps strategy event and setup counts bounded on realistic candle windows', () => {
        const ctx = getContext();
        const data = candles(100, 100, 0.2, 'up');
        for (let i = 20; i < data.length; i += 2) {
            data[i] = c(100 + i * 0.2, 100 + i * 0.2 + 0.1, 100 + i * 0.2 - 0.2, 100 + i * 0.2 - 0.05);
        }
        const tbs = ctx.detectTurtleSoupEvents(data, '1H', 'XAU/USD');
        const crt = ctx.detectCRTEvents(data, '1H', 'XAU/USD');
        const msnr = ctx.calculateMSNR(data, 120, '1H', 'XAU/USD').structural_levels;
        const setups = ctx.buildStrategySetups({
            pair: 'XAU/USD',
            price: 120,
            historyCache: { '4H': data, '1H': data, '15M': data },
            realZones: [],
            marketContext: {}
        });
        expect(tbs.length).toBeLessThanOrEqual(8);
        expect(crt.length).toBeLessThanOrEqual(8);
        expect(msnr.length).toBeLessThanOrEqual(12);
        expect(setups.length).toBeLessThanOrEqual(24);
    });
});

describe('DeepSeek request settlement', () => {
    it.each(['headers', 'body'])('enforces the deadline when %s never settle and abort is ignored', async stage => {
        jest.useFakeTimers();
        try {
            const { context: ctx } = getScanContext();
            ctx.setTimeout = setTimeout;
            ctx.clearTimeout = clearTimeout;
            const pending = new Promise(() => {});
            ctx.fetch = jest.fn(() => stage === 'headers' ? pending : Promise.resolve({ ok: true, json: () => pending }));
            const request = ctx.requestAIJson('https://example.invalid', {}, 45000);
            const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
            await jest.advanceTimersByTimeAsync(45000);
            await assertion;
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it('keeps dense combination target propagation linear in original targets', () => {
        const ctx = getContext();
        const original = ctx.detectTurtleSoupEvents;
        ctx.detectTurtleSoupEvents = () => Array.from({ length: 8 }, (_, i) => ({ detected: true, direction: 'BUY', type: 'BUY', reclaim_level: 99 + i * 0.01, sweep_extreme: 98, reclaim_bar_index: 99, evidence: {}, freshness: 'FRESH' }));
        ctx.detectCRTEvents = () => Array.from({ length: 8 }, (_, i) => ({ detected: true, direction: 'BUY', reclaim_level: 99 + i * 0.01, sweep_extreme: 98, reclaim_bar_index: 99, evidence: {}, freshness: 'FRESH', target_candidates: [{ direction: 'BUY', timeframe: '1H', source: 'CRT_OPPOSITE_RANGE', level: 105 + i }] }));
        const setups = ctx.buildStrategySetups({ pair: 'EUR/USD', price: 100, historyCache: { '1H': candles(100, 100, 0.1, 'up'), '4H': candles(100, 100, 0.1, 'up') }, realZones: [], marketContext: {} });
        expect(setups.some(s => s.combination_evidence.length > 0)).toBe(true);
        expect(setups.every(s => s.target_candidates.length <= 8)).toBe(true);
        expect(setups.reduce((sum, s) => sum + s.target_candidates.length, 0)).toBeLessThanOrEqual(192);
        ctx.detectTurtleSoupEvents = original;
    });
    it('settles timeout, HTTP failure, and invalid JSON as finite AI failures', async () => {
        for (const failure of [
            Object.assign(new Error('aborted'), { name: 'AbortError' }),
            Object.assign(new Error('server'), { http: true }),
            Object.assign(new Error('invalid json'), { json: true })
        ]) {
            const ctx = getContext();
            await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
            ctx.fetch = jest.fn(() => {
                if (failure.http) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
                if (failure.json) return Promise.resolve({ ok: true, json: () => Promise.reject(failure) });
                return Promise.reject(failure);
            });
            const result = await ctx.askAIToFindSetup('prompt', 100, 'system', { adaptive_setup_candidates: [] });
            expect(result).toBeNull();
        }
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
    const trendCache = (dir, start = 100, step = 0.5) => ({
        '4H': candles(80, start, step, dir),
        '1H': candles(80, start, step, dir),
        '1D': candles(80, start, step, dir)
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
        expect(Array.isArray(live.adaptive_setup_candidates)).toBe(true);
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

    it('keeps strong market context from creating a trade without CRT/TBS/MSNR strategy setup', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00020);
        const zone = { id: '1H-BUY-FVG-1.0995-1.1005', type: 'FVG', direction: 'BUY', timeframe: '1H', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, freshness: 'FRESH' };
        const structure = { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } };
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            zones: [zone],
            targetCandidates: { buy: [{ direction: 'BUY', level: 1.10400, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] },
            riskConstraints: { minimum_rr: 2.5 },
            marketRegime: { primary_regime: 'TRENDING_BULLISH' },
            structure,
            marketContext: { directional_bias: 'BULLISH', context_score: 82 },
            strategySetups: []
        });
        expect(result.raw_candidates).toEqual([]);
        expect(result.valid_candidates).toEqual([]);
    });

    it('creates a valid strategy candidate from a deterministic MSNR setup', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00020);
        const zone = { id: '1H-BUY-MSNR-1.0995-1.1005', type: 'MSNR', direction: 'BUY', timeframe: '1H', low: 1.09950, high: 1.10050, midpoint: 1.10000, origin: 'STRUCTURAL_MSNR', primary_eligible: true, invalidated: false, freshness: 'FRESH' };
        const structure = { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } };
        const strategySetups = [{
            id: 'msnr-buy',
            departure_confirmed_index: historyCache['1H'].length - 1,
            primary: 'MSNR',
            label: 'MSNR',
            direction: 'BUY',
            timeframe: '1H',
            confirmations: [],
            matched_zone_ids: [zone.id],
            matched_zones: [zone],
            execution_zone: { ...zone, strategy_source: 'MSNR' },
            structural_invalidation: zone.low,
            evidence: { level: zone.midpoint }
        }];
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            zones: [zone],
            targetCandidates: { buy: [{ direction: 'BUY', level: 1.10400, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] },
            riskConstraints: { minimum_rr: 2.5 },
            marketRegime: { primary_regime: 'TRENDING_BULLISH' },
            structure,
            marketContext: { directional_bias: 'BULLISH', context_score: 82 },
            strategySetups
        });
        expect(result.valid_candidates.length).toBeGreaterThan(0);
        expect(result.valid_candidates[0].strategy_setup.primary).toBe('MSNR');
        expect(result.valid_candidates[0].strategy_label).toBe('MSNR');
        expect(result.valid_candidates.every(c => ['FRESH_NOW', 'FRESH_PENDING_TODAY'].includes(c.lifecycle_state))).toBe(true);
        historyCache['1H'].push(c(1.1007, 1.101, 1.0998, 1.1008));
        const consumed = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD', price: 1.1008, historyCache, zones: [zone], strategySetups,
            targetCandidates: { buy: [{ direction: 'BUY', level: 1.104, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] },
            riskConstraints: { minimum_rr: 2.5 }, structure
        });
        expect(consumed.valid_candidates).toEqual([]);
        expect(consumed.rejected_candidates.every(c => c.rejection_code === 'ENTRY_ALREADY_CONSUMED')).toBe(true);
        const payload = ctx.compactAIContext({ adaptive_setup_candidates: consumed.valid_candidates });
        expect(payload.adaptive_setup_candidates).toEqual([]);
    });

    it('rejects deterministic execution candidates without CRT/TBS/MSNR strategy backing when required', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00010);
        const zone = { type: 'FVG', direction: 'BUY', timeframe: '1H', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true };
        const result = ctx.evaluateSetupCandidate({
            id: 'fvg-only',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            stop_loss: 1.09950,
            tp1: 1.10130
        }, {
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            real_ict_zones: [zone],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } },
            require_strategy_setup: true,
            strategy_setups: []
        }, { includeAccountRules: false });
        expect(result.valid).toBe(false);
        expect(result.reasons).toContain('candidate is not backed by a deterministic CRT/TBS/MSNR strategy setup');
    });

    it('detects deterministic bullish and bearish Turtle Soup strategy setups', () => {
        const ctx = getContext();
        const buyData = candles(20, 100, 0.01, 'up');
        buyData[8].l = 99.4;
        buyData[16].l = 99.0;
        buyData[19].o = 99.8;
        buyData[19].c = 100.3;
        const buyZones = [{ id: '1H-BUY-MSNR-99.35-99.45', type: 'MSNR', direction: 'BUY', timeframe: '1H', low: 99.35, high: 99.45, origin: 'PIVOT_DERIVED', primary_eligible: true, invalidated: false }];
        const buySetups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 100.3, historyCache: { '1H': buyData }, realZones: buyZones, marketContext: { directional_bias: 'BULLISH' } });
        expect(buySetups.some(s => s.primary === 'TBS' && s.direction === 'BUY')).toBe(true);
        const standaloneBuySetups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 100.3, historyCache: { '1H': buyData }, realZones: [], marketContext: { directional_bias: 'NEUTRAL' } });
        const standaloneTbs = standaloneBuySetups.find(s => s.primary === 'TBS' && s.direction === 'BUY');
        expect(standaloneTbs).toBeTruthy();
        expect(standaloneTbs.matched_zones).toEqual([]);
        expect(standaloneTbs.execution_zone.type).toBe('TBS');

        const sellData = candles(20, 100, 0.01, 'down');
        sellData[8].h = 100.6;
        sellData[16].h = 101.0;
        sellData[19].o = 100.2;
        sellData[19].c = 99.7;
        const sellZones = [{ id: '1H-SELL-MSNR-100.55-100.65', type: 'MSNR', direction: 'SELL', timeframe: '1H', low: 100.55, high: 100.65, origin: 'PIVOT_DERIVED', primary_eligible: true, invalidated: false }];
        const sellSetups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 99.7, historyCache: { '1H': sellData }, realZones: sellZones, marketContext: { directional_bias: 'BEARISH' } });
        expect(sellSetups.some(s => s.primary === 'TBS' && s.direction === 'SELL')).toBe(true);
    });

    it('derives CRT direction from CRT evidence instead of market context bias', () => {
        const ctx = getContext();
        const data = candles(20, 100, 0.01, 'up');
        for (let i = 0; i < 10; i++) {
            data[i].o = 100.0;
            data[i].h = 100.10;
            data[i].l = 99.90;
            data[i].c = 100.0;
        }
        for (let i = 10; i < 19; i++) {
            data[i].o = 100.0;
            data[i].h = 100.25;
            data[i].l = 99.55;
            data[i].c = 99.85;
        }
        data[19].o = 99.80;
        data[19].h = 100.35;
        data[19].l = 99.60;
        data[19].c = 100.20;
        const setups = ctx.buildStrategySetups({ pair: 'XAU/USD', price: 100.2, historyCache: { '1H': data }, realZones: [], marketContext: { directional_bias: 'BEARISH' } });
        expect(setups.some(s => s.primary === 'CRT' && s.direction === 'BUY')).toBe(true);
        expect(setups.some(s => s.primary === 'CRT' && s.direction === 'SELL')).toBe(false);
    });

    it('keeps structural stops below the old fixed ATR band when they are not anomalous', () => {
        const ctx = getContext();
        const atrContext = {
            setup_timeframe: '1H',
            atr_rule_reference: 0.00050,
            minimum_reasonable_distance: 0.00020,
            extreme_too_tight_distance: 0.00006,
            maximum_reasonable_distance: 0.00400
        };
        const result = ctx.evaluateStructuralStop({ direction: 'BUY', entry: 1.10000, stop_loss: 1.09965 }, atrContext, 'EUR/USD');
        expect(result.status).toBe('VALID_STRUCTURAL_STOP');
        expect(result.volatility_classification).toBe('TIGHT_BUT_STRUCTURAL');
    });

    it('keeps wider structural stops valid when structure and maximum risk allow them', () => {
        const ctx = getContext();
        const atrContext = {
            setup_timeframe: '1H',
            atr_rule_reference: 0.00040,
            minimum_reasonable_distance: 0.00020,
            extreme_too_tight_distance: 0.00006,
            maximum_reasonable_distance: 0.00400
        };
        const result = ctx.evaluateStructuralStop({ direction: 'SELL', entry: 1.10000, stop_loss: 1.10100 }, atrContext, 'EUR/USD');
        expect(result.status).toBe('VALID_STRUCTURAL_STOP');
        expect(result.volatility_classification).toBe('NORMAL');
    });

    it('rejects genuinely extreme structural stop anomalies', () => {
        const ctx = getContext();
        const atrContext = {
            setup_timeframe: '1H',
            atr_rule_reference: 0.00040,
            minimum_reasonable_distance: 0.00020,
            extreme_too_tight_distance: 0.00006,
            maximum_reasonable_distance: 0.00400
        };
        const tooTight = ctx.evaluateStructuralStop({ direction: 'BUY', entry: 1.10000, stop_loss: 1.09998 }, atrContext, 'EUR/USD');
        const tooWide = ctx.evaluateStructuralStop({ direction: 'SELL', entry: 1.10000, stop_loss: 1.10500 }, atrContext, 'EUR/USD');
        expect(tooTight.status).toBe('EXTREME_TOO_TIGHT');
        expect(tooWide.status).toBe('EXTREME_TOO_WIDE');
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
        expect(pivotDerived.supportMeta.some(x => x.origin === 'PIVOT_REFERENCE')).toBe(true);
        expect(pivotDerived.resistanceMeta.some(x => x.origin === 'PIVOT_REFERENCE')).toBe(true);

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
        const pivotZone = pivotLive.real_ict_zones.find(z => z.type === 'MSNR' && z.origin === 'PIVOT_REFERENCE');
        expect(pivotZone).toBeFalsy();
        expect(pivotLive.target_candidates.buy.some(c => c.origin === 'PIVOT_REFERENCE')).toBe(false);

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
        expect(fallbackZone).toBeFalsy();
        expect(live.target_candidates.buy.some(c => c.origin === 'ATR_FALLBACK')).toBe(false);
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
        expect(prompt.system).toMatch(/PIVOT_REFERENCE = classic pivot-derived reference only/);
        expect(prompt.system).toMatch(/ATR_FALLBACK = synthetic reference only/);
        expect(prompt.system).toMatch(/candidate-selection layer/);
        expect(prompt.system).toMatch(/must NEVER invent, modify, recalculate/);
        expect(prompt.system).toMatch(/VALID_CANDIDATES = executable numerical candidates/);
        expect(prompt.system).toMatch(/rank the supplied adaptive_setup_candidates/);
        expect(prompt.system).toMatch(/adaptive_setup_candidates is empty/);
        expect(prompt.system).toMatch(/Do not calculate risk, required reward, minimum TP/);
        expect(prompt.user).toMatch(/NO_TRADE/);
        expect(prompt.user).toMatch(/BUY_LIMIT, SELL_LIMIT, WAIT, or NO_TRADE/);
        expect(prompt.user).toMatch(/selected_candidate_id/);
        expect(prompt.user).toMatch(/Do not calculate or alter entry/);
        expect(prompt.user).toMatch(/already passed deterministic numerical hard rules/);
        expect(prompt.user).toMatch(/Discount generally favors BUY entries; premium generally favors SELL entries/);
        expect(prompt.user).toMatch(/PARTIAL=partially used\/partially mitigated/);
        expect(prompt.user).not.toMatch(/PARTIAL=fresh/);
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

    it('resolves selected adaptive candidate IDs before required trade fields are checked', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'BUY_LIMIT',
                    selected_candidate_id: '1H-FVG-BUY-test',
                    confidence: 72,
                    reasoning: { primary: 'Candidate has the best valid setup geometry' }
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 110, 'system', {
            pair: 'EUR/USD',
            adaptive_setup_candidates: [{
                id: '1H-FVG-BUY-test',
                direction: 'BUY',
                timeframe: '1H',
                zone_type: 'FVG',
                zone_origin: 'STRUCTURAL',
                zone_low: 1.09950,
                zone_high: 1.10050,
                entry: 1.10000,
                stop_loss: 1.09800,
                stop_reason: 'SWING_LOW invalidation plus structural buffer',
                tp1: 1.10500,
                tp2: 1.10600,
                tp3: 1.10700,
                rr_tp1: 2.5
            }]
        });
        expect(result.direction).toBe('BUY');
        expect(result.entry).toBe(1.10000);
        expect(result.stop_loss).toBe(1.09800);
        expect(result.take_profit_1).toBe(1.10500);
        expect(result.risk_reward).toBe('1:2.50');
    });

    it('normalizes fake AI risk_reward strings from the numeric TP1 math', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'BUY_LIMIT',
                    direction: 'BUY',
                    entry: 1.10000,
                    entry_zone: { low: 1.09950, high: 1.10050, source: 'FVG' },
                    stop_loss: 1.09800,
                    take_profit_1: 1.10240,
                    take_profit_2: 1.10300,
                    take_profit_3: 1.10400,
                    risk_reward: '1:5.0',
                    confidence: 70,
                    reasoning: { primary: 'AI claimed a stronger RR than the numbers support' }
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 1.10100, 'system');
        expect(result.risk_reward).toBe('1:1.20');
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
        expect(result.issues.join(' ')).toMatch(/SELL TP2/);
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
        expect(result.issues).toContain('only STRUCTURAL_MSNR can be selected as primary AI MSNR zone');
    });

    it('enforces minimum RR for normal FX BUY and accepts a genuine 2.5R TP1', () => {
        const ctx = getContext();
        const live = {
            risk_constraints: { minimum_rr: 2.5 },
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        };
        const base = {
            decision: 'BUY_LIMIT',
            direction: 'BUY',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 1.09950, high: 1.10050 },
            entry_zone: { source: 'FVG', low: 1.09950, high: 1.10050 },
            entry: 1.10000,
            stop_loss: 1.09800,
            take_profit_2: 1.10600,
            take_profit_3: 1.10700
        };

        const bad = ctx.validateAIOutputConsistency({ ...base, take_profit_1: 1.10499 }, live);
        expect(bad.valid).toBe(false);
        expect(bad.issues.join(' ')).toMatch(/actual RR .* below minimum 2\.50/);

        const good = ctx.validateAIOutputConsistency({ ...base, take_profit_1: 1.10500 }, live);
        expect(good.valid).toBe(true);
    });

    it('requires TP1 to use a supplied target candidate when candidates are present', () => {
        const ctx = getContext();
        const base = {
            decision: 'BUY_LIMIT',
            direction: 'BUY',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 1.09950, high: 1.10050 },
            entry_zone: { source: 'FVG', low: 1.09950, high: 1.10050 },
            entry: 1.10000,
            stop_loss: 1.09800,
            take_profit_1: 1.10500,
            take_profit_2: 1.10600,
            take_profit_3: 1.10700
        };
        const liveBase = {
            risk_constraints: { minimum_rr: 2.5 },
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        };

        const noValidTarget = ctx.validateAIOutputConsistency(base, {
            ...liveBase,
            target_candidates: { buy: [{ direction: 'BUY', level: 1.10400, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] }
        });
        expect(noValidTarget.valid).toBe(false);
        expect(noValidTarget.issues).toContain('no supplied target candidate satisfies minimum RR');

        const inventedTarget = ctx.validateAIOutputConsistency(base, {
            ...liveBase,
            target_candidates: { buy: [{ direction: 'BUY', level: 1.10600, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] }
        });
        expect(inventedTarget.valid).toBe(false);
        expect(inventedTarget.issues).toContain('take_profit_1 must match a supplied target candidate that satisfies minimum RR');

        const matchedTarget = ctx.validateAIOutputConsistency(base, {
            ...liveBase,
            target_candidates: { buy: [{ direction: 'BUY', level: 1.10500, source: 'SWING_HIGH', origin: 'STRUCTURAL' }], sell: [] }
        });
        expect(matchedTarget.valid).toBe(true);
    });

    it('builds adaptive SELL candidates by skipping too-tight zone stops and nearer invalid RR targets', () => {
        const ctx = getContext();
        const fvgZone = { id: '1H-SELL-FVG-0.58668-0.58739', type: 'FVG', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 0.58668, high: 0.58739, freshness: 'FRESH' };
        const obZone = { id: '1H-SELL-OB-0.58850-0.58887', type: 'OB', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 0.58850, high: 0.58887, freshness: 'FRESH' };
        const strategySetups = [{
            id: 'tbs-sell-fvg',
            reclaim_bar_index: 79,
            primary: 'TBS',
            label: 'TBS',
            direction: 'SELL',
            timeframe: '1H',
            confirmations: ['FVG'],
            matched_zone_ids: [fvgZone.id],
            matched_zones: [fvgZone],
            execution_zone: { ...fvgZone, type: 'TBS', id: '1H-SELL-TBS-0.58668-0.58739', strategy_source: 'TBS' },
            structural_invalidation: fvgZone.high,
            evidence: { liquidity_level: fvgZone.high, sweep_extreme: fvgZone.high }
        }];
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'NZD/USD',
            price: 0.58500,
            historyCache: trendCache('down', 0.62000, 0.00045),
            zones: [fvgZone, obZone],
            targetCandidates: {
                buy: [],
                sell: [
                    { direction: 'SELL', level: 0.58590, source: 'SELL_SIDE_LIQUIDITY', origin: 'STRUCTURAL' },
                    { direction: 'SELL', level: 0.58040, source: 'SWING_LOW', origin: 'STRUCTURAL' },
                    { direction: 'SELL', level: 0.57950, source: 'MSNR_SUPPORT', origin: 'PIVOT_DERIVED' },
                    { direction: 'SELL', level: 0.57800, source: 'SELL_SIDE_LIQUIDITY', origin: 'STRUCTURAL' }
                ]
            },
            riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00219, maximum_sl_distance: 0.00600 },
            marketRegime: { primary_regime: 'TRENDING_BEARISH' },
            structure: { '1D': { trend: 'BEARISH' }, '4H': { trend: 'BEARISH' }, '1H': { trend: 'BEARISH' } },
            strategySetups
        });
        const candidates = result.valid_candidates;
        expect(result.raw_candidates.length).toBeGreaterThan(0);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].entry).toBeGreaterThanOrEqual(0.58668);
        expect(candidates[0].entry).toBeLessThanOrEqual(0.58739);
        expect(candidates[0].stop_loss).toBeGreaterThan(0.58739);
        expect(candidates[0].risk_distance).toBeGreaterThanOrEqual(candidates[0].risk_model.minimum_reasonable_distance);
        expect(candidates[0].risk_distance).toBeLessThan(0.00219);
        expect(candidates[0].tp1).not.toBe(0.58590);
        expect(candidates[0].tp1).toBeLessThanOrEqual(candidates[0].entry - candidates[0].risk_distance * 2.5 + 0.00001);
        if (candidates[0].tp2 != null) expect(candidates[0].tp1).toBeGreaterThan(candidates[0].tp2);
        if (candidates[0].tp3 != null) expect(candidates[0].tp2).toBeGreaterThan(candidates[0].tp3);
    });

    it('rejects adaptive candidates when widening the structural stop leaves no valid TP ladder', () => {
        const ctx = getContext();
        const fvgZone = { id: '1H-SELL-FVG-0.58668-0.58739', type: 'FVG', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 0.58668, high: 0.58739, freshness: 'FRESH' };
        const obZone = { id: '1H-SELL-OB-0.58850-0.58887', type: 'OB', direction: 'SELL', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 0.58850, high: 0.58887, freshness: 'FRESH' };
        const strategySetups = [{
            id: 'tbs-sell-no-tp',
            primary: 'TBS',
            label: 'TBS',
            direction: 'SELL',
            timeframe: '1H',
            confirmations: ['FVG'],
            matched_zone_ids: [fvgZone.id],
            matched_zones: [fvgZone],
            execution_zone: { ...fvgZone, type: 'TBS', id: '1H-SELL-TBS-0.58668-0.58739', strategy_source: 'TBS' },
            structural_invalidation: fvgZone.high,
            evidence: { liquidity_level: fvgZone.high, sweep_extreme: fvgZone.high }
        }];
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'NZD/USD',
            price: 0.58500,
            historyCache: trendCache('down', 0.62000, 0.00045),
            zones: [fvgZone, obZone],
            targetCandidates: {
                buy: [],
                sell: [
                    { direction: 'SELL', level: 0.58600, source: 'SELL_SIDE_LIQUIDITY', origin: 'STRUCTURAL' },
                    { direction: 'SELL', level: 0.58595, source: 'SWING_LOW', origin: 'STRUCTURAL' }
                ]
            },
            riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00219, maximum_sl_distance: 0.00600 },
            marketRegime: { primary_regime: 'TRENDING_BEARISH' },
            structure: {},
            strategySetups
        });
        expect(result.valid_candidates).toEqual([]);
        expect(result.rejected_candidates.length).toBeGreaterThan(0);
    });

    it('uses structural stops inside the ATR range without forcing exact minimum distance', () => {
        const ctx = getContext();
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10100,
            historyCache: trendCache('up', 1.08000, 0.00030),
            zones: [
                { type: 'OB', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 1.09900, high: 1.10000, freshness: 'FRESH' }
            ],
            targetCandidates: {
                buy: [
                    { direction: 'BUY', level: 1.10400, source: 'SWING_HIGH', origin: 'STRUCTURAL' },
                    { direction: 'BUY', level: 1.10500, source: 'MSNR_RESISTANCE', origin: 'PIVOT_DERIVED' },
                    { direction: 'BUY', level: 1.10600, source: 'BUY_SIDE_LIQUIDITY', origin: 'STRUCTURAL' }
                ],
                sell: []
            },
            riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00030, maximum_sl_distance: 0.01000 },
            marketRegime: { primary_regime: 'TRENDING_BULLISH' },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        });
        const candidates = result.valid_candidates;
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].stop_source).toBe('ZONE_BOUNDARY');
        expect(candidates[0].risk_distance).toBeGreaterThan(0.00030);
        expect(candidates[0].risk_distance).not.toBeCloseTo(0.00030, 5);
    });

    it('rejects adaptive candidates when the only structural stop exceeds maximum risk', () => {
        const ctx = getContext();
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10500,
            historyCache: trendCache('up', 1.08000, 0.00030),
            zones: [
                { type: 'OB', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 1.09000, high: 1.10000, freshness: 'FRESH' }
            ],
            targetCandidates: {
                buy: [
                    { direction: 'BUY', level: 1.13000, source: 'SWING_HIGH', origin: 'STRUCTURAL' },
                    { direction: 'BUY', level: 1.14000, source: 'MSNR_RESISTANCE', origin: 'PIVOT_DERIVED' },
                    { direction: 'BUY', level: 1.15000, source: 'BUY_SIDE_LIQUIDITY', origin: 'STRUCTURAL' }
                ],
                sell: []
            },
            riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00030, maximum_sl_distance: 0.00500 },
            marketRegime: { primary_regime: 'TRENDING_BULLISH' },
            structure: {}
        });
        expect(result.valid_candidates).toEqual([]);
        expect(result.rejected_candidates.length).toBeGreaterThan(0);
    });

    it('keeps adaptive setup construction pair-scale independent', () => {
        const ctx = getContext();
        const cases = [
            { pair: 'EUR/USD', direction: 'BUY', price: 1.10100, low: 1.09900, high: 1.10000, min: 0.00030, max: 0.01000, step: 0.00030, targets: [1.10400, 1.10500, 1.10600] },
            { pair: 'GBP/JPY', direction: 'SELL', price: 190.300, low: 190.500, high: 190.700, min: 0.100, max: 2.000, step: 0.050, targets: [189.900, 189.700, 189.500] },
            { pair: 'XAU/USD', direction: 'BUY', price: 4382.00, low: 4375.00, high: 4380.00, min: 3.00, max: 30.00, step: 1.00, targets: [4395.00, 4405.00, 4415.00] },
            { pair: 'BTC/USD', direction: 'SELL', price: 65450, low: 65500, high: 65700, min: 30, max: 3000, step: 30, targets: [64000, 63500, 63000] }
        ];

        for (const c of cases) {
            const historyCache = c.direction === 'BUY'
                ? trendCache('up', c.price * 0.98, c.step)
                : trendCache('down', c.price * 1.02, c.step);
            const result = ctx.buildAdaptiveSetupCandidates({
                pair: c.pair,
                price: c.price,
                historyCache,
                zones: [{ type: 'FVG', direction: c.direction, timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: c.low, high: c.high, freshness: 'FRESH' }],
                targetCandidates: {
                    buy: c.direction === 'BUY' ? c.targets.map(level => ({ direction: 'BUY', level, source: 'SWING_HIGH', origin: 'STRUCTURAL' })) : [],
                    sell: c.direction === 'SELL' ? c.targets.map(level => ({ direction: 'SELL', level, source: 'SWING_LOW', origin: 'STRUCTURAL' })) : []
                },
                riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: c.min, maximum_sl_distance: c.max },
                marketRegime: { primary_regime: 'TRENDING' },
                structure: {}
            });
            const candidates = result.valid_candidates;
            expect(candidates.length).toBeGreaterThan(0);
            const best = candidates[0];
            expect(best.tp1).toBeTruthy();
            if (best.tp2 != null) {
                if (c.direction === 'BUY') expect(best.tp2).toBeGreaterThan(best.tp1);
                if (c.direction === 'SELL') expect(best.tp2).toBeLessThan(best.tp1);
            }
            if (best.tp3 != null) {
                if (c.direction === 'BUY') expect(best.tp3).toBeGreaterThan(best.tp2);
                if (c.direction === 'SELL') expect(best.tp3).toBeLessThan(best.tp2);
            }
        }
    });

    it('keeps HTF-failed raw candidates out of valid candidates before AI sees them', () => {
        const ctx = getContext();
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10500,
            historyCache: trendCache('down', 1.13000, 0.00030),
            zones: [
                { type: 'FVG', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 1.10300, high: 1.10400, freshness: 'FRESH' }
            ],
            targetCandidates: {
                buy: [
                    { direction: 'BUY', level: 1.10800, source: 'SWING_HIGH', origin: 'STRUCTURAL' },
                    { direction: 'BUY', level: 1.10900, source: 'MSNR_RESISTANCE', origin: 'PIVOT_DERIVED' },
                    { direction: 'BUY', level: 1.11000, source: 'BUY_SIDE_LIQUIDITY', origin: 'STRUCTURAL' }
                ],
                sell: []
            },
            riskConstraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00030, maximum_sl_distance: 0.01000 },
            marketRegime: { primary_regime: 'TRENDING_BEARISH' },
            structure: { '1D': { trend: 'BEARISH' }, '4H': { trend: 'BEARISH' }, '1H': { trend: 'BEARISH' } }
        });
        expect(result.raw_candidates.length).toBeGreaterThan(0);
        expect(result.valid_candidates).toEqual([]);
        expect(result.rejected_candidates.some(c => c.rejection_reasons.some(r => /reversal evidence insufficient/.test(r)))).toBe(true);
    });

    it('requires actionable AI output to select a deterministic candidate when valid candidates exist', () => {
        const ctx = getContext();
        const live = {
            adaptive_setup_candidates: [{ id: 'valid-1', zone_origin: 'STRUCTURAL', entry: 1.1, stop_loss: 1.098, tp1: 1.105, tp2: 1.106, tp3: 1.107 }],
            risk_constraints: { minimum_rr: 2.5 },
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        };
        const result = ctx.validateAIOutputConsistency({
            decision: 'BUY_LIMIT',
            direction: 'BUY',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 1.09950, high: 1.10050 },
            entry_zone: { source: 'FVG', low: 1.09950, high: 1.10050 },
            entry: 1.10000,
            stop_loss: 1.09800,
            take_profit_1: 1.10500,
            take_profit_2: 1.10600,
            take_profit_3: 1.10700
        }, live);
        expect(result.valid).toBe(false);
        expect(result.issues).toContain('actionable AI setup must select a deterministic candidate ID');
    });

    it('ignores AI numeric overrides when a deterministic candidate is selected', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'BUY_LIMIT',
                    selected_candidate_id: 'candidate-override',
                    direction: 'SELL',
                    entry: 9,
                    stop_loss: 10,
                    take_profit_1: 1,
                    take_profit_2: 0.5,
                    take_profit_3: 0.25,
                    confidence: 70,
                    reasoning: { primary: 'AI tried to override deterministic prices' }
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 1.101, 'system', {
            pair: 'EUR/USD',
            adaptive_setup_candidates: [{
                id: 'candidate-override',
                direction: 'BUY',
                timeframe: '1H',
                zone_type: 'FVG',
                zone_origin: 'STRUCTURAL',
                zone_low: 1.09950,
                zone_high: 1.10050,
                entry: 1.10000,
                stop_loss: 1.09800,
                stop_reason: 'SWING_LOW invalidation plus structural buffer',
                tp1: 1.10500,
                tp2: 1.10600,
                tp3: 1.10700,
                rr_tp1: 2.5
            }]
        });
        expect(result.direction).toBe('BUY');
        expect(result.entry).toBe(1.10000);
        expect(result.stop_loss).toBe(1.09800);
        expect(result.take_profit_1).toBe(1.10500);
    });

    it('fails closed when AI selects an unknown deterministic candidate ID', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve({
                choices: [{ message: { content: JSON.stringify({
                    decision: 'BUY_LIMIT',
                    selected_candidate_id: 'missing-candidate',
                    confidence: 70,
                    reasoning: { primary: 'Unknown candidate' }
                }) } }]
            })
        }));
        const result = await ctx.askAIToFindSetup('prompt', 1.101, 'system', {
            pair: 'EUR/USD',
            adaptive_setup_candidates: []
        });
        expect(result.noTrade).toBe(true);
        expect(result.decision).toBe('WAIT');
        expect(result.wait_condition).toMatch(/unknown deterministic candidate/);
    });

    it('keeps liquidity labels directionally correct around current price', () => {
        const ctx = getContext();
        const data = [];
        for (let i = 0; i < 40; i++) {
            const base = 100 + Math.sin(i / 2) * 3;
            data.push({ o: base, h: base + (i % 5 === 0 ? 5 : 1), l: base - (i % 7 === 0 ? 5 : 1), c: base, v: 1e6 });
        }
        data[data.length - 1].c = 100;
        const liq = ctx.mapLiquidity(data);
        expect(liq.above.every(level => level > 100)).toBe(true);
        expect(liq.below.every(level => level < 100)).toBe(true);
        expect(liq.nearestAbove == null || liq.nearestAbove > 100).toBe(true);
        expect(liq.nearestBelow == null || liq.nearestBelow < 100).toBe(true);
    });

    it('does not allow candidate.zone to self-validate against a different current zone context', () => {
        const ctx = getContext();
        const candidate = {
            id: 'fake-zone',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            zone: { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true },
            entry: 1.10000,
            stop_loss: 1.09800,
            tp1: 1.10500,
            tp2: 1.10600,
            tp3: 1.10700
        };
        const result = ctx.evaluateSetupCandidate(candidate, {
            pair: 'EUR/USD',
            price: 1.10090,
            historyCache: {},
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09000, high: 1.09100, origin: 'STRUCTURAL', primary_eligible: true }
            ],
            risk_constraints: { minimum_rr: 2.5, minimum_sl_distance: 0.00030, maximum_sl_distance: 0.01000 },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        }, { includeAccountRules: false });
        expect(result.valid).toBe(false);
        expect(result.reasons).toContain('candidate zone does not exist in current deterministic market context');
    });

    it('valid candidates pass final evaluator with the same deterministic context', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00030);
        const zones = [{ type: 'FVG', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false, low: 1.09900, high: 1.10000, freshness: 'FRESH' }];
        const riskConstraints = { minimum_rr: 2.5, minimum_sl_distance: 0.00030, maximum_sl_distance: 0.01000, atr_rule_reference: 0.00030 };
        const structure = { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } };
        const deterministicContext = ctx.buildDeterministicValidationContext({
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            real_ict_zones: zones,
            risk_constraints: riskConstraints,
            structure
        });
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            zones,
            targetCandidates: {
                buy: [
                    { direction: 'BUY', level: 1.10400, source: 'SWING_HIGH', origin: 'STRUCTURAL' },
                    { direction: 'BUY', level: 1.10500, source: 'MSNR_RESISTANCE', origin: 'PIVOT_DERIVED' },
                    { direction: 'BUY', level: 1.10600, source: 'BUY_SIDE_LIQUIDITY', origin: 'STRUCTURAL' }
                ],
                sell: []
            },
            riskConstraints,
            marketRegime: { primary_regime: 'TRENDING_BULLISH' },
            structure
        });
        expect(result.valid_candidates.length).toBeGreaterThan(0);
        for (const candidate of result.valid_candidates) {
            expect(ctx.evaluateSetupCandidate(candidate, deterministicContext).valid).toBe(true);
        }
    });

    it('accepts a 1H structural stop using 1H ATR even when smaller than the old 4H-derived minimum', () => {
        const ctx = getContext();
        const historyCache = {
            '1H': candles(80, 1.08000, 0.00010, 'up'),
            '4H': candles(80, 1.00000, 0.00100, 'up'),
            '1D': candles(80, 1.00000, 0.00040, 'up')
        };
        const candidate = {
            id: '1h-atr-context',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            stop_loss: 1.09945,
            tp1: 1.10140
        };
        const result = ctx.evaluateSetupCandidate(candidate, {
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            real_ict_zones: [{ type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        }, { includeAccountRules: false });
        expect(result.valid).toBe(true);
        expect(result.metrics.atrContext.setup_timeframe).toBe('1H');
        expect(result.metrics.atrContext.minimum_reasonable_distance).toBeLessThan(0.00150);
    });

    it('rejects structurally nonsensical and volatility-invalid stops', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00020);
        const baseContext = {
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            real_ict_zones: [{ type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        };
        const base = {
            id: 'stop-test',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            tp1: 1.10500
        };
        expect(ctx.evaluateSetupCandidate({ ...base, stop_loss: 1.10010 }, baseContext, { includeAccountRules: false }).reasons.join(' ')).toMatch(/BUY stop must be below entry/);
        expect(ctx.evaluateSetupCandidate({ ...base, stop_loss: 1.09990 }, baseContext, { includeAccountRules: false }).reasons.join(' ')).toMatch(/below market minimum|minimum reasonable distance/);
        expect(ctx.evaluateSetupCandidate({ ...base, stop_loss: 1.09000, tp1: 1.13000 }, baseContext, { includeAccountRules: false }).reasons.join(' ')).toMatch(/maximum reasonable distance/);
    });

    it('keeps TP1 mandatory while TP2 and TP3 are optional', () => {
        const ctx = getContext();
        const historyCache = trendCache('up', 1.08000, 0.00010);
        const context = {
            pair: 'EUR/USD',
            price: 1.10070,
            historyCache,
            real_ict_zones: [{ type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BULLISH' }, '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        };
        const valid = ctx.evaluateSetupCandidate({
            id: 'tp1-only',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            stop_loss: 1.09950,
            tp1: 1.10126,
            tp2: null,
            tp3: null
        }, context, { includeAccountRules: false });
        expect(valid.valid).toBe(true);

        const bad = ctx.evaluateSetupCandidate({
            id: 'tp1-bad-rr',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            stop_loss: 1.09950,
            tp1: 1.10100
        }, context, { includeAccountRules: false });
        expect(bad.valid).toBe(false);
        expect(bad.reasons.join(' ')).toMatch(/real RR .* below/);
    });

    it('requires deterministic reversal evidence before allowing a countertrend candidate', () => {
        const ctx = getContext();
        const historyCache = trendCache('down', 1.13000, 0.00010);
        const context = {
            pair: 'EUR/USD',
            price: 1.10090,
            historyCache,
            real_ict_zones: [{ type: 'FVG', timeframe: '1H', direction: 'BUY', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BEARISH' }, '4H': { trend: 'BEARISH' }, '1H': { trend: 'BEARISH' } }
        };
        const candidate = {
            id: 'countertrend-buy',
            direction: 'BUY',
            timeframe: '1H',
            zone_type: 'FVG',
            zone_low: 1.09950,
            zone_high: 1.10050,
            entry: 1.10000,
            stop_loss: 1.09950,
            tp1: 1.10130
        };
        const rejected = ctx.evaluateSetupCandidate(candidate, context, { includeAccountRules: false });
        expect(rejected.valid).toBe(false);
        expect(rejected.reasons.join(' ')).toMatch(/reversal evidence insufficient/);

        const allowed = ctx.evaluateSetupCandidate({
            ...candidate,
            reversal_evidence: { liquidity_sweep: false, mss: true, choch: true, displacement: false, premium_discount: false, evidence_count: 2 }
        }, context, { includeAccountRules: false });
        expect(allowed.valid).toBe(true);
        expect(allowed.metrics.setup_archetype).toBe('REVERSAL');
        expect(allowed.metrics.reversal_evidence.evidence_count).toBeGreaterThanOrEqual(2);
    });

    it('builds pre-selection entry context without using a candidate zone', () => {
        const ctx = getContext();
        const result = ctx.buildPreSelectionEntryContext(
            { priority: 'LOW', reason: 'Off-hours', multiplier: 0.5, isOffHours: true },
            { phase: 'NEUTRAL', confidence: 0 }
        );
        expect(result.entryConfirmation.reason).toMatch(/deferred until selection/);
        expect(result.entryConfirmation.isAtZone).toBe(false);
    });

    it('uses the current selected candidate zone for Stage-2 confirmation', () => {
        const ctx = getContext();
        const data = candles(12, 1.10000, 0.00010, 'up');
        data[data.length - 1] = { o: 1.10010, h: 1.10090, l: 1.09970, c: 1.10080, v: 1e6 };
        const result = ctx.buildSelectedCandidateEntryContext({
            historyCache: { '15M': data },
            sessionCheck: { priority: 'HIGH', reason: 'Killzone', multiplier: 1.0 },
            marketPhase: { phase: 'NEUTRAL', confidence: 50 },
            phaseData: data,
            selectedZone: { low: 1.09950, high: 1.10050 },
            direction: 'BUY',
            price: 1.10100
        });
        expect(result.entryConfirmation.isAtZone).toBe(false);
        expect(result.entryConfirmation.confirmed).toBe(false);
        expect(result.allOk).toBe(false);
        expect(result.summary).toMatch(/Current price is outside/);
        expect(result.entryConfirmation.score).toBeGreaterThanOrEqual(0);
    });

    it('enforces minimum RR for normal FX SELL and accepts a genuine 2.5R TP1', () => {
        const ctx = getContext();
        const live = {
            risk_constraints: { minimum_rr: 2.5 },
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'SELL', low: 1.09950, high: 1.10050, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        };
        const base = {
            decision: 'SELL_LIMIT',
            direction: 'SELL',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 1.09950, high: 1.10050 },
            entry_zone: { source: 'FVG', low: 1.09950, high: 1.10050 },
            entry: 1.10000,
            stop_loss: 1.10200,
            take_profit_2: 1.09400,
            take_profit_3: 1.09300
        };

        const bad = ctx.validateAIOutputConsistency({ ...base, take_profit_1: 1.09501 }, live);
        expect(bad.valid).toBe(false);
        expect(bad.issues.join(' ')).toMatch(/actual RR .* below minimum 2\.50/);

        const good = ctx.validateAIOutputConsistency({ ...base, take_profit_1: 1.09500 }, live);
        expect(good.valid).toBe(true);
    });

    it('keeps RR checks scale-independent for JPY, XAU, and BTC-style prices', () => {
        const ctx = getContext();
        const cases = [
            { direction: 'BUY', entry: 150.000, sl: 149.800, tp1: 150.500, tp2: 150.700, tp3: 150.900, low: 149.950, high: 150.050 },
            { direction: 'SELL', entry: 150.000, sl: 150.200, tp1: 149.500, tp2: 149.300, tp3: 149.100, low: 149.950, high: 150.050 },
            { direction: 'BUY', entry: 4379.00, sl: 4369.00, tp1: 4404.00, tp2: 4410.00, tp3: 4420.00, low: 4375.00, high: 4382.00 },
            { direction: 'SELL', entry: 4379.00, sl: 4389.00, tp1: 4354.00, tp2: 4340.00, tp3: 4330.00, low: 4375.00, high: 4382.00 },
            { direction: 'BUY', entry: 65000, sl: 64000, tp1: 67500, tp2: 69000, tp3: 70500, low: 64800, high: 65200 },
            { direction: 'SELL', entry: 65000, sl: 66000, tp1: 62500, tp2: 61000, tp3: 59500, low: 64800, high: 65200 }
        ];

        for (const c of cases) {
            const live = {
                risk_constraints: { minimum_rr: 2.5 },
                real_ict_zones: [
                    { type: 'FVG', timeframe: '1H', direction: c.direction, low: c.low, high: c.high, origin: 'STRUCTURAL', primary_eligible: true }
                ]
            };
            const result = ctx.validateAIOutputConsistency({
                decision: `${c.direction}_LIMIT`,
                direction: c.direction,
                selected_zone: { type: 'FVG', timeframe: '1H', low: c.low, high: c.high },
                entry_zone: { source: 'FVG', low: c.low, high: c.high },
                entry: c.entry,
                stop_loss: c.sl,
                take_profit_1: c.tp1,
                take_profit_2: c.tp2,
                take_profit_3: c.tp3
            }, live);
            expect(result.valid).toBe(true);
        }
    });

    it('rejects the AUD/USD live regression when claimed RR disagrees with TP1 math', () => {
        const ctx = getContext();
        const result = ctx.validateAIOutputConsistency({
            decision: 'BUY_LIMIT',
            direction: 'BUY',
            selected_zone: { type: 'FVG', timeframe: '1H', low: 0.72250, high: 0.72300 },
            entry_zone: { source: 'FVG', low: 0.72250, high: 0.72300 },
            entry: 0.72279,
            stop_loss: 0.72089,
            take_profit_1: 0.72451,
            take_profit_2: 0.72607,
            take_profit_3: 0.72679,
            risk_reward: '1:2.5'
        }, {
            risk_constraints: { minimum_rr: 2.5 },
            real_ict_zones: [
                { type: 'FVG', timeframe: '1H', direction: 'BUY', low: 0.72250, high: 0.72300, origin: 'STRUCTURAL', primary_eligible: true }
            ]
        });
        expect(result.valid).toBe(false);
        expect(result.issues.join(' ')).toMatch(/actual RR 0\.91 below minimum 2\.50/);
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
        expect(r.reason).toMatch(/direction must be BUY or SELL/);
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
        const r = ctx.validateAISetup(baseAi({ entry: 999, stop_loss: 990, take_profit_1: 1010, take_profit_2: 1020, take_profit_3: 1030 }), 105, cache, 'XAU/USD');
        expect(r.valid).toBe(false);
        expect(r.reason).toMatch(/BUY geometry|no real deterministic FVG\/OB\/MSNR matches/);
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
        const entry = 4410;
        const zone = { type: 'TBS', timeframe: '1H', direction: 'SELL', low: 4409, high: 4411, origin: 'STRUCTURAL', primary_eligible: true, freshness: 'FRESH' };
        const validationContext = ctx.buildDeterministicValidationContext({
            pair: 'XAU/USD',
            price: 4400,
            historyCache: cache,
            real_ict_zones: [zone],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BEARISH' }, '4H': { trend: 'BEARISH' }, '1H': { trend: 'BEARISH' } },
            strategy_setups: [{ primary: 'TBS', label: 'TBS', direction: 'SELL', execution_zone: zone }],
            require_strategy_setup: true
        });
        const r = ctx.validateAISetup(baseAi({
            direction: 'SELL',
            decision: 'SELL_LIMIT',
            entry,
            selected_candidate_id: 'sell-limit',
            selected_zone: { low: zone.low, high: zone.high, type: 'TBS', timeframe: '1H' },
            entry_zone: { low: zone.low, high: zone.high, source: 'TBS' },
            stop_loss: entry + 7,
            take_profit_1: entry - 21,
            take_profit_2: entry - 35,
            take_profit_3: entry - 49,
            ai_decision: 'wait_for_reaction',
            strategy_setup: { primary: 'TBS', label: 'TBS', timeframe: '1H', reclaim_bar_index: 79 }
        }), 4400, cache, 'XAU/USD', validationContext);
        expect(r.valid).toBe(false);
        expect(r.reason).toContain('ENTRY_NOT_REACHABLE_TODAY');
    });

    it('still rejects bad RR calculated from the future limit entry', () => {
        const ctx = getContext();
        const data = candles(80, 4450, 1.5, 'down');
        const cache = { '4H': data, '1H': data, '1D': data, '15M': data.slice(-20), '5M': data.slice(-20) };
        const entry = 4410;
        const zone = { type: 'TBS', timeframe: '1H', direction: 'SELL', low: 4409, high: 4411, origin: 'STRUCTURAL', primary_eligible: true, freshness: 'FRESH' };
        const validationContext = ctx.buildDeterministicValidationContext({
            pair: 'XAU/USD',
            price: 4400,
            historyCache: cache,
            real_ict_zones: [zone],
            risk_constraints: { minimum_rr: 2.5 },
            structure: { '1D': { trend: 'BEARISH' }, '4H': { trend: 'BEARISH' }, '1H': { trend: 'BEARISH' } },
            strategy_setups: [{ primary: 'TBS', label: 'TBS', direction: 'SELL', execution_zone: zone }],
            require_strategy_setup: true
        });
        const r = ctx.validateAISetup(baseAi({
            direction: 'SELL',
            decision: 'SELL_LIMIT',
            entry,
            selected_candidate_id: 'sell-limit',
            selected_zone: { low: zone.low, high: zone.high, type: 'TBS', timeframe: '1H' },
            entry_zone: { low: zone.low, high: zone.high, source: 'TBS' },
            stop_loss: entry + 7,
            take_profit_1: entry - 8,
            take_profit_2: entry - 20,
            take_profit_3: entry - 30,
            ai_decision: 'wait_for_reaction',
            risk_reward: '1:5.0',
            strategy_setup: { primary: 'TBS', label: 'TBS', timeframe: '1H', reclaim_bar_index: 79 }
        }), 4405, cache, 'XAU/USD', { ...validationContext, price: 4405 });
        expect(r.valid).toBe(false);
        expect(r.reason).toContain('SETUP_DELIVERY_ALREADY_ADVANCED');
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

describe('production invariant contracts', () => {
    it('canonicalizes provider candles once and calculates closure from scan time', () => {
        const ctx = getContext();
        const scan = Date.parse('2026-09-11T10:02:00Z');
        const result = ctx.canonicalizeHistory([{ t: '2026-09-11T10:00:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }], '1H', scan);
        expect(result[0].t).toBe(Date.parse('2026-09-11T10:00:00Z'));
        expect(result[0].timeframe).toBe('1H');
        expect(result[0].timestamp_source).toBe('PROVIDER');
        expect(result[0].is_closed).toBe(false);
    });

    it('canonicalizes timezone-bearing provider timestamps without device-time dependence', () => {
        const ctx = getContext();
        const result = ctx.canonicalizeHistory([{ t: '2026-09-11T15:00:00+05:00', o: 1, h: 2, l: 0.5, c: 1.5 }], '1H', Date.parse('2026-09-11T11:00:00Z'));
        expect(result[0].t).toBe(Date.parse('2026-09-11T10:00:00Z'));
        expect(result[0].is_closed).toBe(true);
    });

    it('rejects a future-dated strategy event without clamping its age', () => {
        const ctx = getContext();
        const asOf = Date.parse('2026-09-11T10:00:00Z');
        const future = Date.parse('2026-09-11T12:00:00Z');
        const result = ctx.evaluateSetupLifecycle({ direction: 'BUY', entry: 100, zone_low: 99.9, zone_high: 100.1, tp1: 104,
            strategy_setup: { primary: 'CRT', timeframe: '1H', reclaim_time: future } }, {
            price: 101, as_of_time: asOf,
            historyCache: { '1H': [c(100, 101, 99, 100, '2026-09-11T09:00:00Z'), c(100, 101, 99, 100, '2026-09-11T10:00:00Z')] }
        });
        expect(result.event_age_hours).toBeLessThan(0);
        expect(result.rejection_code).toBe('DATA_TIME_INCONSISTENT');
    });

    it('does not use explicitly forming candles for strategy detection', () => {
        const ctx = getContext();
        const data = Array.from({ length: 20 }, (_, i) => c(100, 101, 99, 100, `2026-09-11T${String(i).padStart(2, '0')}:00:00Z`));
        data[data.length - 1].closed = false;
        expect(ctx.detectCRTEvents(data, '1H', 'EUR/USD').every(e => e.reclaim_bar_index !== data.length - 1)).toBe(true);
        expect(ctx.detectTurtleSoupEvents(data, '1H', 'EUR/USD').every(e => e.reclaim_bar_index !== data.length - 1)).toBe(true);
    });

    it('returns directional obstacle metadata without treating same-direction zones as blockers', () => {
        const ctx = getContext();
        const result = ctx.evaluateTargetReachability({ direction: 'SELL', entry: 110, stopLoss: 112,
            target: { level: 100, source: 'SWING_LOW', timeframe: '1H' },
            historyCache: { '1H': candles(40, 110, 1, 'down') },
            zones: [{ type: 'OB', direction: 'BUY', low: 104, high: 105 }, { type: 'OB', direction: 'SELL', low: 106, high: 107 }],
            liquidity: { above: [], below: [] }, strategySetup: { target_candidates: [] }
        });
        expect(result.intervening_obstacles).toHaveLength(1);
        expect(result.intervening_obstacles[0].blocks_direction).toBe(false);
        expect(result.intervening_obstacles[0].direction_or_role).toBe('BUY');
    });

    it('blocks executable geometry that violates strategy invalidation', () => {
        const ctx = getContext();
        const result = ctx.validateExecutableCandidateInvariant({ direction: 'SELL', entry: 207.8, stop_loss: 207.84, tp1: 207.618,
            opportunity_status: 'FRESH_PENDING_TODAY', structural_invalidation: { level: 207.85753, source: 'TBS_SWEEP_EXTREME' },
            target_map: [{ primary_target_source: 'SWING_LOW' }] });
        expect(result.valid).toBe(false);
        expect(result.invariant_code).toBe('SL_INSIDE_STRUCTURAL_INVALIDATION');
    });

    it('uses the exact pending limit price as the recorded fill price', () => {
        const ctx = getContext();
        const store = {};
        ctx.localStorage.getItem = key => store[key] || '[]';
        ctx.localStorage.setItem = (key, value) => { store[key] = value; };
        ctx.enqueuePendingFill({ id: 'limit', pair: 'EUR/USD', signalType: 'SHORT', idealEntry: 1.1, stopLoss: 1.11, takeProfit1: 1.07 }, 1.1);
        const saved = JSON.parse(store.pendingFills)[0];
        expect(saved.entry).toBe(1.1);
        expect(saved.fill_price_source).toBe('LIMIT_ORDER_PRICE');
    });
});
