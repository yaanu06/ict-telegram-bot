'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createProxyServer } = require('./proxy');
const { GHOST_INTERVALS, GHOST_RESOURCE_URI, normalizeGhostSymbol } = require('./ghost-mcp');

function request(server, body, headers = {}) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path: '/mcp',
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                ...headers
            }
        }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                let parsed = text;
                try { parsed = JSON.parse(text); } catch {
                    const dataLine = text.split(/\r?\n/).find(line => line.startsWith('data: '));
                    if (dataLine) {
                        try { parsed = JSON.parse(dataLine.slice(6)); } catch {}
                    }
                }
                resolve({ status: response.statusCode, headers: response.headers, body: parsed });
            });
        });
        req.on('error', reject);
        req.end(payload);
    });
}

function initialize() {
    return {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'ict-ghost-test-client', version: '1.0.0' }
        }
    };
}

describe('ICT Ghost MCP endpoint', () => {
    test('normalizes XAU symbols and exposes exactly the Ghost intervals', () => {
        expect(normalizeGhostSymbol('XAU/USD')).toBe('OANDA:XAUUSD');
        expect(normalizeGhostSymbol(' xauusd ')).toBe('OANDA:XAUUSD');
        expect(GHOST_INTERVALS).toEqual(['1day', '4h', '1h', '15min', '5min']);
        expect(GHOST_INTERVALS).not.toContain('1week');
        expect(GHOST_INTERVALS).not.toContain('1min');
    });

    test('supports handshake, tools/list, resources/list and the Ghost specification resource', async () => {
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '50' },
            fetchImpl: jest.fn()
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const init = await request(server, initialize());
            expect(init.status).toBe(200);
            expect(init.body.result.serverInfo.name).toBe('ICT Ghost');
            expect(init.body.result.instructions).toMatch(/ict:\/\/ghost\/specification/);

            const tools = await request(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
            expect(tools.status).toBe(200);
            expect(tools.body.result.tools.map(tool => tool.name)).toEqual(['get_quote', 'get_time_series', 'get_market_snapshot']);

            const resources = await request(server, { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
            expect(resources.body.result.resources).toHaveLength(1);
            expect(resources.body.result.resources[0].uri).toBe(GHOST_RESOURCE_URI);

            const read = await request(server, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: GHOST_RESOURCE_URI } });
            expect(read.body.result.contents[0].text).toBe(fs.readFileSync(path.resolve(__dirname, '..', 'ghost', 'ICT_GHOST.md'), 'utf8'));
            expect(read.body.result.contents[0].text).toMatch(/AI interpretation is never deterministic proof/i);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('get_quote reuses TVKit, normalizes XAU/USD, and returns structured data', async () => {
        const urls = [];
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '50', PROXY_TVKIT_MAX_REQUESTS: '50' },
            fetchImpl: jest.fn(async url => {
                urls.push(String(url));
                return { status: 200, text: async () => JSON.stringify({ price: 4150.25, timestamp: 123, symbol: 'OANDA:XAUUSD', provider: 'TVKIT' }) };
            })
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            await request(server, initialize());
            const result = await request(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_quote', arguments: { symbol: 'XAU/USD' } } });
            expect(result.body.result.structuredContent).toMatchObject({ price: 4150.25, symbol: 'OANDA:XAUUSD', provider: 'TVKIT' });
            expect(new URL(urls[0]).searchParams.get('symbol')).toBe('OANDA:XAUUSD');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('get_time_series enforces the Ghost interval allowlist and defaults outputsize to 200', async () => {
        const urls = [];
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '50', PROXY_TVKIT_MAX_REQUESTS: '50' },
            fetchImpl: jest.fn(async url => {
                urls.push(String(url));
                return { status: 200, text: async () => JSON.stringify({ values: [], meta: { interval: new URL(url).searchParams.get('interval') } }) };
            })
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            await request(server, initialize());
            const valid = await request(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_time_series', arguments: { symbol: 'XAU/USD', interval: '4h' } } });
            expect(valid.body.result.structuredContent.meta.interval).toBe('4h');
            expect(new URL(urls[0]).searchParams.get('outputsize')).toBe('200');

            const invalid = await request(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_time_series', arguments: { symbol: 'XAU/USD', interval: '1week' } } });
            expect(invalid.body.result.isError).toBe(true);
            expect(urls).toHaveLength(1);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('get_market_snapshot returns quote plus exactly five timeframes and fails explicitly on partial data', async () => {
        const urls = [];
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '50', PROXY_TVKIT_MAX_REQUESTS: '50' },
            fetchImpl: jest.fn(async url => {
                urls.push(String(url));
                const parsed = new URL(url);
                return {
                    status: parsed.pathname === '/quote' ? 200 : 200,
                    text: async () => JSON.stringify(parsed.pathname === '/quote' ? { price: 1 } : { values: [], interval: parsed.searchParams.get('interval') })
                };
            })
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            await request(server, initialize());
            const result = await request(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_market_snapshot', arguments: { symbol: 'XAU/USD' } } });
            expect(Object.keys(result.body.result.structuredContent.time_series)).toEqual(GHOST_INTERVALS);
            expect(urls).toHaveLength(6);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('returns safe machine-readable provider failures without secrets', async () => {
        const server = createProxyServer({
            env: { TVKIT_BASE_URL: 'http://127.0.0.1:8790', PROXY_MAX_REQUESTS: '50', PROXY_TVKIT_MAX_REQUESTS: '50' },
            fetchImpl: jest.fn(async () => ({ status: 502, text: async () => '<html>upstream failure and secret-token</html>' }))
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            await request(server, initialize());
            const result = await request(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_quote', arguments: { symbol: 'XAU/USD' } } });
            expect(result.body.result.isError).toBe(true);
            expect(result.body.result.structuredContent).toMatchObject({ error_code: 'UPSTREAM_ERROR', provider: 'TVKIT', status: 502 });
            expect(JSON.stringify(result.body)).not.toContain('secret-token');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
