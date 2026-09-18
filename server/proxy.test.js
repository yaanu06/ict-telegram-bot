'use strict';

const http = require('node:http');
const { validateMarketRequest, createRateLimiter, createProxyServer } = require('./proxy');

function request(server, method, pathname, headers = {}) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method, headers }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.end();
    });
}

describe('market and AI proxy boundary', () => {
    test('validates symbols, intervals, and bounded history sizes', () => {
        expect(validateMarketRequest('/quote', new URLSearchParams('symbol=EUR%2FUSD'))).toMatchObject({ valid: true, symbol: 'EUR/USD' });
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
});
