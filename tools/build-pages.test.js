'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPages } = require('./build-pages');

describe('GitHub Pages frontend artifact', () => {
    test('builds an allowlisted base-path-safe artifact with one resolved build ID', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ict-pages-'));
        try {
            const result = buildPages({ outputDir, buildId: 'pages-test-123' });
            expect(result.files.sort()).toEqual(['.nojekyll', 'index.html', 'script.js', 'style.css']);
            expect(fs.readdirSync(outputDir).sort()).toEqual(['.nojekyll', 'index.html', 'script.js', 'style.css']);

            const index = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');
            const script = fs.readFileSync(path.join(outputDir, 'script.js'), 'utf8');
            expect(index).toContain("window.__ICT_PROXY_BASE_URL__ = 'https://ict-telegram-bot-temf.onrender.com'");
            expect(index).toContain("window.__ICT_APP_BUILD_ID__ = 'pages-test-123'");
            expect(index).toContain('script.js?v=pages-test-123');
            expect(index).toContain('href="style.css"');
            expect(index).not.toMatch(/(?:src|href)="\/(?:script\.js|style\.css)/);
            expect(script).toContain('window.__ICT_APP_BUILD_ID__');
            expect(new URL('script.js?v=pages-test-123', 'https://yaanu06.github.io/ict-telegram-bot/').pathname)
                .toBe('/ict-telegram-bot/script.js');
            expect(index).not.toMatch(/__ICT_BUILD_VERSION__/);
            expect(script).not.toMatch(/__ICT_BUILD_VERSION__/);
            expect(script).toContain('CURRENT_SCAN_ARTIFACT_V2');
            expect(script).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
            expect(fs.existsSync(path.join(outputDir, 'server'))).toBe(false);
            expect(fs.existsSync(path.join(outputDir, 'node_modules'))).toBe(false);
        } finally {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
    });

    test('Pages workflow publishes only the generated artifact on main pushes', () => {
        const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
        expect(workflow).toContain('branches: [main]');
        expect(workflow).toContain('FRONTEND_BUILD_ID: ${{ github.sha }}');
        expect(workflow).toContain('path: .pages-artifact');
        expect(workflow).toContain('actions/deploy-pages@v4');
        expect(workflow).toContain('pages: write');
        expect(workflow).toContain('id-token: write');
    });
});
