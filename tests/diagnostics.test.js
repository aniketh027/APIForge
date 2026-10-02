const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES, WARNING_CODES, createDiagnostic, createWarningDiagnostic } = require('../src/utils/diagnostics');
const { sourceFrame, formatDiagnostic } = require('../src/utils/source-frame');
const app = require('../server');
let passed = 0;
async function test(name, fn) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}
function parse(source) { return Parser.parse(Lexer.tokenize(source)); }
function semantic(source) { return Semantic.analyze(parse(source)); }
function fatal(fn) {
    try { fn(); } catch (error) { return error; }
    assert.fail('Expected a compiler error');
}
function check(diagnostic, code, phase, line, column) {
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.phase, phase);
    assert.equal(diagnostic.severity, 'error');
    assert.equal(diagnostic.line, line);
    assert.equal(diagnostic.column, column);
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic)), diagnostic);
}

(async () => {
    await test('registry has unique, phase-specific codes', () => {
        const all = Object.values(CODES).flatMap(Object.values);
        assert.equal(new Set(all).size, all.length);
        assert.equal(all.length, 63);
        for (const [phase, prefix] of Object.entries({ lexer: 'LEX', parser: 'PAR', semantic: 'SEM', input: 'INP', internal: 'INT' })) {
            assert(Object.values(CODES[phase]).every(code => new RegExp(`^${prefix}\\d{3}$`).test(code)));
        }
    });
    await test('unknown positions are null and unavailable optional fields are omitted', () => {
        const diagnostic = createDiagnostic('input', 'INVALID_SOURCE', 'Invalid source');
        assert.equal(diagnostic.line, null);
        assert.equal(diagnostic.column, null);
        assert(!('endLine' in diagnostic));
        assert(!('hint' in diagnostic));
        assert.throws(() => createDiagnostic('lexer', 'UNREGISTERED', 'bad'), /Unregistered/);
    });
    await test('error default is unchanged and warning creation shares the JSON contract', () => {
        assert.deepEqual(createDiagnostic('input', 'INVALID_SOURCE', 'Invalid source'), {
            phase: 'input', code: 'INP001', severity: 'error', message: 'Invalid source',
            symbol: 'INVALID_SOURCE', line: null, column: null
        });
        const warning = createWarningDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY', 'Implicit id',
            { line: 1, column: 8, endLine: 1, endColumn: 15 }, 'Declare a key.');
        assert.deepEqual(warning, { phase: 'semantic', code: 'WRN001', severity: 'warning',
            message: 'Implicit id', symbol: 'IMPLICIT_PRIMARY_KEY', line: 1, column: 8,
            endLine: 1, endColumn: 15, hint: 'Declare a key.' });
        assert.deepEqual(JSON.parse(JSON.stringify(warning)), warning);
        assert.deepEqual(createDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY', 'Implicit id',
            { line: 1, column: 8, endLine: 1, endColumn: 15 }, 'Declare a key.', { severity: 'warning' }), warning);
    });
    await test('warning registry is unique, separate and rejects unregistered or wrong severity conditions', () => {
        const warnings = Object.values(WARNING_CODES).flatMap(Object.values);
        const errors = Object.values(CODES).flatMap(Object.values);
        assert.equal(warnings.length, 5);
        assert.equal(new Set([...errors, ...warnings]).size, errors.length + warnings.length);
        assert(warnings.every(code => /^WRN\d{3}$/.test(code)));
        assert.throws(() => createWarningDiagnostic('semantic', 'UNREGISTERED', 'bad'), /Unregistered/);
        assert.throws(() => createWarningDiagnostic('semantic', 'DUPLICATE_FIELD', 'bad'), /Unregistered/);
        assert.throws(() => createDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY', 'bad'), /Unregistered/);
        assert.throws(() => createDiagnostic('input', 'INVALID_SOURCE', 'bad', {}, undefined, { severity: 'info' }), /Unsupported/);
        const unknown = createWarningDiagnostic('optimizer', 'INVALID_IR', 'Invalid IR');
        assert.equal(unknown.line, null);
        assert.equal(unknown.column, null);
        assert(!('hint' in unknown));
        assert(!('endLine' in unknown));
        assert.deepEqual(JSON.parse(JSON.stringify(unknown)), unknown);
        const startOnly = createWarningDiagnostic('optimizer', 'INVALID_IR', 'Invalid IR', { line: 2, column: 3, endLine: 2, endColumn: 1 });
        assert(!('endColumn' in startOnly));
    });
    await test('malformed decimal retains the offending dot position and reliable hint', () => {
        const err = fatal(() => Lexer.tokenize('ENTITY Student\ncgpa FLOAT DEFAULT 8.'));
        check(err.diagnostic, 'LEX004', 'lexer', 2, 21);
        assert.equal(err.diagnostic.endColumn, 22);
        assert.match(err.diagnostic.hint, /8\.0/);
        assert.match(err.message, /Lexical Error at line 2, column 21/);
    });
    await test('multiple decimal points receive accurate guidance', () => {
        const err = fatal(() => Lexer.tokenize('8.1.2'));
        check(err.diagnostic, 'LEX004', 'lexer', 1, 4);
        assert.match(err.diagnostic.hint, /single decimal point/);
    });
    await test('invalid character preserves its legacy symbol and message', () => {
        const err = fatal(() => Lexer.tokenize('\n  @'));
        check(err.diagnostic, 'LEX001', 'lexer', 2, 3);
        assert.equal(err.code, 'UNEXPECTED_CHARACTER');
        assert.equal(err.diagnostic.symbol, err.code);
        assert.match(err.message, /Unexpected character '@'/);
        assert(!('hint' in err.diagnostic));
    });
    await test('invalid identifier and unterminated string carry consumed source ranges', () => {
        const identifier = fatal(() => Lexer.tokenize('123abc')).diagnostic;
        check(identifier, 'LEX002', 'lexer', 1, 1);
        assert.equal(identifier.endColumn, 7);
        const string = fatal(() => Lexer.tokenize('"abc')).diagnostic;
        check(string, 'LEX003', 'lexer', 1, 1);
        assert.equal(string.endColumn, 5);
    });
    await test('token widths include quotes and EOF has no fabricated range', () => {
        const tokens = Lexer.tokenize('\uFEFF"ok"\r\n\tINT');
        assert.equal(tokens[0].endColumn, 5);
        assert.equal(tokens[1].line, 2);
        assert.equal(tokens[1].column, 2);
        assert.equal(tokens[1].endColumn, 5);
        assert(!('endColumn' in tokens[2]));
    });
    for (const [name, source, code, line, column, symbol] of [
        ['missing entity name', 'ENTITY', 'PAR002', 1, 7, 'MISSING_ENTITY_NAME'],
        ['missing datatype', 'ENTITY Student\nage', 'PAR012', 2, 4, 'MISSING_DATATYPE'],
        ['invalid datatype', 'ENTITY Student\nage BANANA', 'PAR013', 2, 5, 'INVALID_DATATYPE'],
        ['generic expected token', 'ENTITY INT', 'PAR001', 1, 8, 'EXPECTED_TOKEN'],
        ['missing relationship target', 'RELATION Student ENROLLS', 'PAR005', 1, 25, 'MISSING_TARGET_ENTITY'],
        ['missing modifier value', 'ENTITY Student\nage INT MIN', 'PAR016', 2, 12, 'MISSING_MIN_VALUE']
    ]) {
        await test(`parser: ${name}`, () => {
            const err = fatal(() => parse(source));
            check(err.diagnostic, code, 'parser', line, column);
            assert.equal(err.diagnostic.symbol, symbol);
            if (source.endsWith('BANANA') || source === 'ENTITY INT') assert.equal(err.diagnostic.endLine, line);
            else assert(!('endColumn' in err.diagnostic));
        });
    }
    await test('EOF following a comment points to the actual end of input', () => {
        const err = fatal(() => parse('ENTITY // x'));
        check(err.diagnostic, 'PAR002', 'parser', 1, 12);
    });
    for (const [name, source, code, line, column, hint] of [
        ['reversed numeric bounds', 'ENTITY Student\nage INT MIN 60 MAX 18', 'SEM017', 2, 9, 'MIN must not exceed MAX.'],
        ['reversed length bounds', 'ENTITY Student\nname STRING MIN_LENGTH 9 MAX_LENGTH 2', 'SEM018', 2, 13, 'MIN_LENGTH must not exceed MAX_LENGTH.'],
        ['numeric modifier on STRING', 'ENTITY Student\nname STRING MIN 1', 'SEM015', 2, 13, 'Use MIN_LENGTH/MAX_LENGTH for STRING length bounds.'],
        ['numeric modifier on BOOLEAN', 'ENTITY Student\nactive BOOLEAN MAX 1', 'SEM015', 2, 16, undefined],
        ['duplicate field', 'ENTITY Student\nage INT\nage INT', 'SEM005', 3, 1, undefined],
        ['duplicate entity', 'ENTITY Student\nage INT\nENTITY Student\nage INT', 'SEM002', 3, 8, undefined],
        ['duplicate modifier', 'ENTITY Student\nage INT MIN 1 MIN 2', 'SEM012', 2, 15, undefined],
        ['duplicate constraint', 'ENTITY Student\nage INT REQUIRED REQUIRED', 'SEM009', 2, 18, undefined],
        ['invalid primary key type', 'ENTITY Student\nage FLOAT PRIMARY KEY', 'SEM011', 2, 5, undefined],
        ['invalid default type', 'ENTITY Student\nage INT DEFAULT "bad"', 'SEM021', 2, 9, undefined],
        ['missing entity', '// empty', 'SEM001', 1, 1, undefined],
        ['unknown relationship target', 'ENTITY Student\nvalue INT\nRELATION Student ENROLLS Course MANY_TO_MANY', 'SEM029', 3, 26, undefined],
        ['unknown relationship source', 'ENTITY Student\nvalue INT\nRELATION Course ENROLLS Student MANY_TO_MANY', 'SEM028', 3, 10, undefined],
        ['multiline modifier', 'ENTITY\nStudent\nage\nSTRING\nMIN 1', 'SEM015', 5, 1, 'Use MIN_LENGTH/MAX_LENGTH for STRING length bounds.']
    ]) {
        await test(`semantic: ${name}`, () => {
            const result = semantic(source);
            assert.equal(result.valid, false);
            const diagnostic = result.diagnostics.find(d => d.code === code);
            assert(diagnostic, JSON.stringify(result));
            check(diagnostic, code, 'semantic', line, column);
            assert.equal(diagnostic.hint, hint);
            const old = result.errors.find(e => e.diagnostic === diagnostic);
            assert.equal(old.message, diagnostic.message);
            assert.equal(old.code, diagnostic.symbol);
            if (code === 'SEM001') assert(!('endColumn' in diagnostic));
        });
    }
    await test('BOOLEAN length bounds do not suggest another invalid modifier', () => {
        const result = semantic('ENTITY Student\nactive BOOLEAN MIN_LENGTH 1');
        assert.equal(result.diagnostics[0].code, 'SEM016');
        assert(!('hint' in result.diagnostics[0]));
    });
    await test('repeated modifiers locate the actual invalid occurrence', () => {
        const source = 'ENTITY Student\nage INT MIN 1 MIN 2.5 DEFAULT 1 DEFAULT "bad"';
        const result = semantic(source);
        const bound = result.diagnostics.find(d => d.code === 'SEM019');
        assert.equal(bound.column, source.split('\n')[1].indexOf('MIN 2.5') + 1);
        const value = result.diagnostics.find(d => d.code === 'SEM021');
        assert.equal(value.column, source.split('\n')[1].indexOf('DEFAULT "bad"') + 1);
        assert.equal(value.endColumn, source.split('\n')[1].length + 1);
    });
    await test('multiline declarations locate their names on the correct line', () => {
        const result = semantic('ENTITY Student\nage INT\nENTITY\nStudent\nage INT');
        check(result.diagnostics.find(d => d.code === 'SEM002'), 'SEM002', 'semantic', 4, 1);
        const relation = semantic('ENTITY Student\nvalue INT\nRELATION\nStudent\nENROLLS\nCourse\nMANY_TO_MANY');
        check(relation.diagnostics[0], 'SEM029', 'semantic', 6, 1);
    });
    await test('semantic analysis still collects existing independent errors', () => {
        const result = semantic('ENTITY Student\nname STRING MIN 1\nage INT MIN 60 MAX 18');
        assert.deepEqual(result.diagnostics.map(d => d.code), ['SEM015', 'SEM017']);
    });
    await test('direct AST consumers get start-only locations when metadata is absent', () => {
        const ast = JSON.parse(JSON.stringify(parse('ENTITY Student\nage INT MIN 60 MAX 18')));
        const diagnostic = Semantic.analyze(ast).diagnostics[0];
        check(diagnostic, 'SEM017', 'semantic', 2, 1);
        assert(!('endColumn' in diagnostic));
    });
    await test('source frames handle CRLF, BOM, tabs, ranges, and start-only fallback', () => {
        assert.deepEqual(sourceFrame('\uFEFFx\r\n\tage INT', { line: 2, column: 2, endLine: 2, endColumn: 5 }),
            [{ line: 2, text: '\tage INT', pointer: '\t^^^' }]);
        assert.equal(sourceFrame('age INT', { line: 1, column: 5 })[0].pointer, '    ^');
        assert.deepEqual(sourceFrame('age', { line: 4, column: 1 }), []);
        assert.equal(sourceFrame('MIN\nMAX', { line: 1, column: 1, endLine: 2, endColumn: 1 }).length, 1);
        assert.equal(sourceFrame('age', { line: 1, column: null })[0].pointer, '');
        assert.deepEqual(sourceFrame('MIN\n 60', { line: 1, column: 1, endLine: 2, endColumn: 4 }).map(f => f.pointer), ['^^^', '^^^']);
    });
    await test('the browser and CLI use the same frame utility', () => {
        const context = vm.createContext({});
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/utils/source-frame.js'), 'utf8'), context);
        const location = { line: 1, column: 2, endLine: 1, endColumn: 4 };
        assert.equal(JSON.stringify(context.APIForgeSourceFrame.sourceFrame(' age INT', location)), JSON.stringify(sourceFrame(' age INT', location)));
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(body, raw = false) {
        const response = await fetch(`${base}/api/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
    }
    try {
        for (const [source, status, code, phase] of [
            ['ENTITY Student\ncgpa FLOAT DEFAULT 8.', 400, 'LEX004', 'lexer'],
            ['ENTITY Student\nage', 400, 'PAR012', 'parser'],
            ['ENTITY Student\nage INT MIN 60 MAX 18', 422, 'SEM017', 'semantic'],
            ['', 422, 'SEM001', 'semantic'], ['// empty', 422, 'SEM001', 'semantic']
        ]) {
            await test(`HTTP: ${phase} ${code} keeps status ${status} and skips downstream phases`, async () => {
                const { status: actual, data } = await post({ source });
                assert.equal(actual, status);
                assert.equal(data.diagnostic.code, code);
                assert.equal(data.diagnostic.phase, phase);
                assert.deepEqual(data.diagnostic, data.diagnostics[0]);
                assert.deepEqual(data.diagnostic, data.errors[0].diagnostic);
                assert.equal(data.phaseStates[phase], 'failed');
                assert.equal(data.phaseStates.codegen, 'skipped');
                assert(!data.generatedFiles);
            });
        }
        await test('HTTP missing, null and wrongly typed source remain 400', async () => {
            for (const body of [{}, { source: null }, { source: 4 }, { source: [] }]) {
                const result = await post(body);
                assert.equal(result.status, 400);
                assert.equal(result.data.diagnostic.code, 'INP001');
                assert.equal(result.data.diagnostic.line, null);
                assert(Object.values(result.data.phaseStates).every(state => state === 'skipped'));
            }
        });
        await test('malformed JSON retains the existing server status and never leaks a stack', async () => {
            const original = console.error;
            console.error = () => {};
            try {
                const result = await post('{', true);
                assert.equal(result.status, 500);
                assert.equal(result.data.error, 'Internal Server Error');
                assert.equal(result.data.diagnostic.code, 'INP002');
                assert(Object.values(result.data.phaseStates).every(state => state === 'skipped'));
                assert(!JSON.stringify(result.data).includes('SyntaxError'));
            } finally { console.error = original; }
        });
        for (const [phase, module, method] of [['lexer', Lexer, 'tokenize'], ['parser', Parser, 'parse'], ['semantic', Semantic, 'analyze'], ['ir', IR, 'generate'], ['optimizer', Optimizer, 'optimize'], ['codegen', Codegen, 'generate']]) {
            await test(`unexpected ${phase} exception returns a safe 500 diagnostic`, async () => {
                const original = module[method];
                module[method] = () => { throw new Error('PRIVATE_INTERNAL_DETAIL'); };
                try {
                    const result = await post({ source: 'ENTITY Student\nage INT' });
                    assert.equal(result.status, 500);
                    assert.equal(result.data.diagnostic.code, 'INT001');
                    assert.equal(result.data.diagnostic.phase, phase);
                    assert(!JSON.stringify(result.data).includes('PRIVATE_INTERNAL_DETAIL'));
                    assert.equal(result.data.phaseStates[phase], 'failed');
                } finally { module[method] = original; }
            });
        }
        await test('successful API compilation keeps all targets and no diagnostics', async () => {
            const result = await post({ source: 'ENTITY Student\nage INT MIN 1 MAX 90' });
            assert.equal(result.status, 200);
            assert.equal(result.data.generatedFiles.length, 10);
            assert(Object.values(result.data.phases).every(Boolean));
            assert(!result.data.diagnostics);
            assert.match(result.data.generatedFiles.find(f => f.path === 'database/schema.sql').content, /CREATE TABLE/);
        });
        await test('shared browser utility is served before app.js', async () => {
            const html = await (await fetch(base)).text();
            assert(html.indexOf('src="source-frame.js"') < html.indexOf('src="app.js"'));
            assert.match(await (await fetch(`${base}/source-frame.js`)).text(), /APIForgeSourceFrame/);
        });
    } finally { await new Promise(resolve => server.close(resolve)); }

    await test('CLI errors print codes, ranges and hints, exit 1 and create no output', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-diagnostics-'));
        try {
            for (const [source, code, phase] of [
                ['ENTITY Student\ncgpa FLOAT DEFAULT 8.', 'LEX004', 'lexer'],
                ['ENTITY Student\nage', 'PAR012', 'parser'],
                ['ENTITY Student\nage INT MIN 60 MAX 18', 'SEM017', 'semantic'],
                ['// empty', 'SEM001', 'semantic']
            ]) {
                fs.writeFileSync(path.join(directory, 'source.apiforge'), source);
                const result = spawnSync(process.execPath, [path.join(__dirname, '../index.js'), 'source.apiforge'], { cwd: directory, encoding: 'utf8' });
                assert.equal(result.status, 1, result.stderr);
                assert.match(result.stdout, new RegExp(`${code}:`));
                assert.match(result.stdout, /--> line/);
                assert.match(result.stdout, /\^/);
                assert(!result.stderr.includes('at '));
                assert(!fs.existsSync(path.join(directory, 'output')));
                assert(!result.stdout.includes('Phase 6:'));
                if (phase === 'semantic' && code === 'SEM017') {
                    assert.match(result.stdout, /\^{6}/);
                    assert.match(result.stdout, /Hint: MIN must not exceed MAX/);
                    assert.equal(formatDiagnostic(source, semantic(source).diagnostics[0]).includes('SEM017:'), true);
                }
            }
            // A failed compile also leaves any already generated output intact.
            fs.mkdirSync(path.join(directory, 'output'));
            fs.writeFileSync(path.join(directory, 'output/sentinel.txt'), 'keep');
            spawnSync(process.execPath, [path.join(__dirname, '../index.js'), 'source.apiforge'], { cwd: directory });
            assert.deepEqual(fs.readdirSync(path.join(directory, 'output')), ['sentinel.txt']);
            assert.equal(fs.readFileSync(path.join(directory, 'output/sentinel.txt'), 'utf8'), 'keep');
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    console.log(`Structured diagnostics: ${passed} tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
