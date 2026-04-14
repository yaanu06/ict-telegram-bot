const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// API Keys - In production, these should be on a backend server
const TWELVE_DATA_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';
const ALPHA_VANTAGE_KEY = 'E4HPPIL10X34R418';

// Rate limiting
let lastApiCall = 0;
const MIN_API_INTERVAL = 1000; // Minimum 1 second between API calls

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let priceUpdateInterval = null;
let mtfAnalysis = null; // Multi-timeframe analysis results

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ============================================
// API FUNCTIONS
// ============================================

async function getCurrentPrice() {
    // Rate limiting check
    const now = Date.now();
    if (now - lastApiCall < MIN_API_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_API_INTERVAL - (now - lastApiCall)));
    }
    lastApiCall = Date.now();
    
    try {
        const url = `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${TWELVE_DATA_KEY}`;
        const response = await fetch(url, { timeout: 5000 });
        const data = await response.json();
        if (data.price && !isNaN(data.price)) {
            document.getElementById('apiSource').innerHTML = '📡 Twelve Data';
            return parseFloat(data.price);
        }
    } catch(e) { console.log('Twelve error:', e); }
    
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
        const response = await fetch(url, { timeout: 5000 });
        const data = await response.json();
        if (data['Realtime Currency Exchange Rate']) {
            document.getElementById('apiSource').innerHTML = '📡 Alpha Vantage';
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
    } catch(e) { console.log('Alpha error:', e); }
    
    return null;
}

async function getHistoricalData(timeframe = null) {
    // Rate limiting check
    const now = Date.now();
    if (now - lastApiCall < MIN_API_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_API_INTERVAL - (now - lastApiCall)));
    }
    lastApiCall = Date.now();
    
    const tf = timeframe || currentTimeframe;
    const intervals = { '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${currentPair}&interval=${intervals[tf]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`;
    
    try {
        const response = await fetch(url, { timeout: 10000 });
        const data = await response.json();
        
        // Handle API rate limit errors
        if (data.status === 'error' || data.Error) {
            console.error('API Error:', data);
            throw new Error('API rate limit or error');
        }
        
        if (data.values && data.values.length > 30) {
            return data.values.map(c => ({
                close: parseFloat(c.close),
                high: parseFloat(c.high),
                low: parseFloat(c.low),
                open: parseFloat(c.open),
                volume: parseFloat(c.volume) || 1000000
            }));
        }
    } catch(e) { 
        console.log('History error:', e); 
        throw e;
    }
    
    return null;
}

// ============================================
// MULTI-TIMEFRAME ANALYSIS
// ============================================

async function analyzeTimeframe(tf) {
    try {
        const historicalData = await getHistoricalData(tf);
        if (!historicalData || historicalData.length < 30) return null;
        
        const closes = historicalData.map(c => c.close);
        const highs = historicalData.map(c => c.high);
        const lows = historicalData.map(c => c.low);
        
        const ema20 = calculateEMA(closes, 20);
        const ema50 = calculateEMA(closes, 50);
        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(historicalData, 14);
        
        const volumeProfile = calculateVolumeProfile(historicalData, 12);
        const orderFlow = calculateOrderFlow(historicalData);
        const swingPoints = findSwingPoints(historicalData, 5);
        
        const fvgList = detectFVG(historicalData);
        const orderBlocks = detectOrderBlocks(historicalData, swingPoints);
        const liquiditySweeps = detectLiquiditySweeps(historicalData, swingPoints);
        const marketStructure = detectMarketStructure(historicalData, swingPoints);
        
        const currentEMA20 = ema20[ema20.length - 1];
        const currentEMA50 = ema50[ema50.length - 1];
        const prevEMA20 = ema20[ema20.length - 2];
        
        let trend = 'neutral';
        if (currentEMA20 > currentEMA50 && currentEMA20 > prevEMA20) {
            trend = 'bullish';
        } else if (currentEMA20 < currentEMA50 && currentEMA20 < prevEMA20) {
            trend = 'bearish';
        }
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        
        return {
            timeframe: tf,
            trend,
            rsi,
            atr,
            ema20: currentEMA20,
            ema50: currentEMA50,
            marketStructure,
            fvgCount: fvgList.length,
            orderBlockCount: orderBlocks.length,
            liquiditySweeps: liquiditySweeps.length,
            volumeProfile,
            orderFlow,
            recentHigh,
            recentLow,
            currentPrice: closes[closes.length - 1]
        };
    } catch (error) {
        console.error(`Error analyzing ${tf}:`, error);
        return null;
    }
}

