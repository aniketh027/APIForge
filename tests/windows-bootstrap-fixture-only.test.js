'use strict';
// Authorized fixture-only matrix exception. Never invokes the published full suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const guard = require('./verification-default-store-guard');
const bootstrap = require('../src/windows-bootstrap');
const programs = require('./verification-windows-powershell');
const results = [], identities = new Map();
const parent = path.join(os.homedir(), 'APIForge-M2D-A-bootstrap-fixtures-' + crypto.randomUUID());
process.env.APIFORGE_VERIFY_BOOTSTRAP_PARENT = parent;
const marker = 'bootstrap.identity.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const id = s => [s.dev, s.ino, s.birthtimeNs].map(String);
function owned(file) { return guard.fixture(file); }
async function fixture(name) {
    const folder = owned(path.join(parent, name + '-' + crypto.randomUUID()));
    await fsp.mkdir(folder); return path.join(folder, 'store');
}
async function init(name) {
    const root = await fixture(name), value = await bootstrap.initializePrivateStoreRoot({ root });
    identities.set(root, { id: id(await fsp.lstat(root, { bigint: true })), storeId: value.storeId }); return root;
}
function native(source, data) {
    const exe = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    return new Promise((resolve, reject) => {
        const child = cp.spawn(exe, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],
            { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'], env: { ...process.env,
                PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') } });
        let out = '', err = '';
        child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
        child.once('error', reject); child.once('close', code => code === 0 ? resolve(out.trim()) : reject(Error(err || out)));
        child.stdin.end(JSON.stringify(data));
    });
}
async function snapshot(root) {
    owned(root); const entries = {}, paths = [];
    async function walk(file) {
        owned(file); const s = await fsp.lstat(file, { bigint: true });
        const record = { identity: id(s), mode: String(s.mode), size: String(s.size) };
        if (s.isSymbolicLink()) record.link = await fsp.readlink(file);
        else {
            paths.push(file);
            if (s.isFile()) record.sha256 = hash(await fsp.readFile(file));
            if (s.isDirectory()) for (const name of (await fsp.readdir(file)).sort()) await walk(path.join(file, name));
        }
        entries[path.relative(root, file)] = record;
    }
    await walk(root); return { entries, security: await native(programs.snapshot, { paths }) };
}
async function refusal(root, action, code) {
    const before = await snapshot(root);
    await assert.rejects(action, error => error.name === 'WindowsBootstrapError' && error.code === code);
    assert.deepEqual(await snapshot(root), before, 'Refusal preserves fixture bytes, identities and native ACLs');
}
async function cleanup(root) {
    owned(root); const expected = identities.get(root);
    if (!expected) throw Error('Unknown cleanup ownership; fixture retained');
    const s = await fsp.lstat(root, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Unsafe cleanup root; fixture retained');
    assert.deepEqual(id(s), expected.id, 'Cleanup root identity must match this run');
    const value = await bootstrap.openPrivateStoreRoot({ root });
    assert.equal(value.storeId, expected.storeId);
    assert.deepEqual(await fsp.readdir(root), [marker], 'Cleanup allows only the healthy known marker');
    assert.deepEqual(id(await fsp.lstat(root, { bigint: true })), expected.id);
    await fsp.rm(root, { recursive: true }); identities.delete(root);
}
async function test(name, action) {
    const start = Date.now();
    try { await action(); results.push({ name, status: 'PASS', ms: Date.now() - start }); }
    catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); process.exitCode = 1; }
    console.log(results.at(-1).status + ' ' + name);
    if (results.at(-1).status === 'FAIL') console.error(results.at(-1).error);
}
async function main() {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Native Windows x64 fixture suite required');
    await fsp.mkdir(parent); console.log('Retained disposable fixtures: ' + parent);
    const parentIdentity = id(await fsp.lstat(parent, { bigint: true }));
    await test('hard boundary rejects omitted, null and outside-run roots before any native issue', async () => {
        const before = guard.stats.nativeIssued;
        for (const options of [undefined, {}, { root: null }, { root: '' }, { root: 42 }, { root: path.join(parent, '..', 'outside') }])
            await assert.rejects(() => bootstrap.openPrivateStoreRoot(options), { code: 'VERIFY_DEFAULT_STORE_REFUSED' });
        assert.equal(guard.stats.nativeIssued, before);
    });
    await test('native PowerShell default request and unknown program rejected before process creation', async () => {
        const before = guard.stats.nativeIssued;
        await assert.rejects(() => native(guard.helper, { action: 'resolve', root: null }), { code: 'VERIFY_DEFAULT_STORE_REFUSED' });
        assert.throws(() => cp.spawn('powershell.exe', ['-EncodedCommand', Buffer.from('Write-Output unapproved','utf16le').toString('base64')]),
            { code: 'VERIFY_DEFAULT_STORE_REFUSED' });
        assert.equal(guard.stats.nativeIssued, before);
    });
    await test('explicit native private admission and stable immutable identity', async () => {
        const root = await init('admit'), first = await bootstrap.openPrivateStoreRoot({ root });
        assert.equal(Object.isFrozen(first), true); assert.match(first.storeId, /^[0-9a-f-]{36}$/);
        const before = await snapshot(root);
        assert.deepEqual(await bootstrap.openPrivateStoreRoot({ root }), first);
        assert.deepEqual(await snapshot(root), before);
        await refusal(root, () => bootstrap.initializePrivateStoreRoot({ root }), 'BOOTSTRAP_ROOT_EXISTS');
    });
    await test('unknown existing root refused without adoption or ACL repair', async () => {
        const root = await fixture('unknown'); await fsp.mkdir(root); await fsp.writeFile(path.join(root, 'sentinel'), 'keep');
        await refusal(root, () => bootstrap.initializePrivateStoreRoot({ root }), 'BOOTSTRAP_ROOT_EXISTS');
        await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_ACL');
        await assert.rejects(() => cleanup(root), /Unknown cleanup ownership/);
    });
    await test('native broadened root and marker ACLs refused without repair', async () => {
        for (const where of ['root', 'marker']) {
            const root = await init('broad-' + where);
            await native(programs.broad, { path: where === 'root' ? root : path.join(root, marker) });
            await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_ACL');
        }
    });
    await test('native broadened parent refused before child creation and after admission', async () => {
        const absent = await fixture('parent-absent'); await native(programs.broad, { path: path.dirname(absent) });
        await refusal(path.dirname(absent), () => bootstrap.initializePrivateStoreRoot({ root: absent }), 'BOOTSTRAP_UNSAFE_ANCESTOR');
        assert.equal(fs.existsSync(absent), false);
        const root = await init('parent-change'); await native(programs.broad, { path: path.dirname(root) });
        await refusal(path.dirname(root), () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_ANCESTOR');
    });
    await test('native current-user deny overrides private allow', async () => {
        const root = await init('deny'); await native(programs.deny, { path: root });
        await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_ACCESS_DENIED');
    });
    await test('native root and parent junctions refused; targets preserved', async () => {
        const root = await fixture('junction'), target = path.join(path.dirname(root), 'target');
        await fsp.mkdir(target); await fsp.writeFile(path.join(target, 'sentinel'), 'keep'); await fsp.symlink(target, root, 'junction');
        await refusal(path.dirname(root), () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_PATH');
        await refusal(path.dirname(root), () => bootstrap.initializePrivateStoreRoot({ root: path.join(root, 'child') }), 'BOOTSTRAP_UNSAFE_PATH');
    });
    await test('marker replacement and hard-link alias refused', async () => {
        const root = await init('marker-replace'), file = path.join(root, marker), bytes = await fsp.readFile(file);
        await fsp.rename(file, path.join(path.dirname(root), 'retained-marker')); await fsp.writeFile(file, bytes);
        await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_IDENTITY_MISMATCH');
        const second = await init('marker-hardlink'); await fsp.link(path.join(second, marker), path.join(path.dirname(second), 'alias'));
        await refusal(path.dirname(second), () => bootstrap.openPrivateStoreRoot({ root: second }), 'BOOTSTRAP_UNSAFE_PATH');
    });
    await test('missing established root is retained, never reinitialized', async () => {
        const root = await init('missing'); await fsp.rename(root, root + '-retained');
        await refusal(path.dirname(root), () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_ROOT_MISSING');
        assert.equal(fs.existsSync(root), false);
    });
    await test('absent marker and unknown entries refuse without cleanup', async () => {
        const root = await init('absent-marker'); await fsp.rename(path.join(root, marker), path.join(path.dirname(root), 'retained-marker'));
        await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_RECOVERY_REQUIRED');
        const other = await init('unknown-entry'); await fsp.writeFile(path.join(other, 'unexpected.txt'), 'keep');
        await refusal(other, () => bootstrap.openPrivateStoreRoot({ root: other }), 'BOOTSTRAP_RECOVERY_REQUIRED');
    });
    await test('simulated SQLite main and rollback journal admitted without content validation', async () => {
        const root = await init('sqlite'); await fsp.writeFile(path.join(root, 'projects.sqlite3'), 'SIMULATED NOT SQLITE');
        await fsp.writeFile(path.join(root, 'projects.sqlite3-journal'), 'SIMULATED JOURNAL');
        const before = await snapshot(root), value = await bootstrap.openPrivateStoreRoot({ root });
        assert.equal(value.sqlite.contentValidated, false); assert.equal(value.sqlite.main.name, 'projects.sqlite3');
        assert.equal(value.sqlite.journal.name, 'projects.sqlite3-journal'); assert.deepEqual(await snapshot(root), before);
    });
    await test('orphan journal and WAL/SHM unsafe entries retained', async () => {
        for (const name of ['projects.sqlite3-journal','projects.sqlite3-wal','projects.sqlite3-shm']) {
            const root = await init('orphan'); await fsp.writeFile(path.join(root, name), 'keep');
            await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_RECOVERY_REQUIRED');
        }
    });
    await test('SQLite directory and hard-link entries refused', async () => {
        for (const kind of ['directory','hardlink']) {
            const root = await init('sqlite-' + kind), file = path.join(root, 'projects.sqlite3');
            if (kind === 'directory') await fsp.mkdir(file);
            else { await fsp.writeFile(file, 'simulated'); await fsp.link(file, path.join(path.dirname(root), 'alias')); }
            await refusal(path.dirname(root), () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_PATH');
        }
    });
    await test('corrupt and incompatible marker bytes retained', async () => {
        for (const mutation of ['json','version','extra']) {
            const root = await init('corrupt'), file = path.join(root, marker), value = JSON.parse(await fsp.readFile(file,'utf8'));
            if (mutation === 'version') value.formatVersion = 2; if (mutation === 'extra') value.extra = 1;
            await fsp.writeFile(file, mutation === 'json' ? '{' : JSON.stringify(value) + '\n');
            await refusal(root, () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_CORRUPT_IDENTITY');
        }
    });
    await test('file at root and Git-checkout ancestor refused', async () => {
        const root = await fixture('file'); await fsp.writeFile(root, 'keep');
        await refusal(path.dirname(root), () => bootstrap.openPrivateStoreRoot({ root }), 'BOOTSTRAP_UNSAFE_PATH');
        const git = await fixture('git'); await fsp.writeFile(path.join(path.dirname(git), '.git'), 'fixture sentinel');
        await refusal(path.dirname(git), () => bootstrap.initializePrivateStoreRoot({ root: git }), 'BOOTSTRAP_UNSAFE_LOCATION');
    });
    await test('cleanup refuses substituted identity and preserves replacement', async () => {
        const root = await init('cleanup-replaced'); await fsp.rename(root, root + '-retained'); await fsp.mkdir(root);
        const before = await snapshot(path.dirname(root)); await assert.rejects(() => cleanup(root), /Cleanup root identity/);
        assert.deepEqual(await snapshot(path.dirname(root)), before);
    });
    await test('healthy cleanup verifies native identity and removes only the owned root', async () => {
        const root = await init('cleanup-healthy'), sibling = path.join(path.dirname(root), 'sentinel'); await fsp.writeFile(sibling, 'retain');
        await cleanup(root); assert.equal(fs.existsSync(root), false); assert.equal(await fsp.readFile(sibling, 'utf8'), 'retain');
    });
    assert.deepEqual(id(await fsp.lstat(parent, { bigint: true })), parentIdentity);
    const excluded = ['OS default-store selection and environment spoofing','real default/legacy observations and preservation assertions',
        'default-folder/legacy simulations using null roots','elevated and second-user fixtures','unsupported mounted volumes',
        'Windows 10/Node 18 native matrix','native unsupported-owner and raw-descriptor installation','static symlinks requiring privilege',
        'bootstrap initializer races and termination barriers','power-loss and native SQLite content/recovery'];
    const report = { parent, parentIdentity, results, counts: results.reduce((a,r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}),
        guard: guard.stats, excluded, cleanup: 'Healthy root removed after identity verification; unknown, failed and substituted fixtures retained.' };
    await fsp.writeFile(path.join(parent, 'results.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
