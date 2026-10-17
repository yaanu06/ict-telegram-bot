'use strict';

const {
    build4HStateHistory,
    getActive4HState,
    buildImpulseLineage,
    align1HEventsTo4HState
} = require('./market-state');

function candles(count = 12) {
    return Array.from({ length: count }, (_, index) => ({
        t: index * 14400000,
        o: 100,
        h: 102,
        l: 98,
        c: 100,
        close_time_ms: (index + 1) * 14400000,
        is_closed: true
    }));
}

function activation(id, direction, index, invalidationPrice = null) {
    return {
        id,
        direction,
        index,
        first_knowable_ms: (index + 1) * 14400000,
        origin_event_ref: id,
        supporting_refs: [`SUPPORT:${id}`],
        invalidation_price: invalidationPrice,
        invalidation_ref: `INVALIDATION:${id}`
    };
}

describe('persistent deterministic 4H state', () => {
    test('event creates a stable state and it persists across later scans', () => {
        const history = build4HStateHistory({ symbol: 'AUD/USD', candles: candles(), activationEvents: [activation('E1', 'SELL', 2)] });
        expect(history.states[0].state_id).toBe('4H_STATE:AUD/USD:SELL:E1');
        expect(getActive4HState(history, 4 * 14400000).state_id).toBe(history.states[0].state_id);
        expect(getActive4HState(history, 8 * 14400000).state_id).toBe(history.states[0].state_id);
    });

    test('a later 1H event can consume the existing active state', () => {
        const history = build4HStateHistory({ symbol: 'GBP/JPY', candles: candles(), activationEvents: [activation('E1', 'SELL', 2)] });
        const result = align1HEventsTo4HState({
            stateHistory: history,
            events: [{ id: 'H1', direction: 'SELL', first_knowable_ms: 5 * 14400000 }]
        });
        expect(result[0].relation).toBe('ALIGNED');
        expect(result[0].state_id).toBe(history.states[0].state_id);
    });

    test('state invalidates only after the closed candle breaches its structural price', () => {
        const series = candles();
        series[5] = { ...series[5], c: 110 };
        const history = build4HStateHistory({ symbol: 'XAU/USD', candles: series, activationEvents: [activation('E1', 'SELL', 2, 105)] });
        expect(history.states[0].status).toBe('INVALIDATED');
        expect(history.states[0].invalidation_reason).toBe('INVALIDATION_PRICE_BREACHED');
        expect(getActive4HState(history, 5 * 14400000).state_id).toBe(history.states[0].state_id);
        expect(getActive4HState(history, 6 * 14400000)).toBeNull();
    });

    test('opposite state supersedes the old state without deleting its history', () => {
        const history = build4HStateHistory({
            symbol: 'AUD/USD',
            candles: candles(),
            activationEvents: [activation('E1', 'SELL', 2), activation('E2', 'BUY', 6)]
        });
        expect(history.states).toHaveLength(2);
        expect(history.states[0].status).toBe('SUPERSEDED');
        expect(history.states[0].superseded_by_ref).toBe('E2');
        expect(getActive4HState(history, 4 * 14400000).direction).toBe('SELL');
        expect(getActive4HState(history, 8 * 14400000).direction).toBe('BUY');
    });

    test('state is not visible before its first-knowable time', () => {
        const history = build4HStateHistory({ symbol: 'AUD/USD', candles: candles(), activationEvents: [activation('E1', 'BUY', 4)] });
        expect(getActive4HState(history, 4 * 14400000)).toBeNull();
        expect(getActive4HState(history, 5 * 14400000).direction).toBe('BUY');
    });
});

describe('deterministic impulse and setup lineage', () => {
    const context = {
        buildInstitutionalDisplacementFacts: () => [{ id: 'D1', direction: 'SELL', index: 2, event_time: new Date(3 * 14400000).toISOString(), evidence_ids: ['D1'] }],
        detectFVG: () => [
            { type: 'bear', l: 101, h: 103, source_index: 3, first_knowable_time: new Date(4 * 14400000).toISOString() },
            { type: 'bull', l: 97, h: 99, source_index: 3, first_knowable_time: new Date(4 * 14400000).toISOString() },
            { type: 'bear', l: 104, h: 106, source_index: 1, first_knowable_time: new Date(2 * 14400000).toISOString() }
        ]
    };

    test('impulse, parent FVG, and setup event IDs are stable across scans', () => {
        const first = buildImpulseLineage({ symbol: 'AUD/USD', timeframe: '15M', candles: candles(), context });
        const second = buildImpulseLineage({ symbol: 'AUD/USD', timeframe: '15M', candles: candles(), context });
        expect(first.impulses[0].impulse_id).toBe(second.impulses[0].impulse_id);
        expect(first.zones[0].parent_impulse_id).toBe(first.impulses[0].impulse_id);
        expect(first.setup_events[0].setup_event_id).toBe(second.setup_events[0].setup_event_id);
    });

    test('unrelated, future, and opposite-direction FVGs are not linked', () => {
        const result = buildImpulseLineage({ symbol: 'AUD/USD', timeframe: '15M', candles: candles(), context });
        expect(result.zones[0].relation_to_impulse).toBe('CREATED_BY_IMPULSE');
        expect(result.zones[1].parent_impulse_id).toBeNull();
        expect(result.zones[2].parent_impulse_id).toBeNull();
    });

    test('lineage first-knowable time never precedes its parent impulse', () => {
        const result = buildImpulseLineage({ symbol: 'AUD/USD', timeframe: '15M', candles: candles(), context });
        const impulse = result.impulses[0];
        const linked = result.zones.find(zone => zone.parent_impulse_id === impulse.impulse_id);
        expect(linked.first_knowable_ms).toBeGreaterThanOrEqual(impulse.first_knowable_ms);
    });
});
