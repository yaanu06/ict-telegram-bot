// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// SECURE API KEY STORAGE USING TELEGRAM CLOUD
// ============================================
let TWELVE_DATA_KEY = '';
let DEEPSEEK_API_KEY = '';
let PROXY_ENABLED = false;

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Symbol mapping for Twelve Data
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
// LOAD API KEYS FROM TELEGRAM STORAGE
// ============================================
async function loadAPIKeys() {
    if (!tg || !tg.CloudStorage) {
        console.log('Telegram CloudStorage not available');
        return false;
    }
    
    try {
        // Try to get keys from Telegram cloud
        const keys = await tg.CloudStorage.getItem('api_keys_v1');
        
        if (keys) {
            const parsed = JSON.parse(keys);
            TWELVE_DATA_KEY = parsed.twelveData || '';
            DEEPSEEK_API_KEY = parsed.deepseek || '';
            
            // Hide keys in UI - show only last 4 chars
            if (TWELVE_DATA_KEY) {
                console.log('✅ Twelve Data key loaded: ...' + TWELVE_DATA_KEY.slice(-4));
            }
            if (DEEPSEEK_API_KEY) {
                console.log('✅ DeepSeek key loaded: ...' + DEEPSEEK_API_KEY.slice(-4));
            }
            
            return true;
        }
    } catch(e) {
        console.error('Failed to load keys:', e);
    }
    
    return false;
}

// Save API keys to Telegram cloud
async function saveAPIKeys(twelveKey, deepseekKey) {
    if (!tg || !tg.CloudStorage) {
        showNotification('Telegram CloudStorage not available', 'error');
        return false;
    }
    
    try {
        const keys = JSON.stringify({
            twelveData: twelveKey,
            deepseek: deepseekKey
        });
        
        await tg.CloudStorage.setItem('api_keys_v1', keys);
        TWELVE_DATA_KEY = twelveKey;
        DEEPSEEK_API_KEY = deepseekKey;
        
        showNotification('✅ API keys saved securely!', 'success');
        return true;
    } catch(e) {
        console.error('Failed to save keys:', e);
        showNotification('Failed to save keys', 'error');
        return false;
    }
}

