/**
 * ============================================================
 * TEST RUNNER - APIForge Compiler Tests
 * ============================================================
 * 
 * This file contains tests for each phase of the compiler.
 * We use a simple custom test runner (no external libraries)
 * to keep things lightweight and educational.
 * 
 * Tests are organized by compiler phase:
 *   1. Lexer tests      (59 tests)
 *   2. Parser tests     (new)
 *   3. Semantic analyzer tests (placeholder)
 *   4. IR generator tests (placeholder)
 *   5. Optimizer tests
 *   6. Code generator tests (placeholder)
 * 
 * Run with:  npm test  (or  node tests/test.js)
 * 
 * ============================================================
 */

// ── Simple Test Helper ──────────────────────────────────────

let passed = 0;
let failed = 0;
let lexerPassed = 0;
let lexerFailed = 0;
let parserPassed = 0;
let parserFailed = 0;
let semanticPassed = 0;
let semanticFailed = 0;
let irPassed = 0;
let irFailed = 0;
let optimizerPassed = 0;
let optimizerFailed = 0;
let codegenPassed = 0;
let codegenFailed = 0;
let otherPassed = 0;
let otherFailed = 0;

// Current phase being tested (for per-phase tallying)
let currentPhase = 'other';

/**
 * A minimal assertion function.
 * Compares actual vs expected using deep equality (JSON).
 */
function assertEqual(testName, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
        tallyPhase(true);
    } else {
        console.log(`  ✗ FAIL: ${testName}`);
        console.log(`    Expected: ${JSON.stringify(expected)}`);
        console.log(`    Actual:   ${JSON.stringify(actual)}`);
        failed++;
        tallyPhase(false);
    }
}

function assertTrue(testName, condition) {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
        tallyPhase(true);
    } else {
        console.log(`  ✗ FAIL: ${testName}`);
        failed++;
        tallyPhase(false);
    }
}

/**
 * Asserts that calling `fn` throws an error whose message
 * contains the substring `expectedMsg`.
 */
function assertThrows(testName, fn, expectedMsg) {
    try {
        fn();
        console.log(`  ✗ FAIL: ${testName} (no error thrown)`);
        failed++;
        tallyPhase(false);
    } catch (err) {
        if (err.message.includes(expectedMsg)) {
            console.log(`  ✓ PASS: ${testName}`);
            passed++;
            tallyPhase(true);
        } else {
            console.log(`  ✗ FAIL: ${testName}`);
            console.log(`    Expected error containing: "${expectedMsg}"`);
            console.log(`    Actual error:              "${err.message}"`);
            failed++;
            tallyPhase(false);
        }
    }
}

/** Tallies pass/fail to the current phase counters. */
function tallyPhase(pass) {
    if (currentPhase === 'lexer') {
        pass ? lexerPassed++ : lexerFailed++;
    } else if (currentPhase === 'parser') {
        pass ? parserPassed++ : parserFailed++;
    } else if (currentPhase === 'semantic') {
        pass ? semanticPassed++ : semanticFailed++;
    } else if (currentPhase === 'ir') {
        pass ? irPassed++ : irFailed++;
    } else if (currentPhase === 'optimizer') {
        pass ? optimizerPassed++ : optimizerFailed++;
    } else if (currentPhase === 'codegen') {
        pass ? codegenPassed++ : codegenFailed++;
    } else {
        pass ? otherPassed++ : otherFailed++;
    }
}

/**
 * Helper: Lex + Parse a DSL string in one step.
 * Convenient for parser tests so we don't repeat the two calls.
 */
function lexAndParse(source) {
    const tokens = Lexer.tokenize(source);
    return Parser.parse(tokens);
}

// ── Import Compiler Modules ─────────────────────────────────

const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const SemanticAnalyzer = require('../src/semantic/analyzer');
const IRGenerator = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const CodeGenerator = require('../src/codegen/codegen');

// ─────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       APIForge Compiler - Test Suite          ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

// ═════════════════════════════════════════════════════════════
// MODULE LOADING TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'other';

console.log('── Module Loading Tests ──');
assertTrue('Lexer module loads',            typeof Lexer.tokenize === 'function');
assertTrue('Parser module loads',           typeof Parser.parse === 'function');
assertTrue('Semantic module loads',         typeof SemanticAnalyzer.analyze === 'function');
assertTrue('IR Generator module loads',     typeof IRGenerator.generate === 'function');
assertTrue('Optimizer module loads',        typeof Optimizer.optimize === 'function');
assertTrue('Code Generator module loads',   typeof CodeGenerator.generate === 'function');

// ═════════════════════════════════════════════════════════════
// PHASE 1: LEXER TESTS  (59 tests — all preserved from Phase 1)
// ═════════════════════════════════════════════════════════════

currentPhase = 'lexer';

// ── Test 1: Basic ENTITY declaration ────────────────────────

console.log('');
console.log('── Lexer Test 1: Basic ENTITY declaration ──');

const t1 = Lexer.tokenize('ENTITY Student');

assertTrue('Returns an array',                      Array.isArray(t1));
assertTrue('Produces 3 tokens (ENTITY + Student + EOF)', t1.length === 3);
assertEqual('First token is KEYWORD ENTITY',         t1[0].type, 'KEYWORD');
assertEqual('First token value is "ENTITY"',         t1[0].value, 'ENTITY');


// ── Test 2: Entity name tokenization ────────────────────────

console.log('');
console.log('── Lexer Test 2: Entity name tokenization ──');

assertEqual('Entity name type is IDENTIFIER',        t1[1].type, 'IDENTIFIER');
assertEqual('Entity name value is "Student"',        t1[1].value, 'Student');


// ── Test 3: Field name tokenization ─────────────────────────

console.log('');
console.log('── Lexer Test 3: Field name tokenization ──');

const t3 = Lexer.tokenize('name STRING REQUIRED');

assertEqual('Field name type is IDENTIFIER',         t3[0].type, 'IDENTIFIER');
assertEqual('Field name value is "name"',            t3[0].value, 'name');


// ── Test 4: Data type recognition ───────────────────────────

console.log('');
console.log('── Lexer Test 4: Data type recognition ──');

const t4_int = Lexer.tokenize('id INT');
assertEqual('INT is DATATYPE',     t4_int[1].type, 'DATATYPE');
assertEqual('INT value correct',   t4_int[1].value, 'INT');

const t4_str = Lexer.tokenize('name STRING');
assertEqual('STRING is DATATYPE',  t4_str[1].type, 'DATATYPE');
assertEqual('STRING value correct', t4_str[1].value, 'STRING');

const t4_flt = Lexer.tokenize('cgpa FLOAT');
assertEqual('FLOAT is DATATYPE',   t4_flt[1].type, 'DATATYPE');
assertEqual('FLOAT value correct', t4_flt[1].value, 'FLOAT');

const t4_bool = Lexer.tokenize('active BOOLEAN');
assertEqual('BOOLEAN is DATATYPE', t4_bool[1].type, 'DATATYPE');
assertEqual('BOOLEAN value correct', t4_bool[1].value, 'BOOLEAN');


// ── Test 5: PRIMARY KEY recognition ─────────────────────────

console.log('');
console.log('── Lexer Test 5: PRIMARY KEY recognition ──');

const t5 = Lexer.tokenize('id INT PRIMARY KEY');

assertEqual('PRIMARY is MODIFIER', t5[2].type, 'MODIFIER');
assertEqual('PRIMARY value',       t5[2].value, 'PRIMARY');
assertEqual('KEY is MODIFIER',     t5[3].type, 'MODIFIER');
assertEqual('KEY value',           t5[3].value, 'KEY');


// ── Test 6: REQUIRED recognition ────────────────────────────

console.log('');
console.log('── Lexer Test 6: REQUIRED recognition ──');

const t6 = Lexer.tokenize('name STRING REQUIRED');

assertEqual('REQUIRED is MODIFIER', t6[2].type, 'MODIFIER');
assertEqual('REQUIRED value',       t6[2].value, 'REQUIRED');


// ── Test 7: UNIQUE recognition ──────────────────────────────

console.log('');
console.log('── Lexer Test 7: UNIQUE recognition ──');

const t7 = Lexer.tokenize('email STRING UNIQUE');

assertEqual('UNIQUE is MODIFIER',  t7[2].type, 'MODIFIER');
assertEqual('UNIQUE value',        t7[2].value, 'UNIQUE');


// ── Test 8: Multiple fields ─────────────────────────────────

console.log('');
console.log('── Lexer Test 8: Multiple fields ──');

const multiInput = [
    'ENTITY Student',
    '    id INT PRIMARY KEY',
    '    name STRING REQUIRED',
    '    age INT',
].join('\n');

const t8 = Lexer.tokenize(multiInput);

assertTrue('Multi-field produces 12 tokens', t8.length === 12);

const expectedTypes = [
    'KEYWORD', 'IDENTIFIER', 'IDENTIFIER', 'DATATYPE',
    'MODIFIER', 'MODIFIER', 'IDENTIFIER', 'DATATYPE',
    'MODIFIER', 'IDENTIFIER', 'DATATYPE', 'EOF'
];

const actualTypes = t8.map(t => t.type);
assertEqual('Token type sequence matches', actualTypes, expectedTypes);


// ── Test 9: Line number tracking ────────────────────────────

console.log('');
console.log('── Lexer Test 9: Line number tracking ──');

const lineInput = 'ENTITY Student\nid INT\nname STRING';
const t9 = Lexer.tokenize(lineInput);

assertEqual('ENTITY is on line 1',    t9[0].line, 1);
assertEqual('Student is on line 1',   t9[1].line, 1);
assertEqual('id is on line 2',        t9[2].line, 2);
assertEqual('INT is on line 2',       t9[3].line, 2);
assertEqual('name is on line 3',      t9[4].line, 3);
assertEqual('STRING is on line 3',    t9[5].line, 3);

assertEqual('ENTITY starts at column 1',   t9[0].column, 1);
assertEqual('Student starts at column 8',  t9[1].column, 8);
assertEqual('id starts at column 1',       t9[2].column, 1);
assertEqual('INT starts at column 4',      t9[3].column, 4);


// ── Test 10: Invalid character error ────────────────────────

console.log('');
console.log('── Lexer Test 10: Invalid character error ──');

assertThrows(
    'Throws on @ character',
    () => Lexer.tokenize('ENTITY @Student'),
    'Unexpected character'
);

assertThrows(
    'Throws on # character',
    () => Lexer.tokenize('name # STRING'),
    'Unexpected character'
);

assertThrows(
    'Throws on $ character',
    () => Lexer.tokenize('$price FLOAT'),
    'Unexpected character'
);


// ── Test 11: Identifier beginning with a digit ──────────────

console.log('');
console.log('── Lexer Test 11: Digit-starting identifier ──');

assertThrows(
    'Throws on identifier starting with digit',
    () => Lexer.tokenize('ENTITY 3Student'),
    'cannot start with a digit'
);

assertThrows(
    'Throws on field starting with digit',
    () => Lexer.tokenize('123abc INT'),
    'cannot start with a digit'
);


// ── Test 12: EOF token ──────────────────────────────────────

console.log('');
console.log('── Lexer Test 12: EOF token ──');

const t12_empty = Lexer.tokenize('');
assertTrue('Empty input produces 1 token',      t12_empty.length === 1);
assertEqual('Empty input EOF type',              t12_empty[0].type, 'EOF');
assertEqual('Empty input EOF value',             t12_empty[0].value, 'EOF');

const t12_normal = Lexer.tokenize('ENTITY Student');
const lastToken = t12_normal[t12_normal.length - 1];
assertEqual('Last token is always EOF',          lastToken.type, 'EOF');


// ── Bonus: Comment handling ─────────────────────────────────

console.log('');
console.log('── Lexer Bonus: Comment handling ──');

const commentInput = '// This is a comment\nENTITY Student';
const tComment = Lexer.tokenize(commentInput);

assertEqual('Comment is skipped, first token is ENTITY', tComment[0].value, 'ENTITY');
assertEqual('After comment, ENTITY is on line 2',         tComment[0].line, 2);


// ── Bonus: Underscore in identifiers ────────────────────────

console.log('');
console.log('── Lexer Bonus: Underscore identifiers ──');

const underscoreInput = 'first_name STRING';
const tUnderscore = Lexer.tokenize(underscoreInput);

assertEqual('Underscore identifier recognized',  tUnderscore[0].type, 'IDENTIFIER');
assertEqual('Underscore identifier value',       tUnderscore[0].value, 'first_name');


// ── Lexer Test: RELATION and RELATION_TYPE tokens ───────────

console.log('');
console.log('── Lexer Test: RELATION and RELATION_TYPE tokens ──');

