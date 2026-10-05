'use strict';
const Lexer=require('../lexer/lexer'), Parser=require('../parser/parser'), Semantic=require('../semantic/analyzer');
const IR=require('../ir/generator'), Optimizer=require('../optimizer/optimizer'), Codegen=require('../codegen/codegen');
const {buildMysqlSnapshot}=require('./mysql-snapshot');
const {fail}=require('./errors');
function compileSourceForSnapshot(source,profile='mysql-8.4-v1') {
    if(profile!=='mysql-8.4-v1')fail('MIGRATION_PROFILE_UNSUPPORTED','Only mysql-8.4-v1 is supported.');
    const ast=Parser.parse(Lexer.tokenize(source)),semantic=Semantic.analyze(ast,{target:'mysql'});
    if(!semantic.valid){const error=new Error(semantic.errors.map(e=>e.message||e).join('\n'));error.diagnostics=semantic.diagnostics;throw error;}
    const optimized=Optimizer.optimize(IR.generate(ast,semantic)).ir;
    return buildMysqlSnapshot(Codegen.prepareAdmittedGeneration(optimized,{target:'mysql'}).candidate.plan);
}
module.exports={compileSourceForSnapshot};
