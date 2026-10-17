'use strict';

/*
 * Offline research only. This module reads replay artifacts and reconstructs
 * the existing deterministic audits at each candidate's first selected time.
 * It deliberately does not participate in live or replay qualification.
 */
const fs = require('fs');
const path = require('path');
const { loadStrategyContext, analyzeVisibleHistory } = require('./strategy-adapter');
const { makeBlocks, symbolPrecision } = require('./replay');

const INTERVAL_MS = Object.freeze({ '1d': 86400000, '4h': 14400000, '1h': 3600000, '15m': 900000, '5m': 300000 });

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function canonicalSeries(config) {
    const series = {};
    for (const timeframe of config.timeframes || ['1d', '4h', '1h', '15m', '5m']) {
        const cachePath = config.diagnostics?.[timeframe]?.cache_path;
        if (!cachePath || !fs.existsSync(cachePath)) throw new Error(`Missing cached ${timeframe} data: ${cachePath || 'cache path unavailable'}`);
        const payload = readJson(cachePath);
        const interval = INTERVAL_MS[timeframe];
        series[timeframe] = (payload.bars || []).map(row => {
            const timestamp = Number(row.timestamp ?? row.t);
            return {
                t: timestamp,
                timestamp,
                o: Number(row.open ?? row.o),
                h: Number(row.high ?? row.h),
                l: Number(row.low ?? row.l),
                c: Number(row.close ?? row.c),
                v: Number(row.volume ?? row.v ?? 0),
                is_closed: row.is_closed !== false,
                close_time_ms: timestamp + interval
            };
        }).filter(row => Number.isFinite(row.t)).sort((a, b) => a.t - b.t);
    }
    return series;
}

function active(record) {
    return record && !['INVALIDATED', 'CONSUMED', 'SUPERSEDED'].includes(String(record.status || '').toUpperCase());
}

