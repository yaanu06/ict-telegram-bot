// Initialize 
const tg = window.Telegram.WebApp; 
if (tg) { tg.expand(); tg.ready(); } 
 
// ============================================ 
// CONFIG 
// ============================================ 
let TWELVE_DATA_KEY = '', DEEPSEEK_API_KEY = ''; 
const TWELVE_DATA_BASE = 'https://api.twelvedata.com'; 
let DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
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
 
function getSLBufferForTF(apiATR, tfUsed, currentPair) { 
    const s = getMarketSettings(currentPair || pair); 
    const tfBuffer = s.slBuffers[tfUsed] || s.slBuffers['15M'] || 3; 
    return Math.max(tfBuffer, apiATR * 0.3); 
} 
 
// ============================================ 
// API KEYS MANAGEMENT 
// ============================================ 
async function loadKeys() {  
    const s = localStorage.getItem('ict_bot_keys');  
    if (s) { try { const k = JSON.parse(s); TWELVE_DATA_KEY = k.twelveData||''; DEEPSEEK_API_KEY = k.deepseek||''; DEEPSEEK_API_URL = k.deepseekUrl || 'https://api.deepseek.com/chat/completions'; return true; } catch(e) {} }
    return false;  
} 
async function saveKeys(tk, dk, du) { localStorage.setItem('ict_bot_keys', JSON.stringify({twelveData:tk, deepseek:dk, deepseekUrl:du})); TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; DEEPSEEK_API_URL = du || 'https://api.deepseek.com/chat/completions'; updateKeyStatus(); }
function clearKeys() { localStorage.removeItem('ict_bot_keys'); TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'; updateKeyStatus(); showNotif('🗑️ Keys removed','warning'); }
function updateKeyStatus() {  
    const ts=document.getElementById('twelveStatus'),ds=document.getElementById('deepseekStatus');  
    if(ts) { ts.innerHTML=TWELVE_DATA_KEY?'✅ Active':'❌ Missing'; ts.className='status-badge '+(TWELVE_DATA_KEY?'active':'inactive'); } 
    if(ds) { ds.innerHTML=DEEPSEEK_API_KEY?'✅ Active ('+DEEPSEEK_API_KEY.substring(0,5)+'...)':'❌ Missing'; ds.className='status-badge '+(DEEPSEEK_API_KEY?'active':'inactive'); } 
    const keyBtn = document.getElementById('updateKeysBtn');
    if(keyBtn) { keyBtn.innerHTML = (TWELVE_DATA_KEY && DEEPSEEK_API_KEY) ? '🔑 Manage Keys' : '🔑 Setup Keys'; }
} 
function showSetup() {  
    const ex=document.getElementById('setupOverlay'); if(ex)ex.remove();  
    document.body.insertAdjacentHTML('beforeend', `<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><label>🌐 Custom AI URL:</label><input type="text" id="urlInput" class="setup-input" value="${DEEPSEEK_API_URL}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button><div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div></div></div>` );
    document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim(),du=document.getElementById('urlInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk,du);document.getElementById('setupOverlay').remove();});
    document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';document.getElementById('urlInput').value='';});
    document.getElementById('testAiBtn').addEventListener('click',async()=>{const dk=document.getElementById('dsInput').value.trim();const du=document.getElementById('urlInput').value.trim() || 'https://api.deepseek.com/chat/completions';if(!dk){document.getElementById('testResult').innerHTML='❌ Enter key first';return;}document.getElementById('testResult').innerHTML='🔄 Testing...';try{const r=await fetch(du,{method:'POST',headers:{'Content-Type':'application/json','Authorization': `Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});const d=await r.json();document.getElementById('testResult').innerHTML=d.choices?'✅ AI working!':'❌ Error: '+(d.error?.message||'Unknown');}catch(e){document.getElementById('testResult').innerHTML='❌ Connection failed';}});
    document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove());  
} 
 
// ============================================ 
// STATE 
// ============================================ 
let pair='XAU/USD',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null; 
let cachedPrice = null, priceCacheTime = 0; 
const PRICE_CACHE_DURATION = 5000; 
 
document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();}); 
function init(){ 
    updateTime(); setInterval(updateTime,1000); 
    const el = (id) => document.getElementById(id);
    if(el('analyzeBtn')) el('analyzeBtn').addEventListener('click',runAutoScan); 
    if(el('executeBtn')) el('executeBtn').addEventListener('click',handleLimit); 
    if(el('cancelLimitBtn')) el('cancelLimitBtn').addEventListener('click',cancelLimit); 
    if(el('copyJsonBtn')) el('copyJsonBtn').addEventListener('click',copyJson); 
    if(el('updateKeysBtn')) el('updateKeysBtn').addEventListener('click',showSetup); 
    if(el('pairSelect')) el('pairSelect').addEventListener('change',e=>pair=e.target.value); 
    document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);})); 
    loadLimitOrder(); 
} 
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML= `${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;} 
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];} 
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;} 
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF', 'NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);} 
function getPrec(p){const s=getMarketSettings(p);return s.prec;} 
 
// ============================================ 
// API FUNCTIONS 
// ============================================ 
async function getPrice() { 
    const now = Date.now(); 
    if (cachedPrice !== null && (now - priceCacheTime) < PRICE_CACHE_DURATION) return cachedPrice; 
    if (!TWELVE_DATA_KEY) return null; 
    try { 
        const r = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);
        const d = await r.json(); 
        if (d.price) { calls++; document.getElementById('apiSource').innerHTML = '📡 Live'; cachedPrice = +d.price; priceCacheTime = now; return cachedPrice; } 
    } catch(e) { if (cachedPrice !== null) return cachedPrice; } 
    return null; 
} 
async function getQuote(tfStr){ 
    if(!TWELVE_DATA_KEY)return null; 
    const interval = QUOTE_INTERVAL_MAP[tfStr] || '1day'; 
    try{ 
        const r=await fetch(`${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);
        const d=await r.json(); 
        if(d.code && d.code !== 200) throw new Error(d.message || 'API Error');
        if(d.open && d.close){calls++;return{open:+d.open,close:+d.close,is_market_open:d.is_market_open};} 
    }catch(e){ console.error(`Quote error (${tfStr}):`, e); } 
    return null; 
} 
 
// 🟢 LIVE CANDLE DIRECTION (FOR UI DASHBOARD ONLY) 
async function getLiveCandleDirection(tfStr, cachedData = null) { 
    try { 
        const data = cachedData || await getHistory(tfStr); 
        if (!data || data.length < 2) return 'NEUTRAL'; 
        const currentCandle = data[data.length - 1]; // Live/unclosed 
        const currentPrice = await getPrice(); 
        if (!currentPrice) return 'NEUTRAL'; 
        if (currentPrice > currentCandle.o) return 'BULLISH'; 
        if (currentPrice < currentCandle.o) return 'BEARISH'; 
        return 'NEUTRAL'; 
    } catch(e) { return 'NEUTRAL'; } 
} 
 
// 🔵 CLOSED CANDLE/EMA DIRECTION (FOR ANALYSIS & SCORING ONLY) 
async function getQuoteDirection(tfStr, cachedData = null) { 
    try { 
        const data = cachedData || await getHistory(tfStr); 
        if (data && data.length >= 50) return detectTrend(data);  
        else if (data && data.length >= 3) { 
            const closedCandle = data[data.length - 2];  
            if (closedCandle.c > closedCandle.o) return 'BULLISH'; 
            if (closedCandle.c < closedCandle.o) return 'BEARISH'; 
        } 
    } catch(e) {} 
    return 'NEUTRAL'; 
} 
 
async function getHistory(tfStr){ 
    if(!TWELVE_DATA_KEY)return null; 
    try{ 
        const r=await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const d=await r.json(); 
        if(d.code && d.code !== 200) throw new Error(d.message || 'API Error');
        if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();} 
    }catch(e){ console.error(`History error (${tfStr}):`, e); } 
    return null; 
} 
async function getTechnicalIndicators(tfUsed){ 
    if(!TWELVE_DATA_KEY)return{}; 
    const symbol=encodeURIComponent(SYMBOLS[pair]), interval=TF_MAP[tfUsed], ind={}; 
    const endpoints = [
        {name: 'rsi', url: `/rsi?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'macd', url: `/macd?symbol=${symbol}&interval=${interval}`},
        {name: 'adx', url: `/adx?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'bbands', url: `/bbands?symbol=${symbol}&interval=${interval}&time_period=20`},
        {name: 'stoch', url: `/stoch?symbol=${symbol}&interval=${interval}`},
        {name: 'cci', url: `/cci?symbol=${symbol}&interval=${interval}&time_period=20`},
        {name: 'atr', url: `/atr?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'williams', url: `/williams?symbol=${symbol}&interval=${interval}&time_period=14`},
        {name: 'sar', url: `/sar?symbol=${symbol}&interval=${interval}&acceleration=0.02&maximum=0.2`},
        {name: 'ichimoku', url: `/ichimoku?symbol=${symbol}&interval=${interval}`}
    ];
    await Promise.all(endpoints.map(async (e) => {
        try {
            const r = await fetch(`${TWELVE_DATA_BASE}${e.url}&apikey=${TWELVE_DATA_KEY}`);
            const d = await r.json();
            if (!d.values) return;
            calls++;
            const v = d.values[0];
            if (e.name === 'rsi') ind.rsi = parseFloat(v.rsi);
            if (e.name === 'macd') { ind.macd = parseFloat(v.macd); ind.macd_signal = parseFloat(v.macd_signal); ind.macd_hist = parseFloat(v.macd_hist); }
            if (e.name === 'adx') ind.adx = parseFloat(v.adx);
            if (e.name === 'bbands') { ind.bb_upper = parseFloat(v.upper_band); ind.bb_middle = parseFloat(v.middle_band); ind.bb_lower = parseFloat(v.lower_band); }
            if (e.name === 'stoch') { ind.stoch_k = parseFloat(v.slow_k); ind.stoch_d = parseFloat(v.slow_d); }
            if (e.name === 'cci') ind.cci = parseFloat(v.cci);
            if (e.name === 'atr') ind.atr_api = parseFloat(v.atr);
            if (e.name === 'williams') ind.williams_r = parseFloat(v.williams);
            if (e.name === 'sar') ind.sar = parseFloat(v.sar);
            if (e.name === 'ichimoku') { ind.ichimoku_tenkan = parseFloat(v.tenkan_sen); ind.ichimoku_kijun = parseFloat(v.kijun_sen); ind.ichimoku_senkou_a = parseFloat(v.senkou_span_a); ind.ichimoku_senkou_b = parseFloat(v.senkou_span_b); }
        } catch (err) { console.error(`Error fetching ${e.name}:`, err); }
    }));
    return ind; 
} 
 
// ============================================ 
// TECHNICALS MATH 
// ============================================ 
const ema=(p,n)=>{const m=2/(n+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push((p[i]-e[i-1])*m+e[i-1]);return e;};
const rsi=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;}; 
function detectFVG(d){let f=[],active=[];const len=d.length;for(let i=1;i<len-1;i++){const next=d[i+1];if(active.length>0){let keep=0;for(let k=0;k<active.length;k++){let g=active[k];if(g.type==='bull'){if(next.l<=g.h && next.l>=g.l)g.fresh=false;else active[keep++]=g;}else{if(next.h>=g.l && next.h<=g.h)g.fresh=false;else active[keep++]=g;}}active.length=keep;}const prev=d[i-1];const thresh=next.c*0.0005;if(prev.h<next.l && next.l-prev.h>thresh){let g={type:'bull',l:prev.h,h:next.l,m:(prev.h+next.l)/2,fresh:true};f.push(g);active.push(g);}if(prev.l>next.h && prev.l-next.h>thresh){let g={type:'bear',l:next.h,h:prev.l,m:(next.h+next.l)/2,fresh:true};f.push(g);active.push(g);}}return f;}
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};} 
function detectMSS(d){if(d.length<21)return null;let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-21,-1)),rL=Math.min(...l.slice(-21,-1)),cP=c[c.length-1],dis=detectDisplacement(d,cP>rH?'BUY':'SELL');if(cP>rH && dis.detected)return{type:'BULL',level:rH,displaced:true};if(cP<rL && dis.detected)return{type:'BEAR',level:rL,displaced:true};if(cP>rH)return{type:'BULL',level:rH,displaced:false};if(cP<rL)return{type:'BEAR',level:rL,displaced:false};return null;} 
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i && h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i && l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;} 
function detectOrderBlocks(data, direction) { 
    const obs = []; 
    for (let i = 2; i < data.length - 1; i++) { 
        if (direction === 'BUY') { if (data[i].c < data[i].o && data[i+1].c > data[i+1].o && data[i+1].h > data[i].h && data[i+1].c > data[i].h) obs.push({ type: 'BULL_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i }); }  
        else { if (data[i].c > data[i].o && data[i+1].c < data[i+1].o && data[i+1].l < data[i].l && data[i+1].c < data[i].l) obs.push({ type: 'BEAR_OB', high: data[i].h, low: data[i].l, close: data[i].c, open: data[i].o, index: i }); } 
    } 
    return obs; 
} 
function countZoneTouches(data, zone, direction) { let touches = 0; for (let i = data.length - 20; i < data.length; i++) { if (i < 0) continue; const c = data[i]; if (direction === 'BUY') { if (c.l <= zone.high && c.l >= zone.low) touches++; } else { if (c.h >= zone.low && c.h <= zone.high) touches++; } } return touches; } 
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';} 
function findPDArrays(data, direction) { 
    const arrays = [], fvgs = detectFVG(data), obs = detectOrderBlocks(data, direction), breakers = detectBreakers(data); 
    if (direction === 'BUY') { fvgs.filter(f => f.type === 'bull').forEach(f => arrays.push({ low: f.l, high: f.h, src: 'FVG' })); obs.forEach(o => arrays.push({ low: o.low, high: o.high, src: 'OB' })); breakers.filter(b => b.type === 'BULL').forEach(b => arrays.push({ low: b.p * 0.998, high: b.p * 1.002, src: 'Breaker' })); }  
    else { fvgs.filter(f => f.type === 'bear').forEach(f => arrays.push({ low: f.l, high: f.h, src: 'FVG' })); obs.forEach(o => arrays.push({ low: o.low, high: o.high, src: 'OB' })); breakers.filter(b => b.type === 'BEAR').forEach(b => arrays.push({ low: b.p * 0.998, high: b.p * 1.002, src: 'Breaker' })); } 
    return arrays; 
} 
function isZoneWithinHTFArray(entryZone, htfArrays) { for (const arr of htfArrays) { if (entryZone.low >= arr.low && entryZone.high <= arr.high) return { contained: true, parentArray: arr }; if (entryZone.low <= arr.high && entryZone.high >= arr.low) return { contained: true, parentArray: arr, partial: true }; } return { contained: false, parentArray: null }; } 
function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY' && lb>avg*2.5 && lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL' && lb>avg*2.5 && lc[4].c<lc[4].o)return{detected:true};return{detected:false};} 
async function checkSniperRejection(zone,direction,sniperTF,cachedData=null){const dSn=cachedData||await getHistory(sniperTF);if(!dSn||dSn.length<3)return{confirmed:false};const lc=dSn[dSn.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.high && lc.l>=zone.low;if(t && wick>body*2 && lc.c>lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.low && lc.h<=zone.high;if(t && wick>body*2 && lc.c<lc.o)return{confirmed:true};}return{confirmed:false};} 
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal'};return{level:'Low - Consolidation',desc:'Tight ranges'};} 
function detectLiquiditySweeps(data, currentPrice) {
    const sweeps = [];
    const a = atr(data, 14);
    const maxDistance = a * 3;
    const len = data.length;

    for (let i = 10; i < len - 3; i++) {
        let maxH = data[i - 5].h;
        let minL = data[i - 5].l;
        for (let j = i - 4; j < i; j++) {
            if (data[j].h > maxH) maxH = data[j].h;
            if (data[j].l < minL) minL = data[j].l;
        }

        if (Math.abs(maxH - currentPrice) <= maxDistance) {
            let countH = 0;
            const threshH = maxH * 0.001;
            for (let j = i - 5; j < i; j++) {
                if (Math.abs(data[j].h - maxH) <= threshH) countH++;
            }
            if (countH >= 2) {
                let hasSweep = false;
                const targetH = maxH * 1.001;
                for (let j = i; j < i + 4; j++) {
                    if (data[j].h > targetH) {
                        hasSweep = true;
                        break;
                    }
                }
                if (hasSweep && data[i + 3].c < maxH) {
                    sweeps.push({ type: 'BUY_SIDE', level: maxH, distance: Math.abs(maxH - currentPrice), direction: 'BEARISH' });
                }
            }
        }

        if (Math.abs(minL - currentPrice) <= maxDistance) {
            let countL = 0;
            const threshL = minL * 0.001;
            for (let j = i - 5; j < i; j++) {
                if (Math.abs(data[j].l - minL) <= threshL) countL++;
            }
            if (countL >= 2) {
                let hasSweepL = false;
                const targetL = minL * 0.999;
                for (let j = i; j < i + 4; j++) {
                    if (data[j].l < targetL) {
                        hasSweepL = true;
                        break;
                    }
                }
                if (hasSweepL && data[i + 3].c > minL) {
                    sweeps.push({ type: 'SELL_SIDE', level: minL, distance: Math.abs(minL - currentPrice), direction: 'BULLISH' });
                }
            }
        }
    }
    return sweeps.sort((a, b) => a.distance - b.distance);
}
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);} 
function detectTurtleSoup(data){if(data.length<15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow<keyLow*0.999 && cc>keyLow && cc>co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];if(recentHigh>keyHigh*1.001 && cc<keyHigh && cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};} 
function detectCRT(data, direction) {
    if (data.length < 10) return { detected: false, pattern: 'Neutral', rangeRatio: 1 };

    const lc = data.slice(-5);
    const ranges = lc.map(c => c.h - c.l);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const lastRange = ranges[ranges.length - 1];

    // More flexible thresholds
    const expanding = lastRange > avgRange * 1.2;  // Changed from 1.5
    const contracting = lastRange < avgRange * 0.7; // Changed from 0.5

    return {
        detected: true,  // Always return true if we have data
        pattern: expanding ? 'Expanding' : (contracting ? 'Contracting' : 'Neutral'),
        rangeRatio: (lastRange / avgRange).toFixed(2),
        signal: expanding ? (direction === 'BUY' ? 'Bullish momentum' : 'Bearish momentum') :
                (contracting ? 'Consolidation' : 'Neutral')
    };
}
function checkPathClearance(entryData,entry,tp,direction){const obstacles=[];const fvgs=detectFVG(entryData);const swings=findSwings(entryData,3);if(direction==='BUY'){const bearFVGs=fvgs.filter(f=>f.type==='bear' && f.l>entry && f.l<tp);if(bearFVGs.length>0)obstacles.push('Bearish FVG');const swingHighs=swings.H.filter(s=>s.p>entry && s.p<tp);if(swingHighs.length>0)obstacles.push('Swing high');}else{const bullFVGs=fvgs.filter(f=>f.type==='bull' && f.h>tp && f.h<entry);if(bullFVGs.length>0)obstacles.push('Bullish FVG');const swingLows=swings.L.filter(s=>s.p>tp && s.p<entry);if(swingLows.length>0)obstacles.push('Swing low');}return{clear:obstacles.length===0,obstacles,count:obstacles.length};} 
function checkZoneReaction(data, zone, direction) { 
    if (data.length < 3) return { confirmed: false, type: 'none', strength: 'NONE' }; 
    const last = data[data.length - 1], prev = data[data.length - 2], prev2 = data[data.length - 3]; 
    if (direction === 'BUY') { 
        const wickedIntoZone = last.l <= zone.high && last.l >= zone.low, closedAbove = last.c > zone.high; 
        const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c > prev.h; 
        const bullishPinbar = (last.c - last.l) > Math.abs(last.c - last.o) * 2 && last.c > last.o; 
        const rejectionInZone = wickedIntoZone && (closedAbove || bullishPinbar || last.c > last.o); 
        const followThrough = last.c > prev.c && prev.c > prev2.c && last.c > last.o; 
        if (bullishEngulf && followThrough) return { confirmed: true, type: 'bullish engulf + momentum', strength: 'STRONG' }; 
        if (bullishEngulf) return { confirmed: true, type: 'bullish engulf', strength: 'STRONG' }; 
        if (rejectionInZone && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' }; 
        if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick' , strength: 'MODERATE' }; 
        if (last.c > prev.c && last.c > prev2.c && last.c > last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' }; 
        return { confirmed: false, type: 'none', strength: 'NONE' }; 
    } else { 
        const wickedIntoZone = last.h >= zone.low && last.h <= zone.high, closedBelow = last.c < zone.low; 
        const bearishEngulf = last.c < last.o && prev.c > prev.o && last.c < prev.l; 
        const bearishPinbar = (last.h - last.c) > Math.abs(last.c - last.o) * 2 && last.c < last.o; 
        const rejectionInZone = wickedIntoZone && (closedBelow || bearishPinbar || last.c < last.o); 
        const followThrough = last.c < prev.c && prev.c < prev2.c && last.c < last.o; 
        if (bearishEngulf && followThrough) return { confirmed: true, type: 'bearish engulf + momentum', strength: 'STRONG' }; 
        if (bearishEngulf) return { confirmed: true, type: 'bearish engulf', strength: 'STRONG' }; 
        if (rejectionInZone && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' }; 
        if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick' , strength: 'MODERATE' }; 
        if (last.c < prev.c && last.c < prev2.c && last.c < last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' }; 
        return { confirmed: false, type: 'none', strength: 'NONE' }; 
    } 
} 
function checkZoneMagnetism(entryData, price, entry, direction) { 
    const imbalances = findImbalances(entryData), sweeps = detectLiquiditySweeps(entryData, price); 
    let score = 0; const checks = []; 
    if (direction === 'BUY') { const pullingImbalances = imbalances.filter(i => i.type === 'BEARISH' && i.low > entry && i.high < price); if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bearish imbalance(s) magnet`}); } else { checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'}); } }  
    else { const pullingImbalances = imbalances.filter(i => i.type === 'BULLISH' && i.low > price && i.high < entry); if (pullingImbalances.length > 0) { score += 30; checks.push({name: 'Imbalance pulling toward zone', passed: true, detail: `${pullingImbalances.length} bullish imbalance(s) magnet`}); } else { checks.push({name: 'Imbalance pulling toward zone', passed: false, detail: 'No imbalance magnet'}); } } 
    const supportingSweeps = sweeps.filter(s => direction === 'BUY' ? s.direction === 'BULLISH' : s.direction === 'BEARISH'); 
    if (supportingSweeps.length > 0) { score += 25; checks.push({name: 'Sweeps support direction', passed: true, detail: `${supportingSweeps.length} sweep(s)`}); } else { checks.push({name: 'Sweeps support direction', passed: false, detail: 'No supporting sweeps'}); } 
    const closes = entryData.map(c => c.c), e20 = ema(closes, 20), e50 = ema(closes, 50); 
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
    if (displacement.detected) { score += 10; checks.push({name: 'Displacement momentum', passed: true, detail: 'Detected'}); } else { checks.push({name: 'Displacement momentum', passed: false, detail: 'None'}); } 
    const magnetism = score >= 60 ? 'STRONG' : (score >= 35 ? 'MODERATE' : 'WEAK'); 
    return { magnetism, score, maxScore: 100, checks, likelyToReach: score >= 35, summary: `Zone magnetism: ${magnetism} (${score}/100)` }; 
} 
async function checkHTFConfluenceAsync(dailyData, h4Data, entryDirection) { const dailyDir = await getQuoteDirection('1D', dailyData), h4Dir = await getQuoteDirection('4H', h4Data), entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH'; if (dailyDir === entryDir && h4Dir === entryDir) return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 }; if (dailyDir === entryDir || h4Dir === entryDir) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: 15 }; if (dailyDir === 'NEUTRAL' && h4Dir === 'NEUTRAL') return { level: 'NEUTRAL', daily: dailyDir, h4: h4Dir, penalty: 5 }; return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 30 }; } 
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};} 
function findPrecisionEntry(data,price,direction,msnr){ 
    const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4),imbalances=findImbalances(data),orderBlocks=detectOrderBlocks(data,direction); 
    const h=Math.max(...data.slice(-20).map(c=>c.h)),l=Math.min(...data.slice(-20).map(c=>c.l)),r=h-l;
    const oteLow = direction==='BUY' ? l+r*0.618 : h-r*0.79, oteHigh = direction==='BUY' ? l+r*0.79 : h-r*0.618;
    let allZones=[]; 
    if(direction==='BUY'){ 
        fvgs.filter(f=>f.type==='bull' && f.l<price && f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(f.l>=oteLow && f.l<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BULL' && Math.abs(b.p-f.l)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.L.find(x=>Math.abs(x.p-f.l)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-f.l)<f.l*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.low>=oteLow && ob.low<=oteHigh){s+=35;cf.push('OTE');}if(swings.L.find(x=>Math.abs(x.p-ob.low)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-ob.low)<ob.low*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-ob.low)<ob.low*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        if(msnr.nearestSupport && msnr.nearestSupport<price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bull' && Math.abs(f.l-msnr.nearestSupport)<msnr.nearestSupport*0.003)){s+=25;cf.push('FVG');}if(swings.L.find(x=>Math.abs(x.p-msnr.nearestSupport)<msnr.nearestSupport*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-msnr.nearestSupport)<msnr.nearestSupport*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:msnr.nearestSupport*0.998,high:msnr.nearestSupport*1.002,p:msnr.nearestSupport,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});} 
    } else { 
        fvgs.filter(f=>f.type==='bear' && f.h>price && f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(f.h>=oteLow && f.h<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BEAR' && Math.abs(b.p-f.h)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.H.find(x=>Math.abs(x.p-f.h)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-f.h)<f.h*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.high>=oteLow && ob.high<=oteHigh){s+=35;cf.push('OTE');}if(swings.H.find(x=>Math.abs(x.p-ob.high)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-ob.high)<ob.high*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-ob.high)<ob.high*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        if(msnr.nearestResistance && msnr.nearestResistance>price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bear' && Math.abs(f.h-msnr.nearestResistance)<msnr.nearestResistance*0.003)){s+=25;cf.push('FVG');}if(swings.H.find(x=>Math.abs(x.p-msnr.nearestResistance)<msnr.nearestResistance*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-msnr.nearestResistance)<msnr.nearestResistance*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:msnr.nearestResistance*0.998,high:msnr.nearestResistance*1.002,p:msnr.nearestResistance,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});} 
    } 
    allZones.sort((x,y)=>y.score-x.score); 
    if(allZones.length>0){const b=allZones[0];return {low:b.low,high:b.high,p:(b.low+b.high)/2,src:b.src,confluence:b.confluence,cc:b.cc,quality:b.quality,hasImbalance:b.hasImbalance};} 
    if(direction==='BUY'){const low=l+r*.618,high=l+r*.79;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};} 
    else {const low=h-r*.79,high=h-r*.618;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};} 
} 
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Zone Magnetism',passed:magnetism.likelyToReach,critical:true});checks.push({name:'Imbalance Magnet',passed:zone.hasImbalance,critical:false});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=4?'HIGH':(tp>=3?'MEDIUM':'LOW')):'LOW',checks,totalPassed:tp,passed:cp};} 
 
// 🛡️ TIGHTER ATR-DRIVEN STOP LOSS 
function calcStopLoss(data, dir, entry, zone, msnr, tfUsed, twelveIndicators, currentPair) {
    // Use Twelve Data ATR if available, otherwise calculate
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const s = getMarketSettings(currentPair || pair);
    const maxSLD = entry * s.maxSLPct;
    const slBuf = getSLBufferForTF(apiATR, tfUsed, currentPair || pair);

    const swings = findSwings(data, 3);
    const fvgs = detectFVG(data);
    const obs = detectOrderBlocks(data, dir);

    let candidates = [];
    const addCand = (price, reason) => {
        const dist = dir === 'BUY' ? entry - price : price - entry;
        // Allow up to 2x ATR for structural stops
        if (dist > 0 && dist <= maxSLD && dist <= apiATR * 2.0) {
            candidates.push({ price, reason, dist });
        }
    };

    if (dir === 'BUY') {
        // ZONE IS PRIMARY (moved to top)
        if (zone && zone.low < entry) addCand(zone.low - slBuf * 0.5, 'Below Zone');
        // Then structural levels
        swings.L.filter(x => x.p < entry).forEach(x => addCand(x.p - slBuf, 'Below Swing'));
        obs.filter(ob => ob.low < entry).forEach(ob => addCand(ob.low - slBuf, 'Below OB'));
        fvgs.filter(f => f.type === 'bull' && f.l < entry).forEach(f => addCand(f.l - slBuf * 0.5, 'Below FVG'));
        // MSNR last (as alternative)
        if (msnr && msnr.allSupports) {
            msnr.allSupports.filter(x => x < entry).forEach(x => addCand(x - slBuf, 'Below MSNR'));
        }
    } else {
        if (zone && zone.high > entry) addCand(zone.high + slBuf * 0.5, 'Above Zone');
        swings.H.filter(x => x.p > entry).forEach(x => addCand(x.p + slBuf, 'Above Swing'));
        obs.filter(ob => ob.high > entry).forEach(ob => addCand(ob.high + slBuf, 'Above OB'));
        fvgs.filter(f => f.type === 'bear' && f.h > entry).forEach(f => addCand(f.h + slBuf * 0.5, 'Above FVG'));
        if (msnr && msnr.allResistances) {
            msnr.allResistances.filter(x => x > entry).forEach(x => addCand(x + slBuf, 'Above MSNR'));
        }
    }

    if (candidates.length > 0) {
        // Sort by distance (closest first = tightest SL)
        candidates.sort((a, b) => a.dist - b.dist);
        const best = candidates[0];
        return { price: best.price, reason: best.reason, distance: best.dist };
    }

    // Fallback: ATR-based stop
    const finalDist = Math.min(apiATR * 1.0, maxSLD);
    const finalSL = dir === 'BUY' ? entry - finalDist : entry + finalDist;
    return { price: finalSL, reason: 'ATR Baseline', distance: finalDist };
} 
 
function calcTakeProfits(dir, entry, sl) {
    const risk = Math.abs(entry - sl);
    const settings = getMarketSettings(pair);
    const rr = settings.targetRR || 4;
    const rr1 = rr, rr2 = rr + 1, rr3 = rr + 2;

    if (dir === 'BUY') {
        return {
            tp1: entry + risk * rr1,
            tp2: entry + risk * rr2,
            tp3: entry + risk * rr3,
            rrUsed: rr1
        };
    } else {
        return {
            tp1: entry - risk * rr1,
            tp2: entry - risk * rr2,
            tp3: entry - risk * rr3,
            rrUsed: rr1
        };
    }
} 
function score(data,price,twelveIndicators){ 
    const a=atr(data),cl=data.map(c=>c.c),rs=rsi(cl),fv=detectFVG(data),ms=detectMSS(data),bk=detectBreakers(data); 
    const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1]; 
    const bF=fv.filter(f=>f.type==='bull' && f.l<price).sort((a,b)=>b.l-a.l), sF=fv.filter(f=>f.type==='bear' && f.h>price).sort((a,b)=>a.h-b.h); 
    const bB=bk.filter(b=>b.type==='BULL' && b.p<price), sB=bk.filter(b=>b.type==='BEAR' && b.p>price); 
    let bS=0,sS=0,bR=[],sR=[]; 
    if(ms?.type==='BULL'){bS+=20;bR.push('MSS Bull');} else if(ms?.type==='BEAR'){sS+=20;sR.push('MSS Bear');} 
    if(bF.length){bS+=15;bR.push('Bull FVG');} if(sF.length){sS+=15;sR.push('Bear FVG');} 
    if(bB.length){bS+=10;bR.push('Bull breaker');} if(sB.length){sS+=10;sR.push('Bear breaker');} 
    if(cE20>cE50){bS+=15;bR.push('EMA bull');} else{sS+=15;sR.push('EMA bear');} 
    if(rs>50)bS+=10;else sS+=10; 
    const ind = twelveIndicators || {}; 
    if(ind.rsi && ind.rsi<30){bS+=8;bR.push('RSI oversold');} if(ind.rsi && ind.rsi>70){sS+=8;sR.push('RSI overbought');} 
    if(ind.stoch_k && ind.stoch_d && ind.stoch_k<20 && ind.stoch_d<20){bS+=5;bR.push('Stoch oversold');} if(ind.stoch_k && ind.stoch_d && ind.stoch_k>80 && ind.stoch_d>80){sS+=5;sR.push('Stoch overbought');} 
    if(ind.bb_lower && price<=ind.bb_lower*1.002){bS+=5;bR.push('At BB lower');} if(ind.bb_upper && price>=ind.bb_upper*0.998){sS+=5;sR.push('At BB upper');} 
    if(ind.cci && ind.cci<-150){bS+=5;bR.push('CCI oversold');} if(ind.cci && ind.cci>150){sS+=5;sR.push('CCI overbought');} 
    if(ind.williams_r && ind.williams_r<-80){bS+=3;bR.push('Williams oversold');} if(ind.williams_r && ind.williams_r>-20){sS+=3;sR.push('Williams overbought');} 
    if(ind.sar && price>ind.sar){bS+=5;bR.push('SAR bullish');} if(ind.sar && price<ind.sar){sS+=5;sR.push('SAR bearish');} 
    if(ind.ichimoku_senkou_a && ind.ichimoku_senkou_b){const cloudTop=Math.max(ind.ichimoku_senkou_a,ind.ichimoku_senkou_b);const cloudBot=Math.min(ind.ichimoku_senkou_a,ind.ichimoku_senkou_b);if(price>cloudTop){bS+=8;bR.push('Above cloud');}if(price<cloudBot){sS+=8;sR.push('Below cloud');}} 
    if(ind.macd_hist && ind.macd_hist>0){bS+=3;} if(ind.macd_hist && ind.macd_hist<0){sS+=3;} 
    let dir,conf,reason; 
    if(bS>sS){dir='BUY';conf=Math.min(bS+10,95);reason=bR.join('; ');} else if(sS>bS){dir='SELL';conf=Math.min(sS+10,95);reason=sR.join('; ');} else{dir=cE20>cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';} 
    return{dir,conf,reason,scores:{bS,sS}}; 
} 
 
// 🟢 UI DASHBOARD USES LIVE CANDLE DIRECTION 
async function updateMTFDisplay(historyCache = {}){ 
    const tfs=['5M','15M','1H','4H','1D']; 
    for(let t of tfs){ 
        let tr = await getLiveCandleDirection(t, historyCache[t]); 
        let el=document.getElementById(`trend${t}`); 
        if(el){el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut');el.className=`mtf-trend ${tr.toLowerCase()}`;} 
    } 
} 
 
function calculatePrecisionEntry(candles, zone, direction) { 
    const last = candles[candles.length - 1]; 
    if (!last) return (zone.low + zone.high) / 2; 
    if (direction === 'BUY') { 
        const wickLow = last.l; const wickHigh = Math.max(last.o, last.c); const fib50 = wickLow + (wickHigh - wickLow) * 0.5; 
        if (last.c > last.o && last.c > last.h * 0.7) return Math.min(last.c, zone.high); 
        return Math.min(fib50, zone.high); 
    } else { 
        const wickHigh = last.h; const wickLow = Math.min(last.o, last.c); const fib50 = wickHigh - (wickHigh - wickLow) * 0.5; 
        if (last.c < last.o && last.c < last.l * 1.3) return Math.max(last.c, zone.low); 
        return Math.max(fib50, zone.low); 
    } 
} 
function checkZoneFreshness(data, zone, direction) { 
    let touches = 0, violations = 0; const lookback = Math.min(50, data.length); 
    for (let i = data.length - lookback; i < data.length; i++) { if (i < 0) continue; const inZone = data[i].l <= zone.high && data[i].h >= zone.low; if (!inZone) continue; touches++; if (direction === 'BUY' && data[i].c < zone.low) violations++; if (direction === 'SELL' && data[i].c > zone.high) violations++; } 
    const fresh = touches <= 2 && violations === 0, partiallyUsed = touches <= 5 && violations <= 1, used = touches > 5 || violations > 1; 
    return { fresh, partiallyUsed, used, touches, violations }; 
} 
function isHTFPremiumDiscount(htfData, direction) { 
    if (!htfData || htfData.length < 10) return { inPremiumDiscount: false, value: 'neutral', pct: 0 }; 
    let high = -Infinity, low = Infinity;
    for (let i = 0; i < htfData.length; i++) {
        if (htfData[i].h > high) high = htfData[i].h;
        if (htfData[i].l < low) low = htfData[i].l;
    }
    const range = high - low, current = htfData[htfData.length - 1].c, mid = range / 2 + low;
    if (direction === 'BUY') { const inDiscount = current < mid, discountPct = ((mid - current) / range * 100); return { inPremiumDiscount: inDiscount, value: 'discount', pct: Math.max(0, discountPct) }; }  
    else { const inPremium = current > mid, premiumPct = ((current - mid) / range * 100); return { inPremiumDiscount: inPremium, value: 'premium', pct: Math.max(0, premiumPct) }; } 
} 
function getSession() { 
    const now = new Date(); const hour = now.getUTCHours(); const min = now.getUTCMinutes(); const time = hour + min / 60; 
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false }; 
    if (time >= 0 && time < 4) s = { session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true }; 
    else if (time >= 7 && time < 10) s = { session: 'LONDON KZ', multiplier: 1.1, emoji: '🇬🇧', isKillzone: true };
    else if (time >= 12 && time < 15) s = { session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true }; 
    else if (time >= 15 && time < 17) s = { session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true }; 
    if ((time >= 8 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) { s.isSilverBullet = true; s.multiplier += 0.2; s.emoji = '🏹'; s.session += ' + SB'; } 
    return s; 
} 
function validateBreakerBlock(data, level, direction) { if (data.length < 25) return false; const moveAway = data.slice(-25).find(c => direction === 'BUY' ? c.c > level * 1.005 : c.c < level * 0.995); if (!moveAway) return false; const recent = data.slice(-5), touched = recent.some(c => direction === 'BUY' ? c.l <= level : c.h >= level), last = recent[recent.length - 1], rejected = direction === 'BUY' ? last.c > level : last.c < level; return touched && rejected; } 

function analyzeAMD(dailyData) { 
    if (!dailyData || dailyData.length < 2) return { phase: 'UNKNOWN' }; 
    const now = new Date(); const hour = now.getUTCHours(); 
    const candles = dailyData.slice(-24); // Last 24 hours of 1H data preferably
    const asiaCandles = candles.filter(c => { const h = new Date(c.t).getUTCHours(); return h >= 0 && h < 4; }); 
    if (asiaCandles.length === 0) return { phase: 'ACCUMULATION' }; 
    const asiaHigh = Math.max(...asiaCandles.map(c => c.h)), asiaLow = Math.min(...asiaCandles.map(c => c.l)); 
    const currentPrice = candles[candles.length - 1].c; 
    if (hour >= 0 && hour < 5) return { phase: 'ACCUMULATION', range: { h: asiaHigh, l: asiaLow } }; 
    const manipulatedUpper = candles.some(c => new Date(c.t).getUTCHours() >= 5 && c.h > asiaHigh); 
    const manipulatedLower = candles.some(c => new Date(c.t).getUTCHours() >= 5 && c.l < asiaLow); 
    if (hour >= 7 && hour < 12) { 
        if (manipulatedUpper || manipulatedLower) return { phase: 'MANIPULATION', range: { h: asiaHigh, l: asiaLow }, manipulated: manipulatedUpper ? 'UP' : 'DOWN' }; 
        return { phase: 'ACCUMULATION_EXTENDED', range: { h: asiaHigh, l: asiaLow } }; 
    } 
    return { phase: 'DISTRIBUTION', range: { h: asiaHigh, l: asiaLow }, manipulated: manipulatedUpper ? 'UP' : (manipulatedLower ? 'DOWN' : 'NONE') }; 
} 
 
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    console.log(`🔍 Analyzing ${tfToAnalyze}...`);
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        console.log(`  → Trend: ${trendTF}, Structure: ${structureTF}, Entry: ${entryTF}, Sniper: ${sniperTF}`);

        const entryData = htfData[entryTF] || await getHistory(entryTF);
        if (!entryData?.length) {
            console.log(`  ❌ No entry data for ${entryTF}`);
            return null;
        }
        console.log(`  ✅ Entry data loaded: ${entryData.length} candles`);

        const structureData = htfData[structureTF] || await getHistory(structureTF);
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        const sig = score(entryData, price, twelveIndicators);
        console.log(`  → Score: direction=${sig.dir}, confidence=${sig.conf}`);

        // ===== 1. CRT RANGE =====
        const crt = detectCRT(entryData, sig.dir);
        console.log(`  → CRT: detected=${crt.detected}, pattern=${crt.pattern}`);

        // ===== 2. TBS CONFIRMATION =====
        const turtleSoup = detectTurtleSoup(entryData);
        const sweeps = detectLiquiditySweeps(entryData, price);
        const hasSweep = sweeps.length > 0;
        console.log(`  → TBS: ${turtleSoup.detected ? '✅' : '❌'}, Sweeps: ${sweeps.length}`);

        // ===== 3. MSNR BIAS =====
        const msnr = calculateMSNR(structureData || entryData, price);
        console.log(`  → MSNR pivot: ${msnr.pivot}, price: ${price}`);

        // ===== 4. CRT COMPLETION % =====
        const crtRange = {
            high: Math.max(...entryData.slice(-20).map(c => c.h)),
            low: Math.min(...entryData.slice(-20).map(c => c.l))
        };
        const range = crtRange.high - crtRange.low;
        const pricePosition = ((price - crtRange.low) / range) * 100;
        const isInOptimalZone = pricePosition > 40 && pricePosition < 60;
        console.log(`  → CRT completion: ${pricePosition.toFixed(1)}%, in optimal zone: ${isInOptimalZone}`);

        // ===== 5. TBS TRAP QUALITY =====
        const tbsQuality = gradeTBS(turtleSoup, sweeps, entryData);
        console.log(`  → TBS quality: ${tbsQuality.grade} (${tbsQuality.score})`);

        // ===== 6. MSNR DISTANCE =====
        const msnrDistance = Math.abs(price - msnr.pivot) / price * 100;
        const isNearMSNR = msnrDistance < 0.2;
        console.log(`  → MSNR distance: ${msnrDistance.toFixed(2)}%, near: ${isNearMSNR}`);

        // ===== 7. CRT EXPANSION/CONTRACTION =====
        const crtState = getCRTState(entryData);
        console.log(`  → CRT state: ${crtState.state}, momentum: ${crtState.momentum}`);

        // ===== 8. SESSION ALIGNMENT =====
        const session = getSession();
        console.log(`  → Session: ${session.session}, multiplier: ${session.multiplier}`);

        // ===== 9. FIND PRECISION ENTRY =====
        const zone = findPrecisionEntry(entryData, price, sig.dir, msnr);
        console.log(`  → Zone: ${zone.src}, quality: ${zone.quality}, low: ${zone.low}, high: ${zone.high}`);

        const apiATR = twelveIndicators?.atr_api || 0;
        const precisionEntry = getPrecisionEntryCRT(entryData, zone, sig.dir, crtRange, apiATR);
        console.log(`  → Precision entry: ${precisionEntry.entry}, SL: ${precisionEntry.sl}`);

        // ===== 10. ENTRY READY =====
        const entryTiming = checkEntryTiming(entryData, precisionEntry.entry, sig.dir);
        const entryReady = entryTiming.valid && isInOptimalZone;
        console.log(`  → Entry ready: ${entryReady}, timing valid: ${entryTiming.valid}`);

        // ===== 11. CONFIDENCE =====
        let conf = calculateCRTConfidence({
            crt: crt,
            tbsQuality: tbsQuality,
            msnrDistance: msnrDistance,
            isNearMSNR: isNearMSNR,
            crtState: crtState,
            session: session,
            zone: zone,
            entryReady: entryReady,
            hasSweep: hasSweep,
            turtleSoup: turtleSoup,
            direction: sig.dir,
            price: price,
            msnr: msnr,
            isInOptimalZone: isInOptimalZone
        });

        conf = Math.min(conf, 98);
        console.log(`  → Confidence: ${conf}%`);
        if (conf < 50) {
            console.log(`  ❌ Confidence below 50%`);
            return null;
        }

        console.log(`  ✅ ${tfToAnalyze} PASSED!`);
        // ===== PRECISION TRADER PRO INTEGRATION (POPULATED WITH REAL DATA) =====

        // === 1. GENERATE THE DATA THAT ALREADY EXISTS ===

        // Get order blocks with validity
        const obsAll = detectOrderBlocks(entryData, sig.dir);
        const validOrderBlocks = obsAll.map(ob => ({
            ...ob,
            isValid: true,
            type: sig.dir === 'BUY' ? 'BULLISH' : 'BEARISH'
        }));

        // Get FVGs with validity
        const fvgsAll = detectFVG(entryData);
        const validFvgs = fvgsAll.map(fvg => ({
            ...fvg,
            isValid: true
        }));

        // Check BOS using MSS detection
        const mssData = detectMSS(entryData); // detectMSS returns {detected: true/false, type:...}
        const bosConfirmed = mssData !== null && mssData.displaced === true;

        // Check displacement
        const displacement = detectDisplacement(entryData, sig.dir);
        const hasDisplacement = displacement.detected;

        // Check CHoCH (Change of Character)
        const chochDetected = checkCHoCH(entryData);

        // Get support/resistance levels from swings
        const swingsData = findSwings(entryData, 4);
        const htfSupportLevels = swingsData.L.map(s => ({ price: s.p, strength: 3 }));
        const htfResistanceLevels = swingsData.H.map(s => ({ price: s.p, strength: 3 }));

        // === 2. BUILD CONTEXT WITH REAL DATA ===
        const context = buildMarketContext({
            trendBias: sig.dir === 'BUY' ? 'BULLISH' : 'BEARISH',
            marketPhase: crtState?.state || 'CONSOLIDATION',
            rangeHigh: crtRange?.high || price * 1.01,
            rangeLow: crtRange?.low || price * 0.99,
            zoneType: zone.quality === 'A' ? (sig.dir === 'BUY' ? 'DISCOUNT' : 'PREMIUM') : 'MID_RANGE',
            bosConfirmed: bosConfirmed,
            chochDetected: chochDetected,
            validOrderBlocks: validOrderBlocks,
            validFvgs: validFvgs,
            liquiditySweeps: sweeps || [],
            htfSupportLevels: htfSupportLevels,
            htfResistanceLevels: htfResistanceLevels
        }, {
            pullbackIntoZone: entryTiming.valid || false,
            displacementCandle: hasDisplacement,
            compressionDetected: crtState?.isConsolidating || false
        }, { ltfData: { currentPrice: price } });

        // === 3. CALCULATE SETUP SCORE ===
        const setupScore = calculateSetupScore(sig.dir, context);

        // === 4. FIND ENTRY LEVEL ===
        let entryInfo = null;
        if (sig.dir === 'BUY') {
            entryInfo = findBuyEntryLevel(context, { ltfData: { currentPrice: price } });
        } else {
            entryInfo = findSellEntryLevel(context, { ltfData: { currentPrice: price } });
        }

        // === 5. FALLBACK IF NEEDED ===
        if (!entryInfo) {
            entryInfo = {
                entry: precisionEntry.entry,
                stopLoss: precisionEntry.sl,
                takeProfit: precisionEntry.tp1,
                partialTP: precisionEntry.tp2,
                invalidation: precisionEntry.sl * 0.998,
                breakevenLevel: (precisionEntry.entry + precisionEntry.tp1) / 2,
                pattern: zone.src,
                rrRatio: 4.0
            };
        }

        // === 6. CALCULATE METRICS ===
        const winProb = calculateWinProbability({ action: sig.dir, setupScore: setupScore, confidence: conf }, context, sig.dir);
        const expectedValue = calculateExpectedValue(winProb, entryInfo.rrRatio || 4.0);
        const signalGrade = getSignalGrade(conf);

        // === 7. TRADE LEVELS ===
        const tradeLevels = {
            entry: entryInfo.entry,
            stopLoss: entryInfo.stopLoss,
            takeProfit: entryInfo.takeProfit,
            partialTP: entryInfo.partialTP,
            invalidation: entryInfo.invalidation,
            breakeven: entryInfo.breakevenLevel,
            pipsRisk: Math.abs(entryInfo.entry - entryInfo.stopLoss) / 0.0001,
            pipsReward: Math.abs(entryInfo.takeProfit - entryInfo.entry) / 0.0001,
            riskReward: entryInfo.rrRatio || 4.0
        };

        return {
            timeframe: tfToAnalyze,
            direction: sig.dir,
            entry: precisionEntry.entry,
            sl: precisionEntry.sl,
            tp1: precisionEntry.tp1,
            tp2: precisionEntry.tp2,
            tp3: precisionEntry.tp3,
            confidence: conf,
            zone: zone,
            msnr: msnr,
            crt: crt || { detected: false, pattern: 'Neutral' },
            turtleSoup: turtleSoup,
            sweeps: sweeps,
            session: session,
            tbsQuality: tbsQuality,
            msnrDistance: msnrDistance,
            crtRange: crtRange,
            crtState: crtState,
            isInOptimalZone: isInOptimalZone,
            entryReady: entryReady,
            entryTiming: entryTiming,
            hasSweep: hasSweep,
            trendTF: trendTF || 'N/A',
            structureTF: structureTF || 'N/A',
            entryTF: entryTF || 'N/A',
            sniperTF: sniperTF || 'N/A',
            zoneReaction: { confirmed: false, type: 'NONE', strength: 'NONE' },
            zoneTouches: 0,
            mtf: { direction: sig.dir, strength: 1, trends: {} },
            qualityScore: tbsQuality.score || 0,
            htfValidation: { passed: true, parentArray: null },
            magnetism: { magnetism: 'MODERATE', score: 50, summary: 'N/A', checks: [] },
            freshness: { fresh: true, partiallyUsed: false, used: false },
            premiumDiscount: { inPremiumDiscount: false, value: 'neutral' },
            breakerValid: false,
            amd: { phase: 'UNKNOWN' },
            pathCheck: { clear: true, obstacles: [] },
            probCheck: { probability: 'MEDIUM' },
            displacement: { detected: false },
            sniperRej: { confirmed: false },
            slResult: { reason: 'CRT extreme entry', price: precisionEntry.sl },
            invalidationPrice: precisionEntry.sl,
            rrUsed: 1.5,
            rs: 50,
            apiATR: twelveIndicators?.atr_api || 0,
            fvgsAll: [],
            obsAll: [],
            breakersAll: [],
            twelveIndicators: twelveIndicators || {},
            tfAlign: `Trend:${trendTF}→Structure:${structureTF}→Entry:${entryTF}→Sniper:${sniperTF}`,
            volatility: { level: 'Moderate', desc: 'Normal' },
            mss: null,
            imbalances: [],
            // NEW: Precision Trader Pro fields (now populated with real data)
            setupScore: setupScore || 0,
            winProbability: winProb || 70,
            expectedValue: expectedValue || 0,
            signalGrade: signalGrade || 'C',
            context: context || {},
            entryInfo: entryInfo || {},
            tradeLevels: tradeLevels || {}
        };
    } catch (e) {
        console.error(`❌ Error in ${tfToAnalyze}:`, e);
        return null;
    }
}






// ===== FUNCTION 1: TBS QUALITY GRADING =====
function gradeTBS(turtleSoup, sweeps, data) {
    let score = 0;
    let reasons = [];

    if (turtleSoup.detected) {
        score += 40;
        reasons.push('TBS detected');
        if (turtleSoup.type === 'BUY' || turtleSoup.type === 'SELL') {
            score += 20;
            reasons.push(`TBS direction: ${turtleSoup.type}`);
        }
    }

    if (sweeps.length > 0) {
        score += 30;
        reasons.push(`${sweeps.length} liquidity sweep(s)`);
        if (sweeps.length >= 3) {
            score += 10;
            reasons.push('Multiple sweeps');
        }
    }

    if (sweeps.length > 0) {
        const recentSweep = sweeps.some(s => s.distance < 0.5);
        if (recentSweep) {
            score += 15;
            reasons.push('Recent sweep');
        }
    }

    return {
        score: Math.min(100, score),
        grade: score >= 80 ? 'A' : (score >= 60 ? 'B' : (score >= 40 ? 'C' : 'D')),
        reasons: reasons,
        detected: turtleSoup.detected || sweeps.length > 0
    };
}

// ===== FUNCTION 2: CRT STATE =====
function getCRTState(data) {
    const recent = data.slice(-10);
    const ranges = recent.map(c => c.h - c.l);
    const avg = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const last = ranges[ranges.length - 1];

    let state = 'NEUTRAL';
    let momentum = 'NEUTRAL';

    if (last > avg * 1.5) {
        state = 'EXPANDING';
        momentum = 'STRONG';
    } else if (last < avg * 0.5) {
        state = 'CONTRACTING';
        momentum = 'WEAK';
    } else {
        state = 'CONSOLIDATING';
        momentum = 'MODERATE';
    }

    const firstHalf = ranges.slice(0, 5);
    const secondHalf = ranges.slice(5);
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg > firstAvg * 1.2) {
        state = 'EXPANDING';
        momentum = 'STRONG';
    } else if (secondAvg < firstAvg * 0.8) {
        state = 'CONTRACTING';
        momentum = 'WEAK';
    }

    return {
        state: state,
        momentum: momentum,
        avgRange: avg,
        lastRange: last,
        isExpanding: state === 'EXPANDING',
        isContracting: state === 'CONTRACTING',
        isConsolidating: state === 'CONSOLIDATING'
    };
}

// ===== FUNCTION 3: PRECISION ENTRY WITH CRT =====
function getPrecisionEntryCRT(candles, zone, direction, crtRange, apiATR) {
    const last = candles[candles.length - 1];
    if (!last) {
        return {
            entry: (zone.low + zone.high) / 2,
            sl: null,
            tp1: null,
            tp2: null,
            tp3: null,
            reason: 'Default entry'
        };
    }

    // Use Twelve Data ATR if available
    const atrValue = apiATR || atr(candles, 14);
    const prec = getPrec(pair);
    const buffer = Math.max(atrValue * 0.3, 0.5); // Minimum 0.5 pips buffer

    let entry, sl, tp1, tp2, tp3;

    if (direction === 'BUY') {
        entry = Math.min(crtRange.low + buffer, zone.high);
        sl = crtRange.low - buffer * 0.5;
        const risk = entry - sl;
        const settings = getMarketSettings(pair);
        const rr = settings.targetRR || 4;
        tp1 = entry + risk * rr;
        tp2 = entry + risk * (rr + 1);
        tp3 = entry + risk * (rr + 2);
    } else {
        entry = Math.max(crtRange.high - buffer, zone.low);
        sl = crtRange.high + buffer * 0.5;
        const risk = sl - entry;
        const settings = getMarketSettings(pair);
        const rr = settings.targetRR || 4;
        tp1 = entry - risk * rr;
        tp2 = entry - risk * (rr + 1);
        tp3 = entry - risk * (rr + 2);
    }

    return {
        entry: entry,
        sl: sl,
        tp1: tp1,
        tp2: tp2,
        tp3: tp3,
        reason: `ATR-adjusted CRT entry (buffer: ${(buffer).toFixed(prec)})`
    };
}

// ===== FUNCTION 4: CRT-BASED CONFIDENCE =====
function calculateCRTConfidence(data) {
    let score = 0;

    // 1. CRT Expansion (15 points)
    if (data.crtState.isExpanding) score += 15;
    else if (data.crtState.isContracting) score += 5;
    else score += 10;

    // 2. TBS Quality (25 points)
    if (data.tbsQuality.grade === 'A') score += 25;
    else if (data.tbsQuality.grade === 'B') score += 20;
    else if (data.tbsQuality.grade === 'C') score += 10;
    else score += 5;

    // 3. Near MSNR (15 points)
    if (data.isNearMSNR) score += 15;
    else if (data.msnrDistance < 0.5) score += 10;
    else score += 5;

    // 4. Session (15 points)
    if (data.session.session === 'LONDON KZ' || data.session.session === 'NEW_YORK KZ') score += 15;
    else if (data.session.isKillzone) score += 10;
    else if (data.session.session === 'ASIA KZ') score += 5;
    else score += 2;

    // 5. CRT Completion (10 points)
    if (data.isInOptimalZone) score += 10;

    // 6. Sweep Confirmation (10 points)
    if (data.hasSweep) score += 10;

    // 7. Zone Quality (10 points)
    if (data.zone.quality === 'A') score += 10;
    else if (data.zone.quality === 'B') score += 5;

    // PENALTIES
    if (data.session.session === 'OFF-HOURS') score -= 20;
    if (!data.hasSweep && !data.turtleSoup.detected) score -= 15;
    if (data.msnrDistance > 1.0) score -= 10;

    return Math.max(0, Math.min(100, score));
}
function calculateSetupQuality(result, price) {
    let score = 0;
    const prec = getPrec(pair);
    const risk = Math.abs(result.entry - result.sl);
    const riskPct = (risk / price) * 100;

    // Safe defaults for ALL fields
    const zoneQuality = result.zone?.quality || 'C';
    const zoneCC = result.zone?.cc || 1;
    const htfPassed = result.htfValidation?.passed || false;
    const zoneReactionConfirmed = result.zoneReaction?.confirmed || false;
    const zoneReactionStrength = result.zoneReaction?.strength || 'NONE';
    const magnetismStrength = result.magnetism?.magnetism || 'WEAK';
    const entryReady = result.entryReady || false;
    const probCheck = result.probCheck?.probability || 'LOW';
    const displacementDetected = result.displacement?.detected || false;
    const crtDetected = result.crt?.detected || false;
    const crtPattern = result.crt?.pattern || 'Neutral';
    const pathClear = result.pathCheck?.clear || false;
    const turtleSoupDetected = result.turtleSoup?.detected || false;
    const freshness = result.freshness || { fresh: false, partiallyUsed: false, used: true };
    const premiumDiscount = result.premiumDiscount?.inPremiumDiscount || false;
    const session = result.session || { isKillzone: false, isSilverBullet: false, multiplier: 0.5 };
    const breakerValid = result.breakerValid || false;
    const amdPhase = result.amd?.phase || 'UNKNOWN';
    const hasSweep = result.hasSweep || false;

    const tfWeights = { '1D': 100, '4H': 80, '1H': 60, '15M': 30, '5M': 10 };
    score += tfWeights[result.timeframe] || 10;
    score += (result.confidence / 100) * 50;

    if (zoneQuality === 'A') score += 30;
    else if (zoneQuality === 'B') score += 15;
    else score += 5;

    score += Math.min(zoneCC * 5, 20);
    if (htfPassed) score += 15;

    if (zoneReactionConfirmed) {
        if (zoneReactionStrength === 'STRONG') score += 15;
        else if (zoneReactionStrength === 'MODERATE') score += 8;
    }

    if (magnetismStrength === 'STRONG') score += 10;
    else if (magnetismStrength === 'MODERATE') score += 5;

    if (entryReady) score += 10;
    if (riskPct < 0.1) score -= 10;
    if (riskPct > 2.0) score -= 10;

    if (probCheck === 'HIGH') score += 10;
    else if (probCheck === 'LOW') score -= 10;

    if (displacementDetected) score += 5;
    if (crtDetected && crtPattern === 'Expanding') score += 5;
    if (pathClear) score += 5;
    if (turtleSoupDetected) score += 8;

    if (freshness.fresh) score += 15;
    else if (freshness.partiallyUsed) score += 5;
    else if (freshness.used) score -= 10;

    if (premiumDiscount) score += 10;
    else score -= 5;

    if (session.isKillzone) score += 15;
    if (session.isSilverBullet) score += 20;
    if (session.multiplier >= 1.0) score += 10;
    else score -= 10;

    if (breakerValid) score += 8;
    if (amdPhase === 'MANIPULATION') score += 15;
    if (hasSweep) score += 10;

    return Math.max(0, Math.min(100, score));
}

async function askAIWithAllResults(allResults, price, htfData) { 
    if (!DEEPSEEK_API_KEY || allResults.length === 0) return null; showNotif('🤖 AI strict execution check...', 'info'); 
    let tfSummary = ''; for (const r of allResults) { const htfStatus = r.htfValidation ? (r.htfValidation.passed ? 'In HTF' : 'No HTF') : 'N/A'; tfSummary += `${r.timeframe}: ${r.direction} | Zone: $${r.zone.low.toFixed(2)}-$${r.zone.high.toFixed(2)} | EntryReady: ${r.entryReady ? 'YES' : 'NO'} | React: ${r.zoneReaction?.confirmed ? r.zoneReaction.type : 'None'} | HTF: ${htfStatus} | Touches: ${r.zoneTouches} | Conf:${r.confidence}% | RR:1:${r.rrUsed}\n`; } 
    const best = allResults[0], prec = getPrec(pair), dailyDir = await getQuoteDirection('1D', htfData['1D']), h4Dir = await getQuoteDirection('4H', htfData['4H']), htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction); 
    const prompt = `You are TheGhostMachine. Decide if we should enter NOW.
PAIR: HIDDEN_ASSET | PRICE: $${price.toFixed(prec)}
HTF: 1D=${dailyDir} 4H=${h4Dir} | Confluence: ${htfConfluence.level}
PRECISION: Session=${best.session.session} | Killzone=${best.session.isKillzone} | SilverBullet=${best.session.isSilverBullet} | AMD=${best.amd.phase}
TOP SETUP (${best.timeframe}):
Direction: ${best.direction} | Zone: $${best.zone.low.toFixed(prec)}-$${best.zone.high.toFixed(prec)} (${best.zone.src} Q:${best.zone.quality})
HTF Validated: ${best.htfValidation ? (best.htfValidation.passed ? 'YES' : 'NO') : 'N/A'}
Entry Ready: ${best.entryReady ? 'YES' : 'NO'} | Reaction: ${best.zoneReaction?.confirmed ? best.zoneReaction.type : 'NONE'}
Entry: $${best.entry.toFixed(prec)} | SL: $${best.sl.toFixed(prec)} | TP1: $${best.tp1.toFixed(prec)} | RR: 1:${best.rrUsed}

RULES: If entryReady is NO, return "wait_for_reaction". If HTF not validated, consider "skip". If CONFLICT, "skip".

Return ONLY JSON in this format:
{
  "trade_signal_Theghostmachine": {
    "approved": boolean,
    "confidence_adjustment": number,
    "execution_decision": "enter_now" | "wait_for_reaction" | "skip",
    "wait_condition": "string",
    "invalidation_price": number,
    "analysis": {
      "entry_logic": "string",
      "sl_logic": "string",
      "key_reason": "string",
      "risk_warning": "string",
      "possible_outcomes": ["string"]
    },
    "entry_refinement": { "low": number, "high": number }
  }
}`; 
    try { const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are a strict ICT execution coach. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:1000})}); const d = await r.json(); if (d.choices?.[0]) { const m = d.choices[0].message.content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } } catch(e) { console.error('AI fetch:', e); } 
    return null; 
} 
async function runAutoScan() { 
    const btn = document.getElementById('analyzeBtn'), scanStatus = document.getElementById('scanStatus'), scanText = document.getElementById('scanText'), scanFill = document.getElementById('scanProgressFill'); 
    btn.classList.add('loading'); btn.disabled = true; scanStatus.classList.remove('hidden'); 
    if (!TWELVE_DATA_KEY) { showSetup(); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; } 
    showNotif('🔍 Scanning for HTF-validated setups...', 'info'); 
    try { 
        const price = await getPrice(); if (!price) throw new Error('No price'); 
        const historyCache = {};
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
        scanText.innerHTML = 'Fetching market data...';
        await Promise.all(tfs.map(async (t) => { historyCache[t] = await getHistory(t); }));

        const mtfTrendsData = {}; for (let t of tfs) mtfTrendsData[t] = await getQuoteDirection(t, historyCache[t]); 
        await updateMTFDisplay(historyCache); document.getElementById('currentPrice').innerHTML = `$${price.toFixed(getPrec(pair))}`; 
        if (lastPrice) { const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2); const ce = document.getElementById('priceChange'); ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`; ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`; } lastPrice = price; 
        const results = [], timeframesToScan = ['1D', '4H', '1H', '15M', '5M'], htfData = historyCache; 
        for (let i = 0; i < timeframesToScan.length; i++) { const tfScan = timeframesToScan[i]; scanText.innerHTML = `Scanning ${tfScan}... (${i + 1}/${timeframesToScan.length})`; scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%'; const result = await analyzeTimeframe(tfScan, price, htfData); if (result) results.push(result); } 

        console.log('=== SCAN RESULTS ===');
        console.log('Results found:', results.length);
        for (let r of results) {
            console.log('TF:', r.timeframe, '| Direction:', r.direction, '| Confidence:', r.confidence);
        }

        if (results.length === 0) { showNotif('⚠️ No valid setups found', 'warning'); document.getElementById('jsonOutput').innerHTML = JSON.stringify({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_SETUP',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}, null, 2); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; } 
        for (let result of results) {
            try {
                result.qualityScore = calculateSetupQuality(result, price);
            } catch(e) {
                console.error('Error calculating quality score:', e);
                result.qualityScore = 0;
            }
        }
        const higherTimeframes = ['1D', '4H', '1H'], lowerTimeframes = ['15M', '5M']; 
        const higherResults = results.filter(r => higherTimeframes.includes(r.timeframe)), lowerResults = results.filter(r => lowerTimeframes.includes(r.timeframe)); 
        let best = null, isLowerTF = false; 
        if (higherResults.length > 0) { higherResults.sort((a, b) => b.qualityScore - a.qualityScore); best = higherResults[0]; isLowerTF = false; showNotif(`✅ ${best.timeframe} setup found - Quality: ${best.qualityScore}%`, 'success'); }  
        else if (lowerResults.length > 0) { const filteredLower = lowerResults.filter(r => r.qualityScore > 40); if (filteredLower.length > 0) { filteredLower.sort((a, b) => b.qualityScore - a.qualityScore); best = filteredLower[0]; isLowerTF = true; best.confidence = Math.max(best.confidence - 30, 20); showNotif(`⚠️ ONLY LOWER TF SETUP (${best.timeframe}) - Quality: ${best.qualityScore}% - REDUCED CONFIDENCE`, 'warning'); } else { showNotif('⚠️ Lower timeframe setups found but quality too low (<40%)', 'warning'); document.getElementById('jsonOutput').innerHTML = JSON.stringify({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'LOW_QUALITY_SETUPS_ONLY',message:'Only low quality lower timeframe setups found. Not tradable.',multi_timeframe_trends:mtfTrendsData,lower_setups_found:lowerResults.length,best_quality:Math.max(...lowerResults.map(r=>r.qualityScore))}}, null, 2); analysis = null; document.getElementById('executeBtn').disabled = true; btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; } }
        else { showNotif('⚠️ No valid setups found', 'warning'); document.getElementById('jsonOutput').innerHTML = JSON.stringify({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_SETUP',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}, null, 2); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; } 
        scanText.innerHTML = '🤖 AI strict execution decision...'; const aiResult = await askAIWithAllResults(results, price, htfData); scanStatus.classList.add('hidden'); 
        const prec = getPrec(pair), risk = Math.abs(best.entry - best.sl), rr = best.rrUsed || 4, rrDisplay = (Math.abs(best.tp1 - best.entry) / risk).toFixed(1), st = best.direction === 'BUY' ? 'LONG' : 'SHORT'; 
        const htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction); best.confidence = Math.max(best.confidence - htfConfluence.penalty, 10);
        let aiConviction = 'MEDIUM', aiApproved = true, aiConfAdj = 0, executionDecision = best.entryReady ? 'enter_now' : 'wait_for_reaction', waitCondition = 'Wait for engulf/pinbar at zone', aiInvalidation = best.invalidationPrice; 
        let finalEntry = best.entry, finalZoneLow = best.zone.low, finalZoneHigh = best.zone.high, aiEntryLogic = '', aiSlLogic = '', aiKeyReason = '', aiRiskWarning = '', aiOutcomes = []; 
        if (aiResult && aiResult.trade_signal_Theghostmachine) { const ts = aiResult.trade_signal_Theghostmachine; aiApproved = ts.approved !== false; aiConfAdj = ts.confidence_adjustment || 0; executionDecision = ts.execution_decision || executionDecision; waitCondition = ts.wait_condition || waitCondition; if (ts.invalidation_price) aiInvalidation = ts.invalidation_price; if (executionDecision === 'enter_now') aiConviction = 'HIGH'; else if (executionDecision === 'wait_for_reaction') aiConviction = 'WAIT'; else aiConviction = 'SKIP'; if (ts.entry_refinement && ts.entry_refinement.low && ts.entry_refinement.high) { finalZoneLow = ts.entry_refinement.low; finalZoneHigh = ts.entry_refinement.high; finalEntry = (finalZoneLow + finalZoneHigh) / 2; } aiEntryLogic = ts.analysis?.entry_logic || ''; aiSlLogic = ts.analysis?.sl_logic || ''; aiKeyReason = ts.analysis?.key_reason || ''; aiRiskWarning = ts.analysis?.risk_warning || ''; aiOutcomes = ts.analysis?.possible_outcomes || []; if (aiApproved) best.confidence = Math.min(Math.max(best.confidence + aiConfAdj, 10), 98); else best.confidence = Math.max(best.confidence - 25, 5); } 
        const session = getSession(); 


            const out = { auto_scan_result: { date: new Date().toISOString().split('T')[0], time: new Date().toISOString().split('T')[1].split('.')[0], pair, current_price: price, multi_timeframe_trends: mtfTrendsData, best_timeframe: best.timeframe, quality_score: best.qualityScore, total_setups_found: results.length, higher_timeframe_setups_found: higherResults.length, lower_timeframe_setups_available: lowerResults.length, is_lower_timeframe_signal: isLowerTF, signal_quality: isLowerTF ? 'LOWER_TF_ONLY_REDUCED_CONFIDENCE' : 'HIGHER_TF_TRADABLE', session: session.session, session_emoji: session.emoji, session_multiplier: session.multiplier, premium_discount: best.premiumDiscount, zone_freshness: best.freshness, breaker_validated: best.breakerValid, ai_verified: !!aiResult, ai_approved: aiApproved, execution_decision: executionDecision, wait_condition: waitCondition || null, htf_confluence: htfConfluence, trade_signal: { trade_type: best.direction === 'BUY' ? 'BUY-LIMIT' : 'SELL-LIMIT', entry_price: finalEntry, entry_zone: { low: finalZoneLow, high: finalZoneHigh }, entry_ready: best.entryReady, zone_touches: best.zoneTouches, htf_validated: best.htfValidation ? best.htfValidation.passed : null, htf_parent_structure: best.htfValidation?.parentArray ? `${best.htfValidation.parentArray.src} @ ${best.htfValidation.structureTF}` : null, stop_loss: best.sl, sl_reason: best.slResult.reason, invalidation_price: aiInvalidation, risk_amount: risk.toFixed(prec), stop_loss_pct: ((risk / best.entry) * 100).toFixed(2) + '%', take_profit_1: best.tp1, take_profit_2: best.tp2, take_profit_3: best.tp3, risk_reward: '1:' + rrDisplay, dynamic_rr: '1:' + rr, confidence: best.confidence, conviction: aiConviction, entry_source: aiResult ? 'AI-Refined' : 'Rule-Based', ai_used: !!aiResult, ai_risk_warning: aiRiskWarning || null, entry_reasoning: aiEntryLogic || `${best.zone.src} zone with ${best.zone.confluence}`, sl_reasoning: aiSlLogic || best.slResult.reason, key_reason: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}]`, possible_outcomes: aiOutcomes.length > 0 ? aiOutcomes : [`Enter at zone after reaction`, `Sweep then reverse`, `SL hit invalidates`], zone_quality: best.zone.quality, zone_source: best.zone.src, zone_confluence: best.zone.confluence, confluence_count: best.zone.cc, imbalance_magnet: best.zone.hasImbalance, zone_reaction: best.zoneReaction, zone_magnetism: { strength: best.magnetism.magnetism, score: best.magnetism.score, summary: best.magnetism.summary, checks: best.magnetism.checks }, path_clearance: { clear: best.pathCheck.clear, obstacles: best.pathCheck.obstacles }, probability: best.probCheck.probability, timeframe_alignment: { trend_tf: best.trendTF, structure_tf: best.structureTF, entry_tf: best.entryTF, sniper_tf: best.sniperTF, alignment: best.tfAlign, trend_direction: best.mtf.direction, trend_strength: best.mtf.strength + '/5 TFs', sniper_confirmation: best.sniperRej.confirmed ? '✅ Confirmed' : '⚠️ No rejection', htf_confluence: htfConfluence }, turtle_soup: best.turtleSoup, crt_analysis: best.crt, order_blocks_found: best.obsAll ? best.obsAll.length : 0, twelve_data_indicators: best.twelveIndicators, msnr_levels: { pivot: best.msnr.pivot.toFixed(prec), supports: { S1: best.msnr.supports.S1?.toFixed(prec), S2: best.msnr.supports.S2?.toFixed(prec), S3: best.msnr.supports.S3?.toFixed(prec) }, resistances: { R1: best.msnr.resistances.R1?.toFixed(prec), R2: best.msnr.resistances.R2?.toFixed(prec), R3: best.msnr.resistances.R3?.toFixed(prec) } }, sweeps: best.sweeps.filter(s => s.distance < best.apiATR * 2).map(s => ({ type: s.type, level: s.level, distance: s.distance })), analysis: { trend_detection: `${best.mtf.direction} (${best.mtf.strength}/5 TFs)${best.mtf.strength >= 3 ? ' - STRONG' : ''}`, volatility_level: `${best.volatility.level} - ${best.volatility.desc}`, market_structure: { mss: best.mss ? best.mss.type : 'None', displacement: best.displacement.detected, sniper_rejection: best.sniperRej.confirmed, turtle_soup: best.turtleSoup.detected, crt_pattern: best.crt.pattern, zone_reaction: best.zoneReaction, zone_touches: best.zoneTouches, entry_ready: best.entryReady, htf_validated: best.htfValidation?.passed || false, imbalance_magnet: best.zone.hasImbalance, zone_magnetism: best.magnetism.magnetism, htf_confluence: htfConfluence.level, zone_freshness: best.freshness, premium_discount: best.premiumDiscount, session: best.session, breaker_validated: best.breakerValid }, indicator_confluence: { macd: best.twelveIndicators.macd ? `${best.twelveIndicators.macd > best.twelveIndicators.macd_signal ? 'Bullish' : 'Bearish'}` : 'N/A', adx: best.twelveIndicators.adx ? `${best.twelveIndicators.adx > 25 ? 'Trending' : 'Ranging'} (RR:1:${rr})` : 'N/A', stochastic: best.twelveIndicators.stoch_k ? `K:${best.twelveIndicators.stoch_k} D:${best.twelveIndicators.stoch_d}` : 'N/A', cci: best.twelveIndicators.cci || 'N/A', williams_r: best.twelveIndicators.williams_r || 'N/A', sar: best.twelveIndicators.sar ? `${best.twelveIndicators.sar}` : 'N/A', ichimoku: best.twelveIndicators.ichimoku_tenkan ? `TK:${best.twelveIndicators.ichimoku_tenkan}/${best.twelveIndicators.ichimoku_kijun}` : 'N/A' }, technical_indicators: [`RSI: ${best.twelveIndicators.rsi || best.rs.toFixed(1)}`, `MACD: ${best.twelveIndicators.macd || 'N/A'}`, `ADX: ${best.twelveIndicators.adx || 'N/A'}`, `ATR(API): ${best.twelveIndicators.atr_api?.toFixed(prec) || best.apiATR.toFixed(prec)}`, `BB: ${best.twelveIndicators.bb_upper || 'N/A'}/${best.twelveIndicators.bb_lower || 'N/A'}`, `FVG: ${best.fvgsAll.length} (${best.fvgsAll.filter(f => f.fresh).length} fresh)`, `OB: ${best.obsAll ? best.obsAll.length : 0}`], reasoning: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}] | HTF:${best.htfValidation?.passed ? 'YES' : 'NO'} | Magnet:${best.magnetism.magnetism} | Confluence:${htfConfluence.level} | EntryReady:${best.entryReady ? 'YES' : 'NO'} | React:${best.zoneReaction?.type || 'None'} | Touch#${best.zoneTouches} | ${best.session?.emoji || ''}${best.session?.session || ''}` } ,
                    crt_analysis: {
                        detected: best.crt?.detected || false,
                        state: best.crtState?.state || 'NEUTRAL',
                        momentum: best.crtState?.momentum || 'NEUTRAL',
                        is_expanding: best.crtState?.isExpanding || false,
                        range: {
                            high: best.crtRange?.high || null,
                            low: best.crtRange?.low || null,
                            completion_percent: best.isInOptimalZone ? '50% COMPLETED' : 'WAITING'
                        }
                    },
                    tbs_analysis: {
                        detected: best.turtleSoup?.detected || false,
                        type: best.turtleSoup?.type || 'NONE',
                        quality: best.tbsQuality?.grade || 'N/A',
                        score: best.tbsQuality?.score || 0,
                        sweeps_found: best.sweeps?.length || 0
                    },
                    msnr_analysis: {
                        pivot: best.msnr?.pivot || null,
                        distance_percent: best.msnrDistance || 0,
                        is_near: best.isNearMSNR || false,
                        bias: best.direction === 'BUY' ? 'BELOW_MSNR' : 'ABOVE_MSNR'
                    },
                    entry_timing: {
                        valid: best.entryTiming?.valid || false,
                        reason: best.entryTiming?.reason || 'N/A',
                        in_optimal_zone: best.isInOptimalZone || false
                    },
                    "precision_trader_pro": {
                        "setup_score": best.setupScore || 0,
                        "win_probability": best.winProbability || 70,
                        "expected_value": best.expectedValue || 0,
                        "signal_grade": best.signalGrade || 'C',
                        "htf_bias": best.context?.htfTrendBias || 'NEUTRAL',
                        "market_phase": best.context?.htfMarketPhase || 'CONSOLIDATION',
                        "zone_type": best.context?.htfZoneType || 'MID_RANGE',
                        "bos_confirmed": best.context?.htfBosConfirmed || false,
                        "choch_detected": best.context?.htfChochDetected || false,
                        "liquidity_sweeps": best.context?.liquiditySweeps?.length || 0,
                        "valid_order_blocks": best.context?.validOrderBlocks?.length || 0,
                        "ltf_compression": best.context?.ltfCompressionDetected || false,
                        "session_valid": best.context?.sessionValid || false
                    },
                    "trade_levels": {
                        "entry": best.tradeLevels?.entry || best.entry,
                        "stop_loss": best.tradeLevels?.stopLoss || best.sl,
                        "take_profit": best.tradeLevels?.takeProfit || best.tp1,
                        "partial_tp": best.tradeLevels?.partialTP || best.tp2,
                        "invalidation": best.tradeLevels?.invalidation || best.invalidationPrice,
                        "breakeven": best.tradeLevels?.breakeven || ((best.entry + best.tp1) / 2),
                        "pips_risk": best.tradeLevels?.pipsRisk || 0,
                        "pips_reward": best.tradeLevels?.pipsReward || 0,
                        "risk_reward": best.tradeLevels?.riskReward || best.rrUsed || 4
                    }

} } };
        document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);


        analysis = { signalType: st, idealEntry: finalEntry, currentPrice: price, stopLoss: best.sl, takeProfit1: best.tp1, takeProfit2: best.tp2, takeProfit3: best.tp3, confidence: best.confidence, entryZoneLow: finalZoneLow, entryZoneHigh: finalZoneHigh, entryReady: best.entryReady, executionDecision, invalidationPrice: aiInvalidation }; 
        // Check if setup is still valid
        if (!isSetupStillValid(best, price)) {
            showNotif(`⚠️ Setup invalidated at current price: ${price}`, 'warning');
            document.getElementById('executeBtn').disabled = true;
            return;
        }
        document.getElementById('executeBtn').disabled = false; 
        const magLabel = best.magnetism.magnetism === 'STRONG' ? '🧲' : (best.magnetism.magnetism === 'MODERATE' ? '🔗' : '⚠️'), aiLabel = aiResult ? (aiApproved ? '🤖✅' : '🤖❌') : '', htfLabel = htfConfluence.level === 'FULL' ? '💪' : (htfConfluence.level === 'CONFLICT' ? '⚠️' : ''), htfValLabel = best.htfValidation?.passed ? '🏗️' : '', execLabel = executionDecision === 'enter_now' ? '🟢ENTER' : (executionDecision === 'wait_for_reaction' ? '🟡WAIT' : '🔴SKIP'), tfWarning = isLowerTF ? '⚠️LOWER TF ONLY⚠️ ' : '✅HIGHER TF✅ ', sessionLabel = `${best.session?.emoji || ''}${best.session?.session || ''}`, freshnessLabel = best.freshness?.fresh ? '🆕' : (best.freshness?.partiallyUsed ? '📌' : '🔴'), amdLabel = best.amd.phase === 'MANIPULATION' ? '🎭' : ''; 
        showNotif(`${tfWarning}${aiLabel}${magLabel}${htfLabel}${htfValLabel}${freshnessLabel}${amdLabel} ${sessionLabel} ${execLabel} ${best.timeframe} ${st} ${best.confidence}% | Quality:${best.qualityScore}% | 1:${rrDisplay}`, 'success'); 
    } catch (e) { console.error(e); showNotif('Error: ' + e.message, 'error'); scanStatus.classList.add('hidden'); } 
    finally { btn.classList.remove('loading'); btn.disabled = false; } 
} 
function loadLimitOrder(){const s=localStorage.getItem('limitOrder');if(s){try{limitOrder=JSON.parse(s);updateLimitUI();startMonitor();}catch(e){}}} 
function saveLimit(o){limitOrder=o;localStorage.setItem('limitOrder',JSON.stringify(o));updateLimitUI();} 
function clearLimit(){limitOrder=null;localStorage.removeItem('limitOrder');if(priceTimer)clearInterval(priceTimer);updateLimitUI();} 
function cancelLimit(){clearLimit();showNotif('❌ Cancelled','warning');} 
function updateLimitUI(){const t=document.getElementById('limitOrderText'),c=document.getElementById('cancelLimitBtn');if(limitOrder){const prec=getPrec(pair);t.innerHTML=`⏳ ${limitOrder.signalType} LIMIT @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}`;t.className='active';c.classList.remove('hidden');document.getElementById('executeBtn').innerHTML='⏳ Waiting...';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)';}else{t.innerHTML='No active limit order';t.className='';c.classList.add('hidden');document.getElementById('executeBtn').innerHTML='⚡ Place Limit Order';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)';}} 
function startMonitor(){if(priceTimer)clearInterval(priceTimer);priceTimer=setInterval(async()=>{if(!limitOrder){clearInterval(priceTimer);return;}const p=await getPrice();if(!p)return;const prec=getPrec(pair);document.getElementById('currentPrice').innerHTML=`$${p.toFixed(prec)}`;if((limitOrder.signalType==='LONG' && p<=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT' && p>=limitOrder.idealEntry)){clearLimit();showNotif(`✅ FILLED! ${limitOrder.signalType} @ $${p.toFixed(prec)}`,'success');try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){}}},2000);} 
function handleLimit(){if(!analysis||analysis.signalType==='NEUTRAL'){showNotif('No signal','error');return;}if(limitOrder){cancelLimit();return;}const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry,stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,entryZoneLow:analysis.entryZoneLow,entryZoneHigh:analysis.entryZoneHigh,entryReady:analysis.entryReady,executionDecision:analysis.executionDecision,invalidationPrice:analysis.invalidationPrice,createdAt:new Date().toISOString()};saveLimit(o);startMonitor();showNotif(`📝 Limit @ $${o.idealEntry.toFixed(getPrec(pair))}`,'info');} 
function copyJson(){const t=document.getElementById('jsonOutput').innerHTML;if(t.includes('Click')){showNotif('Run analysis first','warning');return;}navigator.clipboard.writeText(t).then(()=>showNotif('📋 Copied!','success')).catch(()=>showNotif('Failed','error'));} 
function showNotif(m,t){const n=document.getElementById('notification');n.innerHTML=m;n.className=`notification ${t}`;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3000);}


// ===== FUNCTION 5: ENTRY TIMING =====
function checkEntryTiming(data, entryPrice, direction) {
    if (!data || data.length === 0) return { valid: false, reason: 'No data' };
    const last = data[data.length - 1];

    // Check if price is within 0.1% of entry price
    const threshold = entryPrice * 0.001;
    let valid = false;

    if (direction === 'BUY') {
        valid = Math.abs(last.c - entryPrice) <= threshold || last.c <= entryPrice;
    } else {
        valid = Math.abs(last.c - entryPrice) <= threshold || last.c >= entryPrice;
    }

    return {
        valid: valid,
        reason: valid ? 'Price near entry' : 'Waiting for optimal price'
    };
}

function isSetupStillValid(setup, currentPrice) {
    if (!setup || !setup.direction) return false;

    if (setup.direction === 'BUY') {
        // If price drops below invalidation, setup is invalid
        if (currentPrice < setup.invalidationPrice) return false;
        // If price breaks above zone high, setup may be invalid
        if (currentPrice > setup.zone.high * 1.005) return false;
    } else {
        // If price rises above invalidation, setup is invalid
        if (currentPrice > setup.invalidationPrice) return false;
        // If price breaks below zone low, setup may be invalid
        if (currentPrice < setup.zone.low * 0.995) return false;
    }
    return true;
}

// ===== NEW: SETUP QUALITY SCORING (1-10) =====
function calculateSetupScore(direction, context) {
    let score = 0;

    // 1. HTF bias alignment
    if ((direction === 'BUY' && context.htfTrendBias === 'BULLISH') ||
        (direction === 'SELL' && context.htfTrendBias === 'BEARISH')) score += 1;

    // 2. Zone alignment (Discount for BUY, Premium for SELL)
    if ((direction === 'BUY' && context.htfZoneType === 'DISCOUNT') ||
        (direction === 'SELL' && context.htfZoneType === 'PREMIUM')) score += 1;

    // 3. BOS confirmation
    if (context.htfBosConfirmed) score += 1;

    // 4. No CHoCH (Change of Character)
    if (!context.htfChochDetected) score += 1;

    // 5. Valid order blocks exist
    if (context.validOrderBlocks && context.validOrderBlocks.length > 0) score += 1;

    // 6. Liquidity sweep happened
    if (context.liquiditySweeps && context.liquiditySweeps.length > 0) score += 1;

    // 7. FVG validation
    if (context.validFvgs && context.validFvgs.length > 0) score += 1;

    // 8. LTF pullback into zone
    if (context.ltfPullbackIntoZone) score += 1;

    // 9. LTF displacement candle
    if (context.ltfDisplacementCandle) score += 1;

    // 10. Session valid
    if (context.sessionValid) score += 1;

    return score; // 1-10
}

// ===== NEW: SIGNAL GRADE =====
function getSignalGrade(confidence) {
    if (confidence >= 90) return 'A';
    if (confidence >= 85) return 'B';
    if (confidence >= 80) return 'C';
    return 'D';
}

// ===== NEW: WIN PROBABILITY CALCULATION =====
function calculateWinProbability(signal, context, direction) {
    let base = 70.0;

    base += signal.setupScore * 2.0;

    if ((direction === 'BUY' && context.htfTrendBias === 'BULLISH') ||
        (direction === 'SELL' && context.htfTrendBias === 'BEARISH')) base += 10.0;

    if ((direction === 'BUY' && context.htfZoneType === 'DISCOUNT') ||
        (direction === 'SELL' && context.htfZoneType === 'PREMIUM')) base += 8.0;

    if (context.htfBosConfirmed) base += 7.0;
    if (context.liquiditySweeps && context.liquiditySweeps.length > 0) base += 5.0;
    if (context.ltfCompressionDetected) base += 4.0;

    return Math.min(base, 95.0);
}

// ===== NEW: EXPECTED VALUE =====
function calculateExpectedValue(winProbability, rrRatio) {
    const winRate = winProbability / 100.0;
    const lossRate = 1.0 - winRate;
    return (winRate * rrRatio) - (lossRate * 1.0);
}

// ===== NEW: MARKET CONTEXT BUILDER =====
function buildMarketContext(htfAnalysis, ltfAnalysis, chartData) {
    return {
        htfTrendBias: htfAnalysis.trendBias || 'NEUTRAL',
        htfMarketPhase: htfAnalysis.marketPhase || 'CONSOLIDATION',
        htfRangeHigh: htfAnalysis.rangeHigh || 0,
        htfRangeLow: htfAnalysis.rangeLow || 0,
        htfZoneType: htfAnalysis.zoneType || 'MID_RANGE',
        htfBosConfirmed: htfAnalysis.bosConfirmed || false,
        htfChochDetected: htfAnalysis.chochDetected || false,
        validOrderBlocks: htfAnalysis.validOrderBlocks || [],
        validFvgs: htfAnalysis.validFvgs || [],
        liquiditySweeps: htfAnalysis.liquiditySweeps || [],
        ltfPullbackIntoZone: ltfAnalysis.pullbackIntoZone || false,
        ltfDisplacementCandle: ltfAnalysis.displacementCandle || false,
        ltfCompressionDetected: ltfAnalysis.compressionDetected || false,
        sessionValid: validateTradingSession()
    };
}

// ===== NEW: SESSION VALIDATION =====
function validateTradingSession() {
    const hour = new Date().getUTCHours();
    // London: 8-16 UTC, NY: 13-22 UTC
    return (hour >= 8 && hour <= 22);
}

// ===== NEW: FIND NEXT HTF RESISTANCE =====
function findNextHTFResistance(price, resistanceLevels) {
    if (!resistanceLevels || resistanceLevels.length === 0) return null;
    const above = resistanceLevels.filter(l => l.price > price);
    if (above.length === 0) return null;
    return Math.min(...above.map(l => l.price));
}

// ===== NEW: FIND NEXT HTF SUPPORT =====
function findNextHTFSupport(price, supportLevels) {
    if (!supportLevels || supportLevels.length === 0) return null;
    const below = supportLevels.filter(l => l.price < price);
    if (below.length === 0) return null;
    return Math.max(...below.map(l => l.price));
}

// ===== NEW: POSITION SIZE CALCULATOR =====
function calculatePositionSize(pipsRisk, accountBalance, riskPercent) {
    if (pipsRisk === 0) return 0.01;
    const riskAmount = accountBalance * (riskPercent / 100.0);
    const pipValue = 10.0;
    const lotSize = riskAmount / (pipsRisk * pipValue);
    return Math.round(Math.max(Math.min(lotSize, 10.0), 0.01) * 100) / 100;
}

// ===== NEW: ENTRY LEVEL FINDER (BUY) =====
function findBuyEntryLevel(context, chartData) {
    const ltfPrice = chartData.ltfData?.currentPrice || 0;

    // Find nearest valid bullish order block
    const validBullishOBs = (context.validOrderBlocks || [])
        .filter(ob => ob.type === 'BULLISH' && ob.isValid && ob.low < ltfPrice);

    if (validBullishOBs.length === 0) return null;

    const ob = validBullishOBs[validBullishOBs.length - 1];
    const entry = ob.high + 0.0005;
    const stopLoss = ob.low - 0.0010;
    const risk = entry - stopLoss;

    // Find next HTF resistance for TP
    const nextResistance = findNextHTFResistance(entry, context.htfResistanceLevels || []);
    const takeProfit = nextResistance || (entry + risk * 4.0);
    const partialTP = entry + risk * 2.0;
    const invalidation = ob.low - 0.0005;
    const breakevenLevel = entry + risk;

    return {
        entry, stopLoss, takeProfit, partialTP, invalidation, breakevenLevel,
        pattern: 'BULLISH_ORDER_BLOCK',
        rrRatio: (takeProfit - entry) / risk
    };
}

// ===== NEW: ENTRY LEVEL FINDER (SELL) =====
function findSellEntryLevel(context, chartData) {
    const ltfPrice = chartData.ltfData?.currentPrice || 0;

    const validBearishOBs = (context.validOrderBlocks || [])
        .filter(ob => ob.type === 'BEARISH' && ob.isValid && ob.high > ltfPrice);

    if (validBearishOBs.length === 0) return null;

    const ob = validBearishOBs[validBearishOBs.length - 1];
    const entry = ob.low - 0.0005;
    const stopLoss = ob.high + 0.0010;
    const risk = stopLoss - entry;

    const nextSupport = findNextHTFSupport(entry, context.htfSupportLevels || []);
    const takeProfit = nextSupport || (entry - risk * 4.0);
    const partialTP = entry - risk * 2.0;
    const invalidation = ob.high + 0.0005;
    const breakevenLevel = entry - risk;

    return {
        entry, stopLoss, takeProfit, partialTP, invalidation, breakevenLevel,
        pattern: 'BEARISH_ORDER_BLOCK',
        rrRatio: (entry - takeProfit) / risk
    };
}

// ===== NEW: COMPLETE SIGNAL OUTPUT BUILDER =====
function buildCompleteSignalOutput(signal, context, chartData, entryInfo) {
    const direction = signal.action;
    const rrRatio = entryInfo.rrRatio || 0;
    const winProb = calculateWinProbability(signal, context, direction);
    const expectedValue = calculateExpectedValue(winProb, rrRatio);
    const grade = getSignalGrade(signal.confidence);

    return {
        signal: {
            action: signal.action,
            pattern: entryInfo.pattern,
            grade: grade,
            confidence: Math.round(signal.confidence * 10) / 10,
            winProbability: Math.round(winProb * 10) / 10,
            expectedValue: Math.round(expectedValue * 100) / 100,
            setupScore: signal.setupScore || 0,
            filtersPassed: signal.filtersPassed || 0,
            reason: signal.reason || 'Setup validated by multiple filters',
            htfBias: context.htfTrendBias,
            marketPhase: context.htfMarketPhase,
            zoneType: context.htfZoneType
        },
        tradeLevels: {
            entry: Math.round(signal.entry * 100000) / 100000,
            stopLoss: Math.round(signal.stopLoss * 100000) / 100000,
            takeProfit: Math.round(signal.takeProfit * 100000) / 100000,
            partialTP: Math.round(entryInfo.partialTP * 100000) / 100000,
            invalidation: Math.round(entryInfo.invalidation * 100000) / 100000,
            breakeven: Math.round(entryInfo.breakevenLevel * 100000) / 100000,
            pipsRisk: Math.round(Math.abs(signal.entry - signal.stopLoss) / 0.0001 * 10) / 10,
            pipsReward: Math.round(Math.abs(signal.takeProfit - signal.entry) / 0.0001 * 10) / 10,
            riskReward: Math.round(rrRatio * 100) / 100
        },
        executionRules: {
            entryCondition: 'After candle CLOSE only',
            noMidCandle: true,
            noLateHTFCandle: true,
            noMidRange: true,
            requireLiquiditySweep: true,
            requireHTFBias: true,
            requireBOSorSweep: true
        }
    };
}

// ===== CHECK CHoCH (Change of Character) =====
function checkCHoCH(data) {
    if (data.length < 3) return false;
    const last = data[data.length - 1];
    const prev = data[data.length - 2];

    // Bullish CHoCH: bearish candle followed by bullish engulfing
    if (prev.c < prev.o && last.c > last.o && last.c > prev.h) return true;
    // Bearish CHoCH: bullish candle followed by bearish engulfing
    if (prev.c > prev.o && last.c < last.o && last.c < prev.l) return true;
    return false;
}
