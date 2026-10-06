'use strict';
const http = require('http');
const { LiveError, fail } = require('./errors');
const BODY_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const SAFE_HEADERS = ['content-type', 'x-total-count', 'x-page', 'x-limit', 'x-total-pages'];
function serializeBody(body) {
    if (body === undefined) return undefined;
    let text;
    try { text = JSON.stringify(body); } catch { fail('LIVE_REQUEST_INVALID'); }
    if (text === undefined || Buffer.byteLength(text) > BODY_LIMIT) fail('LIVE_REQUEST_INVALID');
    return text;
}
function request(port, method, path, body, { timeoutMs = 10000, responseLimit = RESPONSE_LIMIT } = {}) {
    const data = serializeBody(body);
    const start = Date.now();
    return new Promise((resolve, reject) => {
        let settled = false, response, timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) { response?.destroy(); req.destroy(); reject(error); } else resolve(value);
        };
        const req = http.request({ hostname: '127.0.0.1', port, method, path,
            headers: { accept: 'application/json', ...(data !== undefined ? {
                'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }
        }, incoming => {
            response = incoming;
            let size = 0; const chunks = [];
            incoming.on('data', chunk => {
                size += chunk.length;
                if (size > responseLimit) finish(new LiveError('LIVE_RESPONSE_TOO_LARGE'));
                else chunks.push(chunk);
            });
            incoming.on('error', () => finish(new LiveError('LIVE_REQUEST_FAILED')));
            incoming.on('aborted', () => finish(new LiveError('LIVE_REQUEST_FAILED')));
            incoming.on('end', () => {
                const headers = Object.fromEntries(SAFE_HEADERS.filter(key => typeof incoming.headers[key] === 'string')
                    .map(key => [key, incoming.headers[key]]));
                let body = Buffer.concat(chunks).toString('utf8');
                if (/^application\/(?:[\w.-]+\+)?json\b/i.test(headers['content-type'] || '') && body) {
                    try { body = JSON.parse(body); } catch { /* Bounded malformed JSON stays readable text. */ }
                }
                finish(null, { success: true, status: incoming.statusCode, headers, body, durationMs: Date.now() - start });
            });
        });
        req.on('error', () => finish(new LiveError('LIVE_REQUEST_FAILED')));
        timer = setTimeout(() => finish(new LiveError('LIVE_REQUEST_TIMEOUT')), timeoutMs);
        req.end(data);
    });
}
module.exports = { request, serializeBody, BODY_LIMIT, RESPONSE_LIMIT, SAFE_HEADERS };
