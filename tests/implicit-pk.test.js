const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const express = require('express');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES, WARNING_CODES } = require('../src/utils/diagnostics');
const { hash } = require('./collection-query-test-helpers');
const baseline = require('./fixtures/implicit-pk-compatibility.json');
const { projectWriteChanges } = require('./request-validation-test-helpers');
const root = path.resolve(__dirname, '..');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
function compile(source) {
    const ast = Parser.parse(Lexer.tokenize(source)), semantic = Semantic.analyze(ast);
    assert.equal(semantic.valid, true, JSON.stringify(semantic.diagnostics));
    const ir = IR.generate(ast, semantic), optimized = Optimizer.optimize(ir).ir;
    return { ast, semantic, ir, optimized, files: Codegen.generate(optimized, false).files };
}
function content(result, name) { return result.files.find(f => f.path === name).content; }
function load(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
function model(result, name, query = () => []) {
    const calls = [];
    const pool = { query: async (sql, values) => { calls.push({ sql, values }); return [query(sql, values)]; } };
    return { Model: load(content(result, `models/${name}.js`), () => pool), calls };
}
async function listen(app, fn) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await fn(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}
function zipEntries(bytes) {
    const entries = []; let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
        const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
        const start = offset + 30 + length + extra;
        entries.push({ path: bytes.subarray(offset + 30, offset + 30 + length).toString(), content: bytes.subarray(start, start + size).toString() });
        offset = start + size;
    }
    return entries;
}

