'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawnSync, fork } = require('node:child_process');
const express = require('express');
const { fixture } = require('./persistent-runtime-fakes');
const { createManager } = require('../src/persistent-runtime/manager');
const { configuration, postgresClient } = require('../src/persistent-runtime/database');
const { build, hash, NAME } = require('../src/persistent-runtime/provenance');
const { createPersistentApi, TOKEN_HEADER, BODY_LIMIT, isLoopback, isLocalHostHeader } = require('../src/api/persistent-runtime-api');
const results = [];
async function test(name, action) {
    try { await action(); results.push({ name, status: 'PASS' }); console.log('OFFLINE PASS ' + name); }
    catch (error) { results.push({ name, status: 'FAIL' }); console.error('OFFLINE FAIL ' + name + ': ' + error.message); process.exitCode = 1; }
}
const rejects = (action, code) => assert.rejects(action, error => error.code === code && !/PRIVATE_SECRET|C:\\private/.test(error.message));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function lifecycle(target) {
    await test(target + ' explicit-only provisioning, preserved state and independent-manager reopen', async () => {
        const f = fixture(target), a = f.makeManager();
        assert.equal((await a.status(f.input())).state, 'absent'); assert.equal(f.native.databases.size, 0);
        await rejects(() => a.start(f.input()), 'PERSISTENT_DATABASE_MISSING');
        await a.initialize(f.input()); const db = f.native.databases.get(f.identity().name);
        assert.equal(db.imports, 1); db.applicationRows.push({ id: 1, name: 'offline retained' });
        const session = await a.start(f.input()); assert.match(session.sessionId, /^[a-f0-9]{64}$/);
        assert.equal((await a.status(f.input())).state, 'running');
        assert(!JSON.stringify(session).includes(f.identity().name)); assert(!JSON.stringify(session).includes('PRIVATE_SECRET'));
        await rejects(() => a.initialize(f.input()), 'PERSISTENT_BUSY');
        await a.stop({ sessionId: session.sessionId }); await a.stop({ sessionId: session.sessionId });
        assert.equal(db.record.runtime_owner, null); assert.equal(db.imports, 1); assert.equal(db.applicationRows.length, 1);
        await a.shutdown(); const b = f.makeManager(); assert.equal((await b.status(f.input())).state, 'stopped');
        const reopened = await b.start(f.input()); assert.notEqual(reopened.sessionId, session.sessionId);
        await b.stop({ sessionId: reopened.sessionId });
        await rejects(() => b.initialize(f.input()), 'PERSISTENT_ALREADY_INITIALIZED');
        assert.equal(db.imports, 1); assert.deepEqual(db.applicationRows, [{ id: 1, name: 'offline retained' }]);
        assert(!f.native.sql.some(entry => /DROP |ALTER |TRUNCATE |DELETE FROM/i.test(entry.text)));
    });
    await test(target + ' two independent managers and simultaneous starts obtain one durable claim', async () => {
        const f = fixture(target), a = f.makeManager(), b = f.makeManager(); await a.initialize(f.input());
        const answers = await Promise.allSettled([a.start(f.input()), b.start(f.input())]);
        assert.equal(answers.filter(answer => answer.status === 'fulfilled').length, 1);
        assert.equal(answers.find(answer => answer.status === 'rejected').reason.code, 'PERSISTENT_BUSY');
        assert.equal(f.events.filter(event => event === 'launch').length, 1);
        const index = answers.findIndex(answer => answer.status === 'fulfilled');
        await [a, b][index].stop({ sessionId: answers[index].value.sessionId });
        const recovered = await [a, b][1 - index].start(f.input()); await [a, b][1 - index].stop({ sessionId: recovered.sessionId });
    });
    await test(target + ' connection loss cannot expire a claim while an owned API exists', async () => {
        const f = fixture(target), a = f.makeManager(), b = f.makeManager(); await a.initialize(f.input());
        const active = await a.start(f.input()), db = f.native.databases.get(f.identity().name), owner = db.record.runtime_owner;
        f.native.unavailable(true); await rejects(() => b.start(f.input()), 'PERSISTENT_DATABASE_UNAVAILABLE');
        assert.equal(db.record.runtime_owner, owner); assert.equal(f.children[0].child.exitCode, null);
        f.native.unavailable(false); await rejects(() => b.start(f.input()), 'PERSISTENT_BUSY');
        await a.stop({ sessionId: active.sessionId });
    });
    for (const stage of ['create:after', 'marker:before', 'marker:after', 'schema:before', 'schema:after', 'ready:after']) {
        await test(target + ' uncertain provisioning ' + stage + ' preserves state without replay', async () => {
            const f = fixture(target), manager = f.makeManager(); f.native.fault(stage);
            await rejects(() => manager.initialize(f.input()), 'PERSISTENT_PROVISION_UNCERTAIN');
            const db = f.native.databases.get(f.identity().name); assert(db);
            const before = JSON.stringify(db);
            await assert.rejects(() => f.makeManager().initialize(f.input())); assert.equal(JSON.stringify(db), before);
            if (db.record?.state === 'ready') { const s = await f.makeManager().start(f.input()); assert(s.sessionId); }
            else await assert.rejects(() => f.makeManager().start(f.input()));
            assert(!f.native.sql.some(entry => /DROP |TRUNCATE/i.test(entry.text)));
        });
    }
    await test(target + ' lost claim acknowledgement launches no child and blocks replacement', async () => {
        const f = fixture(target), a = f.makeManager(); await a.initialize(f.input()); f.native.fault('claim:after');
        await rejects(() => a.start(f.input()), 'PERSISTENT_CLAIM_UNCERTAIN'); assert(!f.events.includes('launch'));
        await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY');
    });
    await test(target + ' concurrent initialization and queued Initialize/Start/Stop never replay schema or overlap children', async () => {
        const f = fixture(target), a = f.makeManager(), b = f.makeManager();
        const competing = await Promise.allSettled([a.initialize(f.input()), b.initialize(f.input())]);
        assert.equal(competing.filter(value => value.status === 'fulfilled').length, 1);
        assert(['PERSISTENT_ALREADY_INITIALIZED', 'PERSISTENT_INCOMPLETE', 'PERSISTENT_PROVISION_UNCERTAIN'].includes(competing.find(value => value.status === 'rejected').reason.code));
        assert.equal(f.native.databases.size, 1); assert.equal(f.native.databases.get(f.identity().name).imports, 1);
        const g = fixture(target), manager = g.makeManager();
        const initialized = manager.initialize(g.input()), started = manager.start(g.input());
        const refused = rejects(() => manager.initialize(g.input()), 'PERSISTENT_BUSY');
        await initialized; const first = await started; await refused;
        const stopped = manager.stop({ sessionId: first.sessionId }), restarted = manager.start(g.input());
        await stopped; const second = await restarted;
        assert.notEqual(first.sessionId, second.sessionId);
        assert.equal(g.children.filter(state => state.child.exitCode === null).length, 1);
        assert.equal(g.native.databases.get(g.identity().name).imports, 1);
        await manager.stop({ sessionId: second.sessionId });
    });
    await test(target + ' lost release receipt retains local failure and cannot clear a later manager claim', async () => {
        const f = fixture(target), a = f.makeManager(), b = f.makeManager(); await a.initialize(f.input());
        const first = await a.start(f.input()); f.native.fault('release:after');
        await rejects(() => a.stop({ sessionId: first.sessionId }), 'PERSISTENT_CLEANUP_FAILED');
        assert.notEqual(f.children[0].child.exitCode, null);
        assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null);
        await rejects(() => a.start(f.input()), 'PERSISTENT_CLEANUP_FAILED');
        const second = await b.start(f.input()), owner = f.native.databases.get(f.identity().name).record.runtime_owner;
        await rejects(() => a.stop({ sessionId: first.sessionId }), 'PERSISTENT_CLEANUP_FAILED');
        assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, owner);
        assert.equal(f.children[1].child.exitCode, null);
        await b.stop({ sessionId: second.sessionId });
    });
    await test(target + ' stalled owned connection close is bounded and destroys its socket without provisioning', async () => {
        const f = fixture(target); let destroyed = 0;
        f.dependencies.resource = (identity, config) => require('../src/persistent-runtime/database').resource(identity, config, {
            connector: async (...args) => {
                const connection = await f.native.connector(...args);
                connection.end = () => new Promise(() => {});
                if (target === 'mysql') connection.destroy = () => { destroyed++; };
                else connection.connection = { stream: { destroy() { destroyed++; } } };
                return connection;
            }
        });
        const began = Date.now(); await rejects(() => f.makeManager().initialize(f.input()), 'PERSISTENT_DATABASE_UNAVAILABLE');
        assert(Date.now() - began >= 1900); assert(Date.now() - began < 4000);
        assert(destroyed >= 1); assert.equal(f.native.databases.size, 0);
        assert(!f.native.sql.some(entry => /CREATE |DROP /i.test(entry.text)));
    });
    await test(target + ' observed child exit recovers only its verified claim', async () => {
        const f = fixture(target), a = f.makeManager(); await a.initialize(f.input()); await a.start(f.input());
        f.children[0].child.exitCode = 1; f.children[0].child.emit('exit'); await pause(20);
        assert.equal((await a.status(f.input())).state, 'stopped');
        const restarted = await f.makeManager().start(f.input()); assert(restarted.sessionId);
    });
    await test(target + ' abandoned manager leaves occupied claim for manual recovery', async () => {
        const f = fixture(target), a = f.makeManager(); await a.initialize(f.input()); await a.start(f.input());
        // No cleanup or TTL is invoked: simulates lost supervisor ownership only.
        assert.equal((await f.makeManager().status(f.input())).state, 'occupied');
        await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY');
        await a.shutdown();
    });
    for (const failure of ['health', 'stop', 'released', 'remove']) await test(target + ' bounded cleanup refusal ' + failure, async () => {
        const f = fixture(target), a = f.makeManager(); await a.initialize(f.input());
        if (failure === 'health') {
            f.processFault(failure); await rejects(() => a.start(f.input()), 'PERSISTENT_START_FAILED');
            assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null);
        } else {
            const session = await a.start(f.input()); f.processFault(failure);
            await rejects(() => a.stop({ sessionId: session.sessionId }), 'PERSISTENT_CLEANUP_FAILED');
            assert(f.native.databases.get(f.identity().name).record.runtime_owner);
            await rejects(() => a.start(f.input()), 'PERSISTENT_CLEANUP_FAILED');
            await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY');
            f.processFault(null); await a.stop({ sessionId: session.sessionId });
        }
    });
    await test(target + ' stale revision, changed artifacts and unknown ownership refuse without DDL', async () => {
        const f = fixture(target), manager = f.makeManager(); await manager.initialize(f.input());
        const db = f.native.databases.get(f.identity().name), sqlStart = f.native.sql.length;
        await rejects(() => manager.start({ ...f.input(), expectedRevision: 2 }), 'PERSISTENT_REVISION_MISMATCH');
        f.transform(files => files.map(file => ({ ...file, content: file.content + '\n' })));
        await rejects(() => manager.start(f.input()), 'PERSISTENT_ARTIFACT_CHANGED'); f.transform(value => value);
        f.project.source += '\nother STRING'; f.project.revision = 2; f.project.sourceHash = hash(f.project.source);
        await rejects(() => manager.start(f.input()), 'PERSISTENT_REVISION_MISMATCH');
        assert(!f.native.sql.slice(sqlStart).some(entry => /CREATE |ALTER |DROP |INSERT/i.test(entry.text)));
        db.record.provenance = '[]'; await rejects(() => manager.start(f.input()), 'PERSISTENT_DATABASE_COLLISION');
    });
}
async function serve(controller, remote) {
    const app = express(); app.set('trust proxy', true);
    if (remote) app.use((req, res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: remote }); next(); });
    app.use('/api/persistent', controller.router);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    const call = (method, url, value, headers = {}) => new Promise((resolve, reject) => {
        const body = Buffer.isBuffer(value) ? value : value === undefined ? undefined : Buffer.from(JSON.stringify(value));
        const request = http.request({ hostname: '127.0.0.1', port, method, path: url,
            headers: { host: '127.0.0.1:' + port, ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {}), ...headers } }, res => {
            let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, data: text ? JSON.parse(text) : null, headers: res.headers }));
        }); request.once('error', reject); request.end(body);
    });
    return { call, port, async close() { await controller.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function security() {
    await test('disabled startup/import keeps SQLite, store, filesystem and drivers lazy', async () => {
        const source = "const M=require('module'),o=M._load;M._load=function(id,...a){if(id==='node:sqlite'||id==='../project-store'||id==='mysql2/promise'||id==='pg')throw Error('eager');return o.call(this,id,...a)};const m=require('./src/persistent-runtime/manager').createManager({env:{}});m.shutdown();require('./src/api/persistent-runtime-api').createPersistentApi({env:{}});require('./server');";
        const run = spawnSync(process.execPath, ['-e', source], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, APIFORGE_PERSISTENT_RUNNER: '0', APIFORGE_PROJECT_API: '0' } });
        assert.equal(run.status, 0, run.stderr);
        const manager = createManager({ env: {} }); await rejects(() => manager.initialize({}), 'PERSISTENT_DISABLED');
    });
    await test('configuration has no generic, Live, test, hostname or environment-file fallback', async () => {
        for (const env of [{ DB_HOST: '127.0.0.1' }, { APIFORGE_LIVE_MYSQL_HOST: '127.0.0.1' }, { APIFORGE_TEST_DB_HOST: '127.0.0.1' }]) {
            assert.throws(() => configuration('mysql', env), error => error.code === 'PERSISTENT_CONFIGURATION_UNAVAILABLE');
        }
        const f = fixture(); for (const value of ['localhost', 'example.com', '192.168.1.1', '127.1']) {
            assert.throws(() => configuration('mysql', { ...f.env, APIFORGE_PERSISTENT_MYSQL_HOST: value }));
        }
    });
    await test('MySQL hidden inaccessible database is unavailable and cannot authorize CREATE', async () => {
        const f = fixture(), original = f.native.connector;
        f.dependencies.resource = (identity, config) => require('../src/persistent-runtime/database').resource(identity, config, {
            connector: async (name, ...args) => {
                if (name) { const error = Error('PRIVATE_SECRET'); error.code = 'ER_DBACCESS_DENIED_ERROR'; throw error; }
                return original(name, ...args);
            }
        });
        const manager = f.makeManager();
        await rejects(() => manager.status(f.input()), 'PERSISTENT_DATABASE_UNAVAILABLE');
        await rejects(() => manager.initialize(f.input()), 'PERSISTENT_DATABASE_UNAVAILABLE');
        assert(!f.native.sql.some(entry => /CREATE |DROP /i.test(entry.text)));
    });
    await test('complete artifact hashing and reserved metadata namespace', async () => {
        const f = fixture(), id = f.identity(); assert(NAME.test(id.name)); assert(id.name.length <= 63);
        const files = require('../src/live-runner/compile').compile(f.project.source, 'mysql');
        assert.throws(() => build(id.values[1], f.project, files.map(file => file.path === 'database/schema.sql' ? { ...file, content: file.content + '__apiforge_runtime_v1' } : file)), error => error.code === 'PERSISTENT_SCHEMA_RESERVED');
        for (const field of ['database', 'credentials', 'source', 'root']) await rejects(() => f.makeManager().initialize({ ...f.input(), [field]: 'unsafe' }), 'PERSISTENT_REQUEST_INVALID');
    });
    await test('saved-source compiler equals the complete published API files on both targets, including sources above 256 KiB', async () => {
        const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api', require('../src/api/compiler-api'));
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        try {
            const source = require('./persistent-runtime-fakes').SOURCE + '\n' + ' '.repeat(300 * 1024);
            for (const target of ['mysql', 'postgres']) {
                const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/compile', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, target }) });
                const normal = await response.json(); assert.equal(normal.success, true);
                assert.deepEqual(require('../src/persistent-runtime/compile').compile(source, target), normal.generatedFiles);
            }
            assert.throws(() => require('../src/persistent-runtime/compile').compile('IMPORT "private.apiforge"', 'mysql'), error => error.code === 'PERSISTENT_COMPILE_FAILED');
        } finally { await new Promise(resolve => server.close(resolve)); }
    });
    await test('actual pg constructor cannot inherit a generic password, SSL, options or replication setting', async () => {
        const keys = ['PGPASSWORD', 'PGSSLMODE', 'PGOPTIONS', 'PGREPLICATION'], saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
        try {
            Object.assign(process.env, { PGPASSWORD: 'UNRELATED_SECRET', PGSSLMODE: 'require', PGOPTIONS: '-c synchronous_commit=off', PGREPLICATION: 'database' });
            const client = postgresClient({ host: '127.0.0.1', port: 5432, user: 'test', password: '', adminDatabase: 'postgres' });
            assert.equal(await client.connectionParameters.password(), ''); assert.equal(client.connectionParameters.ssl, false);
            assert.equal(client.connectionParameters.options, '-c statement_timeout=8000'); assert.equal(client.connectionParameters.replication, 'false');
            await client.end();
        } finally { for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    });
    await test('literal loopback and Host helpers reject aliases', async () => {
        for (const value of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert(isLoopback(value));
        for (const value of ['10.0.0.1', '::2', '127.1', undefined]) assert(!isLoopback(value));
        for (const value of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001']) assert(isLocalHostHeader(value));
        for (const value of ['localhost.evil:3001', '127.1:3001', '2130706433', 'user@localhost', '[::1%25lo]:3001']) assert(!isLocalHostHeader(value));
    });
    await test('HTTP enablement, raw peer, Host, listener port, origins, metadata and rotated tokens', async () => {
        const f = fixture(), controller = createPersistentApi({ env: f.env, manager: f.makeManager() }), server = await serve(controller);
        try {
            const session = await server.call('GET', '/api/persistent/session'); assert.equal(session.status, 200);
            const token = session.data.data.token, auth = { [TOKEN_HEADER]: token }; assert.equal(session.headers['access-control-allow-origin'], undefined);
            const another = createPersistentApi({ env: f.env, manager: f.makeManager() }), other = await serve(another);
            try { assert.notEqual((await other.call('GET', '/api/persistent/session')).data.data.token, token); } finally { await other.close(); }
            for (const headers of [{}, { [TOKEN_HEADER]: 'bad' }, { [TOKEN_HEADER]: [token, token] }]) assert.equal((await server.call('POST', '/api/persistent/status', f.input(), headers)).status, 403);
            for (const headers of [{ host: 'attacker.example:' + server.port, 'x-forwarded-host': '127.0.0.1:' + server.port }, { host: '127.0.0.1:1' }]) assert.equal((await server.call('GET', '/api/persistent/session', undefined, headers)).data.error.code, 'PERSISTENT_NOT_LOCAL');
            for (const headers of [{ origin: 'https://evil' }, { origin: 'null' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-mode': 'navigate' }, { 'sec-fetch-dest': 'document' }, { origin: ['http://127.0.0.1:' + server.port, 'http://127.0.0.1:' + server.port] }]) assert.equal((await server.call('GET', '/api/persistent/session', undefined, headers)).data.error.code, 'PERSISTENT_ORIGIN_REFUSED');
            const valid = await server.call('POST', '/api/persistent/status', f.input(), { ...auth, origin: 'http://127.0.0.1:' + server.port }); assert.equal(valid.status, 200);
        } finally { await server.close(); }
        const remote = await serve(createPersistentApi({ env: f.env, manager: f.makeManager() }), '10.0.0.1');
        try { assert.equal((await remote.call('GET', '/api/persistent/session', undefined, { 'x-forwarded-for': '127.0.0.1' })).status, 403); } finally { await remote.close(); }
        const disabled = await serve(createPersistentApi({ env: {} }));
        try { assert.equal((await disabled.call('GET', '/api/persistent/session')).data.error.code, 'PERSISTENT_DISABLED'); } finally { await disabled.close(); }
    });
    await test('HTTP strict routes, media, JSON, selectors, forwarding and size bounds', async () => {
        const f = fixture(), server = await serve(createPersistentApi({ env: f.env, manager: f.makeManager() }));
        try {
            const auth = { [TOKEN_HEADER]: (await server.call('GET', '/api/persistent/session')).data.data.token };
            for (const [method, url] of [['GET', '/api/persistent/status'], ['POST', '/api/persistent/initialize/'], ['POST', '/api/persistent/sql'], ['OPTIONS', '/api/persistent/session'], ['POST', '/api/persistent/start?token=x'], ['POST', '/api/Persistent/start'], ['POST', '/api/persistent/%73tart']]) assert((await server.call(method, url, {}, auth)).status >= 400);
            assert.equal((await server.call('POST', '/api/persistent/status', f.input(), { ...auth, 'content-type': 'text/plain' })).status, 415);
            assert.equal((await server.call('POST', '/api/persistent/status', f.input(), { ...auth, 'content-encoding': 'gzip' })).status, 415);
            for (const body of [Buffer.from('{bad'), Buffer.from([0xc0, 0x80]), [], null]) assert.equal((await server.call('POST', '/api/persistent/status', body, auth)).status, 400);
            assert.equal((await server.call('POST', '/api/persistent/status', Buffer.alloc(BODY_LIMIT + 1), auth)).status, 413);
            assert.equal((await server.call('POST', '/api/persistent/initialize', { ...f.input(), database: 'real' }, auth)).status, 400);
            assert.equal((await server.call('POST', '/api/persistent/initialize', f.input(), auth)).status, 201);
            const sessionId = (await server.call('POST', '/api/persistent/start', f.input(), auth)).data.data.sessionId;
            for (const value of ['https://evil/items', '//evil/items', '/items/../items', '/items/%252e%252e', '/items/a%2Fb', '/health']) assert((await server.call('POST', '/api/persistent/request', { sessionId, method: 'GET', path: value }, auth)).status >= 400);
            assert.equal((await server.call('POST', '/api/persistent/request', { sessionId, method: 'GET', path: '/items' }, auth)).status, 200);
            f.response('x'.repeat(2 * 1024 * 1024)); assert.equal((await server.call('POST', '/api/persistent/request', { sessionId, method: 'GET', path: '/items' }, auth)).status, 502);
            await server.call('POST', '/api/persistent/stop', { sessionId }, auth);
        } finally { await server.close(); }
    });
    await test('shutdown drains accepted work, blocks new work and retains data', async () => {
        const f = fixture(), manager = f.makeManager(); await manager.initialize(f.input());
        const start = manager.start(f.input()), closing = manager.shutdown(); await start; await closing;
        await rejects(() => manager.start(f.input()), 'PERSISTENT_STOPPING');
        assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null);
        assert.equal(f.native.databases.get(f.identity().name).imports, 1);
        assert.strictEqual(manager.shutdown(), closing);
    });
    await test('actual owned Node process is loopback, health-checked and terminated without disturbing another listener', async () => {
        const files = require('../src/live-runner/materialize'), runtime = require('../src/persistent-runtime/process');
        const root = await files.createProject(); let state, port;
        const untouched = http.createServer((req, res) => res.end('still available'));
        untouched.listen(0, '127.0.0.1'); await new Promise(resolve => untouched.once('listening', resolve));
        try {
            await files.materialize(root, [{ path: 'server.js', content: "require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'UP'}))}).listen(Number(process.env.PORT));" }]);
            port = await runtime.freePort(); state = runtime.launch(root, port, { host: '127.0.0.1', port: 1, user: 'controlled', password: 'controlled' }, 'controlled');
            await runtime.health(state, port); assert.equal(runtime.ready(state), true);
            await runtime.stop(state); await runtime.released(port);
            assert.equal(state.listenerReady, false); assert.equal(state.failed, true); assert.equal(runtime.ready(state), false);
            assert(state.child.exitCode !== null || state.child.signalCode !== null);
            assert.equal(await (await fetch('http://127.0.0.1:' + untouched.address().port)).text(), 'still available');
        } finally {
            if (state) await runtime.stop(state);
            await new Promise(resolve => untouched.close(resolve)); await files.removeProject(root);
        }
    });
}
async function listenerOwnershipProof() {
    await test('forwarding refuses an owned listener that closed while its child is still alive', async () => {
        const f = fixture(), manager = f.makeManager(); let forwarded = 0;
        f.dependencies.request = async () => { forwarded++; return {}; };
        await manager.initialize(f.input()); const session = await manager.start(f.input());
        f.children[0].listenerReady = false;
        await rejects(() => manager.request({ sessionId: session.sessionId, method: 'GET', path: '/items' }), 'PERSISTENT_REQUEST_FAILED');
        assert.equal(forwarded, 0); assert.notEqual(f.children[0].child.exitCode, null);
        assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null);
    });
    await test('another healthy listener cannot acknowledge ownership of the generated child port', async () => {
        const files = require('../src/live-runner/materialize'), runtime = require('../src/persistent-runtime/process');
        const root = await files.createProject(); let state;
        const sentinel = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'UP' })); });
        sentinel.listen(0, '127.0.0.1'); await new Promise(resolve => sentinel.once('listening', resolve));
        try {
            const port = sentinel.address().port;
            await files.materialize(root, [{ path: 'server.js', content: 'setTimeout(()=>require("http").createServer((q,s)=>s.end()).listen(Number(process.env.PORT)),2000)' }]);
            state = runtime.launch(root, port, { host: '127.0.0.1', port: 1, user: 'controlled', password: 'controlled' }, 'controlled');
            await rejects(() => runtime.health(state, port, 500), 'PERSISTENT_START_FAILED');
            assert.equal(state.listenerReady, false);
            assert.equal((await (await fetch('http://127.0.0.1:' + port)).json()).status, 'UP');
        } finally { if (state) await runtime.stop(state); await new Promise(resolve => sentinel.close(resolve)); await files.removeProject(root); }
    });
}
async function ipcReadinessProof() {
    const runtime = require('../src/persistent-runtime/process');
    const preserved = f => {
        const db = f.native.databases.get(f.identity().name);
        assert.equal(db.imports, 1); assert.deepEqual(db.applicationRows, [{ id: 1, name: 'retained across disconnect' }]);
        assert(!f.native.sql.some(entry => /DROP |ALTER |TRUNCATE |DELETE FROM/i.test(entry.text)));
    };
    const initialized = async target => {
        const f = fixture(target), manager = f.makeManager(); await manager.initialize(f.input());
        f.native.databases.get(f.identity().name).applicationRows.push({ id: 1, name: 'retained across disconnect' });
        return { f, manager };
    };
    for (const target of ['mysql', 'postgres']) {
        await test(target + ' controlled IPC loss reports occupied, blocks replacement and forwards nothing', async () => {
            const { f, manager } = await initialized(target); let forwarded = 0;
            f.dependencies.request = async () => { forwarded++; return {}; };
            const session = await manager.start(f.input()), state = f.children[0]; state.child.disconnect();
            assert.equal(state.listenerReady, false); assert.equal(runtime.ready(state), false); assert.equal(state.child.exitCode, null);
            assert.equal((await manager.status(f.input())).state, 'occupied');
            await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY');
            await rejects(() => manager.request({ sessionId: session.sessionId, method: 'GET', path: '/items' }), 'PERSISTENT_REQUEST_FAILED');
            assert.equal(forwarded, 0); assert.notEqual(state.child.exitCode, null);
            assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null); preserved(f);
        });
        for (const stage of ['before-health', 'after-health', 'final-claim', 'missing-connected']) {
            await test(target + ' controlled Start refuses IPC loss at ' + stage, async () => {
                const { f, manager } = await initialized(target);
                if (stage === 'before-health' || stage === 'missing-connected') {
                    const launch = f.dependencies.launch;
                    f.dependencies.launch = (...args) => { const state = launch(...args);
                        if (stage === 'missing-connected') delete state.child.connected; else state.child.disconnect(); return state; };
                }
                f.dependencies.health = async state => {
                    if (stage === 'after-health') state.child.disconnect();
                    else if (stage !== 'final-claim') await runtime.health(state, 1, 50);
                };
                if (stage === 'final-claim') {
                    const resource = f.dependencies.resource;
                    f.dependencies.resource = (...args) => { const db = resource(...args);
                        return { ...db, verifyClaim: async (...values) => { await db.verifyClaim(...values); f.children[0].child.disconnect(); } }; };
                }
                await rejects(() => manager.start(f.input()), 'PERSISTENT_START_FAILED');
                assert.notEqual(f.children[0].child.exitCode, null);
                assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null); preserved(f);
            });
        }
        for (const action of ['stop', 'shutdown']) await test(target + ' controlled disconnected owned child supports ' + action, async () => {
            const { f, manager } = await initialized(target), session = await manager.start(f.input());
            f.children[0].child.disconnect();
            assert(f.native.databases.get(f.identity().name).record.runtime_owner);
            if (action === 'stop') await manager.stop({ sessionId: session.sessionId }); else await manager.shutdown();
            assert.notEqual(f.children[0].child.exitCode, null);
            assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, null);
            assert.deepEqual(f.events.slice(-3), ['stop', 'released', 'remove']); preserved(f);
        });
        for (const fault of ['stop', 'released', 'remove']) await test(target + ' disconnected cleanup failure at ' + fault + ' retains claim until owned retry', async () => {
            const { f, manager } = await initialized(target), session = await manager.start(f.input());
            f.children[0].child.disconnect(); const owner = f.native.databases.get(f.identity().name).record.runtime_owner;
            f.processFault(fault); await rejects(() => manager.stop({ sessionId: session.sessionId }), 'PERSISTENT_CLEANUP_FAILED');
            assert.equal(f.native.databases.get(f.identity().name).record.runtime_owner, owner);
            await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY');
            await rejects(() => manager.start(f.input()), 'PERSISTENT_CLEANUP_FAILED');
            f.processFault(null); await manager.stop({ sessionId: session.sessionId }); preserved(f);
        });
        for (const loss of ['disconnect', 'ownership']) await test(target + ' in-flight ' + loss + ' refuses a completed response without replay', async () => {
            const { f, manager } = await initialized(target); let forwarded = 0;
            const db = f.native.databases.get(f.identity().name);
            f.dependencies.request = async () => { forwarded++;
                if (loss === 'disconnect') f.children[0].child.disconnect(); else db.record.runtime_owner = 'f'.repeat(64);
                return { status: 200, body: { uncertainWrite: true } }; };
            const running = await manager.start(f.input());
            await rejects(() => manager.request({ sessionId: running.sessionId, method: 'POST', path: '/items', body: { id: 2, name: 'uncertain' } }),
                loss === 'disconnect' ? 'PERSISTENT_REQUEST_FAILED' : 'PERSISTENT_CLEANUP_FAILED');
            assert.equal(forwarded, 1);
            if (loss === 'ownership') { assert.equal(db.record.runtime_owner, 'f'.repeat(64)); await rejects(() => f.makeManager().start(f.input()), 'PERSISTENT_BUSY'); }
            preserved(f);
        });
        await test(target + ' connected Run/OpenAPI and foreign durable owner status stay truthful', async () => {
            const { f, manager } = await initialized(target), session = await manager.start(f.input());
            assert.equal(runtime.ready(f.children[0]), true);
            assert.equal((await manager.request({ sessionId: session.sessionId, method: 'GET', path: '/items' })).status, 200);
            const files = require('../src/persistent-runtime/compile').compile(f.project.source, target);
            assert.equal(JSON.parse(files.find(file => file.path === 'swagger.json').content).openapi, '3.0.0');
            const db = f.native.databases.get(f.identity().name), owner = db.record.runtime_owner; db.record.runtime_owner = 'e'.repeat(64);
            assert.equal((await manager.status(f.input())).state, 'occupied'); db.record.runtime_owner = owner;
            await manager.stop({ sessionId: session.sessionId }); preserved(f);
        });
    }
    async function ownedChild(api, source, action) {
        const files = require('../src/live-runner/materialize'), root = await files.createProject(); let state, port;
        try {
            await files.materialize(root, [{ path: 'server.js', content: source }]); port = await api.freePort();
            state = api.launch(root, port, { host: '127.0.0.1', port: 1, user: 'controlled', password: 'controlled' }, 'controlled');
            await action(state, port);
        } finally { if (state) await api.stop(state); if (port) await api.released(port); await files.removeProject(root); }
        assert(state.child.exitCode !== null || state.child.signalCode !== null);
    }
    const server = "require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'UP'}))}).listen(Number(process.env.PORT));";
    await test('REAL NODE IPC disconnect invalidates a living listener immediately; queued authenticated messages cannot restore it', async () => {
        await ownedChild(runtime, server, async (state, port) => {
            let listenerMessage; state.child.on('message', message => { if (message.event === 'listening') listenerMessage = message; });
            await runtime.health(state, port); assert(listenerMessage); assert.equal(runtime.ready(state), true);
            const disconnected = new Promise(resolve => state.child.once('disconnect', resolve)); state.child.disconnect(); await disconnected;
            assert.equal(state.child.connected, false); assert.equal(state.child.exitCode, null); assert.equal(state.child.signalCode, null);
            assert.equal(state.listenerReady, false, 'IPC disconnect must invalidate listener readiness'); assert.equal(state.failed, true);
            state.child.emit('message', listenerMessage); assert.equal(state.listenerReady, false); assert.equal(runtime.ready(state), false);
            assert.equal((await (await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(2000) })).json()).status, 'UP');
            await rejects(() => runtime.health(state, port, 100), 'PERSISTENT_START_FAILED');
        });
    });
    await test('REAL NODE IPC loss before listener acknowledgement refuses health', async () => {
        await ownedChild(runtime, 'process.disconnect();setTimeout(()=>{' + server + '},150);', async (state, port) => {
            await rejects(() => runtime.health(state, port, 2000), 'PERSISTENT_START_FAILED'); assert.equal(runtime.ready(state), false);
        });
    });
    await test('REAL NODE IPC loss during HTTP health acknowledgement refuses admission', async () => {
        const source = "require('http').createServer((req,res)=>{if(process.connected)process.disconnect();setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'UP'}))},50)}).listen(Number(process.env.PORT));";
        await ownedChild(runtime, source, async (state, port) => { await rejects(() => runtime.health(state, port, 2000), 'PERSISTENT_START_FAILED'); assert.equal(runtime.ready(state), false); });
    });
    await test('REAL NODE error and exit invalidate readiness; authenticated messages after error remain refused', async () => {
        await ownedChild(runtime, server, async (state, port) => {
            let message; state.child.on('message', value => { if (value.event === 'listening') message = value; });
            await runtime.health(state, port); state.child.emit('error', Error('controlled error'));
            assert.equal(state.listenerReady, false); assert.equal(state.failed, true); state.child.emit('message', message); assert.equal(state.listenerReady, false);
            await runtime.stop(state); assert.equal(state.listenerReady, false); assert.equal(runtime.ready(state), false);
        });
    });
    await test('NEGATIVE CONTROL isolated test-only copy without disconnect invalidation fails the specific readiness assertion', async () => {
        const Module = require('node:module'), filename = require.resolve('../src/persistent-runtime/process');
        const source = fs.readFileSync(filename, 'utf8'), protection = "child.on('disconnect', invalidate);";
        assert.equal(source.split(protection).length, 2);
        const isolated = new Module(filename, module); isolated.filename = filename; isolated.paths = module.paths;
        isolated._compile(source.replace(protection, "child.on('disconnect', () => {}); // isolated negative control"), filename);
        await ownedChild(isolated.exports, server, async (state, port) => {
            await isolated.exports.health(state, port);
            const disconnected = new Promise(resolve => state.child.once('disconnect', resolve)); state.child.disconnect(); await disconnected;
            assert.equal(state.child.exitCode, null);
            assert.throws(() => assert.equal(state.listenerReady, false, 'IPC disconnect must invalidate listener readiness'),
                error => error.code === 'ERR_ASSERTION' && error.message.includes('IPC disconnect must invalidate listener readiness'));
        });
    });
}
async function shutdownProof(mode) {
    const env = { ...process.env, DEV_PORT: '0', APIFORGE_PROJECT_API: '1', APIFORGE_PERSISTENT_RUNNER: '1', APIFORGE_LIVE_RUNNER: '0' };
    const child = fork(path.join(__dirname, '../server.js'), ['--persistent-shutdown-fixture', mode], {
        execArgv: ['--require', path.join(__dirname, 'persistent-runtime-shutdown-worker.js')], env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let proof, output = '', socket;
    child.stderr.on('data', bytes => output += bytes.toString());
    child.on('message', message => { if (message.event === 'exit-proof') proof = message; });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    try {
        const ready = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Shutdown fixture startup timeout')), 10000);
            child.on('message', message => { if (message.event === 'listening') { clearTimeout(timer); resolve(message); } });
        });
        const url = 'http://127.0.0.1:' + ready.port + '/api/persistent/';
        const token = (await (await fetch(url + 'session')).json()).data.token;
        const call = (action, input) => fetch(url + action, { method: 'POST', headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token }, body: JSON.stringify(input) });
        assert.equal((await call('initialize', ready.input)).status, 201);
        assert.equal((await call('start', ready.input)).status, 200);
        if (mode === 'incomplete') {
            socket = net.connect(ready.port, '127.0.0.1'); await new Promise(resolve => socket.once('connect', resolve));
            socket.on('error', () => {});
            socket.write('POST /api/persistent/status HTTP/1.1\r\nHost: 127.0.0.1:' + ready.port + '\r\nContent-Type: application/json\r\nContent-Length: 100\r\n' + TOKEN_HEADER + ': ' + token + '\r\n\r\n{');
            await pause(100);
        }
        const started = Date.now(); child.send({ action: 'shutdown' }); let timer;
        let result;
        try { result = await Promise.race([exited, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Shutdown exceeded 35 seconds')), 35000); })]); }
        finally { clearTimeout(timer); }
        assert.equal(result.signal, null); assert.equal(result.code, mode === 'normal' ? 0 : 1);
        assert.equal(proof.deadlines, 1); assert.equal(proof.databasePresent, true); assert.equal(proof.imports, 1); assert.equal(proof.deleted, false);
        assert.equal(proof.claimOccupied, mode === 'failure' || mode === 'stuck');
        if (mode === 'stuck' || mode === 'incomplete') { assert(Date.now() - started >= 29500); assert(output.includes('SHUTDOWN_DEADLINE_EXCEEDED')); }
        assert(!/PRIVATE_SECRET|C:\\private|SELECT |Error:/.test(output));
    } finally { socket?.destroy(); if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
}
(async () => {
    for (const target of ['mysql', 'postgres']) await lifecycle(target);
    await security();
    await listenerOwnershipProof();
    await ipcReadinessProof();
    await Promise.all(['normal', 'failure', 'stuck', 'incomplete'].map(mode => test('actual server shutdown ' + mode + ' with controlled connector; one deadline/data preservation', () => shutdownProof(mode))));
    const counts = results.reduce((out, result) => { out[result.status] = (out[result.status] || 0) + 1; return out; }, {});
    console.log(JSON.stringify({ evidence: 'OFFLINE: controlled SQL/connectors; actual server/TCP/shutdown handlers. Windows signals delivered via IPC process.emit, not native OS signal certification.', counts }));
})().catch(() => { console.error('OFFLINE harness failed'); process.exitCode = 1; });