async function runMultiTimeframeAnalysis() {
    const timeframes = ['1H', '4H', '1D'];
    const results = {};
    
    for (const tf of timeframes) {
        const result = await analyzeTimeframe(tf);
        if (result) {
            results[tf] = result;
        }
    }
    
    // Determine overall trend alignment
    const trends = timeframes.filter(tf => results[tf]).map(tf => results[tf].trend);
    const bullishCount = trends.filter(t => t === 'bullish').length;
    const bearishCount = trends.filter(t => t === 'bearish').length;
    
    let overallTrend = 'neutral';
    let trendStrength = 'weak';
    
    if (bullishCount >= 2) {
        overallTrend = 'bullish';
        if (bullishCount === 3) trendStrength = 'strong';
        else trendStrength = 'moderate';
    } else if (bearishCount >= 2) {
        overallTrend = 'bearish';
        if (bearishCount === 3) trendStrength = 'strong';
        else trendStrength = 'moderate';
    }
    
    // Check for trend confluence (all timeframes aligned)
    const allAligned = trends.every(t => t === trends[0] && t !== 'neutral');
    
    // Calculate multi-timeframe confidence boost
    let mtfConfidenceBoost = 0;
    if (allAligned) mtfConfidenceBoost = 20;  // All TFs aligned - strong signal
    else if (bullishCount >= 2 || bearishCount >= 2) mtfConfidenceBoost = 10;  // Majority aligned
    
    return {
        results,
        overallTrend,
        trendStrength,
        allAligned,
        mtfConfidenceBoost,
        trends
    };
}

// ============================================
// TECHNICAL INDICATORS (FIXED FORMULAS)
// ============================================

function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return [];
    
    // Calculate initial SMA for the first EMA value
    const sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    const multiplier = 2 / (period + 1);
    const ema = [sma];
    
    for (let i = period; i < prices.length; i++) {
        ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
    }
    
    return ema;
}

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length <= period) return 50;
    
    let gains = [];
    let losses = [];
    
    // Calculate price changes
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            gains.push(change);
            losses.push(0);
        } else {
            gains.push(0);
            losses.push(Math.abs(change));
        }
    }
    
    // Calculate initial average gain/loss using SMA
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Use Wilder's smoothing method for subsequent values
    for (let i = period; i < gains.length; i++) {
        avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
        avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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
// ICT CONCEPTS (REAL CALCULATIONS)
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
        if (isHigh) highs.push({ index: i, price: data[i].high });
        if (isLow) lows.push({ index: i, price: data[i].low });
    }
    return { highs, lows };
}

// Calculate Fair Value Gaps (FVG)
function detectFVG(data) {
    const fvgList = [];
    for (let i = 2; i < data.length; i++) {
        const prevCandle = data[i - 2];
        const currCandle = data[i];
        
        // Bullish FVG: current low > previous high, gap in between
        if (currCandle.low > prevCandle.high) {
            fvgList.push({
                type: 'bullish',
                top: currCandle.low,
                bottom: prevCandle.high,
                midpoint: (currCandle.low + prevCandle.high) / 2,
                index: i
            });
        }
        // Bearish FVG: current high < previous low
        else if (currCandle.high < prevCandle.low) {
            fvgList.push({
                type: 'bearish',
                top: prevCandle.low,
                bottom: currCandle.high,
                midpoint: (prevCandle.low + currCandle.high) / 2,
                index: i
            });
        }
    }
    return fvgList.slice(-5); // Return last 5 FVGs
}

