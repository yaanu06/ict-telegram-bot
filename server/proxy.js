'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createAuditStore } = require('./audit-store');
const { createGhostMcpNodeHandler } = require('./ghost-mcp');

const TIMEFRAME_INTERVALS = new Set(['1min', '5min', '15min', '1h', '4h', '1day', '1week']);
// The market analyst sends a bounded, machine-readable evidence package. Its
// JSON encoding can be slightly larger than the one-megabyte prompt text, so
// keep a finite proxy limit without truncating otherwise valid requests.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 40_000;
const MAX_UPSTREAM_TIMEOUT_MS = 44_000;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_TWELVE_MAX_REQUESTS = 50;
const DEFAULT_TVKIT_MAX_REQUESTS = 120;
const DEFAULT_AI_PROVIDER = 'GEMINI';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const PUBLIC_ROOT = path.resolve(__dirname, '..');
const PUBLIC_ASSETS = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/script.js': { file: 'script.js', type: 'application/javascript; charset=utf-8' },
    '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' }
};

function normalizeSymbol(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeAIProvider(value) {
    return String(value || '').trim().toUpperCase() === 'DEEPSEEK' ? 'DEEPSEEK' : DEFAULT_AI_PROVIDER;
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

function publicAssetResponse(res, pathname, env = process.env) {
    const asset = PUBLIC_ASSETS[pathname];
    if (!asset) return false;
    const filePath = path.join(PUBLIC_ROOT, asset.file);
    let body = fs.readFileSync(filePath, 'utf8');
    // When the Mini App is served by this same process, API calls must stay on
    // the same origin. GitHub Pages deployments can still inject an explicit
    // __ICT_PROXY_BASE_URL__ before script.js loads.
    if (asset.file === 'index.html') {
        const provider = normalizeAIProvider(env.AI_PROVIDER);
        const model = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
        body = body.replace('</head>', `<script>window.__ICT_PROXY_BASE_URL__ = window.location.origin; window.__ICT_AI_PROVIDER__ = ${JSON.stringify(provider)}; window.__ICT_AI_MODEL__ = ${JSON.stringify(provider === 'GEMINI' ? model : 'deepseek-chat')};</script></head>`);
    }
    const cacheControl = asset.file === 'index.html'
        ? 'no-store'
        : asset.file === 'script.js'
            ? 'no-cache, must-revalidate'
            : 'public, max-age=300';
    res.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
    return true;
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

function createSerialQueue() {
    let tail = Promise.resolve();
    return function enqueue(task) {
        const current = tail.then(task, task);
        tail = current.catch(() => {});
        return current;
    };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        let rejected = false;
        const chunks = [];
        req.on('data', chunk => {
            if (rejected) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                rejected = true;
                reject(Object.assign(new Error('request body is too large'), { statusCode: 413, code: 'REQUEST_BODY_TOO_LARGE' }));
                req.resume();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', reject);
    });
}

function upstreamHeaders(apiKey) {
    return { 'Accept': 'application/json', 'User-Agent': 'ict-telegram-bot-proxy/1.0', 'X-Proxy-Request': 'server' };
}

function geminiContents(messages = []) {
    return messages
        .filter(message => message && message.role !== 'system')
        .map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(message.content ?? '') }]
        }));
}

function geminiRequestBody(body = {}) {
    const systemMessages = (body.messages || [])
        .filter(message => message?.role === 'system')
        .map(message => String(message.content ?? ''))
        .filter(Boolean);
    const generationConfig = {
        ...(Number.isFinite(Number(body.temperature)) ? { temperature: Number(body.temperature) } : {}),
        ...(Number.isFinite(Number(body.max_tokens)) ? { maxOutputTokens: Number(body.max_tokens) } : {}),
        responseMimeType: 'application/json',
        ...(body.response_schema ? { responseSchema: body.response_schema } : {})
    };
    return {
        ...(systemMessages.length ? { systemInstruction: { parts: [{ text: systemMessages.join('\n\n') }] } } : {}),
        contents: geminiContents(body.messages),
        generationConfig
    };
}

function normalizeGeminiResponse(payload, model) {
    const candidate = payload?.candidates?.[0] || {};
    const content = (candidate.content?.parts || [])
        .map(part => part?.text)
        .filter(text => typeof text === 'string')
        .join('\n');
    const usageMetadata = payload?.usageMetadata || {};
    const usage = {
        prompt_tokens: usageMetadata.promptTokenCount ?? null,
        output_tokens: usageMetadata.candidatesTokenCount ?? null,
        total_tokens: usageMetadata.totalTokenCount ?? null,
        cached_tokens: usageMetadata.cachedContentTokenCount ?? null,
        thinking_tokens: usageMetadata.thoughtsTokenCount ?? null
    };
    return {
        provider: 'GEMINI',
        model,
        choices: [{ message: { role: 'assistant', content } }],
        usage,
        usage_metadata: usageMetadata,
        finish_reason: candidate.finishReason || null
    };
}

