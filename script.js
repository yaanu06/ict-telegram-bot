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
// ============================================
// TIMEFRAME WEIGHT FOR SORTING
// ============================================
const TF_WEIGHT = { '1D': 5, '4H': 4, '1H': 3, '15M': 2, '5M': 1 };
// ============================================
// TIMEFRAME ALIGNMENT HIERARCHY
// ============================================
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
// ============================================
// MARKET SETTINGS
// ============================================
function getMarketSettings(p) {
if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2, slBuffers: { '5M': 2, '15M': 3, '1H': 5, '4H': 8, '1D': 15 } };
if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.01, targetRR: 4, prec: 2, slBuffers: { '5M': 0.03, '15M': 0.05, '1H': 0.08, '4H': 0.12, '1D': 0.20 } };
if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.005, targetRR: 4, prec: 3, slBuffers: { '5M': 0.08, '15M': 0.12, '1H': 0.20, '4H': 0.35, '1D': 0.60 } };
if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.015, targetRR: 4, prec: 2, slBuffers: { '5M': 30, '15M': 50, '1H': 80, '4H': 120, '1D': 200 } };
return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.005, targetRR: 4, prec: 5, slBuffers: { '5M': 0.0003, '15M': 0.0005, '1H': 0.0008, '4H': 0.0012, '1D': 0.0020 } };
}
function getSLBufferForTF(apiATR, tfUsed) {
const s = getMarketSettings(pair);
const tfBuffer = s.slBuffers[tfUsed] || s.slBuffers['15M'] || 3;
return Math.max(tfBuffer, apiATR * 0.5);
}
// ============================================
// API KEYS MANAGEMENT
// ============================================
async function loadKeys() { const s = localStorage.getItem('ict_bot_keys'); if (s) { try { const k = JSON.parse(s); TWELVE_DATA_KEY = k.twelveData||''; DEEPSEEK_API_KEY = k.deepseek||''; return true; } catch(e) {} } return false; }
async function saveKeys(tk, dk) { localStorage.setItem('ict_bot_keys', JSON.stringify({twelveData:tk, deepseek:dk})); TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; updateKeyStatus(); }
function clearKeys() { localStorage.removeItem('ict_bot_keys'); TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; updateKeyStatus(); showNotif('🗑️ Keys removed','warning'); }
function updateKeyStatus() { const ts=document.getElementById('twelveStatus'),ds=document.getElementById('deepseekStatus'); ts.innerHTML=TWELVE_DATA_KEY?'✅ Active':'❌ Missing'; ts.className='status-badge '+(TWELVE_DATA_KEY?'active':'inactive'); ds.innerHTML=DEEPSEEK_API_KEY?'✅ Active ('+DEEPSEEK_API_KEY.substring(0,5)+'...)':'❌ Missing'; ds.className='status-badge '+(DEEPSEEK_API_KEY?'active':'inactive'); }
function showSetup() { const ex=document.getElementById('setupOverlay'); if(ex)ex.remove(); document.body.insertAdjacentHTML('beforeend', `<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button><div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div></div></div>` ); document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk);document.getElementById('setupOverlay').remove();}); document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';}); document.getElementById('testAiBtn').addEventListener('click',async()=>{const dk=document.getElementById('dsInput').value.trim();if(!dk){document.getElementById('testResult').innerHTML='❌ Enter key first';return;}document.getElementById('testResult').innerHTML='🔄 Testing...';try{const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization': `Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});const d=await r.json();document.getElementById('testResult').innerHTML=d.choices?'✅ AI working!':'❌ Error: '+(d.error?.message||'Unknown');}catch(e){document.getElementById('testResult').innerHTML='❌ Connection failed';}}); document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove()); }
// ============================================
// STATE
// ============================================
let pair='XAU/USD',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null;
// Cached price for rate limiting
let cachedPrice = null;
let priceCacheTime = 0;
const PRICE_CACHE_DURATION = 5000;
document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();});
function init(){updateTime();setInterval(updateTime,1000);document.getElementById('analyzeBtn').addEventListener('click',runAutoScan);document.getElementById('executeBtn').addEventListener('click',handleLimit);document.getElementById('cancelLimitBtn').addEventListener('click',cancelLimit);document.getElementById('copyJsonBtn').addEventListener('click',copyJson);document.getElementById('updateKeysBtn').addEventListener('click',showSetup);document.getElementById('pairSelect').addEventListener('change',e=>pair=e.target.value);document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));loadLimitOrder();}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML= `${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=> `<option value="${x}">${getPairDisplayName(x)}</option>` ).join('');pair=p[cat][0];}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function isGold(p){return p.includes('XAU');}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF', 'NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}
// ============================================
// API - WITH CACHING
// ============================================
async function getPrice() {
const now = Date.now();
if (cachedPrice !== null && (now - priceCacheTime) < PRICE_CACHE_DURATION) {
return cachedPrice;
}
if (!TWELVE_DATA_KEY) return null;
try {
    const r = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);
    const d = await r.json();
    if (d.price) {
        calls++;
        document.getElementById('apiSource').innerHTML = '📡 Live';
        cachedPrice = +d.price;
        priceCacheTime = now;
        return cachedPrice;
    }
} catch(e) {
    console.warn('Price fetch failed, using cached:', e);
    if (cachedPrice !== null) return cachedPrice;
}
return null;
}
async function getQuote(tfStr){
if(!TWELVE_DATA_KEY)return null;
const interval = QUOTE_INTERVAL_MAP[tfStr] || '1day';
try{
const r=await fetch(`${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);
const d=await r.json();
if(d.open && d.close){calls++;return{open:+d.open,close:+d.close,is_market_open:d.is_market_open};}
}catch(e){}
return null;
}

// 🚨 FIX 1: REWRITTEN TO USE EMA CROSS ON CLOSED CANDLES INSTEAD OF UNCLOSED WICKS
async function getQuoteDirection(tfStr) {
    try {
        const data = await getHistory(tfStr);
        if (data && data.length >= 50) {
            return detectTrend(data); // Uses EMA 20/50 cross on fully closed candles
        } else if (data && data.length >= 3) {
            // Fallback to last fully closed candle if not enough data for EMA
            const closedCandle = data[data.length - 2]; 
            if (closedCandle.c > closedCandle.o) return 'BULLISH';
            if (closedCandle.c < closedCandle.o) return 'BEARISH';
        }
    } catch(e) {
        console.warn(`Trend fetch failed for ${tfStr}:`, e);
    }
    return 'NEUTRAL';
}

async function getHistory(tfStr){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch( `${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();}}catch(e){}return null;}
async function getTechnicalIndicators(tfUsed){if(!TWELVE_DATA_KEY)return{};const symbol=encodeURIComponent(SYMBOLS[pair]);const interval=TF_MAP[tfUsed];const ind={};try{const r=await fetch( `${TWELVE_DATA_BASE}/rsi?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.rsi=parseFloat(d.values[0].rsi);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/macd?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.macd=parseFloat(d.values[0].macd);ind.macd_signal=parseFloat(d.values[0].macd_signal);ind.macd_hist=parseFloat(d.values[0].macd_hist);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/adx?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.adx=parseFloat(d.values[0].adx);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/bbands?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.bb_upper=parseFloat(d.values[0].upper_band);ind.bb_middle=parseFloat(d.values[0].middle_band);ind.bb_lower=parseFloat(d.values[0].lower_band);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/stoch?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.stoch_k=parseFloat(d.values[0].slow_k);ind.stoch_d=parseFloat(d.values[0].slow_d);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/cci?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.cci=parseFloat(d.values[0].cci);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/atr?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.atr_api=parseFloat(d.values[0].atr);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/williams?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.williams_r=parseFloat(d.values[0].williams);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/sar?symbol=${symbol}&interval=${interval}&acceleration=0.02&maximum=0.2&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.sar=parseFloat(d.values[0].sar);calls++;}}catch(e){}try{const r=await fetch( `${TWELVE_DATA_BASE}/ichimoku?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}` );const d=await r.json();if(d.values){ind.ichimoku_tenkan=parseFloat(d.values[0].tenkan_sen);ind.ichimoku_kijun=parseFloat(d.values[0].kijun_sen);ind.ichimoku_senkou_a=parseFloat(d.values[0].senkou_span_a);ind.ichimoku_senkou_b=parseFloat(d.values[0].senkou_span_b);calls++;}}catch(e){}return ind;}
// ============================================
// TECHNICALS - ALL ORIGINAL FUNCTIONS (UNCHANGED)
// ============================================
const ema=(p,n)=>{const m=2/(n+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push((p[i]-e[i-1])*m+e[i-1]);return e;};
const rsi=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};
function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){if(d[i-1].h <d[i+1].l &&d[i+1].l-d[i-1].h >d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].l <=d[i+1].l &&d[j].l >=d[i-1].h){m=true;break;}}f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!m});}if(d[i-1].l >d[i+1].h &&d[i-1].l-d[i+1].h >d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].h >=d[i+1].h &&d[j].h <=d[i-1].l){m=true;break;}}f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!m});}}return f;}
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i] <=h[i-j]||h[i] <=h[i+j])iH=false;if(l[i] >=l[i-j]||l[i] >=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP >rH)return{type:'BULL',level:rH};if(cP <rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c >c.o){let r=s.H.find(h=>h.i <i &&h.p <c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c <c.o){let sp=s.L.find(l=>l.i <i &&l.p >c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
// ============================================
// ORDER BLOCK DETECTION
// ============================================
function detectOrderBlocks(data, direction) {
const obs = [ ];
for (let i = 2; i  < data.length - 1; i++) {
if (direction === 'BUY') {
if (data[i].c  < data[i].o  && data[i+1].c  > data[i+1].o  &&
data[i+1].h  > data[i].h  && data[i+1].c  > data[i].h) {
obs.push({ type: 'BULL_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i });
}
} else {
if (data[i].c  > data[i].o  && data[i+1].c  < data[i+1].o  &&
data[i+1].l  < data[i].l  && data[i+1].c  < data[i].l) {
obs.push({ type: 'BEAR_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i });
}
}
}
return obs;
}
// ============================================
// ZONE TOUCH COUNTER
// ============================================
function countZoneTouches(data, zone, direction) {
let touches = 0;
for (let i = data.length - 20; i < data.length; i++) {
if (i < 0) continue;
const c = data[i];
if (direction === 'BUY') {
if (c.l <= zone.high && c.l >= zone.low) touches++;
} else {
if (c.h >= zone.low && c.h <= zone.high) touches++;
}
}
return touches;
}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}
// ============================================
// FIND PD ARRAYS FOR A TIMEFRAME (FVG + OB + BREAKER)
// ============================================
function findPDArrays(data, direction) {
const arrays = [];
const fvgs = detectFVG(data);
const obs = detectOrderBlocks(data, direction);
const breakers = detectBreakers(data);
if (direction === 'BUY') {
    fvgs.filter(f => f.type === 'bull').forEach(f => arrays.push({ low: f.l, high: f.h, src: 'FVG' }));
    obs.forEach(o => arrays.push({ low: o.low, high: o.high, src: 'OB' }));
    breakers.filter(b => b.type === 'BULL').forEach(b => arrays.push({ low: b.p * 0.998, high: b.p * 1.002, src: 'Breaker' }));
} else {
    fvgs.filter(f => f.type === 'bear').forEach(f => arrays.push({ low: f.l, high: f.h, src: 'FVG' }));
    obs.forEach(o => arrays.push({ low: o.low, high: o.high, src: 'OB' }));
    breakers.filter(b => b.type === 'BEAR').forEach(b => arrays.push({ low: b.p * 0.998, high: b.p * 1.002, src: 'Breaker' }));
}
return arrays;
}
function isZoneWithinHTFArray(entryZone, htfArrays) {
for (const arr of htfArrays) {
if (entryZone.low >= arr.low && entryZone.high <= arr.high) return { contained: true, parentArray: arr };
if (entryZone.low <= arr.high && entryZone.high >= arr.low) return { contained: true, parentArray: arr, partial: true };
}
return { contained: false, parentArray: null };
}
function detectDisplacement(data,direction){if(data.length <5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY' &&lb >avg*2.5 &&lc[4].c >lc[4].o)return{detected:true};if(direction==='SELL' &&lb >avg*2.5 &&lc[4].c <lc[4].o)return{detected:true};return{detected:false};}
async function checkSniperRejection(zone,direction,sniperTF){const dSn=await getHistory(sniperTF);if(!dSn||dSn.length <3)return{confirmed:false};const lc=dSn[dSn.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l <=zone.high &&lc.l >=zone.low;if(t &&wick >body*2 &&lc.c >lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h >=zone.low &&lc.h <=zone.high;if(t &&wick >body*2 &&lc.c <lc.o)return{confirmed:true};}return{confirmed:false};}
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct >0.8)return{level:'High - Impulsive',desc:'Large candles'};if(pct >0.4)return{level:'Moderate - Control',desc:'Normal'};return{level:'Low - Consolidation',desc:'Tight ranges'};}
function detectLiquiditySweeps(data,currentPrice){const sweeps=[];const a=atr(data,14);const maxDistance=a*3;const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);for(let i=10;i<data.length-3;i++){const rH=highs.slice(i-5,i);const maxH=Math.max(...rH);if(rH.filter(h=>Math.abs(h-maxH) <=maxH*0.001).length >=2 &&Math.abs(maxH-currentPrice) <=maxDistance){if(data.slice(i,i+4).some(c=>c.h >maxH*1.001) &&closes[i+3] <maxH)sweeps.push({type:'BUY_SIDE',level:maxH,distance:Math.abs(maxH-currentPrice),direction:'BEARISH'});}const rL=lows.slice(i-5,i);const minL=Math.min(...rL);if(rL.filter(l=>Math.abs(l-minL) <=minL*0.001).length >=2 &&Math.abs(minL-currentPrice) <=maxDistance){if(data.slice(i,i+4).some(c=>c.l <minL*0.999) &&closes[i+3] >minL)sweeps.push({type:'SELL_SIDE',level:minL,distance:Math.abs(minL-currentPrice),direction:'BULLISH'});}}return sweeps.sort((a,b)=>a.distance-b.distance);}
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l >data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h <data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}
function detectTurtleSoup(data){if(data.length <15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow <keyLow*0.999 &&cc >keyLow &&cc >co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];if(recentHigh >keyHigh*1.001 &&cc <keyHigh &&cc <co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};}
function detectCRT(data,direction){if(data.length <10)return{detected:false};const lc=data.slice(-5);const ranges=lc.map(c=>c.h-c.l);const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length;const lastRange=ranges[ranges.length-1];const expanding=lastRange >avgRange*1.5;const contracting=lastRange <avgRange*0.5;return{detected:expanding||contracting,pattern:expanding?'Expanding':(contracting?'Contracting':'Neutral'),rangeRatio:(lastRange/avgRange).toFixed(2),signal:expanding?(direction==='BUY'?'Bullish momentum':'Bearish momentum'):(contracting?'Consolidation':'Neutral')};}
function checkPathClearance(entryData,entry,tp,direction){const obstacles=[];const fvgs= detectFVG(entryData);const swings=findSwings(entryData,3);if(direction==='BUY'){const bearFVGs=fvgs.filter(f=>f.type==='bear' &&f.l >entry &&f.l <tp);if(bearFVGs.length >0)obstacles.push('Bearish FVG');const swingHighs=swings.H.filter(s=>s.p >entry &&s.p <tp);if(swingHighs.length >0)obstacles.push('Swing high');}else{const bullFVGs=fvgs.filter(f=>f.type==='bull' &&f.h >tp &&f.h <entry);if(bullFVGs.length >0)obstacles.push('Bullish FVG');const swingLows=swings.L.filter(s=>s.p >tp &&s.p <entry);if(swingLows.length >0)obstacles.push('Swing low');}return{clear:obstacles.length===0,obstacles,count:obstacles.length};}
// ============================================
// ZONE REACTION CHECK - ORIGINAL (UNCHANGED)
// ============================================
function checkZoneReaction(data, zone, direction) {
if (data.length < 3) return { confirmed: false, type: 'none', strength: 'NONE' };
const last = data[data.length - 1];
const prev = data[data.length - 2];
const prev2 = data[data.length - 3];
if (direction === 'BUY') {
    const wickedIntoZone = last.l  <= zone.high  && last.l  >= zone.low;
    const closedAbove = last.c  > zone.high;
    const bullishEngulf = last.c  > last.o  && prev.c  < prev.o  && last.c  > prev.h;
    const bullishPinbar = (last.c - last.l)  > Math.abs(last.c - last.o) * 2  && last.c  > last.o;
    const rejectionInZone = wickedIntoZone  && (closedAbove || bullishPinbar || last.c  > last.o);
    const followThrough = last.c  > prev.c  && prev.c  > prev2.c  && last.c  > last.o;
    
    if (bullishEngulf  && followThrough) return { confirmed: true, type: 'bullish engulf + momentum', strength: 'STRONG' };
    if (bullishEngulf) return { confirmed: true, type: 'bullish engulf', strength: 'STRONG' };
    if (rejectionInZone  && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' };
    if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick' , strength: 'MODERATE' };
    if (last.c  > prev.c  && last.c  > prev2.c  && last.c  > last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' };
    return { confirmed: false, type: 'none', strength: 'NONE' };
} else {
    const wickedIntoZone =  last.h  >= zone.low  && last.h  <= zone.high;
    const closedBelow = last.c  < zone.low;
    const bearishEngulf = last.c  < last.o  && prev.c  > prev.o  && last.c  < prev.l;
    const bearishPinbar = (last.h - last.c)  > Math.abs(last.c - last.o) * 2  && last.c  < last.o;
    const rejectionInZone = wickedIntoZone  && (closedBelow || bearishPinbar || last.c  < last.o);
    const followThrough = last.c  < prev.c  && prev.c  < prev2.c  && last.c  < last.o;
    
    if (bearishEngulf  && followThrough) return { confirmed: true, type: 'bearish engulf + momentum', strength: 'STRONG' };
    if (bearishEngulf) return { confirmed: true, type: 'bearish engulf', strength: 'STRONG' };
    if (rejectionInZone  && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' };
    if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick' , strength: 'MODERATE' };
    if (last.c  < prev.c  && last.c  < prev2.c  && last.c  < last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' };
    return { confirmed: false, type: 'none', strength: 'NONE' };
}
}
// ============================================
// 🚨 FIX 2: ZONE MAGNETISM CHECK - LOGIC INVERSION FIXED
// ============================================
function checkZoneMagnetism(entryData, price, entry, direction) {
const imbalances = findImbalances(entryData);
const sweeps = detectLiquiditySweeps(entryData, price);
let score = 0;
const checks = [];

if (direction === 'BUY') {
    // FIX: For BUY, we want price to drop to entry. Bearish imbalances (gaps down) act as magnets pulling price down.
    const pullingImbalances = imbalances.filter(i => i.type === 'BEARISH' && i.low > entry && i.high < price);
    if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bearish imbalance(s) magnet`}); }
    else { checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'}); }
} else {
    // FIX: For SELL, we want price to rise to entry. Bullish imbalances (gaps up) act as magnets pulling price up.
    const pullingImbalances = imbalances.filter(i => i.type === 'BULLISH' && i.low > price && i.high < entry);
    if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bullish imbalance(s) magnet`}); }
    else { checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'}); }
}

const supportingSweeps = sweeps.filter(s => direction === 'BUY' ? s.direction === 'BULLISH' : s.direction === 'BEARISH');
if (supportingSweeps.length > 0) { score += 25; checks.push({name: 'Sweeps support direction', passed: true, detail: `${supportingSweeps.length} sweep(s)`}); }
else { checks.push({name: 'Sweeps support direction', passed: false, detail: 'No supporting sweeps'}); }

const closes = entryData.map(c => c.c);
const e20 = ema(closes, 20), e50 = ema(closes, 50);
const cE20 = e20[e20.length - 1], cE50 = e50[e50.length - 1], prevE20 = e20[e20.length - 3];
if (direction === 'BUY' && cE20 > cE50 && cE20 > prevE20) { score += 20; checks.push({name: 'EMA momentum aligned', passed: true, detail: 'Bullish momentum'}); }
else if (direction === 'SELL' && cE20 < cE50 && cE20 < prevE20) { score += 20; checks.push({name: 'EMA momentum aligned', passed: true, detail: 'Bearish momentum'}); }
else { checks.push({name: 'EMA momentum aligned', passed: false, detail: 'Not aligned'}); }

const distancePct = Math.abs(price - entry) / price * 100;
if (distancePct < 0.3) { score += 15; checks.push({name: 'Zone proximity', passed: true, detail: `Very close (${distancePct.toFixed(2)}%)`}); }
else if (distancePct < 0.8) { score += 10; checks.push({name: 'Zone proximity', passed: true, detail: `Reachable (${distancePct.toFixed(2)}%)`}); }
else if (distancePct < 2.0) { score += 5; checks.push({name: 'Zone proximity', passed: true, detail: `Extended (${distancePct.toFixed(2)}%)`}); }
else { checks.push({name: 'Zone proximity', passed: false, detail: `Very far (${distancePct.toFixed(2)}%)`}); }

const displacement = detectDisplacement(entryData, direction);
if (displacement.detected) { score += 10; checks.push({name: 'Displacement momentum', passed: true, detail: 'Detected'}); }
else { checks.push({name: 'Displacement momentum', passed: false, detail: 'None'}); }

const magnetism = score >= 60 ? 'STRONG' : (score >= 35 ? 'MODERATE' : 'WEAK');
return { magnetism, score, maxScore: 100, checks, likelyToReach: score >= 35, summary: `Zone magnetism: ${magnetism} (${score}/100)` };
}
// ============================================
// HTF CONFLUENCE CHECK - ORIGINAL (UNCHANGED)
// ============================================
async function checkHTFConfluenceAsync(dailyData, h4Data, entryDirection) {
const dailyDir = await getQuoteDirection('1D');
const h4Dir = await getQuoteDirection('4H');
const entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH';
if (dailyDir === entryDir && h4Dir === entryDir) return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 };
if (dailyDir === entryDir || h4Dir === entryDir) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: 15 };
if (dailyDir === 'NEUTRAL' && h4Dir === 'NEUTRAL') return { level: 'NEUTRAL', daily: dailyDir, h4: h4Dir, penalty: 5 };
return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 30 };
}
// ============================================
// MSNR LEVELS - ORIGINAL (UNCHANGED)
// ============================================
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1 =pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s <currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r >currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}
// ============================================
// PRECISION ENTRY ZONE WITH ORDER BLOCKS - ORIGINAL (UNCHANGED)
// ============================================
function findPrecisionEntry(data,price,direction,msnr){
const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4);
const imbalances=findImbalances(data);
const orderBlocks=detectOrderBlocks(data,direction);
let allZones=[];
if(direction==='BUY'){
    fvgs.filter(f=>f.type==='bull' &&f.l <price &&f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(breakers.find(b=>b.type==='BULL' &&Math.abs(b.p-f.l) <a*0.5)){s+=25;cf.push('Breaker');}if(swings.L.find(x=>Math.abs(x.p-f.l) <a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport &&Math.abs(msnr.nearestSupport-f.l) <f.l*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' &&Math.abs((i.low+i.high)/2-f.l) <f.l*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=75?'A':(s >=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
    
    orderBlocks.forEach(ob=>{let s=35;let cf=['OrderBlock'];if(swings.L.find(x=>Math.abs(x.p-ob.low) <a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport &&Math.abs(msnr.nearestSupport-ob.low) <ob.low*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' &&Math.abs((i.low+i.high)/2-ob.low) <ob.low*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=75?'A':(s >=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
    
    if(msnr.nearestSupport &&msnr.nearestSupport <price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bull' &&Math.abs(f.l-msnr.nearestSupport) <msnr.nearestSupport*0.003)){s+=25;cf.push('FVG');}if(swings.L.find(x=>Math.abs(x.p-msnr.nearestSupport) <msnr.nearestSupport*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BULLISH' &&Math.abs((i.low+i.high)/2-msnr.nearestSupport) <msnr.nearestSupport*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:msnr.nearestSupport*0.998,high:msnr.nearestSupport*1.002,p:msnr.nearestSupport,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=65?'A':(s >=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
} else {
    fvgs.filter(f=>f.type==='bear' &&f.h >price &&f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(breakers.find(b=>b.type==='BEAR' &&Math.abs(b.p-f.h) <a*0.5)){s+=25;cf.push('Breaker');}if(swings.H.find(x=>Math.abs(x.p-f.h) <a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance &&Math.abs(msnr.nearestResistance-f.h) <f.h*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' &&Math.abs((i.low+i.high)/2-f.h) <f.h*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=75?'A':(s >=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
    
    orderBlocks.forEach(ob=>{let s=35;let cf=['OrderBlock'];if(swings.H.find(x=>Math.abs(x.p-ob.high) <a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance &&Math.abs(msnr.nearestResistance-ob.high) <ob.high*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' &&Math.abs((i.low+i.high)/2-ob.high) <ob.high*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=75?'A':(s >=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
    
    if(msnr.nearestResistance &&msnr.nearestResistance >price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bear' &&Math.abs(f.h-msnr.nearestResistance) <msnr.nearestResistance*0.003)){s+=25;cf.push('FVG');}if(swings.H.find(x=>Math.abs(x.p-msnr.nearestResistance) <msnr.nearestResistance*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BEARISH' &&Math.abs((i.low+i.high)/2-msnr.nearestResistance) <msnr.nearestResistance*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:msnr.nearestResistance*0.998,high:msnr.nearestResistance*1.002,p:msnr.nearestResistance,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s >=65?'A':(s >=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
}

allZones.sort((x,y)=>y.score-x.score);

if(allZones.length >0){
    const b=allZones[0];
    return {low:b.low,high:b.high,p:(b.low+b.high)/2,src:b.src,confluence:b.confluence,cc:b.cc,quality:b.quality,hasImbalance:b.hasImbalance};
}

const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
if(direction==='BUY'){
    const low=rL+r*.618,high=rL+r*.79;
    return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};
}  else {
    const low=rH-r*.79,high=rH-r*.618;
    return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};
}
}
// ============================================
// PROBABILITY CHECK - ORIGINAL (UNCHANGED)
// ============================================
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Zone Magnetism',passed:magnetism.likelyToReach,critical:true});checks.push({name:'Imbalance Magnet',passed:zone.hasImbalance,critical:false});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=4?'HIGH':(tp>=3?'MEDIUM':'LOW')):'LOW',checks,totalPassed:tp,passed:cp};}
// ============================================
// 🚨 FIX 3: STOP LOSS - PRIORITIZES MAJOR STRUCTURE OVER MINOR FVGs
// ============================================
function calcStopLoss(data,dir,entry,zone,msnr,tfUsed,twelveIndicators){
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const swings = findSwings(data, 4);
    const fvgs = detectFVG(data);
    const obs = detectOrderBlocks(data, dir);
    const s = getMarketSettings(pair);
    const maxSLD = entry * s.maxSLPct;
    const slBuf = getSLBufferForTF(apiATR, tfUsed);
    
    let c = [];
    
    // Priority System: 3 = Major (Swings/MSNR), 2 = Medium (OBs/Zones), 1 = Minor (FVGs)
    const addCandidate = (price, reason, priority) => {
        const d = dir === 'BUY' ? entry - price : price - entry;
        if (d > 0 && d <= maxSLD * 1.5) {
            c.push({ price, reason, distance: d, priority });
        }
    };

    if(dir === 'BUY'){
        if(msnr && msnr.allSupports) msnr.allSupports.filter(x => x < entry).forEach(x => addCandidate(x - slBuf, 'Below MSNR', 3));
        swings.L.filter(x => x.p < entry).forEach(x => addCandidate(x.p - slBuf, 'Below Swing Low', 3));
        obs.filter(ob => ob.low < entry).forEach(ob => addCandidate(ob.low - slBuf, 'Below Order Block', 2));
        if(zone && zone.low < entry) addCandidate(zone.low - slBuf * 0.8, 'Below Entry Zone', 2);
        fvgs.filter(f => f.type === 'bull' && f.l < entry).forEach(f => addCandidate(f.l - slBuf * 0.5, 'Below FVG', 1));
    } else {
        if(msnr && msnr.allResistances) msnr.allResistances.filter(x => x > entry).forEach(x => addCandidate(x + slBuf, 'Above MSNR', 3));
        swings.H.filter(x => x.p > entry).forEach(x => addCandidate(x.p + slBuf, 'Above Swing High', 3));
        obs.filter(ob => ob.high > entry).forEach(ob => addCandidate(ob.high + slBuf, 'Above Order Block', 2));
        if(zone && zone.high > entry) addCandidate(zone.high + slBuf * 0.8, 'Above Entry Zone', 2);
        fvgs.filter(f => f.type === 'bear' && f.h > entry).forEach(f => addCandidate(f.h + slBuf * 0.5, 'Above FVG', 1));
    }

    // Sort by Priority (descending), then by Safety (lowest price for BUY, highest for SELL)
    c.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return dir === 'BUY' ? a.price - b.price : b.price - a.price;
    });

    if (c.length > 0) {
        const best = c[0];
        return { price: best.price, reason: best.reason, distance: best.distance };
    }
    
    // Fallback
    const fb = dir === 'BUY' ? entry - Math.max(apiATR * 1.5, s.minSL) : entry + Math.max(apiATR * 1.5, s.minSL);
    return { price: fb, reason: 'Min ATR Fallback', distance: Math.abs(entry - fb) };
}
// ============================================
// 🚨 FIX 4: TAKE PROFIT - REALISTIC ICT SCALING (TP1: 1.5R, TP2: 3R, TP3: 5R)
// ============================================
function calcTakeProfits(dir,entry,sl){
    const risk = Math.abs(entry - sl);
    const rr1 = 1.5; 
    const rr2 = 3.0;
    const rr3 = 5.0;
    
    if(dir === 'BUY'){
        return { tp1: entry + risk * rr1, tp2: entry + risk * rr2, tp3: entry + risk * rr3, rrUsed: rr1 };
    } else {
        return { tp1: entry - risk * rr1, tp2: entry - risk * rr2, tp3: entry - risk * rr3, rrUsed: rr1 };
    }
}
// ============================================
// SCORING - ORIGINAL (UNCHANGED)
// ============================================
function score(data,price,twelveIndicators){
const  a=atr(data),cl=data.map(c=>c.c),rs=rsi(cl);
const fv=detectFVG(data),ms=detectMSS(data),bk=detectBreakers(data);
const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1];
const bF=f v.filter(f=>f.type==='bull' &&f.l <price).sort((a,b)=>b.l-a.l);
const sF=fv.filter(f=>f.type==='bear' &&f.h >price).sort((a,b)=>a.h-b.h);
const bB=bk.filter(b=>b.type==='BULL' &&b.p <price);
const sB=bk.filter(b=>b.type==='BEAR' &&b.p >price);
let bS=0,sS=0,bR=[],sR=[];

if(ms?.type==='BULL'){bS+=20;bR.push('MSS Bull');}
else if(ms?.type==='BEAR'){sS+=20;sR.push('MSS Bear');}
if(bF.length){bS+=15;bR.push('Bull FVG');}
if (sF.length){sS+=15;sR.push('Bear FVG');}
if(bB.length){bS+=10;bR.push('Bull breaker');}
if(sB.length){sS+=10;sR.push('Bear breaker');}
if(cE20 >cE50){bS+=15;bR.push('EMA bull');}
else{sS+=15;sR.push('EMA bear');}
if(rs >50)bS+=10;else sS+=10;

const ind = twelveIndicators || {};

if (ind.rsi  && ind.rsi  < 30) { bS += 8; bR.push('RSI oversold'); }
if (ind.rsi  && ind.rsi  > 70) { sS += 8; sR.push('RSI overbought'); }
if (ind.stoch_k  && ind.stoch_d  && ind.stoch_k  < 20  && ind.stoch_d  < 20) { bS += 5; bR.push('Stoch oversold'); }
if (ind.stoch_k  && ind.stoch_d  && ind.stoch_k  > 80  && ind.stoch_d  > 80) { sS += 5; sR.push('Stoch overbought'); }
if (ind.bb_lower  && price  <= ind.bb_lower * 1.002) { bS += 5; bR.push('At BB lower'); }
if (ind.bb_upper  && price  >= ind.bb_upper * 0.998) { sS += 5; sR.push('At BB upper'); }
if (ind.cci  && ind.cci  < -150) { bS += 5; bR.push('CCI oversold'); }
if (ind.cci  && ind.cci  > 150) { sS += 5; sR.push('CCI overbought'); }
if (ind.williams_r  && ind.williams_r  < -80) { bS += 3; bR.push('Williams oversold'); }
if (ind.williams_r  && ind.williams_r  > -20) { sS += 3; sR.push('Williams overbought'); }
if (ind.sar  && price  > ind.sar) { bS += 5; bR.push('SAR bullish'); }
if (ind.sar  && price  < ind.sar) { sS += 5; sR.push('SAR bearish'); }
if (ind.ichimoku_senkou_a  && ind.ichimoku_senkou_b) {
    const cloudTop = Math.max(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b);
    const cloudBot = Math.min(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b); 
    if (price  > cloudTop) { bS += 8; bR.push('Above cloud'); }
    if (price  < cloudBot) { sS += 8; sR.push('Below cloud'); }
}
if (ind.macd_hist  && ind.macd_hist  > 0) { bS += 3; }
if (ind.macd_hist  && ind.macd_hist  < 0) { sS += 3; }

let dir,conf,reason;
if(bS >sS){dir='BUY';conf=Math.min(bS+10,95);reason=bR.join('; ');}
else if(sS >bS){dir='SELL';conf=Math.min(sS+10,95);reason=sR.join('; ');}
else{dir=cE20 >cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';}
return{dir,conf,reason,scores:{bS,sS}};
}
// ============================================
// MULTI-TF DISPLAY - ORIGINAL (UNCHANGED)
// ============================================
async function updateMTFDisplay(){
const tfs=['5M','15M','1H','4H','1D'];
for(let t of tfs){
let tr = await getQuoteDirection(t);
let el=document.getElementById(`trend${t}`);
if(el){el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut');el.className=`mtf-trend ${tr.toLowerCase()}`;}
}
}
// ============================================
// NEW: FIX 1 - PRECISION ENTRY BASED ON WICK STRUCTURE
// ============================================
function calculatePrecisionEntry(candles, zone, direction) {
const last = candles[candles.length - 1];
if (!last) return (zone.low + zone.high) / 2;
if (direction === 'BUY') {
    const wickLow = last.l;
    const wickHigh = Math.max(last.o, last.c);
    const fib50 = wickLow + (wickHigh - wickLow) * 0.5;
    
    if (last.c > last.o && last.c > last.h * 0.7) {
        return Math.min(last.c, zone.high);
    }
    return Math.min(fib50, zone.high);
} else {
    const wickHigh = last.h;
    const wickLow = Math.min(last.o, last.c);
    const fib50 = wickHigh - (wickHigh - wickLow) * 0.5;
    
    if (last.c < last.o && last.c < last.l * 1.3) {
        return Math.max(last.c, zone.low);
    }
    return Math.max(fib50, zone.low);
}
}
// ============================================
// NEW: FIX 2 - ZONE FRESHNESS CHECK
// ============================================
function checkZoneFreshness(data, zone, direction) {
let touches = 0;
let violations = 0;
const lookback = Math.min(50, data.length);
for (let i = data.length - lookback; i  < data.length; i++) {
    if (i  < 0) continue;
    const inZone = data[i].l  <= zone.high  && data[i].h  >= zone.low;
    if (!inZone) continue;
    
    touches++;
    if (direction === 'BUY'  && data[i].c  < zone.low) violations++;
    if (direction === 'SELL'  && data[i].c  > zone.high) violations++;
}

const fresh = touches  <= 2  && violations === 0;
const partiallyUsed = touches  <= 5  && violations  <= 1;
const used = touches  > 5 || violations  > 1;

return { fresh, partiallyUsed, used, touches, violations };
}
// ============================================
// NEW: FIX 3 - HTF PREMIUM/DISCOUNT CHECK
// ============================================
function isHTFPremiumDiscount(htfData, direction) {
if (!htfData || htfData.length < 10) return { inPremiumDiscount: false, value: 'neutral', pct: 0 };
const range = Math.max(...htfData.map(c => c.h)) - Math.min(...htfData.map(c => c.l));
const current = htfData[htfData.length - 1].c;
const low = Math.min(...htfData.map(c => c.l));
const mid = range / 2 + low;

if (direction === 'BUY') {
    const inDiscount = current < mid;
    const discountPct = ((mid - current) / range * 100);
    return { inPremiumDiscount: inDiscount, value: 'discount', pct: Math.max(0, discountPct) };
} else {
    const inPremium = current > mid;
    const premiumPct = ((current - mid) / range * 100);
    return { inPremiumDiscount: inPremium, value: 'premium', pct: Math.max(0, premiumPct) };
}
}
// ============================================
// NEW: FIX 4 - KILLZONE / SESSION DETECTION
// ============================================
function getSession() {
const hour = new Date().getUTCHours();
if (hour >= 8 && hour <= 11) return { session: 'LONDON', multiplier: 1.0, emoji: '🇬🇧' };
if (hour >= 13 && hour <= 16) return { session: 'NEW_YORK', multiplier: 1.0, emoji: '🇺🇸' };
if (hour >= 0 && hour <= 4) return { session: 'ASIA', multiplier: 0.85, emoji: '🌏' };
return { session: 'OFF-HOURS', multiplier: 0.6, emoji: '🌙' };
}
// ============================================
// NEW: FIX 5 - TRUE BREAKER VALIDATION
// ============================================
function validateBreakerBlock(data, level, direction) {
if (data.length < 25) return false;
const moveAway = data.slice(-25).find(c => 
    direction === 'BUY' ? c.c > level * 1.005 : c.c < level * 0.995
);
if (!moveAway) return false;

const recent = data.slice(-5);
const touched = recent.some(c => 
    direction === 'BUY' ? c.l <= level : c.h >= level
);

const last = recent[recent.length - 1];
const rejected = direction === 'BUY' ? last.c > level : last.c < level;

return touched && rejected;
}
// ============================================
// ANALYZE SINGLE TIMEFRAME - MODIFIED TO INCLUDE FIXES
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
try {
const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
const entryData = await getHistory(entryTF);
if (!entryData?.length) return null;
    const structureData = await getHistory(structureTF);
    const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
    const sig = score(entryData, price, twelveIndicators);
    
    const tfs = ['5M', '15M', '1H', '4H', '1D'];
    let bullCount = 0, bearCount = 0;
    const trends = {};
    for (let t of tfs) {
        let tr = await getQuoteDirection(t);
        trends[t] = tr;
        if (tr === 'BULLISH') bullCount++;
        else if (tr === 'BEARISH') bearCount++;
    }
    const mtf = { direction: bullCount  > bearCount ? 'BULLISH' : (bearCount  > bullCount ? 'BEARISH' : 'NEUTRAL'), strength: Math.max(bullCount, bearCount), bullCount, bearCount, trends };
    
    let direction = sig.dir;
    if (mtf.strength  >= 3) direction = mtf.direction === 'BULLISH' ? 'BUY' : 'SELL';
    const turtleSoup = detectTurtleSoup(entryData);
    if (turtleSoup.detected) direction = turtleSoup.type;
    
     const msnr = calculateMSNR(structureData || entryData, price);
    const zone = findPrecisionEntry(entryData, price, direction, msnr);
    const zoneTouches = countZoneTouches(entryData, zone, direction);
    const zoneReaction = checkZoneReaction(entryData, zone, direction);
    
    // NEW: Add zone freshness check
    const freshness = checkZoneFreshness(entryData, zone, direction);
    
    // NEW: Add HTF premium/discount check
    const htfDataForPD = htfData[structureTF] || htfData['1D'];
    const premiumDiscount = isHTFPremiumDiscount(htfDataForPD, direction);
    
    // NEW: Add breaker validation (if breakers were detected)
    const breakersFound = detectBreakers(entryData);
    let breakerValid  = false;
    if (breakersFound.length  > 0) {
        const relevantBreaker = breakersFound.find(b => 
            direction === 'BUY' ? b.type === 'BULL' : b.type === 'BEAR'
        );
        if (relevantBreaker) {
            breakerValid = validateBreakerBlock(entryData, relevantBreaker.p, direction);
        }
    }
    
    // NEW: Get session info
    const session = getSession();
    
    // HTF VALIDATION - ORIGINAL (UNCHANGED)
    let htfValidation = { passed: true, parentArray: null, structureTF: structureTF };
    if (structureTF !== entryTF  && structureData  && structureData.length  >= 20) {
        const structureArrays = findPDArrays(structureData, direction);
        const validation = isZoneWithinHTFArray(zone, structureArrays);
        if (!validation.contained) {
            htfValidation = { passed: false, parentArray: null, structureTF: structureTF };
        } else {
            htfValidation = { passed: true, parentArray: validation.parentArray, structureTF: structureTF };
        }
    }
    
    // ENTRY CALCULATION - MODIFIED TO USE PRECISION ENTRY
    let entry = null;
    let entryReady = false;
     if (zoneReaction.confirmed  && (zoneReaction.strength === 'STRONG' || zoneReaction.strength === 'MODERATE')) {
        entryReady = true;
        // NEW: Use precision entry instead of hardcoded midpoint
         entry = calculatePrecisionEntry(entryData, zone, direction);
    }
    if (!entryReady) {
        entry = (zone.low + zone.high) / 2;
    }
    if (direction === 'BUY'  && entry  >= price) { const nb = msnr.nearestSupport || price * 0.99; entry = Math.min(zone.low, nb, price * 0.995); }
    if (direction === 'SELL'  && entry  <= price) { const na = msnr.nearestResistance || price * 1.01; entry = Math.max(zone.high, na, price * 1.005); }
    
    const magnetism = checkZoneMagnetism(entryData, price, entry, direction);
    const displacement = detectDisplacement(entryData, direction);
    const sniperRej = await checkSniperRejection(zone, direction, sniperTF);
    const probCheck  = checkProbability(zone, mtf, magnetism);
    const slResult = calcStopLoss(entryData, direction, entry, zone, msnr, tfToAnalyze, twelveIndicators);
    const tps = calcTakeProfits (direction, entry, slResult.price);
    const pathCheck = checkPathClearance(entryData, entry, tps.tp1, direction);
    const apiATR = twelveIndicators?.atr_api || atr(entryData, 14);
    const sweeps = detectLiquiditySweeps(entryData, price);
    const imbalances = findImbalances(entryData);
    const mss = detectMSS(entryData);
    const volatility = getVolatilityLevel(apiATR, price);
    const crt = detectCRT(entryData, direction);
    const cl = entryData.map(c => c.c);
    const rs = rsi(cl, 14);
    const fvgsAll = detectFVG(entryData);
    const breakersAll = detectBreakers(entryData);
    const obsAll = detectOrderBlocks(entryData, direction);
    const invalidationPrice = direction === 'BUY' ? zone.low - apiATR * 0.5 : zone.high + apiATR * 0.5;
    
    // 🚨 FIX 5: LIQUIDITY SWEEP REQUIREMENT CHECK
    const hasSweep = sweeps.length > 0 || turtleSoup.detected;
    
    let conf = sig.conf;
    if (mtf.direction === direction)  conf = Math.min(conf + 10, 95); else conf = Math.max(conf - 15, 30);
    if (zone.quality === 'A') conf = Math.min(conf + 15, 98); else if (zone.quality === 'B') conf = Math.min(conf + 8, 95);
    if (displacement.detected) conf = Math.min(conf + 15, 98);
    if (sniperRej.confirmed) conf = Math.min(conf + 10, 98);
    if (probCheck.probability === 'HIGH') conf = Math.min(conf + 5, 98);
    if (turtleSoup.detected) conf = Math.min(conf + 12, 98);
    if (crt.detected  && crt.pattern === 'Expanding') conf = Math.min(conf + 5, 98);
    if (zone.hasImbalance) conf = Math.min(conf + 8, 98);
    if (pathCheck.clear) conf = Math.min(conf + 5, 98);
     if (!zone.hasImbalance) conf = Math.max(conf - 10, 30);
    if (magnetism.magnetism === 'STRONG') conf = Math.min(conf + 10, 98);
    else if (magnetism.magnetism === 'WEAK') conf  = Math.max(conf - 15, 25);
    
    // NEW: Freshness adjustment
    if (!freshness.fresh  && freshness.partiallyUsed) conf = Math.max(conf - 10, 10);
    if (freshness.used) conf = Math.max(conf - 20, 10);
    
    // NEW: Premium/discount adjustment
    if (premiumDiscount.inPremiumDiscount) conf = Math.min(conf + 10, 98);
    else conf = Math.max(conf - 10, 10);
    
    // NEW: Session adjustment
    conf = Math.min(conf * session.multiplier, 98);
    
    // NEW: Breaker validation adjustment
    if (breakerValid) conf = Math.min(conf + 8, 98);
    
    if (htfValidation.passed) {
        conf = Math.min(conf + 15, 98); 
    } else if (structureTF !== entryTF) {
        conf = Math.max(conf - 20, 10);
    }
    
    if (zoneReaction.confirmed  && (zoneReaction.strength === 'STRONG' || zoneReaction.strength === 'MODERATE')) {
        conf = Math.min(conf + 20, 98);
    } else if (!zoneReaction.confirmed) {
        conf = Math.max(conf - 20, 10);
    }
    
    if (zoneTouches  >= 5  && !zoneReaction.confirmed) conf = Math.max(conf - 20, 10);
    if (zoneTouches  >= 2  && zoneReaction.confirmed) conf = Math.min(conf + 10, 98);
    
    if (twelveIndicators.macd_hist  && direction === 'BUY'  && twelveIndicators.macd  > twelveIndicators.macd_signal) conf = Math.min(conf + 5, 98);
    if (twelveIndicators.macd_hist  && direction === 'SELL'  && twelveIndicators.macd  < twelveIndicators.macd_signal) conf = Math.min(conf + 5, 98);
    if (twelveIndicators.adx  && twelveIndicators.adx  > 25) conf = Math.min(conf + 5, 98);
    
    // 🚨 APPLY SWEEP PENALTY/BONUS
    if (!hasSweep) {
        conf = Math.max(conf - 20, 10); // Heavy penalty: ICT setups need a sweep!
    } else {
        conf = Math.min(conf + 10, 98);
    }
    
    const tfAlign = `Trend:${trendTF}→Structure:${structureTF}→Entry:${entryTF}→Sniper:${sniperTF}`;
    
    return {
        timeframe:  tfToAnalyze, trendTF, structureTF, entryTF, sniperTF,
        direction, entry, sl: slResult.price, tp1: tps.tp1, tp2: tps.tp2, tp3: tps.tp3,
        confidence: conf, zone, slResult, displacement, sniperRej,
        probCheck, turtleSoup, mtf, msnr, twelveIndicators, pathCheck, tfAlign,
        sweeps, imbalances, mss, volatility, crt, fvgsAll, breakersAll,  obsAll, rs, apiATR, trends, magnetism,
        zoneReaction, zoneTouches, entryReady, invalidationPrice, rrUsed: tps.rrUsed,
        htfValidation,
        // NEW: Add the new dat a to the result
        freshness: freshness,
        premiumDiscount: premiumDiscount,
        session: session,
        breakerValid: breakerValid,
        hasSweep: hasSweep // Pass to quality scorer
    };
} catch (e) { console.error(`Error ${tfToAnalyze}:`, e); return null; }
}
// ============================================
// 🚨 FIX 6: SETUP QUALITY SCORE - PENALIZES LACK OF SWEEPS
// ============================================
function calculateSetupQuality(result, price) {
let score = 0;
const prec = getPrec(pair);
const risk = Math.abs(result.entry - result.sl);
const riskPct = (risk / price) * 100;
const tfWeights = { '1D': 100, '4H': 80, '1H': 60, '15M': 30, '5M': 10 };
score += tfWeights[result.timeframe] || 0;

score += (result.confidence / 100) * 50;

if (result.zone.quality === 'A') score += 20;
else if (result.zone.quality === 'B') score += 10;

score += Math.min(result.zone.cc * 5, 20);

if (result.htfValidation?.passed) score += 15;

if (result.zoneReaction?.confirmed) {
    if (result.zoneReaction.strength === 'STRONG') score += 15;
    else if (result.zoneReaction.strength === 'MODERATE') score += 8;
}

if (result.magnetism.magnetism === 'STRONG') score += 10;
else if (result.magnetism.magnetism === 'MODERATE') score += 5;

if (result.entryReady) score += 10;

if (riskPct < 0.1) score -= 10;
if (riskPct > 2.0) score -= 10;

if (result.probCheck.probability === 'HIGH') score += 10;
else if (result.probCheck.probability === 'LOW') score -= 10;

if (result.displacement.detected) score += 5;
if (result.crt.detected && result.crt.pattern === 'Expanding') score += 5;
if (result.pathCheck.clear) score += 5;
if (result.turtleSoup.detected) score += 8;

// NEW: Freshness bonus
if (result.freshness?.fresh) score += 15;
else if (result.freshness?.partiallyUsed) score += 5;
else if (result.freshness?.used) score -= 10;

// NEW: Premium/discount bonus
if (result.premiumDiscount?.inPremiumDiscount) score += 10;
else score -= 5;

// NEW: Session bonus
if (result.session?.multiplier >= 0.85) score += 10;
else score -= 10;

// NEW: Breaker validation bonus
if (result.breakerValid) score += 8;

// 🚨 SWEEP REQUIREMENT PENALTY
if (!result.hasSweep) {
    score -= 15; // Penalize traps
} else {
    score += 10;
}

return Math.max(0, Math.min(100, score));
}
// ============================================
// AI - STRICT EXECUTION COACH (UNCHANGED)
// ============================================
async function askAIWithAllResults(allResults, price, htfData) {
if (!DEEPSEEK_API_KEY || allResults.length === 0) return null;
showNotif('🤖 AI strict execution check...', 'info');
let tfSummary = '';
for (const r of allResults) {
    const htfStatus = r.htfValidation ? (r.htfValidation.passed ? 'In HTF' : 'No HTF') : 'N/A';
    tfSummary += `${r.timeframe}: ${r.direction} | Zone: $${r.zone.low.toFixed(2)}-$${r.zone.high.toFixed(2)} | EntryReady: ${r.entryReady ? 'YES' : 'NO'} | React: ${r.zoneReaction?.confirmed ? r.zoneReaction.type : 'None'} | HTF: ${htfStatus} | Touches: ${r.zoneTouches} | Conf:${r.confidence}% | RR:1:${r.rrUsed}\n`;
}

const best = allResults[0];
const prec = getPrec(pair);

const dailyDir = await getQuoteDirection('1D');
const h4Dir = await getQuoteDirection('4H');
const htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction);

const prompt = `You are TheGhostMachine. Decide if we should enter NOW.
PAIR: ${pair} | PRICE: $${price.toFixed(prec)}
HTF: 1D=${dailyDir} 4H=${h4Dir} | Confluence: ${htfConfluence.level}
TOP SETUP (${best.timeframe}):
Direction: ${best.direction} | Zone: $${best.zone.low.toFixed(prec)}-$${best.zone.high.toFixed(prec)} (${best.zone.src} Q:${best.zone.quality})
HTF Validated: ${best.htfValidation ? (best.htfValidation.passed ? 'YES' : 'NO') : 'N/A'}
Entry Ready: ${best.entryReady ? 'YES' : 'NO'} | Reaction: ${best.zoneReaction?.confirmed ? best.zoneReaction.type : 'NONE'}
Entry: $${best.entry.toFixed(prec)} | SL: $${best.sl.toFixed(prec)} | TP1: $${best.tp1.toFixed(prec)} | RR: 1:${best.rrUsed}
RULES: If entryReady is NO, return "wait_for_reaction". If HTF not validated, consider "skip". If CONFLICT, "skip".
Return ONLY JSON with execution_decision.`;
try {
    const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are a strict ICT execution coach. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:1000})});
    const d = await r.json();
    if (d.choices?.[0]) { const m = d.choices[0].message.content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
} catch(e) { console.error('AI fetch:', e); }
return null;
}
// ============================================
// AUTO SCAN - ORIGINAL WITH QUALITY SCORING (UNCHANGED EXCEPT USING NEW SCORE)
// ============================================
async function runAutoScan() {
const btn = document.getElementById('analyzeBtn');
const scanStatus = document.getElementById('scanStatus');
const scanText = document.getElementById('scanText');
const scanFill = document.getElementById('scanProgressFill');
btn.classList.add('loading'); btn.disabled = true;
scanStatus.classList.remove('hidden');

if (!TWELVE_DATA_KEY) { showSetup(); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; }

showNotif('🔍 Scanning for HTF-validated setups...', 'info');

try {
    const price = await getPrice();
    if (!price) throw new  Error('No price');
    
    const mtfTrendsData = {};
    const tfs = ['5M', '15M', '1H', '4H', '1D'];
    for (let t of tfs) {
        mtfTrendsData[t] = await getQuoteDirection(t);
    }
    
    await updateMTFDisplay();
    document.getElementById('currentPrice').innerHTML = `$${price.toFixed(getPrec(pair))}`;
    if (lastPrice) { const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2); const ce = document.getElementById('priceChange'); ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`; ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`; }
    lastPrice = price;
    
    const results = [];
    const timeframesToScan = ['1D', '4H', '1H', '15M', '5M'];
    
    const htfData = {};
    scanText.innerHTML = 'Loading HTF context...';
    const dailyData = await getHistory('1D');
    const h4Data = await getHistory('4H');
    if (dailyData) htfData['1D'] = dailyData;
    if (h4Data) htfData['4H'] = h4Data;
    
    for (let i = 0; i < timeframesToScan.length; i++) {
        const tfScan = timeframesToScan[i];
        scanText.innerHTML = `Scanning ${tfScan}... (${i + 1}/${timeframesToScan.length})`;
        scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%';
        
        const result = await analyzeTimeframe(tfScan, price, htfData);
        if (result) results.push(result);
    }
    
    if (results.length === 0) {
        showNotif('⚠️ No valid setups found', 'warning');
        document.getElementById('jsonOutput').innerHTML = JSON.stringify({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_SETUP',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}, null, 2);
        btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden') ; return;
    }
    
    // Calculate quality score for ALL results (using updated scoring)
    for (let result of results) {
        result.qualityScore = calculateSetupQuality(result, price);
    }
    
    const higherTimeframes = ['1D', '4H', '1H'];
    const lowerTimeframes = ['15M', '5M'];
    
    const higherResults = results.filter(r => higherTimeframes.includes(r.timeframe));
    const lowerResults = results.filter(r => lowerTimeframes.includes(r.timeframe));
    
    let best = null;
    let isLowerTF = false;
    
    if (higherResults.length > 0) {
        higherResults.sort((a, b) => b.qualityScore - a.qualityScore);
        best = higherResults[0];
        isLowerTF = false;
        showNotif(`✅ ${best.timeframe} setup found - Quality: ${best.qualityScore}%` , 'success');
    } else if (lowerResults.length > 0) {
        const filteredLower = lowerResults.filter(r => r.qualityScore  > 40);
        if (filteredLower.length > 0) {
            filteredLower.sort((a, b) => b.qualityScore - a.qualityScore);
            best = filteredLower[0];
            isLowerTF = true;
            best.confidence = Math.max(best.confidence - 30, 20);
             showNotif(`⚠️ ONLY LOWER TF SETUP (${best.timeframe}) - Quality: ${best.qualityScore}% - REDUCED CONFIDENCE`, 'warning');
        } else {
            showNotif('⚠️ Lower timeframe setups found but quality too low (<40%)', 'warning');
            document.getElementById('jsonOutput').innerHTML = JSON.stringify({
                auto_scan_result: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair,
                    current_price: price,
                     status: 'LOW_QUALITY_SETUPS_ONLY',
                    message: 'Only low quality lower timeframe setups found. Not tradable.',
                    multi_timeframe_trends:  mtfTrendsData,
                    lower_setups_found: lowerResults.length,
                    best_quality: Math.max(...lowerResults.map(r => r.qualityScore))
                }
            }, null, 2);
            analysis = null;
            document.getElementById('executeBtn').disabled = true;
            btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden');
            return;
        }
    } else {
        showNotif('⚠️ No valid setups found', 'warning') ;
        document.getElementById('jsonOutput').innerHTML = JSON.stringify({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_SETUP',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}, null, 2);
        btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return;
    }
    
    scanText.innerHTML = '🤖 AI strict execution decision...';
    const aiResult = await  askAIWithAllResults(results, price, htfData);
    scanStatus.classList.add('hidden');
    
    const prec = getPrec(pair);
    const risk = Math.abs(best.entry - best.sl);
    const rr = best.rrUsed || 4;
    const rrDisplay = (Math.abs(best.tp1 - best.entry) / risk).toFixed(1);
    const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
    
    const htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction);
    best.confidence = Math.max(best.confidence - htfConfluence.penalty, 10);
    
    let aiConviction = 'MEDIUM', aiApproved = true, aiConfAdj = 0, executionDecision = best.entryReady ? 'enter_now' : 'wait_for_reaction', waitCondition = 'Wait for engulf/pinbar at zone',  aiInvalidation = best.invalidationPrice;
    let finalEntry = best.entry, finalZoneLow = best.zone.low, finalZoneHigh = best.zone.high;
    let aiEntryLogic = '', aiSlLogic = '', aiKeyReason = '', aiRiskWarning = '', aiOutcomes = [];
    
    if (aiResult && aiResult.trade_signal_Theghostmachine) {
        const ts = aiResult.trade_signal_Theghostmachine;
        aiApproved = ts.approved !== false;
        aiConfAdj = ts.confidence_adjustment || 0;
        executionDecision = ts.execution_decision || executionDecision;
        waitCondition = ts.wait_condition || waitCondition;
        if (ts.invalidation_price) aiInvalidation = ts.invalidation_price;
        
        if (executionDecision === 'enter_now') aiConviction = 'HIGH';
        else if (executionDecision === 'wait_for_reaction') aiConviction = 'WAIT';
        else aiConviction = 'SKIP';
        
        if (ts.entry_refinement && ts.entry_refinement.low && ts.entry_refinement.high) {
            finalZoneLow = ts.entry_refinement.low;
            finalZoneHigh = ts.entry_refinement.high;
            finalEntry = (finalZoneLow + finalZoneHigh) / 2;
        }
        
        aiEntryLogic = ts.analysis?.entry_logic || '';
        aiSlLogic = ts.analysis?.sl_logic || '';
        aiKeyReason = ts.analysis?.key_reason || '';
        aiRiskWarning = ts.analysis?.risk_warning || '';
        aiOutcomes = ts.analysis?.possible_outcomes || [];
        
        if (aiApproved) best.confidence =  Math.min(Math.max(best.confidence + aiConfAdj, 10), 98);
        else best.confidence = Math.max(best.confidence - 25, 5);
    }
    
    // Get session info for display
    const  session = getSession();
    
    const out = {
        auto_scan_result: {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toISOString().split('T')[1].split('.')[0],
            pair, current_price: price,
            multi_timeframe_trends: mtfTrendsData,
            best_timeframe: best.timeframe,
            quality_score: best.qualityScore,
            total_setups_found: results.length,
            higher_timeframe_setups_found: higherResults.length,
            lower_timeframe_setups_available: lowerResults.length,
            is_lower_timeframe_signal: isLowerTF,
            signal_quality: isLowerTF ? 'LOWER_TF_ONLY_REDUCED_CONFIDENCE' : 'HIGHER_TF_TRADABLE',
             // NEW: Session info
            session: session.session,
            session_emoji: session.emoji,
            session_multiplier: session.multiplier,
            // NEW:  Premium/Discount info
            premium_discount: best.premiumDiscount,
            // NEW: Freshness info
            zone_freshness: best.freshness,
            // NEW: Breaker  validation
            breaker_validated: best.breakerValid,
            ai_verified: !!aiResult,
            ai_approved: aiApproved,
            execution_decision: executionDecision,
            wait_condition: waitCondition || null,
            htf_confluence: htfConfluence,
            trade_signal: {
                trade_type: best.direction === 'BUY' ? 'BUY-LIMIT' : 'SELL-LIMIT',
                entry_price: finalEntry,
                entry_zone: { low: finalZoneLow, high: finalZoneHigh },
                entry_ready: best.entryReady,
                zone_touches: best.zoneTouches,
                htf_validated: best.htfValidation ? best.htfValidation.passed : null,
                htf_parent_structure: best.htfValidation?.parentArray ? `${best.htfValidation.parentArray.src} @ ${best.htfValidation.structureTF}` : null,
                stop_loss: best.sl,
                sl_reason: best.slResult.reason,
                invalidation_price: aiInvalidation,
                risk_amount: risk.toFixed(prec),
                stop_loss_pct: ((risk / best.entry) *  100).toFixed(2) + '%',
                take_profit_1: best.tp1,
                take_profit_2: best.tp2,
                take_profit_3: best.tp3,
                risk_reward: '1:' + rrDisplay,
                dynamic_rr: '1:' + rr,
                confidence: best.confidence,
                conviction: aiConviction,
                entry_source: aiResult ?  'AI-Refined' : 'Rule-Based',
                ai_used: !!aiResult,
                ai_risk_warning: aiRiskWarning || null,
                entry_reasoning: aiEntryLogic || `${best.zone.src} zone with ${best.zone.confluence}`,
                sl_reasoning: aiSlLogic || best.slResult.reason,
                key_reason: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}]`,
                possible_outcomes: aiOutcomes.length > 0 ? aiOutcomes : [`Enter at zone after reaction`, `Sweep then reverse`, `SL hit invalidates`],
                zone_quality: best.zone.quality,
                zone_source: best.zone.src,
                zone_confluence: best.zone.confluence,
                confluence_count: best.zone.cc,
                imbalance_magnet: best.zone.hasImbalance,
                 zone_reaction: best.zoneReaction,
                zone_magnetism: {
                    strength: best.magnetism.magnetism,
                    score: best.magnetism.score,
                     summary: best.magnetism.summary,
                    checks: best.magnetism.checks
                },
                path_clearance: { clear: best.pathCheck.clear, obstacles: best.pathCheck.obstacles },
                probability: best.probCheck.probability,
                timeframe_alignment: {
                    trend_tf: best.trendTF, structure_tf: best.structureTF, entry_tf: best.entryTF, sniper_tf: best.sniperTF,
                    alignment: best.tfAlign,
                    trend_direction: best.mtf.direction, trend_strength: best.mtf.strength + '/5 TFs',
                    sniper_confirmation: best.sniperRej.confirmed ? '✅ Confirmed' : '⚠️ No rejection',
                    htf_confluence: htfConfluence
                },
                turtle_soup: best.turtleSoup,
                crt_analysis: best.crt,
                order_blocks_found: best.obsAll  ? best.obsAll.length : 0,
                twelve_data_indicators: best.twelveIndicators,
                msnr_levels: {
                    pivot: best.msnr.pivot.toFixed(prec),
                     supports: { S1: best.msnr.supports.S1?.toFixed(prec), S2: best.msnr.supports.S2?.toFixed(prec), S3: best.msnr.supports.S3?.toFixed(prec) },
                    resistances: { R1: best.msnr.resistances.R1?.toFixed(prec), R2: best.msnr.resistances.R2?.toFixed(prec), R3: best.msnr.resistances.R3?.toFixed(prec) }
                },
                 sweeps: best.sweeps.filter(s => s.distance < best.apiATR * 2).map(s => ({ type: s.type, level: s.level, distance: s.distance })),
                analysis: {
                    trend_detection: `${best.mtf.direction} (${best.mtf.strength}/5 TFs)${best.mtf.strength >= 3 ? ' - STRONG' : ''}`,
                    volatility_level: `${best.volatility.level} - ${best.volatility.desc}`,
                    market_structure: { mss: best.mss ? best.mss.type : 'None', displacement: best.displacement.detected, sniper_rejection: best.sniperRej.confirmed, turtle_soup: best.turtleSoup.detected, crt_pattern: best.crt.pattern, zone_reaction: best.zoneReaction, zone_touches: best.zoneTouches, entry_ready: best.entryReady, htf_validated: best.htfValidation?.passed || false, imbalance_magnet: best.zone.hasImbalance, zone_magnetism: best.magnetism.magnetism, htf_confluence: htfConfluence.level, zone_freshness: best.freshness, premium_discount: best.premiumDiscount, session: best.session, breaker_validated: best.breakerValid },
                    indicator_confluence: { macd: best.twelveIndicators.macd ? `${best.twelveIndicators.macd > best.twelveIndicators.macd_signal ? 'Bullish' : 'Bearish'}` : 'N/A', adx: best.twelveIndicators.adx ? `${best.twelveIndicators.adx > 25 ? 'Trending' : 'Ranging'} (RR:1:${rr})` : 'N/A', stochastic: best.twelveIndicators.stoch_k ? `K:${best.twelveIndicators.stoch_k} D:${best.twelveIndicators.stoch_d}` : 'N/A', cci: best.twelveIndicators.cci || 'N/A', williams_r: best.twelveIndicators.williams_r || 'N/A', sar: best.twelveIndicators.sar ? `$${best.twelveIndicators.sar}` : 'N/A', ichimoku: best.twelveIndicators.ichimoku_tenkan ? `TK:${best.twelveIndicators.ichimoku_tenkan}/${best.twelveIndicators.ichimoku_kijun}` : 'N/A' },
                    technical_indicators: [`RSI: ${best.twelveIndicators.rsi || best.rs.toFixed(1)}`, `MACD: ${best.twelveIndicators.macd || 'N/A'}`, `ADX: ${best.twelveIndicators.adx || 'N/A'}`, `ATR(API): ${best.twelveIndicators.atr_api?.toFixed(prec) || best.apiATR.toFixed(prec)}`, `BB: ${best.twelveIndicators.bb_upper || 'N/A'}/${best.twelveIndicators.bb_lower || 'N/A'}`, `FVG: ${best.fvgsAll.length} (${best.fvgsAll.filter(f => f.fresh).length} fresh)`, `OB: ${best.obsAll ? best.obsAll.length : 0}`],
                    reasoning: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}] | HTF:${best.htfValidation?.passed ? 'YES' : 'NO'} | Magnet:${best.magnetism.magnetism} | Confluence:${htfConfluence.level} | EntryReady:${best.entryReady ? 'YES' : 'NO'} | React:${best.zoneReaction?.type || 'None'} | Touch#${best.zoneTouches} | ${best.session?.emoji || ''}${best.session?.session || ''}`
                }
            }
        }
    };
    
    document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);
    analysis = { signalType: st, idealEntry: finalEntry, currentPrice: price, stopLoss: best.sl, takeProfit1: best.tp1, takeProfit2: best.tp2, takeProfit3: best.tp3, confidence: best.confidence, entryZoneLow: finalZoneLow, entryZoneHigh: finalZoneHigh, entryReady: best.entryReady, executionDecision, invalidationPrice: aiInvalidation };
    document.getElementById('executeBtn').disabled = false;
    
    const magLabel = best.magnetism.magnetism === 'STRONG' ?  '🧲' : (best.magnetism.magnetism === 'MODERATE' ? '🔗' : '⚠️');
    const aiLabel = aiResult ? (aiApproved ? '🤖✅' : '🤖❌') : '';
    const htfLabel = htfConfluence.level === 'FULL' ? '💪' : (htfConfluence.level === 'CONFLICT' ? '⚠️' : '');
    const htfValLabel = best.htfValidation?.passed ? '🏗️' : '';
    const execLabel = executionDecision === 'enter_now' ? '🟢ENTER' : (executionDecision === 'wait_for_reaction' ? '🟡WAIT' : '🔴SKIP');
    const tfWarning = isLowerTF ? '⚠️LOWER TF ONLY⚠️ ' : '✅HIGHER TF✅ ';
    const sessionLabel =  `${best.session?.emoji || ''}${best.session?.session || ''}`;
    const freshnessLabel = best.freshness?.fresh ? '🆕' : (best.freshness?.partiallyUsed ? '📌' : '🔴');
    showNotif(`${tfWarning}${aiLabel}${magLabel}${htfLabel}${htfValLabel}${freshnessLabel} ${sessionLabel} ${execLabel} ${best.timeframe} ${st} ${best.confidence}% | Quality:${best.qualityScore}% | 1:${rrDisplay}`, 'success');
    
} catch (e) { console.error(e); showNotif('Error: ' + e.message, 'error'); scanStatus.classList.add('hidden'); }
finally { btn.classList.remove('loading'); btn.disabled = false; }
}
// ============================================
// LIMIT ORDERS - ORIGINAL (UNCHANGED)
// ============================================
function loadLimitOrder(){const s=localStorage.getItem('limitOrder');if(s){try{limitOrder=JSON.parse(s);updateLimitUI();startMonitor();}catch(e){}}}
function saveLimit(o){limitOrder=o;localStorage.setItem('limitOrder',JSON.stringify(o));updateLimitUI();}
function clearLimit(){limitOrder=null;localStorage.removeItem('limitOrder');if(priceTimer)clearInterval(priceTimer);updateLimitUI();}
function cancelLimit(){clearLimit();showNotif('❌ Cancelled','warning');}
function updateLimitUI(){const t=document.getElementById('limitOrderText'),c=document.getElementById('cancelLimitBtn');if(limitOrder){const prec=getPrec(pair);t.innerHTML= `⏳ ${limitOrder.signalType} LIMIT @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}` ;t.className='active';c.classList.remove('hidden');document.getElementById('executeBtn').innerHTML='⏳ Waiting...';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)';}else{t.innerHTML='No active limit order';t.className='';c.classList.add('hidden');document.getElementById('executeBtn').innerHTML='⚡ Place Limit Order';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)';}}
function startMonitor(){if(priceTimer)clearInterval(priceTimer);priceTimer=setInterval(async()=>{if(!limitOrder){clearInterval(priceTimer);return;}const p=await getPrice();if(!p)return;const prec=getPrec(pair);document.getElementById('currentPrice').innerHTML= `$${p.toFixed(prec)}` ;if((limitOrder.signalType==='LONG' &&p <=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT' &&p >=limitOrder.idealEntry)){clearLimit();showNotif( `✅ FILLED! ${limitOrder.signalType} @ $${p.toFixed(prec)}` ,'success');try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){}}},2000);}
function handleLimit(){if(!analysis||analysis.signalType ==='NEUTRAL'){showNotif('No signal','error');return;}if(limitOrder){cancelLimit();return;}const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry, stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,entryZoneLow:analysis.entryZoneLow,entryZoneHigh:analysis.entryZoneHigh,entryReady:analysis.entryReady,executionDecision:analysis.executionDecision,invalidationPrice:analysis.invalidationPrice,createdAt: new Date().toISOString()};saveLimit(o);startMonitor();showNotif( `📝 Limit @ $${o.idealEntry.toFixed(getPrec(pair))}` ,'info');}
function copyJson(){const t=document.getElementById('jsonOutput').innerHTML;if(t.includes('Click')){showNotif('Run analysis first','warning');return;}navigator.clipboard.writeText(t).then(()=>showNotif('📋 Copied!','success')).catch(()=>showNotif('Failed','error'));}
function showNotif(m,t){const n=document.getElementById('notification');n.innerHTML=m;n.className= `notification ${t}` ;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3000);}
