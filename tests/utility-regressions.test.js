const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDiagnostic } = require('../src/utils/diagnostics');
const { sourceFrame } = require('../src/utils/source-frame');
const { levenshtein, formatUserFacingError } = require('../src/utils/errors');
function browser(overrides = {}) {
    const context = vm.createContext({
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        window: { addEventListener() {} }, navigator: {}, TextEncoder, Blob,
        setTimeout: () => 1, clearTimeout() {}, ...overrides
    });
    vm.runInContext(fs.readFileSync(require.resolve('../frontend/app.js'), 'utf8'), context);
    return context;
}

test('diagnostic lookup rejects Object prototype names', () => {
    for (const [phase, symbol] of [['semantic', 'toString'], ['semantic', 'constructor'], ['__proto__', 'toString']]) {
        assert.throws(() => createDiagnostic(phase, symbol, 'bad'), /Unregistered diagnostic/);
    }
    assert.equal(createDiagnostic('semantic', 'MISSING_ENTITY_DECLARATION', 'bad').code, 'SEM001');
});

test('edit distance stays symmetric for strongly unequal input lengths', () => {
    const long = 'a'.repeat(100000);
    assert.equal(levenshtein('a', long), 99999);
    assert.equal(levenshtein(long, 'a'), 99999);
    assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('source excerpts return no frame for missing locations', () => {
    assert.deepEqual(sourceFrame('source', undefined), []);
    assert.deepEqual(sourceFrame('source', null), []);
    assert.equal(sourceFrame('source', {line: 1, column: 1})[0].pointer, '^');
});
