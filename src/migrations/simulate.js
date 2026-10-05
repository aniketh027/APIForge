'use strict';
const S=require('./snapshot'),{equal}=require('./diff'),{fail}=require('./errors');
const {applyImplicitIndexEffects,indexName}=require('./mysql-snapshot');
function simulateMigration(old,plan,expected){S.validateSnapshot(old);if(plan.fromSnapshotSha256!==S.snapshotSha256(old))fail('MIGRATION_HEAD_MISMATCH','Simulator base mismatch.');if(plan.blockers.length)fail('MIGRATION_UNSUPPORTED_TRANSITION','Cannot simulate unsupported plan.');
    const state=S.clone(old),altered=new Set(),steps=[],seen=new Set();
    for(const operationId of plan.executionOrder){const op=plan.operations.find(o=>o.id===operationId);if(!op||seen.has(op.id)||op.dependsOn.some(id=>!seen.has(id)))fail('MIGRATION_DEPENDENCY_CYCLE','Invalid execution order.');seen.add(op.id);
        let t=state.tables.find(t=>t.id===op.tableId);
        const check=(actual,expected)=>{if(!equal(actual,expected))fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Operation before-state mismatch.',{operationId:op.id});};
        const mutate=(list)=>{const values=t[list],at=values.findIndex(v=>v.id===op.before?.id);if(op.kind.startsWith('drop_')){if(at<0)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Missing object for drop.');check(values[at],op.before);values.splice(at,1);}else{if(values.some(v=>v.id===op.after.id))fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Duplicate add.');values.push(S.clone(op.after));}};
        if(op.kind==='create_table'){if(t)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Table already exists.');state.tables.push(S.clone(op.after));t=state.tables.find(t=>t.id===op.tableId);}
        else if(op.kind==='drop_table'){if(!t)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Missing table.');check(t,op.before);state.tables=state.tables.filter(v=>v.id!==t.id);}
        else if(op.kind==='add_column'){if(t.columns.some(c=>c.id===op.after.id))fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Column already exists.');const at=op.afterColumnId?t.columns.findIndex(c=>c.id===op.afterColumnId)+1:0;if(op.afterColumnId&&at===0)fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Missing positional predecessor.');t.columns.splice(at,0,S.clone(op.after));}
        else if(op.kind==='drop_column')mutate('columns');
        else if(op.kind==='modify_column'){const at=t.columns.findIndex(c=>c.id===op.before.id);check(t.columns[at],op.before);t.columns[at]=S.clone(op.after);}
        else if(op.kind==='update_metadata'){
            if(op.scope==='relation_metadata'){check(state.relations,op.before);state.relations=S.clone(op.after);}
            else if(op.scope==='table_metadata'){check({logicalRef:t.logicalRef,origin:t.origin,identity:t.identity},op.before);Object.assign(t,S.clone(op.after));}
            else if(op.scope==='primaryKey'){check(t.primaryKey,op.before);t.primaryKey=S.clone(op.after);}
            else {const at=t[op.scope].findIndex(v=>v.id===op.before.id);check(t[op.scope][at],op.before);t[op.scope][at]=S.clone(op.after);}
        }
        else if(op.kind.endsWith('_index')){mutate('indexes');if(op.kind==='add_index')applyImplicitIndexEffects(t,op.after);}
        else if(op.kind.endsWith('_check'))mutate('checks');
        else if(op.kind.endsWith('_foreign_key')){mutate('foreignKeys');if(op.kind==='add_foreign_key'){
            const covers=[t.primaryKey,...t.indexes].filter(Boolean).some(i=>op.after.columns.every((cid,n)=>i.columns[n]===cid));
            if(!covers){const support=op.implicitSupport||{id:S.id('index',t.name,op.after.name),name:indexName(op.after.name,t.indexes),unique:false,method:'BTREE',columns:op.after.columns,purposes:['fk_support'],implicit:true};t.indexes.push(S.clone(support));}
        }}else fail('MIGRATION_UNSUPPORTED_TRANSITION','Unknown operation kind.');
        if(t&&!['create_table','drop_table','update_metadata'].includes(op.kind))altered.add(t.id);
        for(const table of state.tables){table.indexes.sort((a,b)=>S.compare(a.name,b.name));table.checks.sort((a,b)=>S.compare(a.name,b.name));table.foreignKeys.sort((a,b)=>S.compare(a.name,b.name));}
        state.tables.sort((a,b)=>S.compare(a.name,b.name));S.validatePhysical(state,altered);steps.push({operationId:op.id,physicalSha256:S.physicalSha256(state)});
    }
    if(seen.size!==plan.operations.length||S.physicalSha256(state)!==plan.toPhysicalSha256||(expected&&S.physicalSha256(state)!==S.physicalSha256(expected)))fail('MIGRATION_INTERMEDIATE_UNREPRESENTABLE','Simulation did not reach the exact target physical state.');
    return{snapshot:state,steps,physicalSha256:S.physicalSha256(state)};
}
module.exports={simulateMigration};
