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
function showSetup() { const ex=document.getElementById('setupOverlay'); if(ex)ex.remove(); document.body.insertAdjacentHTML('beforeend',`<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button><div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div></div></div>`); document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk);document.getElementById('setupOverlay').remove();}); document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';}); document.getElementById('testAiBtn').addEventListener('click',async()=>{const dk=document.getElementById('dsInput').value.trim();if(!dk){document.getElementById('testResult').innerHTML='❌ Enter key first';return;}document.getElementById('testResult').innerHTML='🔄 Testing...';try{const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});const d=await r.json();document.getElementById('testResult').innerHTML=d.choices?'✅ AI working!':'❌ Error: '+(d.error?.message||'Unknown');}catch(e){document.getElementById('testResult').innerHTML='❌ Connection failed';}}); document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove()); }

// ============================================
// STATE
// ============================================
let pair='XAU/USD',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null;
document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY&&!DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();});
function init(){updateTime();setInterval(updateTime,1000);document.getElementById('analyzeBtn').addEventListener('click',runAutoScan);document.getElementById('executeBtn').addEventListener('click',handleLimit);document.getElementById('cancelLimitBtn').addEventListener('click',cancelLimit);document.getElementById('copyJsonBtn').addEventListener('click',copyJson);document.getElementById('updateKeysBtn').addEventListener('click',showSetup);document.getElementById('pairSelect').addEventListener('change',e=>pair=e.target.value);document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));loadLimitOrder();}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML=`${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

// ============================================
// API
// ============================================
async function getPrice(){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.price){calls++;document.getElementById('apiSource').innerHTML='📡 Live';return +d.price;}}catch(e){}return null;}

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
const rsi=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};

// Pure Institutional FVG Engine with True Displacement Filters
function detectFVG(d){
    let f=[]; const a=atr(d,14);
    for(let i=1;i<d.length-1;i++){
        if(d[i-1].h < d[i+1].l && (d[i+1].l - d[i-1].h) > a * 0.25) {
            let m=(d[i-1].h+d[i+1].l)/2; let fr=true;
            for(let j=i+2;j<d.length;j++){if(d[j].l<m){fr=false;break;}}
            f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m,fresh:fr});
        }
        if(d[i-1].l > d[i+1].h && (d[i-1].l - d[i+1].h) > a * 0.25) {
            let m=(d[i-1].l+d[i+1].h)/2; let fr=true;
            for(let j=i+2;j<d.length;j++){if(d[j].h>m){fr=false;break;}}
            f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m,fresh:fr});
        }
    }
    return f;
}

function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}

// Volumetric High-Probability Order Block Engine
function detectOrderBlocks(data, direction) {
    const obs = []; if (data.length < 5) return obs;
    for (let i = 2; i < data.length - 2; i++) {
        const bodySize = Math.abs(data[i].c - data[i].open);
        const nextBody = Math.abs(data[i+1].c - data[i+1].o);
        if (direction === 'BUY') {
            if (data[i].c < data[i].o && data[i+1].c > data[i+1].o && data[i+1].c > data[i].h && nextBody > bodySize) {
                obs.push({ type: 'BULL_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i });
            }
        } else {
            if (data[i].c > data[i].o && data[i+1].c < data[i+1].o && data[i+1].l < data[i].l && nextBody > bodySize) {
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

// ============================================
// FIND PD ARRAYS FOR A TIMEFRAME
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

function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY'&&lb>avg*2.5&&lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL'&&lb>avg*2.5&&lc[4].c<lc[4].o)return{detected:true};return{detected:false};}
async function checkSniperRejection(zone,direction,sniperTF){const dSn=await getHistory(sniperTF);if(!dSn||dSn.length<3)return{confirmed:false};const lc=dSn[dSn.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.high&&lc.l>=zone.low;if(t&&wick>body*2&&lc.c>lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.low&&lc.h<=zone.high;if(t&&wick>body*2&&lc.c<lc.o)return{confirmed:true};}return{confirmed:false};}
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal'};return{level:'Low - Consolidation',desc:'Tight ranges'};}
function detectLiquiditySweeps(data,currentPrice){const sweeps=[];const a=atr(data,14);const maxDistance=a*3;const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);for(let i=10;i<data.length-3;i++){const rH=highs.slice(i-5,i);const maxH=Math.max(...rH);if(rH.filter(h=>Math.abs(h-maxH)<=maxH*0.001).length>=2&&Math.abs(maxH-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.h>maxH*1.001)&&closes[i+3]<maxH)sweeps.push({type:'BUY_SIDE',level:maxH,distance:Math.abs(maxH-currentPrice),direction:'BEARISH'});}const rL=lows.slice(i-5,i);const minL=Math.min(...rL);if(rL.filter(l=>Math.abs(l-minL)<=minL*0.001).length>=2&&Math.abs(minL-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.l<minL*0.999)&&closes[i+3]>minL)sweeps.push({type:'SELL_SIDE',level:minL,distance:Math.abs(minL-currentPrice),direction:'BULLISH'});}        }return sweeps.sort((a,b)=>a.distance-b.distance);}
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}
function detectTurtleSoup(data){if(data.length<15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow<keyLow*0.999&&cc>keyLow&&cc>co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[recentHigh.length-4];if(recentHigh>keyHigh*1.001&&cc<keyHigh&&cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};}
function detectCRT(data,direction){if(data.length<10)return{detected:false};const lc=data.slice(-5);const ranges=lc.map(c=>c.h-c.l);const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length;const lastRange=ranges[ranges.length-1];const expanding=lastRange>avgRange*1.5;const contracting=lastRange<avgRange*0.5;return{detected:expanding||contracting,pattern:expanding?'Expanding':(contracting?'Contracting':'Neutral'),rangeRatio:(lastRange/avgRange).toFixed(2),signal:expanding?(direction==='BUY'?'Bullish momentum':'Bearish momentum'):(contracting?'Consolidation':'Neutral')};}
function checkPathClearance(entryData,entry,tp,direction){const obstacles=[];const fvgs=detectFVG(entryData);const swings=findSwings(entryData,3);if(direction==='BUY'){const bearFVGs=fvgs.filter(f=>f.type==='bear'&&f.l>entry&&f.l<tp);if(bearFVGs.length>0)obstacles.push('Bearish FVG');const swingHighs=swings.H.filter(s=>s.p>entry&&s.p<tp);if(swingHighs.length>0)obstacles.push('Swing high');}else{const bullFVGs=fvgs.filter(f=>f.type==='bull'&&f.h>tp&&f.h<entry);if(bullFVGs.length>0)obstacles.push('Bullish FVG');const swingLows=swings.L.filter(s=>s.p>tp&&s.p<entry);if(swingLows.length>0)obstacles.push('Swing low');}return{clear:obstacles.length===0,obstacles,count:obstacles.length};}

// ============================================
// ZONE REACTION CHECK
// ============================================
function checkZoneReaction(data, zone, direction) {
    if (data.length < 3) return { confirmed: false, type: 'none', strength: 'NONE' };
    const last = data[data.length - 1]; const prev = data[data.length - 2];
    if (direction === 'BUY') {
        const wickedIntoZone = last.l <= zone.high && last.l >= zone.low;
        const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c > prev.h;
        if (bullishEngulf) return { confirmed: true, type: 'bullish engulf', strength: 'STRONG' };
        if (wickedIntoZone && last.c > last.o) return { confirmed: true, type: 'zone rejection wick', strength: 'MODERATE' };
    } else {
        const wickedIntoZone = last.h >= zone.low && last.h <= zone.high;
        const bearishEngulf = last.c < last.o && prev.c > prev.o && last.c < prev.l;
        if (bearishEngulf) return { confirmed: true, type: 'bearish engulf', strength: 'STRONG' };
        if (wickedIntoZone && last.c < last.o) return { confirmed: true, type: 'zone rejection wick', strength: 'MODERATE' };
    }
    return { confirmed: false, type: 'none', strength: 'NONE' };
}

// ============================================
// ZONE MAGNETISM CHECK
// ============================================
function checkZoneMagnetism(entryData, price, entry, direction) {
    const imbalances = findImbalances(entryData);
    let score = 0; const checks = [];
    if (direction === 'BUY') {
        const pullingImbalances = imbalances.filter(i => i.type === 'BULLISH' && i.low > entry && i.high < price);
        if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bullish imbalance(s)`}); }
        else checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'});
    } else {
        const pullingImbalances = imbalances.filter(i => i.type === 'BEARISH' && i.low > price && i.high < entry);
        if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bearish imbalance(s)`}); }
        else checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'});
    }
    const distancePct = Math.abs(price - entry) / price * 100;
    if (distancePct < 0.8) { score += 30; checks.push({name: 'Zone proximity', passed: true, detail: `Reachable`}); }
    else checks.push({name: 'Zone proximity', passed: false, detail: `Extended` });
    
    const magnetism = score >= 60 ? 'STRONG' : 'WEAK';
    return { magnetism, score, maxScore: 100, checks, likelyToReach: score >= 30 };
}

// ============================================
// HTF CONFLUENCE CHECK
// ============================================
async function checkHTFConfluenceAsync(dailyData, h4Data, entryDirection) {
    const dailyDir = await getQuoteDirection('1D');
    const h4Dir = await getQuoteDirection('4H');
    const entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH';
    if (dailyDir === entryDir && h4Dir === entryDir) return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 };
    if (dailyDir === entryDir || h4Dir === entryDir) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: 10 };
    return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 25 };
}

// ============================================
// MSNR LEVELS
// ============================================
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}

// ============================================
// PRECISION ENTRY ZONE LOOKUPS (UNCOMPRESSED)
// ============================================
function findPrecisionEntry(data,price,direction,msnr){
    const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4);
    const orderBlocks=detectOrderBlocks(data,direction);
    
    const hArr = data.slice(-40).map(c=>c.h), lArr = data.slice(-40).map(c=>c.l);
    const rangeHigh = Math.max(...hArr), rangeLow = Math.min(...lArr);
    const equilibrium = (rangeHigh + rangeLow) / 2;
    
    let allZones=[];
    
    if(direction==='BUY'){
        fvgs.filter(f=>f.type=='bull').forEach(f=>{
            if (f.l <= equilibrium) {
                let s=40; let cf=['FVG'];
                if(breakers.find(b=>b.type==='BULL'&&Math.abs(b.p-f.l)<a*0.5)){ s+=25; cf.push('Breaker'); }
                if(swings.L.find(x=>Math.abs(x.p-f.l)<a*0.3)){ s+=20; cf.push('Swing'); }
                allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':'B',hasImbalance:true,pricingContext:'DISCOUNT_OPTIMAL'});
            }
        });
        orderBlocks.forEach(ob=>{
            if (ob.low <= equilibrium) {
                let s=45; let cf=['OrderBlock'];
                if(swings.L.find(x=>Math.abs(x.p-ob.low)<a*0.3)){ s+=20; cf.push('Swing'); }
                allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':'B',hasImbalance:false,pricingContext:'DISCOUNT_OPTIMAL'});
            }
        });
    } else {
        fvgs.filter(f=>f.type=='bear').forEach(f=>{
            if (f.h >= equilibrium) {
                let s=40; let cf=['FVG'];
                if(breakers.find(b=>b.type==='BEAR'&&Math.abs(b.p-f.h)<a*0.5)){ s+=25; cf.push('Breaker'); }
                if(swings.H.find(x=>Math.abs(x.p-f.h)<a*0.3)){ s+=20; cf.push('Swing'); }
                allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':'B',hasImbalance:true,pricingContext:'PREMIUM_OPTIMAL'});
            }
        });
        orderBlocks.forEach(ob=>{
            if (ob.high >= equilibrium) {
                let s=45; let cf=['OrderBlock'];
                if(swings.H.find(x=>Math.abs(x.p-ob.high)<a*0.3)){ s+=20; cf.push('Swing'); }
                allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':'B',hasImbalance:false,pricingContext:'PREMIUM_OPTIMAL'});
            }
        });
    }
    
    allZones.sort((x,y)=>y.score-x.score);
    if(allZones.length>0){ return allZones[0]; }
    
    if(direction==='BUY'){
        const low=rangeLow+ (rangeHigh-rangeLow)*0.618, high=rangeLow+ (rangeHigh-rangeLow)*0.705;
        return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE-Equilibrium',cc:2,quality:'B',hasImbalance:false,pricingContext:'DISCOUNT_EQUILIBRIUM'};
    } else {
        const low=rangeHigh- (rangeHigh-rangeLow)*0.705, high=rangeHigh- (rangeHigh-rangeLow)*0.618;
        return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE-Equilibrium',cc:2,quality:'B',hasImbalance:false,pricingContext:'PREMIUM_EQUILIBRIUM'};
    }
}

// ============================================
// PROBABILITY CHECK
// ============================================
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Optimal Pricing Context',passed:zone.pricingContext.includes('OPTIMAL')||zone.pricingContext.includes('EQUILIBRIUM'),critical:true});return{probability:checks.every(c=>c.passed)?'HIGH':'LOW',checks};}

// ============================================
// STOP LOSS 
// ============================================
function calcStopLoss(data,dir,entry,zone,msnr,tfUsed,twelveIndicators){
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const swings=findSwings(data,4); const s=getMarketSettings(pair);
    const maxSLD=entry*s.maxSLPct; const slBuf=getSLBufferForTF(apiATR, tfUsed);
    let c=[];
    if(dir==='BUY'){
        if(zone) c.push({price:zone.low-slBuf*0.6,reason:'Below zone',distance:entry-(zone.low-slBuf*0.6)});
        swings.L.filter(x=>x.p<entry).forEach(x=>c.push({price:x.p-slBuf,reason:'Below swing structure',distance:entry-(x.p-slBuf)}));
    }else{
        if(zone) c.push({price:zone.high+slBuf*0.6,reason:'Above zone',distance:(zone.high+slBuf*0.6)-entry});
        swings.H.filter(x=>x.p>entry).forEach(x=>c.push({price:x.p+slBuf,reason:'Above swing structure',distance:(x.p+slBuf)-entry}));
    }
    c.sort((a,b)=>a.distance-b.distance);
    for(const x of c){if(x.distance<=maxSLD&&x.distance>0)return{price:x.price,reason:x.reason,distance:x.distance};}
    const fb=dir==='BUY'?entry-Math.max(apiATR*0.5,s.minSL):entry+Math.max(apiATR*0.5,s.minSL);
    return{price:fb,reason:'Min ATR Bound Protection',distance:Math.abs(entry-fb)};
}

// ============================================
// TAKE PROFIT
// ============================================
function calcTakeProfits(dir,entry,sl){
    const risk=Math.abs(entry-sl); const settings=getMarketSettings(pair); const rr=settings.targetRR;
    if(dir==='BUY'){return{tp1:entry+risk*rr,tp2:entry+risk*(rr+1),tp3:entry+risk*(rr+2),rrUsed:rr};}
    else{return{tp1:entry-risk*rr,tp2:entry-risk*(rr+1),tp3:entry-risk*(rr+2),rrUsed:rr};}
}

// ============================================
// SCORING
// ============================================
function score(data,price,twelveIndicators){
    const cl=data.map(c=>c.c); const rs=rsi(cl);
    const fv=detectFVG(data),ms=detectMSS(data);
    let bS=0,sS=0,bR=[],sR=[];
    if(ms?.type=='BULL'){bS+=25;bR.push('MSS Bull');} else if(ms?.type=='BEAR'){sS+=25;sR.push('MSS Bear');}
    if(fv.filter(f=>f.type==='bull').length){bS+=20;bR.push('Bull FVG');}
    if(fv.filter(f=>f.type==='bear').length){sS+=20;sR.push('Bear FVG');}
    if(rs>50)bS+=10;else sS+=10;
    
    const ind = twelveIndicators || {};
    if (ind.macd_hist && ind.macd_hist > 0) bS += 10; else if (ind.macd_hist && ind.macd_hist < 0) sS += 10;
    
    let dir,conf;
    if(bS>sS){dir='BUY';conf=Math.min(bS+30,95);} else {dir='SELL';conf=Math.min(sS+30,95);}
    return{dir,conf,scores:{bS,sS}};
}

// ============================================
// MULTI-TIMEFRAME DISPLAY
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
// TIMEFRAME CORE SCANNERS
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        const entryData = await getHistory(entryTF); if (!entryData?.length) return null;
        
        const fvgsAll = detectFVG(entryData); const obsAll = detectOrderBlocks(entryData, 'BUY').concat(detectOrderBlocks(entryData, 'SELL'));

        const structureData = await getHistory(structureTF);
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        const sig = score(entryData, price, twelveIndicators);
        
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
        let bullCount = 0, bearCount = 0; const trends = {};
        for (let t of tfs) {
            let tr = await getQuoteDirection(t); trends[t] = tr;
            if (tr === 'BULLISH') bullCount++; else if (tr === 'BEARISH') bearCount++;
        }
        const mtf = { direction: bullCount > bearCount ? 'BULLISH' : (bearCount > bullCount ? 'BEARISH' : 'NEUTRAL'), strength: Math.max(bullCount, bearCount), bullCount, bearCount, trends };
        
        let direction = sig.dir;
        if (mtf.strength >= 3) direction = mtf.direction === 'BULLISH' ? 'BUY' : 'SELL';
        const turtleSoup = detectTurtleSoup(entryData); if (turtleSoup.detected) direction = turtleSoup.type;
        
        const msnr = calculateMSNR(structureData || entryData, price);
        const zone = findPrecisionEntry(entryData, price, direction, msnr);
        const zoneTouches = countZoneTouches(entryData, zone, direction);
        const zoneReaction = checkZoneReaction(entryData, zone, direction);
        
        let htfValidation = { passed: true, parentArray: null, structureTF: structureTF };
        if (structureTF !== entryTF && structureData && structureData.length >= 20) {
            const structureArrays = findPDArrays(structureData, direction);
            const validation = isZoneWithinHTFArray(zone, structureArrays);
            htfValidation.passed = validation.contained;
        }
        
        let entry = null; let entryReady = false;
        if (zoneReaction.confirmed && (zoneReaction.strength === 'STRONG' || zoneReaction.strength === 'MODERATE')) {
            entryReady = true; const lastCandle = entryData[entryData.length - 1];
            if (direction === 'BUY') entry = Math.max(lastCandle.h, zone.low) + zone.low * 0.0002;
            else entry = Math.min(lastCandle.l, zone.high) - zone.high * 0.0002;
        }
        if (!entryReady) entry = (zone.low + zone.high) / 2;
        if (direction === 'BUY' && entry >= price) entry = price * 0.996;
        if (direction === 'SELL' && entry <= price) entry = price * 1.004;
        
        const magnetism = checkZoneMagnetism(entryData, price, entry, direction);
        const displacement = detectDisplacement(entryData, direction);
        const sniperRej = await checkSniperRejection(zone, direction, sniperTF);
        const probCheck = checkProbability(zone, mtf, magnetism);
        
        const slResult = calcStopLoss(entryData, direction, entry, zone, msnr, tfToAnalyze, twelveIndicators);
        const tps = calcTakeProfits(direction, entry, slResult.price);
        const pathCheck = checkPathClearance(entryData, entry, tps.tp1, direction);
        const apiATR = twelveIndicators?.atr_api || atr(entryData, 14);
        const sweeps = detectLiquiditySweeps(entryData, price); const imbalances = findImbalances(entryData); const mss = detectMSS(entryData);
        const volatility = getVolatilityLevel(apiATR, price); const crt = detectCRT(entryData, direction);
        const cl = entryData.map(c => c.c); const rs = rsi(cl, 14); const breakersAll = detectBreakers(entryData);
        
        let conf = sig.conf;
        if (mtf.direction === direction) conf = Math.min(conf + 15, 98); else conf = Math.max(conf - 15, 30);
        if (zone.quality === 'A') conf = Math.min(conf + 10, 98);
        if (displacement.detected) conf = Math.min(conf + 10, 98);
        if (zoneReaction.confirmed) conf = Math.min(conf + 15, 98);
        
        const tfAlign = `Trend:${trendTF}→Structure:${structureTF}→Entry:${entryTF}`;
        return {
            timeframe: tfToAnalyze, trendTF, structureTF, entryTF, sniperTF, direction, entry, sl: slResult.price, tp1: tps.tp1, tp2: tps.tp2, tp3: tps.tp3, confidence: conf, zone, slResult, displacement, sniperRej, probCheck, turtleSoup, mtf, msnr, twelveIndicators, pathCheck, tfAlign, sweeps, imbalances, mss, volatility, crt, fvgsAll, breakersAll, obsAll, rs, apiATR, trends, magnetism, zoneReaction, zoneTouches, entryReady, rrUsed: tps.rrUsed, htfValidation
        };
    } catch (e) { console.error(`Timeframe calculation issue ${tfToAnalyze}:`, e); return null; }
}

// ============================================
// AI - COACH ANALYSIS RISK LAYER
// ============================================
async function askAIWithAllResults(allResults, price, htfData) {
    if (!DEEPSEEK_API_KEY || allResults.length === 0) return null;
    showNotif('🤖 AI entry audit check...', 'info');
    let tfSummary = '';
    for (const r of allResults) {
        tfSummary += `${r.timeframe}: ${r.direction} | Zone Context: ${r.zone.pricingContext} | React: ${r.zoneReaction?.confirmed ? r.zoneReaction.type : 'None'} | Conf:${r.confidence}%\n`;
    }
    const best = allResults[0]; const prec = getPrec(pair);
    const prompt = `You are TheGhostMachine execution model. Ensure we enter ONLY inside validated Equilibrium boundaries.
PAIR: ${pair} | CURRENT PRICE: $${price.toFixed(prec)}
ALL SCANNED TARGET CHARTS:
${tfSummary}
TOP PICK: TF: ${best.timeframe} | Dir: ${best.direction} | Zone Limits: $${best.zone.low.toFixed(prec)}-$${best.zone.high.toFixed(prec)} (${best.zone.pricingContext})
Target Entry: $${best.entry.toFixed(prec)} | SL: $${best.sl.toFixed(prec)} | TP1: $${best.tp1.toFixed(prec)}
Confirm execution parameters. Return ONLY valid JSON format with trade_signal_Theghostmachine block.`;

    try {
        const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are an expert ICT risk executor model. Return ONLY clear JSON layouts.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:1000})});
        const d = await r.json();
        if (d.choices?.[0]) { const m = d.choices[0].message.content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
    } catch(e) { console.error('AI risk audit failed:', e); }
    return null;
}

// ============================================
// DASHBOARD ANALYSIS PANEL SCANNER LOOP
// ============================================
async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn'); const scanStatus = document.getElementById('scanStatus');
    const scanText = document.getElementById('scanText'); const scanFill = document.getElementById('scanProgressFill');
    
    btn.classList.add('loading'); btn.disabled = true; scanStatus.classList.remove('hidden');
    if (!TWELVE_DATA_KEY) { showSetup(); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; }
    
    showNotif('🔍 Scanning premium/discount equilibrium pools...', 'info');
    try {
        const price = await getPrice(); if (!price) throw new Error('Could not verify asset market price baseline');
        const mtfTrendsData = {}; const tfs = ['5M', '15M', '1H', '4H', '1D'];
        for (let t of tfs) { mtfTrendsData[t] = await getQuoteDirection(t); }
        await updateMTFDisplay();
        
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(getPrec(pair))}`;
        if (lastPrice) { const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2); const ce = document.getElementById('priceChange'); ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`; ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`; }
        lastPrice = price;
        
        const results = []; const timeframesToScan = ['5M', '15M', '1H', '4H', '1D']; const htfData = {};
        scanText.innerHTML = 'Loading high timeframe contexts...';
        const dailyData = await getHistory('1D'); const h4Data = await getHistory('4H');
        if (dailyData) htfData['1D'] = dailyData; if (h4Data) htfData['4H'] = h4Data;
        
        for (let i = 0; i < timeframesToScan.length; i++) {
            const tfScan = timeframesToScan[i]; scanText.innerHTML = `Scanning ${tfScan}... (${i + 1}/${timeframesToScan.length})`;
            scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%';
            const result = await analyzeTimeframe(tfScan, price, htfData);
            if (result) results.push(result);
        }
        
        // STRICT RISK FILTER LAYER: Isolated Macro Ordering Sequence
        const macroOrder = ['1D', '4H', '1H']; let selectedSetup = null;
        for (let tf of macroOrder) { 
            let match = results.find(r => r.timeframe === tf); 
            if (match) { selectedSetup = match; break; } 
        }
        
        // If no high timeframe structural footprint exists, trigger macro consolidation exit
        if (!selectedSetup) {
            showNotif('⚠️ Macro ranges flat - Filtering out lower timeframe noise', 'warning');
            document.getElementById('jsonOutput').innerHTML = JSON.stringify({
                auto_scan_result: {
                    date: new Date().toISOString().split('T')[0],
                    pair, current_price: price,
                    status: 'CONSOLIDATION_FLAT',
                    reason: 'No high-timeframe setups found on 1D, 4H, or 1H charts. Standalone 15M/5M setups are locked out for protection.',
                    multi_timeframe_trends: mtfTrendsData
                }
            }, null, 2);
            btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return;
        }
        
        const best = selectedSetup;
        if (best.zone && best.zone.quality === 'C') best.confidence = Math.max(best.confidence - 25, 20);
        
        scanText.innerHTML = '🤖 Auditing zone confluences via AI...';
        const aiResult = await askAIWithAllResults(results, price, htfData);
        scanStatus.classList.add('hidden');
        
        const prec = getPrec(pair); const risk = Math.abs(best.entry - best.sl); const rr = best.rrUsed || 4;
        const rrDisplay = (Math.abs(best.tp1 - best.entry) / risk).toFixed(1); const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
        const htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction);
        
        best.confidence = Math.max(best.confidence - htfConfluence.penalty, 10);
        
        let aiConviction = 'MEDIUM', aiApproved = true, executionDecision = best.entryReady ? 'enter_now' : 'wait_for_reaction', waitCondition = 'Wait for key swing mitigation confirmation';
        let finalEntry = best.entry, finalZoneLow = best.zone.low, finalZoneHigh = best.zone.high;
        let aiEntryLogic = '', aiSlLogic = '', aiKeyReason = '', aiRiskWarning = '', aiOutcomes = [];
        
        if (aiResult && aiResult.trade_signal_Theghostmachine) {
            const ts = aiResult.trade_signal_Theghostmachine;
            aiApproved = ts.approved !== false; executionDecision = ts.execution_decision || executionDecision;
            waitCondition = ts.wait_condition || waitCondition;
            if (executionDecision === 'enter_now') aiConviction = 'HIGH'; else if (executionDecision === 'wait_for_reaction') aiConviction = 'WAIT'; else aiConviction = 'SKIP';
            
            if (ts.entry_refinement && ts.entry_refinement.low && ts.entry_refinement.high) {
                finalZoneLow = ts.entry_refinement.low; finalZoneHigh = ts.entry_refinement.high; finalEntry = (finalZoneLow + finalZoneHigh) / 2;
            }
            aiEntryLogic = ts.analysis?.entry_logic || ''; aiSlLogic = ts.analysis?.sl_logic || ''; aiKeyReason = ts.analysis?.key_reason || ''; aiRiskWarning = ts.analysis?.risk_warning || ''; aiOutcomes = ts.analysis?.possible_outcomes || [];
            if (aiApproved) best.confidence = Math.min(best.confidence + 10, 98); else best.confidence = Math.max(best.confidence - 20, 10);
        }
        
        // UNCOMPRESSED FULL JSON DASHBOARD OUTPUT
        const out = {
            auto_scan_result: {
                date: new Date().toISOString().split('T')[0], 
                time: new Date().toISOString().split('T')[1].split('.')[0], 
                pair, 
                current_price: price, 
                multi_timeframe_trends: mtfTrendsData, 
                best_timeframe: best.timeframe, 
                total_setups_found: results.length, 
                ai_approved: aiApproved, 
                execution_decision: executionDecision, 
                wait_condition: waitCondition, 
                pricing_equilibrium_context: best.zone.pricingContext,
                htf_confluence: htfConfluence,
                trade_signal: {
                    trade_type: best.direction === 'BUY' ? 'BUY-LIMIT' : 'SELL-LIMIT', 
                    entry_price: finalEntry, 
                    entry_zone: { low: finalZoneLow, high: finalZoneHigh }, 
                    entry_ready: best.entryReady, 
                    stop_loss: best.sl, 
                    sl_reason: best.slResult.reason, 
                    risk_amount: risk.toFixed(prec), 
                    stop_loss_pct: ((risk / best.entry) * 100).toFixed(2) + '%', 
                    take_profit_1: best.tp1, 
                    take_profit_2: best.tp2, 
                    take_profit_3: best.tp3, 
                    risk_reward: '1:' + rrDisplay, 
                    confidence: best.confidence, 
                    conviction: aiConviction, 
                    entry_reasoning: aiEntryLogic || `${best.zone.src} structural discount footprint`, 
                    sl_reasoning: aiSlLogic || best.slResult.reason, 
                    key_reason: aiKeyReason || `${best.zone.confluence}`, 
                    zone_quality: best.zone.quality, 
                    zone_source: best.zone.src, 
                    imbalance_magnet: best.zone.hasImbalance, 
                    zone_reaction: best.zoneReaction, 
                    zone_magnetism: best.magnetism, 
                    path_clearance: best.pathCheck, 
                    probability: best.probCheck.probability, 
                    turtle_soup: best.turtleSoup, 
                    crt_analysis: best.crt, 
                    order_blocks_found: best.obsAll ? best.obsAll.length : 0, 
                    twelve_data_indicators: best.twelveIndicators, 
                    msnr_levels: best.msnr,
                    sweeps: best.sweeps.filter(s => s.distance < best.apiATR * 2).map(s => ({ type: s.type, level: s.level, distance: s.distance })),
                    analysis: {
                        trend_detection: `${best.mtf.direction} (${best.mtf.strength}/5 TFsAligned)`, 
                        volatility_level: `${best.volatility.level}`, 
                        market_structure: { mss: best.mss ? best.mss.type : 'None', displacement: best.displacement.detected, sniper_rejection: best.sniperRej.confirmed, zone_reaction: best.zoneReaction, htf_validated: best.htfValidation?.passed || false },
                        technical_indicators: [`RSI: ${best.twelveIndicators.rsi || best.rs.toFixed(1)}`, `MACD: ${best.twelveIndicators.macd || 'N/A'}`, `ATR: ${best.apiATR.toFixed(prec)}`, `FVG: ${best.fvgsAll.length}`, `OB: ${best.obsAll ? best.obsAll.length : 0}`]
                    }
                }
            }
        };
        
        document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);
        analysis = { signalType: st, idealEntry: finalEntry, currentPrice: price, stopLoss: best.sl, takeProfit1: best.tp1, takeProfit2: best.tp2, takeProfit3: best.tp3, confidence: best.confidence, entryZoneLow: finalZoneLow, entryZoneHigh: finalZoneHigh, entryReady: best.entryReady, executionDecision, invalidationPrice: best.invalidationPrice };
        document.getElementById('executeBtn').disabled = false;
        
        const execLabel = executionDecision === 'enter_now' ? '🟢ENTRY READY' : '🟡WAITING FOR REACTION';
        showNotif(`✅ Macro Setup Matched | ${execLabel} ${best.timeframe} | ${best.zone.pricingContext}`, 'success');
    } catch (e) { console.error(e); showNotif('Scan Error: ' + e.message, 'error'); scanStatus.classList.add('hidden'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; }
}

