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
    // Crypto (BTC only)
    'BTC/USD':'BTC/USD',
    // Forex
    'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY','AUD/USD':'AUD/USD','USD/CAD':'USD/CAD',
    'USD/CHF':'USD/CHF','NZD/USD':'NZD/USD','EUR/GBP':'EUR/GBP','EUR/JPY':'EUR/JPY','GBP/JPY':'GBP/JPY',
    // Metals
    'XAU/USD':'XAU/USD','XAG/USD':'XAG/USD'
};

const TF_MAP = { '5M':'5min','15M':'15min','1H':'1h','4H':'4h','1D':'1day' };

// ============================================
// MSNR LEVELS (Malaysian Support and Resistance)
// ============================================
function calculateMSNR(data, currentPrice) {
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const closes = data.map(c => c.c);
    
    const period = Math.min(data.length, 20);
    const recentHigh = Math.max(...highs.slice(-period));
    const recentLow = Math.min(...lows.slice(-period));
    const recentClose = closes[closes.length - 1];
    
    const pp = (recentHigh + recentLow + recentClose) / 3;
    const s1 = pp * 2 - recentHigh;
    const s2 = pp - (recentHigh - recentLow);
    const s3 = recentLow - 2 * (recentHigh - pp);
    const s4 = s3 - (s1 - s3);
    const r1 = pp * 2 - recentLow;
    const r2 = pp + (recentHigh - recentLow);
    const r3 = recentHigh + 2 * (pp - recentLow);
    const r4 = r3 + (r1 - r3);
    const ms1 = (s1 + s2) / 2;
    const ms2 = (pp + s1) / 2;
    const mr1 = (r1 + r2) / 2;
    const mr2 = (pp + r1) / 2;
    
    const supports = [s1, ms1, s2, ms2, s3, s4].filter(s => s < currentPrice).sort((a,b) => b - a);
    const resistances = [r1, mr1, r2, mr2, r3, r4].filter(r => r > currentPrice).sort((a,b) => a - b);
    const clusters = findLevelClusters([...supports, ...resistances], currentPrice);
    
    return {
        pivot: pp,
        supports: { S1: s1, S2: s2, S3: s3, S4: s4, MS1: ms1, MS2: ms2 },
        resistances: { R1: r1, R2: r2, R3: r3, R4: r4, MR1: mr1, MR2: mr2 },
        nearestSupport: supports.length > 0 ? supports[0] : null,
        nearestResistance: resistances.length > 0 ? resistances[0] : null,
        supportCluster: clusters.supports,
        resistanceCluster: clusters.resistances,
        zoneStrength: clusters.strength
    };
}

