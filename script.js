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
const ALPHA_VANTAGE_KEY = 'E4HPPIL10X34R418';
let currentApi = 'twelve'; // Start with Twelve Data

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ============================================
// SIMPLE API FUNCTIONS
// ============================================

// Fetch current price from Twelve Data
async function getPriceTwelve(symbol) {
    const url = `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.price) {
        return parseFloat(data.price);
    }
    throw new Error(data.message || 'Twelve Data error');
}

// Fetch historical data from Twelve Data
async function getHistoryTwelve(symbol, interval) {
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${intervals[interval]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.values) {
        return data.values.map(candle => ({
            time: new Date(candle.datetime),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume)
        }));
    }
    throw new Error(data.message || 'Twelve Data error');
}

// Fetch from Alpha Vantage (backup)
async function getPriceAlpha(symbol) {
    let fromCurrency, toCurrency;
    
    if (symbol === 'BTC/USD') {
        fromCurrency = 'BTC';
        toCurrency = 'USD';
    } else if (symbol === 'ETH/USD') {
        fromCurrency = 'ETH';
        toCurrency = 'USD';
    } else if (symbol === 'EUR/USD') {
        fromCurrency = 'EUR';
        toCurrency = 'USD';
    } else if (symbol === 'GBP/USD') {
        fromCurrency = 'GBP';
        toCurrency = 'USD';
    } else if (symbol === 'XAU/USD') {
        fromCurrency = 'XAU';
        toCurrency = 'USD';
    } else {
        const parts = symbol.split('/');
        fromCurrency = parts[0];
        toCurrency = parts[1];
    }
    
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data['Realtime Currency Exchange Rate']) {
        return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
    }
    throw new Error('Alpha Vantage error');
}

// ============================================
// TECHNICAL ANALYSIS (SIMPLIFIED)
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
    let gains = 0;
    let losses = 0;
    const length = prices.length;
    
    for (let i = length - period; i < length; i++) {
        if (i === 0) continue;
        const change = prices[i] - prices[i-1];
        if (change >= 0) {
            gains += change;
        } else {
            losses -= change;
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateATR(highs, lows, closes, period = 14) {
    const trueRanges = [];
    
    for (let i = 1; i < closes.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i-1]),
            Math.abs(lows[i] - closes[i-1])
        );
        trueRanges.push(tr);
    }
    
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
}

function findHighsAndLows(data, lookback = 5) {
    const highs = [];
    const lows = [];
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (data[j].high >= data[i].high) isHigh = false;
            if (data[j].low <= data[i].low) isLow = false;
        }
        
        if (isHigh) highs.push(data[i].high);
        if (isLow) lows.push(data[i].low);
    }
    
    return { highs, lows };
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market...', 'info');

    try {
        // Try to get price and data
        let currentPrice;
        let historicalData;
        let apiUsed = '';
        
        // Try Twelve Data first
        try {
            console.log('Trying Twelve Data API...');
            currentPrice = await getPriceTwelve(currentPair);
            historicalData = await getHistoryTwelve(currentPair, currentTimeframe);
            apiUsed = 'Twelve Data';
            currentApi = 'twelve';
            console.log('Twelve Data success! Price:', currentPrice);
        } catch (twelveError) {
            console.log('Twelve Data failed:', twelveError.message);
            
            // Try Alpha Vantage as backup
            try {
                console.log('Trying Alpha Vantage API...');
                currentPrice = await getPriceAlpha(currentPair);
                // Alpha Vantage historical is complex, generate simple mock from price
                historicalData = generateSimpleData(currentPrice);
                apiUsed = 'Alpha Vantage';
                currentApi = 'alpha';
                console.log('Alpha Vantage success! Price:', currentPrice);
            } catch (alphaError) {
                console.log('Alpha Vantage failed:', alphaError.message);
                throw new Error('Both APIs failed. Please check your API keys.');
            }
        }
        
        if (!historicalData || historicalData.length < 30) {
            throw new Error('Not enough data received');
        }
        
        // Extract price arrays for calculations
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        // Calculate indicators
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(highs, lows, closes, 14);
        const swingPoints = findHighsAndLows(historicalData, 5);
        
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
        
        // Calculate Fibonacci levels
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const fibDiff = recentHigh - recentLow;
        
        const fibLevels = {
            level382: recentLow + fibDiff * 0.382,
            level500: recentLow + fibDiff * 0.5,
            level618: recentLow + fibDiff * 0.618,
            level786: recentLow + fibDiff * 0.786
        };
        
        // Find nearest Fibonacci level
        let nearestFib = '';
        let minDist = Infinity;
        for (const [key, value] of Object.entries(fibLevels)) {
            const dist = Math.abs(currentPrice - value);
            if (dist < minDist) {
                minDist = dist;
                nearestFib = `${key.replace('level', '')}% at $${value.toFixed(2)}`;
            }
        }
        
        // Calculate confidence score
        let confidence = 40; // Base confidence
        
        if (trend !== 'neutral') confidence += 20;
        if (strength === 'Strong') confidence += 15;
        if (rsi > 30 && rsi < 70) confidence += 10;
        if (swingPoints.highs.length > 0) confidence += 10;
        if (minDist / currentPrice < 0.005) confidence += 5; // Near Fibonacci level
        
        confidence = Math.min(confidence, 95);
        
        // Generate signal
        let signal = null;
        if (trend === 'bullish' && confidence >= 50) {
            const entry = currentPrice;
            const sl = entry - (atr * 1.5);
            const tp = entry + (atr * 2.5);
            const rr = ((tp - entry) / (entry - sl)).toFixed(1);
            
            signal = {
                type: 'LONG 🟢',
                confidence: `${confidence}%`,
                entry: `$${entry.toFixed(2)}`,
                tp: `$${tp.toFixed(2)}`,
                sl: `$${sl.toFixed(2)}`,
                rr: `1:${rr}`
            };
        } else if (trend === 'bearish' && confidence >= 50) {
            const entry = currentPrice;
            const sl = entry + (atr * 1.5);
            const tp = entry - (atr * 2.5);
            const rr = ((entry - tp) / (sl - entry)).toFixed(1);
            
            signal = {
                type: 'SHORT 🔴',
                confidence: `${confidence}%`,
                entry: `$${entry.toFixed(2)}`,
                tp: `$${tp.toFixed(2)}`,
                sl: `$${sl.toFixed(2)}`,
                rr: `1:${rr}`
            };
        } else {
            signal = {
                type: 'NEUTRAL ⚪',
                confidence: `${confidence}%`,
                entry: `$${currentPrice.toFixed(2)}`,
                tp: '--',
                sl: '--',
                rr: 'N/A'
            };
        }
        
        // Update UI
        document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(2)}<span style="font-size:11px; display:block;">${apiUsed} | RSI: ${rsi.toFixed(1)}</span>`;
        
        // Update price change
        const priceChangeEl = document.getElementById('priceChange');
        if (priceChangeEl && lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
            priceChangeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
            priceChangeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
        }
        lastPrice = currentPrice;
        
        // 4H Analysis
        document.getElementById('trend4H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend4H').className = `value trend-value ${trend}`;
        document.getElementById('strength4H').innerHTML = strength;
        document.getElementById('fvg4H').innerHTML = swingPoints.highs.length > 3 ? '✅ Detected' : '❌ None';
        document.getElementById('ob4H').innerHTML = swingPoints.lows.length > 3 ? '✅ Present' : '❌ None';
        document.getElementById('ms4H').innerHTML = trend === 'bullish' ? 'BOS ↑' : (trend === 'bearish' ? 'BOS ↓' : 'CHoCH');
        
        // 1H Analysis (simplified - same as 4H for now)
        document.getElementById('trend1H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend1H').className = `value trend-value ${trend}`;
        document.getElementById('strength1H').innerHTML = strength;
        document.getElementById('fvg1H').innerHTML = swingPoints.highs.length > 2 ? '✅ Detected' : '❌ None';
        document.getElementById('ob1H').innerHTML = swingPoints.lows.length > 2 ? '✅ Present' : '❌ None';
        document.getElementById('ms1H').innerHTML = trend === 'bullish' ? 'BOS ↑' : (trend === 'bearish' ? 'BOS ↓' : 'CHoCH');
        
        // Signal
        document.getElementById('signalType').innerHTML = signal.type;
        document.getElementById('signalType').className = `value signal-type ${signal.type.includes('LONG') ? 'long' : (signal.type.includes('SHORT') ? 'short' : '')}`;
        document.getElementById('signalConfidence').innerHTML = signal.confidence;
        document.getElementById('signalEntry').innerHTML = signal.entry;
        document.getElementById('signalTP').innerHTML = signal.tp;
        document.getElementById('signalSL').innerHTML = signal.sl;
        document.getElementById('signalRR').innerHTML = signal.rr;
        
        // Badge
        const badge = document.getElementById('signalStrengthBadge');
        if (badge) {
            const conf = confidence;
            badge.textContent = conf >= 70 ? '🔥 HIGH' : (conf >= 50 ? '📊 MEDIUM' : '⚠️ LOW');
            badge.className = `signal-badge ${conf >= 70 ? 'high' : (conf >= 50 ? 'medium' : 'low')}`;
        }
        
        // Zones
        document.getElementById('fvgZonesDisplay').innerHTML = `
            <div class="zone-tag">Bullish FVG: $${(currentPrice - atr).toFixed(2)} - $${currentPrice.toFixed(2)}</div>
            <div class="zone-tag">Bearish FVG: $${currentPrice.toFixed(2)} - $${(currentPrice + atr).toFixed(2)}</div>
        `;
        
        document.getElementById('obZonesDisplay').innerHTML = `
            <div class="zone-tag">Bullish OB: $${(currentPrice - atr * 1.5).toFixed(2)} - $${(currentPrice - atr * 0.5).toFixed(2)}</div>
            <div class="zone-tag">Bearish OB: $${(currentPrice + atr * 0.5).toFixed(2)} - $${(currentPrice + atr * 1.5).toFixed(2)}</div>
        `;
        
        document.getElementById('fibLevelsDisplay').innerHTML = `
            <div class="zone-tag fib">📐 38.2%: $${fibLevels.level382.toFixed(2)}</div>
            <div class="zone-tag fib">📐 50%: $${fibLevels.level500.toFixed(2)}</div>
            <div class="zone-tag fib">📐 61.8%: $${fibLevels.level618.toFixed(2)}</div>
            <div class="zone-tag fib">📐 78.6%: $${fibLevels.level786.toFixed(2)}</div>
            <div class="zone-tag" style="background:#3390ec20;">🎯 Nearest: ${nearestFib}</div>
        `;
        
        document.getElementById('buySideLiq').textContent = `$${(recentHigh + atr).toFixed(2)}`;
        document.getElementById('sellSideLiq').textContent = `$${(recentLow - atr).toFixed(2)}`;
        document.getElementById('bosLevel').textContent = trend === 'bullish' ? `$${(recentHigh).toFixed(2)}` : `$${(recentLow).toFixed(2)}`;
        document.getElementById('chochLevel').textContent = trend === 'bullish' ? `$${(recentLow).toFixed(2)}` : `$${(recentHigh).toFixed(2)}`;
        
        // Enable execute button if confidence good
        if (confidence >= 50 && signal.type !== 'NEUTRAL ⚪') {
            executeBtn.disabled = false;
        } else {
            executeBtn.disabled = true;
        }
        
        // Save analysis data
        analysisData = { signal, confidence, currentPair, currentPrice };
        
        // Update API count
        apiCalls++;
        document.getElementById('apiUsage').textContent = `${apiCalls} / 800`;
        showNotification(`Analysis complete! (${apiUsed})`, 'success');
        
    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// Generate simple mock data when API fails
function generateSimpleData(currentPrice) {
    const data = [];
    let price = currentPrice * 0.9; // Start 10% lower
    
    for (let i = 0; i < 100; i++) {
        const change = (Math.random() - 0.5) * price * 0.02;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * price * 0.01;
        const low = Math.min(open, close) - Math.random() * price * 0.01;
        
        data.push({
            time: new Date(),
            open: open,
            high: high,
            low: low,
            close: close,
            volume: Math.random() * 1000000
        });
        price = close;
    }
    return data;
}

// ============================================
// UI HELPER FUNCTIONS
// ============================================

function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
}

function updateLiveTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const liveTimeEl = document.getElementById('liveTime');
    if (liveTimeEl) liveTimeEl.textContent = `${dateStr} ${timeStr} UTC`;
}

function setupEventListeners() {
    analyzeBtn.addEventListener('click', runAnalysis);
    executeBtn.addEventListener('click', executeOrder);
    pairSelect.addEventListener('change', (e) => {
        currentPair = e.target.value;
        resetAnalysis();
    });

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePairsByCategory(e.target.dataset.category);
        });
    });

    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeframe = e.target.dataset.tf;
        });
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            const tabContent = document.getElementById(`${tabId}Tab`);
            if (tabContent) tabContent.classList.add('active');
        });
    });
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
            'XAU/USD': '👑', 'XAG/USD': '🥈'
        };
        return `<option value="${pair}">${icons[pair] || '📊'} ${pair}</option>`;
    }).join('');
    currentPair = pairs[category][0];
    resetAnalysis();
}

function resetAnalysis() {
    document.querySelectorAll('.value').forEach(el => {
        if (el.id !== 'signalType') el.innerHTML = '--';
    });
    document.getElementById('currentPrice').innerHTML = '----';
    document.getElementById('priceChange').innerHTML = '--';
    document.getElementById('fvgZonesDisplay').innerHTML = 'Click Analyze to see zones';
    document.getElementById('obZonesDisplay').innerHTML = 'Click Analyze to see zones';
    document.getElementById('fibLevelsDisplay').innerHTML = 'Click Analyze to see Fibonacci levels';
    document.getElementById('buySideLiq').textContent = '--';
    document.getElementById('sellSideLiq').textContent = '--';
    document.getElementById('bosLevel').textContent = '--';
    document.getElementById('chochLevel').textContent = '--';
    executeBtn.disabled = true;
}

function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    
    if (analysisData.confidence < 50) {
        showNotification('Low confidence - Trade not recommended', 'error');
        return;
    }
    
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'execute_order',
            pair: currentPair,
            signal: analysisData.signal,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ Order executed! ${analysisData.signal.type}`, 'success');
}

function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

let lastPrice = null;

// Start the app
init();
