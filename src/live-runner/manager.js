'use strict';
const { randomBytes, timingSafeEqual } = require('crypto');
const { compile } = require('./compile');
const files = require('./materialize');
const database = require('./database');
const runtime = require('./process');
const transport = require('./transport');
const { operations, validatePath } = require('./operations');
const { LiveError, fail, exactKeys } = require('./errors');
const TTL_MS = 15 * 60 * 1000;
function createManager({ env = process.env, ttlMs = TTL_MS, dependencies = {} } = {}) {
    const d = { compile, ...files, ...database, ...runtime, request: transport.request, ...dependencies };
    let active = null, pendingCleanup = null, queue = Promise.resolve();
    // Requests share the transition queue so a runtime cannot be removed during forwarding.
    function serialize(action) {
        const result = queue.then(action); queue = result.catch(() => {}); return result;
    }
    function enabled() { return env.APIFORGE_LIVE_RUNNER === '1'; }
    function gate() { if (!enabled()) fail('LIVE_DISABLED'); }
    async function cleanup(session) {
        if (!session) return;
        clearTimeout(session.timer);
        const errors = [];
        for (const [step, action] of [
            ['process', () => d.stop(session.process)], ['port', () => d.released(session.port)],
            ['connections', () => session.database?.close()], ['database', () => session.database?.drop()],
            ['directory', () => d.removeProject(session.root)]
        ]) { try { await action(); } catch { errors.push(step); } }
        if (active === session) active = null;
        // Keep failed ownership internal for retry; never start another runtime after incomplete cleanup.
        pendingCleanup = errors.length ? session : null;
        if (errors.length) { const error = new LiveError('LIVE_CLEANUP_FAILED'); error.steps = errors; throw error; }
    }
    function token(sessionId) {
        if (!active || typeof sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(sessionId)
            || !timingSafeEqual(Buffer.from(sessionId), Buffer.from(active.id))) fail('LIVE_SESSION_INVALID');
        if (Date.now() >= active.expiresAt) fail('LIVE_SESSION_INVALID');
        return active;
    }
    return {
        enabled,
        status() { return { success: true, enabled: enabled(), mysqlConfigured: !!d.configuration('mysql', env),
            postgresConfigured: !!d.configuration('postgres', env), active: !!active && Date.now() < active.expiresAt,
            ...(active ? { target: active.target, expiresAt: new Date(active.expiresAt).toISOString() } : {}) }; },
        start(body) { return serialize(async () => {
            gate(); exactKeys(body, ['source', 'target']);
            if (!['mysql', 'postgres'].includes(body.target)) fail('LIVE_REQUEST_INVALID');
            const config = d.configuration(body.target, env);
            if (!config) fail('LIVE_TARGET_NOT_CONFIGURED');
            await cleanup(active || pendingCleanup);
            const session = { target: body.target };
            try {
                const generated = d.compile(body.source, body.target);
                session.operations = operations(generated);
                session.root = await d.createProject();
                await d.materialize(session.root, generated);
                session.database = d.databaseResource(body.target, config);
                try { await session.database.setup(generated.find(file => file.path === 'database/schema.sql').content); }
                catch { fail('LIVE_DATABASE_SETUP_FAILED'); }
                session.port = await d.freePort();
                session.process = d.launch(session.root, session.port, config, session.database.name);
                await d.health(session.process, session.port);
                session.id = randomBytes(32).toString('hex');
                session.expiresAt = Date.now() + ttlMs;
                active = session;
                session.timer = setTimeout(() => {
                    serialize(() => active === session ? cleanup(session) : undefined).catch(() => { /* Retained ownership allows stop/shutdown retry. */ });
                }, ttlMs);
                session.timer.unref?.();
                return { success: true, sessionId: session.id, target: session.target,
                    expiresAt: new Date(session.expiresAt).toISOString(), endpointCount: session.operations.length };
            } catch (error) {
                await cleanup(session);
                if (error instanceof LiveError) throw error;
                fail('LIVE_START_FAILED');
            }
        }); },
        request(body) { return serialize(async () => {
            gate(); exactKeys(body, ['sessionId', 'method', 'path'], ['body']);
            const session = token(body.sessionId);
            validatePath(body.method, body.path, session.operations);
            transport.serializeBody(body.body);
            try { return await d.request(session.port, body.method, body.path, body.body); }
            catch (error) { if (error instanceof LiveError) throw error; fail('LIVE_REQUEST_FAILED'); }
        }); },
        stop(body) { return serialize(async () => {
            gate(); exactKeys(body, ['sessionId']);
            // Expired sessions remain stoppable while queued requests finish.
            const session = active || pendingCleanup;
            if (!session?.id || typeof body.sessionId !== 'string' || body.sessionId !== session.id) fail('LIVE_SESSION_INVALID');
            await cleanup(session); return { success: true };
        }); },
        shutdown() { return serialize(() => cleanup(active || pendingCleanup)); }
    };
}
module.exports = { createManager, TTL_MS };
