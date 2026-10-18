'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadStrategyContext } = require('./strategy-adapter');
const { buildFeatureIndex, enrichTrade, analyzeRows } = require('./v2-feature-analysis');
const { aggregateBars } = require('./deep-history-cli');

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest-baselines', 'deep-history-dataset.json'), 'utf8'));
const requested = new Set(process.argv.slice(2).filter(value => !value.startsWith('--')));

function loadSeries(entry) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), entry.data_file), 'utf8'));
    const base = payload.bars || [];
    return { '5m': base, '15m': aggregateBars(base, '15m'), '1h': aggregateBars(base, '1h'), '4h': aggregateBars(base, '4h'), '1d': aggregateBars(base, '1d') };
}

function latestRun(symbol) {
    const suffix = `${symbol.replace(/[^A-Za-z0-9]+/g, '_')}_DEEP_V2`;
    return fs.readdirSync(path.join(process.cwd(), 'backtest-results'))
        .filter(name => name.endsWith(suffix) && fs.existsSync(path.join(process.cwd(), 'backtest-results', name, 'trades.json')))
        .sort()
        .at(-1);
}

function main() {
    const context = loadStrategyContext();
    const results = [];
    for (const entry of (manifest.entries || []).filter(item => !requested.size || requested.has(item.symbol))) {
        const runName = latestRun(entry.symbol);
        if (!runName) throw new Error(`No completed deep replay found for ${entry.symbol}`);
        const series = loadSeries(entry);
        const trades = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backtest-results', runName, 'trades.json'), 'utf8'));
            const started = performance.now();
        const index = buildFeatureIndex({ context, series, symbol: entry.symbol });
        const enriched = trades.filter(row => row.simulation?.fill_time_ms != null).map(trade => enrichTrade({ trade, index, symbol: entry.symbol }));
        const report = analyzeRows(enriched);
        fs.writeFileSync(path.join(process.cwd(), 'backtest-results', runName, 'features-report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(process.cwd(), 'backtest-results', runName, 'features-enriched.json'), JSON.stringify(enriched, null, 2));
        results.push({ symbol: entry.symbol, run: runName, trades: trades.length, enriched: enriched.length, elapsed_s: Number(((performance.now() - started) / 1000).toFixed(3)), report });
    }
    console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) main();
