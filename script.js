// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// SECURE API KEY STORAGE
// ============================================
let TWELVE_DATA_KEY = '';
let DEEPSEEK_API_KEY = '';

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const TWELVE_DATA_SYMBOLS = {
    'BTC/USD': 'BTC/USD', 'ETH/USD': 'ETH/USD', 'BNB/USD': 'BNB/USD',
    'SOL/USD': 'SOL/USD', 'XRP/USD': 'XRP/USD', 'EUR/USD': 'EUR/USD',
    'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY', 'AUD/USD': 'AUD/USD',
    'USD/CAD': 'USD/CAD', 'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD',
    'XPT/USD': 'XPT/USD', 'XPD/USD': 'XPD/USD'
};

const TIMEFRAME_MAP = {
    '15M': '15min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week'
};

// ============================================
// LOAD/SAVE API KEYS
// ============================================
async function loadAPIKeys() {
    const saved = localStorage.getItem('ict_bot_keys');
    if (saved) {
        try {
            const keys = JSON.parse(saved);
            TWELVE_DATA_KEY = keys.twelveData || '';
            DEEPSEEK_API_KEY = keys.deepseek || '';
            console.log('✅ Keys loaded');
            return true;
        } catch(e) {}
    }
    return false;
}

async function saveAPIKeys(twelveKey, deepseekKey) {
    const keys = JSON.stringify({ twelveData: twelveKey, deepseek: deepseekKey });
    localStorage.setItem('ict_bot_keys', keys);
    TWELVE_DATA_KEY = twelveKey;
    DEEPSEEK_API_KEY = deepseekKey;
    showNotification('✅ API keys saved!', 'success');
    return true;
}

function showSetupModal() {
    const existing = document.getElementById('setupOverlay');
    if (existing) existing.remove();
    
    const setupHTML = `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API Key Setup</h3>
                <p class="setup-desc">Enter your API keys once.</p>
                <label>Twelve Data API Key:</label>
                <input type="password" id="twelveInput" placeholder="3076..." class="setup-input">
                <label>DeepSeek API Key (Optional):</label>
                <input type="password" id="deepseekInput" placeholder="sk-..." class="setup-input">
                <p class="setup-note">⚠️ Keys stored locally on your device.</p>
                <div class="setup-buttons">
                    <button id="saveKeysBtn" class="setup-btn primary">Save Keys</button>
                    <button id="skipSetupBtn" class="setup-btn secondary">Skip</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', setupHTML);
    
    document.getElementById('saveKeysBtn').addEventListener('click', async () => {
        const twelveKey = document.getElementById('twelveInput').value.trim();
        const deepseekKey = document.getElementById('deepseekInput').value.trim();
        if (!twelveKey) { showNotification('Twelve Data key required', 'warning'); return; }
        await saveAPIKeys(twelveKey, deepseekKey);
        document.getElementById('setupOverlay').remove();
    });
    
    document.getElementById('skipSetupBtn').addEventListener('click', () => {
        document.getElementById('setupOverlay').remove();
    });
}

// ============================================
// STATE
// ============================================
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let priceChart = null;
let chartData = [];
let allTimeframeData = {};
let pendingLimitOrder = null;
let priceCheckInterval = null;

document.addEventListener('DOMContentLoaded', async function() {
    const keysLoaded = await loadAPIKeys();
    if (!keysLoaded || !TWELVE_DATA_KEY) setTimeout(() => showSetupModal(), 300);
    init();
});

function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
    initChart();
    setupPositionCalculator();
    loadPendingOrder();
}

function updateLiveTime() {
    const now = new Date();
    document.getElementById('liveTime').innerHTML = 
        `${now.toLocaleDateString('en-US', {month:'short',day:'numeric'})} ${now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'})} UTC`;
}

function initChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: currentPair, data: [], borderColor: '#3390ec', borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } }, y: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } } } }
    });
}

function setupEventListeners() {
    document.getElementById('analyzeBtn')?.addEventListener('click', runAnalysis);
    document.getElementById('executeBtn')?.addEventListener('click', handleExecuteOrder);
    document.getElementById('cancelLimitBtn')?.addEventListener('click', cancelLimitOrder);
    document.getElementById('pairSelect')?.addEventListener('change', e => currentPair = e.target.value);
    document.querySelectorAll('.category-btn').forEach(btn => btn.addEventListener('click', function() {
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        updatePairsByCategory(this.dataset.category);
    }));
    document.querySelectorAll('.tf-btn').forEach(btn => btn.addEventListener('click', function() {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentTimeframe = this.dataset.tf;
        if (chartData.length) updateChart(chartData);
    }));
}

