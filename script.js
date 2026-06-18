// Initialize
const tg = window.Telegram.WebApp;
if (tg) { tg.expand(); tg.ready(); }

// ============================================
// CONFIG
// ============================================
let TWELVE_DATA_KEY = '', DEEPSEEK_API_KEY = '';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

const SYMBOLS = {
    'BTC/USD':'BTC/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY','AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD','EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};

const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day','1W':'1week' };
const QUOTE_INTERVAL_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day' };
const ALL_TIMEFRAMES = ['5M', '15M', '1H', '4H', '1D'];

const TF_WEIGHT = { '1D': 5, '4H': 4, '1H': 3, '15M': 2, '5M': 1 };

function getTimeframeHierarchy(selectedTF) {
    const hierarchy = {
        '1D': ['1D', '4H', '1H', '15M'],
        '4H': ['4H', '1H', '15M', '5M'],
        '1H': ['1H', '15M', '5M', '5M'],
        '15M': ['1H', '15M', '5M', '5M'],
        '5M': ['15M', '5M', '5M', '5M']
    };
    return hierarchy[selectedTF] || ['4H', '1H', '15M', '5M'];
}

function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2, slBuffers: { '5M': 2, '15M': 3, '1H': 5, '4H': 8, '1D': 15 } };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.01, targetRR: 4, prec: 2, slBuffers: { '5M': 0.03, '15M': 0.05, '1H': 0.08, '4H': 0.12, '1D': 0.20 } };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.005, targetRR: 4, prec: 3, slBuffers: { '5M': 0.08, '15M': 0.12, '1H': 0.20, '4H': 0.35, '1D': 0.60 } };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.015, targetRR: 4, prec: 2, slBuffers: { '5M': 30, '15M': 50, '1H': 80, '4H': 120, '1D': 200 } };
    return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.005, targetRR: 4, prec: 5, slBuffers: { '5M': 0.0003, '15M': 0.0005, '1H': 0.0008, '4H': 0.0012, '1D': 0.0020 } };
}

// FIX: Added currentPair parameter to fix scope bug
function getSLBufferForTF(apiATR, tfUsed, currentPair) { 
    const s = getMarketSettings(currentPair); 
    const tfBuffer = s.slBuffers[tfUsed] || s.slBuffers['15M'] || 3;
    return Math.max(tfBuffer, apiATR * 0.5); 
}

// ============================================
// API KEYS MANAGEMENT
// ============================================
async function loadKeys() { const s = localStorage.getItem('ict_bot_keys'); if (s) { try { const k = JSON.parse(s); TWELVE_DATA_KEY = k.twelveData||''; DEEPSEEK_API_KEY = k.deepseek||''; return true; } catch(e) {} } return false; }
async function saveKeys(tk, dk) { localStorage.setItem('ict_bot_keys', JSON.stringify({twelveData:tk, deepseek:dk})); TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; updateKeyStatus(); }
function clearKeys() { localStorage.removeItem('ict_bot_keys'); TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; updateKeyStatus(); showNotif('🗑️ Keys removed','warning'); }
function updateKeyStatus() { const ts=document.getElementById('twelveStatus'),ds=document.getElementById('deepseekStatus'); if(ts) ts.innerHTML=TWELVE_DATA_KEY?'✅ Active':'❌ Missing'; if(ts) ts.className='status-badge '+(TWELVE_DATA_KEY?'active':'inactive'); if(ds) ds.innerHTML=DEEPSEEK_API_KEY?'✅ Active ('+DEEPSEEK_API_KEY.substring(0,5)+'...)':'❌ Missing'; if(ds) ds.className='status-badge '+(DEEPSEEK_API_KEY?'active':'inactive'); }
function showSetup() { const ex=document.getElementById('setupOverlay'); if(ex)ex.remove(); document.body.insertAdjacentHTML('beforeend',`<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button></div></div>`); document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk);document.getElementById('setupOverlay').remove();}); document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';}); document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove()); }

// ============================================
// STATE & UI INIT
// ============================================
let pair='XAU/USD',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null;
let cachedPrice = null;
let priceCacheTime = 0;
const PRICE_CACHE_DURATION = 5000;

