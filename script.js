// Initialize (FIX #1: optional chaining so it doesn't crash outside Telegram)
const tg = window.Telegram?.WebApp;
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

// FIX #6: added pipSize per market so pips are correct for gold/JPY/BTC (not hardcoded 0.0001)
function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2, pipSize: 0.1, slBuffers: { '5M': 2, '15M': 3, '1H': 5, '4H': 8, '1D': 15 } };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.01, targetRR: 4, prec: 2, pipSize: 0.01, slBuffers: { '5M': 0.03, '15M': 0.05, '1H': 0.08, '4H': 0.12, '1D': 0.20 } };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.005, targetRR: 4, prec: 3, pipSize: 0.01, slBuffers: { '5M': 0.08, '15M': 0.12, '1H': 0.20, '4H': 0.35, '1D': 0.60 } };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.015, targetRR: 4, prec: 2, pipSize: 1, slBuffers: { '5M': 30, '15M': 50, '1H': 80, '4H': 120, '1D': 200 } };
    return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.005, targetRR: 4, prec: 5, pipSize: 0.0001, slBuffers: { '5M': 0.0003, '15M': 0.0005, '1H': 0.0008, '4H': 0.0012, '1D': 0.0020 } };
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
// FIX #2: cache is now keyed to the pair it was fetched for
let cachedPrice = null, priceCacheTime = 0, cachedPricePair = null;
const PRICE_CACHE_DURATION = 5000;

// FIX #2: switching pairs resets price cache + % change baseline + disables stale signal
function resetPairState() {
    cachedPrice = null; priceCacheTime = 0; cachedPricePair = null; lastPrice = null;
    analysis = null;
    const eb = document.getElementById('executeBtn'); if (eb && !limitOrder) eb.disabled = true;
    const cp = document.getElementById('currentPrice'); if (cp) cp.innerHTML = '––';
    const pc = document.getElementById('priceChange'); if (pc) { pc.innerHTML = '–'; pc.className = 'price-change'; }
}

