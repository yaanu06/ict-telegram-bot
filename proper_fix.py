import re
with open("script.test.js", "r") as f:
    c = f.read()

# Fix DOM mocks for DOM queries added in recent versions
c = c.replace("getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '' }),", "getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null, classList: { add: () => {}, remove: () => {} }, style: {}, innerHTML: '' }),")
c = c.replace("addEventListener: () => {}", "addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null")

# Fix missing timer mocks
c = c.replace("setTimeout: () => 0,", "setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,")

# Add missing top-level function exports needed by tests that were recently added or renamed
c = c.replace("ema, rsi, atr", "ema, rsi, atr, validateAIResult, getLiveCandleDirection, checkHTFConfluenceAsync, checkZoneMagnetism, findPrecisionEntry, calcVolumeProfile, calcDeltaProxy, checkSniperEntry, getPrecisionEntryCRT, recomputeTradeLevels, getGhostHardRules")

with open("script.test.js", "w") as f:
    f.write(c)
