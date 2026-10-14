'use strict';
const assert = require('node:assert/strict');
// Use the same visible workspace controls as a user; never reveal hidden panels.
async function workspace(page, view) {
    if (await page.locator('dialog:modal').count() && await page.locator('.ide-sidebar [data-workspace="' + view + '"]').getAttribute('aria-current') === 'page') return;
    await page.locator('.ide-sidebar [data-workspace="' + view + '"]').click();
    await page.locator('.ide-sidebar [data-workspace="' + view + '"][aria-current="page"]').waitFor();
}
async function clickIn(page, view, control) { await workspace(page, view); await control.click(); }
async function enterSource(page, source) { await workspace(page, 'editor'); await page.locator('#dsl-editor').fill(source); }
async function enterName(page, value) { await workspace(page, 'projects'); await page.locator('#project-name').fill(value); }
async function saveDialog(page) {
    await page.locator('#ide-save').click();
    await page.locator('#ide-save-dialog').waitFor();
    await page.locator('#ide-save-form button[type="submit"]').click();
}

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./frontend-persistent-runtime-server');
const { fail } = require('../src/persistent-runtime/errors');
const SOURCE = 'ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED';
const TABS = ['tokens', 'ast', 'diagram', 'symboltable', 'ir', 'optimized-ir', 'sql', 'endpoints', 'live-api', 'api', 'swagger'];
const results = [], servers = new Set(), releases = new Set();
let browser;
function fixture() {
    const records = new Map(), states = new Map(), errors = {}, hooks = {}, calls = [];
    let active = null;
    const hash = text => crypto.createHash('sha256').update(text).digest('hex');
    function make(input, id = crypto.randomUUID(), revision = 1) {
        const value = { id, ...input, revision, sourceHash: hash(input.source), createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z' };
        records.set(id, value); return { ...value };
    }
    const store = { storeId: crypto.randomUUID(), close() {},
        async createProject(input) { return make(input); },
        async saveProject(id, revision, changes) { assert.equal(records.get(id).revision, revision); return make({ ...records.get(id), ...changes }, id, revision + 1); },
        async getProject(id) { return { ...records.get(id) }; },
        async listProjects() { return [...records.values()].map(({ source, ...value }) => value); }
    };
    const summary = (input, state) => ({ formatVersion: 1, projectId: input.projectId, target: input.target, revision: input.expectedRevision, state });
    async function action(kind, input) { calls.push({ kind, input }); await hooks[kind]?.(input); if (errors[kind]) fail(errors[kind]); }
    const manager = {
        async status(input) { await action('status', input); return summary(input, states.get(input.projectId) || 'absent'); },
        async initialize(input) { await action('initialize', input); states.set(input.projectId, 'stopped'); return summary(input, 'stopped'); },
        async start(input) { await action('start', input); active = { input, id: crypto.randomBytes(32).toString('hex') }; states.set(input.projectId, 'running'); return { ...summary(input, 'running'), sessionId: active.id, endpointCount: 5 }; },
        async stop(input) { await action('stop', input); assert.equal(input.sessionId, active.id); states.set(active.input.projectId, 'stopped'); active = null; return { formatVersion: 1, state: 'stopped' }; },
        async request(input) { await action('request', input); assert.equal(input.sessionId, active.id); return { success: true, status: input.method === 'POST' ? 201 : 200,
            headers: { 'content-type': 'application/json', 'x-total-count': '1' }, body: hooks.response || { data: { id: 1, name: 'retained' } }, durationMs: 12 }; },
        async shutdown() {}
    };
    return { storeApi: { initializeProjectStore: async () => store, openProjectStore: async () => store }, manager,
        records, states, errors, hooks, calls, make, count: kind => calls.filter(call => call.kind === kind).length };
}
async function test(name, action) {
    try { await action(); results.push({ name, status: 'PASS' }); console.log('BROWSER CONTROLLED PASS ' + name); }
    catch (error) { results.push({ name, status: 'FAIL', reason: error.message }); throw error; }
}
async function setup({ target = 'mysql', saved = true, enabled = true } = {}) {
    const f = fixture(), project = saved ? f.make({ name: 'Saved ' + target, target, source: SOURCE }) : null;
    const server = await serve({ ...f, enabled }); servers.add(server);
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.tokens = []; page.consoleText = [];
    page.on('response', async response => {
        if (response.url().endsWith('/api/persistent/session') || response.url().endsWith('/api/projects/session')) {
            try { const envelope = await response.json(); if (envelope.data?.token) page.tokens.push(envelope.data.token); } catch {}
        }
    });
    page.on('console', event => page.consoleText.push(event.text()));
    page.failures = []; page.on('pageerror', error => page.failures.push(error.message));
    await page.goto(server.origin); await idle(page);
    assert.equal(server.calls.length, 0, 'Initial load issues no API requests');
    if (project) await open(page, project.id);
    await openPersistent(page);
    await choose(page, 'reconnect');
    return { f, page, server, project };
}
async function idle(page) { await page.waitForFunction(() => document.querySelector('.persistent-card')?.getAttribute('aria-busy') === 'false'); }
async function openPersistent(page) {
    await workspace(page, 'persistent');
    assert(await page.locator('#persistent-panel').isVisible());
}
async function choose(page, action) { await workspace(page, 'persistent'); await page.locator('#persistent-' + action).click(); await idle(page); }
async function open(page, id) {
    await clickIn(page, 'projects', page.locator('#project-open'));
    const button = page.locator('#project-list button[data-project-id="' + id + '"]'); await button.click();
    await page.waitForFunction(() => !document.querySelector('#project-dialog').open);
}
async function initialize(page, accept = true) {
    const pending = page.waitForEvent('dialog'), click = page.locator('#persistent-initialize').click();
    const dialog = await pending; assert.match(dialog.message(), /imported once/); assert.match(dialog.message(), /distinct from Initialize Storage/);
    if (process.env.APIFORGE_M2DB_EVIDENCE) fs.writeFileSync(path.join(process.env.APIFORGE_M2DB_EVIDENCE, 'initialization-confirmation-' + (accept ? 'accepted' : 'cancelled') + '.json'),
        JSON.stringify({ browser: 'Chromium', type: dialog.type(), message: dialog.message(), accepted: accept }, null, 2));
    if (accept) await dialog.accept(); else await dialog.dismiss(); await click; await idle(page);
}
async function running(context) { context.f.states.set(context.project.id, 'stopped'); await choose(context.page, 'refresh'); await choose(context.page, 'run'); }
async function endpoint(page, method, itemPath) {
    await page.locator('#persistent-endpoint').selectOption({ label: method + ' ' + itemPath });
    if (itemPath.includes('{id}')) await page.getByLabel('Path parameter: id', { exact: true }).fill('1');
}
async function screenshot(page, name) {
    if (process.env.APIFORGE_M2DB_EVIDENCE) {
        const folder = path.resolve(process.env.APIFORGE_M2DB_EVIDENCE); fs.mkdirSync(folder, { recursive: true });
        await page.screenshot({ path: path.join(folder, name + '.png'), fullPage: true });
    }
}
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); releases.add(release); return { promise, release: () => { releases.delete(release); release(); } }; }
async function main() {
    browser = await chromium.launch({ headless: true });
    await test('exact eleven published tabs and panels retain order, relationships and keyboard activation', async () => {
        const { page, f } = await setup({ saved: false });
        await workspace(page, 'inspector');
        const tabs = page.getByRole('tab');
        assert.deepEqual(await tabs.evaluateAll(values => values.map(value => value.dataset.tab)), TABS);
        assert.deepEqual(await page.getByRole('tabpanel', { includeHidden: true }).evaluateAll(values => values.map(value => value.id)), TABS.map(id => 'output-' + id));
        for (const id of TABS) {
            assert.equal(await page.locator('#tab-' + id).getAttribute('aria-controls'), 'output-' + id);
            assert.equal(await page.locator('#output-' + id).getAttribute('aria-labelledby'), 'tab-' + id);
        }
        assert.equal(await page.locator('[role="tablist"] #persistent-launcher, .tab-btn#persistent-launcher').count(), 0);
        await page.locator('#tab-tokens').focus(); await page.keyboard.press('End');
        assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home'); assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        await page.locator('#tab-live-api').focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#tab-api').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#tab-live-api').getAttribute('aria-selected'), 'true');
        assert.equal(f.calls.length, 0);
        await screenshot(page, 'eleven-tab-contract');
    });
    await test('independent disclosure is keyboard accessible; opening and closing issue no API calls or implicit Stop', async () => {
        const c = await setup(), { page, server, f } = c;
        await page.locator('#persistent-disclosure').click();
        assert(!await page.locator('#persistent-panel').isVisible());
        await page.waitForFunction(() => document.querySelector('#persistent-launcher').getAttribute('aria-expanded') === 'false');
        assert.equal(await page.locator('#persistent-launcher').getAttribute('aria-expanded'), 'false');
        const initialCalls = [...server.calls];
        await page.locator('#persistent-disclosure').focus(); await page.keyboard.press('Enter');
        assert(await page.locator('#persistent-panel').isVisible());
        await page.waitForFunction(() => document.querySelector('#persistent-launcher').getAttribute('aria-expanded') === 'true');
        assert.equal(await page.getByRole('region', { name: /Persistent API/ }).count(), 1);
        await page.locator('[data-workspace="projects"]').focus(); await page.keyboard.press('Enter');
        assert.match(await page.locator('#persistent-launcher').ariaSnapshot(), /button .*Persistent API.*expanded/);
        await page.locator('[data-workspace="persistent"]').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#persistent-disclosure').evaluate(value => value.tagName), 'SUMMARY');
        assert(await page.locator('#persistent-disclosure').evaluate(value => value.matches(':focus-visible') && getComputedStyle(value).outlineStyle !== 'none'));
        await screenshot(page, 'disclosure-keyboard-focus');
        await page.keyboard.press('Space'); assert(!await page.locator('#persistent-panel').isVisible());
        await workspace(page, 'projects'); await page.locator('#persistent-launcher').focus(); await page.keyboard.press('Enter');
        assert(await page.locator('#persistent-panel').isVisible());
        assert(await page.locator('#persistent-disclosure').evaluate(value => value === document.activeElement && value.matches(':focus-visible') && getComputedStyle(value).outlineStyle !== 'none'));
        assert.deepEqual(server.calls, initialCalls);
        await running(c); const runningCalls = [...server.calls], ownedText = await page.locator('#persistent-owned').textContent();
        await page.locator('#persistent-disclosure').click(); assert(!await page.locator('#persistent-panel').isVisible());
        await clickIn(page, 'inspector', page.locator('#tab-endpoints')); await openPersistent(page);
        assert.deepEqual(server.calls, runningCalls); assert.equal(f.count('stop'), 0);
        assert.equal(await page.locator('#persistent-owned').textContent(), ownedText);
        assert.match(await page.locator('#persistent-status').textContent(), /Database\/runtime: running/);
        await choose(page, 'stop'); assert.equal(f.count('stop'), 1);
    });
    await test('contained independent panel preserves usable editor and compiler actions at shorter desktop heights', async () => {
        const { page, f } = await setup();
        for (const height of [768, 640]) {
            await page.setViewportSize({ width: 1440, height });
            assert(await page.locator('#dsl-editor').evaluate(value => value.getBoundingClientRect().height >= 120));
            assert(await page.evaluate(() => {
                const panel = document.querySelector('#persistent-workspace').getBoundingClientRect();
                return ['.editor-panel', '.output-panel'].every(selector => document.querySelector(selector).getBoundingClientRect().bottom <= panel.top);
            }));
            assert(!await page.locator('#compile-btn').isDisabled());
            assert(!await page.locator('#clear-btn').isDisabled());
        }
        await clickIn(page, 'editor', page.locator('#compile-btn'));
        await page.waitForFunction(() => document.querySelector('#compilation-summary-content').textContent.includes('entity'));
        await clickIn(page, 'inspector', page.locator('#tab-endpoints')); assert.match(await page.locator('#output-endpoints').textContent(), /GET.*\/items/s);
        assert.equal(f.calls.length, 0); await screenshot(page, 'short-desktop-independent-panel');
    });
    await test('empty workspace editable; no status or mutation on load; reload remains explicit', async () => {
        const { page, f } = await setup({ saved: false });
        assert.equal(await page.locator('#dsl-editor').inputValue(), ''); await enterSource(page, SOURCE);
        assert.equal(f.calls.length, 0); assert(await page.locator('#persistent-run').isDisabled()); assert(await page.locator('#persistent-initialize').isDisabled());
        await screenshot(page, 'empty-desktop'); await page.reload(); await idle(page); assert.equal(f.calls.length, 0);
    });
    await test('disabled backend guidance leaves compiler and project UX operational', async () => {
        const { page, f } = await setup({ enabled: false, saved: false });
        assert.match(await page.locator('#persistent-message').textContent(), /APIFORGE_PERSISTENT_RUNNER=1/);
        await enterSource(page, SOURCE); await clickIn(page, 'editor', page.locator('#compile-btn'));
        await page.waitForFunction(() => document.querySelector('#compilation-summary-content').textContent.includes('entity'));
        await openPersistent(page); await screenshot(page, 'disabled'); assert.equal(f.calls.length, 0);
    });
    await test('missing or unreachable persistent API keeps setup guidance and never opens storage', async () => {
        const { page, f } = await setup({ saved: false });
        await page.route('**/api/persistent/session', route => route.fulfill({ status: 404, contentType: 'text/html', body: 'Missing route' }));
        await choose(page, 'reconnect'); assert.match(await page.locator('#persistent-message').textContent(), /local server version.*APIFORGE_PERSISTENT_RUNNER=1/);
        await page.unroute('**/api/persistent/session'); await page.route('**/api/persistent/session', route => route.abort('failed'));
        await choose(page, 'reconnect'); assert.match(await page.locator('#persistent-message').textContent(), /CLIENT_NETWORK/);
        assert.equal(f.calls.length, 0); assert(!await page.locator('#dsl-editor').isDisabled());
    });
    for (const target of ['mysql', 'postgres']) await test(target + ' acknowledged saved selection checks status; confirmation cancellation is inert; initialize/run/CRUD/Stop', async () => {
        const c = await setup({ target }), { page, f, project } = c;
        assert.equal(f.count('status'), 0); await choose(page, 'refresh');
        assert.deepEqual(f.calls.at(-1).input, { projectId: project.id, target, expectedRevision: 1 });
        assert.match(await page.locator('#persistent-status').textContent(), /absent/); await screenshot(page, target + '-absent');
        await initialize(page, false); assert.equal(f.count('initialize'), 0);
        await initialize(page); assert.equal(f.count('initialize'), 1); assert.match(await page.locator('#persistent-status').textContent(), /stopped/);
        await screenshot(page, target + '-stopped'); await choose(page, 'run');
        assert.equal(f.count('start'), 1); assert(!await page.locator('#persistent-send').isDisabled()); assert.equal(await page.locator('#persistent-endpoint option').count(), 5);
        await screenshot(page, target + '-running');
        for (const [method, itemPath] of [['GET','/items'],['POST','/items'],['PUT','/items/{id}'],['DELETE','/items/{id}']]) {
            await endpoint(page, method, itemPath); if (['POST','PUT'].includes(method)) await page.locator('#persistent-body').fill('{"name":"test"}');
            await choose(page, 'send'); assert.equal(f.calls.at(-1).input.method, method); assert.match(await page.locator('#persistent-response').textContent(), /HTTP (200|201).*12 ms/);
        }
        await screenshot(page, target + '-crud'); const sessionId = f.calls.at(-1).input.sessionId;
        await enterSource(page, 'invalid unsaved source');
        assert.match(await page.locator('#persistent-draft').textContent(), /acknowledged saved revision/);
        await choose(page, 'stop'); assert.deepEqual(f.calls.at(-1).input, { sessionId }); assert.match(await page.locator('#persistent-message').textContent(), /records are retained/);
        assert.equal(f.count('initialize'), 1); await choose(page, 'run'); assert.equal(f.count('start'), 2);
        await choose(page, 'stop'); assert.deepEqual(page.failures, []);
    });
    await test('JSON/path/query constraints and response XSS safety', async () => {
        const c = await setup(); await running(c); const { page, f } = c;
        await endpoint(page, 'POST', '/items'); await page.locator('#persistent-body').fill('{bad'); await choose(page, 'send'); assert.equal(f.count('request'), 0);
        await page.locator('#persistent-body').fill('[]'); await choose(page, 'send'); assert.equal(f.count('request'), 0);
        await endpoint(page, 'GET', '/items/{id}');
        for (const value of ['', '..', 'a/b', 'a%2fb', 'a b', 'x?y']) { await page.locator('#persistent-param-0').fill(value); await choose(page, 'send'); assert.equal(f.count('request'), 0); }
        await page.locator('#persistent-param-0').fill('a&b');
        for (const value of ['https://evil.example', 'x=%zz', 'x=%00', 'x=1#bad', 'x=1 y=2']) { await page.locator('#persistent-query').fill(value); await choose(page, 'send'); assert.equal(f.count('request'), 0); }
        await page.locator('#persistent-query').fill('?limit=20&page=1');
        f.hooks.response = '<img src=x onerror="window.injected=true"><script>window.injected=true</script>';
        await choose(page, 'send'); assert.equal(f.calls.at(-1).input.path, '/items/a%26b?limit=20&page=1');
        assert.equal(await page.locator('#persistent-response img, #persistent-response script').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
    });
    await test('saved-source operations ignore unrelated compiler output and unsaved draft target', async () => {
        const c = await setup(); const { page, f, project } = c;
        await enterSource(page, 'ENTITY Other\nid INT PRIMARY KEY'); await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
        await clickIn(page, 'editor', page.locator('#compile-btn')); await openPersistent(page); await running(c);
        assert.deepEqual(f.calls.find(call => call.kind === 'start').input, { projectId: project.id, target: 'mysql', expectedRevision: 1 });
        assert((await page.locator('#persistent-endpoint option').allTextContents()).every(text => text.includes('/items'))); assert.equal(f.count('initialize'), 0);
    });
    await test('saving a new revision invalidates status; revision mismatch refuses migration; old Stop survives', async () => {
        const c = await setup(); await running(c); const { page, f } = c;
        await enterName(page, 'Renamed'); await saveDialog(page);
        await page.waitForFunction(() => document.querySelector('#project-revision').textContent === 'Revision 2');
        assert(await page.locator('#persistent-run').isDisabled()); assert(await page.locator('#persistent-send').isDisabled()); assert(!await page.locator('#persistent-stop').isDisabled());
        f.errors.status = 'PERSISTENT_REVISION_MISMATCH'; await choose(page, 'refresh');
        assert.match(await page.locator('#persistent-message').textContent(), /Automatic schema migration is refused/); await screenshot(page, 'revision-mismatch');
        await choose(page, 'stop'); assert.equal(f.count('initialize'), 0);
    });
    await test('project switch retains exact old owned session; late Start cannot overwrite new selection', async () => {
        const c = await setup(); const { page, f, project } = c; f.states.set(project.id, 'stopped'); await choose(page, 'refresh');
        const wait = gate(); f.hooks.start = () => wait.promise;
        await page.locator('#persistent-run').click(); await page.waitForFunction(() => document.querySelector('#persistent-status').textContent.includes('starting'));
        while (!f.count('start')) await new Promise(resolve => setTimeout(resolve, 10));
        const other = f.make({ name: 'Other saved project', target: 'postgres', source: SOURCE }); await open(page, other.id);
        wait.release(); await idle(page); await openPersistent(page);
        assert.equal(await page.locator('#persistent-project').textContent(), other.name); assert.match(await page.locator('#persistent-owned').textContent(), /previous selection/);
        assert(!/Database\/runtime: running/.test(await page.locator('#persistent-status').textContent()));
        assert(await page.locator('#persistent-run').isDisabled()); await choose(page, 'stop');
        assert.equal(f.count('stop'), 1); assert.equal(f.states.get(project.id), 'stopped'); assert.equal(f.states.get(other.id), undefined);
    });
    await test('late status and request responses cannot overwrite a newer project', async () => {
        const c = await setup(); const { page, f } = c; await running(c);
        const wait = gate(); f.hooks.request = () => wait.promise; await page.locator('#persistent-send').click();
        const other = f.make({ name: 'Next', target: 'mysql', source: SOURCE }); await open(page, other.id); wait.release(); await idle(page);
        assert.equal(await page.locator('#persistent-response').textContent(), ''); assert.equal(await page.locator('#persistent-project').textContent(), 'Next');
        const statusWait = gate(); f.hooks.status = () => statusWait.promise; await openPersistent(page); await page.locator('#persistent-refresh').click();
        await open(page, c.project.id); statusWait.release(); await idle(page);
        assert.match(await page.locator('#persistent-status').textContent(), /not currently verified/); await openPersistent(page); await choose(page, 'stop');
    });
    await test('token invalidation requires explicit reconnect with no mutation replay', async () => {
        const c = await setup(); await running(c); const { page, f } = c;
        await page.route('**/api/persistent/request', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'PERSISTENT_TOKEN_INVALID', message: 'PRIVATE_SECRET' } }) }));
        await choose(page, 'send'); assert.match(await page.locator('#persistent-message').textContent(), /Reconnect Persistent API/);
        const starts = f.count('start'); await choose(page, 'reconnect'); assert.equal(f.count('start'), starts); assert.equal(f.count('request'), 0);
        assert(!await page.locator('#persistent-stop').isDisabled()); assert(await page.locator('#persistent-send').isDisabled());
    });
    await test('failed reconnect invalidates old running status while retaining known session identity', async () => {
        const c = await setup(); await running(c);
        await c.page.route('**/api/persistent/session', route => route.abort('failed'));
        await choose(c.page, 'reconnect');
        assert.match(await c.page.locator('#persistent-status').textContent(), /not currently verified.*Last acknowledged state: running/);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
        assert(await c.page.locator('#persistent-send').isDisabled()); assert.equal(c.f.count('start'), 1); assert.equal(c.f.count('stop'), 0);
        await c.page.unroute('**/api/persistent/session'); await choose(c.page, 'reconnect'); await choose(c.page, 'refresh');
        assert(!await c.page.locator('#persistent-send').isDisabled()); await choose(c.page, 'stop');
    });
    for (const action of ['initialize', 'start', 'stop', 'request']) await test('unknown ' + action + ' outcome preserves uncertainty; no replay on reconnect or inspection', async () => {
        const c = await setup(); const { page, f } = c;
        if (['stop','request'].includes(action)) await running(c); else { f.states.set(c.project.id, action === 'start' ? 'stopped' : 'absent'); await choose(page, 'refresh'); }
        let attempts = 0; await page.route('**/api/persistent/' + action, route => { attempts++; return route.abort('failed'); });
        if (action === 'initialize') await initialize(page); else await choose(page, action === 'start' ? 'run' : action === 'request' ? 'send' : 'stop');
        assert.match(await page.locator('#persistent-message').textContent(), /may have succeeded.*unconfirmed/);
        assert.match(await page.locator('#persistent-status').textContent(), /not currently verified/);
        await screenshot(page, 'network-' + action); await choose(page, 'reconnect'); await choose(page, 'refresh'); assert.equal(attempts, 1);
        if (action === 'initialize') assert(await page.locator('#persistent-initialize').isDisabled());
        if (action === 'stop') assert(!await page.locator('#persistent-stop').isDisabled());
    });
    for (const code of ['PERSISTENT_ALREADY_INITIALIZED','PERSISTENT_DATABASE_COLLISION','PERSISTENT_INCOMPLETE','PERSISTENT_PROVISION_UNCERTAIN']) await test(code + ' preserves initialization refusal', async () => {
        const c = await setup(); await choose(c.page, 'refresh'); c.f.errors.initialize = code; await initialize(c.page);
        assert.match(await c.page.locator('#persistent-message').textContent(), new RegExp(code)); assert.equal(c.f.count('initialize'), 1);
        assert(await c.page.locator('#persistent-initialize').isDisabled()); assert(await c.page.locator('#persistent-run').isDisabled());
    });
    await test('cleanup failure retains owned Stop and refuses replacement; busy/ownership uncertainty remain errors', async () => {
        const c = await setup(); await running(c); c.f.errors.stop = 'PERSISTENT_CLEANUP_FAILED'; await choose(c.page, 'stop');
        assert.match(await c.page.locator('#persistent-message').textContent(), /Ownership is retained/); assert(!await c.page.locator('#persistent-stop').isDisabled()); assert(await c.page.locator('#persistent-run').isDisabled());
        delete c.f.errors.stop; await choose(c.page, 'stop');
        for (const code of ['PERSISTENT_BUSY','PERSISTENT_CLAIM_UNCERTAIN','PERSISTENT_REVISION_MISMATCH']) {
            c.f.errors.start = code; c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'refresh'); await choose(c.page, 'run');
            assert.match(await c.page.locator('#persistent-message').textContent(), new RegExp(code)); assert(await c.page.locator('#persistent-run').isDisabled());
        }
    });
    await test('reload and unknown owned running/occupied status never fabricate a session; reopen stopped remains inspectable', async () => {
        const c = await setup(); await running(c); const starts = c.f.count('start'); await c.page.reload(); await idle(c.page); await open(c.page, c.project.id);
        c.f.states.set(c.project.id, 'occupied'); await openPersistent(c.page); await choose(c.page, 'reconnect'); await choose(c.page, 'refresh');
        assert.match(await c.page.locator('#persistent-owned').textContent(), /cannot reconstruct/); assert(await c.page.locator('#persistent-stop').isDisabled()); assert(await c.page.locator('#persistent-run').isDisabled());
        await screenshot(c.page, 'occupied'); assert.equal(c.f.count('start'), starts); assert.equal(c.f.count('stop'), 0);
        c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-run').isDisabled());
    });
    await test('project snapshot subscription is frozen, metadata-only and preserves New/Open/Save behavior', async () => {
        const { page } = await setup({ saved: false });
        assert.deepEqual(await page.evaluate(() => {
            const snapshot = projectWorkspace.snapshot();
            return { keys: Object.keys(snapshot).sort(), frozen: Object.isFrozen(snapshot), saved: snapshot.projectId };
        }), { keys: ['dirty','name','projectId','revision','target'], frozen: true, saved: null });
        await clickIn(page, 'projects', page.locator('#project-new')); await enterName(page, 'New acknowledged'); await enterSource(page, SOURCE);
        await saveDialog(page); await page.waitForFunction(() => document.querySelector('#project-status').textContent === 'Saved');
        assert.match(await page.locator('#persistent-project').textContent(), /New acknowledged/);
        assert.equal(await page.evaluate(() => projectWorkspace.snapshot().revision), 1);
        await enterSource(page, SOURCE + '\n'); assert.equal(await page.evaluate(() => projectWorkspace.snapshot().dirty), true);
    });
    await test('invalid acknowledgments, UTF-8, headers and unavailable saved OpenAPI fail closed', async () => {
        const c = await setup(); await choose(c.page, 'refresh'); c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'refresh');
        await c.page.route('**/api/projects/' + c.project.id, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"source":"UNTRUSTED"}}' }));
        await choose(c.page, 'run'); assert(await c.page.locator('#persistent-send').isDisabled()); assert(!await c.page.locator('#persistent-stop').isDisabled()); await choose(c.page, 'stop');
        await c.page.route('**/api/persistent/start', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { formatVersion: 1, projectId: c.project.id, target: 'mysql', revision: 1, state: 'running', sessionId: 'guessed', endpointCount: 5 } }) }));
        await choose(c.page, 'run'); assert.match(await c.page.locator('#persistent-message').textContent(), /unconfirmed/); assert(await c.page.locator('#persistent-stop').isDisabled());
        await c.page.route('**/api/persistent/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: Buffer.from([0xff]) }));
        await choose(c.page, 'refresh'); assert.match(await c.page.locator('#persistent-message').textContent(), /unexpected UTF-8/);
    });
    await test('independent panel labels, responsive layout, project-name XSS and no token persistence/leakage', async () => {
        const c = await setup(); await running(c); const { page, f } = c;
        assert.equal(await page.locator('#persistent-launcher').getAttribute('aria-controls'), 'persistent-workspace');
        assert.equal(await page.locator('#persistent-panel').getAttribute('aria-labelledby'), 'persistent-disclosure');
        for (const name of ['Generated endpoint (saved revision)','Query components (optional)']) assert.equal(await page.getByLabel(name, { exact: true }).count(), 1);
        assert.equal(await page.locator('#persistent-status').getAttribute('aria-live'), 'polite');
        f.hooks.response = { data: 'long-response-'.repeat(8000) }; await choose(page, 'send');
        await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'mobile-running-response');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const other = f.make({ name: '<img src=x onerror=alert(1)> ' + 'long'.repeat(20), target: 'mysql', source: SOURCE }); await open(page, other.id); await openPersistent(page);
        assert.equal(await page.locator('#persistent-project img').count(), 0); await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'mobile-long-project');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await choose(page, 'stop');
        const token = f.calls.find(call => call.kind === 'stop').input.sessionId;
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0); assert.equal((await page.context().cookies()).length, 0);
        const html = await page.content();
        for (const secret of [...page.tokens, token]) {
            assert(!html.includes(secret)); assert(!page.url().includes(secret)); assert(!page.consoleText.join('\n').includes(secret));
        }
        assert.deepEqual(page.failures, []);
    });
    await test('Persistent API state survives compiler reset; existing output panels remain usable', async () => {
        const c = await setup(); await running(c); const { page } = c;
        const compilation = page.waitForResponse(response => response.url().endsWith('/api/compile'));
        await clickIn(page, 'editor', page.locator('#compile-btn')); await compilation;
        await clickIn(page, 'inspector', page.locator('#tab-endpoints')); assert.match(await page.locator('#output-endpoints').textContent(), /GET.*\/items/s);
        await clickIn(page, 'inspector', page.locator('#tab-diagram')); assert.match(await page.locator('#output-diagram').textContent(), /Item/);
        await openPersistent(page); assert.match(await page.locator('#persistent-status').textContent(), /running/);
        await enterSource(page, 'bad source'); assert.match(await page.locator('#persistent-status').textContent(), /running/);
        assert(!await page.locator('#persistent-stop').isDisabled());
    });
    await test('disposable Live API controls stay independent of the persistent disclosure and owned session', async () => {
        const c = await setup(); await running(c); const { page, f } = c;
        const liveCalls = [], liveSession = crypto.randomBytes(32).toString('hex');
        await page.route('**/api/live/**', async route => {
            const action = route.request().url().split('/').at(-1); liveCalls.push(action);
            const data = action === 'start' ? { sessionId: liveSession, expiresAt: new Date(Date.now() + 900000).toISOString() } :
                action === 'request' ? { status: 200, headers: { 'content-type': 'application/json' }, body: { data: 'disposable fixture' }, durationMs: 1 } : { stopped: true };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...data }) });
        });
        await clickIn(page, 'editor', page.locator('#compile-btn')); await page.waitForFunction(() => document.querySelector('#compilation-summary-content').textContent.includes('entity'));
        await clickIn(page, 'inspector', page.locator('#tab-live-api')); await clickIn(page, 'inspector', page.locator('#live-start'));
        await page.waitForFunction(() => document.querySelector('#live-status').textContent === 'Running');
        await clickIn(page, 'persistent', page.locator('#persistent-disclosure')); await openPersistent(page);
        assert.deepEqual(liveCalls, ['start']); assert.equal(f.count('stop'), 0);
        await clickIn(page, 'inspector', page.locator('#live-send')); await page.waitForFunction(() => document.querySelector('#live-response').textContent.includes('disposable fixture'));
        await clickIn(page, 'inspector', page.locator('#live-stop')); await page.waitForFunction(() => document.querySelector('#live-status').textContent === 'Stopped / expired');
        assert.deepEqual(liveCalls, ['start', 'request', 'stop']);
        assert.match(await page.locator('#persistent-status').textContent(), /Database\/runtime: running/);
        await choose(page, 'stop'); assert.equal(f.count('stop'), 1);
    });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    releases.forEach(release => release()); await browser?.close(); await Promise.all([...servers].map(server => server.stop()));
    const report = { evidence: 'Real Chromium browser, controlled Project Store and persistent manager; no native database certification.', results,
        counts: results.reduce((counts, result) => (counts[result.status] = (counts[result.status] || 0) + 1, counts), {}) };
    if (process.env.APIFORGE_M2DB_EVIDENCE) fs.writeFileSync(path.join(process.env.APIFORGE_M2DB_EVIDENCE, 'frontend-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.counts));
});
