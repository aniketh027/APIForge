'use strict';
const { fail } = require('./errors');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'];
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function operations(files) {
    const spec = JSON.parse(files.find(file => file.path === 'swagger.json').content);
    const result = [];
    for (const [template, item] of Object.entries(spec.paths || {})) {
        if (!template.startsWith('/') || template.startsWith('//') || !item || Array.isArray(item)) continue;
        const parts = template.split('/').slice(1);
        if (parts.some(part => !part || (!/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(part) && /[{}?#\\%]/.test(part)))) continue;
        const pattern = new RegExp('^/' + parts.map(part => /^\{/.test(part) ? '[^/]+' : escapeRegex(part)).join('/') + '$');
        for (const method of METHODS) {
            const operation = item[method.toLowerCase()];
            if (operation && typeof operation === 'object' && !Array.isArray(operation)) result.push({ method, template, pattern });
        }
    }
    return result;
}
function validatePath(method, value, allowed) {
    if (!METHODS.includes(method) || typeof value !== 'string' || value.length > 8192
        || !value.startsWith('/') || value.startsWith('//') || /[#\\\s\x00-\x1f\x7f]/.test(value)) fail('LIVE_REQUEST_INVALID');
    const pathname = value.split('?')[0];
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { fail('LIVE_REQUEST_INVALID'); }
    // A second decoding layer, separators, and dot segments cannot change meaning downstream.
    if (/%(?:2f|5c|25)/i.test(pathname) || /[\\?#\s\x00-\x1f\x7f]/.test(decoded)
        || decoded.split('/').some(segment => segment === '.' || segment === '..')) fail('LIVE_REQUEST_INVALID');
    if (!allowed.some(operation => operation.method === method && operation.pattern.test(decoded))) fail('LIVE_ENDPOINT_NOT_ALLOWED');
    return value;
}
module.exports = { METHODS, operations, validatePath };
