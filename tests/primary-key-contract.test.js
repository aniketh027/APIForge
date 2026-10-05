const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const { load } = require('./request-validation-test-helpers');
const { compile, baselineGenerator, projectPrimaryKeyChanges } = require('./primary-key-contract-test-helpers');
const fixture = require('./fixtures/primary-key-contract-compatibility.json');
const { CODES, WARNING_CODES } = require('../src/utils/diagnostics');
const hash = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const content = (files, name) => files.find(file => file.path === name).content;
let groups = 0, requests = 0;
async function test(name, fn) { await fn(); groups++; console.log('  ✓ ' + name); }
function runtime(source, key, storedKey, generator) {
    const { files } = compile(source, generator), queries = [], modelCalls = [];
    const rows = [{ [key]: storedKey, name: 'Alice' }];
    const pool = { query: async (sql, values) => {
        queries.push({ sql, values });
        if (sql.startsWith('INSERT')) return [{ insertId: 0 }];
        // Interpret the actual emitted WHERE column, not an assumed fixture key.
        const column = sql.match(/WHERE `?(\w+)`? = \?/)?.[1];
        if (sql.startsWith('UPDATE')) {
            for (const row of rows.filter(row => String(row[column]) === String(values[1]))) Object.assign(row, values[0]);
            return [{ affectedRows: 1 }];
        }
        return [rows.filter(row => String(row[column]) === String(values[0])).map(row => ({ ...row }))];
    } };
    const Model = load(content(files, 'models/Item.js'), () => pool);
    const tracked = { create: data => { modelCalls.push({ method: 'create', data }); return Model.create(data); },
        update: (id, data) => { modelCalls.push({ method: 'update', id, data }); return Model.update(id, data); } };
    const controller = load(content(files, 'controllers/itemController.js'), () => tracked);
    return { files, Model, controller, queries, modelCalls, rows };
}
async function invoke(r, method, body, id) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await r.controller[method + 'Item']({ body, params: { id } }, res);
    return res;
}
async function baselineProof() {
    for (const [name, expected] of [['intDefault', 7], ['stringDefault', 'seed']]) {
        const r = runtime(fixture.programs[name].source, 'key', expected, baselineGenerator());
        const res = await invoke(r, 'create', {}, String(expected));
        assert.equal(res.code, 201); assert.equal(res.body.data.key, 0);
        assert.throws(() => assert.equal(res.body.data.key, expected), { code: 'ERR_ASSERTION' });
        console.log('  Baseline G12 ' + name + ': expected ' + JSON.stringify(expected) + ', observed 0; corrective assertion fails.');
    }
    const r = runtime('ENTITY Item\nkey STRING PRIMARY KEY\nname STRING', 'key', 'old', baselineGenerator());
    const res = await invoke(r, 'update', { key: 'new' }, 'old');
    assert.equal(res.code, 404); assert.equal(r.rows[0].key, 'new'); assert.equal(r.queries.length, 2);
    assert.throws(() => assert.equal(res.code, 400), { code: 'ERR_ASSERTION' });
    console.log('  Baseline G13: UPDATE changes key to new, SELECT old returns 404; corrective assertion fails.');
}
(async () => {
    await test('pinned Git baseline fails corrective G12/G13 assertions', baselineProof);
    if (process.argv.includes('--baseline-proof')) return;
    await test('external-review baseline ab2cd49 reproduces AUTO_INCREMENT NULL/zero response identity failures', async () => {
        const old = require('./v1-hardening-helpers').baselineModule('src/codegen/codegen.js', 'ab2cd493abf30a711c59b1c574886c949acf7221');
        for (const value of [null, 0]) {
            const { files } = compile('ENTITY Item id INT PRIMARY KEY name STRING', old);
            const Model = load(content(files, 'models/Item.js'), () => ({ query: async () => [{ insertId: 42 }] }));
            const result = await Model.create({ id: value, name: 'Alice' });
            assert.equal(result.id, value);
            assert.throws(() => assert.equal(result.id, 42), { code: 'ERR_ASSERTION' });
        }
    });
    await test('real POST resolves auto-key NULL/zero from ResultSetHeader and preserves key classes, validation and schemas', async () => {
        const cases = [
            ['id INT PRIMARY KEY', { id: null, name: 'Alice' }, 42, 'id', 42],
            ['id INT PRIMARY KEY', { id: 0, name: 'Alice' }, 42, 'id', 42],
            ['id INT PRIMARY KEY', { id: 0, name: 'Alice' }, 0, 'id', 0], // NO_AUTO_VALUE_ON_ZERO stores zero.
            ['id INT PRIMARY KEY', { id: 100, name: 'Alice' }, 999, 'id', 100],
            ['id INT PRIMARY KEY DEFAULT -5', { id: -5, name: 'Alice' }, 999, 'id', -5],
            ['id INT PRIMARY KEY', { name: 'Alice' }, 42, 'id', 42],
            ['', { name: 'Alice' }, 42, 'id', 42],
            ['key INT PRIMARY KEY DEFAULT 7', { name: 'Alice' }, 0, 'key', 7],
            ['key INT PRIMARY KEY DEFAULT 7', { key: 0, name: 'Alice' }, 42, 'key', 0],
            ['key INT PRIMARY KEY DEFAULT 7', { key: null, name: 'Alice' }, 42, 'key', null],
            ['key STRING PRIMARY KEY', { key: 'custom', name: 'Alice' }, 42, 'key', 'custom'],
            ['key STRING PRIMARY KEY DEFAULT "seed"', { name: 'Alice' }, 0, 'key', 'seed'],
            ['key STRING PRIMARY KEY DEFAULT "seed"', { key: null, name: 'Alice' }, 42, 'key', null],
            ['__proto__ INT PRIMARY KEY', JSON.parse('{"__proto__":null,"name":"Alice"}'), 42, '__proto__', 42]
        ];
        for (const [declaration, body, insertId, key, expected] of cases) {
            const { files } = compile(`ENTITY Item ${declaration} name STRING`), calls = [];
            const Model = load(content(files, 'models/Item.js'), () => ({ query: async (sql, values) => { calls.push({ sql, values }); return [{ insertId }]; } }));
            const controller = load(content(files, 'controllers/itemController.js'), () => Model);
            const router = load(content(files, 'routes/itemRoutes.js'), name => name === 'express' ? express : controller);
            const doc = JSON.parse(content(files, 'swagger.json')), schemas = doc.components.schemas;
            const auto = declaration.endsWith('INT PRIMARY KEY');
            if (declaration) {
                assert.equal(schemas['Item.Create'].properties[key].nullable, true);
                assert(!schemas['Item.Create'].required?.includes(key));
                assert(!Object.hasOwn(schemas['Item.Update'].properties, key));
                assert.equal(schemas['Item.CreateResult'].properties[key].nullable, auto ? false : true);
                if (auto) for (const role of ['Create', 'CreateResult', 'Read']) assert.equal(schemas['Item.' + role].properties[key].minimum, 0);
            } else assert(!Object.hasOwn(schemas['Item.Create'].properties, key));
            assert.equal(doc.paths['/items'].post.responses['201'].content['application/json'].schema.$ref, '#/components/schemas/Item.CreateResponse');
            const app = express(); app.use(express.json()); app.use('/items', router);
            const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
            try {
                const url = 'http://127.0.0.1:' + server.address().port + '/items';
                const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); requests++;
                assert.equal(response.status, 201); const result = await response.json();
                assert.deepEqual(result, { success: true, data: { ...body, [key]: expected } });
                assert(Object.hasOwn(result.data, key)); assert.equal(calls.length, 1);
                assert.deepEqual(calls[0].values, [body]); // Keep NULL/zero bound; do not rewrite the INSERT.
                const resultKey = schemas['Item.CreateResult'].properties[key];
                if (expected === null) assert(resultKey.nullable); else assert.equal(typeof expected, resultKey.type === 'integer' ? 'number' : resultKey.type);
                const before = calls.length;
                const rejected = await fetch(url + '/42', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: null }) }); requests++;
                assert.equal(rejected.status, 400); assert.equal(calls.length, before);
            } finally { await new Promise(resolve => server.close(resolve)); }
            const immutableBody = Object.freeze({ ...body });
            assert.deepEqual(await Model.create(immutableBody), { ...body, [key]: expected });
            assert.deepEqual(immutableBody, body);
        }
        const required = runtime('ENTITY Item id INT PRIMARY KEY REQUIRED name STRING', 'id', 42);
        assert.equal((await invoke(required, 'create', { id: null })).code, 400);
        assert.equal(required.queries.length, 0);
    });
    await test('ff3dbde accepts negative auto INT input; corrected HTTP rejects before model and DB while other INT negatives remain legal', async () => {
        const source = 'ENTITY Item id INT PRIMARY KEY name STRING amount INT';
        const old = require('./v1-hardening-helpers').baselineModule('src/codegen/codegen.js', 'ff3dbde10ad07ca52b60eccb8828fb6d33a9c54c');
        const baseline = runtime(source, 'id', -5, old);
        const accepted = await invoke(baseline, 'create', { id: -5, name: 'Alice' });
        assert.equal(accepted.code, 201); assert.equal(accepted.body.data.id, -5);
        assert.equal(baseline.modelCalls.length, 1); assert.equal(baseline.queries.length, 1);
        for (const declaration of ['id INT PRIMARY KEY', 'code INT PRIMARY KEY', '__proto__ INT PRIMARY KEY']) {
            const key = declaration.split(' ')[0], r = runtime(`ENTITY Item ${declaration} name STRING amount INT`, key, 42);
            const router = load(content(r.files, 'routes/itemRoutes.js'), name => name === 'express' ? express : r.controller);
            const app = express(); app.use(express.json()); app.use('/items', router);
            const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
            try {
                const response = await fetch('http://127.0.0.1:' + server.address().port + '/items', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: -5, name: 'Alice' }) }); requests++;
                assert.equal(response.status, 400);
                assert.deepEqual(await response.json(), { success: false, error: `Field '${key}' must be zero or a positive integer.` });
                assert.equal(r.modelCalls.length, 0); assert.equal(r.queries.length, 0);
                assert.equal(r.controller.validateItem({ [key]: -0, amount: -5 }, 'create'), null);
                assert.equal(r.controller.validateItem({ [key]: '0' }, 'create'), `Field '${key}' must be an integer.`);
                assert.equal(r.controller.validateItem({ [key]: -0.5 }, 'create'), `Field '${key}' must be an integer.`);
                assert.equal(r.controller.validateItem({ [key]: -5 }, 'update'), `Field '${key}' is immutable.`);
            } finally { await new Promise(resolve => server.close(resolve)); }
        }
        const defaults = runtime('ENTITY Item id INT PRIMARY KEY DEFAULT -5 name STRING amount INT', 'id', -5);
        const res = await invoke(defaults, 'create', { id: -9, amount: -3 });
        assert.equal(res.code, 201); assert.equal(res.body.data.id, -9); assert.equal(res.body.data.amount, -3);
        assert.equal((await invoke(defaults, 'create', {})).body.data.id, -5);
    });
    await test('all eight create identity classes resolve actual logical keys without input mutation or reread', async () => {
        const cases = [
            ['implicit', { name: 'Alice' }, 42, 'id', 42],
            ['auto', { name: 'Alice' }, 42, 'id', 42],
            ['auto', { id: 100, name: 'Alice' }, 999, 'id', 100],
            ['intDefault', { name: 'Alice' }, 0, 'key', 7],
            ['intDefault', { key: 9, name: 'Alice' }, 0, 'key', 9],
            ['string', { username: 'aniketh', name: 'Aniketh' }, 0, 'username', 'aniketh'],
            ['stringDefault', {}, 0, 'key', 'seed'],
            ['stringDefault', { key: 'custom' }, 0, 'key', 'custom'],
            ['nonFirst', { code: 'supplied', name: 'Alice' }, 0, 'code', 'supplied']
        ];
        for (const [name, body, insertId, key, expected] of cases) {
            const { files } = compile(fixture.programs[name].source), calls = [];
            const Model = load(content(files, 'models/Item.js'), () => ({ query: async (sql, values) => { calls.push({ sql, values }); return [{ insertId }]; } }));
            const controller = load(content(files, 'controllers/itemController.js'), () => Model);
            const before = JSON.stringify(body); Object.freeze(body);
            const response = await invoke({ controller }, 'create', body);
            assert.equal(response.code, 201, name); assert.equal(response.body.data[key], expected, name);
            assert.equal(JSON.stringify(body), before); assert.equal(calls.length, 1); assert(calls[0].sql.startsWith('INSERT'));
            assert.deepEqual(response.body.data, { ...body, [key]: expected });
            assert.equal(Object.hasOwn(response.body.data, 'status'), false);
        }
    });
    await test('missing non-required STRING key remains DB-authoritative; optional null and falsy supplied/default keys retain precedence', async () => {
        for (const [declaration, body, expected] of [['key INT PRIMARY KEY DEFAULT 0', {}, 0], ['key INT PRIMARY KEY DEFAULT 7', { key: 0 }, 0],
            ['key STRING PRIMARY KEY DEFAULT ""', {}, ''], ['key STRING PRIMARY KEY DEFAULT "seed"', { key: '' }, ''],
            ['key STRING PRIMARY KEY DEFAULT "seed"', { key: null }, null]]) {
            const r = runtime('ENTITY Item\n' + declaration + '\nname STRING', 'key', expected);
            const res = await invoke(r, 'create', body); assert.equal(res.code, 201); assert.equal(res.body.data.key, expected);
        }
        const source = 'ENTITY Item\nkey STRING PRIMARY KEY\nname STRING', files = compile(source).files;
        const successModel = load(content(files, 'models/Item.js'), () => ({ query: async () => [{ insertId: 0 }] }));
        assert.deepEqual(await successModel.create({}), {}, 'even a synthetic success cannot invent a key');
        let calls = 0;
        const Model = load(content(files, 'models/Item.js'), () => ({ query: async () => { calls++; throw new Error('private SQL failure'); } }));
        const controller = load(content(files, 'controllers/itemController.js'), () => Model);
        const response = await invoke({ controller }, 'create', {});
        assert.equal(calls, 1); assert.equal(response.code, 500);
        assert.deepEqual(response.body, { success: false, error: 'Unable to complete request.' });
    });
    await test('every explicit key class rejects same/different/null/invalid/undefined own PK before model or SQL; direct model guard agrees', async () => {
        for (const [name, key, old, next] of [['auto', 'id', 1, 2], ['intDefault', 'key', 7, 8], ['string', 'username', 'old', 'new'],
            ['stringDefault', 'key', 'seed', 'custom'], ['nonFirst', 'code', 'old', 'new']]) {
            const r = runtime(fixture.programs[name].source, key, old);
            for (const value of [old, next, null, {}, undefined]) {
                const res = await invoke(r, 'update', { [key]: value }, String(old));
                assert.equal(res.code, 400); assert.deepEqual(res.body, { success: false, error: "Field '" + key + "' is immutable." });
                assert.equal(r.modelCalls.length, 0); assert.equal(r.queries.length, 0); assert.equal(r.rows[0][key], old);
                await assert.rejects(r.Model.update(String(old), { [key]: value }), { message: res.body.error });
                assert.equal(r.queries.length, 0);
            }
        }
    });
    await test('validation order is shape, unknown own keys, immutable PK, then declaration-order checks; inherited key is omitted', async () => {
        const r = runtime('ENTITY Item\nname STRING REQUIRED\nkey STRING PRIMARY KEY REQUIRED\nage INT', 'key', 'old');
        const validate = r.controller.validateItem;
        assert.equal(validate(null), 'Request body must be a JSON object.');
        assert.equal(validate({ key: null, unknown: 1, age: 'bad' }), "Unknown field 'unknown'.");
        assert.equal(validate({ age: 'bad', key: null }), "Field 'key' is immutable.");
        assert.equal(validate({ name: null, key: 'old' }), "Field 'key' is immutable.");
        assert.equal(validate({ name: null, age: 'bad' }), "Field 'name' cannot be null.");
        assert.equal(validate({ key: 123 }, 'create'), "Field 'name' is required.");
        const body = Object.assign(Object.create({ key: 'new' }), { name: 'updated' });
        assert.equal((await invoke(r, 'update', body, 'old')).code, 200);
        assert.deepEqual(r.modelCalls[0], { method: 'update', id: 'old', data: { name: 'updated' } });
        assert.equal(r.rows[0].key, 'old');
    });
    await test('real emitted routers preserve rows on PK rejection; normal and empty PUT reread through URL key', async () => {
        for (const [name, key, old, next] of [['auto', 'id', 1, 2], ['intDefault', 'key', 7, 8], ['string', 'username', 'old', 'new'],
            ['stringDefault', 'key', 'seed', 'custom'], ['nonFirst', 'code', 'old', 'new'], ['implicit', 'id', 1, 2]]) {
            // Add a non-key name to stringDefault, whose fixture instead controls arbitrary defaults.
            const source = fixture.programs[name].source + (name === 'stringDefault' ? '\nname STRING' : '');
            const r = runtime(source, key, old);
            const router = load(content(r.files, 'routes/itemRoutes.js'), name => name === 'express' ? express : r.controller);
            const app = express(); app.use(express.json()); app.use('/items', router);
            const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
            try {
                const url = 'http://127.0.0.1:' + server.address().port + '/items/' + old;
                for (const value of [old, next, null]) {
                    const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: value }) }); requests++;
                    assert.equal(response.status, 400);
                    assert.deepEqual(await response.json(), { success: false, error: name === 'implicit' ? "Unknown field 'id'." : "Field '" + key + "' is immutable." });
                    assert.equal(r.queries.length, 0); assert.equal(r.modelCalls.length, 0); assert.equal(r.rows[0][key], old);
                }
                for (const body of [{ name: 'updated' }, {}]) {
                    const before = r.queries.length;
                    const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); requests++;
                    assert.equal(response.status, 200);
                    assert.deepEqual(await response.json(), { success: true, data: { [key]: old, name: 'updated' } });
                    const sql = r.queries.slice(before);
                    assert.equal(sql.length, Object.keys(body).length ? 2 : 1);
                    assert.deepEqual(sql.at(-1), { sql: 'SELECT * FROM Item WHERE ' + (key === 'key' ? '`key`' : key) + ' = ?', values: [String(old)] });
                }
                const missing = await fetch(url + '-missing', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }); requests++;
                assert.equal(missing.status, 404);
            } finally { await new Promise(resolve => server.close(resolve)); }
        }
    });
    await test('prototype-sensitive explicit PK spelling creates own response properties and cannot bypass update guard', async () => {
        for (const key of ['__proto__', 'constructor', 'toString']) {
            const r = runtime('ENTITY Item\n' + key + ' STRING PRIMARY KEY DEFAULT "seed"\nname STRING', key, 'seed');
            const body = JSON.parse('{"' + key + '":"custom","name":"Alice"}');
            const response = await invoke(r, 'create', body);
            assert.equal(response.code, 201); assert(Object.hasOwn(response.body.data, key)); assert.equal(response.body.data[key], 'custom');
            assert.equal(Object.getPrototypeOf(response.body.data), Object.prototype);
            const omitted = await invoke(r, 'create', {}); assert(Object.hasOwn(omitted.body.data, key)); assert.equal(omitted.body.data[key], 'seed');
            const calls = r.queries.length;
            const rejected = await invoke(r, 'update', body, 'seed'); assert.equal(rejected.code, 400); assert.equal(r.queries.length, calls);
            await assert.rejects(r.Model.update('seed', body), { message: "Field '" + key + "' is immutable." });
        }
        const implicit = runtime(fixture.programs.implicit.source, 'id', 1);
        await assert.rejects(implicit.Model.update(1, { id: 2 }), { message: "Field 'id' is immutable." });
        assert.equal(implicit.queries.length, 0);
    });
    await test('nine pinned fixtures retain all compiler phases, 62 diagnostics, five warnings, SQL/routes/dependencies and all unaffected emitted sections', () => {
        assert.deepEqual(require('./v1-hardening-helpers').retainedCodes(CODES, fixture.codes), fixture.codes); assert.deepEqual(WARNING_CODES, fixture.warnings);
        assert.equal(Object.values(CODES).flatMap(Object.values).length, 67);
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-pk-syntax-'));
        try {
            for (const [name, program] of Object.entries(fixture.programs)) {
                const current = compile(program.source), old = compile(program.source, baselineGenerator());
                const { tokens, ast, semantic, ir, optimization, files } = current;
                assert.equal(hash({ tokens, ast, semantic, ir, optimization }), program.phases, name);
                assert.deepEqual(Object.fromEntries(old.files.map(f => [f.path, hash(f.content)])), program.files, name + ' pinned Git baseline');
                assert.deepEqual(projectPrimaryKeyChanges(files, program.source), old.files);
                for (const file of files) {
                    // Full server bytes outside G06 are checked by the projection above.
                    if (!/^(models|controllers)\//.test(file.path) && !['README.md', 'swagger.json', 'package.json', 'server.js'].includes(file.path)) assert.equal(hash(file.content), program.files[file.path], name + '/' + file.path);
                    if (file.path.endsWith('.js')) {
                        const filename = path.join(temp, file.path.replaceAll('/', '-')); fs.writeFileSync(filename, file.content);
                        const checked = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true });
                        assert.equal(checked.status, 0, checked.stderr);
                    }
                }
            }
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
    console.log('Primary-key contract: ' + groups + ' groups passed; ' + requests + ' actual HTTP requests. Stateful simulation; native MySQL persistence unverified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
