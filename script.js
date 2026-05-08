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
    'BTC/USD':'BTC/USD','ETH/USD':'ETH/USD','BNB/USD':'BNB/USD','SOL/USD':'SOL/USD','XRP/USD':'XRP/USD',
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY','AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD','XPT/USD':'XPT/USD','XPD/USD':'XPD/USD'
};

const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day' };

// ============================================
// API KEYS MANAGEMENT
// ============================================
async function loadKeys() {
    const s = localStorage.getItem('ict_bot_keys');
    if (s) { try { const k = JSON.parse(s); TWELVE_DATA_KEY = k.twelveData||''; DEEPSEEK_API_KEY = k.deepseek||''; return true; } catch(e) {} }
    return false;
}
async function saveKeys(tk, dk) {
    localStorage.setItem('ict_bot_keys', JSON.stringify({twelveData:tk, deepseek:dk}));
    TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; updateKeyStatus();
}
function clearKeys() { localStorage.removeItem('ict_bot_keys'); TWELVE_DATA_KEY=''; DEEPSEEK_API_KEY=''; updateKeyStatus(); showNotif('🗑️ Keys removed','warning'); }
function updateKeyStatus() {
    const ts=document.getElementById('twelveStatus'),ds=document.getElementById('deepseekStatus');
    ts.innerHTML=TWELVE_DATA_KEY?'✅ Active':'❌ Missing'; ts.className='status-badge '+(TWELVE_DATA_KEY?'active':'inactive');
    ds.innerHTML=DEEPSEEK_API_KEY?'✅ Active ('+DEEPSEEK_API_KEY.substring(0,5)+'...)':'❌ Missing'; ds.className='status-badge '+(DEEPSEEK_API_KEY?'active':'inactive');
}
function showSetup() {
    const ex=document.getElementById('setupOverlay'); if(ex)ex.remove();
    document.body.insertAdjacentHTML('beforeend',`<div class="setup-overlay" id="setupOverlay"><div class="setup-modal"><h3>🔐 API Key Setup</h3><p class="setup-desc">Enter your API keys</p><label>📡 Twelve Data Key:</label><input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}"><label>🤖 DeepSeek Key:</label><input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}"><p class="setup-note">Get key from platform.deepseek.com</p><div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div><button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button><button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button><div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div></div></div>`);
    document.getElementById('svBtn').addEventListener('click',async()=>{const tk=document.getElementById('twInput').value.trim(),dk=document.getElementById('dsInput').value.trim();if(!tk){showNotif('⚠️ Twelve Data key required','warning');return;}await saveKeys(tk,dk);document.getElementById('setupOverlay').remove();});
    document.getElementById('clBtn').addEventListener('click',()=>{clearKeys();document.getElementById('twInput').value='';document.getElementById('dsInput').value='';});
    document.getElementById('testAiBtn').addEventListener('click',async()=>{const dk=document.getElementById('dsInput').value.trim();if(!dk){document.getElementById('testResult').innerHTML='❌ Enter key first';return;}document.getElementById('testResult').innerHTML='🔄 Testing...';try{const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});const d=await r.json();document.getElementById('testResult').innerHTML=d.choices?'✅ AI working!':'❌ Error: '+(d.error?.message||'Unknown');}catch(e){document.getElementById('testResult').innerHTML='❌ Connection failed';}});
    document.getElementById('skBtn').addEventListener('click',()=>document.getElementById('setupOverlay').remove());
}