function showNotif(msg, type='info') {
    const n = document.getElementById('notif');
    if(!n) return;
    n.innerHTML = msg;
    n.className = 'notification ' + type;
    n.style.display = 'block';
    setTimeout(() => n.style.display = 'none', 3000);
}

document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY)setTimeout(showSetup,500);init();});
function init(){updateTime();setInterval(updateTime,1000);document.getElementById('analyzeBtn').addEventListener('click',runAutoScan);document.getElementById('executeBtn').addEventListener('click',handleLimit);document.getElementById('cancelLimitBtn').addEventListener('click',cancelLimit);document.getElementById('copyJsonBtn').addEventListener('click',copyJson);document.getElementById('updateKeysBtn').addEventListener('click',showSetup);document.getElementById('pairSelect').addEventListener('change',e=>pair=e.target.value);document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));loadLimitOrder();}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML=`${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

// ============================================
// API LAYER
// ============================================
async function getPrice() {
    const now = Date.now();
    if (cachedPrice !== null && (now - priceCacheTime) < PRICE_CACHE_DURATION) return cachedPrice;
    if (!TWELVE_DATA_KEY) return null;
    try {
        const r = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);
        const d = await r.json();
        if (d.price) {
            calls++;
            cachedPrice = +d.price;
            priceCacheTime = now;
            return cachedPrice;
        }
    } catch(e) { if (cachedPrice !== null) return cachedPrice; }
    return null;
}

async function getHistory(tfStr){
    if(!TWELVE_DATA_KEY)return null;
    try{
        const r=await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const d=await r.json();
        if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();}
    }catch(e){}
    return null;
}

async function getQuoteDirection(tfStr) {
    try {
        const interval = QUOTE_INTERVAL_MAP[tfStr] || '1day';
        const r = await fetch(`${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);
        const d = await r.json();
        if (d.close && d.open) {
            if (d.close > d.open) return 'BULLISH';
            if (d.close < d.open) return 'BEARISH';
        }
    } catch(e) {}
    return 'NEUTRAL';
}

async function getTechnicalIndicators(tfUsed){
    if(!TWELVE_DATA_KEY)return{};
    const symbol=encodeURIComponent(SYMBOLS[pair]);
    const interval=TF_MAP[tfUsed];
    const ind={};
    try{const r=await fetch(`${TWELVE_DATA_BASE}/rsi?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.rsi=parseFloat(d.values[0].rsi);calls++;}}catch(e){}
    try{const r=await fetch(`${TWELVE_DATA_BASE}/atr?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.atr_api=parseFloat(d.values[0].atr);calls++;}}catch(e){}
    try{const r=await fetch(`${TWELVE_DATA_BASE}/stoch?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.stoch_k=parseFloat(d.values[0].slow_k);ind.stoch_d=parseFloat(d.values[0].slow_d);calls++;}}catch(e){}
    try{const r=await fetch(`${TWELVE_DATA_BASE}/bbands?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.bb_upper=parseFloat(d.values[0].upper_band);ind.bb_lower=parseFloat(d.values[0].lower_band);calls++;}}catch(e){}
    return ind;
}

// ============================================
// MATHEMATICAL & BASE ICT CONCEPTS
// ============================================
const ema=(p,n)=>{const m=2/(n+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push((p[i]-e[i-1])*m+e[i-1]);return e;};
const rsiCalc=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const rH=Math.max(...highs.slice(-20)),rL=Math.min(...lows.slice(-20)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL);const r1=pp*2-rL,r2=pp+(rH-rL);const allS=[s1,s2].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,r2].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2},resistances:{R1:r1,R2:r2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}

// ============================================
// UPGRADED ICT DETECTION (FIXED PRECISION)
// ============================================

// FIX 1: Dynamic FVG Threshold based on ATR
function detectFVGImproved(d){
    if(d.length < 3) return [];
    const atrVal = atr(d, 14);
    const fvgThreshold = atrVal * 0.3; // 30% of ATR
    let f=[];
    for(let i=1;i<d.length-1;i++){
        const gap = d[i+1].l - d[i-1].h;
        if(d[i-1].h < d[i+1].l && gap > fvgThreshold){
            let m=false;
            for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){m=true;break;}}
            f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!m});
        }
        const gapBear = d[i-1].l - d[i+1].h;
        if(d[i-1].l>d[i+1].h && gapBear > fvgThreshold){
            let m=false;
            for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){m=true;break;}}
            f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!m});
        }
    }
    return f;
}

