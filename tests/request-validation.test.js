const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const express = require('express');
const { CODES, WARNING_CODES } = require('../src/utils/diagnostics');
const { load, compileProject, originalFiles, projectWriteChanges } = require('./request-validation-test-helpers');
const fixture = require('./fixtures/request-validation-compatibility.json');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
let groups = 0, writes = 0, httpRequests = 0;
async function test(name, fn) { await fn(); groups++; console.log('  ✓ ' + name); }
function content(files, name) { return files.find(file => file.path === name).content; }
function emitted(source, entity = 'Item') {
    const files = compileProject(source), calls = [];
    let failure;
    const Model = {
        create: async data => { calls.push({ method: 'create', data }); if (failure) throw failure; return { ...data, id: 42 }; },
        update: async (id, data) => { calls.push({ method: 'update', id, data }); if (failure) throw failure; return { id, ...data }; }
    };
    const controller = load(content(files, 'controllers/' + entity[0].toLowerCase() + entity.slice(1) + 'Controller.js'), () => Model);
    return { files, controller, calls, fail: error => { failure = error; } };
}
async function invoke(runtime, method, body) {
    const entity = Object.keys(runtime.controller).find(key => key.startsWith('validate')).slice(8);
    const before = runtime.calls.length;
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await runtime.controller[(method === 'POST' ? 'create' : 'update') + entity]({ body, params: { id: '7' } }, response);
    writes++;
    if (response.code === 400) assert.equal(runtime.calls.length, before, 'invalid payload must not call model');
    else if (response.code < 400) {
        assert.equal(runtime.calls.length, before + 1);
        const forwarded = runtime.calls.at(-1).data;
        assert.notEqual(forwarded, body);
        assert.deepEqual(Object.keys(forwarded).sort(), Object.keys(body).sort());
        for (const key of Object.keys(forwarded)) assert.equal(forwarded[key], body[key]);
    }
    return response;
}
async function listen(app, fn) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await fn('http://127.0.0.1:' + server.address().port); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

