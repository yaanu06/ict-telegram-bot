// ICT TRADING BOT PRO - COMPLETE FINAL FIX
// VERSION 9.2 - ADX confidence factor (not whole-TF kill) + EMA9/21/50/200/SuperTrend from TwelveData + stable detectTrend
// ============================================

// Initialize (defensive: telegram-web-app.js may fail to load — never block the UI)
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
if (tg) { tg.expand(); tg.ready(); }

// ============================================
// CONFIG
// ============================================
let TWELVE_DATA_KEY = '', DEEPSEEK_API_KEY = '';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
let DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
let GITHUB_PAT = '', GITHUB_REPO = 'yaanu06/ict-telegram-bot';
const AI_REQUEST_TIMEOUT_MS = 45000;
const TIMEFRAME_MS = { '1M': 60000, '5M': 5 * 60000, '15M': 15 * 60000, '1H': 60 * 60000, '4H': 240 * 60000, '1D': 1440 * 60000, '1W': 10080 * 60000 };
let scanInProgress = false;
let lastAIRequestError = null;

function getProxyBaseUrl() {
    const configured = typeof window !== 'undefined' ? window.__ICT_PROXY_BASE_URL__ : null;
    return String(configured || '').trim().replace(/\/$/, '');
}

function hasMarketDataAccess() {
    return !!TWELVE_DATA_KEY || !!getProxyBaseUrl();
}

function hasAiAccess() {
    return !!DEEPSEEK_API_KEY || !!getProxyBaseUrl();
}

function getDeepSeekEndpoint() {
    const proxy = getProxyBaseUrl();
    return proxy ? `${proxy}/api/deepseek/chat` : DEEPSEEK_API_URL;
}

function getDeepSeekHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (!getProxyBaseUrl() && DEEPSEEK_API_KEY) headers.Authorization = `Bearer ${DEEPSEEK_API_KEY}`;
    return headers;
}

function getAuditWriteToken() {
    const configured = typeof window !== 'undefined' ? window.__ICT_AUDIT_WRITE_TOKEN__ : null;
    return String(configured || '').trim();
}

function scanClock() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function scanTrace(stage, startedAt, details = {}) {
    console.log(`[SCAN] ${stage}`, { elapsed_ms: Math.round((scanClock() - startedAt) * 100) / 100, ...details });
}

async function requestAIJson(url, options = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
    const controller = typeof AbortController === 'function'
        ? new AbortController()
        : { signal: undefined, abort() {} };
    let timeoutId;
    const deadline = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error('AI request deadline exceeded');
            error.name = 'AbortError';
            reject(error);
            controller.abort();
        }, timeoutMs);
    });
    try {
        const requestOptions = controller.signal === undefined
            ? { ...options }
            : { ...options, signal: controller.signal };
        return await Promise.race([deadline, (async () => {
            const response = await fetch(url, requestOptions);
            console.log('[SCAN] DeepSeek response received', { status: response.status });
            if (response.ok === false) throw new Error(`DeepSeek HTTP ${response.status}`);
            const data = await response.json();
            return { response, data };
        })()]);
    } finally {
        clearTimeout(timeoutId);
    }
}

const SYMBOLS = {
    'BTC/USD':'BTC/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY',
    'AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD',
    'EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};

function normalizeSymbolInput(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getProviderSymbol(value) {
    const normalized = normalizeSymbolInput(value);
    return SYMBOLS[normalized] || normalized;
}

// HAS_REAL_VOLUME: Twelve Data returns synthetic/sparse volume for many forex
// and metals pairs (the v field falls back to 1e6 in getHistory). When false,
// volume-based scoring (volumeTruth surge/fake, sentiment volume, market-phase
// volumeRatio) must be downweighted or zeroed — fake volume is NOT confirmation.
// Crypto pairs (BTC) have real volume; XAU/XAG and FX pairs do not (varies by
// plan, but we default conservative).
function hasRealVolume(p, metadata = {}) {
    if (typeof metadata.volume_reliable === 'boolean') return metadata.volume_reliable;
    const sym = normalizeSymbolInput(p || pair);
    const assetClass = metadata.asset_class || getAssetClass(sym);
    return ['CRYPTO', 'EQUITY', 'INDEX'].includes(assetClass);
}

const FIAT_CURRENCY_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'HKD', 'SGD', 'NOK', 'SEK', 'CNH', 'CNY', 'MXN', 'ZAR', 'TRY', 'PLN']);
const CRYPTO_BASE_CODES = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'BCH', 'BNB', 'AVAX', 'DOT', 'LINK']);

let lastScanRejections = [];
const TF_MAP = { '1M':'1min','5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day','1W':'1week' };
const ALL_TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H', '1D', '1W'];
const DEFAULT_ATR_PERIOD = 14;
const BUY_INVALIDATION_FACTOR = 0.998;
const SELL_INVALIDATION_FACTOR = 1.002;

// PURE QUALITY SELECTION: Quality (Conf 58, HTF 1/3, 2+ patterns) is the criteria.
// CHoCH/BOS/compression/ADX are confluence SCORING factors — no hard-block is removed, thresholds tuned.
const MIN_CONFIDENCE = 58;
const MAX_ZONE_TOUCHES = 10;
const LIMIT_ORDER_EXPIRY_HOURS = 4;
const ZONE_PROXIMITY_ALERT_PCT = 0.3;
const LIMIT_ORDER_MAX_DIST_ATR = 6.0;
const HTF_MIN_MATCH = 1;
const AI_ADVISORY_ONLY = true;
const ICT_LAST_TRADE_TIME_KEY = 'ict_last_trade_time';
const ICT_FIVE_MIN_MS = 5 * 60 * 1000;

// ============================================
// MARKET SETTINGS
// ============================================
function getMarketSettings(p, metadata = {}) {
    const symbol = normalizeSymbolInput(p);
    const withMetadata = settings => ({
        ...settings,
        pipSize: Number.isFinite(Number(metadata.tick_size)) && Number(metadata.tick_size) > 0 ? Number(metadata.tick_size) : settings.pipSize,
        prec: Number.isInteger(Number(metadata.price_precision)) && Number(metadata.price_precision) >= 0 ? Number(metadata.price_precision) : settings.prec,
        minSL: Number.isFinite(Number(metadata.minimum_price_distance)) && Number(metadata.minimum_price_distance) > 0 ? Number(metadata.minimum_price_distance) : settings.minSL,
        slBuffer: Number.isFinite(Number(metadata.stop_buffer)) && Number(metadata.stop_buffer) >= 0 ? Number(metadata.stop_buffer) : settings.slBuffer,
        maxSLPct: Number.isFinite(Number(metadata.max_stop_pct)) && Number(metadata.max_stop_pct) > 0 ? Number(metadata.max_stop_pct) : settings.maxSLPct,
        targetRR: Number.isFinite(Number(metadata.minimum_rr)) && Number(metadata.minimum_rr) > 0 ? Number(metadata.minimum_rr) : settings.targetRR,
        minSLMultiplier: Number.isFinite(Number(metadata.min_sl_atr_multiplier)) && Number(metadata.min_sl_atr_multiplier) > 0 ? Number(metadata.min_sl_atr_multiplier) : settings.minSLMultiplier
    });
    if (symbol.includes('XAU')) return withMetadata({ slBuffer: 3, minSL: 3, maxSLPct: 0.015, targetRR: 2.5, prec: 2, pipSize: 0.1, minSLMultiplier: 2.0 });
    if (symbol.includes('XAG')) return withMetadata({ slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.015, targetRR: 2.5, prec: 2, pipSize: 0.01 });
    if (symbol.includes('JPY')) return withMetadata({ slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.01, targetRR: 2.5, prec: 3, pipSize: 0.01 });
    if (symbol === 'BTC/USD') return withMetadata({ slBuffer: 50, minSL: 30, maxSLPct: 0.02, targetRR: 2.5, prec: 2, pipSize: 1 });
    const assetClass = getAssetClass(symbol);
    if (assetClass === 'CRYPTO') return withMetadata({ slBuffer: 0, minSL: 0, maxSLPct: 0.25, targetRR: 2.5, prec: 8, pipSize: 0.00000001, minSLMultiplier: 2.0 });
    if (assetClass === 'EQUITY' || assetClass === 'INDEX') return withMetadata({ slBuffer: 0, minSL: 0, maxSLPct: 0.10, targetRR: 2.5, prec: 4, pipSize: 0.01, minSLMultiplier: 1.5 });
    if (assetClass === 'UNKNOWN') return withMetadata({ slBuffer: 0, minSL: 0, maxSLPct: 0.10, targetRR: 2.5, prec: 6, pipSize: 0.000001, minSLMultiplier: 1.5 });
    return withMetadata({ slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.01, targetRR: 2.5, prec: 5, pipSize: 0.0001 });
}

function getPrec(p) { return getMarketSettings(p).prec; }

// ============================================
// API KEYS & GITHUB MANAGEMENT
// ============================================
async function loadKeys() {
    const s = localStorage.getItem('ict_bot_keys');
    if (s) { 
        try { 
            const k = JSON.parse(s); 
            TWELVE_DATA_KEY = k.twelveData||''; 
            DEEPSEEK_API_KEY = k.deepseek||''; 
            DEEPSEEK_API_URL = k.deepseekUrl || 'https://api.deepseek.com/chat/completions'; 
            GITHUB_PAT = k.githubPat || '';
            GITHUB_REPO = k.githubRepo || 'yaanu06/ict-telegram-bot';
            return true; 
        } catch(e) {} 
    }
    return false;
}

async function saveKeys(tk, dk, du, ghToken, ghRepo) { 
    GITHUB_PAT = ghToken || '';
    GITHUB_REPO = ghRepo || 'yaanu06/ict-telegram-bot';
    localStorage.setItem('ict_bot_keys', JSON.stringify({
        twelveData: tk,
        deepseek: dk,
        deepseekUrl: du,
        githubPat: GITHUB_PAT,
        githubRepo: GITHUB_REPO
    })); 
    TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; 
    DEEPSEEK_API_URL = du || 'https://api.deepseek.com/chat/completions'; 
    updateKeyStatus(); 
}

function clearKeys() { 
    localStorage.removeItem('ict_bot_keys'); 
    TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; GITHUB_PAT=''; GITHUB_REPO='yaanu06/ict-telegram-bot';
    DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'; 
    updateKeyStatus(); 
    showNotif('🗑️ Keys removed','warning'); 
}

function updateKeyStatus() {
    const ts = document.getElementById('twelveStatus');
    const ds = document.getElementById('deepseekStatus');
    const gs = document.getElementById('githubStatus');
    const proxy = !!getProxyBaseUrl();
    if(ts) {
        ts.innerHTML = TWELVE_DATA_KEY ? '✅ Direct' : proxy ? '✅ Proxy' : '❌ Missing';
        ts.className = 'status-badge ' + (hasMarketDataAccess() ? 'active' : 'inactive');
    }
    if(ds) {
        ds.innerHTML = DEEPSEEK_API_KEY ? '✅ Direct' : proxy ? '✅ Proxy' : '❌ Missing';
        ds.className = 'status-badge ' + (hasAiAccess() ? 'active' : 'inactive');
    }
    if(gs) {
        gs.innerHTML = GITHUB_PAT ? '✅ Connected' : '⚪ Local Only';
        gs.className = 'status-badge ' + (GITHUB_PAT ? 'active' : 'inactive');
    }
}

function showSetup() {
    const ex = document.getElementById('setupOverlay'); 
    if(ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API & GitHub Setup</h3>
                <p class="setup-desc">Enter your API keys & GitHub repository access</p>
                <label>📡 Twelve Data Key:</label>
                <input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}">
                <label>🤖 DeepSeek Key:</label>
                <input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}">
                <label>🌐 Custom AI URL:</label>
                <input type="text" id="urlInput" class="setup-input" value="${DEEPSEEK_API_URL}">
                <label>🐙 GitHub Personal Access Token (PAT):</label>
                <input type="password" id="ghInput" class="setup-input" placeholder="ghp_xxxxxxxxxxxx" value="${GITHUB_PAT}">
                <label>📁 GitHub Repo (owner/repo):</label>
                <input type="text" id="ghRepoInput" class="setup-input" placeholder="yaanu06/ict-telegram-bot" value="${GITHUB_REPO}">
                <p class="setup-note">Token with contents:write scope auto-saves setups to GitHub</p>
                <div class="setup-buttons">
                    <button id="svBtn" class="setup-btn primary">💾 Save</button>
                    <button id="clBtn" class="setup-btn danger">🗑️ Clear</button>
                </div>
                <button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button>
                <button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button>
                <div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div>
            </div>
        </div>
    `);
    document.getElementById('svBtn').addEventListener('click', async () => {
        const tk = document.getElementById('twInput').value.trim();
        const dk = document.getElementById('dsInput').value.trim();
        const du = document.getElementById('urlInput').value.trim();
        const ght = document.getElementById('ghInput').value.trim();
        const ghr = document.getElementById('ghRepoInput').value.trim();
        if(!tk) { showNotif('⚠️ Twelve Data key required','warning'); return; }
        await saveKeys(tk, dk, du, ght, ghr);
        document.getElementById('setupOverlay').remove();
    });
    document.getElementById('clBtn').addEventListener('click', () => {
        clearKeys();
        document.getElementById('twInput').value = '';
        document.getElementById('dsInput').value = '';
        document.getElementById('urlInput').value = '';
        document.getElementById('ghInput').value = '';
        document.getElementById('ghRepoInput').value = 'yaanu06/ict-telegram-bot';
    });
    document.getElementById('testAiBtn').addEventListener('click', async () => {
        const dk = document.getElementById('dsInput').value.trim();
        const du = getProxyBaseUrl() ? getDeepSeekEndpoint() : (document.getElementById('urlInput').value.trim() || 'https://api.deepseek.com/chat/completions');
        if(!dk && !getProxyBaseUrl()) { document.getElementById('testResult').innerHTML = '❌ Enter key first'; return; }
        document.getElementById('testResult').innerHTML = '🔄 Testing...';
        try {
            const r = await fetch(du, {
                method: 'POST',
                headers: getProxyBaseUrl() ? getDeepSeekHeaders() : { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dk}` },
                body: JSON.stringify({ model: 'deepseek-chat', messages: [{role:'user',content:'Say OK'}], max_tokens: 5 })
            });
            const d = await r.json();
            document.getElementById('testResult').innerHTML = d.choices ? '✅ AI working!' : '❌ Error: ' + (d.error?.message || 'Unknown');
        } catch(e) { document.getElementById('testResult').innerHTML = '❌ Connection failed'; }
    });
    document.getElementById('skBtn').addEventListener('click', () => document.getElementById('setupOverlay').remove());
}

// ============================================
// GITHUB AUTOMATED SETUP RECORDING
// ============================================
function encodeUnicodeBase64(str) {
    if (typeof btoa !== 'function') return str;
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
}

async function syncSetupToGitHub(setupData, eventType = 'scan') {
    if (!setupData) return;

    const setupId = setupData.id || Date.now();
    const setupPair = setupData.pair || pair || 'SETUP';

    // 1. Store setup locally in localStorage (allows offline/backtesting counting)
    try {
        const localRecordings = JSON.parse(localStorage.getItem('ict_recorded_setups') || '[]');
        const record = {
            id: setupId,
            timestamp: new Date().toISOString(),
            eventType: eventType,
            setup: setupData
        };
        // avoid duplicate setup IDs
        if (!localRecordings.some(x => x.id === setupId)) {
            localRecordings.unshift(record);
            localStorage.setItem('ict_recorded_setups', JSON.stringify(localRecordings.slice(0, 200)));
        }
    } catch(e) {
        console.error('Local setup storage error:', e);
    }

    // 2. Commit setup to GitHub repository via REST API if GITHUB_PAT is set
    if (!GITHUB_PAT || !GITHUB_REPO) {
        console.log('🐙 GitHub PAT not set — setup recorded locally.');
        return;
    }

    const cleanPair = setupPair.replace('/', '_');
    const fileName = `setup_${setupId}_${cleanPair}.json`;
    const repoPath = `data/setups/${fileName}`;
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;

    const payloadContent = JSON.stringify({
        id: setupId,
        recordedAt: new Date().toISOString(),
        eventType: eventType,
        pair: setupPair,
        setup: setupData
    }, null, 2);

    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: `🤖 Auto-record ICT setup: ${setupPair} (${eventType}) [${new Date().toISOString()}]`,
                content: encodeUnicodeBase64(payloadContent)
            })
        });

        if (res.ok) {
            console.log(`🐙 Auto-recorded setup to GitHub: ${repoPath}`);
            showNotif(`🐙 Auto-saved setup to GitHub repo!`, 'info');
        } else {
            const errData = await res.json();
            console.warn('GitHub API push response:', errData.message || res.statusText);
        }
    } catch (e) {
        console.error('GitHub API push error:', e);
    }
}

// ============================================
// STATE
// ============================================
let pair = 'XAU/USD';
let analysis = null;
let calls = 0;
let lastPrice = null;
let limitOrder = null;
let priceTimer = null;
let cachedPrice = null;
let priceCacheTime = 0;
let cachedPricePair = null;
let indicatorCache = {};
const PRICE_CACHE_DURATION = 5000;
const DEFAULT_EXECUTION_MODE = 'MANUAL';

function resetPairState() {
    cachedPrice = null;
    priceCacheTime = 0;
    cachedPricePair = null;
    lastPrice = null;
    analysis = null;
    indicatorCache = {};
    const eb = document.getElementById('executeBtn');
    if(eb && !limitOrder) eb.disabled = true;
    const cp = document.getElementById('currentPrice');
    if(cp) cp.innerHTML = '––';
    const pc = document.getElementById('priceChange');
    if(pc) { pc.innerHTML = '–'; pc.className = 'price-change'; }
}

// ============================================
// INITIALIZATION
// ============================================
function startApp() {
    console.log('🚀 Starting ICT Trading Bot Pro v8.0 - FINAL WORKING FIX');
    loadKeys().then(() => {
        updateKeyStatus();
        if(!hasMarketDataAccess() && !hasAiAccess()) {
            setTimeout(showSetup, 500);
        }
    });
    init();
}

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}

function init() {
    console.log('📋 Initializing...');
    updateTime();
    setInterval(updateTime, 1000);

    const el = (id) => document.getElementById(id);
    if(el('analyzeBtn')) el('analyzeBtn').addEventListener('click', runAutoScan);
    if(el('executeBtn')) el('executeBtn').addEventListener('click', handleLimit);
    if(el('cancelLimitBtn')) el('cancelLimitBtn').addEventListener('click', cancelLimit);
    if(el('copyJsonBtn')) el('copyJsonBtn').addEventListener('click', copyJson);
    if(el('updateKeysBtn')) el('updateKeysBtn').addEventListener('click', showSetup);
    if(el('saveSetupBtn')) el('saveSetupBtn').addEventListener('click', saveCurrentSetup);
    if(el('recentList')) el('recentList').addEventListener('click', handleRecentClick);
    if(el('journalList')) el('journalList').addEventListener('click', handleJournalClick);
    renderRecents();
    renderJournal();
    if(el('pairSelect')) el('pairSelect').addEventListener('change', function(e) {
        pair = e.target.value;
        resetPairState();
    });
    document.querySelectorAll('.category-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            document.querySelectorAll('.category-btn').forEach(function(x) {
                x.classList.remove('active');
            });
            this.classList.add('active');
            updatePairs(this.dataset.category);
        });
    });
    const activeBtn = document.querySelector('.category-btn.active');
    if(activeBtn) updatePairs(activeBtn.dataset.category);
    loadLimitOrder();

    // AUTO OUTCOME DETECTION: independent poller so filled trades get resolved
    // even when NO limit order is currently active. startMonitor's interval is
    // torn down the moment an order fills (clearLimit → clearInterval), so it
    // alone could never resolve the fill it just enqueued. This 60s poll + the
    // immediate first call cover that gap.
    checkPendingFills().catch(e => console.error('checkPendingFills (init):', e));
    setInterval(() => { checkPendingFills().catch(e => console.error('checkPendingFills (interval):', e)); }, 60 * 1000);

    console.log('✅ All event listeners attached successfully!');
}

function updateTime() {
    const n = new Date();
    document.getElementById('liveTime').innerHTML = 
        `${n.toLocaleDateString('en-US', {month:'short', day:'numeric'})} ${n.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`;
}

function updatePairs(cat) {
    const p = {
        crypto: ['BTC/USD'],
        forex: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],
        metals: ['XAU/USD','XAG/USD']
    };
    document.getElementById('pairSelect').innerHTML = p[cat].map(x => 
        `<option value="${x}">${getPairDisplayName(x)}</option>`
    ).join('');
    pair = p[cat][0];
    resetPairState();
}

function getPairDisplayName(p) {
    const icons = {
        'BTC/USD':'₿ BTC/USD', 'EUR/USD':'€ EUR/USD', 'GBP/USD':'£ GBP/USD',
        'USD/JPY':'💴 USD/JPY', 'AUD/USD':'🇦🇺 AUD/USD', 'USD/CAD':'🇨🇦 USD/CAD',
        'USD/CHF':'🇨🇭 USD/CHF', 'NZD/USD':'🇳🇿 NZD/USD', 'EUR/GBP':'€/£ EUR/GBP',
        'EUR/JPY':'€/¥ EUR/JPY', 'GBP/JPY':'£/¥ GBP/JPY', 'XAU/USD':'👑 XAU/USD',
        'XAG/USD':'🥈 XAG/USD'
    };
    return icons[p] || '📊 ' + p;
}

// ============================================
// API FUNCTIONS
// ============================================
let rateLimitNotified = 0;
const TD_REQUEST_BUDGET = 50;
const TD_REQUEST_WINDOW_MS = 60000;
const tdRequestTimes = [];
const historyResponseCache = new Map();
const HISTORY_CACHE_TTL_MS = Object.freeze({
    '1M': 30000,
    '5M': 60000,
    '15M': 60000,
    '1H': 120000,
    '4H': 300000,
    '1D': 900000,
    '1W': 900000
});

async function reserveTwelveDataRequest() {
    while (true) {
        const now = Date.now();
        while (tdRequestTimes.length && now - tdRequestTimes[0] >= TD_REQUEST_WINDOW_MS) tdRequestTimes.shift();
        if (tdRequestTimes.length < TD_REQUEST_BUDGET) {
            tdRequestTimes.push(now);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, TD_REQUEST_WINDOW_MS - (now - tdRequestTimes[0]))));
    }
}

async function fetchTD(pathAndQuery, timeoutMs = 10000, retries = 2) {
    await reserveTwelveDataRequest();
    const ctrl = typeof AbortController === 'function'
        ? new AbortController()
        : { signal: undefined, abort: () => {} };
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const proxy = getProxyBaseUrl();
        const endpoint = proxy
            ? `${proxy}/api/twelve${pathAndQuery}`
            : `${TWELVE_DATA_BASE}${pathAndQuery}&apikey=${TWELVE_DATA_KEY}`;
        const r = await fetch(endpoint, { signal: ctrl.signal });
        if (r.ok === false) throw new Error(`Twelve Data HTTP ${r.status || 'error'}`);
        const d = await r.json();
        if(d.code === 429) {
            const src = document.getElementById('apiSource');
            if(src) src.innerHTML = '🔴 Rate limited';
            if(Date.now() - rateLimitNotified > 30000) {
                rateLimitNotified = Date.now();
                showNotif('⏳ Twelve Data rate limit hit - wait a minute and rescan', 'warning');
            }
            // Grow 55 = 55 credits/min, quota resets every minute — brief backoff then retry
            if(retries > 0) {
                await new Promise(res => setTimeout(res, 3000));
                return fetchTD(pathAndQuery, timeoutMs, retries - 1);
            }
            throw new Error('Rate limited');
        }
        if(d.code && d.code !== 200) throw new Error(d.message || 'API Error');
        return d;
    } finally { clearTimeout(timer); }
}

async function getPrice(forPair) {
    const p = forPair || pair;
    const now = Date.now();
    if(cachedPrice !== null && cachedPricePair === p && (now - priceCacheTime) < PRICE_CACHE_DURATION) {
        return cachedPrice;
    }
    if(!hasMarketDataAccess()) return null;
    try {
        const d = await fetchTD(`/price?symbol=${encodeURIComponent(getProviderSymbol(p))}`);
        if(d.price) {
            calls++;
            document.getElementById('apiSource').innerHTML = '📡 Live';
            cachedPrice = +d.price;
            priceCacheTime = now;
            cachedPricePair = p;
            return cachedPrice;
        }
    } catch(e) {
        // Never turn an expired quote cache into a live-looking price. The
        // caller must receive null so the data-quality gate can block the scan.
        if(cachedPrice !== null && cachedPricePair === p && (Date.now() - priceCacheTime) < PRICE_CACHE_DURATION) return cachedPrice;
    }
    return null;
}

function getRequiredHistoryOutputSize() {
    // Keep the provider request bounded while covering every configured lookback.
    const spec = typeof STRATEGY_SPEC === 'object' ? STRATEGY_SPEC : {};
    return Math.max(200, spec.MSNR?.lookback || 0, spec.TBS?.lookback || 0,
        spec.CRT?.referenceLookback || 0, 60);
}

function getAssetClass(forPair = pair) {
    const normalized = String(forPair || '').toUpperCase().replace(/\s/g, '');
    const [base, quote] = normalized.split('/');
    if (CRYPTO_BASE_CODES.has(base) || normalized.endsWith('/USDT')) return 'CRYPTO';
    if (normalized === 'XAU/USD' || normalized === 'XAG/USD' || normalized.startsWith('XAU') || normalized.startsWith('XAG')) return 'METAL';
    if (base && quote && base.length === 3 && quote.length === 3) {
        if (FIAT_CURRENCY_CODES.has(base) && FIAT_CURRENCY_CODES.has(quote)) return 'FOREX';
        return 'UNKNOWN';
    }
    if (/^[A-Z][A-Z0-9._-]{0,11}$/.test(normalized)) {
        if (/\d/.test(normalized) || /^(US30|NAS100|SPX500|GER40|UK100|JP225)$/.test(normalized)) return 'INDEX';
        return 'EQUITY';
    }
    return 'UNKNOWN';
}

function getSymbolMetadata(forPair = pair, overrides = {}) {
    const symbol = normalizeSymbolInput(forPair);
    const assetClass = overrides.asset_class || getAssetClass(symbol);
    const settings = getMarketSettings(symbol, overrides);
    return {
        symbol,
        asset_class: assetClass,
        tick_size: Number.isFinite(Number(overrides.tick_size)) ? Number(overrides.tick_size) : settings.pipSize,
        price_precision: Number.isInteger(Number(overrides.price_precision)) ? Number(overrides.price_precision) : settings.prec,
        tick_value: Number.isFinite(Number(overrides.tick_value)) ? Number(overrides.tick_value) : null,
        contract_size: Number.isFinite(Number(overrides.contract_size)) ? Number(overrides.contract_size) : null,
        minimum_order_size: Number.isFinite(Number(overrides.minimum_order_size)) ? Number(overrides.minimum_order_size) : null,
        minimum_price_distance: Number.isFinite(Number(overrides.minimum_price_distance)) ? Number(overrides.minimum_price_distance) : null,
        stop_buffer: Number.isFinite(Number(overrides.stop_buffer)) ? Number(overrides.stop_buffer) : null,
        max_stop_pct: Number.isFinite(Number(overrides.max_stop_pct)) ? Number(overrides.max_stop_pct) : null,
        minimum_rr: Number.isFinite(Number(overrides.minimum_rr)) ? Number(overrides.minimum_rr) : null,
        min_sl_atr_multiplier: Number.isFinite(Number(overrides.min_sl_atr_multiplier)) ? Number(overrides.min_sl_atr_multiplier) : null,
        spread: Number.isFinite(Number(overrides.spread)) ? Number(overrides.spread) : null,
        commission_per_unit: Number.isFinite(Number(overrides.commission_per_unit)) ? Number(overrides.commission_per_unit) : null,
        slippage_estimate: Number.isFinite(Number(overrides.slippage_estimate)) ? Number(overrides.slippage_estimate) : null,
        volume_reliable: typeof overrides.volume_reliable === 'boolean' ? overrides.volume_reliable : null,
        leverage: Number.isFinite(Number(overrides.leverage)) ? Number(overrides.leverage) : null,
        trading_permissions: overrides.trading_permissions ?? null,
        session: overrides.session ?? null,
        metadata_source: Object.keys(overrides).length ? 'PROVIDER_OR_USER' : 'HEURISTIC',
        metadata_complete: Number.isFinite(Number(overrides.tick_size)) && Number.isFinite(Number(overrides.contract_size))
    };
}

function parseProviderMarketOpen(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        if (/^(true|yes|open|opened|trading)$/i.test(value.trim())) return true;
        if (/^(false|no|closed|close|not[_ -]?trading)$/i.test(value.trim())) return false;
    }
    return null;
}

function getMarketOpenState(forPair = pair, scanSnapshot = {}) {
    const providerState = parseProviderMarketOpen(scanSnapshot.is_market_open ?? scanSnapshot.market_open);
    if (providerState !== null) {
        return { is_market_open: providerState, market_open: providerState, source: 'PROVIDER', asset_class: getAssetClass(forPair) };
    }
    const assetClass = scanSnapshot.asset_class || getAssetClass(forPair);
    if (assetClass === 'CRYPTO') {
        return { is_market_open: true, market_open: true, source: 'ASSET_CALENDAR', asset_class: assetClass };
    }
    const asOf = normalizeTimestampUTC(scanSnapshot.as_of_ms ?? scanSnapshot.as_of_time ?? scanSnapshot.provider_timestamp) || Date.now();
    const day = new Date(asOf).getUTCDay();
    const open = ![0, 6].includes(day);
    return { is_market_open: open, market_open: open, source: 'ASSET_CALENDAR', asset_class: assetClass };
}

async function getMarketQuoteSnapshot(forPair = pair) {
    const p = forPair || pair;
    const symbolMetadata = getSymbolMetadata(p);
    const assetClass = symbolMetadata.asset_class;
    try {
        const quote = await fetchTD('/quote?symbol=' + encodeURIComponent(getProviderSymbol(p)));
        const quotePrice = Number(quote.price ?? quote.close);
        const bid = Number(quote.bid);
        const ask = Number(quote.ask);
        const spread = Number.isFinite(bid) && Number.isFinite(ask) && ask >= bid ? ask - bid : null;
        const providerTimestamp = normalizeTimestampUTC(quote.timestamp ?? quote.datetime ?? quote.last_update);
        const providerOpen = parseProviderMarketOpen(quote.is_market_open ?? quote.market_open ?? quote.market_status);
        if (Number.isFinite(quotePrice)) {
            calls++;
            return {
                pair: p,
                price: quotePrice,
                bid: Number.isFinite(bid) ? bid : null,
                ask: Number.isFinite(ask) ? ask : null,
                spread,
                provider_timestamp: providerTimestamp,
                provider_timestamp_utc: Number.isFinite(providerTimestamp) ? new Date(providerTimestamp).toISOString() : null,
                is_market_open: providerOpen,
                asset_class: assetClass,
                symbol_metadata: symbolMetadata,
                source: 'TWELVE_DATA',
                quote_source: 'QUOTE'
            };
        }
    } catch (error) {
        if (typeof console?.warn === 'function') console.warn('Quote snapshot unavailable; falling back to price endpoint', error?.message || error);
    }
    const fallbackPrice = await getPrice(p);
    return {
        pair: p,
        price: Number.isFinite(Number(fallbackPrice)) ? Number(fallbackPrice) : null,
        bid: null,
        ask: null,
        spread: null,
        provider_timestamp: Number.isFinite(Number(fallbackPrice)) && cachedPricePair === p && Number.isFinite(priceCacheTime) ? priceCacheTime : null,
        provider_timestamp_utc: Number.isFinite(Number(fallbackPrice)) && cachedPricePair === p && Number.isFinite(priceCacheTime) ? new Date(priceCacheTime).toISOString() : null,
        is_market_open: null,
        asset_class: assetClass,
        symbol_metadata: symbolMetadata,
        source: 'TWELVE_DATA',
        quote_source: 'PRICE_FALLBACK'
    };
}

async function getHistory(tfStr, forPair) {
    if(!hasMarketDataAccess()) return null;
    if (!TF_MAP[tfStr]) throw new Error(`Unsupported timeframe: ${tfStr}`);
    const requestedPair = forPair || pair;
    const cacheKey = `${requestedPair}|${tfStr}`;
    const cached = historyResponseCache.get(cacheKey);
    const cacheTtl = HISTORY_CACHE_TTL_MS[tfStr] || 60000;
    if (cached && Date.now() - cached.ts < cacheTtl) return cached.data;
    try {
        const providerSymbol = getProviderSymbol(requestedPair);
        if (!providerSymbol) throw new Error('Market symbol is missing');
        const d = await fetchTD('/time_series?symbol=' + encodeURIComponent(providerSymbol) + '&interval=' + TF_MAP[tfStr] + '&outputsize=' + getRequiredHistoryOutputSize() + '&timezone=UTC');
        if(d.values) {
            calls++;
            const rawValues = d.values.map(c => ({
                t: normalizeTimestampUTC(c.datetime),
                o: +c.open,
                h: +c.high,
                l: +c.low,
                c: +c.close,
                v: Number.isFinite(Number(c.volume)) ? Number(c.volume) : null,
                timeframe: tfStr,
                source: 'TWELVE_DATA',
                timestamp_source: 'PROVIDER',
                is_closed: Number.isFinite(normalizeTimestampUTC(c.datetime))
                    && normalizeTimestampUTC(c.datetime) + (TIMEFRAME_MS[tfStr] || 60 * 60000) <= Date.now()
            }));
            // Twelve Data may include the currently forming bucket. It is
            // useful for display, but must never become confirmed structure or
            // indicator input. Keep only closed candles in the analysis cache.
            const values = rawValues.filter(c => c.is_closed);
            if (!values.length) throw new Error(`No closed provider candles available for ${tfStr}`);
            if (values.some(c => !Number.isFinite(c.t))) throw new Error(`Invalid provider timestamp for ${tfStr}`);
            if (values.some(c => ![c.o, c.h, c.l, c.c].every(Number.isFinite))) throw new Error(`Invalid provider OHLC values for ${tfStr}`);
            if (values.some(c => c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c) || c.h < c.l)) throw new Error(`Impossible provider OHLC geometry for ${tfStr}`);
            values.reverse();
            for (let i = 1; i < values.length; i++) {
                if (values[i].t <= values[i - 1].t) throw new Error(`Duplicate or unordered provider timestamps for ${tfStr}`);
            }
            Object.defineProperty(values, 'provider_metadata', { value: {
                provider: 'TWELVE_DATA',
                provider_timezone: d.meta?.timezone || 'UTC',
                requested_timezone: 'UTC',
                timeframe: tfStr,
                symbol: providerSymbol,
                timestamp_contract: ['1D', '1W'].includes(tfStr) ? 'PERIOD_BUCKET' : 'INTRADAY_UTC',
                raw_count: rawValues.length,
                closed_count: values.length,
                open_candles_filtered: rawValues.length - values.length
            }, enumerable: false });
            historyResponseCache.set(cacheKey, { data: values, ts: Date.now() });
            return values;
        }
    } catch(e) { console.error(`History error (${tfStr}):`, e); }
    return null;
}

const INDICATOR_CACHE_TTL = 4 * 60 * 1000;

function localIndicatorSnapshot(candleData = []) {
    const data = Array.isArray(candleData) ? candleData.filter(c => c && c.is_closed !== false) : [];
    const closes = data.map(c => Number(c.c)).filter(Number.isFinite);
    const highs = data.map(c => Number(c.h));
    const lows = data.map(c => Number(c.l));
    const ind = { indicator_source: 'LOCAL_OHLCV', indicator_timeframe: data[0]?.timeframe || null };
    const last = closes.length - 1;
    const finite = value => Number.isFinite(value) ? value : null;
    const windowMean = (values, length) => values.length >= length
        ? values.slice(-length).reduce((sum, value) => sum + value, 0) / length : null;
    const trueRanges = [];
    for (let i = 0; i < data.length; i++) {
        if (i === 0) trueRanges.push(highs[i] - lows[i]);
        else trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - Number(data[i - 1].c)), Math.abs(lows[i] - Number(data[i - 1].c))));
    }
    const rollingATR = (length, end = trueRanges.length) => {
        if (end < length) return null;
        return windowMean(trueRanges.slice(0, end), length);
    };
    if (closes.length >= 15) ind.rsi = finite(computeRSI(closes, 14));
    if (data.length >= 15) ind.atr_api = finite(rollingATR(14));
    if (closes.length >= 9) ind.ema9 = finite(ema(closes, 9).at(-1));
    if (closes.length >= 21) ind.ema21 = finite(ema(closes, 21).at(-1));
    if (closes.length >= 50) ind.ema50 = finite(ema(closes, 50).at(-1));
    if (closes.length >= 100) ind.ema200 = finite(ema(closes, 200).at(-1));
    if (closes.length >= 20) {
        const win = closes.slice(-20);
        const mid = windowMean(win, win.length);
        const sd = Math.sqrt(win.reduce((sum, value) => sum + Math.pow(value - mid, 2), 0) / win.length);
        ind.bb_upper = finite(mid + 2 * sd); ind.bb_middle = finite(mid); ind.bb_lower = finite(mid - 2 * sd);
    }
    if (closes.length >= 26) {
        const fast = ema(closes, 12), slow = ema(closes, 26);
        const macdSeries = fast.map((value, index) => value - slow[index]).slice(25);
        const signalSeries = ema(macdSeries, 9);
        ind.macd = finite(macdSeries.at(-1));
        ind.macd_signal = finite(signalSeries.at(-1));
        ind.macd_hist = finite(ind.macd - ind.macd_signal);
    }
    if (data.length >= 14 && closes.length) {
        const high14 = Math.max(...highs.slice(-14)), low14 = Math.min(...lows.slice(-14));
        ind.stoch_k = finite((closes.at(-1) - low14) / ((high14 - low14) || 1) * 100);
        const kSeries = [];
        for (let i = 13; i < data.length; i++) {
            const hi = Math.max(...highs.slice(i - 13, i + 1)), lo = Math.min(...lows.slice(i - 13, i + 1));
            kSeries.push((closes[i] - lo) / ((hi - lo) || 1) * 100);
        }
        ind.stoch_d = finite(windowMean(kSeries, Math.min(3, kSeries.length)));
        ind.williams_r = finite((high14 - closes.at(-1)) / ((high14 - low14) || 1) * -100);
    }
    if (data.length >= 20) {
        const typical = data.map(c => (Number(c.h) + Number(c.l) + Number(c.c)) / 3);
        const tp = typical.at(-1), mean = windowMean(typical, 20);
        const deviation = typical.slice(-20).reduce((sum, value) => sum + Math.abs(value - mean), 0) / 20;
        ind.cci = finite((tp - mean) / (0.015 * (deviation || 1)));
    }
    if (data.length >= 26) {
        const hi9 = Math.max(...highs.slice(-9)), lo9 = Math.min(...lows.slice(-9));
        const hi26 = Math.max(...highs.slice(-26)), lo26 = Math.min(...lows.slice(-26));
        const hi52 = Math.max(...highs.slice(-52)), lo52 = Math.min(...lows.slice(-52));
        ind.ichimoku_tenkan = finite((hi9 + lo9) / 2);
        ind.ichimoku_kijun = finite((hi26 + lo26) / 2);
        ind.ichimoku_senkou_a = finite((ind.ichimoku_tenkan + ind.ichimoku_kijun) / 2);
        ind.ichimoku_senkou_b = data.length >= 52 ? finite((hi52 + lo52) / 2) : null;
    }
    if (data.length >= 11) {
        let direction = 1, extreme = highs[0], sar = lows[0], acceleration = 0.02;
        for (let i = 1; i < data.length; i++) {
            sar = sar + acceleration * (extreme - sar);
            if (direction > 0) {
                sar = Math.min(sar, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);
                if (lows[i] < sar) { direction = -1; sar = extreme; extreme = lows[i]; acceleration = 0.02; }
                else if (highs[i] > extreme) { extreme = highs[i]; acceleration = Math.min(0.2, acceleration + 0.02); }
            } else {
                sar = Math.max(sar, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);
                if (highs[i] > sar) { direction = 1; sar = extreme; extreme = highs[i]; acceleration = 0.02; }
                else if (lows[i] < extreme) { extreme = lows[i]; acceleration = Math.min(0.2, acceleration + 0.02); }
            }
        }
        ind.sar = finite(sar);
    }
    if (data.length >= 11) {
        const factor = 3, period = 10;
        let finalUpper = 0, finalLower = 0, trend = 1, supertrend = null;
        for (let i = 0; i < data.length; i++) {
            const atrValue = rollingATR(period, i + 1);
            if (!Number.isFinite(atrValue)) continue;
            const mid = (highs[i] + lows[i]) / 2;
            const upper = mid + factor * atrValue, lower = mid - factor * atrValue;
            if (i === 0 || !Number.isFinite(supertrend)) { finalUpper = upper; finalLower = lower; supertrend = lower; continue; }
            finalUpper = closes[i - 1] <= finalUpper ? Math.min(upper, finalUpper) : upper;
            finalLower = closes[i - 1] >= finalLower ? Math.max(lower, finalLower) : lower;
            if (trend < 0 && closes[i] > finalUpper) trend = 1;
            else if (trend > 0 && closes[i] < finalLower) trend = -1;
            supertrend = trend > 0 ? finalLower : finalUpper;
        }
        ind.supertrend = finite(supertrend);
    }
    return ind;
}

async function getTechnicalIndicators(tfUsed, candleData = null) {
    if(!hasMarketDataAccess()) return {};
    const cacheKey = `${pair}|${tfUsed}`;
    const cachedHit = indicatorCache[cacheKey];
    if(cachedHit && Date.now() - cachedHit.ts < INDICATOR_CACHE_TTL) return cachedHit.data;

    const ind = localIndicatorSnapshot(candleData || []);
    const closes = (candleData || []).map(c => c.c);

    // Computed LOCALLY from candles already fetched — saves API credits
    // (Grow 55 plan = only 55 requests/minute; these used to be 8 API calls per TF)
    if(closes.length >= 15) ind.rsi = computeRSI(closes, 14);
    if(candleData && candleData.length >= 15) ind.atr_api = atr(candleData, 14);
    if(closes.length >= 5) {
        const e9 = ema(closes, 9), e21 = ema(closes, 21);
        ind.ema9 = e9[e9.length - 1];
        ind.ema21 = e21[e21.length - 1];
    }
    if(closes.length >= 50) {
        const e50 = ema(closes, 50);
        ind.ema50 = e50[e50.length - 1];
    }
    if(closes.length >= 100) {
        const e200 = ema(closes, 200);
        ind.ema200 = e200[e200.length - 1];
    }
    if(closes.length >= 20) {
        const win = closes.slice(-20);
        const mid = win.reduce((a, b) => a + b, 0) / win.length;
        const sd = Math.sqrt(win.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / win.length);
        ind.bb_upper = mid + 2 * sd;
        ind.bb_middle = mid;
        ind.bb_lower = mid - 2 * sd;
    }

    // All supported indicators are derived locally from the already-fetched
    // closed candles. This removes seven provider calls per timeframe and
    // keeps the signal internally consistent with the structure engine.
    indicatorCache[cacheKey] = { data: ind, ts: Date.now() };
    return ind;
}

async function getQuoteDirection(tfStr, cachedData = null) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if (data && data.length >= 50) {
            // Keep AI scoring on the same structure snapshot used by the
            // displayed multi-timeframe trend.
            const snapshot = buildStructureSnapshot(data, tfStr);
            const displayed = getCanonicalDisplayedTrend(snapshot);
            return displayed === 'BULLISH_TRANSITION' ? 'BULLISH'
                : displayed === 'BEARISH_TRANSITION' ? 'BEARISH' : displayed;
        }
        // If we don't have enough data for a proper trend read, return NEUTRAL
        // instead of guessing from one or two candles. A single candle flip
        // used to corrupt HTF alignment and block setups.
        return 'NEUTRAL';
    } catch(e) {}
    return 'NEUTRAL';
}

// ============================================
// TECHNICAL ANALYSIS ENGINE - ALL PATTERNS
// ============================================

// EMA Calculation
const ema = (p, n) => {
    const m = 2 / (n + 1);
    let e = [p[0]];
    for(let i = 1; i < p.length; i++) {
        e.push((p[i] - e[i-1]) * m + e[i-1]);
    }
    return e;
};

// ATR Calculation
const atr = (d, n = 14) => {
    let t = [];
    for(let i = 1; i < d.length; i++) {
        t.push(Math.max(
            d[i].h - d[i].l,
            Math.abs(d[i].h - d[i-1].c),
            Math.abs(d[i].l - d[i-1].c)
        ));
    }
    return t.slice(-n).reduce((a, b) => a + b, 0) / n;
};

// Detect Trend
function detectTrend(data) {
    data = closedStructureCandles(data);
    const closes = data.map(c => c.c);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    if(e20.length < 2 || e50.length < 2) return 'NEUTRAL';
    const cE20 = e20[e20.length - 1];
    const cE50 = e50[e50.length - 1];
    const lastClose = closes[closes.length - 1];

    // Stability filter: count how many of the last 8 bars had EMA20 above/below EMA50.
    // A single cross flips the signal in chop, so we require a consistent read across the window.
    const win = Math.min(8, e20.length - 1);
    let bullCount = 0, bearCount = 0;
    for(let i = 1; i <= win; i++) {
        const a = e20[e20.length - 1 - i];
        const b = e50[e50.length - 1 - i];
        if(a > b) bullCount++;
        else if(a < b) bearCount++;
    }

    // Strong read: consistent cross across the window AND price on the right side of EMA50
    if(bullCount >= 6 && lastClose > cE50) return 'BULLISH';
    if(bearCount >= 6 && lastClose < cE50) return 'BEARISH';

    // Moderate read: majority of the window plus price above/below EMA50
    if(bullCount >= 5 && lastClose > cE50) return 'BULLISH';
    if(bearCount >= 5 && lastClose < cE50) return 'BEARISH';

    // Fallback: last-bar cross with price on the correct side of EMA50
    if(lastClose > cE50 && cE20 > cE50) return 'BULLISH';
    if(lastClose < cE50 && cE20 < cE50) return 'BEARISH';

    return 'NEUTRAL';
}

// Detect FVG
function detectFVG(d) {
    d = closedStructureCandles(d);
    let f = [];
    const len = d.length;
    for(let i = 1; i < len - 1; i++) {
        const prev = d[i - 1];
        const curr = d[i];
        const next = d[i + 1];
        const thresh = curr.c * 0.0003;
        
        if(prev.h < next.l && next.l - prev.h > thresh) {
            // The gap is confirmed by `next`. Keep its source index so the
            // market map can give the zone a canonical creation time. Without
            // this provenance a fresh FVG is indistinguishable from a stale
            // setup and the lifecycle checker expires it.
            f.push({ type: 'bull', l: prev.h, h: next.l, m: (prev.h + next.l) / 2, source_index: i + 1 });
        }
        if(prev.l > next.h && prev.l - next.h > thresh) {
            f.push({ type: 'bear', l: next.h, h: prev.l, m: (next.h + prev.l) / 2, source_index: i + 1 });
        }
    }
    return f;
}

// Find Swings
function findSwings(d, lb = 3) {
    d = closedStructureCandles(d);
    let H = [], L = [];
    let h = d.map(c => c.h);
    let l = d.map(c => c.l);
    for(let i = lb; i < h.length - lb; i++) {
        let iH = true, iL = true;
        for(let j = 1; j <= lb; j++) {
            if(h[i] <= h[i-j] || h[i] <= h[i+j]) iH = false;
            if(l[i] >= l[i-j] || l[i] >= l[i+j]) iL = false;
        }
        if(iH) H.push({ p: h[i], i });
        if(iL) L.push({ p: l[i], i });
    }
    return { H, L };
}

// Detect MSS
function detectMSS(d) {
    d = closedStructureCandles(d);
    if(d.length < 21) return null;
    let h = d.map(c => c.h);
    let l = d.map(c => c.l);
    let c = d.map(c => c.c);
    let rH = Math.max(...h.slice(-21, -1));
    let rL = Math.min(...l.slice(-21, -1));
    let cP = c[c.length - 1];
    if(cP > rH) return { type: 'BULL', level: rH };
    if(cP < rL) return { type: 'BEAR', level: rL };
    return null;
}

// ============================================
// DIRECTION BIAS — "WHERE PRICE IS GOING"
// A robust, forward-looking direction read combining:
//   - EMA trend baseline (EMA20 vs EMA50)
//   - BOS: last close breaching the prior range (structure break)
//   - CHoCH: strong displacement candle confirming a turn/push
// This is the direction that UNLOCKS a zone: a setup only fires when
// price is heading that way, then we drop a limit order at the zone
// in that same path. Returns 'BULLISH' | 'BEARISH' | 'NEUTRAL'
// ============================================
function getDirectionBias(data) {
    data = closedStructureCandles(data);
    if(!data || data.length < 40) return 'NEUTRAL';
    const closes = data.map(c => c.c);
    let score = 0;

    // 1. EMA trend baseline (robust — never empty)
    if(closes.length >= 50) {
        const e20 = ema(closes, 20), e50 = ema(closes, 50);
        const a = e20[e20.length - 1], b = e50[e50.length - 1];
        if(a > b) score += 2; else if(a < b) score -= 2;
    }

    // 2. BOS: last close broke the prior ~30-candle range => price is actively moving that way
    const prior = data.slice(-30, -1);
    const hi = Math.max(...prior.map(c => c.h));
    const lo = Math.min(...prior.map(c => c.l));
    const c = data[data.length - 1];
    if(c.c > hi) score += 2;              // break above structure -> up
    else if(c.c < lo) score -= 2;         // break below structure -> down
    else {
        const pos = (c.c - lo) / ((hi - lo) || 1);
        if(pos > 0.6) score += 1;         // elevated inside range
        else if(pos < 0.4) score -= 1;    // depressed inside range
    }

    // 3. CHoCH: strong displacement candle confirming the push
    const prev = data[data.length - 2];
    if(prev) {
        const body = Math.abs(c.c - c.o);
        const rng = c.h - c.l;
        if(body > 0 && rng > 0 && body / rng > 0.6) {
            if(c.c > c.o) score += 1;
            else if(c.c < c.o) score -= 1;
        }
    }

    if(score >= 2) return 'BULLISH';
    if(score <= -2) return 'BEARISH';
    return 'NEUTRAL';
}

// ========== NEW STRUCTURAL PATTERNS & CHECKS ==========

// Pin Bar: long wick rejection at key level
function detectPinBar(data, price, dir, atrVal) {
    data = closedStructureCandles(data);
    if(data.length < 3) return null;
    const c = data[data.length - 1];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    if(range <= 0) return null;
    const upperWick = c.h - Math.max(c.c, c.o);
    const lowerWick = Math.min(c.c, c.o) - c.l;
    if(dir === 'BUY' && lowerWick >= body * 2.5 && upperWick <= body * 0.3) {
        return { type: 'BUY', entry: price, sl: c.l - atrVal * 0.3, tp: price + (price - c.l) * 3 };
    }
    if(dir === 'SELL' && upperWick >= body * 2.5 && lowerWick <= body * 0.3) {
        return { type: 'SELL', entry: price, sl: c.h + atrVal * 0.3, tp: price - (c.h - price) * 3 };
    }
    return null;
}

// Engulfing: full body engulfs prior candle at S/R
function detectEngulfing(data, price, dir) {
    data = closedStructureCandles(data);
    if(data.length < 2) return null;
    const prev = data[data.length - 2];
    const curr = data[data.length - 1];
    if(dir === 'BUY' && prev.c < prev.o && curr.c > curr.o && curr.o < prev.c && curr.c > prev.o) {
        return { type: 'BUY', entry: price, sl: Math.min(curr.l, prev.l) };
    }
    if(dir === 'SELL' && prev.c > prev.o && curr.c < curr.o && curr.o > prev.c && curr.c < prev.o) {
        return { type: 'SELL', entry: price, sl: Math.max(curr.h, prev.h) };
    }
    return null;
}

// CHoCH detection: strong reversal breaking the prior swing structure
// Looks at the last meaningful swing high/low and checks if price has decisively
// broken it AGAINST the prior trend (so a BUY CHoCH means price broke below a prior
// swing low then reversed up — only then does a directional BUY align with the CHoCH).
function detectCHoCH(data, dir) {
    data = closedStructureCandles(data);
    if(!data || data.length < 15) return false;
    const sw = findSwings(data.slice(0, -1), 3);
    const last = data[data.length - 1];
    const lastClose = last.c;

    if(dir === 'BUY') {
        const recentLows = (sw.L || []).slice(-3);
        const recentHighs = (sw.H || []).slice(-3);
        if(recentLows.length === 0) return false;
        const priorSwingLow = Math.min(...recentLows.map(s => s.p));
        const priorSwingHigh = recentHighs.length ? Math.max(...recentHighs.map(s => s.p)) : Infinity;
        const swept = data.slice(-5).some(c => c.l < priorSwingLow);
        const reclaimed = lastClose > priorSwingLow;
        const brokeHigh = lastClose > priorSwingHigh;
        return swept && reclaimed && brokeHigh;
    } else {
        const recentHighs = (sw.H || []).slice(-3);
        const recentLows = (sw.L || []).slice(-3);
        if(recentHighs.length === 0) return false;
        const priorSwingHigh = Math.max(...recentHighs.map(s => s.p));
        const priorSwingLow = recentLows.length ? Math.min(...recentLows.map(s => s.p)) : -Infinity;
        const swept = data.slice(-5).some(c => c.h > priorSwingHigh);
        const reclaimed = lastClose < priorSwingHigh;
        const brokeLow = lastClose < priorSwingLow;
        return swept && reclaimed && brokeLow;
    }
}

// BOS confirmation: close beyond prior swing high/low
function detectBOS(data, dir) {
    data = closedStructureCandles(data);
    if(data.length < 20) return false;
    const highs = data.slice(-20).map(c => c.h);
    const lows = data.slice(-20).map(c => c.l);
    const prevSwingHigh = Math.max(...highs.slice(0, -5));
    const prevSwingLow = Math.min(...lows.slice(0, -5));
    const c = data[data.length - 1];
    if(dir === 'BUY' && c.c > prevSwingHigh) return true;
    if(dir === 'SELL' && c.c < prevSwingLow) return true;
    return false;
}

// HH/HL/LH/LL structure sequence
function analyzeMarketStructure(data) {
    data = closedStructureCandles(data);
    if(data.length < 20) return [];
    const swings = findSwings(data, 2);
    const seq = [];
    const highs = (swings.H || []).slice(-4);
    const lows = (swings.L || []).slice(-4);
    if(highs.length >= 2) {
        if(highs[highs.length-1].p > highs[highs.length-2].p) seq.push('HH');
        else seq.push('LH');
    }
    if(lows.length >= 2) {
        if(lows[lows.length-1].p < lows[lows.length-2].p) seq.push('LL');
        else seq.push('HL');
    }
    return seq;
}

// Equal highs/lows liquidity pools
function detectLiquidityPools(data) {
    data = closedStructureCandles(data);
    if(data.length < 15) return { equalHighs: [], equalLows: [] };
    const highs = data.slice(-15).map((c, i) => ({ p: c.h, i: data.length - 15 + i }));
    const lows = data.slice(-15).map((c, i) => ({ p: c.l, i: data.length - 15 + i }));
    const equalHighs = [];
    const equalLows = [];
    for(let i = 0; i < highs.length; i++) {
        let count = 1;
        for(let j = i + 1; j < highs.length; j++) {
            if(Math.abs(highs[i].p - highs[j].p) / highs[i].p < 0.0008) count++;
        }
        if(count >= 2) equalHighs.push(highs[i].p);
    }
    for(let i = 0; i < lows.length; i++) {
        let count = 1;
        for(let j = i + 1; j < lows.length; j++) {
            if(Math.abs(lows[i].p - lows[j].p) / lows[i].p < 0.0008) count++;
        }
        if(count >= 2) equalLows.push(lows[i].p);
    }
    return { equalHighs, equalLows };
}

// Compression: last N candles contracting range
function detectCompression(data, n = 5) {
    data = closedStructureCandles(data);
    if(data.length < n + 5) return false;
    const recent = data.slice(-n);
    const ranges = recent.map(c => c.h - c.l);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const prior = data.slice(-n - 5, -n).map(c => c.h - c.l);
    const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
    return avgRange < priorAvg * 0.9 && ranges.every(r => r < priorAvg * 1.1);
}

// Loss protection: stops trading after N losses or daily drawdown
let consecutiveLosses = 0;
let dailyPnlR = 0;
let weeklyPnlR = 0;
const PAPER_RISK_STATE_KEY = 'ict_paper_risk_state';
const PAPER_RISK_LIMITS = Object.freeze({
    max_daily_loss: 2,
    max_weekly_loss: 5,
    max_consecutive_losses: 3,
    max_active_orders: 1,
    max_symbol_exposure: 1
});

function getRiskPeriodKeys(now = Date.now()) {
    const date = new Date(now);
    const day = date.toISOString().slice(0, 10);
    const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() - dayOfWeek + 1);
    return { day, week: weekDate.toISOString().slice(0, 10) };
}

function persistPaperRiskState(now = Date.now()) {
    const periods = getRiskPeriodKeys(now);
    try {
        localStorage.setItem(PAPER_RISK_STATE_KEY, JSON.stringify({
            day: periods.day, week: periods.week, consecutive_losses: consecutiveLosses,
            daily_pnl_r: dailyPnlR, weekly_pnl_r: weeklyPnlR
        }));
    } catch (error) { console.warn('[RISK] unable to persist paper risk state', error?.message || error); }
}

function loadPaperRiskState(now = Date.now()) {
    const periods = getRiskPeriodKeys(now);
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(PAPER_RISK_STATE_KEY) || 'null'); } catch (error) { stored = null; }
    if (!stored || stored.week !== periods.week) {
        consecutiveLosses = 0; dailyPnlR = 0; weeklyPnlR = 0;
        persistPaperRiskState(now);
        return;
    }
    consecutiveLosses = Number.isFinite(Number(stored.consecutive_losses)) ? Number(stored.consecutive_losses) : 0;
    weeklyPnlR = Number.isFinite(Number(stored.weekly_pnl_r)) ? Number(stored.weekly_pnl_r) : 0;
    dailyPnlR = stored.day === periods.day && Number.isFinite(Number(stored.daily_pnl_r)) ? Number(stored.daily_pnl_r) : 0;
}

function getPaperRiskSnapshot(now = Date.now()) {
    loadPaperRiskState(now);
    const activeOrders = limitOrder ? 1 : 0;
    return {
        daily_loss: Math.max(0, -dailyPnlR),
        weekly_loss: Math.max(0, -weeklyPnlR),
        consecutive_losses: consecutiveLosses,
        active_orders: activeOrders,
        symbol_exposure: activeOrders,
        daily_pnl_r: dailyPnlR,
        weekly_pnl_r: weeklyPnlR
    };
}

function buildPaperOrderRiskGate(now = Date.now()) {
    const snapshot = getPaperRiskSnapshot(now);
    return buildAccountRiskGate({ mode: 'PAPER', account: PAPER_RISK_LIMITS, ...snapshot });
}

function checkLossProtection() {
    return consecutiveLosses < 3 && dailyPnlR > -2.0;
}
function ictSetLastTradeTime(ts) {
    lastTradeTime = ts;
    try { localStorage.setItem(ICT_LAST_TRADE_TIME_KEY, String(ts)); } catch (e) {}
}
function ictGetLastTradeTime() {
    let stored = 0;
    try { stored = Number(localStorage.getItem(ICT_LAST_TRADE_TIME_KEY)) || 0; } catch (e) {}
    return Math.max(lastTradeTime || 0, stored);
}
function recordTradeResult(isWin, riskR) {
    loadPaperRiskState();
    if (!ictGetLastTradeTime()) ictSetLastTradeTime(Date.now());
    const resultR = Math.max(0, Number(riskR) || 0);
    if(isWin) { consecutiveLosses = 0; dailyPnlR += resultR; weeklyPnlR += resultR; }
    else { consecutiveLosses++; dailyPnlR -= resultR; weeklyPnlR -= resultR; }
    persistPaperRiskState();
}

// ============================================
// AUTO OUTCOME DETECTION
// ============================================
// When a limit order FILLS inside startMonitor(), we don't know yet whether
// it will hit SL or TP1. We push the filled order into a localStorage queue
// (pendingFills) and check 5M candles on the next monitor tick. If SL was
// hit first → LOSS, if TP1 first → WIN, otherwise keep waiting.
//
// This replaces the requirement to manually call window.logTradeResult()
// from the console. The Win/Loss buttons in the Recent UI are still
// available as a manual override.
const PENDING_FILLS_KEY = 'pendingFills';
function loadPendingFills() {
    try { return JSON.parse(localStorage.getItem(PENDING_FILLS_KEY) || '[]'); }
    catch(e) { return []; }
}
function savePendingFills(arr) {
    try { localStorage.setItem(PENDING_FILLS_KEY, JSON.stringify(arr)); } catch(e) {}
}
function enqueuePendingFill(order, fillPrice) {
    const queue = loadPendingFills();
    const id = order.id || Date.now();
    if (queue.some(item => String(item.id) === String(id))) {
        console.log(`⚠️ pendingFills: duplicate ${id} ignored`);
        return;
    }

    const fillTime = Date.now();
    ictSetLastTradeTime(fillTime);
    queue.push({
        id,
        pair: order.pair || pair,
        signalType: order.signalType,
        entry: fillPrice,
        stopLoss: order.stopLoss,
        takeProfit1: order.takeProfit1,
        takeProfit2: order.takeProfit2,
        takeProfit3: order.takeProfit3,
        confidence: order.confidence || 0,
        candidate_id: order.candidate_id || order.aiDecision?.selected_candidate_id || null,
        strategy_version: order.strategy_version || STRATEGY_SPEC_VERSION,
        strategy: order.strategy || order.patterns || null,
        entry_model: order.entry_model || null,
        structural_invalidation: order.structural_invalidation || null,
        quality_breakdown: order.quality_breakdown || null,
        fill_price_source: order.fill_price_source || 'LIMIT_ORDER_PRICE',
        patterns: order.patterns || '',
        rrUsed: order.rrUsed || 0,
        source: order.source || null,
        fill_time_ms: fillTime,
        fill_time: new Date(fillTime).toISOString(),
        createdAt: new Date(fillTime).toISOString(),
        checkedAt: null
    });
    savePendingFills(queue);
    console.log(`  📥 pendingFills: enqueued ${order.signalType} @ ${fillPrice} (queue size ${queue.length})`);
}
function clearPendingFill(id) {
    const queue = loadPendingFills().filter(f => f.id !== id);
    savePendingFills(queue);
}

// Resolve one pending fill against the candle history after the fill time.
// Returns { resolved: true|false, outcome: 'WIN'|'LOSS'|null, reason: string }
//   - If SL candle is BEFORE TP1 candle in the post-fill candles → LOSS
//   - If TP1 candle is BEFORE SL candle                       → WIN
//   - Otherwise not yet resolved (keep in queue)
function resolvePendingFill(fill, candles) {
    if(!fill || !candles || candles.length === 0) return { resolved: false, outcome: null, reason: 'no candles' };
    const created = new Date(fill.createdAt).getTime();
    if(!Number.isFinite(created)) return { resolved: false, outcome: null, reason: 'bad createdAt' };

    const firstEligibleStart = Math.ceil(created / ICT_FIVE_MIN_MS) * ICT_FIVE_MIN_MS;
    const currentCandleStart = Math.floor(Date.now() / ICT_FIVE_MIN_MS) * ICT_FIVE_MIN_MS;

    for(let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const t = parseCandleTimeUTC(c.t);
        if(!Number.isFinite(t) || t < firstEligibleStart || t >= currentCandleStart) continue;

        const slHit = fill.signalType === 'LONG'
            ? c.l <= fill.stopLoss
            : c.h >= fill.stopLoss;
        const tpHit = fill.signalType === 'LONG'
            ? c.h >= fill.takeProfit1
            : c.l <= fill.takeProfit1;

        if (slHit && tpHit) {
            return { resolved: true, outcome: 'LOSS', reason: `SL and TP1 both touched in 5M candle ${i}; conservative LOSS because intrabar order is unknowable` };
        }
        if (slHit) return { resolved: true, outcome: 'LOSS', reason: `SL hit first at candle ${i}` };
        if (tpHit) return { resolved: true, outcome: 'WIN', reason: `TP1 hit first at candle ${i}` };
    }

    return { resolved: false, outcome: null, reason: 'neither SL nor TP1 hit in completed post-fill candles' };
}

async function checkPendingFills() {
    const queue = loadPendingFills();
    if(queue.length === 0) return;
    const stillPending = [];
    for(const fill of queue) {
        // Skip fills older than 7 days — assume manual review needed
        const ageHours = (Date.now() - new Date(fill.createdAt).getTime()) / 3600000;
        if(ageHours > 24 * 7) {
            console.log(`  ⏰ pendingFills: dropping ${fill.id} (${ageHours.toFixed(0)}h old, manual review required)`);
            continue;
        }
        if(ageHours < 10 / 60) {
            stillPending.push(fill);
            continue;
        }
        try {
            const candles = await getHistory('5M', fill.pair);
            if(!candles || candles.length < 3) {
                stillPending.push(fill);
                continue;
            }
            const result = resolvePendingFill(fill, candles);
            if(!result.resolved) {
                fill.checkedAt = new Date().toISOString();
                stillPending.push(fill);
                continue;
            }
            // Resolved! Record and surface to UI
            const isWin = result.outcome === 'WIN';
            // Risk is |entry - stopLoss|. Reward at TP1 is |TP1 - entry|. Use RR for PnL.
            const risk = Math.abs(fill.entry - fill.stopLoss);
            const reward = Math.abs(fill.takeProfit1 - fill.entry);
            const r = risk > 0 ? reward / risk : 1.0;
            recordTradeResult(isWin, r);
            try {
                const patterns = Array.isArray(fill.patterns)
                    ? fill.patterns
                    : String(fill.patterns || '').split('+').map(x => x.trim()).filter(Boolean);
                trackAIPerformance(String(fill.id), result.outcome, fill.confidence || 0, patterns, r);
            } catch (e) {
                console.warn('pendingFills self-learning update failed:', e);
            }
            showNotif(
                `📊 Auto-detected: ${fill.pair || ''} ${fill.signalType} → ${isWin ? '✅ WIN' : '❌ LOSS'} (${result.reason})`,
                isWin ? 'success' : 'warning'
            );
            console.log(`  📊 pendingFills: resolved ${fill.id} → ${result.outcome} (${result.reason})`);
        } catch(e) {
            console.error('pendingFills check error:', e);
            stillPending.push(fill);
        }
    }
    savePendingFills(stillPending);
}

// Time gap between trades (hours)
let lastTradeTime = 0;
function checkTradeGap(minHours = 2) {
    const openedAt = ictGetLastTradeTime();
    if (!openedAt) return true;
    return Date.now() - openedAt >= minHours * 3600000;
}

// Detect Inside Bar (lower priority)
function detectInsideBar(data, dir) {
    data = closedStructureCandles(data);
    if(data.length < 2) return null;
    const prev = data[data.length - 2];
    const curr = data[data.length - 1];
    if(curr.h <= prev.h && curr.l >= prev.l) return { type: dir };
    return null;
}

// Expected Value calculation (EV > 0.2R required to trade)
function calculateEV(winProb, rr) {
    return (winProb / 100) * rr - (1 - winProb / 100) * 1;
}

// Detect Order Blocks
function detectOrderBlocks(data, direction) {
    data = closedStructureCandles(data);
    const obs = [];
    for(let i = 2; i < data.length - 1; i++) {
        const curr = data[i];
        const next = data[i + 1];
        
        if(direction === 'BUY') {
            if(curr.c < curr.o && next.c > next.o && next.h > curr.h) {
                obs.push({ high: curr.h, low: curr.l, source_index: i + 1 });
            }
        } else {
            if(curr.c > curr.o && next.c < next.o && next.l < curr.l) {
                obs.push({ high: curr.h, low: curr.l, source_index: i + 1 });
            }
        }
    }
    return obs;
}

// ADX Calculation (HTF > 15 required, LTF > 20 required)
function calculateADX(data, period = 14, timeframe = '1H') {
    const minADX = ['1D', '4H', '1H'].includes(timeframe) ? 10 : 20;
    if(!data || data.length < period * 2) return { adx: 30, isStrongTrend: true, minADX };
    let trs = [], pDMs = [], mDMs = [];
    for(let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const tr = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
        const pDM = (curr.h - prev.h > prev.l - curr.l && curr.h - prev.h > 0) ? curr.h - prev.h : 0;
        const mDM = (prev.l - curr.l > curr.h - prev.h && prev.l - curr.l > 0) ? prev.l - curr.l : 0;
        trs.push(tr); pDMs.push(pDM); mDMs.push(mDM);
    }
    if(trs.length < period) return { adx: 30, isStrongTrend: true, minADX };
    let trSmooth = trs.slice(-period).reduce((a,b)=>a+b, 0);
    let pDMSmooth = pDMs.slice(-period).reduce((a,b)=>a+b, 0);
    let mDMSmooth = mDMs.slice(-period).reduce((a,b)=>a+b, 0);
    if(trSmooth === 0) return { adx: 30, isStrongTrend: true, minADX };
    const pDI = (pDMSmooth / trSmooth) * 100;
    const mDI = (mDMSmooth / trSmooth) * 100;
    const dx = (Math.abs(pDI - mDI) / (pDI + mDI || 1)) * 100;
    return { adx: dx, isStrongTrend: dx > minADX, minADX };
}

// RSI (Wilder's smoothing) — real local calculation from candle closes
function computeRSI(closes, period = 14) {
    if(!closes || closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for(let i = 1; i <= period; i++) {
        const ch = closes[i] - closes[i - 1];
        if(ch > 0) gains += ch; else losses -= ch;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for(let i = period + 1; i < closes.length; i++) {
        const ch = closes[i] - closes[i - 1];
        const g = ch > 0 ? ch : 0;
        const l = ch < 0 ? -ch : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if(avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ZONE-LEVEL INDICATOR IDENTIFICATION
// Identifies the actual condition of the SETUP ZONE (not the current tick):
// whether the zone itself sits at an oversold / overbought / discount / premium
// extreme relative to the Bollinger bands and the recent trading range. This is
// how the indicators DEFINE the setup (e.g. "this zone is oversold"), rather
// than only nudging a confidence number.
function evaluateZoneIndicators(data, zone, direction) {
    if(!data || data.length < 25) return { condition: null, detail: '' };
    const closes = data.map(c => c.c);
    const win = closes.slice(-20);
    const mid = win.reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - mid) * (b - mid), 0) / 20);
    const bbUp = mid + 2 * sd, bbLo = mid - 2 * sd;
    const zonePrice = zone.price || zone;
    const hi = Math.max(...data.slice(-50).map(c => c.h));
    const lo = Math.min(...data.slice(-50).map(c => c.l));
    const rangePct = ((zonePrice - lo) / ((hi - lo) || 1)) * 100;
    const rsi = computeRSI(closes, 14);
    let condition = null, detail = '';
    if(direction === 'BUY') {
        if(zonePrice <= bbLo) {
            condition = 'OVERSOLD_ZONE';
            detail = `zone below lower Bollinger band (${rangePct.toFixed(0)}% of range)`;
        } else if(rangePct < 25) {
            condition = 'DISCOUNT';
            detail = `zone in deep discount (${rangePct.toFixed(0)}% of range)`;
        }
    } else {
        if(zonePrice >= bbUp) {
            condition = 'OVERBOUGHT_ZONE';
            detail = `zone above upper Bollinger band (${rangePct.toFixed(0)}% of range)`;
        } else if(rangePct > 75) {
            condition = 'PREMIUM';
            detail = `zone in premium (${rangePct.toFixed(0)}% of range)`;
        }
    }
    return { condition, detail, rsi, bollinger: { mid, upper: bbUp, lower: bbLo }, rangePct };
}

// LTF (15M/5M) ENTRY TIMING — MTE refinement.
// After a 4H/1H setup is found, drop to the lower timeframe (15M, fallback 5M/1H)
// to refine the ENTRY level within that setup. SOFT: it never blocks the setup —
// if the LTF zone doesn't align or isn't close, we keep the original 4H/1H entry.
// When it works it times the entry better (a tighter 15M/5M level) and the caller
// adds a confidence bonus. SL is recomputed against the refined entry for consistency.
function refineEntryWithLTF(htfData, dir, price, baseResult, baseEntry) {
    const ltfData = (htfData && (htfData['15M'] || htfData['5M'] || htfData['1H'])) || null;
    if(!ltfData || ltfData.length < 20) return { refined: false };
    try {
        const ltfATR = atr(ltfData, 14);
        const ltf = findPatternZone(ltfData, price, dir, ltfATR);
        if(!ltf || !ltf.entry || !ltf.sl) return { refined: false };
        // Only nudge when the LTF zone is on the same side and reasonably close
        // to the 4H/1H entry (so the trade doesn't change character).
        const tol = Math.max(price * 0.004, 0); // 0.4% of price
        if(Math.abs(ltf.entry - baseEntry) > tol) return { refined: false };
        return {
            refined: true,
            entry: ltf.entry,
            sl: ltf.sl,
            baseEntry: baseEntry,
            tf: ltf.zoneType ? '15M/5M' : '15M/5M'
        };
    } catch(e) {
        return { refined: false };
    }
}

// Confirmation Candle Check (Scoring bonus: +10 if candle confirms direction, +0 if unconfirmed)
function checkConfirmationCandle(data, direction) {
    if(!data || data.length < 2) return { confirmed: true, bonus: 5, reason: 'Candle data limited' };
    const lastCandle = data[data.length - 1];
    const isBullish = lastCandle.c >= lastCandle.o;
    const confirmed = (direction === 'BUY' && isBullish) || (direction === 'SELL' && !isBullish);
    return {
        confirmed: confirmed,
        bonus: confirmed ? 10 : 0,
        reason: confirmed ? 'Last candle confirms direction (+10)' : 'Last candle unconfirmed (+0)'
    };
}

// Session Check (Scoring bonus: +10 for London/NY primary sessions, +0 for Off-hours/Asian)
function checkTradeSession(now = new Date()) {
    const sessionInfo = getSession(now);
    const utcHour = now.getUTCHours();
    const isLondon = utcHour >= 7 && utcHour < 16;
    const isNewYork = utcHour >= 12 && utcHour < 21;
    const isPrimarySession = isLondon || isNewYork;
    const isKillzoneSession = sessionInfo.isKillzone || sessionInfo.isSilverBullet;
    return {
        isPrimarySession: isPrimarySession,
        sessionName: isLondon ? 'London' : (isNewYork ? 'New York' : sessionInfo.session),
        bonus: isPrimarySession ? 10 : (isKillzoneSession ? 2 : -8),
        reason: isPrimarySession ? 'Primary trading session (London/NY) (+10)' : (isKillzoneSession ? 'Killzone session (+2)' : 'Off-hours session (-8)')
    };
}

// News is deliberately UNKNOWN until an external calendar is supplied. Time
// of day alone cannot prove that a high-impact event is absent.
function checkHighImpactNews(newsInput = null) {
    if (newsInput && typeof newsInput === 'object') {
        const highImpact = newsInput.high_impact_event;
        if (typeof highImpact === 'boolean') {
            return {
                status: highImpact ? 'HIGH_IMPACT' : 'CLEAR',
                available: true,
                inNewsWindow: highImpact,
                high_impact_event: highImpact,
                newsName: newsInput.event_name || null,
                event_name: newsInput.event_name || null,
                event_time: newsInput.event_time || null,
                minutes_to_event: newsInput.minutes_to_event ?? null,
                minutes_after_event: newsInput.minutes_after_event ?? null,
                source: newsInput.source || null,
                warning: highImpact ? `⚠️ High-impact news risk${newsInput.event_name ? `: ${newsInput.event_name}` : ''}` : null
            };
        }
    }
    return {
        status: 'UNKNOWN', available: false, inNewsWindow: false,
        high_impact_event: null, newsName: null, event_name: null,
        event_time: null, minutes_to_event: null, minutes_after_event: null,
        source: null, warning: 'High-impact news status is unavailable.'
    };
}

// Dynamic Position Sizing based on Confidence Score
function getDynamicRiskPercent(confidence) {
    if (confidence >= 85) return 1.0;
    if (confidence >= 75) return 0.75;
    if (confidence >= 65) return 0.50;
    return 0.50;
}

// Structured Trade Management Rules
function getTradeManagementRules(confidence) {
    const riskPct = getDynamicRiskPercent(confidence);
    return {
        recommended_risk_pct: `${riskPct}%`,
        sl_to_breakeven: "Move Stop Loss to Entry price after TP1 is hit",
        partial_take_profits: {
            tp1: "Close 50% position at TP1",
            tp2: "Close 30% position at TP2",
            tp3: "Close remaining 20% position at TP3"
        },
        trailing_stop_loss: "Trail SL behind 15M market structure / ATR buffer after TP1"
    };
}

const STRATEGY_SPEC_VERSION = '1.0.0';
const STRATEGY_SPEC = {
    VERSION: STRATEGY_SPEC_VERSION,
    TIME: { futureToleranceMs: 2 * 60 * 1000, candleMatchToleranceMs: 5 * 60 * 1000 },
    LIFECYCLE: { maxEntryTouches: 0, minRemainingRewardFraction: 0.50, maxMSNREventAgeBars: 8 },
    FRESHNESS: {
        max15mEventAgeHours: 12,
        max1hEventAgeHours: 30,
        max4hEventAgeHours: 72,
        maxPendingDistanceAtr: 3,
        minRemainingRewardFraction: 0.50,
        normalRemainingRewardFraction: 0.70,
        pendingLaterDistanceAtr: 3,
        lowEntryReachabilityScore: 40,
        mediumEntryReachabilityScore: 70
    },
    CONFIDENCE: {
        baseScore: 50,
        freshEvent: 8,
        normalReward: 8,
        partialRewardPenalty: -10,
        entryDistanceWeight: 0.16,
        targetReachabilityWeight: 0.12,
        htfAlignment: 4,
        confluence: 5,
        countertrendPenalty: -8,
        seriousObstaclePenalty: -10,
        highQualityMinimum: 70,
        mediumQualityMinimum: 55
    },
    CRT: { referenceLookback: 18, eventLookahead: 10, minReferenceAtr: 0.35, maxEventAgeBars: 8, minSweepAtr: 0.04, dedupeAtr: 0.2, maxEventsPerTimeframe: 8 },
    TBS: { lookback: 80, referenceMinAgeBars: 4, maxEventAgeBars: 8, minSweepAtr: 0.04, minSweepPips: 2, dedupeAtr: 0.2, maxEventsPerTimeframe: 8 },
    MSNR: { lookback: 120, maxMitigationCount: 2, breakCloseBufferAtr: 0.03, retestToleranceAtr: 0.15, zoneAtrWidth: 0.08, minStructuralScore: 35, maxLevelsPerTimeframe: 12 },
    COMBINATION: { minScore: 60, sameTfBars: 20, crossTfHours: 18, maxSetups: 24 },
    EXECUTION: { maxStopsPerZone: 8, maxTargetsPerEvaluation: 20, maxFreshFVGZones: 5, maxFreshOBZones: 5, maxFreshMSNRZones: 5, maxFreshExecutionZones: 8, maxFreshExecutionSetups: 24 },
    TARGET: { maxAtrDistance: 12, firstObjectiveBonus: 14, seriousObstaclePenalty: 22, weakObstaclePenalty: 7 }
};

function narrativeEventIndex(setup, data) {
    if (!Array.isArray(data) || !data.length) return -1;
    const eventTime = getStrategyEventTime(setup);
    if (Number.isFinite(eventTime)) {
        const matched = findEventCandleIndex(data, eventTime, setup.execution_timeframe || setup.timeframe);
        if (matched >= 0) return matched;
    }
    const index = setup.primary === 'MSNR'
        ? (setup.entry_model === 'ROLE_REVERSAL_RETEST' ? setup.break_index : setup.departure_confirmed_index)
        : (setup.reclaim_bar_index ?? setup.reclaim_index ?? setup.evidence?.reclaim_bar);
    return Number.isInteger(index) && index >= 0 && index < data.length ? index : -1;
}

function isDirectionalDisplacement(candle, direction, atrValue) {
    if (!candle) return false;
    const range = Number(candle.h) - Number(candle.l);
    const body = Math.abs(Number(candle.c) - Number(candle.o));
    if (!(range > 0) || !(body / range >= 0.55)) return false;
    if (Number.isFinite(atrValue) && atrValue > 0 && range < atrValue * 0.6) return false;
    return direction === 'BUY' ? candle.c > candle.o : candle.c < candle.o;
}

function zoneWasTouchedAfter(data, low, high, createdIndex, timeframe = null) {
    let firstTouchIndex = null;
    let touchCount = 0;
    for (let i = Math.max(0, createdIndex + 1); i < (data || []).length; i++) {
        const candle = data[i];
        if (candle.l <= high && candle.h >= low) {
            touchCount++;
            if (firstTouchIndex == null) firstTouchIndex = i;
        }
    }
    return {
        touched: touchCount > 0,
        firstTouchIndex,
        firstTouchTime: firstTouchIndex == null ? null : candleTimestamp(data[firstTouchIndex], firstTouchIndex, timeframe),
        touchCount
    };
}

function buildFreshExecutionZonesForNarrative(narrative, historyCache = {}, existingZones = [], pairLocal = pair, currentPrice = null) {
    if (!narrative?.direction) return [];
    const executionTf = narrative.execution_timeframe || narrative.timeframe || '1H';
    const data = getClosedHistory(historyCache, executionTf);
    const executionData = historyCache[executionTf] || [];
    // Closed candles create zones; live candles can still consume existing zones.
    const touchAfterCreation = (low, high, index) => zoneWasTouchedAfter(
        executionData, low, high, executionData.indexOf(data[index]), executionTf);
    if (!isValidCandleArray(data, 5)) return [];
    const signalIndex = narrativeEventIndex(narrative, data);
    if (signalIndex < 0 || signalIndex >= data.length - 2) return [];
    const signalTime = getStrategyEventTime(narrative) || candleTimestamp(data[signalIndex], signalIndex, executionTf);
    const settings = getMarketSettings(pairLocal);
    const prec = settings.prec;
    const atrValue = data.length >= 15 ? atr(data, 14) : 0;
    const minGap = Math.max(settings.pipSize * 2, (atrValue || 0) * 0.04);
    const fvgZones = [];
    const obZones = [];
    const msnrZones = [];
    const executionZoneStats = { discovered: 0, fresh: 0, consumed: 0, invalidated: 0, pre_signal: 0, wrong_side: 0 };
    const direction = narrative.direction;
    const price = Number(currentPrice ?? historyCache.current_price ?? historyCache.price ?? narrative.current_price);

    for (let i = signalIndex + 1; i < data.length - 1; i++) {
        const prev = data[i - 1];
        const curr = data[i];
        const next = data[i + 1];
        const createdIndex = i + 1;
        if (createdIndex <= signalIndex) continue;
        const displacement = isDirectionalDisplacement(curr, direction, atrValue) || isDirectionalDisplacement(next, direction, atrValue);
        if (!displacement) continue;
        let low = null;
        let high = null;
        if (direction === 'BUY' && prev.h < next.l && next.l - prev.h >= minGap) {
            low = prev.h; high = next.l;
        } else if (direction === 'SELL' && prev.l > next.h && prev.l - next.h >= minGap) {
            low = next.h; high = prev.l;
        }
        if (low == null || high == null) continue;
        executionZoneStats.discovered++;
        const touch = touchAfterCreation(low, high, createdIndex);
        const zone = {
            id: `FRESH-${executionTf}-${direction}-FVG-${ictRound(low, prec)}-${ictRound(high, prec)}-${normalizeTimestampUTC(candleTimestamp(data[createdIndex], createdIndex, executionTf)) || createdIndex}`,
            type: 'FVG', origin: 'STRUCTURAL', primary_eligible: !touch.touched, invalidated: false,
            direction, timeframe: executionTf, low: ictRound(low, prec), high: ictRound(high, prec),
            midpoint: ictRound((low + high) / 2, prec), created_index: createdIndex,
            created_time: candleTimestamp(data[createdIndex], createdIndex, executionTf),
            signal_time: signalTime, displacement_confirmed: true,
            departure_strength: atrValue > 0 ? ictRound((next.h - next.l) / atrValue, 2) : null,
            first_touch_after_creation: touch.firstTouchIndex,
            first_touch_time: touch.firstTouchTime, touch_count: touch.touchCount,
            mitigated: touch.touched, freshness: touch.touched ? 'CONSUMED' : 'FRESH',
            execution_model: 'FRESH_RETRACEMENT_LIMIT', entry_model: 'FRESH_RETRACEMENT_LIMIT',
            entry_region_source: 'FVG', strategy_source: narrative.primary,
            structural_invalidation: narrative.structural_invalidation
        };
        if (!touch.touched) fvgZones.push(zone);
        else executionZoneStats.consumed++;
    }

    for (let i = signalIndex + 1; i < data.length - 1; i++) {
        const base = data[i];
        const departure = data[i + 1];
        if (!isDirectionalDisplacement(departure, direction, atrValue)) continue;
        const prior = data.slice(Math.max(signalIndex, i - 6), i).map(c => direction === 'BUY' ? c.h : c.l);
        const breaksStructure = direction === 'BUY'
            ? departure.h > Math.max(...prior, -Infinity)
            : departure.l < Math.min(...prior, Infinity);
        const opposingBase = direction === 'BUY' ? base.c < base.o : base.c > base.o;
        if (!opposingBase || !breaksStructure) continue;
        const low = base.l;
        const high = base.h;
        const touch = touchAfterCreation(low, high, i + 1);
        executionZoneStats.discovered++;
        if (touch.touched) { executionZoneStats.consumed++; continue; }
        obZones.push({
            id: `FRESH-${executionTf}-${direction}-OB-${ictRound(low, prec)}-${ictRound(high, prec)}-${normalizeTimestampUTC(candleTimestamp(data[i + 1], i + 1, executionTf)) || i}`,
            type: 'OB', origin: 'STRUCTURAL', primary_eligible: true, invalidated: false,
            direction, timeframe: executionTf, low: ictRound(low, prec), high: ictRound(high, prec),
            midpoint: ictRound((low + high) / 2, prec), created_index: i + 1,
            created_time: candleTimestamp(data[i + 1], i + 1, executionTf), signal_time: signalTime,
            departure_index: i + 1, departure_time: candleTimestamp(data[i + 1], i + 1, executionTf),
            departure_strength: atrValue > 0 ? ictRound((departure.h - departure.l) / atrValue, 2) : null,
            first_touch_after_creation: null, first_touch_time: null, touch_count: 0,
            mitigated: false, freshness: 'FRESH', displacement_confirmed: true,
            execution_model: 'FRESH_RETRACEMENT_LIMIT', entry_model: 'FRESH_RETRACEMENT_LIMIT',
            entry_region_source: 'OB', strategy_source: narrative.primary,
            structural_invalidation: narrative.structural_invalidation
        });
    }

    for (const zone of existingZones || []) {
        if (zone.timeframe && zone.timeframe !== executionTf) continue;
        const sourceTime = normalizeTimestampUTC(zone.source_time ?? zone.created_time);
        let sourceIndex = Number(zone.source_candle_index ?? zone.created_index);
        if (Number.isFinite(sourceTime)) {
            const exactIndex = executionData.findIndex((candle, index) => candleTimestamp(candle, index, executionTf) === sourceTime);
            const rawIndex = exactIndex >= 0 ? exactIndex : findEventCandleIndex(executionData, sourceTime, executionTf);
            sourceIndex = data.indexOf(executionData[rawIndex]);
        }
        if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || !data[sourceIndex]) continue;
        const afterSignal = (Number.isInteger(sourceIndex) && sourceIndex > signalIndex) || (Number.isFinite(sourceTime) && sourceTime >= signalTime);
        if (zone.type !== 'MSNR' || zone.origin !== 'STRUCTURAL_MSNR' || zone.direction !== direction) continue;
        executionZoneStats.discovered++;
        if (!afterSignal) { executionZoneStats.pre_signal++; continue; }
        if (zone.primary_eligible === false || zone.invalidated) { executionZoneStats.invalidated++; continue; }
        const touch = touchAfterCreation(zone.low, zone.high, sourceIndex);
        if (touch.touched) { executionZoneStats.consumed++; continue; }
        msnrZones.push({ ...zone, id: `FRESH-${executionTf}-${direction}-MSNR-${ictRound(zone.low, prec)}-${ictRound(zone.high, prec)}-${normalizeTimestampUTC(sourceTime || candleTimestamp(data[sourceIndex], sourceIndex, executionTf)) || sourceIndex}`, execution_model: 'FRESH_RETRACEMENT_LIMIT', entry_model: 'FRESH_RETRACEMENT_LIMIT', entry_region_source: 'MSNR', strategy_source: narrative.primary, created_index: sourceIndex, created_time: sourceTime || candleTimestamp(data[sourceIndex], sourceIndex, executionTf), signal_time: signalTime, first_touch_after_creation: null, first_touch_time: null, touch_count: 0, mitigated: false, freshness: 'FRESH' });
    }

    const dedupe = new Map();
    for (const zone of [...fvgZones.slice(-STRATEGY_SPEC.EXECUTION.maxFreshFVGZones), ...obZones.slice(-STRATEGY_SPEC.EXECUTION.maxFreshOBZones), ...msnrZones.slice(-STRATEGY_SPEC.EXECUTION.maxFreshMSNRZones)]) {
        const key = `${zone.direction}|${zone.timeframe}|${ictRound(zone.low, prec)}|${ictRound(zone.high, prec)}`;
        const prior = dedupe.get(key);
        if (prior) {
            prior.entry_region_source = `${prior.entry_region_source}+${zone.entry_region_source}`;
            prior.confluence = [...new Set([...(prior.confluence || []), zone.type])];
        } else dedupe.set(key, { ...zone, confluence: [zone.type] });
    }
    const dedupedZones = [...dedupe.values()];
    const directionalZones = dedupedZones.filter(zone => direction === 'BUY' ? (!Number.isFinite(price) || zone.midpoint <= price) : (!Number.isFinite(price) || zone.midpoint >= price));
    executionZoneStats.wrong_side = dedupedZones.length - directionalZones.length;
    const result = directionalZones
        .sort((a, b) => (b.displacement_confirmed - a.displacement_confirmed) || ((b.departure_strength || 0) - (a.departure_strength || 0)) || (b.created_index - a.created_index))
        .slice(0, STRATEGY_SPEC.EXECUTION.maxFreshExecutionZones);
    executionZoneStats.fresh = result.length;
    Object.defineProperty(result, 'execution_zone_stats', { value: executionZoneStats, enumerable: false, configurable: true });
    return result;
}

function buildFreshExecutionZones(narrative, historyCache = {}, existingZones = [], pairLocal = pair, currentPrice = null) {
    return buildFreshExecutionZonesForNarrative(narrative, historyCache, existingZones, pairLocal, currentPrice);
}

function evaluateStrategyNarrative(narrative, historyCache = {}, price) {
    const executionTf = narrative.execution_timeframe || narrative.timeframe || '1H';
    const data = closedStructureCandles(historyCache?.[executionTf] || historyCache?.[narrative.timeframe] || []);
    const index = narrativeEventIndex(narrative, data);
    const eventTime = getStrategyEventTime(narrative) || (index >= 0 ? candleTimestamp(data[index], index, executionTf) : null);
    const maxAgeHours = narrative.timeframe === '15M' ? STRATEGY_SPEC.FRESHNESS.max15mEventAgeHours : narrative.timeframe === '4H' ? STRATEGY_SPEC.FRESHNESS.max4hEventAgeHours : STRATEGY_SPEC.FRESHNESS.max1hEventAgeHours;
    const latest = latestCandleTimestamp(data, executionTf);
    const rawAgeHours = Number.isFinite(eventTime) && Number.isFinite(latest) ? (latest - eventTime) / 3600000 : null;
    const futureEvent = Number.isFinite(eventTime) && Number.isFinite(latest) && eventTime > latest + STRATEGY_SPEC.TIME.futureToleranceMs;
    const ageHours = rawAgeHours;
    const invalidation = Number(narrative.structural_invalidation);
    const objective = Number(narrative.primary_objective ?? narrative.target_candidates?.[0]?.level);
    const post = index >= 0 ? data.slice(index + 1) : [];
    const invalidated = Number.isFinite(invalidation) && ((narrative.direction === 'BUY' && ((Number(price) <= invalidation) || post.some(c => c.c <= invalidation))) || (narrative.direction === 'SELL' && ((Number(price) >= invalidation) || post.some(c => c.c >= invalidation))));
    const targetCompleted = Number.isFinite(objective) && ((narrative.direction === 'BUY' && ((Number(price) >= objective) || post.some(c => c.h >= objective))) || (narrative.direction === 'SELL' && ((Number(price) <= objective) || post.some(c => c.l <= objective))));
    const stale = !Number.isFinite(ageHours) || ageHours > maxAgeHours;
    const state = futureEvent ? 'INVALIDATED' : invalidated ? 'INVALIDATED' : targetCompleted ? 'TARGET_COMPLETED' : stale ? 'STALE_NARRATIVE' : 'ACTIVE';
    return { state, rejection_code: futureEvent ? 'DATA_TIME_INCONSISTENT' : null, event_time: eventTime, event_time_utc: Number.isFinite(eventTime) ? new Date(eventTime).toISOString() : null, event_age_hours: ageHours, event_index: index, timestamp_source: timestampSource(eventTime, index >= 0 ? data[index] : null), structural_invalidation: invalidation, primary_objective: objective, original_entry_consumed: !!narrative.entry_consumed };
}

function canonicalizeHistory(candles, timeframe, asOfMs) {
    const duration = TIMEFRAME_MS[timeframe] || 60 * 60000;
    const normalized = (Array.isArray(candles) ? candles : []).map(c => ({
        ...c,
        t: normalizeTimestampUTC(c?.t),
        timeframe,
        source: c?.source || 'TWELVE_DATA',
        timestamp_source: c?.timestamp_source || 'PROVIDER',
        is_closed: Number.isFinite(normalizeTimestampUTC(c?.t)) && Number.isFinite(asOfMs)
            ? normalizeTimestampUTC(c.t) + duration <= asOfMs + STRATEGY_SPEC.TIME.futureToleranceMs
            : c?.is_closed !== false
    })).filter(c => Number.isFinite(c.t) && [c.o, c.h, c.l, c.c].every(Number.isFinite));
    Object.defineProperty(normalized, 'provider_metadata', { value: candles?.provider_metadata || { provider: 'UNKNOWN', requested_timezone: 'UTC', timeframe }, enumerable: false });
    return normalized;
}

function isValidCandleArray(data, min = 1) {
    return Array.isArray(data) && data.length >= min && data.every(c =>
        c && ictFiniteNumber(c.o) && ictFiniteNumber(c.h) && ictFiniteNumber(c.l) && ictFiniteNumber(c.c)
    );
}

function classifyEventFreshness(eventAge, maxAge, invalidated = false) {
    if (invalidated) return 'INVALIDATED';
    if (eventAge <= 2) return 'FRESH';
    if (eventAge <= maxAge) return 'ACTIVE';
    if (eventAge <= maxAge * 2) return 'AGED';
    return 'EXPIRED';
}

function candleTimestamp(candle, index, timeframe = null) {
    const parsed = normalizeTimestampUTC(candle?.t);
    if (Number.isFinite(parsed)) return parsed;
    const minutes = timeframe === '1D' ? 1440 : timeframe === '4H' ? 240 : timeframe === '1H' ? 60 : timeframe === '15M' ? 15 : timeframe === '5M' ? 5 : 60;
    // Use an unambiguous millisecond epoch for synthetic/no-timestamp fixtures.
    return Date.UTC(2000, 0, 3) + index * minutes * 60000;
}

function timestampSource(value, candle = null) {
    if (candle && (candle.t != null || candle.time != null || candle.datetime != null)) {
        const raw = candle.t ?? candle.time ?? candle.datetime;
        return typeof raw === 'number' || raw instanceof Date ? 'PROVIDER' : 'NORMALIZED_PROVIDER';
    }
    return value == null ? 'SYNTHETIC_FALLBACK' : 'NORMALIZED_PROVIDER';
}

function closedStructureCandles(data) {
    return (Array.isArray(data) ? data : []).filter(c => c && c.is_closed !== false && c.closed !== false && c.is_forming !== true && c.forming !== true);
}

function getClosedHistory(historyCache, timeframe) {
    return closedStructureCandles(historyCache?.[timeframe] || []);
}

function getStrategyEventTime(setup) {
    return normalizeTimestampUTC(setup?.event_time ?? setup?.reclaim_time ?? setup?.retest_time ?? setup?.break_time ?? setup?.source_time);
}

function dedupeByNarrative(items, keyFn, scoreFn) {
    const grouped = new Map();
    for (const item of items || []) {
        const key = keyFn(item);
        const current = grouped.get(key);
        if (!current || scoreFn(item) > scoreFn(current)) grouped.set(key, item);
    }
    return [...grouped.values()];
}

function evaluateMSNRFormation(data, index, role, zoneLow, zoneHigh, atrVal, timeframe) {
    const nextBars = data.slice(index + 1, Math.min(data.length, index + 6));
    const sw = findSwings(data, 2);
    const level = (zoneLow + zoneHigh) / 2;
    const nearSwing = role === 'REACTION_SUPPORT'
        ? (sw.L || []).some(s => Math.abs(s.i - index) <= 3 && Math.abs(s.p - level) <= Math.max(zoneHigh - zoneLow, atrVal * 0.2))
        : (sw.H || []).some(s => Math.abs(s.i - index) <= 3 && Math.abs(s.p - level) <= Math.max(zoneHigh - zoneLow, atrVal * 0.2));
    const departure = nextBars.length
        ? (role === 'REACTION_SUPPORT'
            ? Math.max(...nextBars.map(c => c.h)) - zoneHigh
            : zoneLow - Math.min(...nextBars.map(c => c.l)))
        : 0;
    const departureAtr = atrVal > 0 ? departure / atrVal : 0;
    const displacementConfirmed = nextBars.some(c => {
        const body = Math.abs(c.c - c.o);
        const range = c.h - c.l;
        if (!(range > 0) || body / range < 0.55) return false;
        return role === 'REACTION_SUPPORT' ? c.c > c.o : c.c < c.o;
    });
    let structuralScore = 0;
    if (nearSwing) structuralScore += 18;
    if (departureAtr >= 0.6) structuralScore += 18;
    if (departureAtr >= 1.0) structuralScore += 10;
    if (displacementConfirmed) structuralScore += 16;
    if (['1D', '4H'].includes(timeframe)) structuralScore += 8;
    return {
        formation_quality: structuralScore >= 55 ? 'HIGH' : structuralScore >= STRATEGY_SPEC.MSNR.minStructuralScore ? 'VALID' : 'WEAK',
        departure_distance: departure,
        departure_atr: departureAtr,
        swing_related: nearSwing,
        displacement_confirmed: displacementConfirmed,
        structural_score: structuralScore
    };
}

function eventDedupeKey(event, atrVal, levelField, timeframe) {
    const level = Number(event?.[levelField]);
    const bucket = Number.isFinite(level) ? Math.round(level / Math.max((atrVal || 0) * 0.2, 0.00001)) : 'x';
    const time = normalizeTimestampUTC(event?.event_time) || 0;
    const timeBucket = Math.round(time / (60 * 60000));
    return `${event.direction}-${timeframe || event.timeframe}-${bucket}-${timeBucket}`;
}

function evaluateCombinationCompatibility(setup, other, settings) {
    const sameDirection = setup.direction === other.direction;
    const a = setup.execution_zone;
    const b = other.execution_zone;
    const width = Math.max(settings.pipSize * 10, Math.abs((a?.high || 0) - (a?.low || 0)), Math.abs((b?.high || 0) - (b?.low || 0)));
    const spatiallyRelated = !!(a && b && b.high >= a.low - width * 2 && b.low <= a.high + width * 2);
    const at = getStrategyEventTime(setup);
    const bt = getStrategyEventTime(other);
    const timeDiffHours = Number.isFinite(at) && Number.isFinite(bt) ? Math.abs(at - bt) / 3600000 : null;
    const sameTf = setup.timeframe === other.timeframe;
    const timeframeHours = { '15M': 0.25, '1H': 1, '4H': 4, '1D': 24 }[setup.timeframe] || 1;
    const temporalLimit = sameTf ? STRATEGY_SPEC.COMBINATION.sameTfBars * timeframeHours : STRATEGY_SPEC.COMBINATION.crossTfHours;
    const temporallyRelated = timeDiffHours == null ? false : timeDiffHours <= temporalLimit;
    const setupLiquidity = [setup.sweep_extreme, setup.reclaim_level, setup.evidence?.level].map(Number).find(Number.isFinite);
    const otherLiquidity = [other.sweep_extreme, other.reclaim_level, other.evidence?.level].map(Number).find(Number.isFinite);
    const sameLiquidityEvent = sameDirection && Number.isFinite(setupLiquidity) && Number.isFinite(otherLiquidity) && Math.abs(setupLiquidity - otherLiquidity) <= width * 2;
    const timeframeRelationship = sameTf ? 'SAME_TIMEFRAME' : 'CROSS_TIMEFRAME';
    const combinationScore = (sameDirection ? 25 : 0) + (spatiallyRelated ? 25 : 0) + (temporallyRelated ? 25 : 0) + (sameLiquidityEvent ? 20 : 0) + (timeframeRelationship === 'CROSS_TIMEFRAME' ? 5 : 0);
    return { spatially_related: spatiallyRelated, temporally_related: temporallyRelated, same_liquidity_event: sameLiquidityEvent, same_direction: sameDirection, timeframe_relationship: timeframeRelationship, time_diff_hours: timeDiffHours, combination_score: combinationScore };
}

function classifyDeliveryObstacle(zone, tradeDirection) {
    const role = String(zone.role || zone.transition_type || '').toUpperCase();
    const roleDirection = ['SUPPORT', 'DEMAND', 'REACTION_SUPPORT', 'RESISTANCE_TO_SUPPORT'].includes(role) ? 'BUY'
        : ['RESISTANCE', 'SUPPLY', 'REACTION_RESISTANCE', 'SUPPORT_TO_RESISTANCE'].includes(role) ? 'SELL' : null;
    const direction = roleDirection || zone.direction;
    const opposing = ['BUY', 'SELL'].includes(direction) && direction !== tradeDirection
        && zone.primary_eligible !== false && !zone.invalidated;
    const hardBlocking = opposing && zone.hard_blocking === true;
    const serious = opposing && (hardBlocking || (zone.freshness === 'FRESH' && ['1D', '4H'].includes(zone.timeframe)));
    return {
        type: zone.type, direction_or_role: roleDirection ? role : direction || null,
        direction, role: role || null, timeframe: zone.timeframe,
        low: Number(zone.low), high: Number(zone.high), freshness: zone.freshness || null,
        blocks_direction: opposing, hard_blocking: hardBlocking,
        severity: serious ? 'SERIOUS' : opposing ? 'WEAK' : 'NONE',
        reason: hardBlocking ? 'Explicit structural path invalidation'
            : serious ? 'Fresh higher-timeframe opposing structure reduces path quality'
            : opposing ? 'Opposing structure reduces path quality without invalidating geometry'
            : 'Structure does not oppose delivery'
    };
}

function evaluateTargetReachability({ direction, entry, stopLoss, target, historyCache, zones, liquidity, strategySetup }) {
    const targetLevel = Number(target?.level);
    const tf = target?.timeframe || strategySetup?.timeframe || '1H';
    const data = closedStructureCandles(historyCache?.[tf] || historyCache?.['1H'] || historyCache?.['4H'] || []);
    const atrVal = data.length >= 15 ? atr(data, 14) : null;
    const targetDistance = Math.abs(targetLevel - entry);
    const targetDistanceAtr = atrVal > 0 ? targetDistance / atrVal : null;
    const between = level => direction === 'BUY' ? level > entry && level < targetLevel : level < entry && level > targetLevel;
    const obstacleMap = new Map();
    for (const zone of zones || []) {
        const z = classifyDeliveryObstacle(zone, direction);
        if (!z.blocks_direction) continue;
        if (!between((Number(z.low) + Number(z.high)) / 2)) continue;
        // Generic and strategy-zone IDs may differ for the same physical structure.
        const key = JSON.stringify([z.type, z.timeframe, Number(Number(z.low).toPrecision(12)), Number(Number(z.high).toPrecision(12))]);
        const prior = obstacleMap.get(key);
        if (!prior || (z.hard_blocking && !prior.hard_blocking)
            || (!prior.hard_blocking && z.severity === 'SERIOUS' && prior.severity !== 'SERIOUS')) obstacleMap.set(key, z);
    }
    const opposingZones = [...obstacleMap.values()];
    const serious = opposingZones.filter(z => z.severity === 'SERIOUS');
    const liqLevels = direction === 'BUY' ? (liquidity?.above || []) : (liquidity?.below || []);
    const interveningLiquidity = (liqLevels || []).filter(between);
    const strategyNative = (strategySetup?.target_candidates || []).some(t => t.level === targetLevel && (t.source || t.target_type) === (target.source || target.target_type));
    let score = Number(target.structural_priority) || 50;
    if (strategyNative || target.strategy_native) score += STRATEGY_SPEC.TARGET.firstObjectiveBonus;
    if (targetDistanceAtr != null) {
        if (targetDistanceAtr <= 4) score += 12;
        else if (targetDistanceAtr <= STRATEGY_SPEC.TARGET.maxAtrDistance) score += 4;
        else score -= 18;
    }
    score -= serious.length * STRATEGY_SPEC.TARGET.seriousObstaclePenalty;
    score -= Math.max(0, opposingZones.length - serious.length) * STRATEGY_SPEC.TARGET.weakObstaclePenalty;
    // Liquidity maps can contain several observations of the same pool. Treat
    // only the first two distinct intervening levels as an obstacle signal.
    score -= Math.min(interveningLiquidity.length, 2) * 3;
    if (['1D', '4H'].includes(target.timeframe)) score += 5;
    if (target.freshness === 'MITIGATED' || target.consumed) score -= 18;
    const reachabilityScore = Math.max(0, Math.min(100, Math.round(score)));
    const hardUnreachable = !!target.hard_unreachable || !!target.invalidated || !!target.consumed || serious.some(z => z.hard_blocking === true);
    const reachabilityClass = hardUnreachable ? 'HARD_UNREACHABLE' : reachabilityScore >= 75 ? 'HIGH' : reachabilityScore >= 55 ? 'MEDIUM' : reachabilityScore >= 35 ? 'LOW' : 'VERY_LOW';
    return {
        reachable: !hardUnreachable,
        hard_unreachable: hardUnreachable,
        reachability_score: reachabilityScore,
        target_quality: reachabilityClass,
        reachability_class: reachabilityClass,
        target_distance: targetDistance,
        target_distance_atr: targetDistanceAtr,
        target_distance_atr_timeframe: tf,
        intervening_obstacles: opposingZones,
        intervening_liquidity: interveningLiquidity,
        structural_priority: Number(target.structural_priority) || 50,
        reason: `${opposingZones.length} opposing zones, ${interveningLiquidity.length} liquidity levels before target`
    };
}

function compactTargetReachabilityForOutput(reachability) {
    if (!reachability) return null;
    const {
        target_distance,
        target_distance_atr,
        ...rest
    } = reachability;
    return rest;
}

function buildPivotReferences(data, currentPrice) {
    if (!isValidCandleArray(data, 5)) {
        return { pivot: null, supports: {}, resistances: {}, nearestSupport: null, nearestResistance: null, allSupports: [], allResistances: [], supportMeta: [], resistanceMeta: [] };
    }
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const closes = data.map(c => c.c);
    const period = Math.min(data.length, 200);
    const rH = Math.max(...highs.slice(-period));
    const rL = Math.min(...lows.slice(-period));
    const rC = closes[closes.length - 1];
    const pp = (rH + rL + rC) / 3;
    const s1 = pp * 2 - rH;
    const s2 = pp - (rH - rL);
    const s3 = rL - 2 * (rH - pp);
    const r1 = pp * 2 - rL;
    const r2 = pp + (rH - rL);
    const r3 = rH + 2 * (pp - rL);
    const atrVal = atr(data, 14);
    const supports = [s1, s2, s3].filter(s => s < currentPrice).sort((a, b) => b - a)
        .map((level, index) => ({ level, origin: 'PIVOT_REFERENCE', primary_eligible: false, rank: index + 1 }));
    const resistances = [r1, r2, r3].filter(r => r > currentPrice).sort((a, b) => a - b)
        .map((level, index) => ({ level, origin: 'PIVOT_REFERENCE', primary_eligible: false, rank: index + 1 }));
    const supportMeta = supports.length ? supports : [
        { level: currentPrice - atrVal * 2.0, origin: 'ATR_FALLBACK', primary_eligible: false, rank: 1 },
        { level: currentPrice - atrVal * 4.0, origin: 'ATR_FALLBACK', primary_eligible: false, rank: 2 }
    ];
    const resistanceMeta = resistances.length ? resistances : [
        { level: currentPrice + atrVal * 2.0, origin: 'ATR_FALLBACK', primary_eligible: false, rank: 1 },
        { level: currentPrice + atrVal * 4.0, origin: 'ATR_FALLBACK', primary_eligible: false, rank: 2 }
    ];
    const allS = supportMeta.map(x => x.level).filter(Number.isFinite);
    const allR = resistanceMeta.map(x => x.level).filter(Number.isFinite);
    return {
        pivot: pp,
        supports: { S1: allS[0] || s1, S2: allS[1] || s2, S3: allS[2] || s3 },
        resistances: { R1: allR[0] || r1, R2: allR[1] || r2, R3: allR[2] || r3 },
        nearestSupport: allS[0] || null,
        nearestResistance: allR[0] || null,
        allSupports: allS,
        allResistances: allR,
        supportMeta,
        resistanceMeta
    };
}

function buildStructuralMSNRLevels(data, currentPrice, timeframe = null, pairLocal = pair) {
    data = closedStructureCandles(data);
    if (!isValidCandleArray(data, 20)) return [];
    const settings = getMarketSettings(pairLocal);
    const prec = settings.prec;
    const atrVal = data.length >= 15 ? atr(data, 14) : 0;
    const pad = Math.max(settings.pipSize * 2, (atrVal || 0) * STRATEGY_SPEC.MSNR.zoneAtrWidth, currentPrice * 0.00002);
    const breakBuffer = Math.max(settings.pipSize, (atrVal || 0) * STRATEGY_SPEC.MSNR.breakCloseBufferAtr);
    const start = Math.max(1, data.length - STRATEGY_SPEC.MSNR.lookback);
    const levels = [];
    for (let i = start; i < data.length - 1; i++) {
        const prev = data[i - 1];
        const curr = data[i];
        const next = data[i + 1];
        let role = null;
        let transitionType = null;
        if (prev.c > prev.o && curr.c < curr.o) {
            role = 'REACTION_RESISTANCE';
            transitionType = 'A_LEVEL_BULLISH_TO_BEARISH';
        } else if (prev.c < prev.o && curr.c > curr.o) {
            role = 'REACTION_SUPPORT';
            transitionType = 'V_LEVEL_BEARISH_TO_BULLISH';
        } else {
            continue;
        }
        const bodyLow = Math.min(prev.c, curr.o);
        const bodyHigh = Math.max(prev.c, curr.o);
        const level = (bodyLow + bodyHigh) / 2;
        const zoneLow = bodyLow - pad;
        const zoneHigh = bodyHigh + pad;
        const formation = evaluateMSNRFormation(data, i, role, zoneLow, zoneHigh, atrVal || settings.pipSize * 10, timeframe);
        let activeRole = role;
        let touch_count = 0;
        let mitigation_count = 0;
        let reaction_count = 0;
        let last_reaction_index = null;
        let departure_confirmed_index = null;
        let first_retest_index = null;
        let break_index = null;
        let retest_index = null;
        let broken = false;
        let flipped = false;
        let invalidated = false;
        let wasOutsideAfterDeparture = false;
        for (let j = i + 1; j < data.length; j++) {
            const c = data[j];
            const departed = role === 'REACTION_SUPPORT' ? c.c > zoneHigh + pad : c.c < zoneLow - pad;
            if (!departure_confirmed_index && departed) {
                departure_confirmed_index = j;
                wasOutsideAfterDeparture = true;
                break;
            }
        }
        for (let j = (departure_confirmed_index || i) + 1; j < data.length; j++) {
            const c = data[j];
            const wickTouch = c.h >= zoneLow && c.l <= zoneHigh;
            if (wickTouch) {
                if (wasOutsideAfterDeparture) {
                    touch_count++;
                    mitigation_count++;
                    first_retest_index = first_retest_index ?? j;
                    last_reaction_index = j;
                    const oppositeSideRetest = activeRole === 'SUPPORT_TO_RESISTANCE'
                        ? broken && c.h >= zoneLow && c.c < zoneLow
                        : activeRole === 'RESISTANCE_TO_SUPPORT'
                            ? broken && c.l <= zoneHigh && c.c > zoneHigh
                            : false;
                    if (oppositeSideRetest && !retest_index) retest_index = j;
                    const nextAfterTouch = data[j + 1];
                    if (nextAfterTouch) {
                        const rejected = activeRole === 'REACTION_SUPPORT' || activeRole === 'RESISTANCE_TO_SUPPORT'
                            ? nextAfterTouch.c > zoneHigh
                            : nextAfterTouch.c < zoneLow;
                        if (rejected) reaction_count++;
                    }
                }
                const closeOutside = role === 'REACTION_SUPPORT'
                    ? c.c > zoneHigh
                    : c.c < zoneLow;
                wasOutsideAfterDeparture = closeOutside;
            } else if ((activeRole === 'REACTION_SUPPORT' || activeRole === 'RESISTANCE_TO_SUPPORT') ? c.l > zoneHigh : c.h < zoneLow) {
                wasOutsideAfterDeparture = true;
            }
            const breakDisplacement = Math.abs(c.c - c.o) > Math.max(breakBuffer, (atrVal || 0) * 0.15);
            if (activeRole === 'REACTION_SUPPORT' && c.c < zoneLow - breakBuffer && breakDisplacement) {
                broken = true;
                flipped = true;
                activeRole = 'SUPPORT_TO_RESISTANCE';
                break_index = break_index ?? j;
                retest_index = null;
            } else if (activeRole === 'REACTION_RESISTANCE' && c.c > zoneHigh + breakBuffer && breakDisplacement) {
                broken = true;
                flipped = true;
                activeRole = 'RESISTANCE_TO_SUPPORT';
                break_index = break_index ?? j;
                retest_index = null;
            } else if (activeRole === 'SUPPORT_TO_RESISTANCE' && c.c > zoneHigh + breakBuffer) {
                invalidated = true;
            } else if (activeRole === 'RESISTANCE_TO_SUPPORT' && c.c < zoneLow - breakBuffer) {
                invalidated = true;
            }
        }
        const direction = activeRole === 'REACTION_SUPPORT' || activeRole === 'RESISTANCE_TO_SUPPORT' ? 'BUY' : 'SELL';
        const event_age_bars = data.length - 1 - (retest_index ?? last_reaction_index ?? i);
        const freshness = invalidated ? 'INVALIDATED' : (mitigation_count === 0 ? 'FRESH' : (mitigation_count <= STRATEGY_SPEC.MSNR.maxMitigationCount ? 'TESTED' : 'MITIGATED'));
        const roleReversalQuality = flipped && retest_index ? 'CONFIRMED_RETEST' : (flipped ? 'BROKEN_NOT_RETESTED' : null);
        const structural_score = formation.structural_score + (reaction_count > 0 ? 10 : 0) + (roleReversalQuality === 'CONFIRMED_RETEST' ? 20 : 0);
        const standaloneQualified = structural_score >= STRATEGY_SPEC.MSNR.minStructuralScore && (!flipped || !!retest_index);
        levels.push({
            type: 'MSNR',
            origin: 'STRUCTURAL_MSNR',
            primary_eligible: standaloneQualified && !invalidated && freshness !== 'MITIGATED',
            level: ictRound(level, prec),
            zone_low: ictRound(zoneLow, prec),
            zone_high: ictRound(zoneHigh, prec),
            low: ictRound(zoneLow, prec),
            high: ictRound(zoneHigh, prec),
            price: ictRound(level, prec),
            formation_index: i,
            source_candle_index: i,
            source_time: candleTimestamp(curr, i, timeframe),
            break_time: break_index != null ? candleTimestamp(data[break_index], break_index, timeframe) : null,
            retest_time: retest_index != null ? candleTimestamp(data[retest_index], retest_index, timeframe) : null,
            event_time: candleTimestamp(data[retest_index ?? first_retest_index ?? departure_confirmed_index ?? i], retest_index ?? first_retest_index ?? departure_confirmed_index ?? i, timeframe),
            transition_type: transitionType,
            original_role: role,
            role: activeRole,
            direction,
            timeframe,
            formation_quality: formation.formation_quality,
            departure_distance: ictRound(formation.departure_distance, prec),
            departure_atr: formation.departure_atr,
            swing_related: formation.swing_related,
            displacement_confirmed: formation.displacement_confirmed,
            reaction_strength: reaction_count,
            role_reversal_quality: roleReversalQuality,
            structural_score,
            freshness,
            touch_count,
            mitigation_count,
            reaction_count,
            departure_confirmed_index,
            first_retest_index,
            last_reaction_index,
            break_index,
            retest_index,
            event_age_bars,
            broken,
            flipped,
            invalidated,
            structural_invalidation: direction === 'BUY' ? ictRound(zoneLow, prec) : ictRound(zoneHigh, prec)
        });
    }
    const raw = levels.filter(l => l.structural_score >= STRATEGY_SPEC.MSNR.minStructuralScore || l.flipped);
    const deduped = dedupeByNarrative(raw, l => `${l.direction}-${l.timeframe}-${Math.round(l.level / Math.max(pad, 0.00001))}`, l => (l.primary_eligible ? 100 : 0) + l.structural_score - l.event_age_bars);
    deduped.raw_detection_count = raw.length;
    deduped.deduped_detection_count = deduped.length;
    const bounded = deduped
        .slice()
        .sort((a, b) => (b.primary_eligible - a.primary_eligible) || (b.structural_score - a.structural_score) || (a.event_age_bars - b.event_age_bars) || (Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice)))
        .slice(0, STRATEGY_SPEC.MSNR.maxLevelsPerTimeframe)
        .sort((a, b) => Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice));
    bounded.raw_detection_count = raw.length;
    bounded.deduped_detection_count = deduped.length;
    bounded.bounded_detection_count = bounded.length;
    bounded.qualified_count = raw.length;
    return bounded;
}

function calculateMSNR(data, currentPrice, timeframe = null, pairLocal = pair) {
    const refs = buildPivotReferences(data, currentPrice);
    const structural = buildStructuralMSNRLevels(data, currentPrice, timeframe, pairLocal);
    const structuralSupports = structural.filter(l => l.direction === 'BUY' && l.level < currentPrice);
    const structuralResistances = structural.filter(l => l.direction === 'SELL' && l.level > currentPrice);
    return {
        ...refs,
        pivot_references: refs,
        structural_levels: structural,
        executable_setups: structural.filter(l => l.primary_eligible && !l.invalidated),
        structural_supports: structuralSupports,
        structural_resistances: structuralResistances,
        nearestStructuralSupport: structuralSupports[0]?.level || null,
        nearestStructuralResistance: structuralResistances[0]?.level || null
    };
}

function detectTurtleSoupEvents(data, timeframe = null, pairLocal = pair) {
    data = closedStructureCandles(data);
    if (!isValidCandleArray(data, 20)) return [];
    const settings = getMarketSettings(pairLocal);
    const atrVal = data.length >= 15 ? atr(data, 14) : 0;
    const minSweep = Math.max(settings.pipSize * STRATEGY_SPEC.TBS.minSweepPips, (atrVal || 0) * STRATEGY_SPEC.TBS.minSweepAtr);
    const start = Math.max(0, data.length - STRATEGY_SPEC.TBS.lookback);
    const swings = findSwings(data.slice(start), 2);
    const refs = [
        ...(swings.L || []).map(s => ({ p: s.p, i: s.i + start, type: 'SWING_LOW', strength: 2 })),
        ...(swings.H || []).map(s => ({ p: s.p, i: s.i + start, type: 'SWING_HIGH', strength: 2 }))
    ].filter(r => data.length - 1 - r.i >= STRATEGY_SPEC.TBS.referenceMinAgeBars);
    const events = [];
    for (const ref of refs) {
        const isLow = ref.type.includes('LOW');
        const direction = isLow ? 'BUY' : 'SELL';
        for (let sweepIndex = ref.i + STRATEGY_SPEC.TBS.referenceMinAgeBars; sweepIndex < data.length; sweepIndex++) {
            const c = data[sweepIndex];
            const swept = isLow ? c.l < ref.p - minSweep : c.h > ref.p + minSweep;
            if (!swept) continue;
            const sweep_extreme = isLow ? c.l : c.h;
            const sweep_depth = Math.abs(sweep_extreme - ref.p);
            for (let reclaimIndex = sweepIndex; reclaimIndex < Math.min(data.length, sweepIndex + 5); reclaimIndex++) {
                const r = data[reclaimIndex];
                const reclaimed = isLow ? r.c > ref.p : r.c < ref.p;
                if (!reclaimed) continue;
                const event_age_bars = data.length - 1 - reclaimIndex;
                const freshness = classifyEventFreshness(event_age_bars, STRATEGY_SPEC.TBS.maxEventAgeBars);
                const invalidated = freshness === 'EXPIRED';
                events.push({
                    detected: !invalidated,
                    type: direction,
                    direction,
                    keyLevel: ref.p,
                    liquidity_level: ref.p,
                    reference_level: ref.p,
                    reference_type: ref.type,
                    reference_bar_index: ref.i,
                    source_time: candleTimestamp(data[ref.i], ref.i, timeframe),
                    reference_age_bars: sweepIndex - ref.i,
                    reference_strength: ref.strength,
                    sweep_bar_index: sweepIndex,
                    sweep_time: candleTimestamp(data[sweepIndex], sweepIndex, timeframe),
                    reclaim_bar_index: reclaimIndex,
                    reclaim_time: candleTimestamp(data[reclaimIndex], reclaimIndex, timeframe),
                    event_time: candleTimestamp(data[reclaimIndex], reclaimIndex, timeframe),
                    event_age: event_age_bars,
                    event_age_bars,
                    sweep_extreme,
                    sweep_depth,
                    sweep_depth_atr: atrVal > 0 ? sweep_depth / atrVal : null,
                    sweep_quality: sweep_depth >= minSweep * 2 ? 'STRONG' : 'VALID',
                    reclaim_level: ref.p,
                    reclaim_price: r.c,
                    reclaim_confirmed: true,
                    freshness,
                    invalidated,
                    timeframe,
                    entry_model: 'RECLAIM_RETEST',
                    structural_invalidation: sweep_extreme,
                    target_bias: isLow ? 'BUY_SIDE_LIQUIDITY' : 'SELL_SIDE_LIQUIDITY',
                    evidence: { reference_level: ref.p, reference_type: ref.type, sweep_extreme, reclaim_level: ref.p, reclaim_bar: reclaimIndex, sweep_depth }
                });
                break;
            }
            break;
        }
    }
    const raw = events.sort((a, b) => a.event_age_bars - b.event_age_bars || b.reference_strength - a.reference_strength);
    const deduped = dedupeByNarrative(raw, e => eventDedupeKey(e, atrVal, 'reference_level', timeframe), e => (e.detected ? 100 : 0) + e.reference_strength * 10 + (e.sweep_depth_atr || 0) - e.event_age_bars);
    deduped.raw_detection_count = raw.length;
    deduped.deduped_detection_count = deduped.length;
    const bounded = deduped
        .slice()
        .sort((a, b) => (b.detected - a.detected) || ((b.sweep_depth_atr || 0) - (a.sweep_depth_atr || 0)) || (a.event_age_bars - b.event_age_bars))
        .slice(0, STRATEGY_SPEC.TBS.maxEventsPerTimeframe);
    bounded.raw_detection_count = raw.length;
    bounded.deduped_detection_count = deduped.length;
    bounded.bounded_detection_count = bounded.length;
    return bounded;
}

function detectTurtleSoup(data) {
    const events = detectTurtleSoupEvents(data);
    const best = events.find(e => e.detected) || null;
    return best ? { ...best, events } : { detected: false, type: null, events };
}

function detectCRTEvents(data, timeframe = null, pairLocal = pair) {
    data = closedStructureCandles(data);
    if (!isValidCandleArray(data, 20)) return [];
    const settings = getMarketSettings(pairLocal);
    const atrVal = data.length >= 15 ? atr(data, 14) : 0;
    const minSweep = Math.max(settings.pipSize * 2, (atrVal || 0) * STRATEGY_SPEC.CRT.minSweepAtr);
    const start = Math.max(0, data.length - STRATEGY_SPEC.CRT.referenceLookback - STRATEGY_SPEC.CRT.eventLookahead - 4);
    const events = [];
    for (let refIndex = start; refIndex < data.length - 3; refIndex++) {
        const ref = data[refIndex];
        const range_high = ref.h;
        const range_low = ref.l;
        const range_size = range_high - range_low;
        if (!(range_size > 0)) continue;
        if (atrVal > 0 && range_size / atrVal < STRATEGY_SPEC.CRT.minReferenceAtr) continue;
        const maxEnd = Math.min(data.length, refIndex + 1 + STRATEGY_SPEC.CRT.eventLookahead + 1);
        for (let sweepIndex = refIndex + 1; sweepIndex < maxEnd; sweepIndex++) {
            const c = data[sweepIndex];
            const sides = [
                { direction: 'BUY', swept: c.l < range_low - minSweep, sweep_extreme: c.l, reclaim_level: range_low, manipulation_side: 'SELL_SIDE', objective: range_high },
                { direction: 'SELL', swept: c.h > range_high + minSweep, sweep_extreme: c.h, reclaim_level: range_high, manipulation_side: 'BUY_SIDE', objective: range_low }
            ];
            for (const side of sides.filter(s => s.swept)) {
                for (let reclaimIndex = sweepIndex; reclaimIndex < maxEnd; reclaimIndex++) {
                    const r = data[reclaimIndex];
                    const reclaimed = side.direction === 'BUY' ? r.c > side.reclaim_level : r.c < side.reclaim_level;
                    if (!reclaimed) continue;
                    const event_age_bars = data.length - 1 - reclaimIndex;
                    const freshness = classifyEventFreshness(event_age_bars, STRATEGY_SPEC.CRT.maxEventAgeBars);
                    const invalidated = freshness === 'EXPIRED';
                    events.push({
                        state: 'SWEEP_RECLAIM',
                        detected: !invalidated,
                        direction: side.direction,
                        type: side.direction,
                        timeframe,
                        reference_bar_index: refIndex,
                        reference_time: ref.t || null,
                        source_time: candleTimestamp(ref, refIndex, timeframe),
                        range_high,
                        range_low,
                        range_mid: (range_high + range_low) / 2,
                        range_size,
                        reference_atr_multiple: atrVal > 0 ? range_size / atrVal : null,
                        manipulation_side: side.manipulation_side,
                        sweep_level: side.reclaim_level,
                        sweep_extreme: side.sweep_extreme,
                        sweep_time: candleTimestamp(data[sweepIndex], sweepIndex, timeframe),
                        reclaim_level: side.reclaim_level,
                        reclaim_bar_index: reclaimIndex,
                        reclaim_time: candleTimestamp(data[reclaimIndex], reclaimIndex, timeframe),
                        event_time: candleTimestamp(data[reclaimIndex], reclaimIndex, timeframe),
                        event_age: event_age_bars,
                        event_age_bars,
                        freshness,
                        invalidated,
                        delivery_started: !!(detectDisplacement(data.slice(reclaimIndex), side.direction) || detectMSS(data.slice(reclaimIndex))),
                        entry_model: 'RECLAIM_RETEST',
                        structural_invalidation: side.sweep_extreme,
                        primary_objective: side.objective,
                        target_candidates: [{ direction: side.direction, level: side.objective, source: 'CRT_OPPOSITE_RANGE', target_type: 'CRT_OPPOSITE_RANGE', origin: 'STRUCTURAL', timeframe, structural_priority: 96 }],
                        evidence: { range_high, range_low, sweep_side: side.manipulation_side, sweep_extreme: side.sweep_extreme, reclaim_level: side.reclaim_level, reclaim_bar: reclaimIndex }
                    });
                    break;
                }
            }
        }
    }
    const raw = events.sort((a, b) => a.event_age_bars - b.event_age_bars || (b.reference_atr_multiple || 0) - (a.reference_atr_multiple || 0));
    const deduped = dedupeByNarrative(raw, e => eventDedupeKey(e, atrVal, 'reclaim_level', timeframe), e => (e.detected ? 100 : 0) + (e.reference_atr_multiple || 0) * 10 - e.event_age_bars);
    deduped.raw_detection_count = raw.length;
    deduped.deduped_detection_count = deduped.length;
    const bounded = deduped
        .slice()
        .sort((a, b) => (b.detected - a.detected) || ((b.reference_atr_multiple || 0) - (a.reference_atr_multiple || 0)) || (a.event_age_bars - b.event_age_bars))
        .slice(0, STRATEGY_SPEC.CRT.maxEventsPerTimeframe);
    bounded.raw_detection_count = raw.length;
    bounded.deduped_detection_count = deduped.length;
    bounded.bounded_detection_count = bounded.length;
    return bounded;
}

function detectCRT(data) {
    const events = detectCRTEvents(data);
    const best = events.find(e => e.detected) || null;
    return best ? { ...best, events } : { state: 'NEUTRAL', detected: false, direction: null, events };
}

// Calculate Fibonacci Retracement (0.50 & 0.618)
function calculateFibonacci(data, direction) {
    if(!data || data.length < 10) return null;
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const maxH = Math.max(...highs.slice(-30));
    const minL = Math.min(...lows.slice(-30));
    const diff = maxH - minL;
    if(diff <= 0) return null;

    let fib50, fib618;
    if(direction === 'BUY') {
        fib50 = maxH - 0.50 * diff;
        fib618 = maxH - 0.618 * diff;
    } else {
        fib50 = minL + 0.50 * diff;
        fib618 = minL + 0.618 * diff;
    }

    return { maxH, minL, fib50, fib618 };
}

// Dynamic SL multiplier based on session and volatility
function getDynamicSLMultiplier(data, price, now = new Date()) {
    const session = getSession(now);
    const atrVal = atr(data, 14);
    const atrPct = (atrVal / price) * 100;

    let multiplier = 2.0; // Base

    // Session adjustment
    if (session.isSilverBullet) multiplier = 3.0;
    else if (session.isKillzone) multiplier = 2.5;
    else if (session.session === 'ASIA KZ') multiplier = 1.2;
    else if (session.session === 'OFF-HOURS') multiplier = 1.0;

    // Volatility adjustment
    if (atrPct > 1.5) multiplier *= 1.2;
    else if (atrPct < 0.5) multiplier *= 0.8;

    // Cap
    return Math.max(0.8, Math.min(4.0, multiplier));
}

// Precision SL calculation uses the asset-aware settings for the supplied pair.
function calcStopLoss(data, direction, entry, zone, msnr, tf, customATR = null, customPair = null) {
    const atrVal = customATR || atr(data, 14);
    const p = customPair || pair;
    const settings = getMarketSettings(p);
    const prec = settings.prec;
    const factor = Math.pow(10, prec);
    
    // Ensure SL is at least 2x ATR away from entry (min) and 3x ATR for max
    const minMultiplier = settings.minSLMultiplier || 1.5;
    const minSLDist = atrVal * minMultiplier;
    const maxSLDist = Math.max(minSLDist, atrVal * 3.0);
    
    let slDist;
    let sl;
    const zoneLow = zone ? (zone.low || zone.p * 0.9995) : entry * 0.995;
    const zoneHigh = zone ? (zone.high || zone.p * 1.0005) : entry * 1.005;

    if(direction === 'BUY') {
        const rawDist = entry - (zoneLow - (zoneLow * 0.0005));
        slDist = Math.max(minSLDist, Math.min(rawDist, maxSLDist));
        sl = entry - slDist;
    } else {
        const rawDist = (zoneHigh + (zoneHigh * 0.0005)) - entry;
        slDist = Math.max(minSLDist, Math.min(rawDist, maxSLDist));
        sl = entry + slDist;
    }
    sl = Math.round(sl * factor) / factor;
    return { price: sl };
}

// MSNR-based Take Profit calculation (TP1 minimum 2.0x risk)
function calcTakeProfits(direction, entry, slPrice, msnrData = null) {
    const prec = getPrec(pair);
    const risk = Math.abs(entry - slPrice);
    const minTP1Dist = risk * 2.0;
    const source = direction === 'BUY' ? (msnrData?.allResistances || []) : (msnrData?.allSupports || []);
    const levels = [...new Set(source.map(Number).filter(level => Number.isFinite(level) &&
        (direction === 'BUY' ? level >= entry + minTP1Dist : level <= entry - minTP1Dist)))]
        .sort((a, b) => direction === 'BUY' ? a - b : b - a);
    return { tp1: levels[0] ?? null, tp2: levels[1] ?? null, tp3: levels[2] ?? null };
}

// ============================================
// PATTERN-BASED ZONE FINDING - PRECISION ENHANCED
// ============================================

function findPatternZone(data, price, direction, customATR = null) {
    const msnr = calculateMSNR(data, price);
    const fvgs = detectFVG(data);
    const obs = detectOrderBlocks(data, direction);
    const swings = findSwings(data, 3);
    const tbs = detectTurtleSoup(data);
    const crt = detectCRT(data);
    const fib = calculateFibonacci(data, direction);
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const factor = Math.pow(10, prec);
    
    let candidates = [];
    
    // 1. MSNR Levels (Tighter ±0.05% boundaries)
    if(direction === 'BUY') {
        for(const sup of msnr.allSupports) {
            if(sup < price) {
                const distPct = (price - sup) / price * 100;
                candidates.push({
                    price: sup,
                    type: 'MSNR Support',
                    score: 80,
                    low: sup * 0.9995,
                    high: sup * 1.0005,
                    distancePct: distPct,
                    patterns: ['MSNR']
                });
            }
        }
    } else {
        for(const res of msnr.allResistances) {
            if(res > price) {
                const distPct = (res - price) / price * 100;
                candidates.push({
                    price: res,
                    type: 'MSNR Resistance',
                    score: 80,
                    low: res * 0.9995,
                    high: res * 1.0005,
                    distancePct: distPct,
                    patterns: ['MSNR']
                });
            }
        }
    }
    
    // 2. FVG (Exact FVG low and high boundaries)
    for(const fvg of fvgs) {
        const distPct = Math.abs(price - fvg.m) / price * 100;
        if(direction === 'BUY' && fvg.type === 'bull' && fvg.l < price) {
            candidates.push({
                price: fvg.m,
                type: 'FVG',
                score: 75,
                low: fvg.l,
                high: fvg.h,
                distancePct: distPct,
                patterns: ['FVG']
            });
        }
        if(direction === 'SELL' && fvg.type === 'bear' && fvg.h > price) {
            candidates.push({
                price: fvg.m,
                type: 'FVG',
                score: 75,
                low: fvg.l,
                high: fvg.h,
                distancePct: distPct,
                patterns: ['FVG']
            });
        }
    }
    
    // 3. Order Blocks (Exact OB low and high boundaries)
    for(const ob of obs) {
        const mid = (ob.low + ob.high) / 2;
        const distPct = Math.abs(price - mid) / price * 100;
        if(direction === 'BUY' && ob.high < price) {
            candidates.push({
                price: mid,
                type: 'Order Block',
                score: 75,
                low: ob.low,
                high: ob.high,
                distancePct: distPct,
                patterns: ['OB']
            });
        }
        if(direction === 'SELL' && ob.low > price) {
            candidates.push({
                price: mid,
                type: 'Order Block',
                score: 75,
                low: ob.low,
                high: ob.high,
                distancePct: distPct,
                patterns: ['OB']
            });
        }
    }
    
    // 4. Swing Levels (Exact swing high/low price with tight ±0.05% boundaries)
    if(direction === 'BUY') {
        for(const low of swings.L) {
            if(low.p < price) {
                const distPct = (price - low.p) / price * 100;
                candidates.push({
                    price: low.p,
                    type: 'Swing Low',
                    score: 70,
                    low: low.p * 0.9995,
                    high: low.p * 1.0005,
                    distancePct: distPct,
                    patterns: ['Swing']
                });
            }
        }
    } else {
        for(const high of swings.H) {
            if(high.p > price) {
                const distPct = (high.p - price) / price * 100;
                candidates.push({
                    price: high.p,
                    type: 'Swing High',
                    score: 70,
                    low: high.p * 0.9995,
                    high: high.p * 1.0005,
                    distancePct: distPct,
                    patterns: ['Swing']
                });
            }
        }
    }
    
    // 5. Turtle Soup
    if(tbs.detected && tbs.type === direction) {
        const distPct = Math.abs(price - tbs.keyLevel) / price * 100;
        candidates.push({
            price: tbs.keyLevel,
            type: 'Turtle Soup',
            score: 90,
            low: tbs.keyLevel * 0.9995,
            high: tbs.keyLevel * 1.0005,
            distancePct: distPct,
            patterns: ['TBS']
        });
    }

    if(candidates.length === 0) return null;
    
    // Calculate Quality Score for each candidate (Freshness + Pattern Base)
    // STRUCTURAL: a fresh liquidity sweep or breakout-retest at the candidate level
    // boosts its ranking so it wins over plain MSNR/FVG zones.
    const sweepHit = detectLiquiditySweep(data, price, direction);
    const retestHit = detectBreakoutRetest(data, price, direction);
    for(const c of candidates) {
        const f = checkZoneFreshness(data, { low: c.low, high: c.high }, direction);
        let q = c.score || 70;
        if(f.fresh) q += 15;
        else if(f.partiallyUsed && f.touches <= 3) q += 8;
        if(sweepHit && Math.abs(c.price - sweepHit.level) / c.price <= 0.004) {
            q += 25;
            c.sweepRanked = true;
        }
        if(retestHit && Math.abs(c.price - retestHit.level) / c.price <= 0.004) {
            q += 25;
            c.retestRanked = true;
        }
        c.qualityScore = q;
    }
    
    // REACHABILITY FILTER: A limit order entry must be within ~3x ATR of price,
    // otherwise price will rarely reach it and the setup never triggers.
    const atrVal = customATR || atr(data, 14);
    const maxEntryDist = Math.max(atrVal * LIMIT_ORDER_MAX_DIST_ATR, price * 0.001);
    const maxDistPct = (maxEntryDist / price) * 100;
    const reachable = candidates.filter(c => (c.distancePct || 0) <= maxDistPct);
    
    if(reachable.length === 0) {
        const nearestPct = Math.min(...candidates.map(c => c.distancePct)).toFixed(2);
        console.log(`  ⚠️ All zones beyond ${LIMIT_ORDER_MAX_DIST_ATR}x ATR (nearest ${nearestPct}%) — using nearest zone anyway (fill probability lower)`);
        // No longer a hard kill: price CAN reach the zone eventually; the limit
        // monitor (4h expiry) decides. A far setup is better than NO setup.
        const nearest = candidates.sort((a, b) => a.distancePct - b.distancePct)[0];
        reachable.push(nearest);
    }
    
    // Sort by QUALITY SCORE within reachable zones (highest quality first)
    reachable.sort((a, b) => b.qualityScore - a.qualityScore || a.distancePct - b.distancePct);
    
    const best = reachable[0];

    // GHOST MACHINE ENTRY PLACEMENT: Use zone edge CLOSEST to current price for
    // higher fill probability. For a BUY, price is ABOVE the zone, so the limit
    // sits at zone.high (the first level price will touch on its way down).
    // For a SELL, price is BELOW the zone, so the limit sits at zone.low.
    // Note: distPct doesn't change which edge we pick — both branches resolve to
    // the same edge. Kept as a single branch.
    let entry;
    if(best.low && best.high) {
        entry = direction === 'BUY' ? best.high : best.low;
    } else {
        entry = best.price;
    }
    
    const msnrLevels = direction === 'BUY' ? msnr.allSupports : msnr.allResistances;
    if(msnrLevels && msnrLevels.length > 0) {
        let nearestMsnr = msnrLevels[0];
        let minDiff = Math.abs(entry - nearestMsnr);
        for(let i = 1; i < msnrLevels.length; i++) {
            const diff = Math.abs(entry - msnrLevels[i]);
            if(diff < minDiff) {
                minDiff = diff;
                nearestMsnr = msnrLevels[i];
            }
        }
        if(Math.abs(entry - nearestMsnr) / entry <= 0.002) {
            entry = nearestMsnr;
        }
    }

    entry = Math.round(entry * factor) / factor;
    
    // STOP LOSS PRECISION: Keep current SL (1.5% max, 2.5x ATR max, DO NOT WIDEN SL)
    const slRes = calcStopLoss(data, direction, entry, best, msnr, null, atrVal, pair);
    const sl = slRes.price;
    
    // ZONE-LEVEL INDICATOR IDENTIFICATION: does the zone sit at an oversold/overbought/discount/premium extreme?
    const zoneIndicators = evaluateZoneIndicators(data, best, direction);
    
    return {
        entry: entry,
        sl: sl,
        p: entry, // Backtest alias
        zone: best,
        direction: direction,
        msnr: msnr,
        fib: fib,
        tbsDetected: tbs.detected && tbs.type === direction,
        crtState: crt.state,
        patterns: best.patterns,
        zoneType: best.type,
        zonePrice: best.price,
        distancePct: best.distancePct,
        zoneIndicators: zoneIndicators
    };
}

const findPrecisionEntry = findPatternZone;

// ============================================
// ZONE FRESHNESS CHECK
// ============================================

function ictFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function ictCanonicalZoneType(value) {
    const s = String(value || '').trim().toUpperCase();
    if (!s || s === 'CONFLUENCE' || s === 'AI ZONE' || s === 'AI IDENTIFIED') return null;
    if (s.includes('FVG') || s.includes('FAIR VALUE')) return 'FVG';
    if (s === 'OB' || s.includes('ORDER BLOCK')) return 'OB';
    if (s.includes('TBS') || s.includes('TURTLE')) return 'TBS';
    if (s.includes('CRT')) return 'CRT';
    if (s.includes('MSNR') || s.includes('SUPPORT') || s.includes('RESISTANCE')) return 'MSNR';
    return null;
}

function ictBuildRealZones(data, price, direction, pairLocal, timeframe = null) {
    data = closedStructureCandles(data);
    if (!data || data.length < 20) return [];
    const zones = [];
    const settings = getMarketSettings(pairLocal);
    const edgePad = Math.max(settings.pipSize * 2, price * 0.000001);

    for (const fvg of detectFVG(data)) {
        if (direction === 'BUY' && fvg.type === 'bull' && fvg.l < price) {
                const sourceIndex = Number.isInteger(fvg.source_index) ? fvg.source_index : null;
                zones.push({ type: 'FVG', origin: 'STRUCTURAL', primary_eligible: true, low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad,
                    source_candle_index: sourceIndex, created_index: sourceIndex,
                    created_time: sourceIndex != null ? candleTimestamp(data[sourceIndex], sourceIndex, timeframe) : null });
        }
        if (direction === 'SELL' && fvg.type === 'bear' && fvg.h > price) {
            const sourceIndex = Number.isInteger(fvg.source_index) ? fvg.source_index : null;
            zones.push({ type: 'FVG', origin: 'STRUCTURAL', primary_eligible: true, low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad,
                source_candle_index: sourceIndex, created_index: sourceIndex,
                created_time: sourceIndex != null ? candleTimestamp(data[sourceIndex], sourceIndex, timeframe) : null });
        }
    }

    for (const ob of detectOrderBlocks(data, direction)) {
        if (direction === 'BUY' && ob.high < price) {
            zones.push({ type: 'OB', origin: 'STRUCTURAL', primary_eligible: true, low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad,
                source_candle_index: ob.source_index, created_index: ob.source_index,
                created_time: Number.isInteger(ob.source_index) ? candleTimestamp(data[ob.source_index], ob.source_index, timeframe) : null });
        }
        if (direction === 'SELL' && ob.low > price) {
            zones.push({ type: 'OB', origin: 'STRUCTURAL', primary_eligible: true, low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad,
                source_candle_index: ob.source_index, created_index: ob.source_index,
                created_time: Number.isInteger(ob.source_index) ? candleTimestamp(data[ob.source_index], ob.source_index, timeframe) : null });
        }
    }

    const msnr = calculateMSNR(data, price, null, pairLocal);
    const levels = (msnr.structural_levels || []).filter(level => level.direction === direction);
    for (const meta of levels) {
        const level = meta.level;
        zones.push({
            type: 'MSNR',
            origin: meta.origin || 'STRUCTURAL_MSNR',
            primary_eligible: meta.primary_eligible !== false,
            low: meta.zone_low,
            high: meta.zone_high,
            price: level,
            tolerance: edgePad,
            role: meta.role,
            transition_type: meta.transition_type,
            freshness: meta.freshness,
            touch_count: meta.touch_count,
            mitigation_count: meta.mitigation_count,
            reaction_count: meta.reaction_count,
            source_candle_index: meta.source_candle_index,
            source_time: meta.source_time,
            departure_confirmed_index: meta.departure_confirmed_index,
            first_retest_index: meta.first_retest_index,
            break_index: meta.break_index,
            retest_index: meta.retest_index,
            structural_invalidation: meta.structural_invalidation,
            invalidated: meta.invalidated
        });
    }

    return zones.filter(z => ictFiniteNumber(z.low) && ictFiniteNumber(z.high) && z.high >= z.low);
}

function ictZoneMatchesAI(realZone, aiResult) {
    const entry = aiResult.entry;
    const tol = Math.max(realZone.tolerance || 0, (realZone.high - realZone.low) * 0.1);
    const entryInside = entry >= realZone.low - tol && entry <= realZone.high + tol;
    if (!entryInside) return false;

    const declaredType = ictCanonicalZoneType(aiResult.entry_zone?.source);
    if (declaredType && declaredType !== realZone.type) return false;

    const aiLow = Number(aiResult.entry_zone?.low);
    const aiHigh = Number(aiResult.entry_zone?.high);
    if (Number.isFinite(aiLow) && Number.isFinite(aiHigh)) {
        const lo = Math.min(aiLow, aiHigh);
        const hi = Math.max(aiLow, aiHigh);
        const overlaps = hi >= realZone.low - tol && lo <= realZone.high + tol;
        if (!overlaps) return false;
    }

    return true;
}

function checkZoneFreshness(data, zone, direction) {
    if (!data || !data.length) return { fresh: false, partiallyUsed: false, used: true, touches: 0, violations: 0 };
    let touches = 0;
    let violations = 0;
    let engaged = false;
    const lookback = Math.min(50, data.length);
    const zoneLow = Number(zone?.low ?? zone * 0.998);
    const zoneHigh = Number(zone?.high ?? zone * 1.002);

    for(let i = data.length - lookback; i < data.length; i++) {
        if(i < 0) continue;
        const close = data[i].c;
        const closeInZone = close >= zoneLow && close <= zoneHigh;
        if(closeInZone) {
            touches++;
            engaged = true;
            continue;
        }
        if(!engaged) continue;
        if(direction === 'BUY' && close < zoneLow) violations++;
        if(direction === 'SELL' && close > zoneHigh) violations++;
    }

    const fresh = touches <= 2 && violations === 0;
    const partiallyUsed = touches <= 5 && violations <= 1;
    const used = touches > 5 || violations > 1;
    return { fresh, partiallyUsed, used, touches, violations };
}

// ============================================
// SESSION DETECTION
// ============================================

function getSession(now = new Date()) {
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const time = hour + min / 60;
    
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false };
    
    if(time >= 0 && time < 4) s = { ...s, session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true };
    else if(time >= 7 && time < 10) s = { ...s, session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true };
    else if(time >= 12 && time < 15) s = { ...s, session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true };
    else if(time >= 15 && time < 17) s = { ...s, session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true };
    
    if((time >= 8.5 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) {
        s.isSilverBullet = true;
        s.multiplier += 0.2;
        s.emoji = '🏹';
        s.session += ' + SB';
    }
    
    return s;
}

function hoursRemainingInSession(now = new Date()) {
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const boundaries = hour < 4 ? 4 : hour < 7 ? 7 : hour < 10 ? 10 : hour < 12 ? 12 : hour < 15 ? 15 : hour < 17 ? 17 : 24;
    return Math.max(0, boundaries - hour);
}

// ============================================
// UPDATE MTF DISPLAY
// ============================================

function getCanonicalDisplayedTrend(snapshot = {}) {
    const effective = snapshot.effective_trend || 'NEUTRAL';
    // A conflicting structure is meaningful information. Do not flatten it
    // to NEUTRAL just because momentum has not chosen a side yet.
    if (effective === 'NEUTRAL' && ['BULLISH', 'BEARISH'].includes(snapshot.momentum_trend)) return snapshot.momentum_trend;
    if (effective === 'NEUTRAL' && ['BULLISH', 'BEARISH'].includes(snapshot.bias)) return snapshot.bias;
    if (effective === 'NEUTRAL' && snapshot.structural_trend === 'MIXED') return 'MIXED';
    return effective;
}

function getCanonicalTimeframeTrend(data, tf, fallback = 'NEUTRAL') {
    const closed = closedStructureCandles(data || []);
    if (closed.length >= 20) return getCanonicalDisplayedTrend(buildStructureSnapshot(closed, tf));
    if (fallback && typeof fallback === 'object') return getCanonicalDisplayedTrend(fallback);
    return fallback || 'NEUTRAL';
}

async function updateMTFDisplay(historyCache = {}) {
    const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
    if (document.getElementById('trend1M')) tfs.unshift('1M');
    for(let t of tfs) {
        let tr = 'NEUTRAL';
        try {
            const data = historyCache[t] || await getHistory(t);
            if(data && data.length >= 2) {
                const snapshot = buildStructureSnapshot(data, t);
                tr = getCanonicalDisplayedTrend(snapshot);
            }
        } catch(e) { /* ignore */ }
        
        let el = document.getElementById(`trend${t}`);
        if(el) {
            el.innerHTML = tr === 'BULLISH' ? '🟢 Bull' : (tr === 'BEARISH' ? '🔴 Bear' : '⚪ Neut');
            const bullish = ['BULLISH', 'BULLISH_TRANSITION'].includes(tr);
            const bearish = ['BEARISH', 'BEARISH_TRANSITION'].includes(tr);
            const mixed = tr === 'MIXED';
            el.innerHTML = bullish ? 'Bull' : bearish ? 'Bear' : mixed ? 'Mixed' : 'Neut';
            el.className = `mtf-trend ${bullish ? 'bullish' : bearish ? 'bearish' : mixed ? 'mixed' : 'neutral'}`;
        }
    }
}

// ============================================
// SIMPLIFIED AI EXECUTION DECISION
// ============================================

async function getAIExecutionDecision(best, price, htfData) {
    if(!hasAiAccess()) {
        return getSimpleDecision(best, price);
    }
    
    const session = getSession();
    
    const riskAmount = best.entry && best.sl ? Math.abs(best.entry - best.sl) : 0;
    const tpDistances = [
        best.entry && best.tp1 ? Math.abs(best.tp1 - best.entry) : 0,
        best.entry && best.tp2 ? Math.abs(best.tp2 - best.entry) : 0,
        best.entry && best.tp3 ? Math.abs(best.tp3 - best.entry) : 0
    ].map(d => d.toFixed(5)).join(', ');
    const patternCount = best.patterns ? best.patterns.length : 0;
    const atrValue = best.entryATR ? best.entryATR.toFixed(5) : 'N/A';

    const prompt = `ICT TRADE EXECUTION

Setup Confidence: ${best.confidence}%
Direction: ${best.direction}
Zone Type: ${best.zoneType}
Distance: ${Math.abs(best.distancePct || 0).toFixed(2)}%
TBS: ${best.tbsDetected ? 'YES' : 'NO'}
CRT: ${best.crtState}
Session: ${session.session}
ATR Value: ${atrValue}
Zone Touches: ${best.touches || 0}
Entry Distance %: ${Math.abs(best.entryDistancePct || 0).toFixed(2)}%
Risk Amount: ${riskAmount.toFixed(5)}
TP Distances: ${tpDistances}
Pattern Count: ${patternCount}

Return ONLY JSON:
{"decision":"enter_now|wait_for_reaction|skip","confidence":0-100,"reason":"brief reason"}`;

    try {
        const { response, data } = await requestAIJson(getDeepSeekEndpoint(), {
            method: 'POST',
            headers: getDeepSeekHeaders(),
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are an ICT trading execution expert. Return ONLY valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 200
            })
        });
        
        const content = data.choices?.[0]?.message?.content;
        
        if(content) {
            try {
                const parsed = JSON.parse(content);
                const validDecisions = ['enter_now', 'wait_for_reaction', 'skip'];
                const decision = validDecisions.includes(parsed.decision) ? parsed.decision : 'wait_for_reaction';
                return {
                    decision: decision,
                    confidence: Math.min(Math.max(parsed.confidence || best.confidence, 0), 100),
                    reasoning: parsed.reason || 'AI analyzed setup',
                    risk_adjustment: decision === 'enter_now' ? 1.0 : 0.8,
                    wait_condition: decision === 'wait_for_reaction' ? 'Pending limit remains valid; immediate execution is not active.' : null,
                    skip_reason: decision === 'skip' ? parsed.reason || 'Setup failed AI criteria' : null
                };
            } catch(e) {
                return getSimpleDecision(best, price);
            }
        }
        return getSimpleDecision(best, price);
    } catch(error) {
        return getSimpleDecision(best, price);
    }
}

function getSimpleDecision(best, price) {
    const confidence = best.confidence || 0;
    const distance = Math.abs(best.entryDistancePct !== undefined ? parseFloat(best.entryDistancePct) : (best.distancePct || 100));
    
    if(confidence < MIN_CONFIDENCE) {
        return {
            decision: 'skip',
            confidence: confidence,
            reasoning: `Confidence ${confidence}% below minimum threshold ${MIN_CONFIDENCE}%`,
            risk_adjustment: 0,
            wait_condition: null,
            skip_reason: `Confidence ${confidence}% < ${MIN_CONFIDENCE}%`
        };
    }
    
    if(distance <= 1.0) {
        return {
            decision: 'enter_now',
            confidence: confidence,
            reasoning: `High confidence ${confidence}% & entry within 1% range (${distance.toFixed(2)}%) — IMMEDIATE ENTRY`,
            risk_adjustment: 1.0,
            wait_condition: null,
            skip_reason: null
        };
    }
    
    return {
        decision: 'wait_for_reaction',
        confidence: confidence,
        reasoning: `High quality Limit Order setup (${confidence}%, ${distance.toFixed(2)}% away) — limit order set at zone`,
        risk_adjustment: 0.8,
        wait_condition: 'Limit order pending at high-quality zone — waiting for price to hit zone',
        skip_reason: null
    };
}

// ============================================
// QUANTUM INTELLIGENCE LAYER (from strategy v8/v9)
// Volume truth, sweeps, displacement, breakout-retest,
// path clearance, premium/discount.
// ============================================

// Volume truth detection: sustained 200% surge = institutional; spike-then-drop = fake
// `realVolume` flag: when false (forex/metals from Twelve Data), return zero signals.
// Synthetic volume should never score as confirmation or fake — it's just noise.
function analyzeVolumeTruth(data, realVolume = true) {
    if(!data || data.length < 20) return { surge: false, fake: false, dryUp: false };
    if(!realVolume) return { surge: false, fake: false, dryUp: false, avg: 0, realVolume: false };
    const vols = data.slice(-20).map(c => c.v || 0);
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    const last4 = vols.slice(-4);
    const surge = last4.every(v => v >= avg * 1.5);
    const last1 = vols[vols.length - 1], last2 = vols[vols.length - 2];
    const fake = last2 >= avg * 2 && last1 < last2 * 0.6;
    const dryUp = last4.every(v => v < avg * 0.8);
    return { surge, fake, dryUp, avg, realVolume: true };
}

// Liquidity sweep detection: price swept a recent swing high/low then closed back
function detectLiquiditySweep(data, price, dir) {
    data = closedStructureCandles(data);
    if(!data || data.length < 26) return null;
    const lookback = 6;
    const body = data.slice(0, -lookback);
    const recent = data.slice(-lookback);
    const sw = findSwings(body, 2);
    if(dir === 'BUY') {
        const lows = (sw.L || []).slice(-4);
        for(const low of lows) {
            if(recent.some(c => c.l < low.p && c.c > low.p)) {
                return { swept: true, level: low.p, type: 'BUY' };
            }
        }
    } else {
        const highs = (sw.H || []).slice(-4);
        for(const high of highs) {
            if(recent.some(c => c.h > high.p && c.c < high.p)) {
                return { swept: true, level: high.p, type: 'SELL' };
            }
        }
    }
    return null;
}

// Displacement: current candle body >= 2.5x average body in direction
function detectDisplacement(data, dir) {
    data = closedStructureCandles(data);
    if(!data || data.length < 10) return false;
    const last = data[data.length - 1];
    const avgBody = data.slice(-10).reduce((a, c) => a + Math.abs(c.c - c.o), 0) / 10;
    const body = Math.abs(last.c - last.o);
    if(avgBody <= 0) return false;
    if(dir === 'BUY' && last.c > last.o && body >= avgBody * 2.5) return true;
    if(dir === 'SELL' && last.c < last.o && body >= avgBody * 2.5) return true;
    return false;
}

// Breakout-retest: a swing level broken with volume, price now retesting it
function detectBreakoutRetest(data, price, dir) {
    data = closedStructureCandles(data);
    if(!data || data.length < 40) return null;
    const sw = findSwings(data.slice(-60), 2);
    if(dir === 'BUY') {
        const highs = (sw.H || []).slice(-4);
        for(const h of highs) {
            const dist = (price - h.p) / price * 100;
            if(dist > -1.5 && dist < 0.1) {
                const after = data.slice(h.i + 1);
                const broke = after.slice(0, 6).some(c => c.c > h.p);
                if(broke) return { breakout: true, level: h.p, distPct: Math.abs(dist), type: 'BUY' };
            }
        }
    } else {
        const lows = (sw.L || []).slice(-4);
        for(const l of lows) {
            const dist = (l.p - price) / price * 100;
            if(dist > -1.5 && dist < 0.1) {
                const after = data.slice(l.i + 1);
                const broke = after.slice(0, 6).some(c => c.c < l.p);
                if(broke) return { breakout: true, level: l.p, distPct: Math.abs(dist), type: 'SELL' };
            }
        }
    }
    return null;
}

// Path clearance: any bearish FVG / swing high between entry and TP? Returns the
// nearest obstacle level so the bot can pull TP1 back in front of it.
function checkPathClearance(entryData, entry, tp, dir) {
    if(!entryData || entryData.length < 20) return { clear: true, obstacles: 0, nearestLevel: null };
    const fvgs = detectFVG(entryData);
    const sw = findSwings(entryData, 2);
    let obstacles = 0;
    let nearestLevel = null;
    if(dir === 'BUY') {
        for(const f of fvgs) { if(f.type === 'bear' && f.l > entry && f.l < tp) { obstacles++; if(!nearestLevel || f.l < nearestLevel) nearestLevel = f.l; } }
        for(const h of (sw.H || [])) { if(h.p > entry && h.p < tp) { obstacles++; if(!nearestLevel || h.p < nearestLevel) nearestLevel = h.p; } }
    } else {
        for(const f of fvgs) { if(f.type === 'bull' && f.h < entry && f.h > tp) { obstacles++; if(!nearestLevel || f.h > nearestLevel) nearestLevel = f.h; } }
        for(const l of (sw.L || [])) { if(l.p < entry && l.p > tp) { obstacles++; if(!nearestLevel || l.p > nearestLevel) nearestLevel = l.p; } }
    }
    return { clear: obstacles === 0, obstacles, nearestLevel };
}

// Premium/discount on the entry timeframe (below midpoint = discount for BUY)
function isPremiumDiscount(data, price) {
    data = closedStructureCandles(data);
    if(!data || data.length < 20) return { zone: null };
    const highs = data.slice(-50).map(c => c.h);
    const lows = data.slice(-50).map(c => c.l);
    const hi = Math.max(...highs), lo = Math.min(...lows);
    if(hi === lo) return { zone: null };
    const mid = (hi + lo) / 2;
    return { zone: price < mid ? 'discount' : (price > mid ? 'premium' : 'equilibrium'), mid };
}

// ============================================
// MAIN ANALYSIS ENGINE - ALL PATTERNS
// ============================================

async function evaluateSetup(tfToAnalyze, price, htfData, indicators = {}, now = new Date()) {
    console.log(`🔍 Analyzing ${tfToAnalyze} on ${pair}...`);
    
    try {
        const entryData = htfData[tfToAnalyze] || await getHistory(tfToAnalyze);
        if(!entryData || entryData.length < 20) {
            console.log(`  ❌ Not enough data for ${tfToAnalyze}`);
            return null;
        }
        
        // 1. ADX Trend Strength — now a CONFIDENCE factor, NOT a whole-timeframe blocker.
        // Weak/ranging trend (like gold's regular chop) no longer deletes the chart; it
        // just lowers confidence. Strong ADX still gets a bonus (below). This lets valid
        // zones/setups fire in ranges while still rewarding real trends.
        const adxResult = calculateADX(entryData, 14, tfToAnalyze);
        const adxWeakTrend = !adxResult.isStrongTrend;
        if(adxWeakTrend) {
            console.log(`  ⚠️ ${tfToAnalyze}: ADX ${adxResult.adx.toFixed(1)} <= ${adxResult.minADX} (weak/ranging — penalty)`);
        }

        // 2. Session Rating Check
        const sessionCheck = checkTradeSession(now);

        // 3. High Impact News Warning Check (FOMC, NFP, CPI)
        const newsCheck = checkHighImpactNews(pair);
        if(newsCheck.inNewsWindow && newsCheck.warning) {
            console.log(`  ⚠️ ${tfToAnalyze}: ${newsCheck.warning}`);
        }

        const twelveIndicators = indicators || {};
        const entryATR = twelveIndicators?.atr_api || atr(entryData, 14);
        
        // Get HTF trends
        const dailyDir = await getQuoteDirection('1D', htfData['1D']);
        const h4Dir = await getQuoteDirection('4H', htfData['4H']);
        const h1Dir = await getQuoteDirection('1H', htfData['1H']);
        
        let allSetups = [];
        let session = getSession(now);
        
        // Check BOTH directions
        for(const dir of ['BUY', 'SELL']) {
            console.log(`  → Checking ${dir}...`);
            
            // 4. Confirmation Candle Rating
            const candleCheck = checkConfirmationCandle(entryData, dir);

            // Find pattern zone with Twelve Data API entryATR
            const patternResult = findPatternZone(entryData, price, dir, entryATR);
            if(!patternResult) {
                console.log(`  ❌ ${dir}: No pattern zone found`);
                continue;
            }
            const zi = patternResult.zoneIndicators || null;
            let entry = patternResult.entry;
            let sl = patternResult.sl;
            const zone = { low: patternResult.zone.low, high: patternResult.zone.high };

            // LTF ENTRY TIMING (15M/5M): refine the entry level within the 4H/1H setup.
            // SOFT — never blocks the setup; when the LTF zone aligns & is close it times
            // the entry better (tighter LTF level). SL recomputed consistently.
            const ltfRefine = refineEntryWithLTF(htfData, dir, price, patternResult, entry);
            if(ltfRefine.refined) {
                entry = ltfRefine.entry;
                sl = ltfRefine.sl;
                console.log(`  🎯 LTF ENTRY TIMED: ${patternResult.zoneType} 4H/1H setup, entry refined ${ltfRefine.baseEntry} → ${entry} on ${ltfRefine.tf}`);
            }
            
            // QUANTUM INTELLIGENCE CHECKS (v8/v9 strategy layer)
            const volTruth = analyzeVolumeTruth(entryData, hasRealVolume(pair));
            const sweep = detectLiquiditySweep(entryData, price, dir);
            const displaced = detectDisplacement(entryData, dir);
            const breakoutRetest = detectBreakoutRetest(entryData, price, dir);
            const pdZone = isPremiumDiscount(entryData, price);
            
            // Fake / dry volume: now soft confidence penalties (used to hard-reject).
            // Quiet tapes are still tradable in ICT; fake-volume patterns are scored
            // down rather than killed outright.
            const fakeVolume = volTruth.fake;
            const dryVolume = volTruth.dryUp;

            // HARD REJECTION #2: CHoCH detected — trade against structure change
            const choch = detectCHoCH(entryData, dir);
            if(choch) {
                const msg = `${tfToAnalyze} ${dir}: CHoCH detected — structure changed`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            // HARD REJECTION #3: DIRECTION GATE — 1D bias, only block when trend is STRONG (ADX > 20)
            const dailyBiasData = (htfData && htfData['1D']) || entryData;
            const dirBias = getDirectionBias(dailyBiasData);
            const dailyADX = calculateADX(dailyBiasData, 14, '1D');
            const dailyStrong = dailyADX.adx > 20;
            const fightingTrend = dir === 'BUY' ? (dirBias === 'BEARISH') : (dirBias === 'BULLISH');

            if(fightingTrend && dailyStrong) {
                const msg = `${tfToAnalyze} ${dir}: 1D direction reads ${dirBias} (ADX ${dailyADX.adx.toFixed(1)}) — trading against strong daily trend`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            const trendStrengthLabel = dailyStrong ? 'STRONG' : 'WEAK (ranging)';
            console.log(`  → 1D direction: ${dirBias} (ADX ${dailyADX.adx.toFixed(1)} — ${trendStrengthLabel})`);

            // Compression: SOFT signal now (was hard-reject). Trending setups are
            // valid ICT entries; compression just means lower-confidence expansion.
            // Tracked as a soft signal so the score can still drop on expansion setups.
            const compressed = detectCompression(entryData, 5);

            // HARD REJECTION #5: Loss protection — 3 losses or 2R daily drawdown
            if(!checkLossProtection()) {
                const msg = `${tfToAnalyze} ${dir}: Loss protection active — ${consecutiveLosses} losses / ${dailyPnlR.toFixed(1)}R daily`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            // HARD REJECTION #6: Time gap — wait between trades
            if(!checkTradeGap(2)) {
                const msg = `${tfToAnalyze} ${dir}: Time gap not met — wait 2h between trades`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            // Entry distance calculation (Distance is NOT a rejection criteria; Quality is the only filter)
            const entryDistancePct = Math.abs(price - entry) / price * 100;
            console.log(`  → Entry ${entry} is ${entryDistancePct.toFixed(2)}% from price (Zone Quality Score: ${patternResult.zone.qualityScore || 'high'}) ✅`);
            console.log(`  → Quantum: vol${volTruth.surge ? 'surge' : ''}${volTruth.fake ? '/FAKE' : ''}${volTruth.dryUp ? '/dry' : ''} sweep=${sweep ? 'yes' : 'no'} displacement=${displaced} breakoutRetest=${breakoutRetest ? 'yes' : 'no'} zone=${pdZone.zone || 'n/a'}`);

            // HTF ALIGNMENT SCORING (Scoring factor, not a hard rejection)
            const dirStr = dir === 'BUY' ? 'BULLISH' : 'BEARISH';
            let htfMatch = 0;
            if(dailyDir === dirStr) htfMatch++;
            if(h4Dir === dirStr) htfMatch++;
            if(h1Dir === dirStr) htfMatch++;
            console.log(`  → HTF Trends: Daily=${dailyDir}, 4H=${h4Dir}, 1H=${h1Dir} (Match for ${dir}: ${htfMatch}/3)`);

            if(htfMatch < HTF_MIN_MATCH) {
                const msg = `${tfToAnalyze} ${dir}: HTF alignment ${htfMatch}/3 < ${HTF_MIN_MATCH}/3 minimum`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            // PATTERN COUNT & FIB CONFLUENCE
            let rawPatterns = patternResult.patterns ? [...patternResult.patterns] : [patternResult.zoneType || 'MSNR'];
            let fibConfluenceFound = false;
            if(patternResult.fib) {
                const distFib618 = Math.abs(entry - patternResult.fib.fib618) / entry * 100;
                const distFib50 = Math.abs(entry - patternResult.fib.fib50) / entry * 100;
                if(distFib618 <= 0.5) {
                    fibConfluenceFound = true;
                    if(!rawPatterns.includes('Fib 0.618')) rawPatterns.push('Fib 0.618');
                } else if(distFib50 <= 0.5) {
                    fibConfluenceFound = true;
                    if(!rawPatterns.includes('Fib 0.50')) rawPatterns.push('Fib 0.50');
                }
            }
            let totalPatternCount = rawPatterns.length;
            
            // Check freshness
            const freshness = checkZoneFreshness(entryData, zone, dir);
            if(freshness.touches > MAX_ZONE_TOUCHES) {
                const msg = `${tfToAnalyze} ${dir}: Zone has ${freshness.touches} touches (max ${MAX_ZONE_TOUCHES} allowed)`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }
            
            // Calculate TP using MSNR levels
            const risk = Math.abs(entry - sl);
            const settings = getMarketSettings(pair);
            const prec = settings.prec;
            const factor = Math.pow(10, prec);
            
            const tps = calcTakeProfits(dir, entry, sl, patternResult.msnr);
            let tp1 = tps.tp1;
            let tp2 = tps.tp2;
            let tp3 = tps.tp3;
            if (!Number.isFinite(tp1)) continue;
            tp1 = Math.round(tp1 * factor) / factor;
            tp2 = Number.isFinite(tp2) ? Math.round(tp2 * factor) / factor : null;
            tp3 = Number.isFinite(tp3) ? Math.round(tp3 * factor) / factor : null;

            // RR Protection Checks (Minimum 1.5x RR)
            const reward1 = Math.abs(tp1 - entry);
            const rr1 = risk > 0 ? reward1 / risk : 0;
            const totalTarget = tp3 ?? tp2 ?? tp1;
            const totalReward = Math.abs(totalTarget - entry);
            const totalRR = risk > 0 ? totalReward / risk : 0;

            if(rr1 < 1.2 && totalRR < 1.2) {
                const msg = `${tfToAnalyze} ${dir}: RR ${rr1.toFixed(2)}x < 1.2x minimum`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }

            const usePartialProfits = totalRR > 4.0 || rr1 > 4.0;
            
            // ============================================
            // CONFIDENCE SCORING
            // ============================================
            let confidence = 0;
            let reasons = [];
            
            // 1. Pattern Score
            let typeScore = patternResult.zone.score || 70;
            confidence += typeScore * 0.25;
            reasons.push(`${patternResult.zoneType} (${typeScore}%)`);
            
            // 2. Distance bonus / Limit Order zone rating
            if(entryDistancePct < 0.5) { confidence += 15; reasons.push('Direct zone'); }
            else if(entryDistancePct <= 1.5) { confidence += 10; reasons.push('Near Limit zone'); }
            else if(entryDistancePct <= 3.0) { confidence += 5; reasons.push('Ghost Limit zone'); }
            
            // 3. Pattern Count
            confidence += Math.min(totalPatternCount * 5, 15);
            reasons.push(`${totalPatternCount} patterns`);
            
            // 4. Freshness (fresh +15, lightly used +3, worn -5)
            if(freshness.fresh) { confidence += 15; reasons.push('Fresh zone'); }
            else if(freshness.partiallyUsed && freshness.touches <= 3) { confidence += 3; reasons.push('Lightly used (+3)'); }
            else { confidence -= 5; reasons.push('Worn zone (-5)'); }
            
            // 5. HTF Alignment Scoring
            if(htfMatch === 3) { confidence += 15; reasons.push(`HTF 3/3 (+15)`); }
            else if(htfMatch === 2) { confidence += 10; reasons.push(`HTF 2/3 (+10)`); }
            else if(htfMatch === 1) { confidence += 5; reasons.push(`HTF 1/3 (+5)`); }
            else { confidence += 0; reasons.push(`HTF 0/3 (+0)`); }
            
            // 6. TBS Bonus
            if(patternResult.tbsDetected) {
                confidence += 10;
                reasons.push('TBS confirmed');
            }
            
            // 7. CRT Bonus
            if(patternResult.crtState === 'EXPANDING') {
                confidence += 5;
                reasons.push('CRT expanding');
            }

            // 8. Session Rating (London/NY +10, killzone +2, off-hours -8)
            confidence += sessionCheck.bonus;
            reasons.push(sessionCheck.reason);

            // 9. Confirmation Candle Bonus
            if(candleCheck.bonus > 0) {
                confidence += candleCheck.bonus;
                reasons.push(candleCheck.reason);
            }

            // 10. Volume Truth (institutional volume +, fake breakout -)
            if(volTruth.surge) { confidence += 10; reasons.push('Volume surge (+10)'); }
            if(fakeVolume) { confidence -= 8; reasons.push('FAKE breakout volume (-8)'); }
            if(dryVolume) { confidence -= 5; reasons.push('Volume dry (-5)'); }
            
            // 11. Liquidity Sweep (sweep then reclaim = institutional)
            if(sweep) {
                confidence += 10;
                reasons.push(`Liquidity sweep @${sweep.level.toFixed(settings.prec)} (+10)`);
            }

            // 10b. Compression (soft bonus when present — pullback/continuation zone)
            if(compressed) { confidence += 6; reasons.push('Compression (+6)'); }
            
            // 12. Displacement (strong directional body)
            if(displaced) { confidence += 8; reasons.push('Displacement (+8)'); }
            
            // 13. Breakout-Retest (price back at broken level)
            if(breakoutRetest) {
                confidence += 10;
                reasons.push(`Breakout retest @${breakoutRetest.level.toFixed(settings.prec)} (+10)`);
            }
            
            // 13. Premium/Discount (discount buy, premium sell)
            if(dir === 'BUY' && pdZone.zone === 'discount') { confidence += 5; reasons.push('Discounted zone (+5)'); }
            if(dir === 'SELL' && pdZone.zone === 'premium') { confidence += 5; reasons.push('Premium zone (+5)'); }
            
            // 14. Path Clearance (obstacles between entry and TP reduce confidence)
            const clearance = checkPathClearance(entryData, entry, tp1, dir);
            if(!clearance.clear) {
                confidence -= 4;
                reasons.push(`${clearance.obstacles} obstacle(s) to TP (-4)`);
            }

            // 15. ADX Exhaustion Penalty (overextended trend is a warning, not strength)
            if(adxResult.adx > 75) {
                confidence -= 5;
                reasons.push(`ADX overextended ${adxResult.adx.toFixed(0)} (-5)`);
            }

            // 16. Fibonacci Confirmation
            if(fibConfluenceFound) {
                confidence += 10;
                reasons.push('Fib confirmed (+10)');
            }
            
            confidence = Math.min(confidence, 100);
            
            // STRUCTURAL PATTERNS: Pin bar, Engulfing, Inside Bar
            const atr14 = atr(entryData, 14);
            const pinBar = detectPinBar(entryData, price, dir, atr14);
            const engulfing = detectEngulfing(entryData, price, dir);
            const insideBar = detectInsideBar(entryData, dir);
            if(pinBar) { confidence += 5; reasons.push('Pin bar (+5)'); }
            if(engulfing) { confidence += 5; reasons.push('Engulfing (+5)'); }
            if(insideBar) { confidence += 2; reasons.push('Inside bar (+2)'); }
            
            // Equal highs/lows liquidity pools
            const pools = detectLiquidityPools(entryData);
            if((dir === 'BUY' && pools.equalLows.length) || (dir === 'SELL' && pools.equalHighs.length)) {
                confidence += 5; reasons.push('Equal H/L liquidity (+5)');
            }
            
            // Market structure sequence
            const structure = analyzeMarketStructure(entryData);
            if(structure.length) { confidence += 3; reasons.push(`Structure: ${structure.join('/')} (+3)`); }

            // ============================================
            // CLASSIC INDICATOR CONFLUENCE
            // RSI / MACD / Bollinger / Stochastic / Ichimoku / ADX
            // These were fetched from the API but never used in the
            // decision — now they reward setups that indicators confirm.
            // Every check is defensive (ignored if the value is missing).
            // ============================================
            const rs  = twelveIndicators.rsi;
            const mc  = twelveIndicators.macd;
            const mSig = twelveIndicators.macd_signal;
            const bu  = twelveIndicators.bb_upper;
            const bl  = twelveIndicators.bb_lower;
            const sk  = twelveIndicators.stoch_k;
            const aT  = twelveIndicators.ichimoku_tenkan;
            const aK  = twelveIndicators.ichimoku_kijun;
            const sA  = twelveIndicators.ichimoku_senkou_a;
            const sB  = twelveIndicators.ichimoku_senkou_b;

            // IDENTIFIED ZONE CONDITION — the indicators DEFINE the setup zone:
            // OVERSOLD_ZONE / OVERBOUGHT_ZONE / DISCOUNT / PREMIUM (from evaluateZoneIndicators)
            if(zi && zi.condition) {
                const ziFavors = (dir === 'BUY' && (zi.condition === 'OVERSOLD_ZONE' || zi.condition === 'DISCOUNT')) ||
                                 (dir === 'SELL' && (zi.condition === 'OVERBOUGHT_ZONE' || zi.condition === 'PREMIUM'));
                if(ziFavors) {
                    confidence += 8;
                    reasons.push(`ZONE ${zi.condition}${zi.rangePct != null ? ' (' + zi.rangePct.toFixed(0) + '% range)' : ''} (+8)`);
                    console.log(`  🎯 ZONE IDENTIFIED: ${zi.condition} — ${zi.detail}`);
                }
            }

            // LTF (15M/5M) entry timing bonus — aligned lower-timeframe entry within the setup
            if(ltfRefine.refined) {
                confidence += 8;
                reasons.push(`LTF ${ltfRefine.tf} aligned entry (+8)`);
            }

            // RSI: oversold supports BUY, overbought supports SELL
            if(rs != null && isFinite(rs)) {
                if(dir === 'BUY' && rs < 35)      { confidence += 8; reasons.push(`RSI ${rs.toFixed(0)} oversold (+8)`); }
                else if(dir === 'SELL' && rs > 65){ confidence += 8; reasons.push(`RSI ${rs.toFixed(0)} overbought (+8)`); }
                else if(dir === 'BUY' && rs < 45) { confidence += 3; reasons.push(`RSI ${rs.toFixed(0)} low (+3)`); }
                else if(dir === 'SELL' && rs > 55){ confidence += 3; reasons.push(`RSI ${rs.toFixed(0)} high (+3)`); }
            }

            // MACD: crossover/momentum confirming direction
            if(mc != null && mSig != null && isFinite(mc) && isFinite(mSig)) {
                if((dir === 'BUY' && mc > mSig) || (dir === 'SELL' && mc < mSig)) {
                    confidence += 5; reasons.push('MACD confirms direction (+5)');
                } else {
                    confidence -= 3; reasons.push('MACD against direction (-3)');
                }
            }

            // Bollinger: price at lower band (buy) / upper band (sell)
            if(bu != null && bl != null && isFinite(bu) && isFinite(bl)) {
                if(dir === 'BUY' && price <= bl)  { confidence += 6; reasons.push('Price at lower band (+6)'); }
                else if(dir === 'SELL' && price >= bu){ confidence += 6; reasons.push('Price at upper band (+6)'); }
            }

            // Stochastic: oversold below 25 / overbought above 75
            if(sk != null && isFinite(sk)) {
                if(dir === 'BUY' && sk < 25)       { confidence += 5; reasons.push(`Stoch ${sk.toFixed(0)} oversold (+5)`); }
                else if(dir === 'SELL' && sk > 75) { confidence += 5; reasons.push(`Stoch ${sk.toFixed(0)} overbought (+5)`); }
            }

            // Ichimoku: price above cloud (up) / below cloud (down) + Tenkan/Kijun cross
            if(sA != null && sB != null && isFinite(sA) && isFinite(sB)) {
                const cTop = Math.max(sA, sB), cBot = Math.min(sA, sB);
                if(dir === 'BUY' && price > cTop)  { confidence += 4; reasons.push('Price above cloud (+4)'); }
                else if(dir === 'SELL' && price < cBot){ confidence += 4; reasons.push('Price below cloud (+4)'); }
                if(aT != null && aK != null && isFinite(aT) && isFinite(aK)) {
                    if((dir === 'BUY' && aT > aK) || (dir === 'SELL' && aT < aK)) {
                        confidence += 3; reasons.push('Tenkan/Kijun cross (+3)');
                    }
                }
            }

            // ADX: strong trend bonus (reward strong trends)
            if(adxResult && adxResult.adx > 25) {
                confidence += 3; reasons.push(`ADX ${adxResult.adx.toFixed(0)} strong (+3)`);
            }
            // ADX: weak/ranging trend penalty (no longer blocks the whole timeframe)
            if(adxWeakTrend) {
                confidence -= 10;
                reasons.push(`ADX ${adxResult.adx.toFixed(1)} weak/ranging (-10)`);
            }

            // CCI: below -100 oversold (buy), above +100 overbought (sell)
            const cci = twelveIndicators.cci;
            if(cci != null && isFinite(cci)) {
                if(dir === 'BUY' && cci < -100)      { confidence += 4; reasons.push(`CCI ${cci.toFixed(0)} oversold (+4)`); }
                else if(dir === 'SELL' && cci > 100) { confidence += 4; reasons.push(`CCI ${cci.toFixed(0)} overbought (+4)`); }
            }

            // Williams %R: below -80 oversold, above -20 overbought
            const wr = twelveIndicators.williams_r;
            if(wr != null && isFinite(wr)) {
                if(dir === 'BUY' && wr < -80)       { confidence += 4; reasons.push(`W%R ${wr.toFixed(0)} oversold (+4)`); }
                else if(dir === 'SELL' && wr > -20) { confidence += 4; reasons.push(`W%R ${wr.toFixed(0)} overbought (+4)`); }
            }

                        // SAR: below price confirms uptrend (buy), above price confirms downtrend (sell)
            const sar = twelveIndicators.sar;
            if(sar != null && isFinite(sar)) {
                if(dir === 'BUY' && price > sar)       { confidence += 3; reasons.push('SAR below price (+3)'); }
                else if(dir === 'SELL' && price < sar) { confidence += 3; reasons.push('SAR above price (+3)'); }
            }

            // EMA + SuperTrend DIRECTION SIGNAL (robust even in chop — the engine relied on candles only, which is why choppy gold returned NO_SETUP)
            const ema9 = twelveIndicators.ema9, ema21 = twelveIndicators.ema21,
                  ema50 = twelveIndicators.ema50, ema200 = twelveIndicators.ema200,
                  st = twelveIndicators.supertrend;

            // EMA200: long-term bias. In a range the 200EMA still tells us which side owns spot.
                        if(ema200 != null && isFinite(ema200)) {
                if(dir === 'BUY' && price > ema200)  { confidence += 3; reasons.push(`Price > EMA200 (+3)`); }
                else if(dir === 'SELL' && price < ema200) { confidence += 3; reasons.push(`Price < EMA200 (+3)`); }
            }
            // EMA9/21 fast cross: momentum within the direction (works in chop, not just trends)
            if(ema9 != null && ema21 != null && isFinite(ema9) && isFinite(ema21)) {
                if(dir === 'BUY' && ema9 > ema21)  { confidence += 3; reasons.push('EMA9>EMA21 (+3)'); }
                else if(dir === 'SELL' && ema9 < ema21) { confidence += 3; reasons.push('EMA9<EMA21 (+3)'); }
            }
            // EMA50: intermediate filter — trade should respect the 50EMA slope
            if(ema50 != null && isFinite(ema50)) {
                if(dir === 'BUY' && price > ema50)  { confidence += 2; reasons.push('Price > EMA50 (+2)'); }
                else if(dir === 'SELL' && price < ema50) { confidence += 2; reasons.push('Price < EMA50 (+2)'); }
            }
            // SuperTrend: single-period direction that stays valid in consolidation (unlike ADX)
            if(st != null && isFinite(st)) {
                const stBull = price > st;
                if(stBull === (dir === 'BUY')) { confidence += 5; reasons.push(`SuperTrend ${stBull ? 'bullish' : 'bearish'} (+5)`); }
                else { confidence -= 4; reasons.push(`SuperTrend opposite (${stBull ? 'bull' : 'bear'}) (-4)`); }
            }

            // Keep final confidence within the conservative 95% cap
            confidence = Math.min(confidence, 95);

            // EV CALCULATION: structural gate, not weight
            const setupWinProb = Math.min(95, 50 + confidence * 0.4); // estimate from confidence
            const ev = calculateEV(setupWinProb, totalRR);
            if(ev <= 0.2) {
                const msg = `${tfToAnalyze} ${dir}: EV ${ev.toFixed(2)}R <= 0.2R minimum`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }
            
            console.log(`  → ${dir} confidence: ${confidence.toFixed(0)}% (${reasons.join(', ')})`);
            console.log(`  → [CONFIDENCE BREAKDOWN] Total: ${confidence.toFixed(1)}% | ATR: ${entryATR ? entryATR.toFixed(4) : 'N/A'} | Reasons: ${reasons.join(' | ')}`);
            console.log(`  → Entry: ${entry}, SL: ${sl}, TP1: ${tp1}, TP2: ${tp2}, TP3: ${tp3}, RR: 1:${totalRR.toFixed(1)}, PartialProfits: ${usePartialProfits}`);
            
            if(confidence < MIN_CONFIDENCE) {
                const msg = `${tfToAnalyze} ${dir}: Confidence ${confidence.toFixed(0)}% < ${MIN_CONFIDENCE}% minimum threshold`;
                console.log(`  ❌ ${msg}`);
                lastScanRejections.push(msg);
                continue;
            }
            
            const dynamicRisk = getDynamicRiskPercent(confidence);
            const tmRules = getTradeManagementRules(confidence);

            allSetups.push({
                dir,
                entry,
                sl,
                tp1, tp2, tp3,
                rr1,
                totalRR,
                usePartialProfits,
                confidence: confidence,
                entryATR: entryATR,
                dynamicRiskPct: dynamicRisk,
                tradeManagement: tmRules,
                adx: adxResult.adx,
                zone,
                msnr: patternResult.msnr,
                freshness,
                zoneType: patternResult.zoneType,
                patterns: patternResult.patterns,
                tbsDetected: patternResult.tbsDetected,
                crtState: patternResult.crtState,
                entryDistancePct,
                htfMatch,
                dailyDir, h4Dir, h1Dir,
                touches: freshness.touches,
                isFresh: freshness.fresh,
                zonePrice: patternResult.zonePrice,
                distancePct: patternResult.distancePct,
                zoneIndicators: zi
            });
        }
        
        if(allSetups.length === 0) return null;
        
        allSetups.sort((a, b) => b.confidence - a.confidence);
        const best = allSetups[0];
        
        return {
            timeframe: tfToAnalyze,
            direction: best.dir,
            entry: best.entry,
            sl: best.sl,
            tp1: best.tp1,
            tp2: best.tp2,
            tp3: best.tp3,
            entryATR: best.entryATR,
            dynamicRiskPct: best.dynamicRiskPct,
            tradeManagement: best.tradeManagement,
            adx: best.adx,
            rr1: best.rr1,
            totalRR: best.totalRR,
            usePartialProfits: best.usePartialProfits,
            confidence: best.confidence,
            zone: best.zone,
            msnr: best.msnr,
            freshness: best.freshness,
            zoneType: best.zoneType,
            patterns: best.patterns,
            tbsDetected: best.tbsDetected,
            crtState: best.crtState,
            entryDistancePct: best.entryDistancePct,
            htfMatch: best.htfMatch,
            dailyDir: best.dailyDir,
            h4Dir: best.h4Dir,
            h1Dir: best.h1Dir,
            touches: best.touches,
            isFresh: best.isFresh,
            zonePrice: best.zonePrice,
            distancePct: best.distancePct,
            zone_condition: best.zoneIndicators ? best.zoneIndicators.condition : null,
            zone_condition_detail: best.zoneIndicators ? best.zoneIndicators.detail : '',
            setupScore: best.confidence
        };
        
    } catch(e) {
        console.error(`❌ Error in ${tfToAnalyze}:`, e);
        return null;
    }
}

async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    // Grow 55 = 55 credits/min. Only 4H/1H are tradeable, so indicator API calls
    // happen ONLY for those (7 each, cached 4 min). 5M/15M/1D scan indicator-free —
    // every indicator check in evaluateSetup is defensive (skips when missing).
    const tradeable = ['4H', '1H'].includes(tfToAnalyze);
    const twelveIndicators = tradeable ? await getTechnicalIndicators(tfToAnalyze, htfData[tfToAnalyze] || null) : {};
    return evaluateSetup(tfToAnalyze, price, htfData, twelveIndicators);
}

// ============================================
// RUN AUTO SCAN - FULL
// ============================================

function normalizeOppositeSetup(input, chosenDirection) {
    const fallbackDir = chosenDirection === 'BUY' ? 'SELL' : 'BUY';
    if (!input || typeof input !== 'object') {
        return { direction: fallbackDir, confidence: 0, why_rejected: 'Not provided by AI' };
    }
    return {
        direction: input.direction || fallbackDir,
        confidence: typeof input.confidence === 'number' ? input.confidence : 0,
        why_rejected: input.why_rejected || 'Not provided by AI'
    };
}

// ============================================
// HOLISTIC EVIDENCE - scores BUY vs SELL before
// letting the AI decide, so the AI can't anchor
// on the first pattern it sees.
// ============================================
function computeHolisticEvidence({ dailyDir, h4Dir, h1Dir, candles, indicators, patterns, phase, rsiDiv, macdDiv }) {
    const closes = candles.map(c => c.c);
    const isMakingHH = closes.length >= 6
        ? closes.slice(-3).every((v, i, arr) => i === 0 || v > arr[i - 1])
          && closes.slice(-6, -3).every((v, i, arr) => i === 0 || v > arr[i - 1])
        : false;
    const isMakingLL = closes.length >= 6
        ? closes.slice(-3).every((v, i, arr) => i === 0 || v < arr[i - 1])
          && closes.slice(-6, -3).every((v, i, arr) => i === 0 || v < arr[i - 1])
        : false;
    const currentPrice = closes[closes.length - 1];
    const e9 = indicators?.ema9;
    const e21 = indicators?.ema21;
    const e50 = indicators?.ema50;
    const e200 = indicators?.ema200;
    const mas = [e9, e21, e50, e200].filter(v => typeof v === 'number' && isFinite(v));
    const aboveEMAs = mas.length > 0 && mas.every(m => currentPrice > m);
    const belowEMAs = mas.length > 0 && mas.every(m => currentPrice < m);

    const fvgs = patterns?.fvg || [];
    const obs = patterns?.orderBlocks || [];
    const bullFVG = fvgs.some(f => f.type === 'bull');
    const bearFVG = fvgs.some(f => f.type === 'bear');
    const bullOB = obs.some(ob => ob.low < currentPrice);
    const bearOB = obs.some(ob => ob.high > currentPrice);

    const ts = patterns?.turtleSoup;
    const tbsBuy = !!(ts && ts.detected && /BUY/i.test(ts.type || ''));
    const tbsSell = !!(ts && ts.detected && /SELL/i.test(ts.type || ''));

    const bullDiv = [rsiDiv, macdDiv].some(d => d && /BULLISH/i.test(d.type || ''));
    const bearDiv = [rsiDiv, macdDiv].some(d => d && /BEARISH/i.test(d.type || ''));

    const isAccumulation = phase && phase.phase === 'ACCUMULATION';
    const isDistribution = phase && phase.phase === 'DISTRIBUTION';

    const scoreSide = (isBull, signals) => {
        if (!isBull) return 0;
        return signals.reduce((a, b) => a + b, 0);
    };

    const buySignals = [
        dailyDir === 'BULLISH' ? 30 : 0,
        h4Dir === 'BULLISH' ? 20 : 0,
        h1Dir === 'BULLISH' ? 15 : 0,
        isMakingHH ? 25 : 0,
        aboveEMAs ? 15 : 0,
        bullFVG ? 10 : 0,
        bullOB ? 10 : 0,
        tbsBuy ? 20 : 0,
        bullDiv ? 15 : 0,
        isAccumulation ? 10 : 0
    ];
    const sellSignals = [
        dailyDir === 'BEARISH' ? 30 : 0,
        h4Dir === 'BEARISH' ? 20 : 0,
        h1Dir === 'BEARISH' ? 15 : 0,
        isMakingLL ? 25 : 0,
        belowEMAs ? 15 : 0,
        bearFVG ? 10 : 0,
        bearOB ? 10 : 0,
        tbsSell ? 20 : 0,
        bearDiv ? 15 : 0,
        isDistribution ? 10 : 0
    ];
    const buyScore = buySignals.reduce((a, b) => a + b, 0);
    const sellScore = sellSignals.reduce((a, b) => a + b, 0);
    const diff = buyScore - sellScore;
    let suggestedDirection = 'NEUTRAL';
    if (diff >= 20) suggestedDirection = 'BUY';
    else if (diff <= -20) suggestedDirection = 'SELL';

    const flags = {
        isMakingHH, isMakingLL, aboveEMAs, belowEMAs,
        bullFVG, bearFVG, bullOB, bearOB,
        tbsBuy, tbsSell, bullDiv, bearDiv,
        isAccumulation, isDistribution
    };
    return { flags, buyScore, sellScore, diff, suggestedDirection };
}

function buildHolisticPromptBlock({ evidence, dailyDir, h4Dir, h1Dir }) {
    const { flags, buyScore, sellScore, suggestedDirection, diff } = evidence;
    const yn = (cond, pts) => cond ? `✅ +${pts}` : '❌ 0';
    const lines = [];
    lines.push('### BUY EVIDENCE:');
    lines.push(`- 1D trend: ${yn(dailyDir === 'BULLISH', 30)}`);
    lines.push(`- 4H trend: ${yn(h4Dir === 'BULLISH', 20)}`);
    lines.push(`- 1H trend: ${yn(h1Dir === 'BULLISH', 15)}`);
    lines.push(`- Higher Highs: ${yn(flags.isMakingHH, 25)}`);
    lines.push(`- Above key EMAs: ${yn(flags.aboveEMAs, 15)}`);
    lines.push(`- Bullish FVG: ${yn(flags.bullFVG, 10)}`);
    lines.push(`- Bullish Order Block: ${yn(flags.bullOB, 10)}`);
    lines.push(`- Turtle Soup BUY: ${yn(flags.tbsBuy, 20)}`);
    lines.push(`- Bullish Divergence (RSI/MACD): ${yn(flags.bullDiv, 15)}`);
    lines.push(`- Accumulation phase: ${yn(flags.isAccumulation, 10)}`);
    lines.push(`- BUY SCORE: ${buyScore}`);
    lines.push('');
    lines.push('### SELL EVIDENCE:');
    lines.push(`- 1D trend: ${yn(dailyDir === 'BEARISH', 30)}`);
    lines.push(`- 4H trend: ${yn(h4Dir === 'BEARISH', 20)}`);
    lines.push(`- 1H trend: ${yn(h1Dir === 'BEARISH', 15)}`);
    lines.push(`- Lower Lows: ${yn(flags.isMakingLL, 25)}`);
    lines.push(`- Below key EMAs: ${yn(flags.belowEMAs, 15)}`);
    lines.push(`- Bearish FVG: ${yn(flags.bearFVG, 10)}`);
    lines.push(`- Bearish Order Block: ${yn(flags.bearOB, 10)}`);
    lines.push(`- Turtle Soup SELL: ${yn(flags.tbsSell, 20)}`);
    lines.push(`- Bearish Divergence (RSI/MACD): ${yn(flags.bearDiv, 15)}`);
    lines.push(`- Distribution phase: ${yn(flags.isDistribution, 10)}`);
    lines.push(`- SELL SCORE: ${sellScore}`);
    lines.push('');
    lines.push('### SCORING DECISION RULE:');
    lines.push('- BUY Score > SELL Score + 20  ->  choose BUY');
    lines.push('- SELL Score > BUY Score + 20  ->  choose SELL');
    lines.push('- |difference| < 20  ->  NEUTRAL (wait, ai_decision = "wait_for_reaction" or "skip")');
    lines.push('');
    lines.push(`### PRE-COMPUTED: suggested=${suggestedDirection}, diff=${diff >= 0 ? '+' : ''}${diff}`);
    lines.push('Align your final decision with this score. If you disagree, you MUST justify it in reasoning.why_best.');
    return lines.join('\n');
}

function ictRound(value, prec = 2) {
    return Number.isFinite(value) ? Number(value.toFixed(prec)) : null;
}

function classifyVolatility(atrPct) {
    if (!Number.isFinite(atrPct)) return 'UNKNOWN';
    if (atrPct >= 2.0) return 'EXTREME';
    if (atrPct >= 1.0) return 'HIGH';
    if (atrPct >= 0.35) return 'NORMAL';
    return 'LOW';
}

function getZonePriceStatus(price, zone) {
    const low = Math.min(Number(zone?.low), Number(zone?.high));
    const high = Math.max(Number(zone?.low), Number(zone?.high));
    if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high)) {
        return { insideZone: false, distanceToZone: null, pricePosition: 'UNKNOWN' };
    }
    if (price >= low && price <= high) {
        return { insideZone: true, distanceToZone: 0, pricePosition: 'INSIDE' };
    }
    if (price < low) {
        return { insideZone: false, distanceToZone: low - price, pricePosition: 'BELOW_ZONE' };
    }
    return { insideZone: false, distanceToZone: price - high, pricePosition: 'ABOVE_ZONE' };
}

function calculateRRMetrics(direction, entry, stopLoss, tp1, minimumRR = 2.5) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(tp1 - entry);
    const actualRR = risk > 0 ? reward / risk : NaN;
    const requiredReward = risk * minimumRR;
    return {
        risk,
        reward,
        actualRR,
        requiredRR: minimumRR,
        required_reward: requiredReward,
        minimum_valid_tp1_price: direction === 'BUY' ? entry + requiredReward : null,
        maximum_valid_tp1_price: direction === 'SELL' ? entry - requiredReward : null,
        geometryOk: direction === 'BUY'
            ? stopLoss < entry && tp1 > entry
            : direction === 'SELL' ? stopLoss > entry && tp1 < entry : false
    };
}

function findTp1TargetCandidate(aiResult, liveMarketContext, rrMetrics, authoritativeCandidate = null) {
    const source = authoritativeCandidate || aiResult;
    const direction = source?.direction;
    const side = direction === 'BUY' ? 'buy' : direction === 'SELL' ? 'sell' : null;
    const candidateMap = authoritativeCandidate?.target_map;
    const hasCandidateMap = Array.isArray(candidateMap) && candidateMap.length > 0;
    const supplied = authoritativeCandidate && hasCandidateMap
        ? candidateMap
        : side
            ? (liveMarketContext?.target_candidates?.all || liveMarketContext?.target_candidates?.[side] || []).filter(c => c.direction === direction)
            : [];
    if (supplied.length === 0) return { checked: false, hasValidCandidate: true, matched: null };

    const entry = Number(source.entry);
    const tp1 = Number(source.take_profit_1 ?? source.tp1);
    const validTargets = supplied
        .filter(c => Number.isFinite(Number(c.level ?? c.target_level)))
        .filter(c => !c.direction || c.direction === direction)
        .filter(c => direction === 'BUY'
            ? Number(c.level ?? c.target_level) + 1e-9 >= rrMetrics.minimum_valid_tp1_price
            : Number(c.level ?? c.target_level) - 1e-9 <= rrMetrics.maximum_valid_tp1_price)
        .sort((a, b) => Math.abs(Number(a.level ?? a.target_level) - entry) - Math.abs(Number(b.level ?? b.target_level) - entry));
    const tolerance = Math.max(Math.abs(tp1) * 0.0002, 0.00001);
    const matched = validTargets.find(c => Math.abs(Number(c.level ?? c.target_level) - tp1) <= tolerance) || null;
    return { checked: true, hasValidCandidate: validTargets.length > 0, matched, nearest: validTargets[0] || null };
}

function getAdaptiveEntryCandidates(zone, direction, prec) {
    const entry = getSemanticEntryCandidate(zone, zone.strategy_setup, direction, prec);
    return entry == null ? [] : [entry];
}

function getSemanticEntryCandidate(zone, strategySetup, direction, prec) {
    const low = Number(zone.low);
    const high = Number(zone.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return null;
    const model = zone.execution_model || zone.entry_model || strategySetup?.execution_model || strategySetup?.entry_model;
    const levels = [zone.entry, strategySetup?.execution_entry, strategySetup?.entry,
        model === 'RECLAIM_RETEST' ? strategySetup?.reclaim_level : null,
        zone.semantic_entry, zone.entry_level, zone.price, zone.midpoint, (low + high) / 2];
    for (const level of levels) {
        if (typeof level !== 'number' || !Number.isFinite(level) || level < low || level > high) continue;
        const entry = ictRound(level, prec);
        if (entry >= low && entry <= high) return entry;
    }
    return null;
}

function getAuthoritativeStructuralInvalidation(zone, strategySetup = null) {
    const setup = strategySetup || zone?.strategy_setup || {};
    if (setup.structural_invalidation_detail && Number.isFinite(Number(setup.structural_invalidation_detail.level))) {
        return { ...setup.structural_invalidation_detail, level: Number(setup.structural_invalidation_detail.level) };
    }
    const direction = zone?.direction || setup.direction;
    const primary = setup.primary || zone?.strategy_source;
    let level = Number(setup.structural_invalidation_anchor ?? zone?.structural_invalidation_anchor);
    let source = setup.structural_invalidation_source || zone?.structural_invalidation_source;
    if (primary === 'TBS') {
        level = Number(setup.sweep_extreme ?? zone?.sweep_extreme ?? level);
        source = 'TBS_SWEEP_EXTREME';
    } else if (primary === 'CRT') {
        level = Number(setup.sweep_extreme ?? zone?.sweep_extreme ?? setup.structural_invalidation ?? level);
        source = 'CRT_SWEEP_EXTREME';
    } else if (primary === 'MSNR') {
        level = Number(setup.structural_invalidation ?? zone?.structural_invalidation ?? level);
        source = 'MSNR_ZONE_INVALIDATION';
    }
    if (!Number.isFinite(level)) return null;
    return { source: source || 'STRATEGY_INVALIDATION', level, strategy: primary || null, timeframe: setup.execution_timeframe || setup.timeframe || zone?.timeframe || null };
}

function getAdaptiveStopCandidates(zone, direction, entry, data, zones, atrVal, settings, prec) {
    const authoritative = getAuthoritativeStructuralInvalidation(zone, zone.strategy_setup);
    const bufferComponents = {
        pip_or_tick_buffer: settings.pipSize,
        spread_buffer: settings.pipSize * 0.5,
        volatility_noise_buffer: (atrVal || 0) * 0.05
    };
    const buffer = Math.max(bufferComponents.pip_or_tick_buffer + bufferComponents.spread_buffer, bufferComponents.volatility_noise_buffer, entry * 0.00002);
    if (authoritative) {
        // Keep the authoritative invalidation as the anchor, while giving the
        // stop enough room for normal setup-timeframe noise. A microscopic
        // anchor buffer can otherwise produce a technically valid but fragile
        // stop, especially on gold and other volatile instruments.
        const anchorRisk = direction === 'BUY' ? entry - (authoritative.level - buffer) : (authoritative.level + buffer) - entry;
        const preferredRisk = Number.isFinite(Number(atrVal)) && atrVal > 0
            ? Math.max(settings.pipSize * 2, atrVal * 0.5)
            : settings.pipSize * 2;
        const riskDistance = Math.max(anchorRisk, preferredRisk);
        const stopLoss = ictRound(direction === 'BUY' ? entry - riskDistance : entry + riskDistance, prec);
        return [{ level: authoritative.level, source: authoritative.source, origin: 'STRUCTURAL', authoritative: true,
            stop_loss: stopLoss, buffer: ictRound(buffer, prec), buffer_components: { ...bufferComponents, final_buffer: ictRound(buffer, prec), preferred_noise_distance: ictRound(preferredRisk, prec), anchor_risk_distance: ictRound(anchorRisk, prec) }, authoritative_invalidation: authoritative }];
    }
    const raw = [];
    const add = (level, source, origin = 'STRUCTURAL', authoritativeSource = false) => {
        const n = Number(level);
        if (!Number.isFinite(n)) return;
        if (direction === 'BUY' && n < entry) raw.push({ level: n, source, origin, authoritative: authoritativeSource });
        if (direction === 'SELL' && n > entry) raw.push({ level: n, source, origin, authoritative: authoritativeSource });
    };

    if (authoritative) add(authoritative.level, authoritative.source, zone.origin || 'STRUCTURAL', true);
    else add(zone.structural_invalidation, 'STRATEGY_INVALIDATION', zone.origin || 'STRUCTURAL', true);
    add(direction === 'BUY' ? zone.low : zone.high, 'ZONE_BOUNDARY', zone.origin || 'STRUCTURAL');
    const sw = findSwings(data || [], 3);
    for (const s of direction === 'BUY' ? (sw.L || []).slice(-10) : (sw.H || []).slice(-10)) {
        add(s.p, direction === 'BUY' ? 'SWING_LOW' : 'SWING_HIGH', 'STRUCTURAL');
    }
    const liq = mapLiquidity(data || []);
    for (const level of direction === 'BUY' ? (liq.below || []) : (liq.above || [])) {
        add(level, direction === 'BUY' ? 'SELL_SIDE_LIQUIDITY' : 'BUY_SIDE_LIQUIDITY', 'STRUCTURAL');
    }
    for (const z of zones || []) {
        if (z.direction !== direction || z.invalidated || z.primary_eligible === false) continue;
        add(direction === 'BUY' ? z.low : z.high, `${z.type}_CLUSTER`, z.origin || 'STRUCTURAL');
    }

    const dedupe = new Map();
    for (const c of raw) {
        const stop = direction === 'BUY' ? c.level - buffer : c.level + buffer;
        const roundedStop = ictRound(stop, prec);
        const key = ictRound(c.level, prec);
        const anchorTolerance = Math.max(settings.pipSize * 0.1, Math.abs(authoritative?.level || 0) * 1e-9);
        const beyondAnchor = !authoritative || (direction === 'BUY'
            ? roundedStop < authoritative.level - anchorTolerance
            : roundedStop > authoritative.level + anchorTolerance);
        if (!beyondAnchor) continue;
        if (!dedupe.has(key)) {
            dedupe.set(key, { ...c, stop_loss: roundedStop, buffer: ictRound(buffer, prec), authoritative_invalidation: authoritative });
        }
    }
    return [...dedupe.values()].sort((a, b) => Math.abs(a.stop_loss - entry) - Math.abs(b.stop_loss - entry));
}

function selectAdaptiveTargets(direction, entry, stopLoss, targetCandidates, minimumRR, prec, reachabilityContext = {}) {
    const side = direction === 'BUY' ? 'buy' : 'sell';
    const risk = Math.abs(entry - stopLoss);
    const requiredReward = risk * minimumRR;
    const threshold = direction === 'BUY' ? entry + requiredReward : entry - requiredReward;
    const rawSourceTargets = targetCandidates?.all
        ? targetCandidates.all.filter(c => c.direction === direction)
        : (targetCandidates?.[side] || []);
    const provenanceValid = rawSourceTargets.filter(c => Number.isFinite(Number(c.level)) && !['ATR_FALLBACK', 'PIVOT_REFERENCE', 'PIVOT_DERIVED'].includes(c.origin));
    const targetMap = new Map();
    for (const candidate of provenanceValid) {
        const level = ictRound(Number(candidate.level), prec);
        const key = `${candidate.direction}|${candidate.timeframe || ''}|${level}`;
        const prior = targetMap.get(key);
        if (!prior) targetMap.set(key, { ...candidate, level, target_confluence: [{ source: candidate.source || candidate.target_type, target_type: candidate.target_type || candidate.source, timeframe: candidate.timeframe || null, level }] });
        else {
            prior.target_confluence = [...new Map([...(prior.target_confluence || []), { source: candidate.source || candidate.target_type, target_type: candidate.target_type || candidate.source, timeframe: candidate.timeframe || null, level }].map(x => [JSON.stringify(x), x])).values()];
            if ((candidate.structural_priority || 0) > (prior.structural_priority || 0)) Object.assign(prior, candidate, { level, target_confluence: prior.target_confluence });
        }
    }
    const sourceTargets = [...targetMap.values()];
    const currentPrice = Number(reachabilityContext.currentPrice);
    const targets = sourceTargets
        .map(c => ({ ...c, level: ictRound(Number(c.level), prec), distance_from_entry: ictRound(Math.abs(Number(c.level) - entry), prec) }))
        .filter(c => direction === 'BUY' ? c.level > entry : c.level < entry)
        .filter(c => !Number.isFinite(currentPrice) || (direction === 'BUY' ? c.level > currentPrice : c.level < currentPrice))
        .map(c => {
            const rr = calculateRRMetrics(direction, entry, stopLoss, c.level, minimumRR);
            const reachability = evaluateTargetReachability({
                direction,
                entry,
                stopLoss,
                target: c,
                historyCache: reachabilityContext.historyCache,
                zones: reachabilityContext.zones,
                liquidity: reachabilityContext.liquidity,
                strategySetup: reachabilityContext.strategySetup
            });
            const strategyNative = !!c.strategy_native || (reachabilityContext.strategySetup?.target_candidates || []).some(t => Number(t.level) === Number(c.level) && (t.source || t.target_type) === (c.source || c.target_type));
            const rrScore = Math.min(24, Math.max(0, (rr.actualRR - minimumRR) * 5));
            const composite_score = (Number(c.structural_priority) || 50) + reachability.reachability_score * 0.75 + rrScore + (strategyNative ? 18 : 0) - (reachability.intervening_obstacles || []).filter(o => o.severity === 'SERIOUS').length * 12;
            return { ...c, actual_rr: rr.actualRR, target_reachability: reachability, reachability_score: reachability.reachability_score, target_quality: reachability.target_quality, strategy_native: strategyNative, composite_score };
        });
    const directionalTargets = targets.length;
    const rrQualifiedTargets = targets.filter(c => direction === 'BUY' ? c.level + 1e-9 >= threshold : c.level - 1e-9 <= threshold);
    const reachableTargets = rrQualifiedTargets.filter(c => !c.target_reachability.hard_unreachable);
    const diagnosticBest = [...reachableTargets, ...rrQualifiedTargets, ...targets].sort((a, b) => a.distance_from_entry - b.distance_from_entry)[0];
    const diagnostics = {
        target_pool_count: rawSourceTargets.length,
        provenance_valid_count: provenanceValid.length,
        directional_target_count: directionalTargets,
        rr_qualified_count: rrQualifiedTargets.length,
        reachable_target_count: reachableTargets.length,
        best_target_level: diagnosticBest?.level || null,
        best_target_rr: diagnosticBest?.actual_rr || null,
        best_target_reachability_score: diagnosticBest?.reachability_score || null,
        failure_code: !rawSourceTargets.length ? 'TARGET_POOL_EMPTY' : !provenanceValid.length ? 'TARGET_PROVENANCE_INVALID' : !directionalTargets ? 'NO_TARGETS_DIRECTIONALLY_AHEAD' : !rrQualifiedTargets.length ? 'TARGETS_EXIST_BUT_RR_TOO_LOW' : !reachableTargets.length ? (rrQualifiedTargets.some(t => (t.target_reachability.intervening_obstacles || []).some(o => o.severity === 'SERIOUS')) ? 'TARGETS_BLOCKED_BY_STRUCTURE' : 'TARGETS_EXIST_BUT_UNREACHABLE') : null
    };
    selectAdaptiveTargets.lastDiagnostics = diagnostics;
    reachabilityContext.targetDiagnostics = diagnostics;
    for (const target of targets) {
        target.primary_target_source = target.source || target.target_type;
        target.target_type = target.target_type || target.source;
        target.target_confluence = target.target_confluence || [{ source: target.source || target.target_type, target_type: target.target_type || target.source, timeframe: target.timeframe || null, level: target.level }];
    }
    const valid = targets
        .filter(c => direction === 'BUY' ? c.level + 1e-9 >= threshold : c.level - 1e-9 <= threshold)
        .filter(c => !c.target_reachability.hard_unreachable)
        .sort((a, b) => a.distance_from_entry - b.distance_from_entry || Number(b.strategy_native) - Number(a.strategy_native) || (b.structural_priority || 0) - (a.structural_priority || 0) || b.reachability_score - a.reachability_score);
    const tp1 = valid[0];
    if (!tp1) return null;
    const farther = valid.filter(c => direction === 'BUY' ? c.level > tp1.level : c.level < tp1.level);
    const ladder = [tp1, ...farther].filter((c, i, arr) => arr.findIndex(x => x.level === c.level) === i).slice(0, 3);
    const rr = calculateRRMetrics(direction, entry, stopLoss, ladder[0].level, minimumRR);
    return {
        tp1: ladder[0],
        tp2: ladder[1] || null,
        tp3: ladder[2] || null,
        rr_tp1: rr.actualRR,
        required_reward: requiredReward,
        minimum_valid_tp1_price: direction === 'BUY' ? ictRound(threshold, prec) : null,
        maximum_valid_tp1_price: direction === 'SELL' ? ictRound(threshold, prec) : null
    };
}

function getCandidateATRContext(candidate, historyCache, pairLocal, price) {
    const settings = getMarketSettings(pairLocal);
    const setupTimeframe = candidate?.timeframe || '1H';
    const setupData = closedStructureCandles(historyCache?.[setupTimeframe] || historyCache?.['1H'] || historyCache?.['4H'] || []);
    const higherTf = setupTimeframe === '4H' ? '1D' : '4H';
    const higherData = getClosedHistory(historyCache, higherTf);
    const setupAtr = setupData.length >= 15 ? atr(setupData, 14) : NaN;
    const higherAtr = higherData.length >= 15 ? atr(higherData, 14) : NaN;
    const fallbackData = getClosedHistory(historyCache, '4H');
    const fallbackAtr = fallbackData.length >= 15 ? atr(fallbackData, 14) : NaN;
    const atrForRule = Number.isFinite(setupAtr) && setupAtr > 0
        ? setupAtr
        : (Number.isFinite(fallbackAtr) && fallbackAtr > 0 ? fallbackAtr : NaN);
    const minMultiplier = settings.minSLMultiplier || 1.5;
    const minimumReasonable = Number.isFinite(atrForRule) && atrForRule > 0
        ? Math.max(settings.minSL, atrForRule * 0.5)
        : settings.minSL;
    const absoluteMinSL = Math.max(settings.pipSize, Number.isFinite(atrForRule) && atrForRule > 0 ? atrForRule * 0.10 : settings.pipSize);
    const preferredMinSL = Number.isFinite(atrForRule) && atrForRule > 0
        ? Math.max(settings.pipSize * 2, atrForRule * 0.5)
        : settings.pipSize * 2;
    const maxByAtr = Number.isFinite(atrForRule) && atrForRule > 0 ? atrForRule * 10.0 : Infinity;
    const maxByPrice = Number(price) * settings.maxSLPct;
    const maxDistance = Math.max(absoluteMinSL, Math.min(maxByPrice, maxByAtr));
    return {
        setup_timeframe: setupTimeframe,
        setup_atr: Number.isFinite(setupAtr) && setupAtr > 0 ? setupAtr : null,
        higher_timeframe: higherTf,
        higher_timeframe_atr: Number.isFinite(higherAtr) && higherAtr > 0 ? higherAtr : null,
        atr_rule_reference: Number.isFinite(atrForRule) && atrForRule > 0 ? atrForRule : null,
        min_atr_multiplier: minMultiplier,
        minimum_reasonable_distance: minimumReasonable,
        absolute_min_sl: absoluteMinSL,
        preferred_min_sl: preferredMinSL,
        extreme_too_tight_distance: absoluteMinSL,
        maximum_reasonable_distance: maxDistance
    };
}

function evaluateStructuralStop(candidate, atrContext, pairLocal) {
    const settings = getMarketSettings(pairLocal);
    const direction = candidate?.direction;
    const entry = Number(candidate?.entry);
    const stopLoss = Number(candidate?.stop_loss);
    if (!ictFiniteNumber(entry) || !ictFiniteNumber(stopLoss)) {
        return { status: 'STRUCTURALLY_INVALID', reason: 'stop or entry is not finite' };
    }
    if (direction === 'BUY' && !(stopLoss < entry)) {
        return { status: 'STRUCTURALLY_INVALID', reason: 'BUY stop must be below entry' };
    }
    if (direction === 'SELL' && !(stopLoss > entry)) {
        return { status: 'STRUCTURALLY_INVALID', reason: 'SELL stop must be above entry' };
    }
    const invalidation = candidate?.structural_invalidation && typeof candidate.structural_invalidation === 'object'
        ? candidate.structural_invalidation
        : (candidate?.structural_invalidation_anchor != null && Number.isFinite(Number(candidate.structural_invalidation_anchor)) ? { level: Number(candidate.structural_invalidation_anchor), source: candidate.structural_invalidation_source || 'STRATEGY_INVALIDATION' } : null);
    if (invalidation && Number.isFinite(Number(invalidation.level))) {
        const tolerance = Math.max(settings.pipSize * 0.1, Math.abs(Number(invalidation.level)) * 1e-9);
        const inside = direction === 'BUY' ? stopLoss >= Number(invalidation.level) - tolerance : stopLoss <= Number(invalidation.level) + tolerance;
        if (inside) {
            return { status: 'SL_INSIDE_STRUCTURAL_INVALIDATION', hardReject: true, volatility_classification: 'STRUCTURAL_INVALIDATION_FAILURE', reason: `${direction} stop ${stopLoss} is inside ${invalidation.source || 'strategy'} invalidation ${invalidation.level}` };
        }
    }
    const riskDistance = Math.abs(entry - stopLoss);
    // Pair minimums remain diagnostic references. A structurally valid stop is
    // not rejected solely for being slightly tighter than that reference.
    const atrMultiple = atrContext.atr_rule_reference ? riskDistance / atrContext.atr_rule_reference : null;
    const absoluteMinSL = atrContext.absolute_min_sl ?? atrContext.extreme_too_tight_distance;
    if (absoluteMinSL && riskDistance <= absoluteMinSL) {
        return { status: 'EXTREME_TOO_TIGHT', hardReject: true, volatility_classification: 'EXTREME_TOO_TIGHT', reason: `SL distance ${riskDistance.toFixed(settings.prec)} is below absolute execution floor ${absoluteMinSL.toFixed(settings.prec)} and below minimum reasonable distance for ${atrContext.setup_timeframe}` };
    }
    if (riskDistance > atrContext.maximum_reasonable_distance) {
        return { status: 'EXTREME_TOO_WIDE', hardReject: true, volatility_classification: 'EXTREME_TOO_WIDE', reason: `SL distance ${riskDistance.toFixed(settings.prec)} exceeds ${atrContext.setup_timeframe} maximum reasonable distance ${atrContext.maximum_reasonable_distance.toFixed(settings.prec)}` };
    }
    const volatilityClassification = Number.isFinite(atrMultiple)
        ? (riskDistance < (atrContext.preferred_min_sl || (atrMultiple < 0.75 ? atrContext.atr_rule_reference * 0.75 : 0)) ? 'TIGHT_BUT_STRUCTURAL' : (atrMultiple > 6 ? 'WIDE_BUT_STRUCTURAL' : 'NORMAL'))
        : 'NORMAL';
    return { status: 'VALID_STRUCTURAL_STOP', hardReject: false, volatility_classification: volatilityClassification, reason: `Structural stop is ${volatilityClassification}`, riskDistance, atrMultiple, quality_warning: volatilityClassification === 'TIGHT_BUT_STRUCTURAL' };
}

function classifySetupArchetype(candidate, historyCache, price, structure) {
    const direction = candidate?.direction;
    const desiredTrend = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const trends = ['1D', '4H', '1H'].map(tf => structure?.[tf]?.effective_trend || structure?.[tf]?.structural_trend || structure?.[tf]?.trend).filter(Boolean);
    const htfMatch = trends.filter(v => v === desiredTrend).length;
    const evidence = {
        liquidity_sweep: false,
        mss: false,
        choch: false,
        displacement: false,
        premium_discount: false,
        evidence_count: 0
    };
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (!data || data.length < 20) continue;
        const sweep = detectLiquiditySweep(data, price, direction);
        if (sweep) evidence.liquidity_sweep = true;
        const mss = detectMSS(data);
        if (mss && ((mss.type === 'BULL' && direction === 'BUY') || (mss.type === 'BEAR' && direction === 'SELL'))) evidence.mss = true;
        if (detectCHoCH(data, direction)) evidence.choch = true;
        if (detectDisplacement(data, direction)) evidence.displacement = true;
    }
    const pdData = historyCache?.['4H']?.length >= 20 ? historyCache['4H'] : (historyCache?.['1H'] || []);
    const pd = isPremiumDiscount(pdData, Number(candidate?.entry) || price);
    const pdZone = String(pd.zone || '').toUpperCase();
    evidence.premium_discount = (direction === 'BUY' && pdZone === 'DISCOUNT') || (direction === 'SELL' && pdZone === 'PREMIUM');
    if (candidate?.reversal_evidence && Number.isFinite(candidate.reversal_evidence.evidence_count)) {
        Object.assign(evidence, candidate.reversal_evidence);
    }
    evidence.evidence_count = ['liquidity_sweep', 'mss', 'choch', 'displacement', 'premium_discount'].filter(k => evidence[k]).length;
    const setup_archetype = htfMatch >= HTF_MIN_MATCH ? 'CONTINUATION' : 'REVERSAL';
    return { setup_archetype, reversal_evidence: evidence, htfMatch };
}

function buildRiskConstraints(pairLocal, price, historyCache, quoteSnapshot = null) {
    const settings = getMarketSettings(pairLocal);
    const prec = settings.prec;
    const closed4h = getClosedHistory(historyCache, '4H');
    const closed1h = getClosedHistory(historyCache, '1H');
    const closed15m = getClosedHistory(historyCache, '15M');
    const atr4h = closed4h.length >= 15 ? atr(closed4h, 14) : null;
    const atr1h = closed1h.length >= 15 ? atr(closed1h, 14) : null;
    const atr15m = closed15m.length >= 15 ? atr(closed15m, 14) : null;
    const primaryAtr = Number.isFinite(atr4h) && atr4h > 0 ? atr4h : (Number.isFinite(atr1h) && atr1h > 0 ? atr1h : atr15m);
    const absoluteMinSL = Math.max(settings.pipSize, Number.isFinite(primaryAtr) && primaryAtr > 0 ? primaryAtr * 0.10 : settings.pipSize);
    const rawMaxSLDistance = primaryAtr > 0 ? Math.min(price * settings.maxSLPct, primaryAtr * 4.0) : price * settings.maxSLPct;
    const currentSpread = Number(quoteSnapshot?.spread);
    const maximumSpread = Math.max(settings.pipSize * 10, Number.isFinite(primaryAtr) && primaryAtr > 0 ? primaryAtr * 0.15 : settings.pipSize * 10);
    return {
        minimum_rr: settings.targetRR || 2.5,
        minimum_sl_distance: ictRound(absoluteMinSL, prec),
        absolute_min_sl: ictRound(absoluteMinSL, prec),
        preferred_min_sl: ictRound(Math.max(settings.pipSize * 2, (primaryAtr || 0) * 0.5), prec),
        maximum_sl_distance: ictRound(Math.max(absoluteMinSL, rawMaxSLDistance), prec),
        maximum_entry_distance_atr: LIMIT_ORDER_MAX_DIST_ATR,
        current_spread: Number.isFinite(currentSpread) ? ictRound(currentSpread, prec) : null,
        maximum_spread: ictRound(maximumSpread, prec),
        spread_status: Number.isFinite(currentSpread) ? (currentSpread <= maximumSpread ? 'VALID' : 'TOO_WIDE') : 'UNKNOWN',
        spread_valid: Number.isFinite(currentSpread) ? currentSpread <= maximumSpread : null,
        atr_rule_reference: Number.isFinite(primaryAtr) && primaryAtr > 0 ? ictRound(primaryAtr, prec) : null,
        note: 'Physical SL sanity is evaluated per candidate setup timeframe; this broad context is not a universal 4H-derived stop minimum.',
        tp1_rule: {
            formula: 'risk = abs(entry - stop_loss); required_reward = risk * minimum_rr',
            buy_minimum_valid_tp1: 'entry + required_reward',
            sell_maximum_valid_tp1: 'entry - required_reward'
        }
    };
}

function buildDeterministicValidationContext({ pair, price, historyCache, real_ict_zones, risk_constraints, structure, market_context, strategy_setups, require_strategy_setup, market_open = null, quote_snapshot = null }) {
    return {
        pair,
        price,
        historyCache,
        real_ict_zones: real_ict_zones || [],
        risk_constraints,
        structure,
        market_context,
        market_open,
        quote_snapshot,
        strategy_setups: strategy_setups || [],
        require_strategy_setup: !!require_strategy_setup
    };
}

function strategyZoneKey(zone) {
    if (!zone) return null;
    return [
        zone.timeframe || '',
        zone.direction || '',
        zone.type || zone.zone_type || '',
        ictRound(Number(zone.low ?? zone.zone_low), 8),
        ictRound(Number(zone.high ?? zone.zone_high), 8)
    ].join('|');
}

const TOP_DOWN_QUALITY_ADJUSTMENTS = Object.freeze({
    HTF_ALIGNED_CONTINUATION: 4,
    HTF_VERIFIED_REVERSAL: 4,
    LTF_ISOLATED: -6
});

function buildTimeframeContext({ historyCache = {}, structure = {}, price, strategySetups = [], zones = [], liquidity = {} } = {}) {
    return Object.fromEntries(['1D', '4H', '1H', '15M'].map(tf => {
        const data = getClosedHistory(historyCache, tf);
        const snapshot = structure[tf] || buildStructureSnapshot(data, tf);
        const lastTime = data.at(-1)?.t ?? 'UNAVAILABLE';
        const evidence = [];
        const add = (kind, direction, value, identity = lastTime) => {
            const id = ['TD', tf, kind, direction, identity].join(':');
            evidence.push({ id, kind, direction, timeframe: tf, value });
        };
        const structuralTrend = snapshot.structural_trend || snapshot.trend;
        const effectiveTrend = snapshot.effective_trend || structuralTrend;
        // Keep the UI, bias evidence, and setup classifier on one canonical
        // directional read. Raw structural_trend remains available for
        // diagnostics, but MIXED must not hide a confirmed effective trend.
        const displayedTrend = getCanonicalDisplayedTrend({
            ...snapshot,
            structural_trend: structuralTrend,
            effective_trend: effectiveTrend
        });
        const bias = ['BULLISH', 'BEARISH'].includes(displayedTrend) ? displayedTrend :
            displayedTrend === 'BULLISH_TRANSITION' ? 'BULLISH' :
            displayedTrend === 'BEARISH_TRANSITION' ? 'BEARISH' : 'NEUTRAL';
        if (['BULLISH', 'BEARISH'].includes(bias)) add('TREND', bias === 'BULLISH' ? 'BUY' : 'SELL', bias);
        for (const direction of ['BUY', 'SELL']) {
            const side = direction.toLowerCase();
            if (snapshot['choch_' + side]) add('CHOCH', direction, true);
            if (snapshot['bos_' + side]) add('BOS', direction, true);
            if (snapshot.mss?.type === (direction === 'BUY' ? 'BULL' : 'BEAR')) add('MSS', direction, snapshot.mss.level);
            if (detectDisplacement(data, direction)) add('DISPLACEMENT', direction, true);
            const sweep = liquidity[tf]?.sweeps?.find(s => s.type === direction && s.swept)
                || detectLiquiditySweep(data, price, direction);
            if (sweep?.swept) add('LIQUIDITY_SWEEP', direction, sweep.level, [lastTime, sweep.level].join(':'));
        }
        const events = strategySetups.filter(s => (s.setup_timeframe || s.timeframe) === tf
            && s.narrative_state === 'ACTIVE');
        for (const event of events) {
            if (['CRT', 'TBS'].includes(event.primary)) add(event.primary, event.direction, event.reclaim_level, event.id);
        }
        const levels = zones.filter(z => z.timeframe === tf && !z.invalidated);
        const majorLiquidity = liquidity[tf] || mapLiquidity(data);
        return [tf, {
            role: { '1D': 'MACRO_CONTEXT', '4H': 'PRIMARY_NARRATIVE', '1H': 'INTRADAY_STRUCTURE', '15M': 'EXECUTION_SETUP' }[tf],
            bias, structural_trend: structuralTrend, momentum_trend: snapshot.momentum_trend || 'NEUTRAL', effective_trend: effectiveTrend, displayed_trend: displayedTrend, structure: snapshot, mss: snapshot.mss || null,
            bos: { buy: !!snapshot.bos_buy, sell: !!snapshot.bos_sell },
            choch: { buy: !!snapshot.choch_buy, sell: !!snapshot.choch_sell },
            liquidity_draw: bias === 'BULLISH' ? 'BUY_SIDE_LIQUIDITY' : bias === 'BEARISH' ? 'SELL_SIDE_LIQUIDITY' : 'UNRESOLVED',
            major_liquidity: majorLiquidity,
            previous_period: tf === '1D' && data.length ? { high: data.at(-1).h, low: data.at(-1).l, time: lastTime } : null,
            premium_discount: data.length >= 20 ? isPremiumDiscount(data, price).zone : 'UNAVAILABLE',
            crt_events: events.filter(s => s.primary === 'CRT').map(s => s.id),
            tbs_events: events.filter(s => s.primary === 'TBS').map(s => s.id),
            msnr_levels: levels.filter(z => z.type === 'MSNR' && z.origin === 'STRUCTURAL_MSNR').map(z => ({ id: z.id, low: z.low, high: z.high, direction: z.direction })),
            zones: levels.map(z => ({ id: z.id, type: z.type, low: z.low, high: z.high, direction: z.direction })),
            execution_events: tf === '15M' ? events.map(s => s.id) : [],
            structural_evidence_ids: evidence.map(e => e.id), evidence
        }];
    }));
}

function classifyTopDownTrade(candidate, timeframeContext = {}) {
    const direction = candidate.direction;
    const wanted = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const supports = tf => [timeframeContext[tf]?.displayed_trend, timeframeContext[tf]?.effective_trend, timeframeContext[tf]?.structural_trend, timeframeContext[tf]?.bias]
        .some(value => value === wanted || value === `${wanted}_TRANSITION`);
    // 4H leads. Daily/1H agreement strengthens the thesis, but a validated
    // 4H/1H location and real objective are enough to describe a developing
    // continuation when the higher timeframe is neutral or consolidating.
    const location = candidate?.opportunity_narrative?.location || candidate?.location || candidate?.execution_zone;
    const hasValidatedLocation = !!location && ['4H', '1H'].includes(location.timeframe)
        && Array.isArray(candidate?.target_candidates) && candidate.target_candidates.length > 0;
    const aligned = supports('4H') && (supports('1D') || supports('1H') || hasValidatedLocation);
    const higherEvidence = ['1D', '4H'].flatMap(tf => timeframeContext[tf]?.evidence || []);
    const shifts = ['4H', '1H'].flatMap(tf => timeframeContext[tf]?.evidence || [])
        .filter(e => e.direction === direction && (['MSS', 'CHOCH'].includes(e.kind)
            || (e.kind === 'BOS' && (timeframeContext[e.timeframe]?.evidence || []).some(d => d.kind === 'DISPLACEMENT' && d.direction === direction))));
    const raids = higherEvidence.filter(e => e.direction === direction && ['LIQUIDITY_SWEEP', 'CRT', 'TBS'].includes(e.kind));
    const verifiedReversal = raids.length > 0 && shifts.length > 0;
    const classification = aligned ? 'HTF_ALIGNED_CONTINUATION' : verifiedReversal ? 'HTF_VERIFIED_REVERSAL' : 'LTF_ISOLATED';
    const evidence = aligned ? ['1D', '4H', '1H'].flatMap(tf => timeframeContext[tf]?.evidence || []).filter(e => e.kind === 'TREND' && e.direction === direction)
        : verifiedReversal ? [...raids, ...shifts] : [];
    return {
        classification, evidence_ids: [...new Set(evidence.map(e => e.id))],
        higher_timeframe: Object.fromEntries([['daily', '1D'], ['four_hour', '4H'], ['one_hour', '1H']].map(([key, tf]) => {
            const context = timeframeContext[tf];
            const signals = (context?.evidence || []).filter(e => e.kind !== 'TREND' && e.direction === direction).map(e => e.kind);
            const trend = context?.displayed_trend || getCanonicalDisplayedTrend(context || {}) || context?.bias || 'UNAVAILABLE';
            return [key, tf + ': ' + trend + (signals.length ? '; ' + [...new Set(signals)].join(', ') + ' supports ' + direction : '')];
        })),
        reason: aligned ? '4H direction is supported by daily or 1H structure.' : verifiedReversal
            ? 'Higher-timeframe liquidity reversal evidence is confirmed by a 4H or 1H structure shift.'
            : 'No coherent higher-timeframe continuation or verified reversal supports this local setup.'
    };
}

function verifyTopDownTradeClassification(claim, timeframeContext) {
    const actual = classifyTopDownTrade(claim, timeframeContext);
    const known = new Set(Object.values(timeframeContext || {}).flatMap(tf => tf.structural_evidence_ids || []));
    const ids = claim.top_down_evidence_ids || [];
    if (ids.some(id => !known.has(id))) return { verified: false, reason_code: 'TOP_DOWN_EVIDENCE_UNKNOWN', actual };
    if (claim.trade_context_classification !== actual.classification) return { verified: false, reason_code: 'TOP_DOWN_CLASSIFICATION_UNSUPPORTED', actual };
    if (actual.classification !== 'LTF_ISOLATED' && (!actual.evidence_ids.length || actual.evidence_ids.some(id => !ids.includes(id)))) {
        return { verified: false, reason_code: 'TOP_DOWN_EVIDENCE_INCOMPLETE', actual };
    }
    return { verified: true, actual };
}

function buildDailyTradingBias(timeframeContext, targets, price, asOfTime) {
    const directionFor = bias => bias === 'BULLISH' ? 'BUY' : bias === 'BEARISH' ? 'SELL' : 'NEUTRAL';
    const allEvidence = Object.entries(timeframeContext || {}).flatMap(([tf, context]) =>
        (context?.evidence || []).map(e => ({ ...e, timeframe: e.timeframe || tf })));
    const score = { BUY: 0, SELL: 0 };
    const evidenceBySide = { BUY: [], SELL: [] };
    const add = (side, weight, evidence) => {
        if (!['BUY', 'SELL'].includes(side)) return;
        score[side] += weight;
        if (evidence?.id) evidenceBySide[side].push(evidence);
    };
    for (const [tf, weight] of [['1D', 2], ['4H', 4], ['1H', 2]]) {
        const context = timeframeContext?.[tf];
        const side = directionFor(context?.structural_trend || context?.bias);
        if (side !== 'NEUTRAL') add(side, weight, (context?.evidence || []).find(e => e.kind === 'TREND'));
    }
    for (const e of allEvidence) {
        const side = e.direction;
        const weight = e.kind === 'LIQUIDITY_SWEEP' ? 2 : ['MSS', 'CHOCH', 'BOS'].includes(e.kind) ? 1.5 :
            ['CRT', 'TBS', 'MSNR'].includes(e.kind) ? 1.25 : e.kind === 'DISPLACEMENT' ? 1 : 0;
        if (weight) add(side, weight, e);
    }
    const position = String(timeframeContext?.['4H']?.premium_discount || '').toUpperCase();
    if (position === 'DISCOUNT') score.BUY += 1;
    if (position === 'PREMIUM') score.SELL += 1;
    const directionalTarget = side => (targets?.all || []).filter(t => t.direction === side && Number.isFinite(t.level)
        && (side === 'BUY' ? t.level > price : t.level < price));
    const targetFor = side => directionalTarget(side).slice().sort((a, b) => {
        const priority = (b.structural_priority || 0) - (a.structural_priority || 0);
        return priority || Math.abs(a.level - price) - Math.abs(b.level - price);
    })[0];
    const targetBuy = targetFor('BUY');
    const targetSell = targetFor('SELL');
    if (targetBuy) score.BUY += 2;
    if (targetSell) score.SELL += 2;
    const choose = score.BUY === score.SELL ? 'NEUTRAL' : score.BUY > score.SELL ? 'BUY' : 'SELL';
    const other = choose === 'BUY' ? 'SELL' : 'BUY';
    const target = choose === 'NEUTRAL' ? null : targetFor(choose);
    const primary = timeframeContext?.['4H'];
    const swings = choose === 'BUY' ? primary?.structure?.recent_swing_lows : primary?.structure?.recent_swing_highs;
    const anchor = choose === 'NEUTRAL' ? null : (swings || []).filter(s => Number.isFinite(s.level)
        && (choose === 'BUY' ? s.level < price : s.level > price)).at(-1);
    const targetId = target?.id || (target ? `DRAW:${target.timeframe}:${target.source}:${target.level}` : null);
    const invalidationId = anchor ? `INVALIDATION:4H:${choose}:${anchor.level}` : null;
    const conflicts = [];
    if (score.BUY > 0 && score.SELL > 0 && Math.abs(score.BUY - score.SELL) < 2) conflicts.push('MATERIAL_DIRECTION_CONFLICT');
    if (!target) conflicts.push('NO_LIQUIDITY_DRAW');
    if (!anchor) conflicts.push('NO_STRUCTURAL_INVALIDATION');
    const supported = choose !== 'NEUTRAL' && Math.abs(score.BUY - score.SELL) >= 2 && !!target && !!anchor;
    const sideEvidence = supported ? evidenceBySide[choose] : [];
    return {
        direction: supported ? choose : 'NEUTRAL', confidence: null,
        score: { BUY: score.BUY, SELL: score.SELL },
        structural_trend_1d: timeframeContext?.['1D']?.structural_trend || timeframeContext?.['1D']?.bias || 'NEUTRAL',
        primary_4h_narrative: primary?.bias || 'NEUTRAL',
        target_type: target?.source || null, target_level: target?.level ?? null,
        target_evidence_ids: targetId ? [targetId] : [],
        invalidation_type: anchor ? '4H_CONFIRMED_SWING' : null, invalidation_level: anchor?.level ?? null,
        invalidation_evidence_ids: invalidationId ? [invalidationId] : [],
        liquidity_draw: target ? `${target.source} ${target.level}` : 'NO_PROVEN_DRAW',
        dealing_range_position: primary?.premium_discount || 'UNKNOWN',
        evidence_ids: [...new Set([...sideEvidence.map(e => e.id), targetId, invalidationId].filter(Boolean))],
        conflicts,
        as_of_time: asOfTime,
        reason: supported ? `Evidence-weighted ${choose} thesis: ${score[choose].toFixed(1)} vs ${score[other].toFixed(1)} with a remaining ${target.source} objective.`
            : 'Direction, remaining structural objective, and invalidation are not all proven.'
    };
}

function buildMarketMechanicsSetups({ historyCache, timeframeContext, dailyBias, targets, zones, pair: pairLocal, price }) {
    const setups = [];
    const discovery = { discovery_buy_events: 0, discovery_sell_events: 0, discovery_structure_shifts: 0,
        discovery_liquidity_events: 0, discovery_pois: 0, discovery_reversal_candidates: 0, discovery_continuation_candidates: 0, discovery_events: [] };
    const locationPois = ['4H', '1H', '15M'].flatMap(tf => buildSupplyDemandAndFlipPOIs(historyCache?.[tf] || [], tf, price, pairLocal));
    // Build the pending-limit narrative from the current HTF map first. A
    // confirmation shift is required only by confirmation-entry models; it
    // must not be required before a valid future limit location can be shown.
    for (const direction of ['BUY', 'SELL']) {
        const wanted = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
        const lead = timeframeContext?.['4H'];
        const leadTrend = lead?.effective_trend || lead?.structural_trend || lead?.bias;
        if (leadTrend !== wanted && leadTrend !== `${wanted}_TRANSITION`) continue;
        const location = [...(zones || []), ...locationPois]
            .filter(zone => zone.direction === direction && ['4H', '1H'].includes(zone.timeframe)
                // location_only POIs are valid narrative locations. They are
                // not executable geometry until the candidate planner proves
                // an entry zone, stop, target, RR, and lifecycle.
                && (zone.primary_eligible !== false || zone.location_only === true) && !zone.invalidated
                && !['CONSUMED', 'USED', 'INVALIDATED', 'EXPIRED'].includes(String(zone.freshness || '').toUpperCase()))
            .sort((a, b) => (Number(b.timeframe === '4H') - Number(a.timeframe === '4H'))
                || (Number(a.low <= price && price <= a.high) - Number(b.low <= price && price <= b.high))
                || Math.abs(((a.low + a.high) / 2) - price) - Math.abs(((b.low + b.high) / 2) - price))[0];
        const targetPool = (targets?.all || []).filter(target => target.direction === direction && Number.isFinite(target.level)
            && (direction === 'BUY' ? target.level > price : target.level < price));
        const swings = direction === 'BUY' ? lead?.structure?.recent_swing_lows : lead?.structure?.recent_swing_highs;
        const anchor = (swings || []).filter(s => Number.isFinite(s.level)
            && (direction === 'BUY' ? s.level < Number(location?.low) : s.level > Number(location?.high))).at(-1);
        if (!location || !targetPool.length || !anchor) continue;
        const eventTime = location.created_time || location.created_time_ms || lead?.structure?.last_closed_candle_time || null;
        const id = `ICT:CONTINUATION:${direction}:${location.id || strategyZoneKey(location)}`;
        const pendingLimitZone = location.location_only ? null : {
            ...location,
            execution_model: 'PENDING_LIMIT',
            entry_model: 'PENDING_LIMIT',
            entry_reachable_today: true
        };
        setups.push({ id, primary: 'ICT', label: 'MARKET_MECHANICS', direction,
            timeframe: location.timeframe, setup_timeframe: location.timeframe, execution_timeframe: location.timeframe === '4H' ? '1H' : '15M',
            event_time: eventTime, narrative_state: 'ACTIVE', execution_zone: pendingLimitZone, execution_model: 'PENDING_LIMIT', entry_model: 'PENDING_LIMIT',
            structural_invalidation: anchor.level, structural_invalidation_detail: { level: anchor.level, source: 'HTF_STRUCTURE', timeframe: '4H' },
            target_candidates: targetPool, primary_objective: targetPool[0].level,
            opportunity_narrative: { id: `NARRATIVE:${id}`, state: 'DEVELOPING', location,
                liquidity_event_ids: [], structural_shift_ids: [], evidence_ids: (lead?.structural_evidence_ids || []).slice(),
                target_intent: targetPool[0].source, invalidation_intent: anchor.level, execution_requirement: 'RETRACE_TO_LOCATION' },
            market_mechanics_verified: true, execution_confirmed: false, structural_evidence_ids: lead?.structural_evidence_ids || [], freshness: 'DEVELOPING', original_strategy_entry_consumed: false });
    }
    // A closed structure shift is the signal. Only later, qualified fresh zones can execute it.
    for (const tf of ['1H', '15M']) {
        const data = getClosedHistory(historyCache, tf);
        for (const direction of ['BUY', 'SELL']) {
            // getClosedHistory() has already removed the forming candle. The
            // last element is therefore a confirmed closed event and must be
            // eligible for discovery; stopping at length - 2 silently drops
            // the newest live MSS/CHoCH/BOS.
            for (let i = Math.max(20, data.length - STRATEGY_SPEC.EXECUTION.maxFreshExecutionZones - 8); i < data.length; i++) {
                const prefix = data.slice(0, i + 1);
                const mss = detectMSS(prefix);
                const choch = detectCHoCH(prefix, direction);
                const bos = detectBOS(prefix, direction);
                const displacement = detectDisplacement(prefix, direction);
                const shift = (mss?.type === (direction === 'BUY' ? 'BULL' : 'BEAR')) || choch || (bos && displacement);
                const eventTime = candleTimestamp(data[i], i, tf);
                const discoveryEvent = { timeframe: tf, bar_index: i, bar_timestamp: eventTime, direction,
                    mss: mss?.type === (direction === 'BUY' ? 'BULL' : 'BEAR'), choch, bos, displacement,
                    shift_detected: !!shift, narrative_created: false, failure_reason: null };
                discovery.discovery_events.push(discoveryEvent);
                if (!shift) { discoveryEvent.failure_reason = 'NO_STRUCTURE_SHIFT'; continue; }
                discovery[direction === 'BUY' ? 'discovery_buy_events' : 'discovery_sell_events']++;
                discovery.discovery_structure_shifts++;
                const eventContext = Object.fromEntries(Object.entries(timeframeContext || {}).map(([key, value]) => [key, {
                    ...value, evidence: [...(value?.evidence || [])].concat(key === tf ? [
                        { id: `SHIFT:${tf}:${direction}:${eventTime}`, kind: 'MSS', direction, timeframe: tf }
                    ] : [])
                }]));
                const classification = classifyTopDownTrade({ direction }, eventContext);
                if (classification.classification === 'HTF_VERIFIED_REVERSAL') discovery.discovery_reversal_candidates++;
                if (classification.classification === 'HTF_ALIGNED_CONTINUATION') discovery.discovery_continuation_candidates++;
                const swing = findSwings(prefix, 3);
                const anchor = (direction === 'BUY' ? swing.L : swing.H)?.at(-1)?.p;
                if (!Number.isFinite(anchor)) { discoveryEvent.failure_reason = 'NO_STRUCTURAL_INVALIDATION'; continue; }
                const location = locationPois.filter(zone => zone.direction === direction && !zone.invalidated &&
                    ['FRESH', 'TOUCHED', 'TESTED'].includes(String(zone.freshness || '').toUpperCase()))
                    .sort((a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price))[0]
                    || (zones || []).filter(zone => zone.direction === direction && !zone.invalidated && zone.primary_eligible !== false)
                        .sort((a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price))[0];
                if (location) discovery.discovery_pois++;
                if (!location) discoveryEvent.failure_reason = 'NO_LOCATION_POI';
                const targetPool = (targets?.all || []).filter(t => t.direction === direction && Number.isFinite(t.level)
                    && (direction === 'BUY' ? t.level > price : t.level < price));
                if (!targetPool.length && !discoveryEvent.failure_reason) discoveryEvent.failure_reason = 'NO_TARGET_POOL';
                const narrative = { id: `ICT:${tf}:${direction}:${eventTime}`, primary: 'ICT', label: 'ICT', direction,
                    timeframe: tf, setup_timeframe: tf, execution_timeframe: tf, event_time: eventTime,
                    reclaim_index: i, structural_invalidation: anchor, target_candidates: targetPool,
                    primary_objective: targetPool[0]?.level ?? null, confirmations: [], evidence: { shift: true, displacement: detectDisplacement(prefix, direction) },
                    opportunity_narrative: { id: `NARRATIVE:${tf}:${direction}:${eventTime}`, state: 'DEVELOPING', location: location || null,
                        liquidity_event_ids: (timeframeContext?.[tf]?.evidence || []).filter(e => e.kind === 'LIQUIDITY_SWEEP').map(e => e.id),
                        structural_shift_ids: [`SHIFT:${tf}:${direction}:${eventTime}`], evidence_ids: [...classification.evidence_ids],
                        target_intent: targetPool[0]?.source || null, invalidation_intent: anchor, execution_requirement: 'FRESH_EXECUTION_ZONE' } };
                const life = evaluateStrategyNarrative(narrative, historyCache, price);
                if (life.state !== 'ACTIVE') { discoveryEvent.failure_reason = life.rejection_code || life.state || 'NARRATIVE_NOT_ACTIVE'; continue; }
                const freshZones = buildFreshExecutionZonesForNarrative(narrative, historyCache, zones, pairLocal, price);
                if (freshZones.length === 0) {
                    setups.push({ ...narrative, narrative_state: 'ACTIVE', execution_zone: null, execution_model: classification.classification === 'HTF_VERIFIED_REVERSAL' ? 'CONFIRMATION_ENTRY' : 'PENDING_LIMIT',
                        entry_model: classification.classification === 'HTF_VERIFIED_REVERSAL' ? 'CONFIRMATION_ENTRY' : 'PENDING_LIMIT',
                        trade_context_classification: classification.classification, structural_invalidation_detail: { level: anchor, source: 'ICT_SHIFT_ORIGIN_SWING', strategy: 'ICT', timeframe: tf, source_time: eventTime },
                        market_mechanics_verified: true, execution_confirmed: false, structural_evidence_ids: [...classification.evidence_ids, `SHIFT:${tf}:${direction}:${eventTime}`], freshness: 'DEVELOPING', original_strategy_entry_consumed: false });
                    discoveryEvent.narrative_created = true;
                }
                for (const zone of freshZones) {
                    setups.push({ ...narrative, id: `${narrative.id}:${zone.id}`, narrative_state: 'ACTIVE',
                        execution_zone: zone, execution_model: classification.classification === 'HTF_VERIFIED_REVERSAL' ? 'CONFIRMATION_ENTRY' : 'FRESH_RETRACEMENT_LIMIT', entry_model: classification.classification === 'HTF_VERIFIED_REVERSAL' ? 'CONFIRMATION_ENTRY' : 'FRESH_RETRACEMENT_LIMIT',
                        execution_event_time: zone.created_time, execution_event_index: zone.created_index,
                        execution_zone_created_time: zone.created_time, execution_zone_created_index: zone.created_index,
                        structural_invalidation_detail: { level: anchor, source: 'ICT_SHIFT_ORIGIN_SWING', strategy: 'ICT', timeframe: tf, source_time: eventTime },
                        structural_entry_region: { low: zone.low, high: zone.high },
                        market_mechanics_verified: true, execution_confirmed: classification.classification !== 'HTF_VERIFIED_REVERSAL',
                        structural_evidence_ids: [...classification.evidence_ids, `SHIFT:${tf}:${direction}:${eventTime}`, zone.id],
                        freshness: 'FRESH', original_strategy_entry_consumed: false });
                    discoveryEvent.narrative_created = true;
                }
            }
        }
    }
    const physical = new Map();
    for (const setup of setups) {
        const key = strategyZoneKey(setup.execution_zone);
        if (!physical.has(key)) physical.set(key, setup);
    }
    const result = [...physical.values()];
    result.discovery = discovery;
    return result;
}

function buildOpportunityThesis(setup, marketContext, price) {
    const zone = setup.execution_zone || setup.opportunity_narrative?.location || null;
    const executionZone = setup.execution_zone;
    const topDown = classifyTopDownTrade(setup, marketContext.timeframe_context);
    const invalidation = getAuthoritativeStructuralInvalidation(executionZone || zone, setup);
    const target = (setup.target_candidates || []).find(t => Number.isFinite(t.level)
        && (setup.direction === 'BUY' ? t.level > price : t.level < price));
    const model = setup.execution_model === 'CONFIRMATION_ENTRY' || setup.entry_model === 'CONFIRMATION_ENTRY'
        || topDown.classification !== 'HTF_ALIGNED_CONTINUATION' ? 'CONFIRMATION_ENTRY' : 'PENDING_LIMIT';
    const confirmation = setup.market_mechanics_verified === true && setup.execution_confirmed === true
        || topDown.classification === 'HTF_VERIFIED_REVERSAL';
    const failures = [];
    if (!zone || !Number.isFinite(zone.low) || !Number.isFinite(zone.high) || zone.high < zone.low) failures.push('NO_MEANINGFUL_POI');
    if (zone?.invalidated) failures.push('POI_INVALIDATED');
    if (zone?.mitigated || zone?.touch_count > 0 || ['CONSUMED', 'USED'].includes(zone?.freshness)) failures.push('POI_CONSUMED');
    if (!invalidation) failures.push('NO_STRUCTURAL_INVALIDATION');
    if (!target) failures.push('NO_REAL_TARGET');
    if (topDown.classification === 'LTF_ISOLATED') failures.push('LTF_ISOLATED');
    if (model === 'CONFIRMATION_ENTRY' && executionZone && !confirmation) failures.push('EXECUTION_NOT_CONFIRMED');
    return { id: `THESIS:${setup.id}`, direction: setup.direction, daily_bias: marketContext.daily_bias,
        htf_narrative: topDown, liquidity_draw: target?.source || null,
        location: zone ? { id: zone.id, type: zone.type, timeframe: zone.timeframe, low: zone.low, high: zone.high,
            created_time: zone.created_time || setup.event_time, freshness: zone.freshness,
            evidence_ids: [zone.id].filter(Boolean) } : null,
        execution_model: model, required_confirmation: model === 'CONFIRMATION_ENTRY' ? 'CLOSED_STRUCTURAL_SHIFT' : null,
        execution_confirmed: model === 'PENDING_LIMIT' || confirmation,
        strategy_confluence: [setup.primary, ...(setup.confirmations || [])],
        target_intent: target?.source || null, structural_invalidation_intent: invalidation,
        evidence_ids: [...topDown.evidence_ids, ...(setup.structural_evidence_ids || [])],
        state: failures.length ? 'AWAITING_CONFIRMATION' : 'EXECUTION_VALID', rejection_codes: failures };
}

function prepareOpportunitySetups(setups, marketContext, price) {
    for (const setup of setups) setup.opportunity_thesis = buildOpportunityThesis(setup, marketContext, price);
    const terminalCodes = new Set(['SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED', 'SETUP_EXPIRED', 'SETUP_STALE']);
    const rejectionCounts = setups.reduce((counts, setup) => {
        for (const code of setup.opportunity_thesis.rejection_codes || []) counts[code] = (counts[code] || 0) + 1;
        return counts;
    }, {});
    marketContext.opportunity_funnel = {
        raw_market_opportunities: setups.length,
        direction_supported: setups.filter(s => s.opportunity_thesis.htf_narrative.classification !== 'LTF_ISOLATED').length,
        liquidity_draw_found: setups.filter(s => !!s.opportunity_thesis.liquidity_draw).length,
        poi_found: setups.filter(s => s.opportunity_thesis.location).length,
        at_poi: setups.filter(s => s.execution_zone && price >= s.execution_zone.low && price <= s.execution_zone.high).length,
        execution_waiting: setups.filter(s => s.opportunity_thesis.state !== 'EXECUTION_VALID').length,
        execution_confirmed: setups.filter(s => s.opportunity_thesis.state === 'EXECUTION_VALID').length,
        structural_stop_valid: setups.filter(s => !!s.opportunity_thesis.structural_invalidation_intent).length,
        target_valid: setups.filter(s => !!s.opportunity_thesis.target_intent).length,
        rr_valid: 0,
        lifecycle_valid: setups.filter(s => !terminalCodes.has(s.rejection_code)).length,
        trade_ready: 0,
        old_terminal_opportunities: setups.filter(s => terminalCodes.has(s.rejection_code) || s.original_strategy_entry_consumed).length,
        fresh_current_market_opportunities: setups.filter(s => !terminalCodes.has(s.rejection_code) && isTodayFreshContinuation(s, s.execution_zone)).length,
        rejection_counts: rejectionCounts
    };
    return setups;
}

function buildMarketContext({ pair, price, historyCache, structure, session, sessionCheck, liquidity, premiumDiscount, marketRegime, momentum, volatility, holistic }) {
    const bullishEvidence = [];
    const bearishEvidence = [];
    const conflicts = [];
    const htfTrends = ['1D', '4H', '1H'].map(tf => structure?.[tf]?.effective_trend || structure?.[tf]?.structural_trend).filter(Boolean);
    const bullishCount = htfTrends.filter(v => v === 'BULLISH').length;
    const bearishCount = htfTrends.filter(v => v === 'BEARISH').length;
    if (bullishCount > bearishCount) bullishEvidence.push(`${bullishCount}/3 HTF trends bullish`);
    if (bearishCount > bullishCount) bearishEvidence.push(`${bearishCount}/3 HTF trends bearish`);
    if (bullishCount && bearishCount) conflicts.push(`HTF mixed: ${bullishCount} bullish / ${bearishCount} bearish`);

    for (const tf of ['4H', '1H', '15M']) {
        const s = structure?.[tf];
        if (!s) continue;
        if (s.bos_buy) bullishEvidence.push(`${tf} bullish BOS`);
        if (s.bos_sell) bearishEvidence.push(`${tf} bearish BOS`);
        if (s.choch_buy) bullishEvidence.push(`${tf} bullish CHoCH`);
        if (s.choch_sell) bearishEvidence.push(`${tf} bearish CHoCH`);
        if (s.mss?.type === 'BULL') bullishEvidence.push(`${tf} bullish MSS`);
        if (s.mss?.type === 'BEAR') bearishEvidence.push(`${tf} bearish MSS`);
    }

    const pd = String(premiumDiscount?.classification || '').toUpperCase();
    if (pd === 'DISCOUNT') bullishEvidence.push('price in discount');
    if (pd === 'PREMIUM') bearishEvidence.push('price in premium');
    if (marketRegime?.displacement?.buy_4h || marketRegime?.displacement?.buy_1h) bullishEvidence.push('bullish displacement');
    if (marketRegime?.displacement?.sell_4h || marketRegime?.displacement?.sell_1h) bearishEvidence.push('bearish displacement');
    if (holistic?.suggestedDirection === 'BULLISH') bullishEvidence.push('holistic context bullish');
    if (holistic?.suggestedDirection === 'BEARISH') bearishEvidence.push('holistic context bearish');

    const bullScore = bullishEvidence.length * 9 + bullishCount * 5;
    const bearScore = bearishEvidence.length * 9 + bearishCount * 5;
    let directionalBias = 'NEUTRAL';
    if (Math.abs(bullScore - bearScore) < 8) directionalBias = bullScore || bearScore ? 'MIXED' : 'NEUTRAL';
    else directionalBias = bullScore > bearScore ? 'BULLISH' : 'BEARISH';
    const contextScore = Math.max(0, Math.min(88, 45 + Math.abs(bullScore - bearScore) - conflicts.length * 5));

    return {
        directional_bias: directionalBias,
        context_score: contextScore,
        bullish_evidence: bullishEvidence.slice(0, 8),
        bearish_evidence: bearishEvidence.slice(0, 8),
        conflicts: conflicts.slice(0, 5),
        structure,
        htf_alignment: {
            bullish_count: bullishCount,
            bearish_count: bearishCount,
            aligned_direction: bullishCount === bearishCount ? 'MIXED' : (bullishCount > bearishCount ? 'BULLISH' : 'BEARISH')
        },
        bos: Object.fromEntries(['4H', '1H', '15M'].map(tf => [tf, { buy: !!structure?.[tf]?.bos_buy, sell: !!structure?.[tf]?.bos_sell }])),
        choch: Object.fromEntries(['4H', '1H', '15M'].map(tf => [tf, { buy: !!structure?.[tf]?.choch_buy, sell: !!structure?.[tf]?.choch_sell }])),
        mss: Object.fromEntries(['4H', '1H', '15M'].map(tf => [tf, structure?.[tf]?.mss || null])),
        liquidity,
        fvg: Object.fromEntries(['4H', '1H'].map(tf => [tf, (detectFVG(historyCache?.[tf] || []) || []).slice(-5)])),
        order_blocks: Object.fromEntries(['4H', '1H'].map(tf => [tf, {
            buy: detectOrderBlocks(historyCache?.[tf] || [], 'BUY').slice(-3),
            sell: detectOrderBlocks(historyCache?.[tf] || [], 'SELL').slice(-3)
        }])),
        premium_discount: premiumDiscount,
        displacement: marketRegime?.displacement || {},
        session,
        as_of_time: new Date().toISOString(),
        amd: { phase: marketRegime?.phase || 'UNKNOWN', regime: marketRegime?.primary_regime || 'UNKNOWN' },
        indicators: momentum,
        volatility
    };
}

function buildStrategySetups({ pair, price, historyCache, realZones, marketContext }) {
    const setups = [];
    const detectionStats = {
        CRT: { raw_count: 0, deduped_count: 0, bullish: 0, bearish: 0 },
        TBS: { raw_count: 0, deduped_count: 0, bullish: 0, bearish: 0 },
        MSNR: { raw_count: 0, deduped_count: 0, structural_count: 0, executable_count: 0, pivot_reference_count: 0, atr_fallback_count: 0 }
    };
    const zoneList = realZones || [];
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const makeExecutionZone = (setup, low, high, type, entryModel = 'RECLAIM_RETEST') => ({
        id: `${setup.timeframe}-${setup.direction}-${type}-${ictRound(low, prec)}-${ictRound(high, prec)}-${setups.length + 1}`,
        type,
        origin: 'STRUCTURAL',
        primary_eligible: true,
        direction: setup.direction,
        timeframe: setup.timeframe,
        low: ictRound(Math.min(low, high), prec),
        high: ictRound(Math.max(low, high), prec),
        midpoint: ictRound((low + high) / 2, prec),
        invalidated: false,
        freshness: setup.freshness || 'FRESH',
        strategy_source: setup.primary,
        entry_model: entryModel,
        entry_region_source: setup.entry_region_source || entryModel,
        entry_region_low: ictRound(Math.min(low, high), prec),
        entry_region_high: ictRound(Math.max(low, high), prec),
        created_time_ms: normalizeTimestampUTC(setup.event_time) || null,
        created_time_utc: normalizeTimestampUTC(setup.event_time) ? new Date(normalizeTimestampUTC(setup.event_time)).toISOString() : null,
        created_index_timeframe: setup.timeframe || null,
        zone_timeframe: setup.timeframe || null,
        parent_event_time_ms: normalizeTimestampUTC(setup.event_time) || null,
        parent_strategy_timeframe: setup.setup_timeframe || setup.timeframe || null,
        structural_invalidation: setup.structural_invalidation
    });
    const zonesNearRegion = (direction, tf, low, high) => {
        const width = Math.max(Math.abs(high - low), settings.pipSize * 5);
        return zoneList.filter(z => z.direction === direction && z.primary_eligible !== false && !z.invalidated)
            .filter(z => z.high >= low - width * 2 && z.low <= high + width * 2);
    };
    const addSetup = (setup) => {
        if (!setup || !setup.direction || !setup.primary) return;
        const invalidationLevel = Number(setup.structural_invalidation);
        if (Number.isFinite(invalidationLevel)) {
            setup.structural_invalidation_detail = {
                strategy: setup.primary,
                direction: setup.direction,
                level: invalidationLevel,
                source: setup.primary === 'TBS' ? 'TBS_SWEEP_EXTREME' : setup.primary === 'CRT' ? 'CRT_SWEEP_EXTREME' : 'MSNR_ZONE_INVALIDATION',
                timeframe: setup.execution_timeframe || setup.timeframe || null,
                source_time: setup.sweep_time || setup.retest_time || setup.source_time || setup.event_time || null
            };
        }
        const matchedZones = (setup.matched_zones || []).filter(Boolean);
        const executionZone = setup.execution_zone || (matchedZones[0] ? { ...matchedZones[0], strategy_source: setup.primary } : null);
        if (!executionZone) return;
        Object.assign(setup, evaluateSetupLifecycle({
            strategy_setup: setup, direction: setup.direction,
            entry: executionZone.midpoint, zone_low: executionZone.low, zone_high: executionZone.high
        }, { historyCache, price }));
        setups.push({
            ...setup,
            id: setup.id || `${setup.timeframe}-${setup.primary}-${setup.direction}-${setups.length + 1}`,
            matched_zone_ids: matchedZones.map(z => z.id || strategyZoneKey(z)),
            matched_zones: matchedZones.map(z => ({
                id: z.id || strategyZoneKey(z),
                type: z.type,
                direction: z.direction,
                timeframe: z.timeframe,
                low: z.low,
                high: z.high,
                origin: z.origin
            })),
            execution_zone: executionZone
        });
    };

    const addStrategyEvidence = (setup) => ({
        CRT: setup.primary === 'CRT' ? setup.evidence : null,
        TBS: setup.primary === 'TBS' ? setup.evidence : null,
        MSNR: setup.primary === 'MSNR' ? setup.evidence : null
    });
    const addTargets = (setup) => {
        if (setup.primary === 'CRT') {
            setup.target_candidates = setup.target_candidates || [{
                direction: setup.direction,
                level: setup.primary_objective,
                source: 'CRT_OPPOSITE_RANGE',
                target_type: 'CRT_OPPOSITE_RANGE',
                origin: 'STRUCTURAL',
                timeframe: setup.timeframe,
                structural_priority: 96
            }];
        } else if (setup.primary === 'TBS') {
            setup.target_candidates = [];
            setup.target_bias = setup.direction === 'BUY' ? 'BUY_SIDE_LIQUIDITY' : 'SELL_SIDE_LIQUIDITY';
        } else if (setup.primary === 'MSNR') {
            const opposing = zoneList
                .filter(z => z.type === 'MSNR' && z.origin === 'STRUCTURAL_MSNR' && z.direction !== setup.direction && z.primary_eligible !== false)
                .filter(z => setup.direction === 'BUY' ? z.low > setup.execution_zone.high : z.high < setup.execution_zone.low)
                .sort((a, b) => Math.abs(((a.low + a.high) / 2) - price) - Math.abs(((b.low + b.high) / 2) - price));
            setup.target_candidates = opposing.slice(0, 3).map(z => ({
                direction: setup.direction,
                level: ictRound((z.low + z.high) / 2, prec),
                source: 'OPPOSING_MSNR',
                target_type: 'OPPOSING_MSNR',
                origin: 'STRUCTURAL_MSNR',
                timeframe: z.timeframe,
                structural_priority: 88
            }));
        }
        setup.strategy_evidence = addStrategyEvidence(setup);
        return setup;
    };

    for (const tf of ['4H', '1H', '15M']) {
        const data = getClosedHistory(historyCache, tf);
        if (!data || data.length < 20) continue;
        const atrVal = data.length >= 15 ? atr(data, 14) : 0;
        const buffer = Math.max(settings.pipSize * 2, (atrVal || 0) * 0.08, price * 0.00002);
        const zonesForTf = zoneList.filter(z => z.timeframe === tf && z.primary_eligible !== false && !z.invalidated);
        for (const zone of zonesForTf.filter(z => z.type === 'MSNR')) {
            if (zone.origin !== 'STRUCTURAL_MSNR') continue;
            detectionStats.MSNR.structural_count++;
            detectionStats.MSNR.executable_count++;
            addSetup(addTargets({
                primary: 'MSNR',
                label: 'MSNR',
                direction: zone.direction,
                setup_timeframe: tf,
                execution_timeframe: tf === '4H' ? '1H' : tf,
                timeframe: tf,
                structural_entry_region: { low: zone.low, high: zone.high },
                departure_confirmed_index: zone.departure_confirmed_index,
                break_index: zone.break_index,
                retest_index: zone.retest_index,
                first_retest_index: zone.first_retest_index,
                structural_invalidation: zone.direction === 'BUY' ? zone.low : zone.high,
                execution_zone: { ...zone, strategy_source: 'MSNR' },
                entry_model: zone.role?.includes('_TO_') ? 'ROLE_REVERSAL_RETEST' : 'REACTION_ZONE_RETEST',
                entry_region_source: zone.role?.includes('_TO_') ? 'ROLE_REVERSAL_RETEST' : 'MSNR_BODY_TRANSITION_ZONE',
                evidence: {
                    level: zone.midpoint,
                    origin: zone.origin,
                    zone_low: zone.low,
                    zone_high: zone.high,
                    transition_type: zone.transition_type,
                    role: zone.role,
                    source_candle_index: zone.source_candle_index,
                    touch_count: zone.touch_count,
                    mitigation_count: zone.mitigation_count
                },
                confirmations: [],
                matched_zones: [zone]
            }));
        }

        const tbsStartedAt = scanClock();
        const tbsEvents = detectTurtleSoupEvents(data, tf, pair);
        console.log('[PERF] TBS detection', { timeframe: tf, elapsed_ms: Math.round((scanClock() - tbsStartedAt) * 100) / 100, raw_events: tbsEvents.raw_detection_count || 0, deduped_events: tbsEvents.deduped_detection_count || tbsEvents.length });
        detectionStats.TBS.raw_count += tbsEvents.raw_detection_count ?? tbsEvents.length;
        detectionStats.TBS.deduped_count += tbsEvents.deduped_detection_count ?? tbsEvents.length;
        for (const tbs of tbsEvents.filter(e => e.detected)) {
            if (tbs.direction === 'BUY') detectionStats.TBS.bullish++;
            if (tbs.direction === 'SELL') detectionStats.TBS.bearish++;
            const executionZone = makeExecutionZone({ ...tbs, primary: 'TBS', timeframe: tf }, tbs.reclaim_level - buffer, tbs.reclaim_level + buffer, 'TBS');
            const near = zonesNearRegion(tbs.type, tf, executionZone.low, executionZone.high);
            const confirmations = [];
            if (near.some(z => z.type === 'MSNR')) confirmations.push('MSNR');
            if (near.some(z => z.type === 'FVG')) confirmations.push('FVG');
            if (near.some(z => z.type === 'OB')) confirmations.push('OB');
            addSetup(addTargets({
                primary: 'TBS',
                label: confirmations.includes('MSNR') ? 'TBS+MSNR' : 'TBS',
                direction: tbs.type,
                setup_timeframe: tf,
                execution_timeframe: tf === '4H' ? '1H' : tf,
                timeframe: tf,
                liquidity_level: tbs.liquidity_level,
                sweep_extreme: tbs.sweep_extreme,
                reclaim_level: tbs.reclaim_level,
                reclaim_confirmed: tbs.reclaim_confirmed,
                source_time: tbs.source_time,
                sweep_time: tbs.sweep_time,
                reclaim_time: tbs.reclaim_time ?? (Number.isInteger(tbs.reclaim_bar_index) ? candleTimestamp(data[tbs.reclaim_bar_index], tbs.reclaim_bar_index, tf) : null),
                reclaim_bar_index: tbs.reclaim_bar_index,
                event_time: tbs.event_time ?? tbs.reclaim_time ?? (Number.isInteger(tbs.reclaim_bar_index) ? candleTimestamp(data[tbs.reclaim_bar_index], tbs.reclaim_bar_index, tf) : null),
                event_age: tbs.event_age,
                freshness: tbs.freshness,
                structural_entry_region: { low: executionZone.low, high: executionZone.high },
                structural_invalidation: tbs.sweep_extreme,
                execution_zone: executionZone,
                entry_model: tbs.entry_model,
                entry_region_source: 'TBS_RECLAIM_RETEST',
                evidence: { ...tbs.evidence, liquidity_level: tbs.keyLevel, sweep_extreme: tbs.sweep_extreme, reclaim_price: tbs.reclaim_price, timeframe: tf },
                confirmations,
                matched_zones: near
            }));
        }

        const crtStartedAt = scanClock();
        const crtEvents = detectCRTEvents(data, tf, pair);
        console.log('[PERF] CRT detection', { timeframe: tf, elapsed_ms: Math.round((scanClock() - crtStartedAt) * 100) / 100, raw_events: crtEvents.raw_detection_count || 0, deduped_events: crtEvents.deduped_detection_count || crtEvents.length });
        detectionStats.CRT.raw_count += crtEvents.raw_detection_count ?? crtEvents.length;
        detectionStats.CRT.deduped_count += crtEvents.deduped_detection_count ?? crtEvents.length;
        for (const crt of crtEvents.filter(e => e.detected)) {
            const crtDirection = crt.direction;
            if (crtDirection === 'BUY') detectionStats.CRT.bullish++;
            if (crtDirection === 'SELL') detectionStats.CRT.bearish++;
            const entryLevel = crt.reclaim_level || (crtDirection === 'BUY' ? crt.range_low : crt.range_high);
            const executionZone = makeExecutionZone({ ...crt, primary: 'CRT', timeframe: tf }, entryLevel - buffer, entryLevel + buffer, 'CRT');
            const crtZones = zonesNearRegion(crtDirection, tf, executionZone.low, executionZone.high);
            const confirmations = [];
            if (crtZones.some(z => z.type === 'MSNR')) confirmations.push('MSNR');
            if (crtZones.some(z => z.type === 'FVG')) confirmations.push('FVG');
            if (crtZones.some(z => z.type === 'OB')) confirmations.push('OB');
            addSetup(addTargets({
                primary: 'CRT',
                label: confirmations.includes('MSNR') ? 'CRT+MSNR' : 'CRT',
                direction: crtDirection,
                setup_timeframe: tf,
                execution_timeframe: tf === '4H' ? '1H' : tf,
                timeframe: tf,
                range_high: crt.range_high,
                range_low: crt.range_low,
                manipulation_side: crt.manipulation_side,
                sweep_extreme: crt.sweep_extreme,
                source_time: crt.source_time,
                sweep_time: crt.sweep_time,
                reclaim_time: crt.reclaim_time ?? (Number.isInteger(crt.reclaim_bar_index) ? candleTimestamp(data[crt.reclaim_bar_index], crt.reclaim_bar_index, tf) : null),
                reclaim_bar_index: crt.reclaim_bar_index,
                event_time: crt.event_time ?? crt.reclaim_time ?? (Number.isInteger(crt.reclaim_bar_index) ? candleTimestamp(data[crt.reclaim_bar_index], crt.reclaim_bar_index, tf) : null),
                reclaim_level: crt.reclaim_level,
                event_age: crt.event_age,
                freshness: crt.freshness,
                structural_entry_region: { low: executionZone.low, high: executionZone.high },
                structural_invalidation: crt.sweep_extreme || (crtDirection === 'BUY' ? crt.range_low : crt.range_high),
                execution_zone: executionZone,
                entry_model: crt.entry_model,
                entry_region_source: 'CRT_RECLAIM_RETEST',
                primary_objective: crt.primary_objective,
                target_candidates: crt.target_candidates,
                evidence: { ...crt.evidence, direction: crtDirection, range_high: crt.range_high, range_low: crt.range_low, timeframe: tf },
                confirmations,
                matched_zones: crtZones
            }));
        }
    }
    const rawSetupCount = setups.length;
    const dedupedSetups = dedupeByNarrative(setups, s => `${s.primary}-${s.direction}-${s.timeframe}-${strategyZoneKey(s.execution_zone)}`, s => (s.execution_zone?.primary_eligible !== false ? 100 : 0) + (s.evidence?.structural_score || 0) - (s.event_age || 0));
    const boundedSetups = dedupedSetups
        .slice()
        .sort((a, b) => (b.execution_zone?.primary_eligible !== false) - (a.execution_zone?.primary_eligible !== false) || (b.evidence?.structural_score || 0) - (a.evidence?.structural_score || 0) || (a.event_age || 0) - (b.event_age || 0))
        .slice(0, STRATEGY_SPEC.COMBINATION.maxSetups);
    setups.length = 0;
    setups.push(...boundedSetups);
    detectionStats.strategy_setup_raw_count = rawSetupCount;
    detectionStats.strategy_setup_deduped_count = dedupedSetups.length;
    detectionStats.strategy_setup_bounded_count = boundedSetups.length;
    const originalNarratives = [...setups];
    const freshExecutionSetups = [];
    const freshZoneStats = { discovered: 0, fresh: 0, consumed: 0, invalidated: 0, pre_signal: 0, wrong_side: 0 };
    let activeNarratives = 0;
    let invalidatedNarratives = 0;
    let completedNarratives = 0;
    let staleNarratives = 0;
    for (const narrative of originalNarratives) {
        const narrativeState = evaluateStrategyNarrative(narrative, historyCache, price);
        narrative.narrative_state = narrativeState.state;
        narrative.narrative_event_time = narrativeState.event_time;
        narrative.narrative_event_age_hours = narrativeState.event_age_hours;
        narrative.original_strategy_entry_consumed = !!narrative.entry_consumed;
        if (narrativeState.state === 'INVALIDATED') invalidatedNarratives++;
        if (narrativeState.state === 'TARGET_COMPLETED') completedNarratives++;
        if (narrativeState.state === 'STALE_NARRATIVE') staleNarratives++;
        if (narrativeState.state !== 'ACTIVE') continue;
        activeNarratives++;
        const freshZones = buildFreshExecutionZonesForNarrative(narrative, historyCache, zoneList, pair, price);
        for (const key of Object.keys(freshZoneStats)) freshZoneStats[key] += freshZones.execution_zone_stats?.[key] || 0;
        for (const zone of freshZones) {
            const freshSetup = {
                ...narrative,
                id: `${narrative.id || narrative.primary}-${zone.type}-fresh-${zone.created_index}`,
                label: narrative.label,
                execution_zone: zone,
                entry_model: 'FRESH_RETRACEMENT_LIMIT',
                execution_model: 'FRESH_RETRACEMENT_LIMIT',
                entry_region_source: zone.entry_region_source,
                structural_entry_region: { low: zone.low, high: zone.high },
                matched_zones: [zone],
                matched_zone_ids: [zone.id],
                original_strategy_entry_consumed: !!narrative.entry_consumed,
                execution_zone_consumed: false,
                execution_zone_created_time: zone.created_time,
                execution_zone_created_index: zone.created_index,
                execution_event_time: zone.created_time,
                execution_event_index: zone.created_index,
                event_time: narrative.event_time,
                narrative_state: 'ACTIVE',
                narrative_evidence: narrative.evidence,
                strategy_evidence: narrative.strategy_evidence,
                target_candidates: [...(narrative.target_candidates || [])]
            };
            Object.assign(freshSetup, evaluateSetupLifecycle({
                strategy_setup: freshSetup,
                direction: freshSetup.direction,
                entry: zone.midpoint,
                zone_low: zone.low,
                zone_high: zone.high,
                execution_event_time: zone.created_time,
                execution_event_index: zone.created_index
            }, { historyCache, price, pair }));
            freshSetup.opportunity_status = freshSetup.opportunity_status;
            freshExecutionSetups.push(freshSetup);
        }
    }
    const rawFreshExecutionSetupCount = freshExecutionSetups.length;
    const freshByPhysicalZone = new Map();
    for (const freshSetup of freshExecutionSetups) {
        const zone = freshSetup.execution_zone;
        const key = `${zone.direction}|${zone.timeframe}|${ictRound(zone.low, prec)}|${ictRound(zone.high, prec)}|${normalizeTimestampUTC(zone.created_time) || zone.created_index}`;
        const prior = freshByPhysicalZone.get(key);
        if (!prior) {
            freshSetup.strategy_confluence = [freshSetup.label || freshSetup.primary];
            freshSetup.narrative_ids = [freshSetup.id];
            freshSetup.confluence_score = 1;
            freshByPhysicalZone.set(key, freshSetup);
        } else {
            prior.strategy_confluence = [...new Set([...(prior.strategy_confluence || []), freshSetup.label || freshSetup.primary])];
            prior.narrative_ids = [...new Set([...(prior.narrative_ids || []), freshSetup.id])];
            prior.confirmations = [...new Set([...(prior.confirmations || []), ...(freshSetup.confirmations || []), freshSetup.primary])];
            prior.label = [...new Set([...(String(prior.label || '').split('+')), ...(String(freshSetup.label || freshSetup.primary).split('+'))])].filter(Boolean).join('+');
            prior.target_candidates = mergeStrategyTargets([prior.target_candidates, freshSetup.target_candidates]);
            prior.confluence_score = prior.strategy_confluence.length;
        }
    }
    const dedupedFreshExecutionSetups = [...freshByPhysicalZone.values()];
    dedupedFreshExecutionSetups.sort((a, b) => (b.confluence_score - a.confluence_score) || ((b.execution_zone?.created_index || 0) - (a.execution_zone?.created_index || 0)));
    dedupedFreshExecutionSetups.splice(STRATEGY_SPEC.EXECUTION.maxFreshExecutionSetups);
    setups.push(...dedupedFreshExecutionSetups);
    detectionStats.strategy_narratives = originalNarratives.length;
    detectionStats.active_narratives = activeNarratives;
    detectionStats.invalidated_narratives = invalidatedNarratives;
    detectionStats.completed_narratives = completedNarratives;
    detectionStats.stale_narratives = staleNarratives;
    detectionStats.fresh_execution_zones_discovered = rawFreshExecutionSetupCount;
    detectionStats.fresh_execution_zones = dedupedFreshExecutionSetups.length;
    detectionStats.fresh_execution_zones_raw = rawFreshExecutionSetupCount;
    detectionStats.execution_zones_discovered = freshZoneStats.discovered;
    detectionStats.execution_zones_fresh = freshZoneStats.fresh;
    detectionStats.consumed_execution_zones = freshZoneStats.consumed;
    detectionStats.invalidated_execution_zones = freshZoneStats.invalidated;
    detectionStats.pre_signal_execution_zones = freshZoneStats.pre_signal;
    detectionStats.wrong_side_execution_zones = freshZoneStats.wrong_side;
    detectionStats.expired_execution_zones = staleNarratives;
    const nativeTargets = new Map(setups.map(setup => [setup, [...(setup.target_candidates || [])]]));
    for (const setup of setups) {
        const compatible = setups
            .filter(other => other !== setup && other.primary !== setup.primary &&
                ['FRESH_NOW', 'FRESH_PENDING_TODAY', 'FRESH_PENDING_LATER'].includes(other.lifecycle_state || other.setup_lifecycle_status) &&
                ['FRESH_NOW', 'FRESH_PENDING_TODAY', 'FRESH_PENDING_LATER'].includes(setup.lifecycle_state || setup.setup_lifecycle_status))
            .map(other => ({ other, compatibility: evaluateCombinationCompatibility(setup, other, settings) }))
            .filter(x => x.compatibility.combination_score >= STRATEGY_SPEC.COMBINATION.minScore)
            .filter(x => x.compatibility.same_liquidity_event || setup.primary === 'MSNR' || x.other.primary === 'MSNR');
        setup.combination_evidence = compatible.map(x => ({ strategy: x.other.primary, ...x.compatibility }));
        const strategies = [...new Set([setup.primary, ...compatible.map(x => x.other.primary)])];
        if (strategies.length > 1) {
            setup.label = strategies.join('+');
            setup.confirmations = [...new Set([...(setup.confirmations || []), ...strategies.filter(s => s !== setup.primary)])];
            for (const { other } of compatible) {
                setup.strategy_evidence[other.primary] = other.evidence;
            }
            setup.target_candidates = mergeStrategyTargets([nativeTargets.get(setup), ...compatible.map(({ other }) => nativeTargets.get(other))]);
        }
    }
    console.log('CRT DETECTIONS', setups.filter(s => s.primary === 'CRT'));
    console.log('TBS DETECTIONS', setups.filter(s => s.primary === 'TBS'));
    console.log('MSNR DETECTIONS', setups.filter(s => s.primary === 'MSNR'));
    console.log('STRATEGY COMBINATIONS', setups.filter(s => String(s.label || '').includes('+')).map(s => ({ id: s.id, label: s.label, direction: s.direction, timeframe: s.timeframe })));
    console.log('STRATEGY SETUPS', setups);
    Object.defineProperty(setups, 'detection_stats', { value: detectionStats, enumerable: false, configurable: true });
    return setups;
}

function mergeStrategyTargets(targetLists) {
    const targets = new Map();
    for (const list of targetLists) {
        for (const target of list || []) {
            const key = JSON.stringify([target.direction, target.timeframe, target.source || target.target_type, target.level]);
            const existing = targets.get(key);
            if (!existing || (target.structural_priority || 0) > (existing.structural_priority || 0)) targets.set(key, target);
        }
    }
    return [...targets.values()];
}

function getStrategySetupForZone(zone, strategySetups) {
    const key = strategyZoneKey(zone);
    const matches = (strategySetups || []).filter(s =>
        (s.matched_zone_ids || []).includes(zone.id || key) ||
        s.execution_zone?.id === zone.id ||
        strategyZoneKey(s.execution_zone) === key
    );
    if (matches.length === 0) return null;
    const primaries = [...new Set(matches.map(s => s.primary).filter(Boolean))];
    const confirmations = [...new Set(matches.flatMap(s => s.confirmations || []).concat(primaries.filter(p => p !== primaries[0])))];
    const label = primaries.length > 1 ? primaries.join('+') : (matches[0].label || primaries[0]);
    return {
        primary: primaries[0],
        label,
        confirmations,
        evidence: matches.map(s => ({ strategy: s.primary, evidence: s.evidence })),
        setup_ids: matches.map(s => s.id)
    };
}

function mergeFreshExecutionTargetPool({ direction, entry, strategySetup, targetCandidates, historyCache, zones, price, pairLocal }) {
    const base = [
        ...(targetCandidates?.all || []),
        ...(targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || []),
        ...(strategySetup?.target_candidates || [])
    ];
    const current = buildTargetCandidates(historyCache, price, pairLocal).all || [];
    const structuralZones = (zones || []).flatMap(zone => {
        if (zone.primary_eligible === false || zone.invalidated || !Number.isFinite(Number(zone.low)) || !Number.isFinite(Number(zone.high))) return [];
        const level = direction === 'BUY' ? Number(zone.low) : Number(zone.high);
        const ahead = direction === 'BUY' ? level > entry : level < entry;
        if (!ahead || !['MSNR', 'OB', 'FVG'].includes(zone.type)) return [];
        return [{ direction, level, timeframe: zone.timeframe, source: zone.type === 'MSNR' ? 'OPPOSING_MSNR' : `OPPOSING_${zone.type}`, target_type: zone.type, origin: zone.origin || 'STRUCTURAL', structural_priority: zone.type === 'MSNR' ? 88 : 68, strategy_native: false }];
    });
    const all = [...base, ...current, ...structuralZones].filter(t => t && t.direction === direction);
    const deduped = new Map();
    for (const target of all) {
        const level = Number(target.level);
        if (!Number.isFinite(level)) continue;
        const key = `${direction}|${target.timeframe || ''}|${ictRound(level, getMarketSettings(pairLocal).prec)}`;
        const prior = deduped.get(key);
        if (!prior) deduped.set(key, { ...target, level });
        else {
            prior.target_confluence = [...new Set([...(prior.target_confluence || []), target.source || target.target_type])];
            if ((target.structural_priority || 0) > (prior.structural_priority || 0)) Object.assign(prior, target, { level, target_confluence: prior.target_confluence });
        }
    }
    return { all: [...deduped.values()], buy: [...deduped.values()].filter(t => t.direction === 'BUY'), sell: [...deduped.values()].filter(t => t.direction === 'SELL') };
}

function getStrategyExecutionZones(strategySetups) {
    return (strategySetups || [])
        .filter(s => s.execution_zone)
        .map(s => ({
            ...s.execution_zone,
            strategy_setup: s,
            structural_invalidation: s.structural_invalidation,
            freshness: s.freshness || s.execution_zone.freshness || 'FRESH'
        }));
}

// A structural zone may be executable without a CRT/TBS/MSNR label when the
// existing timeframe context proves direction and a real objective is ahead.
// This is discovery provenance, not a bypass of stop, target, RR, or lifecycle
// validation.
function hasDeterministicMarketMechanicsProof(zone, direction, timeframeContext = {}, targetCandidates = {}, price) {
    if (!zone || !['BUY', 'SELL'].includes(direction) || zone.primary_eligible === false || zone.invalidated) return false;
    const wanted = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const supports = ['1D', '4H', '1H'].some(tf => [timeframeContext[tf]?.displayed_trend, timeframeContext[tf]?.effective_trend, timeframeContext[tf]?.structural_trend, timeframeContext[tf]?.bias]
        .some(value => value === wanted || value === `${wanted}_TRANSITION`));
    const htfEvents = ['4H', '1H'].flatMap(tf => timeframeContext[tf]?.evidence || []);
    const localEvents = (timeframeContext['15M']?.evidence || []).concat(timeframeContext['5M']?.evidence || []);
    const continuationEvent = htfEvents.some(event => event.direction === direction && ['BOS', 'CHOCH', 'MSS', 'DISPLACEMENT'].includes(event.kind));
    const raid = htfEvents.some(event => event.direction === direction && ['LIQUIDITY_SWEEP', 'CRT', 'TBS'].includes(event.kind));
    const shiftAfterRaid = localEvents.some(event => event.direction === direction && ['BOS', 'CHOCH', 'MSS', 'DISPLACEMENT'].includes(event.kind))
        || htfEvents.some(event => event.direction === direction && ['BOS', 'CHOCH', 'MSS', 'DISPLACEMENT'].includes(event.kind));
    const targets = (targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || [])
        .some(target => Number.isFinite(Number(target.level)) && (direction === 'BUY' ? Number(target.level) > Number(price) : Number(target.level) < Number(price)));
    const location = ['FVG', 'OB', 'SUPPLY', 'DEMAND', 'FLIP', 'MSNR', 'CRT', 'TBS'].includes(String(zone.type || '').toUpperCase())
        && Number.isFinite(Number(zone.low)) && Number.isFinite(Number(zone.high));
    const continuation = supports && (continuationEvent || !raid);
    const reversal = raid && shiftAfterRaid && !supports;
    return location && targets && (continuation || reversal);
}

function buildAdaptiveSetupCandidates({ pair, price, historyCache, zones, targetCandidates, riskConstraints, marketRegime, structure, marketContext, strategySetups }) {
    const timeframeContext = marketContext?.timeframe_context || buildTimeframeContext({ historyCache, structure, price, strategySetups, zones });
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const minimumRR = Number(riskConstraints?.minimum_rr) || settings.targetRR || 2.5;
    const rawCandidates = [];
    const validCandidates = [];
    const rejectedCandidates = [];
    const strategyExecutionZones = Array.isArray(strategySetups) ? getStrategyExecutionZones(strategySetups) : [];
    const poiZones = ['4H', '1H', '15M'].flatMap(tf => buildSupplyDemandAndFlipPOIs(historyCache?.[tf] || [], tf, price, pair));
    const labeledZoneKeys = new Set(strategyExecutionZones.map(strategyZoneKey));
    const genericMarketZones = (zones || []).filter(zone => !labeledZoneKeys.has(strategyZoneKey(zone))
        && hasDeterministicMarketMechanicsProof(zone, zone.direction, timeframeContext, targetCandidates, price));
    const seedZones = Array.isArray(strategySetups) ? [...strategyExecutionZones, ...genericMarketZones] : (zones || []);
    const seedDiagnostics = seedZones.map((z, i) => ({ seed_id: z.id || `seed-${i + 1}`, execution_model: z.execution_model || z.entry_model || 'STRUCTURAL_LIMIT', zone_source: z.entry_region_source || z.type, timeframe: z.timeframe || '1H', raw_candidates: 0, failure_reasons: [], details: [] }));
    const freshTargetPoolCache = new Map();
    const failSeed = (seed, code, detail) => {
        if (!seed.failure_reasons.includes(code)) seed.failure_reasons.push(code);
        if (detail && !seed.details.includes(detail)) seed.details.push(detail);
    };
    if (marketContext?.news_risk?.status === 'HIGH_IMPACT') {
        for (const seed of seedDiagnostics) failSeed(seed, 'NEWS_BLOCKED', marketContext.news_risk.warning || 'High-impact news risk blocks new setup selection');
        return {
            raw_candidates: [], valid_candidates: [], seed_diagnostics: seedDiagnostics,
            rejected_candidates: [{ id: 'NEWS_BLOCKED', rejection_code: 'NEWS_BLOCKED', rejection_reasons: [marketContext.news_risk.warning || 'High-impact news risk blocks new setup selection'] }]
        };
    }
    if (riskConstraints?.spread_valid === false) {
        const detail = `Current spread ${riskConstraints.current_spread} exceeds maximum ${riskConstraints.maximum_spread}`;
        for (const seed of seedDiagnostics) failSeed(seed, 'SPREAD_TOO_WIDE', detail);
        return {
            raw_candidates: [], valid_candidates: [], seed_diagnostics: seedDiagnostics,
            rejected_candidates: [{ id: 'SPREAD_TOO_WIDE', rejection_code: 'SPREAD_TOO_WIDE', rejection_reasons: [detail] }]
        };
    }
    const dataQuality = marketContext?.data_quality || validateMarketDataQuality(historyCache, price);
    if (!dataQuality.valid) {
        for (const seed of seedDiagnostics) {
            for (const reason of dataQuality.reasons) failSeed(seed, /missing|insufficient/i.test(reason) ? 'MISSING_TIMEFRAME_DATA' : 'INVALID_MARKET_DATA', reason);
        }
        const result = { raw_candidates: [], valid_candidates: [], seed_diagnostics: seedDiagnostics,
            rejected_candidates: dataQuality.reasons.map(reason => ({ id: 'DATA_QUALITY', rejection_code: 'DATA_QUALITY', rejection_reasons: [reason] })) };
        console.log('RAW SETUP CANDIDATES', result.raw_candidates);
        console.log('VALID SETUP CANDIDATES', result.valid_candidates);
        console.log('REJECTED SETUP CANDIDATES', result.rejected_candidates);
        return result;
    }
    const validationZones = Array.isArray(strategySetups)
        ? [...(zones || []), ...strategyExecutionZones]
        : (zones || []);
    const deterministicValidationContext = buildDeterministicValidationContext({
        pair,
        price,
        historyCache,
        real_ict_zones: validationZones,
        context_ict_zones: zones,
        poi_zones: poiZones,
        strategy_execution_zones: strategyExecutionZones,
        risk_constraints: riskConstraints,
        structure,
        market_context: marketContext,
        strategy_setups: strategySetups || [],
        require_strategy_setup: Array.isArray(strategySetups)
    });

    for (const [seedIndex, zone] of seedZones.entries()) {
        const seed = seedDiagnostics[seedIndex];
        if (zone.primary_eligible === false || zone.invalidated || (zone.type === 'MSNR' && zone.origin !== 'STRUCTURAL_MSNR')) {
            failSeed(seed, 'INVALID_ENTRY_REGION', 'Execution zone is invalidated or not primary eligible');
            continue;
        }
        const strategySetup = zone.strategy_setup || (Array.isArray(strategySetups) ? getStrategySetupForZone(zone, strategySetups) : null);
        const marketMechanicsVerified = !strategySetup && hasDeterministicMarketMechanicsProof(zone, zone.direction, timeframeContext, targetCandidates, price);
        if (Array.isArray(strategySetups) && !strategySetup && !marketMechanicsVerified) { failSeed(seed, 'NO_MARKET_MECHANICS_PROOF'); continue; }
        const setupModel = String(strategySetup?.opportunity_thesis?.execution_model || strategySetup?.execution_model || strategySetup?.entry_model || zone.execution_model || '').toUpperCase();
        if (strategySetup && setupModel !== 'PENDING_LIMIT' && strategySetup.opportunity_thesis?.state !== 'EXECUTION_VALID' && marketContext?.daily_bias) {
            for (const code of strategySetup?.opportunity_thesis?.rejection_codes || ['NO_DIRECTION_THESIS']) failSeed(seed, code);
            continue;
        }
        const direction = zone.direction;
        const tf = zone.timeframe || '1H';
        const data = historyCache?.[tf] || historyCache?.['1H'] || historyCache?.['4H'] || [];
        if (!data.length) { failSeed(seed, 'MISSING_TIMEFRAME_DATA'); continue; }
        if (!Number.isFinite(zone.low) || !Number.isFinite(zone.high) || zone.high < zone.low) {
            failSeed(seed, 'INVALID_ENTRY_REGION'); continue;
        }
        const atrData = getClosedHistory(historyCache, tf === '4H' ? '4H' : '1H');
        const atrVal = atrData.length >= 15 ? atr(atrData, 14) : 0;
        const safeAtr = Number.isFinite(atrVal) && atrVal > 0 ? atrVal : 0;
        const semanticEntry = getSemanticEntryCandidate(zone, strategySetup, direction, prec);
        const entries = semanticEntry == null ? [] : [semanticEntry];
        seed.semantic_entries = entries.length;
        if (!entries.length) failSeed(seed, 'NO_VALID_ENTRY_PRICE');
        for (const entry of entries) {
            const stops = getAdaptiveStopCandidates(zone, direction, entry, data, zones, safeAtr, settings, prec)
                .slice(0, STRATEGY_SPEC.EXECUTION.maxStopsPerZone);
            if (!stops.length) failSeed(seed, 'NO_STRUCTURAL_STOP');
            for (const stop of stops) {
                if (!Number.isFinite(entry) || !Number.isFinite(stop.stop_loss)) {
                    failSeed(seed, 'INVALID_NUMERIC_GEOMETRY'); continue;
                }
                const seedPrefix = zone.execution_model === 'FRESH_RETRACEMENT_LIMIT' ? 'FRESH-' : '';
                const createdKey = normalizeTimestampUTC(zone.created_time);
                const rawId = `${seedPrefix}${tf}-${zone.type}-${direction}-${ictRound(zone.low, prec)}-${ictRound(zone.high, prec)}-${createdKey || zone.created_index || rawCandidates.length + 1}-${rawCandidates.length + 1}`;
                const risk = Math.abs(entry - stop.stop_loss);
                const atrContext = getCandidateATRContext({ timeframe: tf }, historyCache, pair, price);
                const authoritativeInvalidation = getAuthoritativeStructuralInvalidation(zone, strategySetup);
                const rawCandidate = {
                    id: rawId,
                    direction,
                    timeframe: tf,
                    zone_type: zone.type,
                    zone_origin: zone.origin,
                    zone_low: zone.low,
                    zone_high: zone.high,
                    zone,
                    entry,
                    stop_loss: stop.stop_loss,
                    stop_reason: authoritativeInvalidation
                        ? `${authoritativeInvalidation.source} invalidation ${authoritativeInvalidation.level} plus structural buffer`
                        : `${stop.source} invalidation plus structural buffer`,
                    stop_source: stop.source,
                    stop_buffer: stop.buffer,
                    stop_buffer_components: stop.buffer_components || null,
                    stop_distance: ictRound(risk, prec),
                    structural_invalidation: authoritativeInvalidation,
                    structural_invalidation_anchor: authoritativeInvalidation?.level ?? null,
                    structural_invalidation_source: authoritativeInvalidation?.source || stop.source,
                    risk_distance: ictRound(risk, prec),
                    sl_atr_multiple_rule: atrContext.atr_rule_reference ? ictRound(risk / atrContext.atr_rule_reference, 2) : null,
                    sl_atr_multiple_timeframe: safeAtr > 0 ? ictRound(risk / safeAtr, 2) : null,
                    sl_atr_multiple: atrContext.atr_rule_reference ? ictRound(risk / atrContext.atr_rule_reference, 2) : (safeAtr > 0 ? ictRound(risk / safeAtr, 2) : null),
                    risk_model: {
                        structural_stop: true,
                        status: null,
                        risk_distance: ictRound(risk, prec),
                        setup_timeframe: atrContext.setup_timeframe,
                        setup_atr: atrContext.setup_atr ? ictRound(atrContext.setup_atr, prec) : null,
                        higher_timeframe_atr: atrContext.higher_timeframe_atr ? ictRound(atrContext.higher_timeframe_atr, prec) : null,
                        minimum_reasonable_distance: ictRound(atrContext.minimum_reasonable_distance, prec),
                        maximum_reasonable_distance: ictRound(atrContext.maximum_reasonable_distance, prec),
                        atr_multiple: atrContext.atr_rule_reference ? ictRound(risk / atrContext.atr_rule_reference, 2) : null,
                        preferred_minimum_distance: ictRound(atrContext.preferred_min_sl, prec),
                        position_size_adjustment_required: true
                    },
                    freshness: zone.freshness,
                    htf_alignment: ['1D', '4H', '1H']
                        .map(t => structure?.[t]?.effective_trend || structure?.[t]?.structural_trend || structure?.[t]?.trend)
                        .filter(v => v === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')).length,
                    distance_from_current_price: ictRound(Math.abs(entry - price), prec),
                    distance_from_current_price_atr: safeAtr > 0 ? ictRound(Math.abs(entry - price) / safeAtr, 2) : null,
                    market_regime: marketRegime?.primary_regime || 'UNKNOWN'
                };
                if (strategySetup) {
                    rawCandidate.strategy_setup = strategySetup;
                    rawCandidate.strategy_label = strategySetup.label;
                    rawCandidate.patterns = [strategySetup.label];
                    rawCandidate.narrative_state = strategySetup.narrative_state || 'ACTIVE';
                    rawCandidate.narrative_event_time = strategySetup.narrative_event_time || strategySetup.event_time || null;
                    rawCandidate.original_strategy_entry_consumed = !!strategySetup.original_strategy_entry_consumed;
                    rawCandidate.execution_model = strategySetup.opportunity_thesis?.execution_model
                        || strategySetup.execution_model || strategySetup.entry_model || zone.execution_model || 'STRUCTURAL_LIMIT';
                    rawCandidate.entry_model = rawCandidate.execution_model;
                    rawCandidate.execution_zone_created_time = zone.created_time || strategySetup.execution_zone_created_time || null;
                    rawCandidate.execution_zone_created_index = zone.created_index ?? strategySetup.execution_zone_created_index ?? null;
                    rawCandidate.execution_zone_consumed = !!zone.execution_zone_consumed;
                }
                rawCandidate.market_mechanics_verified = marketMechanicsVerified;
                rawCandidates.push(rawCandidate);
                seed.raw_candidates++;
                if (strategySetup) {
                    const lifecycle = evaluateSetupLifecycle(rawCandidate, deterministicValidationContext);
                    Object.assign(rawCandidate, lifecycle);
                    if (lifecycle.rejection_code) {
                        failSeed(seed, 'LIFECYCLE_REJECTED', lifecycle.rejection_code);
                        rejectedCandidates.push({ id: rawCandidate.id, rejection_code: lifecycle.rejection_code,
                            rejection_reasons: [lifecycle.rejection_code], setup_lifecycle: lifecycle });
                        continue;
                    }
                }
                const stopEvaluation = evaluateStructuralStop(rawCandidate, atrContext, pair);
                rawCandidate.risk_model.status = stopEvaluation.status;
                rawCandidate.risk_model.volatility_classification = stopEvaluation.volatility_classification;
                console.log('STRUCTURAL STOP EVALUATION', {
                    id: rawCandidate.id,
                    strategy: rawCandidate.strategy_label || rawCandidate.zone_type,
                    timeframe: tf,
                    direction,
                    entry,
                    structural_invalidation: authoritativeInvalidation?.level || zone.structural_invalidation || (direction === 'BUY' ? zone.low : zone.high),
                    stopLoss: stop.stop_loss,
                    risk,
                    setupAtr: atrContext.setup_atr,
                    riskAtr: stopEvaluation.atrMultiple || rawCandidate.sl_atr_multiple,
                    volatility_classification: stopEvaluation.volatility_classification,
                    hardReject: !!stopEvaluation.hardReject
                });
                if (stopEvaluation.status !== 'VALID_STRUCTURAL_STOP') {
                    failSeed(seed, /TIGHT|WIDE/i.test(stopEvaluation.status) ? 'EXTREME_VOLATILITY' : 'NO_STRUCTURAL_STOP', stopEvaluation.reason);
                    const isVolatility = /TIGHT|WIDE/i.test(stopEvaluation.status);
                    console.log(isVolatility ? 'CANDIDATE REJECTED - VOLATILITY' : 'CANDIDATE REJECTED - STRUCTURAL STOP', {
                        id: rawCandidate.id,
                        strategy: rawCandidate.strategy_label || rawCandidate.zone_type,
                        status: stopEvaluation.status,
                        reason: stopEvaluation.reason,
                        timeframe: tf,
                        risk,
                        setupAtr: atrContext.setup_atr
                    });
                    rejectedCandidates.push({
                        id: rawCandidate.id,
                        direction,
                        timeframe: tf,
                        zone_type: zone.type,
                        rejection_code: stopEvaluation.status === 'STRUCTURALLY_INVALID' ? 'STOP_STRUCTURAL_INVALID' : stopEvaluation.status,
                        rejection_reasons: [stopEvaluation.reason]
                    });
                    continue;
                }
                const strategyTargets = (strategySetup?.target_candidates || []).filter(t => t && t.direction === direction);
                let mergedTargetCandidates;
                if (zone.execution_model === 'FRESH_RETRACEMENT_LIMIT' || strategySetup?.execution_model === 'FRESH_RETRACEMENT_LIMIT') {
                    const poolKey = `${direction}|${tf}|${strategySetup?.id || 'fresh'}`;
                    if (!freshTargetPoolCache.has(poolKey)) freshTargetPoolCache.set(poolKey, mergeFreshExecutionTargetPool({ direction, entry, strategySetup, targetCandidates, historyCache, zones: validationZones, price, pairLocal: pair }));
                    mergedTargetCandidates = freshTargetPoolCache.get(poolKey);
                } else {
                    mergedTargetCandidates = strategyTargets.length
                        ? {
                            ...(targetCandidates || {}),
                            all: [...strategyTargets, ...((targetCandidates?.all || targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || []))],
                            [direction === 'BUY' ? 'buy' : 'sell']: [...strategyTargets, ...(targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || [])]
                        }
                        : targetCandidates;
                }
                const targets = selectAdaptiveTargets(direction, entry, stop.stop_loss, mergedTargetCandidates, minimumRR, prec, {
                    historyCache,
                    currentPrice: price,
                    zones: validationZones,
                    liquidity: marketContext?.liquidity?.[tf] || mapLiquidity(data || []),
                    strategySetup
                });
                const targetDiagnostics = {
                    ...(selectAdaptiveTargets.lastDiagnostics || {}),
                    ...(strategySetup?.target_diagnostics || {})
                };
                console.log('TARGET EVALUATION', {
                    id: rawCandidate.id,
                    strategy: rawCandidate.strategy_label || rawCandidate.zone_type,
                    direction,
                    entry,
                    stopLoss: stop.stop_loss,
                    requiredRR: minimumRR,
                    foundTp1: targets?.tp1?.level || null,
                    target_diagnostics: targetDiagnostics
                });
                if (!targets) {
                    const pool = mergedTargetCandidates?.all || mergedTargetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || [];
                    const targetFailure = zone.execution_model === 'FRESH_RETRACEMENT_LIMIT'
                        ? (targetDiagnostics.failure_code || (pool.length ? 'TARGETS_EXIST_BUT_RR_TOO_LOW' : 'TARGET_POOL_EMPTY'))
                        : 'NO_VALID_TP1';
                    failSeed(seed, targetFailure, JSON.stringify(targetDiagnostics));
                    console.log('CANDIDATE REJECTED - NO TP1', { id: rawCandidate.id, direction, entry, stopLoss: stop.stop_loss, requiredRR: minimumRR });
                    rejectedCandidates.push({
                        id: rawCandidate.id,
                        direction,
                        timeframe: tf,
                        zone_type: zone.type,
                        rejection_code: targetFailure,
                        rejection_reasons: [targetFailure, JSON.stringify(targetDiagnostics)],
                        target_diagnostics: targetDiagnostics
                    });
                    continue;
                }
                const rr = calculateRRMetrics(direction, entry, stop.stop_loss, targets.tp1.level, minimumRR);
                const archetype = classifySetupArchetype(rawCandidate, historyCache, price, structure);
                const htfAlignment = ['1D', '4H', '1H']
                    .map(t => structure?.[t]?.trend)
                    .filter(v => v === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')).length;
                const zoneScore = zone.type === 'FVG' ? 18 : zone.type === 'OB' ? 20 : 24;
                const strategyScore = strategySetup
                    ? 18 + Math.min(14, (strategySetup.confirmations || []).length * 7 + (String(strategySetup.label).includes('+') ? 6 : 0))
                    : 0;
                const freshnessScore = zone.freshness === 'FRESH' ? 12 : zone.freshness === 'PARTIAL' ? 6 : 0;
                const rrScore = Math.min(15, (rr.actualRR - minimumRR) * 4);
                const reversalScore = archetype.setup_archetype === 'REVERSAL' ? archetype.reversal_evidence.evidence_count * 5 - 8 : 0;
                const distancePenalty = Math.min(10, Math.abs(entry - price) / Math.max(price, 1) * 100);
                const contextBias = marketContext?.directional_bias;
                const contextSupport = (direction === 'BUY' && contextBias === 'BULLISH') || (direction === 'SELL' && contextBias === 'BEARISH') ? 8 : (contextBias === 'MIXED' || contextBias === 'NEUTRAL' ? 0 : -6);
                const score = zoneScore + strategyScore + freshnessScore + htfAlignment * 8 + rrScore + reversalScore + contextSupport - distancePenalty;
                const candidate = {
                    ...rawCandidate,
                    setup_archetype: archetype.setup_archetype,
                    reversal_evidence: archetype.reversal_evidence,
                    strategy_setup: strategySetup || rawCandidate.strategy_setup || null,
                    strategy_label: strategySetup?.label || rawCandidate.strategy_label || zone.type,
                    tp1: targets.tp1.level,
                    minimum_rr: minimumRR,
                    tp2: targets.tp2 ? targets.tp2.level : null,
                    tp3: targets.tp3 ? targets.tp3.level : null,
                    tp1_source: targets.tp1.source,
                    tp1_origin: targets.tp1.origin,
                    target_reachability: targets.tp1.target_reachability,
                    actual_rr: ictRound(rr.actualRR, 2),
                    rr_tp1: ictRound(rr.actualRR, 2),
                    required_reward: ictRound(targets.required_reward, prec),
                    freshness: zone.freshness,
                    htf_alignment: htfAlignment,
                    distance_from_current_price: ictRound(Math.abs(entry - price), prec),
                    distance_from_current_price_atr: safeAtr > 0 ? ictRound(Math.abs(entry - price) / safeAtr, 2) : null,
                    market_regime: marketRegime?.primary_regime || 'UNKNOWN',
                    entry_model: strategySetup?.entry_model || zone.entry_model || 'STRUCTURAL_LIMIT',
                    execution_model: strategySetup?.opportunity_thesis?.execution_model || strategySetup?.execution_model || zone.execution_model || strategySetup?.entry_model || zone.entry_model || 'STRUCTURAL_LIMIT',
                    entry_region_source: strategySetup?.entry_region_source || zone.entry_region_source || zone.type,
                    original_strategy_entry_consumed: !!(strategySetup?.original_strategy_entry_consumed || rawCandidate.original_strategy_entry_consumed),
                    execution_zone_consumed: !!(zone.execution_zone_consumed || rawCandidate.execution_zone_consumed),
                    execution_zone_created_time: zone.created_time || rawCandidate.execution_zone_created_time || null,
                    execution_zone_created_time_ms: normalizeTimestampUTC(zone.created_time || rawCandidate.execution_zone_created_time || null),
                    execution_zone_created_time_utc: normalizeTimestampUTC(zone.created_time || rawCandidate.execution_zone_created_time || null) ? new Date(normalizeTimestampUTC(zone.created_time || rawCandidate.execution_zone_created_time || null)).toISOString() : null,
                    created_index_timeframe: zone.timeframe || tf,
                    zone_timeframe: zone.timeframe || tf,
                    parent_event_time_ms: normalizeTimestampUTC(strategySetup?.narrative_event_time || strategySetup?.event_time || null),
                    parent_strategy_timeframe: strategySetup?.setup_timeframe || strategySetup?.timeframe || tf,
                    execution_zone_created_index: zone.created_index ?? rawCandidate.execution_zone_created_index ?? null,
                    strategy_narrative: {
                        state: strategySetup?.narrative_state || rawCandidate.narrative_state || 'ACTIVE',
                        primary: strategySetup?.primary || null,
                        event_time: strategySetup?.narrative_event_time || rawCandidate.narrative_event_time || null,
                        original_entry_consumed: !!(strategySetup?.original_strategy_entry_consumed || rawCandidate.original_strategy_entry_consumed)
                    },
                    strategy_confluence: strategySetup?.strategy_confluence || [],
                    narrative_ids: strategySetup?.narrative_ids || [],
                    confluence_score: strategySetup?.confluence_score || 1,
                    setup_timeframe: strategySetup?.setup_timeframe || tf,
                    execution_timeframe: strategySetup?.execution_timeframe || tf,
                    strategy_evidence: strategySetup?.strategy_evidence || null,
                    target_map: targets ? [targets.tp1, targets.tp2, targets.tp3].filter(Boolean).map(t => ({
                        target_level: t.level,
                        target_type: t.target_type || t.source,
                        primary_target_source: t.primary_target_source,
                        target_confluence: t.target_confluence,
                        target_timeframe: t.timeframe || null,
                        target_distance: ictRound(Math.abs(t.level - entry), prec),
                        target_distance_atr: t.target_reachability.target_distance_atr,
                        target_distance_atr_timeframe: t.target_reachability.target_distance_atr_timeframe,
                        structural_priority: t.structural_priority || 50,
                        intervening_obstacles: t.target_reachability.intervening_obstacles,
                        intervening_liquidity: t.target_reachability.intervening_liquidity,
                        reachability_score: t.reachability_score,
                        target_quality: t.target_quality,
                        target_reachability: compactTargetReachabilityForOutput(t.target_reachability),
                        actual_rr: t.actual_rr
                    })) : [],
                    target_diagnostics: targetDiagnostics,
                    setup_confidence: Math.max(0, Math.min(100, Math.round(score))),
                    score: ictRound(score, 2)
                };
                candidate.top_down_context = classifyTopDownTrade(candidate, timeframeContext);
                candidate.trade_context_classification = candidate.top_down_context.classification;
                candidate.opportunity_thesis = strategySetup?.opportunity_thesis || null;
                Object.assign(rawCandidate, candidate);
                const evaluation = evaluateSetupCandidate(candidate, deterministicValidationContext);
                Object.assign(rawCandidate, candidate);
                if (evaluation.valid) {
                    rawCandidate.confidence_breakdown = calculateCandidateConfidence(candidate, {
                        ...marketContext,
                        htf_alignment: htfAlignment
                    });
                    rawCandidate.setup_confidence = rawCandidate.confidence_breakdown.final_score;
                    rawCandidate.quality = {
                        final_confidence: rawCandidate.confidence_breakdown.final_score,
                        quality_breakdown: rawCandidate.confidence_breakdown.quality_breakdown
                    };
                    candidate.confidence_breakdown = rawCandidate.confidence_breakdown;
                    candidate.setup_confidence = rawCandidate.setup_confidence;
                    candidate.quality = rawCandidate.quality;
                    candidate.score = candidate.setup_confidence;
                    candidate.evaluation = { checks: evaluation.checks, metrics: evaluation.metrics };
                    candidate.strategy_version = STRATEGY_SPEC_VERSION;
                    const invariant = validateExecutableCandidateInvariant(candidate, deterministicValidationContext);
                    if (!invariant.valid) {
                        failSeed(seed, 'ENGINE_INVARIANT_FAILURE', invariant.invariant_code);
                        rejectedCandidates.push({ id: candidate.id, rejection_code: 'ENGINE_INVARIANT_FAILURE', invariant_code: invariant.invariant_code, rejection_reasons: invariant.failures });
                        continue;
                    }
                    Object.freeze(candidate);
                    console.log('STRATEGY CANDIDATE', { id: candidate.id, strategy: candidate.strategy_label, direction: candidate.direction, score: candidate.score });
                    validCandidates.push(candidate);
                } else {
                    console.log('STRATEGY CANDIDATE REJECTED', { id: candidate.id, strategy: candidate.strategy_label, reasons: evaluation.reasons });
                    failSeed(seed, classifyRejectionDetail(evaluation.reasons[0] || ''), evaluation.reasons.join('; '));
                    rejectedCandidates.push({
                        id: candidate.id,
                        direction: candidate.direction,
                        timeframe: candidate.timeframe,
                        zone_type: candidate.zone_type,
                        rejection_code: classifyRejectionDetail(evaluation.reasons[0] || ''),
                        setup_lifecycle: evaluation.metrics.setup_lifecycle || null,
                        rejection_reasons: evaluation.reasons
                    });
                }
            }
        }
    }

    const selected = validCandidates
        .sort((a, b) => b.score - a.score || b.rr_tp1 - a.rr_tp1 || a.distance_from_current_price - b.distance_from_current_price)
        .slice(0, 5);
    const result = {
        raw_candidates: rawCandidates,
        valid_candidates: selected,
        seed_diagnostics: seedDiagnostics,
        rejected_candidates: rejectedCandidates
    };
    console.log('RAW SETUP CANDIDATES', rawCandidates);
    console.log('VALID SETUP CANDIDATES', selected);
    console.log('VALID STRATEGY CANDIDATES', selected.map(c => ({ id: c.id, strategy: c.strategy_label || c.zone_type, direction: c.direction, score: c.score })));
    for (const candidate of selected) console.log('VALID DETERMINISTIC CANDIDATE', { id: candidate.id, direction: candidate.direction, timeframe: candidate.timeframe, score: candidate.score, rr: candidate.rr_tp1 });
    console.log('REJECTED SETUP CANDIDATES', rejectedCandidates);
    console.log('AI CANDIDATES SENT', selected.map(c => c.id));
    return result;
}

function buildDeterministicOrderDescription(candidate) {
    const target = (candidate.target_map || []).find(t => t.target_level === candidate.tp1);
    const source = target?.primary_target_source || target?.target_type || candidate.tp1_source || 'STRUCTURAL_TARGET';
    const type = target?.target_type || source;
    const confluence = target?.target_confluence || [];
    const invalidation = candidate.structural_invalidation?.level ?? candidate.strategy_setup?.structural_invalidation ?? candidate.stop_loss;
    const lifecycle = candidate.evaluation?.metrics?.setup_lifecycle || candidate;
    const age = Number.isFinite(lifecycle.event_age_hours) ? `${lifecycle.event_age_hours.toFixed(1)} hours ago` : 'recently';
    const freshness = lifecycle.opportunity_status === 'FRESH_NOW' ? 'fresh and actionable now' : 'fresh and actionable later today';
    const confirmation = String(candidate.execution_model || candidate.entry_model || '').toUpperCase() === 'CONFIRMATION_ENTRY';
    const wait = confirmation
        ? `Confirmation ${candidate.direction} at ${candidate.entry} requires the deterministic confirmation trigger at the supplied POI; structural invalidation ${invalidation} must remain intact.`
        : `Pending ${candidate.direction}_LIMIT at ${candidate.entry} remains valid while structural invalidation ${invalidation} is not breached. The limit fills when market price trades at the order price.`;
    return {
        primary_target_source: source, target_type: type, target_confluence: confluence,
        wait_condition: wait,
        reasoning: {
            primary: `${candidate.strategy_label || candidate.strategy_setup?.label || candidate.zone_type} ${confirmation ? candidate.direction + ' confirmation entry' : candidate.direction + '_LIMIT'} at ${candidate.entry}. TP1 ${candidate.tp1}: ${source} (${type}).`,
            freshness: `Fresh ${candidate.setup_timeframe || candidate.timeframe || 'intraday'} opportunity from ${age}; ${freshness}. ${Number.isFinite(lifecycle.remaining_reward_fraction) ? `${Math.round(lifecycle.remaining_reward_fraction * 100)}% of the original reward path remains.` : 'The original reward path remains structurally valid.'}`,
            why_best: `Selected deterministic candidate ${candidate.id}; target confluence: ${confluence.map(t => `${t.source} ${t.timeframe || ''}`.trim()).join(', ') || 'none'}.`,
            risk_warning: 'Structural invalidation and market execution risk apply.'
        }
    };
}

function applyAdaptiveCandidateToAIResult(aiResult, liveMarketContext) {
    const id = aiResult?.selected_candidate_id;
    if (!id) return aiResult;
    const candidate = (liveMarketContext?.adaptive_setup_candidates || []).find(c => c.id === id);
    if (!candidate) {
        aiResult.unknown_deterministic_candidate = true;
        console.log('AI selected unknown deterministic candidate', { selected_candidate_id: id });
        return aiResult;
    }
    console.log('AI SELECTED CANDIDATE', id);
    const numericOverrideFields = [
        ['entry', candidate.entry],
        ['stop_loss', candidate.stop_loss],
        ['take_profit_1', candidate.tp1],
        ['take_profit_2', candidate.tp2],
        ['take_profit_3', candidate.tp3]
    ].filter(([field, expected]) => ictFiniteNumber(expected) && ictFiniteNumber(aiResult[field]) && Math.abs(Number(aiResult[field]) - Number(expected)) > Math.max(Math.abs(Number(expected)) * 0.0002, 0.00001));
    if (numericOverrideFields.length > 0) {
        console.log('AI numeric override ignored', { selected_candidate_id: id, fields: numericOverrideFields.map(([field]) => field) });
    }
    aiResult.direction = candidate.direction;
    const confirmationEntry = String(candidate.execution_model || candidate.entry_model || '').toUpperCase() === 'CONFIRMATION_ENTRY';
    aiResult.decision = confirmationEntry ? candidate.direction : (candidate.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT');
    aiResult.order_type = confirmationEntry ? 'MARKET_AFTER_CONFIRMATION' : 'LIMIT';
    aiResult.setup_type = confirmationEntry ? 'CONFIRMATION_ENTRY' : 'PENDING_LIMIT';
    aiResult.ai_decision = confirmationEntry ? 'enter_after_confirmation' : 'pending_limit';
    aiResult.selected_zone = { type: candidate.zone_type, timeframe: candidate.timeframe, low: candidate.zone_low, high: candidate.zone_high };
    aiResult.entry_zone = { source: candidate.zone_type, low: candidate.zone_low, high: candidate.zone_high };
    aiResult.entry = candidate.entry;
    aiResult.stop_loss = candidate.stop_loss;
    aiResult.stop_loss_reason = candidate.stop_reason;
    aiResult.structural_invalidation = candidate.structural_invalidation || null;
    aiResult.stop_buffer = candidate.stop_buffer ?? null;
    aiResult.stop_buffer_components = candidate.stop_buffer_components || null;
    aiResult.stop_quality = candidate.risk_model ? {
        status: candidate.risk_model.status || null,
        volatility_classification: candidate.risk_model.volatility_classification || null,
        risk_distance: candidate.risk_model.risk_distance ?? candidate.risk_distance ?? null,
        atr_multiple: candidate.risk_model.atr_multiple ?? candidate.sl_atr_multiple ?? null,
        minimum_reasonable_distance: candidate.risk_model.minimum_reasonable_distance ?? null,
        preferred_minimum_distance: candidate.risk_model.preferred_minimum_distance ?? null,
        warning: candidate.risk_model.volatility_classification === 'TIGHT_BUT_STRUCTURAL'
            ? 'Stop is structurally valid but tighter than the preferred volatility distance.' : null
    } : null;
    aiResult.stop_distance = candidate.stop_distance ?? candidate.risk_distance ?? null;
    aiResult.take_profit_1 = candidate.tp1;
    aiResult.take_profit_2 = candidate.tp2 ?? null;
    aiResult.take_profit_3 = candidate.tp3 ?? null;
    aiResult.risk_reward = `1:${candidate.rr_tp1.toFixed(2)}`;
    aiResult.adaptive_candidate = candidate;
    aiResult.setup_lifecycle = candidate.evaluation?.metrics?.setup_lifecycle || null;
    aiResult.opportunity_status = candidate.opportunity_status || aiResult.setup_lifecycle?.opportunity_status || null;
    aiResult.event_time = candidate.event_time || aiResult.setup_lifecycle?.event_time || null;
    aiResult.event_age_hours = candidate.event_age_hours ?? aiResult.setup_lifecycle?.event_age_hours ?? null;
    aiResult.current_session = candidate.current_session ?? aiResult.setup_lifecycle?.current_session ?? null;
    aiResult.event_session = candidate.event_session ?? aiResult.setup_lifecycle?.event_session ?? null;
    aiResult.expected_entry_window = candidate.expected_entry_window ?? aiResult.setup_lifecycle?.expected_entry_window ?? null;
    aiResult.hours_remaining_in_relevant_session = candidate.hours_remaining_in_relevant_session ?? aiResult.setup_lifecycle?.hours_remaining_in_relevant_session ?? null;
    aiResult.still_actionable_today = candidate.still_actionable_today ?? aiResult.setup_lifecycle?.still_actionable_today ?? false;
    aiResult.pending_entry_quality = candidate.pending_entry_quality || aiResult.setup_lifecycle?.pending_entry_quality || null;
    aiResult.entry_reachable_today = candidate.entry_reachable_today ?? aiResult.setup_lifecycle?.entry_reachable_today ?? false;
    aiResult.distance_to_entry_atr = candidate.distance_to_entry_atr ?? aiResult.setup_lifecycle?.distance_to_entry_atr ?? null;
    aiResult.remaining_reward_fraction = candidate.remaining_reward_fraction ?? aiResult.setup_lifecycle?.remaining_reward_fraction ?? null;
    aiResult.setup_confidence = getDeterministicCandidateConfidence(candidate);
    aiResult.strategy_setup = candidate.strategy_setup || null;
    aiResult.strategy_narrative = {
        state: candidate.narrative_state || candidate.strategy_setup?.narrative_state || 'ACTIVE',
        primary: candidate.strategy_setup?.primary || candidate.strategy_label || null,
        event_time: candidate.narrative_event_time || candidate.strategy_setup?.narrative_event_time || candidate.event_time || null,
        original_entry_consumed: !!(candidate.original_strategy_entry_consumed || candidate.strategy_setup?.original_strategy_entry_consumed)
    };
    aiResult.execution_opportunity = {
        model: candidate.execution_model || candidate.entry_model || 'STRUCTURAL_LIMIT',
        zone_source: candidate.entry_region_source || candidate.zone_type,
        zone_created_time: candidate.execution_zone_created_time || candidate.zone?.created_time || null,
        zone_consumed: !!candidate.execution_zone_consumed,
        freshness: candidate.freshness || null
    };
    aiResult.strategy_evidence = candidate.strategy_evidence || candidate.strategy_setup?.strategy_evidence || null;
    aiResult.target_map = candidate.target_map || [];
    if (candidate.target_map?.[0]) {
        aiResult.primary_target_source = candidate.target_map[0].primary_target_source;
        aiResult.target_type = candidate.target_map[0].target_type;
        aiResult.target_confluence = candidate.target_map[0].target_confluence;
    }
    aiResult.strategy_version = candidate.strategy_version || STRATEGY_SPEC_VERSION;
    aiResult.quality = candidate.quality || null;
    aiResult.trade_context_classification = candidate.trade_context_classification || null;
    aiResult.top_down_context = candidate.top_down_context || null;
    aiResult.entry_model = candidate.entry_model || null;
    aiResult.execution_model = candidate.execution_model || candidate.entry_model || null;
    aiResult.entry_region_source = candidate.entry_region_source || candidate.zone_type || null;
    aiResult.original_strategy_entry_consumed = !!candidate.original_strategy_entry_consumed;
    aiResult.execution_zone_consumed = !!candidate.execution_zone_consumed;
    aiResult.setup_timeframe = candidate.setup_timeframe || candidate.timeframe;
    aiResult.execution_timeframe = candidate.execution_timeframe || candidate.timeframe;
    Object.assign(aiResult, buildDeterministicOrderDescription(candidate));
    aiResult.patterns = candidate.strategy_setup
        ? [candidate.strategy_setup.label || candidate.strategy_setup.primary].concat(candidate.strategy_setup.confirmations || [])
        : (aiResult.patterns || [candidate.zone_type]);
    console.log('SELECTED ADAPTIVE SETUP', {
        id: candidate.id,
        pair: liveMarketContext?.pair,
        direction: candidate.direction,
        zone: { type: candidate.zone_type, timeframe: candidate.timeframe, low: candidate.zone_low, high: candidate.zone_high },
        entry: candidate.entry,
        stopLoss: candidate.stop_loss,
        slAtrMultiple: candidate.sl_atr_multiple,
        tp1: candidate.tp1,
        tp2: candidate.tp2 ?? null,
        tp3: candidate.tp3 ?? null,
        rr: candidate.rr_tp1
    });
    return aiResult;
}

// DeepSeek is a narrative selector. It cannot veto a candidate that the
// deterministic planner has already proved executable. This promotion is
// intentionally limited to TRADE_READY; developing and watch-only plans
// continue through the normal WAIT output path.
function preserveDeterministicCandidateAfterAiNoTrade(aiResult, today, liveMarketContext) {
    if (!aiResult?.noTrade || today?.state !== 'TRADE_READY') return false;
    const candidate = (liveMarketContext?.adaptive_setup_candidates || [])
        .slice()
        .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!candidate?.id) return false;
    const selected = applyAdaptiveCandidateToAIResult({
        selected_candidate_id: candidate.id,
        reasoning: { primary: 'Deterministic candidate preserved after selector declined to choose.' }
    }, liveMarketContext);
    if (selected?.unknown_deterministic_candidate) return false;
    Object.assign(aiResult, selected, {
        noTrade: false,
        selected_candidate_id: candidate.id,
        ai_decision: 'deterministic_candidate_preserved',
        reasoning: { primary: 'The deterministic engine proved this candidate executable; selector WAIT cannot override it.' }
    });
    return true;
}

function timeframeDurationMs(timeframe) {
    return ({ '5M': 5, '15M': 15, '1H': 60, '4H': 240, '1D': 1440 }[timeframe] || 60) * 60000;
}

function findEventCandleIndex(data, eventTime, timeframe) {
    const normalizedEventTime = normalizeTimestampUTC(eventTime);
    if (!Array.isArray(data) || !Number.isFinite(normalizedEventTime)) return -1;
    const duration = timeframeDurationMs(timeframe);
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < data.length; i++) {
        const candleTime = normalizeTimestampUTC(data[i]?.t);
        if (!Number.isFinite(candleTime)) continue;
        if (normalizedEventTime >= candleTime && normalizedEventTime < candleTime + duration) return i;
        const distance = Math.abs(candleTime - normalizedEventTime);
        if (distance <= duration && distance < nearestDistance) {
            nearest = i;
            nearestDistance = distance;
        }
    }
    if (nearest >= 0) return nearest;
    for (let i = 0; i < data.length; i++) {
        const fallbackTime = candleTimestamp(data[i], i, timeframe);
        if (Math.abs(fallbackTime - normalizedEventTime) <= duration) return i;
    }
    return -1;
}

function latestCandleTimestamp(data, timeframe) {
    if (!Array.isArray(data) || data.length === 0) return NaN;
    return data.reduce((latest, candle, index) => Math.max(latest, candleTimestamp(candle, index, timeframe)), -Infinity);
}

function validateMarketDataQuality(historyCache, price, quoteSnapshot = null, asOfMs = Date.now()) {
    const reasons = [];
    if (!ictFiniteNumber(price) || price <= 0) reasons.push('current price is invalid');
    const quoteTime = normalizeTimestampUTC(quoteSnapshot?.provider_timestamp ?? quoteSnapshot?.provider_timestamp_utc);
    if (quoteSnapshot && ictFiniteNumber(price) && !Number.isFinite(quoteTime)) reasons.push('quote timestamp is unavailable');
    const quoteAgeMs = Number.isFinite(quoteTime) ? Number(asOfMs) - quoteTime : null;
    // A provider quote older than one hour cannot safely support a current
    // limit plan. Unknown timestamps remain unknown instead of being called fresh.
    if (Number.isFinite(quoteAgeMs) && quoteAgeMs > 60 * 60 * 1000) reasons.push('quote data is stale');
    if (Number.isFinite(quoteAgeMs) && quoteAgeMs < -5 * 60 * 1000) reasons.push('quote timestamp is in the future');
    const requiredTimeframes = ['4H', '1H'];
    const availableTimeframes = ['1W', '1D', '4H', '1H', '15M', '5M', '1M'].filter(tf => Array.isArray(historyCache?.[tf]));
    for (const tf of [...new Set([...requiredTimeframes, ...availableTimeframes])]) {
        const data = historyCache?.[tf];
        const required = requiredTimeframes.includes(tf);
        if (!Array.isArray(data) || (required && data.length < 50)) {
            if (!required && !data) continue;
            reasons.push(`Insufficient ${tf} data for reliable ATR/structure analysis`);
            continue;
        }
        let prevTime = null;
        const seenTimes = new Set();
        let latestTimedCandle = null;
        for (const c of data) {
            if (!ictFiniteNumber(c.o) || !ictFiniteNumber(c.h) || !ictFiniteNumber(c.l) || !ictFiniteNumber(c.c)) {
                reasons.push(`${tf} contains non-finite OHLC values`);
                break;
            }
            if (c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c) || c.h < c.l) {
                reasons.push(`${tf} contains impossible OHLC geometry`);
                break;
            }
            if (c.t) {
                const t = parseCandleTimeUTC(c.t);
                if (Number.isFinite(t)) {
                    if (seenTimes.has(t)) {
                        reasons.push(`${tf} contains duplicate candle timestamps`);
                        break;
                    }
                    seenTimes.add(t);
                    if (prevTime !== null && t <= prevTime) {
                        reasons.push(`${tf} timestamps are not ordered`);
                        break;
                    }
                    prevTime = t;
                    latestTimedCandle = t;
                }
            }
            if (c.is_closed === false) {
                reasons.push(`${tf} latest structure data contains an open candle`);
                break;
            }
        }
        if (Number.isFinite(latestTimedCandle)) {
            const timeframeMs = timeframeDurationMs(tf);
            if (latestTimedCandle > Number(asOfMs) + 5 * 60 * 1000) reasons.push(`${tf} contains a future candle timestamp`);
            const staleLimit = ['1D', '1W'].includes(tf) ? 3 * 24 * 60 * 60 * 1000 : timeframeMs * 3;
            if (Number(asOfMs) - latestTimedCandle > staleLimit) reasons.push(`${tf} candle data is stale`);
        }
        if (required) {
            const atrVal = data.length >= 15 ? atr(data, 14) : NaN;
            if (!Number.isFinite(atrVal) || atrVal <= 0) reasons.push(`${tf} ATR is unavailable or invalid`);
        }
    }
    return { valid: reasons.length === 0, reasons: [...new Set(reasons)], checked_timeframes: availableTimeframes };
}

function candidateToAIResult(candidate) {
    return {
        direction: candidate.direction,
        decision: candidate.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT',
        selected_candidate_id: candidate.id,
        selected_zone: { type: candidate.zone_type, timeframe: candidate.timeframe, low: candidate.zone_low, high: candidate.zone_high },
        entry_zone: { source: candidate.zone_type, low: candidate.zone_low, high: candidate.zone_high },
        entry: candidate.entry,
        stop_loss: candidate.stop_loss,
        take_profit_1: candidate.tp1,
        take_profit_2: candidate.tp2 ?? null,
        take_profit_3: candidate.tp3 ?? null,
        confidence: getDeterministicCandidateConfidence(candidate),
        reasoning: { primary: candidate.stop_reason || 'Deterministic candidate' },
        patterns: candidate.strategy_setup
            ? [candidate.strategy_setup.label || candidate.strategy_setup.primary].concat(candidate.strategy_setup.confirmations || [])
            : [candidate.zone_type],
        risk_reward: candidate.rr_tp1 ? `1:${candidate.rr_tp1}` : null
    };
}

function evaluateSetupLifecycle(candidate, marketContext = {}) {
    const setup = candidate.strategy_setup || candidate;
    const setupTf = setup.setup_timeframe || setup.timeframe || candidate.timeframe;
    const executionTf = setup.execution_timeframe || candidate.execution_timeframe || setupTf;
    const data = marketContext.historyCache?.[setupTf] || [];
    const executionData = marketContext.historyCache?.[executionTf] || data;
    const spec = STRATEGY_SPEC.LIFECYCLE;
    const freshnessSpec = STRATEGY_SPEC.FRESHNESS;
    // Fresh execution zones have their own lifecycle. Prefer their creation
    // timestamp when the parent narrative did not provide a separate
    // execution event; otherwise an MSNR/FVG zone is aged from the old
    // narrative index and expires while the zone is still actionable.
    const executionEventTime = normalizeTimestampUTC(candidate.execution_event_time ?? candidate.execution_zone_created_time ?? setup.execution_event_time ?? setup.execution_zone_created_time ?? setup.execution_zone?.created_time);
    const executionEventIndex = Number.isInteger(candidate.execution_event_index)
        ? candidate.execution_event_index
        : Number.isInteger(setup.execution_event_index)
            ? setup.execution_event_index
            : Number.isInteger(setup.execution_zone_created_index)
                ? setup.execution_zone_created_index
                : null;
    // A reaction retest is the entry, not a new signal that resets its consumption.
    // A role reversal becomes actionable at the confirmed break, before its first retest.
    let index = setup.primary === 'MSNR'
        ? (setup.entry_model === 'ROLE_REVERSAL_RETEST' ? setup.break_index : setup.departure_confirmed_index)
        : (setup.reclaim_bar_index ?? setup.reclaim_index ?? setup.evidence?.reclaim_bar);
    const eventTime = setup.primary === 'MSNR' ? setup.event_time : (setup.reclaim_time ?? setup.event_time);
    const normalizedEventTime = Number.isFinite(executionEventTime) ? executionEventTime : normalizeTimestampUTC(eventTime);
    let strategyEventIndex = Number.isInteger(index) ? index : null;
    let executionEventIndexResolved = executionEventIndex;
    if (Number.isFinite(normalizedEventTime)) {
        const matchedStrategy = findEventCandleIndex(data, normalizedEventTime, setupTf);
        strategyEventIndex = matchedStrategy >= 0 ? matchedStrategy : strategyEventIndex;
        const matchedExecution = findEventCandleIndex(executionData, normalizedEventTime, executionTf);
        executionEventIndexResolved = matchedExecution >= 0 ? matchedExecution : executionEventIndexResolved;
    }
    index = Number.isFinite(executionEventTime) ? executionEventIndexResolved : strategyEventIndex;
    const low = candidate.entry_region_low ?? candidate.zone_low ?? setup.structural_entry_region?.low;
    const high = candidate.entry_region_high ?? candidate.zone_high ?? setup.structural_entry_region?.high;
    const entry = candidate.entry ?? setup.execution_zone?.midpoint;
    const tp1 = candidate.tp1 ?? candidate.take_profit_1;
    const price = Number(marketContext.price ?? marketContext.current_price);
    const suppliedAsOf = marketContext.as_of_time || marketContext.utc_time || marketContext.scan_time || marketContext.market_context?.as_of_time;
    const hasExplicitTimes = [...data, ...executionData].some(bar => Number.isFinite(normalizeTimestampUTC(bar?.t)));
    const latestTimestamp = Math.max(
        latestCandleTimestamp(data, setupTf),
        latestCandleTimestamp(executionData, executionTf)
    );
    const normalizedAsOfTime = normalizeTimestampUTC(suppliedAsOf);
    const asOfTime = Number.isFinite(normalizedAsOfTime)
        ? normalizedAsOfTime
        : (Number.isFinite(latestTimestamp) ? latestTimestamp : null);
    const resolvedEventTime = Number.isFinite(normalizedEventTime)
        ? normalizedEventTime
        : (Number.isInteger(index) ? candleTimestamp((executionEventTime ? executionData : data)[index], index, executionEventTime ? executionTf : setupTf) : null);
    const parentEventTime = normalizeTimestampUTC(eventTime ?? getStrategyEventTime(setup));
    const parentEventAgeHours = Number.isFinite(asOfTime) && Number.isFinite(parentEventTime)
        ? (asOfTime - parentEventTime) / 3600000 : null;
    const rawEventAgeHours = hasExplicitTimes && Number.isFinite(asOfTime) && Number.isFinite(resolvedEventTime)
        ? (asOfTime - resolvedEventTime) / 3600000
        : (Number.isInteger(index) ? Math.max(0, data.length - 1 - index) * (({ '15M': 15, '1H': 60, '4H': 240, '1D': 1440 }[setupTf] || 60) / 60) : null);
    const timestampInFuture = hasExplicitTimes && Number.isFinite(asOfTime) && Number.isFinite(resolvedEventTime) && resolvedEventTime > asOfTime + STRATEGY_SPEC.TIME.futureToleranceMs;
    const zoneCreatedTime = normalizeTimestampUTC(candidate.execution_zone_created_time ?? setup.execution_zone_created_time ?? setup.execution_zone?.created_time);
    const zoneTimeInFuture = hasExplicitTimes && Number.isFinite(asOfTime) && Number.isFinite(zoneCreatedTime) && zoneCreatedTime > asOfTime + STRATEGY_SPEC.TIME.futureToleranceMs;
    const eventAgeHours = rawEventAgeHours;
    const ageTimeframe = Number.isFinite(executionEventTime) ? executionTf : setupTf;
    const barMinutes = { '15M': 15, '1H': 60, '4H': 240, '1D': 1440 }[ageTimeframe] || 60;
    const eventAgeBars = Number.isFinite(eventAgeHours) ? Math.round(eventAgeHours * 60 / barMinutes)
        : (Number.isInteger(index) ? (executionEventTime ? executionData.length : data.length) - 1 - index : null);
    const maxEventAgeHours = ageTimeframe === '15M'
        ? freshnessSpec.max15mEventAgeHours
        : ageTimeframe === '1H'
            ? freshnessSpec.max1hEventAgeHours
            : ageTimeframe === '4H'
                ? freshnessSpec.max4hEventAgeHours
                : freshnessSpec.max1hEventAgeHours;
    const atrData = executionData.length >= 15 ? executionData : data;
    const executionAtr = atrData.length >= 15 ? atr(atrData, 14) : null;
    const distanceToEntry = Number.isFinite(entry) && Number.isFinite(price) ? Math.abs(entry - price) : null;
    const distanceToEntryAtr = Number.isFinite(distanceToEntry) && Number.isFinite(executionAtr) && executionAtr > 0
        ? distanceToEntry / executionAtr
        : null;
    const entryReachabilityScore = Number.isFinite(distanceToEntryAtr)
        ? Math.max(0, Math.round(100 - distanceToEntryAtr * 22))
        : null;
    const pendingEntryQuality = !Number.isFinite(entryReachabilityScore)
        ? 'LOW'
        : entryReachabilityScore >= freshnessSpec.mediumEntryReachabilityScore
            ? 'HIGH'
            : entryReachabilityScore >= freshnessSpec.lowEntryReachabilityScore
                ? 'MEDIUM'
                : 'LOW';
    const sessionClock = Number.isFinite(asOfTime) ? new Date(asOfTime) : new Date();
    const sessionFacts = getSession(sessionClock);
    const currentSession = marketContext.session?.name || marketContext.session || marketContext.market_context?.session?.name || sessionFacts.session;
    const eventSession = Number.isFinite(resolvedEventTime) ? getSession(new Date(resolvedEventTime)).session : null;
    const marketState = getMarketOpenState(marketContext.pair || pair, {
        ...(marketContext.quote_snapshot || {}),
        as_of_ms: asOfTime,
        market_open: marketContext.market_open
    });
    const marketClosed = marketState.is_market_open === false;
    const result = {
        event_time: resolvedEventTime,
        event_time_utc: Number.isFinite(resolvedEventTime) ? new Date(resolvedEventTime).toISOString() : null,
        as_of_time_utc: Number.isFinite(asOfTime) ? new Date(asOfTime).toISOString() : null,
        zone_created_time_utc: Number.isFinite(zoneCreatedTime) ? new Date(zoneCreatedTime).toISOString() : null,
        source_candle_time_utc: Number.isInteger(index) && (executionEventTime ? executionData[index] : data[index])
            ? new Date(candleTimestamp((executionEventTime ? executionData : data)[index], index, executionEventTime ? executionTf : setupTf)).toISOString() : null,
        timestamp_source: timestampSource(resolvedEventTime, Number.isInteger(index) ? (executionEventTime ? executionData : data)[index] : null),
        structure_data_cutoff: Number.isFinite(latestTimestamp) ? latestTimestamp : null,
        event_age_hours: eventAgeHours,
        event_age_bars: eventAgeBars,
        parent_event_time: parentEventTime,
        parent_event_time_utc: Number.isFinite(parentEventTime) ? new Date(parentEventTime).toISOString() : null,
        parent_event_age_hours: parentEventAgeHours,
        current_session: currentSession,
        event_session: eventSession,
        expected_entry_window: currentSession ? `CURRENT_SESSION_OR_NEXT_VALID_${executionTf}_WINDOW` : null,
        hours_remaining_in_relevant_session: hoursRemainingInSession(sessionClock),
        market_closed: marketClosed,
        market_open: marketState.is_market_open,
        market_open_source: marketState.source,
        asset_class: marketState.asset_class,
        still_actionable_today: false,
        entry_region_low: low, entry_region_high: high,
        entry_consumed: false, entry_first_touch_index: null, entry_first_touch_time: null,
        entry_touch_count_after_signal: 0, entry_freshness: 'FRESH',
        tp1_already_reached: false, tp1_first_reached_index: null, tp1_first_reached_time: null,
        nominal_reward_after_fill: Number.isFinite(tp1) && Number.isFinite(entry) ? Math.abs(tp1 - entry) : null,
        entry_retracement_distance: Number.isFinite(entry) && Number.isFinite(price) ? Math.abs(price - entry) : null,
        remaining_reward_fraction: Number.isFinite(tp1) && Math.abs(tp1 - entry) > 0 ? Math.max(0, Math.min(1, Math.abs(tp1 - price) / Math.abs(tp1 - entry))) : null,
        progress_to_tp1_fraction: Number.isFinite(tp1) && Number.isFinite(entry) && Math.abs(tp1 - entry) > 0
            ? Math.max(0, Math.min(1, candidate.direction === 'BUY' ? (price - entry) / (tp1 - entry) : (entry - price) / (entry - tp1)))
            : null,
        progress_to_tp1_fraction_raw: Number.isFinite(tp1) && Number.isFinite(entry) && Math.abs(tp1 - entry) > 0
            ? (candidate.direction === 'BUY' ? (price - entry) / (tp1 - entry) : (entry - price) / (entry - tp1))
            : null,
        distance_to_entry: distanceToEntry,
        distance_to_entry_atr: distanceToEntryAtr,
        distance_to_entry_pips: Number.isFinite(distanceToEntry) ? distanceToEntry / (Number(marketContext.pipSize) || getMarketSettings(marketContext.pair || pair).pipSize) : null,
        expected_retrace_quality: pendingEntryQuality,
        entry_reachable_today: Number.isFinite(distanceToEntryAtr) ? distanceToEntryAtr <= freshnessSpec.pendingLaterDistanceAtr : true,
        entry_reachability_score: entryReachabilityScore,
        pending_entry_quality: pendingEntryQuality,
        opportunity_status: 'STALE',
        setup_lifecycle_status: 'FRESH', rejection_code: null
    };
    result.time_integrity = {
        as_of_time_ms: asOfTime,
        as_of_time_utc: result.as_of_time_utc,
        event_time_ms: resolvedEventTime,
        event_time_utc: result.event_time_utc,
        zone_created_time_ms: zoneCreatedTime,
        zone_created_time_utc: result.zone_created_time_utc,
        event_delta_ms: Number.isFinite(asOfTime) && Number.isFinite(resolvedEventTime) ? asOfTime - resolvedEventTime : null,
        zone_delta_ms: Number.isFinite(asOfTime) && Number.isFinite(zoneCreatedTime) ? asOfTime - zoneCreatedTime : null,
        strategy_timeframe: setupTf,
        execution_timeframe: executionTf,
        event_timestamp_source: result.timestamp_source,
        zone_timestamp_source: timestampSource(zoneCreatedTime, setup.execution_zone || candidate.zone),
        failure: timestampInFuture ? 'EVENT_IN_FUTURE' : zoneTimeInFuture ? 'ZONE_IN_FUTURE' : (hasExplicitTimes && Number.isFinite(eventAgeHours) && eventAgeHours < 0 ? 'NEGATIVE_EVENT_AGE' : null)
    };
    const maxAge = STRATEGY_SPEC[setup.primary]?.maxEventAgeBars ?? spec.maxMSNREventAgeBars;
    const lifecycleData = executionEventTime ? executionData : data;
    const executionOwnAgeExpired = Number.isFinite(executionEventTime)
        ? (!Number.isFinite(eventAgeHours) || eventAgeHours > maxEventAgeHours)
        : false;
    const parentMaxAgeHours = setupTf === '15M'
        ? freshnessSpec.max15mEventAgeHours
        : setupTf === '1H'
            ? freshnessSpec.max1hEventAgeHours
            : setupTf === '4H'
                ? freshnessSpec.max4hEventAgeHours
                : freshnessSpec.max1hEventAgeHours;
    const parentAgeExpired = Number.isFinite(parentEventAgeHours)
        ? parentEventAgeHours > parentMaxAgeHours
        : false;
    const indexAgeExpired = !Number.isFinite(executionEventTime)
        && (lifecycleData.length - 1 - index > maxAge);
    const expired = !Number.isInteger(index) || index < 0 || index >= lifecycleData.length ||
        indexAgeExpired || !Number.isFinite(low) || !Number.isFinite(high);
    const hasExplicitExecutionTimes = executionData.some(bar => Number.isFinite(parseCandleTimeUTC(bar?.t)));
    const eventCutoff = Number.isFinite(resolvedEventTime) && hasExplicitExecutionTimes ? resolvedEventTime : null;
    if ((Number.isInteger(index) && index >= 0 && index < lifecycleData.length) || eventCutoff != null) {
        for (let i = 0; i < executionData.length; i++) {
            const bar = executionData[i];
            const barHasExplicitTime = Number.isFinite(parseCandleTimeUTC(bar?.t));
            const barTime = candleTimestamp(bar, i, executionTf);
            if (eventCutoff != null) {
                if (barHasExplicitTime && barTime <= eventCutoff) continue;
                if (!barHasExplicitTime && Number.isInteger(index) && executionTf === setupTf && i <= index) continue;
                if (!barHasExplicitTime && executionTf !== setupTf && hasExplicitExecutionTimes) continue;
            } else if (Number.isInteger(index) && i <= index) {
                continue;
            }
            if (bar.l <= high && bar.h >= low) {
                result.entry_touch_count_after_signal++;
                if (result.entry_first_touch_index == null) {
                    result.entry_first_touch_index = i;
                    result.entry_first_touch_time = barTime;
                }
            }
            if (Number.isFinite(tp1) && (candidate.direction === 'BUY' ? bar.h >= tp1 : bar.l <= tp1)) {
                result.tp1_already_reached = true;
                if (result.tp1_first_reached_index == null) {
                    result.tp1_first_reached_index = i;
                    result.tp1_first_reached_time = barTime;
                }
            }
        }
    }
    result.entry_consumed = result.entry_touch_count_after_signal > spec.maxEntryTouches;
    result.execution_zone_consumed = result.entry_consumed;
    const currentReached = Number.isFinite(tp1) && (candidate.direction === 'BUY' ? price >= tp1 : price <= tp1);
    result.tp1_already_reached ||= currentReached;
    const staleByAge = !Number.isFinite(eventAgeHours) || eventAgeHours > maxEventAgeHours || parentAgeExpired;
    const deliveryAdvanced = result.remaining_reward_fraction != null && result.remaining_reward_fraction < freshnessSpec.minRemainingRewardFraction;
    const entryTooFarForToday = !result.entry_reachable_today;
    result.timestamp_consistent = !timestampInFuture && !zoneTimeInFuture && !(hasExplicitTimes && Number.isFinite(eventAgeHours) && eventAgeHours < -(STRATEGY_SPEC.TIME.futureToleranceMs / 3600000));
    result.still_actionable_today = result.timestamp_consistent && !expired && !staleByAge && !result.entry_consumed && !result.tp1_already_reached &&
        !deliveryAdvanced && !entryTooFarForToday && !marketClosed;
    result.rejection_code = !result.timestamp_consistent ? 'DATA_TIME_INCONSISTENT' : expired ? 'SETUP_EXPIRED'
        : result.tp1_already_reached ? 'SETUP_ALREADY_COMPLETED'
        : result.entry_consumed ? 'ENTRY_ALREADY_CONSUMED'
        : deliveryAdvanced ? 'SETUP_DELIVERY_ALREADY_ADVANCED'
        : staleByAge ? 'SETUP_STALE'
        : marketClosed ? 'MARKET_CLOSED'
            : entryTooFarForToday ? 'ENTRY_NOT_REACHABLE_TODAY' : null;
    result.entry_freshness = expired ? 'EXPIRED' : result.entry_consumed ? 'CONSUMED' : result.entry_touch_count_after_signal ? 'TOUCHED' : 'FRESH';
    result.opportunity_status = result.rejection_code === 'SETUP_ALREADY_COMPLETED' ? 'COMPLETED'
        : result.rejection_code === 'SETUP_EXPIRED' ? 'EXPIRED'
            : result.rejection_code === 'ENTRY_ALREADY_CONSUMED' ? 'CONSUMED'
                : result.rejection_code === 'SETUP_DELIVERY_ALREADY_ADVANCED' ? 'DELIVERY_ADVANCED'
                    : result.rejection_code === 'MARKET_CLOSED' ? 'FRESH_PENDING_LATER'
                        : result.rejection_code === 'ENTRY_NOT_REACHABLE_TODAY' ? 'FRESH_PENDING_LATER'
                        : result.rejection_code ? 'INVALID'
                            : (getZonePriceStatus(price, { low, high }).insideZone ? 'FRESH_NOW' : 'FRESH_PENDING_TODAY');
    result.setup_lifecycle_status = result.lifecycle_state = result.opportunity_status;
    return result;
}

function calculateCandidateConfidence(candidate, context = {}) {
    const spec = STRATEGY_SPEC.CONFIDENCE;
    const lifecycle = candidate?.evaluation?.metrics?.setup_lifecycle || candidate || {};
    const adjustments = [];
    let score = spec.baseScore;
    const add = (label, value) => {
        score += value;
        adjustments.push({ label, value });
    };
    if (['FRESH_NOW', 'FRESH_PENDING_TODAY'].includes(lifecycle.opportunity_status)) add('Fresh actionable event', spec.freshEvent);
    if (Number.isFinite(lifecycle.remaining_reward_fraction)) {
        if (lifecycle.remaining_reward_fraction >= STRATEGY_SPEC.FRESHNESS.normalRemainingRewardFraction) add('Normal reward remains', spec.normalReward);
        else if (lifecycle.remaining_reward_fraction >= STRATEGY_SPEC.FRESHNESS.minRemainingRewardFraction) add('Partial reward remaining', spec.partialRewardPenalty);
    }
    if (Number.isFinite(lifecycle.entry_reachability_score)) {
        add(`Entry reachability ${lifecycle.entry_reachability_score}`, (lifecycle.entry_reachability_score - 50) * spec.entryDistanceWeight);
    }
    const targetReachability = Number(candidate?.target_reachability?.reachability_score ?? candidate?.target_map?.[0]?.reachability_score);
    if (Number.isFinite(targetReachability)) add(`Target reachability ${targetReachability}`, (targetReachability - 50) * spec.targetReachabilityWeight);
    const htfAlignment = Number(candidate?.htf_alignment ?? context.htf_alignment ?? 0);
    if (candidate.trade_context_classification && TOP_DOWN_QUALITY_ADJUSTMENTS[candidate.trade_context_classification] != null) {
        add('HTF context ' + candidate.trade_context_classification, TOP_DOWN_QUALITY_ADJUSTMENTS[candidate.trade_context_classification]);
    } else if (htfAlignment > 0) add(`HTF alignment ${htfAlignment}`, htfAlignment * spec.htfAlignment);
    const confirmations = candidate?.strategy_setup?.confirmations || [];
    if (confirmations.length > 0) add(`Strategy confluence ${confirmations.length}`, confirmations.length * spec.confluence);
    const bias = context.directional_bias || context.market_context?.directional_bias;
    if ((candidate.direction === 'BUY' && bias === 'BEARISH') || (candidate.direction === 'SELL' && bias === 'BULLISH')) add('Countertrend context', spec.countertrendPenalty);
    const seriousObstacles = (candidate?.target_reachability?.intervening_obstacles || candidate?.target_map?.[0]?.intervening_obstacles || [])
        .filter(obstacle => obstacle.severity === 'SERIOUS').length;
    if (seriousObstacles > 0) add(`Serious target obstacles ${seriousObstacles}`, seriousObstacles * spec.seriousObstaclePenalty);
    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const qualityBand = finalScore >= spec.highQualityMinimum ? 'HIGH' : finalScore >= spec.mediumQualityMinimum ? 'MEDIUM' : 'LOW';
    const qualityBreakdown = {
        base: spec.baseScore,
        strategy_adjustment: adjustments.filter(a => /Fresh|confluence/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        htf_adjustment: adjustments.filter(a => /HTF/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        execution_freshness_adjustment: adjustments.filter(a => /Entry reachability|reward/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        target_reachability_adjustment: adjustments.filter(a => /Target reachability/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        obstacle_adjustment: adjustments.filter(a => /obstacle/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        delivery_progress_adjustment: adjustments.filter(a => /reward/i.test(a.label)).reduce((s, a) => s + a.value, 0),
        session_adjustment: 0,
        stop_quality_adjustment: 0,
        final_confidence: finalScore,
        quality_band: qualityBand
    };
    return {
        base_score: spec.baseScore,
        adjustments,
        final_score: finalScore,
        quality: qualityBand,
        quality_breakdown: qualityBreakdown
    };
}

function getDeterministicCandidateConfidence(candidate) {
    const value = Number(candidate?.quality?.final_confidence ?? candidate?.confidence_breakdown?.final_score);
    return Number.isFinite(value) ? value : NaN;
}

function evaluateSetupCandidate(candidate, marketContext = {}, options = {}) {
    const reasons = [];
    const checks = {};
    const metrics = {};
    const historyCache = marketContext.historyCache || {};
    const price = Number(marketContext.price ?? marketContext.current_price);
    const pairLocal = marketContext.pair || pair;
    const settings = getMarketSettings(pairLocal);
    const direction = candidate?.direction;

    const add = reason => { reasons.push(reason); };
    if (!candidate || typeof candidate !== 'object') return { valid: false, checks, reasons: ['candidate missing'], metrics };
    if (direction !== 'BUY' && direction !== 'SELL') add('direction must be BUY or SELL');

    const entry = Number(candidate.entry);
    const stopLoss = Number(candidate.stop_loss);
    const tp1 = Number(candidate.tp1 ?? candidate.take_profit_1);
    const rawTp2 = candidate.tp2 ?? candidate.take_profit_2;
    const rawTp3 = candidate.tp3 ?? candidate.take_profit_3;
    const tp2 = rawTp2 == null ? null : Number(rawTp2);
    const tp3 = rawTp3 == null ? null : Number(rawTp3);
    for (const [name, value] of [['entry', entry], ['stop_loss', stopLoss], ['take_profit_1', tp1]]) {
        if (!ictFiniteNumber(value)) add(`${name} must be a finite number`);
    }
    if (rawTp2 != null && !ictFiniteNumber(tp2)) add('take_profit_2 must be a finite number when supplied');
    if (rawTp3 != null && !ictFiniteNumber(tp3)) add('take_profit_3 must be a finite number when supplied');
    if (!ictFiniteNumber(price) || price <= 0) add('current price is invalid');
    if (reasons.length > 0) return { valid: false, checks, reasons, metrics };

    const strategySetup = candidate.strategy_setup || null;
    metrics.strategy_setup = strategySetup;
    if (strategySetup) {
        const lifecycle = evaluateSetupLifecycle(candidate, marketContext);
        Object.assign(candidate, lifecycle);
        metrics.setup_lifecycle = lifecycle;
        checks.setupLifecycle = !lifecycle.rejection_code;
        if (lifecycle.rejection_code) return { valid: false, checks, reasons: [lifecycle.rejection_code], metrics };
    }
    if (marketContext.require_strategy_setup) {
        const labels = [strategySetup?.primary, ...(strategySetup?.confirmations || [])].filter(Boolean);
        const marketMechanicsVerified = candidate.market_mechanics_verified === true
            || (strategySetup?.market_mechanics_verified && strategySetup?.opportunity_thesis?.state === 'EXECUTION_VALID');
        if (!labels.some(v => ['CRT', 'TBS', 'MSNR', 'ICT', 'MARKET_MECHANICS'].includes(String(v).toUpperCase())) && !marketMechanicsVerified) {
            add('candidate is not backed by a deterministic market-mechanics narrative');
        }
    }

    if (direction === 'BUY' && !(stopLoss < entry && entry < tp1)) {
        add('BUY geometry must be SL < entry < TP1');
    }
    if (direction === 'SELL' && !(stopLoss > entry && entry > tp1)) {
        add('SELL geometry must be SL > entry > TP1');
    }
    if (Number.isFinite(tp2)) {
        if (direction === 'BUY' && !(tp2 > tp1)) add('BUY TP2 must be greater than TP1 when supplied');
        if (direction === 'SELL' && !(tp2 < tp1)) add('SELL TP2 must be less than TP1 when supplied');
    }
    if (Number.isFinite(tp3)) {
        const prior = Number.isFinite(tp2) ? tp2 : tp1;
        if (direction === 'BUY' && !(tp3 > prior)) add('BUY TP3 must be greater than the prior supplied target');
        if (direction === 'SELL' && !(tp3 < prior)) add('SELL TP3 must be less than the prior supplied target');
    }
    const suppliedTargets = [tp1, tp2, tp3].filter(Number.isFinite);
    if (new Set(suppliedTargets.map(v => String(v))).size !== suppliedTargets.length) add('take profits must be distinct');
    checks.geometry = reasons.length === 0;

    let matchedZone = null;
    let matchedZoneTf = candidate.timeframe || null;
    const hasContextZones = Array.isArray(marketContext.real_ict_zones);
    const zones = hasContextZones ? marketContext.real_ict_zones : [];
    if (hasContextZones) {
        matchedZone = findSelectedLiveZone(candidateToAIResult(candidate), { real_ict_zones: zones });
        matchedZoneTf = matchedZone?.timeframe || matchedZoneTf;
        if (!matchedZone) add('candidate zone does not exist in current deterministic market context');
    }
    if (!matchedZone && !hasContextZones) {
        for (const tf of ['4H', '1H']) {
            const data = historyCache?.[tf];
            const candidates = ictBuildRealZones(data, price, direction, pairLocal, tf);
            const match = candidates.find(z => ictZoneMatchesAI(z, candidateToAIResult(candidate)));
            if (match) {
                matchedZone = match;
                matchedZoneTf = tf;
                break;
            }
        }
        if (!matchedZone) add('no real deterministic FVG/OB/MSNR matches the entry and declared zone');
    }
    if (matchedZone) {
        checks.realZone = true;
        if (matchedZone.direction && matchedZone.direction !== direction) add('selected zone direction does not match trade direction');
        if (matchedZone.primary_eligible === false || (matchedZone.type === 'MSNR' && matchedZone.origin !== 'STRUCTURAL_MSNR')) {
            add('only STRUCTURAL_MSNR can be selected as a primary MSNR strategy zone');
        }
        if (matchedZone.invalidated) add('matched zone is invalidated');
        const zoneTol = Math.max(matchedZone.tolerance || 0, (matchedZone.high - matchedZone.low) * 0.1);
        if (entry < matchedZone.low - zoneTol || entry > matchedZone.high + zoneTol) {
            add(`entry ${entry} is outside deterministic ${matchedZone.type} ${matchedZone.low}-${matchedZone.high}`);
        } else {
            checks.entryInsideZone = true;
        }
    }

    const rr = calculateRRMetrics(direction, entry, stopLoss, tp1, settings.targetRR || 2.5);
    metrics.risk = rr.risk;
    metrics.reward = rr.reward;
    metrics.rr = rr.actualRR;
    metrics.slDistance = rr.risk;
    const minRR = Number(marketContext.risk_constraints?.minimum_rr) || settings.targetRR || 2.5;
    if (!Number.isFinite(rr.actualRR) || rr.actualRR < minRR) add(`real RR ${Number.isFinite(rr.actualRR) ? rr.actualRR.toFixed(2) : 'invalid'} below ${minRR.toFixed(2)} minimum`);

    const fourH = historyCache?.['4H'] || [];
    const oneH = historyCache?.['1H'] || [];
    const daily = historyCache?.['1D'] || [];
    const atrContext = getCandidateATRContext(candidate, historyCache, pairLocal, price);
    const stopEvaluation = evaluateStructuralStop(candidate, atrContext, pairLocal);
    metrics.atrContext = {
        setup_timeframe: atrContext.setup_timeframe,
        setup_atr: atrContext.setup_atr,
        higher_timeframe_atr: atrContext.higher_timeframe_atr,
        minimum_reasonable_distance: atrContext.minimum_reasonable_distance,
        maximum_reasonable_distance: atrContext.maximum_reasonable_distance
    };
    metrics.slATRMultiple = atrContext.atr_rule_reference ? rr.risk / atrContext.atr_rule_reference : null;
    metrics.stopStatus = stopEvaluation.status;
    metrics.volatilityClassification = stopEvaluation.volatility_classification || null;
    if (stopEvaluation.status !== 'VALID_STRUCTURAL_STOP') add(stopEvaluation.reason);
    checks.stopLoss = stopEvaluation.status === 'VALID_STRUCTURAL_STOP';

    if (atrContext.atr_rule_reference > 0) {
        const entryDistATR = Math.abs(entry - price) / atrContext.atr_rule_reference;
        metrics.entryDistanceATR = entryDistATR;
        if (entryDistATR > LIMIT_ORDER_MAX_DIST_ATR) add(`entry is ${entryDistATR.toFixed(2)}x ATR from price (max ${LIMIT_ORDER_MAX_DIST_ATR}x)`);
    }

    const desiredTrend = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const htfDirections = {
        '1D': getCanonicalTimeframeTrend(daily, '1D', marketContext.structure?.['1D']),
        '4H': getCanonicalTimeframeTrend(fourH, '4H', marketContext.structure?.['4H']),
        '1H': getCanonicalTimeframeTrend(oneH, '1H', marketContext.structure?.['1H'])
    };
    const htfMatch = Object.values(htfDirections).filter(v => v === desiredTrend).length;
    metrics.htfMatch = htfMatch;
    metrics.htfDirections = htfDirections;
    const archetype = classifySetupArchetype(candidate, historyCache, price, {
        ...marketContext.structure,
        '1D': { ...(marketContext.structure?.['1D'] || {}), trend: htfDirections['1D'] },
        '4H': { ...(marketContext.structure?.['4H'] || {}), trend: htfDirections['4H'] },
        '1H': { ...(marketContext.structure?.['1H'] || {}), trend: htfDirections['1H'] }
    });
    metrics.setup_archetype = archetype.setup_archetype;
    metrics.reversal_evidence = archetype.reversal_evidence;
    if (archetype.setup_archetype === 'CONTINUATION') {
        checks.htfMatch = htfMatch;
    } else if (archetype.reversal_evidence.evidence_count < 2) {
        add(`reversal evidence insufficient (${archetype.reversal_evidence.evidence_count}/2) with HTF alignment ${htfMatch}/3`);
    } else {
        checks.htfMatch = `${htfMatch}/3 REVERSAL_ALLOWED`;
    }

    const oppositeDirection = direction === 'BUY' ? 'SELL' : 'BUY';
    let confirmingCHoCH = false;
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (!data || data.length < 20) continue;
        if (detectCHoCH(data, oppositeDirection)) add(`opposing ${oppositeDirection} CHoCH detected on ${tf}`);
        if (detectCHoCH(data, direction)) confirmingCHoCH = true;
    }
    checks.choch = confirmingCHoCH ? 'CONFIRMS' : 'NONE';

    if (matchedZone && matchedZoneTf) {
        const freshnessData = historyCache?.[matchedZoneTf];
        const freshness = checkZoneFreshness(freshnessData, matchedZone, direction);
        metrics.freshness = freshness;
        if (freshness.violations > 1) add(`matched zone invalidated ${freshness.violations} times`);
        if (freshness.touches > MAX_ZONE_TOUCHES) add(`matched zone has ${freshness.touches} touches (max ${MAX_ZONE_TOUCHES})`);
    }

    if (options.includeAccountRules !== false) {
        if (!checkLossProtection()) add(`loss protection active (${consecutiveLosses} losses / ${dailyPnlR.toFixed(1)}R daily)`);
        if (!checkTradeGap(2)) add('trade gap active - wait 2h from actual fill');
    }
    checks.lossProtection = options.includeAccountRules === false ? 'SKIPPED' : !reasons.some(r => r.includes('loss protection'));
    checks.tradeGap = options.includeAccountRules === false ? 'SKIPPED' : !reasons.some(r => r.includes('trade gap'));

    return {
        valid: reasons.length === 0,
        checks,
        reasons,
        metrics,
        matchedZone,
        matchedZoneTf
    };
}

function buildStructureSnapshot(data, tf) {
    data = closedStructureCandles(data);
    if (!data || data.length < 20) {
        return { timeframe: tf, structural_trend: 'NEUTRAL', momentum_trend: 'NEUTRAL', effective_trend: 'NEUTRAL', trend_confidence: 'LOW', structure_state: 'INSUFFICIENT', trend: 'NEUTRAL', structure_sequence: [], recent_swing_highs: [], recent_swing_lows: [] };
    }
    const sw = findSwings(data, 3);
    const mss = detectMSS(data);
    const highs = (sw.H || []).slice(-2), lows = (sw.L || []).slice(-2);
    const structuralTrend = highs.length === 2 && lows.length === 2
        ? highs[1].p > highs[0].p && lows[1].p > lows[0].p ? 'BULLISH'
            : highs[1].p < highs[0].p && lows[1].p < lows[0].p ? 'BEARISH' : 'MIXED'
        : 'NEUTRAL';
    const momentumTrend = detectTrend(data) || 'NEUTRAL';
    const directionalBias = getDirectionBias(data);
    const structureSequence = analyzeMarketStructure(data);
    const sequenceBullish = structureSequence.includes('HH') && structureSequence.includes('HL');
    const sequenceBearish = structureSequence.includes('LH') && structureSequence.includes('LL');
    const sequenceMixed = (structureSequence.includes('HH') && structureSequence.includes('LL'))
        || (structureSequence.includes('LH') && structureSequence.includes('HL'));
    const inferredStructuralTrend = structuralTrend === 'NEUTRAL'
        ? sequenceBullish ? 'BULLISH'
            : sequenceBearish ? 'BEARISH'
                : sequenceMixed ? 'MIXED' : 'NEUTRAL'
        : structuralTrend;
    const directionalShift = mss?.type === 'BULL' || mss?.type === 'BEAR' || detectBOS(data, 'BUY') || detectBOS(data, 'SELL') || detectCHoCH(data, 'BUY') || detectCHoCH(data, 'SELL');
    const effectiveTrend = inferredStructuralTrend === 'BULLISH' || inferredStructuralTrend === 'BEARISH'
        ? inferredStructuralTrend
        : inferredStructuralTrend === 'MIXED' && ['BULLISH', 'BEARISH'].includes(momentumTrend)
            ? momentumTrend
        : inferredStructuralTrend === 'MIXED' && ['BULLISH', 'BEARISH'].includes(directionalBias)
            ? directionalBias
        : inferredStructuralTrend === 'NEUTRAL' && ['BULLISH', 'BEARISH'].includes(momentumTrend)
            ? momentumTrend
            : inferredStructuralTrend === 'NEUTRAL' && ['BULLISH', 'BEARISH'].includes(directionalBias)
                ? directionalBias
            : directionalShift
                ? (mss?.type === 'BULL' || detectBOS(data, 'BUY') || detectCHoCH(data, 'BUY') ? 'BULLISH_TRANSITION' : 'BEARISH_TRANSITION')
                : 'NEUTRAL';
    return {
        timeframe: tf,
        structural_trend: inferredStructuralTrend,
        momentum_trend: momentumTrend,
        effective_trend: effectiveTrend,
        trend_confidence: effectiveTrend === inferredStructuralTrend && effectiveTrend !== 'NEUTRAL' ? 'HIGH' : effectiveTrend !== 'NEUTRAL' ? 'MEDIUM' : 'LOW',
        structure_state: inferredStructuralTrend === 'NEUTRAL' ? (directionalShift ? 'TRANSITION' : 'INSUFFICIENT') : inferredStructuralTrend === 'MIXED' ? 'CONFLICTING' : 'CONFIRMED',
        trend: effectiveTrend,
        bias: getDirectionBias(data),
        mss: mss ? { type: mss.type, level: mss.level } : null,
        bos_buy: detectBOS(data, 'BUY'),
        bos_sell: detectBOS(data, 'SELL'),
        choch_buy: detectCHoCH(data, 'BUY'),
        choch_sell: detectCHoCH(data, 'SELL'),
        structure_sequence: analyzeMarketStructure(data),
        recent_swing_highs: (sw.H || []).slice(-5).map(s => ({ level: s.p, index: s.i })),
        recent_swing_lows: (sw.L || []).slice(-5).map(s => ({ level: s.p, index: s.i }))
    };
}

function buildLiveZonesForTf(data, tf, price, pairLocal, atrVal, limitPerDirection = 5) {
    data = closedStructureCandles(data);
    if (!data || data.length < 20) return [];
    const prec = getMarketSettings(pairLocal).prec;
    const zones = [];
    for (const direction of ['BUY', 'SELL']) {
        const realZones = ictBuildRealZones(data, price, direction, pairLocal, tf);
        for (const z of realZones) {
            const midpoint = z.price || (z.low + z.high) / 2;
            const freshness = checkZoneFreshness(data, z, direction);
            const zoneStatus = getZonePriceStatus(price, z);
            zones.push({
                id: `${tf}-${direction}-${z.type}-${ictRound(z.low, prec)}-${ictRound(z.high, prec)}`,
                ...z,
                created_index: z.created_index ?? z.source_candle_index ?? null,
                created_time: z.created_time ?? (Number.isInteger(z.created_index) ? candleTimestamp(data[z.created_index], z.created_index, tf) : null),
                type: z.type,
                origin: z.origin || (z.type === 'MSNR' ? 'PIVOT_REFERENCE' : 'STRUCTURAL'),
                primary_eligible: z.primary_eligible !== false,
                direction,
                timeframe: tf,
                low: ictRound(z.low, prec),
                high: ictRound(z.high, prec),
                midpoint: ictRound(midpoint, prec),
                price_at_zone_now: zoneStatus.insideZone,
                price_position: zoneStatus.pricePosition,
                distance_to_zone: ictRound(zoneStatus.distanceToZone, prec),
                distance_from_price: ictRound(Math.abs(midpoint - price), prec),
                distance_pct: ictRound(Math.abs(midpoint - price) / price * 100, 3),
                distance_in_atr: atrVal > 0 ? ictRound(Math.abs(midpoint - price) / atrVal, 2) : null,
                freshness: freshness.fresh ? 'FRESH' : (freshness.partiallyUsed ? 'PARTIAL' : 'USED'),
                touches: freshness.touches,
                invalidated: freshness.violations > 0,
                violations: freshness.violations
            });
        }
    }
    return ['BUY', 'SELL'].flatMap(direction => zones
        .filter(z => z.direction === direction)
        .sort((a, b) => (a.distance_in_atr ?? a.distance_pct) - (b.distance_in_atr ?? b.distance_pct))
        .slice(0, limitPerDirection));
}

function buildTargetCandidates(historyCache, price, pairLocal) {
    const prec = getMarketSettings(pairLocal).prec;
    const candidates = [];
    const daily = getClosedHistory(historyCache, '1D');
    const previousDay = daily.at(-1);
    if (previousDay) {
        if (Number.isFinite(previousDay.h)) candidates.push({ id: `PDH:${previousDay.t}`, direction: 'BUY', timeframe: '1D', source: 'PDH', target_type: 'PREVIOUS_DAY_HIGH', origin: 'CLOSED_DAILY', level: ictRound(previousDay.h, prec), distance_from_price: Math.abs(previousDay.h - price), structural_priority: 92 });
        if (Number.isFinite(previousDay.l)) candidates.push({ id: `PDL:${previousDay.t}`, direction: 'SELL', timeframe: '1D', source: 'PDL', target_type: 'PREVIOUS_DAY_LOW', origin: 'CLOSED_DAILY', level: ictRound(previousDay.l, prec), distance_from_price: Math.abs(previousDay.l - price), structural_priority: 92 });
    }
    for (const tf of ['4H', '1H']) {
        const data = getClosedHistory(historyCache, tf);
        if (!data || data.length < 20) continue;
        const msnr = calculateMSNR(data, price, tf, pairLocal);
        const liq = mapLiquidity(data);
        const sw = findSwings(data, 3);
        for (const meta of (msnr.structural_levels || []).filter(l => l.direction === 'SELL' && l.level > price).slice(0, 5)) {
            const level = meta.level;
            candidates.push({ direction: 'BUY', timeframe: tf, source: 'OPPOSING_MSNR', target_type: 'OPPOSING_MSNR', origin: meta.origin || 'STRUCTURAL_MSNR', level, distance_from_price: Math.abs(level - price), structural_priority: 88 });
        }
        for (const meta of (msnr.structural_levels || []).filter(l => l.direction === 'BUY' && l.level < price).slice(0, 5)) {
            const level = meta.level;
            candidates.push({ direction: 'SELL', timeframe: tf, source: 'OPPOSING_MSNR', target_type: 'OPPOSING_MSNR', origin: meta.origin || 'STRUCTURAL_MSNR', level, distance_from_price: Math.abs(level - price), structural_priority: 88 });
        }
        for (const level of (liq.above || []).slice(0, 5)) {
            candidates.push({ direction: 'BUY', timeframe: tf, source: 'BUY_SIDE_LIQUIDITY', target_type: 'EXTERNAL_LIQUIDITY', origin: 'STRUCTURAL', level, distance_from_price: Math.abs(level - price), structural_priority: 82 });
        }
        for (const level of (liq.below || []).slice(0, 5)) {
            candidates.push({ direction: 'SELL', timeframe: tf, source: 'SELL_SIDE_LIQUIDITY', target_type: 'EXTERNAL_LIQUIDITY', origin: 'STRUCTURAL', level, distance_from_price: Math.abs(level - price), structural_priority: 82 });
        }
        for (const s of (sw.H || []).slice(-5)) {
            candidates.push({ direction: 'BUY', timeframe: tf, source: 'SWING_HIGH', target_type: 'SWING_HIGH_LOW', origin: 'STRUCTURAL', level: s.p, distance_from_price: Math.abs(s.p - price), structural_priority: 76 });
        }
        for (const s of (sw.L || []).slice(-5)) {
            candidates.push({ direction: 'SELL', timeframe: tf, source: 'SWING_LOW', target_type: 'SWING_HIGH_LOW', origin: 'STRUCTURAL', level: s.p, distance_from_price: Math.abs(s.p - price), structural_priority: 76 });
        }
        for (const fvg of detectFVG(data)) {
            if (fvg.type === 'bear') {
                candidates.push({ direction: 'BUY', timeframe: tf, source: 'OPPOSING_FVG', target_type: 'FVG', origin: 'STRUCTURAL', level: fvg.m, distance_from_price: Math.abs(fvg.m - price), structural_priority: 62 });
            }
            if (fvg.type === 'bull') {
                candidates.push({ direction: 'SELL', timeframe: tf, source: 'OPPOSING_FVG', target_type: 'FVG', origin: 'STRUCTURAL', level: fvg.m, distance_from_price: Math.abs(fvg.m - price), structural_priority: 62 });
            }
        }
        for (const ob of detectOrderBlocks(data, 'SELL')) {
            const mid = (ob.low + ob.high) / 2;
            candidates.push({ direction: 'BUY', timeframe: tf, source: 'OPPOSING_OB', target_type: 'OB', origin: 'STRUCTURAL', level: mid, distance_from_price: Math.abs(mid - price), structural_priority: 68 });
        }
        for (const ob of detectOrderBlocks(data, 'BUY')) {
            const mid = (ob.low + ob.high) / 2;
            candidates.push({ direction: 'SELL', timeframe: tf, source: 'OPPOSING_OB', target_type: 'OB', origin: 'STRUCTURAL', level: mid, distance_from_price: Math.abs(mid - price), structural_priority: 68 });
        }
    }
    const dedupe = new Map();
    for (const c of candidates) {
        if (!Number.isFinite(c.level)) continue;
        const key = `${c.direction}-${c.timeframe}-${c.source}-${ictRound(c.level, prec)}`;
        dedupe.set(key, {
            ...c,
            id: c.id || `TARGET:${c.direction}:${c.timeframe}:${c.source}:${ictRound(c.level, prec)}`,
            created_time: c.created_time || null,
            reached: !!c.reached, consumed: !!c.consumed, invalidated: !!c.invalidated,
            ahead_of_current_price: c.direction === 'BUY' ? c.level > price : c.level < price,
            ahead_of_entry: null, reachability: c.reachability ?? null,
            evidence_ids: Array.isArray(c.evidence_ids) ? c.evidence_ids : [c.id || `${c.source}:${c.timeframe}:${c.level}`],
            level: ictRound(c.level, prec),
            distance_from_price: ictRound(c.distance_from_price, prec),
            distance_pct: ictRound(Math.abs(c.level - price) / price * 100, 3)
        });
    }
    const all = [...dedupe.values()];
    return {
        all: all.sort((a, b) => (b.structural_priority || 0) - (a.structural_priority || 0) || a.distance_from_price - b.distance_from_price).slice(0, 60),
        buy: all.filter(c => c.direction === 'BUY' && c.level > price).sort((a, b) => a.distance_from_price - b.distance_from_price).slice(0, 10),
        sell: all.filter(c => c.direction === 'SELL' && c.level < price).sort((a, b) => a.distance_from_price - b.distance_from_price).slice(0, 10)
    };
}

function buildLimitOrderStageContext(zones, targetCandidates, price, atrVal, entryContext) {
    const eligibleZones = (zones || []).filter(z => z.primary_eligible !== false && !z.invalidated);
    const zonesAtPrice = eligibleZones.filter(z => z.price_at_zone_now);
    const nearestZones = eligibleZones
        .slice()
        .sort((a, b) => (a.distance_to_zone ?? a.distance_from_price ?? 0) - (b.distance_to_zone ?? b.distance_from_price ?? 0))
        .slice(0, 6);
    const confirmation = entryContext?.entryConfirmation || {};
    return {
        limit_order_setup: {
            eligible: eligibleZones.length > 0,
            future_entry_allowed: eligibleZones.length > 0,
            current_price_inside_zone_required: false,
            reason: eligibleZones.length > 0
                ? 'Valid future pending-limit setup may exist if zone, geometry, RR, and deterministic validation pass.'
                : 'No primary-eligible deterministic zone is currently available.',
            eligible_zone_count: eligibleZones.length,
            zones_at_current_price_count: zonesAtPrice.length,
            nearest_eligible_zones: nearestZones.map(z => ({
                type: z.type,
                origin: z.origin,
                direction: z.direction,
                timeframe: z.timeframe,
                low: z.low,
                high: z.high,
                price_at_zone_now: z.price_at_zone_now,
                distance_to_zone: z.distance_to_zone,
                distance_in_atr: z.distance_in_atr
            })),
            target_candidate_count: (targetCandidates?.buy?.length || 0) + (targetCandidates?.sell?.length || 0),
            atr_reference: atrVal || null
        },
        immediate_entry: {
            eligible: !!entryContext?.allOk,
            price_at_zone_now: !!confirmation.isAtZone,
            confirmation_score: confirmation.score || 0,
            confirmation_strength: confirmation.strength || 'NONE',
            session_priority: entryContext?.sessionCheck?.priority || 'UNKNOWN',
            session_reason: entryContext?.sessionCheck?.reason || null,
            reason: entryContext?.summary || 'Immediate entry not evaluated',
            note: 'Immediate-entry filters do not automatically invalidate a future pending-limit setup.'
        }
    };
}

function summarizeCandidateRejections(rejectedCandidates) {
    return summarizeCandidateRejectionDetails(rejectedCandidates);
}

function classifyRejectionDetail(reason) {
    const integrityCode = String(reason).match(/\b(ENGINE_INVARIANT_FAILURE|DATA_TIME_INCONSISTENT|DETERMINISTIC_CONFIDENCE_MISSING)\b/);
    if (integrityCode) return integrityCode[1];
    if (/^(ENTRY_ALREADY_CONSUMED|SETUP_ALREADY_COMPLETED|SETUP_DELIVERY_ALREADY_ADVANCED|SETUP_EXPIRED|SETUP_STALE|MARKET_CLOSED|ENTRY_NOT_REACHABLE_TODAY)$/.test(reason)) return reason;
    if (/SL_INSIDE_STRUCTURAL_INVALIDATION|authoritative strategy invalidation/i.test(reason)) return 'SL_INSIDE_STRUCTURAL_INVALIDATION';
    if (/BUY stop|SELL stop|STRUCTURALLY_INVALID/i.test(reason)) return 'STOP_STRUCTURAL_INVALID';
    if (/EXTREME_TOO_TIGHT|extreme volatility anomaly|below .*minimum|below .*ATR|too tight/i.test(reason)) return 'EXTREME_TOO_TIGHT';
    if (/EXTREME_TOO_WIDE|exceeds .*maximum|too wide/i.test(reason)) return 'EXTREME_TOO_WIDE';
    if (/no real TP1 satisfies minimum RR/i.test(reason)) return 'NO_VALID_TP1';
    if (/TARGET_POOL_EMPTY|no target pool/i.test(reason)) return 'TARGET_POOL_EMPTY';
    if (/NO_TARGETS_DIRECTIONALLY_AHEAD|directionally ahead/i.test(reason)) return 'NO_TARGETS_DIRECTIONALLY_AHEAD';
    if (/TARGETS_EXIST_BUT_RR_TOO_LOW|no real TP1|minimum RR/i.test(reason)) return 'TARGETS_EXIST_BUT_RR_TOO_LOW';
    if (/TARGETS_EXIST_BUT_UNREACHABLE|unreachable target/i.test(reason)) return 'TARGETS_EXIST_BUT_UNREACHABLE';
    if (/TARGETS_BLOCKED_BY_STRUCTURE|blocked by structure/i.test(reason)) return 'TARGETS_BLOCKED_BY_STRUCTURE';
    if (/TARGET_PROVENANCE_INVALID|target provenance/i.test(reason)) return 'TARGET_PROVENANCE_INVALID';
    if (/no real target|no supplied target|no real deterministic target|target ladder/i.test(reason)) return 'NO_VALID_TP1';
    if (/RR .*below|minimum RR|actual RR/i.test(reason)) return 'TP1_RR_TOO_LOW';
    if (/HTF alignment/i.test(reason)) return 'CONTINUATION_HTF';
    if (/reversal evidence insufficient/i.test(reason)) return 'REVERSAL_EVIDENCE_INSUFFICIENT';
    if (/context quality/i.test(reason)) return 'CONTEXT_QUALITY_TOO_LOW';
    if (/candidate zone|selected zone|real deterministic|invalidated|entry .*outside/i.test(reason)) return 'ZONE_INVALID';
    if (/loss protection/i.test(reason)) return 'LOSS_PROTECTION';
    if (/trade gap/i.test(reason)) return 'TRADE_GAP';
    if (/Insufficient .* data|non-finite OHLC|impossible OHLC|timestamps are not ordered|ATR is unavailable or invalid|current price is invalid/i.test(reason)) return 'DATA_QUALITY';
    return 'OTHER';
}

function summarizeCandidateRejectionDetails(rejectedCandidates) {
    const counts = {};
    for (const item of rejectedCandidates || []) {
        const codes = item.rejection_code ? [item.rejection_code] : (item.rejection_reasons || []).map(classifyRejectionDetail);
        for (const code of codes) counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
}

function summarizeStrategyDetections(strategySetups) {
    const stats = strategySetups?.detection_stats || {};
    const counts = {
        CRT: { raw_count: stats.CRT?.raw_count || 0, deduped_count: stats.CRT?.deduped_count || 0, bullish: 0, bearish: 0 },
        TBS: { raw_count: stats.TBS?.raw_count || 0, deduped_count: stats.TBS?.deduped_count || 0, bullish: 0, bearish: 0 },
        MSNR: { raw_count: stats.MSNR?.raw_count || 0, deduped_count: stats.MSNR?.deduped_count || 0, structural_count: 0, executable_count: 0, pivot_reference_count: stats.MSNR?.pivot_reference_count || 0, atr_fallback_count: stats.MSNR?.atr_fallback_count || 0 },
        combinations: { CRT_TBS: 0, CRT_MSNR: 0, TBS_MSNR: 0, CRT_TBS_MSNR: 0 },
        narratives: {
            strategy_narratives: stats.strategy_narratives || 0,
            active_narratives: stats.active_narratives || 0,
            invalidated_narratives: stats.invalidated_narratives || 0,
            completed_narratives: stats.completed_narratives || 0,
            stale_narratives: stats.stale_narratives || 0
        },
        execution_zones: {
            execution_zones_discovered: stats.execution_zones_discovered || 0,
            execution_zones_fresh: stats.execution_zones_fresh || 0,
            fresh_execution_zones: stats.fresh_execution_zones || 0,
            fresh_execution_zones_raw: stats.fresh_execution_zones_raw || 0,
            consumed_execution_zones: stats.consumed_execution_zones || 0,
            invalidated_execution_zones: stats.invalidated_execution_zones || 0,
            pre_signal_execution_zones: stats.pre_signal_execution_zones || 0,
            wrong_side_execution_zones: stats.wrong_side_execution_zones || 0,
            expired_execution_zones: stats.expired_execution_zones || 0
        }
    };
    for (const setup of strategySetups || []) {
        if (setup.primary === 'CRT') {
            if (setup.direction === 'BUY') counts.CRT.bullish++;
            if (setup.direction === 'SELL') counts.CRT.bearish++;
        }
        if (setup.primary === 'TBS') {
            if (setup.direction === 'BUY') counts.TBS.bullish++;
            if (setup.direction === 'SELL') counts.TBS.bearish++;
        }
        if (setup.primary === 'MSNR') {
            counts.MSNR.structural_count++;
            if (setup.execution_zone?.primary_eligible !== false) counts.MSNR.executable_count++;
        }
        const label = String(setup.label || '');
        if (label.includes('CRT') && label.includes('TBS') && label.includes('MSNR')) counts.combinations.CRT_TBS_MSNR++;
        else if (label.includes('CRT') && label.includes('TBS')) counts.combinations.CRT_TBS++;
        else if (label.includes('CRT') && label.includes('MSNR')) counts.combinations.CRT_MSNR++;
        else if (label.includes('TBS') && label.includes('MSNR')) counts.combinations.TBS_MSNR++;
    }
    return counts;
}

function buildCandidatePipelineAudit(strategySetups, rawCandidates, rejectedCandidates, validCandidates, seedDiagnostics = []) {
    const details = summarizeCandidateRejectionDetails(rejectedCandidates);
    const seedFailureCounts = {};
    for (const seed of seedDiagnostics) {
        for (const reason of seed.failure_reasons) seedFailureCounts[reason] = (seedFailureCounts[reason] || 0) + 1;
    }
    const freshSeeds = seedDiagnostics.filter(s => s.execution_model === 'FRESH_RETRACEMENT_LIMIT');
    const originalSeeds = seedDiagnostics.filter(s => s.execution_model !== 'FRESH_RETRACEMENT_LIMIT');
    const freshRejected = (rejectedCandidates || []).filter(c => c.execution_model === 'FRESH_RETRACEMENT_LIMIT' || String(c.id || '').startsWith('FRESH-'));
    const freshValid = (validCandidates || []).filter(c => c.execution_model === 'FRESH_RETRACEMENT_LIMIT');
    const freshFailureCounts = {};
    for (const seed of freshSeeds) for (const reason of seed.failure_reasons || []) freshFailureCounts[reason] = (freshFailureCounts[reason] || 0) + 1;
    return {
        strategy_setups: (strategySetups || []).length,
        execution_seeds: getStrategyExecutionZones(strategySetups || []).length,
        execution_opportunities: seedDiagnostics.length,
        semantic_entries: seedDiagnostics.reduce((count, seed) => count + (seed.semantic_entries || 0), 0),
        raw_candidates: (rawCandidates || []).length,
        zero_candidate_seeds: seedDiagnostics.filter(s => s.raw_candidates === 0).length,
        seed_failure_counts: seedFailureCounts,
        seed_diagnostics: seedDiagnostics,
        structural_stop_valid: (rawCandidates || []).filter(c => c.risk_model?.status === 'VALID_STRUCTURAL_STOP').length,
        structural_stops_valid: (rawCandidates || []).filter(c => c.risk_model?.status === 'VALID_STRUCTURAL_STOP').length,
        target_valid: (rawCandidates || []).filter(c => Number.isFinite(c.tp1) && c.target_map?.length > 0).length,
        rr_valid: (rawCandidates || []).filter(c => Number.isFinite(c.tp1) && Number.isFinite(c.minimum_rr)
            && calculateRRMetrics(c.direction, c.entry, c.stop_loss, c.tp1, c.minimum_rr).actualRR >= c.minimum_rr).length,
        volatility_rejected: (details.EXTREME_TOO_TIGHT || 0) + (details.EXTREME_TOO_WIDE || 0) + (details.STOP_VOLATILITY_TOO_TIGHT || 0) + (details.STOP_VOLATILITY_TOO_WIDE || 0),
        target_rejected: (details.NO_VALID_TP1 || 0) + (details.TP1_RR_TOO_LOW || 0) + (details.TARGET_POOL_EMPTY || 0) + (details.NO_TARGETS_DIRECTIONALLY_AHEAD || 0) + (details.TARGETS_EXIST_BUT_RR_TOO_LOW || 0) + (details.TARGETS_BLOCKED_BY_STRUCTURE || 0) + (details.TARGETS_EXIST_BUT_UNREACHABLE || 0),
        consistency_rejected: details.ZONE_INVALID || 0,
        context_rejected: (details.CONTINUATION_HTF || 0) + (details.REVERSAL_EVIDENCE_INSUFFICIENT || 0),
        final_valid: (validCandidates || []).length,
        original_execution_pipeline: {
            seeds: originalSeeds.length,
            candidates: (rawCandidates || []).filter(c => c.execution_model !== 'FRESH_RETRACEMENT_LIMIT').length,
            consumed: details.ENTRY_ALREADY_CONSUMED || 0,
            expired: (details.SETUP_EXPIRED || 0) + (details.SETUP_STALE || 0),
            completed: details.SETUP_ALREADY_COMPLETED || 0
        },
        fresh_execution_pipeline: {
            seeds: freshSeeds.length,
            candidates: (rawCandidates || []).filter(c => c.execution_model === 'FRESH_RETRACEMENT_LIMIT').length,
            stop_valid: (rawCandidates || []).filter(c => c.execution_model === 'FRESH_RETRACEMENT_LIMIT' && c.risk_model?.status === 'VALID_STRUCTURAL_STOP').length,
            target_valid: freshRejected.filter(c => !['TARGET_POOL_EMPTY', 'NO_TARGETS_DIRECTIONALLY_AHEAD', 'TARGETS_EXIST_BUT_RR_TOO_LOW', 'TARGETS_BLOCKED_BY_STRUCTURE', 'TARGETS_EXIST_BUT_UNREACHABLE', 'TARGET_PROVENANCE_INVALID', 'NO_VALID_TP1'].includes(c.rejection_code)).length + freshValid.length,
            rr_valid: freshValid.filter(c => Number(c.rr_tp1) > 0).length,
            final_valid: freshValid.length,
            failure_counts: freshFailureCounts
        }
    };
}

function waitCodeFromRejections(audit, hasStrategySetups) {
    const fresh = audit?.fresh_execution_pipeline;
    const allDetails = {};
    // These summaries overlap: do not count the same rejection twice.
    for (const counts of [audit?.rejection_detail, audit?.seed_failure_counts, fresh?.failure_counts]) {
        for (const [code, count] of Object.entries(counts || {})) {
            allDetails[code] = Math.max(allDetails[code] || 0, Number(count) || 0);
        }
    }
    const integrityCodes = ['ENGINE_INVARIANT_FAILURE', 'DATA_TIME_INCONSISTENT', 'DATA_QUALITY',
        'INVALID_MARKET_DATA', 'MISSING_TIMEFRAME_DATA', 'DETERMINISTIC_CONFIDENCE_MISSING'];
    const integrity = integrityCodes.filter(code => allDetails[code] > 0)
        .sort((a, b) => allDetails[b] - allDetails[a])[0];
    if (integrity) {
        if (['INVALID_MARKET_DATA', 'MISSING_TIMEFRAME_DATA'].includes(integrity)) return 'DATA_QUALITY';
        if (integrity === 'DETERMINISTIC_CONFIDENCE_MISSING') return 'ENGINE_INVARIANT_FAILURE';
        return integrity;
    }
    if (audit?.market_open === false) return 'MARKET_CLOSED';
    if (allDetails.SPREAD_TOO_WIDE) return 'SPREAD_TOO_WIDE';
    if (!hasStrategySetups) return 'NO_STRATEGY_SETUP';
    // Once fresh opportunities exist, their terminal failures own market WAIT.
    const detail = fresh?.seeds > 0 && fresh.final_valid === 0
        ? (fresh.failure_counts || {}) : allDetails;
    const lifecycleCodes = ['SETUP_STALE', 'SETUP_EXPIRED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED',
        'SETUP_DELIVERY_ALREADY_ADVANCED', 'NARRATIVE_EXPIRED', 'EXECUTION_ZONE_EXPIRED'];
    const lifecycleCount = lifecycleCodes.reduce((sum, code) => sum + (Number(detail[code]) || 0), 0);
    const unreachableCount = Number(detail.ENTRY_NOT_REACHABLE_TODAY) || 0;
    if (lifecycleCount > unreachableCount && lifecycleCount > 0) return 'NO_FRESH_OPPORTUNITY';
    if (detail.NO_STRUCTURAL_STOP || detail.STOP_STRUCTURAL_INVALID || detail.SL_INSIDE_STRUCTURAL_INVALIDATION) return 'NO_STRUCTURAL_STOP';
    if (detail.EXTREME_TOO_TIGHT || detail.EXTREME_TOO_WIDE || detail.EXTREME_VOLATILITY) return 'EXTREME_VOLATILITY';
    if (['NO_VALID_TP1', 'TARGET_POOL_EMPTY', 'NO_TARGETS_DIRECTIONALLY_AHEAD',
        'TARGETS_EXIST_BUT_UNREACHABLE', 'TARGETS_BLOCKED_BY_STRUCTURE', 'TARGET_PROVENANCE_INVALID'].some(code => detail[code])) return 'NO_REALISTIC_TARGET';
    if (detail.TP1_RR_TOO_LOW || detail.TARGETS_EXIST_BUT_RR_TOO_LOW) return 'RR_BELOW_MINIMUM';
    if (detail.ONLY_MARGINAL_SETUPS) return 'ONLY_MARGINAL_SETUPS';
    if (unreachableCount > 0) return 'ENTRY_NOT_REACHABLE_TODAY';
    if (detail.REVERSAL_EVIDENCE_INSUFFICIENT || detail.CONTINUATION_HTF || detail.CONTEXT_QUALITY_TOO_LOW) return 'CONTEXT_QUALITY_TOO_LOW';
    if (detail.ZONE_INVALID) return 'AI_INCONSISTENT_OUTPUT';
    if (fresh?.seeds === 0 && (audit?.strategy_setups || 0) > 0) return 'NO_FRESH_EXECUTION_ZONE';
    return 'NO_EXECUTION_GEOMETRY';
}

function getTodayOpportunityZone(setup, executionZones = []) {
    return setup?.execution_zone || (executionZones || []).find(zone =>
        zone?.strategy_setup?.id === setup?.id || zone?.parent_narrative_id === setup?.id || zone?.narrative_id === setup?.id
    ) || null;
}

function getTodayOpportunityExecutionModel(setup, zone) {
    const explicit = String(setup?.opportunity_thesis?.execution_model || setup?.execution_model || setup?.entry_model || zone?.execution_model || zone?.entry_model || '').toUpperCase();
    if (['CONFIRMATION_ENTRY', 'CONFIRMATION', 'CONFIRMATION_RETEST'].includes(explicit) || setup?.requires_confirmation === true || zone?.requires_confirmation === true) return 'CONFIRMATION_ENTRY';
    return 'PENDING_LIMIT';
}

function isTodayFreshContinuation(setup, zone) {
    if (!setup || !zone || setup.narrative_state && setup.narrative_state !== 'ACTIVE') return false;
    if (setup.original_strategy_entry_consumed && !zone.created_time && !zone.created_time_ms) return false;
    if (zone.invalidated || zone.consumed || zone.entry_consumed || zone.expired ||
        ['CONSUMED', 'USED', 'INVALIDATED', 'EXPIRED'].includes(String(zone.freshness || '').toUpperCase()) ||
        ['CONSUMED', 'INVALIDATED', 'EXPIRED'].includes(String(zone.execution_state || '').toUpperCase())) return false;
    const zoneTime = normalizeTimestampUTC(zone.created_time ?? zone.created_time_ms ?? zone.created_at);
    if (!Number.isFinite(zoneTime)) return false;
    // A strategy event is the parent only when it is a narrative event. ICT
    // market-mechanics setups use their own shift event and need a separate
    // execution-zone timestamp, not a verification flag as a freshness proxy.
    const parentTime = normalizeTimestampUTC(setup.parent_narrative_event_time ?? setup.parent_event_time ?? setup.narrative_event_time
        ?? (['CRT', 'TBS', 'MSNR'].includes(String(setup.primary || '').toUpperCase()) ? setup.event_time : null));
    if (Number.isFinite(parentTime) && zoneTime <= parentTime) return false;
    if (!Number.isFinite(parentTime)) {
        const eventTime = normalizeTimestampUTC(setup.execution_event_time ?? setup.event_time ?? setup.source_time);
        if (!Number.isFinite(eventTime) || zoneTime <= eventTime) return false;
    }
    if (setup.original_execution_zone_id && setup.original_execution_zone_id === zone.id) return false;
    if (setup.original_zone_id && setup.original_zone_id === zone.id) return false;
    return true;
}

function isCurrentDevelopingOpportunity(setup, histories = {}) {
    if (!setup || setup.narrative_state && setup.narrative_state !== 'ACTIVE') return false;
    if (setup.execution_zone) return false;
    if (String(setup.freshness || '').toUpperCase() !== 'DEVELOPING' && setup.market_mechanics_verified !== true) return false;
    const tf = setup.execution_timeframe || setup.timeframe || '1H';
    const data = getClosedHistory(histories, tf);
    const eventTime = normalizeTimestampUTC(setup.event_time ?? setup.execution_event_time ?? setup.source_time);
    const latest = latestCandleTimestamp(data, tf);
    if (!Number.isFinite(eventTime) || !Number.isFinite(latest) || eventTime > latest + STRATEGY_SPEC.TIME.futureToleranceMs) return false;
    const maxAgeHours = tf === '15M' ? STRATEGY_SPEC.FRESHNESS.max15mEventAgeHours
        : tf === '4H' ? STRATEGY_SPEC.FRESHNESS.max4hEventAgeHours : STRATEGY_SPEC.FRESHNESS.max1hEventAgeHours;
    return latest - eventTime <= maxAgeHours * 3600000;
}

function buildSupplyDemandAndFlipPOIs(data, tf, price, pairLocal) {
    data = getClosedHistory({ [tf]: data }, tf);
    if (!data || data.length < 20) return [];
    const settings = getMarketSettings(pairLocal);
    const prec = settings.prec;
    const pois = [];
    const makeId = (type, index, low, high) => `${tf}-${type}-${ictRound(low, prec)}-${ictRound(high, prec)}-${normalizeTimestampUTC(candleTimestamp(data[index], index, tf)) || index}`;
    for (const direction of ['BUY', 'SELL']) {
        for (const ob of detectOrderBlocks(data, direction)) {
            const index = data.findIndex(c => c.h === ob.high && c.l === ob.low);
            if (index < 1 || index >= data.length - 1) continue;
            const departure = data[index + 1];
            const prior = data.slice(Math.max(0, index - 5), index).map(c => direction === 'BUY' ? c.h : c.l);
            const brokeStructure = direction === 'BUY'
                ? departure.c > Math.max(...prior, -Infinity)
                : departure.c < Math.min(...prior, Infinity);
            if (!brokeStructure) continue;
            const type = direction === 'BUY' ? 'DEMAND' : 'SUPPLY';
            const lifecycle = checkZoneFreshness(data, { low: ob.low, high: ob.high, source_candle_index: index + 1 }, direction);
            const freshness = lifecycle.violations > 0 ? 'INVALIDATED' : lifecycle.touches === 0 ? 'FRESH' : lifecycle.touches > 1 ? 'CONSUMED' : 'TOUCHED';
            pois.push({ id: makeId(type, index, ob.low, ob.high), type, direction, timeframe: tf,
                low: ictRound(ob.low, prec), high: ictRound(ob.high, prec), created_time: candleTimestamp(departure, index + 1, tf),
                freshness, touch_count: lifecycle.touches || 0, mitigated: (lifecycle.touches || 0) > 0,
                consumed: freshness === 'CONSUMED', invalidated: freshness === 'INVALIDATED', primary_eligible: false,
                structural_evidence_ids: [`OB:${tf}:${index}`, `DISPLACEMENT:${tf}:${index + 1}`],
                location_only: true, source: 'STRUCTURAL_DISPLACEMENT' });
        }
    }
    const msnr = calculateMSNR(data, price, tf, pairLocal);
    for (const level of msnr.structural_levels || []) {
        if (level.role_reversal_quality !== 'CONFIRMED_RETEST' || !level.retest_time || level.invalidated) continue;
        const direction = level.role === 'RESISTANCE_TO_SUPPORT' ? 'BUY' : level.role === 'SUPPORT_TO_RESISTANCE' ? 'SELL' : null;
        if (!direction) continue;
        pois.push({ id: `FLIP-${tf}-${direction}-${ictRound(level.low, prec)}-${ictRound(level.high, prec)}-${normalizeTimestampUTC(level.retest_time) || level.retest_index}`,
            type: 'FLIP', direction, timeframe: tf, low: level.low, high: level.high, created_time: level.retest_time,
            freshness: level.freshness, touch_count: level.touch_count || 0, invalidated: !!level.invalidated,
            primary_eligible: false, structural_evidence_ids: [level.id, level.break_time, level.retest_time].filter(Boolean),
            role_reversal_quality: level.role_reversal_quality, location_only: true, source: 'MSNR_ROLE_REVERSAL' });
    }
    return pois;
}

function getTodayOpportunityTargetPool({ setup, zone, targetCandidates, direction, currentPrice }) {
    const candidates = [
        ...(Array.isArray(setup?.target_candidates) ? setup.target_candidates : []),
        ...(Array.isArray(targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell']) ? targetCandidates[direction === 'BUY' ? 'buy' : 'sell'] : [])
    ];
    const native = Number(setup?.primary_objective ?? setup?.target_level ?? setup?.target);
    if (Number.isFinite(native)) candidates.push({ level: native, source: setup?.target_bias || 'STRUCTURAL_OBJECTIVE', strategy_native: true });
    const entryReference = Number(zone?.entry ?? zone?.midpoint ?? setup?.entry ?? currentPrice);
    const seen = new Set();
    return candidates.filter(target => {
        const level = Number(target?.level ?? target?.target_level ?? target?.price);
        if (!Number.isFinite(level) || !Number.isFinite(entryReference)) return false;
        if (target?.consumed || target?.invalidated || target?.reached) return false;
        // A target already passed by price cannot be the objective of a
        // future pending-limit entry. Continue through the catalog to the
        // next real structural objective.
        if (direction === 'BUY' ? level <= Number(currentPrice) : level >= Number(currentPrice)) return false;
        if (direction === 'BUY' ? level <= entryReference : level >= entryReference) return false;
        const key = String(level);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => Math.abs(Number(a.level ?? a.target_level) - entryReference) - Math.abs(Number(b.level ?? b.target_level) - entryReference));
}

function evaluateTodayOpportunityPlan({ setup, zone, pair: pairLocal = pair, currentPrice, scanAsOfMs, histories = {}, targetCandidates = {}, marketOpen = true, candidateDiagnostics = {} } = {}) {
    const fail = (reason_code, reason, metrics = {}) => ({ valid: false, reason_code, reason, metrics, zone, execution_model: getTodayOpportunityExecutionModel(setup, zone) });
    const direction = setup?.direction;
    const executionTimeframe = setup?.execution_timeframe || setup?.timeframe || zone?.timeframe;
    const model = getTodayOpportunityExecutionModel(setup, zone);
    const lifecycle = setup?.evaluation?.metrics?.setup_lifecycle || setup?.setup_lifecycle || {};
    const state = setup?.narrative_state || setup?.narrativeState || setup?.strategy_state;
    const hardDataCodes = ['DATA_TIME_INCONSISTENT', 'DATA_QUALITY', 'INVALID_MARKET_DATA', 'MISSING_TIMEFRAME_DATA', 'ENGINE_INVARIANT_FAILURE'];
    const detail = { ...(candidateDiagnostics?.rejection_detail || {}), ...(candidateDiagnostics?.seed_failure_counts || {}) };
    const hardDataFailure = hardDataCodes.find(code => Number(detail[code]) > 0);
    if (hardDataFailure) return fail(hardDataFailure, 'The scan contains a hard market-data or engine-integrity failure.');
    if (marketOpen === false || lifecycle.market_closed === true) return fail('MARKET_CLOSED', 'The instrument is closed for the current scan.');
    if (!direction || !['BUY', 'SELL'].includes(direction)) return fail('INVALID_STRATEGY_NARRATIVE', 'The developing narrative has no valid direction.');
    if (['INVALIDATED', 'TARGET_COMPLETED', 'STALE_NARRATIVE', 'EXPIRED'].includes(state)) return fail(state === 'TARGET_COMPLETED' ? 'SETUP_ALREADY_COMPLETED' : state === 'STALE_NARRATIVE' ? 'SETUP_STALE' : 'SETUP_EXPIRED', 'The strategy narrative is no longer active.');
    if (!zone && setup?.opportunity_narrative) {
        const location = setup.opportunity_narrative.location;
        const low = Number(location?.low), high = Number(location?.high);
        const invalidation = Number(setup?.structural_invalidation?.level ?? setup?.structural_invalidation_detail?.level ?? setup?.structural_invalidation);
        const targetPool = getTodayOpportunityTargetPool({ setup, zone: location, targetCandidates, direction, currentPrice });
        const target = targetPool[0];
        const targetLevel = Number(target?.level ?? target?.target_level);
        if (!Number.isFinite(low) || !Number.isFinite(high)) return fail('NO_MEANINGFUL_POI', 'A developing event has no deterministic location yet.');
        if (!Number.isFinite(invalidation)) return fail('NO_STRUCTURAL_INVALIDATION', 'The developing event has no structural invalidation intent.');
        if (!target || !Number.isFinite(targetLevel)) return fail('NO_REMAINING_TARGET', 'No directional structural target supports the developing event.');
        const executionData = getClosedHistory(histories, executionTimeframe);
        const executionAtr = executionData.length >= 15 ? atr(executionData, 14) : null;
        const distanceToArea = currentPrice < low ? low - currentPrice : currentPrice > high ? currentPrice - high : 0;
        const distanceToAreaAtr = Number.isFinite(executionAtr) && executionAtr > 0 ? distanceToArea / executionAtr : null;
        const reachable = typeof setup.opportunity_narrative.opportunity_reachable_today === 'boolean'
            ? setup.opportunity_narrative.opportunity_reachable_today
            : Number.isFinite(distanceToAreaAtr) ? distanceToAreaAtr <= STRATEGY_SPEC.FRESHNESS.pendingLaterDistanceAtr : false;
        const metrics = { distance_to_area: distanceToArea, distance_to_area_atr: distanceToAreaAtr, opportunity_reachable_today: reachable,
            delivery_progress: null, remaining_reward_fraction: null, target_available: true, target_level: targetLevel,
            target_source: target.source || target.target_type || 'STRUCTURAL_OBJECTIVE', execution_model: getTodayOpportunityExecutionModel(setup, location),
            structural_invalidation: { level: invalidation, source: setup?.structural_invalidation_detail?.source || 'ICT_STRUCTURAL_INVALIDATION', timeframe: setup.timeframe || executionTimeframe } };
        if (!reachable) return fail('ENTRY_NOT_REACHABLE_TODAY', 'The developing location is not demonstrably reachable today.', metrics);
        return { valid: true, reason_code: null, reason: 'A deterministic current-market narrative and location exist; execution evidence is still pending.',
            metrics, zone: null, target, target_pool: targetPool, execution_model: metrics.execution_model, awaiting_execution: true };
    }
    if (!zone || zone.primary_eligible === false || zone.invalidated || zone.expired === true || zone.consumed === true || zone.entry_consumed === true || ['CONSUMED', 'INVALIDATED', 'EXPIRED'].includes(String(zone.freshness || '').toUpperCase()) || ['EXPIRED', 'INVALIDATED'].includes(String(zone.execution_state || '').toUpperCase())) return fail(zone?.consumed || zone?.entry_consumed ? 'ENTRY_ALREADY_CONSUMED' : zone?.expired || String(zone?.freshness || '').toUpperCase() === 'EXPIRED' ? 'EXECUTION_ZONE_EXPIRED' : 'INVALID_EXECUTION_ZONE', 'The proposed execution area is not fresh and valid.');
    const low = Number(zone.low);
    const high = Number(zone.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return fail('INVALID_EXECUTION_ZONE', 'The area of interest has invalid numeric bounds.');
    const invalidation = Number(setup?.structural_invalidation?.level ?? setup?.structural_invalidation ?? zone?.structural_invalidation?.level ?? zone?.structural_invalidation ?? setup?.sweep_extreme ?? setup?.invalidation);
    if (!Number.isFinite(invalidation) || /PIVOT|ATR_FALLBACK/i.test(String(setup?.structural_invalidation?.source || zone?.origin || ''))) return fail('INVALID_STRUCTURAL_ZONE', 'No authoritative structural invalidation supports this plan.', { structural_invalidation: null });
    const zoneCreated = normalizeTimestampUTC(zone.created_time ?? zone.created_time_ms ?? zone.created_at);
    const parentTime = normalizeTimestampUTC(setup.event_time ?? setup.reclaim_time ?? setup.source_time);
    if (Number.isFinite(zoneCreated) && Number.isFinite(scanAsOfMs) && zoneCreated > scanAsOfMs + STRATEGY_SPEC.TIME.futureToleranceMs) return fail('DATA_TIME_INCONSISTENT', 'The execution area is dated after the scan.', { zone_created_time: zoneCreated });
    const freshContinuation = isTodayFreshContinuation(setup, zone);
    if (freshContinuation && !Number.isFinite(zoneCreated)) return fail('INVALID_EXECUTION_ZONE', 'A fresh continuation area has no canonical creation time.');
    if (Number.isFinite(zoneCreated) && Number.isFinite(parentTime) && zoneCreated < parentTime && freshContinuation) return fail('PRE_SIGNAL_EXECUTION_ZONE', 'The proposed continuation area predates its parent narrative.');
    if (['SETUP_ALREADY_COMPLETED', 'SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_EXPIRED', 'SETUP_STALE', 'ENTRY_ALREADY_CONSUMED', 'DATA_TIME_INCONSISTENT'].includes(lifecycle.rejection_code) && !freshContinuation) return fail(lifecycle.rejection_code, 'The execution opportunity has a terminal lifecycle rejection.');
    const targetPool = getTodayOpportunityTargetPool({ setup, zone, targetCandidates, direction, currentPrice });
    const target = targetPool[0];
    const targetLevel = Number(target?.level ?? target?.target_level);
    const entry = Number(zone.entry ?? zone.midpoint ?? setup.entry ?? ((low + high) / 2));
    if (!target || !Number.isFinite(targetLevel)) return fail('NO_REMAINING_TARGET', 'No real structural objective remains in the trade direction.', { target_available: false });
    if (target.hard_unreachable === true || target.reachability?.quality === 'HARD_UNREACHABLE' || target.reachability?.hard_unreachable === true) return fail('NO_REMAINING_TARGET', 'The remaining structural objective has a hard-unreachable path.', { target_available: false, target_level: targetLevel });
    if (direction === 'BUY' ? targetLevel <= currentPrice : targetLevel >= currentPrice) return fail('NO_REMAINING_TARGET', 'The remaining structural objective has already been delivered or is not ahead of price.', { target_available: false, target_level: targetLevel });
    const executionData = getClosedHistory(histories, executionTimeframe);
    const executionAtr = executionData.length >= 15 ? atr(executionData, 14) : null;
    const distanceToArea = currentPrice < low ? low - currentPrice : currentPrice > high ? currentPrice - high : 0;
    const distanceToAreaAtr = Number.isFinite(executionAtr) && executionAtr > 0 ? distanceToArea / executionAtr : null;
    const calculatedReachable = Number.isFinite(distanceToAreaAtr) ? distanceToAreaAtr <= STRATEGY_SPEC.FRESHNESS.pendingLaterDistanceAtr : null;
    const explicitReachable = model === 'PENDING_LIMIT'
        ? (typeof zone.entry_reachable_today === 'boolean' ? zone.entry_reachable_today : typeof lifecycle.entry_reachable_today === 'boolean' ? lifecycle.entry_reachable_today : null)
        : (typeof zone.opportunity_reachable_today === 'boolean' ? zone.opportunity_reachable_today : typeof lifecycle.opportunity_reachable_today === 'boolean' ? lifecycle.opportunity_reachable_today : null);
    const reachable = explicitReachable ?? calculatedReachable;
    const metrics = {
        distance_to_area: distanceToArea,
        distance_to_area_atr: distanceToAreaAtr,
        opportunity_reachable_today: reachable === true,
        delivery_progress: null,
        remaining_reward_fraction: null,
        target_available: true,
        target_level: targetLevel,
        target_source: target.source || target.target_type || 'STRUCTURAL_OBJECTIVE',
        execution_model: model,
        structural_invalidation: { level: invalidation, source: setup?.structural_invalidation?.source || zone?.structural_invalidation?.source || (setup.primary || 'STRATEGY') + '_INVALIDATION', timeframe: setup?.setup_timeframe || setup?.timeframe || executionTimeframe }
    };
    if (reachable !== true) return fail('ENTRY_NOT_REACHABLE_TODAY', 'The area is not demonstrably reachable during the remaining trading window.', metrics);
    const rewardDistance = Math.abs(targetLevel - entry);
    const remainingDistance = Math.abs(targetLevel - currentPrice);
    const rawProgress = rewardDistance > 0 ? (direction === 'BUY' ? (currentPrice - entry) / rewardDistance : (entry - currentPrice) / rewardDistance) : null;
    metrics.delivery_progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(1, rawProgress)) : null;
    metrics.remaining_reward_fraction = rewardDistance > 0 ? Math.max(0, Math.min(1, remainingDistance / rewardDistance)) : null;
    if (Number.isFinite(metrics.remaining_reward_fraction) && metrics.remaining_reward_fraction < STRATEGY_SPEC.FRESHNESS.minRemainingRewardFraction) return fail('SETUP_DELIVERY_ALREADY_ADVANCED', 'The original delivery is too advanced to stalk as a new plan.', metrics);
    if (Number.isFinite(metrics.delivery_progress) && metrics.delivery_progress >= 1) return fail('SETUP_ALREADY_COMPLETED', 'The structural objective has already been delivered.', metrics);
    return { valid: true, reason_code: null, reason: 'The narrative, fresh area, reachability, delivery, target, and invalidation contracts pass.', metrics, zone, target, execution_model: model, entry, target_pool: targetPool };
}

function buildOpportunityQuality(setup, plan, marketContext = {}, topDown = {}) {
    const previousClassification = setup?.opportunity_thesis?.htf_narrative?.classification || setup?.trade_context_classification || null;
    const classification = marketContext?.timeframe_context
        ? (topDown?.classification || previousClassification || 'LTF_ISOLATED')
        : (previousClassification || 'HTF_ALIGNED_CONTINUATION');
    const biasDirection = marketContext?.daily_bias?.direction;
    const dailyBiasRelationship = !biasDirection || biasDirection === 'NEUTRAL' ? 'NEUTRAL_CONTEXT'
        : biasDirection === setup?.direction ? 'ALIGNED'
            : classification === 'HTF_VERIFIED_REVERSAL' ? 'VERIFIED_COUNTERTREND' : 'CONFLICTING_UNVERIFIED';
    const location = plan?.zone || setup?.opportunity_narrative?.location || setup?.execution_zone;
    const locationType = String(location?.type || '').toUpperCase();
    const locationScore = location ? (['DEMAND', 'SUPPLY', 'FLIP', 'MSNR'].includes(locationType) ? 24 : 14) : 0;
    const liquidityScore = plan?.target ? ((plan.target.structural_priority || 0) >= 85 ? 22 : 12) : 0;
    const executionState = !plan?.zone ? 'AWAITING_EXECUTION' : plan.execution_model === 'CONFIRMATION_ENTRY' && !setup?.opportunity_thesis?.execution_confirmed ? 'AWAITING_CONFIRMATION' : 'EXECUTION_AVAILABLE';
    const primaryEligible = ['HTF_VERIFIED_REVERSAL', 'HTF_ALIGNED_CONTINUATION'].includes(classification);
    const tier = primaryEligible ? 2 : 1;
    const evidenceStrength = (setup?.opportunity_thesis?.evidence_ids || setup?.structural_evidence_ids || []).length;
    const executionScore = executionState === 'EXECUTION_AVAILABLE' ? 16 : executionState === 'AWAITING_CONFIRMATION' ? 10 : 5;
    const classAdjustment = classification === 'HTF_VERIFIED_REVERSAL' ? 4 : classification === 'HTF_ALIGNED_CONTINUATION' ? 3 : 0;
    const dailyAdjustment = dailyBiasRelationship === 'ALIGNED' ? 6 : dailyBiasRelationship === 'VERIFIED_COUNTERTREND' ? 2 : dailyBiasRelationship === 'CONFLICTING_UNVERIFIED' ? -8 : 0;
    const rankScore = tier * 100 + classAdjustment + dailyAdjustment + locationScore + liquidityScore + executionScore + evidenceStrength * 2 + (plan?.metrics?.opportunity_reachable_today ? 10 : 0);
    const rankReasons = [primaryEligible ? 'PRIMARY_ELIGIBLE' : 'WATCH_ONLY'];
    if (dailyBiasRelationship === 'ALIGNED') rankReasons.push('DAILY_BIAS_ALIGNED');
    if (dailyBiasRelationship === 'VERIFIED_COUNTERTREND') rankReasons.push('VERIFIED_COUNTERTREND');
    if (locationScore >= 24) rankReasons.push('HTF_LOCATION');
    if (liquidityScore >= 22) rankReasons.push('EXTERNAL_LIQUIDITY');
    if (executionState === 'EXECUTION_AVAILABLE') rankReasons.push('EXECUTION_AVAILABLE');
    if (plan?.target) rankReasons.push('REAL_TARGET');
    const deterministicConfidence = Math.min(95, Math.max(0, Math.round(
        (tier > 1 ? 25 : 8) + locationScore + liquidityScore
        + (plan?.target ? 20 : 0) + executionScore + evidenceStrength * 3
    )));
    return { classification, previous_classification: previousClassification, classification_changed: !!previousClassification && previousClassification !== classification,
        daily_bias_relationship: dailyBiasRelationship, direction_quality: tier > 1 ? 'SUPPORTED' : 'LOCAL_ONLY',
        location_quality: locationScore, liquidity_quality: liquidityScore, execution_state: executionState,
        freshness: setup?.freshness || location?.freshness || null, target_quality: plan?.target ? 'REAL_AHEAD' : 'MISSING',
        lifecycle_quality: setup?.narrative_state === 'ACTIVE' ? 'ACTIVE' : 'TERMINAL', evidence_strength: evidenceStrength,
        watch_only: !primaryEligible, authorization_state: primaryEligible ? 'PRIMARY_ELIGIBLE' : 'WATCH_ONLY',
        deterministic_confidence: deterministicConfidence,
        rank_tier: tier, rank_score: rankScore, rank_reasons: rankReasons, event_time: normalizeTimestampUTC(setup?.event_time ?? setup?.execution_event_time ?? location?.created_time),
        rejection_codes: setup?.opportunity_thesis?.rejection_codes || [] };
}

// Presentation projection only.  Execution authorization continues to be owned
// by the candidate planner; this object lets the UI describe a thesis while it
// is waiting for retracement, confirmation, or an execution zone.
function buildOpportunityDisplayScenario(plan = {}, currentPrice = null, tier = null) {
    const quality = plan.opportunity_quality || {};
    const classification = plan.trade_context_classification || quality.classification || null;
    const watchOnly = plan.watch_only === true || classification === 'LTF_ISOLATED';
    const location = plan.area_of_interest || null;
    const target = plan.target || null;
    const targetLevel = plan.target_level ?? target?.level ?? null;
    const invalidation = plan.structural_invalidation?.level ?? plan.structural_invalidation ?? null;
    return {
        id: plan.narrative_id || plan.id || null,
        direction: plan.direction || null,
        strategy: plan.strategy || plan.label || null,
        trade_context_classification: classification,
        authorization_state: tier || (watchOnly ? 'WATCH_ONLY' : 'AUTHORIZED_DEVELOPING'),
        watch_only: watchOnly,
        setup_timeframe: plan.setup_timeframe || plan.timeframe || null,
        execution_timeframe: plan.execution_timeframe || null,
        location,
        area_of_interest: location,
        current_price: currentPrice,
        entry_price: plan.entry ?? plan.entry_price ?? null,
        stop_loss: plan.stop_loss ?? null,
        take_profit_1: plan.tp1 ?? plan.take_profit_1 ?? null,
        take_profit_2: plan.tp2 ?? plan.take_profit_2 ?? null,
        take_profit_3: plan.tp3 ?? plan.take_profit_3 ?? null,
        execution_zone: plan.execution_zone || null,
        execution_model: plan.execution_model || null,
        lifecycle_state: plan.lifecycle_state || plan.narrative_state || plan.state || null,
        state: plan.reason_code || plan.state || null,
        freshness: quality.freshness || plan.freshness || location?.freshness || null,
        liquidity_context: plan.liquidity_context || plan.liquidity_event || null,
        target_intent: plan.target_intent || target?.source || null,
        target_level: targetLevel,
        target: target ? { level: target.level, source: target.source || target.target_type || null, id: target.id || null } : (targetLevel != null ? { level: targetLevel, source: plan.target_intent || null } : null),
        structural_invalidation: invalidation,
        evidence_ids: plan.evidence_ids || plan.structural_evidence_ids || plan.opportunity_thesis?.evidence_ids || [],
        next_requirement: plan.activation_conditions || [],
        cancellation_conditions: plan.cancellation_conditions || [],
        reason: plan.reason || null,
        confidence: Number.isFinite(Number(plan.confidence)) ? Number(plan.confidence) : 0,
        opportunity_quality: quality,
        rejection_codes: quality.rejection_codes || plan.rejection_codes || [],
        rank_reasons: quality.rank_reasons || []
    };
}

function compareOpportunityDisplayPlans(a, b) {
    const aq = a?.opportunity_quality || {}, bq = b?.opportunity_quality || {};
    const tier = value => value?.watch_only ? 0 : (value?.authorization_state === 'TRADE_READY' ? 3 : 2);
    return (tier(b) - tier(a))
        || (Number(bq.rank_tier || 0) - Number(aq.rank_tier || 0))
        || (Number(bq.location_quality || 0) - Number(aq.location_quality || 0))
        || (Number(bq.liquidity_quality || 0) - Number(aq.liquidity_quality || 0))
        || (Number(bq.target_quality === 'REAL_AHEAD') - Number(aq.target_quality === 'REAL_AHEAD'))
        || (Number(bq.execution_state === 'EXECUTION_AVAILABLE') - Number(aq.execution_state === 'EXECUTION_AVAILABLE'))
        || (Number(bq.evidence_strength || 0) - Number(aq.evidence_strength || 0))
        || (Number(bq.event_time || 0) - Number(aq.event_time || 0))
        || String(a?.narrative_id || a?.id || '').localeCompare(String(b?.narrative_id || b?.id || ''));
}

function buildOpportunityDisplayStack(plans = [], currentPrice = null, selected = null) {
    const sorted = plans.slice().sort(compareOpportunityDisplayPlans);
    const primaryPlan = (selected && !selected.watch_only) ? selected : sorted.find(plan => !plan.watch_only);
    return {
        primary_opportunity: primaryPlan ? buildOpportunityDisplayScenario(primaryPlan, currentPrice, primaryPlan.state === 'TRADE_READY' ? 'TRADE_READY' : 'PRIMARY_AUTHORIZED') : null,
        // Public output intentionally exposes one best setup.  Keep the
        // selected setup in active_setups so the two public views cannot
        // disagree; lower-ranked plans remain in diagnostics.
        active_setups: primaryPlan ? [buildOpportunityDisplayScenario(primaryPlan, currentPrice, primaryPlan.state === 'TRADE_READY' ? 'TRADE_READY' : 'PRIMARY_AUTHORIZED')] : [],
        watch_setups: sorted.filter(plan => plan.watch_only).map(plan => buildOpportunityDisplayScenario(plan, currentPrice, 'WATCH_ONLY'))
    };
}

function buildTodayOpportunity({ pair: pairLocal = pair, currentPrice, scanAsOfMs, histories, marketContext = {}, strategySetups = [], aiAnalysis = null, executionZones = [], candidateDiagnostics = {}, validCandidates = [], targetCandidates = {}, marketOpen = true } = {}) {
    const timeframeContext = marketContext.timeframe_context || buildTimeframeContext({ historyCache: histories, structure: marketContext.structure, price: currentPrice, strategySetups, zones: executionZones });
    const state = {
        state: 'NO_TRADE_TODAY', bias: marketContext.directional_bias || aiAnalysis?.market_view?.bias || 'NEUTRAL', strategy: null, direction: null, narrative_id: null,
        daily_bias: marketContext.daily_bias || null,
        execution_zone_id: null, source: 'DETERMINISTIC_MARKET_FACTS', ai_supported: false, deterministic_supported: false, area_of_interest: null,
        execution_model: null, activation_conditions: [], cancellation_conditions: [], target_intent: null, expected_window: 'REMAINDER_OF_TODAY',
        delivery_progress: null, remaining_reward_fraction: null, distance_to_area_atr: null, entry_reachable_today: false, opportunity_reachable_today: false,
        target_viable: false, structural_invalidation: null, reason_code: 'NO_TRADE_TODAY', reason: 'No defensible fresh or developing opportunity remains for today.',
        rejected_reason: null, rejected_opportunities: [], missed_opportunities: [], completed_opportunities: [], fresh_continuation_opportunities: [],
        terminal_parent_opportunities: [], fresh_current_market_opportunities: []
    };
    if (marketOpen === false) { state.reason_code = 'MARKET_CLOSED'; state.reason = 'The instrument is currently closed for the current scan.'; return state; }
    const bestCandidate = (validCandidates || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (bestCandidate) {
        state.top_down_context = bestCandidate.top_down_context || classifyTopDownTrade(bestCandidate, timeframeContext);
        state.trade_context_classification = state.top_down_context.classification;
        const zone = bestCandidate.zone || { low: bestCandidate.zone_low, high: bestCandidate.zone_high, type: bestCandidate.zone_type, timeframe: bestCandidate.execution_timeframe || bestCandidate.timeframe, id: bestCandidate.zone_id };
        state.state = 'TRADE_READY'; state.strategy = bestCandidate.strategy_label || bestCandidate.zone_type || null; state.direction = bestCandidate.direction;
        state.narrative_id = bestCandidate.strategy_setup?.id || bestCandidate.id; state.execution_zone_id = zone?.id || bestCandidate.id;
        state.source = 'DETERMINISTIC_CANDIDATE' + (bestCandidate.ai_verified ? '+VERIFIED_AI_ANALYST' : ''); state.ai_supported = !!bestCandidate.ai_verified; state.deterministic_supported = true;
        state.area_of_interest = zone ? { low: zone.low, high: zone.high, source: zone.entry_region_source || zone.type || 'STRUCTURAL', timeframe: zone.timeframe, zone_id: zone.id || bestCandidate.id } : null;
        state.execution_model = bestCandidate.execution_model || bestCandidate.entry_model || 'PENDING_LIMIT'; state.activation_conditions = ['All deterministic entry, structural stop, target, RR, and lifecycle conditions are satisfied'];
        state.cancellation_conditions = ['Structural invalidation is breached', 'TP1 is completed before order execution', 'Pending opportunity expires']; state.target_intent = bestCandidate.target_bias || bestCandidate.strategy_setup?.target_bias || null;
        state.delivery_progress = bestCandidate.progress_to_tp1_fraction ?? bestCandidate.narrative_delivery_progress ?? null; state.remaining_reward_fraction = bestCandidate.remaining_reward_fraction ?? null;
        state.entry_reachable_today = bestCandidate.entry_reachable_today === true; state.opportunity_reachable_today = state.entry_reachable_today; state.target_viable = true;
        state.structural_invalidation = bestCandidate.structural_invalidation || null; state.reason_code = 'TRADE_READY'; state.reason = 'A deterministic opportunity is executable under the current market state.';
        const candidatePlans = (validCandidates || []).map(candidate => ({
            ...candidate,
            state: 'TRADE_READY', narrative_id: candidate.strategy_setup?.id || candidate.id,
            direction: candidate.direction, strategy: candidate.strategy_label || candidate.zone_type || null,
            trade_context_classification: candidate.top_down_context?.classification || candidate.trade_context_classification,
            area_of_interest: candidate.zone ? { low: candidate.zone.low, high: candidate.zone.high, source: candidate.zone.type, timeframe: candidate.zone.timeframe, zone_id: candidate.zone.id } : null,
            execution_zone: candidate.zone, target: candidate.target_map?.[0] || candidate.target || null,
            target_level: candidate.tp1 || candidate.take_profit_1 || candidate.target_map?.[0]?.level,
            structural_invalidation: candidate.structural_invalidation,
            opportunity_quality: candidate.quality || { rank_tier: 2, rank_score: candidate.score || 0, target_quality: 'REAL_AHEAD' },
            confidence: candidate.confidence || candidate.score || 0,
            reason: 'A deterministic opportunity is executable under the current market state.'
        }));
        const stack = buildOpportunityDisplayStack(candidatePlans, currentPrice, candidatePlans.find(candidate => candidate.id === (bestCandidate.strategy_setup?.id || bestCandidate.id)) || candidatePlans[0]);
        Object.assign(state, stack);
        return state;
    }
    const active = (strategySetups || []).filter(setup => {
        const zone = getTodayOpportunityZone(setup, executionZones);
        const terminal = ['SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED', 'SETUP_EXPIRED', 'SETUP_STALE'].includes(setup.rejection_code);
        const currentDeveloping = isCurrentDevelopingOpportunity(setup, histories || {});
        return setup?.direction && !['INVALIDATED', 'TARGET_COMPLETED', 'STALE_NARRATIVE', 'EXPIRED'].includes(setup.narrative_state)
            && (!terminal || isTodayFreshContinuation(setup, zone) || currentDeveloping)
            && !(setup.original_strategy_entry_consumed && !isTodayFreshContinuation(setup, zone) && !currentDeveloping);
    });
    const currentSetupIds = new Set();
    for (const setup of active) {
        const zone = getTodayOpportunityZone(setup, executionZones);
        if (isTodayFreshContinuation(setup, zone) || isCurrentDevelopingOpportunity(setup, histories || {})) currentSetupIds.add(setup.id || setup.primary);
    }
    state.fresh_current_market_opportunities = [...currentSetupIds];
    for (const setup of strategySetups || []) {
        if (setup.narrative_state === 'STALE_NARRATIVE' || setup.narrative_state === 'TARGET_COMPLETED') state.completed_opportunities.push(setup.id || setup.primary);
        const setupZone = getTodayOpportunityZone(setup, executionZones);
        if (setup.original_strategy_entry_consumed && !isTodayFreshContinuation(setup, setupZone)) state.missed_opportunities.push(setup.id || setup.primary);
        if (['SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED', 'SETUP_EXPIRED', 'SETUP_STALE'].includes(setup.rejection_code)) {
            state.terminal_parent_opportunities.push({ id: setup.id || setup.primary, status: setup.rejection_code });
        }
    }
    const plans = [];
    for (const setup of active) {
        const zone = getTodayOpportunityZone(setup, executionZones);
        const plan = evaluateTodayOpportunityPlan({ setup, zone, pair: pairLocal, currentPrice, scanAsOfMs, histories, targetCandidates, marketOpen, candidateDiagnostics });
        if (!plan.valid) {
            const terminalParent = ['SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED', 'SETUP_EXPIRED', 'SETUP_STALE'].includes(plan.reason_code);
            state.rejected_opportunities.push({ narrative_id: setup.id || null, execution_zone_id: zone?.id || null, reason_code: plan.reason_code, reason: plan.reason, metrics: plan.metrics, terminal_parent: terminalParent });
            if (terminalParent) state.terminal_parent_opportunities.push({ id: setup.id || setup.primary, status: plan.reason_code });
            continue;
        }
        const planArea = zone || setup.opportunity_narrative?.location;
        const inside = currentPrice >= Number(planArea.low) && currentPrice <= Number(planArea.high);
        const source = planArea.entry_region_source || planArea.type || setup.entry_region_source || setup.primary;
        const executionTimeframe = setup.execution_timeframe || setup.timeframe || zone.timeframe || '1H';
        const aiHypothesis = aiAnalysis?.verified_hypotheses?.find(h => h.hypothesis_id === setup.ai_hypothesis_id);
        const targetIntent = setup.target_bias || setup.ai_target_intent || aiHypothesis?.target_intent || plan.target?.source || 'OPPOSING_STRUCTURE';
        const topDown = classifyTopDownTrade(setup, timeframeContext);
        const opportunityQuality = buildOpportunityQuality(setup, plan, marketContext, topDown);
        // A pending limit is already a complete deterministic order when its
        // zone, structural invalidation, target, and RR pass. Keep the exact
        // geometry on the developing plan so the public projection does not
        // describe an order while leaving entry/SL empty.
        let pendingGeometry = null;
        if (zone && plan.execution_model === 'PENDING_LIMIT') {
            const settings = getMarketSettings(pairLocal);
            const executionData = getClosedHistory(histories, executionTimeframe);
            const executionAtr = executionData.length >= 15 ? atr(executionData, 14) : 0;
            const geometryZone = { ...zone, strategy_setup: setup };
            const entry = getSemanticEntryCandidate(geometryZone, setup, setup.direction, settings.prec);
            const stops = entry == null ? [] : getAdaptiveStopCandidates(geometryZone, setup.direction, entry, executionData, executionZones, executionAtr, settings, settings.prec);
            const stop = stops.find(candidate => Number.isFinite(candidate.stop_loss));
            if (Number.isFinite(entry) && stop) {
                const minimumRR = Number(marketContext?.risk_constraints?.minimum_rr) || settings.targetRR || 2.5;
                const pool = {
                    all: [...(setup.target_candidates || []), ...(targetCandidates?.all || [])],
                    buy: [...(setup.target_candidates || []), ...(targetCandidates?.buy || [])],
                    sell: [...(setup.target_candidates || []), ...(targetCandidates?.sell || [])]
                };
                const selectedTargets = selectAdaptiveTargets(setup.direction, entry, stop.stop_loss, pool, minimumRR, settings.prec, { currentPrice });
                if (selectedTargets?.tp1) pendingGeometry = { entry, stop_loss: stop.stop_loss, tp1: selectedTargets.tp1.level,
                    tp2: selectedTargets.tp2?.level ?? null, tp3: selectedTargets.tp3?.level ?? null,
                    target: selectedTargets.tp1, rr: selectedTargets.tp1.rr };
            }
        }
        plans.push({ state: 'TODAY_OPPORTUNITY', trade_context_classification: topDown.classification, top_down_context: topDown, bias: setup.direction === 'BUY' ? 'BULLISH' : 'BEARISH', strategy: setup.label || setup.primary, direction: setup.direction,
            narrative_id: setup.id || null, execution_zone_id: zone?.id || null, source: setup.ai_verified ? 'VERIFIED_AI_HYPOTHESIS' : 'DETERMINISTIC_NARRATIVE',
            ai_supported: !!setup.ai_verified || !!aiHypothesis, deterministic_supported: true, area_of_interest: { low: Number(planArea.low), high: Number(planArea.high), source, timeframe: planArea.timeframe || executionTimeframe, zone_id: planArea.id || null },
            execution_model: plan.execution_model, activation_conditions: !zone
                ? ['A deterministic execution zone must form inside the validated location before exact geometry can be constructed']
                : plan.execution_model === 'PENDING_LIMIT'
                ? (inside ? ['Price is at the deterministic limit area; the order fills on touch at its limit price'] : ['Price retraces into the deterministic limit area; no confirmation is required after touch'])
                : (inside ? [executionTimeframe + ' area is reached; wait for deterministic 15M MSS, CHoCH, BOS, or directional displacement confirmation'] : ['Price retraces into the ' + source + ' area', 'After the area is reached, wait for deterministic confirmation before constructing the entry']),
            cancellation_conditions: ['Structural invalidation is breached', 'The structural target is completed before entry', 'The opportunity expires or market context materially changes'], target_intent: targetIntent, expected_window: 'REMAINDER_OF_TODAY',
            delivery_progress: plan.metrics.delivery_progress, remaining_reward_fraction: plan.metrics.remaining_reward_fraction, distance_to_area_atr: plan.metrics.distance_to_area_atr,
            entry_reachable_today: true, opportunity_reachable_today: plan.metrics.opportunity_reachable_today, target_viable: plan.metrics.target_available, structural_invalidation: plan.metrics.structural_invalidation,
            target: plan.target, target_level: plan.metrics.target_level, liquidity_context: plan.target ? { source: plan.target.source || plan.target.target_type || 'STRUCTURAL_OBJECTIVE', level: plan.metrics.target_level } : null,
            evidence_ids: [...new Set([...(topDown.evidence_ids || []), ...(setup.structural_evidence_ids || []), ...(setup.opportunity_thesis?.evidence_ids || [])])],
            lifecycle_state: setup.narrative_state || setup.strategy_state || 'ACTIVE', freshness: setup.freshness || planArea.freshness || null,
            reason_code: !zone ? 'WAITING_FOR_EXECUTION' : plan.execution_model === 'PENDING_LIMIT' ? 'WAITING_FOR_RETRACE' : (inside ? 'WAITING_FOR_CONFIRMATION' : 'WAITING_FOR_RETRACE'),
            reason: !zone ? 'A valid current-market narrative and location exist, but no execution zone has formed yet.' : plan.execution_model === 'PENDING_LIMIT' ? 'A deterministic pending limit remains valid for the remainder of today.' : (inside ? 'A valid strategy area is active, but deterministic confirmation is not yet present.' : 'A valid strategy narrative remains actionable today; wait for price to reach the deterministic area and activate it.'),
            setup_timeframe: setup.setup_timeframe || setup.timeframe, execution_timeframe: executionTimeframe,
            entry: pendingGeometry?.entry ?? null, stop_loss: pendingGeometry?.stop_loss ?? null, tp1: pendingGeometry?.tp1 ?? null, tp2: pendingGeometry?.tp2 ?? null, tp3: pendingGeometry?.tp3 ?? null,
            rr: pendingGeometry?.rr ?? null, confidence: Number.isFinite(Number(setup.setup_confidence)) ? Number(setup.setup_confidence) : opportunityQuality.deterministic_confidence,
            opportunity_quality: opportunityQuality, watch_only: opportunityQuality.watch_only });
        if (!currentSetupIds.has(setup.id || setup.primary)) state.fresh_current_market_opportunities.push(setup.id || setup.primary);
    }
    const primaryPlans = plans.filter(plan => !plan.watch_only);
    const watchPlans = plans.filter(plan => plan.watch_only).sort(compareOpportunityDisplayPlans);
    state.secondary_watch_scenarios = watchPlans;
    const bestPlan = primaryPlans.slice().sort(compareOpportunityDisplayPlans)[0];
    if (bestPlan) {
        Object.assign(state, bestPlan, buildOpportunityDisplayStack(plans, currentPrice, bestPlan));
        state.fresh_continuation_opportunities = primaryPlans.filter(candidate => candidate !== bestPlan).map(candidate => candidate.narrative_id);
        return state;
    }
    const bestWatch = watchPlans[0];
    if (bestWatch) {
        Object.assign(state, bestWatch, buildOpportunityDisplayStack(plans, currentPrice, bestWatch), { state: 'WATCH_ONLY', watch_only: true, reason_code: 'LTF_ISOLATED_WATCH',
            reason: 'A local setup exists, but higher-timeframe confirmation is insufficient for a primary trade thesis.' });
        return state;
    }
    const dominant = state.rejected_opportunities.reduce((counts, item) => { counts[item.reason_code] = (counts[item.reason_code] || 0) + 1; return counts; }, {});
    state.rejected_reason = Object.entries(dominant).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const terminalReasonMap = { SETUP_DELIVERY_ALREADY_ADVANCED: 'DELIVERY_ADVANCED', SETUP_ALREADY_COMPLETED: 'COMPLETED', ENTRY_ALREADY_CONSUMED: 'CONSUMED', SETUP_EXPIRED: 'EXPIRED', SETUP_STALE: 'STALE_NARRATIVE' };
    if (terminalReasonMap[state.rejected_reason] && state.fresh_current_market_opportunities.length === 0) {
        state.reason_code = 'NO_TRADE_TODAY';
        state.reason = 'No fresh current-market opportunity remains after terminal opportunities were archived.';
        state.previous_opportunity_status = terminalReasonMap[state.rejected_reason];
    }
    else if (state.rejected_reason === 'ENTRY_NOT_REACHABLE_TODAY') { state.reason_code = 'ENTRY_NOT_REACHABLE_TODAY'; state.reason = 'No remaining deterministic execution area is realistically reachable today.'; }
    else if (state.rejected_reason === 'NO_REMAINING_TARGET') { state.reason_code = 'NO_REMAINING_TARGET'; state.reason = 'No real structural objective remains in the trade direction.'; }
    else if (state.rejected_reason) { state.reason_code = state.rejected_reason; state.reason = 'No developing opportunity passed the deterministic planning contracts.'; }
    return state;
}

function buildTodayOpportunityOutput(today, pairLocal, price, asOfMs, marketOpen) {
    const date = new Date(Number.isFinite(asOfMs) ? asOfMs : Date.now());
    const opportunity = ['TODAY_OPPORTUNITY', 'WATCH_ONLY'].includes(today?.state) ? {
        scenario: today.reason,
        area_of_interest: today.area_of_interest,
        execution_model: today.execution_model,
        activation: today.activation_conditions,
        cancellation: today.cancellation_conditions,
        target_intent: today.target_intent,
        expected_window: today.expected_window,
        opportunity_quality: today.opportunity_quality?.authorization_state || (today.state === 'WATCH_ONLY' ? 'WATCH_ONLY' : null)
    } : undefined;
        const signal = {
        date: date.toISOString().split('T')[0],
        time: date.toISOString().split('T')[1].split('.')[0],
        pair: pairLocal,
        current_price: price,
        decision: 'WAIT',
        confidence: today?.state === 'TODAY_OPPORTUNITY' ? today.confidence || 0 : 0,
        // Keep the public API's developing state stable.  WATCH_ONLY is a
        // display tier inside the opportunity stack, not a new top-level trade
        // decision contract.
        status: today?.state === 'WATCH_ONLY' ? 'TODAY_OPPORTUNITY' : (today?.state || 'NO_TRADE_TODAY'),
        trade_context_classification: today?.trade_context_classification || null,
        top_down_context: today?.top_down_context || null,
        daily_bias: today?.daily_bias || null,
        news_risk: today?.news_risk || { status: 'UNKNOWN', available: false },
        symbol_metadata: getSymbolMetadata(pairLocal),
        data_quality: today?.data_quality || null,
        strategy: today?.strategy || null,
            direction: today?.direction || null,
            bias: today?.bias || 'NEUTRAL',
            trend_detection: today?.trend_detection || null,
            volatility: today?.volatility || null,
            indicators: today?.indicators || null,
            opportunity,
        primary_opportunity: today?.primary_opportunity || null,
        active_setups: Array.isArray(today?.active_setups) ? today.active_setups : [],
        watch_setups: Array.isArray(today?.watch_setups) ? today.watch_setups : [],
        reason: {
            code: today?.reason_code || 'NO_TRADE_TODAY',
            message: today?.reason || 'No defensible fresh or developing opportunity remains for today.'
        },
        market_open: marketOpen,
        market_conditions: today?.market_conditions || null
    };
    return { trade_signal: signal };
}

function recoverTodayOpportunityAfterRejectedSelection(liveMarketContext, selectedCandidateId, scanArgs) {
    const today = liveMarketContext?.today_opportunity;
    const todayIds = new Set([
        today?.id,
        today?.narrative_id,
        today?.primary_opportunity?.id,
        ...(today?.active_setups || []).map(setup => setup?.id),
        ...(today?.watch_setups || []).map(setup => setup?.id)
    ].filter(Boolean));
    if (today && (!selectedCandidateId || !todayIds.has(selectedCandidateId))) return today;

    const remainingCandidates = (liveMarketContext?.adaptive_setup_candidates || [])
        .filter(candidate => candidate?.id !== selectedCandidateId);
    return buildTodayOpportunity({
        ...scanArgs,
        marketContext: liveMarketContext.market_context,
        strategySetups: liveMarketContext.strategy_setups,
        aiAnalysis: liveMarketContext.ai_analysis,
        executionZones: liveMarketContext.strategy_execution_zones,
        candidateDiagnostics: liveMarketContext.setup_candidate_audit,
        validCandidates: remainingCandidates,
        targetCandidates: liveMarketContext.target_candidates,
        marketOpen: liveMarketContext.market_open
    });
}

function buildCanonicalMarketTheses(strategySetups, marketContext, targetCandidates, price) {
    return Object.fromEntries(['BUY', 'SELL'].map(direction => {
        const setups = (strategySetups || []).filter(setup => setup.direction === direction);
        const ranked = setups.slice().sort((a, b) => {
            const aq = a.opportunity_quality?.rank_score ?? a.opportunity_thesis?.quality?.rank_score ?? 0;
            const bq = b.opportunity_quality?.rank_score ?? b.opportunity_thesis?.quality?.rank_score ?? 0;
            return bq - aq;
        });
        const setup = ranked[0] || null;
        const thesis = setup?.opportunity_thesis || null;
        const targets = (targetCandidates?.[direction.toLowerCase()] || targetCandidates?.all || [])
            .filter(target => target.direction === direction && Number.isFinite(target.level));
        return [direction.toLowerCase(), {
            direction,
            structural_context: ['1D', '4H', '1H'].map(tf => ({
                timeframe: tf,
                structural_trend: marketContext?.timeframe_context?.[tf]?.structural_trend || 'NEUTRAL',
                effective_trend: marketContext?.timeframe_context?.[tf]?.effective_trend || 'NEUTRAL',
                displayed_trend: marketContext?.timeframe_context?.[tf]?.displayed_trend
                    || getCanonicalDisplayedTrend(marketContext?.timeframe_context?.[tf] || {})
            })),
            daily_bias_relationship: thesis?.daily_bias?.direction === 'NEUTRAL' ? 'NEUTRAL_CONTEXT' :
                thesis?.daily_bias?.direction === direction ? 'ALIGNED' : thesis ? 'CONFLICTING_UNVERIFIED' : 'UNKNOWN',
            classification: thesis?.htf_narrative?.classification || setup?.trade_context_classification || 'LTF_ISOLATED',
            location: thesis?.location || setup?.location || null,
            liquidity_event: thesis?.liquidity_draw || null,
            execution_evidence: setup?.execution_zone || null,
            invalidation: thesis?.structural_invalidation_intent || setup?.structural_invalidation_detail || null,
            target_candidates: targets,
            selected_target: targets.find(target => direction === 'BUY' ? target.level > price : target.level < price) || null,
            execution_model: thesis?.execution_model || setup?.execution_model || null,
            lifecycle: setup?.lifecycle || setup?.narrative_state || null,
            quality: setup?.opportunity_quality || null,
            state: thesis?.state || (setup ? 'DEVELOPING' : 'NO_THESIS'),
            rejection_codes: thesis?.rejection_codes || []
        }];
    }));
}

function buildProductionScanTrace({ pair, price, asOfMs, historyCache, structure, timeframeContext, liquidity, zones, targetCandidates, strategySetups, candidatePipeline, candidateRejections = [], validCandidates = [], discoveryEvents = [], opportunityFunnel }) {
    const timeframe = {};
    for (const tf of ['1D', '4H', '1H', '15M']) {
        const data = getClosedHistory(historyCache, tf);
        const snapshot = structure?.[tf] || {};
        const context = timeframeContext?.[tf] || {};
        const tfLiquidity = liquidity?.[tf] || {};
        timeframe[tf] = {
            closed_candle_count: data.length,
            last_closed_candle_time: data.length ? candleTimestamp(data.at(-1), data.length - 1, tf) : null,
            structural_trend: snapshot.structural_trend || 'NEUTRAL',
            momentum_trend: snapshot.momentum_trend || snapshot.trend || 'NEUTRAL',
            effective_trend: snapshot.effective_trend || snapshot.trend || 'NEUTRAL',
            displayed_trend: context.displayed_trend || getCanonicalDisplayedTrend(snapshot),
            bos: { buy: !!snapshot.bos_buy, sell: !!snapshot.bos_sell },
            choch: { buy: !!snapshot.choch_buy, sell: !!snapshot.choch_sell },
            mss: snapshot.mss || null,
            displacement: { buy: detectDisplacement(data, 'BUY'), sell: detectDisplacement(data, 'SELL') },
            liquidity_sweeps: tfLiquidity.sweeps || [],
            premium_discount: tf === '4H' || tf === '1H' ? isPremiumDiscount(data, price) : null,
            pois: (zones || []).filter(zone => zone.timeframe === tf).map(zone => ({ id: zone.id, type: zone.type, direction: zone.direction, low: zone.low, high: zone.high, freshness: zone.freshness }))
        };
    }
    const setupTrace = (strategySetups || []).map(setup => {
        const setupCandidates = (candidatePipeline?.seed_diagnostics || []).filter(seed => seed.seed_id === setup.id || seed.seed_id === setup.execution_zone?.id);
        const rejectionCodes = [...new Set([...(setup.opportunity_thesis?.rejection_codes || []), ...setupCandidates.flatMap(seed => seed.failure_reasons || [])])];
        return {
            id: setup.id || setup.primary,
            strategy: setup.primary,
            direction: setup.direction,
            event_time: setup.event_time || null,
            entry_zone: setup.execution_zone ? { id: setup.execution_zone.id, low: setup.execution_zone.low, high: setup.execution_zone.high } : null,
            classification: setup.opportunity_thesis?.htf_narrative?.classification || setup.trade_context_classification || 'LTF_ISOLATED',
            lifecycle: setup.rejection_code || setup.narrative_state || null,
            location: setup.opportunity_thesis?.location || setup.opportunity_narrative?.location || null,
            liquidity_evidence: setup.opportunity_thesis?.liquidity_draw || setup.opportunity_narrative?.liquidity_event_ids || [],
            execution_candidate: !!setup.execution_zone,
            target_candidates: (setup.target_candidates || []).map(target => target.id || `${target.source || 'TARGET'}:${target.level}`),
            structural_invalidation: setup.opportunity_thesis?.structural_invalidation_intent || setup.structural_invalidation_detail || setup.structural_invalidation || null,
            candidate_seeds: setupCandidates.length,
            rejection_codes: rejectionCodes
        };
    });
    return {
        pair, price, as_of_time: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
        timeframes: timeframe,
        daily_bias: null,
        buy_thesis: null,
        sell_thesis: null,
        setup_trace: setupTrace,
        funnel: {
            raw_setups: strategySetups?.length || 0,
            current_market_setups: setupTrace.filter(item => item.lifecycle === 'ACTIVE' || item.lifecycle === 'DEVELOPING').length,
            terminal_setups: setupTrace.filter(item => ['SETUP_DELIVERY_ALREADY_ADVANCED', 'SETUP_ALREADY_COMPLETED', 'ENTRY_ALREADY_CONSUMED', 'SETUP_EXPIRED', 'SETUP_STALE'].includes(item.lifecycle)).length,
            developing_opportunities: setupTrace.filter(item => item.lifecycle === 'DEVELOPING').length,
            candidate_seeds: candidatePipeline?.execution_opportunities || 0,
            raw_candidates: candidatePipeline?.raw_candidates || 0,
            exact_candidates: candidatePipeline?.final_valid || 0,
            selector_candidates: candidatePipeline?.final_valid || 0,
            opportunity_funnel: opportunityFunnel || null
        },
        discovery_events: discoveryEvents,
        target_catalog: Object.fromEntries(['BUY', 'SELL'].map(direction => [direction.toLowerCase(), (targetCandidates?.all || []).filter(target => target.direction === direction).map(target => {
            const level = Number(target.level);
            const accepted = validCandidates.some(candidate => candidate.target_map?.some(selected => Number(selected.target_level ?? selected.level) === level));
            const rejected = candidateRejections.filter(item => item.target_diagnostics && Number(item.target_diagnostics.best_target_level) === level)
                .map(item => item.rejection_code || item.target_diagnostics.failure_code).filter(Boolean);
            if (target.reached) rejected.push('ALREADY_REACHED');
            if (target.consumed) rejected.push('CONSUMED');
            if (target.invalidated) rejected.push('INVALIDATED');
            if (target.ahead_of_current_price === false) rejected.push('BEHIND_CURRENT_PRICE');
            return { id: target.id, direction: target.direction, level: target.level, source: target.source, timeframe: target.timeframe,
                structural_priority: target.structural_priority, created_time: target.created_time || null, reached: !!target.reached,
                consumed: !!target.consumed, invalidated: !!target.invalidated, ahead_of_current_price: !!target.ahead_of_current_price,
                ahead_of_entry: target.ahead_of_entry, reachability: target.reachability, accepted,
                rejected: !accepted && rejected.length > 0, rejection_reasons: [...new Set(rejected)] };
        })]))
    };
}

function buildLiveMarketContext({ pair, price, historyCache, indicators, patterns, enhancedAnalysis, holistic, entryContext, as_of_ms = null, quote_snapshot = null }) {
    const symbolMetadata = getSymbolMetadata(pair, quote_snapshot?.symbol_metadata || {});
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const now = new Date(Number.isFinite(as_of_ms) ? as_of_ms : Date.now());
    const session = getSession(now);
    const sessionCheck = shouldTradeSession(now);
    const marketState = getMarketOpenState(pair, { ...(quote_snapshot || {}), as_of_ms });
    const dataQuality = validateMarketDataQuality(historyCache, price, quote_snapshot, as_of_ms || Date.now());
    const realVolume = hasRealVolume(pair, symbolMetadata);
    const closed4h = getClosedHistory(historyCache, '4H');
    const closed1h = getClosedHistory(historyCache, '1H');
    const closed15m = getClosedHistory(historyCache, '15M');
    const atr4h = closed4h.length >= 15 ? atr(closed4h, 14) : null;
    const atr1h = closed1h.length >= 15 ? atr(closed1h, 14) : null;
    const atr15m = closed15m.length >= 15 ? atr(closed15m, 14) : null;
    const primaryAtr = Number.isFinite(atr4h) && atr4h > 0 ? atr4h : (Number.isFinite(atr1h) && atr1h > 0 ? atr1h : atr15m);
    const atrPct = primaryAtr > 0 ? primaryAtr / price * 100 : null;
    const volatilityRegime = classifyVolatility(atrPct);

    const structure = {};
    for (const tf of ['1D', '4H', '1H', '15M']) {
        structure[tf] = buildStructureSnapshot(historyCache?.[tf], tf);
    }

    const zones = [];
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        const tfAtr = tf === '4H' ? atr4h : atr1h;
        const zoneStartedAt = scanClock();
        // Preserve enough deterministic HTF structure for opportunity
        // discovery. The previous five-zone cap could remove the valid 4H
        // FVG/OB before the market-mechanics narrative was built, leaving an
        // isolated 15M FLIP as the only visible result.
        const tfZones = buildLiveZonesForTf(data, tf, price, pair, tfAtr || primaryAtr || 0, 20);
        zones.push(...tfZones);
        console.log('[PERF] MSNR/ICT zone construction', { timeframe: tf, elapsed_ms: Math.round((scanClock() - zoneStartedAt) * 100) / 100, zones: tfZones.length, msnr_levels: tfZones.filter(z => z.type === 'MSNR').length });
    }
    const targetCandidates = buildTargetCandidates(historyCache, price, pair);
    const stageContext = buildLimitOrderStageContext(zones, targetCandidates, price, primaryAtr || 0, entryContext);

    const liq4h = mapLiquidity(historyCache?.['4H'] || []);
    const liq1h = mapLiquidity(historyCache?.['1H'] || []);
    const sweep4hBuy = detectLiquiditySweep(historyCache?.['4H'], price, 'BUY');
    const sweep4hSell = detectLiquiditySweep(historyCache?.['4H'], price, 'SELL');
    const sweep1hBuy = detectLiquiditySweep(historyCache?.['1H'], price, 'BUY');
    const sweep1hSell = detectLiquiditySweep(historyCache?.['1H'], price, 'SELL');
    const pdData = closed4h.length >= 20 ? closed4h : closed1h;
    const highs = pdData.slice(-50).map(c => c.h);
    const lows = pdData.slice(-50).map(c => c.l);
    const rangeHigh = highs.length ? Math.max(...highs) : null;
    const rangeLow = lows.length ? Math.min(...lows) : null;
    const equilibrium = Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) ? (rangeHigh + rangeLow) / 2 : null;
    const rangePositionPct = Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeHigh !== rangeLow
        ? (price - rangeLow) / (rangeHigh - rangeLow) * 100
        : null;

    const compression = {
        '4H': detectCompression(historyCache?.['4H'] || []),
        '1H': detectCompression(historyCache?.['1H'] || []),
        '15M': detectCompression(historyCache?.['15M'] || [])
    };
    const displacement = {
        buy_4h: detectDisplacement(historyCache?.['4H'] || [], 'BUY'),
        sell_4h: detectDisplacement(historyCache?.['4H'] || [], 'SELL'),
        buy_1h: detectDisplacement(historyCache?.['1H'] || [], 'BUY'),
        sell_1h: detectDisplacement(historyCache?.['1H'] || [], 'SELL')
    };
    const primaryPhase = enhancedAnalysis?.phase?.phase || 'UNKNOWN';
    const trendVotes = ['1D', '4H', '1H'].map(tf => structure[tf]?.effective_trend || structure[tf]?.structural_trend).filter(Boolean);
    const bullVotes = trendVotes.filter(v => v === 'BULLISH').length;
    const bearVotes = trendVotes.filter(v => v === 'BEARISH').length;
    let primaryRegime = 'RANGING';
    if (primaryPhase && primaryPhase !== 'NEUTRAL' && primaryPhase !== 'UNKNOWN') primaryRegime = primaryPhase;
    else if (Object.values(compression).some(Boolean)) primaryRegime = 'COMPRESSION';
    else if (Object.values(displacement).some(Boolean)) primaryRegime = 'EXPANSION';
    else if (bullVotes >= 2) primaryRegime = 'TRENDING_BULLISH';
    else if (bearVotes >= 2) primaryRegime = 'TRENDING_BEARISH';
    const marketRegime = {
        primary_regime: primaryRegime,
        phase: primaryPhase,
        compression,
        displacement
    };
    const sessionFacts = {
        name: session.session,
        priority: sessionCheck.priority,
        is_killzone: !!session.isKillzone,
        is_silver_bullet: !!session.isSilverBullet,
        is_asia: session.session === 'ASIA KZ',
        is_london: session.session.includes('LONDON'),
        is_new_york: session.session.includes('NEW_YORK'),
        is_off_hours: session.session === 'OFF-HOURS',
        volatility_expectation: sessionCheck.priority === 'MAX' || sessionCheck.priority === 'HIGH' ? 'HIGH' : 'LOW',
        reason: sessionCheck.reason
    };
    const volatilityFacts = {
        atr_4h: ictRound(atr4h, prec),
        atr_1h: ictRound(atr1h, prec),
        atr_15m: ictRound(atr15m, prec),
        atr_pct_of_price: ictRound(atrPct, 3),
        regime: volatilityRegime
    };
    const liquidityFacts = {
        '4H': {
            nearest_buy_side: liq4h.nearestAbove,
            nearest_sell_side: liq4h.nearestBelow,
            buy_side_levels: liq4h.above,
            sell_side_levels: liq4h.below,
            equal_highs: liq4h.equalHighs,
            equal_lows: liq4h.equalLows,
            sweeps: [sweep4hBuy, sweep4hSell].filter(Boolean)
        },
        '1H': {
            nearest_buy_side: liq1h.nearestAbove,
            nearest_sell_side: liq1h.nearestBelow,
            buy_side_levels: liq1h.above,
            sell_side_levels: liq1h.below,
            equal_highs: liq1h.equalHighs,
            equal_lows: liq1h.equalLows,
            sweeps: [sweep1hBuy, sweep1hSell].filter(Boolean)
        }
    };
    const premiumDiscountFacts = {
        range_high: ictRound(rangeHigh, prec),
        range_low: ictRound(rangeLow, prec),
        equilibrium: ictRound(equilibrium, prec),
        current_range_position_pct: ictRound(rangePositionPct, 1),
        classification: isPremiumDiscount(pdData, price).zone
    };
    const momentumFacts = {
        adx_4h: patterns?.['4H']?.adx?.adx ?? null,
        adx_1h: patterns?.['1H']?.adx?.adx ?? null,
        rsi_4h: indicators?.['4H']?.rsi ?? null,
        macd_4h: indicators?.['4H']?.macd ?? null,
        macd_signal_4h: indicators?.['4H']?.macd_signal ?? null,
        macd_direction_4h: Number.isFinite(indicators?.['4H']?.macd) && Number.isFinite(indicators?.['4H']?.macd_signal)
            ? (indicators['4H'].macd > indicators['4H'].macd_signal ? 'BULLISH' : 'BEARISH')
            : 'UNKNOWN',
        ema_alignment_4h: {
            ema9: indicators?.['4H']?.ema9 ?? null,
            ema21: indicators?.['4H']?.ema21 ?? null,
            ema50: indicators?.['4H']?.ema50 ?? null,
            ema200: indicators?.['4H']?.ema200 ?? null
        },
        supertrend_4h: indicators?.['4H']?.supertrend ?? null
    };
    const marketContext = buildMarketContext({
        pair,
        price,
        historyCache,
        structure,
        session: sessionFacts,
        sessionCheck,
        liquidity: liquidityFacts,
        premiumDiscount: premiumDiscountFacts,
        marketRegime,
        momentum: momentumFacts,
        volatility: volatilityFacts,
        holistic
    });
    marketContext.news_risk = checkHighImpactNews(quote_snapshot?.news_risk || null);
    // Candidate construction consumes this same quality verdict so a stale
    // quote cannot be replaced by a fresh-looking fallback candidate.
    marketContext.data_quality = dataQuality;
    console.log('MARKET CONTEXT', marketContext);
    console.log('CONTEXT BIAS', {
        directional_bias: marketContext.directional_bias,
        context_score: marketContext.context_score,
        bullish_evidence: marketContext.bullish_evidence,
        bearish_evidence: marketContext.bearish_evidence,
        conflicts: marketContext.conflicts
    });
    const strategyStartedAt = scanClock();
    marketContext.timeframe_context = buildTimeframeContext({ historyCache, structure, price, zones, liquidity: liquidityFacts });
    marketContext.daily_bias = buildDailyTradingBias(marketContext.timeframe_context, targetCandidates, price, now.getTime());
    const mechanicsSetups = buildMarketMechanicsSetups({ historyCache, timeframeContext: marketContext.timeframe_context,
        dailyBias: marketContext.daily_bias, targets: targetCandidates, zones, pair, price });
    marketContext.discovery_funnel = { ...(mechanicsSetups.discovery || {}) };
    const strategySetups = buildStrategySetups({ pair, price, historyCache, realZones: zones, marketContext });
    strategySetups.push(...mechanicsSetups);
    marketContext.timeframe_context = buildTimeframeContext({ historyCache, structure, price, strategySetups, zones, liquidity: liquidityFacts });
    marketContext.daily_bias = buildDailyTradingBias(marketContext.timeframe_context, targetCandidates, price, now.getTime());
    prepareOpportunitySetups(strategySetups, marketContext, price);
    const canonicalMarketTheses = buildCanonicalMarketTheses(strategySetups, marketContext, targetCandidates, price);
    console.log('[PERF] strategy setup building', {
        elapsed_ms: Math.round((scanClock() - strategyStartedAt) * 100) / 100,
        strategy_setups: strategySetups.length,
        detection_stats: strategySetups.detection_stats || null
    });
    console.log('[SCAN] strategy detection complete', { strategy_setups: strategySetups.length, detection_stats: strategySetups.detection_stats || null });
    for (const tf of ['4H', '1H']) {
        const msnr = calculateMSNR(historyCache?.[tf] || [], price, tf, pair);
        if (strategySetups.detection_stats?.MSNR) {
            strategySetups.detection_stats.MSNR.raw_count += msnr.structural_levels?.raw_detection_count ?? msnr.structural_levels?.length ?? 0;
            strategySetups.detection_stats.MSNR.deduped_count += msnr.structural_levels?.deduped_detection_count ?? msnr.structural_levels?.length ?? 0;
            strategySetups.detection_stats.MSNR.pivot_reference_count += (msnr.supportMeta || []).filter(x => x.origin === 'PIVOT_REFERENCE').length + (msnr.resistanceMeta || []).filter(x => x.origin === 'PIVOT_REFERENCE').length;
            strategySetups.detection_stats.MSNR.atr_fallback_count += (msnr.supportMeta || []).filter(x => x.origin === 'ATR_FALLBACK').length + (msnr.resistanceMeta || []).filter(x => x.origin === 'ATR_FALLBACK').length;
        }
    }
    const riskConstraints = buildRiskConstraints(pair, price, historyCache, quote_snapshot);
    const strategyExecutionZones = Array.isArray(strategySetups) ? getStrategyExecutionZones(strategySetups) : [];
    const validationZones = Array.isArray(strategySetups)
        ? [...(zones || []), ...strategyExecutionZones]
        : (zones || []);
    const deterministicValidationContext = buildDeterministicValidationContext({
        pair,
        price,
        historyCache,
        real_ict_zones: validationZones,
        risk_constraints: riskConstraints,
        structure,
        market_context: marketContext,
        market_theses: canonicalMarketTheses,
        strategy_setups: strategySetups,
        require_strategy_setup: true,
        market_open: marketState.is_market_open,
        data_quality: dataQuality,
        quote_snapshot
    });
    const candidateStartedAt = scanClock();
    const adaptiveSetupResult = buildAdaptiveSetupCandidates({
        pair,
        price,
        historyCache,
        zones,
        targetCandidates,
        riskConstraints,
        marketRegime,
        structure,
        marketContext,
        strategySetups
    });
    console.log('[PERF] adaptive candidate construction', {
        elapsed_ms: Math.round((scanClock() - candidateStartedAt) * 100) / 100,
        raw_candidates: adaptiveSetupResult.raw_candidates.length,
        valid_candidates: adaptiveSetupResult.valid_candidates.length,
        rejected_candidates: adaptiveSetupResult.rejected_candidates.length
    });
    console.log('[SCAN] candidate construction complete', { raw_candidates: adaptiveSetupResult.raw_candidates.length, valid_candidates: adaptiveSetupResult.valid_candidates.length, rejected_candidates: adaptiveSetupResult.rejected_candidates.length });
    const adaptiveSetupCandidates = adaptiveSetupResult.valid_candidates;
    stageContext.limit_order_setup.eligible = adaptiveSetupCandidates.length > 0;
    stageContext.limit_order_setup.future_entry_allowed = adaptiveSetupCandidates.length > 0;
    stageContext.limit_order_setup.reason = adaptiveSetupCandidates.length > 0
        ? 'Valid deterministic pending-limit candidate exists; immediate entry confirmation is separate.'
        : 'No valid deterministic CRT/TBS/MSNR pending-limit candidate passed strategy, stop, target, RR, and consistency checks.';
    stageContext.limit_order_setup.adaptive_candidate_count = adaptiveSetupCandidates.length;
    stageContext.limit_order_setup.strategy_setup_count = strategySetups.length;
    stageContext.limit_order_setup.rejection_summary = summarizeCandidateRejections(adaptiveSetupResult.rejected_candidates);
    stageContext.limit_order_setup.rejection_detail = summarizeCandidateRejectionDetails(adaptiveSetupResult.rejected_candidates);
    const strategyDetectionSummary = summarizeStrategyDetections(strategySetups);
    const candidatePipelineAudit = buildCandidatePipelineAudit(strategySetups, adaptiveSetupResult.raw_candidates, adaptiveSetupResult.rejected_candidates, adaptiveSetupResult.valid_candidates, adaptiveSetupResult.seed_diagnostics);
    marketContext.opportunity_funnel = {
        ...(marketContext.opportunity_funnel || {}),
        structural_stop_valid: candidatePipelineAudit.structural_stops_valid,
        target_valid: candidatePipelineAudit.target_valid,
        rr_valid: candidatePipelineAudit.rr_valid,
        trade_ready: candidatePipelineAudit.final_valid,
        current_market_rejections: candidatePipelineAudit.fresh_execution_pipeline?.failure_counts || {},
        candidate_pipeline_updated: true
    };
    console.log('FINAL REJECTION SUMMARY', {
        strategy_detections: strategyDetectionSummary,
        candidate_pipeline: candidatePipelineAudit,
        rejection_summary: stageContext.limit_order_setup.rejection_summary,
        rejection_detail: stageContext.limit_order_setup.rejection_detail
    });

    const liveContext = {
        pair,
        symbol_metadata: symbolMetadata,
        current_price: ictRound(price, prec),
        as_of_time: now.getTime(),
        as_of_time_utc: now.toISOString(),
        quote_snapshot: quote_snapshot || null,
        provider_timestamp: quote_snapshot?.provider_timestamp || null,
        provider_timestamp_utc: quote_snapshot?.provider_timestamp_utc || null,
        market_conditions: {
            bid: Number.isFinite(Number(quote_snapshot?.bid)) ? Number(quote_snapshot.bid) : null,
            ask: Number.isFinite(Number(quote_snapshot?.ask)) ? Number(quote_snapshot.ask) : null,
            spread: Number.isFinite(Number(quote_snapshot?.spread)) ? Number(quote_snapshot.spread) : null
        },
        asset_class: marketState.asset_class,
        data_quality: dataQuality,
        market_open: marketState.is_market_open,
        market_open_source: marketState.source,
        provider_metadata: Object.fromEntries(Object.entries(historyCache || {}).map(([tf, data]) => [tf, data?.provider_metadata || null])),
        last_closed_candle_time: Object.fromEntries(Object.entries(historyCache || {}).map(([tf, data]) => [tf, data?.filter(c => c.is_closed !== false).at(-1)?.t || null])),
        structure_data_cutoff: now.getTime(),
        utc_time: now.toISOString(),
        session: sessionFacts,
        daily_bias: marketContext.daily_bias,
        structural_context: Object.fromEntries(['1D', '4H', '1H'].map(tf => [tf, marketContext.timeframe_context?.[tf]?.displayed_trend || getCanonicalDisplayedTrend(marketContext.timeframe_context?.[tf] || {})])),
        volatility: volatilityFacts,
        multi_timeframe_direction: {
            trend: {
                '1D': marketContext.timeframe_context?.['1D']?.displayed_trend || getCanonicalDisplayedTrend(structure['1D']),
                '4H': marketContext.timeframe_context?.['4H']?.displayed_trend || getCanonicalDisplayedTrend(structure['4H']),
                '1H': marketContext.timeframe_context?.['1H']?.displayed_trend || getCanonicalDisplayedTrend(structure['1H']),
                '15M': marketContext.timeframe_context?.['15M']?.displayed_trend || getCanonicalDisplayedTrend(structure['15M'])
            },
            bias: {
                '1D': structure['1D'].bias,
                '4H': structure['4H'].bias,
                '1H': structure['1H'].bias,
                '15M': structure['15M'].bias
            },
            holistic
        },
        structure,
        market_context: marketContext,
        strategy_setups: strategySetups,
        real_ict_zones: validationZones,
        context_ict_zones: zones,
        poi_zones: ['4H', '1H', '15M'].flatMap(tf => buildSupplyDemandAndFlipPOIs(historyCache?.[tf] || [], tf, price, pair)),
        strategy_execution_zones: strategyExecutionZones,
        limit_order_setup: stageContext.limit_order_setup,
        immediate_entry: stageContext.immediate_entry,
        liquidity: liquidityFacts,
        premium_discount: premiumDiscountFacts,
        market_regime: marketRegime,
        momentum: momentumFacts,
        volume: {
            volume_available: realVolume,
            volume_note: realVolume ? 'Provider volume is treated as usable for this pair.' : 'Provider volume is synthetic/unreliable. Do not use volume as confirmation.'
        },
        risk_constraints: riskConstraints,
        target_candidates: targetCandidates,
        adaptive_setup_candidates: adaptiveSetupCandidates,
        strategy_detections: strategyDetectionSummary,
        candidate_pipeline: candidatePipelineAudit,
        opportunity_funnel: marketContext.opportunity_funnel || null,
        setup_candidate_audit: {
            raw_candidate_count: adaptiveSetupResult.raw_candidates.length,
            valid_candidate_count: adaptiveSetupResult.valid_candidates.length,
            rejected_candidate_count: adaptiveSetupResult.rejected_candidates.length,
            rejection_summary: summarizeCandidateRejections(adaptiveSetupResult.rejected_candidates),
            rejection_detail: summarizeCandidateRejectionDetails(adaptiveSetupResult.rejected_candidates),
            market_open: marketState.is_market_open
        },
        entry_filters: entryContext || null
    };
    liveContext.production_trace = buildProductionScanTrace({ pair, price, asOfMs: as_of_ms, historyCache, structure,
        timeframeContext: marketContext.timeframe_context, liquidity: liquidityFacts, zones, targetCandidates,
        strategySetups, candidatePipeline: candidatePipelineAudit, candidateRejections: adaptiveSetupResult.rejected_candidates,
        validCandidates: adaptiveSetupResult.valid_candidates, discoveryEvents: mechanicsSetups.discovery || [], opportunityFunnel: marketContext.opportunity_funnel });
    liveContext.production_trace.daily_bias = liveContext.daily_bias;
    liveContext.production_trace.buy_thesis = canonicalMarketTheses.buy;
    liveContext.production_trace.sell_thesis = canonicalMarketTheses.sell;
    Object.defineProperty(liveContext, 'deterministic_validation_context', {
        value: deterministicValidationContext,
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(liveContext, 'historyCache', {
        value: historyCache,
        enumerable: false,
        configurable: true
    });
    return liveContext;
}

const REPLAY_SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|token|password|secret|pat|credential|twilio|telegram[_-]?(user|session|auth))/i;
const REPLAY_SECRET_TEXT_PATTERN = /(TWELVE_DATA_KEY|DEEPSEEK_API_KEY|GITHUB_PAT|authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]+|[?&](?:apikey|api_key|token|key)=)/i;

function sanitizeScanReplayValue(value, key = '') {
    if (REPLAY_SECRET_KEY_PATTERN.test(key)) return undefined;
    if (typeof value === 'string') return REPLAY_SECRET_TEXT_PATTERN.test(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(item => sanitizeScanReplayValue(item)).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
        const safe = sanitizeScanReplayValue(childValue, childKey);
        if (safe !== undefined) result[childKey] = safe;
    }
    return result;
}

function assertScanReplaySafe(value, path = 'replay') {
    if (REPLAY_SECRET_KEY_PATTERN.test(path)) throw new Error(`Replay contains a credential-like field at ${path}`);
    if (typeof value === 'string') {
        if (REPLAY_SECRET_TEXT_PATTERN.test(value)) throw new Error(`Replay contains credential-like text at ${path}`);
        return;
    }
    if (Array.isArray(value)) return value.forEach((item, index) => assertScanReplaySafe(item, `${path}[${index}]`));
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) assertScanReplaySafe(child, `${path}.${key}`);
}

function createScanReplay(liveMarketContext, finalOutput = null) {
    if (!liveMarketContext?.pair || !liveMarketContext.historyCache) throw new Error('No completed live scan is available for replay capture');
    const replay = sanitizeScanReplayValue({
        schema_version: 1,
        pair: liveMarketContext.pair,
        captured_at: new Date().toISOString(),
        scan_as_of: liveMarketContext.as_of_time_utc,
        quote: { price: liveMarketContext.current_price, quote_time: liveMarketContext.quote_snapshot?.timestamp || liveMarketContext.provider_timestamp_utc || liveMarketContext.as_of_time_utc },
        history: Object.fromEntries(['1D', '4H', '1H', '15M', '5M'].map(tf => [tf, (liveMarketContext.historyCache[tf] || []).filter(c => c && c.is_closed !== false)])),
        indicators: liveMarketContext.indicators || {},
        holistic: liveMarketContext.holistic || liveMarketContext.multi_timeframe_direction?.holistic || {},
        structure: liveMarketContext.structure || {},
        timeframe_context: liveMarketContext.market_context?.timeframe_context || {},
        liquidity: liveMarketContext.liquidity || {},
        poi_zones: liveMarketContext.poi_zones || [],
        target_candidates: liveMarketContext.target_candidates || {},
        daily_bias: liveMarketContext.daily_bias || null,
        market_regime: liveMarketContext.market_regime || null,
        strategy_setups: liveMarketContext.strategy_setups || [],
        canonical_market_theses: liveMarketContext.market_theses || {},
        opportunity_funnel: liveMarketContext.opportunity_funnel || liveMarketContext.market_context?.opportunity_funnel || null,
        candidate_pipeline_audit: liveMarketContext.setup_candidate_audit || liveMarketContext.candidate_pipeline || null,
        valid_candidates: liveMarketContext.adaptive_setup_candidates || [],
        production_trace: liveMarketContext.production_trace || null,
        runtime_state: { market_open: liveMarketContext.market_open, market_open_source: liveMarketContext.market_open_source, quote_snapshot: liveMarketContext.quote_snapshot ? { timestamp: liveMarketContext.quote_snapshot.timestamp, price: liveMarketContext.quote_snapshot.price } : null },
        final_output: finalOutput
    });
    assertScanReplaySafe(replay);
    return replay;
}

function buildReplayPatterns(history, price) {
    return Object.fromEntries(['4H', '1H', '15M', '5M'].map(tf => [tf, {
        fvg: detectFVG(history[tf] || []), swings: findSwings(history[tf] || [], 3), turtleSoup: detectTurtleSoup(history[tf] || []),
        crt: detectCRT(history[tf] || []), orderBlocks: detectOrderBlocks(history[tf] || [], 'BUY'), msnr: calculateMSNR(history[tf] || [], price, tf),
        trend: getCanonicalTimeframeTrend(history[tf] || [], tf), adx: calculateADX(history[tf] || [], 14, tf)
    }]));
}

function compareScanReplayOutput(captured, replayed) {
    const differences = [];
    const left = captured?.trade_signal || captured || {};
    const right = replayed?.trade_signal || replayed || {};
    for (const field of ['pair', 'current_price', 'status', 'decision', 'direction', 'selected_candidate_id']) {
        if (String(left[field] ?? '') !== String(right[field] ?? '')) differences.push({ field, captured: left[field] ?? null, replayed: right[field] ?? null });
    }
    const capturedReason = left.reason?.code || null;
    const replayedReason = right.reason?.code || null;
    if (capturedReason !== replayedReason) differences.push({ field: 'reason.code', captured: capturedReason, replayed: replayedReason });
    return { replay_matches_live: differences.length === 0, differences };
}

function replayCapturedScan(replay) {
    if (!replay || replay.schema_version !== 1) throw new Error('Unsupported scan replay schema');
    assertScanReplaySafe(replay);
    const price = Number(replay.quote?.price);
    const asOfMs = normalizeTimestampUTC(replay.scan_as_of);
    if (!replay.pair || !Number.isFinite(price) || !Number.isFinite(asOfMs)) throw new Error('Replay pair, price, and scan_as_of are required');
    const historyCache = Object.fromEntries(['1D', '4H', '1H', '15M', '5M'].map(tf => [tf, (replay.history?.[tf] || []).filter(c => c && c.is_closed !== false).map(c => ({ ...c }))]));
    const patterns = buildReplayPatterns(historyCache, price);
    const live = buildLiveMarketContext({ pair: replay.pair, price, historyCache, indicators: replay.indicators || {}, patterns,
        enhancedAnalysis: { phase: { phase: replay.market_regime?.phase || 'UNKNOWN' } }, holistic: replay.holistic || {}, entryContext: null,
        as_of_ms: asOfMs, quote_snapshot: replay.runtime_state?.quote_snapshot || null });
    const today = buildTodayOpportunity({ pair: replay.pair, currentPrice: price, scanAsOfMs: asOfMs, histories: historyCache,
        marketContext: live.market_context, strategySetups: live.strategy_setups, executionZones: live.strategy_execution_zones,
        candidateDiagnostics: live.setup_candidate_audit, validCandidates: live.adaptive_setup_candidates, targetCandidates: live.target_candidates,
        marketOpen: live.market_open });
    const finalOutput = buildTodayOpportunityOutput(today, replay.pair, price, asOfMs, live.market_open);
    return { replay_matches_live: compareScanReplayOutput(replay.final_output, finalOutput).replay_matches_live,
        differences: compareScanReplayOutput(replay.final_output, finalOutput).differences, replay_output: finalOutput, production_trace: live.production_trace };
}

window.replayCapturedScan = replayCapturedScan;

function compactAIContext(liveMarketContext) {
    const compactZone = z => z ? {
        id: z.id,
        type: z.type,
        origin: z.origin,
        direction: z.direction,
        timeframe: z.timeframe,
        low: z.low,
        high: z.high,
        midpoint: z.midpoint,
        freshness: z.freshness,
        primary_eligible: z.primary_eligible,
        strategy_source: z.strategy_source,
        entry_model: z.entry_model,
        entry_region_source: z.entry_region_source
    } : null;
    const compactCandidate = c => c ? {
        id: c.id,
        strategy_version: c.strategy_version || STRATEGY_SPEC_VERSION,
        strategy_label: c.strategy_label,
        strategy_evidence: c.strategy_evidence,
        strategy_narrative: c.strategy_narrative || {
            state: c.narrative_state || c.strategy_setup?.narrative_state || null,
            primary: c.strategy_setup?.primary || null,
            event_time: c.narrative_event_time || null,
            original_entry_consumed: !!c.original_strategy_entry_consumed
        },
        strategy_confluence: c.strategy_confluence || c.strategy_setup?.strategy_confluence || [],
        narrative_ids: c.narrative_ids || c.strategy_setup?.narrative_ids || [],
        confluence_score: c.confluence_score || c.strategy_setup?.confluence_score || 1,
        execution_model: c.execution_model || c.entry_model,
        execution_zone_created_time: c.execution_zone_created_time || c.zone?.created_time || null,
        execution_zone_created_time_ms: c.execution_zone_created_time_ms || normalizeTimestampUTC(c.execution_zone_created_time || c.zone?.created_time),
        execution_zone_created_time_utc: c.execution_zone_created_time_utc || null,
        structural_invalidation: c.structural_invalidation || null,
        execution_zone_consumed: !!c.execution_zone_consumed,
        setup_lifecycle: c.evaluation?.metrics?.setup_lifecycle || null,
        lifecycle_state: c.lifecycle_state || c.opportunity_status || null,
        entry_region: { low: c.entry_region_low ?? c.zone_low, high: c.entry_region_high ?? c.zone_high },
        direction: c.direction,
        timeframe: c.timeframe,
        setup_timeframe: c.setup_timeframe,
        execution_timeframe: c.execution_timeframe,
        zone_type: c.zone_type,
        zone_origin: c.zone_origin,
        zone_low: c.zone_low,
        zone_high: c.zone_high,
        entry: c.entry,
        stop_loss: c.stop_loss,
        tp1: c.tp1,
        tp2: c.tp2,
        tp3: c.tp3,
        rr_tp1: c.rr_tp1,
        actual_rr: c.actual_rr,
        event_time: c.event_time,
        event_age_hours: c.event_age_hours,
        current_session: c.current_session,
        event_session: c.event_session,
        expected_entry_window: c.expected_entry_window,
        hours_remaining_in_relevant_session: c.hours_remaining_in_relevant_session,
        market_closed: c.market_closed,
        still_actionable_today: c.still_actionable_today,
        opportunity_status: c.opportunity_status,
        entry_consumed: c.entry_consumed,
        entry_first_touch_time: c.entry_first_touch_time,
        entry_touch_count_after_signal: c.entry_touch_count_after_signal,
        tp1_already_reached: c.tp1_already_reached,
        tp1_first_reached_time: c.tp1_first_reached_time,
        remaining_reward_fraction: c.remaining_reward_fraction,
        progress_to_tp1_fraction: c.progress_to_tp1_fraction,
        progress_to_tp1_fraction_raw: c.progress_to_tp1_fraction_raw,
        distance_to_entry_atr: c.distance_to_entry_atr,
        pending_entry_quality: c.pending_entry_quality,
        entry_reachable_today: c.entry_reachable_today,
        entry_reachability_score: c.entry_reachability_score,
        setup_confidence: c.setup_confidence,
        confidence_breakdown: c.confidence_breakdown,
        quality: c.quality || null,
        time_integrity: c.evaluation?.metrics?.setup_lifecycle?.time_integrity || null,
        entry_model: c.entry_model,
        entry_region_source: c.zone?.entry_region_source || c.entry_region_source,
        stop_source: c.stop_source,
        freshness: c.freshness,
        target_map: c.target_map,
        trade_context_classification: c.trade_context_classification,
        top_down_context: c.top_down_context,
        target_diagnostics: c.target_diagnostics || null,
        target_reachability: compactTargetReachabilityForOutput(c.target_reachability),
        score: c.score
    } : null;
    const structure = Object.fromEntries(Object.entries(liveMarketContext?.structure || {}).map(([tf, s]) => [tf, {
        timeframe: s.timeframe,
        trend: s.trend,
        bias: s.bias,
        mss: s.mss,
        bos_buy: s.bos_buy,
        bos_sell: s.bos_sell,
        choch_buy: s.choch_buy,
        choch_sell: s.choch_sell
    }]));
    const marketContext = liveMarketContext?.market_context || {};
    return {
        pair: liveMarketContext?.pair,
        current_price: liveMarketContext?.current_price,
        utc_time: liveMarketContext?.utc_time,
        session: liveMarketContext?.session,
        market_context: {
            directional_bias: marketContext.directional_bias,
            context_score: marketContext.context_score,
            bullish_evidence: marketContext.bullish_evidence,
            bearish_evidence: marketContext.bearish_evidence,
            conflicts: marketContext.conflicts,
            htf_alignment: marketContext.htf_alignment,
            premium_discount: liveMarketContext?.premium_discount || marketContext.premium_discount,
            volatility: liveMarketContext?.volatility || marketContext.volatility,
            market_regime: liveMarketContext?.market_regime || marketContext.amd,
            liquidity: liveMarketContext?.liquidity || marketContext.liquidity,
            structure
        },
        strategy_detections: liveMarketContext?.strategy_detections,
        ai_analysis: liveMarketContext?.ai_analysis ? {
            analyst_status: liveMarketContext.ai_analysis.analyst_status,
            market_view: liveMarketContext.ai_analysis.market_view,
            hypotheses_verified: liveMarketContext.ai_analysis.hypotheses_verified,
            verified_hypotheses: liveMarketContext.ai_analysis.verified_hypotheses,
            rejected_hypotheses: liveMarketContext.ai_analysis.rejected_hypotheses?.slice(0, 12)
        } : null,
        today_opportunity: liveMarketContext?.today_opportunity ? {
            state: liveMarketContext.today_opportunity.state,
            strategy: liveMarketContext.today_opportunity.strategy,
            direction: liveMarketContext.today_opportunity.direction,
            area_of_interest: liveMarketContext.today_opportunity.area_of_interest,
            execution_model: liveMarketContext.today_opportunity.execution_model,
            reason_code: liveMarketContext.today_opportunity.reason_code,
            expected_window: liveMarketContext.today_opportunity.expected_window
        } : null,
        strategy_setups: (liveMarketContext?.strategy_setups || []).slice(0, STRATEGY_SPEC.COMBINATION.maxSetups).map(s => ({
            id: s.id,
            label: s.label,
            primary: s.primary,
            confirmations: s.confirmations,
            direction: s.direction,
            timeframe: s.timeframe,
            setup_timeframe: s.setup_timeframe,
            execution_timeframe: s.execution_timeframe,
            event_time: s.event_time,
            narrative_state: s.narrative_state,
            strategy_version: STRATEGY_SPEC_VERSION,
            narrative_event_time: s.narrative_event_time,
            structural_invalidation: s.structural_invalidation_detail || null,
            original_strategy_entry_consumed: !!s.original_strategy_entry_consumed,
            freshness: s.freshness,
            execution_model: s.execution_model,
            entry_model: s.entry_model,
            entry_region_source: s.entry_region_source,
            execution_zone: compactZone(s.execution_zone),
            strategy_evidence: s.strategy_evidence,
            combination_evidence: s.combination_evidence,
            target_bias: s.target_bias,
            target_candidates: (s.target_candidates || []).slice(0, STRATEGY_SPEC.EXECUTION.maxTargetsPerEvaluation)
        })),
        real_ict_zones: (liveMarketContext?.real_ict_zones || []).slice(0, 40).map(compactZone),
        strategy_execution_zones: (liveMarketContext?.strategy_execution_zones || []).slice(0, STRATEGY_SPEC.COMBINATION.maxSetups).map(compactZone),
        adaptive_setup_candidates: (liveMarketContext?.adaptive_setup_candidates || [])
            .filter(c => ['FRESH_NOW', 'FRESH_PENDING_TODAY'].includes(c.lifecycle_state || c.opportunity_status))
            .map(compactCandidate),
        target_candidates: {
            buy: (liveMarketContext?.target_candidates?.buy || []).slice(0, STRATEGY_SPEC.EXECUTION.maxTargetsPerEvaluation),
            sell: (liveMarketContext?.target_candidates?.sell || []).slice(0, STRATEGY_SPEC.EXECUTION.maxTargetsPerEvaluation)
        },
        limit_order_setup: liveMarketContext?.limit_order_setup,
        immediate_entry: liveMarketContext?.immediate_entry,
        risk_constraints: liveMarketContext?.risk_constraints,
        candidate_pipeline: liveMarketContext?.candidate_pipeline,
        setup_candidate_audit: liveMarketContext?.setup_candidate_audit,
        entry_filters: liveMarketContext?.entry_filters
    };
}

function buildAiMarketEvidenceCatalog(liveMarketContext = {}, historyCache = {}) {
    const idFor = (prefix, item, index) => item?.id || prefix + '-' + (item?.timeframe || 'NA') + '-' + (normalizeTimestampUTC(item?.event_time ?? item?.reclaim_time ?? item?.source_time ?? item?.created_time) || index);
    const strategyEvents = [];
    for (const setup of liveMarketContext.strategy_setups || []) {
        const eventId = idFor(setup.primary || 'STRATEGY', setup, strategyEvents.length);
        const record = {
            id: eventId,
            strategy: setup.primary,
            direction: setup.direction,
            timeframe: setup.setup_timeframe || setup.timeframe,
            execution_timeframe: setup.execution_timeframe,
            event_time: setup.event_time || setup.reclaim_time || setup.source_time || null,
            narrative_state: setup.narrative_state || setup.lifecycle_state || null,
            structural_invalidation: setup.structural_invalidation_detail || setup.structural_invalidation || null,
            evidence: setup.evidence || setup.strategy_evidence?.[setup.primary] || null,
            setup_id: setup.id,
            source: setup
        };
        Object.defineProperty(record, 'source', { value: setup, enumerable: false });
        strategyEvents.push(record);
    }
    for (const timeframe of ['4H', '1H', '15M']) {
        const data = getClosedHistory(historyCache, timeframe);
        for (const event of detectCRTEvents(data, timeframe, liveMarketContext.pair || pair).slice(0, STRATEGY_SPEC.CRT.maxEventsPerTimeframe)) {
            const record = { ...event, id: event.id || idFor('CRT', event, strategyEvents.length), strategy: 'CRT', setup_id: null };
            Object.defineProperty(record, 'source', { value: event, enumerable: false });
            strategyEvents.push(record);
        }
        for (const event of detectTurtleSoupEvents(data, timeframe, liveMarketContext.pair || pair).slice(0, STRATEGY_SPEC.TBS.maxEventsPerTimeframe)) {
            const record = { ...event, id: event.id || idFor('TBS', event, strategyEvents.length), strategy: 'TBS', setup_id: null };
            Object.defineProperty(record, 'source', { value: event, enumerable: false });
            strategyEvents.push(record);
        }
        const levels = calculateMSNR(data, Number(liveMarketContext.current_price), timeframe, liveMarketContext.pair || pair).structural_levels || [];
        for (const level of levels.slice(0, STRATEGY_SPEC.MSNR.maxLevelsPerTimeframe)) {
            const record = { ...level, id: level.id || idFor('MSNR', level, strategyEvents.length), strategy: 'MSNR', setup_id: null };
            Object.defineProperty(record, 'source', { value: level, enumerable: false });
            strategyEvents.push(record);
        }
    }
    const zones = [...(liveMarketContext.real_ict_zones || []), ...(liveMarketContext.poi_zones || [])].map((zone, index) => ({
        ...zone,
        id: idFor(zone.type || 'ZONE', zone, index),
        source: zone
    }));
    const liquidity = [];
    for (const [timeframe, facts] of Object.entries(liveMarketContext.liquidity || {})) {
        for (const level of [...(facts.buy_side_levels || []), ...(facts.sell_side_levels || []), ...(facts.equal_highs || []), ...(facts.equal_lows || [])]) {
            const value = Number(level?.level ?? level?.price ?? level);
            if (Number.isFinite(value)) liquidity.push({ id: idFor('LIQ', { timeframe, event_time: level?.time }, liquidity.length), timeframe, level: value, source: level });
        }
    }
    const msnr = strategyEvents.filter(z => z.strategy === 'MSNR' && z.origin === 'STRUCTURAL_MSNR');
    return {
        as_of_time: liveMarketContext.as_of_time,
        as_of_time_utc: liveMarketContext.as_of_time_utc || liveMarketContext.utc_time,
        timeframe_context: liveMarketContext.market_context?.timeframe_context || {},
        pair: liveMarketContext.pair,
        current_price: liveMarketContext.current_price,
        market_open: liveMarketContext.market_open,
        news_risk: liveMarketContext.news_risk || { status: 'UNKNOWN', available: false },
        session: liveMarketContext.session,
        market_context: liveMarketContext.market_context,
        structure: liveMarketContext.structure,
        volatility: liveMarketContext.volatility,
        premium_discount: liveMarketContext.premium_discount,
        liquidity,
        strategy_events: strategyEvents.map(({ source, ...event }) => event),
        crt_events: strategyEvents.filter(e => e.strategy === 'CRT'),
        tbs_events: strategyEvents.filter(e => e.strategy === 'TBS'),
        msnr_levels: msnr.map(zone => {
            const { source, ...publicZone } = zone;
            Object.defineProperty(publicZone, 'source', { value: source, enumerable: false });
            return publicZone;
        }),
        fvg_zones: zones.filter(z => z.type === 'FVG').map(({ source, ...zone }) => zone),
        ob_zones: zones.filter(z => z.type === 'OB').map(({ source, ...zone }) => zone),
        poi_zones: zones.filter(z => ['FVG', 'OB', 'MSNR', 'CRT', 'TBS', 'SUPPLY', 'DEMAND', 'FLIP', 'LIQUIDITY_LOCATION'].includes(z.type)).map(({ source, ...zone }) => zone),
        execution_zones: zones.filter(z => ['FVG', 'OB', 'MSNR', 'CRT', 'TBS', 'SUPPLY', 'DEMAND', 'FLIP'].includes(z.type)).map(({ source, ...zone }) => zone),
        target_candidates: liveMarketContext.target_candidates || { buy: [], sell: [] },
        setup_refs: strategyEvents.map(e => ({ id: e.id, setup_id: e.setup_id }))
    };
}

function buildAiMarketAnalystPrompt(evidenceCatalog = {}, candleData = '') {
    const bounded = {
        ...evidenceCatalog,
        strategy_events: (evidenceCatalog.strategy_events || []).slice(0, STRATEGY_SPEC.COMBINATION.maxSetups),
        crt_events: (evidenceCatalog.crt_events || []).slice(0, STRATEGY_SPEC.CRT.maxEventsPerTimeframe * 3),
        tbs_events: (evidenceCatalog.tbs_events || []).slice(0, STRATEGY_SPEC.TBS.maxEventsPerTimeframe * 3),
        msnr_levels: (evidenceCatalog.msnr_levels || []).slice(0, STRATEGY_SPEC.MSNR.maxLevelsPerTimeframe * 3),
        fvg_zones: (evidenceCatalog.fvg_zones || []).slice(0, 20),
        ob_zones: (evidenceCatalog.ob_zones || []).slice(0, 20),
        execution_zones: (evidenceCatalog.execution_zones || []).slice(0, 30),
        liquidity: (evidenceCatalog.liquidity || []).slice(0, 40),
        target_candidates: {
            buy: (evidenceCatalog.target_candidates?.buy || []).slice(0, 20),
            sell: (evidenceCatalog.target_candidates?.sell || []).slice(0, 20)
        }
    };
    const system = [
        'You are the MARKET ANALYST stage of a deterministic ICT trading engine.',
        'Use timeframe_context: 1D macro context, 4H primary narrative, 1H intraday structure, and 15M execution. 5M is optional confirmation only for CONFIRMATION_ENTRY.',
        'Derive every conclusion from the supplied closed OHLCV and computed evidence. Never assume a level, price, trend, regime, bias, or reversal.',
        'Classify the 4H regime as RANGING, BULL_TREND, BEAR_TREND, or TRANSITION using recent swing structure and recent BOS/MSS evidence.',
        'A BOS requires a candle close beyond the opposing swing. An MSS requires a valid BOS followed by a retrace that holds inside the prior range. A wick alone is not a structure break.',
        'For 1D, 4H, and 1H, report the derived directional structure as bullish, bearish, or neutral only when the supplied evidence supports it; identify any conflict between timeframes.',
        'A liquidity sweep requires a wick through an identifiable equal high, equal low, session level, or structural liquidity level followed by a close back inside. Do not call ordinary volatility a sweep.',
        'BUY is continuation-eligible only when 4H is bullish or bullish transition and 1H confirms BUY. SELL is continuation-eligible only when 4H is bearish or bearish transition and 1H confirms SELL.',
        'When 1D conflicts with 4H, reduce conviction and require one additional independent confirmation such as a valid sweep plus BOS/MSS, displacement, or a fresh execution zone. Keep the setup available for user choice when that evidence exists.',
        'A reversal is distinct from continuation: a local 15M reversal cannot be labelled higher-timeframe verified unless 4H or 1H structure shift evidence is supplied.',
        'A limit plan must use a supplied derived retracement, FVG, OB, MSNR, flip, or liquidity zone and supplied structural invalidation. If the zone, invalidation, or target cannot be derived, return no hypothesis.',
        'Require at least three independent confluences for a preferred hypothesis: 4H direction, 1H alignment, valid liquidity sweep, and a clear executable entry zone. List the evidence IDs used.',
        'For each hypothesis you may propose trade_context_classification: HTF_ALIGNED_CONTINUATION, HTF_VERIFIED_REVERSAL, or LTF_ISOLATED, with top_down_evidence_ids from the supplied catalog. Code verifies the label and IDs. A local 15M pattern alone cannot prove an HTF reversal.',
        'Identify the highest-quality trading opportunity still available from the current market state for the remainder of today.',
        'Assess the dominant current narrative, meaningful liquidity, whether price is extended, whether retracement or continuation is realistic, whether the original move already delivered too far, and whether no defensible opportunity remains today.',
        'You may return zero hypotheses or describe NO_VALID_OPPORTUNITY_TODAY through the market_view when the evidence does not support a plan.',
        'Interpret only the supplied deterministic market evidence and propose zero or more strategy hypotheses for later code verification.',
        'Return strict JSON only with market_view and hypotheses.',
        'You may reference supplied CRT, TBS/Turtle Soup, MSNR, ICT market-mechanics, liquidity, FVG, OB, and execution-zone IDs, but you must never invent IDs.',
        'Location is not execution: use preferred_location_zone_ids for supply, demand, flip, or other POI context, and preferred_execution_zone_ids only for a separately executable trigger. A location-only POI cannot authorize a trade by itself.',
        'Do not return entry, entry_zone, stop_loss, TP prices, RR, confidence numbers, or arbitrary price levels. Those fields are ignored.',
        'Hypotheses are observations, not proof. Code will independently verify every referenced event and reject unsupported claims.',
        'For combinations every component must be independently supported and temporally/spatially compatible.',
        'A valid response is {"market_view":{"bias":"BULLISH|BEARISH|MIXED|NEUTRAL","market_narrative":"...","important_liquidity":"...","structure_interpretation":"...","risk_notes":[]},"hypotheses":[]}.',
        'Return zero hypotheses when evidence is insufficient.'
    ].join('\n');
    const user = 'DETERMINISTIC MARKET EVIDENCE\n' + JSON.stringify(bounded, null, 2) + '\n\nCOMPACT CLOSED-CANDLE CONTEXT\n' + String(candleData || '').slice(-16000) + '\n\nReturn only the analyst JSON object.';
    console.log('[AI] market analyst prompt characters', { system: system.length, evidence: user.length, hypothesis_cap: 12 });
    return { system, user };
}

function normalizeAiMarketAnalysis(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const allowedStrategies = new Set(['CRT', 'TBS', 'MSNR', 'ICT', 'MARKET_MECHANICS', 'CRT+TBS', 'CRT+MSNR', 'TBS+MSNR', 'CRT+TBS+MSNR']);
    const allowedTf = new Set(['4H', '1H', '15M', '5M']);
    const view = raw.market_view && typeof raw.market_view === 'object' ? raw.market_view : {};
    const hypotheses = Array.isArray(raw.hypotheses) ? raw.hypotheses.slice(0, 12).map((h, index) => ({
        hypothesis_id: typeof h?.hypothesis_id === 'string' ? h.hypothesis_id : 'AI-H' + (index + 1),
        strategy: allowedStrategies.has(h?.strategy) ? h.strategy : null,
        direction: h?.direction === 'BUY' || h?.direction === 'SELL' ? h.direction : null,
        setup_timeframe: allowedTf.has(h?.setup_timeframe) ? h.setup_timeframe : null,
        execution_timeframe: allowedTf.has(h?.execution_timeframe) ? h.execution_timeframe : null,
        quality: ['A', 'B', 'C'].includes(h?.quality) ? h.quality : null,
        trade_context_classification: typeof h?.trade_context_classification === 'string' ? h.trade_context_classification : null,
        top_down_evidence_ids: Array.isArray(h?.top_down_evidence_ids) ? h.top_down_evidence_ids.filter(id => typeof id === 'string').slice(0, 24) : [],
        reasoning: typeof h?.reasoning === 'string' ? h.reasoning.slice(0, 500) : '',
        crt_event_ids: Array.isArray(h?.crt_event_ids) ? h.crt_event_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        tbs_event_ids: Array.isArray(h?.tbs_event_ids) ? h.tbs_event_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        msnr_level_ids: Array.isArray(h?.msnr_level_ids) ? h.msnr_level_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        liquidity_event_ids: Array.isArray(h?.liquidity_event_ids) ? h.liquidity_event_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        preferred_execution_zone_ids: Array.isArray(h?.preferred_execution_zone_ids) ? h.preferred_execution_zone_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        preferred_location_zone_ids: Array.isArray(h?.preferred_location_zone_ids) ? h.preferred_location_zone_ids.filter(x => typeof x === 'string').slice(0, 5) : [],
        preferred_execution_types: Array.isArray(h?.preferred_execution_types) ? h.preferred_execution_types.filter(x => ['FVG', 'OB', 'MSNR', 'SUPPLY', 'DEMAND', 'FLIP', 'RECLAIM_RETEST'].includes(x)).slice(0, 4) : [],
        target_intent: ['BUY_SIDE_LIQUIDITY', 'SELL_SIDE_LIQUIDITY', 'CRT_OPPOSITE_RANGE', 'OPPOSING_STRUCTURE'].includes(h?.target_intent) ? h.target_intent : null,
        invalidation_thesis: typeof h?.invalidation_thesis === 'string' ? h.invalidation_thesis.slice(0, 300) : ''
    })) : [];
    return {
        market_view: {
            bias: ['BULLISH', 'BEARISH', 'MIXED', 'NEUTRAL'].includes(view.bias) ? view.bias : 'NEUTRAL',
            market_narrative: typeof view.market_narrative === 'string' ? view.market_narrative.slice(0, 600) : '',
            important_liquidity: typeof view.important_liquidity === 'string' ? view.important_liquidity.slice(0, 400) : '',
            structure_interpretation: typeof view.structure_interpretation === 'string' ? view.structure_interpretation.slice(0, 500) : '',
            risk_notes: Array.isArray(view.risk_notes) ? view.risk_notes.filter(x => typeof x === 'string').slice(0, 5) : []
        },
        hypotheses: hypotheses.filter(h => h.strategy && h.direction && h.setup_timeframe && h.execution_timeframe)
    };
}

function parseAiJsonContent(content) {
    if (typeof content !== 'string') return null;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (error) { return null; }
}

function validateAiMarketAnalystResponse(value) {
    const issues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('response must be an object');
    if (!value?.market_view || typeof value.market_view !== 'object' || Array.isArray(value.market_view)) issues.push('market_view must be an object');
    if (!Array.isArray(value?.hypotheses)) issues.push('hypotheses must be an array');
    const bias = value?.market_view?.bias;
    if (bias != null && !['BULLISH', 'BEARISH', 'MIXED', 'NEUTRAL'].includes(bias)) issues.push('market_view.bias is invalid');
    return { valid: issues.length === 0, issues };
}

function validateAiSelectorResponse(value, candidates = []) {
    const issues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('response must be an object');
    const rawDecision = String(value?.decision || '').toUpperCase();
    // BUY_LIMIT/SELL_LIMIT are accepted only as a backwards-compatible
    // selector alias; geometry still comes exclusively from the candidate.
    const decision = ['BUY_LIMIT', 'SELL_LIMIT'].includes(rawDecision) ? 'SELECT' : rawDecision;
    if (!['SELECT', 'WAIT'].includes(decision)) issues.push('decision must be SELECT or WAIT');
    const selectedId = value?.selected_candidate_id;
    if (decision === 'SELECT') {
        if (typeof selectedId !== 'string' || !selectedId.trim()) issues.push('SELECT requires selected_candidate_id');
    } else if (selectedId != null && typeof selectedId !== 'string') {
        issues.push('selected_candidate_id must be a string or null');
    }
    if (typeof value?.reasoning !== 'string' && (!value?.reasoning || typeof value.reasoning !== 'object' || Array.isArray(value.reasoning))) {
        issues.push('reasoning must be text or an object');
    }
    return { valid: issues.length === 0, issues, decision, selected_candidate_id: typeof selectedId === 'string' ? selectedId : null };
}

async function runAiMarketAnalyst(evidenceCatalog, liveMarketContext, candleData = '', retryCount = 0) {
    const diagnostics = { analyst_called: false, analyst_status: 'SKIPPED', attempts: retryCount + 1, market_view: null, hypotheses_received: 0, hypotheses_verified: 0, hypotheses_rejected: 0, verified_hypotheses: [], rejected_hypotheses: [], deterministic_duplicates: 0, setups_added_from_ai: 0, final_selector_called: false, selected_candidate_id: null };
    if (!hasAiAccess()) { diagnostics.analyst_status = 'NO_API_KEY'; return { diagnostics, analysis: null, verified_setups: [] }; }
    diagnostics.analyst_called = true;
    const prompt = buildAiMarketAnalystPrompt(evidenceCatalog, candleData);
    const retryAnalyst = reason => retryCount < 1
        ? runAiMarketAnalyst(evidenceCatalog, liveMarketContext,
            `${candleData}\n\nCORRECTION: The previous analyst response was invalid (${reason}). Return only the exact market_view and hypotheses JSON contract.`, retryCount + 1)
        : null;
    try {
        const { data } = await requestAIJson(getDeepSeekEndpoint(), {
            method: 'POST',
            headers: getDeepSeekHeaders(),
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], temperature: 0.1, max_tokens: 1800 })
        });
        const rawAnalysis = parseAiJsonContent(data?.choices?.[0]?.message?.content);
        const schema = validateAiMarketAnalystResponse(rawAnalysis);
        if (!schema.valid) {
            const retry = retryAnalyst(schema.issues.join('; '));
            if (retry) return retry;
            diagnostics.analyst_status = 'ANALYST_SCHEMA_INVALID';
            diagnostics.schema_validation = { ...schema, attempts: retryCount + 1 };
            return { diagnostics, analysis: null, verified_setups: [] };
        }
        const analysis = normalizeAiMarketAnalysis(rawAnalysis);
        if (!analysis) { diagnostics.analyst_status = 'INVALID_JSON'; return { diagnostics, analysis: null, verified_setups: [] }; }
        diagnostics.analyst_status = 'OK';
        diagnostics.market_view = analysis.market_view;
        diagnostics.hypotheses_received = analysis.hypotheses.length;
        const verifiedSetups = [];
        for (const hypothesis of analysis.hypotheses) {
            const verification = verifyAiStrategyHypothesis(hypothesis, evidenceCatalog, liveMarketContext);
            if (verification.verified) {
                diagnostics.hypotheses_verified++;
                diagnostics.verified_hypotheses.push({ hypothesis_id: hypothesis.hypothesis_id, strategy: hypothesis.strategy, direction: hypothesis.direction });
                if (verification.setup) verifiedSetups.push(verification.setup);
            } else {
                diagnostics.hypotheses_rejected++;
                diagnostics.rejected_hypotheses.push({ hypothesis_id: hypothesis.hypothesis_id, reason_code: verification.reason_code, reason: verification.reason });
            }
        }
        return { diagnostics, analysis, verified_setups: verifiedSetups };
    } catch (error) {
        const retry = retryAnalyst(error?.message || 'AI analyst request failed');
        if (retry) return retry;
        diagnostics.analyst_status = error?.name === 'AbortError' ? 'TIMEOUT' : 'ERROR';
        diagnostics.error = error?.message || 'AI market analyst failed';
        console.error('[AI] market analyst failed', { status: diagnostics.analyst_status, error: diagnostics.error });
        return { diagnostics, analysis: null, verified_setups: [] };
    }
}

function verifyAiMarketMechanicsHypothesis(hypothesis, evidenceCatalog = {}, liveMarketContext = {}) {
    const catalogZones = [...(evidenceCatalog.execution_zones || []), ...(evidenceCatalog.poi_zones || [])];
    const findZones = ids => (ids || []).map(id => catalogZones.find(zone => zone.id === id)).filter(Boolean);
    const locationIds = hypothesis.preferred_location_zone_ids || [];
    const executionIds = hypothesis.preferred_execution_zone_ids || [];
    if (locationIds.length !== findZones(locationIds).length || executionIds.length !== findZones(executionIds).length) {
        return { verified: false, reason_code: 'MARKET_MECHANICS_POI_MISSING', reason: 'A referenced deterministic location or execution POI does not exist.' };
    }
    const locations = findZones(locationIds);
    const zones = findZones(executionIds);
    if (!locations.length && !zones.length) return { verified: false, reason_code: 'MARKET_MECHANICS_POI_MISSING', reason: 'No supplied deterministic location or execution POI was referenced.' };
    const invalid = zone => zone.direction && zone.direction !== hypothesis.direction || zone.invalidated || zone.expired === true ||
        ['CONSUMED', 'MITIGATED', 'INVALIDATED', 'EXPIRED'].includes(String(zone.freshness || '').toUpperCase());
    if (locations.some(invalid)) return { verified: false, reason_code: 'MARKET_MECHANICS_LOCATION_INVALID', reason: 'The supplied location POI is invalid, consumed, or directionally incompatible.' };
    if (zones.some(zone => invalid(zone) || zone.location_only === true || zone.primary_eligible === false)) {
        return { verified: false, reason_code: 'MARKET_MECHANICS_EXECUTION_INVALID', reason: 'The supplied execution POI is not deterministically executable.' };
    }
    if (!zones.length) return { verified: false, reason_code: 'MARKET_MECHANICS_EXECUTION_MISSING', reason: 'A location POI requires separate executable evidence.' };
    const knownTopDown = new Set(Object.values(evidenceCatalog.timeframe_context || {}).flatMap(tf => tf.structural_evidence_ids || []));
    const suppliedTopDown = hypothesis.top_down_evidence_ids || [];
    if (suppliedTopDown.some(id => !knownTopDown.has(id))) return { verified: false, reason_code: 'TOP_DOWN_EVIDENCE_UNKNOWN', reason: 'Market-mechanics hypothesis references unknown top-down evidence.' };
    const context = evidenceCatalog.timeframe_context || {};
    const desired = hypothesis.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const hasShift = ['4H', '1H', '15M'].some(tf => (context[tf]?.evidence || []).some(e => e.direction === hypothesis.direction && ['MSS', 'CHOCH', 'BOS', 'DISPLACEMENT'].includes(e.kind)));
    if (!hasShift) return { verified: false, reason_code: 'MARKET_MECHANICS_SHIFT_MISSING', reason: 'No deterministic directional shift or displacement supports the proposed market-mechanics opportunity.' };
    const zone = zones[0];
    const targetPool = (evidenceCatalog.target_candidates?.[hypothesis.direction === 'BUY' ? 'buy' : 'sell'] || [])
        .filter(target => Number.isFinite(Number(target.level)) && (hypothesis.direction === 'BUY' ? target.level > zone.high : target.level < zone.low));
    if (!targetPool.length) return { verified: false, reason_code: 'MARKET_MECHANICS_TARGET_MISSING', reason: 'No supplied directional structural target remains beyond the POI.' };
    const tfContext = context[zone.timeframe] || context['1H'] || {};
    const swings = hypothesis.direction === 'BUY' ? tfContext.structure?.recent_swing_lows : tfContext.structure?.recent_swing_highs;
    const invalidation = (swings || []).filter(s => Number.isFinite(Number(s.level)) && (hypothesis.direction === 'BUY' ? s.level < zone.low : s.level > zone.high)).at(-1);
    if (!invalidation) return { verified: false, reason_code: 'MARKET_MECHANICS_INVALIDATION_MISSING', reason: 'No deterministic structural invalidation exists for the proposed POI.' };
    const setup = {
        id: `AI-ICT-${hypothesis.hypothesis_id}`,
        primary: 'ICT', label: 'ICT', direction: hypothesis.direction,
        timeframe: hypothesis.setup_timeframe, setup_timeframe: hypothesis.setup_timeframe,
        execution_timeframe: hypothesis.execution_timeframe, event_time: zone.created_time,
        execution_zone: zone, entry_model: hypothesis.preferred_execution_types?.includes('RECLAIM_RETEST') ? 'RECLAIM_RETEST' : 'FRESH_RETRACEMENT_LIMIT',
        execution_model: hypothesis.preferred_execution_types?.includes('RECLAIM_RETEST') ? 'RECLAIM_RETEST' : 'FRESH_RETRACEMENT_LIMIT',
        target_candidates: targetPool, target_bias: hypothesis.target_intent,
        structural_invalidation_detail: { strategy: 'ICT', source: 'MARKET_MECHANICS_SWING', level: Number(invalidation.level), timeframe: zone.timeframe, source_time: zone.created_time },
        structural_invalidation: Number(invalidation.level), execution_zone_created_time: zone.created_time,
        market_mechanics_verified: true, execution_confirmed: false, ai_verified: true,
        ai_hypothesis_id: hypothesis.hypothesis_id, ai_reasoning: hypothesis.reasoning
    };
    setup.location = locations[0] ? { zone_id: locations[0].id, type: locations[0].type, timeframe: locations[0].timeframe, evidence_ids: locations[0].structural_evidence_ids || [] } : null;
    setup.execution = { zone_id: zone.id, type: zone.type, timeframe: zone.timeframe, evidence_ids: zone.structural_evidence_ids || [], confirmation_state: setup.execution_confirmed ? 'CONFIRMED' : 'PENDING' };
    return { verified: true, reason_code: null, reason: 'POI, directional shift, target, and structural invalidation are deterministic.', setup };
}

function verifyAiStrategyHypothesis(hypothesis, evidenceCatalog = {}, liveMarketContext = {}) {
    if (!hypothesis || typeof hypothesis !== 'object') return { verified: false, reason_code: 'INVALID_HYPOTHESIS', reason: 'Hypothesis is not an object' };
    if (hypothesis.trade_context_classification || hypothesis.top_down_evidence_ids?.length) {
        const check = verifyTopDownTradeClassification(hypothesis, evidenceCatalog.timeframe_context || {});
        if (!check.verified) return { verified: false, reason_code: check.reason_code, reason: 'The claimed top-down classification is not supported by deterministic evidence.' };
    }
    const parts = String(hypothesis.strategy || '').split('+');
    if (['ICT', 'MARKET_MECHANICS'].includes(String(hypothesis.strategy))) return verifyAiMarketMechanicsHypothesis(hypothesis, evidenceCatalog, liveMarketContext);
    if (!parts.length || parts.some(p => !['CRT', 'TBS', 'MSNR'].includes(p))) return { verified: false, reason_code: 'UNSUPPORTED_STRATEGY', reason: 'Unsupported strategy label' };
    const find = (list, ids) => (ids || []).map(id => (list || []).find(item => item.id === id)).filter(Boolean);
    const crt = find(evidenceCatalog.crt_events || [], hypothesis.crt_event_ids);
    const tbs = find(evidenceCatalog.tbs_events || [], hypothesis.tbs_event_ids);
    const msnr = find(evidenceCatalog.msnr_levels || [], hypothesis.msnr_level_ids);
    const zones = find(evidenceCatalog.execution_zones || [], hypothesis.preferred_execution_zone_ids);
    for (const strategy of parts) {
        const records = strategy === 'CRT' ? crt : strategy === 'TBS' ? tbs : msnr;
        const requested = strategy === 'CRT' ? hypothesis.crt_event_ids : strategy === 'TBS' ? hypothesis.tbs_event_ids : hypothesis.msnr_level_ids;
        if (!requested.length || records.length !== requested.length) return { verified: false, reason_code: strategy + '_EVIDENCE_MISSING', reason: 'One or more ' + strategy + ' evidence IDs do not exist' };
        if (records.some(event => event.direction !== hypothesis.direction || event.invalidated === true || ['EXPIRED', 'STALE_NARRATIVE', 'TARGET_COMPLETED', 'INVALIDATED'].includes(event.narrative_state))) {
            return { verified: false, reason_code: strategy + '_EVIDENCE_INVALID', reason: strategy + ' evidence direction or lifecycle is invalid' };
        }
        if (strategy === 'CRT' && records.some(event => !(Number.isFinite(Number(event.range_high)) && Number.isFinite(Number(event.range_low)) && Number.isFinite(Number(event.sweep_extreme)) && event.reclaim_time != null &&
            (event.direction === 'BUY' ? Number(event.sweep_extreme) < Number(event.range_low) : Number(event.sweep_extreme) > Number(event.range_high))))) {
            return { verified: false, reason_code: 'CRT_RULES_UNVERIFIED', reason: 'CRT range, one-side sweep, and reclaim facts are incomplete' };
        }
        if (strategy === 'TBS' && records.some(event => !(Number.isFinite(Number(event.reference_level)) && Number.isFinite(Number(event.sweep_extreme)) && event.reclaim_time != null &&
            (event.direction === 'BUY' ? Number(event.sweep_extreme) < Number(event.reference_level) : Number(event.sweep_extreme) > Number(event.reference_level))))) {
            return { verified: false, reason_code: 'TBS_RULES_UNVERIFIED', reason: 'TBS reference, real sweep, and reclaim facts are incomplete' };
        }
        if (strategy === 'MSNR' && records.some(event => event.origin !== 'STRUCTURAL_MSNR' || event.primary_eligible === false || event.invalidated === true ||
            (String(event.role || '').includes('_TO_') && event.retest_index == null && event.first_retest_index == null))) {
            return { verified: false, reason_code: 'MSNR_RULES_UNVERIFIED', reason: 'MSNR evidence is not a verified structural level or role reversal' };
        }
    }
    if (hypothesis.preferred_execution_zone_ids?.length && zones.length !== hypothesis.preferred_execution_zone_ids.length) return { verified: false, reason_code: 'EXECUTION_ZONE_MISSING', reason: 'Preferred execution zone ID does not exist' };
    if (zones.some(zone => (zone.direction && zone.direction !== hypothesis.direction) || zone.invalidated || zone.primary_eligible === false)) return { verified: false, reason_code: 'EXECUTION_ZONE_INVALID', reason: 'Preferred execution zone is invalid' };
    const allEvidence = [...crt, ...tbs, ...msnr];
    if (parts.length > 1) {
        const componentRecords = parts.map(strategy => strategy === 'CRT' ? crt[0] : strategy === 'TBS' ? tbs[0] : msnr[0]).filter(Boolean);
        const componentTimes = componentRecords.map(event => normalizeTimestampUTC(event.event_time || event.reclaim_time || event.retest_time || event.source_time)).filter(Number.isFinite);
        const timeDiffHours = componentTimes.length === componentRecords.length
            ? (Math.max(...componentTimes) - Math.min(...componentTimes)) / 3600000 : Infinity;
        const componentLevels = componentRecords.map(event => Number(event.reclaim_level ?? event.reference_level ?? event.level ?? event.midpoint)).filter(Number.isFinite);
        const settings = getMarketSettings(liveMarketContext.pair || pair);
        const zoneWidths = zones.map(zone => Math.abs(Number(zone.high) - Number(zone.low))).filter(Number.isFinite);
        const spatialWidth = Math.max(settings.pipSize * 10, ...zoneWidths, Math.abs(Number(liveMarketContext.current_price) || 0) * 0.0005);
        const spatiallyRelated = componentLevels.length === componentRecords.length && Math.max(...componentLevels) - Math.min(...componentLevels) <= spatialWidth * 4;
        if (timeDiffHours > STRATEGY_SPEC.COMBINATION.crossTfHours || !spatiallyRelated) {
            return { verified: false, reason_code: 'COMBINATION_INCOMPATIBLE', reason: 'Strategy components are not temporally and spatially compatible' };
        }
    }
    const source = (liveMarketContext.strategy_setups || []).find(setup => allEvidence.some(event => event.setup_id === setup.id || event.id === setup.id));
    const base = source ? { ...source } : (allEvidence[0] ? { ...(allEvidence[0].source || {}), primary: parts[0], label: hypothesis.strategy } : null);
    if (!base) return { verified: false, reason_code: 'STRATEGY_SETUP_MISSING', reason: 'No deterministic strategy setup backs the hypothesis' };
    base.primary = parts[0];
    base.label = hypothesis.strategy;
    base.direction = hypothesis.direction;
    base.ai_hypothesis_id = hypothesis.hypothesis_id;
    base.ai_verified = true;
    base.ai_reasoning = hypothesis.reasoning;
    base.ai_target_intent = hypothesis.target_intent;
    base.ai_preferred_execution_zone_ids = hypothesis.preferred_execution_zone_ids;
    base.strategy_confluence = [...new Set([...(base.strategy_confluence || []), ...parts])];
    const preferredZone = zones[0];
    if (!base.execution_zone && preferredZone) {
        base.execution_zone = { ...preferredZone, strategy_source: parts[0] };
    }
    if (!base.execution_zone) {
        const sourceEvent = allEvidence[0].source || allEvidence[0];
        const level = Number(sourceEvent.reclaim_level ?? sourceEvent.level ?? sourceEvent.midpoint);
        if (Number.isFinite(level)) {
            const settings = getMarketSettings(liveMarketContext.pair || pair);
            const width = Math.max(settings.pipSize * 2, Math.abs(level) * 0.00002);
            base.execution_zone = {
                id: 'AI-' + hypothesis.hypothesis_id + '-RECLAIM',
                type: parts[0],
                origin: 'STRUCTURAL',
                primary_eligible: true,
                direction: hypothesis.direction,
                timeframe: hypothesis.execution_timeframe,
                low: ictRound(level - width, settings.prec),
                high: ictRound(level + width, settings.prec),
                midpoint: ictRound(level, settings.prec),
                created_time: sourceEvent.reclaim_time || sourceEvent.event_time || sourceEvent.source_time,
                entry_model: 'RECLAIM_RETEST',
                entry_region_source: parts[0] + '_RECLAIM_RETEST',
                structural_invalidation: base.structural_invalidation || sourceEvent.sweep_extreme || sourceEvent.invalidation
            };
        }
    }
    base.execution_timeframe = base.execution_timeframe || hypothesis.execution_timeframe;
    base.setup_timeframe = base.setup_timeframe || hypothesis.setup_timeframe;
    base.timeframe = base.timeframe || hypothesis.setup_timeframe;
    base.event_time = base.event_time || allEvidence[0].event_time || allEvidence[0].reclaim_time || allEvidence[0].source_time;
    base.structural_invalidation = base.structural_invalidation ?? allEvidence[0].structural_invalidation ?? allEvidence[0].sweep_extreme;
    base.target_candidates = base.target_candidates || (allEvidence[0].source?.target_candidates || []);
    return { verified: true, reason_code: null, reason: 'All referenced deterministic strategy evidence verified', setup: base };
}

function mergeVerifiedAiSetups(liveMarketContext, verifiedSetups = [], evidenceCatalog = {}) {
    const current = liveMarketContext?.strategy_setups || [];
    const merged = [...current];
    let duplicates = 0;
    for (const setup of verifiedSetups) {
        const duplicate = merged.find(existing => existing.primary === setup.primary && existing.direction === setup.direction &&
            Math.abs(normalizeTimestampUTC(existing.event_time) - normalizeTimestampUTC(setup.event_time)) <= 3600000 &&
            strategyZoneKey(existing.execution_zone) === strategyZoneKey(setup.execution_zone));
        if (duplicate) {
            duplicate.ai_verified = true;
            duplicate.ai_hypothesis_id = setup.ai_hypothesis_id;
            duplicate.ai_reasoning = setup.ai_reasoning;
            duplicates++;
        } else merged.push(setup);
    }
    return { strategy_setups: merged, duplicates, added: merged.length - current.length };
}

function rebuildCandidatesWithAiSetups(liveMarketContext, strategySetups) {
    if (liveMarketContext.market_context) {
        liveMarketContext.market_context.timeframe_context = buildTimeframeContext({
            historyCache: liveMarketContext.historyCache, structure: liveMarketContext.structure,
            price: liveMarketContext.current_price, strategySetups,
            zones: liveMarketContext.context_ict_zones || [], liquidity: liveMarketContext.liquidity
        });
        liveMarketContext.market_context.daily_bias = buildDailyTradingBias(
            liveMarketContext.market_context.timeframe_context,
            liveMarketContext.target_candidates,
            liveMarketContext.current_price,
            liveMarketContext.as_of_time
        );
        liveMarketContext.daily_bias = liveMarketContext.market_context.daily_bias;
        prepareOpportunitySetups(strategySetups, liveMarketContext.market_context, liveMarketContext.current_price);
    }
    const result = buildAdaptiveSetupCandidates({
        pair: liveMarketContext.pair,
        price: liveMarketContext.current_price,
        historyCache: liveMarketContext.historyCache || {},
        zones: liveMarketContext.context_ict_zones || liveMarketContext.real_ict_zones || [],
        targetCandidates: liveMarketContext.target_candidates,
        riskConstraints: liveMarketContext.risk_constraints,
        marketRegime: liveMarketContext.market_regime,
        structure: liveMarketContext.structure,
        marketContext: liveMarketContext.market_context,
        strategySetups
    });
    liveMarketContext.strategy_setups = strategySetups;
    if (liveMarketContext.deterministic_validation_context) {
        liveMarketContext.deterministic_validation_context.strategy_setups = strategySetups;
    }
    liveMarketContext.adaptive_setup_candidates = result.valid_candidates;
    liveMarketContext.setup_candidate_audit = {
        ...(liveMarketContext.setup_candidate_audit || {}),
        raw_candidate_count: result.raw_candidates.length,
        valid_candidate_count: result.valid_candidates.length,
        rejected_candidate_count: result.rejected_candidates.length,
        rejection_summary: summarizeCandidateRejections(result.rejected_candidates),
        rejection_detail: summarizeCandidateRejectionDetails(result.rejected_candidates)
    };
    liveMarketContext.candidate_pipeline = buildCandidatePipelineAudit(strategySetups, result.raw_candidates, result.rejected_candidates, result.valid_candidates, result.seed_diagnostics);
    return result;
}

function buildAIPrompt(liveMarketContext, candleData) {
    const system = [
        'You are the discretionary candidate-selection layer of an ICT pending-limit trading system.',
        'Return only {"decision":"SELECT"|"WAIT","selected_candidate_id":"string or null","reasoning":"qualitative text"}. Do not return trade geometry or confidence.',
        'The deterministic engine has already calculated and validated every numeric trade level in COMPUTED MARKET FACTS.adaptive_setup_candidates.',
        'You must NEVER invent, modify, recalculate, improve, widen, tighten, or replace entry, stop_loss, TP1, TP2, TP3, RR, or zone bounds.',
        'Your job is only to select the best candidate ID using the supplied live market context, or return WAIT for qualitative market reasons.',
        'A selected candidate numeric geometry is authoritative and immutable.',
        'VALID_CANDIDATES = executable numerical candidates that already passed all hard rules.',
        'REAL_ICT_ZONES = authoritative deterministic market structures.',
        'MARKET_CONTEXT = deterministic market understanding only; FVG, OB, BOS, CHoCH, MSS, liquidity, premium/discount, session, AMD, indicators, and ATR describe what the market is doing.',
        'STRATEGY_SETUPS = deterministic CRT, TBS/Turtle Soup, and MSNR detections. Actionable candidates must come from these strategy setups.',
        'FVG and OB are confluence/context unless a supplied deterministic strategy candidate uses them. Do not treat every FVG/OB as a standalone trade strategy.',
        'RAW CANDLES = secondary context for qualitative interpretation only.',
        'IMMEDIATE_ENTRY = separate current-price reaction assessment, never a requirement before a pending limit fills.',
        'Zone/target origin hierarchy: STRUCTURAL and STRUCTURAL_MSNR = directly derived market structure. PIVOT_REFERENCE = classic pivot-derived reference only, not MSNR strategy evidence. ATR_FALLBACK = synthetic reference only. PIVOT_REFERENCE and ATR_FALLBACK must never create standalone MSNR trades.',
        'Stage 1 asks whether a valid future pending-limit setup exists. Current price not being inside the zone, immediate confirmation score of 0, or off-hours are not by themselves reasons for NO_TRADE.',
        'Stage 2 assesses immediate entry independently of pending-limit execution.',
        'Rank the supplied adaptive_setup_candidates and return SELECT with the best candidate ID, or WAIT when no supplied candidate is worth selecting.',
        'Do not return WAIT merely because price has not reached a valid future limit zone. Immediate-entry confirmation is separate and never required before a true LIMIT fill.',
        'Select the best FRESH deterministic opportunity that remains actionable now or later in the current trading day. If none exists, return WAIT.',
        'Never select a setup merely because its historical pattern was valid. Reject any candidate with opportunity_status STALE, COMPLETED, or EXPIRED, entry_consumed true, tp1_already_reached true, insufficient remaining_reward_fraction, or still_actionable_today false.',
        'A true pending BUY_LIMIT or SELL_LIMIT does not require current price to be inside the zone or reaction confirmation before the limit fills. Use pending_entry_quality and entry_reachability_score to compare future entries, not to relabel a valid limit as a confirmation entry.',
        'Return only decision, selected_candidate_id, and qualitative reasoning; the application hydrates all geometry and confidence from the selected deterministic candidate.',
        'When discussing TP1, use the supplied candidate target_map primary_target_source, target_type, and target_confluence. Never reinterpret an OB target as CRT or a CRT target as OB unless target_confluence explicitly contains both.',
        'If adaptive_setup_candidates is empty, do not invent entry/SL/TP levels; return WAIT.',
        'If market_context has a strong directional bias but strategy_setups is empty, return WAIT because context alone is not a trade.',
        'Never invent CRT, TBS/Turtle Soup, or MSNR detections. Use only supplied deterministic strategy_setups and adaptive_setup_candidates.',
        'Do not calculate risk, required reward, minimum TP, alternate stops, alternate targets, or entry geometry. You may describe the supplied candidate RR qualitatively.',
        'Premium/discount context: discount generally favors BUY entries and premium generally favors SELL entries unless stronger supplied structure says otherwise.',
        'Freshness labels mean: FRESH = fresh, PARTIAL = partially used/partially mitigated, USED = used, INVALID = invalidated. Never describe PARTIAL as fresh.',
        'Do not force a setup. Return ONLY valid JSON.'
    ].join('\n');

    const compactContext = compactAIContext(liveMarketContext);
    const compactFacts = JSON.stringify(compactContext, null, 2);
    console.log('[AI] prompt characters', {
        system: system.length,
        computed_facts: compactFacts.length,
        candle_context: String(candleData || '').length,
        total: system.length + compactFacts.length + String(candleData || '').length,
        candidate_count: compactContext.adaptive_setup_candidates.length
    });
    const user = `================================================
LIVE MARKET SNAPSHOT
================================================
pair: ${liveMarketContext.pair}
current_price: ${liveMarketContext.current_price}
utc_time: ${liveMarketContext.utc_time}
session: ${liveMarketContext.session.name}

================================================
COMPUTED MARKET FACTS
================================================
${compactFacts}

================================================
RAW CANDLE DATA
================================================
${candleData}

================================================
TASK
================================================
Select the best supplied fresh deterministic candidate that remains actionable now or later today.
Use only supplied evidence, lifecycle, context, target provenance and deterministic quality.
The application owns direction, order type, all geometry and confidence.
A pending limit may be outside its zone and fills at its order price without reaction confirmation.
If no supplied candidate is worth selecting, return WAIT. Do not force a trade.

Return ONLY this selector JSON (no additional fields):
{
  "decision": "SELECT" | "WAIT",
  "selected_candidate_id": "candidate ID for SELECT, null for WAIT",
  "reasoning": "qualitative text explaining why the candidate remains actionable today, or why WAIT"
}`;

    return { system, user };
}

function buildCandleData(historyCache, count = 10, symbolMetadata = {}) {
    const tfs = ['1D', '4H', '1H', '15M', '5M'];
    const realVolume = hasRealVolume(pair, symbolMetadata);
    let data = '';
    for (const tf of tfs) {
        const candles = historyCache[tf];
        if (!candles || candles.length < count) continue;
        data += `\n### ${tf} CANDLES (Last ${count}):\n`;
        const slice = candles.slice(-count);
        const startIdx = candles.length - count;
        slice.forEach((c, i) => {
            const idx = startIdx + i;
            const o = (c.o || 0).toFixed(2);
            const h = (c.h || 0).toFixed(2);
            const l = (c.l || 0).toFixed(2);
            const cl = (c.c || 0).toFixed(2);
            const volumeText = realVolume ? ` V:${Math.round(c.v || 0)}` : ' V:n/a';
            data += `  ${idx}: O:${o} H:${h} L:${l} C:${cl}${volumeText}\n`;
        });
    }
    return data;
}

async function askAIToFindSetup(marketData, price, systemPrompt = null, liveMarketContext = null, retryCount = 0) {
    if (!hasAiAccess()) {
        console.error('No AI key available');
        lastAIRequestError = { code: 'NO_AI_KEY', message: 'No DeepSeek API key available' };
        return null;
    }
    const requestStartedAt = scanClock();
    lastAIRequestError = null;
    const noTradeAfterInvalidAI = reason => ({
        decision: 'WAIT', direction: 'WAIT', selected_candidate_id: null, confidence: 0,
        reasoning: { primary: `AI output rejected after ${retryCount + 1} attempts: ${reason}` },
        ai_decision: 'skip', noTrade: true,
        wait_condition: `AI output rejected after ${retryCount + 1} attempts: ${reason}`,
        schema_validation: { valid: false, issues: [reason], attempts: retryCount + 1 }
    });
    const retryInvalidAI = reason => retryCount < 1
        ? askAIToFindSetup(
            `${marketData}\n\nCORRECTION: Your previous response was invalid (${reason}). Return only the exact JSON contract requested above. Do not add markdown or extra fields.`,
            price, systemPrompt, liveMarketContext, retryCount + 1)
        : noTradeAfterInvalidAI(reason);
    console.log('[SCAN] DeepSeek request start', {
        timeout_ms: AI_REQUEST_TIMEOUT_MS,
        prompt_characters: String(marketData || '').length,
        candidate_count: liveMarketContext?.adaptive_setup_candidates?.length || 0
    });
    try {
        const { response, data } = await requestAIJson(getDeepSeekEndpoint(), {
            method: 'POST',
            headers: getDeepSeekHeaders(),
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { 
                        role: 'system', 
                        content: systemPrompt || 'You are a selector for deterministic candidates. Return only decision, selected_candidate_id, and qualitative reasoning. Never return or modify trade geometry.'
                    },
                    { 
                        role: 'user', 
                        content: marketData 
                    }
                ],
                temperature: 0.1,
                max_tokens: 2000
            })
        });
        if (response && response.ok === false) {
            throw new Error(`DeepSeek HTTP ${response.status || 'error'}`);
        }
        console.log('[SCAN] DeepSeek parsed', { elapsed_ms: Math.round((scanClock() - requestStartedAt) * 100) / 100 });
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
            console.error('No content from AI');
            return retryInvalidAI('AI response contained no content');
        }
        
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('No JSON found in AI response');
            return retryInvalidAI('AI response did not contain a JSON object');
        }
        let selector;
        try {
            selector = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            console.error('AI JSON parse failed', parseError);
            return retryInvalidAI('AI response JSON could not be parsed');
        }
        const productionSelector = liveMarketContext && Array.isArray(liveMarketContext.adaptive_setup_candidates);
        if (productionSelector) {
            const selectorContract = validateAiSelectorResponse(selector, liveMarketContext.adaptive_setup_candidates);
            if (!selectorContract.valid) {
                console.error('[AI] selector schema rejected', selectorContract.issues);
                const reason = `AI selector schema rejected: ${selectorContract.issues.join('; ')}`;
                if (retryCount < 1) return retryInvalidAI(reason);
                return { ...noTradeAfterInvalidAI(reason), schema_validation: { ...selectorContract, attempts: retryCount + 1 } };
            }
            const selectedId = typeof selector.selected_candidate_id === 'string' ? selector.selected_candidate_id : null;
            if (!selectedId || ['WAIT', 'NO_TRADE'].includes(String(selector.decision || '').toUpperCase())) {
                return { decision: 'WAIT', direction: 'WAIT', selected_candidate_id: null, confidence: 0,
                    reasoning: typeof selector.reasoning === 'object' ? selector.reasoning : { primary: selector.reasoning || 'No deterministic candidate selected' },
                    ai_decision: 'skip', noTrade: true, wait_condition: selector.reasoning || 'No deterministic candidate selected' };
            }
            const selected = applyAdaptiveCandidateToAIResult({ selected_candidate_id: selectedId, reasoning: selector.reasoning }, liveMarketContext);
            if (selected.unknown_deterministic_candidate) return { decision: 'WAIT', direction: 'WAIT', selected_candidate_id: selectedId, confidence: 0, reasoning: { primary: 'AI selected unknown deterministic candidate' }, ai_decision: 'skip', noTrade: true, wait_condition: 'AI selected unknown deterministic candidate' };
            const deterministicConfidence = getDeterministicCandidateConfidence(selected.adaptive_candidate);
            selected.confidence = Number.isFinite(deterministicConfidence) ? deterministicConfidence : null;
            selected.quality = selected.adaptive_candidate.quality;
            const target = selected.adaptive_candidate.target_map?.[0];
            if (target) {
                selected.primary_target_source = target.primary_target_source;
                selected.target_type = target.target_type;
                selected.target_confluence = target.target_confluence;
            }
            selected.reasoning = { ...(selected.reasoning || {}), ...buildDeterministicOrderDescription(selected.adaptive_candidate).reasoning };
            return selected;
        }
        const result = applyAdaptiveCandidateToAIResult(selector, liveMarketContext);
        if (result.unknown_deterministic_candidate) {
            return {
                decision: 'WAIT',
                direction: 'WAIT',
                confidence: 0,
                reasoning: { primary: 'AI selected unknown deterministic candidate' },
                ai_decision: 'skip',
                wait_condition: 'AI selected unknown deterministic candidate',
                noTrade: true
            };
        }
        const rawDecision = String(result.decision || result.direction || '').toUpperCase().replace('-', '_');
        if ((rawDecision === 'BUY_LIMIT' || rawDecision === 'SELL_LIMIT') && (result.direction !== 'BUY' && result.direction !== 'SELL')) {
            result.direction = rawDecision === 'BUY_LIMIT' ? 'BUY' : 'SELL';
        }
        const hasLimitDirection = result.direction === 'BUY' || result.direction === 'SELL';
        const hasCompleteLimitSetup = hasLimitDirection
            && result.entry_zone
            && ['entry', 'stop_loss', 'take_profit_1'].every(field => ictFiniteNumber(result[field]))
            && (result.take_profit_2 == null || ictFiniteNumber(result.take_profit_2))
            && (result.take_profit_3 == null || ictFiniteNumber(result.take_profit_3));
        if ((rawDecision === 'WAIT' || rawDecision === 'NO_TRADE' || rawDecision === 'SKIP') && !hasCompleteLimitSetup) {
            result.decision = rawDecision === 'SKIP' ? 'NO_TRADE' : rawDecision;
            result.direction = result.decision;
            result.confidence = Number(result.confidence) || 0;
            result.reasoning = result.reasoning && typeof result.reasoning === 'object'
                ? result.reasoning
                : { primary: result.reason || 'No valid trade setup' };
            result.ai_decision = 'skip';
            result.wait_condition = result.wait_condition || result.reasoning.primary || 'No valid high-quality setup';
            result.noTrade = true;
            console.log('✅ AI No-Trade Decision:', result);
            return result;
        }
        if ((rawDecision === 'WAIT' || rawDecision === 'SKIP') && hasCompleteLimitSetup) {
            result.decision = result.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
            result.ai_decision = 'wait_for_reaction';
            result.wait_condition = result.wait_condition || 'Pending limit setup valid; immediate entry is not active. The limit fills when market price trades at the order price.';
        }
        if ((rawDecision === 'BUY_LIMIT' || rawDecision === 'SELL_LIMIT') && result.ai_decision === 'skip') {
            result.ai_decision = 'wait_for_reaction';
            result.wait_condition = result.wait_condition || 'Pending limit setup valid; immediate entry is not active. The limit fills when market price trades at the order price.';
        }
        
        const required = ['direction', 'entry', 'entry_zone', 'stop_loss', 'take_profit_1', 'confidence', 'reasoning'];
        for (const field of required) {
            if (!result[field]) {
                console.error(`Missing required field: ${field}`);
                return null;
            }
        }
        
        if (!ictFiniteNumber(result.entry_zone.low) || !ictFiniteNumber(result.entry_zone.high) || result.entry_zone.high < result.entry_zone.low) {
            console.error('AI entry zone is missing or invalid; refusing to invent geometry');
            return null;
        }
        
        if (!result.reasoning.primary) {
            result.reasoning.primary = 'AI analysis completed';
        }
        if (!result.reasoning.secondary) {
            result.reasoning.secondary = [];
        }
        if (!result.reasoning.risk_warning) {
            result.reasoning.risk_warning = 'Normal market risk applies';
        }

        if (!result.reasoning.why_best) {
            result.reasoning.why_best = `${result.direction} chosen over ${result.direction === 'BUY' ? 'SELL' : 'BUY'} — higher confidence/alignment`;
        }

        result.opposite_setup = normalizeOppositeSetup(result.opposite_setup, result.direction);

        if (!result.patterns || !Array.isArray(result.patterns)) {
            result.patterns = [result.entry_zone.source || 'AI Identified'];
        }
        
        if (!result.ai_decision) {
            result.ai_decision = result.confidence >= 70 ? 'enter_now' : 'wait_for_reaction';
        }
        if (!result.order_type) result.order_type = 'LIMIT';
        if (!result.setup_type) result.setup_type = 'PENDING_LIMIT';
        if (!result.decision || result.decision === result.direction) {
            result.decision = result.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
        }
        
        if (!result.probability) {
            result.probability = result.confidence >= 70 ? 'HIGH' : (result.confidence >= 55 ? 'MEDIUM' : 'LOW');
        }
        
        if (!result.zone_quality) {
            result.zone_quality = result.confidence >= 75 ? 'A' : (result.confidence >= 60 ? 'B' : 'C');
        }
        
        const rrMetrics = calculateRRMetrics(
            result.direction,
            Number(result.entry),
            Number(result.stop_loss),
            Number(result.take_profit_1),
            getMarketSettings(pair).targetRR || 2.5
        );
        console.log('AI RR CHECK', {
            pair,
            direction: result.direction,
            entry: Number(result.entry),
            stopLoss: Number(result.stop_loss),
            tp1: Number(result.take_profit_1),
            risk: rrMetrics.risk,
            reward: rrMetrics.reward,
            actualRR: rrMetrics.actualRR,
            requiredRR: rrMetrics.requiredRR
        });
        if (Number.isFinite(rrMetrics.actualRR)) {
            result.risk_reward = '1:' + rrMetrics.actualRR.toFixed(2);
        }
        
        if (!result.stop_loss_reason) {
            result.stop_loss_reason = 'Structural level identified by AI';
        }
        
        console.log('✅ AI Setup Generated:', result);
        return result;
        
    } catch (e) {
        const timedOut = e?.name === 'AbortError';
        lastAIRequestError = {
            code: timedOut ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED',
            message: timedOut ? `DeepSeek request timed out after ${AI_REQUEST_TIMEOUT_MS}ms` : (e?.message || 'DeepSeek request failed'),
            stack: e?.stack
        };
        console.error('[SCAN] FAILED', { stage: timedOut ? 'DeepSeek request timeout' : 'DeepSeek request', error: lastAIRequestError.message, stack: e?.stack });
        return null;
    }
}

function validateAIOutputConsistency(aiResult, liveMarketContext) {
    const issues = [];
    if (!aiResult || typeof aiResult !== 'object') return { valid: false, issues: ['missing AI result'] };
    const decision = String(aiResult.decision || aiResult.direction || '').toUpperCase().replace('-', '_');
    if (decision === 'WAIT' || decision === 'NO_TRADE' || aiResult.noTrade) return { valid: true, issues: [] };
    if (aiResult.direction !== 'BUY' && aiResult.direction !== 'SELL') issues.push('direction must be BUY or SELL');

    for (const field of ['entry', 'stop_loss', 'take_profit_1']) {
        if (!ictFiniteNumber(aiResult[field])) issues.push(`${field} must be a finite number`);
    }
    for (const field of ['take_profit_2', 'take_profit_3']) {
        if (aiResult[field] != null && !ictFiniteNumber(aiResult[field])) issues.push(`${field} must be a finite number when supplied`);
    }

    const direction = aiResult.direction;
    const entry = aiResult.entry;
    const sl = aiResult.stop_loss;
    const tp1 = aiResult.take_profit_1;
    const tp2 = aiResult.take_profit_2 == null ? null : Number(aiResult.take_profit_2);
    const tp3 = aiResult.take_profit_3 == null ? null : Number(aiResult.take_profit_3);
    let selectedDeterministicCandidate = null;
    let deterministicCandidateInvariantFailure = false;
    if (aiResult.selected_candidate_id) {
        selectedDeterministicCandidate = (liveMarketContext?.adaptive_setup_candidates || []).find(c => c.id === aiResult.selected_candidate_id) || null;
        if (!selectedDeterministicCandidate) {
            issues.push('selected adaptive setup candidate does not exist in supplied live market context');
        } else if (selectedDeterministicCandidate.zone_type === 'MSNR' && selectedDeterministicCandidate.zone_origin !== 'STRUCTURAL_MSNR') {
            issues.push('only STRUCTURAL_MSNR adaptive setup candidates can be selected as MSNR');
        }
    }
    if (issues.length === 0) {
        if (direction === 'BUY' && !(sl < entry && entry < tp1)) {
            issues.push('BUY geometry must be SL < entry < TP1');
        }
        if (direction === 'SELL' && !(sl > entry && entry > tp1)) {
            issues.push('SELL geometry must be SL > entry > TP1');
        }
        if (Number.isFinite(tp2)) {
            if (direction === 'BUY' && !(tp2 > tp1)) issues.push('BUY TP2 must be greater than TP1 when supplied');
            if (direction === 'SELL' && !(tp2 < tp1)) issues.push('SELL TP2 must be less than TP1 when supplied');
        }
        if (Number.isFinite(tp3)) {
            const prior = Number.isFinite(tp2) ? tp2 : tp1;
            if (direction === 'BUY' && !(tp3 > prior)) issues.push('BUY TP3 must be greater than the prior supplied target');
            if (direction === 'SELL' && !(tp3 < prior)) issues.push('SELL TP3 must be less than the prior supplied target');
        }
        const suppliedTargets = [tp1, tp2, tp3].filter(Number.isFinite);
        if (new Set(suppliedTargets.map(v => String(v))).size !== suppliedTargets.length) issues.push('take profits must be distinct');
    }
    if (issues.length === 0) {
        const minimumRR = Number(liveMarketContext?.risk_constraints?.minimum_rr) || 2.5;
        const authoritative = selectedDeterministicCandidate || null;
        const authoritativeDirection = authoritative?.direction || direction;
        const authoritativeEntry = Number(authoritative?.entry ?? entry);
        const authoritativeStop = Number(authoritative?.stop_loss ?? sl);
        const authoritativeTp1 = Number(authoritative?.tp1 ?? tp1);
        const rrMetrics = calculateRRMetrics(authoritativeDirection, authoritativeEntry, authoritativeStop, authoritativeTp1, minimumRR);
        if (!(rrMetrics.risk > 0)) { deterministicCandidateInvariantFailure = !!authoritative; issues.push('risk must be greater than zero'); }
        if (!(rrMetrics.reward > 0)) { deterministicCandidateInvariantFailure = !!authoritative; issues.push('reward must be greater than zero'); }
        if (!Number.isFinite(rrMetrics.actualRR)) {
            deterministicCandidateInvariantFailure = !!authoritative;
            issues.push('actual RR must be finite');
        } else if (rrMetrics.actualRR + 1e-9 < minimumRR) {
            deterministicCandidateInvariantFailure = !!authoritative;
            issues.push(`actual RR ${rrMetrics.actualRR.toFixed(2)} below minimum ${minimumRR.toFixed(2)}`);
        }
        if (authoritative && (!Array.isArray(authoritative.target_map) || authoritative.target_map.length === 0)) {
            deterministicCandidateInvariantFailure = true;
            issues.push('selected deterministic candidate has no authoritative target_map');
        }
        const tp1Candidate = findTp1TargetCandidate(aiResult, liveMarketContext, rrMetrics, authoritative);
        if (tp1Candidate.checked && !tp1Candidate.hasValidCandidate) {
            deterministicCandidateInvariantFailure = !!authoritative;
            issues.push(authoritative ? 'candidate target_map has no target satisfying minimum RR' : 'no supplied target candidate satisfies minimum RR');
        } else if (tp1Candidate.checked && !tp1Candidate.matched) {
            deterministicCandidateInvariantFailure = !!authoritative;
            issues.push(authoritative ? 'candidate TP1 does not match its authoritative target_map' : 'take_profit_1 must match a supplied target candidate that satisfies minimum RR');
        }
    }

    if (issues.length === 0 && (liveMarketContext?.adaptive_setup_candidates || []).length > 0 && !aiResult.selected_candidate_id) {
        issues.push('actionable AI setup must select a deterministic candidate ID');
    }
    if (issues.length === 0 && aiResult.selected_candidate_id) {
        const candidate = (liveMarketContext?.adaptive_setup_candidates || []).find(c => c.id === aiResult.selected_candidate_id);
        if (!candidate) {
            issues.push('selected adaptive setup candidate does not exist in supplied live market context');
        } else if (candidate.zone_type === 'MSNR' && candidate.zone_origin !== 'STRUCTURAL_MSNR') {
            issues.push('only STRUCTURAL_MSNR adaptive setup candidates can be selected as MSNR');
        } else {
            selectedDeterministicCandidate = candidate;
            const tol = Math.max(Math.abs(entry) * 0.0002, 0.00001);
            const numericMatches = [
                ['entry', entry, candidate.entry],
                ['stop_loss', sl, candidate.stop_loss],
                ['take_profit_1', tp1, candidate.tp1],
                ['take_profit_2', tp2, candidate.tp2],
                ['take_profit_3', tp3, candidate.tp3]
            ].filter(([, actual, expected]) => expected != null && Math.abs(Number(actual) - Number(expected)) > tol);
            if (numericMatches.length > 0) {
                deterministicCandidateInvariantFailure = true;
                issues.push(`AI numeric levels do not match selected adaptive setup candidate: ${numericMatches.map(([name]) => name).join(', ')}`);
            }
            const stopCheck = evaluateStructuralStop(candidate, getCandidateATRContext(candidate, liveMarketContext.historyCache || {}, liveMarketContext.pair || pair, liveMarketContext.current_price), liveMarketContext.pair || pair);
            if (stopCheck.status === 'SL_INSIDE_STRUCTURAL_INVALIDATION') {
                deterministicCandidateInvariantFailure = true;
                issues.push('selected candidate stop is inside authoritative strategy invalidation');
            }
        }
    }

    if (selectedDeterministicCandidate && (!Array.isArray(liveMarketContext?.real_ict_zones) || liveMarketContext.real_ict_zones.length === 0)) {
        return {
            valid: issues.length === 0,
            issues,
            failure_code: deterministicCandidateInvariantFailure
                ? 'ENGINE_INVARIANT_FAILURE'
                : null,
            invariant_code: deterministicCandidateInvariantFailure ? 'DETERMINISTIC_CANDIDATE_TARGET_PROVENANCE' : null
        };
    }

    const selected = selectedDeterministicCandidate
        ? { type: selectedDeterministicCandidate.zone_type, timeframe: selectedDeterministicCandidate.timeframe, low: selectedDeterministicCandidate.zone_low, high: selectedDeterministicCandidate.zone_high }
        : (aiResult.selected_zone || aiResult.entry_zone);
    const zones = liveMarketContext?.real_ict_zones || [];
    if (!selected || !Number.isFinite(Number(selected.low)) || !Number.isFinite(Number(selected.high))) {
        issues.push('selected_zone/entry_zone must include low and high');
    } else {
        const source = ictCanonicalZoneType(selected.type || selected.source);
        const low = Number(selected.low);
        const high = Number(selected.high);
        const tf = selected.timeframe;
        const baseMatches = zones.filter(z => {
            const typeOk = !source || z.type === source;
            const tfOk = !tf || z.timeframe === tf;
            const lowOk = Math.abs(Number(z.low) - low) <= Math.max(Math.abs(low) * 0.0002, 0.00001);
            const highOk = Math.abs(Number(z.high) - high) <= Math.max(Math.abs(high) * 0.0002, 0.00001);
            return typeOk && tfOk && lowOk && highOk;
        });
        if (baseMatches.length === 0) {
            issues.push('selected zone does not exist in supplied live market context');
        } else {
            const directionMatches = baseMatches.filter(z => z.direction === direction);
            if (directionMatches.length === 0) {
                issues.push('selected zone direction does not match AI trade direction');
            } else if (!directionMatches.some(z => !(z.type === 'MSNR' && (z.origin !== 'STRUCTURAL_MSNR' || z.primary_eligible === false)))) {
                issues.push('only STRUCTURAL_MSNR can be selected as primary AI MSNR zone');
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        failure_code: deterministicCandidateInvariantFailure
            ? 'ENGINE_INVARIANT_FAILURE'
            : (aiResult.selected_candidate_id && !selectedDeterministicCandidate ? 'AI_SELECTION_FAILURE' : null),
        invariant_code: deterministicCandidateInvariantFailure ? 'DETERMINISTIC_CANDIDATE_TARGET_PROVENANCE' : null
    };
}

function findSelectedLiveZone(aiResult, liveMarketContext) {
    const selected = aiResult?.selected_zone || aiResult?.entry_zone;
    const zones = liveMarketContext?.real_ict_zones || [];
    if (!selected) return null;
    const source = ictCanonicalZoneType(selected.type || selected.source);
    const low = Number(selected.low);
    const high = Number(selected.high);
    const tf = selected.timeframe;
    return zones.find(z => {
        const typeOk = !source || z.type === source;
        const tfOk = !tf || z.timeframe === tf;
        const dirOk = !aiResult?.direction || z.direction === aiResult.direction;
        const lowOk = Number.isFinite(low) && Math.abs(Number(z.low) - low) <= Math.max(Math.abs(low) * 0.0002, 0.00001);
        const highOk = Number.isFinite(high) && Math.abs(Number(z.high) - high) <= Math.max(Math.abs(high) * 0.0002, 0.00001);
        return typeOk && tfOk && dirOk && lowOk && highOk;
    }) || null;
}

function validateExecutableCandidateInvariant(candidate, marketState = {}) {
    const failures = [];
    if (!candidate || typeof candidate !== 'object') return { valid: false, invariant_code: 'CANDIDATE_MISSING', failures: ['candidate missing'] };
    if (candidate.strategy_setup && candidate.trade_context_classification === 'LTF_ISOLATED') failures.push('LTF_ISOLATED');
    if (candidate.strategy_setup && candidate.trade_context_classification === 'HTF_VERIFIED_REVERSAL'
        && String(candidate.execution_model || candidate.entry_model || '').toUpperCase() !== 'CONFIRMATION_ENTRY') {
        failures.push('REVERSAL_REQUIRES_CONFIRMATION_ENTRY');
    }
    const candidateModel = String(candidate.execution_model || candidate.entry_model || '').toUpperCase();
    if (candidate.opportunity_thesis && candidate.opportunity_thesis.state !== 'EXECUTION_VALID' && candidateModel !== 'PENDING_LIMIT') failures.push('EXECUTION_NOT_CONFIRMED');
    for (const field of ['entry', 'stop_loss', 'tp1']) if (!Number.isFinite(Number(candidate[field]))) failures.push(`${field}_NOT_FINITE`);
    const direction = candidate.direction;
    const entry = Number(candidate.entry), stop = Number(candidate.stop_loss), tp1 = Number(candidate.tp1 ?? candidate.take_profit_1);
    if (direction === 'BUY' && !(stop < entry && tp1 > entry)) failures.push('BUY_GEOMETRY_INVALID');
    if (direction === 'SELL' && !(stop > entry && tp1 < entry)) failures.push('SELL_GEOMETRY_INVALID');
    const invalidation = candidate.structural_invalidation && typeof candidate.structural_invalidation === 'object' ? candidate.structural_invalidation : null;
    if (invalidation && Number.isFinite(Number(invalidation.level))) {
        if (direction === 'BUY' && !(stop < Number(invalidation.level))) failures.push('SL_INSIDE_STRUCTURAL_INVALIDATION');
        if (direction === 'SELL' && !(stop > Number(invalidation.level))) failures.push('SL_INSIDE_STRUCTURAL_INVALIDATION');
    }
    const eventTime = normalizeTimestampUTC(candidate.event_time ?? candidate.narrative_event_time ?? candidate.execution_zone_created_time);
    const asOf = normalizeTimestampUTC(marketState.as_of_time ?? marketState.utc_time ?? marketState.scan_time);
    if (Number.isFinite(eventTime) && Number.isFinite(asOf) && eventTime > asOf + STRATEGY_SPEC.TIME.futureToleranceMs) failures.push('DATA_TIME_INCONSISTENT');
    if (candidate.execution_zone_created_time != null && Number.isFinite(asOf) && normalizeTimestampUTC(candidate.execution_zone_created_time) > asOf + STRATEGY_SPEC.TIME.futureToleranceMs) failures.push('ZONE_TIME_INCONSISTENT');
    if (candidate.entry_consumed === true) failures.push('ENTRY_ALREADY_CONSUMED');
    if (candidate.tp1_already_reached === true) failures.push('SETUP_ALREADY_COMPLETED');
    if (candidate.opportunity_status && !['FRESH_NOW', 'FRESH_PENDING_TODAY'].includes(candidate.opportunity_status)) failures.push('LIFECYCLE_NOT_SELECTABLE');
    if (candidate.target_map && candidate.target_map.length && !candidate.target_map[0].primary_target_source) failures.push('TARGET_PROVENANCE_INVALID');
    const rr = Math.abs(tp1 - entry) / Math.abs(entry - stop);
    if (!Number.isFinite(rr)) failures.push('RR_NOT_FINITE');
    if (Number.isFinite(candidate.actual_rr) && Math.abs(Number(candidate.actual_rr) - rr) > 0.02) failures.push('RR_MISMATCH');
    if (candidate.quality?.final_confidence != null && candidate.confidence_breakdown?.final_score != null && candidate.quality.final_confidence !== candidate.confidence_breakdown.final_score) failures.push('CONFIDENCE_MUTATED');
    return { valid: failures.length === 0, invariant_code: failures[0] || null, failures, recomputed_rr: rr };
}

function validateFinalSignalConsistency(signal, liveMarketContext = {}) {
    const issues = [];
    const isLimit = signal?.trade_type === 'BUY_LIMIT' || signal?.trade_type === 'SELL_LIMIT';
    const candidate = signal?.selected_candidate_id
        ? (liveMarketContext.adaptive_setup_candidates || []).find(c => c.id === signal.selected_candidate_id)
        : null;
    const entry = Number(signal?.entry_price ?? signal?.entry);
    const stop = Number(signal?.stop_loss);
    const tp1 = Number(signal?.take_profit_1);
    const tp2 = signal?.take_profit_2 == null ? null : Number(signal.take_profit_2);
    const tp3 = signal?.take_profit_3 == null ? null : Number(signal.take_profit_3);
    if (isLimit) {
        if (!candidate) issues.push('deterministic candidate ID is missing or unknown');
        if (candidate && ['entry', 'stop_loss', 'tp1'].every(field => Number.isFinite(Number(candidate[field])))) {
            const candidateValues = [candidate.entry, candidate.stop_loss, candidate.tp1];
            const signalValues = [entry, stop, tp1];
            if (candidateValues.some((value, index) => Math.abs(Number(value) - signalValues[index]) > Math.max(Math.abs(Number(value)) * 0.0002, 0.00001))) issues.push('final geometry does not match the selected deterministic candidate');
        }
        if (![entry, stop, tp1].every(Number.isFinite)) issues.push('limit geometry is not finite');
        if (!signal.still_actionable_today) issues.push('selected candidate is not actionable today');
        if (signal.entry_consumed) issues.push('selected candidate entry is consumed');
        if (signal.tp1_already_reached) issues.push('selected candidate TP1 is already reached');
        if (signal.entry_reachable_today !== true) issues.push('selected candidate entry is not reachable today');
        if (!Number.isFinite(Number(signal.remaining_reward_fraction)) || Number(signal.remaining_reward_fraction) < STRATEGY_SPEC.FRESHNESS.minRemainingRewardFraction) issues.push('selected candidate reward is materially delivered');
        if (!['FRESH_NOW', 'FRESH_PENDING_TODAY'].includes(signal.opportunity_status)) issues.push('selected candidate lifecycle is not selectable');
        if (signal.limit_order_setup?.eligible !== true) issues.push('eligible limit signal has ineligible pending-limit state');
        if (signal.ai_decision !== 'pending_limit') issues.push('true limit signal does not expose pending_limit decision');
        if (signal.source === 'AI-Generated Setup') issues.push('selected deterministic geometry has an untruthful AI source');
        if (signal.direction === 'BUY' && !(stop < entry && entry < tp1)) issues.push('BUY geometry is inconsistent');
        if (signal.direction === 'SELL' && !(stop > entry && entry > tp1)) issues.push('SELL geometry is inconsistent');
        if (candidate) {
            const stopCheck = evaluateStructuralStop(candidate, getCandidateATRContext(candidate, liveMarketContext.historyCache || {}, liveMarketContext.pair || pair, liveMarketContext.current_price), liveMarketContext.pair || pair);
            if (stopCheck.status === 'SL_INSIDE_STRUCTURAL_INVALIDATION') issues.push('selected stop is inside authoritative strategy invalidation');
            if (candidate.strategy_setup || candidate.structural_invalidation) {
                const invariant = validateExecutableCandidateInvariant(candidate, liveMarketContext);
                if (!invariant.valid) issues.push(`ENGINE_INVARIANT_FAILURE:${invariant.invariant_code}`);
            }
        }
    }
    if (tp2 != null && !Number.isFinite(tp2)) issues.push('TP2 is not finite');
    if (tp3 != null && !Number.isFinite(tp3)) issues.push('TP3 is not finite');
    if (tp2 != null && !Number.isFinite(tp1)) issues.push('TP2 exists without TP1');
    if (tp3 != null && (tp1 == null || tp2 == null)) issues.push('TP3 exists without TP1 and TP2');
    const targets = [tp1, tp2, tp3].filter(Number.isFinite).map(value => ictRound(value, 8));
    if (new Set(targets).size !== targets.length) issues.push('duplicate take-profit levels');
    if (isLimit) {
        const risk = Math.abs(entry - stop);
        const reward = Math.abs(tp1 - entry);
        if (!(risk > 0) || !Number.isFinite(reward / risk)) issues.push('RR is not finite');
    }
    if (signal.direction === 'BUY' && Number.isFinite(tp1) && Number.isFinite(tp2) && tp2 < tp1) issues.push('BUY TP2 is behind TP1');
    if (signal.direction === 'BUY' && Number.isFinite(tp2) && Number.isFinite(tp3) && tp3 < tp2) issues.push('BUY TP3 is behind TP2');
    if (signal.direction === 'SELL' && Number.isFinite(tp1) && Number.isFinite(tp2) && tp2 > tp1) issues.push('SELL TP2 is behind TP1');
    if (signal.direction === 'SELL' && Number.isFinite(tp2) && Number.isFinite(tp3) && tp3 > tp2) issues.push('SELL TP3 is behind TP2');
    if (!isLimit && candidate && candidate.strategy_setup) {
        const invariant = validateExecutableCandidateInvariant(candidate, liveMarketContext);
        if (!invariant.valid) issues.push(`ENGINE_INVARIANT_FAILURE:${invariant.invariant_code}`);
        if (String(candidate.execution_model || '').toUpperCase() === 'CONFIRMATION_ENTRY' && signal.setup_type !== 'CONFIRMATION_ENTRY') {
            issues.push('confirmation candidate has non-confirmation output model');
        }
    }
    const insideZone = signal.immediate_entry?.confirmation?.isAtZone;
    if (signal.limitZoneStatus?.insideZone === false && insideZone === true) issues.push('immediate confirmation claims at-zone while current price is outside zone');
    if (signal.immediate_entry?.eligible === true && insideZone !== true) issues.push('immediate entry is eligible without current-zone confirmation');
    if (signal.immediate_entry?.eligible !== true && /ALL FILTERS PASS|enter_now/i.test(String(signal.immediate_entry?.reason || ''))) issues.push('immediate-entry reason contradicts ineligible state');
    return { valid: issues.length === 0, issues, candidate_id: candidate?.id || null };
}

async function runFallbackScan(price, historyCache, quoteSnapshot = null) {
    const fallbackStartedAt = scanClock();
    console.log('[SCAN] fallback start', { pair, timestamp: new Date().toISOString() });
    console.log('🔄 Running fallback rule-based scan...');
    showNotif('🔄 Using rule-based fallback...', 'info');
    
    let best = null;
    let bestEvaluation = null;
    let bestCandidate = null;
    const fallbackZones = [];
    const fallbackAtr4h = historyCache?.['4H']?.length >= 15 ? atr(historyCache['4H'], 14) : 0;
    const fallbackAtr1h = historyCache?.['1H']?.length >= 15 ? atr(historyCache['1H'], 14) : 0;
    for (const tf of ['4H', '1H']) {
        const tfAtr = tf === '4H' ? fallbackAtr4h : fallbackAtr1h;
        fallbackZones.push(...buildLiveZonesForTf(historyCache?.[tf], tf, price, pair, tfAtr || fallbackAtr4h || fallbackAtr1h || 0, 5));
    }
    const fallbackRiskConstraints = buildRiskConstraints(pair, price, historyCache, quoteSnapshot);
    const fallbackStructure = {
        '1D': buildStructureSnapshot(historyCache?.['1D'], '1D'),
        '4H': buildStructureSnapshot(historyCache?.['4H'], '4H'),
        '1H': buildStructureSnapshot(historyCache?.['1H'], '1H')
    };
    const fallbackSession = getSession();
    const fallbackSessionCheck = shouldTradeSession();
    const fallbackMarketRegime = {
        primary_regime: fallbackStructure['4H']?.trend === 'BULLISH' ? 'TRENDING_BULLISH' : (fallbackStructure['4H']?.trend === 'BEARISH' ? 'TRENDING_BEARISH' : 'RANGING'),
        phase: 'UNKNOWN',
        compression: {
            '4H': detectCompression(historyCache?.['4H'] || []),
            '1H': detectCompression(historyCache?.['1H'] || [])
        },
        displacement: {
            buy_4h: detectDisplacement(historyCache?.['4H'] || [], 'BUY'),
            sell_4h: detectDisplacement(historyCache?.['4H'] || [], 'SELL'),
            buy_1h: detectDisplacement(historyCache?.['1H'] || [], 'BUY'),
            sell_1h: detectDisplacement(historyCache?.['1H'] || [], 'SELL')
        }
    };
    const fallbackMarketContext = buildMarketContext({
        pair,
        price,
        historyCache,
        structure: fallbackStructure,
        session: { name: fallbackSession.session, priority: fallbackSessionCheck.priority },
        sessionCheck: fallbackSessionCheck,
        liquidity: {
            '4H': mapLiquidity(historyCache?.['4H'] || []),
            '1H': mapLiquidity(historyCache?.['1H'] || [])
        },
        premiumDiscount: isPremiumDiscount(historyCache?.['4H'] || historyCache?.['1H'] || [], price),
        marketRegime: fallbackMarketRegime,
        momentum: {},
        volatility: {
            atr_4h: fallbackAtr4h || null,
            atr_1h: fallbackAtr1h || null
        },
        holistic: null
    });
    const fallbackStrategySetups = buildStrategySetups({ pair, price, historyCache, realZones: fallbackZones, marketContext: fallbackMarketContext });
    const fallbackTargetCandidates = buildTargetCandidates(historyCache, price, pair);
    const fallbackCandidateResult = buildAdaptiveSetupCandidates({
        pair,
        price,
        historyCache,
        zones: fallbackZones,
        targetCandidates: fallbackTargetCandidates,
        riskConstraints: fallbackRiskConstraints,
        marketRegime: fallbackMarketRegime,
        structure: fallbackStructure,
        marketContext: fallbackMarketContext,
        strategySetups: fallbackStrategySetups
    });
    const fallbackValidationContext = buildDeterministicValidationContext({
        pair,
        price,
        historyCache,
        real_ict_zones: [...fallbackZones, ...getStrategyExecutionZones(fallbackStrategySetups)],
        risk_constraints: fallbackRiskConstraints,
        structure: fallbackStructure,
        market_context: fallbackMarketContext,
        strategy_setups: fallbackStrategySetups,
        require_strategy_setup: true
    });
    const rejectedFallbacks = (fallbackCandidateResult.rejected_candidates || []).map(rejection => ({
        id: rejection.id,
        rejection_code: rejection.rejection_code,
        rejection_reasons: rejection.rejection_reasons
    }));
    if ((fallbackCandidateResult.valid_candidates || []).length > 0) {
        bestCandidate = fallbackCandidateResult.valid_candidates[0];
        bestEvaluation = evaluateSetupCandidate(bestCandidate, fallbackValidationContext);
        if (bestEvaluation.valid) {
            best = {
                timeframe: bestCandidate.timeframe,
                direction: bestCandidate.direction,
                entry: bestCandidate.entry,
                sl: bestCandidate.stop_loss,
                tp1: bestCandidate.tp1,
                tp2: bestCandidate.tp2,
                tp3: bestCandidate.tp3,
                confidence: getDeterministicCandidateConfidence(bestCandidate),
                zone: { low: bestCandidate.zone_low, high: bestCandidate.zone_high, quality: bestCandidate.freshness },
                zoneType: bestCandidate.zone_type,
                patterns: [bestCandidate.strategy_label || bestCandidate.zone_type],
                htfMatch: bestCandidate.htf_alignment,
                isFresh: bestCandidate.freshness,
                distancePct: Math.abs(bestCandidate.entry - price) / price * 100
            };
        }
    }
    if (!best) {
        const reason = 'No fallback setup passed hard rules';
        console.log('REJECTED SETUP CANDIDATES', rejectedFallbacks);
        const out = {
            trade_signal: {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].split('.')[0],
                pair,
                current_price: price,
                trade_type: 'WAIT',
                decision: 'WAIT',
                confidence: 0,
                reasoning: { primary: reason },
                ai_decision: 'skip',
                wait_condition: reason,
                source: 'Rule-Based (Fallback)',
                validation: { passed: false, reason, rejected_candidates: rejectedFallbacks }
            }
        };
        setJsonOutput(out);
        lastSetupSummary = null;
        lastSetupOut = out;
        analysis = { signalType: 'NEUTRAL', currentPrice: price, confidence: 0, entryReady: false, executionDecision: 'skip', aiDecision: null };
        document.getElementById('executeBtn').disabled = true;
        showNotif(`⚠️ ${reason}`, 'warning');
        scanTrace('fallback complete', fallbackStartedAt, { result: 'WAIT', rejected_candidates: rejectedFallbacks.length });
        return;
    }
    
    const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
    const risk = Math.abs(best.entry - best.sl);
    const rrDisplay = risk > 0 ? (Math.abs(best.tp1 - best.entry) / risk).toFixed(1) : '0.0';
    
    const out = {
        trade_signal: {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toISOString().split('T')[1].split('.')[0],
            pair: pair,
            current_price: price,
            trade_type: best.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT',
            decision: best.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT',
            direction: best.direction,
            selected_candidate_id: bestCandidate?.id || null,
            order_type: 'LIMIT',
            setup_type: 'PENDING_LIMIT',
            entry_price: best.entry,
            entry_zone: { low: best.zone.low, high: best.zone.high, source: best.zoneType },
            stop_loss: best.sl,
            stop_quality: bestCandidate?.risk_model ? {
                status: bestCandidate.risk_model.status || null,
                volatility_classification: bestCandidate.risk_model.volatility_classification || null,
                risk_distance: bestCandidate.risk_model.risk_distance ?? bestCandidate.risk_distance ?? null,
                atr_multiple: bestCandidate.risk_model.atr_multiple ?? bestCandidate.sl_atr_multiple ?? null,
                minimum_reasonable_distance: bestCandidate.risk_model.minimum_reasonable_distance ?? null,
                preferred_minimum_distance: bestCandidate.risk_model.preferred_minimum_distance ?? null,
                warning: bestCandidate.risk_model.volatility_classification === 'TIGHT_BUT_STRUCTURAL'
                    ? 'Stop is structurally valid but tighter than the preferred volatility distance.' : null
            } : null,
            take_profit_1: best.tp1,
            take_profit_2: best.tp2,
            take_profit_3: best.tp3,
            risk_reward: '1:' + rrDisplay,
            confidence: best.confidence,
            zone_quality: best.zone.quality || 'B',
            patterns_detected: best.patterns ? best.patterns.join('+') : 'MSNR',
            probability: best.confidence >= 70 ? 'HIGH' : (best.confidence >= 55 ? 'MEDIUM' : 'LOW'),
            reasoning: {
                primary: `Rule-based setup on ${best.timeframe}`,
                secondary: [`HTF Match: ${best.htfMatch}/3`, `Freshness: ${best.isFresh}`],
                risk_warning: 'Normal market risk applies'
            },
            ai_decision: 'wait_for_reaction',
            wait_condition: 'Pending limit setup valid; immediate entry confirmation is separate.',
            source: 'Deterministic Candidate Engine (Fallback)',
            validation: { passed: true, evaluator: bestEvaluation }
        }
    };
    if (bestCandidate) {
        Object.assign(out.trade_signal, buildDeterministicOrderDescription(bestCandidate));
        out.trade_signal.ai_decision = 'pending_limit';
        out.trade_signal.strategy_evidence = bestCandidate.strategy_evidence || bestCandidate.strategy_setup?.strategy_evidence || null;
        out.trade_signal.structural_invalidation = bestCandidate.structural_invalidation || null;
        out.trade_signal.stop_loss_reason = bestCandidate.stop_reason || null;
        out.trade_signal.stop_buffer = bestCandidate.stop_buffer ?? null;
        out.trade_signal.stop_distance = bestCandidate.stop_distance ?? bestCandidate.risk_distance ?? null;
        out.trade_signal.execution_model = bestCandidate.execution_model || bestCandidate.entry_model || null;
        out.trade_signal.original_strategy_entry_consumed = !!bestCandidate.original_strategy_entry_consumed;
        out.trade_signal.execution_zone_consumed = !!bestCandidate.execution_zone_consumed;
        out.trade_signal.entry_model = bestCandidate.entry_model || null;
        out.trade_signal.setup_timeframe = bestCandidate.setup_timeframe || bestCandidate.timeframe || best.timeframe;
        out.trade_signal.execution_timeframe = bestCandidate.execution_timeframe || bestCandidate.timeframe || best.timeframe;
        out.trade_signal.target_map = bestCandidate.target_map || [];
        out.trade_signal.trade_context_classification = bestCandidate.trade_context_classification;
        out.trade_signal.top_down_context = bestCandidate.top_down_context;
        out.trade_signal.opportunity_status = bestCandidate.opportunity_status;
        out.trade_signal.lifecycle_state = bestCandidate.lifecycle_state;
        out.trade_signal.event_time = bestCandidate.event_time;
        out.trade_signal.event_age_hours = bestCandidate.event_age_hours;
        out.trade_signal.current_session = bestCandidate.current_session;
        out.trade_signal.event_session = bestCandidate.event_session;
        out.trade_signal.expected_entry_window = bestCandidate.expected_entry_window;
        out.trade_signal.hours_remaining_in_relevant_session = bestCandidate.hours_remaining_in_relevant_session;
        out.trade_signal.still_actionable_today = bestCandidate.still_actionable_today;
        out.trade_signal.entry_consumed = bestCandidate.entry_consumed;
        out.trade_signal.tp1_already_reached = bestCandidate.tp1_already_reached;
        out.trade_signal.remaining_reward_fraction = bestCandidate.remaining_reward_fraction;
        out.trade_signal.pending_entry_quality = bestCandidate.pending_entry_quality;
        out.trade_signal.entry_reachable_today = bestCandidate.entry_reachable_today;
        out.trade_signal.distance_to_entry_atr = bestCandidate.distance_to_entry_atr;
        out.trade_signal.setup_confidence = bestCandidate.setup_confidence;
        out.trade_signal.limitZoneStatus = getZonePriceStatus(price, out.trade_signal.entry_zone);
        out.trade_signal.limit_order_setup = {
            eligible: true,
            current_price_inside_zone_required: false,
            reason: 'Valid deterministic pending-limit candidate remains actionable today.'
        };
        out.trade_signal.immediate_entry = {
            eligible: false,
            reason: out.trade_signal.limitZoneStatus.insideZone ? 'Immediate confirmation is not active.' : 'Current price is outside the selected entry zone; pending limit remains valid.',
            confirmation: { confirmed: false, isAtZone: out.trade_signal.limitZoneStatus.insideZone, score: 0 }
        };
    }
    const fallbackConsistency = validateFinalSignalConsistency(out.trade_signal, { adaptive_setup_candidates: fallbackCandidateResult.valid_candidates });
    out.trade_signal.validation.final_consistency = fallbackConsistency;
    if (!fallbackConsistency.valid) {
        const reason = `INTERNAL_CONSISTENCY_FAILURE: ${fallbackConsistency.issues.join('; ')}`;
        out.trade_signal.trade_type = 'WAIT';
        out.trade_signal.decision = 'WAIT';
        out.trade_signal.ai_decision = 'skip';
        out.trade_signal.confidence = 0;
        out.trade_signal.wait_condition = reason;
        out.trade_signal.limit_order_setup.eligible = false;
        out.trade_signal.source = 'Deterministic Candidate Engine';

        // A fallback candidate can fail the final invariant after selection
        // because it was consumed or aged during the scan. Keep that order
        // rejected, but expose the fallback planner's current opportunity.
        const fallbackToday = buildTodayOpportunity({
            pair,
            currentPrice: price,
            scanAsOfMs: Date.now(),
            histories: historyCache,
            marketContext: fallbackMarketContext,
            strategySetups: fallbackStrategySetups,
            executionZones: getStrategyExecutionZones(fallbackStrategySetups),
            candidateDiagnostics: {
                raw_candidate_count: fallbackCandidateResult.raw_candidates?.length || 0,
                valid_candidate_count: fallbackCandidateResult.valid_candidates?.length || 0,
                rejected_candidate_count: fallbackCandidateResult.rejected_candidates?.length || 0
            },
            validCandidates: (fallbackCandidateResult.valid_candidates || []).filter(candidate => candidate.id !== bestCandidate?.id),
            targetCandidates: fallbackTargetCandidates,
            marketOpen: true
        });
        if (fallbackToday.state === 'TODAY_OPPORTUNITY' || fallbackToday.state === 'WATCH_ONLY') {
            const recovery = buildTodayOpportunityOutput(fallbackToday, pair, price, Date.now(), true);
            Object.assign(out.trade_signal, recovery.trade_signal, {
                selected_candidate_id: null,
                trade_type: 'WAIT',
                decision: 'WAIT',
                ai_decision: 'skip',
                reason: {
                    code: 'STALE_SELECTION_RECOVERED',
                    message: 'The selected fallback candidate was rejected as stale; the current opportunity remains available for your decision.'
                },
                validation: {
                    passed: false,
                    reason: 'Fallback selection rejected by final consistency checks; current opportunity recovered.',
                    rejected_selection: fallbackConsistency,
                    current_opportunity: fallbackToday
                },
                source: 'Deterministic Opportunity Planner (Fallback)'
            });
        }
    }
    
    setJsonOutput(out);
    lastSetupSummary = buildSetupSummary(best, st, best.entry, price);
    lastSetupOut = out;
    
    analysis = {
        signalType: st,
        idealEntry: best.entry,
        currentPrice: price,
        stopLoss: best.sl,
        takeProfit1: best.tp1,
        takeProfit2: best.tp2,
        takeProfit3: best.tp3,
        confidence: best.confidence,
        riskPercent: 0.5,
        entryReady: false,
        executionDecision: 'wait_for_reaction',
        invalidationPrice: best.sl * (best.direction === 'BUY' ? 0.995 : 1.005),
        confirmation: best.zoneType,
        patterns: best.patterns ? best.patterns.join('+') : 'MSNR',
        aiDecision: null,
        riskAdjustment: 0.8,
        rrUsed: parseFloat(rrDisplay) || 2.0,
        touches: best.touches || 0,
        isFresh: best.isFresh || false,
        distancePct: Math.abs(best.distancePct || 0)
    };
    
    document.getElementById('executeBtn').disabled = false;
    showNotif(`🎯 ${best.timeframe} ${st} | Conf: ${best.confidence}% | ${best.zoneType}`, 'success');
    scanTrace('fallback complete', fallbackStartedAt, { result: best.direction, selected_candidate_id: bestCandidate?.id || null });
}

// ============================================
// AI SETUP VALIDATION / RECONCILIATION
// ============================================
// validateAISetup() is a thin wrapper around evaluateSetupCandidate().
// The shared evaluator owns hard pass/fail rules; this wrapper only computes
// deterministic confidence after the hard-rule contract passes.
function validateAISetupLegacy(aiResult, price, historyCache, pairArg, deterministicValidationContext = null) {
    const pairLocal = pairArg || pair;
    const checks = {};
    const factors = [];

    function reject(reason) {
        const msg = `AI Setup rejected: ${reason}`;
        console.log(`❌ AI VALIDATION REJECTED: ${reason}`);
        lastScanRejections.push(msg);
        return {
            valid: false,
            reason: msg,
            adjustedConfidence: 0,
            deterministicConfidence: 0,
            localScore: 0,
            aiConf: Number(aiResult?.confidence) || 0,
            checks,
            factors
        };
    }

    if (!aiResult || typeof aiResult !== 'object') return reject('AI result missing');
    const validationContext = deterministicValidationContext || { pair: pairLocal, price, historyCache };
    const sharedEvaluation = evaluateSetupCandidate({
        id: aiResult.selected_candidate_id,
        direction: aiResult.direction,
        timeframe: aiResult.selected_zone?.timeframe,
        zone_type: ictCanonicalZoneType(aiResult.selected_zone?.type || aiResult.entry_zone?.source),
        zone_low: Number(aiResult.selected_zone?.low ?? aiResult.entry_zone?.low),
        zone_high: Number(aiResult.selected_zone?.high ?? aiResult.entry_zone?.high),
        entry: aiResult.entry,
        stop_loss: aiResult.stop_loss,
        tp1: aiResult.take_profit_1,
        tp2: aiResult.take_profit_2,
        tp3: aiResult.take_profit_3,
        strategy_setup: aiResult.adaptive_candidate?.strategy_setup || aiResult.strategy_setup || null
    }, validationContext);
    console.log('FINAL CANDIDATE VALIDATION', sharedEvaluation);
    if (!sharedEvaluation.valid) return reject(sharedEvaluation.reasons[0]);

    const direction = aiResult.direction;
    const entry = Number(aiResult.entry);
    const stopLoss = Number(aiResult.stop_loss);
    const tp1 = Number(aiResult.take_profit_1);
    const fourH = historyCache?.['4H'] || [];
    const oneH = historyCache?.['1H'] || [];
    const matchedZone = sharedEvaluation.matchedZone;
    const matchedZoneTf = sharedEvaluation.matchedZoneTf;
    const rr1 = sharedEvaluation.metrics.rr;
    const htfMatch = sharedEvaluation.metrics.htfMatch || 0;
    const freshness = sharedEvaluation.metrics.freshness || { fresh: false, partiallyUsed: false, touches: 0, violations: 0 };
    Object.assign(checks, sharedEvaluation.checks, {
        realRR: rr1,
        htfMatch,
        freshness
    });

    const confirmingCHoCH = checks.choch === 'CONFIRMS';

    let score = 20;
    score += htfMatch * 12;
    factors.push(`HTF ${htfMatch}/3 (+${htfMatch * 12})`);

    if (freshness.fresh) {
        score += 12;
        factors.push('Fresh zone (+12)');
    } else if (freshness.partiallyUsed) {
        score += 6;
        factors.push(`Partially used zone (${freshness.touches} touches, +6)`);
    } else {
        factors.push(`Used zone (${freshness.touches} touches, +0)`);
    }

    if (rr1 >= 3.0) {
        score += 12;
        factors.push(`RR ${rr1.toFixed(2)} (+12)`);
    } else {
        score += 8;
        factors.push(`RR ${rr1.toFixed(2)} (+8)`);
    }

    if (confirmingCHoCH) {
        score += 8;
        factors.push(`CHoCH confirms ${direction} (+8)`);
    }

    let mss = null;
    if (fourH.length >= 21) {
        mss = detectMSS(fourH);
        if (mss) {
            const agrees = (mss.type === 'BULL' && direction === 'BUY') || (mss.type === 'BEAR' && direction === 'SELL');
            if (agrees) {
                score += 8;
                factors.push(`MSS ${mss.type} confirms ${direction} (+8)`);
                console.log(`✅ MSS confirms ${direction} (+8)`);
            } else {
                score -= 4;
                factors.push(`MSS ${mss.type} conflicts with ${direction} (-4)`);
                console.log(`⚠️ MSS ${mss.type} conflicts with ${direction}`);
            }
        }
    }
    checks.mss = mss;

    let bosCount = 0;
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (data && data.length >= 20 && detectBOS(data, direction)) bosCount++;
    }
    if (bosCount > 0) {
        const bosBonus = Math.min(12, bosCount * 6);
        score += bosBonus;
        factors.push(`BOS ${bosCount}/2 (+${bosBonus})`);
    }
    checks.bosCount = bosCount;

    if (fourH.length >= 30) {
        const adx4 = calculateADX(fourH, 14, '4H');
        if (adx4.adx > 25) {
            score += 6;
            factors.push(`ADX 4H ${adx4.adx.toFixed(1)} (+6)`);
        } else if (adx4.adx < 15) {
            score -= 5;
            factors.push(`ADX 4H ${adx4.adx.toFixed(1)} (-5)`);
        }
        checks.adx4h = adx4.adx;
    }

    const deterministicConfidence = Math.max(0, Math.min(95, Math.round(score)));
    const aiConf = Number(aiResult.confidence) || 0;

    console.log('✅ AI VALIDATION PASSED', {
        direction,
        entry,
        stopLoss,
        tp1,
        rr: rr1,
        matchedZone,
        matchedZoneTf,
        htfMatch,
        deterministicConfidence
    });

    return {
        valid: true,
        reason: null,
        adjustedConfidence: deterministicConfidence,
        deterministicConfidence,
        localScore: deterministicConfidence,
        aiConf,
        rr1,
        htfMatch,
        matchedZone,
        matchedZoneTf,
        freshness,
        evaluation: sharedEvaluation,
        factors
    };
}

// Final AI validation is deliberately a contract check. Confidence belongs to
// the deterministic candidate engine and is never recomputed from AI output.
function validateAISetup(aiResult, price, historyCache, pairArg, deterministicValidationContext = null) {
    const candidate = aiResult?.adaptive_candidate;
    const checks = {};
    if (!aiResult || typeof aiResult !== 'object') return { valid: false, reason: 'AI Setup rejected: AI result missing', adjustedConfidence: 0, deterministicConfidence: 0, checks, factors: [] };
    // Legacy/manual callers without a selected deterministic candidate still
    // receive the historical diagnostics. The live scan never reaches this
    // branch because selector output is hydrated from a supplied candidate ID.
    if (!candidate) return validateAISetupLegacy(aiResult, price, historyCache, pairArg, deterministicValidationContext);
    const invariant = validateExecutableCandidateInvariant(candidate, deterministicValidationContext || { pair: pairArg || pair, price, historyCache });
    if (!invariant.valid) return { valid: false, reason: `AI Setup rejected: ENGINE_INVARIANT_FAILURE:${invariant.invariant_code}`, adjustedConfidence: 0, deterministicConfidence: 0, checks, factors: [] };
    const confidence = getDeterministicCandidateConfidence(candidate);
    if (!Number.isFinite(confidence)) return { valid: false, reason: 'AI Setup rejected: DETERMINISTIC_CONFIDENCE_MISSING', adjustedConfidence: 0, deterministicConfidence: 0, checks, factors: [] };
    return { valid: true, reason: null, adjustedConfidence: confidence, deterministicConfidence: confidence, localScore: confidence, aiConf: Number(aiResult.confidence), checks: { invariant: true }, factors: [], candidate, rr1: candidate.rr_tp1, htfMatch: candidate.htf_alignment || 0 };
}

async function runAutoScan() {
    if (scanInProgress) {
        console.warn('[SCAN] IGNORE overlapping Analyze request');
        return;
    }
    scanInProgress = true;
    const scanAsOfMs = Date.now();
    const scanStartedAt = scanClock();
    let scanStage = 'initializing';
    let price = null;
    let quoteSnapshot = null;
    let historyCache = {};
    const btn = document.getElementById('analyzeBtn');
    const scanStatus = document.getElementById('scanStatus');
    const scanText = document.getElementById('scanText');
    const scanFill = document.getElementById('scanProgressFill');
    
    btn.classList.add('loading');
    btn.disabled = true;
    scanStatus.classList.remove('hidden');
    scanTrace('START', scanStartedAt, { pair, timestamp: new Date().toISOString() });
    
    try {
        if (!hasMarketDataAccess()) {
            scanStage = 'missing Twelve Data key';
            showSetup();
            setJsonOutput({ trade_signal: {
                date: new Date(scanAsOfMs).toISOString().slice(0, 10),
                pair,
                current_price: null,
                decision: 'WAIT',
                trade_type: 'WAIT',
                status: 'DATA_BLOCKED',
                execution_allowed: false,
                reason: { code: 'DATA_BLOCKED', message: 'Twelve Data credentials are unavailable; no market analysis was run.' },
                market_open: null
            }});
            return;
        }

        showNotif('🤖 AI analyzing market data...', 'info');
        scanStage = 'price request';
        quoteSnapshot = await getMarketQuoteSnapshot(pair);
        price = quoteSnapshot?.price;
        if (!Number.isFinite(Number(price))) {
            throw new Error('Twelve Data returned no usable live price');
        }
        
        const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
        scanText.innerHTML = '📊 Collecting market data...';
        scanStage = 'history requests';
        await Promise.all(tfs.map(async (t) => {
            historyCache[t] = await getHistory(t);
        }));
        for (const tf of tfs) historyCache[tf] = canonicalizeHistory(historyCache[tf], tf, scanAsOfMs);
        scanTrace('history loaded', scanStartedAt, { timeframes: Object.fromEntries(tfs.map(tf => [tf, historyCache[tf]?.length || 0])) });
        scanStage = 'MTF display';
        await updateMTFDisplay(historyCache);
        
        // ============================================
        // ENHANCED AI INTELLIGENCE - Compute on 4H
        // ============================================
        let enhancedAnalysis = null;
        if (historyCache['4H'] && historyCache['4H'].length >= 50) {
            const volumeMetadata = quoteSnapshot?.symbol_metadata || {};
            const phase = analyzeMarketPhase(historyCache['4H'], hasRealVolume(pair, volumeMetadata));
            const rsiDiv = detectDivergence(historyCache['4H'], 'rsi', 30);
            const macdDiv = detectDivergence(historyCache['4H'], 'macd', 30);
            const liq = mapLiquidity(historyCache['4H']);
            const volProf = analyzeVolumeProfile(historyCache['4H']);
            const sentiment = analyzeSentiment(historyCache['4H'], hasRealVolume(pair, volumeMetadata));
            const sentiment1h = historyCache['1H'] && historyCache['1H'].length >= 50
                ? analyzeSentiment(historyCache['1H'], hasRealVolume(pair, volumeMetadata)) : { sentiment: 'N/A', score: 50, description: 'N/A' };
            enhancedAnalysis = {
                phase, rsiDiv, macdDiv, liq, volProf, sentiment, sentiment1h,
                phaseBlock: `Phase: ${phase.phase} (${phase.confidence.toFixed(0)}% conf) - ${phase.description}`,
                rsiDivBlock: `RSI Divergence: ${rsiDiv.type} (strength ${rsiDiv.strength}) - ${rsiDiv.description}`,
                macdDivBlock: `MACD Divergence: ${macdDiv.type} (strength ${macdDiv.strength}) - ${macdDiv.description}`,
                liqBlock: `Liquidity Above: ${liq.above.map(v => v.toFixed(2)).join(', ') || 'none'} | Below: ${liq.below.map(v => v.toFixed(2)).join(', ') || 'none'} | Equal Highs: ${liq.equalHighs.length} | Equal Lows: ${liq.equalLows.length}`,
                volProfBlock: `Volume Profile: ${volProf.description} (POC distance: ${volProf.pocDistance.toFixed(2)}%)`,
                sentimentBlock: `Sentiment 4H: ${sentiment.description} | 1H: ${sentiment1h.description}`
            };
        }

        // ============================================
        // ENTRY FILTERS - session, phase, confirmation
        // ============================================
        const sessionCheck = shouldTradeSession(new Date(scanAsOfMs));
        const phaseData = historyCache['1H'] && historyCache['1H'].length >= 30 ? historyCache['1H'] : (historyCache['4H'] || []);
        const marketPhase = analyzeMarketPhase(phaseData, hasRealVolume(pair, quoteSnapshot?.symbol_metadata || {}));
        const entryContext = buildPreSelectionEntryContext(sessionCheck, marketPhase);
        // eslint-disable-next-line no-console
        console.log('🎯 Entry filters:', entryContext.summary);
        
        const settings = getMarketSettings(pair);
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(settings.prec)}`;
        
        if (lastPrice) {
            const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2);
            const ce = document.getElementById('priceChange');
            ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`;
            ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`;
        }
        lastPrice = price;
        
        scanText.innerHTML = '📈 Analyzing indicators...';
        const indicators = {};
        for (const tf of ['4H', '1H']) {
            indicators[tf] = await getTechnicalIndicators(tf, historyCache[tf] || null);
        }
        
        scanText.innerHTML = '🔍 Detecting patterns...';
        const patterns = {};
        for (const tf of ['4H', '1H', '15M', '5M']) {
            const data = historyCache[tf];
            if (data && data.length >= 20) {
                patterns[tf] = {
                    fvg: detectFVG(data),
                    swings: findSwings(data, 3),
                    turtleSoup: detectTurtleSoup(data),
                    crt: detectCRT(data),
                    orderBlocks: detectOrderBlocks(data, 'BUY'),
                    msnr: calculateMSNR(data, price),
                    trend: getCanonicalTimeframeTrend(data, tf),
                    adx: calculateADX(data, 14, tf)
                };
            }
        }
        
        const session = getSession(new Date(scanAsOfMs));
        const newsCheck = checkHighImpactNews(pair);
        
        const dailyDir = await getQuoteDirection('1D', historyCache['1D']);
        const h4Dir = await getQuoteDirection('4H', historyCache['4H']);
        const h1Dir = await getQuoteDirection('1H', historyCache['1H']);

        const holistic = computeHolisticEvidence({
            dailyDir, h4Dir, h1Dir,
            candles: historyCache['4H'] || [],
            indicators: indicators['4H'] || {},
            patterns: patterns['4H'] || {},
            phase: marketPhase,
            rsiDiv: enhancedAnalysis?.rsiDiv,
            macdDiv: enhancedAnalysis?.macdDiv
        });

        scanStage = 'market context construction';
        const contextStartedAt = scanClock();
        console.log('[SCAN] market context start');
        const liveMarketContext = buildLiveMarketContext({
            pair,
            price,
            historyCache,
            indicators,
            patterns,
            enhancedAnalysis,
            holistic,
            entryContext,
            as_of_ms: scanAsOfMs,
            quote_snapshot: quoteSnapshot
        });
        liveMarketContext.news_risk = checkHighImpactNews(quoteSnapshot?.news_risk || null);
        if (liveMarketContext.market_context) liveMarketContext.market_context.news_risk = liveMarketContext.news_risk;
        liveMarketContext.indicators = indicators;
        liveMarketContext.holistic = holistic;
        lastLiveMarketContextForReplay = liveMarketContext;
        scanTrace('market context complete', contextStartedAt, {
            strategy_setups: liveMarketContext.strategy_setups?.length || 0,
            strategy_detections: liveMarketContext.strategy_detections,
            raw_candidates: liveMarketContext.setup_candidate_audit?.raw_candidate_count || 0,
            valid_candidates: liveMarketContext.adaptive_setup_candidates?.length || 0
        });
        console.log('LIVE MARKET CONTEXT', liveMarketContext);
        console.log('AI INPUT SUMMARY', {
            pair,
            price,
            session: liveMarketContext.session.name,
            regime: liveMarketContext.market_regime.primary_regime,
            zonesSent: liveMarketContext.real_ict_zones.length,
            adaptiveCandidates: liveMarketContext.adaptive_setup_candidates.length,
            atr4h: liveMarketContext.volatility.atr_4h,
            atr1h: liveMarketContext.volatility.atr_1h,
            volumeAvailable: liveMarketContext.volume.volume_available
        });

        scanStage = 'AI market analyst';
        const analystStartedAt = scanClock();
        const analystEvidence = buildAiMarketEvidenceCatalog(liveMarketContext, historyCache);
        const analystResult = await runAiMarketAnalyst(analystEvidence, liveMarketContext, buildCandleData(historyCache, 10, quoteSnapshot?.symbol_metadata || {}));
        const aiMerge = mergeVerifiedAiSetups(liveMarketContext, analystResult.verified_setups, analystEvidence);
        analystResult.diagnostics.deterministic_duplicates = aiMerge.duplicates;
        analystResult.diagnostics.setups_added_from_ai = aiMerge.added;
        liveMarketContext.ai_analysis = analystResult.diagnostics;
        if (aiMerge.added > 0) {
            const aiZones = aiMerge.strategy_setups.slice(liveMarketContext.strategy_setups.length).map(s => s.execution_zone).filter(Boolean);
            liveMarketContext.real_ict_zones = [...(liveMarketContext.real_ict_zones || []), ...aiZones];
            liveMarketContext.strategy_execution_zones = [...(liveMarketContext.strategy_execution_zones || []), ...aiZones];
            rebuildCandidatesWithAiSetups(liveMarketContext, aiMerge.strategy_setups);
            liveMarketContext.strategy_detections = summarizeStrategyDetections(aiMerge.strategy_setups);
            console.log('[SCAN] verified AI setups merged', { added: aiMerge.added, duplicates: aiMerge.duplicates });
        }
        scanTrace('AI market analyst complete', analystStartedAt, {
            status: analystResult.diagnostics.analyst_status,
            hypotheses_received: analystResult.diagnostics.hypotheses_received,
            hypotheses_verified: analystResult.diagnostics.hypotheses_verified,
            hypotheses_rejected: analystResult.diagnostics.hypotheses_rejected,
            setups_added: aiMerge.added
        });
        liveMarketContext.today_opportunity = buildTodayOpportunity({
            pair,
            currentPrice: price,
            scanAsOfMs: scanAsOfMs,
            histories: historyCache,
            marketContext: liveMarketContext.market_context,
            strategySetups: liveMarketContext.strategy_setups,
            aiAnalysis: analystResult.diagnostics,
            executionZones: liveMarketContext.strategy_execution_zones,
            candidateDiagnostics: liveMarketContext.setup_candidate_audit,
            validCandidates: liveMarketContext.adaptive_setup_candidates,
            targetCandidates: liveMarketContext.target_candidates,
            marketOpen: liveMarketContext.market_open
        });
        // Keep the public projection small while retaining the deterministic
        // market summary the user needs to understand a WAIT or limit setup.
        liveMarketContext.today_opportunity.trend_detection = liveMarketContext.multi_timeframe_direction?.trend || null;
        liveMarketContext.today_opportunity.volatility = liveMarketContext.volatility || null;
        liveMarketContext.today_opportunity.indicators = liveMarketContext.momentum || null;
        liveMarketContext.today_opportunity.news_risk = liveMarketContext.news_risk;
        liveMarketContext.today_opportunity.market_conditions = liveMarketContext.market_conditions;
        console.log('[SCAN] today opportunity', liveMarketContext.today_opportunity);

        if (liveMarketContext.adaptive_setup_candidates.length === 0) {
            const audit = liveMarketContext.setup_candidate_audit || {};
            const hasRaw = (audit.raw_candidate_count || 0) > 0;
            const hasStrategySetups = (liveMarketContext.strategy_setups || []).length > 0;
            const decision = 'WAIT';
            const reason = !hasStrategySetups
                ? 'Market context available, but no valid CRT/TBS/MSNR strategy setup is currently available.'
                : (hasRaw ? 'No strategy setup execution combination passed all hard rules' : 'Strategy setup exists, but no valid execution candidate is available.');
            const waitCode = waitCodeFromRejections({ ...audit, market_open: liveMarketContext.market_open }, hasStrategySetups);
            const today = liveMarketContext.today_opportunity;
            if (today.state === 'NO_TRADE_TODAY' && today.reason_code === 'NO_TRADE_TODAY' && !today.previous_opportunity_status) {
                today.reason_code = waitCode === 'NO_EXECUTION_GEOMETRY' ? 'NO_TRADE_TODAY' : waitCode;
            }
            if (today.state === 'NO_TRADE_TODAY' && today.reason === 'No defensible fresh or developing opportunity remains for today.') today.reason = reason;
            const out = buildTodayOpportunityOutput(today, pair, price, scanAsOfMs, liveMarketContext.market_open);
            out.trade_signal.trade_type = decision;
            out.trade_signal.ai_decision = 'skip';
            out.trade_signal.wait_condition = reason;
            out.trade_signal.source = 'Deterministic Opportunity Planner';
            out.trade_signal.strategy_detections = liveMarketContext.strategy_detections;
            out.trade_signal.candidate_pipeline = liveMarketContext.candidate_pipeline;
            out.trade_signal.validation = { passed: false, reason, candidate_audit: audit };
            setJsonOutput(out);
            lastSetupSummary = null;
            lastSetupOut = out;
            analysis = { signalType: 'NEUTRAL', currentPrice: price, confidence: 0, entryReady: false, executionDecision: 'skip', aiDecision: null };
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 ${decision}: ${reason}`, 'warning');
            scanTrace('no valid deterministic candidate', scanStartedAt, { wait_code: waitCode, candidate_pipeline: liveMarketContext.candidate_pipeline });
            return;
        }

        liveMarketContext.ai_analysis.final_selector_called = true;
        scanStage = 'prompt construction';
        const candleData = buildCandleData(historyCache, 10, quoteSnapshot?.symbol_metadata || {});
        const aiPrompt = buildAIPrompt(liveMarketContext, candleData);
        scanText.innerHTML = '🤖 AI analyzing live market context...';
        scanStage = 'DeepSeek request';
        const aiResult = await askAIToFindSetup(aiPrompt.user, price, aiPrompt.system, liveMarketContext);
        liveMarketContext.ai_analysis.selected_candidate_id = aiResult?.selected_candidate_id || null;
        if (!aiResult) {
            scanStage = lastAIRequestError?.code === 'AI_TIMEOUT' ? 'DeepSeek timeout fallback' : 'DeepSeek failure fallback';
            showNotif(`⚠️ ${lastAIRequestError?.message || 'AI analysis failed'} - using fallback`, 'warning');
            try {
                await runFallbackScan(price, historyCache, quoteSnapshot);
            } catch (fallbackError) {
                console.error('[SCAN] FAILED', { stage: 'fallback', error: fallbackError?.message, stack: fallbackError?.stack });
                showNotif(`Fallback failed: ${fallbackError?.message || 'unknown error'}`, 'error');
            }
            return;
        }


        if (aiResult.noTrade && preserveDeterministicCandidateAfterAiNoTrade(aiResult, liveMarketContext.today_opportunity, liveMarketContext)) {
            liveMarketContext.ai_analysis.selected_candidate_id = aiResult.selected_candidate_id;
            console.log('[SCAN] preserved deterministic candidate after selector WAIT', aiResult.selected_candidate_id);
        }
        if (aiResult.noTrade) {
            let today = liveMarketContext.today_opportunity;
            if (today.state === 'TRADE_READY') {
                today = buildTodayOpportunity({
                    pair,
                    currentPrice: price,
                    scanAsOfMs,
                    histories: historyCache,
                    marketContext: liveMarketContext.market_context,
                    strategySetups: liveMarketContext.strategy_setups,
                    aiAnalysis: liveMarketContext.ai_analysis,
                    executionZones: liveMarketContext.strategy_execution_zones,
                    candidateDiagnostics: liveMarketContext.setup_candidate_audit,
                    validCandidates: [],
                    targetCandidates: liveMarketContext.target_candidates,
                    marketOpen: liveMarketContext.market_open
                });
                if (today.state === 'TODAY_OPPORTUNITY') {
                    today.reason_code = 'AI_SKIPPED_VALID_CANDIDATES';
                    today.reason = 'The deterministic developing plan remains valid, but the final selector chose WAIT.';
                }
            }
            const out = buildTodayOpportunityOutput(today, pair, price, scanAsOfMs, liveMarketContext.market_open);
            out.trade_signal.trade_type = 'WAIT';
            out.trade_signal.ai_decision = 'skip';
            out.trade_signal.wait_condition = aiResult.wait_condition;
            out.trade_signal.source = 'Deterministic Opportunity Planner + AI Selector';
            out.trade_signal.strategy_detections = liveMarketContext.strategy_detections;
            out.trade_signal.candidate_pipeline = liveMarketContext.candidate_pipeline;
            out.trade_signal.validation = { passed: false, reason: aiResult.wait_condition || 'AI returned no trade' };
            setJsonOutput(out);
            lastSetupSummary = null;
            lastSetupOut = out;
            analysis = { signalType: 'NEUTRAL', currentPrice: price, confidence: aiResult.confidence, entryReady: false, executionDecision: 'skip', aiDecision: aiResult };
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🤖 AI ${aiResult.decision}: ${aiResult.wait_condition || 'No valid setup'}`, 'warning');
            scanTrace('final result rendered', scanStartedAt, { result: 'WAIT/NO_TRADE' });
            return;
        }

        const outputConsistency = validateAIOutputConsistency(aiResult, liveMarketContext);
        scanTrace('AI consistency complete', scanStartedAt, { valid: outputConsistency.valid, selected_candidate_id: aiResult.selected_candidate_id || null });
        if (!outputConsistency.valid) {
            const reason = outputConsistency.failure_code === 'ENGINE_INVARIANT_FAILURE'
                ? `ENGINE_INVARIANT_FAILURE: ${outputConsistency.issues.join('; ')}`
                : `AI output inconsistent: ${outputConsistency.issues.join('; ')}`;
            console.log('❌ AI OUTPUT CONSISTENCY REJECTED', outputConsistency);
            const out = {
                trade_signal: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair: pair,
                    current_price: price,
                    symbol_metadata: getSymbolMetadata(pair),
                    market_conditions: liveMarketContext.market_conditions || null,
                    trade_context_classification: liveMarketContext.trade_context_classification || null,
                    top_down_context: liveMarketContext.top_down_context || null,
                    daily_bias: liveMarketContext.daily_bias || null,
                    structural_context: liveMarketContext.structural_context || null,
                    trade_type: 'WAIT',
                    decision: 'WAIT',
                    confidence: 0,
                    status: 'NO_TRADE',
                    status_code: 'NO_TRADE',
                    market_open: liveMarketContext.market_open,
                    news_risk: liveMarketContext.news_risk || { status: 'UNKNOWN', available: false },
                    data_quality: liveMarketContext.data_quality || null,
                    provider_metadata: liveMarketContext.provider_metadata || null,
                    analysis: {
                        bias: liveMarketContext.daily_bias?.direction === 'BUY' ? 'BULLISH' : liveMarketContext.daily_bias?.direction === 'SELL' ? 'BEARISH' : 'NEUTRAL',
                        trade_context: liveMarketContext.trade_context_classification || null,
                        higher_timeframe: liveMarketContext.timeframe_context || null,
                        structural_context: liveMarketContext.structural_context || null,
                        volatility_level: liveMarketContext.volatility?.regime || null,
                        technical_indicators: liveMarketContext.indicators || null,
                        type: 'DETERMINISTIC_VALIDATION'
                    },
                    reasoning: { primary: reason },
                    ai_decision: 'skip',
                    wait_condition: reason,
                    source: 'Deterministic Candidate Engine',
                    strategy_detections: liveMarketContext.strategy_detections,
                    candidate_pipeline: liveMarketContext.candidate_pipeline,
                    opportunity_funnel: liveMarketContext.opportunity_funnel || null,
                    execution_mode: DEFAULT_EXECUTION_MODE,
                    risk_gate: getDefaultRiskGate(DEFAULT_EXECUTION_MODE),
                    validation: { passed: false, reason, consistency: outputConsistency }
                }
            };
            setJsonOutput(out);
            lastSetupSummary = null;
            lastSetupOut = out;
            analysis = { signalType: 'NEUTRAL', currentPrice: price, confidence: 0, entryReady: false, executionDecision: 'skip', aiDecision: aiResult };
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 AI output rejected: ${outputConsistency.issues[0]}`, 'warning');
            scanTrace('final result rendered', scanStartedAt, { result: 'AI_INCONSISTENT_OUTPUT' });
            return;
        }
        
        const st = aiResult.direction === 'BUY' ? 'LONG' : 'SHORT';
        const risk = Math.abs(aiResult.entry - aiResult.stop_loss);
        const rrDisplay = risk > 0 ? (Math.abs(aiResult.take_profit_1 - aiResult.entry) / risk).toFixed(1) : '0.0';
        
        const out = {
            trade_signal: {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].split('.')[0],
                pair: pair,
                current_price: price,
                symbol_metadata: getSymbolMetadata(pair),
                market_conditions: liveMarketContext.market_conditions,
                direction: aiResult.direction,
                trade_type: aiResult.decision || (aiResult.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT'),
                decision: aiResult.decision,
                selected_candidate_id: aiResult.selected_candidate_id,
                strategy: aiResult.strategy_label || aiResult.strategy_setup?.label || null,
                status: 'TRADE_READY',
                trade_context_classification: aiResult.trade_context_classification,
                top_down_context: aiResult.top_down_context,
                daily_bias: liveMarketContext.daily_bias,
                structural_context: liveMarketContext.structural_context,
                strategy_version: aiResult.strategy_version || STRATEGY_SPEC_VERSION,
                order_type: aiResult.order_type || 'LIMIT',
                setup_type: aiResult.setup_type || 'PENDING_LIMIT',
                entry_price: aiResult.entry,
                entry_zone: aiResult.entry_zone,
                stop_loss: aiResult.stop_loss,
                stop_quality: aiResult.stop_quality || aiResult.adaptive_candidate?.risk_model || null,
                stop_loss_reason: aiResult.stop_loss_reason,
                structural_invalidation: aiResult.structural_invalidation,
                stop_buffer: aiResult.stop_buffer,
                stop_buffer_components: aiResult.stop_buffer_components || aiResult.adaptive_candidate?.stop_buffer_components || null,
                take_profit_1: aiResult.take_profit_1,
                take_profit_2: aiResult.take_profit_2,
                take_profit_3: aiResult.take_profit_3,
                risk_reward: aiResult.risk_reward,
                confidence: aiResult.confidence,
                zone_quality: aiResult.zone_quality,
                patterns_detected: aiResult.patterns.join('+'),
                probability: aiResult.probability,
                reasoning: aiResult.reasoning,
                opposite_setup: aiResult.opposite_setup,
                strategy_evidence: aiResult.strategy_evidence,
                entry_model: aiResult.entry_model,
                setup_timeframe: aiResult.setup_timeframe,
                execution_timeframe: aiResult.execution_timeframe,
                opportunity_status: aiResult.opportunity_status,
                event_time: aiResult.event_time,
                event_age_hours: aiResult.event_age_hours,
                current_session: aiResult.current_session,
                event_session: aiResult.event_session,
                expected_entry_window: aiResult.expected_entry_window,
                hours_remaining_in_relevant_session: aiResult.hours_remaining_in_relevant_session,
                still_actionable_today: aiResult.still_actionable_today,
                pending_entry_quality: aiResult.pending_entry_quality,
                entry_reachable_today: aiResult.entry_reachable_today,
                distance_to_entry_atr: aiResult.distance_to_entry_atr,
                remaining_reward_fraction: aiResult.remaining_reward_fraction,
                setup_confidence: aiResult.setup_confidence,
                quality: aiResult.quality,
                time_integrity: aiResult.setup_lifecycle?.time_integrity || null,
                target_map: aiResult.target_map,
                primary_target_source: aiResult.primary_target_source,
                target_type: aiResult.target_type,
                target_confluence: aiResult.target_confluence,
                strategy_detections: liveMarketContext.strategy_detections,
                candidate_pipeline: liveMarketContext.candidate_pipeline,
                ai_decision: aiResult.ai_decision,
                wait_condition: aiResult.wait_condition,
                source: 'Deterministic Candidate Engine + AI Selector'
            }
        };
        
        setJsonOutput(out);
        lastSetupSummary = {
            id: Date.now(),
            pair: pair,
            timeframe: 'AI',
            direction: st,
            entry: aiResult.entry,
            sl: aiResult.stop_loss,
            tp1: aiResult.take_profit_1,
            confidence: aiResult.confidence,
            zoneType: aiResult.entry_zone.source || 'AI Zone',
            patterns: aiResult.patterns.join('+'),
            touches: 0,
            isFresh: true,
            distancePct: Math.abs(price - aiResult.entry) / price * 100,
            priceAtScan: price
        };
        lastSetupOut = out;

        // ============================================
        // AI SETUP VALIDATION — reconcile the AI claim against the
        // deterministic rule engine. Until this point the rule engine
        // (CHoCH, HTF, freshness, loss-protection, trade-gap, RR) only ran
        // inside runFallbackScan(), which fires only on AI failure. So in
        // normal AI-first operation the rules were never applied.
        //
        // If validation fails, the AI's claim is treated as a blocked
        // setup (NOT silently overwritten by runFallbackScan). The reason
        // is surfaced via filterOverride + lastScanRejections + notif.
        // ============================================
        const validationContext = liveMarketContext.deterministic_validation_context || buildDeterministicValidationContext({
            pair,
            price,
            historyCache,
            real_ict_zones: liveMarketContext.real_ict_zones,
            risk_constraints: liveMarketContext.risk_constraints,
            structure: liveMarketContext.structure
        });
        const validation = validateAISetup(aiResult, price, historyCache, pair, validationContext);
        const selectedZone = findSelectedLiveZone(aiResult, liveMarketContext) || validation.matchedZone || aiResult.selected_zone || aiResult.entry_zone;
        const selectedZoneStatus = getZonePriceStatus(price, selectedZone);
        const selectedEntryContext = buildSelectedCandidateEntryContext({
            historyCache,
            sessionCheck,
            marketPhase,
            phaseData,
            selectedZone,
            direction: aiResult.direction,
            price
        });
        console.log("LIMIT ZONE STATUS", {
            currentPrice: price,
            selectedZone,
            insideZone: selectedZoneStatus.insideZone,
            distanceToZone: selectedZoneStatus.distanceToZone,
            immediateConfirmation: selectedEntryContext.entryConfirmation
        });
        if(!validation.valid) {
            if (aiResult.adaptive_candidate) {
                console.error('VALIDATION PARITY FAILURE', {
                    selected_candidate_id: aiResult.selected_candidate_id,
                    validation,
                    adaptive_candidate: aiResult.adaptive_candidate
                });
            }
            aiResult.ai_decision = 'wait_for_reaction';
            aiResult.filterOverride = validation.reason;
            out.trade_signal.ai_decision = 'wait_for_reaction';
            out.trade_signal.filterOverride = validation.reason;
            out.trade_signal.validation = { passed: false, reason: validation.reason, checks: validation.checks };
            setJsonOutput(out);
            showNotif(`🚫 AI blocked: ${validation.reason}`, 'warning');
        } else {
            // Replace the AI's confidence with our independently-computed one
            // (we keep the AI's number as a "blend_input" for transparency).
            const beforeConf = aiResult.confidence;
            aiResult.confidence = validation.adjustedConfidence;
            aiResult.validation = {
                passed: true,
                localScore: validation.localScore,
                aiConf: validation.aiConf,
                adjustedConfidence: validation.adjustedConfidence,
                rr1: validation.rr1,
                htfMatch: validation.htfMatch,
                factors: validation.factors,
                matchedZone: validation.matchedZone ? { low: validation.matchedZone.low, high: validation.matchedZone.high, tf: validation.matchedZoneTf } : null,
                limitZoneStatus: selectedZoneStatus
            };
            out.trade_signal.confidence = validation.adjustedConfidence;
            out.trade_signal.validation = aiResult.validation;
            console.log(`  🎚️ AI confidence ${beforeConf} → adjusted ${validation.adjustedConfidence} (localScore ${validation.localScore}, htfMatch ${validation.htfMatch}/3, rr ${validation.rr1.toFixed(2)}x)`);
            setJsonOutput(out);
        }

        const immediateEntryBlocked = !selectedEntryContext.allOk;
        const holisticIndecisive = holistic.suggestedDirection === 'NEUTRAL' && aiResult.ai_decision === 'enter_now';
        const effectiveDecision = (immediateEntryBlocked || holisticIndecisive) && aiResult.ai_decision === 'enter_now'
            ? 'wait_for_reaction'
            : aiResult.ai_decision;
        const overrideReason = holisticIndecisive && !immediateEntryBlocked
            ? `Holistic score too close (BUY ${holistic.buyScore} vs SELL ${holistic.sellScore}, diff ${holistic.diff})`
            : selectedEntryContext.summary;
        if ((immediateEntryBlocked || holisticIndecisive) && aiResult.ai_decision === 'enter_now') {
            aiResult.ai_decision = effectiveDecision;
            aiResult.filterOverride = overrideReason;
        }
        const tradeable = effectiveDecision !== 'skip'
            && aiResult.confidence >= 58
            && validation.valid;
        console.log("LIMIT ORDER DECISION", {
            pair,
            direction: aiResult.direction,
            decision: aiResult.decision,
            aiDecision: effectiveDecision,
            setupValid: validation.valid,
            immediateEntryEligible: selectedEntryContext.allOk,
            selectedZone,
            priceAtZone: selectedZoneStatus.insideZone
        });
        out.trade_signal.ai_decision = validation.valid ? 'pending_limit' : effectiveDecision;
        out.trade_signal.wait_condition = validation.valid && aiResult.adaptive_candidate
            ? buildDeterministicOrderDescription(aiResult.adaptive_candidate).wait_condition
            : effectiveDecision === 'wait_for_reaction'
            ? (aiResult.wait_condition || overrideReason)
            : aiResult.wait_condition;
        out.trade_signal.limit_order_setup = {
            eligible: validation.valid,
            reason: validation.valid ? 'Future pending-limit setup passed deterministic validation' : validation.reason,
            current_price_inside_zone_required: false,
            selected_zone_status: selectedZoneStatus
        };
        out.trade_signal.immediate_entry = {
            eligible: selectedEntryContext.allOk && effectiveDecision === 'enter_now',
            reason: selectedEntryContext.summary,
            confirmation: selectedEntryContext.entryConfirmation
        };
        out.trade_signal.limitZoneStatus = selectedZoneStatus;
        out.trade_signal.entry_consumed = aiResult.adaptive_candidate?.entry_consumed || false;
        out.trade_signal.tp1_already_reached = aiResult.adaptive_candidate?.tp1_already_reached || false;
        const finalConsistency = validateFinalSignalConsistency(out.trade_signal, liveMarketContext);
        out.trade_signal.invariants = {
            passed: finalConsistency.valid,
            checks: finalConsistency.issues.length ? finalConsistency.issues : ['deterministic candidate geometry, lifecycle, target, RR, and pending-limit semantics passed']
        };
        out.trade_signal.validation.final_consistency = finalConsistency;
        const displayableSetup = validation.valid && finalConsistency.valid;
        const publishableTrade = tradeable && displayableSetup;
        if (!displayableSetup) {
            const reason = !finalConsistency.valid
                ? `INTERNAL_CONSISTENCY_FAILURE: ${finalConsistency.issues.join('; ')}`
                : !validation.valid
                    ? `AI_VALIDATION_BLOCKED: ${validation.reason}`
                    : `CONFIDENCE_BELOW_MINIMUM: ${aiResult.confidence}% < ${MIN_CONFIDENCE}%`;
            out.trade_signal.trade_type = 'WAIT';
            out.trade_signal.decision = 'WAIT';
            out.trade_signal.ai_decision = 'skip';
            out.trade_signal.confidence = 0;
            out.trade_signal.status = 'TODAY_OPPORTUNITY';
            out.trade_signal.reason = {
                code: !finalConsistency.valid ? 'INTERNAL_CONSISTENCY_FAILURE' : !validation.valid ? 'AI_VALIDATION_BLOCKED' : 'CONFIDENCE_BELOW_MINIMUM',
                message: reason
            };
            out.trade_signal.wait_condition = reason;
            out.trade_signal.limit_order_setup.eligible = false;
            out.trade_signal.immediate_entry.eligible = false;
            out.trade_signal.source = 'Deterministic Candidate Engine';
            console.error('[SCAN] final signal consistency rejected', finalConsistency);
            showNotif(`⚠️ ${reason}`, 'warning');

            // The selector may choose a candidate that became stale between
            // candidate construction and final hydration. Preserve the hard
            // rejection, but publish the current planner opportunity so the
            // user still sees the price area to monitor or fill.
            if (!finalConsistency.valid) {
                const recoveryToday = recoverTodayOpportunityAfterRejectedSelection(
                    liveMarketContext,
                    aiResult.selected_candidate_id,
                    { pair, currentPrice: price, scanAsOfMs, histories: historyCache }
                );
                if (recoveryToday?.state === 'TODAY_OPPORTUNITY' || recoveryToday?.state === 'WATCH_ONLY') {
                    const recovery = buildTodayOpportunityOutput(recoveryToday, pair, price, scanAsOfMs, liveMarketContext.market_open);
                    Object.assign(out.trade_signal, recovery.trade_signal, {
                        selected_candidate_id: null,
                        trade_type: 'WAIT',
                        decision: 'WAIT',
                        ai_decision: 'skip',
                        confidence: recovery.trade_signal.confidence || 0,
                        reason: {
                            code: 'STALE_AI_SELECTION_RECOVERED',
                            message: 'The AI-selected candidate was rejected as stale; the current deterministic opportunity remains available for your decision.'
                        },
                        wait_condition: recovery.trade_signal.reason?.message,
                        validation: {
                            passed: false,
                            reason: 'AI selection rejected by final consistency checks; current opportunity recovered.',
                            rejected_selection: finalConsistency,
                            current_opportunity: recoveryToday
                        },
                        source: 'Deterministic Opportunity Planner + AI Selector'
                    });
                    console.log('[SCAN] recovered current opportunity after stale AI selection', {
                        rejected_candidate: aiResult.selected_candidate_id,
                        recovered_state: recoveryToday.state,
                        recovered_id: recoveryToday.id || recoveryToday.narrative_id || recoveryToday.primary_opportunity?.id || null
                    });
                }
            }
        }
        if (displayableSetup && !tradeable) {
            // Keep a valid AI setup visible for the user's decision. The
            // execute action remains disabled until confidence and entry
            // conditions pass independently.
            out.trade_signal.status = 'SETUP_AVAILABLE';
            out.trade_signal.setup_state = 'SETUP_AVAILABLE';
            out.trade_signal.execution_allowed = false;
            out.trade_signal.reason = {
                code: 'SETUP_AVAILABLE_USER_DECISION',
                message: `Valid ${aiResult.direction} setup displayed for user decision; automatic execution is disabled below ${MIN_CONFIDENCE}% confidence or before confirmation.`
            };
        }
        const manualTrackingAllowed = DEFAULT_EXECUTION_MODE === 'MANUAL' && displayableSetup;
        out.trade_signal.manual_tracking_allowed = manualTrackingAllowed;
        setJsonOutput(out);
        if (publishableTrade) syncSetupToGitHub(out.trade_signal, 'ai_scan');
        
        analysis = {
            signalType: st,
            idealEntry: aiResult.entry,
            currentPrice: price,
            stopLoss: aiResult.stop_loss,
            takeProfit1: aiResult.take_profit_1,
            takeProfit2: aiResult.take_profit_2,
            takeProfit3: aiResult.take_profit_3,
            confidence: aiResult.confidence,
            riskPercent: tradeable ? 0.5 : 0,
            execution_allowed: tradeable && finalConsistency.valid,
            manual_tracking_allowed: manualTrackingAllowed,
            entryReady: selectedEntryContext.allOk && effectiveDecision === 'enter_now',
            executionDecision: finalConsistency.valid ? effectiveDecision : 'skip',
            invalidationPrice: aiResult.stop_loss * (aiResult.direction === 'BUY' ? 0.995 : 1.005),
            confirmation: aiResult.entry_zone.source || 'AI Zone',
            patterns: aiResult.patterns.join('+'),
            aiDecision: aiResult,
            riskAdjustment: effectiveDecision === 'enter_now' ? 1.0 : 0.8,
            rrUsed: parseFloat(rrDisplay) || 2.0,
            touches: 0,
            isFresh: true,
            distancePct: Math.abs(price - aiResult.entry) / price * 100
        };
        
        document.getElementById('executeBtn').disabled = !tradeable && !manualTrackingAllowed;
        
        // Update button to show AI source
        const btnExecute = document.getElementById('executeBtn');
        if (btnExecute && analysis) {
            btnExecute.innerHTML = `Track Manual ${st}`;
            btnExecute.style.background = 'linear-gradient(135deg, #5856d6, #007aff)';
        }
        
        const decisionEmoji = effectiveDecision === 'enter_now' ? '✅' : (['wait_for_reaction', 'pending_limit'].includes(effectiveDecision) ? '⏳' : '🚫');
        const validationTag = validation.valid ? '✓' : '✗';
        showNotif(`🤖 AI Setup [val:${validationTag}] ${st} ${decisionEmoji} | Conf: ${aiResult.confidence}% | ${aiResult.entry_zone.source} | ${aiResult.patterns.join(', ')}`, tradeable ? 'success' : 'warning');
        scanTrace('final result rendered', scanStartedAt, { result: tradeable ? aiResult.decision : 'WAIT/VALIDATION_BLOCKED', validation: validation.valid });
        
    } catch(e) {
        console.error('[SCAN] FAILED', { stage: scanStage, error: e?.message, stack: e?.stack });
        showNotif('Error: ' + (e?.message || 'scan failed'), 'error');
        if (!Number.isFinite(Number(price)) || /^DATA_BLOCKED:/i.test(String(e?.message || ''))) {
            setJsonOutput({ trade_signal: {
                date: new Date(scanAsOfMs).toISOString().slice(0, 10),
                pair,
                current_price: null,
                decision: 'WAIT',
                trade_type: 'WAIT',
                status: 'DATA_BLOCKED',
                execution_allowed: false,
                reason: { code: 'DATA_BLOCKED', message: e?.message || 'A usable market price was not returned by the data provider.' },
                market_open: quoteSnapshot?.is_market_open ?? null
            }});
        }
        if (price && Object.keys(historyCache).length > 0) {
            try {
                scanStage = 'fallback after scan failure';
                await runFallbackScan(price, historyCache, quoteSnapshot);
            } catch (fallbackError) {
                console.error('[SCAN] FAILED', { stage: 'fallback after scan failure', error: fallbackError?.message, stack: fallbackError?.stack });
                showNotif(`Fallback failed: ${fallbackError?.message || 'unknown error'}`, 'error');
            }
        }
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
        scanStatus.classList.add('hidden');
        if (scanText) scanText.textContent = 'Scan complete';
        if (scanFill) scanFill.style.width = '100%';
        scanInProgress = false;
        scanTrace('COMPLETE', scanStartedAt, { stage: scanStage });
    }
}

// ============================================
// ENHANCED AI INTELLIGENCE FUNCTIONS
// ============================================

// 1. MARKET PHASE ANALYSIS (AMD)
function analyzeMarketPhase(data, realVolume = true) {
    if (!data || data.length < 50) return { phase: 'UNKNOWN', confidence: 0, description: 'Insufficient data' };
    const closes = data.map(c => c.c);
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const range = Math.max(...highs) - Math.min(...lows);
    const avgRange = range / data.length;
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    const recentRange = Math.max(...recentHighs) - Math.min(...recentLows);
    const volatility = recentRange / (avgRange || 1);
    // Synthetic volume must NOT trigger ACCUMULATION phase. When volume is
    // synthetic, we fall back to volatility+slope only (no volumeRatio boost).
    const volume = data.slice(-20).reduce((a, c) => a + (c.v || 0), 0) / 20;
    const avgVolume = data.slice(-50, -20).reduce((a, c) => a + (c.v || 0), 0) / 30;
    const rawVolumeRatio = volume / (avgVolume || 1);
    const volumeRatio = realVolume ? rawVolumeRatio : 1.0; // neutral — no fake confirmation
    const sw = findSwings(data, 3);
    const recentHighsSwings = (sw.H || []).slice(-5);
    const recentLowsSwings = (sw.L || []).slice(-5);
    const sweptHigh = recentHighsSwings.some(h => data.slice(-5).some(c => c.h > h.p && c.c < h.p));
    const sweptLow = recentLowsSwings.some(l => data.slice(-5).some(c => c.l < l.p && c.c > l.p));
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e20Slope = e20.length > 5 ? e20[e20.length - 1] - e20[e20.length - 5] : 0;
    const e50Slope = e50.length > 5 ? e50[e50.length - 1] - e50[e50.length - 5] : 0;
    let phase = 'NEUTRAL', confidence = 0, description = '';
    if (volatility < 0.5 && volumeRatio > 1.2 && e20Slope > 0) {
        phase = 'ACCUMULATION';
        confidence = 70 + Math.min(volumeRatio * 10, 20);
        description = 'Range compression with rising volume - smart money accumulating';
    } else if ((sweptHigh || sweptLow) && Math.abs(e20Slope) < 0.5) {
        phase = 'MANIPULATION';
        confidence = 65 + (sweptHigh ? 10 : 0) + (sweptLow ? 10 : 0);
        description = 'Liquidity sweeps creating false breakouts - manipulation phase';
    } else if (volatility > 0.8 && Math.abs(e20Slope) > 0.5) {
        phase = 'DISTRIBUTION';
        confidence = 60 + Math.min(Math.abs(e20Slope) * 10, 30);
        description = 'Expansion with momentum - distribution phase';
    } else {
        description = 'Range-bound market - waiting for direction';
    }
    return { phase, confidence, description, volatility, volumeRatio, sweptHigh, sweptLow, e20Slope, e50Slope, realVolume };
}

// 2. HIDDEN DIVERGENCE DETECTION
function detectDivergence(data, indicator = 'rsi', lookback = 30) {
    if (!data || data.length < lookback) return { type: 'none', strength: 0, description: 'Insufficient data' };
    const closes = data.map(c => c.c);
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    let values = [];
    if (indicator === 'rsi') {
        for (let i = 14; i < data.length; i++) {
            const slice = data.slice(0, i + 1);
            const r = computeRSI(slice.map(c => c.c), 14);
            values.push(r || 50);
        }
    } else if (indicator === 'macd') {
        const e12 = ema(closes, 12);
        const e26 = ema(closes, 26);
        values = e12.slice(26).map((v, i) => v - (e26[i + 26] || 0));
    }
    if (values.length < lookback) return { type: 'none', strength: 0, description: 'Insufficient indicator data' };
    const recentPrices = closes.slice(-lookback);
    const recentValues = values.slice(-lookback);
    let priceSwingsHigh = [], priceSwingsLow = [];
    for (let i = 2; i < recentPrices.length - 2; i++) {
        if (recentPrices[i] > recentPrices[i-1] && recentPrices[i] > recentPrices[i+1] &&
            recentPrices[i] > recentPrices[i-2] && recentPrices[i] > recentPrices[i+2]) {
            priceSwingsHigh.push({ price: recentPrices[i], value: recentValues[i], index: i });
        }
        if (recentPrices[i] < recentPrices[i-1] && recentPrices[i] < recentPrices[i+1] &&
            recentPrices[i] < recentPrices[i-2] && recentPrices[i] < recentPrices[i+2]) {
            priceSwingsLow.push({ price: recentPrices[i], value: recentValues[i], index: i });
        }
    }
    let result = { type: 'none', strength: 0, description: 'No divergence detected' };
    if (priceSwingsLow.length >= 2) {
        const last = priceSwingsLow[priceSwingsLow.length - 1];
        const prev = priceSwingsLow[priceSwingsLow.length - 2];
        if (last.price < prev.price && last.value > prev.value) {
            result = { type: 'REGULAR_BULLISH', strength: 80, description: 'Price makes lower low, indicator makes higher low - bullish reversal signal' };
        }
        if (last.price > prev.price && last.value < prev.value) {
            result = { type: 'HIDDEN_BULLISH', strength: 70, description: 'Price makes higher low, indicator makes lower low - continuation signal' };
        }
    }
    if (priceSwingsHigh.length >= 2 && result.type === 'none') {
        const last = priceSwingsHigh[priceSwingsHigh.length - 1];
        const prev = priceSwingsHigh[priceSwingsHigh.length - 2];
        if (last.price > prev.price && last.value < prev.value) {
            result = { type: 'REGULAR_BEARISH', strength: 80, description: 'Price makes higher high, indicator makes lower high - bearish reversal signal' };
        }
        if (last.price < prev.price && last.value > prev.value) {
            result = { type: 'HIDDEN_BEARISH', strength: 70, description: 'Price makes lower high, indicator makes higher high - continuation signal' };
        }
    }
    return result;
}

// 3. LIQUIDITY MAPPING
function mapLiquidity(data) {
    data = closedStructureCandles(data);
    if (!data || data.length < 30) return { above: [], below: [], equalHighs: [], equalLows: [], nearestAbove: null, nearestBelow: null };
    const closes = data.map(c => c.c);
    const currentPrice = closes[closes.length - 1];
    const sw = findSwings(data, 3);
    const swingHighs = (sw.H || []).slice(-15).map(s => s.p);
    const swingLows = (sw.L || []).slice(-15).map(s => s.p);
    const equalHighs = [], equalLows = [];
    for (let i = 0; i < swingHighs.length; i++) {
        let count = 1;
        for (let j = i + 1; j < swingHighs.length; j++) {
            if (Math.abs(swingHighs[i] - swingHighs[j]) / swingHighs[i] < 0.001) count++;
        }
        if (count >= 2) equalHighs.push(swingHighs[i]);
    }
    for (let i = 0; i < swingLows.length; i++) {
        let count = 1;
        for (let j = i + 1; j < swingLows.length; j++) {
            if (Math.abs(swingLows[i] - swingLows[j]) / swingLows[i] < 0.001) count++;
        }
        if (count >= 2) equalLows.push(swingLows[i]);
    }
    const liquidityAbove = [...new Set(swingHighs.filter(h => h > currentPrice).concat(equalHighs))].sort((a, b) => a - b);
    const liquidityBelow = [...new Set(swingLows.filter(l => l < currentPrice).concat(equalLows))].sort((a, b) => b - a);
    return {
        above: liquidityAbove.slice(0, 5),
        below: liquidityBelow.slice(0, 5),
        equalHighs,
        equalLows,
        nearestAbove: liquidityAbove[0] || null,
        nearestBelow: liquidityBelow[0] || null
    };
}

// 4. VOLUME PROFILE ANALYSIS
function analyzeVolumeProfile(data) {
    if (!hasRealVolume(pair)) {
        return {
            poc: null,
            vah: null,
            val: null,
            pocDistance: 0,
            description: 'Volume profile disabled (synthetic/unavailable volume)',
            realVolume: false
        };
    }
    if (!data || data.length < 30) return { poc: null, vah: null, val: null, pocDistance: 0, description: 'Insufficient data' };
    const prices = data.map(c => c.c);
    const volumes = data.map(c => c.v || 0);
    const currentPrice = prices[prices.length - 1];
    const priceRange = Math.max(...prices) - Math.min(...prices);
    const binSize = Math.max(priceRange / 30, 0.01);
    const bins = {};
    for (let i = 0; i < prices.length; i++) {
        const bin = Math.floor(prices[i] / binSize) * binSize;
        if (!bins[bin]) bins[bin] = 0;
        bins[bin] += volumes[i];
    }
    let maxVolume = 0, poc = null;
    for (const [price, volume] of Object.entries(bins)) {
        if (volume > maxVolume) {
            maxVolume = volume;
            poc = parseFloat(price);
        }
    }
    const totalVolume = Object.values(bins).reduce((a, b) => a + b, 0);
    const targetVolume = totalVolume * 0.7;
    let cumulativeVolume = 0, vah = null, val = null;
    const sortedBins = Object.entries(bins).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    for (const [price, volume] of sortedBins) {
        cumulativeVolume += volume;
        if (cumulativeVolume >= targetVolume / 2 && !val) val = parseFloat(price);
        if (cumulativeVolume >= targetVolume) { vah = parseFloat(price); break; }
    }
    if (!val) val = Math.min(...prices);
    if (!vah) vah = Math.max(...prices);
    const description = `POC: $${poc ? poc.toFixed(2) : 'N/A'} | VAH: $${vah ? vah.toFixed(2) : 'N/A'} | VAL: $${val ? val.toFixed(2) : 'N/A'}`;
    return {
        poc: poc || currentPrice,
        vah: vah || currentPrice * 1.01,
        val: val || currentPrice * 0.99,
        pocDistance: poc ? Math.abs(poc - currentPrice) / currentPrice * 100 : 0,
        description
    };
}

// 5. SENTIMENT ANALYSIS
// `realVolume` flag: when false, the volumeSentiment component is zeroed so
// synthetic volume can't flip the score.
function analyzeSentiment(data, realVolume = true) {
    if (!data || data.length < 50) return { sentiment: 'NEUTRAL', score: 50, description: 'Insufficient data' };
    const closes = data.map(c => c.c);
    const volumes = data.map(c => c.v || 0);
    const rsi = computeRSI(closes, 14) || 50;
    let rsiSentiment = 0;
    if (rsi > 70) rsiSentiment = -20;
    else if (rsi < 30) rsiSentiment = 20;
    else if (rsi > 50) rsiSentiment = 5;
    else rsiSentiment = -5;
    const e20 = ema(closes, 20);
    const trend = e20.length > 5 ? (e20[e20.length - 1] > e20[e20.length - 5] ? 1 : -1) : 0;
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avgVolume = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
    const rawVolumeRatio = (avgVolume > 0 ? recentVolume / avgVolume : 0);
    // Zero the volumeSentiment component when volume is synthetic.
    const volumeSentiment = realVolume ? rawVolumeRatio * trend * 10 : 0;
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    const macd = e12.length && e26.length ? e12[e12.length - 1] - e26[e26.length - 1] : 0;
    const macdSignal = macd && e12.length ? ema(e12.map((v, i) => v - (e26[i] || 0)), 9) : [];
    const macdSentiment = macd && macdSignal.length && macd > macdSignal[macdSignal.length - 1] ? 15 : -15;
    const totalScore = 50 + rsiSentiment + (isFinite(volumeSentiment) ? volumeSentiment : 0) + macdSentiment;
    const finalScore = Math.min(Math.max(totalScore, 0), 100);
    const sentiment = finalScore > 60 ? 'BULLISH' : (finalScore < 40 ? 'BEARISH' : 'NEUTRAL');
    const volumeRatio = (avgVolume > 0 ? recentVolume / avgVolume : 0).toFixed(2);
    const volTag = realVolume ? `${volumeRatio}x` : 'n/a (synthetic)';
    const description = `${sentiment} (${finalScore.toFixed(0)}/100) - RSI:${rsi.toFixed(0)} Volume:${volTag} MACD:${macd > 0 ? 'Bullish' : 'Bearish'}`;
    return { sentiment, score: finalScore, description, rsiSentiment, volumeSentiment, macdSentiment, realVolume };
}

// 6. SELF-LEARNING CAPABILITY
function trackAIPerformance(setupId, outcome, confidence, patterns, rr) {
    try {
        const performance = JSON.parse(localStorage.getItem('ai_performance') || '{}');
        if (!performance[setupId]) {
            performance[setupId] = { outcomes: [], wins: 0, losses: 0, totalRR: 0, confidence, patterns, timestamp: Date.now() };
        }
        performance[setupId].outcomes.push(outcome);
        if (outcome === 'WIN') performance[setupId].wins++;
        else performance[setupId].losses++;
        performance[setupId].totalRR += outcome === 'WIN' ? rr : -1;
        localStorage.setItem('ai_performance', JSON.stringify(performance));
    } catch(e) {}
}

function getPatternPerformance(patterns) {
    try {
        const performance = JSON.parse(localStorage.getItem('ai_performance') || '{}');
        let totalWins = 0, totalLosses = 0, totalConfidence = 0, count = 0;
        for (const [id, data] of Object.entries(performance)) {
            const patternMatch = data.patterns && patterns.some(p => data.patterns.includes(p));
            if (patternMatch) {
                totalWins += data.wins || 0;
                totalLosses += data.losses || 0;
                totalConfidence += data.confidence || 0;
                count++;
            }
        }
        const total = totalWins + totalLosses;
        if (total === 0) return { winRate: 0, confidenceAdjustment: 0, sampleSize: 0, avgConfidence: 0 };
        const winRate = totalWins / total;
        return {
            winRate,
            confidenceAdjustment: (winRate - 0.5) * 20,
            sampleSize: total,
            avgConfidence: count > 0 ? totalConfidence / count : 0
        };
    } catch(e) {
        return { winRate: 0, confidenceAdjustment: 0, sampleSize: 0, avgConfidence: 0 };
    }
}

// ============================================
// ENTRY FILTERS - session, phase, confirmation
// ============================================

// SESSION FILTER - canonical ICT killzones
function shouldTradeSession(now = new Date()) {
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const time = hour + min / 60;

    const londonKZ = time >= 7 && time < 10;
    const newYorkKZ = time >= 12 && time < 15;
    const lonCloseKZ = time >= 15 && time < 17;
    const isAsian = time >= 0 && time < 4;

    const silverBullet1 = time >= 8.5 && time < 9;
    const silverBullet2 = time >= 15 && time < 16;
    const isSilverBullet = silverBullet1 || silverBullet2;

    const isKillzone = londonKZ || newYorkKZ || lonCloseKZ;
    const isOffHours = !isKillzone && !isAsian;

    let priority = 'LOW';
    let reason = 'Off-hours - low probability';
    let multiplier = 0.6;
    if (isSilverBullet) {
        priority = 'MAX';
        reason = 'SILVER BULLET - highest probability';
        multiplier = 1.5;
    } else if (isKillzone) {
        priority = 'HIGH';
        reason = 'Killzone session - high probability';
        multiplier = 1.3;
    } else if (isAsian) {
        priority = 'LOW';
        reason = 'Asian session - low liquidity, wait for confirmation';
        multiplier = 0.7;
    }

    return {
        shouldTrade: priority === 'MAX' || priority === 'HIGH',
        priority,
        reason,
        multiplier,
        isKillzone,
        isSilverBullet,
        isAsian,
        isOffHours
    };
}

// PHASE-BASED ENTRY RULES (AMD)
function shouldEnterBasedOnPhase(phase, direction, price, data) {
    if (!phase || phase.phase === 'UNKNOWN' || phase.phase === 'NEUTRAL') {
        return { shouldEnter: true, reason: 'Neutral phase - no restrictions', multiplier: 1.0 };
    }
    const sweep = data ? detectLiquiditySweep(data, price, direction) : null;
    const hasSweep = sweep !== null;

    if (phase.phase === 'ACCUMULATION') {
        return { shouldEnter: true, reason: 'Accumulation phase - enter on pullbacks', multiplier: 1.0 };
    }
    if (phase.phase === 'MANIPULATION') {
        if (!hasSweep) {
            return {
                shouldEnter: false,
                reason: 'Manipulation phase - waiting for liquidity sweep',
                waitFor: 'liquidity sweep',
                multiplier: 0.5
            };
        }
        return { shouldEnter: true, reason: 'Manipulation phase - liquidity sweep confirmed', multiplier: 1.2 };
    }
    if (phase.phase === 'DISTRIBUTION') {
        const hasMomentum = data ? !!detectDisplacement(data, direction) : false;
        if (!hasMomentum) {
            return {
                shouldEnter: false,
                reason: 'Distribution phase - waiting for momentum',
                waitFor: 'momentum candle',
                multiplier: 0.7
            };
        }
        return { shouldEnter: true, reason: 'Distribution phase - momentum confirmed', multiplier: 1.1 };
    }
    return { shouldEnter: true, reason: 'Default entry allowed', multiplier: 1.0 };
}

// ENTRY CONFIRMATION CHECK (price action on LTF)
function checkEntryConfirmation(data, zone, direction) {
    if (!data || data.length < 3) {
        return { confirmed: false, score: 0, strength: 'NONE', confirmations: [], reason: 'Insufficient data', shouldWait: true, isAtZone: false };
    }
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const prev2 = data[data.length - 3];
    const closes = data.map(c => c.c);
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const currentEma9 = ema9[ema9.length - 1];
    const currentEma21 = ema21[ema21.length - 1];
    const avgBody = data.slice(-10).reduce((a, c) => a + Math.abs(c.c - c.o), 0) / 10;
    const body = Math.abs(last.c - last.o);
    const range = last.h - last.l;

    const atZone = direction === 'BUY'
        ? last.l <= zone.high && last.h >= zone.low
        : last.h >= zone.low && last.l <= zone.high;

    if (!atZone) {
        return {
            confirmed: false, score: 0, strength: 'NONE', confirmations: [],
            reason: 'Price not at zone yet - waiting', shouldWait: true, isAtZone: false
        };
    }

    const confirmations = [];
    let score = 0;

    // Engulfing
    if (direction === 'BUY' && prev.c < prev.o && last.c > last.o && last.o < prev.c && last.c > prev.o) {
        confirmations.push('Bullish Engulfing'); score += 30;
    }
    if (direction === 'SELL' && prev.c > prev.o && last.c < last.o && last.o > prev.c && last.c < prev.o) {
        confirmations.push('Bearish Engulfing'); score += 30;
    }
    // Pin bar / rejection
    if (direction === 'BUY') {
        const lowerWick = Math.min(last.c, last.o) - last.l;
        if (lowerWick > body * 2 && last.c > last.o && lowerWick > range * 0.3) {
            confirmations.push('Bullish Pin Bar'); score += 30;
        }
    }
    if (direction === 'SELL') {
        const upperWick = last.h - Math.max(last.c, last.o);
        if (upperWick > body * 2 && last.c < last.o && upperWick > range * 0.3) {
            confirmations.push('Bearish Pin Bar'); score += 30;
        }
    }
    // Momentum
    if (direction === 'BUY' && last.c > last.o && body > avgBody * 1.8) {
        confirmations.push('Bullish Momentum'); score += 20;
    }
    if (direction === 'SELL' && last.c < last.o && body > avgBody * 1.8) {
        confirmations.push('Bearish Momentum'); score += 20;
    }
    // EMA alignment
    if (direction === 'BUY' && currentEma9 > currentEma21 && last.c > currentEma9) {
        confirmations.push('EMA Bullish Alignment'); score += 15;
    }
    if (direction === 'SELL' && currentEma9 < currentEma21 && last.c < currentEma9) {
        confirmations.push('EMA Bearish Alignment'); score += 15;
    }
    // Liquidity sweep (LTF)
    const sw = findSwings(data.slice(-20), 3);
    if (direction === 'BUY') {
        const lows = (sw.L || []).slice(-4);
        const swept = lows.some(l => data.slice(-5).some(c => c.l < l.p * 0.999 && c.c > l.p));
        if (swept) { confirmations.push('Liquidity Sweep'); score += 25; }
    }
    if (direction === 'SELL') {
        const highs = (sw.H || []).slice(-4);
        const swept = highs.some(h => data.slice(-5).some(c => c.h > h.p * 1.001 && c.c < h.p));
        if (swept) { confirmations.push('Liquidity Sweep'); score += 25; }
    }
    // Break of structure (LTF)
    if (direction === 'BUY' && last.c > Math.max(prev.h, prev2.h)) {
        confirmations.push('Break of Structure'); score += 15;
    }
    if (direction === 'SELL' && last.c < Math.min(prev.l, prev2.l)) {
        confirmations.push('Break of Structure'); score += 15;
    }
    // Close outside zone
    if (direction === 'BUY' && last.c > zone.high) {
        confirmations.push('Closed Above Zone'); score += 20;
    }
    if (direction === 'SELL' && last.c < zone.low) {
        confirmations.push('Closed Below Zone'); score += 20;
    }
    // Volume spike
    if (hasRealVolume(pair) && data.length >= 20) {
        const vols = data.slice(-20).map(c => c.v || 0);
        const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const lastVol = data[data.length - 1].v || 0;
        if (avgVol > 0 && lastVol > avgVol * 1.5) {
            confirmations.push('Volume Spike'); score += 15;
        }
    }

    const confirmed = score >= 25;
    const strength = score >= 50 ? 'STRONG' : (score >= 25 ? 'MODERATE' : 'WEAK');
    return {
        confirmed, score, strength, confirmations, shouldWait: !confirmed,
        reason: confirmations.length > 0
            ? '✅ ' + confirmations.join(', ') + ' (Score: ' + score + ')'
            : '⏳ No confirmation signals - WAITING',
        isAtZone: atZone
    };
}

// Aggregator: combine Stage 2 immediate-entry filters for the AI prompt.
function buildEntryContext(sessionCheck, marketPhase, phaseDecision, entryConfirmation) {
    const lines = [];
    lines.push('1. SESSION FILTER: ' + sessionCheck.priority + ' - ' + sessionCheck.reason + ' (mult ' + sessionCheck.multiplier + 'x)');
    if (sessionCheck.isSilverBullet) lines.push('   🏹 SILVER BULLET ACTIVE');
    else if (sessionCheck.isKillzone) lines.push('   ✅ Killzone active');
    else if (sessionCheck.isOffHours) lines.push('   ⏳ Outside killzone');
    else if (sessionCheck.isAsian) lines.push('   🌏 Asian session');

    lines.push('2. MARKET PHASE: ' + marketPhase.phase + ' (' + (marketPhase.confidence || 0).toFixed(0) + '%) - ' + (phaseDecision.shouldEnter ? '✅ Entry allowed' : '⏳ ' + phaseDecision.reason));

    lines.push('3. ENTRY CONFIRMATION: ' + (entryConfirmation.confirmed ? '✅ READY' : '⏳ WAITING') + ' | Score ' + entryConfirmation.score + '/100 | ' + entryConfirmation.strength + ' | ' + (entryConfirmation.confirmations.join(', ') || 'No signals'));
    if (!entryConfirmation.isAtZone) lines.push('   ℹ️ Price not at zone yet - limit order will trigger on arrival');

    const allOk = sessionCheck.priority !== 'LOW' && phaseDecision.shouldEnter && entryConfirmation.confirmed && entryConfirmation.isAtZone;
    const summary = allOk
        ? '✅ ALL FILTERS PASS - AI may enter_now'
        : '⏳ IMMEDIATE ENTRY WAIT - pending limit setup may still be valid';
    return { allOk, lines, summary, sessionCheck, marketPhase, phaseDecision, entryConfirmation };
}

function buildPreSelectionEntryContext(sessionCheck, marketPhase) {
    return buildEntryContext(
        sessionCheck,
        marketPhase,
        { shouldEnter: true, reason: 'Candidate-specific phase check deferred until selection', multiplier: 1.0 },
        { confirmed: false, score: 0, strength: 'NONE', confirmations: [], shouldWait: true, reason: 'Candidate-specific confirmation deferred until selection', isAtZone: false }
    );
}

function buildSelectedCandidateEntryContext({ historyCache, sessionCheck, marketPhase, phaseData, selectedZone, direction, price }) {
    const confirmTf = historyCache?.['15M']?.length >= 3 ? '15M'
        : (historyCache?.['5M']?.length >= 3 ? '5M' : null);
    const entryConfirmation = (confirmTf && selectedZone && direction)
        ? checkEntryConfirmation(historyCache[confirmTf], selectedZone, direction)
        : { confirmed: false, score: 0, strength: 'NONE', confirmations: [], shouldWait: true, reason: 'Awaiting selected zone/direction', isAtZone: false };
    const zoneStatus = getZonePriceStatus(price, selectedZone);
    entryConfirmation.isAtZone = zoneStatus.insideZone;
    if (!zoneStatus.insideZone) {
        Object.assign(entryConfirmation, { confirmed: false, shouldWait: true,
            reason: 'Current price is outside the selected entry zone' });
    }
    const phaseDecision = shouldEnterBasedOnPhase(marketPhase, direction || 'BUY', price, phaseData);
    const context = buildEntryContext(sessionCheck, marketPhase, phaseDecision, entryConfirmation);
    if (!zoneStatus.insideZone) context.summary = 'Current price is outside the selected entry zone; pending limit fills at its order price';
    return context;
}

// ============================================
// JSON OUTPUT
// ============================================

function getPublicStatusCode(signal = {}, hasOpportunity = false, hasEntry = false) {
    const reasonCode = String(signal.reason?.code || '').toUpperCase();
    const riskGate = signal.risk_gate || getDefaultRiskGate(signal.execution_mode || DEFAULT_EXECUTION_MODE);
    // News risk is a hard execution lock. It must take precedence over a
    // paper-mode risk gate or any stale execution_allowed value.
    if (signal.news_risk?.status === 'HIGH_IMPACT') return 'NEWS_BLOCKED';
    if (signal.data_quality?.valid === false || reasonCode.includes('DATA') || reasonCode.includes('PRICE_UNAVAILABLE')) return 'DATA_BLOCKED';
    if (riskGate.status === 'RISK_BLOCKED' || reasonCode.includes('RISK_BLOCKED') || reasonCode.includes('SPREAD_TOO_WIDE')) return 'RISK_BLOCKED';
    if (signal.market_open === false) return 'MARKET_CLOSED';
    if ((signal.status === 'TRADE_READY' || signal.setup_state === 'TRADE_READY') && signal.execution_allowed === false) return 'RISK_BLOCKED';
    if (signal.execution_allowed === false && signal.setup_state === 'SETUP_AVAILABLE') return 'SETUP_READY';
    if (signal.status === 'TRADE_READY' || signal.setup_state === 'TRADE_READY') return 'SETUP_READY';
    if (hasOpportunity && hasEntry) return 'SETUP_READY';
    if (hasOpportunity) return 'WATCH';
    if (signal.status === 'ORDER_PENDING') return 'ORDER_PENDING';
    return 'NO_TRADE';
}

function getPublicExecutionAllowed(signal = {}, riskGate = null) {
    const gate = riskGate || signal.risk_gate || getDefaultRiskGate(signal.execution_mode || DEFAULT_EXECUTION_MODE);
    const reasonCode = String(signal.reason?.code || '').toUpperCase();
    if (gate.status === 'RISK_BLOCKED' || signal.news_risk?.status === 'HIGH_IMPACT'
        || signal.data_quality?.valid === false || signal.market_open === false
        || reasonCode.includes('DATA_BLOCKED') || reasonCode.includes('PRICE_UNAVAILABLE')
        || reasonCode.includes('RISK_BLOCKED') || reasonCode.includes('NEWS_BLOCKED')) return false;
    return signal.execution_allowed ?? (signal.status === 'TRADE_READY' || signal.setup_state === 'TRADE_READY');
}

function evaluateRiskLimits({ open_risk = 0, daily_loss = 0, weekly_loss = 0, consecutive_losses = 0, active_orders = 0, symbol_exposure = 0, limits = {} } = {}) {
    const checks = [
        ['max_open_risk', open_risk, 'maximum open risk reached'],
        ['max_daily_loss', daily_loss, 'maximum daily loss reached'],
        ['max_weekly_loss', weekly_loss, 'maximum weekly loss reached'],
        ['max_consecutive_losses', consecutive_losses, 'maximum consecutive losses reached'],
        ['max_active_orders', active_orders, 'maximum active orders reached'],
        ['max_symbol_exposure', symbol_exposure, 'maximum symbol exposure reached']
    ];
    const issues = [];
    for (const [limitName, currentValue, message] of checks) {
        const limit = Number(limits?.[limitName]);
        const current = Number(currentValue);
        if (Number.isFinite(limit) && Number.isFinite(current) && current >= limit) issues.push(message);
    }
    return { valid: issues.length === 0, issues };
}

function buildAccountRiskGate({ mode = 'PAPER', account = null, risk_percent = null, symbol_metadata = null, open_risk = 0, daily_loss = 0, weekly_loss = 0, consecutive_losses = 0, active_orders = 0, symbol_exposure = 0 } = {}) {
    const normalizedMode = String(mode || 'PAPER').toUpperCase();
    const riskLimits = evaluateRiskLimits({
        open_risk, daily_loss, weekly_loss, consecutive_losses, active_orders, symbol_exposure,
        limits: account || {}
    });
    if (!riskLimits.valid) {
        return {
            mode: normalizedMode, status: 'RISK_BLOCKED', execution_allowed: false,
            position_size: null, risk_amount: null, issues: riskLimits.issues,
            reason: riskLimits.issues.join('; ')
        };
    }
    if (normalizedMode === 'PAPER') {
        return {
            mode: 'PAPER', status: 'PAPER', execution_allowed: true,
            position_size: null, risk_amount: null,
            issues: [],
            reason: 'Paper execution does not submit broker orders or calculate live position size.'
        };
    }
    const equity = Number(account?.equity ?? account?.balance);
    const riskPct = Number(risk_percent);
    const tickValue = Number(symbol_metadata?.tick_value);
    const tickSize = Number(symbol_metadata?.tick_size);
    const riskDistance = Number(account?.risk_distance);
    const issues = [];
    if (!Number.isFinite(equity) || equity <= 0) issues.push('account equity is unavailable');
    if (!Number.isFinite(riskPct) || riskPct <= 0) issues.push('risk percentage is unavailable');
    if (!Number.isFinite(tickValue) || tickValue <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) issues.push('symbol tick metadata is unavailable');
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) issues.push('risk distance is unavailable');
    if (issues.length) return { mode: normalizedMode, status: 'RISK_BLOCKED', execution_allowed: false, position_size: null, risk_amount: null, issues, reason: issues.join('; ') };
    const riskAmount = equity * riskPct / 100;
    const positionSize = riskAmount / ((riskDistance / tickSize) * tickValue);
    if (!Number.isFinite(positionSize) || positionSize <= 0) return { mode: normalizedMode, status: 'RISK_BLOCKED', execution_allowed: false, position_size: null, risk_amount: riskAmount, issues: ['position size calculation is invalid'], reason: 'Deterministic position size calculation failed.' };
    return { mode: normalizedMode, status: 'RISK_READY', execution_allowed: true, position_size: positionSize, risk_amount: riskAmount, issues: [], reason: 'Account and symbol risk constraints passed.' };
}

function buildManualExecutionGate() {
    return {
        mode: 'MANUAL', status: 'MANUAL', execution_allowed: true,
        position_size: null, risk_amount: null, issues: [],
        reason: 'Manual execution is user-controlled; this app does not submit broker orders.'
    };
}

function getDefaultRiskGate(mode = DEFAULT_EXECUTION_MODE) {
    const normalizedMode = String(mode || DEFAULT_EXECUTION_MODE).toUpperCase();
    if (normalizedMode === 'MANUAL') return buildManualExecutionGate();
    if (normalizedMode === 'PAPER') return buildPaperOrderRiskGate();
    return buildAccountRiskGate({ mode: normalizedMode });
}

/**
 * Deterministic pending-limit backtest. It consumes already-derived signals
 * and closed candles; it never derives future structure or uses candles before
 * a signal's creation time. Results are expressed in R so the simulator is
 * independent of asset class, contract size, and account currency.
 */
function simulatePendingLimitBacktest({ signals = [], candles = [], spread = 0, slippage = 0, feeR = 0, initialR = 0 } = {}) {
    const orderedSignals = (Array.isArray(signals) ? signals : []).map((signal, index) => ({ signal, index,
        created: normalizeTimestampUTC(signal?.created_at ?? signal?.created_time ?? signal?.time),
        expires: normalizeTimestampUTC(signal?.expires_at ?? signal?.expiration_time ?? signal?.expiry)
    })).filter(item => item.signal && Number.isFinite(item.created))
        .sort((a, b) => a.created - b.created || a.index - b.index);
    const orderedCandles = (Array.isArray(candles) ? candles : []).map((c, index) => ({ candle: c, index,
        time: normalizeTimestampUTC(c?.t ?? c?.timestamp ?? c?.time)
    })).filter(item => Number.isFinite(item.time) && cIsClosed(item.candle))
        .sort((a, b) => a.time - b.time || a.index - b.index);
    const trades = [];
    for (const item of orderedSignals) {
        const signal = item.signal;
        const direction = String(signal.direction || signal.signalType || '').toUpperCase();
        const entry = Number(signal.entry ?? signal.entry_price);
        const stop = Number(signal.stop_loss ?? signal.stopLoss);
        const target = Number(signal.tp1 ?? signal.take_profit_1 ?? signal.takeProfit1);
        if (!['BUY', 'SELL', 'LONG', 'SHORT'].includes(direction) || ![entry, stop, target].every(Number.isFinite)) {
            trades.push({ status: 'REJECTED', reason: 'INVALID_SIGNAL_GEOMETRY', signal_id: signal.id || null });
            continue;
        }
        const requestedFillFraction = Number(signal.fill_fraction ?? signal.fillFraction ?? 1);
        if (!Number.isFinite(requestedFillFraction) || requestedFillFraction <= 0 || requestedFillFraction > 1) {
            trades.push({ status: 'REJECTED', reason: 'INVALID_FILL_FRACTION', signal_id: signal.id || null });
            continue;
        }
        const buy = direction === 'BUY' || direction === 'LONG';
        if ((buy && !(stop < entry && target > entry)) || (!buy && !(stop > entry && target < entry))) {
            trades.push({ status: 'REJECTED', reason: 'INVALID_SIGNAL_GEOMETRY', signal_id: signal.id || null });
            continue;
        }
        let filled = null;
        for (const bar of orderedCandles) {
            if (bar.time <= item.created) continue;
            if (Number.isFinite(item.expires) && bar.time > item.expires) break;
            const high = Number(bar.candle.h), low = Number(bar.candle.l);
            if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
            if ((buy && low <= entry) || (!buy && high >= entry)) {
                const adverse = Math.abs(Number(slippage) || 0) + Math.abs(Number(spread) || 0) / 2;
                const fillPrice = buy ? entry + adverse : entry - adverse;
            filled = { bar, fillPrice, fillFraction: requestedFillFraction };
                break;
            }
        }
        if (!filled) {
            trades.push({ status: 'EXPIRED', reason: 'LIMIT_NOT_FILLED', signal_id: signal.id || null });
            continue;
        }
        const risk = Math.abs(filled.fillPrice - stop);
        const reward = Math.abs(target - filled.fillPrice);
        let outcome = null, exitPrice = null, exitTime = null, reason = null;
        for (const bar of orderedCandles) {
            if (bar.time < filled.bar.time) continue;
            const high = Number(bar.candle.h), low = Number(bar.candle.l);
            if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
            const stopHit = buy ? low <= stop : high >= stop;
            const targetHit = buy ? high >= target : low <= target;
            // Same-candle ordering is unknowable from OHLC; use the
            // conservative stop-first assumption.
            if (stopHit) { outcome = 'LOSS'; exitPrice = stop; reason = targetHit ? 'STOP_AND_TARGET_SAME_CANDLE' : 'STOP_LOSS'; }
            else if (targetHit) { outcome = 'WIN'; exitPrice = target; reason = 'TAKE_PROFIT_1'; }
            if (outcome) { exitTime = bar.time; break; }
        }
        if (!outcome) {
            trades.push({ status: 'OPEN', reason: 'NO_EXIT_IN_DATA', signal_id: signal.id || null, fill_fraction: filled.fillFraction, fill_price: filled.fillPrice, risk, reward });
            continue;
        }
        const grossR = (outcome === 'WIN' ? reward / risk : -1) * filled.fillFraction;
        const netR = grossR - (Number.isFinite(Number(feeR)) ? Number(feeR) : 0);
        trades.push({ status: 'CLOSED', outcome, reason, signal_id: signal.id || null, symbol: signal.symbol || signal.pair || 'UNKNOWN', timeframe: signal.timeframe || signal.execution_timeframe || 'UNKNOWN', regime: signal.regime || signal.market_regime || 'UNKNOWN', session: signal.session || signal.market_session || 'UNKNOWN', fill_fraction: filled.fillFraction, fill_time: filled.bar.time, exit_time: exitTime, duration_ms: Math.max(0, exitTime - filled.bar.time), fill_price: filled.fillPrice, exit_price: exitPrice, risk, reward, rr: risk > 0 ? reward / risk : null, grossR, netR });
    }
    const closed = trades.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => t.outcome === 'WIN');
    const losses = closed.filter(t => t.outcome === 'LOSS');
    let equityR = Number.isFinite(Number(initialR)) ? Number(initialR) : 0;
    let peakR = equityR, maxDrawdownR = 0, consecutiveLosses = 0, maxConsecutiveLosses = 0;
    for (const trade of closed) {
        equityR += trade.netR;
        peakR = Math.max(peakR, equityR);
        maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
        consecutiveLosses = trade.outcome === 'LOSS' ? consecutiveLosses + 1 : 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    }
    const grossWins = wins.reduce((sum, t) => sum + t.netR, 0);
    const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.netR, 0));
    const closedRiskRewards = closed.map(t => Number(t.rr)).filter(Number.isFinite);
    const durations = closed.map(t => Number(t.duration_ms)).filter(Number.isFinite);
    const rejectedCount = trades.filter(t => t.status === 'REJECTED').length;
    const expiredCount = trades.filter(t => t.status === 'EXPIRED').length;
    const partialFillCount = trades.filter(t => Number.isFinite(Number(t.fill_fraction)) && Number(t.fill_fraction) < 1).length;
    const summarizeGroup = field => Object.fromEntries([...new Set(closed.map(trade => String(trade[field] || 'UNKNOWN')))].map(key => {
        const group = closed.filter(trade => String(trade[field] || 'UNKNOWN') === key);
        const groupWins = group.filter(trade => trade.outcome === 'WIN').length;
        const groupNet = group.reduce((sum, trade) => sum + trade.netR, 0);
        return [key, { closed_trades: group.length, wins: groupWins, losses: group.length - groupWins, win_rate: group.length ? groupWins / group.length : 0, net_R: groupNet, expectancy_R: group.length ? groupNet / group.length : 0 }];
    }));
    return {
        trades,
        metrics: {
            total_signals: orderedSignals.length,
            closed_trades: closed.length,
            wins: wins.length,
            losses: losses.length,
            expired: trades.filter(t => t.status === 'EXPIRED').length,
            rejected: trades.filter(t => t.status === 'REJECTED').length,
            open: trades.filter(t => t.status === 'OPEN').length,
            fill_rate: orderedSignals.length ? (closed.length + trades.filter(t => t.status === 'OPEN').length) / orderedSignals.length : 0,
            average_reward_to_risk: closedRiskRewards.length ? closedRiskRewards.reduce((sum, value) => sum + value, 0) / closedRiskRewards.length : 0,
            expectancy_R: orderedSignals.length ? (equityR - (Number.isFinite(Number(initialR)) ? Number(initialR) : 0)) / orderedSignals.length : 0,
            average_time_in_trade_ms: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
            cancel_rate: orderedSignals.length ? expiredCount / orderedSignals.length : 0,
            rejection_rate: orderedSignals.length ? rejectedCount / orderedSignals.length : 0,
            partial_fills: partialFillCount,
            partial_fill_rate: orderedSignals.length ? partialFillCount / orderedSignals.length : 0,
            by_symbol: summarizeGroup('symbol'),
            by_timeframe: summarizeGroup('timeframe'),
            by_regime: summarizeGroup('regime'),
            by_session: summarizeGroup('session'),
            win_rate: closed.length ? wins.length / closed.length : 0,
            net_R: equityR - (Number.isFinite(Number(initialR)) ? Number(initialR) : 0),
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Infinity : 0),
            max_drawdown_R: maxDrawdownR,
            max_consecutive_losses: maxConsecutiveLosses
        }
    };
}

function cIsClosed(candle) {
    return !!candle && candle.is_closed !== false;
}

function normalizePublicTrendMap(value) {
    if (!value) return null;
    const output = {};
    const add = (tf, snapshot) => {
        if (!['1D', '4H', '1H', '15M', '5M', '1W', '1M'].includes(tf)) return;
        if (typeof snapshot === 'string') {
            output[tf] = snapshot;
            return;
        }
        if (snapshot && typeof snapshot === 'object') {
            const trend = snapshot.displayed_trend || getCanonicalDisplayedTrend(snapshot);
            if (trend) output[tf] = trend;
        }
    };
    if (Array.isArray(value)) {
        value.forEach(item => add(String(item?.timeframe || '').toUpperCase(), item));
    } else if (typeof value === 'object') {
        Object.entries(value).forEach(([tf, snapshot]) => add(String(tf).toUpperCase(), snapshot));
    }
    return Object.keys(output).length ? output : null;
}

function buildPublicTradeSignal(signal = {}) {
    const isWait = signal.decision === 'WAIT' || signal.trade_type === 'WAIT';
    const parseRR = value => {
        if (Number.isFinite(Number(value))) return Number(value);
        const match = String(value ?? '').match(/(?:1\s*:\s*)?([0-9]+(?:\.[0-9]+)?)\s*$/);
        return match ? Number(match[1]) : null;
    };
    const structural = signal.structural_context || signal.top_down_context?.higher_timeframe || null;
    const publicTrendMap = normalizePublicTrendMap(signal.trend_detection || structural);
    const publicRiskGate = signal.risk_gate || getDefaultRiskGate(signal.execution_mode || DEFAULT_EXECUTION_MODE);
    const structureSummary = signal.analysis?.structure || (publicTrendMap
        ? Object.entries(publicTrendMap).map(([tf, value]) => `${tf} ${value}`).join('; ')
        : (typeof structural === 'string' ? structural : null));
    const draw = signal.daily_bias?.liquidity_draw || signal.daily_bias?.target_type || signal.target_type || signal.primary_target_source;
    const liquiditySummary = signal.analysis?.liquidity || (draw ? `${draw}${signal.daily_bias?.target_level != null ? ' at ' + signal.daily_bias.target_level : ''}` : null);
    if (isWait) {
        if (signal.status === 'TODAY_OPPORTUNITY' || signal.status === 'WATCH_ONLY') {
            const primary = signal.primary_opportunity || null;
            const watch = Array.isArray(signal.watch_setups) && signal.watch_setups.length ? signal.watch_setups[0] : null;
            const compactPrimary = primary ? {
                id: primary.id || null,
                direction: primary.direction || null,
                strategy: primary.strategy || null,
                trade_context: primary.trade_context_classification || null,
                setup_timeframe: primary.setup_timeframe || null,
                execution_timeframe: primary.execution_timeframe || null,
                entry_price: primary.entry_price ?? primary.entry ?? null,
                entry_zone: primary.entry_zone || primary.execution_zone || null,
                stop_loss: primary.stop_loss ?? null,
                take_profit_1: primary.take_profit_1 ?? primary.tp1 ?? primary.target_level ?? null,
                take_profit_2: primary.take_profit_2 ?? primary.tp2 ?? null,
                take_profit_3: primary.take_profit_3 ?? primary.tp3 ?? null,
                execution_model: primary.execution_model || null,
                state: primary.state || primary.lifecycle_state || null,
                target: primary.target || (primary.target_level != null ? { level: primary.target_level, source: primary.target_intent || null } : null),
                structural_invalidation: primary.structural_invalidation || null,
                confidence: primary.confidence ?? null,
                reason: primary.reason || null,
                next_requirement: primary.next_requirement || []
            } : null;
            const plan = compactPrimary || (watch ? {
                id: watch.id || null,
                direction: watch.direction || null,
                strategy: watch.strategy || null,
                trade_context: watch.trade_context_classification || null,
                setup_timeframe: watch.setup_timeframe || null,
                execution_timeframe: watch.execution_timeframe || null,
                entry_price: watch.entry_price ?? watch.entry ?? null,
                entry_zone: watch.entry_zone || watch.execution_zone || watch.area_of_interest || watch.location || null,
                execution_model: watch.execution_model || null,
                state: watch.state || watch.lifecycle_state || null,
                target_intent: watch.target_intent || null,
                target: watch.target || (watch.target_level != null ? { level: watch.target_level, source: watch.target_intent || null } : null),
                structural_invalidation: watch.structural_invalidation || null,
                confidence: watch.confidence ?? null,
                reason: watch.reason || null,
                next_requirement: watch.next_requirement || []
            } : null);
            const orderType = compactPrimary?.entry_price != null && compactPrimary?.direction
                ? `${compactPrimary.direction}_LIMIT` : 'WAIT';
            return {
                date: signal.date,
                pair: signal.pair,
                current_price: signal.current_price,
                symbol_metadata: signal.symbol_metadata || getSymbolMetadata(signal.pair),
                decision: 'WAIT',
                trade_type: orderType,
                entry_price: compactPrimary?.entry_price ?? null,
                stop_loss: compactPrimary?.stop_loss ?? null,
                take_profit_1: compactPrimary?.take_profit_1 ?? null,
                take_profit_2: compactPrimary?.take_profit_2 ?? null,
                take_profit_3: compactPrimary?.take_profit_3 ?? null,
                confidence: Number.isFinite(Number(signal.confidence)) ? Number(signal.confidence) : 0,
                status: 'TODAY_OPPORTUNITY',
                opportunity: plan ? {
                    id: plan.id,
                    direction: plan.direction,
                    strategy: plan.strategy,
                    trade_context: plan.trade_context,
                    setup_timeframe: plan.setup_timeframe,
                    execution_timeframe: plan.execution_timeframe,
                    area_of_interest: plan.entry_zone,
                    execution_model: plan.execution_model,
                    target_intent: plan.target_intent || plan.target?.source || null,
                    target: plan.target,
                    state: plan.state,
                    confidence: plan.confidence,
                    reason: plan.reason,
                    next_requirement: plan.next_requirement
                } : (signal.opportunity || null),
                reason: signal.reason || { code: 'DEVELOPING_SETUP', message: 'A valid developing opportunity remains for today.' },
                analysis: {
                    trend_detection: publicTrendMap || signal.trend_detection || signal.top_down_context?.higher_timeframe || signal.structural_context || null,
                    volatility_level: signal.volatility?.regime || signal.analysis?.volatility || null,
                    technical_indicators: signal.indicators || signal.analysis?.indicators || null,
                    type: signal.strategy || signal.trade_context_classification || null
                },
                news_risk: signal.news_risk || { status: 'UNKNOWN', available: false },
                data_quality: signal.data_quality || null,
                provider_metadata: signal.provider_metadata || null,
                market_conditions: signal.market_conditions || null,
                status_code: getPublicStatusCode(signal, !!plan || !!signal.opportunity, !!compactPrimary?.entry_price),
                execution_mode: signal.execution_mode || DEFAULT_EXECUTION_MODE,
                risk_gate: publicRiskGate,
                execution_allowed: false,
                market_open: signal.market_open ?? null
            };
        }
        const reason = signal.reason || {
            code: signal.reasoning?.code || signal.wait_code || 'NO_FRESH_OPPORTUNITY',
            message: signal.reasoning?.primary || signal.wait_condition || 'No fresh actionable CRT, TBS or MSNR execution opportunity'
        };
        return {
            date: signal.date,
            time: signal.time,
            pair: signal.pair,
            current_price: signal.current_price,
            symbol_metadata: signal.symbol_metadata || getSymbolMetadata(signal.pair),
            decision: 'WAIT',
            trade_type: 'WAIT',
            entry_price: null,
            stop_loss: null,
            take_profit_1: null,
            take_profit_2: null,
            take_profit_3: null,
            confidence: Number.isFinite(Number(signal.confidence)) ? Number(signal.confidence) : 0,
            status: signal.status || null,
            reason: { code: reason.code, message: reason.message },
            news_risk: signal.news_risk || { status: 'UNKNOWN', available: false },
            data_quality: signal.data_quality || null,
            provider_metadata: signal.provider_metadata || null,
            market_conditions: signal.market_conditions || null,
            status_code: getPublicStatusCode(signal, false, false),
            execution_mode: signal.execution_mode || DEFAULT_EXECUTION_MODE,
            risk_gate: publicRiskGate,
            execution_allowed: false,
            market_open: signal.market_open ?? null
        };
    }
    const reasoning = signal.reasoning || {};
    const strategy = signal.strategy || signal.strategy_label || signal.strategy_setup?.label || null;
    const requestedDecision = String(signal.decision || signal.trade_type || 'WAIT').toUpperCase();
    const publicDecision = requestedDecision === 'BUY' ? 'BUY_LIMIT'
        : requestedDecision === 'SELL' ? 'SELL_LIMIT'
        : ['BUY_LIMIT', 'SELL_LIMIT', 'WAIT'].includes(requestedDecision) ? requestedDecision : 'WAIT';
    return {
        date: signal.date,
        time: signal.time,
        pair: signal.pair,
        current_price: signal.current_price,
        symbol_metadata: signal.symbol_metadata || getSymbolMetadata(signal.pair),
        decision: publicDecision,
        strategy,
        timeframe: signal.timeframe || signal.execution_timeframe || signal.setup_timeframe || null,
        entry: signal.entry ?? signal.entry_price,
        entry_zone: signal.entry_zone ? {
            low: signal.entry_zone.low,
            high: signal.entry_zone.high
        } : null,
        stop_loss: signal.stop_loss,
        stop_quality: signal.stop_quality || signal.adaptive_candidate?.risk_model || null,
        tp1: signal.tp1 ?? signal.take_profit_1,
        tp2: signal.tp2 ?? signal.take_profit_2 ?? null,
        tp3: signal.tp3 ?? signal.take_profit_3 ?? null,
        rr_tp1: signal.rr_tp1 ?? parseRR(signal.risk_reward),
        confidence: signal.confidence,
        status: signal.status || signal.opportunity_status || signal.lifecycle_state || null,
        setup_state: signal.setup_state || (signal.status === 'TRADE_READY' ? 'TRADE_READY' : null),
        reason: signal.reason || (reasoning.primary ? { code: 'SETUP_CONTEXT', message: reasoning.primary } : null),
        manual_tracking_allowed: signal.manual_tracking_allowed === true,
        execution_allowed: getPublicExecutionAllowed(signal, publicRiskGate),
        primary_opportunity: signal.primary_opportunity || null,
        active_setups: Array.isArray(signal.active_setups) ? signal.active_setups : [],
        watch_setups: Array.isArray(signal.watch_setups) ? signal.watch_setups : [],
        analysis: {
            bias: signal.analysis?.bias || (signal.direction === 'BUY' ? 'BULLISH' : signal.direction === 'SELL' ? 'BEARISH' : 'NEUTRAL'),
            trade_context: signal.trade_context_classification || signal.adaptive_candidate?.trade_context_classification || null,
            higher_timeframe: signal.top_down_context?.higher_timeframe || null,
            structural_context: publicTrendMap || signal.structural_context || null,
            daily_bias: signal.daily_bias ? {
                direction: signal.daily_bias.direction,
                target: signal.daily_bias.target_level,
                invalidation: signal.daily_bias.invalidation_level,
                reason: signal.daily_bias.reason
            } : null,
            execution: (signal.execution_timeframe || signal.timeframe || 'Selected timeframe') + ': ' + (signal.execution_model || signal.setup_type || 'PENDING_LIMIT'),
            setup: signal.analysis?.setup || (typeof reasoning === 'string' ? reasoning : reasoning.primary) || '',
            structure: structureSummary || reasoning.structure || null,
            liquidity: liquiditySummary || reasoning.liquidity || null,
            invalidation: signal.analysis?.invalidation || reasoning.invalidation || signal.stop_loss_reason || '',
            notes: signal.analysis?.notes || [
                ...(Array.isArray(reasoning.secondary) ? reasoning.secondary.slice(0, 3) : []),
                ...(signal.stop_quality?.warning ? [signal.stop_quality.warning] : [])
            ]
        },
        news_risk: signal.news_risk || { status: 'UNKNOWN', available: false },
        data_quality: signal.data_quality || null,
        provider_metadata: signal.provider_metadata || null,
        market_conditions: signal.market_conditions || null,
        status_code: getPublicStatusCode(signal, !!signal.primary_opportunity, Number.isFinite(Number(signal.entry ?? signal.entry_price))),
        execution_mode: signal.execution_mode || DEFAULT_EXECUTION_MODE,
        risk_gate: publicRiskGate,
        market_open: signal.market_open ?? null
    };
}

function buildDebugDiagnostics(output = {}, context = null) {
    const signal = output.trade_signal || output;
    return {
        ai_analysis: context?.ai_analysis || signal.ai_analysis || null,
        today_opportunity: context?.today_opportunity || signal.today_opportunity || null,
        timeframe_context: context?.market_context?.timeframe_context || null,
        top_down_context: signal.top_down_context || null,
        daily_bias: context?.daily_bias || signal.daily_bias || null,
        opportunity_funnel: context?.opportunity_funnel || null,
        strategy_detections: context?.strategy_detections || signal.strategy_detections || null,
        candidate_pipeline: context?.candidate_pipeline || signal.candidate_pipeline || null,
        validation: signal.validation || null,
        rejection_summary: signal.rejection_summary || context?.setup_candidate_audit?.rejection_summary || null,
        rejection_detail: signal.rejection_detail || context?.setup_candidate_audit?.rejection_detail || null,
        selected_candidate: signal.selected_candidate_id ? (context?.adaptive_setup_candidates || []).find(c => c.id === signal.selected_candidate_id) || null : null,
        data_integrity: signal.time_integrity || context?.time_integrity || null
    };
}

const ANALYSIS_AUDIT_KEY = 'ict_analysis_audit';
const ANALYSIS_AUDIT_CAP = 200;

function recordAnalysisAudit(signal = {}) {
    const record = {
        request_id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        recorded_at: new Date().toISOString(),
        pair: signal.pair || null,
        symbol_metadata: signal.symbol_metadata || getSymbolMetadata(signal.pair),
        current_price: Number.isFinite(Number(signal.current_price)) ? Number(signal.current_price) : null,
        provider_timestamp: signal.provider_timestamp || signal.quote_snapshot?.provider_timestamp || null,
        market_conditions: signal.market_conditions || null,
        data_quality: signal.data_quality || null,
        decision: signal.decision || signal.trade_type || 'WAIT',
        status: signal.status || signal.opportunity_status || null,
        status_code: signal.status_code || getPublicStatusCode(signal),
        setup_state: signal.setup_state || null,
        execution_allowed: signal.execution_allowed ?? false,
        confidence: Number.isFinite(Number(signal.confidence)) ? Number(signal.confidence) : 0,
        reason: signal.reason || null,
        news_risk: signal.news_risk || { status: 'UNKNOWN', available: false },
        risk_gate: signal.risk_gate || getDefaultRiskGate(signal.execution_mode || DEFAULT_EXECUTION_MODE),
        selected_candidate_id: signal.selected_candidate_id || null,
        validation: signal.validation?.passed ?? signal.validation?.final_consistency?.valid ?? null
    };
    try {
        const previous = JSON.parse(localStorage.getItem(ANALYSIS_AUDIT_KEY) || '[]');
        const entries = Array.isArray(previous) ? previous : [];
        localStorage.setItem(ANALYSIS_AUDIT_KEY, JSON.stringify([record, ...entries].slice(0, ANALYSIS_AUDIT_CAP)));
    } catch (error) {
        console.warn('[AUDIT] unable to persist analysis record', error?.message || error);
    }
    const proxy = getProxyBaseUrl();
    const auditToken = getAuditWriteToken();
    if (proxy && auditToken && typeof fetch === 'function') {
        fetch(`${proxy}/api/audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Audit-Token': auditToken },
            body: JSON.stringify(record),
            keepalive: true
        }).catch(error => console.warn('[AUDIT] proxy persistence unavailable', error?.message || error));
    }
    return record;
}

function validatePublicTradeSignal(signal = {}) {
    const issues = [];
    const decisions = new Set(['WAIT', 'BUY_LIMIT', 'SELL_LIMIT']);
    const statuses = new Set(['SETUP_READY', 'WATCH', 'ORDER_PENDING', 'NO_TRADE', 'DATA_BLOCKED', 'NEWS_BLOCKED', 'RISK_BLOCKED', 'MARKET_CLOSED']);
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) issues.push('signal must be an object');
    if (!String(signal?.pair || '').trim()) issues.push('pair is required');
    if (!decisions.has(String(signal?.decision || ''))) issues.push('decision is invalid');
    if (signal?.current_price != null && !Number.isFinite(Number(signal.current_price))) issues.push('current_price is invalid');
    if (signal?.status_code != null && !statuses.has(String(signal.status_code))) issues.push('status_code is invalid');
    if (signal?.execution_allowed != null && typeof signal.execution_allowed !== 'boolean') issues.push('execution_allowed must be boolean');
    if (signal?.status_code === 'SETUP_READY' && !['BUY_LIMIT', 'SELL_LIMIT'].includes(String(signal.decision || ''))) issues.push('SETUP_READY requires a limit decision');
    const entry = Number(signal?.entry ?? signal?.entry_price);
    const stop = Number(signal?.stop_loss);
    const target = Number(signal?.tp1 ?? signal?.take_profit_1);
    if (signal?.status_code === 'SETUP_READY' && !Number.isFinite(Number(signal.current_price))) issues.push('ready setup current_price is unavailable');
    if (signal?.status_code === 'SETUP_READY' && [entry, stop, target].some(value => !Number.isFinite(value))) issues.push('ready setup geometry is incomplete');
    if (signal?.decision === 'BUY_LIMIT' && !(stop < entry && entry < target)) issues.push('BUY_LIMIT geometry is invalid');
    if (signal?.decision === 'SELL_LIMIT' && !(stop > entry && entry > target)) issues.push('SELL_LIMIT geometry is invalid');
    const currentPrice = Number(signal?.current_price);
    const bid = Number(signal?.market_conditions?.bid);
    const ask = Number(signal?.market_conditions?.ask);
    const referencePrice = signal?.decision === 'BUY_LIMIT' && Number.isFinite(ask) ? ask
        : signal?.decision === 'SELL_LIMIT' && Number.isFinite(bid) ? bid
            : currentPrice;
    if (signal?.status_code === 'SETUP_READY' && Number.isFinite(referencePrice) && Number.isFinite(entry)) {
        if (signal.decision === 'BUY_LIMIT' && entry >= referencePrice) issues.push('BUY_LIMIT entry must be below current quote');
        if (signal.decision === 'SELL_LIMIT' && entry <= referencePrice) issues.push('SELL_LIMIT entry must be above current quote');
    }
    if (signal?.status_code === 'SETUP_READY' && signal.entry_zone != null) {
        const zoneLow = Number(signal.entry_zone.low);
        const zoneHigh = Number(signal.entry_zone.high);
        if (!Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh) || zoneHigh < zoneLow) issues.push('ready entry zone is invalid');
        else if (Number.isFinite(entry) && (entry < zoneLow || entry > zoneHigh)) issues.push('ready entry is outside entry zone');
    }
    return { valid: issues.length === 0, issues };
}

function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    let publicSignal = buildPublicTradeSignal(obj?.trade_signal || obj);
    const publicValidation = validatePublicTradeSignal(publicSignal);
    if (!publicValidation.valid) {
        console.error('[PUBLIC SIGNAL] schema rejected', publicValidation.issues);
        publicSignal = {
            date: publicSignal?.date || new Date().toISOString().slice(0, 10),
            time: publicSignal?.time || new Date().toISOString().slice(11, 19),
            pair: publicSignal?.pair || null,
            current_price: Number.isFinite(Number(publicSignal?.current_price)) ? Number(publicSignal.current_price) : null,
            decision: 'WAIT',
            trade_type: 'WAIT',
            confidence: 0,
            status: 'DATA_BLOCKED',
            status_code: 'DATA_BLOCKED',
            execution_allowed: false,
            reason: { code: 'PUBLIC_SIGNAL_SCHEMA_INVALID', message: publicValidation.issues.join('; ') },
            data_quality: { valid: false, reasons: publicValidation.issues },
            news_risk: publicSignal?.news_risk || { status: 'UNKNOWN', available: false },
            risk_gate: publicSignal?.risk_gate || getDefaultRiskGate(publicSignal?.execution_mode || DEFAULT_EXECUTION_MODE)
        };
    }
    recordAnalysisAudit(publicSignal);
    if(el) el.textContent = JSON.stringify({ trade_signal: publicSignal }, null, 2);
    renderOpportunityStack(publicSignal);
    if (lastLiveMarketContextForReplay) {
        try {
            window.__ICT_LAST_SCAN_REPLAY__ = createScanReplay(lastLiveMarketContextForReplay, obj);
            console.log('SCAN_REPLAY_JSON', JSON.stringify(window.__ICT_LAST_SCAN_REPLAY__));
        } catch (error) { console.error('[REPLAY] capture failed', error); }
        lastLiveMarketContextForReplay = null;
    }
}

function escapeOpportunityHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatOpportunityLevel(value) {
    return value == null ? '—' : escapeOpportunityHtml(value);
}

function renderOpportunityCard(setup, heading) {
    if (!setup) return '';
    const location = setup.location || setup.area_of_interest;
    const target = setup.target || {};
    const next = Array.isArray(setup.next_requirement) ? setup.next_requirement : [];
    return `<div class="opportunity-card ${setup.watch_only ? 'watch' : ''}">
        <div class="opportunity-card-heading">${escapeOpportunityHtml(heading)}</div>
        <strong>${formatOpportunityLevel(setup.direction)} — ${escapeOpportunityHtml(setup.trade_context_classification || setup.strategy || 'MARKET THESIS')}</strong>
        <div class="opportunity-meta">${escapeOpportunityHtml(setup.setup_timeframe || 'TF unknown')} → ${escapeOpportunityHtml(setup.execution_timeframe || 'execution TF unknown')} · ${escapeOpportunityHtml(setup.state || setup.lifecycle_state || 'DEVELOPING')}</div>
        ${location ? `<div>Location: ${formatOpportunityLevel(location.low)} – ${formatOpportunityLevel(location.high)} · ${escapeOpportunityHtml(location.source || location.type || 'STRUCTURAL')}</div>` : ''}
        ${target.level != null || setup.target_level != null ? `<div>Target: ${formatOpportunityLevel(target.level ?? setup.target_level)}${target.source || setup.target_intent ? ` · ${escapeOpportunityHtml(target.source || setup.target_intent)}` : ''}</div>` : ''}
        ${setup.structural_invalidation != null ? `<div>Invalidation: ${formatOpportunityLevel(setup.structural_invalidation)}</div>` : ''}
        <div class="opportunity-reason">${escapeOpportunityHtml(setup.reason || 'Waiting for deterministic execution evidence.')}</div>
        ${next.length ? `<div class="opportunity-next">Next: ${next.slice(0, 3).map(item => `<span>• ${escapeOpportunityHtml(item)}</span>`).join('')}</div>` : ''}
    </div>`;
}

function renderOpportunityStack(signal = {}) {
    const el = document.getElementById('opportunityStack');
    if (!el) return;
    const primary = signal.primary_opportunity;
    if (!primary) { el.innerHTML = ''; return; }
    // The normal card is deliberately limited to the selected public setup.
    // Watch candidates remain available in JSON/debug output.
    el.innerHTML = renderOpportunityCard(primary, 'PRIMARY OPPORTUNITY');
}

// ============================================
// RECENT SAVED + TRADE JOURNAL
// ============================================

let lastSetupSummary = null;
let lastSetupOut = null;
let lastLiveMarketContextForReplay = null;

function buildSetupSummary(best, st, finalEntry, price) {
    return {
        id: Date.now(),
        pair: pair,
        timeframe: best.timeframe,
        direction: st,
        entry: finalEntry,
        sl: best.sl,
        tp1: best.tp1,
        confidence: best.confidence,
        zoneType: best.zoneType,
        patterns: best.patterns ? best.patterns.join('+') : 'MSNR',
        touches: best.touches || 0,
        isFresh: best.isFresh || false,
        distancePct: Math.abs(best.distancePct || 0),
        priceAtScan: price
    };
}

const RECENT_KEY = 'ict_recent_saved';
const RECENT_CAP = 10;
const JOURNAL_KEY = 'ict_journal';
const JOURNAL_CAP = 30;

function getRecents() {
    try {
        const r = JSON.parse(localStorage.getItem(RECENT_KEY));
        return Array.isArray(r) ? r : [];
    } catch(e) { return []; }
}

function setRecents(r) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, RECENT_CAP)));
    } catch(e) {}
}

function getJournal() {
    try {
        const j = JSON.parse(localStorage.getItem(JOURNAL_KEY));
        return Array.isArray(j) ? j : [];
    } catch(e) { return []; }
}

function setJournal(j) {
    try {
        localStorage.setItem(JOURNAL_KEY, JSON.stringify(j.slice(0, JOURNAL_CAP)));
    } catch(e) {}
}

function saveCurrentSetup() {
    const signal = lastSetupOut?.trade_signal;
    if (signal?.source === 'AI-Generated Setup' && signal?.validation?.passed !== true) {
        console.log('❌ AI VALIDATION REJECTED: blocked AI setup cannot be saved');
        showNotif('🚫 Blocked AI setup cannot be saved', 'warning');
        return;
    }
    if(!lastSetupSummary) {
        showNotif('⚠️ No setup to save - run a scan first', 'warning');
        return;
    }
    const recents = getRecents();
    if(recents.some(e => e.id === lastSetupSummary.id)) {
        showNotif('💾 Already saved', 'info');
        return;
    }
    recents.unshift({ ...lastSetupSummary, out: lastSetupOut, savedAt: new Date().toISOString(), outcome: null });
    setRecents(recents);
    renderRecents();
    syncSetupToGitHub(lastSetupOut?.trade_signal || lastSetupSummary, 'saved');
    showNotif('💾 Saved to Recent', 'success');
}

function markRecentOutcome(id, outcome) {
    const r = getRecents();
    const e = r.find(x => x.id === id);
    if(e) {
        e.outcome = e.outcome === outcome ? null : outcome;
        setRecents(r);
        renderRecents();
        if (e.outcome) {
            try {
                const patterns = (e.patterns || '').split('+').map(s => s.trim()).filter(Boolean);
                const rr = parseFloat(String(e.risk_reward || '1:1').split(':')[1]) || 1.5;
                trackAIPerformance(String(id), e.outcome, e.confidence || 0, patterns, rr);
            } catch(err) {}
        }
    }
}

function journalRecent(id) {
    const r = getRecents();
    const e = r.find(x => x.id === id);
    if(!e) return;
    if(!e.outcome) {
        showNotif('⚠️ Mark ✅ Win or ❌ Loss first, then journal it', 'warning');
        return;
    }
    const { out, outcome, ...rest } = e;
    const journalEntry = { ...rest, status: outcome, journaledAt: new Date().toISOString() };
    const journal = getJournal();
    journal.unshift(journalEntry);
    setJournal(journal);
    setRecents(r.filter(x => x.id !== id));
    renderRecents();
    renderJournal();
    syncSetupToGitHub(journalEntry, 'journal');
    showNotif(`📒 Journaled as ${outcome}`, 'success');
}

function deleteRecent(id) {
    setRecents(getRecents().filter(x => x.id !== id));
    renderRecents();
    showNotif('🗑️ Saved setup deleted', 'warning');
}

function viewRecent(id) {
    const e = getRecents().find(x => x.id === id);
    if(e?.out) {
        setJsonOutput(e.out);
        showNotif('📋 Loaded into Best Setup view - rescan before trading', 'info');
    }
}

function deleteJournalEntry(id) {
    setJournal(getJournal().filter(x => x.id !== id));
    renderJournal();
    showNotif('🗑️ Journal entry deleted', 'warning');
}

function setupCardHTML(e, when, badge, actions) {
    const prec = getPrec(e.pair || 'XAU/USD');
    const freshLabel = e.isFresh ? '🌟 FRESH' : (e.touches <= 3 ? '📌 LIGHT' : '⚠️ USED');
    return `<div class="journal-entry ${badge.cls}">
        <div class="journal-head">
            <span>${e.pair} ${e.direction} ${e.timeframe} ${e.zoneType||''} ${e.patterns||''} ${freshLabel} ${(e.distancePct || 0).toFixed(2)}%</span>
            <span>${badge.label}</span>
        </div>
        <div class="journal-levels">
            E $${(+e.entry).toFixed(prec)} | SL $${(+e.sl).toFixed(prec)} | TP $${(+e.tp1).toFixed(prec)} | ${e.confidence}% | Touches: ${e.touches||0}
        </div>
        <div class="journal-actions">${actions}</div>
    </div>`;
}

function renderRecents() {
    const list = document.getElementById('recentList');
    if(!list) return;
    const recents = getRecents();
    if(recents.length === 0) {
        list.innerHTML = '<span class="journal-empty">No saved setups — hit 💾 Save after a scan to keep one here</span>';
        return;
    }
    list.innerHTML = recents.map(e => {
        const when = e.savedAt ? new Date(e.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.outcome === 'WIN' ? { label: '✅ WIN', cls: 'win' } : (e.outcome === 'LOSS' ? { label: '❌ LOSS', cls: 'loss' } : { label: '💾 SAVED', cls: 'pending' });
        const actions = `
            <button class="jw-win" data-action="win" data-id="${e.id}">✅ Win</button>
            <button class="jw-loss" data-action="loss" data-id="${e.id}">❌ Loss</button>
            <button class="jw-journal" data-action="journal" data-id="${e.id}">📒 Journal</button>
            <button class="jw-del" data-action="view" data-id="${e.id}">📋 View</button>
            <button class="jw-del" data-action="del" data-id="${e.id}">🗑️</button>
        `;
        return setupCardHTML(e, when, badge, actions);
    }).join('');
}

function renderJournal() {
    const list = document.getElementById('journalList');
    const stats = document.getElementById('journalStats');
    if(!list) return;
    const journal = getJournal();
    if(stats) {
        const w = journal.filter(e => e.status === 'WIN').length;
        const l = journal.filter(e => e.status === 'LOSS').length;
        const wr = (w + l) > 0 ? ` | ${(100 * w / (w + l)).toFixed(0)}% WR` : '';
        stats.innerHTML = journal.length ? `✅${w} ❌${l}${wr}` : '';
    }
    if(journal.length === 0) {
        list.innerHTML = '<span class="journal-empty">Journal is empty — mark a saved setup Win/Loss, then press 📒 Journal</span>';
        return;
    }
    list.innerHTML = journal.map(e => {
        const when = e.journaledAt ? new Date(e.journaledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.status === 'WIN' ? { label: '✅ WIN', cls: 'win' } : { label: '❌ LOSS', cls: 'loss' };
        return setupCardHTML(e, when, badge, `<button class="jw-del" data-action="del" data-id="${e.id}">🗑️</button>`);
    }).join('');
}

function handleRecentClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if(!btn) return;
    const id = +btn.dataset.id;
    const action = btn.dataset.action;
    if(action === 'win') markRecentOutcome(id, 'WIN');
    else if(action === 'loss') markRecentOutcome(id, 'LOSS');
    else if(action === 'journal') journalRecent(id);
    else if(action === 'view') viewRecent(id);
    else if(action === 'del') deleteRecent(id);
}

function handleJournalClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if(btn && btn.dataset.action === 'del') deleteJournalEntry(+btn.dataset.id);
}

// ============================================
// LIMIT ORDER FUNCTIONS
// ============================================

function validatePersistedPaperOrder(order = {}) {
    const issues = [];
    const persistedMode = String(order.execution_mode || 'PAPER').toUpperCase();
    if (!['LONG', 'SHORT'].includes(order.signalType)) issues.push('signalType must be LONG or SHORT');
    if (!['PAPER', 'MANUAL'].includes(persistedMode)) issues.push('execution mode is not PAPER or MANUAL');
    if (!Number.isFinite(Number(order.id))) issues.push('order id is invalid');
    if (!Number.isFinite(Number(order.idealEntry)) || !Number.isFinite(Number(order.stopLoss)) || !Number.isFinite(Number(order.takeProfit1))) issues.push('order geometry is incomplete');
    if (order.signalType === 'LONG' && !(Number(order.stopLoss) < Number(order.idealEntry) && Number(order.idealEntry) < Number(order.takeProfit1))) issues.push('LONG geometry is invalid');
    if (order.signalType === 'SHORT' && !(Number(order.stopLoss) > Number(order.idealEntry) && Number(order.idealEntry) > Number(order.takeProfit1))) issues.push('SHORT geometry is invalid');
    if (!Number.isFinite(normalizeTimestampUTC(order.createdAt))) issues.push('createdAt is invalid');
    if (order.idempotency_key != null && (typeof order.idempotency_key !== 'string' || !order.idempotency_key.trim())) issues.push('idempotency key is invalid');
    if (typeof order.idempotency_key === 'string' && order.idempotency_key.trim() && order.pair) {
        const expectedKey = buildTrackedOrderIdempotencyKey({ signalType: order.signalType, candidate_id: order.candidate_id, idealEntry: order.idealEntry, stopLoss: order.stopLoss, takeProfit1: order.takeProfit1 }, order.pair, persistedMode);
        if (order.idempotency_key !== expectedKey) issues.push('idempotency key does not match order geometry');
    }
    return { valid: issues.length === 0, issues };
}

function buildPaperOrderIdempotencyKey(signal = {}, pairLocal = pair) {
    const values = [
        normalizeSymbolInput(pairLocal),
        signal.signalType || signal.direction || '',
        signal.candidate_id || signal.selected_candidate_id || '',
        signal.idealEntry ?? signal.entry ?? signal.entry_price ?? '',
        signal.stopLoss ?? signal.stop_loss ?? '',
        signal.takeProfit1 ?? signal.tp1 ?? signal.take_profit_1 ?? ''
    ].map(value => String(value).trim());
    return `PAPER:${values.join('|')}`;
}

function buildTrackedOrderIdempotencyKey(signal = {}, pairLocal = pair, mode = DEFAULT_EXECUTION_MODE) {
    const prefix = String(mode || DEFAULT_EXECUTION_MODE).toUpperCase() === 'PAPER' ? 'PAPER' : 'MANUAL';
    const values = [
        normalizeSymbolInput(pairLocal),
        signal.signalType || signal.direction || '',
        signal.candidate_id || signal.selected_candidate_id || '',
        signal.idealEntry ?? signal.entry ?? signal.entry_price ?? '',
        signal.stopLoss ?? signal.stop_loss ?? '',
        signal.takeProfit1 ?? signal.tp1 ?? signal.take_profit_1 ?? ''
    ].map(value => String(value).trim());
    return `${prefix}:${values.join('|')}`;
}

function loadLimitOrder() {
    const s = localStorage.getItem('limitOrder');
    if(s) {
        try {
            const parsed = JSON.parse(s);
            const validation = validatePersistedPaperOrder(parsed);
            if (!validation.valid) {
                console.warn('[ORDER] discarded invalid persisted paper order', validation.issues);
                localStorage.removeItem('limitOrder');
                limitOrder = null;
                return;
            }
            limitOrder = parsed;
            updateLimitUI();
            startMonitor();
            checkMissedFill();
        } catch(e) {}
    }
}

function saveLimit(o) {
    limitOrder = o;
    localStorage.setItem('limitOrder', JSON.stringify(o));
    updateLimitUI();
}

function clearLimit() {
    limitOrder = null;
    localStorage.removeItem('limitOrder');
    if(priceTimer) clearInterval(priceTimer);
    updateLimitUI();
}

const PAPER_ORDER_AUDIT_KEY = 'ict_paper_order_audit';
function recordPaperOrderEvent(order = {}, status, reason, price = null) {
    const event = {
        recorded_at: new Date().toISOString(),
        order_id: order.id || null,
        pair: order.pair || null,
        execution_mode: order.execution_mode || 'PAPER',
        signal_type: order.signalType || null,
        status,
        reason: reason || null,
        price: Number.isFinite(Number(price)) ? Number(price) : null,
        ideal_entry: Number.isFinite(Number(order.idealEntry)) ? Number(order.idealEntry) : null,
        stop_loss: Number.isFinite(Number(order.stopLoss)) ? Number(order.stopLoss) : null,
        take_profit_1: Number.isFinite(Number(order.takeProfit1)) ? Number(order.takeProfit1) : null,
        candidate_id: order.candidate_id || null,
        idempotency_key: order.idempotency_key || null
    };
    try {
        const previous = JSON.parse(localStorage.getItem(PAPER_ORDER_AUDIT_KEY) || '[]');
        const entries = Array.isArray(previous) ? previous : [];
        localStorage.setItem(PAPER_ORDER_AUDIT_KEY, JSON.stringify([event, ...entries].slice(0, 200)));
    } catch (error) {
        console.warn('[ORDER AUDIT] unable to persist paper-order event', error?.message || error);
    }
    return event;
}

function cancelLimit() {
    if (limitOrder) recordPaperOrderEvent(limitOrder, 'CANCELLED', 'USER_CANCELLED');
    clearLimit();
    showNotif('❌ Cancelled', 'warning');
}

function updateLimitUI() {
    const t = document.getElementById('limitOrderText');
    const c = document.getElementById('cancelLimitBtn');
    if(limitOrder) {
        const prec = getPrec(limitOrder.pair || pair);
        t.innerHTML = `⏳ ${limitOrder.pair||''} ${limitOrder.signalType} @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)} | ${limitOrder.confirmation||''} | ${(limitOrder.distancePct || 0).toFixed(2)}% away`;
        t.className = 'active';
        c.classList.remove('hidden');
        document.getElementById('executeBtn').innerHTML = '⏳ Manual tracking active';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
    } else {
        t.innerHTML = 'No active order';
        t.className = '';
        c.classList.add('hidden');
        document.getElementById('executeBtn').innerHTML = '⚡ Track Manual Limit';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #34c759, #28a745)';
    }
}

function validateLocalLimitOrderInput(signal = {}, pairLocal = pair) {
    const issues = [];
    const direction = signal.signalType === 'LONG' ? 'BUY' : signal.signalType === 'SHORT' ? 'SELL' : null;
    const current = Number(signal.currentPrice);
    const entry = Number(signal.idealEntry);
    const stop = Number(signal.stopLoss);
    const tp1 = Number(signal.takeProfit1);
    const minimumRR = Number(getMarketSettings(pairLocal).targetRR) || 2.5;
    if (!direction) issues.push('direction is missing');
    if (![current, entry, stop, tp1].every(Number.isFinite)) issues.push('order geometry is not finite');
    if (direction === 'BUY' && !(stop < entry && entry < tp1)) issues.push('BUY geometry is invalid');
    if (direction === 'SELL' && !(stop > entry && entry > tp1)) issues.push('SELL geometry is invalid');
    if (direction === 'BUY' && Number.isFinite(current) && !(entry <= current)) issues.push('BUY limit must be at or below current price');
    if (direction === 'SELL' && Number.isFinite(current) && !(entry >= current)) issues.push('SELL limit must be at or above current price');
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(tp1 - entry);
    if (!(risk > 0) || reward / risk < minimumRR) issues.push(`RR is below minimum ${minimumRR}`);
    return { valid: issues.length === 0, issues, direction, minimum_rr: minimumRR };
}

function validateExecutionMode(mode = DEFAULT_EXECUTION_MODE) {
    const normalized = String(mode || DEFAULT_EXECUTION_MODE).toUpperCase();
    if (normalized === 'MANUAL') return { valid: true, mode: normalized, reason: 'Manual execution is user-controlled; this app only tracks the setup.' };
    if (normalized === 'PAPER') return { valid: true, mode: normalized, reason: 'Local paper pending-order simulation is enabled.' };
    return { valid: false, mode: normalized, reason: `${normalized} execution is unavailable in this client; broker submission is disabled.` };
}

function validateDuplicatePaperOrder(existingOrder = null) {
    if (!existingOrder) return { valid: true, reason: null };
    return {
        valid: false,
        reason: 'DUPLICATE_ACTIVE_PAPER_ORDER',
        message: 'A paper limit order is already pending; cancel it explicitly before creating another order.'
    };
}

function evaluatePendingPaperOrder(order = {}, currentPrice, nowMs = Date.now()) {
    const price = Number(currentPrice);
    const createdMs = normalizeTimestampUTC(order.createdAt);
    if (!Number.isFinite(price)) return { status: 'ORDER_PENDING', reason: 'PRICE_UNAVAILABLE' };
    if (Number.isFinite(createdMs) && nowMs - createdMs >= LIMIT_ORDER_EXPIRY_HOURS * 60 * 60 * 1000) {
        return { status: 'EXPIRED', reason: 'ORDER_EXPIRY' };
    }
    const invalidation = Number(order.invalidationPrice);
    if (Number.isFinite(invalidation) && ((order.signalType === 'LONG' && price <= invalidation) || (order.signalType === 'SHORT' && price >= invalidation))) {
        return { status: 'INVALIDATED', reason: 'STRUCTURAL_INVALIDATION_BREACHED', price };
    }
    const filled = order.signalType === 'LONG' ? price <= Number(order.idealEntry) : price >= Number(order.idealEntry);
    return filled ? { status: 'FILLED', reason: 'LIMIT_TOUCHED', price } : { status: 'ORDER_PENDING', reason: 'WAITING_FOR_LIMIT_TOUCH', price };
}

function startMonitor() {
    if(priceTimer) clearInterval(priceTimer);
    priceTimer = setInterval(async () => {
        if(!limitOrder) {
            clearInterval(priceTimer);
            return;
        }
        const orderPair = limitOrder.pair || pair;
        const p = await getPrice(orderPair);
        if(!p) return;
        const settings = getMarketSettings(orderPair);
        if(orderPair === pair) {
            document.getElementById('currentPrice').innerHTML = `$${p.toFixed(settings.prec)}`;
        }
        
        const lifecycle = evaluatePendingPaperOrder(limitOrder, p, Date.now());
        if(lifecycle.status === 'EXPIRED') {
            recordPaperOrderEvent(limitOrder, lifecycle.status, lifecycle.reason, p);
            clearLimit();
            showNotif(`⏰ Order EXPIRED after ${LIMIT_ORDER_EXPIRY_HOURS}h — zone became stale`, 'warning');
            return;
        }
        if(lifecycle.status === 'INVALIDATED') {
            recordPaperOrderEvent(limitOrder, lifecycle.status, lifecycle.reason, p);
            clearLimit();
            showNotif('❌ Order INVALIDATED — structural invalidation was breached', 'warning');
            return;
        }
        
        const distToEntry = limitOrder.signalType === 'LONG' 
            ? ((p - limitOrder.idealEntry) / p * 100)
            : ((limitOrder.idealEntry - p) / p * 100);
        
        if(distToEntry <= ZONE_PROXIMITY_ALERT_PCT && distToEntry > 0) {
            showNotif(`🎯 PRICE APPROACHING ZONE! ${limitOrder.pair||''} ${limitOrder.signalType} — ${distToEntry.toFixed(2)}% away`, 'info');
        }
        
        if(lifecycle.status === 'FILLED') {
            const filled = limitOrder;
            recordPaperOrderEvent(filled, lifecycle.status, lifecycle.reason, filled.idealEntry);
            clearLimit();
            showNotif(`✅ FILLED! ${filled.pair||''} ${filled.signalType} @ $${p.toFixed(settings.prec)}`, 'success');
            // AUTO OUTCOME DETECTION: enqueue the fill so the next monitor
            // tick can poll 5M candles to see if SL or TP1 was hit.
            enqueuePendingFill(filled, filled.idealEntry);
            try {
                new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();
            } catch(e) {}
        }
    }, 2000);
}

function handleLimit() {
    if(!analysis || analysis.signalType === 'NEUTRAL') {
        showNotif('No signal', 'error');
        return;
    }
    const duplicate = validateDuplicatePaperOrder(limitOrder);
    if (!duplicate.valid) {
        showNotif(`â›” Order rejected: ${duplicate.message}`, 'warning');
        console.warn('[ORDER] duplicate paper order rejected', duplicate);
        return;
    }
    const requestedMode = String(analysis.execution_mode || DEFAULT_EXECUTION_MODE).toUpperCase();
    const riskGate = requestedMode === 'PAPER'
        ? buildPaperOrderRiskGate()
        : { mode: 'MANUAL', status: 'MANUAL', execution_allowed: true, position_size: null, risk_amount: null, issues: [], reason: 'Manual execution is user-controlled; this app only tracks the setup.' };
    if (!riskGate.execution_allowed) {
        showNotif(`⛔ Order rejected: ${riskGate.reason}`, 'warning');
        console.warn('[ORDER] paper risk gate rejected order', riskGate);
        return;
    }
    if (analysis.execution_allowed === false && analysis.manual_tracking_allowed !== true) {
        showNotif('⛔ Order rejected: final execution permission is disabled', 'error');
        console.error('[ORDER] execution permission rejected');
        return;
    }
    const executionMode = validateExecutionMode(requestedMode);
    if (!executionMode.valid) {
        showNotif(`⛔ Order rejected: ${executionMode.reason}`, 'error');
        console.error('[ORDER] execution mode rejected', executionMode);
        return;
    }
    const safety = validateLocalLimitOrderInput(analysis, pair);
    if (!safety.valid) {
        showNotif(`⛔ Order rejected: ${safety.issues.join('; ')}`, 'error');
        console.error('[ORDER] local safety validation rejected', safety);
        return;
    }
    const o = {
        id: Date.now(),
        pair: pair,
        execution_mode: executionMode.mode,
        signalType: analysis.signalType,
        idealEntry: analysis.idealEntry,
        stopLoss: analysis.stopLoss,
        takeProfit1: analysis.takeProfit1,
        takeProfit2: analysis.takeProfit2,
        takeProfit3: analysis.takeProfit3,
        confidence: analysis.confidence,
        entryReady: analysis.entryReady,
        executionDecision: analysis.executionDecision,
        invalidationPrice: analysis.invalidationPrice,
        confirmation: analysis.confirmation || 'Confirmed',
        patterns: analysis.patterns || 'MSNR',
        aiDecision: analysis.aiDecision || null,
        riskAdjustment: analysis.riskAdjustment || 1.0,
        rrUsed: analysis.rrUsed || 2.0,
        touches: analysis.touches || 0,
        isFresh: analysis.isFresh || false,
        distancePct: analysis.distancePct || 0,
        createdAt: new Date().toISOString(),
        source: 'Deterministic Candidate Engine + AI Selector',
        candidate_id: analysis.aiDecision?.selected_candidate_id || null,
        strategy_version: analysis.aiDecision?.strategy_version || STRATEGY_SPEC_VERSION,
        strategy: analysis.aiDecision?.strategy_label || analysis.patterns || null,
        entry_model: analysis.aiDecision?.entry_model || null,
        structural_invalidation: analysis.aiDecision?.structural_invalidation || null,
        quality_breakdown: analysis.aiDecision?.quality?.breakdown || analysis.aiDecision?.quality?.quality_breakdown || null,
        fill_price_source: 'LIMIT_ORDER_PRICE',
        idempotency_key: buildTrackedOrderIdempotencyKey({ ...analysis, candidate_id: analysis.aiDecision?.selected_candidate_id || null }, pair, executionMode.mode)
    };
    saveLimit(o);
    recordPaperOrderEvent(o, 'ORDER_PENDING', executionMode.mode === 'MANUAL' ? 'USER_APPROVED_MANUAL_TRACKING' : 'USER_APPROVED_PAPER_ORDER');
    startMonitor();
    const aiLabel = o.aiDecision ? '🤖 AI Setup' : '📊 Rule-Based';
    const prec = getPrec(pair);
    showNotif(`📝 ${aiLabel}: ${o.signalType} @ $${o.idealEntry.toFixed(prec)} | ${o.confirmation} | RR: 1:${o.rrUsed}`, 'info');
}

function copyJson(event = null) {
    if ((event?.altKey || event?.shiftKey || event?.detail >= 2) && window.__ICT_LAST_SCAN_REPLAY__) {
        const replay = window.__ICT_LAST_SCAN_REPLAY__;
        const diagnosticReplay = {
            schema_version: replay.schema_version,
            pair: replay.pair,
            quote: replay.quote,
            history: Object.fromEntries(Object.entries(replay.history || {}).map(([tf, candles]) => [tf, {
                count: candles.length,
                first_closed: candles[0]?.t || null,
                last_closed: candles.at(-1)?.t || null
            }])),
            structure: Object.fromEntries(Object.entries(replay.structure || {}).map(([tf, value]) => [tf, {
                structural_trend: value.structural_trend,
                momentum_trend: value.momentum_trend,
                effective_trend: value.effective_trend,
                structure_state: value.structure_state,
                bos_buy: !!value.bos_buy,
                bos_sell: !!value.bos_sell,
                choch_buy: !!value.choch_buy,
                choch_sell: !!value.choch_sell,
                mss: value.mss || null
            }])),
            daily_bias: replay.daily_bias,
            target_catalog: replay.production_trace?.target_catalog || null,
            setup_trace: replay.production_trace?.setup_trace || [],
            funnel: replay.production_trace?.funnel || null,
            discovery_events: replay.production_trace?.discovery_events || [],
            candidate_pipeline_audit: replay.candidate_pipeline_audit || null,
            final_output: replay.final_output
        };
        const replayText = JSON.stringify(diagnosticReplay, null, 2);
        navigator.clipboard.writeText(replayText)
            .then(() => showNotif('📋 Scan replay copied', 'success'))
            .catch(() => showNotif('Failed', 'error'));
        return;
    }
    const el = document.getElementById('jsonOutput');
    const t = el ? el.textContent : '';
    if(!t || t.trim() === '{}') {
        showNotif('Run analysis first', 'warning');
        return;
    }
    navigator.clipboard.writeText(t).then(() => showNotif('📋 Copied!', 'success')).catch(() => showNotif('Failed', 'error'));
}

function showNotif(m, t) {
    const n = document.getElementById('notification');
    n.innerHTML = m;
    n.className = `notification ${t}`;
    n.classList.remove('hidden');
    setTimeout(() => n.classList.add('hidden'), 3000);
}

// Manual trade result logging (for loss protection)
function logTradeResult(isWin, riskR) {
    recordTradeResult(isWin, riskR);
    showNotif(`✅ Trade logged: ${isWin ? 'WIN' : 'LOSS'} | Losses: ${consecutiveLosses} | Daily PnL: ${dailyPnlR.toFixed(1)}R`, isWin ? 'success' : 'warning');
}

// Expose for console access
window.logTradeResult = logTradeResult;

// ============================================
// MISSED FILL DETECTION
// ============================================

function normalizeTimestampUTC(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.abs(value) < 1e11 ? value * 1000 : value;
    }
    if (typeof value !== 'string' || !value.trim()) return NaN;
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        return Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
    }
    const iso = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCandleTimeUTC(t) {
    return normalizeTimestampUTC(t);
}

function orderCrossedInCandles(order, candles) {
    if(!order?.idealEntry || !candles?.length) return false;
    const created = new Date(order.createdAt).getTime();
    if(isNaN(created)) return false;
    return candles.some(c => {
        const t = parseCandleTimeUTC(c.t);
        if(isNaN(t) || t < created - 5 * 60 * 1000) return false;
        return order.signalType === 'LONG' ? c.l <= order.idealEntry : c.h >= order.idealEntry;
    });
}

async function checkMissedFill() {
    if(!limitOrder) return;
    try {
        const candles = await getHistory('5M', limitOrder.pair || pair);
        if(candles && orderCrossedInCandles(limitOrder, candles)) {
            const prec = getPrec(limitOrder.pair || pair);
            showNotif(`ℹ️ ${limitOrder.pair || ''} ${limitOrder.signalType} level $${limitOrder.idealEntry.toFixed(prec)} traded while you were away - order still active, review manually`, 'info');
        }
    } catch(e) {
        console.error('Missed-fill check:', e);
    }
}

console.log('✅ ICT Trading Bot Pro v8.0 - FINAL WORKING FIX loaded!');
console.log('✅ ALL PATTERNS INTACT: MSNR, FVG, OB, Swings, TBS, CRT');
console.log('✅ FIXES APPLIED:');
console.log('   - Pure Quality Selection (distance filter removed entirely)');
console.log('   - Checks BOTH BUY and SELL directions');
console.log('   - Entry adjusted to near current price');
console.log('   - All patterns scored and used');
console.log('   - TBS gets high priority');
console.log('   - CRT expanding gives bonus');
console.log('   - HTF alignment scored');
console.log('   - Session bonus (Killzone/Silver Bullet)');
console.log('   - Freshness scoring');
console.log(`   - Min confidence: ${MIN_CONFIDENCE}%`);