const relTokens = Lexer.tokenize('RELATION Student ENROLLS_IN Course MANY_TO_MANY');
assertEqual('RELATION token type', relTokens[0].type, 'KEYWORD');
assertEqual('RELATION token value', relTokens[0].value, 'RELATION');
assertEqual('Source entity token type', relTokens[1].type, 'IDENTIFIER');
assertEqual('Source entity token value', relTokens[1].value, 'Student');
assertEqual('Relation name token type', relTokens[2].type, 'IDENTIFIER');
assertEqual('Relation name token value', relTokens[2].value, 'ENROLLS_IN');
assertEqual('Target entity token type', relTokens[3].type, 'IDENTIFIER');
assertEqual('Target entity token value', relTokens[3].value, 'Course');
assertEqual('MANY_TO_MANY token type', relTokens[4].type, 'RELATION_TYPE');
assertEqual('MANY_TO_MANY token value', relTokens[4].value, 'MANY_TO_MANY');
assertEqual('EOF token at end', relTokens[5].type, 'EOF');

const allRelTypes = Lexer.tokenize('ONE_TO_ONE ONE_TO_MANY MANY_TO_ONE MANY_TO_MANY');
assertEqual('ONE_TO_ONE token type', allRelTypes[0].type, 'RELATION_TYPE');
assertEqual('ONE_TO_MANY token type', allRelTypes[1].type, 'RELATION_TYPE');
assertEqual('MANY_TO_ONE token type', allRelTypes[2].type, 'RELATION_TYPE');
assertEqual('MANY_TO_MANY token type', allRelTypes[3].type, 'RELATION_TYPE');


// ═════════════════════════════════════════════════════════════
// PHASE 2: PARSER TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'parser';

// ── Parser Test 1: One valid entity ─────────────────────────
// The simplest valid program: one entity with one field.

console.log('');
console.log('── Parser Test 1: One valid entity ──');

const p1 = lexAndParse('ENTITY Student\nid INT PRIMARY KEY');

assertEqual('AST root type is Program',       p1.type, 'Program');
assertTrue('One entity parsed',                p1.entities.length === 1);
assertEqual('Entity name is Student',          p1.entities[0].name, 'Student');
assertTrue('Entity has 1 field',               p1.entities[0].fields.length === 1);
assertEqual('Field name is id',                p1.entities[0].fields[0].name, 'id');
assertEqual('Field type is INT',               p1.entities[0].fields[0].dataType, 'INT');
assertEqual('Field constraint is PRIMARY_KEY', p1.entities[0].fields[0].constraints, ['PRIMARY_KEY']);


// ── Parser Test 2: Multiple entities ────────────────────────
// Two entities declared in the same file.

console.log('');
console.log('── Parser Test 2: Multiple entities ──');

const p2_input = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'ENTITY Course',
    'code INT PRIMARY KEY',
    'title STRING REQUIRED',
].join('\n');

const p2 = lexAndParse(p2_input);

assertTrue('Two entities parsed',        p2.entities.length === 2);
assertEqual('First entity is Student',   p2.entities[0].name, 'Student');
assertEqual('Second entity is Course',   p2.entities[1].name, 'Course');
assertTrue('Student has 2 fields',       p2.entities[0].fields.length === 2);
assertTrue('Course has 2 fields',        p2.entities[1].fields.length === 2);


// ── Parser Test 3: Field with no modifier ───────────────────
// A field with just a name and data type, no constraints.

console.log('');
console.log('── Parser Test 3: Field with no modifier ──');

const p3 = lexAndParse('ENTITY Student\nage INT');

assertEqual('Field has empty constraints', p3.entities[0].fields[0].constraints, []);
assertEqual('Field name is age',           p3.entities[0].fields[0].name, 'age');
assertEqual('Field type is INT',           p3.entities[0].fields[0].dataType, 'INT');


// ── Parser Test 4: Field with REQUIRED ──────────────────────

console.log('');
console.log('── Parser Test 4: Field with REQUIRED ──');

const p4 = lexAndParse('ENTITY Student\nname STRING REQUIRED');

assertEqual('Constraint is REQUIRED',      p4.entities[0].fields[0].constraints, ['REQUIRED']);


// ── Parser Test 5: Field with UNIQUE ────────────────────────

console.log('');
console.log('── Parser Test 5: Field with UNIQUE ──');

const p5 = lexAndParse('ENTITY Student\nemail STRING UNIQUE');

assertEqual('Constraint is UNIQUE',        p5.entities[0].fields[0].constraints, ['UNIQUE']);


// ── Parser Test 6: Field with PRIMARY KEY ───────────────────
// PRIMARY and KEY must be combined into PRIMARY_KEY.

console.log('');
console.log('── Parser Test 6: Field with PRIMARY KEY ──');

const p6 = lexAndParse('ENTITY Student\nid INT PRIMARY KEY');

assertEqual('Constraint is PRIMARY_KEY',   p6.entities[0].fields[0].constraints, ['PRIMARY_KEY']);


// ── Parser Test 7: Multiple fields ──────────────────────────
// Full Student entity with 5 fields.

console.log('');
console.log('── Parser Test 7: Multiple fields ──');

const p7_input = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'email STRING UNIQUE',
    'age INT',
    'cgpa FLOAT',
].join('\n');

const p7 = lexAndParse(p7_input);

assertTrue('Student has 5 fields',                   p7.entities[0].fields.length === 5);
assertEqual('Field 1: id INT [PRIMARY_KEY]',         p7.entities[0].fields[0].name, 'id');
assertEqual('Field 2: name STRING [REQUIRED]',       p7.entities[0].fields[1].constraints, ['REQUIRED']);
assertEqual('Field 3: email STRING [UNIQUE]',        p7.entities[0].fields[2].constraints, ['UNIQUE']);
assertEqual('Field 4: age INT []',                   p7.entities[0].fields[3].constraints, []);
assertEqual('Field 5: cgpa type is FLOAT',           p7.entities[0].fields[4].dataType, 'FLOAT');


// ── Parser Test 8: Empty program ────────────────────────────
// An empty source file (just EOF) is valid — zero entities.

console.log('');
console.log('── Parser Test 8: Empty program ──');

const p8 = lexAndParse('');

assertEqual('Empty program type',          p8.type, 'Program');
assertTrue('Empty program has 0 entities', p8.entities.length === 0);


// ── Parser Test 9: Missing entity name ──────────────────────
// "ENTITY" without a name should throw a syntax error.

console.log('');
console.log('── Parser Test 9: Missing entity name ──');

assertThrows(
    'Throws on ENTITY without name (followed by datatype)',
    () => lexAndParse('ENTITY INT'),
    'Expected IDENTIFIER'
);

assertThrows(
    'Throws on ENTITY at end of file',
    () => lexAndParse('ENTITY'),
    'Expected IDENTIFIER'
);


// ── Parser Test 10: Missing field datatype ──────────────────
// A field name without a data type should error.

console.log('');
console.log('── Parser Test 10: Missing field datatype ──');

assertThrows(
    'Throws when field has no datatype (next field follows)',
    () => lexAndParse('ENTITY Student\nname\nemail STRING'),
    'Expected DATATYPE'
);

assertThrows(
    'Throws when field has modifier instead of datatype',
    () => lexAndParse('ENTITY Student\nname REQUIRED'),
    'Expected DATATYPE'
);


// ── Parser Test 11: PRIMARY without KEY ─────────────────────
// PRIMARY must be followed by KEY.

console.log('');
console.log('── Parser Test 11: PRIMARY without KEY ──');

assertThrows(
    'Throws on PRIMARY without KEY',
    () => lexAndParse('ENTITY Student\nid INT PRIMARY'),
    'Expected "KEY" after "PRIMARY"'
);

assertThrows(
    'Throws on PRIMARY followed by REQUIRED',
    () => lexAndParse('ENTITY Student\nid INT PRIMARY REQUIRED'),
    'Expected "KEY" after "PRIMARY"'
);


// ── Parser Test 12: KEY without PRIMARY ─────────────────────
// Standalone KEY should throw.

console.log('');
console.log('── Parser Test 12: KEY without PRIMARY ──');

assertThrows(
    'Throws on standalone KEY',
    () => lexAndParse('ENTITY Student\nid INT KEY'),
    '"KEY" must be preceded by "PRIMARY"'
);


// ── Parser Test 13: Invalid datatype ────────────────────────
// A word that isn't a known data type should error.
// The lexer classifies unknown words as IDENTIFIER, so the
// parser sees IDENTIFIER where it expects DATATYPE.

console.log('');
console.log('── Parser Test 13: Invalid datatype ──');

assertThrows(
    'Throws on unknown type VARCHAR',
    () => lexAndParse('ENTITY Student\nname VARCHAR'),
    'Expected DATATYPE'
);

assertThrows(
    'Throws on unknown type CHAR',
    () => lexAndParse('ENTITY Student\nname CHAR'),
    'Expected DATATYPE'
);


// ── Parser Test 14: Unexpected token ────────────────────────
// Tokens that don't fit the grammar at the top level.

console.log('');
console.log('── Parser Test 14: Unexpected token ──');

assertThrows(
    'Throws on bare identifier at top level',
    () => lexAndParse('Student'),
    'Expected ENTITY declaration'
);

assertThrows(
    'Throws on DATATYPE at top level',
    () => lexAndParse('INT'),
    'Expected ENTITY declaration'
);

assertThrows(
    'Throws on MODIFIER token where field name expected',
    () => lexAndParse('ENTITY Student\nREQUIRED'),
    'Expected field name'
);


// ── Parser Test 15: AST structure validation ────────────────
// Deep validation of the entire AST for the Student entity.

console.log('');
console.log('── Parser Test 15: AST structure validation ──');

const p15_input = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'email STRING UNIQUE',
    'age INT',
    'cgpa FLOAT',
].join('\n');

const p15 = lexAndParse(p15_input);

// Root node checks
assertEqual('Root type',                 p15.type, 'Program');
assertTrue('Has entities array',         Array.isArray(p15.entities));
assertTrue('Exactly 1 entity',          p15.entities.length === 1);

// Entity node checks
const studentEntity = p15.entities[0];
assertEqual('Entity type prop',          studentEntity.type, 'Entity');
assertEqual('Entity name',              studentEntity.name, 'Student');
assertTrue('Has fields array',          Array.isArray(studentEntity.fields));
assertTrue('Exactly 5 fields',          studentEntity.fields.length === 5);

// Field node checks — verify the complete structure
const expectedFields = [
    { name: 'id',    dataType: 'INT',    constraints: ['PRIMARY_KEY'] },
    { name: 'name',  dataType: 'STRING', constraints: ['REQUIRED'] },
    { name: 'email', dataType: 'STRING', constraints: ['UNIQUE'] },
    { name: 'age',   dataType: 'INT',    constraints: [] },
    { name: 'cgpa',  dataType: 'FLOAT',  constraints: [] },
];

expectedFields.forEach((expected, i) => {
    const actual = studentEntity.fields[i];
    assertEqual(`Field[${i}] name`,        actual.name, expected.name);
    assertEqual(`Field[${i}] dataType`,    actual.dataType, expected.dataType);
    assertEqual(`Field[${i}] constraints`, actual.constraints, expected.constraints);
    assertEqual(`Field[${i}] type prop`,   actual.type, 'Field');
});


// ── Parser Test 15: Valid ONE_TO_ONE ────────────────────────

console.log('');
console.log('── Parser Test 15: Valid ONE_TO_ONE ──');

const rel_p1 = lexAndParse('RELATION User HAS_PROFILE Profile ONE_TO_ONE');
assertEqual('ONE_TO_ONE relations length', rel_p1.relations.length, 1);
assertEqual('ONE_TO_ONE sourceEntity', rel_p1.relations[0].sourceEntity, 'User');
assertEqual('ONE_TO_ONE name', rel_p1.relations[0].name, 'HAS_PROFILE');
assertEqual('ONE_TO_ONE targetEntity', rel_p1.relations[0].targetEntity, 'Profile');
assertEqual('ONE_TO_ONE relationType', rel_p1.relations[0].relationType, 'ONE_TO_ONE');


// ── Parser Test 16: Valid ONE_TO_MANY ───────────────────────

console.log('');
console.log('── Parser Test 16: Valid ONE_TO_MANY ──');

const rel_p2 = lexAndParse('RELATION Department HAS_EMPLOYEES Employee ONE_TO_MANY');
assertEqual('ONE_TO_MANY relationType', rel_p2.relations[0].relationType, 'ONE_TO_MANY');
assertEqual('ONE_TO_MANY sourceEntity', rel_p2.relations[0].sourceEntity, 'Department');
assertEqual('ONE_TO_MANY targetEntity', rel_p2.relations[0].targetEntity, 'Employee');


// ── Parser Test 17: Valid MANY_TO_ONE ───────────────────────

console.log('');
console.log('── Parser Test 17: Valid MANY_TO_ONE ──');