// ============================================
// STATE
// ============================================
let pair='XAU/USD',tf='15M',analysis=null,calls=0,lastPrice=null,limitOrder=null,priceTimer=null;
document.addEventListener('DOMContentLoaded',async()=>{await loadKeys();updateKeyStatus();if(!TWELVE_DATA_KEY&&!DEEPSEEK_API_KEY)setTimeout(showSetup,500);init();});
function init(){updateTime();setInterval(updateTime,1000);document.getElementById('analyzeBtn').addEventListener('click',runAnalysis);document.getElementById('executeBtn').addEventListener('click',handleLimit);document.getElementById('cancelLimitBtn').addEventListener('click',cancelLimit);document.getElementById('copyJsonBtn').addEventListener('click',copyJson);document.getElementById('updateKeysBtn').addEventListener('click',showSetup);document.getElementById('pairSelect').addEventListener('change',e=>pair=e.target.value);document.querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.category-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');updatePairs(this.dataset.category);}));document.querySelectorAll('.tf-btn').forEach(b=>b.addEventListener('click',function(){document.querySelectorAll('.tf-btn').forEach(x=>x.classList.remove('active'));this.classList.add('active');tf=this.dataset.tf;}));loadLimitOrder();}
function updateTime(){const n=new Date();document.getElementById('liveTime').innerHTML=`${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
function updatePairs(cat){const p={crypto:['BTC/USD','ETH/USD'],forex:['EUR/USD','GBP/USD'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${x}</option>`).join('');pair=p[cat][0];}
function isGold(p){return p.includes('XAU');}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY'].includes(p);}
function getPrec(p){if(isGold(p))return 2;if(isForex(p))return 5;return 2;}

// ============================================
// API
// ============================================
async function getPrice(){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.price){calls++;document.getElementById('apiSource').innerHTML='📡 Live';return +d.price;}}catch(e){}return null;}
async function getHistory(tfStr=tf){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();}}catch(e){}return null;}

// ============================================
// TECHNICALS
// ============================================
const ema=(p,n)=>{const m=2/(n+1);let e=[p[0]];for(let i=1;i<p.length;i++)e.push((p[i]-e[i-1])*m+e[i-1]);return e;};
const rsi=(p,n=14)=>{let g=0,l=0;for(let i=p.length-n;i<p.length;i++){let c=p[i]-p[i-1];c>=0?g+=c:l-=c;}let ag=g/n,al=l/n;return al===0?100:100-(100/(1+ag/al));};
const atr=(d,n=14)=>{let t=[];for(let i=1;i<d.length;i++)t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));return t.slice(-n).reduce((a,b)=>a+b,0)/n;};

function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){
    if(d[i-1].h<d[i+1].l&&d[i+1].l-d[i-1].h>d[i+1].c*0.0005){let mitigated=false;for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){mitigated=true;break;}}f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!mitigated});}
    if(d[i-1].l>d[i+1].h&&d[i-1].l-d[i+1].h>d[i+1].c*0.0005){let mitigated=false;for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){mitigated=true;break;}}f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!mitigated});}
}return f;}

function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}

function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lastCandles=data.slice(-5);const bodies=lastCandles.map(c=>Math.abs(c.c-c.o));const avgBody=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lastBody=bodies[bodies.length-1];const isDisplacement=lastBody>avgBody*2;if(direction==='BUY'&&isDisplacement&&lastCandles[4].c>lastCandles[4].o)return{detected:true};if(direction==='SELL'&&isDisplacement&&lastCandles[4].c<lastCandles[4].o)return{detected:true};return{detected:false};}

async function check5MRejection(entryZone,direction){const d5m=await getHistory('5M');if(!d5m||d5m.length<3)return{confirmed:false};const lc=d5m[d5m.length-1];const body=Math.abs(lc.c-lc.o);const totalRange=lc.h-lc.l;if(direction==='BUY'){const lowerWick=Math.min(lc.o,lc.c)-lc.l;const touched=lc.l<=entryZone.h&&lc.l>=entryZone.l;if(touched&&lowerWick>body*1.5&&lc.c>lc.o)return{confirmed:true,strength:'strong'};if(touched&&lowerWick>body)return{confirmed:true,strength:'moderate'};}else{const upperWick=lc.h-Math.max(lc.o,lc.c);const touched=lc.h>=entryZone.l&&lc.h<=entryZone.h;if(touched&&upperWick>body*1.5&&lc.c<lc.o)return{confirmed:true,strength:'strong'};if(touched&&upperWick>body)return{confirmed:true,strength:'moderate'};}return{confirmed:false};}

function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles, expanding ranges'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal market conditions'};return{level:'Low - Consolidation',desc:'Tight ranges, potential breakout'};}

