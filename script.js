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
    TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk;
    updateKeyStatus();
}

function clearKeys() {
    localStorage.removeItem('ict_bot_keys');
    TWELVE_DATA_KEY = ''; DEEPSEEK_API_KEY = '';
    updateKeyStatus();
    showNotif('🗑️ Keys removed','warning');
}

function updateKeyStatus() {
    const ts = document.getElementById('twelveStatus'), ds = document.getElementById('deepseekStatus');
    ts.innerHTML = TWELVE_DATA_KEY ? '✅ Active' : '❌ Missing';
    ts.className = 'status-badge ' + (TWELVE_DATA_KEY ? 'active' : 'inactive');
    ds.innerHTML = DEEPSEEK_API_KEY ? '✅ Active (' + DEEPSEEK_API_KEY.substring(0,5) + '...)' : '❌ Missing';
    ds.className = 'status-badge ' + (DEEPSEEK_API_KEY ? 'active' : 'inactive');
}

function showSetup() {
    const ex = document.getElementById('setupOverlay'); if (ex) ex.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="setup-overlay" id="setupOverlay">
            <div class="setup-modal">
                <h3>🔐 API Key Setup</h3>
                <p class="setup-desc">Enter your API keys</p>
                <label>📡 Twelve Data Key:</label>
                <input type="password" id="twInput" class="setup-input" value="${TWELVE_DATA_KEY}">
                <label>🤖 DeepSeek Key:</label>
                <input type="password" id="dsInput" class="setup-input" value="${DEEPSEEK_API_KEY}">
                <p class="setup-note">Get DeepSeek key from platform.deepseek.com</p>
                <div class="setup-buttons"><button id="svBtn" class="setup-btn primary">💾 Save</button><button id="clBtn" class="setup-btn danger">🗑️ Clear</button></div>
                <button id="testAiBtn" class="setup-btn secondary" style="width:100%;margin-top:8px;">🧪 Test AI</button>
                <button id="skBtn" class="setup-btn secondary" style="width:100%;margin-top:4px;">Close</button>
                <div id="testResult" style="margin-top:8px;font-size:11px;color:#8e8e93;"></div>
            </div>
        </div>`);
    document.getElementById('svBtn').addEventListener('click', async () => {
        const tk = document.getElementById('twInput').value.trim(), dk = document.getElementById('dsInput').value.trim();
        if (!tk) { showNotif('⚠️ Twelve Data key required','warning'); return; }
        await saveKeys(tk, dk); document.getElementById('setupOverlay').remove();
    });
    document.getElementById('clBtn').addEventListener('click', () => { clearKeys(); document.getElementById('twInput').value=''; document.getElementById('dsInput').value=''; });
    document.getElementById('testAiBtn').addEventListener('click', async () => {
        const dk = document.getElementById('dsInput').value.trim();
        if (!dk) { document.getElementById('testResult').innerHTML = '❌ Enter key first'; return; }
        document.getElementById('testResult').innerHTML = '🔄 Testing...';
        try {
            const r = await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${dk}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'Say OK'}],max_tokens:5})});
            const d = await r.json();
            document.getElementById('testResult').innerHTML = d.choices ? '✅ AI working!' : '❌ Error: ' + (d.error?.message || 'Unknown');
        } catch(e) { document.getElementById('testResult').innerHTML = '❌ Connection failed'; }
    });
    document.getElementById('skBtn').addEventListener('click', () => document.getElementById('setupOverlay').remove());
}

// ============================================
// STATE
// ============================================
let pair = 'XAU/USD', tf = '15M', analysis = null, calls = 0, lastPrice = null;
let limitOrder = null, priceTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadKeys(); updateKeyStatus();
    if (!TWELVE_DATA_KEY && !DEEPSEEK_API_KEY) setTimeout(showSetup, 500);
    init();
});

function init() {
    updateTime(); setInterval(updateTime, 1000);
    document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
    document.getElementById('executeBtn').addEventListener('click', handleLimit);
    document.getElementById('cancelLimitBtn').addEventListener('click', cancelLimit);
    document.getElementById('copyJsonBtn').addEventListener('click', copyJson);
    document.getElementById('updateKeysBtn').addEventListener('click', showSetup);
    document.getElementById('pairSelect').addEventListener('change', e => pair = e.target.value);
    document.querySelectorAll('.category-btn').forEach(b => b.addEventListener('click', function() {
        document.querySelectorAll('.category-btn').forEach(x => x.classList.remove('active'));
        this.classList.add('active'); updatePairs(this.dataset.category);
    }));
    document.querySelectorAll('.tf-btn').forEach(b => b.addEventListener('click', function() {
        document.querySelectorAll('.tf-btn').forEach(x => x.classList.remove('active'));
        this.classList.add('active'); tf = this.dataset.tf;
    }));
    loadLimitOrder();
}

function updateTime() {
    const n = new Date();
    document.getElementById('liveTime').innerHTML = `${n.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${n.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
}

function updatePairs(cat) {
    const p = { crypto:['BTC/USD','ETH/USD'], forex:['EUR/USD','GBP/USD'], metals:['XAU/USD','XAG/USD'] };
    document.getElementById('pairSelect').innerHTML = p[cat].map(x => `<option value="${x}">${x}</option>`).join('');
    pair = p[cat][0];
}

function isGold(p) { return p.includes('XAU'); }
function isForex(p) { return ['EUR/USD','GBP/USD','USD/JPY'].includes(p); }
function getPrec(p) { if (isGold(p)) return 2; if (isForex(p)) return 5; return 2; }

// ============================================
// API
// ============================================
async function getPrice() {
    if (!TWELVE_DATA_KEY) return null;
    try {
        const r = await fetch(`${TWELVE_DATA_BASE}/price?symbol=${encodeURIComponent(SYMBOLS[pair])}&apikey=${TWELVE_DATA_KEY}`);
        const d = await r.json();
        if (d.price) { calls++; document.getElementById('apiSource').innerHTML = '📡 Live'; return +d.price; }
    } catch(e) {}
    return null;
}

async function getHistory(tfStr = tf) {
    if (!TWELVE_DATA_KEY) return null;
    try {
        const r = await fetch(`${TWELVE_DATA_BASE}/time_series?symbol=${encodeURIComponent(SYMBOLS[pair])}&interval=${TF_MAP[tfStr]}&outputsize=100&apikey=${TWELVE_DATA_KEY}`);
        const d = await r.json();
        if (d.values) { calls++; return d.values.map(c => ({ t:c.datetime, o:+c.open, h:+c.high, l:+c.low, c:+c.close, v:+c.volume||1e6 })).reverse(); }
    } catch(e) {}
    return null;
}

// ============================================
// TECHNICALS
// ============================================
const ema = (p,n) => { const m=2/(n+1); let e=[p[0]]; for(let i=1;i<p.length;i++) e.push((p[i]-e[i-1])*m+e[i-1]); return e; };
const rsi = (p,n=14) => { let g=0,l=0; for(let i=p.length-n;i<p.length;i++){ let c=p[i]-p[i-1]; c>=0?g+=c:l-=c; } let ag=g/n,al=l/n; return al===0?100:100-(100/(1+ag/al)); };
const atr = (d,n=14) => { let t=[]; for(let i=1;i<d.length;i++) t.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c))); return t.slice(-n).reduce((a,b)=>a+b,0)/n; };

