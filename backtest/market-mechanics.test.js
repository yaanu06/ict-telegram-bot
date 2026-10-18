'use strict';

const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');

function candles(count = 48) {
    return Array.from({ length: count }, (_, index) => {
        const wave = index % 8;
        const high = 100 + index * 0.2 + (wave === 4 ? 2 : 0);
        const low = 98 + index * 0.2 - (wave === 0 ? 2 : 0);
        const close = (high + low) / 2;
        return {
            t: Date.parse('2026-01-01T00:00:00Z') + index * 4 * 60 * 60 * 1000,
            o: close - 0.1,
            h: high,
            l: low,
            c: close,
            is_closed: true
        };
    });
}

describe('V2 Market Mechanics hierarchy', () => {
    test('builds a plan before entry-model selection', () => {
        const context = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' });
        const history = candles();
        const plan = context.buildMarketMechanicsPlan({
            pair: 'AUD/USD',
            price: 105.2,
            asOfMs: history.at(-1).t,
            historyCache: { '1D': history.slice(-20), '4H': history, '1H': history },
            structure: {
                '1D': { structural_trend: 'BULLISH' },
                '4H': { structural_trend: 'BULLISH' },
                '1H': { structural_trend: 'BEARISH' }
            },
            zones: [{ id: 'demand-1', type: 'DEMAND', direction: 'BUY', timeframe: '4H', low: 103, high: 104, freshness: 'FRESH' }],
            targetCandidates: { all: [{ id: 'PDH-1', source: 'PDH', direction: 'BUY', level: 110, timeframe: '1D' }] },
            marketContext: {}
        });
        expect(plan.bias).toBe('BULLISH');
        expect(['PULLBACK', 'CONTINUATION']).toContain(plan.narrative);
        expect(plan.location).toBe('DISCOUNT');
        expect(plan.active_poi.id).toBe('demand-1');
        expect(plan.primary_draw_on_liquidity.price).toBeGreaterThan(105.2);
        expect(plan.evidence_refs).toContain('demand-1');
    });

    test('does not authorize a middle-of-range lower-timeframe pattern without a POI', () => {
        const context = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' });
        const history = candles();
        const plan = context.buildMarketMechanicsPlan({
            pair: 'GBP/JPY',
            price: 106,
            asOfMs: history.at(-1).t,
            historyCache: { '4H': history, '1H': history },
            structure: { '4H': { structural_trend: 'BULLISH' }, '1H': { structural_trend: 'BULLISH' } },
            zones: [],
            targetCandidates: { all: [{ source: 'SWING_HIGH', direction: 'BUY', level: 110, timeframe: '4H' }] },
            marketContext: {}
        });
        expect(plan.active_poi).toBeNull();
        expect(plan.state).toBe('WAITING_FOR_LOCATION');
        expect(plan.valid_context).toBe(true);
    });

    test('plan reconstruction ignores candles and objectives after its closed-candle cutoff', () => {
        const context = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' });
        const history = candles();
        const cutoff = history[history.length - 1].t;
        const future = { ...history.at(-1), t: cutoff + 4 * 60 * 60 * 1000, h: 1000, c: 999, l: 998, o: 999 };
        const plan = context.buildMarketMechanicsPlan({
            pair: 'XAU/USD', price: 105, asOfMs: cutoff,
            historyCache: { '4H': [...history, future], '1H': history, '1D': history.slice(-20) },
            structure: { '4H': { structural_trend: 'BULLISH' }, '1H': { structural_trend: 'BULLISH' } },
            zones: [{ id: 'demand-old', type: 'DEMAND', direction: 'BUY', timeframe: '4H', low: 103, high: 104, freshness: 'FRESH' }],
            targetCandidates: { all: [{ id: 'future-target', direction: 'BUY', level: 1000, timeframe: '4H', created_time: future.t }] },
            marketContext: {}
        });
        expect(plan.active_swing_high).toBeLessThan(1000);
        expect(plan.primary_draw_on_liquidity?.price).not.toBe(1000);
    });

    test('entry model selection is subordinate to the plan and produces canonical models', () => {
        const context = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' });
        expect(context.marketMechanicsEntryModelForSetup({ execution_zone: { type: 'FLIP' } })).toBe('FLIP_ZONE');
        expect(context.marketMechanicsEntryModelForSetup({ execution_zone: { type: 'FVG' }, execution_model: 'FRESH_RETRACEMENT_LIMIT' })).toBe('LIQUIDITY_OB_FVG');
        expect(context.marketMechanicsEntryModelForSetup({ execution_model: 'CONFIRMATION_ENTRY', execution_confirmed: true })).toBe('MARKET_SHIFT');
    });

    test('legacy model router remains an explicit rollback mode', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        expect(context.rawTextV2StrategyMode()).toBe('MODEL_ROUTER');
        const market = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' });
        expect(market.rawTextV2StrategyMode()).toBe('MARKET_MECHANICS');
    });

    test('historical adapter uses Market Mechanics candidates instead of legacy FVG records', () => {
        const context = {
            window: { __V2_STRATEGY_MODE__: 'MARKET_MECHANICS' },
            buildLiveMarketContext: jest.fn(() => ({
                daily_bias: 'BULLISH',
                market_plan: { plan_id: 'PLAN:1', bias: 'BULLISH' },
                market_mechanics: { authority: 'MARKET_PLAN->POI->ENTRY_MODEL' },
                adaptive_setup_candidates: [{
                    id: 'MM-CANDIDATE-1', direction: 'BUY', timeframe: '1H',
                    zone: { id: 'ZONE:1', low: 99, high: 100, created_time: '2026-01-01T00:00:00.000Z' },
                    entry: 99.5, stop_loss: 98, tp1: 102, tp2: null, tp3: null,
                    score: 80, TRADE_QUALIFIED: 'YES', freshness: 'FRESH'
                }]
            }))
        };
        const result = analyzeVisibleHistory(context, {
            strategyMode: 'MARKET_MECHANICS',
            symbol: 'AUD/USD',
            currentPrice: 100.5,
            asOfMs: Date.parse('2026-01-02T00:00:00.000Z'),
            blocks: [{ timeframe: '1H', candles: [] }, { timeframe: '5M', candles: [] }]
        });
        expect(context.buildLiveMarketContext).toHaveBeenCalledTimes(1);
        expect(result.zones.current_records).toHaveLength(1);
        expect(result.zones.current_records[0].candidate.action).toBe('BUY_LIMIT');
        expect(result.zones.current_records[0].fvg.c1).toBe('MM:MM-CANDIDATE-1');
        expect(result.zones.model_router).toBeNull();
    });
});
