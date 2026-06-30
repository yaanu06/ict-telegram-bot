const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const domMock = {
    window: { Telegram: { WebApp: null } },
    document: {
        getElementById: () => ({ addEventListener: () => {}, innerHTML: '', style: {}, classList: { add: () => {}, remove: () => {} } }),
        body: { insertAdjacentHTML: () => {} },
        createElement: () => ({}),
        addEventListener: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    setInterval: () => {},
    clearInterval: () => {},
    setTimeout: () => {},
    fetch: () => Promise.resolve(),
    console: console,
    Audio: class {}
};

const code = fs.readFileSync('./script.js', 'utf8');

const context = vm.createContext(domMock);
vm.runInContext(code, context);

const detectTrend = context.detectTrend;

console.log("Running detectTrend tests...");
let passed = 0;
let total = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ ${name}`);
        console.error(e.message);
    }
}

runTest('BULLISH trend when 20 EMA > 50 EMA', () => {
    let data = [];
    for (let i = 0; i < 100; i++) data.push({ c: i });
    assert.strictEqual(detectTrend(data), 'BULLISH');
});

runTest('BEARISH trend when 20 EMA < 50 EMA', () => {
    let data = [];
    for (let i = 0; i < 100; i++) data.push({ c: 100 - i });
    assert.strictEqual(detectTrend(data), 'BEARISH');
});

runTest('NEUTRAL trend when 20 EMA == 50 EMA', () => {
    let data = [];
    for (let i = 0; i < 100; i++) data.push({ c: 50 });
    assert.strictEqual(detectTrend(data), 'NEUTRAL');
});

console.log(`\nTests: ${passed}/${total} passed.`);
if (passed !== total) process.exit(1);