const rel_p3 = lexAndParse('RELATION Employee BELONGS_TO Department MANY_TO_ONE');
assertEqual('MANY_TO_ONE relationType', rel_p3.relations[0].relationType, 'MANY_TO_ONE');
assertEqual('MANY_TO_ONE name', rel_p3.relations[0].name, 'BELONGS_TO');


// ── Parser Test 18: Valid MANY_TO_MANY ──────────────────────

console.log('');
console.log('── Parser Test 18: Valid MANY_TO_MANY ──');

const rel_p4 = lexAndParse('RELATION Student ENROLLS_IN Course MANY_TO_MANY');
assertEqual('MANY_TO_MANY relationType', rel_p4.relations[0].relationType, 'MANY_TO_MANY');
assertEqual('MANY_TO_MANY sourceEntity', rel_p4.relations[0].sourceEntity, 'Student');
assertEqual('MANY_TO_MANY targetEntity', rel_p4.relations[0].targetEntity, 'Course');


// ── Parser Test 19: Relationship name as identifier ─────────

console.log('');
console.log('── Parser Test 19: Relationship name as identifier ──');

const rel_p5 = lexAndParse('RELATION Author writes_book Book ONE_TO_MANY');
assertEqual('Relationship lowercase name', rel_p5.relations[0].name, 'writes_book');


// ── Parser Test 20: Source & Target entity parsed correctly ─

console.log('');
console.log('── Parser Test 20: Source & Target entities ──');

const rel_p6 = lexAndParse('RELATION Customer PLACES Order ONE_TO_MANY');
assertEqual('Source is Customer', rel_p6.relations[0].sourceEntity, 'Customer');
assertEqual('Target is Order', rel_p6.relations[0].targetEntity, 'Order');


// ── Parser Test 21: Relation line number tracked ────────────

console.log('');
console.log('── Parser Test 21: Relation line number ──');

const rel_p7 = lexAndParse('\n\nRELATION Doctor TREATS Patient MANY_TO_MANY');
assertEqual('Relation line is 3', rel_p7.relations[0].line, 3);
assertEqual('Relation node type is Relation', rel_p7.relations[0].type, 'Relation');


// ── Parser Test 22: Multiple relationships ──────────────────

console.log('');
console.log('── Parser Test 22: Multiple relationships ──');

const rel_p8_src = [
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY',
    'RELATION Teacher TEACHES Course ONE_TO_MANY',
    'RELATION Student HAS_ADVISOR Teacher MANY_TO_ONE'
].join('\n');
const rel_p8 = lexAndParse(rel_p8_src);
assertEqual('Multiple relations count', rel_p8.relations.length, 3);
assertEqual('First rel name', rel_p8.relations[0].name, 'ENROLLS_IN');
assertEqual('Second rel name', rel_p8.relations[1].name, 'TEACHES');
assertEqual('Third rel name', rel_p8.relations[2].name, 'HAS_ADVISOR');


// ── Parser Test 23: Entity + Relationship in same program ───

console.log('');
console.log('── Parser Test 23: Entity + Relationship in same program ──');

const rel_p9_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    'title STRING REQUIRED',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const rel_p9 = lexAndParse(rel_p9_src);
assertEqual('Entities count is 2', rel_p9.entities.length, 2);
assertEqual('Relations count is 1', rel_p9.relations.length, 1);
assertEqual('First entity is Student', rel_p9.entities[0].name, 'Student');
assertEqual('Second entity is Course', rel_p9.entities[1].name, 'Course');
assertEqual('Relation source is Student', rel_p9.relations[0].sourceEntity, 'Student');
assertEqual('Relation target is Course', rel_p9.relations[0].targetEntity, 'Course');
assertEqual('Relation type is MANY_TO_MANY', rel_p9.relations[0].relationType, 'MANY_TO_MANY');


// ── Parser Test 24: Missing source entity ────────────────────

console.log('');
console.log('── Parser Test 24: Missing source entity ──');

assertThrows(
    'Throws on RELATION without source entity',
    () => lexAndParse('RELATION'),
    'Expected IDENTIFIER'
);


// ── Parser Test 25: Missing relationship name ────────────────

console.log('');
console.log('── Parser Test 25: Missing relationship name ──');

assertThrows(
    'Throws on RELATION without relation name',
    () => lexAndParse('RELATION Student'),
    'Expected IDENTIFIER'
);


// ── Parser Test 26: Missing target entity ────────────────────

console.log('');
console.log('── Parser Test 26: Missing target entity ──');

assertThrows(
    'Throws on RELATION without target entity',
    () => lexAndParse('RELATION Student ENROLLS_IN'),
    'Expected IDENTIFIER'
);

assertThrows(
    'Throws when RELATION_TYPE appears instead of target entity',
    () => lexAndParse('RELATION Student Course MANY_TO_MANY'),
    'Expected IDENTIFIER'
);


// ── Parser Test 27: Missing relationship type ────────────────

console.log('');
console.log('── Parser Test 27: Missing relationship type ──');

assertThrows(
    'Throws on RELATION without relationship type',
    () => lexAndParse('RELATION Student ENROLLS_IN Course'),
    'Expected RELATION_TYPE'
);


// ── Parser Test 28: Invalid relationship type ────────────────

console.log('');
console.log('── Parser Test 28: Invalid relationship type ──');

assertThrows(
    'Throws on invalid relationship type INVALID',
    () => lexAndParse('RELATION Student ENROLLS_IN Course INVALID'),
    'Expected RELATION_TYPE'
);


// ═════════════════════════════════════════════════════════════
// PHASE 3: SEMANTIC ANALYZER TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'semantic';

/**
 * Helper: Lex + Parse + Analyze a DSL string in one step.
 * Returns the semantic result { valid, errors, symbolTable }.
 */
function lexParseAnalyze(source) {
    const tokens = Lexer.tokenize(source);
    const ast = Parser.parse(tokens);
    return SemanticAnalyzer.analyze(ast);
}

// ── Semantic Test 1: Valid Student entity ────────────────────

console.log('');
console.log('── Semantic Test 1: Valid Student entity ──');

const s1 = lexParseAnalyze([
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'email STRING UNIQUE',
    'age INT',
    'cgpa FLOAT',
].join('\n'));

assertTrue('Valid Student passes',       s1.valid);
assertTrue('No errors',                  s1.errors.length === 0);
assertTrue('Symbol table has Student',   'Student' in s1.symbolTable);
assertTrue('Student has 5 fields',       Object.keys(s1.symbolTable['Student'].fields).length === 5);


// ── Semantic Test 2: Multiple valid entities ────────────────

console.log('');
console.log('── Semantic Test 2: Multiple valid entities ──');

const s2 = lexParseAnalyze([
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'ENTITY Course',
    'code INT PRIMARY KEY',
    'title STRING REQUIRED',
].join('\n'));

assertTrue('Multiple valid entities pass',  s2.valid);
assertTrue('Symbol table has Student',      'Student' in s2.symbolTable);
assertTrue('Symbol table has Course',       'Course' in s2.symbolTable);


// ── Semantic Test 3: Duplicate entity ───────────────────────

console.log('');
console.log('── Semantic Test 3: Duplicate entity ──');

const s3 = lexParseAnalyze([
    'ENTITY Student',
    'name STRING REQUIRED',
    '',
    'ENTITY Student',
    'id INT PRIMARY KEY',
].join('\n'));

assertTrue('Duplicate entity fails',               !s3.valid);
assertTrue('Has at least one error',                s3.errors.length >= 1);
assertTrue('Error mentions duplicate',              s3.errors.some(e => e.message.includes('Duplicate entity')));


// ── Semantic Test 4: Duplicate field ────────────────────────

console.log('');
console.log('── Semantic Test 4: Duplicate field ──');

const s4 = lexParseAnalyze([
    'ENTITY Student',
    'name STRING REQUIRED',
    'name INT',
].join('\n'));

assertTrue('Duplicate field fails',                 !s4.valid);
assertTrue('Error mentions duplicate field',        s4.errors.some(e => e.message.includes("Duplicate field 'name'")));


// ── Semantic Test 5: Empty entity ───────────────────────────

console.log('');
console.log('── Semantic Test 5: Empty entity ──');

// An entity with no fields — the parser allows it but the
// semantic analyzer should flag it.
// We create the AST directly since the parser needs at least
// an ENTITY + name to produce an EntityNode.
const { ProgramNode, EntityNode } = require('../src/ast/ast');

const emptyAST = new ProgramNode();
const emptyEntity = new EntityNode('EmptyThing', 1);
emptyAST.entities.push(emptyEntity);

const s5 = SemanticAnalyzer.analyze(emptyAST);

assertTrue('Empty entity fails',                    !s5.valid);
assertTrue('Error mentions at least one field',     s5.errors.some(e => e.message.includes('at least one field')));


// ── Semantic Test 6: Invalid datatype ───────────────────────
// The parser already blocks invalid types via token checking,
// but we test the semantic layer independently by constructing
// an AST with a bad type to prove defense in depth.

console.log('');
console.log('── Semantic Test 6: Invalid datatype ──');

const { FieldNode } = require('../src/ast/ast');

const badTypeAST = new ProgramNode();
const badTypeEntity = new EntityNode('Widget', 1);
badTypeEntity.fields.push(new FieldNode('label', 'VARCHAR', [], 2));
badTypeAST.entities.push(badTypeEntity);

const s6 = SemanticAnalyzer.analyze(badTypeAST);

assertTrue('Invalid datatype fails',               !s6.valid);
assertTrue('Error mentions invalid data type',     s6.errors.some(e => e.message.includes("Invalid data type 'VARCHAR'")));


// ── Semantic Test 7: One valid primary key ──────────────────

console.log('');
console.log('── Semantic Test 7: One valid primary key ──');

const s7 = lexParseAnalyze([
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
].join('\n'));

assertTrue('One PK passes', s7.valid);


// ── Semantic Test 8: Multiple primary keys ──────────────────

console.log('');
console.log('── Semantic Test 8: Multiple primary keys ──');

const s8 = lexParseAnalyze([
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'regNo STRING PRIMARY KEY',
].join('\n'));

assertTrue('Multiple PKs fails',                   !s8.valid);
assertTrue('Error mentions multiple primary keys',  s8.errors.some(e => e.message.includes('multiple primary keys')));


// ── Semantic Test 9: Primary key with INT ───────────────────

console.log('');
console.log('── Semantic Test 9: Primary key with INT ──');

const s9 = lexParseAnalyze('ENTITY Item\nid INT PRIMARY KEY');

assertTrue('INT PK passes', s9.valid);


// ── Semantic Test 10: Primary key with STRING ───────────────

console.log('');
console.log('── Semantic Test 10: Primary key with STRING ──');

const s10 = lexParseAnalyze('ENTITY Item\ncode STRING PRIMARY KEY');

assertTrue('STRING PK passes', s10.valid);


// ── Semantic Test 11: Primary key with FLOAT should fail ────

console.log('');
console.log('── Semantic Test 11: PK with FLOAT fails ──');

const s11 = lexParseAnalyze('ENTITY Item\nprice FLOAT PRIMARY KEY');

assertTrue('FLOAT PK fails',                       !s11.valid);
assertTrue('Error mentions INT or STRING',          s11.errors.some(e => e.message.includes('requires INT or STRING')));


// ── Semantic Test 12: Primary key with BOOLEAN should fail ──

console.log('');
console.log('── Semantic Test 12: PK with BOOLEAN fails ──');

const s12 = lexParseAnalyze('ENTITY Item\nactive BOOLEAN PRIMARY KEY');

assertTrue('BOOLEAN PK fails',                     !s12.valid);
assertTrue('Error mentions INT or STRING',          s12.errors.some(e => e.message.includes('requires INT or STRING')));


// ── Semantic Test 13: PK + REQUIRED + UNIQUE is valid ───────

console.log('');
console.log('── Semantic Test 13: PK + REQUIRED + UNIQUE ──');

const s13 = lexParseAnalyze('ENTITY Item\nid INT PRIMARY KEY REQUIRED UNIQUE');

assertTrue('PK + REQUIRED + UNIQUE passes', s13.valid);
assertEqual('Constraints are all present',
    s13.symbolTable['Item'].fields['id'].constraints,
    ['PRIMARY_KEY', 'REQUIRED', 'UNIQUE']
);


// ── Semantic Test 14: Reserved entity name ──────────────────
// Note: Reserved words like INT, ENTITY are tokenized as
// DATATYPE/KEYWORD by the lexer, so the parser would reject
// "ENTITY INT" before the semantic analyzer sees it. We test
// the semantic layer in isolation by constructing ASTs directly.

console.log('');
console.log('── Semantic Test 14: Reserved entity name ──');

const s14a_ast = new ProgramNode();
const s14a_entity = new EntityNode('INT', 1);
s14a_entity.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 2));
s14a_ast.entities.push(s14a_entity);
const s14a = SemanticAnalyzer.analyze(s14a_ast);