(async () => {
    await test('SEM033 rejects all id casings at the field-name range, without WRN001', () => {
        for (const [name, type] of [['id', 'STRING'], ['ID', 'INT'], ['Id', 'BOOLEAN'], ['iD', 'FLOAT']]) {
            const source = `ENTITY Item\n  ${name} ${type}\nname STRING`;
            const result = Semantic.analyze(Parser.parse(Lexer.tokenize(source)));
            assert.equal(result.valid, false);
            assert.deepEqual(result.warnings, []);
            assert.deepEqual(result.diagnostics, [{ phase: 'semantic', code: 'SEM033', severity: 'error',
                symbol: 'IMPLICIT_PRIMARY_KEY_COLLISION', line: 2, column: 3, endLine: 2, endColumn: 5,
                message: `Entity 'Item' has no explicit primary key, so APIForge would generate implicit field 'id', which conflicts with declared field '${name}'.`,
                hint: 'Declare an explicit PRIMARY KEY or rename the conflicting field.' }]);
        }
        const multiline = Semantic.analyze(Parser.parse(Lexer.tokenize('ENTITY Item\nID\nSTRING')));
        assert.deepEqual([multiline.diagnostics[0].line, multiline.diagnostics[0].column, multiline.diagnostics[0].endColumn], [2, 1, 3]);
    });
    await test('original 61 errors and five warnings are frozen; later errors are append-only', () => {
        const { IMPLICIT_PRIMARY_KEY_COLLISION, ...original } = CODES.semantic;
        assert.equal(IMPLICIT_PRIMARY_KEY_COLLISION, 'SEM033');
        assert.deepEqual(require('./v1-hardening-helpers').retainedCodes(CODES, baseline.codes), baseline.codes);
        assert.equal(Object.values(CODES).flatMap(Object.values).length, 68);
        assert.deepEqual(WARNING_CODES, baseline.warnings);
    });
    await test('explicit id controls and a non-first key retain declared identity', async () => {
        for (const source of ['ENTITY Item\nid STRING PRIMARY KEY\nname STRING', 'ENTITY Item\nID STRING PRIMARY KEY\nname STRING',
            ...['id', 'ID', 'Id', 'iD'].map(name => `ENTITY Item\n${name} STRING\ncode STRING PRIMARY KEY`)]) {
            const result = compile(source), key = result.ast.entities[0].fields.find(f => f.constraints.includes('PRIMARY_KEY')).name;
            assert.deepEqual(result.semantic.warnings, []);
            const { Model, calls } = model(result, 'Item', () => [{ [key]: 's-1' }]);
            await Model.findById('s-1'); await Model.update('s-1', { name: 'new' }); await Model.delete('s-1');
            for (const call of calls) assert(call.sql.includes(`WHERE ${key} = ?`));
            const swagger = JSON.parse(content(result, 'swagger.json'));
            assert.equal(swagger.paths['/items/{id}'].parameters[0].name, 'id');
            assert.equal(swagger.paths['/items/{id}'].parameters[0].schema.type, 'string');
        }
    });
    await test('15 before/after programs preserve source phases; all unaffected generated sections and implicit SQL stay byte-identical', () => {
        for (const [name, source] of Object.entries(baseline.sources)) {
            const result = compile(source);
            assert.equal(hash({ ast: result.ast, symbols: result.semantic.symbolTable, ir: result.ir,
                optimized: result.optimized, warnings: result.semantic.warnings }), baseline.programs[name].phases, name);
            assert.deepEqual(result.files.map(f => f.path), Object.keys(baseline.programs[name].files));
            const changed = projectWriteChanges(result.files, source).filter(f => hash(f.content) !== baseline.programs[name].files[f.path]).map(f => f.path);
            assert.deepEqual(changed, name === 'implicit' ? ['models/Student.js', 'swagger.json'] : [], name);
            for (const f of result.files.filter(f => f.path.endsWith('.js'))) new vm.Script(f.content, { filename: f.path });
        }
    });
    const implicit = compile(baseline.sources.implicit);
    await test('implicit emitted CRUD uses id, returns insertId and keeps declared metadata intact', async () => {
        const { Model, calls } = model(implicit, 'Student', sql => /^INSERT/.test(sql) ? { insertId: 42 } :
            /^DELETE/.test(sql) ? { affectedRows: 1 } : [{ id: 42, name: 'Alice', age: 20 }]);
        assert.deepEqual(Model.fields.map(f => f.name), ['name', 'age']);
        assert.deepEqual(await Model.create({ name: 'Alice', age: 20 }), { id: 42, name: 'Alice', age: 20 });
        // A stubbed insertId remains authoritative in response assembly; this
        // does not establish MySQL's caller-supplied AUTO_INCREMENT semantics.
        assert.equal((await Model.create({ id: 999, name: 'Alice' })).id, 42);
        calls.length = 0;
        await Model.findById(42); await Model.update(42, { name: 'Changed' }); await Model.delete(42);
        assert.deepEqual(calls, [
            { sql: 'SELECT * FROM Student WHERE id = ?', values: [42] },
            { sql: 'UPDATE Student SET ? WHERE id = ?', values: [{ name: 'Changed' }, 42] },
            { sql: 'SELECT * FROM Student WHERE id = ?', values: [42] },
            { sql: 'DELETE FROM Student WHERE id = ?', values: [42] }
        ]);
        calls.length = 0; await Model.update(42, {});
        assert.deepEqual(calls, [{ sql: 'SELECT * FROM Student WHERE id = ?', values: [42] }]);
    });
    await test('real emitted HTTP routes isolate update/delete when first-field values are shared', async () => {
        let rows = [], nextId = 1;
        const { Model, calls } = model(implicit, 'Student', (sql, values) => {
            if (sql.startsWith('INSERT')) { const id = nextId++; rows.push({ ...values[0], id }); return { insertId: id }; }
            // Interpret the emitted predicate, so a first-field fallback fails
            // this regression instead of being masked by a canned id-only DB.
            const key = sql.match(/WHERE (\w+) = \?/)?.[1];
            if (sql.startsWith('UPDATE')) {
                for (const row of rows.filter(row => row[key] == values[1])) Object.assign(row, values[0]);
                return { affectedRows: 1 };
            }
            if (sql.startsWith('DELETE')) {
                const old = rows.length; rows = rows.filter(row => row[key] != values[0]);
                return { affectedRows: old - rows.length };
            }
            const filtered = key ? rows.filter(row => row[key] == values[0]) : rows;
            return sql.includes('COUNT(*)') ? [{ total: filtered.length }] : filtered.map(row => ({ ...row }));
        });
        const controller = load(content(implicit, 'controllers/studentController.js'), () => Model);
        const router = load(content(implicit, 'routes/studentRoutes.js'), name => name === 'express' ? express : controller);
        const app = express(); app.use(express.json()); app.use('/students', router);
        await listen(app, async base => {
            const request = async (suffix, method = 'GET', body) => {
                const response = await fetch(base + '/students' + suffix, { method, headers: { 'content-type': 'application/json' },
                    ...(body ? { body: JSON.stringify(body) } : {}) });
                return { status: response.status, body: await response.json(), headers: response.headers };
            };
            const first = await request('', 'POST', { name: 'shared', age: 20 });
            const second = await request('', 'POST', { name: 'shared', age: 21 });
            assert.equal(first.status, 201); assert.equal(second.status, 201);
            assert.deepEqual([first.body.data.id, second.body.data.id], [1, 2]);
            assert.deepEqual((await request('/1')).body, { success: true, data: { id: 1, name: 'shared', age: 20 } });
            assert.equal((await request('/1', 'PUT', { age: 22 })).status, 200);
            assert.deepEqual(rows, [{ name: 'shared', age: 22, id: 1 }, { name: 'shared', age: 21, id: 2 }]);
            assert.equal((await request('/1', 'DELETE')).status, 200);
            assert.deepEqual(rows, [{ name: 'shared', age: 21, id: 2 }]);
            assert.equal((await request('/1')).status, 404);
            const collection = await request('?id=2&sort=id&page=1');
            assert.deepEqual(collection.body, { success: true, data: rows });
            for (const [header, value] of [['x-total-count', '1'], ['x-page', '1'], ['x-limit', '20'], ['x-total-pages', '1']])
                assert.equal(collection.headers.get(header), value);
            assert(calls.some(call => call.sql === 'SELECT * FROM Student WHERE id = ? ORDER BY id ASC LIMIT ? OFFSET ?'));
        });
    });
    await test('all four cardinalities agree on key/FK names, types and bound values in 20 variants', async () => {
        const variants = [['implicit', 'INT'], ['INT', 'implicit'], ['implicit', 'implicit'], ['INT', 'INT'], ['STRING', 'STRING']];
        for (const kind of ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']) for (const [sourceType, targetType] of variants) {
            const fields = type => type === 'implicit' ? 'label STRING' : `label STRING\ncode ${type} PRIMARY KEY`;
            const result = compile(`ENTITY Parent\n${fields(sourceType)}\nENTITY Child\n${fields(targetType)}\nRELATION Parent R Child ${kind}`);
            const sk = sourceType === 'implicit' ? 'id' : 'code', tk = targetType === 'implicit' ? 'id' : 'code';
            const sv = sourceType === 'STRING' ? 'p-42' : 42, tv = targetType === 'STRING' ? 'c-9' : 9;
            const sfk = `parent_${sk}`, tfk = `child_${tk}`;
            const { Model, calls } = model(result, 'Parent', sql => sql.startsWith('DELETE') ? { affectedRows: 1 } : []);
            await Model[kind === 'ONE_TO_MANY' || kind === 'MANY_TO_MANY' ? 'getChilds' : 'getChild'](sv);
            const expected = kind === 'MANY_TO_MANY'
                ? `SELECT t.* FROM Child t JOIN Parent_Child j ON t.${tk} = j.${tfk} WHERE j.${sfk} = ?`
                : kind === 'MANY_TO_ONE'
                    ? `SELECT t.* FROM Child t JOIN Parent s ON t.${tk} = s.${tfk} WHERE s.${sk} = ?`
                    : `SELECT * FROM Child WHERE ${sfk} = ?`;
            assert.deepEqual(calls[0], { sql: expected, values: [sv] });
            const sql = content(result, 'database/schema.sql');
            const checkFK = (column, type, table, key) => {
                assert(sql.includes(`${column} ${type === 'STRING' ? 'VARCHAR(255)' : 'INT'}`));
                assert(sql.includes(`FOREIGN KEY (${column}) REFERENCES ${table}(${key})`));
            };
            if (kind !== 'MANY_TO_ONE') checkFK(sfk, sourceType, 'Parent', sk);
            if (kind === 'MANY_TO_MANY' || kind === 'MANY_TO_ONE') checkFK(tfk, targetType, 'Child', tk);
            const swagger = JSON.parse(content(result, 'swagger.json'));
            const segment = kind === 'MANY_TO_MANY' || kind === 'ONE_TO_MANY' ? 'childs' : 'child';
            assert.equal(swagger.paths[`/parents/{id}/${segment}`].parameters[0].schema.type, sourceType === 'STRING' ? 'string' : 'integer');
            assert(content(result, 'routes/parentRoutes.js').includes(`/:id/${segment}`));
            if (kind === 'MANY_TO_MANY') {
                assert.deepEqual(await Model.addChild(sv, tv), { [sfk]: sv, [tfk]: tv });
                assert.equal(await Model.removeChild(sv, tv), true);
                assert.deepEqual(calls.slice(1), [
                    { sql: `INSERT INTO Parent_Child (${sfk}, ${tfk}) VALUES (?, ?)`, values: [sv, tv] },
                    { sql: `DELETE FROM Parent_Child WHERE ${sfk} = ? AND ${tfk} = ?`, values: [sv, tv] }
                ]);
                assert.equal(swagger.paths['/parents/{id}/childs/{childId}'].parameters[1].schema.type, targetType === 'STRING' ? 'string' : 'integer');
            }
            for (const f of result.files.filter(f => f.path.endsWith('.js'))) new vm.Script(f.content);
        }
    });
    await test('implicit readOnly OpenAPI id is integer and never required input; query id remains available', () => {
        const swagger = JSON.parse(content(implicit, 'swagger.json'));
        assert.deepEqual(swagger.components.schemas.Student.properties.id, { type: 'integer', readOnly: true });
        assert(!(swagger.components.schemas.Student.required || []).includes('id'));
        assert.equal(swagger.paths['/students/{id}'].parameters[0].schema.type, 'integer');
        assert.equal(swagger.paths['/students'].get.parameters.find(p => p.name === 'id').schema.type, 'integer');
        assert(swagger.paths['/students'].get.parameters.find(p => p.name === 'sort').schema.enum.includes('id'));
    });
    await test('compiler HTTP skips later phases on SEM033; success files equal CLI and browser ZIP entries', async () => {
        await listen(require('../server'), async base => {
            const post = async source => {
                const response = await fetch(base + '/api/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) });
                return { status: response.status, body: await response.json() };
            };
            const success = await post(baseline.sources.implicit);
            assert.equal(success.status, 200); assert.deepEqual(success.body.generatedFiles, implicit.files);
            assert.equal(success.body.warnings[0].code, 'WRN001');
            for (const name of ['id', 'ID', 'Id', 'iD']) {
                const failure = await post(`ENTITY Item\n${name} STRING`);
                assert.equal(failure.status, 422); assert.equal(failure.body.success, false);
                assert.equal(failure.body.diagnostic.code, 'SEM033');
                assert.deepEqual(failure.body.warnings, []);
                for (const phase of ['ir', 'optimizer', 'codegen']) assert.equal(failure.body.phaseStates[phase], 'skipped');
                assert(!failure.body.generatedFiles?.length);
            }
            const appSource = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
            const context = vm.createContext({ Blob, TextEncoder, Uint8Array, DataView });
            vm.runInContext(appSource.slice(appSource.indexOf('function createZip('), appSource.indexOf('function downloadProject(')), context);
            assert.deepEqual(zipEntries(Buffer.from(await context.createZip(success.body.generatedFiles).arrayBuffer())), implicit.files);
            const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-implicit-cli-'));
            try {
                for (const [name, source] of Object.entries({ valid: baseline.sources.implicit, invalid: 'ENTITY Item\nID INT' })) {
                    const cwd = path.join(temp, name); fs.mkdirSync(cwd);
                    const input = path.join(cwd, 'source.apiforge'); fs.writeFileSync(input, source);
                    const result = spawnSync(process.execPath, [path.join(root, 'index.js'), input], { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
                    assert.ifError(result.error); assert.equal(result.status, name === 'valid' ? 0 : 1, result.stdout + result.stderr);
                    if (name === 'invalid') { assert(result.stdout.includes('SEM033')); assert(!fs.existsSync(path.join(cwd, 'output'))); }
                    else for (const f of implicit.files) assert.equal(fs.readFileSync(path.join(cwd, 'output', f.path), 'utf8'), f.content);
                }
            } finally {
                const relative = path.relative(os.tmpdir(), temp);
                assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
                fs.rmSync(temp, { recursive: true, force: true });
            }
        });
    });
    console.log(`Implicit primary keys: ${passed} test groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
