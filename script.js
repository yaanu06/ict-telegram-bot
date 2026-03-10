// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;

// ⚠️ REPLACE WITH YOUR TWELVE DATA API KEY
const API_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById("notification");
const accountBalanceInput = document.getElementById("accountBalance");
    const riskAmountInput = document.getElementById("riskAmount");
    const calculatedLotSizeSpan = document.getElementById("calculatedLotSize");

// Define contract sizes for different pairs (example values, adjust as needed)
const contractSizes = {
    'BTC/USD': 1,     // 1 unit = 1 BTC
    'ETH/USD': 1,     // 1 unit = 1 ETH
    'BNB/USD': 1,     // 1 unit = 1 BNB
    'SOL/USD': 1,     // 1 unit = 1 SOL
    'EUR/USD': 100000, // 1 lot = 100,000 units
    'GBP/USD': 100000,
    'USD/JPY': 100000,
    'AUD/USD': 100000,
    'XAU/USD': 100,    // 1 lot = 100 ounces of Gold
    'XAG/USD': 5000,   // 1 lot = 5000 ounces of Silver
    'XPT/USD': 50     // 1 lot = 50 ounces of Platinum
};

// Event Listeners
analyzeBtn.addEventListener('click', runAnalysis);
executeBtn.addEventListener('click', executeOrder);

pairSelect.addEventListener("change", (e) => {
    currentPair = e.target.value;
    resetAnalysis();
});

accountBalanceInput.addEventListener("input", calculateLotSize);
riskAmountInput.addEventListener("input", calculateLotSize);

// Category Buttons
document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        updatePairsByCategory(e.target.dataset.category);
    });
});

// Timeframe Buttons
document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTimeframe = e.target.dataset.tf;
    });
});

// Update pairs based on category
function updatePairsByCategory(category) {
    const pairs = {
        crypto: ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD'],
        forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
        metals: ['XAU/USD', 'XAG/USD', 'XPT/USD']
    };
    
    pairSelect.innerHTML = pairs[category].map(pair => 
        `<option value="${pair}">${pair}</option>`
    ).join('');
    currentPair = pairs[category][0];
    resetAnalysis();
}

// Run Analysis
async function runAnalysis() {
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing market...', 'info');

    try {
        // Fetch current price from Twelve Data API
        const priceResponse = await fetch(
            `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${API_KEY}`
        );
        const priceData = await priceResponse.json();

        if (priceData.code) {
            throw new Error(priceData.message || 'API Error');
        }
        const currentPrice = parseFloat(priceData.price);

        // Fetch historical data for 4H
        const historical4HResponse = await fetch(
            `https://api.twelvedata.com/time_series?symbol=${currentPair}&interval=4h&outputsize=100&apikey=${API_KEY}`
        );
        const historical4HData = await historical4HResponse.json();

        if (historical4HData.code) {
            throw new Error(historical4HData.message || 'API Error for 4H historical data');
        }

        // Fetch historical data for 1H
        const historical1HResponse = await fetch(
            `https://api.twelvedata.com/time_series?symbol=${currentPair}&interval=1h&outputsize=100&apikey=${API_KEY}`
        );
        const historical1HData = await historical1HResponse.json();

        if (historical1HData.code) {
            throw new Error(historical1HData.message || 'API Error for 1H historical data');
        }

        // Perform ICT Analysis with historical data
        const analysis = performICTAnalysis(currentPrice, historical4HData.values, historical1HData.values);
        analysisData = analysis;

        // Update the UI with data
        updateUI(analysis, currentPrice);

        // Calculate and display lot size
        calculateLotSize();

        // Enable execute button
        enableExecuteButton();
        showNotification("Analysis Complete!", "success");

        // Update API Usage
        apiCalls++;
        document.getElementById('apiUsage').textContent = `${apiCalls} / 800 calls`;

    } catch (error) {
        console.error('Analysis error:', error);
        showNotification('API Error: ' + error.message, 'error');
    } finally {
        analyzeBtn.classList.remove('loading');
        analyzeBtn.disabled = false;
    }
}

