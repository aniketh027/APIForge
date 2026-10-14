'use strict';
// Real Chromium and compiler HTTP handler, with explicit in-memory Project/Persistent
// factories. Edge responses are separately labelled controlled presentation fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./frontend-persistent-runtime-server');
const { fixture } = require('./frontend-ide-ui.test');
const { sourceFrame } = require('../src/utils/source-frame');
const evidence = process.env.APIFORGE_DIAGNOSTICS_EVIDENCE;
const results = [];
const SOURCE = '// premium diagnostics\nENTITY Article\nid INT PRIMARY KEY\ntitle STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 1';
const FIXED = SOURCE.replace('MAX_LENGTH 1', 'MAX_LENGTH 120');
const states = { lexer: 'succeeded', parser: 'succeeded', semantic: 'failed', ir: 'skipped', optimizer: 'skipped', codegen: 'skipped' };
async function main() {
    const f = fixture(), server = await serve(f), browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/')) requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() }); });
    const editor = page.locator('#dsl-editor'), bottom = page.locator('#ide-diagnostic-detail'), inspector = page.locator('#error-panel');
    const nav = name => page.locator(`[data-workspace="${name}"]`).click();
    const shot = async name => { if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png') }); };
    async function compile(source) {
        await nav('editor'); if (source !== undefined) await editor.fill(source);
        const response = page.waitForResponse(r => r.url().endsWith('/api/compile'));
        await page.locator('#compile-btn').click(); const reply = await response, data = await reply.json();
        await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
        return { data, request: reply.request().postDataJSON(), status: reply.status() };
    }
    async function controlled(diagnostics, source = SOURCE, phase = 'semantic') {
        await page.route('**/api/compile', route => route.fulfill({ status: 422, json: { success: false, phase, phaseStates: states, diagnostics } }));
        try { return await compile(source); } finally { await page.unroute('**/api/compile'); }
    }
    async function test(name, action) {
        try { await action(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
        catch (error) { results.push({ name, status: 'FAIL', reason: error.stack }); await shot('failure'); throw error; }
    }
    async function noOverflow() {
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    }
    async function alignPointer(card, column) {
        const alignment = await card.evaluate((node, col) => {
            const text = node.querySelector('.error-source-line .error-source-text').firstChild;
            const range = document.createRange(); range.setStart(text, col - 1); range.collapse(true);
            return { source: range.getBoundingClientRect().left, pointer: node.querySelector('.error-caret').getBoundingClientRect().left };
        }, column);
        assert(Math.abs(alignment.source - alignment.pointer) < 1, JSON.stringify(alignment));
    }
    let semantic;
    try {
        await page.goto(server.origin);
        await test('Real SEM018: exact request, authoritative message/location, highlight and all six statuses', async () => {
            const response = await compile(SOURCE); semantic = response.data;
            assert.equal(response.status, 422); assert.deepEqual(response.request, { source: SOURCE, target: 'mysql' });
            assert.equal(semantic.diagnostics[0].code, 'SEM018');
            assert.equal(await bottom.locator('.error-code').textContent(), 'SEM018');
            assert.equal(await bottom.locator('.error-message-text').textContent(), semantic.diagnostics[0].message);
            assert.equal(await bottom.locator('.diagnostic-title').textContent(), 'Semantic Analysis Failed');
            assert.equal(await page.locator('#ide-diagnostic-count').textContent(), '1 problem');
            const d = semantic.diagnostics[0];
            assert.equal(await bottom.locator('button.error-location').textContent(), `Line ${d.line}, Column ${d.column}`);
            assert(await page.locator(`.dsl-line:nth-child(${d.line})`).evaluate(n => n.classList.contains('highlight-error')));
            for (const [phase, state] of Object.entries(states)) assert(await page.locator(`#status-${phase} .status-icon`).evaluate((n, cls) => n.classList.contains(cls), state === 'succeeded' ? 'success' : state === 'failed' ? 'error' : 'skipped'));
            assert.equal(await bottom.locator('.error-excerpt').count(), 0);
        });
        await test('Default, expanded/resized, Inspector and recovery screenshots at 1440×900, 1366×768 and 390px', async () => {
            for (const [width, height] of [[1440,900], [1366,768], [390,844]]) {
                await page.setViewportSize({ width, height }); await compile(SOURCE); await noOverflow();
                await editor.press('Control+Home');
                assert(await bottom.locator('.error-message-text').evaluate(node => {
                    const r = node.getBoundingClientRect(), p = node.closest('#ide-diagnostic-detail').getBoundingClientRect();
                    return r.top >= p.top && r.bottom <= p.bottom + 1;
                }), 'Default error message fits without scrolling');
                assert(await page.locator('.pipeline-track').evaluate(node => {
                    const r = node.getBoundingClientRect(), p = node.closest('#ide-diagnostics').getBoundingClientRect();
                    return r.top >= p.top && r.bottom <= p.bottom;
                }), 'All six phase indicators fit');
                await shot(`semantic-default-${width}`);
                const toggle = bottom.locator('.diagnostic-details-toggle'); await toggle.focus(); await toggle.press('Enter');
                assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
                assert.equal(await bottom.locator('.error-hint').textContent(), 'Hint: ' + semantic.diagnostics[0].hint);
                const frame = sourceFrame(SOURCE, semantic.diagnostics[0])[0];
                assert.equal(await bottom.locator('.error-source-line .error-source-text').first().textContent(), frame.text);
                await alignPointer(bottom.locator('.error-card').first(), semantic.diagnostics[0].column);
                const separator = page.getByRole('separator', { name: 'Editor and diagnostics panel size', exact: true });
                const box = await separator.boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + 2); await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, box.y - 180, { steps: 5 }); await page.mouse.up();
                assert(Number(await separator.getAttribute('aria-valuenow')) < 70);
                await shot(`semantic-expanded-${width}`); await noOverflow();
                const calls = requests.length; await nav('inspector');
                assert.equal(await inspector.locator('.error-message-text').textContent(), semantic.diagnostics[0].message);
                assert.equal(await inspector.locator('.error-hint').textContent(), 'Hint: ' + semantic.diagnostics[0].hint);
                await alignPointer(inspector.locator('.error-card').first(), semantic.diagnostics[0].column);
                assert.equal(await page.locator('.tab-btn').count(), 11);
                await shot(`semantic-inspector-${width}`); await noOverflow();
                await nav('editor'); assert.equal(requests.length, calls); assert.equal(await editor.inputValue(), SOURCE);
                await separator.press('Home'); await compile(FIXED);
                assert.equal(await bottom.locator('.error-card').count(), 0); assert.equal(await inspector.locator('.error-card').count(), 0);
                assert.equal(await bottom.textContent(), 'All phases completed');
                assert.equal(await page.locator('.status-item .status-icon.success').count(), 6);
                await shot(`success-editor-${width}`); await nav('inspector');
                assert(await page.locator('#compilation-summary').isVisible());
                await page.locator('[data-tab="api"]').click(); assert(await page.locator('.ide-file-list button').count() > 0);
                assert(await page.locator('#download-btn').isVisible()); await shot(`success-inspector-${width}`);
                await nav('editor');
            }
            await page.setViewportSize({ width: 1440, height: 900 });
        });
        await test('Keyboard location navigation from Inspector preserves exact source, caret and error highlight', async () => {
            const source = '// context\n'.repeat(70) + SOURCE; const { data } = await compile(source); const d = data.diagnostics[0];
            await nav('inspector'); const calls = requests.length;
            await inspector.locator('button.error-location').focus(); await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.activeElement === document.querySelector('#dsl-editor'));
            const offset = source.split('\n').slice(0, d.line - 1).reduce((total, line) => total + line.length + 1, 0) + d.column - 1;
            assert.deepEqual(await editor.evaluate(n => [n.selectionStart, n.selectionEnd]), [offset, offset]);
            assert.equal(await editor.inputValue(), source); assert.equal(requests.length, calls);
            assert(await editor.evaluate(n => n.scrollTop > 0));
            assert(await page.locator(`.dsl-line:nth-child(${d.line})`).evaluate(n => n.classList.contains('highlight-error')));
            await editor.press('ArrowLeft'); assert.equal(await inspector.locator('.error-card').count(), 1);
            await editor.press('End'); await editor.press('x'); assert.equal(await inspector.locator('.error-card').count(), 0);
        });
        await test('Real multiple semantic diagnostics retain order, count, hints, frames and independent locations', async () => {
            const source = SOURCE + '\nsubtitle STRING MIN_LENGTH 9 MAX_LENGTH 2\nrating INT MIN 9 MAX 1';
            const { data } = await compile(source); assert(data.diagnostics.length >= 3);
            assert.equal(await bottom.locator('.error-card').count(), data.diagnostics.length);
            assert.equal(await bottom.locator('.diagnostic-count').textContent(), `${data.diagnostics.length} problems`);
            await bottom.locator('.diagnostic-details-toggle').click();
            for (let i = 0; i < data.diagnostics.length; i++) {
                const card = bottom.locator('.error-card').nth(i), d = data.diagnostics[i];
                assert.equal(await card.locator('.error-code').textContent(), d.code);
                assert.equal(await card.locator('.error-message-text').textContent(), d.message);
                assert.equal(await card.locator('.error-hint').textContent(), 'Hint: ' + d.hint);
                await card.locator('button.error-location').click();
                assert.equal(await editor.evaluate(n => n.value.slice(0, n.selectionStart).split('\n').length), d.line);
            }
            await shot('multiple-real-errors');
        });
        await test('Real lexer and parser errors use actual codes and do not invent successful later phases', async () => {
            for (const [source, phase, code] of [['ENTITY Sample\nvalue FLOAT DEFAULT 8.', 'lexer', 'LEX004'], ['ENTITY Sample\nvalue', 'parser', 'PAR012']]) {
                const { data } = await compile(source); assert.equal(data.phase, phase); assert.equal(data.diagnostics[0].code, code);
                assert.equal(await bottom.locator('.error-code').textContent(), code);
                assert.equal(await page.locator(`#status-${phase}`).getAttribute('aria-label'), `${phase === 'lexer' ? 'Lexer' : 'Parser'} phase: failed`);
                await shot(phase + '-real-error');
            }
        });
        await test('Collapsed preference survives failures/recovery; visible count, disclosure and keyboard splitter work', async () => {
            await page.locator('#ide-diagnostics-toggle').click();
            await compile(SOURCE); assert(await page.locator('#ide-editor-split').evaluate(n => n.classList.contains('diagnostics-collapsed')));
            assert(await page.locator('#ide-diagnostic-count').isVisible()); assert.equal(await bottom.isVisible(), false); await shot('collapsed-error');
            await compile(FIXED); assert.equal(await page.locator('#ide-diagnostic-count').isVisible(), false);
            assert(await page.locator('#ide-editor-split').evaluate(n => n.classList.contains('diagnostics-collapsed')));
            await page.locator('#ide-diagnostics-toggle').press('Enter'); await compile(SOURCE);
            const toggle = bottom.locator('.diagnostic-details-toggle'); await toggle.press('Enter'); await toggle.press('Enter');
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
            const divider = page.getByRole('separator', { name: 'Editor and diagnostics panel size', exact: true });
            const original = Number(await divider.getAttribute('aria-valuenow'));
            await divider.focus(); await divider.press('ArrowUp'); assert.equal(Number(await divider.getAttribute('aria-valuenow')), original - 2); await divider.press('Home');
        });
        await test('Controlled HTML/script-like text and Unicode remain exact inert text in both views', async () => {
            const message = '<img src=x onerror="window.diagnosticExecuted=true">\n<script>alert(1)</script> Ω 🎯', hint = 'Use <safe> & "exact" text.';
            await controlled([{ phase: 'semantic', code: '<SEM>', message, hint, line: 4, column: 23 }]);
            assert.equal(await bottom.locator('.error-message-text').textContent(), message);
            await bottom.locator('.diagnostic-details-toggle').click(); assert.equal(await bottom.locator('.error-hint').textContent(), 'Hint: ' + hint);
            await nav('inspector'); assert.equal(await inspector.locator('.error-message-text').textContent(), message);
            assert.equal(await page.locator('.error-card img, .error-card script').count(), 0);
            assert.equal(await page.evaluate(() => window.diagnosticExecuted), undefined); await nav('editor');
        });
        await test('Controlled absent, zero, invalid and out-of-range coordinates are safe and never clickable', async () => {
            const diagnostics = [{ message: 'No location' }, { message: 'Line only', line: 4 }, { message: 'Column only', column: 9 },
                { message: 'Zero', line: 0, column: 0 }, { message: 'Negative', line: -1, column: 2 },
                { message: 'Beyond source', line: 999, column: 4 }, { message: 'Beyond line', line: 4, column: 9999 },
                { message: 'Fraction', line: 4.2, column: 2 }, { message: 'String coordinates', line: '4', column: '2' }, null, 'unknown'];
            await controlled(diagnostics); assert.equal(await bottom.locator('.error-card').count(), diagnostics.length);
            assert.equal(await bottom.locator('button.error-location').count(), 0);
            await bottom.locator('.diagnostic-details-toggle').click(); assert.equal(await bottom.locator('.error-caret').count(), 0);
            assert.equal(await editor.inputValue(), SOURCE);
        });
        await test('Controlled long lines, tabs and Unicode prefixes align pointers without page overflow', async () => {
            const source = 'ENTITY Sample\n\t// 漢字 🎯 e\u0301 Ω ' + 'long_'.repeat(100) + 'error';
            const column = source.split('\n')[1].indexOf('error') + 1;
            await controlled([{ phase: 'codegen', code: 'GEN001', message: 'long_identifier_'.repeat(200), line: 2, column, hint: 'Compiler supplied hint' }], source, 'codegen');
            await bottom.locator('.diagnostic-details-toggle').click(); await alignPointer(bottom.locator('.error-card'), column);
            await bottom.locator('button.error-location').click(); assert(await editor.evaluate(n => n.scrollLeft > 0));
            for (const [width, height] of [[1440,900], [1366,768], [390,844]]) {
                await page.setViewportSize({ width, height }); await noOverflow(); await shot(`long-unicode-${width}`);
            }
            await page.setViewportSize({ width: 1440, height: 900 });
        });
        await test('Controlled large diagnostic sets have exact totals, bounded cards and working ordered pagination', async () => {
            const diagnostics = Array.from({ length: 1001 }, (_, i) => ({ phase: 'ir', code: `T${i}`, message: `Issue ${i}`, line: 4, column: 1 }));
            await controlled(diagnostics, SOURCE, 'ir');
            assert.equal(await bottom.locator('.diagnostic-count').textContent(), '1001 problems');
            assert.equal(await bottom.locator('.error-card').count(), 50); assert.equal(await inspector.locator('.error-card').count(), 50);
            await bottom.locator('.diagnostic-more').click(); assert.equal(await bottom.locator('.error-card').count(), 100);
            assert.equal(await bottom.locator('.error-code').nth(99).textContent(), 'T99');
            await nav('inspector'); await inspector.locator('.diagnostic-more').click(); assert.equal(await inspector.locator('.error-card').count(), 100);
            assert(await inspector.evaluate(n => n.clientHeight >= n.scrollHeight), 'Inspector cards do not hide inside a clipped container');
            await nav('editor'); assert.equal(await bottom.locator('.error-card').count(), 100);
        });
        await test('Keyboard pagination retains visible focus on newly revealed diagnostics for Enter/Space, details and all location states', async () => {
            for (const view of ['collapsed', 'expanded', 'inspector']) {
                for (const location of ['absent', 'excerpt-only', 'clickable']) {
                    for (const key of ['Enter', 'Space']) {
                        const coordinates = location === 'clickable' ? { line: 4, column: 1 } : location === 'excerpt-only' ? { line: 4 } : {};
                        const diagnostics = Array.from({ length: 101 }, (_, i) => ({ phase: 'ir', code: `P${i}`, message: `Pagination issue ${i}`, ...coordinates }));
                        await controlled(diagnostics, SOURCE, 'ir');
                        const pane = view === 'inspector' ? inspector : bottom;
                        if (view === 'expanded') await bottom.locator('.diagnostic-details-toggle').click();
                        if (view === 'inspector') await nav('inspector');
                        const selection = await editor.evaluate(n => [n.selectionStart, n.selectionEnd, n.selectionDirection]);
                        for (const [firstNew, count] of [[50, 100], [100, 101]]) {
                            await pane.locator('.diagnostic-more').focus(); await page.keyboard.press(key);
                            assert.equal(await pane.locator('.error-card').count(), count);
                            assert.equal(await pane.locator('.diagnostic-count').textContent(), '101 problems');
                            assert.deepEqual(await pane.locator('.error-code').allTextContents(), diagnostics.slice(0, count).map(d => d.code));
                            const card = pane.locator('.error-card').nth(firstNew);
                            const focus = await card.evaluate(node => {
                                const active = document.activeElement, panel = node.closest('#ide-diagnostic-detail, #error-panel');
                                const r = active.getBoundingClientRect(), bounds = (panel.id === 'error-panel' ? panel.parentElement : panel).getBoundingClientRect();
                                const style = getComputedStyle(active);
                                return { within: node.contains(active), tag: active.tagName, visible: active.matches(':focus-visible'),
                                    outlined: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
                                    inView: r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1,
                                    top: r.top, bottom: r.bottom, panelTop: bounds.top, panelBottom: bounds.bottom };
                            });
                            assert(focus.within && focus.visible && focus.outlined && focus.inView, `${view}/${location}/${key}: ${JSON.stringify(focus)}`);
                            assert.equal(focus.tag, location === 'clickable' ? 'BUTTON' : location === 'excerpt-only' && view !== 'collapsed' ? 'DIV' : 'ARTICLE');
                            assert.equal(await editor.inputValue(), SOURCE);
                            assert.deepEqual(await editor.evaluate(n => [n.selectionStart, n.selectionEnd, n.selectionDirection]), selection);
                            if (view !== 'inspector') assert.equal(await bottom.locator('.diagnostic-details-toggle').getAttribute('aria-expanded'), String(view === 'expanded'));
                        }
                        assert.equal(await pane.locator('.diagnostic-more').count(), 0);
                        if (location === 'absent' && key === 'Space') await shot(`pagination-focus-${view}`);
                        if (location === 'clickable') {
                            await pane.locator('.error-card').nth(100).locator('button.error-location').press('Enter');
                            assert(await editor.evaluate(n => document.activeElement === n));
                            assert.equal(await editor.evaluate(n => n.selectionStart), SOURCE.lastIndexOf('title'));
                            assert.equal(await editor.inputValue(), SOURCE);
                        }
                    }
                }
            }
        });
        await test('Wrapped source, UTF-16 positions, BOM, EOF and large plain-text navigation preserve source/caret', async () => {
            const source = '\uFEFF// Ω 🎯\n' + '// context\n'.repeat(40) + '// ' + 'word '.repeat(150) + 'error';
            const line = source.split('\n').length, column = source.split('\n').at(-1).indexOf('error') + 1;
            await controlled([{ phase: 'optimizer', message: 'Controlled wrapped location', line, column }], source, 'optimizer');
            await page.locator('#ide-settings').click(); await page.locator('#ide-wrap').check(); await page.locator('#ide-settings-dialog [data-close]').click();
            await bottom.locator('button.error-location').click();
            const offset = source.lastIndexOf('error'); assert.equal(await editor.evaluate(n => n.selectionStart), offset);
            assert.equal(await editor.inputValue(), source);
            const visible = await editor.evaluate((n, col) => {
                const row = document.querySelector('#editor-highlights').lastElementChild;
                const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let remaining = col - 1, text;
                while ((text = walker.nextNode())) {
                    if (remaining <= text.length) { const range = document.createRange(); range.setStart(text, remaining); range.collapse(true);
                        const r = range.getBoundingClientRect(), b = n.getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom; }
                    remaining -= text.length;
                }
                return false;
            }, column); assert(visible, 'Wrapped caret is in view');
            await page.locator('#ide-settings').click(); await page.locator('#ide-wrap').uncheck(); await page.locator('#ide-settings-dialog [data-close]').click();
            const large = '// ' + 'x'.repeat(155000) + '\n';
            await controlled([{ message: 'Controlled large-source EOF', line: 2, column: 1 }], large);
            await bottom.locator('button.error-location').click();
            assert.equal(await editor.evaluate(n => n.selectionStart), large.length); assert.equal(await editor.inputValue(), large);
            assert.equal(await editor.evaluate(n => n.scrollLeft), 0);
            await controlled([{ message: 'Controlled large-source column', line: 1, column: 154999 }], large);
            await bottom.locator('button.error-location').click();
            assert.equal(await editor.evaluate(n => n.selectionStart), 154998); assert(await editor.evaluate(n => n.scrollLeft > 0));
        });
        await test('Source and target invalidation remove old locations/highlights and suppress delayed failure responses', async () => {
            await compile(SOURCE); await editor.fill(FIXED);
            assert.equal(await bottom.locator('.error-card').count(), 0); assert.equal(await inspector.locator('button.error-location').count(), 0);
            await compile(SOURCE); await page.locator('[data-target="postgres"]').click();
            assert.equal(await bottom.locator('.error-card').count(), 0); assert.equal(await page.locator('.dsl-line.highlight-error').count(), 0);
            await page.locator('[data-target="mysql"]').click();
            for (const kind of ['source', 'target']) {
                await editor.fill(SOURCE);
                let release, entered; const held = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { entered = resolve; });
                await page.route('**/api/compile', async route => { const reply = await route.fetch(); entered(); await held; await route.fulfill({ response: reply }); });
                try {
                    await page.locator('#compile-btn').click(); await arrived;
                    if (kind === 'source') { await editor.fill(FIXED); await editor.fill(SOURCE); }
                    else { await page.locator('[data-target="postgres"]').click(); await page.locator('[data-target="mysql"]').click(); }
                    release(); await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
                    assert.equal(await bottom.locator('.error-card').count(), 0); assert.equal(await inspector.locator('.error-card').count(), 0);
                } finally { release(); await page.unroute('**/api/compile'); }
            }
        });
        await test('Controlled server, incomplete and network failures recover without invented codes/locations', async () => {
            await controlled([{ phase: 'internal', code: 'INT001', message: 'Controlled internal failure' }], SOURCE, 'internal');
            assert.equal(await bottom.locator('button.error-location').count(), 0);
            await page.route('**/api/compile', route => route.fulfill({ status: 500, json: { success: false } }));
            try { await compile(SOURCE); assert.equal(await bottom.locator('.error-message-text').textContent(), 'Unknown compilation error.'); }
            finally { await page.unroute('**/api/compile'); }
            await page.route('**/api/compile', route => route.abort('failed'));
            try {
                await page.locator('#compile-btn').click(); await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
                assert.match(await bottom.locator('.error-message-text').textContent(), /Failed to connect/);
                assert.equal(await bottom.locator('.error-code').count(), 0); assert.equal(await bottom.locator('button.error-location').count(), 0);
                assert.equal(await page.locator('#pipeline-state').textContent(), 'Compiler unavailable'); await shot('network-fixture-error');
            } finally { await page.unroute('**/api/compile'); }
            await compile(FIXED); assert.equal(await bottom.locator('.error-card').count(), 0);
        });
        await test('One canonical error alert, no duplicate IDs/storage, no unexpected Save/runtime calls or JS errors', async () => {
            await compile(SOURCE); await bottom.locator('.diagnostic-details-toggle').click(); await nav('inspector');
            assert.equal(await page.locator('#error-panel[role="alert"][aria-live="assertive"]').count(), 1);
            assert.equal(await bottom.locator('[role="alert"], [aria-live]').count(), 0);
            assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll('[id]')].map(n => n.id)).size === document.querySelectorAll('[id]').length), true);
            assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
            assert.deepEqual(f.mutations, []); assert.deepEqual(f.runtime, []); assert.deepEqual(errors, []);
            assert.deepEqual(requests.filter(r => r.method !== 'GET' && r.path !== '/api/compile'), []);
        });
    } finally {
        if (evidence) fs.writeFileSync(path.join(evidence, 'diagnostics-results.json'), JSON.stringify({ chromium: browser.version(), results, requests, javascriptErrors: errors }, null, 2));
        await browser.close(); await server.stop();
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
