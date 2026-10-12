'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { compile } = require('../src/persistent-runtime/compile');
const provenance = require('../src/persistent-runtime/provenance');
const { configuration, postgresClient, resource, TABLE } = require('../src/persistent-runtime/database');
const { TOKEN_HEADER } = require('../src/api/persistent-runtime-api');
const SOURCE = 'ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED';
const results = [];
function configurationFor(target) {
    const testPrefix = target === 'mysql' ? 'APIFORGE_PERSISTENT_TEST_MYSQL_' : 'APIFORGE_PERSISTENT_TEST_PG_';
    const productionPrefix = target === 'mysql' ? 'APIFORGE_PERSISTENT_MYSQL_' : 'APIFORGE_PERSISTENT_PG_';
    if (!['HOST', 'PORT', 'USER', 'PASSWORD'].every(key => typeof process.env[testPrefix + key] === 'string')) return null;
    // Explicit test-owned credentials; never silently use production/generic accounts.
    if (!/^af_persist_test_[a-f0-9]{12}$/.test(process.env[testPrefix + 'USER'])) return null;
    const env = { APIFORGE_PERSISTENT_RUNNER: '1', APIFORGE_PROJECT_API: '1', APIFORGE_LIVE_RUNNER: '0', DEV_PORT: '0' };
    for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD']) env[productionPrefix + key] = process.env[testPrefix + key];
    if (target === 'postgres') env.APIFORGE_PERSISTENT_PG_ADMIN_DB = process.env.APIFORGE_PERSISTENT_TEST_PG_ADMIN_DB || 'postgres';
    return { env, config: configuration(target, env) };
}
async function server(root, env, mode = 'normal') {
    const inherited = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const child = fork(path.join(__dirname, '../server.js'), ['--persistent-native-fixture', JSON.stringify({ root, mode })],
        { execArgv: ['--require', path.join(__dirname, 'persistent-runtime-native-worker.js')], env: { ...inherited, ...env }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(Error('Native server startup failed')); }, 45000);
        child.once('error', () => { clearTimeout(timer); reject(Error('Native server startup failed')); });
        child.on('message', message => { if (message.event === 'listening') { clearTimeout(timer); resolve(message.port); } });
    });
    const call = async (method, url, body, token, header = TOKEN_HEADER) => {
        const response = await fetch('http://127.0.0.1:' + port + url, { method, headers: {
            ...(token ? { [header]: token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
        return { status: response.status, value: await response.json() };
    };
    return { call, async command(action) {
        child.send({ action });
        if (action !== 'stats') return;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.removeListener('message', listener); reject(Error('Native IPC timeout')); }, 5000);
            function listener(message) { if (message.event === 'stats') { clearTimeout(timer); child.removeListener('message', listener); resolve(message); } }
            child.on('message', listener);
        });
    }, async stop() {
        if (child.exitCode === null && child.signalCode === null) child.send({ action: 'shutdown' });
        let timer;
        try {
            const result = await Promise.race([exit, new Promise((resolve, reject) => { timer = setTimeout(() => { child.kill(); reject(Error('Native shutdown deadline exceeded')); }, 35000); })]);
            assert.equal(result.code, 0); assert.equal(result.signal, null);
        } finally { clearTimeout(timer); }
    } };
}
async function direct(target, config, name, action) {
    let client;
    function destroy() {
        if (target === 'mysql') client?.destroy();
        else client?.connection?.stream?.destroy();
    }
    try {
        if (target === 'mysql') client = await require('mysql2/promise').createConnection({ ...config, ...(name ? { database: name } : {}), connectTimeout: 5000 });
        else { client = postgresClient(config, name); client.on('error', () => {}); await client.connect(); }
        return await action(async (sql, values) => target === 'mysql' ? (await client.query({ sql, timeout: 8000 }, values))[0] : (await client.query(sql, values)).rows);
    } finally {
        if (client) {
            let timer;
            try {
                await Promise.race([client.end(), new Promise((resolve, reject) => {
                    timer = setTimeout(() => { destroy(); reject(Error('Native owned connection close timed out')); }, 2000);
                })]);
            } catch (error) { destroy(); throw error; }
            finally { clearTimeout(timer); }
        }
    }
}
async function native(target) {
    let setup;
    try { setup = configurationFor(target); } catch { setup = null; }
    if (!setup || process.platform !== 'win32' || process.arch !== 'x64') {
        results.push({ target, status: 'NATIVE NOT RUN / BLOCKED', reason: 'Supported Windows storage and explicit isolated persistent test-account credentials are required.' });
        console.log(target + ' NATIVE NOT RUN / BLOCKED: isolated APIFORGE_PERSISTENT_TEST_* account fixture unavailable.'); return;
    }
    let primary, competitor, reopened, identity, deploymentId, fixtureRoot, phase = 'fixture', cleanupFailed = false;
    const additional = [];
    try {
        const parent = path.join(os.homedir(), 'APIForge-M2D-A-native-' + crypto.randomUUID()); await fs.mkdir(parent);
        fixtureRoot = path.join(parent, 'store');
        const storeApi = require('../src/project-store');
        const store = await storeApi.initializeProjectStore({ root: fixtureRoot });
        const project = await store.createProject({ name: 'Disposable native lifecycle', target, source: SOURCE });
        identity = provenance.build(store.storeId, project, compile(SOURCE, target)); store.close();
        const owned = resource(identity, setup.config);
        const quote = name => target === 'mysql' ? '`' + name + '`' : '"' + name + '"';
        async function newProject(name) {
            const local = await storeApi.openProjectStore({ root: fixtureRoot });
            try { const saved = await local.createProject({ name, target, source: SOURCE }); return { saved, identity: provenance.build(local.storeId, saved, compile(SOURCE, target)) }; }
            finally { local.close(); }
        }
        async function guardedDatabase(name) {
            const f = await newProject(name), nonce = crypto.randomBytes(32).toString('hex');
            await direct(target, setup.config, undefined, query => query('CREATE DATABASE ' + quote(f.identity.name)));
            await direct(target, setup.config, f.identity.name, async query => {
                await query('CREATE TABLE ' + quote('__apiforge_native_guard') + ' (nonce VARCHAR(64) PRIMARY KEY, value INTEGER NOT NULL)');
                await query('INSERT INTO ' + quote('__apiforge_native_guard') + ' VALUES(' + (target === 'mysql' ? '?' : '$1') + ',42)', [nonce]);
            });
            additional.push({ identity: f.identity, nonce }); return f;
        }
        const sentinel = await guardedDatabase('Unrelated test-owned sentinel');
        assert.equal(await owned.inspect(), null); // Exact derived identity only; no DB inventory.
        primary = await server(fixtureRoot, setup.env);
        const session = await primary.call('GET', '/api/persistent/session'), token = session.value.data.token;
        const input = { projectId: project.id, target, expectedRevision: 1 };
        phase = 'compile without provisioning';
        assert.equal((await primary.call('POST', '/api/compile', { source: SOURCE, target })).status, 200);
        assert.equal(await owned.inspect(), null);
        phase = 'explicit initialization';
        assert.equal((await primary.call('POST', '/api/persistent/initialize', input, token)).status, 201);
        const attestation = await owned.inspect(); assert.equal(attestation.state, 'ready'); deploymentId = attestation.deployment_id;
        phase = 'first Run and real CRUD';
        const running = await primary.call('POST', '/api/persistent/start', input, token); assert.equal(running.status, 200);
        let runtimeToken = running.value.data.sessionId;
        const send = (activeServer, serverToken, sessionId, method, url, body) => activeServer.call('POST', '/api/persistent/request',
            { sessionId, method, path: url, ...(body === undefined ? {} : { body }) }, serverToken);
        const created = await send(primary, token, runtimeToken, 'POST', '/items', { name: 'native retained record' });
        assert.equal(created.value.data.status, 201); const rowId = created.value.data.body.data.id;
        phase = 'competing same and independent server Starts';
        assert.equal((await primary.call('POST', '/api/persistent/start', input, token)).value.error.code, 'PERSISTENT_BUSY');
        competitor = await server(fixtureRoot, setup.env);
        const competingToken = (await competitor.call('GET', '/api/persistent/session')).value.data.token;
        assert.equal((await competitor.call('POST', '/api/persistent/start', input, competingToken)).value.error.code, 'PERSISTENT_BUSY');
        await competitor.stop(); competitor = null;
        phase = 'Stop preserves database/schema/data and permits explicit rerun';
        assert.equal((await primary.call('POST', '/api/persistent/stop', { sessionId: runtimeToken }, token)).status, 200);
        assert.equal((await owned.inspect()).deployment_id, deploymentId); assert.equal((await owned.inspect()).runtime_owner, null);
        runtimeToken = (await primary.call('POST', '/api/persistent/start', input, token)).value.data.sessionId;
        let observed = await send(primary, token, runtimeToken, 'GET', '/items/' + rowId);
        assert.equal(observed.value.data.body.data.name, 'native retained record');
        phase = 'actual APIForge process Stop/restart and authenticated Store reopen';
        // Shutdown an actively running API through the actual server coordinator.
        await primary.stop(); primary = null;
        assert.equal((await owned.inspect()).runtime_owner, null);
        reopened = await server(fixtureRoot, setup.env);
        const rotated = (await reopened.call('GET', '/api/persistent/session')).value.data.token; assert.notEqual(rotated, token);
        const projectToken = (await reopened.call('GET', '/api/projects/session')).value.data.token;
        const saved = await reopened.call('GET', '/api/projects/' + project.id, undefined, projectToken, 'x-apiforge-project-token');
        assert.equal(saved.value.data.sourceHash, project.sourceHash); assert.equal(saved.value.data.revision, 1);
        assert.equal((await reopened.call('POST', '/api/persistent/status', input, rotated)).value.data.state, 'stopped');
        const second = await reopened.call('POST', '/api/persistent/start', input, rotated); assert.equal(second.status, 200);
        runtimeToken = second.value.data.sessionId;
        observed = await send(reopened, rotated, runtimeToken, 'GET', '/items/' + rowId);
        assert.equal(observed.value.data.body.data.name, 'native retained record');
        assert.equal((await reopened.call('POST', '/api/persistent/stop', { sessionId: runtimeToken }, rotated)).status, 200);
        phase = 'simultaneous independent-process Start race';
        competitor = await server(fixtureRoot, setup.env);
        const raceToken = (await competitor.call('GET', '/api/persistent/session')).value.data.token;
        const race = await Promise.all([reopened.call('POST', '/api/persistent/start', input, rotated), competitor.call('POST', '/api/persistent/start', input, raceToken)]);
        assert.deepEqual(race.map(value => value.status).sort(), [200, 409]);
        const winner = race[0].status === 200 ? reopened : competitor, winnerToken = race[0].status === 200 ? rotated : raceToken;
        const raceSession = race.find(value => value.status === 200).value.data.sessionId;
        observed = await send(winner, winnerToken, raceSession, 'GET', '/items/' + rowId); assert.equal(observed.value.data.body.data.name, 'native retained record');
        assert.equal((await winner.call('POST', '/api/persistent/stop', { sessionId: raceSession }, winnerToken)).status, 200);
        await competitor.stop(); competitor = null;
        phase = 'owned process crash and lease recovery';
        runtimeToken = (await reopened.call('POST', '/api/persistent/start', input, rotated)).value.data.sessionId;
        await reopened.command('crash-owned-child');
        for (let i = 0; i < 100 && (await owned.inspect()).runtime_owner !== null; i++) await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal((await owned.inspect()).runtime_owner, null);
        phase = 'missing, existing-name collision and incomplete ownership';
        const missing = await newProject('Missing deployment'), missingInput = { projectId: missing.saved.id, target, expectedRevision: 1 };
        assert.equal((await reopened.call('POST', '/api/persistent/start', missingInput, rotated)).value.error.code, 'PERSISTENT_DATABASE_MISSING');
        const collision = await guardedDatabase('Test-owned name collision'), collisionInput = { projectId: collision.saved.id, target, expectedRevision: 1 };
        for (const action of ['initialize', 'start']) assert.equal((await reopened.call('POST', '/api/persistent/' + action, collisionInput, rotated)).value.error.code, 'PERSISTENT_DATABASE_COLLISION');
        await direct(target, setup.config, identity.name, async query => {
            const table = (target === 'mysql' ? '' : '"public".') + quote(TABLE), placeholder = target === 'mysql' ? '?' : '$1';
            await query("UPDATE " + table + " SET state='provisioning' WHERE deployment_id=" + placeholder, [deploymentId]);
        });
        assert.equal((await reopened.call('POST', '/api/persistent/start', input, rotated)).value.error.code, 'PERSISTENT_INCOMPLETE');
        assert.equal((await reopened.call('POST', '/api/persistent/initialize', input, rotated)).value.error.code, 'PERSISTENT_INCOMPLETE');
        await direct(target, setup.config, identity.name, async query => {
            const table = (target === 'mysql' ? '' : '"public".') + quote(TABLE), p = target === 'mysql' ? '?' : '$1';
            await query("UPDATE " + table + " SET state='ready' WHERE deployment_id=" + p, [deploymentId]);
            await query('UPDATE ' + table + ' SET provenance=' + (target === 'mysql' ? '?' : '$1') + ' WHERE deployment_id=' + (target === 'mysql' ? '?' : '$2'), ['[]', deploymentId]);
        });
        assert.equal((await reopened.call('POST', '/api/persistent/start', input, rotated)).value.error.code, 'PERSISTENT_DATABASE_COLLISION');
        await direct(target, setup.config, identity.name, query => query('UPDATE ' + (target === 'mysql' ? '' : '"public".') + quote(TABLE) + ' SET provenance=' + (target === 'mysql' ? '?' : '$1') + ' WHERE deployment_id=' + (target === 'mysql' ? '?' : '$2'), [identity.text, deploymentId]));
        phase = 'incomplete Stop retains real claim and blocks competing API';
        competitor = await server(fixtureRoot, setup.env, 'cleanup-failure');
        const failureToken = (await competitor.call('GET', '/api/persistent/session')).value.data.token;
        const failedRun = (await competitor.call('POST', '/api/persistent/start', input, failureToken)).value.data.sessionId;
        assert.equal((await competitor.call('POST', '/api/persistent/stop', { sessionId: failedRun }, failureToken)).value.error.code, 'PERSISTENT_CLEANUP_FAILED');
        assert.equal((await reopened.call('POST', '/api/persistent/start', input, rotated)).value.error.code, 'PERSISTENT_BUSY');
        assert.equal((await competitor.call('POST', '/api/persistent/stop', { sessionId: failedRun }, failureToken)).status, 200);
        await competitor.stop(); competitor = null;
        phase = 'controlled lost claim receipt after a REAL committed driver write';
        competitor = await server(fixtureRoot, setup.env, 'claim-ack');
        const receiptToken = (await competitor.call('GET', '/api/persistent/session')).value.data.token;
        assert.equal((await competitor.call('POST', '/api/persistent/start', input, receiptToken)).value.error.code, 'PERSISTENT_CLAIM_UNCERTAIN');
        const stats = await competitor.command('stats'); assert.equal(stats.launched, 0); assert.equal(stats.active, false);
        assert.equal((await reopened.call('POST', '/api/persistent/start', input, rotated)).value.error.code, 'PERSISTENT_BUSY');
        await competitor.stop(); competitor = null;
        // Explicit TEST-ONLY manual recovery after proving no child was launched.
        await owned.release((await owned.inspect()).runtime_owner);
        phase = 'unavailable dedicated credentials';
        const absentEnv = { ...setup.env }; delete absentEnv[target === 'mysql' ? 'APIFORGE_PERSISTENT_MYSQL_PASSWORD' : 'APIFORGE_PERSISTENT_PG_PASSWORD'];
        competitor = await server(fixtureRoot, absentEnv);
        const absentToken = (await competitor.call('GET', '/api/persistent/session')).value.data.token;
        assert.equal((await competitor.call('POST', '/api/persistent/start', input, absentToken)).value.error.code, 'PERSISTENT_CONFIGURATION_UNAVAILABLE');
        await competitor.stop(); competitor = null;
        phase = 'second Initialize, invalid selectors and revision/schema refusal';
        assert.equal((await reopened.call('POST', '/api/persistent/initialize', input, rotated)).value.error.code, 'PERSISTENT_ALREADY_INITIALIZED');
        assert.equal((await reopened.call('POST', '/api/persistent/start', { ...input, target: 'sqlite' }, rotated)).value.error.code, 'PERSISTENT_REQUEST_INVALID');
        const changed = await reopened.call('PUT', '/api/projects/' + project.id, { expectedRevision: 1, changes: { source: SOURCE + '\nvalue STRING' } }, projectToken, 'x-apiforge-project-token');
        assert.equal(changed.status, 200); assert.equal(changed.value.data.revision, 2);
        for (const expectedRevision of [1, 2]) assert.equal((await reopened.call('POST', '/api/persistent/start', { ...input, expectedRevision }, rotated)).value.error.code, 'PERSISTENT_REVISION_MISMATCH');
        await direct(target, setup.config, identity.name, async query => {
            const rows = await query(target === 'mysql' ? 'SELECT * FROM `Item`' : 'SELECT * FROM "public"."Item"');
            assert.equal(rows.length, 1); assert.equal(rows[0].name, 'native retained record'); assert.equal(Object.hasOwn(rows[0], 'value'), false);
        });
        await reopened.stop(); reopened = null;
        assert.equal((await owned.inspect()).provenance, identity.text);
        await direct(target, setup.config, sentinel.identity.name, async query => {
            const rows = await query('SELECT nonce,value FROM ' + quote('__apiforge_native_guard'));
            const marker = additional.find(item => item.identity.name === sentinel.identity.name);
            assert.deepEqual(rows.map(row => [row.nonce, row.value]), [[marker.nonce, 42]]);
        });
        results.push({ target, status: 'NATIVE LIFECYCLE PASS', processRestart: true, realCrud: true, preservation: true, rowClaimCompetition: true,
            independentProcessRace: true, observedCrash: true, controlledLostReceipt: true, negativeCases: true, unrelatedSentinelUnchanged: true,
            limitation: 'Receipt failure is controlled after a real committed query; this does not certify wire-level packet loss, power loss or hostile same-authority processes.' });
        console.log(target + ' NATIVE LIFECYCLE PASS: real CRUD survives Stop/rerun and actual APIForge process restart; schema/revision refusals; competing active-server claim.');
    } catch {
        results.push({ target, status: 'NATIVE FAILED / BLOCKED', phase }); console.error(target + ' NATIVE FAILED / BLOCKED at ' + phase);
    } finally {
        for (const current of [primary, competitor, reopened]) if (current) try { await current.stop(); } catch { cleanupFailed = true; }
        if (identity && deploymentId && !cleanupFailed) {
            try {
                const owned = resource(identity, setup.config), record = await owned.inspect();
                assert.equal(record.deployment_id, deploymentId); assert.equal(record.provenance, identity.text); assert.equal(record.state, 'ready'); assert.equal(record.runtime_owner, null);
                const cleanupOwner = crypto.randomBytes(32).toString('hex'); await owned.claim(cleanupOwner); await owned.verifyClaim(cleanupOwner);
                const quote = target === 'mysql' ? '`' : '"'; assert(provenance.NAME.test(identity.name));
                // The only DROP is TEST-ONLY, after all known servers exit, exact
                // test-created marker/provenance verification AND an exclusive claim.
                await direct(target, setup.config, undefined, query => query('DROP DATABASE ' + quote + identity.name + quote));
                assert.equal(await owned.inspect(), null);
            } catch { cleanupFailed = true; }
        } else if (identity) cleanupFailed = true; // Unknown/partial resources are retained.
        if (cleanupFailed) { results.push({ target, status: 'NATIVE CLEANUP BLOCKED', reason: 'Owned or uncertain resources retained for manual inspection.' }); console.error(target + ' NATIVE CLEANUP BLOCKED: no unverified cleanup attempted.'); }
        if (!cleanupFailed) for (const entry of additional) try {
            assert(provenance.NAME.test(entry.identity.name));
            const quote = target === 'mysql' ? '`' : '"';
            await direct(target, setup.config, entry.identity.name, async query => {
                const rows = await query('SELECT nonce,value FROM ' + quote + '__apiforge_native_guard' + quote);
                assert.deepEqual(rows.map(row => [row.nonce, row.value]), [[entry.nonce, 42]]);
            });
            await direct(target, setup.config, undefined, query => query('DROP DATABASE ' + quote + entry.identity.name + quote));
        } catch { results.push({ target, status: 'NATIVE CLEANUP BLOCKED', reason: 'Additional exact test marker could not be verified; resource retained.' }); }
    }
}
(async () => {
    for (const target of ['mysql', 'postgres']) await native(target);
    const complete = ['mysql', 'postgres'].every(target => results.some(result => result.target === target && result.status === 'NATIVE LIFECYCLE PASS')) &&
        !results.some(result => result.status !== 'NATIVE LIFECYCLE PASS');
    console.log(JSON.stringify({ results, acceptance: complete ? 'NATIVE COMPLETE' : 'NATIVE ACCEPTANCE BLOCKED' }));
    if (!complete) process.exitCode = 1;
})().catch(() => { console.error('NATIVE NOT RUN / BLOCKED: harness failed safely.'); process.exitCode = 1; });
