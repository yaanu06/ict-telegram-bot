import re

with open("script.test.js", "r") as f:
    content = f.read()

replacement = """const getContext = (overrides = {}) => {
    const context = {
        window: { Telegram: { WebApp: null } },
        document: {
            getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '', value: '' }),
            querySelectorAll: () => [],
            addEventListener: () => {}
        },
        console: { log: () => {}, error: () => {} },
        fetch: jest.fn(),
        setInterval: jest.fn(),
        clearInterval: jest.fn(),
        setTimeout: jest.fn(),
        clearTimeout: jest.fn(),
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        ...overrides
    };
    vm.createContext(context);
    let exported = {};
    try {
        exported = vm.runInContext(code + "\\n;({ ema, atr, rsi, validateAIResult, getLiveCandleDirection, checkSniperEntry, calcDeltaProxy, calcVolumeProfile, findPrecisionEntry, getQuoteDirection, calculateMSNR, checkZoneMagnetism, checkHTFConfluenceAsync, getGhostHardRules, recomputeTradeLevels });", context);
    } catch (e) {
        try {
            exported = vm.runInContext(code + "\\n;({ ema, atr });", context);
        } catch(ex){}
    }
    Object.assign(context, exported);
    return context;
};"""

content = re.sub(r'const getContext = \(overrides = \{\}\) => \{.*?return context;\n\};', replacement, content, flags=re.DOTALL)

with open("script.test.js", "w") as f:
    f.write(content)