document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();});
function init(){
    updateTime(); setInterval(updateTime,1000);
    const el = (id) => document.getElementById(id);
    if(el('analyzeBtn')) el('analyzeBtn').addEventListener('click',runAutoScan);
    if(el('executeBtn')) el('executeBtn').addEventListener('click',handleLimit);
    if(el('cancelLimitBtn')) el('cancelLimitBtn').addEventListener('click',cancelLimit);
    if(el('copyJsonBtn')) el('copyJsonBtn').addEventListener('click',copyJson);
    if(el('updateKeysBtn')) el('updateKeysBtn').addEventListener('click',showSetup);
    if(el('saveSetupBtn')) el('saveSetupBtn').addEventListener('click',saveCurrentSetup);
    if(el('recentList')) el('recentList').addEventListener('click',handleRecentClick);
    if(el('journalList')) el('journalList').addEventListener('click',handleJournalClick);
    renderRecents();
    renderJournal();
    if(el('pairSelect')) el('pairSelect').addEventListener('change',e=>{pair=e.target.value;resetPairState();});
    document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));
    loadLimitOrder();
}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML= `${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];resetPairState();}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF', 'NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

// ============================================
// API FUNCTIONS
// ============================================
// FIX #10: all Twelve Data requests go through fetchTD — 10s timeout so a hung
// request can't stall the scan, and rate-limit responses (code 429) surface to
// the user instead of failing silently as "No valid setups".
let rateLimitNotified = 0;
async function fetchTD(pathAndQuery, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(`${TWELVE_DATA_BASE}${pathAndQuery}&apikey=${TWELVE_DATA_KEY}`, { signal: ctrl.signal });
        const d = await r.json();
        if (d.code === 429) {
            const src = document.getElementById('apiSource');
            if (src) src.innerHTML = '🔴 Rate limited';
            if (Date.now() - rateLimitNotified > 30000) { rateLimitNotified = Date.now(); showNotif('⏳ Twelve Data rate limit hit - wait a minute and rescan', 'warning'); }
            throw new Error('Rate limited');
        }
        if (d.code && d.code !== 200) throw new Error(d.message || 'API Error');
        return d;
    } finally { clearTimeout(timer); }
}
// FIX #2/#3: getPrice now accepts an explicit pair (used by the limit-order monitor)
async function getPrice(forPair) {
    const p = forPair || pair;
    const now = Date.now();
    if (cachedPrice !== null && cachedPricePair === p && (now - priceCacheTime) < PRICE_CACHE_DURATION) return cachedPrice;
    if (!TWELVE_DATA_KEY) return null;
    try {
        const d = await fetchTD(`/price?symbol=${encodeURIComponent(SYMBOLS[p])}`);
        if (d.price) { calls++; document.getElementById('apiSource').innerHTML = '📡 Live'; cachedPrice = +d.price; priceCacheTime = now; cachedPricePair = p; return cachedPrice; }
    } catch(e) { if (cachedPrice !== null && cachedPricePair === p) return cachedPrice; }
    return null;
}
async function getQuote(tfStr){
    if(!TWELVE_DATA_KEY)return null;
    const interval = QUOTE_INTERVAL_MAP[tfStr] || '1day';
    try{
        const d=await fetchTD(`/quote?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${interval}`);
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

// FIX #21: accepts an explicit pair so the limit-order fill check can fetch the
// ORDER's pair even when a different pair is selected in the UI.
async function getHistory(tfStr, forPair){
    if(!TWELVE_DATA_KEY)return null;
    try{
        const d=await fetchTD(`/time_series?symbol=${encodeURIComponent(SYMBOLS[forPair || pair])}&interval=${TF_MAP[tfStr]}&outputsize=100`);
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
            const d = await fetchTD(e.url);
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
// FIX #11: EMA now seeds from the SMA of the first n periods (standard method);
// the first n-1 slots hold the running average so callers' indexing is unchanged.
const ema=(p,n)=>{const m=2/(n+1);let e=[],sum=0;for(let i=0;i<p.length;i++){if(i<n){sum+=p[i];e.push(sum/(i+1));}else e.push((p[i]-e[i-1])*m+e[i-1]);}return e;};
// FIX #11: RSI now uses Wilder's smoothing (SMA seed, then exponential smoothing)
// to match TradingView/MT4 instead of a plain average of the last n changes.
const rsi=(p,n=14)=>{if(p.length<n+1)return 50;let g=0,l=0;for(let i=1;i<=n;i++){const c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;for(let i=n+1;i<p.length;i++){const c=p[i]-p[i-1];ag=(ag*(n-1)+(c>0?c:0))/n;al=(al*(n-1)+(c<0?-c:0))/n;}return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};
// FIX #8: bear FVG midpoint was (next.h+next.l)/2 — a bear gap spans next.h..prev.l, so midpoint is (next.h+prev.l)/2
function detectFVG(d){let f=[],active=[];const len=d.length;for(let i=1;i<len-1;i++){const next=d[i+1];if(active.length>0){let keep=0;for(let k=0;k<active.length;k++){let g=active[k];if(g.type==='bull'){if(next.l<=g.h && next.l>=g.l)g.fresh=false;else active[keep++]=g;}else{if(next.h>=g.l && next.h<=g.h)g.fresh=false;else active[keep++]=g;}}active.length=keep;}const prev=d[i-1];const thresh=next.c*0.0005;if(prev.h<next.l && next.l-prev.h>thresh){let g={type:'bull',l:prev.h,h:next.l,m:(prev.h+next.l)/2,fresh:true};f.push(g);active.push(g);}if(prev.l>next.h && prev.l-next.h>thresh){let g={type:'bear',l:next.h,h:prev.l,m:(next.h+prev.l)/2,fresh:true};f.push(g);active.push(g);}}return f;}
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

    const expanding = lastRange > avgRange * 1.2;
    const contracting = lastRange < avgRange * 0.7;

    return {
        detected: true,
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
        // MSNR Fakeout / Sweep
        const msnrFakeout = last.l < zone.low && last.c > zone.low && bullishPinbar;
        const rejectionInZone = (wickedIntoZone && (closedAbove || bullishPinbar || last.c > last.o)) || msnrFakeout;
        const followThrough = last.c > prev.c && prev.c > prev2.c && last.c > last.o;
        if (msnrFakeout && followThrough) return { confirmed: true, type: 'MSNR fakeout + momentum', strength: 'STRONG' };
        if (bullishEngulf && followThrough) return { confirmed: true, type: 'bullish engulf + momentum', strength: 'STRONG' };
        if (bullishEngulf) return { confirmed: true, type: 'bullish engulf', strength: 'STRONG' };
        if (msnrFakeout) return { confirmed: true, type: 'MSNR fakeout sweep', strength: 'STRONG' };
        if (rejectionInZone && followThrough) return { confirmed: true, type: 'zone rejection + momentum', strength: 'MODERATE' };
        if (rejectionInZone) return { confirmed: true, type: 'zone rejection wick' , strength: 'MODERATE' };
        if (last.c > prev.c && last.c > prev2.c && last.c > last.o) return { confirmed: true, type: 'momentum shift', strength: 'WEAK' };
        return { confirmed: false, type: 'none', strength: 'NONE' };
    } else {
        const wickedIntoZone = last.h >= zone.low && last.h <= zone.high, closedBelow = last.c < zone.low;
        const bearishEngulf = last.c < last.o && prev.c > prev.o && last.c < prev.l;
        const bearishPinbar = (last.h - last.c) > Math.abs(last.c - last.o) * 2 && last.c < last.o;
        // MSNR Fakeout / Sweep
        const msnrFakeout = last.h > zone.high && last.c < zone.high && bearishPinbar;
        const rejectionInZone = (wickedIntoZone && (closedBelow || bearishPinbar || last.c < last.o)) || msnrFakeout;
        const followThrough = last.c < prev.c && prev.c < prev2.c && last.c < last.o;
        if (msnrFakeout && followThrough) return { confirmed: true, type: 'MSNR fakeout + momentum', strength: 'STRONG' };
        if (bearishEngulf && followThrough) return { confirmed: true, type: 'bearish engulf + momentum', strength: 'STRONG' };
        if (bearishEngulf) return { confirmed: true, type: 'bearish engulf', strength: 'STRONG' };
        if (msnrFakeout) return { confirmed: true, type: 'MSNR fakeout sweep', strength: 'STRONG' };
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
async function checkHTFConfluenceAsync(dailyData, h4Data, entryDirection) { const dailyDir = await getQuoteDirection('1D', dailyData), h4Dir = await getQuoteDirection('4H', h4Data), entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH'; if (dailyDir === entryDir && h4Dir === entryDir) return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 }; if (dailyDir === entryDir || h4Dir === entryDir) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: dailyDir === entryDir ? 8 : 15, alignedTF: dailyDir === entryDir ? '1D' : '4H' }; if (dailyDir === 'NEUTRAL' && h4Dir === 'NEUTRAL') return { level: 'NEUTRAL', daily: dailyDir, h4: h4Dir, penalty: 5 }; return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 30 }; }
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}
function findPrecisionEntry(data,price,direction,msnr){
    const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4),imbalances=findImbalances(data),orderBlocks=detectOrderBlocks(data,direction);
    const h=Math.max(...data.slice(-20).map(c=>c.h)),l=Math.min(...data.slice(-20).map(c=>c.l)),r=h-l;
    // FIX #18: OTE bands were inverted. A BUY retraces DOWN into discount - the
    // 61.8-79% retracement from the high is l+0.21r..l+0.382r (near the lows),
    // not l+0.618r..l+0.79r (premium). SELL is the mirror. The old bands gave the
    // +35 OTE bonus to zones in the WRONG half of the range and denied it to real
    // OTE zones, which then failed the A/B-quality gate.
    const oteLow = direction==='BUY' ? l+r*0.21 : h-r*0.382, oteHigh = direction==='BUY' ? l+r*0.382 : h-r*0.21;
    let allZones=[];
    if(direction==='BUY'){
        fvgs.filter(f=>f.type==='bull' && f.l<price && f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(f.l>=oteLow && f.l<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BULL' && Math.abs(b.p-f.l)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.L.find(x=>Math.abs(x.p-f.l)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-f.l)<f.l*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.filter(ob=>ob.high<price).forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.low>=oteLow && ob.low<=oteHigh){s+=35;cf.push('OTE');}if(swings.L.find(x=>Math.abs(x.p-ob.low)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-ob.low)<ob.low*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-ob.low)<ob.low*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        // FIX #23: MSNR is the primary methodology - highest base score, and the
        // two nearest levels are considered, not just one.
        for(const lvl of [msnr.allSupports?.[0], msnr.allSupports?.[1]].filter(v=>v && v<price)){let s=lvl===msnr.allSupports?.[0]?40:35;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bull' && Math.abs(f.l-lvl)<lvl*0.003)){s+=25;cf.push('FVG');}if(swings.L.find(x=>Math.abs(x.p-lvl)<lvl*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-lvl)<lvl*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:lvl*0.998,high:lvl*1.002,p:lvl,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
    } else {
        fvgs.filter(f=>f.type==='bear' && f.h>price && f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(f.h>=oteLow && f.h<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BEAR' && Math.abs(b.p-f.h)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.H.find(x=>Math.abs(x.p-f.h)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-f.h)<f.h*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.filter(ob=>ob.low>price).forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.high>=oteLow && ob.high<=oteHigh){s+=35;cf.push('OTE');}if(swings.H.find(x=>Math.abs(x.p-ob.high)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-ob.high)<ob.high*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-ob.high)<ob.high*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        for(const lvl of [msnr.allResistances?.[0], msnr.allResistances?.[1]].filter(v=>v && v>price)){let s=lvl===msnr.allResistances?.[0]?40:35;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bear' && Math.abs(f.h-lvl)<lvl*0.003)){s+=25;cf.push('FVG');}if(swings.H.find(x=>Math.abs(x.p-lvl)<lvl*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-lvl)<lvl*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:lvl*0.998,high:lvl*1.002,p:lvl,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
    }
    // FIX #23: TBS confluence - a turtle-soup sweep whose key level sits at a
    // zone strengthens that zone (primary methodology alongside MSNR/CRT).
    const tsSig=detectTurtleSoup(data);
    if(tsSig.detected && tsSig.type===direction){
        for(const z of allZones){
            if(Math.abs(z.p-tsSig.keyLevel)<price*0.004){z.score+=25;z.confluence+='+TBS';z.cc++;z.quality=z.score>=75?'A':(z.score>=55?'B':'C');}
        }
    }
    allZones.sort((x,y)=>y.score-x.score);
    if(allZones.length>0){
        // FIX #17: expose the ranked zone list so the caller can evaluate every
        // candidate through the full pipeline instead of just the top raw score.
        // Overlapping duplicates (same level found via FVG and MSNR) are merged.
        const cands=[];
        for(const z of allZones){
            const zp=(z.low+z.high)/2;
            if(cands.some(c=>Math.abs(c.p-zp)<zp*0.002))continue;
            cands.push({low:z.low,high:z.high,p:zp,src:z.src,confluence:z.confluence,cc:z.cc,quality:z.quality,hasImbalance:z.hasImbalance});
            if(cands.length>=5)break;
        }
        const b=cands[0];b.candidates=cands;return b;
    }
    // FIX #18: fallback OTE zone also uses the corrected bands (discount for BUY,
    // premium for SELL) - the old fallback sat on the wrong side of price and was
    // always rejected by the pending-order side gate.
    if(direction==='BUY'){const low=l+r*.21,high=l+r*.382;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};}
    else {const low=h-r*.382,high=h-r*.21;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};}
}
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Zone Magnetism',passed:magnetism.likelyToReach,critical:true});checks.push({name:'Imbalance Magnet',passed:zone.hasImbalance,critical:false});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=4?'HIGH':(tp>=3?'MEDIUM':'LOW')):'LOW',checks,totalPassed:tp,passed:cp};}

// 🛡️ TIGHTER ATR-DRIVEN STOP LOSS
function calcStopLoss(data, dir, entry, zone, msnr, tfUsed, twelveIndicators, currentPair) {
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
        if (dist > 0 && dist <= maxSLD && dist <= apiATR * 2.0) {
            candidates.push({ price, reason, dist });
        }
    };

    if (dir === 'BUY') {
        if (zone && zone.low < entry) addCand(zone.low - slBuf * 0.5, 'Below Zone');
        swings.L.filter(x => x.p < entry).forEach(x => addCand(x.p - slBuf, 'Below Swing'));
        obs.filter(ob => ob.low < entry).forEach(ob => addCand(ob.low - slBuf, 'Below OB'));
        fvgs.filter(f => f.type === 'bull' && f.l < entry).forEach(f => addCand(f.l - slBuf * 0.5, 'Below FVG'));
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
        candidates.sort((a, b) => a.dist - b.dist);
        const best = candidates[0];
        return { price: best.price, reason: best.reason, distance: best.dist };
    }

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
        return { tp1: entry + risk * rr1, tp2: entry + risk * rr2, tp3: entry + risk * rr3, rrUsed: rr1 };
    } else {
        return { tp1: entry - risk * rr1, tp2: entry - risk * rr2, tp3: entry - risk * rr3, rrUsed: rr1 };
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

// 🟢 UI DASHBOARD USES LIVE CANDLE DIRECTION (FIX #11: now also updates 1W card)
async function updateMTFDisplay(historyCache = {}){
    const tfs=['5M','15M','1H','4H','1D','1W'];
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
    let estHour = hour - 4;
    if (estHour < 0) estHour += 24;
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false, isMacro: false };
    if (time >= 0 && time < 4) s = { ...s, session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true };
    else if (time >= 7 && time < 10) s = { ...s, session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true };
    else if (time >= 12 && time < 15) s = { ...s, session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true };
    else if (time >= 15 && time < 17) s = { ...s, session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true };
    if ((time >= 8 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) { s.isSilverBullet = true; s.multiplier += 0.2; s.emoji = '🏹'; s.session += ' + SB'; }
    const estTime = estHour + min / 60;
    const isAM_Macro1 = (estTime >= 9.83 && estTime <= 10.16);
    const isAM_Macro2 = (estTime >= 10.83 && estTime <= 11.16);
    const isPM_Macro1 = (estTime >= 11.83 && estTime <= 12.16);
    const isPM_Macro2 = (estTime >= 13.16 && estTime <= 13.83);
    const isClose_Macro = (estTime >= 15.25 && estTime <= 15.75);
    if (isAM_Macro1 || isAM_Macro2 || isPM_Macro1 || isPM_Macro2 || isClose_Macro) {
        s.isMacro = true; s.multiplier += 0.3; s.emoji = '🔥'; s.session += ' (MACRO)';
    }
    return s;
}
// ============================================
// 📊 VOLUME / MARKET PROFILE
// Distributes each candle's volume across its high-low range into price bins.
// Returns POC (highest-volume bin), 70% value area (VAH/VAL), and HVN/LVN
// levels. When the feed has no real volume (Twelve Data forex/metals often
// doesn't), every candle carries the same default volume and this naturally
// degrades to a time-at-price (TPO/market) profile.
// ============================================
function calcVolumeProfile(data, binCount = 24) {
    if (!data || data.length < 20) return null;
    let hi = -Infinity, lo = Infinity;
    for (const c of data) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
    if (!(hi > lo)) return null;
    const binSize = (hi - lo) / binCount;
    const bins = new Array(binCount).fill(0);
    for (const c of data) {
        const from = Math.max(0, Math.min(binCount - 1, Math.floor((c.l - lo) / binSize)));
        const to = Math.max(from, Math.min(binCount - 1, Math.floor((c.h - lo) / binSize)));
        const per = (c.v || 1) / (to - from + 1);
        for (let j = from; j <= to; j++) bins[j] += per;
    }
    const total = bins.reduce((a, b) => a + b, 0);
    let pocIdx = 0;
    for (let i = 1; i < binCount; i++) if (bins[i] > bins[pocIdx]) pocIdx = i;
    // expand the value area around the POC until it holds 70% of volume
    let vaVol = bins[pocIdx], loIdx = pocIdx, hiIdx = pocIdx;
    while (vaVol < total * 0.7 && (loIdx > 0 || hiIdx < binCount - 1)) {
        const below = loIdx > 0 ? bins[loIdx - 1] : -1;
        const above = hiIdx < binCount - 1 ? bins[hiIdx + 1] : -1;
        if (above >= below) { hiIdx++; vaVol += bins[hiIdx]; } else { loIdx--; vaVol += bins[loIdx]; }
    }
    const priceAt = i => lo + binSize * (i + 0.5);
    const avg = total / binCount;
    const hvns = [], lvns = [];
    for (let i = 0; i < binCount; i++) {
        if (bins[i] > avg * 1.5) hvns.push(priceAt(i));
        if (bins[i] < avg * 0.5) lvns.push(priceAt(i));
    }
    return { poc: priceAt(pocIdx), vah: lo + binSize * (hiIdx + 1), val: lo + binSize * loIdx, hvns, lvns, binSize, high: hi, low: lo };
}

// Order-flow approximation from candles: cumulative signed volume over the
// last n bars. NOT real order flow (that needs tick/L2 data the feed doesn't
// provide) - a momentum-confirmation proxy only, and labeled as such.
function calcDeltaProxy(data, n = 20) {
    if (!data || data.length < 3) return { cvd: 0, direction: 'NEUTRAL', proxy: true };
    let cvd = 0;
    for (const c of data.slice(-n)) cvd += (c.c > c.o ? 1 : (c.c < c.o ? -1 : 0)) * (c.v || 1);
    return { cvd, direction: cvd > 0 ? 'BULLISH' : (cvd < 0 ? 'BEARISH' : 'NEUTRAL'), proxy: true };
}

// ============================================
// 🎯 SNIPER ENTRY MODEL
// Enforces the ICT sniper sequence as a unit instead of loose score nudges:
//   1. liquidity sweep (or turtle soup) in the trade's favor
//   2. market structure shift WITH displacement, aligned with direction
//   3. fresh (unmitigated) entry zone
//   4. zone sits in the OTE band (0.618-0.79 retrace)
//   5. killzone session (bonus - sharpens but not required)
// isSniper is only true when 1-3 all hold; 4-5 raise the score.
// ============================================
function checkSniperEntry(data, price, direction, zone, session) {
    const checks = [];
    let score = 0;

    const sweeps = detectLiquiditySweeps(data, price);
    const ts = detectTurtleSoup(data);
    const wantSweepDir = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const hasSweep = sweeps.some(s => s.direction === wantSweepDir) || (ts.detected && ts.type === direction);
    if (hasSweep) score += 30;
    checks.push({ name: 'Liquidity sweep', passed: hasSweep, critical: true });

    const mss = detectMSS(data);
    const mssAligned = direction === 'BUY' ? mss?.type === 'BULL' : mss?.type === 'BEAR';
    const mssDisplaced = mssAligned && mss.displaced === true;
    if (mssAligned) score += 15;
    if (mssDisplaced) score += 15;
    checks.push({ name: 'MSS + displacement', passed: mssDisplaced, critical: true });

    const freshness = checkZoneFreshness(data, zone, direction);
    const zoneFresh = freshness.fresh || (freshness.partiallyUsed && freshness.violations === 0);
    if (zoneFresh) score += 15;
    checks.push({ name: 'Zone fresh', passed: zoneFresh, critical: true });

    const inOTE = typeof zone.confluence === 'string' && zone.confluence.includes('OTE');
    if (inOTE) score += 15;
    checks.push({ name: 'Zone in OTE band', passed: inOTE, critical: false });

    const inKillzone = !!session?.isKillzone;
    if (inKillzone) score += 10;
    checks.push({ name: 'Killzone session', passed: inKillzone, critical: false });

    // FIX #23: alternative qualifying path for the MSNR/TBS/CRT methodology -
    // an aligned turtle soup at an MSNR-confluent fresh zone is also a sniper
    // setup, independent of the ICT sweep->MSS->displacement sequence.
    const tbsAligned = ts.detected && ts.type === direction;
    const atMSNR = zone.src === 'MSNR' || (typeof zone.confluence === 'string' && zone.confluence.includes('MSNR'));
    const altPath = tbsAligned && atMSNR && zoneFresh;
    if (altPath) score = Math.max(score, 70);
    checks.push({ name: 'TBS at MSNR level (alt path)', passed: altPath, critical: false });

    const isSniper = (hasSweep && mssDisplaced && zoneFresh) || altPath;
    return { isSniper, score, checks, grade: score >= 75 ? 'S' : (score >= 50 ? 'A' : 'B'), path: altPath ? 'MSNR+TBS' : (isSniper ? 'ICT' : null) };
}

function validateBreakerBlock(data, level, direction) { if (data.length < 25) return false; const moveAway = data.slice(-25).find(c => direction === 'BUY' ? c.c > level * 1.005 : c.c < level * 0.995); if (!moveAway) return false; const recent = data.slice(-5), touched = recent.some(c => direction === 'BUY' ? c.l <= level : c.h >= level), last = recent[recent.length - 1], rejected = direction === 'BUY' ? last.c > level : last.c < level; return touched && rejected; }

function analyzeAMD(dailyData) {
    if (!dailyData || dailyData.length < 2) return { phase: 'UNKNOWN' };
    const now = new Date(); const hour = now.getUTCHours();
    const candles = dailyData.slice(-24);
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

// ============================================
// FIX #4 (MAIN FIX): analyzeTimeframe now calls the REAL analysis functions
// instead of returning hardcoded stub values. Every field in the returned
// object is now computed from actual market data.
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    console.log(`🔍 Analyzing ${tfToAnalyze}...`);
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        console.log(`  → Trend: ${trendTF}, Structure: ${structureTF}, Entry: ${entryTF}, Sniper: ${sniperTF}`);

        const entryData = htfData[entryTF] || await getHistory(entryTF);
        if (!entryData?.length) { console.log(`  ❌ No entry data for ${entryTF}`); return null; }

        const structureData = htfData[structureTF] || await getHistory(structureTF);
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        const sig = score(entryData, price, twelveIndicators);
        console.log(`  → Score: direction=${sig.dir}, confidence=${sig.conf}`);

        // ===== CRT / TBS / SWEEPS / MSNR =====
        const crt = detectCRT(entryData, sig.dir);
        const turtleSoup = detectTurtleSoup(entryData);
        const sweeps = detectLiquiditySweeps(entryData, price);
        const hasSweep = sweeps.length > 0;
        const msnr = calculateMSNR(structureData || entryData, price);

        // ===== CRT RANGE / COMPLETION =====
        const crtRange = {
            high: Math.max(...entryData.slice(-20).map(c => c.h)),
            low: Math.min(...entryData.slice(-20).map(c => c.l))
        };
        const range = crtRange.high - crtRange.low;
        const pricePosition = range > 0 ? ((price - crtRange.low) / range) * 100 : 50;
        const isInOptimalZone = pricePosition > 40 && pricePosition < 60;

        const tbsQuality = gradeTBS(turtleSoup, sweeps, entryData);
        const msnrDistance = Math.abs(price - msnr.pivot) / price * 100;
        const isNearMSNR = msnrDistance < 0.2;
        const crtState = getCRTState(entryData);
        const session = getSession();

        // ===== SHARED (zone-independent) ANALYSIS =====
        const apiATR = twelveIndicators?.atr_api || atr(entryData, 14);
        // FIX #22: zones come from the ENTRY timeframe (e.g. 1H for a "1D" scan) but
        // apiATR is the SCAN timeframe's ATR (a 1D ATR on gold is ~9x the 1H ATR).
        // Using it for entry geometry inflated the minimum-distance gate to ~15
        // points (rejecting every fillable zone) and made entry buffers wider than
        // the zones themselves. All zone geometry now uses the entry TF's own ATR;
        // apiATR remains for scan-TF context (volatility label, indicator report).
        const entryATR = atr(entryData, 14);
        const obsAll = detectOrderBlocks(entryData, sig.dir);
        const fvgsAll = detectFVG(entryData);
        const mssData = detectMSS(entryData);
        const breakersAll = detectBreakers(entryData);
        const imbalances = findImbalances(entryData);
        const swingsData = findSwings(entryData, 4);
        const validOrderBlocks = obsAll.map(ob => ({ ...ob, isValid: true, type: sig.dir === 'BUY' ? 'BULLISH' : 'BEARISH' }));
        const validFvgs = fvgsAll.map(fvg => ({ ...fvg, isValid: true }));
        const bosConfirmed = mssData !== null && mssData.displaced === true;
        const displacement = detectDisplacement(entryData, sig.dir);
        const hasDisplacement = displacement.detected;
        const htfSupportLevels = swingsData.L.map(sw => ({ price: sw.p, strength: 3 }));
        const htfResistanceLevels = swingsData.H.map(sw => ({ price: sw.p, strength: 3 }));
        const amd = analyzeAMD(htfData['1H'] || entryData);
        const volatility = getVolatilityLevel(apiATR, price);
        const volumeProfile = calcVolumeProfile(entryData);
        const deltaProxy = calcDeltaProxy(entryData);
        const premiumDiscount = isHTFPremiumDiscount(structureData || entryData, sig.dir);
        const mtfTrends = {};
        let alignedCount = 0;
        for (const t of ALL_TIMEFRAMES) {
            const d = htfData[t];
            const tr = (d && d.length >= 50) ? detectTrend(d) : 'NEUTRAL';
            mtfTrends[t] = tr;
            if ((sig.dir === 'BUY' && tr === 'BULLISH') || (sig.dir === 'SELL' && tr === 'BEARISH')) alignedCount++;
        }
        const mtf = { direction: sig.dir, strength: alignedCount, trends: mtfTrends };

        // FIX #27: directional bias gate. A setup that fights BOTH the 1D and 4H
        // trends is dead on arrival - professionals do not fade the full HTF bias.
        // Rejected here, before zone scoring and before the AI is even consulted.
        const againstDir = sig.dir === 'BUY' ? 'BEARISH' : 'BULLISH';
        if (mtfTrends['1D'] === againstDir && mtfTrends['4H'] === againstDir) {
            console.log(`  ❌ ${tfToAnalyze}: ${sig.dir} fights both 1D and 4H (${againstDir}) - no trading against full HTF bias`);
            return null;
        }
        const htfArrays = structureData ? findPDArrays(structureData, sig.dir) : [];
        const settings = getMarketSettings(pair);
        const pipSize = settings.pipSize || 0.0001;
        const rs = twelveIndicators?.rsi || rsi(entryData.map(c => c.c));

        // ===== FIX #17: EVALUATE ALL CANDIDATE ZONES, GIVE THE BEST =====
        // Previously one zone (top raw confluence score) ran through the pipeline
        // alone - a mediocre nearby zone could be shown at 40% while a deeper,
        // fresher zone that would score 60%+ was never even checked. Every A/B
        // multi-confluence candidate now runs the FULL check pipeline and the
        // highest-confidence zone wins.
        const topZone = findPrecisionEntry(entryData, price, sig.dir, msnr);
        const allCandidates = (topZone.candidates?.length ? topZone.candidates : [topZone]);
        let zoneCandidates = allCandidates.filter(z => z.quality !== 'C' && z.cc >= 2).slice(0, 4);
        if (zoneCandidates.length === 0) {
            // Fallback: allow any zone with at least 1 confluence so standalone MSNR
            // levels and lone OBs can be evaluated. The confidence calculation will
            // naturally score these low (no quality bonus, LOW probability penalty),
            // so a NO_TRADE result is shown with reasoning rather than silent "no setup".
            zoneCandidates = allCandidates.filter(z => z.cc >= 1).slice(0, 4);
        }
        if (zoneCandidates.length === 0) {
            console.log(`  ❌ ${tfToAnalyze}: no zones found in any direction`);
            return null;
        }

        const evaluateZone = async (zone) => {
            const chochDetected = checkCHoCH(entryData, zone.low, zone.high);
            const inducementSwept = detectInducement(entryData, zone.low, zone.high, sig.dir);
            const precisionEntry = getPrecisionEntryCRT(entryData, zone, sig.dir, crtRange, entryATR);

            // FIX #15/#22: pending-order semantics - entry on the retrace side of
            // price, far enough away that price must travel into the zone to trigger.
            // Distances are measured in ENTRY-TF ATR so the gate stays proportional.
            const entryDistance = sig.dir === 'BUY' ? price - precisionEntry.entry : precisionEntry.entry - price;
            if (entryDistance <= 0 || entryDistance < entryATR * 0.2) return null;
            const entryDistanceATR = entryDistance / entryATR;
            const entryDistancePct = (entryDistance / price) * 100;

            // FIX #22: the SL engine also anchors its buffers to the entry-TF ATR
            // (TF-keyed base buffers keep the scan-TF character of the stop).
            const slResult = calcStopLoss(entryData, sig.dir, precisionEntry.entry, zone, msnr, tfToAnalyze, { ...(twelveIndicators || {}), atr_api: entryATR }, pair);
            const finalSL = slResult.price;
            const tps = calcTakeProfits(sig.dir, precisionEntry.entry, finalSL);
            const rrUsed = tps.rrUsed;
            const invalidationPrice = sig.dir === 'BUY' ? finalSL * 0.998 : finalSL * 1.002;
            const entryTiming = checkEntryTiming(entryData, precisionEntry.entry, sig.dir);
            const zoneReaction = checkZoneReaction(entryData, zone, sig.dir);
            const zoneTouches = countZoneTouches(entryData, zone, sig.dir);
            const magnetism = checkZoneMagnetism(entryData, price, precisionEntry.entry, sig.dir);
            // FIX #16: nothing pulling price toward the zone -> limit never fills -> skip
            if (!magnetism.likelyToReach) return null;
            const freshness = checkZoneFreshness(entryData, zone, sig.dir);
            const pathCheck = checkPathClearance(entryData, precisionEntry.entry, tps.tp1, sig.dir);
            const sniperRej = await checkSniperRejection(zone, sig.dir, sniperTF, htfData[sniperTF]);
            const sniperEntry = checkSniperEntry(entryData, price, sig.dir, zone, session);
            const breakerValid = validateBreakerBlock(entryData, zone.p, sig.dir);
            const htfCheck = isZoneWithinHTFArray(zone, htfArrays);
            const htfValidation = { passed: htfCheck.contained, parentArray: htfCheck.parentArray ? { ...htfCheck.parentArray, structureTF } : null, partial: htfCheck.partial || false };
            const probCheck = checkProbability(zone, mtf, magnetism);
            const entryReady = entryTiming.valid && isInOptimalZone && zoneReaction.confirmed;

            const context = {
                htfTrendBias: mtfTrends['1D'] !== 'NEUTRAL' ? mtfTrends['1D'] : (sig.dir === 'BUY' ? 'BULLISH' : 'BEARISH'),
                htfMarketPhase: crtState?.state || 'CONSOLIDATION',
                htfRangeHigh: crtRange?.high || price * 1.01,
                htfRangeLow: crtRange?.low || price * 0.99,
                htfZoneType: premiumDiscount.inPremiumDiscount ? (sig.dir === 'BUY' ? 'DISCOUNT' : 'PREMIUM') : 'MID_RANGE',
                htfBosConfirmed: bosConfirmed,
                htfChochDetected: chochDetected,
                validOrderBlocks: validOrderBlocks,
                validFvgs: validFvgs,
                liquiditySweeps: sweeps || [],
                htfSupportLevels: htfSupportLevels,
                htfResistanceLevels: htfResistanceLevels,
                ltfPullbackIntoZone: entryTiming.valid || false,
                ltfDisplacementCandle: hasDisplacement,
                ltfCompressionDetected: crtState?.isContracting || false,
                sessionValid: getSession().isKillzone || getSession().isMacro || false,
                inducementSwept: inducementSwept
            };
            const setupScore = calculateSetupScore(sig.dir, context);
            const entryInfo = {
                entry: precisionEntry.entry,
                stopLoss: finalSL,
                takeProfit: tps.tp1,
                partialTP: tps.tp2,
                invalidation: invalidationPrice,
                breakevenLevel: precisionEntry.entry,
                pattern: zone.src,
                rrRatio: rrUsed
            };
            const winProb = Math.min(70 + (setupScore * 2) + (sig.conf > 80 ? 10 : 0), 95);
            const expectedValue = (winProb / 100 * rrUsed) - ((100 - winProb) / 100 * 1);
            const signalGrade = getSignalGrade(sig.conf);
            const tradeLevels = {
                entry: entryInfo.entry,
                stopLoss: entryInfo.stopLoss,
                takeProfit: entryInfo.takeProfit,
                partialTP: entryInfo.partialTP,
                invalidation: entryInfo.invalidation,
                breakeven: entryInfo.breakevenLevel,
                pipsRisk: +((Math.abs(entryInfo.entry - entryInfo.stopLoss) / pipSize).toFixed(1)),
                pipsReward: +((Math.abs(entryInfo.takeProfit - entryInfo.entry) / pipSize).toFixed(1)),
                riskReward: rrUsed
            };

            // ===== FINAL CONFIDENCE (FIX #14: every adjustment logged) =====
            let conf = sig.conf;
            const confLog = [{ adj: sig.conf, reason: `Base signal score (${sig.dir})` }];
            const bump = (amount, reason) => { conf += amount; confLog.push({ adj: amount, reason }); };
            if (crt.pattern === 'Expanding') bump(5, 'CRT expanding range');
            if (turtleSoup.detected) bump(8, 'Turtle soup detected');
            // FIX #23: MSNR/TBS/CRT are the primary methodology - graded TBS quality
            // and MSNR-sourced zones now carry real confidence weight.
            if (tbsQuality.grade === 'A') bump(10, 'TBS grade A (quality sweep pattern)');
            else if (tbsQuality.grade === 'B') bump(6, 'TBS grade B');
            if (zone.src === 'MSNR') bump(6, 'MSNR level zone (primary methodology)');
            if (hasSweep) bump(5, 'Liquidity sweep present');
            if (isNearMSNR) bump(5, 'Near MSNR pivot');
            if (isInOptimalZone) bump(5, 'Price in optimal range zone');
            if (zone.quality === 'A') bump(10, 'A-quality zone');
            else if (zone.quality === 'B') bump(5, 'B-quality zone');
            if (session.isKillzone) bump(8, `Killzone session (${session.session})`);
            if (setupScore >= 7) bump(10, `Setup score ${setupScore}/10`);
            if (bosConfirmed) bump(8, 'BOS with displacement');
            if (hasDisplacement) bump(5, 'Displacement candle');
            if (zoneReaction.confirmed && zoneReaction.strength === 'STRONG') bump(8, `Strong zone reaction (${zoneReaction.type})`);
            if (htfValidation.passed) bump(5, 'Zone inside HTF structure');
            if (magnetism.magnetism === 'STRONG') bump(5, 'Strong zone magnetism');
            if (sniperEntry.isSniper) bump(12, '\ud83c\udfaf Sniper sequence complete');
            else if (sniperEntry.score < 40) bump(-8, `Sniper sequence weak (${sniperEntry.score}/100)`);
            if (volumeProfile) {
                const zoneInLVN = volumeProfile.lvns.some(p => p >= zone.low && p <= zone.high);
                const nearVAEdge = sig.dir === 'BUY' ? Math.abs(zone.p - volumeProfile.val) < entryATR : Math.abs(zone.p - volumeProfile.vah) < entryATR;
                if (zoneInLVN) bump(5, 'Zone in low-volume node');
                if (nearVAEdge) bump(5, 'Zone at value-area edge');
            }
            if (deltaProxy.direction === (sig.dir === 'BUY' ? 'BULLISH' : 'BEARISH')) bump(4, 'Delta proxy aligned');
            else if (deltaProxy.direction !== 'NEUTRAL') bump(-4, 'Delta proxy opposing');
            if (session.session === 'OFF-HOURS') bump(-15, 'Outside killzones (lower-liquidity window, market may still be open)');
            if (session.session === 'ASIA KZ') bump(-5, 'Asia session (lower liquidity)');
            if (!hasSweep && !turtleSoup.detected) bump(-10, 'No liquidity sweep or turtle soup');
            if (msnrDistance > 1.0) bump(-10, `Far from MSNR pivot (${msnrDistance.toFixed(1)}%)`);
            // FIX #19b: a pending zone price has never tested cannot have a reaction -
            // the direct evidence is zoneTouches, not distance (a 1D ATR window is so
            // wide that "near" still means untouched). Only penalize a missing
            // reaction when price actually tested the zone and failed to react.
            if (!entryReady) {
                if (zoneTouches > 0) bump(-10, `Zone tested ${zoneTouches}x with no confirmed reaction`);
                else confLog.push({ adj: 0, reason: 'Pending zone untouched - reaction checked when price arrives (no penalty)' });
            }
            if (freshness.used) bump(-10, `Zone already used (${freshness.touches} touches)`);
            if (!pathCheck.clear) bump(-8, `Path to TP blocked (${pathCheck.obstacles.join(', ')})`);
            if (probCheck.probability === 'LOW') bump(-8, 'Probability check LOW');
            const rawConf = conf;
            conf = Math.max(10, Math.min(98, conf));
            if (conf !== rawConf) confLog.push({ adj: conf - rawConf, reason: `Clamped to ${conf < rawConf ? 'max 98' : 'min 10'}` });

            return {
                timeframe: tfToAnalyze,
                direction: sig.dir,
                entry: precisionEntry.entry,
                sl: finalSL,
                tp1: tps.tp1,
                tp2: tps.tp2,
                tp3: tps.tp3,
                confidence: conf,
                zone, msnr,
                crt: crt || { detected: false, pattern: 'Neutral' },
                turtleSoup, sweeps, session, tbsQuality, msnrDistance, crtRange, crtState,
                isInOptimalZone, isNearMSNR, entryReady, entryTiming, hasSweep,
                trendTF: trendTF || 'N/A',
                structureTF: structureTF || 'N/A',
                entryTF: entryTF || 'N/A',
                sniperTF: sniperTF || 'N/A',
                zoneReaction, zoneTouches, mtf,
                qualityScore: 0, // set by calculateSetupQuality in runAutoScan
                htfValidation, magnetism, freshness, premiumDiscount, breakerValid, amd,
                pathCheck, probCheck, displacement, sniperRej, sniperEntry, volumeProfile, deltaProxy,
                slResult, invalidationPrice, confBreakdown: confLog,
                entryDistanceATR, entryDistancePct, entryATR,
                rrUsed, rs, apiATR,
                fvgsAll: fvgsAll || [],
                obsAll: obsAll || [],
                breakersAll: breakersAll || [],
                twelveIndicators: twelveIndicators || {},
                tfAlign: `Trend:${trendTF}\u2192Structure:${structureTF}\u2192Entry:${entryTF}\u2192Sniper:${sniperTF}`,
                volatility,
                mss: mssData || null,
                imbalances: imbalances || [],
                setupScore: setupScore || 0,
                winProbability: winProb || 70,
                expectedValue: expectedValue || 0,
                signalGrade: signalGrade || 'C',
                context: context || {},
                entryInfo: entryInfo || {},
                tradeLevels: tradeLevels || {}
            };
        };

        let bestResult = null;
        for (const cand of zoneCandidates) {
            const evaluated = await evaluateZone(cand);
            if (evaluated) {
                console.log(`  \u00b7 zone ${cand.src} ${cand.confluence} [Q:${cand.quality}] @ ${cand.p.toFixed(2)} \u2192 ${evaluated.confidence}%`);
                if (!bestResult || evaluated.confidence > bestResult.confidence) bestResult = evaluated;
            }
        }
        if (!bestResult) {
            console.log(`  \u274c ${tfToAnalyze}: ${zoneCandidates.length} candidate zone(s) checked, none qualified (side/distance/reachability)`);
            return null;
        }
        bestResult.zonesEvaluated = zoneCandidates.length;
        bestResult.alternativeZones = zoneCandidates
            .filter(z => z.p !== bestResult.zone.p)
            .map(z => ({ src: z.src, quality: z.quality, confluence: z.confluence, low: z.low, high: z.high }));
        console.log(`  \u2705 ${tfToAnalyze}: best of ${zoneCandidates.length} zones \u2192 ${bestResult.zone.src} ${bestResult.zone.confluence} @ ${bestResult.entry} (${bestResult.confidence}%)`);
        return bestResult;

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

    if (last > avg * 1.5) { state = 'EXPANDING'; momentum = 'STRONG'; }
    else if (last < avg * 0.5) { state = 'CONTRACTING'; momentum = 'WEAK'; }
    else { state = 'CONSOLIDATING'; momentum = 'MODERATE'; }

    const firstHalf = ranges.slice(0, 5);
    const secondHalf = ranges.slice(5);
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg > firstAvg * 1.2) { state = 'EXPANDING'; momentum = 'STRONG'; }
    else if (secondAvg < firstAvg * 0.8) { state = 'CONTRACTING'; momentum = 'WEAK'; }

    return {
        state, momentum, avgRange: avg, lastRange: last,
        isExpanding: state === 'EXPANDING',
        isContracting: state === 'CONTRACTING',
        isConsolidating: state === 'CONSOLIDATING'
    };
}

// ===== FUNCTION 3: PRECISION ENTRY WITH CRT =====
// FIX #10: buffers now come from getMarketSettings (were hardcoded forex values
// like 0.0002/0.0010 — meaningless for gold and BTC)
function getPrecisionEntryCRT(candles, zone, direction, crtRange, apiATR) {
    const last = candles[candles.length - 1];
    if (!last) {
        return { entry: (zone.low + zone.high) / 2, sl: null, tp1: null, tp2: null, tp3: null, reason: 'Default entry' };
    }

    const atrValue = apiATR || atr(candles, 14);
    const settings = getMarketSettings(pair);
    const prec = settings.prec || 5;

    const entryBuffer = Math.max(atrValue * 0.3, settings.minSL * 0.5);
    const slBufferValue = Math.max(atrValue * 0.5, settings.slBuffer);

    let entry, sl, tp1, tp2, tp3;
    const rr = settings.targetRR || 4;

    // FIX #22: enter at the zone's CE (consequent encroachment - the 50% midpoint),
    // the ICT convention and what the backtester already simulates. The old
    // zone.low+buffer placement sat at the DEEP edge, so price had to cut through
    // nearly the whole zone before the limit filled - a major reason orders never
    // triggered (worse still when the buffer used a scan-TF ATR wider than the zone).
    if (direction === 'BUY') {
        entry = (zone.low + zone.high) / 2;
        sl = Math.min(zone.low - slBufferValue, crtRange.low - slBufferValue);
        if (sl >= entry) sl = entry - slBufferValue;
        const risk = entry - sl;
        if (risk <= 0) sl = entry - settings.slBuffer;
        const actualRisk = entry - sl;
        tp1 = entry + actualRisk * rr;
        tp2 = entry + actualRisk * (rr + 1);
        tp3 = entry + actualRisk * (rr + 2);
    } else {
        entry = (zone.low + zone.high) / 2;
        sl = Math.max(zone.high + slBufferValue, crtRange.high + slBufferValue);
        if (sl <= entry) sl = entry + slBufferValue;
        const risk = sl - entry;
        if (risk <= 0) sl = entry + settings.slBuffer;
        const actualRisk = sl - entry;
        tp1 = entry - actualRisk * rr;
        tp2 = entry - actualRisk * (rr + 1);
        tp3 = entry - actualRisk * (rr + 2);
    }

    const factor = Math.pow(10, prec);
    entry = Math.round(entry * factor) / factor;
    sl = Math.round(sl * factor) / factor;
    tp1 = Math.round(tp1 * factor) / factor;
    tp2 = Math.round(tp2 * factor) / factor;
    tp3 = Math.round(tp3 * factor) / factor;

    return {
        entry, sl, tp1, tp2, tp3,
        reason: `ATR-adjusted entry (buffer: ${entryBuffer.toFixed(prec)})`
    };
}

// ===== FUNCTION 4: CRT-BASED CONFIDENCE =====
function calculateCRTConfidence(data) {
    let score = 0;
    if (data.crtState.isExpanding) score += 15;
    else if (data.crtState.isContracting) score += 5;
    else score += 10;

    if (data.tbsQuality.grade === 'A') score += 25;
    else if (data.tbsQuality.grade === 'B') score += 20;
    else if (data.tbsQuality.grade === 'C') score += 10;
    else score += 5;

    if (data.isNearMSNR) score += 20;
    else if (data.msnrDistance < 0.5) score += 10;
    else score += 5;

    // Alchemist specific MSNR Reaction Score
    if (data.zoneReaction && data.zoneReaction.type.includes('MSNR fakeout')) {
        score += 20; // Massive confidence boost for identifying fakeouts / sweeps in MSNR
    }

    if (data.session.session === 'LONDON KZ' || data.session.session === 'NEW_YORK KZ') score += 15;
    else if (data.session.isKillzone) score += 10;
    else if (data.session.session === 'ASIA KZ') score += 5;
    else score += 2;

    if (data.isInOptimalZone) score += 10;
    if (data.hasSweep) score += 10;
    if (data.zone.quality === 'A') score += 10;
    else if (data.zone.quality === 'B') score += 5;

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

    // FIX #15: TF preference is a mild tiebreaker, not a fiat. The old weights
    // (1D:100, 4H:80...) pushed 1D setups straight to the 100-point cap before a
    // single quality check ran, so 1D won every scan regardless of setup merit.
    const tfWeights = { '1D': 15, '4H': 12, '1H': 10, '15M': 4, '5M': 2 };
    score += tfWeights[result.timeframe] || 2;
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

    // FIX #24: no 100 cap. Good setups accumulate 120-180 raw points, so the old
    // Math.min(100, ...) made every decent setup tie at exactly 100 - and stable
    // sort then resolved the tie by scan order, which starts at 1D. That is why
    // the 1D setup won every scan regardless of merit. Raw scores differentiate.
    return Math.max(0, score);
}

// FIX #12: the AI response is validated before use — a hallucinated entry zone
// on the wrong side of price, a nonsense invalidation level, or an extreme
// confidence adjustment previously flowed straight into the trade signal.
function validateAIResult(ai, best, price, allowedTimeframes) {
    const ts = ai?.trade_signal_Theghostmachine;
    if (!ts || typeof ts !== 'object') return null;
    if (!['enter_now', 'wait_for_reaction', 'skip'].includes(ts.execution_decision)) delete ts.execution_decision;
    if (ts.selected_timeframe && (!Array.isArray(allowedTimeframes) || !allowedTimeframes.includes(ts.selected_timeframe))) delete ts.selected_timeframe;
    if (ts.rule_checks && !Array.isArray(ts.rule_checks)) delete ts.rule_checks;
    ts.confidence_adjustment = Math.max(-25, Math.min(25, +ts.confidence_adjustment || 0));
    if (ts.entry_refinement) {
        const { low, high } = ts.entry_refinement;
        const zoneWidth = best.zone.high - best.zone.low;
        const nearOriginal = typeof low === 'number' && typeof high === 'number' && low < high &&
            Math.abs(low - best.zone.low) <= zoneWidth * 1.5 && Math.abs(high - best.zone.high) <= zoneWidth * 1.5;
        const correctSide = best.direction === 'BUY' ? high < price : low > price;
        if (!nearOriginal || !correctSide) delete ts.entry_refinement;
    }
    if (typeof ts.invalidation_price === 'number') {
        const validInval = best.direction === 'BUY' ? ts.invalidation_price < best.entry : ts.invalidation_price > best.entry;
        if (!validInval) delete ts.invalidation_price;
    } else delete ts.invalidation_price;
    return ai;
}

async function askAIWithAllResults(allResults, price, htfData) {
    if (!DEEPSEEK_API_KEY || allResults.length === 0) return null; showNotif('🤖 AI strict execution check...', 'info');
    let tfSummary = ''; for (const r of allResults) { const htfStatus = r.htfValidation ? (r.htfValidation.passed ? 'In HTF' : 'No HTF') : 'N/A'; tfSummary += `${r.timeframe}: ${r.direction} | Zone: $${r.zone.low.toFixed(2)}-$${r.zone.high.toFixed(2)} | EntryReady: ${r.entryReady ? 'YES' : 'NO'} | React: ${r.zoneReaction?.confirmed ? r.zoneReaction.type : 'None'} | HTF: ${htfStatus} | Touches: ${r.zoneTouches} | Conf:${r.confidence}% | RR:1:${r.rrUsed}\n`; }
    const best = allResults[0], prec = getPrec(pair), dailyDir = await getQuoteDirection('1D', htfData['1D']), h4Dir = await getQuoteDirection('4H', htfData['4H']), htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction);
    // FIX #12: the model now sees the actual market context — recent candles, key
    // levels, sweeps, and the sniper-sequence breakdown — instead of one summary
    // line per timeframe, so its decision can add information rather than echo flags.
    const entryData = htfData[best.entryTF] || [];
    const recentCandles = entryData.slice(-12).map(c => `${c.t}: O${c.o.toFixed(prec)} H${c.h.toFixed(prec)} L${c.l.toFixed(prec)} C${c.c.toFixed(prec)}`).join('\n');
    const sweepLines = (best.sweeps || []).slice(0, 4).map(s => `${s.type} @ $${s.level.toFixed(prec)} (${s.direction})`).join('; ') || 'none';
    const sniperLines = (best.sniperEntry?.checks || []).map(c => `${c.name}: ${c.passed ? 'PASS' : 'FAIL'}${c.critical ? ' (critical)' : ''}`).join('; ');
    const prompt = `You are TheGhostMachine, a strict ICT execution auditor. Your job is to find reasons NOT to take this trade; approve only if the setup survives every check.
