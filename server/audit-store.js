'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = /(api[_-]?key|authorization|bearer|token|password|secret|pat|credential|telegram[_-]?(user|session|auth))/i;
const SECRET_TEXT = /(TWELVE_DATA_KEY|DEEPSEEK_API_KEY|GITHUB_PAT|authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]+|[?&](?:apikey|api_key|token|key)=)/i;
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_AUDIT_RECORDS = 5000;

function sanitizeAuditValue(value, key = '') {
    if (SECRET_KEY.test(key)) return undefined;
    if (typeof value === 'string') return SECRET_TEXT.test(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(item => sanitizeAuditValue(item)).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
        const safe = sanitizeAuditValue(childValue, childKey);
        if (safe !== undefined) result[childKey] = safe;
    }
    return result;
}

function validateAuditRecord(record) {
    const issues = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) issues.push('record must be an object');
    if (!String(record?.request_id || '').trim()) issues.push('request_id is required');
    if (!String(record?.recorded_at || '').trim()) issues.push('recorded_at is required');
    if (!String(record?.pair || '').trim()) issues.push('pair is required');
    const bytes = Buffer.byteLength(JSON.stringify(record || {}), 'utf8');
    if (bytes > MAX_RECORD_BYTES) issues.push('record exceeds size limit');
    return { valid: issues.length === 0, issues, bytes };
}

function createAuditStore({ filePath, fsImpl = fs, maxRecords = MAX_AUDIT_RECORDS } = {}) {
    if (!filePath) throw new Error('audit file path is required');
    const append = record => {
        const safe = sanitizeAuditValue(record);
        const validation = validateAuditRecord(safe);
        if (!validation.valid) {
            throw Object.assign(new Error(validation.issues.join('; ')), { statusCode: 400, code: 'INVALID_AUDIT_RECORD' });
        }
        fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
        fsImpl.appendFileSync(filePath, JSON.stringify(safe) + '\n', 'utf8');
        return safe;
    };
    const recent = (limit = 100) => {
        if (!fsImpl.existsSync(filePath)) return [];
        const count = Math.max(1, Math.min(Number(limit) || 100, maxRecords));
        const lines = fsImpl.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
        return lines.slice(-count).reverse().map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
    };
    return { append, recent, filePath };
}

module.exports = { MAX_RECORD_BYTES, sanitizeAuditValue, validateAuditRecord, createAuditStore };
