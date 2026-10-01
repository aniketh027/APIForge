const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { spawnSync } = require('child_process');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES, COMPILER_PHASES, createWarningDiagnostic, sortDiagnostics } = require('../src/utils/diagnostics');
const { sourceFrame } = require('../src/utils/source-frame');
const baseline = require('./fixtures/warning-artifact-baseline.json');
const { stableArtifacts } = require('./collection-query-test-helpers');
const app = require('../server');
const root = path.resolve(__dirname, '..');
let passed = 0;
async function test(name, fn) {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
}
function compile(source) {
    const ast = Parser.parse(Lexer.tokenize(source));
    const semantic = Semantic.analyze(ast);
    assert.equal(semantic.valid, true, JSON.stringify(semantic.errors));
    const ir = IR.generate(ast, semantic);
    const optimized = Optimizer.optimize(ir);
    return { ast, semantic, ir, optimized, files: Codegen.generate(optimized.ir, false).files };
}
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const field = (dataType, location = {}) => ({ op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType, constraints: [], validations: [], defaultValue: null, ...location });
const relation = (relationType, targetEntity = 'Course', location = {}) => ({ op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS', targetEntity, relationType, ...location });
function checkWarning(warning, code, symbol, phase = 'optimizer') {
    assert.equal(warning.severity, 'warning');
    assert.equal(warning.code, code);
    assert.equal(warning.symbol, symbol);
    assert.equal(warning.phase, phase);
    assert.deepEqual(JSON.parse(JSON.stringify(warning)), warning);
}

(async () => {
    await test('all 57 error code assignments match the pre-change registry', () => {
        const original = require('./fixtures/enum-compatibility.json').codes;
        const retained = Object.fromEntries(Object.entries(original).map(([phase, codes]) =>
            [phase, Object.fromEntries(Object.keys(codes).map(symbol => [symbol, CODES[phase][symbol]]))]));
        assert.equal(hash(retained), baseline.errorRegistrySha256);
    });
    await test('implicit primary key is a single located warning, never an error or an AST/IR field', () => {
        const result = compile(baseline.programs.implicit.source);
        assert.deepEqual(result.semantic.errors, []);
        assert.deepEqual(result.semantic.diagnostics, []);
        assert.equal(result.semantic.warnings.length, 1);
        const warning = result.semantic.warnings[0];
        checkWarning(warning, 'WRN001', 'IMPLICIT_PRIMARY_KEY', 'semantic');
        assert.deepEqual([warning.line, warning.column, warning.endLine, warning.endColumn], [1, 8, 1, 15]);
        assert.equal(warning.message, "Entity 'Student' has no explicit primary key. APIForge will generate an implicit integer id field.");
        assert.equal(warning.hint, 'Declare an explicit PRIMARY KEY to control the identifier.');
        assert(!result.ast.entities[0].fields.some(f => f.name === 'id'));
        assert(!result.ir.instructions.some(i => i.field === 'id'));
        assert(!result.semantic.symbolTable.Student.fields.id);
        assert.deepEqual(result.optimized.warnings, []);
        assert.match(result.files.find(f => f.path === 'database/schema.sql').content, /id INT PRIMARY KEY AUTO_INCREMENT/);
    });
    await test('INT, STRING and defaulted explicit primary keys produce no implicit-key warning', () => {
        for (const declaration of ['id INT PRIMARY KEY', 'key STRING PRIMARY KEY', 'id INT PRIMARY KEY DEFAULT 1']) {
            assert.deepEqual(compile(`ENTITY Student\n${declaration}\nname STRING`).semantic.warnings, []);
        }
    });
    await test('multiline entity names retain token range; direct ASTs retain only genuine positions', () => {
        const source = 'ENTITY\n  Student\nname STRING';
        const ast = Parser.parse(Lexer.tokenize(source));
        const warning = Semantic.analyze(ast).warnings[0];
        assert.deepEqual([warning.line, warning.column, warning.endLine, warning.endColumn], [2, 3, 2, 10]);
        const direct = JSON.parse(JSON.stringify(ast));
        const fallback = Semantic.analyze(direct).warnings[0];
        assert.equal(fallback.line, direct.entities[0].line);
        assert(!('endColumn' in fallback));
        delete direct.entities[0].line;
        delete direct.entities[0].nameColumn;
        const unknown = Semantic.analyze(direct).warnings[0];
        assert.equal(unknown.line, null);
        assert.equal(unknown.column, null);
    });
    await test('invalid and duplicate DSL declarations stay fatal semantic errors without speculative warnings', () => {
        for (const [source, symbol] of [
            ['ENTITY Student\nname STRING\nname INT', 'DUPLICATE_FIELD'],
            ['ENTITY Student\nname STRING\nENTITY Student\nname INT', 'DUPLICATE_ENTITY'],
            ['ENTITY Student\nname STRING\nENTITY Course\ntitle STRING\nRELATION Student ENROLLS Course MANY_TO_MANY\nRELATION Student ENROLLS Course ONE_TO_MANY', 'DUPLICATE_RELATION'],
            ['ENTITY Student', 'EMPTY_ENTITY']
        ]) {
            const result = Semantic.analyze(Parser.parse(Lexer.tokenize(source)));
            assert.equal(result.valid, false);
            assert(result.diagnostics.some(d => d.symbol === symbol && d.severity === 'error'));
            assert.deepEqual(result.warnings, []);
            assert.throws(() => IR.generate(Parser.parse(Lexer.tokenize(source)), result), /Semantic analysis failed/);
        }
    });
    for (const [name, program] of Object.entries(baseline.programs)) {
        await test(`artifact regression: ${name} IR and unaffected generated files match baseline ${baseline.baselineCommit.slice(0, 7)}`, () => {
            const result = compile(program.source);
            assert.equal(hash(result.ir), program.irSha256);
            assert.equal(hash(result.optimized.ir), program.optimizedIRSha256);
            assert.deepEqual(result.files.map(f => f.path), program.files.map(f => f.path));
            assert.deepEqual(stableArtifacts(result.files).map(f => ({ path: f.path, sha256: hash(f.content) })), stableArtifacts(program.files));
        });
    }
    await test('optimizer removes exact duplicates and preserves conflicts with structured field warnings', () => {
        const original = { type: 'PROGRAM', instructions: [field('STRING'), field('STRING'), field('INT')] };
        const saved = structuredClone(original);
        const result = Optimizer.optimize(original);
        assert.deepEqual(original, saved);
        assert.deepEqual(result.ir.instructions, [original.instructions[0], original.instructions[2]]);
        assert.equal(result.optimizations.find(o => o.pass === 'Duplicate Field Elimination').count, 1);
        assert.equal(result.warnings.length, 1);
        checkWarning(result.warnings[0], 'WRN002', 'CONFLICTING_FIELD');
        assert.equal(result.warnings[0].line, null);
        assert.equal(result.warnings[0].column, null);
        assert(!('endColumn' in result.warnings[0]));
        assert.equal(result.warnings[0].message, "Optimization Conflict: Duplicate field 'Student.name' has conflicting declarations: 'STRING []' vs 'INT []'.");
    });
    await test('optimizer preserves relation type and endpoint conflicts and removes exact duplicate relations', () => {
        const instructions = [relation('MANY_TO_MANY'), relation('MANY_TO_MANY'), relation('ONE_TO_MANY'), relation('MANY_TO_MANY', 'Department')];
        const result = Optimizer.optimize({ instructions });
        assert.deepEqual(result.ir.instructions, [instructions[0], instructions[2], instructions[3]]);
        assert.equal(result.warnings.length, 2);
        checkWarning(result.warnings[0], 'WRN003', 'CONFLICTING_RELATION_TYPE');
        checkWarning(result.warnings[1], 'WRN004', 'CONFLICTING_RELATION_ENDPOINTS');
        assert(result.warnings.every(w => w.line === null && w.column === null && !('endLine' in w)));
    });
    await test('optimizer warnings preserve available line-only, full range and parser-style metadata', () => {
        const locations = [
            { line: 9 },
            { line: 9, column: 3, endLine: 9, endColumn: 7 },
            { line: 1, sourceLocations: { name: [{ line: 9, column: 3, endLine: 9, endColumn: 7 }] } }
        ];
        for (const location of locations) {
            const warning = Optimizer.optimize({ instructions: [field('STRING'), field('INT', location)] }).warnings[0];
            assert.equal(warning.line, 9);
            if (location.column || location.sourceLocations) {
                assert.deepEqual([warning.column, warning.endLine, warning.endColumn], [3, 9, 7]);
            } else {
                assert.equal(warning.column, null);
                assert(!('endColumn' in warning));
            }
        }
        const warning = Optimizer.optimize({ instructions: [relation('MANY_TO_MANY'), relation('ONE_TO_MANY', 'Course', locations[2])] }).warnings[0];
        assert.deepEqual([warning.line, warning.column, warning.endLine, warning.endColumn], [9, 3, 9, 7]);
    });
    await test('existing invalid-IR optimizer fallback stays non-throwing and returns its input', () => {
        for (const input of [null, {}, { instructions: 'invalid' }]) {
            const result = Optimizer.optimize(input);
            assert.equal(result.ir, input);
            assert.deepEqual(result.optimizations, []);
            assert.equal(result.warnings.length, 1);
            checkWarning(result.warnings[0], 'WRN005', 'INVALID_IR');
            assert.equal(result.warnings[0].message, 'Invalid IR passed to optimizer.');
        }
    });
    await test('normalization preserves non-enumerable source metadata for optimizer warnings', () => {
        const conflicting = { ...field('INT'), constraints: ['UNIQUE', 'REQUIRED', 'UNIQUE'],
            validations: [{ type: 'MAX', value: 9 }, { type: 'MIN', value: 1 }, { type: 'MIN', value: 1 }] };
        const metadata = { name: [{ line: 9, column: 3, endLine: 9, endColumn: 7 }] };
        Object.defineProperty(conflicting, 'sourceLocations', { value: metadata, enumerable: false });
        const result = Optimizer.optimize({ instructions: [field('STRING'), conflicting] });
        const warning = result.warnings[0];
        assert.deepEqual([warning.line, warning.column, warning.endLine, warning.endColumn], [9, 3, 9, 7]);
        assert.equal(result.ir.instructions[1].sourceLocations, metadata);
        assert.equal(Object.getOwnPropertyDescriptor(result.ir.instructions[1], 'sourceLocations').enumerable, false);
        assert.deepEqual(result.ir.instructions[1].constraints, ['REQUIRED', 'UNIQUE']);
        assert.deepEqual(result.ir.instructions[1].validations, [{ type: 'MIN', value: 1 }, { type: 'MAX', value: 9 }]);
        assert.deepEqual(conflicting.constraints, ['UNIQUE', 'REQUIRED', 'UNIQUE']);
    });
    await test('warning ordering uses phase, known line/column, code and stable emission ties without mutation', () => {
        const make = (symbol, line, column, message = symbol) => createWarningDiagnostic('optimizer', symbol, message, { line, column });
        const sem = createWarningDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY', 'Semantic', { line: 100 });
        const first = make('INVALID_IR', undefined, undefined, 'First');
        const last = make('INVALID_IR', undefined, undefined, 'Last');
        const items = [first, make('CONFLICTING_FIELD', 3), make('CONFLICTING_RELATION_TYPE', 2, 3), last, sem,
            make('CONFLICTING_FIELD', 2, 3), make('CONFLICTING_FIELD', 2, 1), make('CONFLICTING_RELATION_TYPE')];
        const original = [...items];
        const sorted = sortDiagnostics(items);
        assert.deepEqual(items, original);
        assert.deepEqual(sorted.map(w => w.message), ['Semantic', 'CONFLICTING_FIELD', 'CONFLICTING_FIELD', 'CONFLICTING_RELATION_TYPE', 'CONFLICTING_FIELD', 'CONFLICTING_RELATION_TYPE', 'First', 'Last']);
        const instructions = [field('STRING'), field('INT', { line: 10 }), field('FLOAT', { line: 3 }), relation('MANY_TO_MANY'), relation('ONE_TO_MANY', 'Course', { line: 1 })];
        const result = Optimizer.optimize({ instructions });
        assert.deepEqual(result.warnings.map(w => w.line), [1, 3, 10]);
        assert.deepEqual(Optimizer.optimize({ instructions }).warnings, result.warnings);
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    async function post(source) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) });
        return { status: response.status, data: await response.json() };
    }
    function checkSuccess(result) {
        assert.equal(result.status, 200);
        assert.equal(result.data.success, true);
        assert.deepEqual(result.data.phaseStates, Object.fromEntries(COMPILER_PHASES.map(p => [p, 'succeeded'])));
        assert(Object.values(result.data.phases).every(Boolean));
        assert.equal(result.data.generatedFiles.length, 10);
        assert(!result.data.diagnostics);
        assert(!result.data.errors);
    }
    try {
        await test('HTTP explicit PK succeeds with warnings [] and generated files', async () => {
            const result = await post(baseline.programs.explicit.source);
            checkSuccess(result);
            assert.deepEqual(result.data.warnings, []);
        });
        await test('HTTP implicit PK succeeds with exactly the semantic warning and unchanged files', async () => {
            const result = await post(baseline.programs.implicit.source);
            checkSuccess(result);
            assert.deepEqual(result.data.warnings, compile(baseline.programs.implicit.source).semantic.warnings);
            assert.deepEqual(stableArtifacts(result.data.generatedFiles).map(f => ({ path: f.path, sha256: hash(f.content) })), stableArtifacts(baseline.programs.implicit.files));
        });
        await test('HTTP combines semantic and optimizer warnings once in phase order', async () => {
            // DSL conflicts are rejected earlier. Inject real direct-IR optimizer diagnostics
            // into the optimizer boundary to exercise otherwise unreachable aggregation.
            const original = Optimizer.optimize;
            const conflicts = original({ instructions: [field('STRING'), field('INT', { line: 1 })] }).warnings;
            Optimizer.optimize = ir => ({ ...original(ir), warnings: conflicts });
            try {
                const result = await post(baseline.programs.implicit.source);
                checkSuccess(result);
                assert.deepEqual(result.data.warnings.map(w => w.code), ['WRN001', 'WRN002']);
                assert.deepEqual(result.data.generatedFiles, compile(baseline.programs.implicit.source).files);
            } finally { Optimizer.optimize = original; }
        });
        await test('HTTP duplicate declarations remain 422 and internal exceptions remain safe INT001', async () => {
            const duplicate = await post('ENTITY Student\nname STRING\nname INT');
            assert.equal(duplicate.status, 422);
            assert.equal(duplicate.data.diagnostic.code, 'SEM005');
            assert.equal(duplicate.data.diagnostic.severity, 'error');
            assert.deepEqual(duplicate.data.warnings, []);
            assert.equal(duplicate.data.phaseStates.codegen, 'skipped');
            assert(!duplicate.data.generatedFiles);
            const original = Codegen.generate;
            Codegen.generate = () => { throw new Error('PRIVATE_WARNING_TEST_DETAIL'); };
            try {
                const result = await post(baseline.programs.implicit.source);
                assert.equal(result.status, 500);
                assert.equal(result.data.diagnostic.code, 'INT001');
                assert.equal(result.data.diagnostic.severity, 'error');
                assert.deepEqual(result.data.warnings.map(w => w.code), ['WRN001']);
                assert(!JSON.stringify(result.data).includes('PRIVATE_WARNING_TEST_DETAIL'));
                assert.equal(result.data.phaseStates.semantic, 'succeeded');
                assert.equal(result.data.phaseStates.codegen, 'failed');
            } finally { Codegen.generate = original; }
        });
    } finally { await new Promise(resolve => server.close(resolve)); }

    await test('CLI warning prints code, frame and hint, exits zero and writes unchanged output', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-warnings-'));
        try {
            const source = baseline.programs.implicit.source;
            fs.writeFileSync(path.join(directory, 'source.apiforge'), source);
            const result = spawnSync(process.execPath, [path.join(root, 'index.js'), 'source.apiforge'], { cwd: directory, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stderr, '');
            assert.match(result.stdout, /\[!\] 1 warning — compilation succeeded/);
            assert.match(result.stdout, /WRN001: Entity 'Student'/);
            assert.match(result.stdout, /--> line 1, column 8/);
            assert.match(result.stdout, /\^{7}/);
            assert.match(result.stdout, /Hint: Declare an explicit PRIMARY KEY/);
            assert.match(result.stdout, /Semantic analysis passed/);
            assert.match(result.stdout, /Code generation completed/);
            assert.equal((result.stdout.match(/WRN001:/g) || []).length, 1);
            assert(!result.stdout.includes('[ABORT]'));
            for (const file of compile(baseline.programs.implicit.source).files) {
                assert.equal(hash(fs.readFileSync(path.join(directory, 'output', file.path), 'utf8')), hash(file.content));
            }
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    await test('CLI warning ordering follows source locations; explicit keys have no warnings', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-warning-order-'));
        try {
            fs.writeFileSync(path.join(directory, 'source.apiforge'), 'ENTITY Zebra\nname STRING\nENTITY Alpha\nname STRING');
            const run = () => spawnSync(process.execPath, [path.join(root, 'index.js'), 'source.apiforge'], { cwd: directory, encoding: 'utf8' });
            const result = run();
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /\[!\] 2 warnings/);
            assert(result.stdout.indexOf("WRN001: Entity 'Zebra'") < result.stdout.indexOf("WRN001: Entity 'Alpha'"));
            fs.writeFileSync(path.join(directory, 'source.apiforge'), baseline.programs.explicit.source);
            const explicit = run();
            assert.equal(explicit.status, 0);
            assert(!explicit.stdout.includes('WRN001'));
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    await test('CLI combines semantic and direct-IR optimizer warnings in phase order without object coercion', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-warning-cli-phases-'));
        try {
            fs.writeFileSync(path.join(directory, 'source.apiforge'), baseline.programs.implicit.source);
            fs.writeFileSync(path.join(directory, 'optimizer-preload.cjs'), `
                const optimizer = require(${JSON.stringify(path.join(root, 'src/optimizer/optimizer.js'))});
                const original = optimizer.optimize;
                const warnings = original({instructions: ${JSON.stringify([field('STRING'), field('INT')])}}).warnings;
                optimizer.optimize = ir => ({...original(ir), warnings});
            `);
            const result = spawnSync(process.execPath, ['--require', path.join(directory, 'optimizer-preload.cjs'), path.join(root, 'index.js'), 'source.apiforge'], { cwd: directory, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stderr, '');
            assert.match(result.stdout, /\[!\] 2 warnings — compilation succeeded/);
            assert(result.stdout.indexOf('WRN001:') < result.stdout.indexOf('WRN002:'));
            assert.equal((result.stdout.match(/WRN002:/g) || []).length, 1);
            assert(!result.stdout.includes('[object Object]'));
            assert(fs.existsSync(path.join(directory, 'output/database/schema.sql')));
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    await test('browser warning renderer escapes content, shares source frames and omits unavailable metadata', () => {
        const appSource = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
        const renderer = appSource.slice(appSource.indexOf('function renderWarnings('), appSource.indexOf('function hideSummary('));
        const context = vm.createContext({ editor: { value: 'ENTITY Student' }, APIForgeSourceFrame: { sourceFrame },
            formatPhaseName: phase => phase, escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') });
        vm.runInContext(renderer, context);
        const warning = createWarningDiagnostic('semantic', 'IMPLICIT_PRIMARY_KEY', '<script> & "message"', { line: 1, column: 8, endLine: 1, endColumn: 15 }, '<hint>');
        const html = context.renderWarnings([warning]);
        assert.match(html, /semantic warning/);
        assert.match(html, /WRN001/);
        assert.match(html, /&lt;script&gt; &amp; &quot;message&quot;/);
        assert.match(html, /\^{7}/);
        assert.match(html, /Hint: &lt;hint&gt;/);
        assert(!html.includes('error-card'));
        assert(!html.includes('<script>'));
        const unknown = context.renderWarnings([createWarningDiagnostic('optimizer', 'INVALID_IR', 'Invalid IR')]);
        assert(!unknown.includes('warning-excerpt'));
        assert(!unknown.includes('Hint:'));
        assert.equal(context.renderWarnings([]), '');
    });
    await test('browser summary remains successful and shows warnings once; no-warning summary omits the metric', () => {
        const appSource = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
        const renderer = appSource.slice(appSource.indexOf('function renderSummary('), appSource.indexOf('function hideSummary('));
        const context = vm.createContext({ editor: { value: baseline.programs.implicit.source }, APIForgeSourceFrame: { sourceFrame },
            summaryPanel: { classList: { add() {} } }, summaryContent: { innerHTML: '' },
            formatPhaseName: phase => phase, escapeHtml: String });
        vm.runInContext(renderer, context);
        const result = compile(baseline.programs.implicit.source);
        context.renderSummary({ ast: result.ast, generatedFiles: result.files, warnings: result.semantic.warnings });
        assert.match(context.summaryContent.innerHTML, /Compiled successfully/);
        assert.match(context.summaryContent.innerHTML, /summary-warning/);
        assert.equal((context.summaryContent.innerHTML.match(/>WRN001</g) || []).length, 1);
        context.renderSummary({ ast: result.ast, generatedFiles: result.files, warnings: [] });
        assert(!context.summaryContent.innerHTML.includes('summary-warning'));
        assert(!context.summaryContent.innerHTML.includes('warning-list'));
    });
    await test('browser explicit phaseStates display success accurately and preserve fatal/skipped states', () => {
        const appSource = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
        const statuses = {};
        const context = vm.createContext({ PHASE_ORDER: COMPILER_PHASES, pipelineState: { textContent: '' },
            setPhaseStatus: (phase, state) => { statuses[phase] = state; }, formatPhaseName: phase => phase });
        vm.runInContext(appSource.slice(appSource.indexOf('function applyPhaseStatuses('), appSource.indexOf('function formatPhaseName(')), context);
        context.applyPhaseStatuses({}, true, undefined, Object.fromEntries(COMPILER_PHASES.map(p => [p, 'succeeded'])));
        assert(Object.values(statuses).every(state => state === 'success'));
        assert.equal(context.pipelineState.textContent, 'All phases completed');
        context.applyPhaseStatuses({}, false, 'semantic', { lexer: 'succeeded', parser: 'succeeded', semantic: 'failed', ir: 'skipped', optimizer: 'skipped', codegen: 'skipped' });
        assert.equal(statuses.semantic, 'error');
        assert.equal(statuses.codegen, 'skipped');
        assert.equal(context.pipelineState.textContent, 'semantic failed');
    });
    await test('browser download ZIP builder preserves every generated file with semantic warnings', async () => {
        const appSource = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
        const context = vm.createContext({ Blob, TextEncoder });
        vm.runInContext(appSource.slice(appSource.indexOf('function createZip('), appSource.indexOf('function downloadProject(')), context);
        const result = compile(baseline.programs.implicit.source);
        const zip = context.createZip(result.files);
        assert.equal(zip.type, 'application/zip');
        const bytes = Buffer.from(await zip.arrayBuffer());
        const files = [];
        let offset = 0;
        while (bytes.readUInt32LE(offset) === 0x04034b50) {
            const size = bytes.readUInt32LE(offset + 18);
            const nameLength = bytes.readUInt16LE(offset + 26);
            const extraLength = bytes.readUInt16LE(offset + 28);
            const contentOffset = offset + 30 + nameLength + extraLength;
            files.push({ path: bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'),
                sha256: hash(bytes.subarray(contentOffset, contentOffset + size).toString('utf8')) });
            offset = contentOffset + size;
        }
        assert.deepEqual(files, result.files.map(file => ({ path: file.path, sha256: hash(file.content) })));
        assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
        assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
        assert.equal(bytes.readUInt16LE(bytes.length - 12), 10);
    });
    console.log(`Compiler warnings: ${passed} tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
