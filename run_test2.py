import re

with open("script.test.js", "r") as f:
    content = f.read()

content = re.sub(r'const context = \{', r'''const context = {
    document: {
        querySelectorAll: jest.fn(() => []),
        getElementById: jest.fn(() => ({
            style: {},
            classList: { add: jest.fn(), remove: jest.fn() },
            innerHTML: '',
            value: '',
            addEventListener: jest.fn()
        })),
        addEventListener: jest.fn()
    },
    fetch: jest.fn(),
    window: {
        Telegram: {
            WebApp: {
                ready: jest.fn(),
                expand: jest.fn(),
                onEvent: jest.fn(),
                themeParams: {}
            }
        },
        localStorage: {
            getItem: jest.fn(),
            setItem: jest.fn()
        }
    },
''', content)

with open("script.test.js", "w") as f:
    f.write(content)
