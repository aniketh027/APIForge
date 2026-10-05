'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const M = require('../src/migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g26-publication-'));
const a = M.compileSourceForSnapshot('ENTITY Item\nv STRING'), b = M.compileSourceForSnapshot('ENTITY Item\nv STRING\nx INT');
let checks = 0;
function bytes(dir) { return Object.fromEntries(fs.readdirSync(dir).map(name => { const file = path.join(dir, name); return [name, fs.statSync(file).isDirectory() ? bytes(file) : fs.readFileSync(file).toString('hex')]; })); }
try {
    for (const method of ['writeFileSync', 'fsyncSync', 'renameSync', 'mkdirSync', 'readFileSync']) {
        const work = path.join(root, method), baseline = M.publishMigrationRevision(work, a, { baseline: true }), before = bytes(path.join(work, 'revisions'));
        let failed = false;
        const io = new Proxy(fs, { get(target, key) { if (key !== method) return target[key]; return (...args) => {
            const staged = String(args[0]).includes('.stage-') || (typeof args[0] === 'number' && ['writeFileSync', 'fsyncSync'].includes(method));
            if (!failed && (staged || method === 'renameSync')) { failed = true; throw Object.assign(Error('injected'), { code: 'EIO' }); }
            return target[key](...args);
        }; } });
        assert.throws(() => M.publishMigrationRevision(work, b, { fileSystem: io, expectHead: baseline.headToken, expectPlan: M.hash(M.planMysqlMigration(a, b)) })); checks++;
        assert.deepEqual(bytes(path.join(work, 'revisions')), before); checks++;
    }
    const work = path.join(root, 'locks'), baseline = M.publishMigrationRevision(work, a, { baseline: true });
    for (const lock of ['active', '{"pid":999999,"old":true}', 'malformed']) {
        fs.writeFileSync(path.join(work, '.writer.lock'), lock);
        assert.throws(() => M.publishMigrationRevision(work, b, { expectHead: baseline.headToken, expectPlan: M.hash(M.planMysqlMigration(a, b)) }), { code: 'MIGRATION_WORKSPACE_BUSY' }); checks++;
        assert.equal(fs.readFileSync(path.join(work, '.writer.lock'), 'utf8'), lock); checks++;
        fs.unlinkSync(path.join(work, '.writer.lock'));
    }
    const io = new Proxy(fs, { get(target, key) { if (key === 'unlinkSync') return () => { throw Error('cleanup failure'); }; return target[key]; } });
    const committed = M.publishMigrationRevision(work, b, { fileSystem: io, expectHead: baseline.headToken, expectPlan: M.hash(M.planMysqlMigration(a, b)) });
    assert(committed.committed && committed.cleanupFailures.length === 1); checks++;
    fs.unlinkSync(path.join(work, '.writer.lock'));
    assert.equal(M.readMigrationWorkspace(work).head.sequence, '000001'); checks++;
    console.log(`G26 publication: ${checks} checks PASS.`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
