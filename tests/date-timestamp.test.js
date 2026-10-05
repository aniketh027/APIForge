const baseAssert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync, execFileSync } = require('child_process');
const { createRequire } = require('module');
const express = require('express');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES } = require('../src/utils/diagnostics');
const { compileProject } = require('./generated-backend-test-helpers');

let assertions = 0, groups = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { assertions++; return Reflect.apply(target, receiver, args); },
    get(target, key) {
        const value = target[key];
        return typeof value === 'function' ? (...args) => { assertions++; return value(...args); } : value;
    }
});
async function test(name, run) { await run(); groups++; console.log('  PASS ' + name); }
const parse = source => Parser.parse(Lexer.tokenize(source));
const analyze = declaration => Semantic.analyze(parse('ENTITY Event\nid INT PRIMARY KEY\n' + declaration));
const clone = value => JSON.parse(JSON.stringify(value));
function load(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
function content(files, name) {
    const file = files.find(file => file.path === name);
    assert(file, 'Missing generated file: ' + name);
    return file.content;
}
const dateValid = ['1000-01-01', '1600-02-29', '2000-02-29', '2024-02-29', '2026-10-05', '9999-12-31'];
const timestampValid = ['1970-01-01T00:00:01Z', '2000-02-29T23:59:59Z', '2026-10-05T12:30:00Z', '2038-01-19T03:14:07Z'];
const dateInvalid = ['2026-2-03', '2026/02/03', '2026-02-30', '2025-02-29', '1900-02-29',
    '2100-02-29', '0999-12-31', '0000-01-01', '10000-01-01', '2026-00-01', '2026-13-01',
    '2026-01-00', '2026-01-32', ' 2026-10-05', '2026-10-05 ', '2026-10-05\n', '', 'null'];
const timestampInvalid = ['1970-01-01T00:00:00Z', '2038-01-19T03:14:08Z', '2038-01-20T00:00:00Z',
    '2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z', '2026-10-05 12:30:00',
    '2026-10-05T12:30:00+05:30', '2026-10-05T12:30:00+00:00', '2026-10-05T12:30:00.123Z',
    '2026-10-05T24:00:00Z', '2026-10-05T12:60:00Z', '2026-10-05T12:30:60Z',
    '2026-10-05T12:30:00z', '2026-10-05t12:30:00Z', '2026-10-5T12:30:00Z',
    ' 2026-10-05T12:30:00Z', '2026-10-05T12:30:00Z\n', '', 'null'];
const eventSource = [
    'ENTITY Event', 'id INT PRIMARY KEY', 'eventDate DATE REQUIRED', 'createdAt TIMESTAMP REQUIRED',
    'optionalDate DATE', 'optionalStamp TIMESTAMP', 'defaultDate DATE DEFAULT "2026-01-01"',
    'defaultStamp TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"', 'label STRING', 'active BOOLEAN'
].join('\n');
const publicBody = { eventDate: '2026-10-05', createdAt: '2026-10-05T12:30:00Z' };
const wireRow = { id: 7, eventDate: '2026-10-05', createdAt: '2026-10-05 12:30:00',
    optionalDate: null, optionalStamp: null, label: '2026-10-05 12:30:00', active: 1 };
const publicRow = { ...wireRow, createdAt: publicBody.createdAt, active: true };

function runtime(files, name = 'Event') {
    const calls = [], modelCalls = [];
    const state = { rows: [clone(wireRow)], error: null };
    const pool = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (state.error) throw state.error;
        if (/^INSERT/.test(sql)) return [{ insertId: 7, affectedRows: 1 }];
        if (/^(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
        if (/COUNT\(\*\)/.test(sql)) return [[{ total: state.rows.length }]];
        return [state.rows];
    } };
    const Model = load(content(files, 'models/' + name + '.js'), () => pool);
    const tracked = new Proxy(Model, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        if (['create', 'update', 'delete', 'findById', 'findAll', 'countFiltered'].includes(key) || /^get[A-Z]/.test(key)) {
            return (...args) => { modelCalls.push({ method: key, args }); return value.apply(target, args); };
        }
        return value.bind(target);
    } });
    const controller = load(content(files, 'controllers/' + name[0].toLowerCase() + name.slice(1) + 'Controller.js'), () => tracked);
    return { Model, controller, pool, calls, modelCalls, state };
}
async function withHttp(files, name, run) {
    const r = runtime(files, name);
    const route = load(content(files, 'routes/' + name[0].toLowerCase() + name.slice(1) + 'Routes.js'), dependency => dependency === 'express' ? express : r.controller);
    const app = express(); app.use(express.json()); app.use('/' + Codegen.pluralize(name).toLowerCase(), route);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/${Codegen.pluralize(name).toLowerCase()}`;
    const request = async (method, suffix = '', body) => {
        const response = await fetch(base + suffix, { method, headers: { 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, json: await response.json(), headers: response.headers };
    };
    try { await run(r, request); }
    finally { await new Promise(resolve => server.close(resolve)); }
}
function responseMock() {
    return { code: null, body: null, status(value) { this.code = value; return this; },
        json(value) { this.body = value; return this; } };
}

async function main() {
    await test('A: temporal tokens are uppercase, exclusive and positioned; case sensitivity is retained', () => {
        const tokens = Lexer.tokenize('DATE TIMESTAMP date timestamp Timestamp Date');
        assert.deepEqual(tokens.slice(0, 6).map(token => token.type),
            ['DATATYPE', 'DATATYPE', 'IDENTIFIER', 'IDENTIFIER', 'IDENTIFIER', 'IDENTIFIER']);
        assert.deepEqual(tokens.slice(0, 2).map(token => [token.value, token.line, token.column, token.endColumn]),
            [['DATE', 1, 1, 5], ['TIMESTAMP', 1, 6, 15]]);
        for (const value of ['date', 'timestamp', 'Timestamp', 'Date', 'DATETIME', 'TIME', 'YEAR', 'UUID']) {
            assert.throws(() => parse('ENTITY Event\nd ' + value), error => error.diagnostic.code === 'PAR013');
        }
    });
    await test('B: AST/default types and exact source locations survive REQUIRED/UNIQUE combinations', () => {
        for (const [type, value] of [['DATE', dateValid[4]], ['TIMESTAMP', timestampValid[2]]]) {
            const source = `ENTITY Event\nid INT PRIMARY KEY\nvalue ${type} REQUIRED UNIQUE DEFAULT "${value}"`;
            const tokens = Lexer.tokenize(source), ast = Parser.parse(tokens), field = ast.entities[0].fields[1];
            assert.equal(field.dataType, type);
            assert.deepEqual(field.constraints, ['REQUIRED', 'UNIQUE']);
            assert.deepEqual(field.defaultValue, { type: 'STRING', value });
            const typeToken = tokens.find(token => token.value === type);
            assert.deepEqual(field.sourceLocations.type, [typeToken]);
            const literal = tokens.find(token => token.type === 'STRING_LITERAL');
            assert.deepEqual(field.sourceLocations.DEFAULT_LITERAL, [literal]);
            assert.equal(field.sourceLocations.DEFAULT[0].line, 3);
            assert.equal(field.sourceLocations.DEFAULT[0].endColumn, literal.endColumn);
            assert.equal(Object.keys(field).includes('sourceLocations'), false);
        }
    });
    await test('C: shared canonical calendar/range rules accept all valid static defaults and reject malformed strings', () => {
        assert.equal(CODES.semantic.INVALID_TEMPORAL_DEFAULT, 'SEM038');
        for (const [type, valid, invalid] of [['DATE', dateValid, dateInvalid], ['TIMESTAMP', timestampValid, timestampInvalid]]) {
            for (const value of valid) {
                const semantic = analyze(`value ${type} REQUIRED UNIQUE DEFAULT ${JSON.stringify(value)}`);
                assert.equal(semantic.valid, true, JSON.stringify(semantic.diagnostics));
                assert.equal(semantic.symbolTable.Event.fields.value.dataType, type);
                assert.deepEqual(semantic.symbolTable.Event.fields.value.defaultValue, { type: 'STRING', value });
            }
            for (const value of invalid) {
                const declaration = `value ${type} DEFAULT ${JSON.stringify(value)}`;
                const result = analyze(declaration);
                assert.equal(result.valid, false, declaration);
                const diagnostic = result.diagnostics.find(value => value.code === 'SEM038');
                assert(diagnostic, declaration);
                const literal = Lexer.tokenize('ENTITY Event\nid INT PRIMARY KEY\n' + declaration).find(token => token.type === 'STRING_LITERAL');
                assert.deepEqual([diagnostic.line, diagnostic.column, diagnostic.endLine, diagnostic.endColumn],
                    [literal.line, literal.column, literal.endLine, literal.endColumn]);
            }
        }
    });
    await test('C: keys, numeric/length modifiers, non-string defaults and duplicate modifiers retain existing diagnostics', () => {
        for (const type of ['DATE', 'TIMESTAMP']) {
            for (const [modifier, code] of [['PRIMARY KEY', 'SEM010'], ['MIN 1', 'SEM015'], ['MAX 1', 'SEM015'],
                ['MIN_LENGTH 1', 'SEM016'], ['MAX_LENGTH 1', 'SEM016'], ['DEFAULT 123', 'SEM021'],
                ['DEFAULT TRUE', 'SEM021'], ['DEFAULT FALSE', 'SEM021'], ['REQUIRED REQUIRED', 'SEM009'],
                ['UNIQUE UNIQUE', 'SEM009'], ['DEFAULT "2026-10-05" DEFAULT "2026-10-05"', 'SEM020']]) {
                const semantic = modifier === 'PRIMARY KEY'
                    ? Semantic.analyze(parse(`ENTITY Event\nvalue ${type} PRIMARY KEY`)) : analyze(`value ${type} ${modifier}`);
                assert.equal(semantic.valid, false, type + ' ' + modifier);
                assert(semantic.diagnostics.some(diagnostic => diagnostic.code === (modifier === 'PRIMARY KEY' ? 'SEM011' : code)));
            }
            for (const dynamic of ['CURRENT_TIMESTAMP', 'NOW()', '"2026-10-05" ON UPDATE CURRENT_TIMESTAMP']) {
                assert.throws(() => parse(`ENTITY Event\nvalue ${type} DEFAULT ${dynamic}`));
            }
        }
    });
    await test('D: explicit IR type validation rejects unknown datatypes and forged temporal defaults/modifiers/keys before targets', () => {
        const ast = parse(eventSource), semantic = Semantic.analyze(ast), ir = IR.generate(ast, semantic);
        assert.equal(IR.validate(ir).valid, true);
        for (const field of ast.entities[0].fields.filter(field => ['DATE', 'TIMESTAMP'].includes(field.dataType))) {
            const instruction = ir.instructions.find(instruction => instruction.field === field.name);
            assert.equal(instruction.dataType, field.dataType);
            assert.deepEqual(instruction.defaultValue, field.defaultValue);
        }
        const mutations = [
            field => { field.dataType = 'UNKNOWN'; }, field => { field.dataType = 'DATETIME'; },
            field => { field.dataType = 'DATE'; field.defaultValue = { type: 'STRING', value: '2026-02-30' }; },
            field => { field.dataType = 'TIMESTAMP'; field.defaultValue = { type: 'STRING', value: '2040-01-01T00:00:00Z' }; },
            field => { field.dataType = 'DATE'; field.defaultValue = { type: 'NUMBER', value: 123 }; },
            field => { field.dataType = 'TIMESTAMP'; field.defaultValue = { type: 'BOOLEAN', value: true }; },
            field => { field.dataType = 'DATE'; field.constraints = ['PRIMARY_KEY']; },
            field => { field.dataType = 'TIMESTAMP'; field.validations = [{ type: 'MIN', value: 1 }]; },
            field => { field.dataType = 'DATE'; field.validations = [{ type: 'MAX_LENGTH', value: 10 }]; }
        ];
        for (const mutate of mutations) {
            const forged = clone(ir), instruction = forged.instructions.find(instruction => instruction.field === 'eventDate');
            mutate(instruction);
            assert.equal(IR.validate(forged).valid, false, JSON.stringify(instruction));
            assert.throws(() => Codegen.generate(forged, false));
        }
    });
    await test('D: optimizer preserves temporal fields/defaults/constraints and distinguishes conflicting defaults', () => {
        const ast = parse(eventSource), semantic = Semantic.analyze(ast), ir = IR.generate(ast, semantic);
        const optimized = Optimizer.optimize(ir);
        assert.equal(IR.validate(optimized.ir).valid, true);
        assert.deepEqual(optimized.ir.instructions, ir.instructions);
        for (const type of ['DATE', 'TIMESTAMP']) {
            const first = { op: 'ADD_FIELD', entity: 'Event', field: 'when', dataType: type,
                constraints: ['UNIQUE', 'REQUIRED'], validations: [], defaultValue: { type: 'STRING',
                    value: type === 'DATE' ? '2026-10-05' : '2026-10-05T12:30:00Z' } };
            const second = clone(first); second.defaultValue.value = type === 'DATE' ? '2026-10-06' : '2026-10-05T12:30:01Z';
            const result = Optimizer.optimize({ type: 'PROGRAM', instructions: [{ op: 'CREATE_ENTITY', entity: 'Event' }, first, second] });
            assert.equal(result.ir.instructions.filter(instruction => instruction.op === 'ADD_FIELD').length, 2);
            assert(result.warnings.some(warning => warning.code === 'WRN002'));
            for (const instruction of result.ir.instructions.filter(instruction => instruction.op === 'ADD_FIELD')) {
                assert.equal(instruction.dataType, type);
                assert.deepEqual(instruction.constraints, ['REQUIRED', 'UNIQUE']);
                assert.deepEqual(instruction.validations, []);
                assert.equal(instruction.defaultValue.type, 'STRING');
            }
        }
    });

    const files = compileProject(eventSource);
    await test('E: SQL uses true DATE/TIMESTAMP columns, explicit nullability and UTC static defaults', () => {
        const sql = content(files, 'database/schema.sql');
        assert.match(sql, /eventDate DATE NOT NULL/);
        assert.match(sql, /createdAt TIMESTAMP NOT NULL/);
        assert.match(sql, /optionalDate DATE,/);
        assert.match(sql, /optionalStamp TIMESTAMP NULL/);
        assert.match(sql, /defaultDate DATE DEFAULT '2026-01-01'/);
        assert.match(sql, /defaultStamp TIMESTAMP NULL DEFAULT '2026-10-05 12:30:00'/);
        assert(!sql.includes('DATETIME'));
        assert(!sql.includes('TIMESTAMP('));
        assert(sql.indexOf("SET SESSION time_zone = '+00:00'") < sql.indexOf('CREATE TABLE'));
        const unique = content(compileProject('ENTITY Event\nid INT PRIMARY KEY\nd DATE REQUIRED UNIQUE DEFAULT "1000-01-01"\nt TIMESTAMP REQUIRED UNIQUE DEFAULT "2038-01-19T03:14:07Z"'), 'database/schema.sql');
        assert.match(unique, /d DATE NOT NULL DEFAULT '1000-01-01' UNIQUE/);
        assert.match(unique, /t TIMESTAMP NOT NULL DEFAULT '2038-01-19 03:14:07' UNIQUE/);
        for (const file of files.filter(file => file.path.endsWith('.js'))) assert.doesNotThrow(() => new vm.Script(file.content));
    });
    await test('F/I: real generated POST/PUT accept valid boundaries/nulls, echo canonical input, preserve body and omit DB defaults', async () => {
        await withHttp(files, 'Event', async (runtime, request) => {
            for (const eventDate of dateValid) {
                const response = await request('POST', '', { ...publicBody, eventDate, optionalDate: null, optionalStamp: null });
                assert.equal(response.status, 201);
                assert.deepEqual(response.json.data, { ...publicBody, eventDate, optionalDate: null, optionalStamp: null, id: 7 });
                assert.equal(Object.hasOwn(response.json.data, 'defaultDate'), false);
                assert.equal(Object.hasOwn(response.json.data, 'defaultStamp'), false);
                assert.equal(runtime.calls.at(-1).values[0].createdAt, '2026-10-05 12:30:00');
                assert.equal(runtime.calls.at(-1).values[0].eventDate, eventDate);
            }
            for (const createdAt of timestampValid) {
                const body = { ...publicBody, createdAt };
                const response = await request('POST', '', body);
                assert.equal(response.status, 201);
                assert.equal(response.json.data.createdAt, createdAt);
                assert.equal(runtime.calls.at(-1).values[0].createdAt, createdAt.replace('T', ' ').slice(0, -1));
                const update = await request('PUT', '/7', { createdAt });
                assert.equal(update.status, 200);
                assert.equal(update.json.data.createdAt, publicBody.createdAt);
                assert.equal(runtime.calls.at(-2).values[0].createdAt, createdAt.replace('T', ' ').slice(0, -1));
            }
            const body = Object.freeze({ ...publicBody, optionalDate: null, optionalStamp: null });
            const req = { body }, res = responseMock();
            await runtime.controller.createEvent(req, res);
            assert.equal(res.code, 201);
            assert.equal(req.body, body);
            assert.deepEqual(body, { ...publicBody, optionalDate: null, optionalStamp: null });
            assert.notEqual(runtime.calls.at(-1).values[0], body);
        });
    });
    await test('F: invalid HTTP temporal body values cause zero model and SQL calls for POST and PUT', async () => {
        await withHttp(files, 'Event', async (runtime, request) => {
            for (const [field, invalid] of [['eventDate', dateInvalid], ['createdAt', timestampInvalid]]) {
                for (const value of [...invalid, 123, 0, true, false, [], {}, null]) for (const method of ['POST', 'PUT']) {
                    runtime.calls.length = 0; runtime.modelCalls.length = 0;
                    const response = await request(method, method === 'POST' ? '' : '/7', { ...publicBody, [field]: value });
                    assert.equal(response.status, 400, `${method} ${field} ${JSON.stringify(value)}`);
                    assert.equal(response.json.success, false);
                    assert.equal(typeof response.json.error, 'string');
                    assert.equal(runtime.calls.length, 0);
                    assert.equal(runtime.modelCalls.length, 0);
                }
            }
            for (const field of ['eventDate', 'createdAt']) {
                runtime.calls.length = 0; runtime.modelCalls.length = 0;
                const body = { ...publicBody }; delete body[field];
                const response = await request('POST', '', body);
                assert.equal(response.status, 400);
                assert.equal(runtime.modelCalls.length, 0);
                assert.equal(runtime.calls.length, 0);
                const req = { body: { ...publicBody, [field]: new Date('2026-10-05T12:30:00Z') } }, res = responseMock();
                await runtime.controller.createEvent(req, res);
                assert.equal(res.code, 400);
                assert.equal(runtime.calls.length, 0);
                assert.equal(runtime.modelCalls.length, 0);
            }
        });
    });
    await test('F/I: direct generated models copy/convert canonical temporal writes and reject malformed temporal values before SQL', async () => {
        const r = runtime(files), body = Object.freeze({ ...publicBody, optionalDate: null, optionalStamp: null });
        const created = await r.Model.create(body);
        assert.deepEqual(created, { ...body, id: 7 });
        assert.equal(body.createdAt, publicBody.createdAt);
        assert.notEqual(r.calls[0].values[0], body);
        assert.deepEqual(r.calls[0].values[0], { ...body, createdAt: '2026-10-05 12:30:00' });
        r.calls.length = 0;
        await r.Model.update(7, body);
        assert.deepEqual(r.calls[0].values, [{ ...body, createdAt: '2026-10-05 12:30:00' }, 7]);
        assert.equal(body.createdAt, publicBody.createdAt);
        for (const [field, invalid] of [['eventDate', dateInvalid], ['createdAt', timestampInvalid]]) {
            for (const value of [...invalid, 123, true, {}, new Date('2026-10-05T12:30:00Z')]) for (const method of ['create', 'update']) {
                r.calls.length = 0;
                await assert.rejects(() => method === 'create' ? r.Model.create({ ...publicBody, [field]: value }) : r.Model.update(7, { [field]: value }));
                assert.equal(r.calls.length, 0);
            }
        }
    });
    await test('G: equality filters stay canonical until private SQL binding and sorting uses the existing whitelist', async () => {
        const r = runtime(files);
        for (const [field, valid] of [['eventDate', dateValid], ['createdAt', timestampValid]]) for (const value of valid) {
            const options = r.Model.parseQuery({ [field]: value, sort: field, order: 'desc' });
            assert.equal(options.filters[field], value);
            r.calls.length = 0; await r.Model.findAll(options); await r.Model.countFiltered(options);
            const bound = field === 'createdAt' ? value.replace('T', ' ').slice(0, -1) : value;
            assert.deepEqual(r.calls.map(call => call.values), [[bound], [bound]]);
            assert.match(r.calls[0].sql, new RegExp('WHERE ' + field + ' = \\? ORDER BY ' + field + ' DESC$'));
        }
        await withHttp(files, 'Event', async (r, request) => {
            for (const [field, invalid] of [['eventDate', dateInvalid], ['createdAt', timestampInvalid]]) {
                for (const value of invalid) {
                    r.calls.length = 0;
                    const response = await request('GET', '?' + new URLSearchParams({ [field]: value }));
                    assert.equal(response.status, 400, field + '=' + value);
                    assert.equal(r.calls.length, 0);
                    assert.equal(typeof response.json.error, 'string');
                }
            }
            for (const query of ['eventDate=2026-10-05&eventDate=2026-10-06', 'createdAt=x&createdAt=y', 'sort=createdAt%3BDROP', 'eventDate%5B%5D=x']) {
                r.calls.length = 0; const response = await request('GET', '?' + query);
                assert.equal(response.status, 400); assert.equal(r.calls.length, 0);
            }
            r.calls.length = 0;
            const response = await request('GET', '?' + new URLSearchParams({ ...publicBody, sort: 'createdAt', page: '1', limit: '2' }));
            assert.equal(response.status, 200);
            assert.deepEqual(response.json, { success: true, data: [publicRow] });
            assert.deepEqual(r.calls[0].values, ['2026-10-05', '2026-10-05 12:30:00', 2, 0]);
            assert.deepEqual(r.calls[1].values, ['2026-10-05', '2026-10-05 12:30:00']);
        });
    });
    await test('H: collection, item and update reread normalize mysql2 strings without mutating rows or STRING values', async () => {
        await withHttp(files, 'Event', async (r, request) => {
            for (const [method, suffix, body] of [['GET', '', undefined], ['GET', '/7', undefined], ['PUT', '/7', { optionalStamp: null }]]) {
                const response = await request(method, suffix, body);
                assert.equal(response.status, 200);
                assert.deepEqual(response.json.data, suffix === '' ? [publicRow] : publicRow);
                assert.deepEqual(r.state.rows, [wireRow]);
                assert.equal(response.json.data.label || response.json.data[0].label, '2026-10-05 12:30:00');
            }
            r.state.rows = [];
            const missing = await request('GET', '/7'); assert.equal(missing.status, 404);
            const collection = await request('GET'); assert.deepEqual(collection.json, { success: true, data: [] });
        });
    });
    await test('H: all four relationship controller/model reads normalize target temporal fields even with a non-temporal source', async () => {
        for (const kind of ['ONE_TO_MANY', 'MANY_TO_ONE', 'ONE_TO_ONE', 'MANY_TO_MANY']) {
            const source = 'ENTITY Parent\nid INT PRIMARY KEY\n' + eventSource + '\nRELATION Parent events Event ' + kind;
            const related = compileProject(source), many = ['ONE_TO_MANY', 'MANY_TO_MANY'].includes(kind);
            await withHttp(related, 'Parent', async (r, request) => {
                const method = many ? 'getEvents' : 'getEvent';
                const direct = await r.Model[method](7);
                assert.deepEqual(direct, many ? [publicRow] : publicRow);
                const response = await request('GET', '/7/' + (many ? 'events' : 'event'));
                assert.equal(response.status, 200);
                assert.deepEqual(response.json, { success: true, data: many ? [publicRow] : publicRow });
                assert.deepEqual(r.state.rows, [wireRow]);
                assert(r.calls.every(call => JSON.stringify(call.values) === '[7]' || JSON.stringify(call.values) === '["7"]'));
                r.state.rows = [];
                const empty = await request('GET', '/7/' + (many ? 'events' : 'event'));
                assert.equal(empty.status, many ? 200 : 404);
            });
        }
    });
    await test('F/H/I: prototype-sensitive declared temporal columns survive writes, read normalization and OpenAPI', async () => {
        const prototypeFiles = compileProject('ENTITY Event\nid INT PRIMARY KEY\n__proto__ DATE\nconstructor TIMESTAMP');
        const body = JSON.parse('{"__proto__":"2026-10-05","constructor":"2026-10-05T12:30:00Z"}');
        const r = runtime(prototypeFiles);
        const result = await r.Model.create(Object.freeze(body));
        assert(Object.hasOwn(result, '__proto__'));
        assert.equal(result.__proto__, '2026-10-05');
        assert.equal(result.constructor, '2026-10-05T12:30:00Z');
        assert(Object.hasOwn(r.calls[0].values[0], '__proto__'));
        assert.equal(r.calls[0].values[0].constructor, '2026-10-05 12:30:00');
        assert.equal(Object.getPrototypeOf(r.calls[0].values[0]), Object.prototype);
        assert.equal(body.constructor, '2026-10-05T12:30:00Z');
        r.state.rows = [JSON.parse('{"id":7,"__proto__":"2026-10-05","constructor":"2026-10-05 12:30:00"}')];
        const row = await r.Model.findById(7);
        assert.equal(row.constructor, publicBody.createdAt); assert(Object.hasOwn(row, '__proto__'));
        const doc = JSON.parse(content(prototypeFiles, 'swagger.json'));
        assert(Object.hasOwn(doc.components.schemas['Event.Read'].properties, '__proto__'));
        assert.equal(doc.components.schemas['Event.Read'].properties.constructor.format, 'date-time');
        const req = { body }, res = responseMock();
        await r.controller.createEvent(req, res);
        assert.equal(res.code, 201);
        assert(Object.hasOwn(res.body.data, '__proto__'));
        assert.equal(res.body.data.constructor, publicBody.createdAt);
        assert.equal(req.body, body);
        const options = r.Model.parseQuery(body), filter = r.Model.filterQuery(options);
        assert.deepEqual(filter.values, ['2026-10-05', '2026-10-05 12:30:00']);
    });
    await test('J: Create/Update/Read and equality-filter OpenAPI declare strict canonical temporal formats/defaults', () => {
        const doc = JSON.parse(content(files, 'swagger.json'));
        for (const schemaName of ['Event', 'Event.Create', 'Event.Update', 'Event.Read']) {
            const properties = doc.components.schemas[schemaName].properties;
            for (const [name, type, valid, invalid] of [['eventDate', 'date', dateValid, dateInvalid],
                ['createdAt', 'date-time', timestampValid, timestampInvalid]]) {
                const property = properties[name];
                assert.equal(property.type, 'string'); assert.equal(property.format, type);
                assert.equal(typeof property.pattern, 'string');
                assert.equal(typeof property.description, 'string');
                const pattern = new RegExp(property.pattern);
                for (const value of valid) assert(pattern.test(value));
                // Calendar/range validity remains runtime-enforced; patterns prove only the canonical shape.
                for (const value of invalid.filter(value => value.includes('/') || value.includes('+') || value.includes('.') || /[tz]/.test(value) || value.includes(' '))) assert.equal(pattern.test(value), false);
            }
            assert.equal(properties.defaultDate.default, '2026-01-01');
            assert.equal(properties.defaultStamp.default, '2026-10-05T12:30:00Z');
            assert.match(properties.createdAt.description, /UTC/);
            assert.match(properties.createdAt.description, /second|fraction/i);
        }
        const params = Object.fromEntries(doc.paths['/events'].get.parameters.map(parameter => [parameter.name, parameter]));
        assert.equal(params.eventDate.schema.format, 'date');
        assert.equal(params.createdAt.schema.format, 'date-time');
        assert.equal(params.createdAt.schema.pattern, doc.components.schemas['Event.Read'].properties.createdAt.pattern);
        assert(params.sort.schema.enum.includes('eventDate')); assert(params.sort.schema.enum.includes('createdAt'));
        assert.deepEqual(Object.keys(doc.paths['/events'].post.responses).sort(), ['201', '400', '409', '500', '503']);
        assert.deepEqual(Object.keys(doc.paths['/events/{id}'].put.responses).sort(), ['200', '400', '404', '409', '500', '503']);
    });
    await test('G06: recognized database rejections retain safe existing error classification', async () => {
        await withHttp(files, 'Event', async (r, request) => {
            for (const [code, status] of [['ER_TRUNCATED_WRONG_VALUE', 400], ['ER_DUP_ENTRY', 409], ['ER_LOCK_WAIT_TIMEOUT', 503], ['PRIVATE_UNKNOWN_ERROR', 500]]) {
                r.state.error = Object.assign(new Error('secret SQL driver text'), { code });
                const response = await request('POST', '', publicBody);
                assert.equal(response.status, status, code);
                assert.equal(response.json.success, false);
                assert.equal(JSON.stringify(response.json).includes('secret'), false);
                assert.equal(JSON.stringify(response.json).includes(code), false);
            }
        });
    });
    await test('K: generated mysql2 pool config waits for UTC initialization on query/execute/getConnection and destroys failures', async () => {
        const source = content(files, 'config/db.js');
        const pending = [], events = [];
        let options, failure = null;
        const connections = [];
        const rawPool = {
            getConnection: async () => {
                const id = connections.length;
                const connection = {
                    query: async (sql, values) => {
                        if (String(sql).includes('SET SESSION time_zone')) {
                            events.push(['init-start', id, sql]);
                            await new Promise(resolve => pending.push(resolve));
                            if (failure) throw failure;
                            events.push(['init-done', id]); return [[], []];
                        }
                        events.push(['query', id, sql, values]); return [[{ id }], []];
                    },
                    execute: async (sql, values) => { events.push(['execute', id, sql, values]); return [[{ id }], []]; },
                    release: () => events.push(['release', id]), destroy: () => events.push(['destroy', id])
                };
                connections.push(connection); return connection;
            },
            query: async () => { throw new Error('Unsafe raw pool.query bypass'); },
            execute: async () => { throw new Error('Unsafe raw pool.execute bypass'); },
            end: async () => { events.push(['end']); }
        };
        const pool = load(source, dependency => { assert.equal(dependency, 'mysql2/promise'); return { createPool: config => { options = config; return rawPool; } }; });
        assert.equal(options.timezone, 'Z');
        assert.deepEqual(options.dateStrings, ['DATE', 'TIMESTAMP']);
        for (const method of ['query', 'execute', 'getConnection']) {
            events.length = 0;
            const operation = method === 'getConnection' ? pool.getConnection() : pool[method]('SELECT ?', [7]);
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(events.map(event => event[0]), ['init-start']);
            assert.equal(events[0][2], "SET SESSION time_zone = '+00:00'");
            pending.shift()(); const value = await operation;
            if (method === 'getConnection') {
                assert.deepEqual(events.map(event => event[0]), ['init-start', 'init-done']);
                assert.equal(value, connections.at(-1)); value.release();
            } else {
                assert.deepEqual(events.map(event => event[0]), ['init-start', 'init-done', method, 'release']);
                assert.deepEqual(events[2].slice(2), ['SELECT ?', [7]]);
            }
        }
        for (const method of ['query', 'execute', 'getConnection']) {
            failure = Object.assign(new Error('Initialization denied'), { code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' });
            events.length = 0;
            const operation = method === 'getConnection' ? pool.getConnection() : pool[method]('SELECT ?', [7]);
            const rejected = assert.rejects(operation, error => error === failure);
            await new Promise(resolve => setImmediate(resolve)); pending.shift()(); await rejected;
            assert.deepEqual(events.map(event => event[0]), ['init-start', 'destroy']);
            failure = null;
        }
        // Successful operation after failed initialization receives a fresh initialization.
        events.length = 0;
        const operation = pool.query('SELECT 1');
        await new Promise(resolve => setImmediate(resolve)); pending.shift()(); await operation;
        assert.equal(events[0][0], 'init-start');
        await pool.end(); assert.equal(events.at(-1)[0], 'end');
    });
    await test('K: concurrent acquisitions cannot issue application SQL early; reused sessions are reset after timezone alteration', async () => {
        const source = content(files, 'config/db.js'), events = [], pending = [];
        let timezone = '+05:30', failQuery = false;
        const connection = {
            query: async (sql, values) => {
                if (sql === "SET SESSION time_zone = '+00:00'") {
                    events.push('init-start'); await new Promise(resolve => pending.push(resolve));
                    timezone = '+00:00'; events.push('init-done'); return [[], []];
                }
                events.push('application'); assert.equal(timezone, '+00:00');
                if (failQuery) throw new Error('application failure');
                return [[{ timezone }], []];
            }, execute: async () => { throw new Error('Unused execute'); },
            release: () => events.push('release'), destroy: () => events.push('destroy')
        };
        const pool = load(source, () => ({ createPool: () => ({ getConnection: async () => connection,
            query: async () => { throw new Error('Raw pool bypass'); }, execute: async () => {}, end: async () => {} }) }));
        const first = pool.query('SELECT 1'), second = pool.query('SELECT 2');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, ['init-start', 'init-start']);
        pending.shift()(); await first;
        assert.deepEqual(events, ['init-start', 'init-start', 'init-done', 'application', 'release']);
        pending.shift()(); await second;
        assert.deepEqual(events.slice(-3), ['init-done', 'application', 'release']);
        // The same physical connection may have been changed by an outside administrative checkout.
        timezone = '-07:00'; events.length = 0;
        const next = pool.query('SELECT 3');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(timezone, '-07:00'); assert.deepEqual(events, ['init-start']);
        pending.shift()(); const [rows] = await next;
        assert.equal(rows[0].timezone, '+00:00');
        assert.deepEqual(events, ['init-start', 'init-done', 'application', 'release']);
        failQuery = true; events.length = 0;
        const failed = pool.query('SELECT fail');
        const rejected = assert.rejects(failed, /application failure/);
        await new Promise(resolve => setImmediate(resolve)); pending.shift()(); await rejected;
        assert(events.includes('destroy')); assert.equal(events.at(-1), 'release');
    });
    await test('K: UTC initialization preserves own prototype-sensitive columns through the mysql2 row-array wrapper', async () => {
        const prototypeFiles = compileProject('ENTITY Event\nid INT PRIMARY KEY\n__proto__ DATE\nconstructor TIMESTAMP');
        const events = [];
        const connection = {
            query: async (options, values) => {
                if (typeof options === 'string' && options.startsWith('SET SESSION')) { events.push('UTC'); return [[], []]; }
                events.push('query'); assert.equal(options.rowsAsArray, true); assert.equal(options.disableEval, true);
                return [[['2026-10-05', '2026-10-05 12:30:00']], [{ name: '__proto__' }, { name: 'constructor' }]];
            }, release: () => events.push('release'), destroy: () => events.push('destroy')
        };
        const pool = load(content(prototypeFiles, 'config/db.js'), () => ({ createPool: () => ({
            getConnection: async () => connection, query: async () => { throw new Error('Raw bypass'); }, execute: async () => {}, end: async () => {}
        }) }));
        const [rows] = await pool.query('SELECT * FROM Event');
        assert.deepEqual(events, ['UTC', 'query', 'release']);
        assert(Object.hasOwn(rows[0], '__proto__')); assert.equal(rows[0].__proto__, '2026-10-05');
        assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
    });
    await test('K: Node TZ variants produce identical schema/defaults, validation, private writes, filters and public reads', () => {
        const runs = [];
        for (const timezone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
            const result = spawnSync(process.execPath, [__filename, '--timezone-probe'], {
                cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: timezone }, encoding: 'utf8', windowsHide: true
            });
            assert.equal(result.status, 0, timezone + ': ' + result.stderr);
            const snapshot = JSON.parse(result.stdout);
            assert.equal(snapshot.body.eventDate, '2026-10-05'); assert.equal(snapshot.body.createdAt, publicBody.createdAt);
            assert.equal(snapshot.write.createdAt, '2026-10-05 12:30:00');
            assert.equal(snapshot.filter.createdAt, '2026-10-05 12:30:00');
            assert.deepEqual(snapshot.read, publicRow);
            assert.deepEqual(snapshot.invalid, [false, false]);
            runs.push(snapshot);
        }
        for (const snapshot of runs.slice(1)) assert.deepEqual(snapshot, runs[0]);
    });
    await test('L: all existing non-temporal generated artifacts and pre-codegen phases retain approved-main semantics and bytes', () => {
        const root = path.resolve(__dirname, '..'), baselineCommit = '9ef005e18e875bdd83e3b73665c931588aa01ccf';
        const original = name => load(execFileSync('git', ['show', baselineCommit + ':' + name],
            { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 }), createRequire(path.join(root, name)));
        const oldGenerator = original('src/codegen/codegen.js'), oldLexer = original('src/lexer/lexer.js');
        const oldParser = original('src/parser/parser.js'), oldSemantic = original('src/semantic/analyzer.js');
        const oldIR = original('src/ir/generator.js'), oldOptimizer = original('src/optimizer/optimizer.js');
        const samples = fs.readdirSync(path.join(root, 'samples')).filter(name => name.endsWith('.apiforge'));
        let checked = 0;
        for (const name of samples) {
            const source = fs.readFileSync(path.join(root, 'samples', name), 'utf8');
            if (/\b(DATE|TIMESTAMP)\b/.test(source)) continue;
            const tokens = Lexer.tokenize(source), ast = Parser.parse(tokens), semantic = Semantic.analyze(ast);
            if (!semantic.valid) continue;
            const ir = IR.generate(ast, semantic), optimized = Optimizer.optimize(ir).ir;
            const oldTokens = oldLexer.tokenize(source), oldAst = oldParser.parse(oldTokens), oldResult = oldSemantic.analyze(oldAst);
            const oldIntermediate = oldIR.generate(oldAst, oldResult), oldOptimized = oldOptimizer.optimize(oldIntermediate).ir;
            assert.deepEqual(tokens, oldTokens, name);
            assert.deepEqual(ast, oldAst, name);
            assert.deepEqual(semantic, oldResult, name);
            assert.deepEqual(ir, oldIntermediate, name);
            assert.deepEqual(optimized, oldOptimized, name);
            assert.equal(IR.validate(ir).valid, true, name);
            assert.deepEqual(Codegen.generate(optimized, false).files, oldGenerator.generate(optimized, false).files, name);
            checked++;
        }
        assert(checked >= 3, 'Expected representative existing samples');
    });
    console.log(`G24 DATE/TIMESTAMP: ${groups} test groups passed; ${assertions} assertions passed. Offline deterministic evidence; live MySQL is separate.`);
}

async function timezoneProbe() {
    const files = compileProject(eventSource), r = runtime(files);
    await r.Model.create(publicBody);
    const ast = parse(eventSource), ir = IR.generate(ast, Semantic.analyze(ast));
    const invalid = ['value DATE DEFAULT "2026-02-30"', 'value TIMESTAMP DEFAULT "2038-01-19T03:14:08Z"'].map(declaration => analyze(declaration).valid);
    process.stdout.write(JSON.stringify({ body: publicBody, write: r.calls[0].values[0],
        filter: Object.fromEntries(['eventDate', 'createdAt'].map((field, index) => [field, r.Model.filterQuery(r.Model.parseQuery(publicBody)).values[index]])),
        read: await r.Model.findById(7), invalid, sql: content(files, 'database/schema.sql'), ir }));
}
if (process.argv.includes('--timezone-probe')) timezoneProbe().catch(error => { console.error(error); process.exitCode = 1; });
else main().catch(error => { console.error(error); process.exitCode = 1; });
