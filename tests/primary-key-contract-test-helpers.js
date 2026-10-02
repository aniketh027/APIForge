const assert = require('assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const { load } = require('./request-validation-test-helpers');
const fixture = require('./fixtures/primary-key-contract-compatibility.json');
let baseline;
function baselineGenerator() {
    if (!baseline) {
        const filename = path.resolve(__dirname, '../src/codegen/codegen.js');
        baseline = load(execFileSync('git', ['show', fixture.baselineCommit + ':src/codegen/codegen.js'], {
            cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true
        }), createRequire(filename));
    }
    return baseline;
}
function compile(source, generator = require('../src/codegen/codegen')) {
    const L = require('../src/lexer/lexer'), P = require('../src/parser/parser');
    const S = require('../src/semantic/analyzer'), I = require('../src/ir/generator'), O = require('../src/optimizer/optimizer');
    const tokens = L.tokenize(source), ast = P.parse(tokens), semantic = S.analyze(ast);
    assert.equal(semantic.valid, true);
    const ir = I.generate(ast, semantic), optimization = O.optimize(ir);
    return { tokens, ast, semantic, ir, optimization, files: generator.generate(optimization.ir, false).files };
}
// Only the approved PK policy helpers, create assembly, update guard and README
// write section may differ. Historical fixtures are never refreshed.
function projectPrimaryKeyChanges(files, source) {
    files = require('./hardening-compatibility').projectHardeningChanges(files, source);
    const old = new Map(compile(source, baselineGenerator()).files.map(file => [file.path, file]));
    assert.deepEqual(files.map(file => file.path), [...old.keys()]);
    return files.map(file => {
        const previous = old.get(file.path);
        const stripPolicy = value => value.replace(/\/\/ Primary-key policy[^]*?\/\/ End primary-key policy\n\n/, '');
        if (file.path.startsWith('models/')) {
            const strip = value => stripPolicy(value)
                .replace(/    static async create\(data\) \{[^]*?\n    \}/, '<approved create>')
                .replace(/        const keyError = primaryKeyUpdateError\(data\);\n        if \(keyError\) throw new Error\(keyError\);\n/, '');
            assert.equal(strip(file.content), strip(previous.content), file.path);
        } else if (file.path.startsWith('controllers/')) {
            const addition = "    const keyError = operation === 'update' ? primaryKeyUpdateError(data) : null;\n" +
                "    if (keyError) return keyError;\n";
            const current = stripPolicy(file.content).replace(addition, '')
                .replace('// First error: shape, unknown own keys, immutable key, then declaration order (presence/null/type/bounds).',
                    '// First error: shape, unknown own keys, then declaration order (presence/null/type/bounds).');
            assert.equal(current, previous.content, file.path);
        } else if (file.path === 'README.md') {
            const strip = value => value.replace(/## Write requests\n[^]*?(?=## Collection query options)/, '<approved write docs>');
            assert.equal(strip(file.content), strip(previous.content), file.path);
        } else assert.equal(file.content, previous.content, file.path);
        return previous;
    });
}
module.exports = { baselineGenerator, compile, projectPrimaryKeyChanges };
