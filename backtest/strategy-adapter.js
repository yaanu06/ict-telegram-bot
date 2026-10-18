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

function analyzeVisibleHistory(context, input) {
    const blocks = input.blocks || [];
    const symbol = input.symbol || 'UNKNOWN';
    const precision = Number.isInteger(input.precision) ? input.precision : 2;
    const currentPrice = Number(input.currentPrice);
    const asOfMs = Number(input.asOfMs);
    const metadata = input.symbolMetadata || {};
    const cache = input.cache || null;
    if (input.strategyMode) context.window.__V2_STRATEGY_MODE__ = input.strategyMode;
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
