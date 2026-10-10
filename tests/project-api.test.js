'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { fork, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const express = require('express');
const { createProjectApi, TOKEN_HEADER, HTTP_BODY_LIMIT } = require('../src/api/project-api');
const { ProjectStoreError } = require('../src/project-store/errors');
const results = [], servers = new Set(), children = new Set();
let fixtures, DatabaseSync;
class NotRun extends Error {}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function test(name, action) {
    const started = Date.now();
    try { await action(); results.push({ name, status: 'PASS', ms: Date.now() - started }); }
    catch (error) {
        if (error instanceof NotRun) results.push({ name, status: 'NOT RUN', reason: error.message });
        else { results.push({ name, status: 'FAIL', error: error.stack }); process.exitCode = 1; }
    }
    console.log(results.at(-1).status + ' ' + name);
    if (results.at(-1).status === 'FAIL') console.error(results.at(-1).error);
}
function notRun(name, reason) { results.push({ name, status: 'NOT RUN', reason }); console.log('NOT RUN ' + name + ': ' + reason); }
async function serve(options = {}, host = '127.0.0.1', configure) {
    const controller = createProjectApi(options), app = express();
    if (configure) configure(app);
    app.use('/api/projects', controller.router);
    app.get('/browser-test', (req, res) => res.type('html').send('<!doctype html><title>M2B fixture</title>'));
    app.use((err, req, res, next) => { throw new Error('Project errors escaped into global handler'); });
    const server = app.listen(0, host);
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const value = { server, controller, port: server.address().port, host: host === '0.0.0.0' ? '127.0.0.1' : host };
    servers.add(value);
    return value;
}
async function stop(value) {
    await value.controller.shutdown();
    await new Promise(resolve => value.server.close(resolve));
    servers.delete(value);
}
function request(server, method, url, { body, raw, headers = {}, hostname, chunked } = {}) {
    const bytes = raw !== undefined ? Buffer.from(raw) : body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const merged = { host: (server.host === '::1' ? '[::1]' : server.host) + ':' + server.port, ...headers };
    if (bytes) {
        if (!Object.hasOwn(merged, 'content-type')) merged['content-type'] = 'application/json';
        if (!chunked) merged['content-length'] = bytes.length;
    }
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: hostname || server.host, port: server.port, path: url, method, headers: merged, agent: false }, res => {
            let text = '';
            res.on('data', data => { text += data; });
            res.on('end', () => {
                let json; try { json = JSON.parse(text); } catch {}
                resolve({ status: res.statusCode, headers: res.headers, json, text });
            });
        });
        req.setTimeout(45000, () => req.destroy(new Error('HTTP fixture timeout')));
        req.once('error', reject);
        if (bytes) req.write(bytes);
        req.end();
    });
}
function error(response, status, code) {
    assert.equal(response.status, status);
    assert.deepEqual(Object.keys(response.json).sort(), ['error', 'success']);
    assert.equal(response.json.success, false); assert.equal(response.json.error.code, code);
    assert.deepEqual(Object.keys(response.json.error).sort(), ['code', 'message']);
    assert.ok(!/C:\\|SELECT |INSERT |sqlite3|S-1-5|PRIVATE_SECRET_NATIVE|stack/i.test(response.text));
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
}
async function session(server) {
    const response = await request(server, 'GET', '/api/projects/session');
    assert.equal(response.status, 200); assert.equal(response.json.success, true);
    assert.match(response.json.data.token, /^[0-9a-f]{64}$/);
    assert.equal(response.json.data.tokenHeader, TOKEN_HEADER);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['set-cookie'], undefined);
    return response.json.data.token;
}
const auth = token => ({ [TOKEN_HEADER]: token });
function isolated(name) {
    const root = path.join(fixtures, name + '-' + crypto.randomUUID());
    const api = require('../src/project-store');
    const storeApi = { initializeProjectStore: () => api.initializeProjectStore({ root }), openProjectStore: () => api.openProjectStore({ root }) };
    return { root, options: { env: { APIFORGE_PROJECT_API: '1' }, storeApi } };
}
function inventory(root) {
    if (!fs.existsSync(root)) return null;
    return fs.readdirSync(root).sort().map(name => {
        const file = path.join(root, name), stat = fs.lstatSync(file);
        return { name, id: stat.ino, size: stat.size, hash: stat.isFile() ? hash(fs.readFileSync(file)) : null };
    });
}
function rawDatabase(root) {
    const uri = pathToFileURL(path.join(root, 'projects.sqlite3')); uri.searchParams.set('mode', 'rw');
    return new DatabaseSync(uri.href, { timeout: 350 });
}
function reply(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('Worker timeout')); }, 45000);
        function cleanup() { clearTimeout(timer); child.removeListener('message', message); child.removeListener('exit', exit); }
        function message(data) { cleanup(); resolve(data); }
        function exit(code) { cleanup(); reject(new Error('Worker exited: ' + code)); }
        child.once('message', message); child.once('exit', exit);
    });
}
async function command(child, message) { const pending = reply(child); child.send(message); return pending; }
async function worker(root, extra = {}) {
    const child = fork(path.join(__dirname, 'project-api-worker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); child.once('exit', () => children.delete(child));
    assert.equal((await reply(child)).ready, true);
    const response = await command(child, { action: 'start', root, ...extra });
    assert.ok(response.port); return { child, port: response.port, host: '127.0.0.1', pid: response.pid };
}
async function stopWorker(value) { assert.equal((await command(value.child, { action: 'stop' })).closed, true); }
async function rawRequest(server, headers, url = '/api/projects/session') {
    return new Promise((resolve, reject) => {
        const socket = net.connect(server.port, '127.0.0.1'); let text = '';
        socket.setTimeout(5000, () => socket.destroy(new Error('Raw HTTP timeout')));
        socket.on('connect', () => socket.end('GET ' + url + ' HTTP/1.1\r\n' + headers + '\r\nConnection: close\r\n\r\n'));
        socket.on('data', value => { text += value; }); socket.on('error', reject); socket.on('end', () => resolve(text));
    });
}
async function securityTests() {
    const deniedStore = { initializeProjectStore() { throw new Error('PRIVATE storage was accessed'); }, openProjectStore() { throw new Error('PRIVATE storage was accessed'); } };
    for (const flag of [undefined, '', '0', 'true', '01', ' 1', '1 ']) await test('exact enablement rejects ' + JSON.stringify(flag), async () => {
        const server = await serve({ env: { APIFORGE_PROJECT_API: flag }, storeApi: deniedStore });
        try {
            for (const [method, url] of [['GET', '/api/projects/session'], ['GET', '/api/projects'], ['POST', '/api/projects/initialize']]) {
                error(await request(server, method, url, { raw: '{invalid' }), 403, 'PROJECT_API_DISABLED');
            }
        } finally { await stop(server); }
    });
    const server = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: deniedStore }, '0.0.0.0', app => app.set('trust proxy', true));
    const token = await session(server);
    try {
        await test('IPv4 session stable, independent instance random, no storage access', async () => {
            assert.equal(await session(server), token);
            const other = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: deniedStore });
            try { assert.notEqual(await session(other), token); } finally { await stop(other); }
            for (const host of ['localhost', 'LOCALHOST', '127.22.3.4', '[::1]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]']) assert.equal((await request(server, 'GET', '/api/projects/session', { headers: { host: host + ':' + server.port } })).status, 200);
        });
        await test('DNS rebinding, invalid and confusing Host authorities refused', async () => {
            for (const host of ['evil.example', 'localhost.evil.example', '127.1', '2130706433', '0x7f000001', '127.000.0.1', 'localhost.', 'user@localhost', 'localhost/path', 'localhost,evil.example', '[::2]', '0.0.0.0', 'localhost:0', 'localhost:65536', 'localhost:' + (server.port === 12345 ? 12346 : 12345)]) {
                error(await request(server, 'GET', '/api/projects/session', { headers: { host, origin: 'http://' + host, 'x-forwarded-host': 'localhost:' + server.port, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https', forwarded: 'for=127.0.0.1;host=localhost' } }), 403, 'PROJECT_API_NOT_LOCAL');
            }
            const duplicate = await rawRequest(server, 'Host: localhost:' + server.port + '\r\nHost: evil.example');
            assert.match(duplicate, /^HTTP\/1\.1 (?:400|403) /); assert.ok(!duplicate.includes(token));
            const missing = await rawRequest(server, 'X-Forwarded-Host: localhost:' + server.port);
            assert.match(missing, /^HTTP\/1\.1 (?:400|403) /); assert.ok(!missing.includes(token));
        });
        await test('Origin and Fetch Metadata refuse different browser origins', async () => {
            for (const headers of [{ origin: 'null' }, { origin: 'https://localhost:' + server.port }, { origin: 'http://localhost:' + server.port },
                { origin: 'http://evil.example', 'x-forwarded-proto': 'http' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
                { 'sec-fetch-site': 'garbage' }, { 'sec-fetch-mode': 'no-cors' }, { 'sec-fetch-mode': 'navigate' }, { 'sec-fetch-dest': 'script' }]) {
                error(await request(server, 'GET', '/api/projects/session', { headers }), 403, 'PROJECT_API_ORIGIN_REFUSED');
            }
            const good = { origin: 'http://127.0.0.1:' + server.port, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'x-forwarded-proto': 'https' };
            assert.equal((await request(server, 'GET', '/api/projects/session', { headers: good })).status, 200);
            const repeated = await rawRequest(server, 'Host: localhost:' + server.port + '\r\nOrigin: http://localhost:' + server.port + '\r\nOrigin: http://localhost:' + server.port);
            assert.match(repeated, /^HTTP\/1\.1 403 /); assert.ok(!repeated.includes(token));
        });
        await test('header-only token enforcement precedes JSON parsing and size checks', async () => {
            for (const headers of [{}, auth('0'.repeat(64)), auth('short'), auth(token.toUpperCase()), { cookie: TOKEN_HEADER + '=' + token }]) {
                const response = await request(server, 'POST', '/api/projects/initialize', { raw: '{broken', headers });
                error(response, 403, 'PROJECT_API_TOKEN_INVALID'); assert.ok(!response.text.includes(token));
            }
            const response = await request(server, 'POST', '/api/projects/initialize?token=' + token, { body: {} });
            error(response, 400, 'PROJECT_API_REQUEST_INVALID'); assert.ok(!response.text.includes(token));
            error(await request(server, 'POST', '/api/projects/initialize', { headers: { 'content-type': 'application/json', 'content-length': HTTP_BODY_LIMIT + 1 } }), 403, 'PROJECT_API_TOKEN_INVALID');
            const duplicate = await rawRequest(server, 'Host: localhost:' + server.port + '\r\n' + TOKEN_HEADER + ': ' + token + '\r\n' + TOKEN_HEADER + ': ' + token, '/api/projects');
            assert.match(duplicate, /^HTTP\/1\.1 403 /); assert.ok(!duplicate.includes(token));
        });
        await test('session tokens and source are absent from router logs and errors', async () => {
            const captured = [], original = { log: console.log, warn: console.warn, error: console.error };
            for (const key of Object.keys(original)) console[key] = (...values) => captured.push(values.join(' '));
            try {
                await session(server);
                const response = await request(server, 'POST', '/api/projects/initialize', { headers: auth(token), raw: 'PRIVATE_SECRET_NATIVE_SOURCE {broken' });
                error(response, 400, 'PROJECT_API_JSON_INVALID'); assert.ok(!response.text.includes(token)); assert.ok(!response.text.includes('PRIVATE_SECRET_NATIVE_SOURCE'));
            } finally { Object.assign(console, original); }
            assert.deepEqual(captured, []);
        });
        await test('real TCP nonloopback peer refused despite loopback Host and forwarding', async () => {
            const address = Object.values(os.networkInterfaces()).flat().find(value => value && value.family === 'IPv4' && !value.internal)?.address;
            if (!address) throw new NotRun('No nonloopback IPv4 interface');
            error(await request(server, 'GET', '/api/projects/session', { hostname: address, headers: { host: 'localhost:' + server.port, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost:' + server.port } }), 403, 'PROJECT_API_NOT_LOCAL');
        });
        await test('unsupported methods, literal paths and route isolation', async () => {
            for (const [method, url] of [['DELETE', '/api/projects'], ['PATCH', '/api/projects'], ['OPTIONS', '/api/projects/session'], ['POST', '/api/projects/session'], ['PUT', '/api/projects/initialize'], ['POST', '/api/projects/compile'], ['GET', '/api/projects/unknown/extra']]) {
                error(await request(server, method, url, { headers: auth(token), body: {} }), 404, 'PROJECT_API_ENDPOINT_NOT_FOUND');
            }
            const head = await request(server, 'HEAD', '/api/projects/session'); assert.equal(head.status, 404); assert.equal(head.text, '');
            for (const url of ['/api/Projects/session', '/api/projects/session/', '/api/projects/%73ession', '/api/projects/..', '/api/projects//session', '/api/projects/%', '/api/projects/%2f', '/api/projects/%252e', '/api/projects/session?callback=evil']) {
                const response = await request(server, 'GET', url, { headers: auth(token) }); assert.equal(response.status, 400); assert.ok(!response.text.includes(token));
            }
            for (const id of ['constructor', '__proto__', 'not-uuid', crypto.randomUUID().toUpperCase()]) error(await request(server, 'GET', '/api/projects/' + id, { headers: auth(token) }), 400, 'PROJECT_INVALID_ID');
            for (const rev of ['0', '-1', '+1', '1.0', '01', '1e0', '9007199254740992']) error(await request(server, 'GET', '/api/projects/' + crypto.randomUUID() + '/revisions/' + rev, { headers: auth(token) }), 400, 'PROJECT_INVALID_REVISION');
        });
        await test('IPv6 loopback uses native socket when available', async () => {
            let ipv6;
            try { ipv6 = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: deniedStore }, '::1'); }
            catch (e) { if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(e.code)) throw new NotRun(e.code); throw e; }
            try { await session(ipv6); } finally { await stop(ipv6); }
        });
    } finally { await stop(server); }
}
async function mappingAndLifecycleTests() {
    const expected = {
        PROJECT_INVALID_INPUT: 400, PROJECT_INVALID_ID: 400, PROJECT_INVALID_NAME: 400, PROJECT_INVALID_TARGET: 400, PROJECT_INVALID_SOURCE: 400, PROJECT_INVALID_REVISION: 400,
        PROJECT_NOT_FOUND: 404, PROJECT_REVISION_CONFLICT: 409, PROJECT_REVISION_LIMIT: 409, PROJECT_STORE_EXISTS: 409,
        PROJECT_STORE_MISSING: 503, PROJECT_STORE_UNSAFE: 503, PROJECT_STORE_IDENTITY_MISMATCH: 503, PROJECT_STORE_INCOMPATIBLE: 503,
        PROJECT_STORE_CORRUPT: 503, PROJECT_STORE_RECOVERY_REQUIRED: 503, PROJECT_STORE_BUSY: 503, PROJECT_STORE_CLOSED: 503,
        PROJECT_STORE_RUNTIME_UNSUPPORTED: 503, PROJECT_STORE_PLATFORM_UNSUPPORTED: 503, PROJECT_COMMIT_UNCERTAIN: 500, PROJECT_STORE_STORAGE_FAILURE: 500
    };
    await test('every published store code has explicit sanitized HTTP mapping', async () => {
        for (const [code, status] of Object.entries(expected)) {
            let calls = 0;
            const server = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { openProjectStore() { calls++; const e = new ProjectStoreError(code); e.message = 'PRIVATE C:\\secret SELECT S-1-5'; e.stack = 'PRIVATE'; throw e; } } });
            try { error(await request(server, 'GET', '/api/projects', { headers: auth(await session(server)) }), status, code); assert.equal(calls, 1); }
            finally { await stop(server); }
        }
        const server = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { openProjectStore() { throw Object.assign(new Error('PRIVATE'), { code: 'PROJECT_STORE_MISSING' }); } } });
        try { error(await request(server, 'GET', '/api/projects', { headers: auth(await session(server)) }), 500, 'PROJECT_STORE_STORAGE_FAILURE'); }
        finally { await stop(server); }
    });
    await test('FIFO lifecycle drains, serializes initialization and rejects new work on shutdown', async () => {
        let release, initCalls = 0, closes = 0, active = 0, maximum = 0;
        const gate = new Promise(resolve => { release = resolve; });
        const store = { storeId: crypto.randomUUID(), close() { closes++; }, async listProjects() { active++; maximum = Math.max(maximum, active); await gate; active--; return []; } };
        const server = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { async initializeProjectStore() { initCalls++; await gate; return store; }, openProjectStore() { return store; } } });
        const token = await session(server);
        try {
            const a = request(server, 'POST', '/api/projects/initialize', { headers: auth(token), body: {} });
            const b = request(server, 'POST', '/api/projects/initialize', { headers: auth(token), body: {} });
            await new Promise(resolve => setTimeout(resolve, 30)); release();
            assert.deepEqual((await Promise.all([a, b])).map(value => value.status).sort(), [201, 409]); assert.equal(initCalls, 1);
            const reads = await Promise.all([request(server, 'GET', '/api/projects', { headers: auth(token) }), request(server, 'GET', '/api/projects', { headers: auth(token) })]);
            assert.ok(reads.every(value => value.status === 200)); assert.equal(maximum, 1);
            const first = server.controller.shutdown(); assert.equal(server.controller.shutdown(), first); await first; assert.equal(closes, 1);
            error(await request(server, 'GET', '/api/projects/session'), 503, 'PROJECT_API_STOPPING');
        } finally { await stop(server); }
    });
    await test('shutdown waits for an operation; close failure is controlled and persistent', async () => {
        let release, entered, closed = 0;
        const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { entered = resolve; });
        const server = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { openProjectStore: () => ({ async listProjects() { entered(); await gate; return []; }, close() { closed++; } }) } });
        try {
            const pending = request(server, 'GET', '/api/projects', { headers: auth(await session(server)) }); await start;
            const shutdown = server.controller.shutdown(); assert.equal(closed, 0); release(); await shutdown; assert.equal(closed, 1); assert.equal((await pending).status, 200);
        } finally { await stop(server); }
        const broken = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { openProjectStore: () => ({ listProjects: () => [], close() { throw new Error('PRIVATE'); } }) } });
        await request(broken, 'GET', '/api/projects', { headers: auth(await session(broken)) });
        await assert.rejects(broken.controller.shutdown(), e => e.code === 'PROJECT_STORE_STORAGE_FAILURE' && !e.message.includes('PRIVATE'));
        await new Promise(resolve => broken.server.close(resolve)); servers.delete(broken);
    });
}
async function nativeTests() {
    if (process.platform !== 'win32' || process.arch !== 'x64') { notRun('native HTTP storage', 'Windows x64 required'); return; }
    DatabaseSync = require('node:sqlite').DatabaseSync;
    const fixture = isolated('primary'), server = await serve(fixture.options), token = await session(server), headers = auth(token);
    let project;
    try {
        await test('session does not create storage; ordinary reopen never initializes', async () => {
            assert.equal(fs.existsSync(fixture.root), false);
            error(await request(server, 'GET', '/api/projects', { headers }), 503, 'PROJECT_STORE_MISSING');
            error(await request(server, 'POST', '/api/projects', { headers, body: { name: 'missing', target: 'mysql', source: '' } }), 503, 'PROJECT_STORE_MISSING');
            assert.equal(fs.existsSync(fixture.root), false);
        });
        await test('explicit initialization and repeated refusal preserve bytes', async () => {
            const initialized = await request(server, 'POST', '/api/projects/initialize', { headers, body: {} });
            assert.equal(initialized.status, 201); assert.match(initialized.json.data.storeId, /^[a-f0-9-]{36}$/);
            const before = inventory(fixture.root);
            error(await request(server, 'POST', '/api/projects/initialize', { headers, body: {} }), 409, 'PROJECT_STORE_EXISTS'); assert.deepEqual(inventory(fixture.root), before);
        });
        await test('real create revision one and exact source without compiling DSL', async () => {
            const source = '\uFEFFα😀漢字\r\n\n \t\0 not valid DSL';
            const response = await request(server, 'POST', '/api/projects', { headers, body: { name: ' initial ', target: 'mysql', source } });
            assert.equal(response.status, 201); project = response.json.data; assert.equal(project.revision, 1);
            assert.equal(project.source, source); assert.equal(project.sourceHash, hash(Buffer.from(source)));
            assert.equal((await request(server, 'GET', '/api/projects/' + project.id, { headers })).json.data.source, source);
        });
        await test('deterministic list excludes source BLOBs and duplicate names remain valid', async () => {
            assert.equal((await request(server, 'POST', '/api/projects', { headers, body: { name: ' initial ', target: 'postgres', source: '' } })).status, 201);
            const response = await request(server, 'GET', '/api/projects', { headers }); assert.equal(response.status, 200);
            const list = response.json.data; assert.equal(list.length, 2); assert.deepEqual(list.map(p => p.id), list.map(p => p.id).sort());
            assert.ok(list.every(p => !Object.hasOwn(p, 'source')));
        });
        for (const [label, change] of [['name only', { name: 'changed' }], ['target only', { target: 'postgres' }], ['source only', { source: '\uFEFF\r\n😀\0' }], ['multiple fields', { name: 'all', target: 'mysql', source: 'all' }], ['empty source', { source: '' }]]) {
            await test('HTTP save ' + label + ' appends exactly one immutable revision', async () => {
                const old = project;
                const response = await request(server, 'PUT', '/api/projects/' + old.id, { headers, body: { expectedRevision: old.revision, changes: change } });
                assert.equal(response.status, 200); project = response.json.data; assert.equal(project.revision, old.revision + 1);
                for (const key of ['name', 'target', 'source']) assert.equal(project[key], Object.hasOwn(change, key) ? change[key] : old[key]);
                const history = await request(server, 'GET', '/api/projects/' + old.id + '/revisions/' + old.revision, { headers });
                assert.equal(history.status, 200); assert.equal(history.json.data.source, old.source); assert.ok(history.json.data.savedAt);
            });
        }
        await test('stale and missing records map correctly without overwriting history', async () => {
            error(await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision: 1, changes: { source: 'loser' } } }), 409, 'PROJECT_REVISION_CONFLICT');
            assert.deepEqual((await request(server, 'GET', '/api/projects/' + project.id, { headers })).json.data, project);
            error(await request(server, 'GET', '/api/projects/' + crypto.randomUUID(), { headers }), 404, 'PROJECT_NOT_FOUND');
            error(await request(server, 'GET', '/api/projects/' + project.id + '/revisions/99', { headers }), 404, 'PROJECT_NOT_FOUND');
        });
        await test('strict mutation parsing, shapes and types leave native database unchanged', async () => {
            const before = inventory(fixture.root);
            for (const value of [undefined, {}, [], 1, null, 'text', { name: 'bad', target: 'mysql' }, { name: 'bad', target: 'mysql', source: '', id: crypto.randomUUID() }, { root: fixture.root }, { filename: 'other.sqlite3' }]) {
                assert.equal((await request(server, 'POST', '/api/projects', { headers: { ...headers, 'content-type': 'application/json' }, body: value })).status, 400);
            }
            for (const raw of ['', ' ', '{broken', '{"__proto__":{},"name":"bad","target":"mysql","source":""}', '{"name":"bad","target":"mysql","source":"","constructor":{}}']) {
                assert.equal((await request(server, 'POST', '/api/projects', { headers, raw })).status, 400);
            }
            error(await request(server, 'POST', '/api/projects/initialize', { headers, raw: '' }), 400, 'PROJECT_API_JSON_INVALID');
            for (const media of ['text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=utf-16', 'application/json; boundary=bad']) error(await request(server, 'POST', '/api/projects', { headers: { ...headers, 'content-type': media }, body: {} }), 415, 'PROJECT_API_MEDIA_UNSUPPORTED');
            error(await request(server, 'POST', '/api/projects', { headers: { ...headers, 'content-encoding': 'gzip' }, body: {} }), 415, 'PROJECT_API_MEDIA_UNSUPPORTED');
            const invalidBytes = Buffer.concat([Buffer.from('{"name":"bad","target":"mysql","source":"'), Buffer.from([0xc0, 0x80]), Buffer.from('"}')]);
            error(await request(server, 'POST', '/api/projects', { headers, raw: invalidBytes }), 400, 'PROJECT_API_JSON_INVALID');
            for (const changes of [undefined, {}, [], { id: project.id }, { source: null }]) assert.equal((await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision: project.revision, changes } })).status, 400);
            for (const expectedRevision of [undefined, null, '6', 0, -1, 1.5, 9007199254740992]) error(await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision, changes: { name: 'bad' } } }), 400, expectedRevision === undefined ? 'PROJECT_INVALID_INPUT' : 'PROJECT_INVALID_REVISION');
            for (const [change, code] of [[{ target: 'MYSQL' }, 'PROJECT_INVALID_TARGET'], [{ name: '' }, 'PROJECT_INVALID_NAME'], [{ source: '\ud800' }, 'PROJECT_INVALID_SOURCE'], [{ source: 'x'.repeat(1048577) }, 'PROJECT_INVALID_SOURCE']]) {
                error(await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision: project.revision, changes: change } }), 400, code);
            }
            assert.deepEqual(inventory(fixture.root), before);
        });
        await test('finite HTTP limit rejects Content-Length and chunked oversized JSON', async () => {
            const before = inventory(fixture.root);
            error(await request(server, 'POST', '/api/projects', { headers: { ...headers, 'content-type': 'application/json', 'content-length': HTTP_BODY_LIMIT + 1 } }), 413, 'PROJECT_API_BODY_TOO_LARGE');
            error(await request(server, 'POST', '/api/projects', { headers, raw: '{"source":"' + 'x'.repeat(HTTP_BODY_LIMIT) + '"}', chunked: true }), 413, 'PROJECT_API_BODY_TOO_LARGE');
            assert.deepEqual(inventory(fixture.root), before);
        });
        await test('worst-case six-times JSON escaped maximum source reaches native store intact', async () => {
            const raw = '{"name":"maximum","target":"mysql","source":"' + '\\u0000'.repeat(1048576) + '"}';
            assert.ok(Buffer.byteLength(raw) > 6 * 1048576);
            const response = await request(server, 'POST', '/api/projects', { headers: { ...headers, 'content-type': 'application/vnd.apiforge+json; charset="utf-8"' }, raw });
            assert.equal(response.status, 201); assert.equal(response.json.data.source, '\0'.repeat(1048576));
            assert.equal(response.json.data.sourceHash, hash(Buffer.alloc(1048576)));
            const escaped = await request(server, 'POST', '/api/projects', { headers, raw: '{"name":"unicode","target":"mysql","source":"\\ufeff\\r\\n\\ud83d\\ude00\\u0000"}' });
            assert.equal(escaped.status, 201); assert.equal(escaped.json.data.source, '\uFEFF\r\n😀\0');
        });
        await test('native SQLite BUSY is bounded, sanitized and never retried', async () => {
            const lock = rawDatabase(fixture.root); lock.exec('BEGIN IMMEDIATE');
            const started = Date.now();
            try { error(await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision: project.revision, changes: { name: 'busy' } } }), 503, 'PROJECT_STORE_BUSY'); }
            finally { lock.exec('ROLLBACK'); lock.close(); }
            assert.ok(Date.now() - started < 15000); assert.deepEqual((await request(server, 'GET', '/api/projects/' + project.id, { headers })).json.data, project);
        });
        await test('native post-COMMIT acknowledgment failure is distinct and next read reopens', async () => {
            const original = DatabaseSync.prototype.exec; let commits = 0;
            DatabaseSync.prototype.exec = function(sql) { const result = original.call(this, sql); if (sql === 'COMMIT') { commits++; throw new Error('PRIVATE C:\\secret SELECT'); } return result; };
            try {
                const response = await request(server, 'PUT', '/api/projects/' + project.id, { headers, body: { expectedRevision: project.revision, changes: { source: 'committed once' } } });
                error(response, 500, 'PROJECT_COMMIT_UNCERTAIN'); assert.match(response.json.error.message, /reopen and inspect/); assert.equal(commits, 1);
            } finally { DatabaseSync.prototype.exec = original; }
            error(await request(server, 'POST', '/api/projects/initialize', { headers, body: {} }), 409, 'PROJECT_STORE_EXISTS');
            const current = await request(server, 'GET', '/api/projects/' + project.id, { headers }); assert.equal(current.status, 200);
            assert.equal(current.json.data.revision, project.revision + 1); assert.equal(current.json.data.source, 'committed once'); project = current.json.data;
        });
    } finally { await stop(server); }
    await test('independent HTTP process reopens persisted exact bytes and rotates token', async () => {
        const other = await worker(fixture.root);
        try {
            const nextToken = await session(other); assert.notEqual(nextToken, token);
            assert.deepEqual((await request(other, 'GET', '/api/projects/' + project.id, { headers: auth(nextToken) })).json.data, project);
            const first = await request(other, 'GET', '/api/projects/' + project.id + '/revisions/1', { headers: auth(nextToken) });
            assert.equal(first.json.data.source, '\uFEFFα😀漢字\r\n\n \t\0 not valid DSL');
            assert.equal(first.json.data.sourceHash, hash(Buffer.from(first.json.data.source)));
        }
        finally { await stopWorker(other); }
    });
    await test('two HTTP server processes race one expected revision: one winner, one 409', async () => {
        const a = await worker(fixture.root), b = await worker(fixture.root);
        try {
            const at = await session(a), bt = await session(b);
            assert.equal((await request(a, 'GET', '/api/projects/' + project.id, { headers: auth(at) })).status, 200);
            assert.equal((await request(b, 'GET', '/api/projects/' + project.id, { headers: auth(bt) })).status, 200);
            const responses = await Promise.all([request(a, 'PUT', '/api/projects/' + project.id, { headers: auth(at), body: { expectedRevision: project.revision, changes: { source: 'winner-a' } } }), request(b, 'PUT', '/api/projects/' + project.id, { headers: auth(bt), body: { expectedRevision: project.revision, changes: { source: 'winner-b' } } })]);
            assert.deepEqual(responses.map(value => value.status).sort(), [200, 409]);
            error(responses.find(value => value.status === 409), 409, 'PROJECT_REVISION_CONFLICT');
            const current = (await request(a, 'GET', '/api/projects/' + project.id, { headers: auth(at) })).json.data;
            assert.equal(current.revision, project.revision + 1); assert.equal(current.source, responses.find(value => value.status === 200).json.data.source);
            error(await request(b, 'GET', '/api/projects/' + project.id + '/revisions/' + (current.revision + 1), { headers: auth(bt) }), 404, 'PROJECT_NOT_FOUND');
            console.log('Cross-process HTTP evidence: ' + JSON.stringify({ pids: [a.pid, b.pid], statuses: responses.map(r => r.status), winningRevision: current.revision, nextRevisionAbsent: true }));
        } finally { await Promise.all([stopWorker(a), stopWorker(b)]); }
    });
    await test('concurrent native HTTP initialization uses one explicit initializer', async () => {
        const f = isolated('initialize-race'), a = await worker(f.root), b = await worker(f.root);
        try {
            const at = await session(a), bt = await session(b);
            const responses = await Promise.all([request(a, 'POST', '/api/projects/initialize', { headers: auth(at), body: {} }), request(b, 'POST', '/api/projects/initialize', { headers: auth(bt), body: {} })]);
            assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
            error(responses.find(r => r.status === 409), 409, 'PROJECT_STORE_EXISTS');
        } finally { await Promise.all([stopWorker(a), stopWorker(b)]); }
    });
    for (const [name, alter, code] of [
        ['missing', root => fs.renameSync(path.join(root, 'projects.sqlite3'), path.join(fixtures, 'retained-' + crypto.randomUUID() + '.sqlite3')), 'PROJECT_STORE_MISSING'],
        ['corrupt', root => { const fd = fs.openSync(path.join(root, 'projects.sqlite3'), 'r+'); fs.writeSync(fd, Buffer.from('BROKEN'), 0, 6, 0); fs.closeSync(fd); }, 'PROJECT_STORE_CORRUPT'],
        ['incompatible', root => { const db = rawDatabase(root); db.exec('PRAGMA user_version=2'); db.close(); }, 'PROJECT_STORE_INCOMPATIBLE'],
        ['incomplete', root => fs.writeFileSync(path.join(root, 'unexpected'), 'retain'), 'PROJECT_STORE_RECOVERY_REQUIRED'],
        ['malformed-marker', root => fs.writeFileSync(path.join(root, 'bootstrap.identity.json'), 'broken'), 'PROJECT_STORE_RECOVERY_REQUIRED'],
        ['unsafe-linked-database', root => fs.linkSync(path.join(root, 'projects.sqlite3'), path.join(fixtures, 'retained-hardlink-' + crypto.randomUUID())), 'PROJECT_STORE_UNSAFE']
    ]) await test('native HTTP ' + name + ' storage refuses without replacement or initialization', async () => {
        const f = isolated(name), first = await serve(f.options), t = await session(first);
        assert.equal((await request(first, 'POST', '/api/projects/initialize', { headers: auth(t), body: {} })).status, 201); await stop(first);
        alter(f.root); const before = inventory(f.root), reopened = await serve(f.options), rt = await session(reopened);
        try {
            error(await request(reopened, 'GET', '/api/projects', { headers: auth(rt) }), 503, code);
            error(await request(reopened, 'POST', '/api/projects/initialize', { headers: auth(rt), body: {} }), 409, 'PROJECT_STORE_EXISTS');
            assert.deepEqual(inventory(f.root), before);
        } finally { await stop(reopened); }
    });
    await test('unsupported runtime HTTP refuses before default or fixture storage access', async () => {
        const f = isolated('unsupported'), other = await worker(f.root, { unsupportedRuntime: true });
        try { const t = await session(other); error(await request(other, 'POST', '/api/projects/initialize', { headers: auth(t), body: {} }), 503, 'PROJECT_STORE_RUNTIME_UNSUPPORTED'); assert.equal(fs.existsSync(f.root), false); }
        finally { await stopWorker(other); }
    });
}
async function regressionTests() {
    await test('production server startup remains lazy with compiler, health, Live and static regression guards', async () => {
        const source = `const M=require('node:module'),old=M._load;M._load=function(id,...a){if(id==='node:sqlite'||id==='../project-store')throw Error('eager storage');return old.call(this,id,...a)};require('./server');`;
        const child = spawnSync(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, APIFORGE_PROJECT_API: '1', APIFORGE_LIVE_RUNNER: '0' } });
        assert.equal(child.status, 0, child.stderr);
        const saved = { project: process.env.APIFORGE_PROJECT_API, live: process.env.APIFORGE_LIVE_RUNNER };
        delete process.env.APIFORGE_PROJECT_API; process.env.APIFORGE_LIVE_RUNNER = '0';
        const app = require('../server'), server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const endpoint = { host: '127.0.0.1', port: server.address().port };
        try {
            assert.deepEqual((await request(endpoint, 'GET', '/api/health')).json, { status: 'ok', version: '1.0.0' });
            error(await request(endpoint, 'GET', '/api/projects/session'), 403, 'PROJECT_API_DISABLED');
            const live = await request(endpoint, 'GET', '/api/live/status'); assert.equal(live.status, 403); assert.equal(live.json.code, 'LIVE_DISABLED');
            assert.equal((await request(endpoint, 'GET', '/')).status, 200); assert.equal((await request(endpoint, 'GET', '/app.js')).status, 200);
            for (const target of ['mysql', 'postgres']) {
                const response = await request(endpoint, 'POST', '/api/compile', { body: { source: 'ENTITY Student\nid INT PRIMARY KEY', target } });
                assert.equal(response.status, 200); assert.equal(response.json.success, true); assert.equal(response.json.generatedFiles.length, 10);
                assert.equal(Object.values(response.json.phaseStates).filter(value => value === 'succeeded').length, 6);
            }
            const invalid = await request(endpoint, 'POST', '/api/compile', { body: {} }); assert.equal(invalid.status, 400); assert.equal(invalid.json.phase, 'input');
            const semantic = await request(endpoint, 'POST', '/api/compile', { body: { source: '' } }); assert.equal(semantic.status, 422); assert.equal(semantic.json.phase, 'semantic');
        } finally {
            await app.locals.shutdownProjectApi(); await new Promise(resolve => server.close(resolve));
            if (saved.project === undefined) delete process.env.APIFORGE_PROJECT_API; else process.env.APIFORGE_PROJECT_API = saved.project;
            if (saved.live === undefined) delete process.env.APIFORGE_LIVE_RUNNER; else process.env.APIFORGE_LIVE_RUNNER = saved.live;
        }
    });
    await test('project storage has no compiler, Live execution or generated database dependency', async () => {
        const source = `const M=require('node:module'),old=M._load;M._load=function(id,...a){if(['mysql2','pg','node:sqlite'].includes(id)||id.includes('compiler-api')||id.includes('live-runner/'))throw Error('execution dependency');return old.call(this,id,...a)};require('./src/api/project-api');`;
        const child = spawnSync(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
        // The router must avoid Live's eager manager/compiler/DB import chain.
        assert.equal(child.status, 0, child.stderr);
    });
}
const SHUTDOWN_GRACE_MS = 30000, SHUTDOWN_ALLOWANCE_MS = 5000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shutdownProcess(mode = 'normal', root = path.join(fixtures, 'shutdown-' + crypto.randomUUID()), enabled = false) {
    const events = [], observers = new Set(); let output = '', outcome;
    const child = fork(path.join(__dirname, '../server.js'), ['--shutdown-fixture', JSON.stringify({ mode, root })], {
        execArgv: ['--require', path.join(__dirname, 'project-api-worker.js')], windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, DEV_PORT: '0', APIFORGE_PROJECT_API: enabled ? '1' : '0', APIFORGE_LIVE_RUNNER: '0' }
    });
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += bytes; });
    child.on('message', data => { events.push({ ...data, at: Date.now() }); for (const observer of observers) observer(); });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => {
        children.delete(child); outcome = { code, signal }; resolve(outcome);
    }));
    function waitFor(event, count = 1, predicate = () => true) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { observers.delete(check); reject(new Error('Shutdown fixture event missing: ' + event)); }, 40000);
            function check() {
                const found = events.filter(value => value.event === event && predicate(value));
                if (found.length >= count) { clearTimeout(timer); observers.delete(check); resolve(found[count - 1]); }
            }
            observers.add(check); check();
        });
    }
    const listening = await waitFor('listening');
    return { child, root, events, exited, waitFor, port: listening.port, host: '127.0.0.1',
        output: () => output, outcome: () => outcome,
        signal(signals = ['SIGTERM']) {
            if (process.platform === 'win32') child.send({ action: 'signal', signals });
            else for (const signal of signals) child.kill(signal);
            return Date.now();
        }
    };
}
async function boundedExit(value, started) {
    let timer;
    try {
        const outcome = await Promise.race([value.exited, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Server exceeded shutdown deadline plus test allowance')), SHUTDOWN_GRACE_MS + SHUTDOWN_ALLOWANCE_MS);
        })]);
        const ms = Date.now() - started;
        assert.ok(ms <= SHUTDOWN_GRACE_MS + SHUTDOWN_ALLOWANCE_MS, String(ms));
        assert.ok(!/PRIVATE_SECRET_NATIVE|C:\\secret|SELECT password|Error:|\bat .*\.js:\d+/.test(value.output()));
        assert.equal(outcome.signal, null, 'handler must exit itself, not be killed by the harness');
        console.log('Shutdown evidence: ' + JSON.stringify({ mode: value.child.spawnargs.at(-1) && JSON.parse(value.child.spawnargs.at(-1)).mode,
            code: outcome.code, ms, events: value.events.map(event => event.event),
            signalMechanism: process.platform === 'win32' ? 'IPC process.emit of registered signal handler' : 'native child signal' }));
        return { ...outcome, ms };
    } finally { clearTimeout(timer); }
}
async function releaseShutdownProcess(value) {
    if (!value.outcome()) { value.child.kill('SIGKILL'); await value.exited; }
}
async function stalledRequest(value, url, headers = {}, body = JSON.stringify({ source: 'ENTITY Student\nid INT PRIMARY KEY' })) {
    const socket = net.connect(value.port, value.host); let text = '';
    const closed = new Promise(resolve => socket.once('close', () => resolve(Date.now())));
    socket.on('data', bytes => { text += bytes; }); socket.on('error', () => {});
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    socket.write('POST ' + url + ' HTTP/1.1\r\nHost: 127.0.0.1:' + value.port + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\nConnection: close\r\n' + Object.entries(headers).map(([name, content]) => name + ': ' + content + '\r\n').join('') + '\r\n' + body[0]);
    assert.equal((await value.waitFor('httpRequest', 1, event => event.path === url)).path, url);
    await pause(100);
    return { socket, closed, text: () => text, finish: () => socket.end(body.slice(1)) };
}
async function shutdownReproduction() {
    await test('original server reproduces indefinite close with an incomplete real TCP body', async () => {
        const value = await shutdownProcess(), stalled = await stalledRequest(value, '/api/compile');
        try {
            const started = value.signal();
            await value.waitFor('liveCleanupFinished'); await value.waitFor('projectCleanupFinished');
            await pause(SHUTDOWN_GRACE_MS + 500);
            assert.equal(value.outcome(), undefined); assert.equal(stalled.socket.destroyed, false);
            assert.ok(value.events.some(event => event.event === 'httpCloseStarted'));
            assert.ok(!value.events.some(event => event.event === 'httpClosed'));
            console.log('Original shutdown defect: ' + JSON.stringify({ observedMs: Date.now() - started, applicationCleanupFinished: true, serverStillAlive: true, stalledSocketOpen: true }));
        } finally { stalled.socket.destroy(); await releaseShutdownProcess(value); }
    });
}
async function shutdownTests() {
    await test('actual server gracefully awaits both cleanups, preserves routes, clears deadline and repeated signals are idempotent', async () => {
        const value = await shutdownProcess('delayed-cleanup');
        try {
            assert.deepEqual((await request(value, 'GET', '/api/health')).json, { status: 'ok', version: '1.0.0' });
            error(await request(value, 'GET', '/api/projects/session'), 403, 'PROJECT_API_DISABLED');
            assert.equal((await request(value, 'GET', '/api/live/status')).json.code, 'LIVE_DISABLED');
            const compile = await request(value, 'POST', '/api/compile', { body: { source: 'ENTITY Student\nid INT PRIMARY KEY' } });
            assert.equal(compile.status, 200); assert.equal(compile.json.success, true);
            const started = value.signal(['SIGTERM', 'SIGTERM', 'SIGINT', 'SIGINT']);
            await value.waitFor('projectCleanupStarted');
            await assert.rejects(request(value, 'GET', '/api/health'), error => error.code === 'ECONNREFUSED');
            const result = await boundedExit(value, started); assert.equal(result.code, 0); assert.ok(result.ms >= 700 && result.ms < 5000);
            for (const event of ['liveCleanupStarted', 'liveCleanupFinished', 'projectCleanupStarted', 'projectCleanupFinished', 'httpCloseStarted', 'httpClosed', 'deadlineStarted', 'deadlineCleared']) assert.equal(value.events.filter(item => item.event === event).length, 1, event);
            assert.ok(!value.output().includes('SHUTDOWN_DEADLINE_EXCEEDED'));
            assert.equal(fs.existsSync(value.root), false);
        } finally { await releaseShutdownProcess(value); }
    });
    for (const [mode, url] of [['normal', '/api/compile'], ['normal', '/api/projects'], ['early-node18', '/api/compile']]) await test('actual stalled TCP body forces nonzero bounded shutdown: ' + mode + ' ' + url, async () => {
        const value = await shutdownProcess(mode, undefined, url.startsWith('/api/projects'));
        const headers = url.startsWith('/api/projects') ? auth(await session(value)) : {};
        const stalled = await stalledRequest(value, url, headers);
        try {
            const started = value.signal(); await value.waitFor('projectCleanupStarted');
            await pause(250); assert.equal(stalled.socket.destroyed, false);
            const result = await boundedExit(value, started), closedAt = await stalled.closed;
            assert.equal(result.code, 1); assert.ok(result.ms >= SHUTDOWN_GRACE_MS - 500);
            assert.ok(closedAt - started >= SHUTDOWN_GRACE_MS - 500);
            assert.ok(value.output().includes('SHUTDOWN_DEADLINE_EXCEEDED'));
            if (mode !== 'early-node18') assert.equal(value.events.filter(event => event.event === 'httpForced').length, 1);
            assert.equal(fs.existsSync(value.root), false);
        } finally { stalled.socket.destroy(); await releaseShutdownProcess(value); }
    });
    for (const mode of ['live-reject', 'live-throw', 'project-reject', 'both-reject', 'http-close-error', 'http-close-throw']) await test('actual shutdown safely handles ' + mode + ' and runs both application cleanups', async () => {
        const value = await shutdownProcess(mode);
        try {
            const result = await boundedExit(value, value.signal()); assert.equal(result.code, 1); assert.ok(result.ms < 5000);
            for (const event of ['liveCleanupStarted', 'projectCleanupStarted']) assert.equal(value.events.filter(item => item.event === event).length, 1);
            assert.ok(value.events.some(event => event.event === 'projectCleanupFinished'));
            if (mode !== 'live-throw') assert.ok(value.events.some(event => event.event === 'liveCleanupFinished'));
            const expected = mode.startsWith('http-') ? 'HTTP_CLOSE_FAILED' : mode.startsWith('project') ? 'PROJECT_STORE_CLOSE_FAILED' : 'LIVE_CLEANUP_FAILED';
            assert.ok(value.output().includes(expected));
            if (mode === 'both-reject') assert.ok(value.output().includes('PROJECT_STORE_CLOSE_FAILED'));
            assert.equal(value.events.filter(event => event.event === 'deadlineCleared').length, 1);
        } finally { await releaseShutdownProcess(value); }
    });
    await test('unresolved Live cleanup cannot extend the actual process deadline', async () => {
        const value = await shutdownProcess('stuck-live');
        try {
            const result = await boundedExit(value, value.signal()); assert.equal(result.code, 1); assert.ok(result.ms >= SHUTDOWN_GRACE_MS - 500);
            assert.ok(value.events.some(event => event.event === 'projectCleanupFinished'));
            assert.ok(!value.events.some(event => event.event === 'liveCleanupFinished'));
            assert.ok(value.output().includes('SHUTDOWN_DEADLINE_EXCEEDED'));
        } finally { await releaseShutdownProcess(value); }
    });
    for (const mode of ['accepted', 'stuck-project']) await test('accepted native Project Store work during actual shutdown: ' + mode, async () => {
        const fixture = isolated('shutdown-' + mode), store = await fixture.options.storeApi.initializeProjectStore();
        const project = await store.createProject({ name: 'shutdown', target: 'mysql', source: 'before' }); store.close();
        const value = await shutdownProcess(mode, fixture.root, true), token = await session(value);
        let stalled;
        try {
            const operation = request(value, 'PUT', '/api/projects/' + project.id, { headers: auth(token), body: { expectedRevision: 1, changes: { source: 'committed during shutdown' } } }).then(result => ({ result }), error => ({ error: error.code }));
            await value.waitFor('operationAccepted');
            if (mode === 'accepted') stalled = await stalledRequest(value, '/api/projects', auth(token), JSON.stringify({ name: 'after shutdown', target: 'mysql', source: '' }));
            const started = value.signal(); await value.waitFor('projectCleanupStarted');
            assert.ok(!value.events.some(event => event.event === 'storeClosed'));
            if (stalled) {
                stalled.finish(); await stalled.closed;
                assert.match(stalled.text(), /^HTTP\/1\.1 503 /); assert.ok(stalled.text().includes('PROJECT_API_STOPPING'));
            }
            const result = await boundedExit(value, started), response = await operation;
            const reopened = await fixture.options.storeApi.openProjectStore();
            try {
                const current = await reopened.getProject(project.id);
                if (mode === 'accepted') {
                    assert.equal(result.code, 0); assert.equal(response.result.status, 200); assert.equal(response.result.json.data.revision, 2);
                    assert.equal(current.revision, 2); assert.equal(current.source, 'committed during shutdown');
                    const sequence = value.events.map(event => event.event);
                    assert.ok(sequence.indexOf('operationCommitted') < sequence.indexOf('storeCloseStarted'));
                    assert.equal(sequence.filter(event => event === 'storeClosed').length, 1);
                } else {
                    assert.equal(result.code, 1); assert.ok(result.ms >= SHUTDOWN_GRACE_MS - 500); assert.ok(response.error);
                    assert.equal(current.revision, 1); assert.equal(current.source, 'before');
                    assert.ok(!value.events.some(event => event.event === 'storeClosed'));
                    assert.ok(value.output().includes('SHUTDOWN_DEADLINE_EXCEEDED'));
                }
                console.log('Shutdown committed state: ' + JSON.stringify({ mode, revision: current.revision, storeClosedBeforeExit: value.events.some(event => event.event === 'storeClosed') }));
            } finally { reopened.close(); }
        } finally { stalled?.socket.destroy(); await releaseShutdownProcess(value); }
    });
    if (process.platform === 'win32') notRun('native OS SIGTERM/SIGINT delivery to disposable child', 'Windows child.kill forcibly terminates; IPC process.emit exercised the same registered handlers with native TCP and actual server.js, not OS signal certification');
}
async function browserTests() {
    await test('native browser same-origin token exchange and cross-origin reads/mutations', async () => {
        let chromium;
        try { ({ chromium } = require('playwright')); }
        catch (error) { if (error.code === 'MODULE_NOT_FOUND') throw new NotRun('Playwright dependency not installed'); throw error; }
        if (!fs.existsSync(chromium.executablePath())) throw new NotRun('Bundled Playwright Chromium not installed');
        let calls = 0;
        const responses = [];
        const target = await serve({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: { openProjectStore() { calls++; return { listProjects: () => [], close() {} }; } } }, '127.0.0.1', app => {
            app.use((req, res, next) => { res.once('finish', () => { if (req.originalUrl.startsWith('/api/projects')) responses.push({ method: req.method, path: req.originalUrl, status: res.statusCode }); }); next(); });
        });
        const hostile = await serve({ env: {} });
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + target.port + '/browser-test');
            const same = await page.evaluate(async () => { const session = await (await fetch('/api/projects/session')).json(); const list = await fetch('/api/projects', { headers: { [session.data.tokenHeader]: session.data.token } }); return { status: list.status, token: session.data.token }; });
            assert.equal(same.status, 200); assert.equal(calls, 1);
            const beforeCross = responses.length;
            await page.goto('http://127.0.0.1:' + hostile.port + '/browser-test');
            const cross = await page.evaluate(async ({ port, token }) => {
                const base = 'http://127.0.0.1:' + port;
                const values = [];
                for (const [url, options] of [['/api/projects/session', {}], ['/api/projects', { headers: { 'X-APIForge-Project-Token': token } }], ['/api/projects/initialize', { method: 'POST', headers: { 'content-type': 'application/json', 'X-APIForge-Project-Token': token }, body: '{}' }]]) {
                    try { await fetch(base + url, options); values.push('exposed'); } catch { values.push('blocked'); }
                }
                try { const simple = await fetch(base + '/api/projects/initialize', { method: 'POST', mode: 'no-cors', body: '{}' }); values.push(simple.type); }
                catch { values.push('blocked'); }
                return values;
            }, { port: target.port, token: same.token });
            assert.deepEqual(cross, ['blocked', 'blocked', 'blocked', 'blocked']); assert.equal(calls, 1);
            const refused = responses.slice(beforeCross);
            assert.ok(refused.length >= 4); assert.ok(refused.every(value => value.status === 403));
            assert.ok(refused.some(value => value.method === 'POST' && value.path === '/api/projects/initialize'));
            console.log('Chromium origin evidence: ' + JSON.stringify({ sameOriginRead: 200, crossOriginResults: cross, refused }));
        } finally { await browser.close(); await Promise.all([stop(target), stop(hostile)]); }
    });
}
async function main() {
    fixtures = path.join(os.homedir(), 'APIForge-M2B-HTTP-tests-' + crypto.randomUUID()); fs.mkdirSync(fixtures);
    console.log('Retained disposable fixtures: ' + fixtures);
    if (process.argv.includes('--shutdown-reproduce')) { await shutdownReproduction(); return; }
    if (process.argv.includes('--shutdown-only')) { await shutdownTests(); return; }
    await securityTests(); await mappingAndLifecycleTests(); await regressionTests(); await browserTests(); await nativeTests();
    await shutdownTests();
    notRun('native Node 18, second-user, Windows 10, Linux/macOS and unsupported filesystems', 'No authorized runtime/account/OS/volume fixtures; simulated runtime refusal is not native Node 18');
    notRun('external remote host or reverse proxy security certification', 'Nonloopback test uses this host LAN interface; proxy termination does not identify the original peer');
    notRun('native generated MySQL/PostgreSQL operations', 'Outside M2B; project routes store source only');
}
main().catch(error => { results.push({ name: 'harness', status: 'FAIL', error: error.stack }); console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const child of children) child.kill();
    for (const server of servers) { try { await server.controller.shutdown(); } catch {} server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); }
    const summary = { runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch }, fixtures, results, counts: results.reduce((counts, value) => { counts[value.status] = (counts[value.status] || 0) + 1; return counts; }, {}) };
    if (fixtures) fs.writeFileSync(path.join(fixtures, 'results.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ counts: summary.counts, fixtures }));
});
