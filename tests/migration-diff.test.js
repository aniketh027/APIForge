'use strict';
const assert=require('assert/strict'),{compileSourceForSnapshot:c}=require('../src/migrations/compile-source'),{diffSnapshots:d}=require('../src/migrations/diff');
const a=c('ENTITY Item\nv STRING');assert.equal(d(a,a).intents.length,0);
assert(d(a,c('ENTITY Item\nv STRING\nx INT')).intents.some(i=>i.kind==='add_column'));
assert(d(a,c('ENTITY Other\nv STRING')).intents.some(i=>i.kind==='drop_table'));
assert(d(a,c('ENTITY Item\nid INT PRIMARY KEY\nv STRING')).intents.some(i=>i.kind==='modify_column'));
console.log('G26 structural diff: 4 checks PASS.');