// Show setup modal for first-time users
function showSetupModal() {
    const setupHTML = `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API Key Setup</h3>
                <p class="setup-desc">Enter your API keys once. They'll be encrypted and stored securely in Telegram.</p>
                
                <label>Twelve Data API Key:</label>
                <input type="password" id="twelveInput" placeholder="3076..." class="setup-input">
                
                <label>DeepSeek API Key:</label>
                <input type="password" id="deepseekInput" placeholder="sk-..." class="setup-input">
                
                <p class="setup-note">Keys are stored ONLY in your Telegram cloud, never on our servers.</p>
                
                <div class="setup-buttons">
                    <button id="saveKeysBtn" class="setup-btn primary">Save Keys</button>
                    <button id="skipSetupBtn" class="setup-btn secondary">Skip (Limited Mode)</button>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', setupHTML);
    
    // Add styles dynamically
    const style = document.createElement('style');
    style.textContent = `
        .setup-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }
        .setup-modal {
            background: #1c1c1e;
            border-radius: 16px;
            padding: 24px;
            max-width: 350px;
            width: 90%;
            border: 1px solid #3390ec;
        }
        .setup-modal h3 {
            color: #3390ec;
            margin-bottom: 8px;
        }
        .setup-desc {
            color: #8e8e93;
            font-size: 13px;
            margin-bottom: 16px;
        }
        .setup-modal label {
            color: white;
            font-size: 13px;
            display: block;
            margin-bottom: 4px;
        }
        .setup-input {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid #2c2c2e;
            background: #2c2c2e;
            color: white;
            font-size: 14px;
            margin-bottom: 16px;
        }
        .setup-note {
            color: #ff9f0a;
            font-size: 11px;
            margin-bottom: 16px;
        }
        .setup-buttons {
            display: flex;
            gap: 8px;
        }
        .setup-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
        }
        .setup-btn.primary {
            background: #3390ec;
            color: white;
        }
        .setup-btn.secondary {
            background: #2c2c2e;
            color: #8e8e93;
        }
    `;
    document.head.appendChild(style);
    
    // Setup event listeners
    document.getElementById('saveKeysBtn').addEventListener('click', async () => {
        const twelveKey = document.getElementById('twelveInput').value.trim();
        const deepseekKey = document.getElementById('deepseekInput').value.trim();
        
        if (!twelveKey && !deepseekKey) {
            showNotification('Please enter at least one API key', 'warning');
            return;
        }
        
        const saved = await saveAPIKeys(twelveKey, deepseekKey);
        if (saved) {
            document.getElementById('setupOverlay').remove();
            showNotification('Setup complete! You can now use the bot.', 'success');
        }
    });
    
    document.getElementById('skipSetupBtn').addEventListener('click', () => {
        document.getElementById('setupOverlay').remove();
        showNotification('Limited mode: Basic analysis only', 'warning');
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

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async function() {
    const keysLoaded = await loadAPIKeys();
    
    if (!keysLoaded) {
        // First time user - show setup
        setTimeout(() => showSetupModal(), 500);
    }
    
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
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const el = document.getElementById('liveTime');
    if (el) el.innerHTML = `${dateStr} ${timeStr} UTC`;
}

function initChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: currentPair,
                data: [],
                borderColor: '#3390ec',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    grid: { color: '#2c2c2e' },
                    ticks: { color: '#8e8e93', maxRotation: 0 }
                },
                y: {
                    grid: { color: '#2c2c2e' },
                    ticks: { color: '#8e8e93' }
                }
            }
        }
    });
}

function setupEventListeners() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const executeBtn = document.getElementById('executeBtn');
    const pairSelect = document.getElementById('pairSelect');
    
    if (analyzeBtn) analyzeBtn.addEventListener('click', runAnalysis);
    if (executeBtn) executeBtn.addEventListener('click', handleExecuteOrder);
    if (pairSelect) pairSelect.addEventListener('change', function(e) {
        currentPair = e.target.value;
    });

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            updatePairsByCategory(this.dataset.category);
        });
    });

    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentTimeframe = this.dataset.tf;
            if (chartData.length > 0) updateChartWithTimeframe();
        });
    });

    document.getElementById('showFVG')?.addEventListener('change', updateChartAnnotations);
    document.getElementById('showOB')?.addEventListener('change', updateChartAnnotations);
    document.getElementById('showLQ')?.addEventListener('change', updateChartAnnotations);
}

function setupPositionCalculator() {
    const accountSize = document.getElementById('accountSize');
    const riskPercent = document.getElementById('riskPercent');
    [accountSize, riskPercent].forEach(el => {
        if (el) el.addEventListener('input', calculatePositionSize);
    });
}

function updatePairsByCategory(category) {
    const pairs = {
        crypto: ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'],
        metals: ['XAU/USD', 'XAG/USD', 'XPT/USD', 'XPD/USD']
    };
    const pairSelect = document.getElementById('pairSelect');
    if (pairSelect) {
        pairSelect.innerHTML = pairs[category].map(p => `<option value="${p}">${getPairDisplayName(p)}</option>`).join('');
        currentPair = pairs[category][0];
    }
}

function getPairDisplayName(pair) {
    const icons = {
        'BTC/USD': '₿', 'ETH/USD': '⟠', 'EUR/USD': '€', 'GBP/USD': '£',
        'XAU/USD': '👑', 'XAG/USD': '🥈', 'USD/JPY': '💴', 'AUD/USD': '🇦🇺',
        'USD/CAD': '🇨🇦', 'BNB/USD': '💰', 'SOL/USD': '☀️', 'XRP/USD': '💧'
    };
    return `${icons[pair] || '📊'} ${pair}`;
}

function isForexPair(pair) {
    return ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'].includes(pair);
}

function isJPYPair(pair) {
    return pair.includes('JPY');
}

function getPricePrecision(pair) {
    if (isJPYPair(pair)) return 3;
    if (isForexPair(pair)) return 5;
    return 2;
}

// ============================================
// TWELVE DATA API FUNCTIONS
// ============================================

async function getPrice() {
    if (!TWELVE_DATA_KEY) {
        document.getElementById('apiSource').innerHTML = '⚠️ No API Key';
        return null;
    }
    
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    if (!symbol) return null;
    
    try {
        const url = `${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.price && !isNaN(parseFloat(data.price))) {
            document.getElementById('apiSource').innerHTML = '📡 Twelve Data';
            apiCalls++;
            updateApiCounter();
            return parseFloat(data.price);
        }
        
        if (data.code === 429) {
            showNotification('API limit reached', 'warning');
        }
    } catch(e) {
        console.error('Price fetch error:', e);
    }
    
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
    if (!TWELVE_DATA_KEY) return null;
    
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    const interval = TIMEFRAME_MAP[timeframe];
    if (!symbol || !interval) return null;
    
    try {
        const url = `${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=100&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.values && data.values.length > 30) {
            apiCalls++;
            updateApiCounter();
            return data.values.map(c => ({
                time: c.datetime,
                open: parseFloat(c.open),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                close: parseFloat(c.close),
                volume: parseFloat(c.volume) || 1000000
            })).reverse();
        }
    } catch(e) {
        console.error('History fetch error:', e);
    }
    return null;
}

function updateApiCounter() {
    document.getElementById('apiUsage').innerHTML = `${apiCalls}`;
}

// ============================================
// DEEPSEEK AI INTEGRATION
// ============================================

async function getAIAnalysis(marketData) {
    if (!DEEPSEEK_API_KEY) {
        console.log('No DeepSeek key - using rule-based analysis');
        return null;
    }
    
    showNotification('🤖 DeepSeek AI analyzing...', 'info');
    
    const prompt = `You are an expert ICT trader. Analyze this market data and provide a trading signal.

Market: ${currentPair} | Timeframe: ${currentTimeframe} | Price: ${marketData.currentPrice}
RSI: ${marketData.rsi} | Trend: ${marketData.trend}

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
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are an expert ICT trader. Respond in JSON only.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 800
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const aiResponse = data.choices[0].message.content;
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('AI error:', error);
        return null;
    }
}

