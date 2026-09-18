const { validateMarketRequest, createRateLimiter, createProxyServer } = require('./proxy');

describe('server market and AI proxy', () => {
    it('validates asset-agnostic market requests without accepting arbitrary intervals', () => {
        const quote = validateMarketRequest('/api/twelve/quote', new URLSearchParams('symbol=eur%2Fusd'));
        expect(quote).toMatchObject({ valid: true, symbol: 'EUR/USD' });
        const series = validateMarketRequest('/api/twelve/time_series', new URLSearchParams('symbol=BTC%2FUSD&interval=4h&outputsize=200'));
        expect(series).toMatchObject({ valid: true, symbol: 'BTC/USD', interval: '4h', outputsize: 200 });
        expect(validateMarketRequest('/api/twelve/time_series', new URLSearchParams('symbol=EUR%2FUSD&interval=2h&outputsize=200')).valid).toBe(false);
        expect(validateMarketRequest('/api/twelve/time_series', new URLSearchParams('symbol=EUR%2FUSD&interval=1h&outputsize=5')).valid).toBe(false);
    });

    it('enforces a bounded per-client request window', () => {
        let now = 0;
        const allow = createRateLimiter({ now: () => now, maxRequests: 2, windowMs: 1000 });
        expect(allow('client').allowed).toBe(true);
        expect(allow('client').allowed).toBe(true);
        expect(allow('client').allowed).toBe(false);
        now = 1000;
        expect(allow('client').allowed).toBe(true);
    });

    it('does not expose provider routes when server credentials are absent', async () => {
        const server = createProxyServer({ env: {}, fetchImpl: jest.fn() });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}/api/twelve/quote?symbol=EUR%2FUSD`);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'market data provider is not configured' });
        server.close();
    });

    it('accepts authenticated audit writes but exposes no order route', async () => {
        const records = [];
        const auditStore = {
            append: record => { records.push(record); return record; },
            recent: () => records.slice().reverse()
        };
        const server = createProxyServer({ env: { AUDIT_WRITE_TOKEN: 'audit-secret', AUDIT_READ_TOKEN: 'read-secret' }, fetchImpl: jest.fn(), auditStore });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const denied = await fetch(`http://127.0.0.1:${port}/api/audit`, { method: 'POST', body: JSON.stringify({ request_id: '1' }) });
        expect(denied.status).toBe(401);
        const accepted = await fetch(`http://127.0.0.1:${port}/api/audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Audit-Token': 'audit-secret' },
            body: JSON.stringify({ request_id: '1', recorded_at: '2026-09-18T00:00:00Z', pair: 'EUR/USD', decision: 'WAIT' })
        });
        expect(accepted.status).toBe(201);
        expect(records[0]).toMatchObject({ request_id: '1', pair: 'EUR/USD' });
        const writeTokenRead = await fetch(`http://127.0.0.1:${port}/api/audit`, { headers: { 'X-Audit-Token': 'audit-secret' } });
        expect(writeTokenRead.status).toBe(401);
        const read = await fetch(`http://127.0.0.1:${port}/api/audit`, { headers: { 'X-Audit-Token': 'read-secret' } });
        expect(read.status).toBe(200);
        expect((await read.json()).records[0]).toMatchObject({ request_id: '1' });
        const order = await fetch(`http://127.0.0.1:${port}/api/order`, { method: 'POST' });
        expect(order.status).toBe(404);
        server.close();
    });
});
