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

function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){if(d[i-1].h<d[i+1].l&&d[i+1].l-d[i-1].h>d[i+1].c*0.0005)f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2});if(d[i-1].l>d[i+1].h&&d[i-1].l-d[i+1].h>d[i+1].c*0.0005)f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2});}return f;}
function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}

// ============================================
// LIQUIDITY SWEEPS (Filtered by proximity)
// ============================================
function detectLiquiditySweeps(data, currentPrice) {
    const sweeps = [];
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const closes = data.map(c => c.c);
    const a = atr(data, 14);
    const maxDistance = a * 3;
    
    for (let i = 10; i < data.length - 3; i++) {
        const recentHighs = highs.slice(i-5, i);
        const maxHigh = Math.max(...recentHighs);
        const tolerance = maxHigh * 0.001;
        const equalHighCount = recentHighs.filter(h => Math.abs(h - maxHigh) <= tolerance).length;
        
        if (equalHighCount >= 2 && Math.abs(maxHigh - currentPrice) <= maxDistance) {
            const nextCandles = data.slice(i, i+4);
            if (nextCandles.some(c => c.h > maxHigh + tolerance) && closes[i+3] < maxHigh) {
                sweeps.push({type:'BUY_SIDE_SWEPT',level:maxHigh,distance:Math.abs(maxHigh-currentPrice),direction:'BEARISH'});
            }
        }
        
        const recentLows = lows.slice(i-5, i);
        const minLow = Math.min(...recentLows);
        const lowTolerance = minLow * 0.001;
        const equalLowCount = recentLows.filter(l => Math.abs(l - minLow) <= lowTolerance).length;
        
        if (equalLowCount >= 2 && Math.abs(minLow - currentPrice) <= maxDistance) {
            const nextCandles = data.slice(i, i+4);
            if (nextCandles.some(c => c.l < minLow - lowTolerance) && closes[i+3] > minLow) {
                sweeps.push({type:'SELL_SIDE_SWEPT',level:minLow,distance:Math.abs(minLow-currentPrice),direction:'BULLISH'});
            }
        }
    }
    return sweeps.sort((a,b) => a.distance - b.distance);
}

function findImbalances(data) {
    const imbalances = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (data[i-1].l > data[i+1].h) imbalances.push({type:'BULLISH_IMBALANCE',low:data[i+1].h,high:data[i-1].l});
        if (data[i-1].h < data[i+1].l) imbalances.push({type:'BEARISH_IMBALANCE',low:data[i-1].h,high:data[i+1].l});
    }
    return imbalances.slice(-5);
}

// ============================================
// STOP LOSS (Capped)
// ============================================
function calcStopLoss(data, dir, entry, zone) {
    const a = atr(data, 14);
    const swings = findSwings(data, 4);
    const fvgs = detectFVG(data);
    const maxSLPercent = isGold(pair) ? 0.008 : (isForex(pair) ? 0.003 : 0.015);
    const maxSLDistance = entry * maxSLPercent;
    
    if (dir === 'BUY') {
        const swingLows = swings.L.filter(s => s.p < entry && s.p > entry - maxSLDistance*2).sort((a,b) => b.p - a.p);
        const bullFVGs = fvgs.filter(f => f.type==='bull' && f.l < entry && f.l > entry - maxSLDistance*2).sort((a,b) => b.l - a.l);
        let stopPrice = null, stopReason = '';
        if (swingLows.length > 0) { const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15); const pSL = swingLows[0].p - buf; if (entry - pSL <= maxSLDistance) { stopPrice = pSL; stopReason = `Below swing ${swingLows[0].p.toFixed(getPrec(pair))}`; } }
        if (!stopPrice && bullFVGs.length > 0) { const buf = isGold(pair) ? 1.5 : (isForex(pair) ? a * 0.15 : a * 0.1); const pSL = bullFVGs[0].l - buf; if (entry - pSL <= maxSLDistance) { stopPrice = pSL; stopReason = `Below FVG ${bullFVGs[0].l.toFixed(getPrec(pair))}`; } }
        if (!stopPrice && zone) { const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15); const pSL = zone.l - buf; if (entry - pSL <= maxSLDistance) { stopPrice = pSL; stopReason = `Below zone ${zone.l.toFixed(getPrec(pair))}`; } }
        if (!stopPrice) { stopPrice = Math.max(entry - a * 0.7, entry - maxSLDistance); stopReason = `Capped at ${(maxSLPercent*100).toFixed(1)}%`; }
        return { price: stopPrice, reason: stopReason };
    } else {
        const swingHighs = swings.H.filter(s => s.p > entry && s.p < entry + maxSLDistance*2).sort((a,b) => a.p - b.p);
        const bearFVGs = fvgs.filter(f => f.type==='bear' && f.h > entry && f.h < entry + maxSLDistance*2).sort((a,b) => a.h - b.h);
        let stopPrice = null, stopReason = '';
        if (swingHighs.length > 0) { const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15); const pSL = swingHighs[0].p + buf; if (pSL - entry <= maxSLDistance) { stopPrice = pSL; stopReason = `Above swing ${swingHighs[0].p.toFixed(getPrec(pair))}`; } }
        if (!stopPrice && bearFVGs.length > 0) { const buf = isGold(pair) ? 1.5 : (isForex(pair) ? a * 0.15 : a * 0.1); const pSL = bearFVGs[0].h + buf; if (pSL - entry <= maxSLDistance) { stopPrice = pSL; stopReason = `Above FVG ${bearFVGs[0].h.toFixed(getPrec(pair))}`; } }
        if (!stopPrice && zone) { const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15); const pSL = zone.h + buf; if (pSL - entry <= maxSLDistance) { stopPrice = pSL; stopReason = `Above zone ${zone.h.toFixed(getPrec(pair))}`; } }
        if (!stopPrice) { stopPrice = Math.min(entry + a * 0.7, entry + maxSLDistance); stopReason = `Capped at ${(maxSLPercent*100).toFixed(1)}%`; }
        return { price: stopPrice, reason: stopReason };
    }
}

