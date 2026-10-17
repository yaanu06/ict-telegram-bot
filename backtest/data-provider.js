'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const TIMEFRAME_MS = Object.freeze({ '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 });

function canonicalTimeframe(timeframe) {
    const value = String(timeframe || '').toLowerCase();
    const aliases = { '1min': '1m', '5min': '5m', '15min': '15m', '60': '1h', '240': '4h', '1day': '1d', '1d': '1d' };
    return aliases[value] || value;
}

function safeName(value) {
    return String(value).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

function normalizeBars(rows, timeframe) {
    const interval = TIMEFRAME_MS[timeframe];
    const bars = (Array.isArray(rows) ? rows : []).map(row => {
        const timestamp = Number(row.timestamp ?? Date.parse(row.datetime ?? row.t ?? row.time));
        return {
            t: Number.isFinite(timestamp) ? timestamp : NaN,
            o: Number(row.open ?? row.o),
            h: Number(row.high ?? row.h),
            l: Number(row.low ?? row.l),
            c: Number(row.close ?? row.c),
            v: Number(row.volume ?? row.v ?? 0),
            is_closed: row.is_closed !== false,
            close_time: Number.isFinite(timestamp) && interval ? timestamp + interval : NaN
        };
    }).filter(bar => Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) && bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0 && bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c));
    const unique = new Map();
    for (const bar of bars) unique.set(bar.t, bar);
    return [...unique.values()].sort((a, b) => a.t - b.t);
}

function validateRawRows(rows, timeframe) {
    const interval = TIMEFRAME_MS[timeframe];
    const timestamps = (Array.isArray(rows) ? rows : []).map(row => Number(row.timestamp ?? Date.parse(row.datetime ?? row.t ?? row.time))).filter(Number.isFinite);
    const duplicateTimestamps = timestamps.filter((value, index) => timestamps.indexOf(value) !== index);
    const unsorted = timestamps.some((value, index) => index > 0 && value < timestamps[index - 1]);
    const invalidOhlc = (Array.isArray(rows) ? rows : []).filter(row => {
        const o = Number(row.open ?? row.o); const h = Number(row.high ?? row.h);
        const l = Number(row.low ?? row.l); const c = Number(row.close ?? row.c);
        return ![o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < Math.max(o, c) || l > Math.min(o, c);
    }).length;
    const gaps = [];
    const ordered = [...new Set(timestamps)].sort((a, b) => a - b);
    for (let index = 1; index < ordered.length; index += 1) {
        const delta = ordered[index] - ordered[index - 1];
        if (interval && delta > interval) gaps.push({ from: ordered[index - 1], to: ordered[index], missing_intervals: Math.round(delta / interval) - 1 });
    }
    return { duplicate_timestamps: [...new Set(duplicateTimestamps)], unsorted, invalid_ohlc: invalidOhlc, gaps };
}

function validateSeries(bars, timeframe) {
    const interval = TIMEFRAME_MS[timeframe];
    const gaps = [];
    for (let index = 1; index < bars.length; index += 1) {
        const delta = bars[index].t - bars[index - 1].t;
        if (interval && delta > interval) gaps.push({ from: bars[index - 1].t, to: bars[index].t, missing_intervals: Math.round(delta / interval) - 1 });
    }
    return { count: bars.length, first: bars[0]?.t ?? null, last: bars.at(-1)?.t ?? null, gaps };
}

async function fetchHistoricalBars({ symbol, timeframe, from, to, refresh = false, cacheDir = path.join(process.cwd(), 'data', 'historical'), bars = 5000, python = process.env.PYTHON || 'python' }) {
    const tf = canonicalTimeframe(timeframe);
    if (!TIMEFRAME_MS[tf]) throw new Error(`Unsupported timeframe: ${timeframe}`);
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new Error('Invalid historical date range');
    fs.mkdirSync(cacheDir, { recursive: true });
    const key = `${safeName(symbol)}_${tf}_${fromMs}_${toMs}.json`;
    const cachePath = path.join(cacheDir, key);
    let payload;
    let cacheHit = false;
    if (!refresh && fs.existsSync(cachePath)) {
        payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        cacheHit = true;
    } else {
        const providerScript = path.join(process.cwd(), 'tools', 'historical_data.py');
        const result = await execFileAsync(python, [providerScript, '--symbol', symbol, '--timeframe', tf, '--from', from, '--to', to, '--bars', String(Math.max(100, Math.min(10000, bars)))], { maxBuffer: 20 * 1024 * 1024 });
        payload = JSON.parse(result.stdout);
        fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
    }
    const normalized = normalizeBars(payload.bars, tf).filter(bar => bar.t >= fromMs && bar.t <= toMs);
    return { ...payload, bars: normalized, cache_hit: cacheHit, cache_path: cachePath, diagnostics: { ...(payload.diagnostics || {}), ...validateRawRows(payload.bars, tf), ...validateSeries(normalized, tf) } };
}

module.exports = { TIMEFRAME_MS, canonicalTimeframe, normalizeBars, validateRawRows, validateSeries, fetchHistoricalBars };
