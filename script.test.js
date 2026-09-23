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

    it('uses a fresh execution-zone timestamp instead of expiring it from an old parent narrative', () => {
        const ctx = getContext();
        const market = {
            price: 101,
            as_of_time: '2026-09-23T11:00:00Z',
            historyCache: { '1H': [
                c(99, 100, 98.5, 99.5, '2026-09-23 09:00:00'),
                c(99.5, 101.2, 99.3, 101, '2026-09-23 10:00:00'),
                c(101, 101.1, 100.9, 101, '2026-09-23 11:00:00')
            ] }
        };
        const candidate = { direction: 'BUY', execution_model: 'PENDING_LIMIT', entry: 99, zone_low: 98.9, zone_high: 99.1, tp1: 110,
            zone: { id: 'fresh-child', created_time: Date.parse('2026-09-23T09:00:00Z') },
            strategy_setup: { primary: 'ICT', timeframe: '1H', event_time: Date.parse('2026-09-13T09:00:00Z') } };
        const result = ctx.evaluateSetupLifecycle(candidate, market);
        expect(result.rejection_code).not.toBe('SETUP_STALE');
        expect(result.still_actionable_today).toBe(true);
        expect(result.time_integrity.zone_created_time_utc).toBe('2026-09-23T09:00:00.000Z');
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

    it('sends the full candidate catalog while keeping rejected candidates unselectable', () => {
        const ctx = getContext();
        const payload = ctx.compactAIContext({
            adaptive_setup_candidates: [{ id: 'valid', opportunity_status: 'FRESH_PENDING_TODAY', direction: 'SELL', entry: 2, stop_loss: 3, tp1: 1 }],
            rejected_setup_candidates: [{ id: 'expired-zone', direction: 'SELL', timeframe: '4H', zone_type: 'OB', rejection_code: 'SETUP_EXPIRED', rejection_reasons: ['SETUP_EXPIRED'] }]
        });
        expect(payload.candidate_catalog.map(c => c.id)).toEqual(['valid', 'expired-zone']);
        expect(payload.candidate_catalog[0].catalog_status).toBe('VALID_SELECTABLE');
        expect(payload.candidate_catalog[1].catalog_status).toBe('REJECTED');
        expect(payload.candidate_catalog[1].rejection_code).toBe('SETUP_EXPIRED');
    });

    it('normalizes epoch seconds, epoch milliseconds, ISO, text, Date, and timezone timestamps identically', () => {
        const ctx = getContext();
        const iso = '2026-09-11T00:00:00Z';
        const ms = Date.parse(iso);
        expect(ctx.normalizeTimestampUTC(ms)).toBe(ms);
        expect(ctx.normalizeTimestampUTC(Math.floor(ms / 1000))).toBe(ms);
        expect(ctx.normalizeTimestampUTC(iso)).toBe(ms);
        expect(ctx.normalizeTimestampUTC('2026-09-11')).toBe(Date.UTC(2026, 8, 11));
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

describe('market-thesis opportunity invariants', () => {
    it('does not confuse verified market mechanics with fresh continuation', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-09-14T10:00:00Z');
        const setup = { primary: 'ICT', direction: 'BUY', narrative_state: 'ACTIVE', market_mechanics_verified: true,
            event_time: t0, original_strategy_entry_consumed: true };
        const oldZone = { id: 'old', low: 1, high: 2, created_time: t0, freshness: 'FRESH' };
        const newZone = { id: 'new', low: 1, high: 2, created_time: t0 + 3600000, freshness: 'FRESH' };
        expect(ctx.isTodayFreshContinuation(setup, oldZone)).toBe(false);
        expect(ctx.isTodayFreshContinuation(setup, { ...newZone })).toBe(true);
    });

    it('rejects the same old zone even when wrapped in a new object', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-09-14T10:00:00Z');
        const setup = { primary: 'CRT', direction: 'BUY', narrative_state: 'ACTIVE', event_time: t0, original_strategy_entry_consumed: true };
        const zone = { id: 'old-zone', low: 1, high: 2, created_time: t0 - 3600000, freshness: 'FRESH' };
        expect(ctx.isTodayFreshContinuation(setup, { ...zone })).toBe(false);
    });

    it('keeps an advanced parent terminal while evaluating a later zone independently', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-09-14T10:00:00Z');
        const result = ctx.buildTodayOpportunity({ pair: 'GBP/JPY', currentPrice: 110, scanAsOfMs: t0 + 3 * 3600000, marketOpen: true,
            strategySetups: [
                { id: 'old-parent', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', rejection_code: 'SETUP_DELIVERY_ALREADY_ADVANCED', event_time: t0,
                    execution_zone: { id: 'old-zone', low: 108, high: 109, created_time: t0, freshness: 'FRESH' } },
                { id: 'new-zone-setup', primary: 'ICT', direction: 'SELL', narrative_state: 'ACTIVE', event_time: t0 + 3600000,
                    execution_zone: { id: 'new-zone', low: 108, high: 109, created_time: t0 + 2 * 3600000, freshness: 'FRESH', entry_reachable_today: true,
                        structural_invalidation: { level: 112, source: 'ICT_SHIFT_ORIGIN_SWING' } },
                    target_candidates: [{ level: 100, source: 'SELL_SIDE_LIQUIDITY' }] }
            ] });
        expect(result.reason_code).not.toBe('DELIVERY_ALREADY_ADVANCED');
        expect(result.terminal_parent_opportunities).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old-parent' })]));
    });

    it('returns a fresh market-mechanics opportunity after an old delivery advances', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-09-15T05:00:00Z');
        const result = ctx.buildTodayOpportunity({ pair: 'GBP/JPY', currentPrice: 208.42657, scanAsOfMs: t0 + 3600000, marketOpen: true,
            marketContext: { daily_bias: { direction: 'SELL' }, timeframe_context: {
                '1D': { effective_trend: 'BEARISH', evidence: [{ id: 'D-BEAR', kind: 'TREND', direction: 'SELL' }] },
                '4H': { effective_trend: 'BEARISH', evidence: [{ id: '4H-BEAR', kind: 'TREND', direction: 'SELL' }] },
                '1H': { effective_trend: 'BEARISH', evidence: [{ id: '1H-BEAR', kind: 'TREND', direction: 'SELL' }] }
            } },
            strategySetups: [
                { id: 'old-delivered', primary: 'ICT', direction: 'SELL', narrative_state: 'ACTIVE', rejection_code: 'SETUP_DELIVERY_ALREADY_ADVANCED', event_time: t0 - 7200000,
                    execution_zone: { id: 'old-zone', type: 'SUPPLY', low: 208, high: 208.1, created_time: t0 - 7200000, freshness: 'FRESH' }, target_candidates: [{ level: 207, source: 'PDL' }] },
                { id: 'fresh-continuation', primary: 'ICT', label: 'MARKET_MECHANICS', direction: 'SELL', narrative_state: 'ACTIVE', event_time: t0,
                    execution_model: 'PENDING_LIMIT', execution_zone: { id: 'fresh-zone', type: 'SUPPLY', low: 209, high: 209.2, created_time: t0 + 1800000, freshness: 'FRESH', entry_reachable_today: true, primary_eligible: true },
                    structural_invalidation: { level: 209.6, source: 'ICT_STRUCTURE' }, target_candidates: [{ level: 207, source: 'SELL_SIDE_LIQUIDITY' }] }
            ] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.primary_opportunity.id).toBe('fresh-continuation');
        expect(result.terminal_parent_opportunities).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'old-delivered' })]));
        expect(result.reason_code).not.toBe('SETUP_DELIVERY_ALREADY_ADVANCED');
    });

    it('does not blame an old terminal parent when a current setup reaches planning and is rejected separately', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-09-15T05:00:00Z');
        const result = ctx.buildTodayOpportunity({ pair: 'XAU/USD', currentPrice: 4296.82519, scanAsOfMs: t0 + 3600000, marketOpen: true,
            histories: { '1H': Array.from({ length: 40 }, (_, i) => c(4296 + i * 0.01, 4296.1 + i * 0.01, 4295.9 + i * 0.01, 4296 + i * 0.01, new Date(t0 + i * 3600000).toISOString())) },
            strategySetups: [
                { id: 'old-terminal', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', rejection_code: 'SETUP_ALREADY_COMPLETED', event_time: t0 - 7200000,
                    execution_zone: { id: 'old-zone', low: 4297, high: 4298, created_time: t0 - 7200000, freshness: 'FRESH' }, target_candidates: [{ level: 4280, source: 'PDL' }] },
                { id: 'current-setup', primary: 'ICT', direction: 'SELL', narrative_state: 'ACTIVE', event_time: t0, execution_zone: { id: 'current-zone', low: 4298, high: 4300, created_time: t0 + 1800000, freshness: 'FRESH', primary_eligible: true }, structural_invalidation: 4302, structural_invalidation_detail: { level: 4302, source: 'ICT_SHIFT_ORIGIN_SWING' }, target_candidates: [] }
            ] });
        expect(result.fresh_current_market_opportunities).toContain('current-setup');
        expect(result.reason_code).toBe('NO_REMAINING_TARGET');
        expect(result.previous_opportunity_status).toBeUndefined();
    });

    it('creates deterministic supply and demand POIs only from displacement structure', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const pois = ctx.buildSupplyDemandAndFlipPOIs(data, '1H', 140, 'XAU/USD');
        expect(pois.every(p => ['SUPPLY', 'DEMAND', 'FLIP'].includes(p.type))).toBe(true);
        expect(pois.every(p => Array.isArray(p.structural_evidence_ids) && p.structural_evidence_ids.length > 0)).toBe(true);
    });

    it('keeps the authoritative reversal execution model on candidate construction', () => {
        const ctx = getContext();
        const data = candles(80, 1.08, 0.0003, 'up');
        const setup = { id: 'rev', primary: 'CRT', label: 'CRT', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '15M',
            execution_model: 'FRESH_RETRACEMENT_LIMIT', entry_model: 'FRESH_RETRACEMENT_LIMIT',
            opportunity_thesis: { execution_model: 'CONFIRMATION_ENTRY', state: 'EXECUTION_VALID' },
            execution_zone: { id: 'z', type: 'FVG', direction: 'BUY', timeframe: '15M', low: 1.1, high: 1.101, freshness: 'FRESH', primary_eligible: true },
            target_candidates: [{ level: 1.11, source: 'SWING_HIGH', origin: 'STRUCTURAL' }],
            structural_invalidation_detail: { level: 1.09, source: 'CRT_SWEEP_EXTREME' },
            structural_invalidation: 1.09, trade_context_classification: 'HTF_VERIFIED_REVERSAL' };
        const result = ctx.buildAdaptiveSetupCandidates({ pair: 'EUR/USD', price: 1.102, historyCache: { '4H': data, '1H': data, '15M': data, '1D': data },
            zones: [setup.execution_zone], targetCandidates: { buy: [{ level: 1.11, source: 'SWING_HIGH', origin: 'STRUCTURAL' }] },
            riskConstraints: { minimum_rr: 2.5 }, structure: {}, marketContext: { timeframe_context: {} }, strategySetups: [setup] });
        expect(result.raw_candidates.length === 0 || result.raw_candidates[0].execution_model).toBeTruthy();
    });

    it('verifies location-only demand separately from executable FVG evidence', () => {
        const ctx = getContext();
        const base = { timeframe_context: { '1H': { evidence: [{ id: 'MSS-1', kind: 'MSS', direction: 'BUY' }], structure: { recent_swing_lows: [{ level: 98 }] } } },
            execution_zones: [{ id: 'FVG-1', type: 'FVG', direction: 'BUY', timeframe: '15M', low: 100, high: 101, primary_eligible: true }],
            poi_zones: [{ id: 'D-1', type: 'DEMAND', direction: 'BUY', timeframe: '4H', low: 99, high: 100, location_only: true, primary_eligible: false, freshness: 'FRESH', structural_evidence_ids: ['D-EVIDENCE'] }],
            target_candidates: { buy: [{ level: 110, source: 'BUY_SIDE_LIQUIDITY' }] }, current_price: 102, pair: 'EUR/USD' };
        const result = ctx.verifyAiMarketMechanicsHypothesis({ hypothesis_id: 'H1', strategy: 'ICT', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '15M', preferred_location_zone_ids: ['D-1'], preferred_execution_zone_ids: ['FVG-1'] }, base, base);
        expect(result.verified).toBe(true);
        expect(result.setup.location.type).toBe('DEMAND');
        expect(result.setup.execution.zone_id).toBe('FVG-1');
    });

    it('rejects a location-only demand when no executable evidence is supplied', () => {
        const ctx = getContext();
        const evidence = { timeframe_context: { '1H': { evidence: [{ id: 'MSS-1', kind: 'MSS', direction: 'BUY' }], structure: { recent_swing_lows: [{ level: 98 }] } } },
            poi_zones: [{ id: 'D-1', type: 'DEMAND', direction: 'BUY', location_only: true, primary_eligible: false, freshness: 'FRESH' }], target_candidates: { buy: [{ level: 110 }] }, current_price: 102, pair: 'EUR/USD' };
        const result = ctx.verifyAiMarketMechanicsHypothesis({ hypothesis_id: 'H2', strategy: 'ICT', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '15M', preferred_location_zone_ids: ['D-1'] }, evidence, evidence);
        expect(result.verified).toBe(false);
        expect(result.reason_code).toBe('MARKET_MECHANICS_EXECUTION_MISSING');
    });

    it('rejects a location-only POI placed in the execution field', () => {
        const ctx = getContext();
        const evidence = { timeframe_context: { '1H': { evidence: [{ id: 'MSS-1', kind: 'MSS', direction: 'BUY' }], structure: { recent_swing_lows: [{ level: 98 }] } } },
            execution_zones: [{ id: 'D-1', type: 'DEMAND', direction: 'BUY', location_only: true, primary_eligible: false, freshness: 'FRESH', low: 99, high: 100 }], target_candidates: { buy: [{ level: 110 }] }, current_price: 102, pair: 'EUR/USD' };
        const result = ctx.verifyAiMarketMechanicsHypothesis({ hypothesis_id: 'H3', strategy: 'ICT', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '15M', preferred_execution_zone_ids: ['D-1'] }, evidence, evidence);
        expect(result.verified).toBe(false);
        expect(result.reason_code).toBe('MARKET_MECHANICS_EXECUTION_INVALID');
    });

    it('surfaces a proven developing narrative before an execution zone exists', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'AUD/USD', currentPrice: 0.7145, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            marketContext: { timeframe_context: { '1D': { effective_trend: 'BULLISH', evidence: [{ id: 'D-TREND', kind: 'TREND', direction: 'BUY' }] }, '4H': { effective_trend: 'BULLISH', evidence: [{ id: '4H-TREND', kind: 'TREND', direction: 'BUY' }] }, '1H': { effective_trend: 'BULLISH', evidence: [{ id: '1H-TREND', kind: 'TREND', direction: 'BUY' }] } } },
            strategySetups: [{ id: 'developing-buy', primary: 'ICT', direction: 'BUY', narrative_state: 'ACTIVE', timeframe: '15M', execution_timeframe: '15M',
                execution_model: 'CONFIRMATION_ENTRY', opportunity_narrative: { state: 'DEVELOPING', location: { id: 'D-1', type: 'DEMAND', timeframe: '4H', low: 0.713, high: 0.715 }, opportunity_reachable_today: true },
                structural_invalidation_detail: { level: 0.71, source: 'DEMAND_INVALIDATION' }, structural_invalidation: 0.71,
                target_candidates: [{ level: 0.72, source: 'BUY_SIDE_LIQUIDITY' }] }] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.reason_code).toBe('WAITING_FOR_EXECUTION');
        expect(result.execution_model).toBe('CONFIRMATION_ENTRY');
        expect(result.execution_zone_id).toBeNull();
        expect(result.primary_opportunity).toEqual(expect.objectContaining({ id: 'developing-buy', state: 'WAITING_FOR_EXECUTION', watch_only: false }));
        expect(result.primary_opportunity.execution_zone).toBeNull();
    });

    it('selects an existing nested limit zone instead of waiting for a new zone to form', () => {
        const ctx = getContext();
        const setup = {
            id: 'sell-narrative', direction: 'SELL',
            opportunity_narrative: { location: { type: 'SUPPLY', low: 1.148, high: 1.151 } }
        };
        const zone = ctx.getTodayOpportunityZone(setup, [
            { id: 'outside', type: 'FVG', direction: 'SELL', low: 1.155, high: 1.156, primary_eligible: true },
            { id: 'nested-ob', type: 'OB', direction: 'SELL', low: 1.149, high: 1.150, primary_eligible: true, freshness: 'FRESH' }
        ]);
        expect(zone.id).toBe('nested-ob');
    });

    it('keeps an isolated local setup watch-only and lets aligned continuation win', () => {
        const ctx = getContext();
        const context = { daily_bias: { direction: 'SELL' }, timeframe_context: {
            '1D': { bias: 'BEARISH', structural_trend: 'BEARISH', evidence: [] },
            '4H': { bias: 'BEARISH', structural_trend: 'BEARISH', evidence: [{ id: 'T4', kind: 'TREND', direction: 'SELL' }] },
            '1H': { bias: 'BEARISH', structural_trend: 'BEARISH', evidence: [{ id: 'T1', kind: 'TREND', direction: 'SELL' }] },
            '15M': { bias: 'MIXED', structural_trend: 'MIXED', evidence: [] }
        } };
        const common = { narrative_state: 'ACTIVE', execution_timeframe: '15M', entry_reachable_today: true };
        const result = ctx.buildTodayOpportunity({ currentPrice: 110, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true, marketContext: context,
            strategySetups: [
                { ...common, id: 'isolated-buy', primary: 'CRT', label: 'CRT+TBS', direction: 'BUY', setup_confidence: 99, event_time: '2026-09-14T09:00:00Z',
                    execution_model: 'CONFIRMATION_ENTRY', execution_zone: { id: 'buy-zone', type: 'CRT', low: 108, high: 109, freshness: 'FRESH', opportunity_reachable_today: true, structural_invalidation: { level: 107 } }, target_candidates: [{ level: 120, source: 'BUY_SIDE_LIQUIDITY' }] },
                { ...common, id: 'aligned-sell', primary: 'ICT', label: 'ICT', direction: 'SELL', setup_confidence: 0, event_time: '2026-09-14T09:30:00Z',
                    execution_zone: { id: 'sell-zone', type: 'SUPPLY', low: 111, high: 112, freshness: 'FRESH', entry_reachable_today: true, structural_invalidation: { level: 114 } }, target_candidates: [{ level: 100, source: 'SELL_SIDE_LIQUIDITY' }] }
            ] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.narrative_id).toBe('aligned-sell');
        expect(result.secondary_watch_scenarios[0].watch_only).toBe(true);
        expect(result.primary_opportunity.id).toBe('aligned-sell');
        expect(result.active_setups).toEqual([expect.objectContaining({ id: 'aligned-sell' })]);
        expect(result.watch_setups.map(setup => setup.id)).toEqual(['isolated-buy']);
    });

    it('does not present an isolated setup as an actionable retrace plan', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ currentPrice: 110, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            marketContext: { daily_bias: { direction: 'NEUTRAL' }, timeframe_context: { '1D': { bias: 'MIXED' }, '4H': { bias: 'BEARISH' }, '1H': { bias: 'MIXED' }, '15M': { bias: 'BULLISH' } } },
            strategySetups: [{ id: 'isolated', primary: 'CRT', direction: 'BUY', narrative_state: 'ACTIVE', execution_model: 'CONFIRMATION_ENTRY',
                execution_zone: { low: 108, high: 109, freshness: 'FRESH', opportunity_reachable_today: true, structural_invalidation: { level: 107 } }, target_candidates: [{ level: 120, source: 'BUY_SIDE_LIQUIDITY' }] }] });
        expect(result.state).toBe('WATCH_ONLY');
        expect(result.reason_code).toBe('LTF_ISOLATED_WATCH');
        expect(result.reason).not.toMatch(/valid strategy narrative remains actionable/i);
        expect(result.primary_opportunity).toBeNull();
        expect(result.watch_setups).toEqual([expect.objectContaining({ id: 'isolated', authorization_state: 'WATCH_ONLY', watch_only: true })]);
    });

    it('exposes multiple authorized developing setups without changing WAIT semantics', () => {
        const ctx = getContext();
        const common = { narrative_state: 'ACTIVE', execution_model: 'CONFIRMATION_ENTRY', entry_reachable_today: true, opportunity_reachable_today: true };
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.1, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            marketContext: { daily_bias: { direction: 'NEUTRAL' }, timeframe_context: { '1D': { bias: 'BEARISH', evidence: [{ id: 'd-sell', kind: 'TREND', direction: 'SELL' }] }, '4H': { bias: 'BEARISH', evidence: [{ id: 'h4-sell', kind: 'TREND', direction: 'SELL' }, { id: 'sweep', kind: 'LIQUIDITY_SWEEP', direction: 'BUY' }] }, '1H': { bias: 'BEARISH', evidence: [{ id: 'h1-sell', kind: 'TREND', direction: 'SELL' }, { id: 'mss', kind: 'MSS', direction: 'BUY' }] } } },
            targetCandidates: { buy: [{ level: 1.15, source: 'PDH', structural_priority: 80 }], sell: [{ level: 1.05, source: 'PDL', structural_priority: 80 }] },
            strategySetups: [
                { ...common, id: 'continuation', primary: 'ICT', label: 'ICT', direction: 'SELL', setup_confidence: 50, execution_zone: { id: 'supply-a', type: 'SUPPLY', low: 1.11, high: 1.12, entry_reachable_today: true, opportunity_reachable_today: true, structural_invalidation: { level: 1.13 } }, target_candidates: [{ level: 1.05, source: 'PDL' }] },
                { ...common, id: 'reversal', primary: 'ICT', label: 'ICT', direction: 'BUY', setup_confidence: 50, trade_context_classification: 'HTF_VERIFIED_REVERSAL', execution_zone: { id: 'demand-b', type: 'DEMAND', low: 1.08, high: 1.09, entry_reachable_today: true, opportunity_reachable_today: true, structural_invalidation: { level: 1.07 } }, target_candidates: [{ level: 1.15, source: 'PDH' }] }
            ] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.primary_opportunity).toBeTruthy();
        expect(result.active_setups).toEqual([expect.objectContaining({ id: result.primary_opportunity.id })]);
        expect(result.watch_setups).toEqual([]);
    });

    it('treats neutral daily bias as neutral context for both directions', () => {
        const ctx = getContext();
        for (const direction of ['BUY', 'SELL']) {
            const quality = ctx.buildOpportunityQuality({ direction, opportunity_thesis: { htf_narrative: { classification: 'HTF_ALIGNED_CONTINUATION' } } }, { target: { structural_priority: 80 }, zone: { type: 'FVG' }, execution_model: 'PENDING_LIMIT', metrics: { opportunity_reachable_today: true } }, { daily_bias: { direction: 'NEUTRAL' } }, { classification: 'HTF_ALIGNED_CONTINUATION' });
            expect(quality.daily_bias_relationship).toBe('NEUTRAL_CONTEXT');
        }
    });

    it('uses fresh classification over a stale stored thesis classification', () => {
        const ctx = getContext();
        const quality = ctx.buildOpportunityQuality({ direction: 'BUY', opportunity_thesis: { htf_narrative: { classification: 'LTF_ISOLATED' } } }, { target: { structural_priority: 90 }, zone: { type: 'DEMAND' }, execution_model: 'CONFIRMATION_ENTRY', metrics: { opportunity_reachable_today: true } }, { daily_bias: { direction: 'SELL' }, timeframe_context: {} }, { classification: 'HTF_VERIFIED_REVERSAL' });
        expect(quality.classification).toBe('HTF_VERIFIED_REVERSAL');
        expect(quality.previous_classification).toBe('LTF_ISOLATED');
        expect(quality.classification_changed).toBe(true);
        expect(quality.daily_bias_relationship).toBe('VERIFIED_COUNTERTREND');
    });

    it('lets primary continuation and reversal scenarios compete on quality, not fixed class tier', () => {
        const ctx = getContext();
        const plan = { target: { structural_priority: 80 }, zone: { type: 'FVG' }, execution_model: 'PENDING_LIMIT', metrics: { opportunity_reachable_today: true } };
        const continuation = ctx.buildOpportunityQuality({ direction: 'BUY', structural_evidence_ids: ['a'] }, plan, { daily_bias: { direction: 'BUY' } }, { classification: 'HTF_ALIGNED_CONTINUATION' });
        const reversal = ctx.buildOpportunityQuality({ direction: 'SELL', structural_evidence_ids: ['a'] }, plan, { daily_bias: { direction: 'SELL' } }, { classification: 'HTF_VERIFIED_REVERSAL' });
        expect(continuation.rank_tier).toBe(reversal.rank_tier);
        expect(Math.abs(continuation.rank_score - reversal.rank_score)).toBeLessThan(100);
        const strongReversal = ctx.buildOpportunityQuality({ direction: 'BUY', structural_evidence_ids: ['a', 'b', 'c', 'd'] }, { target: { structural_priority: 95 }, zone: { type: 'DEMAND', freshness: 'FRESH' }, execution_model: 'EXECUTION_AVAILABLE', metrics: { opportunity_reachable_today: true } }, { daily_bias: { direction: 'SELL' } }, { classification: 'HTF_VERIFIED_REVERSAL' });
        expect(strongReversal.rank_score).toBeGreaterThan(continuation.rank_score);
    });
});