// FIX 2: Strict Order Blocks requiring displacement
function detectOrderBlocksImproved(data, direction) {
    const obs = [];
    if(data.length < 3) return obs;
    const atrVal = atr(data, 14);
    
    for (let i = 1; i < data.length - 1; i++) {
        const candle = data[i];
        const nextCandle = data[i + 1];
        const body = Math.abs(candle.c - candle.o);
        const nextBody = Math.abs(nextCandle.c - nextCandle.o);
        if (body < atrVal * 0.4) continue; // Ignore dojis/small candles

        if (direction === 'BUY') {
            if (candle.c < candle.o && nextCandle.c > nextCandle.o &&
                nextBody > body * 1.1 && nextCandle.h > candle.h && nextCandle.c > candle.h) {
                obs.push({ type: 'BULL_OB', high: candle.h, low: candle.l, index: i, strength: nextBody/body });
            }
        } else {
            if (candle.c > candle.o && nextCandle.c < nextCandle.o &&
                nextBody > body * 1.1 && nextCandle.l < candle.l && nextCandle.c < candle.l) {
                obs.push({ type: 'BEAR_OB', high: candle.h, low: candle.l, index: i, strength: nextBody/body });
            }
        }
    }
    return obs;
}

function detectBreakers(data){
    let b=[];const s=findSwings(data,3);
    for(let i=5;i<data.length-5;i++){let c=data[i];
        if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}
        if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}
    }return b;
}

// FIX 3: Zone Validation (Mitigation & Freshness)
function isZoneStillValid(data, zone, direction, maxTouches = 3) {
    const recentData = data.slice(-30);
    let touches = 0, mitigated = false;
    for (let i = 0; i < recentData.length; i++) {
        const c = recentData[i];
        if (direction === 'BUY') {
            if (c.c < zone.low) { mitigated = true; break; }
            if (c.l <= zone.high && c.l >= zone.low) touches++;
        } else {
            if (c.c > zone.high) { mitigated = true; break; }
            if (c.h >= zone.low && c.h <= zone.high) touches++;
        }
    }
    return { valid: !mitigated && touches <= maxTouches, touches, mitigated, freshness: touches === 0 ? 'FRESH' : (touches <= 2 ? 'TESTED' : 'EXPLOITED') };
}

// FIX 4: Proper Entry Triggers (Pin bars, Engulfing)
function checkEntryTrigger(data, zone, direction) {
    if (data.length < 5) return { triggered: false, type: null, strength: 0, entry: 0 };
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const triggers = [];
    const body = Math.abs(last.c - last.o);

    if (direction === 'BUY') {
        const wickDown = Math.min(last.o, last.c) - last.l;
        if (last.l <= zone.high && last.l >= zone.low && wickDown > body * 2.5 && last.c > last.o) {
            triggers.push({ type: 'PIN_BAR', strength: 90, entry: last.h + body * 0.1 });
        }
        if (prev.c < prev.o && last.c > last.o && last.c > prev.h && last.l <= zone.high) {
            triggers.push({ type: 'ENGULFING', strength: 85, entry: last.h + body * 0.1 });
        }
    } else {
        const wickUp = last.h - Math.max(last.o, last.c);
        if (last.h >= zone.low && last.h <= zone.high && wickUp > body * 2.5 && last.c < last.o) {
            triggers.push({ type: 'PIN_BAR', strength: 90, entry: last.l - body * 0.1 });
        }
        if (prev.c > prev.o && last.c < last.o && last.c < prev.l && last.h >= zone.low) {
            triggers.push({ type: 'ENGULFING', strength: 85, entry: last.l - body * 0.1 });
        }
    }
    triggers.sort((a, b) => b.strength - a.strength);
    return triggers.length > 0 ? triggers[0] : { triggered: false, type: null, strength: 0, entry: 0 };
}

