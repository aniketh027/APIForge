'use strict';
const crypto = require('node:crypto');
const { fail, fields } = require('./errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const NAME = /^apiforge_p_[mp]_[a-f0-9]{48}$/;
const RESERVED = '__apiforge_runtime_';
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
function selection(body) {
    fields(body, ['projectId', 'target', 'expectedRevision']);
    if (!UUID.test(body.projectId) || typeof body.projectId !== 'string' ||
        !['mysql', 'postgres'].includes(body.target) || !Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 1) fail('PERSISTENT_REQUEST_INVALID');
    return { projectId: body.projectId, target: body.target, expectedRevision: body.expectedRevision };
}
function databaseName(storeId, projectId, target) {
    if (!UUID.test(storeId) || !UUID.test(projectId) || !['mysql', 'postgres'].includes(target)) fail('PERSISTENT_PROJECT_UNAVAILABLE');
    return 'apiforge_p_' + (target === 'mysql' ? 'm' : 'p') + '_' +
        hash(JSON.stringify(['apiforge:persistent:database:1', storeId, projectId, target])).slice(0, 48);
}
function build(storeId, project, files) {
    const name = databaseName(storeId, project.id, project.target);
    if (!Number.isSafeInteger(project.revision) || project.revision < 1 || !HEX.test(project.sourceHash) ||
        typeof project.source !== 'string' || hash(project.source) !== project.sourceHash) fail('PERSISTENT_PROJECT_UNAVAILABLE');
    if (!Array.isArray(files) || files.some(file => typeof file.path !== 'string' || typeof file.content !== 'string') ||
        new Set(files.map(file => file.path)).size !== files.length) fail('PERSISTENT_COMPILE_FAILED');
    const schema = files.find(file => file.path === 'database/schema.sql')?.content;
    if (!schema) fail('PERSISTENT_COMPILE_FAILED');
    // Conservative reservation also refuses the namespace inside SQL literals.
    // The complete schema is compiler-owned; no HTTP SQL is ever admitted.
    if (schema.toLowerCase().includes(RESERVED)) fail('PERSISTENT_SCHEMA_RESERVED');
    const values = [1, storeId, project.id, project.target, project.revision, project.sourceHash,
        hash(schema), hash(JSON.stringify(['apiforge:persistent:artifacts:1', project.target,
            files.map(file => [file.path, file.content])]))];
    return Object.freeze({ name, target: project.target, values: Object.freeze(values), text: JSON.stringify(values), schema });
}
function verify(record, expected) {
    if (!record || record.format !== 1 || typeof record.provenance !== 'string' || record.provenance.length > 1024 ||
        !HEX.test(record.deployment_id) || !['provisioning', 'ready'].includes(record.state) ||
        (record.runtime_owner !== null && !HEX.test(record.runtime_owner))) fail('PERSISTENT_DATABASE_COLLISION');
    let values;
    try { values = JSON.parse(record.provenance); } catch { fail('PERSISTENT_DATABASE_COLLISION'); }
    if (!Array.isArray(values) || values.length !== 8 || JSON.stringify(values) !== record.provenance ||
        values.slice(0, 4).some((value, i) => value !== expected.values[i])) fail('PERSISTENT_DATABASE_COLLISION');
    if (values[4] !== expected.values[4] || values[5] !== expected.values[5]) fail('PERSISTENT_REVISION_MISMATCH');
    if (record.provenance !== expected.text) fail('PERSISTENT_ARTIFACT_CHANGED');
    return record;
}
module.exports = { UUID, HEX, NAME, RESERVED, hash, selection, databaseName, build, verify };