function enforceSLCap(slPrice, entry, dir) {
    const maxSLPercent = isGold(pair) ? 0.008 : (isForex(pair) ? 0.003 : 0.015);
    const maxSLDistance = entry * maxSLPercent;
    if (dir === 'BUY') { const minSL = entry - maxSLDistance; if (slPrice < minSL) return { price: minSL, capped: true }; }
    else { const maxSL = entry + maxSLDistance; if (slPrice > maxSL) return { price: maxSL, capped: true }; }
    return { price: slPrice, capped: false };
}

// ============================================
// SIGNAL SCORING (TREND-FOLLOWING ENFORCED)
// ============================================
function score(data, price, mtfDirection, mtfStrength) {
    const a = atr(data), cl = data.map(c=>c.c), rs = rsi(cl);
    const fv = detectFVG(data), ms = detectMSS(data), bk = detectBreakers(data);
    const sweeps = detectLiquiditySweeps(data, price);
    const e20 = ema(cl,20), e50 = ema(cl,50), cE20 = e20[e20.length-1], cE50 = e50[e50.length-1];
    
    const bF = fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);
    const sF = fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);
    const bB = bk.filter(b=>b.type==='BULL'&&b.p<price);
    const sB = bk.filter(b=>b.type==='BEAR'&&b.p>price);
    
    const recentSellSweep = sweeps.filter(s => s.type === 'SELL_SIDE_SWEPT')[0];
    const recentBuySweep = sweeps.filter(s => s.type === 'BUY_SIDE_SWEPT')[0];
    
    let bS=0, sS=0, bR=[], sR=[];
    
    // TREND ALIGNMENT BONUS/PENALTY
    if (mtfDirection === 'BULLISH') {
        bS += 20; bR.push('MTF Bull trend');
        if (mtfStrength >= 3) { bS += 10; bR.push('Strong trend'); }
        // In bullish trend, sweeps CONFIRM direction
        if (recentSellSweep) { bS += 25; bR.push(`Sweep confirms trend`); }
    } else if (mtfDirection === 'BEARISH') {
        sS += 20; sR.push('MTF Bear trend');
        if (mtfStrength >= 3) { sS += 10; sR.push('Strong trend'); }
        if (recentBuySweep) { sS += 25; sR.push(`Sweep confirms trend`); }
    } else {
        // Neutral MTF - sweeps determine direction
        if (recentSellSweep) { bS += 30; bR.push(`Sell swept`); }
        if (recentBuySweep) { sS += 30; sR.push(`Buy swept`); }
    }
    
    if(ms?.type==='BULL'){ bS+=15; bR.push('MSS Bull'); } else if(ms?.type==='BEAR'){ sS+=15; sR.push('MSS Bear'); }
    if(bF.length){ bS+=15; bR.push(`FVG ${bF[0].l.toFixed(2)}`); }
    if(sF.length){ sS+=15; sR.push(`FVG ${sF[0].h.toFixed(2)}`); }
    if(bB.length){ bS+=10; bR.push('Breaker sup'); }
    if(sB.length){ sS+=10; sR.push('Breaker res'); }
    if(cE20>cE50){ bS+=10; } else { sS+=10; }
    if(rs>50) bS+=5; else sS+=5;
    
    // FORCE direction to match MTF if strong trend (3+ TFs)
    let dir, conf, zone, reason;
    
    if (mtfStrength >= 3) {
        // STRONG TREND - Force direction
        dir = mtfDirection === 'BULLISH' ? 'BUY' : 'SELL';
        conf = mtfDirection === 'BULLISH' ? Math.min(bS+15, 95) : Math.min(sS+15, 95);
        reason = `STRONG ${mtfDirection} TREND | ` + (mtfDirection==='BULLISH'?bR.join('; '):sR.join('; '));
        
        if (dir === 'BUY') {
            if(bF.length) zone={p:bF[0].m,l:bF[0].l,h:bF[0].h,src:'FVG'};
            else if(bB.length) zone={p:bB[0].p,l:bB[0].p-a*.5,h:bB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rL+r*.7,l:rL+r*.618,h:rL+r*.79,src:'OTE'}; }
        } else {
            if(sF.length) zone={p:sF[0].m,l:sF[0].l,h:sF[0].h,src:'FVG'};
            else if(sB.length) zone={p:sB[0].p,l:sB[0].p-a*.5,h:sB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rH-r*.3,l:rH-r*.382,h:rH-r*.5,src:'OTE'}; }
        }
    } else {
        // Weak/Neutral trend - scoring decides
        if(bS>sS&&bS>=40){ dir='BUY'; conf=Math.min(bS+10,90); reason=bR.join('; ');
            if(bF.length) zone={p:bF[0].m,l:bF[0].l,h:bF[0].h,src:'FVG'};
            else if(bB.length) zone={p:bB[0].p,l:bB[0].p-a*.5,h:bB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rL+r*.7,l:rL+r*.618,h:rL+r*.79,src:'OTE'}; }
        } else if(sS>bS&&sS>=40){ dir='SELL'; conf=Math.min(sS+10,90); reason=sR.join('; ');
            if(sF.length) zone={p:sF[0].m,l:sF[0].l,h:sF[0].h,src:'FVG'};
            else if(sB.length) zone={p:sB[0].p,l:sB[0].p-a*.5,h:sB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rH-r*.3,l:rH-r*.382,h:rH-r*.5,src:'OTE'}; }
        } else { dir='NEUTRAL'; conf=0; reason=`B:${bS} S:${sS}`; zone=null; }
    }
    
    return {dir,conf,zone,reason,scores:{bS,sS},sweeps};
}

