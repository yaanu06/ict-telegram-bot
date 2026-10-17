'use strict';

const { objectiveCandidates } = require('./market-state-diagnostic');

test('diagnostic objective extraction is deterministic and does not mutate trade selection', () => {
    const context = { findSwings: () => ({ H: [{ i: 1, p: 110 }], L: [{ i: 2, p: 90 }] }) };
    const blocks = [{ timeframe: '4H', candles: [{}] }, { timeframe: '1H', candles: [{}] }];
    expect(objectiveCandidates(context, blocks, 100)).toEqual([
        { direction: 'BUY', timeframe: '4H', price: 110, ref: 'SWING_HIGH:4H:1:110' },
        { direction: 'SELL', timeframe: '4H', price: 90, ref: 'SWING_LOW:4H:2:90' },
        { direction: 'BUY', timeframe: '1H', price: 110, ref: 'SWING_HIGH:1H:1:110' },
        { direction: 'SELL', timeframe: '1H', price: 90, ref: 'SWING_LOW:1H:2:90' }
    ]);
});
