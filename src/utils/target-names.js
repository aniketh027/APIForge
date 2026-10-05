// Pure target-name transforms shared by semantic allocation and codegen.
const { identity, relationshipTopology } = require('../planning/effective-policy');
const NAMING_VERSION = 1;
function lowerFirst(str) { return str ? str.charAt(0).toLowerCase() + str.slice(1) : ''; }
function upperFirst(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function pluralize(word) {
    if (!word) return '';
    const lower = word.toLowerCase();
    if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return lower.slice(0, -1) + 'ies';
    if (lower.endsWith('s') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) return lower + 'es';
    return lower + 's';
}

// Projection does not reserve, reject, rename, or suffix a source spelling.
function entityNames(name) {
    const lowerName = lowerFirst(name), pluralName = pluralize(name);
    return {
        table: name, lowerName, pluralName, resourcePath: '/' + pluralName,
        itemPath: '/' + pluralName + '/{id}', collectionRoute: '/', itemRoute: '/:id',
        modelPath: `models/${name}.js`, controllerPath: `controllers/${lowerName}Controller.js`,
        routePath: `routes/${lowerName}Routes.js`, modelClass: `${name}Model`,
        controllerBinding: `${lowerName}Controller`, routeBinding: `${lowerName}Routes`,
        crud: { create: `create${name}`, getAll: `get${upperFirst(pluralName)}`, getById: `get${name}ById`,
            update: `update${name}`, delete: `delete${name}`, validate: `validate${name}`,
            selectWriteData: `select${name}WriteData` }
    };
}

function relationNames(sourceName, targetName, sourceKeyName, targetKeyName, cardinality) {
    const many = cardinality === 'MANY_TO_MANY' || cardinality === 'ONE_TO_MANY';
    const targetPlural = pluralize(targetName);
    const segment = many ? targetPlural : lowerFirst(targetName);
    const targetParam = lowerFirst(targetName) + 'Id';
    const getterPath = '/' + pluralize(sourceName) + '/{id}/' + segment;
    const getterRoute = '/:id/' + segment;
    return {
        sourceFk: lowerFirst(sourceName) + '_' + sourceKeyName,
        targetFk: lowerFirst(targetName) + '_' + targetKeyName,
        junction: sourceName + '_' + targetName,
        getter: 'get' + upperFirst(many ? targetPlural : targetName),
        add: 'add' + upperFirst(targetName), remove: 'remove' + upperFirst(targetName),
        sourceParam: lowerFirst(sourceName) + 'Id', targetParam,
        segment, getterPath, associationPath: getterPath + '/{' + targetParam + '}',
        getterRoute, associationRoute: getterRoute + '/:' + targetParam,
        associationSchemaName: sourceName + '.' + targetName + '.Association', many
    };
}

// MySQL naming profile: these names are deliberately absent from the canonical
// logical plan. Both target preflight and legacy namespace reservation use it.
function mysqlRelationNames(logicalNames, { kind, receiverName, referencedName }) {
    return { foreignKeyConstraints: kind === 'junction'
        ? [logicalNames.junction + '_ibfk_1', logicalNames.junction + '_ibfk_2']
        : [`fk_${receiverName.toLowerCase()}_${referencedName.toLowerCase()}`] };
}
function mysqlCheckName(tableName, ordinal) { return tableName + '_chk_' + ordinal; }

// Reservation is separate from projection. Prepared views can come from source
// declarations during tolerant semantic checks or from the canonical plan.
function conflictsForViews(entities, relations) {
    const allocations = new Map(), conflicts = [];
    const allocate = (namespace, name, node, owner) => {
        const key = namespace + ':' + name.toLowerCase();
        const previous = allocations.get(key);
        if (previous && previous.owner !== owner) conflicts.push({ namespace, name, node, owner, previous: previous.owner });
        else allocations.set(key, { node, owner });
    };
    for (const entity of entities) {
        const owner = `entity '${entity.name}'`;
        const names = entity.names;
        allocate('table', names.table, entity.node, owner);
        allocate('model file', names.modelPath, entity.node, owner);
        allocate('controller file', names.controllerPath, entity.node, owner);
        allocate('route file', names.routePath, entity.node, owner);
        allocate('resource path', names.resourcePath, entity.node, owner);
        // Windows device names cannot be represented as standalone model files.
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(entity.name)) {
            conflicts.push({ namespace: 'model file', name: entity.name + '.js', node: entity.node, owner, previous: 'Windows reserved device name' });
        }
        for (const field of entity.fields) allocate('column in ' + entity.name, field.name, field.node, `field '${entity.name}.${field.name}'`);
    }
    for (const entity of entities) {
        const names = entity.names.crud;
        for (const name of [names.getAll, names.getById, names.create, names.update, names.delete, names.validate]) {
            allocate('controller in ' + entity.name, name, entity.node, `CRUD for '${entity.name}'`);
        }
    }
    for (const rel of relations) {
        const source = rel.source, target = rel.target;
        if (!source || !target) continue; // Existing endpoint diagnostics own this error.
        const owner = `relationship '${rel.relationName}'`;
        const names = rel.names, storage = rel.storage;
        const physicalNames = mysqlRelationNames(names, storage);
        allocate('relationship GET in ' + source.name, names.segment, rel.node, owner);
        allocate('controller in ' + source.name, names.getter, rel.node, owner);
        allocate('model helper in ' + source.name, names.getter, rel.node, owner);
        if (storage.kind === 'junction') {
            allocate('table', names.junction, rel.node, owner);
            for (const name of physicalNames.foreignKeyConstraints) allocate('foreign key constraint', name, rel.node, owner);
            // Distinct endpoint spellings can still compose to the same FK column.
            allocate('column in ' + names.junction, names.sourceFk, rel.node, owner + ' source');
            allocate('column in ' + names.junction, names.targetFk, rel.node, owner + ' target');
            for (const name of [names.add, names.remove]) {
                allocate('controller in ' + source.name, name, rel.node, owner);
                allocate('model helper in ' + source.name, name, rel.node, owner);
            }
            allocate('association path in ' + source.name, names.segment, rel.node, owner);
        } else {
            allocate('column in ' + storage.receiverName, storage.fieldName, rel.node, owner);
            allocate('foreign key constraint', physicalNames.foreignKeyConstraints[0], rel.node, owner);
        }
    }
    return conflicts;
}

