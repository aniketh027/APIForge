'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const M = require('../src/migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g26-history-'));
let checks = 0;
try {
    const work = path.join(root, 'history'), a = M.compileSourceForSnapshot('ENTITY Item\nv STRING');
    const baseline = M.publishMigrationRevision(work, a, { baseline: true });
    assert(baseline.committed); checks++;
    const oldBytes = fs.readFileSync(path.join(work, 'revisions/000000/manifest.json'));
    const b = M.compileSourceForSnapshot('ENTITY Item\nid INT PRIMARY KEY\nv STRING');
    const p = M.planMysqlMigration(a, b);
    M.publishMigrationRevision(work, b, { expectHead: baseline.headToken, expectPlan: M.hash(p) });
    let history = M.readMigrationWorkspace(work);
    assert.equal(history.head.manifest.kind, 'metadata'); checks++;
    assert.deepEqual(fs.readFileSync(path.join(work, 'revisions/000000/manifest.json')), oldBytes); checks++;
    const noOp = M.publishMigrationRevision(work, b, { expectHead: history.headToken, expectPlan: M.hash(M.planMysqlMigration(b, b)) });
    assert(noOp.noOp && !noOp.committed); checks++;
    const next=M.compileSourceForSnapshot('ENTITY Item\nid INT PRIMARY KEY\nv STRING\nx INT');
    M.publishMigrationRevision(work,next,{expectHead:history.headToken,expectPlan:M.hash(M.planMysqlMigration(b,next))});
    history=M.readMigrationWorkspace(work);
    for(const filename of ['plan.json',Object.keys(history.head.artifacts).find(n=>n.endsWith('.sql'))]){
        const corrupt=path.join(root,'bad-reconstructed-'+checks);fs.cpSync(work,corrupt,{recursive:true});const directory=path.join(corrupt,'revisions/000002'),file=path.join(directory,filename);
        if(filename.endsWith('.sql'))fs.appendFileSync(file,'-- forged\n');else{const plan=M.parseCanonical(fs.readFileSync(file,'utf8'));plan.operations[0].safetyClass='DESTRUCTIVE';fs.writeFileSync(file,M.canonical(plan));}
        const manifestFile=path.join(directory,'manifest.json'),manifest=M.parseCanonical(fs.readFileSync(manifestFile,'utf8')),bytes=fs.readFileSync(file);manifest.files[filename]={sha256:M.hash(bytes),size:bytes.length};fs.writeFileSync(manifestFile,M.canonical(manifest));
        assert.throws(()=>M.readMigrationWorkspace(corrupt));checks++;
    }
    assert.throws(() => M.publishMigrationRevision(work, a, { baseline: true }), { code: 'MIGRATION_HEAD_MISMATCH' }); checks++;
    for (const name of ['000004', '1', '000003.tmp', '000003 ', 'unexpected']) {
        const corrupt = path.join(root, 'bad-' + checks);
        fs.cpSync(work, corrupt, { recursive: true });
        fs.mkdirSync(path.join(corrupt, 'revisions', name));
        assert.throws(() => M.readMigrationWorkspace(corrupt), { code: 'MIGRATION_HISTORY_CORRUPT' }); checks++;
    }
    for (const mutation of [
        dir => fs.writeFileSync(path.join(dir, 'unexpected.txt'), 'x'),
        dir => fs.unlinkSync(path.join(dir, 'snapshot.json')),
        dir => fs.appendFileSync(path.join(dir, 'plan.json'), ' '),
        dir => { const f = path.join(dir, 'manifest.json'), m = M.parseCanonical(fs.readFileSync(f, 'utf8')); m.previous.manifestSha256 = '0'.repeat(64); fs.writeFileSync(f, M.canonical(m)); },
        dir => { const f = path.join(dir, 'manifest.json'), m = M.parseCanonical(fs.readFileSync(f, 'utf8')); m.formatVersion = 2; fs.writeFileSync(f, M.canonical(m)); }
    ]) {
        const corrupt = path.join(root, 'bad-' + checks); fs.cpSync(work, corrupt, { recursive: true });
        mutation(path.join(corrupt, 'revisions/000001'));
        assert.throws(() => M.readMigrationWorkspace(corrupt), e => e instanceof M.MigrationError); checks++;
    }
    for (const name of ['.stage-orphan', 'notes.txt']) {
        const file = path.join(work, name); fs.mkdirSync(file);
        assert.throws(() => M.readMigrationWorkspace(work), { code: 'MIGRATION_HISTORY_CORRUPT' }); checks++;
        fs.rmdirSync(file);
    }
    const junction = path.join(root, 'linked');
    try { fs.symlinkSync(work, junction, 'junction'); assert.throws(() => M.readMigrationWorkspace(junction), { code: 'MIGRATION_HISTORY_CORRUPT' }); checks++; }
    catch (error) { if (error.code !== 'EPERM') throw error; console.log('  junction test SKIP: OS permission'); }
    console.log(`G26 history: ${checks} checks PASS.`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