assertTrue('ENTITY named INT fails',               !s14a.valid);
assertTrue('Error mentions reserved word',          s14a.errors.some(e => e.message.includes('reserved word')));

const s14b_ast = new ProgramNode();
const s14b_entity = new EntityNode('ENTITY', 1);
s14b_entity.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 2));
s14b_ast.entities.push(s14b_entity);
const s14b = SemanticAnalyzer.analyze(s14b_ast);

assertTrue('ENTITY named ENTITY fails',            !s14b.valid);
assertTrue('Error mentions reserved word',          s14b.errors.some(e => e.message.includes('reserved word')));

const s14c_ast = new ProgramNode();
const s14c_entity = new EntityNode('REQUIRED', 1);
s14c_entity.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 2));
s14c_ast.entities.push(s14c_entity);
const s14c = SemanticAnalyzer.analyze(s14c_ast);

assertTrue('ENTITY named REQUIRED fails',          !s14c.valid);


// ── Semantic Test 15: Reserved field name ────────────────────

console.log('');
console.log('── Semantic Test 15: Reserved field name ──');

const s15_ast = new ProgramNode();
const s15_entity = new EntityNode('Student', 1);
s15_entity.fields.push(new FieldNode('INT', 'STRING', [], 2));
s15_entity.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 3));
s15_ast.entities.push(s15_entity);
const s15 = SemanticAnalyzer.analyze(s15_ast);

assertTrue('Reserved field name fails',             !s15.valid);
assertTrue('Error mentions reserved word',          s15.errors.some(e => e.message.includes("Field name 'INT'")));


// ── Semantic Test 16: Multiple simultaneous errors ──────────

console.log('');
console.log('── Semantic Test 16: Multiple simultaneous errors ──');

// Build an AST with multiple problems at once:
//   - Duplicate field
//   - Reserved field name
//   - Multiple primary keys

const s16_ast = new ProgramNode();
const s16_entity = new EntityNode('Student', 1);
s16_entity.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 2));
s16_entity.fields.push(new FieldNode('id', 'STRING', ['PRIMARY_KEY'], 3)); // dup + extra PK
s16_entity.fields.push(new FieldNode('FLOAT', 'STRING', [], 4));           // reserved name
s16_ast.entities.push(s16_entity);

const s16 = SemanticAnalyzer.analyze(s16_ast);

assertTrue('Multiple errors detected',             !s16.valid);
assertTrue('At least 3 errors found',              s16.errors.length >= 3);
assertTrue('Has duplicate field error',             s16.errors.some(e => e.message.includes("Duplicate field 'id'")));
assertTrue('Has multiple PK error',                 s16.errors.some(e => e.message.includes('multiple primary keys')));
assertTrue('Has reserved name error',               s16.errors.some(e => e.message.includes("reserved word")));


// ── Semantic Test 17: Valid relationship ────────────────────

console.log('');
console.log('── Semantic Test 17: Valid relationship ──');

const s17_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    'title STRING REQUIRED',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const s17 = lexParseAnalyze(s17_src);

assertTrue('Valid relationship passes', s17.valid);
assertTrue('No semantic errors', s17.errors.length === 0);
assertTrue('Relations table has ENROLLS_IN', 'ENROLLS_IN' in s17.relations);
assertEqual('Relation source is Student', s17.relations.ENROLLS_IN.sourceEntity, 'Student');
assertEqual('Relation target is Course', s17.relations.ENROLLS_IN.targetEntity, 'Course');
assertEqual('Relation type is MANY_TO_MANY', s17.relations.ENROLLS_IN.relationType, 'MANY_TO_MANY');


// ── Semantic Test 18: Source entity missing ─────────────────

console.log('');
console.log('── Semantic Test 18: Source entity missing ──');

const s18_src = [
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const s18 = lexParseAnalyze(s18_src);

assertTrue('Missing source entity fails', !s18.valid);
assertTrue('Error mentions missing source entity', s18.errors.some(e => e.message.includes("Source entity 'Student'")));


// ── Semantic Test 19: Target entity missing ─────────────────

console.log('');
console.log('── Semantic Test 19: Target entity missing ──');

const s19_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const s19 = lexParseAnalyze(s19_src);

assertTrue('Missing target entity fails', !s19.valid);
assertTrue('Error mentions missing target entity', s19.errors.some(e => e.message.includes("Target entity 'Course'")));


// ── Semantic Test 20: Both entities missing ─────────────────

console.log('');
console.log('── Semantic Test 20: Both entities missing ──');

const s20_src = [
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const s20 = lexParseAnalyze(s20_src);

assertTrue('Both entities missing fails', !s20.valid);
assertTrue('Reports at least 2 errors', s20.errors.length >= 2);
assertTrue('Has missing source error', s20.errors.some(e => e.message.includes("Source entity 'Student'")));
assertTrue('Has missing target error', s20.errors.some(e => e.message.includes("Target entity 'Course'")));


// ── Semantic Test 21: Duplicate relationship name ───────────

console.log('');
console.log('── Semantic Test 21: Duplicate relationship name ──');

const s21_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY',
    'RELATION Student ENROLLS_IN Course ONE_TO_MANY'
].join('\n');
const s21 = lexParseAnalyze(s21_src);

assertTrue('Duplicate relationship fails', !s21.valid);
assertTrue('Error mentions duplicate relationship', s21.errors.some(e => e.message.includes("Duplicate relationship 'ENROLLS_IN'")));


// ── Semantic Test 22: Multiple unique relationships ─────────

console.log('');
console.log('── Semantic Test 22: Multiple unique relationships ──');

const s22_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY',
    'RELATION Student BELONGS_TO Department MANY_TO_ONE'
].join('\n');
const s22 = lexParseAnalyze(s22_src);

assertTrue('Multiple relationships pass', s22.valid);
assertTrue('Has ENROLLS_IN relation', 'ENROLLS_IN' in s22.relations);
assertTrue('Has BELONGS_TO relation', 'BELONGS_TO' in s22.relations);


// ── Semantic Test 23: Self-relation rejected ────────────────

console.log('');
console.log('── Semantic Test 23: Self-relation rejected ──');

const s23_src = [
    'ENTITY Employee',
    'id INT PRIMARY KEY',
    '',
    'RELATION Employee MANAGES Employee ONE_TO_MANY'
].join('\n');
const s23 = lexParseAnalyze(s23_src);

assertTrue('Self-relation fails', !s23.valid);
assertTrue('Error mentions self-referential', s23.errors.some(e => e.message.includes("Self-referential")));


// ── Semantic Test 24: Cardinality ONE_TO_ONE ────────────────

console.log('');
console.log('── Semantic Test 24: Cardinality ONE_TO_ONE ──');

const s24_src = [
    'ENTITY User',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Profile',
    'id INT PRIMARY KEY',
    '',
    'RELATION User HAS_PROFILE Profile ONE_TO_ONE'
].join('\n');
const s24 = lexParseAnalyze(s24_src);

assertTrue('ONE_TO_ONE passes', s24.valid);
assertEqual('Relation type is ONE_TO_ONE', s24.relations.HAS_PROFILE.relationType, 'ONE_TO_ONE');


// ── Semantic Test 25: Cardinality ONE_TO_MANY ───────────────

console.log('');
console.log('── Semantic Test 25: Cardinality ONE_TO_MANY ──');

const s25_src = [
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Employee',
    'id INT PRIMARY KEY',
    '',
    'RELATION Department HAS_EMPLOYEES Employee ONE_TO_MANY'
].join('\n');
const s25 = lexParseAnalyze(s25_src);

assertTrue('ONE_TO_MANY passes', s25.valid);
assertEqual('Relation type is ONE_TO_MANY', s25.relations.HAS_EMPLOYEES.relationType, 'ONE_TO_MANY');


// ── Semantic Test 26: Cardinality MANY_TO_ONE ───────────────

console.log('');
console.log('── Semantic Test 26: Cardinality MANY_TO_ONE ──');

const s26_src = [
    'ENTITY Employee',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'RELATION Employee BELONGS_TO Department MANY_TO_ONE'
].join('\n');
const s26 = lexParseAnalyze(s26_src);

assertTrue('MANY_TO_ONE passes', s26.valid);
assertEqual('Relation type is MANY_TO_ONE', s26.relations.BELONGS_TO.relationType, 'MANY_TO_ONE');


// ── Semantic Test 27: Cardinality MANY_TO_MANY ──────────────

console.log('');
console.log('── Semantic Test 27: Cardinality MANY_TO_MANY ──');

const s27_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const s27 = lexParseAnalyze(s27_src);

assertTrue('MANY_TO_MANY passes', s27.valid);
assertEqual('Relation type is MANY_TO_MANY', s27.relations.ENROLLS_IN.relationType, 'MANY_TO_MANY');


// ── Semantic Test 28: Relationship line tracking ────────────

console.log('');
console.log('── Semantic Test 28: Relationship line tracking ──');

const s28_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    '',
    'RELATION Student ENROLLS_IN GhostCourse MANY_TO_MANY'
].join('\n');
const s28 = lexParseAnalyze(s28_src);

assertTrue('Target missing on line 5 fails', !s28.valid);
assertEqual('Error line is 5', s28.errors[0].line, 5);


// ── Semantic Test 29: Multiple errors in one program ────────

console.log('');
console.log('── Semantic Test 29: Multiple errors in one program ──');

const s29_src = [
    'ENTITY Student',
    'name STRING',
    'name INT',
    '',
    'RELATION Student ENROLLS_IN UnknownCourse MANY_TO_MANY'
].join('\n');
const s29 = lexParseAnalyze(s29_src);

assertTrue('Multiple errors program fails', !s29.valid);
assertTrue('Has at least 2 errors', s29.errors.length >= 2);
assertTrue('Has duplicate field error', s29.errors.some(e => e.message.includes("Duplicate field 'name'")));
assertTrue('Has missing target error', s29.errors.some(e => e.message.includes("Target entity 'UnknownCourse'")));


// ═════════════════════════════════════════════════════════════
// PHASE 4: IR GENERATOR TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'ir';

// ── IR Test 1: Student AST -> correct IR ──────────────────────
console.log('');
console.log('── IR Test 1: Student AST -> correct IR ──');

const ir1_source = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'email STRING UNIQUE',
    'age INT',
    'cgpa FLOAT',
].join('\n');

const ir1_ast = lexAndParse(ir1_source);
const ir1_sem = SemanticAnalyzer.analyze(ir1_ast);
const ir1 = IRGenerator.generate(ir1_ast, ir1_sem);

assertEqual('IR type is PROGRAM',               ir1.type, 'PROGRAM');
assertTrue('IR instructions count is 6',        ir1.instructions.length === 6);
assertEqual('Instruction 1 op',                 ir1.instructions[0].op, 'CREATE_ENTITY');
assertEqual('Instruction 1 entity',             ir1.instructions[0].entity, 'Student');


// ── IR Test 2: Multiple entities ──────────────────────────────
console.log('');
console.log('── IR Test 2: Multiple entities ──');

const ir2_ast = lexAndParse('ENTITY Student\nid INT PRIMARY KEY\n\nENTITY Course\ncode INT PRIMARY KEY');
const ir2_sem = SemanticAnalyzer.analyze(ir2_ast);
const ir2 = IRGenerator.generate(ir2_ast, ir2_sem);

assertTrue('IR has 4 instructions',             ir2.instructions.length === 4);
assertEqual('Instruction 0 is CREATE Student',  ir2.instructions[0].entity, 'Student');
assertEqual('Instruction 2 is CREATE Course',   ir2.instructions[2].entity, 'Course');


// ── IR Test 3: Entity with multiple fields ────────────────────
console.log('');
console.log('── IR Test 3: Entity with multiple fields ──');

const ir3_ast = lexAndParse('ENTITY Item\nid INT PRIMARY KEY\nname STRING\nprice FLOAT');
const ir3 = IRGenerator.generate(ir3_ast);

assertTrue('Item entity has 4 instructions',    ir3.instructions.length === 4);
assertEqual('Field 1 is id',                    ir3.instructions[1].field, 'id');
assertEqual('Field 2 is name',                  ir3.instructions[2].field, 'name');
assertEqual('Field 3 is price',                 ir3.instructions[3].field, 'price');


// ── IR Test 4: Field constraints preserved ────────────────────
console.log('');
console.log('── IR Test 4: Field constraints preserved ──');

const ir4_ast = lexAndParse('ENTITY User\nid INT PRIMARY KEY REQUIRED UNIQUE');
const ir4 = IRGenerator.generate(ir4_ast);

assertEqual('Constraints array preserved',      ir4.instructions[1].constraints, ['PRIMARY_KEY', 'REQUIRED', 'UNIQUE']);


// ── IR Test 5: PRIMARY_KEY preserved ──────────────────────────
console.log('');
console.log('── IR Test 5: PRIMARY_KEY preserved ──');