function detectMarketStructureShift(data, direction) {
    if (data.length < 20) return { detected: false };
    const swings = findSwings(data, 3);
    const rH = swings.H.slice(-2), rL = swings.L.slice(-2);
    const price = data[data.length-1].c;

    if (direction === 'BUY' && rL.length === 2 && rH.length >= 1) {
        if (rL[0].p < rL[1].p && price > rH[rH.length-1].p) return { detected: true, type: 'BULLISH_MSS' };
    } else if (direction === 'SELL' && rH.length === 2 && rL.length >= 1) {
        if (rH[0].p > rH[1].p && price < rL[rL.length-1].p) return { detected: true, type: 'BEARISH_MSS' };
    }
    return { detected: false };
}

function detectTurtleSoup(data){
    if(data.length<15)return{detected:false,type:null};
    const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);
    const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];
    if(recentLow<keyLow*0.999&&cc>keyLow&&cc>co)return{detected:true,type:'BUY',keyLevel:keyLow};
    const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];
    if(recentHigh>keyHigh*1.001&&cc<keyHigh&&cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh};
    return{detected:false,type:null};
}

function detectDisplacement(data,direction){
    if(data.length<5)return{detected:false};
    const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];
    if(direction==='BUY'&&lb>avg*2.5&&lc[4].c>lc[4].o)return{detected:true};
    if(direction==='SELL'&&lb>avg*2.5&&lc[4].c<lc[4].o)return{detected:true};
    return{detected:false};
}

function isSetupStale(zone, price, direction) {
    const distance = Math.abs(price - zone.p) / price * 100;
    if (distance > 1.5) return { stale: true, reason: 'Price too far from zone' };
    return { stale: false };
}

// ============================================
// SCORING & CONFLUENCE
// ============================================

// FIX 5: Proper HTF Confluence (Trend Alignment, not zone containment)
async function checkHTFConfluenceProper(direction) {
    const htfChecks = { '1D': await getQuoteDirection('1D'), '4H': await getQuoteDirection('4H'), '1H': await getQuoteDirection('1H') };
    const dirStr = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    let aligned = 0, total = 3;
    for (let [tf, trend] of Object.entries(htfChecks)) {
        if (trend === dirStr) aligned++;
        else if (trend !== 'NEUTRAL') total--;
    }
    const confluence = (aligned / total) * 100;
    return { aligned, total, confluence, passed: confluence >= 50, details: htfChecks, penalty: confluence < 50 ? 30 : (confluence < 75 ? 15 : 0) };
}

function score(data,price,twelveIndicators){
    const a=atr(data),cl=data.map(c=>c.c),rs=rsiCalc(cl);
    const fv=detectFVGImproved(data),ms=detectMarketStructureShift(data, 'BUY'),bk=detectBreakers(data);
    const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1];
    const bF=fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);
    const sF=fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);
    let bS=0,sS=0,bR=[],sR=[];
    
    if(ms.detected&&ms.type==='BULLISH_MSS'){bS+=25;bR.push('MSS Bull');}
    else if(ms.detected&&ms.type==='BEARISH_MSS'){sS+=25;sR.push('MSS Bear');}
    if(bF.length){bS+=15;bR.push('Bull FVG');}
    if(sF.length){sS+=15;sR.push('Bear FVG');}
    if(cE20>cE50){bS+=15;bR.push('EMA bull');}else{sS+=15;sR.push('EMA bear');}
    if(rs>50)bS+=10;else sS+=10;
    
    const ind = twelveIndicators || {};
    if (ind.rsi && ind.rsi < 30) { bS += 8; bR.push('RSI oversold'); }
    if (ind.rsi && ind.rsi > 70) { sS += 8; sR.push('RSI overbought'); }
    
    let dir,conf,reason;
    if(bS>sS){dir='BUY';conf=Math.min(bS+10,95);reason=bR.join('; ');}
    else if(sS>bS){dir='SELL';conf=Math.min(sS+10,95);reason=sR.join('; ');}
    else{dir=cE20>cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';}
    return{dir,conf,reason,scores:{bS,sS}};
}

