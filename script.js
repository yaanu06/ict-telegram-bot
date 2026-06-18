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

// FIX: Added currentPair parameter to fix scope bug where 'pair' was undefined
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
function updateKeyStatus() { const ts=document.getElementById('twelveStatus'),ds=document.getElementById('deepseekStatus'); if(ts){ts.innerHTML=TWELVE_DATA_KEY?'✅ Active':'❌ Missing'; ts.className='status-badge '+(TWELVE_DATA_KEY?'active':'inactive');} if(ds){ds.innerHTML=DEEPSEEK_API_KEY?'✅ Active ('+DEEPSEEK_API_KEY.substring(0,5)+'...)':'❌ Missing'; ds.className='status-badge '+(DEEPSEEK_API_KEY?'active':'inactive');} }
function showSetup() { const ex=document.getElementById('setupOverlay'); if(ex)ex.remove(); document.body.insertAdjacentHTML('beforeend',`<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button><div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div></div></div>`); document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk);document.getElementById('setupOverlay').remove();}); document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';}); document.getElementById('testAiBtn').addEventListener('click',async()=>{const dk=document.getElementById('dsInput').value.trim();if(!dk){document.getElementById('testResult').innerHTML='❌ Enter key first';return;}document.getElementById('testResult').innerHTML='🔄 Testing...';try{const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});const d=await r.json();document.getElementById('testResult').innerHTML=d.choices?'✅ AI working!':'❌ Error: '+(d.error?.message||'Unknown');}catch(e){document.getElementById('testResult').innerHTML='❌ Connection failed';}}); document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove()); }

// ============================================
// STATE
// ============================================
let pair='XAU/USD',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null;
let cachedPrice = null;
let priceCacheTime = 0;
const PRICE_CACHE_DURATION = 5000; // 5 seconds

function showNotif(msg, type='info') {
    const n = document.getElementById('notif');
    if(!n) return;
    n.innerHTML = msg;
    n.className = 'notification ' + type;
    n.style.display = 'block';
    setTimeout(() => n.style.display = 'none', 3000);
}

document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY&&!DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();});
function init(){updateTime();setInterval(updateTime,1000);document.getElementById('analyzeBtn').addEventListener('click',runAutoScan);document.getElementById('executeBtn').addEventListener('click',handleLimit);document.getElementById('cancelLimitBtn').addEventListener('click',cancelLimit);document.getElementById('copyJsonBtn').addEventListener('click',copyJson);document.getElementById('updateKeysBtn').addEventListener('click',showSetup);document.getElementById('pairSelect').addEventListener('change',e=>pair=e.target.value);document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));loadLimitOrder();}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML=`${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function isGold(p){return p.includes('XAU');}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

// ============================================
// API - FIXED WITH CACHING
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

async function getQuoteDirection(tfStr) {
    if (tfStr === '1D') {
        try {
            const r = await fetch(`${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=1day&apikey=${TWELVE_DATA_KEY}`);
            const d = await r.json();
            if (d.close && d.open) {
                if (d.close > d.open) return 'BULLISH';
                if (d.close < d.open) return 'BEARISH';
                return 'NEUTRAL';
            }
        } catch(e) {}
    }
    
    try {
        const data = await getHistory(tfStr);
        if (data && data.length >= 1) {
            const latestCandle = data[data.length - 1];
            const currentPrice = await getPrice();
            
            if (currentPrice && latestCandle.o) {
                if (currentPrice > latestCandle.o) return 'BULLISH';
                if (currentPrice < latestCandle.o) return 'BEARISH';
            }
            
            if (latestCandle.c > latestCandle.o) return 'BULLISH';
            if (latestCandle.c < latestCandle.o) return 'BEARISH';
        }
    } catch(e) {}
    
    return 'NEUTRAL';
}

async function getHistory(tfStr){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();}}catch(e){}return null;}

async function getTechnicalIndicators(tfUsed){if(!TWELVE_DATA_KEY)return{};const symbol=encodeURIComponent(SYMBOLS[pair]);const interval=TF_MAP[tfUsed];const ind={};try{const r=await fetch(`${TWELVE_DATA_BASE}/rsi?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.rsi=parseFloat(d.values[0].rsi);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/macd?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.macd=parseFloat(d.values[0].macd);ind.macd_signal=parseFloat(d.values[0].macd_signal);ind.macd_hist=parseFloat(d.values[0].macd_hist);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/adx?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.adx=parseFloat(d.values[0].adx);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/bbands?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.bb_upper=parseFloat(d.values[0].upper_band);ind.bb_middle=parseFloat(d.values[0].middle_band);ind.bb_lower=parseFloat(d.values[0].lower_band);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/stoch?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.stoch_k=parseFloat(d.values[0].slow_k);ind.stoch_d=parseFloat(d.values[0].slow_d);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/cci?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.cci=parseFloat(d.values[0].cci);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/atr?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.atr_api=parseFloat(d.values[0].atr);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/williams?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.williams_r=parseFloat(d.values[0].williams);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/sar?symbol=${symbol}&interval=${interval}&acceleration=0.02&maximum=0.2&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.sar=parseFloat(d.values[0].sar);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/ichimoku?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.ichimoku_tenkan=parseFloat(d.values[0].tenkan_sen);ind.ichimoku_kijun=parseFloat(d.values[0].kijun_sen);ind.ichimoku_senkou_a=parseFloat(d.values[0].senkou_span_a);ind.ichimoku_senkou_b=parseFloat(d.values[0].senkou_span_b);calls++;}}catch(e){}return ind;}

