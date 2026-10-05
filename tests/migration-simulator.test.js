'use strict';
const assert=require('assert/strict'),{compileSourceForSnapshot:c}=require('../src/migrations/compile-source'),{planMysqlMigration:p}=require('../src/migrations/mysql-plan'),{simulateMigration:s}=require('../src/migrations/simulate');
const cases=[['ENTITY Item\nv STRING','ENTITY Item\nv STRING\nx INT'],['ENTITY Item\nv INT MIN 0','ENTITY Item\nv INT MIN -1'],['ENTITY Item\nv STRING','ENTITY Item\nid INT PRIMARY KEY\nv STRING'],['ENTITY Item\nv STRING','ENTITY Item\nv STRING\nENTITY Parent\nk UUID PRIMARY KEY\nRELATION Parent LINKS Item ONE_TO_MANY'],['ENTITY Item\nv STRING\nENTITY Parent\nk UUID PRIMARY KEY\nRELATION Parent LINKS Item ONE_TO_MANY','ENTITY Item\nv STRING']];
let checks=0;for(const [from,to] of cases){const a=c(from),b=c(to),plan=p(a,b);s(a,plan,b);checks++;if(plan.operations.length){const broken=structuredClone(plan);broken.executionOrder.pop();assert.throws(()=>s(a,broken,b));checks++;}}
console.log('G26 simulation: '+checks+' checks PASS.');