function checkZoneMagnetism(entryData, price, entry, direction) {
    const imbalances = findImbalances(entryData);
    let score = 0;
    if (direction === 'BUY') {
        if (imbalances.filter(i => i.type === 'BULLISH' && i.low > entry && i.high < price).length > 0) score += 40;
    } else {
        if (imbalances.filter(i => i.type === 'BEARISH' && i.low > price && i.high < entry).length > 0) score += 40;
    }
    const closes = entryData.map(c => c.c);const e20 = ema(closes, 20), e50 = ema(closes, 50);
    if ((direction === 'BUY' && e20[e20.length-1] > e50[e50.length-1]) || (direction === 'SELL' && e20[e20.length-1] < e50[e50.length-1])) score += 30;
    if (Math.abs(price - entry) / price * 100 < 0.5) score += 30;
    return { magnetism: score >= 60 ? 'STRONG' : (score >= 35 ? 'MODERATE' : 'WEAK'), score, likelyToReach: score >= 35 };
}

function checkProbability(zone, mtf, magnetism) {
    const checks = [
        { name: 'Confluence (2+)', passed: zone.cc >= 2, critical: true },
        { name: 'MTF aligned (2+)', passed: mtf.strength >= 2, critical: true },
        { name: 'Zone Magnetism', passed: magnetism.likelyToReach, critical: true },
        { name: 'Quality A/B', passed: zone.quality === 'A' || zone.quality === 'B', critical: false }
    ];
    const cp = checks.filter(c => c.critical).every(c => c.passed);
    return { probability: cp ? 'HIGH' : 'LOW', checks };
}

function checkPathClearance(entryData, entry, tp, direction) {
    const swings = findSwings(entryData, 3);
    if (direction === 'BUY') {
        if (swings.H.filter(s => s.p > entry && s.p < tp).length > 0) return { clear: false, obstacles: ['Swing High'] };
    } else {
        if (swings.L.filter(s => s.p < entry && s.p > tp).length > 0) return { clear: false, obstacles: ['Swing Low'] };
    }
    return { clear: true, obstacles: [] };
}

// ============================================
// SL & TP CALCULATIONS
// ============================================
function calcStopLoss(data, dir, entry, zone, msnr, tfUsed, twelveIndicators) {
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const swings = findSwings(data, 4), fvgs = detectFVGImproved(data);
    const s = getMarketSettings(pair);
    const maxSLD = entry * s.maxSLPct;
    const slBuf = getSLBufferForTF(apiATR, tfUsed, pair);
    let c = [];

    if (dir === 'BUY') {
        if (zone && zone.low < entry) c.push({ price: zone.low - slBuf * 0.6, reason: 'Below zone', distance: entry - (zone.low - slBuf * 0.6) });
        swings.L.filter(x => x.p < entry).forEach(x => c.push({ price: x.p - slBuf, reason: 'Below swing', distance: entry - (x.p - slBuf) }));
    } else {
        if (zone && zone.high > entry) c.push({ price: zone.high + slBuf * 0.6, reason: 'Above zone', distance: (zone.high + slBuf * 0.6) - entry });
        swings.H.filter(x => x.p > entry).forEach(x => c.push({ price: x.p + slBuf, reason: 'Above swing', distance: (x.p + slBuf) - entry }));
    }
    
    c = c.filter(x => x.distance > 0 && x.distance <= maxSLD * 1.5).sort((a, b) => a.distance - b.distance);
    if (c.length > 0) return c[0];
    
    const fb = dir === 'BUY' ? entry - Math.max(apiATR * 0.5, s.minSL) : entry + Math.max(apiATR * 0.5, s.minSL);
    return { price: fb, reason: 'Min ATR', distance: Math.abs(entry - fb) };
}

function calcTakeProfits(dir, entry, sl) {
    const risk = Math.abs(entry - sl);
    const rr = getMarketSettings(pair).targetRR;
    if (dir === 'BUY') return { tp1: entry + risk * rr, tp2: entry + risk * (rr + 1), tp3: entry + risk * (rr + 2), rrUsed: rr };
    return { tp1: entry - risk * rr, tp2: entry - risk * (rr + 1), tp3: entry - risk * (rr + 2), rrUsed: rr };
}

