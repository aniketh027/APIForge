// Operation roles use a dot separator, which cannot occur in a DSL identifier.
// This avoids allocating ItemRead over a user's legitimate entity of that name.
const { UUID_PATTERN } = require('../utils/uuid');
const policy = require('../planning/effective-policy');
const { projectDefinitions } = require('../planning/effective-schema');
const uuidSchema = () => ({ type: 'string', format: 'uuid', pattern: UUID_PATTERN,
    description: 'Canonical lowercase UUID text in exact 8-4-4-4-12 form. Any UUID version is accepted; no case normalization.' });
function enrichFromPlan(doc, plan, { databaseErrors = false, entityScope = null, generatedIntegerMinimum = () => 0 } = {}) {
    // Current codegen enables G06; older pinned generators omit the option so
    // historical compatibility tests can still reconstruct their reviewed docs.
    const schemas = doc.components.schemas;
    const ref = name => ({ $ref: '#/components/schemas/' + name });
    const envelope = data => ({ type: 'object', additionalProperties: false,
        required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data } });
    schemas['.Error'] = { type: 'object', additionalProperties: false, required: ['success', 'error'],
        properties: { success: { type: 'boolean', enum: [false] }, error: { type: 'string' } } };
    schemas['.Message'] = { type: 'object', additionalProperties: false, required: ['success', 'message'],
        properties: { success: { type: 'boolean', enum: [true] }, message: { type: 'string' } } };
    const response = (name, description = 'OK') => ({ description, content: { 'application/json': { schema: ref(name) } } });
    const byId = new Map(plan.entities.map(entity => [entity.id, entity]));
    for (const entity of plan.entities) {
        if (entityScope && !entityScope.has(entity.sourceName)) continue;
        const name = entity.sourceName;
        const base = schemas[name], effectiveKey = entity.fields.find(field => field.id === entity.key.fieldId);
        const createProperties = Object.create(null), updateProperties = Object.create(null), readProperties = Object.create(null);
        for (const field of policy.fieldViews(entity, 'create')) {
            const prop = { ...base.properties[field.name], nullable: field.roles.http.create.nullable };
            if (field.dataType === 'INT') {
                prop.minimum = Math.max(Number.MIN_SAFE_INTEGER, prop.minimum ?? Number.MIN_SAFE_INTEGER);
                prop.maximum = Math.min(Number.MAX_SAFE_INTEGER, prop.maximum ?? Number.MAX_SAFE_INTEGER);
                if (field.id === entity.key.fieldId && entity.key.generation === 'database_integer') prop.minimum = generatedIntegerMinimum(prop.minimum);
            }
            if (prop.enum && prop.nullable) prop.enum = [...prop.enum, null];
            createProperties[field.name] = prop;
            if (field.id === entity.key.fieldId && entity.key.generation === 'runtime_uuid') {
                createProperties[field.name].description += ' Omission or optional null generates a UUID v4 with crypto.randomUUID(); explicitly REQUIRED null is rejected.';
            }
        }
        for (const field of policy.fieldViews(entity, 'update')) updateProperties[field.name] = { ...createProperties[field.name] };
        for (const field of policy.fieldViews(entity, 'read')) {
            if (field.origin.kind === 'implicit_key') {
                // Preserve the legacy implicit-identity presentation: readOnly
                // implies its role without adding an explicit nullable member.
                readProperties[field.name] = { type: 'integer', readOnly: field.roles.http.read.readOnly };
            } else if (field.origin.kind === 'relationship_fk') {
                readProperties[field.name] = {
                    ...(field.dataType === 'UUID' ? uuidSchema() : { type: field.dataType === 'STRING' ? 'string' : 'integer' }),
                    nullable: field.roles.http.read.nullable, readOnly: field.roles.http.read.readOnly
                };
            } else {
                readProperties[field.name] = { ...createProperties[field.name], nullable: field.roles.http.read.nullable };
                if (field.roles.http.read.readOnly) readProperties[field.name].readOnly = true;
                // The UUID generation note describes request input; the
                // established Read property retains the base description.
                if (field.id === entity.key.fieldId && entity.key.generation === 'runtime_uuid') {
                    readProperties[field.name].description = base.properties[field.name].description;
                }
            }
        }
        const createRequired = policy.fieldViews(entity, 'create').filter(field => field.roles.http.create.required).map(field => field.name);
        const readRequired = policy.fieldViews(entity, 'read').filter(field => field.roles.http.read.required).map(field => field.name);
        schemas[name + '.Create'] = { type: 'object', additionalProperties: false, properties: createProperties,
            ...(createRequired.length ? { required: createRequired } : {}) };
        schemas[name + '.Update'] = { type: 'object', additionalProperties: false, properties: updateProperties };
        schemas[name + '.Read'] = { type: 'object', additionalProperties: false, properties: readProperties, required: readRequired };
        // Create echoes only supplied declared fields plus the resolved identity;
        // arbitrary database defaults and synthetic FKs are not reloaded.
        const createResultProperties = Object.create(null);
        for (const field of policy.fieldViews(entity, 'createResult')) {
            if (field.origin.kind === 'implicit_key') createResultProperties[field.name] = readProperties[field.name];
            else {
                const property = createProperties[field.name];
                createResultProperties[field.name] = property.nullable === field.roles.http.createResult.nullable
                    ? property : { ...property, nullable: field.roles.http.createResult.nullable };
            }
        }
        const resultRequired = policy.fieldViews(entity, 'createResult').filter(field => field.roles.http.createResult.required).map(field => field.name);
        schemas[name + '.CreateResult'] = { type: 'object', additionalProperties: false, properties: createResultProperties,
            ...(resultRequired.length ? { required: resultRequired } : {}) };
        schemas[name + '.Response'] = envelope(ref(name + '.Read'));
        schemas[name + '.CreateResponse'] = envelope(ref(name + '.CreateResult'));
        schemas[name + '.ListResponse'] = envelope({ type: 'array', items: ref(name + '.Read') });
        const root = doc.paths[entity.names.resourcePath], item = doc.paths[entity.names.itemPath];
        root.post.requestBody.content['application/json'].schema = ref(name + '.Create');
        item.put.requestBody.content['application/json'].schema = ref(name + '.Update');
        root.get.responses['200'] = { ...response(name + '.ListResponse'), headers: root.get.responses['200'].headers };
        root.post.responses['201'] = response(name + '.CreateResponse', 'Created');
        item.get.responses['200'] = response(name + '.Response');
        item.put.responses['200'] = response(name + '.Response');
        item.delete.responses['200'] = response('.Message');
        for (const op of [root.get, root.post, item.put]) op.responses['400'] = response('.Error', 'Invalid request');
        for (const op of [item.get, item.put, item.delete]) op.responses['404'] = response('.Error', 'Record not found');
        if (effectiveKey.dataType === 'UUID') for (const op of [item.get, item.put, item.delete]) op.responses['400'] = response('.Error', 'Invalid UUID path parameter or request');
        for (const op of [root.get, root.post, item.get, item.put, item.delete]) op.responses['500'] = response('.Error', 'Database or runtime failure');
        if (databaseErrors) {
            for (const op of [root.post, item.put, item.delete]) op.responses['409'] = response('.Error', 'Request conflicts with existing data');
            for (const op of [root.get, root.post, item.get, item.put, item.delete]) op.responses['503'] = response('.Error', 'Database temporarily unavailable');
        }
    }
    for (const rel of plan.relations) {
        const source = byId.get(rel.sourceEntityId), target = byId.get(rel.targetEntityId);
        const sourceKey = source.fields.find(field => field.id === rel.http.sourceParameter.keyFieldId);
        const get = doc.paths[rel.names.getterPath].get;
        if (sourceKey.dataType === 'UUID') get.responses['400'] = response('.Error', 'Invalid UUID path parameter');
        get.responses['200'] = response(target.sourceName + (rel.http.many ? '.ListResponse' : '.Response'));
        get.responses['500'] = response('.Error', 'Database or runtime failure');
        if (databaseErrors) get.responses['503'] = response('.Error', 'Database temporarily unavailable');
        if (!rel.http.many) get.responses['404'] = response('.Error', 'Related record not found');
        if (rel.storage.kind === 'junction') {
            const associationName = rel.http.associationSchemaName;
            const properties = Object.create(null);
            for (const column of rel.storage.table.columns) properties[column.name] =
                column.dataType === 'UUID' ? uuidSchema() : {
                    type: 'string', description: 'Echoed URL parameter; database binding retains the declared key type.'
                };
            schemas[associationName] = envelope({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
            const association = doc.paths[rel.names.associationPath];
            association.post.responses['201'] = response(associationName, 'Associated');
            association.delete.responses['200'] = response('.Message');
            for (const op of [association.post, association.delete]) {
                if (databaseErrors) {
                    op.responses['400'] = response('.Error', 'Request contains a value rejected by the database');
                    op.responses['409'] = response('.Error', 'Request conflicts with existing data');
                    op.responses['503'] = response('.Error', 'Database temporarily unavailable');
                }
                op.responses['500'] = response('.Error', 'Database or runtime failure');
            }
        }
    }
    return doc;
}

// Historical generators and standalone callers retain their declaration-shaped
// signature and G06 opt-in. Full generation passes its one existing plan to
// enrichFromPlan; this compatibility seam only uses tolerant shared projection.
function enrich(doc, entities, relations, { databaseErrors = false } = {}) {
    const definitions = [...entities];
    const available = new Set(definitions.map(entity => entity.name));
    for (const relation of relations) for (const name of [relation.sourceEntity, relation.targetEntity]) {
        if (!available.has(name)) { definitions.push({ name, fields: [] }); available.add(name); }
    }
    const { plan } = projectDefinitions(definitions, relations);
    return enrichFromPlan(doc, plan, { databaseErrors, entityScope: new Set(entities.map(entity => entity.name)) });
}

module.exports = { enrich, enrichFromPlan };
