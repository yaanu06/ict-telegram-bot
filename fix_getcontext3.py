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
        exported = vm.runInContext(code + '\\n;({ ema: typeof ema !== "undefined" ? ema : undefined, atr: typeof atr !== "undefined" ? atr : undefined, rsi: typeof rsi !== "undefined" ? rsi : undefined, validateAIResult: typeof validateAIResult !== "undefined" ? validateAIResult : undefined, getLiveCandleDirection: typeof getLiveCandleDirection !== "undefined" ? getLiveCandleDirection : undefined, checkSniperEntry: typeof checkSniperEntry !== "undefined" ? checkSniperEntry : undefined, calcDeltaProxy: typeof calcDeltaProxy !== "undefined" ? calcDeltaProxy : undefined, calcVolumeProfile: typeof calcVolumeProfile !== "undefined" ? calcVolumeProfile : undefined, findPrecisionEntry: typeof findPrecisionEntry !== "undefined" ? findPrecisionEntry : undefined, getQuoteDirection: typeof getQuoteDirection !== "undefined" ? getQuoteDirection : undefined, calculateMSNR: typeof calculateMSNR !== "undefined" ? calculateMSNR : undefined, checkZoneMagnetism: typeof checkZoneMagnetism !== "undefined" ? checkZoneMagnetism : undefined, checkHTFConfluenceAsync: typeof checkHTFConfluenceAsync !== "undefined" ? checkHTFConfluenceAsync : undefined, getGhostHardRules: typeof getGhostHardRules !== "undefined" ? getGhostHardRules : undefined, recomputeTradeLevels: typeof recomputeTradeLevels !== "undefined" ? recomputeTradeLevels : undefined });', context);
    } catch (e) {
        try {
            exported = vm.runInContext(code + '\\n;({ ema: typeof ema !== "undefined" ? ema : undefined, atr: typeof atr !== "undefined" ? atr : undefined });', context);
        } catch(ex){}
    }
    Object.assign(context, exported);
    return context;
};"""

content = re.sub(r'const getContext = \(overrides = \{\}\) => \{.*?\n\};', replacement, content, flags=re.DOTALL)

with open("script.test.js", "w") as f:
    f.write(content)
