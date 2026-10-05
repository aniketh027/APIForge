// Internal post-IR schema planning. Only `plan` is migration-comparable data.
const IR = require('../ir/generator');
const policy = require('./effective-policy');
const targetNames = require('../utils/target-names');
const FORMAT_VERSION = 1;

// Invalid numeric inputs remain in the ephemeral raw definitions for the
// existing numeric preflight. The candidate itself never serializes NaN/null
// substitutions silently: each substitution has a retained issue.
function finiteCopy(value, issues, nodeId) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        issues.push({ code: 'NON_FINITE_VALUE', nodeId, message: 'Effective schema numeric values must be finite.' });
        return null;
    }
    if (value == null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
    if (Array.isArray(value)) return Array.from(value, item => finiteCopy(item, issues, nodeId));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, finiteCopy(item, issues, nodeId)]));
    return null;
}

function location(node, contributors = []) {
    const copied = { line: Number.isFinite(node?.line) ? node.line : null,
        sourceLocations: node?.sourceLocations ? finiteCopy(node.sourceLocations, [], '') : null,
        contributors: [...contributors] };
    for (const key of ['column', 'nameColumn', 'endLine', 'endColumn']) if (Number.isFinite(node?.[key])) copied[key] = node[key];
    return copied;
}

function defaultValue(field, issues, id) {
    const value = Array.isArray(field.defaultValue) ? field.defaultValue[0] : field.defaultValue;
    return value ? { type: value.type, value: finiteCopy(value.value, issues, id) } : null;
}

function fieldRoles(field, key, origin) {
    const declared = origin === 'declared', implicit = origin === 'implicit_key';
    const identity = origin === 'implicit_key' || (declared && key.origin === 'explicit' && field.name === key.name);
    const nullable = !field.constraints.includes('REQUIRED');
    const generated = identity && key.generation !== 'none';
    return { http: {
        create: { acceptance: declared ? 'write' : 'unknown', required: declared && policy.createPresence(field, key), nullable },
        update: { acceptance: declared ? field.name === key.name ? 'immutable' : 'write' : 'unknown', nullable },
        read: { exposed: true, required: identity, nullable: identity ? false : nullable,
            readOnly: !declared || generated },
        createResult: { exposed: origin !== 'relationship_fk', required: identity && key.generation === 'runtime_uuid',
            nullable: generated || implicit ? false : nullable, readOnly: implicit },
        collection: { candidate: origin !== 'relationship_fk',
            httpFilterable: origin !== 'relationship_fk' && !policy.COLLECTION_RESERVED_PARAMS.includes(field.name) }
    } };
}

function makeField(entityName, source, order, key, origin, relationId, typeSourceFieldId, issues) {
    const id = origin === 'implicit_key' ? policy.stableId('implicit_field', entityName, source.name)
        : origin === 'relationship_fk' ? policy.stableId('relationship_field', entityName, relationId, source.name)
        : policy.stableId('field', entityName, source.name);
    const constraints = [...(source.constraints || [])];
    const field = { id, name: source.name, dataType: source.dataType,
        // Tolerant semantic preflight can see forged malformed AST metadata;
        // existing language diagnostics own it before strict post-IR admission.
        enumValues: source.dataType === 'ENUM' ? (Array.isArray(source.enumValues) ? finiteCopy(source.enumValues, issues, id) : []) : null,
        origin: { kind: origin, relationId: relationId || null },
        declaredOrder: origin === 'declared' ? order : null, effectiveOrder: order,
        typeSourceFieldId: typeSourceFieldId || null, constraints,
        validations: (source.validations || []).map(value => ({ type: value.type, value: finiteCopy(value.value, issues, id) })),
        defaultValue: defaultValue(source, issues, id),
        storage: { nullable: !constraints.some(value => value === 'PRIMARY_KEY' || value === 'REQUIRED'),
            unique: constraints.includes('UNIQUE') } };
    field.roles = fieldRoles(field, key, origin);
    return field;
}