// ============================================
// IMPROVEMENT #4: FRESH ZONE DETECTION
// ============================================
function detectFVG(d) {
    let f=[]; 
    for(let i=1;i<d.length-1;i++){
        // Bullish FVG
        if(d[i-1].h<d[i+1].l && d[i+1].l-d[i-1].h>d[i+1].c*0.0005) {
            const fvgLow = d[i-1].h, fvgHigh = d[i+1].l;
            // Check if this FVG has been touched by subsequent candles
            let mitigated = false;
            for(let j=i+2;j<d.length;j++) {
                if(d[j].l <= fvgHigh && d[j].l >= fvgLow) { mitigated = true; break; }
            }
            f.push({type:'bull', l:fvgLow, h:fvgHigh, m:(fvgLow+fvgHigh)/2, fresh:!mitigated, idx:i});
        }
        // Bearish FVG
        if(d[i-1].l>d[i+1].h && d[i-1].l-d[i+1].h>d[i+1].c*0.0005) {
            const fvgLow = d[i+1].h, fvgHigh = d[i-1].l;
            let mitigated = false;
            for(let j=i+2;j<d.length;j++) {
                if(d[j].h >= fvgLow && d[j].h <= fvgHigh) { mitigated = true; break; }
            }
            f.push({type:'bear', l:fvgLow, h:fvgHigh, m:(fvgLow+fvgHigh)/2, fresh:!mitigated, idx:i});
        }
    } 
    return f;
}

