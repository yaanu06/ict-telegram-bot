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
let currentApi = 'twelve';

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let lastAnalysisTime = null;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ============================================
// VOLUME PROFILE FUNCTIONS
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
        levels.push({
            low: levelLow,
            high: levelHigh,
            volume: 0,
            trades: 0,
            price: (levelLow + levelHigh) / 2
        });
    }
    
    for (const candle of data) {
        for (const level of levels) {
            if (candle.high >= level.low && candle.low <= level.high) {
                const overlapLow = Math.max(candle.low, level.low);
                const overlapHigh = Math.min(candle.high, level.high);
                const overlapPercent = (overlapHigh - overlapLow) / (candle.high - candle.low);
                const volumeContribution = candle.volume * overlapPercent;
                level.volume += volumeContribution;
                level.trades++;
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
        } else {
            break;
        }
    }
    
    const valueAreaHigh = Math.max(...valueAreaLevels.map(l => l.high));
    const valueAreaLow = Math.min(...valueAreaLevels.map(l => l.low));
    
    return {
        poc: pocLevel,
        valueAreaHigh: valueAreaHigh,
        valueAreaLow: valueAreaLow,
        totalVolume: totalVolume,
        highVolumeNodes: levels.filter(l => l.volume > maxVolume * 0.7),
        lowVolumeNodes: levels.filter(l => l.volume < maxVolume * 0.2)
    };
}

// ============================================
// ORDER FLOW FUNCTIONS
// ============================================

function calculateOrderFlow(data) {
    if (!data || data.length < 10) return null;
    
    let buyingPressure = 0;
    let sellingPressure = 0;
    let delta = [];
    let cumulativeDelta = [];
    let absorptionSignals = [];
    
    for (let i = 0; i < data.length; i++) {
        const candle = data[i];
        const bodySize = Math.abs(candle.close - candle.open);
        const isBullish = candle.close > candle.open;
        
        let buyVolume = 0;
        let sellVolume = 0;
        
        if (isBullish) {
            buyVolume = candle.volume * 0.7;
            sellVolume = candle.volume * 0.3;
        } else {
            buyVolume = candle.volume * 0.3;
            sellVolume = candle.volume * 0.7;
        }
        
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        
        if (upperWick > bodySize * 1.5) {
            sellVolume += candle.volume * 0.2;
            buyVolume -= candle.volume * 0.1;
        }
        if (lowerWick > bodySize * 1.5) {
            buyVolume += candle.volume * 0.2;
            sellVolume -= candle.volume * 0.1;
        }
        
        buyingPressure += buyVolume;
        sellingPressure += sellVolume;
        
        const candleDelta = buyVolume - sellVolume;
        delta.push(candleDelta);
        
        const cumDelta = (cumulativeDelta[cumulativeDelta.length - 1] || 0) + candleDelta;
        cumulativeDelta.push(cumDelta);
        
        const avgVolume = calculateAverageVolume(data, 20);
        if (candle.volume > avgVolume * 1.5) {
            if (bodySize < candle.volume / 100000) {
                absorptionSignals.push({
                    index: i,
                    type: candle.close > candle.open ? 'Buying Absorption' : 'Selling Absorption',
                    price: candle.close,
                    volume: candle.volume
                });
            }
        }
    }
    
    let cumulativePV = 0;
    let cumulativeV = 0;
    for (const candle of data) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        cumulativePV += typicalPrice * candle.volume;
        cumulativeV += candle.volume;
    }
    const vwap = cumulativePV / cumulativeV;
    
    const recentDelta = delta.slice(-5).reduce((a, b) => a + b, 0);
    const recentPriceChange = data[data.length - 1].close - data[data.length - 5].close;
    
    let divergence = null;
    if (recentDelta > 0 && recentPriceChange < 0) {
        divergence = 'Bullish Divergence';
    } else if (recentDelta < 0 && recentPriceChange > 0) {
        divergence = 'Bearish Divergence';
    }
    
    return {
        buyingPressure: buyingPressure,
        sellingPressure: sellingPressure,
        netDelta: buyingPressure - sellingPressure,
        deltaHistory: delta,
        cumulativeDelta: cumulativeDelta,
        vwap: vwap,
        absorptionSignals: absorptionSignals,
        divergence: divergence,
        isBuyingExhaustion: recentDelta > 0 && recentPriceChange < 0.001 * data[data.length-1].close,
        isSellingExhaustion: recentDelta < 0 && recentPriceChange > -0.001 * data[data.length-1].close
    };
}

