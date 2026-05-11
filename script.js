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
    if (p.includes('XAU')) return { slBuffer: 3, minSL: 3, maxSLPct: 0.008, targetRR: 4, prec: 2, atrMult: 1.5 };
    if (p.includes('XAG')) return { slBuffer: 0.05, minSL: 0.05, maxSLPct: 0.01, targetRR: 4, prec: 2, atrMult: 1.5 };
    if (p.includes('JPY')) return { slBuffer: 0.15, minSL: 0.15, maxSLPct: 0.005, targetRR: 4, prec: 3, atrMult: 1.2 };
    if (p === 'BTC/USD') return { slBuffer: 50, minSL: 50, maxSLPct: 0.015, targetRR: 4, prec: 2, atrMult: 2.0 };
    return { slBuffer: 0.0005, minSL: 0.0005, maxSLPct: 0.005, targetRR: 4, prec: 5, atrMult: 1.2 };
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

function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){if(d[i-1].h<d[i+1].l&&d[i+1].l-d[i-1].h>d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){m=true;break;}}f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!m});}if(d[i-1].l>d[i+1].h&&d[i-1].l-d[i+1].h>d[i+1].c*0.0005){let m=false;for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){m=true;break;}}f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!m});}}return f;}
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}
function detectDisplacement(data,direction){if(data.length<5)return{detected:false,strength:0};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];const strength=avg>0?lb/avg:1;if(direction==='BUY'&&strength>2&&lc[4].c>lc[4].o)return{detected:true,strength};if(direction==='SELL'&&strength>2&&lc[4].c<lc[4].o)return{detected:true,strength};return{detected:false,strength};}
async function check5MRejection(zone,direction){const d5m=await getHistory('5M');if(!d5m||d5m.length<3)return{confirmed:false,strength:0};const lc=d5m[d5m.length-1];const body=Math.abs(lc.c-lc.o);const totalRange=lc.h-lc.l;if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.h&&lc.l>=zone.l;const str=body>0?wick/body:0;if(t&&str>2&&lc.c>lc.o)return{confirmed:true,strength:str};if(t&&str>1.5)return{confirmed:true,strength:str};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.l&&lc.h<=zone.h;const str=body>0?wick/body:0;if(t&&str>2&&lc.c<lc.o)return{confirmed:true,strength:str};if(t&&str>1.5)return{confirmed:true,strength:str};}return{confirmed:false,strength:0};}
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal conditions'};return{level:'Low - Consolidation',desc:'Tight ranges'};}

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
// HIGH PROBABILITY ZONE FILTER
// ============================================
function isHighProbabilityZone(zone, mtf, displacement, rejection5M, msnr, price) {
    let score = 0;
    const settings = getMarketSettings(pair);
    
    // 1. Zone quality from confluence scoring
    if (zone.quality === 'HIGH') score += 30;
    else if (zone.quality === 'MEDIUM') score += 15;
    else score += 5;
    
    // 2. MTF alignment (minimum 2 TFs must agree)
    if (mtf.strength >= 3) score += 25;
    else if (mtf.strength >= 2) score += 15;
    else score += 5;
    
    // 3. Displacement confirmation (strong move = higher probability)
    if (displacement.detected && displacement.strength > 2.5) score += 20;
    else if (displacement.detected) score += 10;
    
    // 4. 5M rejection (immediate confirmation)
    if (rejection5M.confirmed && rejection5M.strength > 2) score += 15;
    else if (rejection5M.confirmed) score += 8;
    
    // 5. Zone proximity (closer to current price = more likely to fill)
    const zoneDistance = Math.abs(zone.p - price) / price * 100;
    if (zoneDistance < 0.3) score += 15;
    else if (zoneDistance < 0.8) score += 10;
    else if (zoneDistance < 2.0) score += 5;
    else score += 0; // Too far
    
    // 6. MSNR cluster strength
    if (msnr.nearestSupport && Math.abs(msnr.nearestSupport - zone.p) / zone.p < 0.005) score += 10;
    if (msnr.nearestResistance && Math.abs(msnr.nearestResistance - zone.p) / zone.p < 0.005) score += 10;
    
    // 7. Fresh FVG bonus
    if (zone.src === 'FVG' && zone.confluence.includes('Fresh')) score += 5;
    if (zone.confluence.includes('Breaker')) score += 5;
    if (zone.confluence.includes('Swing')) score += 5;
    
    const probability = score >= 70 ? 'HIGH' : (score >= 50 ? 'MEDIUM' : 'LOW');
    return { probability, score, passed: score >= 50 };
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
            if(swings.L.find(s=>Math.abs(s.p-f.l)<a*0.3)){score+=20;cf.push('Swing low');}
            if(msnr.nearestSupport&&Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){score+=20;cf.push('MSNR S');}
            const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
            if(f.l>=rL+r*.618&&f.l<=rL+r*.79){score+=15;cf.push('OTE');}
            const distPct=(price-f.l)/price*100;if(distPct<0.5)score+=10;if(distPct<0.3)score+=5;
            allZones.push({p:f.l,l:f.l,h:f.h,src:'FVG',score,confluence:cf.join(' + '),quality:score>=70?'HIGH':(score>=50?'MEDIUM':'LOW')});
        });
        if(msnr.nearestSupport&&msnr.nearestSupport<price){
            let score=25;let cf=['MSNR Support'];
            if(fvgs.find(f=>f.type==='bull'&&Math.abs(f.l-msnr.nearestSupport)<msnr.nearestSupport*0.003)){score+=25;cf.push('FVG');}
            if(swings.L.find(s=>Math.abs(s.p-msnr.nearestSupport)<msnr.nearestSupport*0.003)){score+=20;cf.push('Swing low');}
            const distPct=(price-msnr.nearestSupport)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:msnr.nearestSupport,l:msnr.nearestSupport*0.998,h:msnr.nearestSupport*1.002,src:'MSNR',score,confluence:cf.join(' + '),quality:score>=55?'HIGH':(score>=40?'MEDIUM':'LOW')});
        }
    } else {
        fvgs.filter(f => f.type==='bear' && f.h > price && f.fresh).forEach(f => {
            let score = 30; let cf = ['Fresh FVG'];
            if(breakers.find(b=>b.type==='BEAR'&&Math.abs(b.p-f.h)<a*0.5)){score+=25;cf.push('Breaker');}
            if(swings.H.find(s=>Math.abs(s.p-f.h)<a*0.3)){score+=20;cf.push('Swing high');}
            if(msnr.nearestResistance&&Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){score+=20;cf.push('MSNR R');}
            const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
            if(f.h>=rH-r*.79&&f.h<=rH-r*.618){score+=15;cf.push('OTE');}
            const distPct=(f.h-price)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:f.h,l:f.l,h:f.h,src:'FVG',score,confluence:cf.join(' + '),quality:score>=70?'HIGH':(score>=50?'MEDIUM':'LOW')});
        });
        if(msnr.nearestResistance&&msnr.nearestResistance>price){
            let score=25;let cf=['MSNR Resistance'];
            if(fvgs.find(f=>f.type==='bear'&&Math.abs(f.h-msnr.nearestResistance)<msnr.nearestResistance*0.003)){score+=25;cf.push('FVG');}
            if(swings.H.find(s=>Math.abs(s.p-msnr.nearestResistance)<msnr.nearestResistance*0.003)){score+=20;cf.push('Swing high');}
            const distPct=(msnr.nearestResistance-price)/price*100;if(distPct<0.5)score+=10;
            allZones.push({p:msnr.nearestResistance,l:msnr.nearestResistance*0.998,h:msnr.nearestResistance*1.002,src:'MSNR',score,confluence:cf.join(' + '),quality:score>=55?'HIGH':(score>=40?'MEDIUM':'LOW')});
        }
    }
    allZones.sort((x,y)=>y.score-x.score);
    if(allZones.length>0){const b=allZones[0];return{p:b.p,l:b.l,h:b.h,src:b.src,confluence:b.confluence,quality:b.quality,score:b.score};}
    const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
    if(direction==='BUY'){const oL=rL+r*.618,oH=rL+r*.79;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE',quality:'LOW',score:20};}
    else{const oL=rH-r*.79,oH=rH-r*.618;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE',quality:'LOW',score:20};}
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
        if (msnr && msnr.allSupports) {
            const msnrBelow = msnr.allSupports.filter(s => s < entry).sort((a,b) => b - a);
            if (msnrBelow.length > 0) { const sl = msnrBelow[0] - settings.slBuffer; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Below MSNR`,distance:dist}); }
        }
        if (zone && zone.l < entry) { const sl = zone.l - settings.slBuffer*0.7; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Below zone`,distance:dist}); }
        const sL = swings.L.filter(s => s.p < entry).sort((a,b) => b.p - a.p);
        if (sL.length > 0) { const sl = sL[0].p - settings.slBuffer; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Below swing`,distance:dist}); }
        const bF = fvgs.filter(f => f.type==='bull' && f.l < entry).sort((a,b) => b.l - a.l);
        if (bF.length > 0) { const sl = bF[0].l - settings.slBuffer*0.7; const dist = entry - sl; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Below FVG`,distance:dist}); }
        
        candidates.sort((a,b) => a.distance - b.distance);
        if (candidates.length > 0) { const best = candidates[0]; if(best.distance <= maxSLD) return {price:best.price, reason:best.reason, distance:best.distance}; }
        const sl = entry - Math.max(a*0.5, settings.minSL);
        return {price:sl, reason:'Min ATR', distance:entry-sl};
    } else {
        let candidates = [];
        if (msnr && msnr.allResistances) {
            const msnrAbove = msnr.allResistances.filter(r => r > entry).sort((a,b) => a - b);
            if (msnrAbove.length > 0) { const sl = msnrAbove[0] + settings.slBuffer; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Above MSNR`,distance:dist}); }
        }
        if (zone && zone.h > entry) { const sl = zone.h + settings.slBuffer*0.7; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Above zone`,distance:dist}); }
        const sH = swings.H.filter(s => s.p > entry).sort((a,b) => a.p - b.p);
        if (sH.length > 0) { const sl = sH[0].p + settings.slBuffer; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Above swing`,distance:dist}); }
        const sF = fvgs.filter(f => f.type==='bear' && f.h > entry).sort((a,b) => a.h - b.h);
        if (sF.length > 0) { const sl = sF[0].h + settings.slBuffer*0.7; const dist = sl - entry; if(dist>0&&dist<=maxSLD*1.5) candidates.push({price:sl,reason:`Above FVG`,distance:dist}); }
        
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
// AI
// ============================================
async function askAI(marketData){if(!DEEPSEEK_API_KEY)return null;showNotif('🤖 AI...','info');const prompt=`ICT Sniper. ${pair} ${tf} $${marketData.price}\nMTF:${marketData.mtfDir} (${marketData.mtfStr}/4)\nDirection:${marketData.direction}\nZone:${marketData.zoneSrc} $${marketData.entryPrice} (${marketData.zoneQuality})\nProbability:${marketData.probability}\nSL:$${marketData.suggestedSL}\nTarget RR: 1:${marketData.targetRR}\nReturn JSON:{"signal":"BUY/SELL","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit1":#,"takeProfit2":#,"takeProfit3":#}`;try{const r=await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'Return ONLY JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:400})});const d=await r.json();if(d.choices?.[0]){const m=d.choices[0].message.content.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);}}catch(e){}return null;}

// ============================================
// MAIN
// ============================================
async function runAnalysis(){const btn=document.getElementById('analyzeBtn');btn.classList.add('loading');btn.disabled=true;if(!TWELVE_DATA_KEY){showNotif('⚠️ Set Twelve Data key!','error');btn.classList.remove('loading');btn.disabled=false;return;}showNotif('🔍 High-probability scan...','info');try{const price=await getPrice();if(!price)throw new Error('No price');const mtf=await getMTFInfo();const data=await getHistory();if(!data?.length)throw new Error('No data');const sig=score(data,price);const msnr=calculateMSNR(data,price);const settings=getMarketSettings(pair);

// MTF enforcement
let direction = sig.dir;
if(mtf.strength >= 3){direction = mtf.direction==='BULLISH'?'BUY':'SELL';}

const zone=findPrecisionEntry(data,price,direction,msnr);const a=atr(data,14);
const displacement=detectDisplacement(data,direction);
const rejection5M=await check5MRejection(zone,direction);
const volatility=getVolatilityLevel(a,price);

// HIGH PROBABILITY CHECK
const probCheck = isHighProbabilityZone(zone, mtf, displacement, rejection5M, msnr, price);

if (!probCheck.passed) {
    showNotif(`⚠️ Low probability (${probCheck.score}/100) - Setup filtered out`,'warning');
    document.getElementById('jsonOutput').innerHTML=JSON.stringify({trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:'NEUTRAL',reason:`Setup filtered - probability score ${probCheck.score}/100 (need 50+)`,probability_details:{score:probCheck.score,probability:probCheck.probability,zone_quality:zone.quality,mtf_strength:mtf.strength,displacement:displacement.detected,rejection_5m:rejection5M.confirmed}}},null,2);
    btn.classList.remove('loading');btn.disabled=false;return;
}

const slResult=calcStopLoss(data,direction,zone.p,zone,msnr);
const tps=calcTakeProfits(direction,zone.p,slResult.price);

let conf=sig.conf;
if(mtf.direction==='BULLISH'&&direction==='BUY')conf=Math.min(conf+10,95);
if(mtf.direction==='BEARISH'&&direction==='SELL')conf=Math.min(conf+10,95);
if(mtf.strength>=3&&mtf.direction!==(direction==='BUY'?'BULLISH':'BEARISH'))conf=Math.max(conf-20,35);
if(zone.quality==='HIGH')conf=Math.min(conf+10,98);
if(rejection5M.confirmed)conf=Math.min(conf+5,98);
if(probCheck.probability==='HIGH')conf=Math.min(conf+10,98);

const marketData={price:price.toFixed(2),mtfDir:mtf.direction,mtfStr:mtf.strength,direction:direction,zoneSrc:zone.src,entryPrice:zone.p.toFixed(2),zoneQuality:zone.quality,probability:probCheck.probability,suggestedSL:slResult.price.toFixed(2),targetRR:settings.targetRR};
const ai=await askAI(marketData);

let dir,entry,sl,tp1,tp2,tp3,reason,src;
if(ai&&ai.signal){dir=ai.signal;conf=ai.confidence||conf;entry=ai.entryPrice||zone.p;sl=ai.stopLoss||slResult.price;tp1=ai.takeProfit1||tps.tp1;tp2=ai.takeProfit2||tps.tp2;tp3=ai.takeProfit3||tps.tp3;reason='🤖 AI';src='AI';}
else{dir=direction;entry=zone.p;sl=slResult.price;tp1=tps.tp1;tp2=tps.tp2;tp3=tps.tp3;reason=sig.reason+' | '+zone.confluence+' ['+zone.quality+']';src=zone.src;}

const st=dir==='BUY'?'LONG':'SHORT';const prec=getPrec(pair);const risk=Math.abs(entry-sl);const slDist=risk;const rr=(Math.abs(tp1-entry)/risk).toFixed(1);
document.getElementById('currentPrice').innerHTML=`$${price.toFixed(prec)}`;
if(lastPrice){const ch=((price-lastPrice)/lastPrice*100).toFixed(2);const ce=document.getElementById('priceChange');ce.innerHTML=`${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;ce.className=`price-change ${ch>=0?'up':'down'}`;}lastPrice=price;

const out={trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:dir==='BUY'?'BUY-LIMIT':'SELL-LIMIT',entry_price:entry,stop_loss:sl,risk_amount:slDist.toFixed(prec),stop_loss_pct:((slDist/entry)*100).toFixed(2)+'%',take_profit_1:tp1,take_profit_2:tp2,take_profit_3:tp3,risk_reward:'1:'+rr,confidence:conf,entry_source:src,ai_used:src==='AI',entry_quality:zone.quality,confluence:zone.confluence,probability:probCheck.probability,probability_score:probCheck.score,sl_reason:slResult.reason,msnr_levels:{pivot:msnr.pivot.toFixed(prec),supports:{S1:msnr.supports.S1?.toFixed(prec),S2:msnr.supports.S2?.toFixed(prec),S3:msnr.supports.S3?.toFixed(prec)},resistances:{R1:msnr.resistances.R1?.toFixed(prec),R2:msnr.resistances.R2?.toFixed(prec),R3:msnr.resistances.R3?.toFixed(prec)},nearestSupport:msnr.nearestSupport?.toFixed(prec),nearestResistance:msnr.nearestResistance?.toFixed(prec)},analysis:{trend_detection:`${mtf.direction} (${mtf.strength}/4 TFs)${mtf.strength>=3?' - STRONG':''}`,volatility_level:`${volatility.level} - ${volatility.desc}`,probability_factors:{zone_quality:zone.quality,mtf_alignment:mtf.strength+'/4',displacement:displacement.detected?`Yes (${displacement.strength.toFixed(1)}x)`:'No',rejection_5m:rejection5M.confirmed?`Yes (${rejection5M.strength.toFixed(1)}x)`:'No'},technical_indicators:[`${zone.src} at $${zone.l.toFixed(prec)}-$${zone.h.toFixed(prec)} (${zone.quality})`,`RSI: ${rsi(data.map(c=>c.c),14).toFixed(1)}`],reasoning:reason}}};

document.getElementById('jsonOutput').innerHTML=JSON.stringify(out,null,2);
analysis={signalType:st,idealEntry:entry,currentPrice:price,stopLoss:sl,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,confidence:conf};
document.getElementById('executeBtn').disabled=false;
showNotif(`✅ ${st} ${conf}% | ${probCheck.probability} prob (${probCheck.score}/100) | 1:${rr}`,'success');
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
