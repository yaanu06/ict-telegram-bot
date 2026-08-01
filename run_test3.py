with open("script.test.js", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "let exported = {};" in line and "vm.runInContext" in line:
        lines[i] = "    let exported = {}; try { exported = vm.runInContext(code + '\\n;({ ema, atr, rsi, validateAIResult, getLiveCandleDirection, checkSniperEntry, calcDeltaProxy, calcVolumeProfile, findPrecisionEntry, getQuoteDirection, calculateMSNR, checkZoneMagnetism, checkHTFConfluenceAsync, getGhostHardRules, recomputeTradeLevels });', context); } catch (e) { try { exported = vm.runInContext(code + '\\n;({ ema, atr });', context); } catch(ex){} }\n"
        # delete the multi line ones
        break

with open("script.test.js", "w") as f:
    f.writelines(lines)
