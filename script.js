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
let scanInProgress = false;
let lastAIRequestError = null;

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
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const requestOptions = controller.signal === undefined
            ? { ...options }
            : { ...options, signal: controller.signal };
        const response = await fetch(url, requestOptions);
        const data = await response.json();
        return { response, data };
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

// HAS_REAL_VOLUME: Twelve Data returns synthetic/sparse volume for many forex
// and metals pairs (the v field falls back to 1e6 in getHistory). When false,
// volume-based scoring (volumeTruth surge/fake, sentiment volume, market-phase
// volumeRatio) must be downweighted or zeroed — fake volume is NOT confirmation.
// Crypto pairs (BTC) have real volume; XAU/XAG and FX pairs do not (varies by
// plan, but we default conservative).
const REAL_VOLUME_PAIRS = new Set(['BTC/USD']);
function hasRealVolume(p) {
    const sym = SYMBOLS[p || pair] || (p || pair);
    return REAL_VOLUME_PAIRS.has(sym);
}

let lastScanRejections = [];
const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day','1W':'1week' };
const ALL_TIMEFRAMES = ['5M', '15M', '1H', '4H', '1D'];
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
function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.015, targetRR: 2.5, prec: 2, pipSize: 0.1, minSLMultiplier: 2.0 };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.015, targetRR: 2.5, prec: 2, pipSize: 0.01 };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.01, targetRR: 2.5, prec: 3, pipSize: 0.01 };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.02, targetRR: 2.5, prec: 2, pipSize: 1 };
    return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.01, targetRR: 2.5, prec: 5, pipSize: 0.0001 };
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
    if(ts) { 
        ts.innerHTML = TWELVE_DATA_KEY ? '✅ Active' : '❌ Missing'; 
        ts.className = 'status-badge ' + (TWELVE_DATA_KEY ? 'active' : 'inactive'); 
    }
    if(ds) { 
        ds.innerHTML = DEEPSEEK_API_KEY ? '✅ Active' : '❌ Missing'; 
        ds.className = 'status-badge ' + (DEEPSEEK_API_KEY ? 'active' : 'inactive'); 
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
        const du = document.getElementById('urlInput').value.trim() || 'https://api.deepseek.com/chat/completions';
        if(!dk) { document.getElementById('testResult').innerHTML = '❌ Enter key first'; return; }
        document.getElementById('testResult').innerHTML = '🔄 Testing...';
        try {
            const r = await fetch(du, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dk}` },
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
        if(!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY) {
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
async function fetchTD(pathAndQuery, timeoutMs = 10000, retries = 2) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(`${TWELVE_DATA_BASE}${pathAndQuery}&apikey=${TWELVE_DATA_KEY}`, { signal: ctrl.signal });
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
    if(!TWELVE_DATA_KEY) return null;
    try {
        const d = await fetchTD(`/price?symbol=${encodeURIComponent(SYMBOLS[p])}`);
        if(d.price) {
            calls++;
            document.getElementById('apiSource').innerHTML = '📡 Live';
            cachedPrice = +d.price;
            priceCacheTime = now;
            cachedPricePair = p;
            return cachedPrice;
        }
    } catch(e) {
        if(cachedPrice !== null && cachedPricePair === p) return cachedPrice;
    }
    return null;
}

async function getHistory(tfStr, forPair) {
    if(!TWELVE_DATA_KEY) return null;
    try {
        const d = await fetchTD(`/time_series?symbol=${encodeURIComponent(SYMBOLS[forPair || pair])}&interval=${TF_MAP[tfStr]}&outputsize=100`);
        if(d.values) {
            calls++;
            return d.values.map(c => ({
                t: c.datetime,
                o: +c.open,
                h: +c.high,
                l: +c.low,
                c: +c.close,
                v: +c.volume || 1e6
            })).reverse();
        }
    } catch(e) { console.error(`History error (${tfStr}):`, e); }
    return null;
}

const INDICATOR_CACHE_TTL = 4 * 60 * 1000;

async function getTechnicalIndicators(tfUsed, candleData = null) {
    if(!TWELVE_DATA_KEY) return {};
    const cacheKey = `${pair}|${tfUsed}`;
    const cachedHit = indicatorCache[cacheKey];
    if(cachedHit && Date.now() - cachedHit.ts < INDICATOR_CACHE_TTL) return cachedHit.data;

    const symbol = encodeURIComponent(SYMBOLS[pair]);
    const interval = TF_MAP[tfUsed];
    const ind = {};
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

    // Fetched from the API only where there is no local equivalent (7 calls per TF)
    const endpoints = [
        {name: 'macd', url: `/macd?symbol=${symbol}&interval=${interval}`},
        {name: 'stoch', url: `/stoch?symbol=${symbol}&interval=${interval}`},
        {name: 'cci', url: `/cci?symbol=${symbol}&interval=${interval}&time_period=20`},
        {name: 'williams', url: `/williams?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'sar', url: `/sar?symbol=${symbol}&interval=${interval}&acceleration=0.02&maximum=0.2`},
        {name: 'ichimoku', url: `/ichimoku?symbol=${symbol}&interval=${interval}`},
        {name: 'supertrend', url: `/supertrend?symbol=${symbol}&interval=${interval}&time_period=10&multiplier=3`}
    ];
    await Promise.all(endpoints.map(async (e) => {
        try {
            const d = await fetchTD(e.url);
            if(!d.values) return;
            calls++;
            const v = d.values[0];
            if(e.name === 'macd') { ind.macd = parseFloat(v.macd); ind.macd_signal = parseFloat(v.macd_signal); ind.macd_hist = parseFloat(v.macd_hist); }
            if(e.name === 'stoch') { ind.stoch_k = parseFloat(v.slow_k); ind.stoch_d = parseFloat(v.slow_d); }
            if(e.name === 'cci') ind.cci = parseFloat(v.cci);
            if(e.name === 'williams') ind.williams_r = parseFloat(v.williams);
            if(e.name === 'sar') ind.sar = parseFloat(v.sar);
            if(e.name === 'ichimoku') { ind.ichimoku_tenkan = parseFloat(v.tenkan_sen); ind.ichimoku_kijun = parseFloat(v.kijun_sen); ind.ichimoku_senkou_a = parseFloat(v.senkou_span_a); ind.ichimoku_senkou_b = parseFloat(v.senkou_span_b); }
            if(e.name === 'supertrend') ind.supertrend = parseFloat(v.supertrend);
        } catch (err) { console.error(`Error fetching ${e.name}:`, err); }
    }));
    indicatorCache[cacheKey] = { data: ind, ts: Date.now() };
    return ind;
}

async function getQuoteDirection(tfStr, cachedData = null) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if(data && data.length >= 50) return detectTrend(data);
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
    let f = [];
    const len = d.length;
    for(let i = 1; i < len - 1; i++) {
        const prev = d[i - 1];
        const curr = d[i];
        const next = d[i + 1];
        const thresh = curr.c * 0.0003;
        
        if(prev.h < next.l && next.l - prev.h > thresh) {
            f.push({ type: 'bull', l: prev.h, h: next.l, m: (prev.h + next.l) / 2 });
        }
        if(prev.l > next.h && prev.l - next.h > thresh) {
            f.push({ type: 'bear', l: next.h, h: prev.l, m: (next.h + prev.l) / 2 });
        }
    }
    return f;
}

