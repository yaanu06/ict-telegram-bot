// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

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
    '5M': '5min', '15M': '15min', '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week'
};

// ============================================
// LOAD/SAVE API KEYS
// ============================================
async function loadAPIKeys() {
    const saved = localStorage.getItem('ict_bot_keys');
    if (saved) {
        try { const keys = JSON.parse(saved); TWELVE_DATA_KEY = keys.twelveData || ''; DEEPSEEK_API_KEY = keys.deepseek || ''; return true; } catch(e) {}
    }
    return false;
}

async function saveAPIKeys(twelveKey, deepseekKey) {
    localStorage.setItem('ict_bot_keys', JSON.stringify({ twelveData: twelveKey, deepseek: deepseekKey }));
    TWELVE_DATA_KEY = twelveKey; DEEPSEEK_API_KEY = deepseekKey;
    showNotification('✅ API keys saved!', 'success');
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
                <input type="password" id="twelveInput" class="setup-input">
                <label>DeepSeek API Key:</label>
                <input type="password" id="deepseekInput" class="setup-input">
                <div class="setup-buttons">
                    <button id="saveKeysBtn" class="setup-btn primary">Save</button>
                    <button id="skipSetupBtn" class="setup-btn secondary">Skip</button>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', setupHTML);
    document.getElementById('saveKeysBtn').addEventListener('click', async () => {
        const tk = document.getElementById('twelveInput').value.trim();
        const dk = document.getElementById('deepseekInput').value.trim();
        if (!tk) { showNotification('Twelve Data key required', 'warning'); return; }
        await saveAPIKeys(tk, dk);
        document.getElementById('setupOverlay').remove();
    });
    document.getElementById('skipSetupBtn').addEventListener('click', () => document.getElementById('setupOverlay').remove());
}

// ============================================
// STATE
// ============================================
let currentPair = 'XAU/USD';
let currentTimeframe = '15M';
let analysisData = null;
let apiCalls = 0;
let lastPrice = null;
let priceChart = null;
let chartData = [];
let pendingLimitOrder = null;
let priceCheckInterval = null;
let lastJsonOutput = {};

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
    document.getElementById('liveTime').innerHTML = `${now.toLocaleDateString('en-US', {month:'short',day:'numeric'})} ${now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'})} UTC`;
}

function initChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ data: [], borderColor: '#3390ec', borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } }, y: { grid: { color: '#2c2c2e' }, ticks: { color: '#8e8e93' } } } }
    });
}

function setupEventListeners() {
    document.getElementById('analyzeBtn')?.addEventListener('click', runAnalysis);
    document.getElementById('executeBtn')?.addEventListener('click', handleExecuteOrder);
    document.getElementById('cancelLimitBtn')?.addEventListener('click', cancelLimitOrder);
    document.getElementById('copyJsonBtn')?.addEventListener('click', copyJsonToClipboard);
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
    const pairs = { crypto: ['BTC/USD','ETH/USD'], forex: ['EUR/USD','GBP/USD'], metals: ['XAU/USD','XAG/USD'] };
    const select = document.getElementById('pairSelect');
    if (select) { select.innerHTML = pairs[category].map(p => `<option value="${p}">${getPairDisplayName(p)}</option>`).join(''); currentPair = pairs[category][0]; }
}

function getPairDisplayName(pair) {
    const icons = { 'BTC/USD':'₿','ETH/USD':'⟠','EUR/USD':'€','GBP/USD':'£','XAU/USD':'👑','XAG/USD':'🥈' };
    return `${icons[pair]||'📊'} ${pair}`;
}

function isForexPair(p) { return ['EUR/USD','GBP/USD','USD/JPY'].includes(p); }
function isGold(p) { return p.includes('XAU'); }
function getPricePrecision(p) { if (isGold(p)) return 2; if (isForexPair(p)) return 5; return 2; }