// ============================================
// TECHNICAL ANALYSIS FUNCTIONS
// ============================================

function calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    const ema = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
        ema.push((prices[i] - ema[i-1]) * multiplier + ema[i-1]);
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i-1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateATR(data, period = 14) {
    const trueRanges = [];
    for (let i = 1; i < data.length; i++) {
        const tr = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i-1].close),
            Math.abs(data[i].low - data[i-1].close)
        );
        trueRanges.push(tr);
    }
    return trueRanges.slice(-period).reduce((a,b) => a+b, 0) / period;
}

function detectFairValueGaps(data) {
    const fvgs = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (data[i-1].high < data[i+1].low && data[i+1].low - data[i-1].high > data[i+1].close * 0.001) {
            fvgs.push({ type: 'bullish', low: data[i-1].high, high: data[i+1].low });
        }
        if (data[i-1].low > data[i+1].high && data[i-1].low - data[i+1].high > data[i+1].close * 0.001) {
            fvgs.push({ type: 'bearish', low: data[i+1].high, high: data[i-1].low });
        }
    }
    return fvgs;
}

function detectOrderBlocks(data) {
    const obs = [];
    for (let i = 2; i < data.length - 1; i++) {
        if (data[i].close < data[i].open && data[i+1].close > data[i+1].open && data[i+1].close > data[i].high) {
            obs.push({ type: 'bullish', high: data[i].high, low: data[i].low });
        }
        if (data[i].close > data[i].open && data[i+1].close < data[i+1].open && data[i+1].close < data[i].low) {
            obs.push({ type: 'bearish', high: data[i].high, low: data[i].low });
        }
    }
    return obs;
}

function detectLiquidityLevels(data) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const levels = [];
    for (let i = 2; i < data.length - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            levels.push({ type: 'resistance', price: highs[i] });
        }
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            levels.push({ type: 'support', price: lows[i] });
        }
    }
    return levels;
}

function analyzeMarketStructure(data) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    
    const higherHigh = recentHighs[recentHighs.length - 1] > recentHighs[0];
    const higherLow = recentLows[recentLows.length - 1] > recentLows[0];
    const lowerHigh = recentHighs[recentHighs.length - 1] < recentHighs[0];
    const lowerLow = recentLows[recentLows.length - 1] < recentLows[0];
    
    if (higherHigh && higherLow) return 'Bullish';
    if (lowerHigh && lowerLow) return 'Bearish';
    return 'Ranging';
}

