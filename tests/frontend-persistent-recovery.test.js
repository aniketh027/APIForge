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
        if (response.url().endsWith('/api/persistent/session') || response.url().endsWith('/api/projects/session') || response.url().endsWith('/api/persistent/start')) {
            try { const envelope = await response.json(); if (envelope.data?.token) page.tokens.push(envelope.data.token); if (envelope.data?.sessionId) page.tokens.push(envelope.data.sessionId); } catch {}
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
async function running(context) { context.f.states.set(context.project.id, 'stopped'); await choose(context.page, 'refresh'); await choose(context.page, 'run'); }
async function screenshot(page, name) {
    if (process.env.APIFORGE_M2DC_EVIDENCE) {
        const folder = path.resolve(process.env.APIFORGE_M2DC_EVIDENCE); fs.mkdirSync(folder, { recursive: true });
        await page.screenshot({ path: path.join(folder, name + '.png'), fullPage: true });
        if (['running', 'occupied-refused', 'verified-stopped-stale', 'confirmation-cancelled', 'memory-discarded', 'disconnected', 'keyboard-focus'].includes(name)) {
            const viewport = page.viewportSize(), position = await page.evaluate(() => ({ x: scrollX, y: scrollY, top: document.querySelector('#persistent-panel').scrollTop }));
            await page.setViewportSize({ width: 390, height: 844 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: path.join(folder, name + '-mobile.png'), fullPage: true });
            await page.locator('#persistent-forget').scrollIntoViewIfNeeded();
            const bounds = await page.locator('#persistent-forget').evaluate(value => {
                const button = value.getBoundingClientRect(), panel = document.querySelector('#persistent-panel').getBoundingClientRect();
                return { button: button.toJSON(), panel: panel.toJSON() };
            });
            await page.screenshot({ path: path.join(folder, name + '-mobile-controls.png'), fullPage: true });
            assert(bounds.button.left >= bounds.panel.left && bounds.button.right <= bounds.panel.right && bounds.button.top >= bounds.panel.top && bounds.button.bottom <= bounds.panel.bottom + 1,
                'Mobile recovery control containment: ' + JSON.stringify(bounds));
            await page.setViewportSize(viewport);
            await page.evaluate(position => { document.querySelector('#persistent-panel').scrollTop = position.top; window.scrollTo(position.x, position.y); }, position);
        }
    }
}
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); releases.add(release); return { promise, release: () => { releases.delete(release); release(); } }; }

