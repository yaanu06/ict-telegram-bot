// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) {
    tg.expand();
    tg.ready();
}

// ============================================
// SECURE API KEY STORAGE
// ============================================
let TWELVE_DATA_KEY = '';
let DEEPSEEK_API_KEY = '';

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const TWELVE_DATA_SYMBOLS = {
    'BTC/USD': 'BTC/USD', 'ETH/USD': 'ETH/USD', 'BNB/USD': 'BNB/USD',
    'SOL/USD': 'SOL/USD', 'XRP/USD': 'XRP/USD', 'EUR/USD': 'EUR/USD',
    'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY', 'AUD/USD': 'AUD/USD',
    'USD/CAD': 'USD/CAD', 'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD',
    'XPT/USD': 'XPT/USD', 'XPD/USD': 'XPD/USD'
};

const TIMEFRAME_MAP = {
    '15M': '15min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week'
};

// ============================================
// LOAD/SAVE API KEYS
// ============================================
async function loadAPIKeys() {
    const saved = localStorage.getItem('ict_bot_keys');
    if (saved) {
        try {
            const keys = JSON.parse(saved);
            TWELVE_DATA_KEY = keys.twelveData || '';
            DEEPSEEK_API_KEY = keys.deepseek || '';
            console.log('✅ Keys loaded');
            return true;
        } catch(e) {}
    }
    return false;
}

async function saveAPIKeys(twelveKey, deepseekKey) {
    const keys = JSON.stringify({ twelveData: twelveKey, deepseek: deepseekKey });
    localStorage.setItem('ict_bot_keys', keys);
    TWELVE_DATA_KEY = twelveKey;
    DEEPSEEK_API_KEY = deepseekKey;
    showNotification('✅ API keys saved!', 'success');
    return true;
}

function showSetupModal() {
    const existing = document.getElementById('setupOverlay');
    if (existing) existing.remove();
    
    const setupHTML = `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API Key Setup</h3>
                <p class="setup-desc">Enter your API keys once.</p>
                <label>Twelve Data API Key:</label>
                <input type="password" id="twelveInput" placeholder="3076..." class="setup-input">
                <label>DeepSeek API Key (Optional):</label>
                <input type="password" id="deepseekInput" placeholder="sk-..." class="setup-input">
                <p class="setup-note">⚠️ Keys stored locally on your device.</p>
                <div class="setup-buttons">
                    <button id="saveKeysBtn" class="setup-btn primary">Save Keys</button>
                    <button id="skipSetupBtn" class="setup-btn secondary">Skip</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', setupHTML);
    
    document.getElementById('saveKeysBtn').addEventListener('click', async () => {
        const twelveKey = document.getElementById('twelveInput').value.trim();
        const deepseekKey = document.getElementById('deepseekInput').value.trim();
        if (!twelveKey) { showNotification('Twelve Data key required', 'warning'); return; }
        await saveAPIKeys(twelveKey, deepseekKey);
        document.getElementById('setupOverlay').remove();
    });
    
    document.getElementById('skipSetupBtn').addEventListener('click', () => {
        document.getElementById('setupOverlay').remove();
    });
}

// ============================================
// STATE
// ============================================
let currentPair = 'BTC/USD';
let currentTimeframe = '4H';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let priceChart = null;
let chartData = [];
let allTimeframeData = {};
let pendingLimitOrder = null;
let priceCheckInterval = null;
let orderFlowData = null;

document.addEventListener('DOMContentLoaded', async function() {
    const keysLoaded = await loadAPIKeys();
    if (!keysLoaded || !TWELVE_DATA_KEY) setTimeout(() => showSetupModal(), 300);
    init();
});

function init() {
    updateLiveTime();
    setInterval(updateLiveTime, 1000);
    setupEventListeners();
    initChart();
    setupPositionCalculator();
    loadPendingOrder();
}

function updateLiveTime() {
    const now = new Date();
    document.getElementById('liveTime').innerHTML = 
        `${now.toLocaleDateString('en-US', {month:'short',day:'numeric'})} ${now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'})} UTC`;
}

function initChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: currentPair, data: [], borderColor: '#3390ec', borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } }, y: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } } } }
    });
}

