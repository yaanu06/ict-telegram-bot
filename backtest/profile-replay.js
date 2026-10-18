'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');
const { replayHistory, makeBlocks, replayClocks, symbolPrecision } = require('./replay');

const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest-baselines', 'current-production.json'), 'utf8'));
const symbolArg = process.argv[2] || 'AUD/USD';
const entry = baseline.symbols.find(item => item.symbol === symbolArg);
if (!entry) throw new Error(`Unknown symbol ${symbolArg}`);

function loadSeries(item) {
    const series = {};
    for (const timeframe of ['1d', '4h', '1h', '15m', '5m']) {
        const file = item.run_directory && item.run_directory.replace(/\\/g, '/');
        const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), file, 'config.json'), 'utf8'));
        const cachePath = config.diagnostics[timeframe].cache_path;
        const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        series[timeframe] = payload.bars || [];
    }
    return series;
}

function instrument(context) {
    const names = [
        'buildRawTextTimeframeRoleAudit', 'buildRawTextMarketContext',
        'buildRawTextDeterministicCrtAudit', 'buildRawTextDeterministicMsnrAudit',
        'buildRawTextSupplyDemandAudit', 'buildRawTextHighProbabilityZones',
        'detectRawTextFvgs', 'detectOrderBlocks'
    ];
    const stats = Object.fromEntries(names.map(name => [name, { calls: 0, ms: 0 }]));
    for (const name of names) {
        if (typeof context[name] !== 'function') continue;
        const original = context[name];
        context[name] = function (...args) {
            const start = performance.now();
            try { return original.apply(this, args); }
            finally { stats[name].calls += 1; stats[name].ms += performance.now() - start; }
        };
    }
    return stats;
}

const series = loadSeries(entry);
const context = loadStrategyContext();
const stats = instrument(context);

if (process.argv[3] === 'single') {
    const clocks = replayClocks(series, '5m', Date.parse(entry.from), Date.parse(entry.to));
    const asOfMs = clocks.at(-1);
    const timing = { blocks_ms: 0, analyze_ms: 0 };
    const analysisCache = {
        roleAudits: new Map(), crtAudits: new Map(),
        fvgByBlock: new Map(), orderBlocksByBlock: new Map(), staticZoneRecords: new Map(), marketContextsByTimeframe: new Map()
    };
    let result;
    for (let index = 0; index < 20; index += 1) {
        let started = performance.now();
        const blocks = makeBlocks(series, asOfMs);
        timing.blocks_ms += performance.now() - started;
        const executionBars = blocks.find(block => block.timeframe === '5M')?.candles || [];
        started = performance.now();
        result = analyzeVisibleHistory(context, {
            blocks, symbol: entry.symbol, currentPrice: Number(executionBars.at(-1)?.c),
            asOfMs, precision: symbolPrecision(entry.symbol, series['5m'][0]?.c ?? series['5m'][0]?.close ?? 1), cache: analysisCache
        });
        timing.analyze_ms += performance.now() - started;
    }
    console.log(JSON.stringify({ mode: 'single', symbol: entry.symbol, clocks: clocks.length, timing, result: { records: result.zones.records.length, current: result.zones.current_records.length }, stats }, null, 2));
    process.exit(0);
}

if (process.argv[3] === 'parts') {
    const clocks = replayClocks(series, '5m', Date.parse(entry.from), Date.parse(entry.to));
    const asOfMs = clocks.at(-1);
    const blocks = makeBlocks(series, asOfMs);
    const price = Number(blocks.find(block => block.timeframe === '5M')?.candles.at(-1)?.c);
    const outputs = [];
    for (const block of blocks) {
        for (const name of ['buildRawTextDeterministicMsnrAudit', 'buildRawTextSupplyDemandAudit', 'buildRawTextDeterministicCrtAudit']) {
            const fn = context[name];
            if (typeof fn !== 'function') continue;
            const started = performance.now();
            const output = name === 'buildRawTextDeterministicMsnrAudit'
                ? fn([block], price, entry.symbol, {}, symbolPrecision(entry.symbol, price))
                : name === 'buildRawTextSupplyDemandAudit'
                    ? fn([block], symbolPrecision(entry.symbol, price), asOfMs)
                    : fn([block], entry.symbol, {}, symbolPrecision(entry.symbol, price));
            outputs.push({ timeframe: block.timeframe, name, ms: Number((performance.now() - started).toFixed(3)), records: output.records?.length ?? output.length ?? 0 });
        }
    }
    console.log(JSON.stringify({ mode: 'parts', symbol: entry.symbol, outputs }, null, 2));
    process.exit(0);
}

if (process.argv[3] === 'compare-price') {
    const clocks = replayClocks(series, '5m', Date.parse(entry.from), Date.parse(entry.to));
    const blocks = makeBlocks(series, clocks.at(-1));
    const firstPrice = Number(blocks.find(block => block.timeframe === '5M')?.candles[0]?.c);
    const lastPrice = Number(blocks.find(block => block.timeframe === '5M')?.candles.at(-1)?.c);
    const precision = symbolPrecision(entry.symbol, lastPrice);
    const output = {};
    for (const name of ['buildRawTextDeterministicMsnrAudit', 'buildRawTextDeterministicCrtAudit']) {
        const fn = context[name];
        const first = name.includes('Msnr') ? fn(blocks, firstPrice, entry.symbol, {}, precision) : fn(blocks, entry.symbol, {}, precision);
        const last = name.includes('Msnr') ? fn(blocks, lastPrice, entry.symbol, {}, precision) : fn(blocks, entry.symbol, {}, precision);
        const normalize = value => JSON.stringify((value.records || []).slice().sort((a, b) => String(a.ref).localeCompare(String(b.ref))));
        output[name] = { same: JSON.stringify(first) === JSON.stringify(last), same_records_unordered: normalize(first) === normalize(last), first_records: first.records?.length, last_records: last.records?.length };
    }
    console.log(JSON.stringify({ mode: 'compare-price', output }, null, 2));
    process.exit(0);
}

const started = performance.now();
const replay = replayHistory({
    context, series, symbol: entry.symbol,
    from: entry.from, to: entry.to,
    precision: symbolPrecision(entry.symbol, series['5m'][0]?.c || 1),
    replayTimeframe: '5m', ambiguity: 'exclude', retainLastState: false,
    progress: value => {
        if (value.clock_index === 1 || value.clock_index % 1000 === 0 || value.clock_index === value.clock_count) {
            const elapsed = (performance.now() - started) / 1000;
            console.error(JSON.stringify({ progress: value, elapsed_s: Number(elapsed.toFixed(2)) }));
        }
    }
});
const elapsed = (performance.now() - started) / 1000;
console.log(JSON.stringify({
    symbol: entry.symbol,
    clocks: replay.clocks,
    candidates: replay.candidates.length,
    selected: replay.selected.length,
    trades: replay.trades.length,
    elapsed_s: Number(elapsed.toFixed(3)),
    bars_per_second: Number((replay.clocks / elapsed).toFixed(3)),
    stats: Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, {
        calls: value.calls,
        total_ms: Number(value.ms.toFixed(3)),
        avg_ms: value.calls ? Number((value.ms / value.calls).toFixed(3)) : 0
    }]))
}, null, 2));
