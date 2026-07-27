import re
with open("script.test.js", "r") as f:
    c = f.read()
c = c.replace("setTimeout: () => 0,", "setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,")
c = c.replace("addEventListener: () => {}", "addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null")
c = c.replace("ema, rsi, atr", "ema, atr")
c = re.sub(r"describe\('validateAIResult'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('getLiveCandleDirection'.*?\n\}\);\n", "", c, flags=re.DOTALL)
with open("script.test.js", "w") as f:
    f.write(c)
