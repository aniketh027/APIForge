'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const {Client}=require('pg');
const {nativeSession,admit,delay,privatePublicTable}=require('./postgres-native-helpers');
const {keys,scalars,relations,uuidRelations}=require('./postgres-target-cases');
const h=require('./generated-backend-test-helpers'),Codegen=require('../src/codegen/codegen');
const names=require('../src/targets/postgres/names'),taxonomy=require('../src/targets/postgres/errors');
let requests=0,nativeErrors=0;
async function temporaryErrors(config) {
    const a=new Client(config),b=new Client(config);await a.connect();await b.connect();
    try {
        await a.query('CREATE TABLE "public"."ErrorLocks" ("id" integer PRIMARY KEY, "v" integer)');await a.query('INSERT INTO "public"."ErrorLocks" VALUES (1,0),(2,0)');
        await a.query('BEGIN');await a.query('UPDATE "public"."ErrorLocks" SET "v"=1 WHERE "id"=1');await b.query('BEGIN');
        await assert.rejects(b.query('SELECT * FROM "public"."ErrorLocks" WHERE "id"=1 FOR UPDATE NOWAIT'),e=>{nativeErrors++;return e.code==='55P03'&&taxonomy.classify(e).status===503;});
        await b.query('ROLLBACK');await a.query('ROLLBACK');
        await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await a.query('SELECT * FROM "public"."ErrorLocks"');await b.query('SELECT * FROM "public"."ErrorLocks"');
        await a.query('UPDATE "public"."ErrorLocks" SET "v"=1 WHERE "id"=1');await a.query('COMMIT');
        await assert.rejects(b.query('UPDATE "public"."ErrorLocks" SET "v"=2 WHERE "id"=1'),e=>{nativeErrors++;return e.code==='40001'&&taxonomy.classify(e,'write').status===503;});await b.query('ROLLBACK');
        await a.query('BEGIN');await b.query('BEGIN');await a.query('UPDATE "public"."ErrorLocks" SET "v"=3 WHERE "id"=1');await b.query('UPDATE "public"."ErrorLocks" SET "v"=3 WHERE "id"=2');
        const results=await Promise.allSettled([a.query('UPDATE "public"."ErrorLocks" SET "v"=4 WHERE "id"=2'),b.query('UPDATE "public"."ErrorLocks" SET "v"=4 WHERE "id"=1')]);
        const failure=results.find(r=>r.status==='rejected');assert.equal(failure.reason.code,'40P01');assert.equal(taxonomy.classify(failure.reason,'write').status,503);nativeErrors++;
        await a.query('ROLLBACK');await b.query('ROLLBACK');
    } finally {await a.end();await b.end();}
}
(async()=>{
    const session=await nativeSession();let db,project,state,port;
    const outputBefore=h.snapshotDirectory(path.resolve(__dirname,'../output'));
    try {
        db=await session.database();
        const source=[scalars,...keys.map(([name,key])=>'ENTITY '+name+' '+key),...relations,...uuidRelations,
            'ENTITY Ordinary textValue STRING realValue FLOAT',
            'ENTITY Limited textValue STRING MAX_LENGTH 255',
            'ENTITY Bound keyValue INT PRIMARY KEY MIN 0 MAX 2',
            'ENTITY RequiredIdentity keyValue INT PRIMARY KEY REQUIRED',
            'ENTITY StaticString keyValue STRING PRIMARY KEY DEFAULT "fixed" value STRING DEFAULT "hidden"',
            'ENTITY UuidValues keyValue UUID PRIMARY KEY value UUID',
            'ENTITY NullableEnum keyValue INT PRIMARY KEY choice ENUM("z","A","é","trailing ")'].join('\n');
        const admission=admit(source),files=Codegen.generate(admission.ir,false,{target:'postgres'}).files;
        project=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g27-generated-'));h.materializeGeneratedFiles(project,files);
        const command=h.npmInvocation(['install','--no-audit','--no-fund']);const installed=await h.runCommand(command.command,command.args,{cwd:project,timeoutMs:120000});assert.equal(installed.code,0,installed.stderr);
        const pgVersion=require(path.join(project,'node_modules/pg/package.json')).version;
        assert.equal(files.length,7+3*admission.context.plan.entities.length);
        await db.client.query(files.find(f=>f.path==='database/schema.sql').content);
        const application=await session.restrictedApplication(db,admission.context.physical);
        const unrelated=await privatePublicTable(db,application);
        port=await h.acquireFreePort();const start=h.npmInvocation(['start']);
        state=h.startCommand(start.command,start.args,{cwd:project,env:{...process.env,PORT:String(port),DB_HOST:application.host,DB_PORT:String(application.port),DB_USER:application.user,DB_PASSWORD:application.password,DB_NAME:db.name,TZ:'Pacific/Honolulu',npm_config_update_notifier:'false'}});
        await h.waitForHealth(port,state,15000);
        async function request(method,url,body,status=200) {
            requests++;const response=await h.requestHttp(port,method,url,body);assert.equal(response.statusCode,status,method+' '+url+' '+response.body);
            if(status>=400){assert.deepEqual(Object.keys(response.json).sort(),['error','success']);assert.equal(response.json.success,false);assert(!/SQLSTATE|constraint|password|INSERT INTO|SELECT \*|af_(pk|fk|ck)_|Unsupported PostgreSQL deployment profile/i.test(response.body));for(const privateValue of [application.user,application.password,unrelated,db.name])assert(!response.body.includes(privateValue),'private connection/fixture detail leaked');}
            return response;
        }
        const pathFor=name=>admission.context.byName.get(name).names.resourcePath;
        await request('GET',pathFor('Ordinary'));
        const actors=(await session.admin.query("SELECT usename FROM pg_stat_activity WHERE datname=$1 AND application_name='apiforge-postgresql-18-v1'",[db.name])).rows;
        assert(actors.length>0,'installed backend has a real application-role connection');
        for(const actor of actors)assert.equal(actor.usename,application.user);
        await db.client.query('REVOKE DELETE ON TABLE "public"."Source3_Target3" FROM '+names.quoteIdentifier(application.user));
        assert.equal((await request('GET',pathFor('Ordinary'),undefined,500)).json.error,'Unable to complete request.');
        await db.client.query('GRANT DELETE ON TABLE "public"."Source3_Target3" TO '+names.quoteIdentifier(application.user));
        await request('GET',pathFor('Ordinary'));
        for(const [name] of keys) {
            const root=pathFor(name),field=name==='Implicit'?'id':'identity';
            if(name==='TextKey')await request('POST',root,{},400);
            else {
                const created=(await request('POST',root,{},201)).json.data;assert(Object.hasOwn(created,field));assert.deepEqual(Object.keys(created),[field]);
                const item=root+'/'+encodeURIComponent(created[field]);assert.equal((await request('GET',item)).json.data[field],created[field]);
                await request('PUT',item,{});await request('PUT',item,{[field]:created[field]},400);await request('DELETE',item);await request('GET',item,undefined,404);await request('DELETE',item,undefined,404);
            }
            const supplied=name==='TextKey'?"string ' ; --":['RuntimeUuid','StaticUuid'].includes(name)?'00000000-0000-0000-0000-000000000000':0;
            if(name==='Implicit')await request('POST',root,{id:0},400);
            else {const created=(await request('POST',root,{[field]:supplied},201)).json.data;assert.equal(created[field],supplied);assert.equal((await db.client.query('SELECT '+names.quoteIdentifier(field)+' FROM '+names.table(name)+' WHERE '+names.quoteIdentifier(field)+'=$1',[supplied])).rows[0][field],supplied);await request('DELETE',root+'/'+encodeURIComponent(supplied));}
            if(name==='Generated') {await request('POST',root,{identity:-1},400);const value=(await request('POST',root,{identity:null},201)).json.data.identity;assert(Number.isInteger(value));}
            if(name==='RuntimeUuid')assert.match((await request('POST',root,{identity:null},201)).json.data.identity,/^[0-9a-f-]{36}$/);
            if(['StaticInt','StaticUuid','TextKey'].includes(name))await request('POST',root,{identity:null},400);
        }
        await request('POST',pathFor('RequiredIdentity'),{keyValue:null},400);
        const stringDefault=(await request('POST',pathFor('StaticString'),{},201)).json.data;assert.deepEqual(stringDefault,{keyValue:'fixed'});assert.equal((await request('GET',pathFor('StaticString')+'/fixed')).json.data.value,'hidden');
        const scalarPath=pathFor('Scalars');
        const varchar=[];
        for(const [label,textValue] of [['255 non-space','x'.repeat(255)],['256 non-space','x'.repeat(256)],['255 + 1 space','x'.repeat(255)+' '],['255 + 4 spaces','x'.repeat(255)+'    ']]) {
            if(label==='256 non-space') {
                assert.equal((await request('POST',pathFor('Ordinary'),{textValue},400)).json.error,'Request contains a value rejected by the database.');
                varchar.push({case:label,inputLength:textValue.length,status:400});
            } else {
                const created=(await request('POST',pathFor('Ordinary'),{textValue},201)).json.data;
                assert.equal(created.textValue,textValue,'HTTP create echoes the submitted STRING');
                const stored=(await db.client.query('SELECT "textValue" FROM "public"."Ordinary" WHERE "id"=$1',[created.id])).rows[0].textValue;
                assert.equal(stored,'x'.repeat(255));assert.equal((await request('GET',pathFor('Ordinary')+'/'+created.id)).json.data.textValue,stored);
                varchar.push({case:label,inputLength:textValue.length,status:201,echoLength:created.textValue.length,storedLength:stored.length});
                await request('DELETE',pathFor('Ordinary')+'/'+created.id);
            }
        }
        for(const excess of [1,4]) {
            const before=(await db.client.query('SELECT count(*) FROM "public"."Limited"')).rows[0].count;
            const response=await request('POST',pathFor('Limited'),{textValue:'x'.repeat(255)+' '.repeat(excess)},400);
            assert.equal(response.json.error,"Field 'textValue' length must be <= 255.");
            assert.equal((await db.client.query('SELECT count(*) FROM "public"."Limited"')).rows[0].count,before);
        }
        const initial=(await request('POST',scalarPath,{},201)).json.data;const read=(await request('GET',scalarPath+'/'+initial.identity)).json.data;
        assert.equal(read.day,'2000-02-29');assert.equal(read.moment,'2000-02-29T12:34:56Z');assert.equal(read.choice,'trailing ');assert.equal(read.flag,false);
        const values={textValue:"HTTP ' \\ Unicode é",integerValue:8,realValue:3.25,flag:true,choice:'é',day:'1000-01-01',moment:'1970-01-01T00:00:01Z',token:'ffffffff-ffff-ffff-ffff-ffffffffffff',...JSON.parse('{"__proto__":"own","constructor":"own","prototype":"own"}')};
        const created=(await request('POST',scalarPath,values,201)).json.data;
        const returned=(await request('GET',scalarPath+'/'+created.identity)).json.data;for(const field of ['__proto__','constructor','prototype'])assert.equal(returned[field],values[field]);
        const updated=(await request('PUT',scalarPath+'/'+created.identity,{day:'9999-12-31',moment:'2038-01-19T03:14:07Z',integerValue:9})).json.data;assert.equal(updated.moment,'2038-01-19T03:14:07Z');
        for(const value of [{day:'2000-02-30'},{moment:'2000-01-01T00:00:00.5Z'},{moment:'2000-01-01T00:00:00+00:00'},{token:'bad'},{choice:'TRAILING '},{integerValue:13},{unknown:'x'}])await request('POST',scalarPath,value,400);
        const page=await request('GET',scalarPath+'?flag=false&sort=choice&order=asc&page=1&limit=1');assert.equal(page.json.data.length,1);assert.equal(page.headers['x-page'],'1');assert.equal(page.headers['x-limit'],'1');assert(Number(page.headers['x-total-count'])>=1);
        await request('GET',scalarPath+'?token=bad',undefined,400);await request('GET',scalarPath+'?day=infinity',undefined,400);await request('GET',scalarPath+'?sort=choice%3BDROP',undefined,400);
        const beyond=await request('GET',scalarPath+'?page=100&limit=100');assert.deepEqual(beyond.json.data,[]);
        for(const textValue of ['case','Case','é','e\u0301','x ','x'])await request('POST',pathFor('Ordinary'),{textValue},201);
        for(const textValue of ['case','Case','é','e\u0301','x ','x'])assert.equal((await request('GET',pathFor('Ordinary')+'?textValue='+encodeURIComponent(textValue))).json.data.length,1);
        for(const choice of [null,'z','A','é','trailing '])await request('POST',pathFor('NullableEnum'),{choice},201);
        assert.deepEqual((await request('GET',pathFor('NullableEnum')+'?sort=choice')).json.data.map(r=>r.choice),[null,'z','A','é','trailing ']);
        assert.deepEqual((await request('GET',pathFor('NullableEnum')+'?sort=choice&order=desc')).json.data.map(r=>r.choice),['trailing ','é','A','z',null]);
        const uuidValues=['00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff','123e4567-e89b-12d3-a456-426614174000','123e4567-e89b-72d3-a456-426614174000'];
        for(const value of uuidValues){await request('POST',pathFor('UuidValues'),{keyValue:value,value},201);assert.equal((await request('GET',pathFor('UuidValues')+'?value='+value)).json.data[0].value,value);}
        await request('GET',pathFor('UuidValues')+'/bad',undefined,400);
        for(let i=0;i<4;i++) {
            const sName='Source'+i,tName='Target'+i,s=(await request('POST',pathFor(sName),{},201)).json.data,t=(await request('POST',pathFor(tName),{targetKey:'target '+i},201)).json.data;
            const rel=admission.context.plan.relations.find(r=>r.sourceEntityId===admission.context.byName.get(sName).id),r=rel.storage;
            const get=pathFor(sName)+'/'+s.sourceKey+'/'+rel.names.segment;
            const empty=(await request('GET',get,undefined,rel.http.many?200:404)).json;
            if(rel.http.many)assert.deepEqual(empty.data,[]);
            if(r.kind==='junction') {
                const association=get+'/'+encodeURIComponent(t.targetKey);await request('POST',association,undefined,201);await request('POST',association,undefined,409);
                assert.equal((await request('GET',get)).json.data[0].targetKey,t.targetKey);await request('DELETE',association);await request('DELETE',association);
                await request('POST',get+'/absent',undefined,409);await request('POST',pathFor(sName)+'/bad/'+rel.names.segment+'/'+encodeURIComponent(t.targetKey),undefined,400);
            } else {
                const receiver=admission.context.byId.get(r.receiverEntityId),field=receiver.fields.find(f=>f.id===r.fieldId).name,key=receiver.fields.find(f=>f.id===receiver.key.fieldId).name;
                await db.client.query('UPDATE '+names.table(receiver.names.table)+' SET '+names.quoteIdentifier(field)+'=$1 WHERE '+names.quoteIdentifier(key)+'=$2',[receiver.sourceName===sName?t.targetKey:s.sourceKey,receiver.sourceName===sName?s.sourceKey:t.targetKey]);
                const related=(await request('GET',get)).json.data;assert.equal((rel.http.many?related[0]:related).targetKey,t.targetKey);
            }
        }
        for(let i=0;i<4;i++) {
            const sourceName='U'+i,targetName='V'+i,s=(await request('POST',pathFor(sourceName),{},201)).json.data,t=(await request('POST',pathFor(targetName),{targetKey:uuidValues[i]},201)).json.data;
            const rel=admission.context.plan.relations.find(r=>r.sourceEntityId===admission.context.byName.get(sourceName).id),r=rel.storage;
            const get=pathFor(sourceName)+'/'+s.sourceKey+'/'+rel.names.segment;
            if(r.kind==='junction'){await request('POST',get+'/'+t.targetKey,undefined,201);await request('POST',get+'/bad',undefined,400);}
            else {
                const receiver=admission.context.byId.get(r.receiverEntityId),field=receiver.fields.find(f=>f.id===r.fieldId).name,key=receiver.fields.find(f=>f.id===receiver.key.fieldId).name;
                await db.client.query('UPDATE '+names.table(receiver.names.table)+' SET '+names.quoteIdentifier(field)+'=$1 WHERE '+names.quoteIdentifier(key)+'=$2',[receiver.sourceName===sourceName?t.targetKey:s.sourceKey,receiver.sourceName===sourceName?s.sourceKey:t.targetKey]);
            }
            const result=(await request('GET',get)).json.data,value=rel.http.many?result[0]:result;assert.equal(value.targetKey,uuidValues[i]);assert.equal(value.day,'9999-12-31');assert.equal(value.moment,'2038-01-19T03:14:07Z');
        }
        // Real database errors crossing the generated HTTP/model boundary.
        await request('POST',scalarPath,{textValue:values.textValue},409);
        await request('POST',pathFor('Generated'),{identity:2147483648},400);
        await request('POST',pathFor('Ordinary'),{textValue:'x'.repeat(256)},400);
        await request('POST',pathFor('Ordinary'),{realValue:3.5e38},400);
        await request('POST',pathFor('Ordinary'),{textValue:'NUL\0value'},400);
        await request('POST',pathFor('Bound'),{},201);await request('POST',pathFor('Bound'),{},201);await request('POST',pathFor('Bound'),{},400);
        const generated=admission.context.physical.tables.find(t=>t.name==='Generated').columns.find(c=>c.identity);
        const sequenceBefore=(await db.client.query('SELECT last_value,is_called FROM '+names.table(generated.sequenceName))).rows[0];
        const future=Number(sequenceBefore.last_value)+1;await request('POST',pathFor('Generated'),{identity:future},201);
        assert.deepEqual((await db.client.query('SELECT last_value,is_called FROM '+names.table(generated.sequenceName))).rows[0],sequenceBefore);
        await request('POST',pathFor('Generated'),{},409);
        // SQLSTATE data matrix independently triggers actual native rejections.
        const cases=[['23505','INSERT INTO "public"."Scalars" DEFAULT VALUES',undefined,409],['23503','INSERT INTO "public"."Source3_Target3" VALUES ($1,$2)',['00000000-0000-0000-0000-000000000000','absent'],409],['23502','INSERT INTO "public"."TextKey" DEFAULT VALUES'],['23514','INSERT INTO "public"."Scalars" ("choice") VALUES ($1)', ['unknown']],['22P02','INSERT INTO "public"."Ordinary" ("realValue") VALUES ($1)', ['invalid']],['22003','INSERT INTO "public"."Ordinary" ("realValue") VALUES ($1)', ['1e39']],['22001','INSERT INTO "public"."Ordinary" ("textValue") VALUES ($1)', ['x'.repeat(256)]],['22007','SELECT $1::date',['not-date']],['22008','SELECT $1::date',['2000-02-30']],['22021','INSERT INTO "public"."Ordinary" ("textValue") VALUES ($1)', ['NUL\0value']]];
        for(const [code,sql,params,status=400] of cases)await assert.rejects(db.client.query(sql,params),e=>{nativeErrors++;return e.code===code&&taxonomy.classify(e,'write').status===status&&taxonomy.classify(e,'read').status===500;});
        await temporaryErrors(db.config);
        await db.client.query('ALTER TABLE "public"."Ordinary" RENAME TO "TemporarilyRenamed"');await request('GET',pathFor('Ordinary'),undefined,500);await db.client.query('ALTER TABLE "public"."TemporarilyRenamed" RENAME TO "Ordinary"');
        // Terminate only an active generated-backend connection in this owned database.
        await db.client.query('BEGIN');await db.client.query('LOCK TABLE "public"."Ordinary" IN ACCESS EXCLUSIVE MODE');
        try {
            const pending=request('GET',pathFor('Ordinary'),undefined,503);
            let pid;for(let i=0;i<30;i++){const result=await session.admin.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND application_name='apiforge-postgresql-18-v1' AND wait_event_type='Lock'",[db.name]);if(result.rowCount){pid=result.rows[0].pid;break;}await delay(20);}
            assert(pid);await session.admin.query('SELECT pg_terminate_backend($1)',[pid]);await pending;
        }finally{await db.client.query('ROLLBACK');}
        await request('GET',pathFor('Ordinary'));
        // Raw malformed JSON uses the generated global handler.
        const malformed=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:scalarPath,method:'POST',headers:{'Content-Type':'application/json'}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end('{bad');});assert.equal(malformed.status,400);assert.equal(JSON.parse(malformed.body).error,'Request body must contain valid JSON.');
        const swagger=JSON.parse(files.find(f=>f.path==='swagger.json').content);for(const e of admission.context.plan.entities)assert(swagger.paths[e.names.resourcePath]);
        assert.deepEqual(Object.keys(JSON.parse(files.find(f=>f.path==='package.json').content).dependencies),['dotenv','express','pg']);
        assert(!fs.existsSync(path.join(project,'.env')),'credentials never written');
        console.log(JSON.stringify({gate:'D',profile:session.profile,pgVersion,files:files.length,entities:admission.context.plan.entities.length,requests,nativeErrors,restrictedRole:true,unrelatedTable:unrelated,missingPrivilege:'sanitized 500',identityWithoutSequenceGrants:true,varchar,declaredMaxLength:'pre-DB 400',result:'PASS'}));
    } finally {
        try{if(state)await h.stopProcessTree(state);if(port)await h.assertPortReleased(port);}finally{
            try{if(db)await db.close();}finally{await session.cleanup();if(project)h.removeTemporaryDirectory(project);assert.deepEqual(h.snapshotDirectory(path.resolve(__dirname,'../output')),outputBefore);}
        }
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
