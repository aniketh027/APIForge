// Clean checkout: npm ci && npx playwright install chromium
// Or set APIFORGE_BROWSER_EXECUTABLE to a local Chromium/Chrome executable.
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const app = require('../server');
const { STUDENT_SOURCE, LIBRARY_SOURCE } = require('./frontend-source-fixtures');

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    let releaseResponse;
    try {
        browser = await chromium.launch({
            headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE
                ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {})
        });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        const requests = [];
        let expectingCompilerFailure = false;
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            // The test intentionally exercises compiler failures.
            if (expectingCompilerFailure && message.location().url.endsWith('/api/compile')
                && /status of (400|422)\b/.test(message.text())) return;
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('request', request => {
            if (request.url().endsWith('/api/compile')) requests.push(request.postDataJSON());
        });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const mysql = page.getByRole('button', { name: 'MySQL', exact: true });
        const postgres = page.getByRole('button', { name: 'PostgreSQL', exact: true });
        const editor = page.locator('#dsl-editor');
        assert.equal(await editor.inputValue(), '');
        await editor.fill(STUDENT_SOURCE);
        const source = STUDENT_SOURCE;
        const sourceName = await page.locator('#source-name').textContent();

        async function assertSelected(target) {
            assert.equal(await mysql.getAttribute('aria-pressed'), String(target === 'mysql'));
            assert.equal(await postgres.getAttribute('aria-pressed'), String(target === 'postgres'));
        }
        async function assertInvalidated(target) {
            assert.equal(await page.locator('#compilation-summary').isVisible(), false);
            assert.equal(await page.locator('#compilation-summary-content').textContent(), '');
            assert.equal(await page.locator('#download-btn').isVisible(), false);
            assert.equal(await page.locator('#download-section').getAttribute('class'), 'download-section');
            assert.equal(await page.locator('#error-panel').isVisible(), false);
            assert.equal(await page.locator('#error-panel').textContent(), '');
            assert.equal(await page.evaluate(() => lastCompileResult), null);
            assert.equal(await page.locator('.status-icon.pending').count(), 6);
            assert.equal(await page.locator('#pipeline-state').textContent(), 'Waiting for compilation');
            assert.equal(await page.locator('.line-error, .highlight-error').count(), 0);
            for (const id of ['tokens', 'ast', 'symboltable', 'ir', 'optimized-ir', 'sql', 'api', 'swagger']) {
                const pane = page.locator(`#output-${id}`);
                assert.equal(await pane.locator('pre, .api-file, .copy-control').count(), 0);
                assert.equal(await pane.locator('strong').textContent(), 'Target changed');
                assert.equal(await pane.locator('.empty-state span').textContent(),
                    `Compile again to generate ${target === 'mysql' ? 'MySQL' : 'PostgreSQL'} output.`);
            }
        }
        async function compileAndCheck(target) {
            const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await page.locator('#compile-btn').click();
            const response = await responsePromise;
            const data = await response.json();
            assert.equal(response.status(), 200);
            assert.equal(data.success, true);
            assert.deepEqual(response.request().postDataJSON(), { source: await editor.inputValue(), target });
            await page.locator('#compilation-summary.visible').waitFor();
            assert.equal(await page.locator('#download-btn').isVisible(), true);
            const summary = await page.locator('#compilation-summary-content').textContent();
            assert.match(summary, /Compiled successfully/);
            assert.match(summary, target === 'mysql' ? /MySQL\s*target/ : /PostgreSQL\s*target/);
            assert.equal(await page.locator('.status-icon.success').count(), 6);
            await page.locator('#tab-sql').click();
            const sql = data.generatedFiles.find(file => file.path === 'database/schema.sql').content;
            assert.equal(await page.locator('#output-sql pre').textContent(), sql);
            // Integer primary-key allocation and the runtime driver are target contracts.
            const dependencies = JSON.parse(data.generatedFiles.find(file => file.path === 'package.json').content).dependencies;
            if (target === 'mysql') {
                assert.match(sql, /\bAUTO_INCREMENT\b/);
                assert.doesNotMatch(sql, /\bGENERATED BY DEFAULT AS IDENTITY\b/);
                assert.ok(dependencies.mysql2);
                assert.equal(dependencies.pg, undefined);
            } else {
                assert.match(sql, /\bGENERATED BY DEFAULT AS IDENTITY\b/);
                assert.doesNotMatch(sql, /\bAUTO_INCREMENT\b/);
                assert.ok(dependencies.pg);
                assert.equal(dependencies.mysql2, undefined);
            }
            return sql;
        }

        await assertSelected('mysql');
        const mysqlSQL = await compileAndCheck('mysql');
        await mysql.click();
        assert.equal(await page.locator('#compilation-summary').isVisible(), true, 'Selecting the active target preserves output');
        await postgres.focus();
        await page.keyboard.press('Enter');
        await assertSelected('postgres');
        await assertInvalidated('postgres');
        assert.equal(await editor.inputValue(), source);
        assert.equal(await page.locator('#source-name').textContent(), sourceName);
        assert.equal(requests.length, 1, 'Target change does not automatically compile');
        const postgresSQL = await compileAndCheck('postgres');
        assert.notEqual(postgresSQL, mysqlSQL);
        await mysql.focus();
        await page.keyboard.press('Space');
        await assertSelected('mysql');
        await assertInvalidated('mysql');
        assert.equal(await compileAndCheck('mysql'), mysqlSQL);
        console.log('PASS: default MySQL, explicit requests, target SQL/driver, summary, keyboard switching and stale-output invalidation');

        // Target changes also clear a real compiler failure and its partial results.
        await editor.fill('ENTITY Broken\nvalue UNKNOWN');
        expectingCompilerFailure = true;
        const failure = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await page.locator('#compile-btn').click();
        assert.equal((await (await failure).json()).success, false);
        await page.locator('#error-panel.visible').waitFor();
        expectingCompilerFailure = false;
        await postgres.click();
        await assertInvalidated('postgres');
        assert.equal(await editor.inputValue(), 'ENTITY Broken\nvalue UNKNOWN');
        assert.equal(await page.locator('#source-name').textContent(), 'Modified source');
        await editor.fill(LIBRARY_SOURCE);
        await assertSelected('postgres');
        assert.notEqual(await editor.inputValue(), source);
        await compileAndCheck('postgres');

        // Retain real compiler artifacts while simulating a failure in the final phase.
        await page.route('**/api/compile', async route => {
            const response = await route.fetch();
            const data = await response.json();
            assert.equal(data.success, true);
            await route.fulfill({ status: 422, json: {
                success: false, phase: 'codegen',
                phases: { ...data.phases, codegen: false },
                phaseStates: { ...data.phaseStates, codegen: 'failed' },
                tokens: data.tokens, ast: data.ast, symbolTable: data.symbolTable,
                ir: data.ir, optimizedIR: data.optimizedIR, optimizations: data.optimizations,
                errors: [{ message: 'Generated artifacts could not be produced.' }]
            } });
        }, { times: 1 });
        expectingCompilerFailure = true;
        const rejected = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await page.locator('#compile-btn').click();
        const rejectedResponse = await rejected;
        assert.equal(rejectedResponse.status(), 422);
        const rejectedData = await rejectedResponse.json();
        assert.equal(rejectedData.phase, 'codegen');
        assert.ok(rejectedData.optimizedIR.instructions.length);
        await page.locator('#output-optimized-ir .ir-instruction').first().waitFor({ state: 'attached' });
        assert.equal(await page.locator('#output-optimized-ir .ir-instruction').count(), rejectedData.optimizedIR.instructions.length);
        assert.match(await page.locator('#error-panel').textContent(), /Generated artifacts could not be produced/);
        assert.match(await page.locator('#output-sql').textContent(), /Unavailable after CodeGen failure/);
        assert.equal(await page.locator('#download-btn').isVisible(), false);
        expectingCompilerFailure = false;

        await page.locator('#clear-btn').click();
        await assertSelected('postgres');
        assert.equal(await editor.inputValue(), '');
        assert.equal(await page.locator('#download-btn').isVisible(), false);
        await editor.fill(LIBRARY_SOURCE);
        await assertSelected('postgres');
        console.log('PASS: failure invalidation and target persistence across user-entered source and Clear');

        // Delay a real server response, then switch away and back while it is pending.
        let responseReady;
        const ready = new Promise(resolve => { responseReady = resolve; });
        const released = new Promise(resolve => { releaseResponse = resolve; });
        await page.route('**/api/compile', async route => {
            const response = await route.fetch();
            responseReady();
            await released;
            await route.fulfill({ response });
        });
        const countBefore = requests.length;
        await page.locator('#compile-btn').click();
        await ready;
        await mysql.click();
        await postgres.click();
        await assertInvalidated('postgres');
        releaseResponse();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await assertInvalidated('postgres');
        assert.equal(requests.length, countBefore + 1);
        await page.unroute('**/api/compile');
        console.log('PASS: an in-flight response cannot restore stale output after switching away and back');

        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await compileAndCheck('postgres');
            for (const control of [mysql, postgres, page.locator('#compile-btn'), page.locator('#clear-btn')]) {
                assert.equal(await control.isVisible(), true);
                assert.equal(await control.isEnabled(), true);
                assert.ok(await control.evaluate(element => {
                    const box = element.getBoundingClientRect();
                    const toolbar = element.closest('.editor-toolbar').getBoundingClientRect();
                    return box.left >= toolbar.left && box.right <= toolbar.right
                        && box.top >= toolbar.top && box.bottom <= toolbar.bottom;
                }), `${width}px controls stay inside toolbar`);
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
                `${width}px has no page horizontal overflow`);
            await mysql.click();
            await assertSelected('mysql');
            await assertInvalidated('mysql');
            await postgres.click();
            await assertSelected('postgres');
            console.log(`PASS: ${width}px accessible target selector and contained controls without page overflow`);
        }
        assert.deepEqual(errors, [], 'No frontend console or runtime errors');
        console.log('PASS: no frontend console or runtime errors');
    } finally {
        if (releaseResponse) releaseResponse();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
