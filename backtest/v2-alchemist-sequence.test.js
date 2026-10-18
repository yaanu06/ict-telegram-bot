'use strict';

const { evaluateCandidate, sessionContext } = require('./v2-alchemist-sequence');

function baseIndex(overrides = {}) {
    return {
        directionStates: { active: { state_id: 'STATE-1', direction: 'BUY' } },
        candidates: { '1H': { crt: [], tbs: [], msnr: [] }, '15M': { crt: [], tbs: [], msnr: [] } },
        primitives: { '1H': { structures: [], displacements: [], sequences: [] }, '15M': { structures: [], displacements: [], sequences: [] } },
        session: { session: 'LONDON', killzone_active: true },
        ...overrides
    };
}

function candidate(overrides = {}) {
    return {
        side: 'BUY',
        entry: 100,
        stop_loss: 98,
        tp1: 104,
        fvg_zone_low: 99.5,
        fvg_zone_high: 100.5,
        fvg_status: 'UNTOUCHED',
        pre_entry_progress: 0,
        execution_5m: 'CONFIRMED',
        first_knowable_ms: 2000,
        clear_path_to_tp1: 'YES',
        entry_inside_opposing_4h: 'NO',
        ...overrides
    };
}

describe('V2 chronological storyline qualification', () => {
    test('CRT can be the manipulation/confirmation evidence without requiring TBS and MSNR', () => {
        const index = baseIndex({ candidates: { '1H': { crt: [{ id: 'CRT-1', direction: 'BUY', first_knowable_ms: 1000, reclaim_level: 99 }], tbs: [], msnr: [] }, '15M': { crt: [], tbs: [], msnr: [] } } });
        const result = evaluateCandidate({ candidate: candidate({ crt_refs: ['CRT-1'] }), index, mode: 'FULL_INTEGRATED', asOfMs: 3000 });
        expect(result.qualified).toBe(true);
        expect(result.setup_family).toBe('CRT+FVG');
    });

    test('future CRT evidence cannot validate an earlier opportunity', () => {
        const index = baseIndex({ candidates: { '1H': { crt: [{ id: 'CRT-FUTURE', direction: 'BUY', first_knowable_ms: 4000, reclaim_level: 99 }], tbs: [], msnr: [] }, '15M': { crt: [], tbs: [], msnr: [] } } });
        const result = evaluateCandidate({ candidate: candidate({ first_knowable_ms: 2000 }), index, mode: 'FULL_INTEGRATED', asOfMs: 3000 });
        expect(result.qualified).toBe(false);
        expect(result.rejection_reason).toBe('NO_LIQUIDITY_EVENT');
    });

    test('MSNR is a location role and can combine with TBS without CRT', () => {
        const index = baseIndex({ candidates: {
            '1H': { crt: [], tbs: [{ id: 'TBS-1', direction: 'BUY', first_knowable_ms: 1000, reclaim_level: 99 }], msnr: [{ id: 'MSNR-1', direction: 'BUY', first_knowable_ms: 900, freshness: 'FRESH', zone_low: 99.5, zone_high: 100.5 }] },
            '15M': { crt: [], tbs: [], msnr: [] }
        } });
        const result = evaluateCandidate({ candidate: candidate({ tbs_refs: ['TBS-1'], msnr_refs: ['MSNR-1'] }), index, mode: 'FULL_INTEGRATED', asOfMs: 3000 });
        expect(result.qualified).toBe(true);
        expect(result.setup_family).toBe('MSNR+TBS+FVG');
    });

    test('session labels follow London and New York DST transitions', () => {
        const beforeUsDst = sessionContext(Date.parse('2026-03-06T13:30:00Z'), []);
        const afterUsDst = sessionContext(Date.parse('2026-03-09T13:30:00Z'), []);
        expect(beforeUsDst.new_york_local_hour).toBe(8.5);
        expect(afterUsDst.new_york_local_hour).toBe(9.5);
        expect(beforeUsDst.london_local_hour).toBe(13.5);
        expect(afterUsDst.london_local_hour).toBe(13.5);
    });
});
