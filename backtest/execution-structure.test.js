'use strict';

const {
    buildFastStructureEvents,
    normalizeStructureEvents,
    buildLiquiditySweeps,
    buildExecutionSequences,
    buildExecutionPrimitives
} = require('./execution-structure');

function candles(rows, interval = 900000) {
    return rows.map((row, index) => ({
        t: index * interval,
        o: row[0], h: row[1], l: row[2], c: row[3],
        is_closed: true,
        close_time_ms: (index + 1) * interval
    }));
}

function contextFor(swings, displacementIndex = 6) {
    return {
        findSwings: () => swings,
        buildInstitutionalDisplacementFacts: () => [{
            id: `D:${displacementIndex}`,
            direction: 'BUY',
            index: displacementIndex,
            event_time: new Date((displacementIndex + 1) * 900000).toISOString(),
            evidence_ids: [`D:${displacementIndex}`]
        }],
        detectFVG: () => [{ type: 'bull', l: 104, h: 105, source_index: displacementIndex + 1 }]
    };
}

describe('structure-driven execution primitives', () => {
    test('BOS uses a confirmed swing and a closed break candle with stable first-knowable time', () => {
        const bars = candles([
            [100, 101, 99, 100], [100, 102, 98, 101], [101, 103, 100, 102],
            [102, 104, 101, 103], [103, 105, 102, 104], [104, 106, 103, 105],
            [105, 108, 104, 107]
        ]);
        const swings = {
            H: [{ i: 1, p: 102, first_knowable_time: 3 * 900000 }, { i: 3, p: 104, first_knowable_time: 5 * 900000 }],
            L: [{ i: 1, p: 98, first_knowable_time: 3 * 900000 }, { i: 3, p: 101, first_knowable_time: 5 * 900000 }]
        };
        const context = contextFor(swings);
        const events = normalizeStructureEvents({ context, candles: bars, timeframe: '15m', symbol: 'TEST' });
        const event = events.find(item => item.direction === 'BUY');
        expect(event).toBeTruthy();
        expect(['BOS', 'MSS']).toContain(event.type);
        expect(event.first_knowable_ms).toBe((event.index + 1) * 900000);
        expect(event.structure_event_id).toBe(event.id);
    });

    test('a sweep cannot use a liquidity pivot before that pivot is confirmed', () => {
        const bars = candles([
            [101, 103, 99, 102], [102, 104, 100, 103], [103, 105, 98, 101],
            [101, 104, 99, 102], [102, 103, 100, 101], [101, 104, 97, 101],
            [103, 105, 101, 104]
        ]);
        const latePivot = { H: [], L: [{ i: 2, p: 98, first_knowable_time: 6 * 900000 }] };
        const sweeps = buildLiquiditySweeps({ context: { findSwings: () => latePivot }, candles: bars, timeframe: '15m', symbol: 'TEST' });
        expect(sweeps.some(item => item.liquidity_price === 98 && item.index < 6)).toBe(false);
    });

    test('a confirmed swing sweep requires a beyond-level trade and reclaim close', () => {
        const bars = candles([
            [101, 103, 99, 102], [102, 104, 100, 103], [103, 105, 98, 101],
            [101, 104, 99, 102], [102, 103, 100, 101], [101, 104, 97, 101],
            [103, 105, 101, 104]
        ]);
        const confirmedPivot = { H: [], L: [{ i: 1, p: 100, first_knowable_time: 3 * 900000 }] };
        const sweeps = buildLiquiditySweeps({ context: { findSwings: () => confirmedPivot }, candles: bars, timeframe: '15m', symbol: 'TEST' });
        expect(sweeps.some(item => item.liquidity_price === 100 && item.direction === 'BUY' && item.reclaimed === true)).toBe(true);
    });

    test('originating OB is causally tied to the structure event and displacement', () => {
        const bars = candles([
            [100, 101, 99, 100], [100, 102, 98, 101], [101, 103, 100, 102],
            [102, 104, 101, 103], [103, 105, 102, 104], [105, 106, 103, 104],
            [104, 108, 103, 107], [107, 109, 106, 108]
        ]);
        const swings = {
            H: [{ i: 1, p: 102, first_knowable_time: 3 * 900000 }, { i: 3, p: 104, first_knowable_time: 5 * 900000 }],
            L: [{ i: 1, p: 98, first_knowable_time: 3 * 900000 }, { i: 3, p: 101, first_knowable_time: 5 * 900000 }]
        };
        const context = contextFor(swings, 6);
        const sequences = buildExecutionSequences({ context, candles: bars, timeframe: '15m', symbol: 'TEST' });
        const sequence = sequences.find(item => item.direction === 'BUY');
        expect(sequence).toBeTruthy();
        expect(sequence.setup_family).toBe('CONTINUATION');
        expect(sequence.ob.parent_structure_event_id).toBe(sequence.structure_event_id);
        expect(sequence.ob.parent_impulse_id).toBe(sequence.impulse_id);
        expect(sequence.fvg?.ref).toContain('FVG:15M');
    });

    test('repeated primitive scans preserve impulse, OB, and setup IDs', () => {
        const bars = candles([
            [100, 101, 99, 100], [100, 102, 98, 101], [101, 103, 100, 102],
            [102, 104, 101, 103], [103, 105, 102, 104], [105, 106, 103, 104],
            [104, 108, 103, 107], [107, 109, 106, 108]
        ]);
        const swings = {
            H: [{ i: 1, p: 102, first_knowable_time: 3 * 900000 }, { i: 3, p: 104, first_knowable_time: 5 * 900000 }],
            L: [{ i: 1, p: 98, first_knowable_time: 3 * 900000 }, { i: 3, p: 101, first_knowable_time: 5 * 900000 }]
        };
        const context = contextFor(swings, 6);
        const first = buildExecutionPrimitives({ context, candles: bars, timeframe: '15m', symbol: 'TEST' });
        const second = buildExecutionPrimitives({ context, candles: bars, timeframe: '15m', symbol: 'TEST' });
        expect(first.sequences.map(item => item.setup_event_id)).toEqual(second.sequences.map(item => item.setup_event_id));
        expect(first.sequences.map(item => item.impulse_id)).toEqual(second.sequences.map(item => item.impulse_id));
    });
});