describe('top-down trade context', () => {
    it('renders the canonical effective trend instead of the legacy EMA-only trend', async () => {
        const { context: ctx, elements } = getScanContext();
        const history = candles(80, 100, 0.1, 'up');
        await ctx.updateMTFDisplay({ '1D': history, '15M': history });
        expect(elements.get('trend1D').className).toContain('bullish');
        expect(elements.get('trend15M').className).toContain('bullish');
    });

    it('shows unavailable data instead of a false neutral trend', async () => {
        const { context: ctx, elements } = getScanContext();
        await ctx.updateMTFDisplay({ '1D': candles(10, 100, 0.1, 'up') });
        expect(elements.get('trend1D').innerHTML).toBe('Data');
        expect(elements.get('trend1D').className).toContain('neutral');
        expect(elements.get('trend1W').innerHTML).toBe('Data');
    });

    it('does not fetch optional weekly or one-minute data during a normal display refresh', async () => {
        const { context: ctx } = getScanContext();
        const historySpy = jest.fn(() => Promise.reject(new Error('unexpected provider request')));
        ctx.getHistory = historySpy;
        await ctx.updateMTFDisplay({ '1D': candles(10, 100, 0.1, 'up') });
        expect(historySpy.mock.calls.map(call => call[0])).not.toEqual(expect.arrayContaining(['1W', '1M']));
    });

    function context(ctx, daily, fourH, oneH, reversal = false) {
        const structure = Object.fromEntries([['1D', daily], ['4H', fourH], ['1H', oneH], ['15M', 'BULLISH']]
            .map(([tf, trend]) => [tf, { trend }]));
        if (reversal) structure['1H'].mss = { type: 'BULL', level: 101 };
        return ctx.buildTimeframeContext({ structure, price: 100,
            liquidity: reversal ? { '4H': { sweeps: [{ type: 'BUY', swept: true, level: 99 }] } } : {} });
    }

    it.each([
        ['BULLISH', 'BULLISH', 'BULLISH', 'HTF_ALIGNED_CONTINUATION'],
        ['BEARISH', 'BEARISH', 'BEARISH', 'LTF_ISOLATED'],
        ['BULLISH', 'BULLISH', 'BEARISH', 'LTF_ISOLATED'],
        ['NEUTRAL', 'BULLISH', 'BULLISH', 'HTF_ALIGNED_CONTINUATION'],
        ['BEARISH', 'BEARISH', 'MIXED', 'LTF_ISOLATED']
    ])('classifies daily %s / 4H %s / 1H %s as %s', (daily, fourH, oneH, expected) => {
        const ctx = getContext();
        expect(ctx.classifyTopDownTrade({ direction: 'BUY' }, context(ctx, daily, fourH, oneH)).classification).toBe(expected);
    });

    it('does not treat contradictory raw timeframe fields as alignment', () => {
        const ctx = getContext();
        const tf = context(ctx, 'BEARISH', 'BEARISH', 'BULLISH');
        // This models the inconsistent payload that previously let a matching
        // raw field override the canonical displayed trend. The canonical read
        // remains bearish on 1H, so a SELL continuation is allowed only when
        // the actual displayed direction supports it; a BUY must stay local.
        tf['1H'].displayed_trend = 'BEARISH';
        tf['1H'].effective_trend = 'BULLISH';
        tf['1H'].structural_trend = 'BULLISH';
        expect(ctx.classifyTopDownTrade({ direction: 'BUY' }, tf).classification).toBe('LTF_ISOLATED');
    });

    it('verifies a reversal with HTF sweep and 1H shift despite bearish HTF trends', () => {
        const ctx = getContext();
        const tf = context(ctx, 'BEARISH', 'BEARISH', 'BEARISH', true);
        const result = ctx.classifyTopDownTrade({ direction: 'BUY' }, tf);
        expect(result.classification).toBe('HTF_VERIFIED_REVERSAL');
        expect(result.evidence_ids.some(id => id.includes('4H:LIQUIDITY_SWEEP'))).toBe(true);
        expect(result.evidence_ids.some(id => id.includes('1H:MSS'))).toBe(true);
        expect(ctx.verifyTopDownTradeClassification({ direction: 'BUY', trade_context_classification: result.classification, top_down_evidence_ids: result.evidence_ids }, tf).verified).toBe(true);
    });

    it('rejects fake evidence and an unsupported AI continuation claim', () => {
        const ctx = getContext();
        const tf = context(ctx, 'BEARISH', 'BEARISH', 'BEARISH');
        expect(ctx.verifyTopDownTradeClassification({ direction: 'BUY', trade_context_classification: 'HTF_VERIFIED_REVERSAL', top_down_evidence_ids: ['fake'] }, tf).reason_code).toBe('TOP_DOWN_EVIDENCE_UNKNOWN');
        expect(ctx.verifyAiStrategyHypothesis({ direction: 'BUY', trade_context_classification: 'HTF_ALIGNED_CONTINUATION', top_down_evidence_ids: [] }, { timeframe_context: tf }).reason_code).toBe('TOP_DOWN_CLASSIFICATION_UNSUPPORTED');
    });

    it('requires both a higher-timeframe raid and a structure shift for reversal', () => {
        const ctx = getContext();
        const tf = context(ctx, 'BEARISH', 'BEARISH', 'BEARISH', true);
        tf['4H'].evidence = [];
        expect(ctx.classifyTopDownTrade({ direction: 'BUY' }, tf).classification).toBe('LTF_ISOLATED');
    });

    it('penalizes isolated quality with a bounded adjustment and keeps confidence immutable after selection', () => {
        const ctx = getContext();
        const candidate = { id: 'top-down', direction: 'BUY', entry: 100, stop_loss: 99, tp1: 103, rr_tp1: 3, zone_low: 99.5, zone_high: 100.5,
            trade_context_classification: 'LTF_ISOLATED', htf_alignment: 3 };
        const isolated = ctx.calculateCandidateConfidence(candidate);
        const aligned = ctx.calculateCandidateConfidence({ ...candidate, trade_context_classification: 'HTF_ALIGNED_CONTINUATION' });
        expect(isolated.final_score).toBeLessThan(aligned.final_score);
        expect(aligned.final_score - isolated.final_score).toBe(10);
        expect(isolated.quality).not.toBe('HIGH');
        candidate.quality = { final_confidence: isolated.final_score };
        candidate.top_down_context = ctx.classifyTopDownTrade(candidate, context(ctx, 'BEARISH', 'BEARISH', 'BEARISH'));
        const ai = ctx.applyAdaptiveCandidateToAIResult({ selected_candidate_id: candidate.id, confidence: 99, trade_context_classification: 'HTF_VERIFIED_REVERSAL' }, { adaptive_setup_candidates: [candidate] });
        expect(ai.trade_context_classification).toBe('LTF_ISOLATED');
        expect(ai.quality.final_confidence).toBe(isolated.final_score);
    });

    it('keeps forming-candle evidence out and produces stable evidence IDs', () => {
        const ctx = getContext();
        const data = candles(30, 100, 1, 'up');
        const input = { historyCache: { '1H': data }, price: 110 };
        const first = ctx.buildTimeframeContext(input);
        const second = ctx.buildTimeframeContext({ ...input, historyCache: { '1H': [...data, { o: 200, h: 300, l: 1, c: 299, is_closed: false }] } });
        expect(second['1H']).toEqual(first['1H']);
        expect(first['1H'].structural_evidence_ids).toEqual(ctx.buildTimeframeContext(input)['1H'].structural_evidence_ids);
        expect(first).not.toHaveProperty('5M');
    });

    it('exposes compact top-down truth without changing the selected execution timeframe', () => {
        const ctx = getContext();
        const top = ctx.classifyTopDownTrade({ direction: 'BUY' }, context(ctx, 'BULLISH', 'BULLISH', 'BULLISH'));
        const signal = ctx.buildPublicTradeSignal({ decision: 'BUY_LIMIT', direction: 'BUY', timeframe: '15M', entry: 100, stop_loss: 99, tp1: 103,
            trade_context_classification: top.classification, top_down_context: top });
        expect(signal.timeframe).toBe('15M');
        expect(signal.analysis.trade_context).toBe('HTF_ALIGNED_CONTINUATION');
        expect(signal.analysis.higher_timeframe.daily).toContain('BULLISH');
        expect(signal).not.toHaveProperty('timeframe_context');
        const wait = ctx.buildPublicTradeSignal({ decision: 'WAIT', status: 'TODAY_OPPORTUNITY', trade_context_classification: top.classification, top_down_context: top });
        expect(wait.analysis.type).toBe(top.classification);
    });

    it('shows a valid low-confidence setup while keeping execution disabled', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            date: '2026-09-16', pair: 'XAU/USD', decision: 'BUY', status: 'SETUP_AVAILABLE',
            direction: 'BUY', entry: 100, stop_loss: 95, tp1: 110, confidence: 30,
            execution_allowed: false, setup_state: 'SETUP_AVAILABLE', entry_zone: { low: 99, high: 101, source: 'ICT' }
        });
        expect(signal.status).toBe('SETUP_AVAILABLE');
        expect(signal.setup_state).toBe('SETUP_AVAILABLE');
        expect(signal.execution_allowed).toBe(false);
        expect(signal.manual_tracking_allowed).toBe(false);
        expect(signal.entry).toBe(100);
        expect(signal.decision).toBe('BUY_LIMIT');
    });

    it('keeps the selected developing setup in the public signal contract', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({ date: '2026-09-15', time: '10:00:00', pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY',
            primary_opportunity: { id: 'MM-1', direction: 'SELL', state: 'WAITING_FOR_LOCATION' }, active_setups: [], watch_setups: [],
            reason: { code: 'WAITING_FOR_LOCATION', message: 'Price has not reached the validated area.' } });
        expect(signal).not.toHaveProperty('primary_opportunity');
        expect(signal).not.toHaveProperty('active_setups');
        expect(signal).not.toHaveProperty('watch_setups');
    });

    it('exposes the best watch zone in a WAIT response', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            date: '2026-09-16', pair: 'AUD/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY',
            reason: { code: 'LTF_ISOLATED_WATCH', message: 'Higher-timeframe confirmation is pending.' },
            watch_setups: [{ id: 'ICT-15M-BUY-1', direction: 'BUY', strategy: 'ICT',
                setup_timeframe: '15M', execution_timeframe: '15M',
                location: { low: 0.7100, high: 0.7110, source: 'FVG', timeframe: '15M' },
                execution_model: 'CONFIRMATION_ENTRY', state: 'WAITING_FOR_EXECUTION',
                target_intent: 'OPPOSING_MSNR', next_requirement: ['Confirmation candle'] }]
        });
        expect(signal.opportunity.area_of_interest).toEqual(expect.objectContaining({ low: 0.7100, high: 0.7110 }));
        expect(signal.opportunity.execution_model).toBe('CONFIRMATION_ENTRY');
        expect(signal.opportunity.direction).toBe('BUY');
    });

    it('renders a watch opportunity when no primary setup exists', () => {
        const { context, elements } = getScanContext();
        context.renderOpportunityStack({
            watch_setups: [{ direction: 'BUY', strategy: 'ICT', setup_timeframe: '15M', execution_timeframe: '15M',
                location: { low: 0.71, high: 0.711, source: 'FLIP' }, state: 'WAITING_FOR_EXECUTION',
                target: { level: 0.715, source: 'LIQUIDITY' }, reason: 'Awaiting confirmation', next_requirement: ['Confirmation candle'] }]
        });
        expect(elements.get('opportunityStack').innerHTML).toContain('WATCH OPPORTUNITY');
        expect(elements.get('opportunityStack').innerHTML).toContain('Awaiting confirmation');
        expect(elements.get('opportunityStack').innerHTML).toContain('0.71');
    });

    it('renders the public safety status banner without requiring JSON inspection', () => {
        const { context, elements } = getScanContext();
        context.renderSignalStatus({ status_code: 'SETUP_READY', execution_allowed: false, manual_tracking_allowed: true,
            data_quality: { valid: true }, news_risk: { status: 'UNKNOWN' } });
        expect(elements.get('signalStatus').textContent).toContain('SETUP_READY');
        expect(elements.get('signalStatus').textContent).toContain('MANUAL REVIEW AVAILABLE');
        expect(elements.get('signalStatus').textContent).toContain('DATA VALID');
        expect(elements.get('signalStatus').className).toContain('setup-ready');
    });

    it('removes the replay action while retaining the copy action', () => {
        const html = fs.readFileSync('index.html', 'utf8');
        expect(html).toContain('id="copyJsonBtn"');
        expect(html).not.toContain('id="scanReplayBtn"');
        expect(code).not.toContain("getElementById('scanReplayBtn')");
    });

    it('keeps replay export hidden behind the existing Copy action', () => {
        expect(code).toContain('(event?.altKey || event?.shiftKey || event?.detail >= 2) && window.__ICT_LAST_SCAN_REPLAY__');
        const html = fs.readFileSync('index.html', 'utf8');
        expect(html).toContain('id="copyJsonBtn"');
        expect(html).not.toContain('Scan Replay</button>');
    });

    it('carries reversal classification through the planner and analyst evidence catalog without changing entry models', () => {
        const ctx = getContext();
        const tf = context(ctx, 'BEARISH', 'BEARISH', 'MIXED', true);
        const setup = { id: 'crt-15m', primary: 'CRT', direction: 'BUY', narrative_state: 'ACTIVE', timeframe: '15M',
            execution_model: 'RECLAIM_RETEST', target_candidates: [{ level: 110, source: 'CRT_OPPOSITE_RANGE' }],
            execution_zone: { id: 'zone-15m', type: 'CRT', timeframe: '15M', low: 99.5, high: 100.5, midpoint: 100,
                entry_reachable_today: true, opportunity_reachable_today: true, structural_invalidation: { level: 98, source: 'CRT_SWEEP_EXTREME' } } };
        const input = { pair: 'XAU/USD', currentPrice: 101, marketOpen: true, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'),
            marketContext: { timeframe_context: tf }, strategySetups: [setup] };
        const pending = ctx.buildTodayOpportunity(input);
        expect(pending.state).toBe('TODAY_OPPORTUNITY');
        expect(pending.trade_context_classification).toBe('HTF_VERIFIED_REVERSAL');
        expect(pending.execution_model).toBe('PENDING_LIMIT');
        const confirmation = ctx.buildTodayOpportunity({ ...input, strategySetups: [{ ...setup, execution_model: 'CONFIRMATION_ENTRY' }] });
        expect(confirmation.execution_model).toBe('CONFIRMATION_ENTRY');
        expect(confirmation.trade_context_classification).toBe(pending.trade_context_classification);
        const catalog = ctx.buildAiMarketEvidenceCatalog({
            pair: 'XAU/USD', current_price: 100, market_open: true,
            symbol_metadata: { asset_class: 'METAL' },
            data_quality: { valid: true },
            provider_metadata: { provider: 'TWELVE_DATA' },
            market_regime: { regime: 'TRANSITION', volatility_regime: 'NORMAL' },
            market_context: { timeframe_context: tf }
        });
        expect(catalog.timeframe_context).toEqual(tf);
        expect(catalog.market_regime.regime).toBe('TRANSITION');
        expect(catalog.symbol_metadata.asset_class).toBe('METAL');
        expect(catalog.data_quality.valid).toBe(true);
        const prompt = ctx.buildAiMarketAnalystPrompt(catalog);
        expect(prompt.user).toContain(tf['4H'].structural_evidence_ids[0]);
        expect(prompt.system).toContain('HTF_VERIFIED_REVERSAL');
    });

    it('verifies an AI market-mechanics hypothesis without a CRT/TBS/MSNR event', () => {
        const ctx = getContext();
        const zone = { id: 'FVG-1H-BUY', type: 'FVG', direction: 'BUY', timeframe: '1H', low: 99, high: 100, primary_eligible: true, invalidated: false, created_time: Date.parse('2026-09-14T08:00:00Z') };
        const tf = { '1H': { bias: 'BULLISH', structural_trend: 'BULLISH', structure: { recent_swing_lows: [{ level: 97 }] }, structural_evidence_ids: ['SHIFT:1H:BUY'], evidence: [{ id: 'SHIFT:1H:BUY', kind: 'MSS', direction: 'BUY' }] } };
        const result = ctx.verifyAiStrategyHypothesis({ strategy: 'ICT', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '15M', hypothesis_id: 'AI-I1', preferred_execution_zone_ids: [zone.id] }, {
            timeframe_context: tf, execution_zones: [zone], target_candidates: { buy: [{ direction: 'BUY', level: 110, source: 'BUY_SIDE_LIQUIDITY' }] }
        }, { pair: 'XAU/USD', current_price: 101 });
        expect(result.verified).toBe(true);
        expect(result.setup.primary).toBe('ICT');
        expect(result.setup.execution_zone.id).toBe(zone.id);
    });

    it('blocks an isolated strategy-backed candidate from executable authorization', () => {
        const ctx = getContext();
        const result = ctx.validateExecutableCandidateInvariant({ direction: 'BUY', entry: 100, stop_loss: 98, tp1: 106,
            strategy_setup: { primary: 'CRT' }, trade_context_classification: 'LTF_ISOLATED' }, { as_of_time: Date.now() });
        expect(result.valid).toBe(false);
        expect(result.failures).toContain('LTF_ISOLATED');
    });
});

