'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { compile } = require('../src/live-runner/compile');
const { createManager, TTL_MS } = require('../src/live-runner/manager');
const { configuration } = require('../src/live-runner/database');
const { containedPath, materialize } = require('../src/live-runner/materialize');
const { operations, validatePath } = require('../src/live-runner/operations');
const { request, serializeBody } = require('../src/live-runner/transport');
const { publicError } = require('../src/live-runner/errors');
const { createRouter, isLoopback, isLocalHostHeader } = require('../src/api/live-runner-api');
const source = 'ENTITY User\nid UUID PRIMARY KEY\nname STRING REQUIRED';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
async function rejects(action, code) { checks++; await assert.rejects(action, error => error.code === code); }
function fake(options = {}) {
    const events = []; let number = 0, running = 0, maximum = 0;
    const env = { APIFORGE_LIVE_RUNNER: '1', APIFORGE_LIVE_MYSQL_HOST: '127.0.0.1',
        APIFORGE_LIVE_MYSQL_PORT: '3306', APIFORGE_LIVE_MYSQL_USER: 'demo', APIFORGE_LIVE_MYSQL_PASSWORD: 'PRIVATE_PASSWORD' };
    const step = async (name, result) => { events.push(name); if (options.failure === name) throw new Error('PRIVATE_PASSWORD private SQL/stack'); return result; };
    const dependencies = {
        createProject: () => step('directory', '/fake/' + ++number),
        materialize: () => step('materialize'),
        databaseResource: () => ({ name: 'apiforge_live_' + 'a'.repeat(24), setup: () => step('setup'),
            close: () => step('close'), drop: () => step('drop') }),
        freePort: () => step('port', 12345),
        launch: () => { events.push('launch'); if (options.failure === 'launch') throw new Error('PRIVATE_PASSWORD');
            running++; maximum = Math.max(running, maximum); return {}; },
        health: () => step('health'),
        stop: state => { if (state) running--; return step('stop'); },
        released: () => step('released'), removeProject: () => step('remove'),
        request: async () => { await delay(2); return { success: true, status: 404, headers: {}, body: { error: 'Missing' } }; }
    };
    const manager = createManager({ env, dependencies, ttlMs: options.ttlMs || TTL_MS });
    return { manager, events, env, maximum: () => maximum };
}
async function apiEquivalence() {
    const app = express(); app.use(express.json()); app.use('/api', require('../src/api/compiler-api'));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        const sources = [source, 'ENTITY Item\nvalue STRING', 'ENTITY Event\nid INT PRIMARY KEY\nday DATE REQUIRED\nat TIMESTAMP',
            'ENTITY User\nid UUID PRIMARY KEY\nname STRING\nENTITY Project\nid INT PRIMARY KEY\ntitle STRING\nRELATION User OWNS Project ONE_TO_MANY'];
        for (const target of ['mysql', 'postgres']) for (const source of sources) {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/compile', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, target }) });
            const normal = await response.json(); assert.equal(normal.success, true);
            assert.deepEqual(compile(source, target), normal.generatedFiles); checks++;
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
}
async function routes() {
    for (const address of ['127.0.0.1', '127.22.3.4', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f02:3']) assert.equal(isLoopback(address), true);
    for (const address of ['192.168.1.1', '::2', '::ffff:192.168.1.1', '127.0.0.1.evil', undefined]) assert.equal(isLoopback(address), false);
    for (const scenario of ['disabled', 'remote', 'origin', 'normal']) {
        const fixture = fake(); if (scenario === 'disabled') fixture.env.APIFORGE_LIVE_RUNNER = '0';
        const app = express();
        if (scenario === 'remote') app.use((req, res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '10.0.0.3' }); next(); });
        app.use('/api/live', createRouter(fixture.manager));
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        try {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/live/status', {
                headers: { 'x-forwarded-for': '127.0.0.1', ...(scenario === 'origin' ? { origin: 'https://hostile.example' } : {}) } });
            const data = await response.json();
            assert.equal(response.status, scenario === 'normal' ? 200 : 403);
            if (scenario !== 'normal') assert.equal(data.code, scenario === 'disabled' ? 'LIVE_DISABLED' : 'LIVE_NOT_LOCAL');
            assert(!JSON.stringify(data).includes('PRIVATE_PASSWORD')); checks++;
            if (scenario === 'normal') {
                const bad = await fetch('http://127.0.0.1:' + server.address().port + '/api/live/start', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
                assert.equal((await bad.json()).code, 'LIVE_REQUEST_INVALID'); checks++;
            }
        } finally { await new Promise(resolve => server.close(resolve)); }
    }
}
async function hostAdmission() {
    const accepted = ['localhost', 'localhost:3001', 'LOCALHOST:80', 'localhost:65535',
        '127.0.0.1', '127.0.0.1:3001', '127.22.3.4:8080', '127.255.255.255:1',
        '[::1]', '[::1]:3001', '[0:0:0:0:0:0:0:1]:3001',
        '[::ffff:127.0.0.1]:3001', '[::ffff:7f02:3]:3001'];
    const rejected = ['attacker.example', 'attacker.example:3001', 'localhost.attacker.example',
        '127.0.0.1.attacker.example', 'attacker@localhost', 'attacker@localhost:3001',
        'localhost@attacker.example', 'http://localhost:3001', '//localhost',
        'localhost/path', 'localhost?query', 'localhost#fragment', 'localhost\\attacker',
        'localhost.', ' localhost', 'localhost ', 'localhost\n', 'localhost\r\n',
        'localhost:0', 'localhost:65536', 'localhost:-1', 'localhost:abc', 'localhost:',
        'localhost:80:90', 'localhost:000001', 'localhost,attacker.example',
        '192.168.1.1:3001', '0.0.0.0:3001', '128.0.0.1', '127.0.0.256:3001',
        '127.000.0.1', '127.1', '2130706433', '0x7f000001',
        '::1', '::1:3001', '[127.0.0.1]:3001', '[::2]:3001', '[::ffff:192.168.1.1]:3001',
        '[::1', '::1]', '[::1]extra', '[::1%25lo]:3001', '%6cocalhost', '', undefined, null, ['localhost']];
    for (const host of accepted) { assert.equal(isLocalHostHeader(host), true, String(host)); checks++; }
    for (const host of rejected) { assert.equal(isLocalHostHeader(host), false, String(host)); checks++; }
    const app = express();
    // Even when Express trusts proxies, raw Host/socket validation must win.
    app.set('trust proxy', true);
    app.use('/api/live', createRouter(fake().manager));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    async function get(headers) {
        return new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: '/api/live/status', headers }, res => {
                let text = ''; res.on('data', chunk => { text += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
            });
            req.on('error', reject); req.end();
        });
    }
    try {
        const hostile = 'attacker.example:' + port;
        for (const [label, headers] of [
            ['DNS rebinding, matching Origin', { host: hostile, origin: 'http://' + hostile }],
            ['hostile Host, no Origin', { host: hostile }],
            ['proxy headers cannot authorize hostile Host', { host: hostile, origin: 'http://' + hostile,
                'x-forwarded-host': 'localhost:' + port, 'x-forwarded-for': '127.0.0.1',
                forwarded: 'for=127.0.0.1;host=localhost:' + port }],
            ['proxy headers cannot authorize hostile Host without Origin', { host: hostile,
                'x-forwarded-host': 'localhost:' + port, 'x-forwarded-for': '127.0.0.1',
                forwarded: 'for=127.0.0.1;host=localhost:' + port }]
        ]) {
            const response = await get(headers);
            assert.equal(response.status, 403, label); assert.equal(response.body.code, 'LIVE_NOT_LOCAL', label); checks++;
            console.log('PASS Host admission: ' + label + ' -> 403 LIVE_NOT_LOCAL');
        }
        for (const host of accepted) for (const origin of [undefined, 'http://' + host]) {
            const response = await get({ host, ...(origin ? { origin } : {}) });
            assert.equal(response.status, 200, host); assert.equal(response.body.success, true); checks++;
        }
        const wrongOrigin = await get({ host: 'localhost:' + port, origin: 'http://attacker.example:' + port });
        assert.equal(wrongOrigin.status, 403); assert.equal(wrongOrigin.body.code, 'LIVE_NOT_LOCAL'); checks++;
        console.log('PASS Host admission: all supported local authorities with/without matching Origin; mismatched Origin rejected');
    } finally { await new Promise(resolve => server.close(resolve)); }
}
async function lifecycle() {
    const f = fake();
    f.env.APIFORGE_LIVE_RUNNER = '0'; await rejects(() => f.manager.start({ source, target: 'mysql' }), 'LIVE_DISABLED');
    f.env.APIFORGE_LIVE_RUNNER = '1';
    await rejects(() => f.manager.start({ source, target: 'sqlite' }), 'LIVE_REQUEST_INVALID');
    await rejects(() => f.manager.start({ source, target: 'postgres' }), 'LIVE_TARGET_NOT_CONFIGURED');
    await rejects(() => f.manager.start({ source, target: 'mysql', generatedFiles: [] }), 'LIVE_REQUEST_INVALID');
    await rejects(() => f.manager.start({ source: 'ENTITY Bad\nx UNKNOWN', target: 'mysql' }), 'LIVE_COMPILE_FAILED');
    await rejects(() => f.manager.start({ source: 'IMPORT "../../secret.apiforge"', target: 'mysql' }), 'LIVE_COMPILE_FAILED');
    const start = await f.manager.start({ source, target: 'mysql' }); assert.match(start.sessionId, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(start).sort(), ['endpointCount', 'expiresAt', 'sessionId', 'success', 'target']);
    assert(!JSON.stringify(f.manager.status()).includes(start.sessionId)); checks++;
    await rejects(() => f.manager.request({ sessionId: 'wrong', method: 'GET', path: '/users' }), 'LIVE_SESSION_INVALID');
    assert.equal((await f.manager.request({ sessionId: start.sessionId, method: 'GET', path: '/users' })).status, 404); checks++;
    await rejects(() => f.manager.request({ sessionId: start.sessionId, method: 'GET', path: '/health' }), 'LIVE_ENDPOINT_NOT_ALLOWED');
    await rejects(() => f.manager.request({ sessionId: start.sessionId, method: 'POST', path: '/users', body: 'x'.repeat(65536) }), 'LIVE_REQUEST_INVALID');
    const [a, b] = await Promise.all([f.manager.start({ source, target: 'mysql' }), f.manager.start({ source, target: 'mysql' })]);
    assert.notEqual(a.sessionId, b.sessionId); assert.equal(f.maximum(), 1); checks++;
    await rejects(() => f.manager.stop({ sessionId: a.sessionId }), 'LIVE_SESSION_INVALID');
    await f.manager.stop({ sessionId: b.sessionId });
    await rejects(() => f.manager.stop({ sessionId: b.sessionId }), 'LIVE_SESSION_INVALID');
    const next = f.manager.start({ source, target: 'mysql' });
    const stopping = next.then(result => f.manager.stop({ sessionId: result.sessionId }));
    await Promise.all([next, stopping]); assert.equal(f.manager.status().active, false); checks++;
    for (const failure of ['directory', 'materialize', 'setup', 'port', 'launch', 'health']) {
        const broken = fake({ failure });
        try { await broken.manager.start({ source, target: 'mysql' }); assert.fail('Expected failure'); }
        catch (error) { assert(!JSON.stringify(publicError(error)).includes('PRIVATE_PASSWORD')); }
        for (const step of ['stop', 'released', 'remove']) assert(broken.events.includes(step), failure + ' cleanup ' + step);
        if (['setup', 'port', 'launch', 'health'].includes(failure)) for (const step of ['close', 'drop']) assert(broken.events.includes(step));
        assert.equal(broken.manager.status().active, false); checks++;
    }
    for (const failure of ['stop', 'released', 'close', 'drop', 'remove']) {
        const broken = fake({ failure }); const session = await broken.manager.start({ source, target: 'mysql' });
        await rejects(() => broken.manager.stop({ sessionId: session.sessionId }), 'LIVE_CLEANUP_FAILED');
        assert(broken.events.includes('remove'), 'Cleanup continues after ' + failure);
        await rejects(() => broken.manager.start({ source, target: 'mysql' }), 'LIVE_CLEANUP_FAILED');
        assert.equal(broken.events.filter(event => event === 'launch').length, 1);
    }
    const ttl = fake({ ttlMs: 15 }); await ttl.manager.start({ source, target: 'mysql' }); await delay(60);
    assert.equal(ttl.manager.status().active, false);
    for (const step of ['stop', 'released', 'close', 'drop', 'remove']) assert(ttl.events.includes(step));
    assert.equal(TTL_MS, 900000); checks++;
}
async function pathsAndTransport() {
    const allowed = operations(compile(source, 'mysql'));
    assert.equal(allowed.length, 5);
    validatePath('GET', '/users/abc?limit=20', allowed);
    validatePath('GET', '/users/a%26b', allowed);
    for (const method of ['PATCH', 'OPTIONS', 'HEAD', 'TRACE']) {
        const list = operations([{ path: 'swagger.json', content: JSON.stringify({ paths: { '/items/{id}': { [method.toLowerCase()]: {} } } }) }]);
        validatePath(method, '/items/value', list); checks++;
    }
    for (const value of ['https://evil/users', '//evil/users', '/users/../users', '/users/%2e%2e', '/users/a%2Fb',
        '/users/%252e%252e', '/users/a%5cb', '/users/a#fragment', '/users/%', '/users/a%3fb']) {
        assert.throws(() => validatePath('GET', value, allowed), error => error.code === 'LIVE_REQUEST_INVALID'); checks++;
    }
    for (const value of ['/users/a/b', '/unrelated', '/users/']) assert.throws(() => validatePath('GET', value, allowed));
    assert.throws(() => validatePath('POST', '/users/a', allowed));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apiforge-live-test-'));
    try {
        for (const name of ['', '/absolute', 'C:/absolute', '../escape', 'a/../../escape', 'a\\b', '.', 'a//b', 'a/..']) assert.throws(() => containedPath(root, name));
        await assert.rejects(() => materialize(root, [{ path: 'safe', content: 'safe' }, { path: '../bad', content: 'bad' }]));
        assert.deepEqual(await fs.readdir(root), []); checks++;
        await materialize(root, [{ path: 'a/file.txt', content: 'exact\r\nbytes' }]);
        assert.equal(await fs.readFile(path.join(root, 'a/file.txt'), 'utf8'), 'exact\r\nbytes');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
    assert.equal(configuration('postgres', { APIFORGE_LIVE_PG_HOST: 'localhost', APIFORGE_LIVE_PG_PORT: '5432',
        APIFORGE_LIVE_PG_USER: 'demo', APIFORGE_LIVE_PG_PASSWORD: '' }).adminDatabase, 'postgres');
    assert.equal(configuration('mysql', { DB_PASSWORD: 'PRIVATE_PASSWORD' }), null);
    assert.throws(() => serializeBody('x'.repeat(65536))); checks++;
    const server = http.createServer((req, res) => {
        if (req.url === '/timeout') return;
        if (req.url === '/large') return res.end('x'.repeat(1000));
        res.writeHead(Number(req.url.slice(1)) || 200, { 'content-type': 'application/json', 'x-total-count': '3',
            'x-page': '1', 'x-limit': '20', 'x-total-pages': '1', 'connection': 'close', 'set-cookie': 'PRIVATE' });
        res.end(JSON.stringify({ success: false, message: '<script>untrusted</script>' }));
    });
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    try {
        for (const code of [200, 400, 404, 500]) {
            const response = await request(server.address().port, 'GET', '/' + code);
            assert.equal(response.success, true); assert.equal(response.status, code);
            assert.equal(response.body.message, '<script>untrusted</script>');
            assert.deepEqual(Object.keys(response.headers).sort(), ['content-type', 'x-limit', 'x-page', 'x-total-count', 'x-total-pages']); checks++;
        }
        await rejects(() => request(server.address().port, 'GET', '/large', undefined, { responseLimit: 100 }), 'LIVE_RESPONSE_TOO_LARGE');
        await rejects(() => request(server.address().port, 'GET', '/timeout', undefined, { timeoutMs: 20 }), 'LIVE_REQUEST_TIMEOUT');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
(async () => {
    await apiEquivalence(); await routes(); await hostAdmission(); await lifecycle(); await pathsAndTransport();
    console.log('PASS Live API offline: ' + checks + ' evidence checks, exact complete generated arrays on both targets; lifecycle/security/bounds.');
})().catch(error => { console.error(error); process.exitCode = 1; });
