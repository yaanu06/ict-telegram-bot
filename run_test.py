import re

with open("script.test.js", "r") as f:
    content = f.read()

content = content.replace("context.setInterval = jest.fn();", "")
content = content.replace("context.setTimeout = jest.fn();", "")
content = re.sub(r'const context = \{\n', r'const context = { setInterval: jest.fn(), setTimeout: jest.fn(), clearInterval: jest.fn(), clearTimeout: jest.fn(),\n', content)

with open("script.test.js", "w") as f:
    f.write(content)
