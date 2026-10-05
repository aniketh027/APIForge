'use strict';
const S=require('./snapshot');
const equal=(a,b)=>S.canonical(a)===S.canonical(b);
function diffSnapshots(oldSnapshot,newSnapshot){S.validateSnapshot(oldSnapshot);S.validateSnapshot(newSnapshot);
    const intents=[];
    function add(kind,tableId,before,after,objectId){const data={kind,tableId,objectId,before:before??null,after:after??null};intents.push({id:S.hash(data),...data});}
    function compareCollection(old,next,key,scope,addKind,dropKind,changeKind){const a=new Map(old.map(v=>[key(v),v])),b=new Map(next.map(v=>[key(v),v]));for(const name of [...new Set([...a.keys(),...b.keys()])].sort(S.compare)){const x=a.get(name),y=b.get(name);if(!x)add(addKind,scope,null,y,y.id);else if(!y)add(dropKind,scope,x,null,x.id);else if(!equal(x,y))add(changeKind,scope,x,y,x.id);}}
    const oldTables=new Map(oldSnapshot.tables.map(t=>[t.name,t])),newTables=new Map(newSnapshot.tables.map(t=>[t.name,t]));
    for(const name of [...new Set([...oldTables.keys(),...newTables.keys()])].sort(S.compare)){const a=oldTables.get(name),b=newTables.get(name);if(!a){add('create_table',b.id,null,b,b.id);continue;}if(!b){add('drop_table',a.id,a,null,a.id);continue;}
        compareCollection(a.columns,b.columns,c=>c.name,a.id,'add_column','drop_column','modify_column');
        for(const [key,kinds] of [['indexes',['add_index','drop_index','replace_index']],['checks',['add_check','drop_check','replace_check']],['foreignKeys',['add_foreign_key','drop_foreign_key','replace_foreign_key']]])compareCollection(a[key],b[key],v=>v.name,a.id,...kinds);
        if(!equal(a.primaryKey,b.primaryKey))add('replace_primary_key',a.id,a.primaryKey,b.primaryKey,a.primaryKey?.id||b.primaryKey?.id);
        const metadata=t=>({logicalRef:t.logicalRef,origin:t.origin,identity:t.identity});if(!equal(metadata(a),metadata(b)))add('table_metadata',a.id,metadata(a),metadata(b),a.id);
        const retained=a.columns.filter(c=>b.columns.some(n=>n.name===c.name)).map(c=>c.name),next=b.columns.filter(c=>a.columns.some(n=>n.name===c.name)).map(c=>c.name);if(!equal(retained,next))add('reorder_columns',a.id,retained,next,a.id);
    }
    if(!equal(oldSnapshot.relations,newSnapshot.relations))add('relation_metadata',null,oldSnapshot.relations,newSnapshot.relations,'relations');
    return{formatVersion:1,target:oldSnapshot.target,fromSnapshotSha256:S.snapshotSha256(oldSnapshot),toSnapshotSha256:S.snapshotSha256(newSnapshot),fromPhysicalSha256:S.physicalSha256(oldSnapshot),toPhysicalSha256:S.physicalSha256(newSnapshot),intents};
}
module.exports={diffSnapshots,equal};
