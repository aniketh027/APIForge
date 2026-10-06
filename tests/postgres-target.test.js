'use strict';
const assert=require('assert/strict');
const c=require('./pinned-compiler-loader').currentCompiler();
const ddl=require('../src/targets/postgres/ddl'),names=require('../src/targets/postgres/names');
const {admit}=require('./postgres-native-helpers');
function semantic(source,target='postgres'){return c.Semantic.analyze(c.Parser.parse(c.Lexer.tokenize(source)),{target});}
let checks=0;
for(const value of [null,'',false,42,{},'Postgres','postgresql',' mysql']) {
    assert.throws(()=>require('../src/targets').resolveTarget({target:value}),e=>e.diagnostic.code==='INP003');checks++;
}
assert.equal(require('../src/targets').resolveTarget(), 'mysql');
assert.equal(semantic('ENTITY Bound keyValue INT PRIMARY KEY MIN 2 MAX 4').valid,true);
assert(semantic('ENTITY Bound keyValue INT PRIMARY KEY MIN 2 MAX 4','mysql').diagnostics.some(d=>d.code==='SEM037'));
assert(semantic('ENTITY Labels label ENUM("trailing ")','mysql').diagnostics.some(d=>d.code==='SEM036'));
assert.equal(semantic('ENTITY Labels label ENUM("trailing ")').valid,true);
assert.equal(semantic('ENTITY Exact value INT Value INT Id INT').valid,true);
assert.equal(semantic('ENTITY Exact value INT Value INT Id INT','mysql').valid,false);
for(const name of names.SYSTEM_COLUMNS)assert(semantic('ENTITY System '+name+' INT').diagnostics.some(d=>d.code==='SEM040'));
for(const kind of names.KINDS)assert.match(names.generatedName(kind,'owner',['f'],'purpose'),/^af_(pk|uq|ck|fk|ix|seq|nn)_[0-9a-f]{40}$/);
assert.deepEqual(names.KINDS,['pk','uq','ck','fk','ix','seq','nn']);
assert.equal(names.generatedName('pk','owner',['f'],'purpose'),'af_pk_'+require('crypto').createHash('sha256').update(JSON.stringify(['postgresql-18-v1','pk','owner',['f'],'purpose'])).digest('hex').slice(0,40));
assert.throws(()=>names.generatedName('foreign_key_constraint','owner'));
for(const name of ['bad\0name','\ud800','\udc00','a'.repeat(64),'é'.repeat(32)])assert.throws(()=>names.quoteIdentifier(name));
assert.equal(names.quoteIdentifier('a"b'),'"a""b"');
for(const width of [668,669])assert.equal(semantic('ENTITY Width keyValue STRING PRIMARY KEY MAX_LENGTH '+width).valid,true);
assert(semantic('ENTITY Width keyValue STRING PRIMARY KEY MAX_LENGTH 670').diagnostics.some(d=>d.code==='SEM040'));
assert(semantic('ENTITY Huge value STRING MAX_LENGTH 10485761').diagnostics.some(d=>d.code==='SEM040'));
assert(semantic('ENTITY DefaultTooLong value STRING DEFAULT "'+'x'.repeat(256)+'"').diagnostics.some(d=>d.code==='SEM040'));
const schema=require('../src/planning/effective-schema');
for(const length of [1599,1600]) {
    const fields=Array.from({length},(_,i)=>({name:'c'+i,dataType:'INT',constraints:[],validations:[],defaultValue:null}));
    const plan=ddl.physicalPlan(schema.projectDefinitions([{name:'ColumnCount',fields}],[],{comparison:v=>v}));
    assert.equal(plan.issues.some(i=>i.message.includes('exceeds 1600 columns')),length===1600);
    if(length===1599)assert.equal(plan.issues.length,0);
}
for(const value of ['3.5e38','1e-46'])assert(ddl.targetIssues([{name:'FloatValue',fields:[{name:'value',dataType:'FLOAT',constraints:[],validations:[],defaultValue:{type:'NUMBER',value:Number(value)}}]}]).length);
const source='ENTITY Basic value STRING countValue INT DEFAULT 4';
const ast=c.Parser.parse(c.Lexer.tokenize(source)),my=c.Semantic.analyze(ast),pg=c.Semantic.analyze(ast,{target:'postgres'});
assert.deepEqual(JSON.parse(JSON.stringify(pg)),JSON.parse(JSON.stringify(my)));
const ir=c.Optimizer.optimize(c.IR.generate(ast,my)).ir;
const original=JSON.stringify(ir);
assert.deepEqual(c.Codegen.prepareAdmittedGeneration(ir).candidate.plan,c.Codegen.prepareAdmittedGeneration(ir,{target:'postgres'}).candidate.plan);
assert.equal(JSON.stringify(ir),original);
const p=admit('ENTITY Allocated value INT').context.physical;
const collision=p.tables[0].indexes[0].name;
assert(semantic('ENTITY Allocated value INT ENTITY '+collision+' value INT').diagnostics.some(d=>d.code==='SEM040'));
for(const size of [62,63,64]) {
    const copy=structuredClone(ir);for(const instruction of copy.instructions)instruction.entity='é'.repeat(30)+'a'.repeat(size-60);
    if(size<=63)assert(c.Codegen.prepareAdmittedGeneration(copy,{target:'postgres'}).context.physical);
    else assert.throws(()=>c.Codegen.prepareAdmittedGeneration(copy,{target:'postgres'}),e=>e.diagnostic.code==='GEN001');
}
let commonSwagger=0;
const pinned=require('./pinned-compiler-loader').createPinnedCompiler({revision:'24a6289aabad9f24dcdee34d1854373c6727103a'});
c.Codegen.generate(ir,false,{target:'postgres'});
assert.deepEqual(c.Codegen.generate(ir,false).files,pinned.compile(source).files,'PG composition does not change default MySQL');
for(const entry of require('./effective-schema-corpus').rawSQLCases())assert.equal(c.Codegen.generateSQL(entry.ir),pinned.compiler.Codegen.generateSQL(entry.ir),entry.name+' legacy unchecked MySQL after PG');
for(const entry of require('./effective-schema-corpus').sourceCases(pinned).cases) {
    const mysql=pinned.compile(entry.source);if(!mysql.valid)continue;
    const ast=c.Parser.parse(c.Lexer.tokenize(entry.source)),sem=c.Semantic.analyze(ast,{target:'postgres'});if(!sem.valid)continue;
    const ir=c.Optimizer.optimize(c.IR.generate(ast,sem)).ir;
    const postgres=c.Codegen.generate(ir,false,{target:'postgres'});
    assert.equal(postgres.files.find(f=>f.path==='swagger.json').content,mysql.files.find(f=>f.path==='swagger.json').content,entry.name+' common Swagger');
    for(const file of postgres.files.filter(f=>f.path.endsWith('.js')))new(require('vm').Script)(file.content,{filename:file.path});
    commonSwagger++;
}
console.log(JSON.stringify({invalidTargetCases:checks,commonSwagger,result:'PASS',profile:names.PROFILE}));
