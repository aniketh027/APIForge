'use strict';
// Real Chromium geometry; real compiler; explicit in-memory factories only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./frontend-persistent-runtime-server');
const { fixture } = require('./frontend-ide-ui.test');
const evidence = process.env.APIFORGE_LAYOUT_EVIDENCE;
const viewports = [[1440, 900], [1366, 768], [1440, 720], [1366, 680], [390, 844], [1440, 741], [1440, 740], [1440, 739]];
const source = '// layout source position\n'.repeat(45) + 'ENTITY Article\nid INT PRIMARY KEY\ntitle STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 1';
const results = [], geometry = [];

async function measure(page, label) {
    const value = await page.evaluate(() => {
        const rect = selector => {
            const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect();
            return { x, y, width, height, bottom };
        };
        const shell = document.querySelector('.app-shell'), body = getComputedStyle(document.body);
        return { viewport: { width: innerWidth, height: innerHeight }, shell: rect('.app-shell'),
            workbench: rect('.workbench'), status: rect('.ide-statusbar'), editor: rect('.editor-wrapper'),
            rows: getComputedStyle(shell).gridTemplateRows, bodyOverflow: body.overflowY,
            scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            bodyScroll: { width: document.body.scrollWidth, height: document.body.scrollHeight },
            open: document.querySelector('#persistent-workspace').open, current: APIForgeIDE.current };
    });
    geometry.push({ label, ...value });
    return value;
}
function fullViewport(value) {
    const { width, height } = value.viewport;
    assert(Math.abs(value.shell.height - height) < 1, 'shell height: ' + JSON.stringify(value));
    assert(Math.abs(value.shell.width - width) < 1 && value.shell.x === 0 && value.shell.y === 0, 'shell fills viewport');
    assert(Math.abs(value.status.bottom - height) < 1, 'status bar stays at viewport bottom');
    const expected = width <= 640 ? [96, 52, height - 174, 26] : [58, height - 86, 28];
    const rows = value.rows.split(' ').map(parseFloat);
    assert.equal(rows.length, expected.length, 'IDE row count');
    rows.forEach((row, i) => assert(Math.abs(row - expected[i]) < 1, 'IDE row geometry'));
    assert.equal(value.bodyOverflow, 'hidden', 'navigation preserves body overflow');
    assert(value.scroll.width <= width && value.scroll.height <= height, 'no page scrollbar');
    assert(value.bodyScroll.width <= width && value.bodyScroll.height <= height, 'no body overflow');
}
async function retainedState(page) {
    return page.evaluate(() => {
        const editor = document.querySelector('#dsl-editor'), divider = document.querySelector('#ide-editor-split > .ide-splitter');
        return { source: editor.value, selection: [editor.selectionStart, editor.selectionEnd, editor.selectionDirection],
            scroll: [editor.scrollTop, editor.scrollLeft], cursor: document.querySelector('#ide-cursor').textContent,
            ratio: document.querySelector('#ide-editor-split').style.getPropertyValue('--split-ratio'),
            splitter: divider.getAttribute('aria-valuenow'), diagnostics: document.querySelector('#ide-diagnostic-detail').innerHTML,
            inspectorDiagnostics: document.querySelector('#error-panel').innerHTML, pipeline: document.querySelector('.pipeline').innerHTML,
            summary: document.querySelector('#compilation-summary').innerHTML };
    });
}
async function main() {
    const f = fixture(), storageCalls = [];
    for (const name of ['initializeProjectStore', 'openProjectStore']) {
        f.storeApi[name] = async () => { storageCalls.push(name); throw Error('Navigation must not open or initialize storage'); };
    }
    const server = await serve(f);
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        console.log('Chromium ' + browser.version());
        for (const mode of ['sidebar', 'programmatic']) for (const [width, height] of viewports) {
            const name = `${mode}-${width}x${height}`;
            const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
            const errors = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
            const nav = async view => {
                if (mode === 'sidebar') await page.locator(`[data-workspace="${view}"]`).click();
                else await page.evaluate(view => APIForgeIDE.navigate(view, true), view);
                await page.waitForFunction(view => APIForgeIDE.current === view, view);
            };
            const shot = async suffix => {
                if (evidence && mode === 'sidebar') await page.screenshot({ path: path.join(evidence, `${name}-${suffix}.png`) });
            };
            try {
                await page.goto(server.origin);
                await page.locator('#dsl-editor').fill(source);
                const response = page.waitForResponse(r => r.url().endsWith('/api/compile'));
                await page.locator('#compile-btn').click();
                const compilation = await (await response).json();
                assert.equal(compilation.success, false);
                assert(compilation.diagnostics.some(d => d.code === 'SEM018'), 'real diagnostic fixture');
                await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
                const splitter = page.getByRole('separator', { name: 'Editor and diagnostics panel size', exact: true });
                await splitter.press('ArrowUp'); await splitter.press('ArrowUp');
                await page.locator('#dsl-editor').evaluate(node => {
                    node.setSelectionRange(28, 36, 'forward'); node.scrollTop = 80; node.scrollLeft = 0;
                    node.dispatchEvent(new Event('scroll')); APIForgeEditor.render();
                });
                // Let editor measurement settle before capturing the retained position.
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const original = await measure(page, name + '-initial'), state = await retainedState(page);
                fullViewport(original); assert.notEqual(state.splitter, '70');
                await page.evaluate(() => { window.layoutEditor = document.querySelector('#dsl-editor'); window.layoutCard = document.querySelector('#ide-diagnostic-detail .error-card'); });
                const calls = server.calls.length, count = requests.length;
                await shot('editor-before');
                for (let cycle = 1; cycle <= 3; cycle++) {
                    await nav('persistent');
                    assert(await page.locator('#persistent-workspace').isVisible());
                    assert(await page.locator('#persistent-panel').isVisible());
                    assert(await page.locator('.editor-panel').isHidden());
                    const persistent = await measure(page, name + '-persistent-' + cycle);
                    try { fullViewport(persistent); }
                    catch (error) {
                        await shot('persistent'); await nav('editor');
                        await measure(page, name + '-editor-' + cycle); await shot('editor-restored');
                        throw error;
                    }
                    assert.equal(persistent.open, true);
                    const bounds = await page.locator('#persistent-workspace').boundingBox();
                    assert(Math.abs(bounds.height - persistent.workbench.height) < 1, 'dedicated workspace fills workbench');
                    if (cycle === 1) await shot('persistent');
                    await nav('editor');
                    assert(await page.locator('.editor-panel').isVisible());
                    assert(await page.locator('#persistent-workspace').isHidden());
                    const restored = await measure(page, name + '-editor-' + cycle);
                    fullViewport(restored); assert.deepEqual(restored.editor, original.editor, 'editor height restored');
                    assert.equal(restored.open, true, 'disclosure may stay open');
                    assert.deepEqual(await retainedState(page), state, 'source, selection, scroll, diagnostics and splitter preserved');
                }
                for (const view of ['inspector', 'projects']) {
                    await nav(view); fullViewport(await measure(page, name + '-' + view));
                    assert(await page.locator(view === 'inspector' ? '.output-panel' : '#ide-projects').isVisible());
                    if (view === 'inspector') assert(await page.locator('#error-panel .error-card').count());
                    await shot(view);
                }
                // Existing disclosure launcher also enters the dedicated IDE workspace.
                await page.locator('#persistent-launcher').click();
                assert.equal(await page.evaluate(() => APIForgeIDE.current), 'persistent');
                fullViewport(await measure(page, name + '-launcher'));
                await nav('editor'); fullViewport(await measure(page, name + '-final'));
                await shot('editor-restored');
                assert.deepEqual(await retainedState(page), state);
                assert(await page.evaluate(() => layoutEditor === document.querySelector('#dsl-editor') && layoutCard === document.querySelector('#ide-diagnostic-detail .error-card')));
                assert.equal(server.calls.length, calls, 'navigation issues no backend requests');
                assert.equal(requests.length, count, 'no unexpected frontend API requests');
                assert.deepEqual(storageCalls, []); assert.deepEqual(f.mutations, []); assert.deepEqual(f.runtime, []);
                assert.deepEqual(errors, []);
                results.push({ name, status: 'PASS' }); console.log('PASS ' + name);
            } catch (error) {
                results.push({ name, status: 'FAIL', reason: error.stack }); console.error('FAIL ' + name + ': ' + error.message);
                await shot('failure').catch(() => {});
            } finally { await page.close(); }
        }
        for (const height of [741, 740, 739]) {
            const name = 'legacy-1440x' + height;
            const page = await browser.newPage({ viewport: { width: 1440, height } });
            try {
                // Disable only IDE startup, retaining the original legacy DOM and clients.
                await page.route('**/ide-shell.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
                await page.goto(server.origin);
                const calls = server.calls.length;
                await page.locator('#persistent-launcher').click();
                const value = await page.evaluate(() => {
                    const shell = document.querySelector('.app-shell');
                    return { ide: document.documentElement.classList.contains('ide-enabled'),
                        open: document.querySelector('#persistent-workspace').open, rows: getComputedStyle(shell).gridTemplateRows,
                        overflow: getComputedStyle(document.body).overflowY, width: document.documentElement.scrollWidth };
                });
                geometry.push({ label: name, ...value });
                assert.equal(value.ide, false); assert.equal(value.open, true);
                if (height <= 740) { assert.equal(value.overflow, 'auto'); assert.equal(value.rows.split(' ')[0], '52px'); assert.equal(value.rows.split(' ')[1], '480px'); }
                else assert.equal(value.overflow, 'hidden');
                assert(value.width <= 1440); assert(await page.locator('#dsl-editor').isVisible());
                assert(await page.locator('#persistent-panel').isVisible()); assert.equal(server.calls.length, calls);
                if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true });
                results.push({ name, status: 'PASS' }); console.log('PASS ' + name);
            } catch (error) { results.push({ name, status: 'FAIL', reason: error.stack }); console.error('FAIL ' + name + ': ' + error.message); }
            finally { await page.close(); }
        }
    } finally {
        if (evidence) {
            fs.writeFileSync(path.join(evidence, 'layout-results.json'), JSON.stringify(results, null, 2));
            fs.writeFileSync(path.join(evidence, 'shell-geometry.json'), JSON.stringify(geometry, null, 2));
        }
        await browser?.close(); await server.stop();
    }
    assert.equal(results.filter(result => result.status === 'FAIL').length, 0, 'layout regression failures');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
