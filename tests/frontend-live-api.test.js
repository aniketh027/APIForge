'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const app = require('../server');
const { PROFESSOR_SOURCE } = require('./frontend-source-fixtures');
const SIMPLE = 'ENTITY User\nid UUID PRIMARY KEY\nname STRING REQUIRED';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, ...(process.env.APIFORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {}) });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message));
        let startError, requestError, responseStatus = 200, responseBody = { data: [{ name: 'Demo User' }] }, holdStart, releaseStart, sequence = 0;
        await page.route('**/api/live/*', async route => {
            const action = route.request().url().split('/').at(-1);
            const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
            calls.push({ action, body });
            if (action === 'start') {
                assert.deepEqual(Object.keys(body).sort(), ['source', 'target']);
                if (holdStart) { await new Promise(resolve => { releaseStart = resolve; }); holdStart = false; }
                if (startError) return route.fulfill({ status: 403, json: { success: false, code: startError, error: startError === 'LIVE_DISABLED' ? 'Live API runner is disabled.' : 'The generated API could not start.' } });
                return route.fulfill({ json: { success: true, sessionId: String(++sequence).padStart(64, '0'), target: body.target, expiresAt: new Date(Date.now() + 900000).toISOString() } });
            }
            if (action === 'request') {
                if (requestError) return route.fulfill({ status: 409, json: { success: false, code: requestError, error: requestError === 'LIVE_SESSION_INVALID' ? 'Live session stopped or expired. Start again.' : 'The generated API request failed.' } });
                return route.fulfill({ json: { success: true, status: responseStatus, headers: { 'content-type': 'application/json',
                    'x-total-count': '1', 'x-page': '1', 'x-limit': '20', 'x-total-pages': '1' }, body: responseBody, durationMs: 12 } });
            }
            return route.fulfill({ json: { success: true } });
        });
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto('http://127.0.0.1:' + server.address().port);
        const editor = page.getByRole('textbox', { name: 'APIForge DSL source' });
        const tab = page.getByRole('tab', { name: 'Live API', exact: true });
        const pane = page.locator('#output-live-api');
        const liveCount = action => calls.filter(call => call.action === action).length;
        async function until(predicate) { for (let i = 0; i < 100; i++) { if (await predicate()) return; await wait(20); } assert.fail('Browser condition timed out'); }
        async function compile() {
            const pending = page.waitForResponse(response => response.url().endsWith('/api/compile'));
            await page.locator('#compile-btn').click(); const data = await (await pending).json();
            await page.waitForFunction(() => !document.getElementById('compile-btn').disabled);
            await tab.click(); return data;
        }
        async function start() { await page.getByRole('button', { name: 'Start live API', exact: true }).click(); await until(async () => await pane.locator('#live-status').textContent() === 'Running'); }
        async function stop() { await page.getByRole('button', { name: 'Stop live API', exact: true }).click(); await until(async () => await pane.locator('#live-status').textContent() === 'Stopped / expired'); }
        async function choose(method, template) {
            const options = await pane.locator('#live-endpoint option').allTextContents();
            const index = options.indexOf(method + ' ' + template); assert(index >= 0);
            await pane.locator('#live-endpoint').selectOption(String(index));
        }
        async function send() {
            const count = liveCount('request'); await pane.locator('#live-send').click();
            await until(() => liveCount('request') > count);
            await until(async () => !await pane.locator('#live-send').isDisabled());
        }
        await tab.click(); assert.match(await pane.textContent(), /Compile successfully/); assert.equal(liveCount('start'), 0);
        assert.equal(await tab.getAttribute('aria-controls'), 'output-live-api');
        assert.equal(await pane.getAttribute('aria-labelledby'), 'tab-live-api');
        await page.locator('#tab-endpoints').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await tab.getAttribute('aria-selected'), 'true');
        await editor.fill('ENTITY Bad\nx UNKNOWN'); assert.equal((await compile()).success, false); assert.match(await pane.textContent(), /Compile successfully/);
        await editor.fill(SIMPLE); const data = await compile();
        assert.equal(data.success, true); assert.match(await pane.textContent(), /MySQL · 5 generated endpoints/); assert.equal(liveCount('start'), 0);
        startError = 'LIVE_DISABLED'; await pane.locator('#live-start').click(); await until(async () => (await pane.textContent()).includes('Live API runner is disabled.'));
        startError = 'LIVE_START_FAILED'; await pane.locator('#live-start').click(); await until(async () => (await pane.textContent()).includes('could not start'));
        startError = null; await start();
        const spec = JSON.parse(data.generatedFiles.find(file => file.path === 'swagger.json').content);
        const expected = []; for (const [path, item] of Object.entries(spec.paths)) for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE']) if (item[method.toLowerCase()]) expected.push(method + ' ' + path);
        assert.deepEqual(await pane.locator('#live-endpoint option').allTextContents(), expected);
        assert.equal(await pane.locator('#live-body').isVisible(), false);
        await choose('POST', '/users'); assert.equal(await pane.locator('#live-body').isVisible(), true); assert.equal(await pane.locator('#live-body').inputValue(), '{}');
        await pane.locator('#live-body').fill('{broken'); const count = liveCount('request'); await pane.locator('#live-send').click();
        assert.equal(liveCount('request'), count); assert.match(await pane.locator('#live-message').textContent(), /valid JSON/);
        await pane.locator('#live-body').fill('{"name":"Demo User"}'); responseStatus = 201; await send();
        assert.match(await pane.locator('#live-response').textContent(), /HTTP 201 Created/); assert.match(await pane.locator('#live-response').textContent(), /12 ms/);
        assert.deepEqual(calls.filter(call => call.action === 'request').at(-1).body.body, { name: 'Demo User' });
        await choose('GET', '/users/{id}'); assert.equal(await pane.locator('#live-body').isVisible(), false);
        const noParameter = liveCount('request'); await pane.locator('#live-send').click(); assert.equal(liveCount('request'), noParameter);
        assert.match(await pane.locator('#live-message').textContent(), /Enter path parameter: id/);
        await page.getByLabel('Path parameter: id', { exact: true }).fill('a&b'); await pane.locator('#live-query').fill('?limit=20&page=1');
        responseStatus = 404; responseBody = { success: false, error: 'Missing user' }; await send();
        assert.equal(calls.filter(call => call.action === 'request').at(-1).body.path, '/users/a%26b?limit=20&page=1');
        assert(!Object.hasOwn(calls.filter(call => call.action === 'request').at(-1).body, 'body'));
        assert.match(await pane.locator('#live-response').textContent(), /HTTP 404 Not Found/);
        responseStatus = 400; responseBody = { error: 'Rejected value' }; await send(); assert.match(await pane.locator('#live-response').textContent(), /HTTP 400 Bad Request/);
        for (const header of ['x-total-count: 1', 'x-page: 1', 'x-limit: 20', 'x-total-pages: 1']) assert((await pane.locator('.live-response-headers').textContent()).includes(header));
        responseBody = '<img src=x onerror="window.liveInjected=true"><script>window.liveInjected=true</script>'; responseStatus = 200; await send();
        assert.equal(await pane.locator('#live-response img, #live-response script').count(), 0); assert.equal(await page.evaluate(() => window.liveInjected), undefined);
        const beforeUrl = liveCount('request'); await pane.locator('#live-query').fill('https://evil.example'); await pane.locator('#live-send').click(); assert.equal(liveCount('request'), beforeUrl);
        await pane.locator('#live-query').fill(''); requestError = 'LIVE_REQUEST_FAILED'; await send(); assert.match(await pane.locator('#live-message').textContent(), /request failed/);
        requestError = 'LIVE_SESSION_INVALID'; await pane.locator('#live-send').click(); await until(async () => !await pane.locator('#live-stop').count());
        assert.match(await pane.locator('#live-status').textContent(), /expired/); requestError = null;
        await start(); await stop();
        await start(); let stops = liveCount('stop'); await editor.fill(SIMPLE + '\nemail STRING'); await until(() => liveCount('stop') > stops);
        await tab.click(); assert.equal(await pane.locator('#live-start').count(), 0); assert.match(await pane.textContent(), /Compile successfully/);
        await compile(); await start(); stops = liveCount('stop'); await page.getByRole('button', { name: 'PostgreSQL', exact: true }).click(); await until(() => liveCount('stop') > stops);
        await tab.click(); assert.match(await pane.textContent(), /Compile successfully/); assert.equal(await pane.locator('#live-start').count(), 0);
        await compile(); await start(); stops = liveCount('stop'); await compile(); await until(() => liveCount('stop') > stops);
        await start(); stops = liveCount('stop');
        await page.getByRole('button', { name: 'Clear', exact: true }).click();
        await until(() => liveCount('stop') > stops);
        await tab.click(); assert.match(await pane.textContent(), /Compile successfully/);
        await editor.fill(SIMPLE); await compile(); holdStart = true; releaseStart = null;
        await pane.locator('#live-start').click(); await until(() => releaseStart);
        await editor.fill(SIMPLE + '\nemail STRING'); stops = liveCount('stop'); releaseStart();
        await until(() => liveCount('stop') > stops); assert.equal(await pane.locator('#live-stop').count(), 0); assert.equal(await pane.locator('#live-start').count(), 0);
        // Editing while compilation is pending must never enable Live against stale source.
        let releaseCompile;
        await page.route('**/api/compile', async route => { const response = await route.fetch(); await new Promise(resolve => { releaseCompile = resolve; }); await route.fulfill({ response }); });
        await page.locator('#compile-btn').click(); await until(() => releaseCompile); await editor.fill(SIMPLE + '\nchanged INT'); releaseCompile();
        await page.waitForFunction(() => !document.getElementById('compile-btn').disabled); await tab.click(); assert.equal(await pane.locator('#live-start').count(), 0);
        await page.unroute('**/api/compile');
        await editor.fill(PROFESSOR_SOURCE); await compile(); await start();
        assert.equal(await pane.locator('#live-endpoint option').count(), 17);
        await choose('POST', '/users'); await pane.locator('#live-body').fill('{"name":"Demo User","email":"live@example.test","joinedAt":"2026-10-06"}');
        responseBody = { data: [{ name: 'x'.repeat(2000) }] }; await send();
        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 }); await tab.click();
            assert(await pane.locator('#live-endpoint').isVisible()); assert(await pane.locator('#live-body').isVisible());
            assert(await pane.locator('#live-send').isVisible()); assert(await pane.locator('#live-stop').isVisible());
            for (const control of ['#live-stop', '#live-endpoint', '#live-body', '#live-send', '.live-response-body']) {
                await pane.locator(control).scrollIntoViewIfNeeded();
                const bounds = await pane.locator(control).boundingBox();
                assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'Reachable contained control ' + control + ' at ' + width);
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No page overflow at ' + width);
            assert(await pane.locator('.live-card').evaluate(element => element.scrollWidth <= element.clientWidth), 'Live card contains response at ' + width);
            if (process.env.APIFORGE_LIVE_EVIDENCE_DIR) {
                fs.mkdirSync(process.env.APIFORGE_LIVE_EVIDENCE_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.APIFORGE_LIVE_EVIDENCE_DIR, 'live-api-' + width + '.png'), fullPage: true });
            }
        }
        for (const id of ['diagram', 'endpoints', 'api', 'swagger']) { await page.locator('#tab-' + id).click(); assert(await page.locator('#output-' + id).isVisible()); }
        assert(await page.locator('#compilation-summary').isVisible());
        await tab.click(); stops = liveCount('stop'); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await until(() => liveCount('stop') > stops);
        assert.deepEqual(errors, []);
        console.log('PASS Live API browser: compiler/OpenAPI oracle, explicit start, all request controls/statuses, pagination, JSON/XSS, invalidation/races/pagehide, 1440/900/390 containment and existing panes.');
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
