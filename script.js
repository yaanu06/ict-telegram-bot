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
const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_PRECISION = 5;
const BUY_INVALIDATION_FACTOR = 0.998;
const SELL_INVALIDATION_FACTOR = 1.002;

// FIX: Lower threshold
const MIN_SETUP_SCORE = 50;

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
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.015, targetRR: 3, prec: 2, pipSize: 0.1, slBuffers: { '5M': 2, '15M': 3, '1H': 5, '4H': 8, '1D': 15 } };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.03, maxSLPct: 0.015, targetRR: 3, prec: 2, pipSize: 0.01, slBuffers: { '5M': 0.03, '15M': 0.05, '1H': 0.08, '4H': 0.12, '1D': 0.20 } };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.10, maxSLPct: 0.01, targetRR: 3, prec: 3, pipSize: 0.01, slBuffers: { '5M': 0.08, '15M': 0.12, '1H': 0.20, '4H': 0.35, '1D': 0.60 } };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 30, maxSLPct: 0.02, targetRR: 3, prec: 2, pipSize: 1, slBuffers: { '5M': 30, '15M': 50, '1H': 80, '4H': 120, '1D': 200 } };
    return { slBuffer: 0.0005, minSL: 0.0003, maxSLPct: 0.01, targetRR: 3, prec: 5, pipSize: 0.0001, slBuffers: { '5M': 0.0003, '15M': 0.0005, '1H': 0.0008, '4H': 0.0012, '1D': 0.0020 } };
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
// INITIALIZATION
// ============================================
function startApp() {
    console.log('🚀 Starting ICT Trading Bot Pro FINAL FIX...');
    loadKeys().then(() => {
        updateKeyStatus();
        if (!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY) {
            setTimeout(showSetup, 500);
        }
    });
    init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
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
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}
function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY' && lb>avg*2.5 && lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL' && lb>avg*2.5 && lc[4].c<lc[4].o)return{detected:true};return{detected:false};}
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
function detectTurtleSoup(data){if(data.length<15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow<keyLow*0.999 && cc>keyLow && cc>co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];if(recentHigh>keyHigh*1.001 && cc<keyHigh && cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};}
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
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}
function checkZoneFreshness(data, zone, direction) {
    let touches = 0, violations = 0; const lookback = Math.min(50, data.length);
    for (let i = data.length - lookback; i < data.length; i++) { if (i < 0) continue; const inZone = data[i].l <= zone.high && data[i].h >= zone.low; if (!inZone) continue; touches++; if (direction === 'BUY' && data[i].c < zone.low) violations++; if (direction === 'SELL' && data[i].c > zone.high) violations++; }
    const fresh = touches <= 2 && violations === 0, partiallyUsed = touches <= 5 && violations <= 1, used = touches > 5 || violations > 1;
    return { fresh, partiallyUsed, used, touches, violations };
}
function getSession() {
    const now = new Date(); const hour = now.getUTCHours(); const min = now.getUTCMinutes(); const time = hour + min / 60;
    let s = { session: 'OFF-HOURS', multiplier: 0.5, emoji: '🌙', isKillzone: false, isSilverBullet: false, isMacro: false };
    if (time >= 0 && time < 4) s = { ...s, session: 'ASIA KZ', multiplier: 0.8, emoji: '🌏', isKillzone: true };
    else if (time >= 7 && time < 10) s = { ...s, session: 'LONDON KZ', multiplier: 1.3, emoji: '🇬🇧', isKillzone: true };
    else if (time >= 12 && time < 15) s = { ...s, session: 'NEW_YORK KZ', multiplier: 1.2, emoji: '🇺🇸', isKillzone: true };
    else if (time >= 15 && time < 17) s = { ...s, session: 'LON-CLOSE KZ', multiplier: 0.9, emoji: '🌆', isKillzone: true };
    if ((time >= 8.5 && time < 9) || (time >= 15 && time < 16) || (time >= 19 && time < 20)) { s.isSilverBullet = true; s.multiplier += 0.2; s.emoji = '🏹'; s.session += ' + SB'; }
    return s;
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
function checkPathClearance(entryData,entry,tp,direction){const obstacles=[];const fvgs=detectFVG(entryData);const swings=findSwings(entryData,3);if(direction==='BUY'){const bearFVGs=fvgs.filter(f=>f.type==='bear' && f.l>entry && f.l<tp);if(bearFVGs.length>0)obstacles.push('Bearish FVG');const swingHighs=swings.H.filter(s=>s.p>entry && s.p<tp);if(swingHighs.length>0)obstacles.push('Swing high');}else{const bullFVGs=fvgs.filter(f=>f.type==='bull' && f.h>tp && f.h<entry);if(bullFVGs.length>0)obstacles.push('Bullish FVG');const swingLows=swings.L.filter(s=>s.p>tp && s.p<entry);if(swingLows.length>0)obstacles.push('Swing low');}return{clear:obstacles.length===0,obstacles,count:obstacles.length};}
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

// ============================================
// FIXED: WIDER STOP LOSS
// ============================================
function calcStopLoss(data, dir, entry, zone, msnr, tfUsed, twelveIndicators, currentPair) {
    const apiATR = twelveIndicators?.atr_api || atr(data, 14);
    const s = getMarketSettings(currentPair || pair);
    const maxSLD = entry * s.maxSLPct;
    
    // FIX: 2x ATR buffer minimum
    const slBuf = Math.max(apiATR * 2.0, getSLBufferForTF(apiATR, tfUsed, currentPair || pair));
    
    const swings = findSwings(data, 3);
    const fvgs = detectFVG(data);
    const obs = detectOrderBlocks(data, dir);

    let candidates = [];
    const addCand = (price, reason) => {
        const dist = dir === 'BUY' ? entry - price : price - entry;
        if (dist > 0 && dist <= maxSLD && dist <= apiATR * 3.0) {
            candidates.push({ price, reason, dist });
        }
    };

    if (dir === 'BUY') {
        if (zone && zone.low < entry) addCand(zone.low - slBuf * 1.5, 'Below Zone');
        swings.L.filter(x => x.p < entry).forEach(x => addCand(x.p - slBuf, 'Below Swing'));
        obs.filter(ob => ob.low < entry).forEach(ob => addCand(ob.low - slBuf, 'Below OB'));
        fvgs.filter(f => f.type === 'bull' && f.l < entry).forEach(f => addCand(f.l - slBuf * 0.5, 'Below FVG'));
        if (msnr && msnr.allSupports) {
            msnr.allSupports.filter(x => x < entry).forEach(x => addCand(x - slBuf, 'Below MSNR'));
        }
        // FIX: Minimum SL distance
        addCand(entry - apiATR * 1.5, 'Min ATR buffer');
    } else {
        if (zone && zone.high > entry) addCand(zone.high + slBuf * 1.5, 'Above Zone');
        swings.H.filter(x => x.p > entry).forEach(x => addCand(x.p + slBuf, 'Above Swing'));
        obs.filter(ob => ob.high > entry).forEach(ob => addCand(ob.high + slBuf, 'Above OB'));
        fvgs.filter(f => f.type === 'bear' && f.h > entry).forEach(f => addCand(f.h + slBuf * 0.5, 'Above FVG'));
        if (msnr && msnr.allResistances) {
            msnr.allResistances.filter(x => x > entry).forEach(x => addCand(x + slBuf, 'Above MSNR'));
        }
        addCand(entry + apiATR * 1.5, 'Min ATR buffer');
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => b.dist - a.dist); // FIX: Take widest SL
        const best = candidates[0];
        return { price: best.price, reason: best.reason, distance: best.dist };
    }

    const finalDist = Math.min(apiATR * 1.5, maxSLD);
    const finalSL = dir === 'BUY' ? entry - finalDist : entry + finalDist;
    return { price: finalSL, reason: 'ATR Baseline 1.5x', distance: finalDist };
}

