const assert = require('assert/strict');
const express = require('express');
const { compile, content, syntax, baselineModule } = require('./v1-hardening-helpers');
const { load } = require('./request-validation-test-helpers');
let groups = 0, requests = 0;
async function test(name, fn) { await fn(); groups++; console.log('  PASS ' + name); }
function validate(doc, schema, value) {
    if (schema.$ref) return validate(doc, doc.components.schemas[schema.$ref.split('/').pop()], value);
    if (schema.enum) assert(schema.enum.includes(value), 'enum membership');
    if (value === null) { assert(schema.nullable, 'nullable'); return; }
    if (schema.type === 'object') {
        assert(value && typeof value === 'object' && !Array.isArray(value));
        for (const name of schema.required || []) assert(Object.hasOwn(value, name), 'required ' + name);
        for (const [name, item] of Object.entries(value)) {
            if (schema.additionalProperties === false) assert(Object.hasOwn(schema.properties, name), 'unknown ' + name);
            if (schema.properties[name]) validate(doc, schema.properties[name], item);
        }
    } else if (schema.type === 'array') { assert(Array.isArray(value)); for (const item of value) validate(doc, schema.items, item); }
    else if (schema.type === 'integer') assert(Number.isInteger(value));
    else if (schema.type === 'number') assert(Number.isFinite(value));
    else assert.equal(typeof value, schema.type);
    if (schema.minimum !== undefined) assert(value >= schema.minimum);
    if (schema.maximum !== undefined) assert(value <= schema.maximum);
    if (schema.minLength !== undefined) assert(Array.from(value).length >= schema.minLength);
    if (schema.maxLength !== undefined) assert(Array.from(value).length <= schema.maxLength);
}
function refs(doc) {
    function visit(value) {
        if (!value || typeof value !== 'object') return;
        if (value.$ref) assert(Object.hasOwn(doc.components.schemas, value.$ref.split('/').pop()), value.$ref);
        for (const item of Object.values(value)) visit(item);
    }
    visit(doc);
}
(async () => {
    await test('operation roles mirror write authority, nullability, defaults, enums and synthetic reads without namespace collisions', () => {
        for (const key of ['name STRING', 'key STRING PRIMARY KEY REQUIRED', 'key STRING PRIMARY KEY DEFAULT "seed"', 'id INT PRIMARY KEY']) {
            const c = compile(`ENTITY Item ${key} age INT REQUIRED MIN 0 MAX 100 score FLOAT DEFAULT 1.5 flag BOOLEAN status ENUM("Active", "closed") DEFAULT "Active" __proto__ STRING ENTITY ItemRead id INT PRIMARY KEY ENTITY Parent id INT PRIMARY KEY RELATION Parent items Item ONE_TO_MANY`);
            syntax(c.files); const doc = JSON.parse(content(c.files, 'swagger.json')); refs(doc);
            const create = doc.components.schemas['Item.Create'], update = doc.components.schemas['Item.Update'], read = doc.components.schemas['Item.Read'];
            const effective = key.startsWith('key') ? 'key' : 'id';
            assert(!Object.hasOwn(update.properties, effective)); assert.equal(update.required, undefined);
            assert.equal(create.additionalProperties, false); assert.equal(update.additionalProperties, false);
            assert(create.required.includes('age')); assert.equal(create.properties.flag.nullable, true);
            assert.deepEqual(create.properties.status.enum, ['Active', 'closed', null]);
            assert.equal(create.properties.status.default, 'Active'); assert.equal(create.properties.score.default, 1.5);
            assert.equal(create.properties.age.nullable, false); assert.equal(create.properties.age.minimum, 0);
            assert.equal(read.properties.parent_id.readOnly, true); assert.equal(read.properties.parent_id.nullable, true);
            assert(!Object.hasOwn(create.properties, 'parent_id')); assert(!Object.hasOwn(update.properties, 'parent_id'));
            assert(Object.hasOwn(read.properties, '__proto__')); assert(doc.components.schemas.ItemRead);
            if (key === 'name STRING') { assert(!Object.hasOwn(create.properties, 'id')); assert(read.properties.id.readOnly); }
            const old = JSON.parse(content(baselineModule('src/codegen/codegen.js').generate(c.optimized, false).files, 'swagger.json'));
            assert.equal(old.components.schemas['Item.Update'], undefined);
            assert.throws(() => assert(old.components.schemas['Item.Update']));
        }
    });
    await test('all row-returning models normalize only declared BOOLEAN fields using source/target metadata', async () => {
        for (const kind of ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']) {
            const c = compile(`ENTITY Parent id INT PRIMARY KEY enabled BOOLEAN count INT ENTITY Child id INT PRIMARY KEY active BOOLEAN optional BOOLEAN count INT RELATION Parent children Child ${kind}`);
            const rows = [{ id: 1, enabled: 1, count: 1, active: 0, optional: null }];
            const pool = { query: async sql => [sql.startsWith('INSERT') ? { insertId: 2 } : sql.startsWith('UPDATE') ? { affectedRows: 1 } : rows] };
            const Model = load(content(c.files, 'models/Parent.js'), () => pool);
            for (const item of [await Model.findById(1), ...(await Model.findAll()), await Model.update(1, {}), await Model.create({ enabled: true, count: 1 })]) {
                assert.equal(item.enabled, true); assert.equal(item.count, 1);
            }
            const many = ['ONE_TO_MANY', 'MANY_TO_MANY'].includes(kind);
            const related = await Model[many ? 'getChilds' : 'getChild'](1);
            const item = many ? related[0] : related;
            assert.equal(item.active, false); assert.equal(item.optional, null); assert.equal(item.enabled, 1); assert.equal(item.count, 1);
            assert.equal(rows[0].enabled, 1, 'driver rows not mutated');
            const Old = load(content(baselineModule('src/codegen/codegen.js').generate(c.optimized, false).files, 'models/Parent.js'), () => pool);
            assert.equal((await Old.findById(1)).enabled, 1);
            assert.throws(() => assert.equal(typeof rows[0].enabled, 'boolean'));
        }
    });
    await test('real emitted HTTP bodies/statuses validate against documented schemas for CRUD, relationships and errors', async () => {
        for (const kind of ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']) {
            const c = compile(`ENTITY Parent id INT PRIMARY KEY enabled BOOLEAN name STRING REQUIRED DEFAULT "seed" ENTITY Child code STRING PRIMARY KEY active BOOLEAN RELATION Parent children Child ${kind}`);
            const doc = JSON.parse(content(c.files, 'swagger.json')); refs(doc); let missing = false, fail = false;
            const pool = { query: async sql => {
                if (fail) throw new Error('PRIVATE SQL password token');
                if (sql.startsWith('INSERT')) return [{ insertId: 7 }];
                if (sql.startsWith('DELETE') || sql.startsWith('UPDATE')) return [{ affectedRows: missing ? 0 : 1 }];
                if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
                if (missing) return [[]];
                return [sql.includes('Child') ? [{ code: 'c', active: 1, ...(kind === 'ONE_TO_ONE' || kind === 'ONE_TO_MANY' ? { parent_id: 1 } : {}) }] : [{ id: 1, enabled: 0, name: 'seed', ...(kind === 'MANY_TO_ONE' ? { child_code: 'c' } : {}) }]];
            } };
            const Model = load(content(c.files, 'models/Parent.js'), () => pool);
            const controller = load(content(c.files, 'controllers/parentController.js'), () => Model);
            const router = load(content(c.files, 'routes/parentRoutes.js'), dep => dep === 'express' ? express : controller);
            const app = express(); app.use(express.json()); app.use('/parents', router);
            const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
            try {
                const call = async (url, route, method = 'get', body, expected = 200) => {
                    const response = await fetch(`http://127.0.0.1:${server.address().port}/parents${url}`, { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
                    const data = await response.json(); requests++; assert.equal(response.status, expected);
                    validate(doc, doc.paths[route][method].responses[String(expected)].content['application/json'].schema, data);
                    assert(!JSON.stringify(data).includes('PRIVATE')); return data;
                };
                assert.equal((await call('?page=1', '/parents')).data[0].enabled, false);
                await call('/1', '/parents/{id}'); await call('', '/parents', 'post', { enabled: true }, 201);
                await call('/1', '/parents/{id}', 'put', { enabled: false }); await call('/1', '/parents/{id}', 'delete');
                await call('', '/parents', 'post', { unknown: 1 }, 400); await call('/1', '/parents/{id}', 'put', { id: 1 }, 400);
                const many = ['ONE_TO_MANY', 'MANY_TO_MANY'].includes(kind), segment = many ? 'childs' : 'child';
                await call('/1/' + segment, '/parents/{id}/' + segment);
                if (kind === 'MANY_TO_MANY') {
                    await call('/1/childs/c', '/parents/{id}/childs/{childId}', 'post', undefined, 201);
                    await call('/1/childs/c', '/parents/{id}/childs/{childId}', 'delete');
                }
                missing = true; await call('/1', '/parents/{id}', 'get', undefined, 404);
                await call('/1', '/parents/{id}', 'put', {}, 404); await call('/1', '/parents/{id}', 'delete', undefined, 404);
                if (!many) await call('/1/' + segment, '/parents/{id}/' + segment, 'get', undefined, 404);
                missing = false; fail = true;
                for (const [url, route, method, body] of [['', '/parents', 'get'], ['/1','/parents/{id}','get'], ['', '/parents','post',{}], ['/1','/parents/{id}','put',{}], ['/1','/parents/{id}','delete'], ['/1/'+segment,'/parents/{id}/'+segment,'get']]) await call(url, route, method, body, 500);
                if (kind === 'MANY_TO_MANY') for (const method of ['post', 'delete']) await call('/1/childs/c', '/parents/{id}/childs/{childId}', method, undefined, 500);
            } finally { await new Promise(r => server.close(r)); }
        }
    });
    console.log(`OpenAPI fidelity: ${groups} groups PASS; ${requests} actual HTTP requests; schema-subset validator, not a full OAS validator.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
