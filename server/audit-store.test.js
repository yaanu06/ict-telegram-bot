const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuditStore, sanitizeAuditValue, validateAuditRecord } = require('./audit-store');

describe('persistent audit store', () => {
    it('sanitizes credentials and preserves reproducible decision fields', () => {
        const safe = sanitizeAuditValue({ request_id: 'scan-1', pair: 'EUR/USD', api_key: 'secret', reason: 'clean' });
        expect(safe).toEqual({ request_id: 'scan-1', pair: 'EUR/USD', reason: 'clean' });
        expect(validateAuditRecord(safe).valid).toBe(false);
        expect(validateAuditRecord({ ...safe, recorded_at: '2026-09-18T00:00:00Z' }).valid).toBe(true);
    });

    it('appends records and reads newest records first', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-audit-'));
        const store = createAuditStore({ filePath: path.join(dir, 'audit.jsonl') });
        store.append({ request_id: '1', recorded_at: '2026-09-18T00:00:00Z', pair: 'EUR/USD', decision: 'WAIT' });
        store.append({ request_id: '2', recorded_at: '2026-09-18T00:01:00Z', pair: 'XAU/USD', decision: 'BUY_LIMIT' });
        expect(store.recent()).toMatchObject([{ request_id: '2' }, { request_id: '1' }]);
    });
});