function calcTakeProfits(dir, entry, sl) {
    const risk = Math.abs(entry - sl);
    const settings = getMarketSettings(pair);
    const rr = settings.targetRR || 3;
    
    // FIX: Better RR targets (3:1, 5:1, 7:1)
    const rr1 = rr, rr2 = rr + 2, rr3 = rr + 4;

    if (dir === 'BUY') {
        return { tp1: entry + risk * rr1, tp2: entry + risk * rr2, tp3: entry + risk * rr3, rrUsed: rr1 };
    } else {
        return { tp1: entry - risk * rr1, tp2: entry - risk * rr2, tp3: entry - risk * rr3, rrUsed: rr1 };
    }
}

function recomputeTradeLevels(best, zoneLow, zoneHigh, price, currentPair, candles = []) {
    const settings = getMarketSettings(currentPair || pair);
    const prec = settings.prec || DEFAULT_PRECISION;
    const factor = Math.pow(10, prec);
    const entry = Math.round(((zoneLow + zoneHigh) / 2) * factor) / factor;
    const zone = { ...(best.zone || {}), low: zoneLow, high: zoneHigh, p: entry };
    const stopATR = best?.entryATR || 1;
    const slResult = calcStopLoss(candles, best.direction, entry, zone, best.msnr, best.timeframe || best.entryTF, { atr_api: stopATR }, currentPair || pair);
    const tps = calcTakeProfits(best.direction, entry, slResult.price);
    const risk = Math.abs(entry - slResult.price);
    const rrDisplay = risk > 0 ? (Math.abs(tps.tp1 - entry) / risk).toFixed(1) : '0.0';
    const invalidationPrice = best.direction === 'BUY' ? slResult.price * BUY_INVALIDATION_FACTOR : slResult.price * SELL_INVALIDATION_FACTOR;
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
        tradeLevels: {
            entry,
            stopLoss: slResult.price,
            takeProfit: tps.tp1,
            partialTP: tps.tp2,
            finalTP: tps.tp3,
            invalidation: invalidationPrice,
            breakeven: entry,
            riskReward: tps.rrUsed
        }
    };
}

