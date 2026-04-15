// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// API Keys
const TWELVE_DATA_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';
const ALPHA_VANTAGE_KEY = 'E4HPPIL10X34R418';

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
    init();
});

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
    const analyzeBtn = document.getElementById('analyzeBtn');
    const executeBtn = document.getElementById('executeBtn');
    const pairSelect = document.getElementById('pairSelect');
    
    if (analyzeBtn) analyzeBtn.addEventListener('click', runAnalysis);
    if (executeBtn) executeBtn.addEventListener('click', executeOrder);
    if (pairSelect) pairSelect.addEventListener('change', function(e) {
        currentPair = e.target.value;
    });

    // Category buttons
    const categoryBtns = document.querySelectorAll('.category-btn');
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            categoryBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            updatePairsByCategory(this.dataset.category);
        });
    });

    // Timeframe buttons
    const tfBtns = document.querySelectorAll('.tf-btn');
    tfBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            tfBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentTimeframe = this.dataset.tf;
        });
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
        pairSelect.innerHTML = pairs[category].map(p => `<option value="${p}">${p}</option>`).join('');
        currentPair = pairs[category][0];
    }
}

async function getPrice() {
    // Try Twelve Data
    try {
        const url = `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.price && !isNaN(data.price)) {
            const apiSource = document.getElementById('apiSource');
            if (apiSource) apiSource.innerHTML = '📡 Twelve Data';
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
            const apiSource = document.getElementById('apiSource');
            if (apiSource) apiSource.innerHTML = '📡 Alpha Vantage';
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
    } catch(e) { console.log('Alpha error:', e); }
    
    return null;
}

async function getHistoricalData() {
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${currentPair}&interval=${intervals[currentTimeframe]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.values && data.values.length > 30) {
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
    
    for (const candle of data) {
        for (const level of levels) {
            if (candle.high >= level.low && candle.low <= level.high) {
                const overlap = Math.min(candle.high, level.high) - Math.max(candle.low, level.low);
                const percent = overlap / (candle.high - candle.low);
                level.volume += candle.volume * percent;
            }
        }
    }
    
    let maxVol = 0, poc = null;
    for (const level of levels) {
        if (level.volume > maxVol) {
            maxVol = level.volume;
            poc = level;
        }
    }
    
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
    
    const vaHigh = Math.max(...valueArea.map(l => l.high));
    const vaLow = Math.min(...valueArea.map(l => l.low));
    
    return { poc, valueAreaHigh: vaHigh, valueAreaLow: vaLow, totalVolume: totalVol };
}

function calculateOrderFlow(data) {
    if (!data || data.length < 10) return null;
    
    let buyPressure = 0, sellPressure = 0, absorption = 0;
    
    for (let i = 0; i < data.length; i++) {
        const candle = data[i];
        const isBullish = candle.close > candle.open;
        const body = Math.abs(candle.close - candle.open);
        const wickUp = candle.high - Math.max(candle.open, candle.close);
        const wickDown = Math.min(candle.open, candle.close) - candle.low;
        
        if (isBullish) {
            buyPressure += candle.volume * 0.7;
            sellPressure += candle.volume * 0.3;
        } else {
            buyPressure += candle.volume * 0.3;
            sellPressure += candle.volume * 0.7;
        }
        
        if (wickUp > body * 1.5 || wickDown > body * 1.5) absorption++;
    }
    
    let pv = 0, vol = 0;
    for (const candle of data) {
        const tp = (candle.high + candle.low + candle.close) / 3;
        pv += tp * candle.volume;
        vol += candle.volume;
    }
    const vwap = pv / vol;
    
    return {
        buyingPressure: buyPressure,
        sellingPressure: sellPressure,
        netDelta: buyPressure - sellPressure,
        vwap: vwap,
        absorptionSignals: absorption
    };
}

async function runAnalysis() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market...', 'info');

    try {
        const currentPrice = await getPrice();
        if (!currentPrice) throw new Error('Could not get price');
        
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 30) throw new Error('Insufficient data');
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        const volumeProfile = calculateVolumeProfile(historicalData);
        const orderFlow = calculateOrderFlow(historicalData);
        
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
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        const fib382 = recentLow + range * 0.382;
        const fib500 = recentLow + range * 0.5;
        const fib618 = recentLow + range * 0.618;
        const fib786 = recentLow + range * 0.786;
        
        let idealEntry = currentPrice;
        let stopLoss = 0;
        let takeProfit = 0;
        let signalType = 'NEUTRAL';
        let confidence = 40;
        
        if (trend === 'bullish') {
            signalType = 'LONG';
            idealEntry = Math.max(fib618, volumeProfile?.valueAreaLow || recentLow);
            if (idealEntry >= currentPrice) idealEntry = currentPrice - (atr * 1);
            stopLoss = idealEntry - (atr * 1.2);
            takeProfit = currentPrice + (atr * 2);
            confidence = 55 + (rsi > 50 ? 10 : 0) + (orderFlow?.netDelta > 0 ? 10 : 0);
            confidence = Math.min(confidence, 95);
        } else if (trend === 'bearish') {
            signalType = 'SHORT';
            idealEntry = Math.min(fib382, volumeProfile?.valueAreaHigh || recentHigh);
            if (idealEntry <= currentPrice) idealEntry = currentPrice + (atr * 1);
            stopLoss = idealEntry + (atr * 1.2);
            takeProfit = currentPrice - (atr * 2);
            confidence = 55 + (rsi < 50 ? 10 : 0) + (orderFlow?.netDelta < 0 ? 10 : 0);
            confidence = Math.min(confidence, 95);
        }
        
        let riskReward = 'N/A';
        if (signalType === 'LONG') {
            const risk = idealEntry - stopLoss;
            const reward = takeProfit - idealEntry;
            if (risk > 0) riskReward = (reward / risk).toFixed(1);
        } else if (signalType === 'SHORT') {
            const risk = stopLoss - idealEntry;
            const reward = idealEntry - takeProfit;
            if (risk > 0) riskReward = (reward / risk).toFixed(1);
        }
        
        let progress = 100;
        let distanceText = 'Ready to enter';
        if (signalType === 'LONG' && idealEntry < currentPrice) {
            const distance = currentPrice - idealEntry;
            const maxDist = atr * 2;
            progress = Math.min(100, (1 - distance / maxDist) * 100);
            distanceText = `$${distance.toFixed(2)} above ideal entry - Wait for pullback`;
        } else if (signalType === 'SHORT' && idealEntry > currentPrice) {
            const distance = idealEntry - currentPrice;
            const maxDist = atr * 2;
            progress = Math.min(100, (1 - distance / maxDist) * 100);
            distanceText = `$${distance.toFixed(2)} below ideal entry - Wait for rally`;
        }
        
        // Update UI
        const currentPriceEl = document.getElementById('currentPrice');
        if (currentPriceEl) currentPriceEl.innerHTML = `$${currentPrice.toFixed(2)}`;
        
        if (lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
            const changeEl = document.getElementById('priceChange');
            if (changeEl) {
                changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
                changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
            }
        }
        lastPrice = currentPrice;
        
        const signalTypeText = document.getElementById('signalTypeText');
        if (signalTypeText) signalTypeText.innerHTML = signalType;
        const signalTypeBox = document.getElementById('signalTypeBox');
        if (signalTypeBox) signalTypeBox.className = `signal-type-box ${signalType.toLowerCase()}`;
        
        const confidenceText = document.getElementById('confidenceText');
        if (confidenceText) confidenceText.innerHTML = `${confidence}%`;
        const idealEntryDisplay = document.getElementById('idealEntryDisplay');
        if (idealEntryDisplay) idealEntryDisplay.innerHTML = `$${idealEntry.toFixed(2)}`;
        const entryPrice = document.getElementById('entryPrice');
        if (entryPrice) entryPrice.innerHTML = `$${currentPrice.toFixed(2)}`;
        const takeProfitEl = document.getElementById('takeProfit');
        if (takeProfitEl) takeProfitEl.innerHTML = `$${takeProfit.toFixed(2)}`;
        const stopLossEl = document.getElementById('stopLoss');
        if (stopLossEl) stopLossEl.innerHTML = `$${stopLoss.toFixed(2)}`;
        const riskRewardEl = document.getElementById('riskReward');
        if (riskRewardEl) riskRewardEl.innerHTML = riskReward;
        
        const signalReason = document.getElementById('signalReason');
        if (signalReason) {
            signalReason.innerHTML = `${trend === 'bullish' ? '📈 Bullish' : (trend === 'bearish' ? '📉 Bearish' : '⚪ Neutral')} trend | ${strength} | RSI: ${rsi.toFixed(1)}`;
        }
        
        const badge = document.getElementById('signalBadge');
        if (badge) {
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
        
        if (volumeProfile) {
            const pocValue = document.getElementById('pocValue');
            if (pocValue) pocValue.innerHTML = `$${volumeProfile.poc?.price.toFixed(2) || '--'}`;
            const valueHigh = document.getElementById('valueHigh');
            if (valueHigh) valueHigh.innerHTML = `$${volumeProfile.valueAreaHigh?.toFixed(2) || '--'}`;
            const valueLow = document.getElementById('valueLow');
            if (valueLow) valueLow.innerHTML = `$${volumeProfile.valueAreaLow?.toFixed(2) || '--'}`;
            const totalVolume = document.getElementById('totalVolume');
            if (totalVolume) totalVolume.innerHTML = `${(volumeProfile.totalVolume / 1000000).toFixed(1)}M`;
        }
        
        if (orderFlow) {
            const buyingPressure = document.getElementById('buyingPressure');
            if (buyingPressure) buyingPressure.innerHTML = `${(orderFlow.buyingPressure / 1000000).toFixed(1)}M`;
            const sellingPressure = document.getElementById('sellingPressure');
            if (sellingPressure) sellingPressure.innerHTML = `${(orderFlow.sellingPressure / 1000000).toFixed(1)}M`;
            const netDelta = document.getElementById('netDelta');
            if (netDelta) netDelta.innerHTML = `${(orderFlow.netDelta / 1000000).toFixed(1)}M`;
            const vwapValue = document.getElementById('vwapValue');
            if (vwapValue) vwapValue.innerHTML = `$${orderFlow.vwap.toFixed(2)}`;
        }
        
        const trend4H = document.getElementById('trend4H');
        if (trend4H) {
            trend4H.innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
            trend4H.className = `trend ${trend}`;
        }
        const rsi4H = document.getElementById('rsi4H');
        if (rsi4H) rsi4H.innerHTML = rsi.toFixed(1);
        const atr4H = document.getElementById('atr4H');
        if (atr4H) atr4H.innerHTML = `$${atr.toFixed(2)}`;
        
        const trend1H = document.getElementById('trend1H');
        if (trend1H) {
            trend1H.innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
            trend1H.className = `trend ${trend}`;
        }
        
        const fib382El = document.getElementById('fib382');
        if (fib382El) fib382El.innerHTML = `$${fib382.toFixed(2)}`;
        const fib500El = document.getElementById('fib500');
        if (fib500El) fib500El.innerHTML = `$${fib500.toFixed(2)}`;
        const fib618El = document.getElementById('fib618');
        if (fib618El) fib618El.innerHTML = `$${fib618.toFixed(2)}`;
        const fib786El = document.getElementById('fib786');
        if (fib786El) fib786El.innerHTML = `$${fib786.toFixed(2)}`;
        
        const idealEntryZone = document.getElementById('idealEntryZone');
        if (idealEntryZone) idealEntryZone.innerHTML = `$${idealEntry.toFixed(2)}`;
        const zoneProgress = document.getElementById('zoneProgress');
        if (zoneProgress) zoneProgress.style.width = `${progress}%`;
        const distanceTextEl = document.getElementById('distanceText');
        if (distanceTextEl) distanceTextEl.innerHTML = distanceText;
        
        const executeBtn = document.getElementById('executeBtn');
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= 55 && progress >= 90;
        if (executeBtn) executeBtn.disabled = !shouldExecute;
        
        analysisData = { signalType, idealEntry, currentPrice, stopLoss, takeProfit, confidence };
        
        apiCalls++;
        const apiUsage = document.getElementById('apiUsage');
        if (apiUsage) apiUsage.innerHTML = `${apiCalls}`;
        showNotification(`Analysis complete! ${signalType} signal`, 'success');
        
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
        const currentPriceEl = document.getElementById('currentPrice');
        if (currentPriceEl) currentPriceEl.innerHTML = 'ERROR';
    } finally {
        const analyzeBtn = document.getElementById('analyzeBtn');
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
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
            idealEntry: analysisData.idealEntry,
            currentPrice: analysisData.currentPrice,
            stopLoss: analysisData.stopLoss,
            takeProfit: analysisData.takeProfit,
            confidence: analysisData.confidence,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order executed!`, 'success');
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}
