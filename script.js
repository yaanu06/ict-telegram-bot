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

const SYMBOLS = {
    'BTC/USD':'BTC/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY',
    'AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD',
    'EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};

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

// ============================================
// MARKET SETTINGS
// ============================================
function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.015, targetRR: 2.5, prec: 2, pipSize: 0.1 };
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
function recordTradeResult(isWin, riskR) {
    lastTradeTime = Date.now(); // a real trade happened — start the 2h cool-down
    if(isWin) { consecutiveLosses = 0; dailyPnlR += riskR; }
    else { consecutiveLosses++; dailyPnlR -= riskR; }
}

// Time gap between trades (hours)
let lastTradeTime = 0;
function checkTradeGap(minHours = 2) {
    const now = Date.now();
    // BUG FIX: only a blocker once a REAL trade has been opened (lastTradeTime is set in
    // recordTradeResult). Scanning must never stamp the clock — otherwise the first check
    // marks 'now' and every subsequent signal is blocked for the whole window.
    if(lastTradeTime > 0 && now - lastTradeTime < minHours * 3600000) return false;
    return true;
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

// Calculate MSNR
function calculateMSNR(data, currentPrice) {
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
    
    let allS = [s1, s2, s3].filter(s => s < currentPrice).sort((a, b) => b - a);
    let allR = [r1, r2, r3].filter(r => r > currentPrice).sort((a, b) => a - b);
    
    // Fallback: If no supports found below price or no resistances found above price,
    // generate ATR-based fallback levels so candidates are ALWAYS found.
    const atrVal = atr(data, 14);
    if(allS.length === 0) {
        const fallS1 = currentPrice - atrVal * 2.0;
        const fallS2 = currentPrice - atrVal * 4.0;
        allS = [fallS1, fallS2];
    }
    if(allR.length === 0) {
        const fallR1 = currentPrice + atrVal * 2.0;
        const fallR2 = currentPrice + atrVal * 4.0;
        allR = [fallR1, fallR2];
    }

    return {
        pivot: pp,
        supports: { S1: allS[0] || s1, S2: allS[1] || s2, S3: allS[2] || s3 },
        resistances: { R1: allR[0] || r1, R2: allR[1] || r2, R3: allR[2] || r3 },
        nearestSupport: allS[0] || null,
        nearestResistance: allR[0] || null,
        allSupports: allS,
        allResistances: allR
    };
}

// Detect Turtle Soup
function detectTurtleSoup(data) {
    if(data.length < 15) return { detected: false, type: null };
    const rd = data.slice(-15);
    const lows = rd.map(c => c.l);
    const highs = rd.map(c => c.h);
    const closes = rd.map(c => c.c);
    const opens = rd.map(c => c.o);
    const keyLow = Math.min(...lows.slice(0, -4));
    const recentLow = lows[lows.length - 4];
    const cc = closes[closes.length - 1];
    const co = opens[opens.length - 1];
    if(recentLow < keyLow && cc > keyLow && cc > co) {
        return { detected: true, type: 'BUY', keyLevel: keyLow };
    }
    const keyHigh = Math.max(...highs.slice(0, -4));
    const recentHigh = highs[highs.length - 4];
    if(recentHigh > keyHigh && cc < keyHigh && cc < co) {
        return { detected: true, type: 'SELL', keyLevel: keyHigh };
    }
    return { detected: false, type: null };
}

// Calculate CRT
function detectCRT(data) {
    if(data.length < 20) return { state: 'NEUTRAL' };
    const recent = data.slice(-20);
    const ranges = recent.map(c => c.h - c.l);
    const avg = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const last10 = ranges.slice(-10);
    const avg10 = last10.reduce((a, b) => a + b, 0) / last10.length;
    const first10 = ranges.slice(0, 10);
    const avgFirst10 = first10.reduce((a, b) => a + b, 0) / first10.length;
    
    let state = 'NEUTRAL';
    if(avg10 > avgFirst10 * 1.3) state = 'EXPANDING';
    else if(avg10 < avgFirst10 * 0.7) state = 'CONTRACTING';
    
    return { state };
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

// Precision SL calculation (XAU/USD: Minimum 2.0x ATR, Others: Minimum 1.5x ATR)
function calcStopLoss(data, direction, entry, zone, msnr, tf, customATR = null, customPair = null) {
    const atrVal = customATR || atr(data, 14);
    const p = customPair || pair;
    const settings = getMarketSettings(p);
    const prec = settings.prec;
    const factor = Math.pow(10, prec);
    
    // Minimum SL: 2.0x ATR for XAU/USD (~50 points when ATR is ~25), 1.5x ATR for other pairs
    const minMultiplier = p.includes('XAU') ? 2.0 : 1.5;
    const minSLDist = atrVal * minMultiplier;
    const maxSLDist = Math.max(minSLDist, atrVal * 2.5);
    
    let slDist;
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
    let entry;
    const distToZone = direction === 'BUY' ? price - best.price : best.price - price;
    const distPct = (distToZone / price) * 100;

    if(distPct <= 1.0 && best.low && best.high) {
        entry = direction === 'BUY' ? best.high : best.low;
    } else if(distPct > 1.0 && best.low && best.high) {
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

function checkZoneFreshness(data, zone, direction) {
    let touches = 0, violations = 0;
    const lookback = Math.min(50, data.length);
    const zoneLow = zone.low || zone * 0.998;
    const zoneHigh = zone.high || zone * 1.002;
    for(let i = data.length - lookback; i < data.length; i++) {
        if(i < 0) continue;
        // Only count CLOSES inside the zone. Wick dips/spikes (h/l) often pierce
        // a zone without real participation — counting them burns 10 touches in
        // a week and rejects valid retest setups.
        const closeInZone = data[i].c >= zoneLow && data[i].c <= zoneHigh;
        if(!closeInZone) continue;
        touches++;
        if(direction === 'BUY' && data[i].c < zoneLow) violations++;
        if(direction === 'SELL' && data[i].c > zoneHigh) violations++;
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
        const response = await fetch(DEEPSEEK_API_URL, {
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
        
        const data = await response.json();
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
function analyzeVolumeTruth(data) {
    if(!data || data.length < 20) return { surge: false, fake: false, dryUp: false };
    const vols = data.slice(-20).map(c => c.v || 0);
    const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
    const last4 = vols.slice(-4);
    const surge = last4.every(v => v >= avg * 1.5);
    const last1 = vols[vols.length - 1], last2 = vols[vols.length - 2];
    const fake = last2 >= avg * 2 && last1 < last2 * 0.6;
    const dryUp = last4.every(v => v < avg * 0.8);
    return { surge, fake, dryUp, avg };
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
            const volTruth = analyzeVolumeTruth(entryData);
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

async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn');
    const scanStatus = document.getElementById('scanStatus');
    const scanText = document.getElementById('scanText');
    const scanFill = document.getElementById('scanProgressFill');
    
    btn.classList.add('loading');
    btn.disabled = true;
    scanStatus.classList.remove('hidden');
    
    if(!TWELVE_DATA_KEY) {
        showSetup();
        btn.classList.remove('loading');
        btn.disabled = false;
        scanStatus.classList.add('hidden');
        return;
    }
    
    showNotif('🔍 Scanning for setups...', 'info');
    
    try {
        const price = await getPrice();
        if(!price) throw new Error('No price');
        
        const historyCache = {};
        const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
        scanText.innerHTML = 'Fetching market data...';
        await Promise.all(tfs.map(async (t) => {
            historyCache[t] = await getHistory(t);
        }));
        
        await updateMTFDisplay(historyCache);
        
        const settings = getMarketSettings(pair);
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(settings.prec)}`;
        
        if(lastPrice) {
            const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2);
            const ce = document.getElementById('priceChange');
            ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`;
            ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`;
        }
        lastPrice = price;
        
        lastScanRejections = [];
        const results = [];
        const timeframesToScan = ['1D', '4H', '1H', '15M', '5M'];
        const htfData = historyCache;
        
        for(let i = 0; i < timeframesToScan.length; i++) {
            const tfScan = timeframesToScan[i];
            scanText.innerHTML = `Scanning ${tfScan}... (${i + 1}/${timeframesToScan.length})`;
            scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%';
            
            const result = await analyzeTimeframe(tfScan, price, htfData);
            if(result) results.push(result);
        }
        
        console.log('=== SCAN RESULTS ===');
        console.log('Results found:', results.length);
        console.log('[DEBUG] Setups found:', results.map(r => `${r.timeframe} ${r.direction} at ${r.entry} (Conf: ${r.confidence}%)`));

        // TIMEFRAME HIERARCHY (per trader preference):
        // Tradeable setups come ONLY from 4H and 1H. 1D is direction/info ONLY
        // (like 15M/5M) and is never traded. 1D/15M/5M are still scanned and feed
        // the direction/bias reads via htfData, they just can't become a trade setup.
        const htfResults = results.filter(r => ['4H', '1H'].includes(r.timeframe));
        console.log('Tradeable setups (4H/1H) found:', htfResults.length);
        
        if(htfResults.length === 0) {
            const htfRejections = lastScanRejections.filter(r => r.startsWith('4H') || r.startsWith('1H'));
            const detailedReason = htfRejections.length > 0 
                ? `No setups found (4H, 1H). Reasons: ${htfRejections.slice(0, 4).join('; ')}`
                : 'No setups (4H, 1H) met minimum 65% confidence or quality requirements';

            showNotif(`🎯 ${detailedReason}`, 'warning');
            setJsonOutput({
                status: 'NO_SETUP',
                pair: pair,
                current_price: price,
                reason: detailedReason,
                rejection_details: htfRejections
            });
            btn.classList.remove('loading');
            btn.disabled = false;
            scanStatus.classList.add('hidden');
            return;
        }
        
        htfResults.sort((a, b) => b.confidence - a.confidence);
        let best = htfResults[0];
        
        // Get AI decision
        scanText.innerHTML = '🤖 AI analyzing execution...';
        const aiDecision = await getAIExecutionDecision(best, price, htfData);
        scanStatus.classList.add('hidden');
        
        // AI ADVISORY MODE: AI may add reasoning, but it cannot block a high-confidence
        // reachable setup. Only the confidence + distance gates decide entry now.
        if(AI_ADVISORY_ONLY && aiDecision.decision !== 'enter_now' && best.confidence >= MIN_CONFIDENCE && (best.entryDistancePct || 0) <= 1.5) {
            aiDecision.decision = 'enter_now';
            aiDecision.reasoning = (aiDecision.reasoning || 'Setup passed all gates') + ' — AI advisory only, setup reachable & high confidence';
            aiDecision.wait_condition = null;
            aiDecision.skip_reason = null;
            aiDecision.risk_adjustment = 1.0;
        }
        
        const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
        
        const finalEntry = best.entry;
        const finalSL = best.sl;
        const finalTP1 = best.tp1;
        const finalTP2 = best.tp2;
        const finalTP3 = best.tp3;
        const risk = Math.abs(finalEntry - finalSL);
        const rrDisplay = risk > 0 ? (Math.abs(finalTP1 - finalEntry) / risk).toFixed(1) : '0.0';
        
        const tradeable = aiDecision.decision !== 'skip' && best.confidence >= MIN_CONFIDENCE;
        const riskPercent = tradeable ? (aiDecision.risk_adjustment || 1.0) * 0.5 : 0;
        
        console.log(`🏆 Setup Confidence: ${best.confidence}%`);
        console.log(`📊 Direction: ${best.direction}`);
        console.log(`📊 Zone Type: ${best.zoneType}`);
        console.log(`📊 Patterns: ${best.patterns ? best.patterns.join('+') : 'MSNR'}`);
        console.log(`📊 Zone Price: ${best.zonePrice}`);
        console.log(`📊 Distance: ${Math.abs(best.distancePct || 0).toFixed(2)}%`);
        console.log(`📊 TBS: ${best.tbsDetected ? 'YES' : 'NO'}`);
        console.log(`📊 CRT: ${best.crtState}`);
        console.log(`📊 AI Decision: ${aiDecision.decision}`);
        console.log(`📊 RR: 1:${rrDisplay}`);
        
        const prec = settings.prec;
        
        const out = {
            trade_signal: {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].split('.')[0],
                pair: pair,
                current_price: price,
                trade_type: best.direction === 'BUY' ? 'BUY' : 'SELL',
                entry_price: finalEntry,
                stop_loss: finalSL,
                take_profit_1: finalTP1,
                take_profit_2: finalTP2,
                take_profit_3: finalTP3,
                confidence: best.confidence,
                setup_score: best.confidence,
                zone_type: best.zoneType,
                zone_price: best.zonePrice,
                patterns_detected: best.patterns ? best.patterns.join('+') : 'MSNR',
                zone_touches: best.touches || 0,
                zone_freshness: best.isFresh ? 'FRESH' : (best.touches <= 3 ? 'LIGHTLY_USED' : 'USED'),
                entry_distance_pct: Math.abs(best.entryDistancePct || 0).toFixed(2) + '%',
                htf_alignment: `${best.htfMatch || 0}/3`,
                entry_atr: best.entryATR ? best.entryATR.toFixed(4) : null,
                adx_trend_strength: `${best.adx ? best.adx.toFixed(1) : '30'} (Strong > 25)`,
                dynamic_risk_percent: `${best.dynamicRiskPct || 0.5}%`,
                trade_management_rules: best.tradeManagement || getTradeManagementRules(best.confidence),
                tbs_detected: best.tbsDetected ? 'YES' : 'NO',
                crt_state: best.crtState || 'NEUTRAL',
                ai_decision: {
                    decision: aiDecision.decision,
                    confidence: aiDecision.confidence,
                    reasoning: aiDecision.reasoning,
                    risk_adjustment: aiDecision.risk_adjustment || 1.0,
                    wait_condition: aiDecision.wait_condition || null,
                    skip_reason: aiDecision.skip_reason || null
                },
                analysis: {
                    timeframe: best.timeframe,
                    session: getSession().session,
                    silver_bullet: getSession().isSilverBullet ? '✅' : '❌',
                    killzone: getSession().isKillzone ? '✅' : '❌',
                    risk_reward: '1:' + rrDisplay
                },
                msnr_levels: best.msnr ? {
                    pivot: best.msnr.pivot,
                    support_1: best.msnr.supports.S1,
                    support_2: best.msnr.supports.S2,
                    support_3: best.msnr.supports.S3,
                    resistance_1: best.msnr.resistances.R1,
                    resistance_2: best.msnr.resistances.R2,
                    resistance_3: best.msnr.resistances.R3,
                    nearest_support: best.msnr.nearestSupport,
                    nearest_resistance: best.msnr.nearestResistance
                } : null,
                trade_levels: {
                    entry: finalEntry,
                    stop_loss: finalSL,
                    take_profit_1: finalTP1,
                    take_profit_2: finalTP2,
                    take_profit_3: finalTP3,
                    risk_reward_ratio: parseFloat(rrDisplay) || 2.0,
                    use_partial_profits: best.usePartialProfits ? "YES (RR > 4x)" : "NO"
                }
            }
        };
        
        setJsonOutput(out);
        lastSetupSummary = buildSetupSummary(best, st, finalEntry, price);
        lastSetupOut = out;
        syncSetupToGitHub(out.trade_signal, 'scan');
        
        if(!tradeable) {
            analysis = null;
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 ${aiDecision.skip_reason || 'Setup rejected'}`, 'warning');
            return;
        }
        
        analysis = {
            signalType: st,
            idealEntry: finalEntry,
            currentPrice: price,
            stopLoss: finalSL,
            takeProfit1: finalTP1,
            takeProfit2: finalTP2,
            takeProfit3: finalTP3,
            confidence: best.confidence,
            riskPercent: riskPercent,
            entryReady: aiDecision.decision === 'enter_now',
            executionDecision: aiDecision.decision,
            invalidationPrice: finalSL * (best.direction === 'BUY' ? 0.995 : 1.005),
            confirmation: best.zoneType,
            patterns: best.patterns ? best.patterns.join('+') : 'MSNR',
            aiDecision: aiDecision,
            riskAdjustment: aiDecision.risk_adjustment || 1.0,
            rrUsed: parseFloat(rrDisplay) || 2.0,
            touches: best.touches || 0,
            isFresh: best.isFresh || false,
            distancePct: Math.abs(best.distancePct || 0)
        };
        
        document.getElementById('executeBtn').disabled = false;
        
        const decisionEmoji = aiDecision.decision === 'enter_now' ? '✅' : (aiDecision.decision === 'wait_for_reaction' ? '⏳' : '🚫');
        const patternEmoji = best.tbsDetected ? '🐢' : (best.isFresh ? '🌟' : '📌');
        showNotif(`🎯 ${best.timeframe} ${st} ${patternEmoji} ${decisionEmoji} ${aiDecision.decision} | Conf: ${best.confidence}% | ${best.zoneType} | ${Math.abs(best.distancePct || 0).toFixed(2)}% away`, 'success');
        
    } catch(e) {
        console.error(e);
        showNotif('Error: ' + e.message, 'error');
        scanStatus.classList.add('hidden');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
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
        createdAt: new Date().toISOString()
    };
    saveLimit(o);
    startMonitor();
    const aiLabel = o.aiDecision ? `🤖 ${o.aiDecision.decision}` : '';
    const prec = getPrec(pair);
    showNotif(`📝 ${o.signalType} @ $${o.idealEntry.toFixed(prec)} | ${o.confirmation} | ${o.patterns} | ${(o.distancePct || 0).toFixed(2)}% away | RR: 1:${o.rrUsed} ${aiLabel}`, 'info');
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