function projectDefinitions(entities = [], relations = [], options = {}) {
    const issues = [], provenance = Object.create(null);
    const plan = { formatVersion: FORMAT_VERSION, policyVersion: policy.POLICY_VERSION,
        namingVersion: targetNames.NAMING_VERSION || 1, entities: [], relations: [] };
    const byName = new Map();
    for (const [order, source] of entities.entries()) {
        const name = source.name || source.sourceName || '';
        const id = policy.stableId('entity', name), key = policy.identity(source);
        const keyFieldId = policy.stableId(key.origin === 'implicit' ? 'implicit_field' : 'field', name, key.name);
        const declared = source.fields || [];
        const entity = { id, sourceName: name, order, names: targetNames.entityNames(name),
            key: { fieldId: keyFieldId, generation: key.generation },
            modelPolicy: { createPayload: 'trusted', updatePayload: 'trusted_except_identity',
                identityUpdate: 'immutable', writeValidation: 'declared_uuid_temporal' },
            itemParameter: { name: 'id', keyFieldId }, fields: [] };
        provenance[id] = location(source, [id]);
        const primaryKeys = declared.filter(field => field.constraints?.includes('PRIMARY_KEY'));
        if (primaryKeys.length > 1) issues.push({ code: 'MULTIPLE_PRIMARY_KEYS', nodeId: id,
            message: `Entity '${name}' has multiple competing declared primary keys.` });
        const seen = new Set();
        for (const [fieldOrder, inputField] of declared.entries()) {
            const field = makeField(name, inputField, fieldOrder, key, 'declared', null, null, issues);
            if (seen.has(field.name.toLowerCase())) issues.push({ code: 'DUPLICATE_FIELD', nodeId: field.id,
                occurrence: fieldOrder, message: `Entity '${name}' has duplicate effective field '${field.name}'.` });
            seen.add(field.name.toLowerCase());
            entity.fields.push(field);
            if (!provenance[field.id]) provenance[field.id] = location(inputField, [field.id]);
        }
        if (key.origin === 'implicit') {
            const field = makeField(name, { name: key.name, dataType: key.dataType, constraints: ['PRIMARY_KEY'] },
                entity.fields.length, key, 'implicit_key', null, null, issues);
            if (seen.has(field.name.toLowerCase())) issues.push({ code: 'IMPLICIT_KEY_COLLISION', nodeId: field.id,
                message: `Declared field '${name}.${field.name}' collides with the implicit identity.` });
            entity.fields.push(field);
            if (!provenance[field.id]) provenance[field.id] = location(source, [id]);
        }
        plan.entities.push(entity);
        byName.set(name, entity);
    }
    for (const [order, source] of relations.entries()) {
        const sourceName = source.sourceEntity, targetName = source.targetEntity;
        const relationName = source.relationName ?? source.name ?? '';
        const cardinality = source.cardinality || source.relationType || '';
        const id = policy.stableId('relation', sourceName, relationName, targetName, cardinality);
        const a = byName.get(sourceName), b = byName.get(targetName);
        const sourceEntityId = policy.stableId('entity', sourceName), targetEntityId = policy.stableId('entity', targetName);
        provenance[id] = location(source, [id, sourceEntityId, targetEntityId]);
        const names = targetNames.relationNames(sourceName, targetName, a ? policy.identity(a).name : 'id',
            b ? policy.identity(b).name : 'id', cardinality);
        const relation = { id, relationName, order, cardinality, sourceEntityId, targetEntityId,
            http: { many: names.many, segment: names.segment,
                sourceParameter: { name: 'id', keyFieldId: a?.key.fieldId || null },
                targetParameter: cardinality === 'MANY_TO_MANY' ? { name: names.targetParam, keyFieldId: b?.key.fieldId || null } : null,
                associationSchemaName: cardinality === 'MANY_TO_MANY' ? names.associationSchemaName : null },
            names, storage: null };
        if (!a || !b) {
            issues.push({ code: 'UNRESOLVED_RELATION_ENDPOINT', nodeId: id,
                message: `Relationship '${relationName}' has an unresolved endpoint '${!a ? sourceName : targetName}'.` });
            plan.relations.push(relation);
            continue;
        }
        const topology = policy.relationshipTopology(a, b, { cardinality });
        if (topology.kind === 'junction') {
            const tableId = policy.stableId('junction', sourceName, targetName);
            const columns = [[a, names.sourceFk, 'source'], [b, names.targetFk, 'target']].map(([entity, name, endpoint]) => {
                const key = policy.identity(entity), fieldId = policy.stableId('junction_field', sourceName, targetName, name);
                provenance[fieldId] = location(source, [id, entity.key.fieldId]);
                return { id: fieldId, name, dataType: key.dataType, typeSourceFieldId: entity.key.fieldId,
                    origin: { kind: 'junction_fk', relationId: id, endpoint }, nullable: false, defaultValue: null };
            });
            if (columns[0].name.toLowerCase() === columns[1].name.toLowerCase()) issues.push({ code: 'DUPLICATE_STORAGE_FIELD', nodeId: id,
                message: `Junction '${names.junction}' has duplicate storage field '${columns[0].name}'.` });
            provenance[tableId] = location(source, [id]);
            relation.storage = { kind: 'junction', table: { id: tableId, name: names.junction, columns,
                primaryKeyFieldIds: columns.map(column => column.id) },
                foreignKeys: columns.map((column, index) => ({ fieldId: column.id,
                    referencedEntityId: [a, b][index].id, referencedFieldId: [a, b][index].key.fieldId, onDelete: 'cascade' })) };
        } else {
            const receiver = topology.receiver, referenced = topology.referenced;
            const key = policy.identity(referenced), name = cardinality === 'MANY_TO_ONE' ? names.targetFk : names.sourceFk;
            const field = makeField(receiver.sourceName, { name, dataType: key.dataType,
                ...(key.dataType === 'ENUM' ? { enumValues: key.field.enumValues } : {}) }, receiver.fields.length,
                policy.identity(receiver), 'relationship_fk', id, referenced.key.fieldId, issues);
            field.storage = { nullable: true, unique: topology.unique };
            if (receiver.fields.some(item => item.name.toLowerCase() === name.toLowerCase())) issues.push({ code: 'DUPLICATE_STORAGE_FIELD', nodeId: id,
                message: `Entity '${receiver.sourceName}' has duplicate storage field '${name}'.` });
            receiver.fields.push(field);
            provenance[field.id] = location(source, [id, referenced.key.fieldId]);
            relation.storage = { kind: 'foreign_key', receiverEntityId: receiver.id, fieldId: field.id,
                referencedEntityId: referenced.id, referencedFieldId: referenced.key.fieldId, onDelete: topology.onDelete };
        }
        plan.relations.push(relation);
    }
    const candidate = { plan, provenance, issues };
    // Tolerant admission retains original values and source nodes separately
    // from both the canonical plan and primitive provenance.
    Object.defineProperty(candidate, 'definitions', { value: { entities, relations } });
    if (options.strict) assertStructural(candidate);
    return candidate;
}