const PROVIDER_MESSAGE_SECRET_PATTERN = /(?:(?:gemini[_-]?api[_-]?key|deepseek[_-]?api[_-]?key|x-goog-api-key|authorization)\s*[:=]?\s*(?:bearer\s+)?[^\s,;]+|bearer\s+[^\s,;]+)/ig;

function sanitizeProviderText(value, maxLength = 1000) {
    if (value == null) return null;
    return String(value).slice(0, maxLength).replace(PROVIDER_MESSAGE_SECRET_PATTERN, '[REDACTED]');
}

function safeProviderDimensions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const dimensions = {};
    for (const [key, item] of Object.entries(value).slice(0, 16)) {
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) continue;
        if (['string', 'number', 'boolean'].includes(typeof item)) dimensions[key] = sanitizeProviderText(item, 160);
    }
    return Object.keys(dimensions).length ? dimensions : null;
}

function normalizeRetryDelay(value) {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number') return sanitizeProviderText(value, 80);
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    const seconds = value.seconds ?? value.Seconds;
    const nanos = value.nanos ?? value.Nanos;
    if (seconds == null && nanos == null) return null;
    const secondsText = seconds == null ? '' : `${seconds}s`;
    const nanosText = nanos == null || Number(nanos) === 0 ? '' : ` ${nanos}ns`;
    return sanitizeProviderText(`${secondsText}${nanosText}`.trim(), 80);
}

function extractProviderQuota(details = []) {
    if (!Array.isArray(details)) return [];
    const quota = [];
    for (const detail of details.slice(0, 24)) {
        if (!detail || typeof detail !== 'object') continue;
        const violations = Array.isArray(detail.violations) ? detail.violations : [detail];
        for (const violation of violations.slice(0, 16)) {
            if (!violation || typeof violation !== 'object') continue;
            const metric = violation.quotaMetric ?? violation.quota_metric;
            const id = violation.quotaId ?? violation.quota_id;
            const value = violation.quotaValue ?? violation.quota_value;
            const dimensions = safeProviderDimensions(violation.quotaDimensions ?? violation.quota_dimensions);
            if (metric != null || id != null || value != null || dimensions) {
                quota.push({
                    ...(metric != null ? { quota_metric: sanitizeProviderText(metric, 200) } : {}),
                    ...(id != null ? { quota_id: sanitizeProviderText(id, 200) } : {}),
                    ...(value != null ? { quota_value: sanitizeProviderText(value, 120) } : {}),
                    ...(dimensions ? { quota_dimensions: dimensions } : {})
                });
            }
        }
    }
    return quota;
}

