'use strict';

const http = require('node:http');
const { createProxyServer } = require('./proxy');
const { defaultPythonPath, kronosEnabled } = require('./kronos-worker');

function request(server, method, pathname, body = null) {
    return new Promise((resolve, reject) => {
        const address = server.address();
        const req = http.request({ hostname: address.address, port: address.port, path: pathname, method, headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {} }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

describe('Kronos proxy boundary', () => {
    test('uses explicit enablement and a deployment-independent Python fallback', () => {
        expect(kronosEnabled({ KRONOS_ENABLED: 'false' })).toBe(false);
        expect(kronosEnabled({ KRONOS_ENABLED: 'true' })).toBe(true);
        expect(defaultPythonPath('C:\\app\\server\\worker.js')).toMatch(/python(\.exe|3)?$/i);
    });

    test('returns explicit unavailable status when disabled without affecting the route', async () => {
        const server = createProxyServer({ env: { KRONOS_ENABLED: 'false', PROXY_MAX_REQUESTS: '20' }, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await request(server, 'POST', '/api/kronos/forecast', JSON.stringify({
                symbol: 'XAU/USD', timeframe: '1h', candles: [
                    { timestamp: '2026-10-17T00:00:00Z', open: 1, high: 2, low: 0, close: 1, is_closed: true },
                    { timestamp: '2026-10-17T01:00:00Z', open: 1, high: 2, low: 0, close: 1, is_closed: true }
                ]
            }));
            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({ status: 'UNAVAILABLE', error: 'KRONOS_ENABLED=false' });
            const health = await request(server, 'GET', '/health');
            expect(health.body.kronos).toMatchObject({ enabled: false, status: 'DISABLED', worker_alive: false, model_loaded: false, last_error: 'KRONOS_ENABLED=false' });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('reports resident-worker diagnostics without starting local Python by default', async () => {
        const server = createProxyServer({ env: { KRONOS_ENABLED: 'true', PROXY_MAX_REQUESTS: '20' }, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const health = await request(server, 'GET', '/health');
            expect(health.body.kronos).toMatchObject({ enabled: true, status: 'NOT_STARTED', worker_alive: false, model_loaded: false });
            expect(health.body.kronos.last_error).toBeNull();
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