function buildCandidate(ir) {
    const entities = new Map(), relations = [];
    for (const instruction of ir?.instructions || []) {
        if (instruction.op === 'CREATE_ENTITY' || instruction.op === 'ADD_FIELD') {
            if (!entities.has(instruction.entity)) entities.set(instruction.entity,
                { name: instruction.entity, fields: [], line: instruction.line,
                    ...(instruction.sourceLocations ? { sourceLocations: instruction.sourceLocations } : {}) });
            if (instruction.op === 'ADD_FIELD') entities.get(instruction.entity).fields.push({ name: instruction.field,
                dataType: instruction.dataType, ...(instruction.dataType === 'ENUM' ? { enumValues: [...instruction.enumValues] } : {}),
                constraints: instruction.constraints || [], validations: instruction.validations || [], defaultValue: instruction.defaultValue || null,
                line: instruction.line, ...(instruction.sourceLocations ? { sourceLocations: instruction.sourceLocations } : {}) });
        } else if (instruction.op === 'CREATE_RELATION') relations.push({ sourceEntity: instruction.sourceEntity,
            relationName: instruction.relationName, targetEntity: instruction.targetEntity, relationType: instruction.relationType,
            line: instruction.line, ...(instruction.sourceLocations ? { sourceLocations: instruction.sourceLocations } : {}) });
    }
    return projectDefinitions([...entities.values()], relations);
}

function assertStructural(candidate) {
    if (candidate.issues.length) throw new Error('Cannot build Effective Schema Plan: ' + candidate.issues.map(issue => issue.message).join(' '));
    return candidate.plan;
}

function buildFromIR(ir) {
    const validation = IR.validate(ir);
    if (!validation.valid) throw new Error('Cannot build Effective Schema Plan: Invalid IR. ' + validation.errors.join(' '));
    const candidate = buildCandidate(ir);
    assertStructural(candidate);
    return candidate;
}

module.exports = { FORMAT_VERSION, buildCandidate, projectDefinitions, assertStructural, buildFromIR };
