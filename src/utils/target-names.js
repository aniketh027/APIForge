// Pure target-name transforms shared by semantic allocation and codegen.
function lowerFirst(str) { return str ? str.charAt(0).toLowerCase() + str.slice(1) : ''; }
function pluralize(word) {
    if (!word) return '';
    const lower = word.toLowerCase();
    if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return lower.slice(0, -1) + 'ies';
    if (lower.endsWith('s') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('x')) return lower + 'es';
    return lower + 's';
}

function namingConflicts(entities) {
    const allocations = new Map(), conflicts = [];
    const allocate = (namespace, name, node, owner) => {
        const key = namespace + ':' + name.toLowerCase();
        const previous = allocations.get(key);
        if (previous && previous.node !== node && previous.owner !== owner) conflicts.push({ namespace, name, node, owner, previous: previous.owner });
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
    return conflicts;
}
module.exports = { lowerFirst, pluralize, namingConflicts };
