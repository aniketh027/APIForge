// Clean checkout: npm ci && npx playwright install chromium
// Or set APIFORGE_BROWSER_EXECUTABLE to a local Chromium/Chrome executable.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const app = require('../server');
const SIMPLE = 'ENTITY Single\nvalue STRING REQUIRED'; // Real implicit-key warning; one declared field.
const LABELS = { mysql: 'MySQL', postgres: 'PostgreSQL' };

// Independent response oracle. Do not call the production helper or infer CRUD counts.
function expectedMetrics(data, target) {
    const spec = JSON.parse(data.generatedFiles.find(file => file.path === 'swagger.json').content);
    let endpoints = 0;
    for (const [route, item] of Object.entries(spec.paths || {})) {
        if (!route.startsWith('/') || !item || typeof item !== 'object' || Array.isArray(item)) continue;
        for (const [method, operation] of Object.entries(item)) {
            if (/^(get|post|put|patch|delete|options|head|trace)$/.test(method)
                && operation && typeof operation === 'object' && !Array.isArray(operation)) endpoints++;
        }
    }
    return {
        entities: data.ast.entities.length,
        fields: data.ast.entities.reduce((total, entity) => total + entity.fields.length, 0),
        relationships: data.ast.relations.length,
        endpoints,
        files: data.generatedFiles.length,
        target: LABELS[target],
        optimizations: data.optimizations.length
    };
}

// Retain the existing isolated-summary harness boundary, with no new globals.
function assertIsolatedSummary() {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
    const context = vm.createContext({
        summaryPanel: { classList: { add() {} } }, summaryContent: { innerHTML: '' },
        escapeHtml: String, formatPhaseName: String,
        editor: { value: '' }, APIForgeSourceFrame: { sourceFrame: () => [] }
    });
    vm.runInContext(source.slice(source.indexOf('function renderSummary('), source.indexOf('function hideSummary(')), context);
    for (const data of [undefined, null, {}, { ast: {}, generatedFiles: {} },
        { ast: { entities: [null, { fields: {} }], relations: null } },
        { generatedFiles: [null, { path: 'swagger.json', content: '{broken' }] }]) {
        context.renderSummary(data);
        assert.match(context.summaryContent.innerHTML, /Compiled successfully/);
        assert.match(context.summaryContent.innerHTML, /Unavailable/);
    }
    context.renderSummary({ symbolTable: { Only: { fields: { value: {} } } } });
    assert.match(context.summaryContent.innerHTML, />1<\/span> <span class="summary-label">entity/);
    assert.match(context.summaryContent.innerHTML, />1<\/span> <span class="summary-label">field/);
    console.log('PASS: isolated summary has no new globals; partial AST, file arrays and symbol fallbacks are safe');
}

