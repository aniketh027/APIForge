'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const {spawnSync}=require('child_process');const {compileFile}=require('../src/compiler');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-boundaries-'));let checks=0;
const index=path.resolve(__dirname,'../index.js');
function run(file,flags=[]){return spawnSync(process.execPath,[index,file,...flags],{cwd:root,encoding:'utf8'});}
function tree(directory){return require('./generated-backend-test-helpers').snapshotDirectory(directory);}
function api(source,target){
    let handler;const router={get(){},post(route,callback){handler=callback;}};
    const filename=path.resolve(__dirname,'../src/api/compiler-api.js');
    const dependencies=new Map();
    const req=name=>{if(!dependencies.has(name))dependencies.set(name,name==='express'?{Router:()=>router}:require(path.resolve(path.dirname(filename),name)));return dependencies.get(name);};
    vm.compileFunction(fs.readFileSync(filename,'utf8'),['require','module','exports'])(req,{exports:{}},{});
    req('../targets');req('../modules/errors'); // Preload Node modules before guarding source filesystem operations.
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
    const methods=['readFileSync','openSync','statSync','lstatSync','realpathSync','readdirSync','existsSync'];
    const originals=methods.map(name=>fs[name]);
    methods.forEach(name=>{fs[name]=()=>{throw new Error('HTTP handler accessed fs.'+name);};});
    try{handler({body:{source,target}},res);}finally{methods.forEach((name,i)=>{fs[name]=originals[i];});}
    return res;
}
try{
    fs.mkdirSync(path.join(root,'models'));fs.writeFileSync(path.join(root,'models/user.apiforge'),'ENTITY User k UUID PRIMARY KEY v STRING');
    const entry=path.join(root,'main.apiforge');fs.writeFileSync(entry,'IMPORT "models/user.apiforge"');
    for(const target of ['mysql','postgres']){
        const result=run(entry,['--target',target]);assert.equal(result.status,0,result.stdout+result.stderr);assert(result.stdout.includes('[INFO] Resolved 2 modules'));checks+=2;
        for(const file of compileFile(entry,{target}).generatedFiles){assert.equal(fs.readFileSync(path.join(root,'output',file.path),'utf8'),file.content);checks++;}
    }
    fs.writeFileSync(path.join(root,'output/.env'),'USER_OWNED=yes');
    fs.mkdirSync(path.join(root,'output/node_modules'));fs.writeFileSync(path.join(root,'output/node_modules/owned'),'opaque');
    const before=tree(path.join(root,'output'));
    for(const source of ['IMPORT "missing.apiforge"','IMPORT "models/user.apiforge" ENTITY Bad v',
        'IMPORT "models/user.apiforge" ENTITY User v STRING','IMPORT "main.apiforge"']){
        fs.writeFileSync(entry,source);const failure=run(entry);assert.equal(failure.status,1);assert.deepEqual(tree(path.join(root,'output')),before);checks+=2;
    }
    fs.writeFileSync(entry,'IMPORT "models/user.apiforge"');fs.writeFileSync(path.join(root,'models/user.apiforge'),'// imported\n\nENTITY Imported\n  value');
    const failure=run(entry);assert.equal(failure.status,1);assert(failure.stdout.includes('--> models/user.apiforge:4, column 8'));assert(failure.stdout.includes('4 |   value'));checks+=3;
    fs.writeFileSync(path.join(root,'models/user.apiforge'),'ENTITY User v STRING');
    const success=run(entry);assert.equal(success.status,0);assert.equal(fs.readFileSync(path.join(root,'output/.env'),'utf8'),'USER_OWNED=yes');assert.equal(fs.readFileSync(path.join(root,'output/node_modules/owned'),'utf8'),'opaque');checks+=3;
    const inner=path.join(root,'models/entry.apiforge');fs.writeFileSync(inner,'IMPORT "../main.apiforge"');fs.writeFileSync(entry,'ENTITY Entry v STRING');
    assert.equal(run(inner).status,1);assert.equal(run(inner,['--root',root]).status,0);checks+=2;
    const invalidRoot=run(path.join(root,'absent.apiforge'),['--root',path.join(root,'absent-root')]);
    assert.equal(invalidRoot.status,1);assert(invalidRoot.stderr.includes('INP013'));assert(!invalidRoot.stderr.includes('File not found'));checks+=3;
    fs.writeFileSync(entry,'IMPORT "missing.apiforge" ENTITY Broken v');
    const entryParser=run(entry);assert.equal(entryParser.status,1);assert(entryParser.stdout.includes('--> main.apiforge:1'));assert(entryParser.stdout.includes('PAR012'));checks+=3;
    for(const target of [undefined,'mysql','postgres']){
        const response=api('IMPORT "" ENTITY Item v STRING',target);assert.equal(response.statusCode,400);
        const d=response.body.diagnostic;assert.equal(d.code,'INP010');assert.equal(d.symbol,'IMPORT_CONTEXT_UNSUPPORTED');assert.equal(d.line,1);assert.equal(d.column,8);assert.equal(d.endColumn,10);
        assert.equal(d.source,undefined);assert.equal(d.related,undefined);
        assert.deepEqual(response.body.phases,{lexer:true,parser:true,semantic:false,ir:false,optimizer:false,codegen:false});
        assert.deepEqual(response.body.phaseStates,{lexer:'succeeded',parser:'succeeded',semantic:'skipped',ir:'skipped',optimizer:'skipped',codegen:'skipped'});
        assert.deepEqual(response.body.warnings,[]);assert(response.body.tokens);assert(response.body.ast);assert.equal(response.body.generatedFiles,undefined);checks+=14;
    }
    assert.equal(api('ENTITY IMPORT id INT PRIMARY KEY').statusCode,200);assert.equal(api('ENTITY Item IMPORT STRING').statusCode,200);checks+=2;
    assert.equal(api('ENTITY Item id INT IMPORT "x.apiforge"').body.diagnostic.code,'PAR023');checks++;
    assert.equal(api('IMPORT "missing.apiforge" ENTITY Bad v').body.diagnostic.code,'PAR012');checks++;
    assert.equal(api('IMPORT "x.apiforge"','BAD').body.diagnostic.code,'INP003');checks++;
    console.log(JSON.stringify({gate:'CLI/G19/HTTP',checks,result:'PASS'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
