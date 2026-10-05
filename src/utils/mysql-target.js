// Supported target: MySQL >=8.0.16, utf8mb4, InnoDB DYNAMIC, 16 KiB pages.
// Schema admission under the documented target; never reads server variables.
const { lowerFirst } = require('./target-names');
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
const key = entity => entity.fields.find(f => f.constraints?.includes('PRIMARY_KEY')) || { name: 'id', dataType: 'INT' };
function storageBytes(field) {
    if (field.dataType === 'STRING') return capacity(field) * CHARACTER_BYTES;
    if (field.dataType === 'ENUM') return (field.enumValues || []).length <= 255 ? 1 : 2;
    return { INT: 4, FLOAT: 4, BOOLEAN: 1, DATE: 3, TIMESTAMP: 4, UUID: 36 }[field.dataType] || 0;
}

// MySQL-target-local metadata only. Does not mutate AST/IR or allocate names.
function physicalPlan(entities, relations = []) {
    const tables = entities.map(entity => {
        const pk = key(entity), explicit = entity.fields.includes(pk);
        const columns = entity.fields.map(field => ({ name: field.name, field, node: field,
            nullable: !field.constraints?.some(c => c === 'PRIMARY_KEY' || c === 'REQUIRED'), origin: 'declared' }));
        if (!explicit) columns.unshift({ name: pk.name, field: pk, node: entity, nullable: false, origin: 'implicit' });
        const indexes = [{ kind: 'PRIMARY', parts: [pk.name], node: explicit ? pk : entity }];
        for (const field of entity.fields) if (field.constraints?.includes('UNIQUE')) {
            indexes.push({ kind: 'UNIQUE', parts: [field.name], node: field });
        }
        return { name: entity.name, node: entity, columns, indexes, altered: false };
    });
    const byName = new Map(tables.map(t => [t.name, t]));
    const entityMap = new Map(entities.map(e => [e.name, e]));
    const support = (table, parts, node) => {
        if (!table.indexes.some(index => parts.every((part, i) => index.parts[i] === part))) {
            table.indexes.push({ kind: 'FK', parts, node });
        }
    };
    for (const rel of relations) {
        const source = entityMap.get(rel.sourceEntity), target = entityMap.get(rel.targetEntity);
        if (!source || !target) continue;
        const a = key(source), b = key(target);
        const ac = lowerFirst(source.name) + '_' + a.name, bc = lowerFirst(target.name) + '_' + b.name;
        if (rel.relationType === 'MANY_TO_MANY') {
            const table = { name: source.name + '_' + target.name, node: rel, altered: false,
                columns: [ [ac, a], [bc, b] ].map(([name, field]) => ({ name, field, node: rel, nullable: false, origin: 'junction' })),
                indexes: [{ kind: 'PRIMARY', parts: [ac, bc], node: rel }] };
            support(table, [ac], rel); support(table, [bc], rel); tables.push(table);
        } else {
            const receiver = byName.get(rel.relationType === 'MANY_TO_ONE' ? source.name : target.name);
            const [name, field] = rel.relationType === 'MANY_TO_ONE' ? [bc, b] : [ac, a];
            receiver.columns.push({ name, field, node: rel, nullable: true, origin: 'relationship' });
            receiver.altered = true;
            if (rel.relationType === 'ONE_TO_ONE') receiver.indexes.push({ kind: 'UNIQUE', parts: [name], node: rel });
            support(receiver, [name], rel);
        }
    }
    return tables;
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
    const issues = [];
    const issue = (node, message, locationKey = 'name', hint) => issues.push({ node, message, locationKey, ...(hint ? { hint } : {}) });
    const identifier = (name, node, kind) => {
        if (name.length > IDENTIFIER_LIMIT) issue(node, `Generated MySQL ${kind} '${name}' exceeds ${IDENTIFIER_LIMIT} characters.`);
    };
    const byName = new Map(entities.map(e => [e.name, e]));
    for (const entity of entities) {
        identifier(entity.name, entity, 'table');
        let checkCount = 0;
        for (const field of entity.fields) {
            identifier(field.name, field, 'column');
            const autoBound = (field.validations || []).find(v => v.type === 'MIN' || v.type === 'MAX');
            if (field.dataType === 'INT' && field.constraints?.includes('PRIMARY_KEY') && field.defaultValue == null && autoBound) {
                issue(field, `Supported MySQL cannot represent MIN/MAX CHECK constraints on AUTO_INCREMENT column '${entity.name}.${field.name}'.`,
                    autoBound.type, 'Remove MIN/MAX, or declare an explicit INT DEFAULT to use a non-AUTO_INCREMENT key with bounds.');
            }
            if ((field.validations || []).length) identifier(entity.name + '_chk_' + (++checkCount), field, 'automatic CHECK constraint');
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
    for (const rel of relations) {
        const source = byName.get(rel.sourceEntity), target = byName.get(rel.targetEntity);
        if (!source || !target) continue;
        const sourceKey = key(source), targetKey = key(target);
        const sourceFk = lowerFirst(source.name) + '_' + sourceKey.name;
        const targetFk = lowerFirst(target.name) + '_' + targetKey.name;
        if (rel.relationType === 'MANY_TO_MANY') {
            const junction = source.name + '_' + target.name;
            identifier(junction, rel, 'junction table'); identifier(sourceFk, rel, 'junction column'); identifier(targetFk, rel, 'junction column');
            for (const suffix of ['_ibfk_1', '_ibfk_2']) identifier(junction + suffix, rel, 'automatic foreign key constraint');
        } else {
            const receiver = rel.relationType === 'MANY_TO_ONE' ? source : target;
            const referenced = receiver === source ? target : source;
            identifier(receiver === source ? targetFk : sourceFk, rel, 'foreign key column');
            identifier(`fk_${receiver.name.toLowerCase()}_${referenced.name.toLowerCase()}`, rel, 'foreign key constraint');
        }
    }
    return issues.concat(planIssues(physicalPlan(entities, relations)));
}
function numericIssues(field) {
    const issues = [];
    for (const value of [...(field.validations || []), ...(field.defaultValues || (field.defaultValue ? [field.defaultValue] : []))]) {
        if (typeof value.value !== 'number') continue;
        const integerRole = field.dataType === 'INT' || ['MIN_LENGTH', 'MAX_LENGTH'].includes(value.type);
        const raw = value.rawNumber;
        const lostFraction = integerRole && raw && raw.includes('.') && /[1-9]/.test(raw.split('.')[1]) && Number.isInteger(value.value);
        if (!Number.isFinite(value.value) || (integerRole && Number.isInteger(value.value) && !Number.isSafeInteger(value.value)) || lostFraction) {
            issues.push({ value, message: `Numeric literal ${raw || String(value.value)} for field '${field.name}' must be finite${integerRole ? ' and an exactly representable safe integer' : ''}.` });
        }
    }
    return issues;
}
module.exports = { targetIssues, numericIssues, capacity, IDENTIFIER_LIMIT, KEY_BYTES, VARCHAR_CAPACITY,
    physicalPlan, planIssues, rowBudget, storageBytes, COLUMN_LIMIT, SECONDARY_INDEX_LIMIT, KEY_PART_LIMIT,
    LOGICAL_ROW_BYTES, LOCAL_RECORD_BYTES, INDEX_LIMIT };
