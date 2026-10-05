// Supported target: MySQL >=8.0.16, utf8mb4, InnoDB DYNAMIC, 16 KiB pages.
// Schema admission under the documented target; never reads server variables.
const names = require('./target-names');
const policy = require('../planning/effective-policy');
const { projectDefinitions } = require('../planning/effective-schema');
const IDENTIFIER_LIMIT = 64, KEY_BYTES = 3072, CHARACTER_BYTES = 4;
const VARCHAR_CAPACITY = Math.floor((65535 - 2) / CHARACTER_BYTES);
const COLUMN_LIMIT = 1017, SECONDARY_INDEX_LIMIT = 64, KEY_PART_LIMIT = 16;
// Stock MySQL's SQL-layer max_keys() includes PRIMARY, unlike the InnoDB
// secondary-index limit. Native 8.4 imports confirm the effective 63 boundary.
const INDEX_LIMIT = 64;
const LOGICAL_ROW_BYTES = 65535, LOCAL_RECORD_BYTES = 8125;
const FLOAT_MAX = (2 - 2 ** -23) * 2 ** 127;
const INTERNAL_COLUMNS = new Set(['db_row_id', 'db_trx_id', 'db_roll_ptr']);
const capacity = field => Math.max(255, ...(field.validations || [])
    .filter(v => ['MIN_LENGTH', 'MAX_LENGTH'].includes(v.type)).map(v => v.value));
function formatSQLLiteral(defaultValue, enumLiteral = false) {
    if (!defaultValue) return '';
    if (defaultValue.type === 'STRING') {
        const value = String(defaultValue.value);
        // DSL backslashes are literal. Preserve them for STRING and ENUM under
        // the supported MySQL mode (NO_BACKSLASH_ESCAPES disabled).
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
        return `'${escaped}'`;
    }
    if (defaultValue.type === 'NUMBER') {
        return String(defaultValue.value);
    }
    if (defaultValue.type === 'BOOLEAN') {
        return defaultValue.value ? 'TRUE' : 'FALSE';
    }
    return '';
}

/**
 * Resolves a field's MySQL column type. STRING keeps the legacy VARCHAR(255)
 * capacity unless a declared length bound requires a wider column.
 *
 * @param {Object} field - Field definition extracted from IR
 * @returns {string} - MySQL column type
 */
function columnType(field) {
    return renderPhysicalType(describeColumnType(field), describeCharacter(field));
}

// One structured physical vocabulary shared by CREATE, snapshots and ALTER.
function describeColumnType(field) {
    if (!field) return null;
    if (field.dataType === 'STRING') return { kind: 'VARCHAR', length: Math.max(255,
        ...(Array.isArray(field.validations) ? field.validations : []).filter(v =>
            ['MIN_LENGTH','MAX_LENGTH'].includes(v.type) && Number.isInteger(v.value) && v.value >= 0).map(v => v.value)) };
    if (field.dataType === 'ENUM') return { kind: 'ENUM', members: [...field.enumValues] };
    if (field.dataType === 'UUID') return { kind: 'CHAR', length: 36 };
    if (field.dataType === 'BOOLEAN') return { kind: 'TINYINT', displayWidth: 1 };
    if (field.dataType === 'TIMESTAMP') return { kind: 'TIMESTAMP', precision: 0 };
    return { kind: field.dataType };
}
function describeCharacter(field, inherited = {characterSet:'utf8mb4',collation:'utf8mb4_unicode_ci'}) {
    if (field?.dataType === 'UUID') return {source:'explicit',characterSet:'ascii',collation:'ascii_bin'};
    if (field?.dataType === 'ENUM') return {source:'explicit',characterSet:'utf8mb4',collation:'utf8mb4_bin'};
    if (field?.dataType === 'STRING') return {source:'inherited',...inherited};
    return null;
}
function renderPhysicalType(type, character, resolveInherited = false) {
    if (!type) return undefined;
    let sql = type.kind === 'ENUM' ? `ENUM(${type.members.map(value => formatSQLLiteral({type:'STRING',value},true)).join(', ')})`
        : type.kind === 'TINYINT' && type.displayWidth === 1 ? 'BOOLEAN'
        : ['VARCHAR','CHAR'].includes(type.kind) ? `${type.kind}(${type.length})` : type.kind;
    if (character && (character.source === 'explicit' || resolveInherited)) sql += ` CHARACTER SET ${character.characterSet} COLLATE ${character.collation}`;
    return sql;
}

