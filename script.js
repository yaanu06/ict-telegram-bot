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
    '5M': '5min', '15M': '15min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week'
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
let currentPair = 'XAU/USD';
let currentTimeframe = '15M';
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
    const pairs = { crypto: ['BTC/USD','ETH/USD'], forex: ['EUR/USD','GBP/USD'], metals: ['XAU/USD','XAG/USD'] };
    const select = document.getElementById('pairSelect');
    if (select) { select.innerHTML = pairs[category].map(p => `<option value="${p}">${getPairDisplayName(p)}</option>`).join(''); currentPair = pairs[category][0]; }
}

function getPairDisplayName(pair) {
    const icons = { 'BTC/USD':'₿','ETH/USD':'⟠','EUR/USD':'€','GBP/USD':'£','XAU/USD':'👑','XAG/USD':'🥈' };
    return `${icons[pair]||'📊'} ${pair}`;
}

function isForexPair(p) { return ['EUR/USD','GBP/USD','USD/JPY'].includes(p); }
function isJPYPair(p) { return p.includes('JPY'); }
function isGold(p) { return p.includes('XAU'); }
function getPricePrecision(p) { 
    if (isJPYPair(p)) return 3;
    if (isGold(p)) return 2;
    if (isForexPair(p)) return 5;
    return 2;
}

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
    const interval = TIMEFRAME_MAP[timeframe] || '15min';
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=200&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.values) {
            apiCalls++;
            return data.values.map(c => ({ time: c.datetime, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 1000000 })).reverse();
        }
    } catch(e) {}
    return null;
}

// ============================================
// TECHNICAL ANALYSIS - ICT CONCEPTS
// ============================================
function calculateEMA(p, n) { const m = 2/(n+1); let e = [p[0]]; for(let i=1;i<p.length;i++) e.push((p[i]-e[i-1])*m+e[i-1]); return e; }
function calculateRSI(p, n=14) { let g=0,l=0; for(let i=p.length-n;i<p.length;i++){ let c=p[i]-p[i-1]; if(c>=0)g+=c; else l-=c; } let ag=g/n, al=l/n; return al===0?100:100-(100/(1+ag/al)); }
function calculateATR(d, n=14) { let t=[]; for(let i=1;i<d.length;i++) t.push(Math.max(d[i].high-d[i].low, Math.abs(d[i].high-d[i-1].close), Math.abs(d[i].low-d[i-1].close))); return t.slice(-n).reduce((a,b)=>a+b,0)/n; }

// Market Structure Shift (MSS) - Key for reversals
function detectMSS(data) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const closes = data.map(c => c.close);
    
    // Find recent swing high and swing low
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    const currentPrice = closes[closes.length - 1];
    
    // Bullish MSS: Price breaks above recent swing high
    if (currentPrice > recentHigh) {
        return { type: 'BULLISH', level: recentHigh, message: 'MSS confirmed - Transition from bear to bull' };
    }
    
    // Bearish MSS: Price breaks below recent swing low
    if (currentPrice < recentLow) {
        return { type: 'BEARISH', level: recentLow, message: 'MSS confirmed - Transition from bull to bear' };
    }
    
    return null;
}

// Fair Value Gaps (FVG) - The ghost machine's favorite
function detectFVGs(data) {
    const fvgs = [];
    for(let i = 1; i < data.length - 1; i++) {
        // Bullish FVG (price gaps up)
        if (data[i-1].high < data[i+1].low && (data[i+1].low - data[i-1].high) > data[i+1].close * 0.001) {
            fvgs.push({
                type: 'BULLISH',
                low: data[i-1].high,
                high: data[i+1].low,
                mid: (data[i-1].high + data[i+1].low) / 2,
                index: i,
                mitigated: false
            });
        }
        // Bearish FVG (price gaps down)
        if (data[i-1].low > data[i+1].high && (data[i-1].low - data[i+1].high) > data[i+1].close * 0.001) {
            fvgs.push({
                type: 'BEARISH',
                low: data[i+1].high,
                high: data[i-1].low,
                mid: (data[i+1].high + data[i-1].low) / 2,
                index: i,
                mitigated: false
            });
        }
    }
    return fvgs;
}

