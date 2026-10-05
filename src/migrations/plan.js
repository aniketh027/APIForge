'use strict';
const {compare}=require('./snapshot'),{fail}=require('./errors');
const priority={drop_foreign_key:0,drop_check:1,drop_index:2,drop_column:3,drop_table:4,create_table:5,modify_column:6,add_column:6,add_index:7,add_check:8,add_foreign_key:9,update_metadata:10,unsupported:11};
function stableTopologicalOrder(operations){const byId=new Map(operations.map(o=>[o.id,o]));if(byId.size!==operations.length)fail('MIGRATION_DEPENDENCY_CYCLE','Duplicate operation IDs.');
    const remaining=new Map(operations.map(o=>[o.id,new Set(o.dependsOn)])),result=[];
    for(const [id,edges] of remaining)for(const edge of edges)if(!byId.has(edge)||edge===id)fail('MIGRATION_DEPENDENCY_CYCLE','Invalid dependency edge.',{id,edge});
    const sort=(a,b)=>(priority[a.kind]-priority[b.kind])||compare(a.tableId||'',b.tableId||'')||compare(a.objectId||'',b.objectId||'')||compare(a.id,b.id);
    while(remaining.size){const ready=[...remaining].filter(([,edges])=>!edges.size).map(([id])=>byId.get(id)).sort(sort);if(!ready.length)fail('MIGRATION_DEPENDENCY_CYCLE','Operation dependency cycle.',{edges:[...remaining].map(([id,edges])=>({id,dependsOn:[...edges]}))});const op=ready[0];result.push(op.id);remaining.delete(op.id);for(const edges of remaining.values())edges.delete(op.id);}
    return result;
}
module.exports={stableTopologicalOrder};
