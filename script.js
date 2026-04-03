// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// ALPHA VANTAGE API CONFIGURATION
// ============================================
const ALPHA_VANTAGE_KEY = 'E4HPPIL10X34R418';
const USE_ALPHA_VANTAGE = true;  // Using Alpha Vantage
const USE_MOCK_FALLBACK = true;   // Fallback to mock if API fails

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;

// Mock price database (fallback)
const mockPrices = {
    'BTC/USD': { price: 43250.75, change: 2.3 },
    'ETH/USD': { price: 2280.50, change: 1.8 },
    'BNB/USD': { price: 310.25, change: -0.5 },
    'SOL/USD': { price: 98.40, change: 5.2 },
    'XRP/USD': { price: 0.62, change: 1.2 },
    'EUR/USD': { price: 1.0890, change: 0.3 },
    'GBP/USD': { price: 1.2750, change: -0.2 },
    'USD/JPY': { price: 148.50, change: 0.1 },
    'AUD/USD': { price: 0.6580, change: 0.4 },
    'USD/CAD': { price: 1.3450, change: -0.1 },
    'XAU/USD': { price: 2035.80, change: 0.7 },
    'XAG/USD': { price: 23.45, change: 1.1 },
    'XPT/USD': { price: 912.30, change: -0.3 },
    'XPD/USD': { price: 985.60, change: 0.5 }
};

// ============================================
// ALPHA VANTAGE API FUNCTIONS
// ============================================

// Convert pair format (BTC/USD -> BTCUSD)
function formatPairForAlphaVantage(symbol) {
    return symbol.replace('/', '');
}

