const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES, WARNING_CODES } = require('../src/utils/diagnostics');
const { compileProject } = require('./generated-backend-test-helpers');
const { hash, protectedSections } = require('./collection-query-test-helpers');
const baseline = require('./fixtures/collection-query-compatibility.json');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
function load(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
const files = compileProject(baseline.sources.types);
const file = name => files.find(file => file.path === name).content;
const calls = [];
let rows = [{ id: 1, name: 'Alice', status: 'active' }], total = 5;
const pool = { query: async (sql, values) => { calls.push({ sql, values }); return [/COUNT\(\*\)/.test(sql) ? [{ total }] : rows]; } };
const Model = load(file('models/Student.js'), () => pool);
const parse = query => Model.parseQuery(query);
const fail = query => assert.throws(() => parse(query), error => error.statusCode === 400);

(async () => {
    await test('pagination is opt-in; defaults and safe integer boundaries are explicit', () => {
        assert.equal(parse({}).paginated, false);
        for (const [query, page, limit, offset] of [[{ page: '1' }, 1, 20, 0], [{ page: '3', limit: '50' }, 3, 50, 100],
            [{ limit: '100' }, 1, 100, 0], [{ limit: '2' }, 1, 2, 0], [{ page: '9007199254740991', limit: '1' }, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER - 1]]) {
            const options = parse(query);
            assert.equal(options.paginated, true);
            assert.deepEqual([options.page, options.limit, options.offset], [page, limit, offset]);
        }
        for (const key of ['page', 'limit']) for (const value of ['0', '-1', 'abc', '', '1.1', '1e2', '0x10', 'Infinity', '+1', ' 1', '01', '9007199254740992', ['1', '2'], {}]) fail({ [key]: value });
        fail({ limit: '101' }); fail({ limit: '100000' });
        fail({ page: '9007199254740991', limit: '100' });
    });
    await test('typed exact filters accept all datatypes and reject invalid representations', () => {
        const options = parse({ status: 'active', active: 'false', cgpa: '8.5e0', age: '21', name: "' OR 1=1 --", id: '-2' });
        assert.deepEqual({ ...options.filters }, { id: -2, name: "' OR 1=1 --", age: 21, cgpa: 8.5, active: false, status: 'active' });
        assert.equal(parse({ active: 'true' }).filters.active, true);
        assert.equal(parse({ name: 'null' }).filters.name, 'null');
        assert.equal(parse({ name: '' }).filters.name, '');
        for (const age of ['1.5', '1e2', '+1', ' 21', 'null', 'NaN', '9007199254740992', '-9007199254740992']) fail({ age });
        for (const cgpa of ['NaN', 'Infinity', '1e309', '', '0x10', ' 2', 'null', '1 OR 1=1']) fail({ cgpa });
        for (const cgpa of ['.5', '-0.5', '+3.2', '1e-3']) assert.equal(parse({ cgpa }).filters.cgpa, Number(cgpa));
        for (const active of ['TRUE', 'FALSE', '1', '0', '', 'null']) fail({ active });
        for (const status of ['deleted', 'ACTIVE', 'null', '']) fail({ status });
        fail({ name: ['a', 'b'] }); fail({ age: { $gt: 1 } });
    });
    await test('sorting and unknown parameters reject field/order injection and malformed scalars', () => {
        assert.equal(parse({ sort: 'name' }).order, 'asc');
        assert.equal(parse({ sort: 'cgpa', order: 'desc' }).order, 'desc');
        for (const sort of ['foo', 'name;DROP TABLE Student', 'RAND()', '', 'constructor']) fail({ sort });
        for (const order of ['ASC', 'DESC', 'sideways', 'desc;DROP TABLE Student', '']) fail({ sort: 'name', order });
        fail({ order: 'asc' });
        for (const key of ['foo', 'unknown`field', 'name;DROP TABLE Student', 'constructor', 'name[]', '__proto__']) fail(Object.fromEntries([[key, 'x']]));
        for (const key of ['sort', 'order', 'page', 'limit']) fail({ [key]: ['name', 'id'] });
    });
    await test('implicit id, STRING primary keys and reserved-name collisions use real target metadata', async () => {
        const implicitFiles = compileProject('ENTITY Item\nname STRING');
        const Implicit = load(implicitFiles.find(file => file.path === 'models/Item.js').content, () => pool);
        assert.equal(Implicit.parseQuery({ id: '7', sort: 'id' }).filters.id, 7);
        calls.length = 0; await Implicit.findAll(Implicit.parseQuery({ page: '1' }));
        assert.match(calls[0].sql, /ORDER BY id ASC LIMIT \? OFFSET \?/);
        const reservedFiles = compileProject(baseline.sources.reserved);
        const Reserved = load(reservedFiles.find(file => file.path === 'models/Record.js').content, () => pool);
        calls.length = 0; await Reserved.findAll(Reserved.parseQuery({ key: 's-1', sort: 'order', order: 'desc', page: '2', limit: '2' }));
        assert.match(calls[0].sql, /WHERE `key` = \? ORDER BY `order` DESC, `key` ASC LIMIT \? OFFSET \?/);
        assert.deepEqual(calls[0].values, ['s-1', 2, 2]);
        assert(!Object.hasOwn(Reserved.parseQuery({ page: '2' }).filters, 'page'));
    });
    await test('SQL and bound values are deterministic, count uses the identical filters, injection stays data', async () => {
        calls.length = 0;
        const options = parse({ status: 'active', age: '21', name: "' OR 1=1 --", sort: 'name', order: 'desc', page: '2', limit: '10' });
        await Model.findAll(options); await Model.countFiltered(options);
        assert.equal(calls[0].sql, 'SELECT * FROM Student WHERE name = ? AND age = ? AND status = ? ORDER BY name DESC, id ASC LIMIT ? OFFSET ?');
        assert.deepEqual(calls[0].values, ["' OR 1=1 --", 21, 'active', 10, 10]);
        assert.equal(calls[1].sql, 'SELECT COUNT(*) AS total FROM Student WHERE name = ? AND age = ? AND status = ?');
        assert.deepEqual(calls[1].values, ["' OR 1=1 --", 21, 'active']);
        calls.length = 0; await Model.findAll(parse({ sort: 'name' }));
        assert.equal(calls[0].sql, 'SELECT * FROM Student ORDER BY name ASC');
        calls.length = 0; await Model.findAll();
        assert.deepEqual(calls, [{ sql: 'SELECT * FROM Student', values: [] }]);
        const shuffled = parse({ name: 'A', age: '21' }), reordered = parse({ age: '21', name: 'A' });
        assert.deepEqual(Model.filterQuery(shuffled), Model.filterQuery(reordered));
    });
    await test('generated HTTP collection routes preserve body shape, headers and invalid-before-DB behavior', async () => {
        const controller = load(file('controllers/studentController.js'), () => Model);
        const router = load(file('routes/studentRoutes.js'), name => name === 'express' ? express : controller);
        const app = express(); app.use(express.json()); app.use('/students', router);
        const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/students`;
        try {
            for (const query of ['', '?sort=name', '?active=false', '?page=2&limit=2', '?status=active&page=1&limit=2']) {
                calls.length = 0; const response = await fetch(base + query);
                assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true, data: rows });
                const paginated = query.includes('page=');
                assert.equal(calls.length, paginated ? 2 : 1);
                assert.equal(response.headers.get('X-Total-Count'), paginated ? '5' : null);
                assert.equal(response.headers.get('X-Total-Pages'), paginated ? '3' : null);
                if (paginated) {
                    assert.equal(response.headers.get('X-Limit'), '2');
                    assert.equal(response.headers.get('X-Page'), query.includes('page=2') ? '2' : '1');
                    assert.deepEqual(calls[1].values, query.includes('status=') ? ['active'] : []);
                }
            }
            for (const query of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=101', 'age=1.5', 'cgpa=Infinity', 'active=1',
                'status=deleted', 'unknown=x', 'order=desc', 'name=a&name=b', 'page=1&page=2', 'sort=name%3BDROP%20TABLE%20Student',
                'sort=name&order=desc%3BDROP', 'unknown%60field=x', 'name%5B%5D=a', 'page=9007199254740991&limit=100']) {
                calls.length = 0; const response = await fetch(base + '?' + query);
                assert.equal(response.status, 400, query);
                const body = await response.json(); assert.equal(body.success, false); assert.equal(typeof body.error, 'string');
                assert.equal(calls.length, 0, query);
            }
            calls.length = 0;
            const injected = await fetch(base + '?name=' + encodeURIComponent("' OR 1=1 --"));
            assert.equal(injected.status, 200);
            assert(!calls[0].sql.includes('OR 1=1')); assert.deepEqual(calls[0].values, ["' OR 1=1 --"]);
            rows = []; total = 0;
            const empty = await fetch(base + '?page=5&limit=2');
            assert.deepEqual(await empty.json(), { success: true, data: [] });
            assert.equal(empty.headers.get('X-Total-Pages'), '0');
            const original = pool.query;
            pool.query = async () => { throw new Error('secret SQL database internals'); };
            try { const response = await fetch(base); assert.equal(response.status, 500); assert.equal((await response.json()).error, 'Unable to retrieve collection.'); }
            finally { pool.query = original; }
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
    await test('OpenAPI describes every query type, headers and reserved-name/implicit-id policies', () => {
        const swagger = JSON.parse(file('swagger.json')), get = swagger.paths['/students'].get;
        const params = Object.fromEntries(get.parameters.map(p => [p.name, p]));
        assert(get.parameters.every(p => p.in === 'query' && p.required === false));
        assert.equal(params.page.schema.minimum, 1); assert.equal(params.limit.schema.maximum, 100);
        assert.deepEqual(params.sort.schema.enum, ['id', 'name', 'age', 'cgpa', 'active', 'status']);
        assert.deepEqual(params.order.schema.enum, ['asc', 'desc']);
        for (const [name, type] of [['age', 'integer'], ['cgpa', 'number'], ['active', 'boolean'], ['name', 'string']]) assert.equal(params[name].schema.type, type);
        assert.deepEqual(params.status.schema.enum, ['active', 'inactive', 'suspended']);
        assert.deepEqual(Object.keys(get.responses['200'].headers), ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Total-Pages']);
        assert(get.responses['400']);
        const implicit = JSON.parse(compileProject(baseline.sources.implicit).find(f => f.path === 'swagger.json').content);
        assert(implicit.paths['/items'].get.parameters.some(p => p.name === 'id' && p.schema.type === 'integer'));
        const reserved = JSON.parse(compileProject(baseline.sources.reserved).find(f => f.path === 'swagger.json').content);
        assert.equal(new Set(reserved.paths['/records'].get.parameters.map(p => p.name)).size, reserved.paths['/records'].get.parameters.length);
        assert(!swagger.paths['/students/{id}'].get.parameters);
        const emptyFiles = compileProject('ENTITY Choice\nid INT PRIMARY KEY\nvalue ENUM("", "yes")');
        const emptyModel = load(emptyFiles.find(f => f.path === 'models/Choice.js').content, () => pool);
        assert.equal(emptyModel.parseQuery({ value: '' }).filters.value, '');
        const emptySwagger = JSON.parse(emptyFiles.find(f => f.path === 'swagger.json').content);
        assert.equal(emptySwagger.paths['/choices'].get.parameters.find(p => p.name === 'value').allowEmptyValue, true);
    });
    await test('all pre-codegen phases, original 61 diagnostics, five warnings, schemas and unaffected methods/artifacts retain baseline hashes', () => {
        const { IMPLICIT_PRIMARY_KEY_COLLISION, ...originalSemantic } = CODES.semantic;
        assert.equal(IMPLICIT_PRIMARY_KEY_COLLISION, 'SEM033');
        assert.deepEqual({ ...CODES, semantic: originalSemantic }, baseline.codes); assert.deepEqual(WARNING_CODES, baseline.warnings);
        for (const [name, source] of Object.entries(baseline.sources)) {
            const tokens = Lexer.tokenize(source), ast = Parser.parse(tokens), semantic = Semantic.analyze(ast);
            const ir = IR.generate(ast, semantic), optimized = Optimizer.optimize(ir).ir;
            assert.equal(hash({ tokens, ast, symbols: semantic.symbolTable, ir, optimized }), baseline.programs[name].phases, name);
            const generated = Codegen.generate(optimized, false).files;
            assert.deepEqual(generated.map(f => f.path), baseline.programs[name].paths);
            for (const f of generated) {
                if (f.path === 'README.md') { assert(f.content.includes('Collection query options')); continue; }
                // Keep the old fixture frozen. Project only the two approved
                // implicit-identity changes back to their legacy representation
                // so every other protected byte remains checked. The corrective
                // runtime and complete-file checks live in implicit-pk.test.js.
                let legacy = f;
                if (name === 'implicit' && f.path === 'models/Item.js') {
                    assert(f.content.includes('WHERE id = ?'));
                    assert(f.content.includes('return { ...data, id: result.insertId };'));
                    legacy = { ...f, content: f.content.replaceAll('WHERE id = ?', 'WHERE name = ?')
                        .replace('return { ...data, id: result.insertId };', 'return { name: result.insertId, ...data };') };
                }
                if (name === 'implicit' && f.path === 'swagger.json') {
                    const swagger = JSON.parse(f.content);
                    assert.deepEqual(swagger.components.schemas.Item.properties.id, { type: 'integer', readOnly: true });
                    delete swagger.components.schemas.Item.properties.id;
                    legacy = { ...f, content: JSON.stringify(swagger) };
                }
                assert.deepEqual(protectedSections(legacy), baseline.programs[name].files[f.path], name + ':' + f.path);
                if (f.path.endsWith('.js')) new vm.Script(f.content);
            }
        }
    });
    await test('compiler API and playground ZIP contain the updated generated artifacts', async () => {
        const server = require('../server').listen(0); await new Promise(resolve => server.once('listening', resolve));
        try {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: baseline.sources.types }) });
            assert.equal(response.status, 200); const body = await response.json();
            assert(body.generatedFiles.find(f => f.path === 'models/Student.js').content.includes('static parseQuery'));
            assert(JSON.parse(body.generatedFiles.find(f => f.path === 'swagger.json').content).paths['/students'].get.parameters);
            const appSource = fs.readFileSync(path.resolve(__dirname, '../frontend/app.js'), 'utf8');
            const context = vm.createContext({ Blob, TextEncoder, Uint8Array, DataView });
            vm.runInContext(appSource.slice(appSource.indexOf('function createZip('), appSource.indexOf('function downloadProject(')), context);
            const bytes = Buffer.from(await context.createZip(body.generatedFiles).arrayBuffer());
            let offset = 0; const entries = [];
            while (bytes.readUInt32LE(offset) === 0x04034b50) {
                const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
                const start = offset + 30 + nameLength + extra;
                entries.push({ path: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(), content: bytes.subarray(start, start + size).toString() });
                offset = start + size;
            }
            assert.deepEqual(entries, body.generatedFiles);
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
    console.log(`Collection queries: ${passed} test groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
