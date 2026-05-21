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
// TIMEFRAME ALIGNMENT HIERARCHY
// ============================================
function getTimeframeHierarchy(selectedTF) {
    // Returns [trendTF, structureTF, entryTF, sniperTF]
    const hierarchy = {
        '1D': ['1D', '4H', '1H', '15M'],
        '4H': ['4H', '1H', '15M', '5M'],
        '1H': ['1H', '15M', '5M', '5M'],
        '15M': ['15M', '5M', '5M', '5M'],
        '5M': ['5M', '5M', '5M', '5M']
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
function getSLBufferForTF(atrValue) { const s = getMarketSettings(pair); return Math.max(s.slBuffers[tf] || s.slBuffers['15M'] || 3, atrValue * 0.5); }

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
async function getHistory(tfStr){if(!TWELVE_DATA_KEY)return null;try{const r=await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){calls++;return d.values.map(c=>({t:c.datetime,o:+c.open,h:+c.high,l:+c.low,c:+c.close,v:+c.volume||1e6})).reverse();}}catch(e){}return null;}
async function getTechnicalIndicators(){if(!TWELVE_DATA_KEY)return{};const symbol=encodeURIComponent(SYMBOLS[pair]);const interval=TF_MAP[tf];const ind={};try{const r=await fetch(`${TWELVE_DATA_BASE}/rsi?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.rsi=parseFloat(d.values[0].rsi);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/macd?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.macd=parseFloat(d.values[0].macd);ind.macd_signal=parseFloat(d.values[0].macd_signal);ind.macd_hist=parseFloat(d.values[0].macd_hist);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/adx?symbol=${symbol}&interval=${interval}&time_period=14&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.adx=parseFloat(d.values[0].adx);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/bbands?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.bb_upper=parseFloat(d.values[0].upper_band);ind.bb_middle=parseFloat(d.values[0].middle_band);ind.bb_lower=parseFloat(d.values[0].lower_band);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/stoch?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.stoch_k=parseFloat(d.values[0].slow_k);ind.stoch_d=parseFloat(d.values[0].slow_d);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/obv?symbol=${symbol}&interval=${interval}&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.obv=parseFloat(d.values[0].obv);calls++;}}catch(e){}try{const r=await fetch(`${TWELVE_DATA_BASE}/cci?symbol=${symbol}&interval=${interval}&time_period=20&apikey=${TWELVE_DATA_KEY}`);const d=await r.json();if(d.values){ind.cci=parseFloat(d.values[0].cci);calls++;}}catch(e){}return ind;}

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
function detectDisplacement(data,direction){if(data.length<5)return{detected:false};const lc=data.slice(-5);const bodies=lc.map(c=>Math.abs(c.c-c.o));const avg=bodies.reduce((a,b)=>a+b,0)/bodies.length;const lb=bodies[bodies.length-1];if(direction==='BUY'&&lb>avg*2.5&&lc[4].c>lc[4].o)return{detected:true};if(direction==='SELL'&&lb>avg*2.5&&lc[4].c<lc[4].o)return{detected:true};return{detected:false};}
async function checkSniperRejection(zone,direction,sniperTF){const dSn=await getHistory(sniperTF);if(!dSn||dSn.length<3)return{confirmed:false};const lc=dSn[dSn.length-1];const body=Math.abs(lc.c-lc.o);if(direction==='BUY'){const wick=Math.min(lc.o,lc.c)-lc.l;const t=lc.l<=zone.h&&lc.l>=zone.l;if(t&&wick>body*2&&lc.c>lc.o)return{confirmed:true};}else{const wick=lc.h-Math.max(lc.o,lc.c);const t=lc.h>=zone.l&&lc.h<=zone.h;if(t&&wick>body*2&&lc.c<lc.o)return{confirmed:true};}return{confirmed:false};}
function getVolatilityLevel(atrValue,price){const pct=(atrValue/price)*100;if(pct>0.8)return{level:'High - Impulsive',desc:'Large candles, expanding ranges'};if(pct>0.4)return{level:'Moderate - Control',desc:'Normal market conditions'};return{level:'Low - Consolidation',desc:'Tight ranges, potential breakout'};}
function detectLiquiditySweeps(data,currentPrice){const sweeps=[];const a=atr(data,14);const maxDistance=a*3;const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);for(let i=10;i<data.length-3;i++){const rH=highs.slice(i-5,i);const maxH=Math.max(...rH);if(rH.filter(h=>Math.abs(h-maxH)<=maxH*0.001).length>=2&&Math.abs(maxH-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.h>maxH*1.001)&&closes[i+3]<maxH)sweeps.push({type:'BUY_SIDE',level:maxH,distance:Math.abs(maxH-currentPrice),direction:'BEARISH'});}const rL=lows.slice(i-5,i);const minL=Math.min(...rL);if(rL.filter(l=>Math.abs(l-minL)<=minL*0.001).length>=2&&Math.abs(minL-currentPrice)<=maxDistance){if(data.slice(i,i+4).some(c=>c.l<minL*0.999)&&closes[i+3]>minL)sweeps.push({type:'SELL_SIDE',level:minL,distance:Math.abs(minL-currentPrice),direction:'BULLISH'});}}return sweeps.sort((a,b)=>a.distance-b.distance);}
function findImbalances(data){const im=[];for(let i=1;i<data.length-1;i++){if(data[i-1].l>data[i+1].h)im.push({type:'BULLISH',low:data[i+1].h,high:data[i-1].l});if(data[i-1].h<data[i+1].l)im.push({type:'BEARISH',low:data[i-1].h,high:data[i+1].l});}return im.slice(-5);}
function detectTurtleSoup(data){if(data.length<15)return{detected:false,type:null};const rd=data.slice(-15);const highs=rd.map(c=>c.h),lows=rd.map(c=>c.l),closes=rd.map(c=>c.c),opens=rd.map(c=>c.o);const keyLow=Math.min(...lows.slice(0,-4));const recentLow=lows[lows.length-4];const cc=closes[closes.length-1];const co=opens[opens.length-1];if(recentLow<keyLow*0.999&&cc>keyLow&&cc>co)return{detected:true,type:'BUY',keyLevel:keyLow,sweptLevel:recentLow};const keyHigh=Math.max(...highs.slice(0,-4));const recentHigh=highs[highs.length-4];if(recentHigh>keyHigh*1.001&&cc<keyHigh&&cc<co)return{detected:true,type:'SELL',keyLevel:keyHigh,sweptLevel:recentHigh};return{detected:false,type:null};}
function detectCRT(data,direction){if(data.length<10)return{detected:false};const lc=data.slice(-5);const ranges=lc.map(c=>c.h-c.l);const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length;const lastRange=ranges[ranges.length-1];const expanding=lastRange>avgRange*1.5;const contracting=lastRange<avgRange*0.5;return{detected:expanding||contracting,pattern:expanding?'Expanding':(contracting?'Contracting':'Neutral'),rangeRatio:(lastRange/avgRange).toFixed(2),signal:expanding?(direction==='BUY'?'Bullish momentum':'Bearish momentum'):(contracting?'Consolidation':'Neutral')};}

// ============================================
// MSNR LEVELS
// ============================================
function calculateMSNR(data,currentPrice){const highs=data.map(c=>c.h),lows=data.map(c=>c.l),closes=data.map(c=>c.c);const period=Math.min(data.length,20);const rH=Math.max(...highs.slice(-period)),rL=Math.min(...lows.slice(-period)),rC=closes[closes.length-1];const pp=(rH+rL+rC)/3;const s1=pp*2-rH,s2=pp-(rH-rL),s3=rL-2*(rH-pp);const r1=pp*2-rL,r2=pp+(rH-rL),r3=rH+2*(pp-rL);const ms1=(s1+s2)/2,ms2=(pp+s1)/2,mr1=(r1+r2)/2,mr2=(pp+r1)/2;const allS=[s1,ms2,ms1,s2,s3].filter(s=>s<currentPrice).sort((a,b)=>b-a);const allR=[r1,mr2,mr1,r2,r3].filter(r=>r>currentPrice).sort((a,b)=>a-b);return{pivot:pp,supports:{S1:s1,S2:s2,S3:s3,MS1:ms1,MS2:ms2},resistances:{R1:r1,R2:r2,R3:r3,MR1:mr1,MR2:mr2},nearestSupport:allS[0]||null,nearestResistance:allR[0]||null,allSupports:allS,allResistances:allR};}

// ============================================
// PRECISION ENTRY ZONE
// ============================================
function findPrecisionEntry(data,price,direction,msnr){const a=atr(data,14),fvgs=detectFVG(data),breakers=detectBreakers(data),swings=findSwings(data,4);let allZones=[];if(direction==='BUY'){fvgs.filter(f=>f.type==='bull'&&f.l<price&&f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(breakers.find(b=>b.type==='BULL'&&Math.abs(b.p-f.l)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.L.find(x=>Math.abs(x.p-f.l)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestSupport&&Math.abs(msnr.nearestSupport-f.l)<f.l*0.003){s+=20;cf.push('MSNR');}allZones.push({p:f.l,l:f.l,h:f.h,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=70?'A':(s>=55?'B':'C')});});if(msnr.nearestSupport&&msnr.nearestSupport<price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bull'&&Math.abs(f.l-msnr.nearestSupport)<msnr.nearestSupport*0.003)){s+=25;cf.push('FVG');}if(swings.L.find(x=>Math.abs(x.p-msnr.nearestSupport)<msnr.nearestSupport*0.003)){s+=20;cf.push('Swing');}allZones.push({p:msnr.nearestSupport,l:msnr.nearestSupport*0.998,h:msnr.nearestSupport*1.002,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=60?'A':(s>=45?'B':'C')});}}else{fvgs.filter(f=>f.type==='bear'&&f.h>price&&f.fresh).forEach(f=>{let s=30;let cf=['FVG'];if(breakers.find(b=>b.type==='BEAR'&&Math.abs(b.p-f.h)<a*0.5)){s+=25;cf.push('Breaker');}if(swings.H.find(x=>Math.abs(x.p-f.h)<a*0.3)){s+=20;cf.push('Swing');}if(msnr.nearestResistance&&Math.abs(msnr.nearestResistance-f.h)<f.h*0.003){s+=20;cf.push('MSNR');}allZones.push({p:f.h,l:f.l,h:f.h,src:'FVG',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=70?'A':(s>=55?'B':'C')});});if(msnr.nearestResistance&&msnr.nearestResistance>price){let s=25;let cf=['MSNR'];if(fvgs.find(f=>f.type==='bear'&&Math.abs(f.h-msnr.nearestResistance)<msnr.nearestResistance*0.003)){s+=25;cf.push('FVG');}if(swings.H.find(x=>Math.abs(x.p-msnr.nearestResistance)<msnr.nearestResistance*0.003)){s+=20;cf.push('Swing');}allZones.push({p:msnr.nearestResistance,l:msnr.nearestResistance*0.998,h:msnr.nearestResistance*1.002,src:'MSNR',score:s,confluence:cf.join('+'),cc:cf.length,quality:s>=60?'A':(s>=45?'B':'C')});}}allZones.sort((x,y)=>y.score-x.score);if(allZones.length>0){const b=allZones[0];return{p:b.p,l:b.l,h:b.h,src:b.src,confluence:b.confluence,cc:b.cc,quality:b.quality};}const rH=Math.max(...data.slice(-20).map(c=>c.h)),rL=Math.min(...data.slice(-20).map(c=>c.l)),r=rH-rL;if(direction==='BUY'){return{p:rL+r*.7,l:rL+r*.618,h:rL+r*.79,src:'OTE',confluence:'OTE',cc:1,quality:'C'};}else{return{p:rH-r*.3,l:rH-r*.79,h:rH-r*.618,src:'OTE',confluence:'OTE',cc:1,quality:'C'};}}

// ============================================
// PROBABILITY CHECK
// ============================================
function checkProbability(zone,mtf){const checks=[];checks.push({name:'Confluence (2+)',passed:zone.cc>=2,critical:true});checks.push({name:'MTF aligned (2+)',passed:mtf.strength>=2,critical:true});checks.push({name:'Quality A/B',passed:zone.quality==='A'||zone.quality==='B',critical:false});const cp=checks.filter(c=>c.critical).every(c=>c.passed);const tp=checks.filter(c=>c.passed).length;return{probability:cp?(tp>=3?'HIGH':'MEDIUM'):'LOW',checks,totalPassed:tp,passed:cp};}

// ============================================
// STOP LOSS
// ============================================
function calcStopLoss(data,dir,entry,zone,msnr){const a=atr(data,14),swings=findSwings(data,4),fvgs=detectFVG(data);const s=getMarketSettings(pair);const maxSLD=entry*s.maxSLPct;const slBuf=getSLBufferForTF(a);let c=[];if(dir==='BUY'){if(msnr&&msnr.allSupports){msnr.allSupports.filter(x=>x<entry).forEach(x=>{const sl=x-slBuf;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below MSNR',distance:d});});}if(zone&&zone.l<entry){const sl=zone.l-slBuf*0.6;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below zone',distance:d});}swings.L.filter(x=>x.p<entry).forEach(x=>{const sl=x.p-slBuf;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below swing',distance:d});});fvgs.filter(f=>f.type==='bull'&&f.l<entry).forEach(f=>{const sl=f.l-slBuf*0.6;const d=entry-sl;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Below FVG',distance:d});});}else{if(msnr&&msnr.allResistances){msnr.allResistances.filter(x=>x>entry).forEach(x=>{const sl=x+slBuf;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above MSNR',distance:d});});}if(zone&&zone.h>entry){const sl=zone.h+slBuf*0.6;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above zone',distance:d});}swings.H.filter(x=>x.p>entry).forEach(x=>{const sl=x.p+slBuf;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above swing',distance:d});});fvgs.filter(f=>f.type==='bear'&&f.h>entry).forEach(f=>{const sl=f.h+slBuf*0.6;const d=sl-entry;if(d>0&&d<=maxSLD*1.5)c.push({price:sl,reason:'Above FVG',distance:d});});}c.sort((a,b)=>a.distance-b.distance);for(const x of c){if(x.distance<=maxSLD)return{price:x.price,reason:x.reason,distance:x.distance};}const fb=dir==='BUY'?entry-Math.max(a*0.5,s.minSL):entry+Math.max(a*0.5,s.minSL);return{price:fb,reason:'Min ATR',distance:Math.abs(entry-fb)};}

// ============================================
// TAKE PROFIT - Always correct
// ============================================
function calcTakeProfits(dir,entry,sl){const risk=Math.abs(entry-sl);const settings=getMarketSettings(pair);const rr=settings.targetRR;if(dir==='BUY'){return{tp1:entry+risk*rr,tp2:entry+risk*(rr+1),tp3:entry+risk*(rr+2)};}else{return{tp1:entry-risk*rr,tp2:entry-risk*(rr+1),tp3:entry-risk*(rr+2)};}}

// ============================================
// SCORING
// ============================================
function score(data,price){const a=atr(data),cl=data.map(c=>c.c),rs=rsi(cl);const fv=detectFVG(data),ms=detectMSS(data),bk=detectBreakers(data);const e20=ema(cl,20),e50=ema(cl,50),cE20=e20[e20.length-1],cE50=e50[e50.length-1];const bF=fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);const sF=fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);const bB=bk.filter(b=>b.type==='BULL'&&b.p<price);const sB=bk.filter(b=>b.type==='BEAR'&&b.p>price);let bS=0,sS=0,bR=[],sR=[];if(ms?.type==='BULL'){bS+=20;bR.push('MSS Bull');}else if(ms?.type==='BEAR'){sS+=20;sR.push('MSS Bear');}if(bF.length){bS+=15;bR.push('Bull FVG');}if(sF.length){sS+=15;sR.push('Bear FVG');}if(bB.length){bS+=10;bR.push('Bull breaker');}if(sB.length){sS+=10;sR.push('Bear breaker');}if(cE20>cE50){bS+=15;bR.push('EMA bull');}else{sS+=15;sR.push('EMA bear');}if(rs>50)bS+=10;else sS+=10;let dir,conf,reason;if(bS>sS){dir='BUY';conf=Math.min(bS+15,95);reason=bR.join('; ');}else if(sS>bS){dir='SELL';conf=Math.min(sS+15,95);reason=sR.join('; ');}else{dir=cE20>cE50?'BUY':'SELL';conf=50;reason='EMA tiebreaker';}return{dir,conf,reason,scores:{bS,sS}};}

// ============================================
// MULTI-TF
// ============================================
async function getMTFInfo(){const tfs=['5M','15M','1H','4H'];let bullCount=0,bearCount=0;const trends={};for(let t of tfs){let d=await getHistory(t);if(!d||d.length<30)continue;let c=d.map(x=>x.c),tr=c[c.length-1]>c[c.length-20]?'BULLISH':(c[c.length-1]<c[c.length-20]?'BEARISH':'NEUTRAL');trends[t]=tr;if(tr==='BULLISH')bullCount++;else if(tr==='BEARISH')bearCount++;let el=document.getElementById(`trend${t}`);if(el){el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut');el.className=`mtf-trend ${tr.toLowerCase()}`;}}return{direction:bullCount>bearCount?'BULLISH':(bearCount>bullCount?'BEARISH':'NEUTRAL'),strength:Math.max(bullCount,bearCount),bullCount,bearCount,trends};}

// ============================================
// GHOST MACHINE AI
// ============================================
async function askAI(marketData){if(!DEEPSEEK_API_KEY)return null;showNotif('🤖 Ghost AI...','info');
const prompt=`Use the bot to find trade opportunity for today on ${pair}. Convert the analysis in {json}

${pair} | Analysis TF: ${marketData.tf} | Entry TF: ${marketData.entryTF} | Sniper TF: ${marketData.sniperTF} | $${marketData.price}
Timeframe Alignment: ${marketData.tfAlign}
MTF: ${marketData.mtfDir} (${marketData.mtfStr}/4) | 5M:${marketData.mtf5} 15M:${marketData.mtf15} 1H:${marketData.mtf1h} 4H:${marketData.mtf4h}
MSS: ${marketData.mss} | Turtle Soup: ${marketData.turtleSoup} | CRT: ${marketData.crt}
RSI: ${marketData.rsi} | ATR: ${marketData.atr} | Vol: ${marketData.volatility}
${marketData.twelveIndicators ? `MACD: ${marketData.twelveIndicators.macd} | ADX: ${marketData.twelveIndicators.adx} | StochK: ${marketData.twelveIndicators.stoch_k}` : ''}
Sweeps: ${marketData.sweeps} | Imbalances: ${marketData.imbalances}
Entry Zone: ${marketData.zoneSrc} Q:${marketData.zoneQuality} | $${marketData.entryPrice} ($${marketData.zoneLow}-$${marketData.zoneHigh})
Confluence: ${marketData.zoneConfluence} (${marketData.confluenceCount}) | SL: $${marketData.suggestedSL}
MSNR: Pivot:$${marketData.msnrPivot} S1:$${marketData.msnrS1} R1:$${marketData.msnrR1}

Return ONLY JSON:
{"trade_signal_Theghostmachine":{"date":"${new Date().toISOString().split('T')[0]}","current_price":"${marketData.price}","pair":"${pair}","trade_type":"${marketData.direction==='BUY'?'BUY-LIMIT':'SELL-LIMIT'}","entry_price":${marketData.entryPrice},"stop_loss":${marketData.suggestedSL},"take_profit":${marketData.entryPrice},"analysis":{"trend_detection":"...","volatility_level":"${marketData.volatility}","technical_indicators":["...","...","..."],"possible_outcomes":["Primary","Alternative","Invalidation"]}}}`;
try{const r=await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You are TheGhostMachine. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:800})});const d=await r.json();if(d.choices?.[0]){const m=d.choices[0].message.content.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);}if(d.error)console.error('AI error:',d.error);}catch(e){console.error('AI fetch:',e);}return null;}

// ============================================
// MAIN - PROPER TIMEFRAME ALIGNMENT
// ============================================
async function runAnalysis(){const btn=document.getElementById('analyzeBtn');btn.classList.add('loading');btn.disabled=true;if(!TWELVE_DATA_KEY){showNotif('⚠️ Set Twelve Data key!','error');btn.classList.remove('loading');btn.disabled=false;return;}showNotif('🔍 MTF alignment scan...','info');try{const price=await getPrice();if(!price)throw new Error('No price');
const mtf=await getMTFInfo();
const settings=getMarketSettings(pair);

// GET TIMEFRAME HIERARCHY
const [trendTF, structureTF, entryTF, sniperTF] = getTimeframeHierarchy(tf);

// Get data for each level
const trendData = await getHistory(trendTF);
const structureData = await getHistory(structureTF);
const entryData = await getHistory(entryTF);
if(!entryData?.length)throw new Error('No entry timeframe data');

// Get Twelve Data indicators on entry timeframe
const twelveIndicators=await getTechnicalIndicators();

// Direction from trend TF
let direction;
if(trendData?.length){
    const sig=score(trendData,price);
    direction=sig.dir;
}else{
    const sig=score(entryData,price);
    direction=sig.dir;
}
if(mtf.strength>=3){direction=mtf.direction==='BULLISH'?'BUY':'SELL';}
const turtleSoup=detectTurtleSoup(entryData);
if(turtleSoup.detected){direction=turtleSoup.type;}

// MSNR from structure TF
const msnr = calculateMSNR(structureData||entryData, price);

// Find entry zone from ENTRY timeframe (not trend timeframe!)
const zone=findPrecisionEntry(entryData,price,direction,msnr);
let entry=zone.p;

// Force entry to correct side
if(direction==='BUY'&&entry>=price){const nb=msnr.nearestSupport||price*0.99;entry=Math.min(zone.l,nb,price*0.995);}
if(direction==='SELL'&&entry<=price){const na=msnr.nearestResistance||price*1.01;entry=Math.max(zone.h,na,price*1.005);}

const a=atr(entryData,14);
const displacement=detectDisplacement(entryData,direction);
const sniperRej=await checkSniperRejection(zone,direction,sniperTF);
const volatility=getVolatilityLevel(a,price);
const sweeps=detectLiquiditySweeps(entryData,price);
const imbalances=findImbalances(entryData);
const mss=detectMSS(entryData);
const fvgsAll=detectFVG(entryData);
const breakersAll=detectBreakers(entryData);
const cl=entryData.map(c=>c.c);
const rs=rsi(cl,14);
const crt=detectCRT(entryData,direction);
const probCheck=checkProbability(zone,mtf);

if(!probCheck.passed){const failedChecks=probCheck.checks.filter(c=>!c.passed).map(c=>c.name);showNotif(`⚠️ Low prob - Failed: ${failedChecks.join(', ')}`,'warning');document.getElementById('jsonOutput').innerHTML=JSON.stringify({trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:'NEUTRAL',reason:`Low probability`,failed_checks:failedChecks,zone:zone.quality,confluence:zone.confluence,mtf:mtf.direction+' ('+mtf.strength+'/4)'}},null,2);btn.classList.remove('loading');btn.disabled=false;return;}

const slResult=calcStopLoss(entryData,direction,entry,zone,msnr);
const tps=calcTakeProfits(direction,entry,slResult.price);

let conf=sig? (mtf.direction===direction?Math.min(sig.conf+10,95):Math.max(sig.conf-15,30)) : 50;
if(zone.quality==='A')conf=Math.min(conf+15,98);else if(zone.quality==='B')conf=Math.min(conf+8,95);
if(displacement.detected)conf=Math.min(conf+5,98);
if(sniperRej.confirmed)conf=Math.min(conf+5,98);
if(probCheck.probability==='HIGH')conf=Math.min(conf+5,98);
if(turtleSoup.detected)conf=Math.min(conf+10,98);
if(crt.detected&&crt.pattern==='Expanding')conf=Math.min(conf+5,98);
if(twelveIndicators.macd_hist&&direction==='BUY'&&twelveIndicators.macd>twelveIndicators.macd_signal)conf=Math.min(conf+5,98);
if(twelveIndicators.macd_hist&&direction==='SELL'&&twelveIndicators.macd<twelveIndicators.macd_signal)conf=Math.min(conf+5,98);
if(twelveIndicators.adx&&twelveIndicators.adx>25)conf=Math.min(conf+5,98);

const sweepsText=sweeps.slice(0,3).map(s=>`${s.type}: $${s.level.toFixed(2)}`).join('; ')||'None';
const imbalancesText=imbalances.map(i=>`${i.type}: $${i.low.toFixed(2)}-$${i.high.toFixed(2)}`).join('; ')||'None';
const prec=getPrec(pair);

// Build timeframe alignment display
const tfAlign = `Trend:${trendTF} → Structure:${structureTF} → Entry:${entryTF} → Sniper:${sniperTF} | ${mtf.strength>=3?'STRONG':(mtf.strength>=2?'MODERATE':'WEAK')}`;

const marketData={tf:tf,entryTF:entryTF,sniperTF:sniperTF,tfAlign:tfAlign,price:price.toFixed(2),mtfDir:mtf.direction,mtfStr:mtf.strength,mtf5:mtf.trends['5M']||'--',mtf15:mtf.trends['15M']||'--',mtf1h:mtf.trends['1H']||'--',mtf4h:mtf.trends['4H']||'--',direction:direction,mss:mss?`${mss.type} at $${mss.level.toFixed(2)}`:'None',turtleSoup:turtleSoup.detected?`🐢 ${turtleSoup.type}`:'None',crt:crt.detected?`${crt.pattern} (${crt.rangeRatio}x)`:'Neutral',atr:a.toFixed(prec),volatility:volatility.level,rsi:rs.toFixed(1),twelveIndicators:twelveIndicators,zoneSrc:zone.src,zoneQuality:zone.quality,entryPrice:entry.toFixed(prec),zoneLow:zone.l.toFixed(prec),zoneHigh:zone.h.toFixed(prec),zoneConfluence:zone.confluence,confluenceCount:zone.cc,sweeps:sweepsText,imbalances:imbalancesText,msnrPivot:msnr.pivot.toFixed(prec),msnrS1:msnr.supports.S1?.toFixed(prec)||'--',msnrR1:msnr.resistances.R1?.toFixed(prec)||'--',suggestedSL:slResult.price.toFixed(prec),targetRR:settings.targetRR};
const ai=await askAI(marketData);

let dir,sl,tp1,tp2,tp3,reason,src,conviction,entryReason,slReason,possibleOutcomes;
if(ai&&ai.trade_signal_Theghostmachine){const ts=ai.trade_signal_Theghostmachine;dir=ts.trade_type.includes('BUY')?'BUY':'SELL';conf=conf;entry=parseFloat(ts.entry_price)||entry;sl=parseFloat(ts.stop_loss)||slResult.price;tp1=tps.tp1;tp2=tps.tp2;tp3=tps.tp3;reason=ts.analysis?.trend_detection||'AI';src='AI';conviction='HIGH';entryReason=ts.analysis?.technical_indicators?.join('; ')||'';slReason='AI optimized';possibleOutcomes=ts.analysis?.possible_outcomes||[];}
else if(ai&&ai.signal){dir=ai.signal;conf=ai.confidence||conf;entry=ai.entryPrice||entry;sl=ai.stopLoss||slResult.price;tp1=tps.tp1;tp2=tps.tp2;tp3=tps.tp3;reason=ai.entryReasoning||'AI';src='AI';conviction=ai.conviction||'MEDIUM';entryReason=ai.entryReasoning||'';slReason=ai.slReasoning||slResult.reason;possibleOutcomes=ai.possibleOutcomes||[];}
else{dir=direction;sl=slResult.price;tp1=tps.tp1;tp2=tps.tp2;tp3=tps.tp3;reason=`${zone.confluence} [Q:${zone.quality}]`;if(turtleSoup.detected)reason='🐢 '+turtleSoup.type;src=zone.src;conviction=probCheck.probability==='HIGH'?'HIGH':'MEDIUM';entryReason=`${zone.src} zone with ${zone.confluence}`;slReason=slResult.reason;possibleOutcomes=[`Price enters at $${entry.toFixed(prec)} and reverses`,`Sweep then reverse`,`Close beyond $${sl.toFixed(prec)} invalidates`];}

// FINAL VALIDATION
if(dir==='BUY'){if(sl>=entry)sl=entry-(entry*settings.maxSLPct);if(tp1<=entry)tp1=tps.tp1;if(tp2<=entry)tp2=tps.tp2;if(tp3<=entry)tp3=tps.tp3;}
if(dir==='SELL'){if(sl<=entry)sl=entry+(entry*settings.maxSLPct);if(tp1>=entry)tp1=tps.tp1;if(tp2>=entry)tp2=tps.tp2;if(tp3>=entry)tp3=tps.tp3;}

const st=dir==='BUY'?'LONG':'SHORT';const risk=Math.abs(entry-sl);const slDist=risk;const rr=(Math.abs(tp1-entry)/risk).toFixed(1);
document.getElementById('currentPrice').innerHTML=`$${price.toFixed(prec)}`;
if(lastPrice){const ch=((price-lastPrice)/lastPrice*100).toFixed(2);const ce=document.getElementById('priceChange');ce.innerHTML=`${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;ce.className=`price-change ${ch>=0?'up':'down'}`;}lastPrice=price;

const out={trade_signal:{date:new Date().toISOString().split('T')[0],time:new Date().toISOString().split('T')[1].split('.')[0],pair,timeframe:tf,current_price:price,trade_type:dir==='BUY'?'BUY-LIMIT':'SELL-LIMIT',entry_price:entry,stop_loss:sl,risk_amount:slDist.toFixed(prec),stop_loss_pct:((slDist/entry)*100).toFixed(2)+'%',take_profit_1:tp1,take_profit_2:tp2,take_profit_3:tp3,risk_reward:'1:'+rr,confidence:conf,conviction:conviction,entry_source:src,ai_used:src==='AI',entry_reasoning:entryReason,sl_reasoning:slReason,possible_outcomes:possibleOutcomes,zone_quality:zone.quality,zone_confluence:zone.confluence,confluence_count:zone.cc,probability:probCheck.probability,timeframe_alignment:{trend_tf:trendTF,structure_tf:structureTF,entry_tf:entryTF,sniper_tf:sniperTF,alignment:`${trendTF} → ${structureTF} → ${entryTF} → ${sniperTF}`,trend_direction:mtf.direction,trend_strength:mtf.strength+'/4 TFs',sniper_confirmation:sniperRej.confirmed?'✅ Confirmed':'⚠️ No rejection'},turtle_soup:turtleSoup,crt_analysis:crt,twelve_data_indicators:twelveIndicators,msnr_levels:{pivot:msnr.pivot.toFixed(prec),supports:{S1:msnr.supports.S1?.toFixed(prec),S2:msnr.supports.S2?.toFixed(prec),S3:msnr.supports.S3?.toFixed(prec)},resistances:{R1:msnr.resistances.R1?.toFixed(prec),R2:msnr.resistances.R2?.toFixed(prec),R3:msnr.resistances.R3?.toFixed(prec)}},sweeps:sweeps.filter(s=>s.distance<a*2).map(s=>({type:s.type,level:s.level,distance:s.distance})),analysis:{trend_detection:`${mtf.direction} (${mtf.strength}/4 TFs)${mtf.strength>=3?' - STRONG':''}`,volatility_level:`${volatility.level} - ${volatility.desc}`,market_structure:{mss:mss?mss.type:'None',displacement:displacement.detected,sniper_rejection:sniperRej.confirmed,turtle_soup:turtleSoup.detected,crt_pattern:crt.pattern},indicator_confluence:{macd:twelveIndicators.macd?`${twelveIndicators.macd>twelveIndicators.macd_signal?'Bullish':'Bearish'}`:'N/A',adx:twelveIndicators.adx?`${twelveIndicators.adx>25?'Trending':'Ranging'}`:'N/A',stochastic:twelveIndicators.stoch_k?`K:${twelveIndicators.stoch_k} D:${twelveIndicators.stoch_d}`:'N/A'},technical_indicators:[`RSI: ${twelveIndicators.rsi||rs.toFixed(1)}`,`MACD: ${twelveIndicators.macd||'N/A'}`,`ADX: ${twelveIndicators.adx||'N/A'}`,`FVG: ${fvgsAll.length} (${fvgsAll.filter(f=>f.fresh).length} fresh)`],reasoning:reason}}};

document.getElementById('jsonOutput').innerHTML=JSON.stringify(out,null,2);
analysis={signalType:st,idealEntry:entry,currentPrice:price,stopLoss:sl,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,confidence:conf};
document.getElementById('executeBtn').disabled=false;
showNotif(`✅ ${st} ${conf}% | ${zone.quality} | TF:${trendTF}→${entryTF} | 1:${rr}`,'success');
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