(async () => {
    await test('POST/PUT datatype matrix rejects wrong scalars, arrays, objects, non-finite and unsafe numbers before models', async () => {
        const types = {
            INT: { source: 'INT', valid: [0, 20, -20, Number.MAX_SAFE_INTEGER], invalid: [20.5, '20', 'abc', true, [], {}, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1] },
            FLOAT: { source: 'FLOAT', valid: [0, 20, -1.5, Number.MAX_VALUE], invalid: ['20', false, [], {}, NaN, Infinity, -Infinity] },
            BOOLEAN: { source: 'BOOLEAN', valid: [true, false], invalid: [0, 1, 'true', 'false', [], {}] },
            STRING: { source: 'STRING', valid: ['', 'Alice', '😀'], invalid: [123, true, [], {}] },
            ENUM: { source: 'ENUM("active", "inactive", "")', valid: ['active', 'inactive', ''], invalid: ['ACTIVE', 'other', 1, true, [], {}] }
        };
        for (const config of Object.values(types)) {
            for (const modifier of ['', 'UNIQUE', 'REQUIRED', 'REQUIRED UNIQUE',
                'DEFAULT ' + (config.source === 'INT' ? '20' : config.source === 'FLOAT' ? '1.5' : config.source === 'BOOLEAN' ? 'TRUE' : '"active"'),
                'REQUIRED DEFAULT ' + (config.source === 'INT' ? '20' : config.source === 'FLOAT' ? '1.5' : config.source === 'BOOLEAN' ? 'TRUE' : '"active"')]) {
                const runtime = emitted('ENTITY Item\nid INT PRIMARY KEY\nvalue ' + config.source + ' ' + modifier);
                for (const method of ['POST', 'PUT']) {
                    const omitted = await invoke(runtime, method, {});
                    assert.equal(omitted.code, method === 'POST' && modifier.includes('REQUIRED') && !modifier.includes('DEFAULT') ? 400 : method === 'POST' ? 201 : 200);
                    if (omitted.code === 400) assert.equal(omitted.body.error, "Field 'value' is required.");
                    const nullable = await invoke(runtime, method, { value: null });
                    assert.equal(nullable.code, modifier.includes('REQUIRED') ? 400 : method === 'POST' ? 201 : 200);
                    if (nullable.code === 400) assert.equal(nullable.body.error, "Field 'value' cannot be null.");
                    for (const value of config.valid) assert.equal((await invoke(runtime, method, { value })).code, method === 'POST' ? 201 : 200);
                    for (const value of [...config.invalid, undefined]) assert.equal((await invoke(runtime, method, { value })).code, 400);
                }
            }
        }
    });
    await test('required/default/generated key rules, partial PUT and explicit PK POST compatibility/PUT immutability', async () => {
        for (const [key, omittedStatus] of [['id INT PRIMARY KEY REQUIRED', 201], ['id INT PRIMARY KEY REQUIRED DEFAULT 4', 201],
            ['code STRING PRIMARY KEY REQUIRED', 400], ['code STRING PRIMARY KEY REQUIRED DEFAULT "fixed"', 201], ['code STRING PRIMARY KEY', 201]]) {
            const runtime = emitted('ENTITY Item\nname STRING REQUIRED DEFAULT "Anonymous"\n' + key);
            assert.equal((await invoke(runtime, 'POST', {})).code, omittedStatus);
            assert.equal((await invoke(runtime, 'PUT', {})).code, 200);
            const field = key.split(' ')[0], value = key.includes('STRING') ? 'u-1' : 7;
            assert.equal((await invoke(runtime, 'POST', { [field]: value })).code, 201);
            const immutable = await invoke(runtime, 'PUT', { [field]: value });
            assert.equal(immutable.code, 400);
            assert.equal(immutable.body.error, "Field '" + field + "' is immutable.");
            if (field === 'id') for (const method of ['POST', 'PUT']) assert.equal((await invoke(runtime, method, { id: 1.5 })).code, 400);
        }
        const runtime = emitted('ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED\nemail STRING REQUIRED');
        assert.equal((await invoke(runtime, 'POST', {})).body.error, "Field 'name' is required.");
        assert.equal((await invoke(runtime, 'POST', { name: 'Alice' })).body.error, "Field 'email' is required.");
        assert.equal((await invoke(runtime, 'PUT', { name: 'Alice' })).code, 200);
        assert.equal((await invoke(runtime, 'PUT', { email: null })).code, 400);
    });
    await test('shape, own-key authority, implicit id, relationship FK and prototype keys cannot bypass validation', async () => {
        const runtime = emitted('ENTITY Item\nname STRING\nENTITY Parent\nid INT PRIMARY KEY\nRELATION Parent OWNS Item ONE_TO_MANY');
        assert(content(runtime.files, 'database/schema.sql').includes('ADD COLUMN parent_id'));
        for (const method of ['POST', 'PUT']) {
            for (const body of [null, [], 'string', 123, true, undefined]) {
                const response = await invoke(runtime, method, body);
                assert.equal(response.code, 400); assert.equal(response.body.error, 'Request body must be a JSON object.');
            }
            for (const key of ['id', 'parent_id', 'unknown', '__proto__', 'constructor', 'toString']) {
                const body = JSON.parse('{"' + key + '":5,"name":"Alice"}');
                assert(Object.hasOwn(body, key));
                assert.equal((await invoke(runtime, method, body)).body.error, "Unknown field '" + key + "'.");
            }
            const body = Object.assign(Object.create({ id: 5, unknown: true, name: 'inherited' }), {});
            assert.equal((await invoke(runtime, method, body)).code, method === 'POST' ? 201 : 200);
            assert.deepEqual(runtime.calls.at(-1).data, {});
        }
        const required = emitted('ENTITY Item\nname STRING REQUIRED');
        assert.equal((await invoke(required, 'POST', Object.create({ name: 'inherited' }))).body.error, "Field 'name' is required.");
        const declared = emitted('ENTITY Item\nname STRING\nage INT');
        for (const method of ['POST', 'PUT']) {
            const body = Object.assign(Object.create({ secret: 'inherited' }), { age: 20, name: 'Alice' });
            assert.equal((await invoke(declared, method, body)).code, method === 'POST' ? 201 : 200);
            assert.deepEqual(declared.calls.at(-1).data, { name: 'Alice', age: 20 });
        }
    });
    await test('error ordering and inclusive bounds, Unicode lengths, exact ENUM order remain deterministic', async () => {
        const runtime = emitted('ENTITY Item\nid INT PRIMARY KEY\nfirst STRING REQUIRED\nage INT MIN 18 MAX 65\nscore FLOAT MIN 0 MAX 10\ntext STRING MIN_LENGTH 1 MAX_LENGTH 2\nstatus ENUM("active", "inactive")');
        assert.equal((await invoke(runtime, 'POST', { z: 1, a: 2, age: 'bad' })).body.error, "Unknown field 'z'.");
        assert.equal((await invoke(runtime, 'POST', { age: 'bad' })).body.error, "Field 'first' is required.");
        assert.equal((await invoke(runtime, 'PUT', { status: 'bad', age: 'bad' })).body.error, "Field 'age' must be an integer.");
        for (const method of ['POST', 'PUT']) {
            for (const body of [{ age: 18, score: 0, text: '😀', status: 'active' }, { age: 65, score: 10, text: '😀😀', status: 'inactive' }]) {
                assert.equal((await invoke(runtime, method, { first: '', ...body })).code, method === 'POST' ? 201 : 200);
            }
            for (const [body, message] of [[{ age: 17 }, "Field 'age' must be >= 18."], [{ age: 66 }, "Field 'age' must be <= 65."],
                [{ score: -0.1 }, "Field 'score' must be >= 0."], [{ score: 10.1 }, "Field 'score' must be <= 10."],
                [{ text: '' }, "Field 'text' length must be >= 1."], [{ text: '😀😀😀' }, "Field 'text' length must be <= 2."],
                [{ status: 'ACTIVE' }, "Field 'status' must be one of: active, inactive."]]) {
                assert.equal((await invoke(runtime, method, { first: 'ok', ...body })).body.error, message);
            }
        }
    });
    await test('write model exceptions are sanitized even when drivers mark failures as 400', async () => {
        const runtime = emitted('ENTITY Item\nemail STRING UNIQUE');
        runtime.fail(Object.assign(new Error("Duplicate entry 'private@example.com' for key 'User.email' SELECT secret"), { statusCode: 400 }));
        for (const method of ['POST', 'PUT']) {
            const response = await invoke(runtime, method, { email: 'private@example.com' });
            assert.equal(response.code, 500);
            assert.deepEqual(response.body, { success: false, error: 'Unable to complete request.' });
            assert(!/private@|User.email|Duplicate|SELECT/.test(JSON.stringify(response.body)));
        }
    });
    await test('empty valid POST emits MySQL default-row syntax; empty PUT only rereads; implicit create returns generated id', async () => {
        const files = compileProject('ENTITY Setting\nenabled BOOLEAN DEFAULT TRUE');
        const calls = [], pool = { query: async (sql, values) => { calls.push({ sql, values }); return [sql.startsWith('INSERT') ? { insertId: 42 } : [{ id: 42, enabled: true }]]; } };
        const Model = load(content(files, 'models/Setting.js'), () => pool);
        assert.deepEqual(await Model.create({}), { id: 42 });
        assert.deepEqual(calls, [{ sql: 'INSERT INTO Setting () VALUES ()', values: undefined }]);
        calls.length = 0;
        assert.deepEqual(await Model.update(42, {}), { id: 42, enabled: true });
        assert.deepEqual(calls, [{ sql: 'SELECT * FROM Setting WHERE id = ?', values: [42] }]);
        calls.length = 0;
        assert.deepEqual(await Model.create({ enabled: false }), { id: 42, enabled: false });
        assert.equal(calls[0].sql, 'INSERT INTO Setting SET ?');
    });
    await test('actual emitted server, routers and models reject invalid HTTP writes and malformed JSON; compiler INP002 stays 500', async () => {
        const files = compileProject(fixture.programs.matrix.source), dbCalls = [];
        let dbFailure = false;
        const pool = { query: async (sql, values) => {
            dbCalls.push({ sql, values });
            if (dbFailure) throw new Error("Duplicate entry 'private@example.com' for key 'User.email'");
            return [sql.startsWith('INSERT') ? { insertId: 42 } : [{ id: 7, age: 20 }]];
        } };
        const Model = load(content(files, 'models/Item.js'), () => pool);
        const controller = load(content(files, 'controllers/itemController.js'), () => Model);
        const router = load(content(files, 'routes/itemRoutes.js'), name => name === 'express' ? express : controller);
        const app = load(content(files, 'server.js'), name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : router);
        await listen(app, async base => {
            for (const method of ['POST', 'PUT']) for (const body of ['null', '[]', '"string"', '123', 'true', '{"age":', '{"id":1.5}', '{"age":"20"}', '{"age":20.5}', '{"age":{}}', '{"age":[]}', '{"score":"20"}', '{"score":false}', '{"active":"false"}', '{"active":1}', '{"name":123}', '{"age":null}', '{"unknown":5}', '{"__proto__":5}']) {
                const before = dbCalls.length;
                const response = await fetch(base + (method === 'POST' ? '/items' : '/items/7'), { method, headers: { 'content-type': 'application/json' }, body });
                httpRequests++; assert.equal(response.status, 400, body);
                const json = await response.json(); assert.equal(json.success, false); assert.equal(typeof json.error, 'string');
                assert(!json.error.includes(body)); assert.equal(dbCalls.length, before);
            }
            const valid = await fetch(base + '/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"age":20,"score":2.5,"active":false,"name":"Alice","status":"active"}' });
            httpRequests++; assert.equal(valid.status, 201); assert.equal((await valid.json()).data.id, 42);
            const partial = await fetch(base + '/items/7', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
            httpRequests++; assert.equal(partial.status, 200);
            dbFailure = true;
            for (const method of ['POST', 'PUT']) {
                const response = await fetch(base + (method === 'POST' ? '/items' : '/items/7'), { method, headers: { 'content-type': 'application/json' }, body: '{"age":20}' });
                httpRequests++; assert.equal(response.status, 500);
                assert.deepEqual(await response.json(), { success: false, error: 'Unable to complete request.' });
            }
        });
        const compiler = require('../server'), saved = console.error;
        console.error = () => {};
        try {
            await listen(compiler, async base => {
                const response = await fetch(base + '/api/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"source":' });
                httpRequests++; assert.equal(response.status, 500); assert.equal((await response.json()).diagnostic.code, 'INP002');
            });
        } finally { console.error = saved; }
    });
    await test('17 baseline programs retain every phase hash, registry assignment and unaffected generated section; emitted JS passes node --check', () => {
        assert.deepEqual(require('./v1-hardening-helpers').retainedCodes(CODES, fixture.codes), fixture.codes); assert.deepEqual(WARNING_CODES, fixture.warnings);
        assert.equal(Object.values(CODES).flatMap(Object.values).length, 67);
        const L = require('../src/lexer/lexer'), P = require('../src/parser/parser'), S = require('../src/semantic/analyzer');
        const I = require('../src/ir/generator'), O = require('../src/optimizer/optimizer');
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-write-syntax-'));
        try {
            for (const [name, program] of Object.entries(fixture.programs)) {
                const tokens = L.tokenize(program.source), ast = P.parse(tokens), semantic = S.analyze(ast), ir = I.generate(ast, semantic), optimization = O.optimize(ir);
                assert.equal(hash({ tokens, ast, semantic, ir, optimization }), program.phases, name);
                const originals = originalFiles(program.source);
                assert.deepEqual(Object.fromEntries(originals.map(file => [file.path, hash(file.content)])), program.files, 'frozen baseline ' + name);
                const files = compileProject(program.source);
                assert.deepEqual(projectWriteChanges(files, program.source), originals);
                for (const file of files) {
                    if (!/^(models|controllers)\//.test(file.path) && !['server.js', 'swagger.json', 'README.md', 'package.json'].includes(file.path)) assert.equal(hash(file.content), program.files[file.path]);
                    if (file.path.endsWith('.js')) {
                        new vm.Script(file.content);
                        const filename = path.join(temp, file.path.replaceAll('/', '-'));
                        fs.writeFileSync(filename, file.content);
                        const check = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', windowsHide: true });
                        assert.equal(check.status, 0, check.stderr);
                    }
                }
            }
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
    await test('OpenAPI documents POST presence/defaults and whitelist while preserving implicit readOnly id, types/bounds/ENUM', () => {
        const files = compileProject(fixture.programs.matrix.source), schema = JSON.parse(content(files, 'swagger.json')).components.schemas.Item;
        assert.deepEqual(schema.required, ['age']); assert.equal(schema.additionalProperties, false);
        assert.equal(schema.properties.score.default, 1.5); assert.equal(schema.properties.status.default, 'active');
        assert.deepEqual(schema.properties.status.enum, ['active', 'inactive']);
        assert.equal(schema.properties.age.minimum, 0); assert.equal(schema.properties.age.maximum, 100);
        const implicit = JSON.parse(content(compileProject('ENTITY Item\nname STRING REQUIRED DEFAULT "Anonymous"'), 'swagger.json')).components.schemas.Item;
        assert.deepEqual(implicit.properties.id, { type: 'integer', readOnly: true }); assert.equal(implicit.required, undefined);
    });
    console.log(`Request validation: ${groups} groups passed; ${writes} emitted-controller writes; ${httpRequests} actual HTTP requests. Live MySQL not simulated as persistence evidence.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
