'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayHistory, symbolPrecision } = require('./replay');
const { buildSummary } = require('./metrics');
const { buildFeatureIndex, enrichTrade, analyzeRows } = require('./v2-feature-analysis');

const TF_MS = Object.freeze({ '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 });

function parseArgs(argv) {
    const args = { manifest: path.join(process.cwd(), 'backtest-baselines', 'deep-history-dataset.json'), symbols: [], outputRoot: path.join(process.cwd(), 'backtest-results') };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (key === 'symbol' || key === 'symbols') {
            args.symbols.push(...String(argv[index + 1] || '').split(',').map(value => value.trim()).filter(Boolean));
            index += 1;
        } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
            args[key] = argv[index + 1];
            index += 1;
        }
    }
    args.symbols = [...new Set(args.symbols)];
    return args;
}

function aggregateBars(baseBars, timeframe) {
    const interval = TF_MS[timeframe];
    const groups = new Map();
    for (const source of baseBars || []) {
        const timestamp = Number(source.timestamp ?? source.t);
        if (!Number.isFinite(timestamp)) continue;
        const bucket = Math.floor(timestamp / interval) * interval;
        if (!groups.has(bucket)) groups.set(bucket, []);
        groups.get(bucket).push(source);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([timestamp, group]) => {
        const rows = group.sort((a, b) => Number(a.timestamp ?? a.t) - Number(b.timestamp ?? b.t));
        return {
            timestamp,
            t: timestamp,
            o: Number(rows[0].open ?? rows[0].o),
            h: Math.max(...rows.map(row => Number(row.high ?? row.h))),
            l: Math.min(...rows.map(row => Number(row.low ?? row.l))),
            c: Number(rows.at(-1).close ?? rows.at(-1).c),
            v: rows.reduce((sum, row) => sum + Number(row.volume ?? row.v ?? 0), 0),
            is_closed: true,
            close_time_ms: timestamp + interval,
            source_bar_count: rows.length
        };
    });
}

function loadSeries(entry) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), entry.data_file), 'utf8'));
    const base = payload.bars || [];
    return { '5m': base, '15m': aggregateBars(base, '15m'), '1h': aggregateBars(base, '1h'), '4h': aggregateBars(base, '4h'), '1d': aggregateBars(base, '1d') };
}

function numericR(row) {
    const value = Number(row?.simulation?.r_result ?? row?.r_result);
    return Number.isFinite(value) ? value : null;
}

function filledRows(rows) {
    return rows.filter(row => row.simulation?.fill_time_ms != null);
}

function summarizeRows(rows) {
    const filled = filledRows(rows);
    const r = filled.map(numericR).filter(value => value != null);
    const sorted = [...r].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    const outcomes = outcome => filled.filter(row => row.simulation?.final_outcome === outcome).length;
    let equity = 0; let peak = 0; let maxDrawdown = 0; let streak = 0; let maxStreak = 0;
    for (const value of r) {
        equity += value; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity);
        streak = value < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
    }
    return {
        trades: rows.length,
        filled: filled.length,
        sl: outcomes('SL'),
        tp1_plus: filled.filter(row => ['TP1', 'TP2', 'TP3'].includes(row.simulation?.final_outcome)).length,
        tp2_plus: filled.filter(row => ['TP2', 'TP3'].includes(row.simulation?.final_outcome)).length,
        tp3: outcomes('TP3'),
        ambiguous: outcomes('AMBIGUOUS'),
        not_filled: rows.filter(row => row.simulation?.fill_time_ms == null).length,
        total_r: r.reduce((sum, value) => sum + value, 0),
        average_r: r.length ? r.reduce((sum, value) => sum + value, 0) / r.length : null,
        median_r: median,
        max_losing_streak: maxStreak,
        max_drawdown_r: maxDrawdown
    };
}

function keyUtc(timestamp, unit) {
    const date = new Date(timestamp);
    if (unit === 'day') return date.toISOString().slice(0, 10);
    if (unit === 'month') return date.toISOString().slice(0, 7);
    const day = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.floor((date - day) / 604800000) + 1;
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function groupedPerformance(rows, unit) {
    const groups = new Map();
    for (const row of filledRows(rows)) {
        const key = keyUtc(row.simulation.fill_time_ms, unit);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
        const stats = summarizeRows(group);
        return [key, { ...stats, green: stats.total_r > 0, red: stats.total_r < 0 }];
    }));
}

