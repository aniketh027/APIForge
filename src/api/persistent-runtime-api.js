'use strict';
const express = require('express');
const crypto = require('node:crypto');
const net = require('node:net');
const { registry, fail, safe } = require('../persistent-runtime/errors');
const { createManager } = require('../persistent-runtime/manager');
const TOKEN_HEADER = 'x-apiforge-persistent-token';
const BODY_LIMIT = 72 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
function isLoopback(address) {
    if (typeof address !== 'string') return false;
    const value = address.toLowerCase();
    if (net.isIP(value) === 4) return value.startsWith('127.');
    if (net.isIP(value) !== 6) return false;
    const normalized = new URL('http://[' + value + ']').hostname;
    return normalized === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(normalized);
}
function isLocalHostHeader(host) {
    if (typeof host !== 'string' || host.length > 128) return false;
    const match = /^(localhost|[0-9.]+|\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?$/i.exec(host);
    if (!match || match[0] !== host || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false;
    if (match[1].toLowerCase() === 'localhost') return true;
    const bracketed = match[1].startsWith('['), address = bracketed ? match[1].slice(1, -1) : match[1];
    return net.isIP(address) === (bracketed ? 6 : 4) && isLoopback(address);
}
function count(req, name) {
    let total = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) total++;
    return total;
}
function route(req) {
    if (req.baseUrl !== '/api/persistent' || !req.originalUrl.startsWith('/api/persistent/') ||
        /[?%\\#\s]|\/\/|[^\x20-\x7e]/.test(req.url)) fail('PERSISTENT_REQUEST_INVALID');
    if (req.method === 'GET' && req.url === '/session') return 'session';
    const actions = ['status', 'initialize', 'start', 'stop', 'request'];
    if (req.method !== 'POST' || !actions.some(action => req.url === '/' + action)) fail('PERSISTENT_ENDPOINT_NOT_FOUND');
    return req.url.slice(1);
}
// Factory injection is application-owned test infrastructure only. No HTTP or
// environment input can choose a store root, driver, credentials or destination.
function createPersistentApi({ env = process.env, manager } = {}) {
    const current = manager || createManager({ env });
    const enabled = env.APIFORGE_PERSISTENT_RUNNER === '1' && env.APIFORGE_PROJECT_API === '1';
    const token = enabled ? crypto.randomBytes(32).toString('hex') : null;
    const router = express.Router(); let stopping = false, shutdownPromise;
    function respond(res, error) {
        const sanitized = safe(error), [status, message] = registry[sanitized.code];
        res.status(status).json({ success: false, error: { code: sanitized.code, message } });
    }
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cross-Origin-Resource-Policy', 'same-origin');
        try {
            if (!enabled) fail('PERSISTENT_DISABLED');
            if (stopping) fail('PERSISTENT_STOPPING');
            const host = req.headers.host;
            if (!isLoopback(req.socket.remoteAddress) || count(req, 'host') !== 1 || !isLocalHostHeader(host)) fail('PERSISTENT_NOT_LOCAL');
            const authority = new URL((req.socket.encrypted ? 'https://' : 'http://') + host);
            if (Number(authority.port || (req.socket.encrypted ? 443 : 80)) !== req.socket.localPort) fail('PERSISTENT_NOT_LOCAL');
            for (const [name, allowed] of [['origin', [authority.origin]], ['sec-fetch-site', ['same-origin', 'none']],
                ['sec-fetch-mode', ['cors', 'same-origin']], ['sec-fetch-dest', ['empty']]]) {
                if (count(req, name) > 1 || (req.headers[name] !== undefined && !allowed.includes(req.headers[name]))) fail('PERSISTENT_ORIGIN_REFUSED');
            }
            const selected = route(req);
            if (selected !== 'session') {
                const value = req.headers[TOKEN_HEADER];
                if (count(req, TOKEN_HEADER) !== 1 || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) ||
                    !crypto.timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(token, 'hex'))) fail('PERSISTENT_TOKEN_INVALID');
            }
            res.locals.persistentAction = selected;
            if (selected === 'session') {
                if (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) !== 0) fail('PERSISTENT_REQUEST_INVALID');
            } else {
                if (count(req, 'content-type') !== 1 || typeof req.headers['content-type'] !== 'string' ||
                    !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(req.headers['content-type']) ||
                    count(req, 'content-encoding') > 1 || (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'] !== 'identity')) fail('PERSISTENT_MEDIA_UNSUPPORTED');
                if (Number(req.headers['content-length']) > BODY_LIMIT) fail('PERSISTENT_BODY_TOO_LARGE');
                if (req.headers['transfer-encoding'] === undefined && !Number(req.headers['content-length'])) fail('PERSISTENT_JSON_INVALID');
            }
            next();
        } catch (error) { respond(res, error); }
    });
    const parser = express.json({ limit: BODY_LIMIT, strict: true, inflate: false, type: () => true,
        verify(req, res, bytes) {
            if (!bytes.length) fail('PERSISTENT_JSON_INVALID');
            try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('PERSISTENT_JSON_INVALID'); }
        } });
    router.use((req, res, next) => res.locals.persistentAction === 'session' ? next() : parser(req, res, next));
    router.use(async (req, res) => {
        try {
            const action = res.locals.persistentAction;
            const data = action === 'session' ? { formatVersion: 1, token, tokenHeader: TOKEN_HEADER }
                : await current[action](req.body);
            const response = JSON.stringify({ success: true, data });
            if (Buffer.byteLength(response) > RESPONSE_LIMIT) fail('PERSISTENT_RESPONSE_TOO_LARGE');
            res.status(action === 'initialize' ? 201 : 200).type('json').send(response);
        } catch (error) { respond(res, error); }
    });
    router.use((error, req, res, next) => {
        const code = error.type === 'entity.too.large' ? 'PERSISTENT_BODY_TOO_LARGE'
            : ['encoding.unsupported', 'charset.unsupported'].includes(error.type) ? 'PERSISTENT_MEDIA_UNSUPPORTED'
            : ['entity.parse.failed', 'entity.verify.failed', 'request.aborted', 'request.size.invalid'].includes(error.type)
                ? 'PERSISTENT_JSON_INVALID' : 'PERSISTENT_DATABASE_UNAVAILABLE';
        respond(res, safe(null, code));
    });
    return { router, manager: current, shutdown() {
        if (!shutdownPromise) { stopping = true; shutdownPromise = current.shutdown(); }
        return shutdownPromise;
    } };
}
module.exports = { createPersistentApi, TOKEN_HEADER, BODY_LIMIT, RESPONSE_LIMIT, isLoopback, isLocalHostHeader };
