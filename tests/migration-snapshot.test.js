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
const a=compile('ENTITY Item\nv STRING'),b=compile('ENTITY Item\nid INT PRIMARY KEY\nv STRING');
check(()=>assert.equal(S.physicalSha256(a),S.physicalSha256(b)));check(()=>assert.notEqual(S.snapshotSha256(a),S.snapshotSha256(b)));
check(()=>assert.throws(()=>compile('ENTITY Item\nv DATETIME')));
console.log(`G26 snapshots: ${checks} checks PASS.`);
