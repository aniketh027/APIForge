'use strict';
const S=require('./snapshot'),{equal}=require('./diff');
const classes=['SAFE','REQUIRES_DATA_CHECK','DESTRUCTIVE','UNSUPPORTED'];
function classify(intent,old,next){const {kind,before:a,after:b,tableId}=intent;const requirements=[],warnings=[];let safetyClass='SAFE',reason='PRESERVES_RETAINED_DATA';
    const table=old.tables.find(t=>t.id===tableId),newTable=next.tables.find(t=>t.id===tableId);
    const set=(c,r)=>{if(classes.indexOf(c)>classes.indexOf(safetyClass))safetyClass=c;reason=r;};
    const requireData=(type,scope)=>{requirements.push({type,tableId,...scope});set('REQUIRES_DATA_CHECK',type);};
    const physical=c=>({physicalType:c.physicalType,character:c.character,nullable:c.nullable,default:c.default.physical,generation:c.generation,onUpdate:c.onUpdate});
    if(['drop_table','drop_column'].includes(kind))set('DESTRUCTIVE','REMOVES_ROWS_OR_ASSOCIATIONS');
    if(kind==='reorder_columns'||(kind==='replace_primary_key'&&!equal({name:a.name,columns:a.columns,unique:a.unique,method:a.method},{name:b.name,columns:b.columns,unique:b.unique,method:b.method})))set('UNSUPPORTED',kind.toUpperCase());
    if(kind==='table_metadata'&&!equal(a.identity,b.identity))set('UNSUPPORTED','IDENTITY_INTENT_CHANGE');
    if(kind==='relation_metadata'){
        for(const x of a)for(const y of b)if(x.sourceTableId===y.sourceTableId&&x.targetTableId===y.targetTableId&&(x.cardinality!==y.cardinality||!equal(x.storage,y.storage)))set('UNSUPPORTED','RELATION_TOPOLOGY_CONVERSION');
    }
    if(kind==='modify_column'){
        if(table.primaryKey?.columns.includes(a.id)&&!equal(physical(a),physical(b)))set('UNSUPPORTED','RETAINED_IDENTITY_CHANGE');
        if(a.generation!==b.generation||a.logicalType!==b.logicalType||!equal(a.character,b.character))set('UNSUPPORTED','TYPE_GENERATION_OR_CHARACTER_CONVERSION');
        if(a.origin.kind!==b.origin.kind&&!(['declared','implicit_key'].includes(a.origin.kind)&&['declared','implicit_key'].includes(b.origin.kind)&&equal(physical(a),physical(b))))set('UNSUPPORTED','STORAGE_OWNERSHIP_CHANGE');
        if(!equal(a.physicalType,b.physicalType)){
            if(a.logicalType==='STRING'){if(b.physicalType.length<a.physicalType.length)requireData('VALUES_FIT_STRING_CAPACITY',{columnIds:[a.id],capacity:b.physicalType.length});}
            else if(a.logicalType==='ENUM'){const x=a.physicalType.members,y=b.physicalType.members;if(!x.every((v,i)=>y[i]===v)||y.length<x.length||(x.length<=255)!==(y.length<=255))set('UNSUPPORTED','ENUM_ORDER_OR_STORAGE_CLASS_CHANGE');}
            else set('UNSUPPORTED','PHYSICAL_TYPE_CONVERSION');
        }
        if(a.nullable&&!b.nullable)requireData('NO_NULLS',{columnIds:[a.id]});
        if(!equal(a.default,b.default))warnings.push('Future insert default behavior changes; retained rows are not backfilled.');
    }
    if(kind==='add_column'&&!b.nullable&&!b.default.declared&&b.generation==='none')requireData('TABLE_EMPTY',{columnIds:[b.id]});
    const known=(cid)=>{const c=newTable?.columns.find(c=>c.id===cid);return !table?.columns.some(c=>c.id===cid)?c:undefined;};
    const nullFilled=cols=>cols.every(cid=>{const c=known(cid);return c?.nullable&&!c.default.declared;});
    if(['add_index','replace_index'].includes(kind)&&b.unique&&!nullFilled(b.columns))requireData('UNIQUE_VALUES',{columnIds:b.columns});
    if(kind==='drop_index'&&a.unique)warnings.push('Uniqueness enforcement is removed.');
    if(['add_check','replace_check'].includes(kind)){
        const previous=table?.checks.find(c=>c.condition.columnId===b.condition.columnId&&c.condition.measure===b.condition.measure);
        const implied=previous&&(b.condition.min===null||(previous.condition.min!==null&&previous.condition.min>=b.condition.min))&&(b.condition.max===null||(previous.condition.max!==null&&previous.condition.max<=b.condition.max));
        const c=known(b.condition.columnId),d=c?.default.declared;let staticallyValid=c?.nullable&&!d;
        if(d){const value=b.condition.measure==='char_length'?Array.from(d.value).length:d.value;staticallyValid=(b.condition.min===null||value>=b.condition.min)&&(b.condition.max===null||value<=b.condition.max);}
        if(!implied&&!staticallyValid)requireData('VALUES_SATISFY_CHECK',{condition:b.condition});
    }
    if(kind==='drop_check')warnings.push('CHECK enforcement is removed.');
    if(['add_foreign_key','replace_foreign_key'].includes(kind)){
        if(a&&(!equal(a.columns,b.columns)||a.referencedTableId!==b.referencedTableId||!equal(a.referencedColumns,b.referencedColumns)||a.onDelete!==b.onDelete||a.onUpdate!==b.onUpdate))set('UNSUPPORTED','FK_TARGET_OR_ACTION_CONVERSION');
        if(!nullFilled(b.columns))requireData('NO_ORPHAN_FOREIGN_KEYS',{columnIds:b.columns,referencedTableId:b.referencedTableId,referencedColumnIds:b.referencedColumns});
    }
    if(kind==='drop_foreign_key')warnings.push('Referential enforcement is removed.');
    return{safetyClass,reasonCodes:[reason],requirements,warnings};
}
function authorize(plan,options={}){
    const {fail}=require('./errors');
    if(options.expectPlan!==S.hash(plan))fail('MIGRATION_PLAN_CHANGED','Authorization requires the exact plan SHA-256.');
    if(plan.blockers.length)fail('MIGRATION_UNSUPPORTED_TRANSITION','Plan contains unsupported transitions.',{blockers:plan.blockers});
    const destructive=[...new Set(options.allowDestructiveOperationIds||[])].sort(S.compare),data=[...new Set(options.acknowledgeDataCheckOperationIds||[])].sort(S.compare);
    for(const [selected,kind] of [[destructive,'DESTRUCTIVE'],[data,'REQUIRES_DATA_CHECK']])for(const selectedId of selected){const op=plan.operations.find(o=>o.id===selectedId);if(!op||(kind==='DESTRUCTIVE'?op.safetyClass!==kind:!op.requirements.length))fail('MIGRATION_AUTHORIZATION_REQUIRED','Unknown or inapplicable authorization operation ID.');}
    for(const op of plan.operations)if((op.safetyClass==='DESTRUCTIVE'&&!destructive.includes(op.id))||(op.requirements.length&&!data.includes(op.id)))fail('MIGRATION_AUTHORIZATION_REQUIRED','Explicit operation authorization required.',{operationId:op.id,safetyClass:op.safetyClass,requirements:op.requirements});
    return{planSha256:S.hash(plan),destructiveOperationIds:destructive,dataCheckOperationIds:data};
}
module.exports={classify,authorize,classes};