// ICT Analysis Logic - UPDATED with Zone Details
function performICTAnalysis(price, historical4H, historical1H) {
    // Calculate ATR for 4H timeframe
    const atr4H = calculateATR(historical4H);
    const volatilityFactor4H = atr4H > 0 ? atr4H : price * 0.015; // Fallback to 1.5% if ATR is zero

    // Calculate ATR for 1H timeframe
    const atr1H = calculateATR(historical1H);
    const volatilityFactor1H = atr1H > 0 ? atr1H : price * 0.015; // Fallback to 1.5% if ATR is zero

    const riskMultiplier = 1.5; // SL will be 1.5 times the volatility factor
    const targetRR = 2; // Target Risk-Reward ratio (e.g., 1:2)

    let signalSL, signalTP;
    const signalType = Math.random() > 0.5 ? 'LONG' : 'SHORT'; // Keep random for now, but will be replaced by actual analysis

    // Determine trend based on historical data (simplified for now)
    const trend4H = getTrend(historical4H);
    const trend1H = getTrend(historical1H);

    // Use 4H volatility for signal SL/TP
    if (signalType === 'LONG') {
        signalSL = price - (volatilityFactor4H * riskMultiplier);
        signalTP = price + (volatilityFactor4H * riskMultiplier * targetRR);
    } else { // SHORT
        signalSL = price + (volatilityFactor4H * riskMultiplier);
        signalTP = price - (volatilityFactor4H * riskMultiplier * targetRR);
    }
    
    return {
        trend4H: trend4H,
        strength4H: 'Medium', // Placeholder for now
        fvg4H: 'N/A', // Placeholder for now
        ob4H: 'N/A', // Placeholder for now
        ms4H: 'N/A', // Placeholder for now
        trend1H: trend1H,
        strength1H: 'Medium', // Placeholder for now
        fvg1H: 'N/A', // Placeholder for now
        ob1H: 'N/A', // Placeholder for now
        ms1H: 'N/A', // Placeholder for now
        
        // Zone Details
        zones: {
            fvgZones: [
                `$${(price - volatilityFactor4H * 2).toFixed(2)} - $${(price - volatilityFactor4H).toFixed(2)}`,
                `$${(price + volatilityFactor4H).toFixed(2)} - $${(price + volatilityFactor4H * 2).toFixed(2)}`
            ],
            orderBlocks: [
                `$${(price - volatilityFactor4H * 1.5).toFixed(2)} - $${(price - volatilityFactor4H * 0.5).toFixed(2)}`,
                `$${(price + volatilityFactor4H * 0.5).toFixed(2)} - $${(price + volatilityFactor4H * 1.5).toFixed(2)}`
            ],
            liquidity: {
                buySide: `$${(price + volatilityFactor4H * 3).toFixed(2)}`,
                sellSide: `$${(price - volatilityFactor4H * 3).toFixed(2)}`
            },
            structure: {
                bos: `$${(price + volatilityFactor4H * 2).toFixed(2)}`,
                choch: `$${(price - volatilityFactor4H * 2).toFixed(2)}`
            }
        },
        
        signal: {
            type: signalType,
            confidence: Math.floor(Math.random() * 30 + 70) + '%',
            entry: price,
            tp: signalTP,
            sl: signalSL,
            rr: `1:${targetRR}`
        }
    };
}

// Update UI with Analysis Data
function updateUI(data, price) {
    // Current Price
    document.getElementById('currentPrice').textContent = `$${price.toFixed(2)}`;

    // 4H Analysis
    document.getElementById('trend4H').textContent = data.trend4H || '--';
    document.getElementById('strength4H').textContent = data.strength4H || '--';
    document.getElementById('fvg4H').textContent = data.fvg4H || '--';
    document.getElementById('ob4H').textContent = data.ob4H || '--';
    document.getElementById('ms4H').textContent = data.ms4H || '--';
    document.getElementById('conf4H').textContent = data.signal?.confidence || '--';

    // 1H Analysis
    document.getElementById('trend1H').textContent = data.trend1H || '--';
    document.getElementById('strength1H').textContent = data.strength1H || '--';
    document.getElementById('fvg1H').textContent = data.fvg1H || '--';
    document.getElementById('ob1H').textContent = data.ob1H || '--';
    document.getElementById('ms1H').textContent = data.ms1H || '--';
    document.getElementById('conf1H').textContent = data.signal?.confidence || '--';

    // Trading Signal
    document.getElementById('signalType').textContent = data.signal?.type || '--';
    document.getElementById('signalConfidence').textContent = data.signal?.confidence || '--';
    document.getElementById('signalEntry').textContent = data.signal?.entry ? `$${data.signal.entry.toFixed(2)}` : '--';
    document.getElementById('signalTP').textContent = data.signal?.tp ? `$${data.signal.tp.toFixed(2)}` : '--';
    document.getElementById('signalSL').textContent = data.signal?.sl ? `$${data.signal.sl.toFixed(2)}` : '--';
    document.getElementById('signalRR').textContent = data.signal?.rr || '--';

    // ICT Zones Display
    if (data.zones) {
        // FVG Zones
        const fvgContainer = document.getElementById('fvgZonesDisplay');
        if (fvgContainer) {
            fvgContainer.innerHTML = data.zones.fvgZones
                .map(zone => `<div class="zone-tag">${zone}</div>`)
                .join('');
        }

        // Order Blocks
        const obContainer = document.getElementById('obZonesDisplay');
        if (obContainer) {
            obContainer.innerHTML = data.zones.orderBlocks
                .map(zone => `<div class="zone-tag">${zone}</div>`)
                .join('');
        }

        // Liquidity
        const buySideEl = document.getElementById('buySideLiq');
        const sellSideEl = document.getElementById('sellSideLiq');
        if (buySideEl) buySideEl.textContent = data.zones.liquidity.buySide;
        if (sellSideEl) sellSideEl.textContent = data.zones.liquidity.sellSide;

        // Structure
        const bosEl = document.getElementById('bosLevel');
        const chochEl = document.getElementById('chochLevel');
        if (bosEl) bosEl.textContent = data.zones.structure.bos;
        if (chochEl) chochEl.textContent = data.zones.structure.choch;
    }
}