// ============================================
// MULTI-ZONE FINDER & MAIN ANALYSIS ENGINE
// ============================================

function findPrecisionEntryZones(data, price, direction, msnr) {
    const zones = [];
    const a = atr(data, 14);
    const fvgs = detectFVGImproved(data);
    const orderBlocks = detectOrderBlocksImproved(data, direction);
    const breakers = detectBreakers(data);
    const swings = findSwings(data, 4);
    const imbalances = findImbalances(data);

    const processZone = (low, high, src, baseScore) => {
        let score = baseScore;
        let confluence = [src];
        if (orderBlocks.find(ob => Math.abs(ob.low - low) < a * 0.3)) { score += 25; confluence.push('OB'); }
        if (breakers.find(b => (direction === 'BUY' ? b.type === 'BULL' : b.type === 'BEAR') && Math.abs(b.p - low) < a * 0.5)) { score += 20; confluence.push('Breaker'); }
        if (swings[direction === 'BUY' ? 'L' : 'H'].find(x => Math.abs(x.p - low) < a * 0.3)) { score += 20; confluence.push('Swing'); }
        if (imbalances.find(i => (direction === 'BUY' ? i.type === 'BULLISH' : i.type === 'BEARISH') && Math.abs((i.low + i.high) / 2 - low) < a * 0.3)) { score += 20; confluence.push('Imbalance'); }
        
        zones.push({
            low, high, p: (low + high) / 2, src, score, confluence: confluence.join('+'), cc: confluence.length,
            quality: score >= 80 ? 'A' : (score >= 60 ? 'B' : 'C'), hasImbalance: confluence.includes('Imbalance')
        });
    };

    if (direction === 'BUY') {
        fvgs.filter(f => f.type === 'bull' && f.high < price).forEach(f => processZone(f.l, f.h, 'FVG', 30));
        orderBlocks.forEach(ob => processZone(ob.low, ob.high, 'OB', 40));
        if (msnr.nearestSupport && msnr.nearestSupport < price) processZone(msnr.nearestSupport - a * 0.1, msnr.nearestSupport + a * 0.1, 'MSNR', 25);
    } else {
        fvgs.filter(f => f.type === 'bear' && f.low > price).forEach(f => processZone(f.l, f.h, 'FVG', 30));
        orderBlocks.forEach(ob => processZone(ob.low, ob.high, 'OB', 40));
        if (msnr.nearestResistance && msnr.nearestResistance > price) processZone(msnr.nearestResistance - a * 0.1, msnr.nearestResistance + a * 0.1, 'MSNR', 25);
    }
    
    return zones.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function analyzeTimeframe(tfToAnalyze, price) {
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        const entryData = await getHistory(entryTF);
        if (!entryData?.length || entryData.length < 30) return null;
        
        const structureData = structureTF !== entryTF ? await getHistory(structureTF) : entryData;
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        
        // 1. Basic scoring
        const sig = score(entryData, price, twelveIndicators);
        
        // 2. MTF Trends
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
        let bullCount = 0, bearCount = 0; const trends = {};
        for (let t of tfs) { let tr = await getQuoteDirection(t); trends[t] = tr; if (tr === 'BULLISH') bullCount++; else if (tr === 'BEARISH') bearCount++; }
        const mtf = { direction: bullCount > bearCount ? 'BULLISH' : (bearCount > bullCount ? 'BEARISH' : 'NEUTRAL'), strength: Math.max(bullCount, bearCount), bullCount, bearCount, trends };
        
        // 3. Direction Logic (HTF Priority + MSS + Turtle Soup)
        let direction = sig.dir;
        const turtleSoup = detectTurtleSoup(entryData);
        const mss = detectMarketStructureShift(entryData, sig.dir);
        
        if (turtleSoup.detected) direction = turtleSoup.type;
        else if (mss.detected) direction = mss.type === 'BULLISH_MSS' ? 'BUY' : 'SELL';
        else if (mtf.strength >= 3) direction = mtf.direction === 'BULLISH' ? 'BUY' : 'SELL';
        
        // 4. HTF Confluence Check for FINAL direction
        const finalHTF = await checkHTFConfluenceProper(direction);
        
        // 5. Zones & Validation
        const msnr = calculateMSNR(structureData || entryData, price);
        const allZones = findPrecisionEntryZones(entryData, price, direction, msnr);
        
        let bestZone = null, bestTrigger = null;
        for (const zone of allZones) {
            const validity = isZoneStillValid(entryData, zone, direction);
            if (!validity.valid) continue;
            const trigger = checkEntryTrigger(entryData, zone, direction);
            if (trigger.triggered && trigger.strength >= 70) { bestZone = { ...zone, validity, trigger }; bestTrigger = trigger; break; }
            if (!bestZone || zone.score > bestZone.score) bestZone = { ...zone, validity, trigger };
        }
        
        if (!bestZone) bestZone = { low: price * 0.998, high: price * 1.002, p: price, src: 'PRICE_ACTION', confluence: 'Fallback', cc: 0, quality: 'C', validity: { valid: true, touches: 0, mitigated: false, freshness: 'CURRENT' }, trigger: { triggered: false } };

        // 6. FIX: Precise Entry Calculation
        let entry, entryReady = false;
        if (bestTrigger?.triggered) {
            entry = bestTrigger.entry;
            entryReady = true;
        } else {
            entry = direction === 'BUY' ? bestZone.low + (bestZone.high - bestZone.low) * 0.4 : bestZone.high - (bestZone.high - bestZone.low) * 0.4;
        }
        
        // Force entry on correct side of price
        if (direction === 'BUY' && entry >= price) entry = price - (price * 0.001);
        if (direction === 'SELL' && entry <= price) entry = price + (price * 0.001);

        const staleCheck = isSetupStale(bestZone, price, direction);
        
        // 7. Final Metrics
        const magnetism = checkZoneMagnetism(entryData, price, entry, direction);
        const probCheck = checkProbability(bestZone, mtf, magnetism);
        const slResult = calcStopLoss(entryData, direction, entry, bestZone, msnr, tfToAnalyze, twelveIndicators);
        const tps = calcTakeProfits(direction, entry, slResult.price);
        const pathCheck = checkPathClearance(entryData, entry, tps.tp1, direction);
        const apiATR = twelveIndicators?.atr_api || atr(entryData, 14);
        
        let finalConfidence = sig.conf - finalHTF.penalty;
        if (staleCheck.stale) finalConfidence -= 20;
        if (!bestTrigger?.triggered) finalConfidence -= 10;

        return {
            timeframe: tfToAnalyze, direction, confidence: Math.max(20, Math.min(95, finalConfidence)),
            entry: +entry.toFixed(getPrec(pair)), sl: +slResult.price.toFixed(getPrec(pair)),
            tp1: +tps.tp1.toFixed(getPrec(pair)), tp2: +tps.tp2.toFixed(getPrec(pair)), tp3: +tps.tp3.toFixed(getPrec(pair)),
            rr: tps.rrUsed, zone: bestZone, entryReady, mtf, htfValidation: finalHTF,
            magnetism, probCheck, slReason: slResult.reason, pathCheck, mss, turtleSoup,
            rsi: rsiCalc(entryData.map(c=>c.c)), atr: apiATR, stale: staleCheck, trigger: bestTrigger, reason: sig.reason
        };
    } catch (e) { console.error('analyzeTimeframe error:', e); return null; }
}

