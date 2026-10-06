'use strict';
const assert=require('assert/strict'),vm=require('vm');
const {nativeSession,admit,privatePublicTable}=require('./postgres-native-helpers');
const {keys,scalars,relations,uuidRelations}=require('./postgres-target-cases');
const Codegen=require('../src/codegen/codegen');
const names=require('../src/targets/postgres/names');
const taxonomy=require('../src/targets/postgres/errors');
function loadModule(source,requireModule,processValue=process) {
    const module={exports:{}};vm.compileFunction(source,['require','module','exports','process'])(requireModule,module,module.exports,processValue);return module.exports;
}
function loadConfig(source,config) {
    return loadModule(source,name=>name==='dotenv'?{config(){}}:require(name),{env:{DB_HOST:config.host,DB_PORT:String(config.port),DB_USER:config.user,DB_PASSWORD:config.password,DB_NAME:config.database}});
}
module.exports={loadModule,loadConfig};
async function main(){
    const session=await nativeSession();let db,pool;let queries=0;
    try {
        db=await session.database();
        const source=[scalars,...keys.map(([name,key])=>'ENTITY '+name+' '+key),...relations,...uuidRelations,
            'ENTITY Bounded keyValue INT PRIMARY KEY MIN 0 MAX 4',
            'ENTITY RequiredUuid keyValue UUID PRIMARY KEY REQUIRED',
            'ENTITY StaticString keyValue STRING PRIMARY KEY DEFAULT "fixed" value STRING DEFAULT "hidden"',
            'ENTITY Limited textValue STRING MAX_LENGTH 255',
            'ENTITY TemporalFields value STRING day DATE moment TIMESTAMP',
            'ENTITY TemporalSource keyValue UUID PRIMARY KEY day DATE moment TIMESTAMP ENTITY TemporalTarget keyValue UUID PRIMARY KEY day DATE moment TIMESTAMP RELATION TemporalSource relatedTemporal TemporalTarget ONE_TO_MANY'].join('\n');
        const admission=admit(source),files=Codegen.generate(admission.ir,false,{target:'postgres'}).files;
        for(const f of files.filter(f=>f.path.endsWith('.js')))new vm.Script(f.content,{filename:f.path});
        await db.client.query(files.find(f=>f.path==='database/schema.sql').content);
        const application=await session.restrictedApplication(db,admission.context.physical);
        const unrelated=await privatePublicTable(db,application);
        pool=loadConfig(files.find(f=>f.path==='config/db.js').content,application);
        const trackedDb={query:(...args)=>{queries++;return pool.query(...args);}};
        const models=Object.fromEntries(files.filter(f=>f.path.startsWith('models/')).map(f=>[f.path.slice(7,-3),loadModule(f.content,name=>name==='../config/db'?trackedDb:require(name))]));
        assert.equal((await pool.query('SELECT current_user AS role')).rows[0].role,application.user);
        // Revoke on a junction, then query another entity: the full inventory is checked.
        await db.client.query('REVOKE DELETE ON TABLE "public"."Source3_Target3" FROM '+names.quoteIdentifier(application.user));
        await assert.rejects(models.Implicit.findById(0),e=>e.message==='Unsupported PostgreSQL deployment profile.');
        await db.client.query('GRANT DELETE ON TABLE "public"."Source3_Target3" TO '+names.quoteIdentifier(application.user));
        assert.equal(await models.Implicit.findById(0),null);
        await db.client.query('ALTER TABLE "public"."Implicit" RENAME TO "implicit"');
        await assert.rejects(pool.query('SELECT 1'),e=>e.message==='Unsupported PostgreSQL deployment profile.');
        await db.client.query('ALTER TABLE "public"."implicit" RENAME TO "Implicit"');
        for(const [name] of keys) {
            const m=models[name];let created;
            if(name==='TextKey')await assert.rejects(m.create({}),e=>e.code==='23502');
            else {created=await m.create({});assert(!Object.hasOwn(created,'value'));}
            const field=name==='Implicit'?'id':'identity';
            if(created) {
                const stored=(await db.client.query('SELECT '+names.quoteIdentifier(field)+'::text AS key FROM '+names.table(name))).rows[0].key;
                assert.equal(stored,String(created[field]));assert(await m.findById(created[field]));assert(await m.update(created[field],{}));
                await assert.rejects(m.update(created[field],{[field]:created[field]}),/immutable/);
                assert(await m.delete(created[field]));assert.equal(await m.delete(created[field]),false);assert.equal(await m.findById(created[field]),null);
            }
            const supplied=['RuntimeUuid','StaticUuid'].includes(name)?'123e4567-e89b-12d3-a456-426614174000':name==='TextKey'?"x'; DROP TABLE public.Scalars;--":0;
            const input={[field]:supplied};const before=structuredClone(input);const result=await m.create(input);assert.equal(result[field],supplied);assert.deepEqual(input,before);await m.delete(supplied);
            if(['Implicit','Generated','RuntimeUuid'].includes(name)) {const input={[field]:null};const result=await m.create(input);assert.notEqual(result[field],null);assert.deepEqual(input,{[field]:null});await m.delete(result[field]);}
            else await assert.rejects(m.create({[field]:null}),e=>e.code==='23502');
        }
        const seq=admission.context.physical.tables.find(t=>t.name==='Generated').columns.find(c=>c.identity).sequenceName;
        const sequenceState=async()=>(await db.client.query('SELECT last_value,is_called FROM '+names.table(seq))).rows[0];
        const sequenceBefore=await sequenceState();
        const zero=await models.Generated.create({identity:0});assert.equal(zero.identity,0);
        assert.equal((await db.client.query('SELECT "identity" FROM "public"."Generated" WHERE "identity"=0')).rows[0].identity,0);
        const supplied=await models.Generated.create({identity:1});assert.equal(supplied.identity,1);
        const negative=await models.Generated.create({identity:-1});assert.equal(negative.identity,-1);await models.Generated.delete(-1);
        assert.deepEqual(await sequenceState(),sequenceBefore,'supplied zero/positive leave sequence untouched');
        const future=Number(sequenceBefore.last_value)+1;await models.Generated.create({identity:future});
        assert.deepEqual(await sequenceState(),sequenceBefore);
        await assert.rejects(models.Generated.create({}),e=>e.code==='23505'&&taxonomy.classify(e,'write').status===409);
        await models.Generated.delete(1);await models.Generated.delete(future);
        for(const [name,field,value] of [['Generated','identity',15],['Implicit','id',16]]) {
            const input={[field]:String(value)},before=JSON.stringify(input);
            const created=await models[name].create(input);
            assert.equal(created[field],value,'generated DB identity resolves the native INTEGER, including trusted coercions');
            assert.equal((await db.client.query('SELECT '+names.quoteIdentifier(field)+' FROM '+names.table(name)+' WHERE '+names.quoteIdentifier(field)+'=$1',[value])).rows[0][field],value);
            assert.equal(JSON.stringify(input),before);await models[name].delete(value);
        }
        const optional=await models.RuntimeUuid.create({identity:null});assert.match(optional.identity,/^[0-9a-f-]{36}$/);
        const varchar=[];
        for(const [label,value] of [['255 non-space','x'.repeat(255)],['256 non-space','x'.repeat(256)],['255 + 1 space','x'.repeat(255)+' '],['255 + 4 spaces','x'.repeat(255)+'    ']]) {
            const input={value},before=structuredClone(input);
            if(label==='256 non-space') {
                await assert.rejects(models.Implicit.create(input),e=>e.code==='22001');
                varchar.push({case:label,inputLength:value.length,sqlstate:'22001'});
            } else {
                const created=await models.Implicit.create(input);
                assert.equal(created.value,value,'create echoes the submitted STRING');
                const stored=(await db.client.query('SELECT "value" FROM "public"."Implicit" WHERE "id"=$1',[created.id])).rows[0].value;
                assert.equal(stored,'x'.repeat(255));assert.equal((await models.Implicit.findById(created.id)).value,stored);
                varchar.push({case:label,inputLength:value.length,echoLength:created.value.length,storedLength:stored.length});
                await models.Implicit.delete(created.id);
            }
            assert.deepEqual(input,before);
        }
        const stringDefault=await models.StaticString.create({});assert.deepEqual(stringDefault,{keyValue:'fixed'});assert.equal((await models.StaticString.findById('fixed')).value,'hidden');
        for(const excess of [1,4]) {
            const textValue='x'.repeat(255)+' '.repeat(excess),created=await models.Limited.create({textValue});
            assert.equal(created.textValue,textValue,'trusted model leaves declared scalar length to PG');
            assert.equal((await db.client.query('SELECT "textValue" FROM "public"."Limited" WHERE "id"=$1',[created.id])).rows[0].textValue,'x'.repeat(255));
            await models.Limited.delete(created.id);
        }
        await assert.rejects(models.RequiredUuid.create({keyValue:null}),/UUID/);
        const empty=await models.Scalars.create({});assert.deepEqual(Object.keys(empty),['identity']);
        const actual=await models.Scalars.findById(empty.identity);assert.equal(actual.choice,'trailing ');assert.equal(actual.day,'2000-02-29');assert.equal(actual.moment,'2000-02-29T12:34:56Z');assert.equal(actual.flag,false);assert.equal(actual.realValue,1.5);assert.equal(actual.token,'ffffffff-ffff-ffff-ffff-ffffffffffff');
        const data=JSON.parse('{"textValue":"quoted value","__proto__":"own","constructor":"own constructor","prototype":"own prototype","choice":"a\\\\b","day":"1000-01-01","moment":"1970-01-01T00:00:01Z"}');
        const before=JSON.stringify(data);const row=await models.Scalars.create(data);assert.equal(JSON.stringify(data),before);
        const own=await models.Scalars.findById(row.identity);for(const field of ['__proto__','constructor','prototype']){assert(Object.hasOwn(own,field));assert.equal(own[field],data[field]);}assert.equal(Object.getPrototypeOf(own),Object.prototype);
        const updated=await models.Scalars.update(row.identity,{textValue:"bound ' value",realValue:3.5,flag:true,day:'9999-12-31',moment:'2038-01-19T03:14:07Z'});assert.equal(updated.flag,true);assert.equal(updated.day,'9999-12-31');assert.equal(updated.moment,'2038-01-19T03:14:07Z');
        for(const key of ['bad\0name','\ud800','\udc00','x'.repeat(64)]) {
            const count=queries;await assert.rejects(models.Implicit.create({[key]:1}),/identifier/);await assert.rejects(models.Implicit.update(0,{[key]:1}),/identifier/);assert.equal(queries,count);
        }
        await assert.rejects(models.Implicit.create({validUnknown:1}),e=>e.code==='42703'&&taxonomy.classify(e,'write').status===500);
        await assert.rejects(models.Implicit.create({'value" = 1; DROP TABLE "Scalars"; --':1}),e=>e.code==='42703');
        assert(await models.Scalars.findById(empty.identity));
        for(const invalid of [{day:'2000-02-30'},{moment:'2000-01-01T00:00:00+00:00'},{token:'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'}]) {const count=queries;await assert.rejects(models.Scalars.create(invalid));assert.equal(queries,count);}
        for(const choice of ['z','A','é',"a'",'a\\b','',' leading','trailing '])await models.Scalars.create({textValue:'enum '+choice,choice});
        const options=models.Scalars.parseQuery({sort:'choice',order:'asc',page:'1',limit:'100'});const sorted=await models.Scalars.findAll(options);assert.equal(sorted.at(-1).choice,'trailing ');assert.equal(sorted[0].choice,'z');assert.equal(await models.Scalars.countFiltered(options),sorted.length);
        for(const [field,value] of [['choice','trailing '],['day','2000-02-29'],['moment','2000-02-29T12:34:56Z'],['token','ffffffff-ffff-ffff-ffff-ffffffffffff'],['flag','false'],['integerValue','4'],['realValue','1.5'],['textValue',"A'\\B"]])assert((await models.Scalars.findAll(models.Scalars.parseQuery({[field]:value}))).length);
        for(const invalid of [{sort:'value; DROP TABLE x'},{order:'desc'},{page:'0'},{token:'bad'},{day:'infinity'},{moment:'2000-01-01T00:00:00.1Z'},{integerValue:'1.1'}]){const count=queries;assert.throws(()=>models.Scalars.parseQuery(invalid));assert.equal(queries,count);}
        for(let i=0;i<4;i++) {
            const source=models['Source'+i],target=models['Target'+i];const s=await source.create({}),t=await target.create({targetKey:'target '+i});const relation=admission.context.plan.relations.find(r=>r.sourceEntityId===admission.context.byName.get('Source'+i).id),r=relation.storage;
            const getter=relation.names.getter;
            if(r.kind==='junction'){assert.deepEqual(await source[getter](s.sourceKey),[]);await source[relation.names.add](s.sourceKey,t.targetKey);assert.equal((await source[getter](s.sourceKey))[0].targetKey,t.targetKey);assert(await source[relation.names.remove](s.sourceKey,t.targetKey));assert.equal(await source[relation.names.remove](s.sourceKey,t.targetKey),false);}
            else {
                assert.deepEqual(await source[getter](s.sourceKey),relation.http.many?[]:null);
                const receiver=r.receiverEntityId===relation.sourceEntityId?source:target;const identity=receiver===source?s.sourceKey:t.targetKey;
                const field=admission.context.byId.get(r.receiverEntityId).fields.find(f=>f.id===r.fieldId).name;
                await receiver.update(identity,{[field]:receiver===source?t.targetKey:s.sourceKey});
                const related=await source[getter](s.sourceKey);assert.equal((relation.http.many?related[0]:related).targetKey,t.targetKey);
                if(i===0){await source.delete(s.sourceKey);assert.equal((await target.findById(t.targetKey))[field],null);}
                if(i===2){await source.delete(s.sourceKey);assert.equal(await target.findById(t.targetKey),null);}
            }
        }
        const uuids=['00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff','123e4567-e89b-12d3-a456-426614174000','123e4567-e89b-72d3-a456-426614174000'];
        for(let i=0;i<4;i++) {
            const source=models['U'+i],target=models['V'+i],s=await source.create({}),t=await target.create({targetKey:uuids[i]});
            const rel=admission.context.plan.relations.find(r=>r.sourceEntityId===admission.context.byName.get('U'+i).id),r=rel.storage;
            if(r.kind==='junction')await source[rel.names.add](s.sourceKey,t.targetKey);
            else {const receiver=r.receiverEntityId===rel.sourceEntityId?source:target,field=admission.context.byId.get(r.receiverEntityId).fields.find(f=>f.id===r.fieldId).name;await receiver.update(receiver===source?s.sourceKey:t.targetKey,{[field]:receiver===source?t.targetKey:s.sourceKey});}
            const related=await source[rel.names.getter](s.sourceKey),value=rel.http.many?related[0]:related;
            assert.equal(value.targetKey,uuids[i]);assert.equal(value.day,'9999-12-31');assert.equal(value.moment,'2038-01-19T03:14:07Z');
            assert.equal((await target.findAll(target.parseQuery({day:'9999-12-31',moment:'2038-01-19T03:14:07Z'}))).length,1);
        }
        // Numeric-offset parsers are exercised with real values under non-UTC sessions.
        const configSource=files.find(f=>f.path==='config/db.js').content;
        let captured;loadModule(configSource,name=>name==='dotenv'?{config(){}}:{types:require('pg').types,Pool:class {constructor(options){captured=options.types;}on(){}}},{env:{}});
        for(const timezone of ['UTC','Asia/Kolkata','America/New_York','Pacific/Kiritimati']) {
            await db.client.query('SET TIME ZONE '+"'"+timezone+"'");
            const {rows:[raw]}=await db.client.query("SELECT DATE '2000-02-29'::text AS day,TIMESTAMPTZ '1970-01-01T00:00:01Z'::text AS minimum,TIMESTAMPTZ '2038-01-19T03:14:07Z'::text AS maximum");
            assert.equal(captured.getTypeParser(1082,'text')(raw.day),'2000-02-29');assert.equal(captured.getTypeParser(1184,'text')(raw.minimum),'1970-01-01T00:00:01Z');assert.equal(captured.getTypeParser(1184,'text')(raw.maximum),'2038-01-19T03:14:07Z');
        }
        for(const value of ['infinity','-infinity','2000-01-01 00:00:00.000+00','9999-01-01 00:00:00+00','2000-01-01 00:00:00 UTC'])assert.throws(()=>captured.getTypeParser(1184,'text')(value));
        assert.equal(captured.getTypeParser(1114,'text')('2000-01-01 00:00:00'),'2000-01-01T00:00:00Z');
        for(const value of ['2000-01-01 05:00:00+05','2000-01-01 05:30:00+0530','2000-01-01 05:30:15+05:30:15'])assert.equal(captured.getTypeParser(1184,'text')(value),'2000-01-01T00:00:00Z');
        assert.equal(captured.getTypeParser(20,'text')('9007199254740993'),'9007199254740993');
        const countModel=loadModule(files.find(f=>f.path==='models/Implicit.js').content,name=>name==='../config/db'?{query:async()=>({rows:[{total:'9007199254740993'}]})}:require(name));
        await assert.rejects(countModel.countFiltered({}),/Invalid collection count/);
        const dbResult=await pool.query("SELECT current_setting('TimeZone') AS timezone,current_setting('DateStyle') AS style,current_setting('standard_conforming_strings') AS strings,current_setting('search_path') AS path,current_setting('application_name') AS application");
        assert.deepEqual(dbResult.rows[0],{timezone:'UTC',style:'ISO, YMD',strings:'on',path:'pg_catalog, public',application:'apiforge-postgresql-18-v1'});
        // External expanded/infinite native values fail returned-value normalization.
        const temporalTable=admission.context.physical.tables.find(t=>t.name==='TemporalFields');
        for(const c of temporalTable.constraints.filter(c=>c.kind==='ck'))await db.client.query('ALTER TABLE "public"."TemporalFields" DROP CONSTRAINT '+names.quoteIdentifier(c.name));
        for(const [column,value] of [['day','infinity'],['day','0999-01-01'],['moment','infinity'],['moment','2040-01-01T00:00:00Z']]) {
            const {rows:[record]}=await db.client.query('INSERT INTO "public"."TemporalFields" ('+names.quoteIdentifier(column)+') VALUES ($1) RETURNING "id"',[value]);
            await assert.rejects(models.TemporalFields.findById(record.id),/PostgreSQL/);await models.TemporalFields.delete(record.id);
        }
        console.log(JSON.stringify({gate:'C',profile:session.profile,entities:Object.keys(models).length,files:files.length,queries,restrictedRole:true,unrelatedTable:unrelated,missingPrivilege:'rejected',missingExactTable:'rejected',identityWithoutSequenceGrants:true,varchar,result:'PASS'}));
    } finally {try{if(pool)await pool.end();}finally{try{if(db)await db.close();}finally{await session.cleanup();}}}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
