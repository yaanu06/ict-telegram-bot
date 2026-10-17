'use strict';

/*
 * Offline Kronos authority research.
 *
 * This module consumes existing replay artifacts only.  It does not run the
 * strategy, alter candidate construction, or participate in live selection.
 * Forecasts are requested through the same resident official Kronos worker
 * used by production and are cached before candidate-specific summaries are
 * calculated.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Kronos = require('./kronos-adapter');
const { TIMEFRAME_MS } = require('./data-provider');

const DEFAULT_RESEARCH_PATHS = 10;
const DEFAULT_LOOKBACK = 400;
const DEFAULT_SEED = 42;
const DEFAULT_OUTPUT = path.join('data', 'kronos', 'authority-research');
const RESEARCH_TIMEFRAMES = new Set(['1h', '4h']);
const SUPPORT_BINS = Object.freeze([
    { label: '0-0.25', min: 0, max: 0.25, inclusiveMax: false },
    { label: '0.25-0.50', min: 0.25, max: 0.50, inclusiveMax: false },
    { label: '0.50-0.75', min: 0.50, max: 0.75, inclusiveMax: false },
    { label: '0.75-1.00', min: 0.75, max: 1.00, inclusiveMax: true }
]);
const MAGNITUDE_BINS = Object.freeze([
    { label: '< -0.5R', min: -Infinity, max: -0.5, inclusiveMax: false },
    { label: '-0.5R to 0', min: -0.5, max: 0, inclusiveMax: false },
    { label: '0 to +0.5R', min: 0, max: 0.5, inclusiveMax: false },
    { label: '+0.5R to +1R', min: 0.5, max: 1, inclusiveMax: true },
    { label: '> +1R', min: 1, max: Infinity, inclusiveMax: false }
]);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function average(values) {
    const numbers = values.filter(Number.isFinite);
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function median(values) {
    const numbers = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function round(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function canonicalTimeframe(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === '60' ? '1h' : text === '240' ? '4h' : text;
}

function canonicalSymbol(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseArgs(argv) {
    const args = {
        runs: [],
        paths: Number(process.env.KRONOS_PATHS || DEFAULT_RESEARCH_PATHS),
        lookback: DEFAULT_LOOKBACK,
        seed: DEFAULT_SEED,
        output: DEFAULT_OUTPUT,
        cacheDir: path.join('data', 'kronos', 'authority-cache')
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--run' || token === '--runs') args.runs.push(...String(argv[++index] || '').split(',').filter(Boolean));
        else if (token === '--paths') args.paths = Number(argv[++index]);
        else if (token === '--lookback') args.lookback = Number(argv[++index]);
        else if (token === '--seed') args.seed = Number(argv[++index]);
        else if (token === '--output') args.output = argv[++index];
        else if (token === '--cache-dir') args.cacheDir = argv[++index];
    }
    args.paths = Math.min(50, Math.max(1, Number(args.paths) || DEFAULT_RESEARCH_PATHS));
    args.lookback = Math.min(512, Math.max(1, Number(args.lookback) || DEFAULT_LOOKBACK));
    args.seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : DEFAULT_SEED;
    return args;
}

function isHighFidelityRun(config) {
    return config
        && config.ambiguity === 'exclude'
        && config.replay_timeframe === '5m'
        && config.diagnostics
        && config.symbol
        && config.from
        && config.to;
}

function listRuns(resultsRoot, explicitRuns = []) {
    if (explicitRuns.length) return explicitRuns.map(item => path.resolve(item));
    return fs.readdirSync(resultsRoot, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => path.join(resultsRoot, item.name))
        .filter(runDir => {
            const configPath = path.join(runDir, 'config.json');
            return fs.existsSync(configPath) && isHighFidelityRun(readJson(configPath));
        });
}

function selectLongestRuns(resultsRoot, explicitRuns = []) {
    const candidates = listRuns(resultsRoot, explicitRuns).map(runDir => ({
        runDir,
        config: readJson(path.join(runDir, 'config.json'))
    }));
    const selected = new Map();
    for (const item of candidates) {
        const key = canonicalSymbol(item.config.symbol);
        const duration = Date.parse(item.config.to) - Date.parse(item.config.from);
        const current = selected.get(key);
        if (!current || duration > current.duration) selected.set(key, { ...item, duration });
    }
    const required = ['AUDUSD', 'GBPJPY', 'XAUUSD'];
    const missing = required.filter(symbol => !selected.has(symbol));
    if (missing.length) throw new Error(`Missing high-fidelity runs for: ${missing.join(', ')}`);
    return required.map(symbol => selected.get(symbol));
}

function loadSeries(config) {
    const series = {};
    for (const timeframe of config.timeframes || ['1d', '4h', '1h', '15m', '5m']) {
        const tf = canonicalTimeframe(timeframe);
        const cachePath = config.diagnostics?.[timeframe]?.cache_path;
        if (!cachePath || !fs.existsSync(cachePath)) throw new Error(`Missing cached ${tf} data: ${cachePath || 'no cache path'}`);
        const payload = readJson(cachePath);
        const interval = TIMEFRAME_MS[tf];
        series[tf] = (payload.bars || []).map(row => {
            const timestamp = finite(row.timestamp ?? row.t);
            return {
                timestamp,
                t: timestamp,
                open: finite(row.open ?? row.o),
                high: finite(row.high ?? row.h),
                low: finite(row.low ?? row.l),
                close: finite(row.close ?? row.c),
                volume: finite(row.volume ?? row.v) ?? 0,
                is_closed: row.is_closed !== false,
                close_time_ms: finite(row.close_time_ms) ?? timestamp + interval
            };
        }).filter(row => row.timestamp != null && row.close_time_ms != null).sort((left, right) => left.timestamp - right.timestamp);
    }
    return series;
}

function loadTradeRows(runDir, config) {
    const trades = readJson(path.join(runDir, 'trades.json'));
    const analysisPath = path.join(runDir, 'analysis.json');
    const analysisRows = fs.existsSync(analysisPath) ? readJson(analysisPath).records || [] : [];
    const analysisById = new Map(analysisRows.map(row => [row.candidate_id, row]));
    return trades
        .filter(row => row.simulation?.fill_time_ms != null && row.simulation?.ambiguous !== true)
        .map(row => ({
            ...row,
            symbol: config.symbol,
            run_directory: runDir,
            analysis: analysisById.get(row.candidate_id) || {},
            simulation: row.simulation || {}
        }));
}

function closedCandles(series, timeframe, asOfMs, lookback) {
    return Kronos.closedCandleWindow(series[timeframe] || [], timeframe, asOfMs, lookback);
}

function workerCandles(candles) {
    return candles.map(candle => ({
        timestamp: candle.timestamp ?? candle.t,
        open: Number(candle.open ?? candle.o),
        high: Number(candle.high ?? candle.h),
        low: Number(candle.low ?? candle.l),
        close: Number(candle.close ?? candle.c),
        volume: Number(candle.volume ?? candle.v ?? 0),
        amount: Number(candle.amount ?? candle.a ?? 0),
        is_closed: candle.is_closed !== false
    }));
}

function forecastIdentity({ symbol, timeframe, candles, model, lookback, horizon, paths, seed }) {
    const key = Kronos.cacheKey({
        symbol,
        timeframe,
        lastClosedTimestamp: candles.at(-1)?.timestamp || candles.at(-1)?.t,
        model,
        lookback: candles.length,
        horizon,
        paths,
        seed
    });
    const candleHash = sha256(JSON.stringify(workerCandles(candles)));
    return { key, candle_hash: candleHash, id: sha256(`${key}|${candleHash}`) };
}

function cachePath(cacheDir, identity) {
    return path.join(cacheDir, `${identity.id}.json`);
}

function candidateForKronos(row) {
    return {
        action: row.action,
        side: row.side,
        entry: Number(row.entry),
        stop_loss: Number(row.stop_loss),
        tp1: Number(row.tp1),
        tp2: Number(row.tp2),
        tp3: Number(row.tp3)
    };
}

async function getRawForecast({ adapter, cacheDir, identity, payload }) {
    const filePath = cachePath(cacheDir, identity);
    if (fs.existsSync(filePath)) {
        const cached = readJson(filePath);
        if (cached.identity?.key === identity.key && cached.identity?.candle_hash === identity.candle_hash) {
            return { raw: cached.raw_forecast, cache_hit: true, filePath };
        }
    }
    const raw = await adapter.requestForecast(payload);
    writeJson(filePath, {
        identity,
        request: { ...payload, candles: undefined, candle_count: payload.candles.length },
        raw_forecast: raw,
        cached_at: new Date().toISOString()
    });
    return { raw, cache_hit: false, filePath };
}

function simulationOutcome(row) {
    return String(row.simulation?.final_outcome || '').toUpperCase();
}

function isTp1Plus(row) {
    return row.simulation?.targets_reached?.[0] === true || ['TP1', 'TP2', 'TP3'].includes(simulationOutcome(row));
}

function isTp2Plus(row) {
    return row.simulation?.targets_reached?.[1] === true || ['TP2', 'TP3'].includes(simulationOutcome(row));
}

function isTp3(row) {
    return row.simulation?.targets_reached?.[2] === true || simulationOutcome(row) === 'TP3';
}

function isResolvedWinner(row) {
    return isTp1Plus(row) && ['TP1', 'TP2', 'TP3'].includes(simulationOutcome(row));
}

function isSl(row) {
    return simulationOutcome(row) === 'SL';
}

function isSlBeforeTp1(row) {
    return isSl(row) && row.simulation?.tp1_before_sl !== true;
}

function statistics(rows) {
    const r = rows.map(row => finite(row.simulation?.r_result)).filter(value => value != null);
    let currentLosingStreak = 0;
    let maxLosingStreak = 0;
    for (const value of [...rows].sort((left, right) => Number(left.first_selected_at_ms) - Number(right.first_selected_at_ms)).map(row => finite(row.simulation?.r_result)).filter(value => value != null)) {
        if (value < 0) {
            currentLosingStreak += 1;
            maxLosingStreak = Math.max(maxLosingStreak, currentLosingStreak);
        } else currentLosingStreak = 0;
    }
    const count = rows.length;
    const slBefore = rows.filter(isSlBeforeTp1).length;
    return {
        count,
        sl: rows.filter(isSl).length,
        tp1_plus: rows.filter(isTp1Plus).length,
        tp2_plus: rows.filter(isTp2Plus).length,
        tp3: rows.filter(isTp3).length,
        total_r: round(r.reduce((sum, value) => sum + value, 0)),
        average_r: round(average(r)),
        median_r: round(median(r)),
        sl_before_tp1_count: slBefore,
        sl_before_tp1_rate: count ? round(slBefore / count) : null,
        max_losing_streak: maxLosingStreak
    };
}

function groupedStatistics(rows, key) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[key] ?? 'UNKNOWN';
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(row);
    }
    return Object.fromEntries([...groups.entries()].map(([value, items]) => [value, statistics(items)]));
}

function rangeBin(value, bins) {
    const number = finite(value);
    if (number == null) return null;
    return bins.find(bin => number >= bin.min && (number < bin.max || (bin.inclusiveMax && number <= bin.max)))?.label || null;
}

function binnedStatistics(rows, valueGetter, bins) {
    const groups = Object.fromEntries(bins.map(bin => [bin.label, []]));
    let unbinned = 0;
    for (const row of rows) {
        const bin = rangeBin(valueGetter(row), bins);
        if (bin) groups[bin].push(row);
        else unbinned += 1;
    }
    return { bins: Object.fromEntries(Object.entries(groups).map(([label, items]) => [label, statistics(items)])), unbinned };
}

function eventKey(row) {
    return `${canonicalSymbol(row.symbol)}|${row.first_selected_at_ms}`;
}

function compareQuality(left, right, { alignmentFirst = false, penalty = 0 } = {}) {
    const alignmentRank = value => value === 'ALIGNED' ? 1 : value === 'NEUTRAL' ? 0 : -1;
    if (alignmentFirst && alignmentRank(left.kronos_alignment) !== alignmentRank(right.kronos_alignment)) return alignmentRank(right.kronos_alignment) - alignmentRank(left.kronos_alignment);
    const leftScore = Number(left.score || 0) + (left.kronos_alignment === 'CONFLICT' ? penalty : 0);
    const rightScore = Number(right.score || 0) + (right.kronos_alignment === 'CONFLICT' ? penalty : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return String(left.candidate_id).localeCompare(String(right.candidate_id));
}

function selectPerEvent(rows, options) {
    const groups = new Map();
    for (const row of rows) {
        const key = eventKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const selected = [];
    for (const items of groups.values()) {
        if (items.length === 1) selected.push(items[0]);
        else selected.push([...items].sort((left, right) => compareQuality(left, right, options))[0]);
    }
    return selected;
}

function policyComparison(rows) {
    const baseline = rows;
    const conflictBlocker = rows.filter(row => row.kronos_alignment !== 'CONFLICT');
    const alignmentPreference = selectPerEvent(rows, { alignmentFirst: true });
    const barrierAndConflict = rows.filter(row => !(row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES' && row.kronos_alignment === 'CONFLICT'));
    const fixedPenalty = -10;
    const rankingPenalty = selectPerEvent(rows, { penalty: fixedPenalty });
    const policies = {
        A_BASELINE: baseline,
        B_CONFLICT_BLOCKER: conflictBlocker,
        C_ALIGNMENT_PREFERENCE: alignmentPreference,
        D_4H_BARRIER_PLUS_KRONOS_CONFLICT: barrierAndConflict,
        E_CONFLICT_RANKING_PENALTY_MINUS_10: rankingPenalty
    };
    return Object.fromEntries(Object.entries(policies).map(([name, items]) => {
        const ids = new Set(items.map(row => row.candidate_id));
        const removed = rows.filter(row => !ids.has(row.candidate_id));
        return [name, {
            ...statistics(items),
            trades_removed: removed.length,
            winners_removed: removed.filter(isTp1Plus).length,
            losers_removed: removed.filter(isSlBeforeTp1).length,
            fixed_penalty_r: name === 'E_CONFLICT_RANKING_PENALTY_MINUS_10' ? fixedPenalty : null
        }];
    }));
}

function representative(row) {
    const forecast = row.forecast;
    return {
        symbol: row.symbol,
        timestamp: Number.isFinite(Number(row.first_selected_at_ms)) ? new Date(Number(row.first_selected_at_ms)).toISOString() : null,
        timeframe: row.timeframe,
        direction: row.side,
        entry: row.entry,
        sl: row.stop_loss,
        tp1: row.tp1,
        actual_outcome: simulationOutcome(row),
        actual_r: row.simulation?.r_result,
        kronos_direction: forecast.kronos_direction,
        kronos_alignment: forecast.kronos_alignment,
        kronos_forecast_return_pct: round(forecast.kronos_forecast_return_pct, 6),
        kronos_expected_move_r: round(forecast.kronos_upside_r),
        kronos_fill_path_support: round(forecast.kronos_fill_path_support),
        kronos_tp1_path_support: round(forecast.kronos_tp1_path_support),
        kronos_sl_path_support: round(forecast.kronos_sl_path_support),
        four_h_barrier_before_tp1: row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 || 'UNKNOWN'
    };
}

function chooseRepresentatives(rows) {
    const ordered = [...rows].sort((left, right) => Number(left.first_selected_at_ms) - Number(right.first_selected_at_ms));
    const categories = {
        losing_trade_kronos_conflict: row => isSlBeforeTp1(row) && row.kronos_alignment === 'CONFLICT',
        losing_trade_kronos_aligned: row => isSlBeforeTp1(row) && row.kronos_alignment === 'ALIGNED',
        winning_trade_kronos_aligned: row => isResolvedWinner(row) && row.kronos_alignment === 'ALIGNED',
        winning_trade_kronos_conflict: row => isResolvedWinner(row) && row.kronos_alignment === 'CONFLICT'
    };
    return Object.fromEntries(Object.entries(categories).map(([label, predicate]) => {
        const row = ordered.find(predicate);
        return [label, row ? representative(row) : null];
    }));
}

function enrichResearchRows(rows, forecastByRow) {
    return rows.map(row => ({
        ...row,
        kronos_status: forecastByRow.get(row.candidate_id)?.kronos_status || 'UNAVAILABLE',
        kronos_alignment: forecastByRow.get(row.candidate_id)?.kronos_alignment || 'UNAVAILABLE',
        kronos_direction: forecastByRow.get(row.candidate_id)?.kronos_direction || null,
        forecast: forecastByRow.get(row.candidate_id) || { kronos_status: 'UNAVAILABLE' }
    }));
}

function buildReport(rows, selectedRuns, settings, cacheStats) {
    const usable = rows.filter(row => row.forecast?.kronos_status === 'OK');
    const alignment = Object.fromEntries(['ALIGNED', 'CONFLICT', 'NEUTRAL'].map(value => [value, statistics(usable.filter(row => row.kronos_alignment === value))]));
    const expectedMove = binnedStatistics(usable, row => row.forecast.kronos_upside_r, MAGNITUDE_BINS);
    const support = name => binnedStatistics(usable, row => row.forecast[name], SUPPORT_BINS);
    const barrierGroups = {
        NO_4H_BARRIER_KRONOS_ALIGNED: usable.filter(row => row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 !== 'YES' && row.kronos_alignment === 'ALIGNED'),
        NO_4H_BARRIER_KRONOS_CONFLICT: usable.filter(row => row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 !== 'YES' && row.kronos_alignment === 'CONFLICT'),
        HAS_4H_BARRIER_KRONOS_ALIGNED: usable.filter(row => row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES' && row.kronos_alignment === 'ALIGNED'),
        HAS_4H_BARRIER_KRONOS_CONFLICT: usable.filter(row => row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES' && row.kronos_alignment === 'CONFLICT')
    };
    const losers = usable.filter(isSlBeforeTp1);
    const winners = usable.filter(isTp1Plus);
    const conflictCount = items => items.filter(row => row.kronos_alignment === 'CONFLICT').length;
    return {
        generated_at: new Date().toISOString(),
        settings,
        selected_runs: selectedRuns.map(item => ({ symbol: item.config.symbol, run_directory: item.runDir, from: item.config.from, to: item.config.to, strategy_git_commit: item.config.strategy_git_commit })),
        cache: cacheStats,
        population: { total_filled_non_ambiguous: rows.length, usable_kronos_forecasts: usable.length, unavailable_or_error: rows.length - usable.length },
        future_leakage_check: {
            passed: rows.every(row => Number(row.forecast_input_last_close_time_ms) <= Number(row.first_selected_at_ms)),
            rows_checked: rows.length,
            max_input_close_after_candidate_ms: Math.max(0, ...rows.map(row => Number(row.forecast_input_last_close_time_ms) - Number(row.first_selected_at_ms)))
        },
        alignment,
        by_symbol: groupedStatistics(usable, 'symbol'),
        by_timeframe: groupedStatistics(usable, 'timeframe'),
        by_side: groupedStatistics(usable, 'side'),
        forecast_magnitude_expected_move_r: expectedMove,
        path_support: {
            fill: support('kronos_fill_path_support'),
            tp1: support('kronos_tp1_path_support'),
            sl: support('kronos_sl_path_support')
        },
        four_h_barrier_interaction: Object.fromEntries(Object.entries(barrierGroups).map(([name, items]) => [name, statistics(items)])),
        losers: { sl_trades: losers.length, kronos_conflict: conflictCount(losers), kronos_conflict_rate: losers.length ? round(conflictCount(losers) / losers.length) : null },
        winners: {
            tp1_plus: { count: winners.length, kronos_conflict: conflictCount(winners), kronos_conflict_rate: winners.length ? round(conflictCount(winners) / winners.length) : null },
            tp2_plus: (() => { const items = usable.filter(isTp2Plus); return { count: items.length, kronos_conflict: conflictCount(items), kronos_conflict_rate: items.length ? round(conflictCount(items) / items.length) : null }; })(),
            tp3: (() => { const items = usable.filter(isTp3); return { count: items.length, kronos_conflict: conflictCount(items), kronos_conflict_rate: items.length ? round(conflictCount(items) / items.length) : null }; })()
        },
        policies: policyComparison(usable),
        representatives: chooseRepresentatives(usable),
        notes: [
            'The population is the filled, non-ambiguous selected-trade set from the longest available high-fidelity replay run for each requested symbol.',
            'OPEN_AT_END fills remain in the population with their replay R result; they are not silently converted to wins or losses.',
            'SL is the replay final outcome; TP1+/TP2+/TP3 counts mean the corresponding target was reached and can overlap a later final SL after partial delivery.',
            'Kronos alignment uses the simple BUY-bullish / SELL-bearish terminal-direction rule with the existing fixed neutral band.',
            'Path-support fields are sampled path fractions, not calibrated probabilities.',
            'Policies C and E reselect only when multiple filled selected candidates share the exact symbol and first-selection timestamp. Policy E uses a fixed -10 score penalty and no optimization.',
            'All forecast candles were closed candidate-timeframe candles available at first selection; no post-entry candles were sent to Kronos.'
        ],
        records: rows.map(row => ({
            symbol: row.symbol,
            candidate_id: row.candidate_id,
            timestamp: row.first_selected_at,
            timeframe: row.timeframe,
            side: row.side,
            entry: row.entry,
            stop_loss: row.stop_loss,
            tp1: row.tp1,
            actual_outcome: simulationOutcome(row),
            actual_r: row.simulation?.r_result,
            forecast_input_candle_count: row.forecast_input_candle_count,
            forecast_input_last_timestamp: row.forecast_input_last_timestamp,
            forecast_input_last_close_time_ms: row.forecast_input_last_close_time_ms,
            four_h_barrier_before_tp1: row.analysis.ANALYSIS_4H_BARRIER_BEFORE_TP1 || 'UNKNOWN',
            kronos: row.forecast
        }))
    };
}

function table(headers, rows) {
    const line = values => `| ${values.join(' | ')} |`;
    return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function statsRow(label, value) {
    return [label, value.count, value.sl, value.tp1_plus, value.tp2_plus, value.tp3, value.total_r, value.average_r, value.median_r, value.sl_before_tp1_rate];
}

function renderMarkdown(report) {
    const s = report.alignment;
    const statsHeaders = ['Group', 'N', 'SL', 'TP1+', 'TP2+', 'TP3', 'Total R', 'Avg R', 'Median R', 'SL-before-TP1'];
    const alignmentRows = Object.entries(s).map(([key, value]) => statsRow(key, value));
    const section = (title, value) => `\n### ${title}\n\n${table(statsHeaders, Object.entries(value).map(([key, item]) => statsRow(key, item)))}`;
    const binSection = (title, value) => `\n### ${title}\n\n${table(statsHeaders, Object.entries(value.bins).map(([key, item]) => statsRow(key, item)))}\n\nUnbinned: ${value.unbinned}`;
    const policyRows = Object.entries(report.policies).map(([key, value]) => [key, value.count, value.total_r, value.average_r, value.sl_before_tp1_rate, value.trades_removed, value.winners_removed, value.losers_removed]);
    const reps = Object.entries(report.representatives).map(([key, value]) => [key, value ? `${value.symbol} ${value.timestamp} ${value.timeframe} ${value.direction}` : 'NOT AVAILABLE', value?.actual_outcome ?? '', value?.kronos_alignment ?? '', value?.kronos_forecast_return_pct ?? '', value?.kronos_tp1_path_support ?? '', value?.kronos_sl_path_support ?? '', value?.four_h_barrier_before_tp1 ?? '']);
    return [
        '# Kronos authority research',
        '',
        `Generated: ${report.generated_at}`,
        `Population: ${report.population.total_filled_non_ambiguous} filled non-ambiguous selected trades; usable forecasts ${report.population.usable_kronos_forecasts}.`,
        `Research paths: ${report.settings.paths}; lookback: ${report.settings.lookback}; seed: ${report.settings.seed}.`,
        '',
        '## Primary alignment comparison',
        '', table(statsHeaders, alignmentRows),
        section('By symbol', report.by_symbol),
        section('By timeframe', report.by_timeframe),
        section('By side', report.by_side),
        binSection('Forecast magnitude: KRONOS_EXPECTED_MOVE_R', report.forecast_magnitude_expected_move_r),
        binSection('Fill path support', report.path_support.fill),
        binSection('TP1 path support', report.path_support.tp1),
        binSection('SL path support', report.path_support.sl),
        section('4H barrier plus Kronos alignment', report.four_h_barrier_interaction),
        '', '## Loser and winner rejection cost', '',
        table(['Set', 'N', 'Kronos conflict', 'Conflict rate'], [
            ['SL-before-TP1', report.losers.sl_trades, report.losers.kronos_conflict, report.losers.kronos_conflict_rate],
            ['TP1+', report.winners.tp1_plus.count, report.winners.tp1_plus.kronos_conflict, report.winners.tp1_plus.kronos_conflict_rate],
            ['TP2+', report.winners.tp2_plus.count, report.winners.tp2_plus.kronos_conflict, report.winners.tp2_plus.kronos_conflict_rate],
            ['TP3', report.winners.tp3.count, report.winners.tp3.kronos_conflict, report.winners.tp3.kronos_conflict_rate]
        ]),
        '', '## Offline policy comparison', '',
        table(['Policy', 'N', 'Total R', 'Avg R', 'SL-before-TP1', 'Trades removed', 'Winners removed', 'Losers removed'], policyRows),
        '', '## Representative cases', '',
        table(['Case', 'Trade', 'Outcome', 'Alignment', 'Forecast return %', 'TP1 support', 'SL support', '4H barrier'], reps),
        '', '## Notes', '', ...report.notes.map(note => `- ${note}`), ''
    ].join('\n');
}

async function runResearch({ cwd = process.cwd(), args = parseArgs([]), logger = console.log } = {}) {
    const resultsRoot = path.resolve(cwd, 'backtest-results');
    const selectedRuns = selectLongestRuns(resultsRoot, args.runs);
    const adapter = Kronos.createHistoricalKronosAdapter({ env: process.env });
    const rows = [];
    const forecastByRow = new Map();
    const cacheStats = { hits: 0, misses: 0, requests: 0, files: [] };
    try {
        for (const selected of selectedRuns) {
            const series = loadSeries(selected.config);
            const tradeRows = loadTradeRows(selected.runDir, selected.config);
            logger(`${selected.config.symbol}: ${tradeRows.length} filled non-ambiguous selected trades from ${selected.config.from} to ${selected.config.to}`);
            for (const row of tradeRows) {
                const timeframe = canonicalTimeframe(row.timeframe);
                if (!RESEARCH_TIMEFRAMES.has(timeframe)) continue;
                const asOfMs = Number(row.first_selected_at_ms);
                const candles = closedCandles(series, timeframe, asOfMs, args.lookback);
                if (candles.length < 2) {
                    logger(`SKIP ${row.candidate_id}: fewer than two closed ${timeframe} candles at candidate time`);
                    continue;
                }
                if (candles.some(candle => Number(candle.close_time_ms) > asOfMs)) {
                    throw new Error(`Future leakage check failed for ${row.candidate_id}`);
                }
                const horizon = timeframe === '1h' ? 12 : 6;
                const model = String(process.env.KRONOS_MODEL_ID || process.env.KRONOS_MODEL || 'NeoQuasar/Kronos-small');
                const identity = forecastIdentity({ symbol: selected.config.symbol, timeframe, candles, model, lookback: args.lookback, horizon, paths: args.paths, seed: args.seed });
                const payload = {
                    symbol: selected.config.symbol,
                    timeframe,
                    lookback: args.lookback,
                    horizon,
                    paths: args.paths,
                    seed: args.seed,
                    candles: workerCandles(candles)
                };
                cacheStats.requests += 1;
                const cached = await getRawForecast({ adapter, cacheDir: path.resolve(cwd, args.cacheDir), identity, payload });
                if (cached.cache_hit) cacheStats.hits += 1;
                else cacheStats.misses += 1;
                cacheStats.files.push(cached.filePath);
                const last = candles.at(-1);
                const summary = Kronos.evaluateHistoricalKronosForecast(cached.raw, candidateForKronos(row), {
                    timeframe,
                    lookback: candles.length,
                    horizon,
                    paths: args.paths,
                    seed: args.seed,
                    startPrice: Number(last.close ?? last.c)
                });
                const enriched = {
                    ...row,
                    timeframe,
                    forecast_input_candle_count: candles.length,
                    forecast_input_last_timestamp: last.timestamp ?? last.t,
                    forecast_input_last_close_time_ms: last.close_time_ms,
                    forecast: summary
                };
                rows.push(enriched);
                forecastByRow.set(row.candidate_id, summary);
                logger(`  ${rows.length} ${timeframe} ${row.side} ${new Date(asOfMs).toISOString()}: ${summary.kronos_status} ${summary.kronos_alignment || ''} ${cached.cache_hit ? '(cache)' : '(inference)'}`);
            }
        }
    } finally {
        adapter.close();
    }
    const usableRows = enrichResearchRows(rows, forecastByRow);
    const report = buildReport(usableRows, selectedRuns, { paths: args.paths, lookback: args.lookback, seed: args.seed, model: process.env.KRONOS_MODEL_ID || 'NeoQuasar/Kronos-small', tokenizer: process.env.KRONOS_TOKENIZER_ID || 'NeoQuasar/Kronos-Tokenizer-base' }, { ...cacheStats, files: [...new Set(cacheStats.files)] });
    const outputBase = path.resolve(cwd, args.output);
    writeJson(`${outputBase}.json`, report);
    fs.writeFileSync(`${outputBase}.md`, renderMarkdown(report));
    logger(`Report: ${outputBase}.md`);
    logger(`JSON: ${outputBase}.json`);
    return report;
}

if (require.main === module) {
    runResearch({ args: parseArgs(process.argv.slice(2)) }).catch(error => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_RESEARCH_PATHS,
    SUPPORT_BINS,
    MAGNITUDE_BINS,
    parseArgs,
    selectLongestRuns,
    statistics,
    binnedStatistics,
    policyComparison,
    runResearch,
    renderMarkdown
};