assertEqual('PRIMARY_KEY constraint present',   ir4.instructions[1].constraints.includes('PRIMARY_KEY'), true);


// ── IR Test 6: REQUIRED preserved ─────────────────────────────
console.log('');
console.log('── IR Test 6: REQUIRED preserved ──');

assertEqual('REQUIRED constraint present',      ir4.instructions[1].constraints.includes('REQUIRED'), true);


// ── IR Test 7: UNIQUE preserved ───────────────────────────────
console.log('');
console.log('── IR Test 7: UNIQUE preserved ──');

assertEqual('UNIQUE constraint present',        ir4.instructions[1].constraints.includes('UNIQUE'), true);


// ── IR Test 8: Data types preserved ───────────────────────────
console.log('');
console.log('── IR Test 8: Data types preserved ──');

const ir8_ast = lexAndParse([
    'ENTITY TypesTest',
    'a INT PRIMARY KEY',
    'b STRING',
    'c FLOAT',
    'd BOOLEAN'
].join('\n'));
const ir8 = IRGenerator.generate(ir8_ast);

assertEqual('INT data type preserved',          ir8.instructions[1].dataType, 'INT');
assertEqual('STRING data type preserved',       ir8.instructions[2].dataType, 'STRING');
assertEqual('FLOAT data type preserved',        ir8.instructions[3].dataType, 'FLOAT');
assertEqual('BOOLEAN data type preserved',      ir8.instructions[4].dataType, 'BOOLEAN');


// ── IR Test 9: Source line preserved ──────────────────────────
console.log('');
console.log('── IR Test 9: Source line preserved ──');

assertEqual('CREATE_ENTITY line preserved',    typeof ir1.instructions[0].line, 'number');
assertEqual('ADD_FIELD line preserved',        typeof ir1.instructions[1].line, 'number');


// ── IR Test 10: Invalid semantic analysis error ──────────────
console.log('');
console.log('── IR Test 10: Invalid semantic analysis error ──');

const invalidSemanticResult = { valid: false, errors: [{ message: 'Fake error', line: 1 }] };
assertThrows(
    'Throws error when semantic analysis failed',
    () => IRGenerator.generate(ir1_ast, invalidSemanticResult),
    'Semantic analysis failed'
);


// ── IR Test 11: IR validation ─────────────────────────────────
console.log('');
console.log('── IR Test 11: IR validation ──');

const validValidation = IRGenerator.validate(ir1);
assertTrue('Valid IR passes validation',        validValidation.valid);

const invalidIR1 = { type: 'NOT_A_PROGRAM', instructions: [] };
const invVal1 = IRGenerator.validate(invalidIR1);
assertTrue('Invalid type fails validation',     !invVal1.valid);

const invalidIR2 = { type: 'PROGRAM', instructions: [{ op: 'INVALID_OP' }] };
const invVal2 = IRGenerator.validate(invalidIR2);
assertTrue('Invalid op fails validation',        !invVal2.valid);


// ── IR Test 12: Correct instruction ordering ──────────────────
console.log('');
console.log('── IR Test 12: Correct instruction ordering ──');

const ir12_ops = ir1.instructions.map(inst => inst.op);
assertEqual('Ordering: CREATE_ENTITY followed by 5 ADD_FIELDs', ir12_ops, [
    'CREATE_ENTITY',
    'ADD_FIELD',
    'ADD_FIELD',
    'ADD_FIELD',
    'ADD_FIELD',
    'ADD_FIELD'
]);


// ── IR Test 13: One MANY_TO_MANY relationship ───────────────
console.log('');
console.log('── IR Test 13: One MANY_TO_MANY relationship ──');

const ir13_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const ir13_ast = lexAndParse(ir13_src);
const ir13_sem = SemanticAnalyzer.analyze(ir13_ast);
const ir13 = IRGenerator.generate(ir13_ast, ir13_sem);

assertTrue('IR has 5 instructions (2 entities, 2 fields, 1 relation)', ir13.instructions.length === 5);
const relInst13 = ir13.instructions.find(i => i.op === 'CREATE_RELATION');
assertTrue('CREATE_RELATION instruction found', Boolean(relInst13));
assertEqual('CREATE_RELATION op', relInst13.op, 'CREATE_RELATION');
assertEqual('CREATE_RELATION relationType', relInst13.relationType, 'MANY_TO_MANY');


// ── IR Test 14: ONE_TO_ONE relationship ─────────────────────
console.log('');
console.log('── IR Test 14: ONE_TO_ONE relationship ──');

const ir14_src = [
    'ENTITY User',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Profile',
    'id INT PRIMARY KEY',
    '',
    'RELATION User HAS_PROFILE Profile ONE_TO_ONE'
].join('\n');
const ir14_ast = lexAndParse(ir14_src);
const ir14 = IRGenerator.generate(ir14_ast);
const relInst14 = ir14.instructions.find(i => i.op === 'CREATE_RELATION');
assertEqual('ONE_TO_ONE relationType in IR', relInst14.relationType, 'ONE_TO_ONE');
assertEqual('ONE_TO_ONE relationName in IR', relInst14.relationName, 'HAS_PROFILE');


// ── IR Test 15: ONE_TO_MANY relationship ────────────────────
console.log('');
console.log('── IR Test 15: ONE_TO_MANY relationship ──');

const ir15_src = [
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Employee',
    'id INT PRIMARY KEY',
    '',
    'RELATION Department HAS_EMPLOYEES Employee ONE_TO_MANY'
].join('\n');
const ir15_ast = lexAndParse(ir15_src);
const ir15 = IRGenerator.generate(ir15_ast);
const relInst15 = ir15.instructions.find(i => i.op === 'CREATE_RELATION');
assertEqual('ONE_TO_MANY relationType in IR', relInst15.relationType, 'ONE_TO_MANY');


// ── IR Test 16: MANY_TO_ONE relationship ────────────────────
console.log('');
console.log('── IR Test 16: MANY_TO_ONE relationship ──');

const ir16_src = [
    'ENTITY Employee',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'RELATION Employee BELONGS_TO Department MANY_TO_ONE'
].join('\n');
const ir16_ast = lexAndParse(ir16_src);
const ir16 = IRGenerator.generate(ir16_ast);
const relInst16 = ir16.instructions.find(i => i.op === 'CREATE_RELATION');
assertEqual('MANY_TO_ONE relationType in IR', relInst16.relationType, 'MANY_TO_ONE');


// ── IR Test 17: Multiple relationships ──────────────────────
console.log('');
console.log('── IR Test 17: Multiple relationships ──');

const ir17_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Department',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY',
    'RELATION Student BELONGS_TO Department MANY_TO_ONE'
].join('\n');
const ir17_ast = lexAndParse(ir17_src);
const ir17 = IRGenerator.generate(ir17_ast);
const relInsts17 = ir17.instructions.filter(i => i.op === 'CREATE_RELATION');
assertEqual('Multiple relationships count in IR is 2', relInsts17.length, 2);
assertEqual('First relation is ENROLLS_IN', relInsts17[0].relationName, 'ENROLLS_IN');
assertEqual('Second relation is BELONGS_TO', relInsts17[1].relationName, 'BELONGS_TO');


// ── IR Test 18: Correct sourceEntity ────────────────────────
console.log('');
console.log('── IR Test 18: Correct sourceEntity ──');

assertEqual('sourceEntity is Student', relInst13.sourceEntity, 'Student');


// ── IR Test 19: Correct relationName ────────────────────────
console.log('');
console.log('── IR Test 19: Correct relationName ──');

assertEqual('relationName is ENROLLS_IN', relInst13.relationName, 'ENROLLS_IN');


// ── IR Test 20: Correct targetEntity ────────────────────────
console.log('');
console.log('── IR Test 20: Correct targetEntity ──');

assertEqual('targetEntity is Course', relInst13.targetEntity, 'Course');


// ── IR Test 21: Correct relationType ────────────────────────
console.log('');
console.log('── IR Test 21: Correct relationType ──');

assertEqual('relationType is MANY_TO_MANY', relInst13.relationType, 'MANY_TO_MANY');


// ── IR Test 22: Line number preserved ───────────────────────
console.log('');
console.log('── IR Test 22: Line number preserved ──');

assertEqual('Relation instruction line is 7', relInst13.line, 7);


// ── IR Test 23: Valid CREATE_RELATION passes validate() ─────
console.log('');
console.log('── IR Test 23: Valid CREATE_RELATION passes validate() ──');

const validRelValidation = IRGenerator.validate(ir13);
assertTrue('IR with CREATE_RELATION passes validate()', validRelValidation.valid);


// ── IR Test 24: Invalid CREATE_RELATION rejected ────────────
console.log('');
console.log('── IR Test 24: Invalid CREATE_RELATION rejected ──');

const invalidRelIR1 = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', relationType: 'MANY_TO_MANY' } // missing targetEntity
    ]
};
const valRes1 = IRGenerator.validate(invalidRelIR1);
assertTrue('Missing targetEntity in CREATE_RELATION is invalid', !valRes1.valid);

const invalidRelIR2 = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'INVALID_TYPE' }
    ]
};
const valRes2 = IRGenerator.validate(invalidRelIR2);
assertTrue('Invalid relationType in CREATE_RELATION is invalid', !valRes2.valid);


// ═════════════════════════════════════════════════════════════
// PHASE 5: OPTIMIZER TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'optimizer';

console.log('');
console.log('── Optimizer Test 1: IR with no duplicates remains unchanged ──');
const cleanIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 3 }
    ]
};
const opt1 = Optimizer.optimize(cleanIR);
assertEqual('Optimized IR instructions match original', opt1.ir.instructions, cleanIR.instructions);
assertEqual('No optimizations recorded for clean IR', opt1.optimizations.length, 0);
assertEqual('No warnings for clean IR', opt1.warnings.length, 0);


console.log('');
console.log('── Optimizer Test 2: Duplicate CREATE_ENTITY removed ──');
const dupEntityIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Student', line: 5 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 }
    ]
};
const opt2 = Optimizer.optimize(dupEntityIR);
assertTrue('Duplicate CREATE_ENTITY removed (2 -> 1)', opt2.ir.instructions.filter(i => i.op === 'CREATE_ENTITY').length === 1);
assertEqual('Duplicate entity pass count is 1', opt2.optimizations.find(p => p.pass === 'Duplicate Entity Elimination').count, 1);


console.log('');
console.log('── Optimizer Test 3: Duplicate ADD_FIELD removed ──');
const dupFieldIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 2 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 3 }
    ]
};
const opt3 = Optimizer.optimize(dupFieldIR);
assertTrue('Duplicate ADD_FIELD removed (2 -> 1)', opt3.ir.instructions.filter(i => i.op === 'ADD_FIELD').length === 1);
assertEqual('Duplicate field pass count is 1', opt3.optimizations.find(p => p.pass === 'Duplicate Field Elimination').count, 1);


console.log('');
console.log('── Optimizer Test 4: Conflicting duplicate field detected as warning ──');
const conflictFieldIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 2 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'INT', constraints: [], line: 3 }
    ]
};
const opt4 = Optimizer.optimize(conflictFieldIR);
assertTrue('Conflicting duplicate field preserved both (2 fields)', opt4.ir.instructions.filter(i => i.op === 'ADD_FIELD').length === 2);
assertTrue('Optimization warning logged for conflict', opt4.warnings.length === 1 && opt4.warnings[0].includes('Optimization Conflict'));


console.log('');
console.log('── Optimizer Test 5: Duplicate constraints removed ──');
const dupConstraintsIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'email', dataType: 'STRING', constraints: ['UNIQUE', 'REQUIRED', 'UNIQUE', 'REQUIRED'], line: 2 }
    ]
};
const opt5 = Optimizer.optimize(dupConstraintsIR);
assertEqual('Duplicate constraints removed', opt5.ir.instructions[1].constraints, ['REQUIRED', 'UNIQUE']);


console.log('');
console.log('── Optimizer Test 6: Constraints normalized into deterministic order ──');
const unorderConstraintsIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['UNIQUE', 'REQUIRED', 'PRIMARY_KEY'], line: 2 }
    ]
};
const opt6 = Optimizer.optimize(unorderConstraintsIR);
assertEqual('Constraints normalized: PRIMARY_KEY -> REQUIRED -> UNIQUE', opt6.ir.instructions[1].constraints, ['PRIMARY_KEY', 'REQUIRED', 'UNIQUE']);


console.log('');
console.log('── Optimizer Test 7: Field order preserved ──');
const fieldOrderIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'zField', dataType: 'STRING', constraints: [], line: 2 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'aField', dataType: 'INT', constraints: [], line: 3 }
    ]
};
const opt7 = Optimizer.optimize(fieldOrderIR);
assertEqual('First field is zField', opt7.ir.instructions[1].field, 'zField');
assertEqual('Second field is aField', opt7.ir.instructions[2].field, 'aField');