function numericZone(record) {
    const low = Number(record.low ?? record.zone_low ?? record.level?.zone_low);
    const high = Number(record.high ?? record.zone_high ?? record.level?.zone_high);
    return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

function pathIntersection(record, entry, tp1) {
    const zone = numericZone(record);
    if (!zone) return null;
    const lowPath = Math.min(entry, tp1);
    const highPath = Math.max(entry, tp1);
    if (zone.high < lowPath || zone.low > highPath) return null;
    const entryInside = entry >= zone.low && entry <= zone.high;
    const distance = entryInside ? 0 : (entry < zone.low ? zone.low - entry : entry - zone.high);
    return { ...zone, entry_inside: entryInside, distance: Math.max(0, distance) };
}

function structureRows(result, side) {
    const opposingType = side === 'BUY' ? 'SUPPLY' : 'DEMAND';
    return (result.supply_demand || [])
        .filter(row => String(row.type || '').toUpperCase() === opposingType && active(row));
}

function opposingMsnrRows(result, side) {
    const direction = side === 'BUY' ? 'SELL' : 'BUY';
    return (result.msnr_audit?.records || [])
        .filter(row => String(row.direction).toUpperCase() === direction && active(row));
}

function nearestBarrier(records, entry, tp1) {
    const candidates = records.map(record => {
        const intersection = pathIntersection(record, entry, tp1);
        return intersection ? { record, ...intersection } : null;
    }).filter(Boolean).sort((left, right) => left.distance - right.distance);
    return candidates[0] || null;
}

function distanceBin(distanceR, inside) {
    if (inside) return 'ENTRY_INSIDE';
    if (!Number.isFinite(distanceR)) return 'NO_BARRIER_BEFORE_TP1';
    if (distanceR < 0.25) return '0-0.25R';
    if (distanceR < 0.5) return '0.25-0.50R';
    if (distanceR < 0.75) return '0.50-0.75R';
    if (distanceR < 1) return '0.75-1.00R';
    return 'NO_BARRIER_BEFORE_TP1';
}

function directionLabel(value) {
    return String(value || '').toUpperCase() === 'BUY' ? 'BUY' : String(value || '').toUpperCase() === 'SELL' ? 'SELL' : 'NONE';
}

function chronology(result, candidate) {
    const side = directionLabel(candidate.side);
    const candidateTime = Number(candidate.first_selected_at_ms);
    const validCrt = (result.crt_audit?.records || []).filter(row => active(row) && Number(row.first_knowable_ms) <= candidateTime);
    const valid4hCrt = validCrt.filter(row => String(row.timeframe).toUpperCase() === '4H').sort((a, b) => Number(a.first_knowable_ms) - Number(b.first_knowable_ms));
    const supportingRefs = new Set(candidate.crt_refs || []);
    const supporting = valid4hCrt.filter(row => supportingRefs.has(row.ref) && directionLabel(row.direction) === side);
    const supportingLatest = supporting.at(-1);
    const opposing = valid4hCrt.filter(row => directionLabel(row.direction) !== side);
    const newerOpposing = supportingLatest ? opposing.some(row => Number(row.first_knowable_ms) > Number(supportingLatest.first_knowable_ms)) : false;
    const latest = valid4hCrt.at(-1);

    const validMsnr = (result.msnr_audit?.records || []).filter(row => active(row) && Number(row.first_knowable_ms) <= candidateTime);
    const valid4hMsnr = validMsnr.filter(row => String(row.timeframe).toUpperCase() === '4H').sort((a, b) => Number(a.first_knowable_ms) - Number(b.first_knowable_ms));
    const supportingMsnrRefs = new Set(candidate.msnr_refs || []);
    const supportingMsnr = valid4hMsnr.filter(row => supportingMsnrRefs.has(row.ref) && directionLabel(row.direction) === side);
    const latestSupportingMsnr = supportingMsnr.at(-1);
    const newerOpposingMsnr = latestSupportingMsnr ? valid4hMsnr.some(row => directionLabel(row.direction) !== side && Number(row.first_knowable_ms) > Number(latestSupportingMsnr.first_knowable_ms)) : false;

    return {
        ANALYSIS_NEWER_OPPOSING_4H_CRT: newerOpposing ? 'YES' : 'NO',
        ANALYSIS_SUPPORTING_CRT_SUPERSEDED: newerOpposing ? 'YES' : 'NO',
        ANALYSIS_LATEST_4H_CRT_DIRECTION: latest ? directionLabel(latest.direction) : 'NONE',
        ANALYSIS_NEWER_OPPOSING_4H_MSNR: newerOpposingMsnr ? 'YES' : 'NO',
        ANALYSIS_SUPPORTING_MSNR_SUPERSEDED: newerOpposingMsnr ? 'YES' : 'NO'
    };
}

function analyzeCandidate(candidate, result) {
    const side = directionLabel(candidate.side);
    const entry = Number(candidate.entry);
    const tp1 = Number(candidate.tp1);
    const risk = Math.abs(entry - Number(candidate.stop_loss));
    const structures = structureRows(result, side);
    const msnr = opposingMsnrRows(result, side);
    const allBarriers = [...structures, ...msnr];
    const entryInside4h = structures.filter(row => String(row.timeframe).toUpperCase() === '4H').some(row => {
        const zone = numericZone(row); return zone && entry >= zone.low && entry <= zone.high;
    });
    const entryInside1h = structures.filter(row => String(row.timeframe).toUpperCase() === '1H').some(row => {
        const zone = numericZone(row); return zone && entry >= zone.low && entry <= zone.high;
    });
    const barrier4h = nearestBarrier([
        ...structures.filter(row => String(row.timeframe).toUpperCase() === '4H'),
        ...msnr.filter(row => String(row.timeframe).toUpperCase() === '4H')
    ], entry, tp1);
    const barrier1h = nearestBarrier([
        ...structures.filter(row => String(row.timeframe).toUpperCase() === '1H'),
        ...msnr.filter(row => String(row.timeframe).toUpperCase() === '1H')
    ], entry, tp1);
    const barrier = nearestBarrier(allBarriers, entry, tp1);
    const barrierDistanceR = barrier && risk > 0 ? barrier.distance / risk : null;
    return {
        ANALYSIS_ENTRY_IN_OPPOSING_4H: entryInside4h ? 'YES' : 'NO',
        ANALYSIS_ENTRY_IN_OPPOSING_1H: entryInside1h ? 'YES' : 'NO',
        ANALYSIS_4H_BARRIER_BEFORE_TP1: barrier4h ? 'YES' : 'NO',
        ANALYSIS_1H_BARRIER_BEFORE_TP1: barrier1h ? 'YES' : 'NO',
        ANALYSIS_NEAREST_BARRIER_REF: barrier?.record?.ref || null,
        ANALYSIS_BARRIER_DISTANCE_R: Number.isFinite(barrierDistanceR) ? Number(barrierDistanceR.toFixed(4)) : null,
        ANALYSIS_BARRIER_DISTANCE_BIN: distanceBin(barrierDistanceR, barrier?.entry_inside === true),
        ...chronology(result, candidate)
    };
}

function simulationGroup(row) {
    const simulation = row.simulation || row;
    if (!simulation || simulation.fill_time_ms == null || simulation.final_outcome === 'AMBIGUOUS') return 'EXCLUDED';
    if (simulation.final_outcome === 'SL' && simulation.tp1_before_sl !== true) return 'SL_BEFORE_TP1';
    if (simulation.targets_reached?.[0] === true || ['TP1', 'TP2', 'TP3'].includes(simulation.final_outcome)) return 'TP1_PLUS';
    return simulation.final_outcome || 'OTHER';
}

function stats(rows) {
    const considered = rows.filter(row => simulationGroup(row) !== 'EXCLUDED');
    const r = considered.map(row => Number(row.simulation?.r_result ?? row.r_result)).filter(Number.isFinite);
    const slFirst = considered.filter(row => simulationGroup(row) === 'SL_BEFORE_TP1').length;
    const tp1Plus = considered.filter(row => simulationGroup(row) === 'TP1_PLUS').length;
    return {
        sample_size: considered.length,
        sl_before_tp1: slFirst,
        sl_before_tp1_rate: considered.length ? Number((slFirst / considered.length).toFixed(4)) : null,
        tp1_plus: tp1Plus,
        total_r: r.reduce((sum, value) => sum + value, 0),
        average_r: average(r),
        median_r: median(r)
    };
}

function groupStats(rows, field) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[field] ?? 'UNKNOWN';
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(row);
    }
    return Object.fromEntries([...groups.entries()].map(([key, items]) => [key, stats(items)]));
}

