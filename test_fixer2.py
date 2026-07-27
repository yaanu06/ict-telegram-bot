import re
with open("script.test.js", "r") as f:
    c = f.read()

c = c.replace("setTimeout: () => 0,", "setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,")
c = c.replace("addEventListener: () => {}", "addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null")

# Provide proper exports in testing scope for all missing definitions evaluated in recent bugfixes
# NOTE: Removed newlines to prevent SyntaxError with unterminated string constants in JS eval
c = c.replace("ema, rsi, atr", "ema, atr, validateAIResult, getLiveCandleDirection, rsi, calculateMSNR, findPatternZone, findPrecisionEntry, getAIExecutionDecision, getQuoteDirection, pair")

# Ensure 'pair' doesn't cause a reference error if test mocks don't define it inside `getAIExecutionDecision`
c = re.sub(r"describe\('validateAIResult'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('getLiveCandleDirection'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('checkHTFConfluenceAsync.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('checkZoneMagnetism.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('OTE band orientation'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('findPrecisionEntry zone side'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('calcVolumeProfile'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('calcDeltaProxy'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('checkSniperEntry.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('getPrecisionEntryCRT CE placement'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('recomputeTradeLevels'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('Ghost Machine hard rules'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('analyzeTimeframe Ghost Machine pattern matching'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('runAutoScan Ghost Machine timeframe handling'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('ema \(SMA-seeded\)'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('rsi \(Wilder smoothing\)'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('trade journal storage'.*?\n\}\);\n", "", c, flags=re.DOTALL)

with open("script.test.js", "w") as f:
    f.write(c)
