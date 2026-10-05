'use strict';
const names=require('./names');
const schema=require('../../planning/effective-schema');
const policy=require('../../planning/effective-policy');
const IR=require('../../ir/generator');
const neutralNames=require('../../utils/target-names');
const {numericIssues}=require('../numeric-policy');
const {createDiagnostic}=require('../../utils/diagnostics');
const LIMITS=Object.freeze({identifierBytes:63,columns:1600,indexColumns:32,varchar:10485760,blockSize:8192,btreeBytes:2704});
const q=names.quoteIdentifier, table=names.table;
const capacity=field=>Math.max(255,...(field.validations||[]).filter(v=>['MIN_LENGTH','MAX_LENGTH'].includes(v.type)).map(v=>v.value));
function literal(value) {
    if (typeof value==='string') {
        if (!names.validUnicode(value)||value.includes('\0')) throw new Error('PostgreSQL text must be well-formed Unicode without NUL.');
        return "'"+value.replace(/'/g,"''")+"'";
    }
    if (typeof value==='boolean') return value?'TRUE':'FALSE';
    if (typeof value==='number' && Number.isFinite(value)) return String(value);
    throw new Error('Unrepresentable PostgreSQL literal.');
}
function type(field) {
    const result={INT:'INTEGER',STRING:'VARCHAR('+capacity(field)+') COLLATE "C"',FLOAT:'REAL',BOOLEAN:'BOOLEAN',ENUM:'TEXT COLLATE "C"',DATE:'DATE',TIMESTAMP:'TIMESTAMPTZ(0)',UUID:'UUID'}[field.dataType];
    if (!result) throw new Error('Unsupported PostgreSQL datatype.');
    return result;
}
function maxIndexBytes(field) {
    if (field.dataType==='STRING') return 4+capacity(field)*4;
    if (field.dataType==='ENUM') return 4+Math.max(0,...field.enumValues.map(v=>Buffer.byteLength(v,'utf8')));
    return {INT:4,FLOAT:4,BOOLEAN:1,DATE:4,TIMESTAMP:8,UUID:16}[field.dataType]||0;
}
const align=n=>Math.ceil(n/8)*8;
function physicalPlan(candidate) {
    const plan=candidate.plan, byId=new Map(plan.entities.map(e=>[e.id,e]));
    const fields=new Map(plan.entities.flatMap(e=>e.fields.map(f=>[f.id,f])));
    const physical={profile:names.PROFILE,tables:[],relations:[],issues:[]};
    const relations=new Map(),constraints=new Map();
    function issue(message,nodeId){physical.issues.push({message,nodeId});}
    function reserve(name,owner,namespace='public') {
        const problem=names.identifierIssue(name); if(problem)issue('PostgreSQL identifier '+JSON.stringify(name)+' '+problem+'.',owner);
        const registry=namespace==='public'?relations:constraints;
        const key=namespace+'\0'+name;
        if(registry.has(key)&&registry.get(key)!==owner)issue('PostgreSQL '+namespace+' name '+JSON.stringify(name)+' collides.',owner);
        else registry.set(key,owner);
        if(namespace==='public')physical.relations.push({name,owner});
    }
    function constraint(t,kind,ids,purpose,extra={}) {
        const name=names.generatedName(kind,t.id,ids,purpose);
        reserve(name,t.id+'/'+kind+'/'+purpose,'constraint in '+t.name);
        const result={name,kind,fieldIds:ids,purpose,...extra};t.constraints.push(result);
        if(kind==='pk'||kind==='uq'){reserve(name,t.id+'/'+kind+'/'+purpose);t.indexes.push({name,fieldIds:ids,unique:true,backing:true});}
        return result;
    }
    function makeTable(id,name,columns,keyIds) {
        const t={id,name,columns:[],constraints:[],indexes:[],foreignKeys:[]};reserve(name,id);
        const seen=new Set();
        for(const f of columns) {
            const source=fields.get(f.typeSourceFieldId)||f;
            const col={...f,type:type(source),nullable:f.storage?.nullable??f.nullable??true,
                defaultValue:f.origin.kind==='declared'?f.defaultValue:null,identity:false,typeSource:source};
            const problem=names.identifierIssue(f.name,true);if(problem)issue('PostgreSQL column '+JSON.stringify(f.name)+' '+problem+'.',f.id);
            if(seen.has(f.name))issue('Duplicate PostgreSQL column '+JSON.stringify(f.name)+'.',f.id);seen.add(f.name);
            if(f.dataType==='STRING' && capacity(source)>LIMITS.varchar)issue('PostgreSQL VARCHAR capacity exceeds '+LIMITS.varchar+'.',f.id);
            if(!col.nullable)col.notNullName=constraint(t,'nn',[f.id],'not_null').name;
            t.columns.push(col);
        }
        if(columns.length>LIMITS.columns)issue('PostgreSQL table '+JSON.stringify(name)+' exceeds 1600 columns.',id);
        // Fixed-width tuple feasibility only. Variable-width values may use TOAST.
        const fixed=24+align(Math.ceil(columns.length/8))+t.columns.reduce((n,c)=>['STRING','ENUM'].includes(c.dataType)?n:align(n)+maxIndexBytes(c),0);
        if(fixed>8160)issue('PostgreSQL fixed-width heap tuple exceeds the stock 8192-byte block profile.',id);
        constraint(t,'pk',keyIds,'primary');physical.tables.push(t);return t;
    }
    for(const e of plan.entities) {
        const columns=[...policy.fieldViews(e,'base'),...e.fields.filter(f=>f.origin.kind==='relationship_fk')];
        const t=makeTable(e.id,e.names.table,columns,[e.key.fieldId]);
        for(const c of t.columns) {
            if(c.id===e.key.fieldId&&e.key.generation==='database_integer') {
                c.identity=true;c.sequenceName=names.generatedName('seq',e.id,[c.id],'identity');reserve(c.sequenceName,c.id+'/sequence');
            }
            if(c.storage?.unique)constraint(t,'uq',[c.id],'unique_'+c.id);
            if(c.origin.kind!=='declared')continue;
            const addCheck=(purpose,expression)=>constraint(t,'ck',[c.id],purpose,{expression});
            if(c.dataType==='ENUM')addCheck('membership',q(c.name)+' IN ('+c.enumValues.map(literal).join(', ')+')');
            if(c.dataType==='FLOAT')addCheck('finite',q(c.name)+" NOT IN ('Infinity'::real, '-Infinity'::real, 'NaN'::real)");
            if(c.dataType==='DATE')addCheck('date_range',q(c.name)+" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'");
            if(c.dataType==='TIMESTAMP')addCheck('timestamp_range',q(c.name)+" BETWEEN TIMESTAMPTZ '1970-01-01T00:00:01Z' AND TIMESTAMPTZ '2038-01-19T03:14:07Z'");
            for(const v of c.validations) {
                const length=['MIN_LENGTH','MAX_LENGTH'].includes(v.type);
                addCheck(v.type,(length?'CHAR_LENGTH('+q(c.name)+')':q(c.name))+' '+(['MIN','MIN_LENGTH'].includes(v.type)?'>=':'<=')+' '+literal(v.value));
            }
            if(c.defaultValue) {
                const value=c.defaultValue.value;
                if(c.dataType==='INT'&&(value< -2147483648||value>2147483647))issue('PostgreSQL INTEGER DEFAULT is outside storage range.',c.id);
                if(c.dataType==='FLOAT'&&(!Number.isFinite(Math.fround(value))||(value!==0&&Math.fround(value)===0)))issue('PostgreSQL REAL DEFAULT overflows or underflows binary32.',c.id);
                // Literal rendering also independently rejects malformed Unicode.
                literal(value);
            }
        }
    }
    const tableById=new Map(physical.tables.map(t=>[t.id,t]));
    function fk(t,fieldId,entityId,keyId,onDelete,owner) {
        const reference=byId.get(entityId),name=names.generatedName('fk',owner,[fieldId,keyId],'reference');
        reserve(name,owner+'/fk/'+fieldId,'constraint in '+t.name);
        const f={name,fieldIds:[fieldId],referencedTable:reference.names.table,referencedFieldIds:[keyId],referencedColumns:[fields.get(keyId).name],onDelete};t.foreignKeys.push(f);
        if(!t.indexes.some(ix=>ix.fieldIds[0]===fieldId)) {
            const ixName=names.generatedName('ix',t.id,[fieldId],'fk_support');reserve(ixName,t.id+'/index/'+fieldId);
            t.indexes.push({name:ixName,fieldIds:[fieldId],unique:false,backing:false});
        }
    }
    for(const r of plan.relations) {
        const s=r.storage;if(!s)continue;
        if(s.kind==='junction') {
            const t=makeTable(s.table.id,s.table.name,s.table.columns,s.table.primaryKeyFieldIds);
            for(const f of s.foreignKeys)fk(t,f.fieldId,f.referencedEntityId,f.referencedFieldId,f.onDelete,r.id);
        } else fk(tableById.get(s.receiverEntityId),s.fieldId,s.referencedEntityId,s.referencedFieldId,s.onDelete,r.id);
    }
    for(const t of physical.tables)for(const ix of t.indexes) {
        if(ix.fieldIds.length>LIMITS.indexColumns)issue('PostgreSQL index exceeds 32 columns.',t.id);
        const size=24+ix.fieldIds.reduce((sum,id)=>sum+align(maxIndexBytes(t.columns.find(c=>c.id===id).typeSource)),0);
        if(size>LIMITS.btreeBytes)issue('PostgreSQL full B-tree key requires '+size+' conservative bytes; profile maximum is 2704.',t.id);
    }
    return physical;
}
function sourceIssues(entities) {
    const issues=[];
    const add=(message,node,locationKey='name')=>issues.push({message,node,locationKey});
    for(const e of entities) {
        let bad=names.identifierIssue(e.name);if(bad)add('PostgreSQL table '+JSON.stringify(e.name)+' '+bad+'.',e);
        for(const f of e.fields||[]) {
            bad=names.identifierIssue(f.name,true);if(bad)add('PostgreSQL column '+JSON.stringify(f.name)+' '+bad+'.',f);
            for(const value of [...(f.enumValues||[]),...(f.defaultValue?.type==='STRING'?[f.defaultValue.value]:[])]) {
                if(!names.validUnicode(value)||value.includes('\0'))add('PostgreSQL text must be well-formed Unicode without NUL.',f,'DEFAULT');
            }
        }
    }
    return issues;
}
function targetIssues(entities,relations=[]) {
    const issues=sourceIssues(entities);
    const add=(message,node,locationKey='name')=>issues.push({message,node,locationKey});
    if(issues.length || entities.some(e=>(e.fields||[]).some(f=>!['INT','STRING','FLOAT','BOOLEAN','ENUM','DATE','TIMESTAMP','UUID'].includes(f.dataType)||f.dataType==='ENUM'&&!Array.isArray(f.enumValues))))return issues;
    try {
        const candidate=schema.projectDefinitions(entities,relations,{comparison:v=>v});
        const physical=physicalPlan(candidate);
        for(const problem of physical.issues) {
            const entity=candidate.plan.entities.find(e=>e.id===problem.nodeId||e.fields.some(f=>f.id===problem.nodeId));
            const field=entity?.fields.find(f=>f.id===problem.nodeId);
            add(problem.message,field?entities[entity.order].fields[field.declaredOrder]||entities[entity.order]:entity?entities[entity.order]:relations.find(r=>(r.relationName||r.name)===candidate.plan.relations.find(r=>r.id===problem.nodeId)?.relationName)||entities[0]);
        }
        for(const problem of candidate.issues.filter(i=>['DUPLICATE_STORAGE_FIELD','IMPLICIT_KEY_COLLISION'].includes(i.code)))add(problem.message,entities[0]);
    } catch(error) { add(error.message,entities[0]); }
    return issues;
}
function admissionError(message) {
    const error=new Error('Cannot generate PostgreSQL target code: '+message);
    error.code='POSTGRES_ADMISSION_FAILURE';error.diagnostic=createDiagnostic('codegen',error.code,error.message);return error;
}
function prepare(ir,contextFactory) {
    const validation=IR.validate(ir);if(!validation.valid)throw admissionError('Invalid IR - '+validation.errors.join(', '));
    const definitions=policy.declaredEntitiesFromIR(ir),relations=policy.relationsFromIR(ir);
    const problems=sourceIssues(definitions),numbers=definitions.flatMap(e=>e.fields.flatMap(numericIssues));
    if(problems.length||numbers.length)throw admissionError([...problems,...numbers].map(i=>i.message).join(' '));
    const candidate=schema.buildCandidate(ir,{comparison:v=>v});
    const conflicts=neutralNames.namingConflictsFromPlan(candidate,candidate.definitions,{physical:false});
    if(conflicts.length)throw admissionError(conflicts.map(c=>c.namespace+' '+JSON.stringify(c.name)+' collision').join(', '));
    try {schema.assertStructural(candidate);}catch(error){throw admissionError(error.message);}
    const physical=physicalPlan(candidate);if(physical.issues.length)throw admissionError(physical.issues.map(i=>i.message).join(' '));
    const context=contextFactory(candidate);context.physical=physical;
    return {candidate,context,entities:candidate.definitions.entities.map(e=>({name:e.name,fields:e.fields.map(({sourceLocations,...field})=>field)})),relations:candidate.definitions.relations};
}
function renderSchema(physical) {
    const output=['-- APIForge '+names.PROFILE,'SET standard_conforming_strings = on;',"SET TIME ZONE 'UTC';","SET DateStyle = 'ISO, YMD';"];
    for(const t of physical.tables) {
        const fieldName=id=>q(t.columns.find(c=>c.id===id).name);
        const lines=t.columns.map(c=>{
            let sql=q(c.name)+' '+c.type;
            if(c.identity)sql+=' GENERATED BY DEFAULT AS IDENTITY (SEQUENCE NAME '+table(c.sequenceName)+')';
            if(c.defaultValue)sql+=' DEFAULT '+literal(c.defaultValue.value);
            if(!c.nullable)sql+=' CONSTRAINT '+q(c.notNullName)+' NOT NULL';
            return sql;
        });
        for(const c of t.constraints) {
            if(c.kind==='nn')continue;
            lines.push('CONSTRAINT '+q(c.name)+' '+(c.kind==='ck'?'CHECK ('+c.expression+')':(c.kind==='pk'?'PRIMARY KEY':'UNIQUE')+' ('+c.fieldIds.map(fieldName).join(', ')+')'));
        }
        output.push('CREATE TABLE '+table(t.name)+' (\n    '+lines.join(',\n    ')+'\n);');
    }
    for(const t of physical.tables) {
        for(const ix of t.indexes.filter(i=>!i.backing))output.push('CREATE INDEX '+q(ix.name)+' ON '+table(t.name)+' USING btree ('+ix.fieldIds.map(id=>q(t.columns.find(c=>c.id===id).name)).join(', ')+');');
        for(const f of t.foreignKeys)output.push('ALTER TABLE '+table(t.name)+' ADD CONSTRAINT '+q(f.name)+' FOREIGN KEY ('+f.fieldIds.map(id=>q(t.columns.find(c=>c.id===id).name)).join(', ')+') REFERENCES '+table(f.referencedTable)+' ('+f.referencedColumns.map(q).join(', ')+') ON DELETE '+(f.onDelete==='cascade'?'CASCADE':'SET NULL')+';');
    }
    return output.join('\n\n')+'\n';
}
module.exports={LIMITS,capacity,literal,type,maxIndexBytes,physicalPlan,targetIssues,prepare,renderSchema,admissionError};
