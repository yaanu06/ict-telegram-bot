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
const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_PRECISION = 5;
const BUY_INVALIDATION_FACTOR = 0.998;
const SELL_INVALIDATION_FACTOR = 1.002;
const MIN_ENTRY_DISTANCE_ATR_MULTIPLIER = 0.1;
const MAX_ENTRY_DISTANCE_ATR_MULTIPLIER = 5.0;
const MAX_ZONE_CANDIDATES_TO_EVALUATE = 6;
const MAX_ALLOWED_ZONE_VIOLATIONS = 1;
const GHOST_MACHINE_CONFLICT_CONFIDENCE_FLOOR = 75;
const ANALYSIS_DEBUG_LOGS = true;
const ENABLE_MAGNETISM_REJECTION = false;

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
let cachedPrice = null, priceCacheTime = 0, cachedPricePair = null;
const PRICE_CACHE_DURATION = 5000;

function resetPairState() {
    cachedPrice = null; priceCacheTime = 0; cachedPricePair = null; lastPrice = null;
    analysis = null;
    const eb = document.getElementById('executeBtn'); if (eb && !limitOrder) eb.disabled = true;
    const cp = document.getElementById('currentPrice'); if (cp) cp.innerHTML = '––';
    const pc = document.getElementById('priceChange'); if (pc) { pc.innerHTML = '–'; pc.className = 'price-change'; }
}

// ============================================
// FIXED INITIALIZATION - THIS IS THE ONLY CHANGE
// ============================================
// The old line was: 
// document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY)setTimeout(showSetup,500);init();});
//
// Now we separate the async part and call init AFTER DOM is ready
async function bootApp() {
    await loadKeys();
    updateKeyStatus();
    if (!TWELVE_DATA_KEY) setTimeout(showSetup, 500);
    // init is called after DOM is ready
}

// Wait for DOM to be fully loaded before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        bootApp();
        init();
    });
} else {
    // DOM already loaded
    bootApp();
    init();
}

function init() {
    console.log('📋 Initializing event listeners...');
    updateTime(); 
    setInterval(updateTime, 1000);
    
    const el = (id) => document.getElementById(id);
    if(el('analyzeBtn')) el('analyzeBtn').addEventListener('click', runAutoScan);
    if(el('executeBtn')) el('executeBtn').addEventListener('click', handleLimit);
    if(el('cancelLimitBtn')) el('cancelLimitBtn').addEventListener('click', cancelLimit);
    if(el('copyJsonBtn')) el('copyJsonBtn').addEventListener('click', copyJson);
    if(el('updateKeysBtn')) el('updateKeysBtn').addEventListener('click', showSetup);
    if(el('saveSetupBtn')) el('saveSetupBtn').addEventListener('click', saveCurrentSetup);
    if(el('recentList')) el('recentList').addEventListener('click', handleRecentClick);
    if(el('journalList')) el('journalList').addEventListener('click', handleJournalClick);
    renderRecents();
    renderJournal();
    if(el('pairSelect')) el('pairSelect').addEventListener('change', function(e) {
        pair = e.target.value;
        resetPairState();
    });
    document.querySelectorAll('.category-btn').forEach(function(b) {
        b.addEventListener('click', function() {
            document.querySelectorAll('.category-btn').forEach(function(x) {
                x.classList.remove('active');
            });
            this.classList.add('active');
            updatePairs(this.dataset.category);
        });
    });
    const activeBtn = document.querySelector('.category-btn.active');
    if(activeBtn) updatePairs(activeBtn.dataset.category);
    loadLimitOrder();
    console.log('✅ All event listeners attached successfully!');
}

