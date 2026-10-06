'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {compileFile}=require('../src/compiler');const M=require('../src/migrations');
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
                const altered=result.generatedFiles.map(f=>f===file?{...f,content:f.content.replace('SELECT * FROM','SELECT BROKEN FROM')}:f);
                assert.notEqual(altered.find(f=>f.path===file.path).content,file.content);
                assert.throws(()=>assertModuleGenerationEquivalent(a,c,target,result===a?altered:a.generatedFiles,result===c?altered:c.generatedFiles));canaries++;
                const metadata=result.generatedFiles.map(f=>f===file?{...f,content:f.content.replace('"dataType":','"changedType":')}:f);
                assert.throws(()=>assertModuleGenerationEquivalent(a,c,target,result===a?metadata:a.generatedFiles,result===c?metadata:c.generatedFiles));canaries++;
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
    assert.throws(()=>assertModuleGenerationEquivalent(compileFile(first),compileFile(second),'mysql'));canaries++;
    console.log(JSON.stringify({gates:['C1','C2'],fixtures:fixtures.length,targets:2,c1,c2,orderedFiles:files,modelReconstructions,negativeCanaries:canaries,result:'PASS'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