// ============================================
// PRECISION ENTRY ZONE (Confluence-Based)
// ============================================
function findPrecisionEntry(data, price, direction) {
    const a = atr(data, 14);
    const fvgs = detectFVG(data);
    const breakers = detectBreakers(data);
    const swings = findSwings(data, 4);
    
    let candidates = [];
    
    if (direction === 'BUY') {
        // Score each potential entry zone by confluence strength
        const allZones = [];
        
        // Add fresh bullish FVGs
        fvgs.filter(f => f.type==='bull' && f.l < price && f.fresh).forEach(f => {
            let score = 30; // Base score for fresh FVG
            let confluence = ['Fresh FVG'];
            
            // Check if FVG aligns with a breaker block
            const nearBreaker = breakers.find(b => b.type==='BULL' && Math.abs(b.p - f.l) < a * 0.5);
            if (nearBreaker) { score += 25; confluence.push('Breaker confluence'); }
            
            // Check if FVG aligns with a swing low
            const nearSwing = swings.L.find(s => Math.abs(s.p - f.l) < a * 0.3);
            if (nearSwing) { score += 20; confluence.push('Swing low confluence'); }
            
            // Check if this is a deep discount zone (OTE)
            const recentHigh = Math.max(...data.slice(-20).map(c=>c.h));
            const recentLow = Math.min(...data.slice(-20).map(c=>c.l));
            const range = recentHigh - recentLow;
            const oteLow = recentLow + range * 0.618;
            const oteHigh = recentLow + range * 0.79;
            if (f.l >= oteLow && f.l <= oteHigh) { score += 15; confluence.push('OTE zone'); }
            
            // Closer to current price = more likely to fill
            const distance = (price - f.l) / price * 100;
            if (distance < 0.5) score += 10;
            if (distance < 0.3) score += 5;
            
            allZones.push({
                p: f.l, // Entry at FVG EDGE for precision
                l: f.l, h: f.h,
                src: 'FVG',
                score,
                confluence: confluence.join(' + '),
                quality: score >= 60 ? 'HIGH' : (score >= 45 ? 'MEDIUM' : 'LOW')
            });
        });
        
        // Add breaker blocks near FVGs
        breakers.filter(b => b.type==='BULL' && b.p < price).forEach(b => {
            const nearFVG = fvgs.find(f => f.type==='bull' && f.l < price && Math.abs(f.l - b.p) < a * 0.5);
            if (nearFVG) return; // Already covered by FVG+breaker combo
            allZones.push({
                p: b.p, l: b.p - a * 0.3, h: b.p + a * 0.3,
                src: 'Breaker',
                score: 35,
                confluence: 'Breaker block',
                quality: 'MEDIUM'
            });
        });
        
        // Sort by score (highest first)
        allZones.sort((x, y) => y.score - x.score);
        
        if (allZones.length > 0) {
            const best = allZones[0];
            return {
                p: best.p, l: best.l, h: best.h,
                src: best.src,
                confluence: best.confluence,
                quality: best.quality,
                score: best.score
            };
        }
        
        // Fallback: OTE zone
        const rH = Math.max(...data.slice(-20).map(c=>c.h));
        const rL = Math.min(...data.slice(-20).map(c=>c.l));
        const r = rH - rL;
        const oL = rL + r * 0.618, oH = rL + r * 0.79;
        return { p: (oL + oH) / 2, l: oL, h: oH, src: 'OTE', confluence: 'OTE Zone', quality: 'LOW', score: 20 };
        
    } else {
        // SELL direction
        const allZones = [];
        
        fvgs.filter(f => f.type==='bear' && f.h > price && f.fresh).forEach(f => {
            let score = 30;
            let confluence = ['Fresh FVG'];
            
            const nearBreaker = breakers.find(b => b.type==='BEAR' && Math.abs(b.p - f.h) < a * 0.5);
            if (nearBreaker) { score += 25; confluence.push('Breaker confluence'); }
            
            const nearSwing = swings.H.find(s => Math.abs(s.p - f.h) < a * 0.3);
            if (nearSwing) { score += 20; confluence.push('Swing high confluence'); }
            
            const rH = Math.max(...data.slice(-20).map(c=>c.h));
            const rL = Math.min(...data.slice(-20).map(c=>c.l));
            const r = rH - rL;
            const oL = rH - r * 0.79, oH = rH - r * 0.618;
            if (f.h >= oL && f.h <= oH) { score += 15; confluence.push('OTE zone'); }
            
            const distance = (f.h - price) / price * 100;
            if (distance < 0.5) score += 10;
            if (distance < 0.3) score += 5;
            
            allZones.push({
                p: f.h, l: f.l, h: f.h,
                src: 'FVG',
                score,
                confluence: confluence.join(' + '),
                quality: score >= 60 ? 'HIGH' : (score >= 45 ? 'MEDIUM' : 'LOW')
            });
        });
        
        breakers.filter(b => b.type==='BEAR' && b.p > price).forEach(b => {
            const nearFVG = fvgs.find(f => f.type==='bear' && f.h > price && Math.abs(f.h - b.p) < a * 0.5);
            if (nearFVG) return;
            allZones.push({
                p: b.p, l: b.p - a * 0.3, h: b.p + a * 0.3,
                src: 'Breaker',
                score: 35,
                confluence: 'Breaker block',
                quality: 'MEDIUM'
            });
        });
        
        allZones.sort((x, y) => y.score - x.score);
        
        if (allZones.length > 0) {
            const best = allZones[0];
            return {
                p: best.p, l: best.l, h: best.h,
                src: best.src,
                confluence: best.confluence,
                quality: best.quality,
                score: best.score
            };
        }
        
        const rH = Math.max(...data.slice(-20).map(c=>c.h));
        const rL = Math.min(...data.slice(-20).map(c=>c.l));
        const r = rH - rL;
        const oL = rH - r * 0.79, oH = rH - r * 0.618;
        return { p: (oL + oH) / 2, l: oL, h: oH, src: 'OTE', confluence: 'OTE Zone', quality: 'LOW', score: 20 };
    }
}