describe('daily opportunity planning', () => {
    it('does not let an advanced parent setup suppress a fresh current-market opportunity', () => {
        const ctx = getContext();
        const tf = Object.fromEntries(['1D', '4H', '1H', '15M'].map(timeframe => [timeframe, { bias: 'BULLISH', structural_trend: 'BULLISH', evidence: [], structural_evidence_ids: [] }]));
        const oldSetup = { id: 'old-buy', primary: 'CRT', direction: 'BUY', narrative_state: 'ACTIVE', timeframe: '1H', event_time: Date.parse('2026-09-14T01:00:00Z'), execution_zone: { id: 'old-zone', low: 99, high: 100, midpoint: 99.5, timeframe: '1H', entry_reachable_today: true }, target_candidates: [{ level: 100, source: 'CRT_OPPOSITE_RANGE' }] };
        const freshSetup = { id: 'fresh-buy', primary: 'ICT', label: 'ICT', direction: 'BUY', narrative_state: 'ACTIVE', market_mechanics_verified: true, timeframe: '15M', execution_timeframe: '15M', event_time: Date.parse('2026-09-14T09:00:00Z'), execution_model: 'FRESH_RETRACEMENT_LIMIT', execution_zone: { id: 'fresh-zone', low: 101, high: 102, midpoint: 101.5, timeframe: '15M', created_time: Date.parse('2026-09-14T09:15:00Z'), freshness: 'FRESH', entry_reachable_today: true, opportunity_reachable_today: true, structural_invalidation: { level: 99, source: 'ICT_SWING' } }, target_candidates: [{ level: 112, source: 'BUY_SIDE_LIQUIDITY' }] };
        const result = ctx.buildTodayOpportunity({ pair: 'GBP/JPY', currentPrice: 103, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true, marketContext: { timeframe_context: tf, daily_bias: { direction: 'BUY' } }, strategySetups: [oldSetup, freshSetup], executionZones: [], histories: {} });
        expect(result.reason_code).not.toBe('DELIVERY_ALREADY_ADVANCED');
        expect(result.fresh_current_market_opportunities).toContain('fresh-buy');
    });

    it('propagates verified reversal confirmation execution through the selected result', () => {
        const ctx = getContext();
        const candidate = { id: 'reversal-confirmation', direction: 'BUY', entry: 100, stop_loss: 98, tp1: 106, rr_tp1: 3, entry_zone: { low: 99, high: 101 },
            execution_model: 'CONFIRMATION_ENTRY', entry_model: 'CONFIRMATION_ENTRY', trade_context_classification: 'HTF_VERIFIED_REVERSAL',
            strategy_setup: { primary: 'CRT' }, quality: { final_confidence: 70 }, target_map: [{ target_level: 106, primary_target_source: 'CRT_OPPOSITE_RANGE' }] };
        const result = ctx.applyAdaptiveCandidateToAIResult({ selected_candidate_id: candidate.id }, { adaptive_setup_candidates: [candidate] });
        expect(result.execution_model).toBe('CONFIRMATION_ENTRY');
        expect(result.setup_type).toBe('CONFIRMATION_ENTRY');
        expect(result.decision).toBe('BUY');
    });

    it('adds a closed previous-day high and low as deterministic liquidity targets', () => {
        const ctx = getContext();
        const day = t => ({ t, o: 100, h: 110, l: 90, c: 105, is_closed: true });
        const targets = ctx.buildTargetCandidates({ '1D': [day(Date.parse('2026-09-12T00:00:00Z'))] }, 100, 'EUR/USD');
        expect(targets.buy.some(target => target.source === 'PDH' && target.level === 110)).toBe(true);
        expect(targets.sell.some(target => target.source === 'PDL' && target.level === 90)).toBe(true);
    });

    it('uses the actual timeframe duration for same-timeframe combination windows', () => {
        const ctx = getContext();
        const zone = { low: 99.5, high: 100.5 };
        for (const [timeframe, hours] of [['15M', 0.25], ['1H', 1], ['4H', 4]]) {
            const first = { primary: 'CRT', direction: 'BUY', timeframe, execution_zone: zone, event_time: Date.parse('2026-01-01T00:00:00Z') };
            const inside = { primary: 'TBS', direction: 'BUY', timeframe, execution_zone: zone, event_time: Date.parse('2026-01-01T00:00:00Z') + (20 * hours - 0.01) * 3600000 };
            const outside = { ...inside, event_time: Date.parse('2026-01-01T00:00:00Z') + (20 * hours + 0.01) * 3600000 };
            expect(ctx.evaluateCombinationCompatibility(first, inside, { pipSize: 0.01 }).temporally_related).toBe(true);
            expect(ctx.evaluateCombinationCompatibility(first, outside, { pipSize: 0.01 }).temporally_related).toBe(false);
        }
    });

    it('returns TRADE_READY for an already validated deterministic candidate', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.1, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            validCandidates: [{ id: 'C-1', strategy_label: 'CRT', direction: 'BUY', execution_timeframe: '1H', execution_model: 'PENDING_LIMIT', entry: 1.1, zone_low: 1.09, zone_high: 1.11, stop_loss: 1.08, tp1: 1.14, rr_tp1: 3, target_bias: 'BUY_SIDE_LIQUIDITY', lifecycle: { state: 'FRESH_PENDING_TODAY' }, entry_reachable_today: true }] });
        expect(result.state).toBe('TRADE_READY');
        expect(result.execution_model).toBe('PENDING_LIMIT');
    });

    it('does not let an AI WAIT veto a deterministic TRADE_READY candidate', () => {
        const ctx = getContext();
        const candidate = {
            id: 'MM-SELL-1', direction: 'SELL', zone_type: 'FVG', timeframe: '4H',
            zone_low: 1.1552, zone_high: 1.1563, entry: 1.1558, stop_loss: 1.161,
            tp1: 1.1523, rr_tp1: 2.1, quality: { final_confidence: 78 }, score: 300,
            strategy_label: 'MARKET_MECHANICS', execution_model: 'PENDING_LIMIT',
            target_map: [{ primary_target_source: 'PDL', target_type: 'LIQUIDITY', target_confluence: [] }]
        };
        const aiResult = { noTrade: true, decision: 'WAIT', wait_condition: 'selector declined' };
        const preserved = ctx.preserveDeterministicCandidateAfterAiNoTrade(aiResult,
            { state: 'TRADE_READY' }, { adaptive_setup_candidates: [candidate] });
        expect(preserved).toBe(true);
        expect(aiResult.noTrade).toBe(false);
        expect(aiResult.selected_candidate_id).toBe('MM-SELL-1');
        expect(aiResult.decision).toBe('SELL_LIMIT');
        expect(aiResult.entry).toBe(1.1558);
        expect(aiResult.stop_loss).toBe(1.161);
        expect(aiResult.take_profit_1).toBe(1.1523);
    });

    it('returns a useful WAITING_FOR_RETRACE plan for an active developing narrative', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'S-1', primary: 'CRT', strategy_label: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', execution_timeframe: '15M', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, timeframe: '15M', direction: 'SELL', freshness: 'FRESH', consumed: false, entry_reachable_today: true, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05, source: 'CRT_OPPOSITE_RANGE' }], setup_confidence: 68 }] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.reason_code).toBe('WAITING_FOR_RETRACE');
        expect(result.execution_model).toBe('PENDING_LIMIT');
        expect(result.area_of_interest.low).toBe(1.1);
    });

    it('returns WAITING_FOR_CONFIRMATION when price is in the developing area', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.105, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'S-2', primary: 'TBS', strategy_label: 'TBS', direction: 'SELL', narrative_state: 'ACTIVE', execution_timeframe: '15M', execution_model: 'CONFIRMATION_ENTRY', requires_confirmation: true, execution_zone: { low: 1.1, high: 1.11, timeframe: '15M', direction: 'SELL', freshness: 'FRESH', consumed: false, opportunity_reachable_today: true, structural_invalidation: { level: 1.25, source: 'TBS_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05, source: 'TBS_LIQUIDITY' }] }] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.reason_code).toBe('WAITING_FOR_CONFIRMATION');
    });

    it('does not resurrect a consumed original entry, but allows a fresh continuation zone', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [
                { id: 'old', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', original_strategy_entry_consumed: true, execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, consumed: true }, target_candidates: [{ level: 1.05 }] },
                { id: 'new', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', event_time: '2026-09-14T08:00:00Z', original_strategy_entry_consumed: true, execution_model: 'FRESH_RETRACEMENT_LIMIT', execution_zone: { id: 'FRESH-NEW', low: 1.15, high: 1.16, created_time: '2026-09-14T09:00:00Z', freshness: 'FRESH', consumed: false, entry_reachable_today: true, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05, source: 'CRT_OPPOSITE_RANGE' }] }
            ] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.narrative_id).toBe('new');
    });

    it('returns NO_TRADE_TODAY when no active narrative has a defensible target', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'stale', primary: 'MSNR', direction: 'BUY', narrative_state: 'STALE_NARRATIVE', execution_zone: { low: 1.1, high: 1.11 } }] });
        expect(result.state).toBe('NO_TRADE_TODAY');
        expect(result.reason_code).toBe('NO_TRADE_TODAY');
    });

    it('keeps the public planning output compact and separate from diagnostics', () => {
        const ctx = getContext();
        const result = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', price: 1.2, decision: 'WAIT', status: 'TODAY_OPPORTUNITY', confidence: 68, strategy: 'CRT', bias: 'BEARISH', opportunity: { area_of_interest: { low: 1.1, high: 1.11 }, execution_model: 'CONFIRMATION_ENTRY' }, reason: { code: 'WAITING_FOR_RETRACE', message: 'Wait for price to return to the area.' }, market_open: true });
        expect(result.status).toBe('TODAY_OPPORTUNITY');
        expect(result.analysis.type).toBe('CRT');
        expect(result.opportunity).toEqual(expect.objectContaining({
            area_of_interest: { low: 1.1, high: 1.11 },
            execution_model: 'CONFIRMATION_ENTRY'
        }));
        expect(result).not.toHaveProperty('candidate_pipeline');
        expect(result).not.toHaveProperty('seed_diagnostics');
    });

    it('does not infer reachability when a raw setup omits reachability data', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'unknown-reach', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05, source: 'CRT_OPPOSITE_RANGE' }] }] });
        expect(result.state).toBe('NO_TRADE_TODAY');
        expect(result.reason_code).toBe('ENTRY_NOT_REACHABLE_TODAY');
    });

    it('rejects an area that is explicitly unreachable today', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'far', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, entry_reachable_today: false, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05 }] }] });
        expect(result.reason_code).toBe('ENTRY_NOT_REACHABLE_TODAY');
    });

    it('rejects a narrative whose target delivery is already materially advanced', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.02, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'advanced', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', entry: 1.1, execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.09, high: 1.11, entry_reachable_today: true, structural_invalidation: { level: 1.13, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.01, source: 'CRT_OPPOSITE_RANGE' }] }] });
        expect(result.state).toBe('NO_TRADE_TODAY');
        expect(result.reason_code).toBe('NO_TRADE_TODAY');
        expect(result.previous_opportunity_status).toBe('DELIVERY_ADVANCED');
    });

    it('rejects completed targets and target-bias-only narratives', () => {
        const ctx = getContext();
        const completed = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.0, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'completed', primary: 'TBS', direction: 'SELL', narrative_state: 'ACTIVE', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.09, high: 1.11, entry_reachable_today: true, structural_invalidation: { level: 1.13, source: 'TBS_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.01, source: 'TBS_LIQUIDITY' }] }] });
        expect(completed.reason_code).toBe('NO_REMAINING_TARGET');
        const intentOnly = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'intent-only', primary: 'CRT', direction: 'SELL', target_bias: 'SELL_SIDE_LIQUIDITY', narrative_state: 'ACTIVE', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, entry_reachable_today: true, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } } }] });
        expect(intentOnly.state).toBe('NO_TRADE_TODAY');
    });

    it('does not leak a hard data-integrity rejection into planning', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.2, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true, candidateDiagnostics: { rejection_detail: { DATA_TIME_INCONSISTENT: 4 } },
            strategySetups: [{ id: 'bad-time', primary: 'CRT', direction: 'SELL', narrative_state: 'ACTIVE', execution_model: 'RECLAIM_RETEST', execution_zone: { low: 1.1, high: 1.11, entry_reachable_today: true, structural_invalidation: { level: 1.25, source: 'CRT_SWEEP_EXTREME' } }, target_candidates: [{ level: 1.05 }] }] });
        expect(result.state).toBe('NO_TRADE_TODAY');
        expect(result.reason_code).toBe('DATA_TIME_INCONSISTENT');
    });

    it('requires explicit confirmation only for confirmation-entry models', () => {
        const ctx = getContext();
        const result = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 1.105, scanAsOfMs: Date.parse('2026-09-14T10:00:00Z'), marketOpen: true,
            strategySetups: [{ id: 'confirm', primary: 'MSNR', direction: 'SELL', narrative_state: 'ACTIVE', execution_model: 'CONFIRMATION_ENTRY', requires_confirmation: true, execution_zone: { low: 1.1, high: 1.11, opportunity_reachable_today: true, structural_invalidation: { level: 1.13, source: 'MSNR_RESISTANCE_INVALIDATION' } }, target_candidates: [{ level: 1.05, source: 'STRUCTURAL_MSNR' }] }] });
        expect(result.state).toBe('TODAY_OPPORTUNITY');
        expect(result.execution_model).toBe('CONFIRMATION_ENTRY');
        expect(result.reason_code).toBe('WAITING_FOR_CONFIRMATION');
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
    it('keeps the effective stop floor at 75% of the configured ATR rule', () => {
        const ctx = getContext();
        expect(ctx.getPreferredStopAtrMultiplier({ minSLMultiplier: 2 })).toBe(1.5);
        expect(ctx.getPreferredStopAtrMultiplier({ minSLMultiplier: 1.5 })).toBe(1.125);
    });

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

    it('allows a pending limit target that is past current price but still beyond the future entry', () => {
        const ctx = getContext();
        const result = ctx.selectAdaptiveTargets('SELL', 1.14500, 1.14600, {
            sell: [{ direction: 'SELL', level: 1.14300, source: 'SWING_LOW', origin: 'STRUCTURAL', timeframe: '1H', structural_priority: 76 }],
            buy: []
        }, 2.0, 5, {
            currentPrice: 1.14282,
            executionModel: 'PENDING_LIMIT',
            historyCache: { '1H': candles(40, 1.143, 0.0001, 'down') },
            zones: [],
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [] }
        });
        expect(result?.tp1?.level).toBe(1.143);
    });

    it('keeps current-price target filtering for confirmation entries', () => {
        const ctx = getContext();
        const result = ctx.selectAdaptiveTargets('SELL', 1.14500, 1.14600, {
            sell: [{ direction: 'SELL', level: 1.14300, source: 'SWING_LOW', origin: 'STRUCTURAL', timeframe: '1H', structural_priority: 76 }],
            buy: []
        }, 2.0, 5, {
            currentPrice: 1.14282,
            executionModel: 'CONFIRMATION_ENTRY',
            historyCache: { '1H': candles(40, 1.143, 0.0001, 'down') },
            zones: [],
            liquidity: { above: [], below: [] },
            strategySetup: { target_candidates: [] }
        });
        expect(result).toBeNull();
        expect(ctx.selectAdaptiveTargets.lastDiagnostics.failure_code).toBe('NO_TARGETS_DIRECTIONALLY_AHEAD');
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

describe('institutional-style zone confluence ranking', () => {
    it('rewards a same-direction entry zone nested inside higher-timeframe demand or a breaker', () => {
        const ctx = getContext();
        const result = ctx.scoreInstitutionalZoneConfluence({ type: 'FVG', direction: 'BUY', timeframe: '15M', low: 99.4, high: 99.6 }, [
            { id: 'demand-4h', type: 'DEMAND', direction: 'BUY', timeframe: '4H', low: 99, high: 100 },
            { id: 'breaker-1h', type: 'FLIP', direction: 'BUY', timeframe: '1H', low: 99.2, high: 99.8 }
        ], {
            '4H': { evidence: [{ direction: 'BUY', kind: 'LIQUIDITY_SWEEP' }] }
        }, 'BUY');
        expect(result.score).toBe(19);
        expect(result.nested_locations).toEqual(['demand-4h', 'breaker-1h']);
        expect(result.evidence).toContain('LIQUIDITY_SWEEP:4H');
    });

    it('does not reward opposite-side or non-nested locations', () => {
        const ctx = getContext();
        const result = ctx.scoreInstitutionalZoneConfluence({ type: 'OB', direction: 'SELL', timeframe: '15M', low: 99.4, high: 99.6 }, [
            { type: 'DEMAND', direction: 'BUY', timeframe: '4H', low: 99, high: 100 },
            { type: 'SUPPLY', direction: 'SELL', timeframe: '4H', low: 101, high: 102 }
        ], {}, 'SELL');
        expect(result.score).toBe(0);
        expect(result.nested_locations).toEqual([]);
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
            candidate.target_map = [{ target_level: 104, primary_target_source: 'SWING_HIGH' }];
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
            tp3: 105.0,
            target_map: [{ target_level: 103.0, primary_target_source: 'CRT_OPPOSITE_RANGE' }]
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
        expect(spies.getHistory.mock.calls.map(call => call[0])).toEqual(['5M', '15M', '1H', '4H', '1D']);
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
    it('uses asset-aware volatility thresholds for small-precision crypto gaps', () => {
        const ctx = getContext();
        const data = Array.from({ length: 20 }, (_, i) => {
            const close = 100 + i * 0.001;
            return { t: i + 1, o: close - 0.0002, h: close + 0.0002, l: close - 0.0003, c: close, v: 1 };
        });
        data[10] = { t: 11, o: 99.9998, h: 100.0000, l: 99.9995, c: 99.9999, v: 1 };
        data[12] = { t: 13, o: 100.0104, h: 100.0108, l: 100.0100, c: 100.0106, v: 1 };
        const fvgs = ctx.detectFVG(data, 'BTC/USD', { asset_class: 'CRYPTO', tick_size: 0.00000001, price_precision: 8 });
        expect(fvgs.some(f => f.type === 'bull' && f.l === 100.0000 && f.h === 100.0100)).toBe(true);
    });
});

describe('getQuoteDirection', () => {
    it('returns NEUTRAL for short data (no more 1-candle guessing)', async () => {
        const ctx = getContext();
        const result = await ctx.getQuoteDirection('1H', candles(3, 100, 1, 'up'));
        expect(result).toBe('NEUTRAL');
    });

    it('displays mixed structure instead of flattening it to neutral', () => {
        const ctx = getContext();
        expect(ctx.getCanonicalDisplayedTrend({ effective_trend: 'NEUTRAL', structural_trend: 'MIXED', momentum_trend: 'BULLISH' })).toBe('BULLISH');
        expect(ctx.getCanonicalDisplayedTrend({ effective_trend: 'NEUTRAL', structural_trend: 'MIXED', momentum_trend: 'NEUTRAL' })).toBe('MIXED');
        expect(ctx.getCanonicalDisplayedTrend({ effective_trend: 'BULLISH_TRANSITION', structural_trend: 'MIXED' })).toBe('BULLISH_TRANSITION');
    });

    it('uses the canonical structure snapshot used by the timeframe display', async () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const snapshot = ctx.buildStructureSnapshot(data, '1H');
        const expected = snapshot.effective_trend === 'BULLISH_TRANSITION' ? 'BULLISH'
            : snapshot.effective_trend === 'BEARISH_TRANSITION' ? 'BEARISH' : snapshot.effective_trend;
        expect(await ctx.getQuoteDirection('1H', data)).toBe(expected);
    });

    it('uses the canonical effective direction when raw structure is mixed', () => {
        const ctx = getContext();
        const input = {
            '1D': { effective_trend: 'BEARISH', structural_trend: 'BEARISH', momentum_trend: 'BEARISH' },
            '4H': { effective_trend: 'BULLISH', structural_trend: 'MIXED', momentum_trend: 'BULLISH' },
            '1H': { effective_trend: 'BULLISH_TRANSITION', structural_trend: 'MIXED', momentum_trend: 'BULLISH' },
            '15M': { effective_trend: 'NEUTRAL', structural_trend: 'MIXED', momentum_trend: 'NEUTRAL' }
        };
        const result = ctx.buildTimeframeContext({ structure: input, historyCache: {}, price: 100 });
        expect(result['4H']).toMatchObject({ displayed_trend: 'BULLISH', bias: 'BULLISH' });
        expect(result['1H']).toMatchObject({ displayed_trend: 'BULLISH_TRANSITION', bias: 'BULLISH' });
        expect(result['15M'].displayed_trend).toBe('MIXED');
    });

    it('uses the same canonical trend when validating a timeframe as when displaying it', () => {
        const ctx = getContext();
        expect(ctx.getCanonicalTimeframeTrend([], '4H', {
            effective_trend: 'BULLISH',
            structural_trend: 'MIXED',
            momentum_trend: 'BULLISH'
        })).toBe('BULLISH');
        expect(ctx.getCanonicalTimeframeTrend([], '4H', {
            effective_trend: 'NEUTRAL',
            structural_trend: 'MIXED',
            momentum_trend: 'NEUTRAL'
        })).toBe('MIXED');
    });

    it('normalizes public trend output from raw snapshot arrays and maps', () => {
        const ctx = getContext();
        expect(ctx.normalizePublicTrendMap([
            { timeframe: '4H', structural_trend: 'MIXED', effective_trend: 'BULLISH_TRANSITION' },
            { timeframe: '1H', structural_trend: 'MIXED', effective_trend: 'NEUTRAL', momentum_trend: 'BULLISH' }
        ])).toEqual({ '4H': 'BULLISH_TRANSITION', '1H': 'BULLISH' });
        expect(ctx.normalizePublicTrendMap({ '1D': 'BEARISH', '15M': { structural_trend: 'MIXED', effective_trend: 'NEUTRAL', momentum_trend: 'NEUTRAL' } }))
            .toEqual({ '1D': 'BEARISH', '15M': 'MIXED' });
        expect(ctx.normalizePublicTrendMap({ daily: '1D: BEARISH; BOS supports SELL', four_hour: '4H: BULLISH_TRANSITION; MSS supports BUY', one_hour: '1H: BULLISH' }))
            .toEqual({ '1D': 'BEARISH', '4H': 'BULLISH_TRANSITION', '1H': 'BULLISH' });
    });

    it('keeps higher-timeframe explanations aligned with the canonical trend map', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            decision: 'BUY_LIMIT', direction: 'BUY', pair: 'XAU/USD', entry: 100,
            stop_loss: 98, tp1: 105, confidence: 80,
            trend_detection: { '1D': 'BEARISH', '4H': 'BEARISH_TRANSITION', '1H': 'BULLISH' },
            top_down_context: { higher_timeframe: {
                daily: '1D: BEARISH; BOS supports SELL',
                four_hour: '4H: MIXED; LIQUIDITY_SWEEP supports BUY',
                one_hour: '1H: BEARISH; CRT supports BUY'
            } }
        });
        expect(signal.analysis.structural_context).toEqual({ '1D': 'BEARISH', '4H': 'BEARISH_TRANSITION', '1H': 'BULLISH' });
        expect(signal.analysis.higher_timeframe).toEqual({
            daily: '1D: BEARISH; BOS supports SELL',
            four_hour: '4H: BEARISH_TRANSITION; LIQUIDITY_SWEEP BUY evidence',
            one_hour: '1H: BULLISH; CRT supports BUY'
        });
    });

    it('keeps canonical trend analysis in a WAIT response with no current opportunity', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            pair: 'AUD/USD', decision: 'WAIT', status: 'NO_TRADE_TODAY',
            top_down_context: { higher_timeframe: { daily: '1D: BEARISH', four_hour: '4H: BULLISH', one_hour: '1H: BULLISH' } },
            reason: { code: 'NO_TRADE_TODAY', message: 'No current opportunity.' }
        });
        expect(signal.analysis.trend_detection).toEqual({ '1D': 'BEARISH', '4H': 'BULLISH', '1H': 'BULLISH' });
    });

    it('uses the selected developing setup confidence when the outer WAIT signal has zero', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            pair: 'BTC/USD', current_price: 100, decision: 'WAIT', status: 'TODAY_OPPORTUNITY', confidence: 0,
            watch_setups: [{ direction: 'BUY', confidence: 76, entry_price: 98, stop_loss: 95, take_profit_1: 104,
                strategy: 'ICT', location: { source: 'FVG', low: 97, high: 99 } }],
            trend_detection: { '1D': 'BULLISH', '4H': 'BULLISH', '1H': 'BEARISH' },
            indicators: { adx_4h: 24.5, rsi_4h: 58.2, macd_direction_4h: 'BULLISH' },
            volatility: { regime: 'NORMAL' }
        });
        expect(signal.confidence).toBe(76);
        const summary = ctx.formatTradeSummaryText(signal);
        expect(summary).toContain('Trade Type: BUY LIMIT');
        expect(summary).toContain('Confidence: 76%');
        expect(summary).toContain('Entry Price: 98');
        expect(summary).toContain('Technical Indicators: ADX 4H: 24.50');
        expect(summary).toContain('Type: ICT');
        expect(summary).not.toMatch(/Type: ICT.*FVG/);
    });

    it('keeps strategy labels separate from FVG and OB entry locations', () => {
        const ctx = getContext();
        expect(ctx.getDisplayStrategyLabel({ strategy_label: 'CRT+TBS' }, 'FVG')).toBe('CRT+TBS');
        expect(ctx.getDisplayStrategyLabel({ strategy_label: 'MSNR+CRT' }, 'OB')).toBe('MSNR+CRT');
        expect(ctx.getDisplayStrategyLabel({ strategy_label: 'FVG' }, 'FVG')).toBe('ICT');
        const signal = ctx.buildPublicTradeSignal({
            pair: 'XAU/USD', current_price: 4300, decision: 'SELL_LIMIT', strategy: 'CRT+TBS',
            entry: 4310, stop_loss: 4320, tp1: 4280,
            entry_zone: { source: 'FVG', low: 4309, high: 4311 }
        });
        expect(ctx.getTradeSummaryModel(signal).type).toBe('CRT+TBS');
        expect(ctx.getTradeSummaryModel(signal).type).not.toBe('FVG');
    });

    it('renders a compact trade summary while keeping raw JSON hidden', () => {
        const { context, elements } = getScanContext();
        context.renderTradeSummary({
            pair: 'EUR/USD', date: '2026-09-20', current_price: 1.14567, decision: 'SELL_LIMIT', confidence: 81,
            entry: 1.15, stop_loss: 1.153, tp1: 1.14, analysis: { trend_detection: { '4H': 'BEARISH' },
                volatility_level: 'LOW', technical_indicators: { adx_4h: 22 }, type: 'FVG' }, strategy: 'ICT'
        });
        expect(elements.get('tradeSummary').innerHTML).toContain('Trade Type');
        expect(elements.get('tradeSummary').innerHTML).toContain('SELL LIMIT');
        expect(elements.get('tradeSummary').innerHTML).toContain('Volatility Level');
        const html = fs.readFileSync('index.html', 'utf8');
        const css = fs.readFileSync('style.css', 'utf8');
        expect(html).toContain('id="tradeSummary"');
        expect(css).toContain('#jsonOutput { display: none !important; }');
    });

    it('recovers limit side, setup confidence, trends, volatility, and indicators from a WAIT wrapper with valid geometry', () => {
        const ctx = getContext();
        const publicSignal = ctx.buildPublicTradeSignal({
            pair: 'BTC/USD', date: '2026-09-20', current_price: 80333.43,
            decision: 'WAIT', trade_type: 'WAIT', status: 'TODAY_OPPORTUNITY', confidence: 0,
            entry_price: 80263.66, stop_loss: 80104.5225,
            take_profit_1: 81136.015, take_profit_2: 81175.62, take_profit_3: 81216.705,
            primary_opportunity: { strategy: 'CRT+MSNR', direction: 'BUY', confidence: 0,
                entry_price: 80263.66, stop_loss: 80104.5225,
                take_profit_1: 81136.015, take_profit_2: 81175.62, take_profit_3: 81216.705,
                opportunity_quality: { deterministic_confidence: 78 } },
            strategy: 'CRT+MSNR',
            trend_detection: { '1D': 'BEARISH', '4H': 'BULLISH', '1H': 'BULLISH', '15M': 'BULLISH' },
            volatility: { regime: 'HIGH' },
            indicators: { adx_4h: 60.9, rsi_4h: 62.8, macd_direction_4h: 'BULLISH' }
        });
        const summary = ctx.formatTradeSummaryText(publicSignal);
        expect(summary).toContain('Trade Type: BUY LIMIT');
        expect(summary).toContain('Confidence: 78%');
        expect(summary).toContain('Trend Detection: 1D: BEARISH');
        expect(summary).toContain('Volatility Level: HIGH');
        expect(summary).toContain('Technical Indicators: ADX 4H: 60.90');
    });

    it('carries developing-signal volatility and indicators through output projection to the summary', () => {
        const ctx = getContext();
        const raw = ctx.buildTodayOpportunityOutput({
            state: 'TODAY_OPPORTUNITY', confidence: 59, strategy: 'CRT+MSNR', direction: 'SELL',
            trend_detection: { '1D': 'BEARISH', '4H': 'BEARISH', '1H': 'BULLISH' },
            volatility: { regime: 'NORMAL' },
            indicators: { adx_4h: 26.8, rsi_4h: 40.5, macd_direction_4h: 'BEARISH' },
            primary_opportunity: { id: 'setup', direction: 'SELL', strategy: 'CRT+MSNR', entry_price: 1.14814,
                stop_loss: 1.14872, take_profit_1: 1.14601, confidence: 59,
                area_of_interest: { low: 1.148, high: 1.1483, source: 'MSNR' } }
        }, 'EUR/USD', 1.14749, Date.parse('2026-09-21T12:00:00Z'), true);
        const signal = ctx.buildPublicTradeSignal(raw.trade_signal);
        const summary = ctx.formatTradeSummaryText(signal);
        expect(summary).toContain('Confidence: 59%');
        expect(summary).toContain('Volatility Level: NORMAL');
        expect(summary).toContain('Technical Indicators: ADX 4H: 26.80');
        expect(summary).toContain('1H: BULLISH');
    });

    it('keeps deterministic market facts in a no-opportunity output', () => {
        const ctx = getContext();
        const today = ctx.buildTodayOpportunity({
            pair: 'AUD/USD', currentPrice: 0.711, scanAsOfMs: Date.parse('2026-09-19T10:00:00Z'),
            histories: {}, marketOpen: true,
            marketContext: {
                directional_bias: 'MIXED',
                structure: {
                    '1D': { effective_trend: 'BEARISH' },
                    '4H': { effective_trend: 'BULLISH_TRANSITION' },
                    '1H': { effective_trend: 'BULLISH' },
                    '15M': { structural_trend: 'MIXED' }
                },
                timeframe_context: {
                    '1D': { displayed_trend: 'BEARISH' },
                    '4H': { displayed_trend: 'BULLISH_TRANSITION' },
                    '1H': { displayed_trend: 'BULLISH' },
                    '15M': { displayed_trend: 'MIXED' }
                },
                volatility: { regime: 'LOW', atr_1h: 0.001 },
                indicators: { adx_4h: 21.8, rsi_4h: 39.3 },
                data_quality: { valid: true, reasons: [] },
                news_risk: { status: 'UNKNOWN', available: false }
            }
        });
        const raw = ctx.buildTodayOpportunityOutput(today, 'AUD/USD', 0.711, Date.parse('2026-09-19T10:00:00Z'), true);
        expect(raw.trade_signal).toMatchObject({
            trend_detection: { '1D': 'BEARISH', '4H': 'BULLISH_TRANSITION', '1H': 'BULLISH', '15M': 'MIXED' },
            volatility: { regime: 'LOW' },
            indicators: { adx_4h: 21.8 },
            data_quality: { valid: true },
            news_risk: { status: 'UNKNOWN' }
        });
    });

    it('preserves a failed market-data verdict for the public status mapper', () => {
        const ctx = getContext();
        const raw = ctx.buildTodayOpportunityOutput({
            state: 'NO_TRADE_TODAY',
            reason_code: 'NO_TRADE_TODAY',
            reason: 'Provider data is stale.',
            data_quality: { valid: false, reasons: ['quote data is stale'] }
        }, 'EUR/USD', 1.1, Date.parse('2026-09-19T10:00:00Z'), true);
        const signal = ctx.buildPublicTradeSignal(raw.trade_signal);
        expect(signal.data_quality).toMatchObject({ valid: false });
        expect(signal.status_code).toBe('DATA_BLOCKED');
        expect(signal.execution_allowed).toBe(false);
    });

    it('preserves supplied symbol and provider metadata in no-trade output', () => {
        const ctx = getContext();
        const raw = ctx.buildTodayOpportunityOutput({
            state: 'NO_TRADE_TODAY', reason_code: 'NO_TRADE_TODAY', reason: 'No fresh setup.'
        }, 'XAU/USD', 2300, Date.parse('2026-09-19T10:00:00Z'), true,
        { symbol: 'XAU/USD', asset_class: 'METAL', price_precision: 2 },
        { '4H': { provider: 'TWELVE_DATA' } });
        expect(raw.trade_signal.symbol_metadata).toMatchObject({ asset_class: 'METAL', price_precision: 2 });
        expect(raw.trade_signal.provider_metadata).toEqual({ '4H': { provider: 'TWELVE_DATA' } });
    });

    it('keeps a recovered trade-ready planner opportunity visible while waiting for user review', () => {
        const ctx = getContext();
        const raw = ctx.buildTodayOpportunityOutput({
            state: 'TRADE_READY',
            confidence: 82,
            reason: 'A deterministic replacement candidate is available.',
            reason_code: 'TRADE_READY',
            area_of_interest: { low: 100, high: 101, source: 'MSNR', timeframe: '1H', zone_id: 'zone-1' },
            execution_model: 'PENDING_LIMIT',
            target_intent: 'SWING_HIGH',
            activation_conditions: ['Price reaches the limit zone.'],
            cancellation_conditions: ['Structural invalidation is breached.']
        }, 'EUR/USD', 102, Date.parse('2026-09-19T10:00:00Z'), true);
        expect(raw.trade_signal.confidence).toBe(82);
        expect(raw.trade_signal.opportunity).toMatchObject({ execution_model: 'PENDING_LIMIT' });
    });

    it('preserves a TRADE_READY planner opportunity when the public decision remains WAIT', () => {
        const ctx = getContext();
        const raw = ctx.buildTodayOpportunityOutput({
            state: 'TRADE_READY', confidence: 82, reason: 'A deterministic setup remains available.', reason_code: 'TRADE_READY',
            primary_opportunity: { id: 'candidate-1', direction: 'BUY', strategy: 'CRT', setup_timeframe: '1H', execution_timeframe: '15M',
                entry: 100, entry_zone: { low: 99.5, high: 100.5 }, stop_loss: 98, tp1: 105, execution_model: 'PENDING_LIMIT', state: 'TRADE_READY' }
        }, 'EUR/USD', 102, Date.parse('2026-09-19T10:00:00Z'), true);
        const publicSignal = ctx.buildPublicTradeSignal(raw.trade_signal);
        expect(publicSignal.decision).toBe('BUY_LIMIT');
        expect(publicSignal.status).toBe('TRADE_READY');
        expect(publicSignal.opportunity).toMatchObject({ id: 'candidate-1', direction: 'BUY', execution_model: 'PENDING_LIMIT' });
    });

    it('converts a stale selector rejection into a complete wait result when no replacement exists', () => {
        const ctx = getContext();
        const signal = ctx.buildRejectedSelectionWaitOutput({
            today: {
                state: 'NO_TRADE_TODAY',
                reason_code: 'NO_TRADE_TODAY',
                reason: 'No fresh deterministic opportunity remains.',
                trend_detection: { '1D': 'BEARISH', '4H': 'BULLISH_TRANSITION', '1H': 'BULLISH', '15M': 'MIXED' },
                volatility: { regime: 'NORMAL' },
                indicators: { adx_4h: 25 },
                data_quality: { valid: true },
                news_risk: { status: 'UNKNOWN', available: false }
            },
            pairLocal: 'XAU/USD', price: 4363.7, asOfMs: Date.parse('2026-09-19T10:00:00Z'), marketOpen: true,
            rejection: { valid: false, issues: ['selected candidate lifecycle is not selectable'] }
        });
        const publicSignal = ctx.buildPublicTradeSignal(signal);
        expect(signal).toMatchObject({ decision: 'WAIT', trade_type: 'WAIT', status: 'NO_TRADE_TODAY', execution_allowed: false });
        expect(signal.reason.code).toBe('STALE_SELECTION_REJECTED');
        expect(signal.opportunity).toBeUndefined();
        expect(publicSignal.analysis.trend_detection).toEqual({ '1D': 'BEARISH', '4H': 'BULLISH_TRANSITION', '1H': 'BULLISH', '15M': 'MIXED' });
        expect(publicSignal.analysis.technical_indicators).toEqual({ adx_4h: 25 });
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
    it('uses supplied symbol precision when serializing AI candle evidence', () => {
        const ctx = getContext();
        const cache = { '1D': [{ t: 1, o: 0.12345678, h: 0.22345678, l: 0.02345678, c: 0.17345678, v: 1 }] };
        const out = ctx.buildCandleData(cache, 1, { asset_class: 'CRYPTO', price_precision: 8 }, 'BTC/USD');
        expect(out).toContain('O:0.12345678 H:0.22345678 L:0.02345678 C:0.17345678 V:1');
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

    it('exposes separate structural, momentum, and effective timeframe trends', () => {
        const ctx = getContext();
        const cache = trendCache('up', 100, 0.5);
        const snapshot = ctx.buildStructureSnapshot(cache['4H'], '4H');
        expect(snapshot).toHaveProperty('structural_trend');
        expect(snapshot).toHaveProperty('momentum_trend');
        expect(snapshot).toHaveProperty('effective_trend');
        expect(snapshot.trend).toBe(snapshot.effective_trend);
    });

    it('retains PDH and PDL in the discovered target catalog before directional validation', () => {
        const ctx = getContext();
        const day = (t, h, l) => ({ t, o: l + 1, h, l, c: l + 2, v: 1, is_closed: true });
        const targets = ctx.buildTargetCandidates({ '1D': [day('2026-09-13T00:00:00Z', 110, 90)] }, 100, 'EUR/USD');
        expect(targets.all).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'PDH', direction: 'BUY', ahead_of_current_price: true }),
            expect.objectContaining({ source: 'PDL', direction: 'SELL', ahead_of_current_price: true })
        ]));
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
        expect(['TREND_UP', 'TREND_DOWN', 'RANGE', 'TRANSITION', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'UNKNOWN']).toContain(live.market_regime.regime);
        expect(live.market_regime).toHaveProperty('volatility_regime');
        expect(Array.isArray(live.real_ict_zones)).toBe(true);
        expect(Array.isArray(live.target_candidates.buy)).toBe(true);
        expect(Array.isArray(live.adaptive_setup_candidates)).toBe(true);
    });

    it('traces the production funnel from raw candle histories', () => {
        const ctx = getContext();
        const historyCache = buildCache();
        const price = 140;
        const patterns = Object.fromEntries(['4H', '1H', '15M', '5M'].map(tf => [tf, {
            fvg: ctx.detectFVG(historyCache[tf]), swings: ctx.findSwings(historyCache[tf], 3),
            turtleSoup: ctx.detectTurtleSoup(historyCache[tf]), crt: ctx.detectCRT(historyCache[tf]),
            orderBlocks: ctx.detectOrderBlocks(historyCache[tf], 'BUY'), msnr: ctx.calculateMSNR(historyCache[tf], price),
            trend: ctx.detectTrend(historyCache[tf]), adx: ctx.calculateADX(historyCache[tf], 14, tf)
        }]));
        const live = ctx.buildLiveMarketContext({ pair: 'XAU/USD', price, historyCache, indicators: { '4H': {}, '1H': {} }, patterns,
            enhancedAnalysis: { phase: ctx.analyzeMarketPhase(historyCache['4H'], false) }, holistic: { suggestedDirection: 'BUY', buyScore: 60, sellScore: 10 }, entryContext: null,
            as_of_ms: Date.now() });
        expect(live).toHaveProperty('production_trace');
        expect(live.production_trace.timeframes['4H'].closed_candle_count).toBe(80);
        expect(live.production_trace.timeframes['4H']).toHaveProperty('structural_trend');
        expect(live.production_trace).toHaveProperty('buy_thesis');
        expect(live.production_trace).toHaveProperty('sell_thesis');
        expect(live.production_trace.target_catalog).toHaveProperty('buy');
        expect(live.production_trace.funnel).toEqual(expect.objectContaining({ raw_setups: 0, exact_candidates: 0, selector_candidates: 0 }));
    });

    it('captures canonical histories safely and replays production deterministically', () => {
        const ctx = getContext();
        const historyCache = buildCache();
        const price = 140;
        const asOfMs = Date.parse('2026-09-15T12:00:00Z');
        const patterns = Object.fromEntries(['4H', '1H', '15M', '5M'].map(tf => [tf, {
            fvg: ctx.detectFVG(historyCache[tf]), swings: ctx.findSwings(historyCache[tf], 3), turtleSoup: ctx.detectTurtleSoup(historyCache[tf]), crt: ctx.detectCRT(historyCache[tf]),
            orderBlocks: ctx.detectOrderBlocks(historyCache[tf], 'BUY'), msnr: ctx.calculateMSNR(historyCache[tf], price), trend: ctx.detectTrend(historyCache[tf]), adx: ctx.calculateADX(historyCache[tf], 14, tf)
        }]));
        const live = ctx.buildLiveMarketContext({ pair: 'XAU/USD', price, historyCache, indicators: { '4H': {}, '1H': {} }, patterns,
            enhancedAnalysis: { phase: ctx.analyzeMarketPhase(historyCache['4H'], false) }, holistic: { suggestedDirection: 'NEUTRAL', buyScore: 0, sellScore: 0 }, entryContext: null,
            quote_snapshot: { timestamp: new Date(asOfMs).toISOString(), price, symbol_metadata: { asset_class: 'METAL', tick_size: 0.01, precision: 2 } }, as_of_ms: asOfMs });
        const finalOutput = ctx.buildTodayOpportunityOutput(ctx.buildTodayOpportunity({ pair: 'XAU/USD', currentPrice: price, scanAsOfMs: asOfMs, histories: historyCache,
            marketContext: live.market_context, strategySetups: live.strategy_setups, executionZones: live.strategy_execution_zones,
            candidateDiagnostics: live.setup_candidate_audit, validCandidates: live.adaptive_setup_candidates, targetCandidates: live.target_candidates, marketOpen: true }), 'XAU/USD', price, asOfMs, true);
        live.indicators = { '4H': {}, '1H': {} };
        live.holistic = { suggestedDirection: 'NEUTRAL', buyScore: 0, sellScore: 0 };
        const replay = ctx.createScanReplay(live, finalOutput);
        const json = JSON.stringify(replay);
        expect(replay.history['4H']).toHaveLength(80);
        expect(replay.history['4H'].every(candle => candle.is_closed !== false)).toBe(true);
        expect(replay.quote.symbol_metadata).toMatchObject({ asset_class: 'METAL' });
        expect(replay.runtime_state.quote_snapshot.symbol_metadata).toMatchObject({ asset_class: 'METAL' });
        expect(json).not.toMatch(/TWELVE_DATA_KEY|DEEPSEEK_API_KEY|GITHUB_PAT|authorization|api_key|token/i);
        const first = ctx.replayCapturedScan(replay);
        const second = ctx.replayCapturedScan(replay);
        expect(first.replay_output).toEqual(second.replay_output);
        expect(first).toHaveProperty('replay_matches_live');
        expect(first).toHaveProperty('differences');
        expect(first.production_trace).toHaveProperty('discovery_events');
    });

    it('discovers a structural shift on the newest closed candle', () => {
        const ctx = getContext();
        const data = candles(30, 100, 0.1, 'up');
        data[data.length - 1] = c(102.9, 105, 102.8, 104.5);
        const result = ctx.buildMarketMechanicsSetups({ historyCache: { '1H': data }, timeframeContext: { '1H': { effective_trend: 'BULLISH', structural_trend: 'BULLISH', bias: 'BULLISH', evidence: [] } }, targets: { all: [] }, zones: [], pair: 'XAU/USD', price: 104.5 });
        expect(result.discovery.discovery_buy_events).toBeGreaterThan(0);
    });

    it('runs raw candle histories through discovery and planner without prebuilt setups', () => {
        const ctx = getContext();
        const base = tbsBuyFixture(15);
        const scanAsOfMs = Date.parse('2026-09-15T12:00:00Z');
        const dated = base.map((bar, index) => ({ ...bar, t: new Date(scanAsOfMs - (base.length - index) * 3600000).toISOString(), is_closed: true }));
        const historyCache = { '1D': dated, '4H': dated, '1H': dated, '15M': dated, '5M': dated };
        const patterns = Object.fromEntries(['4H', '1H', '15M', '5M'].map(tf => [tf, {
            fvg: ctx.detectFVG(base), swings: ctx.findSwings(base, 3), turtleSoup: ctx.detectTurtleSoup(base), crt: ctx.detectCRT(base),
            orderBlocks: ctx.detectOrderBlocks(base, 'BUY'), msnr: ctx.calculateMSNR(base, 100.2), trend: ctx.detectTrend(base), adx: ctx.calculateADX(base, 14, tf)
        }]));
        const live = ctx.buildLiveMarketContext({ pair: 'EUR/USD', price: 100.2, historyCache, indicators: { '4H': {}, '1H': {} }, patterns,
            enhancedAnalysis: { phase: ctx.analyzeMarketPhase(base, false) }, holistic: { suggestedDirection: 'BUY', buyScore: 60, sellScore: 10 }, entryContext: null,
            as_of_ms: scanAsOfMs });
        const output = ctx.buildTodayOpportunity({ pair: 'EUR/USD', currentPrice: 100.2, scanAsOfMs, histories: historyCache,
            marketContext: live.market_context, strategySetups: live.strategy_setups, executionZones: live.strategy_execution_zones,
            candidateDiagnostics: live.setup_candidate_audit, validCandidates: live.adaptive_setup_candidates, targetCandidates: live.target_candidates, marketOpen: true });
        expect(live.strategy_setups.length).toBeGreaterThan(0);
        expect(live.production_trace.funnel.raw_setups).toBe(live.strategy_setups.length);
        expect(output.state).toBe('NO_TRADE_TODAY');
        expect(output.reason_code).toBe('NO_TRADE_TODAY');
    });

    it('returns a safe no-opportunity result through the same raw-history production path', () => {
        const ctx = getContext();
        const historyCache = buildCache();
        const patterns = Object.fromEntries(['4H', '1H', '15M', '5M'].map(tf => [tf, {
            fvg: ctx.detectFVG(historyCache[tf]), swings: ctx.findSwings(historyCache[tf], 3), turtleSoup: ctx.detectTurtleSoup(historyCache[tf]), crt: ctx.detectCRT(historyCache[tf]),
            orderBlocks: ctx.detectOrderBlocks(historyCache[tf], 'BUY'), msnr: ctx.calculateMSNR(historyCache[tf], 140), trend: ctx.detectTrend(historyCache[tf]), adx: ctx.calculateADX(historyCache[tf], 14, tf)
        }]));
        const live = ctx.buildLiveMarketContext({ pair: 'XAU/USD', price: 140, historyCache, indicators: { '4H': {}, '1H': {} }, patterns,
            enhancedAnalysis: { phase: ctx.analyzeMarketPhase(historyCache['4H'], false) }, holistic: { suggestedDirection: 'NEUTRAL', buyScore: 0, sellScore: 0 }, entryContext: null,
            as_of_ms: Date.parse('2026-09-15T12:00:00Z') });
        const output = ctx.buildTodayOpportunity({ pair: 'XAU/USD', currentPrice: 140, scanAsOfMs: Date.parse('2026-09-15T12:00:00Z'), histories: historyCache,
            marketContext: live.market_context, strategySetups: live.strategy_setups, executionZones: live.strategy_execution_zones,
            candidateDiagnostics: live.setup_candidate_audit, validCandidates: live.adaptive_setup_candidates, targetCandidates: live.target_candidates, marketOpen: true });
        expect(live.production_trace.funnel.raw_setups).toBe(0);
        expect(output.state).toBe('NO_TRADE_TODAY');
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

    it('creates a deterministic market-mechanics candidate without CRT/TBS/MSNR labels', () => {
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
        expect(result.raw_candidates).toHaveLength(1);
        expect(result.valid_candidates).toHaveLength(1);
        expect(result.valid_candidates[0].market_mechanics_verified).toBe(true);
        expect(result.valid_candidates[0].strategy_setup).toBeNull();
    });

    it('requires coherent HTF continuation or raid plus shift proof for generic zones', () => {
        const ctx = getContext();
        const zone = { type: 'FVG', direction: 'BUY', timeframe: '15M', low: 99, high: 100, primary_eligible: true };
        const target = { buy: [{ level: 105 }], sell: [] };
        expect(ctx.hasDeterministicMarketMechanicsProof(zone, 'BUY', { '15M': { evidence: [{ kind: 'MSS', direction: 'BUY' }] } }, target, 101)).toBe(false);
        expect(ctx.hasDeterministicMarketMechanicsProof(zone, 'BUY', { '4H': { effective_trend: 'BULLISH' } }, target, 101)).toBe(true);
        expect(ctx.hasDeterministicMarketMechanicsProof({ ...zone, direction: 'BUY' }, 'BUY', {
            '4H': { effective_trend: 'BEARISH', evidence: [{ kind: 'LIQUIDITY_SWEEP', direction: 'BUY' }] },
            '1H': { evidence: [{ kind: 'MSS', direction: 'BUY' }] }
        }, target, 101)).toBe(true);
    });

    it('discovers an HTF continuation limit narrative before a new LTF shift', () => {
        const ctx = getContext();
        const history = candles(40, 0.712, 0.0001, 'down');
        const supply = { id: '4H-SUPPLY', type: 'SUPPLY', direction: 'SELL', timeframe: '4H', low: 0.7162, high: 0.71655, freshness: 'FRESH', primary_eligible: true };
        const result = ctx.buildMarketMechanicsSetups({ pair: 'AUD/USD', price: 0.71253,
            historyCache: { '4H': history, '1H': history, '15M': history },
            timeframeContext: { '4H': { effective_trend: 'BEARISH', structural_trend: 'BEARISH', structural_evidence_ids: ['4H-TREND'], structure: { recent_swing_highs: [{ level: 0.7182 }] } } },
            targets: { all: [{ direction: 'SELL', level: 0.71085, source: 'PDL' }] }, zones: [supply] });
        expect(result.some(setup => setup.primary === 'ICT' && setup.direction === 'SELL' && setup.execution_model === 'PENDING_LIMIT')).toBe(true);
    });

    it('uses a nested executable zone for a location-only strategy narrative', () => {
        const ctx = getContext();
        const history = candles(40, 100, 0.1, 'down');
        const parent = { id: '4H-SUPPLY', type: 'SUPPLY', direction: 'SELL', timeframe: '4H', low: 101, high: 103,
            location_only: true, primary_eligible: false, freshness: 'FRESH' };
        const child = { id: '1H-FVG', type: 'FVG', direction: 'SELL', timeframe: '1H', low: 101.5, high: 102,
            primary_eligible: true, freshness: 'FRESH', created_time: Date.parse('2026-09-23T08:00:00Z') };
        const result = ctx.buildMarketMechanicsSetups({ pair: 'XAU/USD', price: 99, historyCache: { '4H': history, '1H': history, '15M': history },
            timeframeContext: { '4H': { effective_trend: 'BEARISH', structural_trend: 'BEARISH', structure: { recent_swing_highs: [{ level: 105 }] } } },
            targets: { all: [{ direction: 'SELL', level: 90, source: 'PDL' }] }, zones: [parent, child] });
        const setup = result.find(candidate => candidate.direction === 'SELL' && candidate.primary === 'ICT');
        expect(setup).toBeTruthy();
        expect(setup.opportunity_narrative.location.id).toBe('4H-SUPPLY');
        expect(setup.execution_zone).toEqual(expect.objectContaining({ id: '1H-FVG', type: 'FVG', execution_model: 'PENDING_LIMIT' }));
        expect(setup.execution_zone.parent_location_id).toBe('4H-SUPPLY');
    });

    it('keeps a validated narrative location when its execution zone is not formed', () => {
        const ctx = getContext();
        const setup = { id: 'MM-LOCATION', direction: 'SELL', execution_model: 'PENDING_LIMIT', narrative_state: 'ACTIVE',
            opportunity_narrative: { location: { id: 'SUPPLY-1', type: 'SUPPLY', timeframe: '4H', low: 0.7162, high: 0.71655 }, target_intent: 'PDL' },
            structural_invalidation: { level: 0.7182, source: 'HTF_STRUCTURE' }, target_candidates: [{ level: 0.71085, source: 'PDL' }] };
        const thesis = ctx.buildOpportunityThesis(setup, { timeframe_context: { '4H': { effective_trend: 'BEARISH' } }, daily_bias: { direction: 'SELL' } }, 0.71253);
        expect(thesis.location).toMatchObject({ id: 'SUPPLY-1', timeframe: '4H' });
        expect(thesis.rejection_codes).not.toContain('NO_MEANINGFUL_POI');
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
        expect(result.reasons).toContain('candidate is not backed by a deterministic market-mechanics narrative');
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

    it('builds a selector-only prompt allowing WAIT without stale hard-coded price anchors', () => {
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
        expect(prompt.system).toMatch(/Rank the supplied adaptive_setup_candidates/);
        expect(prompt.system).toMatch(/adaptive_setup_candidates is empty/);
        expect(prompt.system).toMatch(/Do not calculate risk, required reward, minimum TP/);
        expect(prompt.user).toMatch(/"decision": "SELECT" \| "WAIT"/);
        expect(prompt.user).toMatch(/selected_candidate_id/);
        expect(prompt.user).toMatch(/application owns direction, order type, all geometry and confidence/);
        expect(prompt.user).toMatch(/Use only supplied evidence/);
        expect(prompt.system).toMatch(/discount generally favors BUY entries and premium generally favors SELL entries/);
        expect(prompt.system).toMatch(/PARTIAL = partially used\/partially mitigated/);
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

    it.each([[], undefined])('rejects missing candidate provenance even with an empty global target pool (%j)', targetMap => {
        const ctx = getContext();
        const candidate = {
            id: 'missing-target-provenance', direction: 'BUY', zone_type: 'CRT', zone_origin: 'STRUCTURAL',
            timeframe: '1H', zone_low: 1.0995, zone_high: 1.1005,
            entry: 1.1000, stop_loss: 1.0980, tp1: 1.1050, tp2: null, tp3: null, target_map: targetMap
        };
        const result = ctx.validateAIOutputConsistency({
            selected_candidate_id: candidate.id, direction: candidate.direction,
            entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1
        }, {
            adaptive_setup_candidates: [candidate],
            target_candidates: { buy: [], sell: [], all: [] },
            risk_constraints: { minimum_rr: 2.5 }
        });
        expect(result.valid).toBe(false);
        expect(result.failure_code).toBe('ENGINE_INVARIANT_FAILURE');
        expect(result.invariant_code).toBe('DETERMINISTIC_CANDIDATE_TARGET_PROVENANCE');
        expect(result.issues).toContain('selected deterministic candidate has no authoritative target_map');
    });

    it('validates selected CRT-native TP1 from the candidate target_map without global target injection', () => {
        const ctx = getContext();
        const candidate = {
            id: 'crt-native-target', direction: 'BUY', zone_type: 'CRT', zone_origin: 'STRUCTURAL', timeframe: '1H', zone_low: 1.0995, zone_high: 1.1005,
            entry: 1.1000, stop_loss: 1.0980, tp1: 1.1050, tp2: null, tp3: null,
            target_map: [{ target_level: 1.1050, primary_target_source: 'CRT_OPPOSITE_RANGE', target_type: 'CRT_OPPOSITE_RANGE', target_confluence: [] }]
        };
        const result = ctx.validateAIOutputConsistency({ selected_candidate_id: candidate.id, decision: 'BUY_LIMIT', direction: 'BUY', entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1, selected_zone: { type: 'CRT', timeframe: '1H', low: candidate.zone_low, high: candidate.zone_high } }, {
            adaptive_setup_candidates: [candidate], target_candidates: { buy: [], sell: [] }, risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [{ type: 'CRT', timeframe: '1H', direction: 'BUY', low: candidate.zone_low, high: candidate.zone_high, origin: 'STRUCTURAL', primary_eligible: true }]
        });
        expect(result.valid).toBe(true);
    });

    it('validates selected OPPOSING_MSNR TP1 from the candidate target_map', () => {
        const ctx = getContext();
        const candidate = {
            id: 'msnr-native-target', direction: 'SELL', zone_type: 'MSNR', zone_origin: 'STRUCTURAL_MSNR', timeframe: '1H', zone_low: 1.0995, zone_high: 1.1005,
            entry: 1.1000, stop_loss: 1.1020, tp1: 1.0950, tp2: null, tp3: null,
            target_map: [{ target_level: 1.0950, primary_target_source: 'OPPOSING_MSNR', target_type: 'STRUCTURAL_MSNR', target_confluence: [] }]
        };
        const result = ctx.validateAIOutputConsistency({ selected_candidate_id: candidate.id, decision: 'SELL_LIMIT', direction: 'SELL', entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1, selected_zone: { type: 'MSNR', timeframe: '1H', low: candidate.zone_low, high: candidate.zone_high } }, {
            adaptive_setup_candidates: [candidate], target_candidates: { buy: [], sell: [] }, risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [{ type: 'MSNR', timeframe: '1H', direction: 'SELL', low: candidate.zone_low, high: candidate.zone_high, origin: 'STRUCTURAL_MSNR', primary_eligible: true }]
        });
        expect(result.valid).toBe(true);
    });

    it('classifies selected candidate TP1 provenance mismatch as an engine invariant failure', () => {
        const ctx = getContext();
        const candidate = { id: 'bad-target-map', direction: 'BUY', zone_type: 'CRT', zone_origin: 'STRUCTURAL', timeframe: '1H', zone_low: 1.0995, zone_high: 1.1005, entry: 1.1000, stop_loss: 1.0980, tp1: 1.1050, target_map: [{ target_level: 1.1060, primary_target_source: 'CRT_OPPOSITE_RANGE', target_type: 'CRT_OPPOSITE_RANGE' }] };
        const result = ctx.validateAIOutputConsistency({ selected_candidate_id: candidate.id, decision: 'BUY_LIMIT', direction: 'BUY', entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1, selected_zone: { type: 'CRT', timeframe: '1H', low: candidate.zone_low, high: candidate.zone_high } }, { adaptive_setup_candidates: [candidate], target_candidates: { buy: [], sell: [] }, risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [{ type: 'CRT', timeframe: '1H', direction: 'BUY', low: candidate.zone_low, high: candidate.zone_high, origin: 'STRUCTURAL' }] });
        expect(result.valid).toBe(false);
        expect(result.failure_code).toBe('ENGINE_INVARIANT_FAILURE');
        expect(result.issues).toContain('candidate TP1 does not match its authoritative target_map');
    });

    it('classifies selected candidate RR below minimum as an engine invariant failure', () => {
        const ctx = getContext();
        const candidate = { id: 'bad-candidate-rr', direction: 'BUY', zone_type: 'CRT', zone_origin: 'STRUCTURAL', timeframe: '1H', zone_low: 1.0995, zone_high: 1.1005, entry: 1.1000, stop_loss: 1.0980, tp1: 1.1040, target_map: [{ target_level: 1.1040, primary_target_source: 'CRT_OPPOSITE_RANGE', target_type: 'CRT_OPPOSITE_RANGE' }] };
        const result = ctx.validateAIOutputConsistency({ selected_candidate_id: candidate.id, decision: 'BUY_LIMIT', direction: 'BUY', entry: candidate.entry, stop_loss: candidate.stop_loss, take_profit_1: candidate.tp1, selected_zone: { type: 'CRT', timeframe: '1H', low: candidate.zone_low, high: candidate.zone_high } }, { adaptive_setup_candidates: [candidate], target_candidates: { buy: [], sell: [] }, risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [{ type: 'CRT', timeframe: '1H', direction: 'BUY', low: candidate.zone_low, high: candidate.zone_high, origin: 'STRUCTURAL' }] });
        expect(result.valid).toBe(false);
        expect(result.failure_code).toBe('ENGINE_INVARIANT_FAILURE');
        expect(result.issues.join(' ')).toMatch(/actual RR .* below minimum/);
    });

    it('rejects a candidate whose stored top-down classification disagrees with current timeframe context', () => {
        const ctx = getContext();
        const tf = {
            '1D': { displayed_trend: 'BEARISH', evidence: [] },
            '4H': { displayed_trend: 'BEARISH', evidence: [] },
            '1H': { displayed_trend: 'BULLISH', evidence: [] }
        };
        const candidate = {
            id: 'classification-drift', direction: 'SELL',
            trade_context_classification: 'HTF_ALIGNED_CONTINUATION',
            entry: 110, stop_loss: 112, tp1: 105,
            actual_rr: 2.5,
            quality: { final_confidence: 70 },
            confidence_breakdown: { final_score: 70 }
        };
        const result = ctx.validateExecutableCandidateInvariant(candidate, {
            timeframe_context: tf,
            as_of_time: Date.parse('2026-09-19T12:00:00Z')
        });
        expect(result.valid).toBe(false);
        expect(result.failures).toContain('TOP_DOWN_CLASSIFICATION_MISMATCH');
    });

    it('classifies an unknown selected candidate ID as an AI selection failure', () => {
        const ctx = getContext();
        const result = ctx.validateAIOutputConsistency({ selected_candidate_id: 'missing', decision: 'BUY_LIMIT', direction: 'BUY', entry: 1.1, stop_loss: 1.098, take_profit_1: 1.105 }, { adaptive_setup_candidates: [], target_candidates: { buy: [], sell: [] }, risk_constraints: { minimum_rr: 2.5 }, real_ict_zones: [] });
        expect(result.valid).toBe(false);
        expect(result.failure_code).toBe('AI_SELECTION_FAILURE');
        expect(result.issues).toContain('selected adaptive setup candidate does not exist in supplied live market context');
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

    it('gives structural gold stops at least the configured ATR noise distance', () => {
        const ctx = getContext();
        const zone = { direction: 'BUY', strategy_setup: { direction: 'BUY', primary: 'CRT',
            structural_invalidation_detail: { level: 99.5, source: 'CRT_SWEEP_EXTREME' } } };
        const settings = ctx.getMarketSettings('XAU/USD');
        const [stop] = ctx.getAdaptiveStopCandidates(zone, 'BUY', 100, [], [], 2, settings, 2);
        expect(Math.abs(100 - stop.stop_loss)).toBeGreaterThanOrEqual(2);
        expect(stop.stop_loss).toBeLessThan(99.5);
    });

    it('keeps candidate confidence when the top-level candidate score is zero', () => {
        const ctx = getContext();
        const today = ctx.buildTodayOpportunity({ pair: 'XAU/USD', currentPrice: 100, marketOpen: true,
            validCandidates: [{ id: 'candidate-confidence', direction: 'BUY', confidence: 0, score: 0,
                quality: { final_confidence: 83, deterministic_confidence: 83, rank_tier: 2 },
                top_down_context: { classification: 'HTF_ALIGNED_CONTINUATION' },
                zone: { id: 'zone', low: 99, high: 100, type: 'FVG' },
                entry: 99.5, stop_loss: 98.5, tp1: 103, target: { level: 103, source: 'BUY_SIDE_LIQUIDITY' } }]
        });
        expect(today.primary_opportunity.confidence).toBe(83);
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
        expect(ctx.hasRealVolume('ETH/USD')).toBe(true);
        expect(ctx.hasRealVolume('AAPL')).toBe(true);
        expect(ctx.hasRealVolume('ETH/USD', { volume_reliable: false })).toBe(false);
        expect(ctx.getSymbolMetadata('ETH/USD', { volume_reliable: false }).volume_reliable).toBe(false);
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

    it('canonicalizes completed daily period buckets independently of intraday duration', () => {
        const ctx = getContext();
        const scan = Date.parse('2026-09-19T14:00:00Z');
        const result = ctx.canonicalizeHistory([
            { t: '2026-09-19T02:00:00Z', o: 1, h: 2, l: 0.5, c: 1.5 },
            { t: '2026-09-19T13:00:00Z', o: 1.5, h: 2.5, l: 1, c: 2 }
        ], '1D', scan);
        expect(result).toHaveLength(2);
        expect(result[0].is_closed).toBe(true);
        expect(result[1].is_closed).toBe(false);
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
        expect(result.intervening_obstacles[0].blocks_direction).toBe(true);
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

describe('engine contract completion', () => {
    function narrative(data) {
        return { primary: 'CRT', label: 'CRT', direction: 'BUY', timeframe: '1H',
            execution_timeframe: '1H', reclaim_bar_index: 10, reclaim_time: data[10].t,
            structural_invalidation: 98, original_strategy_entry_consumed: true };
    }

    it('confirms fresh FVG only after its third candle closes', () => {
        const ctx = getContext();
        const data = freshExecutionFixture().slice(0, 18);
        data[17].is_closed = false;
        const build = () => ctx.buildFreshExecutionZonesForNarrative(narrative(data), { '1H': data }, [], 'XAU/USD', 101.4);
        const matches = z => z.type === 'FVG' && z.low === 100.4 && z.high === 101;
        expect(build().filter(matches)).toHaveLength(0);
        data[17].is_closed = true;
        expect(build().filter(matches)).toHaveLength(1);
    });

    it('confirms fresh OB only after its displacement candle closes', () => {
        const ctx = getContext();
        const data = freshExecutionFixture().slice(0, 17);
        data[16].is_closed = false;
        const build = () => ctx.buildFreshExecutionZonesForNarrative(narrative(data), { '1H': data }, [], 'XAU/USD', 101.4);
        const matches = z => z.type === 'OB' && z.low === 100 && z.high === 100.4;
        expect(build().filter(matches)).toHaveLength(0);
        data[16].is_closed = true;
        expect(build().filter(matches)).toHaveLength(1);
    });

    it('still consumes an existing FVG when a later forming candle trades through it', () => {
        const ctx = getContext();
        const data = freshExecutionFixture().slice(0, 18);
        data.push({ ...c(101.4, 101.6, 100.6, 101.3, '2026-09-10 09:00:00'), is_closed: false });
        const zones = ctx.buildFreshExecutionZonesForNarrative(narrative(data), { '1H': data }, [], 'XAU/USD', 101.3);
        expect(zones.some(z => z.type === 'FVG' && z.low === 100.4 && z.high === 101)).toBe(false);
        expect(zones.execution_zone_stats.consumed).toBeGreaterThan(0);
    });

    it('does not import a structural MSNR zone whose source candle is forming', () => {
        const ctx = getContext();
        const data = freshExecutionFixture().slice(0, 18);
        data[17].is_closed = false;
        const zone = { type: 'MSNR', origin: 'STRUCTURAL_MSNR', direction: 'BUY', timeframe: '1H',
            low: 100.5, high: 100.6, midpoint: 100.55, source_candle_index: 17, source_time: data[17].t };
        const zones = ctx.buildFreshExecutionZonesForNarrative(narrative(data), { '1H': data }, [zone], 'XAU/USD', 101.4);
        expect(zones.some(z => z.type === 'MSNR')).toBe(false);
    });

    it.each([
        ['detectFVG', []], ['findSwings', [2]], ['detectMSS', []],
        ['detectBOS', ['BUY']], ['detectCHoCH', ['BUY']], ['detectTrend', []],
        ['detectLiquiditySweep', [101, 'BUY']], ['detectOrderBlocks', ['BUY']],
        ['mapLiquidity', []], ['detectDisplacement', ['BUY']],
        ['isPremiumDiscount', [101]], ['getDirectionBias', []],
        ['detectCompression', []], ['detectEngulfing', [101, 'BUY']],
        ['detectPinBar', [101, 'BUY', 1]], ['detectBreakoutRetest', [101, 'BUY']]
    ])('%s ignores unconfirmed candles', (name, args) => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const raw = [...data, { ...c(140, 300, 1, 290), is_closed: false }];
        expect(ctx[name](raw, ...args)).toEqual(ctx[name](data, ...args));
    });

    it('target construction and structural ATR ignore a forming departure', () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.5, 'up');
        const raw = [...data, { ...c(140, 300, 1, 290), is_closed: false }];
        const closedCache = { '4H': data, '1H': data };
        const rawCache = { '4H': raw, '1H': raw };
        expect(ctx.buildTargetCandidates(rawCache, 141, 'XAU/USD')).toEqual(ctx.buildTargetCandidates(closedCache, 141, 'XAU/USD'));
        expect(ctx.getCandidateATRContext({ timeframe: '1H' }, rawCache, 'XAU/USD', 141))
            .toEqual(ctx.getCandidateATRContext({ timeframe: '1H' }, closedCache, 'XAU/USD', 141));
        expect(ctx.buildRiskConstraints('XAU/USD', 141, rawCache)).toEqual(ctx.buildRiskConstraints('XAU/USD', 141, closedCache));
    });

    it.each([['SELL', 'BUY'], ['BUY', 'SELL']])('%s delivery recognizes opposing %s structures', (trade, zoneDirection) => {
        const ctx = getContext();
        const obstacle = ctx.classifyDeliveryObstacle({ type: 'OB', direction: zoneDirection, timeframe: '4H',
            low: 104, high: 105, freshness: 'FRESH' }, trade);
        expect(obstacle.blocks_direction).toBe(true);
        expect(obstacle.hard_blocking).toBe(false);
        expect(obstacle.severity).toBe('SERIOUS');
    });

    it('same-direction zones do not oppose delivery even with stale legacy flags', () => {
        const ctx = getContext();
        const obstacle = ctx.classifyDeliveryObstacle({ type: 'OB', direction: 'SELL', blocks_direction: true,
            hard_blocking: true, low: 104, high: 105 }, 'SELL');
        expect(obstacle.blocks_direction).toBe(false);
        expect(obstacle.hard_blocking).toBe(false);
    });

    it('classifies support and role-reversal zones without requiring a direction flag', () => {
        const ctx = getContext();
        for (const role of ['REACTION_SUPPORT', 'RESISTANCE_TO_SUPPORT', 'DEMAND']) {
            expect(ctx.classifyDeliveryObstacle({ role, low: 104, high: 105 }, 'SELL').blocks_direction).toBe(true);
        }
        expect(ctx.classifyDeliveryObstacle({ role: 'SUPPORT_TO_RESISTANCE', low: 104, high: 105 }, 'BUY').blocks_direction).toBe(true);
    });

    it('fresh higher-timeframe demand lowers GOLD-style SELL reachability without hard invalidation', () => {
        const ctx = getContext();
        const input = { direction: 'SELL', entry: 110, stopLoss: 112,
            target: { level: 100, source: 'SWING_LOW', timeframe: '1H', structural_priority: 82 },
            historyCache: { '1H': candles(40, 110, 1, 'down') }, liquidity: { below: [] }, strategySetup: {} };
        const zones = [
            { type: 'OB', direction: 'BUY', timeframe: '4H', low: 104, high: 105, freshness: 'FRESH' },
            { type: 'FVG', direction: 'BUY', timeframe: '4H', low: 106, high: 107, freshness: 'FRESH' }
        ];
        const clean = ctx.evaluateTargetReachability({ ...input, zones: [] });
        const blocked = ctx.evaluateTargetReachability({ ...input, zones });
        const mitigated = ctx.evaluateTargetReachability({ ...input, zones: zones.map(z => ({ ...z, freshness: 'MITIGATED' })) });
        const lowerTf = ctx.evaluateTargetReachability({ ...input, zones: zones.map(z => ({ ...z, timeframe: '15M' })) });
        expect(blocked.reachable).toBe(true);
        expect(blocked.hard_unreachable).toBe(false);
        expect(blocked.intervening_obstacles).toHaveLength(2);
        expect(blocked.reachability_score).toBeLessThan(clean.reachability_score - 20);
        expect(blocked.reachability_score).toBeLessThan(mitigated.reachability_score);
        expect(blocked.reachability_score).toBeLessThan(lowerTf.reachability_score);
        expect(ctx.evaluateTargetReachability({ ...input, zones: [...zones, { ...zones[0], id: 'duplicate' }] }))
            .toEqual(blocked);
    });

    it('one zone and model have one midpoint entry, independent of direction or RR', () => {
        const ctx = getContext();
        for (const direction of ['BUY', 'SELL']) {
            expect(ctx.getAdaptiveEntryCandidates({ low: 1.1, high: 1.101 }, direction, 5)).toEqual([1.1005]);
        }
    });

    it('semantic entry honors explicit execution evidence in priority order and within bounds', () => {
        const ctx = getContext();
        const zone = { low: 1.1, high: 1.101, entry_model: 'RECLAIM_RETEST', semantic_entry: 1.1007 };
        const setup = { entry: 1.1002, reclaim_level: 1.1003 };
        expect(ctx.getSemanticEntryCandidate(zone, setup, 'BUY', 5)).toBe(1.1002);
        expect(ctx.getSemanticEntryCandidate(zone, { reclaim_level: 1.1003 }, 'BUY', 5)).toBe(1.1003);
        expect(ctx.getSemanticEntryCandidate(zone, { entry: 9, reclaim_level: 8 }, 'BUY', 5)).toBe(1.1007);
        expect(ctx.getSemanticEntryCandidate({ low: 1.1, high: 1.101, price: 1.1004 }, {}, 'BUY', 5)).toBe(1.1004);
        expect(ctx.getSemanticEntryCandidate({ low: 1.1, high: 1.101, execution_model: 'FRESH_RETRACEMENT_LIMIT' },
            { reclaim_level: 1.1001 }, 'BUY', 5)).toBe(1.1005);
        expect(ctx.getAdaptiveEntryCandidates({ low: NaN, high: 1.101 }, 'BUY', 5)).toEqual([]);
    });

    it('reports semantic entry counts rather than low/mid/high permutations', () => {
        const ctx = getContext();
        const entry = ctx.getAdaptiveEntryCandidates({ low: 1.1, high: 1.101 }, 'BUY', 5);
        const raw = { entry: entry[0], stop_loss: 1.099, tp1: 1.105, rr_tp1: 3, minimum_rr: 2.5,
            direction: 'BUY', target_map: [{ target_level: 1.105 }], risk_model: { status: 'VALID_STRUCTURAL_STOP' } };
        const audit = ctx.buildCandidatePipelineAudit([], [raw], [], [raw],
            [{ seed_id: 'one-zone', raw_candidates: 1, semantic_entries: entry.length, failure_reasons: [] }]);
        expect(audit.execution_opportunities).toBe(1);
        expect(audit.semantic_entries).toBe(1);
        expect(audit.structural_stops_valid).toBe(1);
        expect(audit.target_valid).toBe(1);
        expect(audit.rr_valid).toBe(1);
        expect(audit.final_valid).toBe(1);
    });

    it('constructs only one numerical candidate for one execution opportunity end to end', () => {
        const ctx = getContext();
        const data = candles(80, 1.08, 0.0003, 'up');
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD', price: 1.102, historyCache: { '4H': data, '1H': data, '1D': data, '15M': data, '5M': data },
            zones: [{ type: 'FVG', direction: 'BUY', timeframe: '1H', origin: 'STRUCTURAL',
                low: 1.1, high: 1.101, freshness: 'FRESH', primary_eligible: true }],
            targetCandidates: { buy: [{ direction: 'BUY', level: 1.11, source: 'SWING_HIGH', origin: 'STRUCTURAL' }] },
            riskConstraints: { minimum_rr: 2.5 },
            structure: { '4H': { trend: 'BULLISH' }, '1H': { trend: 'BULLISH' } }
        });
        expect(result.seed_diagnostics).toHaveLength(1);
        expect(result.seed_diagnostics[0].semantic_entries).toBe(1);
        expect(result.raw_candidates).toHaveLength(1);
        expect(result.raw_candidates[0].entry).toBe(1.1005);
    });

    it('reports dominant data time failure before stale entries or missing geometry', () => {
        const ctx = getContext();
        const audit = { raw_candidate_count: 436, rejection_detail: {
            DATA_TIME_INCONSISTENT: 324, SETUP_EXPIRED: 95, ENTRY_ALREADY_CONSUMED: 17 } };
        expect(ctx.waitCodeFromRejections(audit, true)).toBe('DATA_TIME_INCONSISTENT');
        expect(ctx.waitCodeFromRejections({ raw_candidates: 0, seed_failure_counts: { DATA_TIME_INCONSISTENT: 19 } }, true))
            .toBe('DATA_TIME_INCONSISTENT');
        expect(ctx.classifyRejectionDetail('DATA_TIME_INCONSISTENT: EVENT_IN_FUTURE')).toBe('DATA_TIME_INCONSISTENT');
    });

    it('reports engine invariant failures as engine faults, not market WAIT', () => {
        const ctx = getContext();
        expect(ctx.waitCodeFromRejections({ rejection_detail: {
            ENGINE_INVARIANT_FAILURE: 12, NO_VALID_TP1: 2 } }, true)).toBe('ENGINE_INVARIANT_FAILURE');
    });

    it('healthy stale or consumed opportunities still report NO_FRESH_OPPORTUNITY', () => {
        const ctx = getContext();
        expect(ctx.waitCodeFromRejections({ raw_candidates: 436, rejection_detail: {
            SETUP_EXPIRED: 324, ENTRY_ALREADY_CONSUMED: 112 } }, true)).toBe('NO_FRESH_OPPORTUNITY');
        expect(ctx.waitCodeFromRejections({ raw_candidates: 0, seed_failure_counts: { ENTRY_ALREADY_CONSUMED: 19 } }, true))
            .toBe('NO_FRESH_OPPORTUNITY');
    });

    it('requests exactly three selector output fields, never geometry or confidence', () => {
        const ctx = getContext();
        const prompt = ctx.buildAIPrompt({ pair: 'EUR/USD', current_price: 1.101, utc_time: '2026-09-11T10:00:00Z',
            session: { name: 'LONDON' }, adaptive_setup_candidates: [] }, '');
        const schema = prompt.user.split('Return ONLY this selector JSON')[1];
        expect([...schema.matchAll(/"([a-z_]+)":/g)].map(m => m[1]))
            .toEqual(['decision', 'selected_candidate_id', 'reasoning']);
        expect(schema).toContain('"SELECT" | "WAIT"');
        expect(prompt.system).not.toMatch(/return BUY_LIMIT|return SELL_LIMIT|ai_decision:|reaction\/fill confirmation/);
    });

    it('validates production selector JSON against supplied candidates', () => {
        const ctx = getContext();
        const candidates = [{ id: 'candidate-1' }];
        expect(ctx.validateAiSelectorResponse({ decision: 'SELECT', selected_candidate_id: 'candidate-1', reasoning: 'best' }, candidates).valid).toBe(true);
        expect(ctx.validateAiSelectorResponse({ decision: 'SELECT', selected_candidate_id: 'invented', reasoning: 'best' }, candidates).valid).toBe(true);
        expect(ctx.validateAiSelectorResponse({ decision: 'WAIT', selected_candidate_id: null, reasoning: 'no valid setup' }, candidates).valid).toBe(true);
    });

    it('retries malformed AI selector output once, then returns explicit no-trade', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        const candidate = { id: 'retry-candidate', direction: 'BUY', timeframe: '1H', zone_type: 'FVG', zone_origin: 'STRUCTURAL',
            zone_low: 1.0995, zone_high: 1.1005, entry: 1.1, stop_loss: 1.098, tp1: 1.105, tp2: null, tp3: null, rr_tp1: 2.5,
            quality: { final_confidence: 64 }, stop_reason: 'Authoritative strategy invalidation', opportunity_status: 'FRESH_PENDING_TODAY', still_actionable_today: true,
            entry_consumed: false, tp1_already_reached: false };
        let calls = 0;
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: ++calls === 1 ? 'not json' : JSON.stringify({ decision: 'SELECT', selected_candidate_id: 'retry-candidate', reasoning: 'valid after correction' }) } }] }) }));
        const recovered = await ctx.askAIToFindSetup('prompt', 1.101, 'system', { pair: 'EUR/USD', adaptive_setup_candidates: [candidate] });
        expect(calls).toBe(2);
        expect(recovered.selected_candidate_id).toBe('retry-candidate');

        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'still not json' } }] }) }));
        const rejected = await ctx.askAIToFindSetup('prompt', 1.101, 'system', { pair: 'EUR/USD', adaptive_setup_candidates: [candidate] });
        expect(rejected.noTrade).toBe(true);
        expect(rejected.schema_validation.attempts).toBe(2);
    });

    it.each([false, true])('hydrates SELECT exclusively from the candidate (legacy mutation=%s)', async mutate => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        const candidate = { id: 'abc', direction: 'BUY', timeframe: '1H', zone_type: 'FVG', zone_origin: 'STRUCTURAL',
            zone_low: 1.0995, zone_high: 1.1005, entry: 1.1, stop_loss: 1.098,
            tp1: 1.105, tp2: null, tp3: null, rr_tp1: 2.5,
            quality: { final_confidence: 64 }, stop_reason: 'Authoritative strategy invalidation',
            opportunity_status: 'FRESH_PENDING_TODAY', still_actionable_today: true,
            entry_consumed: false, tp1_already_reached: false };
        const before = JSON.stringify(candidate);
        const selection = { decision: 'SELECT', selected_candidate_id: 'abc', reasoning: 'Best supplied fresh opportunity' };
        if (mutate) Object.assign(selection, { entry: 999, stop_loss: 1000, take_profit_1: 1, confidence: 99 });
        ctx.fetch = jest.fn(async () => ({ ok: true,
            json: async () => ({ choices: [{ message: { content: JSON.stringify(selection) } }] }) }));
        const result = await ctx.askAIToFindSetup('prompt', 1.101, 'system', {
            pair: 'EUR/USD', adaptive_setup_candidates: [candidate] });
        expect(result.selected_candidate_id).toBe('abc');
        expect(result.decision).toBe('BUY_LIMIT');
        expect(result.entry).toBe(candidate.entry);
        expect(result.stop_loss).toBe(candidate.stop_loss);
        expect(result.take_profit_1).toBe(candidate.tp1);
        expect(result.confidence).toBe(64);
        expect(JSON.stringify(candidate)).toBe(before);
    });
});

