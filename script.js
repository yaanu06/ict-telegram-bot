// Initialize Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// ============================================
// CONFIG
// ============================================
let TWELVE_DATA_KEY = '', DEEPSEEK_API_KEY = '';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
let DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const SYMBOLS = {
    'BTC/USD':'BTC/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY','AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD','EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};
const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day','1W':'1week' };
const QUOTE_INTERVAL_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day' };
const ALL_TIMEFRAMES = ['5M', '15M', '1H', '4H', '1D'];
const TF_WEIGHT = { '1D': 5, '4H': 4, '1H': 3, '15M': 2, '5M': 1 };
const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_PRECISION = 5;
const BUY_INVALIDATION_FACTOR = 0.998;
const SELL_INVALIDATION_FACTOR = 1.002;

// ============================================
// MARKET SETTINGS
// ============================================
function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2, pipSize: 0.1, slBuffers: { '5M': 2, '15M': 3, '1H': 5, '4H': 8, '1D': 15 } };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.01, targetRR: 4, prec: 2, pipSize: 0.01, slBuffers: { '5M': 0.03, '15M': 0.05, '1H': 0.08, '4H': 0.12, '1D': 0.20 } };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.005, targetRR: 4, prec: 3, pipSize: 0.01, slBuffers: { '5M': 0.08, '15M': 0.12, '1H': 0.20, '4H': 0.35, '1D': 0.60 } };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.015, targetRR: 4, prec: 2, pipSize: 1, slBuffers: { '5M': 30, '15M': 50, '1H': 80, '4H': 120, '1D': 200 } };
    return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.005, targetRR: 4, prec: 5, pipSize: 0.0001, slBuffers: { '5M': 0.0003, '15M': 0.0005, '1H': 0.0008, '4H': 0.0012, '1D': 0.0020 } };
}

function getSLBufferForTF(apiATR, tfUsed, currentPair) {
    const s = getMarketSettings(currentPair || pair);
    const tfBuffer = s.slBuffers[tfUsed] || s.slBuffers['15M'] || 3;
    return Math.max(tfBuffer, apiATR * 0.3);
}

function getTimeframeHierarchy(selectedTF) {
    const hierarchy = {
        '1D': ['1D', '4H', '1H', '15M'],
        '4H': ['4H', '1H', '15M', '5M'],
        '1H': ['1H', '15M', '5M', '5M'],
        '15M': ['1H', '15M', '5M', '5M'],
        '5M': ['15M', '5M', '5M', '5M']
    };
    return hierarchy[selectedTF] || ['4H', '1H', '15M', '5M'];
}

function getPrec(p) { const s = getMarketSettings(p); return s.prec; }

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
let lastSetupSummary = null;
let lastSetupOut = null;
let rateLimitNotified = 0;
const PRICE_CACHE_DURATION = 5000;

// ============================================
// DOM READY - INITIALIZE APP
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 App initializing...');
    await loadKeys();
    updateKeyStatus();
    if (!TWELVE_DATA_KEY) {
        setTimeout(showSetup, 500);
    }
    init();
});

// ============================================
// API KEYS
// ============================================
async function loadKeys() {
    try {
        const s = localStorage.getItem('ict_bot_keys');
        if (s) {
            const k = JSON.parse(s);
            TWELVE_DATA_KEY = k.twelveData || '';
            DEEPSEEK_API_KEY = k.deepseek || '';
            DEEPSEEK_API_URL = k.deepseekUrl || 'https://api.deepseek.com/chat/completions';
            return true;
        }
    } catch(e) {}
    return false;
}

async function saveKeys(tk, dk, du) {
    localStorage.setItem('ict_bot_keys', JSON.stringify({
        twelveData: tk,
        deepseek: dk,
        deepseekUrl: du || 'https://api.deepseek.com/chat/completions'
    }));
    TWELVE_DATA_KEY = tk;
    DEEPSEEK_API_KEY = dk;
    DEEPSEEK_API_URL = du || 'https://api.deepseek.com/chat/completions';
    updateKeyStatus();
}

function clearKeys() {
    localStorage.removeItem('ict_bot_keys');
    TWELVE_DATA_KEY = '';
    DEEPSEEK_API_KEY = '';
    DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
    updateKeyStatus();
    showNotif('🗑️ Keys removed', 'warning');
}

function updateKeyStatus() {
    const ts = document.getElementById('twelveStatus');
    const ds = document.getElementById('deepseekStatus');
    if (ts) {
        ts.innerHTML = TWELVE_DATA_KEY ? '✅ Active' : '❌ Missing';
        ts.className = 'status-badge ' + (TWELVE_DATA_KEY ? 'active' : 'inactive');
    }
    if (ds) {
        ds.innerHTML = DEEPSEEK_API_KEY ? '✅ Active (' + DEEPSEEK_API_KEY.substring(0, 5) + '...)' : '❌ Missing';
        ds.className = 'status-badge ' + (DEEPSEEK_API_KEY ? 'active' : 'inactive');
    }
    const keyBtn = document.getElementById('updateKeysBtn');
    if (keyBtn) {
        keyBtn.innerHTML = (TWELVE_DATA_KEY && DEEPSEEK_API_KEY) ? '🔑 Manage Keys' : '🔑 Setup Keys';
    }
}

function showSetup() {
    const ex = document.getElementById('setupOverlay');
    if (ex) ex.remove();
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
    document.getElementById('svBtn').addEventListener('click', async function() {
        const tk = document.getElementById('twInput').value.trim();
        const dk = document.getElementById('dsInput').value.trim();
        const du = document.getElementById('urlInput').value.trim();
        if (!tk) { showNotif('⚠️ Twelve Data key required', 'warning'); return; }
        await saveKeys(tk, dk, du);
        document.getElementById('setupOverlay').remove();
    });
    document.getElementById('clBtn').addEventListener('click', function() {
        clearKeys();
        document.getElementById('twInput').value = '';
        document.getElementById('dsInput').value = '';
        document.getElementById('urlInput').value = '';
    });
    document.getElementById('skBtn').addEventListener('click', function() {
        document.getElementById('setupOverlay').remove();
    });
    document.getElementById('testAiBtn').addEventListener('click', async function() {
        const dk = document.getElementById('dsInput').value.trim();
        const du = document.getElementById('urlInput').value.trim() || 'https://api.deepseek.com/chat/completions';
        if (!dk) { document.getElementById('testResult').innerHTML = '❌ Enter key first'; return; }
        document.getElementById('testResult').innerHTML = '🔄 Testing...';
        try {
            const r = await fetch(du, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dk },
                body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 })
            });
            const d = await r.json();
            document.getElementById('testResult').innerHTML = d.choices ? '✅ AI working!' : '❌ Error: ' + (d.error?.message || 'Unknown');
        } catch (e) {
            document.getElementById('testResult').innerHTML = '❌ Connection failed';
        }
    });
}

// ============================================
// INIT
// ============================================
function init() {
    console.log('🚀 Initializing UI...');
    updateTime();
    setInterval(updateTime, 1000);

    const el = (id) => document.getElementById(id);

    if (el('analyzeBtn')) el('analyzeBtn').addEventListener('click', runAutoScan);
    if (el('executeBtn')) el('executeBtn').addEventListener('click', handleLimit);
    if (el('cancelLimitBtn')) el('cancelLimitBtn').addEventListener('click', cancelLimit);
    if (el('copyJsonBtn')) el('copyJsonBtn').addEventListener('click', copyJson);
    if (el('updateKeysBtn')) el('updateKeysBtn').addEventListener('click', showSetup);
    if (el('saveSetupBtn')) el('saveSetupBtn').addEventListener('click', saveCurrentSetup);
    if (el('recentList')) el('recentList').addEventListener('click', handleRecentClick);
    if (el('journalList')) el('journalList').addEventListener('click', handleJournalClick);

    renderRecents();
    renderJournal();

    if (el('pairSelect')) {
        el('pairSelect').addEventListener('change', function(e) {
            pair = e.target.value;
            resetPairState();
        });
    }

    document.querySelectorAll('.category-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            document.querySelectorAll('.category-btn').forEach(function(x) { x.classList.remove('active'); });
            this.classList.add('active');
            updatePairs(this.dataset.category);
        });
    });

    const activeBtn = document.querySelector('.category-btn.active');
    if (activeBtn) updatePairs(activeBtn.dataset.category);

    loadLimitOrder();
    console.log('✅ App initialized successfully');
}

