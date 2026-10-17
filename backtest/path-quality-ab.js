'use strict';

/*
 * Replays the existing cached historical windows with the path-quality layer
 * and compares them with the already-recorded baseline artifacts. It never
 * downloads data and writes no market/model/backtest output.
 */
const fs = require('fs');
const path = require('path');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayHistory, symbolPrecision } = require('./replay');
const { buildSummary } = require('./metrics');

const RUNS = [
    'backtest-results/20261016T204516Z_AUD_USD',
    'backtest-results/20261016T204958Z_GBP_JPY',
    'backtest-results/20261016T205615Z_XAU_USD'
];
const INTERVAL_MS = Object.freeze({ '1d': 86400000, '4h': 14400000, '1h': 3600000, '15m': 900000, '5m': 300000 });

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function canonicalSeries(config) {
    const series = {};
    for (const timeframe of config.timeframes || Object.keys(INTERVAL_MS)) {
        const cachePath = config.diagnostics?.[timeframe]?.cache_path;
        const payload = readJson(cachePath);
        const interval = INTERVAL_MS[timeframe];
        series[timeframe] = (payload.bars || []).map(row => {
            const timestamp = Number(row.timestamp ?? row.t);
            return {
                t: timestamp,
                timestamp,
                o: Number(row.open ?? row.o),
                h: Number(row.high ?? row.h),
                l: Number(row.low ?? row.l),
                c: Number(row.close ?? row.c),
                v: Number(row.volume ?? row.v ?? 0),
                is_closed: row.is_closed !== false,
                close_time_ms: timestamp + interval
            };
        }).filter(row => Number.isFinite(row.t)).sort((a, b) => a.t - b.t);
    }
    return series;
}

function outcomeGroup(row) {
    const simulation = row.simulation || row;
    if (simulation.final_outcome === 'SL' && simulation.tp1_before_sl !== true) return 'LOSER';
    if (simulation.targets_reached?.[0] === true || ['TP1', 'TP2', 'TP3'].includes(simulation.final_outcome)) return 'WINNER';
    return 'OTHER';
}

function group(rows, field) {
    const result = {};
    for (const row of rows) {
        const key = row[field] ?? 'UNKNOWN';
        (result[key] ||= []).push(row);
    }
    return Object.fromEntries(Object.entries(result).map(([key, items]) => [key, summary(items)]));
}

function summary(rows) {
    const simulations = rows.map(row => row.simulation || row).filter(row => row && row.final_outcome && row.final_outcome !== 'AMBIGUOUS');
    const r = simulations.map(row => Number(row.r_result)).filter(Number.isFinite);
    let streak = 0;
    let maxStreak = 0;
    for (const value of r) {
        if (value < 0) { streak += 1; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
    }
    const count = outcome => simulations.filter(row => row.final_outcome === outcome).length;
    const slBefore = simulations.filter(row => row.final_outcome === 'SL' && row.tp1_before_sl !== true).length;
    return {
        count: rows.length,
        filled: simulations.filter(row => row.fill_time_ms != null).length,
        sl: count('SL'),
        sl_before_tp1: slBefore,
        tp1_plus: simulations.filter(row => row.targets_reached?.[0] === true || ['TP1', 'TP2', 'TP3'].includes(row.final_outcome)).length,
        tp2_plus: simulations.filter(row => row.targets_reached?.[1] === true || ['TP2', 'TP3'].includes(row.final_outcome)).length,
        tp3: count('TP3'),
        total_r: r.reduce((sum, value) => sum + value, 0),
        average_r: r.length ? r.reduce((sum, value) => sum + value, 0) / r.length : null,
        max_losing_streak: maxStreak
    };
}

function baselineReplay(config, candidates, trades) {
    const selected = candidates.filter(row => row.first_selected_at_ms != null);
    return { candidates, selected, rejected: candidates.filter(row => row.first_selected_at_ms == null), trades, observations: [], clocks: null, config };
}

function compareRun(runDir, context) {
    const config = readJson(path.join(runDir, 'config.json'));
    const baselineCandidates = readJson(path.join(runDir, 'candidates.json'));
    const baselineTrades = readJson(path.join(runDir, 'trades.json'));
    const series = canonicalSeries(config);
    const price = series['5m']?.[0]?.c || series['1h']?.[0]?.c || 1;
    const pathReplay = replayHistory({
        context,
        series,
        symbol: config.symbol,
        from: config.from,
        to: config.to,
        precision: symbolPrecision(config.symbol, price),
        replayTimeframe: config.replayTimeframe || '5m',
        ambiguity: config.ambiguity || 'exclude'
    });
    const baseline = buildSummary(baselineReplay(config, baselineCandidates, baselineTrades), { symbol: config.symbol, from: config.from, to: config.to, policy: 'BASELINE' });
    const pathQuality = buildSummary(pathReplay, { symbol: config.symbol, from: config.from, to: config.to, policy: 'PATH_QUALITY_V2' });
    const pathById = new Map(pathReplay.candidates.map(row => [row.candidate_id, row]));
    const selectedIds = new Set(pathReplay.selected.map(row => row.candidate_id));
    const removed = baselineTrades.filter(row => !selectedIds.has(row.candidate_id)).map(row => {
        const pathCandidate = pathById.get(row.candidate_id) || {};
        return { ...row, path_candidate: pathCandidate, removal: pathCandidate.trade_qualified === false ? 'HARD_BLOCK_ENTRY_INSIDE_OPPOSING_4H' : 'RANKED_LOWER' };
    });
    const hardBlocked = removed.filter(row => row.removal === 'HARD_BLOCK_ENTRY_INSIDE_OPPOSING_4H');
    const removedStats = summary(removed);
    return {
        symbol: config.symbol,
        run_directory: runDir,
        baseline,
        path_quality: pathQuality,
        by_timeframe: { baseline: baseline.by_timeframe, path_quality: pathQuality.by_timeframe },
        by_side: { baseline: baseline.by_side, path_quality: pathQuality.by_side },
        removed: {
            total: removed.length,
            ranked_lower: removed.filter(row => row.removal === 'RANKED_LOWER').length,
            hard_blocked: hardBlocked.length,
            winners: removed.filter(row => outcomeGroup(row) === 'WINNER').length,
            losers: removed.filter(row => outcomeGroup(row) === 'LOSER').length,
            total_r: removedStats.total_r,
            average_r: removedStats.average_r,
            hard_blocker: {
                sample_size: hardBlocked.length,
                winners_removed: hardBlocked.filter(row => outcomeGroup(row) === 'WINNER').length,
                losers_removed: hardBlocked.filter(row => outcomeGroup(row) === 'LOSER').length,
                total_r_removed: summary(hardBlocked).total_r,
                average_r_removed: summary(hardBlocked).average_r,
                candidate_ids: hardBlocked.map(row => row.candidate_id)
            }
        },
        selected_trade_ids: [...selectedIds],
        path_candidates: pathReplay.candidates
    };
}

function main() {
    const context = loadStrategyContext();
    const results = RUNS.map(run => compareRun(path.resolve(run), context));
    const output = { runs: results.map(({ path_candidates, selected_trade_ids, ...result }) => result) };
    fs.writeFileSync(path.join('data', 'path-quality-ab.json'), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) main();

module.exports = { canonicalSeries, compareRun, summary, outcomeGroup };
