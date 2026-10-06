// Clean checkout: npm ci && npx playwright install chromium
// Or set APIFORGE_BROWSER_EXECUTABLE to a local Chromium/Chrome executable.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const app = require('../server');

const TABS = ['tokens', 'ast', 'diagram', 'symboltable', 'ir', 'optimized-ir', 'sql', 'endpoints', 'live-api', 'api', 'swagger'];
const SIMPLE = 'ENTITY Note\nid INT PRIMARY KEY\ntext STRING REQUIRED UNIQUE\nstate ENUM("open", "closed")\nuser_id INT';
const MULTIPLE = `ENTITY Author
id INT PRIMARY KEY
email STRING REQUIRED UNIQUE
ENTITY Book
id INT PRIMARY KEY
title STRING
ENTITY Tag
id INT PRIMARY KEY
name STRING
RELATION Book WRITTEN_BY Author MANY_TO_ONE
RELATION Book TAGGED Tag MANY_TO_MANY`;
// Independent preset fixture, never obtained from the frontend constant.
const DEMO = `ENTITY User

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

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser, releaseResponse;
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const pane = page.locator('#output-diagram');
        const tab = page.getByRole('tab', { name: 'Diagram', exact: true });
        const editor = page.getByRole('textbox', { name: 'APIForge DSL source' });
        const compile = page.locator('#compile-btn');
        const demo = page.getByRole('button', { name: 'Load demo', exact: true });
        const example = page.getByRole('button', { name: 'Load example', exact: true });
        const clear = page.getByRole('button', { name: 'Clear', exact: true });
        const target = name => page.getByRole('button', { name, exact: true });
        async function reset(title) {
            assert.equal(await pane.locator('.schema-entity, .schema-relation, .schema-connector').count(), 0, 'All diagram results reset');
            assert.equal(await pane.locator('.empty-state strong').textContent(), title);
        }
        async function compileSource(source) {
            if (source !== undefined) await editor.fill(source);
            const pending = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await compile.click();
            const response = await pending;
            const data = await response.json();
            assert.equal(response.status(), 200);
            assert.equal(data.success, true);
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true', 'Success still returns to Tokens');
            return data;
        }
        async function matchesAST(data) {
            await tab.click();
            assert.equal(await tab.getAttribute('aria-selected'), 'true');
            assert.equal(await tab.getAttribute('tabindex'), '0');
            assert.equal(await pane.isVisible(), true);
            // Independent response oracle, including exact order and constraint membership.
            const expected = data.ast.entities.map(entity => ({ name: entity.name,
                fields: entity.fields.map(field => ({ name: field.name,
                    type: field.dataType === 'ENUM' ? `ENUM(${field.enumValues.map(value => JSON.stringify(value)).join(', ')})` : field.dataType,
                    constraints: ['PRIMARY_KEY', 'REQUIRED', 'UNIQUE'].filter(key => field.constraints.includes(key)).map(key => key.replace('_', ' ')) })) }));
            const actual = await pane.locator('.schema-entity').evaluateAll(cards => cards.map(card => ({
                name: card.querySelector('.schema-entity-name').textContent,
                fields: Array.from(card.querySelectorAll('.schema-field'), field => ({
                    name: field.querySelector('.schema-field-name').textContent,
                    type: field.querySelector('.schema-field-type').textContent,
                    constraints: Array.from(field.querySelectorAll('.schema-constraint'), badge => badge.textContent)
                }))
            })));
            assert.deepEqual(actual, expected, 'Exactly the returned entities and declared fields, types, order and constraints');
            assert.equal(new Set(actual.map(entity => entity.name)).size, actual.length, 'No duplicate cards');
            const expectedRelations = data.ast.relations.map(relation => [relation.sourceEntity, relation.name, relation.targetEntity, relation.relationType]);
            const actualRelations = await pane.locator('.schema-relation').evaluateAll(labels => labels.map(label => [
                label.dataset.source, label.querySelector('.schema-relation-name').textContent,
                label.dataset.target, label.querySelector('.schema-cardinality').textContent
            ]));
            assert.deepEqual(actualRelations, expectedRelations, 'Exactly the real AST relationships and directions');
            assert.equal(new Set(actualRelations.map(row => JSON.stringify(row))).size, actualRelations.length, 'No duplicate relationship labels');
            assert.equal(await pane.locator('.schema-connector').count(), expectedRelations.length, 'One arrow per relationship');
            assert.equal(await pane.locator('svg').getAttribute('aria-hidden'), 'true');
            assert.equal(await pane.getByRole('region', { name: 'Entity relationship diagram' }).getAttribute('tabindex'), '0');
            for (const [index, relation] of data.ast.relations.entries()) {
                assert.ok((await pane.locator('.schema-relation').nth(index).textContent()).includes(`From ${relation.sourceEntity} to ${relation.targetEntity}:`), 'Accessible HTML describes direction');
            }
            // Check actual connector coordinates attach to the correct card edges.
            assert.ok(await pane.evaluate((element, relations) => {
                const board = element.querySelector('.schema-board').getBoundingClientRect();
                const cards = Array.from(element.querySelectorAll('.schema-entity'));
                return Array.from(element.querySelectorAll('.schema-connector')).every((connector, index) => {
                    const coordinates = connector.getAttribute('d').match(/[-\d.]+/g).map(Number);
                    const source = cards.find(card => card.querySelector('h3').textContent === relations[index].sourceEntity).getBoundingClientRect();
                    const target = cards.find(card => card.querySelector('h3').textContent === relations[index].targetEntity).getBoundingClientRect();
                    return coordinates[0] + board.left > source.left && coordinates[0] + board.left < source.right
                        && Math.abs(coordinates[1] + board.top - source.top) < 1
                        && coordinates[3] + board.left > target.left && coordinates[3] + board.left < target.right
                        && Math.abs(coordinates[4] + board.top - target.top) < 1
                        && connector.getAttribute('marker-end') === 'url(#schema-arrow)';
                });
            }, data.ast.relations), 'Arrow starts at source card and points into target card');
        }

        assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(button => button.dataset.tab)), TABS);
        assert.equal(await tab.getAttribute('aria-controls'), 'output-diagram');
        assert.equal(await pane.getAttribute('aria-labelledby'), 'tab-diagram');
        await tab.click();
        await reset('Ready to compile');
        await page.locator('#tab-ast').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await tab.evaluate(element => document.activeElement === element), true);
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tab-symboltable').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home');
        assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('End');
        assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        await page.locator('#status-parser').click();
        assert.equal(await page.locator('#tab-ast').getAttribute('aria-selected'), 'true');
        await page.locator('#status-semantic').click();
        assert.equal(await page.locator('#tab-symboltable').getAttribute('aria-selected'), 'true');
        console.log('PASS: Diagram tab, mouse/keyboard navigation, reset state and unchanged pipeline mapping');

        await matchesAST(await compileSource(SIMPLE));
        assert.equal(await pane.locator('.schema-relation').count(), 0, 'Foreign-key-looking field never invents a relation');
        await matchesAST(await compileSource(MULTIPLE));
        console.log('PASS: real entity-only and multi-entity responses, ENUM, constraint badges, field order, no duplicates and connector geometry');

        for (const database of ['MySQL', 'PostgreSQL']) {
            await target(database).click();
            if (database === 'PostgreSQL') await reset('Target changed');
            await demo.click();
            await reset('Demo ready');
            assert.equal(await editor.inputValue(), DEMO);
            const data = await compileSource();
            await matchesAST(data);
            assert.deepEqual(data.ast.entities.map(entity => entity.name), ['User', 'Project', 'Task']);
            assert.deepEqual(data.ast.relations.map(relation => [relation.sourceEntity, relation.name, relation.targetEntity, relation.relationType]), [
                ['User', 'OWNS', 'Project', 'ONE_TO_MANY'], ['Project', 'HAS', 'Task', 'ONE_TO_MANY']
            ]);
            // Existing inspectors still show the corresponding real compiler output.
            for (const id of ['ast', 'symboltable', 'sql', 'endpoints', 'api', 'swagger']) {
                await page.locator(`#tab-${id}`).click();
                assert.equal(await page.locator(`#output-${id}`).isVisible(), true);
                assert.ok((await page.locator(`#output-${id}`).textContent()).trim().length > 0);
                assert.equal(await page.locator(`#output-${id} .empty-state`).count(), 0);
            }
            const sql = data.generatedFiles.find(file => file.path === 'database/schema.sql');
            assert.equal(await page.locator('#output-sql pre').textContent(), sql.content);
            assert.deepEqual(JSON.parse(await page.locator('#output-swagger pre').textContent()), JSON.parse(data.generatedFiles.find(file => file.path === 'swagger.json').content));
            console.log(`PASS: ${database} Professor Demo independently matches its own returned AST; existing inspectors work`);
        }

        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await tab.click();
            assert.equal(await tab.isVisible(), true);
            await tab.focus();
            assert.ok(await tab.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
            }), 'Diagram tab is reachable');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}px no page overflow`);
            assert.ok(await pane.locator('.schema-scroll').evaluate(element => element.clientWidth > 0 && element.clientWidth <= document.documentElement.clientWidth));
            // Scroll through every card without reducing readable text sizes.
            for (const card of await pane.locator('.schema-entity').all()) {
                await card.scrollIntoViewIfNeeded();
                assert.ok(await card.evaluate(element => parseFloat(getComputedStyle(element.querySelector('h3')).fontSize) >= 16));
            }
            await pane.locator('.schema-scroll').evaluate(element => { element.scrollLeft = 0; });
            await page.locator('.output-content').evaluate(element => { element.scrollTop = 0; });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(process.env.APIFORGE_DIAGRAM_EVIDENCE || os.tmpdir(), `schema-diagram-${width}.png`), fullPage: true });
            console.log(`PASS: ${width}px reachable tab, readable cards and internal scrolling without page overflow`);
        }
        const longName = 'Entity' + 'x'.repeat(42), longField = 'field' + 'y'.repeat(43);
        const longData = await compileSource(`ENTITY ${longName}\nid INT PRIMARY KEY\n${longField} STRING REQUIRED`);
        await matchesAST(longData);
        assert.ok(await pane.locator('.schema-field-name').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)), 'Long identifiers stay inside their cards');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        console.log('PASS: long legal entity/field identifiers remain contained at 390px');

        for (const [button, title] of [[demo, 'Demo ready'], [example, 'Ready to compile'], [clear, 'No compilation yet']]) {
            await compileSource(SIMPLE);
            await button.click();
            await reset(title);
        }
        await compileSource(SIMPLE);
        await editor.fill('ENTITY Broken\nvalue UNKNOWN');
        const failure = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await compile.click();
        assert.equal((await (await failure).json()).success, false);
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        assert.equal(await pane.locator('.schema-entity, .schema-relation').count(), 0);
        assert.match(await pane.locator('.empty-state strong').textContent(), /failure/);
        // Semantic failures return a partial AST, which must not publish a diagram.
        await editor.fill('ENTITY Broken\nid INT PRIMARY KEY\nRELATION Broken USES Missing ONE_TO_MANY');
        const semanticFailure = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await compile.click();
        const partial = await (await semanticFailure).json();
        assert.equal(partial.success, false);
        assert.ok(partial.ast);
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
        assert.equal(await pane.locator('.schema-entity').count(), 0);

        // Delay actual server responses across each invalidating action.
        for (const [button, title] of [[demo, 'Demo ready'], [example, 'Ready to compile'], [clear, 'No compilation yet'], [target('MySQL'), 'Target changed']]) {
            await compileSource(SIMPLE);
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
            await reset('Compilation running');
            await button.click();
            await reset(title);
            releaseResponse();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await reset(title);
            await page.unroute('**/api/compile');
        }
        console.log('PASS: Load demo/example, Clear, target change, running/failed compilation and delayed stale responses clear the diagram');

        // Isolate only the new renderer, including malformed data and hostile text.
        const safety = await page.evaluate(() => {
            const root = document.createElement('div');
            const inputs = [null, undefined, {}, { entities: {} }, { entities: [] },
                { entities: [null, {}, { name: 'Incomplete', fields: [null, {}, { name: 'state', dataType: 'ENUM' }] }], relations: [null, {}, { name: 42 }] }];
            for (const input of inputs) root.innerHTML = renderSchemaDiagram(input);
            const hostile = '<img src=x onerror="throw Error(\'unsafe\')">';
            root.innerHTML = renderSchemaDiagram({ entities: [{ name: hostile, fields: [{ name: hostile, dataType: 'ENUM', enumValues: [hostile], constraints: ['REQUIRED', 'FAKE'] }] }],
                relations: [{ sourceEntity: hostile, targetEntity: hostile, name: hostile, relationType: hostile }] });
            const escaped = !root.querySelector('img') && root.querySelector('.schema-entity-name').textContent === hostile
                && root.querySelector('.schema-relation').dataset.source === hostile && root.querySelector('.schema-constraint').textContent === 'REQUIRED'
                && root.querySelectorAll('.schema-constraint').length === 1 && root.querySelectorAll('.schema-connector').length === 1;
            root.innerHTML = renderSchemaDiagram({ entities: [{ name: 'Present', fields: 'bad' }], relations: [{ name: 'REF', sourceEntity: 'Present', targetEntity: 'Absent', relationType: 'ONE_TO_MANY' }] });
            const unknownEndpoint = root.querySelectorAll('.schema-entity').length === 1 && root.querySelectorAll('.schema-connector').length === 0
                && root.textContent.includes('Endpoint unavailable');
            root.innerHTML = renderSchemaDiagram(null);
            return { escaped, unknownEndpoint, empty: root.textContent.includes('No schema diagram available.') };
        });
        assert.deepEqual(safety, { escaped: true, unknownEndpoint: true, empty: true });
        assert.deepEqual(errors, [], 'No uncaught browser errors');
        console.log('PASS: malformed/incomplete input, missing endpoints, self-relation, HTML escaping and no uncaught browser errors');
    } finally {
        if (releaseResponse) releaseResponse();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
