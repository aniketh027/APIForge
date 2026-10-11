'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const { serve, nativeApi } = require('./frontend-projects-server');
const { ProjectStoreError } = require('../src/project-store/errors');
const { STUDENT_SOURCE } = require('./frontend-source-fixtures');
const results = [], servers = new Set(), children = new Set(), releases = new Set();
const fixtures = path.join(os.homedir(), 'APIForge-M2C-UI-tests-' + crypto.randomUUID());
fs.mkdirSync(fixtures);
let browser;
class NotRun extends Error {}
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const normalize = source => source.replace(/\r\n?/g, '\n');
function requireNativeRuntime() {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (process.platform !== 'win32' || process.arch !== 'x64' || major < 24 || (major === 24 && minor < 14)) {
        throw new NotRun('Supported Windows x64/Node 24.14.0+ SQLite runtime unavailable');
    }
}
function gate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    releases.add(release);
    return { promise, release: () => { releases.delete(release); release(); } };
}
async function test(name, action) {
    const started = Date.now();
    try { await action(); results.push({ name, status: 'PASS', ms: Date.now() - started }); console.log('PASS ' + name); }
    catch (error) {
        const status = error instanceof NotRun ? 'NOT RUN' : 'FAIL';
        results.push({ name, status, reason: error.message }); console.error(status + ' ' + name + ': ' + error.message);
        if (status === 'FAIL') throw error;
    }
}
async function server(options) { const value = await serve(options); servers.add(value); return value; }
async function stop(value) { await value.stop(); servers.delete(value); }
async function pageAt(value) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.runtimeErrors = []; page.consoleErrors = [];
    page.on('pageerror', error => page.runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') page.consoleErrors.push({ text: message.text(), url: message.location().url }); });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.goto(value.origin); return page;
}
const editor = page => page.locator('#dsl-editor');
const name = page => page.getByLabel('Project name', { exact: true });
const status = page => page.locator('#project-status');
async function ready(page) { await page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false'); }
async function choose(page, button) { await page.locator('#project-' + button).click(); await ready(page); }
async function message(page, code) { await page.waitForFunction(code => document.querySelector('#project-message').textContent.includes(code), code); }
async function saved(page, revision) {
    await page.waitForFunction(revision => document.querySelector('#project-revision').textContent === 'Revision ' + revision &&
        document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false', revision);
}
async function confirm(page, accepted, action) {
    const pending = page.waitForEvent('dialog');
    const clicked = action();
    const dialog = await pending; assert.equal(dialog.type(), 'confirm');
    if (accepted) await dialog.accept(); else await dialog.dismiss();
    await clicked;
}
async function open(page, id, discard) {
    await choose(page, 'open');
    const button = page.locator('#project-list button[data-project-id="' + id + '"]');
    if (discard !== undefined) await confirm(page, discard, () => button.click()); else await button.click();
    await ready(page);
}
async function state(page) {
    return { source: await editor(page).inputValue(), name: await name(page).inputValue(),
        target: await page.locator('.target-option[aria-pressed="true"]').getAttribute('data-target'),
        id: await page.locator('#project-workspace').getAttribute('data-project-id'), revision: await page.locator('#project-revision').textContent() };
}
function fakeStore() {
    const records = new Map(), hooks = {}, calls = [];
    let initialized = false;
    function make(input, id = crypto.randomUUID(), revision = 1) {
        const result = { id, ...input, revision, sourceHash: hash(input.source), createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z' };
        records.set(id, result); return { ...result };
    }
    const store = { storeId: crypto.randomUUID(), close() {},
        async createProject(input) { calls.push('create'); await hooks.create?.(input); return make(input); },
        async listProjects() { calls.push('list'); await hooks.list?.(); return [...records.values()].sort((a,b) => a.id.localeCompare(b.id)).map(({ source, ...value }) => value); },
        async getProject(id) { calls.push('get'); await hooks.get?.(); if (!records.has(id)) throw new ProjectStoreError('PROJECT_NOT_FOUND'); return { ...records.get(id) }; },
        async saveProject(id, revision, changes) {
            calls.push('save'); await hooks.save?.();
            const value = records.get(id); if (!value) throw new ProjectStoreError('PROJECT_NOT_FOUND');
            if (value.revision !== revision) throw new ProjectStoreError('PROJECT_REVISION_CONFLICT');
            return make({ name: value.name, target: value.target, source: value.source, ...changes }, id, revision + 1);
        }
    };
    return { records, hooks, calls, make, store, storeApi: {
        async initializeProjectStore() { calls.push('initialize'); await hooks.initialize?.(); if (initialized) throw new ProjectStoreError('PROJECT_STORE_EXISTS'); initialized = true; return store; },
        async openProjectStore() { calls.push('open'); await hooks.open?.(); return store; }
    } };
}
async function compile(page) {
    const pending = page.waitForResponse(response => response.url().endsWith('/api/compile'));
    await page.locator('#compile-btn').click(); const response = await pending;
    await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
    assert.equal((await response.json()).success, true);
}
async function request(page, method, pathname, body) {
    return page.evaluate(async ({ method, pathname, body }) => {
        const session = await (await fetch('/api/projects/session')).json();
        const response = await fetch('/api/projects' + pathname, { method,
            headers: { 'X-APIForge-Project-Token': session.data.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    }, { method, pathname, body });
}
async function startupAndDisabled() {
    const calls = [];
    const value = await server({ enabled: false, storeApi: { initializeProjectStore() { calls.push('initialize'); throw Error('Storage must remain untouched'); },
        openProjectStore() { calls.push('open'); throw Error('Storage must remain untouched'); } } });
    const page = await pageAt(value);
    try {
        await page.waitForLoadState('networkidle');
        assert.equal(await editor(page).inputValue(), ''); assert(await editor(page).isEditable());
        assert.equal((await state(page)).target, 'mysql'); assert.equal(await page.locator('#source-name').textContent(), 'Untitled source');
        assert.equal(value.calls.length, 0); assert.equal(await page.locator('.status-icon.pending').count(), 6);
        await name(page).fill('Temporary name'); await name(page).fill('');
        assert.equal(await page.locator('#source-name').textContent(), 'Untitled source');
        await choose(page, 'new'); await name(page).fill('Draft'); await editor(page).fill(STUDENT_SOURCE);
        await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
        assert.equal((await state(page)).id, ''); assert.equal(await status(page).textContent(), 'Not saved'); assert.equal(value.calls.length, 0);
        await choose(page, 'save'); await message(page, 'PROJECT_API_DISABLED'); assert.equal((await state(page)).source, STUDENT_SOURCE);
        await compile(page); assert(await page.locator('#download-btn').isVisible());
        assert.equal(await page.locator('#header-status-text').textContent(), 'Compiler ready');
        const before = await state(page); await confirm(page, false, () => page.locator('#project-new').click()); assert.deepEqual(await state(page), before);
        assert.deepEqual(calls, []); assert.deepEqual(page.runtimeErrors, []);
        assert(page.consoleErrors.every(error => error.url.endsWith('/api/projects/session') && /403/.test(error.text)));
    } finally { await page.close(); await stop(value); }
}
async function nativeWorkflow() {
    requireNativeRuntime();
    const root = path.join(fixtures, 'persistence');
    const value = await server({ storeApi: nativeApi(root) });
    const page = await pageAt(value);
    let first, second;
    try {
        assert.equal(fs.existsSync(root), false);
        await choose(page, 'open'); await message(page, 'PROJECT_STORE_MISSING');
        assert.equal(fs.existsSync(root), false); await page.locator('#project-dialog-close').click();
        await confirm(page, false, () => page.locator('#project-initialize').click());
        assert.equal(value.calls.filter(call => call.path.endsWith('/initialize')).length, 0);
        await confirm(page, true, () => page.locator('#project-initialize').click()); await ready(page);
        assert.match(await page.locator('#project-message').textContent(), /Storage initialized/);
        const initialization = value.calls.find(call => call.path.endsWith('/initialize'));
        assert.deepEqual(initialization.body, {}); assert.equal(initialization.status, 201);
        assert.equal(value.calls.filter(call => call.method === 'POST' && call.path === '/api/projects').length, 0);
        await confirm(page, true, () => page.locator('#project-initialize').click()); await ready(page); await message(page, 'PROJECT_STORE_EXISTS');
        await choose(page, 'open'); assert.match(await page.locator('#project-dialog-status').textContent(), /No saved projects/); await page.locator('#project-dialog-close').click();
        await name(page).fill('  Unicode 项目 🧪  '); await editor(page).fill('incomplete DSL\n\tΩ 😀 \u0000\ufeff\n');
        await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
        const before = await state(page);
        await choose(page, 'save'); await saved(page, 1); first = (await state(page)).id;
        assert.match(first, /^[0-9a-f-]{36}$/); assert.equal(await status(page).textContent(), 'Saved');
        const created = value.calls.find(call => call.method === 'POST' && call.path === '/api/projects');
        assert.deepEqual(created.body, { name: before.name, target: 'postgres', source: before.source });
        const record = (await request(page, 'GET', '/' + first)).body.data;
        assert.equal(record.source, before.source); assert.equal(record.name, before.name);
        for (const field of ['name', 'target', 'source']) {
            if (field === 'name') await name(page).fill('Changed name');
            if (field === 'target') await page.getByRole('button', { name: 'MySQL', exact: true }).click();
            if (field === 'source') await editor(page).fill('changed source');
            assert.equal(await status(page).textContent(), 'Unsaved changes');
            if (field === 'name') await name(page).fill(before.name);
            if (field === 'target') await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
            if (field === 'source') await editor(page).fill(before.source);
            assert.equal(await status(page).textContent(), 'Saved');
        }
        await name(page).fill('Renamed project'); await choose(page, 'save'); await saved(page, 2);
        assert.deepEqual(value.calls.find(call => call.method === 'PUT').body, { expectedRevision: 1, changes: { name: 'Renamed project' } });
        await page.locator('#clear-btn').click(); assert.equal((await state(page)).id, first); assert.equal(await status(page).textContent(), 'Unsaved changes');
        await choose(page, 'save'); await saved(page, 3); assert.equal((await request(page, 'GET', '/' + first)).body.data.source, '');
        await choose(page, 'new'); assert.equal((await state(page)).target, 'mysql'); assert.equal((await state(page)).id, '');
        await name(page).fill('Second independent project'); await editor(page).fill(STUDENT_SOURCE); await choose(page, 'save'); await saved(page, 1); second = (await state(page)).id;
        const summaries = (await request(page, 'GET', '')).body.data;
        assert.deepEqual(summaries.map(item => item.id), [first, second].sort()); assert(summaries.every(item => !Object.hasOwn(item, 'source')));
        const getsBefore = value.calls.filter(call => call.method === 'GET' && /^\/api\/projects\/[0-9a-f-]{36}$/.test(call.path)).length;
        await choose(page, 'open');
        assert.deepEqual(await page.locator('#project-list button').evaluateAll(buttons => buttons.map(button => button.dataset.projectId)), summaries.map(item => item.id));
        assert.equal(value.calls.filter(call => call.method === 'GET' && /^\/api\/projects\/[0-9a-f-]{36}$/.test(call.path)).length, getsBefore);
        await page.locator('#project-list button[data-project-id="' + first + '"]').click(); await ready(page);
        assert.deepEqual(await state(page), { id: first, revision: 'Revision 3', source: '', name: 'Renamed project', target: 'postgres' });
        assert.equal(await page.locator('#compilation-summary').isVisible(), false); assert.equal(await page.locator('#error-panel').textContent(), '');
        assert.equal(value.calls.filter(call => call.path === '/api/compile').length, 0);
        await editor(page).fill('keep this local draft'); const dirty = await state(page);
        await open(page, second, false); assert.deepEqual(await state(page), dirty); await page.locator('#project-dialog-close').click();
        await confirm(page, false, () => page.locator('#clear-btn').click()); assert.deepEqual(await state(page), dirty);
        await confirm(page, false, () => page.locator('#project-new').click()); assert.deepEqual(await state(page), dirty);
        await open(page, second, true); assert.equal((await state(page)).source, STUDENT_SOURCE); assert.equal((await state(page)).id, second);
        await compile(page); const downloaded = page.waitForEvent('download'); await page.locator('#download-btn').click(); assert.equal(await (await downloaded).failure(), null);
        assert.deepEqual(page.runtimeErrors, []);
        assert(page.consoleErrors.every(error => /\/api\/projects(?:\/initialize)?$/.test(error.url) && /409|503/.test(error.text)));
        // Seed exact bytes through the real API, then restore and rename in UI.
        const exact = '\ufeffENTITY ByteTest\r\nid INT PRIMARY KEY\r\n// Ω 😀\r\u0000\t \n';
        const seeded = (await request(page, 'POST', '', { name: 'Exact bytes', target: 'mysql', source: exact })).body.data;
        await open(page, seeded.id); assert.equal((await state(page)).source, normalize(exact));
        await name(page).fill('Exact renamed'); await choose(page, 'save'); await saved(page, 2);
        assert.equal((await request(page, 'GET', '/' + seeded.id)).body.data.source, exact);
        await editor(page).fill('changed'); await editor(page).fill(normalize(exact)); assert.equal(await status(page).textContent(), 'Saved');
        await stop(value);
        // Independent real server process reopens the same disposable native store.
        const worker = await startWorker(root);
        await page.goto(worker.origin); await open(page, seeded.id);
        assert.equal((await state(page)).source, normalize(exact)); assert.equal((await state(page)).name, 'Exact renamed');
        assert.equal((await request(page, 'GET', '/' + seeded.id)).body.data.source, exact);
        await stopWorker(worker);
    } finally { await page.close(); if (servers.has(value)) await stop(value); }
}
function reply(child, phase = 'ready') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(Error('Fixture process timeout during ' + phase)); }, 45000);
        function cleanup() { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); }
        function onMessage(message) { cleanup(); resolve(message); }
        function onExit() { cleanup(); reject(Error('Fixture process exited early')); }
        child.once('message', onMessage); child.once('exit', onExit);
    });
}
async function command(child, message) { const pending = reply(child, message.action); child.send(message); return pending; }
async function startWorker(root, port = 0) {
    const child = fork(path.join(__dirname, 'frontend-projects-server.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); child.once('exit', () => children.delete(child));
    assert.equal((await reply(child)).ready, true);
    const result = await command(child, { action: 'start', root, port }); assert(result.port);
    return { child, port: result.port, origin: 'http://127.0.0.1:' + result.port };
}
async function stopWorker(value) { assert.equal((await command(value.child, { action: 'stop' })).stopped, true); }

async function nativeConflictAndRestart() {
    requireNativeRuntime();
    const root = path.join(fixtures, 'concurrency');
    let worker = await startWorker(root);
    const a = await pageAt(worker), b = await pageAt(worker);
    try {
        await a.locator('#project-storage summary').click();
        await confirm(a, true, () => a.locator('#project-initialize').click()); await ready(a);
        await name(a).fill('Shared project'); await editor(a).fill('initial'); await choose(a, 'save'); await saved(a, 1);
        const id = (await state(a)).id;
        await open(b, id); await name(a).fill('Winner'); await editor(a).fill('winner'); await choose(a, 'save'); await saved(a, 2);
        await name(b).fill('Losing local name'); await editor(b).fill('losing local source');
        await b.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
        const loser = await state(b), mutations = [];
        b.on('request', request => { if (request.method() === 'PUT') mutations.push(request.postDataJSON()); });
        await choose(b, 'save'); await message(b, 'PROJECT_REVISION_CONFLICT');
        assert.deepEqual(await state(b), loser); assert.match(await status(b).textContent(), /Conflict/);
        await b.screenshot({ path: path.join(fixtures, 'revision-conflict.png'), fullPage: true });
        assert.equal(mutations.length, 1); assert.equal(mutations[0].expectedRevision, 1);
        assert(await b.locator('#project-save').isDisabled());
        assert.equal((await request(a, 'GET', '/' + id)).body.data.source, 'winner');
        await b.locator('#project-keep').click(); assert.equal(await editor(b).evaluate(node => document.activeElement === node), true);
        await choose(b, 'inspect'); assert.equal(await b.locator('#project-preview-source').textContent(), 'winner');
        assert.deepEqual(await state(b), loser);
        await confirm(b, false, () => b.locator('#project-load-snapshot').click()); assert.deepEqual(await state(b), loser);
        await confirm(b, true, () => b.locator('#project-load-snapshot').click());
        assert.equal((await state(b)).revision, 'Revision 2'); assert.equal((await state(b)).name, 'Winner');
        await editor(b).fill('reconciled'); await choose(b, 'save'); await saved(b, 3);
        assert.equal(mutations.at(-1).expectedRevision, 2);
        const port = worker.port; await stopWorker(worker); worker = await startWorker(root, port);
        await editor(b).fill('after restart'); const before = await state(b);
        await choose(b, 'save'); await message(b, 'PROJECT_API_TOKEN_INVALID'); assert.deepEqual(await state(b), before);
        assert.equal(mutations.length, 3); assert(await b.locator('#project-save').isDisabled());
        await choose(b, 'reconnect'); assert.equal(mutations.length, 3);
        await choose(b, 'save'); await saved(b, 4); assert.equal(mutations.length, 4); assert.equal(mutations.at(-1).expectedRevision, 3);
        assert.equal((await request(b, 'GET', '/' + id)).body.data.source, 'after restart');
        assert.deepEqual(a.runtimeErrors.concat(b.runtimeErrors), []);
    } finally { await a.close(); await b.close(); await stopWorker(worker); }
}
async function asyncSafety() {
    const fake = fakeStore(), value = await server({ storeApi: fake.storeApi }), page = await pageAt(value);
    try {
        const saveGate = gate(); fake.hooks.create = () => saveGate.promise;
        await name(page).fill('Submitted'); await editor(page).fill('submitted source');
        await page.locator('#project-save').evaluate(button => { button.click(); button.click(); button.click(); });
        await page.waitForFunction(() => document.querySelector('#project-status').textContent === 'Saving…');
        assert(await page.locator('#project-new').isDisabled()); assert(await page.locator('#project-open').isDisabled());
        assert(await editor(page).isEditable());
        await name(page).fill('Newer local name'); await editor(page).fill('newer local source');
        await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click();
        saveGate.release(); await saved(page, 1);
        assert.equal(fake.calls.filter(call => call === 'create').length, 1);
        assert.equal(await status(page).textContent(), 'Unsaved changes');
        const first = (await state(page)).id; assert.equal(fake.records.get(first).source, 'submitted source');
        assert.equal((await state(page)).source, 'newer local source'); assert.equal((await state(page)).target, 'postgres');
        delete fake.hooks.create; await choose(page, 'save'); await saved(page, 2);
        const second = fake.make({ name: '<img src=x onerror="throw Error(1)">', target: 'mysql', source: 'second' });
        const listGate = gate(); fake.hooks.list = () => listGate.promise;
        await page.locator('#project-open').click(); await page.locator('#project-dialog-close').click();
        await choose(page, 'new'); await name(page).fill('New workspace'); const afterNew = await state(page);
        listGate.release(); await page.waitForLoadState('networkidle'); assert.deepEqual(await state(page), afterNew);
        assert.equal(await page.locator('#project-dialog').isVisible(), false); assert.equal(await page.locator('#project-list button').count(), 0);
        delete fake.hooks.list;
        await choose(page, 'open'); assert.equal(await page.locator('#project-list img').count(), 0);
        assert((await page.locator('#project-list').textContent()).includes(second.name));
        const loadGate = gate(); fake.hooks.get = () => loadGate.promise;
        await confirm(page, true, () => page.locator('#project-list button[data-project-id="' + first + '"]').click());
        await page.locator('#project-dialog-close').click(); await confirm(page, true, () => page.locator('#project-new').click());
        await name(page).fill('Latest workspace'); await editor(page).fill('latest source'); const latest = await state(page);
        loadGate.release(); await page.waitForLoadState('networkidle'); assert.deepEqual(await state(page), latest);
        delete fake.hooks.get;
        // Programmatic edits during a pending Open must also prevent replacement.
        await choose(page, 'open'); const editGate = gate(); fake.hooks.get = () => editGate.promise;
        await confirm(page, true, () => page.locator('#project-list button[data-project-id="' + first + '"]').click());
        await editor(page).evaluate(node => { node.value = 'edited during open'; node.dispatchEvent(new Event('input')); });
        editGate.release(); await ready(page); assert.equal((await state(page)).source, 'edited during open');
        assert.match(await page.locator('#project-dialog-status').textContent(), /Workspace changed/);
        await page.locator('#project-dialog-close').click(); delete fake.hooks.get;
        // Lazy session response and list cannot revive an abandoned dialog.
        const sessionGate = gate();
        await page.reload();
        await page.route('**/api/projects/session', async route => { const response = await route.fetch(); await sessionGate.promise; await route.fulfill({ response }); });
        await page.locator('#project-open').click(); await page.locator('#project-dialog-close').click();
        await choose(page, 'new'); await editor(page).fill('session-safe draft');
        sessionGate.release(); await page.waitForLoadState('networkidle'); assert.equal((await state(page)).source, 'session-safe draft');
        assert.equal(await page.locator('#project-dialog').isVisible(), false); await page.unroute('**/api/projects/session');
        assert.deepEqual(page.runtimeErrors, []);
    } finally { for (const release of releases) release(); await page.close(); await stop(value); }
}
async function failuresAndUncertainty() {
    const fake = fakeStore(), value = await server({ storeApi: fake.storeApi }), page = await pageAt(value);
    try {
        const seed = fake.make({ name: 'Saved', target: 'mysql', source: 'saved' }); await open(page, seed.id);
        await editor(page).fill('local uncertain'); const before = await state(page);
        fake.hooks.save = () => { throw new ProjectStoreError('PROJECT_COMMIT_UNCERTAIN'); };
        await choose(page, 'save'); await message(page, 'PROJECT_COMMIT_UNCERTAIN');
        assert.deepEqual(await state(page), before); assert.equal(await status(page).textContent(), 'Save unconfirmed');
        assert(await page.locator('#project-save').isDisabled()); assert.equal(fake.calls.filter(call => call === 'save').length, 1);
        await choose(page, 'inspect'); assert.equal(await page.locator('#project-preview-source').textContent(), 'saved');
        await confirm(page, false, () => page.locator('#project-load-snapshot').click()); assert.deepEqual(await state(page), before);
        await confirm(page, true, () => page.locator('#project-load-snapshot').click()); delete fake.hooks.save;
        // A real HTTP mutation commits, but Playwright drops its acknowledgement.
        await choose(page, 'new'); await name(page).fill('Unacknowledged first save'); await editor(page).fill('preserve me');
        await page.route('**/api/projects', async route => {
            if (route.request().method() !== 'POST') return route.continue();
            await route.fetch(); await route.abort('connectionreset');
        });
        const count = fake.records.size; await choose(page, 'save'); await message(page, 'PROJECT_CLIENT_NETWORK');
        assert.equal(fake.records.size, count + 1); assert.equal((await state(page)).id, '');
        assert.equal((await state(page)).revision, 'No committed revision'); assert.equal((await state(page)).source, 'preserve me');
        assert.match(await page.locator('#project-message').textContent(), /UUID was not acknowledged/);
        assert(await page.locator('#project-save').isDisabled()); await page.unroute('**/api/projects');
        await choose(page, 'inspect'); assert((await page.locator('#project-list').textContent()).includes('Unacknowledged first save'));
        await page.locator('#project-dialog-close').click();
        await confirm(page, true, () => page.locator('#project-new').click()); await name(page).fill('Error draft'); await editor(page).fill('invalid DSL is saveable');
        const draft = await state(page);
        for (const code of ['PROJECT_STORE_MISSING', 'PROJECT_STORE_UNSAFE', 'PROJECT_STORE_INCOMPATIBLE', 'PROJECT_STORE_RUNTIME_UNSUPPORTED',
            'PROJECT_STORE_PLATFORM_UNSUPPORTED', 'PROJECT_STORE_BUSY', 'PROJECT_NOT_FOUND', 'PROJECT_INVALID_NAME', 'PROJECT_INVALID_TARGET', 'PROJECT_INVALID_SOURCE', 'PROJECT_INVALID_REVISION']) {
            fake.hooks.create = () => { const error = new ProjectStoreError(code); error.message = 'PRIVATE C:\\secret token stack'; throw error; };
            await choose(page, 'save'); await message(page, code); assert.deepEqual(await state(page), draft);
            assert.doesNotMatch(await page.locator('#project-message').textContent(), /PRIVATE|C:\\secret|stack/);
            assert.equal(await page.locator('#header-status-text').textContent(), 'Compiler ready');
        }
        fake.hooks.create = () => { throw Error('PRIVATE C:\\secret'); }; await choose(page, 'save'); await message(page, 'PROJECT_STORE_STORAGE_FAILURE');
        delete fake.hooks.create;
        await page.route('**/api/projects', route => route.fulfill({ status: 201, json: { success: true, data: { id: 'bad', source: 'PRIVATE' } } }));
        await choose(page, 'save'); await message(page, 'PROJECT_CLIENT_RESPONSE_INVALID'); assert.deepEqual(await state(page), draft);
        assert.equal(await status(page).textContent(), 'Save unconfirmed'); await page.unroute('**/api/projects');
        await confirm(page, true, () => page.locator('#project-new').click());
        await page.route('**/api/projects', route => route.fulfill({ status: 500, json: { success: false, error: { code: 'UNKNOWN_SERVER_ERROR', message: 'PRIVATE C:\\secret' } } }));
        await choose(page, 'open'); await message(page, 'PROJECT_CLIENT_SERVER_ERROR');
        assert.doesNotMatch(await page.locator('#project-dialog-status').textContent(), /PRIVATE|UNKNOWN_SERVER_ERROR/);
        await page.locator('#project-dialog-close').click(); await page.unroute('**/api/projects');
        await page.route('**/api/projects', route => route.fulfill({ status: 500, json: { success: false, error: { code: 'UNKNOWN_SERVER_ERROR', message: 'PRIVATE C:\\secret', stack: 'PRIVATE' } } }));
        await choose(page, 'open'); await message(page, 'PROJECT_CLIENT_RESPONSE_INVALID');
        assert.doesNotMatch(await page.locator('#project-dialog-status').textContent(), /PRIVATE|UNKNOWN_SERVER_ERROR/);
        await page.locator('#project-dialog-close').click(); await page.unroute('**/api/projects');
        // Rapid initializer clicks are guarded even while the factory is delayed.
        const initFake = fakeStore(), initValue = await server({ storeApi: initFake.storeApi }), initPage = await pageAt(initValue);
        try {
            await initPage.locator('#project-storage summary').click();
            const initGate = gate(); initFake.hooks.initialize = () => initGate.promise;
            initPage.on('dialog', dialog => dialog.accept());
            await initPage.locator('#project-initialize').evaluate(button => { button.click(); button.click(); button.click(); });
            await initPage.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'true');
            initGate.release(); await ready(initPage); assert.equal(initFake.calls.filter(call => call === 'initialize').length, 1);
            assert.equal(initFake.calls.filter(call => call === 'create').length, 0);
        } finally { await initPage.close(); await stop(initValue); }
        assert.deepEqual(page.runtimeErrors, []);
    } finally { for (const release of releases) release(); await page.close(); await stop(value); }
}

async function layoutKeyboardAndCompilerRace() {
    const fake = fakeStore(), value = await server({ storeApi: fake.storeApi }), page = await pageAt(value);
    try {
        const seed = fake.make({ name: 'Saved project', target: 'postgres', source: STUDENT_SOURCE });
        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('#project-open').focus(); await page.keyboard.press('Enter'); await ready(page);
            assert.equal(await page.locator('#project-dialog-close').evaluate(node => document.activeElement === node), true);
            await page.keyboard.press('Shift+Tab'); assert.equal(await page.locator('#project-list button').evaluate(node => document.activeElement === node), true);
            await page.keyboard.press('Tab'); assert.equal(await page.locator('#project-dialog-close').evaluate(node => document.activeElement === node), true);
            assert(await page.locator('#project-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
            await page.screenshot({ path: path.join(fixtures, 'project-open-' + width + '.png'), fullPage: true });
            await page.keyboard.press('Escape'); assert.equal(await page.locator('#project-open').evaluate(node => document.activeElement === node), true);
            for (const control of ['project-new', 'project-open', 'project-save', 'project-name']) {
                const node = page.locator('#' + control); await node.scrollIntoViewIfNeeded();
                assert(await node.isVisible()); assert(await node.isEnabled());
                assert(await node.evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= document.documentElement.clientWidth && box.height >= 28; }));
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
            await page.screenshot({ path: path.join(fixtures, 'project-ui-' + width + '.png'), fullPage: true });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await editor(page).fill(STUDENT_SOURCE); await compile(page);
        const compileGate = gate();
        await page.route('**/api/compile', async route => { const response = await route.fetch(); await compileGate.promise; await route.fulfill({ response }); });
        await page.locator('#compile-btn').click();
        await open(page, seed.id, true); const current = await state(page);
        assert.equal(current.target, 'postgres'); assert.equal(current.source, STUDENT_SOURCE);
        compileGate.release(); await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
        assert.equal(await page.locator('#compilation-summary').isVisible(), false); assert.equal(await page.locator('#download-btn').isVisible(), false);
        assert.match(await page.locator('#output-live-api').textContent(), /Compile successfully/);
        assert.equal(await page.locator('#line-numbers > div').count(), STUDENT_SOURCE.split('\n').length);
        assert.equal(value.calls.filter(call => call.path === '/api/compile').length, 2);
        await page.unroute('**/api/compile');
        await compile(page); assert.equal(await status(page).textContent(), 'Saved');
        const requests = value.calls.length; await choose(page, 'save'); assert.equal(value.calls.length, requests);
        assert.deepEqual(page.runtimeErrors, []); assert.deepEqual(page.consoleErrors, []);
        // Project session/source are never persisted by the frontend.
        assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), url: location.search, cookies: document.cookie })),
            { local: [], session: [], url: '', cookies: '' });
        for (const file of ['frontend/project-workspace.js', 'frontend/app.js']) {
            const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
            assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\.(log|error|debug)/);
        }
    } finally { for (const release of releases) release(); await page.close(); await stop(value); }
}