function setupPositionCalculator() {
    ['accountSize', 'riskPercent'].forEach(id => document.getElementById(id)?.addEventListener('input', calculatePositionSize));
}

function updatePairsByCategory(category) {
    const pairs = { crypto: ['BTC/USD','ETH/USD','BNB/USD','SOL/USD','XRP/USD'], forex: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD'], metals: ['XAU/USD','XAG/USD','XPT/USD','XPD/USD'] };
    const select = document.getElementById('pairSelect');
    if (select) { select.innerHTML = pairs[category].map(p => `<option value="${p}">${getPairDisplayName(p)}</option>`).join(''); currentPair = pairs[category][0]; }
}

function getPairDisplayName(pair) {
    const icons = { 'BTC/USD':'₿','ETH/USD':'⟠','EUR/USD':'€','GBP/USD':'£','XAU/USD':'👑','XAG/USD':'🥈','USD/JPY':'💴' };
    return `${icons[pair]||'📊'} ${pair}`;
}

function isForexPair(p) { return ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD'].includes(p); }
function isJPYPair(p) { return p.includes('JPY'); }
function getPricePrecision(p) { return isJPYPair(p) ? 3 : (isForexPair(p) ? 5 : 2); }

// ============================================
// API FUNCTIONS
// ============================================
async function getPrice() {
    if (!TWELVE_DATA_KEY) return null;
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.price) { apiCalls++; document.getElementById('apiUsage').innerHTML = apiCalls; document.getElementById('apiSource').innerHTML = '📡 Twelve Data'; return parseFloat(data.price); }
    } catch(e) {}
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
    if (!TWELVE_DATA_KEY) return null;
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    const interval = TIMEFRAME_MAP[timeframe];
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.values) {
            apiCalls++;
            return data.values.map(c => ({ time: c.datetime, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 1000000 })).reverse();
        }
    } catch(e) {}
    return null;
}

// ============================================
// TECHNICAL ANALYSIS
// ============================================
function calculateEMA(p, n) { const m = 2/(n+1); let e = [p[0]]; for(let i=1;i<p.length;i++) e.push((p[i]-e[i-1])*m+e[i-1]); return e; }
function calculateRSI(p, n=14) { let g=0,l=0; for(let i=p.length-n;i<p.length;i++){ let c=p[i]-p[i-1]; if(c>=0)g+=c; else l-=c; } let ag=g/n, al=l/n; return al===0?100:100-(100/(1+ag/al)); }
function calculateATR(d, n=14) { let t=[]; for(let i=1;i<d.length;i++) t.push(Math.max(d[i].high-d[i].low, Math.abs(d[i].high-d[i-1].close), Math.abs(d[i].low-d[i-1].close))); return t.slice(-n).reduce((a,b)=>a+b,0)/n; }

function findSwingPoints(d, lookback=3) {
    let highs = [], lows = [];
    let h = d.map(c => c.high), l = d.map(c => c.low);
    for(let i = lookback; i < h.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for(let j = 1; j <= lookback; j++) {
            if(h[i] <= h[i-j] || h[i] <= h[i+j]) isHigh = false;
            if(l[i] >= l[i-j] || l[i] >= l[i+j]) isLow = false;
        }
        if(isHigh) highs.push({ price: h[i], index: i, type: 'resistance' });
        if(isLow) lows.push({ price: l[i], index: i, type: 'support' });
    }
    return { highs, lows };
}

function detectFairValueGaps(d) { 
    let f=[]; 
    for(let i=1;i<d.length-1;i++){ 
        if(d[i-1].high<d[i+1].low&&d[i+1].low-d[i-1].high>d[i+1].close*0.001) f.push({type:'bullish', low: d[i-1].high, high: d[i+1].low}); 
        if(d[i-1].low>d[i+1].high&&d[i-1].low-d[i+1].high>d[i+1].close*0.001) f.push({type:'bearish', low: d[i+1].high, high: d[i-1].low}); 
    } 
    return f; 
}