function sanitizeProviderError(payload = {}) {
    const source = payload?.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
        ? payload.error
        : {};
    const details = Array.isArray(source.details) ? source.details : [];
    const retryDetail = details.find(detail => detail && typeof detail === 'object' && (detail.retryDelay != null || detail.retry_delay != null));
    const quota = extractProviderQuota(details);
    const providerError = {
        ...(source.code != null ? { code: typeof source.code === 'number' ? source.code : sanitizeProviderText(source.code, 80) } : {}),
        ...(source.status != null ? { status: sanitizeProviderText(source.status, 120) } : {}),
        ...(source.message != null ? { message: sanitizeProviderText(source.message) } : {}),
        ...(quota.length ? { quota } : {}),
        ...((retryDetail?.retryDelay ?? retryDetail?.retry_delay) != null ? { retry_delay: normalizeRetryDelay(retryDetail.retryDelay ?? retryDetail.retry_delay) } : {})
    };
    return Object.keys(providerError).length ? providerError : null;
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
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw Object.assign(new Error('upstream request timed out'), {
                statusCode: 504,
                code: 'UPSTREAM_TIMEOUT'
            });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function createProxyServer({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), auditStore = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('a fetch implementation is required');
    const allow = createRateLimiter({ now, maxRequests: Number(env.PROXY_MAX_REQUESTS || DEFAULT_MAX_REQUESTS) });
    const allowTwelveData = createRateLimiter({ now, maxRequests: Number(env.PROXY_TWELVE_MAX_REQUESTS || DEFAULT_TWELVE_MAX_REQUESTS) });
    // Provider credits belong to the account, so enforce a global budget in
    // addition to the per-client abuse limit.
    const allowTwelveDataGlobal = createRateLimiter({ now, maxRequests: Number(env.PROXY_TWELVE_GLOBAL_MAX_REQUESTS || DEFAULT_TWELVE_MAX_REQUESTS) });
    const allowTvkit = createRateLimiter({ now, maxRequests: Number(env.PROXY_TVKIT_MAX_REQUESTS || DEFAULT_TVKIT_MAX_REQUESTS) });
    // The bundled TVKit adapter creates one TradingView WebSocket per request.
    // The browser requests the five scan timeframes together, so keep those
    // provider sessions serialized at the shared proxy boundary. This avoids
    // burst failures without changing symbols, intervals, candle counts, or
    // any downstream trading/evidence logic.
    const enqueueTvkitRequest = createSerialQueue();
    const twelveKey = String(env.TWELVE_DATA_API_KEY || '').trim();
    const deepSeekKey = String(env.DEEPSEEK_API_KEY || '').trim();
    const aiProvider = normalizeAIProvider(env.AI_PROVIDER);
    const geminiKey = String(env.GEMINI_API_KEY || '').trim();
    const geminiModel = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
    const twelveBase = String(env.TWELVE_DATA_BASE_URL || 'https://api.twelvedata.com').replace(/\/$/, '');
    const tvkitBase = String(env.TVKIT_BASE_URL || '').trim().replace(/\/$/, '');
    const deepSeekUrl = String(env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions');
    // Keep the server deadline below the browser's 45s AI deadline so an
    // upstream timeout is returned as a typed 504 instead of becoming a
    // client-side fetch failure. Provider responses still pass through with
    // their original status (for example, a real upstream 502).
    const upstreamTimeoutMs = Math.min(MAX_UPSTREAM_TIMEOUT_MS,
        Math.max(1, Number(env.PROXY_UPSTREAM_TIMEOUT_MS) || DEFAULT_UPSTREAM_TIMEOUT_MS));
    const origin = configuredOrigin(env);
    const configuredAuditToken = String(env.AUDIT_WRITE_TOKEN || '').trim();
    const configuredAuditReadToken = String(env.AUDIT_READ_TOKEN || '').trim();
    const store = auditStore || (configuredAuditToken ? createAuditStore({ filePath: env.AUDIT_FILE_PATH || path.join(__dirname, 'data', 'audit.jsonl') }) : null);
    const requestTvkit = async ({ pathname, query, clientKey = 'unknown', setRateHeaders = null } = {}) => {
        if (!tvkitBase) return { status: 503, payload: { error: 'tvkit provider is not configured' } };
        const tvkitRate = allowTvkit(String(clientKey));
        if (typeof setRateHeaders === 'function') setRateHeaders(tvkitRate);
        if (!tvkitRate.allowed) return { status: 429, payload: { error: 'tvkit request budget exceeded' } };
        const validation = validateMarketRequest(pathname, query);
        if (!validation.valid) return { status: 400, payload: { error: validation.reason } };
        const upstream = new URL(`${tvkitBase}/${pathname.endsWith('/quote') ? 'quote' : 'time_series'}`);
        upstream.searchParams.set('symbol', validation.symbol);
        if (validation.interval) upstream.searchParams.set('interval', validation.interval);
        if (validation.outputsize) upstream.searchParams.set('outputsize', String(validation.outputsize));
        return enqueueTvkitRequest(() => proxyJson(fetchImpl, upstream, { headers: upstreamHeaders('') }, upstreamTimeoutMs));
    };
    const mcpTvkitResult = async ({ pathname, symbol, interval, outputsize } = {}) => {
        try {
            const query = new URLSearchParams({ symbol });
            if (interval) query.set('interval', interval);
            if (outputsize != null) query.set('outputsize', String(outputsize));
            const result = await requestTvkit({ pathname, query, clientKey: 'mcp' });
            if (result.status >= 200 && result.status < 300) return { ok: true, payload: result.payload };
            const providerMessage = typeof result.payload?.error === 'string' ? result.payload.error.slice(0, 240) : null;
            const errorCode = result.status === 400
                ? 'INVALID_REQUEST'
                : result.status === 429
                    ? 'RATE_LIMITED'
                    : result.status === 503
                        ? 'PROVIDER_UNAVAILABLE'
                        : 'UPSTREAM_ERROR';
            return {
                ok: false,
                error: {
                    error_code: errorCode,
                    provider: 'TVKIT',
                    status: result.status,
                    ...(providerMessage ? { message: providerMessage } : { message: 'Market data request failed' })
                }
            };
        } catch (error) {
            const isTimeout = error?.code === 'UPSTREAM_TIMEOUT';
            return {
                ok: false,
                error: {
                    error_code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
                    provider: 'TVKIT',
                    status: Number(error?.statusCode) || 502,
                    message: isTimeout ? 'TVKit request timed out' : 'TVKit request failed'
                }
            };
        }
    };
    const mcpNodeHandler = createGhostMcpNodeHandler({
        getQuote: ({ symbol }) => mcpTvkitResult({ pathname: '/api/tvkit/quote', symbol }),
        getTimeSeries: ({ symbol, interval, outputsize }) => mcpTvkitResult({ pathname: '/api/tvkit/time_series', symbol, interval, outputsize })
    });

    return http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://proxy.local');
        const clientKey = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rate = allow(String(clientKey));
        res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        if (!rate.allowed) return jsonResponse(res, 429, { error: 'rate limit exceeded' }, origin);
        if (req.method === 'OPTIONS') {
            const isMcp = requestUrl.pathname === '/mcp';
            res.writeHead(204, {
                'Access-Control-Allow-Origin': origin || '*',
                'Access-Control-Allow-Headers': isMcp ? 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID, X-Proxy-Client' : 'Content-Type, X-Proxy-Client',
                'Access-Control-Allow-Methods': isMcp ? 'GET, POST, DELETE, OPTIONS' : 'GET, POST, OPTIONS',
                ...(isMcp ? { 'Access-Control-Expose-Headers': 'Mcp-Session-Id, Last-Event-ID' } : {})
            });
            return res.end();
        }
        if (requestUrl.pathname === '/mcp') {
            if (!['GET', 'POST', 'DELETE'].includes(req.method)) return jsonResponse(res, 405, { error: 'MCP method not allowed' }, origin);
            res.setHeader('Access-Control-Allow-Origin', origin || '*');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Last-Event-ID');
            await mcpNodeHandler(req, res);
            return;
        }
        if (req.method === 'GET' && publicAssetResponse(res, requestUrl.pathname, env)) return;
        if (req.method === 'GET' && requestUrl.pathname === '/health') {
            return jsonResponse(res, 200, {
                ok: true,
                service: 'market-ai-proxy',
                time: new Date(now()).toISOString(),
                data_provider_configured: !!twelveKey,
                tvkit_provider_configured: !!tvkitBase,
                market_data_provider_configured: !!twelveKey || !!tvkitBase,
                ai_provider: aiProvider,
                ai_model: aiProvider === 'GEMINI' ? geminiModel : 'deepseek-chat',
                ai_provider_configured: aiProvider === 'GEMINI' ? !!geminiKey : !!deepSeekKey
            }, origin);
        }
        try {
            if (req.method === 'GET' && (requestUrl.pathname === '/api/tvkit/quote' || requestUrl.pathname === '/api/tvkit/time_series')) {
                const result = await requestTvkit({
                    pathname: requestUrl.pathname,
                    query: requestUrl.searchParams,
                    clientKey,
                    setRateHeaders: tvkitRate => res.setHeader('X-Tvkit-RateLimit-Remaining', String(tvkitRate.remaining))
                });
                return jsonResponse(res, result.status, result.payload, origin);
            }
            if (req.method === 'GET' && (requestUrl.pathname === '/api/twelve/quote' || requestUrl.pathname === '/api/twelve/time_series')) {
                if (!twelveKey) return jsonResponse(res, 503, { error: 'market data provider is not configured' }, origin);
                const twelveGlobalRate = allowTwelveDataGlobal('account');
                res.setHeader('X-Twelve-Global-RateLimit-Remaining', String(twelveGlobalRate.remaining));
                if (!twelveGlobalRate.allowed) return jsonResponse(res, 429, { error: 'Twelve Data account request budget exceeded' }, origin);
                const twelveRate = allowTwelveData(String(clientKey));
                res.setHeader('X-Twelve-RateLimit-Remaining', String(twelveRate.remaining));
                if (!twelveRate.allowed) return jsonResponse(res, 429, { error: 'Twelve Data request budget exceeded' }, origin);
                const validation = validateMarketRequest(requestUrl.pathname, requestUrl.searchParams);
                if (!validation.valid) return jsonResponse(res, 400, { error: validation.reason }, origin);
                const upstream = new URL(`${twelveBase}/${requestUrl.pathname.endsWith('/quote') ? 'quote' : 'time_series'}`);
                upstream.searchParams.set('symbol', validation.symbol);
                if (validation.interval) upstream.searchParams.set('interval', validation.interval);
                if (validation.outputsize) upstream.searchParams.set('outputsize', String(validation.outputsize));
                // Twelve Data expects intraday candles in an explicit timezone,
                // while 1day/1week are period buckets and can reject timezone
                // when combined with forex symbols. Keep the provider request
                // compatible with both contracts.
                if (validation.interval && !['1day', '1week'].includes(validation.interval)) {
                    upstream.searchParams.set('timezone', 'UTC');
                }
                upstream.searchParams.set('apikey', twelveKey);
                const result = await proxyJson(fetchImpl, upstream, { headers: upstreamHeaders(twelveKey) }, upstreamTimeoutMs);
                return jsonResponse(res, result.status, result.payload, origin);
            }
            if (req.method === 'POST' && ['/api/ai/chat', '/api/gemini/chat', '/api/deepseek/chat'].includes(requestUrl.pathname)) {
                const requestedProvider = requestUrl.pathname === '/api/gemini/chat'
                    ? 'GEMINI'
                    : requestUrl.pathname === '/api/deepseek/chat'
                        ? 'DEEPSEEK'
                        : aiProvider;
                if (requestedProvider === 'GEMINI' && !geminiKey) return jsonResponse(res, 503, { error: 'AI provider is not configured', provider: 'GEMINI' }, origin);
                if (requestedProvider === 'DEEPSEEK' && !deepSeekKey) return jsonResponse(res, 503, { error: 'AI provider is not configured', provider: 'DEEPSEEK' }, origin);
                const raw = await readBody(req);
                let body;
                try { body = JSON.parse(raw || '{}'); } catch { return jsonResponse(res, 400, { error: 'request body must be valid JSON' }, origin); }
                if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages)) return jsonResponse(res, 400, { error: 'messages array is required' }, origin);
                if (requestedProvider === 'GEMINI') {
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
                    const result = await proxyJson(fetchImpl, geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-goog-api-key': geminiKey, 'User-Agent': 'ict-telegram-bot-proxy/1.0' },
                        body: JSON.stringify(geminiRequestBody(body))
                    }, upstreamTimeoutMs);
                    if (result.status < 200 || result.status >= 300) {
                        return jsonResponse(res, result.status, {
                            error: 'Upstream AI request failed',
                            provider: 'GEMINI',
                            status: result.status,
                            provider_error: sanitizeProviderError(result.payload)
                        }, origin);
                    }
                    return jsonResponse(res, result.status, normalizeGeminiResponse(result.payload, geminiModel), origin);
                }
                const deepSeekBody = { ...body, model: 'deepseek-chat', stream: false };
                delete deepSeekBody.response_schema;
                const result = await proxyJson(fetchImpl, deepSeekUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepSeekKey}`, 'User-Agent': 'ict-telegram-bot-proxy/1.0' },
                    body: JSON.stringify(deepSeekBody)
                }, upstreamTimeoutMs);
                return jsonResponse(res, result.status, result.status >= 200 && result.status < 300
                    ? { ...result.payload, provider: 'DEEPSEEK', model: 'deepseek-chat' }
                    : result.payload, origin);
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
            const isClientError = status === 400 || status === 413;
            const isTimeout = error?.code === 'UPSTREAM_TIMEOUT';
            return jsonResponse(res, status, {
                error: isTimeout ? 'upstream timeout' : (isClientError ? error.message : 'upstream request failed'),
                ...(error?.code ? { code: error.code } : {})
            }, origin);
        }
    });
}

if (require.main === module) {
    const port = Number(process.env.PORT || 8787);
    createProxyServer().listen(port, process.env.HOST || '127.0.0.1', () => {
        console.log(`market-ai-proxy listening on ${process.env.HOST || '127.0.0.1'}:${port}`);
    });
}

module.exports = { MAX_BODY_BYTES, DEFAULT_UPSTREAM_TIMEOUT_MS, MAX_UPSTREAM_TIMEOUT_MS, DEFAULT_AI_PROVIDER, DEFAULT_GEMINI_MODEL, TIMEFRAME_INTERVALS, normalizeSymbol, normalizeAIProvider, geminiContents, geminiRequestBody, normalizeGeminiResponse, sanitizeProviderError, validateMarketRequest, createRateLimiter, createProxyServer };
