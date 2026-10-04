const assert = require('assert/strict');
const { compile, baselineModule } = require('./v1-hardening-helpers');
const { generateDatabaseErrorHandler } = require('../src/codegen/db-error-taxonomy');
const BASE = '1a3598e70d4bfd16636514c4e3c9e1b0d7c57e46';
let generator;
function originalFiles(source) {
    generator ||= baselineModule('src/codegen/codegen.js', BASE);
    return compile(source, generator).files;
}
const queryBoundary = model => `        let options;\n        try {\n            options = ${model}.parseQuery(req.query || {});\n        } catch (error) {\n            const message = ${model}.queryValidationMessage(error);\n            if (typeof message === 'string') return res.status(400).json({ success: false, error: message });\n            throw error;\n        }\n`;
const oldReadme = 'Malformed JSON returns sanitized HTTP 400. POST/PUT database failures return sanitized HTTP 500; UNIQUE remains database-enforced without prechecks or duplicate-key status mapping.';
const newReadme = 'Malformed JSON and generated request validation return HTTP 400 with safe messages. Known database conflicts return 409; rejected write values return 400; temporary connection/capacity/lock failures return 503; unknown failures return 500. Database errors use generic messages without SQL, driver codes or private values. Missing CRUD and singular related records retain 404. UNIQUE remains database-enforced without prechecks.';
// Freeze all non-G06 bytes against approved main, then feed the unchanged
// historical fixtures their reviewed pre-G06 artifacts. No fixture refresh.
function projectDatabaseErrorChanges(files, source) {
    const old = new Map(originalFiles(source).map(f => [f.path, f]));
    assert.deepEqual(files.map(f => f.path), [...old.keys()]);
    return files.map(file => {
        const previous = old.get(file.path);
        if (file.path.startsWith('controllers/')) {
            const model = file.content.match(/const (\w+Model) = require/)[1];
            assert(file.content.includes(generateDatabaseErrorHandler()));
            const current = file.content.replace(generateDatabaseErrorHandler(), '')
                .replace(queryBoundary(model), `        const options = ${model}.parseQuery(req.query || {});\n`);
            const strip = value => value.replace(/    \} catch \(error\) \{\n(?:        [^\n]*\n)+    \}/g, '    } catch (error) { <approved DB error response> }');
            assert.equal(strip(current), strip(previous.content), file.path);
        } else if (file.path.startsWith('models/')) {
            const current = file.content
                .replace('// Collection validation provenance: only locally registered errors expose text.\nconst queryValidationErrors = new WeakMap();\n\n', '')
                .replace('    static queryValidationMessage(error) {\n        return queryValidationErrors.get(error);\n    }\n\n', '')
                .replace('        const fail = message => {\n            const error = Object.assign(new Error(message), { statusCode: 400 });\n            queryValidationErrors.set(error, message);\n            throw error;\n        };', '        const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };');
            assert.equal(current, previous.content, file.path);
        } else if (file.path === 'swagger.json') {
            const current = JSON.parse(file.content), original = JSON.parse(previous.content);
            for (const [route, ops] of Object.entries(current.paths)) for (const [method, op] of Object.entries(ops)) {
                if (!op.responses) continue;
                for (const status of ['400', '409', '503']) {
                    if (!original.paths[route][method].responses[status]) delete op.responses[status];
                }
            }
            assert.deepEqual(current, original, file.path);
        } else if (file.path === 'server.js') {
            assert.equal(file.content, previous.content, file.path);
        } else if (file.path === 'README.md') {
            assert.equal(file.content.replace(newReadme, oldReadme), previous.content, file.path);
        } else assert.equal(file.content, previous.content, file.path);
        return previous;
    });
}
module.exports = { originalFiles, projectDatabaseErrorChanges };
