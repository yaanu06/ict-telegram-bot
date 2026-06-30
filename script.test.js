/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('getTimeframeHierarchy', () => {
    beforeAll(() => {
        // Set up the DOM with minimum required elements for script.js to not throw immediately
        document.body.innerHTML = `
            <div id="symbols-container"></div>
            <div id="setup-modal"></div>
        `;

        // Mock Telegram WebApp
        window.Telegram = {
            WebApp: {
                expand: jest.fn(),
                ready: jest.fn()
            }
        };

        // Load the script
        const scriptContent = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

        // Append it to body so functions become part of window
        const script = document.createElement('script');
        script.textContent = scriptContent;
        document.body.appendChild(script);
    });

    test('should return correct hierarchy for 1D', () => {
        expect(window.getTimeframeHierarchy('1D')).toEqual(['1D', '4H', '1H', '15M']);
    });

    test('should return correct hierarchy for 4H', () => {
        expect(window.getTimeframeHierarchy('4H')).toEqual(['4H', '1H', '15M', '5M']);
    });

    test('should return correct hierarchy for 1H', () => {
        expect(window.getTimeframeHierarchy('1H')).toEqual(['1H', '15M', '5M', '5M']);
    });

    test('should return correct hierarchy for 15M', () => {
        expect(window.getTimeframeHierarchy('15M')).toEqual(['1H', '15M', '5M', '5M']);
    });

    test('should return correct hierarchy for 5M', () => {
        expect(window.getTimeframeHierarchy('5M')).toEqual(['15M', '5M', '5M', '5M']);
    });

    test('should return default hierarchy for unknown input', () => {
        expect(window.getTimeframeHierarchy('UNKNOWN')).toEqual(['4H', '1H', '15M', '5M']);
    });

    test('should return default hierarchy for null', () => {
        expect(window.getTimeframeHierarchy(null)).toEqual(['4H', '1H', '15M', '5M']);
    });

    test('should return default hierarchy for undefined', () => {
        expect(window.getTimeframeHierarchy(undefined)).toEqual(['4H', '1H', '15M', '5M']);
    });
});
