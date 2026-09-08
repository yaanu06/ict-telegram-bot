// ICT Trading Bot Pro - deterministic AI validation hardening
// Loaded after script.js so the existing scan/execution flow keeps working while
// these corrected implementations replace the earlier global functions.

const ICT_LAST_TRADE_TIME_KEY = 'ict_last_trade_time';
const ICT_FIVE_MIN_MS = 5 * 60 * 1000;

function ictFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function ictCanonicalZoneType(value) {
    const s = String(value || '').trim().toUpperCase();
    if (!s || s === 'CONFLUENCE' || s === 'AI ZONE' || s === 'AI IDENTIFIED') return null;
    if (s.includes('FVG') || s.includes('FAIR VALUE')) return 'FVG';
    if (s === 'OB' || s.includes('ORDER BLOCK')) return 'OB';
    if (s.includes('MSNR') || s.includes('SUPPORT') || s.includes('RESISTANCE')) return 'MSNR';
    return null;
}

function ictBuildRealZones(data, price, direction, pairLocal) {
    if (!data || data.length < 20) return [];
    const zones = [];
    const settings = getMarketSettings(pairLocal);
    const edgePad = Math.max(settings.pipSize * 2, price * 0.000001);

    for (const fvg of detectFVG(data)) {
        if (direction === 'BUY' && fvg.type === 'bull' && fvg.l < price) {
            zones.push({ type: 'FVG', low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad });
        }
        if (direction === 'SELL' && fvg.type === 'bear' && fvg.h > price) {
            zones.push({ type: 'FVG', low: fvg.l, high: fvg.h, price: fvg.m, tolerance: edgePad });
        }
    }

    for (const ob of detectOrderBlocks(data, direction)) {
        if (direction === 'BUY' && ob.high < price) {
            zones.push({ type: 'OB', low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad });
        }
        if (direction === 'SELL' && ob.low > price) {
            zones.push({ type: 'OB', low: ob.low, high: ob.high, price: (ob.low + ob.high) / 2, tolerance: edgePad });
        }
    }

    const msnr = calculateMSNR(data, price);
    const levels = direction === 'BUY' ? (msnr.allSupports || []) : (msnr.allResistances || []);
    for (const level of levels) {
        zones.push({
            type: 'MSNR',
            low: level * 0.9995,
            high: level * 1.0005,
            price: level,
            tolerance: edgePad
        });
    }

    return zones.filter(z => ictFiniteNumber(z.low) && ictFiniteNumber(z.high) && z.high >= z.low);
}

function ictZoneMatchesAI(realZone, aiResult) {
    const entry = aiResult.entry;
    const tol = Math.max(realZone.tolerance || 0, (realZone.high - realZone.low) * 0.1);
    const entryInside = entry >= realZone.low - tol && entry <= realZone.high + tol;
    if (!entryInside) return false;

    const declaredType = ictCanonicalZoneType(aiResult.entry_zone?.source);
    if (declaredType && declaredType !== realZone.type) return false;

    const aiLow = Number(aiResult.entry_zone?.low);
    const aiHigh = Number(aiResult.entry_zone?.high);
    if (Number.isFinite(aiLow) && Number.isFinite(aiHigh)) {
        const lo = Math.min(aiLow, aiHigh);
        const hi = Math.max(aiLow, aiHigh);
        const overlaps = hi >= realZone.low - tol && lo <= realZone.high + tol;
        if (!overlaps) return false;
    }

    return true;
}