async function stale(c) {
    await running(c); c.f.states.set(c.project.id, 'stopped');
    await choose(c.page, 'reconnect'); await choose(c.page, 'refresh');
    assert(!await c.page.locator('#persistent-forget').isDisabled());
}
async function localSnapshot(page) {
    return page.evaluate(() => ({ owned: document.querySelector('#persistent-owned').textContent,
        status: document.querySelector('#persistent-status').textContent,
        message: document.querySelector('#persistent-message').textContent,
        response: document.querySelector('#persistent-response').innerHTML,
        builder: document.querySelector('#persistent-builder').innerHTML,
        run: document.querySelector('#persistent-run').disabled,
        stop: document.querySelector('#persistent-stop').disabled,
        forget: document.querySelector('#persistent-forget').disabled }));
}
async function confirmForget(c, accept) {
    await workspace(c.page, 'persistent');
    const dialogPromise = c.page.waitForEvent('dialog'), click = c.page.locator('#persistent-forget').click();
    const dialog = await dialogPromise;
    assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /only the ephemeral session reference/);
    assert.match(dialog.message(), /does not stop a process, change the database or server-side ownership/);
    assert.match(dialog.message(), /Refresh Status again/);
    if (process.env.APIFORGE_M2DC_EVIDENCE) fs.writeFileSync(path.join(process.env.APIFORGE_M2DC_EVIDENCE, 'forget-confirmation-' + (accept ? 'accepted' : 'cancelled') + '.json'),
        JSON.stringify({ type: dialog.type(), message: dialog.message(), accepted: accept }, null, 2));
    if (accept) await dialog.accept(); else await dialog.dismiss(); await click;
}
async function refused(c) {
    assert(await c.page.locator('#persistent-forget').isDisabled());
    const snapshot = await localSnapshot(c.page), calls = [...c.server.calls];
    await c.page.locator('#persistent-forget').evaluate(value => value.click());
    assert.deepEqual(await localSnapshot(c.page), snapshot); assert.deepEqual(c.server.calls, calls);
}
async function main() {
    browser = await chromium.launch({ headless: true });
    await test('empty draft, initial disclosure and reload never access network or recover', async () => {
        const f = fixture(), server = await serve(f); servers.add(server);
        const page = await browser.newPage(); await page.goto(server.origin); await idle(page);
        const c = { page, f, server }; assert.equal(server.calls.length, 0); await refused(c);
        await openPersistent(page); assert.equal(server.calls.length, 0);
        await page.reload(); await idle(page); assert.equal(server.calls.length, 0); await refused(c);
    });
    for (const state of ['running', 'occupied', 'incomplete', 'absent']) await test('known session plus ' + state + ' refuses forgetting and competing Run', async () => {
        const c = await setup(); await running(c); c.f.states.set(c.project.id, state); await choose(c.page, 'refresh');
        await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
        assert(await c.page.locator('#persistent-run').isDisabled()); assert.equal(c.f.count('stop'), 0);
        if (state === 'occupied') { assert.match(await c.page.locator('#persistent-forget-reason').textContent(), /separately reviewed operator/); await screenshot(c.page, 'occupied-refused'); }
        if (state === 'running') await screenshot(c.page, 'running');
    });
    await test('fresh validated stopped proof offers recovery for the exact known session', async () => {
        const c = await setup(); await stale(c); assert(await c.page.locator('#persistent-run').isDisabled());
        assert(!await c.page.locator('#persistent-stop').isDisabled()); await screenshot(c.page, 'verified-stopped-stale');
    });
    await test('confirmation cancellation preserves complete local state and sends zero HTTP requests', async () => {
        const c = await setup(); await running(c); await choose(c.page, 'send');
        c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'reconnect'); await choose(c.page, 'refresh');
        const before = await localSnapshot(c.page), calls = [...c.server.calls];
        await confirmForget(c, false); assert.deepEqual(await localSnapshot(c.page), before); assert.deepEqual(c.server.calls, calls);
        await screenshot(c.page, 'confirmation-cancelled');
    });
    await test('confirmation clears only local session, generated operations and response; fresh Status then explicit Run', async () => {
        const c = await setup(); await running(c); await choose(c.page, 'send');
        const records = JSON.stringify([...c.f.records]), states = JSON.stringify([...c.f.states]);
        c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'reconnect'); await choose(c.page, 'refresh');
        const calls = [...c.server.calls], managerCalls = [...c.f.calls], currentStates = JSON.stringify([...c.f.states]);
        const saved = await c.page.evaluate(() => projectWorkspace.snapshot());
        await confirmForget(c, true);
        assert.deepEqual(c.server.calls, calls); assert.deepEqual(c.f.calls, managerCalls);
        assert.equal(JSON.stringify([...c.f.records]), records); assert.equal(JSON.stringify([...c.f.states]), currentStates); assert.notEqual(states, currentStates);
        assert.deepEqual(await c.page.evaluate(() => projectWorkspace.snapshot()), saved);
        assert.equal(await c.page.locator('#persistent-endpoint option').count(), 0); assert.equal(await c.page.locator('#persistent-param-0').count(), 0);
        assert.equal(await c.page.locator('#persistent-response').textContent(), ''); assert(!await c.page.locator('#persistent-builder').isVisible());
        assert(await c.page.locator('#persistent-send').isDisabled()); assert(await c.page.locator('#persistent-stop').isDisabled());
        assert(await c.page.locator('#persistent-run').isDisabled()); assert(await c.page.locator('#persistent-forget').isDisabled());
        assert.match(await c.page.locator('#persistent-message').textContent(), /Only local browser session memory was discarded/);
        assert.equal(c.f.count('start'), 1); assert.equal(c.f.count('stop'), 0); await screenshot(c.page, 'memory-discarded');
        await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-run').isDisabled());
        assert.equal(c.f.count('start'), 1); await choose(c.page, 'run'); assert.equal(c.f.count('start'), 2);
        await choose(c.page, 'stop');
    });
    await test('Status network failure invalidates earlier stopped proof and preserves ownership', async () => {
        const c = await setup(); await stale(c); await c.page.route('**/api/persistent/status', route => route.abort('failed'));
        await choose(c.page, 'refresh'); await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
        assert.match(await c.page.locator('#persistent-message').textContent(), /CLIENT_NETWORK/);
    });
    for (const [name, change] of [
        ['project UUID', data => ({ ...data, projectId: crypto.randomUUID() })],
        ['target', data => ({ ...data, target: 'postgres' })],
        ['revision', data => ({ ...data, revision: 2 })],
        ['ambiguous extra field', data => ({ ...data, sessionId: 'not-a-proof' })],
        ['invalid state', data => ({ ...data, state: 'STOPPED' })],
        ['invalid format', data => ({ ...data, formatVersion: 2 })]
    ]) await test('invalid Status ' + name + ' refuses recovery', async () => {
        const c = await setup(); await stale(c);
        await c.page.route('**/api/persistent/status', route => route.fulfill({ json: { success: true, data: change({ formatVersion: 1, projectId: c.project.id, target: 'mysql', revision: 1, state: 'stopped' }) } }));
        await choose(c.page, 'refresh'); await refused(c); assert.match(await c.page.locator('#persistent-message').textContent(), /CLIENT_RESPONSE/);
    });
    await test('reconnect invalidates older stopped proof and never replays a mutation', async () => {
        const c = await setup(); await stale(c); const mutationCount = c.f.calls.filter(call => call.kind !== 'status').length;
        await choose(c.page, 'reconnect'); await refused(c); assert(await c.page.locator('#persistent-run').isDisabled());
        assert.equal(c.f.calls.filter(call => call.kind !== 'status').length, mutationCount);
        await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-forget').isDisabled());
    });
    await test('newer pending Status invalidates proof immediately; late status after offline cannot revive it', async () => {
        const c = await setup(); await stale(c); const wait = gate(); c.f.hooks.status = () => wait.promise;
        await c.page.locator('#persistent-refresh').click(); await c.page.waitForFunction(() => document.querySelector('.persistent-card').getAttribute('aria-busy') === 'true');
        assert(await c.page.locator('#persistent-forget').isDisabled()); await c.page.evaluate(() => window.dispatchEvent(new Event('offline')));
        wait.release(); await idle(c.page); await refused(c); assert(await c.page.locator('#persistent-run').isDisabled());
        await screenshot(c.page, 'disconnected');
    });
    await test('project switch retains previous owned session and forbids forgetting it under another identity', async () => {
        const c = await setup(); await stale(c); const other = c.f.make({ name: 'Other', target: 'postgres', source: SOURCE });
        await open(c.page, other.id); await refused(c); c.f.states.set(other.id, 'stopped'); await choose(c.page, 'refresh'); await refused(c);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /previous selection/);
        assert(!await c.page.locator('#persistent-stop').isDisabled()); await choose(c.page, 'stop'); assert.equal(c.f.count('stop'), 1);
    });
    await test('saving a new revision or target invalidates proof and keeps old Stop', async () => {
        for (const targetChange of [false, true]) {
            const c = await setup(); await stale(c);
            if (targetChange) await c.page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
            else await enterName(c.page, 'New saved name');
            await saveDialog(c.page); await c.page.waitForFunction(() => projectWorkspace.snapshot().revision === 2);
            await refused(c); await choose(c.page, 'refresh'); await refused(c);
            assert(!await c.page.locator('#persistent-stop').isDisabled()); await choose(c.page, 'stop');
        }
    });
    await test('late async status cannot offer recovery after switching away and back', async () => {
        const c = await setup(); await stale(c); const wait = gate(); c.f.hooks.status = () => wait.promise;
        await c.page.locator('#persistent-refresh').click(); await c.page.waitForFunction(() => document.querySelector('.persistent-card').getAttribute('aria-busy') === 'true');
        const other = c.f.make({ name: 'Other', target: 'mysql', source: SOURCE }); await open(c.page, other.id); await open(c.page, c.project.id);
        wait.release(); await idle(c.page); await refused(c); assert(await c.page.locator('#persistent-run').isDisabled());
    });
    await test('unsaved editor edits never mutate deployment; Stop still targets exact held session', async () => {
        const c = await setup(); await running(c);
        const before = [...c.f.calls]; await enterSource(c.page, 'invalid unsaved draft');
        assert.deepEqual(c.f.calls, before); await refused(c); await choose(c.page, 'stop');
        assert.equal(c.f.calls.at(-1).kind, 'stop');
        assert.deepEqual(c.f.calls.find(call => call.kind === 'start').input, { projectId: c.project.id, target: 'mysql', expectedRevision: 1 });
        assert.equal(c.f.count('initialize'), 0); assert.equal(c.f.count('start'), 1);
    });
    for (const error of ['PERSISTENT_CLEANUP_FAILED', 'PERSISTENT_SESSION_INVALID']) await test('uncertain/invalid Stop ' + error + ' retains session until authoritative stopped inspection', async () => {
        const c = await setup(); await running(c); c.f.errors.stop = error; await choose(c.page, 'stop');
        await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled()); assert.equal(c.f.count('stop'), 1);
        c.f.states.set(c.project.id, 'occupied'); await choose(c.page, 'refresh'); await refused(c); assert.equal(c.f.count('stop'), 1);
        c.f.states.set(c.project.id, 'stopped'); await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-forget').isDisabled());
    });
    await test('failed generated request retains Stop and cannot establish stopped proof', async () => {
        const c = await setup(); await running(c); c.f.errors.request = 'PERSISTENT_REQUEST_FAILED'; await choose(c.page, 'send');
        await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled()); assert.equal(c.f.count('stop'), 0);
    });
    await test('token error alone never forgets; reconnect does not replay failed operation', async () => {
        const c = await setup(); await stale(c); c.f.errors.status = 'PERSISTENT_TOKEN_INVALID'; await choose(c.page, 'refresh');
        await refused(c); const calls = [...c.f.calls]; delete c.f.errors.status; await choose(c.page, 'reconnect');
        assert.deepEqual(c.f.calls, calls); await refused(c);
    });
    await test('confirmation rechecks connection loss synchronously and preserves held session', async () => {
        const c = await setup(); await stale(c); const calls = [...c.server.calls];
        await c.page.evaluate(() => { window.confirm = () => { window.dispatchEvent(new Event('offline')); return true; }; });
        await c.page.locator('#persistent-forget').click(); assert.deepEqual(c.server.calls, calls); await refused(c);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
    });
    await test('confirmation rechecks changed selection synchronously and preserves old Stop', async () => {
        const c = await setup(); await stale(c); const calls = [...c.server.calls];
        await c.page.evaluate(() => { window.confirm = () => { document.querySelector('#project-new').click(); return true; }; });
        await c.page.locator('#persistent-forget').click(); assert.deepEqual(c.server.calls, calls); await refused(c);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /previous selection/); assert(!await c.page.locator('#persistent-stop').isDisabled());
    });
    await test('reload loses session and never recreates one from stopped/running/occupied Status', async () => {
        const c = await setup(); await stale(c); await c.page.reload(); await idle(c.page); await open(c.page, c.project.id); await openPersistent(c.page); await choose(c.page, 'reconnect');
        for (const state of ['stopped', 'running', 'occupied']) { c.f.states.set(c.project.id, state); await choose(c.page, 'refresh'); await refused(c); assert(await c.page.locator('#persistent-stop').isDisabled()); }
        assert.equal(c.f.count('start'), 1); assert.equal(c.f.count('stop'), 0);
    });
    await test('controlled simulated clean-server-restart rotates API token while existing page retains stale session', async () => {
        const c = await setup(); await running(c); await choose(c.page, 'send'); const oldOwned = await c.page.locator('#persistent-owned').textContent();
        // A second actual HTTP router/connection token; fake manager stopped state
        // simulates orderly lifecycle cleanup. This does not prove a native restart.
        const next = await serve(c.f); servers.add(next); c.f.states.set(c.project.id, 'stopped');
        await c.page.route('**/api/persistent/**', async route => {
            const url = new URL(route.request().url()); const headers = { ...route.request().headers(), origin: next.origin, host: new URL(next.origin).host };
            const result = await route.fetch({ url: next.origin + url.pathname, headers }); await route.fulfill({ response: result });
        });
        await choose(c.page, 'refresh'); await refused(c); assert.match(await c.page.locator('#persistent-message').textContent(), /PERSISTENT_TOKEN_INVALID/);
        await choose(c.page, 'reconnect'); await refused(c); await choose(c.page, 'refresh');
        assert.equal(await c.page.locator('#persistent-owned').textContent(), oldOwned);
        assert(!await c.page.locator('#persistent-forget').isDisabled()); const calls = [...next.calls];
        await confirmForget(c, true); assert.deepEqual(next.calls, calls); assert.equal(c.f.count('stop'), 0); assert.equal(c.f.count('start'), 1);
        await choose(c.page, 'refresh'); await choose(c.page, 'run'); assert.equal(c.f.count('start'), 2); await choose(c.page, 'stop');
    });
    await test('session IDs and connection tokens never leak into DOM, storage, URLs or logs', async () => {
        const c = await setup(); await stale(c); const tokens = [...c.page.tokens];
        await choose(c.page, 'stop'); tokens.push(c.f.calls.at(-1).input.sessionId);
        const surface = await c.page.evaluate(() => JSON.stringify({ html: document.documentElement.outerHTML,
            local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
        for (const token of tokens) { assert(!surface.includes(token)); assert(!c.page.consoleText.join('\n').includes(token)); }
    });
    await test('desktop/mobile long names, labels, keyboard focus and disclosure cancellation preserve compiler dimensions/tabs', async () => {
        const c = await setup(); await stale(c); const page = c.page;
        await workspace(page, 'editor');
        const before = await page.locator('#dsl-editor').boundingBox();
        await workspace(page, 'persistent');
        await page.locator('#persistent-stop').focus(); await page.keyboard.press('Tab');
        assert(await page.locator('#persistent-forget').evaluate(value => value === document.activeElement && value.matches(':focus-visible') && getComputedStyle(value).outlineStyle !== 'none'));
        assert.equal(await page.getByRole('button', { name: 'Forget Stale Browser Session', exact: true }).count(), 1);
        assert.equal(await page.locator('#persistent-forget').getAttribute('aria-describedby'), 'persistent-forget-reason');
        const dialogPromise = page.waitForEvent('dialog'), press = page.keyboard.press('Enter'); const dialog = await dialogPromise; await dialog.dismiss(); await press;
        await screenshot(page, 'keyboard-focus');
        const calls = [...c.server.calls], owned = await page.locator('#persistent-owned').textContent();
        await page.locator('#persistent-disclosure').focus(); await page.keyboard.press('Space'); assert(!await page.locator('#persistent-panel').isVisible());
        await page.keyboard.press('Enter'); assert(await page.locator('#persistent-panel').isVisible()); assert.deepEqual(c.server.calls, calls);
        assert.equal(await page.locator('#persistent-owned').textContent(), owned);
        await workspace(page, 'editor');
        assert.deepEqual(await page.locator('#dsl-editor').boundingBox(), before);
        await workspace(page, 'inspector');
        assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.dataset.tab)), TABS);
        await page.locator('#tab-tokens').focus(); await page.keyboard.press('End'); assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Home'); assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
        c.f.records.get(c.project.id).name = '<img src=x> ' + 'long project name '.repeat(12); await open(page, c.project.id); await choose(page, 'refresh');
        assert.equal(await page.locator('#persistent-project img').count(), 0);
        for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await screenshot(page, 'long-name-' + width); }
        assert.deepEqual(page.failures, []);
    });
    await test('disposable Live API behavior remains independent during stopped-session reconciliation', async () => {
        const c = await setup(); await stale(c); const { page, f } = c;
        const liveCalls = [], liveSession = crypto.randomBytes(32).toString('hex');
        await page.route('**/api/live/**', async route => {
            const action = route.request().url().split('/').at(-1); liveCalls.push(action);
            const data = action === 'start' ? { sessionId: liveSession, expiresAt: new Date(Date.now() + 900000).toISOString() } :
                action === 'request' ? { status: 200, headers: { 'content-type': 'application/json' }, body: { data: 'disposable fixture' }, durationMs: 1 } : { stopped: true };
            await route.fulfill({ json: { success: true, ...data } });
        });
        await clickIn(page, 'editor', page.locator('#compile-btn')); await page.waitForFunction(() => document.querySelector('#compilation-summary-content').textContent.includes('entity'));
        await clickIn(page, 'inspector', page.locator('#tab-live-api')); await clickIn(page, 'inspector', page.locator('#live-start'));
        await page.waitForFunction(() => document.querySelector('#live-status').textContent === 'Running');
        await confirmForget(c, true); assert.deepEqual(liveCalls, ['start']); assert.equal(f.count('stop'), 0);
        await clickIn(page, 'inspector', page.locator('#live-send')); await page.waitForFunction(() => document.querySelector('#live-response').textContent.includes('disposable fixture'));
        await clickIn(page, 'inspector', page.locator('#live-stop')); await page.waitForFunction(() => document.querySelector('#live-status').textContent === 'Stopped / expired');
        assert.deepEqual(liveCalls, ['start', 'request', 'stop']); assert(await page.locator('#persistent-run').isDisabled());
    });
    await test('offline invalidates in-flight reconnect; late connection success cannot restore eligibility', async () => {
        const c = await setup(); await stale(c); const wait = gate();
        await c.page.route('**/api/persistent/session', async route => { await wait.promise; await route.continue(); });
        await c.page.locator('#persistent-reconnect').click(); await c.page.waitForFunction(() => document.querySelector('.persistent-card').getAttribute('aria-busy') === 'true');
        await c.page.evaluate(() => window.dispatchEvent(new Event('offline'))); wait.release(); await idle(c.page);
        await refused(c); assert(await c.page.locator('#persistent-refresh').isDisabled());
        assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
    });
    await test('confirmation refuses a newer pending Status and its conflicting occupied response', async () => {
        const c = await setup(); await stale(c); c.f.states.set(c.project.id, 'occupied');
        await c.page.evaluate(() => { window.confirm = () => { document.querySelector('#persistent-refresh').click(); return true; }; });
        await c.page.locator('#persistent-forget').click(); await idle(c.page); await refused(c);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
        assert.match(await c.page.locator('#persistent-status').textContent(), /occupied/);
        assert.equal(c.f.count('stop'), 0); assert.equal(c.f.count('start'), 1);
    });
    await test('pending Project Save refuses forgetting immediately while preserving known-session Stop', async () => {
        const c = await setup(); await stale(c); const wait = gate();
        await c.page.route('**/api/projects/' + c.project.id, async route => {
            if (route.request().method() === 'PUT') await wait.promise; await route.continue();
        });
        await enterName(c.page, 'New saved revision'); await saveDialog(c.page);
        await c.page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'true');
        await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
        wait.release(); await c.page.waitForFunction(() => projectWorkspace.snapshot().revision === 2);
        await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
    });
    await test('Open dialog cancellation invalidates proof despite unchanged saved identity', async () => {
        const c = await setup(); await stale(c); const saved = await c.page.evaluate(() => projectWorkspace.snapshot());
        await clickIn(c.page, 'projects', c.page.locator('#project-open')); await c.page.waitForFunction(() => document.querySelector('#project-dialog').open);
        assert(await c.page.locator('#persistent-forget').isDisabled()); await c.page.keyboard.press('Escape');
        await c.page.waitForFunction(() => !document.querySelector('#project-dialog').open);
        assert.deepEqual(await c.page.evaluate(() => projectWorkspace.snapshot()), saved); await refused(c);
        await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-forget').isDisabled());
    });
    await test('late Status during a newer Project API reconnect cannot restore old proof', async () => {
        const c = await setup(); await stale(c); const wait = gate(); c.f.hooks.status = () => wait.promise;
        await c.page.locator('#persistent-refresh').click(); await c.page.locator('#project-storage').evaluate(value => value.open = true);
        await clickIn(c.page, 'projects', c.page.locator('#project-reconnect')); await c.page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
        wait.release(); await idle(c.page); await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
        delete c.f.hooks.status; await choose(c.page, 'refresh'); assert(!await c.page.locator('#persistent-forget').isDisabled());
    });
    await test('unconfirmed Project Save preserves owned session and cannot enable forgetting from Status', async () => {
        const c = await setup(); await stale(c);
        await c.page.route('**/api/projects/' + c.project.id, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
        await enterName(c.page, 'Unconfirmed name'); await saveDialog(c.page);
        await c.page.waitForFunction(() => document.querySelector('#project-status').dataset.state === 'uncertain');
        await refused(c); await choose(c.page, 'refresh'); await refused(c); assert(!await c.page.locator('#persistent-stop').isDisabled());
        assert.equal(c.f.count('start'), 1); assert.equal(c.f.count('stop'), 0);
    });
    await test('confirmation rechecks pending Project Save synchronously before observer delivery', async () => {
        const c = await setup(); await stale(c); const wait = gate();
        await c.page.route('**/api/projects/' + c.project.id, async route => { if (route.request().method() === 'PUT') await wait.promise; await route.continue(); });
        await c.page.evaluate(() => { window.confirm = () => {
            document.querySelector('#project-name').value = 'Saving during confirmation';
            document.querySelector('#project-name').dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#project-save').click(); return true;
        }; });
        await c.page.locator('#persistent-forget').click(); await refused(c);
        assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
        assert(!await c.page.locator('#persistent-stop').isDisabled()); wait.release();
        await c.page.waitForFunction(() => projectWorkspace.snapshot().revision === 2);
    });
    await test('confirmation drains a complete synchronous project-dialog cycle before accepting proof', async () => {
        const c = await setup(); await stale(c); const calls = [...c.server.calls];
        await c.page.evaluate(() => { window.confirm = () => {
            const dialog = document.querySelector('#project-dialog'); dialog.showModal(); dialog.close(); return true;
        }; });
        await c.page.locator('#persistent-forget').click(); await refused(c);
        assert.deepEqual(c.server.calls, calls); assert.match(await c.page.locator('#persistent-owned').textContent(), /Known owned session/);
        assert(!await c.page.locator('#persistent-stop').isDisabled());
    });
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
    releases.forEach(release => release()); await browser?.close(); await Promise.all([...servers].map(server => server.stop()));
    const report = { evidence: 'Actual Chromium against controlled HTTP and in-memory fixtures; simulated restart, no native database certification. Manual screen-reader certification NOT RUN.', results,
        counts: results.reduce((counts, result) => (counts[result.status] = (counts[result.status] || 0) + 1, counts), {}) };
    if (process.env.APIFORGE_M2DC_EVIDENCE) fs.writeFileSync(path.join(process.env.APIFORGE_M2DC_EVIDENCE, 'recovery-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.counts));
});