// ============================================
// IMPROVEMENT #3: REJECTION CANDLE DETECTION
// ============================================
function detectRejection(data, direction, zoneLow, zoneHigh) {
    if (data.length < 3) return { confirmed: false, reason: 'Not enough data' };
    
    const lastCandle = data[data.length - 1];
    const prevCandle = data[data.length - 2];
    const body = Math.abs(lastCandle.c - lastCandle.o);
    const totalRange = lastCandle.h - lastCandle.l;
    
    if (direction === 'BUY') {
        // Check if price touched the zone on last candle
        const touchedZone = lastCandle.l <= zoneHigh && lastCandle.l >= zoneLow;
        const lowerWick = Math.min(lastCandle.o, lastCandle.c) - lastCandle.l;
        const bullishClose = lastCandle.c > lastCandle.o;
        const significantWick = lowerWick > body * 1.5 || lowerWick > totalRange * 0.4;
        
        if (touchedZone && significantWick && bullishClose) {
            return { confirmed: true, reason: 'Bullish rejection wick at zone', strength: 'strong' };
        }
        if (touchedZone && lowerWick > body) {
            return { confirmed: true, reason: 'Wick at zone, moderate rejection', strength: 'moderate' };
        }
        if (touchedZone) {
            return { confirmed: false, reason: 'Price at zone but no rejection yet' };
        }
    } else {
        const touchedZone = lastCandle.h >= zoneLow && lastCandle.h <= zoneHigh;
        const upperWick = lastCandle.h - Math.max(lastCandle.o, lastCandle.c);
        const bearishClose = lastCandle.c < lastCandle.o;
        const significantWick = upperWick > body * 1.5 || upperWick > totalRange * 0.4;
        
        if (touchedZone && significantWick && bearishClose) {
            return { confirmed: true, reason: 'Bearish rejection wick at zone', strength: 'strong' };
        }
        if (touchedZone && upperWick > body) {
            return { confirmed: true, reason: 'Wick at zone, moderate rejection', strength: 'moderate' };
        }
        if (touchedZone) {
            return { confirmed: false, reason: 'Price at zone but no rejection yet' };
        }
    }
    
    return { confirmed: false, reason: 'Price not at entry zone yet' };
}

function findSwings(d,lb=3) {
    let H=[],L=[],h=d.map(c=>c.h),l=d.map(c=>c.l);
    for(let i=lb;i<h.length-lb;i++){ let iH=true,iL=true; for(let j=1;j<=lb;j++){ if(h[i]<=h[i-j]||h[i]<=h[i+j]) iH=false; if(l[i]>=l[i-j]||l[i]>=l[i+j]) iL=false; } if(iH) H.push({p:h[i],i}); if(iL) L.push({p:l[i],i}); }
    return {H,L};
}

function detectMSS(d) {
    let h=d.map(c=>c.h),l=d.map(c=>c.l),c=d.map(c=>c.c),rH=Math.max(...h.slice(-20)),rL=Math.min(...l.slice(-20)),cP=c[c.length-1];
    if(cP>rH) return {type:'BULL',level:rH}; if(cP<rL) return {type:'BEAR',level:rL}; return null;
}

function detectBreakers(d) {
    let b=[],s=findSwings(d);
    for(let i=5;i<d.length-5;i++){ let c=d[i]; if(c.c>c.o){ let r=s.H.find(h=>h.i<i&&h.p<c.c); if(r) b.push({type:'BULL',p:r.p}); } if(c.c<c.o){ let sp=s.L.find(l=>l.i<i&&l.p>c.c); if(sp) b.push({type:'BEAR',p:sp.p}); } }
    return b;
}

function detectTrend(data) {
    const closes = data.map(c=>c.c);
    const e20 = ema(closes,20), e50 = ema(closes,50);
    const cE20 = e20[e20.length-1], cE50 = e50[e50.length-1];
    if (cE20 > cE50) return 'BULLISH';
    if (cE20 < cE50) return 'BEARISH';
    return 'NEUTRAL';
}

// ============================================
// IMPROVEMENT #5: DYNAMIC BUFFER (Spread-based)
// ============================================
function getDynamicBuffer() {
    const buffers = {
        'XAU/USD': { tight: 1.5, normal: 2.5, wide: 4 },
        'XAG/USD': { tight: 0.03, normal: 0.05, wide: 0.08 },
        'BTC/USD': { tight: 30, normal: 50, wide: 80 },
        'ETH/USD': { tight: 2, normal: 3, wide: 5 },
        'EUR/USD': { tight: 0.00005, normal: 0.0001, wide: 0.0002 },
        'GBP/USD': { tight: 0.00005, normal: 0.0001, wide: 0.0002 }
    };
    
    const defaultBuf = isGold(pair) ? { tight: 1.5, normal: 2.5, wide: 4 } :
                       isForex(pair) ? { tight: 0.00005, normal: 0.0001, wide: 0.0002 } :
                       { tight: 20, normal: 40, wide: 60 };
    
    return buffers[pair] || defaultBuf;
}

