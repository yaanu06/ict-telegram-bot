'use strict';

/* Research-only runner for the causal, story-first V2 candidate path. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadStrategyContext } = require('./strategy-adapter');
const { loadSeries } = require('./deep-history-cli');
const { buildStoryFirstOpportunities, auditV2Rows } = require('./story-first-v2');

function parseArgs(argv) {
    const args = { manifest: 'backtest-baselines/deep-history-dataset.json', outputRoot: 'backtest-results', symbols: [] };
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

function filled(rows) { return rows.filter(row => row.simulation?.fill_time_ms != null); }

function stats(rows) {
    const trades = filled(rows);
    const values = trades.map(row => Number(row.simulation.r_result)).filter(Number.isFinite);
    const ordered = [...values].sort((a, b) => a - b);
    const median = ordered.length ? ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2 : null;
    let equity = 0; let peak = 0; let dd = 0; let streak = 0; let maxStreak = 0;
    for (const value of values) {
        equity += value; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity);
        streak = value < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
    }
    return {
        candidates: rows.length, filled: trades.length,
        sl: trades.filter(row => row.simulation.final_outcome === 'SL').length,
        tp1_plus: trades.filter(row => ['TP1', 'TP2', 'TP3'].includes(row.simulation.final_outcome)).length,
        tp2_plus: trades.filter(row => ['TP2', 'TP3'].includes(row.simulation.final_outcome)).length,
        tp3: trades.filter(row => row.simulation.final_outcome === 'TP3').length,
        ambiguous: trades.filter(row => row.simulation.final_outcome === 'AMBIGUOUS').length,
        not_filled: rows.length - trades.length,
        total_r: values.reduce((sum, value) => sum + value, 0),
        average_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        median_r: median, max_drawdown_r: dd, max_losing_streak: maxStreak
    };
}

function groups(rows, keyFn) {
    const map = new Map();
    for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
    return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, stats(values)]));
}

function holdout(rows, from, to) {
    const start = Date.parse(from); const end = Date.parse(to); const split = start + (end - start) * 0.7;
    return { split: new Date(split).toISOString(), early: stats(rows.filter(row => row.first_knowable_ms < split)), late: stats(rows.filter(row => row.first_knowable_ms >= split)) };
}

function familyStats(rows) { return groups(rows, row => row.setup_family || 'UNCLASSIFIED'); }

function findV2TradesFile(root, symbol) {
    if (!root || !fs.existsSync(root)) return null;
    const suffix = `${symbol.replace(/[^A-Za-z0-9]+/g, '_')}_DEEP_V2`;
    const directories = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.endsWith(suffix)).sort((left, right) => right.name.localeCompare(left.name));
    for (const directory of directories) {
        const candidate = path.join(root, directory.name, 'trades.json');
        if (!fs.existsSync(candidate)) continue;
        try {
            const rows = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (Array.isArray(rows) && rows.length) return candidate;
        } catch { /* ignore incomplete research artifact */ }
    }
    return null;
}

function mergeCounters(items) {
    const output = {};
    for (const item of items) for (const [key, value] of Object.entries(item || {})) if (Number.isFinite(value)) output[key] = (output[key] || 0) + value;
    return output;
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const manifestPath = path.resolve(process.cwd(), args.manifest);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = (manifest.symbols || manifest.entries || []).filter(entry => !args.symbols.length || args.symbols.includes(entry.symbol));
    const context = loadStrategyContext();
    const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const results = [];
    for (const entry of entries) {
        const series = loadSeries(entry);
        const from = args.from || entry.test_from || manifest.scored_start;
        const to = args.to || entry.test_to || manifest.scored_end;
        console.error(`[story-first] ${entry.symbol} building causal events ${from} -> ${to}`);
        const result = buildStoryFirstOpportunities({ context, series, symbol: entry.symbol, from, to, precision: /XAU/i.test(entry.symbol) ? 2 : 5 });
        const outputDir = path.resolve(process.cwd(), args.outputRoot, `${runId}_${entry.symbol.replace(/[^A-Za-z0-9]+/g, '_')}_STORY_FIRST_V2`);
        fs.mkdirSync(outputDir, { recursive: true });
        const report = {
            symbol: entry.symbol, from, to,
            strategy: 'V2_STORY_FIRST_RESEARCH_NON_AUTHORITATIVE',
            control: 'CURRENT_PRODUCTION_V2_UNCHANGED',
            source_manifest: args.manifest,
            git_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            no_future_leakage: 'events are filtered by FIRST_KNOWABLE and opportunities are formed only after zone retracement/5M confirmation',
            counters: result.counters,
            outcomes: stats(result.opportunities),
            family_breakdown: familyStats(result.opportunities),
            session_breakdown: groups(result.opportunities, row => row.session?.session || 'OTHER'),
            holdout: holdout(result.opportunities, from, to),
            traces: result.traces,
            event_counts: { liquidity_events: result.events.liquidities.length, crt: result.events.crt.length, tbs: result.events.tbs.length, sequences: result.events.sequences.length },
            opportunity_count: result.opportunities.length
        };
        const v2File = args.v2Root ? findV2TradesFile(path.resolve(process.cwd(), args.v2Root), entry.symbol) : null;
        if (v2File && fs.existsSync(v2File)) report.v2_known_opportunity_audit = auditV2Rows(JSON.parse(fs.readFileSync(v2File, 'utf8')), result);
        fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify({ entry, from, to, strategy: report.strategy, control: report.control, git_commit: report.git_commit }, null, 2));
        fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(outputDir, 'trades.json'), JSON.stringify(result.opportunities, null, 2));
        fs.writeFileSync(path.join(outputDir, 'event-traces.json'), JSON.stringify(result.traces, null, 2));
        if (report.v2_known_opportunity_audit) fs.writeFileSync(path.join(outputDir, 'v2-known-opportunity-audit.json'), JSON.stringify(report.v2_known_opportunity_audit, null, 2));
        results.push({ ...report, outputDir });
        console.log(JSON.stringify({ symbol: entry.symbol, outputDir, outcomes: report.outcomes, counters: report.counters, family_breakdown: report.family_breakdown, holdout: report.holdout }, null, 2));
    }
    const combinedRows = results.flatMap(result => JSON.parse(fs.readFileSync(path.join(result.outputDir, 'trades.json'), 'utf8')));
    const combined = { strategy: 'V2_STORY_FIRST_RESEARCH_NON_AUTHORITATIVE', git_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), outcomes: stats(combinedRows), family_breakdown: familyStats(combinedRows), session_breakdown: groups(combinedRows, row => row.session?.session || 'OTHER'), counters: mergeCounters(results.map(result => result.counters)), symbols: results.map(result => ({ symbol: result.symbol, outputDir: result.outputDir, outcomes: result.outcomes, holdout: result.holdout })) };
    fs.writeFileSync(path.resolve(process.cwd(), args.outputRoot, `${runId}_STORY_FIRST_V2_MANIFEST.json`), JSON.stringify(combined, null, 2));
    return combined;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { parseArgs, stats, groups, holdout, familyStats, main };
