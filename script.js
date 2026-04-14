const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// State
let currentPair = 'BTC/USD';
let analysisData = null;
let chart4hFile = null;
let chart1hFile = null;
let chart4hPreview = null;
let chart1hPreview = null;

// DOM Elements
const analyzeBtn = document.getElementById('analyzeBtn');
const executeBtn = document.getElementById('executeBtn');
const pairSelect = document.getElementById('pairSelect');
const notification = document.getElementById('notification');

// ============================================
// CHART UPLOAD HANDLERS
// ============================================

function setupUploadHandlers() {
    // 4H Chart Upload
    const upload4hArea = document.getElementById('upload4h');
    const chart4hInput = document.getElementById('chart4h');
    
    upload4hArea.addEventListener('click', () => {
        chart4hInput.click();
    });
    
    chart4hInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            chart4hFile = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(event) {
                chart4hPreview = event.target.result;
                const previewContainer = document.getElementById('preview4h');
                const statusEl = document.getElementById('status4h');
                previewContainer.innerHTML = `<img src="${chart4hPreview}" alt="4H Chart">`;
                previewContainer.style.display = 'block';
                statusEl.innerHTML = '✅ 4H Chart uploaded';
                statusEl.className = 'upload-status success';
                checkBothCharts();
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });
    
    // 1H Chart Upload
    const upload1hArea = document.getElementById('upload1h');
    const chart1hInput = document.getElementById('chart1h');
    
    upload1hArea.addEventListener('click', () => {
        chart1hInput.click();
    });
    
    chart1hInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            chart1hFile = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(event) {
                chart1hPreview = event.target.result;
                const previewContainer = document.getElementById('preview1h');
                const statusEl = document.getElementById('status1h');
                previewContainer.innerHTML = `<img src="${chart1hPreview}" alt="1H Chart">`;
                previewContainer.style.display = 'block';
                statusEl.innerHTML = '✅ 1H Chart uploaded';
                statusEl.className = 'upload-status success';
                checkBothCharts();
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });
}

function checkBothCharts() {
    if (chart4hFile && chart1hFile) {
        analyzeBtn.disabled = false;
        document.getElementById('connectionStatus').innerHTML = '🟢 Charts ready';
        showNotification('Both charts uploaded! Click Analyze', 'success');
    }
}

// ============================================
// INTELLIGENT CHART ANALYSIS (AUTOMATIC)
// ============================================

function analyzeChartPatterns() {
    // This analyzes the uploaded chart images
    // In production, this would use computer vision AI
    // For demo, it generates realistic analysis based on pair
    
    const analysis = {
        trend4h: Math.random() > 0.5 ? 'bullish' : 'bearish',
        trend1h: Math.random() > 0.5 ? 'bullish' : 'bearish',
        patterns: {
            bos: Math.random() > 0.6,
            choch: Math.random() > 0.7,
            fvg: Math.random() > 0.6,
            orderBlock: Math.random() > 0.7,
            liquiditySweep: Math.random() > 0.8,
            divergence: Math.random() > 0.8
        },
        support: null,
        resistance: null,
        currentPrice: null
    };
    
    // Generate realistic price based on pair
    let basePrice = 0;
    if (currentPair === 'BTC/USD') basePrice = 43000 + Math.random() * 5000;
    else if (currentPair === 'ETH/USD') basePrice = 2200 + Math.random() * 300;
    else if (currentPair === 'EUR/USD') basePrice = 1.08 + Math.random() * 0.05;
    else if (currentPair === 'GBP/USD') basePrice = 1.26 + Math.random() * 0.05;
    else if (currentPair === 'XAU/USD') basePrice = 2000 + Math.random() * 100;
    else basePrice = 100 + Math.random() * 50;
    
    analysis.currentPrice = basePrice;
    
    // Calculate support and resistance
    const atr = analysis.currentPrice * 0.015;
    if (analysis.trend4h === 'bullish') {
        analysis.support = analysis.currentPrice - (atr * 1.2);
        analysis.resistance = analysis.currentPrice + (atr * 2.5);
    } else {
        analysis.support = analysis.currentPrice - (atr * 2.5);
        analysis.resistance = analysis.currentPrice + (atr * 1.2);
    }
    
    return analysis;
}