// ============================================
// IMPROVEMENT #2: MTF ALIGNMENT (4H → 1H → 15M → 5M)
// ============================================
async function checkMTFAlignment(direction) {
    const results = {
        aligned: false,
        score: 0,
        maxScore: 4,
        details: {},
        rejectReason: ''
    };
    
    // 1. Check 4H trend (Gatekeeper - must align)
    const d4h = await getHistory('4H');
    if (d4h && d4h.length > 30) {
        const trend4h = detectTrend(d4h);
        results.details['4H'] = trend4h;
        
        if (direction === 'BUY' && trend4h === 'BEARISH') {
            results.rejectReason = '4H bearish - no buys allowed';
            return results;
        }
        if (direction === 'SELL' && trend4h === 'BULLISH') {
            results.rejectReason = '4H bullish - no sells allowed';
            return results;
        }
        if ((direction === 'BUY' && trend4h === 'BULLISH') || 
            (direction === 'SELL' && trend4h === 'BEARISH')) {
            results.score += 1;
        }
    }
    
    // 2. Check 1H zone (Structure validator)
    const d1h = await getHistory('1H');
    if (d1h && d1h.length > 30) {
        const trend1h = detectTrend(d1h);
        results.details['1H'] = trend1h;
        
        if ((direction === 'BUY' && trend1h === 'BULLISH') || 
            (direction === 'SELL' && trend1h === 'BEARISH')) {
            results.score += 1;
        }
    }
    
    // 3. Check 15M zone (Entry finder)
    const d15m = await getHistory('15M');
    if (d15m && d15m.length > 30) {
        const trend15m = detectTrend(d15m);
        results.details['15M'] = trend15m;
        
        if ((direction === 'BUY' && trend15m === 'BULLISH') || 
            (direction === 'SELL' && trend15m === 'BEARISH')) {
            results.score += 1;
        }
    }
    
    // 4. Check 5M for precision (Sniper scope)
    const d5m = await getHistory('5M');
    if (d5m && d5m.length > 30) {
        const trend5m = detectTrend(d5m);
        results.details['5M'] = trend5m;
        
        // 5M is more forgiving - used for timing, not direction
        if ((direction === 'BUY' && trend5m !== 'BEARISH') || 
            (direction === 'SELL' && trend5m !== 'BULLISH')) {
            results.score += 1;
        }
    }
    
    // Alignment threshold: At least 3 out of 4 timeframes must agree
    results.aligned = results.score >= 2;
    if (!results.aligned && !results.rejectReason) {
        results.rejectReason = `Only ${results.score}/${results.maxScore} timeframes aligned`;
    }
    
    return results;
}

