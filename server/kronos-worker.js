'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULT_MODEL = 'NeoQuasar/Kronos-small';
const DEFAULT_TIMEOUT_MS = 120000;

function configuredModel(env = process.env) {
    const value = String(env.KRONOS_MODEL_ID || env.KRONOS_MODEL || DEFAULT_MODEL).trim();
    return value.toLowerCase() === 'small' ? DEFAULT_MODEL : (value || DEFAULT_MODEL);
}

function unavailable(reason, env = process.env) {
    return {
        status: 'UNAVAILABLE',
        model: configuredModel(env),
        device: null,
        error: reason
    };
}

function firstExistingPath(candidates) {
    const fs = require('node:fs');
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function defaultPythonPath(workerPath) {
    const repoRoot = path.resolve(path.dirname(workerPath), '..');
    const candidates = process.platform === 'win32'
        ? [path.join(repoRoot, '.venv-kronos', 'Scripts', 'python.exe'), path.join(repoRoot, '.venv', 'Scripts', 'python.exe')]
        : [path.join(repoRoot, '.venv-kronos', 'bin', 'python'), path.join(repoRoot, '.venv', 'bin', 'python')];
    return firstExistingPath(candidates) || (process.platform === 'win32' ? 'python' : 'python3');
}

function defaultOfficialRepoPath(workerPath, env = process.env) {
    if (String(env.KRONOS_REPO_PATH || '').trim()) return String(env.KRONOS_REPO_PATH).trim();
    const repoRoot = path.resolve(path.dirname(workerPath), '..');
    return firstExistingPath([
        path.resolve(repoRoot, '..', 'kronos-official'),
        path.join(repoRoot, 'kronos-official')
    ]);
}

function createKronosWorker({ env = process.env, pythonPath = null, workerPath = path.join(__dirname, '..', 'tools', 'kronos_worker.py') } = {}) {
    let child = null;
    let buffer = '';
    let sequence = 0;
    const pending = new Map();

    function rejectPending(error) {
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve(unavailable(error?.message || 'Kronos worker stopped', env));
        }
        pending.clear();
    }

    function stop() {
        if (!child) return;
        rejectPending(new Error('Kronos worker stopped'));
        child.kill();
        child = null;
        buffer = '';
    }

    function start() {
        if (child) return child;
        const executable = pythonPath || env.KRONOS_PYTHON || defaultPythonPath(workerPath);
        const repoPath = defaultOfficialRepoPath(workerPath, env);
        child = spawn(executable, [workerPath], {
            cwd: path.dirname(workerPath),
            env: { ...env, ...(repoPath ? { KRONOS_REPO_PATH: repoPath } : {}), PYTHONUNBUFFERED: '1' },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                let response;
                try { response = JSON.parse(line); } catch (_) { continue; }
                const item = pending.get(response.id);
                if (!item) continue;
                pending.delete(response.id);
                clearTimeout(item.timer);
                item.resolve(response);
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', text => {
            // Keep model/library diagnostics out of the JSON protocol.  The
            // proxy log is intentionally bounded so a bad dependency cannot
            // flood the hosted service logs.
            const message = String(text).trim().slice(0, 500);
            if (message) console.warn('[KRONOS WORKER]', message);
        });
        child.on('error', error => {
            rejectPending(error);
            child = null;
        });
        child.on('exit', () => {
            if (child) {
                rejectPending(new Error('Kronos worker exited'));
                child = null;
            }
        });
        return child;
    }

    function request(payload = {}) {
        if (String(env.KRONOS_ENABLED || 'true').toLowerCase() === 'false') {
            return Promise.resolve(unavailable('KRONOS_ENABLED=false', env));
        }
        let processHandle;
        try { processHandle = start(); } catch (error) { return Promise.resolve(unavailable(error.message, env)); }
        const id = `kronos-${Date.now()}-${++sequence}`;
        const timeoutMs = Math.max(1000, Number(env.KRONOS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve({ ...unavailable('Kronos inference timeout', env), status: 'ERROR', error: 'KRONOS_TIMEOUT' });
            }, timeoutMs);
            pending.set(id, { resolve, timer });
            try {
                processHandle.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
            } catch (error) {
                clearTimeout(timer);
                pending.delete(id);
                resolve(unavailable(error.message, env));
            }
        });
    }

    return { request, stop };
}

module.exports = { DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, configuredModel, defaultPythonPath, defaultOfficialRepoPath, createKronosWorker };
