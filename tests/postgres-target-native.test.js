'use strict';
const assert=require('assert/strict');
const {nativeSession,admit}=require('./postgres-native-helpers');
const {keys,scalars,relations,uuidRelations}=require('./postgres-target-cases');
const ddl=require('../src/targets/postgres/ddl');
const names=require('../src/targets/postgres/names');
let tables=0,columns=0,constraints=0,indexes=0,sequences=0,checks=0,checkEvaluations=0;
async function inspect(client,physical) {
    for(const t of physical.tables) {
        tables++;
        const native=(await client.query(`SELECT a.attname,a.attnum,a.attnotnull,a.attidentity,format_type(a.atttypid,a.atttypmod) AS type,
            co.collname,pg_get_expr(d.adbin,d.adrelid) AS default_expression,n.nspname
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
            WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[t.name])).rows;
        assert.equal(native.length,t.columns.length);
        for(const [i,c] of t.columns.entries()) {
            columns++;const actual=native[i];assert.equal(actual.attname,c.name);assert.equal(actual.attnum,i+1);assert.equal(actual.nspname,'public');
            const expected={INT:'integer',STRING:'character varying('+ddl.capacity(c.typeSource)+')',FLOAT:'real',BOOLEAN:'boolean',ENUM:'text',DATE:'date',TIMESTAMP:'timestamp(0) with time zone',UUID:'uuid'}[c.dataType];
            assert.equal(actual.type,expected);assert.equal(actual.attnotnull,!c.nullable);assert.equal(actual.attidentity,c.identity?'d':'');
            if(['STRING','ENUM'].includes(c.dataType))assert.equal(actual.collname,'C');
            assert.equal(actual.default_expression!==null,!!c.defaultValue);
            if(c.defaultValue) {
                const expression='('+actual.default_expression+')::'+actual.type;
                const parsed=(await client.query('SELECT '+(['DATE','TIMESTAMP'].includes(c.dataType)?'to_char('+expression+", '"+(c.dataType==='DATE'?'YYYY-MM-DD':'YYYY-MM-DD"T"HH24:MI:SS"Z"')+"')":expression)+' AS value')).rows[0].value;
                const original=c.defaultValue.value;
                assert.equal(parsed,original);
            }
            if(c.identity) {
                sequences++;const seq=(await client.query(`SELECT c.relname,n.nspname,s.seqstart,s.seqincrement,s.seqmin,s.seqmax,format_type(s.seqtypid,NULL) AS type,
                    dep.deptype, a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
                    JOIN pg_depend dep ON dep.objid=c.oid AND dep.classid='pg_class'::regclass AND dep.refobjid=$1::regclass
                    JOIN pg_attribute a ON a.attrelid=dep.refobjid AND a.attnum=dep.refobjsubid WHERE c.relname=$2`,[names.table(t.name),c.sequenceName])).rows;
                assert.equal(seq.length,1);assert.equal(seq[0].nspname,'public');assert.equal(seq[0].deptype,'i');assert.equal(seq[0].attname,c.name);
                assert.equal(seq[0].seqstart,'1');assert.equal(seq[0].seqincrement,'1');assert.equal(seq[0].seqmin,'1');assert.equal(seq[0].seqmax,'2147483647');assert.equal(seq[0].type,'integer');
            }
        }
        const cons=(await client.query(`SELECT pc.conname,pc.contype,pc.conkey,pc.confkey,pc.confdeltype,pc.confrelid::regclass::text AS reference,rn.nspname AS reference_schema,pc.convalidated,pg_get_constraintdef(pc.oid) AS definition
            FROM pg_constraint pc LEFT JOIN pg_class rc ON rc.oid=pc.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE pc.conrelid=$1::regclass`,[names.table(t.name)])).rows;
        assert.equal(cons.length,t.constraints.length+t.foreignKeys.length);
        for(const c of [...t.constraints,...t.foreignKeys]) {
            constraints++;assert(names.identifierIssue(c.name)===null);
            const actual=cons.find(x=>x.conname===c.name);assert(actual,'missing native '+c.name);assert(actual.convalidated);
            assert.equal(actual.contype,{pk:'p',uq:'u',nn:'n',ck:'c'}[c.kind]||'f');
            assert.deepEqual(actual.conkey,c.fieldIds.map(id=>t.columns.findIndex(col=>col.id===id)+1));
            if(!c.kind) {assert.equal(actual.confdeltype,c.onDelete==='cascade'?'c':'n');assert.equal(actual.reference,'"'+c.referencedTable+'"');assert.equal(actual.reference_schema,'public');const referenced=physical.tables.find(t=>t.name===c.referencedTable);assert.deepEqual(actual.confkey,c.referencedFieldIds.map(id=>referenced.columns.findIndex(col=>col.id===id)+1));}
            if(c.kind==='ck'){
                checks++;assert.match(actual.definition,/^CHECK \(/);
                const column=t.columns.find(col=>col.id===c.fieldIds[0]);
                let cases=[],type;
                if(c.purpose==='membership'){type='text COLLATE "C"';cases=[...column.enumValues.map(v=>[v,true]),['undeclared member',false]];}
                else if(c.purpose==='finite'){type='real';cases=[['1.5',true],['NaN',false],['Infinity',false],['-Infinity',false]];}
                else if(c.purpose==='date_range'){type='date';cases=[['1000-01-01',true],['9999-12-31',true],['0999-12-31',false],['10000-01-01',false],['infinity',false],['-infinity',false]];}
                else if(c.purpose==='timestamp_range'){type='timestamptz';cases=[['1970-01-01T00:00:01Z',true],['2038-01-19T03:14:07Z',true],['1970-01-01T00:00:00Z',false],['2038-01-19T03:14:08Z',false],['infinity',false],['-infinity',false]];}
                else {
                    const validation=column.validations.find(v=>v.type===c.purpose);assert(validation);
                    const minimum=['MIN','MIN_LENGTH'].includes(validation.type),length=validation.type.includes('LENGTH');
                    type=length?'text':column.dataType==='INT'?'integer':'real';
                    const bound=validation.value,outside=bound+(minimum?-1:1);
                    cases=[[length?'é'.repeat(bound):bound,true],[length?'é'.repeat(Math.max(0,outside)):outside,false]];
                }
                // Evaluate the native catalog expression itself, using independent
                // logical boundary witnesses. No SQL/text normalization hides differences.
                const expression=actual.definition.slice('CHECK ('.length,-1);
                for(const [value,expected] of [...cases,[null,null]]) {
                    const result=(await client.query('WITH witness AS (SELECT $1::'+type+' AS '+names.quoteIdentifier(column.name)+') SELECT '+expression+' AS accepted FROM witness',[value])).rows[0].accepted;
                    assert.equal(result,expected,t.name+'.'+column.name+' '+c.purpose+' '+JSON.stringify(value));checkEvaluations++;
                }
            }
        }
        const ix=(await client.query(`SELECT c.relname,i.indisunique,i.indisvalid,i.indisready,i.indpred,i.indexprs,i.indkey::text,am.amname,n.nspname,pg_get_indexdef(c.oid) AS definition
            FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=$1::regclass`,[names.table(t.name)])).rows;
        assert.equal(ix.length,t.indexes.length);
        for(const i of t.indexes) {
            indexes++;const actual=ix.find(x=>x.relname===i.name);assert(actual);assert.equal(actual.nspname,'public');assert.equal(actual.amname,'btree');
            assert.equal(actual.indisunique,i.unique);assert(actual.indisvalid&&actual.indisready);assert.equal(actual.indpred,null);assert.equal(actual.indexprs,null);
            assert.deepEqual(actual.indkey.split(' ').map(Number),i.fieldIds.map(id=>t.columns.findIndex(c=>c.id===id)+1));
        }
    }
    const relationNames=(await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows.map(r=>r.relname).sort();
    assert.deepEqual(relationNames,physical.relations.map(r=>r.name).sort());
}
(async()=>{
    const session=await nativeSession();
    try {
        const sources=[scalars,...keys.map(([name,key])=>'ENTITY '+name+' '+key),...relations,...uuidRelations,
            'ENTITY LeftSide leftKey INT PRIMARY KEY ENTITY RightSide rightKey INT PRIMARY KEY RELATION LeftSide rightItems RightSide ONE_TO_MANY RELATION RightSide leftItem LeftSide ONE_TO_ONE',
            'ENTITY Order keyValue STRING PRIMARY KEY value INT ENTITY MixedCase value STRING',
            'ENTITY Exact value INT Value INT Id INT',
            'ENTITY Bounded keyValue INT PRIMARY KEY MIN 0 MAX 9',
            'ENTITY Width keyValue STRING PRIMARY KEY MAX_LENGTH 669'];
        sources.push('ENTITY constructor __proto__ STRING prototype STRING','ENTITY StaticString keyValue STRING PRIMARY KEY DEFAULT "fixed" value STRING DEFAULT "hidden"');
        sources.push('ENTITY OffsetKey value UUID UNIQUE keyValue UUID PRIMARY KEY ENTITY OffsetTarget value UUID UNIQUE keyValue UUID PRIMARY KEY RELATION OffsetKey offsetRelated OffsetTarget ONE_TO_MANY');
        for(const source of sources) {
            const db=await session.database();try {const p=admit(source).context.physical;await db.client.query(ddl.renderSchema(p));await inspect(db.client,p);}finally{await db.close();}
        }
        // Names are checked against native behavior at exact UTF-8 boundaries.
        const db=await session.database();try {
            const base=admit('ENTITY Unicode value INT').candidate;
            for(const size of [62,63]) {
                const unicode='é'.repeat(30)+'a'.repeat(size-60);
                const p=require('../src/planning/effective-schema').projectDefinitions([{name:unicode,fields:base.definitions.entities[0].fields.map(f=>({...f,name:unicode}))}],[],{comparison:v=>v});
                const physical=ddl.physicalPlan(p);await db.client.query(ddl.renderSchema(physical));await inspect(db.client,physical);
                // Inspect compares the complete public namespace, so isolate each imported project.
                for(const t of physical.tables)await db.client.query('DROP TABLE '+names.table(t.name)+' CASCADE');
            }
            for(const size of [62,63]) {const name='a'.repeat(size);await db.client.query('CREATE TABLE '+names.table(name)+' ("v" integer)');assert.equal((await db.client.query('SELECT relname FROM pg_class WHERE relname=$1',[name])).rowCount,1);}
            assert(names.identifierIssue('a'.repeat(64)));assert(names.identifierIssue('é'.repeat(32)));
            const parts=Array.from({length:33},(_,i)=>'c'+i);
            await db.client.query('CREATE TABLE "public"."Parts" ('+parts.map(n=>names.quoteIdentifier(n)+' integer').join(',')+')');
            await db.client.query('CREATE INDEX "parts32" ON "public"."Parts" ('+parts.slice(0,32).map(names.quoteIdentifier).join(',')+')');
            await assert.rejects(db.client.query('CREATE INDEX "parts33" ON "public"."Parts" ('+parts.map(names.quoteIdentifier).join(',')+')'),e=>e.code==='54011');
            await db.client.query('CREATE TABLE "public"."Columns1600" ('+Array.from({length:1600},(_,i)=>'"c'+i+'" integer').join(',')+')');
            await assert.rejects(db.client.query('ALTER TABLE "public"."Columns1600" ADD COLUMN "overflow" integer'),e=>e.code==='54011');
            await db.client.query('CREATE TABLE "public"."VarcharMax" ("v" varchar(10485760))');
            await assert.rejects(db.client.query('CREATE TABLE "public"."VarcharOver" ("v" varchar(10485761))'),e=>e.code==='22023');
            // Actual uncompressible B-tree values bracket the native 2704 tuple limit.
            await db.client.query('CREATE TABLE "public"."Width" ("v" text COLLATE "C" UNIQUE)');
            const crypto=require('crypto');
            await db.client.query('INSERT INTO "public"."Width" VALUES ($1)',[crypto.randomBytes(1320).toString('hex')]);
            await assert.rejects(db.client.query('INSERT INTO "public"."Width" VALUES ($1)',[crypto.randomBytes(1360).toString('hex')]),e=>e.code==='54000');
        }finally{await db.close();}
        console.log(JSON.stringify({gate:'B',profile:session.profile,tables,columns,constraints,indexes,sequences,checks,checkEvaluations,result:'PASS'}));
    }finally{await session.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