// ============================================
// TECHNICALS
// ============================================
const ema=(p,n)=>{const m=2/(n+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push((p[i]-e[i-1])*m+e[i-1]);return e;};
const rsiCalc=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};

// FIX 1: Dynamic FVG Threshold based on ATR
function detectFVG(d){
    if(d.length < 3) return [];
    const atrVal = atr(d, 14);
    const fvgThreshold = atrVal * 0.3; // 30% of ATR instead of hardcoded 0.0005
    let f=[];
    for(let i=1;i<d.length-1;i++){
        const gap = d[i+1].l - d[i-1].h;
        if(d[i-1].h<d[i+1].l && gap>fvgThreshold){
            let m=false;for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){m=true;break;}}
            f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!m});
        }
        const gapBear = d[i-1].l - d[i+1].h;
        if(d[i-1].l>d[i+1].h && gapBear>fvgThreshold){
            let m=false;for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){m=true;break;}}
            f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!m});
        }
    }
    return f;
}

function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}

// FIX 2: Strict Order Blocks requiring displacement
function detectOrderBlocks(data, direction) {
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
                obs.push({ type: 'BULL_OB', high: candle.h, low: candle.l, close: candle.c, open: candle.o, index: i, strength: nextBody/body });
            }
        } else {
            if (candle.c > candle.o && nextCandle.c < nextCandle.o && 
                nextBody > body * 1.1 && nextCandle.l < candle.l && nextCandle.c < candle.l) {
                obs.push({ type: 'BEAR_OB', high: candle.h, low: candle.l, close: candle.c, open: candle.o, index: i, strength: nextBody/body });
            }
        }
    }
    return obs;
}

function countZoneTouches(data, zone, direction) {
    let touches = 0;
    for (let i = data.length - 20; i < data.length; i++) {
        if (i < 0) continue;
        const c = data[i];
        if (direction === 'BUY') { if (c.l <= zone.high && c.l >= zone.low) touches++; }
        else { if (c.h >= zone.low && c.h <= zone.high) touches++; }
    }
    return touches;
}

function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}

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

function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY'&&lb>avg*2.5&&lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL'&&lb>avg*2.5&&lc[4].c<lc[4].o)return{detected:true};return{detected:false};}

async function checkSniperRejection(zone,direction,sniperTF){const dSn=await getHistory(sniperTF);if(!dSn||dSn.length<3)return{confirmed:false};const lc=dSn[dSn.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.high&&lc.l>=zone.low;if(t&&wick>body*2&&lc.c>lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.low&&lc.h<=zone.high;if(t&&wick>body*2&&lc.c<lc.o)return{confirmed:true};}return{confirmed:false};}

function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal'};return{level:'Low - Consolidation',desc:'Tight ranges'};}

function detectLiquiditySweeps(data,currentPrice){const sweeps=[];const a=atr(data,14);const maxDistance=a*3;const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);for(let i=10;i<data.length-3;i++){const rH=highs.slice(i-5,i);const maxH=Math.max(...rH);if(rH.filter(h=>Math.abs(h-maxH)<=maxH*0.001).length>=2&&Math.abs(maxH-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.h>maxH*1.001)&&closes[i+3]<maxH)sweeps.push({type:'BUY_SIDE',level:maxH,distance:Math.abs(maxH-currentPrice),direction:'BEARISH'});}const rL=lows.slice(i-5,i);const minL=Math.min(...rL);if(rL.filter(l=>Math.abs(l-minL)<=minL*0.001).length>=2&&Math.abs(minL-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.l<minL*0.999)&&closes[i+3]>minL)sweeps.push({type:'SELL_SIDE',level:minL,distance:Math.abs(minL-currentPrice),direction:'BULLISH'});}}return sweeps.sort((a,b)=>a.distance-b.distance);}

function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}

function detectTurtleSoup(data){if(data.length<15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow<keyLow*0.999&&cc>keyLow&&cc>co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];if(recentHigh>keyHigh*1.001&&cc<keyHigh&&cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};}

