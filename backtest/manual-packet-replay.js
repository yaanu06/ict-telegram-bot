'use strict';

// Read-only replay of the evidence actually present in a pasted RAW packet.
// Missing daily history / bid-ask / runtime state is never synthesized.
const fs = require('fs');
const { loadStrategyContext } = require('./strategy-adapter');

function parseManualPacket(text) {
    const pair = text.match(/^SYMBOL: (.+)$/m)?.[1].trim();
    const price = Number(text.match(/^CURRENT PRICE: ([\d.]+)/m)?.[1]);
    const asOf = Date.parse(text.match(/^GENERATED AT: (.+)$/m)?.[1].trim());
    if (!pair || !Number.isFinite(price) || !Number.isFinite(asOf)) throw new Error('Packet identity missing');
    const history = {};
    for (const block of text.matchAll(/======== TIMEFRAME: (\w+) ========([\s\S]*?)======== END \w+ ========/g)) {
        const tf = block[1].toUpperCase();
        history[tf] = block[2].split(/\r?\n/).filter(line => /^\d{4}-\d\d-\d\dT[^,]+,/.test(line)).map(line => {
            const [t, o, h, l, c, v] = line.split(',');
            return { t, o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v), is_closed: true };
        });
        const diagnostic = text.split(/\r?\n/).find(line => line.startsWith(`DATA_${tf}_DIAGNOSTIC `)) || '';
        const semantics = diagnostic.match(/TIMESTAMP_SEMANTICS=(OPEN|CLOSE)/)?.[1];
        history[tf].provider_metadata = { timestamp_semantics: semantics || 'OPEN',
            source: semantics ? 'PACKET_DIAGNOSTIC' : 'TVKIT_OPEN_TIMESTAMP_FALLBACK' };
    }
    const opportunities = text.split(/\r?\n/).filter(line => line.startsWith('OPPORTUNITY_EVIDENCE=')).map(line => JSON.parse(line.slice('OPPORTUNITY_EVIDENCE='.length)));
    return { pair, price, asOf, history, opportunities,
        limitations: ['Text packet has no original runtime snapshot, provider quote timestamp or executable bid/ask; quote freshness cannot be independently verified', ...(!history['1D'] ? ['Daily OHLC absent; full-snapshot data acceptance cannot be asserted'] : [])] };
}

function replayManualPacket(text) {
    const input = parseManualPacket(text);
    const savedLog = console.log;
    let ctx;
    try { console.log = () => {}; ctx = loadStrategyContext({ strategyMode: 'MARKET_MECHANICS' }); }
    finally { console.log = savedLog; }
    ctx.console = { log() {}, warn() {}, error() {} };
    const history = Object.fromEntries(Object.entries(input.history).map(([tf, bars]) => [tf, ctx.marketMechanicsClosed(bars, tf, input.asOf)]));
    const live = ctx.buildLiveMarketContext({ pair: input.pair, price: input.price, historyCache: history,
        as_of_ms: input.asOf, patterns: ctx.buildReplayPatterns(history, input.price, input.pair), indicators: {}, holistic: {},
        enhancedAnalysis: {}, quote_snapshot: { price: input.price, timestamp: new Date(input.asOf).toISOString(), quote_source: 'PACKET_OBSERVED_PRICE' } });
    const capture = ctx.createScanReplay(live);
    const packet = ctx.buildRawTextMarketAnalysisPacket({ replay: capture });
    const shortlist = ctx.buildManualMarketMechanicsOpportunityShortlist(capture, input.price);
    return { input, ctx, live, capture, packet, shortlist };
}

if (require.main === module) {
    const result = replayManualPacket(fs.readFileSync(process.argv[2], 'utf8'));
    console.log(JSON.stringify({ symbol: result.input.pair, limitations: result.input.limitations,
        counts: Object.fromEntries(Object.entries(result.input.history).map(([tf, bars]) => [tf, bars.length])),
        data: { status: result.live.data_quality.status, timeframes: result.live.data_quality.timeframe_status }, plan: result.live.market_plan?.direction,
        funnel: result.live.market_mechanics?.candidate_catalog?.search_counts,
        shortlist: result.shortlist.map(row => ({ id: row.opportunity_id, entry: row.suggested_entry, time: row.formation_first_knowable_time, touch: row.entry_touched, warnings: row.quality_warnings })),
        lifecycle_distribution: result.live.market_mechanics.manual_model_states.reduce((counts, state) => {
            const reason = state.setup_lifecycle?.rejection_code || 'ACTIVE';
            counts[reason] = (counts[reason] || 0) + 1;
            return counts;
        }, {}),
        formations: result.live.market_mechanics.manual_model_states.map(s => ({ id: s.source_setup_id,
            model: s.model, zone: s.execution_poi_id, entry: s.proposed_entry,
            first_actionable: s.first_actionable_time, first_touch: s.first_entry_touch_time,
            lifecycle: s.lifecycle_classification, rejection: s.setup_lifecycle?.rejection_code,
            diagnostics: s.lifecycle_diagnostics })) }, null, 2));
}
module.exports = { parseManualPacket, replayManualPacket };
