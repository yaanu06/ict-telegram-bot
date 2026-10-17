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

function kronosEnabled(env = process.env) {
    return String(env.KRONOS_ENABLED || 'true').toLowerCase() !== 'false';
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
    const diagnosticsState = {
        enabled: kronosEnabled(env),
        status: kronosEnabled(env) ? 'NOT_STARTED' : 'DISABLED',
        model: configuredModel(env),
        device: String(env.KRONOS_DEVICE || 'auto').trim() || 'auto',
        model_loaded: false,
        last_error: kronosEnabled(env) ? null : 'KRONOS_ENABLED=false'
    };

    function diagnostics() {
        return { ...diagnosticsState, worker_alive: !!child };
    }

    function recordResult(response) {
        if (!response || typeof response !== 'object') return;
        if (response.device) diagnosticsState.device = response.device;
        if (response.status === 'OK') {
            diagnosticsState.status = 'OK';
            diagnosticsState.model_loaded = true;
            diagnosticsState.last_error = null;
        } else if (response.status === 'UNAVAILABLE') {
            diagnosticsState.status = 'UNAVAILABLE';
            diagnosticsState.last_error = response.error || 'Kronos is unavailable';
        } else if (response.status === 'ERROR') {
            diagnosticsState.status = 'ERROR';
            diagnosticsState.last_error = response.error || 'Kronos worker error';
        }
    }

    function rejectPending(error) {
        const response = unavailable(error?.message || 'Kronos worker stopped', env);
        recordResult(response);
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve(response);
        }
        pending.clear();
    }

    function stop() {
        if (!child) return;
        rejectPending(new Error('Kronos worker stopped'));
        child.kill();
        child = null;
        buffer = '';
        diagnosticsState.status = diagnosticsState.enabled ? 'UNAVAILABLE' : 'DISABLED';
        diagnosticsState.model_loaded = false;
    }

    function start() {
        if (child) return child;
        const executable = pythonPath || env.KRONOS_PYTHON || env.KRONOS_PYTHON_EXECUTABLE || defaultPythonPath(workerPath);
        const repoPath = defaultOfficialRepoPath(workerPath, env);
        child = spawn(executable, [workerPath], {
            cwd: path.dirname(workerPath),
            env: { ...env, ...(repoPath ? { KRONOS_REPO_PATH: repoPath } : {}), PYTHONUNBUFFERED: '1' },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const processHandle = child;
        diagnosticsState.status = 'STARTING';
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
                recordResult(response);
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
            if (child !== processHandle) return;
            rejectPending(error);
            child = null;
            diagnosticsState.status = 'UNAVAILABLE';
        });
        child.on('exit', () => {
            if (child !== processHandle) return;
            if (child) {
                rejectPending(new Error('Kronos worker exited'));
                child = null;
                diagnosticsState.status = 'UNAVAILABLE';
                diagnosticsState.model_loaded = false;
            }
        });
        return child;
    }

    function request(payload = {}) {
        if (!diagnosticsState.enabled) {
            const response = unavailable('KRONOS_ENABLED=false', env);
            recordResult(response);
            diagnosticsState.status = 'DISABLED';
            return Promise.resolve(response);
        }
        let processHandle;
        try { processHandle = start(); } catch (error) { return Promise.resolve(unavailable(error.message, env)); }
        if (!diagnosticsState.model_loaded) diagnosticsState.status = payload.op === 'warmup' ? 'LOADING' : 'LOADING';
        const id = `kronos-${Date.now()}-${++sequence}`;
        const timeoutMs = Math.max(1000, Number(env.KRONOS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                pending.delete(id);
                const response = { ...unavailable('Kronos inference timeout', env), status: 'ERROR', error: 'KRONOS_TIMEOUT' };
                recordResult(response);
                resolve(response);
            }, timeoutMs);
            pending.set(id, { resolve, timer });
            try {
                processHandle.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
            } catch (error) {
                clearTimeout(timer);
                pending.delete(id);
                const response = unavailable(error.message, env);
                recordResult(response);
                resolve(response);
            }
        });
    }

    if (diagnosticsState.enabled && String(env.KRONOS_WARMUP || 'false').toLowerCase() === 'true') {
        setImmediate(() => {
            request({ op: 'warmup' }).then(result => {
                if (result.status !== 'OK') console.warn('[KRONOS]', result.error || 'warmup failed');
            });
        });
    }

    return { request, stop, diagnostics };
}

module.exports = { DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, configuredModel, kronosEnabled, defaultPythonPath, defaultOfficialRepoPath, createKronosWorker };
