'use strict';
// Preserve the exact reviewed-tip failure and native VARCHAR observations.
const assert=require('assert/strict');
const {nativeSession,admit,privatePublicTable}=require('./postgres-native-helpers');
const {createPinnedCompiler}=require('./pinned-compiler-loader');
const {loadConfig,loadModule}=require('./postgres-runtime.test');
const names=require('../src/targets/postgres/names');
const REVIEWED='fdcf9cb4a6242c9cfb61d8a0ebf8c29bf3d2e2c2';
(async()=>{
    const session=await nativeSession();let db,pool;
    try {
        db=await session.database();
        const admission=admit('ENTITY Witness value STRING');
        const old=createPinnedCompiler({revision:REVIEWED});
        const files=old.compiler.Codegen.generate(admission.ir,false,{target:'postgres'}).files;
        await db.client.query(files.find(f=>f.path==='database/schema.sql').content);
        const application=await session.restrictedApplication(db,admission.context.physical);
        pool=loadConfig(files.find(f=>f.path==='config/db.js').content,application);
        const model=loadModule(files.find(f=>f.path==='models/Witness.js').content,name=>name==='../config/db'?pool:require(name));
        const first=await model.create({value:'before unrelated table'});assert(Number.isInteger(first.id));
        const unrelated=await privatePublicTable(db,application);
        await assert.rejects(model.findById(first.id),e=>e.message==='Unsupported PostgreSQL deployment profile.');
        const matrix=[];
        for(const [label,value] of [['255 non-space','x'.repeat(255)],['256 non-space','x'.repeat(256)],['255 + 1 space','x'.repeat(255)+' '],['255 + 4 spaces','x'.repeat(255)+'    ']]) {
            if(label==='256 non-space') {
                await assert.rejects(db.client.query('INSERT INTO "public"."Witness" ("value") VALUES ($1)',[value]),e=>e.code==='22001');
                matrix.push({case:label,inputLength:value.length,sqlstate:'22001'});
            } else {
                const {rows:[key]}=await db.client.query('INSERT INTO "public"."Witness" ("value") VALUES ($1) RETURNING "id"',[value]);
                const {rows:[row]}=await db.client.query('SELECT "value" FROM "public"."Witness" WHERE "id"=$1',[key.id]);
                assert.equal(row.value,'x'.repeat(255));matrix.push({case:label,inputLength:value.length,storedLength:row.value.length,storedExactly255:true});
            }
        }
        console.log(JSON.stringify({reviewed:REVIEWED,profile:session.profile,database:db.name,applicationRole:application.user,restrictedRole:true,identityWithoutSequenceGrants:true,unrelatedTable:unrelated,error:'Unsupported PostgreSQL deployment profile.',varchar:matrix,result:'REPRODUCED'}));
    } finally {try{if(pool)await pool.end();}finally{try{if(db)await db.close();}finally{await session.cleanup();}}}
})().catch(error=>{console.error(error);process.exitCode=1;});
