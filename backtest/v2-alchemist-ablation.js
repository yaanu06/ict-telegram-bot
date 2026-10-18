'use strict';

/*
 * Offline ablation/report runner. It starts with the exact selected V2 rows
 * from a completed replay and applies only the deterministic storyline
 * qualification layer. The existing V2 candidate selector and simulator are
 * not reimplemented here and are never altered by this tool.
 */

const fs = require('fs');
const path = require('path');
const { loadStrategyContext } = require('./strategy-adapter');
const { makeBlocks } = require('./replay');
const { loadSeries } = require('./deep-history-cli');
const { buildStateHistory, makeIndex, evaluateCandidate, MODES } = require('./v2-alchemist-sequence');

function args(argv) {
    const out = { inputs: [], output: null, manifest: 'backtest-baselines/deep-history-dataset.json' };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--input') out.inputs.push(argv[++i]);
        else if (token === '--output') out.output = argv[++i];
        else if (token === '--manifest') out.manifest = argv[++i];
    }
    return out;
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}
function stats(rows) {
    const filled = rows.filter(row => row.simulation?.fill_time_ms != null);
    const values = filled.map(row => Number(row.simulation?.r_result)).filter(Number.isFinite);
    let equity = 0; let peak = 0; let maxDrawdown = 0; let losing = 0; let maxLosing = 0;
    for (const value of values) { equity += value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); losing = value < 0 ? losing + 1 : 0; maxLosing = Math.max(maxLosing, losing); }
    return {
        selected: rows.length,
        filled: filled.length,
        sl: filled.filter(row => row.simulation.final_outcome === 'SL').length,
        tp1_plus: filled.filter(row => ['TP1', 'TP2', 'TP3'].includes(row.simulation.final_outcome)).length,
        total_r: values.reduce((sum, value) => sum + value, 0),
        average_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        median_r: median(values),
        max_drawdown_r: maxDrawdown,
        max_losing_streak: maxLosing,
        trade_retention_percent: null
    };
}
function holdout(rows, ratio = 0.7) {
    const ordered = rows.filter(row => row.simulation?.fill_time_ms != null).sort((a, b) => a.simulation.fill_time_ms - b.simulation.fill_time_ms);
    const cut = Math.floor(ordered.length * ratio);
    return { early_70: stats(ordered.slice(0, cut)), late_30: stats(ordered.slice(cut)) };
}
function sessionStats(rows, series) {
    const { sessionContext } = require('./v2-alchemist-sequence');
    const groups = {};
    for (const row of rows) {
        const at = Number(row.first_selected_at_ms || row.first_knowable_ms);
        const value = sessionContext(at, series['5m'] || []).session;
        (groups[value] ||= []).push(row);
    }
    return Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, stats(group)]));
}
function parseInput(value) {
    const [symbol, file] = String(value || '').split('=');
    if (!symbol || !file) throw new Error(`Invalid --input ${value}; use SYMBOL=trades.json`);
    return { symbol, file: path.resolve(file) };
}
function keyFor(symbol) { return String(symbol).replace(/[^A-Za-z0-9]/g, '_'); }

function run(argv = process.argv.slice(2)) {
    const options = args(argv);
    if (!options.inputs.length) throw new Error('Pass one --input SYMBOL=trades.json per symbol.');
    const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
    const entries = new Map((manifest.entries || []).map(entry => [entry.symbol, entry]));
    const context = loadStrategyContext();
    const bySymbol = {};
    const familyBreakdown = {};
    for (const input of options.inputs.map(parseInput)) {
        const rows = JSON.parse(fs.readFileSync(input.file, 'utf8'));
        const entry = entries.get(input.symbol);
        if (!entry) throw new Error(`No manifest entry for ${input.symbol}`);
        const series = loadSeries(entry);
        const stateHistory = buildStateHistory({ context, symbol: input.symbol, candles: series['4h'] || [] });
        const cache = { candidates: new Map(), primitives: new Map() };
        const modeReports = {};
        for (const mode of MODES) {
            const kept = [];
            const rejectionReasons = {};
            const familyRows = {};
            for (const row of rows) {
                const asOfMs = Number(row.first_selected_at_ms || row.first_knowable_ms);
                const blocks = makeBlocks(series, asOfMs);
                const candidate = { ...row, execution_5m: row.execution_5m, fvg_zone_low: row.fvg_zone_low, fvg_zone_high: row.fvg_zone_high };
                const index = makeIndex({ context, blocks, symbol: input.symbol, asOfMs, stateHistory, mode, cache });
                const qualification = evaluateCandidate({ candidate, blocks, context, symbol: input.symbol, asOfMs, stateHistory, mode, index });
                if (mode === 'CURRENT_V2' || qualification.qualified) {
                    kept.push({ ...row, ...qualification, setup_family: qualification.setup_family || null });
                    if (qualification.setup_family) (familyRows[qualification.setup_family] ||= []).push({ ...row, ...qualification });
                } else {
                    const reason = qualification.rejection_reason || 'INCOMPLETE_STORYLINE';
                    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
                }
            }
            const summary = stats(kept);
            summary.trade_retention_percent = rows.length ? (kept.length / rows.length) * 100 : null;
            modeReports[mode] = { summary, holdout: holdout(kept), session: sessionStats(kept, series), rejection_reasons: rejectionReasons, setup_families: Object.fromEntries(Object.entries(familyRows).map(([name, group]) => [name, stats(group)])) };
        }
        bySymbol[input.symbol] = modeReports;
    }
    const combined = {};
    for (const mode of MODES) {
        const synthetic = [];
        for (const symbol of Object.keys(bySymbol)) {
            const report = bySymbol[symbol][mode];
            // Preserve aggregate metrics from per-symbol summaries without
            // pretending a cross-symbol row is a source trade.
            synthetic.push(report.summary);
        }
        const filled = synthetic.reduce((sum, item) => sum + item.filled, 0);
        const totalR = synthetic.reduce((sum, item) => sum + item.total_r, 0);
        combined[mode] = {
            selected: synthetic.reduce((sum, item) => sum + item.selected, 0),
            filled,
            sl: synthetic.reduce((sum, item) => sum + item.sl, 0),
            tp1_plus: synthetic.reduce((sum, item) => sum + item.tp1_plus, 0),
            total_r: totalR,
            average_r: filled ? totalR / filled : null,
            max_drawdown_r: Math.max(...synthetic.map(item => item.max_drawdown_r), 0),
            max_losing_streak: Math.max(...synthetic.map(item => item.max_losing_streak), 0)
        };
    }
    const result = { inputs: options.inputs, modes: MODES, by_symbol: bySymbol, combined };
    if (options.output) fs.writeFileSync(path.resolve(options.output), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (require.main === module) {
    try { run(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { args, stats, run };
