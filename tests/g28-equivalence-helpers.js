'use strict';
const assert=require('assert/strict'),Codegen=require('../src/codegen/codegen');
const plain=v=>JSON.parse(JSON.stringify(v));
function withoutLine(value){const {line,...rest}=value;return rest;}
function semanticProjection(result){
    const symbols=Object.fromEntries(Object.entries(result.semantic.entities).map(([name,e])=>[name,
        {...withoutLine(e),fields:Object.fromEntries(Object.entries(e.fields).map(([n,f])=>[n,withoutLine(f)]))}]));
    const relations=Object.fromEntries(Object.entries(result.semantic.relations).map(([n,r])=>[n,withoutLine(r)]));
    const diagnostic=d=>{const {line,column,endLine,endColumn,source,related,...rest}=d;return rest;};
    return plain({valid:result.semantic.valid,symbols,relations,diagnostics:result.semantic.diagnostics.map(diagnostic),warnings:result.warnings.map(diagnostic)});
}
function irProjection(ir){
    return plain({...ir,instructions:ir.instructions.map(i=>{
        assert(['CREATE_ENTITY','ADD_FIELD','CREATE_RELATION'].includes(i.op));return withoutLine(i);
    })});
}
function fixedCoordinates(ir){return {...ir,instructions:ir.instructions.map(i=>({...i,...(Object.hasOwn(i,'line')?{line:1}:{})}))};}
function reconstruct(result,target,files=result.generatedFiles){
    const original=Codegen.prepareAdmittedGeneration(result.optimizedIR,{target});
    const fixedIR=fixedCoordinates(result.optimizedIR);
    const fixed=Codegen.prepareAdmittedGeneration(fixedIR,{target});
    const neutral=Codegen.generate(fixedIR,false,{target}).files;
    assert.deepEqual(files.map(f=>f.path),neutral.map(f=>f.path));
    const slots=new Map(original.entities.map((e,i)=>{
        const other=fixed.entities[i];assert.equal(e.name,other.name);
        assert.deepEqual(plain(e.fields.map(withoutLine)),plain(other.fields.map(withoutLine)));
        const names=original.context.byName.get(e.name).names;
        const indent=target==='mysql'?12:4;
        return [names.modelPath,{before:JSON.stringify(e.fields,null,indent),after:JSON.stringify(other.fields,null,indent)}];
    }));
    return files.map((file,i)=>{
        const slot=slots.get(file.path);let content=file.content;
        if(slot){
            const position=content.indexOf(slot.before);assert(position>=0,'missing complete field metadata payload');
            assert.equal(content.indexOf(slot.before,position+1),-1,'ambiguous field metadata payload');
            content=content.slice(0,position)+slot.after+content.slice(position+slot.before.length);
        }
        assert.equal(content,neutral[i].content,'unauthorized model/artifact difference: '+file.path);
        return {path:file.path,content};
    });
}
function assertModuleGenerationEquivalent(a,b,target,aFiles=a.generatedFiles,bFiles=b.generatedFiles){
    assert.deepEqual(semanticProjection(a),semanticProjection(b));
    assert.deepEqual(irProjection(a.ir),irProjection(b.ir));assert.deepEqual(irProjection(a.optimizedIR),irProjection(b.optimizedIR));
    assert.deepEqual(plain(a.plan),plain(b.plan));
    const aa=Codegen.prepareAdmittedGeneration(a.optimizedIR,{target}),bb=Codegen.prepareAdmittedGeneration(b.optimizedIR,{target});
    assert.deepEqual(plain(aa.entities.map(e=>({...e,fields:e.fields.map(withoutLine)}))),plain(bb.entities.map(e=>({...e,fields:e.fields.map(withoutLine)}))));
    assert.deepEqual(reconstruct(a,target,aFiles),reconstruct(b,target,bFiles));
}
module.exports={assertModuleGenerationEquivalent,semanticProjection,irProjection,reconstruct};