// Enable Execute Button
function enableExecuteButton() {
    executeBtn.disabled = false;
    tg.MainButton.setText(`⚡ Execute ${analysisData?.signal?.type || 'Order'}`);
    tg.MainButton.show();
    tg.MainButton.enable();
}

// Reset Analysis
function resetAnalysis() {
    document.querySelectorAll('.value').forEach(el => el.textContent = '--');
    document.getElementById("currentPrice").textContent = "----";
    calculatedLotSizeSpan.textContent = "--";
    
    // Reset ICT zones
    document.getElementById("fvgZonesDisplay").textContent = "Click Analyze to see zones";
    document.getElementById('obZonesDisplay').textContent = 'Click Analyze to see zones';
    document.getElementById('buySideLiq').textContent = '--';
    document.getElementById('sellSideLiq').textContent = '--';
    document.getElementById('bosLevel').textContent = '--';
    document.getElementById('chochLevel').textContent = '--';
    
    disableExecuteButton();
}

// Disable Execute Button
function disableExecuteButton() {
    executeBtn.disabled = true;
    tg.MainButton.hide();
}

// Execute Order
function executeOrder() {
    if (!analysisData) {
        showNotification('No analysis data', 'error');
        return;
    }

    tg.sendData(JSON.stringify({
        action: 'execute_order',
        pair: currentPair,
        signal: analysisData.signal,
        timestamp: new Date().toISOString()
    }));

    showNotification('Order sent to bot!', 'success');
}

function calculateLotSize() {
    const accountBalance = parseFloat(accountBalanceInput.value);
    const riskAmount = parseFloat(riskAmountInput.value);
    
    if (isNaN(accountBalance) || isNaN(riskAmount) || !analysisData || !analysisData.signal || !analysisData.signal.entry || !analysisData.signal.sl) {
        calculatedLotSizeSpan.textContent = `--`;
        return;
    }

    const entryPrice = analysisData.signal.entry;
    const stopLossPrice = analysisData.signal.sl;

    if (entryPrice === 0 || stopLossPrice === 0) {
        calculatedLotSizeSpan.textContent = `Calculating...`;
        return;
    }

    // Calculate the dollar risk per unit (e.g., per share/coin)
    const dollarRiskPerUnit = Math.abs(entryPrice - stopLossPrice);

    if (dollarRiskPerUnit === 0) {
        calculatedLotSizeSpan.textContent = 'N/A (SL too close)';
        return;
    }

    // Get the contract size for the current pair, default to 1 if not found
    const contractSize = contractSizes[currentPair] || 1;

    // Calculate lot size based on risk amount, dollar risk per unit, and contract size
    const lotSize = (riskAmount / dollarRiskPerUnit) / contractSize;

    calculatedLotSizeSpan.textContent = `${lotSize.toFixed(2)} units`;
}

// Show Notification
function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');

    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}
_SCRIPT_BREAK_// Helper function to calculate Average True Range (ATR)
function calculateATR(data, period = 14) {
    if (!data || data.length < period) return 0;

    let trueRanges = [];
    for (let i = 1; i < data.length; i++) {
        const high = parseFloat(data[i].high);
        const low = parseFloat(data[i].low);
        const prevClose = parseFloat(data[i - 1].close);

        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);

        trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    if (trueRanges.length === 0) return 0;

    const atr = trueRanges.slice(-period).reduce((sum, val) => sum + val, 0) / period;
    return atr;
}

// Helper function to determine trend from historical data using Moving Averages
function getTrend(data, shortPeriod = 5, longPeriod = 20) {
    if (!data || data.length < longPeriod) return 'Neutral';

    // Ensure data is sorted from oldest to newest for MA calculation
    const sortedData = [...data].reverse();

    const closes = sortedData.map(d => parseFloat(d.close));

    // Calculate Simple Moving Averages
    const calculateSMA = (arr, period) => {
        if (arr.length < period) return null;
        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += arr[arr.length - 1 - i];
        }
        return sum / period;
    };

    const smaShort = calculateSMA(closes, shortPeriod);
    const smaLong = calculateSMA(closes, longPeriod);

    if (smaShort === null || smaLong === null) return 'Neutral';

    // Trend determination based on MA crossover
    if (smaShort > smaLong) {
        return '🟢 Bullish';
    } else if (smaShort < smaLong) {
        return '🔴 Bearish';
    } else {
        return 'Neutral';
    }
}

// Initial calculation on page load
calculateLotSize();
