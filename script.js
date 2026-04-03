// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Configuration
const API_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa'; // Replace with your key
const MAX_API_CALLS = 800;

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let historicalData = {};
let lastPrice = null;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// Initialize
function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
    loadSavedData();
}

function setupEventListeners() {
    analyzeBtn.addEventListener('click', runAnalysis);
    executeBtn.addEventListener('click', executeOrder);
    pairSelect.addEventListener('change', (e) => {
        currentPair = e.target.value;
        resetAnalysis();
    });

    // Category buttons
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePairsByCategory(e.target.dataset.category);
        });
    });

    // Timeframe buttons
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeframe = e.target.dataset.tf;
        });
    });

    // Tab buttons for ICT details
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`${tabId}Tab`).classList.add('active');
        });
    });
}

function updateLiveTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    document.getElementById('liveTime').textContent = `${dateStr} ${timeStr} UTC`;
}

function updatePairsByCategory(category) {
    const pairs = {
        crypto: ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'],
        metals: ['XAU/USD', 'XAG/USD', 'XPT/USD', 'XPD/USD']
    };
    
    pairSelect.innerHTML = pairs[category].map(pair => {
        const icons = {
            'BTC/USD': '₿', 'ETH/USD': '⟠', 'BNB/USD': '🟡', 'SOL/USD': '◎',
            'EUR/USD': '€', 'GBP/USD': '£', 'USD/JPY': '¥', 'AUD/USD': '$',
            'XAU/USD': '👑', 'XAG/USD': '🥈', 'XPT/USD': '⚪', 'XPD/USD': '🔘'
        };
        return `<option value="${pair}">${icons[pair] || '📊'} ${pair}</option>`;
    }).join('');
    currentPair = pairs[category][0];
    resetAnalysis();
}

async function fetchOHLCV(symbol, interval, outputsize = 100) {
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${intervals[interval]}&outputsize=${outputsize}&apikey=${API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Network error');
    
    const data = await response.json();
    if (data.code) throw new Error(data.message);
    if (!data.values) throw new Error('No data received');
    
    return data.values.map(candle => ({
        time: new Date(candle.datetime),
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume)
    }));
}

function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    const ema = [data[0].close];
    
    for (let i = 1; i < data.length; i++) {
        const value = (data[i].close - ema[i-1]) * multiplier + ema[i-1];
        ema.push(value);
    }
    return ema;
}

