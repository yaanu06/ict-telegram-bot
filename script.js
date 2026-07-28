// ============================================
// ICT TRADING BOT PRO - COMPLETE FINAL FIX
// VERSION 8.0 - INCREASED PROXIMITY
// ============================================

// Initialize
const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// ============================================
// CONFIG
// ============================================
let TWELVE_DATA_KEY = '', DEEPSEEK_API_KEY = '';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
let DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

const SYMBOLS = {
    'BTC/USD':'BTC/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY',
    'AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD',
    'EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};

const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day','1W':'1week' };
const ALL_TIMEFRAMES = ['5M', '15M', '1H', '4H', '1D'];
const DEFAULT_ATR_PERIOD = 14;
const BUY_INVALIDATION_FACTOR = 0.998;
const SELL_INVALIDATION_FACTOR = 1.002;

// FIX: Increased proximity to 3%
const MIN_CONFIDENCE = 50;
const MAX_ENTRY_DISTANCE_PCT = 3.0;
const MAX_ZONE_TOUCHES = 100;

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
// API KEYS MANAGEMENT
// ============================================
async function loadKeys() {
    const s = localStorage.getItem('ict_bot_keys');
    if (s) { 
        try { 
            const k = JSON.parse(s); 
            TWELVE_DATA_KEY = k.twelveData||''; 
            DEEPSEEK_API_KEY = k.deepseek||''; 
            DEEPSEEK_API_URL = k.deepseekUrl || 'https://api.deepseek.com/chat/completions'; 
            return true; 
        } catch(e) {} 
    }
    return false;
}
async function saveKeys(tk, dk, du) { 
    localStorage.setItem('ict_bot_keys', JSON.stringify({twelveData:tk, deepseek:dk, deepseekUrl:du})); 
    TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; 
    DEEPSEEK_API_URL = du || 'https://api.deepseek.com/chat/completions'; 
    updateKeyStatus(); 
}
function clearKeys() { 
    localStorage.removeItem('ict_bot_keys'); 
    TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; 
    DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'; 
    updateKeyStatus(); 
    showNotif('🗑️ Keys removed','warning'); 
}
function updateKeyStatus() {
    const ts = document.getElementById('twelveStatus');
    const ds = document.getElementById('deepseekStatus');
    if(ts) { 
        ts.innerHTML = TWELVE_DATA_KEY ? '✅ Active' : '❌ Missing'; 
        ts.className = 'status-badge ' + (TWELVE_DATA_KEY ? 'active' : 'inactive'); 
    }
    if(ds) { 
        ds.innerHTML = DEEPSEEK_API_KEY ? '✅ Active' : '❌ Missing'; 
        ds.className = 'status-badge ' + (DEEPSEEK_API_KEY ? 'active' : 'inactive'); 
    }
}

function showSetup() {
    const ex = document.getElementById('setupOverlay'); 
    if(ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API Key Setup</h3>
                <p class="setup-desc">Enter your API keys</p>
                <label>📡 Twelve Data Key:</label>
                <input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}">
                <label>🤖 DeepSeek Key:</label>
                <input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}">
                <label>🌐 Custom AI URL:</label>
                <input type="text" id="urlInput" class="setup-input" value="${DEEPSEEK_API_URL}">
                <p class="setup-note">Get key from platform.deepseek.com</p>
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
        if(!tk) { showNotif('⚠️ Twelve Data key required','warning'); return; }
        await saveKeys(tk, dk, du);
        document.getElementById('setupOverlay').remove();
    });
    document.getElementById('clBtn').addEventListener('click', () => {
        clearKeys();
        document.getElementById('twInput').value = '';
        document.getElementById('dsInput').value = '';
        document.getElementById('urlInput').value = '';
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
const PRICE_CACHE_DURATION = 5000;

function resetPairState() {
    cachedPrice = null;
    priceCacheTime = 0;
    cachedPricePair = null;
    lastPrice = null;
    analysis = null;
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
async function fetchTD(pathAndQuery, timeoutMs = 10000) {
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

async function getTechnicalIndicators(tfUsed) {
    if(!TWELVE_DATA_KEY) return {};
    const symbol = encodeURIComponent(SYMBOLS[pair]);
    const interval = TF_MAP[tfUsed];
    const ind = {};
    const endpoints = [
        {name: 'rsi', url: `/rsi?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'macd', url: `/macd?symbol=${symbol}&interval=${interval}`},
        {name: 'adx', url: `/adx?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'bbands', url: `/bbands?symbol=${symbol}&interval=${interval}&time_period=20`},
        {name: 'stoch', url: `/stoch?symbol=${symbol}&interval=${interval}`},
        {name: 'cci', url: `/cci?symbol=${symbol}&interval=${interval}&time_period=20`},
        {name: 'atr', url: `/atr?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'williams', url: `/williams?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'sar', url: `/sar?symbol=${symbol}&interval=${interval}&acceleration=0.02&maximum=0.2`},
        {name: 'ichimoku', url: `/ichimoku?symbol=${symbol}&interval=${interval}`}
    ];
    await Promise.all(endpoints.map(async (e) => {
        try {
            const d = await fetchTD(e.url);
            if(!d.values) return;
            calls++;
            const v = d.values[0];
            if(e.name === 'rsi') ind.rsi = parseFloat(v.rsi);
            if(e.name === 'macd') { ind.macd = parseFloat(v.macd); ind.macd_signal = parseFloat(v.macd_signal); ind.macd_hist = parseFloat(v.macd_hist); }
            if(e.name === 'adx') ind.adx = parseFloat(v.adx);
            if(e.name === 'bbands') { ind.bb_upper = parseFloat(v.upper_band); ind.bb_middle = parseFloat(v.middle_band); ind.bb_lower = parseFloat(v.lower_band); }
            if(e.name === 'stoch') { ind.stoch_k = parseFloat(v.slow_k); ind.stoch_d = parseFloat(v.slow_d); }
            if(e.name === 'cci') ind.cci = parseFloat(v.cci);
            if(e.name === 'atr') ind.atr_api = parseFloat(v.atr);
            if(e.name === 'williams') ind.williams_r = parseFloat(v.williams);
            if(e.name === 'sar') ind.sar = parseFloat(v.sar);
            if(e.name === 'ichimoku') { ind.ichimoku_tenkan = parseFloat(v.tenkan_sen); ind.ichimoku_kijun = parseFloat(v.kijun_sen); ind.ichimoku_senkou_a = parseFloat(v.senkou_span_a); ind.ichimoku_senkou_b = parseFloat(v.senkou_span_b); }
        } catch (err) { console.error(`Error fetching ${e.name}:`, err); }
    }));
    return ind;
}

async function getQuoteDirection(tfStr, cachedData = null) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if(data && data.length >= 50) return detectTrend(data);
        else if(data && data.length >= 3) {
            const closedCandle = data[data.length - 2];
            if(closedCandle.c > closedCandle.o) return 'BULLISH';
            if(closedCandle.c < closedCandle.o) return 'BEARISH';
        }
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
    const cE20 = e20[e20.length - 1];
    const cE50 = e50[e50.length - 1];
    if(cE20 > cE50) return 'BULLISH';
    if(cE20 < cE50) return 'BEARISH';
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

// Calculate MSNR
function calculateMSNR(data, currentPrice) {
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const closes = data.map(c => c.c);
    const period = Math.min(data.length, 20);
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
    const allS = [s1, s2, s3].filter(s => s < currentPrice).sort((a, b) => b - a);
    const allR = [r1, r2, r3].filter(r => r > currentPrice).sort((a, b) => a - b);
    return {
        pivot: pp,
        supports: { S1: s1, S2: s2, S3: s3 },
        resistances: { R1: r1, R2: r2, R3: r3 },
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

// Detect CRT
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

// ============================================
// PATTERN-BASED ZONE FINDING - ALL PATTERNS
// ============================================

function findPatternZone(data, price, direction) {
    const msnr = calculateMSNR(data, price);
    const fvgs = detectFVG(data);
    const obs = detectOrderBlocks(data, direction);
    const swings = findSwings(data, 3);
    const tbs = detectTurtleSoup(data);
    const crt = detectCRT(data);
    const settings = getMarketSettings(pair);
    const prec = settings.prec;
    const factor = Math.pow(10, prec);
    
    let candidates = [];
    
    // 1. MSNR Levels
    if(direction === 'BUY') {
        for(const sup of msnr.allSupports) {
            if(sup < price) {
                const distPct = (price - sup) / price * 100;
                if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
                    candidates.push({
                        price: sup,
                        type: 'MSNR Support',
                        score: 80,
                        low: sup * 0.998,
                        high: sup * 1.002,
                        distancePct: distPct,
                        patterns: ['MSNR']
                    });
                }
            }
        }
    } else {
        for(const res of msnr.allResistances) {
            if(res > price) {
                const distPct = (res - price) / price * 100;
                if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
                    candidates.push({
                        price: res,
                        type: 'MSNR Resistance',
                        score: 80,
                        low: res * 0.998,
                        high: res * 1.002,
                        distancePct: distPct,
                        patterns: ['MSNR']
                    });
                }
            }
        }
    }
    
    // 2. FVG
    for(const fvg of fvgs) {
        const distPct = Math.abs(price - fvg.m) / price * 100;
        if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
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
    }
    
    // 3. Order Blocks
    for(const ob of obs) {
        const mid = (ob.low + ob.high) / 2;
        const distPct = Math.abs(price - mid) / price * 100;
        if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
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
    }
    
    // 4. Swing Levels
    if(direction === 'BUY') {
        for(const low of swings.L) {
            if(low.p < price) {
                const distPct = (price - low.p) / price * 100;
                if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
                    candidates.push({
                        price: low.p,
                        type: 'Swing Low',
                        score: 70,
                        low: low.p * 0.998,
                        high: low.p * 1.002,
                        distancePct: distPct,
                        patterns: ['Swing']
                    });
                }
            }
        }
    } else {
        for(const high of swings.H) {
            if(high.p > price) {
                const distPct = (high.p - price) / price * 100;
                if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
                    candidates.push({
                        price: high.p,
                        type: 'Swing High',
                        score: 70,
                        low: high.p * 0.998,
                        high: high.p * 1.002,
                        distancePct: distPct,
                        patterns: ['Swing']
                    });
                }
            }
        }
    }
    
    // 5. Turtle Soup
    if(tbs.detected && tbs.type === direction) {
        const distPct = Math.abs(price - tbs.keyLevel) / price * 100;
        if(distPct <= MAX_ENTRY_DISTANCE_PCT) {
            candidates.push({
                price: tbs.keyLevel,
                type: 'Turtle Soup',
                score: 90,
                low: tbs.keyLevel * 0.997,
                high: tbs.keyLevel * 1.003,
                distancePct: distPct,
                patterns: ['TBS']
            });
        }
    }
    
    // Sort by distance (closest first)
    candidates.sort((a, b) => a.distancePct - b.distancePct || b.score - a.score);
    
    if(candidates.length === 0) return null;
    
    const best = candidates[0];
    
    // Calculate Entry based on the zone
    const atrVal = atr(data, 14);
    let entry;
    if(direction === 'BUY') {
        entry = Math.min(best.price + atrVal * 0.1, price);
    } else {
        entry = Math.max(best.price - atrVal * 0.1, price);
    }
    entry = Math.round(entry * factor) / factor;
    
    // Calculate SL based on the zone
    let sl;
    const minStopDist = Math.max(settings.slBuffer * settings.pipSize, settings.minSL * settings.pipSize, atrVal * 0.5);
    if(direction === 'BUY') {
        sl = best.low - (settings.slBuffer * settings.pipSize);
        if(entry - sl < minStopDist) {
            sl = entry - minStopDist;
        }
    } else {
        sl = best.high + (settings.slBuffer * settings.pipSize);
        if(sl - entry < minStopDist) {
            sl = entry + minStopDist;
        }
    }
    sl = Math.round(sl * factor) / factor;
    
    return {
        entry: entry,
        sl: sl,
        zone: best,
        direction: direction,
        msnr: msnr,
        tbsDetected: tbs.detected && tbs.type === direction,
        crtState: crt.state,
        patterns: best.patterns,
        zoneType: best.type,
        zonePrice: best.price,
        distancePct: best.distancePct
    };
}

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
        const inZone = data[i].l <= zoneHigh && data[i].h >= zoneLow;
        if(!inZone) continue;
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

function getSession() {
    const now = new Date();
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
    
    const h1Trend = await getQuoteDirection('1H', htfData ? htfData['1H'] : null);
    const h4Trend = await getQuoteDirection('4H', htfData ? htfData['4H'] : null);

    const prompt = `ICT TRADE EXECUTION

Asset Pair: ${typeof pair !== 'undefined' ? pair : 'Unknown'}
Current Price: ${price}
Higher Time Frame Bias (1H): ${h1Trend}
Higher Time Frame Bias (4H): ${h4Trend}
Setup Confidence: ${best.confidence}%
Direction: ${best.direction}
Zone Type: ${best.zoneType}
Distance: ${Math.abs(best.distancePct || 0).toFixed(2)}%
TBS: ${best.tbsDetected ? 'YES' : 'NO'}
CRT: ${best.crtState}
Session: ${session.session}
Killzone Active: ${session.isKillzone ? 'YES' : 'NO'}

Analyze the setup based on alignment with HTF bias, session liquidity, and zone proximity.
Return ONLY valid JSON format:
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
    const distance = Math.abs(best.distancePct || 100);
    const isFresh = best.isFresh || false;
    const tbsDetected = best.tbsDetected || false;
    
    if(confidence >= 60 && distance < 1.0 && isFresh) {
        return {
            decision: 'enter_now',
            confidence: confidence,
            reasoning: `Good setup ${confidence}%, fresh zone`,
            risk_adjustment: 1.0,
            wait_condition: null,
            skip_reason: null
        };
    }
    
    if(tbsDetected && confidence >= 55 && distance < 2.0) {
        return {
            decision: 'enter_now',
            confidence: confidence,
            reasoning: `TBS detected, ${confidence}% confidence`,
            risk_adjustment: 1.0,
            wait_condition: null,
            skip_reason: null
        };
    }
    
    if(confidence >= 50 && distance < 3.0) {
        return {
            decision: 'wait_for_reaction',
            confidence: confidence,
            reasoning: `Good setup ${confidence}%, waiting for confirmation`,
            risk_adjustment: 0.8,
            wait_condition: 'Wait for price to reach zone',
            skip_reason: null
        };
    }
    
    return {
        decision: 'skip',
        confidence: confidence,
        reasoning: `Confidence ${confidence}% or distance ${distance.toFixed(2)}% too high`,
        risk_adjustment: 0,
        wait_condition: null,
        skip_reason: `Confidence ${confidence}% below 50% or distance ${distance.toFixed(2)}%`
    };
}

// ============================================
// MAIN ANALYSIS ENGINE - ALL PATTERNS
// ============================================

async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    console.log(`🔍 Analyzing ${tfToAnalyze} on ${pair}...`);
    
    try {
        const entryData = htfData[tfToAnalyze] || await getHistory(tfToAnalyze);
        if(!entryData || entryData.length < 20) {
            console.log(`  ❌ Not enough data for ${tfToAnalyze}`);
            return null;
        }
        
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        const entryATR = twelveIndicators?.atr_api || atr(entryData, 14);
        
        // Get HTF trends
        const dailyDir = await getQuoteDirection('1D', htfData['1D']);
        const h4Dir = await getQuoteDirection('4H', htfData['4H']);
        const h1Dir = await getQuoteDirection('1H', htfData['1H']);
        
        let allSetups = [];
        let session = getSession();
        
        // Check BOTH directions
        for(const dir of ['BUY', 'SELL']) {
            console.log(`  → Checking ${dir}...`);
            
            // Find pattern zone
            const patternResult = findPatternZone(entryData, price, dir);
            if(!patternResult) {
                console.log(`  ❌ ${dir}: No pattern zone found`);
                continue;
            }
            
            const entry = patternResult.entry;
            const sl = patternResult.sl;
            const zone = { low: patternResult.zone.low, high: patternResult.zone.high };
            
            // FIX: Check entry proximity (3% max)
            const entryDistancePct = Math.abs(price - entry) / price * 100;
            if(entryDistancePct > MAX_ENTRY_DISTANCE_PCT) {
                console.log(`  ❌ ${dir}: Entry ${entry} is ${entryDistancePct.toFixed(2)}% away (max ${MAX_ENTRY_DISTANCE_PCT}%)`);
                continue;
            }
            console.log(`  → Entry ${entry} is ${entryDistancePct.toFixed(2)}% from price ✅`);
            
            // Check freshness
            const freshness = checkZoneFreshness(entryData, zone, dir);
            
            if(freshness.touches > MAX_ZONE_TOUCHES) {
                console.log(`  ❌ ${dir}: Zone has ${freshness.touches} touches (REJECTED)`);
                continue;
            }
            
            // Calculate TP
            const risk = Math.abs(entry - sl);
            const settings = getMarketSettings(pair);
            const prec = settings.prec;
            const factor = Math.pow(10, prec);
            
            // Dynamic RR based on settings targetRR and risk in ATR
            const riskInATR = risk / entryATR;
            const targetRR = settings.targetRR || 2.0;
            let rr1, rr2, rr3;
            if(riskInATR >= 2.0) { rr1 = Math.max(1.0, targetRR - 1.0); rr2 = targetRR; rr3 = targetRR + 1.0; }
            else if(riskInATR >= 1.5) { rr1 = Math.max(1.5, targetRR - 0.5); rr2 = targetRR + 0.5; rr3 = targetRR + 1.5; }
            else { rr1 = targetRR; rr2 = targetRR + 1.0; rr3 = targetRR + 2.0; }
            
            let tp1 = dir === 'BUY' ? entry + risk * rr1 : entry - risk * rr1;
            let tp2 = dir === 'BUY' ? entry + risk * rr2 : entry - risk * rr2;
            let tp3 = dir === 'BUY' ? entry + risk * rr3 : entry - risk * rr3;
            tp1 = Math.round(tp1 * factor) / factor;
            tp2 = Math.round(tp2 * factor) / factor;
            tp3 = Math.round(tp3 * factor) / factor;
            
            // ============================================
            // CONFIDENCE SCORING
            // ============================================
            let confidence = 0;
            let reasons = [];
            
            // 1. Pattern Score (Base setup quality)
            let typeScore = patternResult.zone.score || 70;
            confidence += typeScore * 0.40; // Increased base weight to prevent NO_SETUP failures
            reasons.push(`${patternResult.zoneType} (${typeScore}%)`);
            
            // 2. Distance bonus
            if(patternResult.distancePct < 0.5) { confidence += 15; reasons.push('Very close'); }
            else if(patternResult.distancePct < 1.0) { confidence += 10; reasons.push('Close'); }
            else if(patternResult.distancePct < 2.5) { confidence += 5; } // Relaxed to 2.5%
            
            // 3. Pattern Count
            const patternCount = patternResult.patterns ? patternResult.patterns.length : 1;
            confidence += Math.min(patternCount * 8, 20); // Give more weight to confluence
            reasons.push(`${patternCount} patterns`);
            
            // 4. Freshness
            if(freshness.fresh) { confidence += 15; reasons.push('Fresh zone'); }
            else if(freshness.partiallyUsed && freshness.touches <= 3) { confidence += 8; reasons.push('Lightly used'); }
            
            // 5. HTF Alignment
            const dirStr = dir === 'BUY' ? 'BULLISH' : 'BEARISH';
            let htfMatch = 0;
            if(dailyDir === dirStr) htfMatch++;
            if(h4Dir === dirStr) htfMatch++;
            if(h1Dir === dirStr) htfMatch++;
            
            if (htfMatch === 0) {
                console.log(`  ❌ ${dir}: Contradicts HTF biases entirely`);
                continue;
            }

            if(htfMatch >= 2) { confidence += 15; reasons.push(`HTF ${htfMatch}/3`); }
            else if(htfMatch >= 1) { confidence += 10; } // Increased alignment reward
            
            // 6. TBS Bonus
            if(patternResult.tbsDetected) {
                confidence += 15; // Increased TBS reward
                reasons.push('TBS confirmed');
            }
            
            // 7. CRT Bonus
            if(patternResult.crtState === 'EXPANDING') {
                confidence += 10;
                reasons.push('CRT expanding');
            }
            
            // 8. Session Bonus
            if(session.isKillzone || session.isSilverBullet) {
                confidence += 10; // Boosted session reward
                reasons.push('Good session');
            }
            
            confidence = Math.min(confidence, 100);
            
            console.log(`  → ${dir} confidence: ${confidence.toFixed(0)}% (${reasons.join(', ')})`);
            console.log(`  → Entry: ${entry}, SL: ${sl}, TP1: ${tp1}, Touches: ${freshness.touches}`);
            
            if(confidence < MIN_CONFIDENCE) {
                console.log(`  ❌ ${dir}: Confidence ${confidence.toFixed(0)}% < ${MIN_CONFIDENCE}%`);
                continue;
            }
            
            allSetups.push({
                dir,
                entry,
                sl,
                tp1, tp2, tp3,
                confidence: confidence,
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
                distancePct: patternResult.distancePct
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
            setupScore: best.confidence
        };
        
    } catch(e) {
        console.error(`❌ Error in ${tfToAnalyze}:`, e);
        return null;
    }
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
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
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
        
        const results = [];
        const timeframesToScan = ['1D', '4H', '1H'];
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
        
        if(results.length === 0) {
            showNotif('🎯 No setups found', 'warning');
            setJsonOutput({
                status: 'NO_SETUP',
                pair: pair,
                current_price: price,
                reason: 'No setups met minimum confidence or proximity requirements'
            });
            btn.classList.remove('loading');
            btn.disabled = false;
            scanStatus.classList.add('hidden');
            return;
        }
        
        results.sort((a, b) => b.confidence - a.confidence);
        let best = results[0];
        
        // Get AI decision
        scanText.innerHTML = '🤖 AI analyzing execution...';
        const aiDecision = await getAIExecutionDecision(best, price, htfData);
        scanStatus.classList.add('hidden');
        
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
                    risk_reward_ratio: parseFloat(rrDisplay) || 2.0
                }
            }
        };
        
        setJsonOutput(out);
        lastSetupSummary = buildSetupSummary(best, st, finalEntry, price);
        lastSetupOut = out;
        
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
    const journal = getJournal();
    journal.unshift({ ...rest, status: outcome, journaledAt: new Date().toISOString() });
    setJournal(journal);
    setRecents(r.filter(x => x.id !== id));
    renderRecents();
    renderJournal();
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
console.log(`   - Entry within ${MAX_ENTRY_DISTANCE_PCT}% of current price (was 0.5%)`);
console.log('   - Checks BOTH BUY and SELL directions');
console.log('   - Entry adjusted to near current price');
console.log('   - All patterns scored and used');
console.log('   - TBS gets high priority');
console.log('   - CRT expanding gives bonus');
console.log('   - HTF alignment scored');
console.log('   - Session bonus (Killzone/Silver Bullet)');
console.log('   - Freshness scoring');
console.log(`   - Min confidence: ${MIN_CONFIDENCE}%`);