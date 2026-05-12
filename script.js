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

const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day' };

// ============================================
// MARKET SETTINGS
// ============================================
function getMarketSettings(p) {
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2 };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.05, maxSLPct: 0.01, targetRR: 4, prec: 2 };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.15, maxSLPct: 0.005, targetRR: 4, prec: 3 };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 50, maxSLPct: 0.015, targetRR: 4, prec: 2 };
    return { slBuffer: 0.0005, minSL: 0.0005, maxSLPct: 0.005, targetRR: 4, prec: 5 };
}

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
function updatePairs(cat){const p={crypto:['BTC/USD'],forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],metals:['XAU/USD','XAG/USD']};document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');pair=p[cat][0];}
function getPairDisplayName(p){const icons={'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY','AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD','EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY','XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'};return icons[p]||'📊 '+p;}
function isGold(p){return p.includes('XAU');}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
function getPrec(p){const s=getMarketSettings(p);return s.prec;}

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

// ============================================
// LIQUIDITY SWEEP DETECTION
// ============================================
function detectLiquiditySweeps(data, currentPrice) {
    const sweeps = [];
    const highs = data.map(c => c.h), lows = data.map(c => c.l), closes = data.map(c => c.c);
    const a = atr(data, 14), maxDistance = a * 3;
    for (let i = 10; i < data.length - 3; i++) {
        const recentHighs = highs.slice(i-5, i); const maxHigh = Math.max(...recentHighs);
        const tolerance = maxHigh * 0.001;
        if (recentHighs.filter(h => Math.abs(h - maxHigh) <= tolerance).length >= 2 && Math.abs(maxHigh - currentPrice) <= maxDistance) {
            if (data.slice(i, i+4).some(c => c.h > maxHigh + tolerance) && closes[i+3] < maxHigh)
                sweeps.push({type:'BUY_SIDE',level:maxHigh,distance:Math.abs(maxHigh-currentPrice),direction:'BEARISH'});
        }
        const recentLows = lows.slice(i-5, i); const minLow = Math.min(...recentLows);
        const lowTolerance = minLow * 0.001;
        if (recentLows.filter(l => Math.abs(l - minLow) <= lowTolerance).length >= 2 && Math.abs(minLow - currentPrice) <= maxDistance) {
            if (data.slice(i, i+4).some(c => c.l < minLow - lowTolerance) && closes[i+3] > minLow)
                sweeps.push({type:'SELL_SIDE',level:minLow,distance:Math.abs(minLow-currentPrice),direction:'BULLISH'});
        }
    }
    return sweeps.sort((a,b) => a.distance - b.distance);
}

// ============================================
// IMBALANCE DETECTION
// ============================================
function findImbalances(data) {
    const imbalances = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (data[i-1].l > data[i+1].h) imbalances.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l,message:'Bullish imbalance'});
        if (data[i-1].h < data[i+1].l) imbalances.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l,message:'Bearish imbalance'});
    }
    return imbalances.slice(-5);
}

function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){if(d[i-1].h<d[i+1].l&&d[i+1].l-d[i-1].h>d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){m=true;break;}}f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!m});}if(d[i-1].l>d[i+1].h&&d[i-1].l-d[i+1].h>d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){m=true;break;}}f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!m});}}return f;}
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}
function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY'&&lb>avg*2.5&&lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL'&&lb>avg*2.5&&lc[4].c<lc[4].o)return{detected:true};return{detected:false};}
async function check5MRejection(zone,direction){const d5m=await getHistory('5M');if(!d5m||d5m.length<3)return{confirmed:false};const lc=d5m[d5m.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.h&&lc.l>=zone.l;if(t&&wick>body*2&&lc.c>lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.l&&lc.h<=zone.h;if(t&&wick>body*2&&lc.c<lc.o)return{confirmed:true};}return{confirmed:false};}
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles, expanding ranges'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal market conditions'};return{level:'Low - Consolidation',desc:'Tight ranges, potential breakout'};}

