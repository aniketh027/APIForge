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