function renderCheckCondition(name, condition) {
    const value = condition.measure === 'char_length' ? `CHAR_LENGTH(${quoteIdentifier(name)})` : quoteIdentifier(name);
    return [condition.min === null ? null : `${value} >= ${condition.min}`,
        condition.max === null ? null : `${value} <= ${condition.max}`].filter(Boolean).join(' AND ');
}

// ALTER must supply every resulting attribute; it cannot rely on omitted
// attributes surviving MODIFY. Types, literals and identifiers use CREATE's
// presentation primitives. Constraint objects are rendered separately.
function renderCompleteColumn(column) {
    let sql = `${quoteIdentifier(column.name)} ${renderPhysicalType(column.physicalType, column.character, true)} ${column.nullable ? 'NULL' : 'NOT NULL'}`;
    const value = column.default.physical;
    if (value.kind === 'null') sql += ' DEFAULT NULL';
    if (value.kind === 'literal') sql += ` DEFAULT ${formatSQLLiteral(value, column.logicalType === 'ENUM')}`;
    if (column.generation === 'auto_increment') sql += ' AUTO_INCREMENT';
    return sql;
}

const MYSQL_RESERVED_WORDS = new Set([
    'LATERAL', 'INTERSECT', 'ARRAY', 'MEMBER',
    'ACCESSIBLE', 'ADD', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC', 'ASENSITIVE',
    'BEFORE', 'BETWEEN', 'BIGINT', 'BINARY', 'BLOB', 'BOTH', 'BY', 'CALL', 'CASCADE',
    'CASE', 'CHANGE', 'CHAR', 'CHARACTER', 'CHECK', 'COLLATE', 'COLUMN', 'CONDITION',
    'CONSTRAINT', 'CONTINUE', 'CONVERT', 'CREATE', 'CROSS', 'CUBE', 'CUME_DIST',
    'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR',
    'DATABASE', 'DATABASES', 'DAY_HOUR', 'DAY_MICROSECOND', 'DAY_MINUTE', 'DAY_SECOND',
    'DEC', 'DECIMAL', 'DECLARE', 'DEFAULT', 'DELAYED', 'DELETE', 'DENSE_RANK', 'DESC',
    'DESCRIBE', 'DETERMINISTIC', 'DISTINCT', 'DISTINCTROW', 'DIV', 'DOUBLE', 'DROP',
    'DUAL', 'EACH', 'ELSE', 'ELSEIF', 'EMPTY', 'ENCLOSED', 'ESCAPED', 'EXCEPT',
    'EXISTS', 'EXIT', 'EXPLAIN', 'FALSE', 'FETCH', 'FIRST_VALUE', 'FLOAT', 'FLOAT4',
    'FLOAT8', 'FOR', 'FORCE', 'FOREIGN', 'FROM', 'FULLTEXT', 'FUNCTION', 'GENERATED',
    'GET', 'GRANT', 'GROUP', 'GROUPING', 'GROUPS', 'HAVING', 'HIGH_PRIORITY',
    'HOUR_MICROSECOND', 'HOUR_MINUTE', 'HOUR_SECOND', 'IF', 'IGNORE', 'IN', 'INDEX',
    'INFILE', 'INNER', 'INOUT', 'INSENSITIVE', 'INSERT', 'INT', 'INT1', 'INT2', 'INT3',
    'INT4', 'INT8', 'INTEGER', 'INTERVAL', 'INTO', 'IO_AFTER_GTIDS', 'IO_BEFORE_GTIDS',
    'IS', 'ITERATE', 'JOIN', 'JSON_TABLE', 'KEY', 'KEYS', 'KILL', 'LAG', 'LAST_VALUE',
    'LEAD', 'LEADING', 'LEAVE', 'LEFT', 'LIKE', 'LIMIT', 'LINEAR', 'LINES', 'LOAD',
    'LOCALTIME', 'LOCALTIMESTAMP', 'LOCK', 'LONG', 'LONGBLOB', 'LONGTEXT', 'LOOP',
    'LOW_PRIORITY', 'MASTER_BIND', 'MASTER_SSL_VERIFY_SERVER_CERT', 'MATCH', 'MAXVALUE',
    'MEDIUMBLOB', 'MEDIUMINT', 'MEDIUMTEXT', 'MIDDLEINT', 'MINUTE_MICROSECOND',
    'MINUTE_SECOND', 'MOD', 'MODIFIES', 'NATURAL', 'NOT', 'NO_WRITE_TO_BINLOG', 'NTH_VALUE',
    'NTILE', 'NULL', 'NUMERIC', 'OF', 'ON', 'OPTIMIZE', 'OPTIMIZER_COSTS', 'OPTION',
    'OPTIONALLY', 'OR', 'ORDER', 'OUT', 'OUTER', 'OUTFILE', 'OVER', 'PARTITION',
    'PERCENT_RANK', 'PRECISION', 'PRIMARY', 'PROCEDURE', 'PURGE', 'RANGE', 'RANK',
    'READ', 'READS', 'READ_WRITE', 'REAL', 'RECURSIVE', 'REF_SYSTEM_ID', 'REFERENCES',
    'REGEXP', 'RELEASE', 'RENAME', 'REPEAT', 'REPLACE', 'REQUIRE', 'RESIGNAL', 'RESTRICT',
    'RETURN', 'REVOKE', 'RIGHT', 'RLIKE', 'ROW', 'ROWS', 'ROW_NUMBER', 'SCHEMA',
    'SCHEMAS', 'SECOND_MICROSECOND', 'SELECT', 'SENSITIVE', 'SEPARATOR', 'SET', 'SHOW',
    'SIGNAL', 'SMALLINT', 'SPATIAL', 'SPECIFIC', 'SQL', 'SQLEXCEPTION', 'SQLSTATE',
    'SQLWARNING', 'SQL_BIG_RESULT', 'SQL_CALC_FOUND_ROWS', 'SQL_SMALL_RESULT', 'SSL',
    'STARTING', 'STORED', 'STRAIGHT_JOIN', 'SYSTEM', 'TABLE', 'TERMINATED', 'THEN',
    'TINYBLOB', 'TINYINT', 'TINYTEXT', 'TO', 'TRAILING', 'TRIGGER', 'TRUE', 'UNDO',
    'UNION', 'UNIQUE', 'UNLOCK', 'UNSIGNED', 'UPDATE', 'USAGE', 'USE', 'USING',
    'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'VALUES', 'VARBINARY', 'VARCHAR',
    'VARCHARACTER', 'VARYING', 'VIRTUAL', 'WHEN', 'WHERE', 'WHILE', 'WINDOW', 'WITH',
    'WRITE', 'XOR', 'YEAR_MONTH', 'ZEROFILL'
]);

