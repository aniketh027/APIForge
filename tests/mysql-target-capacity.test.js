const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyze, compile, baselineModule, content } = require('./v1-hardening-helpers');
const { cases, fields, junction, enumSource, seededCases } = require('./mysql-target-capacity-cases');
const target = require('../src/utils/mysql-target');
const Codegen = require('../src/codegen/codegen');
const IR = require('../src/ir/generator');
let checks = 0, groups = 0;
function verify(value, message) { checks++; assert(value, message); }
function test(name, fn) { fn(); groups++; console.log('  PASS ' + name); }
test('source and forged-IR capacity boundaries, with located SEM037', () => {
    for (const [name, source, valid, message] of cases) {
        const result = analyze(source);
        verify(result.semantic.valid === valid, name + ': ' + JSON.stringify(result.semantic.errors));
        const ir = IR.generate(result.ast);
        if (valid) verify(Codegen.generate(ir, false).files.length > 0, name);
        else {
            const d = result.semantic.diagnostics.find(d => d.code === 'SEM037' && message.test(d.message));
            verify(d && d.symbol === 'MYSQL_TARGET_LIMIT' && d.line > 0 && d.column > 0 && d.hint, name);
            checks++; assert.throws(() => Codegen.generate(ir, false), /MySQL target preflight/);
            checks++; assert.throws(() => IR.generate(result.ast, result.semantic), /semantic/i);
        }
    }
});
test('physical contributors, leftmost FK reuse, two-part junction keys and mixed bytes', () => {
    const result = analyze(junction('STRING PRIMARY KEY MAX_LENGTH 759', 'UUID PRIMARY KEY'));
    const plans = target.physicalPlan(result.ast.entities, result.ast.relations);
    const j = plans[2];
    verify(j.columns.length === 2 && j.indexes.length === 2, 'source FK reuses primary; target FK gets one secondary');
    verify(j.indexes[0].parts.length === 2 && j.indexes[1].parts[0] === 'beta_k', 'junction parts match DDL');
    verify(j.columns.reduce((n, c) => n + target.storageBytes(c.field), 0) === 3072, 'STRING+UUID uses ASCII UUID bytes');
    const reused = { ...j, indexes: [{ kind: 'PRIMARY', parts: ['alpha_k','beta_k'], node: j.node }, { kind: 'FK', parts: Array(17).fill('beta_k'), node: j.node }] };
    verify(target.planIssues([reused]).some(i => /17 key parts/.test(i.message)), 'internal planner enforces 16 without a new DSL restriction');
    const columnCase = analyze(cases.find(c => c[0] === 'implicit-columns-1018')[1]);
    const d = columnCase.semantic.diagnostics.find(d => /physical columns/.test(d.message));
    verify(d.line === 1018 && d.column === 1, 'declared field that crosses limit');
    const relationCase = analyze(cases.find(c => c[0] === 'fk-columns-1018')[1]);
    verify(relationCase.semantic.diagnostics.find(d => /physical columns/.test(d.message)).line === 1020, 'relationship contributor');
});
test('physical storage widths, nullable bytes and DYNAMIC envelope', () => {
    const expected = { INT:4, FLOAT:4, BOOLEAN:1, DATE:3, TIMESTAMP:4, UUID:36 };
    for (const [dataType, size] of Object.entries(expected)) verify(target.storageBytes({dataType}) === size, dataType);
    for (const [n, size] of [[255,1],[256,2],[65535,2]]) verify(target.storageBytes({dataType:'ENUM',enumValues:Array(n)}) === size, 'ENUM storage '+n);
    const row = target.physicalPlan(analyze('ENTITY Wide\nv STRING MAX_LENGTH 16382').ast.entities)[0];
    verify(target.rowBudget(row).logical === 65535 && target.rowBudget(row).local === 64, 'length prefix, implicit key, NULL bit, MVCC/header');
    verify(target.rowBudget({...row,altered:true}).local === 65, 'instant ADD COLUMN row-version allowance');
});
test('ENUM count, scalar capacity, member location and existing language rules', () => {
    for (const n of [65535,65536]) {
        const source = enumSource(Array.from({length:n},(_,i)=>'v'+i)), result = analyze(source);
        verify(result.semantic.valid === (n === 65535), 'ENUM count '+n);
        if (n === 65536) { checks++; assert.throws(()=>Codegen.generate(IR.generate(result.ast),false),/65536 members/); }
    }
    const s = enumSource(['ok','x'.repeat(256)]), result = analyze(s);
    verify(result.semantic.diagnostics.find(d=>d.code==='SEM037').column === s.split('\n')[1].indexOf('"xxx') + 1, 'second member location');
    for (const source of [enumSource(['a','a']),enumSource(['a ']),'ENTITY Item\nv ENUM("a") DEFAULT "b"']) verify(!analyze(source).semantic.valid, 'existing ENUM semantics retained');
});
test('physical internal names include synthetic columns', () => {
    const result = analyze('ENTITY Db\nROW_ID INT PRIMARY KEY\nENTITY Child\nv BOOLEAN\nRELATION Db connects Child ONE_TO_MANY');
    verify(result.semantic.diagnostics.some(d=>d.code==='SEM037' && /db_ROW_ID/.test(d.message)), 'generated internal name');
    checks++; assert.throws(()=>Codegen.generate(IR.generate(result.ast),false),/reserved InnoDB/);
});
test('new rejections precede publication and preserve every existing output entry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g16-')), previous = process.cwd();
    try {
        fs.mkdirSync(path.join(dir,'output','database'),{recursive:true});
        fs.writeFileSync(path.join(dir,'output','database','schema.sql'),'OLD');
        fs.writeFileSync(path.join(dir,'output','.env'),'USER');
        process.chdir(dir);
        for (const [,source,valid] of cases.filter(c=>!c[2])) {
            checks++; assert.throws(()=>Codegen.generate(IR.generate(analyze(source).ast),true),/preflight/);
            verify(fs.readFileSync(path.join(dir,'output','database','schema.sql'),'utf8')==='OLD','schema unchanged');
            verify(fs.readFileSync(path.join(dir,'output','.env'),'utf8')==='USER','user root unchanged');
            verify(fs.readdirSync(dir).join(',')==='output','no staging/publication');
        }
    } finally { process.chdir(previous); fs.rmSync(dir,{recursive:true,force:true}); }
});
test('approved-main gaps reproduced and accepted artifacts remain byte-identical', () => {
    const oldTarget = baselineModule('src/utils/mysql-target.js','beda5c53b2a87402a857abd14a19d5f83ad66cc8');
    const oldCodegen = baselineModule('src/codegen/codegen.js','beda5c53b2a87402a857abd14a19d5f83ad66cc8');
    for (const [name,source,valid] of cases) {
        const result = analyze(source);
        if (!valid && !/key-3076|string-uuid-3076|string-int-3076/.test(name)) verify(oldTarget.targetIssues(result.ast.entities,result.ast.relations).length===0,'old gap '+name);
        if (valid) verify(JSON.stringify(compile(source).files) === JSON.stringify(oldCodegen.generate(IR.generate(result.ast),false).files),'generated bytes '+name);
    }
    for (const {name,source} of seededCases()) {
        const result=analyze(source); verify(result.semantic.diagnostics.every(d=>d.code==='SEM037'),name+' capacity-only sweep');
    }
    // Storage bounds apply only to schema DEFAULT, preserving G17 and HTTP scope.
    verify(analyze('ENTITY Item\nv INT MIN -9007199254740991 MAX 9007199254740991').semantic.valid,'large CHECK literals are valid DDL');
});
console.log(`MySQL target capacity: ${groups} groups / ${checks} assertions PASS.`);
