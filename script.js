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

// ============================================
// IMPROVEMENT #1: FRESH FVG DETECTION
// ============================================
function detectFVG(d){let f=[];for(let i=1;i<d.length-1;i++){
    if(d[i-1].h<d[i+1].l&&d[i+1].l-d[i-1].h>d[i+1].c*0.0005){
        let mitigated=false;
        for(let j=i+2;j<d.length;j++){if(d[j].l<=d[i+1].l&&d[j].l>=d[i-1].h){mitigated=true;break;}}
        f.push({type:'bull',l:d[i-1].h,h:d[i+1].l,m:(d[i-1].h+d[i+1].l)/2,fresh:!mitigated});
    }
    if(d[i-1].l>d[i+1].h&&d[i-1].l-d[i+1].h>d[i+1].c*0.0005){
        let mitigated=false;
        for(let j=i+2;j<d.length;j++){if(d[j].h>=d[i+1].h&&d[j].h<=d[i-1].l){mitigated=true;break;}}
        f.push({type:'bear',l:d[i+1].h,h:d[i-1].l,m:(d[i+1].h+d[i-1].l)/2,fresh:!mitigated});
    }
}return f;}

function findSwings(d,lb=3){let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);for(let i=lb;i<h.length-lb;i++){let iH=true,iL=true;for(let j=1;j<=lb;j++){if(h[i]<=h[i-j]||h[i]<=h[i+j])iH=false;if(l[i]>=l[i-j]||l[i]>=l[i+j])iL=false;}if(iH)H.push({p:h[i],i});if(iL)L.push({p:l[i],i});}return{H,L};}
function detectMSS(d){let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];if(cP>rH)return{type:'BULL',level:rH};if(cP<rL)return{type:'BEAR',level:rL};return null;}
function detectBreakers(d){let b=[],s=findSwings(d);for(let i=5;i<d.length-5;i++){let c=d[i];if(c.c>c.o){let r=s.H.find(h=>h.i<i&&h.p<c.c);if(r)b.push({type:'BULL',p:r.p});}if(c.c<c.o){let sp=s.L.find(l=>l.i<i&&l.p>c.c);if(sp)b.push({type:'BEAR',p:sp.p});}}return b;}
function detectTrend(data){const closes=data.map(c=>c.c);const e20=ema(closes,20),e50=ema(closes,50);const cE20=e20[e20.length-1],cE50=e50[e50.length-1];if(cE20>cE50)return'BULLISH';if(cE20<cE50)return'BEARISH';return'NEUTRAL';}

// ============================================
// IMPROVEMENT #2: DISPLACEMENT DETECTION
// ============================================
function detectDisplacement(data, direction) {
    if (data.length < 5) return { detected: false, reason: 'Not enough data' };
    
    const lastCandles = data.slice(-5);
    const bodies = lastCandles.map(c => Math.abs(c.c - c.o));
    const avgBody = bodies.reduce((a,b) => a+b, 0) / bodies.length;
    const lastBody = bodies[bodies.length - 1];
    
    // Displacement = candle body 2x larger than average
    const isDisplacement = lastBody > avgBody * 2;
    
    if (direction === 'BUY') {
        const lastCandle = lastCandles[lastCandles.length - 1];
        const isBullish = lastCandle.c > lastCandle.o;
        const brokeHigh = lastCandle.c > Math.max(...data.slice(-10, -1).map(c => c.h));
        
        if (isDisplacement && isBullish && brokeHigh) {
            return { detected: true, reason: 'Bullish displacement - strong move up breaking structure' };
        }
        if (isDisplacement && isBullish) {
            return { detected: true, reason: 'Bullish displacement - above average momentum' };
        }
    } else {
        const lastCandle = lastCandles[lastCandles.length - 1];
        const isBearish = lastCandle.c < lastCandle.o;
        const brokeLow = lastCandle.c < Math.min(...data.slice(-10, -1).map(c => c.l));
        
        if (isDisplacement && isBearish && brokeLow) {
            return { detected: true, reason: 'Bearish displacement - strong move down breaking structure' };
        }
        if (isDisplacement && isBearish) {
            return { detected: true, reason: 'Bearish displacement - above average momentum' };
        }
    }
    
    return { detected: false, reason: 'No displacement detected' };
}

