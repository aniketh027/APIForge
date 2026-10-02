const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const BASE = 'a0168682254550dc99fa8782f14f2827402852b9';
function baselineModule(relative) {
    const filename = path.resolve(__dirname, '..', relative);
    const source = execFileSync('git', ['show', BASE + ':' + relative], { encoding: 'utf8', windowsHide: true, maxBuffer: 2e6 });
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module', 'exports', '__dirname'])(createRequire(filename), module, module.exports, path.dirname(filename));
    return module.exports;
}
function analyze(source, analyzer = require('../src/semantic/analyzer')) {
    const tokens = require('../src/lexer/lexer').tokenize(source);
    const ast = require('../src/parser/parser').parse(tokens);
    return { tokens, ast, semantic: analyzer.analyze(ast) };
}
function compile(source, generator = require('../src/codegen/codegen')) {
    const result = analyze(source);
    assert.equal(result.semantic.valid, true, JSON.stringify(result.semantic.errors));
    result.ir = require('../src/ir/generator').generate(result.ast, result.semantic);
    result.optimized = require('../src/optimizer/optimizer').optimize(result.ir).ir;
    result.files = generator.generate(result.optimized, false).files;
    return result;
}
function syntax(files) { for (const file of files.filter(f => f.path.endsWith('.js'))) new vm.Script(file.content, { filename: file.path }); }
const content = (files, name) => files.find(f => f.path === name).content;
function retainedCodes(current, original) {
    return Object.fromEntries(Object.entries(original).map(([phase, codes]) => [phase,
        Object.fromEntries(Object.keys(codes).map(symbol => [symbol, current[phase][symbol]]))]));
}
module.exports = { BASE, baselineModule, analyze, compile, syntax, content, retainedCodes };