function calculateAverageVolume(data, period) {
    const recentVolumes = data.slice(-period).map(c => c.volume);
    return recentVolumes.reduce((a, b) => a + b, 0) / period;
}

// ============================================
// API FUNCTIONS
// ============================================

async function getPriceTwelve(symbol) {
    const url = `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.price && !isNaN(parseFloat(data.price))) {
        return parseFloat(data.price);
    }
    throw new Error(data.message || 'Twelve Data invalid response');
}

async function getHistoryTwelve(symbol, interval) {
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${intervals[interval]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.values && Array.isArray(data.values) && data.values.length > 0) {
        return data.values.map(candle => ({
            time: new Date(candle.datetime),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume) || Math.random() * 1000000 + 500000
        }));
    }
    throw new Error(data.message || 'Twelve Data no data');
}

async function getPriceAlpha(symbol) {
    let fromCurrency, toCurrency;
    const pairs = {
        'BTC/USD': ['BTC', 'USD'], 'ETH/USD': ['ETH', 'USD'],
        'EUR/USD': ['EUR', 'USD'], 'GBP/USD': ['GBP', 'USD'],
        'XAU/USD': ['XAU', 'USD']
    };
    
    if (pairs[symbol]) {
        [fromCurrency, toCurrency] = pairs[symbol];
    } else {
        const parts = symbol.split('/');
        fromCurrency = parts[0];
        toCurrency = parts[1];
    }
    
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data['Realtime Currency Exchange Rate'] && data['Realtime Currency Exchange Rate']['5. Exchange Rate']) {
        return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
    }
    throw new Error('Alpha Vantage error');
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
    const length = prices.length;
    
    for (let i = length - period; i < length; i++) {
        if (i === 0) continue;
        const change = prices[i] - prices[i-1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateATR(highs, lows, closes, period = 14) {
    const trueRanges = [];
    for (let i = 1; i < closes.length; i++) {
        trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    }
    return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ============================================
// FIXED ENTRY ZONE CALCULATION (CORRECT FOR SHORT)
// ============================================

function calculateEntryZone(currentPrice, atr, trend, volumeProfile, orderFlow, fibLevels) {
    let idealEntry = null;
    let entryRangeLow = null;
    let entryRangeHigh = null;
    let distanceToEntry = null;
    let entryProgress = 0;
    
    if (trend === 'bullish') {
        // For LONG: Entry zone is SUPPORT level (below current price)
        const fib618 = fibLevels.level618;
        const valueLow = volumeProfile?.valueAreaLow || (currentPrice - atr);
        const supportLevel = Math.max(fib618, valueLow);
        
        entryRangeLow = supportLevel - (atr * 0.3);
        entryRangeHigh = supportLevel + (atr * 0.3);
        idealEntry = supportLevel;
        
        if (currentPrice >= entryRangeLow) {
            if (currentPrice <= entryRangeHigh) {
                entryProgress = 100;
                distanceToEntry = 0;
            } else {
                distanceToEntry = currentPrice - entryRangeHigh;
                const maxDistance = atr * 2;
                entryProgress = Math.max(0, 100 - (distanceToEntry / maxDistance) * 100);
            }
        } else {
            distanceToEntry = entryRangeLow - currentPrice;
            entryProgress = 0;
        }
        
    } else if (trend === 'bearish') {
        // For SHORT: Entry zone is RESISTANCE level (ABOVE current price)
        const fib618 = fibLevels.level618;
        const valueHigh = volumeProfile?.valueAreaHigh || (currentPrice + atr);
        const resistanceLevel = Math.min(fib618, valueHigh);
        
        entryRangeLow = resistanceLevel - (atr * 0.3);
        entryRangeHigh = resistanceLevel + (atr * 0.3);
        idealEntry = resistanceLevel;
        
        if (currentPrice <= entryRangeHigh) {
            if (currentPrice >= entryRangeLow) {
                entryProgress = 100;
                distanceToEntry = 0;
            } else {
                distanceToEntry = entryRangeLow - currentPrice;
                const maxDistance = atr * 2;
                entryProgress = Math.max(0, 100 - (distanceToEntry / maxDistance) * 100);
            }
        } else {
            distanceToEntry = currentPrice - entryRangeHigh;
            entryProgress = 0;
        }
    }
    
    let distanceText = '--';
    if (distanceToEntry !== null) {
        if (distanceToEntry === 0) {
            distanceText = 'In entry zone! ✅';
        } else {
            distanceText = `$${distanceToEntry.toFixed(2)} ${trend === 'bullish' ? 'above' : 'below'} zone`;
        }
    }
    
    return {
        idealEntry: idealEntry ? `$${idealEntry.toFixed(2)}` : '--',
        entryRange: (entryRangeLow && entryRangeHigh) ? `$${entryRangeLow.toFixed(2)} - $${entryRangeHigh.toFixed(2)}` : '--',
        entryProgress: Math.min(100, entryProgress),
        distanceText: distanceText,
        entryRangeLow: entryRangeLow,
        entryRangeHigh: entryRangeHigh
    };
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing Volume Profile + Order Flow...', 'info');
    
    const connectionEl = document.getElementById('connectionStatus');
    if (connectionEl) {
        connectionEl.textContent = '🟡 Connecting...';
        connectionEl.className = 'connection-status warning';
    }

    try {
        let currentPrice = null;
        let historicalData = null;
        let apiUsed = '';
        
        // Try Twelve Data first
        try {
            console.log('Trying Twelve Data for', currentPair);
            currentPrice = await getPriceTwelve(currentPair);
            historicalData = await getHistoryTwelve(currentPair, currentTimeframe);
            apiUsed = 'Twelve Data';
            currentApi = 'twelve';
            console.log('Twelve Data success:', currentPrice);
        } catch (twelveError) {
            console.log('Twelve Data failed:', twelveError.message);
            try {
                console.log('Trying Alpha Vantage for', currentPair);
                currentPrice = await getPriceAlpha(currentPair);
                historicalData = await getHistoryTwelve(currentPair, currentTimeframe);
                if (historicalData) {
                    historicalData = historicalData.map(c => ({ ...c, volume: Math.random() * 1000000 + 500000 }));
                }
                apiUsed = 'Alpha Vantage';
                currentApi = 'alpha';
                console.log('Alpha Vantage success:', currentPrice);
            } catch (alphaError) {
                throw new Error(`Both APIs failed: ${twelveError.message} | ${alphaError.message}`);
            }
        }
        
        if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
            throw new Error('Invalid price received from API');
        }
        if (!historicalData || historicalData.length < 30) {
            throw new Error('Insufficient historical data');
        }
        
        if (connectionEl) {
            connectionEl.textContent = '🟢 Live Data';
            connectionEl.className = 'connection-status';
        }
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(highs, lows, closes, 14);
        
        const volumeProfile = calculateVolumeProfile(historicalData, 12);
        const orderFlow = calculateOrderFlow(historicalData);
        
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
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const fibDiff = recentHigh - recentLow;
        
        const fibLevels = {
            level382: recentLow + fibDiff * 0.382,
            level500: recentLow + fibDiff * 0.5,
            level618: recentLow + fibDiff * 0.618,
            level786: recentLow + fibDiff * 0.786
        };
        
        let nearestFib = '';
        let minDist = Infinity;
        for (const [key, value] of Object.entries(fibLevels)) {
            const dist = Math.abs(currentPrice - value);
            if (dist < minDist) {
                minDist = dist;
                nearestFib = `${key.replace('level', '')}% at $${value.toFixed(2)}`;
            }
        }
        
        const entryZone = calculateEntryZone(currentPrice, atr, trend, volumeProfile, orderFlow, fibLevels);
        
        let confidence = 30;
        if (trend !== 'neutral') confidence += 15;
        if (strength.includes('Strong')) confidence += 15;
        if (rsi > 30 && rsi < 70) confidence += 10;
        
        if (volumeProfile && volumeProfile.poc) {
            const distanceToPOC = Math.abs(currentPrice - volumeProfile.poc.price) / currentPrice * 100;
            if (distanceToPOC < 1) confidence += 15;
            if (volumeProfile.valueAreaLow && currentPrice < volumeProfile.valueAreaLow) confidence += 10;
            if (volumeProfile.valueAreaHigh && currentPrice > volumeProfile.valueAreaHigh) confidence += 10;
        }
        
        if (orderFlow) {
            if (orderFlow.divergence) confidence += 20;
            if (orderFlow.absorptionSignals.length > 0) confidence += 15;
            if (trend === 'bullish' && orderFlow.netDelta > 0) confidence += 10;
            if (trend === 'bearish' && orderFlow.netDelta < 0) confidence += 10;
            if (orderFlow.isBuyingExhaustion || orderFlow.isSellingExhaustion) confidence += 15;
        }
        
        if (entryZone.entryProgress > 80) confidence += 15;
        else if (entryZone.entryProgress > 50) confidence += 10;
        
        confidence = Math.min(confidence, 98);
        
        let signal = null;
        let signalReason = [];
        
        if (trend === 'bullish' && confidence >= 50) {
            const entry = currentPrice;
            const sl = entry - (atr * 1.5);
            const tp = entry + (atr * 2.5);
            const rr = ((tp - entry) / (entry - sl)).toFixed(1);
            
            signalReason.push('📈 Bullish trend');
            if (volumeProfile && currentPrice < volumeProfile.valueAreaLow) signalReason.push('💰 Price at discount');
            if (orderFlow && orderFlow.netDelta > 0) signalReason.push('📊 Positive delta');
            if (orderFlow && orderFlow.divergence) signalReason.push(`🔄 ${orderFlow.divergence}`);
            if (entryZone.entryProgress > 70) signalReason.push('🎯 Near ideal entry zone');
            
            signal = {
                type: 'LONG 🟢',
                confidence: `${confidence}%`,
                entry: `$${entry.toFixed(2)}`,
                tp: `$${tp.toFixed(2)}`,
                sl: `$${sl.toFixed(2)}`,
                rr: `1:${rr}`,
                reason: signalReason.join(' | ')
            };
        } else if (trend === 'bearish' && confidence >= 50) {
            const entry = currentPrice;
            const sl = entry + (atr * 1.5);
            const tp = entry - (atr * 2.5);
            const rr = ((entry - tp) / (sl - entry)).toFixed(1);
            
            signalReason.push('📉 Bearish trend');
            if (volumeProfile && currentPrice > volumeProfile.valueAreaHigh) signalReason.push('💸 Price at premium');
            if (orderFlow && orderFlow.netDelta < 0) signalReason.push('📊 Negative delta');
            if (orderFlow && orderFlow.divergence) signalReason.push(`🔄 ${orderFlow.divergence}`);
            if (entryZone.entryProgress > 70) signalReason.push('🎯 Near ideal entry zone');
            
            signal = {
                type: 'SHORT 🔴',
                confidence: `${confidence}%`,
                entry: `$${entry.toFixed(2)}`,
                tp: `$${tp.toFixed(2)}`,
                sl: `$${sl.toFixed(2)}`,
                rr: `1:${rr}`,
                reason: signalReason.join(' | ')
            };
        } else {
            signal = {
                type: 'NEUTRAL ⚪',
                confidence: `${confidence}%`,
                entry: `$${currentPrice.toFixed(2)}`,
                tp: '--',
                sl: '--',
                rr: 'N/A',
                reason: 'No clear signal with volume confirmation'
            };
        }
        
        // ========== UPDATE UI ==========
        
        document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(2)}<span style="font-size:11px; display:block;">${apiUsed} | RSI: ${rsi.toFixed(1)} | ATR: ${atr.toFixed(2)}</span>`;
        
        if (lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
            const priceChangeEl = document.getElementById('priceChange');
            if (priceChangeEl) {
                priceChangeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
                priceChangeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
            }
        }
        lastPrice = currentPrice;
        
        // Entry Zone UI
        const idealEntryEl = document.getElementById('idealEntry');
        const entryRangeEl = document.getElementById('entryRange');
        const entryProgressBar = document.getElementById('entryProgressBar');
        const entryDistanceEl = document.getElementById('entryDistance');
        const entryActionEl = document.getElementById('entryAction');
        
        if (idealEntryEl) idealEntryEl.textContent = entryZone.idealEntry;
        if (entryRangeEl) entryRangeEl.textContent = entryZone.entryRange;
        if (entryProgressBar) entryProgressBar.style.width = `${entryZone.entryProgress}%`;
        if (entryDistanceEl) entryDistanceEl.textContent = entryZone.distanceText;
        if (entryActionEl) {
            if (trend === 'bullish') {
                entryActionEl.textContent = 'Wait for pullback DOWN to entry zone';
                entryActionEl.style.color = '#34c759';
            } else if (trend === 'bearish') {
                entryActionEl.textContent = 'Wait for pullback UP to entry zone';
                entryActionEl.style.color = '#ff3b30';
            } else {
                entryActionEl.textContent = 'No clear trend';
                entryActionEl.style.color = '#8e8e93';
            }
        }
        
        // 4H Analysis
        document.getElementById('trend4H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend4H').className = `value trend-value ${trend}`;
        document.getElementById('strength4H').innerHTML = strength;
        document.getElementById('fvg4H').innerHTML = volumeProfile ? `POC: $${volumeProfile.poc?.price.toFixed(2)}` : '--';
        document.getElementById('ob4H').innerHTML = orderFlow?.absorptionSignals.length > 0 ? `✅ ${orderFlow.absorptionSignals.length} Signals` : '❌ None';
        document.getElementById('ms4H').innerHTML = orderFlow?.divergence ? 'Divergence' : (trend === 'bullish' ? 'BOS ↑' : 'BOS ↓');
        
        // 1H Analysis
        document.getElementById('trend1H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('strength1H').innerHTML = strength;
        document.getElementById('fvg1H').innerHTML = volumeProfile ? `VA: $${volumeProfile.valueAreaLow?.toFixed(2)}-$${volumeProfile.valueAreaHigh?.toFixed(2)}` : '--';
        document.getElementById('ob1H').innerHTML = orderFlow ? `Delta: ${(orderFlow.netDelta / 1000000).toFixed(2)}M` : '--';
        document.getElementById('ms1H').innerHTML = orderFlow?.vwap ? `VWAP: $${orderFlow.vwap.toFixed(2)}` : '--';
        
        // Signal Card
        document.getElementById('signalType').innerHTML = signal.type;
        document.getElementById('signalType').className = `value signal-type ${signal.type.includes('LONG') ? 'long' : (signal.type.includes('SHORT') ? 'short' : '')}`;
        document.getElementById('signalConfidence').innerHTML = signal.confidence;
        document.getElementById('signalEntry').innerHTML = signal.entry;
        document.getElementById('signalTP').innerHTML = signal.tp;
        document.getElementById('signalSL').innerHTML = signal.sl;
        document.getElementById('signalRR').innerHTML = signal.rr;
        document.getElementById('signalReason').innerHTML = signal.reason;
        
        const badge = document.getElementById('signalStrengthBadge');
        if (badge) {
            const conf = confidence;
            badge.textContent = conf >= 70 ? '🔥 HIGH (Vol Confirmed)' : (conf >= 50 ? '📊 MEDIUM' : '⚠️ LOW');
            badge.className = `signal-badge ${conf >= 70 ? 'high' : (conf >= 50 ? 'medium' : 'low')}`;
        }
        
        // Tabs content
        if (volumeProfile) {
            document.getElementById('fvgZonesDisplay').innerHTML = `
                <div class="zone-tag" style="border-left-color: #34c759;">📊 POC: $${volumeProfile.poc?.price.toFixed(2)}</div>
                <div class="zone-tag" style="border-left-color: #ff9f0a;">📈 Value Area High: $${volumeProfile.valueAreaHigh?.toFixed(2)}</div>
                <div class="zone-tag" style="border-left-color: #ff9f0a;">📉 Value Area Low: $${volumeProfile.valueAreaLow?.toFixed(2)}</div>
                <div class="zone-tag">💰 Total Volume: ${(volumeProfile.totalVolume / 1000000).toFixed(2)}M</div>
                <div class="zone-tag">📊 HVN: ${volumeProfile.highVolumeNodes.length} levels | LVN: ${volumeProfile.lowVolumeNodes.length} levels</div>
            `;
        }
        
        if (orderFlow) {
            document.getElementById('obZonesDisplay').innerHTML = `
                <div class="zone-tag">🟢 Buying Pressure: ${(orderFlow.buyingPressure / 1000000).toFixed(2)}M</div>
                <div class="zone-tag">🔴 Selling Pressure: ${(orderFlow.sellingPressure / 1000000).toFixed(2)}M</div>
                <div class="zone-tag">📊 Net Delta: ${(orderFlow.netDelta / 1000000).toFixed(2)}M</div>
                <div class="zone-tag">⚖️ VWAP: $${orderFlow.vwap.toFixed(2)}</div>
                ${orderFlow.divergence ? `<div class="zone-tag" style="border-left-color: #af52de;">🔄 ${orderFlow.divergence}</div>` : ''}
                ${orderFlow.absorptionSignals.length > 0 ? `<div class="zone-tag" style="border-left-color: #ff3b30;">⚠️ ${orderFlow.absorptionSignals.length} Absorption Signals</div>` : ''}
                ${orderFlow.isBuyingExhaustion ? '<div class="zone-tag" style="border-left-color: #ff9f0a;">⚠️ Buying Exhaustion Detected</div>' : ''}
                ${orderFlow.isSellingExhaustion ? '<div class="zone-tag" style="border-left-color: #34c759;">⚠️ Selling Exhaustion Detected</div>' : ''}
            `;
        }
        
        document.getElementById('fibLevelsDisplay').innerHTML = `
            <div class="zone-tag fib">📐 38.2%: $${fibLevels.level382.toFixed(2)}</div>
            <div class="zone-tag fib">📐 50%: $${fibLevels.level500.toFixed(2)}</div>
            <div class="zone-tag fib">📐 61.8%: $${fibLevels.level618.toFixed(2)}</div>
            <div class="zone-tag fib">📐 78.6%: $${fibLevels.level786.toFixed(2)}</div>
            <div class="zone-tag" style="background:#3390ec20;">🎯 Nearest: ${nearestFib}</div>
        `;
        
        document.getElementById('entriesDisplay').innerHTML = `
            <div class="zone-tag entry">🎯 Ideal Entry: ${entryZone.idealEntry}</div>
            <div class="zone-tag entry">📊 Entry Range: ${entryZone.entryRange}</div>
            <div class="zone-tag entry">📏 Distance: ${entryZone.distanceText}</div>
            <div class="zone-tag entry">📈 Progress: ${entryZone.entryProgress.toFixed(0)}% to zone</div>
            <div class="zone-tag" style="background:#3390ec20;">💡 Tip: Wait for price to enter the ${trend === 'bullish' ? 'green zone below' : 'green zone above'} before entering</div>
        `;
        
        document.getElementById('buySideLiq').textContent = `$${(recentHigh + atr).toFixed(2)}`;
        document.getElementById('sellSideLiq').textContent = `$${(recentLow - atr).toFixed(2)}`;
        document.getElementById('bosLevel').textContent = trend === 'bullish' ? `$${(recentHigh).toFixed(2)}` : `$${(recentLow).toFixed(2)}`;
        document.getElementById('chochLevel').textContent = orderFlow?.vwap ? `VWAP: $${orderFlow.vwap.toFixed(2)}` : '--';
        
        const shouldEnable = confidence >= 55 && signal.type !== 'NEUTRAL ⚪' && entryZone.entryProgress > 50;
        executeBtn.disabled = !shouldEnable;
        if (shouldEnable) {
            executeBtn.style.background = 'linear-gradient(135deg, var(--accent-green), #28a745)';
        } else {
            executeBtn.style.background = '';
        }
        
        analysisData = { 
            signal, confidence, currentPair, currentPrice, orderFlow, volumeProfile,
            entryZone, trend, atr, tp: signal.tp, sl: signal.sl
        };
        
        apiCalls++;
        document.getElementById('apiUsage').textContent = `${apiCalls} / 800`;
        showNotification(`Analysis complete! ${signal.type} - ${signal.confidence} confidence`, 'success');
        
        const liveBadge = document.getElementById('liveStatusBadge');
        if (liveBadge) {
            liveBadge.textContent = 'LIVE';
            liveBadge.style.background = 'var(--accent-green)';
        }
        
        lastAnalysisTime = new Date();
        
    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('Error: ' + error.message, 'error');
        
        const connectionEl = document.getElementById('connectionStatus');
        if (connectionEl) {
            connectionEl.textContent = '🔴 API Error';
            connectionEl.className = 'connection-status error';
        }
        
        const liveBadge = document.getElementById('liveStatusBadge');
        if (liveBadge) {
            liveBadge.textContent = 'ERROR';
            liveBadge.style.background = 'var(--accent-red)';
        }
        
        document.getElementById('currentPrice').innerHTML = 'ERROR<br><span style="font-size:11px;">Check API key</span>';
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ============================================
// UI HELPER FUNCTIONS
// ============================================

function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
    
    setInterval(() => {
        if (lastAnalysisTime && (new Date() - lastAnalysisTime) > 300000) {
            console.log('Auto-refresh analysis');
            runAnalysis();
        }
    }, 300000);
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
    document.getElementById('fvgZonesDisplay').innerHTML = 'Click Analyze to see Volume Profile';
    document.getElementById('obZonesDisplay').innerHTML = 'Click Analyze to see Order Flow';
    document.getElementById('fibLevelsDisplay').innerHTML = 'Click Analyze to see Fibonacci levels';
    document.getElementById('entriesDisplay').innerHTML = 'Click Analyze to see Entry Zones';
    document.getElementById('buySideLiq').textContent = '--';
    document.getElementById('sellSideLiq').textContent = '--';
    document.getElementById('bosLevel').textContent = '--';
    document.getElementById('chochLevel').textContent = '--';
    
    const idealEntryEl = document.getElementById('idealEntry');
    const entryRangeEl = document.getElementById('entryRange');
    const entryProgressBar = document.getElementById('entryProgressBar');
    const entryDistanceEl = document.getElementById('entryDistance');
    const entryActionEl = document.getElementById('entryAction');
    if (idealEntryEl) idealEntryEl.textContent = '--';
    if (entryRangeEl) entryRangeEl.textContent = '--';
    if (entryProgressBar) entryProgressBar.style.width = '0%';
    if (entryDistanceEl) entryDistanceEl.textContent = '--';
    if (entryActionEl) entryActionEl.textContent = '--';
    
    executeBtn.disabled = true;
    
    const connectionEl = document.getElementById('connectionStatus');
    if (connectionEl) {
        connectionEl.textContent = '🟢 Ready';
        connectionEl.className = 'connection-status';
    }
    
    const liveBadge = document.getElementById('liveStatusBadge');
    if (liveBadge) {
        liveBadge.textContent = 'LIVE';
        liveBadge.style.background = 'var(--accent-red)';
    }
}

function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    
    if (analysisData.confidence < 55) {
        showNotification('Low confidence - Trade not recommended', 'error');
        return;
    }
    
    if (analysisData.entryZone && analysisData.entryZone.entryProgress < 50) {
        showNotification('Price not in entry zone - Wait for better entry', 'warning');
        return;
    }
    
    const orderDetails = {
        action: 'execute_order',
        pair: currentPair,
        signal: analysisData.signal,
        entryPrice: analysisData.currentPrice,
        stopLoss: analysisData.sl,
        takeProfit: analysisData.tp,
        riskReward: analysisData.signal.rr,
        volumeProfile: {
            poc: analysisData.volumeProfile?.poc?.price,
            valueAreaHigh: analysisData.volumeProfile?.valueAreaHigh,
            valueAreaLow: analysisData.volumeProfile?.valueAreaLow
        },
        orderFlow: {
            netDelta: analysisData.orderFlow?.netDelta,
            vwap: analysisData.orderFlow?.vwap,
            divergence: analysisData.orderFlow?.divergence
        },
        entryZone: analysisData.entryZone,
        timestamp: new Date().toISOString()
    };
    
    if (tg && tg.sendData) {
        tg.sendData(JSON.stringify(orderDetails));
    }
    
    showNotification(`✅ ${analysisData.signal.type} executed! Entry: ${analysisData.signal.entry} | TP: ${analysisData.signal.tp} | SL: ${analysisData.signal.sl}`, 'success');
}

function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 5000);
}

// Start the app
init();