function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML= `${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];resetPairState();}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF', 'NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

// ============================================
// API FUNCTIONS
// ============================================
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

async function getLiveCandleDirection(tfStr, cachedData = null) {
    try {
        const data = cachedData || await getHistory(tfStr);
        if (!data || data.length < 2) return 'NEUTRAL';
        const currentCandle = data[data.length - 1];
        const currentPrice = await getPrice();
        if (!currentPrice) return 'NEUTRAL';
        if (currentPrice > currentCandle.o) return 'BULLISH';
        if (currentPrice < currentCandle.o) return 'BEARISH';
        return 'NEUTRAL';
    } catch(e) { return 'NEUTRAL'; }
}

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
// TECHNICALS MATH (ALL FUNCTIONS - KEPT EXACTLY AS THEY WERE)
// ============================================
const ema=(p,n)=>{const m=2/(n+1);let e=[],sum=0;for(let i=0;i<p.length;i++){if(i<n){sum+=p[i];e.push(sum/(i+1));}else e.push((p[i]-e[i-1])*m+e[i-1]);}return e;};
const rsi=(p,n=14)=>{if(p.length<n+1)return 50;let g=0,l=0;for(let i=1;i<=n;i++){const c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;for(let i=n+1;i<p.length;i++){const c=p[i]-p[i-1];ag=(ag*(n-1)+(c>0?c:0))/n;al=(al*(n-1)+(c<0?-c:0))/n;}return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};
function detectFVG(d){let f=[],active=[];const len=d.length;for(let i=1;i<len-1;i++){const next=d[i+1];if(active.length>0){let keep=0;for(let k=0;k<active.length;k++){let g=active[k];if(g.type==='bull'){if(next.c<g.l)g.fresh=false;else active[keep++]=g;}else{if(next.c>g.h)g.fresh=false;else active[keep++]=g;}}active.length=keep;}const prev=d[i-1];const thresh=next.c*0.0005;if(prev.h<next.l && next.l-prev.h>thresh){let g={type:'bull',l:prev.h,h:next.l,m:(prev.h+next.l)/2,fresh:true};f.push(g);active.push(g);}if(prev.l>next.h && prev.l-next.h>thresh){let g={type:'bear',l:next.h,h:prev.l,m:(next.h+prev.l)/2,fresh:true};f.push(g);active.push(g);}}return f;}
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
function checkZoneMagnetism(entryData, price, entry, direction, zone = null) {
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
    if (zone) {
        const zoneConfluence = typeof zone.confluence === 'string' ? zone.confluence : '';
        const isPrimaryMethodZone = zone.src === 'MSNR' || zoneConfluence.includes('MSNR');
        if (isPrimaryMethodZone && zone.cc >= 2) {
            score += 25;
            checks.push({name: 'Primary-method zone', passed: true, detail: `${zone.src} ${zoneConfluence}`});
        } else if (zone.quality === 'A') {
            score += 25;
            checks.push({name: 'High-quality zone', passed: true, detail: 'A-grade zone nearby'});
        } else if (zone.quality === 'B' && zone.cc >= 2) {
            score += 25;
            checks.push({name: 'High-quality zone', passed: true, detail: 'B-grade multi-confluence zone nearby'});
        } else {
            checks.push({name: 'High-quality zone', passed: false, detail: 'Single-confluence or weak zone'});
        }
    }
    const displacement = detectDisplacement(entryData, direction);
    if (displacement.detected) { score += 10; checks.push({name: 'Displacement momentum', passed: true, detail: 'Detected'}); } else { checks.push({name: 'Displacement momentum', passed: false, detail: 'None'}); }
    const magnetism = score >= 60 ? 'STRONG' : (score >= 35 ? 'MODERATE' : 'WEAK');
    return { magnetism, score, maxScore: 100, checks, likelyToReach: score >= 35, summary: `Zone magnetism: ${magnetism} (${score}/100)` };
}
async function checkHTFConfluenceAsync(dailyData, h4Data, entryDirection) { const dailyDir = await getQuoteDirection('1D', dailyData), h4Dir = await getQuoteDirection('4H', h4Data), entryDir = entryDirection === 'BUY' ? 'BULLISH' : 'BEARISH', againstDir = entryDirection === 'BUY' ? 'BEARISH' : 'BULLISH'; if (dailyDir === entryDir && h4Dir === entryDir) return { level: 'FULL', daily: dailyDir, h4: h4Dir, penalty: 0 }; if (dailyDir === entryDir || h4Dir === entryDir) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: dailyDir === entryDir ? 8 : 15, alignedTF: dailyDir === entryDir ? '1D' : '4H' }; if (dailyDir === 'NEUTRAL' && h4Dir === 'NEUTRAL') return { level: 'NEUTRAL', daily: dailyDir, h4: h4Dir, penalty: 5 };
if ((dailyDir === 'NEUTRAL' && h4Dir === againstDir) || (dailyDir === againstDir && h4Dir === 'NEUTRAL')) return { level: 'PARTIAL', daily: dailyDir, h4: h4Dir, penalty: 12, alignedTF: null }; return { level: 'CONFLICT', daily: dailyDir, h4: h4Dir, penalty: 30 }; }
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}
function findPrecisionEntry(data,price,direction,msnr){
    const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4),imbalances=findImbalances(data),orderBlocks=detectOrderBlocks(data,direction);
    const RETEST_LOOKBACK_CANDLES=15;
    const recentCandles=data.slice(-RETEST_LOOKBACK_CANDLES);
    const isEligibleFVG=fvg=>fvg.fresh || recentCandles.some(candle=>candle.l<=fvg.h && candle.h>=fvg.l);
    const h=Math.max(...data.slice(-20).map(c=>c.h)),l=Math.min(...data.slice(-20).map(c=>c.l)),r=h-l;
    const oteLow = direction==='BUY' ? l+r*0.21 : h-r*0.382, oteHigh = direction==='BUY' ? l+r*0.382 : h-r*0.21;
    let allZones=[];
    if(direction==='BUY'){
        fvgs.filter(f=>f.type==='bull' && f.l<price && isEligibleFVG(f)).forEach(f=>{let s=30;let cf=['FVG'];if(f.l>=oteLow && f.l<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BULL' && Math.abs(b.p-f.l)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.L.find(x=>Math.abs(x.p-f.l)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-f.l)<f.l*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.filter(ob=>ob.high<price).forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.low>=oteLow && ob.low<=oteHigh){s+=35;cf.push('OTE');}if(swings.L.find(x=>Math.abs(x.p-ob.low)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport && Math.abs(msnr.nearestSupport-ob.low)<ob.low*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-ob.low)<ob.low*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        for(const lvl of [msnr.allSupports?.[0], msnr.allSupports?.[1]].filter(v=>v && v<price)){let s=lvl===msnr.allSupports?.[0]?40:35;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bull' && Math.abs(f.l-lvl)<lvl*0.003)){s+=25;cf.push('FVG');}if(swings.L.find(x=>Math.abs(x.p-lvl)<lvl*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BULLISH' && Math.abs((i.low+i.high)/2-lvl)<lvl*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:lvl*0.998,high:lvl*1.002,p:lvl,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
    } else {
        fvgs.filter(f=>f.type==='bear' && f.h>price && isEligibleFVG(f)).forEach(f=>{let s=30;let cf=['FVG'];if(f.h>=oteLow && f.h<=oteHigh){s+=35;cf.push('OTE');}if(breakers.find(b=>b.type==='BEAR' && Math.abs(b.p-f.h)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.H.find(x=>Math.abs(x.p-f.h)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-f.h)<f.h*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:f.l,high:f.h,p:(f.l+f.h)/2,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        orderBlocks.filter(ob=>ob.low>price).forEach(ob=>{let s=35;let cf=['OrderBlock'];if(ob.high>=oteLow && ob.high<=oteHigh){s+=35;cf.push('OTE');}if(swings.H.find(x=>Math.abs(x.p-ob.high)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance && Math.abs(msnr.nearestResistance-ob.high)<ob.high*0.003){s+=20;cf.push('MSNR');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-ob.high)<ob.high*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:ob.low,high:ob.high,p:(ob.low+ob.high)/2,src:'OB',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=75?'A':(s>=55?'B':'C'),hasImbalance:cf.includes('Imbalance')});});
        for(const lvl of [msnr.allResistances?.[0], msnr.allResistances?.[1]].filter(v=>v && v>price)){let s=lvl===msnr.allResistances?.[0]?40:35;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bear' && Math.abs(f.h-lvl)<lvl*0.003)){s+=25;cf.push('FVG');}if(swings.H.find(x=>Math.abs(x.p-lvl)<lvl*0.003)){s+=20;cf.push('Swing');}if(imbalances.find(i=>i.type==='BEARISH' && Math.abs((i.low+i.high)/2-lvl)<lvl*0.005)){s+=25;cf.push('Imbalance');}allZones.push({low:lvl*0.998,high:lvl*1.002,p:lvl,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=65?'A':(s>=50?'B':'C'),hasImbalance:cf.includes('Imbalance')});}
    }
    const tsSig=detectTurtleSoup(data);
    if(tsSig.detected && tsSig.type===direction){
        for(const z of allZones){
            if(Math.abs(z.p-tsSig.keyLevel)<price*0.004){z.score+=25;z.confluence+='+TBS';z.cc++;z.quality=z.score>=75?'A':(z.score>=55?'B':'C');}
        }
    }
    allZones.sort((x,y)=>y.score-x.score);
    if(allZones.length>0){
        const cands=[];
        for(const z of allZones){
            const zp=(z.low+z.high)/2;
            if(cands.some(c=>Math.abs(c.p-zp)<zp*0.002))continue;
            cands.push({low:z.low,high:z.high,p:zp,src:z.src,confluence:z.confluence,cc:z.cc,quality:z.quality,hasImbalance:z.hasImbalance});
            if(cands.length>=8)break;
        }
        const b=cands[0];b.candidates=cands;return b;
    }
    if(direction==='BUY'){const low=l+r*.21,high=l+r*.382;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};}
    else {const low=h-r*.382,high=h-r*.21;return{low,high,p:(low+high)/2,src:'OTE',confluence:'OTE',cc:1,quality:'C',hasImbalance:false};}
}
function checkProbability(zone,mtf,magnetism){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Zone Magnetism',passed:magnetism.likelyToReach,critical:true});checks.push({name:'Imbalance Magnet',passed:zone.hasImbalance,critical:false});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=4?'HIGH':(tp>=3?'MEDIUM':'LOW')):'LOW',checks,totalPassed:tp,passed:cp};}

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

    const finalDist = Math.min(apiATR * 0.6, maxSLD);
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

function getStopATR(twelveIndicators, fallbackATR = 0, candles = []) {
    return twelveIndicators?.atr_api || fallbackATR || (candles.length ? atr(candles, DEFAULT_ATR_PERIOD) : 0);
}

function recomputeTradeLevels(best, zoneLow, zoneHigh, price, currentPair, candles = []) {
    const settings = getMarketSettings(currentPair || pair);
    const prec = settings.prec || DEFAULT_PRECISION;
    const factor = Math.pow(10, prec);
    const entry = Math.round(((zoneLow + zoneHigh) / 2) * factor) / factor;
    const zone = { ...(best.zone || {}), low: zoneLow, high: zoneHigh, p: entry };
    const stopATR = getStopATR(best?.twelveIndicators, best?.entryATR, candles);
    const slResult = calcStopLoss(candles, best.direction, entry, zone, best.msnr, best.timeframe || best.entryTF, { ...(best.twelveIndicators || {}), atr_api: stopATR }, currentPair || pair);
    const tps = calcTakeProfits(best.direction, entry, slResult.price);
    const risk = Math.abs(entry - slResult.price);
    const rrDisplay = risk > 0 ? (Math.abs(tps.tp1 - entry) / risk).toFixed(1) : '0.0';
    const invalidationPrice = best.direction === 'BUY' ? slResult.price * BUY_INVALIDATION_FACTOR : slResult.price * SELL_INVALIDATION_FACTOR;
    const entryATR = best?.entryATR || stopATR || 1;
    const entryDistance = best.direction === 'BUY' ? price - entry : entry - price;
    return {
        entry,
        zone,
        sl: slResult.price,
        tp1: tps.tp1,
        tp2: tps.tp2,
        tp3: tps.tp3,
        rrUsed: tps.rrUsed,
        slResult,
        invalidationPrice,
        risk,
        rrDisplay,
        entryDistanceATR: entryDistance / entryATR,
        entryDistancePct: (entryDistance / price) * 100,
        tradeLevels: {
            entry,
            stopLoss: slResult.price,
            takeProfit: tps.tp1,
            partialTP: tps.tp2,
            invalidation: invalidationPrice,
            breakeven: entry,
            pipsRisk: +((risk / settings.pipSize).toFixed(1)),
            pipsReward: +((Math.abs(tps.tp1 - entry) / settings.pipSize).toFixed(1)),
            riskReward: tps.rrUsed
        }
    };
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
function isZoneValid(freshness) {
    return freshness.fresh || (freshness.partiallyUsed && freshness.violations === 0);
}
function isZoneHeavilyViolated(freshness) {
    return freshness.used && freshness.violations > MAX_ALLOWED_ZONE_VIOLATIONS;
}
function isHTFPremiumDiscount(htfData, direction, currentPrice) {
    if (!htfData || htfData.length < 10) return { inPremiumDiscount: false, value: 'neutral', pct: 0 };
    let high = -Infinity, low = Infinity;
    for (let i = 0; i < htfData.length; i++) {
        if (htfData[i].h > high) high = htfData[i].h;
        if (htfData[i].l < low) low = htfData[i].l;
    }
    const range = high - low;
    const current = typeof currentPrice === 'number' ? currentPrice : htfData[htfData.length - 1].c;
    const mid = range / 2 + low;
    if (direction === 'BUY') {
        const inDiscount = current < mid;
        const discountPct = ((mid - current) / range * 100);
        return { inPremiumDiscount: inDiscount, value: 'discount', pct: Math.max(0, discountPct) };
    }
    const inPremium = current > mid;
    const premiumPct = ((current - mid) / range * 100);
    return { inPremiumDiscount: inPremium, value: 'premium', pct: Math.max(0, premiumPct) };
}
function getGhostHardRules(direction, sweeps, turtleSoup, mss, session, freshness, zone) {
    const wantSweepDir = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const turtleSoupAligned = turtleSoup?.detected && turtleSoup.type === direction;
    const mssAligned = direction === 'BUY' ? mss?.type === 'BULL' : mss?.type === 'BEAR';
    return {
        hasSweep: (sweeps || []).some(s => s.direction === wantSweepDir) || turtleSoupAligned,
        hasMSS: !!mss && mssAligned && mss.displaced === true,
        hasKillzone: !!session?.isKillzone || !!session?.isSilverBullet,
        zoneFresh: freshness?.fresh || (freshness?.partiallyUsed && freshness?.violations === 0),
        zoneQuality: zone?.quality === 'A' || zone?.quality === 'B'
    };
}
function hasGhostConfirmationCandle(data, direction) {
    if (!data || data.length < 2) return false;
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    if (direction === 'BUY') {
        if (last.c > last.o && prev.c < prev.o && last.c > prev.h) return true;
        if ((last.c - last.l) > Math.abs(last.c - last.o) * 2 && last.c > last.o) return true;
        if (last.c > prev.h && last.o < prev.l) return true;
        return false;
    }
    if (last.c < last.o && prev.c > prev.o && last.c < prev.l) return true;
    if ((last.h - last.c) > Math.abs(last.c - last.o) * 2 && last.c < last.o) return true;
    if (last.c < prev.l && last.o > prev.h) return true;
    return false;
}
const BASE_GHOST_RULES_CONFIDENCE = 82;
const A_GRADE_GHOST_CONFIDENCE_BONUS = 6;
const SILVER_BULLET_GHOST_CONFIDENCE_BONUS = 5;
const SNIPER_GHOST_CONFIDENCE_BONUS = 3;
const HTF_VALIDATION_GHOST_CONFIDENCE_BONUS = 2;
const GHOST_MACHINE_ZONE_REACTION = { confirmed: true, type: 'PATTERN_MATCH', strength: 'STRONG' };
const FULL_RISK_RULES_REQUIRED = 5;
const PARTIAL_RISK_RULES_REQUIRED = 3;
const FULL_RISK_PERCENT = 1.0;
const PARTIAL_RISK_PERCENT = 0.5;
function getSession() {
    const now = new Date(); const hour = now.getUTCHours(); const min = now.getUTCMinutes(); const time = hour + min / 60;
    let estHour = hour - 4;
    if (estHour < 0) estHour += 24;
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false, isMacro: false };
    if (time >= 0 && time < 4) s = { ...s, session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true };
    else if (time >= 7 && time < 10) s = { ...s, session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true };
    else if (time >= 12 && time < 15) s = { ...s, session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true };
    else if (time >= 15 && time < 17) s = { ...s, session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true };
    if ((time >= 8.5 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) { s.isSilverBullet = true; s.multiplier += 0.2; s.emoji = '🏹'; s.session += ' + SB'; }
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

function calcDeltaProxy(data, n = 20) {
    if (!data || data.length < 3) return { cvd: 0, direction: 'NEUTRAL', proxy: true };
    let cvd = 0;
    for (const c of data.slice(-n)) cvd += (c.c > c.o ? 1 : (c.c < c.o ? -1 : 0)) * (c.v || 1);
    return { cvd, direction: cvd > 0 ? 'BULLISH' : (cvd < 0 ? 'BEARISH' : 'NEUTRAL'), proxy: true };
}

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

async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    // [KEEP YOUR EXISTING analyzeTimeframe FUNCTION EXACTLY AS IT WAS]
    // (This is where your Ghost Machine logic lives - keeping it intact)
}

function countBOS(data, htfData, direction) {
    let count = 0;
    const tfs = ['1D', '4H', '1H', '15M', '5M'];

    for (const tf of tfs) {
        const d = htfData[tf] || data;
        if (d.length < 20) continue;

        const mss = detectMSS(d);
        if (!mss) continue;

        if (direction === 'BUY' && mss.type === 'BULL') count++;
        if (direction === 'SELL' && mss.type === 'BEAR') count++;
    }

    return count;
}

function findBrokenLevel(data, direction) {
    if (data.length < 30) return null;

    const swings = findSwings(data, 4);
    const lastPrice = data[data.length - 1].c;

    if (direction === 'BUY') {
        const resistances = swings.H.filter(s => s.p < lastPrice);
        if (resistances.length > 0) {
            const broken = resistances[resistances.length - 1];
            return { price: broken.p, type: 'RESISTANCE_FLIPPED_TO_SUPPORT' };
        }
    } else {
        const supports = swings.L.filter(s => s.p > lastPrice);
        if (supports.length > 0) {
            const broken = supports[supports.length - 1];
            return { price: broken.p, type: 'SUPPORT_FLIPPED_TO_RESISTANCE' };
        }
    }

    return null;
}

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

    if (data.zoneReaction && data.zoneReaction.type.includes('MSNR fakeout')) {
        score += 20;
    }

    if (data.session.session === 'LONDON KZ' || data.session.session === 'NEW_YORK KZ') score += 15;
    else if (data.session.isKillzone) score += 10;
    else if (data.session.session === 'ASIA KZ') score += 5;
    else score += 2;

    if (data.isInOptimalZone) score += 10;
    const hasLiquidityEvent = data.hasLiquidityEvent ?? data.hasSweepOrTBS ?? data.hasSweep ?? data.turtleSoup?.detected ?? false;
    if (hasLiquidityEvent) score += 10;
    if (data.zone.quality === 'A') score += 10;
    else if (data.zone.quality === 'B') score += 5;

    if (data.session.session === 'OFF-HOURS') score -= 20;
    if (!hasLiquidityEvent && !data.turtleSoup.detected) score -= 15;
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
    const hasSweep = result.hasLiquidityEvent ?? result.hasSweepOrTBS ?? result.hasSweep ?? false;

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

    return Math.max(0, score);
}

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
    // [KEEP YOUR EXISTING askAIWithAllResults FUNCTION EXACTLY AS IT WAS]
}

function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    if (el) el.textContent = JSON.stringify(obj, null, 2);
}

async function runAutoScan() {
    // [KEEP YOUR EXISTING runAutoScan FUNCTION EXACTLY AS IT WAS]
}

// ============================================
// RECENT SAVED + TRADE JOURNAL - KEEP EXACTLY AS IT WAS
// ============================================
let lastSetupSummary = null, lastSetupOut = null;
// [KEEP ALL YOUR EXISTING FUNCTIONS BELOW - saveCurrentSetup, markRecentOutcome, etc.]