function setupEventListeners() {
    document.getElementById('analyzeBtn')?.addEventListener('click', runAnalysis);
    document.getElementById('executeBtn')?.addEventListener('click', handleExecuteOrder);
    document.getElementById('cancelLimitBtn')?.addEventListener('click', cancelLimitOrder);
    document.getElementById('pairSelect')?.addEventListener('change', e => currentPair = e.target.value);
    document.querySelectorAll('.category-btn').forEach(btn => btn.addEventListener('click', function() {
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        updatePairsByCategory(this.dataset.category);
    }));
    document.querySelectorAll('.tf-btn').forEach(btn => btn.addEventListener('click', function() {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentTimeframe = this.dataset.tf;
        if (chartData.length) updateChart(chartData);
    }));
}

function setupPositionCalculator() {
    ['accountSize', 'riskPercent'].forEach(id => document.getElementById(id)?.addEventListener('input', calculatePositionSize));
}

function updatePairsByCategory(category) {
    const pairs = { crypto: ['BTC/USD','ETH/USD','BNB/USD','SOL/USD','XRP/USD'], forex: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD'], metals: ['XAU/USD','XAG/USD','XPT/USD','XPD/USD'] };
    const select = document.getElementById('pairSelect');
    if (select) { select.innerHTML = pairs[category].map(p => `<option value="${p}">${getPairDisplayName(p)}</option>`).join(''); currentPair = pairs[category][0]; }
}

function getPairDisplayName(pair) {
    const icons = { 'BTC/USD':'₿','ETH/USD':'⟠','EUR/USD':'€','GBP/USD':'£','XAU/USD':'👑','XAG/USD':'🥈','USD/JPY':'💴' };
    return `${icons[pair]||'📊'} ${pair}`;
}

function isForexPair(p) { return ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD'].includes(p); }
function isJPYPair(p) { return p.includes('JPY'); }
function getPricePrecision(p) { return isJPYPair(p) ? 3 : (isForexPair(p) ? 5 : 2); }

// ============================================
// API FUNCTIONS
// ============================================
async function getPrice() {
    if (!TWELVE_DATA_KEY) return null;
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.price) { apiCalls++; document.getElementById('apiUsage').innerHTML = apiCalls; document.getElementById('apiSource').innerHTML = '📡 Twelve Data'; return parseFloat(data.price); }
    } catch(e) {}
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
    if (!TWELVE_DATA_KEY) return null;
    const symbol = TWELVE_DATA_SYMBOLS[currentPair];
    const interval = TIMEFRAME_MAP[timeframe];
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.values) {
            apiCalls++;
            return data.values.map(c => ({ time: c.datetime, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 1000000 })).reverse();
        }
    } catch(e) {}
    return null;
}

// ============================================
// TECHNICAL ANALYSIS
// ============================================
function calculateEMA(p, n) { const m = 2/(n+1); let e = [p[0]]; for(let i=1;i<p.length;i++) e.push((p[i]-e[i-1])*m+e[i-1]); return e; }
function calculateRSI(p, n=14) { let g=0,l=0; for(let i=p.length-n;i<p.length;i++){ let c=p[i]-p[i-1]; if(c>=0)g+=c; else l-=c; } let ag=g/n, al=l/n; return al===0?100:100-(100/(1+ag/al)); }
function calculateATR(d, n=14) { let t=[]; for(let i=1;i<d.length;i++) t.push(Math.max(d[i].high-d[i].low, Math.abs(d[i].high-d[i-1].close), Math.abs(d[i].low-d[i-1].close))); return t.slice(-n).reduce((a,b)=>a+b,0)/n; }
function detectFairValueGaps(d) { let f=[]; for(let i=1;i<d.length-1;i++){ if(d[i-1].high<d[i+1].low&&d[i+1].low-d[i-1].high>d[i+1].close*0.001) f.push({type:'bullish'}); if(d[i-1].low>d[i+1].high&&d[i-1].low-d[i+1].high>d[i+1].close*0.001) f.push({type:'bearish'}); } return f; }
function detectOrderBlocks(d) { let o=[]; for(let i=2;i<d.length-1;i++){ if(d[i].close<d[i].open&&d[i+1].close>d[i+1].open&&d[i+1].close>d[i].high) o.push({type:'bullish'}); if(d[i].close>d[i].open&&d[i+1].close<d[i+1].open&&d[i+1].close<d[i].low) o.push({type:'bearish'}); } return o; }
function detectLiquidityLevels(d) { let h=d.map(c=>c.high), l=d.map(c=>c.low), L=[]; for(let i=2;i<d.length-2;i++){ if(h[i]>h[i-1]&&h[i]>h[i-2]&&h[i]>h[i+1]&&h[i]>h[i+2]) L.push({type:'resistance',price:h[i]}); if(l[i]<l[i-1]&&l[i]<l[i-2]&&l[i]<l[i+1]&&l[i]<l[i+2]) L.push({type:'support',price:l[i]}); } return L; }
function analyzeMarketStructure(d) { let h=d.map(c=>c.high), l=d.map(c=>c.low); let rh=h.slice(-20), rl=l.slice(-20); let hh=rh[rh.length-1]>rh[0], hl=rl[rl.length-1]>rl[0], lh=rh[rh.length-1]<rh[0], ll=rl[rl.length-1]<rl[0]; if(hh&&hl) return 'Bullish'; if(lh&&ll) return 'Bearish'; return 'Ranging'; }