// ============================================
// STOP LOSS (Tighter for high-quality zones)
// ============================================
function getSLBuffer(atrValue, zoneQuality) {
    // Tighter stops for higher quality zones
    const qualityMultiplier = zoneQuality === 'HIGH' ? 0.6 : (zoneQuality === 'MEDIUM' ? 0.8 : 1.0);
    const buffers = {'XAU/USD':{'5M':4,'15M':6,'1H':10,'4H':15}};
    const base = (buffers['XAU/USD'] && buffers['XAU/USD'][tf]) ? buffers['XAU/USD'][tf] : Math.max(atrValue*1.5,15);
    return Math.max(base * qualityMultiplier, isGold(pair) ? 3 : 0.0003);
}

function calcStopLoss(data, dir, entry, zone, zoneQuality) {
    const a = atr(data,14), swings = findSwings(data,4), fvgs = detectFVG(data);
    const minBuffer = getSLBuffer(a, zoneQuality);
    const maxSLP = 0.008, maxSLD = entry * maxSLP;
    
    if (dir === 'BUY') {
        const allSwings = swings.L.filter(s=>s.p<entry).sort((a,b)=>b.p-a.p);
        const bullFVGs = fvgs.filter(f=>f.type==='bull'&&f.l<entry).sort((a,b)=>b.l-a.l);
        let sp=null,sr='';
        for(const s of allSwings){const d=entry-s.p;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=s.p-minBuffer*0.2;sr=`Below swing $${s.p.toFixed(getPrec(pair))}`;break;}}
        if(!sp&&bullFVGs.length){const d=entry-bullFVGs[0].l;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=bullFVGs[0].l-minBuffer*0.15;sr='Below FVG';}}
        if(!sp){sp=entry-minBuffer;sr='ATR buffer';}
        if(entry-sp<minBuffer*0.5){sp=entry-minBuffer;sr='Min ATR';}
        if(entry-sp>maxSLD){sp=entry-maxSLD;sr='Capped';}
        return{price:sp,reason:sr,distance:entry-sp};
    } else {
        const allSwings = swings.H.filter(s=>s.p>entry).sort((a,b)=>a.p-b.p);
        const bearFVGs = fvgs.filter(f=>f.type==='bear'&&f.h>entry).sort((a,b)=>a.h-b.h);
        let sp=null,sr='';
        for(const s of allSwings){const d=s.p-entry;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=s.p+minBuffer*0.2;sr=`Above swing $${s.p.toFixed(getPrec(pair))}`;break;}}
        if(!sp&&bearFVGs.length){const d=bearFVGs[0].h-entry;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=bearFVGs[0].h+minBuffer*0.15;sr='Above FVG';}}
        if(!sp){sp=entry+minBuffer;sr='ATR buffer';}
        if(sp-entry<minBuffer*0.5){sp=entry+minBuffer;sr='Min ATR';}
        if(sp-entry>maxSLD){sp=entry+maxSLD;sr='Capped';}
        return{price:sp,reason:sr,distance:sp-entry};
    }
}