/**
 * Quotes an identifier with backticks if it is a MySQL reserved word or contains non-alphanumeric chars.
 */
function quoteIdentifier(name) {
    if (!name || typeof name !== 'string') return name;
    if (MYSQL_RESERVED_WORDS.has(name.toUpperCase()) || /^[^a-zA-Z_]/.test(name) || /[^a-zA-Z0-9_]/.test(name)) {
        return `\`${name}\``;
    }
    return name;
}
function storageBytes(field) {
    if (field.dataType === 'STRING') return capacity(field) * CHARACTER_BYTES;
    if (field.dataType === 'ENUM') return (field.enumValues || []).length <= 255 ? 1 : 2;
    return { INT: 4, FLOAT: 4, BOOLEAN: 1, DATE: 3, TIMESTAMP: 4, UUID: 36 }[field.dataType] || 0;
}

// Original node identity lives in this adapter-local context, outside plan and
// provenance. Legacy semantic callers retain their exact contributor objects.
function sourceContext(candidate, definitions = candidate.definitions) {
    const entities = new Map(), fields = new Map(), relations = new Map();
    const entityList = [], relationList = [];
    for (const [index, entity] of candidate.plan.entities.entries()) {
        const source = definitions?.entities?.[index] || policy.legacyEntity(entity, candidate.provenance);
        entityList.push(source); entities.set(entity.id, source);
        const seen = new Set();
        for (const field of policy.fieldViews(entity)) if (!seen.has(field.id)) {
            fields.set(field.id, source.fields?.[field.declaredOrder] || policy.legacyField(field, candidate.provenance));
            seen.add(field.id);
        }
    }
    for (const [index, relation] of candidate.plan.relations.entries()) {
        const source = definitions?.relations?.[index] || policy.legacyRelation(relation, candidate.plan, candidate.provenance);
        relationList.push(source); relations.set(relation.id, source);
    }
    return { entities, fields, relations, entityList, relationList };
}

function physicalPlan(entities, relations = []) {
    return physicalPlanFromPlan(projectDefinitions(entities, relations));
}