async function main() {
    assertIsolatedSummary();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    let releaseResponse;
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const summary = page.locator('#compilation-summary');
        const content = page.locator('#compilation-summary-content');
        const editor = page.getByRole('textbox', { name: 'APIForge DSL source' });
        const compile = page.locator('#compile-btn');
        const demo = page.getByRole('button', { name: 'Load demo', exact: true });
        const example = page.getByRole('button', { name: 'Load example', exact: true });
        const clear = page.getByRole('button', { name: 'Clear', exact: true });
        const target = name => page.getByRole('button', { name: LABELS[name], exact: true });
        const metric = name => content.locator(`[data-summary-metric="${name}"]`);
        const normalized = locator => locator.textContent().then(text => text.trim().replace(/\s+/g, ' '));
        async function assertHidden() {
            assert.equal(await summary.isVisible(), false);
            assert.equal(await content.textContent(), '', 'Invalidated summary has no stale live-region text');
            assert.equal(await page.locator('#download-btn').isVisible(), false);
        }
        async function compileSource(selected) {
            const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await compile.click();
            const response = await responsePromise;
            assert.deepEqual(response.request().postDataJSON(), { source: await editor.inputValue(), target: selected });
            assert.equal(response.status(), 200);
            const data = await response.json();
            assert.equal(data.success, true);
            await summary.waitFor({ state: 'visible' });
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            return data;
        }
        async function assertMetrics(data, selected) {
            const expected = expectedMetrics(data, selected);
            const wording = { entities: ['entity', 'entities'], fields: ['field', 'fields'],
                relationships: ['relationship', 'relationships'], endpoints: ['endpoint', 'endpoints'],
                files: ['generated file', 'generated files'], optimizations: ['optimization', 'optimizations'] };
            assert.equal(await content.locator('.summary-grid > .summary-item').count(), 6);
            for (const [name, words] of Object.entries(wording)) {
                assert.equal(await normalized(metric(name)), `${expected[name]} ${words[expected[name] === 1 ? 0 : 1]}`, name);
            }
            assert.equal(await normalized(metric('target')), `${expected.target} target`);
            assert.equal(await content.getAttribute('role'), 'status');
            assert.equal(await content.getAttribute('aria-live'), 'polite');
            assert.equal(await content.locator('.summary-icon').getAttribute('aria-hidden'), 'true');
            await page.locator('#tab-endpoints').click();
            assert.equal(await page.locator('#output-endpoints .endpoint-row').count(), expected.endpoints);
            assert.equal(await page.locator('#output-endpoints .endpoint-count').textContent(),
                `${expected.endpoints} generated ${expected.endpoints === 1 ? 'endpoint' : 'endpoints'}`);
            return expected;
        }
        async function assertWarnings(data) {
            assert.ok(data.warnings.length > 0, 'Current compiler produces a real warning');
            assert.equal(await normalized(metric('warnings')), `${data.warnings.length} ${data.warnings.length === 1 ? 'warning' : 'warnings'}`);
            assert.equal(await content.getByRole('region', { name: 'Compiler warnings' }).count(), 1);
            assert.equal(await content.locator('.warning-item').count(), data.warnings.length);
            for (const [index, warning] of data.warnings.entries()) {
                const item = content.locator('.warning-item').nth(index);
                assert.equal(await item.locator('.warning-code').textContent(), warning.code);
                assert.equal(await item.locator('.warning-message').textContent(), warning.message);
                assert.equal(await item.locator('.warning-hint').textContent(), `Hint: ${warning.hint}`);
                assert.ok((await item.locator('.warning-excerpt').textContent()).includes('ENTITY Single'));
            }
        }
        async function assertLayout(width) {
            await summary.scrollIntoViewIfNeeded();
            assert.ok(await content.evaluate(element => Math.abs(element.getBoundingClientRect().height - element.querySelector('.summary-body').getBoundingClientRect().height) < 2), 'Summary has no extra vertical space');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
            assert.ok(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
            for (const tile of await content.locator('.summary-grid > .summary-item').all()) {
                assert.ok(await tile.evaluate(element => {
                    const box = element.getBoundingClientRect();
                    const parent = element.closest('.compilation-summary').getBoundingClientRect();
                    return box.left >= parent.left && box.right <= parent.right && element.scrollWidth <= element.clientWidth + 1;
                }), `${width}px metric is contained`);
                for (const child of ['.summary-value', '.summary-label']) {
                    assert.ok(await tile.locator(child).evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 12));
                }
            }
            for (const warning of await content.locator('.warning-item').all()) {
                assert.ok(await warning.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
            }
            const download = page.getByRole('button', { name: 'Download generated project', exact: true });
            await download.scrollIntoViewIfNeeded();
            assert.equal(await download.isVisible(), true);
            assert.equal(await download.isEnabled(), true);
            assert.ok(await download.evaluate(element => {
                const box = element.getBoundingClientRect();
                return box.left >= 0 && box.right <= document.documentElement.clientWidth && box.height >= 30;
            }));
            await download.focus();
            assert.ok(await download.evaluate(element => document.activeElement === element));
            if (process.env.APIFORGE_SUMMARY_ARTIFACT_DIR) {
                fs.mkdirSync(process.env.APIFORGE_SUMMARY_ARTIFACT_DIR, { recursive: true });
                await summary.evaluate(element => { element.parentElement.scrollTop = element.offsetTop; });
                await summary.screenshot({ path: path.join(process.env.APIFORGE_SUMMARY_ARTIFACT_DIR, `summary-${width}-${await metric('warnings').count() ? 'warnings' : 'demo'}.png`) });
            }
        }
        await assertHidden();
        await editor.fill(SIMPLE);
        const simple = await compileSource('mysql');
        await assertMetrics(simple, 'mysql');
        await assertWarnings(simple);
        console.log('PASS: real one-entity/one-field response metrics, singular wording and full WRN001 details');

        for (const selected of ['mysql', 'postgres']) {
            await target(selected).click();
            await demo.click();
            await assertHidden();
            const data = await compileSource(selected);
            const expected = await assertMetrics(data, selected);
            assert.deepEqual(expected, { entities: 3, fields: 15, relationships: 2, endpoints: 17,
                files: 16, target: LABELS[selected], optimizations: data.optimizations.length });
            assert.equal(await metric('warnings').count(), 0);
            for (const id of ['diagram', 'ast', 'symboltable', 'sql', 'api', 'swagger']) {
                await page.locator(`#tab-${id}`).click();
                const pane = page.locator(`#output-${id}`);
                assert.equal(await pane.isVisible(), true);
                assert.ok((await pane.textContent()).trim().length > 0);
                if (id === 'diagram') assert.equal(await pane.locator('svg').count(), 1);
                if (id === 'sql') assert.equal(await pane.locator('pre').textContent(), data.generatedFiles.find(file => file.path === 'database/schema.sql').content);
                if (id === 'swagger') assert.deepEqual(JSON.parse(await pane.locator('pre').textContent()), JSON.parse(data.generatedFiles.find(file => file.path === 'swagger.json').content));
            }
            for (const width of [1440, 900, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                await assertLayout(width);
            }
            console.log(`PASS: ${LABELS[selected]} Professor Demo ${JSON.stringify(expected)}; tabs, live region and 1440/900/390px layout`);
        }
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#download-btn').click();
        const download = await downloadPromise;
        assert.match(download.suggestedFilename(), /\.zip$/);
        assert.equal(await download.failure(), null);
        console.log('PASS: Download generated project still downloads a ZIP');

        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await editor.fill(SIMPLE);
            const data = await compileSource('postgres');
            await assertWarnings(data);
            await assertLayout(width);
        }
        console.log('PASS: real warning details stay readable at all three widths');
        await page.setViewportSize({ width: 1440, height: 1000 });

        for (const control of [target('mysql'), demo, example, clear]) {
            await editor.fill(SIMPLE);
            await compileSource(await page.evaluate(() => selectedTarget));
            await control.click();
            await assertHidden();
        }
        await editor.fill(SIMPLE);
        await compileSource('mysql');
        await editor.fill('ENTITY Broken\nvalue UNKNOWN');
        const failurePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await compile.click();
        assert.equal((await (await failurePromise).json()).success, false);
        await page.locator('#error-panel.visible').waitFor();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await assertHidden();
        await editor.fill(SIMPLE);
        await compileSource('mysql');
        await page.route('**/api/compile', route => route.abort('failed'));
        await compile.click();
        await page.locator('#error-panel.visible').waitFor();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await assertHidden();
        await page.unroute('**/api/compile');
        console.log('PASS: target/demo/example/Clear/compiler failure/network failure clear old success');

        for (const control of [target('postgres'), demo, example, clear]) {
            await editor.fill(SIMPLE);
            await compileSource(await page.evaluate(() => selectedTarget));
            let responseReady;
            const ready = new Promise(resolve => { responseReady = resolve; });
            const released = new Promise(resolve => { releaseResponse = resolve; });
            await page.route('**/api/compile', async route => {
                const response = await route.fetch();
                responseReady();
                await released;
                await route.fulfill({ response });
            });
            await compile.click();
            await ready;
            await assertHidden();
            await control.click();
            await assertHidden();
            releaseResponse();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await assertHidden();
            await page.unroute('**/api/compile');
        }
        console.log('PASS: running state clears summary; delayed real responses cannot restore any invalidated state');

        async function fixture(data) {
            await page.evaluate(data => {
                renderSummary(data, 'postgres');
                document.getElementById('output-endpoints').innerHTML = renderEndpoints(data.generatedFiles);
                switchTab('endpoints');
            }, data);
        }
        for (const [files, placeholder, value] of [
            [null, 'No endpoints generated.', 'Unavailable'],
            [[], 'No endpoints generated.', 'Unavailable'],
            [[{ path: 'nested/swagger.json', content: '{}' }], 'No endpoints generated.', 'Unavailable'],
            [[{ path: 'swagger.json', content: '{broken' }], 'Unable to read generated endpoints.', 'Unavailable'],
            [[{ path: 'swagger.json', content: '{"paths":[]}' }], 'Unable to read generated endpoints.', 'Unavailable'],
            [[{ path: 'swagger.json', content: '{}' }], 'No endpoints generated.', '0'],
            [[{ path: 'swagger.json', content: '{"paths":{}}' }], 'No endpoints generated.', '0']
        ]) {
            await fixture({ generatedFiles: files });
            assert.equal(await metric('endpoints').locator('.summary-value').textContent(), value);
            assert.equal((await page.locator('#output-endpoints').textContent()).trim(), placeholder);
        }
        await fixture({ ast: { entities: [{ fields: [{}] }], relations: [{}] }, optimizations: [{}],
            warnings: [], generatedFiles: [{ path: 'swagger.json', content: JSON.stringify({ paths: {
                '/only': { parameters: [], summary: 'ignore', get: {} },
                'not/a/path': { get: {} }, '/invalid': { get: null, post: [] }
            } }) }] });
        for (const [name, text] of Object.entries({ entities: '1 entity', fields: '1 field', relationships: '1 relationship',
            endpoints: '1 endpoint', files: '1 generated file', optimizations: '1 optimization' })) {
            assert.equal(await normalized(metric(name)), text);
        }
        assert.equal(await page.locator('#output-endpoints .endpoint-row').count(), 1);
        assert.equal(await page.locator('#output-endpoints .endpoint-count').textContent(), '1 generated endpoint');
        assert.deepEqual(errors, [], 'No frontend runtime errors');
        console.log('PASS: missing/malformed Swagger placeholders, valid zero operations, single-operation fixture and all singular metrics');
    } finally {
        if (releaseResponse) releaseResponse();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