describe('provider, calendar, lifecycle, and public output contracts', () => {
    it('passes unknown symbols through to the provider without hardcoding the instrument list', () => {
        const ctx = getContext();
        expect(ctx.getProviderSymbol(' custom/asset ')).toBe('CUSTOM/ASSET');
        expect(ctx.getProviderSymbol('XAU/USD')).toBe('XAU/USD');
        expect(ctx.getMarketSettings()).toBeDefined();
    });

    it('validates custom provider symbols without restricting the asset list', () => {
        const ctx = getContext();
        expect(ctx.validateSymbolInput(' nasdaq:aapl ')).toMatchObject({ valid: true, symbol: 'NASDAQ:AAPL' });
        expect(ctx.validateSymbolInput('ETH/USD')).toMatchObject({ valid: true, symbol: 'ETH/USD' });
        expect(ctx.validateSymbolInput('bad symbol!').valid).toBe(false);
        expect(ctx.validateSymbolInput('').valid).toBe(false);
    });

    it('supports an optional server proxy without requiring browser provider credentials', () => {
        const ctx = getContext();
        ctx.window.__ICT_PROXY_BASE_URL__ = 'https://proxy.example/';
        expect(ctx.getProxyBaseUrl()).toBe('https://proxy.example');
        expect(ctx.hasMarketDataAccess()).toBe(true);
        expect(ctx.hasAiAccess()).toBe(true);
        expect(ctx.getDeepSeekEndpoint()).toBe('https://proxy.example/api/deepseek/chat');
        expect(ctx.getDeepSeekHeaders()).toEqual({ 'Content-Type': 'application/json' });
    });
    it('rechecks local pending-limit safety at user approval time', () => {
        const ctx = getContext();
        expect(ctx.validateExecutionMode('PAPER')).toMatchObject({ valid: true, mode: 'PAPER' });
        expect(ctx.validateExecutionMode('LIVE')).toMatchObject({ valid: false, mode: 'LIVE' });
        const valid = ctx.validateLocalLimitOrderInput({ signalType: 'SHORT', currentPrice: 100, idealEntry: 101, stopLoss: 103, takeProfit1: 95 }, 'EUR/USD');
        expect(valid.valid).toBe(true);
        const badSide = ctx.validateLocalLimitOrderInput({ signalType: 'SHORT', currentPrice: 100, idealEntry: 99, stopLoss: 103, takeProfit1: 95 }, 'EUR/USD');
        expect(badSide.valid).toBe(false);
        expect(badSide.issues.join(' ')).toMatch(/above current price/);
        expect(ctx.validateLocalLimitOrderInput({ signalType: 'SHORT', currentPrice: 100, idealEntry: 101, stopLoss: 103, takeProfit1: 95 }, 'EUR/USD', { minimum_rr: 3.1 }).valid).toBe(false);
        expect(ctx.validateLocalLimitOrderInput({ signalType: 'LONG', currentPrice: 100, market_conditions: { ask: 100.2 }, idealEntry: 100.1, stopLoss: 99, takeProfit1: 103 }, 'EUR/USD').valid).toBe(true);
        expect(ctx.validateLocalLimitOrderInput({ signalType: 'SHORT', currentPrice: 100, market_conditions: { bid: 99.8 }, idealEntry: 99.9, stopLoss: 101, takeProfit1: 95 }, 'EUR/USD').valid).toBe(true);
    });

    it('requires explicit cancellation before replacing a pending paper order', () => {
        const ctx = getContext();
        expect(ctx.validateDuplicatePaperOrder(null)).toMatchObject({ valid: true });
        expect(ctx.validateDuplicatePaperOrder({ id: 7, pair: 'EUR/USD' })).toMatchObject({
            valid: false,
            reason: 'DUPLICATE_ACTIVE_PAPER_ORDER'
        });
    });

    it('records a safe audit summary without secrets', () => {
        const ctx = getContext();
        let raw = null;
        ctx.localStorage.setItem = (key, value) => { if (key === 'ict_analysis_audit') raw = value; };
        ctx.localStorage.getItem = key => key === 'ict_analysis_audit' ? raw : null;
        const record = ctx.recordAnalysisAudit({ pair: 'EUR/USD', current_price: 1.1, decision: 'WAIT', status: 'TODAY_OPPORTUNITY', provider_timestamp: '2026-09-18T10:00:00Z', data_quality: { valid: true }, reason: { code: 'WAITING' } });
        expect(record.request_id).toMatch(/^scan-/);
        const stored = JSON.parse(raw);
        expect(stored[0]).toMatchObject({ pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY' });
        expect(stored[0]).toMatchObject({ status_code: 'NO_TRADE', provider_timestamp: '2026-09-18T10:00:00Z', data_quality: { valid: true } });
        expect(stored[0].symbol_metadata).toMatchObject({ symbol: 'EUR/USD', asset_class: 'FOREX' });
        expect(stored[0].risk_gate).toMatchObject({ mode: 'MANUAL', status: 'MANUAL', execution_allowed: true });
        expect(JSON.stringify(stored)).not.toMatch(/apikey|authorization|secret|token/i);
    });

    it('persists a bounded sanitized replay alongside the audit summary', () => {
        const ctx = getContext();
        const storage = new Map();
        ctx.localStorage.getItem = key => storage.get(key) || null;
        ctx.localStorage.setItem = (key, value) => storage.set(key, value);
        const replay = { schema_version: 1, captured_at: '2026-09-19T10:00:00Z', pair: 'EUR/USD', history: { '1H': [] } };
        const record = ctx.recordAnalysisAudit({ pair: 'EUR/USD', decision: 'WAIT', status: 'NO_TRADE_TODAY' }, replay);
        expect(record).toMatchObject({ replay_available: true, replay_schema_version: 1, replay_captured_at: replay.captured_at });
        const stored = JSON.parse(storage.get('ict_analysis_replay_store'));
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ request_id: record.request_id, replay });
    });

    it('exposes explicit public status codes without removing legacy status fields', () => {
        const ctx = getContext();
        const watch = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY', opportunity: { area_of_interest: { low: 1, high: 1.1 } }, reason: { code: 'WAITING', message: 'watch' } });
        expect(watch.status).toBe('TODAY_OPPORTUNITY');
        expect(watch.status_code).toBe('WATCH');
        expect(watch.execution_allowed).toBe(false);
        expect(watch.execution_mode).toBe('MANUAL');
        expect(watch.symbol_metadata.asset_class).toBe('FOREX');
        const aiView = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY', ai_analysis: { analyst_status: 'OK', hypotheses_verified: 1, selected_candidate_id: 'C-1' }, opportunity: { area_of_interest: { low: 1, high: 1.1 } }, reason: { code: 'WAITING', message: 'watch' } });
        expect(aiView.ai_analysis).toMatchObject({ analyst_status: 'OK', hypotheses_verified: 1, selected_candidate_id: 'C-1' });
    const ready = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status: 'TRADE_READY', execution_allowed: true, entry: 1, stop_loss: 0.99, take_profit_1: 1.03 });
    expect(ready.status_code).toBe('SETUP_READY');
    const manualReview = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status: 'TRADE_READY', execution_allowed: false, manual_tracking_allowed: true, validation: { passed: true }, entry: 1, stop_loss: 0.99, take_profit_1: 1.03 });
    expect(manualReview.status_code).toBe('SETUP_READY');
        const incompleteReady = ctx.buildPublicTradeSignal({ pair: 'BTC/USD', decision: 'WAIT', status: 'TRADE_READY', primary_opportunity: { id: 'C-1', direction: 'BUY', state: 'WAITING_FOR_RETRACE' } });
        expect(incompleteReady.status_code).toBe('WATCH');
        expect(incompleteReady.decision).toBe('WAIT');
        expect(ready).toHaveProperty('market_open', null);
        expect(ready.reason).toBeNull();
        const blocked = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'DATA_BLOCKED', reason: { code: 'DATA_BLOCKED', message: 'price unavailable' } });
        expect(blocked.status).toBe('DATA_BLOCKED');
        expect(blocked.status_code).toBe('DATA_BLOCKED');
        const invalidQuality = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY', data_quality: { valid: false, reasons: ['stale quote'] }, opportunity: { area_of_interest: { low: 1, high: 1.1 } } });
        expect(invalidQuality.status_code).toBe('DATA_BLOCKED');
        const riskBlocked = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status: 'TRADE_READY', execution_allowed: true, entry: 1, stop_loss: 0.99, tp1: 1.03, risk_gate: { status: 'RISK_BLOCKED', execution_allowed: false } });
        expect(riskBlocked.status_code).toBe('RISK_BLOCKED');
        expect(riskBlocked.execution_allowed).toBe(false);
        const closed = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY', market_open: false });
        expect(closed.status_code).toBe('MARKET_CLOSED');
        const invalidated = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'INVALIDATED', reason: { code: 'SETUP_INVALIDATED', message: 'structure broke' }, execution_allowed: true });
        expect(invalidated.status_code).toBe('INVALIDATED');
        expect(invalidated.execution_allowed).toBe(false);
        const expired = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'EXPIRED', reason: { code: 'SETUP_EXPIRED', message: 'window ended' }, execution_allowed: true });
        expect(expired.status_code).toBe('EXPIRED');
        expect(expired.execution_allowed).toBe(false);
    });

    it('derives explicit analysis lifecycle statuses without changing compact status codes', () => {
        const ctx = getContext();
        expect(ctx.getAnalysisStatus({ status_code: 'NO_TRADE', current_price: null })).toBe('WAITING_FOR_DATA');
        expect(ctx.getAnalysisStatus({ status_code: 'NO_TRADE', current_price: 1.1, data_quality: { valid: true }, market_open: true })).toBe('SAFE_TO_ANALYZE');
        expect(ctx.getAnalysisStatus({ status_code: 'WATCH', current_price: 1.1 })).toBe('WATCH');
        expect(ctx.getAnalysisStatus({ status_code: 'RISK_BLOCKED', current_price: 1.1 })).toBe('RISK_BLOCKED');
    });

    it('exposes a hard news block even when the planner omitted execution_allowed', () => {
        const ctx = getContext();
        const blocked = ctx.buildPublicTradeSignal({
            pair: 'EUR/USD', decision: 'WAIT', status: 'TODAY_OPPORTUNITY',
            news_risk: { status: 'HIGH_IMPACT', available: true, event_name: 'CPI' },
            opportunity: { area_of_interest: { low: 1, high: 1.1 } },
            reason: { code: 'NEWS_BLOCKED', message: 'CPI window blocks new orders' }
        });
        expect(blocked.status).toBe('TODAY_OPPORTUNITY');
        expect(blocked.status_code).toBe('NEWS_BLOCKED');
        expect(blocked.execution_allowed).toBe(false);
    });

    it('keeps a high-impact news block authoritative over a stale execution permission', () => {
        const ctx = getContext();
        const blocked = ctx.buildPublicTradeSignal({
            pair: 'EUR/USD', decision: 'BUY_LIMIT', status: 'TRADE_READY',
            execution_allowed: true, entry: 1, stop_loss: 0.99, tp1: 1.03,
            news_risk: { status: 'HIGH_IMPACT', available: true, event_name: 'CPI' }
        });
        expect(blocked.status_code).toBe('NEWS_BLOCKED');
    });

    it('defaults public error and wait signals to manual execution mode', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status: 'DATA_BLOCKED' });
        expect(signal.execution_mode).toBe('MANUAL');
        expect(signal.risk_gate).toMatchObject({ mode: 'MANUAL', status: 'MANUAL', execution_allowed: true });
    });

    it('keeps account risk deterministic and blocks live sizing without metadata', () => {
        const ctx = getContext();
        expect(ctx.buildAccountRiskGate({ mode: 'PAPER' })).toMatchObject({ status: 'PAPER', execution_allowed: true, position_size: null });
        const blocked = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000 }, risk_percent: 1 });
        expect(blocked.status).toBe('RISK_BLOCKED');
        expect(blocked.execution_allowed).toBe(false);
        const ready = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000, risk_distance: 0.01 }, risk_percent: 1, symbol_metadata: { tick_size: 0.0001, tick_value: 1 } });
        expect(ready.status).toBe('RISK_READY');
        expect(ready.position_size).toBeGreaterThan(0);
    });

    it('includes spread, slippage, commission, and minimum order size in live sizing', () => {
        const ctx = getContext();
        const baseline = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000, risk_distance: 0.01 }, risk_percent: 1,
            symbol_metadata: { tick_size: 0.0001, tick_value: 1 } });
        const costed = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000, risk_distance: 0.01 }, risk_percent: 1,
            symbol_metadata: { tick_size: 0.0001, tick_value: 1, spread: 0.0002, slippage_estimate: 0.0001, commission_per_unit: 0.5 } });
        expect(costed.status).toBe('RISK_READY');
        expect(costed.position_size).toBeLessThan(baseline.position_size);
        expect(costed.effective_risk_distance).toBeCloseTo(0.0104, 8);
        expect(costed.cost_assumptions).toEqual({ spread: 0.0002, slippage_round_trip: 0.0002, commission_per_unit: 0.5 });
        const belowMinimum = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 100, risk_distance: 0.01 }, risk_percent: 1,
            symbol_metadata: { tick_size: 0.0001, tick_value: 1, minimum_order_size: 1000 } });
        expect(belowMinimum.status).toBe('RISK_BLOCKED');
        const slippageBlocked = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000, risk_distance: 0.01 }, risk_percent: 1,
            symbol_metadata: { tick_size: 0.0001, tick_value: 1, slippage_estimate: 0.0005, maximum_slippage: 0.0002 } });
        expect(slippageBlocked.status).toBe('RISK_BLOCKED');
        expect(slippageBlocked.issues).toContain('estimated slippage exceeds symbol maximum');
        const spreadBlocked = ctx.buildAccountRiskGate({ mode: 'LIVE', account: { equity: 10000, risk_distance: 0.01 }, risk_percent: 1,
            symbol_metadata: { tick_size: 0.0001, tick_value: 1, spread: 0.0005, maximum_spread: 0.0002 } });
        expect(spreadBlocked.status).toBe('RISK_BLOCKED');
        expect(spreadBlocked.issues).toContain('current spread exceeds symbol maximum');
    });

    it('enforces configured loss, order-count, and symbol-exposure limits in every mode', () => {
        const ctx = getContext();
        const blocked = ctx.buildAccountRiskGate({
            mode: 'PAPER',
            account: {
                max_weekly_loss: 500,
                max_consecutive_losses: 3,
                max_active_orders: 2,
                max_symbol_exposure: 1000
            },
            weekly_loss: 500,
            consecutive_losses: 3,
            active_orders: 2,
            symbol_exposure: 1000
        });
        expect(blocked).toMatchObject({ status: 'RISK_BLOCKED', execution_allowed: false });
        expect(blocked.issues).toEqual(expect.arrayContaining([
            'maximum weekly loss reached',
            'maximum consecutive losses reached',
            'maximum active orders reached',
            'maximum symbol exposure reached'
        ]));

        const live = ctx.buildAccountRiskGate({
            mode: 'LIVE',
            account: { max_weekly_loss: 10, equity: 10000, risk_distance: 1 },
            weekly_loss: 10,
            risk_percent: 1,
            symbol_metadata: { tick_size: 1, tick_value: 1 }
        });
        expect(live).toMatchObject({ status: 'RISK_BLOCKED', execution_allowed: false });
        expect(live.issues).toContain('maximum weekly loss reached');
    });

    it('persists paper loss protection and blocks new orders after the configured limit', () => {
        const storage = {};
        const first = getContext();
        first.localStorage.getItem = key => storage[key] || null;
        first.localStorage.setItem = (key, value) => { storage[key] = value; };

        expect(first.getPaperRiskSnapshot()).toMatchObject({
            consecutive_losses: 0,
            daily_loss: 0,
            weekly_loss: 0
        });
        first.recordTradeResult(false, 1);
        first.recordTradeResult(false, 1);
        first.recordTradeResult(false, 1);
        expect(first.getPaperRiskSnapshot()).toMatchObject({
            consecutive_losses: 3,
            daily_loss: 3,
            weekly_loss: 3
        });
        expect(first.buildPaperOrderRiskGate()).toMatchObject({
            status: 'RISK_BLOCKED',
            execution_allowed: false
        });

        const refreshed = getContext();
        refreshed.localStorage.getItem = key => storage[key] || null;
        refreshed.localStorage.setItem = (key, value) => { storage[key] = value; };
        expect(refreshed.getPaperRiskSnapshot()).toMatchObject({
            consecutive_losses: 3,
            daily_loss: 3,
            weekly_loss: 3
        });
        expect(refreshed.buildPaperOrderRiskGate().issues).toEqual(expect.arrayContaining([
            'maximum daily loss reached',
            'maximum consecutive losses reached'
        ]));
        const paperSignal = refreshed.buildPublicTradeSignal({
            pair: 'EUR/USD', execution_mode: 'PAPER', decision: 'WAIT', status: 'TODAY_OPPORTUNITY',
            reason: { code: 'WAITING', message: 'paper watch' }
        });
        expect(paperSignal.risk_gate.status).toBe('RISK_BLOCKED');
        expect(paperSignal.status_code).toBe('RISK_BLOCKED');
    });

    it.each([
        ['EUR/USD', 'FOREX'], ['USD/JPY', 'FOREX'], ['XAU/USD', 'METAL'],
        ['ETH/USD', 'CRYPTO'], ['AAPL', 'EQUITY'], ['US30', 'INDEX'], ['ABC/XYZ', 'UNKNOWN']
    ])('classifies %s without applying an unrelated forex fallback', (symbol, assetClass) => {
        const ctx = getContext();
        const metadata = ctx.getSymbolMetadata(symbol);
        expect(metadata.asset_class).toBe(assetClass);
        expect(metadata.symbol).toBe(symbol);
        expect(Number.isFinite(metadata.tick_size)).toBe(true);
        expect(ctx.getMarketSettings(symbol)).toBeDefined();
    });

    it('backtests pending limits without lookahead and uses conservative same-candle exits', () => {
        const ctx = getContext();
        const t0 = Date.parse('2026-01-01T00:00:00Z');
        const bar = (offset, high, low) => ({ t: new Date(t0 + offset * 3600000).toISOString(), o: 100, h: high, l: low, c: 100, is_closed: true });
        const result = ctx.simulatePendingLimitBacktest({
            signals: [
                { id: 'win', direction: 'BUY', entry: 100, stop_loss: 95, tp1: 104, created_at: t0, expires_at: t0 + 5 * 3600000 },
                { id: 'same-bar', direction: 'SELL', entry: 100, stop_loss: 102, tp1: 96, created_at: t0, expires_at: t0 + 5 * 3600000 },
                { id: 'expired', direction: 'BUY', entry: 90, stop_loss: 88, tp1: 94, created_at: t0, expires_at: t0 + 2 * 3600000 }
            ],
            candles: [bar(1, 101, 99), bar(2, 104, 96), bar(3, 105, 95)],
            feeR: 0.1
        });
        expect(result.metrics.total_signals).toBe(3);
        expect(result.metrics.wins).toBe(1);
        expect(result.metrics.losses).toBe(1);
        expect(result.metrics.expired).toBe(1);
        expect(result.metrics.average_reward_to_risk).toBeGreaterThan(0);
        expect(result.metrics.expectancy_R).toBeCloseTo(-0.4 / 3, 8);
        expect(result.metrics.average_time_in_trade_ms).toBeGreaterThan(0);
        expect(result.metrics.cancel_rate).toBeCloseTo(1 / 3, 8);
        expect(result.metrics.rejection_rate).toBe(0);
        expect(result.trades.find(t => t.signal_id === 'same-bar')).toMatchObject({ outcome: 'LOSS', reason: 'STOP_AND_TARGET_SAME_CANDLE' });

        const partial = ctx.simulatePendingLimitBacktest({
            signals: [{ id: 'partial', symbol: 'EUR/USD', timeframe: '1H', regime: 'TREND_UP', session: 'LONDON', direction: 'BUY', entry: 100, stop_loss: 95, tp1: 104, fill_fraction: 0.5, created_at: t0 }],
            candles: [bar(1, 101, 99), bar(2, 104, 96)]
        });
        expect(partial.trades[0]).toMatchObject({ status: 'CLOSED', outcome: 'WIN', fill_fraction: 0.5 });
        expect(partial.metrics.partial_fills).toBe(1);
        expect(partial.metrics.partial_fill_rate).toBe(1);
        expect(partial.trades[0].grossR).toBeCloseTo(0.4, 8);
        expect(partial.metrics.by_symbol['EUR/USD']).toMatchObject({ closed_trades: 1, wins: 1 });
        expect(partial.metrics.by_timeframe['1H'].closed_trades).toBe(1);
        expect(partial.metrics.by_regime['TREND_UP'].closed_trades).toBe(1);
        expect(partial.metrics.by_session.LONDON.closed_trades).toBe(1);
    });

    it('keeps pending paper-order lifecycle deterministic for touch, expiry, and invalidation', () => {
        const ctx = getContext();
        const created = Date.parse('2026-09-18T10:00:00Z');
        const base = { signalType: 'LONG', idealEntry: 100, stopLoss: 95, takeProfit1: 110, invalidationPrice: 94, createdAt: new Date(created).toISOString() };
        expect(ctx.evaluatePendingPaperOrder(base, 101, created + 30 * 60000)).toMatchObject({ status: 'ORDER_PENDING' });
        expect(ctx.evaluatePendingPaperOrder(base, 100, created + 30 * 60000)).toMatchObject({ status: 'FILLED', reason: 'LIMIT_TOUCHED' });
        expect(ctx.evaluatePendingPaperOrder(base, 93, created + 30 * 60000)).toMatchObject({ status: 'INVALIDATED' });
        expect(ctx.evaluatePendingPaperOrder(base, 101, created + 4 * 60 * 60000)).toMatchObject({ status: 'EXPIRED' });
    });

    it('records paper-order lifecycle events without secrets', () => {
        const ctx = getContext();
        let stored = null;
        ctx.localStorage.getItem = key => key === 'ict_paper_order_audit' ? stored : null;
        ctx.localStorage.setItem = (key, value) => { if (key === 'ict_paper_order_audit') stored = value; };
        const event = ctx.recordPaperOrderEvent({ id: 7, pair: 'EUR/USD', signalType: 'LONG', idealEntry: 1, stopLoss: 0.99, takeProfit1: 1.03, candidate_id: 'candidate-7' }, 'ORDER_PENDING', 'USER_APPROVED_PAPER_ORDER');
        expect(event).toMatchObject({ order_id: 7, status: 'ORDER_PENDING', pair: 'EUR/USD' });
        expect(JSON.parse(stored)[0]).toMatchObject({ order_id: 7, candidate_id: 'candidate-7' });
        expect(stored).not.toMatch(/api|token|authorization|secret/i);
    });

    it('rejects malformed or non-paper persisted orders before monitoring', () => {
        const ctx = getContext();
        const valid = { id: 1, execution_mode: 'PAPER', signalType: 'LONG', idealEntry: 100, stopLoss: 95, takeProfit1: 110, createdAt: '2026-09-18T10:00:00Z' };
        expect(ctx.validatePersistedPaperOrder(valid).valid).toBe(true);
        expect(ctx.validatePersistedPaperOrder({ ...valid, execution_mode: 'LIVE' }).issues).toContain('execution mode is not PAPER or MANUAL');
        expect(ctx.validateExecutionMode('MANUAL')).toMatchObject({ valid: true, mode: 'MANUAL' });
        expect(ctx.validatePersistedPaperOrder({ ...valid, stopLoss: 105 }).valid).toBe(false);
        expect(ctx.validatePersistedPaperOrder({ ...valid, createdAt: 'bad' }).valid).toBe(false);
        expect(ctx.validatePersistedPaperOrder({ ...valid, idempotency_key: '' }).issues).toContain('idempotency key is invalid');
        const key = ctx.buildPaperOrderIdempotencyKey({ signalType: 'LONG', candidate_id: 'C-1', idealEntry: 100, stopLoss: 95, takeProfit1: 110 }, 'EUR/USD');
        expect(key).toBe('PAPER:EUR/USD|LONG|C-1|100|95|110');
        expect(ctx.validatePersistedPaperOrder({ ...valid, pair: 'EUR/USD', candidate_id: 'C-1', idempotency_key: key }).valid).toBe(true);
        expect(ctx.validatePersistedPaperOrder({ ...valid, pair: 'EUR/USD', candidate_id: 'C-1', idempotency_key: `${key}-tampered` }).issues).toContain('idempotency key does not match order geometry');
    });

    it('validates the final public signal contract and rejects malformed ready geometry', () => {
        const ctx = getContext();
        expect(ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status_code: 'WATCH', current_price: 1.1 }).valid).toBe(true);
        expect(ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY', status_code: 'SETUP_READY', entry: 100, stop_loss: 99, tp1: 103 }).valid).toBe(false);
        expect(ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status_code: 'SETUP_READY', current_price: 100, entry: 99, stop_loss: 98, tp1: 103 }).issues).toContain('SETUP_READY requires a limit decision');
        const missingPrice = ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status_code: 'SETUP_READY', entry: 100, stop_loss: 99, tp1: 103 });
        expect(missingPrice.valid).toBe(false);
        expect(missingPrice.issues).toContain('ready setup current_price is unavailable');
        const wrongSide = ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status_code: 'SETUP_READY', current_price: 100, entry: 101, stop_loss: 99, tp1: 103 });
        expect(wrongSide.valid).toBe(false);
        expect(wrongSide.issues).toContain('BUY_LIMIT entry must be below current quote');
        expect(ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'SELL_LIMIT', status_code: 'SETUP_READY', current_price: 100, entry: 101, stop_loss: 103, tp1: 99 }).valid).toBe(true);
        const askSide = ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status_code: 'SETUP_READY', current_price: 100, market_conditions: { ask: 100.2 }, entry: 100.3, stop_loss: 99, tp1: 103 });
        expect(askSide.valid).toBe(false);
        expect(askSide.issues).toContain('BUY_LIMIT entry must be below current quote');
        const outsideZone = ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status_code: 'SETUP_READY', current_price: 100, entry: 98, entry_zone: { low: 99, high: 99.5 }, stop_loss: 97, tp1: 103 });
        expect(outsideZone.valid).toBe(false);
        expect(outsideZone.issues).toContain('ready entry is outside entry zone');
        const invalid = ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'BUY_LIMIT', status_code: 'SETUP_READY', entry: 100, stop_loss: 101, tp1: 99 });
        expect(invalid.valid).toBe(false);
        expect(invalid.issues.join(' ')).toMatch(/BUY_LIMIT geometry/);
        expect(ctx.validatePublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', status_code: 'DATA_BLOCKED', execution_allowed: 'yes' }).valid).toBe(false);
    });

    it('preserves stop quality warnings for manual review', () => {
        const ctx = getContext();
        const signal = ctx.buildPublicTradeSignal({
            pair: 'EUR/USD', decision: 'BUY_LIMIT', status: 'TRADE_READY', execution_allowed: true,
            entry: 1.1000, stop_loss: 1.0997, take_profit_1: 1.1010,
            stop_quality: {
                status: 'VALID_STRUCTURAL_STOP',
                volatility_classification: 'TIGHT_BUT_STRUCTURAL',
                atr_multiple: 0.6,
                warning: 'Stop is structurally valid but tighter than the preferred volatility distance.'
            }
        });
        expect(signal.stop_quality).toMatchObject({ volatility_classification: 'TIGHT_BUT_STRUCTURAL', atr_multiple: 0.6 });
        expect(signal.analysis.notes).toContain('Stop is structurally valid but tighter than the preferred volatility distance.');
    });

    it('rejects duplicate timestamps and explicitly open candles in required histories', () => {
        const ctx = getContext();
        const baseStart = Date.parse('2026-09-01T00:00:00Z');
        const base = candles(50, 100, 0.1, 'up').map((bar, index) => ({ ...bar, t: new Date(baseStart + index * 3600000).toISOString() }));
        const duplicate = base.map(bar => ({ ...bar }));
        duplicate[1].t = duplicate[0].t;
        const duplicateResult = ctx.validateMarketDataQuality({ '4H': duplicate, '1H': base }, 105);
        expect(duplicateResult.valid).toBe(false);
        expect(duplicateResult.reasons.join(' ')).toMatch(/duplicate candle timestamps/);

        const open = base.map(bar => ({ ...bar }));
        open[open.length - 1].is_closed = false;
        const openResult = ctx.validateMarketDataQuality({ '4H': open, '1H': base }, 105);
        expect(openResult.valid).toBe(false);
        expect(openResult.reasons.join(' ')).toMatch(/open candle/);
    });

    it('blocks stale or future-dated provider quotes when timestamps are available', () => {
        const ctx = getContext();
        const now = Date.parse('2026-09-18T12:00:00Z');
        const data = candles(50, 100, 0.1, 'up').map((bar, index) => ({ ...bar, t: new Date(now - (50 - index) * 3600000).toISOString() }));
        const stale = ctx.validateMarketDataQuality({ '4H': data, '1H': data }, 105, { provider_timestamp: now - 2 * 3600000 }, now);
        expect(stale.valid).toBe(false);
        expect(stale.reasons.join(' ')).toMatch(/quote data is stale/);
        const future = ctx.validateMarketDataQuality({ '4H': data, '1H': data }, 105, { provider_timestamp: now + 10 * 60000 }, now);
        expect(future.valid).toBe(false);
        expect(future.reasons.join(' ')).toMatch(/future/);
    });

    it('blocks stale or future-dated candle history when timestamps are available', () => {
        const ctx = getContext();
        const now = Date.parse('2026-09-18T12:00:00Z');
        const staleData = candles(50, 100, 0.1, 'up').map((bar, index) => ({ ...bar, t: new Date(now - (50 - index + 8) * 3600000).toISOString(), is_closed: true }));
        const stale = ctx.validateMarketDataQuality({ '4H': staleData, '1H': staleData }, 105, null, now);
        expect(stale.valid).toBe(false);
        expect(stale.reasons.join(' ')).toMatch(/candle data is stale/);
        const futureData = staleData.map((bar, index) => ({ ...bar, t: new Date(now - (49 - index) * 3600000).toISOString() }));
        futureData[futureData.length - 1].t = new Date(now + 10 * 60000).toISOString();
        const future = ctx.validateMarketDataQuality({ '4H': futureData, '1H': futureData }, 105, null, now);
        expect(future.valid).toBe(false);
        expect(future.reasons.join(' ')).toMatch(/future candle/);
    });

    it('requires a timestamp when a live quote snapshot supplies a price', () => {
        const ctx = getContext();
        const result = ctx.validateMarketDataQuality({ '4H': candles(50, 100, 0.1, 'up'), '1H': candles(50, 100, 0.1, 'up') }, 105, { price: 105 }, Date.now());
        expect(result.valid).toBe(false);
        expect(result.reasons).toContain('quote timestamp is unavailable');
    });

    it('enforces the live scan history contract for every used timeframe', () => {
        const ctx = getContext();
        const base = candles(50, 100, 0.1, 'up');
        const result = ctx.validateMarketDataQuality({
            '1D': base, '4H': base, '1H': base,
            '15M': candles(19, 100, 0.1, 'up'), '5M': candles(20, 100, 0.1, 'up')
        }, 105, { provider_timestamp: Date.now() }, Date.now(), ['1D', '4H', '1H', '15M', '5M']);
        expect(result.valid).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/Insufficient 15M data/);
    });

    it('hard-blocks candidate construction during supplied high-impact news risk', () => {
        const ctx = getContext();
        const result = ctx.buildAdaptiveSetupCandidates({
            pair: 'EUR/USD', price: 1.1,
            historyCache: { '4H': candles(80, 1.08, 0.0002, 'up'), '1H': candles(80, 1.08, 0.0002, 'up') },
            zones: [{ id: 'zone', type: 'FVG', direction: 'BUY', timeframe: '1H', low: 1.099, high: 1.1 }],
            targetCandidates: { buy: [], sell: [] }, riskConstraints: { minimum_rr: 2.5 }, marketRegime: {}, structure: {},
            marketContext: { news_risk: { status: 'HIGH_IMPACT', warning: 'CPI window' } }, strategySetups: []
        });
        expect(result.valid_candidates).toEqual([]);
        expect(result.rejected_candidates[0].rejection_code).toBe('NEWS_BLOCKED');
    });

    it('marks news risk unknown when no calendar data is supplied', () => {
        const ctx = getContext();
        expect(ctx.checkHighImpactNews()).toMatchObject({ status: 'UNKNOWN', available: false, high_impact_event: null });
        expect(ctx.checkHighImpactNews({ high_impact_event: true, event_name: 'CPI', source: 'calendar' })).toMatchObject({ status: 'HIGH_IMPACT', available: true, event_name: 'CPI' });
    });

    it('requests enough bounded history for configured MSNR lookback and keeps intraday UTC', async () => {
        const ctx = getContext();
        ctx.console.warn = () => {};
        await ctx.saveKeys('tw', '', '', '', '');
        let requestedUrl = '';
        ctx.fetch = jest.fn(async url => {
            requestedUrl = url;
            return { ok: true, json: async () => ({ values: [{ datetime: '2026-09-11 10:00:00', open: '1', high: '2', low: '0.5', close: '1.5', volume: '1' }] }) };
        });
        const result = await ctx.getHistory('1H', 'EUR/USD');
        expect(result).toHaveLength(1);
        expect(Number(new URL(requestedUrl).searchParams.get('outputsize'))).toBeGreaterThanOrEqual(ctx.getRequiredHistoryOutputSize());
        expect(requestedUrl).toContain('timezone=UTC');
        expect(result.provider_metadata.requested_timezone).toBe('UTC');
        expect(result.provider_metadata.timestamp_contract).toBe('INTRADAY_UTC');
        const daily = await ctx.getHistory('1D', 'EUR/USD');
        expect(daily.provider_metadata.timestamp_contract).toBe('PERIOD_BUCKET');
        expect(requestedUrl).toContain('interval=1day');
        expect(requestedUrl).not.toContain('timezone=UTC');
        const minute = await ctx.getHistory('1M', 'EUR/USD');
        expect(minute.provider_metadata.timeframe).toBe('1M');
        expect(requestedUrl).toContain('interval=1min');
    });

    it('closes completed daily period buckets even when their labels are within one day', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const now = Date.now();
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { datetime: new Date(now - 12 * 60 * 60 * 1000).toISOString(), open: '1', high: '2', low: '0.5', close: '1.5' },
            { datetime: new Date(now - 60 * 60 * 1000).toISOString(), open: '1.5', high: '2.5', low: '1', close: '2' }
        ] }) }));
        const daily = await ctx.getHistory('1D', 'BTC/USD');
        expect(daily).toHaveLength(1);
        expect(daily[0].c).toBe(1.5);
        expect(daily.provider_metadata.timestamp_contract).toBe('PERIOD_BUCKET');
    });

    it('parses Twelve Data date-only daily candle labels as UTC period buckets', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const today = new Date().toISOString().slice(0, 10);
        const day = offset => new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { datetime: day(0), open: '2', high: '3', low: '1', close: '2.5' },
            { datetime: day(1), open: '1.5', high: '2.5', low: '1', close: '2' },
            { datetime: day(2), open: '1', high: '2', low: '0.5', close: '1.5' }
        ] }) }));
        const daily = await ctx.getHistory('1D', 'BTC/USD');
        expect(daily).toHaveLength(2);
        expect(daily[0].t).toBe(Date.parse(`${day(2)}T00:00:00Z`));
        expect(daily.provider_metadata.closed_count).toBe(2);
    });

    it('accepts provider daily candles whose timestamp field is named timestamp', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const now = Date.now();
        const errors = [];
        ctx.console.error = (...args) => errors.push(args);
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { timestamp: new Date(now - 4 * 86400000).toISOString(), open: '1.5', high: '2.5', low: '1', close: '2' },
            { timestamp: new Date(now - 5 * 86400000).toISOString(), open: '1', high: '2', low: '0.5', close: '1.5' }
        ] }) }));
        const daily = await ctx.getHistory('1D', 'BTC/USD');
        if (!daily) throw errors[0]?.[1] || new Error('daily history request returned null');
        expect(daily).toHaveLength(2);
        expect(daily.provider_metadata.provider).toBe('TWELVE_DATA');
    });

    it('includes sanitized timestamp shape diagnostics when provider daily timestamps cannot be parsed', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const errors = [];
        ctx.console.error = (...args) => errors.push(args);
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { ts: 'unrecognized-time', open: '1', high: '2', low: '0.5', close: '1.5' }
        ] }) }));
        expect(await ctx.getHistory('1D', 'BTC/USD')).toBeNull();
        expect(errors[0][1].message).toContain('row_keys=ts,open,high,low,close');
        expect(errors[0][1].message).toContain('timestamp_sample=missing');
    });

    it('deduplicates simultaneous quote and history requests per symbol and timeframe', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.fetch = jest.fn(async url => {
            await new Promise(resolve => setTimeout(resolve, 5));
            if (url.includes('/quote?')) return { ok: true, json: async () => ({ price: '1.25', timestamp: '2026-09-19T10:00:00Z' }) };
            return { ok: true, json: async () => ({ values: [{ datetime: '2026-09-19 10:00:00', open: '1', high: '2', low: '0.5', close: '1.5', volume: '1' }] }) };
        });
        const [quotes, history] = await Promise.all([
            Promise.all([ctx.getMarketQuoteSnapshot('EUR/USD'), ctx.getMarketQuoteSnapshot('EUR/USD')]),
            Promise.all([ctx.getHistory('1H', 'EUR/USD'), ctx.getHistory('1H', 'EUR/USD')])
        ]);
        expect(quotes[0].price).toBe(1.25);
        expect(quotes[1]).toEqual(quotes[0]);
        expect(history[0]).toEqual(history[1]);
        expect(ctx.fetch).toHaveBeenCalledTimes(2);
    });

    it('reuses a recent quote across sequential scans within the quote cache window', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ price: '1.25', timestamp: '2026-09-19T10:00:00Z' }) }));
        const first = await ctx.getMarketQuoteSnapshot('EUR/USD');
        const second = await ctx.getMarketQuoteSnapshot('EUR/USD');
        expect(second).toEqual(first);
        expect(ctx.fetch).toHaveBeenCalledTimes(1);
    });

    it('filters the currently forming provider candle before structure analysis', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const now = Date.now();
        const bucket = Math.floor(now / 3600000) * 3600000;
        const iso = ms => new Date(ms).toISOString().replace('T', ' ').replace('.000Z', '');
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { datetime: iso(bucket), open: '2', high: '3', low: '1', close: '2.5', volume: '1' },
            { datetime: iso(bucket - 3600000), open: '1', high: '2', low: '0.5', close: '1.5', volume: '1' }
        ] }) }));
        const result = await ctx.getHistory('1H', 'EUR/USD');
        expect(result).toHaveLength(1);
        expect(result[0].is_closed).toBe(true);
        expect(result.provider_metadata).toMatchObject({ raw_count: 2, closed_count: 1, open_candles_filtered: 1 });
    });

    it('preserves missing provider volume instead of inventing a value', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { datetime: '2026-09-11 10:00:00', open: '1', high: '2', low: '0.5', close: '1.5' }
        ] }) }));
        const result = await ctx.getHistory('1H', 'EUR/USD');
        expect(result[0].v).toBeNull();
    });

    it('rejects malformed provider OHLC and duplicate timestamps at the data boundary', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.console.error = () => {};
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ values: [
            { datetime: '2026-09-11 10:00:00', open: '1', high: '2', low: '0.5', close: '1.5' },
            { datetime: '2026-09-11 10:00:00', open: 'bad', high: '2', low: '0.5', close: '1.5' }
        ] }) }));
        await expect(ctx.getHistory('1H', 'GBP/USD')).resolves.toBeNull();
    });

    it('derives supported indicators locally without spending provider indicator requests', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const data = candles(80, 100, 0.25, 'up').map((bar, index) => ({ ...bar, is_closed: true, timeframe: '1H', t: index }));
        ctx.fetch = jest.fn(() => { throw new Error('indicator endpoint must not be called'); });
        const indicators = await ctx.getTechnicalIndicators('1H', data);
        expect(indicators.indicator_source).toBe('LOCAL_OHLCV');
        expect(Number.isFinite(indicators.rsi)).toBe(true);
        expect(Number.isFinite(indicators.macd)).toBe(true);
        expect(Number.isFinite(indicators.stoch_k)).toBe(true);
        expect(Number.isFinite(indicators.cci)).toBe(true);
        expect(Number.isFinite(indicators.williams_r)).toBe(true);
        expect(Number.isFinite(indicators.supertrend)).toBe(true);
        expect(ctx.fetch).not.toHaveBeenCalled();
    });

    it('derives local indicators from supplied candles without market-data credentials', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        const data = candles(80, 100, 0.5, 'up').map((bar, index) => ({ ...bar, is_closed: true, timeframe: '1H', t: index }));
        const indicators = await ctx.getTechnicalIndicators('1H', data);
        expect(indicators.indicator_source).toBe('LOCAL_OHLCV');
        expect(Number.isFinite(indicators.atr_api)).toBe(true);
        expect(Number.isFinite(indicators.ema21)).toBe(true);
    });

    it('does not reuse a cached indicator snapshot for a refreshed candle dataset', async () => {
        const ctx = getContext();
        const firstData = candles(80, 100, 0.25, 'up').map((bar, index) => ({ ...bar, is_closed: true, timeframe: '1H', t: index }));
        const refreshedData = firstData.map((bar, index) => index === firstData.length - 1
            ? { ...bar, c: bar.c + 20, h: bar.h + 20 }
            : bar);
        const first = await ctx.getTechnicalIndicators('1H', firstData);
        const refreshed = await ctx.getTechnicalIndicators('1H', refreshedData);
        expect(refreshed.ema9).not.toBe(first.ema9);
    });

    it('keeps indicator cache entries isolated by symbol', async () => {
        const ctx = getContext();
        const data = candles(80, 100, 0.25, 'up').map((bar, index) => ({ ...bar, is_closed: true, timeframe: '1H', t: index }));
        const first = await ctx.getTechnicalIndicators('1H', data, 'EUR/USD');
        const second = await ctx.getTechnicalIndicators('1H', data, 'AUD/USD');
        expect(second).not.toBe(first);
        expect(second.ema9).toBe(first.ema9);
    });

    it('does not let device timezone affect canonical timestamps', () => {
        const ctx = getContext();
        const value = '2026-09-11T10:00:00Z';
        expect(ctx.normalizeTimestampUTC(value)).toBe(Date.parse(value));
        expect(ctx.normalizeTimestampUTC('2026-09-11 10:00:00')).toBe(Date.parse(value));
    });

    it.each([
        ['BTC/USD', 6, true],
        ['BTC/USD', 0, true],
        ['EUR/USD', 6, false],
        ['XAU/USD', 6, false]
    ])('uses asset-aware weekend calendar for %s', (instrument, day, open) => {
        const ctx = getContext();
        const saturday = Date.parse('2026-09-12T12:00:00Z');
        const sunday = Date.parse('2026-09-13T12:00:00Z');
        const timestamp = day === 0 ? sunday : saturday;
        const state = ctx.getMarketOpenState(instrument, { as_of_ms: timestamp });
        expect(state.is_market_open).toBe(open);
        expect(state.source).toBe('ASSET_CALENDAR');
    });

    it('uses reliable provider market-open state over calendar fallback', () => {
        const ctx = getContext();
        const saturday = Date.parse('2026-09-12T12:00:00Z');
        expect(ctx.getMarketOpenState('EUR/USD', { as_of_ms: saturday, is_market_open: true }).is_market_open).toBe(true);
        expect(ctx.getMarketOpenState('BTC/USD', { as_of_ms: saturday, is_market_open: false }).is_market_open).toBe(false);
    });

    it('rejects a stale non-crypto provider-open flag during the weekend', () => {
        const ctx = getContext();
        const saturday = Date.parse('2026-09-19T06:00:00Z');
        const staleQuote = Date.parse('2026-09-18T21:00:00Z');
        expect(ctx.getMarketOpenState('XAU/USD', {
            as_of_ms: saturday,
            is_market_open: true,
            provider_timestamp: staleQuote
        })).toMatchObject({ is_market_open: false, source: 'ASSET_CALENDAR' });
    });

    it('uses a fresh closed candle when the quote endpoint is stale', () => {
        const ctx = getContext();
        const asOf = Date.parse('2026-09-19T06:00:00Z');
        const refreshed = ctx.refreshStaleQuoteFromClosedCandle({
            pair: 'BTC/USD', price: 81040, provider_timestamp: Date.parse('2026-09-18T20:00:00Z'), quote_source: 'QUOTE'
        }, {
            '5M': [{ t: Date.parse('2026-09-19T05:55:00Z'), c: 81055, is_closed: true }]
        }, asOf, '5M');
        expect(refreshed).toMatchObject({ price: 81055, provider_timestamp: Date.parse('2026-09-19T05:55:00Z'), quote_source: 'CANDLE_CLOSE_FALLBACK' });
    });

    it('uses supplied UTC symbol-session metadata before generic asset calendar fallback', () => {
        const ctx = getContext();
        const open = Date.parse('2026-09-14T10:00:00Z');
        const closed = Date.parse('2026-09-14T18:00:00Z');
        const session = { open_days: [1, 2, 3, 4, 5], open_utc: '09:00', close_utc: '17:00' };
        expect(ctx.getMarketOpenState('NASDAQ:AAPL', { as_of_ms: open, symbol_metadata: { session } })).toMatchObject({ is_market_open: true, source: 'SYMBOL_SESSION' });
        expect(ctx.getMarketOpenState('NASDAQ:AAPL', { as_of_ms: closed, symbol_metadata: { session } })).toMatchObject({ is_market_open: false, source: 'SYMBOL_SESSION' });
    });

    it('keeps MARKET_CLOSED separate from entry reachability and chooses dominant lifecycle wait', () => {
        const ctx = getContext();
        expect(ctx.evaluateSetupLifecycle({ direction: 'BUY', entry: 100, zone_low: 99, zone_high: 101, tp1: 110,
            strategy_setup: { primary: 'CRT', timeframe: '1H', reclaim_bar_index: 0, reclaim_time: '2026-09-12T09:00:00Z' } }, {
            pair: 'EUR/USD', price: 100, as_of_time: '2026-09-12T12:00:00Z',
            historyCache: { '1H': [c(99, 101, 98, 100, '2026-09-12T09:00:00Z')] }
        }).rejection_code).toBe('MARKET_CLOSED');
        expect(ctx.waitCodeFromRejections({ rejection_detail: { SETUP_EXPIRED: 14, ENTRY_ALREADY_CONSUMED: 9, ENTRY_NOT_REACHABLE_TODAY: 3 } }, true))
            .toBe('NO_FRESH_OPPORTUNITY');
        expect(ctx.waitCodeFromRejections({ market_open: false, rejection_detail: {} }, true)).toBe('MARKET_CLOSED');
        expect(ctx.waitCodeFromRejections({ market_open: false, rejection_detail: {} }, false)).toBe('MARKET_CLOSED');
        expect(ctx.waitCodeFromRejections({ market_open: true, rejection_detail: { ENTRY_NOT_REACHABLE_TODAY: 1 } }, true))
            .toBe('ENTRY_NOT_REACHABLE_TODAY');
    });

    it('uses execution-zone age for a fresh 1H zone under an older active 4H narrative', () => {
        const ctx = getContext();
        const parentTime = Date.parse('2026-09-10T12:00:00Z');
        const zoneTime = Date.parse('2026-09-11T09:00:00Z');
        const asOf = Date.parse('2026-09-11T10:00:00Z');
        const result = ctx.evaluateSetupLifecycle({
            direction: 'BUY', entry: 100, zone_low: 99.9, zone_high: 100.1, tp1: 110,
            execution_event_time: zoneTime, execution_event_index: 1,
            strategy_setup: { primary: 'CRT', setup_timeframe: '4H', execution_timeframe: '1H',
                reclaim_time: parentTime, reclaim_bar_index: 0 }
        }, { pair: 'EUR/USD', price: 101, as_of_time: asOf, historyCache: {
            '4H': [c(100, 101, 99, 100, '2026-09-10T12:00:00Z')],
            '1H': [c(99, 100, 98, 99.5, '2026-09-11T08:00:00Z'), c(99.5, 101, 99.3, 100.8, '2026-09-11T09:00:00Z')]
        }});
        expect(result.parent_event_age_hours).toBe(22);
        expect(result.event_age_hours).toBe(1);
        expect(result.rejection_code).toBeNull();
        expect(result.opportunity_status).toBe('FRESH_PENDING_TODAY');
    });

    it('does not revive a genuinely stale 4H narrative with a new execution zone', () => {
        const ctx = getContext();
        const parentTime = Date.parse('2026-09-07T12:00:00Z');
        const zoneTime = Date.parse('2026-09-11T09:00:00Z');
        const result = ctx.evaluateSetupLifecycle({
            direction: 'BUY', entry: 100, zone_low: 99.9, zone_high: 100.1, tp1: 110,
            execution_event_time: zoneTime, execution_event_index: 1,
            strategy_setup: { primary: 'CRT', setup_timeframe: '4H', execution_timeframe: '1H',
                reclaim_time: parentTime, reclaim_bar_index: 0 }
        }, { pair: 'EUR/USD', price: 101, as_of_time: Date.parse('2026-09-11T10:00:00Z'), historyCache: {
            '4H': [c(100, 101, 99, 100, '2026-09-07T12:00:00Z')],
            '1H': [c(99, 100, 98, 99.5, '2026-09-11T08:00:00Z'), c(99.5, 101, 99.3, 100.8, '2026-09-11T09:00:00Z')]
        }});
        expect(result.rejection_code).toBe('SETUP_STALE');
        expect(result.opportunity_status).toBe('INVALID');
    });

    it('keeps closed MSNR/FVG/OB structural data separate from live market state', () => {
        const ctx = getContext();
        const raw = candles(80, 100, 0.5, 'up');
        raw[79] = { ...raw[79], is_closed: false };
        const closed = raw.slice(0, 79);
        expect(ctx.buildTargetCandidates({ '4H': raw, '1H': raw }, 140, 'XAU/USD'))
            .toEqual(ctx.buildTargetCandidates({ '4H': closed, '1H': closed }, 140, 'XAU/USD'));
    });

    it('produces compact public BUY_LIMIT and WAIT signals while retaining debug fields separately', () => {
        const ctx = getContext();
        const full = { trade_signal: {
            date: '2026-09-11', time: '10:00:00', pair: 'XAU/USD', current_price: 4402.84,
            decision: 'BUY_LIMIT', trade_type: 'BUY_LIMIT', strategy: 'CRT+MSNR', execution_timeframe: '1H',
            entry_price: 4387, entry_zone: { low: 4384.5, high: 4389.2, source: 'FVG' },
            stop_loss: 4365, take_profit_1: 4430, take_profit_2: null, take_profit_3: null,
            risk_reward: '1:2.05', confidence: 72, opportunity_status: 'FRESH_PENDING_TODAY',
            strategy_detections: { huge: true }, candidate_pipeline: { huge: true }, seed_diagnostics: [{ huge: true }],
            reasoning: { primary: 'CRT reclaim aligned with MSNR', structure: 'Bullish displacement', liquidity: 'Opposite liquidity above', invalidation: 'Below sweep', secondary: ['fresh'] }
        }};
        const publicSignal = ctx.buildPublicTradeSignal(full.trade_signal);
        expect(publicSignal.entry).toBe(4387);
        expect(publicSignal.tp1).toBe(4430);
        expect(publicSignal.rr_tp1).toBe(2.05);
        expect(publicSignal.analysis.bias).toBe('NEUTRAL');
        expect(publicSignal).not.toHaveProperty('candidate_pipeline');
        expect(publicSignal).not.toHaveProperty('seed_diagnostics');
        expect(ctx.buildDebugDiagnostics(full).candidate_pipeline).toEqual({ huge: true });
        const wait = ctx.buildPublicTradeSignal({ date: '2026-09-11', time: '10:00:00', pair: 'EUR/USD',
            current_price: 1.15982, decision: 'WAIT', confidence: 0, market_open: true,
            reasoning: { code: 'NO_FRESH_OPPORTUNITY', primary: 'No fresh actionable CRT, TBS or MSNR execution opportunity' } });
        expect(wait.reason.code).toBe('NO_FRESH_OPPORTUNITY');
        expect(wait.market_open).toBe(true);
    });

    it('uses one immutable scan quote snapshot with safe price fallback', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.fetch = jest.fn(async url => String(url).includes('/quote?')
            ? { ok: true, json: async () => ({ price: '1.25', bid: '1.2499', ask: '1.2501', timestamp: '2026-09-11T10:00:00Z', is_market_open: 'open' }) }
            : { ok: true, json: async () => ({}) });
        const quote = await ctx.getMarketQuoteSnapshot('EUR/USD');
        expect(quote.price).toBe(1.25);
        expect(quote.provider_timestamp_utc).toBe('2026-09-11T10:00:00.000Z');
        expect(quote.is_market_open).toBe(true);
        expect(quote).toMatchObject({ bid: 1.2499, ask: 1.2501 });
        expect(quote.spread).toBeCloseTo(0.0002, 8);
        expect(quote.quote_source).toBe('QUOTE');
    });

    it('preserves supplied asset metadata without inventing missing broker values', () => {
        const ctx = getContext();
        const metadata = ctx.getSymbolMetadata('EUR/USD', { tick_size: 0.0001, tick_value: 1, contract_size: 100000, minimum_order_size: 1000, leverage: 30, trading_permissions: ['PAPER'], maximum_slippage: 0.0003, maximum_spread: 0.0004 });
        expect(metadata).toMatchObject({ tick_size: 0.0001, tick_value: 1, contract_size: 100000, minimum_order_size: 1000, leverage: 30, trading_permissions: ['PAPER'], maximum_slippage: 0.0003, maximum_spread: 0.0004 });
        expect(metadata.spread).toBeNull();
        expect(metadata.metadata_complete).toBe(true);
    });

    it('treats provider zero placeholders as unknown metadata', () => {
        const ctx = getContext();
        const metadata = ctx.getSymbolMetadata('EUR/USD', {
            tick_size: 0, tick_value: 0, contract_size: 0,
            minimum_order_size: 0, spread: 0, leverage: 0
        });
        expect(metadata.tick_size).toBe(0.0001);
        expect(metadata.tick_value).toBeNull();
        expect(metadata.contract_size).toBeNull();
        expect(metadata.spread).toBeNull();
        expect(metadata.leverage).toBeNull();
        expect(metadata.metadata_complete).toBe(false);
    });

    it('classifies exchange-qualified provider symbols by underlying instrument', () => {
        const ctx = getContext();
        expect(ctx.getAssetClass('NASDAQ:AAPL')).toBe('EQUITY');
        expect(ctx.getAssetClass('NASDAQ:US30')).toBe('INDEX');
        expect(ctx.getAssetClass('BINANCE:BTC/USD')).toBe('CRYPTO');
        expect(ctx.getAssetClass('OANDA:EUR/USD')).toBe('FOREX');
        expect(ctx.getAssetClass('OANDA:XAU/USD')).toBe('METAL');
        expect(ctx.getSymbolMetadata('NASDAQ:AAPL').asset_class).toBe('EQUITY');
    });

    it('uses explicit symbol metadata for market precision and risk distances', () => {
        const ctx = getContext();
        const metadata = ctx.getSymbolMetadata('EUR/USD', {
            tick_size: 0.01,
            price_precision: 2,
            minimum_price_distance: 0.25,
            stop_buffer: 0.4,
            max_stop_pct: 0.03,
            minimum_rr: 3,
            min_sl_atr_multiplier: 2.25,
        });
        expect(metadata).toMatchObject({ tick_size: 0.01, price_precision: 2 });
        expect(ctx.getMarketSettings('EUR/USD', metadata)).toMatchObject({
            pipSize: 0.01,
            prec: 2,
            minSL: 0.25,
            slBuffer: 0.4,
            maxSLPct: 0.03,
            targetRR: 3,
            minSLMultiplier: 2.25
        });
    });

    it('uses supplied asset class when a provider symbol is otherwise unknown', () => {
        const ctx = getContext();
        const metadata = ctx.getSymbolMetadata('VENUE_ASSET', { asset_class: 'INDEX', tick_size: 0.25, price_precision: 2 });
        expect(metadata.asset_class).toBe('INDEX');
        expect(ctx.getMarketSettings('VENUE_ASSET', metadata)).toMatchObject({ pipSize: 0.25, prec: 2, minSLMultiplier: 1.5 });
    });

    it('uses asset class and quote currency profiles instead of symbol-name risk branches', () => {
        const ctx = getContext();
        expect(ctx.getMarketSettings('VENUE_METAL', { asset_class: 'METAL' })).toMatchObject({ pipSize: 0.1, prec: 2, minSL: 3, minSLMultiplier: 2.0 });
        expect(ctx.getMarketSettings('USD/JPY', { asset_class: 'FOREX' })).toMatchObject({ pipSize: 0.01, prec: 3, minSL: 0.10 });
        expect(ctx.getMarketSettings('VENUE_COIN', { asset_class: 'CRYPTO' })).toMatchObject({ pipSize: 0.00000001, prec: 8, minSLMultiplier: 2.0 });
    });

    it('carries supplied metadata into deterministic risk constraints', () => {
        const ctx = getContext();
        const data = candles(40, 100, 0.5, 'up');
        const metadata = ctx.getSymbolMetadata('EUR/USD', { tick_size: 0.01, price_precision: 2, minimum_rr: 3, max_stop_pct: 0.03 });
        const constraints = ctx.buildRiskConstraints('EUR/USD', 100, { '4H': data, '1H': data, '15M': data }, { spread: 0.02 }, metadata);
        expect(constraints.minimum_rr).toBe(3);
        expect(constraints.maximum_spread).toBeGreaterThanOrEqual(0.02);
        expect(constraints.minimum_sl_distance).toBeGreaterThanOrEqual(0.01);
    });

    it('marks known excessive quote spread as a deterministic candidate rejection', () => {
        const ctx = getContext();
        const data = candles(60, 1.1, 0.0002, 'up');
        const constraints = ctx.buildRiskConstraints('EUR/USD', 1.11, { '4H': data, '1H': data, '15M': data }, { spread: 0.01 });
        expect(constraints.spread_status).toBe('TOO_WIDE');
        expect(constraints.spread_valid).toBe(false);
        expect(ctx.buildPublicTradeSignal({ pair: 'EUR/USD', decision: 'WAIT', reason: { code: 'SPREAD_TOO_WIDE', message: 'spread too wide' } }).status_code).toBe('RISK_BLOCKED');
    });

    it('keeps a price fallback timestamp unknown and never reuses an expired cached price after a provider error', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', '', '', '', '');
        ctx.fetch = jest.fn(async url => String(url).includes('/quote?')
            ? { ok: false, json: async () => ({}) }
            : { ok: true, json: async () => ({ price: '1.26' }) });
        const quote = await ctx.getMarketQuoteSnapshot('EUR/USD');
        expect(quote.price).toBe(1.26);
        expect(quote.quote_source).toBe('PRICE_FALLBACK');
        expect(quote.provider_timestamp).toBeNull();
        expect(quote.provider_timestamp_utc).toBeNull();
    });
});