// ============================================
// MULTI-TF & GET MTF CONSENSUS
// ============================================
async function getMTFConsensus() {
    const tfs=['5M','15M','1H','4H'];
    let bullCount=0, bearCount=0;
    const trends={};
    
    for(let t of tfs){
        let d=await getHistory(t); if(!d||d.length<30) continue;
        let c=d.map(x=>x.c), tr=c[c.length-1]>c[c.length-20]?'BULLISH':(c[c.length-1]<c[c.length-20]?'BEARISH':'NEUTRAL');
        trends[t]=tr;
        if(tr==='BULLISH')bullCount++; else if(tr==='BEARISH')bearCount++;
        let el=document.getElementById(`trend${t}`); if(el){ el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut'); el.className=`mtf-trend ${tr.toLowerCase()}`; }
    }
    
    const direction = bullCount > bearCount ? 'BULLISH' : (bearCount > bullCount ? 'BEARISH' : 'NEUTRAL');
    const strength = Math.max(bullCount, bearCount);
    
    return { direction, strength, bullCount, bearCount, trends };
}

// ============================================
// AI (TREND-FOLLOWING ENFORCED)
// ============================================
async function askAI(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotif('🤖 AI analyzing...','info');
    
    const prompt = `You are an ELITE ICT SNIPER. You ONLY trade WITH the trend.

CRITICAL RULE: The market trend is ${marketData.mtfDirection} (${marketData.mtfStrength}/4 timeframes agree).
You MUST only give ${marketData.mtfDirection === 'BULLISH' ? 'BUY' : (marketData.mtfDirection === 'BEARISH' ? 'SELL' : 'BUY or SELL')} signals.
${marketData.mtfStrength >= 3 ? 'THIS IS A STRONG TREND. DO NOT FIGHT IT. Only give ' + (marketData.mtfDirection === 'BULLISH' ? 'BUY' : 'SELL') + ' signals.' : ''}

For a ${marketData.mtfDirection === 'BULLISH' ? 'BUY (bullish trend)' : (marketData.mtfDirection === 'BEARISH' ? 'SELL (bearish trend)' : 'BUY or SELL')}:
- Entry at discount FVG/OTE edge (wait for pullback into demand zone)
- SL tight below the zone
- TP at opposing liquidity above

CONTEXT:
- Pair: ${pair} | Timeframe: ${tf} | Price: $${marketData.price}
- MTF: 5M=${marketData.mtf5} 15M=${marketData.mtf15} 1H=${marketData.mtf1h} 4H=${marketData.mtf4h}
- Scoring: Bull=${marketData.bS} Bear=${marketData.sS}
- Entry Zone: ${marketData.zoneSrc} $${marketData.entryPrice} (${marketData.zoneLow}-${marketData.zoneHigh})
- Suggested SL: $${marketData.suggestedSL}
- Sweeps: ${marketData.sweeps || 'None'}
- Imbalances: ${marketData.imbalances || 'None'}

Return JSON:
{"signal":"${marketData.mtfDirection === 'BULLISH' ? 'BUY' : (marketData.mtfDirection === 'BEARISH' ? 'SELL' : 'BUY')}","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit1":#,"takeProfit2":#,"takeProfit3":#,"reasoning":"Brief analysis"}`;

    try {
        const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You ONLY trade WITH the trend. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:800})});
        const d = await r.json();
        if (d.choices?.[0]) { const m = d.choices[0].message.content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
        if (d.error) console.error('AI error:', d.error);
    } catch(e) { console.error('AI fetch:', e); }
    return null;
}

