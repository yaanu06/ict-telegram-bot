#!/usr/bin/env node
// Backtest harness: replays the bot's own signal logic (loaded straight from
// script.js, not reimplemented) over historical Twelve Data candles and
// reports win rate, profit factor, expectancy and drawdown.
//
// Usage:
//   TWELVE_DATA_KEY=xxx node backtest.js --pair XAU/USD --tf 1H
//   node backtest.js --pair EUR/USD --tf 4H --key xxx --bars 5000 --rr 2
//   node backtest.js --file candles.json --pair XAU/USD --tf 1H
//
// Options:
//   --pair       Trading pair (default XAU/USD)
//   --tf         Timeframe: 5M 15M 1H 4H 1D (default 1H)
//   --key        Twelve Data API key (or TWELVE_DATA_KEY env var)
//   --bars       Candles to fetch, max 5000 (default 5000)
//   --rr         Override target R:R for TP1 (default: bot's setting, 4)
//   --conf       Minimum signal confidence to take a trade (default 60)
//   --quality    Minimum zone quality: A, B or C (default C = take all)
//   --expiry     Bars before an unfilled limit order expires (default 50)
//   --sniper     Only take trades passing the sniper gate (sweep -> displaced
//                MSS -> fresh zone); without it, all trades are taken and the
//                report breaks results down by sniper vs normal
//   --file       Read candles from a JSON file instead of the API
//                (array of {t,o,h,l,c,v}, oldest first)

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---------- load the production logic from script.js ----------
function loadBot(pairName) {
    const code = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
    const noop = () => {};
    const el = { addEventListener: noop, classList: { add: noop, remove: noop }, style: {}, innerHTML: '' };
    const context = {
        window: { Telegram: { WebApp: null } },
        document: { getElementById: () => el, addEventListener: noop, querySelectorAll: () => [], body: { insertAdjacentHTML: noop } },
        console: { log: noop, error: noop },
        fetch: async () => { throw new Error('no network in backtest'); },
        localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
        setInterval: () => 0, clearInterval: noop, setTimeout: () => 0, clearTimeout: noop,
        AbortController: function () { this.signal = null; this.abort = noop; },
        Date, Math, JSON,
    };
    vm.createContext(context);
    // Top-level const/let (ema, rsi, atr, pair) live in the script's lexical
    // scope, so export what we need from the same script run.
    const bot = vm.runInContext(
        code + '\n;pair = ' + JSON.stringify(pairName) + ';({ ema, rsi, atr, score, calculateMSNR, findPrecisionEntry, calcStopLoss, calcTakeProfits, getMarketSettings, checkZoneFreshness, detectTrend, checkSniperEntry, calcVolumeProfile, calcDeltaProxy });',
        context
    );
    return bot;
}

// ---------- data ----------
async function fetchCandles(pairName, tf, apiKey, bars) {
    const TF_MAP = { '5M': '5min', '15M': '15min', '1H': '1h', '4H': '4h', '1D': '1day' };
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pairName)}&interval=${TF_MAP[tf]}&outputsize=${bars}&apikey=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.code && d.code !== 200) throw new Error(`Twelve Data: ${d.message || d.code}`);
    if (!d.values) throw new Error('Twelve Data returned no values');
    return d.values.map(c => ({ t: c.datetime, o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: +c.volume || 1e6 })).reverse();
}

