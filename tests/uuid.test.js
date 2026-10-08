const baseAssert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES } = require('../src/utils/diagnostics');
const { UUID_PATTERN, isUuid } = require('../src/utils/uuid');
const { UUID, OTHER, valid, invalid, source, body, row, content, load, runtime, withHttp, compileProject } = require('./uuid-test-helpers');
let assertions = 0, groups = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { assertions++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function'
        ? (...args) => { assertions++; return value(...args); } : value; }
});
const parse = source => Parser.parse(Lexer.tokenize(source));
const analyze = declaration => Semantic.analyze(parse('ENTITY Item\n' + declaration));
const clone = value => JSON.parse(JSON.stringify(value));
async function test(name, run) { await run(); groups++; console.log('  PASS ' + name); }
async function rejected(r, request, method, suffix, data) {
    const before = [r.calls.length, r.modelCalls.length, r.state.generated];
    const result = await request(method, suffix, data);
    assert.equal(result.status, 400, JSON.stringify(result));
    assert.equal(result.json.success, false);
    assert.deepEqual([r.calls.length, r.modelCalls.length, r.state.generated], before, 'No model, DB or UUID generation for invalid HTTP input');
}
function schema(value) {
    assert.equal(value.type, 'string'); assert.equal(value.format, 'uuid');
    assert.equal(value.pattern, UUID_PATTERN); assert.match(value.description, /lowercase/);
}
async function main() {
    const files = compileProject(source);
    await test('A/B: uppercase UUID datatype, case sensitivity, AST/default literal locations and symbols', () => {
        const tokens = Lexer.tokenize('UUID uuid Uuid');
        assert.deepEqual(tokens.slice(0, 3).map(t => t.type), ['DATATYPE', 'IDENTIFIER', 'IDENTIFIER']);
        assert.deepEqual([tokens[0].line, tokens[0].column, tokens[0].endColumn], [1, 1, 5]);
        for (const type of ['uuid', 'Uuid', 'UUIDv7']) assert.throws(() => parse('ENTITY Item\ntoken ' + type), e => e.diagnostic.code === 'PAR013');
        const text = `ENTITY Item\nkey UUID PRIMARY KEY REQUIRED UNIQUE DEFAULT "${UUID}"`;
        const ast = parse(text), field = ast.entities[0].fields[0], result = Semantic.analyze(ast);
        assert.equal(result.valid, true); assert.equal(field.dataType, 'UUID');
        assert.deepEqual(field.constraints, ['PRIMARY_KEY', 'REQUIRED', 'UNIQUE']);
        assert.deepEqual(field.defaultValue, { type: 'STRING', value: UUID });
        assert.deepEqual(field.sourceLocations.DEFAULT_LITERAL, [Lexer.tokenize(text).find(t => t.type === 'STRING_LITERAL')]);
        assert.equal(result.symbolTable.Item.fields.key.dataType, 'UUID');
        assert.deepEqual(result.symbolTable.Item.fields.key.defaultValue, field.defaultValue);
    });
    await test('C: one shared canonical validator accepts all versions/nil/max and rejects malformed forms/defaults', () => {
        assert.equal(CODES.semantic.INVALID_UUID_DEFAULT, 'SEM039');
        assert.equal(CODES.semantic.INVALID_TEMPORAL_DEFAULT, 'SEM038');
        assert.equal(UUID_PATTERN, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
        for (const value of valid) {
            assert.equal(isUuid(value), true);
            assert.equal(analyze(`token UUID REQUIRED UNIQUE DEFAULT "${value}"`).valid, true);
        }
        for (const value of invalid) {
            assert.equal(isUuid(value), false);
            if (typeof value !== 'string') continue;
            // DSL backslashes are literal; newline/default rejection is tested through forged IR below.
            if (value.includes('\n')) continue;
            const text = `ENTITY Item\ntoken UUID DEFAULT "${value}"`, result = Semantic.analyze(parse(text));
            assert.deepEqual(result.diagnostics.map(d => d.code), ['SEM039']);
            const literal = Lexer.tokenize(text).find(t => t.type === 'STRING_LITERAL'), d = result.diagnostics[0];
            assert.deepEqual([d.line, d.column, d.endLine, d.endColumn], [literal.line, literal.column, literal.endLine, literal.endColumn]);
        }
        for (const [modifier, code] of [['DEFAULT 5', 'SEM021'], ['DEFAULT TRUE', 'SEM021'],
            ['MIN 1', 'SEM015'], ['MAX 1', 'SEM015'], ['MIN_LENGTH 1', 'SEM016'], ['MAX_LENGTH 36', 'SEM016'],
            ['REQUIRED REQUIRED', 'SEM009'], ['UNIQUE UNIQUE', 'SEM009'], [`DEFAULT "${UUID}" DEFAULT "${UUID}"`, 'SEM020']]) {
            assert.deepEqual(analyze('token UUID ' + modifier).diagnostics.map(d => d.code), [code]);
        }
        assert.equal(analyze('key UUID PRIMARY KEY').valid, true);
        assert.throws(() => parse('ENTITY UUID\nvalue INT'), e => e.diagnostic.code === 'PAR001');
    });
    await test('D: IR understands UUID/defaults/keys, rejects forged defaults/bounds/unknown types; optimizer preserves conflicts', () => {
        const ast = parse(source), ir = IR.generate(ast, Semantic.analyze(ast)), optimized = Optimizer.optimize(ir).ir;
        assert.equal(IR.validate(optimized).valid, true);
        for (const field of ir.instructions.filter(i => i.dataType === 'UUID')) {
            const found = optimized.instructions.find(i => i.entity === field.entity && i.field === field.field);
            assert.deepEqual(found, field);
        }
        for (const mutate of [f => { f.dataType = 'UNKNOWN'; },
            ...invalid.map(value => f => { f.defaultValue = { type: 'STRING', value }; }),
            f => { f.defaultValue = { type: 'NUMBER', value: 5 }; }, f => { f.defaultValue = { type: 'BOOLEAN', value: true }; },
            ...['MIN', 'MAX', 'MIN_LENGTH', 'MAX_LENGTH'].map(type => f => { f.validations = [{ type, value: 1 }]; })]) {
            const forged = clone(ir), field = forged.instructions.find(i => i.entity === 'User' && i.field === 'uid');
            mutate(field); assert.equal(IR.validate(forged).valid, false); assert.throws(() => Codegen.generate(forged, false));
        }
        for (const value of valid) {
            const forged = clone(ir), field = forged.instructions.find(i => i.entity === 'User' && i.field === 'uid');
            field.defaultValue = { type: 'STRING', value }; assert.equal(IR.validate(forged).valid, true);
        }
        const duplicate = clone(ir), fixed = duplicate.instructions.find(i => i.entity === 'User' && i.field === 'fixed');
        duplicate.instructions.push(clone(fixed));
        assert.equal(Optimizer.optimize(duplicate).ir.instructions.filter(i => i.entity === 'User' && i.field === 'fixed').length, 1);
        duplicate.instructions.at(-1).defaultValue.value = OTHER;
        const conflict = Optimizer.optimize(duplicate);
        assert.equal(conflict.ir.instructions.filter(i => i.entity === 'User' && i.field === 'fixed').length, 2);
        assert(conflict.warnings.some(d => d.code === 'WRN002'));
    });
    await test('E/F: exact SQL/FK storage, generation modes, no UUID AUTO_INCREMENT/default; generated JS parses', () => {
        const sql = content(files, 'database/schema.sql'), physical = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin';
        assert(sql.includes('uid ' + physical + ' PRIMARY KEY,'));
        assert(sql.includes('token ' + physical + ' UNIQUE,'));
        assert(sql.includes('requiredUuid ' + physical + ' NOT NULL,'));
        assert(sql.includes('fixed ' + physical + " DEFAULT '" + UUID + "',"));
        assert(sql.includes('user_uid ' + physical)); assert(sql.includes('company_id ' + physical));
        assert(sql.includes('group_code ' + physical));
        for (const line of sql.split('\n').filter(line => line.includes('CHAR(36)'))) assert(!line.includes('AUTO_INCREMENT'));
        assert(!/UUID_TO_BIN|BIN_TO_UUID|BINARY\(16\)|UUID\(\)/.test(sql));
        for (const [declaration, expected] of [['label STRING', 'auto_increment'], ['id INT PRIMARY KEY', 'auto_increment'],
            ['id INT PRIMARY KEY DEFAULT 7', 'none'], ['key STRING PRIMARY KEY', 'none'], ['id UUID PRIMARY KEY', 'runtime_uuid'],
            [`id UUID PRIMARY KEY DEFAULT "${UUID}"`, 'none']]) {
            const ir = IR.generate(parse('ENTITY Item\n' + declaration), analyze(declaration));
            const key = Codegen.getEffectiveKey(Codegen.extractEntitiesFromIR(ir)[0]);
            assert.equal(key.generation, expected); assert.equal(key.autoGenerated, expected !== 'none');
        }
        for (const file of files.filter(f => f.path.endsWith('.js'))) new vm.Script(file.content, { filename: file.path });
        const db = content(files, 'config/db.js'); assert(!db.includes('dateStrings')); assert(!db.includes('SET SESSION time_zone'));
        assert.deepEqual(Object.keys(JSON.parse(content(files, 'package.json')).dependencies).sort(), ['dotenv', 'express', 'mysql2']);
    });
    await test('G/H: real emitted HTTP generates once, binds/returns identity, honors supplied/null keys and direct input ownership', async () => {
        await withHttp(files, 'User', async (r, request) => {
            const ids = [];
            for (const data of [body, { ...body, uid: null }, body]) {
                const count = r.state.generated, result = await request('POST', '', data);
                assert.equal(result.status, 201); assert.equal(r.state.generated, count + 1);
                assert.equal(isUuid(result.json.data.uid), true); assert.equal(result.json.data.uid[14], '4');
                assert.equal(r.calls.at(-1).values[0].uid, result.json.data.uid); ids.push(result.json.data.uid);
                assert.equal(Object.hasOwn(result.json.data, 'fixed'), false);
            }
            assert.equal(new Set(ids).size, 3);
            for (const id of valid) {
                const count = r.state.generated, result = await request('POST', '', { ...body, uid: id });
                assert.equal(result.status, 201); assert.equal(result.json.data.uid, id);
                assert.equal(r.calls.at(-1).values[0].uid, id); assert.equal(r.state.generated, count);
            }
            const input = Object.freeze({ ...body, token: OTHER }), before = { ...input };
            const result = await r.Model.create(input);
            assert.deepEqual(input, before); assert.notEqual(r.calls.at(-1).values[0], input);
            assert.equal(r.calls.at(-1).values[0].uid, result.uid);
            assert.deepEqual(r.modelCalls[0].args[0], body, 'Controller forwarding remains unmutated');
        });
        const empty = runtime(compileProject('ENTITY Item\nid UUID PRIMARY KEY'), 'Item');
        const result = await empty.Model.create(Object.freeze({})); assert.equal(isUuid(result.id), true);
        assert.match(empty.calls[0].sql, /SET \?/); assert.equal(empty.calls[0].values[0].id, result.id);
    });
    await test('G/H: REQUIRED null/ordinary omission, malformed supplied keys/fields reject before DB; ordinary fields never generate', async () => {
        await withHttp(files, 'User', async (r, request) => {
            for (const field of ['uid', 'token', 'requiredUuid']) for (const value of invalid.filter(v => v !== undefined)) {
                await rejected(r, request, 'POST', '', { ...body, [field]: value });
            }
            await rejected(r, request, 'POST', '', { email: 'a@example.com' });
            await rejected(r, request, 'POST', '', { ...body, requiredUuid: null });
            for (const value of invalid) {
                const before = r.calls.length;
                await assert.rejects(r.Model.create({ ...body, token: value })); assert.equal(r.calls.length, before);
            }
            const result = await r.Model.create({ ...body, token: null }); assert.equal(result.token, null);
            assert.equal(Object.hasOwn(r.calls.at(-1).values[0], 'fixed'), false);
        });
        const requiredFiles = compileProject('ENTITY Item\nid UUID PRIMARY KEY REQUIRED');
        await withHttp(requiredFiles, 'Item', async (r, request) => {
            const created = await request('POST', '', {}); assert.equal(created.status, 201); assert.equal(isUuid(created.json.data.id), true);
            await rejected(r, request, 'POST', '', { id: null });
            const before = r.calls.length; await assert.rejects(r.Model.create({ id: null })); assert.equal(r.calls.length, before);
        });
    });
    await test('G/H: static UUID PK DEFAULT preserves supplied/default identity policy with zero randomUUID calls', async () => {
        const staticFiles = compileProject(`ENTITY Item\nid UUID PRIMARY KEY DEFAULT "${UUID}"\ntoken UUID`);
        await withHttp(staticFiles, 'Item', async (r, request) => {
            assert(!content(staticFiles, 'models/Item.js').includes("require('crypto')"));
            assert.equal((await request('POST', '', {})).json.data.id, UUID);
            assert.match(r.calls[0].sql, /\(\) VALUES \(\)/);
            assert.equal((await request('POST', '', { id: OTHER })).json.data.id, OTHER);
            assert.equal(r.state.generated, 0);
            assert.equal((await r.Model.create(Object.freeze({}))).id, UUID);
        });
        const ordinary = runtime(compileProject('ENTITY Item\nid INT PRIMARY KEY\ntoken UUID'), 'Item');
        await ordinary.Model.create({}); assert.equal(ordinary.state.generated, 0);
        assert.equal(Object.hasOwn(ordinary.calls[0].values || {}, 'token'), false);
    });
    await test('I/J: immutable UUID keys and strict item URL validation; valid ordinary updates retain URL identity', async () => {
        await withHttp(files, 'User', async (r, request) => {
            for (const id of [UUID, null, 'bad']) await rejected(r, request, 'PUT', '/' + UUID, { uid: id });
            for (const value of invalid.filter(v => v !== undefined)) await rejected(r, request, 'PUT', '/' + UUID, { token: value });
            for (const value of invalid.filter(v => typeof v === 'string' && v !== '')) {
                for (const method of ['GET', 'PUT', 'DELETE']) await rejected(r, request, method, '/' + encodeURIComponent(value), method === 'PUT' ? {} : undefined);
            }
            for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request(method, '/' + UUID, method === 'PUT' ? { token: OTHER } : undefined)).status, 200);
            const update = r.calls.find(call => /^UPDATE/.test(call.sql)); assert.deepEqual(update.values, [{ token: OTHER }, UUID]);
            const before = r.calls.length; await assert.rejects(r.Model.update(UUID, { uid: UUID })); assert.equal(r.calls.length, before);
        });
    });
    await test('K: equality UUID filters bind unchanged, reject before DB and sorting uses existing whitelist', async () => {
        await withHttp(files, 'User', async (r, request) => {
            for (const field of ['uid', 'token']) for (const value of valid) {
                const result = await request('GET', '?' + field + '=' + value + '&sort=' + field + '&order=desc');
                assert.equal(result.status, 200); assert.deepEqual(r.calls.at(-1).values, [value]);
                assert.match(r.calls.at(-1).sql, /ORDER BY .* DESC/);
            }
            for (const value of invalid.filter(v => typeof v === 'string')) {
                const before = r.calls.length, result = await request('GET', '?token=' + encodeURIComponent(value));
                assert.equal(result.status, 400); assert.equal(r.calls.length, before);
            }
            const before = r.calls.length; await assert.rejects(r.Model.findAll({ filters: { token: UUID.toUpperCase() } })); assert.equal(r.calls.length, before);
        });
    });
    await test('L: collection/item/update rereads preserve canonical values/null/STRING and safely reject bad UUID rows', async () => {
        await withHttp(files, 'User', async (r, request) => {
            const original = { ...row };
            for (const [method, url, data] of [['GET', ''], ['GET', '/' + UUID], ['PUT', '/' + UUID, { token: OTHER }]]) {
                const result = await request(method, url, data); assert.equal(result.status, 200);
                const actual = Array.isArray(result.json.data) ? result.json.data[0] : result.json.data;
                assert.equal(actual.uid, UUID); assert.equal(actual.token, null); assert.equal(actual.label, 'NOT-A-UUID');
                assert.equal(actual.active, true); assert.deepEqual(r.state.rows[0], original);
            }
            for (const bad of [UUID.toUpperCase(), 'broken', 4, {}, Buffer.from(UUID), undefined]) {
                r.state.rows = [{ ...row, token: bad }];
                for (const [method, url, data] of [['GET', ''], ['GET', '/' + UUID], ['PUT', '/' + UUID, {}]]) {
                    const result = await request(method, url, data); assert.equal(result.status, 500);
                    assert.deepEqual(result.json, { success: false, error: 'Unable to complete request.' });
                }
            }
            for (const field of ['uid', 'requiredUuid']) {
                r.state.rows = [{ ...row, [field]: null }]; assert.equal((await request('GET', '/' + UUID)).status, 500);
            }
            r.state.rows = []; assert.equal((await request('GET', '/' + OTHER)).status, 404);
        });
    });
    await test('J/L/M: all four relationship reads/UUID source paths plus M2M target add/remove and mixed INT source', async () => {
        await withHttp(files, 'User', async (r, request) => {
            for (const [segment, key, cardinality] of [['profile', 'id', 'ONE_TO_ONE'], ['posts', 'id', 'ONE_TO_MANY'],
                ['company', 'id', 'MANY_TO_ONE'], ['groups', 'code', 'MANY_TO_MANY']]) {
                await rejected(r, request, 'GET', '/bad/' + segment);
                r.state.rows = [{ [key]: cardinality === 'ONE_TO_MANY' ? 3 : UUID, token: UUID }];
                const result = await request('GET', '/' + UUID + '/' + segment); assert.equal(result.status, 200);
                const actual = Array.isArray(result.json.data) ? result.json.data[0] : result.json.data;
                assert.equal(actual.token, UUID); assert.deepEqual(r.calls.at(-1).values, [UUID]);
                for (const bad of [UUID.toUpperCase(), 'malformed']) {
                    r.state.rows[0].token = bad;
                    const result = await request('GET', '/' + UUID + '/' + segment); assert.equal(result.status, 500);
                    assert.equal(result.json.error, 'Unable to complete request.');
                }
            }
            for (const method of ['POST', 'DELETE']) {
                await rejected(r, request, method, '/bad/groups/' + UUID);
                for (const value of invalid.filter(v => typeof v === 'string' && v !== '')) await rejected(r, request, method, '/' + UUID + '/groups/' + encodeURIComponent(value));
                const result = await request(method, '/' + UUID + '/groups/' + OTHER); assert.equal(result.status, method === 'POST' ? 201 : 200);
                assert.deepEqual(r.calls.at(-1).values, [UUID, OTHER]);
                if (method === 'POST') assert.deepEqual(result.json.data, { user_uid: UUID, group_code: OTHER });
            }
        });
        await withHttp(files, 'Member', async (r, request) => {
            r.state.rows = [{ id: UUID, token: UUID }]; assert.equal((await request('GET', '/7/company')).status, 200);
            assert.deepEqual(r.calls.at(-1).values, ['7']); r.state.rows[0].id = 'bad';
            assert.equal((await request('GET', '/7/company')).status, 500);
        });
        const mixed = compileProject('ENTITY Item\nid INT PRIMARY KEY\nENTITY Target\nid UUID PRIMARY KEY\nRELATION Item JOINS Target MANY_TO_MANY');
        await withHttp(mixed, 'Item', async (r, request) => {
            await rejected(r, request, 'POST', '/7/targets/bad');
            assert.equal((await request('POST', '/7/targets/' + UUID)).status, 201);
            assert.deepEqual(r.calls.at(-1).values, ['7', UUID]);
        });
    });
    await test('N: OpenAPI UUID fidelity across all operation roles, FK columns, filters, paths and associations', () => {
        const doc = JSON.parse(content(files, 'swagger.json')), schemas = doc.components.schemas;
        for (const role of ['', '.Create', '.Read', '.CreateResult']) for (const field of ['uid', 'token', 'requiredUuid', 'fixed']) schema(schemas['User' + role].properties[field]);
        for (const field of ['token', 'requiredUuid', 'fixed']) schema(schemas['User.Update'].properties[field]);
        assert(!Object.hasOwn(schemas['User.Update'].properties, 'uid'));
        assert(!schemas['User.Create'].required.includes('uid')); assert.equal(schemas['User.Create'].properties.uid.nullable, true);
        assert.equal(schemas['User.Read'].properties.uid.nullable, false); assert.equal(schemas['User.Read'].properties.uid.readOnly, true);
        assert.equal(schemas['User.CreateResult'].properties.uid.nullable, false);
        assert.deepEqual(schemas['User.CreateResult'].required, ['uid']);
        assert.match(schemas['User.Create'].properties.uid.description, /Omission.*generates/);
        assert.equal(schemas['User.Create'].properties.fixed.default, UUID);
        schema(schemas['Profile.Read'].properties.user_uid); schema(schemas['Post.Read'].properties.user_uid);
        schema(schemas['Member.Read'].properties.company_id);
        for (const filter of doc.paths['/users'].get.parameters.filter(p => ['uid', 'token'].includes(p.name))) schema(filter.schema);
        for (const [url, entry] of Object.entries(doc.paths)) if (url.startsWith('/users/')) {
            for (const parameter of entry.parameters) schema(parameter.schema);
            for (const method of ['get', 'put', 'delete', 'post']) if (entry[method]) assert(entry[method].responses['400']);
        }
        for (const property of Object.values(schemas['User.Group.Association'].properties.data.properties)) schema(property);
        const staticDoc = JSON.parse(content(compileProject(`ENTITY Item\nid UUID PRIMARY KEY DEFAULT "${UUID}"`), 'swagger.json'));
        schema(staticDoc.components.schemas['Item.Create'].properties.id); assert.equal(staticDoc.components.schemas['Item.Read'].properties.id.nullable, false);
    });
    await test('M: all cardinalities across UUID/UUID, UUID/INT, INT/UUID and UUID/STRING preserve key SQL, bindings and paths', async () => {
        for (const cardinality of ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']) {
            for (const [sourceType, targetType] of [['UUID', 'UUID'], ['UUID', 'INT'], ['INT', 'UUID'], ['UUID', 'STRING']]) {
                const matrix = compileProject(`ENTITY Source\nkey ${sourceType} PRIMARY KEY\nENTITY Target\nkey ${targetType} PRIMARY KEY\ntoken UUID\nRELATION Source LINKS Target ${cardinality}`);
                const sql = content(matrix, 'database/schema.sql'), types = { UUID: 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin', INT: 'INT', STRING: 'VARCHAR(255)' };
                const fkType = cardinality === 'MANY_TO_ONE' ? targetType : sourceType;
                const fkName = cardinality === 'MANY_TO_ONE' ? 'target_key' : 'source_key';
                assert(sql.includes(fkName + ' ' + types[fkType]));
                if (cardinality === 'MANY_TO_MANY') assert(sql.includes('target_key ' + types[targetType]));
                await withHttp(matrix, 'Source', async (r, request) => {
                    const sourceId = sourceType === 'UUID' ? UUID : '7', targetId = targetType === 'UUID' ? OTHER : targetType === 'INT' ? 8 : 'slug';
                    r.state.rows = [{ key: targetId, token: UUID }];
                    const segment = ['ONE_TO_MANY', 'MANY_TO_MANY'].includes(cardinality) ? 'targets' : 'target';
                    assert.equal((await request('GET', '/' + sourceId + '/' + segment)).status, 200);
                    assert.deepEqual(r.calls.at(-1).values, [sourceId]);
                    if (sourceType === 'UUID') await rejected(r, request, 'GET', '/BAD/' + segment);
                    if (cardinality === 'MANY_TO_MANY') {
                        for (const method of ['POST', 'DELETE']) {
                            assert.equal((await request(method, '/' + sourceId + '/targets/' + targetId)).status, method === 'POST' ? 201 : 200);
                            assert.deepEqual(r.calls.at(-1).values, [sourceId, String(targetId)]);
                            if (targetType === 'UUID') await rejected(r, request, method, '/' + sourceId + '/targets/BAD');
                        }
                    }
                });
            }
        }
    });
    await test('H/L: prototype-sensitive UUID key writes/read properties stay own, copied and canonical', async () => {
        const special = compileProject('ENTITY Item\n__proto__ UUID PRIMARY KEY\nconstructor UUID');
        const r = runtime(special, 'Item'), input = Object.freeze(JSON.parse(`{"__proto__":"${UUID}","constructor":"${OTHER}"}`));
        const result = await r.Model.create(input);
        assert.equal(Object.getPrototypeOf(result), Object.prototype); assert.equal(Object.hasOwn(result, '__proto__'), true);
        assert.equal(result.__proto__, UUID); assert.equal(r.calls[0].values[0].__proto__, UUID); assert.notEqual(r.calls[0].values[0], input);
        const generatedInput = Object.freeze({ constructor: UUID }), generatedResult = await r.Model.create(generatedInput);
        assert.equal(Object.hasOwn(generatedInput, '__proto__'), false); assert.equal(isUuid(generatedResult.__proto__), true);
        r.state.rows = [JSON.parse(`{"__proto__":"${UUID}","constructor":"${OTHER}"}`)];
        assert.equal((await r.Model.findById(UUID)).__proto__, UUID);
        r.state.rows[0].constructor = 'BAD'; await assert.rejects(r.Model.findById(UUID));
    });
    await test('A/O/frontend: compiler API phases, test-owned UUID relationship fixture/frontend token styling and real CLI disk bytes', async () => {
        const root = path.resolve(__dirname, '..'), sample = fs.readFileSync(path.join(root, 'samples/uuid.apiforge'), 'utf8');
        const express = require('express'), appServer = express(); appServer.use(express.json());
        appServer.use('/api', require('../src/api/compiler-api'));
        const server = appServer.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        let result;
        try {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: sample }) });
            assert.equal(response.status, 200); result = await response.json();
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        assert.equal(result.success, true); assert.equal(result.phaseStates.codegen, 'succeeded');
        assert(result.tokens.some(token => token.value === 'UUID' && token.type === 'DATATYPE'));
        const app = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
        const { UUID_RELATION_SOURCE } = require('./frontend-source-fixtures');
        const fixtureFiles = compileProject(UUID_RELATION_SOURCE);
        assert(fixtureFiles.some(file => file.path === 'models/User.js'));
        assert(fixtureFiles.some(file => file.path === 'models/Group.js'));
        assert.match(fixtureFiles.find(file => file.path === 'database/schema.sql').content, /CHAR\(36\)/);
        assert.match(app, /DATATYPE: 'token-datatype'/); assert.match(app, /const types = .*'CHAR'/);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g25-cli-'));
        try {
            execFileSync(process.execPath, [path.join(root, 'index.js'), path.join(root, 'samples/uuid.apiforge')],
                { cwd: temporary, encoding: 'utf8', windowsHide: true });
            const expected = compileProject(sample);
            for (const file of expected) assert.equal(fs.readFileSync(path.join(temporary, 'output', file.path), 'utf8'), file.content);
        } finally {
            assert.equal(path.dirname(temporary), os.tmpdir()); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
        }
    });
    await test('O/G06: sanitized DB taxonomy retains 409/400/503/500 behavior', async () => {
        await withHttp(files, 'User', async (r, request) => {
            for (const [code, status] of [['ER_DUP_ENTRY', 409], ['ER_DATA_TOO_LONG', 400], ['ECONNREFUSED', 503], ['UNKNOWN', 500]]) {
                r.state.error = Object.assign(new Error('secret SQL'), { code });
                const result = await request('POST', '', body); assert.equal(result.status, status);
                assert(!JSON.stringify(result.json).includes('secret')); assert(!JSON.stringify(result.json).includes(code));
            }
        });
    });
    await test('O/G24: mixed UUID/temporal writes preserve canonical echo and independent UTC config', async () => {
        const mixed = compileProject('ENTITY Item\nid UUID PRIMARY KEY\nd DATE REQUIRED\nt TIMESTAMP REQUIRED');
        const r = runtime(mixed, 'Item'), input = Object.freeze({ d: '2026-10-05', t: '2026-10-05T12:30:00Z' });
        const result = await r.Model.create(input);
        assert.equal(result.t, input.t); assert.equal(r.calls[0].values[0].t, '2026-10-05 12:30:00');
        assert.equal(result.id, r.calls[0].values[0].id); assert.equal(r.state.generated, 1);
        assert(content(mixed, 'config/db.js').includes('dateStrings'));
    });
    await test('O: every valid existing non-UUID sample retains approved-main generated bytes, including DATE/TIMESTAMP', () => {
        const root = path.resolve(__dirname, '..'), baseline = 'b5b23024a4938c472b5fa73d0ebfd50e34ef75e8';
        const original = load(execFileSync('git', ['show', baseline + ':src/codegen/codegen.js'],
            { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 }), createRequire(path.join(root, 'src/codegen/codegen.js')));
        let count = 0;
        for (const name of fs.readdirSync(path.join(root, 'samples')).filter(name => name.endsWith('.apiforge'))) {
            const text = fs.readFileSync(path.join(root, 'samples', name), 'utf8'); if (/\bUUID\b/.test(text)) continue;
            const ast = parse(text), result = Semantic.analyze(ast); if (!result.valid) continue;
            const ir = Optimizer.optimize(IR.generate(ast, result)).ir;
            assert.deepEqual(Codegen.generate(ir, false).files, original.generate(ir, false).files, name); count++;
        }
        assert(count >= 4);
    });
    console.log(`G25 UUID: ${groups} test groups passed; ${assertions} assertions passed. Generated HTTP/SQL mocks; live MySQL is separate.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
