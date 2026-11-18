const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDiagnostic } = require('../src/utils/diagnostics');
const { sourceFrame } = require('../src/utils/source-frame');
const { levenshtein, formatUserFacingError } = require('../src/utils/errors');
function browser(overrides = {}) {
    const context = vm.createContext({
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        window: { addEventListener() {} }, navigator: {}, TextEncoder, Blob,
        setTimeout: () => 1, clearTimeout() {}, ...overrides
    });
    vm.runInContext(fs.readFileSync(require.resolve('../frontend/app.js'), 'utf8'), context);
    return context;
}

test('diagnostic lookup rejects Object prototype names', () => {
    for (const [phase, symbol] of [['semantic', 'toString'], ['semantic', 'constructor'], ['__proto__', 'toString']]) {
        assert.throws(() => createDiagnostic(phase, symbol, 'bad'), /Unregistered diagnostic/);
    }
    assert.equal(createDiagnostic('semantic', 'MISSING_ENTITY_DECLARATION', 'bad').code, 'SEM001');
});

test('edit distance stays symmetric for strongly unequal input lengths', () => {
    const long = 'a'.repeat(100000);
    assert.equal(levenshtein('a', long), 99999);
    assert.equal(levenshtein(long, 'a'), 99999);
    assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('source excerpts return no frame for missing locations', () => {
    assert.deepEqual(sourceFrame('source', undefined), []);
    assert.deepEqual(sourceFrame('source', null), []);
    assert.equal(sourceFrame('source', {line: 1, column: 1})[0].pointer, '^');
});

test('user error formatting consistently returns text', () => {
    assert.equal(formatUserFacingError({message: 42}), '42');
    assert.equal(formatUserFacingError({userMessage: 17}), '17');
    assert.equal(formatUserFacingError(new Error('Semantic Error: invalid')), 'invalid');
});

test('SQL highlighting preserves literals, quoted identifiers and comments', () => {
    const app = browser();
    const sql = "SELECT 'DEFAULT -- literal', `TABLE`, \"CREATE\"; -- INT CREATE\n/* TABLE */";
    const html = app.highlightSQL(sql);
    assert.ok(html.includes("'DEFAULT -- literal'"));
    assert.ok(html.includes('`TABLE`'));
    assert.ok(html.includes('<span class="sql-comment">-- INT CREATE</span>'));
    assert.ok(html.includes('<span class="sql-keyword">SELECT</span>'));
});

test('SQL pane selects schema even when another SQL file appears first', () => {
    const html = browser().renderSQL([{path:'notes.sql',content:'wrong'}, {path:'database/schema.sql',content:'CREATE TABLE Item'}]);
    assert.ok(html.includes('database/schema.sql'));
    assert.ok(!html.includes('wrong'));
});

test('Swagger pane ignores suffix lookalikes', () => {
    const html = browser().renderSwagger([{path:'old-swagger.json',content:'wrong'}, {path:'swagger.json',content:'{"openapi":"3.0.0"}'}]);
    assert.ok(html.includes('3.0.0'));
    assert.ok(!html.includes('wrong'));
});

test('pending clipboard write blocks duplicate writes and reenables the button', async () => {
    let resolve, calls = 0;
    const app = browser({navigator: {clipboard: {writeText() {calls++; return new Promise(r => { resolve = r; });}}}});
    const button = {disabled:false, closest: () => ({querySelector: () => ({textContent:'exact'})}),
        dataset:{}, classList:{add(){},remove(){}}, setAttribute(){}};
    const first = app.copyGeneratedCode(button);
    await app.copyGeneratedCode(button);
    assert.equal(calls, 1);
    resolve(); await first;
    assert.equal(button.disabled, false);
});

test('Unicode ZIP names carry UTF8 flags in local and central headers', async () => {
    const bytes = new Uint8Array(await browser().createZip([{path:'é.txt',content:'hello'}]).arrayBuffer());
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(6,true), 0x0800);
    const end = bytes.length - 22, central = view.getUint32(end+16,true);
    assert.equal(view.getUint16(central+8,true), 0x0800);
    assert.equal(new TextDecoder().decode(bytes.slice(30,36)), 'é.txt');
});

test('ZIP timestamps use a valid matching DOS calendar date', async () => {
    const bytes = new Uint8Array(await browser().createZip([{path:'file.txt',content:'hello'}]).arrayBuffer());
    const view = new DataView(bytes.buffer), central = view.getUint32(bytes.length-6,true);
    assert.equal(view.getUint16(12,true), 0x0021);
    assert.equal(view.getUint16(central+14,true), 0x0021);
});

test('copy failure replaces a previous success checkmark', () => {
    const app = browser();
    const button = {dataset:{}, classList:{add(){},remove(){}}, setAttribute(){}};
    app.showCopyFeedback(button, 'copied');
    const success = button.innerHTML;
    app.showCopyFeedback(button, 'failed');
    assert.notEqual(button.innerHTML, success);
    assert.ok(button.innerHTML.includes('<rect'));
});

test('ZIP refuses the reserved ZIP64 entry count before encoding files', () => {
    const app = browser();
    assert.throws(() => app.createZip(new Array(65535)), /ZIP64 entry counts/);
    assert.throws(() => app.createZip(new Array(65536)), /ZIP64 entry counts/);
    assert.ok(app.createZip([]).size > 0);
});

test('ZIP filename limits count UTF8 bytes and preserve the boundary', async () => {
    const app = browser();
    assert.throws(() => app.createZip([{path:'é'.repeat(32768), content:''}]), /filename exceeds/);
    const bytes = new Uint8Array(await app.createZip([{path:'a'.repeat(65535),content:''}]).arrayBuffer());
    assert.equal(new DataView(bytes.buffer).getUint16(26,true), 65535);
});

test('reused edit distance rows agree with an independent full matrix', () => {
    function distance(a,b) {
        const matrix = Array.from({length:a.length+1}, (_,i) => [i]);
        matrix[0] = Array.from({length:b.length+1}, (_,i) => i);
        for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
            matrix[i][j] = Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+Number(a[i-1]!==b[j-1]));
        }
        return matrix[a.length][b.length];
    }
    const words = ['', 'a', 'ab', 'ba', 'aaa', 'STRING', 'STRIMG', 'kitten', 'sitting', 'é'];
    for(const a of words) for(const b of words) assert.equal(levenshtein(a,b), distance(a,b));
});

