// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// TWELVE DATA API CONFIGURATION
// ============================================
const TWELVE_DATA_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa'; // Your API key
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';

// Symbol mapping for Twelve Data (they use different formats)
const TWELVE_DATA_SYMBOLS = {
    // Crypto
    'BTC/USD': 'BTC/USD',
    'ETH/USD': 'ETH/USD',
    'BNB/USD': 'BNB/USD',
    'SOL/USD': 'SOL/USD',
    'XRP/USD': 'XRP/USD',
    // Forex
    'EUR/USD': 'EUR/USD',
    'GBP/USD': 'GBP/USD',
    'USD/JPY': 'USD/JPY',
    'AUD/USD': 'AUD/USD',
    'USD/CAD': 'USD/CAD',
    // Metals
    'XAU/USD': 'XAU/USD',
    'XAG/USD': 'XAG/USD',
    'XPT/USD': 'XPT/USD',
    'XPD/USD': 'XPD/USD'
};

// Timeframe mapping
const TIMEFRAME_MAP = {
    '15M': '15min',
    '1H': '1h',
    '4H': '4h',
    '1D': '1day',
    '1W': '1week'
};

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let priceChart = null;
let chartData = [];
let allTimeframeData = {};

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
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
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
    if (executeBtn) executeBtn.addEventListener('click', executeOrder);
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
            if (chartData.length > 0) {
                updateChartWithTimeframe();
            }
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
        'USD/CAD': '🇨🇦', 'BNB/USD': '💰', 'SOL/USD': '☀️', 'XRP/USD': '💧',
        'XPT/USD': '🔘', 'XPD/USD': '⚪'
    };
    const icon = icons[pair] || '📊';
    return `${icon} ${pair}`;
}

// ============================================
// TWELVE DATA API FUNCTIONS (PRIMARY)
// ============================================

async function getPrice() {
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    if (!symbol) {
        console.error('No Twelve Data symbol mapping for:', currentPair);
        return null;
    }
    
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
        
        // Check for API limit error
        if (data.code === 429) {
            console.error('Twelve Data rate limit reached');
            document.getElementById('apiSource').innerHTML = '⚠️ API Limit';
            showNotification('API limit reached. Try again in a minute.', 'warning');
            return null;
        }
        
        console.error('Twelve Data price error:', data);
    } catch(e) {
        console.error('Twelve Data fetch error:', e);
    }
    
    document.getElementById('apiSource').innerHTML = '⚠️ Error';
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    const interval = TIMEFRAME_MAP[timeframe];
    
    if (!symbol || !interval) {
        console.error('Missing symbol or interval mapping');
        return null;
    }
    
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
        
        if (data.code === 429) {
            showNotification('API limit reached. Try again in a minute.', 'warning');
        }
        
        console.error('Twelve Data history error:', data);
    } catch(e) {
        console.error('Twelve Data history fetch error:', e);
    }
    
    return null;
}

function updateApiCounter() {
    document.getElementById('apiUsage').innerHTML = `${apiCalls}`;
}

// ============================================
// ALL TECHNICAL ANALYSIS FUNCTIONS
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
            fvgs.push({
                type: 'bullish',
                low: data[i-1].high,
                high: data[i+1].low,
                index: i
            });
        }
        if (data[i-1].low > data[i+1].high && data[i-1].low - data[i+1].high > data[i+1].close * 0.001) {
            fvgs.push({
                type: 'bearish',
                low: data[i+1].high,
                high: data[i-1].low,
                index: i
            });
        }
    }
    return fvgs;
}

function detectOrderBlocks(data) {
    const obs = [];
    for (let i = 2; i < data.length - 1; i++) {
        if (data[i].close < data[i].open && data[i+1].close > data[i+1].open && 
            data[i+1].close > data[i].high) {
            obs.push({
                type: 'bullish',
                high: data[i].high,
                low: data[i].low,
                index: i
            });
        }
        if (data[i].close > data[i].open && data[i+1].close < data[i+1].open && 
            data[i+1].close < data[i].low) {
            obs.push({
                type: 'bearish',
                high: data[i].high,
                low: data[i].low,
                index: i
            });
        }
    }
    return obs;
}