function checkZoneFreshness(data, zone, direction) {
    if (!data || !data.length) return { fresh: false, partiallyUsed: false, used: true, touches: 0, violations: 0 };
    let touches = 0;
    let violations = 0;
    let engaged = false;
    const lookback = Math.min(50, data.length);
    const zoneLow = Number(zone?.low ?? zone * 0.998);
    const zoneHigh = Number(zone?.high ?? zone * 1.002);

    for (let i = data.length - lookback; i < data.length; i++) {
        if (i < 0) continue;
        const close = data[i].c;
        const closeInZone = close >= zoneLow && close <= zoneHigh;
        if (closeInZone) {
            touches++;
            engaged = true;
            continue;
        }
        if (!engaged) continue;
        if (direction === 'BUY' && close < zoneLow) violations++;
        if (direction === 'SELL' && close > zoneHigh) violations++;
    }

    const fresh = touches <= 2 && violations === 0;
    const partiallyUsed = touches <= 5 && violations <= 1;
    const used = touches > 5 || violations > 1;
    return { fresh, partiallyUsed, used, touches, violations };
}

function validateAISetup(aiResult, price, historyCache, pairArg) {
    const pairLocal = pairArg || pair;
    const checks = {};
    const factors = [];

    function reject(reason) {
        const msg = `AI Setup rejected: ${reason}`;
        console.log(`❌ AI VALIDATION REJECTED: ${reason}`);
        lastScanRejections.push(msg);
        return {
            valid: false,
            reason: msg,
            adjustedConfidence: 0,
            deterministicConfidence: 0,
            localScore: 0,
            aiConf: Number(aiResult?.confidence) || 0,
            checks,
            factors
        };
    }

    if (!aiResult || typeof aiResult !== 'object') return reject('AI result missing');
    if (aiResult.direction !== 'BUY' && aiResult.direction !== 'SELL') {
        return reject(`invalid direction "${aiResult.direction}"`);
    }

    for (const [name, value] of [
        ['entry', aiResult.entry],
        ['stop_loss', aiResult.stop_loss],
        ['take_profit_1', aiResult.take_profit_1]
    ]) {
        if (!ictFiniteNumber(value)) return reject(`${name} must be a finite number`);
    }

    if (!ictFiniteNumber(price) || price <= 0) return reject('current price is invalid');

    const direction = aiResult.direction;
    const entry = aiResult.entry;
    const stopLoss = aiResult.stop_loss;
    const tp1 = aiResult.take_profit_1;
    const settings = getMarketSettings(pairLocal);
    const fourH = historyCache?.['4H'] || [];
    const oneH = historyCache?.['1H'] || [];
    const daily = historyCache?.['1D'] || [];
    const atr4h = fourH.length >= 15 ? atr(fourH, 14) : 0;
    const atr1h = oneH.length >= 15 ? atr(oneH, 14) : 0;
    const atrVal = (ictFiniteNumber(atr4h) && atr4h > 0 ? atr4h : 0) || (ictFiniteNumber(atr1h) && atr1h > 0 ? atr1h : 0);

    if (direction === 'BUY' && !(stopLoss < entry && tp1 > entry)) {
        return reject(`BUY geometry invalid (SL ${stopLoss} < entry ${entry} < TP1 ${tp1} required)`);
    }
    if (direction === 'SELL' && !(stopLoss > entry && tp1 < entry)) {
        return reject(`SELL geometry invalid (TP1 ${tp1} < entry ${entry} < SL ${stopLoss} required)`);
    }
    checks.geometry = true;

    let matchedZone = null;
    let matchedZoneTf = null;
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        const candidates = ictBuildRealZones(data, price, direction, pairLocal);
        const match = candidates.find(z => ictZoneMatchesAI(z, aiResult));
        if (match) {
            matchedZone = match;
            matchedZoneTf = tf;
            break;
        }
    }
    if (!matchedZone) {
        return reject('no real deterministic FVG/OB/MSNR matches the AI entry and declared zone');
    }
    checks.realZone = true;
    factors.push(`Real ${matchedZone.type} matched on ${matchedZoneTf} (+20)`);

    const zoneTol = Math.max(matchedZone.tolerance || 0, (matchedZone.high - matchedZone.low) * 0.1);
    if (entry < matchedZone.low - zoneTol || entry > matchedZone.high + zoneTol) {
        return reject(`entry ${entry} is outside deterministic ${matchedZone.type} ${matchedZone.low}-${matchedZone.high}`);
    }
    checks.entryInsideZone = true;

    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(tp1 - entry);
    const rr1 = risk > 0 ? reward / risk : 0;
    const minRR = settings.targetRR || 2.5;
    if (!Number.isFinite(rr1) || rr1 < minRR) {
        return reject(`real RR ${Number.isFinite(rr1) ? rr1.toFixed(2) : 'invalid'} below ${minRR.toFixed(2)} minimum`);
    }
    checks.realRR = rr1;

    const maxSLDistance = entry * settings.maxSLPct;
    const minATRMultiplier = pairLocal.includes('XAU') ? 2.0 : 1.5;
    if (risk < settings.minSL) {
        return reject(`SL distance ${risk.toFixed(settings.prec)} below market minimum ${settings.minSL}`);
    }
    if (risk > maxSLDistance) {
        return reject(`SL distance ${risk.toFixed(settings.prec)} exceeds max ${settings.maxSLPct * 100}% of entry`);
    }
    if (atrVal > 0 && risk < atrVal * minATRMultiplier) {
        return reject(`SL distance ${risk.toFixed(settings.prec)} is below ${minATRMultiplier.toFixed(1)}x ATR (${(atrVal * minATRMultiplier).toFixed(settings.prec)})`);
    }
    if (atrVal > 0 && risk > atrVal * 4.0) {
        return reject(`SL distance ${risk.toFixed(settings.prec)} exceeds 4.0x ATR`);
    }
    checks.stopLoss = true;

    if (atrVal > 0) {
        const entryDistATR = Math.abs(entry - price) / atrVal;
        if (entryDistATR > LIMIT_ORDER_MAX_DIST_ATR) {
            return reject(`entry is ${entryDistATR.toFixed(2)}x ATR from price (max ${LIMIT_ORDER_MAX_DIST_ATR}x)`);
        }
        checks.entryDistanceATR = entryDistATR;
    }

    const desiredTrend = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const htfDirections = {
        '1D': daily.length >= 50 ? detectTrend(daily) : 'NEUTRAL',
        '4H': fourH.length >= 50 ? detectTrend(fourH) : 'NEUTRAL',
        '1H': oneH.length >= 50 ? detectTrend(oneH) : 'NEUTRAL'
    };
    const htfMatch = Object.values(htfDirections).filter(v => v === desiredTrend).length;
    if (htfMatch < HTF_MIN_MATCH) {
        return reject(`HTF alignment ${htfMatch}/3 below ${HTF_MIN_MATCH}/3 minimum`);
    }
    checks.htfMatch = htfMatch;

    const oppositeDirection = direction === 'BUY' ? 'SELL' : 'BUY';
    let confirmingCHoCH = false;
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (!data || data.length < 20) continue;
        if (detectCHoCH(data, oppositeDirection)) {
            return reject(`opposing ${oppositeDirection} CHoCH detected on ${tf}`);
        }
        if (detectCHoCH(data, direction)) confirmingCHoCH = true;
    }
    checks.choch = confirmingCHoCH ? 'CONFIRMS' : 'NONE';

    if (!checkLossProtection()) {
        return reject(`loss protection active (${consecutiveLosses} losses / ${dailyPnlR.toFixed(1)}R daily)`);
    }
    checks.lossProtection = true;

    if (!checkTradeGap(2)) return reject('trade gap active — wait 2h from actual fill');
    checks.tradeGap = true;

    const freshnessData = historyCache?.[matchedZoneTf];
    const freshness = checkZoneFreshness(freshnessData, matchedZone, direction);
    if (freshness.violations > 1) {
        return reject(`matched zone invalidated ${freshness.violations} times`);
    }
    if (freshness.touches > MAX_ZONE_TOUCHES) {
        return reject(`matched zone has ${freshness.touches} touches (max ${MAX_ZONE_TOUCHES})`);
    }
    checks.freshness = freshness;

    let score = 20;
    score += htfMatch * 12;
    factors.push(`HTF ${htfMatch}/3 (+${htfMatch * 12})`);

    if (freshness.fresh) {
        score += 12;
        factors.push('Fresh zone (+12)');
    } else if (freshness.partiallyUsed) {
        score += 6;
        factors.push(`Partially used zone (${freshness.touches} touches, +6)`);
    } else {
        factors.push(`Used zone (${freshness.touches} touches, +0)`);
    }

    if (rr1 >= 3.0) {
        score += 12;
        factors.push(`RR ${rr1.toFixed(2)} (+12)`);
    } else {
        score += 8;
        factors.push(`RR ${rr1.toFixed(2)} (+8)`);
    }

    if (confirmingCHoCH) {
        score += 8;
        factors.push(`CHoCH confirms ${direction} (+8)`);
    }

    let mss = null;
    if (fourH.length >= 21) {
        mss = detectMSS(fourH);
        if (mss) {
            const agrees = (mss.type === 'BULL' && direction === 'BUY') || (mss.type === 'BEAR' && direction === 'SELL');
            if (agrees) {
                score += 8;
                factors.push(`MSS ${mss.type} confirms ${direction} (+8)`);
                console.log(`✅ MSS confirms ${direction} (+8)`);
            } else {
                score -= 4;
                factors.push(`MSS ${mss.type} conflicts with ${direction} (-4)`);
                console.log(`⚠️ MSS ${mss.type} conflicts with ${direction}`);
            }
        }
    }
    checks.mss = mss;

    let bosCount = 0;
    for (const tf of ['4H', '1H']) {
        const data = historyCache?.[tf];
        if (data && data.length >= 20 && detectBOS(data, direction)) bosCount++;
    }
    if (bosCount > 0) {
        const bosBonus = Math.min(12, bosCount * 6);
        score += bosBonus;
        factors.push(`BOS ${bosCount}/2 (+${bosBonus})`);
    }
    checks.bosCount = bosCount;

    if (fourH.length >= 30) {
        const adx4 = calculateADX(fourH, 14, '4H');
        if (adx4.adx > 25) {
            score += 6;
            factors.push(`ADX 4H ${adx4.adx.toFixed(1)} (+6)`);
        } else if (adx4.adx < 15) {
            score -= 5;
            factors.push(`ADX 4H ${adx4.adx.toFixed(1)} (-5)`);
        }
        checks.adx4h = adx4.adx;
    }

    const deterministicConfidence = Math.max(0, Math.min(95, Math.round(score)));
    const aiConf = Number(aiResult.confidence) || 0;

    console.log('✅ AI VALIDATION PASSED', {
        direction,
        entry,
        stopLoss,
        tp1,
        rr: rr1,
        matchedZone,
        matchedZoneTf,
        htfMatch,
        deterministicConfidence
    });

    return {
        valid: true,
        reason: null,
        adjustedConfidence: deterministicConfidence,
        deterministicConfidence,
        localScore: deterministicConfidence,
        aiConf,
        rr1,
        htfMatch,
        matchedZone,
        matchedZoneTf,
        freshness,
        checks,
        factors
    };
}