function physicalPlanFromPlan(input, suppliedSources) {
    const candidate = input.plan ? input : { plan: input, provenance: {} };
    const sources = suppliedSources || sourceContext(candidate);
    const plan = candidate.plan, byId = new Map(plan.entities.map(entity => [entity.id, entity]));
    const typeField = fieldId => {
        const raw = sources.fields.get(fieldId);
        if (raw) return raw;
        for (const entity of plan.entities) {
            const field = entity.fields.find(field => field.id === fieldId);
            if (field) return field.origin.kind === 'implicit_key'
                ? { name: field.name, dataType: field.dataType } : field;
        }
    };
    const tables = plan.entities.map((entity, index) => {
        const key = policy.identity(entity), node = sources.entityList?.[index] || sources.entities.get(entity.id);
        const rawField = field => node.fields?.[field.declaredOrder] || sources.fields.get(field.id) || field;
        const columns = policy.fieldViews(entity, 'base').map(field => ({ name: field.name,
            field: field.origin.kind === 'declared' ? rawField(field) : { name: field.name, dataType: field.dataType },
            node: field.origin.kind === 'declared' ? rawField(field) : node,
            nullable: field.storage.nullable, origin: field.origin.kind === 'declared' ? 'declared' : 'implicit' }));
        const indexes = [{ kind: 'PRIMARY', parts: [key.name], node: key.origin === 'explicit' ? rawField(key.field) : node }];
        for (const field of policy.fieldViews(entity)) if (field.storage.unique) {
            indexes.push({ kind: 'UNIQUE', parts: [field.name], node: rawField(field) });
        }
        return { name: entity.names.table, node, columns, indexes, altered: false };
    });
    const tableById = new Map(plan.entities.map((entity, index) => [entity.id, tables[index]]));
    const support = (table, parts, node) => {
        if (!table.indexes.some(index => parts.every((part, i) => index.parts[i] === part))) {
            table.indexes.push({ kind: 'FK', parts, node });
        }
    };
    for (const [index, relation] of plan.relations.entries()) {
        const storage = relation.storage, node = sources.relationList?.[index] || sources.relations.get(relation.id);
        if (!storage) continue;
        if (storage.kind === 'junction') {
            const columns = storage.table.columns.map(column => ({ name: column.name,
                field: typeField(column.typeSourceFieldId), node, nullable: column.nullable, origin: 'junction' }));
            const parts = storage.table.primaryKeyFieldIds.map(id => storage.table.columns.find(column => column.id === id).name);
            const table = { name: storage.table.name, node, altered: false, columns,
                indexes: [{ kind: 'PRIMARY', parts, node }] };
            for (const foreignKey of storage.foreignKeys) support(table,
                [storage.table.columns.find(column => column.id === foreignKey.fieldId).name], node);
            tables.push(table);
        } else {
            const receiver = byId.get(storage.receiverEntityId), table = tableById.get(receiver.id);
            const field = receiver.fields.find(field => field.id === storage.fieldId);
            table.columns.push({ name: field.name, field: typeField(field.typeSourceFieldId), node,
                nullable: field.storage.nullable, origin: 'relationship' });
            table.altered = true;
            if (field.storage.unique) table.indexes.push({ kind: 'UNIQUE', parts: [field.name], node });
            support(table, [field.name], node);
        }
    }
    return tables;
}

function relationPhysicalNames(relation, plan) {
    const byId = new Map(plan.entities.map(entity => [entity.id, entity]));
    return names.mysqlRelationNames(relation.names, { kind: relation.storage.kind,
        receiverName: byId.get(relation.storage.receiverEntityId)?.sourceName,
        referencedName: byId.get(relation.storage.referencedEntityId)?.sourceName });
}