// ============================================
// API FUNCTIONS
// ============================================
async function getPrice() {
    if (!TWELVE_DATA_KEY) return null;
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(TWELVE_DATA_SYMBOLS[currentPair])}&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.price) { apiCalls++; document.getElementById('apiUsage').innerHTML = apiCalls; document.getElementById('apiSource').innerHTML = '📡 Twelve Data'; return parseFloat(data.price); }
    } catch(e) {}
    return null;
}

async function getHistoricalData(timeframe = currentTimeframe) {
    if (!TWELVE_DATA_KEY) return null;
    try {
        const res = await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(TWELVE_DATA_SYMBOLS[currentPair])}&interval=${TIMEFRAME_MAP[timeframe]||'15min'}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        if (data.values) { apiCalls++; return data.values.map(c => ({ time: c.datetime, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume||1000000 })).reverse(); }
    } catch(e) {}
    return null;
}

// ============================================
// TECHNICAL ANALYSIS (Compact)
// ============================================
const calcEMA = (p, n) => { const m = 2/(n+1); let e = [p[0]]; for(let i=1;i<p.length;i++) e.push((p[i]-e[i-1])*m+e[i-1]); return e; };
const calcRSI = (p, n=14) => { let g=0,l=0; for(let i=p.length-n;i<p.length;i++){ let c=p[i]-p[i-1]; c>=0?g+=c:l-=c; } let ag=g/n, al=l/n; return al===0?100:100-(100/(1+ag/al)); };
const calcATR = (d, n=14) => { let t=[]; for(let i=1;i<d.length;i++) t.push(Math.max(d[i].high-d[i].low, Math.abs(d[i].high-d[i-1].close), Math.abs(d[i].low-d[i-1].close))); return t.slice(-n).reduce((a,b)=>a+b,0)/n; };

function detectFVGs(d) { let f=[]; for(let i=1;i<d.length-1;i++){ if(d[i-1].high<d[i+1].low&&d[i+1].low-d[i-1].high>d[i+1].close*0.0005) f.push({type:'bullish', low:d[i-1].high, high:d[i+1].low, mid:(d[i-1].high+d[i+1].low)/2}); if(d[i-1].low>d[i+1].high&&d[i-1].low-d[i+1].high>d[i+1].close*0.0005) f.push({type:'bearish', low:d[i+1].high, high:d[i-1].low, mid:(d[i+1].high+d[i-1].low)/2}); } return f; }
function detectOBs(d) { let o=[]; for(let i=2;i<d.length-1;i++){ if(d[i].close<d[i].open&&d[i+1].close>d[i+1].open&&d[i+1].close>d[i].high) o.push({type:'bullish', high:d[i].high, low:d[i].low}); if(d[i].close>d[i].open&&d[i+1].close<d[i+1].open&&d[i+1].close<d[i].low) o.push({type:'bearish', high:d[i].high, low:d[i].low}); } return o; }
function detectLQ(d) { let h=d.map(c=>c.high), l=d.map(c=>c.low), L=[]; for(let i=2;i<d.length-2;i++){ if(h[i]>h[i-1]&&h[i]>h[i-2]&&h[i]>h[i+1]&&h[i]>h[i+2]) L.push({type:'resistance',price:h[i]}); if(l[i]<l[i-1]&&l[i]<l[i-2]&&l[i]<l[i+1]&&l[i]<l[i+2]) L.push({type:'support',price:l[i]}); } return L; }
function analyzeMS(d) { let h=d.map(c=>c.high), l=d.map(c=>c.low), rh=h.slice(-20), rl=l.slice(-20); let hh=rh[rh.length-1]>rh[0], hl=rl[rl.length-1]>rl[0], lh=rh[rh.length-1]<rh[0], ll=rl[rl.length-1]<rl[0]; if(hh&&hl) return 'Bullish'; if(lh&&ll) return 'Bearish'; return 'Ranging'; }

