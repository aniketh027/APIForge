'use strict';
const assert=require('assert/strict');
const S=require('../src/migrations/snapshot');
const {compileSourceForSnapshot:compile}=require('../src/migrations/compile-source');
const {compileProject}=require('./generated-backend-test-helpers');
const {connect,database,introspect}=require('./migration-mysql-helpers');
const snapshotCases=[['types',`ENTITY User
uid UUID PRIMARY KEY
email STRING REQUIRED UNIQUE DEFAULT "hello"
age INT MIN -10 MAX 120 DEFAULT 0
weight FLOAT DEFAULT 1.5
active BOOLEAN DEFAULT FALSE
state ENUM("", "draft", "active", "a'b", "a\\b") DEFAULT "draft"
born DATE DEFAULT "2000-02-29"
seen TIMESTAMP DEFAULT "1970-01-01T00:00:01Z"
requiredTime TIMESTAMP REQUIRED
token UUID DEFAULT "550e8400-e29b-41d4-a716-446655440000"
label STRING MIN_LENGTH 0 MAX_LENGTH 300
ENTITY Profile
id INT PRIMARY KEY
ENTITY Post
id INT PRIMARY KEY DEFAULT 0
ENTITY Company
k STRING PRIMARY KEY MAX_LENGTH 300
ENTITY Group
k UUID PRIMARY KEY DEFAULT "550e8400-e29b-41d4-a716-446655440000"
ENTITY Member
v STRING
RELATION User PROFILE Profile ONE_TO_ONE
RELATION User POSTS Post ONE_TO_MANY
RELATION User COMPANY Company MANY_TO_ONE
RELATION User GROUPS Group MANY_TO_MANY`],
['reserved','ENTITY Order\nprimary INT UNIQUE\nselect STRING REQUIRED DEFAULT "a\\b"\nconstructor STRING\n__proto__ STRING'],
['long',`ENTITY ${'A'.repeat(64)}\n${'b'.repeat(64)} INT PRIMARY KEY\n${'c'.repeat(64)} STRING UNIQUE`],
['check-10','ENTITY Checks\n'+Array.from({length:10},(_,n)=>'v'+n+' INT MIN 0').join('\n')],
['check-100','ENTITY Checks\n'+Array.from({length:100},(_,n)=>'v'+n+' INT MIN 0').join('\n')],
['index-suffix','ENTITY Collision\nprimary INT UNIQUE\nprimary_2 INT UNIQUE\nENTITY Parent\nk INT PRIMARY KEY\nRELATION Parent LINK Collision ONE_TO_MANY'],
['enum-255','ENTITY Choice\nv ENUM('+Array.from({length:255},(_,i)=>'"v'+i+'"').join(',')+')'],
['enum-256','ENTITY Choice\nv ENUM('+Array.from({length:256},(_,i)=>'"v'+i+'"').join(',')+')']];
async function run(){const c=await connect();let count=0;try{
    for(const [name,source] of snapshotCases){await database(c,async db=>{const expected=compile(source);const sql=compileProject(source).find(f=>f.path==='database/schema.sql').content;await c.query(sql);assert.deepEqual(await introspect(c,db,expected.target),S.physicalProjection(expected),name+' exact native snapshot');count++;console.log('  snapshot '+name+' PASS');});}
    const Codegen=require('../src/codegen/codegen'),IR=require('../src/ir/generator');
    const forged={type:'PROGRAM',instructions:[{op:'CREATE_ENTITY',entity:'Mixed'},{op:'ADD_FIELD',entity:'Mixed',field:'v',dataType:'STRING',constraints:[],validations:[{type:'MIN',value:0},{type:'MAX',value:10},{type:'MIN_LENGTH',value:0},{type:'MAX_LENGTH',value:300}],defaultValue:null}]};
    if(IR.validate(forged).valid)await database(c,async db=>{const expected=require('../src/migrations/mysql-snapshot').buildMysqlSnapshot(Codegen.prepareAdmittedGeneration(forged).candidate.plan);await c.query(Codegen.generate(forged,false).files[0].content);assert.deepEqual(await introspect(c,db,expected.target),S.physicalProjection(expected));count++;});
    console.log('G26 HARD NATIVE SNAPSHOT GATE: '+count+' exact schemas PASS; cleanup PASS.');
}finally{await c.end();}}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={snapshotCases,run};
