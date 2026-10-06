'use strict';
// G27's independent approved-main oracle. Older G22/G26 baselines stay frozen.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { createPinnedCompiler, currentCompiler, compileSource } = require('./pinned-compiler-loader');
const { sourceCases, directIRCases, rawSQLCases, structuralIRCases } = require('./effective-schema-corpus');
const BASE = '24a6289aabad9f24dcdee34d1854373c6727103a';
const pinned = createPinnedCompiler({ revision: BASE });
const current = currentCompiler();
const explicit = { ...current,
    Semantic: { analyze: ast => current.Semantic.analyze(ast, { target: 'mysql' }) },
    Codegen: { generate: (ir, disk) => current.Codegen.generate(ir, disk, { target: 'mysql' }) }
};
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0, valid = 0, invalid = 0, files = 0, g26Snapshots = 0, g26Failures = 0;
function same(a, b, label) { checks++; assert.deepEqual(plain(a), plain(b), label); }
function failure(run) { try { return { result: run() }; } catch (e) { return { name:e.name, message:e.message, ...e }; } }
for (const entry of sourceCases(pinned).cases) {
    const old = pinned.compile(entry.source);
    same(compileSource(entry.source, current), old, entry.name + ' omitted');
    same(compileSource(entry.source, explicit), old, entry.name + ' mysql');
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
    const requireModule = name => name === 'express' ? { Router: () => router } : historical
        ? pinned.load(path.posix.normalize(path.posix.join('src/api',name)) + (name.endsWith('.js') ? '' : '.js'))
        : require(path.resolve(__dirname,'../src/api',name));
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
    }
    assert.deepEqual(await zip(compileSource(source,current).files,false),await zip(pinned.compile(source).files,true)); checks++;
    for (const file of ['frontend/app.js','frontend/index.html','frontend/style.css']) {
        assert.deepEqual(execFileSync('git',['show','HEAD:'+file]),
            execFileSync('git',['show',BASE+':'+file])); checks++;
    }
    for (const entry of sourceCases(pinned).cases) {
        const old=failure(() => pinned.load('src/migrations/compile-source.js').compileSourceForSnapshot(entry.source));
        same(failure(() => require('../src/migrations/compile-source').compileSourceForSnapshot(entry.source)),old,'G26 snapshot '+entry.name);
        if(Object.hasOwn(old,'result'))g26Snapshots++;else g26Failures++;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g27-oracle-'));
    try {
        const historical = path.join(root,'pinned'); fs.mkdirSync(historical);
        for (const file of pinned.paths.filter(f => f.startsWith('src/') || ['package.json','index.js'].includes(f))) {
            const output = path.join(historical,file); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,pinned.readFile(file));
        }
        const cwd = path.join(root,'work'); fs.mkdirSync(cwd);
        const sourceFile = path.join(cwd,'source.apiforge');
        for (const value of [source, 'ENTITY Bad\nx UNKNOWN', 'ENTITY Broken\nx']) {
            fs.writeFileSync(sourceFile,value);
            const args = [sourceFile];
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