// ============================================
// MSNR LEVELS
// ============================================
function calculateMSNR(data, currentPrice) {
    const highs = data.map(c => c.h), lows = data.map(c => c.l), closes = data.map(c => c.c);
    const period = Math.min(data.length, 20);
    const recentHigh = Math.max(...highs.slice(-period));
    const recentLow = Math.min(...lows.slice(-period));
    const recentClose = closes[closes.length - 1];
    const pp = (recentHigh + recentLow + recentClose) / 3;
    const s1 = pp * 2 - recentHigh, s2 = pp - (recentHigh - recentLow), s3 = recentLow - 2 * (recentHigh - pp);
    const r1 = pp * 2 - recentLow, r2 = pp + (recentHigh - recentLow), r3 = recentHigh + 2 * (pp - recentLow);
    const ms1 = (s1 + s2) / 2, ms2 = (pp + s1) / 2, mr1 = (r1 + r2) / 2, mr2 = (pp + r1) / 2;
    const allSupports = [s1, ms2, ms1, s2, s3].filter(s => s < currentPrice).sort((a,b) => b - a);
    const allResistances = [r1, mr2, mr1, r2, r3].filter(r => r > currentPrice).sort((a,b) => a - b);
    return {pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allSupports[0]||null,nearestResistance:allResistances[0]||null,allSupports,allResistances};
}