function makeResearchHypotheses(rows) {
    const opposingHtf = row => row.ANALYSIS_ENTRY_IN_OPPOSING_4H === 'YES' || row.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES';
    const superseded = row => row.ANALYSIS_SUPPORTING_CRT_SUPERSEDED === 'YES';
    const cases = {
        H1_LOW_vs_NON_LOW: { LOW: rows.filter(row => row.quality === 'LOW'), NON_LOW: rows.filter(row => row.quality !== 'LOW') },
        H2_ENTRY_INSIDE_OPPOSING_4H: { YES: rows.filter(row => row.ANALYSIS_ENTRY_IN_OPPOSING_4H === 'YES'), NO: rows.filter(row => row.ANALYSIS_ENTRY_IN_OPPOSING_4H !== 'YES') },
        H3_4H_BARRIER_BEFORE_TP1: { YES: rows.filter(row => row.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES'), NO: rows.filter(row => row.ANALYSIS_4H_BARRIER_BEFORE_TP1 !== 'YES') },
        H4_SUPPORTING_CRT_SUPERSEDED: { YES: rows.filter(superseded), NO: rows.filter(row => !superseded(row)) },
        H5_WEAK_DISPLACEMENT: { WEAK: rows.filter(row => row.displacement === 'WEAK'), NON_WEAK: rows.filter(row => row.displacement !== 'WEAK') },
        H6_OPPOSING_1H_STRUCTURE: { YES: rows.filter(row => row.ANALYSIS_ENTRY_IN_OPPOSING_1H === 'YES' || row.ANALYSIS_1H_BARRIER_BEFORE_TP1 === 'YES'), NO: rows.filter(row => row.ANALYSIS_ENTRY_IN_OPPOSING_1H !== 'YES' && row.ANALYSIS_1H_BARRIER_BEFORE_TP1 !== 'YES') },
        H7_LOW_PLUS_OPPOSING_HTF: { YES: rows.filter(row => row.quality === 'LOW' && opposingHtf(row)), NO: rows.filter(row => !(row.quality === 'LOW' && opposingHtf(row))) },
        H8_SUPERSEDED_PLUS_4H_BARRIER: { YES: rows.filter(row => superseded(row) && row.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES'), NO: rows.filter(row => !(superseded(row) && row.ANALYSIS_4H_BARRIER_BEFORE_TP1 === 'YES')) }
    };
    return Object.fromEntries(Object.entries(cases).map(([name, groups]) => [name, Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, stats(group)]))]));
}

function caseStudies(rows) {
    const bySymbol = new Map();
    for (const row of rows) {
        if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
        bySymbol.get(row.symbol).push(row);
    }
    const result = [];
    for (const [symbol, items] of bySymbol) {
        const ordered = [...items].sort((a, b) => Number(a.first_selected_at_ms) - Number(b.first_selected_at_ms));
        const losers = ordered.filter(row => simulationGroup(row) === 'SL_BEFORE_TP1').slice(0, 2);
        const winners = ordered.filter(row => simulationGroup(row) === 'TP1_PLUS').slice(0, 2);
        for (const row of [...losers, ...winners]) result.push({
            symbol,
            candidate_timestamp: row.first_selected_at,
            outcome_group: simulationGroup(row),
            timeframe: row.timeframe,
            side: row.side,
            setup: row.setup,
            score: row.score,
            quality: row.quality,
            entry: row.entry,
            stop_loss: row.stop_loss,
            tp1: row.tp1,
            outcome: row.simulation?.final_outcome,
            daily_bias: row.daily_bias,
            displacement: row.displacement,
            crt_refs: row.crt_refs,
            msnr_refs: row.msnr_refs,
            supply_demand: row.supply_demand,
            ...Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith('ANALYSIS_')))
        });
    }
    return result;
}

