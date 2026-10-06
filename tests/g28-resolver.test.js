'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { resolveFile } = require('../src/modules/resolver');
const { FilesystemResolver, validateSpecifier } = require('../src/modules/filesystem-resolver');
const Lexer = require('../src/lexer/lexer'), Parser = require('../src/parser/parser');
const { owner } = require('../src/modules/provenance');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-resolver-'));
let checks = 0; const skips = [];
function write(name, source) { const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,source); return file; }
function same(a,b) { assert.deepEqual(a,b); checks++; }
function fails(run, code, source) {
    assert.throws(run,e=>{assert.equal(e.diagnostic.code,code);if(source)assert.equal(e.diagnostic.source,source);
        assert(!e.message.includes(root));assert(!JSON.stringify(e.diagnostic).includes(root));return true;});checks++;
}
try {
    const shared=write('shared.apiforge','\uFEFF// BOM\nENTITY Shared v STRING');
    write('a.apiforge','IMPORT "./shared.apiforge"\nENTITY A k INT PRIMARY KEY');
    write('sub/b.apiforge','IMPORT "../shared.apiforge" IMPORT "../empty.apiforge"\nENTITY B k INT PRIMARY KEY');
    write('empty.apiforge','// empty');
    write('relations.apiforge','RELATION A LINKS B MANY_TO_MANY');
    write('bridge.apiforge','IMPORT "./sub/b.apiforge"');
    const entry=write('main.apiforge','IMPORT "./a.apiforge" IMPORT "./bridge.apiforge" IMPORT "././a.apiforge" IMPORT "relations.apiforge"');
    const counts={read:0,lex:0,parse:0};
    const originalRead=FilesystemResolver.prototype.read,originalLex=Lexer.tokenize,originalParse=Parser.parseModule;
    FilesystemResolver.prototype.read=function(...args){counts.read++;return originalRead.apply(this,args);};
    Lexer.tokenize=function(...args){counts.lex++;return originalLex(...args);};
    Parser.parseModule=function(...args){counts.parse++;return originalParse(...args);};
    let unit;
    try { unit=resolveFile(entry); } finally { FilesystemResolver.prototype.read=originalRead;Lexer.tokenize=originalLex;Parser.parseModule=originalParse; }
    same(unit.modules.map(m=>m.displayPath),['shared.apiforge','a.apiforge','empty.apiforge','sub/b.apiforge','bridge.apiforge','relations.apiforge','main.apiforge']);
    same(counts,{read:7,lex:7,parse:7});
    same(unit.ast.entities.map(e=>e.name),['Shared','A','B']);same(unit.ast.relations.map(r=>r.name),['LINKS']);
    same(Object.keys(unit.ast),['type','entities','relations']);same(owner(unit.ast.entities[0]).displayPath,'shared.apiforge');
    same(unit.modules[0].inbound.length,2);
    same(resolveFile(entry,{maxModules:7,maxSourceBytes:unit.modules.reduce((n,m)=>n+Buffer.byteLength(m.source),0)+3}).modules.length,7);
    fails(()=>resolveFile(entry,{maxModules:6}),'INP011');fails(()=>resolveFile(entry,{maxSourceBytes:1}),'INP011');
    for(const options of [{maxModules:0},{maxModules:Infinity},{maxSourceBytes:1.5}]){assert.throws(()=>resolveFile(entry,options),TypeError);checks++;}
    for(const source of ['IMPORT "missing.apiforge" ENTITY Broken v','IMPORT "missing.apiforge" @']) {
        write('bad.apiforge',source); let reads=0;
        FilesystemResolver.prototype.read=function(...args){reads++;return originalRead.apply(this,args);};
        try {fails(()=>resolveFile(path.join(root,'bad.apiforge')),source.includes('@')?'LEX001':'PAR012','bad.apiforge');same(reads,1);}
        finally {FilesystemResolver.prototype.read=originalRead;}
    }
    write('bad.apiforge','IMPORT "missing.apiforge"');fails(()=>resolveFile(path.join(root,'bad.apiforge')),'INP005','bad.apiforge');
    for(const [name,contents,chain] of [
        ['self.apiforge','IMPORT "self.apiforge"','self.apiforge -> self.apiforge'],
        ['c1.apiforge','IMPORT "c2.apiforge"','c1.apiforge -> c2.apiforge -> c1.apiforge']]) {
        write(name,contents);write('c2.apiforge','IMPORT "c1.apiforge"');
        fails(()=>resolveFile(path.join(root,name)),'INP009');
        assert.throws(()=>resolveFile(path.join(root,name)),e=>e.message==='Import cycle: '+chain+'.');checks++;
    }
    write('c2.apiforge','IMPORT "c3.apiforge"');write('c3.apiforge','IMPORT "c1.apiforge"');fails(()=>resolveFile(path.join(root,'c1.apiforge')),'INP009','c3.apiforge');
    const invalid=['','\0x.apiforge','a\tx.apiforge','a\u007fx.apiforge','/x.apiforge','C:/x.apiforge','C:x.apiforge','//host/x.apiforge','\\\\?\\C:\\x.apiforge','file:x.apiforge','https://x.apiforge','a\\x.apiforge','a:x.apiforge','a*.apiforge','a?.apiforge','a//b.apiforge','a.apiforge/','x.txt','x.APIFORGE','\ud800.apiforge','\udc00.apiforge'];
    for(const specifier of invalid)fails(()=>validateSpecifier(specifier,{}),'INP004');
    for(const specifier of ['./x.apiforge','../x.apiforge','é😀.apiforge',' a.apiforge','%.apiforge','$.apiforge','~.apiforge','a/>|<.apiforge']){validateSpecifier(specifier,{});checks++;}
    for(const name of ['é😀.apiforge',' a.apiforge','%.apiforge','$.apiforge','~.apiforge']) {
        write(name,'');write('names.apiforge','IMPORT "'+name+'" ENTITY Names k INT PRIMARY KEY');same(resolveFile(path.join(root,'names.apiforge')).modules.length,2);
    }
    fs.mkdirSync(path.join(root,'directory.apiforge'));write('bad.apiforge','IMPORT "directory.apiforge"');fails(()=>resolveFile(path.join(root,'bad.apiforge')),'INP007');
    fails(()=>resolveFile(entry,{root:path.join(root,'absent')}),'INP013');fails(()=>resolveFile(entry,{root:shared}),'INP013');
    write('sub/local.apiforge','IMPORT "../shared.apiforge"');fails(()=>resolveFile(path.join(root,'sub/local.apiforge')),'INP006');
    same(resolveFile(path.join(root,'sub/local.apiforge'),{root}).modules.length,2);
    const sibling=fs.mkdtempSync(root+'-sibling-');
    try {
        fs.writeFileSync(path.join(sibling,'out.apiforge'),'ENTITY Outside v STRING');
        write('bad.apiforge','IMPORT "../'+path.basename(sibling)+'/out.apiforge"');fails(()=>resolveFile(path.join(root,'bad.apiforge')),'INP006');
        fails(()=>resolveFile(path.join(sibling,'out.apiforge'),{root}),'INP006');
        function link(name,target,type='file') {
            try {fs.symlinkSync(target,path.join(root,name),type);return true;}
            catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){skips.push(name+': '+e.code);return false;}throw e;}
        }
        if(link('internal.apiforge',shared)){
            write('links.apiforge','IMPORT "internal.apiforge" IMPORT "shared.apiforge"');same(resolveFile(path.join(root,'links.apiforge')).modules.length,2);
            fs.symlinkSync('loop.apiforge',path.join(root,'loop.apiforge'));
            write('links.apiforge','IMPORT "loop.apiforge"');fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP008');
        }
        if(link('escape.apiforge',path.join(sibling,'out.apiforge'))){write('links.apiforge','IMPORT "escape.apiforge"');fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP006');}
        if(link('junction',sibling,process.platform==='win32'?'junction':'dir')){
            write('links.apiforge','IMPORT "junction/out.apiforge"');fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP006');
            fs.linkSync(shared,path.join(sibling,'cached.apiforge'));
            write('links.apiforge','IMPORT "shared.apiforge" IMPORT "junction/cached.apiforge"');
            fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP006');
        }
        if(link('internal-dir',path.join(root,'sub'),process.platform==='win32'?'junction':'dir')){
            write('links.apiforge','IMPORT "internal-dir/b.apiforge"');same(resolveFile(path.join(root,'links.apiforge')).modules.length,4);
        }
    } finally {fs.rmSync(sibling,{recursive:true,force:true});}
    try {
        fs.linkSync(shared,path.join(root,'hard.apiforge'));
        write('links.apiforge','IMPORT "hard.apiforge" IMPORT "shared.apiforge"');same(resolveFile(path.join(root,'links.apiforge')).modules.length,2);
        fs.linkSync(shared,path.join(root,'sub/hard.apiforge'));
        write('links.apiforge','IMPORT "shared.apiforge" IMPORT "sub/hard.apiforge"');fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP014','links.apiforge');
        write('links.apiforge','IMPORT "sub/hard.apiforge" IMPORT "shared.apiforge"');fails(()=>resolveFile(path.join(root,'links.apiforge')),'INP014','links.apiforge');
    }catch(e){if(['EPERM','ENOSYS','ENOTSUP'].includes(e.code))skips.push('hard links: '+e.code);else throw e;}
    if(fs.existsSync(path.join(root,'SHARED.APIFORGE'))){write('case.apiforge','IMPORT "SHARED.apiforge" IMPORT "shared.apiforge"');same(resolveFile(path.join(root,'case.apiforge')).modules.length,2);}
    else skips.push('case alias: filesystem is case-sensitive');
    const unavailable={...fs,statSync(...args){const stat=fs.statSync(...args);Object.defineProperty(stat,'ino',{value:0n});return stat;}};
    fails(()=>new FilesystemResolver(entry,{},unavailable),'INP014');
    const changing={...fs,fstatSync(...args){const stat=fs.fstatSync(...args);Object.defineProperty(stat,'mtimeNs',{value:stat.mtimeNs+1n});return stat;}};
    const adapter=new FilesystemResolver(entry,{},changing);fails(()=>adapter.read(adapter.entry),'INP012');
    let closed=0,fstats=0;
    const duringRead={...fs,fstatSync(...args){const stat=fs.fstatSync(...args);if(++fstats===2)Object.defineProperty(stat,'ctimeNs',{value:stat.ctimeNs+1n});return stat;},closeSync(fd){closed++;return fs.closeSync(fd);}};
    const unstable=new FilesystemResolver(entry,{},duringRead);fails(()=>unstable.read(unstable.entry),'INP012');same(closed,1);
    const failedRead={...fs,readFileSync(){const e=new Error('PRIVATE '+root);e.code='EIO';throw e;},closeSync(fd){closed++;return fs.closeSync(fd);}};
    const failedAdapter=new FilesystemResolver(entry,{},failedRead);fails(()=>failedAdapter.read(failedAdapter.entry),'INP008');same(closed,2);
    for(const [errno,code]of [['EINVAL','INP004'],['ENAMETOOLONG','INP004'],['ENOENT','INP005'],['ENOTDIR','INP007'],['ELOOP','INP008']]){
        fails(()=>require('../src/modules/errors').filesystemError(Object.assign(new Error('PRIVATE '+root),{code:errno})),code);
    }
    const denied={...fs,openSync(){const e=new Error('PRIVATE '+root);e.code='EACCES';throw e;}};
    const deniedAdapter=new FilesystemResolver(entry,{},denied);fails(()=>deniedAdapter.read(deniedAdapter.entry),'INP008');
    if(process.platform!=='win32'){
        const unreadable=write('unreadable.apiforge','');fs.chmodSync(unreadable,0);
        try{
            let genuinelyDenied=false;
            try{const fd=fs.openSync(unreadable,'r');fs.closeSync(fd);}catch(e){genuinelyDenied=e.code==='EACCES';}
            if(genuinelyDenied){write('unreadable-entry.apiforge','IMPORT "unreadable.apiforge"');fails(()=>resolveFile(path.join(root,'unreadable-entry.apiforge')),'INP008','unreadable-entry.apiforge');}
            else skips.push('genuine unreadable file: process can bypass permissions');
        }finally{fs.chmodSync(unreadable,0o600);}
        const fifo=path.join(root,'pipe.apiforge');require('child_process').execFileSync('mkfifo',[fifo]);
        write('fifo-entry.apiforge','IMPORT "pipe.apiforge"');fails(()=>resolveFile(path.join(root,'fifo-entry.apiforge')),'INP007');
    }else skips.push('genuine unreadable/FIFO: POSIX mode/FIFO unavailable on Windows; EACCES adapter mapping tested');
    write('deep/main.apiforge','IMPORT "n0.apiforge"');
    for(let i=0;i<1100;i++)write('deep/n'+i+'.apiforge',i===1099?'':`IMPORT "n${i+1}.apiforge"`);
    same(resolveFile(path.join(root,'deep/main.apiforge')).modules.length,1101);
    console.log(JSON.stringify({gate:'B/resolver',checks,uniqueModules:7,counts,deepModules:1101,skips,result:'PASS'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