function detectCRT(data,direction){if(data.length<10)return{detected:false};const lc=data.slice(-5);const ranges=lc.map(c=>c.h-c.l);const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length;const lastRange=ranges[ranges.length-1];const expanding=lastRange>avgRange*1.5;const contracting=lastRange<avgRange*0.5;return{detected:expanding||contracting,pattern:expanding?'Expanding':(contracting?'Contracting':'Neutral'),rangeRatio:(lastRange/avgRange).toFixed(2),signal:expanding?(direction==='BUY'?'Bullish momentum':'Bearish momentum'):(contracting?'Consolidation':'Neutral')};}

function checkPathClearance(entryData,entry,tp,direction){const obstacles=[];const fvgs=detectFVG(entryData);const swings=findSwings(entryData,3);if(direction==='BUY'){const bearFVGs=fvgs.filter(f=>f.type==='bear'&&f.l>entry&&f.l<tp);if(bearFVGs.length>0)obstacles.push('Bearish FVG');const swingHighs=swings.H.filter(s=>s.p>entry&&s.p<tp);if(swingHighs.length>0)obstacles.push('Swing high');}else{const bullFVGs=fvgs.filter(f=>f.type==='bull'&&f.h>tp&&f.h<entry);if(bullFVGs.length>0)obstacles.push('Bullish FVG');const swingLows=swings.L.filter(s=>s.p>tp&&s.p<entry);if(swingLows.length>0)obstacles.push('Swing low');}return{clear:obstacles.length===0,obstacles,count:obstacles.length};}

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

function checkZoneReaction(data, zone, direction) {
    if (data.length < 3) return { confirmed: false, type: 'none', strength: 'NONE' };
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    const prev2 = data[data.length - 3];
    
    if (direction === 'BUY') {
        const wickedIntoZone = last.l <= zone.high && last.l >= zone.low;
        const closedAbove = last.c > zone.high;
        const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c > prev.h;
        const bullishPinbar = (last.c - last.l) > Math.abs(last.c - last.o) * 2 && last.c > last.o;
        const rejectionInZone = wickedIntoZone && (closedAbove || bullishPinbar || last.c > last.o);
        const followThrough = last.c > prev.c && prev.c > prev2.c && last.c > last.o;
        
        if (bullishEngulf && followThrough) return { confirmed: true, type: 'bullish engulf + momentum', strength: 'STRONG' };
        if (bullishEngulf) return { confirmed: true, type: 'bullish engulf', strength: 'STRONG' };
        if (rejectionInZone && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' };
        if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick', strength: 'MODERATE' };
        if (last.c > prev.c && last.c > prev2.c && last.c > last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' };
        return { confirmed: false, type: 'none', strength: 'NONE' };
    } else {
        const wickedIntoZone = last.h >= zone.low && last.h <= zone.high;
        const closedBelow = last.c < zone.low;
        const bearishEngulf = last.c < last.o && prev.c > prev.o && last.c < prev.l;
        const bearishPinbar = (last.h - last.c) > Math.abs(last.c - last.o) * 2 && last.c < last.o;
        const rejectionInZone = wickedIntoZone && (closedBelow || bearishPinbar || last.c < last.o);
        const followThrough = last.c < prev.c && prev.c < prev2.c && last.c < last.o;
        
        if (bearishEngulf && followThrough) return { confirmed: true, type: 'bearish engulf + momentum', strength: 'STRONG' };
        if (bearishEngulf) return { confirmed: true, type: 'bearish engulf', strength: 'STRONG' };
        if (rejectionInZone && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' };
        if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick', strength: 'MODERATE' };
        if (last.c < prev.c && last.c < prev2.c && last.c < last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' };
        return { confirmed: false, type: 'none', strength: 'NONE' };
    }
}

function checkZoneMagnetism(entryData, price, entry, direction) {
    const imbalances = findImbalances(entryData);
    const sweeps = detectLiquiditySweeps(entryData, price);
    
    let score = 0;
    const checks = [];
    
    if (direction === 'BUY') {
        const pullingImbalances = imbalances.filter(i => i.type === 'BULLISH' && i.low > entry && i.high < price);
        if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bullish imbalance(s)`}); }
        else { checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'}); }
    } else {
        const pullingImbalances = imbalances.filter(i => i.type === 'BEARISH' && i.low > price && i.high < entry);
        if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bearish imbalance(s)`}); }
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

// FIX 5: Proper HTF Confluence (Trend Alignment, not zone containment)
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
// MSNR LEVELS
// ============================================
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}

// ============================================
// PRECISION ENTRY ZONE WITH ORDER BLOCKS (IMPROVED)
// ============================================
function findPrecisionEntryZones(data,price,direction,msnr){
    const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4);
    const imbalances=findImbalances(data);
    const orderBlocks=detectOrderBlocks(data,direction);
    let allZones=[];
    
    const processZone = (low, high, src, baseScore) => {
        let score = baseScore;
        let cf = [src];
        if (orderBlocks.find(ob => Math.abs(ob.low - low) < a * 0.3)) { score += 25; cf.push('OrderBlock'); }
        if (breakers.find(b => (direction === 'BUY' ? b.type === 'BULL' : b.type === 'BEAR') && Math.abs(b.p - low) < a * 0.5)) { score += 25; cf.push('Breaker'); }
        if (swings[direction === 'BUY' ? 'L' : 'H'].find(x => Math.abs(x.p - low) < a * 0.3)) { score += 20; cf.push('Swing'); }
        if ((direction === 'BUY' ? msnr.nearestSupport : msnr.nearestResistance) && Math.abs((direction === 'BUY' ? msnr.nearestSupport : msnr.nearestResistance) - low) < low * 0.003) { score += 20; cf.push('MSNR'); }
        if (imbalances.find(i => (direction === 'BUY' ? i.type === 'BULLISH' : i.type === 'BEARISH') && Math.abs((i.low + i.high) / 2 - low) < low * 0.005)) { score += 25; cf.push('Imbalance'); }
        
        allZones.push({
            low, high, p: (low + high) / 2, src, score, confluence: cf.join('+'), cc: cf.length,
            quality: score >= 80 ? 'A' : (score >= 60 ? 'B' : 'C'), hasImbalance: cf.includes('Imbalance')
        });
    };

    if(direction==='BUY'){
        fvgs.filter(f=>f.type==='bull'&&f.l<price&&f.fresh).forEach(f=>processZone(f.l, f.h, 'FVG', 30));
        orderBlocks.forEach(ob=>processZone(ob.low, ob.high, 'OB', 35));
        if(msnr.nearestSupport&&msnr.nearestSupport<price) processZone(msnr.nearestSupport*0.998, msnr.nearestSupport*1.002, 'MSNR', 25);
    } else {
        fvgs.filter(f=>f.type==='bear'&&f.h>price&&f.fresh).forEach(f=>processZone(f.l, f.h, 'FVG', 30));
        orderBlocks.forEach(ob=>processZone(ob.low, ob.high, 'OB', 35));
        if(msnr.nearestResistance&&msnr.nearestResistance>price) processZone(msnr.nearestResistance*0.998, msnr.nearestResistance*1.002, 'MSNR', 25);
    }
    
    allZones.sort((x,y)=>y.score-x.score);
    
    if(allZones.length>0) return allZones[0];
    
    const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
    if(direction==='BUY'){
        const low=rL+r*.618,high=rL+r*.79;
        return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};
    } else {
        const low=rH-r*.79,high=rH-r*.618;
        return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};
    }
}

