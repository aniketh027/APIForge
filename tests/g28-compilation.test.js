'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {compileFile}=require('../src/compiler');
const {owner}=require('../src/modules/provenance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-compile-'));let checks=0;
function w(name,source){fs.writeFileSync(path.join(root,name),source);return path.join(root,name);}
function error(source,code,target='mysql',file='b.apiforge'){
    w(file,source);const entry=w('main.apiforge','IMPORT "a.apiforge" IMPORT "'+file+'"');
    assert.throws(()=>compileFile(entry,{target}),e=>{const d=e.diagnostics.find(d=>d.code===code);assert(d,JSON.stringify(e.diagnostics));assert.equal(d.source,file);assert(!JSON.stringify(e.diagnostics).includes(root));return true;});checks++;
}
try {
    w('a.apiforge','ENTITY A k INT PRIMARY KEY');w('b.apiforge','ENTITY B v STRING');
    w('relations.apiforge','RELATION A LINKS B MANY_TO_MANY');
    const entry=w('main.apiforge','IMPORT "a.apiforge" IMPORT "b.apiforge" IMPORT "relations.apiforge"');
    for(const target of ['mysql','postgres']){
        const r=compileFile(entry,{target});assert.equal(r.generatedFiles.length,13);assert.equal(r.warnings[0].source,'b.apiforge');checks+=2;
        assert.deepEqual(r.ir.instructions.filter(i=>i.op==='CREATE_ENTITY').map(i=>i.entity),['A','B']);checks++;
        for(const i of r.optimizedIR.instructions){assert(owner(i));assert(!Object.keys(i).includes('source'));checks++;}
        assert(!JSON.stringify(r.plan).includes('.apiforge'));assert(!JSON.stringify(r.generatedFiles).includes('.apiforge'));checks+=2;
    }
    error('ENTITY A v STRING','SEM002');
    assert.throws(()=>compileFile(path.join(root,'main.apiforge')),e=>{const d=e.diagnostics.find(d=>d.code==='SEM002');assert.equal(d.related[0].message,'Previous declaration.');assert.equal(d.related[0].source,'a.apiforge');return true;});checks++;
    error('RELATION A LINKS Absent MANY_TO_MANY','SEM029');
    error('RELATION Absent LINKS A MANY_TO_MANY','SEM028');
    error('ENTITY B v ENUM("trailing ")','SEM036');
    error('ENTITY B k INT PRIMARY KEY MIN 0','SEM037');
    error('ENTITY '+ 'X'.repeat(64)+' v STRING','SEM040','postgres');
    error('ENTITY B v','PAR012');error('ENTITY B @','LEX001');
    w('b.apiforge','RELATION A LINKS A ONE_TO_ONE');w('a.apiforge','ENTITY A k INT PRIMARY KEY RELATION A LINKS A ONE_TO_ONE');
    assert.throws(()=>compileFile(path.join(root,'main.apiforge')),e=>{const d=e.diagnostics.find(d=>d.code==='SEM024');assert.equal(d.source,'b.apiforge');assert.equal(d.related[0].source,'a.apiforge');return true;});checks++;
    for(const name of ['__proto__','constructor','prototype','entities','relations'])w(name+'.apiforge','ENTITY '+name+' v STRING');
    const proto=w('main.apiforge',['__proto__','constructor','prototype','entities','relations'].map(n=>'IMPORT "'+n+'.apiforge"').join('\n'));
    const result=compileFile(proto);assert.equal(result.plan.entities.length,5);assert.equal(Object.getPrototypeOf(result.symbolTable),null);checks+=2;
    assert.deepEqual(result.warnings.map(d=>d.source),['__proto__.apiforge','constructor.apiforge','prototype.apiforge','entities.apiforge','relations.apiforge']);checks++;
    for(const warning of result.warnings){const frame=result.compilationUnit.format(warning);assert(frame.includes('--> '+warning.source+':1, column 8'));assert(frame.includes('ENTITY '+warning.source.slice(0,-9)));checks++;}
    const empty=w('main.apiforge','IMPORT "empty.apiforge"');w('empty.apiforge','');
    assert.throws(()=>compileFile(empty),e=>e.diagnostic.code==='SEM001');checks++;
    assert.throws(()=>compileFile('missing.apiforge',{target:'bad'}),e=>e.diagnostic.code==='INP003');checks++;
    console.log(JSON.stringify({gate:'whole-program/provenance',checks,result:'PASS'}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