function calcVP(d) {
    if(!d?.length) return null;
    let maxP=Math.max(...d.map(c=>c.high)), minP=Math.min(...d.map(c=>c.low)), r=maxP-minP, ls=r/12;
    let levels=[]; for(let i=0;i<12;i++){ let lo=minP+i*ls; levels.push({low:lo,high:lo+ls,volume:0,price:(lo+lo+ls)/2}); }
    d.forEach(c=>{ levels.forEach(l=>{ if(c.high>=l.low&&c.low<=l.high){ let o=Math.min(c.high,l.high)-Math.max(c.low,l.low); l.volume+=c.volume*(o/(c.high-c.low)); } }); });
    let maxV=0, poc=null; levels.forEach(l=>{ if(l.volume>maxV){ maxV=l.volume; poc=l; } });
    let totalV=levels.reduce((s,l)=>s+l.volume,0), target=totalV*.7, acc=0, sorted=[...levels].sort((a,b)=>b.volume-a.volume), va=[];
    for(let l of sorted){ if(acc<target){ va.push(l); acc+=l.volume; } }
    return {poc, valueAreaHigh:va.length?Math.max(...va.map(l=>l.high)):maxP, valueAreaLow:va.length?Math.min(...va.map(l=>l.low)):minP, totalVolume:totalV};
}

function calcOF(d) {
    if(!d?.length) return null;
    let buy=0, sell=0;
    d.forEach(c=>{ let bull=c.close>c.open; bull?(buy+=c.volume*.7,sell+=c.volume*.3):(buy+=c.volume*.3,sell+=c.volume*.7); });
    let pv=0, vol=0; d.forEach(c=>{ let tp=(c.high+c.low+c.close)/3; pv+=tp*c.volume; vol+=c.volume; });
    return { buyingPressure:buy, sellingPressure:sell, netDelta:buy-sell, vwap:pv/vol };
}

function detectMSS(d) {
    let h=d.map(c=>c.high), l=d.map(c=>c.low), c=d.map(c=>c.close);
    let rH=Math.max(...h.slice(-20)), rL=Math.min(...l.slice(-20)), cP=c[c.length-1];
    if(cP>rH) return { type:'BULLISH', level:rH };
    if(cP<rL) return { type:'BEARISH', level:rL };
    return null;
}

function findSwings(d, lb=3) {
    let H=[], L=[], h=d.map(c=>c.high), l=d.map(c=>c.low);
    for(let i=lb;i<h.length-lb;i++){ let iH=true,iL=true; for(let j=1;j<=lb;j++){ if(h[i]<=h[i-j]||h[i]<=h[i+j]) iH=false; if(l[i]>=l[i-j]||l[i]>=l[i+j]) iL=false; } if(iH) H.push({price:h[i],index:i}); if(iL) L.push({price:l[i],index:i}); }
    return {highs:H, lows:L};
}

function detectBreakers(d) {
    let b=[], s=findSwings(d);
    for(let i=5;i<d.length-5;i++){ let c=d[i]; if(c.close>c.open){ let r=s.highs.find(h=>h.index<i&&h.price<c.close); if(r) b.push({type:'BULLISH',price:r.price}); } if(c.close<c.open){ let sp=s.lows.find(l=>l.index<i&&l.price>c.close); if(sp) b.push({type:'BEARISH',price:sp.price}); } }
    return b;
}

