'use strict';

const { loadStrategyContext } = require('./strategy-adapter');

function executionRecord({ c3 = '2026-01-01T00:15:00Z', status = 'UNTOUCHED' } = {}) {
    return {
        fvg: {
            type: 'BULLISH',
            timeframe: '1H',
            c1: '2026-01-01T00:00:00Z',
            c2: '2026-01-01T00:05:00Z',
            c3,
            lower: 99,
            upper: 100,
            remaining_lower: 99,
            remaining_upper: 100,
            status
        },
        candidate: { action: 'BUY_LIMIT', entry: 99.5, stop_loss: 98, tp1: 101, tp2: 102, tp3: 103, risk: 1.5 },
        current: { current_opportunity: true, opportunity_status: 'ACTIVE_PENDING' },
        delivery: { entry_state: 'PENDING_UNFILLED', delivery_status: 'FRESH' },
        block: { timeframe: '1H', candles: [] },
        score: 50,
        confluence: { crt: [], msnr: [] }
    };
}

describe('V2 model router authority and chronology', () => {
    test('adapter defaults to legacy control mode and accepts explicit router mode', () => {
        const legacy = loadStrategyContext();
        expect(legacy.window.__V2_STRATEGY_MODE__).toBe('LEGACY');
        const router = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        expect(router.window.__V2_STRATEGY_MODE__).toBe('MODEL_ROUTER');
    });

    test('target geometry is a hard model-router invariant', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        expect(context.rawTextModelGeometry(
            { entry: 100, stop_loss: 95, tp1: 101 }, 'BUY', { price: 102, type: 'LIQUIDITY', ref: 'x' }
        ).valid).toBe(true);
        expect(context.rawTextModelGeometry(
            { entry: 100, stop_loss: 105, tp1: 101 }, 'SELL', { price: 99, type: 'LIQUIDITY', ref: 'x' }
        ).valid).toBe(false);
        expect(context.rawTextModelGeometry(
            { entry: 100, stop_loss: 105, tp1: 101 }, 'SELL', { price: 99, type: 'LIQUIDITY', ref: 'x' }
        ).reason).toBe('INVALID_TARGET_DIRECTION');
    });

    test('router cannot authorize a legacy execution zone without a model event', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const result = context.buildV2ModelRouter({
            blocks: [],
            currentPrice: 101,
            precision: 2,
            strategyAudits: { as_of_ms: Date.parse('2026-01-01T01:00:00Z') },
            marketContext: { as_of_ms: Date.parse('2026-01-01T01:00:00Z'), daily_bias: 'BULLISH' },
            executionRecords: [executionRecord()]
        });
        expect(result.records).toHaveLength(0);
        expect(result.diagnostics.rejection_reasons.NO_COMPLETE_MODEL).toBe(1);
    });

    test('future execution zones cannot be linked to a known model timestamp', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const match = context.rawTextModelFindZone(
            [executionRecord({ c3: '2026-01-01T02:00:00Z' })],
            'BUY',
            Date.parse('2026-01-01T01:00:00Z'),
            Date.parse('2026-01-01T01:30:00Z'),
            {},
            null
        );
        expect(match).toBeNull();
    });

    test('router exposes explicit model diagnostics rather than score-only authority', () => {
        const context = loadStrategyContext({ strategyMode: 'MODEL_ROUTER' });
        const result = context.buildRawTextHighProbabilityZones(
            [], 100, 2,
            { strategy_mode: 'MODEL_ROUTER', as_of_ms: Date.parse('2026-01-01T01:00:00Z') },
            { as_of_ms: Date.parse('2026-01-01T01:00:00Z'), daily_bias: 'NEUTRAL' },
            { daily_bias: 'NEUTRAL' }
        );
        expect(result.strategy_mode).toBe('MODEL_ROUTER');
        expect(result.model_router).toHaveProperty('rejection_reasons');
        expect(result.current_records).toHaveLength(0);
    });
});