function detectOrderBlocks(d) { 
    let o=[]; 
    for(let i=2;i<d.length-1;i++){ 
        if(d[i].close<d[i].open&&d[i+1].close>d[i+1].open&&d[i+1].close>d[i].high) o.push({type:'bullish', high: d[i].high, low: d[i].low}); 
        if(d[i].close>d[i].open&&d[i+1].close<d[i+1].open&&d[i+1].close<d[i].low) o.push({type:'bearish', high: d[i].high, low: d[i].low}); 
    } 
    return o; 
}

function calculateVolumeProfile(d) {
    if(!d?.length) return null;
    let maxP=Math.max(...d.map(c=>c.high)), minP=Math.min(...d.map(c=>c.low)), r=maxP-minP, ls=r/12;
    let levels=[]; for(let i=0;i<12;i++){ let lo=minP+i*ls; levels.push({low:lo,high:lo+ls,volume:0,price:(lo+lo+ls)/2}); }
    d.forEach(c=>{ levels.forEach(l=>{ if(c.high>=l.low&&c.low<=l.high){ let o=Math.min(c.high,l.high)-Math.max(c.low,l.low); l.volume+=c.volume*(o/(c.high-c.low)); } }); });
    let maxV=0, poc=null; levels.forEach(l=>{ if(l.volume>maxV){ maxV=l.volume; poc=l; } });
    let totalV=levels.reduce((s,l)=>s+l.volume,0), target=totalV*.7, acc=0, sorted=[...levels].sort((a,b)=>b.volume-a.volume), va=[];
    for(let l of sorted){ if(acc<target){ va.push(l); acc+=l.volume; } }
    let vaH=va.length?Math.max(...va.map(l=>l.high)):maxP, vaL=va.length?Math.min(...va.map(l=>l.low)):minP;
    return {poc, valueAreaHigh:vaH, valueAreaLow:vaL, totalVolume:totalV};
}

function calculateOrderFlow(d) {
    if(!d?.length) return null;
    let buy=0, sell=0;
    d.forEach(c=>{ let bull=c.close>c.open; if(bull){ buy+=c.volume*.7; sell+=c.volume*.3; } else { buy+=c.volume*.3; sell+=c.volume*.7; } });
    let pv=0, vol=0; d.forEach(c=>{ let tp=(c.high+c.low+c.close)/3; pv+=tp*c.volume; vol+=c.volume; });
    return { buyingPressure:buy, sellingPressure:sell, netDelta:buy-sell, vwap:pv/vol };
}

