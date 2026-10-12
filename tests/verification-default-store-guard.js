'use strict';
// Verification only: refuse calls, never redirect them. Native PowerShell is not
// launched until its complete JSON request passes the fixture boundary.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const Module = require('node:module');
const programs = require('./verification-windows-powershell');
const rawRead = fs.readFileSync.bind(fs), rawAppend = fs.appendFileSync.bind(fs);
const stats = { nativeIssued: 0, refused: 0 };
const profile = path.resolve(os.homedir());
const protectedRoots = [path.join(profile, '.apiforge-projects'),
    path.join(profile, 'AppData', 'Local', 'APIForge-ProjectStore'),
    path.join(profile, 'AppData', 'Local', 'APIForge')].map(p => p.toLowerCase());
function audit(event, detail = {}) {
    if (process.env.APIFORGE_VERIFY_AUDIT) rawAppend(process.env.APIFORGE_VERIFY_AUDIT,
        JSON.stringify({ pid: process.pid, event, ...detail }) + '\n');
}
function refuse(reason) {
    stats.refused++; audit('refused-before-issue', { reason });
    throw Object.assign(Error('Verification boundary refused: ' + reason), { code: 'VERIFY_DEFAULT_STORE_REFUSED' });
}
function normalized(value) {
    if (value instanceof URL) value = fileURLToPath(value);
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    if (typeof value !== 'string') return null;
    if (value.startsWith('file:')) value = fileURLToPath(value);
    return path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase();
}
function check(value, operation) {
    const p = normalized(value);
    if (p && protectedRoots.some(root => p === root || p.startsWith(root + path.sep))) refuse(operation);
}
function fixture(value) {
    if (typeof value !== 'string' || !path.win32.isAbsolute(value) || path.resolve(value) !== value) refuse('explicit canonical fixture path required');
    check(value, 'fixture');
    const rel = path.relative(profile, value);
    if (!/^APIForge-(?:M2A-SQLite-Project-Store-tests|M2B-HTTP-tests|M2C-UI-tests|M2D-A-bootstrap-fixtures)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\\[^\\]+)*$/.test(rel)) refuse('fixture UUID namespace required');
    if (process.env.APIFORGE_VERIFY_BOOTSTRAP_PARENT &&
        value !== process.env.APIFORGE_VERIFY_BOOTSTRAP_PARENT &&
        !value.startsWith(process.env.APIFORGE_VERIFY_BOOTSTRAP_PARENT + path.sep)) refuse('fixture outside this run');
    return value;
}
const methods = ['access','exists','chmod','chown','lchmod','lchown','lstat','stat','statfs','readFile','writeFile','appendFile','readlink','readdir','realpath','unlink','mkdir','mkdtemp','opendir','open','rm','rmdir','truncate','utimes','lutimes','watch','watchFile','unwatchFile','createReadStream','createWriteStream','cp','copyFile','rename','link','symlink'];
for (const api of [fs, fs.promises]) for (const name of methods) for (const suffix of ['', 'Sync']) {
    const key = name + suffix, original = api[key];
    if (typeof original !== 'function') continue;
    const wrapped = function(...args) {
        check(args[0], key);
        if (['cp','copyFile','rename','link','symlink'].includes(name)) check(args[1], key);
        return original.apply(this, args);
    };
    if (original.native) wrapped.native = function(...args) { check(args[0], key + '.native'); return original.native.apply(this, args); };
    api[key] = wrapped;
}
const helper = rawRead(path.join(__dirname, '../src/windows-bootstrap/security.ps1'), 'utf8').replace(/\r\n/g, '\n');
function gitBlob(bytes) { return crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'); }
if (gitBlob(Buffer.from(helper)) !== '9db60db7b8a7ff25c91d097257e1b2f4407aa07f') refuse('published Windows helper identity differs');
function validateNative(source, data) {
    if (source === helper) {
        if (!data || !Object.hasOwn(data, 'root') || !data.root) refuse('native Bootstrap default selection');
        fixture(data.root);
        if (!['resolve','initialize','verifyRoot','verifyMarker','verifyFile'].includes(data.action)) refuse('unknown Bootstrap operation');
        if (data.action === 'verifyFile' && !['projects.sqlite3','projects.sqlite3-journal'].includes(data.file)) refuse('unknown Bootstrap file');
    } else if (Object.values(programs).includes(source)) {
        const paths = source === programs.snapshot ? data.paths : [data.path || data.file];
        if (!Array.isArray(paths) || !paths.length) refuse('native fixture operands missing');
        paths.forEach(fixture);
    } else refuse('unapproved native PowerShell program');
}
const nativeSpawn = cp.spawn;
cp.spawn = function(command, args = [], options = {}) {
    for (const value of [command, ...args]) if (typeof value === 'string' && /\.apiforge-projects|APIForge-ProjectStore/i.test(value)) refuse('child command names default storage');
    if (!/^(?:powershell|pwsh)(?:\.exe)?$/i.test(path.basename(command))) return nativeSpawn.call(this, command, args, options);
    const i = args.indexOf('-EncodedCommand');
    if (i < 0 || options.shell) refuse('native PowerShell must use fixed encoded program');
    const source = Buffer.from(args[i + 1], 'base64').toString('utf16le').replace(/\r\n/g, '\n');
    // Fail unknown programs before even accepting input.
    if (source !== helper && !Object.values(programs).includes(source)) refuse('unapproved native PowerShell program');
    const proxy = new EventEmitter(), chunks = [];
    proxy.stdout = new PassThrough(); proxy.stderr = new PassThrough();
    let actual, killed = false;
    proxy.kill = (...values) => { killed = true; return actual ? actual.kill(...values) : true; };
    proxy.stdin = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
        final(done) {
            try {
                const input = Buffer.concat(chunks);
                validateNative(source, JSON.parse(input.toString('utf8')));
                if (killed) throw Error('Cancelled before native issue');
                stats.nativeIssued++; audit('native-issued-after-validation', { root: JSON.parse(input).root || null });
                actual = nativeSpawn.call(cp, command, args, options); proxy.pid = actual.pid;
                actual.stdout?.pipe(proxy.stdout); actual.stderr?.pipe(proxy.stderr);
                for (const event of ['error','exit','close','spawn']) actual.on(event, (...values) => proxy.emit(event, ...values));
                actual.stdin.on('error', error => proxy.stdin.emit('error', error));
                actual.stdin.end(input); done();
            } catch (error) { done(error); }
        } });
    proxy.stdin.on('error', error => { proxy.emit('error', error); proxy.emit('close', 1); });
    return proxy;
};
for (const method of ['spawnSync','execFile','execFileSync','exec','execSync']) {
    const original = cp[method];
    cp[method] = function(command, ...args) {
        if (/powershell|pwsh|\.apiforge-projects|APIForge-ProjectStore/i.test(String(command))) refuse('unguarded native child operation');
        return original.call(this, command, ...args);
    };
}
const originalLoad = Module._load, seen = new WeakSet();
Module._load = function(id, ...args) {
    const value = originalLoad.call(this, id, ...args);
    if (value && typeof value.initializePrivateStoreRoot === 'function' && typeof value.openPrivateStoreRoot === 'function' && !seen.has(value)) {
        seen.add(value);
        for (const name of ['initializePrivateStoreRoot','openPrivateStoreRoot']) {
            const original = value[name];
            value[name] = async function(options) {
                if (!options || !Object.hasOwn(options, 'root') || typeof options.root !== 'string') refuse('Bootstrap root omitted or null');
                fixture(options.root); return original.call(this, options);
            };
        }
    }
    return value;
};
module.exports = { stats, fixture, validateNative, helper };
