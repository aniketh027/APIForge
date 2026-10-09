'use strict';
// Directory bootstrap only. No compiler, server, database or recovery dependencies.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const MARKER = 'bootstrap.identity.json';
const DATABASE = 'projects.sqlite3';
const JOURNAL = 'projects.sqlite3-journal';
const messages = Object.freeze({
    BOOTSTRAP_UNSUPPORTED_PLATFORM: 'Windows 10/11 x64 is required for this bootstrap.',
    BOOTSTRAP_INVALID_OPTIONS: 'Invalid Windows bootstrap options.',
    BOOTSTRAP_INVALID_PATH: 'A canonical absolute Windows directory path is required.',
    BOOTSTRAP_UNSAFE_LOCATION: 'Storage must be in the current user profile outside a Git checkout.',
    BOOTSTRAP_HELPER_UNAVAILABLE: 'The built-in Windows security helper is unavailable.',
    BOOTSTRAP_ELEVATED: 'Run the bootstrap using a normal unelevated user account.',
    BOOTSTRAP_UNSUPPORTED_VOLUME: 'Storage requires a fixed local NTFS volume.',
    BOOTSTRAP_PARENT_MISSING: 'The storage parent must already exist.',
    BOOTSTRAP_ROOT_EXISTS: 'The destination already exists; initialization cannot adopt it.',
    BOOTSTRAP_ROOT_MISSING: 'Established storage is missing; manual resolution is required.',
    BOOTSTRAP_LEGACY_LOCATION: 'Previous default storage exists; explicit manual location resolution is required.',
    BOOTSTRAP_UNSAFE_PATH: 'Storage contains unsupported filesystem indirection or entry types.',
    BOOTSTRAP_UNSAFE_OWNER: 'Storage ownership is unsafe; manual resolution is required.',
    BOOTSTRAP_UNSAFE_ACL: 'Storage access restrictions are unsafe; manual resolution is required.',
    BOOTSTRAP_UNSAFE_ANCESTOR: 'An ancestor permits untrusted modification; manual resolution is required.',
    BOOTSTRAP_UNSUPPORTED_ACL: 'The Windows security descriptor is unsupported.',
    BOOTSTRAP_ACCESS_DENIED: 'Windows storage access is denied; manual resolution is required.',
    BOOTSTRAP_SECURITY_CHECK_FAILED: 'Windows storage security could not be verified.',
    BOOTSTRAP_IDENTITY_MISMATCH: 'Storage filesystem identity changed; manual resolution is required.',
    BOOTSTRAP_RECOVERY_REQUIRED: 'Bootstrap state is incomplete or unexpected; manual resolution is required.',
    BOOTSTRAP_CORRUPT_IDENTITY: 'Bootstrap identity is malformed or incompatible; manual resolution is required.',
    BOOTSTRAP_STORAGE_FAILURE: 'Windows storage initialization failed; retained state requires manual inspection.'
});
class WindowsBootstrapError extends Error {
    constructor(code) {
        super(messages[code] || messages.BOOTSTRAP_SECURITY_CHECK_FAILED);
        this.name = 'WindowsBootstrapError';
        this.code = Object.hasOwn(messages, code) ? code : 'BOOTSTRAP_SECURITY_CHECK_FAILED';
    }
}
function fail(code) { throw new WindowsBootstrapError(code); }
function validatePath(root) {
    if (typeof root !== 'string' || root.length > 200 || !/^[A-Za-z]:\\[^\\]/.test(root) ||
        /[\x00-\x1f\x7f<>"|?*\/]/.test(root) || /[\ud800-\udfff]/u.test(root) || root.slice(2).includes(':')) fail('BOOTSTRAP_INVALID_PATH');
    for (const part of root.slice(3).split('\\')) {
        if (!part || part === '.' || part === '..' || /[.\s]$/u.test(part) ||
            /^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)) fail('BOOTSTRAP_INVALID_PATH');
    }
    return root;
}
function optionsRoot(options) {
    if (options === undefined) return null;
    if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
        Reflect.ownKeys(options).some(key => key !== 'root') ||
        (Object.hasOwn(options, 'root') && !Object.hasOwn(Object.getOwnPropertyDescriptor(options, 'root'), 'value'))) fail('BOOTSTRAP_INVALID_OPTIONS');
    return Object.hasOwn(options, 'root') ? validatePath(options.root) : null;
}
function helper(action, root, file) {
    return new Promise((resolve, reject) => {
        let exe, encoded;
        try {
            const systemRoot = process.env.SystemRoot;
            validatePath(systemRoot);
            exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            if (fs.realpathSync(exe).toLowerCase() !== exe.toLowerCase()) fail('BOOTSTRAP_HELPER_UNAVAILABLE');
            // -EncodedCommand expects UTF-16LE, never includes request data.
            const source = fs.readFileSync(path.join(__dirname, 'security.ps1'), 'utf8').replace(/\r\n/g, '\n');
            encoded = Buffer.from(source, 'utf16le').toString('base64');
            if (encoded.length > 30000) fail('BOOTSTRAP_HELPER_UNAVAILABLE');
        } catch { return reject(new WindowsBootstrapError('BOOTSTRAP_HELPER_UNAVAILABLE')); }
        const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
            shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
            env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') }
        });
        let output = '', finished = false;
        const finish = (error, value) => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => { child.kill(); finish(new WindowsBootstrapError('BOOTSTRAP_HELPER_UNAVAILABLE')); }, 20000);
        child.on('error', () => finish(new WindowsBootstrapError('BOOTSTRAP_HELPER_UNAVAILABLE')));
        child.stdin.on('error', () => {});
        child.stdout.on('data', chunk => {
            output += chunk.toString('utf8');
            if (output.length > 65536) { child.kill(); finish(new WindowsBootstrapError('BOOTSTRAP_HELPER_UNAVAILABLE')); }
        });
        child.on('close', code => {
            try {
                const result = JSON.parse(output.replace(/^\uFEFF/, '').trim());
                if (result.ok !== true || code !== 0) return finish(new WindowsBootstrapError(result.code));
                if (typeof result.root !== 'string' || typeof result.ownerSid !== 'string') throw new Error();
                finish(null, result);
            } catch { finish(new WindowsBootstrapError('BOOTSTRAP_HELPER_UNAVAILABLE')); }
        });
        child.stdin.end(JSON.stringify({ action, root, file }), 'utf8');
    });
}
function identity(stat) {
    return { device: stat.dev.toString(), file: stat.ino.toString(), birth: stat.birthtimeNs.toString() };
}
function same(a, b) { return a.device === b.device && a.file === b.file && a.birth === b.birth; }
async function statEntry(file, missing) {
    try { return await fsp.lstat(file, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') fail(missing); fail('BOOTSTRAP_SECURITY_CHECK_FAILED'); }
}
async function chain(root, includeRoot) {
    let current = includeRoot ? root : path.dirname(root);
    const entries = [];
    for (;;) {
        const stat = await statEntry(current, includeRoot && current === root ? 'BOOTSTRAP_ROOT_MISSING' : 'BOOTSTRAP_PARENT_MISSING');
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail('BOOTSTRAP_UNSAFE_PATH');
        if ((await fsp.realpath(current)).toLowerCase() !== current.toLowerCase()) fail('BOOTSTRAP_UNSAFE_PATH');
        try { await fsp.lstat(path.join(current, '.git')); fail('BOOTSTRAP_UNSAFE_LOCATION'); }
        catch (error) { if (error instanceof WindowsBootstrapError) throw error; if (error.code !== 'ENOENT') fail('BOOTSTRAP_SECURITY_CHECK_FAILED'); }
        entries.push({ path: current, ...identity(stat) });
        const parent = path.dirname(current);
        if (parent === current) return entries;
        current = parent;
    }
}
async function resolveRoot(options) {
    if (process.platform !== 'win32' || process.arch !== 'x64') fail('BOOTSTRAP_UNSUPPORTED_PLATFORM');
    const requested = optionsRoot(options);
    const result = await helper('resolve', requested);
    return { root: validatePath(result.root), ownerSid: result.ownerSid };
}
async function checkRoot(root) {
    const before = await chain(root, true);
    const security = await helper('verifyRoot', root);
    const after = await chain(root, true);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail('BOOTSTRAP_IDENTITY_MISMATCH');
    return { stat: await statEntry(root, 'BOOTSTRAP_ROOT_MISSING'), security };
}
async function readIdentity(root, ownerSid, rootStat) {
    const file = path.join(root, MARKER);
    const before = await statEntry(file, 'BOOTSTRAP_RECOVERY_REQUIRED');
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail('BOOTSTRAP_UNSAFE_PATH');
    await helper('verifyMarker', root);
    let handle;
    try {
        handle = await fsp.open(file, 'r');
        const stat = await handle.stat({ bigint: true });
        if (!same(identity(before), identity(stat)) || stat.nlink !== 1n) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        if (stat.size < 1n || stat.size > 4096n) fail('BOOTSTRAP_CORRUPT_IDENTITY');
        const buffer = Buffer.alloc(Number(stat.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== buffer.length) fail('BOOTSTRAP_CORRUPT_IDENTITY');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
        const record = JSON.parse(text);
        if (record.formatVersion !== 1 || record.ownerSid !== ownerSid ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.storeId) ||
            JSON.stringify(record) + '\n' !== text || Object.keys(record).join(',') !== 'formatVersion,storeId,ownerSid,rootIdentity,markerIdentity' ||
            !['rootIdentity', 'markerIdentity'].every(key => record[key] && Object.keys(record[key]).join(',') === 'device,file,birth' &&
                Object.values(record[key]).every(value => typeof value === 'string' && /^[0-9]+$/.test(value)))) fail('BOOTSTRAP_CORRUPT_IDENTITY');
        if (!same(record.rootIdentity, identity(rootStat)) || !same(record.markerIdentity, identity(stat))) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        return Object.freeze({ root, storeId: record.storeId, ownerSid, formatVersion: 1 });
    } catch (error) {
        if (error instanceof WindowsBootstrapError) throw error;
        fail('BOOTSTRAP_CORRUPT_IDENTITY');
    } finally { if (handle) await handle.close(); }
}
async function readInventory(root) {
    const names = (await fsp.readdir(root)).sort();
    if (!names.includes(MARKER) || names.some(name => ![MARKER, DATABASE, JOURNAL].includes(name)) ||
        (names.includes(JOURNAL) && !names.includes(DATABASE))) fail('BOOTSTRAP_RECOVERY_REQUIRED');
    const files = {};
    for (const name of [DATABASE, JOURNAL]) {
        if (!names.includes(name)) { files[name] = null; continue; }
        const file = path.join(root, name);
        const before = await statEntry(file, 'BOOTSTRAP_RECOVERY_REQUIRED');
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
            (await fsp.realpath(file)).toLowerCase() !== file.toLowerCase()) fail('BOOTSTRAP_UNSAFE_PATH');
        await helper('verifyFile', root, name);
        const after = await statEntry(file, 'BOOTSTRAP_RECOVERY_REQUIRED');
        if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n ||
            !same(identity(before), identity(after))) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        files[name] = Object.freeze({ name, ...identity(after) });
    }
    // Filesystem observations only: no SQLite content read, validation or adoption.
    return Object.freeze({ main: files[DATABASE], journal: files[JOURNAL], contentValidated: false });
}
async function openPrivateStoreRoot(options) {
    try {
        const { root, ownerSid } = await resolveRoot(options);
        const { stat } = await checkRoot(root);
        const sqlite = await readInventory(root);
        const result = await readIdentity(root, ownerSid, stat);
        const final = await checkRoot(root);
        if (!same(identity(stat), identity(final.stat))) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        if (JSON.stringify(sqlite) !== JSON.stringify(await readInventory(root))) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        return Object.freeze({ ...result, sqlite });
    } catch (error) {
        if (error instanceof WindowsBootstrapError) throw error;
        fail('BOOTSTRAP_SECURITY_CHECK_FAILED');
    }
}
async function initializePrivateStoreRoot(options) {
    let handle;
    try {
        const { root, ownerSid } = await resolveRoot(options);
        const before = await chain(root, false);
        try { await fsp.lstat(root); fail('BOOTSTRAP_ROOT_EXISTS'); }
        catch (error) { if (error instanceof WindowsBootstrapError) throw error; if (error.code !== 'ENOENT') fail('BOOTSTRAP_SECURITY_CHECK_FAILED'); }
        await helper('initialize', root);
        if (JSON.stringify(before) !== JSON.stringify(await chain(root, false))) fail('BOOTSTRAP_IDENTITY_MISMATCH');
        const { stat } = await checkRoot(root);
        if ((await fsp.readdir(root)).length !== 0) fail('BOOTSTRAP_RECOVERY_REQUIRED');
        handle = await fsp.open(path.join(root, MARKER), 'wx', 0o600);
        const markerStat = await handle.stat({ bigint: true });
        // Verify the inherited private descriptor before writing identity bytes.
        await helper('verifyMarker', root);
        const record = { formatVersion: 1, storeId: crypto.randomUUID(), ownerSid,
            rootIdentity: identity(stat), markerIdentity: identity(markerStat) };
        await handle.writeFile(JSON.stringify(record) + '\n', 'utf8');
        await handle.sync();
        await handle.close(); handle = null;
        return await openPrivateStoreRoot({ root });
    } catch (error) {
        if (error instanceof WindowsBootstrapError) throw error;
        if (error.code === 'EEXIST') fail('BOOTSTRAP_ROOT_EXISTS');
        if (error.code === 'EACCES' || error.code === 'EPERM') fail('BOOTSTRAP_ACCESS_DENIED');
        fail('BOOTSTRAP_STORAGE_FAILURE');
    } finally { if (handle) await handle.close().catch(() => {}); }
}
module.exports = { initializePrivateStoreRoot, openPrivateStoreRoot, WindowsBootstrapError };