// ============================================
// PROFESSIONAL STOP LOSS CALCULATION
// ============================================
function calculateProfessionalStop(data, direction, entry) {
    const swings = findSwingPoints(data, 3);
    const atr = calculateATR(data, 14);
    
    if (direction === 'LONG') {
        const supportLevels = swings.lows
            .filter(s => s.price < entry)
            .sort((a, b) => b.price - a.price);
        
        const fvgs = detectFairValueGaps(data).filter(f => f.type === 'bullish');
        const obs = detectOrderBlocks(data).filter(o => o.type === 'bullish');
        
        let stopPrice = null;
        let stopReason = '';
        
        if (supportLevels.length > 0) {
            const nearestSupport = supportLevels[0];
            const buffer = isForexPair(currentPair) ? atr * 0.2 : entry * 0.001;
            stopPrice = nearestSupport.price - buffer;
            stopReason = `Below swing low at ${nearestSupport.price.toFixed(getPricePrecision(currentPair))}`;
        }
        
        if (!stopPrice && fvgs.length > 0) {
            const nearestFVG = fvgs.sort((a, b) => b.low - a.low)[0];
            if (nearestFVG.low < entry) {
                const buffer = isForexPair(currentPair) ? atr * 0.15 : entry * 0.0008;
                stopPrice = nearestFVG.low - buffer;
                stopReason = `Below FVG low at ${nearestFVG.low.toFixed(getPricePrecision(currentPair))}`;
            }
        }
        
        if (!stopPrice && obs.length > 0) {
            const nearestOB = obs.sort((a, b) => b.low - a.low)[0];
            if (nearestOB.low < entry) {
                const buffer = isForexPair(currentPair) ? atr * 0.15 : entry * 0.0008;
                stopPrice = nearestOB.low - buffer;
                stopReason = `Below Order Block low at ${nearestOB.low.toFixed(getPricePrecision(currentPair))}`;
            }
        }
        
        if (!stopPrice) {
            const maxStopPercent = isForexPair(currentPair) ? 0.005 : 0.015;
            const atrStop = entry - atr * 1.2;
            const percentStop = entry * (1 - maxStopPercent);
            stopPrice = Math.max(atrStop, percentStop);
            stopReason = `Technical stop (${((entry - stopPrice) / entry * 100).toFixed(2)}% from entry)`;
        }
        
        return { price: stopPrice, reason: stopReason };
        
    } else {
        const resistanceLevels = swings.highs
            .filter(s => s.price > entry)
            .sort((a, b) => a.price - b.price);
        
        const fvgs = detectFairValueGaps(data).filter(f => f.type === 'bearish');
        const obs = detectOrderBlocks(data).filter(o => o.type === 'bearish');
        
        let stopPrice = null;
        let stopReason = '';
        
        if (resistanceLevels.length > 0) {
            const nearestResistance = resistanceLevels[0];
            const buffer = isForexPair(currentPair) ? atr * 0.2 : entry * 0.001;
            stopPrice = nearestResistance.price + buffer;
            stopReason = `Above swing high at ${nearestResistance.price.toFixed(getPricePrecision(currentPair))}`;
        }
        
        if (!stopPrice && fvgs.length > 0) {
            const nearestFVG = fvgs.sort((a, b) => a.high - b.high)[0];
            if (nearestFVG.high > entry) {
                const buffer = isForexPair(currentPair) ? atr * 0.15 : entry * 0.0008;
                stopPrice = nearestFVG.high + buffer;
                stopReason = `Above FVG high at ${nearestFVG.high.toFixed(getPricePrecision(currentPair))}`;
            }
        }
        
        if (!stopPrice && obs.length > 0) {
            const nearestOB = obs.sort((a, b) => a.high - b.high)[0];
            if (nearestOB.high > entry) {
                const buffer = isForexPair(currentPair) ? atr * 0.15 : entry * 0.0008;
                stopPrice = nearestOB.high + buffer;
                stopReason = `Above Order Block high at ${nearestOB.high.toFixed(getPricePrecision(currentPair))}`;
            }
        }
        
        if (!stopPrice) {
            const maxStopPercent = isForexPair(currentPair) ? 0.005 : 0.015;
            const atrStop = entry + atr * 1.2;
            const percentStop = entry * (1 + maxStopPercent);
            stopPrice = Math.min(atrStop, percentStop);
            stopReason = `Technical stop (${((stopPrice - entry) / entry * 100).toFixed(2)}% from entry)`;
        }
        
        return { price: stopPrice, reason: stopReason };
    }
}

// ============================================
// TREND DETECTION
// ============================================
function detectTrend(data) {
    const closes = data.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const currentEMA20 = ema20[ema20.length - 1];
    const currentEMA50 = ema50[ema50.length - 1];
    const prevEMA20 = ema20[ema20.length - 5];
    
    if (currentEMA20 > currentEMA50 && currentEMA20 > prevEMA20) return 'BULLISH';
    if (currentEMA20 < currentEMA50 && currentEMA20 < prevEMA20) return 'BEARISH';
    return 'NEUTRAL';
}

async function checkTrendAlignment() {
    const tf1h = await getHistoricalData('1H');
    const tf4h = await getHistoricalData('4H');
    
    if (!tf1h || !tf4h) return { aligned: false, direction: 'NEUTRAL', tf1h: 'NEUTRAL', tf4h: 'NEUTRAL' };
    
    const trend1H = detectTrend(tf1h);
    const trend4H = detectTrend(tf4h);
    
    const aligned = (trend1H === 'BULLISH' && trend4H === 'BULLISH') || 
                    (trend1H === 'BEARISH' && trend4H === 'BEARISH');
    
    const direction = (trend1H === 'BULLISH' && trend4H === 'BULLISH') ? 'BULLISH' : 
                      (trend1H === 'BEARISH' && trend4H === 'BEARISH') ? 'BEARISH' : 'NEUTRAL';
    
    return { aligned, direction, tf1h: trend1H, tf4h: trend4H };
}

// ============================================
// MULTI-TIMEFRAME UI UPDATE (FIXED)
// ============================================
async function analyzeTimeframe(tf) {
    let d = await getHistoricalData(tf); 
    if(!d || d.length < 30) return null;
    let c = d.map(x => x.close);
    let rsi = calculateRSI(c);
    let trend = detectTrend(d);
    let volume = d.slice(-20).reduce((s, x) => s + x.volume, 0);
    return { data: d, trend, rsi, volume };
}

