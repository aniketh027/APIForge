const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const { compileProject } = require('./generated-backend-test-helpers');
const fixture = require('./fixtures/request-validation-compatibility.json');
let baseline;
function load(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}
function baselineGenerator() {
    if (!baseline) {
        const filename = path.resolve(__dirname, '../src/codegen/codegen.js');
        const source = execFileSync('git', ['show', fixture.baselineCommit + ':src/codegen/codegen.js'], {
            cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true
        });
        baseline = load(source, createRequire(filename));
    }
    return baseline;
}
function originalFiles(source) {
    const Lexer = require('../src/lexer/lexer'), Parser = require('../src/parser/parser');
    const Semantic = require('../src/semantic/analyzer'), IR = require('../src/ir/generator');
    const Optimizer = require('../src/optimizer/optimizer');
    const ast = Parser.parse(Lexer.tokenize(source)), semantic = Semantic.analyze(ast);
    assert.equal(semantic.valid, true);
    return baselineGenerator().generate(Optimizer.optimize(IR.generate(ast, semantic)).ir, false).files;
}
function controllerStable(content) {
    const handlers = [...content.matchAll(/async function (\w+)\([^]*?\n\}/g)]
        .filter(match => !/^(create|update)/.test(match[1])).map(match => match[0]);
    return { import: content.match(/const \w+Model = require[^\n]+/)[0], handlers,
        exports: content.slice(content.indexOf('module.exports')) };
}
// Check every unaffected section, then project only approved write changes back
// for older historical fixtures. No fixture hashes are refreshed.
function projectWriteChanges(files, source) {
    const old = new Map(originalFiles(source).map(file => [file.path, file]));
    assert.deepEqual(files.map(file => file.path), [...old.keys()]);
    return files.map(file => {
        const previous = old.get(file.path);
        if (file.path.startsWith('controllers/')) {
            assert.deepEqual(controllerStable(file.content), controllerStable(previous.content), file.path);
        } else if (file.path.startsWith('models/')) {
            const strip = value => value.replace(/    static async create\(data\) \{[^]*?\n    \}/, '<approved create>');
            assert.equal(strip(file.content), strip(previous.content), file.path);
        } else if (file.path === 'swagger.json') {
            const current = JSON.parse(file.content), original = JSON.parse(previous.content);
            for (const [name, schema] of Object.entries(current.components.schemas)) {
                delete schema.additionalProperties;
                delete schema.required;
                if (original.components.schemas[name].required) schema.required = original.components.schemas[name].required;
            }
            assert.deepEqual(current, original, file.path);
        } else if (file.path === 'server.js') {
            const addition = "    if (err.type === 'entity.parse.failed') {\n" +
                "        return res.status(400).json({ success: false, error: 'Request body must contain valid JSON.' });\n    }\n";
            assert.equal(file.content.replace(addition, ''), previous.content, file.path);
        } else if (file.path === 'README.md') {
            assert.equal(file.content.replace(/## Write requests\n[^]*?(?=## Collection query options)/, ''), previous.content, file.path);
        } else {
            assert.equal(file.content, previous.content, file.path);
        }
        return previous;
    });
}
module.exports = { load, compileProject, baselineGenerator, originalFiles, projectWriteChanges };