PAIR: HIDDEN_ASSET | PRICE: $${price.toFixed(prec)} | ATR: ${best.apiATR?.toFixed(prec) || 'n/a'} | Volatility: ${best.volatility?.level || 'n/a'}
HTF: 1D=${dailyDir} 4H=${h4Dir} | Confluence: ${htfConfluence.level}
SESSION: ${best.session.session} | Killzone=${best.session.isKillzone} | SilverBullet=${best.session.isSilverBullet} | AMD=${best.amd.phase}
KEY LEVELS: Pivot $${best.msnr.pivot.toFixed(prec)} | Support $${best.msnr.nearestSupport?.toFixed(prec) || 'n/a'} | Resistance $${best.msnr.nearestResistance?.toFixed(prec) || 'n/a'}
VOLUME PROFILE: ${best.volumeProfile ? `POC $${best.volumeProfile.poc.toFixed(prec)} | VAH $${best.volumeProfile.vah.toFixed(prec)} | VAL $${best.volumeProfile.val.toFixed(prec)} | zone in LVN: ${best.volumeProfile.lvns.some(p => p >= best.zone.low && p <= best.zone.high) ? 'YES' : 'no'}` : 'n/a'} | Delta proxy(20): ${best.deltaProxy?.direction || 'n/a'}
LIQUIDITY SWEEPS: ${sweepLines}
SNIPER SEQUENCE: ${best.sniperEntry?.isSniper ? 'COMPLETE' : 'INCOMPLETE'}${best.sniperEntry?.path ? ` via ${best.sniperEntry.path}` : ''} (${sniperLines})
METHOD: MSNR levels + Turtle Soup + CRT are the PRIMARY strategy; ICT FVG/OB are secondary confluence. TBS grade: ${best.tbsQuality?.grade || 'n/a'} | CRT state: ${best.crtState?.state || best.crt?.pattern || 'n/a'} | MSNR distance: ${best.msnrDistance?.toFixed(2) || 'n/a'}%
PATH TO TP: ${best.pathCheck?.clear ? 'clear' : 'obstacles: ' + (best.pathCheck?.obstacles || []).join(', ')}
ZONE: fresh=${best.freshness?.fresh} touches=${best.zoneTouches} magnetism=${best.magnetism?.magnetism} (${best.magnetism?.score}/100)
ALL TIMEFRAMES:
${tfSummary}
TOP SETUP (${best.timeframe}):
Direction: ${best.direction} | Zone: $${best.zone.low.toFixed(prec)}-$${best.zone.high.toFixed(prec)} (${best.zone.src} Q:${best.zone.quality}, confluence: ${best.zone.confluence})
HTF Validated: ${best.htfValidation ? (best.htfValidation.passed ? 'YES' : 'NO') : 'N/A'}
Entry Ready: ${best.entryReady ? 'YES' : 'NO'} | Reaction: ${best.zoneReaction?.confirmed ? best.zoneReaction.type : 'NONE'}
Entry: $${best.entry.toFixed(prec)} | SL: $${best.sl.toFixed(prec)} | TP1: $${best.tp1.toFixed(prec)} | RR: 1:${best.rrUsed}
DISTANCE TO ENTRY: ${(best.entryDistancePct ?? 0).toFixed(2)}% (${(best.entryDistanceATR ?? 0).toFixed(1)}x ATR) - this is a PENDING limit order; price has NOT reached the zone yet
RECENT ${best.entryTF} CANDLES (oldest first):
${recentCandles || 'n/a'}