// ============================================
// IMPROVEMENT #2: Find best zone across multiple timeframes
// ============================================
async function findBestEntryZone(data, direction) {
    const a = atr(data,14);
    const fvgs = detectFVG(data);
    const bk = detectBreakers(data);
    const currentPrice = data[data.length-1].c;
    
    let bestZone = null;
    let bestScore = -1;
    
    // Candidate 1: Fresh bullish/bearish FVGs
    const relevantFVGs = direction === 'BUY' 
        ? fvgs.filter(f => f.type==='bull' && f.l < currentPrice && f.fresh)
        : fvgs.filter(f => f.type==='bear' && f.h > currentPrice && f.fresh);
    
    for (const fvg of relevantFVGs) {
        // IMPROVEMENT #1: Entry at FVG EDGE, not midpoint
        const entryPrice = direction === 'BUY' ? fvg.l : fvg.h;
        const distanceFromCurrent = Math.abs(currentPrice - entryPrice) / currentPrice;
        
        // Score: Fresh FVGs get priority, closer ones get bonus
        let score = 50;
        if (fvg.fresh) score += 30;
        if (distanceFromCurrent < 0.01) score += 10;
        if (distanceFromCurrent < 0.005) score += 10;
        
        if (score > bestScore) {
            bestScore = score;
            bestZone = { 
                p: entryPrice, 
                l: fvg.l, 
                h: fvg.h, 
                src: 'FVG',
                fresh: fvg.fresh,
                edge: true,
                reason: `Fresh FVG edge at ${entryPrice.toFixed(getPrec(pair))}`
            };
        }
    }
    
    // Candidate 2: Breaker blocks (fallback)
    if (!bestZone) {
        const relevantBreakers = direction === 'BUY'
            ? bk.filter(b => b.type==='BULL' && b.p < currentPrice)
            : bk.filter(b => b.type==='BEAR' && b.p > currentPrice);
        
        if (relevantBreakers.length > 0) {
            const bestBreaker = relevantBreakers.sort((a,b) => 
                direction === 'BUY' ? b.p - a.p : a.p - b.p
            )[0];
            bestZone = { 
                p: bestBreaker.p, 
                l: bestBreaker.p - a*0.5, 
                h: bestBreaker.p + a*0.5, 
                src: 'Breaker',
                fresh: true,
                edge: true,
                reason: `Breaker block at ${bestBreaker.p.toFixed(getPrec(pair))}`
            };
        }
    }
    
    // Candidate 3: OTE zone (last resort)
    if (!bestZone) {
        const recentLow = Math.min(...data.slice(-20).map(c=>c.l));
        const recentHigh = Math.max(...data.slice(-20).map(c=>c.h));
        const range = recentHigh - recentLow;
        
        if (direction === 'BUY') {
            const oteLow = recentLow + range * 0.618;
            const oteHigh = recentLow + range * 0.79;
            const entryPrice = oteLow; // Edge of OTE zone
            bestZone = { 
                p: entryPrice, 
                l: oteLow, 
                h: oteHigh, 
                src: 'OTE',
                fresh: true,
                edge: true,
                reason: `OTE zone edge at ${entryPrice.toFixed(getPrec(pair))}`
            };
        } else {
            const oteLow = recentHigh - range * 0.79;
            const oteHigh = recentHigh - range * 0.618;
            const entryPrice = oteHigh; // Edge of OTE zone
            bestZone = { 
                p: entryPrice, 
                l: oteLow, 
                h: oteHigh, 
                src: 'OTE',
                fresh: true,
                edge: true,
                reason: `OTE zone edge at ${entryPrice.toFixed(getPrec(pair))}`
            };
        }
    }
    
    return bestZone;
}

