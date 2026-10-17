'use strict';

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
    const numbers = values.filter(Number.isFinite);
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function groupStats(rows, key) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[key] ?? 'UNKNOWN';
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(row);
    }
    return Object.fromEntries([...groups.entries()].map(([value, items]) => [value, summarize(items)]));
}

function summarize(trades = []) {
    const results = trades.map(item => item.simulation || item).filter(item => item && item.final_outcome);
    const r = results.map(item => Number(item.r_result)).filter(Number.isFinite);
    let losingStreak = 0;
    let maxLosingStreak = 0;
    for (const value of r) {
        if (value < 0) { losingStreak += 1; maxLosingStreak = Math.max(maxLosingStreak, losingStreak); }
        else losingStreak = 0;
    }
    const count = results.length;
    const countOutcome = outcome => results.filter(item => item.final_outcome === outcome).length;
    return {
        sample_size: count,
        filled: results.filter(item => item.fill_time_ms != null).length,
        not_filled: countOutcome('NOT_FILLED') + countOutcome('EXPIRED'),
        sl: countOutcome('SL'),
        tp1: countOutcome('TP1'),
        tp2: countOutcome('TP2'),
        tp3: countOutcome('TP3'),
        ambiguous: countOutcome('AMBIGUOUS'),
        tp1_before_sl_count: results.filter(item => item.tp1_before_sl === true).length,
        tp1_before_sl_rate: count ? results.filter(item => item.tp1_before_sl === true).length / count : null,
        total_r: r.reduce((sum, value) => sum + value, 0),
        average_r: r.length ? r.reduce((sum, value) => sum + value, 0) / r.length : null,
        expectancy_r: r.length ? r.reduce((sum, value) => sum + value, 0) / r.length : null,
        median_r: median(r),
        max_losing_streak: maxLosingStreak,
        average_mfe_r: average(results.map(item => Number(item.mfe_r))),
        average_mae_r: average(results.map(item => Number(item.mae_r)))
    };
}

function buildSummary(replay, metadata = {}) {
    const all = replay.trades || [];
    return {
        ...metadata,
        total_candidates: replay.candidates.length,
        selected_candidates: replay.selected.length,
        rejected_candidates: replay.rejected.length,
        replay_observations: replay.observations.length,
        replay_clocks: replay.clocks,
        outcomes: summarize(all),
        by_side: groupStats(all, 'side'),
        by_timeframe: groupStats(all, 'timeframe'),
        by_quality: groupStats(all, 'quality'),
        by_daily_alignment: groupStats(all, 'daily_bias'),
        by_displacement: groupStats(all, 'displacement'),
        by_crt: groupStats(all.map(item => ({ ...item, crt: (item.crt_refs || []).length ? 'YES' : 'NO' })), 'crt'),
        by_msnr: groupStats(all.map(item => ({ ...item, msnr: (item.msnr_refs || []).length ? 'YES' : 'NO' })), 'msnr')
    };
}

function renderReport(summary) {
    const s = summary.outcomes || {};
    return [
        `Historical baseline: ${summary.symbol || 'multiple symbols'}`,
        `Range: ${summary.from || ''} to ${summary.to || ''}`,
        `Candidates: ${summary.total_candidates} (selected ${summary.selected_candidates}, rejected ${summary.rejected_candidates})`,
        `Filled: ${s.filled || 0}; not filled/expired: ${s.not_filled || 0}; ambiguous: ${s.ambiguous || 0}`,
        `SL=${s.sl || 0} TP1=${s.tp1 || 0} TP2=${s.tp2 || 0} TP3=${s.tp3 || 0}`,
        `Total R=${s.total_r ?? 0}; average/expectancy R=${s.average_r ?? 'NA'}; median R=${s.median_r ?? 'NA'}`,
        `Max losing streak=${s.max_losing_streak || 0}; median MFE_R=${s.average_mfe_r ?? 'NA'}; median MAE_R=${s.average_mae_r ?? 'NA'}`,
        '',
        'This is a descriptive baseline, not a statistically significant result and not a strategy-quality conclusion.'
    ].join('\n');
}

module.exports = { median, summarize, buildSummary, renderReport };