async function updateMultiTimeframeUI() {
    const timeframes = ['15M', '1H', '4H', '1D'];
    let bullishCount = 0, bearishCount = 0;
    
    for (let tf of timeframes) {
        const result = await analyzeTimeframe(tf);
        if (result) {
            if (result.trend === 'BULLISH') bullishCount++;
            else if (result.trend === 'BEARISH') bearishCount++;
            
            // Update trend display
            const trendEl = document.getElementById(`trend${tf}`);
            if (trendEl) {
                trendEl.innerHTML = result.trend === 'BULLISH' ? '🟢 Bullish' : 
                                   (result.trend === 'BEARISH' ? '🔴 Bearish' : '⚪ Neutral');
                trendEl.className = `mtf-trend ${result.trend.toLowerCase()}`;
            }
            
            // Update RSI display
            const rsiEl = document.getElementById(`rsi${tf}`);
            if (rsiEl) rsiEl.innerHTML = result.rsi.toFixed(1);
            
            // Update Volume display
            const volEl = document.getElementById(`vol${tf}`);
            if (volEl) volEl.innerHTML = (result.volume / 1000000).toFixed(1) + 'M';
        } else {
            // Set defaults if data fails
            const trendEl = document.getElementById(`trend${tf}`);
            if (trendEl) { trendEl.innerHTML = '⚪ --'; trendEl.className = 'mtf-trend neutral'; }
            const rsiEl = document.getElementById(`rsi${tf}`);
            if (rsiEl) rsiEl.innerHTML = '--';
            const volEl = document.getElementById(`vol${tf}`);
            if (volEl) volEl.innerHTML = '--';
        }
    }
    
    // Update confluence score
    const total = bullishCount + bearishCount;
    const confluenceScore = total > 0 ? Math.max(bullishCount, bearishCount) / total * 100 : 0;
    const direction = bullishCount > bearishCount ? 'Bullish' : (bearishCount > bullishCount ? 'Bearish' : 'Neutral');
    
    const scoreEl = document.getElementById('confluenceScore');
    if (scoreEl) scoreEl.innerHTML = `${direction} (${confluenceScore.toFixed(0)}% confluence)`;
}

// ============================================
// FIND OPTIMAL ENTRY ZONE
// ============================================
function findOptimalEntry(data, direction) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    const range = recentHigh - recentLow;
    
    let entryZone = null;
    
    if (direction === 'BULLISH') {
        const oteLow = recentLow + range * 0.618;
        const oteHigh = recentLow + range * 0.79;
        
        const fvgs = detectFairValueGaps(data).filter(f => f.type === 'bullish');
        const fvgInZone = fvgs.find(f => f.low >= oteLow && f.high <= oteHigh);
        
        const obs = detectOrderBlocks(data).filter(o => o.type === 'bullish');
        const obInZone = obs.find(o => o.low >= oteLow && o.high <= oteHigh);
        
        if (fvgInZone) {
            entryZone = {
                low: fvgInZone.low,
                high: fvgInZone.high,
                optimal: (fvgInZone.low + fvgInZone.high) / 2,
                source: 'FVG in OTE Zone'
            };
        } else if (obInZone) {
            entryZone = {
                low: obInZone.low,
                high: obInZone.high,
                optimal: (obInZone.low + obInZone.high) / 2,
                source: 'Order Block in OTE Zone'
            };
        } else {
            entryZone = {
                low: oteLow,
                high: oteHigh,
                optimal: (oteLow + oteHigh) / 2,
                source: 'OTE Zone (61.8%-79%)'
            };
        }
    } else {
        const oteLow = recentHigh - range * 0.79;
        const oteHigh = recentHigh - range * 0.618;
        
        const fvgs = detectFairValueGaps(data).filter(f => f.type === 'bearish');
        const fvgInZone = fvgs.find(f => f.low >= oteLow && f.high <= oteHigh);
        
        const obs = detectOrderBlocks(data).filter(o => o.type === 'bearish');
        const obInZone = obs.find(o => o.low >= oteLow && o.high <= oteHigh);
        
        if (fvgInZone) {
            entryZone = {
                low: fvgInZone.low,
                high: fvgInZone.high,
                optimal: (fvgInZone.low + fvgInZone.high) / 2,
                source: 'FVG in OTE Zone'
            };
        } else if (obInZone) {
            entryZone = {
                low: obInZone.low,
                high: obInZone.high,
                optimal: (obInZone.low + obInZone.high) / 2,
                source: 'Order Block in OTE Zone'
            };
        } else {
            entryZone = {
                low: oteLow,
                high: oteHigh,
                optimal: (oteLow + oteHigh) / 2,
                source: 'OTE Zone (61.8%-79%)'
            };
        }
    }
    
    return entryZone;
}