function calculateVolumeProfile(d) {
    if(!d?.length) return null;
    let maxP=Math.max(...d.map(c=>c.high)), minP=Math.min(...d.map(c=>c.low)), r=maxP-minP, ls=r/12;
    let levels=[]; for(let i=0;i<12;i++){ let lo=minP+i*ls; levels.push({low:lo,high:lo+ls,volume:0,price:(lo+lo+ls)/2}); }
    d.forEach(c=>{ levels.forEach(l=>{ if(c.high>=l.low&&c.low<=l.high){ let o=Math.min(c.high,l.high)-Math.max(c.low,l.low); l.volume+=c.volume*(o/(c.high-c.low)); } }); });
    let maxV=0, poc=null; levels.forEach(l=>{ if(l.volume>maxV){ maxV=l.volume; poc=l; } });
    let totalV=levels.reduce((s,l)=>s+l.volume,0), target=totalV*.7, acc=0, sorted=[...levels].sort((a,b)=>b.volume-a.volume), va=[];
    for(let l of sorted){ if(acc<target){ va.push(l); acc+=l.volume; } }
    let vaH=va.length?Math.max(...va.map(l=>l.high)):maxP, vaL=va.length?Math.min(...va.map(l=>l.low)):minP;
    return {poc, valueAreaHigh:vaH, valueAreaLow:vaL, totalVolume:totalV};
}

function calculateOrderFlow(d) {
    if(!d?.length) return null;
    let buy=0, sell=0;
    d.forEach(c=>{ let bull=c.close>c.open; if(bull){ buy+=c.volume*.7; sell+=c.volume*.3; } else { buy+=c.volume*.3; sell+=c.volume*.7; } });
    let pv=0, vol=0; d.forEach(c=>{ let tp=(c.high+c.low+c.close)/3; pv+=tp*c.volume; vol+=c.volume; });
    return { buyingPressure:buy, sellingPressure:sell, netDelta:buy-sell, vwap:pv/vol };
}

// ============================================
// MULTI-TIMEFRAME
// ============================================
async function analyzeTimeframe(tf) {
    let d = await getHistoricalData(tf); if(!d||d.length<30) return null;
    let c = d.map(x=>x.close), rsi = calculateRSI(c);
    let trend = c[c.length-1] > c[c.length-20] ? 'bullish' : (c[c.length-1] < c[c.length-20] ? 'bearish' : 'neutral');
    return {data:d, trend, rsi, volume: d.slice(-20).reduce((s,x)=>s+x.volume,0)};
}

