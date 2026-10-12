'use strict';
// The published phases and target generators, with the saved-store source bound.
const Lexer = require('../lexer/lexer');
const Parser = require('../parser/parser');
const Semantic = require('../semantic/analyzer');
const IR = require('../ir/generator');
const Optimizer = require('../optimizer/optimizer');
const Codegen = require('../codegen/codegen');
const { resolveTarget } = require('../targets');
const { fail } = require('./errors');
function compile(source, target) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 1048576 || !['mysql', 'postgres'].includes(target)) fail('PERSISTENT_COMPILE_FAILED');
    try {
        const options = { target: resolveTarget({ target }) }, parsed = Parser.parseModule(Lexer.tokenize(source));
        if (parsed.imports.length) fail('PERSISTENT_COMPILE_FAILED');
        const semantic = Semantic.analyze(parsed.ast, options);
        if (!semantic.valid) fail('PERSISTENT_COMPILE_FAILED');
        const optimized = Optimizer.optimize(IR.generate(parsed.ast, semantic));
        return Codegen.generate(optimized.ir, false, options).files;
    } catch { fail('PERSISTENT_COMPILE_FAILED'); }
}
module.exports = { compile };
