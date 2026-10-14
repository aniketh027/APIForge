// Clean checkout setup (Node.js 20+, development dependencies required):
//   npm ci
//   npx playwright install chromium
//   npm run test:frontend-api-files
// On Linux, use `npx playwright install --with-deps chromium` for OS libraries.
// Alternatively, skip the browser download and set APIFORGE_BROWSER_EXECUTABLE
// to an absolute local Chromium/Chrome executable path before running the test.
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

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            ...(process.env.APIFORGE_BROWSER_EXECUTABLE
                ? { executablePath: process.env.APIFORGE_BROWSER_EXECUTABLE } : {})
        });
        const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        await page.addInitScript(() => {
            const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
            navigator.clipboard.writeText = async text => {
                window.lastClipboardWrite = text;
                await writeText(text);
            };
        });
        async function assertCopied(expected) {
            assert.equal(await page.evaluate(() => window.lastClipboardWrite), expected,
                'Copy passes the entire exact underlying content to writeText');
            // Native Windows clipboard reads normalize LF to CRLF. Check the
            // exact write payload above, and the real clipboard text below.
            const clipboard = await page.evaluate(() => navigator.clipboard.readText());
            assert.equal(clipboard.replace(/\r\n/g, '\n'), expected);
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        // Chrome requests a favicon even though the frontend doesn't supply one.
        await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await enterSource(page, 'ENTITY Document\nid INT PRIMARY KEY\ntitle STRING REQUIRED');
        await clickIn(page, 'editor', page.locator('#compile-btn'));
        await page.locator('#output-api .api-file').first().waitFor({ state: 'attached' });

        const longText = 'prose <tag> & "quoted" '.repeat(300) + 'x'.repeat(3000);
        const files = [
            { path: 'README.md', content: `# Read me\n\n${longText}\n    Indented prose\n` },
            { path: 'docs/guide.MD', content: `${longText}\n` },
            { path: 'src/long.js', content: `const value = "${'x'.repeat(8000)}";\n\t// <tag> & exact whitespace\n` },
            { path: 'package.json', content: JSON.stringify({ value: 'x'.repeat(8000) }) + '\n' },
            { path: '.env.example', content: `VALUE=${'x'.repeat(8000)}\n` },
            { path: 'config/settings.yaml', content: `value: ${'x'.repeat(8000)}\n` },
            { path: 'README.md.js', content: `// ${'x'.repeat(8000)}\n` }
        ];

        for (const viewport of [{ width: 1440, height: 1000 }, { width: 900, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.evaluate(files => {
                document.getElementById('output-api').innerHTML = renderAPIFiles(files);
                switchTab('api');
            }, files);
            await workspace(page, 'inspector');
            const cards = page.locator('#output-api .api-file');
            for (let i = 0; i < files.length; i++) {
                const card = cards.nth(i);
                const header = card.locator('.api-file-header');
                const content = card.locator('.api-file-content');
                if (i > 0) {
                    assert.equal(await header.getAttribute('aria-expanded'), 'false');
                    await header.click();
                }
                assert.equal(await header.getAttribute('aria-expanded'), 'true');
                const metrics = await card.evaluate(card => {
                    const pane = card.closest('.output-pane');
                    const output = pane.parentElement;
                    const pre = card.querySelector('pre');
                    const toolbar = card.querySelector('.api-file-toolbar');
                    const copy = toolbar.querySelector('.copy-control');
                    const rect = element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width });
                    const style = getComputedStyle(pre);
                    pre.scrollLeft = 100;
                    return {
                        pane: rect(pane), output: rect(output), card: rect(card), toolbar: rect(toolbar), copy: rect(copy),
                        outputWidth: output.clientWidth, outputScrollWidth: output.scrollWidth,
                        cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth,
                        preWidth: pre.clientWidth, preScrollWidth: pre.scrollWidth, preScrollLeft: pre.scrollLeft,
                        whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, overflowX: style.overflowX,
                        pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth
                    };
                });
                const label = `${viewport.width}px ${files[i].path}: ${JSON.stringify(metrics)}`;
                assert.ok(metrics.pane.width <= metrics.outputWidth + 1, `Pane stays bounded: ${label}`);
                assert.ok(metrics.card.right <= metrics.output.right + 1, `Card stays bounded: ${label}`);
                assert.ok(metrics.outputScrollWidth <= metrics.outputWidth + 1, `Inspector has no horizontal overflow: ${label}`);
                assert.ok(metrics.cardScrollWidth <= metrics.cardWidth + 1, `Card has no horizontal overflow: ${label}`);
                assert.ok(metrics.toolbar.right <= metrics.card.right + 1, `Toolbar stays in card: ${label}`);
                assert.ok(metrics.copy.right <= metrics.output.right - 8 && metrics.copy.left >= metrics.card.left, `Copy stays visible: ${label}`);
                assert.ok(metrics.pageScrollWidth <= metrics.pageWidth + 1, `Page has no horizontal overflow: ${label}`);
                if (/\.md$/i.test(files[i].path)) {
                    assert.equal(metrics.whiteSpace, 'pre-wrap', label);
                    assert.equal(metrics.overflowWrap, 'anywhere', label);
                    assert.ok(metrics.preScrollWidth <= metrics.preWidth + 1, `Markdown wraps long prose and unbroken words: ${label}`);
                    assert.equal(metrics.preScrollLeft, 0, label);
                } else {
                    assert.equal(metrics.whiteSpace, 'pre', label);
                    assert.equal(metrics.overflowX, 'auto', label);
                    assert.ok(metrics.preScrollWidth > metrics.preWidth, `Code stays unwrapped: ${label}`);
                    assert.ok(metrics.preScrollLeft > 0, `PRE scrolls horizontally: ${label}`);
                }
                const copy = card.locator('.copy-control');
                await copy.click();
                await page.waitForFunction(() => document.querySelector('#output-api .api-file-content.expanded .copy-control.copied'));
                await assertCopied(files[i].content);
                await header.click();
                assert.equal(await header.getAttribute('aria-expanded'), 'false');
                assert.equal(await content.isVisible(), false);
                await header.click();
                assert.equal(await header.getAttribute('aria-expanded'), 'true');
                assert.equal(await content.isVisible(), true);
                assert.equal(await card.locator('pre').textContent(), files[i].content);
                await header.click();
            }

            // Use the SQL/OpenAPI produced by the real compile, preserving their
            // renderers, syntax and copy controls while the common pane sizing changes.
            for (const tab of ['sql', 'swagger']) {
                await page.locator(`#tab-${tab}`).click();
                const pane = page.locator(`#output-${tab}`);
                const pre = pane.locator('pre');
                const original = await pre.textContent();
                assert.ok(original.length > 0);
                assert.equal(await pre.evaluate(pre => getComputedStyle(pre).whiteSpace), 'pre');
                assert.equal(await pane.locator('.api-file-markdown').count(), 0);
                assert.ok(await pane.evaluate(pane => {
                    const output = pane.parentElement;
                    const copy = pane.querySelector('.copy-control').getBoundingClientRect();
                    return output.scrollWidth <= output.clientWidth + 1
                        && copy.right <= output.getBoundingClientRect().right;
                }), `${tab} stays bounded with its copy control visible`);
                await pane.locator('.copy-control').click();
                await page.waitForFunction(tab => document.querySelector(`#output-${tab} .copy-control.copied`), tab);
                await assertCopied(original);
                if (tab === 'swagger') assert.ok(JSON.parse(original).openapi);
            }
            console.log(`PASS: ${viewport.width}px API file layout, Markdown/code, exact copy, collapse, SQL and OpenAPI`);
        }
        assert.deepEqual(errors, [], 'Frontend has no console or runtime errors');
        console.log('PASS: frontend has no console or runtime errors');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