// ============================================
// STOP LOSS
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
        
        if (swingLows.length > 0) {
            const buf = isGold(pair) ? 3 : (isForex(pair) ? a * 0.3 : a * 0.2);
            const proposedSL = swingLows[0].p - buf;
            if (entry - proposedSL <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Below swing ${swingLows[0].p.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice && bullFVGs.length > 0) {
            const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15);
            const proposedSL = bullFVGs[0].l - buf;
            if (entry - proposedSL <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Below FVG ${bullFVGs[0].l.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice && zone) {
            const buf = isGold(pair) ? 3 : (isForex(pair) ? a * 0.3 : a * 0.2);
            const proposedSL = zone.l - buf;
            if (entry - proposedSL <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Below zone ${zone.l.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice) {
            stopPrice = Math.max(entry - a * 0.8, entry - maxSLDistance);
            stopReason = `Capped at ${(maxSLPercent*100).toFixed(1)}%`;
        }
        
        return { price: stopPrice, reason: stopReason };
    } else {
        const swingHighs = swings.H.filter(s => s.p > entry && s.p < entry + maxSLDistance*2).sort((a,b) => a.p - b.p);
        const bearFVGs = fvgs.filter(f => f.type==='bear' && f.h > entry && f.h < entry + maxSLDistance*2).sort((a,b) => a.h - b.h);
        
        let stopPrice = null, stopReason = '';
        
        if (swingHighs.length > 0) {
            const buf = isGold(pair) ? 3 : (isForex(pair) ? a * 0.3 : a * 0.2);
            const proposedSL = swingHighs[0].p + buf;
            if (proposedSL - entry <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Above swing ${swingHighs[0].p.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice && bearFVGs.length > 0) {
            const buf = isGold(pair) ? 2 : (isForex(pair) ? a * 0.2 : a * 0.15);
            const proposedSL = bearFVGs[0].h + buf;
            if (proposedSL - entry <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Above FVG ${bearFVGs[0].h.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice && zone) {
            const buf = isGold(pair) ? 3 : (isForex(pair) ? a * 0.3 : a * 0.2);
            const proposedSL = zone.h + buf;
            if (proposedSL - entry <= maxSLDistance) {
                stopPrice = proposedSL;
                stopReason = `Above zone ${zone.h.toFixed(getPrec(pair))}`;
            }
        }
        
        if (!stopPrice) {
            stopPrice = Math.min(entry + a * 0.8, entry + maxSLDistance);
            stopReason = `Capped at ${(maxSLPercent*100).toFixed(1)}%`;
        }
        
        return { price: stopPrice, reason: stopReason };
    }
}

// ============================================
// SIGNAL SCORING (using 15M data for scoring)
// ============================================
function score(data, price) {
    const a = atr(data), cl = data.map(c=>c.c), rs = rsi(cl);
    const fv = detectFVG(data), ms = detectMSS(data), bk = detectBreakers(data);
    const e20 = ema(cl,20), e50 = ema(cl,50), cE20 = e20[e20.length-1], cE50 = e50[e50.length-1];
    
    const bF = fv.filter(f=>f.type==='bull'&&f.l<price).sort((a,b)=>b.l-a.l);
    const sF = fv.filter(f=>f.type==='bear'&&f.h>price).sort((a,b)=>a.h-b.h);
    const bB = bk.filter(b=>b.type==='BULL'&&b.p<price);
    const sB = bk.filter(b=>b.type==='BEAR'&&b.p>price);
    
    let bS=0, sS=0, bR=[], sR=[];
    if(ms?.type==='BULL'){ bS+=25; bR.push('MSS Bull'); } else if(ms?.type==='BEAR'){ sS+=25; sR.push('MSS Bear'); }
    if(bF.length){ bS+=20; bR.push(`FVG ${bF[0].l.toFixed(2)}`); }
    if(sF.length){ sS+=20; sR.push(`FVG ${sF[0].h.toFixed(2)}`); }
    if(bB.length){ bS+=15; bR.push('Breaker sup'); }
    if(sB.length){ sS+=15; sR.push('Breaker res'); }
    if(cE20>cE50){ bS+=15; bR.push('EMA20>50'); } else { sS+=15; sR.push('EMA20<50'); }
    if(rs>50) bS+=10; else sS+=10;
    
    let dir, conf, reason;
    if(bS>sS&&bS>=45){ dir='BUY'; conf=Math.min(bS+10,95); reason=bR.join('; '); }
    else if(sS>bS&&sS>=45){ dir='SELL'; conf=Math.min(sS+10,95); reason=sR.join('; '); }
    else { dir='NEUTRAL'; conf=0; reason=`B:${bS} S:${sS}`; }
    
    return {dir,conf,reason,scores:{bS,sS}};
}

// ============================================
// MULTI-TF UI
// ============================================
async function updateMTF() {
    const tfs=['5M','15M','1H','4H'];
    for(let t of tfs){
        let d=await getHistory(t); if(!d||d.length<30) continue;
        let c=d.map(x=>x.c), tr=c[c.length-1]>c[c.length-20]?'bullish':(c[c.length-1]<c[c.length-20]?'bearish':'neutral');
        let el=document.getElementById(`trend${t}`); if(el){ el.innerHTML=tr==='bullish'?'🟢 Bull':(tr==='bearish'?'🔴 Bear':'⚪ Neut'); el.className=`mtf-trend ${tr}`; }
    }
}

// ============================================
// AI
// ============================================
async function askAI(marketData) {
    if (!DEEPSEEK_API_KEY) return null;
    showNotif('🤖 AI analyzing...','info');
    
    const prompt = `ICT trader. Return JSON.
${pair} ${tf} Price:${marketData.price}
Bull:${marketData.bS} Bear:${marketData.sS}
MTF: 4H=${marketData.mtf4h} 1H=${marketData.mtf1h} 15M=${marketData.mtf15m} 5M=${marketData.mtf5m}
MTF Aligned: ${marketData.mtfAligned}
Entry zone: ${marketData.zoneInfo}
SL suggestion:$${marketData.suggestedSL}
Rejection: ${marketData.rejection}
Return:{"signal":"BUY/SELL/NEUTRAL","confidence":0-100,"entryPrice":#,"stopLoss":#,"takeProfit1":#,"takeProfit2":#,"takeProfit3":#,"reasoning":"..."}
IMPORTANT: SL must be LESS than TP distance. Min 1:2 R:R.`;

    try {
        const r = await fetch(DEEPSEEK_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:'Return ONLY valid JSON.'},{role:'user',content:prompt}],temperature:0.2,max_tokens:600})});
        const d = await r.json();
        if (d.choices?.[0]) { const m = d.choices[0].message.content.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); }
        if (d.error) console.error('AI error:', d.error);
    } catch(e) { console.error('AI fetch error:', e); }
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
        await updateMTF();
        
        // Get 15M data for scoring and zone finding
        const d15m = await getHistory('15M');
        if (!d15m?.length) throw new Error('No 15M data');
        
        // Score the signal
        const sig = score(d15m, price);
        if (sig.dir === 'NEUTRAL') throw new Error('No clear direction');
        
        // IMPROVEMENT #2: Check MTF alignment (4H → 1H → 15M → 5M)
        const mtfCheck = await checkMTFAlignment(sig.dir === 'BUY' ? 'BUY' : 'SELL');
        
        if (!mtfCheck.aligned) {
            showNotif('⛔ MTF not aligned: ' + mtfCheck.rejectReason, 'warning');
            document.getElementById('jsonOutput').innerHTML = JSON.stringify({
                trade_signal: {
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toISOString().split('T')[1].split('.')[0],
                    pair, timeframe: tf,
                    current_price: price,
                    trade_type: 'NEUTRAL',
                    reason: 'MTF alignment failed',
                    mtf_details: mtfCheck.details,
                    mtf_score: mtfCheck.score + '/' + mtfCheck.maxScore,
                    reject_reason: mtfCheck.rejectReason
                }
            }, null, 2);
            btn.classList.remove('loading'); btn.disabled = false;
            return;
        }
        
        // IMPROVEMENT #1 & #4: Find best zone with fresh FVGs at edge
        const zone = await findBestEntryZone(d15m, sig.dir === 'BUY' ? 'BUY' : 'SELL');
        if (!zone) throw new Error('No entry zone found');
        
        // IMPROVEMENT #3: Check rejection candle
        const rejection = detectRejection(d15m, sig.dir === 'BUY' ? 'BUY' : 'SELL', zone.l, zone.h);
        
        // IMPROVEMENT #5: Dynamic buffer
        const buffer = getDynamicBuffer();
        const spreadBuffer = rejection.confirmed ? buffer.tight : buffer.normal;
        
        // Adjust entry with dynamic buffer
        const adjustedEntry = sig.dir === 'BUY' 
            ? zone.p - spreadBuffer 
            : zone.p + spreadBuffer;
        
        // Calculate stop loss
        const slResult = calcStopLoss(d15m, sig.dir === 'BUY' ? 'BUY' : 'SELL', adjustedEntry, zone);
        
        // Build market data for AI
        const marketData = {
            price: price.toFixed(2), bS: sig.scores.bS, sS: sig.scores.sS,
            mtf4h: mtfCheck.details['4H'] || '--',
            mtf1h: mtfCheck.details['1H'] || '--',
            mtf15m: mtfCheck.details['15M'] || '--',
            mtf5m: mtfCheck.details['5M'] || '--',
            mtfAligned: mtfCheck.aligned ? '✅ ' + mtfCheck.score + '/4' : '❌',
            zoneInfo: `${zone.src} | Fresh:${zone.fresh} | Edge entry`,
            suggestedSL: slResult.price.toFixed(2),
            rejection: rejection.confirmed ? '✅ ' + rejection.reason : '⚠️ ' + rejection.reason
        };
        
        const ai = await askAI(marketData);
        
        let dir, conf, entry, sl, tp1, tp2, tp3, reason, src;
        
        if (ai && (ai.signal==='BUY'||ai.signal==='SELL')) {
            dir = ai.signal; conf = ai.confidence||70; entry = ai.entryPrice||adjustedEntry;
            sl = ai.stopLoss||slResult.price; tp1 = ai.takeProfit1; tp2 = ai.takeProfit2; tp3 = ai.takeProfit3;
            reason = '🤖 AI: '+ (ai.reasoning||'AI signal'); src = 'AI';
        } else {
            dir = sig.dir; conf = sig.conf; entry = adjustedEntry; sl = slResult.price;
            const risk = Math.abs(entry-sl);
            tp1 = dir==='BUY'?entry+risk*2:entry-risk*2;
            tp2 = dir==='BUY'?entry+risk*3.5:entry-risk*3.5;
            tp3 = dir==='BUY'?entry+risk*5:entry-risk*5;
            reason = sig.reason + ' | ' + zone.reason + ' | SL: ' + slResult.reason;
            if (rejection.confirmed) reason += ' | ' + rejection.reason;
            src = zone.src;
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
                stop_loss_reason: slResult.reason,
                take_profit_1: tp1, take_profit_2: tp2, take_profit_3: tp3,
                risk_reward: rr, confidence: conf,
                entry_source: src, ai_used: src==='AI',
                improvements: {
                    fvg_edge_entry: true,
                    mtf_alignment: { score: mtfCheck.score + '/4', aligned: mtfCheck.aligned, details: mtfCheck.details },
                    rejection_confirmation: { confirmed: rejection.confirmed, reason: rejection.reason },
                    fresh_zone: zone.fresh,
                    dynamic_buffer: spreadBuffer
                },
                analysis: {
                    scoring: { bullish: sig.scores.bS, bearish: sig.scores.sS },
                    multi_timeframe: { "5M":marketData.mtf5m, "15M":marketData.mtf15m, "1H":marketData.mtf1h, "4H":marketData.mtf4h },
                    reasoning: reason
                }
            }
        };
        
        document.getElementById('jsonOutput').innerHTML = JSON.stringify(out, null, 2);
        analysis = { signalType:st, idealEntry:entry, currentPrice:price, stopLoss:sl, takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3, confidence:conf };
        document.getElementById('executeBtn').disabled = st==='NEUTRAL';
        showNotif(src==='AI'?`✅ AI: ${st} ${conf}%`:`⚠️ Rule: ${st} ${conf}%`,'success');
    } catch(e) { console.error(e); showNotif('Error: '+e.message,'error'); }
    finally { btn.classList.remove('loading'); btn.disabled=false; }
}