// ============================================
// UI EXECUTION & RENDERING (Completed missing tail)
// ============================================

async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn');
    btn.innerHTML = '⏳ Scanning...'; btn.disabled = true;
    document.getElementById('resultArea').innerHTML = '<div class="loading">📡 Fetching data & calculating precision zones...</div>';
    
    const price = await getPrice();
    if (!price) { showNotif('❌ Failed to get price', 'error'); btn.innerHTML = '🔍 Analyze'; btn.disabled = false; return; }
    
    document.getElementById('currentPrice').innerHTML = `💰 ${price.toFixed(getPrec(pair))}`;
    await updateMTFDisplay();
    
    const results = [];
    for (let tf of ALL_TIMEFRAMES) {
        const res = await analyzeTimeframe(tf, price);
        if (res) results.push(res);
    }
    
    results.sort((a, b) => {
        const wA = TF_WEIGHT[a.timeframe] || 1;
        const wB = TF_WEIGHT[b.timeframe] || 1;
        return (wB * b.confidence) - (wA * a.confidence);
    });
    
    analysis = results[0] || null;
    renderAnalysis(analysis, price);
    btn.innerHTML = '🔍 Analyze'; btn.disabled = false;
}

async function updateMTFDisplay() {
    for (let t of ALL_TIMEFRAMES) {
        let tr = await getQuoteDirection(t);
        let el = document.getElementById(`trend${t}`);
        if (el) { el.innerHTML = tr === 'BULLISH' ? '🟢 Bull' : (tr === 'BEARISH' ? '🔴 Bear' : '⚪ Neut'); el.className = `mtf-trend ${tr.toLowerCase()}`; }
    }
}

