// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// API CONFIGURATION
// ============================================
const TWELVE_DATA_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const DEEPSEEK_API_KEY = 'sk-e3103ef0f7c34ee183d64e74410412ac';
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
let aiAnalysisResult = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', function() {
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
            showNotification('API limit reached. Try again in a minute.', 'warning');
        }
    } catch(e) {
        console.error('Twelve Data fetch error:', e);
    }
    
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
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
    showNotification('🤖 DeepSeek AI analyzing market...', 'info');
    
    const prompt = `You are an expert ICT (Inner Circle Trader) and Smart Money Concepts trader. Analyze the following market data and provide a trading signal.

Market: ${currentPair}
Timeframe: ${currentTimeframe}
Current Price: ${marketData.currentPrice}
24h Change: ${marketData.priceChange}%

Technical Indicators:
- RSI (14): ${marketData.rsi}
- ATR (14): ${marketData.atr}
- EMA20: ${marketData.ema20}
- EMA50: ${marketData.ema50}
- Trend: ${marketData.trend}
- Market Structure: ${marketData.marketStructure}

ICT Concepts Detected:
- Fair Value Gaps: ${marketData.fvgCount}
- Order Blocks: ${marketData.obCount}
- Liquidity Levels: ${marketData.liquidityLevels}
- Turtle Soup Pattern: ${marketData.turtleSoup || 'None'}
- Liquidity Sweep: ${marketData.liquiditySweep || 'None'}

Volume Profile:
- POC: ${marketData.poc}
- Value Area High: ${marketData.valueHigh}
- Value Area Low: ${marketData.valueLow}

Fibonacci Levels (from recent swing):
- 0%: ${marketData.fib0}
- 38.2%: ${marketData.fib382}
- 50%: ${marketData.fib500}
- 61.8%: ${marketData.fib618}
- 78.6%: ${marketData.fib786}
- 100%: ${marketData.fib100}

Based on ICT concepts, provide a trading recommendation in the following JSON format ONLY:
{
    "signal": "LONG" or "SHORT" or "NEUTRAL",
    "confidence": number between 0-100,
    "idealEntry": number,
    "stopLoss": number,
    "takeProfit1": number,
    "takeProfit2": number,
    "takeProfit3": number,
    "reasoning": "Brief explanation of your analysis using ICT terminology (FVG, OB, liquidity, displacement, etc.)",
    "keyLevels": ["level1", "level2"],
    "riskRewardRatio": number
}

Important: Only respond with valid JSON. No other text.`;

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
                    {
                        role: 'system',
                        content: 'You are an expert ICT trader. Analyze market data and provide trading signals in JSON format only.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            const aiResponse = data.choices[0].message.content;
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                aiAnalysisResult = analysis;
                return analysis;
            }
        }
        
        throw new Error('Invalid AI response format');
        
    } catch (error) {
        console.error('DeepSeek API error:', error);
        showNotification('AI analysis failed, using rule-based fallback', 'warning');
        return null;
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
}