function calculateVolumeProfile(data) {
    if (!data || data.length === 0) return null;
    
    const allHighs = data.map(c => c.high);
    const allLows = data.map(c => c.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const range = maxPrice - minPrice;
    const levelSize = range / 12;
    
    const levels = [];
    for (let i = 0; i < 12; i++) {
        const low = minPrice + (i * levelSize);
        const high = low + levelSize;
        levels.push({ low, high, volume: 0, price: (low + high) / 2 });
    }
    
    data.forEach(candle => {
        levels.forEach(level => {
            if (candle.high >= level.low && candle.low <= level.high) {
                const overlap = Math.min(candle.high, level.high) - Math.max(candle.low, level.low);
                const percent = overlap / (candle.high - candle.low);
                level.volume += candle.volume * percent;
            }
        });
    });
    
    let maxVol = 0, poc = null;
    levels.forEach(level => {
        if (level.volume > maxVol) {
            maxVol = level.volume;
            poc = level;
        }
    });
    
    const totalVol = levels.reduce((s, l) => s + l.volume, 0);
    const target = totalVol * 0.7;
    let acc = 0;
    const sorted = [...levels].sort((a, b) => b.volume - a.volume);
    const valueArea = [];
    
    for (const level of sorted) {
        if (acc < target) {
            valueArea.push(level);
            acc += level.volume;
        } else break;
    }
    
    const vaHigh = valueArea.length > 0 ? Math.max(...valueArea.map(l => l.high)) : maxPrice;
    const vaLow = valueArea.length > 0 ? Math.min(...valueArea.map(l => l.low)) : minPrice;
    
    return { poc, valueAreaHigh: vaHigh, valueAreaLow: vaLow, totalVolume: totalVol };
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    
    if (!TWELVE_DATA_KEY) {
        showNotification('Please set up your API keys first', 'error');
        showSetupModal();
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
        return;
    }
    
    showNotification('🔍 Analyzing market...', 'info');

    try {
        const currentPrice = await getPrice();
        if (!currentPrice) throw new Error('Could not fetch price');
        
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 30) throw new Error('Insufficient data');
        
        chartData = historicalData;
        allTimeframeData[currentTimeframe] = historicalData;
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const currentEMA20 = ema20[ema20.length - 1];
        const currentEMA50 = ema50[ema50.length - 1];
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        
        const fvgs = detectFairValueGaps(historicalData);
        const orderBlocks = detectOrderBlocks(historicalData);
        const liquidity = detectLiquidityLevels(historicalData);
        const marketStructure = analyzeMarketStructure(historicalData);
        const volumeProfile = calculateVolumeProfile(historicalData);
        
        let trend = 'neutral';
        if (currentEMA20 > currentEMA50) trend = 'bullish';
        else if (currentEMA20 < currentEMA50) trend = 'bearish';
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        const fibLevels = {
            fib0: recentLow, fib236: recentLow + range * 0.236,
            fib382: recentLow + range * 0.382, fib500: recentLow + range * 0.5,
            fib618: recentLow + range * 0.618, fib786: recentLow + range * 0.786,
            fib100: recentHigh
        };
        
        const marketData = {
            currentPrice: currentPrice.toFixed(getPricePrecision(currentPair)),
            rsi: rsi.toFixed(1),
            trend: trend
        };
        
        let signalType, confidence, idealEntry, stopLoss, tp1, tp2, tp3, riskReward, analysisReason;
        
        // Try AI first
        const aiSignal = await getAIAnalysis(marketData);
        
        if (aiSignal && aiSignal.signal !== 'NEUTRAL') {
            signalType = aiSignal.signal;
            confidence = aiSignal.confidence;
            idealEntry = aiSignal.idealEntry;
            stopLoss = aiSignal.stopLoss;
            tp1 = aiSignal.takeProfit1;
            tp2 = aiSignal.takeProfit2;
            tp3 = aiSignal.takeProfit3;
            riskReward = 'N/A';
            analysisReason = `🤖 AI: ${aiSignal.reasoning}`;
            showNotification(`✅ AI Signal: ${signalType} (${confidence}%)`, 'success');
        } else {
            // Fallback to rule-based
            signalType = trend === 'bullish' ? 'LONG' : (trend === 'bearish' ? 'SHORT' : 'NEUTRAL');
            confidence = 50;
            idealEntry = currentPrice;
            stopLoss = trend === 'bullish' ? currentPrice - atr : currentPrice + atr;
            tp1 = trend === 'bullish' ? currentPrice + atr * 1.5 : currentPrice - atr * 1.5;
            tp2 = trend === 'bullish' ? currentPrice + atr * 2.5 : currentPrice - atr * 2.5;
            tp3 = trend === 'bullish' ? currentPrice + atr * 4 : currentPrice - atr * 4;
            riskReward = '1.5';
            analysisReason = 'Rule-based analysis (AI unavailable or neutral)';
        }
        
        updatePriceDisplay(currentPrice);
        updateSignalDisplay(signalType, confidence, idealEntry, currentPrice, stopLoss, tp1, tp2, tp3, riskReward);
        updateVolumeProfileDisplay(volumeProfile);
        updateICTDisplay(fvgs, orderBlocks, liquidity, marketStructure);
        updateFibDisplay(fibLevels);
        document.getElementById('signalReason').innerHTML = analysisReason;
        updateChart(historicalData);
        
        analysisData = { signalType, idealEntry, currentPrice, stopLoss, takeProfit1: tp1, takeProfit2: tp2, takeProfit3: tp3, confidence };
        
        calculatePositionSize();
        
        document.getElementById('executeBtn').disabled = signalType === 'NEUTRAL';
        
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ============================================
// LIMIT ORDER MANAGEMENT
// ============================================

function loadPendingOrder() {
    const saved = localStorage.getItem('pendingLimitOrder');
    if (saved) {
        pendingLimitOrder = JSON.parse(saved);
        updateLimitOrderUI();
        startPriceMonitoring();
    }
}

function savePendingOrder(order) {
    pendingLimitOrder = order;
    localStorage.setItem('pendingLimitOrder', JSON.stringify(order));
    updateLimitOrderUI();
}

function clearPendingOrder() {
    pendingLimitOrder = null;
    localStorage.removeItem('pendingLimitOrder');
    if (priceCheckInterval) {
        clearInterval(priceCheckInterval);
        priceCheckInterval = null;
    }
    updateLimitOrderUI();
    document.getElementById('executeBtn').innerHTML = '⚡ Place Limit Order';
    document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #34c759, #28a745)';
}

function updateLimitOrderUI() {
    const executeBtn = document.getElementById('executeBtn');
    const statusEl = document.getElementById('connectionStatus');
    
    if (pendingLimitOrder) {
        executeBtn.innerHTML = '⏳ Waiting for Entry...';
        executeBtn.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
        statusEl.innerHTML = `🟡 Waiting for ${pendingLimitOrder.pair}`;
        statusEl.className = 'connection-status waiting';
    } else {
        executeBtn.innerHTML = '⚡ Place Limit Order';
        executeBtn.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
        statusEl.innerHTML = '🟢 Ready';
        statusEl.className = 'connection-status';
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) clearInterval(priceCheckInterval);
    
    priceCheckInterval = setInterval(async () => {
        if (!pendingLimitOrder) {
            clearInterval(priceCheckInterval);
            return;
        }
        
        const currentPrice = await getPrice();
        if (!currentPrice) return;
        
        const order = pendingLimitOrder;
        let shouldExecute = false;
        
        if (order.signalType === 'LONG' && currentPrice <= order.idealEntry) {
            shouldExecute = true;
        } else if (order.signalType === 'SHORT' && currentPrice >= order.idealEntry) {
            shouldExecute = true;
        }
        
        if (shouldExecute) {
            executeLimitOrder(order, currentPrice);
        }
        
        updatePriceDisplay(currentPrice);
        
    }, 5000);
}

function executeLimitOrder(order, fillPrice) {
    clearPendingOrder();
    
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'limit_order_filled',
            pair: order.pair,
            signal: order.signalType,
            filledPrice: fillPrice,
            stopLoss: order.stopLoss,
            takeProfits: [order.takeProfit1, order.takeProfit2, order.takeProfit3]
        }));
    }
    
    showNotification(`✅ ORDER FILLED! ${order.signalType} @ $${fillPrice.toFixed(getPricePrecision(order.pair))}`, 'success');
}

