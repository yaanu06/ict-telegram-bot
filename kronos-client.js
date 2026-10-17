'use strict';

// Small, dependency-free client-side part of the Kronos adapter.  The model
// itself remains in the official Python implementation; this file only
// normalizes its response, evaluates pending-limit path outcomes, and keeps
// the live packet independent from the model process.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ICTKronos = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULTS = Object.freeze({
        model: 'NeoQuasar/Kronos-small',
        lookback: 400,
        horizon_1h: 12,
        horizon_4h: 6,
        paths: 1,
        seed: 42,
        neutral_r_fraction: 0.10,
        max_context: 512
    });
    const INTERVAL_MS = Object.freeze({ '1h': 3600000, '4h': 14400000 });

    function finite(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function canonicalTimeframe(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === '60' ? '1h' : text === '240' ? '4h' : text;
    }

    function candleTime(candle) {
        const raw = candle?.timestamp ?? candle?.t ?? candle?.time;
        if (raw instanceof Date) return raw.getTime();
        const number = Number(raw);
        if (Number.isFinite(number)) return Math.abs(number) < 1e11 ? number * 1000 : number;
        const parsed = Date.parse(String(raw || ''));
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function candleCloseTime(candle, timeframe) {
        const explicit = finite(candle?.close_time_ms ?? candle?.closeTimeMs);
        return explicit ?? candleTime(candle) + (INTERVAL_MS[canonicalTimeframe(timeframe)] || 0);
    }

    function closedCandleWindow(candles, timeframe, asOfMs, lookback = DEFAULTS.lookback) {
        const asOf = finite(asOfMs) ?? Date.now();
        const limit = Math.min(DEFAULTS.max_context, Math.max(1, Number(lookback) || DEFAULTS.lookback));
        return (Array.isArray(candles) ? candles : [])
            .map(candle => ({ candle, timestamp: candleTime(candle) }))
            .filter(item => Number.isFinite(item.timestamp)
                && item.candle?.is_closed !== false
                && candleCloseTime(item.candle, timeframe) <= asOf)
            .sort((left, right) => left.timestamp - right.timestamp)
            .slice(-limit)
            .map(item => item.candle);
    }

    function cacheKey({ symbol, timeframe, lastClosedTimestamp, model = DEFAULTS.model, lookback = DEFAULTS.lookback, horizon, paths = DEFAULTS.paths, seed = DEFAULTS.seed } = {}) {
        return [symbol, canonicalTimeframe(timeframe), lastClosedTimestamp, model, lookback, horizon, paths, seed].map(value => String(value ?? '')).join('|');
    }

    function sideOf(candidate) {
        const action = String(candidate?.action || candidate?.side || '').toUpperCase();
        if (action === 'BUY' || action === 'BUY_LIMIT') return 'BUY';
        if (action === 'SELL' || action === 'SELL_LIMIT') return 'SELL';
        return null;
    }

    function evaluatePath(path, candidate) {
        const side = sideOf(candidate);
        const entry = finite(candidate?.entry);
        const stop = finite(candidate?.stop_loss ?? candidate?.stopLoss);
        const tp1 = finite(candidate?.tp1 ?? candidate?.take_profit_1);
        if (!side || ![entry, stop, tp1].every(value => value != null)) return 'INVALID';
        let filled = false;
        for (const bar of Array.isArray(path) ? path : []) {
            const high = finite(bar?.high ?? bar?.h);
            const low = finite(bar?.low ?? bar?.l);
            if (high == null || low == null) continue;
            const entryHit = side === 'BUY' ? low <= entry : high >= entry;
            if (!filled) {
                if (!entryHit) continue;
                filled = true;
            }
            const stopHit = side === 'BUY' ? low <= stop : high >= stop;
            const targetHit = side === 'BUY' ? high >= tp1 : low <= tp1;
            if (stopHit && targetHit) return 'AMBIGUOUS';
            if (stopHit) return 'SL_FIRST';
            if (targetHit) return 'TP1_FIRST';
        }
        return filled ? 'NEITHER' : 'NOT_FILLED';
    }

    function classifyDirection(startPrice, endPrice, risk, neutralRFraction = DEFAULTS.neutral_r_fraction) {
        const start = finite(startPrice), end = finite(endPrice), r = finite(risk);
        if (start == null || end == null || r == null || r <= 0) return 'NEUTRAL';
        const moveR = (end - start) / r;
        if (Math.abs(moveR) <= Number(neutralRFraction)) return 'NEUTRAL';
        return moveR > 0 ? 'BULLISH' : 'BEARISH';
    }

    function summarizeForecast(raw = {}, candidate = {}, options = {}) {
        const status = String(raw.status || raw.KRONOS_STATUS || '').toUpperCase();
        const timeframe = canonicalTimeframe(raw.timeframe || raw.KRONOS_TIMEFRAME || options.timeframe);
        const base = {
            kronos_status: status === 'OK' ? 'OK' : (status === 'ERROR' ? 'ERROR' : 'UNAVAILABLE'),
            kronos_model: raw.model || raw.KRONOS_MODEL || options.model || DEFAULTS.model,
            kronos_device: raw.device || raw.KRONOS_DEVICE || null,
            kronos_timeframe: timeframe,
            kronos_lookback: Number(raw.lookback ?? options.lookback ?? DEFAULTS.lookback),
            kronos_horizon: Number(raw.horizon ?? options.horizon ?? 0),
            kronos_paths: Number(raw.paths ?? options.paths ?? DEFAULTS.paths),
            kronos_seed: Number(raw.seed ?? options.seed ?? DEFAULTS.seed),
            kronos_error: raw.error || raw.reason || null
        };
        if (base.kronos_status !== 'OK') return base;
        const paths = Array.isArray(raw.paths_data) ? raw.paths_data : Array.isArray(raw.paths) ? raw.paths : [];
        const lastClose = finite(raw.start_price ?? raw.forecast_start_price ?? options.startPrice);
        const endValues = paths.map(path => finite(path?.at?.(-1)?.close ?? path?.at?.(-1)?.c)).filter(value => value != null);
        const endPrice = finite(raw.end_price ?? raw.forecast_end_price) ?? (endValues.length ? endValues.reduce((sum, value) => sum + value, 0) / endValues.length : null);
        const allBars = paths.flatMap(path => Array.isArray(path) ? path : []);
        const highs = allBars.map(bar => finite(bar?.high ?? bar?.h)).filter(value => value != null);
        const lows = allBars.map(bar => finite(bar?.low ?? bar?.l)).filter(value => value != null);
        const start = lastClose;
        const risk = Math.abs(Number(candidate?.entry) - Number(candidate?.stop_loss ?? candidate?.stopLoss));
        const direction = classifyDirection(start, endPrice, risk, options.neutralRFraction ?? DEFAULTS.neutral_r_fraction);
        const side = sideOf(candidate);
        const alignment = direction === 'NEUTRAL' ? 'NEUTRAL'
            : side === 'BUY' && direction === 'BULLISH' ? 'ALIGNED'
                : side === 'SELL' && direction === 'BEARISH' ? 'ALIGNED' : 'CONFLICT';
        const outcomes = paths.map(path => evaluatePath(path, candidate));
        const count = name => outcomes.filter(value => value === name).length;
        const total = Math.max(1, outcomes.length || Number(base.kronos_paths) || DEFAULTS.paths);
        const returnPct = start && endPrice != null ? ((endPrice / start) - 1) * 100 : null;
        const directionalUp = side === 'BUY' ? endPrice - Number(candidate?.entry) : Number(candidate?.entry) - endPrice;
        const directionalDown = side === 'BUY' ? Number(candidate?.entry) - endPrice : endPrice - Number(candidate?.entry);
        return {
            ...base,
            kronos_forecast_start_price: start,
            kronos_forecast_end_price: endPrice,
            kronos_forecast_return_pct: returnPct,
            kronos_forecast_high: highs.length ? Math.max(...highs) : null,
            kronos_forecast_low: lows.length ? Math.min(...lows) : null,
            kronos_upside_r: risk > 0 ? directionalUp / risk : null,
            kronos_downside_r: risk > 0 ? directionalDown / risk : null,
            kronos_direction: direction,
            kronos_alignment: alignment,
            kronos_conflict: alignment === 'CONFLICT' ? 'YES' : 'NO',
            kronos_tp1_first: count('TP1_FIRST'),
            kronos_sl_first: count('SL_FIRST'),
            kronos_neither: count('NEITHER'),
            kronos_ambiguous: count('AMBIGUOUS'),
            kronos_not_filled: count('NOT_FILLED'),
            kronos_tp1_path_support: count('TP1_FIRST') / total,
            kronos_sl_path_support: count('SL_FIRST') / total,
            kronos_fill_path_support: outcomes.filter(value => value !== 'NOT_FILLED' && value !== 'INVALID').length / total,
            kronos_path_outcomes: outcomes
        };
    }

    function compactForPacket(result = {}) {
        const compact = { ...result };
        delete compact.kronos_path_outcomes;
        delete compact.paths_data;
        return compact;
    }

    return { DEFAULTS, INTERVAL_MS, canonicalTimeframe, closedCandleWindow, cacheKey, sideOf, evaluatePath, classifyDirection, summarizeForecast, compactForPacket };
}));
