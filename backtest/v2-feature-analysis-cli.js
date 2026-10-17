'use strict';

const fs = require('fs');
const path = require('path');
const { loadSeries, parseArgs } = require('./objective-lifecycle-cli');
const { loadStrategyContext } = require('./strategy-adapter');
const { buildFeatureIndex, enrichTrade, analyzeRows } = require('./v2-feature-analysis');

function loadCanonicalTrades(entry) {
    const file = path.join(process.cwd(), entry.run_directory, 'trades.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return rows.filter(row => row.simulation?.fill_time_ms != null).map(row => ({ ...row, symbol: entry.symbol }));
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
    const context = loadStrategyContext();
    const rows = [];
    const metadata = [];
    for (const entry of config.symbols) {
        if (args.symbols.length && !args.symbols.includes(entry.symbol)) continue;
        const loaded = await loadSeries(entry.symbol, entry);
        const index = buildFeatureIndex({ context, series: loaded.series, symbol: entry.symbol });
        for (const trade of loadCanonicalTrades(entry)) rows.push(enrichTrade({ trade, index, symbol: entry.symbol }));
        metadata.push({ symbol: entry.symbol, entry, diagnostics: loaded.diagnostics, canonical_trade_count: loadCanonicalTrades(entry).length });
    }
    const report = analyzeRows(rows);
    const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_V2_FEATURE_STUDY`;
    const outputDir = path.join(process.cwd(), 'backtest-results', runId);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify({ baseline_config: args.config, study: 'canonical-v2-trade-structural-features-v1', decision_time: 'candidate.first_knowable_ms; only events with FIRST_KNOWABLE <= decision time are attached', metadata }, null, 2));
    fs.writeFileSync(path.join(outputDir, 'trades-enriched.json'), JSON.stringify(rows, null, 2));
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outputDir, trade_count: rows.length, report }, null, 2));
    return { outputDir, rows, report };
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { loadCanonicalTrades, main };