// ============================================
// MAIN
// ============================================
async function runAnalysis() {
    const btn = document.getElementById('analyzeBtn');
    btn.classList.add('loading'); btn.disabled = true;
    if (!TWELVE_DATA_KEY) { showNotif('⚠️ Set Twelve Data key!','error'); btn.classList.remove('loading'); btn.disabled=false; return; }
    showNotif('🔍 Analyzing MTF...','info');
    
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        
        // GET MTF CONSENSUS FIRST
        const mtf = await getMTFConsensus();
        
        const data = await getHistory(); if (!data?.length) throw new Error('No data');
        
        // Pass MTF direction to scoring
        const sig = score(data, price, mtf.direction, mtf.strength);
        if (!sig.zone) throw new Error('No entry zone');
        
        const slResult = calcStopLoss(data, sig.dir, sig.zone.p, sig.zone);
        const imbalances = findImbalances(data);
        
        const recentHigh = Math.max(...data.slice(-20).map(c=>c.h));
        const recentLow = Math.min(...data.slice(-20).map(c=>c.l));
        const range = recentHigh - recentLow;
        
        const sweepsText = sig.sweeps.length > 0 
            ? sig.sweeps.slice(0,2).map(s => `${s.type} at $${s.level.toFixed(2)}`).join('; ')
            : 'None';
        
        const marketData = {
            price: price.toFixed(2), bS: sig.scores.bS, sS: sig.scores.sS,
            mtfDirection: mtf.direction, mtfStrength: mtf.strength,
            mtf5: mtf.trends['5M']||'--', mtf15: mtf.trends['15M']||'--',
            mtf1h: mtf.trends['1H']||'--', mtf4h: mtf.trends['4H']||'--',
            sweeps: sweepsText,
            imbalances: imbalances.length>0?imbalances.map(i=>`${i.type}: $${i.low.toFixed(2)}-$${i.high.toFixed(2)}`).join('; '):'None',
            zoneSrc: sig.zone.src, entryPrice: sig.zone.p.toFixed(2),
            zoneLow: sig.zone.l.toFixed(2), zoneHigh: sig.zone.h.toFixed(2),
            suggestedSL: slResult.price.toFixed(2),
            fib0: recentLow.toFixed(2), fib382: (recentLow+range*.382).toFixed(2),
            fib500: (recentLow+range*.5).toFixed(2), fib618: (recentLow+range*.618).toFixed(2),
            fib786: (recentLow+range*.786).toFixed(2), fib100: recentHigh.toFixed(2)
        };
        
        const ai = await askAI(marketData);
        
        let dir, conf, entry, sl, tp1, tp2, tp3, reason, src;
        
        if (ai && (ai.signal==='BUY'||ai.signal==='SELL')) {
            // Validate AI didn't fight the trend
            if (mtf.strength >= 3) {
                if (mtf.direction === 'BULLISH' && ai.signal === 'SELL') {
                    // AI fought strong trend - REJECT
                    dir = 'BUY'; conf = sig.conf; entry = sig.zone.p; sl = slResult.price;
                    reason = 'AI overridden - Strong bullish trend | ' + sig.reason;
                    src = 'RULE';
                } else if (mtf.direction === 'BEARISH' && ai.signal === 'BUY') {
                    dir = 'SELL'; conf = sig.conf; entry = sig.zone.p; sl = slResult.price;
                    reason = 'AI overridden - Strong bearish trend | ' + sig.reason;
                    src = 'RULE';
                } else {
                    dir = ai.signal; conf = ai.confidence||sig.conf; entry = ai.entryPrice||sig.zone.p;
                    const cappedSL = enforceSLCap(ai.stopLoss||slResult.price, entry, dir==='BUY'?'BUY':'SELL');
                    sl = cappedSL.price; reason = ai.reasoning||'AI signal'; src = 'AI';
                }
            } else {
                dir = ai.signal; conf = ai.confidence||sig.conf; entry = ai.entryPrice||sig.zone.p;
                const cappedSL = enforceSLCap(ai.stopLoss||slResult.price, entry, dir==='BUY'?'BUY':'SELL');
                sl = cappedSL.price; reason = ai.reasoning||'AI signal'; src = 'AI';
            }
            tp1 = ai.takeProfit1; tp2 = ai.takeProfit2; tp3 = ai.takeProfit3;
        } else {
            dir = sig.dir; conf = sig.conf; entry = sig.zone.p; sl = slResult.price;
            const risk = Math.abs(entry-sl);
            tp1 = dir==='BUY'?entry+risk*2.5:entry-risk*2.5;
            tp2 = dir==='BUY'?entry+risk*4:entry-risk*4;
            tp3 = dir==='BUY'?entry+risk*6:entry-risk*6;
            reason = sig.reason + ' | SL: ' + slResult.reason; src = sig.zone.src;
        }
        
        const st = dir==='BUY'?'LONG':(dir==='SELL'?'SHORT':'NEUTRAL');
        const prec = getPrec(pair);
        const rr = (Math.abs(tp1-entry)/Math.abs(entry-sl)).toFixed(1);
        
        document.getElementById('currentPrice').innerHTML = `$${price.toFixed(prec)}`;
        if (lastPrice) {
            const ch = ((price-lastPrice)/lastPrice*100).toFixed(2);
            const ce = document.getElementById('priceChange');
            ce.innerHTML = `${ch>=0?'▲':'▼'} ${Math.abs(ch)}%`;
            ce.className = `price-change ${ch>=0?'up':'down'}`;
        }
        lastPrice = price;
        
        const out = {
            trade_signal: {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toISOString().split('T')[1].split('.')[0],
                pair, timeframe: tf, current_price: price,
                trade_type: dir==='BUY'?'BUY-LIMIT':(dir==='SELL'?'SELL-LIMIT':'NEUTRAL'),
                entry_price: entry, stop_loss: sl,
                stop_loss_pct: ((Math.abs(entry-sl)/entry)*100).toFixed(2) + '%',
                take_profit_1: tp1, take_profit_2: tp2, take_profit_3: tp3,
                risk_reward: rr, confidence: conf,
                entry_source: src, ai_used: src==='AI',
                mtf_consensus: `${mtf.direction} (${mtf.strength}/4 TFs)`,
                analysis: {
                    scoring: { bullish: sig.scores.bS, bearish: sig.scores.sS },
                    multi_timeframe: { "5M":marketData.mtf5, "15M":marketData.mtf15, "1H":marketData.mtf1h, "4H":marketData.mtf4h },
                    reasoning: reason
                }
            }
        };
        
        document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);
        analysis = { signalType:st, idealEntry:entry, currentPrice:price, stopLoss:sl, takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3, confidence:conf };
        document.getElementById('executeBtn').disabled = st==='NEUTRAL';
        showNotif(src==='AI'?`🎯 AI: ${st} ${conf}%`:`✅ ${st} ${conf}% (${mtf.direction})`,'success');
    } catch(e) { console.error(e); showNotif('Error: '+e.message,'error'); }
    finally { btn.classList.remove('loading'); btn.disabled=false; }
}

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
