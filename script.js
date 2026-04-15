// Initialize Telegram WebApp
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Apply Telegram Theme
document.documentElement.style.setProperty('--bg-dark', tg.themeParams.bg_color || '#0f1115');
document.documentElement.style.setProperty('--text-primary', tg.themeParams.text_color || '#ffffff');

// State
let currentPair = 'EURUSD';
let currentTF = '4H';
let analysisData = null;

// DOM Elements
const pairSelect = document.getElementById('pairSelect');
const refreshBtn = document.getElementById('refreshBtn');
const tfBtns = document.querySelectorAll('.tf-btn');

// Initialize
function init() {
    setupEventListeners();
    runAnalysis();
    setInterval(runAnalysis, 60000); // Auto-refresh every minute
}

function setupEventListeners() {
    pairSelect.addEventListener('change', (e) => {
        currentPair = e.target.value;
        runAnalysis();
    });

    refreshBtn.addEventListener('click', () => {
        runAnalysis();
        showNotification('Data refreshed', '🔄');
    });

    tfBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTF = btn.dataset.tf;
            runAnalysis();
        });
    });

    // Handle MainButton click from Telegram
    tg.MainButton.onClick(() => {
        if (analysisData && analysisData.signal !== 'WAIT') {
            sendTradeToBot(analysisData);
        }
    });
}

// Mock Data Generator (Replace with real API calls in production)
function generateMockData(pair) {
    const basePrice = pair === 'BTCUSD' ? 42000 : pair === 'XAUUSD' ? 2030 : 1.0850;
    const volatility = pair === 'BTCUSD' ? 500 : pair === 'XAUUSD' ? 15 : 0.0050;
    
    const price = basePrice + (Math.random() - 0.5) * volatility;
    const change = (Math.random() * 2 - 1).toFixed(2);
    
    return {
        price: price.toFixed(pair === 'EURUSD' || pair === 'GBPUSD' ? 5 : 2),
        change: change,
        high: (price + volatility * 0.8).toFixed(pair === 'EURUSD' ? 5 : 2),
        low: (price - volatility * 0.8).toFixed(pair === 'EURUSD' ? 5 : 2),
        rsi: Math.floor(Math.random() * 100),
        ema: (price * (1 + (Math.random() * 0.02 - 0.01))).toFixed(pair === 'EURUSD' ? 5 : 2),
        vwap: (price * (1 + (Math.random() * 0.01 - 0.005))).toFixed(pair === 'EURUSD' ? 5 : 2),
        poc: (price * (1 + (Math.random() * 0.015 - 0.007))).toFixed(pair === 'EURUSD' ? 5 : 2),
        buyVol: Math.floor(Math.random() * 100),
        fvg: Math.random() > 0.5,
        ob: Math.random() > 0.7 ? 'Bullish' : (Math.random() > 0.7 ? 'Bearish' : 'None'),
        liq: Math.random() > 0.6
    };
}

// Main Analysis Function
async function runAnalysis() {
    showLoading(true);
    
    // Simulate API delay
    await new Promise(r => setTimeout(r, 800));
    
    const data = generateMockData(currentPair);
    analysisData = determineSignal(data);
    
    updateUI(data, analysisData);
    showLoading(false);
}

function determineSignal(data) {
    let score = 0;
    let reasons = [];

    // RSI Logic
    if (data.rsi < 30) { score += 2; reasons.push('Oversold RSI'); }
    else if (data.rsi > 70) { score -= 2; reasons.push('Overbought RSI'); }

    // Price vs EMA
    const price = parseFloat(data.price);
    const ema = parseFloat(data.ema);
    if (price < ema * 0.995) { score += 1; reasons.push('Below EMA'); }
    else if (price > ema * 1.005) { score -= 1; reasons.push('Above EMA'); }

    // ICT Confluence
    if (data.fvg) score += 1;
    if (data.ob === 'Bullish') score += 1;
    if (data.liq) score += 1;

    // Determine Signal
    let signal = 'WAIT';
    if (score >= 3) signal = 'BUY';
    else if (score <= -3) signal = 'SELL';

    // Calculate Confidence
    const confidence = Math.min(Math.abs(score) * 20 + 40, 95);

    // Calculate Levels
    const atr = price * 0.005;
    let entry, sl, tp1, tp2;

    if (signal === 'BUY') {
        entry = (price * 0.998).toFixed(5);
        sl = (price - atr).toFixed(5);
        tp1 = (price + atr).toFixed(5);
        tp2 = (price + atr * 2).toFixed(5);
    } else if (signal === 'SELL') {
        entry = (price * 1.002).toFixed(5);
        sl = (price + atr).toFixed(5);
        tp1 = (price - atr).toFixed(5);
        tp2 = (price - atr * 2).toFixed(5);
    }

    return {
        signal,
        confidence,
        reasons,
        entry: entry || '--',
        sl: sl || '--',
        tp1: tp1 || '--',
        tp2: tp2 || '--',
        rr: signal !== 'WAIT' ? '1:2' : '--'
    };
}