console.log('');
console.log('── Optimizer Test 8: Entity order preserved ──');
const entityOrderIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Teacher', line: 1 },
        { op: 'ADD_FIELD', entity: 'Teacher', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 3 },
        { op: 'ADD_FIELD', entity: 'Course', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 }
    ]
};
const opt8 = Optimizer.optimize(entityOrderIR);
assertEqual('First entity is Teacher', opt8.ir.instructions[0].entity, 'Teacher');
assertEqual('Second entity is Course', opt8.ir.instructions[2].entity, 'Course');


console.log('');
console.log('── Optimizer Test 9: Source line information preserved ──');
const linePreserveIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 42 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['UNIQUE', 'PRIMARY_KEY'], line: 43 }
    ]
};
const opt9 = Optimizer.optimize(linePreserveIR);
assertEqual('Entity line preserved', opt9.ir.instructions[0].line, 42);
assertEqual('Field line preserved', opt9.ir.instructions[1].line, 43);


console.log('');
console.log('── Optimizer Test 10: Multiple optimization passes work together ──');
const multiPassIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Student', line: 2 }, // dup entity
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['UNIQUE', 'PRIMARY_KEY'], line: 3 }, // unnormalized
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 4 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 5 }  // dup field
    ]
};
const opt10 = Optimizer.optimize(multiPassIR);
assertTrue('Multi-pass instruction reduction (5 -> 3)', opt10.ir.instructions.length === 3);
assertTrue('All 3 optimization passes recorded', opt10.optimizations.length === 3);


console.log('');
console.log('── Optimizer Test 11: Optimization count/report is correct ──');
const reportPasses = opt10.optimizations.map(o => o.pass);
assertEqual('All passes in report', reportPasses, [
    'Constraint Normalization',
    'Duplicate Entity Elimination',
    'Duplicate Field Elimination'
]);


console.log('');
console.log('── Optimizer Test 12: Optimized IR remains valid using Phase 4 IR validator ──');
const validationResult = IRGenerator.validate(opt10.ir);
assertTrue('Optimized IR passes Phase 4 validator', validationResult.valid);


// ── Optimizer Test 13: No relationships -> unchanged ─────────
console.log('');
console.log('── Optimizer Test 13: No relationships -> unchanged ──');

const noRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 }
    ]
};
const opt13 = Optimizer.optimize(noRelIR);
assertEqual('No relationships IR unchanged count', opt13.ir.instructions.length, 2);
assertTrue('No duplicate relationship elimination pass recorded', !opt13.optimizations.some(o => o.pass === 'Duplicate Relationship Elimination'));


// ── Optimizer Test 14: One relationship -> unchanged ─────────
console.log('');
console.log('── Optimizer Test 14: One relationship -> unchanged ──');

const oneRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 3 }
    ]
};
const opt14 = Optimizer.optimize(oneRelIR);
assertEqual('One relationship IR unchanged count', opt14.ir.instructions.length, 3);
assertTrue('No duplicate relationship pass recorded', !opt14.optimizations.some(o => o.pass === 'Duplicate Relationship Elimination'));


// ── Optimizer Test 15: Duplicate identical relationship -> removed ──
console.log('');
console.log('── Optimizer Test 15: Duplicate identical relationship -> removed ──');

const dupRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 4 }
    ]
};
const opt15 = Optimizer.optimize(dupRelIR);
assertEqual('Duplicate relation removed (4 -> 3)', opt15.ir.instructions.length, 3);
assertEqual('Only 1 CREATE_RELATION remains', opt15.ir.instructions.filter(i => i.op === 'CREATE_RELATION').length, 1);
assertTrue('Recorded Duplicate Relationship Elimination', opt15.optimizations.some(o => o.pass === 'Duplicate Relationship Elimination' && o.count === 1));


// ── Optimizer Test 16: Multiple duplicate relationships -> all removed ──
console.log('');
console.log('── Optimizer Test 16: Multiple duplicate relationships -> all removed ──');

const multiDupRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 5 }
    ]
};
const opt16 = Optimizer.optimize(multiDupRelIR);
assertEqual('3 duplicate relations reduced to 1', opt16.ir.instructions.filter(i => i.op === 'CREATE_RELATION').length, 1);
assertEqual('Removed count is 2', opt16.optimizations.find(o => o.pass === 'Duplicate Relationship Elimination').count, 2);


// ── Optimizer Test 17: Conflicting relationship type -> warning ──
console.log('');
console.log('── Optimizer Test 17: Conflicting relationship type -> warning ──');

const conflictRelTypeIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'ONE_TO_MANY', line: 4 }
    ]
};
const opt17 = Optimizer.optimize(conflictRelTypeIR);
assertEqual('Both conflicting relations preserved', opt17.ir.instructions.filter(i => i.op === 'CREATE_RELATION').length, 2);
assertTrue('Optimization warning emitted for conflicting relation type', opt17.warnings.some(w => w.includes('conflicting relation types')));


// ── Optimizer Test 18: Conflicting relationship endpoints -> warning ──
console.log('');
console.log('── Optimizer Test 18: Conflicting relationship endpoints -> warning ──');

const conflictEndpointsIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Department', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'BELONGS_TO', targetEntity: 'Course', relationType: 'MANY_TO_ONE', line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'BELONGS_TO', targetEntity: 'Department', relationType: 'MANY_TO_ONE', line: 5 }
    ]
};
const opt18 = Optimizer.optimize(conflictEndpointsIR);
assertEqual('Both conflicting endpoint relations preserved', opt18.ir.instructions.filter(i => i.op === 'CREATE_RELATION').length, 2);
assertTrue('Optimization warning emitted for conflicting endpoints', opt18.warnings.some(w => w.includes('conflicting endpoint definitions')));


// ── Optimizer Test 19: Different relationship names preserved ──
console.log('');
console.log('── Optimizer Test 19: Different relationship names preserved ──');

const diffNamesIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'TAKES', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 4 }
    ]
};
const opt19 = Optimizer.optimize(diffNamesIR);
assertEqual('Different relation names preserved count is 4', opt19.ir.instructions.length, 4);
assertEqual('No warnings for different relation names', opt19.warnings.length, 0);


// ── Optimizer Test 20: Relationship declaration order preserved ──
console.log('');
console.log('── Optimizer Test 20: Relationship declaration order preserved ──');

const orderRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Department', line: 3 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Teacher', relationName: 'TEACHES', targetEntity: 'Course', relationType: 'ONE_TO_MANY', line: 5 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'BELONGS_TO', targetEntity: 'Department', relationType: 'MANY_TO_ONE', line: 6 }
    ]
};
const opt20 = Optimizer.optimize(orderRelIR);
const relNamesOrder = opt20.ir.instructions.filter(i => i.op === 'CREATE_RELATION').map(i => i.relationName);
assertEqual('Relation order preserved', relNamesOrder, ['ENROLLS_IN', 'TEACHES', 'BELONGS_TO']);


// ── Optimizer Test 21: All 4 passes work together ────────────
console.log('');
console.log('── Optimizer Test 21: All 4 passes work together ──');

const allFourPassesIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'CREATE_ENTITY', entity: 'Student', line: 2 }, // dup entity
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['UNIQUE', 'PRIMARY_KEY'], line: 3 }, // unnormalized
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 4 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 5 }, // dup field
        { op: 'CREATE_ENTITY', entity: 'Course', line: 6 },
        { op: 'ADD_FIELD', entity: 'Course', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 7 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 8 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 9 }  // dup relation
    ]
};
const opt21 = Optimizer.optimize(allFourPassesIR);
assertEqual('Instruction count reduced (9 -> 6)', opt21.ir.instructions.length, 6);
assertEqual('All 4 optimization passes applied', opt21.optimizations.length, 4);
const passNames = opt21.optimizations.map(o => o.pass);
assertEqual('Pass names in result', passNames, [
    'Constraint Normalization',
    'Duplicate Entity Elimination',
    'Duplicate Field Elimination',
    'Duplicate Relationship Elimination'
]);


// ── Optimizer Test 22: Optimized IR with relations passes IR validator ──
console.log('');
console.log('── Optimizer Test 22: Optimized IR with relations passes IR validator ──');

const val22 = IRGenerator.validate(opt21.ir);
assertTrue('Optimized IR with relations passes IR validation', val22.valid);


// ═════════════════════════════════════════════════════════════
// PHASE 6: CODE GENERATOR TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'codegen';

const testStudentIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 11 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 13 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], line: 14 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'email', dataType: 'STRING', constraints: ['UNIQUE'], line: 15 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], line: 16 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'cgpa', dataType: 'FLOAT', constraints: [], line: 17 }
    ]
};

// ── Codegen Test 1: Single Student entity -> correct SQL ──────
console.log('');
console.log('── Codegen Test 1: Single Student entity -> correct SQL ──');
const sql1 = CodeGenerator.generateSQL(testStudentIR);
assertTrue('SQL contains CREATE TABLE Student', sql1.includes('CREATE TABLE Student ('));
assertTrue('SQL contains id column def', sql1.includes('id INT PRIMARY KEY AUTO_INCREMENT'));
assertTrue('SQL contains name column def', sql1.includes('name VARCHAR(255) NOT NULL'));
assertTrue('SQL contains email column def', sql1.includes('email VARCHAR(255) UNIQUE'));
assertTrue('SQL contains age column def', sql1.includes('age INT'));
assertTrue('SQL contains cgpa column def', sql1.includes('cgpa FLOAT'));


// ── Codegen Test 2: STRING -> VARCHAR(255) ────────────────────
console.log('');
console.log('── Codegen Test 2: STRING -> VARCHAR(255) ──');
assertTrue('STRING mapped to VARCHAR(255)', sql1.includes('VARCHAR(255)'));


// ── Codegen Test 3: INT -> INT ────────────────────────────────
console.log('');
console.log('── Codegen Test 3: INT -> INT ──');
assertTrue('INT mapped to INT', sql1.includes('age INT'));


// ── Codegen Test 4: FLOAT -> FLOAT ────────────────────────────
console.log('');
console.log('── Codegen Test 4: FLOAT -> FLOAT ──');
assertTrue('FLOAT mapped to FLOAT', sql1.includes('cgpa FLOAT'));


// ── Codegen Test 5: BOOLEAN -> BOOLEAN ────────────────────────
console.log('');
console.log('── Codegen Test 5: BOOLEAN -> BOOLEAN ──');
const boolIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'User', line: 1 },
        { op: 'ADD_FIELD', entity: 'User', field: 'active', dataType: 'BOOLEAN', constraints: [], line: 2 }
    ]
};
const sqlBool = CodeGenerator.generateSQL(boolIR);
assertTrue('BOOLEAN mapped to BOOLEAN', sqlBool.includes('active BOOLEAN'));


// ── Codegen Test 6: PRIMARY_KEY -> PRIMARY KEY AUTO_INCREMENT ──
console.log('');
console.log('── Codegen Test 6: PRIMARY_KEY -> PRIMARY KEY AUTO_INCREMENT ──');
assertTrue('PRIMARY_KEY mapped to PRIMARY KEY AUTO_INCREMENT', sql1.includes('PRIMARY KEY AUTO_INCREMENT'));


// ── Codegen Test 7: REQUIRED -> NOT NULL ──────────────────────
console.log('');
console.log('── Codegen Test 7: REQUIRED -> NOT NULL ──');
assertTrue('REQUIRED mapped to NOT NULL', sql1.includes('NOT NULL'));


// ── Codegen Test 8: UNIQUE -> UNIQUE ──────────────────────────
console.log('');
console.log('── Codegen Test 8: UNIQUE -> UNIQUE ──');
assertTrue('UNIQUE mapped to UNIQUE', sql1.includes('UNIQUE'));


// ── Codegen Test 9: Multiple entities ─────────────────────────
console.log('');
console.log('── Codegen Test 9: Multiple entities ──');
const multiEntityIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 3 },
        { op: 'ADD_FIELD', entity: 'Course', field: 'code', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 }
    ]
};
const multiSql = CodeGenerator.generateSQL(multiEntityIR);
assertTrue('Contains CREATE TABLE Student', multiSql.includes('CREATE TABLE Student ('));
assertTrue('Contains CREATE TABLE Course', multiSql.includes('CREATE TABLE Course ('));


// ── Codegen Test 10: REST CRUD routes ─────────────────────────
console.log('');
console.log('── Codegen Test 10: REST CRUD routes ──');
const studentRoutes = CodeGenerator.generateRoutes('Student');
assertTrue('Route GET /', studentRoutes.includes("router.get('/',"));
assertTrue('Route GET /:id', studentRoutes.includes("router.get('/:id',"));
assertTrue('Route POST /', studentRoutes.includes("router.post('/',"));
assertTrue('Route PUT /:id', studentRoutes.includes("router.put('/:id',"));
assertTrue('Route DELETE /:id', studentRoutes.includes("router.delete('/:id',"));