async function multiTimeframeAnalysis() {
    let tfs = ['15M','1H','4H','1D'], res={}, bull=0, bear=0;
    for(let tf of tfs) {
        res[tf] = await analyzeTimeframe(tf);
        if(res[tf]) {
            if(res[tf].trend==='bullish') bull++; else if(res[tf].trend==='bearish') bear++;
            let el=document.getElementById(`trend${tf}`); if(el){ el.innerHTML = res[tf].trend==='bullish'?'🟢 Bullish':(res[tf].trend==='bearish'?'🔴 Bearish':'⚪ Neutral'); el.className=`mtf-trend ${res[tf].trend}`; }
            let r=document.getElementById(`rsi${tf}`); if(r) r.innerHTML = res[tf].rsi.toFixed(1);
            let v=document.getElementById(`vol${tf}`); if(v) v.innerHTML = (res[tf].volume/1e6).toFixed(1)+'M';
        }
    }
    let total=bull+bear, score=total?Math.max(bull,bear)/total*100:0, dir=bull>bear?'Bullish':(bear>bull?'Bearish':'Neutral');
    let scoreEl=document.getElementById('confluenceScore'); if(scoreEl) scoreEl.innerHTML = `${dir} (${score.toFixed(0)}% confluence)`;
    return {res, confluenceScore:score, direction:dir};
}

// ============================================
// DEEPSEEK AI (FIXED - Single consistent signal)
// ============================================
async function getAIAnalysis(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotification('🤖 DeepSeek AI analyzing...', 'info');
    
    const prompt = `You are an expert ICT (Inner Circle Trader) and Smart Money trader. Analyze this market data and provide ONE clear trading signal with a LIMIT ORDER entry (price to wait for).

Market: ${currentPair} | Timeframe: ${currentTimeframe}
Current Price: ${marketData.currentPrice}
RSI: ${marketData.rsi} | ATR: ${marketData.atr}
Trend (MTF): ${marketData.trend}
Market Structure: ${marketData.structure}
FVG Count: ${marketData.fvgCount} | Order Blocks: ${marketData.obCount}
Order Flow - Net Delta: ${marketData.netDelta} (${marketData.netDelta > 0 ? 'Buyers aggressive' : 'Sellers aggressive'})
VWAP: ${marketData.vwap}
POC: ${marketData.poc} | Value Area: ${marketData.valueHigh} - ${marketData.valueLow}

Fibonacci Levels: 0%:${marketData.fib0}, 38.2%:${marketData.fib382}, 50%:${marketData.fib500}, 61.8%:${marketData.fib618}, 78.6%:${marketData.fib786}, 100%:${marketData.fib100}

IMPORTANT: Provide a limit order entry (price where we wait for the market to come to us, NOT market order). Be decisive - give ONE signal.

Return ONLY valid JSON:
{
    "signal": "LONG" or "SHORT" or "NEUTRAL",
    "confidence": 0-100,
    "idealEntry": number (limit price to wait for),
    "stopLoss": number,
    "takeProfit1": number,
    "takeProfit2": number,
    "takeProfit3": number,
    "reasoning": "Brief ICT analysis explaining why this entry level"
}`;

    try {
        const res = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: 'You are an expert ICT trader. Return ONLY valid JSON.' }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 800 })
        });
        const data = await res.json();
        if (data.choices?.[0]) {
            const match = data.choices[0].message.content.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        }
    } catch(e) { console.error('AI error:', e); }
    return null;
}