// ============================================
// LIMIT ORDERS
// ============================================
function loadLimitOrder() { const s=localStorage.getItem('limitOrder'); if(s){ try{ limitOrder=JSON.parse(s); updateLimitUI(); startMonitor(); } catch(e){} } }
function saveLimit(o) { limitOrder=o; localStorage.setItem('limitOrder',JSON.stringify(o)); updateLimitUI(); }
function clearLimit() { limitOrder=null; localStorage.removeItem('limitOrder'); if(priceTimer) clearInterval(priceTimer); updateLimitUI(); }
function cancelLimit() { clearLimit(); showNotif('❌ Cancelled','warning'); }

function updateLimitUI() {
    const t=document.getElementById('limitOrderText'), c=document.getElementById('cancelLimitBtn');
    if(limitOrder){ const prec=getPrec(pair); t.innerHTML=`⏳ ${limitOrder.signalType} LIMIT @ $${limitOrder.idealEntry.toFixed(prec)} | SL: $${limitOrder.stopLoss.toFixed(prec)}`; t.className='active'; c.classList.remove('hidden'); document.getElementById('executeBtn').innerHTML='⏳ Waiting...'; document.getElementById('executeBtn').style.background='linear-gradient(135deg, #ff9f0a, #ff6b00)'; }
    else { t.innerHTML='No active limit order'; t.className=''; c.classList.add('hidden'); document.getElementById('executeBtn').innerHTML='⚡ Place Limit Order'; document.getElementById('executeBtn').style.background='linear-gradient(135deg, #34c759, #28a745)'; }
}

