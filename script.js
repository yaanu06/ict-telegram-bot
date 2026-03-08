// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// State
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ⚠️ REPLACE WITH YOUR TWELVE DATA API KEY
const API_KEY = '3076652d6e1c45a3b4e0a6acfe0408aa';

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
        document.getElementById('currentPrice').textContent = `$${currentPrice.toFixed(2)}`;

        // Simulate ICT Analysis (Replace with your actual logic)
        const analysis = performICTAnalysis(currentPrice);
        analysisData = analysis;

        // Update UI
        updateUI(analysis, currentPrice);
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

// ICT Analysis Logic (Customize this)
function performICTAnalysis(price) {
    return {
        trend4H: Math.random() > 0.5 ? '🟢 Bullish' : '🔴 Bearish',
        strength4H: Math.random() > 0.5 ? 'Strong' : 'Medium',
        fvg4H: Math.random() > 0.5 ? '✅ Detected' : '❌ None',
        ob4H: Math.random() > 0.5 ? '✅ Present' : '❌ None',
        ms4H: Math.random() > 0.5 ? 'BOS' : 'CHoCH',
        trend1H: Math.random() > 0.5 ? '🟢 Bullish' : '🔴 Bearish',
        strength1H: Math.random() > 0.5 ? 'Strong' : 'Medium',
        fvg1H: Math.random() > 0.5 ? '✅ Detected' : '❌ None',
        ob1H: Math.random() > 0.5 ? '✅ Present' : '❌ None',
        ms1H: Math.random() > 0.5 ? 'BOS' : 'CHoCH',
        signal: {
            type: Math.random() > 0.5 ? 'LONG' : 'SHORT',
            confidence: Math.floor(Math.random() * 30 + 70) + '%',
            entry: price,
            tp: price * 1.02,
            sl: price * 0.98,
            rr: '1:2'
        }
    };
}

// Update UI with Analysis Data
function updateUI(data, price) {
    // 4H Analysis
    document.getElementById('trend4H').textContent = data.trend4H;
    document.getElementById('strength4H').textContent = data.strength4H;
    document.getElementById('fvg4H').textContent = data.fvg4H;
    document.getElementById('ob4H').textContent = data.ob4H;
    document.getElementById('ms4H').textContent = data.ms4H;

    // 1H Analysis
    document.getElementById('trend1H').textContent = data.trend1H;
    document.getElementById('strength1H').textContent = data.strength1H;
    document.getElementById('fvg1H').textContent = data.fvg1H;
    document.getElementById('ob1H').textContent = data.ob1H;
    document.getElementById('ms1H').textContent = data.ms1H;

    // Trading Signal
    document.getElementById('signalType').textContent = data.signal.type;
    document.getElementById('signalConfidence').textContent = data.signal.confidence;
    document.getElementById('signalEntry').textContent = `$${data.signal.entry.toFixed(2)}`;
    document.getElementById('signalTP').textContent = `$${data.signal.tp.toFixed(2)}`;
    document.getElementById('signalSL').textContent = `$${data.signal.sl.toFixed(2)}`;
    document.getElementById('signalRR').textContent = data.signal.rr;
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