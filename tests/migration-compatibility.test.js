'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const os = require('os');
const {spawnSync,execFileSync}=require('child_process');
const { createPinnedCompiler, currentCompiler, compileSource } = require('./pinned-compiler-loader');
const { sourceCases, directIRCases, rawSQLCases } = require('./effective-schema-corpus');
const BASE = '1caf927b5bcef627575a36c1d29800ce03e6f17c';
// Historical M1 frontend bytes and G26/G28 compiler compatibility remain frozen.
// The current frontend evolves through independently reviewed milestones and is
// tested by browser regression suites; equality with M1 is not a future invariant.
const FRONTEND_BASE = '6702d5656917b29d63b0c1183f1d6434c78e2837';
const FRONTEND_BLOBS = Object.freeze({
    'frontend/app.js': '648aae3c0104aac5b376ddbb91baa882f11fb8a4',
    'frontend/index.html': '7c3beee2c3120ae2a044a56cd2d3b39ad1401914',
    'frontend/style.css': '75c70fb8d88c9ba7fba1b5323a2c51d41e596e33'
});
const pinned = createPinnedCompiler({ revision: BASE });
const current = currentCompiler();
let valid = 0, invalid = 0, files = 0, checks = 0;
function same(a, b, label) { checks++; assert.deepEqual(a, b, label); }
const plain = value => JSON.parse(JSON.stringify(value));
for (const entry of sourceCases(pinned).cases) {
    const old = pinned.compile(entry.source), next = compileSource(entry.source, current);
    same(plain(next), plain(old), entry.name);
    if (old.valid) { valid++; files += old.files.length; } else invalid++;
}
for (const entry of directIRCases(pinned)) {
    const before = JSON.stringify(entry.ir);
    same(current.Codegen.generate(entry.ir, false), pinned.compiler.Codegen.generate(entry.ir, false), entry.name);
    same(JSON.stringify(entry.ir), before, 'IR nonmutation');
}
for (const entry of rawSQLCases()) {
    same(current.Codegen.generateSQL(entry.ir), pinned.compiler.Codegen.generateSQL(entry.ir), entry.name);
    const failure = compiler => { try { compiler.Codegen.generate(entry.ir, false); } catch (e) { return {name:e.name,message:e.message,...e}; } };
    same(failure(current), failure(pinned.compiler), entry.name + ' admission');
}
// Execute both exact router sources with the corresponding compiler closure.
function api(source, historical) {
    let handler;
    const router = { get() {}, post(route, callback) { handler = callback; } };
    const filename = 'src/api/compiler-api.js';
    const contents = historical ? pinned.readFile(filename) : fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
    const requireModule = name => name === 'express' ? { Router: () => router } : historical
        ? pinned.load(path.posix.normalize(path.posix.join('src/api',name)) + (name.endsWith('.js') ? '' : '.js'))
        : require(path.resolve(__dirname,'../src/api',name));
    const module = {exports:{}};
    vm.compileFunction(contents,['require','module','exports'])(requireModule,module,module.exports);
    const response = { statusCode:200, status(value) { this.statusCode=value; return this; }, json(value) { this.body=value; return this; } };
    handler({body:{source}},response);
    return plain({status:response.statusCode,body:response.body});
}
for (const source of ['ENTITY Item\nvalue STRING', 'ENTITY Bad\nx UNKNOWN', '', null]) same(api(source,false),api(source,true),'API exact');
async function zip(source, historical) {
    const app = historical ? pinned.readFile('frontend/app.js') : fs.readFileSync(path.join(__dirname,'../frontend/app.js'),'utf8');
    const context = vm.createContext({Blob,TextEncoder,Uint8Array,DataView});
    vm.runInContext(app.slice(app.indexOf('function createZip('),app.indexOf('function downloadProject(')),context);
    return Buffer.from(await context.createZip(source).arrayBuffer());
}
(async () => {
    const source='ENTITY Item\nvalue STRING';
    same(await zip(compileSource(source,current).files,false),await zip(pinned.compile(source).files,true),'ZIP exact bytes');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g26-compatibility-'));
    try{
        for(const state of ['missing','populated','corrupt']){
            const cwd=path.join(root,state);fs.mkdirSync(cwd);const workspace=path.join(cwd,'migrations');
            if(state==='populated')require('../src/migrations').publishMigrationRevision(workspace,require('../src/migrations').compileSourceForSnapshot(source),{baseline:true});
            if(state==='corrupt'){fs.mkdirSync(path.join(workspace,'revisions','000002'),{recursive:true});fs.writeFileSync(path.join(workspace,'revisions','000002','snapshot.json'),'broken');}
            const sourceFile=path.join(cwd,'source.apiforge');fs.writeFileSync(sourceFile,source);
            const cli=spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),sourceFile],{cwd,encoding:'utf8'});same(cli.status,0,'ordinary CLI '+state);
            for(const file of pinned.compile(source).files)same(fs.readFileSync(path.join(cwd,'output',file.path),'utf8'),file.content,'ordinary CLI bytes '+state+' '+file.path);
            same(api(source,false),api(source,true),'API with '+state+' state');
            same(await zip(compileSource(source,current).files,false),await zip(pinned.compile(source).files,true),'ZIP with '+state+' state');
            same(plain(compileSource(source,current)),plain(pinned.compile(source)),'public phases with '+state+' state');
        }
        // Verify immutable historical identities and contents, independently of HEAD.
        for(const [file,expectedBlob] of Object.entries(FRONTEND_BLOBS)) {
            const blob=execFileSync('git',['rev-parse',FRONTEND_BASE+':'+file],{encoding:'utf8'}).trim();
            same(blob,expectedBlob,'historical M1 blob identity '+file);
            same(execFileSync('git',['cat-file','-t',blob],{encoding:'utf8'}).trim(),'blob','historical M1 object type '+file);
            const content=execFileSync('git',['cat-file','blob',blob]);
            same(execFileSync('git',['hash-object','--stdin'],{input:content,encoding:'utf8'}).trim(),expectedBlob,'historical M1 content hash '+file);
        }
    }finally{fs.rmSync(root,{recursive:true,force:true});}
    console.log(JSON.stringify({base:BASE,valid,invalid,files,checks,result:'PASS'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
