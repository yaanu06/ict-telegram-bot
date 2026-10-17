const fs = require('fs');
const vm = require('vm');

function makeContext() {
    const fakeElement = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, contains() { return false; } }, style: {}, innerHTML: '', textContent: '', dataset: {}, value: '' });
    const context = {
        window: { Telegram: null, __ICT_MARKET_DATA_PROVIDER__: 'TVKIT' },
        document: { readyState: 'loading', getElementById: fakeElement, addEventListener() {}, querySelector: fakeElement, querySelectorAll() { return []; }, body: { insertAdjacentHTML() {} }, createElement: fakeElement },
        console: { log() {}, error() {}, warn() {} },
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        setTimeout() { return 0; }, setInterval() { return 0; }, clearTimeout() {}, clearInterval() {},
        Date, Math, JSON, URL, URLSearchParams, performance: { now: () => Date.now() },
        btoa: value => Buffer.from(String(value), 'binary').toString('base64'), Buffer
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('script.js', 'utf8'), context, { filename: 'script.js' });
    return context;
}

const supply = (low, high, extra = {}) => ({ ref: `SUPPLY:4H:${low}-${high}`, type: 'SUPPLY', direction: 'SELL', timeframe: '4H', low, high, status: 'FRESH', first_knowable_ms: 100, ...extra });
const demand = (low, high, extra = {}) => ({ ref: `DEMAND:4H:${low}-${high}`, type: 'DEMAND', direction: 'BUY', timeframe: '4H', low, high, status: 'FRESH', first_knowable_ms: 100, ...extra });
const buy = (entry = 100, stop = 99, tp1 = 101, structures = [], asOf = 200) => context.build4HPathQualityAudit({ direction: 'BUY', entry, stop_loss: stop, tp1 }, structures, asOf);
const sell = (entry = 100, stop = 101, tp1 = 99, structures = [], asOf = 200) => context.build4HPathQualityAudit({ direction: 'SELL', entry, stop_loss: stop, tp1 }, structures, asOf);

const context = makeContext();

describe('deterministic 4H path quality', () => {
    test('AUD regression blocks a BUY entered inside opposing 4H supply', () => {
        const result = context.build4HPathQualityAudit({ direction: 'BUY', entry: 0.69524, stop_loss: 0.69374, tp1: 0.69674 }, [
            { ref: 'SUPPLY:4H:AUD-REGRESSION', type: 'SUPPLY', direction: 'SELL', timeframe: '4H', low: 0.69472, high: 0.69603, status: 'FRESH', first_knowable_ms: 100 }
        ], 200);
        expect(result.entry_inside_opposing_4h).toBe('YES');
        expect(result.barrier_distance_r).toBe(0);
        expect(result.clear_path_to_tp1).toBe('NO');
        expect(result.trade_qualified).toBe(false);
        expect(result.qualification_blockers).toEqual(['ENTRY_INSIDE_OPPOSING_4H']);
        expect(context.isSelectableAdaptiveCandidate({ trade_qualified: result.trade_qualified, score: 90, still_actionable_today: true })).toBe(false);
    });

    test('SELL entry inside opposing 4H demand is blocked symmetrically', () => {
        const result = sell(100, 101, 99, [demand(99.4, 100.2)]);
        expect(result.entry_inside_opposing_4h).toBe('YES');
        expect(result.trade_qualified).toBe(false);
        expect(result.clear_path_to_tp1).toBe('NO');
    });

    test.each([
        [0.20, -15], [0.40, -10], [0.65, -5], [0.85, -2]
    ])('BUY barrier at %sR applies fixed penalty without blocking', (distanceR, penalty) => {
        const result = buy(100, 99, 101, [supply(100 + distanceR, 100 + distanceR + 0.05)]);
        expect(result.entry_inside_opposing_4h).toBe('NO');
        expect(result.barrier_distance_r).toBe(distanceR);
        expect(result.path_quality_penalty).toBe(penalty);
        expect(result.trade_qualified).toBe(true);
        expect(result.clear_path_to_tp1).toBe('NO');
    });

    test('SELL barrier at 0.20R applies the same strong penalty', () => {
        const result = sell(100, 101, 99, [demand(99.75, 99.8)]);
        expect(result.barrier_distance_r).toBe(0.2);
        expect(result.path_quality_penalty).toBe(-15);
        expect(result.trade_qualified).toBe(true);
    });

    test('no opposing 4H barrier has no penalty and a clear path', () => {
        const result = buy(100, 99, 101, [demand(100.1, 100.2)]);
        expect(result.opposing_4h_barrier_before_tp1).toBe('NO');
        expect(result.nearest_opposing_4h_ref).toBe('NONE');
        expect(result.barrier_distance_r).toBeNull();
        expect(result.path_quality_penalty).toBe(0);
        expect(result.clear_path_to_tp1).toBe('YES');
    });

    test('1H opposition alone is not a hard blocker', () => {
        const result = buy(100, 99, 101, [{ ...supply(100.2, 100.3), timeframe: '1H' }]);
        expect(result.trade_qualified).toBe(true);
        expect(result.opposing_4h_barrier_before_tp1).toBe('NO');
    });

    test('Kronos conflict and LOW quality metadata alone are not blockers', () => {
        const result = context.apply4HPathQualityToCandidate({ direction: 'BUY', entry: 100, stop_loss: 99, tp1: 101, score: 70, quality: 'LOW', kronos_alignment: 'CONFLICT' }, [], 200);
        expect(result.trade_qualified).toBe(true);
        expect(result.path_quality_penalty).toBe(0);
        expect(result.score).toBe(70);
    });

    test('canonical structure reference and exact zone are attached', () => {
        const result = buy(100, 99, 101, [supply(100.2, 100.3, { ref: 'SUPPLY:4H:CANONICAL-REF' })]);
        expect(result.nearest_opposing_4h_ref).toBe('SUPPLY:4H:CANONICAL-REF');
        expect(result.nearest_opposing_4h_type).toBe('SUPPLY');
        expect(result.nearest_opposing_4h_zone).toBe('100.2-100.3');
    });

    test('future structure is excluded from the candidate-time audit', () => {
        const result = buy(100, 99, 101, [supply(100.2, 100.3, { first_knowable_ms: 201 })], 200);
        expect(result.opposing_4h_barrier_before_tp1).toBe('NO');
        expect(result.trade_qualified).toBe(true);
    });

    test('identical deterministic input produces identical output', () => {
        const records = [supply(100.65, 100.7)];
        expect(buy(100, 99, 101, records)).toEqual(buy(100, 99, 101, records));
    });
});