function updateTime() {
    const n = new Date();
    const el = document.getElementById('liveTime');
    if (el) {
        el.innerHTML = n.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
            n.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

function updatePairs(cat) {
    const p = {
        crypto: ['BTC/USD'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY'],
        metals: ['XAU/USD', 'XAG/USD']
    };
    const select = document.getElementById('pairSelect');
    if (select) {
        select.innerHTML = p[cat].map(function(x) {
            return '<option value="' + x + '">' + getPairDisplayName(x) + '</option>';
        }).join('');
        pair = p[cat][0];
        resetPairState();
    }
}

function getPairDisplayName(p) {
    const icons = {
        'BTC/USD': '₿ BTC/USD',
        'EUR/USD': '€ EUR/USD',
        'GBP/USD': '£ GBP/USD',
        'USD/JPY': '💴 USD/JPY',
        'AUD/USD': '🇦🇺 AUD/USD',
        'USD/CAD': '🇨🇦 USD/CAD',
        'USD/CHF': '🇨🇭 USD/CHF',
        'NZD/USD': '🇳🇿 NZD/USD',
        'EUR/GBP': '€/£ EUR/GBP',
        'EUR/JPY': '€/¥ EUR/JPY',
        'GBP/JPY': '£/¥ GBP/JPY',
        'XAU/USD': '👑 XAU/USD',
        'XAG/USD': '🥈 XAG/USD'
    };
    return icons[p] || '📊 ' + p;
}

function resetPairState() {
    cachedPrice = null;
    priceCacheTime = 0;
    cachedPricePair = null;
    lastPrice = null;
    analysis = null;
    const eb = document.getElementById('executeBtn');
    if (eb && !limitOrder) eb.disabled = true;
    const cp = document.getElementById('currentPrice');
    if (cp) cp.innerHTML = '––';
    const pc = document.getElementById('priceChange');
    if (pc) { pc.innerHTML = '–'; pc.className = 'price-change'; }
}

// ============================================
// API FUNCTIONS
// ============================================
async function fetchTD(pathAndQuery, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(TWELVE_DATA_BASE + pathAndQuery + '&apikey=' + TWELVE_DATA_KEY, { signal: ctrl.signal });
        const d = await r.json();
        if (d.code === 429) {
            if (Date.now() - rateLimitNotified > 30000) {
                rateLimitNotified = Date.now();
                showNotif('⏳ Twelve Data rate limit hit - wait a minute', 'warning');
            }
            throw new Error('Rate limited');
        }
        if (d.code && d.code !== 200) throw new Error(d.message || 'API Error');
        return d;
    } finally { clearTimeout(timer); }
}

async function getPrice(forPair) {
    const p = forPair || pair;
    const now = Date.now();
    if (cachedPrice !== null && cachedPricePair === p && (now - priceCacheTime) < PRICE_CACHE_DURATION) {
        return cachedPrice;
    }
    if (!TWELVE_DATA_KEY) return null;
    try {
        const d = await fetchTD('/price?symbol=' + encodeURIComponent(SYMBOLS[p]));
        if (d.price) {
            calls++;
            const src = document.getElementById('apiSource');
            if (src) src.innerHTML = '📡 Live';
            cachedPrice = +d.price;
            priceCacheTime = now;
            cachedPricePair = p;
            return cachedPrice;
        }
    } catch (e) {
        if (cachedPrice !== null && cachedPricePair === p) return cachedPrice;
    }
    return null;
}

async function getHistory(tfStr, forPair) {
    if (!TWELVE_DATA_KEY) return null;
    try {
        const d = await fetchTD('/time_series?symbol=' + encodeURIComponent(SYMBOLS[forPair || pair]) + '&interval=' + TF_MAP[tfStr] + '&outputsize=100');
        if (d.values) {
            calls++;
            return d.values.map(function(c) {
                return {
                    t: c.datetime,
                    o: +c.open,
                    h: +c.high,
                    l: +c.low,
                    c: +c.close,
                    v: +c.volume || 1000000
                };
            }).reverse();
        }
    } catch (e) { console.error('History error (' + tfStr + '):', e); }
    return null;
}

async function getTechnicalIndicators(tfUsed) {
    if (!TWELVE_DATA_KEY) return {};
    const symbol = encodeURIComponent(SYMBOLS[pair]);
    const interval = TF_MAP[tfUsed];
    const ind = {};
    const endpoints = [
        { name: 'rsi', url: '/rsi?symbol=' + symbol + '&interval=' + interval + '&time_period=14' },
        { name: 'macd', url: '/macd?symbol=' + symbol + '&interval=' + interval },
        { name: 'adx', url: '/adx?symbol=' + symbol + '&interval=' + interval + '&time_period=14' },
        { name: 'bbands', url: '/bbands?symbol=' + symbol + '&interval=' + interval + '&time_period=20' },
        { name: 'stoch', url: '/stoch?symbol=' + symbol + '&interval=' + interval },
        { name: 'cci', url: '/cci?symbol=' + symbol + '&interval=' + interval + '&time_period=20' },
        { name: 'atr', url: '/atr?symbol=' + symbol + '&interval=' + interval + '&time_period=14' },
        { name: 'williams', url: '/williams?symbol=' + symbol + '&interval=' + interval + '&time_period=14' },
        { name: 'sar', url: '/sar?symbol=' + symbol + '&interval=' + interval + '&acceleration=0.02&maximum=0.2' },
        { name: 'ichimoku', url: '/ichimoku?symbol=' + symbol + '&interval=' + interval }
    ];
    await Promise.all(endpoints.map(async function(e) {
        try {
            const d = await fetchTD(e.url);
            if (!d.values) return;
            calls++;
            const v = d.values[0];
            if (e.name === 'rsi') ind.rsi = parseFloat(v.rsi);
            if (e.name === 'macd') {
                ind.macd = parseFloat(v.macd);
                ind.macd_signal = parseFloat(v.macd_signal);
                ind.macd_hist = parseFloat(v.macd_hist);
            }
            if (e.name === 'adx') ind.adx = parseFloat(v.adx);
            if (e.name === 'bbands') {
                ind.bb_upper = parseFloat(v.upper_band);
                ind.bb_middle = parseFloat(v.middle_band);
                ind.bb_lower = parseFloat(v.lower_band);
            }
            if (e.name === 'stoch') {
                ind.stoch_k = parseFloat(v.slow_k);
                ind.stoch_d = parseFloat(v.slow_d);
            }
            if (e.name === 'cci') ind.cci = parseFloat(v.cci);
            if (e.name === 'atr') ind.atr_api = parseFloat(v.atr);
            if (e.name === 'williams') ind.williams_r = parseFloat(v.williams);
            if (e.name === 'sar') ind.sar = parseFloat(v.sar);
            if (e.name === 'ichimoku') {
                ind.ichimoku_tenkan = parseFloat(v.tenkan_sen);
                ind.ichimoku_kijun = parseFloat(v.kijun_sen);
                ind.ichimoku_senkou_a = parseFloat(v.senkou_span_a);
                ind.ichimoku_senkou_b = parseFloat(v.senkou_span_b);
            }
        } catch (err) { console.error('Error fetching ' + e.name + ':', err); }
    }));
    return ind;
}

async function getQuoteDirection(tfStr, cachedData) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if (data && data.length >= 50) return detectTrend(data);
        else if (data && data.length >= 3) {
            const closedCandle = data[data.length - 2];
            if (closedCandle.c > closedCandle.o) return 'BULLISH';
            if (closedCandle.c < closedCandle.o) return 'BEARISH';
        }
    } catch (e) {}
    return 'NEUTRAL';
}

async function getLiveCandleDirection(tfStr, cachedData) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if (!data || data.length < 2) return 'NEUTRAL';
        const currentPrice = await getPrice();
        if (!currentPrice) return 'NEUTRAL';
        const currentCandle = data[data.length - 1];
        if (currentPrice > currentCandle.o) return 'BULLISH';
        if (currentPrice < currentCandle.o) return 'BEARISH';
        return 'NEUTRAL';
    } catch (e) { return 'NEUTRAL'; }
}

// ============================================
// TECHNICALS MATH
// ============================================
const ema = function(p, n) {
    const m = 2 / (n + 1);
    let e = [];
    let sum = 0;
    for (let i = 0; i < p.length; i++) {
        if (i < n) {
            sum += p[i];
            e.push(sum / (i + 1));
        } else {
            e.push((p[i] - e[i - 1]) * m + e[i - 1]);
        }
    }
    return e;
};

const rsi = function(p, n) {
    n = n || 14;
    if (p.length < n + 1) return 50;
    let g = 0,
        l = 0;
    for (let i = 1; i <= n; i++) {
        const c = p[i] - p[i - 1];
        if (c >= 0) g += c;
        else l -= c;
    }
    let ag = g / n,
        al = l / n;
    for (let i = n + 1; i < p.length; i++) {
        const c = p[i] - p[i - 1];
        ag = (ag * (n - 1) + (c > 0 ? c : 0)) / n;
        al = (al * (n - 1) + (c < 0 ? -c : 0)) / n;
    }
    return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
};

const atr = function(d, n) {
    n = n || 14;
    let t = [];
    for (let i = 1; i < d.length; i++) {
        t.push(Math.max(d[i].h - d[i].l, Math.abs(d[i].h - d[i - 1].c), Math.abs(d[i].l - d[i - 1].c)));
    }
    return t.slice(-n).reduce(function(a, b) { return a + b; }, 0) / n;
};

function detectFVG(d) {
    let f = [],
        active = [];
    const len = d.length;
    for (let i = 1; i < len - 1; i++) {
        const next = d[i + 1];
        if (active.length > 0) {
            let keep = 0;
            for (let k = 0; k < active.length; k++) {
                let g = active[k];
                if (g.type === 'bull') {
                    if (next.c < g.l) g.fresh = false;
                    else active[keep++] = g;
                } else {
                    if (next.c > g.h) g.fresh = false;
                    else active[keep++] = g;
                }
            }
            active.length = keep;
        }
        const prev = d[i - 1];
        const thresh = next.c * 0.0005;
        if (prev.h < next.l && next.l - prev.h > thresh) {
            let g = { type: 'bull', l: prev.h, h: next.l, m: (prev.h + next.l) / 2, fresh: true };
            f.push(g);
            active.push(g);
        }
        if (prev.l > next.h && prev.l - next.h > thresh) {
            let g = { type: 'bear', l: next.h, h: prev.l, m: (next.h + prev.l) / 2, fresh: true };
            f.push(g);
            active.push(g);
        }
    }
    return f;
}

function findSwings(d, lb) {
    lb = lb || 3;
    let H = [],
        L = [];
    let h = d.map(function(c) { return c.h; });
    let l = d.map(function(c) { return c.l; });
    for (let i = lb; i < h.length - lb; i++) {
        let iH = true,
            iL = true;
        for (let j = 1; j <= lb; j++) {
            if (h[i] <= h[i - j] || h[i] <= h[i + j]) iH = false;
            if (l[i] >= l[i - j] || l[i] >= l[i + j]) iL = false;
        }
        if (iH) H.push({ p: h[i], i: i });
        if (iL) L.push({ p: l[i], i: i });
    }
    return { H: H, L: L };
}

function detectMSS(d) {
    if (d.length < 21) return null;
    let h = d.map(function(c) { return c.h; });
    let l = d.map(function(c) { return c.l; });
    let c = d.map(function(c) { return c.c; });
    let rH = Math.max.apply(null, h.slice(-21, -1));
    let rL = Math.min.apply(null, l.slice(-21, -1));
    let cP = c[c.length - 1];
    let dis = detectDisplacement(d, cP > rH ? 'BUY' : 'SELL');
    if (cP > rH && dis.detected) return { type: 'BULL', level: rH, displaced: true };
    if (cP < rL && dis.detected) return { type: 'BEAR', level: rL, displaced: true };
    if (cP > rH) return { type: 'BULL', level: rH, displaced: false };
    if (cP < rL) return { type: 'BEAR', level: rL, displaced: false };
    return null;
}

function detectBreakers(d) {
    let b = [];
    let s = findSwings(d);
    for (let i = 5; i < d.length - 5; i++) {
        let c = d[i];
        if (c.c > c.o) {
            let r = s.H.find(function(h) { return h.i < i && h.p < c.c; });
            if (r) b.push({ type: 'BULL', p: r.p });
        }
        if (c.c < c.o) {
            let sp = s.L.find(function(lv) { return lv.i < i && lv.p > c.c; });
            if (sp) b.push({ type: 'BEAR', p: sp.p });
        }
    }
    return b;
}

