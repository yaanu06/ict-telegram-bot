'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchHistoricalBars } = require('./data-provider');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayHistory, symbolPrecision } = require('./replay');
const { buildSummary, renderReport } = require('./metrics');

function parseArgs(argv) {
    const args = { symbols: [], refreshData: false, replayTimeframe: '5m', ambiguity: 'exclude', bars: 5000 };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (key === 'refreshData') { args.refreshData = true; continue; }
        const value = argv[index + 1];
        if (value == null || value.startsWith('--')) continue;
        index += 1;
        if (key === 'symbol') args.symbols.push(value);
        else if (key === 'symbols') args.symbols.push(...value.split(',').map(item => item.trim()).filter(Boolean));
        else if (key === 'bars') args.bars = Number(value);
        else args[key] = value;
    }
    args.symbols = [...new Set(args.symbols)];
    if (!args.symbols.length) args.symbols = ['AUD/USD'];
    if (!args.from || !args.to) throw new Error('Usage requires --from YYYY-MM-DD and --to YYYY-MM-DD');
    if (!['exclude', 'adverse-first'].includes(args.ambiguity)) throw new Error('--ambiguity must be exclude or adverse-first');
    return args;
}

function csvValue(value) {
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const lines = [keys.join(',')];
    for (const row of rows) lines.push(keys.map(key => csvValue(row[key])).join(','));
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

async function runOne(symbol, args, context) {
    const timeframes = ['1d', '4h', '1h', '15m', '5m'];
    const series = {};
    const diagnostics = {};
    for (const timeframe of timeframes) {
        const result = await fetchHistoricalBars({ symbol, timeframe, from: args.from, to: args.to, refresh: args.refreshData, bars: args.bars });
        series[timeframe] = result.bars;
        diagnostics[timeframe] = { ...result.diagnostics, cache_hit: result.cache_hit, cache_path: result.cache_path, provider_symbol: result.provider_symbol };
        console.log(`${symbol} ${timeframe}: ${result.bars.length} bars ${result.cache_hit ? '(cache)' : '(downloaded)'}`);
    }
    const firstPrice = series['5m'][0]?.c || series['1h'][0]?.c || 1;
    const replay = require('./replay').replayHistory({
        context,
        series,
        symbol,
        from: args.from,
        to: args.to,
        precision: symbolPrecision(symbol, firstPrice),
        replayTimeframe: args.replayTimeframe,
        ambiguity: args.ambiguity
    });
    const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '_' + symbol.replace(/[^A-Za-z0-9]+/g, '_');
    const outputDir = path.join(process.cwd(), 'backtest-results', runId);
    fs.mkdirSync(outputDir, { recursive: true });
    let strategyCommit = process.env.GIT_COMMIT || 'not-recorded';
    try { strategyCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { /* source tree may not be a git checkout */ }
    const metadata = {
        symbol,
        from: args.from,
        to: args.to,
        run_at: new Date().toISOString(),
        strategy_git_commit: strategyCommit,
        provider: 'TVKit/TradingView-compatible OHLCV',
        replay_timeframe: args.replayTimeframe,
        ambiguity: args.ambiguity,
        timeframes,
        diagnostics
    };
    const summary = buildSummary(replay, metadata);
    fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify({ ...args, ...metadata }, null, 2));
    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeCsv(path.join(outputDir, 'candidates.csv'), replay.candidates);
    writeCsv(path.join(outputDir, 'trades.csv'), replay.trades.map(row => ({ ...row, simulation: undefined, ...row.simulation })));
    writeCsv(path.join(outputDir, 'rejected.csv'), replay.rejected);
    fs.writeFileSync(path.join(outputDir, 'candidates.json'), JSON.stringify(replay.candidates, null, 2));
    fs.writeFileSync(path.join(outputDir, 'trades.json'), JSON.stringify(replay.trades, null, 2));
    fs.writeFileSync(path.join(outputDir, 'rejected.json'), JSON.stringify(replay.rejected, null, 2));
    fs.writeFileSync(path.join(outputDir, 'report.txt'), renderReport(summary) + '\n');
    console.log(renderReport(summary));
    console.log(`Artifacts: ${outputDir}`);
    return { symbol, outputDir, summary };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const context = loadStrategyContext();
    const results = [];
    for (const symbol of args.symbols) results.push(await runOne(symbol, args, context));
    if (results.length > 1) {
        const combined = results.map(result => result.summary);
        console.log(`Completed ${combined.length} symbol baselines.`);
    }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { parseArgs, csvValue, writeCsv, runOne };
