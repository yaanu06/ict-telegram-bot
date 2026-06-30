const { performance } = require('perf_hooks');

function isHTFPremiumDiscountOld(htfData, direction) {
    if (!htfData || htfData.length < 10) return { inPremiumDiscount: false, value: 'neutral', pct: 0 };
    const range = Math.max(...htfData.map(c => c.h)) - Math.min(...htfData.map(c => c.l)), current = htfData[htfData.length - 1].c, low = Math.min(...htfData.map(c => c.l)), mid = range / 2 + low;
    if (direction === 'BUY') { const inDiscount = current < mid, discountPct = ((mid - current) / range * 100); return { inPremiumDiscount: inDiscount, value: 'discount', pct: Math.max(0, discountPct) }; }
    else { const inPremium = current > mid, premiumPct = ((current - mid) / range * 100); return { inPremiumDiscount: inPremium, value: 'premium', pct: Math.max(0, premiumPct) }; }
}

function isHTFPremiumDiscountNew(htfData, direction) {
    if (!htfData || htfData.length < 10) return { inPremiumDiscount: false, value: 'neutral', pct: 0 };

    let high = -Infinity;
    let low = Infinity;
    for (let i = 0; i < htfData.length; i++) {
        if (htfData[i].h > high) high = htfData[i].h;
        if (htfData[i].l < low) low = htfData[i].l;
    }

    const range = high - low;
    const current = htfData[htfData.length - 1].c;
    const mid = range / 2 + low;

    if (direction === 'BUY') {
        const inDiscount = current < mid;
        const discountPct = ((mid - current) / range * 100);
        return { inPremiumDiscount: inDiscount, value: 'discount', pct: Math.max(0, discountPct) };
    } else {
        const inPremium = current > mid;
        const premiumPct = ((current - mid) / range * 100);
        return { inPremiumDiscount: inPremium, value: 'premium', pct: Math.max(0, premiumPct) };
    }
}

const data = [];
for (let i = 0; i < 1000; i++) {
    data.push({ h: Math.random() * 100 + 100, l: Math.random() * 100, c: Math.random() * 100 + 50 });
}

function runBenchmark(fn, name) {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
        fn(data, 'BUY');
        fn(data, 'SELL');
    }
    const end = performance.now();
    console.log(`${name}: ${end - start} ms`);
}

// Warm up
runBenchmark(isHTFPremiumDiscountOld, "Old (warmup)");
runBenchmark(isHTFPremiumDiscountNew, "New (warmup)");

runBenchmark(isHTFPremiumDiscountOld, "Old");
runBenchmark(isHTFPremiumDiscountNew, "New");
