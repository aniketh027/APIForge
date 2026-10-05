'use strict';
const S = require('./snapshot');
const mysql = require('../utils/mysql-target');
const { authorize } = require('./mysql-safety');
const { planMysqlMigration } = require('./mysql-plan');
const { simulateMigration } = require('./simulate');
const { fail } = require('./errors');

function renderMysqlMigration(old, next, plan, options = {}) {
    // Reconstruct all policy and graph facts before accepting a caller's plan.
    if (S.canonical(planMysqlMigration(old, next)) !== S.canonical(plan))
        fail('MIGRATION_PLAN_CHANGED', 'Plan does not match its exact validated snapshots.');
    const authorization = authorize(plan, options);
    const simulation = simulateMigration(old, plan, next);
    const tables = new Map([...old.tables, ...next.tables].map(t => [t.id, t]));
    const q = mysql.quoteIdentifier;
    const columnName = (t, cid) => q(t.columns.find(c => c.id === cid).name);
    const columns = (t, ids) => ids.map(cid => columnName(t, cid)).join(', ');
    const index = (t, i) => `${i.unique ? 'UNIQUE ' : ''}INDEX ${q(i.name)} (${columns(t, i.columns)}) USING ${i.method}`;
    const check = (t, c) => `CONSTRAINT ${q(c.name)} CHECK (${mysql.renderCheckCondition(t.columns.find(v => v.id === c.condition.columnId).name, c.condition)}) ENFORCED`;
    const foreign = (t, f, automatic) => `${automatic ? '' : `CONSTRAINT ${q(f.name)} `}FOREIGN KEY (${columns(t, f.columns)}) REFERENCES ${q(tables.get(f.referencedTableId).name)} (${columns(tables.get(f.referencedTableId), f.referencedColumns)}) ON DELETE ${f.onDelete} ON UPDATE ${f.onUpdate}`;
    const statements = [];
    for (const operationId of plan.executionOrder) {
        const op = plan.operations.find(o => o.id === operationId), t = tables.get(op.tableId);
        if (op.kind === 'update_metadata') continue;
        let sql;
        if (op.kind === 'create_table') {
            const value = op.after, definitions = value.columns.map(mysql.renderCompleteColumn);
            if (value.primaryKey) definitions.push(`PRIMARY KEY (${columns(value, value.primaryKey.columns)}) USING BTREE`);
            definitions.push(...value.indexes.map(i => index(value, i)), ...value.checks.map(c => check(value, c)));
            sql = `CREATE TABLE ${q(value.name)} (\n    ${definitions.join(',\n    ')}\n) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
        } else if (op.kind === 'drop_table') sql = `DROP TABLE ${q(t.name)};`;
        else {
            const prefix = `ALTER TABLE ${q(t.name)} `;
            switch (op.kind) {
                case 'add_column': sql = prefix + `ADD COLUMN ${mysql.renderCompleteColumn(op.after)} ${op.afterColumnId ? `AFTER ${columnName(t, op.afterColumnId)}` : 'FIRST'};`; break;
                case 'modify_column': sql = prefix + `MODIFY COLUMN ${mysql.renderCompleteColumn(op.after)};`; break;
                case 'drop_column': sql = prefix + `DROP COLUMN ${q(op.before.name)};`; break;
                case 'add_index': sql = prefix + 'ADD ' + index(t, op.after) + ';'; break;
                case 'drop_index': sql = prefix + `DROP INDEX ${q(op.before.name)};`; break;
                case 'add_check': sql = prefix + 'ADD ' + check(t, op.after) + ';'; break;
                case 'drop_check': sql = prefix + `DROP CHECK ${q(op.before.name)};`; break;
                case 'add_foreign_key': sql = prefix + 'ADD ' + foreign(t, op.after, op.automaticName) + ';'; break;
                case 'drop_foreign_key': sql = prefix + `DROP FOREIGN KEY ${q(op.before.name)};`; break;
                default: fail('MIGRATION_UNSUPPORTED_TRANSITION', 'Operation is outside the G26 V1 executable vocabulary.');
            }
        }
        statements.push({ operationId, sql });
    }
    const requirements = plan.operations.filter(o => o.requirements.length).map(o => ({ operationId: o.id, requirements: o.requirements }));
    // Canonical one-line comments also safely encode embedded LF/CR in literals.
    const facts = { migrationId: S.hash(plan), fromSnapshotSha256: plan.fromSnapshotSha256, toSnapshotSha256: plan.toSnapshotSha256,
        profile: S.profile.name, authorization, prerequisites: requirements, operations: plan.operations.map(o => ({ operationId: o.id, safetyClass: o.safetyClass, warnings: o.warnings })) };
    const sql = statements.length ? '-- APIForge G26 offline one-shot migration. Quiesce writes and verify the prior physical state.\n' +
        '-- Data-check acknowledgement is an operator assertion; APIForge has not executed prerequisite queries.\n' +
        '-- Review every prerequisite before executing any DDL. MySQL DDL is not transactionally rollbackable.\n' +
        '-- ' + S.canonical(facts).trimEnd() + '\n' +
        "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;\nSET SESSION time_zone = '+00:00';\nSET SESSION explicit_defaults_for_timestamp = ON;\n\n" +
        statements.map(s => `-- operation ${s.operationId}\n${s.sql}`).join('\n\n') + '\n' : null;
    return { sql, statements, authorization, requirements, simulation };
}
module.exports = { renderMysqlMigration };