// ============================================
// PRECISION ENTRY ZONE
// ============================================
function findPrecisionEntry(data, price, direction, msnr) {
    const a = atr(data,14), fvgs = detectFVG(data), breakers = detectBreakers(data), swings = findSwings(data,4);
    let allZones = [];
    if (direction === 'BUY') {
        fvgs.filter(f => f.type==='bull' && f.l < price && f.fresh).forEach(f => {
            let score = 30; let cf = ['Fresh FVG'];
            if(breakers.find(b=>b.type==='BULL'&&Math.abs(b.p-f.l)<a*0.5)){score+=25;cf.push('Breaker');}
            if(swings.L.find(s=>Math.abs(s.p-f.l)<a*0.3)){score+=20;cf.push('Swing');}
            if(msnr.nearestSupport&&Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){score+=20;cf.push('MSNR');}
            const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
            if(f.l>=rL+r*.618&&f.l<=rL+r*.79){score+=15;cf.push('OTE');}
            const distPct=(price-f.l)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:f.l,l:f.l,h:f.h,src:'FVG',score,confluence:cf.join('+'),confluenceCount:cf.length,quality:score>=70?'A':(score>=55?'B':'C')});
        });
        if(msnr.nearestSupport&&msnr.nearestSupport<price){
            let score=25;let cf=['MSNR'];
            if(fvgs.find(f=>f.type==='bull'&&Math.abs(f.l-msnr.nearestSupport)<msnr.nearestSupport*0.003)){score+=25;cf.push('FVG');}
            if(swings.L.find(s=>Math.abs(s.p-msnr.nearestSupport)<msnr.nearestSupport*0.003)){score+=20;cf.push('Swing');}
            const distPct=(price-msnr.nearestSupport)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:msnr.nearestSupport,l:msnr.nearestSupport*0.998,h:msnr.nearestSupport*1.002,src:'MSNR',score,confluence:cf.join('+'),confluenceCount:cf.length,quality:score>=60?'A':(score>=45?'B':'C')});
        }
    } else {
        fvgs.filter(f => f.type==='bear' && f.h > price && f.fresh).forEach(f => {
            let score = 30; let cf = ['Fresh FVG'];
            if(breakers.find(b=>b.type==='BEAR'&&Math.abs(b.p-f.h)<a*0.5)){score+=25;cf.push('Breaker');}
            if(swings.H.find(s=>Math.abs(s.p-f.h)<a*0.3)){score+=20;cf.push('Swing');}
            if(msnr.nearestResistance&&Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){score+=20;cf.push('MSNR');}
            const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
            if(f.h>=rH-r*.79&&f.h<=rH-r*.618){score+=15;cf.push('OTE');}
            const distPct=(f.h-price)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:f.h,l:f.l,h:f.h,src:'FVG',score,confluence:cf.join('+'),confluenceCount:cf.length,quality:score>=70?'A':(score>=55?'B':'C')});
        });
        if(msnr.nearestResistance&&msnr.nearestResistance>price){
            let score=25;let cf=['MSNR'];
            if(fvgs.find(f=>f.type==='bear'&&Math.abs(f.h-msnr.nearestResistance)<msnr.nearestResistance*0.003)){score+=25;cf.push('FVG');}
            if(swings.H.find(s=>Math.abs(s.p-msnr.nearestResistance)<msnr.nearestResistance*0.003)){score+=20;cf.push('Swing');}
            const distPct=(msnr.nearestResistance-price)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:msnr.nearestResistance,l:msnr.nearestResistance*0.998,h:msnr.nearestResistance*1.002,src:'MSNR',score,confluence:cf.join('+'),confluenceCount:cf.length,quality:score>=60?'A':(score>=45?'B':'C')});
        }
    }
    allZones.sort((x,y)=>y.score-x.score);
    if(allZones.length>0){const b=allZones[0];return{p:b.p,l:b.l,h:b.h,src:b.src,confluence:b.confluence,confluenceCount:b.confluenceCount,quality:b.quality,score:b.score};}
    const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
    if(direction==='BUY'){const oL=rL+r*.618,oH=rL+r*.79;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE',confluenceCount:1,quality:'C',score:20};}
    else{const oL=rH-r*.79,oH=rH-r*.618;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE',confluenceCount:1,quality:'C',score:20};}
}

// ============================================
// STABLE PROBABILITY CHECK
// ============================================
function checkProbability(zone, mtf) {
    const checks = [];
    const hasConfluence = zone.confluenceCount >= 2;
    checks.push({name:'Confluence (2+)', passed:hasConfluence, critical:true});
    const mtfAligned = mtf.strength >= 2;
    checks.push({name:'MTF aligned (2+)', passed:mtfAligned, critical:true});
    const goodQuality = zone.quality === 'A' || zone.quality === 'B';
    checks.push({name:'Quality A/B', passed:goodQuality, critical:false});
    const criticalPassed = checks.filter(c=>c.critical).every(c=>c.passed);
    const totalPassed = checks.filter(c=>c.passed).length;
    const probability = criticalPassed ? (totalPassed >= 3 ? 'HIGH' : 'MEDIUM') : 'LOW';
    return {probability, checks, totalPassed, passed: criticalPassed};
}

// ============================================
// STOP LOSS
// ============================================
function calcStopLoss(data, dir, entry, zone, msnr) {
    const a = atr(data,14), swings = findSwings(data,4), fvgs = detectFVG(data);
    const settings = getMarketSettings(pair);
    const maxSLD = entry * settings.maxSLPct;
    if (dir === 'BUY') {
        let candidates = [];
        if (msnr && msnr.allSupports) { const mb = msnr.allSupports.filter(s => s < entry).sort((a,b) => b - a); if (mb.length > 0) { const sl = mb[0] - settings.slBuffer; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Below MSNR',distance:dist}); } }
        if (zone && zone.l < entry) { const sl = zone.l - settings.slBuffer*0.7; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Below zone',distance:dist}); }
        const sL = swings.L.filter(s => s.p < entry).sort((a,b) => b.p - a.p);
        if (sL.length > 0) { const sl = sL[0].p - settings.slBuffer; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Below swing',distance:dist}); }
        const bF = fvgs.filter(f => f.type==='bull' && f.l < entry).sort((a,b) => b.l - a.l);
        if (bF.length > 0) { const sl = bF[0].l - settings.slBuffer*0.7; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Below FVG',distance:dist}); }
        candidates.sort((a,b) => a.distance - b.distance);
        if (candidates.length > 0) { const best = candidates[0]; if(best.distance <= maxSLD) return {price:best.price, reason:best.reason, distance:best.distance}; }
        const sl = entry - Math.max(a*0.5, settings.minSL);
        return {price:sl, reason:'Min ATR', distance:entry-sl};
    } else {
        let candidates = [];
        if (msnr && msnr.allResistances) { const ma = msnr.allResistances.filter(r => r > entry).sort((a,b) => a - b); if (ma.length > 0) { const sl = ma[0] + settings.slBuffer; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Above MSNR',distance:dist}); } }
        if (zone && zone.h > entry) { const sl = zone.h + settings.slBuffer*0.7; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Above zone',distance:dist}); }
        const sH = swings.H.filter(s => s.p > entry).sort((a,b) => a.p - b.p);
        if (sH.length > 0) { const sl = sH[0].p + settings.slBuffer; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Above swing',distance:dist}); }
        const sF = fvgs.filter(f => f.type==='bear' && f.h > entry).sort((a,b) => a.h - b.h);
        if (sF.length > 0) { const sl = sF[0].h + settings.slBuffer*0.7; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:'Above FVG',distance:dist}); }
        candidates.sort((a,b) => a.distance - b.distance);
        if (candidates.length > 0) { const best = candidates[0]; if(best.distance <= maxSLD) return {price:best.price, reason:best.reason, distance:best.distance}; }
        const sl = entry + Math.max(a*0.5, settings.minSL);
        return {price:sl, reason:'Min ATR', distance:sl-entry};
    }
}

// ============================================
// TAKE PROFIT
// ============================================
function calcTakeProfits(dir, entry, sl) {
    const risk = Math.abs(entry - sl);
    const settings = getMarketSettings(pair);
    const rr = settings.targetRR;
    return {
        tp1: dir==='BUY'?entry+risk*rr:entry-risk*rr,
        tp2: dir==='BUY'?entry+risk*(rr+1):entry-risk*(rr+1),
        tp3: dir==='BUY'?entry+risk*(rr+2):entry-risk*(rr+2)
    };
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
// ADVANCED AI - GHOST MACHINE LOGIC
// ============================================
async function askAI(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotif('🤖 Ghost AI analyzing...','info');
    
    const prompt = `You are TheGhostMachine - an elite ICT (Inner Circle Trader) and Smart Money Concepts sniper. Analyze this complete market data and provide a HIGH-PROBABILITY trading signal.

MARKET CONTEXT:
- Pair: ${pair}
- Timeframe: ${tf}
- Current Price: $${marketData.price}
- Date: ${new Date().toISOString().split('T')[0]}

TREND DETECTION:
- Multi-Timeframe: ${marketData.mtfDir} (${marketData.mtfStr}/4 timeframes agree)
- 5M: ${marketData.mtf5} | 15M: ${marketData.mtf15} | 1H: ${marketData.mtf1h} | 4H: ${marketData.mtf4h}
- Market Structure Shift (MSS): ${marketData.mss}
- Trend Strength: ${marketData.mtfStr >= 3 ? 'STRONG' : (marketData.mtfStr >= 2 ? 'MODERATE' : 'WEAK')}

VOLATILITY ANALYSIS:
- ATR: ${marketData.atr}
- Volatility Level: ${marketData.volatility}
- ${marketData.volatilityDesc}

TECHNICAL INDICATORS:
- RSI (14): ${marketData.rsi}
- EMA20: ${marketData.ema20} | EMA50: ${marketData.ema50}
- FVG Count: ${marketData.fvgCount} (Fresh: ${marketData.freshFvg})
- Breaker Blocks: ${marketData.breakerCount}
- Displacement: ${marketData.displacement}
- 5M Rejection: ${marketData.rejection5M}

LIQUIDITY & IMBALANCES:
- Sweeps Detected: ${marketData.sweeps}
- Imbalances: ${marketData.imbalances}

ENTRY ANALYSIS:
- Zone Type: ${marketData.zoneSrc}
- Zone Quality: ${marketData.zoneQuality} (A=Best, B=Good, C=Basic)
- Entry Price: $${marketData.entryPrice}
- Zone Range: $${marketData.zoneLow} - $${marketData.zoneHigh}
- Confluence: ${marketData.zoneConfluence}
- Probability: ${marketData.probability}

MSNR LEVELS:
- Pivot: $${marketData.msnrPivot}
- S1: $${marketData.msnrS1} | S2: $${marketData.msnrS2} | S3: $${marketData.msnrS3}
- R1: $${marketData.msnrR1} | R2: $${marketData.msnrR2} | R3: $${marketData.msnrR3}
- Nearest Support: $${marketData.nearestSupport}
- Nearest Resistance: $${marketData.nearestResistance}

SUGGESTED LEVELS:
- Suggested Stop Loss: $${marketData.suggestedSL} (${marketData.slReason})
- Target RR: 1:${marketData.targetRR}

CRITICAL RULES:
1. ONLY trade in the direction of the STRONG trend (3+ TFs). If MTF is weak (<2 TFs), cap confidence at 50%.
2. Entry MUST be at a zone with 2+ confluences (FVG+MSNR, FVG+Breaker, etc.)
3. Stop loss must be LOGICAL and TIGHT - beyond the nearest swing/zone boundary.
4. Take profit at 1:4, 1:5, 1:6 risk-reward minimum.
5. If sweeps support the direction, increase confidence. If sweeps oppose, reduce.
6. If displacement is detected, this is HIGHEST probability.
7. NEVER give BUY when 3+ TFs are BEARISH, and vice versa.

POSSIBLE OUTCOMES:
1. Price enters the zone and reverses toward TP (base case)
2. Price sweeps liquidity at the zone then reverses (inducement)
3. Price breaks through zone and hits SL (invalidation)

Return ONLY this JSON structure:
{
    "signal": "${marketData.mtfStr >= 3 ? (marketData.mtfDir === 'BULLISH' ? 'BUY' : 'SELL') : (marketData.mtfDir === 'BULLISH' ? 'BUY' : 'SELL')}",
    "confidence": 0-100,
    "entryPrice": ${marketData.entryPrice},
    "stopLoss": ${marketData.suggestedSL},
    "takeProfit1": ${marketData.entryPrice * (marketData.mtfDir === 'BULLISH' ? 1.02 : 0.98)},
    "takeProfit2": ${marketData.entryPrice * (marketData.mtfDir === 'BULLISH' ? 1.03 : 0.97)},
    "takeProfit3": ${marketData.entryPrice * (marketData.mtfDir === 'BULLISH' ? 1.04 : 0.96)},
    "entryReasoning": "Why this exact entry zone was chosen (mention FVG/OTE/Breaker/MSNR confluence)",
    "slReasoning": "Why stop loss is placed here (mention swing/zone/structure)",
    "conviction": "HIGH/MEDIUM/LOW - based on confluence strength and MTF alignment",
    "possibleOutcomes": [
        "Primary: description of what should happen",
        "Alternative: description of inducement scenario",
        "Invalidation: description of what invalidates the trade"
    ]
}`;

    try {
        const r = await fetch(DEEPSEEK_API_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},
            body:JSON.stringify({
                model:'deepseek-chat',
                messages:[
                    {role:'system',content:'You are TheGhostMachine - an elite ICT sniper. Analyze all data. Return ONLY valid JSON in the exact structure specified. No other text.'},
                    {role:'user',content:prompt}
                ],
                temperature:0.1,
                max_tokens:1000
            })
        });
        const d = await r.json();
        if (d.choices?.[0]) {
            const content = d.choices[0].message.content;
            console.log('AI raw:', content.substring(0,300));
            const m = content.match(/\{[\s\S]*\}/);
            if (m) {
                const parsed = JSON.parse(m[0]);
                console.log('AI parsed successfully');
                return parsed;
            }
        }
        if (d.error) { console.error('AI error:', d.error); showNotif('AI: ' + (d.error.message||'Error'),'warning'); }
    } catch(e) { console.error('AI fetch:', e); }
    return null;
}

// ============================================
// MAIN
// ============================================
async function runAnalysis(){const btn=document.getElementById('analyzeBtn');btn.classList.add('loading');btn.disabled=true;if(!TWELVE_DATA_KEY){showNotif('⚠️ Set Twelve Data key!','error');btn.classList.remove('loading');btn.disabled=false;return;}showNotif('🔍 Ghost scanning...','info');try{const price=await getPrice();if(!price)throw new Error('No price');const mtf=await getMTFInfo();const data=await getHistory();if(!data?.length)throw new Error('No data');const sig=score(data,price);const msnr=calculateMSNR(data,price);const settings=getMarketSettings(pair);

let direction = sig.dir;
if(mtf.strength >= 3){direction = mtf.direction==='BULLISH'?'BUY':'SELL';}

const zone=findPrecisionEntry(data,price,direction,msnr);
const a=atr(data,14);
const displacement=detectDisplacement(data,direction);
const rejection5M=await check5MRejection(zone,direction);
const volatility=getVolatilityLevel(a,price);
const sweeps=detectLiquiditySweeps(data,price);
const imbalances=findImbalances(data);
const mss=detectMSS(data);
const fvgsAll=detectFVG(data);
const breakersAll=detectBreakers(data);
const cl=data.map(c=>c.c);
const e20v=ema(cl,20),e50v=ema(cl,50);
const rs=rsi(cl,14);

const probCheck = checkProbability(zone, mtf);

if (!probCheck.passed) {
    const failedChecks = probCheck.checks.filter(c=>!c.passed).map(c=>c.name);
    showNotif(`⚠️ Low prob - Failed: ${failedChecks.join(', ')}`,'warning');
    document.getElementById('jsonOutput').innerHTML=JSON.stringify({trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:'NEUTRAL',reason:`Low probability`,failed_checks:failedChecks,zone:zone.quality,confluence:zone.confluence,mtf:mtf.direction+' ('+mtf.strength+'/4)'}},null,2);
    btn.classList.remove('loading');btn.disabled=false;return;
}

const slResult=calcStopLoss(data,direction,zone.p,zone,msnr);
const tps=calcTakeProfits(direction,zone.p,slResult.price);

let conf=sig.conf;
if(mtf.direction===direction)direction==='BUY'?conf=Math.min(conf+10,95):conf=Math.min(conf+10,95);
if(zone.quality==='A')conf=Math.min(conf+15,98);else if(zone.quality==='B')conf=Math.min(conf+8,95);
if(displacement.detected)conf=Math.min(conf+5,98);
if(rejection5M.confirmed)conf=Math.min(conf+5,98);
if(probCheck.probability==='HIGH')conf=Math.min(conf+5,98);

const sweepsText = sweeps.slice(0,3).map(s => `${s.type}: $${s.level.toFixed(2)} (${s.distance.toFixed(0)} away - ${s.direction})`).join('; ') || 'None';
const imbalancesText = imbalances.map(i => `${i.type}: $${i.low.toFixed(2)}-$${i.high.toFixed(2)}`).join('; ') || 'None';

const prec=getPrec(pair);
const marketData={
    price:price.toFixed(2),mtfDir:mtf.direction,mtfStr:mtf.strength,
    mtf5:mtf.trends['5M']||'--',mtf15:mtf.trends['15M']||'--',mtf1h:mtf.trends['1H']||'--',mtf4h:mtf.trends['4H']||'--',
    mss:mss?`${mss.type} at $${mss.level.toFixed(2)}`:'None',
    atr:a.toFixed(prec),volatility:volatility.level,volatilityDesc:volatility.desc,
    rsi:rs.toFixed(1),ema20:e20v[e20v.length-1].toFixed(prec),ema50:e50v[e50v.length-1].toFixed(prec),
    fvgCount:fvgsAll.length,freshFvg:fvgsAll.filter(f=>f.fresh).length,breakerCount:breakersAll.length,
    displacement:displacement.detected?'✅ Detected':'❌ None',
    rejection5M:rejection5M.confirmed?'✅ Confirmed':'⚠️ None',
    sweeps:sweepsText,imbalances:imbalancesText,
    zoneSrc:zone.src,zoneQuality:zone.quality,entryPrice:zone.p.toFixed(prec),
    zoneLow:zone.l.toFixed(prec),zoneHigh:zone.h.toFixed(prec),
    zoneConfluence:zone.confluence,probability:probCheck.probability,
    msnrPivot:msnr.pivot.toFixed(prec),msnrS1:msnr.supports.S1?.toFixed(prec)||'--',msnrS2:msnr.supports.S2?.toFixed(prec)||'--',msnrS3:msnr.supports.S3?.toFixed(prec)||'--',
    msnrR1:msnr.resistances.R1?.toFixed(prec)||'--',msnrR2:msnr.resistances.R2?.toFixed(prec)||'--',msnrR3:msnr.resistances.R3?.toFixed(prec)||'--',
    nearestSupport:msnr.nearestSupport?.toFixed(prec)||'--',nearestResistance:msnr.nearestResistance?.toFixed(prec)||'--',
    suggestedSL:slResult.price.toFixed(prec),slReason:slResult.reason,targetRR:settings.targetRR
};

const ai=await askAI(marketData);

let dir,entry,sl,tp1,tp2,tp3,reason,src,conviction,entryReason,slReason,possibleOutcomes;
if(ai&&ai.signal&&(ai.signal==='BUY'||ai.signal==='SELL')){
    dir=ai.signal;conf=ai.confidence||conf;entry=ai.entryPrice||zone.p;sl=ai.stopLoss||slResult.price;
    tp1=ai.takeProfit1||tps.tp1;tp2=ai.takeProfit2||tps.tp2;tp3=ai.takeProfit3||tps.tp3;
    reason=ai.entryReasoning||'AI signal';src='AI';
    conviction=ai.conviction||'MEDIUM';
    entryReason=ai.entryReasoning||'';
    slReason=ai.slReasoning||slResult.reason;
    possibleOutcomes=ai.possibleOutcomes||[];
}else{
    dir=direction;entry=zone.p;sl=slResult.price;tp1=tps.tp1;tp2=tps.tp2;tp3=tps.tp3;
    reason=sig.reason+' | '+zone.confluence+' [Q:'+zone.quality+']';src=zone.src;
    conviction=probCheck.probability==='HIGH'?'HIGH':'MEDIUM';
    entryReason=`${zone.src} zone at $${entry.toFixed(prec)} with ${zone.confluence}`;
    slReason=slResult.reason;
    possibleOutcomes=[`Price enters zone at $${entry.toFixed(prec)} and reverses`,`Price sweeps liquidity then reverses`,`Close beyond $${sl.toFixed(prec)} invalidates`];
}

const st=dir==='BUY'?'LONG':'SHORT';const risk=Math.abs(entry-sl);const slDist=risk;const rr=(Math.abs(tp1-entry)/risk).toFixed(1);
document.getElementById('currentPrice').innerHTML=`$${price.toFixed(prec)}`;
if(lastPrice){const ch=((price-lastPrice)/lastPrice*100).toFixed(2);const ce=document.getElementById('priceChange');ce.innerHTML=`${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;ce.className=`price-change ${ch>=0?'up':'down'}`;}lastPrice=price;

const out={trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:dir==='BUY'?'BUY-LIMIT':'SELL-LIMIT',entry_price:entry,stop_loss:sl,risk_amount:slDist.toFixed(prec),stop_loss_pct:((slDist/entry)*100).toFixed(2)+'%',take_profit_1:tp1,take_profit_2:tp2,take_profit_3:tp3,risk_reward:'1:'+rr,confidence:conf,conviction:conviction,entry_source:src,ai_used:src==='AI',entry_reasoning:entryReason,sl_reasoning:slReason,possible_outcomes:possibleOutcomes,zone_quality:zone.quality,zone_confluence:zone.confluence,probability:probCheck.probability,msnr_levels:{pivot:msnr.pivot.toFixed(prec),supports:{S1:msnr.supports.S1?.toFixed(prec),S2:msnr.supports.S2?.toFixed(prec),S3:msnr.supports.S3?.toFixed(prec)},resistances:{R1:msnr.resistances.R1?.toFixed(prec),R2:msnr.resistances.R2?.toFixed(prec),R3:msnr.resistances.R3?.toFixed(prec)}},sweeps:sweeps.filter(s=>s.distance<atr(data,14)*2).map(s=>({type:s.type,level:s.level,distance:s.distance})),analysis:{trend_detection:`${mtf.direction} (${mtf.strength}/4 TFs)${mtf.strength>=3?' - STRONG':''}`,volatility_level:`${volatility.level} - ${volatility.desc}`,market_structure:{mss:mss?mss.type:'None',displacement:displacement.detected,rejection_5m:rejection5M.confirmed},technical_indicators:[`RSI: ${rs.toFixed(1)}`,`FVG: ${fvgsAll.length} (${fvgsAll.filter(f=>f.fresh).length} fresh)`,`Breakers: ${breakersAll.length}`],reasoning:reason}}};

document.getElementById('jsonOutput').innerHTML=JSON.stringify(out,null,2);
analysis={signalType:st,idealEntry:entry,currentPrice:price,stopLoss:sl,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,confidence:conf};
document.getElementById('executeBtn').disabled=false;
showNotif(`✅ ${st} ${conf}% | Q:${zone.quality} | ${conviction} | 1:${rr}`,'success');
}catch(e){console.error(e);showNotif('Error: '+e.message,'error');}finally{btn.classList.remove('loading');btn.disabled=false;}}

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