test('suggestions retain ordering and threshold behavior with length pruning', () => {
    const {suggestClosest} = require('../src/utils/errors');
    for(const word of ['STRIMG','INT','a'.repeat(200)]) {
        const candidates = ['STRING','INT','FLOAT','a'.repeat(200)];
        for(const threshold of [0,1,2,Infinity]) {
            const ranked = candidates.map((candidate,index) => ({candidate,index,distance:levenshtein(word,candidate)}))
                .sort((a,b) => a.distance-b.distance || a.index-b.index);
            assert.equal(suggestClosest(word,candidates,threshold), ranked[0].distance<=threshold?ranked[0].candidate:null);
        }
    }
    assert.equal(suggestClosest('ab',['ac','ad'],1), 'ac');
    assert.equal(suggestClosest('ab',['a'.repeat(1000000)],2), null);
});

test('formatted locations use the same positive integer contract as excerpts', () => {
    const {formatDiagnostic} = require('../src/utils/source-frame');
    const diagnostic = {code:'INT001',message:'test',line:-1,column:3};
    assert.equal(formatDiagnostic('abc',diagnostic), 'INT001: test');
    assert.ok(!formatDiagnostic('abc',{...diagnostic,line:1,column:-2}).includes('column'));
    assert.ok(formatDiagnostic('abc',{...diagnostic,line:1,column:2}).includes('line 1, column 2'));
});

test('SQL preview highlights the types emitted by PostgreSQL schema generation', () => {
    const html = browser().highlightSQL('INTEGER REAL TIMESTAMPTZ(0) UUID "UUID"');
    for (const type of ['INTEGER', 'REAL', 'TIMESTAMPTZ', 'UUID']) {
        assert.ok(html.includes('<span class="sql-type">' + type + '</span>'));
    }
    assert.ok(html.endsWith('&quot;UUID&quot;'));
});

test('API preview shows its empty state when SQL and OpenAPI own every file', () => {
    const html = browser().renderAPIFiles([
        { path: 'database/schema.sql', content: 'CREATE TABLE example (id INT);' },
        { path: 'swagger.json', content: '{}' }
    ]);
    assert.match(html, /No API files generated/);
});

test('download URLs remain valid until the browser can start the download', () => {
    const events = [];
    let release;
    const link = { click() { events.push(['click', this.href, this.download]); } };
    const app = browser({
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => link },
        URL: { createObjectURL: () => 'blob:project', revokeObjectURL: url => events.push(['revoke', url]) },
        setTimeout: callback => { release = callback; }
    });
    app.downloadBlob(new Blob(['example']), 'project.zip');
    assert.deepEqual(events, [['click', 'blob:project', 'project.zip']]);
    release();
    assert.deepEqual(events[1], ['revoke', 'blob:project']);
});

test('an empty diagnostics array still displays legacy or fallback compiler errors', () => {
    const app = browser();
    const errors = [{ message: 'Legacy compiler error' }];
    assert.equal(app.compilerErrors({ diagnostics: [], errors }), errors);
    assert.equal(app.compilerErrors({ diagnostics: [], errors: [] })[0].message, 'Unknown compilation error.');
    const diagnostic = { message: 'Structured error' };
    assert.equal(app.compilerErrors({ diagnostics: [diagnostic], errors })[0].diagnostic, diagnostic);
});

test('the editor indents on plain Tab and lets Shift+Tab navigate away', () => {
    const editor = { value: 'abc', selectionStart: 1, selectionEnd: 2, dispatchEvent() {} };
    const app = browser({
        document: { getElementById: id => id === 'dsl-editor' ? editor : null, querySelectorAll: () => [], addEventListener() {} },
        Event
    });
    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
        app.indentEditor({ key: 'Tab', [modifier]: true, preventDefault: () => assert.fail('Modifier intercepted') });
        assert.equal(editor.value, 'abc');
    }
    let prevented = false;
    app.indentEditor({ key: 'Tab', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(editor.value, 'a    c');
    assert.equal(editor.selectionStart, 5);
});
