'use strict';

const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { createAuditStore } = require('./audit-store');

const TIMEFRAME_INTERVALS = new Set(['1min', '5min', '15min', '1h', '4h', '1day', '1week']);
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_TWELVE_MAX_REQUESTS = 50;

function normalizeSymbol(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function configuredOrigin(env = process.env) {
    return String(env.PROXY_CORS_ORIGIN || '').trim();
}

function jsonResponse(res, status, payload, origin = '') {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    };
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    res.writeHead(status, headers);
    res.end(JSON.stringify(payload));
}

function validateMarketRequest(pathname, query) {
    const symbol = normalizeSymbol(query.get('symbol'));
    if (!symbol || !/^[A-Z0-9._:/-]{1,32}$/.test(symbol)) return { valid: false, reason: 'symbol is invalid' };
    if (pathname.endsWith('/time_series')) {
        const interval = String(query.get('interval') || '').toLowerCase();
        if (!TIMEFRAME_INTERVALS.has(interval)) return { valid: false, reason: 'interval is unsupported' };
        const outputsize = Number(query.get('outputsize') || 200);
        if (!Number.isInteger(outputsize) || outputsize < 20 || outputsize > 5000) return { valid: false, reason: 'outputsize is invalid' };
        return { valid: true, symbol, interval, outputsize };
    }
    return { valid: true, symbol };
}

function createRateLimiter({ now = () => Date.now(), windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS } = {}) {
    const buckets = new Map();
    return function allow(key = 'unknown') {
        const current = now();
        const prior = buckets.get(key) || { started: current, count: 0 };
        if (current - prior.started >= windowMs) {
            prior.started = current;
            prior.count = 0;
        }
        prior.count += 1;
        buckets.set(key, prior);
        return { allowed: prior.count <= maxRequests, remaining: Math.max(0, maxRequests - prior.count) };
    };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('request body is too large'), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function upstreamHeaders(apiKey) {
    return { 'Accept': 'application/json', 'User-Agent': 'ict-telegram-bot-proxy/1.0', 'X-Proxy-Request': 'server' };
}

async function proxyJson(fetchImpl, url, options = {}, timeoutMs = 10_000) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), Math.max(1, Number(timeoutMs) || 10_000));
    try {
        const response = await fetchImpl(url, controller ? { ...options, signal: options.signal || controller.signal } : options);
        const text = await response.text();
        let payload;
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: 'upstream returned invalid JSON' }; }
        return { status: response.status, payload };
    } finally {
        clearTimeout(timer);
    }
}

