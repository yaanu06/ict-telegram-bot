'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditStore, sanitizeAuditValue, validateAuditRecord } = require('./audit-store');

describe('audit store safety and persistence', () => {
    let directory;
    let filePath;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-audit-'));
        filePath = path.join(directory, 'audit.jsonl');
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    test('removes credential-shaped fields and redacts secret text', () => {
        const safe = sanitizeAuditValue({
            pair: 'EUR/USD',
            api_key: 'secret',
            nested: { authorization: 'Bearer abc', note: 'https://provider.test/quote?apikey=hidden' }
        });
        expect(safe).toEqual({ pair: 'EUR/USD', nested: { note: '[REDACTED]' } });
    });

    test('requires reproducible audit identity fields', () => {
        expect(validateAuditRecord({ pair: 'EUR/USD' }).valid).toBe(false);
        expect(validateAuditRecord({ request_id: 'r1', recorded_at: '2026-09-18T00:00:00Z', pair: 'EUR/USD' }).valid).toBe(true);
    });

    test('appends records and returns newest records first', () => {
        const store = createAuditStore({ filePath });
        store.append({ request_id: 'r1', recorded_at: '2026-09-18T00:00:00Z', pair: 'EUR/USD', decision: 'WAIT' });
        store.append({ request_id: 'r2', recorded_at: '2026-09-18T00:01:00Z', pair: 'XAU/USD', decision: 'BUY_LIMIT' });
        expect(store.recent(1)).toEqual([{ request_id: 'r2', recorded_at: '2026-09-18T00:01:00Z', pair: 'XAU/USD', decision: 'BUY_LIMIT' }]);
    });
});
