'use strict';
const assert=require('assert/strict'),{compileSourceForSnapshot:c}=require('../src/migrations/compile-source'),{planMysqlMigration:p}=require('../src/migrations/mysql-plan'),{simulateMigration:s}=require('../src/migrations/simulate');
const cases=[['ENTITY Item\nv STRING','ENTITY Item\nv STRING\nx INT'],['ENTITY Item\nv INT MIN 0','ENTITY Item\nv INT MIN -1'],['ENTITY Item\nv STRING','ENTITY Item\nid INT PRIMARY KEY\nv STRING'],['ENTITY Item\nv STRING','ENTITY Item\nv STRING\nENTITY Parent\nk UUID PRIMARY KEY\nRELATION Parent LINKS Item ONE_TO_MANY'],['ENTITY Item\nv STRING\nENTITY Parent\nk UUID PRIMARY KEY\nRELATION Parent LINKS Item ONE_TO_MANY','ENTITY Item\nv STRING']];
let checks=0;for(const [from,to] of cases){const a=c(from),b=c(to),plan=p(a,b);s(a,plan,b);checks++;if(plan.operations.length){const broken=structuredClone(plan);broken.executionOrder.pop();assert.throws(()=>s(a,broken,b));checks++;}}
const many=Array.from({length:1016},(_,n)=>'v'+n+' INT');
const old=c('ENTITY Wide\n'+many.join('\n')),next=c('ENTITY Wide\n'+many.slice(1).join('\n')+'\nx INT');
const capacityPlan=p(old,next);s(old,capacityPlan,next);checks++;
assert(capacityPlan.executionOrder.indexOf(capacityPlan.operations.find(o=>o.kind==='drop_column').id)<capacityPlan.executionOrder.indexOf(capacityPlan.operations.find(o=>o.kind==='add_column').id));checks++;
const indexFields=Array.from({length:63},(_,n)=>'v'+n+' INT UNIQUE');
const ixOld=c('ENTITY Indexed\n'+indexFields.join('\n')+'\nx INT'),ixNext=c('ENTITY Indexed\n'+indexFields.join('\n').replace('v0 INT UNIQUE','v0 INT')+'\nx INT UNIQUE');
s(ixOld,p(ixOld,ixNext),ixNext);checks++;
const fixed=Array.from({length:224},(_,n)=>'u'+n+' UUID').join('\n')+'\ni INT\nj INT\nb BOOLEAN\nc BOOLEAN';
const full=c('ENTITY Record\n'+fixed),altered=c('ENTITY Record\n'+fixed.replace('b BOOLEAN','b BOOLEAN DEFAULT FALSE'));
assert.throws(()=>s(full,p(full,altered),altered),{code:'MIGRATION_INTERMEDIATE_UNREPRESENTABLE'});checks++;
for(const [from,to] of cases){const a=c(from),b=c(to),plan=p(a,b);for(const op of plan.operations){const broken=structuredClone(plan);broken.executionOrder=broken.executionOrder.filter(id=>id!==op.id);broken.operations=broken.operations.filter(o=>o.id!==op.id);assert.throws(()=>s(a,broken,b));checks++;}}
console.log('G26 simulation: '+checks+' checks PASS.');
