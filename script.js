// Force HIGHER TIMEFRAME priority - 1D > 4H > 1H > 15M > 5M
results.sort((a, b) => {
    const tfPriority = { '1D': 5, '4H': 4, '1H': 3, '15M': 2, '5M': 1 };
    const tfA = tfPriority[a.timeframe] || 0;
    const tfB = tfPriority[b.timeframe] || 0;
    
    // If different timeframes, higher timeframe ALWAYS wins
    if (tfA !== tfB) {
        return tfB - tfA;  // 1D (5) comes before 4H (4), etc.
    }
    
    // Same timeframe - sort by confidence
    return b.confidence - a.confidence;
});

// ADD THIS: Filter to only show highest available timeframe
const highestTFFound = Math.min(...results.map(r => {
    const p = { '1D': 1, '4H': 2, '1H': 3, '15M': 4, '5M': 5 };
    return p[r.timeframe] || 99;
}));

// Only keep results from the highest timeframe that actually has setups
const bestTimeframeResults = results.filter(r => {
    const p = { '1D': 1, '4H': 2, '1H': 3, '15M': 4, '5M': 5 };
    return p[r.timeframe] === highestTFFound;
});

// Use bestTimeframeResults instead of results for the best setup
const best = bestTimeframeResults[0];  // This will be from 1D if available, else 4H, etc.