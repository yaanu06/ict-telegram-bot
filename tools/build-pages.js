'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(REPOSITORY_ROOT, '.pages-artifact');
const FRONTEND_FILES = ['index.html', 'script.js', 'style.css'];
const BUILD_TOKEN = '__ICT_BUILD_VERSION__';

function validateBuildId(value) {
    const buildId = String(value || '').trim();
    if (!buildId || !/^[A-Za-z0-9._-]+$/.test(buildId) || buildId.includes(BUILD_TOKEN)) {
        throw new Error('FRONTEND_BUILD_ID must be a non-empty URL-safe build identifier');
    }
    return buildId;
}

function buildPages({ outputDir = DEFAULT_OUTPUT_DIR, buildId = process.env.FRONTEND_BUILD_ID || 'development' } = {}) {
    const resolvedOutput = path.resolve(outputDir);
    if (resolvedOutput === REPOSITORY_ROOT || resolvedOutput === path.dirname(REPOSITORY_ROOT)) {
        throw new Error('Pages output directory must be dedicated and outside the repository source root');
    }
    const resolvedBuildId = validateBuildId(buildId);
    fs.rmSync(resolvedOutput, { recursive: true, force: true });
    fs.mkdirSync(resolvedOutput, { recursive: true });

    for (const file of FRONTEND_FILES) {
        const sourcePath = path.join(REPOSITORY_ROOT, file);
        if (!fs.existsSync(sourcePath)) throw new Error(`Required frontend file is missing: ${file}`);
        const destinationPath = path.join(resolvedOutput, file);
        let content = fs.readFileSync(sourcePath, 'utf8');
        if (file === 'index.html') content = content.split(BUILD_TOKEN).join(resolvedBuildId);
        fs.writeFileSync(destinationPath, content, 'utf8');
    }

    fs.writeFileSync(path.join(resolvedOutput, '.nojekyll'), '', 'utf8');
    const index = fs.readFileSync(path.join(resolvedOutput, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(resolvedOutput, 'script.js'), 'utf8');
    if (index.includes(BUILD_TOKEN) || !index.includes(`script.js?v=${resolvedBuildId}`)) {
        throw new Error('Pages index.html does not contain the resolved script build version');
    }
    if (!index.includes(`window.__ICT_APP_BUILD_ID__ = '${resolvedBuildId}'`)) {
        throw new Error('Pages index.html does not expose the resolved build ID');
    }
    if (!script.includes('window.__ICT_APP_BUILD_ID__')) {
        throw new Error('Pages script.js does not expose the runtime build ID');
    }
    return { outputDir: resolvedOutput, buildId: resolvedBuildId, files: [...FRONTEND_FILES, '.nojekyll'] };
}

if (require.main === module) {
    const result = buildPages();
    console.log(`GitHub Pages artifact ready: ${result.outputDir} (${result.buildId})`);
}

module.exports = { BUILD_TOKEN, FRONTEND_FILES, buildPages, validateBuildId };