// ---------- simulation ----------
function runBacktest(bot, candles, opts) {
    const LOOKBACK = 100;
    const trades = [];
    let open = null; // { dir, entry, sl, tp1, signalBar, conf, quality, filledBar }
    let pending = null;

    for (let i = LOOKBACK; i < candles.length; i++) {
        const bar = candles[i];

        // 1. manage pending limit order
        if (pending) {
            const filled = pending.dir === 'BUY' ? bar.l <= pending.entry : bar.h >= pending.entry;
            if (filled) { open = { ...pending, filledBar: i }; pending = null; }
            else if (i - pending.signalBar >= opts.expiry) { trades.push({ ...pending, outcome: 'EXPIRED', r: 0 }); pending = null; }
        }

        // 2. manage open position (conservative: SL checked before TP on the same bar)
        if (open) {
            const hitSL = open.dir === 'BUY' ? bar.l <= open.sl : bar.h >= open.sl;
            const hitTP = open.dir === 'BUY' ? bar.h >= open.tp1 : bar.l <= open.tp1;
            if (hitSL) { trades.push({ ...open, outcome: 'LOSS', r: -1, exitBar: i }); open = null; }
            else if (hitTP) { trades.push({ ...open, outcome: 'WIN', r: open.rr, exitBar: i }); open = null; }
            continue; // one position at a time, no new signals while in a trade
        }
        if (pending) continue;

        // 3. look for a new signal on this closed bar
        const window = candles.slice(i - LOOKBACK, i + 1);
        const price = bar.c;
        let sig;
        try { sig = bot.score(window, price, {}); } catch (e) { continue; }
        if (sig.conf < opts.conf) continue;

        let msnr, zone, slRes, tps;
        try {
            msnr = bot.calculateMSNR(window, price);
            zone = bot.findPrecisionEntry(window, price, sig.dir, msnr);
            const entry = zone.p;
            // skip zones on the wrong side of price (limit order would fill instantly at worse price)
            // and zones closer than 0.2 ATR (a market order in disguise) - mirrors the app
            const dist = sig.dir === 'BUY' ? price - entry : entry - price;
            if (dist <= 0 || dist < bot.atr(window, 14) * 0.2) continue;
            slRes = bot.calcStopLoss(window, sig.dir, entry, zone, msnr, opts.tf, null, opts.pair);
            tps = bot.calcTakeProfits(sig.dir, entry, slRes.price);
        } catch (e) { continue; }

        const qualityRank = { A: 3, B: 2, C: 1 };
        if (qualityRank[zone.quality] < qualityRank[opts.quality]) continue;

        // sniper gate: killzone derived from the candle's own timestamp, not wall-clock
        const utcHour = new Date(bar.t).getUTCHours();
        const session = { isKillzone: (utcHour >= 7 && utcHour < 10) || (utcHour >= 12 && utcHour < 15) };
        let sniperRes = { isSniper: false, score: 0 };
        try { sniperRes = bot.checkSniperEntry(window, price, sig.dir, zone, session); } catch (e) {}
        if (opts.sniper && !sniperRes.isSniper) continue;

        const entry = zone.p;
        const risk = Math.abs(entry - slRes.price);
        if (risk <= 0) continue;
        const rr = opts.rr || Math.abs(tps.tp1 - entry) / risk;
        const tp1 = opts.rr ? (sig.dir === 'BUY' ? entry + risk * opts.rr : entry - risk * opts.rr) : tps.tp1;

        pending = { dir: sig.dir, entry, sl: slRes.price, tp1, rr, signalBar: i, conf: sig.conf, quality: zone.quality, src: zone.src, sniper: sniperRes.isSniper ? 'SNIPER' : 'normal' };
    }
    if (open) trades.push({ ...open, outcome: 'OPEN_AT_END', r: 0 });
    if (pending) trades.push({ ...pending, outcome: 'EXPIRED', r: 0 });
    return trades;
}

