'use strict';
// Final acceptance equivalence. Real Chromium/compiler; explicitly controlled Project,
// Persistent and Live fixtures. No native generated database acceptance is claimed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('./frontend-persistent-runtime-server');
const { fixture } = require('./frontend-ide-ui.test');
const SOURCE = '// exact Ω source\nENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED';
const results = [], evidence = process.env.APIFORGE_IDE_EVIDENCE;
async function main() {
    // This one-entity source emits five endpoints; the original 18-group fixture keeps its 17 default.
    const f = fixture(5); await f.storeApi.initializeProjectStore();
    const server = await serve(f), browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], liveCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.route('**/api/live/*', route => {
        const action = route.request().url().split('/').at(-1); liveCalls.push(action);
        return route.fulfill({ json: action === 'start' ? { success: true, sessionId: '2'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString() } : action === 'request' ? { success: true, status: 200, headers: {}, body: { data: ['controlled'] }, durationMs: 1 } : { success: true } });
    });
    const editor = page.locator('#dsl-editor');
    const nav = async name => {
        const button = page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: { editor: 'DSL Editor', inspector: 'Compiler Inspector', projects: 'Saved Projects', persistent: 'Persistent API' }[name], exact: true });
        await button.focus(); await page.keyboard.press('Enter');
        assert.equal(await button.getAttribute('aria-current'), 'page');
    };
    const idle = () => page.waitForFunction(() => document.querySelector('#project-workspace').getAttribute('aria-busy') === 'false');
    const runtimeIdle = () => page.waitForFunction(() => document.querySelector('.persistent-card').getAttribute('aria-busy') === 'false');
    const shot = async name => { if (evidence) await page.screenshot({ path: path.join(evidence, name + '.png') }); };
    async function compile(target) {
        const pending = page.waitForResponse(r => r.url().endsWith('/api/compile'));
        await page.locator('#compile-btn').click(); const response = await pending, data = await response.json();
        assert.deepEqual(response.request().postDataJSON(), { source: SOURCE, target }); assert(data.success);
        await page.waitForFunction(() => !document.querySelector('#compile-btn').disabled);
        return data;
    }
    async function test(name, action) {
        try { await action(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
        catch (error) { results.push({ name, status: 'FAIL', reason: error.stack }); await shot('failure'); throw error; }
    }
    try {
        await page.goto(server.origin); await editor.fill(SOURCE);
        await test('New toolbar at 1440, 1366 and 390: keyboard, geometry, compiler target and Live invalidation', async () => {
            for (const [width, height] of [[1440,900], [1366,768], [390,844]]) {
                await page.setViewportSize({ width, height }); await nav('editor');
                for (const target of ['mysql','postgres']) {
                    const control = page.getByRole('button', { name: target === 'mysql' ? 'MySQL' : 'PostgreSQL', exact: true });
                    assert(await control.isVisible()); assert(await control.isEnabled());
                    assert(await control.evaluate(node => {
                        const r = node.getBoundingClientRect(), p = node.closest('.target-control').getBoundingClientRect();
                        const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                        return r.left>=p.left && r.right<=p.right && r.top>=p.top && r.bottom<=p.bottom && r.left>=0 && r.right<=innerWidth && r.height>=28 && node.contains(hit);
                    }));
                }
                const boxes = await page.locator('.ide-header-actions > *').evaluateAll(nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; }));
                for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) assert(boxes[i].right<=boxes[j].left || boxes[j].right<=boxes[i].left || boxes[i].bottom<=boxes[j].top || boxes[j].bottom<=boxes[i].top);
                assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
                await page.locator('[data-target="mysql"]').focus(); await page.keyboard.press('Enter'); await compile('mysql');
                await nav('inspector'); await page.locator('#tab-live-api').click(); await page.locator('#live-start').click(); await page.locator('#live-send').waitFor();
                const stopped = liveCalls.filter(x=>x==='stop').length;
                const postgres = page.locator('[data-target="postgres"]'); await postgres.focus(); await page.keyboard.press('Space');
                assert.equal(await postgres.getAttribute('aria-pressed'),'true'); assert(await postgres.evaluate(n=>n===document.activeElement));
                assert.equal(await page.locator('[data-target="mysql"]').getAttribute('aria-pressed'),'false');
                await page.waitForFunction(() => !document.querySelector('#output-live-api').textContent.includes('Send request'));
                assert.equal(await page.locator('#download-btn').isVisible(),false);
                assert.equal(await page.locator('#compilation-summary').isVisible(),false);
                assert.match(await page.locator('#output-live-api').textContent(),/Compile/);
                assert.equal(liveCalls.filter(x=>x==='stop').length,stopped+1);
                const data = await compile('postgres');
                assert.match(data.generatedFiles.find(f=>f.path==='package.json').content,/"pg"/);
                assert.match(await page.locator('[data-summary-metric="target"]').textContent(),/PostgreSQL/);
                assert.equal(await editor.inputValue(),SOURCE); await shot('toolbar-'+width);
            }
        });
        await test('Save and Open native modals: containment, exact identity, cancel, one acknowledgement and focus return', async () => {
            await nav('editor');
            for (const [width,height] of [[1440,900],[1366,768],[390,844]]) {
                await page.setViewportSize({width,height});const before=f.mutations.length;
                await page.locator('#ide-save').click(); const dialog=page.locator('#ide-save-dialog');
                assert(await dialog.evaluate(n=>n.matches(':modal')));
                await page.locator('#ide-save-name').fill('Cancelled name');
                for(let i=0;i<7;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert(await dialog.evaluate(n=>n.contains(document.activeElement)));}
                await editor.evaluate(n=>n.focus()); assert(await dialog.evaluate(n=>n.contains(document.activeElement)));
                await shot('save-modal-'+width); await page.keyboard.press('Escape');
                await page.waitForFunction(()=>document.activeElement===document.querySelector('#ide-save'));
                assert.equal(f.mutations.length,before);assert.equal(await editor.inputValue(),SOURCE);
            }
            await page.locator('#ide-save').click();
            // The queued close event must not steal focus from a newer keyboard destination.
            const focusAfterClose = await page.locator('#ide-save-dialog [data-close]').evaluate(close => new Promise(resolve => {
                const dialog = close.closest('dialog'), destination = document.querySelector('[data-workspace="projects"]');
                dialog.addEventListener('close', () => requestAnimationFrame(() => resolve(document.activeElement === destination)), { once: true });
                close.click(); destination.focus();
            }));
            assert.equal(focusAfterClose, true);
            const store = await f.storeApi.openProjectStore(), original = store.createProject;
            let release;const held = new Promise(resolve=>{release=resolve;});
            store.createProject=async input=>{await held;return original.call(store,input);};
            try {
                await page.locator('#ide-save').click();await page.locator('#ide-save-name').fill('Exact Ω project');
                await page.locator('#ide-save-form button[type="submit"]').click();
                await page.waitForFunction(()=>document.querySelector('#project-status').dataset.state==='saving');
                assert.equal(await page.locator('#project-revision').textContent(),'No committed revision');
                assert.equal(f.records.size,0);assert(await page.locator('#ide-save').isDisabled());
                release();await idle();
            } finally {release();store.createProject=original;}
            assert.equal(f.mutations.length,1);const saved=[...f.records.values()][0];
            assert.equal(saved.source,SOURCE);assert.equal(saved.name,'Exact Ω project');assert.equal(saved.target,'postgres');assert.equal(saved.revision,1);
            assert.equal(await page.locator('#project-revision').textContent(),'Revision 1');
            await page.locator('#ide-save').click();await page.locator('#ide-save-form button[type="submit"]').click();await idle();assert.equal(f.mutations.length,1);
            await nav('projects'); await page.locator('#project-open').click(); await idle();
            // Reopen in the same task, while the old close event is still queued.
            const listProjects = store.listProjects; let releaseList;
            const heldList = new Promise(resolve => { releaseList = resolve; });
            store.listProjects = async () => { await heldList; return listProjects.call(store); };
            try {
                await page.locator('#project-dialog-close').evaluate(close => new Promise(resolve => {
                    const dialog = close.closest('dialog');
                    dialog.addEventListener('close', () => requestAnimationFrame(resolve), { once: true });
                    close.click(); document.querySelector('#project-open').click();
                }));
                releaseList(); await idle();
                await page.locator('#project-list .project-choice').waitFor();
                assert(await page.locator('#project-dialog').evaluate(n => n.matches(':modal')));
                assert.equal(f.mutations.length, 1);
            } finally { releaseList(); store.listProjects = listProjects; }
            await page.keyboard.press('Escape');
            for(const [width,height] of [[1440,900],[1366,768],[390,844]]) {
                await page.setViewportSize({width,height});await nav('projects');await page.locator('#project-open').click();await idle();
                const dialog=page.locator('#project-dialog');assert(await dialog.evaluate(n=>n.matches(':modal')));
                await page.locator('#project-dialog-close').focus();await page.keyboard.press('Shift+Tab');
                assert(await page.locator('#project-list .project-choice').evaluate(n=>n===document.activeElement));
                await page.keyboard.press('Tab');assert(await page.locator('#project-dialog-close').evaluate(n=>n===document.activeElement));
                await page.locator('#project-new').evaluate(n=>n.focus());assert(await dialog.evaluate(n=>n.contains(document.activeElement)));
                await page.getByRole('button',{name:'Preview Exact Ω project',exact:true}).click();await idle();
                assert(await page.locator('#project-preview').evaluate(n=>n.closest('dialog').matches(':modal')));
                assert.equal(await page.locator('#project-preview-source').textContent(),SOURCE);
                assert(await page.locator('#project-load-snapshot').isVisible());
                assert(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await shot('open-preview-'+width);
                await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement===document.querySelector('#project-open'));
                assert.equal(f.mutations.length,1);
            }
        });
        await test('Dedicated workspace equivalence: saved identity, retained compilation/runtime, dirty refusal, Stop and recovery', async () => {
            await page.setViewportSize({width:1440,height:900});await nav('editor');assert.equal(await editor.inputValue(),SOURCE);await compile('postgres');await nav('inspector');
            const output=await page.locator('#output-sql').innerHTML();const calls=server.calls.length, actions=f.runtime.length;
            await nav('persistent');await nav('editor');await nav('inspector');
            assert.equal(server.calls.length,calls);assert.equal(f.runtime.length,actions);assert.equal(await editor.inputValue(),SOURCE);
            assert.equal(await page.locator('#output-sql').innerHTML(),output);assert(await page.locator('#download-btn').isVisible());
            assert.equal(await page.locator('[data-target="postgres"]').getAttribute('aria-pressed'),'true');
            await nav('persistent');await page.locator('#persistent-reconnect').click();await runtimeIdle();await page.locator('#persistent-refresh').click();await runtimeIdle();
            page.once('dialog',d=>d.accept());await page.locator('#persistent-initialize').click();await runtimeIdle();await page.locator('#persistent-run').click();await runtimeIdle();
            const identity=await page.locator('#persistent-identity').textContent();assert(identity.includes([...f.records.keys()][0]));assert.match(identity,/revision 1/i);
            await page.locator('#persistent-query').fill('limit=20');await page.locator('#persistent-send').click();await runtimeIdle();
            const response=await page.locator('#persistent-response').textContent(), count=f.runtime.length;
            for(const name of ['editor','inspector','projects','persistent'])await nav(name);
            assert.equal(f.runtime.length,count);assert.equal(await page.locator('#persistent-query').inputValue(),'limit=20');assert.equal(await page.locator('#persistent-response').textContent(),response);assert.equal(await page.locator('#persistent-identity').textContent(),identity);
            await nav('editor');await editor.fill(SOURCE+'\n// unsaved');await nav('persistent');
            assert(await page.locator('#persistent-initialize').isDisabled());assert(await page.locator('#persistent-run').isDisabled());assert(await page.locator('#persistent-send').isEnabled());assert(await page.locator('#persistent-stop').isEnabled());
            assert.match(await page.locator('#persistent-draft').textContent(), /acknowledged saved revision/);
            assert.equal(await page.locator('#persistent-identity').textContent(),identity);
            assert.equal([...f.records.values()][0].source,SOURCE);assert.equal(f.mutations.length,1);
            await page.locator('#persistent-stop').click();await runtimeIdle();assert.equal(f.runtime.at(-1),'stop');
            await nav('editor');await editor.fill(SOURCE);await nav('persistent');await page.locator('#persistent-run').click();await runtimeIdle();
            f.stopped();await page.locator('#persistent-refresh').click();await runtimeIdle();assert(await page.locator('#persistent-forget').isEnabled());
            const before=f.runtime.length,records=JSON.stringify([...f.records]);page.once('dialog',d=>d.dismiss());await page.locator('#persistent-forget').click();assert.equal(f.runtime.length,before);
            page.once('dialog',d=>d.accept());await page.locator('#persistent-forget').click();await runtimeIdle();assert.equal(f.runtime.length,before);assert.equal(JSON.stringify([...f.records]),records);
            assert(await page.locator('#persistent-forget').isDisabled());await shot('persistent-equivalence');assert.deepEqual(errors,[]);
        });
    } finally {
        if(evidence)fs.writeFileSync(path.join(evidence,'acceptance-results.json'),JSON.stringify(results,null,2));
        await browser.close();await server.stop();
    }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