// SQL presentation consumes canonical identities/columns/topology; all physical
// details stay in this MySQL adapter alongside the G16 admission calculations.
function renderSchema(input) {
    const plan = input.plan || input;
    const byId = new Map(plan.entities.map(entity => [entity.id, entity]));
    const fields = new Map(plan.entities.flatMap(entity => entity.fields.map(field => [field.id, field])));
    const deleteAction = action => ({ cascade: 'CASCADE', set_null: 'SET NULL' })[action];
    // 1. Entity table statements
    const tableStatements = plan.entities.map(entity => {
        const identity = policy.identity(entity);
        const columnDefs = policy.fieldViews(entity, 'declared').map(field => {
            // The unchecked generateSQL seam must retain invalid native DDL
            // witnesses. Only recover non-finite primitive operands that the
            // JSON-safe plan replaced with null; all schema policy stays above.
            const rawField = input.definitions?.entities?.[entity.order]?.fields?.[field.declaredOrder];
            const operand = (value, raw) => value === null && typeof raw === 'number' && !Number.isFinite(raw) ? raw : value;
            const defaultValue = field.defaultValue && { ...field.defaultValue,
                value: operand(field.defaultValue.value, rawField?.defaultValue?.value) };
            const validations = field.validations.map((validation, index) => ({ ...validation,
                value: operand(validation.value, rawField?.validations?.[index]?.value) }));
            const mysqlType = columnType(field);
            const isPk = field.id === entity.key.fieldId;
            const isRequired = field.constraints.includes('REQUIRED');
            const isUnique = field.constraints.includes('UNIQUE');
            const hasDefault = field.defaultValue !== null && field.defaultValue !== undefined;

            const parts = [];

            // Primary Key & Auto Increment handling:
            // If primary key has an explicit default value, omit AUTO_INCREMENT to prevent MySQL Error 1067.
            if (isPk) {
                if (hasDefault) {
                    parts.push('PRIMARY KEY');
                } else if (entity.key.generation === 'database_integer') {
                    parts.push('PRIMARY KEY AUTO_INCREMENT');
                } else {
                    parts.push('PRIMARY KEY');
                }
            }

            // REQUIRED constraint
            if (isRequired) {
                parts.push('NOT NULL');
            } else if (field.dataType === 'TIMESTAMP') {
                // Explicit NULL avoids legacy TIMESTAMP's implicit auto attributes.
                parts.push('NULL');
            }

            // DEFAULT clause
            if (hasDefault) {
                const sqlDefault = field.dataType === 'TIMESTAMP'
                    ? { ...defaultValue, value: defaultValue.value.slice(0, 10) + ' ' + defaultValue.value.slice(11, 19) }
                    : defaultValue;
                const sqlVal = formatSQLLiteral(sqlDefault, field.dataType === 'ENUM');
                parts.push(`DEFAULT ${sqlVal}`);
            }

            // UNIQUE constraint
            if (isUnique) {
                parts.push('UNIQUE');
            }

            // CHECK constraints for numeric range and string-length validations
            if (validations.length > 0) {
                const minV = validations.find(v => v.type === 'MIN');
                const maxV = validations.find(v => v.type === 'MAX');
                const minLengthV = validations.find(v => v.type === 'MIN_LENGTH');
                const maxLengthV = validations.find(v => v.type === 'MAX_LENGTH');

                if (minV && maxV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} >= ${minV.value} AND ${quoteIdentifier(field.name)} <= ${maxV.value})`);
                } else if (minV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} >= ${minV.value})`);
                } else if (maxV) {
                    parts.push(`CHECK (${quoteIdentifier(field.name)} <= ${maxV.value})`);
                }

                if (minLengthV && maxLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) >= ${minLengthV.value} AND CHAR_LENGTH(${quoteIdentifier(field.name)}) <= ${maxLengthV.value})`);
                } else if (minLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) >= ${minLengthV.value})`);
                } else if (maxLengthV) {
                    parts.push(`CHECK (CHAR_LENGTH(${quoteIdentifier(field.name)}) <= ${maxLengthV.value})`);
                }
            }

            const constraintsStr = parts.length > 0 ? ' ' + parts.join(' ') : '';
            return `    ${quoteIdentifier(field.name)} ${mysqlType}${constraintsStr}`;
        });

        if (identity.origin === 'implicit') {
            columnDefs.unshift(`    ${quoteIdentifier(identity.name)} ${columnType(identity)} PRIMARY KEY AUTO_INCREMENT`);
        }

        return `CREATE TABLE ${quoteIdentifier(entity.names.table)} (\n` + columnDefs.join(',\n') + `\n);`;
    });

    const relationStatements = [];
    for (const relation of plan.relations) {
        const storage = relation.storage;
        if (!storage) continue; // Legacy unchecked SQL helper skips missing endpoints.
        const source = byId.get(relation.sourceEntityId), target = byId.get(relation.targetEntityId);
        const comment = `-- Relationship: ${source.sourceName} ${relation.relationName} ${target.sourceName} (${relation.cardinality})\n`;
        if (storage.kind === 'junction') {
            const columns = storage.table.columns;
            const definitions = columns.map(column => `    ${quoteIdentifier(column.name)} ${columnType(fields.get(column.typeSourceFieldId)) || 'INT'} NOT NULL`);
            const primary = storage.table.primaryKeyFieldIds.map(id => quoteIdentifier(columns.find(column => column.id === id).name));
            const foreignKeys = storage.foreignKeys.map(foreignKey => {
                const column = columns.find(column => column.id === foreignKey.fieldId);
                const referenced = byId.get(foreignKey.referencedEntityId), key = fields.get(foreignKey.referencedFieldId);
                return `    FOREIGN KEY (${quoteIdentifier(column.name)}) REFERENCES ${quoteIdentifier(referenced.names.table)}(${quoteIdentifier(key.name)}) ON DELETE ${deleteAction(foreignKey.onDelete)}`;
            });
            relationStatements.push(comment + `CREATE TABLE ${quoteIdentifier(storage.table.name)} (\n` +
                [...definitions, `    PRIMARY KEY (${primary.join(', ')})`, ...foreignKeys].join(',\n') + '\n);');
        } else {
            const receiver = byId.get(storage.receiverEntityId), referenced = byId.get(storage.referencedEntityId);
            const column = fields.get(storage.fieldId), key = fields.get(storage.referencedFieldId);
            const receiverTable = quoteIdentifier(receiver.names.table), columnName = quoteIdentifier(column.name);
            const constraint = relationPhysicalNames(relation, plan).foreignKeyConstraints[0];
            relationStatements.push(comment +
                `ALTER TABLE ${receiverTable} ADD COLUMN ${columnName} ${columnType(fields.get(column.typeSourceFieldId)) || 'INT'}${column.storage.unique ? ' UNIQUE' : ''};\n` +
                `ALTER TABLE ${receiverTable} ADD CONSTRAINT ${quoteIdentifier(constraint)} FOREIGN KEY (${columnName}) REFERENCES ${quoteIdentifier(referenced.names.table)}(${quoteIdentifier(key.name)}) ON DELETE ${deleteAction(storage.onDelete)};`);
        }
    }
    let sql = `-- ============================================================\n` +
              `-- MySQL Database Schema\n` +
              `-- Generated automatically by APIForge Compiler\n` +
              `-- ============================================================\n\n` +
              (plan.entities.some(entity => policy.fieldViews(entity).some(field => field.dataType === 'TIMESTAMP'))
                  ? "-- Interpret static TIMESTAMP defaults as UTC and disable legacy implicit attributes.\nSET SESSION time_zone = '+00:00';\nSET SESSION explicit_defaults_for_timestamp = ON;\n\n" : '') +
              tableStatements.join('\n\n') + '\n';
    if (relationStatements.length) sql += `\n-- ============================================================\n` +
        `-- Relationship Tables & Foreign Key Constraints\n` +
        `-- ============================================================\n\n` + relationStatements.join('\n\n') + '\n';
    return sql;
}