const ictOriginalCheckEntryConfirmation = checkEntryConfirmation;
checkEntryConfirmation = function(data, zone, direction) {
    const result = ictOriginalCheckEntryConfirmation(data, zone, direction);
    if (hasRealVolume(pair) || !result || !Array.isArray(result.confirmations)) return result;
    if (!result.confirmations.includes('Volume Spike')) return result;

    result.confirmations = result.confirmations.filter(x => x !== 'Volume Spike');
    result.score = Math.max(0, (result.score || 0) - 15);
    result.confirmed = result.score >= 25;
    result.strength = result.score >= 50 ? 'STRONG' : (result.score >= 25 ? 'MODERATE' : 'WEAK');
    result.shouldWait = !result.confirmed;
    result.reason = result.confirmations.length
        ? `✅ ${result.confirmations.join(', ')} (Score: ${result.score})`
        : '⏳ No confirmation signals - WAITING';
    return result;
};

const ictOriginalAnalyzeVolumeProfile = analyzeVolumeProfile;
analyzeVolumeProfile = function(data) {
    if (!hasRealVolume(pair)) {
        return {
            poc: null,
            vah: null,
            val: null,
            pocDistance: 0,
            description: 'Volume profile disabled (synthetic/unavailable volume)',
            realVolume: false
        };
    }
    return ictOriginalAnalyzeVolumeProfile(data);
};

