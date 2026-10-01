const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const express = require('express');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES, WARNING_CODES } = require('../src/utils/diagnostics');
const { compileProject, snapshotDirectory } = require('./generated-backend-test-helpers');
const baseline = require('./fixtures/enum-compatibility.json');
const { projectWriteChanges } = require('./request-validation-test-helpers');
const { queryArtifact } = require('./collection-query-test-helpers');
const prefix = 'ENTITY User\nid INT PRIMARY KEY\nstatus ';
const parse = source => Parser.parse(Lexer.tokenize(source));
const analyze = suffix => Semantic.analyze(parse(prefix + suffix));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
function loadModule(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

(async () => {
    await test('ENUM and new punctuation have exclusive positioned ranges, BOM and comments remain intact', () => {
        const tokens = Lexer.tokenize('\uFEFFENUM("a", // ) ignored\n "b")');
        assert.deepEqual(tokens.slice(0, 4).map(t => [t.type, t.column, t.endColumn]),
            [['DATATYPE', 1, 5], ['LPAREN', 5, 6], ['STRING_LITERAL', 6, 9], ['COMMA', 9, 10]]);
        assert.equal(tokens[4].line, 2);
        assert.equal(tokens[4].value, 'b');
        assert.equal(Lexer.tokenize('enum')[0].type, 'IDENTIFIER');
        assert.throws(() => parse(prefix + 'enum("a")'), e => e.diagnostic.code === 'PAR013');
        assert.equal(Lexer.tokenize('"(,//)"')[0].value, '(,//)');
    });
    await test('one, multiple, multiline and case-distinct values preserve structured AST, symbols and IR', () => {
        for (const spec of ['ENUM("active") DEFAULT "active"', 'ENUM("active", "inactive", "suspended")',
            'ENUM("active", "inactive") REQUIRED UNIQUE', 'ENUM(\n "ACTIVE",\n "active"\n) DEFAULT "active"']) {
            const ast = parse(prefix + spec), semantic = Semantic.analyze(ast);
            assert.equal(semantic.valid, true, JSON.stringify(semantic.errors));
            const field = ast.entities[0].fields[1];
            assert.equal(field.dataType, 'ENUM');
            assert(!JSON.stringify(field).includes('sourceLocations'));
            assert.deepEqual(semantic.symbolTable.User.fields.status.enumValues, field.enumValues);
            const ir = IR.generate(ast, semantic), optimized = Optimizer.optimize(ir).ir;
            assert.deepEqual(ir.instructions[2].enumValues, field.enumValues);
            assert.deepEqual(optimized.instructions[2].enumValues, field.enumValues);
            assert.equal(ir.instructions[2].sourceLocations, field.sourceLocations);
            assert.equal(IR.validate(optimized).valid, true);
        }
    });
    await test('malformed declarations use generic token errors or the appended delimiter code at the offending token', () => {
        for (const [spec, code] of [['ENUM', 'PAR001'], ['ENUM(', 'PAR001'], ['ENUM()', 'PAR001'],
            ['ENUM("a",', 'PAR001'], ['ENUM(active)', 'PAR001'], ['ENUM(1)', 'PAR001'],
            ['ENUM("a",)', 'PAR001'], ['ENUM("a" "b")', 'PAR022'], ['ENUM("a", "b"', 'PAR022']]) {
            assert.throws(() => parse(prefix + spec), e => {
                assert.equal(e.diagnostic.code, code);
                assert.equal(e.diagnostic.phase, 'parser');
                assert.equal(e.diagnostic.line, 3);
                assert(e.diagnostic.column >= 12);
                if (spec === 'ENUM("a" "b")') assert.equal(e.diagnostic.endColumn - e.diagnostic.column, 3);
                return true;
            });
        }
    });
    await test('semantic errors reuse existing codes and locate duplicate values, defaults and bounds', () => {
        for (const [spec, code, column, endColumn] of [
            ['ENUM("active", "active")', 'SEM031', 23, 31],
            ['ENUM("a", "b") DEFAULT "deleted"', 'SEM032', 23, 40],
            ['ENUM("a", "b") DEFAULT 1', 'SEM021', 23, 32],
            ['ENUM("a") MIN 1', 'SEM015', 18, 23], ['ENUM("a") MAX 8', 'SEM015', 18, 23],
            ['ENUM("a") MIN_LENGTH 1', 'SEM016', 18, 30], ['ENUM("a") MAX_LENGTH 8', 'SEM016', 18, 30],
            ['ENUM("a") PRIMARY KEY', 'SEM011', 8, 12]]) {
            const result = analyze(spec); assert.equal(result.valid, false);
            const d = result.diagnostics.find(d => d.code === code); assert(d, JSON.stringify(result));
            assert.equal(d.line, 3); assert.equal(d.column, column); assert.equal(d.endColumn, endColumn);
            assert.deepEqual(result.warnings, []);
        }
        const hint = analyze('ENUM("active", "inactive") DEFAULT "deleted"').diagnostics[0].hint;
        assert.equal(hint, 'Use one of: "active", "inactive".');
        assert.equal(analyze('ENUM("ACTIVE", "active") DEFAULT "active"').valid, true);
        assert.equal(analyze('ENUM("active") DEFAULT "ACTIVE"').valid, false);
        assert.equal(analyze('ENUM("a") DEFAULT TRUE').diagnostics[0].code, 'SEM021');
        const many = Array.from({ length: 100 }, (_, i) => JSON.stringify('value' + i)).join(',');
        assert(analyze(`ENUM(${many}) DEFAULT "absent"`).diagnostics[0].hint.length < 240);
    });
    await test('direct AST and IR boundaries reject absent, empty, non-string and duplicate value arrays', () => {
        for (const values of [undefined, null, {}, [], Array(1), [1], ['a', 'a']]) {
            const ast = parse(prefix + 'ENUM("a")'); ast.entities[0].fields[1].enumValues = values;
            assert.equal(Semantic.analyze(ast).valid, false);
            const inst = { op: 'ADD_FIELD', entity: 'User', field: 'status', dataType: 'ENUM', constraints: [], enumValues: values };
            assert.equal(IR.validate({ type: 'PROGRAM', instructions: [inst] }).valid, false);
        }
    });
    await test('multiline duplicate and modifier diagnostics retain their actual token lines', () => {
        const result = analyze('ENUM(\n "active",\n "active"\n)\n MIN 1');
        const duplicate = result.diagnostics.find(d => d.code === 'SEM031');
        assert.deepEqual([duplicate.line, duplicate.column, duplicate.endLine, duplicate.endColumn], [5, 2, 5, 10]);
        const bound = result.diagnostics.find(d => d.code === 'SEM015');
        assert.deepEqual([bound.line, bound.column, bound.endLine, bound.endColumn], [7, 2, 7, 7]);
    });
    await test('ENUM sample compiles through all phases and preserves REQUIRED field schema', () => {
        const sample = fs.readFileSync(path.resolve(__dirname, '../samples/enum_account.apiforge'), 'utf8');
        const generated = compileProject(sample);
        assert.equal(generated.length, 10);
        const swagger = JSON.parse(generated.find(f => f.path === 'swagger.json').content);
        assert.deepEqual(swagger.components.schemas.Account.properties.role.enum, ['student', 'faculty', 'admin']);
        assert(swagger.components.schemas.Account.required.includes('role'));
    });
    await test('optimizer preserves order, metadata and conflicting value sets through normalization', () => {
        const first = { op: 'ADD_FIELD', entity: 'User', field: 'status', dataType: 'ENUM', enumValues: ['z', 'a'], constraints: ['UNIQUE', 'REQUIRED'] };
        Object.defineProperty(first, 'sourceLocations', { value: { type: [{ line: 3, column: 8 }] } });
        const second = { ...first, enumValues: ['a', 'z'] };
        const result = Optimizer.optimize({ instructions: [first, second] });
        assert.equal(result.ir.instructions.length, 2);
        assert.equal(result.warnings[0].code, 'WRN002');
        assert.deepEqual(result.ir.instructions[0].enumValues, ['z', 'a']);
        assert.equal(result.ir.instructions[0].sourceLocations, first.sourceLocations);
        assert.equal(Optimizer.optimize({ instructions: [first, { ...first }] }).ir.instructions.length, 1);
    });
    const source = prefix + 'ENUM("active", "inactive", "O\'Reilly", "C:\\folder", "") DEFAULT "active"';
    const files = compileProject(source), get = name => files.find(f => f.path === name).content;
    await test('SQL escapes legal apostrophes and literal backslashes, emits defaults, required and unique', () => {
        assert(get('database/schema.sql').includes("ENUM('active', 'inactive', 'O''Reilly', 'C:\\\\folder', '') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'active'"));
        const sql = compileProject(prefix + 'ENUM("a") REQUIRED UNIQUE DEFAULT "a"').find(f => f.path.endsWith('.sql')).content;
        assert.match(sql, /NOT NULL DEFAULT 'a' UNIQUE/);
        assert.equal(IR.validate({ instructions: [{ op: 'ADD_FIELD', entity: 'X', field: 's', dataType: 'ENUM', constraints: [], enumValues: null, defaultValue: { type: 'STRING', value: 'a' } }] }).valid, false);
    });
    await test('all emitted JS parses and OpenAPI request/response metadata is consistent', () => {
        for (const f of files.filter(f => f.path.endsWith('.js'))) new vm.Script(f.content);
        const swagger = JSON.parse(get('swagger.json'));
        assert.deepEqual(swagger.components.schemas.User.properties.status, { type: 'string', enum: ['active', 'inactive', "O'Reilly", 'C:\\folder', ''], default: 'active' });
        for (const verb of ['post', 'put']) {
            const route = swagger.paths[verb === 'post' ? '/users' : '/users/{id}'][verb];
            assert.equal(route.requestBody.content['application/json'].schema.$ref, '#/components/schemas/User');
        }
        const required = JSON.parse(compileProject(prefix + 'ENUM("a") REQUIRED UNIQUE').find(f => f.path === 'swagger.json').content);
        assert(required.components.schemas.User.required.includes('status'));
    });
    await test('real emitted POST/PUT routes accept members and omitted defaults; reject invalid strings and types before DB calls', async () => {
        const calls = [];
        const model = { create: async data => { calls.push(data); return 1; }, findById: async id => ({ id }),
            update: async (id, data) => { calls.push(data); return 1; } };
        const controller = loadModule(get('controllers/userController.js'), () => model);
        const router = loadModule(get('routes/userRoutes.js'), p => p === 'express' ? express : controller);
        const app = express(); app.use(express.json()); app.use('/users', router);
        const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
        try {
            const base = `http://127.0.0.1:${server.address().port}`;
            for (const method of ['POST', 'PUT']) {
                for (const body of [{ status: 'active' }, { status: "O'Reilly" }, { status: 'C:\\folder' }, { status: '' }, {}, { status: null }]) {
                    const response = await fetch(base + (method === 'POST' ? '/users' : '/users/1'), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                    assert.equal(response.status, method === 'POST' ? 201 : 200, await response.text());
                }
                for (const status of ['deleted', 'ACTIVE', 1, true, [], {}]) {
                    const count = calls.length;
                    const response = await fetch(base + (method === 'POST' ? '/users' : '/users/1'), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
                    assert.equal(response.status, 400);
                    assert.equal((await response.json()).error, "Field 'status' must be one of: active, inactive, O'Reilly, C:\\folder, .");
                    assert.equal(calls.length, count);
                }
            }
        } finally { await close(server); }
        const requiredController = loadModule(compileProject(prefix + 'ENUM("a") REQUIRED').find(f => f.path.includes('Controller')).content, () => model);
        assert(requiredController.validateUser({ status: null }));
        assert.equal(requiredController.validateUser({}), null); // Default direct validation mode is partial update.
        assert.equal(requiredController.validateUser({}, 'create'), "Field 'status' is required.");
    });
    await test('compiler HTTP API reports success, parser and semantic failure with later phases skipped', async () => {
        const server = require('../server').listen(0); await new Promise(resolve => server.once('listening', resolve));
        try {
            for (const [spec, status, code, phase] of [['ENUM("a")', 200], ['ENUM("a" "b")', 400, 'PAR022', 'parser'], ['ENUM("a", "a")', 422, 'SEM031', 'semantic'], ['ENUM("a") DEFAULT "b"', 422, 'SEM032', 'semantic']]) {
                const response = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: prefix + spec }) });
                assert.equal(response.status, status); const data = await response.json();
                if (code) { assert.equal(data.diagnostic.code, code); assert.equal(data.phaseStates[phase], 'failed'); assert.equal(data.phaseStates.codegen, 'skipped'); assert(!data.generatedFiles); }
                else { assert(Object.values(data.phaseStates).every(s => s === 'succeeded')); assert(data.generatedFiles.length); }
            }
        } finally { await close(server); }
    });
    await test('CLI valid ENUM exits 0, invalid ENUM exits 1, repository output remains untouched', () => {
        const output = path.resolve(__dirname, '../output'), before = snapshotDirectory(output);
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-enum-cli-'));
        try {
            for (const [spec, exit, code] of [['ENUM("a")', 0], ['ENUM("a", "a")', 1, 'SEM031'], ['ENUM("a") DEFAULT "b"', 1, 'SEM032']]) {
                fs.writeFileSync(path.join(temp, 'source.apiforge'), prefix + spec);
                const result = spawnSync(process.execPath, [path.resolve(__dirname, '../index.js'), 'source.apiforge'], { cwd: temp, encoding: 'utf8' });
                assert.equal(result.status, exit, result.stderr);
                if (code) assert(result.stdout.includes(code));
                else assert(fs.readFileSync(path.join(temp, 'output/database/schema.sql'), 'utf8').includes("ENUM('a')"));
            }
            assert.deepEqual(snapshotDirectory(output), before);
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
    await test('all 57 original error assignments and five warning assignments remain exactly unchanged', () => {
        for (const [phase, codes] of Object.entries(baseline.codes)) for (const [symbol, code] of Object.entries(codes)) assert.equal(CODES[phase][symbol], code);
        assert.deepEqual(WARNING_CODES, baseline.warnings);
        assert.equal(Object.values(baseline.codes).flatMap(Object.values).length, 57);
    });
    await test('unchanged generated files match pre-ENUM baselines for five representative old programs', () => {
        for (const [name, source] of Object.entries(baseline.sources)) {
            const hashes = Object.fromEntries(projectWriteChanges(compileProject(source), source).map(f => [f.path, crypto.createHash('sha256').update(f.content).digest('hex')]));
            const stable = entries => Object.fromEntries(Object.entries(entries).filter(([file]) => !queryArtifact(file)));
            assert.deepEqual(Object.keys(hashes), Object.keys(baseline.projects[name]));
            assert.deepEqual(stable(hashes), stable(baseline.projects[name]), name);
        }
    });
    await test('frontend AST, symbols and IR display quoted values with HTML escaping', () => {
        const js = fs.readFileSync(path.resolve(__dirname, '../frontend/app.js'), 'utf8');
        const helper = js.match(/function displayDataType\(field\) \{[\s\S]*?\n\}/)[0];
        const display = vm.runInNewContext('(' + helper + ')');
        assert.equal(display({ dataType: 'ENUM', enumValues: ['<tag>', "O'Reilly"] }), 'ENUM("<tag>", "O\'Reilly")');
        assert(js.includes('escapeHtml(displayDataType(field))'));
        assert(js.includes('escapeHtml(displayDataType(inst))'));
    });
    console.log(`ENUM support: ${passed} tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
