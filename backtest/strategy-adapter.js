'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadStrategyContext() {
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
        window: { Telegram: null, __ICT_MARKET_DATA_PROVIDER__: 'TVKIT' },
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
    const blockSignature = blocks.map(block => {
        const last = block.candles?.at(-1);
        return `${block.timeframe}:${block.candles?.length || 0}:${last?.t || last?.timestamp || ''}`;
    }).join('|');
    const roleAudit = cache?.roleAudits?.has(blockSignature)
        ? cache.roleAudits.get(blockSignature)
        : context.buildRawTextTimeframeRoleAudit(blocks, precision);
    if (cache && !cache.roleAudits.has(blockSignature)) cache.roleAudits.set(blockSignature, roleAudit);
    const dailyBlocks = blocks.some(block => block.timeframe === '1D')
        ? blocks
        : blocks;
    const marketContextResult = context.buildRawTextMarketContext(
        dailyBlocks,
        currentPrice,
        precision,
        asOfMs,
        roleAudit.daily_bias
    );
    const crtKey = `${symbol}|${precision}|${blockSignature}`;
    const crtAudit = cache?.crtAudits?.has(crtKey)
        ? cache.crtAudits.get(crtKey)
        : context.buildRawTextDeterministicCrtAudit(blocks, symbol, metadata, precision);
    if (cache && !cache.crtAudits.has(crtKey)) cache.crtAudits.set(crtKey, crtAudit);
    const msnrAudit = context.buildRawTextDeterministicMsnrAudit(blocks, currentPrice, symbol, metadata, precision);
    const supplyDemand = context.buildRawTextSupplyDemandAudit(blocks, precision, asOfMs);
    const zones = context.buildRawTextHighProbabilityZones(
        blocks,
        currentPrice,
        precision,
        {
            crt_records: crtAudit.records,
            msnr_records: msnrAudit.records,
            supply_demand_records: supplyDemand,
            as_of_ms: asOfMs
        },
        marketContextResult.context,
        roleAudit
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