function setupLabel(candidate) {
    const components = ['FVG'];
    if ((candidate.crt_refs || []).length) components.unshift('CRT');
    if ((candidate.msnr_refs || []).length) components.splice(components.length - 1, 0, 'MSNR');
    return components.join('+');
}

function analyzeRun(runDir, context) {
    const config = readJson(path.join(runDir, 'config.json'));
    const candidates = readJson(path.join(runDir, 'candidates.json')).filter(row => row.first_selected_at_ms != null);
    const trades = readJson(path.join(runDir, 'trades.json'));
    const tradesById = new Map(trades.map(row => [row.candidate_id, row]));
    const series = canonicalSeries(config);
    const precision = symbolPrecision(config.symbol, series['5m']?.[0]?.c || series['1h']?.[0]?.c || 1);
    const enriched = [];
    for (const candidate of candidates) {
        const asOfMs = Number(candidate.first_selected_at_ms);
        const blocks = makeBlocks(series, asOfMs);
        const execution = blocks.find(block => block.timeframe === '5M')?.candles || [];
        const currentPrice = Number(execution.at(-1)?.c || candidate.entry);
        const result = analyzeVisibleHistory(context, { blocks, symbol: config.symbol, currentPrice, asOfMs, precision });
        const trade = tradesById.get(candidate.candidate_id) || {};
        enriched.push({
            symbol: config.symbol,
            setup: setupLabel(candidate),
            ...candidate,
            simulation: trade.simulation || trade,
            ...analyzeCandidate(candidate, result)
        });
    }
    const filled = enriched.filter(row => row.simulation?.fill_time_ms != null);
    const result = {
        symbol: config.symbol,
        run_directory: runDir,
        strategy_git_commit: config.strategy_git_commit,
        range: { from: config.from, to: config.to },
        selected_candidates: enriched.length,
        filled_candidates: filled.length,
        outcomes: stats(enriched),
        by_quality: groupStats(enriched, 'quality'),
        by_timeframe: groupStats(enriched, 'timeframe'),
        by_side: groupStats(enriched, 'side'),
        by_daily_bias: groupStats(enriched, 'daily_bias'),
        by_crt: groupStats(enriched.map(row => ({ ...row, crt_present: row.crt_refs?.length ? 'YES' : 'NO' })), 'crt_present'),
        by_msnr: groupStats(enriched.map(row => ({ ...row, msnr_present: row.msnr_refs?.length ? 'YES' : 'NO' })), 'msnr_present'),
        by_displacement: groupStats(enriched, 'displacement'),
        by_barrier_distance: groupStats(enriched, 'ANALYSIS_BARRIER_DISTANCE_BIN'),
        hypotheses: makeResearchHypotheses(enriched),
        case_studies: caseStudies(enriched),
        notes: [
            'All analysis fields are offline descriptive fields; they do not affect live selection or replay qualification.',
            'A final SL after TP1/TP2 is retained as TP1+/TP2+ in the research grouping and is not counted as SL-before-TP1.',
            'The current deterministic output exposes stable refs for CRT, MSNR and supply/demand. No new OB/BREAKER/FLIP detector or reference is created here.'
        ]
    };
    fs.writeFileSync(path.join(runDir, 'analysis.json'), JSON.stringify({ ...result, records: enriched }, null, 2));
    fs.writeFileSync(path.join(runDir, 'case-studies.json'), JSON.stringify(result.case_studies, null, 2));
    fs.writeFileSync(path.join(runDir, 'analysis-report.txt'), renderAnalysisReport(result));
    return { ...result, records: enriched };
}