// ============================================
// MAIN ANALYSIS
// ============================================
async function runAnalysis() {
    const btn = document.getElementById('analyzeBtn');
    btn.classList.add('loading'); btn.disabled = true;
    
    if (!TWELVE_DATA_KEY) { showSetupModal(); btn.classList.remove('loading'); btn.disabled = false; return; }
    
    showNotification('🔍 Analyzing market...', 'info');
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        const mtf = await multiTimeframeAnalysis();
        const hist = await getHistoricalData(); if (!hist?.length) throw new Error('No history');
        chartData = hist; allTimeframeData[currentTimeframe] = hist;
        
        const closes = hist.map(c=>c.close), highs = hist.map(c=>c.high), lows = hist.map(c=>c.low);
        const ema20 = calculateEMA(closes,20), ema50 = calculateEMA(closes,50);
        const rsi = calculateRSI(closes), atr = calculateATR(hist);
        const fvgs = detectFairValueGaps(hist), obs = detectOrderBlocks(hist), liq = detectLiquidityLevels(hist);
        const structure = analyzeMarketStructure(hist);
        const vp = calculateVolumeProfile(hist);
        const of = calculateOrderFlow(hist);
        orderFlowData = of;
        
        let trend = 'neutral';
        if (ema20[ema20.length-1] > ema50[ema50.length-1]) trend = 'bullish';
        else if (ema20[ema20.length-1] < ema50[ema50.length-1]) trend = 'bearish';
        if (mtf.confluenceScore > 65) trend = mtf.direction.toLowerCase();
        
        const recentHigh = Math.max(...highs.slice(-20)), recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;
        const fibs = { fib0:recentLow, fib236:recentLow+range*.236, fib382:recentLow+range*.382, fib500:recentLow+range*.5, fib618:recentLow+range*.618, fib786:recentLow+range*.786, fib100:recentHigh };
        
        const marketData = {
            currentPrice: price.toFixed(getPricePrecision(currentPair)),
            rsi: rsi.toFixed(1), atr: atr.toFixed(getPricePrecision(currentPair)),
            trend, structure, fvgCount: fvgs.length, obCount: obs.length,
            netDelta: (of.netDelta/1e6).toFixed(1)+'M', vwap: of.vwap.toFixed(getPricePrecision(currentPair)),
            poc: vp?.poc?.price.toFixed(getPricePrecision(currentPair))||'N/A',
            valueHigh: vp?.valueAreaHigh?.toFixed(getPricePrecision(currentPair))||'N/A',
            valueLow: vp?.valueAreaLow?.toFixed(getPricePrecision(currentPair))||'N/A',
            ...fibs
        };
        
        let signal, confidence, entry, sl, tp1, tp2, tp3, reason;
        
        const ai = await getAIAnalysis(marketData);
        if (ai && ai.signal !== 'NEUTRAL') {
            signal = ai.signal; confidence = ai.confidence; entry = ai.idealEntry;
            sl = ai.stopLoss; tp1 = ai.takeProfit1; tp2 = ai.takeProfit2; tp3 = ai.takeProfit3;
            reason = `🤖 AI: ${ai.reasoning}`;
            showNotification(`✅ AI Signal: ${signal} (${confidence}%)`, 'success');
        } else {
            signal = trend==='bullish'?'LONG':(trend==='bearish'?'SHORT':'NEUTRAL');
            confidence = 45 + (mtf.confluenceScore>60?10:0);
            entry = trend==='bullish' ? Math.min(price, fibs.fib618) : Math.max(price, fibs.fib382);
            sl = trend==='bullish' ? entry - atr*1.2 : entry + atr*1.2;
            const risk = Math.abs(entry-sl);
            tp1 = trend==='bullish' ? entry+risk*1.5 : entry-risk*1.5;
            tp2 = trend==='bullish' ? entry+risk*2.5 : entry-risk*2.5;
            tp3 = trend==='bullish' ? entry+risk*4 : entry-risk*4;
            reason = `Rule-based (${trend} trend, MTF: ${mtf.confluenceScore.toFixed(0)}%)`;
        }
        
        // Update UI
        const prec = getPricePrecision(currentPair);
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(prec)}`;
        if (lastPrice) {
            const ch = ((price-lastPrice)/lastPrice*100).toFixed(2);
            const chEl = document.getElementById('priceChange');
            chEl.innerHTML = `${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;
            chEl.className = `price-change ${ch>=0?'positive':'negative'}`;
        }
        lastPrice = price;
        
        document.getElementById('signalTypeText').innerHTML = signal;
        document.getElementById('signalTypeBox').className = `signal-type-box ${signal.toLowerCase()}`;
        document.getElementById('confidenceText').innerHTML = `${confidence}%`;
        document.getElementById('idealEntryDisplay').innerHTML = `$${entry.toFixed(prec)}`;
        document.getElementById('entryPrice').innerHTML = `$${price.toFixed(prec)}`;
        
        const distance = entry - price;
        const distPercent = (Math.abs(distance)/price*100).toFixed(2);
        const distEl = document.getElementById('distanceToEntry');
        distEl.innerHTML = `${distance>0?'▼':'▲'} $${Math.abs(distance).toFixed(prec)} (${distPercent}%)`;
        distEl.style.color = (signal==='LONG'&&distance>0)||(signal==='SHORT'&&distance<0) ? '#34c759' : '#ff3b30';
        
        document.getElementById('stopLoss').innerHTML = `$${sl.toFixed(prec)}`;
        document.getElementById('takeProfit1').innerHTML = `$${tp1.toFixed(prec)}`;
        document.getElementById('takeProfit2').innerHTML = `$${tp2.toFixed(prec)}`;
        document.getElementById('takeProfit3').innerHTML = `$${tp3.toFixed(prec)}`;
        document.getElementById('riskReward').innerHTML = (Math.abs(tp1-entry)/Math.abs(entry-sl)).toFixed(1);
        
        const badge = document.getElementById('signalBadge');
        if (confidence>=70) { badge.innerHTML='🔥 HIGH CONFIDENCE'; badge.className='signal-badge high'; }
        else if (confidence>=55) { badge.innerHTML='📊 MEDIUM CONFIDENCE'; badge.className='signal-badge medium'; }
        else { badge.innerHTML='⚠️ LOW CONFIDENCE'; badge.className='signal-badge low'; }
        
        document.getElementById('signalReason').innerHTML = reason;
        
        if (vp) {
            document.getElementById('pocValue').innerHTML = `$${vp.poc?.price.toFixed(prec)||'--'}`;
            document.getElementById('valueHigh').innerHTML = `$${vp.valueAreaHigh?.toFixed(prec)||'--'}`;
            document.getElementById('valueLow').innerHTML = `$${vp.valueAreaLow?.toFixed(prec)||'--'}`;
            document.getElementById('totalVolume').innerHTML = `${(vp.totalVolume/1e6).toFixed(1)}M`;
        }
        
        if (of) {
            document.getElementById('buyingPressure').innerHTML = `${(of.buyingPressure/1e6).toFixed(1)}M`;
            document.getElementById('sellingPressure').innerHTML = `${(of.sellingPressure/1e6).toFixed(1)}M`;
            document.getElementById('netDelta').innerHTML = `${(of.netDelta/1e6).toFixed(1)}M`;
            document.getElementById('vwapValue').innerHTML = `$${of.vwap.toFixed(prec)}`;
        }
        
        document.getElementById('fvgCount').innerHTML = fvgs.length;
        document.getElementById('obCount').innerHTML = obs.length;
        document.getElementById('liquidityLevels').innerHTML = liq.length;
        document.getElementById('marketStructure').innerHTML = structure;
        
        document.getElementById('fib0').innerHTML = `$${fibs.fib0.toFixed(prec)}`;
        document.getElementById('fib236').innerHTML = `$${fibs.fib236.toFixed(prec)}`;
        document.getElementById('fib382').innerHTML = `$${fibs.fib382.toFixed(prec)}`;
        document.getElementById('fib500').innerHTML = `$${fibs.fib500.toFixed(prec)}`;
        document.getElementById('fib618').innerHTML = `$${fibs.fib618.toFixed(prec)}`;
        document.getElementById('fib786').innerHTML = `$${fibs.fib786.toFixed(prec)}`;
        document.getElementById('fib100').innerHTML = `$${fibs.fib100.toFixed(prec)}`;
        
        updateChart(hist);
        
        analysisData = { signalType: signal, idealEntry: entry, currentPrice: price, stopLoss: sl, takeProfit1: tp1, takeProfit2: tp2, takeProfit3: tp3, confidence };
        calculatePositionSize();
        
        document.getElementById('executeBtn').disabled = signal === 'NEUTRAL';
        
    } catch(e) { console.error(e); showNotification('Error: '+e.message, 'error'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; }
}