function renderAnalysis(res, price) {
    if (!res) { document.getElementById('resultArea').innerHTML = '<div class="error-msg">❌ No valid setups found right now. Wait for structure.</div>'; return; }
    
    const dirColor = res.direction === 'BUY' ? '#00c853' : '#ff1744';
    const dirIcon = res.direction === 'BUY' ? '🚀' : '🔻';
    const triggerStatus = res.trigger?.triggered ? `✅ ${res.trigger.type}` : '⏳ Waiting for Trigger';
    const staleWarn = res.stale?.stale ? `<div class="warn">⚠️ ${res.stale.reason}</div>` : '';
    
    document.getElementById('resultArea').innerHTML = `
        <div class="setup-card" style="border-left: 4px solid ${dirColor}">
            <div class="setup-header">
                <span class="dir-badge" style="background:${dirColor}">${dirIcon} ${res.direction}</span>
                <span class="tf-badge">${res.timeframe}</span>
                <span class="conf-badge">${res.confidence}% Conf</span>
            </div>
            ${staleWarn}
            <div class="setup-grid">
                <div class="field"><span class="label">Entry</span><span class="val entry-val">${res.entry}</span></div>
                <div class="field"><span class="label">Stop Loss</span><span class="val sl-val">${res.sl} (${res.slReason})</span></div>
                <div class="field"><span class="label">TP1 (${res.rr}:1)</span><span class="val tp-val">${res.tp1}</span></div>
                <div class="field"><span class="label">Trigger</span><span class="val">${triggerStatus}</span></div>
            </div>
            <div class="details-box">
                <p><strong>Zone:</strong> ${res.zone.src} | ${res.zone.confluence} | Quality: ${res.zone.quality} | ${res.zone.validity.freshness}</p>
                <p><strong>Probability:</strong> ${res.probCheck.probability} | <strong>Magnetism:</strong> ${res.magnetism.magnetism}</p>
                <p><strong>Logic:</strong> ${res.reason}</p>
            </div>
        </div>
    `;
}

function handleLimit() {
    if (!analysis) { showNotif('⚠️ Run analysis first', 'warning'); return; }
    limitOrder = analysis;
    localStorage.setItem('ict_limit', JSON.stringify(limitOrder));
    document.getElementById('limitStatus').innerHTML = `🟡 Active: ${analysis.direction} @ ${analysis.entry}`;
    document.getElementById('limitStatus').style.display = 'block';
    showNotif('✅ Limit order saved', 'success');
}

function cancelLimit() {
    limitOrder = null;
    localStorage.removeItem('ict_limit');
    document.getElementById('limitStatus').style.display = 'none';
    showNotif('🗑️ Limit order cancelled', 'warning');
}

function loadLimitOrder() {
    const s = localStorage.getItem('ict_limit');
    if (s) {
        limitOrder = JSON.parse(s);
        document.getElementById('limitStatus').innerHTML = `🟡 Active: ${limitOrder.direction} @ ${limitOrder.entry}`;
        document.getElementById('limitStatus').style.display = 'block';
    }
}

function copyJson() {
    if (!analysis) { showNotif('⚠️ No data to copy', 'warning'); return; }
    navigator.clipboard.writeText(JSON.stringify(analysis, null, 2));
    showNotif('📋 JSON copied!', 'success');
}