// ============================================
// SCORING
// ============================================
function score(data,price){const a=atr(data),cl=data.map(c=>c.c),rs=rsi(cl);const fv=detectFVG(data),ms=detectMSS(data),bk=detectBreakers(data);const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1];const bF=fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);const sF=fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);const bB=bk.filter(b=>b.type==='BULL'&&b.p<price);const sB=bk.filter(b=>b.type==='BEAR'&&b.p>price);let bS=0,sS=0,bR=[],sR=[];if(ms?.type==='BULL'){bS+=20;bR.push('MSS Bull');}else if(ms?.type==='BEAR'){sS+=20;sR.push('MSS Bear');}if(bF.length){bS+=15;bR.push('Bull FVG');}if(sF.length){sS+=15;sR.push('Bear FVG');}if(bB.length){bS+=10;bR.push('Bull breaker');}if(sB.length){sS+=10;sR.push('Bear breaker');}if(cE20>cE50){bS+=15;bR.push('EMA bull');}else{sS+=15;sR.push('EMA bear');}if(rs>50)bS+=10;else sS+=10;let dir,conf,reason;if(bS>sS){dir='BUY';conf=Math.min(bS+15,95);reason=bR.join('; ');}else if(sS>bS){dir='SELL';conf=Math.min(sS+15,95);reason=sR.join('; ');}else{dir=cE20>cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';}return{dir,conf,reason,scores:{bS,sS}};}

// ============================================
// MULTI-TF
// ============================================
async function getMTFInfo(){const tfs=['5M','15M','1H','4H'];let bullCount=0,bearCount=0;const trends={};for(let t of tfs){let d=await getHistory(t);if(!d||d.length<30)continue;let c=d.map(x=>x.c),tr=c[c.length-1]>c[c.length-20]?'BULLISH':(c[c.length-1]<c[c.length-20]?'BEARISH':'NEUTRAL');trends[t]=tr;if(tr==='BULLISH')bullCount++;else if(tr==='BEARISH')bearCount++;let el=document.getElementById(`trend${t}`);if(el){el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut');el.className=`mtf-trend ${tr.toLowerCase()}`;}}return{direction:bullCount>bearCount?'BULLISH':(bearCount>bullCount?'BEARISH':'NEUTRAL'),strength:Math.max(bullCount,bearCount),bullCount,bearCount,trends};}

// ============================================
// AI - GHOST MACHINE STYLE
// ============================================
async function askAI(marketData){if(!DEEPSEEK_API_KEY)return null;showNotif('🤖 Ghost AI...','info');const prompt=`You are TheGhostMachine - elite ICT sniper. Find the CLEANEST precision entry.

${pair} ${tf} $${marketData.price}
MTF:5M=${marketData.mtf5} 15M=${marketData.mtf15} 1H=${marketData.mtf1h} 4H=${marketData.mtf4h}
Direction:${marketData.direction}
Zone:${marketData.zoneSrc} $${marketData.entryPrice} [$${marketData.zoneLow}-$${marketData.zoneHigh}]
Confluence:${marketData.confluence} | Quality:${marketData.zoneQuality}
SL Suggestion:$${marketData.suggestedSL}

Return JSON:
{"signal":"BUY/SELL","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit":#,"analysis":{"trend_detection":"...","volatility_level":"${marketData.volatility}","technical_indicators":["..."],"possible_outcomes":["..."]}}`;try{const r=await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are TheGhostMachine. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:800})});const d=await r.json();if(d.choices?.[0]){const m=d.choices[0].message.content.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);}}catch(e){}return null;}

