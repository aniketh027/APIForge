'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const M = require('../src/migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g26-publication-'));
const a = M.compileSourceForSnapshot('ENTITY Item\nv STRING'), b = M.compileSourceForSnapshot('ENTITY Item\nv STRING\nx INT');
let checks = 0;
function bytes(dir) { return Object.fromEntries(fs.readdirSync(dir).map(name => { const file = path.join(dir, name); return [name, fs.statSync(file).isDirectory() ? bytes(file) : fs.readFileSync(file).toString('hex')]; })); }
try {
    const originalCwd = process.cwd(), repositoryRoot = path.resolve(__dirname, '..');
    const repositoryOutput = path.join(repositoryRoot, 'output');
    const repositoryWorkspace = path.join(repositoryOutput, path.basename(root));
    assert.equal(fs.existsSync(repositoryWorkspace), false);
    try {
        function rejectsGeneratedWorkspace(workspace) {
            const mutations = [];
            const writingMethods = new Set(['mkdirSync', 'openSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'rmSync', 'unlinkSync']);
            const io = new Proxy(fs, { get(target, key) {
                if (!writingMethods.has(key)) return target[key];
                return (...args) => { mutations.push(key); return target[key](...args); };
            } });
            assert.throws(() => M.publishMigrationRevision(workspace, a, { baseline: true, fileSystem: io }), { code: 'MIGRATION_HISTORY_CORRUPT' }); checks++;
            assert.deepEqual(mutations, []); checks++;
            assert.equal(fs.existsSync(workspace), false); checks++;
            assert.throws(() => M.readMigrationWorkspace(workspace), { code: 'MIGRATION_HISTORY_CORRUPT' }); checks++;
        }
        process.chdir(repositoryRoot);
        rejectsGeneratedWorkspace(repositoryWorkspace);
        process.chdir(root);
        rejectsGeneratedWorkspace(repositoryWorkspace);
        rejectsGeneratedWorkspace(path.join(root, 'output', 'history'));

        const external = path.join(root, 'external-history');
        const first = M.publishMigrationRevision(external, a, { baseline: true });
        assert.equal(first.committed, true); checks++;
        assert.equal(first.sequence, '000000'); checks++;
        const firstBytes = bytes(path.join(external, 'revisions', '000000'));
        const second = M.publishMigrationRevision(external, b, { expectHead: first.headToken, expectPlan: M.hash(M.planMysqlMigration(a, b)) });
        assert.equal(second.committed, true); checks++;
        assert.equal(second.sequence, '000001'); checks++;
        assert.deepEqual(bytes(path.join(external, 'revisions', '000000')), firstBytes); checks++;
        assert.equal(M.readMigrationWorkspace(external).headToken, second.headToken); checks++;
        const beforeNoOp = bytes(external);
        const noOp = M.publishMigrationRevision(external, b, { expectHead: second.headToken, expectPlan: M.hash(M.planMysqlMigration(b, b)) });
        assert.deepEqual({ committed: noOp.committed, noOp: noOp.noOp }, { committed: false, noOp: true }); checks++;
        assert.deepEqual(bytes(external), beforeNoOp); checks++;
    } finally {
        process.chdir(originalCwd);
        // A broken guard may have written this unique fixture; remove only that owned child.
        assert.equal(path.dirname(repositoryWorkspace), repositoryOutput);
        assert.equal(path.basename(repositoryWorkspace), path.basename(root));
        fs.rmSync(repositoryWorkspace, { recursive: true, force: true });
    }
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
    for(let nth=2;nth<=5;nth++){
        let writes=0;const io=new Proxy(fs,{get(target,key){if(key==='writeFileSync')return(...args)=>{if(++writes===nth)throw Error('staged artifact write fault');return target[key](...args);};return target[key];}});
        const before=bytes(path.join(work,'revisions'));assert.throws(()=>M.publishMigrationRevision(work,b,{fileSystem:io,expectHead:baseline.headToken,expectPlan:M.hash(M.planMysqlMigration(a,b))}));assert.deepEqual(bytes(path.join(work,'revisions')),before);assert.equal(M.readMigrationWorkspace(work).head.sequence,'000000');checks+=3;
    }
    let competed=false;const competing=new Proxy(fs,{get(target,key){if(key==='renameSync')return(...args)=>{assert.throws(()=>M.publishMigrationRevision(work,b,{expectHead:baseline.headToken,expectPlan:M.hash(M.planMysqlMigration(a,b))}),{code:'MIGRATION_WORKSPACE_BUSY'});competed=true;throw Error('stop owner before commit');};return target[key];}});
    assert.throws(()=>M.publishMigrationRevision(work,b,{fileSystem:competing,expectHead:baseline.headToken,expectPlan:M.hash(M.planMysqlMigration(a,b))}));assert(competed);checks+=3;
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
