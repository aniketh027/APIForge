'use strict';
const express = require('express');
const net = require('net');
const { createManager } = require('../live-runner/manager');
const { LiveError, publicError } = require('../live-runner/errors');
function isLoopback(address) {
    if (typeof address !== 'string') return false;
    const value = address.toLowerCase();
    if (net.isIP(value) === 4) return value.startsWith('127.');
    if (net.isIP(value) !== 6) return false;
    // URL normalizes expanded IPv6 and dotted/hex IPv4-mapped forms.
    const normalized = new URL('http://[' + value + ']').hostname;
    return normalized === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(normalized);
}
function createRouter(manager = createManager()) {
    const router = express.Router();
    router.use((req, res, next) => {
        // Socket peer is authoritative; proxy headers do not establish locality.
        let code;
        if (!isLoopback(req.socket.remoteAddress)) code = 'LIVE_NOT_LOCAL';
        else if (!manager.enabled()) code = 'LIVE_DISABLED';
        else if (req.headers.origin && req.headers.origin !== req.protocol + '://' + req.headers.host) code = 'LIVE_NOT_LOCAL';
        if (code) return res.status(403).json(publicError(new LiveError(code)));
        next();
    });
    router.use(express.json({ limit: '1mb', strict: true }));
    router.get('/status', (req, res) => res.json(manager.status()));
    for (const action of ['start', 'request', 'stop']) router.post('/' + action, async (req, res) => {
        try { res.json(await manager[action](req.body)); }
        catch (error) {
            const safe = publicError(error);
            const status = safe.code === 'LIVE_SESSION_INVALID' ? 409 : /FAILED$/.test(safe.code) ? 500 : 400;
            res.status(status).json(safe);
        }
    });
    router.use((error, req, res, next) => res.status(400).json(publicError(new LiveError('LIVE_REQUEST_INVALID'))));
    return router;
}
module.exports = { createRouter, isLoopback };