// Breaker Blocks - Key for reversals after MSS
function detectBreakerBlocks(data) {
    const blocks = [];
    const swings = findSwingPoints(data);
    
    for (let i = 5; i < data.length - 5; i++) {
        const candle = data[i];
        
        // Bullish Breaker (failed resistance becomes support)
        if (candle.close > candle.open) {
            const prevResistance = swings.highs.find(h => h.index < i && h.price < candle.close);
            if (prevResistance) {
                blocks.push({
                    type: 'BULLISH',
                    low: prevResistance.price - 5,
                    high: prevResistance.price + 5,
                    price: prevResistance.price,
                    message: 'Breaker block - Failed resistance becomes support'
                });
            }
        }
        
        // Bearish Breaker (failed support becomes resistance)
        if (candle.close < candle.open) {
            const prevSupport = swings.lows.find(l => l.index < i && l.price > candle.close);
            if (prevSupport) {
                blocks.push({
                    type: 'BEARISH',
                    low: prevSupport.price - 5,
                    high: prevSupport.price + 5,
                    price: prevSupport.price,
                    message: 'Breaker block - Failed support becomes resistance'
                });
            }
        }
    }
    return blocks;
}

function findSwingPoints(data, lookback = 3) {
    const highs = [], lows = [];
    const h = data.map(c => c.high), l = data.map(c => c.low);
    
    for(let i = lookback; i < h.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for(let j = 1; j <= lookback; j++) {
            if(h[i] <= h[i-j] || h[i] <= h[i+j]) isHigh = false;
            if(l[i] >= l[i-j] || l[i] >= l[i+j]) isLow = false;
        }
        if(isHigh) highs.push({ price: h[i], index: i });
        if(isLow) lows.push({ price: l[i], index: i });
    }
    return { highs, lows };
}

// Find unmitigated FVGs (the ones price hasn't filled yet)
function findUnmitigatedFVGs(data, direction) {
    const fvgs = detectFVGs(data);
    const currentPrice = data[data.length - 1].close;
    
    if (direction === 'BUY') {
        // For buys: look for bullish FVGs BELOW current price (support)
        return fvgs.filter(f => f.type === 'BULLISH' && f.low < currentPrice)
                  .sort((a, b) => b.low - a.low);
    } else {
        // For sells: look for bearish FVGs ABOVE current price (resistance)
        return fvgs.filter(f => f.type === 'BEARISH' && f.high > currentPrice)
                  .sort((a, b) => a.high - b.high);
    }
}

// Find optimal limit entry (like the ghost machine)
function findOptimalLimitEntry(data, direction) {
    const currentPrice = data[data.length - 1].close;
    const atr = calculateATR(data, 14);
    const fvgs = findUnmitigatedFVGs(data, direction);
    const swings = findSwingPoints(data);
    const blocks = detectBreakerBlocks(data);
    
    let entryZone = null;
    
    if (direction === 'BUY') {
        // Priority 1: Bullish FVG below price
        if (fvgs.length > 0) {
            const bestFVG = fvgs[0];
            entryZone = {
                price: bestFVG.mid,
                low: bestFVG.low,
                high: bestFVG.high,
                source: 'FVG',
                reason: `Bullish FVG at ${bestFVG.low.toFixed(2)}-${bestFVG.high.toFixed(2)}`
            };
        }
        
        // Priority 2: Breaker block
        if (!entryZone) {
            const bullishBlocks = blocks.filter(b => b.type === 'BULLISH' && b.price < currentPrice);
            if (bullishBlocks.length > 0) {
                const bestBlock = bullishBlocks.sort((a, b) => b.price - a.price)[0];
                entryZone = {
                    price: bestBlock.price,
                    low: bestBlock.low,
                    high: bestBlock.high,
                    source: 'Breaker',
                    reason: bestBlock.message
                };
            }
        }
        
        // Priority 3: OTE zone (61.8%-79% fib)
        if (!entryZone) {
            const recentLow = Math.min(...data.slice(-20).map(c => c.low));
            const recentHigh = Math.max(...data.slice(-20).map(c => c.high));
            const range = recentHigh - recentLow;
            entryZone = {
                price: recentLow + range * 0.7,
                low: recentLow + range * 0.618,
                high: recentLow + range * 0.79,
                source: 'OTE',
                reason: 'OTE Zone (61.8%-79% retracement)'
            };
        }
    } else {
        // Priority 1: Bearish FVG above price
        if (fvgs.length > 0) {
            const bestFVG = fvgs[0];
            entryZone = {
                price: bestFVG.mid,
                low: bestFVG.low,
                high: bestFVG.high,
                source: 'FVG',
                reason: `Bearish FVG at ${bestFVG.low.toFixed(2)}-${bestFVG.high.toFixed(2)}`
            };
        }
        
        // Priority 2: Breaker block
        if (!entryZone) {
            const bearishBlocks = blocks.filter(b => b.type === 'BEARISH' && b.price > currentPrice);
            if (bearishBlocks.length > 0) {
                const bestBlock = bearishBlocks.sort((a, b) => a.price - b.price)[0];
                entryZone = {
                    price: bestBlock.price,
                    low: bestBlock.low,
                    high: bestBlock.high,
                    source: 'Breaker',
                    reason: bestBlock.message
                };
            }
        }
        
        // Priority 3: OTE zone
        if (!entryZone) {
            const recentLow = Math.min(...data.slice(-20).map(c => c.low));
            const recentHigh = Math.max(...data.slice(-20).map(c => c.high));
            const range = recentHigh - recentLow;
            entryZone = {
                price: recentHigh - range * 0.3,
                low: recentHigh - range * 0.382,
                high: recentHigh - range * 0.5,
                source: 'OTE',
                reason: 'OTE Zone for shorts'
            };
        }
    }
    
    return entryZone;
}