function createProxyServer({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), auditStore = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('a fetch implementation is required');
    const allow = createRateLimiter({ now, maxRequests: Number(env.PROXY_MAX_REQUESTS || DEFAULT_MAX_REQUESTS) });
    const allowTwelveData = createRateLimiter({ now, maxRequests: Number(env.PROXY_TWELVE_MAX_REQUESTS || DEFAULT_TWELVE_MAX_REQUESTS) });
    const twelveKey = String(env.TWELVE_DATA_API_KEY || '').trim();
    const deepSeekKey = String(env.DEEPSEEK_API_KEY || '').trim();
    const twelveBase = String(env.TWELVE_DATA_BASE_URL || 'https://api.twelvedata.com').replace(/\/$/, '');
    const deepSeekUrl = String(env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions');
    const upstreamTimeoutMs = Math.max(1, Number(env.PROXY_UPSTREAM_TIMEOUT_MS) || 10_000);
    const origin = configuredOrigin(env);
    const configuredAuditToken = String(env.AUDIT_WRITE_TOKEN || '').trim();
    const configuredAuditReadToken = String(env.AUDIT_READ_TOKEN || '').trim();
    const store = auditStore || (configuredAuditToken ? createAuditStore({ filePath: env.AUDIT_FILE_PATH || path.join(__dirname, 'data', 'audit.jsonl') }) : null);

    return http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://proxy.local');
        const clientKey = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rate = allow(String(clientKey));
        res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        if (!rate.allowed) return jsonResponse(res, 429, { error: 'rate limit exceeded' }, origin);
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Client', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
            return res.end();
        }
        if (req.method === 'GET' && requestUrl.pathname === '/health') {
            return jsonResponse(res, 200, { ok: true, service: 'market-ai-proxy', time: new Date(now()).toISOString(), data_provider_configured: !!twelveKey, ai_provider_configured: !!deepSeekKey }, origin);
        }
        try {
            if (req.method === 'GET' && (requestUrl.pathname === '/api/twelve/quote' || requestUrl.pathname === '/api/twelve/time_series')) {
                if (!twelveKey) return jsonResponse(res, 503, { error: 'market data provider is not configured' }, origin);
                const twelveRate = allowTwelveData(String(clientKey));
                res.setHeader('X-Twelve-RateLimit-Remaining', String(twelveRate.remaining));
                if (!twelveRate.allowed) return jsonResponse(res, 429, { error: 'Twelve Data request budget exceeded' }, origin);
                const validation = validateMarketRequest(requestUrl.pathname, requestUrl.searchParams);
                if (!validation.valid) return jsonResponse(res, 400, { error: validation.reason }, origin);
                const upstream = new URL(`${twelveBase}/${requestUrl.pathname.endsWith('/quote') ? 'quote' : 'time_series'}`);
                upstream.searchParams.set('symbol', validation.symbol);
                if (validation.interval) upstream.searchParams.set('interval', validation.interval);
                if (validation.outputsize) upstream.searchParams.set('outputsize', String(validation.outputsize));
                upstream.searchParams.set('timezone', 'UTC');
                upstream.searchParams.set('apikey', twelveKey);
                const result = await proxyJson(fetchImpl, upstream, { headers: upstreamHeaders(twelveKey) }, upstreamTimeoutMs);
                return jsonResponse(res, result.status, result.payload, origin);
            }
            if (req.method === 'POST' && requestUrl.pathname === '/api/deepseek/chat') {
                if (!deepSeekKey) return jsonResponse(res, 503, { error: 'AI provider is not configured' }, origin);
                const raw = await readBody(req);
                let body;
                try { body = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { error: 'request body must be valid JSON' }, origin); }
                if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages)) return jsonResponse(res, 400, { error: 'messages array is required' }, origin);
                const result = await proxyJson(fetchImpl, deepSeekUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepSeekKey}`, 'User-Agent': 'ict-telegram-bot-proxy/1.0' },
                    body: JSON.stringify({ ...body, stream: false })
                }, upstreamTimeoutMs);
                return jsonResponse(res, result.status, result.payload, origin);
            }
            if ((req.method === 'POST' || req.method === 'GET') && requestUrl.pathname === '/api/audit') {
                const expectedToken = req.method === 'GET' ? configuredAuditReadToken : configuredAuditToken;
                if (!store || !expectedToken || req.headers['x-audit-token'] !== expectedToken) return jsonResponse(res, 401, { error: 'audit authentication required' }, origin);
                if (req.method === 'GET') return jsonResponse(res, 200, { records: store.recent(requestUrl.searchParams.get('limit') || 100) }, origin);
                const raw = await readBody(req);
                let record;
                try { record = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { error: 'audit body must be valid JSON' }, origin); }
                const saved = store.append(record);
                return jsonResponse(res, 201, { saved: true, request_id: saved.request_id }, origin);
            }
            return jsonResponse(res, 404, { error: 'route not found' }, origin);
        } catch (error) {
            const status = Number(error?.statusCode) || 502;
            return jsonResponse(res, status, { error: status === 400 || status === 413 ? error.message : 'upstream request failed' }, origin);
        }
    });
}

if (require.main === module) {
    const port = Number(process.env.PORT || 8787);
    createProxyServer().listen(port, process.env.HOST || '127.0.0.1', () => {
        console.log(`market-ai-proxy listening on ${process.env.HOST || '127.0.0.1'}:${port}`);
    });
}

module.exports = { MAX_BODY_BYTES, TIMEFRAME_INTERVALS, normalizeSymbol, validateMarketRequest, createRateLimiter, createProxyServer };
