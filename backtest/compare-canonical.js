'use strict';

const fs = require('fs');
const path = require('path');
const { loadStrategyContext } = require('./strategy-adapter');
const { replayHistory, symbolPrecision } = require('./replay');

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

function candidateProjection(row) {
    return {
        candidate_id: row.candidate_id,
        entry: row.entry,
        stop_loss: row.stop_loss,
        tp1: row.tp1,
        tp2: row.tp2,
        tp3: row.tp3,
        first_knowable_ms: row.first_knowable_ms,
        first_selected_at_ms: row.first_selected_at_ms
    };
}

function tradeProjection(row) {
    return {
        candidate: candidateProjection(row),
        simulation: row.simulation
    };
}

function compareArrays(label, expected, actual, projection = value => value) {
    const expectedProjected = expected.map(projection);
    const actualProjected = actual.map(projection);
    if (JSON.stringify(expectedProjected) === JSON.stringify(actualProjected)) return null;
    const limit = Math.max(expectedProjected.length, actualProjected.length);
    for (let index = 0; index < limit; index += 1) {
        if (JSON.stringify(expectedProjected[index]) !== JSON.stringify(actualProjected[index])) {
            return { label, index, expected: expectedProjected[index], actual: actualProjected[index] };
        }
    }
    return { label, expected_length: expectedProjected.length, actual_length: actualProjected.length };
}

async function main() {
    const context = loadStrategyContext();
    const results = [];
    const requested = new Set(process.argv.slice(2));
    for (const item of baseline.symbols.filter(candidate => !requested.size || requested.has(candidate.symbol))) {
        const series = loadSeries(item);
        const actual = replayHistory({
            context, series, symbol: item.symbol,
            from: item.from, to: item.to,
            precision: symbolPrecision(item.symbol, series['5m'][0]?.c ?? series['5m'][0]?.close ?? 1),
            replayTimeframe: '5m', ambiguity: 'exclude', retainLastState: false
        });
        const expectedDir = path.join(process.cwd(), item.run_directory);
        const expectedCandidates = JSON.parse(fs.readFileSync(path.join(expectedDir, 'candidates.json'), 'utf8'));
        const expectedTrades = JSON.parse(fs.readFileSync(path.join(expectedDir, 'trades.json'), 'utf8'));
        const mismatches = [
            compareArrays('candidate_ids', expectedCandidates, actual.candidates, row => row.candidate_id),
            compareArrays('selected_candidate_fields', expectedCandidates.filter(row => row.first_selected_at_ms != null), actual.selected, candidateProjection),
            compareArrays('trades', expectedTrades, actual.trades, tradeProjection)
        ].filter(Boolean);
        results.push({
            symbol: item.symbol,
            clocks: actual.clocks,
            candidates: actual.candidates.length,
            selected: actual.selected.length,
            trades: actual.trades.length,
            mismatch: mismatches[0] || null
        });
    }
    console.log(JSON.stringify({ results, equivalent: results.every(result => !result.mismatch) }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