function findLevelClusters(levels, currentPrice) {
    const tolerance = currentPrice * 0.003;
    let supportCluster = [], resistanceCluster = [];
    levels.sort((a, b) => a - b);
    for (let i = 0; i < levels.length; i++) {
        let cluster = [levels[i]];
        for (let j = i + 1; j < levels.length; j++) {
            if (Math.abs(levels[j] - levels[i]) <= tolerance) { cluster.push(levels[j]); i = j; }
            else break;
        }
        if (cluster.length >= 2) {
            const avgLevel = cluster.reduce((a,b) => a+b, 0) / cluster.length;
            if (avgLevel < currentPrice) supportCluster.push({ levels: cluster, avg: avgLevel, strength: cluster.length });
            else resistanceCluster.push({ levels: cluster, avg: avgLevel, strength: cluster.length });
        }
    }
    const strength = supportCluster.length + resistanceCluster.length;
    return { supports: supportCluster, resistances: resistanceCluster, strength: strength >= 3 ? 'STRONG' : (strength >= 1 ? 'MODERATE' : 'WEAK') };
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

function updatePairs(cat){
    const p={
        crypto:['BTC/USD'],
        forex:['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'],
        metals:['XAU/USD','XAG/USD']
    };
    document.getElementById('pairSelect').innerHTML=p[cat].map(x=>`<option value="${x}">${getPairDisplayName(x)}</option>`).join('');
    pair=p[cat][0];
}
function getPairDisplayName(p){
    const icons={
        'BTC/USD':'₿ BTC/USD','EUR/USD':'€ EUR/USD','GBP/USD':'£ GBP/USD','USD/JPY':'💴 USD/JPY',
        'AUD/USD':'🇦🇺 AUD/USD','USD/CAD':'🇨🇦 USD/CAD','USD/CHF':'🇨🇭 USD/CHF','NZD/USD':'🇳🇿 NZD/USD',
        'EUR/GBP':'€/£ EUR/GBP','EUR/JPY':'€/¥ EUR/JPY','GBP/JPY':'£/¥ GBP/JPY',
        'XAU/USD':'👑 XAU/USD','XAG/USD':'🥈 XAG/USD'
    };
    return icons[p]||'📊 '+p;
}
function isGold(p){return p.includes('XAU');}
function isForex(p){return['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY'].includes(p);}
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

async function check5MRejection(entryZone,direction){const d5m=await getHistory('5M');if(!d5m||d5m.length<3)return{confirmed:false};const lc=d5m[d5m.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const lowerWick=Math.min(lc.o,lc.c)-lc.l;const touched=lc.l<=entryZone.h&&lc.l>=entryZone.l;if(touched&&lowerWick>body*1.5&&lc.c>lc.o)return{confirmed:true,strength:'strong'};if(touched&&lowerWick>body)return{confirmed:true,strength:'moderate'};}else{const upperWick=lc.h-Math.max(lc.o,lc.c);const touched=lc.h>=entryZone.l&&lc.h<=entryZone.h;if(touched&&upperWick>body*1.5&&lc.c<lc.o)return{confirmed:true,strength:'strong'};if(touched&&upperWick>body)return{confirmed:true,strength:'moderate'};}return{confirmed:false};}

function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles, expanding ranges'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal market conditions'};return{level:'Low - Consolidation',desc:'Tight ranges, potential breakout'};}