// ============================================
// IMPROVEMENT #3: 5M REJECTION CHECK
// ============================================
async function check5MRejection(entryZone, direction) {
    const d5m = await getHistory('5M');
    if (!d5m || d5m.length < 5) return { confirmed: false, reason: 'No 5M data' };
    
    const lastCandle = d5m[d5m.length - 1];
    const body = Math.abs(lastCandle.c - lastCandle.o);
    const totalRange = lastCandle.h - lastCandle.l;
    
    if (direction === 'BUY') {
        const lowerWick = Math.min(lastCandle.o, lastCandle.c) - lastCandle.l;
        const touchedZone = lastCandle.l <= entryZone.h && lastCandle.l >= entryZone.l;
        const bullishClose = lastCandle.c > lastCandle.o;
        const significantWick = lowerWick > body * 1.5 || lowerWick > totalRange * 0.4;
        
        if (touchedZone && significantWick && bullishClose) {
            return { confirmed: true, reason: '5M bullish rejection wick at zone - SNIPER ENTRY' };
        }
        if (touchedZone && lowerWick > body) {
            return { confirmed: true, reason: '5M wick at zone - moderate confirmation' };
        }
        if (touchedZone) {
            return { confirmed: false, reason: 'Price at zone on 5M but no rejection yet' };
        }
    } else {
        const upperWick = lastCandle.h - Math.max(lastCandle.o, lastCandle.c);
        const touchedZone = lastCandle.h >= entryZone.l && lastCandle.h <= entryZone.h;
        const bearishClose = lastCandle.c < lastCandle.o;
        const significantWick = upperWick > body * 1.5 || upperWick > totalRange * 0.4;
        
        if (touchedZone && significantWick && bearishClose) {
            return { confirmed: true, reason: '5M bearish rejection wick at zone - SNIPER ENTRY' };
        }
        if (touchedZone && upperWick > body) {
            return { confirmed: true, reason: '5M wick at zone - moderate confirmation' };
        }
        if (touchedZone) {
            return { confirmed: false, reason: 'Price at zone on 5M but no rejection yet' };
        }
    }
    
    return { confirmed: false, reason: 'Price not at entry zone on 5M yet' };
}

// ============================================
// IMPROVEMENT #4: DEEP DISCOUNT ZONE (OTE)
// ============================================
function findDeepDiscountZone(data, direction) {
    const highs = data.map(c => c.h);
    const lows = data.map(c => c.l);
    const recentHigh = Math.max(...highs.slice(-30));
    const recentLow = Math.min(...lows.slice(-30));
    const range = recentHigh - recentLow;
    
    // Check if there's been a significant move (displacement)
    const lastMove = Math.abs(data[data.length-1].c - data[data.length-10].c);
    const avgRange = atr(data, 14) * 2;
    
    // Only use deep OTE if there's been a big move
    if (lastMove < avgRange) return null;
    
    if (direction === 'BUY') {
        const oteLow = recentLow + range * 0.618;
        const oteHigh = recentLow + range * 0.79;
        const optimalEntry = (oteLow + oteHigh) / 2;
        return {
            low: oteLow,
            high: oteHigh,
            optimal: optimalEntry,
            source: 'DEEP OTE (61.8%-79%)',
            reason: `Deep discount zone after ${lastMove.toFixed(1)} move`
        };
    } else {
        const oteLow = recentHigh - range * 0.79;
        const oteHigh = recentHigh - range * 0.618;
        const optimalEntry = (oteLow + oteHigh) / 2;
        return {
            low: oteLow,
            high: oteHigh,
            optimal: optimalEntry,
            source: 'DEEP OTE (61.8%-79%)',
            reason: `Deep premium zone after ${lastMove.toFixed(1)} move`
        };
    }
}