// ============================================
// LIMIT ORDERS
// ============================================
function loadPendingOrder() {
    const saved = localStorage.getItem('pendingLimitOrder');
    if (saved) { try { pendingLimitOrder = JSON.parse(saved); updateLimitOrderUI(); startPriceMonitoring(); } catch(e) {} }
}

function savePendingOrder(o) { pendingLimitOrder = o; localStorage.setItem('pendingLimitOrder', JSON.stringify(o)); updateLimitOrderUI(); }
function clearPendingOrder() { pendingLimitOrder = null; localStorage.removeItem('pendingLimitOrder'); if(priceCheckInterval) clearInterval(priceCheckInterval); updateLimitOrderUI(); }

function cancelLimitOrder() { clearPendingOrder(); showNotification('❌ Limit order cancelled', 'warning'); }

function updateLimitOrderUI() {
    const btn = document.getElementById('executeBtn'), status = document.getElementById('limitOrderStatus'), text = document.getElementById('limitOrderText');
    if (pendingLimitOrder) {
        btn.innerHTML = '⏳ Waiting for Entry...'; btn.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
        status.classList.remove('hidden');
        const prec = getPricePrecision(pendingLimitOrder.pair);
        text.innerHTML = `⏳ ${pendingLimitOrder.signalType} LIMIT @ $${pendingLimitOrder.idealEntry.toFixed(prec)} on ${pendingLimitOrder.pair}`;
        document.getElementById('connectionStatus').innerHTML = `🟡 Waiting for entry...`;
    } else {
        btn.innerHTML = '⚡ Place Limit Order'; btn.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
        status.classList.add('hidden');
        document.getElementById('connectionStatus').innerHTML = '🟢 Ready';
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) clearInterval(priceCheckInterval);
    priceCheckInterval = setInterval(async () => {
        if (!pendingLimitOrder) { clearInterval(priceCheckInterval); return; }
        const price = await getPrice(); if (!price) return;
        const o = pendingLimitOrder;
        let exec = false;
        if (o.signalType==='LONG' && price <= o.idealEntry) exec = true;
        else if (o.signalType==='SHORT' && price >= o.idealEntry) exec = true;
        if (exec) {
            clearPendingOrder();
            if (tg?.sendData) tg.sendData(JSON.stringify({ action:'limit_order_filled', pair:o.pair, signal:o.signalType, filledPrice:price, stopLoss:o.stopLoss, takeProfits:[o.takeProfit1,o.takeProfit2,o.takeProfit3] }));
            showNotification(`✅ LIMIT ORDER FILLED! ${o.signalType} @ $${price.toFixed(getPricePrecision(o.pair))}`, 'success');
            new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>{});
        }
        updatePriceDisplay(price);
    }, 5000);
}