// ============================================
// DYNAMIC SIGNAL SCORING
// ============================================
function generateSignal(data, price) {
    const atr = calcATR(data, 14), closes = data.map(c=>c.close), rsi = calcRSI(closes, 14);
    const fvgs = detectFVGs(data), mss = detectMSS(data), blocks = detectBreakers(data);
    const liquidity = detectLQ(data), of = calcOF(data), vp = calcVP(data);
    const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50);
    const cE20 = ema20[ema20.length-1], cE50 = ema50[ema50.length-1];
    
    const bFVGs = fvgs.filter(f=>f.type==='bullish'&&f.low<price).sort((a,b)=>b.low-a.low);
    const sFVGs = fvgs.filter(f=>f.type==='bearish'&&f.high>price).sort((a,b)=>a.high-b.high);
    const supports = liquidity.filter(l=>l.type==='support'&&l.price<price).sort((a,b)=>b.price-a.price);
    const resistances = liquidity.filter(l=>l.type==='resistance'&&l.price>price).sort((a,b)=>a.price-b.price);
    
    let bScore=0, sScore=0, bR=[], sR=[];
    
    if(mss?.type==='BULLISH'){ bScore+=25; bR.push('MSS Bullish'); } else if(mss?.type==='BEARISH'){ sScore+=25; sR.push('MSS Bearish'); }
    if(bFVGs.length){ bScore+=20; bR.push(`FVG ${bFVGs[0].low.toFixed(2)}`); }
    if(sFVGs.length){ sScore+=20; sR.push(`FVG ${sFVGs[0].high.toFixed(2)}`); }
    
    const bBreakers=blocks.filter(b=>b.type==='BULLISH'&&b.price<price);
    const sBreakers=blocks.filter(b=>b.type==='BEARISH'&&b.price>price);
    if(bBreakers.length){ bScore+=15; bR.push('Breaker support'); }
    if(sBreakers.length){ sScore+=15; sR.push('Breaker resistance'); }
    
    if(cE20>cE50){ bScore+=15; bR.push('EMA20>EMA50'); } else { sScore+=15; sR.push('EMA20<EMA50'); }
    if(of&&of.netDelta>0){ bScore+=10; bR.push('Buyers aggressive'); } else if(of){ sScore+=10; sR.push('Sellers aggressive'); }
    if(vp?.poc){ if(price>vp.poc.price){ bScore+=10; bR.push('Price>POC'); } else { sScore+=10; sR.push('Price<POC'); } }
    if(rsi>50) bScore+=5; else sScore+=5;
    
    let dir, conf, eZone, sl, reason;
    if(bScore>sScore&&bScore>=45){ dir='BUY'; conf=Math.min(bScore+10,95); reason=bR.join('; ');
        if(bFVGs.length) eZone={price:bFVGs[0].mid,low:bFVGs[0].low,high:bFVGs[0].high,source:'FVG'};
        else if(bBreakers.length) eZone={price:bBreakers[0].price,low:bBreakers[0].price-atr*.3,high:bBreakers[0].price+atr*.3,source:'Breaker'};
        else if(supports.length) eZone={price:supports[0].price,low:supports[0].price-atr*.3,high:supports[0].price+atr*.3,source:'Support'};
        else { let rL=Math.min(...data.slice(-20).map(c=>c.low)), rH=Math.max(...data.slice(-20).map(c=>c.high)), r=rH-rL; eZone={price:rL+r*.7,low:rL+r*.618,high:rL+r*.79,source:'OTE'}; }
    } else if(sScore>bScore&&sScore>=45){ dir='SELL'; conf=Math.min(sScore+10,95); reason=sR.join('; ');
        if(sFVGs.length) eZone={price:sFVGs[0].mid,low:sFVGs[0].low,high:sFVGs[0].high,source:'FVG'};
        else if(sBreakers.length) eZone={price:sBreakers[0].price,low:sBreakers[0].price-atr*.3,high:sBreakers[0].price+atr*.3,source:'Breaker'};
        else if(resistances.length) eZone={price:resistances[0].price,low:resistances[0].price-atr*.3,high:resistances[0].price+atr*.3,source:'Resistance'};
        else { let rL=Math.min(...data.slice(-20).map(c=>c.low)), rH=Math.max(...data.slice(-20).map(c=>c.high)), r=rH-rL; eZone={price:rH-r*.3,low:rH-r*.382,high:rH-r*.5,source:'OTE'}; }
    } else { dir='NEUTRAL'; conf=0; reason=`Bullish:${bScore} | Bearish:${sScore}`; eZone=null; }
    
    if(eZone){ const buf=isGold(currentPair)?2:atr*.2; sl=dir==='BUY'?eZone.low-buf:eZone.high+buf; }
    return {direction:dir, confidence:conf, entryZone:eZone, stopLoss:sl, reason, scores:{bullishScore:bScore,bearishScore:sScore}, details:{fvgs:fvgs.length,blocks:blocks.length,ofDelta:of?.netDelta||0,poc:vp?.poc?.price||null,rsi,trend:cE20>cE50?'BULLISH':'BEARISH',mss:mss?.type||null}};
}

