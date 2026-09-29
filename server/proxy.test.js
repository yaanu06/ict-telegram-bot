'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateMarketRequest, createRateLimiter, createProxyServer } = require('./proxy');
const { createAuditStore } = require('./audit-store');

function request(server, method, pathname, headers = {}, body = '') {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method, headers }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                let parsed = body;
                try { parsed = JSON.parse(body); } catch {}
                resolve({ status: response.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

describe('market and AI proxy boundary', () => {
    test('serves the Mini App from the same origin as the API', async () => {
        const server = createProxyServer({ env: { PROXY_MAX_REQUESTS: '20' }, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'GET', '/');
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('validates symbols, intervals, and bounded history sizes', () => {
        expect(validateMarketRequest('/quote', new URLSearchParams('symbol=EUR%2FUSD'))).toMatchObject({ valid: true, symbol: 'EUR/USD' });
        expect(validateMarketRequest('/quote', new URLSearchParams('symbol=NASDAQ%3AAAPL'))).toMatchObject({ valid: true, symbol: 'NASDAQ:AAPL' });
        expect(validateMarketRequest('/time_series', new URLSearchParams('symbol=EUR/USD&interval=1h&outputsize=200'))).toMatchObject({ valid: true, interval: '1h', outputsize: 200 });
        expect(validateMarketRequest('/time_series', new URLSearchParams('symbol=EUR/USD&interval=2h'))).toMatchObject({ valid: false, reason: 'interval is unsupported' });
        expect(validateMarketRequest('/time_series', new URLSearchParams('symbol=EUR/USD&interval=1h&outputsize=5'))).toMatchObject({ valid: false, reason: 'outputsize is invalid' });
        expect(validateMarketRequest('/quote', new URLSearchParams('symbol=EUR%24USD'))).toMatchObject({ valid: false, reason: 'symbol is invalid' });
    });

    test('rate limiter resets its window and reports remaining capacity', () => {
        let now = 1000;
        const allow = createRateLimiter({ now: () => now, windowMs: 100, maxRequests: 2 });
        expect(allow('client')).toMatchObject({ allowed: true, remaining: 1 });
        expect(allow('client')).toMatchObject({ allowed: true, remaining: 0 });
        expect(allow('client').allowed).toBe(false);
        now += 100;
        expect(allow('client')).toMatchObject({ allowed: true, remaining: 1 });
    });

    test('applies a separate Twelve Data budget below the provider plan limit', async () => {
        const fetchImpl = jest.fn(async () => ({ status: 200, text: async () => JSON.stringify({ price: '1.25', timestamp: '2026-09-19T10:00:00Z' }) }));
        const server = createProxyServer({
            env: { TWELVE_DATA_API_KEY: 'provider-secret', PROXY_MAX_REQUESTS: '20', PROXY_TWELVE_MAX_REQUESTS: '1' },
            fetchImpl
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            expect((await request(server, 'GET', '/api/twelve/quote?symbol=EUR%2FUSD')).status).toBe(200);
            const second = await request(server, 'GET', '/api/twelve/quote?symbol=EUR%2FUSD');
            expect(second.status).toBe(429);
            expect(second.body.error).toMatch(/Twelve Data request budget/);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('keeps daily Twelve Data requests free of intraday timezone parameters', async () => {
        const urls = [];
        const fetchImpl = jest.fn(async url => {
            urls.push(String(url));
            return { status: 200, text: async () => JSON.stringify({ values: [] }) };
        });
        const server = createProxyServer({
            env: { TWELVE_DATA_API_KEY: 'provider-secret', PROXY_MAX_REQUESTS: '20', PROXY_TWELVE_MAX_REQUESTS: '20' },
            fetchImpl
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            expect((await request(server, 'GET', '/api/twelve/time_series?symbol=EUR%2FUSD&interval=1day&outputsize=200')).status).toBe(200);
            expect((await request(server, 'GET', '/api/twelve/time_series?symbol=EUR%2FUSD&interval=1h&outputsize=200')).status).toBe(200);
            expect(new URL(urls[0]).searchParams.has('timezone')).toBe(false);
            expect(new URL(urls[1]).searchParams.get('timezone')).toBe('UTC');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('forwards the optional tvkit provider without requiring a Twelve Data key', async () => {
        const urls = [];
        const fetchImpl = jest.fn(async url => {
            urls.push(String(url));
            return { status: 200, text: async () => JSON.stringify({ values: [] }) };
        });
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '20', PROXY_TVKIT_MAX_REQUESTS: '20' },
            fetchImpl
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'GET', '/api/tvkit/time_series?symbol=OANDA%3AXAUUSD&interval=4h&outputsize=200');
            expect(response.status).toBe(200);
            expect(new URL(urls[0]).origin).toBe('http://127.0.0.1:8790');
            expect(new URL(urls[0]).pathname).toBe('/time_series');
            expect(new URL(urls[0]).searchParams.get('symbol')).toBe('OANDA:XAUUSD');
            expect(new URL(urls[0]).searchParams.get('interval')).toBe('4h');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('enforces the Twelve Data account budget across different clients', async () => {
        const fetchImpl = jest.fn(async () => ({ status: 200, text: async () => JSON.stringify({ price: '1.25' }) }));
        const server = createProxyServer({
            env: { TWELVE_DATA_API_KEY: 'provider-secret', PROXY_MAX_REQUESTS: '20', PROXY_TWELVE_MAX_REQUESTS: '20', PROXY_TWELVE_GLOBAL_MAX_REQUESTS: '1' },
            fetchImpl
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            expect((await request(server, 'GET', '/api/twelve/quote?symbol=EUR%2FUSD', { 'x-forwarded-for': 'client-a' })).status).toBe(200);
            const second = await request(server, 'GET', '/api/twelve/quote?symbol=GBP%2FUSD', { 'x-forwarded-for': 'client-b' });
            expect(second.status).toBe(429);
            expect(second.body.error).toMatch(/account request budget/);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('bounds a hung upstream request with the configured timeout', async () => {
        const server = createProxyServer({
            env: { TWELVE_DATA_API_KEY: 'provider-secret', PROXY_MAX_REQUESTS: '20', PROXY_UPSTREAM_TIMEOUT_MS: '10' },
            fetchImpl: jest.fn((url, options = {}) => new Promise((resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            }))
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'GET', '/api/twelve/quote?symbol=EUR%2FUSD');
            expect(response.status).toBe(504);
            expect(response.body).toEqual({ error: 'upstream timeout', code: 'UPSTREAM_TIMEOUT' });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('accepts the bounded market analyst payload above one megabyte', async () => {
        const fetchImpl = jest.fn(async () => ({
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })
        }));
        const server = createProxyServer({ env: { DEEPSEEK_API_KEY: 'provider-secret', PROXY_MAX_REQUESTS: '20' }, fetchImpl });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const body = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(1_100_000) }] });
            const response = await request(server, 'POST', '/api/deepseek/chat', { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body);
            expect(response.status).toBe(200);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('routes the configured provider to Gemini and normalizes its response without exposing the key', async () => {
        const calls = [];
        const fetchImpl = jest.fn(async (url, options) => {
            calls.push({ url: String(url), options });
            return {
                status: 200,
                text: async () => JSON.stringify({
                    candidates: [{ content: { parts: [{ text: '{"decision":"WAIT","reasoning":"clear"}' }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 }
                })
            };
        });
        const server = createProxyServer({
            env: { AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'gemini-secret', GEMINI_MODEL: 'gemini-test', PROXY_MAX_REQUESTS: '20' },
            fetchImpl
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/ai/chat', { 'content-type': 'application/json' }, JSON.stringify({
                model: 'gemini-test',
                messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'select' }],
                temperature: 0.1,
                max_tokens: 100,
                response_schema: { type: 'OBJECT', properties: { decision: { type: 'STRING' } } }
            }));
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ provider: 'GEMINI', model: 'gemini-test', choices: [{ message: { content: '{"decision":"WAIT","reasoning":"clear"}' } }], usage: { total_tokens: 16 } });
            expect(calls).toHaveLength(1);
            expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
            expect(calls[0].options.headers['x-goog-api-key']).toBe('gemini-secret');
            expect(calls[0].options.headers.Authorization).toBeUndefined();
            const forwarded = JSON.parse(calls[0].options.body);
            expect(forwarded.systemInstruction.parts[0].text).toBe('JSON only');
            expect(forwarded.contents).toEqual([{ role: 'user', parts: [{ text: 'select' }] }]);
            expect(forwarded.generationConfig.responseMimeType).toBe('application/json');
            expect(forwarded.generationConfig.responseSchema).toEqual({ type: 'OBJECT', properties: { decision: { type: 'STRING' } } });
            expect(JSON.stringify(response.body)).not.toContain('gemini-secret');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('health reports the selected Gemini provider and model safely', async () => {
        const server = createProxyServer({ env: { AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'gemini-secret', GEMINI_MODEL: 'gemini-test', PROXY_MAX_REQUESTS: '20' }, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const health = (await request(server, 'GET', '/health')).body;
            expect(health).toMatchObject({ ai_provider: 'GEMINI', ai_model: 'gemini-test', ai_provider_configured: true });
            expect(JSON.stringify(health)).not.toContain('gemini-secret');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('preserves Gemini rate-limit status for the client diagnostics', async () => {
        const server = createProxyServer({
            env: { AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'gemini-secret', PROXY_MAX_REQUESTS: '20' },
            fetchImpl: jest.fn(async () => ({ status: 429, text: async () => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }) }))
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/ai/chat', { 'content-type': 'application/json' }, JSON.stringify({ messages: [{ role: 'user', content: 'select' }] }));
            expect(response.status).toBe(429);
            expect(response.body).toMatchObject({ error: 'Upstream AI request failed', provider: 'GEMINI', status: 429, provider_error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('preserves safe Gemini quota and retry metadata on a structured 429', async () => {
        const providerPayload = {
            error: {
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message: 'Quota exceeded for requests per minute.',
                details: [
                    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '10', quotaDimensions: { model: 'gemini-3.5-flash-lite', location: 'global' } }] },
                    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: { seconds: '12', nanos: 0 } }
                ]
            }
        };
        const server = createProxyServer({
            env: { AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'gemini-secret', PROXY_MAX_REQUESTS: '20' },
            fetchImpl: jest.fn(async () => ({ status: 429, text: async () => JSON.stringify(providerPayload) }))
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/ai/chat', { 'content-type': 'application/json' }, JSON.stringify({ messages: [{ role: 'user', content: 'select' }] }));
            expect(response.body.provider_error).toEqual({
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message: 'Quota exceeded for requests per minute.',
                quota: [{ quota_metric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quota_id: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quota_value: '10', quota_dimensions: { model: 'gemini-3.5-flash-lite', location: 'global' } }],
                retry_delay: '12s'
            });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('sanitizes credential-like text and handles malformed Gemini errors without leaking the upstream body', async () => {
        const responses = [
            { status: 429, text: async () => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'x-goog-api-key: gemini-secret' } }) },
            { status: 502, text: async () => '<html>proxy failure with gemini-secret</html>' }
        ];
        const server = createProxyServer({
            env: { AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'gemini-secret', PROXY_MAX_REQUESTS: '20' },
            fetchImpl: jest.fn(async () => responses.shift())
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const body = JSON.stringify({ messages: [{ role: 'user', content: 'select' }] });
            const first = await request(server, 'POST', '/api/ai/chat', { 'content-type': 'application/json' }, body);
            const second = await request(server, 'POST', '/api/ai/chat', { 'content-type': 'application/json' }, body);
            expect(JSON.stringify(first.body)).not.toContain('gemini-secret');
            expect(first.body.provider_error.message).toContain('[REDACTED]');
            expect(second.body).toEqual({ error: 'Upstream AI request failed', provider: 'GEMINI', status: 502, provider_error: null });
            expect(JSON.stringify(second.body)).not.toContain('proxy failure');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('does not expose unconfigured providers or unauthenticated audit reads', async () => {
        const server = createProxyServer({ env: { PROXY_MAX_REQUESTS: '20' }, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            expect((await request(server, 'GET', '/health')).body).toMatchObject({ ok: true, data_provider_configured: false, ai_provider_configured: false });
            expect((await request(server, 'GET', '/api/twelve/quote?symbol=EUR%2FUSD')).status).toBe(503);
            expect((await request(server, 'POST', '/api/deepseek/chat')).status).toBe(503);
            expect((await request(server, 'GET', '/api/audit')).status).toBe(401);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('returns client validation errors for malformed audit records', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-proxy-audit-'));
        const store = createAuditStore({ filePath: path.join(directory, 'audit.jsonl') });
        const server = createProxyServer({
            env: { PROXY_MAX_REQUESTS: '20', AUDIT_WRITE_TOKEN: 'write-secret', AUDIT_READ_TOKEN: 'read-secret' },
            fetchImpl: jest.fn(),
            auditStore: store
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/audit', { 'x-audit-token': 'write-secret', 'content-type': 'application/json' }, JSON.stringify({ pair: 'EUR/USD' }));
            expect(response.status).toBe(400);
            expect(response.body.error).toMatch(/request_id is required/);
            expect((await request(server, 'GET', '/api/audit', { 'x-audit-token': 'read-secret' })).body.records).toEqual([]);
        } finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test('accepts a reproducible replay payload and preserves it in the audit store', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-proxy-replay-'));
        const store = createAuditStore({ filePath: path.join(directory, 'audit.jsonl') });
        const server = createProxyServer({
            env: { PROXY_MAX_REQUESTS: '20', AUDIT_WRITE_TOKEN: 'write-secret', AUDIT_READ_TOKEN: 'read-secret' },
            fetchImpl: jest.fn(),
            auditStore: store
        });
        const replay = {
            schema_version: 1,
            captured_at: '2026-09-19T10:00:00Z',
            pair: 'EUR/USD',
            quote: { price: 1.1 },
            history: { '1H': [{ timestamp: '2026-09-19T09:00:00Z', open: 1.09, high: 1.11, low: 1.08, close: 1.1 }] }
        };
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/audit', { 'x-audit-token': 'write-secret', 'content-type': 'application/json' }, JSON.stringify({
                request_id: 'scan-replay-1', recorded_at: '2026-09-19T10:00:00Z', pair: 'EUR/USD', decision: 'WAIT', replay
            }));
            expect(response.status).toBe(201);
            const records = (await request(server, 'GET', '/api/audit', { 'x-audit-token': 'read-secret' })).body.records;
            expect(records[0]).toMatchObject({ request_id: 'scan-replay-1', replay });
        } finally {
            await new Promise(resolve => server.close(resolve));
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
