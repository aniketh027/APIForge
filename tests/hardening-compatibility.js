const assert = require('assert/strict');
const { compile, baselineModule } = require('./v1-hardening-helpers');
// Historical fixtures stay frozen. Only approved V1 sections are projected;
// every byte outside these sections still compares with the reviewed base.
function projectHardeningChanges(files, source) {
    const old = new Map(compile(source, baselineModule('src/codegen/codegen.js')).files.map(f => [f.path, f]));
    assert.deepEqual(files.map(f => f.path), [...old.keys()]);
    return files.map(file => {
        const previous = old.get(file.path);
        if (file.path.startsWith('models/')) {
            const strip = value => value
                .replace(/\/\/ Read normalization:[^]*?\/\/ End read normalization\n\n/, '')
                .replace(/return rows\.map\(row => normalizeRow\(row, \[[^\n]*?\]\)\);/g, 'return rows;')
                .replace(/normalizeRow\(rows\[0\], \[[^\n]*?\]\)/g, 'rows[0]')
                .replace(/return normalizeRow\(response, \[[^\n]*?\]\);/g, 'return response;');
            assert.equal(strip(file.content), strip(previous.content), file.path);
        } else if (file.path.startsWith('controllers/')) {
            assert.equal(file.content.replaceAll("error: 'Unable to complete request.'", 'error: error.message'), previous.content, file.path);
        } else if (file.path === 'swagger.json') {
            const current = JSON.parse(file.content), original = JSON.parse(previous.content);
            assert.deepEqual(Object.keys(current.paths), Object.keys(original.paths));
            for (const name of Object.keys(current.components.schemas)) if (name.includes('.')) delete current.components.schemas[name];
            assert.deepEqual(current.components, original.components, 'legacy schema components unchanged');
            for (const [route, operations] of Object.entries(current.paths)) for (const [method, operation] of Object.entries(operations)) {
                const prev = original.paths[route][method];
                if (operation.responses) {
                    if (method === 'get' && /^\/[^/]+$/.test(route)) assert.deepEqual(operation.responses['200'].headers, prev.responses['200'].headers);
                    operation.responses = prev.responses;
                }
                if (operation.requestBody) operation.requestBody.content['application/json'].schema = prev.requestBody.content['application/json'].schema;
            }
            assert.deepEqual(current, original, 'all non-response/request-role OpenAPI bytes unchanged');
        } else if (file.path === 'README.md') {
            assert.equal(file.content.replace('OpenAPI uses Entity.Create/Update/Read roles and response envelopes. Update omits immutable keys; optional inputs are nullable; synthetic FK columns are readOnly. Declared BOOLEAN rows return booleans on source and target reads.',
                'OpenAPI reuses entity schemas for POST/PUT, so an explicit key may still appear generically despite PUT immutability; partial-update and nullability modeling remain limited.'), previous.content, file.path);
        } else assert.equal(file.content, previous.content, file.path);
        return previous;
    });
}
module.exports = { projectHardeningChanges };