// ============================================
// MULTI-TIMEFRAME UI
// ============================================
async function analyzeTF(tf) {
    let d=await getHistoricalData(tf); if(!d||d.length<30) return null;
    let c=d.map(x=>x.close), r=calcRSI(c), t=c[c.length-1]>c[c.length-20]?'BULLISH':(c[c.length-1]<c[c.length-20]?'BEARISH':'NEUTRAL');
    return {data:d, trend:t, rsi:r};
}

async function updateMTFUI() {
    const tfs=['5M','15M','1H','4H']; let bC=0,sC=0;
    for(let tf of tfs){
        let r=await analyzeTF(tf);
        if(r){
            if(r.trend==='BULLISH') bC++; else if(r.trend==='BEARISH') sC++;
            let te=document.getElementById(`trend${tf}`); if(te){ te.innerHTML=r.trend==='BULLISH'?'🟢 Bullish':(r.trend==='BEARISH'?'🔴 Bearish':'⚪ Neutral'); te.className=`mtf-trend ${r.trend.toLowerCase()}`; }
            let re=document.getElementById(`rsi${tf}`); if(re) re.innerHTML=r.rsi.toFixed(1);
        }
    }
    let t=bC+sC, cs=t?Math.max(bC,sC)/t*100:0, d=bC>sC?'Bullish':(sC>bC?'Bearish':'Neutral');
    let se=document.getElementById('confluenceScore'); if(se) se.innerHTML=`${d} (${cs.toFixed(0)}%)`;
}

// ============================================
// DEEPSEEK AI
// ============================================
async function getAI(md) {
    if(!DEEPSEEK_API_KEY) return null;
    showNotification('🤖 AI analyzing...','info');
    const prompt=`ICT trader. Return JSON.\n${currentPair} | ${currentTimeframe} | Price:${md.price}\nScores: Bullish=${md.bScore} Bearish=${md.sScore}\nFVGs:${md.fvg} OB:${md.ob}\nEntry:${md.eZone}\nReturn:{"signal":"BUY/SELL/NEUTRAL","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit1":#,"takeProfit2":#,"takeProfit3":#,"reasoning":"..."}`;
    try{
        let r=await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'Return ONLY JSON.'},{role:'user',content:prompt}],temperature:.1,max_tokens:600})});
        let d=await r.json();
        if(d.choices?.[0]){ let m=d.choices[0].message.content.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); }
    }catch(e){}
    return null;
}

