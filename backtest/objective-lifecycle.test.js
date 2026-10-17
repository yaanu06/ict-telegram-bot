'use strict';

const {
    build1HEvents,
    eventRole,
    objectiveChain
} = require('./objective-lifecycle');

function bars(count = 8, timeframeMs = 3600000) {
    return Array.from({ length: count }, (_, index) => ({
        t: index * timeframeMs,
        o: 100,
        h: 102,
        l: 98,
        c: 100,
        close_time_ms: (index + 1) * timeframeMs,
        is_closed: true
    }));
}

describe('objective lifecycle diagnostics', () => {
    test('enumerates only knowable directional objectives and preserves hierarchy metadata', () => {
        const series = {
            '1h': bars(),
            '4h': bars(8, 14400000)
        };
        const context = {
            findSwings: (candles, lookback) => lookback === 2
                ? {
                    H: [
                        { i: 1, p: 108 },
                        { i: 5, p: 115 }
                    ],
                    L: [
                        { i: 2, p: 94 },
                        { i: 6, p: 90 }
                    ]
                }
                : { H: [], L: [] },
            buildRawTextSupplyDemandAudit: () => []
        };

        const chain = objectiveChain({
            symbol: 'TEST',
            direction: 'BUY',
            price: 100,
            asOfMs: 10 * 3600000,
            series,
            context
        });

        expect(chain.length).toBeGreaterThan(0);
        expect(chain.every(item => item.price > 100 && item.first_knowable_ms <= 10 * 3600000)).toBe(true);
        expect(chain.map(item => item.distance)).toEqual([...chain.map(item => item.distance)].sort((a, b) => a - b));
        expect(chain[0].objective_rank).toBe(1);
        expect(chain[0].objective_chain_id).toContain('OBJECTIVE_CHAIN:TEST:BUY:36000000');
        expect(chain[0].farther_objective_id).toBe(chain[1]?.objective_id || null);
        expect(chain.at(-1).nearer_objective_id).toBe(chain.at(-2)?.objective_id || null);
        expect(chain.find(item => item.tf === '4H').classification).toBe('PRIMARY');
    });

    test('does not expose a swing before its confirmation candle closes', () => {
        const series = { '1h': bars(), '4h': bars(8, 14400000) };
        const context = {
            findSwings: () => ({ H: [{ i: 5, p: 115 }], L: [] }),
            buildRawTextSupplyDemandAudit: () => []
        };
        const chain = objectiveChain({
            symbol: 'TEST',
            direction: 'BUY',
            price: 100,
            asOfMs: 5 * 3600000,
            series,
            context
        });
        expect(chain).toHaveLength(0);
    });

    test('classifies reversal, continuation, and displacement events without changing strategy behavior', () => {
        expect(eventRole({ bridge_type: 'DISPLACEMENT', event_type: 'BOS' })).toBe('DISPLACEMENT');
        expect(eventRole({ event_type: 'MSS' })).toBe('REVERSAL_EVENT');
        expect(eventRole({ event_type: 'BOS' })).toBe('CONTINUATION_EVENT');
        expect(eventRole({ event_type: 'UNKNOWN' })).toBe('STRUCTURAL_EVENT');
    });

    test('builds deterministic 1H event refs and first-knowable times', () => {
        const context = {
            buildInstitutionalDisplacementFacts: () => [{ id: 'D1', direction: 'SELL', index: 2 }],
            buildInstitutionalStructureFacts: () => [{ id: 'B1', direction: 'SELL', index: 3, event_type: 'BOS' }]
        };
        const events = build1HEvents({ symbol: 'TEST', candles: bars(), context });
        expect(events).toHaveLength(2);
        expect(events[0].first_knowable_ms).toBe(3 * 3600000);
        expect(events[0].event_ref).toBe('D1');
        expect(events[1].event_ref).toBe('B1');
        expect(events[1].event_role).toBe('CONTINUATION_EVENT');
    });
});