function renderStats(groups) {
    return Object.entries(groups || {}).map(([key, value]) => `${key}: n=${value.sample_size}, SL-before-TP1=${value.sl_before_tp1_rate ?? 'NA'}, TP1+=${value.tp1_plus}, totalR=${value.total_r}, avgR=${value.average_r ?? 'NA'}, medianR=${value.median_r ?? 'NA'}`).join('\n');
}

function renderAnalysisReport(result) {
    return [
        `Offline research analysis: ${result.symbol}`,
        `Range: ${result.range.from} to ${result.range.to}`,
        `Selected=${result.selected_candidates}; filled=${result.filled_candidates}`,
        `Outcomes: ${JSON.stringify(result.outcomes)}`,
        '',
        'QUALITY', renderStats(result.by_quality),
        '', 'TIMEFRAME', renderStats(result.by_timeframe),
        '', 'SIDE', renderStats(result.by_side),
        '', 'DAILY BIAS', renderStats(result.by_daily_bias),
        '', 'CRT', renderStats(result.by_crt),
        '', 'MSNR', renderStats(result.by_msnr),
        '', 'DISPLACEMENT', renderStats(result.by_displacement),
        '', 'BARRIER DISTANCE', renderStats(result.by_barrier_distance),
        '', 'HYPOTHESES H1-H8', JSON.stringify(result.hypotheses, null, 2),
        '', 'CASE STUDIES', JSON.stringify(result.case_studies, null, 2),
        '', ...result.notes
    ].join('\n');
}

function parseArgs(argv) {
    const runs = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--run' || argv[index] === '--runs') runs.push(...String(argv[++index] || '').split(',').filter(Boolean));
    }
    if (!runs.length) throw new Error('Usage: node backtest/analyze.js --run backtest-results/<run> [--run ...]');
    return runs;
}

if (require.main === module) {
    try {
        const context = loadStrategyContext();
        const results = parseArgs(process.argv.slice(2)).map(run => analyzeRun(path.resolve(run), context));
        console.log(results.map(result => renderAnalysisReport(result)).join('\n\n' + '='.repeat(100) + '\n\n'));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = { analyzeRun, analyzeCandidate, stats, makeResearchHypotheses, renderAnalysisReport };