// ============================================
// JSON OUTPUT (NEW!)
// ============================================
function updateJsonOutput(signalData, fullData) {
    const prec = getPricePrecision(currentPair);
    const signalType = signalData.direction === 'BUY' ? 'LONG' : (signalData.direction === 'SELL' ? 'SHORT' : 'NEUTRAL');
    
    const jsonOutput = {
        trade_signal: {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toISOString().split('T')[1].split('.')[0],
            pair: currentPair,
            timeframe: currentTimeframe,
            current_price: signalData.currentPrice,
            trade_type: signalData.direction === 'BUY' ? 'BUY-LIMIT' : (signalData.direction === 'SELL' ? 'SELL-LIMIT' : 'NEUTRAL'),
            entry_price: signalData.entry,
            stop_loss: signalData.sl,
            take_profit_1: signalData.tp1,
            take_profit_2: signalData.tp2,
            take_profit_3: signalData.tp3,
            risk_reward_ratio: signalData.rr,
            confidence: signalData.confidence,
            entry_source: signalData.entrySource || 'N/A',
            analysis: {
                scoring: {
                    bullish_score: fullData.scores?.bullishScore || 0,
                    bearish_score: fullData.scores?.bearishScore || 0
                },
                multi_timeframe: {
                    "5M": document.getElementById('trend5M')?.innerHTML?.replace(/[🟢🔴⚪]/g,'').trim() || '--',
                    "15M": document.getElementById('trend15M')?.innerHTML?.replace(/[🟢🔴⚪]/g,'').trim() || '--',
                    "1H": document.getElementById('trend1H')?.innerHTML?.replace(/[🟢🔴⚪]/g,'').trim() || '--',
                    "4H": document.getElementById('trend4H')?.innerHTML?.replace(/[🟢🔴⚪]/g,'').trim() || '--'
                },
                ict_concepts: {
                    market_structure_shift: fullData.details?.mss || 'None',
                    fair_value_gaps: fullData.details?.fvgs || 0,
                    order_blocks: document.getElementById('obCount')?.innerHTML || '--',
                    breaker_blocks: fullData.details?.blocks || 0,
                    liquidity_levels: document.getElementById('liquidityLevels')?.innerHTML || '--'
                },
                technical_indicators: {
                    rsi: fullData.details?.rsi?.toFixed(1) || '--',
                    atr: fullData.atr?.toFixed(2) || '--',
                    trend: fullData.details?.trend || '--',
                    ema_alignment: fullData.details?.trend === 'BULLISH' ? 'EMA20 > EMA50' : 'EMA20 < EMA50'
                },
                volume_profile: {
                    poc: document.getElementById('pocValue')?.innerHTML || '--',
                    value_area_high: document.getElementById('valueHigh')?.innerHTML || '--',
                    value_area_low: document.getElementById('valueLow')?.innerHTML || '--'
                },
                order_flow: {
                    net_delta: document.getElementById('netDelta')?.innerHTML || '--',
                    vwap: document.getElementById('vwapValue')?.innerHTML || '--'
                },
                reasoning: signalData.reason || 'Analysis complete'
            }
        }
    };
    
    lastJsonOutput = jsonOutput;
    document.getElementById('jsonOutput').innerHTML = JSON.stringify(jsonOutput, null, 2);
}

function copyJsonToClipboard() {
    if (!lastJsonOutput || !lastJsonOutput.trade_signal) {
        showNotification('Run analysis first!', 'warning');
        return;
    }
    const text = JSON.stringify(lastJsonOutput, null, 2);
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copyJsonBtn');
        btn.innerHTML = '✅ Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = '📋 Copy JSON'; btn.classList.remove('copied'); }, 2000);
        showNotification('📋 JSON copied to clipboard!', 'success');
    }).catch(() => showNotification('Failed to copy', 'error'));
}