function detectOrderBlocks(data, direction) {
    const obs = [];
    for (let i = 2; i < data.length - 1; i++) {
        if (direction === 'BUY') {
            if (data[i].c < data[i].o && data[i + 1].c > data[i + 1].o && data[i + 1].h > data[i].h && data[i + 1].c > data[i].h) {
                obs.push({ type: 'BULL_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i });
            }
        } else {
            if (data[i].c > data[i].o && data[i + 1].c < data[i + 1].o && data[i + 1].l < data[i].l && data[i + 1].c < data[i].l) {
                obs.push({ type: 'BEAR_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i });
            }
        }
    }
    return obs;
}

function detectTrend(data) {
    const closes = data.map(function(c) { return c.c; });
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const cE20 = e20[e20.length - 1];
    const cE50 = e50[e50.length - 1];
    if (cE20 > cE50) return 'BULLISH';
    if (cE20 < cE50) return 'BEARISH';
    return 'NEUTRAL';
}

function detectDisplacement(data, direction) {
    if (data.length < 5) return { detected: false };
    const lc = data.slice(-5);
    const bodies = lc.map(function(c) { return Math.abs(c.c - c.o); });
    const avg = bodies.reduce(function(a, b) { return a + b; }, 0) / bodies.length;
    const lb = bodies[bodies.length - 1];
    if (direction === 'BUY' && lb > avg * 2.5 && lc[4].c > lc[4].o) return { detected: true };
    if (direction === 'SELL' && lb > avg * 2.5 && lc[4].c < lc[4].o) return { detected: true };
    return { detected: false };
}

function detectLiquiditySweeps(data, currentPrice) {
    const sweeps = [];
    const a = atr(data, 14);
    const maxDistance = a * 3;
    const len = data.length;

    for (let i = 10; i < len - 3; i++) {
        let maxH = data[i - 5].h;
        let minL = data[i - 5].l;
        for (let j = i - 4; j < i; j++) {
            if (data[j].h > maxH) maxH = data[j].h;
            if (data[j].l < minL) minL = data[j].l;
        }

        if (Math.abs(maxH - currentPrice) <= maxDistance) {
            let countH = 0;
            const threshH = maxH * 0.001;
            for (let j = i - 5; j < i; j++) {
                if (Math.abs(data[j].h - maxH) <= threshH) countH++;
            }
            if (countH >= 2) {
                let hasSweep = false;
                const targetH = maxH * 1.001;
                for (let j = i; j < i + 4; j++) {
                    if (data[j].h > targetH) {
                        hasSweep = true;
                        break;
                    }
                }
                if (hasSweep && data[i + 3].c < maxH) {
                    sweeps.push({ type: 'BUY_SIDE', level: maxH, distance: Math.abs(maxH - currentPrice), direction: 'BEARISH' });
                }
            }
        }

        if (Math.abs(minL - currentPrice) <= maxDistance) {
            let countL = 0;
            const threshL = minL * 0.001;
            for (let j = i - 5; j < i; j++) {
                if (Math.abs(data[j].l - minL) <= threshL) countL++;
            }
            if (countL >= 2) {
                let hasSweepL = false;
                const targetL = minL * 0.999;
                for (let j = i; j < i + 4; j++) {
                    if (data[j].l < targetL) {
                        hasSweepL = true;
                        break;
                    }
                }
                if (hasSweepL && data[i + 3].c > minL) {
                    sweeps.push({ type: 'SELL_SIDE', level: minL, distance: Math.abs(minL - currentPrice), direction: 'BULLISH' });
                }
            }
        }
    }
    return sweeps.sort(function(a, b) { return a.distance - b.distance; });
}

function detectTurtleSoup(data) {
    if (data.length < 15) return { detected: false, type: null };
    const rd = data.slice(-15);
    const highs = rd.map(function(c) { return c.h; });
    const lows = rd.map(function(c) { return c.l; });
    const closes = rd.map(function(c) { return c.c; });
    const opens = rd.map(function(c) { return c.o; });
    const keyLow = Math.min.apply(null, lows.slice(0, -4));
    const recentLow = lows[lows.length - 4];
    const cc = closes[closes.length - 1];
    const co = opens[opens.length - 1];
    if (recentLow < keyLow * 0.999 && cc > keyLow && cc > co) {
        return { detected: true, type: 'BUY', keyLevel: keyLow, sweptLevel: recentLow };
    }
    const keyHigh = Math.max.apply(null, highs.slice(0, -4));
    const recentHigh = highs[highs.length - 4];
    if (recentHigh > keyHigh * 1.001 && cc < keyHigh && cc < co) {
        return { detected: true, type: 'SELL', keyLevel: keyHigh, sweptLevel: recentHigh };
    }
    return { detected: false, type: null };
}

function calculateMSNR(data, currentPrice) {
    const highs = data.map(function(c) { return c.h; });
    const lows = data.map(function(c) { return c.l; });
    const closes = data.map(function(c) { return c.c; });
    const period = Math.min(data.length, 20);
    const rH = Math.max.apply(null, highs.slice(-period));
    const rL = Math.min.apply(null, lows.slice(-period));
    const rC = closes[closes.length - 1];
    const pp = (rH + rL + rC) / 3;
    const s1 = pp * 2 - rH;
    const s2 = pp - (rH - rL);
    const s3 = rL - 2 * (rH - pp);
    const r1 = pp * 2 - rL;
    const r2 = pp + (rH - rL);
    const r3 = rH + 2 * (pp - rL);
    const ms1 = (s1 + s2) / 2;
    const ms2 = (pp + s1) / 2;
    const mr1 = (r1 + r2) / 2;
    const mr2 = (pp + r1) / 2;
    const allS = [s1, ms2, ms1, s2, s3].filter(function(s) { return s < currentPrice; }).sort(function(a, b) { return b - a; });
    const allR = [r1, mr2, mr1, r2, r3].filter(function(r) { return r > currentPrice; }).sort(function(a, b) { return a - b; });
    return {
        pivot: pp,
        supports: { S1: s1, S2: s2, S3: s3, MS1: ms1, MS2: ms2 },
        resistances: { R1: r1, R2: r2, R3: r3, MR1: mr1, MR2: mr2 },
        nearestSupport: allS[0] || null,
        nearestResistance: allR[0] || null,
        allSupports: allS,
        allResistances: allR
    };
}

function findPrecisionEntry(data, price, direction, msnr) {
    const a = atr(data, 14);
    const fvgs = detectFVG(data);
    const breakers = detectBreakers(data);
    const swings = findSwings(data, 4);
    const imbalances = findImbalances(data);
    const orderBlocks = detectOrderBlocks(data, direction);
    const RETEST_LOOKBACK_CANDLES = 15;
    const recentCandles = data.slice(-RETEST_LOOKBACK_CANDLES);
    const isEligibleFVG = function(fvg) {
        return fvg.fresh || recentCandles.some(function(candle) {
            return candle.l <= fvg.h && candle.h >= fvg.l;
        });
    };
    const h = Math.max.apply(null, data.slice(-20).map(function(c) { return c.h; }));
    const l = Math.min.apply(null, data.slice(-20).map(function(c) { return c.l; }));
    const r = h - l;
    const oteLow = direction === 'BUY' ? l + r * 0.21 : h - r * 0.382;
    const oteHigh = direction === 'BUY' ? l + r * 0.382 : h - r * 0.21;
    let allZones = [];
    if (direction === 'BUY') {
        fvgs.filter(function(f) { return f.type === 'bull' && f.l < price && isEligibleFVG(f); }).forEach(function(f) {
            let s = 30;
            let cf = ['FVG'];
            if (f.l >= oteLow && f.l <= oteHigh) { s += 35;
                cf.push('OTE'); }
            if (breakers.find(function(b) { return b.type === 'BULL' && Math.abs(b.p - f.l) < a * 0.5; })) { s += 25;
                cf.push('Breaker'); }
            if (swings.L.find(function(x) { return Math.abs(x.p - f.l) < a * 0.3; })) { s += 20;
                cf.push('Swing'); }
            if (msnr.nearestSupport && Math.abs(msnr.nearestSupport - f.l) < f.l * 0.003) { s += 20;
                cf.push('MSNR'); }
            if (imbalances.find(function(i) { return i.type === 'BULLISH' && Math.abs((i.low + i.high) / 2 - f.l) < f.l * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: f.l, high: f.h, p: (f.l + f.h) / 2, src: 'FVG', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 75 ? 'A' : (s >= 50 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
        orderBlocks.filter(function(ob) { return ob.high < price; }).forEach(function(ob) {
            let s = 35;
            let cf = ['OrderBlock'];
            if (ob.low >= oteLow && ob.low <= oteHigh) { s += 35;
                cf.push('OTE'); }
            if (swings.L.find(function(x) { return Math.abs(x.p - ob.low) < a * 0.3; })) { s += 20;
                cf.push('Swing'); }
            if (msnr.nearestSupport && Math.abs(msnr.nearestSupport - ob.low) < ob.low * 0.003) { s += 20;
                cf.push('MSNR'); }
            if (imbalances.find(function(i) { return i.type === 'BULLISH' && Math.abs((i.low + i.high) / 2 - ob.low) < ob.low * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: ob.low, high: ob.high, p: (ob.low + ob.high) / 2, src: 'OB', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 75 ? 'A' : (s >= 55 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
        [msnr.allSupports?.[0], msnr.allSupports?.[1]].filter(function(v) { return v && v < price; }).forEach(function(lvl) {
            let s = lvl === msnr.allSupports?.[0] ? 40 : 35;
            let cf = ['MSNR'];
            if (fvgs.find(function(f) { return f.type === 'bull' && Math.abs(f.l - lvl) < lvl * 0.003; })) { s += 25;
                cf.push('FVG'); }
            if (swings.L.find(function(x) { return Math.abs(x.p - lvl) < lvl * 0.003; })) { s += 20;
                cf.push('Swing'); }
            if (imbalances.find(function(i) { return i.type === 'BULLISH' && Math.abs((i.low + i.high) / 2 - lvl) < lvl * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: lvl * 0.998, high: lvl * 1.002, p: lvl, src: 'MSNR', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 65 ? 'A' : (s >= 50 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
    } else {
        fvgs.filter(function(f) { return f.type === 'bear' && f.h > price && isEligibleFVG(f); }).forEach(function(f) {
            let s = 30;
            let cf = ['FVG'];
            if (f.h >= oteLow && f.h <= oteHigh) { s += 35;
                cf.push('OTE'); }
            if (breakers.find(function(b) { return b.type === 'BEAR' && Math.abs(b.p - f.h) < a * 0.5; })) { s += 25;
                cf.push('Breaker'); }
            if (swings.H.find(function(x) { return Math.abs(x.p - f.h) < a * 0.3; })) { s += 20;
                cf.push('Swing'); }
            if (msnr.nearestResistance && Math.abs(msnr.nearestResistance - f.h) < f.h * 0.003) { s += 20;
                cf.push('MSNR'); }
            if (imbalances.find(function(i) { return i.type === 'BEARISH' && Math.abs((i.low + i.high) / 2 - f.h) < f.h * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: f.l, high: f.h, p: (f.l + f.h) / 2, src: 'FVG', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 75 ? 'A' : (s >= 50 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
        orderBlocks.filter(function(ob) { return ob.low > price; }).forEach(function(ob) {
            let s = 35;
            let cf = ['OrderBlock'];
            if (ob.high >= oteLow && ob.high <= oteHigh) { s += 35;
                cf.push('OTE'); }
            if (swings.H.find(function(x) { return Math.abs(x.p - ob.high) < a * 0.3; })) { s += 20;
                cf.push('Swing'); }
            if (msnr.nearestResistance && Math.abs(msnr.nearestResistance - ob.high) < ob.high * 0.003) { s += 20;
                cf.push('MSNR'); }
            if (imbalances.find(function(i) { return i.type === 'BEARISH' && Math.abs((i.low + i.high) / 2 - ob.high) < ob.high * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: ob.low, high: ob.high, p: (ob.low + ob.high) / 2, src: 'OB', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 75 ? 'A' : (s >= 55 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
        [msnr.allResistances?.[0], msnr.allResistances?.[1]].filter(function(v) { return v && v > price; }).forEach(function(lvl) {
            let s = lvl === msnr.allResistances?.[0] ? 40 : 35;
            let cf = ['MSNR'];
            if (fvgs.find(function(f) { return f.type === 'bear' && Math.abs(f.h - lvl) < lvl * 0.003; })) { s += 25;
                cf.push('FVG'); }
            if (swings.H.find(function(x) { return Math.abs(x.p - lvl) < lvl * 0.003; })) { s += 20;
                cf.push('Swing'); }
            if (imbalances.find(function(i) { return i.type === 'BEARISH' && Math.abs((i.low + i.high) / 2 - lvl) < lvl * 0.005; })) { s += 25;
                cf.push('Imbalance'); }
            allZones.push({ low: lvl * 0.998, high: lvl * 1.002, p: lvl, src: 'MSNR', score: s, confluence: cf.join('+'), cc: cf.length, quality: s >= 65 ? 'A' : (s >= 50 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance') });
        });
    }
    const tsSig = detectTurtleSoup(data);
    if (tsSig.detected && tsSig.type === direction) {
        for (const z of allZones) {
            if (Math.abs(z.p - tsSig.keyLevel) < price * 0.004) {
                z.score += 25;
                z.confluence += '+TBS';
                z.cc++;
                z.quality = z.score >= 75 ? 'A' : (z.score >= 55 ? 'B' : 'C');
            }
        }
    }
    allZones.sort(function(x, y) { return y.score - x.score; });
    if (allZones.length > 0) {
        const cands = [];
        for (const z of allZones) {
            const zp = (z.low + z.high) / 2;
            if (cands.some(function(c) { return Math.abs(c.p - zp) < zp * 0.002; })) continue;
            cands.push({ low: z.low, high: z.high, p: zp, src: z.src, confluence: z.confluence, cc: z.cc, quality: z.quality, hasImbalance: z.hasImbalance });
            if (cands.length >= 8) break;
        }
        const b = cands[0];
        b.candidates = cands;
        return b;
    }
    if (direction === 'BUY') {
        const low = l + r * 0.21,
            high = l + r * 0.382;
        return { low: low, high: high, p: (low + high) / 2, src: 'OTE', confluence: 'OTE', cc: 1, quality: 'C', hasImbalance: false };
    } else {
        const low = h - r * 0.382,
            high = h - r * 0.21;
        return { low: low, high: high, p: (low + high) / 2, src: 'OTE', confluence: 'OTE', cc: 1, quality: 'C', hasImbalance: false };
    }
}

function findImbalances(data) {
    const im = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (data[i - 1].l > data[i + 1].h) im.push({ type: 'BULLISH', low: data[i + 1].h, high: data[i - 1].l });
        if (data[i - 1].h < data[i + 1].l) im.push({ type: 'BEARISH', low: data[i - 1].h, high: data[i + 1].l });
    }
    return im.slice(-5);
}

function checkZoneFreshness(data, zone, direction) {
    let touches = 0,
        violations = 0;
    const lookback = Math.min(50, data.length);
    for (let i = data.length - lookback; i < data.length; i++) {
        if (i < 0) continue;
        const inZone = data[i].l <= zone.high && data[i].h >= zone.low;
        if (!inZone) continue;
        touches++;
        if (direction === 'BUY' && data[i].c < zone.low) violations++;
        if (direction === 'SELL' && data[i].c > zone.high) violations++;
    }
    const fresh = touches <= 2 && violations === 0;
    const partiallyUsed = touches <= 5 && violations <= 1;
    const used = touches > 5 || violations > 1;
    return { fresh: fresh, partiallyUsed: partiallyUsed, used: used, touches: touches, violations: violations };
}

function checkPathClearance(entryData, entry, tp, direction) {
    const obstacles = [];
    const fvgs = detectFVG(entryData);
    const swings = findSwings(entryData, 3);
    if (direction === 'BUY') {
        const bearFVGs = fvgs.filter(function(f) { return f.type === 'bear' && f.l > entry && f.l < tp; });
        if (bearFVGs.length > 0) obstacles.push('Bearish FVG');
        const swingHighs = swings.H.filter(function(s) { return s.p > entry && s.p < tp; });
        if (swingHighs.length > 0) obstacles.push('Swing high');
    } else {
        const bullFVGs = fvgs.filter(function(f) { return f.type === 'bull' && f.h > tp && f.h < entry; });
        if (bullFVGs.length > 0) obstacles.push('Bullish FVG');
        const swingLows = swings.L.filter(function(s) { return s.p > tp && s.p < entry; });
        if (swingLows.length > 0) obstacles.push('Swing low');
    }
    return { clear: obstacles.length === 0, obstacles: obstacles, count: obstacles.length };
}

function checkZoneMagnetism(entryData, price, entry, direction, zone) {
    const imbalances = findImbalances(entryData);
    const sweeps = detectLiquiditySweeps(entryData, price);
    let score = 0;
    const checks = [];
    if (direction === 'BUY') {
        const pullingImbalances = imbalances.filter(function(i) { return i.type === 'BEARISH' && i.low > entry && i.high < price; });
        if (pullingImbalances.length > 0) {
            score += 30;
            checks.push({ name: 'Imbalance pulling toward zone', passed: true, detail: pullingImbalances.length + ' bearish imbalance(s) magnet' });
        } else {
            checks.push({ name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet' });
        }
    } else {
        const pullingImbalances = imbalances.filter(function(i) { return i.type === 'BULLISH' && i.low > price && i.high < entry; });
        if (pullingImbalances.length > 0) {
            score += 30;
            checks.push({ name: 'Imbalance pulling toward zone', passed: true, detail: pullingImbalances.length + ' bullish imbalance(s) magnet' });
        } else {
            checks.push({ name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet' });
        }
    }
    const supportingSweeps = sweeps.filter(function(s) { return direction === 'BUY' ? s.direction === 'BULLISH' : s.direction === 'BEARISH'; });
    if (supportingSweeps.length > 0) {
        score += 25;
        checks.push({ name: 'Sweeps support direction', passed: true, detail: supportingSweeps.length + ' sweep(s)' });
    } else {
        checks.push({ name: 'Sweeps support direction', passed: false, detail: 'No supporting sweeps' });
    }
    const closes = entryData.map(function(c) { return c.c; });
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const cE20 = e20[e20.length - 1];
    const cE50 = e50[e50.length - 1];
    const prevE20 = e20[e20.length - 3];
    if (direction === 'BUY' && cE20 > cE50 && cE20 > prevE20) {
        score += 20;
        checks.push({ name: 'EMA momentum aligned', passed: true, detail: 'Bullish momentum' });
    } else if (direction === 'SELL' && cE20 < cE50 && cE20 < prevE20) {
        score += 20;
        checks.push({ name: 'EMA momentum aligned', passed: true, detail: 'Bearish momentum' });
    } else {
        checks.push({ name: 'EMA momentum aligned', passed: false, detail: 'Not aligned' });
    }
    const distancePct = Math.abs(price - entry) / price * 100;
    if (distancePct < 0.3) {
        score += 15;
        checks.push({ name: 'Zone proximity', passed: true, detail: 'Very close (' + distancePct.toFixed(2) + '%)' });
    } else if (distancePct < 0.8) {
        score += 10;
        checks.push({ name: 'Zone proximity', passed: true, detail: 'Reachable (' + distancePct.toFixed(2) + '%)' });
    } else if (distancePct < 2.0) {
        score += 5;
        checks.push({ name: 'Zone proximity', passed: true, detail: 'Extended (' + distancePct.toFixed(2) + '%)' });
    } else {
        checks.push({ name: 'Zone proximity', passed: false, detail: 'Very far (' + distancePct.toFixed(2) + '%)' });
    }
    if (zone) {
        const zoneConfluence = typeof zone.confluence === 'string' ? zone.confluence : '';
        const isPrimaryMethodZone = zone.src === 'MSNR' || zoneConfluence.includes('MSNR');
        if (isPrimaryMethodZone && zone.cc >= 2) {
            score += 25;
            checks.push({ name: 'Primary-method zone', passed: true, detail: zone.src + ' ' + zoneConfluence });
        } else if (zone.quality === 'A') {
            score += 25;
            checks.push({ name: 'High-quality zone', passed: true, detail: 'A-grade zone nearby' });
        } else if (zone.quality === 'B' && zone.cc >= 2) {
            score += 25;
            checks.push({ name: 'High-quality zone', passed: true, detail: 'B-grade multi-confluence zone nearby' });
        } else {
            checks.push({ name: 'High-quality zone', passed: false, detail: 'Single-confluence or weak zone' });
        }
    }
    const displacement = detectDisplacement(entryData, direction);
    if (displacement.detected) {
        score += 10;
        checks.push({ name: 'Displacement momentum', passed: true, detail: 'Detected' });
    } else {
        checks.push({ name: 'Displacement momentum', passed: false, detail: 'None' });
    }
    const magnetism = score >= 60 ? 'STRONG' : (score >= 35 ? 'MODERATE' : 'WEAK');
    return { magnetism: magnetism, score: score, maxScore: 100, checks: checks, likelyToReach: score >= 35, summary: 'Zone magnetism: ' + magnetism + ' (' + score + '/100)' };
}

function getVolatilityLevel(atrValue, price) {
    const pct = (atrValue / price) * 100;
    if (pct > 0.8) return { level: 'High - Impulsive', desc: 'Large candles' };
    if (pct > 0.4) return { level: 'Moderate - Control', desc: 'Normal' };
    return { level: 'Low - Consolidation', desc: 'Tight ranges' };
}

function getSession() {
    const now = new Date();
    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const time = hour + min / 60;
    let estHour = hour - 4;
    if (estHour < 0) estHour += 24;
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false, isMacro: false };
    if (time >= 0 && time < 4) s = { ...s, session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true };
    else if (time >= 7 && time < 10) s = { ...s, session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true };
    else if (time >= 12 && time < 15) s = { ...s, session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true };
    else if (time >= 15 && time < 17) s = { ...s, session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true };
    if ((time >= 8.5 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) {
        s.isSilverBullet = true;
        s.multiplier += 0.2;
        s.emoji = '🏹';
        s.session += ' + SB';
    }
    const estTime = estHour + min / 60;
    const isAM_Macro1 = (estTime >= 9.83 && estTime <= 10.16);
    const isAM_Macro2 = (estTime >= 10.83 && estTime <= 11.16);
    const isPM_Macro1 = (estTime >= 11.83 && estTime <= 12.16);
    const isPM_Macro2 = (estTime >= 13.16 && estTime <= 13.83);
    const isClose_Macro = (estTime >= 15.25 && estTime <= 15.75);
    if (isAM_Macro1 || isAM_Macro2 || isPM_Macro1 || isPM_Macro2 || isClose_Macro) {
        s.isMacro = true;
        s.multiplier += 0.3;
        s.emoji = '🔥';
        s.session += ' (MACRO)';
    }
    return s;
}

function checkHTFConfluence(dailyDir, h4Dir, entryDirection) {
    const entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH';
    const againstDir = entryDirection === 'BUY' ? 'BEARISH' : 'BULLISH';
    if (dailyDir === entryDir && h4Dir === entryDir) {
        return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 };
    }
    if (dailyDir === entryDir || h4Dir === entryDir) {
        return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: dailyDir === entryDir ? 8 : 15, alignedTF: dailyDir === entryDir ? '1D' : '4H' };
    }
    if (dailyDir === 'NEUTRAL' && h4Dir === 'NEUTRAL') {
        return { level: 'NEUTRAL', daily: dailyDir, h4: h4Dir, penalty: 5 };
    }
    if ((dailyDir === 'NEUTRAL' && h4Dir === againstDir) || (dailyDir === againstDir && h4Dir === 'NEUTRAL')) {
        return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: 12, alignedTF: null };
    }
    return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 30 };
}

// ============================================
// GHOST MACHINE ANALYZE TIMEFRAME
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    console.log('🔍 Analyzing ' + tfToAnalyze + '...');
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        const entryData = htfData[entryTF] || await getHistory(entryTF);
        if (!entryData?.length) return null;
        const structureData = htfData[structureTF] || await getHistory(structureTF);
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);

        const crtRange = {
            high: Math.max.apply(null, entryData.slice(-20).map(function(c) { return c.h; })),
            low: Math.min.apply(null, entryData.slice(-20).map(function(c) { return c.l; }))
        };
        const msnr = calculateMSNR(structureData || entryData, price);
        const entryATR = atr(entryData, 14);

        const allSetups = [];

        for (const dir of ['BUY', 'SELL']) {
            console.log('  → Checking ' + dir + ' on ' + tfToAnalyze + '...');

            const sweeps = detectLiquiditySweeps(entryData, price);
            const wantSweepDir = dir === 'BUY' ? 'BULLISH' : 'BEARISH';
            const hasSweep = sweeps.some(function(s) { return s.direction === wantSweepDir; });
            const turtleSoup = detectTurtleSoup(entryData);
            const hasTBS = turtleSoup.detected && turtleSoup.type === dir;

            const mss = detectMSS(entryData);
            const hasMSS = mss !== null;
            const hasDisplacement = mss?.displaced === true;
            const bosCount = countBOS(entryData, htfData, dir);

            const zone = findPrecisionEntry(entryData, price, dir, msnr);
            if (!zone) {
                console.log('  ❌ ' + dir + ': No zone');
                continue;
            }

            const isUnmet = dir === 'BUY' ? zone.high < price : zone.low > price;
            const freshness = checkZoneFreshness(entryData, zone, dir);
            const isValidZone = freshness.fresh || (freshness.partiallyUsed && freshness.violations === 0);

            const brokenLevel = findBrokenLevel(entryData, dir);
            const session = getSession();

            let entry;
            if (dir === 'BUY') {
                entry = Math.min(zone.low + entryATR * 0.1, zone.high);
            } else {
                entry = Math.max(zone.high - entryATR * 0.1, zone.low);
            }
            const entryDistance = dir === 'BUY' ? price - entry : entry - price;

            let sl;
            if (dir === 'BUY') {
                sl = Math.min(zone.low - entryATR * 0.3, crtRange.low);
                if (sl >= entry) sl = entry - entryATR * 0.5;
            } else {
                sl = Math.max(zone.high + entryATR * 0.3, crtRange.high);
                if (sl <= entry) sl = entry + entryATR * 0.5;
            }

            const risk = Math.abs(entry - sl);
            const tp1 = dir === 'BUY' ? entry + risk * 2.0 : entry - risk * 2.0;
            const tp2 = dir === 'BUY' ? entry + risk * 4.0 : entry - risk * 4.0;
            const tp3 = dir === 'BUY' ? crtRange.high : crtRange.low;

            let pts = 0;
            const reasons = [];
            const confBreakdown = [];

            const addScore = function(adj, label) {
                pts += adj;
                reasons.push(label);
                confBreakdown.push({ adj: adj, reason: label });
            };

            if (hasSweep) addScore(25, 'Liquidity Sweep');
            if (hasTBS) addScore(25, 'Turtle Soup');

            if (bosCount >= 3) addScore(25, bosCount + 'x BOS confirmed');
            else if (bosCount >= 2) addScore(15, bosCount + 'x BOS');

            if (hasDisplacement) addScore(15, 'MSS with displacement');
            else if (hasMSS) addScore(8, 'MSS exists');

            if (isUnmet && isValidZone) addScore(20, 'Fresh unmet order block');
            else if (isValidZone) addScore(10, 'Fresh zone');

            if (brokenLevel) addScore(15, 'Broken level flipped');

            if (zone.quality === 'A') addScore(10, 'A-grade zone');
            else if (zone.quality === 'B') addScore(5, 'B-grade zone');

            if (entryDistance > 0 && entryDistance < entryATR * 1.5) {
                addScore(10, 'Entry ' + (entryDistance / entryATR).toFixed(1) + 'x ATR away');
            }

            let htfAgree = 0;
            const htfTrends = {};
            for (const t of ['1D', '4H', '1H']) {
                const d = htfData[t];
                if (d && d.length >= 50) {
                    const trend = detectTrend(d);
                    htfTrends[t] = trend;
                    if ((dir === 'BUY' && trend === 'BULLISH') || (dir === 'SELL' && trend === 'BEARISH')) htfAgree++;
                }
            }
            if (htfAgree >= 2) addScore(10, htfAgree + '/3 HTF align');

            console.log('  → ' + dir + ' score: ' + pts + ' (' + reasons.join(', ') + ')');

            if (pts < 65) {
                console.log('  ❌ ' + dir + ': Score ' + pts + ' < 65');
                continue;
            }

            console.log('  ✅ ' + dir + ' setup! Score: ' + pts);
            allSetups.push({
                dir: dir,
                pts: pts,
                entry: entry,
                sl: sl,
                tp1: tp1,
                tp2: tp2,
                tp3: tp3,
                risk: risk,
                sweeps: sweeps,
                turtleSoup: turtleSoup,
                hasSweep: hasSweep,
                hasTBS: hasTBS,
                mss: mss,
                hasMSS: hasMSS,
                hasDisplacement: hasDisplacement,
                bosCount: bosCount,
                zone: zone,
                isUnmet: isUnmet,
                freshness: freshness,
                isValidZone: isValidZone,
                brokenLevel: brokenLevel,
                session: session,
                entryDistance: entryDistance,
                htfTrends: htfTrends,
                htfAgree: htfAgree,
                reasons: reasons,
                confBreakdown: confBreakdown
            });
        }

        if (allSetups.length === 0) {
            console.log('  ❌ ' + tfToAnalyze + ': No setup scored >= 65');
            return null;
        }

        allSetups.sort(function(a, b) { return b.pts - a.pts; });
        const best = allSetups[0];
        const {
            dir,
            pts: setupScore,
            entry,
            sl,
            tp1,
            tp2,
            tp3,
            risk,
            sweeps,
            turtleSoup,
            hasSweep,
            hasTBS,
            mss,
            hasMSS,
            hasDisplacement,
            bosCount,
            zone,
            isUnmet,
            freshness,
            isValidZone,
            brokenLevel,
            session,
            entryDistance,
            htfTrends,
            htfAgree,
            reasons,
            confBreakdown
        } = best;

        const apiATR = twelveIndicators?.atr_api || entryATR;
        const volatility = getVolatilityLevel(apiATR, price);
        const confidence = Math.min(setupScore + 15, 95);
        const invalidationPrice = dir === 'BUY' ? sl * 0.995 : sl * 1.005;
        const entryDistanceATR = entryDistance / (entryATR || 1);
        const entryDistancePct = (entryDistance / price) * 100;

        const mtfTrends = {};
        let alignedCount = 0;
        for (const t of ALL_TIMEFRAMES) {
            const d = htfData[t];
            const tr = (d && d.length >= 50) ? detectTrend(d) : 'NEUTRAL';
            mtfTrends[t] = tr;
            if ((dir === 'BUY' && tr === 'BULLISH') || (dir === 'SELL' && tr === 'BEARISH')) alignedCount++;
        }
        const mtf = { direction: dir, strength: alignedCount, trends: mtfTrends };

        const htfConfluence = checkHTFConfluence(
            htfData['1D'] && htfData['1D'].length >= 50 ? detectTrend(htfData['1D']) : 'NEUTRAL',
            htfData['4H'] && htfData['4H'].length >= 50 ? detectTrend(htfData['4H']) : 'NEUTRAL',
            dir
        );

        // ============================================
        // HIGHER TIMEFRAME PRIORITY + ALIGNMENT
        // ============================================
        const htfPriority = {
            '1D': 5,
            '4H': 4,
            '1H': 3,
            '15M': 2,
            '5M': 1
        };

        const tfScore = htfPriority[tfToAnalyze] || 1;
        const alignmentBonus = htfAgree >= 2 ? 15 : (htfAgree >= 1 ? 5 : -5);
        const finalScore = setupScore + tfScore + alignmentBonus;

        console.log('  → Final score with HTF priority: ' + finalScore + ' (TF:' + tfScore + ' + Align:' + alignmentBonus + ')');

        return {
            timeframe: tfToAnalyze,
            direction: dir,
            entry: entry,
            sl: sl,
            tp1: tp1,
            tp2: tp2,
            tp3: tp3,
            confidence: Math.min(confidence + tfScore + alignmentBonus, 98),
            zone: zone,
            msnr: msnr,
            turtleSoup: turtleSoup,
            sweeps: sweeps,
            session: session,
            hasSweep: hasSweep,
            hasTBS: hasTBS,
            hasLiquidityEvent: hasSweep || hasTBS,
            mss: mss,
            hasDisplacement: hasDisplacement,
            bosCount: bosCount,
            isUnmet: isUnmet,
            freshness: freshness,
            brokenLevel: brokenLevel,
            entryDistanceATR: entryDistanceATR,
            entryDistancePct: entryDistancePct,
            entryATR: entryATR,
            htfTrends: htfTrends,
            htfAgree: htfAgree,
            htfConfluence: htfConfluence,
            tfPriority: tfScore,
            alignmentBonus: alignmentBonus,
            finalScore: finalScore,
            score: setupScore,
            reasons: reasons,
            confBreakdown: confBreakdown,
            mtf: mtf,
            volatility: volatility,
            twelveIndicators: twelveIndicators || {},
            tradeLevels: {
                entry: entry,
                stopLoss: sl,
                takeProfit: tp1,
                partialTP: tp2,
                invalidation: invalidationPrice,
                breakeven: entry,
                pipsRisk: Math.abs(entry - sl) / (getMarketSettings(pair).pipSize || 0.0001),
                pipsReward: Math.abs(tp1 - entry) / (getMarketSettings(pair).pipSize || 0.0001),
                riskReward: 4.0
            }
        };

    } catch (e) {
        console.error('❌ Error in ' + tfToAnalyze + ':', e);
        return null;
    }
}

function countBOS(data, htfData, direction) {
    let count = 0;
    const tfs = ['1D', '4H', '1H', '15M', '5M'];
    for (const tf of tfs) {
        const d = htfData[tf] || data;
        if (d.length < 20) continue;
        const mss = detectMSS(d);
        if (!mss) continue;
        if (direction === 'BUY' && mss.type === 'BULL') count++;
        if (direction === 'SELL' && mss.type === 'BEAR') count++;
    }
    return count;
}

function findBrokenLevel(data, direction) {
    if (data.length < 30) return null;
    const swings = findSwings(data, 4);
    const lastPrice = data[data.length - 1].c;
    if (direction === 'BUY') {
        const resistances = swings.H.filter(function(s) { return s.p < lastPrice; });
        if (resistances.length > 0) {
            const broken = resistances[resistances.length - 1];
            return { price: broken.p, type: 'RESISTANCE_FLIPPED_TO_SUPPORT' };
        }
    } else {
        const supports = swings.L.filter(function(s) { return s.p > lastPrice; });
        if (supports.length > 0) {
            const broken = supports[supports.length - 1];
            return { price: broken.p, type: 'SUPPORT_FLIPPED_TO_RESISTANCE' };
        }
    }
    return null;
}

// ============================================
// AUTO SCAN
// ============================================
async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn');
    const scanStatus = document.getElementById('scanStatus');
    const scanText = document.getElementById('scanText');
    const scanFill = document.getElementById('scanProgressFill');

    btn.classList.add('loading');
    btn.disabled = true;
    scanStatus.classList.remove('hidden');

    if (!TWELVE_DATA_KEY) {
        showSetup();
        btn.classList.remove('loading');
        btn.disabled = false;
        scanStatus.classList.add('hidden');
        return;
    }

    showNotif('🔍 Scanning for Ghost Machine setups...', 'info');

    try {
        const price = await getPrice();
        if (!price) throw new Error('No price');

        const historyCache = {};
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
        scanText.innerHTML = 'Fetching market data...';

        for (const t of tfs) {
            historyCache[t] = await getHistory(t);
        }

        const mtfTrendsData = {};
        for (const t of tfs) {
            mtfTrendsData[t] = await getQuoteDirection(t, historyCache[t]);
        }

        await updateMTFDisplay(historyCache);

        const priceEl = document.getElementById('currentPrice');
        if (priceEl) priceEl.innerHTML = '$' + price.toFixed(getPrec(pair));

        if (lastPrice) {
            const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2);
            const ce = document.getElementById('priceChange');
            if (ce) {
                ce.innerHTML = (ch >= 0 ? '▲' : '▼') + ' ' + Math.abs(ch) + '%';
                ce.className = 'price-change ' + (ch >= 0 ? 'up' : 'down');
            }
        }
        lastPrice = price;

        const results = [];
        const timeframesToScan = ['1D', '4H', '1H', '15M', '5M'];
        const htfData = historyCache;

        for (let i = 0; i < timeframesToScan.length; i++) {
            const tfScan = timeframesToScan[i];
            scanText.innerHTML = 'Scanning ' + tfScan + '... (' + (i + 1) + '/' + timeframesToScan.length + ')';
            scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%';
            const result = await analyzeTimeframe(tfScan, price, htfData);
            if (result) results.push(result);
        }

        console.log('=== SCAN RESULTS ===');
        console.log('Results found:', results.length);
        for (const r of results) {
            console.log('TF:', r.timeframe, '| Direction:', r.direction, '| Score:', r.finalScore || r.score, '| Confidence:', r.confidence);
        }

        if (results.length === 0) {
            showNotif('🎯 No Ghost Machine setups found', 'warning');
            setJsonOutput({
                auto_scan_result: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair: pair,
                    current_price: price,
                    status: 'NO_GHOST_MACHINE_PATTERN',
                    note: 'Ghost Machine requires: Liquidity Sweep/TBS + MSS with Displacement + Fresh Zone + Score >= 65.',
                    multi_timeframe_trends: mtfTrendsData,
                    timeframes_scanned: timeframesToScan.length
                }
            });
            btn.classList.remove('loading');
            btn.disabled = false;
            scanStatus.classList.add('hidden');
            return;
        }

        for (const result of results) {
            try { result.qualityScore = calculateSetupQuality(result, price); } catch (e) { result.qualityScore = 0; }
            result.confidenceAtScan = result.confidence;
        }

        // ============================================
        // SORT BY FINAL SCORE (HTF Priority + Alignment)
        // ============================================
        results.sort(function(a, b) {
            return (b.finalScore || b.score || 0) - (a.finalScore || a.score || 0);
        });

        let best = results[0];

        if (results.length > 1) {
            showNotif('🎯 Found ' + results.length + ' setups! Best: ' + best.timeframe + ' ' + best.direction + ' (Score: ' + (best.finalScore || best.score) + ')', 'success');
        } else {
            showNotif('🎯 Setup found on ' + best.timeframe + ' (Score: ' + (best.finalScore || best.score) + ')', 'success');
        }

        scanText.innerHTML = '🤖 AI execution check...';
        const aiResult = await askAIWithAllResults(results, price, htfData);
        scanStatus.classList.add('hidden');

        const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
        const htfConfluence = checkHTFConfluence(
            htfData['1D'] && htfData['1D'].length >= 50 ? detectTrend(htfData['1D']) : 'NEUTRAL',
            htfData['4H'] && htfData['4H'].length >= 50 ? detectTrend(htfData['4H']) : 'NEUTRAL',
            best.direction
        );

        if (htfConfluence.level === 'CONFLICT') {
            best.confidence = Math.max(best.confidence - 15, 75);
            showNotif('⚠️ HTF conflict: 1D=' + htfConfluence.daily + ', 4H=' + htfConfluence.h4, 'warning');
        }

        // ============================================
        // GHOST MACHINE SCORING (65+ = TRADE)
        // ============================================
        let ghostScore = 0;
        let ghostReasons = [];

        const addGhostScore = function(pts, reason) {
            ghostScore += pts;
            ghostReasons.push(reason);
        };

        if (best.hasSweep) addGhostScore(25, 'Liquidity Sweep');
        if (best.hasTBS) addGhostScore(25, 'Turtle Soup');
        if (best.hasDisplacement) addGhostScore(25, 'MSS with displacement');
        else if (best.mss) addGhostScore(10, 'MSS exists');

        if (best.freshness?.fresh) addGhostScore(20, 'Fresh zone');
        else if (best.freshness?.partiallyUsed && best.freshness?.violations === 0) addGhostScore(10, 'Lightly used');

        if (best.zone?.quality === 'A') addGhostScore(15, 'A-grade zone');
        else if (best.zone?.quality === 'B') addGhostScore(10, 'B-grade zone');
        else addGhostScore(5, 'C-grade zone');

        // HTF Alignment Bonus (MANDATORY for higher timeframe setups)
        const htfAgree = best.htfAgree || 0;
        if (htfAgree >= 2) {
            addGhostScore(15, htfAgree + '/3 HTF aligned');
        } else if (htfAgree === 1) {
            addGhostScore(5, htfAgree + '/3 HTF aligned');
        } else {
            addGhostScore(-10, 'No HTF alignment');
        }

        // TF Priority Bonus
        const tfPriority = best.tfPriority || 1;
        if (tfPriority >= 4) { // 1D or 4H
            addGhostScore(15, 'Higher TF priority');
        } else if (tfPriority >= 3) { // 1H
            addGhostScore(8, 'Mid TF priority');
        }

        if (best.session?.isSilverBullet) addGhostScore(10, 'Silver Bullet');
        else if (best.session?.isKillzone) addGhostScore(5, 'Killzone');

        if (best.brokenLevel) addGhostScore(10, 'Broken level flipped');
        if (best.isUnmet) addGhostScore(10, 'Unmet zone');

        const bosCount = best.bosCount || 0;
        if (bosCount >= 3) addGhostScore(10, bosCount + 'x BOS');
        else if (bosCount >= 2) addGhostScore(5, bosCount + 'x BOS');

        const tradeable = ghostScore >= 65;
        const riskPercent = tradeable ? (ghostScore >= 85 ? 1.0 : 0.5) : 0;
        const noTradeReason = tradeable ? null : 'Ghost score ' + ghostScore + ' < 65 (' + ghostReasons.slice(0, 3).join(', ') + ')';

        console.log('🏆 Ghost Machine Score: ' + ghostScore + '/100 (' + ghostReasons.join(', ') + ')');
        console.log('📊 Tradeable: ' + tradeable + ', Risk: ' + (riskPercent * 100) + '%');

        const prec = getPrec(pair);
        const out = {
            auto_scan_result: {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].split('.')[0],
                pair: pair,
                current_price: price,
                multi_timeframe_trends: mtfTrendsData,
                best_timeframe: best.timeframe,
                ghost_score: ghostScore,
                ghost_reasons: ghostReasons,
                htf_alignment: htfAgree + '/3 timeframes aligned',
                htf_confluence: htfConfluence.level,
                status: tradeable ? 'GHOST_MACHINE_SETUP' : 'NO_TRADE',
                no_trade_reason: noTradeReason,
                suggested_risk: riskPercent === 1 ? '1% (FULL - score 85+)' : (riskPercent === 0.5 ? '0.5% (HALF - score 65-84)' : '0% (do not trade)'),
                total_setups_found: results.length,
                setups_found: results.map(function(r) {
                    return {
                        timeframe: r.timeframe,
                        direction: r.direction,
                        entry: r.entry,
                        sl: r.sl,
                        tp1: r.tp1,
                        confidence: r.confidenceAtScan || r.confidence,
                        score: r.finalScore || r.score,
                        htf_align: r.htfAgree || 0,
                        reasons: r.reasons || []
                    };
                }),
                trade_signal: {
                    trade_type: best.direction === 'BUY' ? 'BUY-LIMIT' : 'SELL-LIMIT',
                    entry_price: best.entry,
                    entry_zone: { low: best.zone.low, high: best.zone.high },
                    stop_loss: best.sl,
                    take_profit_1: best.tp1,
                    take_profit_2: best.tp2,
                    take_profit_3: best.tp3,
                    risk_reward: '1:4.0',
                    confidence: best.confidence,
                    ghost_score: ghostScore,
                    ghost_reasons: ghostReasons,
                    htf_alignment: htfAgree + '/3 HTF aligned',
                    analysis: {
                        trend_detection: best.mtf?.direction || best.direction,
                        volatility_level: best.volatility?.level || 'Moderate',
                        liquidity_sweep: best.hasSweep ? '✅ Detected' : '❌ Not detected',
                        turtle_soup: best.hasTBS ? '✅ Detected' : '❌ Not detected',
                        mss: best.mss ? (best.mss.type + ' with displacement') : 'None',
                        zone_freshness: best.freshness?.fresh ? 'Fresh' : (best.freshness?.partiallyUsed ? 'Partially used' : 'Used'),
                        session: best.session?.session || 'OFF-HOURS',
                        silver_bullet: best.session?.isSilverBullet ? '✅ Yes' : '❌ No',
                        bos_count: best.bosCount || 0,
                        broken_level: best.brokenLevel ? '✅ Found' : '❌ Not found',
                        unmet_zone: best.isUnmet ? '✅ Yes' : '❌ No',
                        htf_confluence: htfConfluence.level
                    },
                    technical_indicators: [
                        'RSI: ' + (best.twelveIndicators?.rsi || 'N/A'),
                        'ATR: ' + (best.apiATR?.toFixed(prec) || 'N/A'),
                        'Sweeps: ' + (best.hasSweep ? 'Yes' : 'No'),
                        'MSS: ' + (best.mss?.type || 'None'),
                        'BOS: ' + (best.bosCount || 0),
                        'HTF Align: ' + htfAgree + '/3'
                    ]
                }
            }
        };

        setJsonOutput(out);
        lastSetupSummary = buildSetupSummary(best, st, best.entry, price);
        lastSetupOut = out;

        if (!tradeable) {
            analysis = null;
            document.getElementById('executeBtn').disabled = true;
            showNotif('🚫 ' + noTradeReason, 'warning');
            return;
        }

        analysis = {
            signalType: st,
            idealEntry: best.entry,
            currentPrice: price,
            stopLoss: best.sl,
            takeProfit1: best.tp1,
            takeProfit2: best.tp2,
            takeProfit3: best.tp3,
            confidence: best.confidence,
            riskPercent: riskPercent,
            entryZoneLow: best.zone.low,
            entryZoneHigh: best.zone.high,
            entryReady: true,
            invalidationPrice: best.tradeLevels?.invalidation || (best.direction === 'BUY' ? best.sl * 0.998 : best.sl * 1.002)
        };

        document.getElementById('executeBtn').disabled = false;
        showNotif('🎯 GHOST MACHINE ' + best.timeframe + ' ' + st + ' ' + best.confidence + '% | Score: ' + ghostScore + ' | Risk: ' + (riskPercent * 100) + '%', 'success');

    } catch (e) {
        console.error(e);
        showNotif('Error: ' + e.message, 'error');
        scanStatus.classList.add('hidden');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// ============================================
// UI HELPERS
// ============================================
async function updateMTFDisplay(historyCache) {
    historyCache = historyCache || {};
    const tfs = ['5M', '15M', '1H', '4H', '1D', '1W'];
    for (const t of tfs) {
        const tr = await getLiveCandleDirection(t, historyCache[t]);
        const el = document.getElementById('trend' + t);
        if (el) {
            el.innerHTML = tr === 'BULLISH' ? '🟢 Bull' : (tr === 'BEARISH' ? '🔴 Bear' : '⚪ Neut');
            el.className = 'mtf-trend ' + tr.toLowerCase();
        }
    }
}

function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    if (el) el.textContent = JSON.stringify(obj, null, 2);
}

function showNotif(msg, type) {
    const n = document.getElementById('notification');
    if (!n) return;
    n.innerHTML = msg;
    n.className = 'notification ' + (type || 'info');
    n.classList.remove('hidden');
    clearTimeout(n._timer);
    n._timer = setTimeout(function() {
        n.classList.add('hidden');
    }, 3000);
}

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
        quality: best.zone?.quality || '?',
        sniper: false,
        priceAtScan: price,
        ghostScore: best.ghostScore || best.score || 0
    };
}

function calculateSetupQuality(result, price) {
    let score = 0;
    const risk = Math.abs(result.entry - result.sl);
    const riskPct = (risk / price) * 100;

    if (result.zone?.quality === 'A') score += 30;
    else if (result.zone?.quality === 'B') score += 15;
    else score += 5;

    if (result.freshness?.fresh) score += 15;
    else if (result.freshness?.partiallyUsed) score += 5;

    if (result.hasSweep) score += 10;
    if (result.hasTBS) score += 10;
    if (result.hasDisplacement) score += 15;

    const htfAgree = result.htfAgree || 0;
    if (htfAgree >= 2) score += 15;
    else if (htfAgree >= 1) score += 5;

    const tfPriority = result.tfPriority || 1;
    if (tfPriority >= 4) score += 15;
    else if (tfPriority >= 3) score += 8;

    if (result.session?.isSilverBullet) score += 10;
    else if (result.session?.isKillzone) score += 5;

    if (result.brokenLevel) score += 10;
    if (result.isUnmet) score += 10;

    if (riskPct < 0.1) score -= 10;
    if (riskPct > 2.0) score -= 10;

    return Math.max(0, score + 20);
}

// ============================================
// LIMIT ORDER FUNCTIONS
// ============================================
function handleLimit() {
    if (!analysis || analysis.signalType === 'NEUTRAL') {
        showNotif('No signal', 'error');
        return;
    }
    if (limitOrder) {
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
        entryZoneLow: analysis.entryZoneLow,
        entryZoneHigh: analysis.entryZoneHigh,
        entryReady: analysis.entryReady,
        invalidationPrice: analysis.invalidationPrice,
        createdAt: new Date().toISOString()
    };
    saveLimit(o);
    startMonitor();
    showNotif('📝 Limit @ $' + o.idealEntry.toFixed(getPrec(pair)), 'info');
}

function saveLimit(o) {
    limitOrder = o;
    localStorage.setItem('limitOrder', JSON.stringify(o));
    updateLimitUI();
}

function loadLimitOrder() {
    const s = localStorage.getItem('limitOrder');
    if (s) {
        try {
            limitOrder = JSON.parse(s);
            updateLimitUI();
            startMonitor();
        } catch (e) {}
    }
}

function clearLimit() {
    limitOrder = null;
    localStorage.removeItem('limitOrder');
    if (priceTimer) clearInterval(priceTimer);
    updateLimitUI();
}

function cancelLimit() {
    clearLimit();
    showNotif('❌ Cancelled', 'warning');
}

function updateLimitUI() {
    const t = document.getElementById('limitOrderText');
    const c = document.getElementById('cancelLimitBtn');
    const eb = document.getElementById('executeBtn');
    if (limitOrder) {
        const prec = getPrec(limitOrder.pair || pair);
        t.innerHTML = '⏳ ' + (limitOrder.pair || '') + ' ' + limitOrder.signalType + ' LIMIT @ $' + limitOrder.idealEntry.toFixed(prec) + ' | SL: $' + limitOrder.stopLoss.toFixed(prec);
        t.className = 'active';
        c.classList.remove('hidden');
        eb.innerHTML = '⏳ Waiting...';
        eb.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
    } else {
        t.innerHTML = 'No active limit order';
        t.className = '';
        c.classList.add('hidden');
        eb.innerHTML = '⚡ Place Limit Order';
        eb.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
    }
}

function startMonitor() {
    if (priceTimer) clearInterval(priceTimer);
    priceTimer = setInterval(async function() {
        if (!limitOrder) { clearInterval(priceTimer); return; }
        const orderPair = limitOrder.pair || pair;
        const p = await getPrice(orderPair);
        if (!p) return;
        const prec = getPrec(orderPair);
        if (orderPair === pair) {
            const el = document.getElementById('currentPrice');
            if (el) el.innerHTML = '$' + p.toFixed(prec);
        }
        if ((limitOrder.signalType === 'LONG' && p <= limitOrder.idealEntry) ||
            (limitOrder.signalType === 'SHORT' && p >= limitOrder.idealEntry)) {
            const filled = limitOrder;
            clearLimit();
            showNotif('✅ FILLED! ' + (filled.pair || '') + ' ' + filled.signalType + ' @ $' + p.toFixed(prec), 'success');
            try {
                new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();
            } catch (e) {}
        }
    }, 2000);
}

function copyJson() {
    const el = document.getElementById('jsonOutput');
    const t = el ? el.textContent : '';
    if (!t || t.trim() === '{}' || t.trim() === '') {
        showNotif('Run analysis first', 'warning');
        return;
    }
    navigator.clipboard.writeText(t).then(function() {
        showNotif('📋 Copied!', 'success');
    }).catch(function() {
        showNotif('Failed', 'error');
    });
}

function saveCurrentSetup() {
    if (!lastSetupSummary) {
        showNotif('⚠️ No setup to save - run a scan first', 'warning');
        return;
    }
    const recents = getRecents();
    if (recents.some(function(e) { return e.id === lastSetupSummary.id; })) {
        showNotif('💾 Already saved', 'info');
        return;
    }
    recents.unshift({ ...lastSetupSummary, out: lastSetupOut, savedAt: new Date().toISOString(), outcome: null });
    setRecents(recents);
    renderRecents();
    showNotif('💾 Saved to Recent', 'success');
}

// ============================================
// RECENTS & JOURNAL
// ============================================
const RECENT_KEY = 'ict_recent_saved';
const RECENT_CAP = 10;
const JOURNAL_KEY = 'ict_journal';
const JOURNAL_CAP = 30;

function getRecents() {
    try { const r = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(r) ? r : []; } catch (e) { return []; }
}

function setRecents(r) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, RECENT_CAP))); } catch (e) {}
}

function getJournal() {
    try { const j = JSON.parse(localStorage.getItem(JOURNAL_KEY)); return Array.isArray(j) ? j : []; } catch (e) { return []; }
}

function setJournal(j) {
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j.slice(0, JOURNAL_CAP))); } catch (e) {}
}

function renderRecents() {
    const list = document.getElementById('recentList');
    if (!list) return;
    const recents = getRecents();
    if (recents.length === 0) {
        list.innerHTML = '<span class="journal-empty">No saved setups — hit 💾 Save after a scan to keep one here</span>';
        return;
    }
    list.innerHTML = recents.map(function(e) {
        const when = e.savedAt ? new Date(e.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.outcome === 'WIN' ? { label: '✅ WIN', cls: 'win' } : (e.outcome === 'LOSS' ? { label: '❌ LOSS', cls: 'loss' } : { label: '💾 SAVED', cls: 'pending' });
        const prec = getPrec(e.pair || 'XAU/USD');
        return '<div class="journal-entry ' + badge.cls + '">' +
            '<div class="journal-head"><span>' + (e.sniper ? '🎯 ' : '') + e.pair + ' ' + e.direction + ' ' + e.timeframe + ' Q:' + e.quality + ' ' + e.confidence + '%</span><span>' + badge.label + '</span></div>' +
            '<div class="journal-levels">E $' + (+e.entry).toFixed(prec) + ' | SL $' + (+e.sl).toFixed(prec) + ' | TP $' + (+e.tp1).toFixed(prec) + ' | ' + when + '</div>' +
            '<div class="journal-actions">' +
            '<button class="jw-win" data-action="win" data-id="' + e.id + '">✅ Win</button>' +
            '<button class="jw-loss" data-action="loss" data-id="' + e.id + '">❌ Loss</button>' +
            '<button class="jw-journal" data-action="journal" data-id="' + e.id + '">📒 Journal</button>' +
            '<button class="jw-del" data-action="view" data-id="' + e.id + '">📋 View</button>' +
            '<button class="jw-del" data-action="del" data-id="' + e.id + '">🗑️</button>' +
            '</div></div>';
    }).join('');
}

function renderJournal() {
    const list = document.getElementById('journalList');
    const stats = document.getElementById('journalStats');
    if (!list) return;
    const journal = getJournal();
    if (stats) {
        const w = journal.filter(function(e) { return e.status === 'WIN'; }).length;
        const l = journal.filter(function(e) { return e.status === 'LOSS'; }).length;
        const wr = (w + l) > 0 ? ' | ' + (100 * w / (w + l)).toFixed(0) + '% WR' : '';
        stats.innerHTML = journal.length ? '✅' + w + ' ❌' + l + wr : '';
    }
    if (journal.length === 0) {
        list.innerHTML = '<span class="journal-empty">Journal is empty — mark a saved setup Win/Loss, then press 📒 Journal</span>';
        return;
    }
    list.innerHTML = journal.map(function(e) {
        const when = e.journaledAt ? new Date(e.journaledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.status === 'WIN' ? { label: '✅ WIN', cls: 'win' } : { label: '❌ LOSS', cls: 'loss' };
        const prec = getPrec(e.pair || 'XAU/USD');
        return '<div class="journal-entry ' + badge.cls + '">' +
            '<div class="journal-head"><span>' + (e.sniper ? '🎯 ' : '') + e.pair + ' ' + e.direction + ' ' + e.timeframe + ' Q:' + e.quality + ' ' + e.confidence + '%</span><span>' + badge.label + '</span></div>' +
            '<div class="journal-levels">E $' + (+e.entry).toFixed(prec) + ' | SL $' + (+e.sl).toFixed(prec) + ' | TP $' + (+e.tp1).toFixed(prec) + ' | ' + when + '</div>' +
            '<div class="journal-actions"><button class="jw-del" data-action="del" data-id="' + e.id + '">🗑️</button></div></div>';
    }).join('');
}

function handleRecentClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = +btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'win') markRecentOutcome(id, 'WIN');
    else if (action === 'loss') markRecentOutcome(id, 'LOSS');
    else if (action === 'journal') journalRecent(id);
    else if (action === 'view') viewRecent(id);
    else if (action === 'del') deleteRecent(id);
}

function handleJournalClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (btn && btn.dataset.action === 'del') deleteJournalEntry(+btn.dataset.id);
}

function markRecentOutcome(id, outcome) {
    const r = getRecents();
    const e = r.find(function(x) { return x.id === id; });
    if (e) { e.outcome = e.outcome === outcome ? null : outcome;
        setRecents(r);
        renderRecents(); }
}

function journalRecent(id) {
    const r = getRecents();
    const e = r.find(function(x) { return x.id === id; });
    if (!e) return;
    if (!e.outcome) { showNotif('⚠️ Mark ✅ Win or ❌ Loss first, then journal it', 'warning'); return; }
    const { out, outcome, ...rest } = e;
    const journal = getJournal();
    journal.unshift({ ...rest, status: outcome, journaledAt: new Date().toISOString() });
    setJournal(journal);
    setRecents(r.filter(function(x) { return x.id !== id; }));
    renderRecents();
    renderJournal();
    showNotif('📒 Journaled as ' + outcome, 'success');
}

function deleteRecent(id) {
    setRecents(getRecents().filter(function(x) { return x.id !== id; }));
    renderRecents();
    showNotif('🗑️ Saved setup deleted', 'warning');
}

function viewRecent(id) {
    const e = getRecents().find(function(x) { return x.id === id; });
    if (e?.out) { setJsonOutput(e.out);
        showNotif('📋 Loaded into view', 'info'); }
}

function deleteJournalEntry(id) {
    setJournal(getJournal().filter(function(x) { return x.id !== id; }));
    renderJournal();
    showNotif('🗑️ Journal entry deleted', 'warning');
}

// ============================================
// ASK AI
// ============================================
async function askAIWithAllResults(allResults, price, htfData) {
    if (!DEEPSEEK_API_KEY || allResults.length === 0) return null;
    showNotif('🤖 AI strict execution check...', 'info');
    try {
        const best = allResults[0];
        const prec = getPrec(pair);
        const dailyDir = await getQuoteDirection('1D', htfData['1D']);
        const h4Dir = await getQuoteDirection('4H', htfData['4H']);
        const htfConfluence = checkHTFConfluence(dailyDir, h4Dir, best.direction);

        const prompt = 'You are TheGhostMachine, a strict ICT execution auditor.\n' +
            'PAIR: XAU/USD | PRICE: $' + price.toFixed(prec) + '\n' +
            'HTF: 1D=' + dailyDir + ' 4H=' + h4Dir + ' | Confluence: ' + htfConfluence.level + '\n' +
            'SESSION: ' + (best.session?.session || 'OFF-HOURS') + ' | SilverBullet=' + (best.session?.isSilverBullet ? 'YES' : 'NO') + '\n' +
            'TOP SETUP (' + best.timeframe + '):\n' +
            'Direction: ' + best.direction + ' | Entry: $' + best.entry.toFixed(prec) + ' | SL: $' + best.sl.toFixed(prec) + ' | TP1: $' + best.tp1.toFixed(prec) + '\n' +
            'Score: ' + (best.finalScore || best.score || 0) + ' | HTF Align: ' + (best.htfAgree || 0) + '/3\n' +
            'Return JSON: { "approved": boolean, "confidence_adjustment": number }';

        const r = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'system', content: 'You are a strict ICT execution auditor. Return ONLY valid JSON.' }, { role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 500,
                response_format: { type: 'json_object' }
            })
        });
        const d = await r.json();
        const content = d.choices?.[0]?.message?.content;
        if (content) {
            try {
                const parsed = JSON.parse(content);
                return { trade_signal_Theghostmachine: parsed };
            } catch (e) {}
        }
    } catch (e) { console.error('AI error:', e); }
    return null;
}
