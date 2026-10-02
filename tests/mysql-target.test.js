const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyze, compile, baselineModule, content, syntax } = require('./v1-hardening-helpers');
const oldSemantic = baselineModule('src/semantic/analyzer.js'), oldGenerator = baselineModule('src/codegen/codegen.js');
const Codegen = require('../src/codegen/codegen');
let groups = 0;
async function test(name, fn) { await fn(); groups++; console.log('  PASS ' + name); }
function decode(literal) {
    let result = '';
    const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', '0': '\0', Z: '\x1a' };
    for (let i = 1; i < literal.length - 1; i++) {
        if (literal[i] === '\\') { const ch = literal[++i]; result += escapes[ch] ?? ch; }
        else if (literal[i] === "'" && literal[i + 1] === "'") { result += "'"; i++; }
        else result += literal[i];
    }
    return result;
}
(async () => {
    await test('one SQL literal authority preserves STRING and ENUM apostrophes/backslashes/Unicode/empty values', () => {
        for (const value of ['', "O'Reilly", 'C:\\new', "C:\\O'Reilly", '😀漢字', '\\', '\\n\\t']) {
            const current = Codegen.formatSQLLiteral({ type: 'STRING', value });
            assert.equal(decode(current), value);
            assert.equal(current, Codegen.formatSQLLiteral({ type: 'STRING', value }, true));
            const c = compile(`ENTITY Item id INT PRIMARY KEY text STRING DEFAULT "${value}"`); syntax(c.files);
            assert(content(c.files, 'database/schema.sql').includes('DEFAULT ' + current));
            assert.equal(JSON.parse(content(c.files, 'swagger.json')).components.schemas['Item.Create'].properties.text.default, value);
        }
        const value = 'C:\\new';
        assert.notEqual(decode(oldGenerator.formatSQLLiteral({ type: 'STRING', value })), value);
        assert.throws(() => assert.equal(decode(oldGenerator.formatSQLLiteral({ type: 'STRING', value })), value));
    });
    await test('raw numeric metadata catches overflow and precision loss before targets while preserving valid AST/IR bytes', () => {
        const huge = '9'.repeat(400);
        for (const source of [`ENTITY Item value INT DEFAULT 9007199254740993`, `ENTITY Item value INT MIN 9007199254740993`,
            `ENTITY Item value FLOAT DEFAULT ${huge}`, `ENTITY Item value FLOAT MAX ${huge}`,
            'ENTITY Item value INT DEFAULT 9007199254740991.1', 'ENTITY Item value INT MIN 1.00000000000000000000001']) {
            assert.equal(analyze(source, oldSemantic).semantic.valid, true);
            const current = analyze(source).semantic; assert.equal(current.valid, false);
            const diagnostic = current.diagnostics.find(d => d.code === 'SEM035'); assert(diagnostic);
            assert(diagnostic.column && diagnostic.endColumn > diagnostic.column); assert(diagnostic.hint);
        }
        for (const source of ['ENTITY Item value INT DEFAULT 1.0 MIN -5 MAX 9007199254740991',
            'ENTITY Item value FLOAT DEFAULT 0.125 MAX 100000000000000000000000000000000000000']) {
            const c = compile(source); syntax(c.files);
            const field = c.ast.entities[0].fields[0];
            assert(field.defaultValue.rawNumber); assert(!Object.keys(field.defaultValue).includes('rawNumber'));
            assert.equal(JSON.stringify(c.ast), JSON.stringify(analyze(source, oldSemantic).ast));
            assert(!JSON.stringify(c.ir).includes('rawNumber'));
        }
        const c = compile('ENTITY Item value FLOAT');
        const ir = structuredClone(c.optimized); ir.instructions.find(i => i.op === 'ADD_FIELD').defaultValue = { type: 'NUMBER', value: Infinity };
        assert.throws(() => Codegen.generate(ir, false), /preflight|Invalid IR/);
    });
    await test('native ENUM trailing spaces reject at exact member range; leading/empty members and defaults remain legal', () => {
        for (const source of ['ENTITY Item value ENUM("a ")', 'ENTITY Item value ENUM("a", "a ") DEFAULT "a "']) {
            assert.equal(analyze(source, oldSemantic).semantic.valid, true);
            const current = analyze(source).semantic; assert.equal(current.valid, false);
            assert(current.diagnostics.some(d => d.code === 'SEM036' && d.endColumn > d.column));
        }
        const c = compile('ENTITY Item value ENUM(" a", "", "A") DEFAULT " a"');
        assert.deepEqual(c.ast.entities[0].fields[0].enumValues, [' a', '', 'A']); syntax(c.files);
    });
    await test('all source and composed identifier limits and utf8mb4 individual/composite key capacities preflight', () => {
        const name = 'A'.repeat(65), largeSource = 'P'.repeat(40), largeTarget = 'C'.repeat(25);
        const cases = [
            `ENTITY ${name} id INT PRIMARY KEY`, `ENTITY Item ${name} INT PRIMARY KEY`,
            `ENTITY ${largeSource} id INT PRIMARY KEY ENTITY ${largeTarget} id INT PRIMARY KEY RELATION ${largeSource} connects ${largeTarget} MANY_TO_MANY`,
            `ENTITY ${'P'.repeat(60)} code STRING PRIMARY KEY ENTITY Child id INT PRIMARY KEY RELATION ${'P'.repeat(60)} connects Child ONE_TO_MANY`,
            `ENTITY ${'A'.repeat(60)} id INT PRIMARY KEY value INT MIN 0`,
            'ENTITY Item id INT PRIMARY KEY value STRING MAX_LENGTH 100000',
            'ENTITY Item value STRING UNIQUE MAX_LENGTH 769',
            'ENTITY Parent code STRING PRIMARY KEY MAX_LENGTH 400 ENTITY Child code STRING PRIMARY KEY MAX_LENGTH 400 RELATION Parent connects Child MANY_TO_MANY'
        ];
        for (const source of cases) {
            const old = analyze(source, oldSemantic); assert.equal(old.semantic.valid, true);
            const current = analyze(source).semantic; assert.equal(current.valid, false);
            assert(current.diagnostics.some(d => d.code === 'SEM037' && d.column && d.hint));
            const ir = require('../src/ir/generator').generate(old.ast, old.semantic);
            assert.throws(() => Codegen.generate(ir, false), /preflight/);
        }
        for (const source of [`ENTITY ${'A'.repeat(64)} id INT PRIMARY KEY`, 'ENTITY Item code STRING PRIMARY KEY MAX_LENGTH 768',
            'ENTITY Item id INT PRIMARY KEY text STRING MAX_LENGTH 1000',
            'ENTITY Parent code STRING PRIMARY KEY MAX_LENGTH 384 ENTITY Child code STRING PRIMARY KEY MAX_LENGTH 384 RELATION Parent connects Child MANY_TO_MANY']) syntax(compile(source).files);
    });
    await test('failed target preflight leaves existing output unchanged; Node requirement matches declared Express dependency', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-target-')), previous = process.cwd();
        try {
            fs.mkdirSync(path.join(dir, 'output', 'database'), { recursive: true }); fs.writeFileSync(path.join(dir, 'output', 'database', 'schema.sql'), 'OLD');
            process.chdir(dir);
            const source = 'ENTITY Item value STRING MAX_LENGTH 100000', old = analyze(source, oldSemantic);
            const ir = require('../src/ir/generator').generate(old.ast, old.semantic);
            assert.throws(() => Codegen.generate(ir, true), /preflight/);
            assert.equal(fs.readFileSync(path.join(dir, 'output', 'database', 'schema.sql'), 'utf8'), 'OLD');
            assert.deepEqual(fs.readdirSync(path.join(dir, 'output')), ['database']);
        } finally { process.chdir(previous); fs.rmSync(dir, { recursive: true, force: true }); }
        const manifest = JSON.parse(Codegen.generatePackageJson()); assert.deepEqual(manifest.engines, { node: '>=18' });
        assert.equal(require('express/package.json').engines.node, '>= 18');
    });
    console.log(`MySQL target: ${groups} groups PASS; SQL literal decoder assumes supported backslash mode; LIVE MYSQL UNAVAILABLE.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