// Calculate tight stop loss (3-4 pips on gold like ghost machine)
function calculateTightStop(entryPrice, direction, entryZone, atr) {
    if (direction === 'BUY') {
        // For buys: stop just below the zone low
        const buffer = isGold(currentPair) ? 3 : atr * 0.3;
        return entryZone.low - buffer;
    } else {
        // For sells: stop just above the zone high
        const buffer = isGold(currentPair) ? 3 : atr * 0.3;
        return entryZone.high + buffer;
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
    
    if (currentEMA20 > currentEMA50) return 'BULLISH';
    if (currentEMA20 < currentEMA50) return 'BEARISH';
    return 'NEUTRAL';
}

// ============================================
// MULTI-TIMEFRAME UI UPDATE
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
    const timeframes = ['5M', '15M', '1H', '4H'];
    let bullishCount = 0, bearishCount = 0;
    
    for (let tf of timeframes) {
        const result = await analyzeTimeframe(tf);
        if (result) {
            if (result.trend === 'BULLISH') bullishCount++;
            else if (result.trend === 'BEARISH') bearishCount++;
            
            const trendEl = document.getElementById(`trend${tf}`);
            if (trendEl) {
                trendEl.innerHTML = result.trend === 'BULLISH' ? '🟢 Bullish' : 
                                   (result.trend === 'BEARISH' ? '🔴 Bearish' : '⚪ Neutral');
                trendEl.className = `mtf-trend ${result.trend.toLowerCase()}`;
            }
            
            const rsiEl = document.getElementById(`rsi${tf}`);
            if (rsiEl) rsiEl.innerHTML = result.rsi.toFixed(1);
            
            const volEl = document.getElementById(`vol${tf}`);
            if (volEl) volEl.innerHTML = (result.volume / 1000000).toFixed(1) + 'M';
        }
    }
    
    const total = bullishCount + bearishCount;
    const confluenceScore = total > 0 ? Math.max(bullishCount, bearishCount) / total * 100 : 0;
    const direction = bullishCount > bearishCount ? 'Bullish' : (bearishCount > bullishCount ? 'Bearish' : 'Neutral');
    
    const scoreEl = document.getElementById('confluenceScore');
    if (scoreEl) scoreEl.innerHTML = `${direction} (${confluenceScore.toFixed(0)}% confluence)`;
}