async function main() {
    console.log('Retained M2C disposable fixtures: ' + fixtures);
    try {
        await test('Chromium browser availability', async () => {
            try { browser = await chromium.launch({ headless: true, ...(process.env.APIFORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) }); }
            catch { throw new NotRun('Chromium unavailable; install Playwright Chromium or use APIFORGE_BROWSER_EXECUTABLE'); }
        });
        if (!browser) return;
        const cases = [
            ['browser startup/New/disabled API preserve independent compiler and empty workspace', startupAndDisabled],
            ['native Windows SQLite explicit initialization, revisions, exact bytes, Open, dirty navigation and independent process persistence', nativeWorkflow],
            ['native two-browser revision conflict, explicit inspection recovery and real process restart token rotation', nativeConflictAndRestart],
            ['controlled delays: duplicate saves, mid-flight edits, stale list/Open/session and newer workspace preservation', asyncSafety],
            ['controlled uncertainty, lost first-save acknowledgment, safe errors, malformed responses and duplicate initialization', failuresAndUncertainty],
            ['keyboard dialogs, 1440/900/390 layout, compiler stale response, storage isolation and no persisted tokens', layoutKeyboardAndCompilerRace]
        ];
        const filter = process.argv.find(value => value.startsWith('--filter='))?.slice('--filter='.length);
        for (const [name, action] of cases) if (!filter || name.includes(filter)) await test(name, action);
    } finally {
        for (const release of releases) release();
        if (browser) await browser.close();
        for (const value of servers) await stop(value);
        for (const child of children) child.kill();
        const counts = results.reduce((value, result) => { value[result.status] = (value[result.status] || 0) + 1; return value; }, {});
        fs.writeFileSync(path.join(fixtures, 'results.json'), JSON.stringify({ runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch }, results, counts }, null, 2));
        console.log(JSON.stringify({ counts, fixtures }));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