function rowBudget(table) {
    const nullBytes = Math.ceil(table.columns.filter(c => c.nullable).length / 8);
    let logical = nullBytes, local = 5 + 6 + 7 + nullBytes + (table.altered ? 1 : 0);
    for (const { field } of table.columns) {
        const bytes = storageBytes(field);
        logical += bytes + (field.dataType === 'STRING' ? (bytes > 255 ? 2 : 1) : 0);
        // MySQL 8.4 dict0dict.cc get_field_max_size: DYNAMIC long variable
        // fields have a worst unexternalized 40-byte payload + one length byte.
        // The 20-byte external reference + two length bytes is smaller. This
        // admission envelope, not a value-by-value spill simulator, matters.
        local += field.dataType === 'STRING' ? (bytes > 40 ? 41 : bytes + 1) : bytes;
    }
    return { logical, local, nullBytes };
}

function planIssues(tables) {
    const issues = [], issue = (node, message, hint) => {
        if (!issues.some(i => i.node === node && i.message === message)) issues.push({ node, message, locationKey: 'name', ...(hint ? { hint } : {}) });
    };
    for (const table of tables) {
        if (table.columns.length > COLUMN_LIMIT) issue(table.columns[COLUMN_LIMIT].node,
            `Generated MySQL table '${table.name}' requires ${table.columns.length} physical columns, above the supported InnoDB limit ${COLUMN_LIMIT}.`, 'Remove fields or relationship columns, or split the entity.');
        const secondary = table.indexes.filter(i => i.kind !== 'PRIMARY');
        if (secondary.length > SECONDARY_INDEX_LIMIT) issue(secondary[SECONDARY_INDEX_LIMIT].node,
            `Generated MySQL table '${table.name}' requires ${secondary.length} secondary indexes, above the supported InnoDB limit ${SECONDARY_INDEX_LIMIT}.`, 'Reduce UNIQUE fields or relationships, or split the entity.');
        else if (table.indexes.length > INDEX_LIMIT) issue(table.indexes[INDEX_LIMIT].node,
            `Generated MySQL table '${table.name}' requires ${table.indexes.length} indexes including PRIMARY (${secondary.length} secondary indexes), above the supported MySQL total-index limit ${INDEX_LIMIT}.`, 'Reduce UNIQUE fields or relationships; stock MySQL allows 63 secondary indexes alongside PRIMARY.');
        const columns = new Map(table.columns.map(c => [c.name, c]));
        for (const column of table.columns) {
            if (INTERNAL_COLUMNS.has(column.name.toLowerCase())) issue(column.node,
                `Generated MySQL column '${table.name}.${column.name}' uses a reserved InnoDB internal column name.`, 'Rename the field or contributing entity/key.');
        }
        for (const index of table.indexes) {
            if (index.parts.length > KEY_PART_LIMIT) issue(index.node,
                `Generated MySQL ${index.kind} index on '${table.name}' requires ${index.parts.length} key parts, above the supported limit ${KEY_PART_LIMIT}.`, 'Reduce the number of index columns.');
            const bytes = index.parts.reduce((sum, part) => sum + storageBytes(columns.get(part).field), 0);
            if (bytes > KEY_BYTES) {
                const column = columns.get(index.parts[0]);
                if (index.parts.length === 1 && column.origin === 'declared' && column.field.dataType === 'STRING') {
                    issue(index.node, `Indexed STRING '${table.name}.${column.name}' requires ${bytes} key bytes, above the supported InnoDB limit ${KEY_BYTES}.`);
                } else if (index.kind === 'PRIMARY' && table.columns.every(c => c.origin === 'junction')) {
                    issue(index.node, `Junction '${table.name}' composite primary key exceeds ${KEY_BYTES} bytes under utf8mb4.`);
                } else issue(index.node, `Generated MySQL ${index.kind} index on '${table.name}' requires ${bytes} key bytes, above the supported InnoDB limit ${KEY_BYTES}.`, 'Lower the indexed STRING capacity.');
            }
        }
        const budget = rowBudget(table);
        // Retain the existing single-VARCHAR diagnostic instead of adding a
        // redundant table error when an individual column already cannot fit.
        const oversizedColumn = table.columns.some(c => c.field.dataType === 'STRING' && capacity(c.field) > VARCHAR_CAPACITY);
        if (!oversizedColumn && budget.logical > LOGICAL_ROW_BYTES) issue(table.node,
            `Generated MySQL table '${table.name}' requires ${budget.logical} logical row bytes, above the supported limit ${LOGICAL_ROW_BYTES}.`, 'Lower STRING capacities, remove columns, or split the entity.');
        if (budget.local > LOCAL_RECORD_BYTES) issue(table.node,
            `Generated MySQL table '${table.name}' requires ${budget.local} bytes in the DYNAMIC local-record admission budget, above the supported 16 KiB-page limit ${LOCAL_RECORD_BYTES}.`, 'Remove fixed-width columns or split the entity; long STRING payloads already receive DYNAMIC off-page treatment.');
    }
    return issues;
}
function targetIssues(entities, relations = []) {
    return targetIssuesFromPlan(projectDefinitions(entities, relations));
}
function targetIssuesFromPlan(input, suppliedSources) {
    const candidate = input.plan ? input : { plan: input, provenance: {} };
    const plan = candidate.plan, sources = suppliedSources || sourceContext(candidate);
    const entities = sources.entityList || plan.entities.map(entity => sources.entities.get(entity.id));
    const issues = [];
    const issue = (node, message, locationKey = 'name', hint) => issues.push({ node, message, locationKey, ...(hint ? { hint } : {}) });
    const identifier = (name, node, kind) => {
        if (name.length > IDENTIFIER_LIMIT) issue(node, `Generated MySQL ${kind} '${name}' exceeds ${IDENTIFIER_LIMIT} characters.`);
    };
    for (const entity of entities) {
        identifier(entity.name, entity, 'table');
        let checkCount = 0;
        for (const field of entity.fields) {
            identifier(field.name, field, 'column');
            const autoBound = (field.validations || []).find(v => v.type === 'MIN' || v.type === 'MAX');
            // Check every declared PK before structural admission, preserving
            // G16 precedence even for a competing-key direct-IR contradiction.
            if (field.constraints?.includes('PRIMARY_KEY') && policy.identityGeneration(field) === 'database_integer' && autoBound) {
                issue(field, `Supported MySQL cannot represent MIN/MAX CHECK constraints on AUTO_INCREMENT column '${entity.name}.${field.name}'.`,
                    autoBound.type, 'Remove MIN/MAX, or declare an explicit INT DEFAULT to use a non-AUTO_INCREMENT key with bounds.');
            }
            // Match the two independent CHECK branches in generateSQL, including
            // forged IR that combines numeric and length validation families.
            // MIN+MAX is one CHECK; MIN_LENGTH+MAX_LENGTH is another.
            for (const family of [['MIN', 'MAX'], ['MIN_LENGTH', 'MAX_LENGTH']]) {
                if ((field.validations || []).some(v => family.includes(v.type))) {
                    identifier(names.mysqlCheckName(entity.name, ++checkCount), field, 'automatic CHECK constraint');
                }
            }
            if (field.dataType === 'STRING') {
                const width = capacity(field);
                if (width > VARCHAR_CAPACITY) issue(field, `STRING '${entity.name}.${field.name}' requires VARCHAR(${width}), above the utf8mb4 single-column capacity ${VARCHAR_CAPACITY}.`);
                if (field.defaultValue?.type === 'STRING' && Array.from(field.defaultValue.value).length > width) issue(field, `STRING default for '${entity.name}.${field.name}' exceeds generated VARCHAR(${width}).`, 'DEFAULT');
            }
            if (field.dataType === 'ENUM' && Array.isArray(field.enumValues)) {
                if (field.enumValues.length > 65535) issue(field, `Generated MySQL ENUM '${entity.name}.${field.name}' requires ${field.enumValues.length} members, above the supported limit 65535.`, 'type', 'Reduce the ENUM member count.');
                field.enumValues.forEach((value, index) => {
                    if (typeof value !== 'string') return; // Language/IR validation owns malformed values.
                    const chars = Array.from(value).length, bytes = Buffer.byteLength(value, 'utf8');
                    if (chars > 255 || bytes > 1020) issues.push({ node: field, locationKey: 'enumValues', occurrence: index,
                        message: `Generated MySQL ENUM '${entity.name}.${field.name}' member ${index + 1} requires ${chars} characters / ${bytes} bytes, above the supported limits 255 characters / 1020 utf8mb4 bytes.`, hint: 'Shorten this ENUM member.' });
                });
            }
            // Only DEFAULT literals that make DDL invalid; HTTP numeric scopes stay unchanged.
            const value = field.defaultValue?.value;
            if (typeof value === 'number' && Number.isFinite(value) && numericIssues(field).length === 0 &&
                ((field.dataType === 'INT' && (value < -2147483648 || value > 2147483647)) ||
                 (field.dataType === 'FLOAT' && Math.abs(value) > FLOAT_MAX))) {
                const range = field.dataType === 'INT' ? '-2147483648..2147483647' : `-${FLOAT_MAX}..${FLOAT_MAX}`;
                issue(field, `Generated MySQL ${field.dataType} DEFAULT for '${entity.name}.${field.name}' (${value}) exceeds the physical storage range ${range}.`, 'DEFAULT', 'Use a DEFAULT representable by the generated MySQL type.');
            }
        }
    }
    for (const [index, relation] of plan.relations.entries()) {
        const storage = relation.storage, node = sources.relationList?.[index] || sources.relations.get(relation.id);
        if (!storage) continue;
        const physical = relationPhysicalNames(relation, plan);
        if (storage.kind === 'junction') {
            identifier(storage.table.name, node, 'junction table');
            for (const column of storage.table.columns) identifier(column.name, node, 'junction column');
            for (const name of physical.foreignKeyConstraints) identifier(name, node, 'automatic foreign key constraint');
        } else {
            const receiver = plan.entities.find(entity => entity.id === storage.receiverEntityId);
            const field = receiver.fields.find(field => field.id === storage.fieldId);
            identifier(field.name, node, 'foreign key column');
            identifier(physical.foreignKeyConstraints[0], node, 'foreign key constraint');
        }
    }
    return issues.concat(planIssues(physicalPlanFromPlan(candidate, sources)));
}

const { numericIssues } = require('../targets/numeric-policy');
module.exports = { targetIssuesFromPlan, physicalPlanFromPlan, sourceContext, relationPhysicalNames,
    describeColumnType, describeCharacter, renderPhysicalType, renderCompleteColumn, renderCheckCondition, FLOAT_MAX,
    renderSchema, columnType, quoteIdentifier, formatSQLLiteral, targetIssues, numericIssues, capacity, IDENTIFIER_LIMIT, KEY_BYTES, VARCHAR_CAPACITY,
    physicalPlan, planIssues, rowBudget, storageBytes, COLUMN_LIMIT, SECONDARY_INDEX_LIMIT, KEY_PART_LIMIT,
    LOGICAL_ROW_BYTES, LOCAL_RECORD_BYTES, INDEX_LIMIT };
