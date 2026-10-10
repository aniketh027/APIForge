'use strict';
const express = require('express');
const crypto = require('node:crypto');
const net = require('node:net');
const { ProjectStoreError } = require('../project-store/errors');

// Same literal locality policy as Live, kept here to avoid importing its runner
// manager/compiler/database dependency chain. Live's implementation is unchanged.
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
    if (!match || match[0] !== host) return false;
    if (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return false;
    const hostname = match[1];
    if (hostname.toLowerCase() === 'localhost') return true;
    const bracketed = hostname.startsWith('['), address = bracketed ? hostname.slice(1, -1) : hostname;
    return net.isIP(address) === (bracketed ? 6 : 4) && isLoopback(address);
}

const TOKEN_HEADER = 'x-apiforge-project-token';
const HTTP_BODY_LIMIT = 6 * 1048576 + 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP_ERRORS = Object.freeze({
    PROJECT_API_DISABLED: [403, 'The project HTTP API is disabled.'],
    PROJECT_API_NOT_LOCAL: [403, 'A direct loopback peer and local Host authority are required.'],
    PROJECT_API_ORIGIN_REFUSED: [403, 'The browser request origin is not permitted.'],
    PROJECT_API_TOKEN_INVALID: [403, 'A valid project API token header is required.'],
    PROJECT_API_REQUEST_INVALID: [400, 'The request must match the documented project API contract.'],
    PROJECT_API_JSON_INVALID: [400, 'The request body must be a valid UTF-8 JSON object.'],
    PROJECT_API_BODY_TOO_LARGE: [413, 'The project HTTP request body exceeds the permitted size.'],
    PROJECT_API_MEDIA_UNSUPPORTED: [415, 'An uncompressed UTF-8 JSON request is required.'],
    PROJECT_API_ENDPOINT_NOT_FOUND: [404, 'The project endpoint or HTTP method was not found.'],
    PROJECT_API_STOPPING: [503, 'The project HTTP API is shutting down.']
});
// Explicit inventory, never an inferred suffix/regex status mapper.
const STORE_STATUS = Object.freeze({
    PROJECT_INVALID_INPUT: 400, PROJECT_INVALID_ID: 400, PROJECT_INVALID_NAME: 400,
    PROJECT_INVALID_TARGET: 400, PROJECT_INVALID_SOURCE: 400, PROJECT_INVALID_REVISION: 400,
    PROJECT_NOT_FOUND: 404, PROJECT_REVISION_CONFLICT: 409, PROJECT_REVISION_LIMIT: 409,
    PROJECT_STORE_EXISTS: 409, PROJECT_STORE_MISSING: 503, PROJECT_STORE_UNSAFE: 503,
    PROJECT_STORE_IDENTITY_MISMATCH: 503, PROJECT_STORE_INCOMPATIBLE: 503,
    PROJECT_STORE_CORRUPT: 503, PROJECT_STORE_RECOVERY_REQUIRED: 503,
    PROJECT_STORE_BUSY: 503, PROJECT_STORE_CLOSED: 503,
    PROJECT_STORE_RUNTIME_UNSUPPORTED: 503, PROJECT_STORE_PLATFORM_UNSUPPORTED: 503,
    PROJECT_COMMIT_UNCERTAIN: 500, PROJECT_STORE_STORAGE_FAILURE: 500
});
const INVALIDATE_STORE = new Set([
    'PROJECT_STORE_MISSING', 'PROJECT_STORE_UNSAFE', 'PROJECT_STORE_IDENTITY_MISMATCH',
    'PROJECT_STORE_INCOMPATIBLE', 'PROJECT_STORE_CORRUPT', 'PROJECT_STORE_RECOVERY_REQUIRED',
    'PROJECT_STORE_CLOSED', 'PROJECT_COMMIT_UNCERTAIN', 'PROJECT_STORE_STORAGE_FAILURE'
]);
function httpFailure(code) { const error = new Error(); error.code = code; return error; }
function safeStoreError(error) {
    return new ProjectStoreError(error instanceof ProjectStoreError && Object.hasOwn(STORE_STATUS, error.code)
        ? error.code : 'PROJECT_STORE_STORAGE_FAILURE');
}
function respondError(res, error) {
    if (error && Object.hasOwn(HTTP_ERRORS, error.code)) {
        const [status, message] = HTTP_ERRORS[error.code];
        return res.status(status).json({ success: false, error: { code: error.code, message } });
    }
    const safe = safeStoreError(error);
    return res.status(STORE_STATUS[safe.code]).json({ success: false, error: { code: safe.code, message: safe.message } });
}
function headerCount(req, name) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
    return count;
}
function fields(value, allowed, required) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !allowed.includes(key)) ||
        required.some(key => !Object.hasOwn(value, key))) throw new ProjectStoreError('PROJECT_INVALID_INPUT');
}
function changes(value, required) {
    fields(value, ['name', 'target', 'source'], required);
    if (!Object.keys(value).length) throw new ProjectStoreError('PROJECT_INVALID_INPUT');
    const result = {};
    for (const key of ['name', 'target', 'source']) if (Object.hasOwn(value, key)) {
        if (typeof value[key] !== 'string') throw new ProjectStoreError({
            name: 'PROJECT_INVALID_NAME', target: 'PROJECT_INVALID_TARGET', source: 'PROJECT_INVALID_SOURCE'
        }[key]);
        result[key] = value[key];
    }
    return result;
}
function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ProjectStoreError('PROJECT_INVALID_REVISION');
    return value;
}
function route(req) {
    // Dispatch literal paths ourselves so Express cannot decode aliases, relax
    // case/trailing slashes, supply HEAD for GET, or dispatch arbitrary methods.
    if (!req.originalUrl.startsWith('/api/projects') || req.baseUrl !== '/api/projects' || req.url.includes('?') ||
        (req.url !== '/' && req.url.endsWith('/')) ||
        /[%\\#\s]|\/\/|[^\x20-\x7e]/.test(req.url)) {
        throw httpFailure('PROJECT_API_REQUEST_INVALID');
    }
    const url = req.url;
    if (url === '/session' && req.method === 'GET') return { action: 'session' };
    if (url === '/initialize' && req.method === 'POST') return { action: 'initialize' };
    if (url === '/' && req.method === 'GET') return { action: 'list' };
    if (url === '/' && req.method === 'POST') return { action: 'create' };
    const match = /^\/([^/]+)(?:\/revisions\/([^/]+))?$/.exec(url);
    if (!match || !['GET', 'PUT'].includes(req.method) || (match[2] !== undefined && req.method !== 'GET') ||
        ['session', 'initialize'].includes(match[1])) throw httpFailure('PROJECT_API_ENDPOINT_NOT_FOUND');
    if (!UUID.test(match[1])) throw new ProjectStoreError('PROJECT_INVALID_ID');
    if (match[2] !== undefined) {
        if (!/^[1-9][0-9]*$/.test(match[2])) throw new ProjectStoreError('PROJECT_INVALID_REVISION');
        return { action: 'history', id: match[1], revision: revision(Number(match[2])) };
    }
    return { action: req.method === 'GET' ? 'get' : 'save', id: match[1] };
}

// Application-owned injection only. Production passes no root/options; HTTP and
// environment inputs can never select a directory, filename or SQLite option.
function createProjectApi({ env = process.env, storeApi } = {}) {
    const enabled = env.APIFORGE_PROJECT_API === '1';
    const token = enabled ? crypto.randomBytes(32).toString('hex') : null;
    const router = express.Router();
    let store, established = false, stopping = false, closeError, shutdownPromise;
    let tail = Promise.resolve();
    const api = () => storeApi || require('../project-store'); // Runtime gate stays lazy.
    function closeStore() {
        const current = store;
        store = undefined;
        if (current) try { current.close(); } catch (error) { closeError = safeStoreError(error); }
    }
    function enqueue(action) {
        if (stopping) return Promise.reject(httpFailure('PROJECT_API_STOPPING'));
        const pending = tail.then(async () => {
            if (closeError) throw closeError;
            try { return await action(); }
            catch (error) {
                const safe = safeStoreError(error);
                if (INVALIDATE_STORE.has(safe.code)) closeStore();
                throw safe;
            }
        });
        tail = pending.catch(() => {});
        return pending;
    }
    async function existingStore() {
        if (!store) {
            store = await api().openProjectStore();
            established = true;
        }
        return store;
    }
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cross-Origin-Resource-Policy', 'same-origin');
        try {
            if (!enabled) throw httpFailure('PROJECT_API_DISABLED');
            if (stopping) throw httpFailure('PROJECT_API_STOPPING');
            const host = req.headers.host;
            if (!isLoopback(req.socket.remoteAddress) || headerCount(req, 'host') !== 1 || !isLocalHostHeader(host)) {
                throw httpFailure('PROJECT_API_NOT_LOCAL');
            }
            // req.protocol/hostname may trust proxy headers; the socket never does.
            const authority = new URL((req.socket.encrypted ? 'https://' : 'http://') + host);
            if (Number(authority.port || (req.socket.encrypted ? 443 : 80)) !== req.socket.localPort) {
                throw httpFailure('PROJECT_API_NOT_LOCAL');
            }
            const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
            const mode = req.headers['sec-fetch-mode'], dest = req.headers['sec-fetch-dest'];
            if (headerCount(req, 'origin') > 1 || (origin !== undefined && origin !== authority.origin) ||
                headerCount(req, 'sec-fetch-site') > 1 || (site !== undefined && !['same-origin', 'none'].includes(site)) ||
                headerCount(req, 'sec-fetch-mode') > 1 || (mode !== undefined && !['cors', 'same-origin'].includes(mode)) ||
                headerCount(req, 'sec-fetch-dest') > 1 || (dest !== undefined && dest !== 'empty')) {
                throw httpFailure('PROJECT_API_ORIGIN_REFUSED');
            }
            const selected = route(req);
            if (selected.action !== 'session') {
                const supplied = req.headers[TOKEN_HEADER];
                if (headerCount(req, TOKEN_HEADER) !== 1 || typeof supplied !== 'string' || !/^[0-9a-f]{64}$/.test(supplied) ||
                    !crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(token, 'hex'))) {
                    throw httpFailure('PROJECT_API_TOKEN_INVALID');
                }
            }
            res.locals.projectRoute = selected;
            if (req.method === 'POST' || req.method === 'PUT') {
                const media = req.headers['content-type'];
                if (headerCount(req, 'content-type') !== 1 || typeof media !== 'string' ||
                    !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(media) ||
                    (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'] !== 'identity')) {
                    throw httpFailure('PROJECT_API_MEDIA_UNSUPPORTED');
                }
                if (Number(req.headers['content-length']) > HTTP_BODY_LIMIT) throw httpFailure('PROJECT_API_BODY_TOO_LARGE');
                if (req.headers['transfer-encoding'] === undefined && !Number(req.headers['content-length'])) {
                    throw httpFailure('PROJECT_API_JSON_INVALID');
                }
            } else if (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) !== 0) {
                throw httpFailure('PROJECT_API_REQUEST_INVALID');
            }
            next();
        } catch (error) { respondError(res, error); }
    });
    const parse = express.json({ limit: HTTP_BODY_LIMIT, strict: true, inflate: false, type: () => true,
        verify(req, res, bytes) {
            if (!bytes.length) throw httpFailure('PROJECT_API_JSON_INVALID');
            try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw httpFailure('PROJECT_API_JSON_INVALID'); }
        }
    });
    router.use((req, res, next) => req.method === 'POST' || req.method === 'PUT' ? parse(req, res, next) : next());
    router.use(async (req, res) => {
        try {
            const selected = res.locals.projectRoute;
            if (selected.action === 'session') return res.json({ success: true, data: { token, tokenHeader: TOKEN_HEADER } });
            let input, expected;
            if (selected.action === 'initialize') fields(req.body, [], []);
            if (selected.action === 'create') input = changes(req.body, ['name', 'target', 'source']);
            if (selected.action === 'save') {
                fields(req.body, ['expectedRevision', 'changes'], ['expectedRevision', 'changes']);
                expected = revision(req.body.expectedRevision);
                input = changes(req.body.changes, []);
            }
            const data = await enqueue(async () => {
                if (selected.action === 'initialize') {
                    if (established) throw new ProjectStoreError('PROJECT_STORE_EXISTS');
                    store = await api().initializeProjectStore();
                    established = true;
                    return { storeId: store.storeId };
                }
                const current = await existingStore();
                switch (selected.action) {
                    case 'create': return current.createProject(input);
                    case 'list': return current.listProjects();
                    case 'get': return current.getProject(selected.id);
                    case 'history': return current.getProjectRevision(selected.id, selected.revision);
                    case 'save': return current.saveProject(selected.id, expected, input);
                    default: throw new ProjectStoreError('PROJECT_INVALID_INPUT');
                }
            });
            res.status(['initialize', 'create'].includes(selected.action) ? 201 : 200).json({ success: true, data });
        } catch (error) { respondError(res, error); }
    });
    router.use((error, req, res, next) => {
        const code = error.type === 'entity.too.large' ? 'PROJECT_API_BODY_TOO_LARGE'
            : ['encoding.unsupported', 'charset.unsupported'].includes(error.type) ? 'PROJECT_API_MEDIA_UNSUPPORTED'
            : ['entity.parse.failed', 'entity.verify.failed', 'request.aborted', 'request.size.invalid'].includes(error.type)
                ? 'PROJECT_API_JSON_INVALID' : 'PROJECT_STORE_STORAGE_FAILURE';
        respondError(res, httpFailure(code));
    });
    function shutdown() {
        if (!shutdownPromise) {
            stopping = true;
            shutdownPromise = tail.then(() => { closeStore(); if (closeError) throw closeError; });
        }
        return shutdownPromise;
    }
    return { router, shutdown };
}
module.exports = { createProjectApi, TOKEN_HEADER, HTTP_BODY_LIMIT };
