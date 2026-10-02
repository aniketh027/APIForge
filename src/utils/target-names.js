// Pure target-name transforms shared by semantic allocation and codegen.
function lowerFirst(str) { return str ? str.charAt(0).toLowerCase() + str.slice(1) : ''; }
function pluralize(word) {
    if (!word) return '';
    const lower = word.toLowerCase();
    if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return lower.slice(0, -1) + 'ies';
    if (lower.endsWith('s') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) return lower + 'es';
    return lower + 's';
}

function namingConflicts(entities, relations = []) {
    const allocations = new Map(), conflicts = [];
    const allocate = (namespace, name, node, owner) => {
        const key = namespace + ':' + name.toLowerCase();
        const previous = allocations.get(key);
        if (previous && previous.owner !== owner) conflicts.push({ namespace, name, node, owner, previous: previous.owner });
        else allocations.set(key, { node, owner });
    };
    for (const entity of entities) {
        const owner = `entity '${entity.name}'`;
        allocate('table', entity.name, entity, owner);
        allocate('model file', `models/${entity.name}.js`, entity, owner);
        allocate('controller file', `controllers/${lowerFirst(entity.name)}Controller.js`, entity, owner);
        allocate('route file', `routes/${lowerFirst(entity.name)}Routes.js`, entity, owner);
        allocate('resource path', '/' + pluralize(entity.name), entity, owner);
        // Windows device names cannot be represented as standalone model files.
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(entity.name)) {
            conflicts.push({ namespace: 'model file', name: entity.name + '.js', node: entity, owner, previous: 'Windows reserved device name' });
        }
        for (const field of entity.fields) allocate('column in ' + entity.name, field.name, field, `field '${entity.name}.${field.name}'`);
    }
    const upperFirst = str => str.charAt(0).toUpperCase() + str.slice(1);
    const key = entity => entity.fields.find(f => f.constraints?.includes('PRIMARY_KEY'))?.name || 'id';
    const byName = new Map(entities.map(e => [e.name, e]));
    for (const entity of entities) {
        for (const name of [`get${upperFirst(pluralize(entity.name))}`, `get${entity.name}ById`, `create${entity.name}`, `update${entity.name}`, `delete${entity.name}`, `validate${entity.name}`]) {
            allocate('controller in ' + entity.name, name, entity, `CRUD for '${entity.name}'`);
        }
    }
    for (const rel of relations) {
        const source = byName.get(rel.sourceEntity), target = byName.get(rel.targetEntity);
        if (!source || !target) continue; // Existing endpoint diagnostics own this error.
        const owner = `relationship '${rel.relationName || rel.name}'`;
        const sourceFk = lowerFirst(source.name) + '_' + key(source);
        const targetFk = lowerFirst(target.name) + '_' + key(target);
        const many = ['MANY_TO_MANY', 'ONE_TO_MANY'].includes(rel.relationType);
        const segment = many ? pluralize(target.name) : lowerFirst(target.name);
        allocate('relationship GET in ' + source.name, segment, rel, owner);
        const getter = 'get' + upperFirst(many ? pluralize(target.name) : target.name);
        allocate('controller in ' + source.name, getter, rel, owner);
        allocate('model helper in ' + source.name, getter, rel, owner);
        if (rel.relationType === 'MANY_TO_MANY') {
            const junction = source.name + '_' + target.name;
            allocate('table', junction, rel, owner);
            for (const suffix of ['_ibfk_1', '_ibfk_2']) allocate('foreign key constraint', junction + suffix, rel, owner);
            // Distinct endpoint spellings can still compose to the same FK column.
            allocate('column in ' + junction, sourceFk, rel, owner + ' source');
            allocate('column in ' + junction, targetFk, rel, owner + ' target');
            for (const verb of ['add', 'remove']) {
                allocate('controller in ' + source.name, verb + upperFirst(target.name), rel, owner);
                allocate('model helper in ' + source.name, verb + upperFirst(target.name), rel, owner);
            }
            allocate('association path in ' + source.name, segment, rel, owner);
        } else {
            const receiver = rel.relationType === 'MANY_TO_ONE' ? source : target;
            const referenced = receiver === source ? target : source;
            allocate('column in ' + receiver.name, receiver === source ? targetFk : sourceFk, rel, owner);
            allocate('foreign key constraint', `fk_${receiver.name.toLowerCase()}_${referenced.name.toLowerCase()}`, rel, owner);
        }
    }
    return conflicts;
}
module.exports = { lowerFirst, pluralize, namingConflicts };