// ============================================
// MAIN ANALYSIS
// ============================================
async function runAnalysis() {
    const btn = document.getElementById('analyzeBtn');
    btn.classList.add('loading'); btn.disabled = true;
    if (!TWELVE_DATA_KEY) { showSetupModal(); btn.classList.remove('loading'); btn.disabled = false; return; }
    showNotification('🔍 Analyzing...', 'info');
    
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        await updateMTFUI();
        const hist = await getHistoricalData(); if (!hist?.length) throw new Error('No data');
        chartData = hist;
        
        const closes = hist.map(c=>c.close), highs = hist.map(c=>c.high), lows = hist.map(c=>c.low);
        const rsi = calcRSI(closes), atr = calcATR(hist);
        const fvgs = detectFVGs(hist), obs = detectOBs(hist), liq = detectLQ(hist);
        const structure = analyzeMS(hist), vp = calcVP(hist), of = calcOF(hist);
        const mss = detectMSS(hist), blocks = detectBreakers(hist);
        
        const sigData = generateSignal(hist, price);
        
        const md = { price:price.toFixed(2), bScore:sigData.scores.bullishScore, sScore:sigData.scores.bearishScore, fvg:fvgs.length, ob:obs.length, eZone:sigData.entryZone?.source||'None' };
        const ai = await getAI(md);
        
        let signal, conf, entry, sl, tp1, tp2, tp3, reason, entrySource;
        if (ai && ai.signal !== 'NEUTRAL') {
            signal = ai.signal; conf = ai.confidence; entry = ai.entryPrice||sigData.entryZone?.price||price;
            sl = ai.stopLoss||sigData.stopLoss; tp1 = ai.takeProfit1; tp2 = ai.takeProfit2; tp3 = ai.takeProfit3;
            reason = ai.reasoning; entrySource = 'AI';
        } else {
            signal = sigData.direction; conf = sigData.confidence; entry = sigData.entryZone?.price||price;
            sl = sigData.stopLoss; entrySource = sigData.entryZone?.source||'N/A';
            const risk = Math.abs(entry-sl);
            tp1 = signal==='BUY'?entry+risk*2:entry-risk*2;
            tp2 = signal==='BUY'?entry+risk*3.5:entry-risk*3.5;
            tp3 = signal==='BUY'?entry+risk*5:entry-risk*5;
            reason = sigData.reason;
        }
        
        const signalType = signal==='BUY'?'LONG':(signal==='SELL'?'SHORT':'NEUTRAL');
        const prec = getPricePrecision(currentPair);
        const rr = Math.abs(tp1-entry)/Math.abs(entry-sl);
        
        // Update JSON Output
        updateJsonOutput({
            direction: signal, currentPrice: price, entry, sl, tp1, tp2, tp3,
            rr: rr.toFixed(1), confidence: conf, entrySource, reason
        }, { scores: sigData.scores, details: sigData.details, atr });
        
        // Update UI
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(prec)}`;
        if (lastPrice) {
            const ch = ((price-lastPrice)/lastPrice*100).toFixed(2);
            const chEl = document.getElementById('priceChange');
            chEl.innerHTML = `${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;
            chEl.className = `price-change ${ch>=0?'positive':'negative'}`;
        }
        lastPrice = price;
        
        document.getElementById('signalTypeText').innerHTML = signalType;
        document.getElementById('signalTypeBox').className = `signal-type-box ${signalType.toLowerCase()}`;
        document.getElementById('confidenceText').innerHTML = `${conf}%`;
        document.getElementById('idealEntryDisplay').innerHTML = `$${entry.toFixed(prec)}`;
        document.getElementById('entryPrice').innerHTML = `$${price.toFixed(prec)}`;
        
        const dist = entry-price;
        const dEl = document.getElementById('distanceToEntry');
        dEl.innerHTML = `${dist>0?'▼':'▲'} $${Math.abs(dist).toFixed(prec)} (${(Math.abs(dist)/price*100).toFixed(2)}%)`;
        
        document.getElementById('stopLoss').innerHTML = `$${sl.toFixed(prec)}`;
        document.getElementById('takeProfit1').innerHTML = `$${tp1.toFixed(prec)}`;
        document.getElementById('takeProfit2').innerHTML = `$${tp2.toFixed(prec)}`;
        document.getElementById('takeProfit3').innerHTML = `$${tp3.toFixed(prec)}`;
        document.getElementById('riskReward').innerHTML = rr.toFixed(1);
        
        const badge = document.getElementById('signalBadge');
        if (conf>=70) { badge.innerHTML='🔥 HIGH'; badge.className='signal-badge high'; }
        else if (conf>=55) { badge.innerHTML='📊 MEDIUM'; badge.className='signal-badge medium'; }
        else { badge.innerHTML='⚠️ LOW'; badge.className='signal-badge low'; }
        
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
        document.getElementById('marketStructure').innerHTML = mss?`MSS ${mss.type}`:structure;
        
        const rH = Math.max(...highs.slice(-20)), rL = Math.min(...lows.slice(-20)), r = rH-rL;
        document.getElementById('fib0').innerHTML = `$${rL.toFixed(prec)}`;
        document.getElementById('fib382').innerHTML = `$${(rL+r*.382).toFixed(prec)}`;
        document.getElementById('fib500').innerHTML = `$${(rL+r*.5).toFixed(prec)}`;
        document.getElementById('fib618').innerHTML = `$${(rL+r*.618).toFixed(prec)}`;
        document.getElementById('fib786').innerHTML = `$${(rL+r*.786).toFixed(prec)}`;
        document.getElementById('fib100').innerHTML = `$${rH.toFixed(prec)}`;
        
        updateChart(hist);
        analysisData = { signalType, idealEntry:entry, currentPrice:price, stopLoss:sl, takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3, confidence:conf };
        calculatePositionSize();
        document.getElementById('executeBtn').disabled = signalType==='NEUTRAL';
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
function cancelLimitOrder() { clearPendingOrder(); showNotification('❌ Cancelled', 'warning'); }