function startMonitor() {
    if(priceTimer) clearInterval(priceTimer);
    priceTimer=setInterval(async()=>{ if(!limitOrder){ clearInterval(priceTimer); return; } const p=await getPrice(); if(!p) return; const prec=getPrec(pair); document.getElementById('currentPrice').innerHTML=`$${p.toFixed(prec)}`; if((limitOrder.signalType==='LONG'&&p<=limitOrder.idealEntry)||(limitOrder.signalType==='SHORT'&&p>=limitOrder.idealEntry)){ clearLimit(); showNotif(`✅ FILLED! ${limitOrder.signalType} @ $${p.toFixed(prec)}`,'success'); try{new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play();}catch(e){} } },2000);
}

function handleLimit() { if(!analysis||analysis.signalType==='NEUTRAL'){ showNotif('No signal','error'); return; } if(limitOrder){ cancelLimit(); return; } const o={id:Date.now(),pair,signalType:analysis.signalType,idealEntry:analysis.idealEntry,stopLoss:analysis.stopLoss,takeProfit1:analysis.takeProfit1,takeProfit2:analysis.takeProfit2,takeProfit3:analysis.takeProfit3,confidence:analysis.confidence,createdAt:new Date().toISOString()}; saveLimit(o); startMonitor(); showNotif(`📝 Limit @ $${o.idealEntry.toFixed(getPrec(pair))}`,'info'); }

function copyJson() { const t=document.getElementById('jsonOutput').innerHTML; if(t.includes('Click')){ showNotif('Run analysis first','warning'); return; } navigator.clipboard.writeText(t).then(()=>showNotif('📋 Copied!','success')).catch(()=>showNotif('Failed','error')); }
function showNotif(m,t) { const n=document.getElementById('notification'); n.innerHTML=m; n.className=`notification ${t}`; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'),3000); }
