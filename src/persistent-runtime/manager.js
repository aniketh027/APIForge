'use strict';
const crypto = require('node:crypto');
const { fail, safe, fields } = require('./errors');
const provenance = require('./provenance');
function createManager({ env = process.env, dependencies = {} } = {}) {
    // No compiler/storage/driver/SQLite import or filesystem interaction at startup.
    const enabled = env.APIFORGE_PERSISTENT_RUNNER === '1' && env.APIFORGE_PROJECT_API === '1';
    let queue = Promise.resolve(), stopping = false, held = null, stoppedToken = null, shutdownPromise;
    function serialize(action) {
        if (stopping) return Promise.reject(safe(null, 'PERSISTENT_STOPPING'));
        const result = queue.then(action).catch(error => { throw safe(error); });
        queue = result.catch(() => {}); return result;
    }
    function gate() { if (!enabled) fail('PERSISTENT_DISABLED'); }
    function deps() {
        const database = require('./database'), processApi = require('./process');
        const files = require('../live-runner/materialize'), transport = require('../live-runner/transport');
        return { ...database, ...processApi, ...files, ...transport,
            compile: require('./compile').compile,
            openStore: () => require('../project-store').openProjectStore(), ...dependencies };
    }
    async function selected(body, d) {
        const input = provenance.selection(body); let store;
        try {
            store = await d.openStore();
            const current = await store.getProject(input.projectId);
            if (current.revision !== input.expectedRevision || current.target !== input.target) fail('PERSISTENT_REVISION_MISMATCH');
            const pinned = await store.getProjectRevision(input.projectId, input.expectedRevision);
            if (pinned.id !== current.id || pinned.revision !== current.revision || pinned.target !== current.target ||
                pinned.source !== current.source || pinned.sourceHash !== current.sourceHash) fail('PERSISTENT_PROJECT_UNAVAILABLE');
            let files;
            try { files = d.compile(pinned.source, pinned.target); } catch { fail('PERSISTENT_COMPILE_FAILED'); }
            const identity = provenance.build(store.storeId, pinned, files);
            const config = d.configuration(input.target, env);
            return { input, files, identity, config, database: d.resource(identity, config) };
        } catch (error) { throw safe(error, 'PERSISTENT_PROJECT_UNAVAILABLE'); }
        finally { if (store) { try { store.close(); } catch { fail('PERSISTENT_PROJECT_UNAVAILABLE'); } } }
    }
    function token(body, required, optional = []) {
        fields(body, required, optional);
        if (!held?.id || typeof body.sessionId !== 'string' || !provenance.HEX.test(body.sessionId) ||
            !crypto.timingSafeEqual(Buffer.from(body.sessionId, 'hex'), Buffer.from(held.id, 'hex'))) fail('PERSISTENT_SESSION_INVALID');
        return held;
    }
    async function cleanup(session) {
        if (!session) return;
        const d = session.d;
        // Do not release durable ownership until EVERY owned cleanup is verified.
        try {
            await d.stop(session.process);
            await d.released(session.port);
            await d.removeProject(session.root); session.root = null;
            await session.database.release(session.owner);
        } catch { session.failed = true; fail('PERSISTENT_CLEANUP_FAILED'); }
        if (held === session) held = null;
        if (session.id) stoppedToken = session.id;
    }
    const summary = session => ({ formatVersion: 1, projectId: session.input.projectId,
        target: session.input.target, revision: session.input.expectedRevision });
    return {
        enabled: () => enabled,
        status(body) { return serialize(async () => {
            gate(); const d = deps(), session = await selected(body, d), record = await session.database.inspect();
            return { ...summary(session), state: record === null ? 'absent' : record.state !== 'ready' ? 'incomplete'
                : record.runtime_owner === null ? 'stopped' : held?.identity.name === session.identity.name && !held.failed
                    && record.runtime_owner === held.owner && d.ready(held.process) ? 'running' : 'occupied' };
        }); },
        initialize(body) { return serialize(async () => {
            gate(); if (held) fail('PERSISTENT_BUSY');
            const session = await selected(body, deps()); await session.database.initialize();
            return { ...summary(session), state: 'stopped' };
        }); },
        start(body) { return serialize(async () => {
            gate(); if (held) fail(held.failed ? 'PERSISTENT_CLEANUP_FAILED' : 'PERSISTENT_BUSY');
            const d = deps(), session = await selected(body, d);
            const record = await session.database.inspect();
            if (!record) fail('PERSISTENT_DATABASE_MISSING');
            if (record.state !== 'ready') fail('PERSISTENT_INCOMPLETE');
            session.owner = crypto.randomBytes(32).toString('hex'); session.d = d;
            // If this acknowledgement fails, do not launch or automatically release.
            await session.database.claim(session.owner);
            held = session;
            try {
                session.operations = require('../live-runner/operations').operations(session.files);
                session.root = await d.createProject(); await d.materialize(session.root, session.files);
                session.port = await d.freePort();
                session.process = d.launch(session.root, session.port, session.config, session.identity.name);
                session.process.child.once('exit', () => {
                    if (stopping) return; // The coordinated shutdown owns cleanup.
                    const pending = queue.then(() => held === session ? cleanup(session) : undefined);
                    queue = pending.catch(() => {});
                });
                await d.health(session.process, session.port);
                await session.database.verifyClaim(session.owner);
                if (!d.ready(session.process)) fail('PERSISTENT_START_FAILED');
                session.id = crypto.randomBytes(32).toString('hex');
                return { ...summary(session), state: 'running', sessionId: session.id, endpointCount: session.operations.length };
            } catch (error) { await cleanup(session); throw safe(error, 'PERSISTENT_START_FAILED'); }
        }); },
        request(body) { return serialize(async () => {
            gate(); const session = token(body, ['sessionId', 'method', 'path'], ['body']);
            if (session.failed) fail('PERSISTENT_CLEANUP_FAILED');
            try {
                require('../live-runner/operations').validatePath(body.method, body.path, session.operations);
                session.d.serializeBody(body.body);
            } catch (error) { fail(error.code === 'LIVE_ENDPOINT_NOT_ALLOWED' ? 'PERSISTENT_ENDPOINT_NOT_ALLOWED' : 'PERSISTENT_REQUEST_INVALID'); }
            try { await session.database.verifyClaim(session.owner); }
            catch (error) { await cleanup(session); throw safe(error, 'PERSISTENT_OWNERSHIP_LOST'); }
            if (!session.d.ready(session.process)) {
                await cleanup(session); fail('PERSISTENT_REQUEST_FAILED');
            }
            let response;
            try { response = await session.d.request(session.port, body.method, body.path, body.body); }
            catch (error) { fail(error.code === 'LIVE_RESPONSE_TOO_LARGE' ? 'PERSISTENT_RESPONSE_TOO_LARGE' : 'PERSISTENT_REQUEST_FAILED'); }
            // A completed transport is not proof that ownership survived it. Never replay.
            try { await session.database.verifyClaim(session.owner); }
            catch (error) { await cleanup(session); throw safe(error, 'PERSISTENT_OWNERSHIP_LOST'); }
            if (!session.d.ready(session.process)) { await cleanup(session); fail('PERSISTENT_REQUEST_FAILED'); }
            return response;
        }); },
        stop(body) { return serialize(async () => {
            gate(); fields(body, ['sessionId']);
            if (!held && typeof body.sessionId === 'string' && provenance.HEX.test(body.sessionId) && stoppedToken &&
                crypto.timingSafeEqual(Buffer.from(body.sessionId, 'hex'), Buffer.from(stoppedToken, 'hex'))) return { formatVersion: 1, state: 'stopped' };
            const session = token(body, ['sessionId']); await cleanup(session);
            return { formatVersion: 1, state: 'stopped' };
        }); },
        shutdown() {
            if (!shutdownPromise) {
                stopping = true;
                shutdownPromise = queue.then(() => cleanup(held));
                queue = shutdownPromise.catch(() => {});
            }
            return shutdownPromise;
        }
    };
}
module.exports = { createManager };
