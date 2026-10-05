'use strict';

const baseAssert = require('assert/strict');
const vm = require('vm');
const { PINNED_BASE, CHECKOUT_POLICY, createPinnedCompiler, currentCompiler, compileSource } = require('./pinned-compiler-loader');
const { sourceCases, directIRCases, rawSQLCases, structuralIRCases } = require('./effective-schema-corpus');
const schema = require('../src/planning/effective-schema');

function runEquivalence() {
    let assertions = 0;
    const assert = new Proxy(baseAssert, {
        apply(target, receiver, args) { assertions++; return Reflect.apply(target, receiver, args); },
        get(target, key) {
            const value = target[key];
            return typeof value === 'function' ? (...args) => { assertions++; return value(...args); } : value;
        }
    });
    const pinned = createPinnedCompiler(), current = currentCompiler();
    const corpus = sourceCases(pinned), direct = directIRCases(pinned);
    const report = {
        pinnedRevision: PINNED_BASE, checkoutPolicy: CHECKOUT_POLICY,
        uniqueSources: corpus.cases.length, validSources: 0, invalidDiagnosticMatches: 0,
        validGuideExamples: corpus.validGuideCount, generatedExactFiles: 0, emittedJavaScriptParsed: 0,
        corpusInventory: corpus.inventory,
        completeDirectIRComparisons: 0, forgedExactFiles: 0, forgedJavaScriptParsed: 0,
        rawSQLComparisons: 0, rawIRAccepted: 0, rawIRRejected: 0, rawFullRejectionMatches: 0,
        structuralBaselineWitnesses: 0, exactMismatches: 0
    };
    const publicData = value => JSON.parse(JSON.stringify(value));
    function compareFiles(actual, expected, label, forged = false) {
        // No line-ending conversion, JSON reformatting, historical projections
        // or substring assertions: compare every ordered path and content.
        assert.deepEqual(actual, expected, label + ': exact ordered generated file array');
        for (const file of actual) {
            if (forged) report.forgedExactFiles++; else report.generatedExactFiles++;
            if (file.path.endsWith('.js')) {
                new vm.Script(file.content, { filename: label + '/' + file.path });
                if (forged) report.forgedJavaScriptParsed++; else report.emittedJavaScriptParsed++;
            }
        }
    }
    assert.equal(corpus.validGuideCount, 20, 'Every approved valid guide example is included.');
    assert.equal(corpus.inventory.samples, pinned.paths.filter(name => /^samples\/.*\.apiforge$/.test(name)).length);
    assert.equal(corpus.cases.flatMap(example => example.labels).filter(name => /^samples\//.test(name)).length,
        corpus.inventory.samples, 'Every sample was actually admitted into the corpus.');
    assert.equal(corpus.cases.flatMap(example => example.labels).filter(name => /^tests\/fixtures\//.test(name)).length,
        corpus.inventory.frozenFixtureSources, 'Every frozen fixture source was actually admitted into the corpus.');
    assert.equal(corpus.inventory.g16Seeded, 96, 'The full deterministic G16 seed corpus is included.');
    assert.notEqual(pinned.compiler.Codegen, current.Codegen, 'Pinned and current modules are independent.');
    assert.notEqual(pinned.load('src/utils/target-names.js'), require('../src/utils/target-names'),
        'Relative local imports cannot leak to the live require cache.');
    assert.notEqual(pinned.load('src/utils/mysql-target.js'), require('../src/utils/mysql-target'));
    assert.notEqual(pinned.load('src/utils/temporal.js'), require('../src/utils/temporal'));
    assert.notEqual(pinned.load('src/utils/uuid.js'), require('../src/utils/uuid'));
    assert.notEqual(pinned.load('src/codegen/openapi-fidelity.js'), require('../src/codegen/openapi-fidelity'));
    assert.notEqual(pinned.load('package.json'), require('../package.json'));
    assert.equal(pinned.load('package.json').version, '1.0.0');

    for (const example of corpus.cases) {
        const original = pinned.compile(example.source), actual = compileSource(example.source, current);
        assert.equal(actual.valid, original.valid, example.name + ': acceptance');
        if (example.expected !== null) assert.equal(original.valid, example.expected, example.name + ': corpus expectation');
        assert.deepEqual(publicData(actual.phases), publicData(original.phases), example.name + ': public compiler phase data');
        if (original.valid) {
            assert.deepEqual(actual.warnings, original.warnings, example.name + ': exact warning arrays');
            compareFiles(actual.files, original.files, example.name);
            report.validSources++;
        } else {
            assert.equal(actual.phase, original.phase, example.name + ': failure phase');
            assert.deepEqual(actual.diagnostics, original.diagnostics, example.name + ': exact diagnostics');
            assert.deepEqual(actual.error, original.error, example.name + ': codegen/error metadata');
            report.invalidDiagnosticMatches++;
        }
    }
    for (const example of direct) {
        const before = JSON.stringify(example.ir);
        assert.equal(pinned.compiler.IR.validate(example.ir).valid, true, example.name + ': valid baseline IR');
        assert.equal(current.IR.validate(example.ir).valid, true, example.name + ': valid current IR');
        const original = pinned.compiler.Codegen.generate(example.ir, false).files;
        const actual = current.Codegen.generate(example.ir, false).files;
        compareFiles(actual, original, example.name, true);
        assert.equal(JSON.stringify(example.ir), before, example.name + ': no input mutation');
        report.completeDirectIRComparisons++;
    }
    for (const example of rawSQLCases()) {
        const label = example.name;
        const originalValidation = pinned.compiler.IR.validate(example.ir), actualValidation = current.IR.validate(example.ir);
        assert.equal(originalValidation.valid, example.irAccepted, label + ': baseline IR shape admission');
        assert.deepEqual(actualValidation, originalValidation, label + ': exact IR shape admission');
        const originalSQL = pinned.compiler.Codegen.generateSQL(example.ir);
        assert(originalSQL.includes(example.sqlFragment), label + ': baseline preserves the raw operand');
        assert.equal(current.Codegen.generateSQL(example.ir), originalSQL, label + ': exact unchecked SQL bytes');
        const rejection = compiler => {
            try { compiler.Codegen.generate(example.ir, false); }
            catch (error) { return { name: error.name, message: error.message, properties: { ...error } }; }
            assert.fail(label + ': complete generation must reject');
        };
        const originalError = rejection(pinned.compiler);
        assert(originalError.message.startsWith(example.irAccepted
            ? 'Cannot generate target code: MySQL target preflight failed.'
            : 'Cannot generate target code: Invalid IR -'), label + ': original admission phase');
        assert.deepEqual(rejection(current), originalError, label + ': exact complete-generation rejection');
        const candidate = schema.buildCandidate(example.ir);
        const rawField = candidate.definitions.entities[0].fields[0];
        const rawValue = rawField.defaultValue ? rawField.defaultValue.value : rawField.validations[0].value;
        assert(Object.is(rawValue, example.value), label + ': raw definitions retain the exact primitive');
        const nonFinite = [];
        const json = JSON.stringify(candidate.plan, (key, value) => {
            if (typeof value === 'number' && !Number.isFinite(value)) nonFinite.push(key);
            return value;
        });
        assert.deepEqual(nonFinite, [], label + ': serializer sees no non-finite plan operands');
        assert(!/Infinity|NaN/.test(json), label + ': serialized plan has no non-finite spellings');
        assert.deepEqual(JSON.parse(json), candidate.plan, label + ': lossless canonical JSON round trip');
        assert.equal(Object.getOwnPropertyDescriptor(candidate, 'definitions').enumerable, false,
            label + ': raw definitions stay outside serializable candidate');
        const plannedField = candidate.plan.entities[0].fields.find(field => field.origin.kind === 'declared');
        assert.equal(plannedField.defaultValue ? plannedField.defaultValue.value : plannedField.validations[0].value,
            null, label + ': canonical operand remains sanitized');
        assert.equal(candidate.issues.filter(issue => issue.code === 'NON_FINITE_VALUE').length, 1,
            label + ': canonical loss is explicitly recorded');
        assert(Object.is(rawField.defaultValue ? rawField.defaultValue.value : rawField.validations[0].value,
            example.value), label + ': helpers do not mutate the raw witness');
        report.rawSQLComparisons++;
        report[example.irAccepted ? 'rawIRAccepted' : 'rawIRRejected']++;
        report.rawFullRejectionMatches++;
    }
    for (const example of structuralIRCases()) {
        assert.equal(pinned.compiler.IR.validate(example.ir).valid, true, example.name + ': structural witness passes IR shape gate');
        if (example.acceptedBefore) assert(pinned.compiler.Codegen.generate(example.ir, false).files.length > 0,
            example.name + ': baseline accepts the intentional compatibility exception');
        else assert.throws(() => pinned.compiler.Codegen.generate(example.ir, false),
            /Target entity 'Missing' not found in IR/, example.name + ': preexisting endpoint rejection');
        report.structuralBaselineWitnesses++;
    }
    const requiredClosure = ['src/lexer/lexer.js', 'src/parser/parser.js', 'src/semantic/analyzer.js',
        'src/ir/generator.js', 'src/optimizer/optimizer.js', 'src/codegen/codegen.js',
        'src/codegen/openapi-fidelity.js', 'src/codegen/db-error-taxonomy.js', 'src/codegen/publish-output.js',
        'src/utils/mysql-target.js', 'src/utils/target-names.js', 'src/utils/temporal.js', 'src/utils/uuid.js',
        'src/utils/data-types.js', 'src/utils/errors.js', 'src/utils/diagnostics.js', 'src/ast/ast.js', 'package.json'];
    for (const filename of requiredClosure) assert(pinned.loadedPaths().includes(filename), filename + ': pinned closure exercised');
    report.pinnedLocalModules = pinned.loadedPaths().filter(name => name.startsWith('src/') || name === 'package.json').length;
    assert.equal(report.validSources + report.invalidDiagnosticMatches, report.uniqueSources);
    report.assertions = assertions;
    console.log('G22 pinned equivalence: ' + JSON.stringify(report));
    return report;
}

if (require.main === module) {
    try { runEquivalence(); }
    catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { runEquivalence };