// ============================================
// DEEPSEEK AI
// ============================================
async function getAIAnalysis(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotification('🤖 DeepSeek AI analyzing...', 'info');
    
    const prompt = `You are a professional institutional trader. Analyze this setup.

CRITICAL RULES:
1. ONLY trade if 1H AND 4H trends are BOTH aligned (${marketData.trendAligned ? '✅ THEY ARE' : '❌ THEY ARE NOT'}).
2. Entry must be at a LOGICAL demand/supply zone.
3. Stop loss must be placed JUST BEYOND the nearest significant swing point.
4. We wait PATIENTLY with limit orders.

Current: ${currentPair} | Price: ${marketData.currentPrice}
1H: ${marketData.trend1H} | 4H: ${marketData.trend4H}
Entry Zone: ${marketData.entryZoneSource} | ${marketData.entryZoneLow} - ${marketData.entryZoneHigh}
Optimal Entry: ${marketData.entryZoneOptimal}
RSI: ${marketData.rsi} | ATR: ${marketData.atr}
Nearest Support: ${marketData.nearestSupport}
Nearest Resistance: ${marketData.nearestResistance}

Return ONLY valid JSON:
{
    "signal": "LONG" or "SHORT" or "NEUTRAL",
    "confidence": 0-100,
    "idealEntry": number,
    "stopLoss": number,
    "takeProfit1": number,
    "takeProfit2": number,
    "takeProfit3": number,
    "reasoning": "Brief analysis"
}`;

    try {
        const res = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: 'You are a professional trader. Return ONLY valid JSON.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 800 })
        });
        const data = await res.json();
        if (data.choices?.[0]) {
            const match = data.choices[0].message.content.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        }
    } catch(e) { console.error('AI error:', e); }
    return null;
}