// ============================================
// LIMIT ORDERS MANAGEMENT TRACKER
// ============================================
function loadLimitOrder(){const s=localStorage.getItem('limitOrder');if(s){try{limitOrder=JSON.parse(s);updateLimitUI();startMonitor();}catch(e){}}}
function saveLimit(o){limitOrder=o;localStorage.setItem('limitOrder',JSON.stringify(o));updateLimitUI();}
function clearLimit(){limitOrder=null;localStorage.removeItem('limitOrder');if(priceTimer)clearInterval(priceTimer);updateLimitUI();}
function cancelLimit(){clearLimit();showNotif('❌ Cancelled active limit monitoring','warning');}
function updateLimitUI(){const t=document.getElementById('limitOrderText'),c=document.getElementById('cancelLimitBtn');if(limitOrder){const prec=getPrec(pair);t.innerHTML=`⏳ ${limitOrder.signalType} MONITORING @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}`;t.className='active';c.classList.remove('hidden');document.getElementById('executeBtn').innerHTML='⏳ Pending Order fill...';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)';}else{t.innerHTML='No active limit monitoring pending';t.className='';c.classList.add('hidden');document.getElementById('executeBtn').innerHTML='⚡ Place Safe Limit Order';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)';}}
function startMonitor(){if(priceTimer)clearInterval(priceTimer);priceTimer=setInterval(async()=>{if(!limitOrder){clearInterval(priceTimer);return;}const p=await getPrice();if(!p)return;const prec=getPrec(pair);document.getElementById('currentPrice').innerHTML=`$${p.toFixed(prec)}`;if((limitOrder.signalType==='LONG'&&p<=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT'&&p>=limitOrder.idealEntry)){clearLimit();showNotif(`✅ Safe Zone Entry Filled! Target filled at $${p.toFixed(prec)}`,'success');try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){}}},2000);}
function handleLimit(){if(!analysis||analysis.signalType==='NEUTRAL'){showNotif('No active structural context found','error');return;}if(limitOrder){cancelLimit();return;}const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry,stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,entryZoneLow:analysis.entryZoneLow,entryZoneHigh:analysis.entryZoneHigh,entryReady:analysis.entryReady,executionDecision:analysis.executionDecision,createdAt:new Date().toISOString()};saveLimit(o);startMonitor();showNotif(`📝 Limit tracking successfully placed at $${o.idealEntry.toFixed(getPrec(pair))}`,'info');}
function copyJson(){const t=document.getElementById('jsonOutput').innerHTML;if(t.includes('Click')){showNotif('Execute scan first','warning');return;}navigator.clipboard.writeText(t).then(()=>showNotif('📋 JSON profiles copied','success')).catch(()=>showNotif('Failed to write clipboard data','error'));}
function showNotif(m,t){const n=document.getElementById('notification');n.innerHTML=m;n.className=`notification ${t}`;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3000);}