// ============================================
// STOP LOSS (ATR-based by timeframe)
// ============================================
function getSLBuffer(atrValue) {
    const buffers = {
        'XAU/USD':{'5M':Math.max(atrValue*0.8,4),'15M':Math.max(atrValue*1.0,6),'1H':Math.max(atrValue*1.2,10),'4H':Math.max(atrValue*1.5,15),'1D':Math.max(atrValue*2.0,25)},
        'EUR/USD':{'5M':Math.max(atrValue*0.8,0.0003),'15M':Math.max(atrValue*1.0,0.0005),'1H':Math.max(atrValue*1.2,0.0008),'4H':Math.max(atrValue*1.5,0.0012),'1D':Math.max(atrValue*2.0,0.0020)}
    };
    const key = isGold(pair) ? 'XAU/USD' : (isForex(pair) ? 'EUR/USD' : 'XAU/USD');
    return (buffers[key] && buffers[key][tf]) ? buffers[key][tf] : Math.max(atrValue * 1.5, 15);
}

function calcStopLoss(data, dir, entry, zone) {
    const a = atr(data, 14);
    const swings = findSwings(data, 4);
    const fvgs = detectFVG(data);
    const minBuffer = getSLBuffer(a);
    const maxSLPercent = isGold(pair) ? 0.01 : (isForex(pair) ? 0.005 : 0.02);
    const maxSLDistance = entry * maxSLPercent;
    
    if (dir === 'BUY') {
        const allSwings = swings.L.filter(s => s.p < entry).sort((a,b) => b.p - a.p);
        const bullFVGs = fvgs.filter(f => f.type==='bull' && f.l < entry).sort((a,b) => b.l - a.l);
        let stopPrice = null, stopReason = '';
        
        for (const swing of allSwings) {
            const distance = entry - swing.p;
            if (distance >= minBuffer * 0.5 && distance <= maxSLDistance * 1.5) {
                stopPrice = swing.p - (minBuffer * 0.3);
                stopReason = `Below swing ${swing.p.toFixed(getPrec(pair))}`;
                break;
            }
        }
        if (!stopPrice && bullFVGs.length > 0) {
            const nearestFVG = bullFVGs[0];
            const distance = entry - nearestFVG.l;
            if (distance >= minBuffer * 0.5 && distance <= maxSLDistance * 1.5) {
                stopPrice = nearestFVG.l - (minBuffer * 0.25);
                stopReason = `Below FVG ${nearestFVG.l.toFixed(getPrec(pair))}`;
            }
        }
        if (!stopPrice) { stopPrice = entry - minBuffer; stopReason = `ATR buffer`; }
        
        const finalDistance = entry - stopPrice;
        if (finalDistance < minBuffer * 0.6) { stopPrice = entry - minBuffer; stopReason = `Min ATR`; }
        if (finalDistance > maxSLDistance) { stopPrice = entry - maxSLDistance; stopReason = `Capped`; }
        
        return { price: stopPrice, reason: stopReason, distance: entry - stopPrice };
    } else {
        const allSwings = swings.H.filter(s => s.p > entry).sort((a,b) => a.p - b.p);
        const bearFVGs = fvgs.filter(f => f.type==='bear' && f.h > entry).sort((a,b) => a.h - b.h);
        let stopPrice = null, stopReason = '';
        
        for (const swing of allSwings) {
            const distance = swing.p - entry;
            if (distance >= minBuffer * 0.5 && distance <= maxSLDistance * 1.5) {
                stopPrice = swing.p + (minBuffer * 0.3);
                stopReason = `Above swing ${swing.p.toFixed(getPrec(pair))}`;
                break;
            }
        }
        if (!stopPrice && bearFVGs.length > 0) {
            const nearestFVG = bearFVGs[0];
            const distance = nearestFVG.h - entry;
            if (distance >= minBuffer * 0.5 && distance <= maxSLDistance * 1.5) {
                stopPrice = nearestFVG.h + (minBuffer * 0.25);
                stopReason = `Above FVG ${nearestFVG.h.toFixed(getPrec(pair))}`;
            }
        }
        if (!stopPrice) { stopPrice = entry + minBuffer; stopReason = `ATR buffer`; }
        
        const finalDistance = stopPrice - entry;
        if (finalDistance < minBuffer * 0.6) { stopPrice = entry + minBuffer; stopReason = `Min ATR`; }
        if (finalDistance > maxSLDistance) { stopPrice = entry + maxSLDistance; stopReason = `Capped`; }
        
        return { price: stopPrice, reason: stopReason, distance: stopPrice - entry };
    }
}

