'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');const M=require('../src/migrations');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-migrations-'));let checks=0;
function run(...args){return spawnSync(process.execPath,[path.resolve(__dirname,'../migrate.js'),...args],{cwd:root,encoding:'utf8'});}
function json(result){assert.equal(result.status,0,result.stderr);checks++;return JSON.parse(result.stdout);}
try{
    const source='ENTITY Item k INT PRIMARY KEY value STRING';
    const entry=path.join(root,'main.apiforge'),part=path.join(root,'item.apiforge');fs.writeFileSync(entry,'IMPORT "item.apiforge"');fs.writeFileSync(part,source);
    const old=M.compileSourceForSnapshot(source),snapshot=M.compileFileForSnapshot(entry);
    assert.equal(M.canonical(old),M.canonical(snapshot));assert.equal(M.snapshotSha256(old),M.snapshotSha256(snapshot));assert.equal(M.physicalSha256(old),M.physicalSha256(snapshot));checks+=3;
    assert.deepEqual(json(run('snapshot','--to',entry)),snapshot);
    fs.writeFileSync(part,'\n\n'+source);assert.deepEqual(M.compileFileForSnapshot(entry),snapshot);checks++;
    const baseline=path.join(root,'old.json'),workspace=path.join(root,'history');fs.writeFileSync(baseline,M.canonical(snapshot));
    const base=json(run('baseline','--snapshot',baseline,'--workspace',workspace));
    fs.writeFileSync(part,source+' extra STRING');
    const diff=json(run('diff','--workspace',workspace,'--to',entry));
    const created=json(run('create','--workspace',workspace,'--to',entry,'--expect-head',diff.headToken,'--expect-plan',diff.planSha256));
    assert.equal(created.sequence,'000001');checks++;
    const verified=json(run('verify','--workspace',workspace));assert.equal(verified.revisions,2);checks++;
    const before=require('./generated-backend-test-helpers').snapshotDirectory(workspace);
    fs.writeFileSync(part,'ENTITY Item value');const failed=run('create','--workspace',workspace,'--to',entry,'--expect-head',diff.headToken,'--expect-plan',diff.planSha256);
    assert.equal(failed.status,1);const d=JSON.parse(failed.stderr).diagnostics[0];assert.equal(d.code,'PAR012');assert.equal(d.source,'item.apiforge');
    assert(!failed.stderr.includes('-->'));assert.deepEqual(require('./generated-backend-test-helpers').snapshotDirectory(workspace),before);checks+=5;
    assert.throws(()=>M.compileSourceForSnapshot('IMPORT "item.apiforge"'),e=>e.diagnostic.code==='PAR007');checks++;
    assert.throws(()=>M.compileFileForSnapshot('absent.apiforge','postgres'),e=>e.code==='MIGRATION_PROFILE_UNSUPPORTED');checks++;
    console.log(JSON.stringify({gate:'G26/imported',checks,revisions:2,result:'PASS'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
