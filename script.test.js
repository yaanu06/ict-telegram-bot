// Mock global scope BEFORE requiring script.js
global.document = {
    addEventListener: jest.fn(),
    getElementById: jest.fn(() => ({
        addEventListener: jest.fn(),
        classList: { add: jest.fn(), remove: jest.fn() },
        style: {}
    })),
    body: { insertAdjacentHTML: jest.fn() }
};

global.window = {
    Telegram: {
        WebApp: {
            expand: jest.fn(),
            ready: jest.fn()
        }
    }
};

global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn()
};

global.fetch = jest.fn();

// Now require script.js
const { loadLimitOrder, getLimitOrder, setLimitOrder } = require('./script.js');

describe('loadLimitOrder tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        setLimitOrder(null);
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test('should parse valid JSON successfully', () => {
        const validOrder = { signalType: 'BUY', idealEntry: 100, stopLoss: 90 };
        global.localStorage.getItem.mockReturnValue(JSON.stringify(validOrder));

        loadLimitOrder();

        expect(getLimitOrder()).toEqual(validOrder);
    });

    test('should handle missing item gracefully', () => {
        global.localStorage.getItem.mockReturnValue(null);

        loadLimitOrder();

        expect(getLimitOrder()).toBeNull();
    });

    test('should catch invalid JSON gracefully', () => {
        global.localStorage.getItem.mockReturnValue('invalid json string');

        expect(() => loadLimitOrder()).not.toThrow();
        expect(getLimitOrder()).toBeNull();
    });
});