// Detect Order Blocks
function detectOrderBlocks(data, swingPoints) {
    const orderBlocks = [];
    
    // Bullish OB: last down candle before a strong up move that breaks structure
    for (const lowPoint of swingPoints.lows) {
        const idx = lowPoint.index;
        if (idx > 0 && idx < data.length - 1) {
            const prevCandle = data[idx - 1];
            
            // Check if there's a bullish reaction after the low
            if (data[idx + 1]?.close > prevCandle.open) {
                orderBlocks.push({
                    type: 'bullish',
                    top: Math.max(prevCandle.open, prevCandle.close),
                    bottom: Math.min(prevCandle.open, prevCandle.close),
                    index: idx - 1
                });
            }
        }
    }
    
    // Bearish OB: last up candle before a strong down move
    for (const highPoint of swingPoints.highs) {
        const idx = highPoint.index;
        if (idx > 0 && idx < data.length - 1) {
            const prevCandle = data[idx - 1];
            
            if (data[idx + 1]?.close < prevCandle.open) {
                orderBlocks.push({
                    type: 'bearish',
                    top: Math.max(prevCandle.open, prevCandle.close),
                    bottom: Math.min(prevCandle.open, prevCandle.close),
                    index: idx - 1
                });
            }
        }
    }
    
    return orderBlocks.slice(-5);
}

// Detect Liquidity Sweeps
function detectLiquiditySweeps(data, swingPoints) {
    const sweeps = [];
    const currentPrice = data[data.length - 1].close;
    
    // Check if price swept recent highs
    for (const high of swingPoints.highs.slice(-3)) {
        if (data[data.length - 1].high > high.price && currentPrice < high.price) {
            sweeps.push({ type: 'high', level: high.price, swept: true });
        }
    }
    
    // Check if price swept recent lows
    for (const low of swingPoints.lows.slice(-3)) {
        if (data[data.length - 1].low < low.price && currentPrice > low.price) {
            sweeps.push({ type: 'low', level: low.price, swept: true });
        }
    }
    
    return sweeps;
}