function bootstrapMean(rows, iterations = 4000) {
    const values = filledRows(rows).map(numericR).filter(value => value != null);
    if (!values.length) return { low: null, high: null, iterations };
    let seed = 0x9e3779b9;
    const means = [];
    const next = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) total += values[Math.floor(next() * values.length)];
        means.push(total / values.length);
    }
    means.sort((a, b) => a - b);
    return { low: means[Math.floor(iterations * 0.025)], high: means[Math.floor(iterations * 0.975)], iterations };
}

function rollingExpectancy(rows, window) {
    const values = filledRows(rows).sort((a, b) => a.simulation.fill_time_ms - b.simulation.fill_time_ms).map(numericR).filter(value => value != null);
    if (values.length < window) return { window, observations: 0, first: null, last: null, min: null, max: null };
    const means = [];
    for (let index = window; index <= values.length; index += 1) means.push(values.slice(index - window, index).reduce((sum, value) => sum + value, 0) / window);
    return { window, observations: means.length, first: means[0], last: means.at(-1), min: Math.min(...means), max: Math.max(...means) };
}

function attachRegime(rows, series) {
    const bars = series['4h'] || [];
    return rows.map(row => {
        const at = Number(row.simulation?.fill_time_ms ?? row.first_knowable_ms);
        const visible = bars.filter(bar => Number(bar.close_time_ms) <= at).slice(-25);
        const first = visible[0]?.c; const last = visible.at(-1)?.c;
        const move = first && last ? (last - first) / first : 0;
        const regime = move > 0.01 ? 'TREND_UP' : move < -0.01 ? 'TREND_DOWN' : 'RANGE_4H_25BAR';
        return { ...row, diagnostic_regime_4h: regime };
    });
}

