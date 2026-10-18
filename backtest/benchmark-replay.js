'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayHistory, replayClocks, symbolPrecision } = require('./replay');

const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest-baselines', 'current-production.json'), 'utf8'));

function loadSeries(item) {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), item.run_directory, 'config.json'), 'utf8'));
    const series = {};
    for (const timeframe of ['1d', '4h', '1h', '15m', '5m']) {
        const payload = JSON.parse(fs.readFileSync(config.diagnostics[timeframe].cache_path, 'utf8'));
        series[timeframe] = payload.bars || [];
    }
    return series;
}

function project(replay) {
    return replay.trades.map(row => ({
        candidate_id: row.candidate_id,
        entry: row.entry,
        stop_loss: row.stop_loss,
        tp1: row.tp1,
        tp2: row.tp2,
        tp3: row.tp3,
        simulation: row.simulation
    }));
}

function run({ context, series, item, optimized, from, to }) {
    const started = performance.now();
    const replay = replayHistory({
        context, series, symbol: item.symbol, from, to,
        precision: symbolPrecision(item.symbol, series['5m'][0]?.c ?? series['5m'][0]?.close ?? 1),
        replayTimeframe: '5m', ambiguity: 'exclude', retainLastState: false, optimized
    });
    return { replay, elapsed_s: (performance.now() - started) / 1000 };
}

function main() {
    const symbol = process.argv[2] || 'AUD/USD';
    const clocksRequested = Math.max(1, Number(process.argv[3] || 1000));
    const item = baseline.symbols.find(entry => entry.symbol === symbol);
    if (!item) throw new Error(`Unknown symbol ${symbol}`);
    const series = loadSeries(item);
    const clocks = replayClocks(series, '5m', Date.parse(item.from), Date.parse(item.to));
    const count = Math.min(clocksRequested, clocks.length);
    const from = new Date(clocks[0]).toISOString();
    const to = new Date(clocks[count - 1]).toISOString();
    const context = loadStrategyContext();
    const reference = run({ context, series, item, optimized: false, from, to });
    const optimized = run({ context, series, item, optimized: true, from, to });
    const referenceProjection = JSON.stringify(project(reference.replay));
    const optimizedProjection = JSON.stringify(project(optimized.replay));
    console.log(JSON.stringify({
        symbol, clocks: count, from, to,
        reference: { elapsed_s: Number(reference.elapsed_s.toFixed(3)), bars_per_second: Number((count / reference.elapsed_s).toFixed(3)), candidates: reference.replay.candidates.length, selected: reference.replay.selected.length },
        optimized: { elapsed_s: Number(optimized.elapsed_s.toFixed(3)), bars_per_second: Number((count / optimized.elapsed_s).toFixed(3)), candidates: optimized.replay.candidates.length, selected: optimized.replay.selected.length },
        speedup: Number((reference.elapsed_s / optimized.elapsed_s).toFixed(3)),
        equivalent: referenceProjection === optimizedProjection
    }, null, 2));
}

if (require.main === module) main();
