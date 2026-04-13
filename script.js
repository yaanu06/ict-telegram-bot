const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// API Keys
const TWELVE_DATA_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';
const ALPHA_VANTAGE_KEY = 'E4HPPIL10X34R418';

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ============================================
// API FUNCTIONS
// ============================================

async function getCurrentPrice() {
    // Try Twelve Data
    try {
        const url = `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.price && !isNaN(data.price)) {
            return parseFloat(data.price);
        }
    } catch(e) { console.log('Twelve error:', e); }
    
    // Try Alpha Vantage
    try {
        let fromCurr, toCurr;
        if (currentPair === 'BTC/USD') { fromCurr = 'BTC'; toCurr = 'USD'; }
        else if (currentPair === 'ETH/USD') { fromCurr = 'ETH'; toCurr = 'USD'; }
        else if (currentPair === 'EUR/USD') { fromCurr = 'EUR'; toCurr = 'USD'; }
        else if (currentPair === 'GBP/USD') { fromCurr = 'GBP'; toCurr = 'USD'; }
        else if (currentPair === 'XAU/USD') { fromCurr = 'XAU'; toCurr = 'USD'; }
        else { return null; }
        
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurr}&to_currency=${toCurr}&apikey=${ALPHA_VANTAGE_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data['Realtime Currency Exchange Rate']) {
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
    } catch(e) { console.log('Alpha error:', e); }
    
    return null;
}

async function getHistoricalData() {
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${currentPair}&interval=${intervals[currentTimeframe]}&outputsize=50&apikey=${TWELVE_DATA_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.values && data.values.length > 0) {
            return data.values.map(c => ({
                close: parseFloat(c.close),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                volume: parseFloat(c.volume) || 1000000
            }));
        }
    } catch(e) { console.log('History error:', e); }
    
    return null;
}

// ============================================
// TECHNICAL CALCULATIONS
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
    const start = Math.max(0, prices.length - period);
    for (let i = start + 1; i < prices.length; i++) {
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

// ============================================
// MAIN ANALYSIS
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market...', 'info');

    try {
        // Get current price
        const currentPrice = await getCurrentPrice();
        if (!currentPrice) throw new Error('Could not get price');
        
        // Get historical data
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 20) throw new Error('Insufficient data');
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        // Calculate indicators
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        
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
        
        // Find support/resistance levels
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        // Fibonacci levels
        const fib382 = recentLow + range * 0.382;
        const fib500 = recentLow + range * 0.5;
        const fib618 = recentLow + range * 0.618;
        
        // Calculate IDEAL ENTRY ZONE based on trend
        let idealEntryZone = null;
        let entryInstruction = '';
        let distanceToZone = 0;
        
        if (trend === 'bullish') {
            // For LONG: Entry zone is SUPPORT (Fibonacci 61.8% or recent low)
            idealEntryZone = Math.max(fib618, recentLow + atr);
            entryInstruction = '⬇️ Wait for price to PULL BACK DOWN to entry zone';
            distanceToZone = currentPrice - idealEntryZone;
        } else if (trend === 'bearish') {
            // For SHORT: Entry zone is RESISTANCE (Fibonacci 61.8% or recent high)
            idealEntryZone = Math.min(fib618, recentHigh - atr);
            entryInstruction = '⬆️ Wait for price to PULL BACK UP to entry zone';
            distanceToZone = idealEntryZone - currentPrice;
        } else {
            idealEntryZone = currentPrice;
            entryInstruction = 'No clear trend - Wait for setup';
            distanceToZone = 0;
        }
        
        // Calculate progress to zone (0-100%)
        let progress = 0;
        let distanceText = '';
        const maxDistance = atr * 3;
        
        if (distanceToZone > 0) {
            progress = Math.min(100, (1 - distanceToZone / maxDistance) * 100);
            distanceText = `$${distanceToZone.toFixed(2)} away from entry zone`;
        } else if (distanceToZone < 0) {
            progress = 100;
            distanceText = `✅ Price is ABOVE entry zone - Too late for entry`;
        } else {
            progress = 100;
            distanceText = `✅ Price IN entry zone - Ready to enter!`;
        }
        
        // Calculate confidence
        let confidence = 40;
        if (trend !== 'neutral') confidence += 20;
        if (strength === 'Strong') confidence += 15;
        if (rsi > 30 && rsi < 70) confidence += 10;
        if (progress > 70) confidence += 15;
        confidence = Math.min(confidence, 98);
        
        // Determine signal
        let signalType = 'NEUTRAL';
        let entry = currentPrice;
        let sl = 0;
        let tp = 0;
        let rr = 'N/A';
        
        if (trend === 'bullish' && confidence >= 55) {
            signalType = 'LONG';
            entry = currentPrice;
            sl = entry - (atr * 1.5);
            tp = entry + (atr * 2.5);
            rr = ((tp - entry) / (entry - sl)).toFixed(1);
        } else if (trend === 'bearish' && confidence >= 55) {
            signalType = 'SHORT';
            entry = currentPrice;
            sl = entry + (atr * 1.5);
            tp = entry - (atr * 2.5);
            rr = ((entry - tp) / (sl - entry)).toFixed(1);
        }
        
        // Check for divergence (simplified)
        let divergence = '';
        if (rsi < 30 && trend === 'bearish') divergence = 'Bullish Divergence Possible';
        if (rsi > 70 && trend === 'bullish') divergence = 'Bearish Divergence Possible';
        
        // ============================================
        // UPDATE UI
        // ============================================
        
        // Current Price
        document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(2)}`;
        if (lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
            const changeEl = document.getElementById('priceChange');
            changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
            changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
        }
        lastPrice = currentPrice;
        
        // Entry Zone
        document.getElementById('idealEntryZone').innerHTML = `$${idealEntryZone.toFixed(2)}`;
        document.getElementById('entryInstruction').innerHTML = entryInstruction;
        document.getElementById('zoneProgress').style.width = `${progress}%`;
        document.getElementById('distanceText').innerHTML = distanceText;
        
        // Signal Card
        const signalTypeBox = document.getElementById('signalTypeText');
        signalTypeBox.innerHTML = signalType;
        signalTypeBox.parentElement.className = `signal-type-box ${signalType.toLowerCase()}`;
        
        document.getElementById('confidenceText').innerHTML = `${confidence}%`;
        document.getElementById('entryPrice').innerHTML = `$${entry.toFixed(2)}`;
        document.getElementById('takeProfit').innerHTML = tp > 0 ? `$${tp.toFixed(2)}` : '--';
        document.getElementById('stopLoss').innerHTML = sl > 0 ? `$${sl.toFixed(2)}` : '--';
        document.getElementById('riskReward').innerHTML = rr;
        
        // Signal Reason
        let reason = `${trend === 'bullish' ? '📈 Bullish' : (trend === 'bearish' ? '📉 Bearish' : '⚪ Neutral')} trend | ${strength} strength | RSI: ${rsi.toFixed(1)}`;
        if (divergence) reason += ` | ${divergence}`;
        if (progress > 70) reason += ' | Price near entry zone';
        document.getElementById('signalReason').innerHTML = reason;
        
        // Badge
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
        
        // 4H Analysis
        document.getElementById('trend4H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend4H').className = `trend ${trend}`;
        document.getElementById('strength4H').innerHTML = strength;
        document.getElementById('poc4H').innerHTML = `$${((recentHigh + recentLow)/2).toFixed(2)}`;
        
        // 1H Analysis
        document.getElementById('trend1H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend1H').className = `trend ${trend}`;
        document.getElementById('rsi1H').innerHTML = rsi.toFixed(1);
        document.getElementById('divergence1H').innerHTML = divergence || 'None';
        
        // Enable/disable execute button
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= 55 && progress >= 70;
        executeBtn.disabled = !shouldExecute;
        
        // Store analysis data
        analysisData = { signalType, entry, tp, sl, rr, confidence, currentPair, currentPrice };
        
        // Update API count
        apiCalls++;
        document.getElementById('apiUsage').innerHTML = `${apiCalls}`;
        showNotification(`Analysis complete! ${signalType} signal with ${confidence}% confidence`, 'success');
        
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
        document.getElementById('currentPrice').innerHTML = 'ERROR';
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ============================================
// UI FUNCTIONS
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
    const el = document.getElementById('liveTime');
    if (el) el.innerHTML = `${dateStr} ${timeStr} UTC`;
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
}

function updatePairsByCategory(category) {
    const pairs = {
        crypto: ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'],
        metals: ['XAU/USD', 'XAG/USD', 'XPT/USD', 'XPD/USD']
    };
    pairSelect.innerHTML = pairs[category].map(p => `<option value="${p}">${p}</option>`).join('');
    currentPair = pairs[category][0];
    resetAnalysis();
}

function resetAnalysis() {
    document.getElementById('currentPrice').innerHTML = '----';
    document.getElementById('priceChange').innerHTML = '--';
    document.getElementById('idealEntryZone').innerHTML = '--';
    document.getElementById('entryInstruction').innerHTML = '--';
    document.getElementById('zoneProgress').style.width = '0%';
    document.getElementById('distanceText').innerHTML = '--';
    document.getElementById('signalTypeText').innerHTML = '--';
    document.getElementById('confidenceText').innerHTML = '--';
    document.getElementById('entryPrice').innerHTML = '--';
    document.getElementById('takeProfit').innerHTML = '--';
    document.getElementById('stopLoss').innerHTML = '--';
    document.getElementById('riskReward').innerHTML = '--';
    document.getElementById('signalReason').innerHTML = '--';
    document.getElementById('trend4H').innerHTML = '--';
    document.getElementById('strength4H').innerHTML = '--';
    document.getElementById('poc4H').innerHTML = '--';
    document.getElementById('trend1H').innerHTML = '--';
    document.getElementById('rsi1H').innerHTML = '--';
    document.getElementById('divergence1H').innerHTML = '--';
    executeBtn.disabled = true;
}

function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify({
            action: 'execute_order',
            pair: currentPair,
            signal: analysisData.signalType,
            entry: analysisData.entry,
            tp: analysisData.tp,
            sl: analysisData.sl,
            confidence: analysisData.confidence,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order executed! Entry: $${analysisData.entry.toFixed(2)}`, 'success');
}

function showNotification(message, type) {
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 3000);
}

// Start
init();