function buildCandleData(historyCache, count = 10) {
    const tfs = ['1D', '4H', '1H', '15M', '5M'];
    const realVolume = hasRealVolume(pair);
    let data = '';
    for (const tf of tfs) {
        const candles = historyCache[tf];
        if (!candles || candles.length < count) continue;
        data += `\n### ${tf} CANDLES (Last ${count}):\n`;
        const slice = candles.slice(-count);
        const startIdx = candles.length - count;
        slice.forEach((c, i) => {
            const idx = startIdx + i;
            const o = (c.o || 0).toFixed(2);
            const h = (c.h || 0).toFixed(2);
            const l = (c.l || 0).toFixed(2);
            const cl = (c.c || 0).toFixed(2);
            const volumeText = realVolume ? ` V:${Math.round(c.v || 0)}` : ' V:n/a';
            data += `  ${idx}: O:${o} H:${h} L:${l} C:${cl}${volumeText}\n`;
        });
    }
    return data;
}

function ictSetLastTradeTime(ts) {
    lastTradeTime = ts;
    try { localStorage.setItem(ICT_LAST_TRADE_TIME_KEY, String(ts)); } catch (e) {}
}

function ictGetLastTradeTime() {
    let stored = 0;
    try { stored = Number(localStorage.getItem(ICT_LAST_TRADE_TIME_KEY)) || 0; } catch (e) {}
    return Math.max(lastTradeTime || 0, stored);
}