// Market Structure Detection (BOS/CHoCH)
function detectMarketStructure(data, swingPoints) {
    if (swingPoints.highs.length < 2 || swingPoints.lows.length < 2) {
        return { structure: 'neutral', signal: 'None' };
    }
    
    const recentHighs = swingPoints.highs.slice(-3);
    const recentLows = swingPoints.lows.slice(-3);
    
    const higherHigh = recentHighs[recentHighs.length - 1]?.price > recentHighs[0]?.price;
    const higherLow = recentLows[recentLows.length - 1]?.price > recentLows[0]?.price;
    const lowerHigh = recentHighs[recentHighs.length - 1]?.price < recentHighs[0]?.price;
    const lowerLow = recentLows[recentLows.length - 1]?.price < recentLows[0]?.price;
    
    if (higherHigh && higherLow) {
        return { structure: 'bullish', signal: 'BOS ↑' };
    } else if (lowerHigh && lowerLow) {
        return { structure: 'bearish', signal: 'BOS ↓' };
    } else {
        return { structure: 'transition', signal: 'CHoCH' };
    }
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Running Multi-Timeframe Analysis...', 'info');

    try {
        // Run multi-timeframe analysis first
        mtfAnalysis = await runMultiTimeframeAnalysis();
        
        const currentPrice = await getCurrentPrice();
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
        
        const volumeProfile = calculateVolumeProfile(historicalData, 12);
        const orderFlow = calculateOrderFlow(historicalData);
        const swingPoints = findSwingPoints(historicalData, 5);
        
        // NEW: Calculate real ICT concepts
        const fvgList = detectFVG(historicalData);
        const orderBlocks = detectOrderBlocks(historicalData, swingPoints);
        const liquiditySweeps = detectLiquiditySweeps(historicalData, swingPoints);
        const marketStructure = detectMarketStructure(historicalData, swingPoints);
        
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
        
        // Apply multi-timeframe trend confirmation
        if (mtfAnalysis && mtfAnalysis.overallTrend !== 'neutral') {
            // If MTF agrees with current timeframe, boost strength
            if (mtfAnalysis.overallTrend === trend) {
                strength = 'Strong';
            }
        }
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        const fib382 = recentLow + range * 0.382;
        const fib500 = recentLow + range * 0.5;
        const fib618 = recentLow + range * 0.618;
        const fib786 = recentLow + range * 0.786;
        
        // Calculate SMART ENTRY with IMPROVED RISK MANAGEMENT
        let idealEntry = null;
        let stopLoss = null;
        let takeProfit = null;
        let signalType = 'NEUTRAL';
        let entryInstruction = '';
        let confidence = 30;
        
        // Improved confidence calculation based on real ICT confluence
        if (trend !== 'neutral') confidence += 15;
        if (strength === 'Strong') confidence += 10;
        if (rsi > 30 && rsi < 70) confidence += 10;
        if (volumeProfile && volumeProfile.poc) confidence += 8;
        if (orderFlow && ((trend === 'bullish' && orderFlow.netDelta > 0) || (trend === 'bearish' && orderFlow.netDelta < 0))) confidence += 12;
        if (orderFlow && orderFlow.absorptionSignals > 0) confidence += 8;
        
        // NEW: Add confidence for real ICT signals
        if (fvgList.length > 0) confidence += 10;  // FVG present
        if (orderBlocks.length > 0) confidence += 8;  // Order Block present
        if (liquiditySweeps.length > 0) confidence += 12;  // Liquidity sweep detected
        if (marketStructure.structure === trend) confidence += 15;  // Market structure confirms trend
        
        // NEW: Add multi-timeframe confidence boost
        if (mtfAnalysis) {
            confidence += mtfAnalysis.mtfConfidenceBoost;
        }
        
        confidence = Math.min(confidence, 95);  // Cap at 95% to be conservative
        
        // Require higher confidence threshold (65%) to reduce losses
        const MIN_CONFIDENCE = 65;
        
        // IMPROVED: Use MIN_CONFIDENCE and add confluence requirements
        if (trend === 'bullish' && confidence >= MIN_CONFIDENCE) {
            signalType = 'LONG';
            // Better entry: look for FVG or Order Block confluence
            const bullishFVG = fvgList.filter(f => f.type === 'bullish').pop();
            const bullishOB = orderBlocks.filter(ob => ob.type === 'bullish').pop();
            
            // Prefer FVG midpoint or OB top as entry
            if (bullishFVG && bullishFVG.midpoint < currentPrice) {
                idealEntry = bullishFVG.midpoint;
            } else if (bullishOB && bullishOB.top < currentPrice) {
                idealEntry = bullishOB.top;
            } else {
                idealEntry = Math.max(volumeProfile?.valueAreaLow || recentLow, fib618);
            }
            
            if (idealEntry >= currentPrice) {
                idealEntry = currentPrice - (atr * 0.5);
            }
            
            // IMPROVED: Wider stop loss (1.5x ATR) to avoid being stopped out prematurely
            stopLoss = idealEntry - (atr * 1.5);
            
            // Better TP: target liquidity above recent highs
            let resistanceTarget;
            if (liquiditySweeps.length === 0) {
                // No sweep yet, target the high + buffer
                resistanceTarget = recentHigh + (atr * 0.5);
            } else {
                // Already swept, target extension
                resistanceTarget = idealEntry + (atr * 3);
            }
            takeProfit = resistanceTarget;
            
            entryInstruction = `📈 LONG Setup: Wait for pullback to $${idealEntry.toFixed(2)} (FVG/OB zone)`;
        } else if (trend === 'bearish' && confidence >= MIN_CONFIDENCE) {
            signalType = 'SHORT';
            // Better entry: look for FVG or Order Block confluence
            const bearishFVG = fvgList.filter(f => f.type === 'bearish').pop();
            const bearishOB = orderBlocks.filter(ob => ob.type === 'bearish').pop();
            
            if (bearishFVG && bearishFVG.midpoint > currentPrice) {
                idealEntry = bearishFVG.midpoint;
            } else if (bearishOB && bearishOB.bottom > currentPrice) {
                idealEntry = bearishOB.bottom;
            } else {
                idealEntry = Math.min(volumeProfile?.valueAreaHigh || recentHigh, fib382);
            }
            
            if (idealEntry <= currentPrice) {
                idealEntry = currentPrice + (atr * 0.5);
            }
            
            // IMPROVED: Wider stop loss (1.5x ATR)
            stopLoss = idealEntry + (atr * 1.5);
            
            // Better TP: target liquidity below recent lows
            let supportTarget;
            if (liquiditySweeps.length === 0) {
                supportTarget = recentLow - (atr * 0.5);
            } else {
                supportTarget = idealEntry - (atr * 3);
            }
            takeProfit = supportTarget;
            
            entryInstruction = `📉 SHORT Setup: Wait for rally to $${idealEntry.toFixed(2)} (FVG/OB zone)`;
        }
        
        let distanceToEntry = 0;
        let progress = 0;
        let distanceText = '';
        
        if (signalType === 'LONG' && idealEntry) {
            distanceToEntry = currentPrice - idealEntry;
            if (distanceToEntry <= 0) {
                progress = 100;
                distanceText = '✅ Price is AT or BELOW ideal entry - Ready to enter!';
            } else {
                const maxDistance = atr * 2;
                progress = Math.min(100, (1 - distanceToEntry / maxDistance) * 100);
                distanceText = `📏 Price needs to drop $${distanceToEntry.toFixed(2)} more to reach ideal entry`;
            }
        } else if (signalType === 'SHORT' && idealEntry) {
            distanceToEntry = idealEntry - currentPrice;
            if (distanceToEntry <= 0) {
                progress = 100;
                distanceText = '✅ Price is AT or ABOVE ideal entry - Ready to enter!';
            } else {
                const maxDistance = atr * 2;
                progress = Math.min(100, (1 - distanceToEntry / maxDistance) * 100);
                distanceText = `📏 Price needs to rise $${distanceToEntry.toFixed(2)} more to reach ideal entry`;
            }
        }
        
        let riskReward = 'N/A';
        if (signalType === 'LONG' && idealEntry && stopLoss && takeProfit) {
            const risk = idealEntry - stopLoss;
            const reward = takeProfit - idealEntry;
            if (risk > 0) riskReward = (reward / risk).toFixed(1);
        } else if (signalType === 'SHORT' && idealEntry && stopLoss && takeProfit) {
            const risk = stopLoss - idealEntry;
            const reward = idealEntry - takeProfit;
            if (risk > 0) riskReward = (reward / risk).toFixed(1);
        }
        
        let divergence = '';
        if (rsi < 30 && trend === 'bearish') divergence = 'Bullish Divergence (reversal up possible)';
        if (rsi > 70 && trend === 'bullish') divergence = 'Bearish Divergence (reversal down possible)';
        
        // UPDATE UI
        document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(2)}`;
        if (lastPrice) {
            const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
            const changeEl = document.getElementById('priceChange');
            changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
            changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
        }
        lastPrice = currentPrice;
        
        document.getElementById('idealEntryZone').innerHTML = idealEntry ? `$${idealEntry.toFixed(2)}` : '--';
        document.getElementById('entryInstruction').innerHTML = entryInstruction || 'No clear signal - Wait for setup';
        document.getElementById('zoneProgress').style.width = `${progress}%`;
        document.getElementById('distanceText').innerHTML = distanceText || 'Analyzing market...';
        
        const signalTypeBox = document.getElementById('signalTypeText');
        signalTypeBox.innerHTML = signalType;
        signalTypeBox.parentElement.className = `signal-type-box ${signalType.toLowerCase()}`;
        
        document.getElementById('confidenceText').innerHTML = `${confidence}%`;
        document.getElementById('idealEntryDisplay').innerHTML = idealEntry ? `$${idealEntry.toFixed(2)}` : '--';
        document.getElementById('entryPrice').innerHTML = `$${currentPrice.toFixed(2)}`;
        document.getElementById('takeProfit').innerHTML = takeProfit ? `$${takeProfit.toFixed(2)}` : '--';
        document.getElementById('stopLoss').innerHTML = stopLoss ? `$${stopLoss.toFixed(2)}` : '--';
        document.getElementById('riskReward').innerHTML = riskReward;
        
        let reason = `📊 ${trend === 'bullish' ? 'Bullish' : (trend === 'bearish' ? 'Bearish' : 'Neutral')} trend | ${strength} | RSI: ${rsi.toFixed(1)}`;
        if (divergence) reason += `\n🔄 ${divergence}`;
        if (volumeProfile?.poc) reason += `\n📊 POC: $${volumeProfile.poc.price.toFixed(2)} | Value Area: $${volumeProfile.valueAreaLow.toFixed(2)} - $${volumeProfile.valueAreaHigh.toFixed(2)}`;
        if (orderFlow) reason += `\n📦 Order Flow Delta: ${(orderFlow.netDelta / 1000000).toFixed(1)}M | Absorption: ${orderFlow.absorptionSignals} signals`;
        if (idealEntry) reason += `\n🎯 Ideal Entry: $${idealEntry.toFixed(2)} (${signalType === 'LONG' ? 'Support' : 'Resistance'})`;
        document.getElementById('signalReason').innerHTML = reason;
        
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
        
        if (volumeProfile) {
            document.getElementById('pocValue').innerHTML = `$${volumeProfile.poc?.price.toFixed(2) || '--'}`;
            document.getElementById('valueHigh').innerHTML = `$${volumeProfile.valueAreaHigh?.toFixed(2) || '--'}`;
            document.getElementById('valueLow').innerHTML = `$${volumeProfile.valueAreaLow?.toFixed(2) || '--'}`;
            document.getElementById('totalVolume').innerHTML = `${(volumeProfile.totalVolume / 1000000).toFixed(1)}M`;
        }
        
        if (orderFlow) {
            document.getElementById('buyingPressure').innerHTML = `${(orderFlow.buyingPressure / 1000000).toFixed(1)}M`;
            document.getElementById('sellingPressure').innerHTML = `${(orderFlow.sellingPressure / 1000000).toFixed(1)}M`;
            document.getElementById('netDelta').innerHTML = `${(orderFlow.netDelta / 1000000).toFixed(1)}M`;
            document.getElementById('vwapValue').innerHTML = `$${orderFlow.vwap.toFixed(2)}`;
        }
        
        document.getElementById('trend4H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
        document.getElementById('trend4H').className = `trend ${trend}`;
        document.getElementById('strength4H').innerHTML = strength;
        
        // UPDATED: Show real FVG detection status
        const fvgStatus = fvgList.length > 0 ? `✅ ${fvgList.length} FVG(s)` : '❌ None';
        document.getElementById('fvg4H').innerHTML = fvgStatus;
        
        // UPDATED: Show real Order Block detection status
        const obStatus = orderBlocks.length > 0 ? `✅ ${orderBlocks.length} OB(s)` : '❌ None';
        document.getElementById('ob4H').innerHTML = obStatus;
        
        // UPDATED: Show real market structure
        document.getElementById('ms4H').innerHTML = marketStructure.signal;
        
        // NEW: Display multi-timeframe analysis results
        if (mtfAnalysis) {
            const tf1h = mtfAnalysis.results['1H'];
            const tf4h = mtfAnalysis.results['4H'];
            const tf1d = mtfAnalysis.results['1D'];
            
            if (tf1h) {
                document.getElementById('trend1H').innerHTML = tf1h.trend === 'bullish' ? '🟢 Bullish' : (tf1h.trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
                document.getElementById('trend1H').className = `trend ${tf1h.trend}`;
                document.getElementById('rsi1H').innerHTML = tf1h.rsi.toFixed(1);
            }
            
            if (tf4h) {
                document.getElementById('trend4H').innerHTML = tf4h.trend === 'bullish' ? '🟢 Bullish' : (tf4h.trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
                document.getElementById('trend4H').className = `trend ${tf4h.trend}`;
                document.getElementById('strength4H').innerHTML = mtfAnalysis.trendStrength.charAt(0).toUpperCase() + mtfAnalysis.trendStrength.slice(1);
                document.getElementById('fvg4H').innerHTML = tf4h.fvgCount > 0 ? `✅ ${tf4h.fvgCount} FVG(s)` : '❌ None';
                document.getElementById('ob4H').innerHTML = tf4h.orderBlockCount > 0 ? `✅ ${tf4h.orderBlockCount} OB(s)` : '❌ None';
                document.getElementById('ms4H').innerHTML = tf4h.marketStructure.signal;
            }
            
            // Add daily trend info to divergence section
            if (tf1d) {
                const dailyTrendText = tf1d.trend === 'bullish' ? '🟢 Bullish' : (tf1d.trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
                document.getElementById('divergence1H').innerHTML = `${divergence || 'None'} | 1D: ${dailyTrendText}`;
            }
            
            // Show alignment status
            const alignmentStatus = mtfAnalysis.allAligned ? '✅ All TFs Aligned' : `⚠️ Mixed (${mtfAnalysis.trends.join(', ')})`;
            document.getElementById('absorption1H').innerHTML = orderFlow?.absorptionSignals > 0 ? `⚠️ ${orderFlow.absorptionSignals}` : alignmentStatus;
            document.getElementById('choch1H').innerHTML = marketStructure.signal !== 'None' ? marketStructure.signal : (mtfAnalysis.overallTrend !== 'neutral' ? `MTF: ${mtfAnalysis.overallTrend}` : 'None');
        } else {
            // Fallback if MTF analysis failed
            document.getElementById('trend1H').innerHTML = trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral');
            document.getElementById('trend1H').className = `trend ${trend}`;
            document.getElementById('rsi1H').innerHTML = rsi.toFixed(1);
            document.getElementById('divergence1H').innerHTML = divergence || 'None';
            document.getElementById('absorption1H').innerHTML = orderFlow?.absorptionSignals > 0 ? `⚠️ ${orderFlow.absorptionSignals}` : 'None';
            document.getElementById('choch1H').innerHTML = marketStructure.signal !== 'None' ? marketStructure.signal : 'None';
        }
        
        document.getElementById('fib382').innerHTML = `$${fib382.toFixed(2)}`;
        document.getElementById('fib500').innerHTML = `$${fib500.toFixed(2)}`;
        document.getElementById('fib618').innerHTML = `$${fib618.toFixed(2)}`;
        document.getElementById('fib786').innerHTML = `$${fib786.toFixed(2)}`;
        
        document.getElementById('buySideLiq').innerHTML = `$${(recentHigh + atr).toFixed(2)}`;
        document.getElementById('sellSideLiq').innerHTML = `$${(recentLow - atr).toFixed(2)}`;
        document.getElementById('bosLevel').innerHTML = trend === 'bullish' ? `$${recentHigh.toFixed(2)}` : `$${recentLow.toFixed(2)}`;
        document.getElementById('chochLevel').innerHTML = orderFlow?.vwap ? `VWAP: $${orderFlow.vwap.toFixed(2)}` : '--';
        
        // UPDATED: Require higher confidence (65%) and progress >= 70% to enable execute
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= MIN_CONFIDENCE && progress >= 70;
        executeBtn.disabled = !shouldExecute;
        
        analysisData = { signalType, idealEntry, currentPrice, stopLoss, takeProfit, riskReward, confidence, currentPair, progress };
        
        apiCalls++;
        document.getElementById('apiUsage').innerHTML = `${apiCalls}`;
        
        // Add ICT confluence info to notification
        let ictInfo = '';
        if (fvgList.length > 0 || orderBlocks.length > 0 || liquiditySweeps.length > 0) {
            ictInfo = ` | FVG:${fvgList.length} OB:${orderBlocks.length} Sweep:${liquiditySweeps.length}`;
        }
        
        // Add multi-timeframe alignment info
        let mtfInfo = '';
        if (mtfAnalysis) {
            if (mtfAnalysis.allAligned) {
                mtfInfo = ` | 🎯 MTF: All TFs aligned (${mtfAnalysis.overallTrend})`;
            } else {
                mtfInfo = ` | ⚠️ MTF: Mixed signals (${mtfAnalysis.trends.join('/')})`;
            }
        }
        
        showNotification(`Analysis complete! ${signalType} signal with ${confidence}% confidence${ictInfo}${mtfInfo}`, 'success');
        
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
    
    // AUTO-REFRESH: Update prices every 30 seconds when analysis has been run
    priceUpdateInterval = setInterval(async () => {
        if (analysisData && analysisData.currentPair) {
            try {
                const newPrice = await getCurrentPrice();
                if (newPrice) {
                    document.getElementById('currentPrice').innerHTML = `$${newPrice.toFixed(2)}`;
                    if (lastPrice) {
                        const change = ((newPrice - lastPrice) / lastPrice * 100).toFixed(2);
                        const changeEl = document.getElementById('priceChange');
                        changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
                        changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
                    }
                    lastPrice = newPrice;
                    
                    // Update progress based on new price
                    if (analysisData.signalType === 'LONG' && analysisData.idealEntry) {
                        const distanceToEntry = newPrice - analysisData.idealEntry;
                        if (distanceToEntry <= 0) {
                            document.getElementById('zoneProgress').style.width = '100%';
                            document.getElementById('distanceText').innerHTML = '✅ Price is AT or BELOW ideal entry - Ready to enter!';
                        }
                    } else if (analysisData.signalType === 'SHORT' && analysisData.idealEntry) {
                        const distanceToEntry = analysisData.idealEntry - newPrice;
                        if (distanceToEntry <= 0) {
                            document.getElementById('zoneProgress').style.width = '100%';
                            document.getElementById('distanceText').innerHTML = '✅ Price is AT or ABOVE ideal entry - Ready to enter!';
                        }
                    }
                }
            } catch(e) {
                console.log('Auto-refresh error:', e);
            }
        }
    }, 30000); // 30 seconds
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
    document.getElementById('idealEntryDisplay').innerHTML = '--';
    document.getElementById('entryPrice').innerHTML = '--';
    document.getElementById('takeProfit').innerHTML = '--';
    document.getElementById('stopLoss').innerHTML = '--';
    document.getElementById('riskReward').innerHTML = '--';
    document.getElementById('signalReason').innerHTML = '--';
    executeBtn.disabled = true;
    
    // Reset analysis data to stop auto-refresh updates
    analysisData = null;
}

function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }
    
    if (analysisData.progress < 70) {
        showNotification(`Price not at ideal entry (${analysisData.progress.toFixed(0)}% to target). Wait for pullback!`, 'warning');
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
            riskReward: analysisData.riskReward,
            confidence: analysisData.confidence,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order ready! Enter at $${analysisData.idealEntry.toFixed(2)}`, 'success');
}

function showNotification(message, type) {
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    // Add show class for animation
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        notification.classList.add('hidden');
    }, 4000);
}

// Start the app
init();
