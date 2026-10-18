'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadStrategyContext(options = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    const fakeElement = () => ({
        addEventListener() {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        style: {},
        innerHTML: '',
        textContent: '',
        dataset: { category: 'metals' },
        value: '',
        disabled: false
    });
    const context = {
        window: {
            Telegram: null,
            __ICT_MARKET_DATA_PROVIDER__: 'TVKIT',
            __V2_STRATEGY_MODE__: options.strategyMode || 'LEGACY'
        },
        document: {
            readyState: 'loading',
            getElementById: fakeElement,
            addEventListener() {},
            querySelector: fakeElement,
            querySelectorAll() { return []; },
            body: { insertAdjacentHTML() {}, appendChild() {} },
            createElement: fakeElement
        },
        console,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        setTimeout: () => 0,
        setInterval: () => 0,
        clearInterval() {},
        clearTimeout() {},
        Date,
        Math,
        JSON,
        URL,
        URLSearchParams,
        performance: { now: () => Date.now() },
        navigator: { clipboard: null },
        btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
        atob: value => Buffer.from(String(value), 'base64').toString('binary'),
        Buffer,
        require,
        process
    };
    context.window.window = context.window;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'script.js' });
    return context;
}

function historyCacheFromBlocks(blocks) {
    return Object.fromEntries((blocks || []).map(block => [block.timeframe, (block.candles || []).map(candle => ({ ...candle }))]));
}

function marketMechanicsReplayRecord(candidate, block, asOfMs) {
    const zone = candidate?.zone || {};
    const created = candidate?.execution_zone_created_time || zone.created_time || candidate?.strategy_setup?.event_time || asOfMs;
    const createdMs = Number.isFinite(Number(created)) ? Number(created) : Date.parse(created);
    const createdIso = Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date(asOfMs).toISOString();
    const direction = String(candidate?.direction || '').toUpperCase();
    const fvgType = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
    const lower = Number(zone.low ?? candidate?.zone_low);
    const upper = Number(zone.high ?? candidate?.zone_high);
    const syntheticRef = `MM:${candidate?.id || `${direction}:${createdIso}:${lower}:${upper}`}`;
    const fvg = {
        timeframe: String(candidate?.timeframe || block?.timeframe || '1H').toUpperCase(),
        type: fvgType,
        c1: syntheticRef,
        c2: '',
        c3: createdIso,
        lower: Number.isFinite(lower) ? lower : null,
        upper: Number.isFinite(upper) ? upper : null,
        status: candidate?.freshness || 'UNTOUCHED'
    };
    const pendingAction = direction === 'BUY' ? 'BUY_LIMIT' : 'SELL_LIMIT';
    const candidateView = {
        ...candidate,
        action: pendingAction,
        stop_loss: candidate?.stop_loss,
        risk: candidate?.risk_distance,
        entry: candidate?.entry,
        tp1: candidate?.tp1,
        tp2: candidate?.tp2,
        tp3: candidate?.tp3
    };
    return {
        fvg,
        candidate: candidateView,
        block: { timeframe: String(candidate?.timeframe || block?.timeframe || '1H').toUpperCase() },
        current: {
            structurally_valid: candidate?.TRADE_QUALIFIED !== 'NO',
            current_opportunity: true,
            today_opportunity: true,
            opportunity_status: candidate?.opportunity_status || 'CURRENT_SELECTABLE',
            entry_distance_atr: candidate?.distance_from_current_price_atr ?? null,
            approach_state: candidate?.approach_state || null,
            formation_age_hours: Number.isFinite(createdMs) ? Math.max(0, (asOfMs - createdMs) / 3600000) : null
        },
        delivery: {
            entry_state: 'PENDING_UNFILLED',
            delivery_status: 'WAITING_FOR_ENTRY',
            pre_entry_progress: candidate?.pre_entry_progress || null
        },
        score: candidate?.score ?? candidate?.setup_confidence ?? null,
        current_score: candidate?.score ?? candidate?.setup_confidence ?? null,
        quality: candidate?.quality || null,
        confluence: {
            crt: candidate?.strategy_setup?.strategy_evidence?.crt_refs || [],
            msnr: candidate?.strategy_setup?.strategy_evidence?.msnr_refs || []
        },
        supplyDemand: { supporting_type: candidate?.zone_type || null },
        displacement: { label: candidate?.strategy_setup?.strategy_evidence?.displacement_ref || null },
        premiumDiscount: { location: candidate?.market_plan?.location || null },
        execution: { exec_15m: candidate?.strategy_setup?.execution_timeframe || candidate?.timeframe || null, exec_5m: null },
        path_quality: {
            trade_qualified: candidate?.TRADE_QUALIFIED !== 'NO',
            entry_inside_opposing_4h: candidate?.ENTRY_INSIDE_OPPOSING_4H || 'NO',
            opposing_4h_barrier_before_tp1: candidate?.OPPOSING_4H_BARRIER_BEFORE_TP1 || 'NO',
            nearest_opposing_4h_ref: candidate?.NEAREST_OPPOSING_4H_REF || 'NONE',
            nearest_opposing_4h_type: candidate?.NEAREST_OPPOSING_4H_TYPE || 'NONE',
            nearest_opposing_4h_zone: candidate?.NEAREST_OPPOSING_4H_ZONE || 'NONE',
            barrier_distance_r: candidate?.BARRIER_DISTANCE_R ?? null,
            clear_path_to_tp1: candidate?.CLEAR_PATH_TO_TP1 || 'YES',
            path_quality_penalty: candidate?.PATH_QUALITY_PENALTY || 0,
            qualification_blockers: candidate?.QUALIFICATION_BLOCKERS || []
        },
        breakdown: candidate?.confidence_breakdown || {},
        strategy_setup: candidate?.strategy_setup || null
    };
}