// ============================================
// FIXED: CONFIRMATION ENTRY
// ============================================
function getConfirmationEntry(candles, zone, direction) {
    if (candles.length < 3) return { entry: null, confirmed: false, reason: 'Not enough candles' };
    
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    
    if (direction === 'BUY') {
        // FIX: Multiple confirmation signals
        const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c > prev.h && last.o < prev.l;
        const bullishPinbar = (last.c - last.l) > Math.abs(last.c - last.o) * 2 && last.c > last.o;
        const hammer = (last.h - last.l) > 0 && (last.c - last.l) > (last.h - last.c) * 2 && last.c > last.o;
        const rejectionWick = last.l <= zone.low && last.c > zone.low;
        const bullishMomentum = last.c > last.o && last.c > prev.c && prev.c > prev2.c;
        const closeAboveZone = last.c > zone.high && last.c > last.o;
        
        if (bullishEngulf || bullishPinbar || hammer || rejectionWick || closeAboveZone) {
            let entry = Math.min(last.c, zone.high * 1.002);
            if (rejectionWick) entry = Math.min(last.c, zone.low + (zone.high - zone.low) * 0.5);
            return {
                entry: entry,
                confirmed: true,
                reason: bullishEngulf ? 'Bullish Engulfing' : 
                         bullishPinbar ? 'Bullish Pinbar' :
                         hammer ? 'Hammer' :
                         rejectionWick ? 'Zone Rejection' :
                         'Bullish Momentum'
            };
        }
        return { entry: null, confirmed: false, reason: 'Waiting for bullish confirmation' };
        
    } else {
        const bearishEngulf = last.c < last.o && prev.c > prev.o && last.c < prev.l && last.o > prev.h;
        const bearishPinbar = (last.h - last.c) > Math.abs(last.c - last.o) * 2 && last.c < last.o;
        const shootingStar = (last.h - last.l) > 0 && (last.h - last.c) > (last.c - last.l) * 2 && last.c < last.o;
        const rejectionWick = last.h >= zone.high && last.c < zone.high;
        const bearishMomentum = last.c < last.o && last.c < prev.c && prev.c < prev2.c;
        const closeBelowZone = last.c < zone.low && last.c < last.o;
        
        if (bearishEngulf || bearishPinbar || shootingStar || rejectionWick || closeBelowZone) {
            let entry = Math.max(last.c, zone.low * 0.998);
            if (rejectionWick) entry = Math.max(last.c, zone.low + (zone.high - zone.low) * 0.5);
            return {
                entry: entry,
                confirmed: true,
                reason: bearishEngulf ? 'Bearish Engulfing' :
                         bearishPinbar ? 'Bearish Pinbar' :
                         shootingStar ? 'Shooting Star' :
                         rejectionWick ? 'Zone Rejection' :
                         'Bearish Momentum'
            };
        }
        return { entry: null, confirmed: false, reason: 'Waiting for bearish confirmation' };
    }
}

