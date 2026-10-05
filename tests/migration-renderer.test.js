'use strict';
const assert = require('assert/strict');
const S = require('../src/migrations/snapshot');
const { compileSourceForSnapshot: c } = require('../src/migrations/compile-source');
const { planMysqlMigration: p } = require('../src/migrations/mysql-plan');
const { renderMysqlMigration: r } = require('../src/migrations/mysql-renderer');
let checks = 0;
for (const [from, to] of [
    ['ENTITY Item\nv STRING', 'ENTITY Item\nv STRING MAX_LENGTH 300 DEFAULT "a\\b"\nx TIMESTAMP'],
    ['ENTITY Item\nv INT MIN 0', 'ENTITY Item\nv INT MIN -1'],
    ['ENTITY Item\nv STRING', 'ENTITY Item\nid INT PRIMARY KEY\nv STRING'],
    ['ENTITY Item\nv STRING', 'ENTITY Item\nv STRING\nENTITY Other\nv INT\nRELATION Item MANY Other MANY_TO_MANY']
]) {
    const a = c(from), b = c(to), plan = p(a, b), options = { expectPlan: S.hash(plan), acknowledgeDataCheckOperationIds: plan.operations.filter(o => o.requirements.length).map(o => o.id) };
    const result = r(a, b, plan, options);
    assert.deepEqual(result, r(a, b, plan, options)); checks++;
    assert(!result.sql || !/IF EXISTS|IF NOT EXISTS|FOREIGN_KEY_CHECKS|ALTER IGNORE/.test(result.sql)); checks++;
    if (result.sql) assert(result.sql.includes('APIForge has not executed prerequisite queries'));
}
const a = c('ENTITY Item\nv STRING MAX_LENGTH 300'), b = c('ENTITY Item\nv STRING');
const plan = p(a, b);
assert.throws(() => r(a, b, plan, { expectPlan: S.hash(plan) }), { code: 'MIGRATION_AUTHORIZATION_REQUIRED' }); checks++;
const result = r(a, b, plan, { expectPlan: S.hash(plan), acknowledgeDataCheckOperationIds: plan.operations.filter(o => o.requirements.length).map(o => o.id) });
assert(result.sql.includes('VALUES_FIT_STRING_CAPACITY')); checks++;
console.log(`G26 renderer: ${checks} checks PASS.`);