// ============================================
// PRECISION ENTRY ZONE (ICT + MSNR Confluence)
// ============================================
function findPrecisionEntry(data, price, direction, msnr) {
    const a = atr(data, 14), fvgs = detectFVG(data), breakers = detectBreakers(data), swings = findSwings(data, 4);
    let allZones = [];
    if (direction === 'BUY') {
        fvgs.filter(f => f.type==='bull' && f.l < price && f.fresh).forEach(f => {
            let score = 30; let confluence = ['Fresh FVG'];
            const nb = breakers.find(b => b.type==='BULL' && Math.abs(b.p - f.l) < a * 0.5);
            if (nb) { score += 25; confluence.push('Breaker'); }
            const ns = swings.L.find(s => Math.abs(s.p - f.l) < a * 0.3);
            if (ns) { score += 20; confluence.push('Swing low'); }
            if (msnr.nearestSupport && Math.abs(msnr.nearestSupport - f.l) < f.l * 0.003) { score += 20; confluence.push('MSNR Support'); }
            if (msnr.supportCluster.length > 0) {
                const nc = msnr.supportCluster.find(c => Math.abs(c.avg - f.l) < f.l * 0.005);
                if (nc) { score += 15; confluence.push(`MSNR Cluster (${nc.strength})`); }
            }
            const rH = Math.max(...data.slice(-20).map(c=>c.h)), rL = Math.min(...data.slice(-20).map(c=>c.l)), r = rH - rL;
            if (f.l >= rL+r*0.618 && f.l <= rL+r*0.79) { score += 15; confluence.push('OTE'); }
            if ((price - f.l) / price * 100 < 0.5) score += 10;
            allZones.push({p:f.l,l:f.l,h:f.h,src:'FVG',score,confluence:confluence.join(' + '),quality:score>=70?'HIGH':(score>=50?'MEDIUM':'LOW')});
        });
        if (msnr.nearestSupport && msnr.nearestSupport < price) {
            let score = 25; let confluence = ['MSNR Support'];
            const nf = fvgs.find(f => f.type==='bull' && Math.abs(f.l - msnr.nearestSupport) < msnr.nearestSupport * 0.003);
            if (nf) { score += 25; confluence.push('FVG'); }
            const ns = swings.L.find(s => Math.abs(s.p - msnr.nearestSupport) < msnr.nearestSupport * 0.003);
            if (ns) { score += 20; confluence.push('Swing low'); }
            allZones.push({p:msnr.nearestSupport,l:msnr.nearestSupport*0.998,h:msnr.nearestSupport*1.002,src:'MSNR',score,confluence:confluence.join(' + '),quality:score>=55?'HIGH':(score>=40?'MEDIUM':'LOW')});
        }
    } else {
        fvgs.filter(f => f.type==='bear' && f.h > price && f.fresh).forEach(f => {
            let score = 30; let confluence = ['Fresh FVG'];
            const nb = breakers.find(b => b.type==='BEAR' && Math.abs(b.p - f.h) < a * 0.5);
            if (nb) { score += 25; confluence.push('Breaker'); }
            const ns = swings.H.find(s => Math.abs(s.p - f.h) < a * 0.3);
            if (ns) { score += 20; confluence.push('Swing high'); }
            if (msnr.nearestResistance && Math.abs(msnr.nearestResistance - f.h) < f.h * 0.003) { score += 20; confluence.push('MSNR Resistance'); }
            if (msnr.resistanceCluster.length > 0) {
                const nc = msnr.resistanceCluster.find(c => Math.abs(c.avg - f.h) < f.h * 0.005);
                if (nc) { score += 15; confluence.push(`MSNR Cluster (${nc.strength})`); }
            }
            const rH = Math.max(...data.slice(-20).map(c=>c.h)), rL = Math.min(...data.slice(-20).map(c=>c.l)), r = rH - rL;
            if (f.h >= rH-r*0.79 && f.h <= rH-r*0.618) { score += 15; confluence.push('OTE'); }
            if ((f.h - price) / price * 100 < 0.5) score += 10;
            allZones.push({p:f.h,l:f.l,h:f.h,src:'FVG',score,confluence:confluence.join(' + '),quality:score>=70?'HIGH':(score>=50?'MEDIUM':'LOW')});
        });
        if (msnr.nearestResistance && msnr.nearestResistance > price) {
            let score = 25; let confluence = ['MSNR Resistance'];
            const nf = fvgs.find(f => f.type==='bear' && Math.abs(f.h - msnr.nearestResistance) < msnr.nearestResistance * 0.003);
            if (nf) { score += 25; confluence.push('FVG'); }
            const ns = swings.H.find(s => Math.abs(s.p - msnr.nearestResistance) < msnr.nearestResistance * 0.003);
            if (ns) { score += 20; confluence.push('Swing high'); }
            allZones.push({p:msnr.nearestResistance,l:msnr.nearestResistance*0.998,h:msnr.nearestResistance*1.002,src:'MSNR',score,confluence:confluence.join(' + '),quality:score>=55?'HIGH':(score>=40?'MEDIUM':'LOW')});
        }
    }
    allZones.sort((x, y) => y.score - x.score);
    if (allZones.length > 0) {
        const best = allZones[0];
        return {p:best.p,l:best.l,h:best.h,src:best.src,confluence:best.confluence,quality:best.quality,score:best.score};
    }
    const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;
    if(direction==='BUY'){const oL=rL+r*.618,oH=rL+r*.79;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE Zone',quality:'LOW',score:20};}
    else{const oL=rH-r*.79,oH=rH-r*.618;return{p:(oL+oH)/2,l:oL,h:oH,src:'OTE',confluence:'OTE Zone',quality:'LOW',score:20};}
}

// ============================================
// STOP LOSS
// ============================================
function getSLBuffer(atrValue,zoneQuality){const qm=zoneQuality==='HIGH'?0.6:(zoneQuality==='MEDIUM'?0.8:1.0);const buffers={'XAU/USD':{'5M':4,'15M':6,'1H':10,'4H':15}};const base=(buffers['XAU/USD']&&buffers['XAU/USD'][tf])?buffers['XAU/USD'][tf]:Math.max(atrValue*1.5,15);return Math.max(base*qm,isGold(pair)?3:0.0003);}
function calcStopLoss(data,dir,entry,zone,zoneQuality){const a=atr(data,14),swings=findSwings(data,4),fvgs=detectFVG(data);const minBuffer=getSLBuffer(a,zoneQuality);const maxSLP=0.008,maxSLD=entry*maxSLP;if(dir==='BUY'){const allSwings=swings.L.filter(s=>s.p<entry).sort((a,b)=>b.p-a.p);const bullFVGs=fvgs.filter(f=>f.type==='bull'&&f.l<entry).sort((a,b)=>b.l-a.l);let sp=null,sr='';for(const s of allSwings){const d=entry-s.p;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=s.p-minBuffer*0.2;sr=`Below swing $${s.p.toFixed(getPrec(pair))}`;break;}}if(!sp&&bullFVGs.length){const d=entry-bullFVGs[0].l;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=bullFVGs[0].l-minBuffer*0.15;sr='Below FVG';}}if(!sp){sp=entry-minBuffer;sr='ATR buffer';}if(entry-sp<minBuffer*0.5){sp=entry-minBuffer;sr='Min ATR';}if(entry-sp>maxSLD){sp=entry-maxSLD;sr='Capped';}return{price:sp,reason:sr,distance:entry-sp};}else{const allSwings=swings.H.filter(s=>s.p>entry).sort((a,b)=>a.p-b.p);const bearFVGs=fvgs.filter(f=>f.type==='bear'&&f.h>entry).sort((a,b)=>a.h-b.h);let sp=null,sr='';for(const s of allSwings){const d=s.p-entry;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=s.p+minBuffer*0.2;sr=`Above swing $${s.p.toFixed(getPrec(pair))}`;break;}}if(!sp&&bearFVGs.length){const d=bearFVGs[0].h-entry;if(d>=minBuffer*0.4&&d<=maxSLD*1.5){sp=bearFVGs[0].h+minBuffer*0.15;sr='Above FVG';}}if(!sp){sp=entry+minBuffer;sr='ATR buffer';}if(sp-entry<minBuffer*0.5){sp=entry+minBuffer;sr='Min ATR';}if(sp-entry>maxSLD){sp=entry+maxSLD;sr='Capped';}return{price:sp,reason:sr,distance:sp-entry};}}

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
async function askAI(marketData){if(!DEEPSEEK_API_KEY)return null;showNotif('🤖 Ghost AI...','info');const prompt=`You are TheGhostMachine - elite ICT sniper using MSNR strategy.\n\n${pair} ${tf} $${marketData.price}\nMTF:5M=${marketData.mtf5} 15M=${marketData.mtf15} 1H=${marketData.mtf1h} 4H=${marketData.mtf4h}\nDirection:${marketData.direction}\nZone:${marketData.zoneSrc} $${marketData.entryPrice} [$${marketData.zoneLow}-$${marketData.zoneHigh}]\nConfluence:${marketData.confluence} | Quality:${marketData.zoneQuality}\nMSNR: S1=$${marketData.msnrS1} S2=$${marketData.msnrS2} R1=$${marketData.msnrR1} R2=$${marketData.msnrR2}\nSL Suggestion:$${marketData.suggestedSL}\n\nReturn JSON:\n{"signal":"BUY/SELL","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit":#,"analysis":{"trend_detection":"...","volatility_level":"${marketData.volatility}","technical_indicators":["..."],"msnr_analysis":"...","possible_outcomes":["..."]}}`;try{const r=await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are TheGhostMachine using MSNR. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:800})});const d=await r.json();if(d.choices?.[0]){const m=d.choices[0].message.content.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);}}catch(e){}return null;}