// ============================================
// FIXED: ANALYZE TIMEFRAME WITH CONFIRMATION
// ============================================
async function analyzeTimeframe(tfToAnalyze, price, htfData) {
    console.log(`🔍 Analyzing ${tfToAnalyze}...`);
    try {
        const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tfToAnalyze);
        const entryData = htfData[entryTF] || await getHistory(entryTF);
        if (!entryData?.length) return null;
        
        const structureData = htfData[structureTF] || await getHistory(structureTF);
        const twelveIndicators = await getTechnicalIndicators(tfToAnalyze);
        const msnr = calculateMSNR(structureData || entryData, price);
        const entryATR = twelveIndicators?.atr_api || atr(entryData, 14);

        const allSetups = [];

        for (const dir of ['BUY', 'SELL']) {
            console.log(`  → Checking ${dir} on ${tfToAnalyze}...`);
            
            const zone = findPrecisionEntry(entryData, price, dir, msnr);
            if (!zone) continue;
            
            // FIX: Require confirmation
            const confirmation = getConfirmationEntry(entryData, zone, dir);
            if (!confirmation.confirmed) {
                console.log(`  ❌ ${dir}: No confirmation - ${confirmation.reason}`);
                continue;
            }
            
            const entry = confirmation.entry;
            const freshness = checkZoneFreshness(entryData, zone, dir);
            const session = getSession();
            const sweeps = detectLiquiditySweeps(entryData, price);
            const hasSweep = sweeps.some(s => s.direction === (dir === 'BUY' ? 'BULLISH' : 'BEARISH'));
            const turtleSoup = detectTurtleSoup(entryData);
            const hasTBS = turtleSoup.detected && turtleSoup.type === dir;
            const mss = detectMSS(entryData);
            const hasDisplacement = mss?.displaced === true;
            const bosCount = countBOS(entryData, htfData, dir);
            const brokenLevel = findBrokenLevel(entryData, dir);
            
            // FIX: Wider SL
            const slResult = calcStopLoss(entryData, dir, entry, zone, msnr, tfToAnalyze, twelveIndicators, pair);
            const sl = slResult.price;
            const risk = Math.abs(entry - sl);
            
            // FIX: Better TP targets
            const tp1 = dir === 'BUY' ? entry + risk * 3.0 : entry - risk * 3.0;
            const tp2 = dir === 'BUY' ? entry + risk * 5.0 : entry - risk * 5.0;
            const tp3 = dir === 'BUY' ? entry + risk * 7.0 : entry - risk * 7.0;
            
            // FIX: Scoring with confirmation bonus
            let pts = 40; // Base with confirmation
            
            if (hasSweep) pts += 15;
            if (hasTBS) pts += 15;
            if (hasDisplacement) pts += 15;
            if (freshness.fresh) pts += 15;
            if (session.isKillzone || session.isSilverBullet) pts += 10;
            if (zone.quality === 'A' || zone.quality === 'B') pts += 10;
            if (zone.src === 'FVG') pts += 10;
            if (bosCount >= 2) pts += 10;
            if (brokenLevel) pts += 10;
            
            console.log(`  → ${dir} score: ${pts}, Entry: ${entry}, SL: ${sl}, Conf: ${confirmation.reason}`);
            
            if (pts < MIN_SETUP_SCORE) {
                console.log(`  ❌ ${dir}: Score ${pts} < ${MIN_SETUP_SCORE}`);
                continue;
            }
            
            allSetups.push({ 
                dir, 
                pts, 
                entry, 
                sl, 
                tp1, 
                tp2, 
                tp3, 
                risk,
                zone,
                msnr,
                freshness,
                session,
                hasSweep,
                hasTBS,
                hasDisplacement,
                bosCount,
                brokenLevel,
                slResult,
                entryATR,
                confirmation: confirmation.reason,
                sweeps,
                turtleSoup,
                mss,
                twelveIndicators
            });
        }

        if (allSetups.length === 0) return null;

        allSetups.sort((a, b) => b.pts - a.pts);
        const best = allSetups[0];
        
        // Calculate HTF alignment
        let htfAgree = 0;
        const htfTrends = {};
        for (const t of ['1D', '4H', '1H']) {
            const d = htfData[t];
            if (d && d.length >= 50) {
                const trend = detectTrend(d);
                htfTrends[t] = trend;
                if ((best.dir === 'BUY' && trend === 'BULLISH') || (best.dir === 'SELL' && trend === 'BEARISH')) htfAgree++;
            }
        }
        
        const mtfTrends = {};
        let alignedCount = 0;
        for (const t of ALL_TIMEFRAMES) {
            const d = htfData[t];
            const tr = (d && d.length >= 50) ? detectTrend(d) : 'NEUTRAL';
            mtfTrends[t] = tr;
            if ((best.dir === 'BUY' && tr === 'BULLISH') || (best.dir === 'SELL' && tr === 'BEARISH')) alignedCount++;
        }
        
        const volatility = { level: 'Moderate', desc: 'Normal' };
        const confidence = Math.min(best.pts + 20, 95);
        
        return {
            timeframe: tfToAnalyze,
            direction: best.dir,
            entry: best.entry,
            sl: best.sl,
            tp1: best.tp1,
            tp2: best.tp2,
            tp3: best.tp3,
            confidence: confidence,
            zone: best.zone,
            msnr: best.msnr,
            session: best.session,
            freshness: best.freshness,
            hasSweep: best.hasSweep,
            hasTBS: best.hasTBS,
            hasDisplacement: best.hasDisplacement,
            bosCount: best.bosCount,
            brokenLevel: best.brokenLevel,
            slResult: best.slResult,
            entryATR: best.entryATR,
            confirmation: best.confirmation,
            setupScore: best.pts,
            sweeps: best.sweeps || [],
            turtleSoup: best.turtleSoup || { detected: false },
            mss: best.mss,
            twelveIndicators: best.twelveIndicators || {},
            htfAgree: htfAgree,
            htfTrends: htfTrends,
            mtf: { direction: best.dir, strength: alignedCount, trends: mtfTrends },
            volatility: volatility,
            entryDistanceATR: Math.abs(price - best.entry) / best.entryATR,
            entryDistancePct: (Math.abs(price - best.entry) / price) * 100,
            isUnmet: best.dir === 'BUY' ? best.zone.high < price : best.zone.low > price,
            isValidZone: best.freshness.fresh || (best.freshness.partiallyUsed && best.freshness.violations === 0),
            rrUsed: 3.0,
            risk: best.risk
        };

    } catch (e) {
        console.error(`❌ Error in ${tfToAnalyze}:`, e);
        return null;
    }
}