// Find Swings
function findSwings(d, lb = 3) {
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
    if (!ictGetLastTradeTime()) ictSetLastTradeTime(Date.now());
    if(isWin) { consecutiveLosses = 0; dailyPnlR += riskR; }
    else { consecutiveLosses++; dailyPnlR -= riskR; }
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
        patterns: order.patterns || '',
        rrUsed: order.rrUsed || 0,
        source: order.source || null,
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
    const obs = [];
    for(let i = 2; i < data.length - 1; i++) {
        const curr = data[i];
        const next = data[i + 1];
        
        if(direction === 'BUY') {
            if(curr.c < curr.o && next.c > next.o && next.h > curr.h) {
                obs.push({ high: curr.h, low: curr.l });
            }
        } else {
            if(curr.c > curr.o && next.c < next.o && next.l < curr.l) {
                obs.push({ high: curr.h, low: curr.l });
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

// High Impact News Filter Check (Warning only, robust fallback)
function checkHighImpactNews(customPair = null) {
    try {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcMin = now.getUTCMinutes();
        const totalMin = utcHour * 60 + utcMin;
        const newsWindows = [
            { name: 'US CPI / NFP (12:30 UTC)', start: 12 * 60 + 15, end: 12 * 60 + 45 },
            { name: 'FOMC Rate Decision (18:00 UTC)', start: 17 * 60 + 45, end: 18 * 60 + 15 }
        ];
        for(const w of newsWindows) {
            if(totalMin >= w.start && totalMin <= w.end) {
                return { inNewsWindow: true, newsName: w.name, warning: `⚠️ High impact news window (${w.name})` };
            }
        }
        return { inNewsWindow: false, newsName: null, warning: null };
    } catch(e) {
        console.warn('News filter check fallback:', e);
        return { inNewsWindow: false, newsName: null, warning: null };
    }
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

const STRATEGY_SPEC = {
    CRT: { referenceLookback: 18, eventLookahead: 10, minReferenceAtr: 0.35, maxEventAgeBars: 8, minSweepAtr: 0.04, dedupeAtr: 0.2, maxEventsPerTimeframe: 8 },
    TBS: { lookback: 80, referenceMinAgeBars: 4, maxEventAgeBars: 8, minSweepAtr: 0.04, minSweepPips: 2, dedupeAtr: 0.2, maxEventsPerTimeframe: 8 },
    MSNR: { lookback: 120, maxMitigationCount: 2, breakCloseBufferAtr: 0.03, retestToleranceAtr: 0.15, zoneAtrWidth: 0.08, minStructuralScore: 35, maxLevelsPerTimeframe: 12 },
    COMBINATION: { minScore: 60, sameTfBars: 20, crossTfHours: 18, maxSetups: 24 },
    EXECUTION: { maxStopsPerZone: 8, maxTargetsPerEvaluation: 20 },
    TARGET: { maxAtrDistance: 12, firstObjectiveBonus: 14, seriousObstaclePenalty: 22, weakObstaclePenalty: 7 }
};

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
    const parsed = parseCandleTimeUTC(candle?.t);
    if (Number.isFinite(parsed)) return parsed;
    const minutes = timeframe === '1D' ? 1440 : timeframe === '4H' ? 240 : timeframe === '1H' ? 60 : timeframe === '15M' ? 15 : timeframe === '5M' ? 5 : 60;
    return index * minutes * 60000;
}

function getStrategyEventTime(setup) {
    return setup?.event_time || setup?.reclaim_time || setup?.retest_time || setup?.break_time || setup?.source_time || null;
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
    const time = Number(event?.event_time) || 0;
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
    const temporalLimit = sameTf ? STRATEGY_SPEC.COMBINATION.sameTfBars * 60 : STRATEGY_SPEC.COMBINATION.crossTfHours;
    const temporallyRelated = timeDiffHours == null ? false : timeDiffHours <= temporalLimit;
    const setupLiquidity = [setup.sweep_extreme, setup.reclaim_level, setup.evidence?.level].map(Number).find(Number.isFinite);
    const otherLiquidity = [other.sweep_extreme, other.reclaim_level, other.evidence?.level].map(Number).find(Number.isFinite);
    const sameLiquidityEvent = sameDirection && Number.isFinite(setupLiquidity) && Number.isFinite(otherLiquidity) && Math.abs(setupLiquidity - otherLiquidity) <= width * 2;
    const timeframeRelationship = sameTf ? 'SAME_TIMEFRAME' : 'CROSS_TIMEFRAME';
    const combinationScore = (sameDirection ? 25 : 0) + (spatiallyRelated ? 25 : 0) + (temporallyRelated ? 25 : 0) + (sameLiquidityEvent ? 20 : 0) + (timeframeRelationship === 'CROSS_TIMEFRAME' ? 5 : 0);
    return { spatially_related: spatiallyRelated, temporally_related: temporallyRelated, same_liquidity_event: sameLiquidityEvent, same_direction: sameDirection, timeframe_relationship: timeframeRelationship, time_diff_hours: timeDiffHours, combination_score: combinationScore };
}

function evaluateTargetReachability({ direction, entry, stopLoss, target, historyCache, zones, liquidity, strategySetup }) {
    const targetLevel = Number(target?.level);
    const tf = target?.timeframe || strategySetup?.timeframe || '1H';
    const data = historyCache?.[tf] || historyCache?.['1H'] || historyCache?.['4H'] || [];
    const atrVal = data.length >= 15 ? atr(data, 14) : null;
    const targetDistance = Math.abs(targetLevel - entry);
    const targetDistanceAtr = atrVal > 0 ? targetDistance / atrVal : null;
    const between = level => direction === 'BUY' ? level > entry && level < targetLevel : level < entry && level > targetLevel;
    const opposingZones = (zones || []).filter(z => z.direction && z.direction !== direction && z.primary_eligible !== false && !z.invalidated)
        .filter(z => between((Number(z.low) + Number(z.high)) / 2));
    const serious = opposingZones.filter(z => ['MSNR', 'OB'].includes(z.type) || z.freshness === 'FRESH');
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
    return {
        reachable: reachabilityScore >= 30,
        reachability_score: reachabilityScore,
        target_quality: reachabilityScore >= 75 ? 'HIGH' : reachabilityScore >= 55 ? 'MEDIUM' : 'LOW',
        target_distance: targetDistance,
        target_distance_atr: targetDistanceAtr,
        intervening_obstacles: opposingZones.map(z => ({ type: z.type, timeframe: z.timeframe, low: z.low, high: z.high, severity: serious.includes(z) ? 'SERIOUS' : 'WEAK' })),
        intervening_liquidity: interveningLiquidity,
        structural_priority: Number(target.structural_priority) || 50,
        reason: `${opposingZones.length} opposing zones, ${interveningLiquidity.length} liquidity levels before target`
    };
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

// Precision SL calculation (XAU/USD: Minimum 2.0x ATR, Others: Minimum 1.5x ATR)
function calcStopLoss(data, direction, entry, zone, msnr, tf, customATR = null, customPair = null) {
    const atrVal = customATR || atr(data, 14);
    const p = customPair || pair;
    const settings = getMarketSettings(p);
    const prec = settings.prec;
    const factor = Math.pow(10, prec);
    
    // Ensure SL is at least 2x ATR away from entry (min) and 3x ATR for max
    const minMultiplier = p.includes('XAU') ? 2.0 : 1.5;
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
    const factor = Math.pow(10, prec);
    const risk = Math.abs(entry - slPrice);
    const minTP1Dist = risk * 2.0;

    let tp1, tp2, tp3;
    if(msnrData) {
        if(direction === 'BUY') {
            const resLevels = (msnrData.allResistances || []).filter(r => r >= entry + minTP1Dist).sort((a,b) => a - b);
            tp1 = resLevels[0] || (entry + risk * 2.0);
            tp2 = resLevels[1] || (tp1 + Math.max(risk * 1.0, (tp1 - entry) * 0.5));
            tp3 = resLevels[2] || (tp2 + Math.max(risk * 1.0, (tp2 - tp1) * 0.5));
        } else {
            const supLevels = (msnrData.allSupports || []).filter(s => s <= entry - minTP1Dist).sort((a,b) => b - a);
            tp1 = supLevels[0] || (entry - risk * 2.0);
            tp2 = supLevels[1] || (tp1 - Math.max(risk * 1.0, (entry - tp1) * 0.5));
            tp3 = supLevels[2] || (tp2 - Math.max(risk * 1.0, (tp1 - tp2) * 0.5));
        }
    } else {
        tp1 = direction === 'BUY' ? entry + risk * 2.0 : entry - risk * 2.0;
        tp2 = direction === 'BUY' ? entry + risk * 3.0 : entry - risk * 3.0;
        tp3 = direction === 'BUY' ? entry + risk * 4.0 : entry - risk * 4.0;
    }

    // Ensure TP1 is at least 2.0x risk away and distinct targets
    if(direction === 'BUY') {
        if(tp1 < entry + minTP1Dist) tp1 = entry + minTP1Dist;
        if(tp2 <= tp1) tp2 = tp1 + Math.max(0.01, risk * 1.0);
        if(tp3 <= tp2) tp3 = tp2 + Math.max(0.01, risk * 1.0);
    } else {
        if(tp1 > entry - minTP1Dist) tp1 = entry - minTP1Dist;
        if(tp2 >= tp1) tp2 = tp1 - Math.max(0.01, risk * 1.0);
        if(tp3 >= tp2) tp3 = tp2 - Math.max(0.01, risk * 1.0);
    }

    tp1 = Math.round(tp1 * factor) / factor;
    tp2 = Math.round(tp2 * factor) / factor;
    tp3 = Math.round(tp3 * factor) / factor;
    return { tp1, tp2, tp3 };
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

function ictBuildRealZones(data, price, direction, pairLocal) {
    if (!data || data.length < 20) return [];
    const zones = [];
    const settings = getMarketSettings(pairLocal);
    const edgePad = Math.max(settings.pipSize * 2, price * 0.000001);

    for (const fvg of detectFVG(data)) {
        if (direction === 'BUY' && fvg.type === 'bull' && fvg.l < price) {
            zones.push({ type: 'FVG', origin: 'STRUCTURAL', primary_eligible: true, low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad });
        }
        if (direction === 'SELL' && fvg.type === 'bear' && fvg.h > price) {
            zones.push({ type: 'FVG', origin: 'STRUCTURAL', primary_eligible: true, low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad });
        }
    }

    for (const ob of detectOrderBlocks(data, direction)) {
        if (direction === 'BUY' && ob.high < price) {
            zones.push({ type: 'OB', origin: 'STRUCTURAL', primary_eligible: true, low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad });
        }
        if (direction === 'SELL' && ob.low > price) {
            zones.push({ type: 'OB', origin: 'STRUCTURAL', primary_eligible: true, low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad });
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

// ============================================
// UPDATE MTF DISPLAY
// ============================================

async function updateMTFDisplay(historyCache = {}) {
    const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
    for(let t of tfs) {
        let tr = 'NEUTRAL';
        try {
            const data = historyCache[t] || await getHistory(t);
            if(data && data.length >= 2) {
                tr = detectTrend(data);
            }
        } catch(e) { /* ignore */ }
        
        let el = document.getElementById(`trend${t}`);
        if(el) {
            el.innerHTML = tr === 'BULLISH' ? '🟢 Bull' : (tr === 'BEARISH' ? '🔴 Bear' : '⚪ Neut');
            el.className = `mtf-trend ${tr.toLowerCase()}`;
        }
    }
}

// ============================================
// SIMPLIFIED AI EXECUTION DECISION
// ============================================

async function getAIExecutionDecision(best, price, htfData) {
    if(!DEEPSEEK_API_KEY) {
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
        const { response, data } = await requestAIJson(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
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
                    wait_condition: decision === 'wait_for_reaction' ? 'Wait for confirmation' : null,
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

            // REALISTIC RR CAP (Max 1:5, but TP1 never below the 2.0x minimum)
            const maxReward = risk * 5.0; // Cap RR at 1:5 maximum
            if(dir === 'BUY') {
                if(tp3 > entry + maxReward) {
                    tp3 = entry + maxReward;
                    if(tp2 >= tp3) tp2 = entry + maxReward * 0.66;
                    if(tp1 >= tp2) tp1 = entry + maxReward * 0.40;
                }
            } else {
                if(tp3 < entry - maxReward) {
                    tp3 = entry - maxReward;
                    if(tp2 <= tp3) tp2 = entry - maxReward * 0.66;
                    if(tp1 <= tp2) tp1 = entry - maxReward * 0.40;
                }
            }
            tp1 = Math.round(tp1 * factor) / factor;
            tp2 = Math.round(tp2 * factor) / factor;
            tp3 = Math.round(tp3 * factor) / factor;

            // RR Protection Checks (Minimum 1.5x RR)
            const reward1 = Math.abs(tp1 - entry);
            const rr1 = risk > 0 ? reward1 / risk : 0;
            const totalReward = Math.abs(tp3 - entry);
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
                // STRUCTURAL FIX: pull TP1 back to just in front of the nearest obstacle
                const buf = (dir === 'BUY' ? 1 : -1) * (settings.pipSize * 2);
                if(clearance.nearestLevel) {
                    const newTp1 = dir === 'BUY' ? clearance.nearestLevel - buf : clearance.nearestLevel + buf;
                    if((dir === 'BUY' && newTp1 > entry && newTp1 < tp1) ||
                       (dir === 'SELL' && newTp1 < entry && newTp1 > tp1)) {
                        tp1 = Math.round(newTp1 * factor) / factor;
                        reasons.push(`TP1 pulled back to ${tp1} (obstacle @${clearance.nearestLevel.toFixed(settings.prec)})`);
                        if(dir === 'BUY' && tp2 <= tp1) tp2 = Math.round((tp1 + risk * 0.66) * factor) / factor;
                        if(dir === 'SELL' && tp2 >= tp1) tp2 = Math.round((tp1 - risk * 0.66) * factor) / factor;
                        if(dir === 'BUY' && tp3 <= tp2) tp3 = Math.round((tp2 + risk * 0.66) * factor) / factor;
                        if(dir === 'SELL' && tp3 >= tp2) tp3 = Math.round((tp2 - risk * 0.66) * factor) / factor;
                    }
                }
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

function findTp1TargetCandidate(aiResult, liveMarketContext, rrMetrics) {
    const direction = aiResult?.direction;
    const side = direction === 'BUY' ? 'buy' : direction === 'SELL' ? 'sell' : null;
    const supplied = side
        ? (liveMarketContext?.target_candidates?.all || liveMarketContext?.target_candidates?.[side] || []).filter(c => c.direction === direction)
        : [];
    if (supplied.length === 0) return { checked: false, hasValidCandidate: true, matched: null };

    const entry = Number(aiResult.entry);
    const tp1 = Number(aiResult.take_profit_1);
    const validTargets = supplied
        .filter(c => Number.isFinite(Number(c.level)))
        .filter(c => direction === 'BUY'
            ? Number(c.level) + 1e-9 >= rrMetrics.minimum_valid_tp1_price
            : Number(c.level) - 1e-9 <= rrMetrics.maximum_valid_tp1_price)
        .sort((a, b) => Math.abs(Number(a.level) - entry) - Math.abs(Number(b.level) - entry));
    const tolerance = Math.max(Math.abs(tp1) * 0.0002, 0.00001);
    const matched = validTargets.find(c => Math.abs(Number(c.level) - tp1) <= tolerance) || null;
    return { checked: true, hasValidCandidate: validTargets.length > 0, matched, nearest: validTargets[0] || null };
}

function getAdaptiveEntryCandidates(zone, direction, prec) {
    const low = Number(zone.low);
    const high = Number(zone.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return [];
    const entries = direction === 'BUY'
        ? [high, (low + high) / 2, low]
        : [low, (low + high) / 2, high];
    return [...new Set(entries.map(v => ictRound(v, prec)))].filter(v => v >= low && v <= high);
}

function getAdaptiveStopCandidates(zone, direction, entry, data, zones, atrVal, settings, prec) {
    const buffer = Math.max(settings.pipSize * 2, (atrVal || 0) * 0.05, entry * 0.00002);
    const raw = [];
    const add = (level, source, origin = 'STRUCTURAL') => {
        const n = Number(level);
        if (!Number.isFinite(n)) return;
        if (direction === 'BUY' && n < entry) raw.push({ level: n, source, origin });
        if (direction === 'SELL' && n > entry) raw.push({ level: n, source, origin });
    };

    add(zone.structural_invalidation, 'STRATEGY_INVALIDATION', zone.origin || 'STRUCTURAL');
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
        if (!dedupe.has(key)) {
            dedupe.set(key, { ...c, stop_loss: roundedStop, buffer: ictRound(buffer, prec) });
        }
    }
    return [...dedupe.values()].sort((a, b) => Math.abs(a.stop_loss - entry) - Math.abs(b.stop_loss - entry));
}

function selectAdaptiveTargets(direction, entry, stopLoss, targetCandidates, minimumRR, prec, reachabilityContext = {}) {
    const side = direction === 'BUY' ? 'buy' : 'sell';
    const risk = Math.abs(entry - stopLoss);
    const requiredReward = risk * minimumRR;
    const threshold = direction === 'BUY' ? entry + requiredReward : entry - requiredReward;
    const sourceTargets = targetCandidates?.all
        ? targetCandidates.all.filter(c => c.direction === direction)
        : (targetCandidates?.[side] || []);
    const targets = sourceTargets
        .filter(c => Number.isFinite(Number(c.level)) && !['ATR_FALLBACK', 'PIVOT_REFERENCE', 'PIVOT_DERIVED'].includes(c.origin))
        .map(c => ({ ...c, level: ictRound(Number(c.level), prec), distance_from_entry: ictRound(Math.abs(Number(c.level) - entry), prec) }))
        .filter(c => direction === 'BUY' ? c.level > entry : c.level < entry)
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
    const valid = targets
        .filter(c => direction === 'BUY' ? c.level + 1e-9 >= threshold : c.level - 1e-9 <= threshold)
        .filter(c => c.target_reachability.reachable)
        .sort((a, b) => b.composite_score - a.composite_score || b.reachability_score - a.reachability_score || a.distance_from_entry - b.distance_from_entry);
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
    const setupData = historyCache?.[setupTimeframe] || historyCache?.['1H'] || historyCache?.['4H'] || [];
    const higherTf = setupTimeframe === '4H' ? '1D' : '4H';
    const higherData = historyCache?.[higherTf] || [];
    const setupAtr = setupData.length >= 15 ? atr(setupData, 14) : NaN;
    const higherAtr = higherData.length >= 15 ? atr(higherData, 14) : NaN;
    const fallbackAtr = historyCache?.['4H']?.length >= 15 ? atr(historyCache['4H'], 14) : NaN;
    const atrForRule = Number.isFinite(setupAtr) && setupAtr > 0
        ? setupAtr
        : (Number.isFinite(fallbackAtr) && fallbackAtr > 0 ? fallbackAtr : NaN);
    const minMultiplier = settings.minSLMultiplier || (pairLocal.includes('XAU') ? 2.0 : 1.5);
    const minimumReasonable = Number.isFinite(atrForRule) && atrForRule > 0
        ? Math.max(settings.minSL, atrForRule * 0.5)
        : settings.minSL;
    const extremeTooTight = Number.isFinite(atrForRule) && atrForRule > 0
        ? Math.max(settings.minSL, atrForRule * 0.15)
        : settings.minSL;
    const maxByAtr = Number.isFinite(atrForRule) && atrForRule > 0 ? atrForRule * 10.0 : Infinity;
    const maxByPrice = Number(price) * settings.maxSLPct;
    const maxDistance = Math.max(settings.minSL, Math.min(maxByPrice, maxByAtr));
    return {
        setup_timeframe: setupTimeframe,
        setup_atr: Number.isFinite(setupAtr) && setupAtr > 0 ? setupAtr : null,
        higher_timeframe: higherTf,
        higher_timeframe_atr: Number.isFinite(higherAtr) && higherAtr > 0 ? higherAtr : null,
        atr_rule_reference: Number.isFinite(atrForRule) && atrForRule > 0 ? atrForRule : null,
        min_atr_multiplier: minMultiplier,
        minimum_reasonable_distance: minimumReasonable,
        extreme_too_tight_distance: extremeTooTight,
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
    const riskDistance = Math.abs(entry - stopLoss);
    // Pair minimums remain diagnostic references. A structurally valid stop is
    // not rejected solely for being slightly tighter than that reference.
    const atrMultiple = atrContext.atr_rule_reference ? riskDistance / atrContext.atr_rule_reference : null;
    if (atrContext.extreme_too_tight_distance && riskDistance < atrContext.extreme_too_tight_distance) {
        return { status: 'EXTREME_TOO_TIGHT', hardReject: true, volatility_classification: 'EXTREME_TOO_TIGHT', reason: `SL distance ${riskDistance.toFixed(settings.prec)} is below the minimum reasonable distance and is an extreme volatility anomaly for ${atrContext.setup_timeframe}` };
    }
    if (riskDistance > atrContext.maximum_reasonable_distance) {
        return { status: 'EXTREME_TOO_WIDE', hardReject: true, volatility_classification: 'EXTREME_TOO_WIDE', reason: `SL distance ${riskDistance.toFixed(settings.prec)} exceeds ${atrContext.setup_timeframe} maximum reasonable distance ${atrContext.maximum_reasonable_distance.toFixed(settings.prec)}` };
    }
    const volatilityClassification = Number.isFinite(atrMultiple)
        ? (atrMultiple < 0.75 ? 'TIGHT_BUT_STRUCTURAL' : (atrMultiple > 6 ? 'WIDE_BUT_STRUCTURAL' : 'NORMAL'))
        : 'NORMAL';
    return { status: 'VALID_STRUCTURAL_STOP', hardReject: false, volatility_classification: volatilityClassification, reason: `Structural stop is ${volatilityClassification}`, riskDistance, atrMultiple };
}

function classifySetupArchetype(candidate, historyCache, price, structure) {
    const direction = candidate?.direction;
    const desiredTrend = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const trends = ['1D', '4H', '1H'].map(tf => structure?.[tf]?.trend).filter(Boolean);
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

function buildRiskConstraints(pairLocal, price, historyCache) {
    const settings = getMarketSettings(pairLocal);
    const prec = settings.prec;
    const atr4h = historyCache?.['4H']?.length >= 15 ? atr(historyCache['4H'], 14) : null;
    const atr1h = historyCache?.['1H']?.length >= 15 ? atr(historyCache['1H'], 14) : null;
    const atr15m = historyCache?.['15M']?.length >= 15 ? atr(historyCache['15M'], 14) : null;
    const primaryAtr = Number.isFinite(atr4h) && atr4h > 0 ? atr4h : (Number.isFinite(atr1h) && atr1h > 0 ? atr1h : atr15m);
    const minSLMultiplier = settings.minSLMultiplier || (pairLocal.includes('XAU') ? 2.0 : 1.5);
    const rawMaxSLDistance = primaryAtr > 0 ? Math.min(price * settings.maxSLPct, primaryAtr * 4.0) : price * settings.maxSLPct;
    return {
        minimum_rr: settings.targetRR || 2.5,
        minimum_sl_distance: settings.minSL,
        maximum_sl_distance: ictRound(Math.max(settings.minSL, rawMaxSLDistance), prec),
        min_sl_atr_multiplier: minSLMultiplier,
        maximum_entry_distance_atr: LIMIT_ORDER_MAX_DIST_ATR,
        atr_rule_reference: Number.isFinite(primaryAtr) && primaryAtr > 0 ? ictRound(primaryAtr, prec) : null,
        note: 'Physical SL sanity is evaluated per candidate setup timeframe; this broad context is not a universal 4H-derived stop minimum.',
        tp1_rule: {
            formula: 'risk = abs(entry - stop_loss); required_reward = risk * minimum_rr',
            buy_minimum_valid_tp1: 'entry + required_reward',
            sell_maximum_valid_tp1: 'entry - required_reward'
        }
    };
}

function buildDeterministicValidationContext({ pair, price, historyCache, real_ict_zones, risk_constraints, structure, market_context, strategy_setups, require_strategy_setup }) {
    return {
        pair,
        price,
        historyCache,
        real_ict_zones: real_ict_zones || [],
        risk_constraints,
        structure,
        market_context,
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

function buildMarketContext({ pair, price, historyCache, structure, session, sessionCheck, liquidity, premiumDiscount, marketRegime, momentum, volatility, holistic }) {
    const bullishEvidence = [];
    const bearishEvidence = [];
    const conflicts = [];
    const htfTrends = ['1D', '4H', '1H'].map(tf => structure?.[tf]?.trend).filter(Boolean);
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
        structural_invalidation: setup.structural_invalidation
    });
    const zonesNearRegion = (direction, tf, low, high) => {
        const width = Math.max(Math.abs(high - low), settings.pipSize * 5);
        return zoneList.filter(z => z.direction === direction && z.primary_eligible !== false && !z.invalidated)
            .filter(z => z.high >= low - width * 2 && z.low <= high + width * 2);
    };
    const addSetup = (setup) => {
        if (!setup || !setup.direction || !setup.primary) return;
        const matchedZones = (setup.matched_zones || []).filter(Boolean);
        const executionZone = setup.execution_zone || (matchedZones[0] ? { ...matchedZones[0], strategy_source: setup.primary } : null);
        if (!executionZone) return;
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
        const data = historyCache?.[tf];
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
                reclaim_time: tbs.reclaim_time,
                event_time: tbs.event_time,
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
                reclaim_time: crt.reclaim_time,
                event_time: crt.event_time,
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
    for (const setup of setups) {
        const compatible = setups
            .filter(other => other !== setup && other.primary !== setup.primary)
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
                setup.target_candidates = [...(setup.target_candidates || []), ...(other.target_candidates || [])];
            }
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

function buildAdaptiveSetupCandidates({ pair, price, historyCache, zones, targetCandidates, riskConstraints, marketRegime, structure, marketContext, strategySetups }) {
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const minimumRR = Number(riskConstraints?.minimum_rr) || settings.targetRR || 2.5;
    const rawCandidates = [];
    const validCandidates = [];
    const rejectedCandidates = [];
    const dataQuality = validateMarketDataQuality(historyCache, price);
    if (!dataQuality.valid) {
        const result = { raw_candidates: [], valid_candidates: [], rejected_candidates: dataQuality.reasons.map(reason => ({ id: 'DATA_QUALITY', rejection_reasons: [reason] })) };
        console.log('RAW SETUP CANDIDATES', result.raw_candidates);
        console.log('VALID SETUP CANDIDATES', result.valid_candidates);
        console.log('REJECTED SETUP CANDIDATES', result.rejected_candidates);
        return result;
    }
    const strategyExecutionZones = Array.isArray(strategySetups) ? getStrategyExecutionZones(strategySetups) : [];
    const validationZones = Array.isArray(strategySetups)
        ? [...(zones || []), ...strategyExecutionZones]
        : (zones || []);
    const deterministicValidationContext = buildDeterministicValidationContext({
        pair,
        price,
        historyCache,
        real_ict_zones: validationZones,
        context_ict_zones: zones,
        strategy_execution_zones: strategyExecutionZones,
        risk_constraints: riskConstraints,
        structure,
        market_context: marketContext,
        strategy_setups: strategySetups || [],
        require_strategy_setup: Array.isArray(strategySetups)
    });

    const candidateZones = Array.isArray(strategySetups)
        ? strategyExecutionZones.filter(z => z.primary_eligible !== false && !z.invalidated)
        : (zones || []).filter(z => z.primary_eligible !== false && !z.invalidated);
    for (const zone of candidateZones) {
        if (zone.type === 'MSNR' && zone.origin !== 'STRUCTURAL_MSNR') continue;
        const strategySetup = zone.strategy_setup || (Array.isArray(strategySetups) ? getStrategySetupForZone(zone, strategySetups) : null);
        if (Array.isArray(strategySetups) && !strategySetup) continue;
        const direction = zone.direction;
        const tf = zone.timeframe || '1H';
        const data = historyCache?.[tf] || historyCache?.['1H'] || historyCache?.['4H'] || [];
        const atrData = tf === '4H' ? (historyCache?.['4H'] || []) : (historyCache?.['1H'] || []);
        const atrVal = atrData.length >= 15 ? atr(atrData, 14) : 0;
        const safeAtr = Number.isFinite(atrVal) && atrVal > 0 ? atrVal : 0;
        const entries = getAdaptiveEntryCandidates(zone, direction, prec);
        for (const entry of entries) {
            const stops = getAdaptiveStopCandidates(zone, direction, entry, data, zones, safeAtr, settings, prec)
                .slice(0, STRATEGY_SPEC.EXECUTION.maxStopsPerZone);
            for (const stop of stops) {
                const rawId = `${tf}-${zone.type}-${direction}-${ictRound(zone.low, prec)}-${ictRound(zone.high, prec)}-${rawCandidates.length + 1}`;
                const risk = Math.abs(entry - stop.stop_loss);
                const atrContext = getCandidateATRContext({ timeframe: tf }, historyCache, pair, price);
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
                    stop_reason: `${stop.source} invalidation plus structural buffer`,
                    stop_source: stop.source,
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
                        position_size_adjustment_required: true
                    },
                    freshness: zone.freshness,
                    htf_alignment: ['1D', '4H', '1H']
                        .map(t => structure?.[t]?.trend)
                        .filter(v => v === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')).length,
                    distance_from_current_price: ictRound(Math.abs(entry - price), prec),
                    distance_from_current_price_atr: safeAtr > 0 ? ictRound(Math.abs(entry - price) / safeAtr, 2) : null,
                    market_regime: marketRegime?.primary_regime || 'UNKNOWN'
                };
                if (strategySetup) {
                    rawCandidate.strategy_setup = strategySetup;
                    rawCandidate.strategy_label = strategySetup.label;
                    rawCandidate.patterns = [strategySetup.label];
                }
                rawCandidates.push(rawCandidate);
                const stopEvaluation = evaluateStructuralStop(rawCandidate, atrContext, pair);
                rawCandidate.risk_model.status = stopEvaluation.status;
                rawCandidate.risk_model.volatility_classification = stopEvaluation.volatility_classification;
                console.log('STRUCTURAL STOP EVALUATION', {
                    id: rawCandidate.id,
                    strategy: rawCandidate.strategy_label || rawCandidate.zone_type,
                    timeframe: tf,
                    direction,
                    entry,
                    structural_invalidation: zone.structural_invalidation || (direction === 'BUY' ? zone.low : zone.high),
                    stopLoss: stop.stop_loss,
                    risk,
                    setupAtr: atrContext.setup_atr,
                    riskAtr: stopEvaluation.atrMultiple || rawCandidate.sl_atr_multiple,
                    volatility_classification: stopEvaluation.volatility_classification,
                    hardReject: !!stopEvaluation.hardReject
                });
                if (stopEvaluation.status !== 'VALID_STRUCTURAL_STOP') {
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
                const mergedTargetCandidates = strategyTargets.length
                    ? {
                        ...(targetCandidates || {}),
                        all: [...strategyTargets, ...((targetCandidates?.all || targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || []))],
                        [direction === 'BUY' ? 'buy' : 'sell']: [...strategyTargets, ...(targetCandidates?.[direction === 'BUY' ? 'buy' : 'sell'] || [])]
                    }
                    : targetCandidates;
                const targets = selectAdaptiveTargets(direction, entry, stop.stop_loss, mergedTargetCandidates, minimumRR, prec, {
                    historyCache,
                    zones: validationZones,
                    liquidity: marketContext?.liquidity?.[tf] || mapLiquidity(data || []),
                    strategySetup
                });
                console.log('TARGET EVALUATION', {
                    id: rawCandidate.id,
                    strategy: rawCandidate.strategy_label || rawCandidate.zone_type,
                    direction,
                    entry,
                    stopLoss: stop.stop_loss,
                    requiredRR: minimumRR,
                    foundTp1: targets?.tp1?.level || null
                });
                if (!targets) {
                    console.log('CANDIDATE REJECTED - NO TP1', { id: rawCandidate.id, direction, entry, stopLoss: stop.stop_loss, requiredRR: minimumRR });
                    rejectedCandidates.push({
                        id: rawCandidate.id,
                        direction,
                        timeframe: tf,
                        zone_type: zone.type,
                        rejection_code: 'NO_VALID_TP1',
                        rejection_reasons: ['no real TP1 satisfies minimum RR']
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
                    setup_timeframe: strategySetup?.setup_timeframe || tf,
                    execution_timeframe: strategySetup?.execution_timeframe || tf,
                    strategy_evidence: strategySetup?.strategy_evidence || null,
                    target_map: targets ? [targets.tp1, targets.tp2, targets.tp3].filter(Boolean).map(t => ({
                        target_level: t.level,
                        target_type: t.target_type || t.source,
                        target_timeframe: t.timeframe || null,
                        target_distance: ictRound(Math.abs(t.level - entry), prec),
                        target_distance_atr: safeAtr > 0 ? ictRound(Math.abs(t.level - entry) / safeAtr, 2) : null,
                        structural_priority: t.structural_priority || 50,
                        intervening_obstacles: t.intervening_obstacles || [],
                        reachability_score: t.reachability_score,
                        target_reachability: t.target_reachability,
                        actual_rr: t.actual_rr
                    })) : [],
                    score: ictRound(score, 2)
                };
                Object.assign(rawCandidate, candidate);
                const evaluation = evaluateSetupCandidate(candidate, deterministicValidationContext);
                if (evaluation.valid) {
                    candidate.evaluation = { checks: evaluation.checks, metrics: evaluation.metrics };
                    console.log('STRATEGY CANDIDATE', { id: candidate.id, strategy: candidate.strategy_label, direction: candidate.direction, score: candidate.score });
                    validCandidates.push(candidate);
                } else {
                    console.log('STRATEGY CANDIDATE REJECTED', { id: candidate.id, strategy: candidate.strategy_label, reasons: evaluation.reasons });
                    rejectedCandidates.push({
                        id: candidate.id,
                        direction: candidate.direction,
                        timeframe: candidate.timeframe,
                        zone_type: candidate.zone_type,
                        rejection_code: classifyRejectionDetail(evaluation.reasons[0] || ''),
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
    aiResult.decision = candidate.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
    aiResult.order_type = 'LIMIT';
    aiResult.setup_type = 'PENDING_LIMIT';
    aiResult.selected_zone = { type: candidate.zone_type, timeframe: candidate.timeframe, low: candidate.zone_low, high: candidate.zone_high };
    aiResult.entry_zone = { source: candidate.zone_type, low: candidate.zone_low, high: candidate.zone_high };
    aiResult.entry = candidate.entry;
    aiResult.stop_loss = candidate.stop_loss;
    aiResult.stop_loss_reason = candidate.stop_reason;
    aiResult.take_profit_1 = candidate.tp1;
    aiResult.take_profit_2 = candidate.tp2 ?? null;
    aiResult.take_profit_3 = candidate.tp3 ?? null;
    aiResult.risk_reward = `1:${candidate.rr_tp1.toFixed(2)}`;
    aiResult.adaptive_candidate = candidate;
    aiResult.strategy_setup = candidate.strategy_setup || null;
    aiResult.strategy_evidence = candidate.strategy_evidence || candidate.strategy_setup?.strategy_evidence || null;
    aiResult.target_map = candidate.target_map || [];
    aiResult.entry_model = candidate.entry_model || null;
    aiResult.setup_timeframe = candidate.setup_timeframe || candidate.timeframe;
    aiResult.execution_timeframe = candidate.execution_timeframe || candidate.timeframe;
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

function validateMarketDataQuality(historyCache, price) {
    const reasons = [];
    if (!ictFiniteNumber(price) || price <= 0) reasons.push('current price is invalid');
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (!Array.isArray(data) || data.length < 50) {
            reasons.push(`Insufficient ${tf} data for reliable ATR/structure analysis`);
            continue;
        }
        let prevTime = null;
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
                    if (prevTime !== null && t < prevTime) {
                        reasons.push(`${tf} timestamps are not ordered`);
                        break;
                    }
                    prevTime = t;
                }
            }
        }
        const atrVal = data.length >= 15 ? atr(data, 14) : NaN;
        if (!Number.isFinite(atrVal) || atrVal <= 0) reasons.push(`${tf} ATR is unavailable or invalid`);
    }
    return { valid: reasons.length === 0, reasons };
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
        confidence: candidate.confidence || 70,
        reasoning: { primary: candidate.stop_reason || 'Deterministic candidate' },
        patterns: candidate.strategy_setup
            ? [candidate.strategy_setup.label || candidate.strategy_setup.primary].concat(candidate.strategy_setup.confirmations || [])
            : [candidate.zone_type],
        risk_reward: candidate.rr_tp1 ? `1:${candidate.rr_tp1}` : null
    };
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
    if (marketContext.require_strategy_setup) {
        const labels = [strategySetup?.primary, ...(strategySetup?.confirmations || [])].filter(Boolean);
        if (!labels.some(v => ['CRT', 'TBS', 'MSNR'].includes(v))) {
            add('candidate is not backed by a deterministic CRT/TBS/MSNR strategy setup');
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
            const candidates = ictBuildRealZones(data, price, direction, pairLocal);
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
        '1D': daily.length >= 50 ? detectTrend(daily) : (marketContext.structure?.['1D']?.trend || 'NEUTRAL'),
        '4H': fourH.length >= 50 ? detectTrend(fourH) : (marketContext.structure?.['4H']?.trend || 'NEUTRAL'),
        '1H': oneH.length >= 50 ? detectTrend(oneH) : (marketContext.structure?.['1H']?.trend || 'NEUTRAL')
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
    if (!data || data.length < 20) {
        return { timeframe: tf, trend: 'NEUTRAL', structure_sequence: [], recent_swing_highs: [], recent_swing_lows: [] };
    }
    const sw = findSwings(data, 3);
    const mss = detectMSS(data);
    return {
        timeframe: tf,
        trend: detectTrend(data),
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
    if (!data || data.length < 20) return [];
    const prec = getMarketSettings(pairLocal).prec;
    const zones = [];
    for (const direction of ['BUY', 'SELL']) {
        const realZones = ictBuildRealZones(data, price, direction, pairLocal);
        for (const z of realZones) {
            const midpoint = z.price || (z.low + z.high) / 2;
            const freshness = checkZoneFreshness(data, z, direction);
            const zoneStatus = getZonePriceStatus(price, z);
            zones.push({
                id: `${tf}-${direction}-${z.type}-${ictRound(z.low, prec)}-${ictRound(z.high, prec)}`,
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
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
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
            if (fvg.type === 'bear' && fvg.l > price) {
                candidates.push({ direction: 'BUY', timeframe: tf, source: 'OPPOSING_FVG', target_type: 'FVG', origin: 'STRUCTURAL', level: fvg.m, distance_from_price: Math.abs(fvg.m - price), structural_priority: 62 });
            }
            if (fvg.type === 'bull' && fvg.h < price) {
                candidates.push({ direction: 'SELL', timeframe: tf, source: 'OPPOSING_FVG', target_type: 'FVG', origin: 'STRUCTURAL', level: fvg.m, distance_from_price: Math.abs(fvg.m - price), structural_priority: 62 });
            }
        }
        for (const ob of detectOrderBlocks(data, 'SELL')) {
            const mid = (ob.low + ob.high) / 2;
            if (mid > price) candidates.push({ direction: 'BUY', timeframe: tf, source: 'OPPOSING_OB', target_type: 'OB', origin: 'STRUCTURAL', level: mid, distance_from_price: Math.abs(mid - price), structural_priority: 68 });
        }
        for (const ob of detectOrderBlocks(data, 'BUY')) {
            const mid = (ob.low + ob.high) / 2;
            if (mid < price) candidates.push({ direction: 'SELL', timeframe: tf, source: 'OPPOSING_OB', target_type: 'OB', origin: 'STRUCTURAL', level: mid, distance_from_price: Math.abs(mid - price), structural_priority: 68 });
        }
    }
    const dedupe = new Map();
    for (const c of candidates) {
        if (!Number.isFinite(c.level)) continue;
        const key = `${c.direction}-${c.timeframe}-${c.source}-${ictRound(c.level, prec)}`;
        dedupe.set(key, {
            ...c,
            level: ictRound(c.level, prec),
            distance_from_price: ictRound(c.distance_from_price, prec),
            distance_pct: ictRound(Math.abs(c.level - price) / price * 100, 3)
        });
    }
    const all = [...dedupe.values()];
    return {
        all: all.sort((a, b) => a.distance_from_price - b.distance_from_price).slice(0, 30),
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
    const counts = {};
    for (const item of rejectedCandidates || []) {
        for (const reason of item.rejection_reasons || []) {
            const key = reason.includes('RR') || reason.includes('target')
                ? 'RR_OR_TARGET'
                : reason.includes('HTF')
                    ? 'HTF'
                    : reason.includes('SL distance') || reason.includes('stop')
                        ? 'STOP_LOSS'
                        : reason.includes('zone')
                            ? 'ZONE'
                            : reason.includes('data') || reason.includes('ATR')
                                ? 'DATA_QUALITY'
                                : 'OTHER';
            counts[key] = (counts[key] || 0) + 1;
        }
    }
    return counts;
}

function classifyRejectionDetail(reason) {
    if (/BUY stop|SELL stop|STRUCTURALLY_INVALID/i.test(reason)) return 'STOP_STRUCTURAL_INVALID';
    if (/EXTREME_TOO_TIGHT|extreme volatility anomaly|below .*minimum|below .*ATR|too tight/i.test(reason)) return 'EXTREME_TOO_TIGHT';
    if (/EXTREME_TOO_WIDE|exceeds .*maximum|too wide/i.test(reason)) return 'EXTREME_TOO_WIDE';
    if (/no real target|no supplied target|no real deterministic target|target ladder/i.test(reason)) return 'NO_VALID_TP1';
    if (/RR .*below|minimum RR|actual RR/i.test(reason)) return 'TP1_RR_TOO_LOW';
    if (/HTF alignment/i.test(reason)) return 'CONTINUATION_HTF';
    if (/reversal evidence insufficient/i.test(reason)) return 'REVERSAL_EVIDENCE_INSUFFICIENT';
    if (/candidate zone|selected zone|real deterministic|invalidated|entry .*outside/i.test(reason)) return 'ZONE_INVALID';
    if (/loss protection/i.test(reason)) return 'LOSS_PROTECTION';
    if (/trade gap/i.test(reason)) return 'TRADE_GAP';
    if (/data|ATR is unavailable|current price/i.test(reason)) return 'DATA_QUALITY';
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
        combinations: { CRT_TBS: 0, CRT_MSNR: 0, TBS_MSNR: 0, CRT_TBS_MSNR: 0 }
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

function buildCandidatePipelineAudit(strategySetups, rawCandidates, rejectedCandidates, validCandidates) {
    const details = summarizeCandidateRejectionDetails(rejectedCandidates);
    return {
        strategy_setups: (strategySetups || []).length,
        execution_seeds: getStrategyExecutionZones(strategySetups || []).length,
        raw_candidates: (rawCandidates || []).length,
        structural_stop_valid: (rawCandidates || []).filter(c => c.risk_model?.status === 'VALID_STRUCTURAL_STOP').length,
        volatility_rejected: (details.EXTREME_TOO_TIGHT || 0) + (details.EXTREME_TOO_WIDE || 0) + (details.STOP_VOLATILITY_TOO_TIGHT || 0) + (details.STOP_VOLATILITY_TOO_WIDE || 0),
        target_rejected: (details.NO_VALID_TP1 || 0) + (details.TP1_RR_TOO_LOW || 0),
        consistency_rejected: details.ZONE_INVALID || 0,
        context_rejected: (details.CONTINUATION_HTF || 0) + (details.REVERSAL_EVIDENCE_INSUFFICIENT || 0),
        final_valid: (validCandidates || []).length
    };
}

function waitCodeFromRejections(audit, hasStrategySetups) {
    const detail = audit?.rejection_detail || {};
    if (!hasStrategySetups) return 'NO_STRATEGY_SETUP';
    if ((audit?.raw_candidate_count || audit?.raw_candidates || 0) === 0) return 'NO_EXECUTION_GEOMETRY';
    if (detail.STOP_STRUCTURAL_INVALID) return 'NO_STRUCTURAL_STOP';
    if (detail.EXTREME_TOO_TIGHT || detail.EXTREME_TOO_WIDE) return 'EXTREME_VOLATILITY';
    if (detail.NO_VALID_TP1) return 'NO_REALISTIC_TARGET';
    if (detail.TP1_RR_TOO_LOW) return 'RR_BELOW_MINIMUM';
    if (detail.REVERSAL_EVIDENCE_INSUFFICIENT || detail.CONTINUATION_HTF) return 'CONTEXT_QUALITY_TOO_LOW';
    if (detail.ZONE_INVALID) return 'AI_INCONSISTENT_OUTPUT';
    return 'NO_EXECUTION_GEOMETRY';
}

function buildLiveMarketContext({ pair, price, historyCache, indicators, patterns, enhancedAnalysis, holistic, entryContext }) {
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const now = new Date();
    const session = getSession(now);
    const sessionCheck = shouldTradeSession(now);
    const realVolume = hasRealVolume(pair);
    const atr4h = historyCache?.['4H']?.length >= 15 ? atr(historyCache['4H'], 14) : null;
    const atr1h = historyCache?.['1H']?.length >= 15 ? atr(historyCache['1H'], 14) : null;
    const atr15m = historyCache?.['15M']?.length >= 15 ? atr(historyCache['15M'], 14) : null;
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
        const tfZones = buildLiveZonesForTf(data, tf, price, pair, tfAtr || primaryAtr || 0, 5);
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
    const pdData = historyCache?.['4H']?.length >= 20 ? historyCache['4H'] : (historyCache?.['1H'] || []);
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
    const trendVotes = ['1D', '4H', '1H'].map(tf => structure[tf]?.trend).filter(Boolean);
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
    console.log('MARKET CONTEXT', marketContext);
    console.log('CONTEXT BIAS', {
        directional_bias: marketContext.directional_bias,
        context_score: marketContext.context_score,
        bullish_evidence: marketContext.bullish_evidence,
        bearish_evidence: marketContext.bearish_evidence,
        conflicts: marketContext.conflicts
    });
    const strategyStartedAt = scanClock();
    const strategySetups = buildStrategySetups({ pair, price, historyCache, realZones: zones, marketContext });
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
    const riskConstraints = buildRiskConstraints(pair, price, historyCache);
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
        strategy_setups: strategySetups,
        require_strategy_setup: true
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
    const candidatePipelineAudit = buildCandidatePipelineAudit(strategySetups, adaptiveSetupResult.raw_candidates, adaptiveSetupResult.rejected_candidates, adaptiveSetupResult.valid_candidates);
    console.log('FINAL REJECTION SUMMARY', {
        strategy_detections: strategyDetectionSummary,
        candidate_pipeline: candidatePipelineAudit,
        rejection_summary: stageContext.limit_order_setup.rejection_summary,
        rejection_detail: stageContext.limit_order_setup.rejection_detail
    });

    const liveContext = {
        pair,
        current_price: ictRound(price, prec),
        utc_time: now.toISOString(),
        session: sessionFacts,
        volatility: volatilityFacts,
        multi_timeframe_direction: {
            trend: {
                '1D': structure['1D'].trend,
                '4H': structure['4H'].trend,
                '1H': structure['1H'].trend,
                '15M': structure['15M'].trend
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
        setup_candidate_audit: {
            raw_candidate_count: adaptiveSetupResult.raw_candidates.length,
            valid_candidate_count: adaptiveSetupResult.valid_candidates.length,
            rejected_candidate_count: adaptiveSetupResult.rejected_candidates.length,
            rejection_summary: summarizeCandidateRejections(adaptiveSetupResult.rejected_candidates),
            rejection_detail: summarizeCandidateRejectionDetails(adaptiveSetupResult.rejected_candidates)
        },
        entry_filters: entryContext || null
    };
    Object.defineProperty(liveContext, 'deterministic_validation_context', {
        value: deterministicValidationContext,
        enumerable: false,
        configurable: true
    });
    return liveContext;
}

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
        strategy_label: c.strategy_label,
        strategy_evidence: c.strategy_evidence,
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
        entry_model: c.entry_model,
        entry_region_source: c.zone?.entry_region_source || c.entry_region_source,
        stop_source: c.stop_source,
        freshness: c.freshness,
        target_map: c.target_map,
        target_reachability: c.target_reachability,
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
            freshness: s.freshness,
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
        adaptive_setup_candidates: (liveMarketContext?.adaptive_setup_candidates || []).map(compactCandidate),
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

function buildAIPrompt(liveMarketContext, candleData) {
    const system = [
        'You are the discretionary candidate-selection layer of an ICT pending-limit trading system.',
        'The deterministic engine has already calculated and validated every numeric trade level in COMPUTED MARKET FACTS.adaptive_setup_candidates.',
        'You must NEVER invent, modify, recalculate, improve, widen, tighten, or replace entry, stop_loss, TP1, TP2, TP3, RR, or zone bounds.',
        'Your job is only to select the best candidate ID using the supplied live market context, or return WAIT/NO_TRADE for qualitative market reasons.',
        'A selected candidate numeric geometry is authoritative and immutable.',
        'VALID_CANDIDATES = executable numerical candidates that already passed all hard rules.',
        'REAL_ICT_ZONES = authoritative deterministic market structures.',
        'MARKET_CONTEXT = deterministic market understanding only; FVG, OB, BOS, CHoCH, MSS, liquidity, premium/discount, session, AMD, indicators, and ATR describe what the market is doing.',
        'STRATEGY_SETUPS = deterministic CRT, TBS/Turtle Soup, and MSNR detections. Actionable candidates must come from these strategy setups.',
        'FVG and OB are confluence/context unless a supplied deterministic strategy candidate uses them. Do not treat every FVG/OB as a standalone trade strategy.',
        'RAW CANDLES = secondary context for qualitative interpretation only.',
        'IMMEDIATE_ENTRY = Stage-2 reaction/fill confirmation and is separate from pending-limit validity.',
        'Zone/target origin hierarchy: STRUCTURAL and STRUCTURAL_MSNR = directly derived market structure. PIVOT_REFERENCE = classic pivot-derived reference only, not MSNR strategy evidence. ATR_FALLBACK = synthetic reference only. PIVOT_REFERENCE and ATR_FALLBACK must never create standalone MSNR trades.',
        'Stage 1 asks whether a valid future pending-limit setup exists. Current price not being inside the zone, immediate confirmation score of 0, or off-hours are not by themselves reasons for NO_TRADE.',
        'Stage 2 asks whether immediate entry/fill confirmation is ready now.',
        'Your role is to rank the supplied adaptive_setup_candidates, identify the highest-quality valid pending-limit opportunity currently available, or return WAIT/NO_TRADE when no valid candidate is worth selecting.',
        'Do not return WAIT merely because price has not reached a valid future limit zone. If a future pending-limit setup already satisfies setup-stage requirements, return BUY_LIMIT or SELL_LIMIT with ai_decision:"wait_for_reaction".',
        'Do not return skip when your own analysis concludes that a valid BUY_LIMIT or SELL_LIMIT setup already exists.',
        'If selecting a setup, include selected_candidate_id and use the candidate entry, stop_loss, TP1, TP2, TP3, RR, and zone bounds exactly.',
        'If adaptive_setup_candidates is empty, do not invent entry/SL/TP levels; return WAIT or NO_TRADE.',
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
Analyze the current live market.

This bot creates pending LIMIT orders at future ICT zones. A valid setup may exist even when current price is not inside the entry zone yet.

1. Decide BUY_LIMIT, SELL_LIMIT, WAIT, or NO_TRADE. If preserving direction compatibility, also set direction to BUY or SELL for limit setups.
2. Prefer selecting one supplied COMPUTED MARKET FACTS.adaptive_setup_candidates item by selected_candidate_id. These are VALID_CANDIDATES that already passed deterministic numerical hard rules.
3. Use market_context to understand bias and conditions, but only supplied strategy_setups/adaptive_setup_candidates can create trades.
4. Do not calculate or alter entry, stop_loss, take_profit_1, take_profit_2, take_profit_3, risk_reward, or zone bounds.
5. Respect current volatility, ATR, minimum SL distance, maximum SL distance, and minimum RR facts as already encoded in the candidates.
6. Respect real structure, liquidity, premium/discount, adaptive setup candidates, and target candidates.
7. Do not invent levels.
8. Do not return NO_TRADE only because current price is not at the zone, immediate confirmation score is 0, or no immediate trigger exists yet.
9. Return NO_TRADE only when no supplied valid candidate is acceptable after qualitative market review.
10. Use WAIT when a valid setup concept exists but deterministic facts show it is incomplete or should wait for better fill/confirmation conditions.
11. Today's best professional decision may still be WAIT or NO_TRADE.
12. Zone/target origin hierarchy: STRUCTURAL and STRUCTURAL_MSNR = direct market structure. PIVOT_REFERENCE = classic pivot-derived reference only, not MSNR strategy evidence. ATR_FALLBACK = synthetic reference only. PIVOT_REFERENCE and ATR_FALLBACK must never create standalone MSNR trades.
13. Do NOT return WAIT merely because price has not reached a valid future limit zone. If setup-stage requirements are satisfied, return BUY_LIMIT or SELL_LIMIT and use ai_decision:"wait_for_reaction" when immediate entry is not ready.
14. Do NOT return skip when your own analysis concludes that a valid BUY_LIMIT or SELL_LIMIT setup already exists.
15. If adaptive_setup_candidates contains valid choices, rank them and return the selected_candidate_id for the best one. Use that candidate's entry, stop_loss, take_profit_1, take_profit_2, and take_profit_3 exactly.
16. If adaptive_setup_candidates is empty, do not invent entry/SL/TP levels; return WAIT or NO_TRADE.
16a. If context is bullish/bearish but CRT, TBS, and MSNR provide no supplied strategy setup, return WAIT: market context alone is not a trade.
17. Discount generally favors BUY entries; premium generally favors SELL entries unless stronger supplied structure says otherwise.
18. Freshness labels mean FRESH=fresh, PARTIAL=partially used/partially mitigated, USED=used, INVALID=invalidated. Do not call a PARTIAL zone fresh.

Return ONLY JSON using the existing application schema plus selected_zone/decision:
{
  "decision": "BUY_LIMIT" | "SELL_LIMIT" | "WAIT" | "NO_TRADE",
  "selected_candidate_id": "string or null",
  "direction": "BUY" | "SELL",
  "order_type": "LIMIT",
  "setup_type": "PENDING_LIMIT",
  "selected_zone": { "type": "CRT" | "TBS" | "FVG" | "OB" | "MSNR", "timeframe": "4H" | "1H", "low": number, "high": number },
  "entry_zone": { "low": number, "high": number, "source": "CRT" | "TBS" | "FVG" | "OB" | "MSNR" },
  "entry": number,
  "stop_loss": number,
  "stop_loss_reason": "string",
  "take_profit_1": number,
  "take_profit_2": number or null,
  "take_profit_3": number or null,
  "risk_reward": "1:X.X",
  "confidence": number,
  "zone_quality": "A" | "B" | "C",
  "patterns": ["string"],
  "probability": "HIGH" | "MEDIUM" | "LOW",
  "market_regime": "string",
  "reasoning": {
    "primary": "string",
    "structure": "string",
    "liquidity": "string",
    "volatility": "string",
    "why_best": "string",
    "why_not_opposite": "string",
    "invalidation": "string",
    "secondary": ["string"]
  },
  "opposite_setup": { "direction": "string", "confidence": number, "why_rejected": "string" },
  "ai_decision": "enter_now" | "wait_for_reaction" | "skip",
  "wait_condition": "string or null"
}

If decision is WAIT or NO_TRADE, omit numeric trade levels and include confidence, reasoning.primary, reasoning.why_best, ai_decision:"skip", and wait_condition.`;

    return { system, user };
}

function buildCandleData(historyCache, count = 10) {
    const tfs = ['1D', '4H', '1H', '15M', '5M'];
    const realVolume = hasRealVolume(pair);
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

async function askAIToFindSetup(marketData, price, systemPrompt = null, liveMarketContext = null) {
    if (!DEEPSEEK_API_KEY) {
        console.error('No AI key available');
        lastAIRequestError = { code: 'NO_AI_KEY', message: 'No DeepSeek API key available' };
        return null;
    }
    const requestStartedAt = scanClock();
    lastAIRequestError = null;
    console.log('[SCAN] DeepSeek request start', {
        timeout_ms: AI_REQUEST_TIMEOUT_MS,
        prompt_characters: String(marketData || '').length,
        candidate_count: liveMarketContext?.adaptive_setup_candidates?.length || 0
    });
    try {
        const { response, data } = await requestAIJson(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { 
                        role: 'system', 
                        content: systemPrompt || 'You are an expert ICT trading analyst. Return ONLY valid JSON. Be precise with numbers. Never miss required fields.'
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
        console.log('[SCAN] DeepSeek response received', { elapsed_ms: Math.round((scanClock() - requestStartedAt) * 100) / 100 });
        console.log('[SCAN] DeepSeek parsed', { elapsed_ms: Math.round((scanClock() - requestStartedAt) * 100) / 100 });
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) {
            console.error('No content from AI');
            return null;
        }
        
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('No JSON found in AI response');
            return null;
        }
        
        const result = applyAdaptiveCandidateToAIResult(JSON.parse(jsonMatch[0]), liveMarketContext);
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
            result.wait_condition = result.wait_condition || 'Pending limit setup valid; immediate entry confirmation is not active.';
        }
        if ((rawDecision === 'BUY_LIMIT' || rawDecision === 'SELL_LIMIT') && result.ai_decision === 'skip') {
            result.ai_decision = 'wait_for_reaction';
            result.wait_condition = result.wait_condition || 'Pending limit setup valid; immediate entry confirmation is not active.';
        }
        
        const required = ['direction', 'entry', 'entry_zone', 'stop_loss', 'take_profit_1', 'confidence', 'reasoning'];
        for (const field of required) {
            if (!result[field]) {
                console.error(`Missing required field: ${field}`);
                return null;
            }
        }
        
        if (!result.entry_zone.low || !result.entry_zone.high) {
            result.entry_zone = {
                low: result.entry * 0.998,
                high: result.entry * 1.002,
                source: result.entry_zone?.source || 'AI Zone'
            };
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
        const rrMetrics = calculateRRMetrics(direction, entry, sl, tp1, minimumRR);
        if (!(rrMetrics.risk > 0)) issues.push('risk must be greater than zero');
        if (!(rrMetrics.reward > 0)) issues.push('reward must be greater than zero');
        if (!Number.isFinite(rrMetrics.actualRR)) {
            issues.push('actual RR must be finite');
        } else if (rrMetrics.actualRR + 1e-9 < minimumRR) {
            issues.push(`actual RR ${rrMetrics.actualRR.toFixed(2)} below minimum ${minimumRR.toFixed(2)}`);
        }
        const tp1Candidate = findTp1TargetCandidate(aiResult, liveMarketContext, rrMetrics);
        if (tp1Candidate.checked && !tp1Candidate.hasValidCandidate) {
            issues.push('no supplied target candidate satisfies minimum RR');
        } else if (tp1Candidate.checked && !tp1Candidate.matched) {
            issues.push('take_profit_1 must match a supplied target candidate that satisfies minimum RR');
        }
    }

    if (issues.length === 0 && (liveMarketContext?.adaptive_setup_candidates || []).length > 0 && !aiResult.selected_candidate_id) {
        issues.push('actionable AI setup must select a deterministic candidate ID');
    }
    let selectedDeterministicCandidate = null;
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
                issues.push(`AI numeric levels do not match selected adaptive setup candidate: ${numericMatches.map(([name]) => name).join(', ')}`);
            }
        }
    }

    if (selectedDeterministicCandidate && (!Array.isArray(liveMarketContext?.real_ict_zones) || liveMarketContext.real_ict_zones.length === 0)) {
        return { valid: issues.length === 0, issues };
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

    return { valid: issues.length === 0, issues };
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

async function runFallbackScan(price, historyCache) {
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
    const fallbackRiskConstraints = buildRiskConstraints(pair, price, historyCache);
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
                confidence: Math.max(58, Math.min(90, Math.round(bestCandidate.score || 70))),
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
            selected_candidate_id: bestCandidate?.id || null,
            order_type: 'LIMIT',
            setup_type: 'PENDING_LIMIT',
            entry_price: best.entry,
            entry_zone: { low: best.zone.low, high: best.zone.high, source: best.zoneType },
            stop_loss: best.sl,
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
            source: 'Rule-Based (Fallback)',
            validation: { passed: true, evaluator: bestEvaluation }
        }
    };
    if (bestCandidate) {
        out.trade_signal.strategy_evidence = bestCandidate.strategy_evidence || bestCandidate.strategy_setup?.strategy_evidence || null;
        out.trade_signal.entry_model = bestCandidate.entry_model || null;
        out.trade_signal.setup_timeframe = bestCandidate.setup_timeframe || bestCandidate.timeframe || best.timeframe;
        out.trade_signal.execution_timeframe = bestCandidate.execution_timeframe || bestCandidate.timeframe || best.timeframe;
        out.trade_signal.target_map = bestCandidate.target_map || [];
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
function validateAISetup(aiResult, price, historyCache, pairArg, deterministicValidationContext = null) {
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

async function runAutoScan() {
    if (scanInProgress) {
        console.warn('[SCAN] IGNORE overlapping Analyze request');
        return;
    }
    scanInProgress = true;
    const scanStartedAt = scanClock();
    let scanStage = 'initializing';
    let price = null;
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
        if (!TWELVE_DATA_KEY) {
            scanStage = 'missing Twelve Data key';
            showSetup();
            return;
        }

        showNotif('🤖 AI analyzing market data...', 'info');
        scanStage = 'price request';
        price = await getPrice();
        if(!price) throw new Error('No price');
        
        const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
        scanText.innerHTML = '📊 Collecting market data...';
        scanStage = 'history requests';
        await Promise.all(tfs.map(async (t) => {
            historyCache[t] = await getHistory(t);
        }));
        scanTrace('history loaded', scanStartedAt, { timeframes: Object.fromEntries(tfs.map(tf => [tf, historyCache[tf]?.length || 0])) });
        scanStage = 'MTF display';
        await updateMTFDisplay(historyCache);
        
        // ============================================
        // ENHANCED AI INTELLIGENCE - Compute on 4H
        // ============================================
        let enhancedAnalysis = null;
        if (historyCache['4H'] && historyCache['4H'].length >= 50) {
            const phase = analyzeMarketPhase(historyCache['4H'], hasRealVolume(pair));
            const rsiDiv = detectDivergence(historyCache['4H'], 'rsi', 30);
            const macdDiv = detectDivergence(historyCache['4H'], 'macd', 30);
            const liq = mapLiquidity(historyCache['4H']);
            const volProf = analyzeVolumeProfile(historyCache['4H']);
            const sentiment = analyzeSentiment(historyCache['4H'], hasRealVolume(pair));
            const sentiment1h = historyCache['1H'] && historyCache['1H'].length >= 50
                ? analyzeSentiment(historyCache['1H'], hasRealVolume(pair)) : { sentiment: 'N/A', score: 50, description: 'N/A' };
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
        const sessionCheck = shouldTradeSession();
        const phaseData = historyCache['1H'] && historyCache['1H'].length >= 30 ? historyCache['1H'] : (historyCache['4H'] || []);
        const marketPhase = analyzeMarketPhase(phaseData, hasRealVolume(pair));
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
                    trend: detectTrend(data),
                    adx: calculateADX(data, 14, tf)
                };
            }
        }
        
        const session = getSession();
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
            entryContext
        });
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

        if (liveMarketContext.adaptive_setup_candidates.length === 0) {
            const audit = liveMarketContext.setup_candidate_audit || {};
            const hasRaw = (audit.raw_candidate_count || 0) > 0;
            const hasStrategySetups = (liveMarketContext.strategy_setups || []).length > 0;
            const decision = 'WAIT';
            const reason = !hasStrategySetups
                ? 'Market context available, but no valid CRT/TBS/MSNR strategy setup is currently available.'
                : (hasRaw ? 'No strategy setup execution combination passed all hard rules' : 'Strategy setup exists, but no valid execution candidate is available.');
            const waitCode = waitCodeFromRejections(audit, hasStrategySetups);
            const out = {
                trade_signal: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair,
                    current_price: price,
                    trade_type: decision,
                    decision,
                    confidence: 0,
                    reasoning: { primary: reason, code: waitCode, rejection_summary: audit.rejection_summary || {}, rejection_detail: audit.rejection_detail || {} },
                    ai_decision: 'skip',
                    wait_condition: reason,
                    source: 'Deterministic Candidate Engine',
                    strategy_detections: liveMarketContext.strategy_detections,
                    candidate_pipeline: liveMarketContext.candidate_pipeline,
                    validation: { passed: false, reason, candidate_audit: audit }
                }
            };
            setJsonOutput(out);
            lastSetupSummary = null;
            lastSetupOut = out;
            analysis = { signalType: 'NEUTRAL', currentPrice: price, confidence: 0, entryReady: false, executionDecision: 'skip', aiDecision: null };
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 ${decision}: ${reason}`, 'warning');
            scanTrace('no valid deterministic candidate', scanStartedAt, { wait_code: waitCode, candidate_pipeline: liveMarketContext.candidate_pipeline });
            return;
        }

        scanStage = 'prompt construction';
        const candleData = buildCandleData(historyCache, 10);
        const aiPrompt = buildAIPrompt(liveMarketContext, candleData);
        scanText.innerHTML = '🤖 AI analyzing live market context...';
        scanStage = 'DeepSeek request';
        const aiResult = await askAIToFindSetup(aiPrompt.user, price, aiPrompt.system, liveMarketContext);
        if (aiResult) {
            try {
                const perf = getPatternPerformance(aiResult.patterns || []);
                if (perf.sampleSize >= 5 && Math.abs(perf.confidenceAdjustment) >= 1) {
                    const adjusted = Math.max(0, Math.min(100, Math.round(aiResult.confidence + perf.confidenceAdjustment)));
                    aiResult.confidence = adjusted;
                    aiResult.patternPerformance = { winRate: perf.winRate, sampleSize: perf.sampleSize, adjustment: perf.confidenceAdjustment };
                }
            } catch(e) {}
        }

        if (!aiResult) {
            scanStage = lastAIRequestError?.code === 'AI_TIMEOUT' ? 'DeepSeek timeout fallback' : 'DeepSeek failure fallback';
            showNotif(`⚠️ ${lastAIRequestError?.message || 'AI analysis failed'} - using fallback`, 'warning');
            try {
                await runFallbackScan(price, historyCache);
            } catch (fallbackError) {
                console.error('[SCAN] FAILED', { stage: 'fallback', error: fallbackError?.message, stack: fallbackError?.stack });
                showNotif(`Fallback failed: ${fallbackError?.message || 'unknown error'}`, 'error');
            }
            return;
        }

        scanTrace('AI consistency complete', scanStartedAt, { decision: aiResult.decision, selected_candidate_id: aiResult.selected_candidate_id || null });

        if (aiResult.noTrade) {
            const out = {
                trade_signal: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair: pair,
                    current_price: price,
                    trade_type: aiResult.decision,
                    confidence: aiResult.confidence,
                    reasoning: aiResult.reasoning,
                    ai_decision: 'skip',
                    wait_condition: aiResult.wait_condition,
                    source: 'AI-Generated Setup',
                    strategy_detections: liveMarketContext.strategy_detections,
                    candidate_pipeline: liveMarketContext.candidate_pipeline,
                    validation: { passed: false, reason: aiResult.wait_condition || 'AI returned no trade' }
                }
            };
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
        if (!outputConsistency.valid) {
            const reason = `AI output inconsistent: ${outputConsistency.issues.join('; ')}`;
            console.log('❌ AI OUTPUT CONSISTENCY REJECTED', outputConsistency);
            const out = {
                trade_signal: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair: pair,
                    current_price: price,
                    trade_type: 'WAIT',
                    confidence: 0,
                    reasoning: { primary: reason },
                    ai_decision: 'skip',
                    wait_condition: reason,
                    source: 'AI-Generated Setup',
                    strategy_detections: liveMarketContext.strategy_detections,
                    candidate_pipeline: liveMarketContext.candidate_pipeline,
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
                trade_type: aiResult.decision || (aiResult.direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT'),
                decision: aiResult.decision,
                order_type: aiResult.order_type || 'LIMIT',
                setup_type: aiResult.setup_type || 'PENDING_LIMIT',
                entry_price: aiResult.entry,
                entry_zone: aiResult.entry_zone,
                stop_loss: aiResult.stop_loss,
                stop_loss_reason: aiResult.stop_loss_reason,
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
                target_map: aiResult.target_map,
                strategy_detections: liveMarketContext.strategy_detections,
                candidate_pipeline: liveMarketContext.candidate_pipeline,
                ai_decision: aiResult.ai_decision,
                wait_condition: aiResult.wait_condition,
                source: 'AI-Generated Setup'
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
        syncSetupToGitHub(out.trade_signal, 'ai_scan');

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
        out.trade_signal.ai_decision = effectiveDecision;
        out.trade_signal.wait_condition = effectiveDecision === 'wait_for_reaction'
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
        setJsonOutput(out);
        
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
            entryReady: selectedEntryContext.allOk && effectiveDecision === 'enter_now',
            executionDecision: effectiveDecision,
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
        
        document.getElementById('executeBtn').disabled = !tradeable;
        
        // Update button to show AI source
        const btnExecute = document.getElementById('executeBtn');
        if (btnExecute && analysis) {
            btnExecute.innerHTML = `🤖 AI Setup: ${st}`;
            btnExecute.style.background = 'linear-gradient(135deg, #5856d6, #007aff)';
        }
        
        const decisionEmoji = effectiveDecision === 'enter_now' ? '✅' : (effectiveDecision === 'wait_for_reaction' ? '⏳' : '🚫');
        const validationTag = validation.valid ? '✓' : '✗';
        showNotif(`🤖 AI Setup [val:${validationTag}] ${st} ${decisionEmoji} | Conf: ${aiResult.confidence}% | ${aiResult.entry_zone.source} | ${aiResult.patterns.join(', ')}`, tradeable ? 'success' : 'warning');
        scanTrace('final result rendered', scanStartedAt, { result: tradeable ? aiResult.decision : 'WAIT/VALIDATION_BLOCKED', validation: validation.valid });
        
    } catch(e) {
        console.error('[SCAN] FAILED', { stage: scanStage, error: e?.message, stack: e?.stack });
        showNotif('Error: ' + (e?.message || 'scan failed'), 'error');
        if (price && Object.keys(historyCache).length > 0) {
            try {
                scanStage = 'fallback after scan failure';
                await runFallbackScan(price, historyCache);
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

    const allOk = sessionCheck.priority !== 'LOW' && phaseDecision.shouldEnter && entryConfirmation.confirmed;
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
    const phaseDecision = shouldEnterBasedOnPhase(marketPhase, direction || 'BUY', price, phaseData);
    return buildEntryContext(sessionCheck, marketPhase, phaseDecision, entryConfirmation);
}

// ============================================
// JSON OUTPUT
// ============================================

function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    if(el) el.textContent = JSON.stringify(obj, null, 2);
}

// ============================================
// RECENT SAVED + TRADE JOURNAL
// ============================================

let lastSetupSummary = null;
let lastSetupOut = null;

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

function loadLimitOrder() {
    const s = localStorage.getItem('limitOrder');
    if(s) {
        try {
            limitOrder = JSON.parse(s);
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

function cancelLimit() {
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
        document.getElementById('executeBtn').innerHTML = '⏳ Waiting...';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
    } else {
        t.innerHTML = 'No active order';
        t.className = '';
        c.classList.add('hidden');
        document.getElementById('executeBtn').innerHTML = '⚡ Place Order';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #34c759, #28a745)';
    }
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
        
        const orderAge = (Date.now() - new Date(limitOrder.createdAt).getTime()) / (1000 * 60 * 60);
        if(orderAge >= LIMIT_ORDER_EXPIRY_HOURS) {
            clearLimit();
            showNotif(`⏰ Order EXPIRED after ${LIMIT_ORDER_EXPIRY_HOURS}h — zone became stale`, 'warning');
            return;
        }
        
        const distToEntry = limitOrder.signalType === 'LONG' 
            ? ((p - limitOrder.idealEntry) / p * 100)
            : ((limitOrder.idealEntry - p) / p * 100);
        
        if(distToEntry <= ZONE_PROXIMITY_ALERT_PCT && distToEntry > 0) {
            showNotif(`🎯 PRICE APPROACHING ZONE! ${limitOrder.pair||''} ${limitOrder.signalType} — ${distToEntry.toFixed(2)}% away`, 'info');
        }
        
        if((limitOrder.signalType === 'LONG' && p <= limitOrder.idealEntry) ||
           (limitOrder.signalType === 'SHORT' && p >= limitOrder.idealEntry)) {
            const filled = limitOrder;
            clearLimit();
            showNotif(`✅ FILLED! ${filled.pair||''} ${filled.signalType} @ $${p.toFixed(settings.prec)}`, 'success');
            // AUTO OUTCOME DETECTION: enqueue the fill so the next monitor
            // tick can poll 5M candles to see if SL or TP1 was hit.
            enqueuePendingFill(filled, p);
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
    if(limitOrder) {
        cancelLimit();
        return;
    }
    const o = {
        id: Date.now(),
        pair: pair,
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
        source: analysis.aiDecision ? 'AI-Generated' : 'Rule-Based'
    };
    saveLimit(o);
    startMonitor();
    const aiLabel = o.aiDecision ? '🤖 AI Setup' : '📊 Rule-Based';
    const prec = getPrec(pair);
    showNotif(`📝 ${aiLabel}: ${o.signalType} @ $${o.idealEntry.toFixed(prec)} | ${o.confirmation} | RR: 1:${o.rrUsed}`, 'info');
}

function copyJson() {
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

function parseCandleTimeUTC(t) {
    if(typeof t !== 'string') return NaN;
    const iso = t.includes('T') ? t : t.replace(' ', 'T');
    return new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
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