// ── Codegen Test 11: Correct pluralized route ─────────────────
console.log('');
console.log('── Codegen Test 11: Correct pluralized route ──');
assertEqual('Pluralize Student', CodeGenerator.pluralize('Student'), 'students');
assertEqual('Pluralize Course', CodeGenerator.pluralize('Course'), 'courses');
assertEqual('Pluralize Category', CodeGenerator.pluralize('Category'), 'categories');


// ── Codegen Test 12: Model generated ─────────────────────────
console.log('');
console.log('── Codegen Test 12: Model generated ──');
const studentModel = CodeGenerator.generateModel('Student', [{ name: 'id', dataType: 'INT' }]);
assertTrue('Model exports class StudentModel', studentModel.includes('class StudentModel'));
assertTrue('Model contains tableName', studentModel.includes("return 'Student'"));
assertTrue('Model contains findAll', studentModel.includes('static async findAll()'));


// ── Codegen Test 13: Controller generated ─────────────────────
console.log('');
console.log('── Codegen Test 13: Controller generated ──');
const studentController = CodeGenerator.generateController('Student');
assertTrue('Controller contains createStudent', studentController.includes('function createStudent'));
assertTrue('Controller contains getStudents', studentController.includes('function getStudents'));
assertTrue('Controller contains getStudentById', studentController.includes('function getStudentById'));
assertTrue('Controller contains updateStudent', studentController.includes('function updateStudent'));
assertTrue('Controller contains deleteStudent', studentController.includes('function deleteStudent'));


// ── Codegen Test 14: Server generated ─────────────────────────
console.log('');
console.log('── Codegen Test 14: Server generated ──');
const serverContent = CodeGenerator.generateServer([{ name: 'Student' }, { name: 'Course' }]);
assertTrue('Server initializes express', serverContent.includes("const express = require('express')"));
assertTrue('Server loads dotenv config', serverContent.includes("require('dotenv').config()"));
assertTrue('Server mounts studentRoutes', serverContent.includes("app.use('/students', studentRoutes)"));
assertTrue('Server mounts courseRoutes', serverContent.includes("app.use('/courses', courseRoutes)"));


// ── Codegen Test 15: Swagger generated ────────────────────────
console.log('');
console.log('── Codegen Test 15: Swagger generated ──');
const swaggerContent = CodeGenerator.generateSwagger([{
    name: 'Student',
    fields: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'STRING' },
        { name: 'cgpa', dataType: 'FLOAT' }
    ]
}]);
const swaggerObj = JSON.parse(swaggerContent);
assertEqual('OpenAPI version 3.0.0', swaggerObj.openapi, '3.0.0');
assertTrue('Has /students path', '/students' in swaggerObj.paths);
assertTrue('Has /students/{id} path', '/students/{id}' in swaggerObj.paths);
assertEqual('Schema type for id is integer', swaggerObj.components.schemas.Student.properties.id.type, 'integer');
assertEqual('Schema type for name is string', swaggerObj.components.schemas.Student.properties.name.type, 'string');
assertEqual('Schema type for cgpa is number', swaggerObj.components.schemas.Student.properties.cgpa.type, 'number');


// ── Codegen Test 16: Output file list ─────────────────────────
console.log('');
console.log('── Codegen Test 16: Output file list ──');
const genResult = CodeGenerator.generate(testStudentIR, false);
assertTrue('Result has success: true', genResult.success);
const filePaths = genResult.files.map(f => f.path);
assertTrue('Contains schema.sql', filePaths.includes('database/schema.sql'));
assertTrue('Contains Student.js model', filePaths.includes('models/Student.js'));
assertTrue('Contains studentController.js', filePaths.includes('controllers/studentController.js'));
assertTrue('Contains studentRoutes.js', filePaths.includes('routes/studentRoutes.js'));
assertTrue('Contains server.js', filePaths.includes('server.js'));
assertTrue('Contains swagger.json', filePaths.includes('swagger.json'));


// ── Codegen Test 17: Invalid IR rejected ──────────────────────
console.log('');
console.log('── Codegen Test 17: Invalid IR rejected ──');
assertThrows(
    'Throws error on invalid IR',
    () => CodeGenerator.generate({ type: 'INVALID' }, false),
    'Cannot generate target code'
);


// ── Codegen Test 18: Field order preserved ─────────────────────
console.log('');
console.log('── Codegen Test 18: Field order preserved ──');
const sqlLines = sql1.split('\n').filter(l => l.includes('id') || l.includes('name') || l.includes('email') || l.includes('age') || l.includes('cgpa'));
assertTrue('id comes before name', sqlLines.findIndex(l => l.includes('id')) < sqlLines.findIndex(l => l.includes('name')));
assertTrue('name comes before email', sqlLines.findIndex(l => l.includes('name')) < sqlLines.findIndex(l => l.includes('email')));
assertTrue('email comes before age', sqlLines.findIndex(l => l.includes('email')) < sqlLines.findIndex(l => l.includes('age')));
assertTrue('age comes before cgpa', sqlLines.findIndex(l => l.includes('age')) < sqlLines.findIndex(l => l.includes('cgpa')));


// ── Codegen Test 19: DB Config & Env Example Generated ───────
console.log('');
console.log('── Codegen Test 19: DB Config & Env Example Generated ──');
const dbConfigContent = CodeGenerator.generateDBConfig();
assertTrue('dbConfig imports mysql2/promise', dbConfigContent.includes("require('mysql2/promise')"));
assertTrue('dbConfig creates pool with DB_HOST', dbConfigContent.includes('process.env.DB_HOST'));

const envExampleContent = CodeGenerator.generateEnvExample();
assertTrue('envExample contains DB_NAME', envExampleContent.includes('DB_NAME=apiforge_db'));
assertTrue('envExample contains PORT', envExampleContent.includes('PORT=3000'));


// ── Codegen Test 20: Parameterized Queries in Model ───────────
console.log('');
console.log('── Codegen Test 20: Parameterized Queries in Model ──');
const modelSqlCode = CodeGenerator.generateModel('Student', [{ name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] }]);
assertTrue('Model imports mysql pool', modelSqlCode.includes("const pool = require('../config/db')"));
assertTrue('Model uses parameterized SELECT', modelSqlCode.includes("SELECT * FROM Student WHERE id = ?"));
assertTrue('Model uses parameterized INSERT', modelSqlCode.includes("INSERT INTO Student SET ?"));
assertTrue('Model uses parameterized UPDATE', modelSqlCode.includes("UPDATE Student SET ? WHERE id = ?"));
assertTrue('Model uses parameterized DELETE', modelSqlCode.includes("DELETE FROM Student WHERE id = ?"));


// ── Codegen Test 21: MANY_TO_MANY SQL ────────────────────────
console.log('');
console.log('── Codegen Test 21: MANY_TO_MANY SQL ──');

const m2mIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 3 },
        { op: 'ADD_FIELD', entity: 'Course', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 5 }
    ]
};
const m2mSql = CodeGenerator.generateSQL(m2mIR);

assertTrue('MANY_TO_MANY creates junction table Student_Course', m2mSql.includes('CREATE TABLE Student_Course ('));
assertTrue('Junction table has student_id', m2mSql.includes('student_id INT NOT NULL'));
assertTrue('Junction table has course_id', m2mSql.includes('course_id INT NOT NULL'));
assertTrue('Composite PRIMARY KEY (student_id, course_id)', m2mSql.includes('PRIMARY KEY (student_id, course_id)'));
assertTrue('FK referencing Student(id)', m2mSql.includes('FOREIGN KEY (student_id) REFERENCES Student(id) ON DELETE CASCADE'));
assertTrue('FK referencing Course(id)', m2mSql.includes('FOREIGN KEY (course_id) REFERENCES Course(id) ON DELETE CASCADE'));


// ── Codegen Test 22: ONE_TO_ONE SQL ──────────────────────────
console.log('');
console.log('── Codegen Test 22: ONE_TO_ONE SQL ──');

const o2oIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'User', line: 1 },
        { op: 'ADD_FIELD', entity: 'User', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Profile', line: 3 },
        { op: 'ADD_FIELD', entity: 'Profile', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'User', relationName: 'HAS_PROFILE', targetEntity: 'Profile', relationType: 'ONE_TO_ONE', line: 5 }
    ]
};
const o2oSql = CodeGenerator.generateSQL(o2oIR);

assertTrue('ONE_TO_ONE alters Profile table', o2oSql.includes('ALTER TABLE Profile ADD COLUMN user_id INT UNIQUE;'));
assertTrue('ONE_TO_ONE adds FK constraint on Profile', o2oSql.includes('FOREIGN KEY (user_id) REFERENCES User(id)'));


// ── Codegen Test 23: ONE_TO_MANY SQL ─────────────────────────
console.log('');
console.log('── Codegen Test 23: ONE_TO_MANY SQL ──');

const o2mIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Department', line: 1 },
        { op: 'ADD_FIELD', entity: 'Department', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Employee', line: 3 },
        { op: 'ADD_FIELD', entity: 'Employee', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Department', relationName: 'HAS_EMPLOYEES', targetEntity: 'Employee', relationType: 'ONE_TO_MANY', line: 5 }
    ]
};
const o2mSql = CodeGenerator.generateSQL(o2mIR);

assertTrue('ONE_TO_MANY alters Employee (many side)', o2mSql.includes('ALTER TABLE Employee ADD COLUMN department_id INT;'));
assertTrue('ONE_TO_MANY adds FK referencing Department(id)', o2mSql.includes('FOREIGN KEY (department_id) REFERENCES Department(id)'));


// ── Codegen Test 24: MANY_TO_ONE SQL ─────────────────────────
console.log('');
console.log('── Codegen Test 24: MANY_TO_ONE SQL ──');

const m2oIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Employee', line: 1 },
        { op: 'ADD_FIELD', entity: 'Employee', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_ENTITY', entity: 'Department', line: 3 },
        { op: 'ADD_FIELD', entity: 'Department', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 4 },
        { op: 'CREATE_RELATION', sourceEntity: 'Employee', relationName: 'BELONGS_TO', targetEntity: 'Department', relationType: 'MANY_TO_ONE', line: 5 }
    ]
};
const m2oSql = CodeGenerator.generateSQL(m2oIR);

assertTrue('MANY_TO_ONE alters Employee (many side)', m2oSql.includes('ALTER TABLE Employee ADD COLUMN department_id INT;'));
assertTrue('MANY_TO_ONE adds FK referencing Department(id)', m2oSql.includes('FOREIGN KEY (department_id) REFERENCES Department(id)'));


// ── Codegen Test 25: SQL Ordering (Entity tables before relationship statements) ──
console.log('');
console.log('── Codegen Test 25: SQL Ordering ──');

const studentPos = m2mSql.indexOf('CREATE TABLE Student');
const coursePos = m2mSql.indexOf('CREATE TABLE Course');
const junctionPos = m2mSql.indexOf('CREATE TABLE Student_Course');

assertTrue('Student table created before junction table', studentPos < junctionPos);
assertTrue('Course table created before junction table', coursePos < junctionPos);


// ── Codegen Test 26: Relationship Model Methods ──────────────
console.log('');
console.log('── Codegen Test 26: Relationship Model Methods ──');

const relList = [{ sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 5 }];
const entityList = [
    { name: 'Student', fields: [{ name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] }] },
    { name: 'Course', fields: [{ name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] }] }
];
const studentModelRel = CodeGenerator.generateModel('Student', [{ name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] }], relList, entityList);

assertTrue('StudentModel has getCourses', studentModelRel.includes('static async getCourses(studentId)'));
assertTrue('StudentModel has addCourse', studentModelRel.includes('static async addCourse(studentId, courseId)'));
assertTrue('StudentModel has removeCourse', studentModelRel.includes('static async removeCourse(studentId, courseId)'));
assertTrue('StudentModel join query in getCourses', studentModelRel.includes('FROM Course t JOIN Student_Course j ON t.id = j.course_id WHERE j.student_id = ?'));


// ── Codegen Test 27: Relationship Controller Methods ─────────
console.log('');
console.log('── Codegen Test 27: Relationship Controller Methods ──');

const studentCtrlRel = CodeGenerator.generateController('Student', relList);
assertTrue('Controller has getCourses', studentCtrlRel.includes('async function getCourses(req, res)'));
assertTrue('Controller has addCourse', studentCtrlRel.includes('async function addCourse(req, res)'));
assertTrue('Controller has removeCourse', studentCtrlRel.includes('async function removeCourse(req, res)'));
assertTrue('Controller exports relationship functions', studentCtrlRel.includes('getCourses') && studentCtrlRel.includes('addCourse') && studentCtrlRel.includes('removeCourse'));


// ── Codegen Test 28: Relationship Express Routes ─────────────
console.log('');
console.log('── Codegen Test 28: Relationship Express Routes ──');