// ---------- reporting ----------
function report(trades, opts, candles) {
    const closed = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');
    const wins = closed.filter(t => t.outcome === 'WIN');
    const losses = closed.filter(t => t.outcome === 'LOSS');
    const expired = trades.filter(t => t.outcome === 'EXPIRED');

    const grossWin = wins.reduce((a, t) => a + t.r, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.r, 0));
    const netR = grossWin - grossLoss;

    // equity curve in R + max drawdown + max consecutive losses
    let eq = 0, peak = 0, maxDD = 0, streak = 0, worstStreak = 0;
    for (const t of closed) {
        eq += t.r;
        peak = Math.max(peak, eq);
        maxDD = Math.max(maxDD, peak - eq);
        streak = t.outcome === 'LOSS' ? streak + 1 : 0;
        worstStreak = Math.max(worstStreak, streak);
    }

    const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : 'n/a';
    const first = candles[0].t, last = candles[candles.length - 1].t;

    console.log(`\n=== Backtest: ${opts.pair} ${opts.tf} | ${candles.length} bars (${first} -> ${last}) ===`);
    console.log(`Filters: conf>=${opts.conf}, quality>=${opts.quality}, TP1 R:R=${opts.rr || 'bot default'}, expiry=${opts.expiry} bars\n`);
    console.log(`Signals taken:      ${trades.length}`);
    console.log(`  Filled & closed:  ${closed.length}`);
    console.log(`  Expired unfilled: ${expired.length}`);
    console.log(`Wins / Losses:      ${wins.length} / ${losses.length}  (win rate ${pct(wins.length, closed.length)})`);
    console.log(`Net result:         ${netR.toFixed(1)}R`);
    console.log(`Profit factor:      ${grossLoss ? (grossWin / grossLoss).toFixed(2) : 'inf'}`);
    console.log(`Expectancy:         ${closed.length ? (netR / closed.length).toFixed(2) : 'n/a'}R per trade`);
    console.log(`Max drawdown:       ${maxDD.toFixed(1)}R`);
    console.log(`Worst loss streak:  ${worstStreak}`);

    for (const key of ['quality', 'dir', 'src', 'sniper']) {
        const groups = {};
        for (const t of closed) (groups[t[key]] ||= []).push(t);
        const lines = Object.entries(groups).map(([k, g]) => {
            const w = g.filter(t => t.outcome === 'WIN').length;
            const net = g.reduce((a, t) => a + t.r, 0);
            return `  ${k.padEnd(8)} trades=${String(g.length).padEnd(4)} winrate=${pct(w, g.length).padEnd(6)} net=${net.toFixed(1)}R`;
        });
        if (lines.length > 1) console.log(`\nBy ${key}:\n` + lines.join('\n'));
    }

    // confidence buckets
    const buckets = {};
    for (const t of closed) {
        const b = t.conf >= 80 ? '80+' : t.conf >= 70 ? '70-79' : '60-69';
        (buckets[b] ||= []).push(t);
    }
    if (Object.keys(buckets).length > 1) {
        console.log('\nBy confidence:');
        for (const [b, g] of Object.entries(buckets).sort()) {
            const w = g.filter(t => t.outcome === 'WIN').length;
            console.log(`  ${b.padEnd(8)} trades=${String(g.length).padEnd(4)} winrate=${pct(w, g.length).padEnd(6)} net=${g.reduce((a, t) => a + t.r, 0).toFixed(1)}R`);
        }
    }
    console.log('');
}

// ---------- main ----------
async function main() {
    const args = process.argv.slice(2);
    const get = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
    const opts = {
        pair: get('pair', 'XAU/USD'),
        tf: get('tf', '1H'),
        bars: +get('bars', 5000),
        rr: get('rr', null) ? +get('rr') : null,
        conf: +get('conf', 60),
        quality: get('quality', 'C').toUpperCase(),
        expiry: +get('expiry', 50),
        file: get('file', null),
        sniper: args.includes('--sniper'),
    };
    const apiKey = get('key', process.env.TWELVE_DATA_KEY);

    let candles;
    if (opts.file) {
        candles = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
    } else {
        if (!apiKey) { console.error('Provide --key or set TWELVE_DATA_KEY (or use --file candles.json)'); process.exit(1); }
        console.log(`Fetching ${opts.bars} ${opts.tf} candles for ${opts.pair}...`);
        candles = await fetchCandles(opts.pair, opts.tf, apiKey, opts.bars);
    }
    if (!candles || candles.length < 200) { console.error(`Not enough candles (${candles?.length || 0}); need at least 200.`); process.exit(1); }

    const bot = loadBot(opts.pair);
    const trades = runBacktest(bot, candles, opts);
    report(trades, opts, candles);
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });
