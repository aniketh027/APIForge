'use strict';
const crypto=require('crypto');
const mysql=require('../utils/mysql-target');
const {fail}=require('./errors');
const temporal=require('../utils/temporal'), uuid=require('../utils/uuid');
const profile=deepFreeze(require('./profiles/mysql-8.4-v1.json'));
const clone=value=>JSON.parse(canonical(value));
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function deepFreeze(value) { if(value && typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value; }
function canonical(value) {
    const seen=new Set();
    function encode(v) {
        if(typeof v==='string'&&Array.from(v).some(ch=>ch.length===1&&ch.charCodeAt(0)>=0xd800&&ch.charCodeAt(0)<=0xdfff))fail('MIGRATION_HISTORY_CORRUPT','Canonical strings must contain valid Unicode scalar values.');
        if(v===null || typeof v==='boolean' || typeof v==='string') return JSON.stringify(v);
        if(typeof v==='number' && Number.isFinite(v)) return JSON.stringify(v);
        if(!v || typeof v!=='object' || seen.has(v) || (!Array.isArray(v) && ![Object.prototype,null].includes(Object.getPrototypeOf(v)))) fail('MIGRATION_HISTORY_CORRUPT','Canonical data must be finite acyclic JSON.');
        for(const key of Reflect.ownKeys(v)){if(Array.isArray(v)&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!descriptor.enumerable||descriptor.get||descriptor.set)fail('MIGRATION_HISTORY_CORRUPT','Canonical records cannot contain symbols, accessors or hidden properties.');}
        seen.add(v);
        if(Array.isArray(v) && (Object.keys(v).length!==v.length || Array.from(v).some(x=>x===undefined))) fail('MIGRATION_HISTORY_CORRUPT','Sparse/extended arrays are forbidden.');
        const result=Array.isArray(v) ? '['+v.map(encode).join(',')+']' : '{'+Object.keys(v).sort(compare).map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
        seen.delete(v);return result;
    }
    return encode(value)+'\n';
}
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
function parseCanonical(bytes) {
    if(Buffer.isBuffer(bytes)){const decoded=bytes.toString('utf8');if(!bytes.equals(Buffer.from(decoded,'utf8')))fail('MIGRATION_HISTORY_CORRUPT','Artifact is not exact UTF-8.');bytes=decoded;}
    let value;try{value=JSON.parse(bytes);}catch{fail('MIGRATION_HISTORY_CORRUPT','Invalid JSON artifact.');}
    if(canonical(value)!==bytes) fail('MIGRATION_HISTORY_CORRUPT','Artifact is not canonical JSON (duplicate keys and noncanonical bytes are forbidden).');
    return value;
}
const id=(kind,...parts)=>kind+':'+parts.map(encodeURIComponent).join('/');
function keys(value, expected) { if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join('|')!==[...expected].sort().join('|')) fail('MIGRATION_HISTORY_CORRUPT','Snapshot record keys do not match format 1.'); }
function invariant(ok,message) { if(!ok) fail('MIGRATION_HISTORY_CORRUPT',message); }
function physicalProjection(snapshot) {
    return {formatVersion:1,target:snapshot.target,tables:snapshot.tables.map(t=>({name:t.name,
        engine:profile.engine,rowFormat:profile.rowFormat,characterSet:profile.characterSet,collation:profile.collation,
        columns:t.columns.map(c=>({name:c.name,type:c.physicalType,character:c.character&&{characterSet:c.character.characterSet,collation:c.character.collation},nullable:c.nullable,default:c.default.physical,generation:c.generation,onUpdate:c.onUpdate})),
        primaryKey:t.primaryKey&&{name:t.primaryKey.name,columns:t.primaryKey.columns.map(cid=>t.columns.find(c=>c.id===cid).name),unique:true,method:t.primaryKey.method},
        indexes:t.indexes.map(i=>({name:i.name,columns:i.columns.map(cid=>t.columns.find(c=>c.id===cid).name),unique:i.unique,method:i.method})).sort((a,b)=>compare(a.name,b.name)),
        checks:t.checks.map(c=>({name:c.name,enforced:c.enforced,condition:{...c.condition,columnId:t.columns.find(x=>x.id===c.condition.columnId).name}})).sort((a,b)=>compare(a.name,b.name)),
        foreignKeys:t.foreignKeys.map(f=>({name:f.name,columns:f.columns.map(cid=>t.columns.find(c=>c.id===cid).name),referencedTable:snapshot.tables.find(x=>x.id===f.referencedTableId).name,referencedColumns:f.referencedColumns.map(cid=>snapshot.tables.find(x=>x.id===f.referencedTableId).columns.find(c=>c.id===cid).name),onDelete:f.onDelete,onUpdate:f.onUpdate})).sort((a,b)=>compare(a.name,b.name))})).sort((a,b)=>compare(a.name,b.name))};
}
function fieldForCapacity(c) {return {name:c.name,dataType:c.logicalType,enumValues:c.physicalType.members||null,validations:c.logicalType==='STRING'?[{type:'MAX_LENGTH',value:c.physicalType.length}]:[],defaultValue:c.default.declared};}
function validatePhysical(snapshot, altered=new Set()) {
    const fknames=new Set(), checknames=new Set(), tablenames=new Set();
    for(const t of snapshot.tables) {
        invariant(typeof t.name==='string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name) && t.name.length<=64 && !tablenames.has(t.name.toLowerCase()),'Invalid/duplicate physical table name.');tablenames.add(t.name.toLowerCase());
        const columns=new Map(), names=new Set();
        for(const c of t.columns){invariant(typeof c.name==='string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name) && c.name.length<=64 && !names.has(c.name.toLowerCase()),'Invalid/duplicate column.');names.add(c.name.toLowerCase());invariant(!columns.has(c.id),'Duplicate column ID.');columns.set(c.id,c);
            invariant(['INT','FLOAT','STRING','BOOLEAN','ENUM','DATE','TIMESTAMP','UUID'].includes(c.logicalType),'Unsupported logical type.');
            invariant(typeof c.nullable==='boolean' && ['none','auto_increment'].includes(c.generation) && c.onUpdate==='none','Invalid column attributes.');
            const expected=mysql.describeColumnType(fieldForCapacity(c));invariant(canonical(expected)===canonical(c.physicalType),'Physical/logical type mismatch.');
            if(c.logicalType==='STRING'&&c.physicalType.length>mysql.VARCHAR_CAPACITY)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','STRING exceeds the single-column utf8mb4 capacity.');
            invariant(canonical(c.character)===canonical(mysql.describeCharacter(fieldForCapacity(c))),'Invalid character profile.');
            invariant(['none','null','literal'].includes(c.default.physical.kind),'Invalid physical default.');
            if(c.default.declared){const d=c.default.declared;invariant(d.type===(['INT','FLOAT'].includes(c.logicalType)?'NUMBER':c.logicalType==='BOOLEAN'?'BOOLEAN':'STRING'),'Invalid default type.');
                if(c.logicalType==='UUID')invariant(uuid.isUuid(d.value),'Invalid UUID default.');
                if(c.logicalType==='DATE')invariant(temporal.isDate(d.value),'Invalid DATE default.');
                if(c.logicalType==='TIMESTAMP')invariant(temporal.isTimestamp(d.value),'Invalid TIMESTAMP default.');
                if(c.logicalType==='INT')invariant(Number.isSafeInteger(d.value)&&d.value>=-2147483648&&d.value<=2147483647,'Invalid INT default.');
                if(c.logicalType==='FLOAT')invariant(typeof d.value==='number'&&Number.isFinite(d.value)&&Math.abs(d.value)<=mysql.FLOAT_MAX,'Invalid FLOAT default.');
                if(c.logicalType==='BOOLEAN')invariant(typeof d.value==='boolean','Invalid BOOLEAN default.');
                if(c.logicalType==='STRING')invariant(typeof d.value==='string'&&Array.from(d.value).length<=c.physicalType.length,'Invalid STRING default.');
                if(c.logicalType==='ENUM')invariant(c.physicalType.members.includes(d.value),'Invalid ENUM default.');
            }
            if(c.logicalType==='ENUM')invariant(c.physicalType.members.length>0&&c.physicalType.members.length<=65535&&new Set(c.physicalType.members).size===c.physicalType.members.length&&c.physicalType.members.every(m=>typeof m==='string'&&!m.endsWith(' ')&&Array.from(m).length<=255),'Invalid ENUM members.');
            invariant(canonical(c.default.physical)===canonical(physicalDefault(c.logicalType,c.nullable,c.default.declared)),'Semantic/physical default mismatch.');
        }
        const indexes=[...(t.primaryKey?[t.primaryKey]:[]),...t.indexes], indexnames=new Set();
        for(const i of indexes){invariant(typeof i.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(i.name)&&i.name.length<=64 && !indexnames.has(i.name.toLowerCase()) && typeof i.unique==='boolean' && i.method==='BTREE' && i.columns.length>0 && new Set(i.columns).size===i.columns.length && i.columns.every(cid=>columns.has(cid)),'Invalid index.');indexnames.add(i.name.toLowerCase());}
        if(t.primaryKey){invariant(t.primaryKey.name==='PRIMARY'&&t.primaryKey.unique&&t.primaryKey.columns.every(cid=>!columns.get(cid).nullable),'Invalid PRIMARY KEY.');}
        const auto=t.columns.filter(c=>c.generation==='auto_increment');invariant(auto.length<=1 && auto.every(c=>!c.nullable&&c.logicalType==='INT'&&c.default.physical.kind==='none'&&indexes.some(i=>i.columns[0]===c.id)),'Invalid AUTO_INCREMENT support.');
        for(const c of t.checks){invariant(typeof c.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)&&c.name.length<=64&&!checknames.has(c.name.toLowerCase())&&c.enforced===true&&columns.has(c.condition.columnId),'Invalid CHECK.');checknames.add(c.name.toLowerCase());const col=columns.get(c.condition.columnId);invariant(col.generation!=='auto_increment','CHECK references AUTO_INCREMENT.');invariant(['value','char_length'].includes(c.condition.measure)&&(c.condition.min!==null||c.condition.max!==null),'Invalid CHECK condition.');for(const v of [c.condition.min,c.condition.max]) invariant(v===null || (Number.isFinite(v)&&(c.condition.measure!=='char_length'||(Number.isSafeInteger(v)&&v>=0))),'Invalid CHECK operand.');invariant(c.condition.min===null||c.condition.max===null||c.condition.min<=c.condition.max,'Invalid CHECK bounds.');}
        for(const f of t.foreignKeys){invariant(typeof f.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)&&f.name.length<=64&&!fknames.has(f.name.toLowerCase())&&f.columns.length>0&&new Set(f.columns).size===f.columns.length&&f.columns.every(cid=>columns.has(cid)),'Invalid FK namespace/columns.');fknames.add(f.name.toLowerCase());const parent=snapshot.tables.find(p=>p.id===f.referencedTableId);invariant(parent&&f.referencedColumns.length===f.columns.length&&new Set(f.referencedColumns).size===f.referencedColumns.length&&f.referencedColumns.every(cid=>parent.columns.some(c=>c.id===cid)),'Invalid FK target.');
            const covers=(list,parts)=>list.some(i=>parts.every((p,n)=>i.columns[n]===p));
            invariant(covers(indexes,f.columns)&&covers([...(parent.primaryKey?[parent.primaryKey]:[]),...parent.indexes].filter(i=>i.unique&&i.columns.length===f.referencedColumns.length),f.referencedColumns),'Missing FK support or exact unique referenced key.');
            f.columns.forEach((cid,n)=>{const child=columns.get(cid), p=parent.columns.find(c=>c.id===f.referencedColumns[n]);invariant(child.physicalType.kind===p.physicalType.kind&&canonical(child.character)===canonical(p.character),'Incompatible FK types/characters.');});
            invariant(['SET NULL','CASCADE','RESTRICT'].includes(f.onDelete)&&f.onUpdate==='RESTRICT','Invalid FK action.');if(f.onDelete==='SET NULL')invariant(f.columns.every(cid=>columns.get(cid).nullable),'SET NULL requires nullable columns.');
        }
        const geometry={name:t.name,node:t,altered:altered.has(t.id),columns:t.columns.map(c=>({name:c.name,node:c,field:fieldForCapacity(c),nullable:c.nullable,origin:c.origin.kind==='declared'?'declared':c.origin.kind})),indexes:indexes.map(i=>({kind:i===t.primaryKey?'PRIMARY':i.unique?'UNIQUE':'FK',parts:i.columns.map(cid=>columns.get(cid).name),node:i}))};
        const issues=mysql.planIssues([geometry]);if(issues.length)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE',issues.map(i=>i.message).join(' '));
    }
    return snapshot;
}
function physicalDefault(type,nullable,declared) {
    if(!declared) return {kind:nullable?'null':'none'};
    let value=declared.value;
    if(type==='TIMESTAMP')value=value.slice(0,10)+' '+value.slice(11,19);
    if(type==='BOOLEAN')value=value?1:0;
    if(type==='FLOAT')value=Math.fround(value);
    return {kind:'literal',type:declared.type,value};
}
function validateSnapshotRecords(s) {
    canonical(s);if(s?.formatVersion!==1)fail('MIGRATION_VERSION_UNSUPPORTED','Snapshot formatVersion must be 1.');
    keys(s,['formatVersion','target','sourcePlanVersions','tables','relations']);
    if(canonical(s.target)!==canonical({kind:'mysql',contractVersion:1,physicalNamingVersion:1,profile}))fail('MIGRATION_PROFILE_UNSUPPORTED','Expected immutable mysql-8.4-v1 profile.');
    invariant(canonical(s.sourcePlanVersions)===canonical({effectiveFormatVersion:1,policyVersion:1,namingVersion:1}),'Unsupported Effective Schema Plan version.');
    invariant(Array.isArray(s.tables)&&Array.isArray(s.relations),'Invalid snapshot collections.');
    const sorted=(list,key)=>invariant(list.every((v,n)=>n===0||compare(key(list[n-1]),key(v))<0),'Unordered or duplicate snapshot collection.');
    sorted(s.tables,t=>t.name);sorted(s.relations,r=>r.logicalRef);
    for(const t of s.tables){keys(t,['id','logicalRef','name','origin','identity','columns','primaryKey','indexes','checks','foreignKeys']);invariant(t.id===id('table',t.name),'Invalid table ID.');
        keys(t.origin,['kind','relationRef']);invariant(['entity','junction'].includes(t.origin.kind),'Invalid table origin.');
        invariant(typeof t.logicalRef==='string'&&Array.isArray(t.columns)&&Array.isArray(t.indexes)&&Array.isArray(t.checks)&&Array.isArray(t.foreignKeys),'Invalid table collections/references.');
        sorted(t.indexes,i=>i.name);sorted(t.checks,c=>c.name);sorted(t.foreignKeys,f=>f.name);
        if(t.identity){keys(t.identity,['columnId','generationIntent']);invariant(['database_integer','runtime_uuid','none'].includes(t.identity.generationIntent)&&t.primaryKey?.columns.length===1&&t.primaryKey.columns[0]===t.identity.columnId,'Invalid identity metadata.');const c=t.columns.find(c=>c.id===t.identity.columnId);invariant(c&&((t.identity.generationIntent==='database_integer'&&c.generation==='auto_increment')||(t.identity.generationIntent==='runtime_uuid'&&c.logicalType==='UUID'&&!c.default.declared&&c.generation==='none')||(t.identity.generationIntent==='none'&&c.generation==='none')),'Identity intent contradicts column storage.');}
        for(const c of t.columns){keys(c,['id','logicalRef','name','origin','logicalType','typeSourceRef','physicalType','character','nullable','default','generation','onUpdate']);invariant(c.id===id('column',t.name,c.name),'Invalid column ID.');keys(c.default,['declared','physical']);
            invariant(c.default.declared===null||(typeof c.default.declared==='object'&&!Array.isArray(c.default.declared)),'Invalid declared default.');
            keys(c.origin,c.origin.kind==='junction_fk'?['kind','relationId','endpoint']:['kind','relationId']);invariant(c.origin.kind!=='junction_fk'||['source','target'].includes(c.origin.endpoint),'Invalid junction endpoint.');invariant(typeof c.logicalRef==='string'&&(c.typeSourceRef===null||typeof c.typeSourceRef==='string')&&(c.origin.relationId===null||typeof c.origin.relationId==='string'),'Invalid column references.');
            invariant(['declared','implicit_key','relationship_fk','junction_fk'].includes(c.origin.kind),'Invalid column origin.');
            if(c.default.declared) keys(c.default.declared,['type','value']);
            keys(c.default.physical,c.default.physical.kind==='literal'?['kind','type','value']:['kind']);
        }
        for(const i of [t.primaryKey,...t.indexes].filter(Boolean)){keys(i,['id','name','unique','method','columns','purposes','implicit']);invariant(i.id===id('index',t.name,i.name)&&Array.isArray(i.columns)&&Array.isArray(i.purposes)&&typeof i.implicit==='boolean','Invalid index metadata.');sorted(i.purposes,p=>p);invariant(i.purposes.length>0&&i.purposes.every(p=>['primary','unique','fk_support'].includes(p)),'Invalid index purposes.');}
        for(const c of t.checks){keys(c,['id','name','enforced','condition']);keys(c.condition,['columnId','measure','min','max']);const col=t.columns.find(x=>x.id===c.condition.columnId);invariant(col&&c.id===id('check',t.name,col.name,c.condition.measure),'Invalid CHECK ID.');}
        for(const f of t.foreignKeys){keys(f,['id','name','columns','referencedTableId','referencedColumns','onDelete','onUpdate','relationRef']);invariant(f.id===id('fk',t.name,f.name)&&Array.isArray(f.columns)&&Array.isArray(f.referencedColumns)&&typeof f.relationRef==='string','Invalid FK metadata.');}
    }
    for(const r of s.relations){keys(r,['logicalRef','name','sourceTableId','targetTableId','cardinality','storage']);invariant(typeof r.logicalRef==='string'&&typeof r.name==='string'&&['ONE_TO_MANY','MANY_TO_ONE','ONE_TO_ONE','MANY_TO_MANY'].includes(r.cardinality)&&s.tables.some(t=>t.id===r.sourceTableId)&&s.tables.some(t=>t.id===r.targetTableId),'Invalid relation endpoints.');keys(r.storage,['kind','tableId','columnIds']);const t=s.tables.find(t=>t.id===r.storage.tableId);invariant(t&&Array.isArray(r.storage.columnIds)&&r.storage.columnIds.length>0&&r.storage.columnIds.every(cid=>t.columns.some(c=>c.id===cid)),'Invalid relation storage.');
        const fks=t.foreignKeys.filter(f=>f.relationRef===r.logicalRef);
        if(r.cardinality==='MANY_TO_MANY')invariant(r.storage.kind==='junction'&&t.origin.kind==='junction'&&t.origin.relationRef===r.logicalRef&&canonical(t.primaryKey.columns)===canonical(r.storage.columnIds)&&fks.length===2&&fks[0].referencedTableId===r.sourceTableId&&fks[1].referencedTableId===r.targetTableId,'Invalid junction topology.');
        else{const receiver=r.cardinality==='MANY_TO_ONE'?r.sourceTableId:r.targetTableId,parent=r.cardinality==='MANY_TO_ONE'?r.targetTableId:r.sourceTableId;invariant(r.storage.kind==='foreign_key'&&t.id===receiver&&fks.length===1&&fks[0].referencedTableId===parent&&canonical(fks[0].columns)===canonical(r.storage.columnIds),'Invalid FK ownership/topology.');if(r.cardinality==='ONE_TO_ONE')invariant([t.primaryKey,...t.indexes].filter(Boolean).some(i=>i.unique&&canonical(i.columns)===canonical(r.storage.columnIds)),'ONE_TO_ONE lacks exact unique support.');}
    }
    for(const t of s.tables){invariant(t.origin.kind!=='entity'||(t.origin.relationRef===null&&t.identity!==null),'Invalid entity identity/origin.');invariant(t.origin.kind!=='junction'||(t.identity===null&&s.relations.some(r=>r.logicalRef===t.origin.relationRef&&r.storage.tableId===t.id)),'Invalid junction provenance.');for(const f of t.foreignKeys)invariant(s.relations.some(r=>r.logicalRef===f.relationRef&&r.storage.tableId===t.id),'Unbound FK relation reference.');for(const c of t.columns){if(['declared','implicit_key'].includes(c.origin.kind))invariant(c.origin.relationId===null&&c.typeSourceRef===null,'Invalid declared column provenance.');else invariant(s.relations.some(r=>r.logicalRef===c.origin.relationId&&r.storage.tableId===t.id&&r.storage.columnIds.includes(c.id))&&s.tables.some(p=>p.columns.some(pc=>pc.logicalRef===c.typeSourceRef&&canonical(pc.physicalType)===canonical(c.physicalType))),'Unbound generated column provenance/type source.');}}
    validatePhysical(s);return s;
}
function validateSnapshot(s){try{return validateSnapshotRecords(s);}catch(error){if(error.name==='MigrationError')throw error;fail('MIGRATION_HISTORY_CORRUPT','Malformed snapshot record.');}}
const snapshotSha256=s=>hash(validateSnapshot(s));
const physicalSha256=s=>hash(physicalProjection(s));
module.exports={profile,clone,compare,id,canonical,hash,parseCanonical,validateSnapshot,validatePhysical,physicalProjection,physicalDefault,snapshotSha256,physicalSha256,fieldForCapacity,deepFreeze};