// Fetch current price from Alpha Vantage
async function fetchPriceAlphaVantage(symbol) {
    const pair = formatPairForAlphaVantage(symbol);
    
    // For crypto
    if (symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('BNB') || symbol.includes('SOL') || symbol.includes('XRP')) {
        const cryptoPair = pair.replace('USD', '');
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${cryptoPair}&to_currency=USD&apikey=${ALPHA_VANTAGE_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data['Realtime Currency Exchange Rate']) {
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
        throw new Error('No data for crypto');
    }
    
    // For forex
    if (symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('USD') || symbol.includes('AUD') || symbol.includes('CAD') || symbol.includes('JPY')) {
        const fromCurrency = pair.substring(0, 3);
        const toCurrency = pair.substring(3, 6);
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${ALPHA_VANTAGE_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data['Realtime Currency Exchange Rate']) {
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
        throw new Error('No data for forex');
    }
    
    // For metals (XAU, XAG, etc.)
    if (symbol.includes('XAU')) {
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${ALPHA_VANTAGE_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data['Realtime Currency Exchange Rate']) {
            return parseFloat(data['Realtime Currency Exchange Rate']['5. Exchange Rate']);
        }
        throw new Error('No data for metals');
    }
    
    throw new Error('Unsupported pair');
}

// Fetch historical data from Alpha Vantage
async function fetchHistoricalAlphaVantage(symbol, interval) {
    const pair = formatPairForAlphaVantage(symbol);
    const intervals = { '1H': '60min', '4H': '60min', '1D': 'daily' };
    
    // Map intervals
    let function_name = 'FX_DAILY';
    let outputsize = 'compact';
    
    if (interval === '1H' || interval === '4H') {
        function_name = 'FX_INTRADAY';
        const timeInterval = interval === '1H' ? '60min' : '60min';
        
        // For crypto
        if (symbol.includes('BTC') || symbol.includes('ETH')) {
            const cryptoPair = pair.replace('USD', '');
            const url = `https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=${cryptoPair}&market=USD&interval=60min&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data['Time Series Crypto (60min)']) {
                const timeSeries = data['Time Series Crypto (60min)'];
                const candles = [];
                for (const [time, values] of Object.entries(timeSeries)) {
                    candles.push({
                        time: new Date(time),
                        open: parseFloat(values['1a. open (USD)']),
                        high: parseFloat(values['2a. high (USD)']),
                        low: parseFloat(values['3a. low (USD)']),
                        close: parseFloat(values['4a. close (USD)']),
                        volume: parseFloat(values['5. volume'])
                    });
                }
                return candles.reverse();
            }
        }
        
        // For forex
        const fromCurrency = pair.substring(0, 3);
        const toCurrency = pair.substring(3, 6);
        const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&interval=60min&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data['Time Series FX (60min)']) {
            const timeSeries = data['Time Series FX (60min)'];
            const candles = [];
            for (const [time, values] of Object.entries(timeSeries)) {
                candles.push({
                    time: new Date(time),
                    open: parseFloat(values['1. open']),
                    high: parseFloat(values['2. high']),
                    low: parseFloat(values['3. low']),
                    close: parseFloat(values['4. close']),
                    volume: 0
                });
            }
            return candles.reverse();
        }
    }
    
    // For daily data
    if (symbol.includes('BTC') || symbol.includes('ETH')) {
        const cryptoPair = pair.replace('USD', '');
        const url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${cryptoPair}&market=USD&apikey=${ALPHA_VANTAGE_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data['Time Series (Digital Currency Daily)']) {
            const timeSeries = data['Time Series (Digital Currency Daily)'];
            const candles = [];
            for (const [time, values] of Object.entries(timeSeries)) {
                candles.push({
                    time: new Date(time),
                    open: parseFloat(values['1a. open (USD)']),
                    high: parseFloat(values['2a. high (USD)']),
                    low: parseFloat(values['3a. low (USD)']),
                    close: parseFloat(values['4a. close (USD)']),
                    volume: parseFloat(values['5. volume'])
                });
            }
            return candles.reverse();
        }
    }
    
    // For forex daily
    const fromCurrency = pair.substring(0, 3);
    const toCurrency = pair.substring(3, 6);
    const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data['Time Series FX (Daily)']) {
        const timeSeries = data['Time Series FX (Daily)'];
        const candles = [];
        for (const [time, values] of Object.entries(timeSeries)) {
            candles.push({
                time: new Date(time),
                open: parseFloat(values['1. open']),
                high: parseFloat(values['2. high']),
                low: parseFloat(values['3. low']),
                close: parseFloat(values['4. close']),
                volume: 0
            });
        }
        return candles.reverse();
    }
    
    throw new Error('No historical data available');
}

// Generate mock data as fallback
function generateMockData(symbol, interval, count = 100) {
    const basePrice = mockPrices[symbol]?.price || 100;
    const volatility = symbol.includes('USD') ? 0.02 : 0.01;
    const data = [];
    let currentPrice = basePrice;
    
    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.5) * volatility * currentPrice;
        const open = currentPrice;
        const close = currentPrice + change;
        const high = Math.max(open, close) + Math.random() * volatility * currentPrice;
        const low = Math.min(open, close) - Math.random() * volatility * currentPrice;
        
        data.push({
            time: new Date(Date.now() - (count - i) * 3600000),
            open: open,
            high: high,
            low: low,
            close: close,
            volume: Math.random() * 1000000
        });
        currentPrice = close;
    }
    return data;
}

// ============================================
// TECHNICAL ANALYSIS FUNCTIONS
// ============================================

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
    const start = Math.max(0, data.length - period);
    
    for (let i = start + 1; i < data.length; i++) {
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
        const tr = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i-1].close),
            Math.abs(data[i].low - data[i-1].close)
        );
        trueRanges.push(tr);
    }
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr || data[data.length-1].close * 0.01;
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
        const next = data[i];
        if (prev.high < next.low) {
            fvgs.push({ type: 'bullish', upper: next.low, lower: prev.high });
        }
        if (prev.low > next.high) {
            fvgs.push({ type: 'bearish', upper: prev.low, lower: next.high });
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
        }
    };
    
    let nearestLevel = null;
    let minDiff = Infinity;
    for (const [key, value] of Object.entries(levels.retracement)) {
        const diffAbs = Math.abs(currentPrice - value);
        if (diffAbs < minDiff) {
            minDiff = diffAbs;
            nearestLevel = { key, value };
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

// ============================================
// DOM ELEMENTS
// ============================================
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

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
            'XAU/USD': '👑', 'XAG/USD': '🥈', 'XPT/USD': '⚪', 'XPD/USD': '🔘'
        };
        return `<option value="${pair}">${icons[pair] || '📊'} ${pair}</option>`;
    }).join('');
    currentPair = pairs[category][0];
    resetAnalysis();
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market with ICT + Fibonacci...', 'info');

    try {
        let currentPrice;
        let data;
        let usedMock = false;
        
        if (USE_ALPHA_VANTAGE) {
            try {
                // Try Alpha Vantage API
                currentPrice = await fetchPriceAlphaVantage(currentPair);
                data = await fetchHistoricalAlphaVantage(currentPair, currentTimeframe);
                showNotification(`Live price: $${currentPrice.toFixed(2)} (Alpha Vantage)`, 'success');
            } catch (apiError) {
                console.warn('Alpha Vantage API error:', apiError);
                if (USE_MOCK_FALLBACK) {
                    usedMock = true;
                    currentPrice = mockPrices[currentPair]?.price || 50000;
                    data = generateMockData(currentPair, currentTimeframe, 100);
                    showNotification(`API limit reached - Using demo data`, 'warning');
                } else {
                    throw apiError;
                }
            }
        } else {
            // Use mock data
            currentPrice = mockPrices[currentPair]?.price || 50000;
            data = generateMockData(currentPair, currentTimeframe, 100);
        }
        
        if (!data || data.length < 30) throw new Error('Insufficient data');
        
        // Calculate indicators
        const ema20 = calculateEMA(data, 20);
        const ema50 = calculateEMA(data, 50);
        const rsi = calculateRSI(data, 14);
        const atr = calculateATR(data, 14);
        
        // Find technical levels
        const swingPoints = findSwingPoints(data, 5);
        const orderBlocks = findOrderBlocks(data, swingPoints);
        const fvgs = findFVGs(data);
        const marketStructure = detectMarketStructure(swingPoints, currentPrice);
        
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
        const fibonacci = calculateFibonacci(recentHigh, recentLow, currentPrice);
        
        // Calculate confidence score
        let confidenceScore = 30;
        if (trend !== 'neutral') confidenceScore += 20;
        if ((trend === 'bullish' && rsi > 40 && rsi < 70) ||
            (trend === 'bearish' && rsi < 60 && rsi > 30)) confidenceScore += 15;
        if (orderBlocks.length > 0) confidenceScore += 15;
        if (fvgs.length > 0) confidenceScore += 10;
        if (fibonacci.nearestLevel && 
            Math.abs(currentPrice - fibonacci.nearestLevel.value) / currentPrice * 100 < 0.5) {
            confidenceScore += 10;
        }
        
        confidenceScore = Math.min(confidenceScore, 95);
        
        // Generate signal
        let signal = null;
        if (trend === 'bullish' && confidenceScore >= 50) {
            const entryPrice = currentPrice;
            const stopLoss = entryPrice - (atr * 1.5);
            const takeProfit = entryPrice + (atr * 2.5);
            const risk = entryPrice - stopLoss;
            const reward = takeProfit - entryPrice;
            
            signal = {
                type: 'LONG',
                confidence: `${confidenceScore}%`,
                entry: entryPrice,
                tp: takeProfit,
                sl: stopLoss,
                rr: (reward / risk).toFixed(1)
            };
        } else if (trend === 'bearish' && confidenceScore >= 50) {
            const entryPrice = currentPrice;
            const stopLoss = entryPrice + (atr * 1.5);
            const takeProfit = entryPrice - (atr * 2.5);
            const risk = stopLoss - entryPrice;
            const reward = entryPrice - takeProfit;
            
            signal = {
                type: 'SHORT',
                confidence: `${confidenceScore}%`,
                entry: entryPrice,
                tp: takeProfit,
                sl: stopLoss,
                rr: (reward / risk).toFixed(1)
            };
        } else {
            signal = {
                type: 'NEUTRAL',
                confidence: `${confidenceScore}%`,
                entry: currentPrice,
                tp: currentPrice,
                sl: currentPrice,
                rr: 'N/A'
            };
        }
        
        // Prepare analysis data
        analysisData = {
            trend4H: trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral'),
            strength4H: strength,
            fvg4H: fvgs.length > 0 ? `✅ ${fvgs.length} Detected` : '❌ None',
            ob4H: orderBlocks.length > 0 ? `✅ ${orderBlocks.length} Present` : '❌ None',
            ms4H: marketStructure.structure,
            trend1H: trend === 'bullish' ? '🟢 Bullish' : (trend === 'bearish' ? '🔴 Bearish' : '⚪ Neutral'),
            strength1H: strength,
            fvg1H: fvgs.length > 0 ? `✅ ${fvgs.length} Detected` : '❌ None',
            ob1H: orderBlocks.length > 0 ? `✅ ${orderBlocks.length} Present` : '❌ None',
            ms1H: marketStructure.structure,
            signal: signal,
            confidence: confidenceScore,
            rsi: rsi.toFixed(1),
            atr: atr.toFixed(2),
            usedMock: usedMock,
            zones: {
                fvgZones: fvgs.slice(0, 3).map(fvg => 
                    `${fvg.type.toUpperCase()}: $${fvg.lower.toFixed(2)} - $${fvg.upper.toFixed(2)}`
                ),
                orderBlocks: orderBlocks.slice(0, 3).map(ob => 
                    `${ob.type.toUpperCase()}: $${ob.low.toFixed(2)} - $${ob.high.toFixed(2)}`
                ),
                fibonacci: {
                    level382: `$${fibonacci.levels.retracement.level382.toFixed(2)}`,
                    level500: `$${fibonacci.levels.retracement.level500.toFixed(2)}`,
                    level618: `$${fibonacci.levels.retracement.level618.toFixed(2)}`,
                    level786: `$${fibonacci.levels.retracement.level786.toFixed(2)}`,
                    currentLevel: fibonacci.nearestLevel ? 
                        `${fibonacci.nearestLevel.key.replace('level', '')}% at $${fibonacci.nearestLevel.value.toFixed(2)}` : 
                        'No nearby level'
                },
                liquidity: {
                    buySide: `$${(recentHigh + atr).toFixed(2)}`,
                    sellSide: `$${(recentLow - atr).toFixed(2)}`
                },
                structure: {
                    bos: marketStructure.bosLevel ? `$${marketStructure.bosLevel.toFixed(2)}` : '--',
                    choch: marketStructure.chochLevel ? `$${marketStructure.chochLevel.toFixed(2)}` : '--'
                }
            }
        };
        
        // Update UI
        updateUI(analysisData, currentPrice);
        
        // Enable execute button if confidence is high
        if (analysisData.confidence >= 50 && analysisData.signal.type !== 'NEUTRAL') {
            enableExecuteButton();
        } else {
            disableExecuteButton();
        }
        
        // Update API Usage
        apiCalls++;
        document.getElementById('apiUsage').textContent = `${apiCalls} / 800`;
        showNotification('Analysis Complete!', 'success');
        
    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

function updateUI(data, price) {
    // Update price display
    const change = mockPrices[currentPair]?.change || 0;
    const priceChangeEl = document.getElementById('priceChange');
    if (priceChangeEl) {
        priceChangeEl.innerHTML = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
        priceChangeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
    }
    
    const apiStatus = data.usedMock ? ' (Demo Mode)' : ' (Live)';
    document.getElementById('currentPrice').innerHTML = `$${price.toFixed(2)}${apiStatus}<span style="font-size:12px; display:block;">RSI: ${data.rsi} | ATR: ${data.atr}</span>`;
    
    // 4H Analysis
    document.getElementById('trend4H').innerHTML = data.trend4H || '--';
    document.getElementById('trend4H').className = `value trend-value ${data.trend4H?.includes('Bullish') ? 'bullish' : (data.trend4H?.includes('Bearish') ? 'bearish' : '')}`;
    document.getElementById('strength4H').innerHTML = data.strength4H || '--';
    document.getElementById('fvg4H').innerHTML = data.fvg4H || '--';
    document.getElementById('ob4H').innerHTML = data.ob4H || '--';
    document.getElementById('ms4H').innerHTML = data.ms4H || '--';
    
    // 1H Analysis
    document.getElementById('trend1H').innerHTML = data.trend1H || '--';
    document.getElementById('trend1H').className = `value trend-value ${data.trend1H?.includes('Bullish') ? 'bullish' : (data.trend1H?.includes('Bearish') ? 'bearish' : '')}`;
    document.getElementById('strength1H').innerHTML = data.strength1H || '--';
    document.getElementById('fvg1H').innerHTML = data.fvg1H || '--';
    document.getElementById('ob1H').innerHTML = data.ob1H || '--';
    document.getElementById('ms1H').innerHTML = data.ms1H || '--';
    
    // Trading Signal
    const signalType = document.getElementById('signalType');
    signalType.innerHTML = data.signal?.type || '--';
    signalType.className = `value signal-type ${data.signal?.type === 'LONG' ? 'long' : (data.signal?.type === 'SHORT' ? 'short' : '')}`;
    
    document.getElementById('signalConfidence').innerHTML = data.signal?.confidence || '--';
    document.getElementById('signalEntry').innerHTML = data.signal?.entry ? `$${data.signal.entry.toFixed(2)}` : '--';
    document.getElementById('signalTP').innerHTML = data.signal?.tp ? `$${data.signal.tp.toFixed(2)}` : '--';
    document.getElementById('signalSL').innerHTML = data.signal?.sl ? `$${data.signal.sl.toFixed(2)}` : '--';
    document.getElementById('signalRR').innerHTML = data.signal?.rr || '--';
    
    // Update badge
    const badge = document.getElementById('signalStrengthBadge');
    if (badge) {
        const conf = data.confidence;
        badge.textContent = conf >= 70 ? '🔥 HIGH CONFIDENCE' : (conf >= 50 ? '📊 MEDIUM' : '⚠️ LOW');
        badge.className = `signal-badge ${conf >= 70 ? 'high' : (conf >= 50 ? 'medium' : 'low')}`;
    }
    
    // ICT Zones
    if (data.zones) {
        const fvgContainer = document.getElementById('fvgZonesDisplay');
        if (fvgContainer) {
            fvgContainer.innerHTML = data.zones.fvgZones.map(zone => 
                `<div class="zone-tag">${zone}</div>`
            ).join('') || '<div class="zone-tag">No FVG zones detected</div>';
        }
        
        const obContainer = document.getElementById('obZonesDisplay');
        if (obContainer) {
            obContainer.innerHTML = data.zones.orderBlocks.map(ob => 
                `<div class="zone-tag">${ob}</div>`
            ).join('') || '<div class="zone-tag">No order blocks detected</div>';
        }
        
        const fibContainer = document.getElementById('fibLevelsDisplay');
        if (fibContainer && data.zones.fibonacci) {
            fibContainer.innerHTML = `
                <div class="zone-tag fib">📐 38.2%: ${data.zones.fibonacci.level382}</div>
                <div class="zone-tag fib">📐 50%: ${data.zones.fibonacci.level500}</div>
                <div class="zone-tag fib">📐 61.8%: ${data.zones.fibonacci.level618}</div>
                <div class="zone-tag fib">📐 78.6%: ${data.zones.fibonacci.level786}</div>
                <div class="zone-tag" style="background:#3390ec20; border-left-color:#3390ec;">🎯 ${data.zones.fibonacci.currentLevel}</div>
            `;
        }
        
        document.getElementById('buySideLiq').textContent = data.zones.liquidity.buySide;
        document.getElementById('sellSideLiq').textContent = data.zones.liquidity.sellSide;
        document.getElementById('bosLevel').textContent = data.zones.structure.bos;
        document.getElementById('chochLevel').textContent = data.zones.structure.choch;
    }
}

function enableExecuteButton() {
    executeBtn.disabled = false;
}

function disableExecuteButton() {
    executeBtn.disabled = true;
}

function resetAnalysis() {
    document.querySelectorAll('.value').forEach(el => {
        if (el.id !== 'signalType') el.innerHTML = '--';
    });
    document.getElementById('currentPrice').innerHTML = '----';
    document.getElementById('priceChange').innerHTML = '--';
    document.getElementById('priceChange').className = 'price-change';
    
    const fvgContainer = document.getElementById('fvgZonesDisplay');
    const obContainer = document.getElementById('obZonesDisplay');
    const fibContainer = document.getElementById('fibLevelsDisplay');
    if (fvgContainer) fvgContainer.innerHTML = 'Click Analyze to see zones';
    if (obContainer) obContainer.innerHTML = 'Click Analyze to see zones';
    if (fibContainer) fibContainer.innerHTML = 'Click Analyze to see Fibonacci levels';
    
    document.getElementById('buySideLiq').textContent = '--';
    document.getElementById('sellSideLiq').text