function enforceSLCap(slPrice, entry, dir) {
    const maxSLPercent = isGold(pair) ? 0.01 : (isForex(pair) ? 0.005 : 0.02);
    const maxSLDistance = entry * maxSLPercent;
    if (dir === 'BUY') { const minSL = entry - maxSLDistance; if (slPrice < minSL) return { price: minSL, capped: true }; }
    else { const maxSL = entry + maxSLDistance; if (slPrice > maxSL) return { price: maxSL, capped: true }; }
    return { price: slPrice, capped: false };
}

// ============================================
// SIGNAL SCORING
// ============================================
function score(data, price, mtfDirection, mtfStrength) {
    const a = atr(data), cl = data.map(c=>c.c), rs = rsi(cl);
    const fv = detectFVG(data), ms = detectMSS(data), bk = detectBreakers(data);
    const e20 = ema(cl,20), e50 = ema(cl,50), cE20 = e20[e20.length-1], cE50 = e50[e50.length-1];
    
    const bF = fv.filter(f=>f.type==='bull'&&f.l<price&&f.fresh).sort((a,b)=>b.l-a.l);
    const sF = fv.filter(f=>f.type==='bear'&&f.h>price&&f.fresh).sort((a,b)=>a.h-b.h);
    const bB = bk.filter(b=>b.type==='BULL'&&b.p<price);
    const sB = bk.filter(b=>b.type==='BEAR'&&b.p>price);
    
    let bS=0, sS=0, bR=[], sR=[];
    
    if (mtfDirection === 'BULLISH') {
        bS += 20; bR.push('MTF Bull');
        if (mtfStrength >= 3) { bS += 10; bR.push('Strong trend'); }
    } else if (mtfDirection === 'BEARISH') {
        sS += 20; sR.push('MTF Bear');
        if (mtfStrength >= 3) { sS += 10; sR.push('Strong trend'); }
    }
    
    if(ms?.type==='BULL'){ bS+=15; bR.push('MSS Bull'); } else if(ms?.type==='BEAR'){ sS+=15; sR.push('MSS Bear'); }
    if(bF.length){ bS+=15; bR.push(`Fresh FVG`); }
    if(sF.length){ sS+=15; sR.push(`Fresh FVG`); }
    if(bB.length){ bS+=10; bR.push('Breaker'); }
    if(sB.length){ sS+=10; sR.push('Breaker'); }
    if(cE20>cE50){ bS+=10; } else { sS+=10; }
    if(rs>50) bS+=5; else sS+=5;
    
    let dir, conf, zone, reason;
    
    if (mtfStrength >= 3) {
        dir = mtfDirection === 'BULLISH' ? 'BUY' : 'SELL';
        conf = mtfDirection === 'BULLISH' ? Math.min(bS+15, 95) : Math.min(sS+15, 95);
        reason = `STRONG ${mtfDirection} | ` + (mtfDirection==='BULLISH'?bR.join('; '):sR.join('; '));
        
        // Try deep OTE first
        const deepZone = findDeepDiscountZone(data, dir);
        if (deepZone) {
            zone = {p:deepZone.optimal,l:deepZone.low,h:deepZone.high,src:'DEEP_OTE',reason:deepZone.reason};
        } else if (dir === 'BUY') {
            if(bF.length) zone={p:bF[0].m,l:bF[0].l,h:bF[0].h,src:'FVG'};
            else if(bB.length) zone={p:bB[0].p,l:bB[0].p-a*.5,h:bB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rL+r*.7,l:rL+r*.618,h:rL+r*.79,src:'OTE'}; }
        } else {
            if(sF.length) zone={p:sF[0].m,l:sF[0].l,h:sF[0].h,src:'FVG'};
            else if(sB.length) zone={p:sB[0].p,l:sB[0].p-a*.5,h:sB[0].p+a*.5,src:'Breaker'};
            else { let rL=Math.min(...data.slice(-20).map(c=>c.l)),rH=Math.max(...data.slice(-20).map(c=>c.h)),r=rH-rL; zone={p:rH-r*.3,l:rH-r*.382,h:rH-r*.5,src:'OTE'}; }
        }
    } else {
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
    
    return {dir,conf,zone,reason,scores:{bS,sS}};
}

