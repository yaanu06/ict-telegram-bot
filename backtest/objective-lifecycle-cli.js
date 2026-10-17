'use strict';

const fs = require('fs');
const path = require('path');
const { fetchHistoricalBars } = require('./data-provider');
const { loadStrategyContext } = require('./strategy-adapter');
const { analyzeObjectiveLifecycle } = require('./objective-lifecycle');

function parseArgs(argv) {
    const args = { config: path.join(process.cwd(), 'backtest-baselines', 'current-production.json'), symbols: [] };
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

async function loadSeries(symbol, entry) {
    const series = {};
    const diagnostics = {};
    for (const timeframe of ['1d', '4h', '1h', '15m', '5m']) {
        const result = await fetchHistoricalBars({ symbol, timeframe, from: entry.from, to: entry.to, refresh: false, bars: 5000 });
        series[timeframe] = result.bars;
        diagnostics[timeframe] = {
            cache_path: result.cache_path,
            cache_hit: result.cache_hit,
            count: result.bars.length,
            first: result.bars[0]?.t ?? null,
            last: result.bars.at(-1)?.t ?? null
        };
    }
    return { series, diagnostics };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
    const symbols = args.symbols.length ? args.symbols : config.symbols.map(item => item.symbol);
    const context = loadStrategyContext();
    const output = [];
    for (const symbol of symbols) {
        const entry = config.symbols.find(item => item.symbol === symbol);
        if (!entry) throw new Error(`No canonical baseline entry for ${symbol}`);
        const loaded = await loadSeries(symbol, entry);
        const result = analyzeObjectiveLifecycle({
            context,
            series: loaded.series,
            symbol,
            from: Date.parse(entry.from),
            to: Date.parse(entry.to),
            precision: /XAU|XAG|BTC|ETH/i.test(symbol) ? 2 : 5
        });
        const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_${symbol.replace(/[^A-Za-z0-9]+/g, '_')}_OBJECTIVE`;
        const outputDir = path.join(process.cwd(), 'backtest-results', runId);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify({
            baseline_config: args.config,
            symbol,
            entry,
            diagnostics: loaded.diagnostics,
            analyzer: 'objective-lifecycle-diagnostic-v1',
            campaign_selection_semantics: 'first aligned 1H event per active 4H state; diagnostic proxy only, not production selection',
            objective_selection_semantics: 'nearest valid 4H objective retained as the historical V3.2 comparator; all knowable objectives are also emitted',
            delivery_semantics: 'first closed 5M candle whose directional range touches the objective after the event',
            setup_semantics: 'first deterministic linked 15M FVG setup event after the event; nested events are separately reported'
        }, null, 2));
        fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ symbol, replay_points: result.replay_points, replay_state_counts: result.replay_state_counts, replay_state_coverage: result.replay_state_coverage, funnel: result.funnel, timing: result.timing, latency: result.latency, event_taxonomy: result.event_taxonomy, alignment_taxonomy: result.alignment_taxonomy }, null, 2));
        fs.writeFileSync(path.join(outputDir, 'campaigns.json'), JSON.stringify(result.selected_campaigns, null, 2));
        fs.writeFileSync(path.join(outputDir, 'potential-campaigns.json'), JSON.stringify(result.potential_campaigns, null, 2));
        fs.writeFileSync(path.join(outputDir, 'bridge.json'), JSON.stringify(result.bridge, null, 2));
        fs.writeFileSync(path.join(outputDir, 'lineage.json'), JSON.stringify(result.lineage15, null, 2));
        output.push({ symbol, outputDir, result });
        console.log(JSON.stringify({ symbol, outputDir, replay_points: result.replay_points, replay_state_counts: result.replay_state_counts, replay_state_coverage: result.replay_state_coverage, funnel: result.funnel, timing: result.timing, latency: result.latency, event_taxonomy: result.event_taxonomy, alignment_taxonomy: result.alignment_taxonomy }, null, 2));
    }
    return output;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { parseArgs, loadSeries, main };
