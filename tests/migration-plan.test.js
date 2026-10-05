'use strict';
const assert=require('assert/strict'),{stableTopologicalOrder}=require('../src/migrations/plan'),{compileSourceForSnapshot:c}=require('../src/migrations/compile-source'),{planMysqlMigration:p}=require('../src/migrations/mysql-plan'),S=require('../src/migrations/snapshot');
const a=c('ENTITY Item\nv INT MIN 0'),b=c('ENTITY Item\nv INT MAX 10\nx STRING');assert.equal(S.canonical(p(a,b)),S.canonical(p(a,b)));
const ops=[{id:'b',kind:'add_column',tableId:'t',objectId:'b',dependsOn:['a']},{id:'a',kind:'create_table',tableId:'t',objectId:'a',dependsOn:[]}];assert.deepEqual(stableTopologicalOrder(ops),['a','b']);assert.deepEqual(stableTopologicalOrder(ops.reverse()),['a','b']);ops[1].dependsOn=['b'];assert.throws(()=>stableTopologicalOrder(ops),{code:'MIGRATION_DEPENDENCY_CYCLE'});
console.log('G26 planner: 4 checks PASS.');