function checkTradeGap(minHours = 2) {
    const openedAt = ictGetLastTradeTime();
    if (!openedAt) return true;
    return Date.now() - openedAt >= minHours * 3600000;
}

function recordTradeResult(isWin, riskR) {
    if (!ictGetLastTradeTime()) ictSetLastTradeTime(Date.now());
    if (isWin) {
        consecutiveLosses = 0;
        dailyPnlR += riskR;
    } else {
        consecutiveLosses++;
        dailyPnlR -= riskR;
    }
}

function enqueuePendingFill(order, fillPrice) {
    const queue = loadPendingFills();
    const id = order.id || Date.now();
    if (queue.some(item => String(item.id) === String(id))) {
        console.log(`⚠️ pendingFills: duplicate ${id} ignored`);
        return;
    }

    const fillTime = Date.now();
    ictSetLastTradeTime(fillTime);
    queue.push({
        id,
        pair: order.pair || pair,
        signalType: order.signalType,
        entry: fillPrice,
        stopLoss: order.stopLoss,
        takeProfit1: order.takeProfit1,
        takeProfit2: order.takeProfit2,
        takeProfit3: order.takeProfit3,
        confidence: order.confidence || 0,
        patterns: order.patterns || '',
        rrUsed: order.rrUsed || 0,
        source: order.source || null,
        createdAt: new Date(fillTime).toISOString(),
        checkedAt: null
    });
    savePendingFills(queue);
    console.log(`📥 pendingFills: enqueued ${order.signalType} @ ${fillPrice}; cooldown started at fill time`);
}