// ============================================
// MAIN
// ============================================
async function runAnalysis(){const btn=document.getElementById('analyzeBtn');btn.classList.add('loading');btn.disabled=true;if(!TWELVE_DATA_KEY){showNotif('⚠️ Set Twelve Data key!','error');btn.classList.remove('loading');btn.disabled=false;return;}showNotif('🔍 MSNR+ICT scanning...','info');try{const price=await getPrice();if(!price)throw new Error('No price');const mtf=await getMTFInfo();const data=await getHistory();if(!data?.length)throw new Error('No data');const sig=score(data,price);const msnr=calculateMSNR(data,price);const zone=findPrecisionEntry(data,price,sig.dir,msnr);const a=atr(data,14);const slResult=calcStopLoss(data,sig.dir,zone.p,zone,zone.quality);const displacement=detectDisplacement(data,sig.dir);const rejection5M=await check5MRejection(zone,sig.dir);const volatility=getVolatilityLevel(a,price);let conf=sig.conf;if(mtf.direction==='BULLISH'&&sig.dir==='BUY')conf=Math.min(conf+10,95);if(mtf.direction==='BEARISH'&&sig.dir==='SELL')conf=Math.min(conf+10,95);if(mtf.direction==='BULLISH'&&sig.dir==='SELL')conf=Math.max(conf-15,35);if(mtf.direction==='BEARISH'&&sig.dir==='BUY')conf=Math.max(conf-15,35);if(zone.quality==='HIGH')conf=Math.min(conf+10,98);if(rejection5M.confirmed)conf=Math.min(conf+5,98);if(msnr.zoneStrength==='STRONG')conf=Math.min(conf+5,98);const marketData={price:price.toFixed(2),mtf5:mtf.trends['5M']||'--',mtf15:mtf.trends['15M']||'--',mtf1h:mtf.trends['1H']||'--',mtf4h:mtf.trends['4H']||'--',direction:sig.dir,zoneSrc:zone.src,entryPrice:zone.p.toFixed(2),zoneLow:zone.l.toFixed(2),zoneHigh:zone.h.toFixed(2),confluence:zone.confluence,zoneQuality:zone.quality,msnrS1:msnr.supports.S1?.toFixed(2)||'--',msnrS2:msnr.supports.S2?.toFixed(2)||'--',msnrR1:msnr.resistances.R1?.toFixed(2)||'--',msnrR2:msnr.resistances.R2?.toFixed(2)||'--',suggestedSL:slResult.price.toFixed(2),volatility:volatility.level};const ai=await askAI(marketData);let dir,entry,sl,tp1,tp2,tp3,reason,src;if(ai&&ai.signal){dir=ai.signal;conf=ai.confidence||conf;entry=ai.entryPrice||zone.p;sl=ai.stopLoss||slResult.price;const tp=ai.takeProfit||(dir==='BUY'?entry+Math.abs(entry-sl)*3:entry-Math.abs(entry-sl)*3);tp1=tp;tp2=dir==='BUY'?entry+Math.abs(entry-sl)*5:entry-Math.abs(entry-sl)*5;tp3=dir==='BUY'?entry+Math.abs(entry-sl)*8:entry-Math.abs(entry-sl)*8;reason='🤖 '+(ai.analysis?.trend_detection||'AI signal');src='AI';}else{dir=sig.dir;entry=zone.p;sl=slResult.price;const risk=Math.abs(entry-sl);tp1=dir==='BUY'?entry+risk*3:entry-risk*3;tp2=dir==='BUY'?entry+risk*5:entry-risk*5;tp3=dir==='BUY'?entry+risk*8:entry-risk*8;reason=sig.reason+' | '+zone.confluence+' ['+zone.quality+']';src=zone.src;}const st=dir==='BUY'?'LONG':'SHORT';const prec=getPrec(pair);const slDist=Math.abs(entry-sl);const rr=(Math.abs(tp1-entry)/slDist).toFixed(1);document.getElementById('currentPrice').innerHTML=`$${price.toFixed(prec)}`;if(lastPrice){const ch=((price-lastPrice)/lastPrice*100).toFixed(2);const ce=document.getElementById('priceChange');ce.innerHTML=`${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;ce.className=`price-change ${ch>=0?'up':'down'}`;}lastPrice=price;const out={trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:dir==='BUY'?'BUY-LIMIT':'SELL-LIMIT',entry_price:entry,stop_loss:sl,stop_loss_distance:slDist.toFixed(2),stop_loss_pct:((slDist/entry)*100).toFixed(2)+'%',take_profit_1:tp1,take_profit_2:tp2,take_profit_3:tp3,risk_reward:rr,confidence:conf,entry_source:src,ai_used:src==='AI',entry_quality:zone.quality,confluence:zone.confluence,msnr_levels:{pivot:msnr.pivot.toFixed(2),supports:{S1:msnr.supports.S1?.toFixed(2),S2:msnr.supports.S2?.toFixed(2),S3:msnr.supports.S3?.toFixed(2),MS1:msnr.supports.MS1?.toFixed(2),MS2:msnr.supports.MS2?.toFixed(2)},resistances:{R1:msnr.resistances.R1?.toFixed(2),R2:msnr.resistances.R2?.toFixed(2),R3:msnr.resistances.R3?.toFixed(2),MR1:msnr.resistances.MR1?.toFixed(2),MR2:msnr.resistances.MR2?.toFixed(2)},nearestSupport:msnr.nearestSupport?.toFixed(2),nearestResistance:msnr.nearestResistance?.toFixed(2),zoneStrength:msnr.zoneStrength},analysis:{trend_detection:`${mtf.direction} (${mtf.strength}/4 TFs). MSS: ${detectMSS(data)?.type||'None'}`,volatility_level:`${volatility.level} - ${volatility.desc}`,technical_indicators:[`${zone.src} at $${zone.l.toFixed(2)}-$${zone.h.toFixed(2)} (${zone.quality}, ${zone.confluence})`,`RSI: ${rsi(data.map(c=>c.c),14).toFixed(1)}`,`MSNR: ${msnr.zoneStrength} zones, pivot $${msnr.pivot.toFixed(2)}`,`Displacement: ${displacement.detected?'✅':'❌'}`,`5M Rejection: ${rejection5M.confirmed?'✅ '+rejection5M.strength:'⚠️'}`],msnr_analysis:`MSNR ${msnr.zoneStrength} zones. Pivot: $${msnr.pivot.toFixed(2)}. Nearest S: $${msnr.nearestSupport?.toFixed(2)||'N/A'}, Nearest R: $${msnr.nearestResistance?.toFixed(2)||'N/A'}`,possible_outcomes:[`${dir==='BUY'?'Bullish':'Bearish'}: Price enters at $${entry.toFixed(2)} and targets MSNR ${dir==='BUY'?'resistance':'support'}`,`Consolidation: Price ranges between MSNR S1 ($${msnr.supports.S1?.toFixed(2)}) and R1 ($${msnr.resistances.R1?.toFixed(2)})`,`Invalidation: Close beyond $${sl.toFixed(2)} invalidates the setup`],reasoning:reason}}};document.getElementById('jsonOutput').innerHTML=JSON.stringify(out,null,2);analysis={signalType:st,idealEntry:entry,currentPrice:price,stopLoss:sl,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,confidence:conf};document.getElementById('executeBtn').disabled=false;showNotif(`✅ ${st} ${conf}% | ${zone.quality} | MSNR: ${msnr.zoneStrength}`,'success');}catch(e){console.error(e);showNotif('Error: '+e.message,'error');}finally{btn.classList.remove('loading');btn.disabled=false;}}

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