// Update UI
function updateUI(data, signalData) {
    // Market Data
    document.getElementById('currentPrice').textContent = data.price;
    const changeEl = document.getElementById('priceChange');
    changeEl.textContent = `${data.change > 0 ? '+' : ''}${data.change}%`;
    changeEl.className = `price-change ${data.change >= 0 ? 'positive' : 'negative'}`;
    document.getElementById('high24').textContent = data.high;
    document.getElementById('low24').textContent = data.low;

    // Signal
    const badge = document.getElementById('signalBadge');
    const icon = document.getElementById('signalIcon');
    const text = document.getElementById('signalText');
    
    badge.className = `badge ${signalData.signal.toLowerCase()}`;
    badge.textContent = signalData.signal;
    
    icon.textContent = signalData.signal === 'BUY' ? '🟢' : signalData.signal === 'SELL' ? '🔴' : '⏳';
    text.textContent = signalData.signal === 'WAIT' ? 'Waiting for Setup' : `${signalData.signal} Signal`;
    text.style.color = signalData.signal === 'BUY' ? 'var(--accent-green)' : signalData.signal === 'SELL' ? 'var(--accent-red)' : 'var(--text-secondary)';

    // Confidence
    document.getElementById('confidenceBar').style.width = `${signalData.confidence}%`;
    document.getElementById('confidenceValue').textContent = `${signalData.confidence}%`;

    // Entry Zone
    document.getElementById('fvgStart').textContent = data.fvg ? (parseFloat(data.price) * 0.999).toFixed(5) : '--';
    document.getElementById('fvgEnd').textContent = data.fvg ? (parseFloat(data.price) * 1.001).toFixed(5) : '--';
    document.getElementById('optimalEntry').textContent = signalData.entry;
    
    // Distance Tracker (Mock)
    document.getElementById('distanceBar').style.width = `${Math.random() * 100}%`;

    // Trade Setup
    document.getElementById('setupEntry').textContent = signalData.entry;
    document.getElementById('setupSL').textContent = signalData.sl;
    document.getElementById('setupTP1').textContent = signalData.tp1;
    document.getElementById('setupTP2').textContent = signalData.tp2;
    document.getElementById('setupRR').textContent = signalData.rr;

    // Volume & Flow
    document.getElementById('pocValue').textContent = data.poc;
    document.getElementById('vwapValue').textContent = data.vwap;
    document.getElementById('buyVol').textContent = `${data.buyVol}%`;
    document.getElementById('sellVol').textContent = `${100 - data.buyVol}%`;
    document.getElementById('buyPressure').style.height = `${data.buyVol}%`;
    document.getElementById('sellPressure').style.height = `${100 - data.buyVol}%`;

    // MTF
    const trends = ['Bullish', 'Bearish', 'Neutral'];
    const t4 = trends[Math.floor(Math.random()*3)];
    const t1 = trends[Math.floor(Math.random()*3)];
    const td = trends[Math.floor(Math.random()*3)];
    
    updateMTFCard('tf4h', t4, data.rsi);
    updateMTFCard('tf1h', t1, Math.floor(Math.random()*100));
    updateMTFCard('tf1d', td, Math.floor(Math.random()*100));
    
    const alignEl = document.getElementById('tfAlign');
    if (t4 === t1 && t1 === td) {
        alignEl.textContent = '✅ Aligned';
        alignEl.className = 'mtf-value bullish';
    } else {
        alignEl.textContent = '⚠️ Mixed';
        alignEl.className = 'mtf-value neutral';
    }

    // ICT
    document.getElementById('ictFvg').textContent = data.fvg ? 'Yes' : 'No';
    document.getElementById('ictFvg').className = `ict-status ${data.fvg ? 'yes' : ''}`;
    document.getElementById('ictOb').textContent = data.ob;
    document.getElementById('ictOb').className = `ict-status ${data.ob !== 'None' ? 'yes' : ''}`;
    document.getElementById('ictLiq').textContent = data.liq ? 'Yes' : 'No';
    document.getElementById('ictLiq').className = `ict-status ${data.liq ? 'yes' : ''}`;

    // Fib
    const p = parseFloat(data.price);
    document.getElementById('fib618').textContent = (p * 1.00618).toFixed(5);
    document.getElementById('fib500').textContent = (p * 1.005).toFixed(5);
    document.getElementById('fib382').textContent = (p * 1.00382).toFixed(5);

    // Telegram Main Button
    if (signalData.signal !== 'WAIT') {
        tg.MainButton.setText(`EXECUTE ${signalData.signal} ORDER`);
        tg.MainButton.show();
        tg.MainButton.setParams({ color: signalData.signal === 'BUY' ? '#2ea043' : '#da3633' });
    } else {
        tg.MainButton.hide();
    }
}

function updateMTFCard(id, trend, rsi) {
    const el = document.getElementById(id);
    const sub = document.getElementById(`${id}_rsi`);
    el.textContent = trend;
    el.className = `mtf-value ${trend.toLowerCase()}`;
    sub.textContent = `RSI: ${rsi}`;
}

// Utilities
function showLoading(isLoading) {
    const btn = document.getElementById('refreshBtn');
    if (isLoading) {
        btn.querySelector('.refresh-icon').style.animation = 'spin 1s linear infinite';
    } else {
        btn.querySelector('.refresh-icon').style.animation = '';
    }
}

function showNotification(msg, icon = 'ℹ️') {
    const toast = document.getElementById('notification');
    document.getElementById('toastMessage').textContent = msg;
    document.getElementById('toastIcon').textContent = icon;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function sendTradeToBot(data) {
    const message = `
🚀 *New Signal Detected*
Pair: ${currentPair}
Signal: *${data.signal}*
Entry: ${data.entry}
SL: ${data.sl}
TP1: ${data.tp1}
Confidence: ${data.confidence}%
    `.trim();
    
    tg.sendData(JSON.stringify({ action: 'trade', data: message }));
    showNotification('Signal sent to bot!', '✅');
}

// Start
init();