// ============================================
// DEEPSEEK AI - GHOST MACHINE STYLE
// ============================================
async function getAIAnalysis(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotification('🤖 AI analyzing FVGs & structure...', 'info');
    
    const prompt = `You are Theghostmachine - an elite ICT/Smart Money trader. Find the BEST limit order setup.

Current: ${currentPair} | ${currentTimeframe} | Price: ${marketData.currentPrice}

KEY LEVELS:
- MSS: ${marketData.mss || 'None'}
- Nearest FVG: ${marketData.fvgZone || 'None'}
- Breaker Block: ${marketData.breakerBlock || 'None'}
- OTE Zone: ${marketData.oteZone || 'None'}

Trend: ${marketData.trend} | RSI: ${marketData.rsi} | ATR: ${marketData.atr}

INSTRUCTIONS:
1. Find ONE high-probability limit order entry
2. Entry MUST be at a FVG, Breaker Block, or OTE zone
3. Stop loss MUST be TIGHT (3-5 pips on gold, 10-15 pips on forex)
4. Take profit at opposing liquidity or next FVG

Return JSON:
{
    "signal": "BUY" or "SELL" or "NEUTRAL",
    "confidence": 0-100,
    "entryPrice": number,
    "stopLoss": number,
    "takeProfit": number,
    "entrySource": "FVG" or "Breaker" or "OTE",
    "reasoning": "Brief analysis like Theghostmachine"
}`;

    try {
        const res = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: 'You are Theghostmachine - ICT elite trader. Return ONLY valid JSON.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 600 })
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
    
    showNotification('🔍 Scanning FVGs & structure...', 'info');
    
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        
        // Update multi-timeframe UI
        await updateMultiTimeframeUI();
        
        // Get data for 15M (primary) and 1H (context)
        const hist15 = await getHistoricalData('15M');
        const hist1H = await getHistoricalData('1H');
        if (!hist15?.length) throw new Error('No data');
        
        chartData = hist15;
        
        const closes = hist15.map(c => c.close);
        const rsi = calculateRSI(closes);
        const atr = calculateATR(hist15, 14);
        const trend = detectTrend(hist1H || hist15); // Use 1H for trend context
        const mss = detectMSS(hist15);
        
        // Determine direction from MSS or trend
        let direction;
        if (mss?.type === 'BULLISH') direction = 'BUY';
        else if (mss?.type === 'BEARISH') direction = 'SELL';
        else direction = trend === 'BULLISH' ? 'BUY' : 'SELL';
        
        // Find optimal entry zone
        const entryZone = findOptimalLimitEntry(hist15, direction);
        
        if (!entryZone) {
            showNotification('No clear entry zone found', 'warning');
            btn.classList.remove('loading'); btn.disabled = false;
            return;
        }
        
        // Calculate tight stop
        const stopLoss = calculateTightStop(entryZone.price, direction, entryZone, atr);
        
        // Get FVG info for AI
        const fvgs = detectFVGs(hist15);
        const unmitigatedFVG = findUnmitigatedFVGs(hist15, direction)[0];
        const blocks = detectBreakerBlocks(hist15);
        const relevantBlock = blocks.find(b => b.type === (direction === 'BUY' ? 'BULLISH' : 'BEARISH'));
        
        const marketData = {
            currentPrice: price.toFixed(2),
            rsi: rsi.toFixed(1),
            atr: atr.toFixed(2),
            trend: trend,
            mss: mss?.message || 'None',
            fvgZone: unmitigatedFVG ? `${unmitigatedFVG.low.toFixed(2)}-${unmitigatedFVG.high.toFixed(2)}` : 'None',
            breakerBlock: relevantBlock?.message || 'None',
            oteZone: entryZone.source === 'OTE' ? entryZone.reason : 'None'
        };
        
        // Get AI analysis
        const ai = await getAIAnalysis(marketData);
        
        let signal, confidence, entry, sl, tp, reason;
        
        if (ai && ai.signal !== 'NEUTRAL') {
            signal = ai.signal;
            confidence = ai.confidence;
            entry = ai.entryPrice || entryZone.price;
            sl = ai.stopLoss || stopLoss;
            tp = ai.takeProfit;
            reason = ai.reasoning;
            showNotification(`✅ ${signal} signal (${confidence}%)`, 'success');
        } else {
            signal = direction;
            confidence = 65;
            entry = entryZone.price;
            sl = stopLoss;
            
            // Calculate TP based on risk
            const risk = Math.abs(entry - sl);
            tp = signal === 'BUY' ? entry + risk * 3 : entry - risk * 3;
            reason = `${entryZone.source} entry: ${entryZone.reason}`;
        }
        
        // Update UI
        const prec = getPricePrecision(currentPair);
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(prec)}`;
        
        const signalType = signal === 'BUY' ? 'LONG' : 'SHORT';
        document.getElementById('signalTypeText').innerHTML = signalType;
        document.getElementById('signalTypeBox').className = `signal-type-box ${signalType.toLowerCase()}`;
        document.getElementById('confidenceText').innerHTML = `${confidence}%`;
        document.getElementById('idealEntryDisplay').innerHTML = `$${entry.toFixed(prec)}`;
        document.getElementById('entryPrice').innerHTML = `$${price.toFixed(prec)}`;
        
        const distance = entry - price;
        const distPercent = (Math.abs(distance)/price*100).toFixed(2);
        const distEl = document.getElementById('distanceToEntry');
        distEl.innerHTML = `${distance>0?'▼':'▲'} $${Math.abs(distance).toFixed(prec)} (${distPercent}%)`;
        distEl.style.color = (signal==='BUY'&&distance>0)||(signal==='SELL'&&distance<0) ? '#34c759' : '#ff3b30';
        
        document.getElementById('stopLoss').innerHTML = `$${sl.toFixed(prec)}`;
        document.getElementById('takeProfit1').innerHTML = `$${tp.toFixed(prec)}`;
        document.getElementById('takeProfit2').innerHTML = '--';
        document.getElementById('takeProfit3').innerHTML = '--';
        
        const rrValue = Math.abs(tp-entry)/Math.abs(entry-sl);
        document.getElementById('riskReward').innerHTML = rrValue.toFixed(1);
        
        const badge = document.getElementById('signalBadge');
        if (confidence>=70) { badge.innerHTML='🔥 HIGH CONFIDENCE'; badge.className='signal-badge high'; }
        else if (confidence>=55) { badge.innerHTML='📊 MEDIUM CONFIDENCE'; badge.className='signal-badge medium'; }
        else { badge.innerHTML='⚠️ LOW CONFIDENCE'; badge.className='signal-badge low'; }
        
        document.getElementById('signalReason').innerHTML = `🤖 ${reason}`;
        
        // Update FVG/ICT counts
        document.getElementById('fvgCount').innerHTML = fvgs.length;
        document.getElementById('obCount').innerHTML = blocks.length;
        document.getElementById('liquidityLevels').innerHTML = '-';
        document.getElementById('marketStructure').innerHTML = mss ? 'MSS Detected' : trend;
        
        updateChart(hist15);
        
        analysisData = { 
            signalType: signalType, 
            idealEntry: entry, 
            currentPrice: price, 
            stopLoss: sl, 
            takeProfit1: tp,
            takeProfit2: 0,
            takeProfit3: 0,
            confidence 
        };
        
        calculatePositionSize();
        document.getElementById('executeBtn').disabled = false;
        
    } catch(e) { 
        console.error(e); 
        showNotification('Error: '+e.message, 'error'); 
    } finally { 
        btn.classList.remove('loading'); 
        btn.disabled = false; 
    }
}

// ============================================
// LIMIT ORDERS
// ============================================
function loadPendingOrder() {
    const saved = localStorage.getItem('pendingLimitOrder');
    if (saved) { try { pendingLimitOrder = JSON.parse(saved); updateLimitOrderUI(); startPriceMonitoring(); } catch(e) {} }
}

function savePendingOrder(o) { pendingLimitOrder = o; localStorage.setItem('pendingLimitOrder', JSON.stringify(o)); updateLimitOrderUI(); }
function clearPendingOrder() { pendingLimitOrder = null; localStorage.removeItem('pendingLimitOrder'); if(priceCheckInterval) clearInterval(priceCheckInterval); updateLimitOrderUI(); }

function cancelLimitOrder() { clearPendingOrder(); showNotification('❌ Limit order cancelled', 'warning'); }

function updateLimitOrderUI() {
    const btn = document.getElementById('executeBtn'), status = document.getElementById('limitOrderStatus'), text = document.getElementById('limitOrderText');
    if (pendingLimitOrder) {
        btn.innerHTML = '⏳ Waiting for Entry...'; 
        btn.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
        status.classList.remove('hidden');
        const prec = getPricePrecision(pendingLimitOrder.pair);
        text.innerHTML = `⏳ ${pendingLimitOrder.signalType} LIMIT @ $${pendingLimitOrder.idealEntry.toFixed(prec)}`;
        document.getElementById('connectionStatus').innerHTML = `🟡 Waiting for entry...`;
    } else {
        btn.innerHTML = '⚡ Place Limit Order'; 
        btn.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
        status.classList.add('hidden');
        document.getElementById('connectionStatus').innerHTML = '🟢 Ready';
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) clearInterval(priceCheckInterval);
    priceCheckInterval = setInterval(async () => {
        if (!pendingLimitOrder) { clearInterval(priceCheckInterval); return; }
        const price = await getPrice(); if (!price) return;
        const o = pendingLimitOrder;
        let exec = false;
        if (o.signalType === 'LONG' && price <= o.idealEntry) exec = true;
        else if (o.signalType === 'SHORT' && price >= o.idealEntry) exec = true;
        if (exec) {
            clearPendingOrder();
            if (tg?.sendData) tg.sendData(JSON.stringify({ 
                action: 'limit_order_filled', 
                pair: o.pair, 
                signal: o.signalType, 
                filledPrice: price, 
                stopLoss: o.stopLoss, 
                takeProfit: o.takeProfit1 
            }));
            showNotification(`✅ LIMIT ORDER FILLED! ${o.signalType} @ $${price.toFixed(getPricePrecision(o.pair))}`, 'success');
            new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>{});
        }
        updatePriceDisplay(price);
    }, 3000); // Check every 3 seconds for sniping
}

function handleExecuteOrder() {
    if (!analysisData || analysisData.signalType === 'NEUTRAL') { 
        showNotification('No valid signal', 'error'); 
        return; 
    }
    if (pendingLimitOrder) { cancelLimitOrder(); return; }
    const order = { 
        id: Date.now(), 
        pair: currentPair, 
        signalType: analysisData.signalType, 
        idealEntry: analysisData.idealEntry, 
        stopLoss: analysisData.stopLoss, 
        takeProfit1: analysisData.takeProfit1,
        takeProfit2: analysisData.takeProfit2,
        takeProfit3: analysisData.takeProfit3,
        confidence: analysisData.confidence, 
        createdAt: new Date().toISOString() 
    };
    savePendingOrder(order); 
    startPriceMonitoring();
    showNotification(`📝 Limit order placed @ $${order.idealEntry.toFixed(getPricePrecision(currentPair))}`, 'info');
}

// ============================================
// UI HELPERS
// ============================================
function updatePriceDisplay(p) { 
    document.getElementById('currentPrice').innerHTML = `$${p.toFixed(getPricePrecision(currentPair))}`; 
}

function calculatePositionSize() {
    if (!analysisData || analysisData.signalType === 'NEUTRAL') return;
    const acc = +document.getElementById('accountSize').value || 10000;
    const riskP = +document.getElementById('riskPercent').value || 1;
    const riskAmt = acc * (riskP/100);
    const stopDist = Math.abs(analysisData.idealEntry - analysisData.stopLoss);
    const pos = stopDist > 0 ? riskAmt/stopDist : 0;
    document.getElementById('positionSize').innerHTML = pos.toFixed(2);
    document.getElementById('riskAmount').innerHTML = `$${riskAmt.toFixed(2)}`;
    document.getElementById('suggestedLeverage').innerHTML = '--';
}

function updateChart(d) { 
    if(priceChart) { 
        priceChart.data.datasets[0].data = d.slice(-50).map(c=>({x:c.time, y:c.close})); 
        priceChart.data.labels = d.slice(-50).map(c=>new Date(c.time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})); 
        priceChart.update(); 
    } 
}

function showNotification(m, t) { 
    const n = document.getElementById('notification'); 
    if(!n) return; 
    n.innerHTML = m; 
    n.className = `notification ${t}`; 
    n.classList.remove('hidden'); 
    setTimeout(()=>n.classList.add('hidden'), 4000); 
}