function namingConflicts(entities, relations = []) {
    const views = entities.map(entity => ({ name: entity.name, names: entityNames(entity.name), node: entity,
        fields: entity.fields.map(field => ({ name: field.name, node: field })) }));
    const sources = new Map(entities.map(entity => [entity.name, entity]));
    const byName = new Map(views.map(entity => [entity.name, entity]));
    const relationViews = [];
    for (const relation of relations) {
        const source = sources.get(relation.sourceEntity), target = sources.get(relation.targetEntity);
        const topology = relationshipTopology(source, target, relation);
        if (!topology) continue;
        const names = relationNames(source.name, target.name, identity(source).name, identity(target).name, relation.relationType);
        relationViews.push({ node: relation, relationName: relation.relationName || relation.name,
            source: byName.get(source.name), target: byName.get(target.name), names,
            storage: { kind: topology.kind, receiverName: topology.receiver?.name,
                referencedName: topology.referenced?.name,
                fieldName: topology.receiver === source ? names.targetFk : names.sourceFk } });
    }
    return conflictsForViews(views, relationViews);
}

function namingConflictsFromPlan(candidate, sourceContext = candidate.definitions) {
    const plan = candidate.plan || candidate, provenance = candidate.provenance || {};
    const node = (item, original, name) => original || { name, ...provenance[item.id] };
    const views = plan.entities.map(entity => ({ name: entity.sourceName, names: entity.names,
        node: node(entity, sourceContext?.entities?.[entity.order], entity.sourceName),
        fields: entity.fields.filter(field => field.origin.kind === 'declared').map(field => ({ name: field.name,
            node: node(field, sourceContext?.entities?.[entity.order]?.fields?.[field.declaredOrder], field.name) })) }));
    const byId = new Map(plan.entities.map((entity, index) => [entity.id, { entity, view: views[index] }]));
    const relationViews = plan.relations.filter(relation => relation.storage).map(relation => {
        const storage = relation.storage, receiver = byId.get(storage.receiverEntityId), referenced = byId.get(storage.referencedEntityId);
        return { relationName: relation.relationName, names: relation.names,
            node: node(relation, sourceContext?.relations?.[relation.order], relation.relationName),
            source: byId.get(relation.sourceEntityId)?.view, target: byId.get(relation.targetEntityId)?.view,
            storage: { kind: storage.kind, receiverName: receiver?.entity.sourceName,
                referencedName: referenced?.entity.sourceName,
                fieldName: receiver?.entity.fields.find(field => field.id === storage.fieldId &&
                    field.origin.relationId === relation.id)?.name } };
    });
    return conflictsForViews(views, relationViews);
}
module.exports = { NAMING_VERSION, lowerFirst, upperFirst, pluralize, entityNames, relationNames,
    mysqlRelationNames, mysqlCheckName, namingConflicts, namingConflictsFromPlan };
