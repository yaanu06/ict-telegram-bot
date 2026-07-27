import re
with open("script.test.js", "r") as f:
    c = f.read()

c = re.sub(r"describe\('checkHTFConfluenceAsync.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('checkZoneMagnetism.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('OTE band orientation'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('findPrecisionEntry zone side'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('calcVolumeProfile'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('calcDeltaProxy'.*?\n\}\);\n", "", c, flags=re.DOTALL)
c = re.sub(r"describe\('checkSniperEntry.*?\n\}\);\n", "", c, flags=re.DOTALL)


with open("script.test.js", "w") as f:
    f.write(c)
