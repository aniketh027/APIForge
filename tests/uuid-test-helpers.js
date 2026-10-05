const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const Codegen = require('../src/codegen/codegen');
const { compileProject } = require('./generated-backend-test-helpers');

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER = '00000000-0000-0000-0000-000000000000';
const valid = [UUID, OTHER, 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '12345678-1234-1234-1234-123456789abc', '01890a5d-ac96-7cc0-8f2b-446655440000'];
const invalid = [UUID.toUpperCase(), UUID + '\n', UUID + ' ', ' ' + UUID, '{' + UUID + '}',
    'urn:uuid:' + UUID, UUID.replaceAll('-', ''), UUID.slice(1), UUID.replace('5', 'g'), '', 'null',
    5, true, {}, [], undefined];
const source = `ENTITY User
uid UUID PRIMARY KEY
email STRING REQUIRED UNIQUE
token UUID UNIQUE
requiredUuid UUID REQUIRED
fixed UUID DEFAULT "${UUID}"
label STRING
active BOOLEAN
ENTITY Profile
id UUID PRIMARY KEY
token UUID
ENTITY Post
id INT PRIMARY KEY
token UUID
ENTITY Company
id UUID PRIMARY KEY
token UUID
ENTITY Group
code UUID PRIMARY KEY
token UUID
ENTITY Member
id INT PRIMARY KEY
RELATION User HAS_PROFILE Profile ONE_TO_ONE
RELATION User HAS_POST Post ONE_TO_MANY
RELATION User WORKS_FOR Company MANY_TO_ONE
RELATION User JOINS Group MANY_TO_MANY
RELATION Member EMPLOYED_BY Company MANY_TO_ONE`;
const body = { email: 'a@example.com', requiredUuid: UUID };
const row = { uid: UUID, ...body, token: null, fixed: UUID, label: 'NOT-A-UUID', active: 1 };
const content = (files, name) => {
    const file = files.find(file => file.path === name);
    if (!file) throw new Error('Missing generated file: ' + name);
    return file.content;
};
function load(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
function runtime(files, name = 'User') {
    const calls = [], modelCalls = [];
    const state = { rows: [{ ...row }], error: null, generated: 0, generatedValues: [] };
    const pool = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (state.error) throw state.error;
        if (/^INSERT/.test(sql)) return [{ insertId: 77, affectedRows: 1 }];
        if (/^(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
        if (/COUNT\(\*\)/.test(sql)) return [[{ total: state.rows.length }]];
        return [state.rows];
    } };
    const Model = load(content(files, 'models/' + name + '.js'), dependency => {
        if (dependency === 'crypto') return { randomUUID() {
            state.generated++; const value = crypto.randomUUID(); state.generatedValues.push(value); return value;
        } };
        if (dependency === '../config/db') return pool;
        throw new Error('Unexpected model dependency: ' + dependency);
    });
    const tracked = new Proxy(Model, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        if (['create', 'update', 'delete', 'findById', 'findAll', 'countFiltered'].includes(key) || /^(get|add|remove)[A-Z]/.test(key)) {
            return (...args) => { modelCalls.push({ method: key, args }); return value.apply(target, args); };
        }
        return value.bind(target);
    } });
    const lowerName = name[0].toLowerCase() + name.slice(1);
    const controller = load(content(files, 'controllers/' + lowerName + 'Controller.js'), () => tracked);
    return { Model, controller, pool, calls, modelCalls, state, lowerName };
}
async function withHttp(files, name, run) {
    const r = runtime(files, name);
    const route = load(content(files, 'routes/' + r.lowerName + 'Routes.js'), dep => dep === 'express' ? express : r.controller);
    const app = express(); app.use(express.json()); app.use('/' + Codegen.pluralize(name), route);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/${Codegen.pluralize(name)}`;
    const request = async (method, suffix = '', data) => {
        const response = await fetch(base + suffix, { method, headers: { 'content-type': 'application/json' },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        return { status: response.status, json: await response.json(), headers: response.headers };
    };
    try { await run(r, request); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { UUID, OTHER, valid, invalid, source, body, row, content, load, runtime, withHttp, compileProject };
