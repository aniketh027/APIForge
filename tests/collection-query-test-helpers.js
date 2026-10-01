const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const queryArtifact = path => path === 'README.md' || path === 'swagger.json' || /^(models|controllers)\//.test(path);
const stableArtifacts = files => files.filter(file => !queryArtifact(file.path));

// Preserve item/write/relationship methods and the existing full field metadata.
function protectedSections(file) {
    if (file.path.startsWith('models/')) {
        return { fields: hash(file.content.match(/    static get fields\(\) \{[\s\S]*?\n    \}/)[0]),
            itemWriteRelationships: hash(file.content.slice(file.content.indexOf('    static async findById'))) };
    }
    if (file.path.startsWith('controllers/')) {
        const entity = file.content.match(/const (\w+)Model = require/)[1];
        const plural = require('../src/codegen/codegen').pluralize(entity);
        const collection = 'get' + plural.charAt(0).toUpperCase() + plural.slice(1);
        return { validationCreate: hash(file.content.slice(0, file.content.indexOf(`async function ${collection}(`))),
            itemWriteRelationships: hash(file.content.slice(file.content.indexOf(`async function get${entity}ById(`))) };
    }
    if (file.path === 'swagger.json') {
        const swagger = JSON.parse(file.content);
        for (const [route, operations] of Object.entries(swagger.paths)) if (/^\/[^/]+$/.test(route)) delete operations.get;
        return { nonCollectionOpenAPI: hash(swagger) };
    }
    return { content: hash(file.content) };
}
module.exports = { hash, queryArtifact, stableArtifacts, protectedSections };
