'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { resolveFile, compileFile } = require('../src/compiler');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-g28-cycle-diagnostics-'));
const failures = []; let checks = 0;
function write(name, source) { fs.writeFileSync(path.join(root, name), source); return path.join(root, name); }
function capture(run) { let error; try { run(); } catch (caught) { error = caught; } assert(error, 'expected compilation failure'); return error; }
function location(message, source) { return { message, source, line: 1, column: 8, endLine: 1, endColumn: 20 }; }
function test(name, run) {
    try { run(); checks++; }
    catch (error) { failures.push(name + ': ' + error.message); }
}
try {
    for (const count of [1, 2, 3]) {
        const names = ['a.apiforge', 'b.apiforge', 'c.apiforge'].slice(0, count);
        names.forEach((name, i) => write(name, 'IMPORT "' + names[(i + 1) % count] + '"'));
        const error = capture(() => resolveFile(path.join(root, names[0])));
        const diagnostic = error.diagnostic;
        console.log(JSON.stringify({ cycleModules: count, related: diagnostic.related ?? null }));
        test('exact ' + count + '-module cycle diagnostic', () => {
            const expected = { phase: 'input', code: 'INP009', severity: 'error',
                message: 'Import cycle: ' + [...names, names[0]].join(' -> ') + '.', symbol: 'IMPORT_CYCLE',
                line: 1, column: 8, endLine: 1, endColumn: 20,
                hint: 'Remove an import edge from this cycle.', source: names.at(-1) };
            if (count > 1) expected.related = names.slice(0, -1).map(name => location('Cycle edge.', name));
            assert.deepEqual(diagnostic, expected);
            assert.deepEqual(error.diagnostics, [expected]);
            assert(!JSON.stringify(diagnostic).includes(root));
            assert(!JSON.stringify(diagnostic).includes('\\'));
        });
    }
    // An import prefix outside the active cycle is not a preceding cycle edge.
    const entry = write('root.apiforge', 'IMPORT "a.apiforge"');
    write('a.apiforge', 'IMPORT "a.apiforge"');
    test('imported self-cycle has no redundant related edge', () => {
        assert.equal(capture(() => resolveFile(entry)).diagnostic.related, undefined);
    });
    write('a.apiforge', 'IMPORT "b.apiforge"'); write('b.apiforge', 'IMPORT "c.apiforge"'); write('c.apiforge', 'IMPORT "a.apiforge"');
    test('non-cycle prefix does not expand cycle-related locations', () => {
        const diagnostic = capture(() => resolveFile(entry)).diagnostic;
        assert.equal(diagnostic.message, 'Import cycle: a.apiforge -> b.apiforge -> c.apiforge -> a.apiforge.');
        assert.deepEqual(diagnostic.related, ['a.apiforge', 'b.apiforge'].map(name => location('Cycle edge.', name)));
    });
    for (const [source, code] of [['ENTITY Bad @', 'LEX001'], ['ENTITY Bad v', 'PAR012'], ['ENTITY Bad', 'SEM004']]) {
        write('b.apiforge', source);
        test('ordinary imported ' + code + ' retains full import chain', () => {
            const diagnostic = capture(() => compileFile(entry)).diagnostics.find(d => d.code === code);
            assert(diagnostic); assert.equal(diagnostic.source, 'b.apiforge');
            assert.deepEqual(diagnostic.related, ['root.apiforge', 'a.apiforge'].map(name => location('Imported here.', name)));
        });
    }
    write('first.apiforge', 'ENTITY Shared v STRING'); write('second.apiforge', 'ENTITY Shared v STRING');
    write('root.apiforge', 'IMPORT "first.apiforge"\nIMPORT "second.apiforge"');
    test('duplicate declaration keeps previous location and ordinary import chain', () => {
        const diagnostic = capture(() => compileFile(entry)).diagnostics.find(d => d.code === 'SEM002');
        assert(diagnostic);
        assert.deepEqual(diagnostic.related, [
            { message: 'Previous declaration.', source: 'first.apiforge', line: 1, column: 8, endLine: 1, endColumn: 14 },
            { message: 'Imported here.', source: 'root.apiforge', line: 2, column: 8, endLine: 2, endColumn: 25 }
        ]);
    });
    assert.deepEqual(failures, [], 'cycle diagnostics or ordinary chain regression');
    console.log(JSON.stringify({ gate: 'cycle-related correction', checks, result: 'PASS' }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
