const assert = require('assert/strict');
const { analyze, compile, baselineModule, content, syntax } = require('./v1-hardening-helpers');
const { load } = require('./request-validation-test-helpers');
const oldSemantic = baselineModule('src/semantic/analyzer.js');
const oldGenerator = baselineModule('src/codegen/codegen.js');
const kinds = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];
let groups = 0, executions = 0;
async function test(name, fn) { await fn(); groups++; console.log('  PASS ' + name); }
(async () => {
    await test('baseline accepts colliding allocations; corrected semantic and direct-IR preflight reject', () => {
        const prefix = 'ENTITY Parent id INT PRIMARY KEY ENTITY Child id INT PRIMARY KEY ';
        const cases = [];
        for (const kind of kinds) cases.push(prefix + `RELATION Parent first Child ${kind} RELATION Parent second Child ${kind}`);
        cases.push('ENTITY Parent id INT PRIMARY KEY ENTITY Child id INT PRIMARY KEY parent_id INT RELATION Parent children Child ONE_TO_MANY');
        cases.push(prefix + 'ENTITY Parent_Child id INT PRIMARY KEY RELATION Parent children Child MANY_TO_MANY');
        cases.push(prefix + 'RELATION Parent children Child ONE_TO_MANY RELATION Child parent Parent MANY_TO_ONE');
        cases.push('ENTITY Parent id INT PRIMARY KEY ENTITY Foo id INT PRIMARY KEY ENTITY foos id INT PRIMARY KEY RELATION Parent first Foo ONE_TO_MANY RELATION Parent second foos MANY_TO_ONE');
        cases.push('ENTITY Child id INT PRIMARY KEY ENTITY ChildById id INT PRIMARY KEY RELATION Child first ChildById ONE_TO_ONE');
        for (const source of cases) {
            const old = analyze(source, oldSemantic); assert.equal(old.semantic.valid, true);
            assert.throws(() => assert.equal(old.semantic.valid, false));
            const current = analyze(source).semantic; assert.equal(current.valid, false);
            const errors = current.diagnostics.filter(d => d.code === 'SEM034'); assert(errors.length);
            assert(errors.every(d => d.column && d.endColumn > d.column && d.hint && /conflicts with/.test(d.message)));
            const ir = require('../src/ir/generator').generate(old.ast, old.semantic);
            assert.throws(() => require('../src/codegen/codegen').generate(ir, false), /collision/);
        }
    });
    await test('all four cardinalities execute bound quoted SQL across five source/target key variants', async () => {
        for (const kind of kinds) for (const [sourceKey, targetKey] of [
            ['id INT PRIMARY KEY', 'id INT PRIMARY KEY'],
            ['select STRING PRIMARY KEY MAX_LENGTH 300', 'key STRING PRIMARY KEY MAX_LENGTH 400'],
            ['label STRING', 'id INT PRIMARY KEY'], ['id INT PRIMARY KEY', 'label STRING'], ['label STRING', 'label STRING']]) {
            const source = `ENTITY Parent ${sourceKey} ENTITY Order ${targetKey} RELATION Parent orders Order ${kind}`;
            const c = compile(source); syntax(c.files);
            const calls = [];
            const Model = load(content(c.files, 'models/Parent.js'), () => ({ query: async (sql, values) => { calls.push({ sql, values }); return [sql.startsWith('DELETE') ? { affectedRows: 1 } : [{ id: 7 }]]; } }));
            const many = ['ONE_TO_MANY', 'MANY_TO_MANY'].includes(kind);
            await Model[many ? 'getOrders' : 'getOrder']("x' OR 1=1 --"); executions++;
            assert(calls[0].sql.includes('FROM `Order`')); assert(!calls[0].sql.includes("x'"));
            assert.deepEqual(calls[0].values, ["x' OR 1=1 --"]);
            if (targetKey.startsWith('key') && ['MANY_TO_ONE', 'MANY_TO_MANY'].includes(kind)) assert(calls[0].sql.includes('t.`key`'));
            if (sourceKey.startsWith('select') && kind === 'MANY_TO_ONE') assert(calls[0].sql.includes('s.`select`'));
            if (kind === 'MANY_TO_MANY') {
                await Model.addOrder('source', 'target'); await Model.removeOrder('source', 'target'); executions += 2;
                assert.deepEqual(calls.slice(1).map(c => c.values), [['source', 'target'], ['source', 'target']]);
                assert(calls[1].sql.includes('VALUES (?, ?)')); assert(calls[2].sql.includes(' = ? AND '));
            }
            const sql = content(c.files, 'database/schema.sql');
            assert(sql.includes('REFERENCES `Order`') || kind === 'ONE_TO_MANY' || kind === 'ONE_TO_ONE');
            if (sourceKey.startsWith('select') && kind !== 'MANY_TO_ONE') assert(sql.includes('parent_select VARCHAR(300)'));
            if (targetKey.startsWith('key') && ['MANY_TO_MANY', 'MANY_TO_ONE'].includes(kind)) assert(sql.includes('order_key VARCHAR(400)'));
            assert(sql.includes(kind === 'ONE_TO_MANY' || kind === 'MANY_TO_ONE' ? 'ON DELETE SET NULL' : 'ON DELETE CASCADE'));
            const doc = JSON.parse(content(c.files, 'swagger.json'));
            const route = `/parents/{id}/${many ? 'orders' : 'order'}`;
            assert(doc.paths[route]); assert.equal(doc.paths[route].parameters[0].schema.type, sourceKey.startsWith('select') ? 'string' : 'integer');
            // Pinned old helper demonstrates missing quoting; the same assertion fails.
            const old = oldGenerator.generate(c.optimized, false).files;
            const oldCalls = [];
            const Old = load(content(old, 'models/Parent.js'), () => ({ query: async (sql, values) => { oldCalls.push(sql); return [[]]; } }));
            await Old[many ? 'getOrders' : 'getOrder']('source');
            assert.throws(() => assert(oldCalls[0].includes('FROM `Order`')));
        }
    });
    await test('ordinary SQL/API allocations retain every emitted byte; multiple disjoint relationships remain legal', () => {
        for (const kind of kinds) {
            const source = `ENTITY Parent id INT PRIMARY KEY ENTITY Child id INT PRIMARY KEY ENTITY Other id INT PRIMARY KEY RELATION Parent first Child ${kind} RELATION Parent second Other ${kind}`;
            const c = compile(source); syntax(c.files);
            assert.deepEqual(require('./hardening-compatibility').projectHardeningChanges(c.files, source), oldGenerator.generate(c.optimized, false).files);
        }
    });
    console.log(`Relationship safety: ${groups} groups PASS; ${executions} emitted helper calls; live MySQL unverified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
