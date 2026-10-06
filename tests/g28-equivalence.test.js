'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {compileFile}=require('../src/compiler');const M=require('../src/migrations'),Codegen=require('../src/codegen/codegen');
const {assertModuleGenerationEquivalent}=require('./g28-equivalence-helpers');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'apiforge-g28-equivalence-'));
const fixtures=[
    'ENTITY Item\nk INT PRIMARY KEY\nline STRING DEFAULT "line" MAX_LENGTH 300',
    'ENTITY Scalar\nk UUID PRIMARY KEY\nv INT DEFAULT 0 MIN 0 MAX 2\nf FLOAT DEFAULT 0\nb BOOLEAN DEFAULT FALSE\ns STRING DEFAULT ""\ne ENUM("draft","active") DEFAULT "draft"\nd DATE DEFAULT "2000-02-29"\nt TIMESTAMP DEFAULT "2000-02-29T12:34:56Z"\nu UUID DEFAULT "550e8400-e29b-41d4-a716-446655440000"',
    ...['ONE_TO_ONE','ONE_TO_MANY','MANY_TO_ONE','MANY_TO_MANY'].map(card=>'ENTITY Parent\nk STRING PRIMARY KEY\nENTITY Child\nk INT PRIMARY KEY\nv STRING\nRELATION Parent LINKS Child '+card)
    ,'ENTITY Implicit\nline STRING DEFAULT "line"\nENTITY Value\nkey INT PRIMARY KEY DEFAULT -1\nvalue FLOAT DEFAULT 1.25'
    ,'ENTITY StaticUuid\nkey UUID PRIMARY KEY DEFAULT "550e8400-e29b-41d4-a716-446655440000"\nENTITY StaticInt\nkey INT PRIMARY KEY DEFAULT 0\nENTITY StaticText\nkey STRING PRIMARY KEY DEFAULT "fixed"'
    ,'ENTITY IMPORT\nkey INT PRIMARY KEY\nIMPORT STRING\n__proto__ STRING\nconstructor STRING\nprototype STRING'
];
let c1=0,c2=0,files=0,modelReconstructions=0,canaries=0;
const canaryCategories={};
function counted(category,target){
    const counts=canaryCategories[category]??= {mysql:0,postgres:0};counts[target]++;canaries++;
}
function replacePresent(content,before,after){
    assert(content.includes(before),'missing canary operand: '+before);
    assert.notEqual(before,after);return content.replace(before,after);
}
function rejectArtifact(a,c,target,result,file,category,mutate){
    assert(file,'missing canary artifact');const content=mutate(file.content);
    assert.notEqual(content,file.content,category+' canary must change the artifact');
    const altered=result.generatedFiles.map(f=>f===file?{...f,content}:f);
    assert.notDeepEqual(altered,result.generatedFiles);
    assert.throws(()=>assertModuleGenerationEquivalent(a,c,target,result===a?altered:a.generatedFiles,result===c?altered:c.generatedFiles),category+' must be rejected');
    counted(category,target);
}
function field(fields,name){const selected=fields.find(f=>f.name===name);assert(selected,'missing field '+name);return selected;}
function changeFields(a,c,target,result,entityName,category,change){
    const admission=Codegen.prepareAdmittedGeneration(result.optimizedIR,{target});
    const entity=admission.entities.find(e=>e.name===entityName);assert(entity);
    const file=result.generatedFiles.find(f=>f.path===admission.context.byName.get(entityName).names.modelPath);
    const indent=target==='mysql'?12:4,before=JSON.stringify(entity.fields,null,indent),changed=JSON.parse(before);
    change(changed);assert.notDeepEqual(changed,entity.fields);
    const after=JSON.stringify(changed,null,indent);
    rejectArtifact(a,c,target,result,file,category,content=>{
        const start=content.indexOf(before);assert(start>=0,'missing complete Model.fields payload');
        assert.equal(content.indexOf(before,start+1),-1,'ambiguous Model.fields payload');
        return content.slice(0,start)+after+content.slice(start+before.length);
    });
}
function changeWriteFields(content,change){
    const prefix='const WRITE_FIELDS = ',start=content.indexOf(prefix);assert(start>=0,'missing WRITE_FIELDS');
    const first=start+prefix.length,last=content.indexOf(';\n',first);assert(last>first);
    const before=content.slice(first,last),changed=JSON.parse(before);
    assert.equal(JSON.stringify(changed,null,4),before,'unexpected WRITE_FIELDS formatting');
    change(changed);const after=JSON.stringify(changed,null,4);assert.notEqual(before,after);
    return content.slice(0,first)+after+content.slice(last);
}
function materialize(base,source,shifted){
    fs.mkdirSync(base,{recursive:true});const lines=source.split('\n'),starts=[];
    lines.forEach((line,i)=>{if(/^(ENTITY|RELATION) /.test(line))starts.push(i);});
    const imports=[];
    starts.forEach((start,i)=>{
        const relative=shifted?'nested/renamed'+i+'.apiforge':'part'+i+'.apiforge';
        const filename=path.join(base,relative);fs.mkdirSync(path.dirname(filename),{recursive:true});
        const chunk=lines.slice(start,starts[i+1]??lines.length).join('\n');
        fs.writeFileSync(filename,'\n'.repeat(shifted?13+i*7:start)+chunk);
        if(shifted){fs.writeFileSync(path.join(base,'bridge'+i+'.apiforge'),'IMPORT "'+relative+'"');imports.push('IMPORT "bridge'+i+'.apiforge"');}
        else imports.push('IMPORT "'+relative+'"');
    });
    const entry=path.join(base,'main.apiforge');fs.writeFileSync(entry,imports.join('\n'));return entry;
}
try {
    for(const [i,source] of fixtures.entries()){
        const flat=path.join(root,'flat'+i+'.apiforge');fs.writeFileSync(flat,source);
        const aligned=materialize(path.join(root,'aligned'+i),source,false),moved=materialize(path.join(root,'moved'+i),source,true);
        for(const target of ['mysql','postgres']){
            const a=compileFile(flat,{target}),b=compileFile(aligned,{target}),c=compileFile(moved,{target});
            assert.deepEqual(a.ir,b.ir);assert.deepEqual(a.optimizedIR,b.optimizedIR);assert.deepEqual(a.plan,b.plan);assert.deepEqual(a.generatedFiles,b.generatedFiles);c1++;files+=a.generatedFiles.length;
            assertModuleGenerationEquivalent(a,c,target);c2++;
            for(const result of [a,c])for(const file of result.generatedFiles.filter(f=>f.path.startsWith('models/'))){
                modelReconstructions++;
                rejectArtifact(a,c,target,result,file,'executable SQL',content=>replacePresent(content,'SELECT * FROM','SELECT BROKEN FROM'));
                rejectArtifact(a,c,target,result,file,'datatype metadata',content=>replacePresent(content,'"dataType":','"changedType":'));
            }
            for(const result of [a,c]){
                const context=Codegen.prepareAdmittedGeneration(result.optimizedIR,{target}).context;
                if(context.byName.has('Scalar')){
                    changeFields(a,c,target,result,'Scalar','default metadata/value',fields=>{const f=field(fields,'v');assert.deepEqual(f.defaultValue,{type:'NUMBER',value:0});f.defaultValue.value=1;});
                    changeFields(a,c,target,result,'Scalar','constraint metadata',fields=>{const f=field(fields,'k');assert.deepEqual(f.constraints,['PRIMARY_KEY']);f.constraints=['UNIQUE'];});
                    changeFields(a,c,target,result,'Scalar','numeric validation metadata',fields=>{const f=field(fields,'v'),bound=f.validations.find(v=>v.type==='MAX');assert(bound);assert.equal(bound.value,2);bound.value=3;});
                    changeFields(a,c,target,result,'Scalar','ENUM metadata/order',fields=>{const f=field(fields,'e');assert.deepEqual(f.enumValues,['draft','active']);f.enumValues.reverse();});
                    const entity=context.byName.get('Scalar'),model=result.generatedFiles.find(f=>f.path===entity.names.modelPath),controller=result.generatedFiles.find(f=>f.path===entity.names.controllerPath);
                    const generation=target==='mysql'?'"generation": "runtime_uuid"':'"generation":"runtime_uuid"';
                    rejectArtifact(a,c,target,result,model,'identity metadata',content=>replacePresent(content,generation,generation.replace('runtime_uuid','none')));
                    rejectArtifact(a,c,target,result,model,'runtime identity logic',content=>replacePresent(content,'crypto.randomUUID()',"'00000000-0000-0000-0000-000000000000'"));
                    rejectArtifact(a,c,target,result,controller,'write/runtime validator logic',content=>replacePresent(content,'Number.isSafeInteger(value)','Number.isInteger(value)'));
                    rejectArtifact(a,c,target,result,controller,'numeric validation metadata',content=>changeWriteFields(content,fields=>{const bound=field(fields,'v').validations.find(v=>v.type==='MAX');assert(bound);assert.equal(bound.value,2);bound.value=3;}));
                }
                if(context.byName.has('Item')){
                    changeFields(a,c,target,result,'Item','string validation metadata',fields=>{const f=field(fields,'line'),bound=f.validations.find(v=>v.type==='MAX_LENGTH');assert(bound);assert.equal(bound.value,300);bound.value=301;});
                    const controller=result.generatedFiles.find(f=>f.path===context.byName.get('Item').names.controllerPath);
                    rejectArtifact(a,c,target,result,controller,'string validation metadata',content=>changeWriteFields(content,fields=>{const bound=field(fields,'line').validations.find(v=>v.type==='MAX_LENGTH');assert(bound);assert.equal(bound.value,300);bound.value=301;}));
                }
                for(const relation of context.plan.relations){
                    const entity=context.byId.get(relation.sourceEntityId),model=result.generatedFiles.find(f=>f.path===entity.names.modelPath);
                    rejectArtifact(a,c,target,result,model,'relationship helper logic',content=>{
                        const signature='static async '+relation.names.getter+'(',start=content.indexOf(signature);assert(start>=0,'missing relationship method');
                        assert.equal(content.indexOf(signature,start+1),-1,'ambiguous relationship method');
                        const opening=content.indexOf('{',start);assert(opening>start);assert(content.slice(start,opening).includes(')'));
                        return content.slice(0,opening+1)+"throw new Error('canary relationship helper');"+content.slice(opening+1);
                    });
                }
            }
        }
        const canonical=M.compileSourceForSnapshot(source);
        for(const entry of [aligned,moved]){
            const plan=compileFile(entry,{admitOnly:true}).plan,next=M.buildMysqlSnapshot(plan);
            assert.equal(M.canonical(canonical),M.canonical(next));assert.equal(M.snapshotSha256(canonical),M.snapshotSha256(next));assert.equal(M.physicalSha256(canonical),M.physicalSha256(next));
        }
    }
    // Reordering is an observable change and must fail the equivalence helper.
    const first=path.join(root,'order1.apiforge'),second=path.join(root,'order2.apiforge');
    fs.writeFileSync(first,'ENTITY A v STRING ENTITY B v STRING');fs.writeFileSync(second,'ENTITY B v STRING ENTITY A v STRING');
    for(const target of ['mysql','postgres']){
        const a=compileFile(first,{target}),b=compileFile(second,{target});
        assert.notDeepEqual(a.plan.entities.map(e=>e.sourceName),b.plan.entities.map(e=>e.sourceName));
        assert.throws(()=>assertModuleGenerationEquivalent(a,b,target));counted('declaration ordering',target);
    }
    assert.deepEqual(canaryCategories,{
        'executable SQL':{mysql:32,postgres:32},'datatype metadata':{mysql:32,postgres:32},
        'string validation metadata':{mysql:4,postgres:4},'default metadata/value':{mysql:2,postgres:2},
        'constraint metadata':{mysql:2,postgres:2},'numeric validation metadata':{mysql:4,postgres:4},
        'ENUM metadata/order':{mysql:2,postgres:2},'identity metadata':{mysql:2,postgres:2},
        'runtime identity logic':{mysql:2,postgres:2},'write/runtime validator logic':{mysql:2,postgres:2},
        'relationship helper logic':{mysql:8,postgres:8},'declaration ordering':{mysql:1,postgres:1}
    });
    assert.equal(canaries,186);
    console.log(JSON.stringify({gates:['C1','C2'],fixtures:fixtures.length,targets:2,c1,c2,orderedFiles:files,modelReconstructions,negativeCanaries:canaries,canaryCategories,result:'PASS'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
