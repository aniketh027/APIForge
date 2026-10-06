'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const c=require('./pinned-compiler-loader').currentCompiler(),{admit}=require('./postgres-native-helpers');
const {snapshotDirectory}=require('./generated-backend-test-helpers');
let handler;const router={get(){},post(route,callback){handler=callback;}};
const moduleValue={exports:{}};
vm.compileFunction(fs.readFileSync(path.resolve(__dirname,'../src/api/compiler-api.js'),'utf8'),['require','module','exports'])(name=>name==='express'?{Router:()=>router}:require(path.resolve(__dirname,'../src/api',name)),moduleValue,moduleValue.exports);
function api(body){const res={statusCode:200,status(value){this.statusCode=value;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
for(const target of [null,'',false,42,{},'POSTGRES','postgresql','pg',' postgres']) {
    const result=api({source:'ENTITY Item value INT',target});assert.equal(result.statusCode,400);assert.equal(result.body.diagnostic.code,'INP003');assert(Object.values(result.body.phaseStates).every(v=>v==='skipped'));
}
assert.equal(api({source:null,target:'invalid'}).body.diagnostic.code,'INP001');
const source='ENTITY Item value STRING';
const pg=api({source,target:'postgres'}),my=api({source});assert(pg.body.success);assert.deepEqual(pg.body.ir,my.body.ir);assert.deepEqual(pg.body.optimizedIR,my.body.optimizedIR);
assert.equal(pg.body.generatedFiles.find(f=>f.path==='swagger.json').content,my.body.generatedFiles.find(f=>f.path==='swagger.json').content);
assert.equal(api({source:'ENTITY Bounded keyValue INT PRIMARY KEY MIN 2 MAX 4',target:'postgres'}).statusCode,200);
assert.equal(api({source:'ENTITY Bad xmin INT',target:'postgres'}).statusCode,422);
const bounded=JSON.parse(api({source:'ENTITY Bounded keyValue INT PRIMARY KEY MIN 2 MAX 4',target:'postgres'}).body.generatedFiles.find(f=>f.path==='swagger.json').content);
assert.equal(bounded.components.schemas['Bounded.Create'].properties.keyValue.minimum,2);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g27-selection-')),cwd=process.cwd();
try {
    const sourceFile=path.join(root,'source.apiforge');fs.writeFileSync(sourceFile,source);
    for(const args of [[sourceFile,'--target','postgres'],['--target','postgres',sourceFile]]) {
        const result=spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),...args],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/postgresql-18-v1/);
        for(const f of pg.body.generatedFiles)assert.equal(fs.readFileSync(path.join(root,'output',f.path),'utf8'),f.content);
    }
    const before=snapshotDirectory(root);
    for(const args of [[sourceFile,'--target'],[sourceFile,'--target','postgres','--target','mysql'],['--target','PG',sourceFile]]) {
        const result=spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),...args],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/INP003/);assert.deepEqual(snapshotDirectory(root),before);
    }
    const migration=spawnSync(process.execPath,[path.resolve(__dirname,'../migrate.js'),'snapshot','--to','absent','--out','forbidden.json','--target','postgres'],{cwd:root,encoding:'utf8'});
    assert.equal(migration.status,1);assert.match(migration.stderr,/MIGRATION_PROFILE_UNSUPPORTED/);assert.deepEqual(snapshotDirectory(root),before);
    process.chdir(root);
    const ir=admit(source).ir;
    c.Codegen.generate(ir,true,{target:'mysql'});fs.writeFileSync(path.join(root,'output','.env'),'user-owned sentinel');fs.mkdirSync(path.join(root,'output','user-data'));fs.writeFileSync(path.join(root,'output','user-data','opaque'),'opaque');
    const opaque=snapshotDirectory(path.join(root,'output','user-data'));
    for(const target of ['postgres','mysql']) {
        const files=c.Codegen.generate(ir,true,{target}).files;
        for(const f of files)assert.equal(fs.readFileSync(path.join(root,'output',f.path),'utf8'),f.content);
        assert.equal(fs.readFileSync(path.join(root,'output','.env'),'utf8'),'user-owned sentinel');assert.deepEqual(snapshotDirectory(path.join(root,'output','user-data')),opaque);
    }
    const stable=snapshotDirectory(path.join(root,'output'));const bad=structuredClone(ir);bad.instructions[1].field='x'.repeat(64);
    assert.throws(()=>c.Codegen.generate(bad,true,{target:'postgres'}),e=>e.diagnostic.code==='GEN001');assert.deepEqual(snapshotDirectory(path.join(root,'output')),stable);
}finally{process.chdir(cwd);fs.rmSync(root,{recursive:true,force:true});}
console.log('Target selection, CLI/API, bounded OpenAPI, G26 refusal and G19 bidirectional publication PASS');
