'use strict';
const mysql = require('../utils/mysql-target');
const q = mysql.quoteIdentifier;

// A read-only query specification, never a database operation. A zero-row
// result is required. New static columns project their declared literal;
// unknown non-null new columns require an empty table rather than invented data.
function describeRequirement(type, scope, old, next) {
    const table = old.tables.find(t => t.id === scope.tableId), future = next.tables.find(t => t.id === scope.tableId);
    const ids = scope.columnIds || [scope.condition.columnId];
    const expression = (cid, alias = '') => {
        const existing = table.columns.find(c => c.id === cid), added = future.columns.find(c => c.id === cid);
        if (existing) return (alias ? alias + '.' : '') + q(existing.name);
        if (!added.default.declared) return added.nullable ? 'NULL' : null;
        let sql = mysql.formatSQLLiteral(added.default.physical, added.logicalType === 'ENUM');
        if (added.character) sql = `CONVERT(${sql} USING ${added.character.characterSet}) COLLATE ${added.character.collation}`;
        return sql;
    };
    const values = ids.map(cid => expression(cid));
    let checkSql;
    if (type === 'TABLE_EMPTY' || values.includes(null)) checkSql = `SELECT 1 FROM ${q(table.name)} LIMIT 1;`;
    else if (type === 'NO_NULLS') checkSql = `SELECT 1 FROM ${q(table.name)} WHERE ${values.map(v => v + ' IS NULL').join(' OR ')} LIMIT 1;`;
    else if (type === 'UNIQUE_VALUES') checkSql = `SELECT 1 FROM ${q(table.name)} WHERE ${values.map(v => v + ' IS NOT NULL').join(' AND ')} GROUP BY ${values.join(', ')} HAVING COUNT(*) > 1 LIMIT 1;`;
    else if (type === 'VALUES_FIT_STRING_CAPACITY') checkSql = `SELECT 1 FROM ${q(table.name)} WHERE CHAR_LENGTH(${values[0]}) > ${scope.capacity} LIMIT 1;`;
    else if (type === 'VALUES_SATISFY_CHECK') {
        const c = scope.condition, value = c.measure === 'char_length' ? `CHAR_LENGTH(${values[0]})` : values[0];
        const condition = [c.min === null ? null : `${value} >= ${c.min}`, c.max === null ? null : `${value} <= ${c.max}`].filter(Boolean).join(' AND ');
        checkSql = `SELECT 1 FROM ${q(table.name)} WHERE ${values[0]} IS NOT NULL AND NOT (${condition}) LIMIT 1;`;
    } else if (type === 'NO_ORPHAN_FOREIGN_KEYS') {
        const parent = old.tables.find(t => t.id === scope.referencedTableId), child = ids.map(cid => expression(cid, 'child'));
        const notNull = child.map(v => v + ' IS NOT NULL').join(' AND ');
        const missing = parent ? ` AND NOT EXISTS (SELECT 1 FROM ${q(parent.name)} parent WHERE ${scope.referencedColumnIds.map((cid, n) => 'parent.' + q(parent.columns.find(c => c.id === cid).name) + ' = ' + child[n]).join(' AND ')})` : '';
        checkSql = `SELECT 1 FROM ${q(table.name)} child WHERE ${notNull}${missing} LIMIT 1;`;
    } else throw Error('Unknown MySQL data-check specification.');
    return { type, ...scope, checkSpecification: { version: 1, evaluation: 'Prior physical schema, before any migration DDL, with writes quiesced and mysql-8.4-v1 session settings.', success: 'Query returns zero rows.', checkSql } };
}
module.exports = { describeRequirement };