async function runOne(entry, context, outputRoot, runId, options = {}) {
    const series = loadSeries(entry);
    const testFrom = entry.test_from || entry.scored_start;
    const testTo = entry.test_to || entry.scored_end;
    if (!testFrom || !testTo) throw new Error(`Manifest entry ${entry.symbol} is missing test_from/test_to`);
    const firstPrice = series['5m'][0]?.c ?? series['5m'][0]?.close ?? 1;
    const checkpointFile = options.checkpointDir
        ? path.resolve(options.checkpointDir, `${entry.symbol.replace(/[^A-Za-z0-9]+/g, '_')}.checkpoint.json`)
        : null;
    let resumeState = null;
    if (checkpointFile && options.resume && fs.existsSync(checkpointFile)) {
        resumeState = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
        if (resumeState.completed) resumeState = null;
    }
    if (checkpointFile) fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
    const replayStartedAt = Date.now();
    const replay = require('./replay').replayHistory({
        context,
        series,
        symbol: entry.symbol,
        from: testFrom,
        to: testTo,
        precision: symbolPrecision(entry.symbol, firstPrice),
        replayTimeframe: '5m',
        ambiguity: 'exclude',
        retainLastState: false,
        resumeState,
        progress: progress => {
            if (typeof global.gc === 'function') global.gc();
            if (progress.clock_index === 1 || progress.clock_index === progress.clock_count || progress.clock_index % 5000 === 0) {
                const elapsedSeconds = Math.max(0.001, (Date.now() - replayStartedAt) / 1000);
                const rate = progress.clock_index / elapsedSeconds;
                const remainingSeconds = rate > 0 ? (progress.clock_count - progress.clock_index) / rate : null;
                const percent = progress.clock_count ? (progress.clock_index / progress.clock_count) * 100 : 0;
                console.error(`[deep-history] ${entry.symbol} ${new Date(progress.as_of_ms).toISOString()} ${progress.clock_index}/${progress.clock_count} (${percent.toFixed(1)}%) elapsed=${elapsedSeconds.toFixed(1)}s eta=${remainingSeconds == null ? 'unknown' : `${remainingSeconds.toFixed(1)}s`} candidates=${progress.candidate_count} selected=${progress.selected_count}`);
            }
        },
        checkpoint: checkpointFile ? state => {
            const temporary = `${checkpointFile}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({ ...state, symbol: entry.symbol, updated_at: new Date().toISOString() }));
            fs.renameSync(temporary, checkpointFile);
        } : null
    });
    const trades = attachRegime(replay.trades, series);
    const summary = buildSummary({ ...replay, trades }, { symbol: entry.symbol, from: testFrom, to: testTo, provider: entry.provider, replay_timeframe: '5m', ambiguity: 'exclude', strategy_git_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() });
    const filled = filledRows(trades);
    const index = options.skipFeatureStudy ? null : buildFeatureIndex({ context, series, symbol: entry.symbol });
    const enriched = options.skipFeatureStudy ? [] : trades.filter(row => row.simulation?.fill_time_ms != null).map(trade => enrichTrade({ trade, index, symbol: entry.symbol }));
    const report = options.skipFeatureStudy ? null : analyzeRows(enriched);
    const outputDir = path.join(outputRoot, `${runId}_${entry.symbol.replace(/[^A-Za-z0-9]+/g, '_')}_DEEP_V2`);
    fs.mkdirSync(outputDir, { recursive: true });
    const breakdowns = {
        monthly: groupedPerformance(trades, 'month'),
        weekly: groupedPerformance(trades, 'week'),
        daily: groupedPerformance(trades, 'day'),
        rolling: { trade20: rollingExpectancy(trades, 20), trade50: rollingExpectancy(trades, 50) },
        bootstrap_mean_r_95: bootstrapMean(trades),
        by_regime: Object.fromEntries(['TREND_UP', 'TREND_DOWN', 'RANGE_4H_25BAR'].map(regime => [regime, summarizeRows(trades.filter(row => row.diagnostic_regime_4h === regime))]))
    };
    fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify({ entry: { ...entry, test_from: testFrom, test_to: testTo }, source: '1m artifacts aggregated to UTC 5m then higher timeframes', strategy: 'CURRENT_PRODUCTION_V2_UNCHANGED', simulator: 'backtest/replay.js', no_future_leakage: 'replay receives only closed aggregated candles at each 5m clock', }, null, 2));
    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(outputDir, 'breakdowns.json'), JSON.stringify(breakdowns, null, 2));
    fs.writeFileSync(path.join(outputDir, 'trades.json'), JSON.stringify(trades, null, 2));
    if (checkpointFile) fs.writeFileSync(checkpointFile, JSON.stringify({ completed: true, symbol: entry.symbol, outputDir }, null, 2));
    if (!options.skipFeatureStudy) {
        fs.writeFileSync(path.join(outputDir, 'features-report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(outputDir, 'features-enriched.json'), JSON.stringify(enriched, null, 2));
    }
    console.log(JSON.stringify({ symbol: entry.symbol, outputDir, outcomes: summary.outcomes, feature_trade_count: enriched.length, breakdowns }, null, 2));
    return { symbol: entry.symbol, outputDir, summary, breakdowns, report };
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args.manifest), 'utf8'));
    const context = loadStrategyContext();
    const manifestEntries = manifest.symbols || manifest.entries || [];
    const entries = manifestEntries.filter(entry => !args.symbols.length || args.symbols.includes(entry.symbol)).map(entry => ({
        ...entry,
        test_from: args.from || entry.test_from || manifest.scored_start,
        test_to: args.to || entry.test_to || manifest.scored_end
    }));
    const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const results = [];
    for (const entry of entries) results.push(await runOne(entry, context, args.outputRoot, runId, {
        skipFeatureStudy: args.skipFeatureStudy === true || args.skipFeatureStudy === 'true',
        checkpointDir: args.checkpointDir || null,
        resume: args.resume === true || args.resume === 'true'
    }));
    fs.writeFileSync(path.join(args.outputRoot, `${runId}_DEEP_V2_MANIFEST.json`), JSON.stringify({ manifest: args.manifest, results: results.map(result => ({ symbol: result.symbol, outputDir: result.outputDir, outcomes: result.summary.outcomes, breakdowns: result.breakdowns })) }, null, 2));
    return results;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { aggregateBars, summarizeRows, groupedPerformance, bootstrapMean, rollingExpectancy, parseArgs };