// ============================================
// PROBABILITY CHECK
// ============================================
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Zone Magnetism',passed:magnetism.likelyToReach,critical:true});checks.push({name:'Imbalance Magnet',passed:zone.hasImbalance,critical:false});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=4?'HIGH':(tp>=3?'MEDIUM':'LOW')):'LOW',checks,totalPassed:tp,passed:cp};}

// ============================================
// STOP LOSS
// ============================================
function calcStopLoss(data,dir,entry,zone,msnr,tfUsed,twelveIndicators){
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const swings=findSwings(data,4),fvgs=detectFVG(data);
    const s=getMarketSettings(pair);
    const maxSLD=entry*s.maxSLPct;
    const slBuf=getSLBufferForTF(apiATR, tfUsed, pair); // FIX: passed pair
    let c=[];
    if(dir==='BUY'){
        if(msnr&&msnr.allSupports){msnr.allSupports.filter(x=>x<entry).forEach(x=>{const sl=x-slBuf;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below MSNR',distance:d});});}
        if(zone&&zone.low<entry){const sl=zone.low-slBuf*0.6;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below zone',distance:d});}
        swings.L.filter(x=>x.p<entry).forEach(x=>{const sl=x.p-slBuf;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below swing',distance:d});});
        fvgs.filter(f=>f.type==='bull'&&f.l<entry).forEach(f=>{const sl=f.l-slBuf*0.6;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below FVG',distance:d});});
    }else{
        if(msnr&&msnr.allResistances){msnr.allResistances.filter(x=>x>entry).forEach(x=>{const sl=x+slBuf;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above MSNR',distance:d});});}
        if(zone&&zone.high>entry){const sl=zone.high+slBuf*0.6;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above zone',distance:d});}
        swings.H.filter(x=>x.p>entry).forEach(x=>{const sl=x.p+slBuf;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above swing',distance:d});});
        fvgs.filter(f=>f.type==='bear'&&f.h>entry).forEach(f=>{const sl=f.h+slBuf*0.6;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above FVG',distance:d});});
    }
    c.sort((a,b)=>a.distance-b.distance);
    for(const x of c){if(x.distance<=maxSLD)return{price:x.price,reason:x.reason,distance:x.distance};}
    const fb=dir==='BUY'?entry-Math.max(apiATR*0.5,s.minSL):entry+Math.max(apiATR*0.5,s.minSL);
    return{price:fb,reason:'Min ATR',distance:Math.abs(entry-fb)};
}

// ============================================
// TAKE PROFIT
// ============================================
function calcTakeProfits(dir,entry,sl){
    const risk=Math.abs(entry-sl);
    const settings=getMarketSettings(pair);
    const rr=settings.targetRR;
    if(dir==='BUY'){return{tp1:entry+risk*rr,tp2:entry+risk*(rr+1),tp3:entry+risk*(rr+2),rrUsed:rr};}
    else{return{tp1:entry-risk*rr,tp2:entry-risk*(rr+1),tp3:entry-risk*(rr+2),rrUsed:rr};}
}

// ============================================
// SCORING
// ============================================
function score(data,price,twelveIndicators){
    const a=atr(data),cl=data.map(c=>c.c),rs=rsiCalc(cl);
    const fv=detectFVG(data),ms=detectMSS(data),bk=detectBreakers(data);
    const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1];
    const bF=fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);
    const sF=fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);
    const bB=bk.filter(b=>b.type==='BULL'&&b.p<price);
    const sB=bk.filter(b=>b.type==='BEAR'&&b.p>price);
    
    let bS=0,sS=0,bR=[],sR=[];
    
    if(ms?.type==='BULL'){bS+=20;bR.push('MSS Bull');}
    else if(ms?.type==='BEAR'){sS+=20;sR.push('MSS Bear');}
    if(bF.length){bS+=15;bR.push('Bull FVG');}
    if(sF.length){sS+=15;sR.push('Bear FVG');}
    if(bB.length){bS+=10;bR.push('Bull breaker');}
    if(sB.length){sS+=10;sR.push('Bear breaker');}
    if(cE20>cE50){bS+=15;bR.push('EMA bull');}
    else{sS+=15;sR.push('EMA bear');}
    if(rs>50)bS+=10;else sS+=10;
    
    const ind = twelveIndicators || {};
    
    if (ind.rsi && ind.rsi < 30) { bS += 8; bR.push('RSI oversold'); }
    if (ind.rsi && ind.rsi > 70) { sS += 8; sR.push('RSI overbought'); }
    if (ind.stoch_k && ind.stoch_d && ind.stoch_k < 20 && ind.stoch_d < 20) { bS += 5; bR.push('Stoch oversold'); }
    if (ind.stoch_k && ind.stoch_d && ind.stoch_k > 80 && ind.stoch_d > 80) { sS += 5; sR.push('Stoch overbought'); }
    if (ind.bb_lower && price <= ind.bb_lower * 1.002) { bS += 5; bR.push('At BB lower'); }
    if (ind.bb_upper && price >= ind.bb_upper * 0.998) { sS += 5; sR.push('At BB upper'); }
    if (ind.cci && ind.cci < -150) { bS += 5; bR.push('CCI oversold'); }
    if (ind.cci && ind.cci > 150) { sS += 5; sR.push('CCI overbought'); }
    if (ind.williams_r && ind.williams_r < -80) { bS += 3; bR.push('Williams oversold'); }
    if (ind.williams_r && ind.williams_r > -20) { sS += 3; sR.push('Williams overbought'); }
    if (ind.sar && price > ind.sar) { bS += 5; bR.push('SAR bullish'); }
    if (ind.sar && price < ind.sar) { sS += 5; sR.push('SAR bearish'); }
    if (ind.ichimoku_senkou_a && ind.ichimoku_senkou_b) {
        const cloudTop = Math.max(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b);
        const cloudBot = Math.min(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b);
        if (price > cloudTop) { bS += 8; bR.push('Above cloud'); }
        if (price < cloudBot) { sS += 8; sR.push('Below cloud'); }
    }
    if (ind.macd_hist && ind.macd_hist > 0) { bS += 3; }
    if (ind.macd_hist && ind.macd_hist < 0) { sS += 3; }
    
    let dir,conf,reason;
    if(bS>sS){dir='BUY';conf=Math.min(bS+10,95);reason=bR.join('; ');}
    else if(sS>bS){dir='SELL';conf=Math.min(sS+10,95);reason=sR.join('; ');}
    else{dir=cE20>cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';}
    return{dir,conf,reason,scores:{bS,sS}};
}

// ============================================
// MULTI-TF DISPLAY
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
// SETUP QUALITY SCORE
// ============================================
function calculateSetupQuality(result, price) {
    let score = 0;
    const risk = Math.abs(result.entry - result.sl);
    const riskPct = (risk / price) * 100;
    
    const tfWeights = { '1D': 100, '4H': 80, '1H': 60, '15M': 30, '5M': 10 };
    score += tfWeights[result.timeframe] || 0;
    score += (result.confidence / 100) * 50;
    
    if (result.zone.quality === 'A') score += 20;
    else if (result.zone.quality === 'B') score += 10;
    
    score += Math.min(result.zone.cc * 5, 20);
    if (result.htfValidation?.level === 'FULL') score += 15;
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
    
    return Math.max(0, Math.min(100, score));
}

// ============================================
// MSS DETECTION HELPER
// ============================================
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

function isSetupStale(zone, price, direction) {
    const distance = Math.abs(price - zone.p) / price * 100;
    if (distance > 1.5) return { stale: true, reason: 'Price too far from zone' };
    return { stale: false };
}

// ============================================
// ANALYZE SINGLE TIMEFRAME (FIXED LOGIC)
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        const entryData = await getHistory(entryTF);
        if (!entryData?.length || entryData.length < 30) return null;
        
        const structureData = structureTF !== entryTF ? await getHistory(structureTF) : entryData;
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
        const mtf = { direction: bullCount > bearCount ? 'BULLISH' : (bearCount > bullCount ? 'BEARISH' : 'NEUTRAL'), strength: Math.max(bullCount, bearCount), bullCount, bearCount, trends };
        
        let direction = sig.dir;
        if (mtf.strength >= 3) direction = mtf.direction === 'BULLISH' ? 'BUY' : 'SELL';
        
        const turtleSoup = detectTurtleSoup(entryData);
        if (turtleSoup.detected) direction = turtleSoup.type;
        
        const mss = detectMarketStructureShift(entryData, direction);
        if (mss.detected) direction = mss.type === 'BULLISH_MSS' ? 'BUY' : 'SELL';
        
        const htfValidation = await checkHTFConfluenceAsync(structureData, structureData, direction);
        
        const msnr = calculateMSNR(structureData || entryData, price);
        const zone = findPrecisionEntryZones(entryData, price, direction, msnr);
        
        // Validate Zone
        const validity = isZoneStillValid(entryData, zone, direction);
        if (!validity.valid) return null; // Skip mitigated zones

        const zoneTouches = countZoneTouches(entryData, zone, direction);
        const zoneReaction = checkZoneReaction(entryData, zone, direction);
        
        let htfArrayValidation = { passed: true, parentArray: null, structureTF: structureTF };
        if (structureTF !== entryTF && structureData && structureData.length >= 20) {
            const structureArrays = findPDArrays(structureData, direction);
            const validation = isZoneWithinHTFArray(zone, structureArrays);
            if (!validation.contained) {
                htfArrayValidation = { passed: false, parentArray: null, structureTF: structureTF };
            } else {
                htfArrayValidation = { passed: true, parentArray: validation.parentArray, structureTF: structureTF };
            }
        }
        
        let entry = null;
        let entryReady = false;
        const trigger = checkEntryTrigger(entryData, zone, direction);

        // FIX: Precise Entry Logic
        if (trigger.triggered && trigger.strength >= 70) {
            entryReady = true;
            entry = trigger.entry;
        } else if (zoneReaction.confirmed && (zoneReaction.strength === 'STRONG' || zoneReaction.strength === 'MODERATE')) {
            entryReady = false; // Still reacting, use conservative entry
            const lastCandle = entryData[entryData.length - 1];
            if (direction === 'BUY') entry = zone.low + (zone.high - zone.low) * 0.4;
            else entry = zone.high - (zone.high - zone.low) * 0.4;
        }
        
        if (!entryReady && !entry) {
            entry = (zone.low + zone.high) / 2;
        }
        
        // Ensure entry is on correct side of price
        if (direction === 'BUY' && entry >= price) { const nb = msnr.nearestSupport || price * 0.99; entry = Math.min(zone.low, nb, price * 0.995); }
        if (direction === 'SELL' && entry <= price) { const na = msnr.nearestResistance || price * 1.01; entry = Math.max(zone.high, na, price * 1.005); }
        
        const magnetism = checkZoneMagnetism(entryData, price, entry, direction);
        const displacement = detectDisplacement(entryData, direction);
        const sniperRej = await checkSniperRejection(zone, direction, sniperTF);
        const probCheck = checkProbability(zone, mtf, magnetism);
        const slResult = calcStopLoss(entryData, direction, entry, zone, msnr, tfToAnalyze, twelveIndicators);
        const tps = calcTakeProfits(direction, entry, slResult.price);
        const pathCheck = checkPathClearance(entryData, entry, tps.tp1, direction);
        const apiATR = twelveIndicators?.atr_api || atr(entryData, 14);
        const sweeps = detectLiquiditySweeps(entryData, price);
        const imbalances = findImbalances(entryData);
        const mssOrig = detectMSS(entryData);
        const volatility = getVolatilityLevel(apiATR, price);
        const crt = detectCRT(entryData, direction);
        const cl = entryData.map(c => c.c);
        const rs = rsiCalc(cl, 14);
        const fvgsAll = detectFVG(entryData);
        const breakersAll = detectBreakers(entryData);
        
        const staleCheck = isSetupStale(zone, price, direction);
        
        // Apply Penalties
        let finalConfidence = sig.conf;
        if(htfValidation.penalty) finalConfidence -= htfValidation.penalty;
        if(!htfArrayValidation.passed) finalConfidence -= 10;
        if(staleCheck.stale) finalConfidence -= 20;
        if(!trigger.triggered) finalConfidence -= 5;

        return {
            timeframe: tfToAnalyze,
            direction,
            confidence: Math.max(20, Math.min(95, finalConfidence)),
            entry: +entry.toFixed(getPrec(pair)),
            sl: +slResult.price.toFixed(getPrec(pair)),
            tp1: +tps.tp1.toFixed(getPrec(pair)),
            tp2: +tps.tp2.toFixed(getPrec(pair)),
            tp3: +tps.tp3.toFixed(getPrec(pair)),
            rr: tps.rrUsed,
            zone: { ...zone, validity, touches: zoneTouches },
            entryReady,
            mtf,
            htfValidation: { level: htfValidation.level, daily: htfValidation.daily, h4: htfValidation.h4, passed: htfArrayValidation.passed, parentArray: htfArrayValidation.parentArray },
            magnetism,
            displacement,
            sniperRej,
            probCheck,
            slReason: slResult.reason,
            pathCheck,
            sweeps,
            imbalances,
            mss: mssOrig,
            turtleSoup,
            volatility,
            crt,
            rsi: rs,
            atr: apiATR,
            fvgs: fvgsAll,
            breakers: breakersAll,
            stale: staleCheck,
            trigger,
            reason: sig.reason,
            scores: sig.scores,
            qualityScore: 0 // Will be calculated after sorting
        };
    } catch (e) {
        console.error('analyzeTimeframe error:', e);
        return null;
    }
}

// ============================================
// AUTO SCAN & EXECUTION (RESTORED MISSING LOGIC)
// ============================================
async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn');
    btn.innerHTML = '⏳ Scanning...'; 
    btn.disabled = true;
    document.getElementById('resultArea').innerHTML = '<div class="loading">📡 Fetching multi-timeframe data & calculating precision zones...</div>';
    
    const price = await getPrice();
    if (!price) {
        showNotif('❌ Failed to get price. Check API Key.', 'error'); 
        btn.innerHTML = '🔍 Analyze'; 
        btn.disabled = false; 
        document.getElementById('resultArea').innerHTML = ''; 
        return;
    }
    
    document.getElementById('currentPrice').innerHTML = `${getPairDisplayName(pair)}: ${price.toFixed(getPrec(pair))}`;
    document.getElementById('apiSource').innerHTML = '📡 Live';
    
    await updateMTFDisplay();
    
    const results = [];
    for (let tf of ALL_TIMEFRAMES) {
        const res = await analyzeTimeframe(tf, price, null);
        if (res) {
            res.qualityScore = calculateSetupQuality(res, price);
            results.push(res);
        }
    }
    
    // Sort by Quality Score
    results.sort((a, b) => b.qualityScore - a.qualityScore);
    
    analysis = results[0] || null;
    
    if (analysis) {
        renderAnalysis(analysis, price);
        generateAISummary(analysis, price);
    } else {
        document.getElementById('resultArea').innerHTML = `
            <div class="setup-card" style="text-align:center; padding:30px;">
                <div style="font-size:40px; margin-bottom:10px;">🛑</div>
                <h3>No High-Probability Setups Found</h3>
                <p style="color:var(--muted); margin-top:8px;">Wait for clear structure, zone mitigation, or trigger confirmations.</p>
            </div>
        `;
        document.getElementById('aiSummary').innerHTML = '';
    }
    
    btn.innerHTML = '🔍 Analyze'; 
    btn.disabled = false;
}

function renderAnalysis(res, price) {
    if (!res) return;
    
    const dirColor = res.direction === 'BUY' ? 'var(--bull)' : 'var(--bear)';
    const dirIcon = res.direction === 'BUY' ? '🚀' : '🔻';
    const triggerStatus = res.trigger?.triggered ? `✅ <strong>${res.trigger.type}</strong>` : '⏳ Waiting for Trigger';
    const triggerColor = res.trigger?.triggered ? 'var(--bull)' : '#ff9800';
    const staleWarn = res.stale?.stale ? `<div class="warn">⚠️ ${res.stale.reason}</div>` : '';
    const qualityBar = `<div style="background:#333; height:6px; border-radius:3px; margin-top:5px;"><div style="background:${res.qualityScore>70?'var(--bull)':(res.qualityScore>50?'#ff9800':'var(--bear)')}; width:${res.qualityScore}%; height:100%; border-radius:3px;"></div></div>`;
    
    document.getElementById('resultArea').innerHTML = `
        <div class="setup-card" style="border-left: 4px solid ${dirColor}">
            <div class="setup-header">
                <span class="dir-badge" style="background:${dirColor}">${dirIcon} ${res.direction}</span>
                <span class="tf-badge">${res.timeframe} Timeframe</span>
                <span class="conf-badge">${res.confidence}% Conf</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:10px;">
                <span>Setup Quality: <strong style="color:var(--text)">${res.qualityScore}/100</strong></span>
                <span>API Calls: ${calls}</span>
            </div>
            ${qualityBar}
            ${staleWarn}
            
            <div class="setup-grid">
                <div class="field"><span class="label">Entry Price</span><span class="val entry-val">${res.entry}</span></div>
                <div class="field"><span class="label">Stop Loss</span><span class="val sl-val">${res.sl} <span style="font-size:10px;color:var(--muted)">(${res.slReason})</span></span></div>
                <div class="field"><span class="label">TP 1 (${res.rr}:1)</span><span class="val tp-val">${res.tp1}</span></div>
                <div class="field"><span class="label">TP 2 (${res.rr+1}:1)</span><span class="val tp-val">${res.tp2}</span></div>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; font-size:12px;">
                <div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:4px;">
                    <span style="color:var(--muted)">Trigger Status</span><br>
                    <span style="color:${triggerColor}">${triggerStatus}</span>
                </div>
                <div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:4px;">
                    <span style="color:var(--muted)">Zone Info</span><br>
                    <span style="font-weight:bold">${res.zone.src} | ${res.zone.confluence} | ${res.zone.validity.freshness}</span>
                </div>
            </div>

            <div class="details-box">
                <p><strong>Probability:</strong> ${res.probCheck.probability} | <strong>Magnetism:</strong> ${res.magnetism.magnetism} (${res.magnetism.score}/100) | <strong>Volatility:</strong> ${res.volatility.level}</p>
                <p><strong>Path to TP1:</strong> ${res.pathCheck.clear ? '✅ Clear' : '❌ Obstacles: ' + res.pathCheck.obstacles.join(', ')} | <strong>Displacement:</strong> ${res.displacement.detected ? '✅ Yes' : '❌ No'}</p>
                <p><strong>Core Logic:</strong> ${res.reason}</p>
            </div>
        </div>
    `;
}

async function generateAISummary(res, price) {
    const aiEl = document.getElementById('aiSummary');
    if (!DEEPSEEK_API_KEY) { aiEl.innerHTML = '<div class="ai-box">Set DeepSeek key for AI analysis</div>'; return; }
    aiEl.innerHTML = '<div class="ai-box">🤖 Generating AI Summary...</div>';
    
    try {
        const prompt = `You are an expert ICT (Inner Circle Trader) forex/commodities analyst. Analyze this trading setup and give a very brief, professional 3-4 sentence summary. Do not give generic advice. Focus strictly on the provided data.

Pair: ${pair}
Current Price: ${price}
Direction: ${res.direction}
Timeframe: ${res.timeframe}
Entry: ${res.entry}, SL: ${res.sl}, TP1: ${res.tp1}
Zone Type: ${res.zone.src} (${res.zone.confluence})
Zone Freshness: ${res.zone.validity.freshness}
Trigger: ${res.trigger?.triggered ? res.trigger.type : 'Waiting'}
HTF Confluence: ${res.htfValidation.level}
Probability: ${res.probCheck.probability}
Reasoning: ${res.reason}`;

        const r = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 150 })
        });
        const d = await r.json();
        if (d.choices) {
            aiEl.innerHTML = `<div class="ai-box"><strong>🤖 AI ICT Analysis:</strong><br>${d.choices[0].message.content}</div>`;
        } else {
            aiEl.innerHTML = `<div class="ai-box">❌ AI Error: ${d.error?.message || 'Unknown'}</div>`;
        }
    } catch (e) {
        aiEl.innerHTML = `<div class="ai-box">❌ Failed to reach DeepSeek API</div>`;
    }
}

function handleLimit() {
    if (!analysis) { showNotif('⚠️ Run analysis first', 'warning'); return; }
    if (!analysis.trigger?.triggered) { showNotif('⚠️ Wait for a trigger before executing', 'warning'); return; }
    limitOrder = analysis;
    localStorage.setItem('ict_limit', JSON.stringify(limitOrder));
    document.getElementById('limitStatus').innerHTML = `🟡 Active: ${limitOrder.direction} ${pair} @ ${limitOrder.entry} (SL: ${limitOrder.sl})`;
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
        document.getElementById('limitStatus').innerHTML = `🟡 Active: ${limitOrder.direction} ${pair} @ ${limitOrder.entry} (SL: ${limitOrder.sl})`;
        document.getElementById('limitStatus').style.display = 'block';
    }
}

function copyJson() {
    if (!analysis) { showNotif('⚠️ No data to copy', 'warning'); return; }
    navigator.clipboard.writeText(JSON.stringify(analysis, null, 2)).then(() => {
        showNotif('📋 JSON copied to clipboard!', 'success');
    }).catch(() => {
        showNotif('❌ Failed to copy', 'error');
    });
}