const studentRoutesRel = CodeGenerator.generateRoutes('Student', relList);
assertTrue('Routes has GET /:id/courses', studentRoutesRel.includes("router.get('/:id/courses', studentController.getCourses);"));
assertTrue('Routes has POST /:id/courses/:courseId', studentRoutesRel.includes("router.post('/:id/courses/:courseId', studentController.addCourse);"));
assertTrue('Routes has DELETE /:id/courses/:courseId', studentRoutesRel.includes("router.delete('/:id/courses/:courseId', studentController.removeCourse);"));


// ── Codegen Test 29: Swagger with Relationships ──────────────
console.log('');
console.log('── Codegen Test 29: Swagger with Relationships ──');

const swaggerRelJson = CodeGenerator.generateSwagger(entityList, relList);
const swaggerRelObj = JSON.parse(swaggerRelJson);

assertTrue('Swagger has /students/{id}/courses path', Boolean(swaggerRelObj.paths['/students/{id}/courses']));
assertTrue('Swagger has GET on /students/{id}/courses', Boolean(swaggerRelObj.paths['/students/{id}/courses'].get));
assertTrue('Swagger response references Course schema', swaggerRelObj.paths['/students/{id}/courses'].get.responses['200'].content['application/json'].schema.items['$ref'] === '#/components/schemas/Course');
assertTrue('Swagger has /students/{id}/courses/{courseId} path', Boolean(swaggerRelObj.paths['/students/{id}/courses/{courseId}']));


// ── Codegen Test 30: Full Generation with Relationships ──────
console.log('');
console.log('── Codegen Test 30: Full Generation with Relationships ──');

const fullRelResult = CodeGenerator.generate(m2mIR, false);
assertTrue('Full generation succeeds with relationships', fullRelResult.success);
assertTrue('8 files generated for 2 entities', fullRelResult.files.length >= 8);
const fullSql = fullRelResult.files.find(f => f.path === 'database/schema.sql').content;
assertTrue('schema.sql includes Student_Course', fullSql.includes('Student_Course'));


// ── Codegen Test 31: Missing relationship entity in IR throws ──
console.log('');
console.log('── Codegen Test 31: Missing relationship entity in IR throws ──');

const badRelIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'NonExistent', relationType: 'MANY_TO_MANY', line: 3 }
    ]
};
assertThrows(
    'Throws error when relationship target entity missing in IR',
    () => CodeGenerator.generate(badRelIR, false),
    'Target entity \'NonExistent\' not found'
);


// ── Codegen Test 32: Existing entity CRUD without relations remains unchanged ──
console.log('');
console.log('── Codegen Test 32: Existing entity CRUD unchanged ──');

const plainGenResult = CodeGenerator.generate(testStudentIR, false);
assertTrue('Plain generation succeeds', plainGenResult.success);
const plainStudentModel = plainGenResult.files.find(f => f.path === 'models/Student.js').content;
assertTrue('Plain Student model has findAll', plainStudentModel.includes('static async findAll()'));
assertTrue('Plain Student model has findById', plainStudentModel.includes('static async findById(id)'));
assertTrue('Plain Student model has create', plainStudentModel.includes('static async create(data)'));
assertTrue('Plain Student model has update', plainStudentModel.includes('static async update(id, data)'));
assertTrue('Plain Student model has delete', plainStudentModel.includes('static async delete(id)'));



// ═════════════════════════════════════════════════════════════
// COMPILER API TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'other';

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Compiler API Tests                     ║');
console.log('╚══════════════════════════════════════════════╝');

// We test the API by importing the Express Router and
// calling route handlers directly with mock req/res objects.
// This avoids needing supertest or starting an HTTP server.

const compilerAPI = require('../src/api/compiler-api');

/**
 * Simulates an Express route handler call with mock req/res.
 * Looks up the route in the Express Router's internal stack
 * and calls the handler directly.
 */
function simulatePost(routePath, body) {
    return new Promise((resolve) => {
        const route = compilerAPI.stack.find(layer => {
            return layer.route && layer.route.path === routePath && layer.route.methods.post;
        });

        if (!route) {
            resolve({ error: 'Route not found' });
            return;
        }

        const handler = route.route.stack[0].handle;
        const req = { body: body || {} };
        const res = {
            _statusCode: 200,
            _data: null,
            status(code) { this._statusCode = code; return this; },
            json(data) { this._data = data; resolve(data); }
        };
        handler(req, res);
    });
}

// Wrap async tests in an IIFE so they work in CommonJS
(async () => {

// ── API Test 1: Valid Student DSL ───────────────────────────
console.log('');
console.log('── API Test 1: Valid Student DSL ──');

const apiTest1 = await simulatePost('/compile', {
    source: 'ENTITY Student\n\nid INT PRIMARY KEY\nname STRING REQUIRED\nemail STRING UNIQUE\nage INT\ncgpa FLOAT'
});

assertTrue('API returns success true', apiTest1.success === true);
assertTrue('API all phases passed', Object.values(apiTest1.phases).every(v => v === true));


// ── API Test 2: Invalid syntax ──────────────────────────────
console.log('');
console.log('── API Test 2: Invalid syntax ──');

const apiTest2 = await simulatePost('/compile', {
    source: 'ENTITY'  // Missing entity name
});

assertTrue('API returns success false for bad syntax', apiTest2.success === false);
assertTrue('API failure phase is parser', apiTest2.phase === 'parser');
assertTrue('API parser phase marked false', apiTest2.phases.parser === false);


// ── API Test 3: Semantic error ──────────────────────────────
console.log('');
console.log('── API Test 3: Semantic error ──');

const apiTest3 = await simulatePost('/compile', {
    source: 'ENTITY Student\n\nname STRING\nname INT'
});

assertTrue('API returns success false for semantic error', apiTest3.success === false);
assertTrue('API failure phase is semantic', apiTest3.phase === 'semantic');
assertTrue('API has semantic errors array', Array.isArray(apiTest3.errors) && apiTest3.errors.length > 0);
assertTrue('API error mentions duplicate', apiTest3.errors.some(e => e.message && e.message.toLowerCase().includes('duplicate')));


// ── API Test 4: Returned tokens ─────────────────────────────
console.log('');
console.log('── API Test 4: Returned tokens ──');

assertTrue('API returns tokens array', Array.isArray(apiTest1.tokens));
assertTrue('API tokens have correct structure', apiTest1.tokens[0].type === 'KEYWORD' && apiTest1.tokens[0].value === 'ENTITY');
assertTrue('API tokens include line/column', typeof apiTest1.tokens[0].line === 'number' && typeof apiTest1.tokens[0].column === 'number');


// ── API Test 5: Returned AST ────────────────────────────────
console.log('');
console.log('── API Test 5: Returned AST ──');

assertTrue('API returns AST object', apiTest1.ast && typeof apiTest1.ast === 'object');
assertTrue('API AST has entities array', Array.isArray(apiTest1.ast.entities));
assertTrue('API AST entity name is Student', apiTest1.ast.entities[0].name === 'Student');
assertTrue('API AST has 5 fields', apiTest1.ast.entities[0].fields.length === 5);


// ── API Test 6: Returned symbol table ───────────────────────
console.log('');
console.log('── API Test 6: Returned symbol table ──');

assertTrue('API returns symbolTable', apiTest1.symbolTable && typeof apiTest1.symbolTable === 'object');
assertTrue('API symbolTable has Student', 'Student' in apiTest1.symbolTable);
assertTrue('API symbolTable Student has fields', Object.keys(apiTest1.symbolTable.Student.fields).length === 5);


// ── API Test 7: Returned IR ─────────────────────────────────
console.log('');
console.log('── API Test 7: Returned IR ──');

assertTrue('API returns IR', apiTest1.ir && apiTest1.ir.type === 'PROGRAM');
assertTrue('API IR has instructions', Array.isArray(apiTest1.ir.instructions) && apiTest1.ir.instructions.length > 0);
assertTrue('API IR first instruction is CREATE_ENTITY', apiTest1.ir.instructions[0].op === 'CREATE_ENTITY');


// ── API Test 8: Returned optimized IR ───────────────────────
console.log('');
console.log('── API Test 8: Returned optimized IR ──');

assertTrue('API returns optimizedIR', apiTest1.optimizedIR && apiTest1.optimizedIR.type === 'PROGRAM');
assertTrue('API returns optimizations array', Array.isArray(apiTest1.optimizations));
assertTrue('API returns warnings array', Array.isArray(apiTest1.warnings));


// ── API Test 9: Returned generated files ────────────────────
console.log('');
console.log('── API Test 9: Returned generated files ──');

assertTrue('API returns generatedFiles array', Array.isArray(apiTest1.generatedFiles));
assertTrue('API has schema.sql', apiTest1.generatedFiles.some(f => f.path.includes('schema.sql')));
assertTrue('API has server.js', apiTest1.generatedFiles.some(f => f.path === 'server.js'));
assertTrue('API has Student.js model', apiTest1.generatedFiles.some(f => f.path.includes('Student.js')));
assertTrue('API has swagger.json', apiTest1.generatedFiles.some(f => f.path === 'swagger.json'));
assertTrue('API has config/db.js', apiTest1.generatedFiles.some(f => f.path === 'config/db.js'));
assertTrue('API files have content', apiTest1.generatedFiles.every(f => typeof f.content === 'string' && f.content.length > 0));


// ── API Test 10: Parser error line and column reporting ─────
console.log('');
console.log('── API Test 10: Parser error line & column extraction ──');

const apiTest10 = await simulatePost('/compile', {
    source: 'ENTITY Student\n\nid\nname STRING'
});

assertTrue('API parser error detected', apiTest10.success === false && apiTest10.phase === 'parser');
assertTrue('API parser error has line number', typeof apiTest10.errors[0].line === 'number' && apiTest10.errors[0].line >= 1);
assertTrue('API parser error has column number', typeof apiTest10.errors[0].column === 'number' && apiTest10.errors[0].column >= 1);


// ── API Test 11: Multiple semantic error lines ──────────────
console.log('');
console.log('── API Test 11: Multiple semantic error lines ──');

const apiTest11 = await simulatePost('/compile', {
    source: 'ENTITY Student\n\nid INT PRIMARY KEY\nid2 INT PRIMARY KEY\nname STRING\nname INT'
});

assertTrue('API multiple semantic errors detected', apiTest11.success === false && apiTest11.phase === 'semantic');
assertTrue('API reports multiple errors', apiTest11.errors && apiTest11.errors.length >= 2);
const errorLinesReported = apiTest11.errors.map(e => e.line).filter(Boolean);
assertTrue('API errors report affected lines (line 4 & 6)', errorLinesReported.includes(4) && errorLinesReported.includes(6));


// ── API Test 12: Compilation summary metrics calculation ────
console.log('');
console.log('── API Test 12: Compilation summary metrics ──');

const entitiesCount = apiTest1.ast.entities.length;
const fieldsCount = apiTest1.ast.entities.reduce((sum, e) => sum + e.fields.length, 0);
const optimizationsCount = apiTest1.optimizations.length;
const filesCount = apiTest1.generatedFiles.length;

assertTrue('Calculated entities count is 1', entitiesCount === 1);
assertTrue('Calculated fields count is 5', fieldsCount === 5);
assertTrue('Calculated optimizations count is 0', optimizationsCount === 0);
assertTrue('Calculated files count is 8', filesCount === 8);


// ── API Test 13: Phase statuses on compilation failure ──────
console.log('');
console.log('── API Test 13: Phase statuses on compilation failure ──');

assertTrue('Parser failure: lexer is true', apiTest2.phases.lexer === true);
assertTrue('Parser failure: parser is false', apiTest2.phases.parser === false);
assertTrue('Parser failure: semantic is false', apiTest2.phases.semantic === false);
assertTrue('Parser failure: codegen is false', apiTest2.phases.codegen === false);



// ═════════════════════════════════════════════════════════════
// SUMMARY (inside async IIFE so API test counts are included)
// ═════════════════════════════════════════════════════════════

console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  RESULTS BY PHASE');
console.log('──────────────────────────────────────────────────────');
console.log(`  Lexer tests:    ${lexerPassed} passed, ${lexerFailed} failed`);
console.log(`  Parser tests:   ${parserPassed} passed, ${parserFailed} failed`);
console.log(`  Semantic tests: ${semanticPassed} passed, ${semanticFailed} failed`);
console.log(`  IR tests:       ${irPassed} passed, ${irFailed} failed`);
console.log(`  Optimizer tests:${optimizerPassed} passed, ${optimizerFailed} failed`);
console.log(`  Codegen tests:  ${codegenPassed} passed, ${codegenFailed} failed`);
console.log(`  Other tests:    ${otherPassed} passed, ${otherFailed} failed`);
console.log('──────────────────────────────────────────────────────');
console.log(`  TOTAL:          ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('══════════════════════════════════════════════════════');

if (failed > 0) {
    process.exit(1);
}

})();
