'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const M = require('../src/migrations');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g26-cli-')), work = path.join(root, 'history');
const cli = (...args) => spawnSync(process.execPath, [path.resolve(__dirname, '../migrate.js'), ...args], { encoding: 'utf8' });
let checks = 0;
try {
    const source = path.join(root, 'source.apiforge'), snapshot = path.join(root, 'snapshot.json');
    fs.writeFileSync(source, 'ENTITY Item\nv STRING');
    assert.equal(cli('snapshot', '--to', source, '--out', snapshot).status, 0); checks++;
    assert.equal(cli('baseline', '--snapshot', snapshot, '--workspace', work).status, 0); checks++;
    fs.writeFileSync(source, 'ENTITY Item\nv STRING\nx INT');
    const inspection = JSON.parse(cli('diff', '--workspace', work, '--to', source).stdout);
    assert.equal(cli('create', '--workspace', work, '--to', source, '--expect-head', inspection.headToken, '--expect-plan', inspection.planSha256).status, 0); checks++;
    assert.equal(JSON.parse(cli('verify', '--workspace', work).stdout).revisions, 2); checks++;
    assert.equal(cli('create', '--workspace', work, '--to', source).status, 1); checks++;
    fs.writeFileSync(source, 'ENTITY Item\nv INT\nx INT');
    const blocked = cli('diff', '--workspace', work, '--to', source);
    assert.equal(blocked.status, 0); assert(JSON.parse(blocked.stdout).plan.blockers.length); checks += 2;
    const inspection2 = JSON.parse(blocked.stdout);
    assert.equal(cli('create', '--workspace', work, '--to', source, '--expect-head', inspection2.headToken, '--expect-plan', inspection2.planSha256).status, 1); checks++;
    assert.equal(M.readMigrationWorkspace(work).revisions.length, 2); checks++;
    for (const command of ['apply', 'down', 'drift']) { assert.equal(cli(command).status, 1); checks++; }
    const empty = path.join(root, 'empty');
    assert.equal(cli('baseline', '--empty', '--profile', 'mysql-8.4-v1', '--workspace', empty).status, 0); checks++;
    fs.writeFileSync(source, 'ENTITY Item\nv DATETIME');
    assert.equal(cli('snapshot', '--to', source).status, 1); checks++;
    console.log(`G26 CLI: ${checks} checks PASS.`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
