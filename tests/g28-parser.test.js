'use strict';
const assert = require('assert/strict');
const Lexer = require('../src/lexer/lexer'), Parser = require('../src/parser/parser');
const p = require('../src/modules/provenance');
let checks = 0;
for (const source of ['ENTITY IMPORT id INT PRIMARY KEY', 'ENTITY Item IMPORT STRING',
    'ENTITY Item v STRING DEFAULT "IMPORT"', 'ENTITY Item v ENUM("IMPORT","x")']) {
    const tokens = Lexer.tokenize(source);
    assert.deepEqual(Parser.parseModule(tokens), { ast: Parser.parse(tokens), imports: [] }); checks++;
}
const source = '\uFEFF// preamble\nIMPORT "./a.apiforge" IMPORT "../b.apiforge"\nENTITY Item id INT';
const tokens = Lexer.tokenize(source);
assert.equal(tokens[0].type, 'IDENTIFIER'); assert.equal(tokens[0].value, 'IMPORT');
const parsed = Parser.parseModule(tokens);
assert.deepEqual(parsed.imports.map(i => i.path), ['./a.apiforge', '../b.apiforge']);
assert.deepEqual(Object.keys(parsed.ast), ['type','entities','relations']);
assert.equal(parsed.imports[0].location.column, 8); checks += 4;
assert.throws(() => Parser.parse(tokens), e => e.diagnostic.code === 'PAR007'); checks++;
for (const source of ['ENTITY Item id INT IMPORT "x.apiforge"',
    'RELATION A LINKS B MANY_TO_MANY IMPORT "x.apiforge"', 'ENTITY Item IMPORT "x.apiforge"']) {
    assert.throws(() => Parser.parseModule(Lexer.tokenize(source)), e =>
        e.diagnostic.code === 'PAR023' && e.recognizedImport && e.diagnostic.symbol === 'IMPORT_AFTER_DECLARATION'); checks++;
}
for (const source of ['IMPORT', 'IMPORT STRING', 'IMPORT "x.apiforge" ENTITY Bad v']) {
    assert.throws(() => Parser.parseModule(Lexer.tokenize(source)), e => e.diagnostic.phase === 'parser'); checks++;
}
const sourceModule = { displayPath: 'm.apiforge' };
const ast = Parser.parse(Lexer.tokenize('ENTITY Item v INT DEFAULT 1'));
const before = JSON.stringify(ast); p.bindTree(ast,sourceModule);
assert.equal(JSON.stringify(ast),before); assert.equal(p.owner(ast.entities[0].fields[0].defaultValue.numberLocation),sourceModule);
assert.equal(ast.entities[0].fields[0].defaultValue.rawNumber,'1'); checks += 3;
console.log(JSON.stringify({gate:'B/parser',checks,result:'PASS'}));
