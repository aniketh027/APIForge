// Clean checkout: npm ci && npx playwright install chromium
// Or set APIFORGE_BROWSER_EXECUTABLE to a local Chromium/Chrome executable.
'use strict';
const assert = require('node:assert/strict');
// Use the same visible workspace controls as a user; never reveal hidden panels.
async function workspace(page, view) {
    await page.locator('.ide-sidebar [data-workspace="' + view + '"]').click();
    await page.locator('.ide-sidebar [data-workspace="' + view + '"][aria-current="page"]').waitFor();
}
async function clickIn(page, view, control) { await workspace(page, view); await control.click(); }
async function enterSource(page, source) { await workspace(page, 'editor'); await page.locator('#dsl-editor').fill(source); }

const { chromium } = require('playwright');
const app = require('../server');
const { PROFESSOR_SOURCE, LIBRARY_SOURCE } = require('./frontend-source-fixtures');

// Independent oracle: inspect the actual HTTP response, never frontend state/helpers.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'];
const TABS = ['tokens', 'ast', 'diagram', 'symboltable', 'ir', 'optimized-ir', 'sql', 'endpoints', 'live-api', 'api', 'swagger'];
const SIMPLE = 'ENTITY User\nid INT PRIMARY KEY\nname STRING REQUIRED';
function operations(spec) {
    const result = [];
    for (const [path, item] of Object.entries(spec.paths)) {
        if (!path.startsWith('/') || !item || typeof item !== 'object' || Array.isArray(item)) continue;
        for (const [method, operation] of Object.entries(item)
            .sort(([a], [b]) => METHODS.indexOf(a.toUpperCase()) - METHODS.indexOf(b.toUpperCase()))) {
            if (/^(get|post|put|patch|delete|options|head|trace)$/.test(method)
                && operation && typeof operation === 'object' && !Array.isArray(operation)) {
                result.push([method.toUpperCase(), path]);
            }
        }
    }
    return result;
}
function swaggerFrom(data) {
    const file = data.generatedFiles.find(file => file.path === 'swagger.json');
    assert.ok(file, 'The real compiler returned swagger.json');
    return JSON.parse(file.content);
}

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    let releaseResponse;
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE
                ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        let expectingFailure = false;
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (expectingFailure && message.location().url.endsWith('/api/compile')
                && message.text() === 'Failed to load resource: the server responded with a status of 400 (Bad Request)') return;
            if (message.type() === 'error') errors.push(message.text());
        });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const tab = page.getByRole('tab', { name: 'Endpoints', exact: true });
        const pane = page.locator('#output-endpoints');
        const editor = page.locator('#dsl-editor');
        const compile = page.locator('#compile-btn');
        const enterProfessor = { click: () => enterSource(page, PROFESSOR_SOURCE) };
        const enterLibrary = { click: () => enterSource(page, LIBRARY_SOURCE) };
        const clear = page.getByRole('button', { name: 'Clear', exact: true });
        const target = name => page.getByRole('button', { name, exact: true });
        const rows = () => pane.locator('.endpoint-row').evaluateAll(elements => elements.map(element => [
            element.querySelector('.endpoint-method').textContent,
            element.querySelector('.endpoint-path').textContent
        ]));
        async function assertReset(title) {
            assert.equal(await pane.locator('.endpoint-row').count(), 0, 'No stale endpoints');
            assert.equal(await pane.locator('.endpoint-count').count(), 0, 'No stale count');
            assert.equal(await pane.locator('.empty-state strong').textContent(), title);
        }
        async function compileSource() {
            const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await clickIn(page, 'editor', compile);
            const response = await responsePromise;
            const data = await response.json();
            assert.equal(response.status(), 200);
            assert.equal(data.success, true);
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await workspace(page, 'inspector'); await page.locator('#compilation-summary.visible').waitFor();
            return data;
        }
        async function assertEndpoints(data) {
            const spec = swaggerFrom(data);
            const expected = operations(spec);
            await clickIn(page, 'inspector', tab);
            assert.equal(await tab.getAttribute('aria-selected'), 'true');
            assert.equal(await tab.getAttribute('tabindex'), '0');
            assert.equal(await pane.isVisible(), true);
            assert.deepEqual(await rows(), expected, 'Rendered pairs and ordering exactly match independent OpenAPI oracle');
            assert.equal(new Set((await rows()).map(pair => JSON.stringify(pair))).size, expected.length, 'No duplicates');
            assert.equal(await pane.locator('.endpoint-count').textContent(),
                `${expected.length} generated ${expected.length === 1 ? 'endpoint' : 'endpoints'}`);
            assert.equal(await pane.getByRole('list', { name: 'Generated endpoints' }).count(), 1);
            assert.equal(await pane.getByRole('listitem').count(), expected.length);
            return spec;
        }
        function assertCRUD(spec, entities) {
            for (const entity of entities) {
                // Locate both paths through existing operation metadata, without guessing route names.
                const collection = Object.entries(spec.paths).filter(([, item]) => item.post?.summary === `Create ${entity}`);
                const item = Object.entries(spec.paths).filter(([, item]) => item.get?.summary === `Get ${entity} by ID`);
                assert.equal(collection.length, 1);
                assert.equal(item.length, 1);
                const expected = operations(spec);
                for (const method of ['GET', 'POST']) assert.ok(expected.some(pair => pair[0] === method && pair[1] === collection[0][0]));
                for (const method of ['GET', 'PUT', 'DELETE']) assert.ok(expected.some(pair => pair[0] === method && pair[1] === item[0][0]));
            }
        }
        function assertDemo(spec, data) {
            assert.deepEqual(data.ast.entities.map(entity => entity.name), ['User', 'Project', 'Task']);
            assert.deepEqual(data.ast.relations.map(relation => [relation.sourceEntity, relation.name, relation.targetEntity]),
                [['User', 'OWNS', 'Project'], ['Project', 'HAS', 'Task']]);
            assertCRUD(spec, ['User', 'Project', 'Task']);
            for (const [relation, destination] of [['OWNS', 'Project'], ['HAS', 'Task']]) {
                const related = Object.entries(spec.paths).filter(([, item]) => item.get?.summary?.endsWith(`(${relation})`));
                assert.equal(related.length, 1, `${relation} has one real relationship GET path`);
                const [path, item] = related[0];
                assert.equal(item.get.responses['200'].content['application/json'].schema.$ref,
                    `#/components/schemas/${destination}.ListResponse`);
                assert.ok(operations(spec).some(pair => pair[0] === 'GET' && pair[1] === path));
            }
            assert.equal(operations(spec).length, 17);
        }
        async function assertOtherPanes(data) {
            await clickIn(page, 'inspector', page.locator('#tab-sql'));
            assert.equal(await page.locator('#output-sql pre').textContent(),
                data.generatedFiles.find(file => file.path === 'database/schema.sql').content);
            await clickIn(page, 'inspector', page.locator('#tab-api'));
            const files = data.generatedFiles.filter(file => !['database/schema.sql', 'swagger.json'].includes(file.path));
            assert.deepEqual(await page.locator('#output-api .api-file-header > span:first-child').allTextContents(), files.map(file => file.path));
            assert.deepEqual(await page.locator('#output-api pre').allTextContents(), files.map(file => file.content.replace(/\r\n/g, '\n')));
            await clickIn(page, 'inspector', page.locator('#tab-swagger'));
            assert.deepEqual(JSON.parse(await page.locator('#output-swagger pre').textContent()), swaggerFrom(data));
            await clickIn(page, 'editor', page.locator('#status-codegen'));
            assert.equal(await page.locator('#tab-sql').getAttribute('aria-selected'), 'true', 'CodeGen still opens SQL');
        }

        await workspace(page, 'inspector');
        assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tab)), TABS);
        await clickIn(page, 'inspector', tab);
        await assertReset('No compilation yet');
        assert.equal(await pane.getAttribute('aria-labelledby'), 'tab-endpoints');
        assert.equal(await tab.getAttribute('aria-controls'), 'output-endpoints');
        await page.locator('#tab-sql').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await tab.evaluate(element => document.activeElement === element), true);
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tab-live-api').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home');
        assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('End');
        assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        console.log('PASS: Endpoints tab order, accessible selection, ArrowLeft/Right, Home/End and initial reset');

        await enterSource(page, SIMPLE);
        const simpleData = await compileSource();
        const simpleSpec = await assertEndpoints(simpleData);
        assertCRUD(simpleSpec, ['User']);
        assert.equal(operations(simpleSpec).length, 5);
        await assertOtherPanes(simpleData);
        console.log('PASS: real single-entity CRUD, exact OpenAPI pairs, no duplicates, SQL/API/OpenAPI and CodeGen mapping');

        await enterProfessor.click();
        await assertReset('Source changed');
        const mysqlData = await compileSource();
        const mysqlSpec = await assertEndpoints(mysqlData);
        assertDemo(mysqlSpec, mysqlData);
        await assertOtherPanes(mysqlData);
        console.log('MySQL Professor Demo pairs:', JSON.stringify(operations(mysqlSpec)));
        await target('PostgreSQL').click();
        await assertReset('Target changed');
        const postgresData = await compileSource();
        const postgresSpec = await assertEndpoints(postgresData);
        assertDemo(postgresSpec, postgresData);
        await assertOtherPanes(postgresData);
        console.log('PostgreSQL Professor Demo pairs:', JSON.stringify(operations(postgresSpec)));

        for (const [control, title] of [[enterProfessor, 'Source changed'], [enterLibrary, 'Source changed'], [clear, 'No compilation yet']]) {
            await assertEndpoints(await compileSource());
            await workspace(page, 'editor'); await control.click();
            await assertReset(title);
            await enterSource(page, SIMPLE);
        }
        await assertEndpoints(await compileSource());
        await enterSource(page, 'ENTITY Broken\nvalue UNKNOWN');
        expectingFailure = true;
        const failure = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await clickIn(page, 'editor', compile);
        assert.equal((await (await failure).json()).success, false);
        await workspace(page, 'inspector'); await page.locator('#error-panel.visible').waitFor();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        expectingFailure = false;
        assert.equal(await pane.locator('.endpoint-row').count(), 0);
        assert.match(await pane.textContent(), /Unavailable after .* failure/);
        console.log('PASS: both target outputs, demo relationships, target/source edits/Clear/failure reset');

        // Hold a real server response to observe running state and invalidation races.
        for (const [control, title] of [[target('MySQL'), 'Target changed'], [enterProfessor, 'Source changed'],
            [enterLibrary, 'Source changed'], [clear, 'No compilation yet']]) {
            await enterSource(page, SIMPLE);
            await assertEndpoints(await compileSource());
            let responseReady;
            const ready = new Promise(resolve => { responseReady = resolve; });
            const released = new Promise(resolve => { releaseResponse = resolve; });
            await page.route('**/api/compile', async route => {
                const response = await route.fetch();
                responseReady();
                await released;
                await route.fulfill({ response });
            });
            await clickIn(page, 'editor', compile);
            await ready;
            await assertReset('Compilation running');
            await workspace(page, 'editor'); await control.click();
            await assertReset(title);
            releaseResponse();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await assertReset(title);
            await page.unroute('**/api/compile');
        }
        console.log('PASS: running compilation clears endpoints; late responses cannot restore target/source edits/Clear output');

        // Exercise isolated renderer inputs in the actual loaded frontend.
        async function renderFixture(files) {
            await page.evaluate(files => {
                document.getElementById('output-endpoints').innerHTML = renderEndpoints(files);
                switchTab('endpoints');
            }, files);
        }
        for (const files of [[], null, [{ path: 'routes/users.js', content: 'GET /fake' }],
            [{ path: 'not-swagger.json', content: '{}' }]]) {
            await renderFixture(files);
            assert.equal((await pane.textContent()).trim(), 'No endpoints generated.');
        }
        for (const content of ['{}', '{"paths":{}}', '{"paths":{"/empty":{"parameters":[],"summary":"ignore","$ref":"ignore","get":null,"post":[],"put":"invalid"}}}']) {
            await renderFixture([{ path: 'swagger.json', content }]);
            assert.equal((await pane.textContent()).trim(), 'No endpoints generated.');
        }
        for (const content of ['{broken', 'null', '[]', '{"paths":null}', '{"paths":[]}', '{"paths":"invalid"}']) {
            await renderFixture([{ path: 'swagger.json', content }]);
            assert.equal((await pane.textContent()).trim(), 'Unable to read generated endpoints.');
        }
        const fixture = { paths: {
            '/z/{id}': { trace: {}, parameters: [], delete: {}, head: {}, patch: {}, options: {}, post: {}, put: {}, get: {}, summary: 'ignored' },
            '/a/<img src=x onerror=alert(1)>': { get: {} }
        } };
        await renderFixture([{ path: 'swagger.json', content: JSON.stringify(fixture) }]);
        assert.deepEqual(await rows(), operations(fixture), 'Path insertion order, all eight methods and escaped paths');
        assert.equal(await pane.locator('img').count(), 0);
        await renderFixture([{ path: 'swagger.json', content: '{"paths":{"/one":{"get":{}}}}' }]);
        assert.equal(await pane.locator('.endpoint-count').textContent(), '1 generated endpoint');

        // Malformed swagger returned with an otherwise real successful compile is safe too.
        await page.route('**/api/compile', async route => {
            const response = await route.fetch();
            const data = await response.json();
            data.generatedFiles.find(file => file.path === 'swagger.json').content = '{broken';
            await route.fulfill({ response, json: data });
        });
        await enterSource(page, SIMPLE);
        await compileSource();
        await clickIn(page, 'inspector', tab);
        assert.equal((await pane.textContent()).trim(), 'Unable to read generated endpoints.');
        await page.unroute('**/api/compile');
        console.log('PASS: absent/empty/malformed spec, invalid operations, non-operation keys, eight methods, order, singular grammar and HTML escaping');

        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await enterProfessor.click();
            const data = await compileSource();
            await assertEndpoints(data);
            await tab.scrollIntoViewIfNeeded();
            assert.ok(await tab.evaluate(element => {
                const box = element.getBoundingClientRect();
                return box.left >= 0 && box.right <= document.documentElement.clientWidth && box.width + 1 >= element.scrollWidth;
            }), `${width}px tab is reachable and readable`);
            if (process.env.APIFORGE_ENDPOINT_SCREENSHOT_DIR) {
                await page.screenshot({ path: `${process.env.APIFORGE_ENDPOINT_SCREENSHOT_DIR}/endpoints-${width}.png`, fullPage: true });
            }
            // Include an unbroken path far beyond normal generated names.
            const longPath = `/long/${'segment'.repeat(200)}/{id}`;
            await renderFixture([{ path: 'swagger.json', content: JSON.stringify({ paths: { [longPath]: { get: {} } } }) }]);
            assert.deepEqual(await rows(), [['GET', longPath]], 'Long path remains complete');
            const metrics = await pane.evaluate(element => {
                const row = element.querySelector('.endpoint-row');
                const badge = element.querySelector('.endpoint-method');
                const path = element.querySelector('.endpoint-path');
                const box = node => node.getBoundingClientRect();
                return {
                    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    paneOverflow: element.scrollWidth - element.clientWidth,
                    rowOverflow: row.scrollWidth - row.clientWidth,
                    contained: box(row).left >= box(element).left && box(row).right <= box(element).right,
                    badgeReadable: badge.clientWidth >= badge.scrollWidth,
                    pathContained: box(path).left >= box(row).left && box(path).right <= box(row).right,
                    wrapping: getComputedStyle(path).overflowWrap
                };
            });
            assert.ok(metrics.pageOverflow <= 1 && metrics.paneOverflow <= 1 && metrics.rowOverflow <= 1);
            assert.equal(metrics.contained && metrics.badgeReadable && metrics.pathContained, true);
            assert.equal(metrics.wrapping, 'anywhere');
            console.log(`PASS: ${width}px tab access, real demo rows and complete long path containment without page overflow`);
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