function handleExecuteOrder() {
    if (!analysisData) {
        showNotification('Run analysis first', 'error');
        return;
    }
    
    if (pendingLimitOrder) {
        clearPendingOrder();
        showNotification('❌ Limit order cancelled', 'warning');
        return;
    }
    
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
    
    const precision = getPricePrecision(currentPair);
    showNotification(`📝 Limit order placed @ $${order.idealEntry.toFixed(precision)}`, 'info');
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

function updatePriceDisplay(currentPrice) {
    const precision = getPricePrecision(currentPair);
    document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(precision)}`;
    
    if (lastPrice) {
        const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
        const changeEl = document.getElementById('priceChange');
        changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
        changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    lastPrice = currentPrice;
}

function updateSignalDisplay(type, confidence, entry, current, sl, tp1, tp2, tp3, rr) {
    const precision = getPricePrecision(currentPair);
    
    document.getElementById('signalTypeText').innerHTML = type;
    document.getElementById('signalTypeBox').className = `signal-type-box ${type.toLowerCase()}`;
    document.getElementById('confidenceText').innerHTML = `${confidence}%`;
    document.getElementById('idealEntryDisplay').innerHTML = `$${entry.toFixed(precision)}`;
    document.getElementById('entryPrice').innerHTML = `$${current.toFixed(precision)}`;
    document.getElementById('stopLoss').innerHTML = `$${sl.toFixed(precision)}`;
    document.getElementById('takeProfit1').innerHTML = `$${tp1.toFixed(precision)}`;
    document.getElementById('takeProfit2').innerHTML = `$${tp2.toFixed(precision)}`;
    document.getElementById('takeProfit3').innerHTML = `$${tp3.toFixed(precision)}`;
    document.getElementById('riskReward').innerHTML = rr;
    
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
    const precision = getPricePrecision(currentPair);
    document.getElementById('pocValue').innerHTML = `$${vp.poc?.price.toFixed(precision) || '--'}`;
    document.getElementById('valueHigh').innerHTML = `$${vp.valueAreaHigh?.toFixed(precision) || '--'}`;
    document.getElementById('valueLow').innerHTML = `$${vp.valueAreaLow?.toFixed(precision) || '--'}`;
    document.getElementById('totalVolume').innerHTML = `${(vp.totalVolume / 1000000).toFixed(1)}M`;
}

function updateICTDisplay(fvgs, obs, liquidity, structure) {
    document.getElementById('fvgCount').innerHTML = fvgs.length;
    document.getElementById('obCount').innerHTML = obs.length;
    document.getElementById('liquidityLevels').innerHTML = liquidity.length;
    document.getElementById('marketStructure').innerHTML = structure;
}

function updateFibDisplay(levels) {
    const precision = getPricePrecision(currentPair);
    document.getElementById('fib0').innerHTML = `$${levels.fib0.toFixed(precision)}`;
    document.getElementById('fib236').innerHTML = `$${levels.fib236.toFixed(precision)}`;
    document.getElementById('fib382').innerHTML = `$${levels.fib382.toFixed(precision)}`;
    document.getElementById('fib500').innerHTML = `$${levels.fib500.toFixed(precision)}`;
    document.getElementById('fib618').innerHTML = `$${levels.fib618.toFixed(precision)}`;
    document.getElementById('fib786').innerHTML = `$${levels.fib786.toFixed(precision)}`;
    document.getElementById('fib100').innerHTML = `$${levels.fib100.toFixed(precision)}`;
}

function calculatePositionSize() {
    if (!analysisData || analysisData.signalType === 'NEUTRAL') return;
    
    const accountSize = parseFloat(document.getElementById('accountSize').value) || 10000;
    const riskPercent = parseFloat(document.getElementById('riskPercent').value) || 1;
    const riskAmount = accountSize * (riskPercent / 100);
    const stopDistance = Math.abs(analysisData.idealEntry - analysisData.stopLoss);
    const positionSize = riskAmount / stopDistance;
    
    document.getElementById('positionSize').innerHTML = positionSize.toFixed(4);
    document.getElementById('riskAmount').innerHTML = `$${riskAmount.toFixed(2)}`;
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}

function updateChart(data) {
    if (!priceChart) return;
    priceChart.data.datasets[0].data = data.slice(-50).map(c => ({ x: c.time, y: c.close }));
    priceChart.data.labels = data.slice(-50).map(c => new Date(c.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    priceChart.update();
}

function updateChartWithTimeframe() {
    if (allTimeframeData[currentTimeframe]) updateChart(allTimeframeData[currentTimeframe]);
}

function updateChartAnnotations() {
    if (chartData.length > 0) updateChart(chartData);
}