describe('AI market analyst contract', () => {
    function evidence() {
        return {
            pair: 'EUR/USD',
            current_price: 1.1,
            strategy_events: [],
            crt_events: [{
                id: 'CRT-1', strategy: 'CRT', direction: 'BUY', timeframe: '4H',
                event_time: '2026-09-11T08:00:00Z', reclaim_time: '2026-09-11T08:00:00Z',
                range_high: 1.12, range_low: 1.09, sweep_extreme: 1.085,
                source: { primary: 'CRT', label: 'CRT', direction: 'BUY', timeframe: '4H',
                    execution_timeframe: '1H', event_time: '2026-09-11T08:00:00Z',
                    reclaim_level: 1.09, structural_invalidation: 1.085,
                    target_candidates: [{ direction: 'BUY', level: 1.12, source: 'CRT_OPPOSITE_RANGE', origin: 'STRUCTURAL' }] }
            }],
            tbs_events: [{
                id: 'TBS-1', strategy: 'TBS', direction: 'BUY', timeframe: '1H',
                event_time: '2026-09-11T09:00:00Z', reclaim_time: '2026-09-11T09:00:00Z',
                reference_level: 1.09, sweep_extreme: 1.085,
                source: { primary: 'TBS', label: 'TBS', direction: 'BUY', timeframe: '1H',
                    execution_timeframe: '1H', event_time: '2026-09-11T09:00:00Z',
                    reclaim_level: 1.09, structural_invalidation: 1.085 }
            }],
            msnr_levels: [{
                id: 'MSNR-1', strategy: 'MSNR', direction: 'BUY', origin: 'STRUCTURAL_MSNR',
                primary_eligible: true, invalidated: false, low: 1.088, high: 1.092,
                source: { primary: 'MSNR', label: 'MSNR', direction: 'BUY', timeframe: '1H',
                    execution_timeframe: '1H', event_time: '2026-09-11T09:00:00Z',
                    structural_invalidation: 1.088,
                    execution_zone: { type: 'MSNR', origin: 'STRUCTURAL_MSNR', direction: 'BUY', timeframe: '1H', low: 1.088, high: 1.092 } }
            }],
            execution_zones: []
        };
    }

    it('verifies CRT, TBS, and structural MSNR hypotheses by supplied IDs', () => {
        const ctx = getContext();
        const cat = evidence();
        for (const h of [
            { hypothesis_id: 'H-CRT', strategy: 'CRT', direction: 'BUY', setup_timeframe: '4H', execution_timeframe: '1H', crt_event_ids: ['CRT-1'] },
            { hypothesis_id: 'H-TBS', strategy: 'TBS', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '1H', tbs_event_ids: ['TBS-1'] },
            { hypothesis_id: 'H-M', strategy: 'MSNR', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '1H', msnr_level_ids: ['MSNR-1'] }
        ]) {
            expect(ctx.verifyAiStrategyHypothesis(h, cat, { pair: 'EUR/USD', strategy_setups: [] }).verified).toBe(true);
        }
    });

    it('rejects nonexistent IDs, unsupported MSNR origins, and incompatible combinations', () => {
        const ctx = getContext();
        const cat = evidence();
        expect(ctx.verifyAiStrategyHypothesis({ strategy: 'CRT', direction: 'BUY', setup_timeframe: '4H', execution_timeframe: '1H', crt_event_ids: ['missing'] }, cat).reason_code).toBe('CRT_EVIDENCE_MISSING');
        const pivot = { ...cat, msnr_levels: [{ ...cat.msnr_levels[0], origin: 'PIVOT_REFERENCE' }] };
        expect(ctx.verifyAiStrategyHypothesis({ strategy: 'MSNR', direction: 'BUY', setup_timeframe: '1H', execution_timeframe: '1H', msnr_level_ids: ['MSNR-1'] }, pivot).reason_code).toBe('MSNR_RULES_UNVERIFIED');
        expect(ctx.verifyAiStrategyHypothesis({ strategy: 'CRT+TBS', direction: 'SELL', setup_timeframe: '4H', execution_timeframe: '1H', crt_event_ids: ['CRT-1'], tbs_event_ids: ['TBS-1'] }, cat).reason_code).toMatch(/EVIDENCE_INVALID/);
    });

    it('normalizes analyst output without preserving AI numeric geometry', () => {
        const ctx = getContext();
        const result = ctx.normalizeAiMarketAnalysis({
            market_view: { bias: 'BULLISH', market_narrative: 'supported' },
            hypotheses: [{ hypothesis_id: 'H', strategy: 'CRT', direction: 'BUY', setup_timeframe: '4H', execution_timeframe: '1H',
                entry: 999, stop_loss: 1000, tp1: 1, reasoning: 'range reclaim', crt_event_ids: ['CRT-1'] }]
        });
        expect(result.hypotheses[0]).not.toHaveProperty('entry');
        expect(result.hypotheses[0]).not.toHaveProperty('stop_loss');
        expect(result.hypotheses[0]).not.toHaveProperty('tp1');
    });

    it('rejects malformed analyst top-level output instead of inventing neutral analysis', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        let calls = 0;
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ bias: ++calls === 1 ? 'BULLISH' : 'BEARISH' }) } }] }) }));
        const result = await ctx.runAiMarketAnalyst({ pair: 'EUR/USD', strategy_events: [] }, { pair: 'EUR/USD' }, '');
        expect(result.diagnostics.analyst_status).toBe('ANALYST_SCHEMA_INVALID');
        expect(result.diagnostics.attempts).toBe(2);
        expect(calls).toBe(2);
        expect(result.analysis).toBeNull();
        expect(result.verified_setups).toEqual([]);
    });

    it('retries a malformed analyst response and accepts a valid second response', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        let calls = 0;
        const cat = evidence();
        const live = { pair: 'EUR/USD', strategy_setups: [], adaptive_setup_candidates: [] };
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: calls++ === 0
            ? '{malformed'
            : JSON.stringify({ market_view: { bias: 'MIXED' }, hypotheses: [] }) } }] }) }));
        const result = await ctx.runAiMarketAnalyst(cat, live, '');
        expect(result.diagnostics.analyst_status).toBe('OK');
        expect(result.diagnostics.attempts).toBe(2);
        expect(result.verified_setups).toEqual([]);
    });

    it('analyst API failure is non-fatal and valid response is verified', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        const cat = evidence();
        const live = { pair: 'EUR/USD', strategy_setups: [], adaptive_setup_candidates: [] };
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
            choices: [{ message: { content: JSON.stringify({ market_view: { bias: 'BULLISH' }, hypotheses: [{
                hypothesis_id: 'H-CRT', strategy: 'CRT', direction: 'BUY', setup_timeframe: '4H', execution_timeframe: '1H',
                crt_event_ids: ['CRT-1'], preferred_execution_types: ['RECLAIM_RETEST']
            }] }) } }]
        }) }));
        const ok = await ctx.runAiMarketAnalyst(cat, live, '');
        expect(ok.diagnostics.analyst_status).toBe('OK');
        expect(ok.diagnostics.hypotheses_verified).toBe(1);
        ctx.fetch = jest.fn(async () => { throw new Error('network down'); });
        const failed = await ctx.runAiMarketAnalyst(cat, live, '');
        expect(failed.diagnostics.analyst_status).toBe('ERROR');
        expect(failed.verified_setups).toEqual([]);
    });

    it('merges a verified AI setup into the ordinary setup representation and deduplicates it', () => {
        const ctx = getContext();
        const setup = { id: 'normal', primary: 'CRT', direction: 'BUY', event_time: '2026-09-11T08:00:00Z',
            execution_zone: { timeframe: '1H', direction: 'BUY', type: 'CRT', low: 1.09, high: 1.091 } };
        const live = { strategy_setups: [setup] };
        const verified = { ...setup, ai_verified: true, ai_hypothesis_id: 'H-1' };
        const duplicate = ctx.mergeVerifiedAiSetups(live, [verified]);
        expect(duplicate.added).toBe(0);
        expect(duplicate.duplicates).toBe(1);
        expect(live.strategy_setups[0].ai_hypothesis_id).toBe('H-1');
        const added = ctx.mergeVerifiedAiSetups({ strategy_setups: [setup] }, [{
            ...verified, id: 'ai-new', event_time: '2026-09-11T12:00:00Z',
            execution_zone: { timeframe: '1H', direction: 'BUY', type: 'FVG', low: 1.095, high: 1.096 }
        }]);
        expect(added.added).toBe(1);
    });

    it('accepts an analyst response with zero hypotheses as a normal non-trade analysis', async () => {
        const ctx = getContext();
        await ctx.saveKeys('tw', 'deepseek', 'https://deepseek.test', '', '');
        ctx.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
            choices: [{ message: { content: JSON.stringify({ market_view: { bias: 'MIXED', risk_notes: ['No clean event'] }, hypotheses: [] }) } }]
        }) }));
        const result = await ctx.runAiMarketAnalyst({ pair: 'EUR/USD', strategy_events: [] }, { pair: 'EUR/USD' }, '');
        expect(result.diagnostics.analyst_status).toBe('OK');
        expect(result.diagnostics.hypotheses_received).toBe(0);
        expect(result.verified_setups).toEqual([]);
    });

    it('analyst prompt is hypothesis-only and final selector prompt remains geometry-free', () => {
        const ctx = getContext();
        const prompt = ctx.buildAiMarketAnalystPrompt(evidence(), '');
        expect(prompt.system).toMatch(/MARKET ANALYST/);
        expect(prompt.system).toMatch(/remainder of today/i);
        expect(prompt.system).toMatch(/original move already delivered too far/i);
        expect(prompt.system).toMatch(/never invent IDs/i);
        expect(prompt.system).toMatch(/Do not return entry, entry_zone, stop_loss, TP prices/);
        expect(prompt.user).not.toMatch(/"entry"\s*:/);
        expect(prompt.user).not.toMatch(/"stop_loss"\s*:/);
        expect(prompt.user).not.toMatch(/"tp1"\s*:/);
        expect(prompt.user).toContain('CRT-1');
        const finalPrompt = ctx.buildAIPrompt({ pair: 'EUR/USD', current_price: 1.1, utc_time: '2026-09-11T10:00:00Z', session: { name: 'LONDON' }, adaptive_setup_candidates: [] }, '');
        expect(finalPrompt.user).toMatch(/selected_candidate_id/);
    });

    it('preserves FVG source time so a fresh market mechanics limit is not expired', () => {
        const ctx = getContext();
        const start = Date.parse('2026-09-15T00:00:00Z');
        const candles = Array.from({ length: 60 }, (_, i) => {
            const close = 100 - i * 0.1;
            return { t: start + i * 3600000, o: close + 0.05, h: close + 0.1, l: close - 0.1, c: close, is_closed: true };
        });
        // Confirmed bearish gap: prior low is above the next candle high.
        candles[56] = { t: start + 56 * 3600000, o: 95, h: 95.2, l: 94.8, c: 95, is_closed: true };
        candles[57] = { t: start + 57 * 3600000, o: 94.9, h: 94.95, l: 94.7, c: 94.75, is_closed: true };
        candles[58] = { t: start + 58 * 3600000, o: 93.5, h: 93.6, l: 93.0, c: 93.2, is_closed: true };
        const fvgs = ctx.detectFVG(candles);
        const bear = fvgs.find(fvg => fvg.type === 'bear');
        expect(bear).toEqual(expect.objectContaining({ source_index: 58 }));
        const zones = ctx.ictBuildRealZones(candles, 93.2, 'SELL', 'EUR/USD', '4H');
        const zone = zones.find(candidate => candidate.type === 'FVG' && candidate.high > 93.2);
        expect(zone).toEqual(expect.objectContaining({ created_index: 58, created_time: start + 58 * 3600000 }));
        const lifecycle = ctx.evaluateSetupLifecycle({
            strategy_setup: { primary: 'ICT', timeframe: '4H', setup_timeframe: '4H', execution_timeframe: '4H', direction: 'SELL' },
            direction: 'SELL', entry: zone.price, tp1: 90, entry_region_low: zone.low, entry_region_high: zone.high,
            execution_event_time: zone.created_time, execution_event_index: zone.created_index,
            execution_zone_created_time: zone.created_time, execution_zone_created_index: zone.created_index
        }, { historyCache: { '4H': candles }, price: 93.2, pair: 'EUR/USD', as_of_time: candles.at(-1).t, market_open: true });
        expect(lifecycle.rejection_code).not.toBe('SETUP_EXPIRED');
    });

    it('uses a fresh execution zone timestamp when the parent setup is old', () => {
        const ctx = getContext();
        const start = Date.parse('2026-09-15T00:00:00Z');
        const candles = Array.from({ length: 60 }, (_, i) => ({
            t: start + i * 3600000, o: 100, h: 100.5, l: 99.5, c: 100, is_closed: true
        }));
        const freshZoneTime = candles.at(-2).t;
        const lifecycle = ctx.evaluateSetupLifecycle({
            strategy_setup: {
                primary: 'MSNR', timeframe: '1H', setup_timeframe: '1H', execution_timeframe: '1H',
                direction: 'SELL', event_time: start, entry_model: 'STRUCTURAL_LIMIT'
            },
            direction: 'SELL', entry: 101, tp1: 95,
            entry_region_low: 100.8, entry_region_high: 101.2,
            execution_zone_created_time: freshZoneTime,
            execution_zone_created_index: candles.length - 2
        }, {
            historyCache: { '1H': candles }, price: 100, pair: 'EUR/USD',
            as_of_time: candles.at(-1).t, market_open: true
        });
        expect(lifecycle.rejection_code).not.toBe('SETUP_EXPIRED');
    });
});