function updateLimitOrderUI() {
    const executeBtn = document.getElementById('executeBtn');
    const statusEl = document.getElementById('connectionStatus');
    
    if (pendingLimitOrder) {
        executeBtn.innerHTML = '⏳ Waiting for Entry...';
        executeBtn.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
        statusEl.innerHTML = `🟡 Waiting for ${pendingLimitOrder.pair} @ $${pendingLimitOrder.idealEntry.toFixed(getPricePrecision(currentPair))}`;
        statusEl.className = 'connection-status waiting';
    } else {
        executeBtn.innerHTML = '⚡ Place Limit Order';
        executeBtn.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
        statusEl.innerHTML = '🟢 Ready';
        statusEl.className = 'connection-status';
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) {
        clearInterval(priceCheckInterval);
    }
    
    priceCheckInterval = setInterval(async () => {
        if (!pendingLimitOrder) {
            clearInterval(priceCheckInterval);
            priceCheckInterval = null;
            return;
        }
        
        const currentPrice = await getPrice();
        if (!currentPrice) return;
        
        const order = pendingLimitOrder;
        const precision = getPricePrecision(order.pair);
        let shouldExecute = false;
        
        if (order.signalType === 'LONG') {
            // For LONG: Wait for price to drop TO or BELOW entry
            if (currentPrice <= order.idealEntry) {
                shouldExecute = true;
            }
        } else if (order.signalType === 'SHORT') {
            // For SHORT: Wait for price to rise TO or ABOVE entry
            if (currentPrice >= order.idealEntry) {
                shouldExecute = true;
            }
        }
        
        // Update status with distance to entry
        const distance = Math.abs(currentPrice - order.idealEntry);
        const distancePercent = (distance / order.idealEntry * 100).toFixed(2);
        const direction = order.signalType === 'LONG' ? 
            (currentPrice > order.idealEntry ? '▼' : '▲') : 
            (currentPrice < order.idealEntry ? '▲' : '▼');
        
        const statusEl = document.getElementById('connectionStatus');
        if (statusEl) {
            statusEl.innerHTML = `⏳ ${order.pair}: $${currentPrice.toFixed(precision)} → Target: $${order.idealEntry.toFixed(precision)} (${distancePercent}% away)`;
        }
        
        if (shouldExecute) {
            executeLimitOrder(order, currentPrice);
        }
        
        updatePriceDisplay(currentPrice);
        
    }, 5000); // Check every 5 seconds
}