function updateLimitOrderUI() {
    const btn = document.getElementById('executeBtn'), status = document.getElementById('limitOrderStatus'), text = document.getElementById('limitOrderText');
    if (pendingLimitOrder) {
        btn.innerHTML = '⏳ Waiting...'; btn.style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
        status.classList.remove('hidden');
        text.innerHTML = `⏳ ${pendingLimitOrder.signalType} LIMIT @ $${pendingLimitOrder.idealEntry.toFixed(getPricePrecision(currentPair))}`;
    } else {
        btn.innerHTML = '⚡ Place Limit Order'; btn.style.background = 'linear-gradient(135deg, #34c759, #28a745)';
        status.classList.add('hidden');
    }
}

function startPriceMonitoring() {
    if (priceCheckInterval) clearInterval(priceCheckInterval);
    priceCheckInterval = setInterval(async () => {
        if (!pendingLimitOrder) { clearInterval(priceCheckInterval); return; }
        const price = await getPrice(); if (!price) return;
        const o = pendingLimitOrder;
        if ((o.signalType==='LONG'&&price<=o.idealEntry)||(o.signalType==='SHORT'&&price>=o.idealEntry)) {
            clearPendingOrder();
            showNotification(`✅ FILLED! ${o.signalType} @ $${price.toFixed(getPricePrecision(o.pair))}`, 'success');
            new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>{});
        }
    }, 3000);
}

function handleExecuteOrder() {
    if (!analysisData||analysisData.signalType==='NEUTRAL') { showNotification('No signal', 'error'); return; }
    if (pendingLimitOrder) { cancelLimitOrder(); return; }
    const order = { id:Date.now(), pair:currentPair, signalType:analysisData.signalType, idealEntry:analysisData.idealEntry, stopLoss:analysisData.stopLoss, takeProfit1:analysisData.takeProfit1, takeProfit2:analysisData.takeProfit2, takeProfit3:analysisData.takeProfit3, confidence:analysisData.confidence, createdAt:new Date().toISOString() };
    savePendingOrder(order); startPriceMonitoring();
    showNotification(`📝 Limit @ $${order.idealEntry.toFixed(getPricePrecision(currentPair))}`, 'info');
}

// ============================================
// UI HELPERS
// ============================================
function calculatePositionSize() {
    if (!analysisData||analysisData.signalType==='NEUTRAL') return;
    const acc = +document.getElementById('accountSize').value||10000, rP = +document.getElementById('riskPercent').value||1;
    const rA = acc*(rP/100), sD = Math.abs(analysisData.idealEntry-analysisData.stopLoss);
    document.getElementById('positionSize').innerHTML = (sD>0?rA/sD:0).toFixed(4);
    document.getElementById('riskAmount').innerHTML = `$${rA.toFixed(2)}`;
}
function updateChart(d) { if(priceChart) { priceChart.data.datasets[0].data = d.slice(-50).map(c=>({x:c.time,y:c.close})); priceChart.data.labels = d.slice(-50).map(c=>new Date(c.time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})); priceChart.update(); } }
function showNotification(m, t) { const n = document.getElementById('notification'); if(!n) return; n.innerHTML = m; n.className = `notification ${t}`; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'), 4000); }
