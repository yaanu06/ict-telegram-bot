const fs = require('fs');
const vm = require('vm');

describe('getSLBufferForTF', () => {
    let context;

    beforeEach(() => {
        const code = fs.readFileSync('script.js', 'utf8');
        context = {
            window: { Telegram: { WebApp: { expand: () => {}, ready: () => {} } } },
            document: {
                addEventListener: () => {},
                getElementById: () => ({ addEventListener: () => {}, className: '', innerHTML: '' }),
                querySelectorAll: () => ({ forEach: () => {} })
            },
            localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
            console: console,
            fetch: jest.fn(),
            Math: Math,
            Date: Date,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            setInterval: setInterval,
            clearInterval: clearInterval
        };
        vm.createContext(context);
        vm.runInContext(code, context);
    });

    test('should return tfBuffer if it is greater than apiATR * 0.3', () => {
        vm.runInContext("pair = 'EUR/USD'", context);
        const result = context.getSLBufferForTF(0.0010, '1H');
        expect(result).toBe(0.0008);
    });

    test('should return apiATR * 0.3 if it is greater than tfBuffer', () => {
        vm.runInContext("pair = 'EUR/USD'", context);
        const result = context.getSLBufferForTF(0.0050, '15M');
        expect(result).toBe(0.0015);
    });

    test('should fall back to 15M buffer if tfUsed is not found', () => {
        vm.runInContext("pair = 'EUR/USD'", context);
        const result = context.getSLBufferForTF(0.0001, '3M');
        expect(result).toBe(0.0005);
    });

    test('should use global pair if currentPair is not provided', () => {
        vm.runInContext("pair = 'BTC/USD'", context);
        const result = context.getSLBufferForTF(10, '1H');
        expect(result).toBe(80);
    });

    test('should use currentPair even if global pair is set', () => {
        vm.runInContext("pair = 'BTC/USD'", context);
        const result = context.getSLBufferForTF(0.1, '1H', 'XAU/USD');
        expect(result).toBe(5);
    });
});