function executeLimitOrder(order, fillPrice) {
    clearPendingOrder();
    
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'limit_order_filled',
            pair: order.pair,
            signal: order.signalType,
            requestedEntry: order.idealEntry,
            filledPrice: fillPrice,
            stopLoss: order.stopLoss,
            takeProfits: [order.takeProfit1, order.takeProfit2, order.takeProfit3],
            confidence: order.confidence,
            aiReasoning: order.aiReasoning,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ LIMIT ORDER FILLED! ${order.signalType} @ $${fillPrice.toFixed(getPricePrecision(order.pair))}`, 'success');
    
    // Play sound alert
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play();
    } catch(e) {}
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

function findSwingPoints(values, lookback = 3) {
    const highs = [], lows = [];
    for (let i = lookback; i < values.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (values[i] <= values[i - j] || values[i] <= values[i + j]) isHigh = false;
            if (values[i] >= values[i - j] || values[i] >= values[i + j]) isLow = false;
        }
        if (isHigh) highs.push({ index: i, value: values[i] });
        if (isLow) lows.push({ index: i, value: values[i] });
    }
    return { highs, lows };
}

function detectLiquiditySweep(data) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const closes = data.map(c => c.close);
    
    for (let i = 10; i < data.length - 3; i++) {
        const recentHighs = highs.slice(i-5, i);
        const maxHigh = Math.max(...recentHighs);
        const highCount = recentHighs.filter(h => Math.abs(h - maxHigh) / maxHigh < 0.001).length;
        
        if (highCount >= 2) {
            const nextCandles = data.slice(i, i+4);
            const sweptAbove = nextCandles.some(c => c.high > maxHigh * 1.001);
            const closedBelow = closes[i+3] < maxHigh;
            
            if (sweptAbove && closedBelow) {
                return { type: 'buy_side', message: 'Buy-side liquidity swept - Potential SHORT' };
            }
        }
        
        const recentLows = lows.slice(i-5, i);
        const minLow = Math.min(...recentLows);
        const lowCount = recentLows.filter(l => Math.abs(l - minLow) / minLow < 0.001).length;
        
        if (lowCount >= 2) {
            const nextCandles = data.slice(i, i+4);
            const sweptBelow = nextCandles.some(c => c.low < minLow * 0.999);
            const closedAbove = closes[i+3] > minLow;
            
            if (sweptBelow && closedAbove) {
                return { type: 'sell_side', message: 'Sell-side liquidity swept - Potential LONG' };
            }
        }
    }
    return null;
}

function detectTurtleSoup(data) {
    const recentData = data.slice(-15);
    const highs = recentData.map(c => c.high);
    const lows = recentData.map(c => c.low);
    const closes = recentData.map(c => c.close);
    const opens = recentData.map(c => c.open);
    
    const keyLow = Math.min(...lows.slice(0, -4));
    const recentLow = lows[lows.length - 4];
    const currentClose = closes[closes.length - 1];
    const currentOpen = opens[opens.length - 1];
    
    if (recentLow < keyLow * 0.999 && currentClose > keyLow) {
        return { type: 'bullish', name: 'Turtle Soup Buy', message: 'False breakdown - Aggressive LONG' };
    }
    
    const keyHigh = Math.max(...highs.slice(0, -4));
    const recentHigh = highs[highs.length - 4];
    
    if (recentHigh > keyHigh * 1.001 && currentClose < keyHigh) {
        return { type: 'bearish', name: 'Turtle Soup Sell', message: 'False breakout - Aggressive SHORT' };
    }
    
    return null;
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

function calculateOrderFlow(data) {
    if (!data || data.length < 10) return null;
    
    let buyPressure = 0, sellPressure = 0;
    data.forEach(candle => {
        const isBullish = candle.close > candle.open;
        if (isBullish) {
            buyPressure += candle.volume * 0.7;
            sellPressure += candle.volume * 0.3;
        } else {
            buyPressure += candle.volume * 0.3;
            sellPressure += candle.volume * 0.7;
        }
    });
    
    let pv = 0, vol = 0;
    data.forEach(candle => {
        const tp = (candle.high + candle.low + candle.close) / 3;
        pv += tp * candle.volume;
        vol += candle.volume;
    });
    const vwap = pv / vol;
    
    return { buyingPressure: buyPressure, sellingPressure: sellPressure, netDelta: buyPressure - sellPressure, vwap: vwap };
}

// ============================================
// MULTI-TIMEFRAME ANALYSIS
// ============================================

async function analyzeTimeframe(timeframe) {
    const data = await getHistoricalData(timeframe);
    if (!data || data.length < 30) return null;
    
    const closes = data.map(c => c.close);
    const rsi = calculateRSI(closes);
    const trend = closes[closes.length - 1] > closes[closes.length - 20] ? 'bullish' : 
                  closes[closes.length - 1] < closes[closes.length - 20] ? 'bearish' : 'neutral';
    
    return { data, trend, rsi, volume: data.slice(-20).reduce((s, c) => s + c.volume, 0) };
}

async function multiTimeframeAnalysis() {
    const timeframes = ['15M', '1H', '4H', '1D'];
    const results = {};
    let bullishCount = 0, bearishCount = 0;
    
    for (const tf of timeframes) {
        results[tf] = await analyzeTimeframe(tf);
        if (results[tf]) {
            if (results[tf].trend === 'bullish') bullishCount++;
            else if (results[tf].trend === 'bearish') bearishCount++;
            
            const trendEl = document.getElementById(`trend${tf}`);
            if (trendEl) {
                trendEl.innerHTML = results[tf].trend === 'bullish' ? '🟢 Bullish' :
                                   results[tf].trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral';
                trendEl.className = `mtf-trend ${results[tf].trend}`;
            }
            
            const rsiEl = document.getElementById(`rsi${tf}`);
            if (rsiEl) rsiEl.innerHTML = results[tf].rsi.toFixed(1);
            
            const volEl = document.getElementById(`vol${tf}`);
            if (volEl) volEl.innerHTML = (results[tf].volume / 1000000).toFixed(1) + 'M';
        }
    }
    
    const total = bullishCount + bearishCount;
    const confluenceScore = total > 0 ? Math.max(bullishCount, bearishCount) / total * 100 : 0;
    const direction = bullishCount > bearishCount ? 'Bullish' : bearishCount > bullishCount ? 'Bearish' : 'Neutral';
    
    const scoreEl = document.getElementById('confluenceScore');
    if (scoreEl) scoreEl.innerHTML = `${direction} (${confluenceScore.toFixed(0)}% confluence)`;
    
    return { results, confluenceScore, direction };
}

// ============================================
// CHART FUNCTIONS
// ============================================

function updateChart(data) {
    if (!priceChart) return;
    
    priceChart.data.datasets = [{
        label: currentPair,
        data: data.slice(-50).map(c => ({ x: c.time, y: c.close })),
        borderColor: '#3390ec',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1
    }];
    priceChart.data.labels = data.slice(-50).map(c => 
        new Date(c.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
    priceChart.update();
}

function updateChartWithTimeframe() {
    if (allTimeframeData[currentTimeframe]) {
        updateChart(allTimeframeData[currentTimeframe]);
    }
}

function updateChartAnnotations() {
    if (chartData.length > 0) updateChart(chartData);
}

// ============================================
// MAIN ANALYSIS FUNCTION WITH AI
// ============================================

async function runAnalysis() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('🔍 Gathering market data...', 'info');

    try {
        const currentPrice = await getPrice();
        if (!currentPrice) throw new Error('Could not fetch price');
        
        const mtfResults = await multiTimeframeAnalysis();
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 30) throw new Error('Insufficient data');
        
        chartData = historicalData;
        allTimeframeData[currentTimeframe] = historicalData;
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        
        const fvgs = detectFairValueGaps(historicalData);
        const orderBlocks = detectOrderBlocks(historicalData);
        const liquidity = detectLiquidityLevels(historicalData);
        const marketStructure = analyzeMarketStructure(historicalData);
        const volumeProfile = calculateVolumeProfile(historicalData);
        const orderFlow = calculateOrderFlow(historicalData);
        const liquiditySweep = detectLiquiditySweep(historicalData);
        const turtleSoup = detectTurtleSoup(historicalData);
        
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
        
        // Calculate price change
        const prevClose = closes[closes.length - 2] || currentPrice;
        const priceChange = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);
        
        // Prepare data for AI
        const marketData = {
            currentPrice: currentPrice.toFixed(getPricePrecision(currentPair)),
            priceChange: priceChange,
            rsi: rsi.toFixed(1),
            atr: atr.toFixed(getPricePrecision(currentPair)),
            ema20: ema20[ema20.length - 1].toFixed(getPricePrecision(currentPair)),
            ema50: ema50[ema50.length - 1].toFixed(getPricePrecision(currentPair)),
            trend: trend,
            marketStructure: marketStructure,
            fvgCount: fvgs.length,
            obCount: orderBlocks.length,
            liquidityLevels: liquidity.length,
            turtleSoup: turtleSoup?.name || 'None',
            liquiditySweep: liquiditySweep?.type || 'None',
            poc: volumeProfile?.poc?.price.toFixed(getPricePrecision(currentPair)) || 'N/A',
            valueHigh: volumeProfile?.valueAreaHigh?.toFixed(getPricePrecision(currentPair)) || 'N/A',
            valueLow: volumeProfile?.valueAreaLow?.toFixed(getPricePrecision(currentPair)) || 'N/A',
            fib0: fibLevels.fib0.toFixed(getPricePrecision(currentPair)),
            fib382: fibLevels.fib382.toFixed(getPricePrecision(currentPair)),
            fib500: fibLevels.fib500.toFixed(getPricePrecision(currentPair)),
            fib618: fibLevels.fib618.toFixed(getPricePrecision(currentPair)),
            fib786: fibLevels.fib786.toFixed(getPricePrecision(currentPair)),
            fib100: fibLevels.fib100.toFixed(getPricePrecision(currentPair))
        };
        
        // Get AI Analysis
        showNotification('🤖 DeepSeek AI is thinking...', 'info');
        const aiSignal = await getAIAnalysis(marketData);
        
        let signalType, confidence, idealEntry, stopLoss, tp1, tp2, tp3, riskReward, analysisReason;
        
        if (aiSignal && aiSignal.signal !== 'NEUTRAL') {
            signalType = aiSignal.signal;
            confidence = aiSignal.confidence;
            idealEntry = aiSignal.idealEntry;
            stopLoss = aiSignal.stopLoss;
            tp1 = aiSignal.takeProfit1;
            tp2 = aiSignal.takeProfit2;
            tp3 = aiSignal.takeProfit3;
            riskReward = aiSignal.riskRewardRatio?.toFixed(1) || 'N/A';
            analysisReason = `🤖 AI: ${aiSignal.reasoning}`;
            
            showNotification(`✅ AI Signal: ${signalType} (${confidence}% confidence)`, 'success');
        } else {
            // Fallback to rule-based
            signalType = 'NEUTRAL';
            confidence = 40;
            idealEntry = currentPrice;
            stopLoss = trend === 'bullish' ? currentPrice - atr : currentPrice + atr;
            tp1 = trend === 'bullish' ? currentPrice + atr * 1.5 : currentPrice - atr * 1.5;
            tp2 = trend === 'bullish' ? currentPrice + atr * 2.5 : currentPrice - atr * 2.5;
            tp3 = trend === 'bullish' ? currentPrice + atr * 4 : currentPrice - atr * 4;
            riskReward = '1.5';
            analysisReason = 'AI unavailable - using rule-based analysis.';
        }
        
        updatePriceDisplay(currentPrice);
        updateSignalDisplay(signalType, confidence, idealEntry, currentPrice, stopLoss, tp1, tp2, tp3, riskReward);
        updateVolumeProfileDisplay(volumeProfile);
        updateOrderFlowDisplay(orderFlow);
        updateICTDisplay(fvgs, orderBlocks, liquidity, marketStructure);
        updateFibDisplay(fibLevels);
        document.getElementById('signalReason').innerHTML = analysisReason;
        updateChart(historicalData);
        
        analysisData = { signalType, idealEntry, currentPrice, stopLoss, takeProfit1: tp1, takeProfit2: tp2, takeProfit3: tp3, confidence, aiReasoning: analysisReason };
        
        calculatePositionSize();
        
        // Enable limit order button
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= 50;
        document.getElementById('executeBtn').disabled = !shouldExecute;
        
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ============================================
// HANDLE EXECUTE - PLACE LIMIT ORDER
// ============================================

function handleExecuteOrder() {
    if (!analysisData) {
        showNotification('No analysis data. Run analysis first.', 'error');
        return;
    }
    
    if (pendingLimitOrder) {
        // Cancel existing order
        clearPendingOrder();
        showNotification('❌ Limit order cancelled', 'warning');
        return;
    }
    
    // Create limit order
    const order = {
        id: Date.now(),
        pair: currentPair,
        signalType: analysisData.signalType,
        idealEntry: analysisData.idealEntry,
        currentPrice: analysisData.currentPrice,
        stopLoss: analysisData.stopLoss,
        takeProfit1: analysisData.takeProfit1,
        takeProfit2: analysisData.takeProfit2,
        takeProfit3: analysisData.takeProfit3,
        confidence: analysisData.confidence,
        aiReasoning: analysisData.aiReasoning,
        createdAt: new Date().toISOString()
    };
    
    savePendingOrder(order);
    startPriceMonitoring();
    
    const precision = getPricePrecision(currentPair);
    showNotification(`📝 Limit order placed! Waiting for ${currentPair} to reach $${order.idealEntry.toFixed(precision)}`, 'info');
    
    // Send to Telegram
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'limit_order_placed',
            ...order
        }));
    }
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

function updateOrderFlowDisplay(of) {
    if (!of) return;
    const precision = getPricePrecision(currentPair);
    document.getElementById('buyingPressure').innerHTML = `${(of.buyingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('sellingPressure').innerHTML = `${(of.sellingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('netDelta').innerHTML = `${(of.netDelta / 1000000).toFixed(1)}M`;
    document.getElementById('vwapValue').innerHTML = `$${of.vwap.toFixed(precision)}`;
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
