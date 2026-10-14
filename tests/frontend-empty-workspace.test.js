// Clean checkout: npm ci && npx playwright install chromium
'use strict';
const assert = require('node:assert/strict');
// Use the same visible workspace controls as a user; never reveal hidden panels.
async function workspace(page, view) {
    await page.locator('.ide-sidebar [data-workspace="' + view + '"]').click();
    await page.locator('.ide-sidebar [data-workspace="' + view + '"][aria-current="page"]').waitFor();
}
async function clickIn(page, view, control) { await workspace(page, view); await control.click(); }
async function enterSource(page, source) { await workspace(page, 'editor'); await page.locator('#dsl-editor').fill(source); }

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const app = require('../server');
const { PROFESSOR_SOURCE: DEMO_SOURCE, LIBRARY_SOURCE } = require('./frontend-source-fixtures');
const TARGET_LABELS = { mysql: 'MySQL', postgres: 'PostgreSQL' };
const TABS = ['tokens', 'ast', 'diagram', 'symboltable', 'ir', 'optimized-ir', 'sql', 'endpoints', 'api', 'swagger'];

async function main() {
    const runtime = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
    assert.doesNotMatch(runtime, /PROFESSOR_DEMO|EXAMPLES|EXAMPLE_DSL|currentExampleIndex|loadDemo|loadExample|demo-btn|example-btn|ENTITY Student|ENTITY User/);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser, releaseResponse;
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (request.url().endsWith('/api/compile')) requests.push(request.postDataJSON()); });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto('http://127.0.0.1:' + server.address().port);
        const compile = page.locator('#compile-btn');
        const editor = page.locator('#dsl-editor');
        const clear = page.getByRole('button', { name: 'Clear', exact: true });
        const targetButtons = { mysql: page.getByRole('button', { name: 'MySQL', exact: true }),
            postgres: page.getByRole('button', { name: 'PostgreSQL', exact: true }) };
        async function assertInvalidated(title) {
            await workspace(page, 'inspector');
            assert.equal(await page.locator('#compilation-summary').isVisible(), false);
            assert.equal(await page.locator('#compilation-summary-content').textContent(), '');
            assert.equal(await page.locator('#download-btn').isVisible(), false);
            assert.equal(await page.locator('#error-panel').textContent(), '');
            assert.deepEqual(await page.evaluate(() => [lastCompileResult, lastCompiledSource, lastCompiledTarget, liveOperations]), [null, null, null, []]);
            assert.equal(await page.locator('.status-icon.pending').count(), 6);
            assert.equal(await page.locator('#pipeline-state').textContent(), 'Waiting for compilation');
            assert.equal(await page.locator('.line-error, .highlight-error').count(), 0);
            for (const id of TABS) {
                const pane = page.locator('#output-' + id);
                assert.equal(await pane.locator('pre, .api-file, .copy-control, .schema-entity, .endpoint-row').count(), 0);
                assert.equal(await pane.locator('.empty-state strong').textContent(), title);
            }
            assert.equal(await page.locator('#output-live-api #live-start, #output-live-api #live-stop').count(), 0);
            assert.match(await page.locator('#output-live-api').textContent(), /Compile successfully/);
        }
        assert.equal(await page.getByRole('button', { name: 'Load demo', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Load example', exact: true }).count(), 0);
        assert.equal(await page.locator('#demo-btn, #example-btn').count(), 0);
        assert.equal(await editor.inputValue(), '');
        assert.equal(await editor.isEditable(), true);
        assert.equal(await compile.isEnabled(), true);
        assert.equal(await page.locator('#source-name').textContent(), 'Untitled source');
        assert.equal(await page.locator('#line-numbers > div').count(), 1);
        assert.equal(await page.locator('#editor-highlights > div').count(), 1);
        await assertInvalidated('No compilation yet');
        await page.waitForLoadState('networkidle');
        assert.deepEqual(requests, [], 'Startup never invokes the compiler');
        assert.equal(await targetButtons.mysql.getAttribute('aria-pressed'), 'true');
        console.log('PASS: removed buttons/constants, empty editable startup, neutral label, pending phases, no automatic compile or results');

        // Empty source reaches the unchanged server validation, without a client guard.
        const emptyResponse = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await clickIn(page, 'editor', compile);
        const empty = await emptyResponse;
        assert.deepEqual(empty.request().postDataJSON(), { source: '', target: 'mysql' });
        const directEmpty = await page.request.post('http://127.0.0.1:' + server.address().port + '/api/compile', { data: { source: '', target: 'mysql' } });
        assert.equal(empty.status(), directEmpty.status());
        assert.deepEqual(await empty.json(), await directEmpty.json());
        assert.equal((await empty.json()).success, false);
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await workspace(page, 'inspector');
        assert.equal(await page.locator('#error-panel').isVisible(), true);
        assert.equal(await page.locator('#download-btn').isVisible(), false);
        await clickIn(page, 'editor', clear); await assertInvalidated('No compilation yet');
        console.log('PASS: empty submission preserves compiler API validation and Clear removes its diagnostics');
        async function compileSource(target) {
            const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await clickIn(page, 'editor', compile);
            const response = await responsePromise;
            const data = await response.json();
            assert.equal(response.status(), 200);
            assert.equal(data.success, true);
            assert.deepEqual(response.request().postDataJSON(), { source: await editor.inputValue(), target });
            await workspace(page, 'inspector'); await page.locator('#compilation-summary.visible').waitFor();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            assert.equal(await page.locator('#download-btn').isVisible(), true);
            assert.equal(await page.locator('.status-icon.success').count(), 6);
            assert.ok(Object.values(data.phaseStates).every(status => status === 'succeeded'));
            assert.match(await page.locator('#compilation-summary-content').textContent(),
                new RegExp(`${TARGET_LABELS[target]}\\s*target`));
            assert.deepEqual(await page.evaluate(() => lastCompileResult.generatedFiles), data.generatedFiles);
            return data;
        }
        async function compileDemo(target) {
            const data = await compileSource(target);
            assert.equal(await editor.inputValue(), DEMO_SOURCE, 'Compile preserves the exact source');
            assert.equal(await page.locator('#source-name').textContent(), 'Modified source');
            assert.deepEqual(data.ast.entities.map(entity => entity.name), ['User', 'Project', 'Task']);
            assert.deepEqual(data.ast.relations.map(relation => [relation.sourceEntity, relation.name,
                relation.targetEntity, relation.relationType]), [
                ['User', 'OWNS', 'Project', 'ONE_TO_MANY'],
                ['Project', 'HAS', 'Task', 'ONE_TO_MANY']
            ]);
            const file = path => {
                const generated = data.generatedFiles.find(file => file.path === path);
                assert.ok(generated, `${path} is generated`);
                assert.ok(generated.content.length > 0, `${path} is populated`);
                return generated.content;
            };
            assert.equal(data.generatedFiles.length, 16);
            for (const [entity, stem] of [['User', 'user'], ['Project', 'project'], ['Task', 'task']]) {
                file(`models/${entity}.js`);
                file(`controllers/${stem}Controller.js`);
                file(`routes/${stem}Routes.js`);
            }
            const sql = file('database/schema.sql');
            const dependencies = JSON.parse(file('package.json')).dependencies;
            if (target === 'mysql') {
                assert.match(sql, /\bAUTO_INCREMENT\b/);
                assert.match(sql, /CHAR\(36\) CHARACTER SET ascii COLLATE ascii_bin/);
                assert.match(sql, /FOREIGN KEY \(user_id\) REFERENCES User\(id\)/);
                assert.match(sql, /FOREIGN KEY \(project_id\) REFERENCES Project\(id\)/);
                assert.match(file('config/db.js'), /require\('mysql2\/promise'\)/);
                assert.doesNotMatch(sql, /\bGENERATED BY DEFAULT AS IDENTITY\b/);
                assert.ok(dependencies.mysql2);
                assert.equal(dependencies.pg, undefined);
            } else {
                assert.match(sql, /\bGENERATED BY DEFAULT AS IDENTITY\b/);
                assert.match(sql, /"id" UUID/);
                assert.match(sql, /"createdAt" TIMESTAMPTZ\(0\)/);
                assert.match(sql, /FOREIGN KEY \("user_id"\) REFERENCES "public"\."User" \("id"\)/);
                assert.match(sql, /FOREIGN KEY \("project_id"\) REFERENCES "public"\."Project" \("id"\)/);
                assert.match(file('config/db.js'), /require\('pg'\)/);
                assert.doesNotMatch(sql, /\bAUTO_INCREMENT\b/);
                assert.ok(dependencies.pg);
                assert.equal(dependencies.mysql2, undefined);
            }
            const swagger = JSON.parse(file('swagger.json'));
            for (const entity of ['User', 'Project', 'Task']) assert.ok(swagger.components.schemas[entity]);
            for (const plural of ['users', 'projects', 'tasks']) {
                for (const method of ['get', 'post']) assert.ok(swagger.paths[`/${plural}`][method]);
                for (const method of ['get', 'put', 'delete']) assert.ok(swagger.paths[`/${plural}/{id}`][method]);
            }
            assert.ok(swagger.paths['/users/{id}/projects'].get);
            assert.ok(swagger.paths['/projects/{id}/tasks'].get);
            // Check that the real server results reach each corresponding inspector.
            await clickIn(page, 'inspector', page.locator('#tab-ast'));
            const astText = await page.locator('#output-ast').textContent();
            for (const text of ['User', 'Project', 'Task', 'OWNS', 'HAS', 'ONE_TO_MANY']) assert.ok(astText.includes(text));
            await clickIn(page, 'inspector', page.locator('#tab-sql'));
            assert.equal(await page.locator('#output-sql pre').textContent(), sql);
            await clickIn(page, 'inspector', page.locator('#tab-api'));
            const apiFiles = data.generatedFiles.filter(file => file.path !== 'database/schema.sql' && file.path !== 'swagger.json');
            assert.equal(await page.locator('#output-api .api-file').count(), apiFiles.length);
            assert.deepEqual(await page.locator('#output-api .api-file-header > span:first-child').allTextContents(), apiFiles.map(file => file.path));
            // HTML parsing normalizes CRLF in generated snippets to LF. The exact
            // response/download payload is checked above without normalization.
            assert.deepEqual(await page.locator('#output-api pre').allTextContents(),
                apiFiles.map(file => file.content.replace(/\r\n/g, '\n')));
            await clickIn(page, 'inspector', page.locator('#tab-swagger'));
            assert.deepEqual(JSON.parse(await page.locator('#output-swagger pre').textContent()), swagger);
            console.log(`PASS: ${TARGET_LABELS[target]} demo, six phases, three entities, both relationships, real SQL/driver/API files/OpenAPI`);
            return data;
        }


        for (const target of ['mysql', 'postgres']) {
            await targetButtons[target].click();
            await enterSource(page, DEMO_SOURCE);
            await assertInvalidated('Source changed');
            const data = await compileDemo(target);
            assert.equal(await page.locator('#output-diagram .schema-entity').count(), 3);
            assert.equal(await page.locator('#output-endpoints .endpoint-row').count(), 17);
            await clickIn(page, 'inspector', page.locator('#tab-live-api'));
            assert.equal(await page.locator('#live-start').isEnabled(), true);
            // Compare actual downloaded ZIP bytes to the frozen G28 implementation.
            const historical = execFileSync('git', ['show', '112a464ee4615c3956c686bfff59c9aa5d9f8497:frontend/app.js'], { encoding: 'utf8' });
            const context = vm.createContext({ Blob, TextEncoder, Uint8Array, DataView });
            vm.runInContext(historical.slice(historical.indexOf('function createZip('), historical.indexOf('function downloadProject(')), context);
            const expected = Buffer.from(await context.createZip(data.generatedFiles).arrayBuffer());
            const pendingDownload = page.waitForEvent('download');
            await page.locator('#download-btn').click();
            const download = await pendingDownload;
            const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
            assert.equal(await download.failure(), null);
            assert.deepEqual(Buffer.concat(chunks), expected, target + ' exact frozen ZIP bytes');
            await enterSource(page, LIBRARY_SOURCE);
            await assertInvalidated('Source changed');
            const library = await compileSource(target);
            assert.deepEqual(library.ast.entities.map(entity => entity.name), ['Author', 'Book']);
            assert.equal(library.ast.relations.length, 1);
            assert.equal(await page.locator('#output-diagram .schema-entity').count(), 2);
            assert.equal(await page.locator('#output-endpoints .endpoint-row').count(), 11);
            console.log('PASS: ' + target + ' generic Professor and Library domains, inspectors, Live readiness, download and frozen ZIP bytes');
        }

        // Programmatic Tab insertion must invalidate just like ordinary typing.
        await workspace(page, 'editor'); await editor.focus(); await page.keyboard.press('Tab');
        await assertInvalidated('Source changed');
        assert.equal(await page.locator('#line-numbers > div').count(), (await editor.inputValue()).split('\n').length);
        await enterSource(page, LIBRARY_SOURCE); await editor.focus();
        const shortcut = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await page.keyboard.press('Control+Enter'); assert.equal((await (await shortcut).json()).success, true);
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await workspace(page, 'inspector');
        assert.equal(await page.locator('#download-btn').isVisible(), true);
        await clickIn(page, 'editor', clear); await assertInvalidated('No compilation yet');
        assert.equal(await editor.inputValue(), '');
        assert.equal(await page.locator('#source-name').textContent(), 'Untitled source');
        assert.equal(await targetButtons.postgres.getAttribute('aria-pressed'), 'true');

        const actions = [
            ['rapid edits away and back', async () => { await enterSource(page, LIBRARY_SOURCE); await enterSource(page, DEMO_SOURCE); }, 'Source changed'],
            ['Clear', () => clickIn(page, 'editor', clear), 'No compilation yet'],
            ['target away and back', async () => { const target = await page.evaluate(() => selectedTarget); await targetButtons[target === 'mysql' ? 'postgres' : 'mysql'].click(); await targetButtons[target].click(); }, 'Target changed'],
            ['new target', async () => { const target = await page.evaluate(() => selectedTarget); await targetButtons[target === 'mysql' ? 'postgres' : 'mysql'].click(); }, 'Target changed'],
            ['Tab insertion', async () => { await editor.focus(); await page.keyboard.press('Tab'); }, 'Source changed']
        ];
        for (const [name, action, title] of actions) {
            await enterSource(page, DEMO_SOURCE);
            let responseReady;
            const ready = new Promise(resolve => { responseReady = resolve; });
            const released = new Promise(resolve => { releaseResponse = resolve; });
            await page.route('**/api/compile', async route => {
                const response = await route.fetch(); responseReady(); await released; await route.fulfill({ response });
            });
            await clickIn(page, 'editor', compile); await ready; await action();
            const source = await editor.inputValue();
            await assertInvalidated(title);
            releaseResponse();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await assertInvalidated(title);
            assert.equal(await editor.inputValue(), source, 'Old response never changes current source');
            await page.unroute('**/api/compile');
            // A later explicit compilation must publish the new current result.
            await enterSource(page, LIBRARY_SOURCE);
            const current = await compileSource(await page.evaluate(() => selectedTarget));
            assert.deepEqual(current.ast.entities.map(entity => entity.name), ['Author', 'Book']);
            assert.deepEqual(await page.evaluate(() => lastCompileResult.ast.entities.map(entity => entity.name)), ['Author', 'Book']);
            console.log('PASS: pending real compilation cannot restore obsolete output after ' + name);
        }
        // Ignore obsolete failure responses and network errors, including header state.
        for (const networkFailure of [false, true]) {
            await enterSource(page, 'ENTITY Broken\nvalue UNKNOWN');
            let responseReady;
            const ready = new Promise(resolve => { responseReady = resolve; });
            const released = new Promise(resolve => { releaseResponse = resolve; });
            await page.route('**/api/compile', async route => {
                const response = networkFailure ? null : await route.fetch();
                responseReady(); await released;
                if (networkFailure) await route.abort('failed'); else await route.fulfill({ response });
            });
            await clickIn(page, 'editor', compile); await ready; await enterSource(page, LIBRARY_SOURCE);
            releaseResponse(); await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await assertInvalidated('Source changed');
            assert.equal(await page.locator('#header-status-text').textContent(), 'Compiler ready');
            await page.unroute('**/api/compile');
        }
        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await enterSource(page, LIBRARY_SOURCE); await compileSource(await page.evaluate(() => selectedTarget));
            for (const control of [compile, clear, ...Object.values(targetButtons)]) {
                assert.equal(await control.isVisible(), true); assert.equal(await control.isEnabled(), true);
                await control.scrollIntoViewIfNeeded();
                assert.ok(await control.evaluate(element => {
                    const box = element.getBoundingClientRect(), toolbar = element.closest('.editor-toolbar').getBoundingClientRect();
                    return box.left >= toolbar.left && box.right <= toolbar.right && box.top >= toolbar.top && box.bottom <= toolbar.bottom
                        && box.left >= 0 && box.right <= document.documentElement.clientWidth && box.height >= 30;
                }), width + 'px controls remain reachable and contained');
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        }
        assert.deepEqual(errors, [], 'No frontend runtime errors');
        console.log('PASS: stale failures/network errors, shortcuts, line numbers, Clear, targets and 1440/900/390 responsive workspace');
    } finally {
        if (releaseResponse) releaseResponse();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
