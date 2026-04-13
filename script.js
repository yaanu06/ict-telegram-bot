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
    // Try Twelve Data first
    try {
        const url = `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.price && !isNaN(data.price)) {
            document.getElementById('apiSource').innerHTML = '📡 Twelve Data';
            return parseFloat(data.price);
        }
    } catch(e) { console.log('Twelve error:', e); }
    
    // Try Alpha Vantage as backup
    try {
        let fromCurr, toCurr;
        const pairs = {
            'BTC/USD': ['BTC', 'USD'], 'ETH/USD': ['ETH', 'USD'],
            'EUR/USD': ['EUR', 'USD'], 'GBP/USD': ['GBP', 'USD'],
            'XAU/USD': ['XAU', 'USD']
        };
        if (pairs[currentPair]) {
            [fromCurr, toCurr] = pairs[currentPair];
        } else {
            const parts = currentPair.split('/');
            fromCurr = parts[0];
            toCurr = parts[1];
        }
        
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurr}&to_currency=${toCurr}&apikey=${ALPHA_VANTAGE_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data['Realtime Currency Exchange Rate']) {
            document.getElementById('apiSource').innerHTML = '📡 Alpha Vantage';
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
                open: parseFloat(c.open),
                volume: parseFloat(c.volume) || 1000000
            }));
        }
    } catch(e) { console.log('History error:', e); }
    
    return null;
}

// ============================================
// TECHNICAL INDICATORS
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
// VOLUME PROFILE
// ============================================

function calculateVolumeProfile(data, numLevels = 12) {
    if (!data || data.length === 0) return null;
    
    const allHighs = data.map(c => c.high);
    const allLows = data.map(c => c.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const priceRange = maxPrice - minPrice;
    const levelSize = priceRange / numLevels;
    
    const levels = [];
    for (let i = 0; i < numLevels; i++) {
        const levelLow = minPrice + (i * levelSize);
        const levelHigh = levelLow + levelSize;
        levels.push({ low: levelLow, high: levelHigh, volume: 0, price: (levelLow + levelHigh) / 2 });
    }
    
    for (const candle of data) {
        for (const level of levels) {
            if (candle.high >= level.low && candle.low <= level.high) {
                const overlapLow = Math.max(candle.low, level.low);
                const overlapHigh = Math.min(candle.high, level.high);
                const overlapPercent = (overlapHigh - overlapLow) / (candle.high - candle.low);
                level.volume += candle.volume * overlapPercent;
            }
        }
    }
    
    let maxVolume = 0;
    let pocLevel = null;
    for (const level of levels) {
        if (level.volume > maxVolume) {
            maxVolume = level.volume;
            pocLevel = level;
        }
    }
    
    const totalVolume = levels.reduce((sum, l) => sum + l.volume, 0);
    const valueAreaTarget = totalVolume * 0.7;
    let accumulatedVolume = 0;
    const sortedByVolume = [...levels].sort((a, b) => b.volume - a.volume);
    const valueAreaLevels = [];
    for (const level of sortedByVolume) {
        if (accumulatedVolume < valueAreaTarget) {
            valueAreaLevels.push(level);
            accumulatedVolume += level.volume;
        } else break;
    }
    
    return {
        poc: pocLevel,
        valueAreaHigh: Math.max(...valueAreaLevels.map(l => l.high)),
        valueAreaLow: Math.min(...valueAreaLevels.map(l => l.low)),
        totalVolume: totalVolume
    };
}

// ============================================
// ORDER FLOW
// ============================================

function calculateOrderFlow(data) {
    if (!data || data.length < 10) return null;
    
    let buyingPressure = 0, sellingPressure = 0;
    let absorptionSignals = 0;
    
    for (let i = 0; i < data.length; i++) {
        const candle = data[i];
        const bodySize = Math.abs(candle.close - candle.open);
        const isBullish = candle.close > candle.open;
        
        if (isBullish) {
            buyingPressure += candle.volume * 0.7;
            sellingPressure += candle.volume * 0.3;
        } else {
            buyingPressure += candle.volume * 0.3;
            sellingPressure += candle.volume * 0.7;
        }
        
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        
        if (upperWick > bodySize * 1.5 || lowerWick > bodySize * 1.5) {
            absorptionSignals++;
        }
    }
    
    let cumulativePV = 0, cumulativeV = 0;
    for (const candle of data) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        cumulativePV += typicalPrice * candle.volume;
        cumulativeV += candle.volume;
    }
    const vwap = cumulativePV / cumulativeV;
    
    return {
        buyingPressure: buyingPressure,
        sellingPressure: sellingPressure,
        netDelta: buyingPressure - sellingPressure,
        vwap: vwap,
        absorptionSignals: absorptionSignals
    };
}

// ============================================
// ICT CONCEPTS
// ============================================

function findSwingPoints(data, lookback = 5) {
    const highs = [], lows = [];
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true, isLow = true;
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

function findFVGs(data) {
    let fvgs = 0;
    for (let i = 2; i < data.length; i++) {
        if (data[i-2].high < data[i].low) fvgs++;
        if (data[i-2].low > data[i].high) fvgs++;
    }
    return fvgs;
}

function findOrderBlocks(data, swingPoints) {
    let orderBlocks = 0;
    for (let i = 1; i < swingPoints.lows.length; i++) {
        if (swingPoints.lows[i] > swingPoints.lows[i-1]) orderBlocks++;
    }
    for (let i = 1; i < swingPoints.highs.length; i++) {
        if (swingPoints.highs[i] < swingPoints.highs[i-1]) orderBlocks++;
    }
    return orderBlocks;
}

// ============================================
// MAIN ANALYSIS
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing Volume Profile + Order Flow...', 'info');

    try {
        // Get data
        const currentPrice = await getCurrentPrice();
        if (!currentPrice) throw new Error('Could not get price');
        
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 30) throw new Error('Insufficient data');
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        // Calculate indicators
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        
        // Volume Profile & Order Flow
        const volumeProfile = calculateVolumeProfile(historicalData, 12);
        const orderFlow = calculateOrderFlow(historicalData);
        
        // ICT Concepts
        const swingPoints = findSwingPoints(historicalData, 5);
        const fvgCount = findFVGs(historicalData);
        const obCount = findOrderBlocks(historicalData, swingPoints);
        
        // Determine trend
        const currentEMA20 = ema20[ema20.length - 1];
        const currentEMA50 = ema50[ema50.length - 1];
        const prevEMA20 = ema20[ema20.length - 2];
        
        let trend = 'neutral';
        let strength = 'Weak';
        
        if (currentEMA20 > currentEMA50 && currentEMA20 > prevEMA20) {
            trend = 'bullish';
            strength = rsi > 55 ? 'Strong' : 'Medium';
            if (orderFlow && orderFlow.buyingPressure > orderFlow.sellingPressure * 1.2) {
                strength = 'Strong (Vol Confirmed)';
            }
        } else if (currentEMA20 < currentEMA50 && currentEMA20 < prevEMA20) {
            trend = 'bearish';
            strength = rsi < 45 ? 'Strong' : 'Medium';
            if (orderFlow && orderFlow.sellingPressure > orderFlow.buyingPressure * 1.2) {
                strength = 'Strong (Vol Confirmed)';
            }
        }
        
        // Fibonacci levels
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        const fib382 = recentLow + range * 0.382;
        const fib500 = recentLow + range * 0.5;
        const fib618 = recentLow + range * 0.618;
        const fib786 = recentLow + range * 0.786;
        
        // ========== ENTRY ZONE CALCULATION (THE FIXED ONE) ==========
        let idealEntryZone = null;
        let entryInstruction = '';
        let distanceToZone = 0;
        
        if (trend === 'bullish') {
            // For LONG: Entry zone is SUPPORT (below current price)
            // Use Fibonacci 61.8% or Volume Profile Value Area Low
            idealEntryZone = Math.max(fib618, volumeProfile?.valueAreaLow || (currentPrice - atr));
            entryInstruction = '⬇️ WAIT for price to PULL BACK DOWN to this entry zone';
            distanceToZone = currentPrice - idealEntryZone;
        } else if (trend === 'bearish') {
            // For SHORT: Entry zone is RESISTANCE (ABOVE current price)
            // Use Fibonacci 61.8% or Volume Profile Value Area High
            idealEntryZone = Math.min(fib618, volumeProfile?.valueAreaHigh || (currentPrice + atr));
            entryInstruction = '⬆️ WAIT for price to PULL BACK UP to this entry zone';
            distanceToZone = idealEntryZone - currentPrice;
        } else {
            idealEntryZone = currentPrice;
            entryInstruction = 'No clear trend - Wait for setup';
            distanceToZone = 0;
        }
        
        // Calculate progress to zone (0-100%)
        let progress = 0;
        let distanceText = '';
        const maxDistance = atr * 2;
        
        if (distanceToZone > 0) {
            progress = Math.min(100, (1 - distanceToZone / maxDistance) * 100);
            distanceText = `📏 $${distanceToZone.toFixed(2)} away from ideal entry`;
        } else if (distanceToZone < 0) {
            progress = 100;
            distanceText = `⚠️ Price moved past entry zone - Wait for next setup`;
        } else {
            progress = 100;
            distanceText = `✅ Price is IN the entry zone - Ready to enter!`;
        }
        
        // Calculate confidence score
        let confidence = 30;
        if (trend !== 'neutral') confidence += 15;
        if (strength.includes('Strong')) confidence += 15;
        if (rsi > 30 && rsi < 70) confidence += 10;
        if (volumeProfile && volumeProfile.poc) confidence += 10;
        if (orderFlow && orderFlow.netDelta > 0 && trend === 'bullish') confidence += 10;
        if (orderFlow && orderFlow.netDelta < 0 && trend === 'bearish') confidence += 10;
        if (orderFlow && orderFlow.absorptionSignals > 0) confidence += 10;
        if (fvgCount > 0) confidence += 5;
        if (obCount > 0) confidence += 5;
        if (progress > 70) confidence += 15;
        confidence = Math.min(confidence, 98);
        
        // Generate signal
        let signalType = 'NEUTRAL';
        let entry = currentPrice;
        let sl = 0;
        let tp = 0;
        let rr = 'N/A';
        let divergence = '';
        
        // Detect divergence
        if (rsi < 30 && trend === 'bearish') divergence = 'Bullish Divergence';
        if (rsi > 70 && trend === 'bullish') divergence = 'Bearish Divergence';
        
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
        
        // ========== UPDATE UI ==========
        
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
        let reason = `${trend === 'bullish' ? '📈 Bullish' : (trend === 'bearish' ? '📉 Bearish' : '⚪ Neutral')} trend | ${strength} | RSI: ${rsi.toFixed(1)}`;
        if (divergence) reason += ` | 🔄 ${divergence}`;
        if (volumeProfile?.poc) reason += ` | POC: $${volumeProfile.poc.price.toFixed(2)}`;
        if (orderFlow?.absorptionSignals > 0) reason += ` | ⚠️ ${orderFlow.absorptionSignals} Absorption signals`;
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
        
        // Volume Profile
        if (volumeProfile) {
            document.getElementById('pocValue').innerHTML = `$${volumeProfile.poc?.price.toFixed(2) || '--'}`;
            document.getElementById('valueHigh').innerHTML = `$${volumeProfile.valueAreaHigh?.toFixed(2) || '--'}`;
            document.getElementById('valueLow').innerHTML = `$${volumeProfile.valueAreaLow?.toFixed(2) || '--'}`;
            document.getElementById('totalVolume').innerHTML = `${(volumeProfile.totalVolume / 1000000).toFixed(1)}M`;
        }
        
        // Order Flow
        if (orderFlow) {
            document.getElementById('buyingPressure').innerHTML = `${(orderFlow.buyingPressure / 1000000).toFixed(1)}M`;
            document.getElementById('sellingPressure').innerHTML = `${(orderFlow.sellingPressure / 1000000).toFixed(1)}M`;
            document.getElementById('netDelta').innerHTML = `${(orderFlow.netDelta / 1000000).toFixed(1)}M`;
            document.getElementById('vwapValue').innerHTML = `$${orderFlow.vwap.toFixed(2)}`;
        }
        
        // 4H ICT
        document.getElementById('trend4H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend4H').className = `trend ${trend}`;
        document.getElementById('strength4H').innerHTML = strength;
        document.getElementById('fvg4H').innerHTML = fvgCount > 0 ? `✅ ${fvgCount} detected` : '❌ None';
        document.getElementById('ob4H').innerHTML = obCount > 0 ? `✅ ${obCount} detected` : '❌ None';
        document.getElementById('ms4H').innerHTML = trend === 'bullish' ? 'BOS ↑' : (trend === 'bearish' ? 'BOS ↓' : 'CHoCH');
        
        // 1H ICT
        document.getElementById('trend1H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend1H').className = `trend ${trend}`;
        document.getElementById('rsi1H').innerHTML = rsi.toFixed(1);
        document.getElementById('divergence1H').innerHTML = divergence || 'None';
        document.getElementById('absorption1H').innerHTML = orderFlow?.absorptionSignals > 0 ? `⚠️ ${orderFlow.absorptionSignals}` : 'None';
        document.getElementById('choch1H').innerHTML = trend === 'bullish' ? 'Bullish CHoCH' : (trend === 'bearish' ? 'Bearish CHoCH' : 'None');
        
        // Fibonacci
        document.getElementById('fib382').innerHTML = `$${fib382.toFixed(2)}`;
        document.getElementById('fib500').innerHTML = `$${fib500.toFixed(2)}`;
        document.getElementById('fib618').innerHTML = `$${fib618.toFixed(2)}`;
        document.getElementById('fib786').innerHTML = `$${fib786.toFixed(2)}`;
        
        // Liquidity
        document.getElementById('buySideLiq').innerHTML = `$${(recentHigh + atr).toFixed(2)}`;
        document.getElementById('sellSideLiq').innerHTML = `$${(recentLow - atr).toFixed(2)}`;
        document.getElementById('bosLevel').innerHTML = trend === 'bullish' ? `$${recentHigh.toFixed(2)}` : `$${recentLow.toFixed(2)}`;
        document.getElementById('chochLevel').innerHTML = orderFlow?.vwap ? `VWAP: $${orderFlow.vwap.toFixed(2)}` : '--';
        
        // Enable execute button ONLY when price is near entry zone
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= 55 && progress >= 70;
        executeBtn.disabled = !shouldExecute;
        
        // Store analysis
        analysisData = { signalType, entry, tp, sl, rr, confidence, currentPair, currentPrice, idealEntryZone, progress };
        
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
    executeBtn.disabled = true;
}

function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    
    if (analysisData.progress < 70) {
        showNotification(`Price not in entry zone (${analysisData.progress.toFixed(0)}% to zone). Wait for pullback!`, 'warning');
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
            idealEntry: analysisData.idealEntryZone,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order executed! Entry: $${analysisData.entry.toFixed(2)}`, 'success');
}

function showNotification(message, type) {
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}

// Start
init();