HARD RULES (evaluate EVERY rule and report a verdict for each in rule_checks):
1. HTF Confluence level CONFLICT (BOTH 1D and 4H oppose the trade) -> "skip". PARTIAL is NOT conflict - one HTF agreeing (especially 1D) is acceptable; never skip solely for PARTIAL.
2. This is a pending limit order: if price has NOT reached the zone yet (see DISTANCE TO ENTRY), a missing zone reaction is EXPECTED and is NOT a defect - do not fail this rule or reject for it; "wait_for_reaction" is the natural decision. Only fail if price already tested the zone and failed to react.
3. HTF not validated AND sniper sequence INCOMPLETE -> "skip".
4. Path to TP has obstacles AND RR < 3 -> "skip".
5. Sniper sequence COMPLETE + killzone + fresh zone -> lean "enter_now".
Confidence_adjustment must stay within -25..+25 and reflect how many checks the setup failed.
entry_refinement (optional) must stay inside or overlap the given zone and be on the correct side of current price.
invalidation_price must be beyond the stop loss side of entry (below entry for BUY, above for SELL).
If a DIFFERENT timeframe in the list above is strictly better than the top setup (better HTF alignment, fresher zone, reaction confirmed), set selected_timeframe to it; otherwise omit the field.

Return ONLY JSON in this exact format:
{
  "trade_signal_Theghostmachine": {
    "approved": boolean,
    "confidence_adjustment": number,
    "execution_decision": "enter_now" | "wait_for_reaction" | "skip",
    "wait_condition": "string",
    "selected_timeframe": "string (optional)",
    "rule_checks": [{ "rule": 1, "verdict": "PASS" | "FAIL" | "N/A", "note": "string" }],
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
    // FIX #13: try DeepSeek's reasoning model (R1) first - it deliberates over the
    // rule list before answering, which chat-tier models are weak at. Falls back to
    // deepseek-chat with native JSON mode if the reasoner fails or returns bad JSON.
    // FIX #12: abort timeouts and generous token budgets so JSON can't truncate.
    const messages = [{ role: 'system', content: 'You are a strict ICT execution auditor. Return ONLY valid JSON.' }, { role: 'user', content: prompt }];
    const attempts = [
        { model: 'deepseek-reasoner', body: { model: 'deepseek-reasoner', messages, max_tokens: 4000 }, timeout: 60000 },
        { model: 'deepseek-chat', body: { model: 'deepseek-chat', messages, temperature: 0.1, max_tokens: 1600, response_format: { type: 'json_object' } }, timeout: 30000 }
    ];
    const allowedTFs = allResults.map(r => r.timeframe);
    for (const attempt of attempts) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), attempt.timeout);
        try {
            const r = await fetch(DEEPSEEK_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }, signal: ctrl.signal, body: JSON.stringify(attempt.body) });
            const d = await r.json();
            const content = d.choices?.[0]?.message?.content;
            if (!content) continue;
            let parsed = null;
            try { parsed = JSON.parse(content); } catch (e) { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} } }
            if (parsed) {
                const valid = validateAIResult(parsed, best, price, allowedTFs);
                if (valid) { valid.trade_signal_Theghostmachine.model_used = attempt.model; return valid; }
            }
        } catch (e) { console.error(`AI fetch (${attempt.model}):`, e); } finally { clearTimeout(timer); }
    }
    return null;
}