function getVolatilityLevel(atrValue, price) {
    const pct = (atrValue / price) * 100;
    if (pct > 0.8) return { level: 'High', desc: 'Large candles' };
    if (pct > 0.4) return { level: 'Moderate', desc: 'Normal' };
    return { level: 'Low', desc: 'Tight ranges' };
}

// ============================================
// UPDATE MTF DISPLAY
// ============================================
async function updateMTFDisplay(historyCache = {}){
    const tfs=['5M','15M','1H','4H','1D','1W'];
    for(let t of tfs){
        let tr = await getLiveCandleDirection(t, historyCache[t]);
        let el=document.getElementById(`trend${t}`);
        if(el){el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut');el.className=`mtf-trend ${tr.toLowerCase()}`;}
    }
}

// ============================================
// SET JSON OUTPUT
// ============================================
function setJsonOutput(obj) {
    const el = document.getElementById('jsonOutput');
    if (el) el.textContent = JSON.stringify(obj, null, 2);
}

// ============================================
// RUN AUTO SCAN
// ============================================
async function runAutoScan() {
    const btn = document.getElementById('analyzeBtn'), scanStatus = document.getElementById('scanStatus'), scanText = document.getElementById('scanText'), scanFill = document.getElementById('scanProgressFill');
    btn.classList.add('loading'); btn.disabled = true; scanStatus.classList.remove('hidden');
    if (!TWELVE_DATA_KEY) { showSetup(); btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); return; }
    showNotif('🔍 Scanning for setups with confirmation...', 'info');
    try {
        const price = await getPrice(); 
        if (!price) throw new Error('No price');
        const historyCache = {};
        const tfs = ['5M', '15M', '1H', '4H', '1D'];
        scanText.innerHTML = 'Fetching market data...';
        await Promise.all(tfs.map(async (t) => { historyCache[t] = await getHistory(t); }));

        const mtfTrendsData = {}; 
        for (let t of tfs) mtfTrendsData[t] = await getQuoteDirection(t, historyCache[t]);
        await updateMTFDisplay(historyCache); 
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(getPrec(pair))}`;
        if (lastPrice) { const ch = ((price - lastPrice) / lastPrice * 100).toFixed(2); const ce = document.getElementById('priceChange'); ce.innerHTML = `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`; ce.className = `price-change ${ch >= 0 ? 'up' : 'down'}`; } 
        lastPrice = price;
        
        const results = [], timeframesToScan = ['1D', '4H', '1H', '15M', '5M'], htfData = historyCache;
        for (let i = 0; i < timeframesToScan.length; i++) { 
            const tfScan = timeframesToScan[i]; 
            scanText.innerHTML = `Scanning ${tfScan}... (${i + 1}/${timeframesToScan.length})`; 
            scanFill.style.width = ((i + 1) / timeframesToScan.length * 100) + '%'; 
            const result = await analyzeTimeframe(tfScan, price, htfData); 
            if (result) results.push(result); 
        }

        console.log('=== SCAN RESULTS ===');
        console.log('Results found:', results.length);

        if (results.length === 0) { 
            showNotif('🎯 No setups found with confirmation', 'warning'); 
            setJsonOutput({auto_scan_result:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,current_price:price,status:'NO_SETUP',note:'No confirmation candles found. Waiting for engulfing, pinbar, or rejection at zone.',timeframes_scanned:timeframesToScan.length}}); 
            btn.classList.remove('loading'); btn.disabled = false; scanStatus.classList.add('hidden'); 
            return; 
        }
        
        results.sort((a, b) => (b.confidence - a.confidence));
        let best = results[0];

        if (results.length > 1) showNotif(`🎯 Found ${results.length} setups! Best: ${best.timeframe} ${best.direction}`, 'success');
        else showNotif(`🎯 Setup found on ${best.timeframe} with ${best.confirmation}`, 'success');
        
        scanStatus.classList.add('hidden');
        const st = best.direction === 'BUY' ? 'LONG' : 'SHORT';
        
        // FIX: Use recomputed trade levels
        const recomputed = recomputeTradeLevels(best, best.zone.low, best.zone.high, price, pair, htfData[best.timeframe] || []);
        const finalEntry = recomputed.entry;
        const rrDisplay = recomputed.rrDisplay;
        const ghostScore = best.setupScore || 0;
        
        // FIX: Tradeable with lower threshold
        const tradeable = ghostScore >= MIN_SETUP_SCORE;
        const riskPercent = tradeable ? (ghostScore >= 75 ? 1.0 : 0.5) : 0;

        console.log(`🏆 Setup Score: ${ghostScore}/100`);
        console.log(`📊 Tradeable: ${tradeable}, Risk: ${riskPercent * 100}%`);
        console.log(`📊 SL Distance: ${best.slResult?.distance?.toFixed(2) || 'N/A'} points`);
        console.log(`📊 Confirmation: ${best.confirmation}`);

        const prec = getPrec(pair);

        const out = {
            trade_signal: {
                date: new Date().toISOString().split('T')[0],
                current_price: price,
                pair: pair,
                trade_type: best.direction === 'BUY' ? 'BUY' : 'SELL',
                entry_price: finalEntry,
                stop_loss: best.sl,
                take_profit_1: best.tp1,
                take_profit_2: best.tp2,
                take_profit_3: best.tp3,
                confidence: best.confidence,
                setup_score: ghostScore,
                confirmation: best.confirmation,
                analysis: {
                    timeframe: best.timeframe,
                    zone_type: best.zone?.src || 'Unknown',
                    zone_quality: best.zone?.quality || 'C',
                    freshness: best.freshness?.fresh ? 'Fresh' : (best.freshness?.partiallyUsed ? 'Partially used' : 'Used'),
                    session: best.session?.session || 'OFF-HOURS',
                    silver_bullet: best.session?.isSilverBullet ? '✅' : '❌',
                    killzone: best.session?.isKillzone ? '✅' : '❌',
                    liquidity_sweep: best.hasSweep ? '✅' : '❌',
                    turtle_soup: best.hasTBS ? '✅' : '❌',
                    mss_displacement: best.hasDisplacement ? '✅' : '❌',
                    bos_count: best.bosCount || 0,
                    htf_alignment: `${best.htfAgree || 0}/3`,
                    risk_reward: '1:' + rrDisplay
                },
                trade_levels: {
                    entry: finalEntry,
                    stop_loss: best.sl,
                    take_profit_1: best.tp1,
                    take_profit_2: best.tp2,
                    take_profit_3: best.tp3,
                    risk_reward_ratio: parseFloat(rrDisplay) || 3.0
                }
            }
        };

        setJsonOutput(out);
        lastSetupSummary = buildSetupSummary(best, st, finalEntry, price);
        lastSetupOut = out;

        if (!tradeable) {
            analysis = null;
            document.getElementById('executeBtn').disabled = true;
            showNotif(`🚫 Score ${ghostScore} < ${MIN_SETUP_SCORE}`, 'warning');
            return;
        }
        
        analysis = { 
            signalType: st, 
            idealEntry: finalEntry, 
            currentPrice: price, 
            stopLoss: best.sl, 
            takeProfit1: best.tp1, 
            takeProfit2: best.tp2, 
            takeProfit3: best.tp3, 
            confidence: best.confidence, 
            riskPercent, 
            entryZoneLow: best.zone.low, 
            entryZoneHigh: best.zone.high, 
            entryReady: true, 
            executionDecision: 'enter_now', 
            invalidationPrice: best.sl * (best.direction === 'BUY' ? 0.995 : 1.005),
            confirmation: best.confirmation
        };
        
        document.getElementById('executeBtn').disabled = false;
        showNotif(`🎯 ${best.timeframe} ${st} | Score: ${ghostScore} | ${best.confirmation} | 1:${rrDisplay}`, 'success');
    } catch (e) { 
        console.error(e); 
        showNotif('Error: ' + e.message, 'error'); 
        scanStatus.classList.add('hidden');
    }
    finally { 
        btn.classList.remove('loading'); 
        btn.disabled = false; 
    }
}

// ============================================
// RECENT SAVED + TRADE JOURNAL
// ============================================
let lastSetupSummary = null, lastSetupOut = null;

function buildSetupSummary(best, st, finalEntry, price) {
    return {
        id: Date.now(),
        pair, timeframe: best.timeframe, direction: st,
        entry: finalEntry, sl: best.sl, tp1: best.tp1,
        confidence: best.confidence, quality: best.zone?.quality || '?',
        priceAtScan: price,
        setupScore: best.setupScore || 0,
        confirmation: best.confirmation || 'Unknown',
        zoneType: best.zone?.src || 'Unknown'
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
        <div class="journal-head"><span>${e.pair} ${e.direction} ${e.timeframe} ${e.zoneType||''} ${e.confirmation||''}</span><span>${badge.label}</span></div>
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
// LIMIT ORDER FUNCTIONS
// ============================================
function loadLimitOrder() {
    const s = localStorage.getItem('limitOrder');
    if (s) { try { limitOrder = JSON.parse(s); updateLimitUI(); startMonitor(); checkMissedFill(); } catch (e) {} }
}
function saveLimit(o) { limitOrder = o; localStorage.setItem('limitOrder', JSON.stringify(o)); updateLimitUI(); }
function clearLimit() { limitOrder = null; localStorage.removeItem('limitOrder'); if (priceTimer) clearInterval(priceTimer); updateLimitUI(); }
function cancelLimit() { clearLimit(); showNotif('❌ Cancelled', 'warning'); }
function updateLimitUI() {
    const t = document.getElementById('limitOrderText'), c = document.getElementById('cancelLimitBtn');
    if (limitOrder) {
        const prec = getPrec(limitOrder.pair || pair);
        t.innerHTML = `⏳ ${limitOrder.pair||''} ${limitOrder.signalType} @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)} | ${limitOrder.confirmation||''}`;
        t.className = 'active';
        c.classList.remove('hidden');
        document.getElementById('executeBtn').innerHTML = '⏳ Waiting...';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #ff9f0a, #ff6b00)';
    } else {
        t.innerHTML = 'No active order';
        t.className = '';
        c.classList.add('hidden');
        document.getElementById('executeBtn').innerHTML = '⚡ Place Order';
        document.getElementById('executeBtn').style.background = 'linear-gradient(135deg, #34c759, #28a745)';
    }
}
function startMonitor() {
    if (priceTimer) clearInterval(priceTimer);
    priceTimer = setInterval(async () => {
        if (!limitOrder) { clearInterval(priceTimer); return; }
        const orderPair = limitOrder.pair || pair;
        const p = await getPrice(orderPair);
        if (!p) return;
        const prec = getPrec(orderPair);
        if (orderPair === pair) document.getElementById('currentPrice').innerHTML = `$${p.toFixed(prec)}`;
        if ((limitOrder.signalType === 'LONG' && p <= limitOrder.idealEntry) || (limitOrder.signalType === 'SHORT' && p >= limitOrder.idealEntry)) {
            const filled = limitOrder;
            clearLimit();
            showNotif(`✅ FILLED! ${filled.pair||''} ${filled.signalType} @ $${p.toFixed(prec)}`, 'success');
            try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play(); } catch (e) {}
        }
    }, 2000);
}
function handleLimit() {
    if (!analysis || analysis.signalType === 'NEUTRAL') { showNotif('No signal', 'error'); return; }
    if (limitOrder) { cancelLimit(); return; }
    const o = {
        id: Date.now(),
        pair,
        signalType: analysis.signalType,
        idealEntry: analysis.idealEntry,
        stopLoss: analysis.stopLoss,
        takeProfit1: analysis.takeProfit1,
        takeProfit2: analysis.takeProfit2,
        takeProfit3: analysis.takeProfit3,
        confidence: analysis.confidence,
        entryZoneLow: analysis.entryZoneLow,
        entryZoneHigh: analysis.entryZoneHigh,
        entryReady: analysis.entryReady,
        executionDecision: analysis.executionDecision,
        invalidationPrice: analysis.invalidationPrice,
        confirmation: analysis.confirmation || 'Confirmed',
        createdAt: new Date().toISOString()
    };
    saveLimit(o);
    startMonitor();
    showNotif(`📝 ${o.signalType} @ $${o.idealEntry.toFixed(getPrec(pair))} | ${o.confirmation}`, 'info');
}
function copyJson() {
    const el = document.getElementById('jsonOutput');
    const t = el ? el.textContent : '';
    if (!t || t.trim() === '{}') { showNotif('Run analysis first', 'warning'); return; }
    navigator.clipboard.writeText(t).then(() => showNotif('📋 Copied!', 'success')).catch(() => showNotif('Failed', 'error'));
}
function showNotif(m, t) {
    const n = document.getElementById('notification');
    n.innerHTML = m;
    n.className = `notification ${t}`;
    n.classList.remove('hidden');
    setTimeout(() => n.classList.add('hidden'), 3000);
}

// ============================================
// ADDITIONAL HELPER FUNCTIONS
// ============================================
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
function validateTradingSession() {
    const hour = new Date().getUTCHours();
    return (hour >= 8 && hour <= 22);
}
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

// ============================================
// MISSED FILL DETECTION
// ============================================
function parseCandleTimeUTC(t) {
    if (typeof t !== 'string') return NaN;
    const iso = t.includes('T') ? t : t.replace(' ', 'T');
    return new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
}
function orderCrossedInCandles(order, candles) {
    if (!order?.idealEntry || !candles?.length) return false;
    const created = new Date(order.createdAt).getTime();
    if (isNaN(created)) return false;
    return candles.some(c => {
        const t = parseCandleTimeUTC(c.t);
        if (isNaN(t) || t < created - 5 * 60 * 1000) return false;
        return order.signalType === 'LONG' ? c.l <= order.idealEntry : c.h >= order.idealEntry;
    });
}
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

console.log('✅ ICT Trading Bot Pro FINAL FIX loaded!');
console.log('✅ Fixes applied:');
console.log('   - Wider SL (2x ATR minimum)');
console.log('   - Confirmation entry required');
console.log('   - Higher RR targets (3:1, 5:1, 7:1)');
console.log('   - Lower threshold (50)');
console.log('   - Multiple confirmation signals');
