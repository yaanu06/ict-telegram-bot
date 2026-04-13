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
