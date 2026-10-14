'use strict';
// Controlled loopback browser evidence: real compiler, in-memory Project/Persistent fixtures,
// routed disposable Live requests. No Docker, database credentials or default Store access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./frontend-persistent-runtime-server');
const { ProjectStoreError } = require('../src/project-store/errors');
const { PROFESSOR_SOURCE } = require('./frontend-source-fixtures');
const evidence = process.env.APIFORGE_IDE_EVIDENCE;
const results = [];
function fixture(endpointCount = 17) {
    const records = new Map(), mutations = [], runtime = [];
    let initialized = false, database = 'absent', session = null, failure = null;
    const store = { storeId: crypto.randomUUID(), close() {},
        async createProject(input) {
            mutations.push({ action: 'create', input });
            const record = { id: crypto.randomUUID(), ...input, revision: 1, sourceHash: crypto.createHash('sha256').update(input.source).digest('hex'), createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' };
            records.set(record.id, record); return { ...record };
        },
        async saveProject(id, revision, changes) {
            mutations.push({ action: 'save', revision, changes });
            if (failure) throw new ProjectStoreError(failure);
            assert.equal(records.get(id).revision, revision);
            const record = { ...records.get(id), ...changes, revision: revision + 1 };
            record.sourceHash = crypto.createHash('sha256').update(record.source).digest('hex');
            records.set(id, record); return { ...record };
        },
        async getProject(id) { return { ...records.get(id) }; },
        async listProjects() { return [...records.values()].map(({ source, ...record }) => record); }
    };
    const summary = input => ({ formatVersion: 1, projectId: input.projectId, target: input.target, revision: input.expectedRevision, state: database });
    const manager = {
        async status(input) { runtime.push('status'); return summary(input); },
        async initialize(input) { runtime.push('initialize'); database = 'stopped'; return summary(input); },
        async start(input) { runtime.push('start'); database = 'running'; session = crypto.randomBytes(32).toString('hex'); return { ...summary(input), sessionId: session, endpointCount }; },
        async stop(input) { runtime.push('stop'); assert.equal(input.sessionId, session); database = 'stopped'; return { formatVersion: 1, state: 'stopped' }; },
        async request(input) { runtime.push('request'); assert.equal(input.sessionId, session); return { success: true, status: 200, headers: { 'content-type': 'application/json' }, body: { data: [{ id: 1, name: 'Fixture retained record' }] }, durationMs: 4 }; },
        async shutdown() {}
    };
    return { storeApi: {
        async initializeProjectStore() { initialized = true; return store; },
        async openProjectStore() { if (!initialized) throw new ProjectStoreError('PROJECT_STORE_MISSING'); return store; }
    }, manager, records, mutations, runtime, setFailure(code) { failure = code; }, stopped() { database = 'stopped'; } };
}
async function main() {
    const f = fixture(), server = await serve(f), browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(7000);
    const errors = [], liveCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.route('**/api/live/*', route => {
        const action = route.request().url().split('/').at(-1); liveCalls.push(action);
        return route.fulfill({ json: action === 'start' ? { success: true, sessionId: '1'.repeat(64), expiresAt: new Date(Date.now() + 900000).toISOString() } : action === 'request' ? { success: true, status: 200, headers: { 'content-type': 'application/json' }, body: { data: [{ name: 'Controlled Live fixture' }] }, durationMs: 7 } : { success: true } });
    });
    const nav = name => page.locator(`[data-workspace="${name}"]`).click();
    const shot = async name => { if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true }); };
    async function resizePanel(key) {
        const divider = page.getByRole('separator', { name: key + ' panel size', exact: true });
        await divider.scrollIntoViewIfNeeded();
        const bounds = await divider.boundingBox(), vertical = await divider.getAttribute('aria-orientation') === 'horizontal';
        const original = Number(await divider.getAttribute('aria-valuenow'));
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 + (vertical ? 0 : 45), bounds.y + bounds.height / 2 - (vertical ? 45 : 0), { steps: 5 });
        await page.mouse.up();
        const dragged = Number(await divider.getAttribute('aria-valuenow'));
        assert.notEqual(dragged, original, key + ' pointer drag changes size');
        await divider.focus(); await page.keyboard.press(vertical ? 'ArrowDown' : 'ArrowRight');
        assert.notEqual(Number(await divider.getAttribute('aria-valuenow')), dragged, key + ' keyboard changes size');
        await shot('resized-' + key.toLowerCase().replaceAll(' ', '-'));
        await divider.press('Home'); assert.equal(Number(await divider.getAttribute('aria-valuenow')), original);
    }
    async function runtimeViews(name) {
        const prefix = name.startsWith('persistent') ? 'persistent' : 'live';
        for (const [width, height] of [[1440,900], [1366,768], [390,844]]) {
            await page.setViewportSize({ width, height });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await shot(name + '-' + width);
            for (const part of ['query', 'send', 'response']) {
                const control = page.locator('#' + prefix + '-' + part);
                await control.scrollIntoViewIfNeeded(); assert(await control.isVisible());
                const box = await control.boundingBox();
                assert(box && box.x >= 0 && box.x + box.width <= width, prefix + ' ' + part + ' remains contained');
                if (part !== 'query') await shot(name + '-' + part + '-' + width);
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
    }
    const editor = page.locator('#dsl-editor');
    const idle = () => page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
    const runtimeIdle = () => page.waitForFunction(() => document.querySelector('.persistent-card').getAttribute('aria-busy') === 'false');
    const save = async () => {
        await page.locator('#ide-save').click();
        await page.locator('#ide-save-form button[type="submit"]').click(); await idle();
    };
    const compile = async () => {
        const response = page.waitForResponse(r => r.url().endsWith('/api/compile'));
        await page.locator('#compile-btn').click(); const data = await (await response).json();
        await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled); return data;
    };
    const confirm = async (selector, accept) => {
        page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss()); await page.locator(selector).click(); await idle();
    };
    async function test(name, action) {
        try { await action(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
        catch (error) { results.push({ name, status: 'FAIL', reason: error.message.slice(0,2000) }); await shot('failure').catch(() => {}); throw error; }
    }
    try {
        await page.goto(server.origin);
        await test('Initial editor; navigation keeps nodes and performs no API requests', async () => {
            assert.equal(await editor.inputValue(), ''); await shot('editor-before-1440');
            await page.evaluate(() => { window.originalEditor = document.getElementById('dsl-editor'); window.originalPersistent = document.getElementById('persistent-panel'); });
            for (const name of ['projects', 'persistent', 'inspector', 'editor']) {
                await nav(name); assert.equal(await page.locator(`[data-workspace="${name}"]`).getAttribute('aria-current'), 'page');
            }
            assert.equal(server.calls.length, 0); assert.equal(liveCalls.length, 0);
            assert(await page.evaluate(() => originalEditor === document.getElementById('dsl-editor') && originalPersistent === document.getElementById('persistent-panel')));
        });
        await test('Vocabulary, Unicode escaping, source/selection preservation and undo/redo', async () => {
            const source = 'IMPORT "school.apiforge"\n// Ω 😀 <script> & quotes\nENTITY Item\nid UUID PRIMARY KEY\nname STRING REQUIRED DEFAULT "Ω <b> &"\nactive BOOLEAN DEFAULT TRUE\nage INT MIN -3 MAX 20\nRELATION Item ONE_TO_MANY Other';
            await editor.fill(source);
            await editor.evaluate(node => node.setSelectionRange(8, 17));
            await page.evaluate(() => APIForgeEditor.render());
            assert.equal(await editor.inputValue(), source);
            assert.deepEqual(await editor.evaluate(node => [node.selectionStart, node.selectionEnd]), [8, 17]);
            for (const category of ['keyword', 'type', 'modifier', 'relation', 'boolean', 'number', 'string', 'comment', 'identifier']) assert(await page.locator('.dsl-' + category).count());
            assert.equal(await page.locator('#editor-highlights script, #editor-highlights b').count(), 0);
            await editor.press('Control+End'); await page.keyboard.insertText(' xyz'); await editor.press('Control+z'); assert.equal(await editor.inputValue(), source);
            await editor.press('Control+Shift+z'); assert.equal(await editor.inputValue(), source + ' xyz');
        });
        let compiled;
        await test('Real six-phase compilation, retained output and original eleven tabs', async () => {
            await editor.fill(PROFESSOR_SOURCE); compiled = await compile(); assert.equal(compiled.success, true);
            await shot('editor-after-1440'); await nav('inspector');
            assert.deepEqual(await page.locator('.tab-btn').evaluateAll(nodes => nodes.map(node => node.dataset.tab)), ['tokens','ast','diagram','symboltable','ir','optimized-ir','sql','endpoints','live-api','api','swagger']);
            const original = await page.locator('#output-sql').innerHTML(), calls = server.calls.length;
            await nav('editor'); await nav('projects'); await nav('inspector');
            assert.equal(await page.locator('#output-sql').innerHTML(), original); assert.equal(server.calls.length, calls);
            assert.equal(await page.locator('[data-summary-metric="optimizations"] .summary-detail-value').textContent(), String(compiled.optimizations.length));
            await shot('inspector-summary-1440');
            for (const tab of ['tokens','ast','sql','api','swagger','diagram','endpoints']) { await page.locator('#tab-' + tab).click(); await shot('inspector-' + tab + '-1440'); }
            await page.locator('.endpoint-row').nth(1).click();
            assert.match(await page.locator('.ide-endpoint-detail').textContent(), /requestBody|parameters/);
            assert.equal(await page.getByRole('list', { name: 'Generated endpoints' }).getByRole('listitem').count(), 17);
            await page.locator('.ide-endpoint-select').nth(2).focus(); await page.keyboard.press('Enter');
            assert.equal(await page.locator('.ide-endpoint-select').nth(2).getAttribute('aria-pressed'), 'true');
            await page.locator('.ide-endpoint-select').nth(1).focus(); await page.keyboard.press('Space');
            assert.equal(await page.locator('.ide-endpoint-select').nth(1).getAttribute('aria-pressed'), 'true');
            await page.locator('#tab-tokens').focus(); await page.keyboard.press('End'); assert.equal(await page.locator('#tab-swagger').getAttribute('aria-selected'), 'true');
        });
        await test('Phase navigation switches workspace without compilation', async () => {
            const calls = server.calls.length;
            for (const [phase, tab] of [['lexer','tokens'],['parser','ast'],['semantic','symboltable'],['ir','ir'],['optimizer','optimized-ir'],['codegen','sql']]) {
                await nav('editor'); await page.locator('#status-' + phase).click();
                assert.equal(await page.locator('#tab-' + tab).getAttribute('aria-selected'), 'true');
                assert.equal(await page.evaluate(() => APIForgeIDE.current), 'inspector');
            }
            assert.equal(server.calls.length, calls);
        });
        await test('Generated download retains every emitted byte', async () => {
            const pending = page.waitForEvent('download'); await page.locator('#download-btn').click(); const download = await pending;
            const bytes = fs.readFileSync(await download.path()); let position = 0, count = 0;
            while (bytes.readUInt32LE(position) === 0x04034b50) {
                const size = bytes.readUInt32LE(position + 18), nameSize = bytes.readUInt16LE(position + 26), extra = bytes.readUInt16LE(position + 28);
                const name = bytes.subarray(position + 30, position + 30 + nameSize).toString();
                const start = position + 30 + nameSize + extra;
                assert.equal(bytes.subarray(start, start + size).toString(), compiled.generatedFiles.find(file => file.path === name).content);
                position = start + size; count++;
            }
            assert.equal(count, compiled.generatedFiles.length);
        });
        await test('Horizontal and vertical pointer/keyboard splitters, reset and collapse', async () => {
            await page.locator('#tab-api').click();
            await resizePanel('Generated files and code');
            await page.locator('#tab-endpoints').click(); await resizePanel('Endpoints and details');
            await nav('projects'); await resizePanel('Projects and preview');
            await nav('editor'); await resizePanel('Editor and diagnostics');
            await nav('inspector'); await page.locator('#tab-api').click();
            for (const selector of ['.ide-files > .ide-splitter', '#ide-editor-split > .ide-splitter']) {
                if (selector.startsWith('#')) await nav('editor');
                const splitter = page.locator(selector), bounds = await splitter.boundingBox();
                const vertical = await splitter.getAttribute('aria-orientation') === 'horizontal';
                const before = Number(await splitter.getAttribute('aria-valuenow'));
                await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
                await page.mouse.move(bounds.x + bounds.width / 2 + (vertical ? 0 : 80), bounds.y + bounds.height / 2 + (vertical ? -80 : 0)); await page.mouse.up();
                assert.notEqual(Number(await splitter.getAttribute('aria-valuenow')), before);
                await splitter.focus(); await page.keyboard.press(vertical ? 'ArrowDown' : 'ArrowRight');
                await splitter.dblclick(); assert.equal(Number(await splitter.getAttribute('aria-valuenow')), before);
            }
            await page.locator('#ide-diagnostics-toggle').click(); assert.equal(await page.locator('.pipeline').isVisible(), false);
            await page.locator('#ide-diagnostics-toggle').click();
        });
        await test('Appearance themes/font/wrap/gutter, alignment, focus return and reset', async () => {
            const source = await editor.inputValue(), beforeCalls = server.calls.length;
            await page.locator('#ide-settings').click(); await shot('settings-1440');
            await page.locator('#ide-theme').selectOption('dracula');
            await page.locator('#ide-font').fill('20'); await page.locator('#ide-wrap').check(); await page.locator('#ide-numbers').uncheck();
            assert.equal(await page.locator('#line-numbers').isVisible(), false);
            await page.locator('#ide-numbers').check(); await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'ide-settings');
            assert.equal(await editor.inputValue(), source); assert.equal(server.calls.length, beforeCalls);
            await editor.fill('ENTITY Item\nname STRING DEFAULT "' + 'Unicode Ω words '.repeat(60) + '"\nid INT PRIMARY KEY');
            await page.waitForFunction(() => document.querySelectorAll('.dsl-line')[1].getBoundingClientRect().height > 40);
            await page.waitForFunction(() => [...document.querySelectorAll('.dsl-line')].every((line, i) => Math.abs(line.getBoundingClientRect().height - document.querySelectorAll('#line-numbers > div')[i].getBoundingClientRect().height) < 1));
            const alignment = await page.evaluate(() => [...document.querySelectorAll('.dsl-line')].map((line,i) => Math.abs(line.getBoundingClientRect().height - document.querySelectorAll('#line-numbers > div')[i].getBoundingClientRect().height)));
            assert(alignment.every(delta => delta < 1));
            await editor.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
            assert.equal(await editor.evaluate(node => node.scrollTop), await page.locator('#editor-backdrop').evaluate(node => node.scrollTop));
            await shot('wrapped-dracula-1440');
            await page.locator('#ide-settings').click(); await page.locator('#ide-theme').selectOption('one'); await shot('settings-one-dark-1440');
            await page.locator('#ide-reset-all').click(); await page.keyboard.press('Escape');
            assert.equal(await editor.evaluate(node => getComputedStyle(node).fontSize), '14px');
            assert.equal(await page.locator('html').getAttribute('data-theme'), 'default');
            await editor.fill(PROFESSOR_SOURCE);
        });
        await test('Large source bounded plain-text fallback', async () => {
            const long = '// long source\n'.repeat(11000);
            await editor.evaluate((node, source) => { node.value = source; node.dispatchEvent(new Event('input', { bubbles: true })); }, long);
            assert.equal(await editor.inputValue(), long); assert.equal(await page.locator('.dsl-line').count(), 0);
            assert.match(await page.locator('#ide-editor-mode').textContent(), /plain text/); await editor.fill(PROFESSOR_SOURCE);
        });
        await test('Paste and horizontal scroll preserve source and backdrop alignment', async () => {
            await editor.fill(''); await editor.focus();
            const pasted = '// Ω 😀 "quoted" <b> &\nENTITY Long\nname STRING DEFAULT "' + 'long '.repeat(400) + '"';
            await page.keyboard.insertText(pasted);
            assert.equal(await editor.inputValue(), pasted);
            await editor.evaluate(node => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event('scroll')); });
            assert.equal(await editor.evaluate(node => node.scrollLeft), await page.locator('#editor-backdrop').evaluate(node => node.scrollLeft));
            await editor.fill(PROFESSOR_SOURCE);
        });
        await test('Save modal cancel, explicit storage initialization, one save and clean save', async () => {
            await page.locator('#ide-save').click(); await page.locator('#ide-save-name').fill('Cancelled'); await shot('save-project-1440'); await page.locator('#ide-save-dialog [data-close]').click();
            assert.equal(await page.locator('#project-name').inputValue(), ''); assert.equal(f.mutations.length, 0);
            await nav('projects'); await page.locator('#project-open').click(); await idle(); assert.match(await page.locator('#project-message').textContent(), /PROJECT_STORE_MISSING/);
            await page.locator('#project-dialog-close').click(); await confirm('#project-initialize', false); assert.equal(f.mutations.length, 0);
            await confirm('#project-initialize', true); assert.equal(f.mutations.length, 0);
            await page.locator('#ide-save').click(); await page.locator('#ide-save-name').fill('University API');
            await page.locator('#ide-save-form button[type="submit"]').click(); await idle();
            assert.equal(f.mutations.length, 1); assert.deepEqual(f.mutations[0].input, { name: 'University API', source: PROFESSOR_SOURCE.replace(/\r\n?/g, '\n'), target: 'mysql' });
            await page.locator('#ide-save').click(); await page.locator('#ide-save-form button[type="submit"]').click(); await idle();
            assert.equal(f.mutations.length, 1); assert.match(await page.locator('#project-message').textContent(), /Already saved/);
            await page.locator('#project-open').click(); await idle();
            await page.getByRole('button', { name: 'Preview University API', exact: true }).click(); await idle();
            assert.equal(await page.locator('#project-preview-source').textContent(), PROFESSOR_SOURCE.replace(/\r\n?/g, '\n'));
            assert.equal(f.mutations.length, 1); await shot('saved-projects-1440'); await page.locator('#project-dialog-close').click();
            // Open preserves native modal containment; Preview remains inside it.
            await page.waitForFunction(() => document.activeElement === document.querySelector('#project-open'));
            await page.locator('#project-open').focus(); await page.keyboard.press('Enter'); await idle();
            await page.locator('#project-list .project-choice').waitFor();
            assert(await page.locator('#project-dialog').evaluate(node => node.matches(':modal')));
            await page.locator('#project-dialog-close').focus(); await page.keyboard.press('Shift+Tab');
            assert(await page.locator('#project-list .project-choice').evaluate(node => node === document.activeElement));
            await page.keyboard.press('Tab');
            assert(await page.locator('#project-dialog-close').evaluate(node => node === document.activeElement));
            await page.keyboard.press('Tab');
            assert(await page.getByRole('button', { name: 'Preview University API', exact: true }).evaluate(node => node === document.activeElement));
            await page.keyboard.press('Escape');
            assert(!await page.locator('#project-dialog').isVisible());
            assert(await page.locator('#project-open').evaluate(node => node === document.activeElement));
        });
        await test('Persistent navigation, explicit lifecycle and request state retention (controlled)', async () => {
            const calls = server.calls.length; await nav('persistent'); assert.equal(server.calls.length, calls);
            await page.locator('#persistent-reconnect').click(); await runtimeIdle(); await page.locator('#persistent-refresh').click(); await runtimeIdle();
            await confirm('#persistent-initialize', true); await runtimeIdle();
            await page.locator('#persistent-run').click(); await runtimeIdle();
            await page.locator('#persistent-query').fill('limit=20'); const identity = await page.locator('#persistent-identity').textContent();
            const divider = page.getByRole('separator', { name: 'Persistent request and response panel size' });
            await resizePanel('Persistent request and response');
            await divider.focus(); const oldRatio = await divider.getAttribute('aria-valuenow'); await page.keyboard.press('ArrowUp'); assert.notEqual(await divider.getAttribute('aria-valuenow'), oldRatio);
            const count = f.runtime.length; await nav('editor'); await nav('persistent'); assert.equal(f.runtime.length, count);
            assert.equal(await page.locator('#persistent-query').inputValue(), 'limit=20'); assert.equal(await page.locator('#persistent-identity').textContent(), identity);
            await page.locator('#persistent-send').click(); await runtimeIdle(); assert.match(await page.locator('#persistent-response').textContent(), /Fixture retained record/);
            await runtimeViews('persistent-api'); await page.locator('#persistent-stop').click(); await runtimeIdle();
        });
        await test('Verified stopped-session recovery is explicit and retains records (controlled)', async () => {
            await page.locator('#persistent-run').click(); await runtimeIdle();
            assert.equal(await page.locator('#persistent-forget').isDisabled(), true);
            f.stopped(); await page.locator('#persistent-refresh').click(); await runtimeIdle();
            assert.equal(await page.locator('#persistent-forget').isDisabled(), false);
            const count = f.runtime.length, records = JSON.stringify([...f.records]);
            await confirm('#persistent-forget', false); assert.equal(f.runtime.length, count);
            await confirm('#persistent-forget', true); await runtimeIdle();
            assert.equal(f.runtime.length, count); assert.equal(JSON.stringify([...f.records]), records);
            assert.equal(await page.locator('#persistent-forget').isDisabled(), true);
            await shot('persistent-recovered-1440');
        });
        await test('Disposable Live start/request/navigation/stop (controlled)', async () => {
            await nav('editor'); await compile(); await nav('inspector'); await page.locator('#tab-live-api').click();
            await page.locator('#live-start').click(); await page.locator('#live-send').waitFor();
            await page.locator('#live-query').fill('limit=20'); const count = liveCalls.length;
            const divider = page.getByRole('separator', { name: 'Live request and response panel size' });
            await resizePanel('Live request and response');
            await divider.focus(); const oldRatio = await divider.getAttribute('aria-valuenow'); await page.keyboard.press('ArrowUp'); assert.notEqual(await divider.getAttribute('aria-valuenow'), oldRatio);
            await nav('projects'); await nav('inspector'); assert.equal(liveCalls.length, count); assert.equal(await page.locator('#live-query').inputValue(), 'limit=20');
            await page.locator('#live-send').click(); await page.waitForFunction(() => document.querySelector('#live-response').textContent.includes('HTTP 200'));
            await runtimeViews('live-api'); await page.locator('#live-stop').click();
            await page.waitForFunction(() => document.querySelector('#live-status').textContent.includes('Stopped'));
        });
        await test('Source/target invalidation, diagnostics and Ctrl+Enter', async () => {
            await nav('editor'); await editor.fill('ENTITY Bad\nid UNKNOWN'); await editor.press('Control+Enter');
            await page.waitForFunction(() => document.querySelector('#error-panel').classList.contains('visible'));
            assert(await page.locator('.highlight-error').count()); await shot('editor-error-1440');
            await editor.fill(PROFESSOR_SOURCE); assert.equal(await page.locator('#download-btn').isVisible(), false);
            await compile(); await page.locator('[data-target="postgres"]').click(); assert.equal(await page.locator('#download-btn').isVisible(), false);
            assert.equal(await page.locator('.status-icon.pending').count(), 6);
            const postgres = await compile(); assert.equal(postgres.success, true);
            assert.match(postgres.generatedFiles.find(file => file.path.endsWith('.sql')).content, /CREATE TABLE "public"\."User"/);
            await nav('inspector'); assert.match(await page.locator('[data-summary-metric="target"]').textContent(), /PostgreSQL/);
            await shot('inspector-postgres-1440'); await page.locator('[data-target="mysql"]').click();
        });
        await test('Lost save acknowledgment preserves draft/revision and never replays the mutation', async () => {
            await nav('editor'); await editor.fill(PROFESSOR_SOURCE + '\n// acknowledged response lost'); await nav('projects');
            const oldRevision = await page.locator('#project-revision').textContent();
            await page.route('**/api/projects/*', async route => {
                if (route.request().method() !== 'PUT') return route.continue();
                await route.fetch(); // The fixture really commits before its acknowledgment is lost.
                return route.abort('connectionfailed');
            });
            const before = f.mutations.length; await save();
            assert.equal(f.mutations.length, before + 1); assert.equal(await page.locator('#project-revision').textContent(), oldRevision);
            assert.match(await page.locator('#project-status').textContent(), /unconfirmed/); assert.match(await editor.inputValue(), /acknowledged response lost/);
            await nav('persistent'); await nav('projects'); assert.equal(f.mutations.length, before + 1);
            await page.unroute('**/api/projects/*');
            await page.locator('#project-inspect').click(); await idle(); await confirm('#project-load-snapshot', true);
            assert.notEqual(await page.locator('#project-revision').textContent(), oldRevision);
        });
        await test('New/Open confirmation, conflict and uncertain-save lockouts', async () => {
            await nav('editor');
            await editor.fill(PROFESSOR_SOURCE + '\n// local edit'); await nav('projects');
            await confirm('#project-new', false); assert.match(await editor.inputValue(), /local edit/);
            await page.locator('#project-open').click(); await idle();
            await confirm('#project-list .project-choice', false); assert.match(await editor.inputValue(), /local edit/); await page.locator('#project-dialog-close').click();
            f.setFailure('PROJECT_REVISION_CONFLICT'); await save();
            assert.equal(await page.locator('#project-save').isDisabled(), true); assert.match(await page.locator('#project-status').textContent(), /Conflict/);
            await page.locator('#project-inspect').click(); await idle(); await confirm('#project-load-snapshot', true);
            f.setFailure('PROJECT_COMMIT_UNCERTAIN'); await nav('editor'); await editor.fill(PROFESSOR_SOURCE + '\n// uncertain draft'); await nav('projects');
            await save(); const count = f.mutations.length;
            assert.equal(await page.locator('#project-save').isDisabled(), true); assert.match(await page.locator('#project-status').textContent(), /unconfirmed/);
            await nav('persistent'); await nav('projects'); assert.equal(f.mutations.length, count);
            await shot('save-uncertain-1440');
        });
        await test('Laptop/mobile workspaces, tabs, dialogs and no horizontal page overflow', async () => {
            f.setFailure(null); await nav('projects'); await page.locator('#project-inspect').click(); await idle();
            await confirm('#project-load-snapshot', true); await nav('editor'); await compile();
            await editor.evaluate(node => { node.scrollTop = node.scrollLeft = 0; node.dispatchEvent(new Event('scroll')); });
            // Equivalent to the legacy simultaneous-panel geometry contract: each
            // workspace is usable on entry, preserves source, and keeps actions reachable.
            const retainedSource = await editor.inputValue();
            for (const height of [768, 640]) {
                await page.setViewportSize({ width: 1440, height }); await nav('editor');
                const before = await editor.boundingBox(); assert(before.height >= 120);
                await nav('persistent'); assert(await page.locator('#persistent-panel').isVisible());
                assert(!await editor.isVisible());
                await nav('editor'); assert.deepEqual(await editor.boundingBox(), before);
                assert.equal(await editor.inputValue(), retainedSource);
            }
            for (const [width,height] of [[1366,768],[390,844]]) {
                await page.setViewportSize({ width,height });
                for (const name of ['editor','inspector','projects','persistent']) {
                    await nav(name); await shot(name + '-' + width);
                    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                    assert(await page.locator('#compile-btn').isVisible()); assert(await page.locator('#ide-save').isVisible());
                }
                await nav('editor');
                for (const selector of ['#compile-btn', '#clear-btn', '#ide-save', '.target-option[data-target="mysql"]', '.target-option[data-target="postgres"]']) {
                    const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
                    assert(await control.isVisible()); assert(await control.isEnabled());
                    assert(await control.evaluate(node => {
                        const box = node.getBoundingClientRect(), parent = node.closest('.app-header, .editor-header').getBoundingClientRect();
                        return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom
                            && box.left >= 0 && box.right <= innerWidth && box.height >= 30;
                    }), selector + ' is contained in its intended IDE header at ' + width);
                }
                await nav('inspector'); await page.locator('#tab-api').click(); await shot('generated-files-' + width);
                await page.locator('#ide-settings').click(); await shot('settings-' + width); await page.keyboard.press('Escape');
                await page.locator('#ide-save').click(); await shot('save-project-' + width); await page.keyboard.press('Escape');
                await nav('inspector'); await page.locator('#tab-swagger').click(); assert(await page.locator('#output-swagger').isVisible());
            }
        });
        await test('No browser storage, duplicate IDs or runtime JavaScript errors', async () => {
            assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0,0]);
            assert.deepEqual(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(n => n.id); return ids.filter((id,i) => ids.indexOf(id) !== i); }), []);
            assert.deepEqual(errors, []);
        });
    } finally {
        if (evidence) fs.writeFileSync(path.join(evidence, 'new-ui-test-results.json'), JSON.stringify(results, null, 2));
        await browser.close(); await server.stop();
    }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { fixture };
