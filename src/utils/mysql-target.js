// Supported target: MySQL >=8.0.16, utf8mb4, InnoDB DYNAMIC, 16 KiB pages.
// This is a deterministic subset of target validation, not a row-layout simulator.
const { lowerFirst } = require('./target-names');
const IDENTIFIER_LIMIT = 64, KEY_BYTES = 3072, CHARACTER_BYTES = 4;
const VARCHAR_CAPACITY = Math.floor((65535 - 2) / CHARACTER_BYTES);
const capacity = field => Math.max(255, ...(field.validations || [])
    .filter(v => ['MIN_LENGTH', 'MAX_LENGTH'].includes(v.type)).map(v => v.value));
const key = entity => entity.fields.find(f => f.constraints?.includes('PRIMARY_KEY')) || { name: 'id', dataType: 'INT' };
const keyBytes = field => field.dataType === 'STRING' ? capacity(field) * CHARACTER_BYTES : 4;
function targetIssues(entities, relations = []) {
    const issues = [];
    const issue = (node, message, locationKey = 'name') => issues.push({ node, message, locationKey });
    const identifier = (name, node, kind) => {
        if (name.length > IDENTIFIER_LIMIT) issue(node, `Generated MySQL ${kind} '${name}' exceeds ${IDENTIFIER_LIMIT} characters.`);
    };
    const byName = new Map(entities.map(e => [e.name, e]));
    for (const entity of entities) {
        identifier(entity.name, entity, 'table');
        let checkCount = 0;
        for (const field of entity.fields) {
            identifier(field.name, field, 'column');
            if ((field.validations || []).length) identifier(entity.name + '_chk_' + (++checkCount), field, 'automatic CHECK constraint');
            if (field.dataType === 'STRING') {
                const width = capacity(field);
                if (width > VARCHAR_CAPACITY) issue(field, `STRING '${entity.name}.${field.name}' requires VARCHAR(${width}), above the utf8mb4 single-column capacity ${VARCHAR_CAPACITY}.`);
                if ((field.constraints || []).some(c => c === 'PRIMARY_KEY' || c === 'UNIQUE') && width * CHARACTER_BYTES > KEY_BYTES) {
                    issue(field, `Indexed STRING '${entity.name}.${field.name}' requires ${width * CHARACTER_BYTES} key bytes, above the supported InnoDB limit ${KEY_BYTES}.`);
                }
                if (field.defaultValue?.type === 'STRING' && Array.from(field.defaultValue.value).length > width) issue(field, `STRING default for '${entity.name}.${field.name}' exceeds generated VARCHAR(${width}).`, 'DEFAULT');
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
            if (keyBytes(sourceKey) + keyBytes(targetKey) > KEY_BYTES) issue(rel, `Junction '${junction}' composite primary key exceeds ${KEY_BYTES} bytes under utf8mb4.`);
        } else {
            const receiver = rel.relationType === 'MANY_TO_ONE' ? source : target;
            const referenced = receiver === source ? target : source;
            identifier(receiver === source ? targetFk : sourceFk, rel, 'foreign key column');
            identifier(`fk_${receiver.name.toLowerCase()}_${referenced.name.toLowerCase()}`, rel, 'foreign key constraint');
        }
    }
    return issues;
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
module.exports = { targetIssues, numericIssues, capacity, IDENTIFIER_LIMIT, KEY_BYTES, VARCHAR_CAPACITY };
