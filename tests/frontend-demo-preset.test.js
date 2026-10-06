// Clean checkout: npm ci && npx playwright install chromium
// Or set APIFORGE_BROWSER_EXECUTABLE to a local Chromium/Chrome executable.
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const app = require('../server');

// Independent approved-source fixture: do not read this from the frontend constant.
const DEMO_NAME = 'Professor Demo — Project Workspace';
const DEMO_SOURCE = `ENTITY User

id UUID PRIMARY KEY
name STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
email STRING REQUIRED UNIQUE
role ENUM("student", "faculty", "admin") DEFAULT "student"
active BOOLEAN DEFAULT TRUE
joinedAt DATE REQUIRED

ENTITY Project

id INT PRIMARY KEY
title STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 120
status ENUM("planned", "active", "completed") DEFAULT "planned"
progress INT MIN 0 MAX 100 DEFAULT 0
createdAt TIMESTAMP

ENTITY Task

id INT PRIMARY KEY
title STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 120
priority INT MIN 1 MAX 5 DEFAULT 3
done BOOLEAN DEFAULT FALSE

RELATION User OWNS Project ONE_TO_MANY
RELATION Project HAS Task ONE_TO_MANY`;
const TARGET_LABELS = { mysql: 'MySQL', postgres: 'PostgreSQL' };
const TABS = ['tokens', 'ast', 'symboltable', 'ir', 'optimized-ir', 'sql', 'api', 'swagger'];

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
            // The intentional invalid DSL below returns HTTP 400 through the real API.
            if (expectingCompilerFailure && message.location().url.endsWith('/api/compile')
                && message.text() === 'Failed to load resource: the server responded with a status of 400 (Bad Request)') return;
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('request', request => {
            if (request.url().endsWith('/api/compile')) requests.push(request.postDataJSON());
        });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const demo = page.getByRole('button', { name: 'Load demo', exact: true });
        const compile = page.getByRole('button', { name: /Compile/ });
        const editor = page.getByRole('textbox', { name: 'APIForge DSL source' });
        const example = page.getByRole('button', { name: 'Load example', exact: true });
        const clear = page.getByRole('button', { name: 'Clear', exact: true });
        const targetButtons = {
            mysql: page.getByRole('button', { name: 'MySQL', exact: true }),
            postgres: page.getByRole('button', { name: 'PostgreSQL', exact: true })
        };
        const initialSource = await editor.inputValue();
        assert.equal(await demo.count(), 1, 'Dedicated accessible demo button');
        assert.equal(await demo.isVisible(), true);
        assert.equal(await page.locator('#example-name').textContent(), 'Basic Student Entity');

        async function assertSelected(target) {
            for (const [name, button] of Object.entries(targetButtons)) {
                assert.equal(await button.getAttribute('aria-pressed'), String(name === target));
            }
        }
        async function assertDemoReady(target) {
            await assertSelected(target);
            assert.equal(await editor.inputValue(), DEMO_SOURCE);
            assert.equal(await page.locator('#example-name').textContent(), DEMO_NAME);
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
            assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
            assert.equal(await page.locator('#output-tokens').isVisible(), true);
            assert.equal(await page.locator('#line-numbers > div').count(), DEMO_SOURCE.split('\n').length);
            assert.equal(await page.locator('#editor-highlights > div').count(), DEMO_SOURCE.split('\n').length);
            assert.ok(await editor.evaluate(element => element.scrollTop === 0 && element.scrollLeft === 0));
            assert.ok(await page.locator('#editor-backdrop').evaluate(element => element.scrollTop === 0 && element.scrollLeft === 0));
            for (const id of TABS) {
                const pane = page.locator(`#output-${id}`);
                assert.equal(await pane.locator('pre, .api-file, .copy-control').count(), 0);
                assert.equal(await pane.locator('strong').textContent(), 'Demo ready');
                assert.equal(await pane.locator('.empty-state span').textContent(),
                    `${DEMO_NAME} is loaded. Press Compile to generate ${TARGET_LABELS[target]} output.`);
            }
        }
        async function loadDemo(target, keyboard = false) {
            const before = requests.length;
            const index = await page.evaluate(() => currentExampleIndex);
            if (keyboard) {
                await demo.focus();
                await page.keyboard.press('Enter');
            } else {
                await demo.click();
            }
            await assertDemoReady(target);
            await page.waitForLoadState('networkidle');
            assert.equal(requests.length, before, 'Loading the demo never auto-compiles');
            assert.equal(await page.evaluate(() => currentExampleIndex), index, 'Demo preserves the example cycle');
        }
        async function compileSource(target) {
            const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await compile.click();
            const response = await responsePromise;
            const data = await response.json();
            assert.equal(response.status(), 200);
            assert.equal(data.success, true);
            assert.deepEqual(response.request().postDataJSON(), { source: await editor.inputValue(), target });
            await page.locator('#compilation-summary.visible').waitFor();
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
            assert.equal(await page.locator('#example-name').textContent(), DEMO_NAME);
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
            await page.locator('#tab-ast').click();
            const astText = await page.locator('#output-ast').textContent();
            for (const text of ['User', 'Project', 'Task', 'OWNS', 'HAS', 'ONE_TO_MANY']) assert.ok(astText.includes(text));
            await page.locator('#tab-sql').click();
            assert.equal(await page.locator('#output-sql pre').textContent(), sql);
            await page.locator('#tab-api').click();
            const apiFiles = data.generatedFiles.filter(file => file.path !== 'database/schema.sql' && file.path !== 'swagger.json');
            assert.equal(await page.locator('#output-api .api-file').count(), apiFiles.length);
            assert.deepEqual(await page.locator('#output-api .api-file-header > span:first-child').allTextContents(), apiFiles.map(file => file.path));
            // HTML parsing normalizes CRLF in generated snippets to LF. The exact
            // response/download payload is checked above without normalization.
            assert.deepEqual(await page.locator('#output-api pre').allTextContents(),
                apiFiles.map(file => file.content.replace(/\r\n/g, '\n')));
            await page.locator('#tab-swagger').click();
            assert.deepEqual(JSON.parse(await page.locator('#output-swagger pre').textContent()), swagger);
            console.log(`PASS: ${TARGET_LABELS[target]} demo, six phases, three entities, both relationships, real SQL/driver/API files/OpenAPI`);
            return data;
        }

        // Invalidate a successful compile from a different source and a non-Tokens tab.
        await assertSelected('mysql');
        await compileSource('mysql');
        await page.locator('#tab-sql').click();
        await loadDemo('mysql', true);
        const mysqlResult = await compileDemo('mysql');
        // Loading again must clear previously compiled demo results too.
        await loadDemo('mysql');
        await targetButtons.postgres.click();
        assert.equal(await editor.inputValue(), DEMO_SOURCE);
        assert.equal(await page.locator('#example-name').textContent(), DEMO_NAME);
        assert.equal(await page.locator('#output-tokens strong').textContent(), 'Target changed');
        await loadDemo('postgres');
        const postgresResult = await compileDemo('postgres');
        assert.notDeepEqual(postgresResult.generatedFiles, mysqlResult.generatedFiles);
        await targetButtons.postgres.click();
        assert.equal(await page.locator('#compilation-summary').isVisible(), true, 'Active target preserves output');
        await loadDemo('postgres');
        console.log('PASS: accessible keyboard loading, exact source, target retention, no auto-compile and complete stale-state invalidation');

        // Preserve normal modified-source behavior; then clear a real compiler failure.
        await editor.fill(`${DEMO_SOURCE}\n\n`);
        assert.equal(await page.locator('#example-name').textContent(), 'Modified source');
        await editor.fill('ENTITY Broken\nvalue UNKNOWN');
        expectingCompilerFailure = true;
        const failure = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await compile.click();
        assert.equal((await (await failure).json()).success, false);
        await page.locator('#error-panel.visible').waitFor();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        expectingCompilerFailure = false;
        assert.ok(await page.locator('.line-error, .highlight-error').count() > 0);
        await loadDemo('postgres');
        console.log('PASS: manual editing and demo loading clear a real failure, partial output and line highlights');

        // Delay a real compile response; demo loading must keep the new ready state.
        await editor.fill(initialSource);
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
        await demo.click();
        await assertDemoReady('postgres');
        releaseResponse();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        await assertDemoReady('postgres');
        await page.unroute('**/api/compile');
        console.log('PASS: pending responses cannot restore old output after loading the demo');

        const exampleNames = ['Relationships (M:N)', 'Validations & Defaults', 'ENUM Account',
            'DATE and TIMESTAMP Event', 'UUID User and Groups', 'Basic Student Entity'];
        for (const name of exampleNames) {
            await loadDemo('postgres');
            await example.click();
            assert.equal(await page.locator('#example-name').textContent(), name);
            assert.notEqual(await editor.inputValue(), DEMO_SOURCE);
            await assertSelected('postgres');
        }
        assert.equal(await editor.inputValue(), initialSource, 'The full ordinary example cycle wraps unchanged');
        await loadDemo('postgres');
        await clear.click();
        await assertSelected('postgres');
        assert.equal(await editor.inputValue(), '');
        assert.equal(await page.locator('#example-name').textContent(), 'Untitled source');
        assert.equal(await page.locator('#compilation-summary').isVisible(), false);
        assert.equal(await page.locator('#download-btn').isVisible(), false);
        assert.equal(await page.evaluate(() => lastCompileResult), null);
        assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        for (const id of TABS) assert.equal(await page.locator(`#output-${id} strong`).textContent(), 'No compilation yet');
        await example.click();
        assert.equal(await page.locator('#example-name').textContent(), 'Relationships (M:N)');
        console.log('PASS: all six ordinary examples retain cycling behavior after demo loading; Clear retains normal behavior');

        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await targetButtons.mysql.click();
            await loadDemo('mysql');
            await compileDemo('mysql');
            await targetButtons.postgres.click();
            await loadDemo('postgres');
            await compileDemo('postgres');
            for (const control of [demo, compile, example, clear, ...Object.values(targetButtons)]) {
                assert.equal(await control.isVisible(), true);
                assert.equal(await control.isEnabled(), true);
                await control.scrollIntoViewIfNeeded();
                assert.ok(await control.evaluate(element => {
                    const box = element.getBoundingClientRect();
                    const toolbar = element.closest('.editor-toolbar').getBoundingClientRect();
                    return box.left >= toolbar.left && box.right <= toolbar.right
                        && box.top >= toolbar.top && box.bottom <= toolbar.bottom
                        && box.left >= 0 && box.right <= document.documentElement.clientWidth
                        && box.width >= element.scrollWidth && box.height >= 30;
                }), `${width}px controls remain reachable, readable and contained`);
            }
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
                `${width}px has no page horizontal overflow`);
            console.log(`PASS: ${width}px demo, Compile, targets and existing controls without page overflow`);
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
