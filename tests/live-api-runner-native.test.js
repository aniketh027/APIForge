'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createManager } = require('../src/live-runner/manager');
const { databaseResource } = require('../src/live-runner/database');
const runtime = require('../src/live-runner/process');
const { createRouter } = require('../src/api/live-runner-api');
const { snapshotDirectory } = require('./generated-backend-test-helpers');
const { publicError, LiveError } = require('../src/live-runner/errors');
// Test-only credentials may come from existing APIFORGE_TEST_* infrastructure.
// Production only consumes APIFORGE_LIVE_* configuration.
function professorSource() {
    const app = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
    const snippet = app.slice(app.indexOf('const PROFESSOR_DEMO ='), app.indexOf('let currentExampleIndex'));
    return vm.runInNewContext(snippet + '\nPROFESSOR_DEMO.code');
}
async function native(target) {
    let infrastructure, server, manager, session, observed = {}, phase = 'configuration';
    const before = snapshotDirectory(path.join(__dirname, '../output'));
    const env = { ...process.env, APIFORGE_LIVE_RUNNER: '1' };
    const prefix = target === 'mysql' ? 'APIFORGE_LIVE_MYSQL_' : 'APIFORGE_LIVE_PG_';
    try {
        if (!['HOST', 'PORT', 'USER', 'PASSWORD'].every(key => env[prefix + key] !== undefined)) {
            if (target === 'mysql') {
                const config = require('./generated-backend-mysql-helpers').readServerConfig(env);
                for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD']) env[prefix + key] = String(config[key.toLowerCase()]);
            } else {
                infrastructure = await require('./postgres-native-helpers').nativeSession();
                for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD']) env[prefix + key] = String(infrastructure.config[key.toLowerCase()]);
            }
        }
        manager = createManager({ env, dependencies: {
            databaseResource: (...args) => { const resource = databaseResource(...args); observed.database = resource.name; return resource; },
            launch: (...args) => { observed.root = args[0]; observed.port = args[1]; observed.process = runtime.launch(...args); return observed.process; }
        } });
        const app = express(); app.use('/api/live', createRouter(manager));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const call = async (action, body) => {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/live/' + action,
                { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const data = await response.json(); if (response.status !== 200) throw new LiveError(data.code); return data;
        };
        phase = 'start'; session = await call('start', { source: professorSource(), target });
        assert(!Object.hasOwn(session, 'port')); assert(!Object.hasOwn(session, 'database'));
        assert(!fs.existsSync(path.join(observed.root, 'node_modules')));
        assert(!fs.existsSync(path.join(observed.root, '.env')));
        const project = snapshotDirectory(observed.root);
        for (const file of Object.keys(project)) assert(!env[prefix + 'PASSWORD'] || !fs.readFileSync(path.join(observed.root, file), 'utf8').includes(env[prefix + 'PASSWORD']), 'secret absent in ' + file);
        const send = (method, path, body) => call('request', { sessionId: session.sessionId, method, path, ...(body !== undefined ? { body } : {}) });
        phase = 'create'; const created = await send('POST', '/users', { name: 'Demo User', email: 'live@example.test', joinedAt: '2026-10-06' });
        assert.equal(created.status, 201); const id = created.body.data.id;
        assert.match(id, /^[a-f0-9-]{36}$/);
        phase = 'read'; const read = await send('GET', '/users/' + id); assert.equal(read.status, 200); assert.equal(read.body.data.name, 'Demo User');
        assert.equal((await send('PUT', '/users/' + id, { name: 'Updated User' })).status, 200);
        phase = 'collection'; const collection = await send('GET', '/users?limit=20&page=1'); assert.equal(collection.status, 200);
        assert(collection.body.data.some(user => user.id === id && user.name === 'Updated User'));
        assert.equal(collection.headers['x-total-count'], '1');
        phase = 'relationship'; const relationship = await send('GET', '/users/' + id + '/projects'); assert.equal(relationship.status, 200); assert.deepEqual(relationship.body.data, []);
        assert.equal((await send('DELETE', '/users/' + id)).status, 200);
        assert.equal((await send('GET', '/users/' + id)).status, 404);
        phase = 'stop'; await call('stop', { sessionId: session.sessionId }); session = null;
        assert(!fs.existsSync(observed.root));
        assert(observed.process.child.exitCode !== null || observed.process.child.signalCode !== null);
        await runtime.released(observed.port);
        const config = { host: env[prefix + 'HOST'], port: Number(env[prefix + 'PORT']), user: env[prefix + 'USER'], password: env[prefix + 'PASSWORD'] };
        if (target === 'mysql') {
            const admin = await require('mysql2/promise').createConnection(config);
            try { const [rows] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [observed.database]); assert.equal(rows.length, 0); }
            finally { await admin.end(); }
        } else {
            const admin = new (require('pg').Client)({ ...config, database: env.APIFORGE_LIVE_PG_ADMIN_DB || 'postgres' }); await admin.connect();
            try { assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [observed.database])).rowCount, 0); }
            finally { await admin.end(); }
        }
        assert.deepEqual(snapshotDirectory(path.join(__dirname, '../output')), before);
        console.log('NATIVE ' + target + ' COMPLETE: exact Professor Demo; 7 User CRUD/relationship requests; UUID persistence; pagination; DB dropped, process gone, port released, temp removed; no install/.env/temp node_modules; output unchanged.');
        return true;
    } catch (error) {
        console.error('NATIVE ' + target + ' BLOCKED/FAILED: ' + publicError(error).code + ' phase=' + phase
            + (target === 'postgres' && !manager ? ' (PostgreSQL test configuration or Docker PostgreSQL 18 unavailable)' : ' (native lifecycle did not complete)'));
        return false;
    } finally {
        if (manager) await manager.shutdown();
        if (server) await new Promise(resolve => server.close(resolve));
        if (infrastructure) await infrastructure.cleanup();
    }
}
(async () => {
    const results = []; for (const target of ['mysql', 'postgres']) results.push(await native(target));
    const complete = results.every(Boolean); console.log(complete ? 'NATIVE COMPLETE' : 'NATIVE BLOCKED');
    if (!complete) process.exitCode = 1;
})().catch(() => { console.error('NATIVE BLOCKED: cleanup failed'); process.exitCode = 1; });