function handleExecuteOrder() {
    if (!analysisData || analysisData.signalType==='NEUTRAL') { showNotification('No valid signal', 'error'); return; }
    if (pendingLimitOrder) { cancelLimitOrder(); return; }
    const order = { id: Date.now(), pair: currentPair, signalType: analysisData.signalType, idealEntry: analysisData.idealEntry, stopLoss: analysisData.stopLoss, takeProfit1: analysisData.takeProfit1, takeProfit2: analysisData.takeProfit2, takeProfit3: analysisData.takeProfit3, confidence: analysisData.confidence, createdAt: new Date().toISOString() };
    savePendingOrder(order); startPriceMonitoring();
    showNotification(`📝 Limit order placed @ $${order.idealEntry.toFixed(getPricePrecision(currentPair))}`, 'info');
}

// ============================================
// UI HELPERS
// ============================================
function updatePriceDisplay(p) { document.getElementById('currentPrice').innerHTML = `$${p.toFixed(getPricePrecision(currentPair))}`; }
function calculatePositionSize() {
    if (!analysisData || analysisData.signalType==='NEUTRAL') return;
    const acc = +document.getElementById('accountSize').value || 10000, riskP = +document.getElementById('riskPercent').value || 1;
    const riskAmt = acc * (riskP/100), stopDist = Math.abs(analysisData.idealEntry - analysisData.stopLoss);
    const pos = stopDist>0 ? riskAmt/stopDist : 0;
    document.getElementById('positionSize').innerHTML = pos.toFixed(4);
    document.getElementById('riskAmount').innerHTML = `$${riskAmt.toFixed(2)}`;
    document.getElementById('suggestedLeverage').innerHTML = '--';
}
function updateChart(d) { if(priceChart) { priceChart.data.datasets[0].data = d.slice(-50).map(c=>({x:c.time,y:c.close})); priceChart.data.labels = d.slice(-50).map(c=>new Date(c.time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})); priceChart.update(); } }
function showNotification(m, t) { const n = document.getElementById('notification'); if(!n) return; n.innerHTML = m; n.className = `notification ${t}`; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'), 4000); }
