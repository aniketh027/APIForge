'use strict';
// G28 independent approved-main oracle; historical fixtures and baselines remain frozen.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { createPinnedCompiler, currentCompiler, compileSource } = require('./pinned-compiler-loader');
const { sourceCases, directIRCases, rawSQLCases, structuralIRCases } = require('./effective-schema-corpus');
const BASE = '112a464ee4615c3956c686bfff59c9aa5d9f8497';
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
const explicit = { ...current,
    Semantic: { analyze: ast => current.Semantic.analyze(ast, { target: 'mysql' }) },
    Codegen: { generate: (ir, disk) => current.Codegen.generate(ir, disk, { target: 'mysql' }) }
};
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0, valid = 0, invalid = 0, files = 0, g26Snapshots = 0, g26Failures = 0;
function same(a, b, label) { checks++; assert.deepEqual(plain(a), plain(b), label); }
function targeted(c,target) { return {...c,Semantic:{analyze:ast=>c.Semantic.analyze(ast,{target})},Codegen:{generate:(ir,disk)=>c.Codegen.generate(ir,disk,{target})}}; }
function failure(run) { try { return { result: run() }; } catch (e) { return { name:e.name, message:e.message, ...e }; } }
for (const entry of sourceCases(pinned).cases) {
    const old = pinned.compile(entry.source);
    same(compileSource(entry.source, current), old, entry.name + ' omitted');
    same(compileSource(entry.source, explicit), old, entry.name + ' mysql');
    same(compileSource(entry.source,targeted(current,'postgres')),compileSource(entry.source,targeted(pinned.compiler,'postgres')),entry.name+' postgres');
    if (old.valid) { valid++; files += old.files.length; } else invalid++;
}
for (const entry of [...directIRCases(pinned), ...rawSQLCases(), ...structuralIRCases()]) {
    const before = JSON.stringify(entry.ir);
    for (const options of [undefined, { target: 'mysql' }]) {
        same(failure(() => current.Codegen.generate(entry.ir, false, options)),
            failure(() => pinned.compiler.Codegen.generate(entry.ir, false)), entry.name + ' admitted');
        same(failure(() => current.Codegen.prepareAdmittedGeneration(entry.ir, options).candidate.plan),
            failure(() => pinned.compiler.Codegen.prepareAdmittedGeneration(entry.ir).candidate.plan), entry.name + ' plan');
    }
    same(failure(() => current.Codegen.generateSQL(entry.ir)),
        failure(() => pinned.compiler.Codegen.generateSQL(entry.ir)), entry.name + ' raw SQL');
    same(JSON.stringify(entry.ir), before, entry.name + ' nonmutation');
}
function api(body, historical) {
    let handler;
    const router = { get() {}, post(route, callback) { handler = callback; } };
    const filename = 'src/api/compiler-api.js';
    const contents = historical ? pinned.readFile(filename) : fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
    const requireModule = name => {
        if (name === 'express') return { Router: () => router };
        if (!historical) return require(path.resolve(__dirname,'../src/api',name));
        const base = path.posix.normalize(path.posix.join('src/api',name));
        return pinned.load([base,base+'.js',base+'.json',base+'/index.js'].find(p=>pinned.paths.includes(p)));
    };
    const module = {exports:{}};
    vm.compileFunction(contents,['require','module','exports'])(requireModule,module,module.exports);
    const response = { statusCode:200, status(value) { this.statusCode=value; return this; }, json(value) { this.body=value; return this; } };
    handler({body},response);
    return {status:response.statusCode,body:response.body};
}
async function zip(files, historical) {
    const app = historical ? pinned.readFile('frontend/app.js') : fs.readFileSync(path.join(__dirname,'../frontend/app.js'),'utf8');
    const context = vm.createContext({Blob,TextEncoder,Uint8Array,DataView});
    vm.runInContext(app.slice(app.indexOf('function createZip('),app.indexOf('function downloadProject(')),context);
    return Buffer.from(await context.createZip(files).arrayBuffer());
}
(async () => {
    const source = 'ENTITY Item\nvalue STRING';
    for (const value of [source, 'ENTITY Bad\nx UNKNOWN', 'ENTITY Broken\nx', '', null, 42]) {
        same(api({source:value},false),api({source:value},true),'HTTP omitted');
        same(api({source:value,target:'mysql'},false),api({source:value},true),'HTTP mysql');
        same(api({source:value,target:'postgres'},false),api({source:value,target:'postgres'},true),'HTTP postgres');
    }
    assert.deepEqual(await zip(compileSource(source,current).files,false),await zip(pinned.compile(source).files,true)); checks++;
    for (const [file, expectedBlob] of Object.entries(FRONTEND_BLOBS)) {
        const blob = execFileSync('git', ['rev-parse', FRONTEND_BASE + ':' + file], {encoding:'utf8'}).trim();
        assert.equal(blob, expectedBlob, 'historical M1 blob identity ' + file); checks++;
        assert.equal(execFileSync('git', ['cat-file', '-t', blob], {encoding:'utf8'}).trim(), 'blob'); checks++;
        const content = execFileSync('git', ['cat-file', 'blob', blob]);
        assert.equal(execFileSync('git', ['hash-object', '--stdin'], {input:content,encoding:'utf8'}).trim(), expectedBlob,
            'historical M1 content hash ' + file); checks++;
    }
    for (const entry of sourceCases(pinned).cases) {
        const old=failure(() => pinned.load('src/migrations/compile-source.js').compileSourceForSnapshot(entry.source));
        same(failure(() => require('../src/migrations/compile-source').compileSourceForSnapshot(entry.source)),old,'G26 snapshot '+entry.name);
        if(Object.hasOwn(old,'result'))g26Snapshots++;else g26Failures++;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-oracle-'));
    try {
        const historical = path.join(root,'pinned'); fs.mkdirSync(historical);
        for (const file of pinned.paths.filter(f => f.startsWith('src/') || ['package.json','index.js','migrate.js'].includes(f))) {
            const output = path.join(historical,file); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,pinned.readFile(file));
        }
        const cwd = path.join(root,'work'); fs.mkdirSync(cwd);
        const sourceFile = path.join(cwd,'source.apiforge');
        for (const value of [source, 'ENTITY Bad\nx UNKNOWN', 'ENTITY Broken\nx']) {
            fs.writeFileSync(sourceFile,value);
            const migrationArgs=['snapshot','--to',sourceFile];
            const oldMigration=spawnSync(process.execPath,[path.join(historical,'migrate.js'),...migrationArgs],{cwd,encoding:'utf8'});
            const nextMigration=spawnSync(process.execPath,[path.resolve(__dirname,'../migrate.js'),...migrationArgs],{cwd,encoding:'utf8'});
            same({status:nextMigration.status,stdout:nextMigration.stdout,stderr:nextMigration.stderr},{status:oldMigration.status,stdout:oldMigration.stdout,stderr:oldMigration.stderr},'migration CLI exact');
            const args = [sourceFile];
            const pgArgs=[sourceFile,'--target','postgres'];
            const oldPg=spawnSync(process.execPath,[path.join(historical,'index.js'),...pgArgs],{cwd,encoding:'utf8'});
            const nextPg=spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),...pgArgs],{cwd,encoding:'utf8'});
            same({status:nextPg.status,stdout:nextPg.stdout,stderr:nextPg.stderr},{status:oldPg.status,stdout:oldPg.stdout,stderr:oldPg.stderr},'CLI postgres exact');
            if(oldPg.status===0)for(const file of compileSource(value,targeted(pinned.compiler,'postgres')).files){assert.equal(fs.readFileSync(path.join(cwd,'output',file.path),'utf8'),file.content);checks++;}
            const old = spawnSync(process.execPath,[path.join(historical,'index.js'),...args],{cwd,encoding:'utf8'});
            for (const flags of [[], ['--target','mysql'], null]) {
                const nextArgs = flags === null ? ['--target','mysql',...args] : [...args,...flags];
                const next = spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),...nextArgs],{cwd,encoding:'utf8'});
                same({status:next.status,stdout:next.stdout,stderr:next.stderr},
                    {status:old.status,stdout:old.stdout,stderr:old.stderr},'CLI exact');
                if (old.status === 0) for (const file of pinned.compile(value).files) {
                    assert.equal(fs.readFileSync(path.join(cwd,'output',file.path),'utf8'),file.content); checks++;
                }
            }
        }
        for (const args of [[], [path.join(cwd,'absent.apiforge')]]) {
            const old = spawnSync(process.execPath,[path.join(historical,'index.js'),...args],{cwd,encoding:'utf8'});
            const next = spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),...args],{cwd,encoding:'utf8'});
            same({status:next.status,stdout:next.stdout,stderr:next.stderr},{status:old.status,stdout:old.stdout,stderr:old.stderr},'CLI failure');
        }
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
    console.log(JSON.stringify({base:BASE,valid,invalid,files,checks,g26Snapshots,g26Failures,closure:pinned.loadedPaths().length,result:'PASS'}));
})().catch(e => { console.error(e); process.exitCode=1; });