function detectLiquidityLevels(data) {
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const levels = [];
    
    for (let i = 2; i < data.length - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
            highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            levels.push({ type: 'resistance', price: highs[i], index: i });
        }
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
            lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            levels.push({ type: 'support', price: lows[i], index: i });
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
    
    return {
        buyingPressure: buyPressure,
        sellingPressure: sellPressure,
        netDelta: buyPressure - sellPressure,
        vwap: vwap
    };
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
    
    return {
        data,
        trend,
        rsi,
        volume: data.slice(-20).reduce((s, c) => s + c.volume, 0),
        structure: analyzeMarketStructure(data)
    };
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

function updateChart(data, fvgs = [], obs = [], liquidity = []) {
    if (!priceChart) return;
    
    const chartDataset = {
        label: currentPair,
        data: data.slice(-50).map(c => ({ x: c.time, y: c.close })),
        borderColor: '#3390ec',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1
    };
    
    priceChart.data.datasets = [chartDataset];
    priceChart.data.labels = data.slice(-50).map(c => 
        new Date(c.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
    
    priceChart.update();
}

function addFVGAnnotations(fvgs) {}
function addOBAnnotations(obs) {}
function addLiquidityAnnotations(liquidity) {}

function updateChartWithTimeframe() {
    if (allTimeframeData[currentTimeframe]) {
        updateChart(allTimeframeData[currentTimeframe]);
    }
}

function updateChartAnnotations() {
    if (chartData.length > 0) {
        updateChart(chartData);
    }
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market with Twelve Data...', 'info');

    try {
        const currentPrice = await getPrice();
        if (!currentPrice) throw new Error('Could not fetch price from Twelve Data');
        
        const mtfResults = await multiTimeframeAnalysis();
        
        const historicalData = await getHistoricalData();
        if (!historicalData || historicalData.length < 30) throw new Error('Insufficient historical data');
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
        
        if (mtfResults.confluenceScore > 75) {
            trend = mtfResults.direction.toLowerCase();
            strength = 'Strong (MTF Confluence)';
        }
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        
        const fibLevels = {
            fib0: recentLow,
            fib236: recentLow + range * 0.236,
            fib382: recentLow + range * 0.382,
            fib500: recentLow + range * 0.5,
            fib618: recentLow + range * 0.618,
            fib786: recentLow + range * 0.786,
            fib100: recentHigh
        };
        
        let idealEntry = currentPrice;
        let stopLoss = 0;
        let takeProfit1 = 0, takeProfit2 = 0, takeProfit3 = 0;
        let signalType = 'NEUTRAL';
        let confidence = 40;
        
        if (trend === 'bullish') {
            signalType = 'LONG';
            idealEntry = Math.max(fibLevels.fib618, volumeProfile?.valueAreaLow || recentLow);
            if (idealEntry >= currentPrice) idealEntry = currentPrice - (atr * 0.5);
            stopLoss = idealEntry - (atr * 1.2);
            
            const risk = idealEntry - stopLoss;
            takeProfit1 = idealEntry + (risk * 1.5);
            takeProfit2 = idealEntry + (risk * 2.5);
            takeProfit3 = idealEntry + (risk * 4);
            
            confidence = 55 + (rsi > 50 ? 10 : 0) + (orderFlow?.netDelta > 0 ? 10 : 0);
            confidence += mtfResults.confluenceScore > 70 ? 15 : 0;
            confidence = Math.min(confidence, 95);
        } else if (trend === 'bearish') {
            signalType = 'SHORT';
            idealEntry = Math.min(fibLevels.fib382, volumeProfile?.valueAreaHigh || recentHigh);
            if (idealEntry <= currentPrice) idealEntry = currentPrice + (atr * 0.5);
            stopLoss = idealEntry + (atr * 1.2);
            
            const risk = stopLoss - idealEntry;
            takeProfit1 = idealEntry - (risk * 1.5);
            takeProfit2 = idealEntry - (risk * 2.5);
            takeProfit3 = idealEntry - (risk * 4);
            
            confidence = 55 + (rsi < 50 ? 10 : 0) + (orderFlow?.netDelta < 0 ? 10 : 0);
            confidence += mtfResults.confluenceScore > 70 ? 15 : 0;
            confidence = Math.min(confidence, 95);
        }
        
        let riskReward = 'N/A';
        if (signalType !== 'NEUTRAL') {
            const risk = Math.abs(idealEntry - stopLoss);
            const reward = Math.abs(takeProfit1 - idealEntry);
            if (risk > 0) riskReward = (reward / risk).toFixed(1);
        }
        
        updatePriceDisplay(currentPrice);
        updateSignalDisplay(signalType, confidence, idealEntry, currentPrice, 
                          stopLoss, takeProfit1, takeProfit2, takeProfit3, riskReward);
        updateVolumeProfileDisplay(volumeProfile);
        updateOrderFlowDisplay(orderFlow);
        updateICTDisplay(fvgs, orderBlocks, liquidity, marketStructure);
        updateFibDisplay(fibLevels);
        
        updateChart(historicalData, fvgs, orderBlocks, liquidity);
        
        const shouldExecute = signalType !== 'NEUTRAL' && confidence >= 55;
        document.getElementById('executeBtn').disabled = !shouldExecute;
        
        analysisData = { 
            signalType, idealEntry, currentPrice, stopLoss, 
            takeProfit1, takeProfit2, takeProfit3, confidence 
        };
        
        calculatePositionSize();
        
        showNotification(`✅ Analysis complete! ${signalType} signal (${confidence}% confidence)`, 'success');
        
    } catch (error) {
        console.error(error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

function updatePriceDisplay(currentPrice) {
    document.getElementById('currentPrice').innerHTML = `$${currentPrice.toFixed(2)}`;
    
    if (lastPrice) {
        const change = ((currentPrice - lastPrice) / lastPrice * 100).toFixed(2);
        const changeEl = document.getElementById('priceChange');
        changeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
        changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    lastPrice = currentPrice;
}

function updateSignalDisplay(type, confidence, entry, current, sl, tp1, tp2, tp3, rr) {
    document.getElementById('signalTypeText').innerHTML = type;
    document.getElementById('signalTypeBox').className = `signal-type-box ${type.toLowerCase()}`;
    document.getElementById('confidenceText').innerHTML = `${confidence}%`;
    document.getElementById('idealEntryDisplay').innerHTML = `$${entry.toFixed(2)}`;
    document.getElementById('entryPrice').innerHTML = `$${current.toFixed(2)}`;
    document.getElementById('stopLoss').innerHTML = `$${sl.toFixed(2)}`;
    document.getElementById('takeProfit1').innerHTML = `$${tp1.toFixed(2)}`;
    document.getElementById('takeProfit2').innerHTML = `$${tp2.toFixed(2)}`;
    document.getElementById('takeProfit3').innerHTML = `$${tp3.toFixed(2)}`;
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
    
    document.getElementById('signalReason').innerHTML = 
        `Analysis based on ICT concepts, volume profile, and multi-timeframe confluence.`;
}

function updateVolumeProfileDisplay(vp) {
    if (!vp) return;
    document.getElementById('pocValue').innerHTML = `$${vp.poc?.price.toFixed(2) || '--'}`;
    document.getElementById('valueHigh').innerHTML = `$${vp.valueAreaHigh?.toFixed(2) || '--'}`;
    document.getElementById('valueLow').innerHTML = `$${vp.valueAreaLow?.toFixed(2) || '--'}`;
    document.getElementById('totalVolume').innerHTML = `${(vp.totalVolume / 1000000).toFixed(1)}M`;
}

function updateOrderFlowDisplay(of) {
    if (!of) return;
    document.getElementById('buyingPressure').innerHTML = `${(of.buyingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('sellingPressure').innerHTML = `${(of.sellingPressure / 1000000).toFixed(1)}M`;
    document.getElementById('netDelta').innerHTML = `${(of.netDelta / 1000000).toFixed(1)}M`;
    document.getElementById('vwapValue').innerHTML = `$${of.vwap.toFixed(2)}`;
}

function updateICTDisplay(fvgs, obs, liquidity, structure) {
    document.getElementById('fvgCount').innerHTML = fvgs.length;
    document.getElementById('obCount').innerHTML = obs.length;
    document.getElementById('liquidityLevels').innerHTML = liquidity.length;
    document.getElementById('marketStructure').innerHTML = structure;
}

function updateFibDisplay(levels) {
    document.getElementById('fib0').innerHTML = `$${levels.fib0.toFixed(2)}`;
    document.getElementById('fib236').innerHTML = `$${levels.fib236.toFixed(2)}`;
    document.getElementById('fib382').innerHTML = `$${levels.fib382.toFixed(2)}`;
    document.getElementById('fib500').innerHTML = `$${levels.fib500.toFixed(2)}`;
    document.getElementById('fib618').innerHTML = `$${levels.fib618.toFixed(2)}`;
    document.getElementById('fib786').innerHTML = `$${levels.fib786.toFixed(2)}`;
    document.getElementById('fib100').innerHTML = `$${levels.fib100.toFixed(2)}`;
}

function calculatePositionSize() {
    if (!analysisData || analysisData.signalType === 'NEUTRAL') return;
    
    const accountSize = parseFloat(document.getElementById('accountSize').value) || 10000;
    const riskPercent = parseFloat(document.getElementById('riskPercent').value) || 1;
    
    const riskAmount = accountSize * (riskPercent / 100);
    const stopDistance = Math.abs(analysisData.idealEntry - analysisData.stopLoss);
    const positionSize = riskAmount / stopDistance;
    const leverage = Math.min(100, Math.floor((positionSize * analysisData.currentPrice) / accountSize));
    
    document.getElementById('positionSize').innerHTML = positionSize.toFixed(4);
    document.getElementById('riskAmount').innerHTML = `$${riskAmount.toFixed(2)}`;
    document.getElementById('suggestedLeverage').innerHTML = `${leverage}x`;
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
            takeProfits: [
                analysisData.takeProfit1,
                analysisData.takeProfit2,
                analysisData.takeProfit3
            ],
            confidence: analysisData.confidence,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order executed with multiple TP levels!`, 'success');
}

function showNotification(message, type) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}
