'use strict';
const S=require('./snapshot'),{diffSnapshots,equal}=require('./diff'),{classify}=require('./mysql-safety'),{stableTopologicalOrder}=require('./plan');
function planMysqlMigration(old,next){const diff=diffSnapshots(old,next),operations=[],blockers=[];
    const oldPhysical=S.physicalProjection(old),newPhysical=S.physicalProjection(next);
    const table=(s,id)=>s.tables.find(t=>t.id===id);
    function add(kind,tableId,before,after,classification,intentId,extra={}){const facts={kind,tableId,before:before??null,after:after??null,...extra};const op={id:S.hash(facts),...facts,objectId:after?.id||before?.id||tableId||'metadata',intentId,safetyClass:classification.safetyClass,reasonCodes:classification.reasonCodes,requirements:classification.requirements,warnings:classification.warnings,dependsOn:[]};if(!operations.some(o=>o.id===op.id))operations.push(op);return op;}
    const safe={safetyClass:'SAFE',reasonCodes:['DEPENDENCY_PRESERVES_EXISTING_DATA'],requirements:[],warnings:[]};
    function projected(s,physical,intent,record){const t=physical.tables.find(t=>t.name===table(s,intent.tableId).name);const key=intent.kind.includes('column')?'columns':intent.kind.includes('index')?'indexes':intent.kind.includes('check')?'checks':intent.kind.includes('foreign_key')?'foreignKeys':'primaryKey';return key==='primaryKey'?t.primaryKey:t[key].find(r=>r.name===record.name);}
    for(const i of diff.intents){const safety=classify(i,old,next);
        if(safety.safetyClass==='UNSUPPORTED'){blockers.push({intentId:i.id,kind:i.kind,...safety});add('unsupported',i.tableId,i.before,i.after,safety,i.id);continue;}
        if(i.kind==='create_table'){const base=S.clone(i.after);base.foreignKeys=[];base.indexes=base.indexes.filter(x=>!x.implicit);add('create_table',i.tableId,null,base,safety,i.id);
            for(const f of i.after.foreignKeys)add('add_foreign_key',i.tableId,null,f,safe,i.id,{automaticName:i.after.origin.kind==='junction',implicitSupport:i.after.indexes.find(x=>x.implicit&&f.columns.every((c,n)=>x.columns[n]===c))||null});continue;}
        if(i.kind==='drop_table'){for(const f of i.before.foreignKeys)add('drop_foreign_key',i.tableId,f,null,safe,i.id);const base=S.clone(i.before);base.foreignKeys=[];add('drop_table',i.tableId,base,null,safety,i.id);continue;}
        if(['table_metadata','relation_metadata'].includes(i.kind)){add('update_metadata',i.tableId,i.before,i.after,safety,i.id,{scope:i.kind});continue;}
        if(i.before&&i.after&&equal(projected(old,oldPhysical,i,i.before),projected(next,newPhysical,i,i.after))){add('update_metadata',i.tableId,i.before,i.after,{...safe,warnings:safety.warnings},i.id,{scope:i.kind.includes('column')?'columns':i.kind.includes('index')?'indexes':i.kind.includes('check')?'checks':i.kind.includes('primary_key')?'primaryKey':'foreignKeys'});continue;}
        if(i.kind==='drop_index'&&i.before.implicit&&table(next,i.tableId).indexes.some(n=>!n.implicit&&i.before.columns.every((c,k)=>n.columns[k]===c)&&!table(old,i.tableId).indexes.some(x=>x.id===n.id)))continue;
        if(i.kind==='add_index'&&i.after.implicit)continue; // created by its FK, not an explicit INDEX
        if(i.kind.startsWith('replace_')){const suffix=i.kind.slice(8);add('drop_'+suffix,i.tableId,i.before,null,safety,i.id);add('add_'+suffix,i.tableId,null,i.after,safety,i.id,{automaticName:false,implicitSupport:suffix==='foreign_key'?table(next,i.tableId).indexes.find(x=>x.implicit&&i.after.columns.every((c,n)=>x.columns[n]===c))||null:null});}
        else {const extra={};if(i.kind==='add_column'){const t=table(next,i.tableId),index=t.columns.findIndex(c=>c.id===i.after.id);extra.afterColumnId=index?t.columns[index-1].id:null;}
            if(i.kind==='add_foreign_key'){extra.automaticName=false;extra.implicitSupport=table(next,i.tableId).indexes.find(x=>x.implicit&&i.after.columns.every((c,n)=>x.columns[n]===c))||null;}
            add(i.kind,i.tableId,i.before,i.after,safety,i.id,extra);}
    }
    // Drop incoming FKs to disappearing tables, plus unchanged constraints
    // that must be temporarily removed around a column modification.
    for(const t of old.tables)for(const f of t.foreignKeys){const touched=operations.some(o=>['drop_table','drop_column','modify_column'].includes(o.kind)&&((o.tableId===f.referencedTableId&&(o.kind==='drop_table'||f.referencedColumns.includes(o.before?.id)))||(o.tableId===t.id&&(o.kind==='drop_table'||f.columns.includes(o.before?.id)))));
        if(touched){add('drop_foreign_key',t.id,f,null,safe,null);const future=table(next,t.id)?.foreignKeys.find(n=>n.id===f.id);if(future&&!operations.some(o=>o.kind==='add_foreign_key'&&o.after.id===f.id))add('add_foreign_key',t.id,null,future,safe,null,{automaticName:false,implicitSupport:table(next,t.id).indexes.find(x=>x.implicit&&future.columns.every((c,n)=>x.columns[n]===c))||null});}}
    for(const o of [...operations])if(o.kind==='modify_column')for(const c of table(old,o.tableId).checks.filter(c=>c.condition.columnId===o.before.id)){add('drop_check',o.tableId,c,null,safe,null);const future=table(next,o.tableId).checks.find(n=>n.id===c.id);if(future&&!operations.some(x=>x.kind==='add_check'&&x.after.id===future.id))add('add_check',o.tableId,null,future,safe,null);}
    for(const o of operations){const dependencies=new Set();for(const p of operations){if(o.id===p.id)continue;
            if(p.kind==='create_table'&&o.tableId===p.tableId&&o.kind!=='create_table')dependencies.add(p.id);
            if(o.kind==='add_foreign_key'&&((p.kind==='create_table'&&p.tableId===o.after.referencedTableId)||(['add_column','modify_column','add_index'].includes(p.kind)&&p.tableId===o.tableId)))dependencies.add(p.id);
            if(o.kind==='add_foreign_key'&&p.kind==='drop_foreign_key')dependencies.add(p.id);
            if(o.kind==='add_check'&&p.kind==='drop_check')dependencies.add(p.id);
            if(o.kind.startsWith('add_')&&p.kind.startsWith('drop_')&&o.tableId===p.tableId&&o.after?.name===p.before?.name)dependencies.add(p.id);
            if(['drop_table','drop_column','modify_column','drop_index'].includes(o.kind)&&p.kind==='drop_foreign_key'&&(p.tableId===o.tableId||p.before.referencedTableId===o.tableId))dependencies.add(p.id);
            if(['drop_column','modify_column'].includes(o.kind)&&p.kind==='drop_check'&&p.tableId===o.tableId&&p.before.condition.columnId===o.before.id)dependencies.add(p.id);
            if(o.kind==='drop_column'&&p.kind==='drop_index'&&p.tableId===o.tableId&&p.before.columns.includes(o.before.id))dependencies.add(p.id);
            if(o.kind==='add_column'&&o.afterColumnId&&p.kind==='add_column'&&p.after.id===o.afterColumnId)dependencies.add(p.id);
            if(o.kind==='add_check'&&['add_column','modify_column'].includes(p.kind)&&p.after.id===o.after.condition.columnId)dependencies.add(p.id);
            if(['add_column','modify_column','add_index'].includes(o.kind)&&['drop_column','drop_index'].includes(p.kind)&&o.tableId===p.tableId)dependencies.add(p.id);
            if(o.kind==='create_table'&&o.after.origin.kind==='junction'&&p.kind==='create_table'&&next.relations.some(r=>r.storage.tableId===o.tableId&&[r.sourceTableId,r.targetTableId].includes(p.tableId)))dependencies.add(p.id);
            if(o.kind==='add_foreign_key'&&o.automaticName&&p.kind==='add_foreign_key'&&p.tableId===o.tableId&&S.compare(p.after.name,o.after.name)<0)dependencies.add(p.id);
            if(o.kind==='update_metadata'&&p.kind!=='update_metadata'&&p.kind!=='unsupported')dependencies.add(p.id);
        }o.dependsOn=[...dependencies].sort(S.compare);}
    operations.sort((a,b)=>S.compare(a.id,b.id));
    return{formatVersion:1,target:diff.target,fromSnapshotSha256:diff.fromSnapshotSha256,toSnapshotSha256:diff.toSnapshotSha256,fromPhysicalSha256:diff.fromPhysicalSha256,toPhysicalSha256:diff.toPhysicalSha256,intents:diff.intents,operations,executionOrder:stableTopologicalOrder(operations),blockers};
}
module.exports={planMysqlMigration};