// ============================================
// MULTI-TF
// ============================================
async function getMTFConsensus() {
    const tfs=['5M','15M','1H','4H']; let bullCount=0, bearCount=0; const trends={};
    for(let t of tfs){
        let d=await getHistory(t); if(!d||d.length<30) continue;
        let c=d.map(x=>x.c), tr=c[c.length-1]>c[c.length-20]?'BULLISH':(c[c.length-1]<c[c.length-20]?'BEARISH':'NEUTRAL');
        trends[t]=tr; if(tr==='BULLISH')bullCount++; else if(tr==='BEARISH')bearCount++;
        let el=document.getElementById(`trend${t}`); if(el){ el.innerHTML=tr==='BULLISH'?'🟢 Bull':(tr==='BEARISH'?'🔴 Bear':'⚪ Neut'); el.className=`mtf-trend ${tr.toLowerCase()}`; }
    }
    return { direction: bullCount > bearCount ? 'BULLISH' : (bearCount > bullCount ? 'BEARISH' : 'NEUTRAL'), strength: Math.max(bullCount, bearCount), bullCount, bearCount, trends };
}

// ============================================
// AI (Sniper prompts)
// ============================================
async function askAI(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotif('🤖 AI analyzing...','info');
    
    const forcedDir = marketData.mtfDirection === 'BULLISH' ? 'BUY' : (marketData.mtfDirection === 'BEARISH' ? 'SELL' : null);
    
    const prompt = `You are an ELITE ICT SNIPER. Check ALL conditions before giving a signal.

TREND: ${marketData.mtfDirection} (${marketData.mtfStrength}/4 TFs)
${marketData.mtfStrength >= 3 ? 'STRONG TREND. ONLY ' + forcedDir + ' SIGNALS.' : ''}

CONDITIONS TO VERIFY:
1. Displacement: ${marketData.displacement}
2. Deep Zone: ${marketData.deepZone || 'Not available'}
3. 5M Rejection: ${marketData.rejection5M}
4. FVG Freshness: ${marketData.fvgFreshness}

Entry Zone: ${marketData.zoneSrc} $${marketData.entryPrice}
Min SL Buffer: $${marketData.minBuffer}

ONLY give a signal if:
- Displacement detected OR deep discount/premium zone available
- 5M shows rejection or price is approaching zone
- FVGs are fresh (untested)

If conditions NOT met, return NEUTRAL.

Return JSON:
{"signal":"${forcedDir||'BUY'}","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit1":#,"takeProfit2":#,"takeProfit3":#,"reasoning":"..."}`;

    try {
        const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'You verify conditions before giving signals. Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.1,max_tokens:800})});
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
    showNotif('🔍 Sniper scanning...','info');
    
    try {
        const price = await getPrice(); if (!price) throw new Error('No price');
        const mtf = await getMTFConsensus();
        const data = await getHistory(); if (!data?.length) throw new Error('No data');
        
        const sig = score(data, price, mtf.direction, mtf.strength);
        if (!sig.zone) throw new Error('No entry zone');
        
        // RUN ALL SNIPER CHECKS
        const displacement = detectDisplacement(data, sig.dir);
        const rejection5M = await check5MRejection(sig.zone, sig.dir);
        const deepZone = findDeepDiscountZone(data, sig.dir);
        
        // Count fresh FVGs
        const allFvgs = detectFVG(data);
        const freshCount = allFvgs.filter(f=>f.fresh).length;
        const fvgFreshness = `${freshCount}/${allFvgs.length} fresh`;
        
        const a = atr(data, 14);
        const slResult = calcStopLoss(data, sig.dir, sig.zone.p, sig.zone);
        const minBuffer = getSLBuffer(a);
        
        const marketData = {
            price: price.toFixed(2), bS: sig.scores.bS, sS: sig.scores.sS,
            mtfDirection: mtf.direction, mtfStrength: mtf.strength,
            displacement: displacement.detected ? '✅ '+displacement.reason : '❌ '+displacement.reason,
            deepZone: deepZone ? `✅ ${deepZone.source}: $${deepZone.low.toFixed(2)}-$${deepZone.high.toFixed(2)}` : '❌ No deep zone',
            rejection5M: rejection5M.confirmed ? '✅ '+rejection5M.reason : '⚠️ '+rejection5M.reason,
            fvgFreshness,
            zoneSrc: sig.zone.src, entryPrice: sig.zone.p.toFixed(2),
            minBuffer: minBuffer.toFixed(1),
            suggestedSL: slResult.price.toFixed(2)
        };
        
        const ai = await askAI(marketData);
        
        let dir, conf, entry, sl, tp1, tp2, tp3, reason, src;
        let sniperChecks = [];
        
        if (ai && (ai.signal==='BUY'||ai.signal==='SELL')) {
            if (mtf.strength >= 3) {
                if ((mtf.direction==='BULLISH'&&ai.signal==='SELL')||(mtf.direction==='BEARISH'&&ai.signal==='BUY')) {
                    dir = mtf.direction==='BULLISH'?'BUY':'SELL'; conf = sig.conf; entry = sig.zone.p; sl = slResult.price;
                    reason = 'AI overridden - Strong trend'; src = 'RULE';
                    sniperChecks.push('⚠️ AI fought trend');
                } else {
                    dir = ai.signal; conf = ai.confidence||sig.conf; entry = ai.entryPrice||sig.zone.p;
                    const rawSL = ai.stopLoss||slResult.price;
                    const cappedSL = enforceSLCap(rawSL, entry, dir==='BUY'?'BUY':'SELL');
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
            reason = sig.reason; src = sig.zone.src;
        }
        
        // Add sniper check results
        if (displacement.detected) sniperChecks.push('✅ Displacement');
        else sniperChecks.push('❌ No displacement');
        if (rejection5M.confirmed) sniperChecks.push('✅ 5M Rejection');
        else sniperChecks.push('⚠️ No 5M rejection');
        if (deepZone) sniperChecks.push('✅ Deep zone');
        else sniperChecks.push('⚠️ No deep zone');
        sniperChecks.push(`📊 ${fvgFreshness}`);
        
        const st = dir==='BUY'?'LONG':(dir==='SELL'?'SHORT':'NEUTRAL');
        const prec = getPrec(pair);
        const slDist = Math.abs(entry-sl);
        const rr = (Math.abs(tp1-entry)/slDist).toFixed(1);
        
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
                stop_loss_distance: slDist.toFixed(2),
                stop_loss_pct: ((slDist/entry)*100).toFixed(2)+'%',
                take_profit_1: tp1, take_profit_2: tp2, take_profit_3: tp3,
                risk_reward: rr, confidence: conf,
                entry_source: src, ai_used: src==='AI',
                mtf_consensus: `${mtf.direction} (${mtf.strength}/4 TFs)`,
                sniper_checks: sniperChecks,
                conditions: {
                    displacement: displacement,
                    rejection_5m: rejection5M,
                    deep_zone: deepZone,
                    fvg_freshness: fvgFreshness
                },
                analysis: {
                    scoring: { bullish: sig.scores.bS, bearish: sig.scores.sS },
                    multi_timeframe: { "5M":mtf.trends['5M']||'--', "15M":mtf.trends['15M']||'--', "1H":mtf.trends['1H']||'--', "4H":mtf.trends['4H']||'--' },
                    reasoning: reason
                }
            }
        };
        
        document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);
        analysis = { signalType:st, idealEntry:entry, currentPrice:price, stopLoss:sl, takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3, confidence:conf };
        document.getElementById('executeBtn').disabled = st==='NEUTRAL';
        showNotif(`✅ ${st} ${conf}% | SL: $${slDist.toFixed(1)} | ${sniperChecks.filter(c=>c.startsWith('✅')).length}/4 checks passed`,'success');
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