// ============================================
// MAIN ANALYSIS
// ============================================
async function runAnalysis() {
    const btn = document.getElementById('analyzeBtn');
    btn.classList.add('loading'); btn.disabled = true;
    
    if (!TWELVE_DATA_KEY) { showSetupModal(); btn.classList.remove('loading'); btn.disabled = false; return; }
    
    showNotification('🔍 Checking trend alignment...', 'info');
    
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        
        // Update multi-timeframe UI FIRST
        await updateMultiTimeframeUI();
        
        // Check trend alignment
        const trendCheck = await checkTrendAlignment();
        
        if (!trendCheck.aligned) {
            showNotification(`❌ 1H=${trendCheck.tf1h} | 4H=${trendCheck.tf4h} - Trends NOT aligned!`, 'warning');
            document.getElementById('signalTypeText').innerHTML = 'NEUTRAL';
            document.getElementById('signalTypeBox').className = 'signal-type-box neutral';
            document.getElementById('confidenceText').innerHTML = '0%';
            document.getElementById('signalReason').innerHTML = `⛔ NO TRADE: 1H (${trendCheck.tf1h}) and 4H (${trendCheck.tf4h}) must be aligned.`;
            document.getElementById('executeBtn').disabled = true;
            btn.classList.remove('loading'); btn.disabled = false;
            return;
        }
        
        showNotification(`✅ Trends Aligned: 1H=${trendCheck.tf1h} | 4H=${trendCheck.tf4h} - ${trendCheck.direction}`, 'success');
        
        const hist = await getHistoricalData(); if (!hist?.length) throw new Error('No history');
        chartData = hist; allTimeframeData[currentTimeframe] = hist;
        
        const closes = hist.map(c=>c.close), highs = hist.map(c=>c.high), lows = hist.map(c=>c.low);
        const rsi = calculateRSI(closes), atr = calculateATR(hist);
        const swings = findSwingPoints(hist, 3);
        const fvgs = detectFairValueGaps(hist), obs = detectOrderBlocks(hist);
        const vp = calculateVolumeProfile(hist);
        const of = calculateOrderFlow(hist);
        
        const entryZone = findOptimalEntry(hist, trendCheck.direction);
        const stopResult = calculateProfessionalStop(hist, trendCheck.direction, entryZone.optimal);
        
        const nearestSupport = swings.lows.filter(s => s.price < price).sort((a,b) => b.price - a.price)[0];
        const nearestResistance = swings.highs.filter(s => s.price > price).sort((a,b) => a.price - b.price)[0];
        
        const recentHigh = Math.max(...highs.slice(-20)), recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        const fibs = { fib0:recentLow, fib236:recentLow+range*.236, fib382:recentLow+range*.382, fib500:recentLow+range*.5, fib618:recentLow+range*.618, fib786:recentLow+range*.786, fib100:recentHigh };
        
        const marketData = {
            currentPrice: price.toFixed(getPricePrecision(currentPair)),
            rsi: rsi.toFixed(1), atr: atr.toFixed(getPricePrecision(currentPair)),
            trendAligned: trendCheck.aligned,
            trendDirection: trendCheck.direction,
            trend1H: trendCheck.tf1h,
            trend4H: trendCheck.tf4h,
            entryZoneSource: entryZone.source,
            entryZoneLow: entryZone.low.toFixed(getPricePrecision(currentPair)),
            entryZoneHigh: entryZone.high.toFixed(getPricePrecision(currentPair)),
            entryZoneOptimal: entryZone.optimal.toFixed(getPricePrecision(currentPair)),
            nearestSupport: nearestSupport ? `$${nearestSupport.price.toFixed(getPricePrecision(currentPair))}` : 'None',
            nearestResistance: nearestResistance ? `$${nearestResistance.price.toFixed(getPricePrecision(currentPair))}` : 'None'
        };
        
        let signal, confidence, entry, sl, tp1, tp2, tp3, reason;
        
        const ai = await getAIAnalysis(marketData);
        
        if (ai && ai.signal !== 'NEUTRAL' && (ai.signal === 'LONG' || ai.signal === 'SHORT')) {
            signal = ai.signal; 
            confidence = ai.confidence; 
            entry = ai.idealEntry || entryZone.optimal;
            sl = ai.stopLoss;
            tp1 = ai.takeProfit1;
            tp2 = ai.takeProfit2;
            tp3 = ai.takeProfit3;
            reason = ai.reasoning;
            showNotification(`✅ AI Signal: ${signal} (${confidence}%)`, 'success');
        } else {
            signal = trendCheck.direction === 'BULLISH' ? 'LONG' : 'SHORT';
            confidence = 50;
            entry = price;
            sl = entry - atr * 0.5;
            tp1 = entry + risk * 1.5;
            tp2 = entry + risk * 2.5;
            tp3 = entry + risk * 4;
            reason = `Rule-based OTE entry`;
        }
        
        updatePriceDisplay(price);
        updateSignalDisplay(signal, confidence, entry, sl, tp1, tp2, tp3, reason);
        updateVolumeProfileDisplay(vp);
        updateOrderFlowDisplay(of);
        updateICTDisplay(fvgs, obs, liquidity, structure);
        updateFibDisplay(fibs);
        
        const shouldExecute = signal !== 'NEUTRAL' && confidence >= 55;
        document.getElementById('executeBtn').disabled = !shouldExecute;
        
        analysisData = { 
            signalType, idealEntry, currentPrice, stopLoss, 
            takeProfit1, takeProfit2, takeProfit3, confidence 
        };
        
        calculatePositionSize();
        
        showNotification(`✅ Analysis complete! ${signal} signal with ${confidence}% confidence`, 'success');
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

function updatePriceDisplay(currentPrice) {
    const precision = getPricePrecision(currentPair);
    document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(precision)}`;
}

function updateSignalDisplay(signal, confidence, entry, sl, tp1, tp2, tp3, reason) {
    const badge = document.getElementById('signalBadge');
    if (confidence >= 70) {
        badge.innerHTML = '🔥 HIGH CONFIDENCE';
        badge.className = 'signal-badge high';
    } else if (confidence >= 55) {
        badge.innerHTML = '📊 MEDIUM CONFIDENCE';
        badge.className = 'signal-badge medium';
    } else {
        badge.innerHTML = '⚠️ LOW CONFIDENCE';
        badge.className = 'signal-badge low';
    }
}

function updateVolumeProfileDisplay(vp) {
    if (!vp) return;
    document.getElementById('pocValue').innerHTML = `$${vp.poc?.price.toFixed(2) || '--'}`;
    document.getElementById('valueHigh').innerHTML = `$${vp.valueAreaHigh?.toFixed(2) || '--'}`;
    document.getElementById('valueLow').innerHTML = `$${vp.valueAreaLow?.toFixed(2) || '--'}`;
    document.getElementById('totalVolume').innerHTML = `${(vp.totalVolume / 1000000).toFixed(1)}M`;
}

function updateOrderFlowDisplay(of) {
    if (!of) return;
    document.getElementById('buyingPressure').innerHTML = `${(of.buyingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('sellingPressure').innerHTML = `${(of.sellingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('netDelta').innerHTML = `${(of.netDelta / 1000000).toFixed(1)}M`;
    document.getElementById('vwapValue').innerHTML = `$${of.vwap.toFixed(2)}`;
}

function updateICTDisplay(ict) {
    if (!ict) return;
    document.getElementById('fvgCount').innerHTML = ict.fvgs.length;
    document.getElementById('obCount').innerHTML = ict.obs.length;
    document.getElementById('liquidityLevels').innerHTML = ict.liquidity.length;
}

function updateFibDisplay(fibs) {
    if (!fibs) return;
    document.getElementById('fib0').innerHTML = `$${fibs.fib0.toFixed(2)}`;
    document.getElementById('fib236').innerHTML = `$${fibs.fib236.toFixed(2)}`;
    document.getElementById('fib382').innerHTML = `$${fibs.fib382.toFixed(2)}`;
    document.getElementById('fib500').innerHTML = `$${fibs.fib500.toFixed(2)}`;
    document.getElementById('fib618').innerHTML = `$${fibs.fib618.toFixed(2)}`;
    document.getElementById('fib786').innerHTML = `$${fibs.fib786.toFixed(2)}`;
    document.getElementById('fib100').innerHTML = `$${fibs.fib100.toFixed(2)}`;
}

// ============================================
// LIMIT ORDER MANAGEMENT
// ============================================

function loadPendingOrder() {
    const saved = localStorage.getItem('pendingLimitOrder');
    if (saved) {
        try {
            pendingLimitOrder = JSON.parse(saved);
            updateLimitOrderUI();
        } catch(e) {
            console.error('Failed to load pending order:', e);
        }
    }
}

function savePendingOrder(order) {
    localStorage.setItem('pendingLimitOrder', JSON.stringify(order));
}

function updateLimitOrderUI() {
    const order = document.getElementById('limitOrderStatus');
    if (order) {
        order.classList.remove('hidden');
        order.innerHTML = '⏳ Waiting for entry...';
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) {
        clearInterval(priceCheckInterval);
        priceCheckInterval = setInterval(async () => {
            const price = await getPrice();
            if (price) {
                document.getElementById('currentPrice').innerHTML = `$${price.toFixed(2)}`;
            }
        }, 5000);
    }
}

function handleExecuteOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    const order = document.getElementById('executeBtn');
    if (order) {
        order.disabled = !shouldExecute;
        order.innerHTML = '⚡ Execute Order';
    }
}

function executeLimitOrder(order) {
    if (!order) return;
    const limitOrder = {
        id: Date.now(),
        pair: currentPair,
        signal: analysisData.signalType,
        idealEntry: analysisData.idealEntry,
        currentPrice: analysisData.currentPrice,
        stopLoss: analysisData.stopLoss,
        takeProfit1: analysisData.takeProfit1,
        takeProfit2: analysisData.takeProfit2,
        takeProfit3: analysisData.takeProfit3,
        confidence: analysisData.confidence
    };
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'execute_order',
            pair: currentPair,
            signal: analysisData.signalType,
            idealEntry: analysisData.idealEntry,
            currentPrice: analysisData.currentPrice,
            stopLoss: analysisData.stopLoss,
            takeProfits: [analysisData.takeProfit1, analysisData.takeProfit2, analysisData.takeProfit3],
            confidence: analysisData.confidence,
            timestamp: new Date().toISOString()
        }));
    }
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.innerHTML = message;
    notification.className = type;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}

// ============================================
// END OF ICT TRADING BOT PRO SCRIPT
// ============================================
