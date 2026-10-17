'use strict';

const { MAGNITUDE_BINS, SUPPORT_BINS, binnedStatistics, policyComparison, statistics } = require('./kronos-research');

function row(overrides = {}) {
    return {
        candidate_id: 'candidate',
        symbol: 'AUD/USD',
        first_selected_at_ms: Date.parse('2026-10-01T00:00:00Z'),
        score: 50,
        kronos_alignment: 'ALIGNED',
        analysis: { ANALYSIS_4H_BARRIER_BEFORE_TP1: 'NO' },
        simulation: { final_outcome: 'SL', r_result: -1, tp1_before_sl: false, targets_reached: [false, false, false] },
        ...overrides
    };
}

describe('offline Kronos authority research', () => {
    test('reports the requested historical outcome fields', () => {
        const result = statistics([
            row(),
            row({ simulation: { final_outcome: 'TP3', r_result: 3, tp1_before_sl: false, targets_reached: [true, true, true] } })
        ]);
        expect(result).toMatchObject({ count: 2, sl: 1, tp1_plus: 1, tp2_plus: 1, tp3: 1, total_r: 2, median_r: 1, sl_before_tp1_rate: 0.5 });
    });

    test('keeps path-support and magnitude bins fixed and descriptive', () => {
        const items = [
            row({ forecast: { kronos_tp1_path_support: 0.25, kronos_upside_r: -0.5 } }),
            row({ forecast: { kronos_tp1_path_support: 1, kronos_upside_r: 1 } })
        ];
        expect(Object.keys(binnedStatistics(items, item => item.forecast.kronos_tp1_path_support, SUPPORT_BINS).bins)).toEqual(['0-0.25', '0.25-0.50', '0.50-0.75', '0.75-1.00']);
        expect(Object.keys(binnedStatistics(items, item => item.forecast.kronos_upside_r, MAGNITUDE_BINS).bins)).toEqual(['< -0.5R', '-0.5R to 0', '0 to +0.5R', '+0.5R to +1R', '> +1R']);
    });

    test('policy comparison does not turn neutral or unavailable into conflict', () => {
        const aligned = row({ candidate_id: 'aligned', kronos_alignment: 'ALIGNED' });
        const conflict = row({ candidate_id: 'conflict', kronos_alignment: 'CONFLICT' });
        const neutral = row({ candidate_id: 'neutral', kronos_alignment: 'NEUTRAL' });
        const result = policyComparison([aligned, conflict, neutral]);
        expect(result.A_BASELINE.count).toBe(3);
        expect(result.B_CONFLICT_BLOCKER.count).toBe(2);
        expect(result.B_CONFLICT_BLOCKER.losers_removed).toBe(1);
    });
});