// FIX #9: helper — write JSON via textContent (safe, and copy works correctly)
function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    if (el) el.textContent = JSON.stringify(obj, null, 2);
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

        if (results.length === 0) { showNotif('🎯 No high-probability zones right now - patience, wait for price to build one', 'warning'); setJsonOutput({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_HIGH_PROBABILITY_SETUP',note:'Only A/B-quality zones with 2+ confluences that price is likely to reach are given. Nothing qualified this scan - rescan later rather than forcing a weak zone.',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; }
        for (let result of results) {
            try { result.qualityScore = calculateSetupQuality(result, price); }
            catch(e) { console.error('Error calculating quality score:', e); result.qualityScore = 0; }
            result.confidenceAtScan = result.confidence; // snapshot before HTF/AI adjustments mutate the winner
        }
        const higherTimeframes = ['1D', '4H', '1H'], lowerTimeframes = ['15M', '5M'];
        const higherResults = results.filter(r => higherTimeframes.includes(r.timeframe)), lowerResults = results.filter(r => lowerTimeframes.includes(r.timeframe));
        let best = null, isLowerTF = false;
        // FIX #24: explicit tiebreaker (confidence) so equal quality never falls
        // back to scan order - that fallback was the 1D monopoly.
        // FIX #26: confidence is the fully-checked verdict - the setup the bot believes
        // in most wins, whatever its timeframe. Quality only breaks ties.
        if (higherResults.length > 0) { higherResults.sort((a, b) => (b.confidence - a.confidence) || (b.qualityScore - a.qualityScore)); best = higherResults[0]; isLowerTF = false; showNotif(`✅ ${best.timeframe} setup found - Quality: ${best.qualityScore}`, 'success'); }
        else if (lowerResults.length > 0) { const filteredLower = lowerResults.filter(r => r.qualityScore > 40); if (filteredLower.length > 0) { filteredLower.sort((a, b) => (b.confidence - a.confidence) || (b.qualityScore - a.qualityScore)); best = filteredLower[0]; isLowerTF = true; best.confidence = Math.max(best.confidence - 30, 20); best.confBreakdown?.push({ adj: -30, reason: 'Lower timeframe setup only' }); showNotif(`⚠️ ONLY LOWER TF SETUP (${best.timeframe}) - Quality: ${best.qualityScore}% - REDUCED CONFIDENCE`, 'warning'); } else { showNotif('⚠️ Lower timeframe setups found but quality too low (<40%)', 'warning'); setJsonOutput({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'LOW_QUALITY_SETUPS_ONLY',message:'Only low quality lower timeframe setups found. Not tradable.',multi_timeframe_trends:mtfTrendsData,lower_setups_found:lowerResults.length,best_quality:Math.max(...lowerResults.map(r=>r.qualityScore))}}); analysis = null; document.getElementById('executeBtn').disabled = true; btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; } }
        else { showNotif('🎯 No high-probability zones right now - patience, wait for price to build one', 'warning'); setJsonOutput({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_HIGH_PROBABILITY_SETUP',note:'Only A/B-quality zones with 2+ confluences that price is likely to reach are given. Nothing qualified this scan - rescan later rather than forcing a weak zone.',multi_timeframe_trends:mtfTrendsData,timeframes_scanned:timeframesToScan.length}}); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; }
        scanText.innerHTML = '🤖 AI strict execution decision...'; const aiResult = await askAIWithAllResults(results.slice().sort((a,b)=>b.qualityScore-a.qualityScore), price, htfData); scanStatus.classList.add('hidden');
        // FIX #13: the AI may pick a different candidate setup, but only within the
        // same tier already chosen (never a lower-TF setup when higher-TF ones exist)
        const aiSelectedTF = aiResult?.trade_signal_Theghostmachine?.selected_timeframe;
        if (aiSelectedTF && aiSelectedTF !== best.timeframe) {
            const tier = isLowerTF ? lowerResults : higherResults;
            const candidate = tier.find(r => r.timeframe === aiSelectedTF);
            if (candidate) { best = candidate; showNotif(`🤖 AI selected ${aiSelectedTF} setup over ${higherResults.concat(lowerResults)[0]?.timeframe || ''}`, 'info'); }
        }
        const prec = getPrec(pair), risk = Math.abs(best.entry - best.sl), rr = best.rrUsed || 4, rrDisplay = (Math.abs(best.tp1 - best.entry) / risk).toFixed(1), st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
        const htfConfluence = await checkHTFConfluenceAsync(htfData['1D'], htfData['4H'], best.direction); best.confidence = Math.max(best.confidence - htfConfluence.penalty, 10); if (htfConfluence.penalty) best.confBreakdown?.push({ adj: -htfConfluence.penalty, reason: `HTF confluence ${htfConfluence.level} (1D=${htfConfluence.daily}, 4H=${htfConfluence.h4})` });
        let aiConviction = 'MEDIUM', aiApproved = true, aiConfAdj = 0, executionDecision = best.entryReady ? 'enter_now' : 'wait_for_reaction', waitCondition = 'Wait for engulf/pinbar at zone', aiInvalidation = best.invalidationPrice;
        let finalEntry = best.entry, finalZoneLow = best.zone.low, finalZoneHigh = best.zone.high, aiEntryLogic = '', aiSlLogic = '', aiKeyReason = '', aiRiskWarning = '', aiOutcomes = [];
        if (aiResult && aiResult.trade_signal_Theghostmachine) { const ts = aiResult.trade_signal_Theghostmachine; aiApproved = ts.approved !== false; aiConfAdj = ts.confidence_adjustment || 0; executionDecision = ts.execution_decision || executionDecision; waitCondition = ts.wait_condition || waitCondition; if (ts.invalidation_price) aiInvalidation = ts.invalidation_price; if (executionDecision === 'enter_now') aiConviction = 'HIGH'; else if (executionDecision === 'wait_for_reaction') aiConviction = 'WAIT'; else aiConviction = 'SKIP'; if (ts.entry_refinement && ts.entry_refinement.low && ts.entry_refinement.high) { finalZoneLow = ts.entry_refinement.low; finalZoneHigh = ts.entry_refinement.high; finalEntry = (finalZoneLow + finalZoneHigh) / 2; } aiEntryLogic = ts.analysis?.entry_logic || ''; aiSlLogic = ts.analysis?.sl_logic || ''; aiKeyReason = ts.analysis?.key_reason || ''; aiRiskWarning = ts.analysis?.risk_warning || ''; aiOutcomes = ts.analysis?.possible_outcomes || []; if (aiApproved) { best.confidence = Math.min(Math.max(best.confidence + aiConfAdj, 10), 98); if (aiConfAdj) best.confBreakdown?.push({ adj: aiConfAdj, reason: `AI (${ts.model_used || 'deepseek'}) adjustment: ${aiKeyReason || 'approved'}` }); }
            else {
                // FIX #20: deterministic guard - the AI repeatedly calls PARTIAL HTF
                // alignment a "conflict" and skips. Only true CONFLICT (both 1D and 4H
                // opposing) authorizes that skip, and the code knows the real level, so
                // a rejection whose stated reason is HTF conflict while the level is
                // PARTIAL gets downgraded to WAIT (-10) instead of a -25 kill.
                const rule1Note = (ts.rule_checks?.find(r => r.rule === 1)?.note || '') + ' ' + (aiKeyReason || '');
                const misreadPartial = htfConfluence.level === 'PARTIAL' && executionDecision === 'skip' && /conflict/i.test(rule1Note);
                if (misreadPartial) {
                    executionDecision = 'wait_for_reaction'; aiConviction = 'WAIT';
                    best.confidence = Math.max(best.confidence - 10, 10);
                    best.confBreakdown?.push({ adj: -10, reason: `🤖 AI wait (rejection downgraded: HTF is PARTIAL with ${htfConfluence.alignedTF || '1D'} aligned, not CONFLICT)` });
                } else if (executionDecision === 'wait_for_reaction') {
                    // FIX #25: "wait for the zone reaction" is patience, not rejection -
                    // it should not cost as much as a hard skip.
                    aiConviction = 'WAIT';
                    best.confidence = Math.max(best.confidence - 12, 10);
                    best.confBreakdown?.push({ adj: -12, reason: `\ud83e\udd16 AI prefers waiting: ${aiKeyReason || 'wait for zone reaction'}` });
                } else {
                    best.confidence = Math.max(best.confidence - 25, 5);
                    best.confBreakdown?.push({ adj: -25, reason: `\ud83e\udd16 AI REJECTED: ${aiKeyReason || aiRiskWarning || 'setup failed audit'}` });
                }
            } }
        const session = getSession();

        // FIX #27: a signal below the bar is analysis, not a trade. The JSON still
        // shows everything, but it is flagged NO_TRADE and the execute button stays
        // locked - a 5% "signal" must never look tradeable.
        const tradeable = best.confidence >= 45 && executionDecision !== 'skip';
        const noTradeReason = tradeable ? null : (executionDecision === 'skip' ? `AI execution decision: skip (confidence ${best.confidence}%)` : `Final confidence ${best.confidence}% below the 45% minimum`);

        // FIX #28 (FINAL - plan frozen after this): the five golden rules checklist.
        // A+ = all five pass (full size). A = tradeable but not all five (half size).
        // Below the trade bar = NO-TRADE. A label over existing checks, no new logic.
        const goldenRules = [
            { rule: '1. Bias alignment (1D AND 4H agree with direction)', passed: htfConfluence.level === 'FULL' },
            { rule: '2. High-probability POI (A-grade zone)', passed: best.zone.quality === 'A' },
            { rule: '3. Liquidity sweep + market structure shift', passed: !!best.sniperEntry?.isSniper },
            { rule: '4. Killzone timing', passed: !!best.session?.isKillzone },
            { rule: '5. Asymmetric risk:reward (>= 1:2)', passed: (best.rrUsed || 0) >= 2 }
        ];
        const goldenPassed = goldenRules.filter(r => r.passed).length;
        const setupGrade = !tradeable ? 'NO-TRADE' : (goldenPassed === 5 ? 'A+' : 'A');
        const suggestedRisk = setupGrade === 'A+' ? '1% (full size - all 5 golden rules pass)' : (setupGrade === 'A' ? '0.5% (half size)' : '0% (do not trade)');

        // FIX #7 (duplicate key): the old object had crt_analysis twice inside trade_signal —
        // JS silently dropped the first. Only the detailed one is kept now.
        const out = { auto_scan_result: { date: new Date().toISOString().split('T')[0], time: new Date().toISOString().split('T')[1].split('.')[0], pair, current_price: price, multi_timeframe_trends: mtfTrendsData, best_timeframe: best.timeframe, quality_score: best.qualityScore, status: tradeable ? 'TRADEABLE' : 'NO_TRADE', no_trade_reason: noTradeReason, setup_grade: setupGrade, golden_rules: { passed: goldenPassed, of: 5, checklist: goldenRules }, suggested_risk: suggestedRisk, total_setups_found: results.length, higher_timeframe_setups_found: higherResults.length, lower_timeframe_setups_available: lowerResults.length, is_lower_timeframe_signal: isLowerTF, signal_quality: isLowerTF ? 'LOWER_TF_ONLY_REDUCED_CONFIDENCE' : 'HIGHER_TF_TRADABLE', session: session.session, session_emoji: session.emoji, session_multiplier: session.multiplier, premium_discount: best.premiumDiscount, zone_freshness: best.freshness, breaker_validated: best.breakerValid, ai_verified: !!aiResult, ai_approved: aiApproved, ai_model: aiResult?.trade_signal_Theghostmachine?.model_used || null, ai_rule_checks: aiResult?.trade_signal_Theghostmachine?.rule_checks || null, ai_selected_timeframe: aiSelectedTF || null, execution_decision: executionDecision, wait_condition: waitCondition || null, htf_confluence: htfConfluence, scoreboard_note: 'ONE setup is given: trade_signal below. setups_scoreboard is audit-only - how each timeframe scored and why the winner won.', setups_scoreboard: results.map(r => ({ timeframe: r.timeframe, quality: r.qualityScore, confidence: r.confidenceAtScan ?? r.confidence, direction: r.direction, zone: `${r.zone.src} ${r.zone.confluence} [Q:${r.zone.quality}]`, entry: r.entry, chosen: r === best })), trade_signal: { trade_type: best.direction === 'BUY' ? 'BUY-LIMIT' : 'SELL-LIMIT', entry_price: finalEntry, entry_zone: { low: finalZoneLow, high: finalZoneHigh }, distance_to_entry: { pct: (best.entryDistancePct ?? 0).toFixed(2) + '%', atr_multiple: (best.entryDistanceATR ?? 0).toFixed(1) + 'x ATR', note: 'price must travel this far to trigger the limit order' }, zones_evaluated: best.zonesEvaluated || 1, alternative_zones: best.alternativeZones || [], entry_ready: best.entryReady, zone_touches: best.zoneTouches, htf_validated: best.htfValidation ? best.htfValidation.passed : null, htf_parent_structure: best.htfValidation?.parentArray ? `${best.htfValidation.parentArray.src} @ ${best.htfValidation.parentArray.structureTF}` : null, stop_loss: best.sl, sl_reason: best.slResult.reason, invalidation_price: aiInvalidation, risk_amount: risk.toFixed(prec), stop_loss_pct: ((risk / best.entry) * 100).toFixed(2) + '%', take_profit_1: best.tp1, take_profit_2: best.tp2, take_profit_3: best.tp3, risk_reward: '1:' + rrDisplay, dynamic_rr: '1:' + rr, confidence: best.confidence, confidence_breakdown: (best.confBreakdown || []).map(b => `${b.adj > 0 ? '+' : ''}${b.adj} ${b.reason}`), conviction: aiConviction, entry_source: aiResult ? 'AI-Refined' : 'Rule-Based', ai_used: !!aiResult, ai_risk_warning: aiRiskWarning || null, entry_reasoning: aiEntryLogic || `${best.zone.src} zone with ${best.zone.confluence}`, sl_reasoning: aiSlLogic || best.slResult.reason, key_reason: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}]`, possible_outcomes: aiOutcomes.length > 0 ? aiOutcomes : [`Enter at zone after reaction`, `Sweep then reverse`, `SL hit invalidates`], zone_quality: best.zone.quality, zone_source: best.zone.src, zone_confluence: best.zone.confluence, confluence_count: best.zone.cc, imbalance_magnet: best.zone.hasImbalance, zone_reaction: best.zoneReaction, zone_magnetism: { strength: best.magnetism.magnetism, score: best.magnetism.score, summary: best.magnetism.summary, checks: best.magnetism.checks }, path_clearance: { clear: best.pathCheck.clear, obstacles: best.pathCheck.obstacles }, probability: best.probCheck.probability, sniper_entry: { is_sniper: best.sniperEntry.isSniper, path: best.sniperEntry.path || null, score: best.sniperEntry.score, grade: best.sniperEntry.grade, checks: best.sniperEntry.checks }, timeframe_alignment: { trend_tf: best.trendTF, structure_tf: best.structureTF, entry_tf: best.entryTF, sniper_tf: best.sniperTF, alignment: best.tfAlign, trend_direction: best.mtf.direction, trend_strength: best.mtf.strength + '/5 TFs', sniper_confirmation: best.sniperRej.confirmed ? '✅ Confirmed' : '⚠️ No rejection', htf_confluence: htfConfluence }, turtle_soup: best.turtleSoup, order_blocks_found: best.obsAll ? best.obsAll.length : 0, twelve_data_indicators: best.twelveIndicators, volume_profile: best.volumeProfile ? { poc: best.volumeProfile.poc.toFixed(prec), value_area_high: best.volumeProfile.vah.toFixed(prec), value_area_low: best.volumeProfile.val.toFixed(prec), hvn_count: best.volumeProfile.hvns.length, lvn_count: best.volumeProfile.lvns.length, zone_in_lvn: best.volumeProfile.lvns.some(p => p >= best.zone.low && p <= best.zone.high), note: 'time-at-price profile when feed lacks real volume' } : null, delta_proxy: { cvd: best.deltaProxy?.cvd || 0, direction: best.deltaProxy?.direction || 'NEUTRAL', note: 'candle-based approximation, not true order flow' }, msnr_levels: { pivot: best.msnr.pivot.toFixed(prec), supports: { S1: best.msnr.supports.S1?.toFixed(prec), S2: best.msnr.supports.S2?.toFixed(prec), S3: best.msnr.supports.S3?.toFixed(prec) }, resistances: { R1: best.msnr.resistances.R1?.toFixed(prec), R2: best.msnr.resistances.R2?.toFixed(prec), R3: best.msnr.resistances.R3?.toFixed(prec) } }, sweeps: best.sweeps.filter(s => s.distance < best.apiATR * 2).map(s => ({ type: s.type, level: s.level, distance: s.distance })), analysis: { trend_detection: `${best.mtf.direction} (${best.mtf.strength}/5 TFs)${best.mtf.strength >= 3 ? ' - STRONG' : ''}`, volatility_level: `${best.volatility.level} - ${best.volatility.desc}`, market_structure: { mss: best.mss ? best.mss.type : 'None', displacement: best.displacement.detected, sniper_rejection: best.sniperRej.confirmed, turtle_soup: best.turtleSoup.detected, crt_pattern: best.crt.pattern, zone_reaction: best.zoneReaction, zone_touches: best.zoneTouches, entry_ready: best.entryReady, htf_validated: best.htfValidation?.passed || false, imbalance_magnet: best.zone.hasImbalance, zone_magnetism: best.magnetism.magnetism, htf_confluence: htfConfluence.level, zone_freshness: best.freshness, premium_discount: best.premiumDiscount, session: best.session, breaker_validated: best.breakerValid }, indicator_confluence: { macd: best.twelveIndicators.macd ? `${best.twelveIndicators.macd > best.twelveIndicators.macd_signal ? 'Bullish' : 'Bearish'}` : 'N/A', adx: best.twelveIndicators.adx ? `${best.twelveIndicators.adx > 25 ? 'Trending' : 'Ranging'} (RR:1:${rr})` : 'N/A', stochastic: best.twelveIndicators.stoch_k ? `K:${best.twelveIndicators.stoch_k} D:${best.twelveIndicators.stoch_d}` : 'N/A', cci: best.twelveIndicators.cci || 'N/A', williams_r: best.twelveIndicators.williams_r || 'N/A', sar: best.twelveIndicators.sar ? `${best.twelveIndicators.sar}` : 'N/A', ichimoku: best.twelveIndicators.ichimoku_tenkan ? `TK:${best.twelveIndicators.ichimoku_tenkan}/${best.twelveIndicators.ichimoku_kijun}` : 'N/A' }, technical_indicators: [`RSI: ${best.twelveIndicators.rsi || best.rs.toFixed(1)}`, `MACD: ${best.twelveIndicators.macd || 'N/A'}`, `ADX: ${best.twelveIndicators.adx || 'N/A'}`, `ATR(API): ${best.twelveIndicators.atr_api?.toFixed(prec) || best.apiATR.toFixed(prec)}`, `BB: ${best.twelveIndicators.bb_upper || 'N/A'}/${best.twelveIndicators.bb_lower || 'N/A'}`, `FVG: ${best.fvgsAll.length} (${best.fvgsAll.filter(f => f.fresh).length} fresh)`, `OB: ${best.obsAll ? best.obsAll.length : 0}`], reasoning: aiKeyReason || `${best.zone.confluence} [Q:${best.zone.quality}] | HTF:${best.htfValidation?.passed ? 'YES' : 'NO'} | Magnet:${best.magnetism.magnetism} | Confluence:${htfConfluence.level} | EntryReady:${best.entryReady ? 'YES' : 'NO'} | React:${best.zoneReaction?.type || 'None'} | Touch#${best.zoneTouches} | ${best.session?.emoji || ''}${best.session?.session || ''}` } ,
                crt_analysis: {
                    detected: best.crt?.detected || false,
                    pattern: best.crt?.pattern || 'Neutral',
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
                    "win_probability_note": "heuristic estimate, NOT backtested statistics",
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
                    "entry": finalEntry,
                    "stop_loss": best.tradeLevels?.stopLoss || best.sl,
                    "take_profit": best.tradeLevels?.takeProfit || best.tp1,
                    "partial_tp": best.tradeLevels?.partialTP || best.tp2,
                    "invalidation": best.tradeLevels?.invalidation || best.invalidationPrice,
                    "breakeven": finalEntry,
                    "pips_risk": best.tradeLevels?.pipsRisk || 0,
                    "pips_reward": best.tradeLevels?.pipsReward || 0,
                    "risk_reward": best.tradeLevels?.riskReward || best.rrUsed || 4
                }

} } };
        setJsonOutput(out);
        // no auto-save: the user decides what to keep via the Save button
        lastSetupSummary = buildSetupSummary(best, st, finalEntry, price);
        lastSetupOut = out;

        if (!tradeable) {
            analysis = null;
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 NO TRADE - ${noTradeReason}. Analysis shown for study only.`, 'warning');
            return;
        }
        analysis = { signalType: st, idealEntry: finalEntry, currentPrice: price, stopLoss: best.sl, takeProfit1: best.tp1, takeProfit2: best.tp2, takeProfit3: best.tp3, confidence: best.confidence, entryZoneLow: finalZoneLow, entryZoneHigh: finalZoneHigh, entryReady: best.entryReady, executionDecision, invalidationPrice: aiInvalidation };
        if (best && best.invalidationPrice && !isSetupStillValid(best, price)) {
            showNotif(`⚠️ Setup invalidated at current price: ${price}`, 'warning');
            document.getElementById('executeBtn').disabled = true;
            return;
        }
        document.getElementById('executeBtn').disabled = false;
        const magLabel = best.magnetism.magnetism === 'STRONG' ? '🧲' : (best.magnetism.magnetism === 'MODERATE' ? '🔗' : '⚠️'), aiLabel = aiResult ? (aiApproved ? '🤖✅' : '🤖❌') : '', htfLabel = htfConfluence.level === 'FULL' ? '💪' : (htfConfluence.level === 'CONFLICT' ? '⚠️' : ''), htfValLabel = best.htfValidation?.passed ? '🏗️' : '', execLabel = executionDecision === 'enter_now' ? '🟢ENTER' : (executionDecision === 'wait_for_reaction' ? '🟡WAIT' : '🔴SKIP'), tfWarning = isLowerTF ? '⚠️LOWER TF ONLY⚠️ ' : '✅HIGHER TF✅ ', sessionLabel = `${best.session?.emoji || ''}${best.session?.session || ''}`, freshnessLabel = best.freshness?.fresh ? '🆕' : (best.freshness?.partiallyUsed ? '📌' : '🔴'), amdLabel = best.amd.phase === 'MANIPULATION' ? '🎭' : '', sniperLabel = best.sniperEntry?.isSniper ? '🎯SNIPER' : '', gradeLabel = setupGrade === 'A+' ? `⭐A+ (${goldenPassed}/5) ` : `A (${goldenPassed}/5) `;
        showNotif(`${gradeLabel}${tfWarning}${sniperLabel}${aiLabel}${magLabel}${htfLabel}${htfValLabel}${freshnessLabel}${amdLabel} ${sessionLabel} ${execLabel} ${best.timeframe} ${st} ${best.confidence}% | Risk: ${setupGrade === 'A+' ? '1%' : '0.5%'} | 1:${rrDisplay}`, 'success');
    } catch (e) { console.error(e); showNotif('Error: ' + e.message, 'error'); scanStatus.classList.add('hidden'); }
    finally { btn.classList.remove('loading'); btn.disabled = false; }
}

// ============================================
// 💾 RECENT SAVED (manual save) + 📒 TRADE JOURNAL
// Flow: scan -> press Save -> setup lands in Recent Saved (persisted, so it
// survives closing the app). When the trade plays out, mark it Win or Loss
// on the saved card, then press Journal to move the whole entry into the
// permanent journal. Both lists support delete.
// ============================================
let lastSetupSummary = null, lastSetupOut = null;

function buildSetupSummary(best, st, finalEntry, price) {
    return {
        id: Date.now(),
        pair, timeframe: best.timeframe, direction: st,
        entry: finalEntry, sl: best.sl, tp1: best.tp1,
        confidence: best.confidence, quality: best.zone?.quality || '?',
        sniper: !!best.sniperEntry?.isSniper, priceAtScan: price
    };
}

const RECENT_KEY = 'ict_recent_saved', RECENT_CAP = 10;
const JOURNAL_KEY = 'ict_journal', JOURNAL_CAP = 30;
function getRecents() { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
function setRecents(r) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, RECENT_CAP))); } catch (e) {} }
function getJournal() { try { const j = JSON.parse(localStorage.getItem(JOURNAL_KEY)); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
function setJournal(j) { try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j.slice(0, JOURNAL_CAP))); } catch (e) {} }

function saveCurrentSetup() {
    if (!lastSetupSummary) { showNotif('⚠️ No setup to save - run a scan first', 'warning'); return; }
    const recents = getRecents();
    if (recents.some(e => e.id === lastSetupSummary.id)) { showNotif('💾 Already saved', 'info'); return; }
    recents.unshift({ ...lastSetupSummary, out: lastSetupOut, savedAt: new Date().toISOString(), outcome: null });
    setRecents(recents);
    renderRecents();
    showNotif('💾 Saved to Recent', 'success');
}
function markRecentOutcome(id, outcome) {
    const r = getRecents(); const e = r.find(x => x.id === id);
    if (e) { e.outcome = e.outcome === outcome ? null : outcome; setRecents(r); renderRecents(); }
}
function journalRecent(id) {
    const r = getRecents(); const e = r.find(x => x.id === id);
    if (!e) return;
    if (!e.outcome) { showNotif('⚠️ Mark ✅ Win or ❌ Loss first, then journal it', 'warning'); return; }
    const { out, outcome, ...rest } = e;
    const journal = getJournal();
    journal.unshift({ ...rest, status: outcome, journaledAt: new Date().toISOString() });
    setJournal(journal);
    setRecents(r.filter(x => x.id !== id));
    renderRecents(); renderJournal();
    showNotif(`📒 Journaled as ${outcome}`, 'success');
}
function deleteRecent(id) { setRecents(getRecents().filter(x => x.id !== id)); renderRecents(); showNotif('🗑️ Saved setup deleted', 'warning'); }
function viewRecent(id) { const e = getRecents().find(x => x.id === id); if (e?.out) { setJsonOutput(e.out); showNotif('📋 Loaded into Best Setup view - rescan before trading', 'info'); } }
function deleteJournalEntry(id) { setJournal(getJournal().filter(x => x.id !== id)); renderJournal(); showNotif('🗑️ Journal entry deleted', 'warning'); }

function setupCardHTML(e, when, badge, actions) {
    const prec = getPrec(e.pair || 'XAU/USD');
    return `<div class="journal-entry ${badge.cls}">
        <div class="journal-head"><span>${e.sniper ? '🎯 ' : ''}${e.pair} ${e.direction} ${e.timeframe} Q:${e.quality} ${e.confidence}%</span><span>${badge.label}</span></div>
        <div class="journal-levels">E $${(+e.entry).toFixed(prec)} | SL $${(+e.sl).toFixed(prec)} | TP $${(+e.tp1).toFixed(prec)} | ${when}</div>
        <div class="journal-actions">${actions}</div>
    </div>`;
}
function renderRecents() {
    const list = document.getElementById('recentList');
    if (!list) return;
    const recents = getRecents();
    if (recents.length === 0) { list.innerHTML = '<span class="journal-empty">No saved setups — hit 💾 Save after a scan to keep one here</span>'; return; }
    list.innerHTML = recents.map(e => {
        const when = e.savedAt ? new Date(e.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.outcome === 'WIN' ? { label: '✅ WIN', cls: 'win' } : (e.outcome === 'LOSS' ? { label: '❌ LOSS', cls: 'loss' } : { label: '💾 SAVED', cls: 'pending' });
        const actions = `<button class="jw-win" data-action="win" data-id="${e.id}">✅ Win</button>` +
            `<button class="jw-loss" data-action="loss" data-id="${e.id}">❌ Loss</button>` +
            `<button class="jw-journal" data-action="journal" data-id="${e.id}">📒 Journal</button>` +
            `<button class="jw-del" data-action="view" data-id="${e.id}">📋 View</button>` +
            `<button class="jw-del" data-action="del" data-id="${e.id}">🗑️</button>`;
        return setupCardHTML(e, when, badge, actions);
    }).join('');
}
function renderJournal() {
    const list = document.getElementById('journalList'), stats = document.getElementById('journalStats');
    if (!list) return;
    const journal = getJournal();
    if (stats) {
        const w = journal.filter(e => e.status === 'WIN').length, l = journal.filter(e => e.status === 'LOSS').length;
        const wr = (w + l) > 0 ? ` | ${(100 * w / (w + l)).toFixed(0)}% WR` : '';
        stats.innerHTML = journal.length ? `✅${w} ❌${l}${wr}` : '';
    }
    if (journal.length === 0) { list.innerHTML = '<span class="journal-empty">Journal is empty — mark a saved setup Win/Loss, then press 📒 Journal</span>'; return; }
    list.innerHTML = journal.map(e => {
        const when = e.journaledAt ? new Date(e.journaledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const badge = e.status === 'WIN' ? { label: '✅ WIN', cls: 'win' } : { label: '❌ LOSS', cls: 'loss' };
        return setupCardHTML(e, when, badge, `<button class="jw-del" data-action="del" data-id="${e.id}">🗑️</button>`);
    }).join('');
}
function handleRecentClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = +btn.dataset.id, action = btn.dataset.action;
    if (action === 'win') markRecentOutcome(id, 'WIN');
    else if (action === 'loss') markRecentOutcome(id, 'LOSS');
    else if (action === 'journal') journalRecent(id);
    else if (action === 'view') viewRecent(id);
    else if (action === 'del') deleteRecent(id);
}
function handleJournalClick(ev) {
    const btn = ev.target.closest('button[data-action]');
    if (btn && btn.dataset.action === 'del') deleteJournalEntry(+btn.dataset.id);
}

// ============================================
// FIX #21: MISSED-FILL DETECTION
// The live monitor only runs while the app is open - price can travel into the
// zone and back out while the app is closed (or spike between 5s price polls)
// and the trigger was silently lost. Candle highs/lows since the order was
// created can't miss a spike, so the fill check replays them on every app
// open and every ~2.5 minutes while running.
// ============================================
function parseCandleTimeUTC(t) {
    if (typeof t !== 'string') return NaN;
    // Twelve Data forex/metals candles are UTC but come without a timezone
    // marker - normalize so they don't get parsed as device-local time.
    const iso = t.includes('T') ? t : t.replace(' ', 'T');
    return new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
}
function orderCrossedInCandles(order, candles) {
    if (!order?.idealEntry || !candles?.length) return false;
    const created = new Date(order.createdAt).getTime();
    if (isNaN(created)) return false;
    return candles.some(c => {
        const t = parseCandleTimeUTC(c.t);
        // 5-minute slack: the candle containing the creation moment still counts
        if (isNaN(t) || t < created - 5 * 60 * 1000) return false;
        return order.signalType === 'LONG' ? c.l <= order.idealEntry : c.h >= order.idealEntry;
    });
}
// Per user request the fill check NEVER auto-clears the order - it only
// informs. The order stays active until it live-triggers or is cancelled
// manually.
async function checkMissedFill() {
    if (!limitOrder) return;
    try {
        const candles = await getHistory('5M', limitOrder.pair || pair);
        if (candles && orderCrossedInCandles(limitOrder, candles)) {
            const prec = getPrec(limitOrder.pair || pair);
            showNotif(`ℹ️ ${limitOrder.pair || ''} ${limitOrder.signalType} level $${limitOrder.idealEntry.toFixed(prec)} traded while you were away - order still active, review manually`, 'info');
        }
    } catch (e) { console.error('Missed-fill check:', e); }
}

function loadLimitOrder(){const s=localStorage.getItem('limitOrder');if(s){try{limitOrder=JSON.parse(s);updateLimitUI();startMonitor();checkMissedFill();}catch(e){}}}
function saveLimit(o){limitOrder=o;localStorage.setItem('limitOrder',JSON.stringify(o));updateLimitUI();}
function clearLimit(){limitOrder=null;localStorage.removeItem('limitOrder');if(priceTimer)clearInterval(priceTimer);updateLimitUI();}
function cancelLimit(){clearLimit();showNotif('❌ Cancelled','warning');}
// FIX #3: limit UI + monitor now use the ORDER's pair, not whatever pair is currently selected
function updateLimitUI(){const t=document.getElementById('limitOrderText'),c=document.getElementById('cancelLimitBtn');if(limitOrder){const prec=getPrec(limitOrder.pair||pair);t.innerHTML=`⏳ ${limitOrder.pair||''} ${limitOrder.signalType} LIMIT @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}`;t.className='active';c.classList.remove('hidden');document.getElementById('executeBtn').innerHTML='⏳ Waiting...';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)';}else{t.innerHTML='No active limit order';t.className='';c.classList.add('hidden');document.getElementById('executeBtn').innerHTML='⚡ Place Limit Order';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)';}}
function startMonitor(){if(priceTimer)clearInterval(priceTimer);priceTimer=setInterval(async()=>{if(!limitOrder){clearInterval(priceTimer);return;}
    const orderPair=limitOrder.pair||pair;const p=await getPrice(orderPair);if(!p)return;const prec=getPrec(orderPair);if(orderPair===pair)document.getElementById('currentPrice').innerHTML=`$${p.toFixed(prec)}`;if((limitOrder.signalType==='LONG' && p<=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT' && p>=limitOrder.idealEntry)){const filled=limitOrder;clearLimit();showNotif(`✅ FILLED! ${filled.pair||''} ${filled.signalType} @ $${p.toFixed(prec)}`,'success');try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){}}},2000);}
function handleLimit(){if(!analysis||analysis.signalType==='NEUTRAL'){showNotif('No signal','error');return;}if(limitOrder){cancelLimit();return;}const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry,stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,entryZoneLow:analysis.entryZoneLow,entryZoneHigh:analysis.entryZoneHigh,entryReady:analysis.entryReady,executionDecision:analysis.executionDecision,invalidationPrice:analysis.invalidationPrice,createdAt:new Date().toISOString()};saveLimit(o);startMonitor();showNotif(`📝 Limit @ $${o.idealEntry.toFixed(getPrec(pair))}`,'info');}
// FIX #9: copy uses textContent (was innerHTML — copied HTML-escaped text), and the
// empty-check actually works now (old check looked for 'Click' which never matched '{}')
function copyJson(){const el=document.getElementById('jsonOutput');const t=el?el.textContent:'';if(!t||t.trim()==='{}'){showNotif('Run analysis first','warning');return;}navigator.clipboard.writeText(t).then(()=>showNotif('📋 Copied!','success')).catch(()=>showNotif('Failed','error'));}
function showNotif(m,t){const n=document.getElementById('notification');n.innerHTML=m;n.className=`notification ${t}`;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3000);}

// ===== FUNCTION 5: ENTRY TIMING =====
function checkEntryTiming(data, entryPrice, direction) {
    if (!data || data.length === 0) return { valid: false, reason: 'No data' };
    const last = data[data.length - 1];
    const threshold = entryPrice * 0.001;
    let valid = false;
    if (direction === 'BUY') {
        valid = Math.abs(last.c - entryPrice) <= threshold || last.c <= entryPrice;
    } else {
        valid = Math.abs(last.c - entryPrice) <= threshold || last.c >= entryPrice;
    }
    return { valid: valid, reason: valid ? 'Price near entry' : 'Waiting for optimal price' };
}

function isSetupStillValid(setup, currentPrice) {
    if (!setup || !setup.direction) return true;
    if (!setup.invalidationPrice) return true;
    if (setup.direction === 'BUY') {
        if (currentPrice < setup.invalidationPrice * 0.995) return false;
    } else {
        if (currentPrice > setup.invalidationPrice * 1.005) return false;
    }
    return true;
}

// ===== SETUP QUALITY SCORING (1-10) =====
function calculateSetupScore(direction, context) {
    let score = 0;
    if ((direction === 'BUY' && context.htfTrendBias === 'BULLISH') ||
        (direction === 'SELL' && context.htfTrendBias === 'BEARISH')) score += 1;
    if ((direction === 'BUY' && context.htfZoneType === 'DISCOUNT') ||
        (direction === 'SELL' && context.htfZoneType === 'PREMIUM')) score += 1;
    if (context.htfBosConfirmed) score += 1;
    if (!context.htfChochDetected) score += 1;
    if (context.validOrderBlocks && context.validOrderBlocks.length > 0) score += 1;
    if (context.liquiditySweeps && context.liquiditySweeps.length > 0) score += 1;
    if (context.validFvgs && context.validFvgs.length > 0) score += 1;
    if (context.ltfPullbackIntoZone) score += 1;
    if (context.ltfDisplacementCandle) score += 1;
    if (context.sessionValid) score += 1;
    const sessionData = getSession();
    if (sessionData.isMacro) score += 3;
    if (context.inducementSwept) score += 3;
    if (context.ltfDisplacementCandle && context.ltfPullbackIntoZone) score += 2;
    return score;
}

// ===== SIGNAL GRADE =====
function getSignalGrade(confidence) {
    if (confidence >= 90) return 'A';
    if (confidence >= 85) return 'B';
    if (confidence >= 80) return 'C';
    return 'D';
}

// ===== WIN PROBABILITY (heuristic — not backtested statistics) =====
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

// ===== EXPECTED VALUE =====
function calculateExpectedValue(winProbability, rrRatio) {
    const winRate = winProbability / 100.0;
    const lossRate = 1.0 - winRate;
    return (winRate * rrRatio) - (lossRate * 1.0);
}

// ===== MARKET CONTEXT BUILDER =====
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

// ===== SESSION VALIDATION =====
function validateTradingSession() {
    const hour = new Date().getUTCHours();
    return (hour >= 8 && hour <= 22);
}

// ===== FIND NEXT HTF RESISTANCE =====
function findNextHTFResistance(price, resistanceLevels) {
    if (!resistanceLevels || resistanceLevels.length === 0) return null;
    const above = resistanceLevels.filter(l => l.price > price);
    if (above.length === 0) return null;
    return Math.min(...above.map(l => l.price));
}

// ===== FIND NEXT HTF SUPPORT =====
function findNextHTFSupport(price, supportLevels) {
    if (!supportLevels || supportLevels.length === 0) return null;
    const below = supportLevels.filter(l => l.price < price);
    if (below.length === 0) return null;
    return Math.max(...below.map(l => l.price));
}

// ===== POSITION SIZE CALCULATOR =====
function calculatePositionSize(pipsRisk, accountBalance, riskPercent) {
    if (pipsRisk === 0) return 0.01;
    const riskAmount = accountBalance * (riskPercent / 100.0);
    const pipValue = 10.0;
    const lotSize = riskAmount / (pipsRisk * pipValue);
    return Math.round(Math.max(Math.min(lotSize, 10.0), 0.01) * 100) / 100;
}

// ===== CHECK CHoCH (Change of Character) =====
function checkCHoCH(data, zoneLow, zoneHigh) {
    if (data.length < 5) return false;
    if (!zoneLow || !zoneHigh) {
        const last = data[data.length - 1];
        const prev = data[data.length - 2];
        if (prev.c < prev.o && last.c > last.o && last.c > prev.h) return true;
        if (prev.c > prev.o && last.c < last.o && last.c < prev.l) return true;
        return false;
    }
    const last5 = data.slice(-5);
    const zoneTapped = last5.some(c => (c.l <= zoneHigh && c.h >= zoneLow));
    if (!zoneTapped) return false;
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    if (prev.c < prev.o && last.c > last.o && last.c > prev.h) return true;
    if (prev.c > prev.o && last.c < last.o && last.c < prev.l) return true;
    return false;
}

// ===== THE TRADING GEEK: INDUCEMENT FILTER =====
function detectInducement(data, zoneLow, zoneHigh, direction) {
    if (!data || data.length < 15) return true;
    const swings = findSwings(data, 2);
    if (direction === 'BUY') {
        const recentLows = swings.L.filter(s => s.p >= zoneLow * 0.999 && s.p <= zoneHigh * 1.015);
        if (recentLows.length === 0) return true;
        const lastCandles = data.slice(-5);
        const lowestRecent = Math.min(...lastCandles.map(c => c.l));
        return recentLows.some(s => lowestRecent <= s.p + (s.p * 0.0005));
    } else {
        const recentHighs = swings.H.filter(s => s.p <= zoneHigh * 1.001 && s.p >= zoneLow * 0.985);
        if (recentHighs.length === 0) return true;
        const lastCandles = data.slice(-5);
        const highestRecent = Math.max(...lastCandles.map(c => c.h));
        return recentHighs.some(s => highestRecent >= s.p - (s.p * 0.0005));
    }
}
