'use strict';
const assert=require('assert/strict');
const S=require('../src/migrations/snapshot');
const {compileSourceForSnapshot:compile}=require('../src/migrations/compile-source');
let checks=0;
function check(fn){fn();checks++;}
for(const key of ['', 'k INT PRIMARY KEY','k INT PRIMARY KEY DEFAULT 0','k STRING PRIMARY KEY','k UUID PRIMARY KEY','k UUID PRIMARY KEY DEFAULT "550e8400-e29b-41d4-a716-446655440000"']){
    const source='ENTITY Item\n'+key+'\nv STRING';const s=compile(source);
    check(()=>assert.equal(S.canonical(s),S.canonical(compile(source))));check(()=>assert.deepEqual(S.parseCanonical(S.canonical(s)),s));check(()=>assert.equal(S.hash(s).length,64));
}
check(()=>assert.equal(S.canonical({b:1,a:2}),S.canonical({a:2,b:1})));
check(()=>assert.throws(()=>S.canonical({a:Infinity})));
check(()=>assert.throws(()=>S.parseCanonical('{"a":1,"a":2}\n')));
check(()=>assert.deepEqual(S.parseCanonical(Buffer.from('{"a":1}\n')), {a:1}));
check(()=>assert.throws(()=>S.parseCanonical(Buffer.from([123,34,97,34,58,34,255,34,125,10])),{code:'MIGRATION_HISTORY_CORRUPT'}));
check(()=>assert.equal(S.physicalSha256(compile('ENTITY FloatValue\nv FLOAT DEFAULT 0.1')),S.physicalSha256(compile('ENTITY FloatValue\nv FLOAT DEFAULT 0.10000000149011612'))));
const a=compile('ENTITY Item\nv STRING'),b=compile('ENTITY Item\nid INT PRIMARY KEY\nv STRING');
check(()=>assert.equal(S.physicalSha256(a),S.physicalSha256(b)));check(()=>assert.notEqual(S.snapshotSha256(a),S.snapshotSha256(b)));
check(()=>assert.throws(()=>compile('ENTITY Item\nv DATETIME')));
for(const value of [new Map(),new Set(),new Date(),{a:()=>0},Object.defineProperty({},'hidden',{value:1}),Object.defineProperty({},'getter',{enumerable:true,get(){throw Error('must not run');}}),{[Symbol('x')]:1},'\ud800'])check(()=>assert.throws(()=>S.canonical(value),{code:'MIGRATION_HISTORY_CORRUPT'}));
for(const mutate of [s=>{s.tables[0].columns[1].default.declared=false;},s=>{s.tables[0].columns[1].logicalType='DATETIME';},s=>{s.tables[0].columns[1].physicalType.length=16384;},s=>{s.tables[0].columns[1].character.collation='utf8mb4_bin';},s=>{s.tables[0].primaryKey.id='wrong';},s=>{s.tables[0].columns[0].nullable=true;},s=>{s.target.profile.lowerCaseTableNames=1;}]){const broken=S.clone(a);mutate(broken);check(()=>assert.throws(()=>S.validateSnapshot(broken)));}
const {createPinnedCompiler}=require('./pinned-compiler-loader'),{sourceCases}=require('./effective-schema-corpus');const pinned=createPinnedCompiler({revision:'1caf927b5bcef627575a36c1d29800ce03e6f17c'});let admitted=0;
for(const entry of sourceCases(pinned).cases)if(pinned.compile(entry.source).valid){check(()=>S.validateSnapshot(compile(entry.source)));admitted++;}
console.log('  admitted corpus snapshots: '+admitted);
console.log(`G26 snapshots: ${checks} checks PASS.`);