function analyzeMarketMechanicsHistory(context, input) {
    const blocks = input.blocks || [];
    const asOfMs = Number(input.asOfMs);
    const symbol = input.symbol || 'UNKNOWN';
    const precision = Number.isInteger(input.precision) ? input.precision : 2;
    const historyCache = historyCacheFromBlocks(blocks);
    const executionBars = historyCache['5M'] || [];
    const currentPrice = Number(input.currentPrice ?? executionBars.at(-1)?.c);
    const live = context.buildLiveMarketContext({
        pair: symbol,
        price: currentPrice,
        historyCache,
        indicators: {},
        patterns: {},
        enhancedAnalysis: {},
        holistic: {},
        entryContext: null,
        as_of_ms: asOfMs,
        quote_snapshot: { symbol_metadata: input.symbolMetadata || {}, provider_timestamp: asOfMs },
        snapshot_completeness: null
    });
    const candidates = Array.isArray(live.adaptive_setup_candidates) ? live.adaptive_setup_candidates : [];
    const records = candidates.map(candidate => marketMechanicsReplayRecord(candidate, blocks.find(block => block.timeframe === String(candidate.timeframe || '').toUpperCase()), asOfMs));
    return {
        as_of_ms: asOfMs,
        current_price: currentPrice,
        role_audit: { daily_bias: live.daily_bias || live.market_plan?.bias || null },
        market_context: live.market_context || live.market_plan || null,
        market_plan: live.market_plan || null,
        market_mechanics: live.market_mechanics || null,
        crt_audit: { records: [], lines: [] },
        msnr_audit: { records: [], lines: [] },
        supply_demand: [],
        zones: {
            records,
            all_records: records,
            current_records: records,
            model_router: null
        }
    };
}