// ============================================
// MAIN
// ============================================
async function runAnalysis(){const btn=document.getElementById('analyzeBtn');btn.classList.add('loading');btn.disabled=true;if(!TWELVE_DATA_KEY){showNotif('⚠️ Set Twelve Data key!','error');btn.classList.remove('loading');btn.disabled=false;return;}showNotif('🔍 Precision scanning...','info');try{const price=await getPrice();if(!price)throw new Error('No price');const mtf=await getMTFInfo();const data=await getHistory();if(!data?.length)throw new Error('No data');const sig=score(data,price);const zone=findPrecisionEntry(data,price,sig.dir);const a=atr(data,14);const slResult=calcStopLoss(data,sig.dir,zone.p,zone,zone.quality);const displacement=detectDisplacement(data,sig.dir);const rejection5M=await check5MRejection(zone,sig.dir);const volatility=getVolatilityLevel(a,price);let conf=sig.conf;if(mtf.direction==='BULLISH'&&sig.dir==='BUY')conf=Math.min(conf+10,95);if(mtf.direction==='BEARISH'&&sig.dir==='SELL')conf=Math.min(conf+10,95);if(mtf.direction==='BULLISH'&&sig.dir==='SELL')conf=Math.max(conf-15,35);if(mtf.direction==='BEARISH'&&sig.dir==='BUY')conf=Math.max(conf-15,35);if(zone.quality==='HIGH')conf=Math.min(conf+10,98);if(rejection5M.confirmed)conf=Math.min(conf+5,98);const marketData={price:price.toFixed(2),mtf5:mtf.trends['5M']||'--',mtf15:mtf.trends['15M']||'--',mtf1h:mtf.trends['1H']||'--',mtf4h:mtf.trends['4H']||'--',direction:sig.dir,zoneSrc:zone.src,entryPrice:zone.p.toFixed(2),zoneLow:zone.l.toFixed(2),zoneHigh:zone.h.toFixed(2),confluence:zone.confluence,zoneQuality:zone.quality,suggestedSL:slResult.price.toFixed(2),volatility:volatility.level};const ai=await askAI(marketData);let dir,entry,sl,tp1,tp2,tp3,reason,src;if(ai&&ai.signal){dir=ai.signal;conf=ai.confidence||conf;entry=ai.entryPrice||zone.p;sl=ai.stopLoss||slResult.price;const tp=ai.takeProfit||(dir==='BUY'?entry+Math.abs(entry-sl)*3:entry-Math.abs(entry-sl)*3);tp1=tp;tp2=dir==='BUY'?entry+Math.abs(entry-sl)*5:entry-Math.abs(entry-sl)*5;tp3=dir==='BUY'?entry+Math.abs(entry-sl)*8:entry-Math.abs(entry-sl)*8;reason='🤖 '+(ai.analysis?.trend_detection||'AI signal');src='AI';}else{dir=sig.dir;entry=zone.p;sl=slResult.price;const risk=Math.abs(entry-sl);tp1=dir==='BUY'?entry+risk*3:entry-risk*3;tp2=dir==='BUY'?entry+risk*5:entry-risk*5;tp3=dir==='BUY'?entry+risk*8:entry-risk*8;reason=sig.reason+' | '+zone.confluence+' ['+zone.quality+']';src=zone.src;}const st=dir==='BUY'?'LONG':'SHORT';const prec=getPrec(pair);const slDist=Math.abs(entry-sl);const rr=(Math.abs(tp1-entry)/slDist).toFixed(1);document.getElementById('currentPrice').innerHTML=`$${price.toFixed(prec)}`;if(lastPrice){const ch=((price-lastPrice)/lastPrice*100).toFixed(2);const ce=document.getElementById('priceChange');ce.innerHTML=`${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;ce.className=`price-change ${ch>=0?'up':'down'}`;}lastPrice=price;const out={trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:dir==='BUY'?'BUY-LIMIT':'SELL-LIMIT',entry_price:entry,stop_loss:sl,stop_loss_distance:slDist.toFixed(2),stop_loss_pct:((slDist/entry)*100).toFixed(2)+'%',take_profit_1:tp1,take_profit_2:tp2,take_profit_3:tp3,risk_reward:rr,confidence:conf,entry_source:src,ai_used:src==='AI',entry_quality:zone.quality,confluence:zone.confluence,analysis:{trend_detection:`${mtf.direction} (${mtf.strength}/4 TFs). MSS: ${detectMSS(data)?.type||'None'}. ${sig.dir==='BUY'?'Higher low expected':'Lower high expected'}`,volatility_level:`${volatility.level} - ${volatility.desc}`,technical_indicators:[`${zone.src} at $${zone.l.toFixed(2)}-$${zone.h.toFixed(2)} (${zone.quality} quality, ${zone.confluence})`,`RSI: ${rsi(data.map(c=>c.c),14).toFixed(1)}`,`Displacement: ${displacement.detected?'✅ Detected':'❌ None'}`,`5M Rejection: ${rejection5M.confirmed?'✅ '+rejection5M.strength:'⚠️ Pending'}`],possible_outcomes:[`${dir==='BUY'?'Bullish':'Bearish'}: Price enters zone at $${entry.toFixed(2)} and reverses toward $${tp1.toFixed(2)}`,`Liquidity sweep: Brief break below/above zone to sweep stops before reversing`,`Invalidation: Close beyond $${sl.toFixed(2)} invalidates setup`],reasoning:reason}}};document.getElementById('jsonOutput').innerHTML=JSON.stringify(out,null,2);analysis={signalType:st,idealEntry:entry,currentPrice:price,stopLoss:sl,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,confidence:conf};document.getElementById('executeBtn').disabled=false;showNotif(`✅ ${st} ${conf}% | ${zone.quality} quality | SL: $${slDist.toFixed(1)}`,'success');}catch(e){console.error(e);showNotif('Error: '+e.message,'error');}finally{btn.classList.remove('loading');btn.disabled=false;}}

// ============================================
// LIMIT ORDERS
// ============================================
function loadLimitOrder(){const s=localStorage.getItem('limitOrder');if(s){try{limitOrder=JSON.parse(s);updateLimitUI();startMonitor();}catch(e){}}}
function saveLimit(o){limitOrder=o;localStorage.setItem('limitOrder',JSON.stringify(o));updateLimitUI();}
function clearLimit(){limitOrder=null;localStorage.removeItem('limitOrder');if(priceTimer)clearInterval(priceTimer);updateLimitUI();}
function cancelLimit(){clearLimit();showNotif('❌ Cancelled','warning');}
function updateLimitUI(){const t=document.getElementById('limitOrderText'),c=document.getElementById('cancelLimitBtn');if(limitOrder){const prec=getPrec(pair);t.innerHTML=`⏳ ${limitOrder.signalType} LIMIT @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}`;t.className='active';c.classList.remove('hidden');document.getElementById('executeBtn').innerHTML='⏳ Waiting...';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)';}else{t.innerHTML='No active limit order';t.className='';c.classList.add('hidden');document.getElementById('executeBtn').innerHTML='⚡ Place Limit Order';document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)';}}
function startMonitor(){if(priceTimer)clearInterval(priceTimer);priceTimer=setInterval(async()=>{if(!limitOrder){clearInterval(priceTimer);return;}const p=await getPrice();if(!p)return;const prec=getPrec(pair);document.getElementById('currentPrice').innerHTML=`$${p.toFixed(prec)}`;if((limitOrder.signalType==='LONG'&&p<=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT'&&p>=limitOrder.idealEntry)){clearLimit();showNotif(`✅ FILLED! ${limitOrder.signalType} @ $${p.toFixed(prec)}`,'success');try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){}}},2000);}
function handleLimit(){if(!analysis||analysis.signalType==='NEUTRAL'){showNotif('No signal','error');return;}if(limitOrder){cancelLimit();return;}const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry,stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,createdAt:new Date().toISOString()};saveLimit(o);startMonitor();showNotif(`📝 Limit @ $${o.idealEntry.toFixed(getPrec(pair))}`,'info');}
function copyJson(){const t=document.getElementById('jsonOutput').innerHTML;if(t.includes('Click')){showNotif('Run analysis first','warning');return;}navigator.clipboard.writeText(t).then(()=>showNotif('📋 Copied!','success')).catch(()=>showNotif('Failed','error'));}
function showNotif(m,t){const n=document.getElementById('notification');n.innerHTML=m;n.className=`notification ${t}`;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3000);}
