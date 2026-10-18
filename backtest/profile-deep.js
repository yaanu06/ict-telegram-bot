'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');
const { makeBlocks, replayClocks, symbolPrecision } = require('./replay');
const { aggregateBars } = require('./deep-history-cli');

const symbol = process.argv[2] || 'AUD/USD';
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest-baselines', 'deep-history-dataset.json'), 'utf8'));
const entry = (manifest.entries || []).find(item => item.symbol === symbol);
if (!entry) throw new Error(`Unknown symbol ${symbol}`);
const payload = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), entry.data_file), 'utf8'));
const base = payload.bars || [];
const series = { '5m': base, '15m': aggregateBars(base, '15m'), '1h': aggregateBars(base, '1h'), '4h': aggregateBars(base, '4h'), '1d': aggregateBars(base, '1d') };
const context = loadStrategyContext();
const cache = { roleAudits: new Map(), crtAudits: new Map(), fvgByBlock: new Map(), orderBlocksByBlock: new Map(), staticZoneRecords: new Map(), marketContextsByTimeframe: new Map() };
const clocks = replayClocks(series, '5m', Date.parse(entry.test_from), Date.parse(entry.test_to));
const asOfMs = clocks.at(-1);
const precision = symbolPrecision(symbol, base[0]?.c ?? base[0]?.close ?? 1);
const stats = { blocks: 0, analyze: 0 };
const names = ['buildRawTextMarketContext', 'buildRawTextDeterministicCrtAudit', 'buildRawTextDeterministicMsnrAudit', 'buildRawTextSupplyDemandAudit', 'buildRawTextHighProbabilityZones', 'detectRawTextFvgs', 'detectOrderBlocks'];
const functionStats = Object.fromEntries(names.map(name => [name, { calls: 0, ms: 0 }]));
for (const name of names) {
    if (typeof context[name] !== 'function') continue;
    const original = context[name];
    context[name] = function (...args) {
        const started = performance.now();
        try { return original.apply(this, args); }
        finally { functionStats[name].calls += 1; functionStats[name].ms += performance.now() - started; }
    };
}
for (let index = 0; index < 20; index += 1) {
    let started = performance.now();
    const blocks = makeBlocks(series, asOfMs);
    stats.blocks += performance.now() - started;
    const executionBars = blocks.find(block => block.timeframe === '5M')?.candles || [];
    started = performance.now();
    analyzeVisibleHistory(context, { blocks, symbol, currentPrice: Number(executionBars.at(-1)?.c), asOfMs, precision, cache });
    stats.analyze += performance.now() - started;
}
console.log(JSON.stringify({ symbol, clocks: clocks.length, timing: stats, functions: functionStats }, null, 2));
