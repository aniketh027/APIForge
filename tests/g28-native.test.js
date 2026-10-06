'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {randomBytes}=require('crypto'),{spawnSync}=require('child_process');
const {compileFile}=require('../src/compiler'),Codegen=require('../src/codegen/codegen'),M=require('../src/migrations');
const h=require('./generated-backend-test-helpers'),{mysqlSession}=require('./g28-mysql-session');
const {nativeSession}=require('./postgres-native-helpers'),{introspect}=require('./migration-mysql-helpers');
const pgNames=require('../src/targets/postgres/names'),mysqlNames=require('../src/utils/mysql-target');
const chunks={
    users:'ENTITY User\nkey UUID PRIMARY KEY\nemail STRING REQUIRED UNIQUE\nname STRING DEFAULT "unnamed"\nscore INT MIN 0 MAX 100 DEFAULT 0\nratio FLOAT DEFAULT 1.5\nactive BOOLEAN DEFAULT FALSE\nstate ENUM("draft","active") DEFAULT "draft"\nborn DATE DEFAULT "2000-02-29"\nseen TIMESTAMP DEFAULT "2000-02-29T12:34:56Z"\nconstructor STRING',
    groups:'ENTITY Group\nkey STRING PRIMARY KEY\nlabel STRING',
    posts:'IMPORT "users.apiforge" IMPORT "groups.apiforge"\nENTITY Post\nkey INT PRIMARY KEY\ntitle STRING REQUIRED',
    profiles:'IMPORT "users.apiforge"\nENTITY Profile\nkey INT PRIMARY KEY\nbio STRING',
    audit:'ENTITY Audit\nnote STRING',
    relations:'RELATION User POSTS Post ONE_TO_MANY\nRELATION User PROFILE Profile ONE_TO_ONE\nRELATION Post GROUP Group MANY_TO_ONE\nRELATION User GROUPS Group MANY_TO_MANY'
};
const flat=[chunks.users,chunks.groups,chunks.posts.slice(chunks.posts.indexOf('ENTITY')),chunks.profiles.slice(chunks.profiles.indexOf('ENTITY')),chunks.audit,chunks.relations].join('\n');
function fixture(root){
    const source=path.join(root,'sources');fs.mkdirSync(source);fs.mkdirSync(path.join(source,'entities'));
    for(const [name,body]of Object.entries(chunks))fs.writeFileSync(path.join(source,name==='relations'?'relations.apiforge':'entities/'+name+'.apiforge'),body);
    const entry=path.join(source,'main.apiforge');fs.writeFileSync(entry,['users','posts','profiles','audit'].map(n=>'IMPORT "entities/'+n+'.apiforge"').concat('IMPORT "relations.apiforge"').join('\n'));return entry;
}
async function run(target){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-native-'+target+'-')),entry=fixture(root);
    const outputBefore=h.snapshotDirectory(path.resolve(__dirname,'../output'));
    let session,db,client,state,port,requests=0,migrationStatements=0;
    const q=target==='mysql'?mysqlNames.quoteIdentifier:pgNames.quoteIdentifier;
    const table=target==='mysql'?q:pgNames.table;
    try{
        const result=compileFile(entry,{target}),admission=Codegen.prepareAdmittedGeneration(result.optimizedIR,{target});
        assert.equal(result.compilationUnit.modules.length,7);assert.equal(result.generatedFiles.length,22);
        const cli=spawnSync(process.execPath,[path.resolve(__dirname,'../index.js'),entry,'--target',target],{cwd:root,encoding:'utf8'});assert.equal(cli.status,0,cli.stdout+cli.stderr);
        const project=path.join(root,'output');for(const file of result.generatedFiles)assert.equal(fs.readFileSync(path.join(project,file.path),'utf8'),file.content);
        const install=h.npmInvocation(['install','--no-audit','--no-fund']);const installed=await h.runCommand(install.command,install.args,{cwd:project,timeoutMs:120000});assert.equal(installed.code,0,installed.stderr);
        let config,name,application;
        if(target==='mysql'){
            session=await mysqlSession();client=session.connection;name='apiforge_e2e_'+randomBytes(12).toString('hex');
            await client.query('CREATE DATABASE '+q(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            await client.query('USE '+q(name));await client.query("SET SESSION time_zone='+00:00'");
            config={...session.config,database:name};
        }else{session=await nativeSession();db=await session.database();client=db.client;name=db.name;config=db.config;}
        await client.query(result.generatedFiles.find(f=>f.path==='database/schema.sql').content);
        application=target==='postgres'?await session.restrictedApplication(db,admission.context.physical):config;
        port=await h.acquireFreePort();const start=h.npmInvocation(['start']);
        state=h.startCommand(start.command,start.args,{cwd:project,env:{...process.env,PORT:String(port),DB_HOST:application.host,DB_PORT:String(application.port),DB_USER:application.user,DB_PASSWORD:application.password,DB_NAME:name,TZ:'Pacific/Honolulu',npm_config_update_notifier:'false'}});
        await h.waitForHealth(port,state,15000);
        const route=n=>admission.context.byName.get(n).names.resourcePath;
        async function request(method,url,body,status=200){requests++;const response=await h.requestHttp(port,method,url,body);assert.equal(response.statusCode,status,method+' '+url+' '+response.body);return response.json.data;}
        const user=await request('POST',route('User'),{email:'module@example.test',constructor:'own'},201);assert.match(user.key,/^[0-9a-f-]{36}$/);
        const userRead=await request('GET',route('User')+'/'+user.key);assert.equal(userRead.born,'2000-02-29');assert.equal(userRead.seen,'2000-02-29T12:34:56Z');assert.equal(userRead.constructor,'own');
        const post=await request('POST',route('Post'),{title:'from imported entity'},201);
        const group=await request('POST',route('Group'),{key:'group-a',label:'native'},201);
        const profile=await request('POST',route('Profile'),{bio:'module profile'},201);
        await request('PUT',route('Post')+'/'+post.key,{title:'updated'});
        assert.equal((await request('GET',route('Post')+'/'+post.key)).title,'updated');
        await request('POST',route('User'),{email:'bad@example.test',born:'2000-02-30'},400);
        const collection=await request('GET',route('User')+'?email=module%40example.test&sort=email&page=1&limit=1');assert.equal(collection.length,1);assert.equal(collection[0].key,user.key);
        for(const rel of admission.context.plan.relations){
            const source=admission.context.byId.get(rel.sourceEntityId),storage=rel.storage;
            const sourceKey=source.sourceName==='User'?user.key:post.key;
            const get=route(source.sourceName)+'/'+encodeURIComponent(sourceKey)+'/'+rel.names.segment;
            if(storage.kind==='junction'){
                const association=get+'/'+encodeURIComponent(group.key);await request('POST',association,undefined,201);
                assert.equal((await request('GET',get))[0].key,group.key);await request('DELETE',association);assert.deepEqual(await request('GET',get),[]);
                await request('POST',association,undefined,201);
            }else{
                const receiver=admission.context.byId.get(storage.receiverEntityId),field=receiver.fields.find(f=>f.id===storage.fieldId).name;
                const key=receiver.fields.find(f=>f.id===receiver.key.fieldId).name;
                const receiverValue=receiver.sourceName==='Post'?post.key:profile.key;
                const foreignValue=rel.relationName==='GROUP'?group.key:user.key;
                await client.query('UPDATE '+table(receiver.names.table)+' SET '+q(field)+(target==='mysql'?'=? WHERE ':'=$1 WHERE ')+q(key)+(target==='mysql'?'=?':'=$2'),[foreignValue,receiverValue]);
                const associated=await request('GET',get);assert.equal((rel.http.many?associated[0]:associated).key,rel.relationName==='POSTS'?post.key:rel.relationName==='PROFILE'?profile.key:group.key);
            }
        }
        const audit=await request('POST',route('Audit'),{note:'delete smoke'},201);await request('DELETE',route('Audit')+'/'+audit.id);await request('GET',route('Audit')+'/'+audit.id,undefined,404);
        const persisted=target==='mysql'?(await client.query('SELECT '+q('title')+' FROM '+table('Post')+' WHERE '+q('key')+'=?',[post.key]))[0]:(await client.query('SELECT '+q('title')+' FROM '+table('Post')+' WHERE '+q('key')+'=$1',[post.key])).rows;
        assert.equal(persisted[0].title,'updated');
        await h.stopProcessTree(state);state=null;await h.assertPortReleased(port);
        if(target==='mysql'){
            const old=M.compileFileForSnapshot(entry),single=M.compileSourceForSnapshot(flat);
            assert.equal(M.canonical(old),M.canonical(single));assert.equal(M.snapshotSha256(old),M.snapshotSha256(single));assert.equal(M.physicalSha256(old),M.physicalSha256(single));
            assert.deepEqual(await introspect(client,name,old.target),M.physicalProjection(old));
            const workspace=path.join(root,'history'),snapshot=path.join(root,'old.json');fs.writeFileSync(snapshot,M.canonical(old));
            function migration(...args){const run=spawnSync(process.execPath,[path.resolve(__dirname,'../migrate.js'),...args],{cwd:root,encoding:'utf8'});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);}
            migration('baseline','--snapshot',snapshot,'--workspace',workspace);
            fs.appendFileSync(path.join(root,'sources/entities/posts.apiforge'),'\nsummary STRING DEFAULT "new"');
            const diff=migration('diff','--workspace',workspace,'--to',entry);
            migration('create','--workspace',workspace,'--to',entry,'--expect-head',diff.headToken,'--expect-plan',diff.planSha256);
            const next=M.compileFileForSnapshot(entry),plan=M.planMysqlMigration(old,next);
            const rendered=M.renderMysqlMigration(old,next,plan,{expectPlan:M.hash(plan)});
            for(const statement of rendered.statements){await client.query(statement.sql);migrationStatements++;}
            assert.deepEqual(await introspect(client,name,next.target),M.physicalProjection(next));
            const [retained]=await client.query('SELECT '+q('title')+', '+q('summary')+' FROM '+table('Post')+' WHERE '+q('key')+'=?',[post.key]);assert.deepEqual(retained[0],{title:'updated',summary:'new'});
            assert.equal(migration('verify','--workspace',workspace).revisions,2);
        }
        assert(!fs.existsSync(path.join(project,'.env')));
        console.log(JSON.stringify({gate:'D',target,profile:session.profile,modules:7,entities:5,files:22,requests,persistence:true,restrictedRole:target==='postgres',migrationStatements,result:'PASS'}));
        if(target==='mysql'){await client.query('DROP DATABASE '+q(name));client=null;}
    }finally{
        try{if(state)await h.stopProcessTree(state);if(port)await h.assertPortReleased(port);}finally{
            try{if(db)await db.close();}finally{if(session)await session.cleanup();h.removeTemporaryDirectory(root);assert.deepEqual(h.snapshotDirectory(path.resolve(__dirname,'../output')),outputBefore);}
        }
    }
}
(async()=>{for(const target of process.argv[2]?[process.argv[2]]:['mysql','postgres'])await run(target);})().catch(error=>{console.error(error);process.exitCode=1;});