function calculateRSI(data, period = 14) {
    let gains = 0, losses = 0;
    
    for (let i = data.length - period; i < data.length; i++) {
        if (i === 0) continue;
        const change = data[i].close - data[i-1].close;
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateATR(data, period = 14) {
    const trueRanges = [];
    
    for (let i = 1; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = data[i-1].close;
        
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
    }
    
    return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function findSwingPoints(data, lookback = 5) {
    const highs = [], lows = [];
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true, isLow = true;
        
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (data[j].high >= data[i].high) isHigh = false;
            if (data[j].low <= data[i].low) isLow = false;
        }
        
        if (isHigh) highs.push({ price: data[i].high, index: i });
        if (isLow) lows.push({ price: data[i].low, index: i });
    }
    
    return { highs, lows };
}

function findOrderBlocks(data, swingPoints) {
    const orderBlocks = [];
    
    // Bullish order blocks
    for (let i = 1; i < swingPoints.lows.length; i++) {
        if (swingPoints.lows[i].price > swingPoints.lows[i-1].price) {
            const obCandle = data[swingPoints.lows[i].index - 1];
            if (obCandle) {
                orderBlocks.push({
                    type: 'bullish',
                    high: obCandle.high,
                    low: obCandle.low,
                    price: obCandle.close
                });
            }
        }
    }
    
    // Bearish order blocks
    for (let i = 1; i < swingPoints.highs.length; i++) {
        if (swingPoints.highs[i].price < swingPoints.highs[i-1].price) {
            const obCandle = data[swingPoints.highs[i].index - 1];
            if (obCandle) {
                orderBlocks.push({
                    type: 'bearish',
                    high: obCandle.high,
                    low: obCandle.low,
                    price: obCandle.close
                });
            }
        }
    }
    
    return orderBlocks;
}

function findFVGs(data) {
    const fvgs = [];
    
    for (let i = 2; i < data.length; i++) {
        const prev = data[i-2];
        const curr = data[i-1];
        const next = data[i];
        
        // Bullish FVG
        if (prev.high < next.low) {
            fvgs.push({
                type: 'bullish',
                upper: next.low,
                lower: prev.high,
                isFilled: curr.low <= prev.high
            });
        }
        
        // Bearish FVG
        if (prev.low > next.high) {
            fvgs.push({
                type: 'bearish',
                upper: prev.low,
                lower: next.high,
                isFilled: curr.high >= prev.low
            });
        }
    }
    
    return fvgs;
}

function calculateFibonacci(high, low, currentPrice) {
    const diff = high - low;
    
    const levels = {
        retracement: {
            level0: low,
            level236: low + diff * 0.236,
            level382: low + diff * 0.382,
            level500: low + diff * 0.5,
            level618: low + diff * 0.618,
            level786: low + diff * 0.786,
            level1000: high
        },
        extension: {
            level1272: high + diff * 0.272,
            level1414: high + diff * 0.414,
            level1618: high + diff * 0.618,
            level2000: high + diff,
            level2618: high + diff * 1.618
        }
    };
    
    // Find nearest Fibonacci level to current price
    let nearestLevel = null;
    let minDiff = Infinity;
    
    for (const [key, value] of Object.entries(levels.retracement)) {
        const diff = Math.abs(currentPrice - value);
        if (diff < minDiff) {
            minDiff = diff;
            nearestLevel = { key, value, type: 'retracement' };
        }
    }
    
    return { levels, nearestLevel };
}

function detectMarketStructure(swingPoints, currentPrice) {
    const lastHigh = swingPoints.highs[swingPoints.highs.length - 1];
    const lastLow = swingPoints.lows[swingPoints.lows.length - 1];
    const prevHigh = swingPoints.highs[swingPoints.highs.length - 2];
    const prevLow = swingPoints.lows[swingPoints.lows.length - 2];
    
    let structure = 'CHoCH';
    let bosLevel = null;
    let chochLevel = null;
    
    if (lastHigh && prevHigh && currentPrice > prevHigh.price) {
        structure = 'BOS ↑';
        bosLevel = prevHigh.price;
    } else if (lastLow && prevLow && currentPrice < prevLow.price) {
        structure = 'BOS ↓';
        bosLevel = prevLow.price;
    }
    
    if (lastHigh && lastLow && currentPrice > lastHigh.price) {
        chochLevel = lastHigh.price;
    } else if (lastLow && lastHigh && currentPrice < lastLow.price) {
        chochLevel = lastLow.price;
    }
    
    return { structure, bosLevel, chochLevel };
}

async function performFullAnalysis(price, timeframe) {
    try {
        const data = await fetchOHLCV(currentPair, timeframe, 100);
        if (!data || data.length < 30) throw new Error('Insufficient data');
        
        historicalData[timeframe] = data;
        
        // Calculate indicators
        const ema20 = calculateEMA(data, 20);
        const ema50 = calculateEMA(data, 50);
        const rsi = calculateRSI(data, 14);
        const atr = calculateATR(data, 14);
        
        // Find technical levels
        const swingPoints = findSwingPoints(data, 5);
        const orderBlocks = findOrderBlocks(data, swingPoints);
        const fvgs = findFVGs(data);
        const marketStructure = detectMarketStructure(swingPoints, price);
        
        // Determine trend
        const currentEMA20 = ema20[ema20.length - 1];
        const currentEMA50 = ema50[ema50.length - 1];
        const prevEMA20 = ema20[ema20.length - 2];
        
        let trend = 'neutral';
        let strength = 'Weak';
        
        if (currentEMA20 > currentEMA50 && currentEMA20 > prevEMA20) {
            trend = 'bullish';
            strength = rsi > 55 ? 'Strong' : 'Medium';
        } else if (currentEMA20 < currentEMA50 && currentEMA20 < prevEMA20) {
            trend = 'bearish';
            strength = rsi < 45 ? 'Strong' : 'Medium';
        }
        
        // Fibonacci calculation
        const recentHigh = Math.max(...data.slice(-20).map(c => c.high));
        const recentLow = Math.min(...data.slice(-20).map(c => c.low));
        const fibonacci = calculateFibonacci(recentHigh, recentLow, price);
        
        // Generate signal with multiple confirmations
        let signal = null;
        let confidenceScore = 0;
        
        // Trend alignment (30 points)
        if (trend !== 'neutral') confidenceScore += 30;
        
        // RSI confirmation (20 points)
        if ((trend === 'bullish' && rsi > 40 && rsi < 70) ||
            (trend === 'bearish' && rsi < 60 && rsi > 30)) {
            confidenceScore += 20;
        }
        
        // Order block proximity (25 points)
        const nearestOB = orderBlocks[0];
        if (nearestOB) {
            const distanceToOB = Math.abs(price - nearestOB.price) / price * 100;
            if (distanceToOB < 1) confidenceScore += 25;
            else if (distanceToOB < 2) confidenceScore += 15;
        }
        
        // FVG confirmation (15 points)
        const activeFVG = fvgs.find(f => !f.isFilled);
        if (activeFVG && ((trend === 'bullish' && activeFVG.type === 'bullish') ||
            (trend === 'bearish' && activeFVG.type === 'bearish')))
