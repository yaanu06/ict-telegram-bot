const fs = require('fs');

describe('loadKeys', () => {
    let scriptVars;

    beforeAll(() => {
        const scriptContent = fs.readFileSync('./script.js', 'utf8');
        document.body.innerHTML = `
            <div id="twelveStatus"></div>
            <div id="deepseekStatus"></div>
            <button id="updateKeysBtn"></button>
            <div id="liveTime"></div>
            <select id="pairSelect"></select>
            <button id="analyzeBtn"></button>
            <button id="executeBtn"></button>
            <button id="cancelLimitBtn"></button>
            <button id="copyJsonBtn"></button>
        `;
        window.Telegram = { WebApp: { expand: jest.fn(), ready: jest.fn() } };

        scriptVars = eval(scriptContent + `
        ({
            loadKeys: loadKeys,
            getTwelveDataKey: () => TWELVE_DATA_KEY,
            getDeepseekApiKey: () => DEEPSEEK_API_KEY,
            setKeys: (tk, dk) => { TWELVE_DATA_KEY = tk; DEEPSEEK_API_KEY = dk; }
        })
        `);
    });

    beforeEach(() => {
        localStorage.clear();
        scriptVars.setKeys('', '');
    });

    test('should return true and set keys for valid JSON', async () => {
        localStorage.setItem('ict_bot_keys', JSON.stringify({ twelveData: 'test_twelve', deepseek: 'test_deepseek' }));
        const result = await scriptVars.loadKeys();
        expect(result).toBe(true);
        expect(scriptVars.getTwelveDataKey()).toBe('test_twelve');
        expect(scriptVars.getDeepseekApiKey()).toBe('test_deepseek');
    });

    test('should return false when localStorage is empty', async () => {
        const result = await scriptVars.loadKeys();
        expect(result).toBe(false);
    });

    test('should return false for invalid JSON in localStorage', async () => {
        localStorage.setItem('ict_bot_keys', '{invalid_json}');
        const result = await scriptVars.loadKeys();
        expect(result).toBe(false);
        expect(scriptVars.getTwelveDataKey()).toBe('');
        expect(scriptVars.getDeepseekApiKey()).toBe('');
    });
});
