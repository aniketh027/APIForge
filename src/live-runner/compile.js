'use strict';
const Lexer = require('../lexer/lexer');
const Parser = require('../parser/parser');
const SemanticAnalyzer = require('../semantic/analyzer');
const IRGenerator = require('../ir/generator');
const Optimizer = require('../optimizer/optimizer');
const CodeGenerator = require('../codegen/codegen');
const { resolveTarget } = require('../targets');
const { fail } = require('./errors');
function compile(source, target) {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 256 * 1024
        || !['mysql', 'postgres'].includes(target)) fail('LIVE_REQUEST_INVALID');
    try {
        const options = { target: resolveTarget({ target }) };
        const parsed = Parser.parseModule(Lexer.tokenize(source));
        if (parsed.imports.length) fail('LIVE_COMPILE_FAILED');
        const semantic = SemanticAnalyzer.analyze(parsed.ast, options);
        if (!semantic.valid) fail('LIVE_COMPILE_FAILED');
        const optimized = Optimizer.optimize(IRGenerator.generate(parsed.ast, semantic));
        return CodeGenerator.generate(optimized.ir, false, options).files;
    } catch { fail('LIVE_COMPILE_FAILED'); }
}
module.exports = { compile };
