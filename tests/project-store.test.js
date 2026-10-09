'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork, spawnSync, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const api = require('../src/project-store');
const bootstrap = require('../src/windows-bootstrap');
const results = [], workers = new Set(), stores = new Set();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let fixtures, DatabaseSync, primary, primaryRoot, project;
async function test(name, action) {
    const start=Date.now();
    try {await action();results.push({name,status:'PASS',ms:Date.now()-start});}
    catch(error) {results.push({name,status:'FAIL',ms:Date.now()-start,error:error.stack});process.exitCode=1;}
    console.log(results.at(-1).status+' '+name);
    if(results.at(-1).status==='FAIL')console.error(results.at(-1).error);
}
function notRun(name, reason) {results.push({name,status:'NOT RUN',reason});console.log('NOT RUN '+name+': '+reason);}
function fixture(name) {return path.join(fixtures,name+'-'+crypto.randomUUID());}
async function init(name) {const root=fixture(name),store=await api.initializeProjectStore({root});stores.add(store);return {root,store};}
function close(store) {store.close();stores.delete(store);}
async function rejects(action,code) {
    await assert.rejects(action,error=>{
        assert.equal(error.name,'ProjectStoreError');assert.equal(error.code,code);
        assert.equal(Object.hasOwn(error,'cause'),false);assert.equal(Object.hasOwn(error,'errcode'),false);
        assert.ok(!error.message.includes(fixtures));assert.ok(!/SELECT |INSERT |UPDATE |sqlite3|C:\\/.test(error.message));return true;
    });
}
function uri(file) {const u=pathToFileURL(file);u.searchParams.set('mode','rw');return u.href;}
function raw(root,action) {const db=new DatabaseSync(uri(path.join(root,'projects.sqlite3')),{timeout:350});try{return action(db);}finally{db.close();}}
function inventory(root) {return fs.readdirSync(root).sort().map(name=>{const file=path.join(root,name),s=fs.lstatSync(file,{bigint:true});return {name,ino:String(s.ino),size:String(s.size),hash:s.isFile()?hash(fs.readFileSync(file)):null};});}
async function worker() {
    const child=fork(path.join(__dirname,'project-store-worker.js'),[],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    workers.add(child);child.once('exit',()=>workers.delete(child));
    const ready=await reply(child);assert.equal(ready.ready,true);return child;
}
function reply(child) {
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('worker response timeout'));},30000);
        function cleanup(){clearTimeout(timer);child.removeListener('message',message);child.removeListener('exit',exit);child.removeListener('error',error);}
        function message(value){cleanup();resolve(value);}
        function exit(code){cleanup();reject(new Error('worker exited before response '+code));}
        function error(value){cleanup();reject(value);}
        child.once('message',message);child.once('exit',exit);child.once('error',error);
    });
}
async function request(child,message) {const pending=reply(child);child.send(message);return pending;}
async function terminate(child) {const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
async function ps(source,data) {
    const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const encoded=Buffer.from('$ErrorActionPreference="Stop"; $d=[Console]::In.ReadToEnd()|ConvertFrom-Json; '+source,'utf16le').toString('base64');
    return new Promise((resolve,reject)=>{
        const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')}});
        let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>code===0?resolve(out.trim()):reject(new Error(err||out)));child.stdin.end(JSON.stringify(data));
    });
}
async function altered(name,action,code) {
    const {root,store}=await init(name);await store.createProject({name:'p',target:'mysql',source:'original'});close(store);action(root);
    const before=inventory(root);await rejects(()=>api.openProjectStore({root}),code);assert.deepEqual(inventory(root),before);
}
async function injected(stage) {
    const p=await primary.createProject({name:stage,target:'mysql',source:'original'});
    const oldPrepare=DatabaseSync.prototype.prepare,oldExec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.prepare=function(sql,...args) {
        const stmt=oldPrepare.call(this,sql,...args);
        if(sql.startsWith('INSERT INTO project_revisions')) {
            const run=stmt.run.bind(stmt);
            Object.defineProperty(stmt,'run',{value:(...params)=>{
                if(stage==='before-update')throw new Error('injected private SQL/path');
                const value=run(...params);if(stage==='between-history-and-current')throw new Error('injected');return value;
            }});
        }
        return stmt;
    };
    DatabaseSync.prototype.exec=function(sql) {
        if(sql==='COMMIT'&&stage==='before-commit')throw new Error('injected');
        const value=oldExec.call(this,sql);if(sql==='COMMIT'&&stage==='after-commit')throw new Error('injected');return value;
    };
    try {await rejects(()=>primary.saveProject(p.id,1,{source:'saved'}),stage==='after-commit'?'PROJECT_COMMIT_UNCERTAIN':'PROJECT_STORE_STORAGE_FAILURE');}
    finally {DatabaseSync.prototype.prepare=oldPrepare;DatabaseSync.prototype.exec=oldExec;}
    const got=await primary.getProject(p.id);assert.equal(got.revision,stage==='after-commit'?2:1);
    assert.equal(got.source,stage==='after-commit'?'saved':'original');
    if(stage!=='after-commit')await rejects(()=>primary.getProjectRevision(p.id,2),'PROJECT_NOT_FOUND');
    else assert.equal((await primary.getProjectRevision(p.id,2)).source,'saved');
    assert.equal((await primary.saveProject(p.id,got.revision,{name:'after failure'})).revision,got.revision+1);
}
async function main() {
    fixtures=path.join(os.homedir(),'APIForge-M2A-SQLite-Project-Store-tests-'+crypto.randomUUID());
    await fsp.mkdir(fixtures);console.log('Retained disposable fixtures: '+fixtures);
    await test('isolated import does not load SQLite or compiler',async()=>{
        const source="const M=require('node:module');const old=M._load;M._load=function(id,...a){if(id==='node:sqlite'||/compiler/.test(id))throw Error('unwanted startup dependency');return old.call(this,id,...a)};require('./src/project-store');";
        const child=spawnSync(process.execPath,['-e',source],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);
    });
    await test('unsupported runtime refuses before storage mutation',async()=>{
        const root=fixture('unsupported');const source=`Object.defineProperty(process.versions,'node',{value:'18.20.0'});require('./src/project-store').initializeProjectStore({root:process.argv[1]}).then(()=>process.exit(2),e=>{if(e.code!=='PROJECT_STORE_RUNTIME_UNSUPPORTED')process.exit(3)});`;
        const child=spawnSync(process.execPath,['-e',source,root],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(fs.existsSync(root),false);
    });
    await test('missing SQLite module refuses before storage mutation',async()=>{
        const root=fixture('module-missing');const source="const M=require('node:module');const old=M._load;M._load=function(id,...a){if(id==='node:sqlite')throw Error('unavailable');return old.call(this,id,...a)};require('./src/project-store').initializeProjectStore({root:process.argv[1]}).then(()=>process.exit(2),e=>{if(e.code!=='PROJECT_STORE_RUNTIME_UNSUPPORTED')process.exit(3)});";
        const child=spawnSync(process.execPath,['-e',source,root],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(fs.existsSync(root),false);
    });
    await test('missing required SQLite API refuses before storage mutation',async()=>{
        const root=fixture('api-missing');const source="require('node:sqlite').DatabaseSync.prototype.setAuthorizer=undefined;require('./src/project-store').initializeProjectStore({root:process.argv[1]}).then(()=>process.exit(2),e=>{if(e.code!=='PROJECT_STORE_RUNTIME_UNSUPPORTED'||/C:\\\\/.test(e.stack))process.exit(3)});";
        const child=spawnSync(process.execPath,['-e',source,root],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(fs.existsSync(root),false);
    });
    await test('unsupported platform refuses without generic mkdir fallback',async()=>{
        const root=fixture('platform');const source="Object.defineProperty(process,'platform',{value:'linux'});require('./src/project-store').initializeProjectStore({root:process.argv[1]}).then(()=>process.exit(2),e=>{if(e.code!=='PROJECT_STORE_PLATFORM_UNSUPPORTED')process.exit(3)});";
        const child=spawnSync(process.execPath,['-e',source,root],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(fs.existsSync(root),false);
    });
    if(process.platform!=='win32'||process.arch!=='x64'){notRun('native Project Store','requires Windows x64');return;}
    DatabaseSync=require('node:sqlite').DatabaseSync;
    await test('fresh explicit initialization and complete filesystem inventory',async()=>{
        const value=await init('primary');primary=value.store;primaryRoot=value.root;assert.deepEqual(fs.readdirSync(primaryRoot).sort(),['bootstrap.identity.json','projects.sqlite3']);
        const boot=await bootstrap.openPrivateStoreRoot({root:primaryRoot});assert.equal(boot.sqlite.contentValidated,false);assert.equal(boot.storeId,primary.storeId);assert.deepEqual(await primary.listProjects(),[]);
    });
    await test('native noncreating read-write mode refuses disappeared database',async()=>{
        const missing=path.join(fixtures,'does-not-exist.sqlite3');assert.throws(()=>new DatabaseSync(uri(missing),{readOnly:false}),e=>e.errcode===14);assert.equal(fs.existsSync(missing),false);
    });
    await test('DELETE EXTRA foreign keys bounded timeout and security options',async()=>{
        const {root,store}=await init('settings');close(store);raw(root,db=>{assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);});
        let inspected=false;const original=DatabaseSync.prototype.exec;
        DatabaseSync.prototype.exec=function(sql){if(sql==='BEGIN IMMEDIATE'&&this.location()!==null){inspected=true;assert.equal(this.prepare('PRAGMA synchronous').get().synchronous,3);assert.equal(this.prepare('PRAGMA busy_timeout').get().timeout,350);assert.equal(this.prepare('PRAGMA trusted_schema').get().trusted_schema,0);assert.throws(()=>this.exec("ATTACH ':memory:' AS other"));assert.throws(()=>this.exec('PRAGMA journal_mode=WAL'));assert.throws(()=>this.enableLoadExtension(true));}return original.call(this,sql);};
        try{await primary.createProject({name:'settings',target:'mysql',source:''});}finally{DatabaseSync.prototype.exec=original;}assert.ok(inspected);
    });
    await test('repeated initialization preserves existing store',async()=>{const before=inventory(primaryRoot);await rejects(()=>api.initializeProjectStore({root:primaryRoot}),'PROJECT_STORE_EXISTS');assert.deepEqual(inventory(primaryRoot),before);});
    await test('missing initialized database fails closed without files',async()=>{
        const {root,store}=await init('missing');close(store);fs.renameSync(path.join(root,'projects.sqlite3'),path.join(fixtures,'retained-missing.sqlite3'));const before=inventory(root);await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_MISSING');assert.deepEqual(inventory(root),before);
    });
    await test('database disappearance at integrated native reopen creates nothing',async()=>{
        const {root,store}=await init('open-disappearance');close(store);const sqlite=require('node:sqlite'),original=sqlite.DatabaseSync,file=path.join(root,'projects.sqlite3');let removed=false;
        sqlite.DatabaseSync=class extends original {constructor(filename,options){if(filename===uri(file)){removed=true;fs.renameSync(file,path.join(fixtures,'retained-race-disappearance.sqlite3'));}super(filename,options);}};
        try{await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_MISSING');}finally{sqlite.DatabaseSync=original;}
        assert.ok(removed);assert.deepEqual(fs.readdirSync(root),['bootstrap.identity.json']);
    });
    await test('interrupted marker-only initialization is preserved',async()=>{
        const root=fixture('partial');await bootstrap.initializePrivateStoreRoot({root});const before=inventory(root);await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_MISSING');await rejects(()=>api.initializeProjectStore({root}),'PROJECT_STORE_EXISTS');assert.deepEqual(inventory(root),before);
    });
    await test('failure during schema initialization preserves partial state',async()=>{
        const root=fixture('schema-interrupted'),old=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql.startsWith('CREATE TABLE projects'))throw Error('injected');return old.call(this,sql);};
        try{await rejects(()=>api.initializeProjectStore({root}),'PROJECT_STORE_STORAGE_FAILURE');}finally{DatabaseSync.prototype.exec=old;}
        assert.ok(fs.existsSync(path.join(root,'bootstrap.identity.json')));assert.ok(fs.existsSync(path.join(root,'projects.sqlite3')));const before=inventory(root);await rejects(()=>api.initializeProjectStore({root}),'PROJECT_STORE_EXISTS');await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_CORRUPT');assert.deepEqual(inventory(root),before);
    });
    await test('changed bootstrap store ID during initialization is never adopted',async()=>{
        const root=fixture('identity-during-init'),original=bootstrap.openPrivateStoreRoot;let calls=0;
        bootstrap.openPrivateStoreRoot=async options=>{if(options.root===root&&++calls===2){const file=path.join(root,'bootstrap.identity.json'),marker=JSON.parse(fs.readFileSync(file,'utf8'));marker.storeId=crypto.randomUUID();fs.writeFileSync(file,JSON.stringify(marker)+'\n');}return original(options);};
        try{await rejects(()=>api.initializeProjectStore({root}),'PROJECT_STORE_IDENTITY_MISMATCH');}finally{bootstrap.openPrivateStoreRoot=original;}
        assert.equal(fs.statSync(path.join(root,'projects.sqlite3')).size,0);const before=inventory(root);await rejects(()=>api.initializeProjectStore({root}),'PROJECT_STORE_EXISTS');assert.deepEqual(inventory(root),before);
    });
    await test('create revision one without compilation and independent process reopen',async()=>{
        project=await primary.createProject({name:'initial',target:'mysql',source:'not necessarily valid DSL'});assert.equal(project.revision,1);assert.equal(project.sourceHash,hash(Buffer.from(project.source)));const child=await worker();const response=await request(child,{action:'read',root:primaryRoot,id:project.id});assert.equal(response.ok,true);assert.deepEqual(response.result,project);
    });
    await test('list deterministic metadata without source BLOB reads and duplicate names',async()=>{
        await primary.createProject({name:'initial',target:'postgres',source:'second'});const original=DatabaseSync.prototype.prepare;
        DatabaseSync.prototype.prepare=function(sql,...args){assert.ok(!/^SELECT \* FROM projects/.test(sql));assert.ok(!/^SELECT source[, ]/.test(sql));return original.call(this,sql,...args);};
        let listed;try{listed=await primary.listProjects();}finally{DatabaseSync.prototype.prepare=original;}
        assert.deepEqual(listed.map(x=>x.id),listed.map(x=>x.id).sort());assert.equal(listed.filter(x=>x.name==='initial').length,2);assert.ok(listed.every(x=>!Object.hasOwn(x,'source')));
    });
    await test('update name only',async()=>{project=await primary.saveProject(project.id,1,{name:' renamed '});assert.equal(project.name,' renamed ');assert.equal(project.target,'mysql');assert.equal(project.source,'not necessarily valid DSL');});
    await test('update target only',async()=>{project=await primary.saveProject(project.id,2,{target:'postgres'});assert.equal(project.revision,3);assert.equal(project.name,' renamed ');});
    await test('update source only with exact BOM CRLF LF Unicode and NUL',async()=>{const source='\uFEFFα😀漢字\r\nLF\n \t\0';project=await primary.saveProject(project.id,3,{source});assert.equal(project.source,source);assert.equal(project.sourceHash,hash(Buffer.from(source)));});
    await test('update all editable fields',async()=>{project=await primary.saveProject(project.id,4,{name:'all',target:'mysql',source:'replacement'});assert.equal(project.revision,5);assert.equal(project.name,'all');assert.equal(project.source,'replacement');});
    await test('immutable committed historical snapshots',async()=>{const first=await primary.getProjectRevision(project.id,1);assert.equal(first.name,'initial');assert.equal(first.source,'not necessarily valid DSL');const fourth=await primary.getProjectRevision(project.id,4);assert.equal(fourth.source,'\uFEFFα😀漢字\r\nLF\n \t\0');});
    await test('intentional empty source and valid UTF-8 Buffer imports',async()=>{const p=await primary.createProject({name:'empty',target:'mysql',source:''});assert.equal(p.source,'');const bytes=Buffer.from('\uFEFFhello\0😀\r\n');const next=await primary.saveProject(p.id,1,{source:bytes});assert.deepEqual(Buffer.from(next.source),bytes);});
    await test('user SQL punctuation remains bound data',async()=>{const name="'; DROP TABLE projects; --",source="SELECT '😀'; --\r\n";const p=await primary.createProject({name,target:'postgres',source});assert.equal((await primary.getProject(p.id)).name,name);assert.equal(p.source,source);});
    await test('maximum one MiB source accepted and preserved',async()=>{const source='😀'.repeat(262144);const p=await primary.createProject({name:'maximum',target:'postgres',source});assert.equal(Buffer.byteLength(p.source),1048576);assert.equal(p.source,source);});
    await test('oversize sources and invalid UTF-8 rejected',async()=>{for(const source of ['x'.repeat(1048577),Buffer.alloc(1048577),Buffer.from([0xc0,0x80]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xe2,0x82]),'\ud800',42,null,new Uint8Array([65])])await rejects(()=>primary.createProject({name:'bad',target:'mysql',source}),'PROJECT_INVALID_SOURCE');});
    await test('name bounds whitespace preservation and invalid names',async()=>{const name='😀'.repeat(128);assert.equal((await primary.createProject({name,target:'mysql',source:''})).name,name);for(const invalid of ['', ' \t ', 'x'.repeat(129), '\0', '\uFEFFname', '\ud800', 123, null])await rejects(()=>primary.createProject({name:invalid,target:'mysql',source:''}),'PROJECT_INVALID_NAME');});
    await test('target UUID revision and argument type validation',async()=>{
        for(const target of ['MYSQL','postgresql','',null,1])await rejects(()=>primary.createProject({name:'bad',target,source:''}),'PROJECT_INVALID_TARGET');
        for(const id of ['bad',project.id.toUpperCase(),null,1])await rejects(()=>primary.getProject(id),'PROJECT_INVALID_ID');
        for(const rev of [undefined,null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1',1n])await rejects(()=>primary.saveProject(project.id,rev,{name:'x'}),'PROJECT_INVALID_REVISION');
        for(const input of [null,[],1,{name:'x',target:'mysql'},{name:'x',target:'mysql',source:'',extra:1},Object.create(null)])await rejects(()=>primary.createProject(input),'PROJECT_INVALID_INPUT');
        const accessor={name:'x',target:'mysql'};Object.defineProperty(accessor,'source',{get(){throw Error('must not invoke');},enumerable:true});await rejects(()=>primary.createProject(accessor),'PROJECT_INVALID_INPUT');
        for(const changes of [{},null,[],{id:project.id},{source:undefined}])await rejects(()=>primary.saveProject(project.id,5,changes),changes&&Object.hasOwn(changes,'source')?'PROJECT_INVALID_SOURCE':'PROJECT_INVALID_INPUT');
    });
    await test('missing project and historical revision errors',async()=>{await rejects(()=>primary.getProject(crypto.randomUUID()),'PROJECT_NOT_FOUND');await rejects(()=>primary.getProjectRevision(project.id,99),'PROJECT_NOT_FOUND');});
    await test('stale save does not overwrite or append revision',async()=>{const before=await primary.getProject(project.id);await rejects(()=>primary.saveProject(project.id,1,{name:'stale'}),'PROJECT_REVISION_CONFLICT');assert.deepEqual(await primary.getProject(project.id),before);await rejects(()=>primary.getProjectRevision(project.id,6),'PROJECT_NOT_FOUND');});
    for(const stage of ['before-update','between-history-and-current','before-commit','after-commit'])await test('injected '+stage+' leaves paired transactions and consistent history',()=>injected(stage));
    await test('two independent processes saving one revision produce exactly one winner',async()=>{
        const p=await primary.createProject({name:'race',target:'mysql',source:'before'}),a=await worker(),b=await worker();
        const prepared=await Promise.all([request(a,{action:'prepare-save',root:primaryRoot}),request(b,{action:'prepare-save',root:primaryRoot})]);assert.ok(prepared.every(x=>x.prepared));
        const responses=await Promise.all([request(a,{action:'save',id:p.id,revision:1,changes:{source:'winner-a'}}),request(b,{action:'save',id:p.id,revision:1,changes:{source:'winner-b'}})]);
        assert.equal(responses.filter(x=>x.ok).length,1);assert.equal(responses.find(x=>!x.ok).code,'PROJECT_REVISION_CONFLICT');const current=await primary.getProject(p.id);assert.equal(current.revision,2);assert.equal(current.source,responses.find(x=>x.ok).result.source);assert.equal((await primary.getProjectRevision(p.id,2)).source,current.source);await rejects(()=>primary.getProjectRevision(p.id,3),'PROJECT_NOT_FOUND');
    });
    await test('independent processes writing different projects preserve both histories',async()=>{
        const p=await primary.createProject({name:'different-a',target:'mysql',source:''}),q=await primary.createProject({name:'different-b',target:'postgres',source:''}),a=await worker(),b=await worker();
        await Promise.all([request(a,{action:'prepare-save',root:primaryRoot}),request(b,{action:'prepare-save',root:primaryRoot})]);const responses=await Promise.all([request(a,{action:'save',id:p.id,revision:1,changes:{name:'saved-a'}}),request(b,{action:'save',id:q.id,revision:1,changes:{name:'saved-b'}})]);assert.ok(responses.every(x=>x.ok));assert.equal((await primary.getProject(p.id)).name,'saved-a');assert.equal((await primary.getProject(q.id)).name,'saved-b');
    });
    await test('busy lock is bounded sanitized and leaves no transaction',async()=>{
        const child=await worker();assert.equal((await request(child,{action:'lock',root:primaryRoot})).locked,true);const started=Date.now();await rejects(()=>primary.saveProject(project.id,5,{name:'busy'}),'PROJECT_STORE_BUSY');assert.ok(Date.now()-started<15000);assert.equal((await request(child,{action:'release'})).released,true);assert.equal((await primary.getProject(project.id)).revision,5);
    });
    await test('concurrent first initialization has one winner',async()=>{const root=fixture('init-race'),a=await worker(),b=await worker();const responses=await Promise.all([request(a,{action:'init',root}),request(b,{action:'init',root})]);assert.equal(responses.filter(x=>x.ok).length,1);assert.equal(responses.find(x=>!x.ok).code,'PROJECT_STORE_EXISTS');const s=await api.openProjectStore({root});close(s);});
    await test('wrong bootstrap store ID refused without repair',()=>altered('wrong-id',root=>raw(root,db=>{db.exec('DROP TRIGGER meta_no_update');db.prepare('UPDATE store_meta SET store_id=?').run(crypto.randomUUID());db.exec(require('../src/project-store/schema').definitions.meta_no_update);}), 'PROJECT_STORE_IDENTITY_MISMATCH'));
    await test('corrupt SQLite header preserved',()=>altered('header',root=>{const fd=fs.openSync(path.join(root,'projects.sqlite3'),'r+');fs.writeSync(fd,Buffer.from('BROKEN'),0,6,0);fs.closeSync(fd);},'PROJECT_STORE_CORRUPT'));
    await test('empty existing database is never adopted',()=>altered('empty-file',root=>fs.truncateSync(path.join(root,'projects.sqlite3'),0),'PROJECT_STORE_CORRUPT'));
    await test('unknown future schema version refused',()=>altered('version',root=>raw(root,db=>db.exec('PRAGMA user_version=2')),'PROJECT_STORE_INCOMPATIBLE'));
    await test('older incompatible schema version refused',()=>altered('old-version',root=>raw(root,db=>db.exec('PRAGMA user_version=0')),'PROJECT_STORE_INCOMPATIBLE'));
    await test('wrong application ID refused',()=>altered('appid',root=>raw(root,db=>db.exec('PRAGMA application_id=0')),'PROJECT_STORE_INCOMPATIBLE'));
    await test('unsupported schema modifications refused',()=>altered('schema',root=>raw(root,db=>db.exec('CREATE TABLE unexpected(v TEXT)')),'PROJECT_STORE_INCOMPATIBLE'));
    await test('WAL header rejected without creating WAL SHM or deleting files',()=>altered('wal',root=>raw(root,db=>db.exec('PRAGMA journal_mode=WAL')),'PROJECT_STORE_INCOMPATIBLE'));
    await test('source hash corruption refused',()=>altered('hash',root=>raw(root,db=>{db.exec('DROP TRIGGER projects_advance; DROP TRIGGER projects_snapshot_update;');db.exec("UPDATE projects SET source_hash=zeroblob(32)");const d=require('../src/project-store/schema').definitions;db.exec(d.projects_advance);db.exec(d.projects_snapshot_update);}), 'PROJECT_STORE_CORRUPT'));
    await test('invalid UTF-8 database content refused',()=>altered('utf8',root=>raw(root,db=>{db.exec('DROP TRIGGER projects_advance; DROP TRIGGER projects_snapshot_update;');const bytes=Buffer.from([0xc0,0x80]);db.prepare('UPDATE projects SET source=?,source_hash=?').run(bytes,Buffer.from(hash(bytes),'hex'));const d=require('../src/project-store/schema').definitions;db.exec(d.projects_advance);db.exec(d.projects_snapshot_update);}), 'PROJECT_STORE_CORRUPT'));
    await test('unknown entry and unknown journal retained untouched',()=>altered('unknown',root=>fs.writeFileSync(path.join(root,'unknown-journal'),'do not delete'),'PROJECT_STORE_RECOVERY_REQUIRED'));
    await test('unrecognized named rollback journal is preserved without native recovery',()=>altered('unknown-native-journal',root=>fs.writeFileSync(path.join(root,'projects.sqlite3-journal'),'unknown journal bytes'),'PROJECT_STORE_RECOVERY_REQUIRED'));
    await test('an open store refuses a newly introduced unknown journal without deletion',async()=>{
        const {root,store}=await init('unknown-live-journal');fs.writeFileSync(path.join(root,'projects.sqlite3-journal'),'retain this evidence');const before=inventory(root);await rejects(()=>store.listProjects(),'PROJECT_STORE_RECOVERY_REQUIRED');close(store);assert.deepEqual(inventory(root),before);
    });
    await test('directory database and linked journal refused without deletion',async()=>{
        const {root,store}=await init('linked-journal');close(store);fs.linkSync(path.join(root,'projects.sqlite3'),path.join(root,'projects.sqlite3-journal'));const before=inventory(root);await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_UNSAFE');assert.deepEqual(inventory(root),before);
        const other=await init('directory-db');close(other.store);fs.renameSync(path.join(other.root,'projects.sqlite3'),path.join(fixtures,'retained-directory-db.sqlite3'));fs.mkdirSync(path.join(other.root,'projects.sqlite3'));await rejects(()=>api.openProjectStore({root:other.root}),'PROJECT_STORE_UNSAFE');
    });
    await test('broad private database ACL refused under unchanged bootstrap policy',async()=>{
        const {root,store}=await init('broad-acl');close(store);const file=path.join(root,'projects.sqlite3');
        await ps('$a=Get-Acl -LiteralPath $d.file; $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule("Everyone","FullControl","Allow"))); Set-Acl -LiteralPath $d.file -AclObject $a',{file});
        const before=inventory(root);await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_UNSAFE');assert.deepEqual(inventory(root),before);
    });
    await test('native open handle prevents replacement or cached identity refuses it',async()=>{
        const {root,store}=await init('replace');const file=path.join(root,'projects.sqlite3'),original=path.join(fixtures,'retained-replaced.sqlite3'),before=inventory(root);
        let moved=false;try{fs.renameSync(file,original);moved=true;}catch(error){assert.ok(['EBUSY','EPERM','EACCES'].includes(error.code));assert.deepEqual(inventory(root),before);notRun('main-file replacement while native database handle is open','Windows SQLite VFS denied rename: '+error.code);}
        if(moved){fs.copyFileSync(original,file);await rejects(()=>store.listProjects(),'PROJECT_STORE_IDENTITY_MISMATCH');}else assert.deepEqual(await store.listProjects(),[]);
        close(store);
    });
    await test('oversized corrupt BLOB is refused before source allocation',async()=>{
        const {root,store}=await init('oversize-corruption'),p=await store.createProject({name:'bounded',target:'mysql',source:''});
        raw(root,db=>{db.exec('PRAGMA ignore_check_constraints=ON; DROP TRIGGER projects_advance; DROP TRIGGER projects_snapshot_update; UPDATE projects SET source=zeroblob(1048577);');const d=require('../src/project-store/schema').definitions;db.exec(d.projects_advance);db.exec(d.projects_snapshot_update);});
        await rejects(()=>store.getProject(p.id),'PROJECT_STORE_CORRUPT');close(store);await rejects(()=>api.openProjectStore({root}),'PROJECT_STORE_CORRUPT');
    });
    await test('missing history and invalid timestamp metadata are refused',async()=>{
        await altered('history-corruption',root=>raw(root,db=>{db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER revisions_no_delete; DELETE FROM project_revisions;');db.exec(require('../src/project-store/schema').definitions.revisions_no_delete);}), 'PROJECT_STORE_CORRUPT');
        await altered('timestamp-corruption',root=>raw(root,db=>{db.exec('DROP TRIGGER meta_no_update;');db.prepare('UPDATE store_meta SET created_at=?').run('9999-99-99T99:99:99.999Z');db.exec(require('../src/project-store/schema').definitions.meta_no_update);}), 'PROJECT_STORE_CORRUPT');
    });
    await test('immutable schema triggers and integer bounds enforce committed history',async()=>{
        const {root,store}=await init('sql-constraints');const p=await store.createProject({name:'p',target:'mysql',source:''});close(store);raw(root,db=>{
            assert.throws(()=>db.prepare('UPDATE project_revisions SET name=? WHERE project_id=?').run('changed',p.id));assert.throws(()=>db.exec('DELETE FROM project_revisions'));assert.throws(()=>db.exec('DELETE FROM projects'));assert.throws(()=>db.exec('UPDATE store_meta SET schema_version=2'));assert.throws(()=>db.exec('UPDATE projects SET revision=9007199254740992'));
        });const reopened=await api.openProjectStore({root});assert.equal((await reopened.getProjectRevision(p.id,1)).name,'p');close(reopened);
    });
    for(const {afterCommit,damageHeader} of [{afterCommit:false,damageHeader:false},{afterCommit:false,damageHeader:true},{afterCommit:true,damageHeader:false}])await test(afterCommit?'external termination after commit preserves revision two':damageHeader?'recognized hot journal recovers an injected incomplete database header':'real hot rollback journal recovers after external termination',async()=>{
        const {root,store}=await init(afterCommit?'crash-committed':'crash-uncommitted');const p=await store.createProject({name:'crash',target:'mysql',source:'A'.repeat(1048576)});close(store);const beforeHash=hash(fs.readFileSync(path.join(root,'projects.sqlite3'))),child=await worker();
        const status=await request(child,{action:'crash',root,id:p.id,afterCommit});
        if(!afterCommit){assert.equal(status.transactionOpen,true);assert.ok(status.journalBytes>512);assert.equal(status.journalHeader,'d9d505f920a163d7');assert.notEqual(hash(fs.readFileSync(path.join(root,'projects.sqlite3'))),beforeHash);}else{assert.equal(status.transactionOpen,false);assert.equal(status.journalBytes,0);}
        await terminate(child);
        if(damageHeader){const fd=fs.openSync(path.join(root,'projects.sqlite3'),'r+');fs.writeSync(fd,Buffer.from('INCOMPLETE'),0,10,0);fs.closeSync(fd);}
        const reopened=await api.openProjectStore({root}),got=await reopened.getProject(p.id);assert.equal(got.revision,afterCommit?2:1);assert.equal(got.source,(afterCommit?'B':'A').repeat(1048576));assert.equal((await reopened.getProjectRevision(p.id,1)).source,'A'.repeat(1048576));if(!afterCommit){await rejects(()=>reopened.getProjectRevision(p.id,2),'PROJECT_NOT_FOUND');assert.equal(hash(fs.readFileSync(path.join(root,'projects.sqlite3'))),beforeHash);}else assert.equal((await reopened.getProjectRevision(p.id,2)).source,'B'.repeat(1048576));assert.equal(fs.existsSync(path.join(root,'projects.sqlite3-journal')),false);close(reopened);
    });
    await test('ordinary reopening validates all current and historical source hashes',async()=>{close(primary);primary=await api.openProjectStore({root:primaryRoot});stores.add(primary);assert.equal((await primary.getProject(project.id)).revision,5);assert.equal((await primary.getProjectRevision(project.id,1)).name,'initial');});
    await test('close is idempotent and closed operations fail clearly',async()=>{close(primary);primary.close();await rejects(()=>primary.listProjects(),'PROJECT_STORE_CLOSED');});
    notRun('native Node 18 compiler execution','Node 18 is not installed; no global runtime upgrade or download performed');
    notRun('sudden electrical power loss','process termination is not power-loss durability evidence');
    notRun('second Windows user and Linux/macOS native execution','no alternate-account fixture; non-Windows storage is unsupported');
}
main().catch(error=>{console.error(error.stack);results.push({name:'harness',status:'FAIL',error:error.stack});process.exitCode=1;}).finally(async()=>{
    for(const child of workers)child.kill();for(const store of stores)try{store.close();}catch{}
    const summary={runtime:{node:process.version,sqlite:process.versions.sqlite,platform:process.platform,arch:process.arch},fixtures,results,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})};
    if(fixtures)fs.writeFileSync(path.join(fixtures,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({counts:summary.counts,fixtures}));
});
