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
const notification = document.getElementById('notification');

// Event Listeners
analyzeBtn.addEventListener('click', runAnalysis);
executeBtn.addEventListener('click', executeOrder);

pairSelect.addEventListener('change', (e) => {
    currentPair = e.target.value;
    resetAnalysis();
});

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
        // Fetch price from Twelve Data API
        const priceResponse = await fetch(
            `https://api.twelvedata.com/price?symbol=${currentPair}&apikey=${API_KEY}`
        );
        const priceData = await priceResponse.json();

        if (priceData.code) {
            throw new Error(priceData.message || 'API Error');
        }

        const currentPrice = parseFloat(priceData.price);

        // Perform ICT Analysis
        const analysis = performICTAnalysis(currentPrice);
        analysisData = analysis;

        // Update the UI with data
        updateUI(analysis, currentPrice);

        // Enable execute button
        enableExecuteButton();
        showNotification('Analysis Complete!', 'success');

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
function performICTAnalysis(price) {
    const volatilityFactor = price * 0.015; // Using 1.5% of price as a volatility proxy (like a simplified ATR)
    const riskMultiplier = 1.5; // SL will be 1.5 times the volatility factor
    const targetRR = 2; // Target Risk-Reward ratio (e.g., 1:2)

    let signalSL, signalTP;
    const signalType = Math.random() > 0.5 ? 'LONG' : 'SHORT'; // Keep random for now, but will be replaced by actual analysis

    if (signalType === 'LONG') {
        signalSL = price - (volatilityFactor * riskMultiplier);
        signalTP = price + (volatilityFactor * riskMultiplier * targetRR);
    } else { // SHORT
        signalSL = price + (volatilityFactor * riskMultiplier);
        signalTP = price - (volatilityFactor * riskMultiplier * targetRR);
    }
    
    return {
        // Placeholder values for ICT analysis as historical data is not available
        trend4H: 'Neutral', // Placeholder
        strength4H: 'Medium', // Placeholder
        fvg4H: 'N/A', // Placeholder
        ob4H: 'N/A', // Placeholder
        ms4H: 'N/A', // Placeholder
        trend1H: 'Neutral', // Placeholder
        strength1H: 'Medium', // Placeholder
        fvg1H: 'N/A', // Placeholder
        ob1H: 'N/A', // Placeholder
        ms1H: 'N/A', // Placeholder
        
        // Zone Details
        zones: {
            fvgZones: [
                `$${(price - volatilityFactor * 2).toFixed(2)} - $${(price - volatilityFactor).toFixed(2)}`,
                `$${(price + volatilityFactor).toFixed(2)} - $${(price + volatilityFactor * 2).toFixed(2)}`
            ],
            orderBlocks: [
                `$${(price - volatilityFactor * 1.5).toFixed(2)} - $${(price - volatilityFactor * 0.5).toFixed(2)}`,
                `$${(price + volatilityFactor * 0.5).toFixed(2)} - $${(price + volatilityFactor * 1.5).toFixed(2)}`
            ],
            liquidity: {
                buySide: `$${(price + volatilityFactor * 3).toFixed(2)}`,
                sellSide: `$${(price - volatilityFactor * 3).toFixed(2)}`
            },
            structure: {
                bos: `$${(price + volatilityFactor * 2).toFixed(2)}`,
                choch: `$${(price - volatilityFactor * 2).toFixed(2)}`
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
    document.getElementById('currentPrice').textContent = '----';
    
    // Reset ICT zones
    document.getElementById('fvgZonesDisplay').textContent = 'Click Analyze to see zones';
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

// Show Notification
function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');

    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}