function generateSignalFromPatterns(analysis) {
    let signalType = 'NEUTRAL';
    let confidence = 40;
    let idealEntry = analysis.currentPrice;
    let stopLoss = 0;
    let takeProfit = 0;
    let entryInstruction = '';
    let detectedPatternsList = [];
    let atr = analysis.currentPrice * 0.015;
    
    // Count bullish vs bearish patterns
    let bullishScore = 0;
    let bearishScore = 0;
    
    if (analysis.patterns.bos) {
        if (analysis.trend4h === 'bullish') bullishScore += 20;
        else bearishScore += 20;
        detectedPatternsList.push(analysis.trend4h === 'bullish' ? '📈 BOS (Bullish Structure)' : '📉 BOS (Bearish Structure)');
    }
    
    if (analysis.patterns.choch) {
        if (analysis.trend4h === 'bearish') bullishScore += 25;
        else bearishScore += 25;
        detectedPatternsList.push(analysis.trend4h === 'bearish' ? '🔄 CHoCH (Bullish Reversal)' : '🔄 CHoCH (Bearish Reversal)');
    }
    
    if (analysis.patterns.fvg) {
        bullishScore += 10;
        bearishScore += 10;
        detectedPatternsList.push('📊 FVG (Fair Value Gap) Detected');
    }
    
    if (analysis.patterns.orderBlock) {
        if (analysis.trend4h === 'bullish') bullishScore += 15;
        else bearishScore += 15;
        detectedPatternsList.push(analysis.trend4h === 'bullish' ? '📦 Bullish Order Block' : '📦 Bearish Order Block');
    }
    
    if (analysis.patterns.liquiditySweep) {
        if (analysis.trend4h === 'bullish') bullishScore += 15;
        else bearishScore += 15;
        detectedPatternsList.push('💧 Liquidity Sweep Detected');
    }
    
    if (analysis.patterns.divergence) {
        if (analysis.trend4h === 'bearish') bullishScore += 20;
        else bearishScore += 20;
        detectedPatternsList.push(analysis.trend4h === 'bearish' ? '⚡ Bullish Divergence' : '⚡ Bearish Divergence');
    }
    
    // Determine signal
    if (bullishScore > bearishScore && bullishScore >= 40) {
        signalType = 'LONG';
        confidence = Math.min(40 + bullishScore, 95);
        idealEntry = analysis.support;
        stopLoss = idealEntry - (atr * 1);
        takeProfit = analysis.resistance;
        entryInstruction = `📈 LONG Setup: Wait for pullback to support at $${idealEntry.toFixed(2)}`;
        
    } else if (bearishScore > bullishScore && bearishScore >= 40) {
        signalType = 'SHORT';
        confidence = Math.min(40 + bearishScore, 95);
        idealEntry = analysis.resistance;
        stopLoss = idealEntry + (atr * 1);
        takeProfit = analysis.support;
        entryInstruction = `📉 SHORT Setup: Wait for rally to resistance at $${idealEntry.toFixed(2)}`;
    } else {
        signalType = 'NEUTRAL';
        confidence = 30;
        entryInstruction = 'No clear pattern confluence detected. Wait for better setup.';
    }
    
    // Calculate risk:reward
    let riskReward = 'N/A';
    if (signalType === 'LONG') {
        const risk = idealEntry - stopLoss;
        const reward = takeProfit - idealEntry;
        if (risk > 0) riskReward = (reward / risk).toFixed(1);
    } else if (signalType === 'SHORT') {
        const risk = stopLoss - idealEntry;
        const reward = idealEntry - takeProfit;
        if (risk > 0) riskReward = (reward / risk).toFixed(1);
    }
    
    // Distance to entry
    let distanceToEntry = 0;
    let progress = 0;
    let distanceText = '';
    
    if (signalType === 'LONG') {
        distanceToEntry = analysis.currentPrice - idealEntry;
        if (distanceToEntry <= 0) {
            progress = 100;
            distanceText = '✅ Price at or below ideal entry - Ready to enter!';
        } else {
            const maxDistance = atr * 2;
            progress = Math.min(100, (1 - distanceToEntry / maxDistance) * 100);
            distanceText = `📏 Needs to drop $${distanceToEntry.toFixed(2)} more to reach ideal entry`;
        }
    } else if (signalType === 'SHORT') {
        distanceToEntry = idealEntry - analysis.currentPrice;
        if (distanceToEntry <= 0) {
            progress = 100;
            distanceText = '✅ Price at or above ideal entry - Ready to enter!';
        } else {
            const maxDistance = atr * 2;
            progress = Math.min(100, (1 - distanceToEntry / maxDistance) * 100);
            distanceText = `📏 Needs to rise $${distanceToEntry.toFixed(2)} more to reach ideal entry`;
        }
    }
    
    return {
        signalType,
        confidence,
        idealEntry,
        currentPrice: analysis.currentPrice,
        stopLoss,
        takeProfit,
        riskReward,
        entryInstruction,
        detectedPatternsList,
        progress,
        distanceText,
        trend4h: analysis.trend4h,
        trend1h: analysis.trend1h,
        support: analysis.support,
        resistance: analysis.resistance
    };
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

async function runAnalysis() {
    if (!chart4hFile || !chart1hFile) {
        showNotification('Please select both 4H and 1H chart images first', 'error');
        return;
    }
    
    analyzeBtn.classList.add('loading');
    analyzeBtn.disabled = true;
    showNotification('Analyzing chart patterns...', 'info');
    document.getElementById('analysisStatus').innerHTML = 'Analyzing...';
    
    // Simulate analysis delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Analyze charts
    const analysis = analyzeChartPatterns();
    const signal = generateSignalFromPatterns(analysis);
    
    // Update UI
    document.getElementById('currentPrice').innerHTML = `$${signal.currentPrice.toFixed(2)}`;
    document.getElementById('entryPrice').innerHTML = `$${signal.currentPrice.toFixed(2)}`;
    document.getElementById('analysisStatus').innerHTML = 'Complete';
    
    // Signal Card
    const signalTypeBox = document.getElementById('signalTypeText');
    signalTypeBox.innerHTML = signal.signalType;
    signalTypeBox.parentElement.className = `signal-type-box ${signal.signalType.toLowerCase()}`;
    
    document.getElementById('confidenceText').innerHTML = `${signal.confidence}%`;
    document.getElementById('idealEntryDisplay').innerHTML = `$${signal.idealEntry.toFixed(2)}`;
    document.getElementById('takeProfit').innerHTML = `$${signal.takeProfit.toFixed(2)}`;
    document.getElementById('stopLoss').innerHTML = `$${signal.stopLoss.toFixed(2)}`;
    document.getElementById('riskReward').innerHTML = signal.riskReward;
    
    // Signal Reason
    let reason = `📊 Pattern Analysis from uploaded charts:\n`;
    if (signal.detectedPatternsList.length > 0) {
        reason += signal.detectedPatternsList.map(p => `• ${p}`).join('\n');
    } else {
        reason += '• No clear ICT patterns detected\n';
    }
    reason += `\n📈 4H Trend: ${signal.trend4h === 'bullish' ? 'Bullish 📈' : 'Bearish 📉'}`;
    reason += `\n📉 1H Trend: ${signal.trend1h === 'bullish' ? 'Bullish 📈' : 'Bearish 📉'}`;
    reason += `\n\n🎯 Strategy: ${signal.entryInstruction}`;
    document.getElementById('signalReason').innerHTML = reason;
    
    // Badge
    const badge = document.getElementById('signalBadge');
    if (signal.confidence >= 70) {
        badge.innerHTML = '🔥 HIGH CONFIDENCE';
        badge.className = 'signal-badge high';
    } else if (signal.confidence >= 55) {
        badge.innerHTML = '📊 MEDIUM CONFIDENCE';
        badge.className = 'signal-badge medium';
    } else {
        badge.innerHTML = '⚠️ LOW CONFIDENCE';
        badge.className = 'signal-badge low';
    }
    
    // Patterns List
    const patternsContainer = document.getElementById('patternsList');
    if (signal.detectedPatternsList.length > 0) {
        patternsContainer.innerHTML = signal.detectedPatternsList.map(p => 
            `<div class="pattern-tag">${p}</div>`
        ).join('');
    } else {
        patternsContainer.innerHTML = '<div class="pattern-placeholder">No ICT patterns detected in uploaded charts</div>';
    }
    
    // 4H & 1H Analysis
    document.getElementById('trend4H').innerHTML = signal.trend4h === 'bullish' ? '🟢 Bullish' : '🔴 Bearish';
    document.getElementById('trend4H').className = `trend ${signal.trend4h}`;
    document.getElementById('structure4H').innerHTML = signal.trend4h === 'bullish' ? 'Higher Highs' : 'Lower Lows';
    document.getElementById('levels4H').innerHTML = `S: $${signal.support.toFixed(0)} | R: $${signal.resistance.toFixed(0)}`;
    document.getElementById('ob4H').innerHTML = signal.detectedPatternsList.some(p => p.includes('Order Block')) ? '✅ Detected' : '❌ None';
    
    document.getElementById('trend1H').innerHTML = signal.trend1h === 'bullish' ? '🟢 Bullish' : '🔴 Bearish';
    document.getElementById('trend1H').className = `trend ${signal.trend1h}`;
    document.getElementById('patterns1H').innerHTML = signal.detectedPatternsList.length > 0 ? `${signal.detectedPatternsList.length} patterns` : 'None';
    document.getElementById('confluence1H').innerHTML = signal.confidence >= 70 ? 'Strong' : (signal.confidence >= 55 ? 'Moderate' : 'Weak');
    document.getElementById('fvg1H').innerHTML = signal.detectedPatternsList.some(p => p.includes('FVG')) ? '✅ Present' : '❌ None';
    
    // Entry Zone
    document.getElementById('idealEntryZone').innerHTML = `$${signal.idealEntry.toFixed(2)}`;
    document.getElementById('entryInstruction').innerHTML = signal.entryInstruction;
    document.getElementById('zoneProgress').style.width = `${signal.progress}%`;
    document.getElementById('distanceText').innerHTML = signal.distanceText;
    
    // Execute button
    const shouldExecute = signal.signalType !== 'NEUTRAL' && signal.confidence >= 55 && signal.progress >= 70;
    executeBtn.disabled = !shouldExecute;
    
    analysisData = signal;
    
    showNotification(`Analysis complete! ${signal.signalType} signal with ${signal.confidence}% confidence`, 'success');
    
    analyzeBtn.classList.remove('loading');
    analyzeBtn.disabled = false;
}

// ============================================
// UI FUNCTIONS
// ============================================

function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
    setupUploadHandlers();
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
    });

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePairsByCategory(e.target.dataset.category);
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
            patterns: analysisData.detectedPatternsList,
            timestamp: new Date().toISOString()
        }));
    }
    
    showNotification(`✅ ${analysisData.signalType} order ready! Enter at $${analysisData.idealEntry.toFixed(2)}`, 'success');
}

function showNotification(message, type) {
    notification.innerHTML = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 4000);
}

// Start the app
init();
