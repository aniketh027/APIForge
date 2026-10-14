'use strict';
// Production database code with per-module driver loading. No real database,
// crypto change, filesystem fixture, or process-global credential mutation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createManager, TTL_MS } = require('../src/live-runner/manager');
const { configuration, NAME_PATTERN } = require('../src/live-runner/database');
const { publicError } = require('../src/live-runner/errors');
const SOURCE = 'ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED';
const CONFIG = { host: '127.0.0.1', port: 5432, user: 'test-only-user', password: 'SYNTHETIC_DEDICATED', adminDatabase: 'postgres' };
const results = [];
const fault = code => Object.assign(Error('SYNTHETIC_PRIVATE password SQL path stack database'), { code });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rejects(action, code) { await assert.rejects(action, error => error.code === code); }
function loaded(drivers, randomBytes) {
    const filename = path.resolve(__dirname, '../src/live-runner/database.js');
    const instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = id => {
        if (Object.hasOwn(drivers, id)) return drivers[id];
        if (id === 'crypto' && randomBytes) return { ...original(id), randomBytes };
        return original(id);
    };
    instance._compile(fs.readFileSync(filename, 'utf8'), filename);
    return instance.exports;
}
function fixture(target, options = {}) {
    const calls = [], clients = []; let creates = 0, drops = 0;
    class Client extends EventEmitter {
        constructor(params) { super(); this.params = params; this.closed = false; clients.push(this); }
        async connect() { if (options.connectFailure) throw fault('ECONNREFUSED'); }
        async query(sql) {
            calls.push(sql);
            if (sql.startsWith('CREATE DATABASE')) {
                creates++; if (options.createFailure) throw fault(options.createFailure);
                await options.createWait?.();
            } else if (sql.startsWith('DROP DATABASE')) {
                drops++; if (options.dropFailures > 0) { options.dropFailures--; throw fault('ECONNRESET'); }
            } else if (options.importFailure) throw fault('IMPORT_FAILED');
            return {};
        }
        async end() {
            if (options.closeFailures > 0) { options.closeFailures--; throw fault('END_FAILED'); }
            this.closed = true;
        }
    }
    const adapter = loaded({ 'pg': { Client }, 'mysql2/promise': { async createConnection(params) {
        const client = new Client(params); await client.connect(); return client;
    } } }, options.randomBytes);
    const db = adapter.databaseResource(target, CONFIG);
    return { db, adapter, calls, clients, options, creates: () => creates, drops: () => drops };
}
function managerFixture(target, options = {}, managerOptions = {}) {
    const resources = [], events = []; let running = 0, maximum = 0;
    const env = { APIFORGE_LIVE_RUNNER: '1' };
    const prefix = target === 'mysql' ? 'APIFORGE_LIVE_MYSQL_' : 'APIFORGE_LIVE_PG_';
    for (const [key, value] of Object.entries({ HOST: CONFIG.host, PORT: String(CONFIG.port), USER: CONFIG.user, PASSWORD: CONFIG.password })) env[prefix + key] = value;
    const dependencies = {
        createProject: async () => { events.push('directory'); return '/synthetic-owned-root'; },
        materialize: async () => {},
        databaseResource: () => { const f = fixture(target, options); resources.push(f); return f.db; },
        freePort: async () => 32123,
        launch: () => { running++; maximum = Math.max(maximum, running); events.push('launch'); return { running: true }; },
        health: async () => {},
        stop: async state => {
            events.push('stop'); if (managerOptions.stopWait) await managerOptions.stopWait();
            if (managerOptions.failure === 'process') throw fault('STOP_FAILED');
            if (state?.running) { state.running = false; running--; }
        },
        released: async () => { events.push('port'); if (managerOptions.failure === 'port') throw fault('PORT_FAILED'); },
        removeProject: async () => { events.push('remove'); },
        request: async () => ({ success: true, status: 200, body: {} })
    };
    const manager = createManager({ env, dependencies, ttlMs: managerOptions.ttlMs || TTL_MS });
    return { manager, resources, events, maximum: () => maximum, managerOptions };
}
async function test(name, action, evidenceClass = 'controlled-driver/production-module') {
    const start = Date.now();
    await action(); results.push({ name, status: 'PASS', evidenceClass, durationMs: Date.now() - start });
    console.log('PASS ' + name);
}
async function ownership(target) {
    await test(target + ': no CREATE issued authorizes zero DROP', async () => {
        const f = fixture(target); await f.db.close(); await f.db.drop(); assert.equal(f.drops(), 0);
        f.options.connectFailure = true; await assert.rejects(() => f.db.setup('SCHEMA')); await f.db.close(); await f.db.drop();
        assert.equal(f.creates(), 0); assert.equal(f.drops(), 0);
    });
    await test(target + ': acknowledged CREATE drops exact owned name once', async () => {
        const f = fixture(target); await f.db.setup('SCHEMA'); await f.db.close(); await f.db.drop(); await f.db.drop();
        assert.equal(f.creates(), 1); assert.equal(f.drops(), 1);
        const quote = target === 'mysql' ? '`' : '"';
        assert.equal(f.calls.find(x => x.startsWith('DROP')), 'DROP DATABASE IF EXISTS ' + quote + f.db.name + quote + (target === 'postgres' ? ' WITH (FORCE)' : ''));
        assert(f.clients.every(c => c.closed));
        await rejects(() => f.db.setup('SCHEMA'), 'LIVE_DATABASE_SETUP_FAILED'); assert.equal(f.creates(), 1);
    });
    await test(target + ': explicit duplicate refusal never deletes or adopts external collision', async () => {
        const f = fixture(target, { createFailure: target === 'mysql' ? 'ER_DB_CREATE_EXISTS' : '42P04' });
        await assert.rejects(() => f.db.setup('SCHEMA')); await f.db.close(); await f.db.drop(); await f.db.drop();
        assert.equal(f.drops(), 0); assert.equal(f.calls.length, 1);
        await rejects(() => f.db.setup('SCHEMA'), 'LIVE_DATABASE_SETUP_FAILED'); assert.equal(f.creates(), 1);
    });
    for (const code of ['ECONNRESET', 'QUERY_TIMEOUT', 'DRIVER_FAILED']) await test(target + ': ambiguous ' + code + ' blocks deletion and setup replay', async () => {
        const f = fixture(target, { createFailure: code }); await assert.rejects(() => f.db.setup('SCHEMA'));
        await f.db.close(); await rejects(() => f.db.drop(), 'LIVE_CLEANUP_FAILED');
        await rejects(() => f.db.drop(), 'LIVE_CLEANUP_FAILED'); await rejects(() => f.db.setup('SCHEMA'), 'LIVE_DATABASE_SETUP_FAILED');
        assert.equal(f.creates(), 1); assert.equal(f.drops(), 0);
    });
    await test(target + ': import failure preserves acknowledged ownership', async () => {
        const f = fixture(target, { importFailure: true }); await assert.rejects(() => f.db.setup('SCHEMA'));
        await f.db.close(); await f.db.drop(); assert.equal(f.drops(), 1);
    });
    await test(target + ': failed DROP retains same confirmed-owned retry authority', async () => {
        const f = fixture(target, { dropFailures: 1 }); await f.db.setup('SCHEMA'); await f.db.close();
        await assert.rejects(() => f.db.drop()); await f.db.close(); await f.db.drop(); await f.db.drop();
        assert.equal(f.drops(), 2); assert.equal(new Set(f.calls.filter(x => x.startsWith('DROP'))).size, 1);
    });
    await test(target + ': failed connection close prevents deletion until retry succeeds', async () => {
        const f = fixture(target, { importFailure: true }); await assert.rejects(() => f.db.setup('SCHEMA'));
        f.options.closeFailures = 1; await rejects(() => f.db.close(), 'LIVE_CLEANUP_FAILED');
        await rejects(() => f.db.drop(), 'LIVE_CLEANUP_FAILED'); assert.equal(f.drops(), 0);
        await f.db.close(); await f.db.drop(); assert.equal(f.drops(), 1);
    });
    await test(target + ': acknowledged DROP is not replayed after administration close failure', async () => {
        const f = fixture(target); await f.db.setup('SCHEMA'); f.options.closeFailures = 1;
        await assert.rejects(() => f.db.drop()); await f.db.close(); await f.db.drop(); assert.equal(f.drops(), 1);
    });
    await test(target + ': invalid random name is rejected before CREATE and DROP', async () => {
        const f = fixture(target, { randomBytes: () => ({ toString: () => 'foreign_database' }) });
        await rejects(() => f.db.setup('SCHEMA'), 'LIVE_DATABASE_SETUP_FAILED'); await f.db.drop();
        assert.equal(f.creates(), 0); assert.equal(f.drops(), 0);
    });
    await test(target + ': replacement and shutdown cannot erase ambiguous state', async () => {
        const f = managerFixture(target, { createFailure: 'ECONNRESET' });
        for (let i = 0; i < 3; i++) await rejects(() => f.manager.start({ source: SOURCE, target }), 'LIVE_CLEANUP_FAILED');
        await rejects(() => f.manager.shutdown(), 'LIVE_CLEANUP_FAILED');
        assert.equal(f.resources.length, 1); assert.equal(f.resources[0].creates(), 1); assert.equal(f.resources[0].drops(), 0);
        assert.equal(f.manager.status().active, false); assert.equal(f.events.filter(x => x === 'launch').length, 0);
    });
    await test(target + ': known collision cleans without permanent replacement lockout', async () => {
        const options = { createFailure: target === 'mysql' ? 'ER_DB_CREATE_EXISTS' : '42P04' };
        const f = managerFixture(target, options);
        await rejects(() => f.manager.start({ source: SOURCE, target }), 'LIVE_DATABASE_SETUP_FAILED');
        assert.equal(f.resources[0].drops(), 0); options.createFailure = null;
        const session = await f.manager.start({ source: SOURCE, target }); await f.manager.stop({ sessionId: session.sessionId });
        assert.equal(f.resources[0].drops(), 0); assert.equal(f.resources[1].drops(), 1);
    });
    await test(target + ': manager import failure deletes only acknowledged owned resource', async () => {
        const f = managerFixture(target, { importFailure: true });
        await rejects(() => f.manager.start({ source: SOURCE, target }), 'LIVE_DATABASE_SETUP_FAILED');
        await f.manager.shutdown(); assert.equal(f.resources[0].creates(), 1); assert.equal(f.resources[0].drops(), 1);
    });
    await test(target + ': manager retains confirmed ownership through failed DROP and Stop retry', async () => {
        const f = managerFixture(target, { dropFailures: 1 }); const session = await f.manager.start({ source: SOURCE, target });
        await rejects(() => f.manager.stop({ sessionId: session.sessionId }), 'LIVE_CLEANUP_FAILED');
        await f.manager.stop({ sessionId: session.sessionId }); await f.manager.shutdown();
        assert.equal(f.resources[0].drops(), 2); assert.equal(f.resources.length, 1);
    });
    await test(target + ': concurrent starts and explicit Stop serialize confirmed cleanup', async () => {
        const f = managerFixture(target);
        const [first, second] = await Promise.all([f.manager.start({ source: SOURCE, target }), f.manager.start({ source: SOURCE, target })]);
        await rejects(() => f.manager.stop({ sessionId: first.sessionId }), 'LIVE_SESSION_INVALID');
        await f.manager.stop({ sessionId: second.sessionId }); await f.manager.shutdown();
        assert.equal(f.maximum(), 1); assert(f.resources.every(x => x.drops() === 1));
        await rejects(() => f.manager.stop({ sessionId: second.sessionId }), 'LIVE_SESSION_INVALID');
    });
    for (const prerequisite of ['process', 'port']) await test(target + ': failed ' + prerequisite + ' blocks owned deletion and replacement', async () => {
        const f = managerFixture(target, {}, { failure: prerequisite });
        const session = await f.manager.start({ source: SOURCE, target });
        await rejects(() => f.manager.stop({ sessionId: session.sessionId }), 'LIVE_CLEANUP_FAILED');
        await rejects(() => f.manager.start({ source: SOURCE, target }), 'LIVE_CLEANUP_FAILED'); assert.equal(f.resources[0].drops(), 0);
        f.managerOptions.failure = null; await f.manager.stop({ sessionId: session.sessionId }); assert.equal(f.resources[0].drops(), 1);
    });
    await test(target + ': shutdown queued during cleanup issues only one owned DROP', async () => {
        let release; const wait = new Promise(resolve => { release = resolve; });
        const f = managerFixture(target); const session = await f.manager.start({ source: SOURCE, target });
        f.managerOptions.stopWait = () => wait;
        const stopping = f.manager.stop({ sessionId: session.sessionId }), shutdown = f.manager.shutdown();
        release(); await Promise.all([stopping, shutdown]); assert.equal(f.resources[0].drops(), 1);
    });
    await test(target + ': expiry retains 15-minute contract and cleans owned session', async () => {
        assert.equal(TTL_MS, 900000); const f = managerFixture(target, {}, { ttlMs: 10 });
        await f.manager.start({ source: SOURCE, target }); await delay(50); await f.manager.shutdown();
        assert.equal(f.manager.status().active, false); assert.equal(f.resources[0].drops(), 1);
    });
    await test(target + ': HTTP failure taxonomy stays sanitized', async () => {
        const express = require('express'), { createRouter } = require('../src/api/live-runner-api');
        const f = managerFixture(target, { createFailure: 'ECONNRESET' });
        const app = express(); app.use('/api/live', createRouter(f.manager));
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/live/start', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: SOURCE, target }), signal: AbortSignal.timeout(3000) });
                assert.equal(response.status, 500);
                const body = await response.json(); assert.deepEqual(body, publicError(Object.assign(new (require('../src/live-runner/errors').LiveError)('LIVE_CLEANUP_FAILED'))));
                const text = JSON.stringify(body); assert(!/SYNTHETIC|apiforge_live_|SQL|stack|\/synthetic/.test(text));
            }
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }, 'controlled-loopback-HTTP/driver-fake');
}
async function pgParametersChild() {
    const { Client: ActualClient } = require('pg');
    assert.equal(new ActualClient({ ...CONFIG, password: '' }).connectionParameters.password, 'SYNTHETIC_AMBIENT');
    const ambient = new ActualClient(CONFIG).connectionParameters;
    assert.equal(ambient.ssl, true); assert.equal(ambient.sslnegotiation, 'direct');
    assert.equal(ambient.options, '-c role=foreign'); assert.equal(ambient.replication, 'database');
    assert.equal(ambient.application_name, 'foreign'); assert.equal(ambient.client_encoding, 'LATIN1');
    let networkAttempts = 0; const clients = [];
    class ParameterClient extends ActualClient {
        constructor(params) { super(params); clients.push(this); this.connection.connect = () => { networkAttempts++; throw Error('Network forbidden'); }; }
        async connect() { await new Promise((resolve, reject) => { this.connection.once('error', reject); this._getPassword(resolve); }); }
        async query() { return {}; }
        async end() { this.connection.stream.destroy(); }
    }
    const adapter = loaded({ pg: { Client: ParameterClient } });
    const before = JSON.stringify(process.env);
    for (const password of ['', 'SYNTHETIC_DEDICATED']) {
        const resource = adapter.databaseResource('postgres', { ...CONFIG, password });
        const offset = clients.length; await resource.setup('SCHEMA'); await resource.close(); await resource.drop();
        for (const client of clients.slice(offset)) {
            const p = client.connectionParameters;
            assert.equal(p.password, password); assert.equal(client.password, password);
            assert.equal(p.host, CONFIG.host); assert.equal(p.port, CONFIG.port); assert.equal(p.user, CONFIG.user);
            assert([CONFIG.adminDatabase, resource.name].includes(p.database));
            assert.equal(p.ssl, false); assert.equal(p.sslnegotiation, 'postgres'); assert.equal(p.client_encoding, 'UTF8');
            assert.equal(p.application_name, 'apiforge-live-v1'); assert.equal(p.options, '-c statement_timeout=10000');
            assert.equal(p.replication, 'false'); assert.equal(client.binary, false); assert.equal(p.connect_timeout, 5);
            assert.equal(p.query_timeout, 10000); assert.equal(p.statement_timeout, 10000);
            assert.equal(client.getStartupConf().replication, 'false');
        }
    }
    assert.equal(JSON.stringify(process.env), before); assert.equal(networkAttempts, 0);
    console.log(JSON.stringify({ status: 'PASS', clients: clients.length, networkAttempts, emptyPasswordAuthoritative: true, nonemptyPasswordAuthoritative: true, ambientTlsAndOptionsBlocked: true, ambientServiceAndPasswordFilesIgnored: true, processEnvironmentUnchanged: true, evidenceClass: 'actual-pg-parameter-resolution/no-network' }));
}
async function main() {
    for (const target of ['mysql', 'postgres']) await ownership(target);
    await test('untrusted target and caller-selected database names are rejected', async () => {
        assert.throws(() => configuration('foreign', {}), { code: 'LIVE_REQUEST_INVALID' });
        assert.throws(() => loaded({}).databaseResource('foreign', CONFIG), { code: 'LIVE_REQUEST_INVALID' });
        const f = managerFixture('mysql');
        for (const extra of ['database', 'name', 'password', 'config']) await rejects(() => f.manager.start({ source: SOURCE, target: 'mysql', [extra]: 'foreign' }), 'LIVE_REQUEST_INVALID');
        assert.equal(f.resources.length, 0);
    });
    await test('Persistent and Store contracts stay separate from disposable Live ownership', async () => {
        const persistent = require('../src/persistent-runtime/database'), provenance = require('../src/persistent-runtime/provenance');
        const store = require('../src/project-store'); assert.equal(typeof store.openProjectStore, 'function');
        assert(!Object.hasOwn(persistent, 'databaseResource')); assert.equal(configuration('postgres', { DB_PASSWORD: 'SYNTHETIC', PGPASSWORD: 'SYNTHETIC' }), null);
        for (const name of ['apiforge_p_m_' + 'a'.repeat(48), 'apiforge_p_p_' + 'b'.repeat(48), 'foreign', 'apiforge_live_' + 'a'.repeat(23)]) assert.equal(NAME_PATTERN.test(name), false);
        assert.equal(provenance.NAME.test('apiforge_live_' + 'a'.repeat(24)), false);
        assert.throws(() => persistent.configuration('postgres', { APIFORGE_LIVE_PG_PASSWORD: '' }), { code: 'PERSISTENT_CONFIGURATION_UNAVAILABLE' });
    }, 'contract-only/no-Store-access');
    await test('forced native pg environment fails closed before SQL', async () => {
        const child = spawnSync(process.execPath, [__filename, '--forced-native-child'], { encoding: 'utf8', timeout: 5000,
            env: { ...process.env, NODE_PG_FORCE_NATIVE: '1' }, windowsHide: true });
        assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout.trim()).status, 'PASS');
    });
    await test('actual pg resolves exact empty/nonempty credentials without network or parent mutation', async () => {
        const before = JSON.stringify(process.env);
        const env = { ...process.env, PGPASSWORD: 'SYNTHETIC_AMBIENT', DB_PASSWORD: 'SYNTHETIC_UNRELATED', PGHOST: 'foreign.invalid', PGPORT: '1', PGUSER: 'foreign', PGDATABASE: 'foreign',
            PGSERVICE: 'foreign', PGSERVICEFILE: '/synthetic/nonexistent', PGPASSFILE: '/synthetic/nonexistent', PGSSLMODE: 'require', PGSSLNEGOTIATION: 'direct',
            PGOPTIONS: '-c role=foreign', PGAPPNAME: 'foreign', PGCLIENT_ENCODING: 'LATIN1', PGREPLICATION: 'database', PGBINARY: 'true', PGCONNECT_TIMEOUT: '999' };
        delete env.NODE_PG_FORCE_NATIVE;
        const child = spawnSync(process.execPath, [__filename, '--pg-parameters-child'], { encoding: 'utf8', timeout: 10000, env, windowsHide: true });
        assert.equal(child.status, 0, child.stderr); const report = JSON.parse(child.stdout.trim()); assert.equal(report.networkAttempts, 0);
        assert.equal(JSON.stringify(process.env), before); results.push({ name: 'pg parameter probe detail', ...report });
    }, 'actual-pg-parameter-resolution/no-network');
    console.log(JSON.stringify({ suite: 'live-api-database-safety', status: 'PASS', counts: { PASS: results.length, FAIL: 0 }, results }));
}
if (process.argv.includes('--pg-parameters-child')) pgParametersChild().catch(() => { console.error('Sanitized pg parameter probe failed'); process.exitCode = 1; });
else if (process.argv.includes('--forced-native-child')) (async () => {
    const f = fixture('postgres'); await rejects(() => f.db.setup('SCHEMA'), 'LIVE_DATABASE_SETUP_FAILED'); await f.db.close(); await f.db.drop();
    assert.equal(f.creates(), 0); assert.equal(f.drops(), 0); console.log(JSON.stringify({ status: 'PASS' }));
})().catch(() => { console.error('Sanitized forced-driver probe failed'); process.exitCode = 1; });
else main().catch(error => { console.error('FAIL Live database safety:', error.name, error.code || 'ASSERTION'); process.exitCode = 1; });
