'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outputArgIndex = args.indexOf('--output');
const outputFile = outputArgIndex >= 0 ? args[outputArgIndex + 1] : null;
const dirs = args.filter((value, index) => value !== '--output' && index !== outputArgIndex + 1);
if (!dirs.length) throw new Error('Pass completed deep replay directories.');

function rowsFrom(directory) {
    const file = path.join(process.cwd(), 'backtest-results', directory, 'trades.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')).map(row => ({ ...row, symbol: row.symbol || directory, directory }));
}

function filled(rows) { return rows.filter(row => row.simulation?.fill_time_ms != null); }
function rOf(row) { const value = Number(row.simulation?.r_result); return Number.isFinite(value) ? value : 0; }
function outcome(rows, name) { return filled(rows).filter(row => row.simulation?.final_outcome === name).length; }
function stats(rows) {
    const trades = filled(rows).sort((a, b) => a.simulation.fill_time_ms - b.simulation.fill_time_ms);
    const values = trades.map(rOf);
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null;
    let equity = 0; let peak = 0; let maxDrawdown = 0; let streak = 0; let maxStreak = 0; let peakIndex = 0; let recovery = 0; let maxRecovery = 0;
    for (let index = 0; index < values.length; index += 1) {
        equity += values[index];
        if (equity > peak) { peak = equity; peakIndex = index; recovery = 0; }
        else recovery = index - peakIndex;
        maxRecovery = Math.max(maxRecovery, recovery);
        maxDrawdown = Math.max(maxDrawdown, peak - equity);
        streak = values[index] < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
    }
    const byDay = groups(rows, 'day');
    const dayValues = Object.values(byDay).map(group => group.reduce((sum, row) => sum + rOf(row), 0));
    let redDays = 0; let greenDays = 0; let redStreak = 0; let maxRedDays = 0;
    for (const value of dayValues) { if (value > 0) { greenDays += 1; redStreak = 0; } else if (value < 0) { redDays += 1; redStreak += 1; maxRedDays = Math.max(maxRedDays, redStreak); } }
    return {
        selected: rows.length, filled: trades.length, sl: outcome(rows, 'SL'), tp1_plus: trades.filter(row => ['TP1', 'TP2', 'TP3'].includes(row.simulation?.final_outcome)).length,
        tp2_plus: trades.filter(row => ['TP2', 'TP3'].includes(row.simulation?.final_outcome)).length, tp3: outcome(rows, 'TP3'), ambiguous: outcome(rows, 'AMBIGUOUS'), not_filled: rows.length - trades.length,
        total_r: values.reduce((sum, value) => sum + value, 0), average_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, median_r: median,
        max_drawdown_r: maxDrawdown, max_losing_streak: maxStreak, max_recovery_trades: maxRecovery, trades_per_day: Object.keys(byDay).length ? trades.length / Object.keys(byDay).length : 0,
        green_day_rate: dayValues.length ? greenDays / dayValues.length : null, red_day_rate: dayValues.length ? redDays / dayValues.length : null,
        average_daily_r: dayValues.length ? dayValues.reduce((sum, value) => sum + value, 0) / dayValues.length : null,
        median_daily_r: medianOf(dayValues), longest_red_day_streak: maxRedDays
    };
}

function medianOf(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null; }
function groups(rows, unit) {
    const map = {};
    for (const row of filled(rows)) {
        const date = new Date(row.simulation.fill_time_ms);
        const key = unit === 'day' ? date.toISOString().slice(0, 10) : unit === 'month' ? date.toISOString().slice(0, 7) : `${date.getUTCFullYear()}-W${String(Math.floor((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 1))) / 604800000) + 1).padStart(2, '0')}`;
        (map[key] ||= []).push(row);
    }
    return map;
}
function rolling(rows, window) {
    const values = filled(rows).sort((a, b) => a.simulation.fill_time_ms - b.simulation.fill_time_ms).map(rOf);
    const means = [];
    for (let index = window; index <= values.length; index += 1) means.push(values.slice(index - window, index).reduce((sum, value) => sum + value, 0) / window);
    return { window, observations: means.length, positive_percent: means.length ? means.filter(value => value > 0).length / means.length * 100 : null, min: means.length ? Math.min(...means) : null, max: means.length ? Math.max(...means) : null, first: means[0] ?? null, last: means.at(-1) ?? null };
}
function groupedStats(rows, unit) { return Object.fromEntries(Object.entries(groups(rows, unit)).map(([key, value]) => [key, stats(value)])); }
function holdout(rows, ratio = 0.7) {
    const ordered = filled(rows).sort((a, b) => a.simulation.fill_time_ms - b.simulation.fill_time_ms);
    const cut = Math.max(1, Math.floor(ordered.length * ratio));
    return { early_70_percent: stats(ordered.slice(0, cut)), late_30_percent: stats(ordered.slice(cut)), split_fill_index: cut, split_time: ordered[cut]?.simulation?.fill_time_ms || null };
}

const rows = dirs.flatMap(rowsFrom);
const bySymbol = Object.fromEntries(dirs.map(directory => [directory, stats(rowsFrom(directory))]));
const report = { directories: dirs, combined: stats(rows), by_symbol: bySymbol, monthly: groupedStats(rows, 'month'), weekly: groupedStats(rows, 'week'), daily: groupedStats(rows, 'day'), rolling: { trade20: rolling(rows, 20), trade50: rolling(rows, 50) }, holdout: holdout(rows) };
if (outputFile) fs.writeFileSync(path.resolve(outputFile), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: outputFile ? path.resolve(outputFile) : null, directories: dirs, combined: report.combined, by_symbol: report.by_symbol, rolling: report.rolling, holdout: report.holdout }, null, 2));