function resolvePendingFill(fill, candles) {
    if (!fill || !candles || !candles.length) return { resolved: false, outcome: null, reason: 'no candles' };
    const created = new Date(fill.createdAt).getTime();
    if (!Number.isFinite(created)) return { resolved: false, outcome: null, reason: 'bad createdAt' };

    const firstEligibleStart = Math.ceil(created / ICT_FIVE_MIN_MS) * ICT_FIVE_MIN_MS;
    const currentCandleStart = Math.floor(Date.now() / ICT_FIVE_MIN_MS) * ICT_FIVE_MIN_MS;

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const t = parseCandleTimeUTC(c.t);
        if (!Number.isFinite(t) || t < firstEligibleStart || t >= currentCandleStart) continue;

        const slHit = fill.signalType === 'LONG'
            ? c.l <= fill.stopLoss
            : c.h >= fill.stopLoss;
        const tpHit = fill.signalType === 'LONG'
            ? c.h >= fill.takeProfit1
            : c.l <= fill.takeProfit1;

        if (slHit && tpHit) {
            return { resolved: true, outcome: 'LOSS', reason: `SL and TP1 both touched in 5M candle ${i}; conservative LOSS because intrabar order is unknowable` };
        }
        if (slHit) return { resolved: true, outcome: 'LOSS', reason: `SL hit first at candle ${i}` };
        if (tpHit) return { resolved: true, outcome: 'WIN', reason: `TP1 hit first at candle ${i}` };
    }

    return { resolved: false, outcome: null, reason: 'neither SL nor TP1 hit in completed post-fill candles' };
}

async function checkPendingFills() {
    const queue = loadPendingFills();
    if (!queue.length) return;
    const stillPending = [];

    for (const fill of queue) {
        const createdMs = new Date(fill.createdAt).getTime();
        const ageHours = Number.isFinite(createdMs) ? (Date.now() - createdMs) / 3600000 : Infinity;
        if (ageHours > 24 * 7) {
            console.log(`⏰ pendingFills: dropping ${fill.id} (${ageHours.toFixed(0)}h old, manual review required)`);
            continue;
        }
        if (ageHours < 10 / 60) {
            stillPending.push(fill);
            continue;
        }

        try {
            const candles = await getHistory('5M', fill.pair);
            if (!candles || candles.length < 3) {
                stillPending.push(fill);
                continue;
            }

            const result = resolvePendingFill(fill, candles);
            if (!result.resolved) {
                fill.checkedAt = new Date().toISOString();
                stillPending.push(fill);
                continue;
            }

            const isWin = result.outcome === 'WIN';
            const risk = Math.abs(fill.entry - fill.stopLoss);
            const reward = Math.abs(fill.takeProfit1 - fill.entry);
            const rr = risk > 0 ? reward / risk : 1;
            recordTradeResult(isWin, rr);

            try {
                const patterns = Array.isArray(fill.patterns)
                    ? fill.patterns
                    : String(fill.patterns || '').split('+').map(x => x.trim()).filter(Boolean);
                trackAIPerformance(String(fill.id), result.outcome, fill.confidence || 0, patterns, rr);
            } catch (e) {
                console.warn('pendingFills self-learning update failed:', e);
            }

            showNotif(
                `📊 Auto-detected: ${fill.pair || ''} ${fill.signalType} → ${isWin ? '✅ WIN' : '❌ LOSS'} (${result.reason})`,
                isWin ? 'success' : 'warning'
            );
            console.log(`📊 pendingFills: resolved ${fill.id} → ${result.outcome} (${result.reason})`);
        } catch (e) {
            console.error('pendingFills check error:', e);
            stillPending.push(fill);
        }
    }

    savePendingFills(stillPending);
}

const ictOriginalSaveCurrentSetup = saveCurrentSetup;
saveCurrentSetup = function() {
    const signal = lastSetupOut?.trade_signal;
    if (signal?.source === 'AI-Generated Setup' && signal?.validation?.passed !== true) {
        console.log('❌ AI VALIDATION REJECTED: blocked AI setup cannot be saved');
        showNotif('🚫 Blocked AI setup cannot be saved', 'warning');
        return;
    }
    return ictOriginalSaveCurrentSetup();
};

console.log('✅ Deterministic AI validation hardening loaded');
