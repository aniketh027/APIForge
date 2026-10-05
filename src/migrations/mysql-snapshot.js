'use strict';
const target=require('../utils/mysql-target'), policy=require('../planning/effective-policy');
const {profile,id,clone,compare,validateSnapshot,physicalDefault}=require('./snapshot');
function indexName(base,indexes) {
    const used=name=>name.toLowerCase()==='primary'||indexes.some(i=>i.name.toLowerCase()===name.toLowerCase());
    if(!used(base))return base;
    for(let n=2;n<100;n++){const candidate=base.slice(0,61)+'_'+n;if(!used(candidate))return candidate;}
    throw new Error('MySQL implicit index namespace exhausted.');
}
function buildMysqlSnapshot(plan) {
    const s={formatVersion:1,target:{kind:'mysql',contractVersion:1,physicalNamingVersion:1,profile:clone(profile)},sourcePlanVersions:{effectiveFormatVersion:plan.formatVersion,policyVersion:plan.policyVersion,namingVersion:plan.namingVersion},tables:[],relations:[]};
    const effectiveFields=new Map(plan.entities.flatMap(e=>e.fields.map(f=>[f.id,f])));
    const tables=new Map();
    function column(t,f,nullable,generation='none') {
        const typeSource=effectiveFields.get(f.typeSourceFieldId)||f;
        return {id:id('column',t.name,f.name),logicalRef:f.id,name:f.name,origin:clone(f.origin),logicalType:f.dataType,typeSourceRef:f.typeSourceFieldId||null,physicalType:target.describeColumnType(typeSource),character:target.describeCharacter(typeSource),nullable,default:{declared:f.defaultValue||null,physical:physicalDefault(f.dataType,nullable,f.defaultValue)},generation,onUpdate:'none'};
    }
    function index(t,name,columns,unique,purposes,implicit=false){return {id:id('index',t.name,name),name,unique,method:'BTREE',columns,purposes,implicit};}
    function covers(t,cols){return [...(t.primaryKey?[t.primaryKey]:[]),...t.indexes].find(i=>cols.every((c,n)=>i.columns[n]===c));}
    function foreign(t,name,cid,parent,key,action,relationRef){
        const support=covers(t,[cid]);if(support){if(!support.purposes.includes('fk_support'))support.purposes.push('fk_support');}
        else t.indexes.push(index(t,indexName(name||t.columns.find(c=>c.id===cid).name,t.indexes),[cid],false,['fk_support'],true));
        t.foreignKeys.push({id:id('fk',t.name,name),name,columns:[cid],referencedTableId:parent.id,referencedColumns:[id('column',parent.name,key.name)],onDelete:action==='cascade'?'CASCADE':'SET NULL',onUpdate:'RESTRICT',relationRef});
    }
    for(const e of plan.entities){const t={id:id('table',e.names.table),logicalRef:e.id,name:e.names.table,origin:{kind:'entity',relationRef:null},identity:null,columns:[],primaryKey:null,indexes:[],checks:[],foreignKeys:[]};
        const key=e.fields.find(f=>f.id===e.key.fieldId);
        t.columns=policy.fieldViews(e,'base').map(f=>column(t,f,f.storage.nullable,f.id===key.id&&e.key.generation==='database_integer'?'auto_increment':'none'));
        const keyId=id('column',t.name,key.name);t.identity={columnId:keyId,generationIntent:e.key.generation};t.primaryKey=index(t,'PRIMARY',[keyId],true,['primary']);
        let ordinal=0;
        for(const f of policy.fieldViews(e)){
            const cid=id('column',t.name,f.name);
            if(f.storage.unique)t.indexes.push(index(t,indexName(f.name,t.indexes),[cid],true,['unique']));
            for(const [measure,minName,maxName] of [['value','MIN','MAX'],['char_length','MIN_LENGTH','MAX_LENGTH']]){
                const min=f.validations.find(v=>v.type===minName),max=f.validations.find(v=>v.type===maxName);
                if(min||max)t.checks.push({id:id('check',t.name,f.name,measure),name:t.name+'_chk_'+(++ordinal),enforced:true,condition:{columnId:cid,measure,min:min?.value??null,max:max?.value??null}});
            }
        }
        s.tables.push(t);tables.set(e.id,t);
    }
    for(const r of plan.relations){const storage=r.storage,source=plan.entities.find(e=>e.id===r.sourceEntityId),dest=plan.entities.find(e=>e.id===r.targetEntityId);
        const meta={logicalRef:r.id,name:r.relationName,sourceTableId:tables.get(source.id).id,targetTableId:tables.get(dest.id).id,cardinality:r.cardinality,storage:null};
        if(storage.kind==='junction'){
            const t={id:id('table',storage.table.name),logicalRef:storage.table.id,name:storage.table.name,origin:{kind:'junction',relationRef:r.id},identity:null,columns:[],primaryKey:null,indexes:[],checks:[],foreignKeys:[]};
            t.columns=storage.table.columns.map(f=>column(t,f,false));
            t.primaryKey=index(t,'PRIMARY',t.columns.map(c=>c.id),true,['primary']);
            storage.foreignKeys.forEach((f,n)=>{const parent=tables.get(f.referencedEntityId),key=effectiveFields.get(f.referencedFieldId);const name=t.name+'_ibfk_'+(n+1);
                // Anonymous junction FKs use the first-column automatic index name.
                const cid=t.columns[n].id;if(!covers(t,[cid]))t.indexes.push(index(t,indexName(t.columns[n].name,t.indexes),[cid],false,['fk_support'],true));
                foreign(t,name,cid,parent,key,f.onDelete,r.id);
            });
            s.tables.push(t);meta.storage={kind:'junction',tableId:t.id,columnIds:t.columns.map(c=>c.id)};
        }else{
            const t=tables.get(storage.receiverEntityId),parent=tables.get(storage.referencedEntityId),e=plan.entities.find(e=>e.id===storage.receiverEntityId),f=e.fields.find(f=>f.id===storage.fieldId),key=effectiveFields.get(storage.referencedFieldId);
            const c=column(t,f,true);t.columns.push(c);
            if(f.storage.unique)t.indexes.push(index(t,indexName(f.name,t.indexes),[c.id],true,['unique']));
            const name=target.relationPhysicalNames(r,plan).foreignKeyConstraints[0];foreign(t,name,c.id,parent,key,storage.onDelete,r.id);
            meta.storage={kind:'foreign_key',tableId:t.id,columnIds:[c.id]};
        }
        s.relations.push(meta);
    }
    s.tables.sort((a,b)=>compare(a.name,b.name));s.relations.sort((a,b)=>compare(a.logicalRef,b.logicalRef));
    for(const t of s.tables){for(const list of [t.indexes,t.checks,t.foreignKeys])list.sort((a,b)=>compare(a.name,b.name));for(const i of [t.primaryKey,...t.indexes])if(i)i.purposes.sort(compare);}
    return validateSnapshot(s);
}
// InnoDB-created FK support survives DROP FK. A newly added suitable index
// can supersede it; explicit user indexes never disappear through this rule.
function applyImplicitIndexEffects(table,addedIndex) {
    if(!addedIndex)return;
    table.indexes=table.indexes.filter(old=>{
        if(!old.implicit||old.id===addedIndex.id||!old.columns.every((c,n)=>addedIndex.columns[n]===c))return true;
        const alternatives=[table.primaryKey,...table.indexes.filter(i=>i.id!==old.id)].filter(Boolean);
        const users=table.foreignKeys.filter(f=>f.columns.every((c,n)=>old.columns[n]===c));
        return users.some(f=>!alternatives.some(i=>f.columns.every((c,n)=>i.columns[n]===c)));
    });
}
module.exports={buildMysqlSnapshot,indexName,applyImplicitIndexEffects};