function analyzeVisibleHistory(context, input) {
    const blocks = input.blocks || [];
    const symbol = input.symbol || 'UNKNOWN';
    const precision = Number.isInteger(input.precision) ? input.precision : 2;
    const currentPrice = Number(input.currentPrice);
    const asOfMs = Number(input.asOfMs);
    const metadata = input.symbolMetadata || {};
    const cache = input.cache || null;
    if (input.strategyMode) context.window.__V2_STRATEGY_MODE__ = input.strategyMode;
    if (String(input.strategyMode || context.window.__V2_STRATEGY_MODE__ || '').toUpperCase() === 'MARKET_MECHANICS') {
        return analyzeMarketMechanicsHistory(context, input);
    }
    const blockSignature = blocks.map(block => {
        const last = block.candles?.at(-1);
        return `${block.timeframe}:${block.candles?.length || 0}:${last?.t || last?.timestamp || ''}`;
    }).join('|');
    const blockKey = block => {
        const last = block.candles?.at(-1);
        return `${block.timeframe}:${block.candles?.length || 0}:${last?.t || last?.timestamp || ''}`;
    };
    const cacheMap = (name, fallback) => {
        if (!cache) return fallback;
        if (!cache[name]) cache[name] = new Map();
        return cache[name];
    };
    const auditLinesByRef = (records, lines) => {
        const byRef = new Map((records || []).map((record, index) => [record.ref, lines?.[index]]));
        return (records || []).map(record => byRef.get(record.ref)).filter(Boolean);
    };
    const roleBlock = blocks.find(block => block.timeframe === '1D');
    const roleKey = roleBlock ? blockKey(roleBlock) : 'NONE';
    const roleMap = cacheMap('roleAuditsByTimeframe', null);
    const roleAudit = roleMap?.has(roleKey)
        ? roleMap.get(roleKey)
        : context.buildRawTextTimeframeRoleAudit(roleBlock ? [roleBlock] : blocks, precision);
    if (roleMap && !roleMap.has(roleKey)) roleMap.set(roleKey, roleAudit);
    const dailyBlocks = blocks.some(block => block.timeframe === '1D')
        ? blocks
        : blocks;
    const contextKey = dailyBlocks.filter(block => ['1D', '4H', '1H'].includes(block.timeframe)).map(blockKey).join('|');
    const contextMap = cacheMap('marketContextsByTimeframe', null);
    const cachedContext = contextMap?.get(contextKey);
    let marketContextResult;
    if (!cachedContext) {
        marketContextResult = context.buildRawTextMarketContext(
            dailyBlocks,
            currentPrice,
            precision,
            asOfMs,
            roleAudit.daily_bias
        );
        if (contextMap) contextMap.set(contextKey, marketContextResult.context);
    } else {
        const cached = cachedContext;
        const price = Number(currentPrice);
        const increment = 10 ** -precision;
        const contextValue = { ...cached, as_of_ms: asOfMs };
        if (cached.dealing_range) {
            const equilibrium = Number(cached.dealing_range.equilibrium);
            contextValue.dealing_range = {
                ...cached.dealing_range,
                location: Number.isFinite(price) && Number.isFinite(equilibrium)
                    ? Math.abs(price - equilibrium) <= increment / 2 ? 'EQUILIBRIUM' : price < equilibrium ? 'DISCOUNT' : 'PREMIUM'
                    : 'UNKNOWN'
            };
        }
        if (cached.ema) {
            contextValue.ema = Object.fromEntries(Object.entries(cached.ema).map(([timeframe, values]) => {
                const next = { ...values };
                for (const period of [20, 50, 200]) {
                    const value = Number(values['ema' + period]);
                    next['price_vs_' + period] = Number.isFinite(value) && Number.isFinite(price) ? price === value ? 'AT' : price > value ? 'ABOVE' : 'BELOW' : 'UNKNOWN';
                }
                return [timeframe, next];
            }));
        }
        marketContextResult = { context: contextValue };
    }
    const buildPerTimeframeAudit = (cacheName, builder) => {
        const map = cacheMap(cacheName, null);
        const parts = [];
        for (const block of blocks) {
            const key = `${symbol}|${precision}|${blockKey(block)}`;
            let part = map?.get(key);
            if (!part) {
                part = builder(block);
                if (map) map.set(key, part);
            }
            parts.push(part);
        }
        const records = parts.flatMap(part => part?.records || part || []);
        const lines = parts.flatMap(part => part?.lines || []);
        return { records, lines };
    };
    const crtAudit = buildPerTimeframeAudit('crtAuditsByTimeframe', block => context.buildRawTextDeterministicCrtAudit([block], symbol, metadata, precision));
    const msnrParts = buildPerTimeframeAudit('msnrAuditsByTimeframe', block => context.buildRawTextDeterministicMsnrAudit([block], currentPrice, symbol, metadata, precision));
    const msnrRecords = [];
    for (const block of blocks) {
        const key = `${symbol}|${precision}|${blockKey(block)}`;
        const part = cache?.msnrAuditsByTimeframe?.get(key);
        const records = (part?.records || []).slice().sort((left, right) => {
            const leftLevel = Number(left.level?.level ?? ((Number(left.zone_low) + Number(left.zone_high)) / 2));
            const rightLevel = Number(right.level?.level ?? ((Number(right.zone_low) + Number(right.zone_high)) / 2));
            return Math.abs(leftLevel - currentPrice) - Math.abs(rightLevel - currentPrice);
        });
        msnrRecords.push(...records);
    }
    const msnrLineMap = new Map((msnrParts.lines || []).map((line, index) => [msnrParts.records[index]?.ref, line]));
    const msnrAudit = { records: msnrRecords, lines: msnrRecords.map(record => msnrLineMap.get(record.ref)).filter(Boolean) };
    const supplyDemandAudit = buildPerTimeframeAudit('supplyDemandAuditsByTimeframe', block => {
        if (!['4H', '1H'].includes(block.timeframe)) return [];
        return context.buildRawTextSupplyDemandAudit([block], precision, asOfMs);
    });
    const supplyDemand = supplyDemandAudit.records;
    const zones = context.buildRawTextHighProbabilityZones(
        blocks,
        currentPrice,
        precision,
        {
            crt_records: crtAudit.records,
            msnr_records: msnrAudit.records,
            tbs_records: buildPerTimeframeAudit('tbsAuditsByTimeframe', block => {
                if (typeof context.buildRawTextDeterministicTbsAudit !== 'function') return [];
                return context.buildRawTextDeterministicTbsAudit([block], symbol, metadata, precision);
            }).records,
            supply_demand_records: supplyDemand,
            as_of_ms: asOfMs,
            strategy_mode: context.window.__V2_STRATEGY_MODE__ || 'LEGACY',
            performance_cache: cache
        },
        marketContextResult.context,
        roleAudit,
        cache
    );
    return {
        as_of_ms: asOfMs,
        current_price: currentPrice,
        role_audit: roleAudit,
        market_context: marketContextResult.context,
        crt_audit: crtAudit,
        msnr_audit: msnrAudit,
        supply_demand: supplyDemand,
        zones
    };
}

module.exports = { loadStrategyContext, analyzeVisibleHistory };
