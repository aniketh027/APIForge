/**
 * ============================================================
 * TEST RUNNER - APIForge Compiler Tests
 * ============================================================
 * 
 * This file contains tests for each phase of the compiler.
 * We use a simple custom test runner (no external libraries)
 * to keep things lightweight and educational.
 * 
 * Tests are organized by compiler phase, each with its own
 * pass/fail tally:
 *   1. Lexer tests
 *   2. Parser tests               (incl. "did you mean?" suggestions)
 *   3. Semantic analyzer tests    (incl. column info + suggestions)
 *   4. IR generator tests
 *   5. Optimizer tests
 *   6. Code generator tests
 *
 * Plus cross-cutting coverage tallied under "other":
 *   - Error-utility unit tests (src/utils/errors.js)
 *   - End-to-end pipeline tests (source string → generated SQL)
 *   - Sample-file coverage      (samples/*.apiforge)
 *   - REST API integration tests
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
// An empty source file (just EOF) is syntactically accepted — zero entities.

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


// ── Parser Regression Test: Entity followed by RELATION ──
console.log('');
console.log('── Parser Regression Test 1: Entity followed by RELATION ──');
const reg1_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY'
].join('\n');
const reg1_ast = lexAndParse(reg1_src);
assertEqual('Reg1: 2 entities parsed', reg1_ast.entities.length, 2);
assertEqual('Reg1: 1 relation parsed', reg1_ast.relations.length, 1);
assertEqual('Reg1: Student entity name', reg1_ast.entities[0].name, 'Student');
assertEqual('Reg1: Course entity name', reg1_ast.entities[1].name, 'Course');
assertEqual('Reg1: Relation name', reg1_ast.relations[0].name, 'ENROLLS_IN');

// ── Parser Regression Test: Entity followed immediately by RELATION ──
console.log('');
console.log('── Parser Regression Test 2: Entity followed immediately by RELATION ──');
const reg2_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'RELATION Student SOMETHING Course MANY_TO_MANY'
].join('\n');
const reg2_ast = lexAndParse(reg2_src);
assertEqual('Reg2: 1 entity parsed', reg2_ast.entities.length, 1);
assertEqual('Reg2: Student has 1 field', reg2_ast.entities[0].fields.length, 1);
assertEqual('Reg2: 1 relation parsed', reg2_ast.relations.length, 1);
assertEqual('Reg2: Relation source is Student', reg2_ast.relations[0].sourceEntity, 'Student');
assertEqual('Reg2: Relation name is SOMETHING', reg2_ast.relations[0].name, 'SOMETHING');
assertEqual('Reg2: Relation target is Course', reg2_ast.relations[0].targetEntity, 'Course');

// ── Parser Regression Test: Multiple entities followed by multiple relationships ──
console.log('');
console.log('── Parser Regression Test 3: Multiple entities and multiple relationships ──');
const reg3_src = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    'title STRING REQUIRED',
    '',
    'ENTITY Department',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    '',
    'RELATION Student ENROLLS_IN Course MANY_TO_MANY',
    'RELATION Course OFFERED_BY Department MANY_TO_ONE'
].join('\n');
const reg3_ast = lexAndParse(reg3_src);
assertEqual('Reg3: 3 entities parsed', reg3_ast.entities.length, 3);
assertEqual('Reg3: 2 relations parsed', reg3_ast.relations.length, 2);
assertEqual('Reg3: Rel 1 is ENROLLS_IN', reg3_ast.relations[0].name, 'ENROLLS_IN');
assertEqual('Reg3: Rel 2 is OFFERED_BY', reg3_ast.relations[1].name, 'OFFERED_BY');

// ── Parser Regression Test: Complex field modifiers followed by RELATION ──
console.log('');
console.log('── Parser Regression Test 4: Complex fields and modifiers followed by RELATION ──');
const reg4_src = [
    'ENTITY STUDENT',
    '',
    'student_id INT PRIMARY KEY',
    'first_name STRING',
    'last_name STRING',
    'age INT MIN 10 MAX 18',
    '',
    'ENTITY COURSE',
    '',
    'course_id INT PRIMARY KEY',
    'title STRING REQUIRED',
    '',
    'RELATION STUDENT ENROLLS_IN COURSE MANY_TO_MANY'
].join('\n');
const reg4_ast = lexAndParse(reg4_src);
assertEqual('Reg4: 2 entities parsed', reg4_ast.entities.length, 2);
assertEqual('Reg4: STUDENT has 4 fields', reg4_ast.entities[0].fields.length, 4);
assertEqual('Reg4: COURSE has 2 fields', reg4_ast.entities[1].fields.length, 2);
assertEqual('Reg4: 1 relation parsed', reg4_ast.relations.length, 1);
assertEqual('Reg4: Relation name', reg4_ast.relations[0].name, 'ENROLLS_IN');


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


// ── Semantic Test: Programs require at least one ENTITY ─────

console.log('');
console.log('── Semantic Test: Programs require at least one ENTITY ──');

const noEntitySources = [
    ['empty', ''],
    ['whitespace-only', ' \t\r\n  '],
    ['comment-only', '// no entities']
];

for (const [label, source] of noEntitySources) {
    const result = lexParseAnalyze(source);
    assertTrue(`${label} program fails semantic analysis`, !result.valid);
    assertEqual(`${label} program error code`, result.errors[0].code, 'MISSING_ENTITY_DECLARATION');
    assertEqual(`${label} program user-facing message`, result.errors[0].userMessage,
        'APIForge programs must contain at least one ENTITY.');
}

const singleEntity = lexParseAnalyze('ENTITY Only\nid INT');
assertTrue('Single-entity program remains valid', singleEntity.valid);


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

const emptyProgramAst = lexAndParse('');
const emptyProgramSem = SemanticAnalyzer.analyze(emptyProgramAst);
assertThrows(
    'Empty program cannot proceed from semantics to IR',
    () => IRGenerator.generate(emptyProgramAst, emptyProgramSem),
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
assertTrue('Optimization warning logged for conflict', opt4.warnings.length === 1 && opt4.warnings[0].message.includes('Optimization Conflict'));


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
assertTrue('Optimization warning emitted for conflicting relation type', opt17.warnings.some(w => w.message.includes('conflicting relation types')));


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
assertTrue('Optimization warning emitted for conflicting endpoints', opt18.warnings.some(w => w.message.includes('conflicting endpoint definitions')));


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
assertTrue('Model contains findAll', studentModel.includes('static async findAll(options = {})'));


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
assertTrue('Contains config/db.js', filePaths.includes('config/db.js'));
assertTrue('Contains .env.example', filePaths.includes('.env.example'));
assertTrue('Contains Student.js model', filePaths.includes('models/Student.js'));
assertTrue('Contains studentController.js', filePaths.includes('controllers/studentController.js'));
assertTrue('Contains studentRoutes.js', filePaths.includes('routes/studentRoutes.js'));
assertTrue('Contains server.js', filePaths.includes('server.js'));
assertTrue('Contains swagger.json', filePaths.includes('swagger.json'));
assertTrue('Contains generated package.json', filePaths.includes('package.json'));
assertTrue('Contains generated README.md', filePaths.includes('README.md'));

const generatedPackageContent = genResult.files.find(f => f.path === 'package.json').content;
const generatedPackage = JSON.parse(generatedPackageContent);
assertEqual('Generated package start script runs server.js', generatedPackage.scripts.start, 'node server.js');
assertEqual('Generated package declares exactly 3 runtime dependencies', Object.keys(generatedPackage.dependencies).length, 3);
assertEqual('Generated package declares dotenv version used by APIForge', generatedPackage.dependencies.dotenv, require('../package.json').dependencies.dotenv);
assertEqual('Generated package declares express version used by APIForge', generatedPackage.dependencies.express, require('../package.json').dependencies.express);
assertEqual('Generated package declares mysql2 version used by APIForge', generatedPackage.dependencies.mysql2, require('../package.json').dependencies.mysql2);
assertTrue('Generated package has no dev dependencies', !('devDependencies' in generatedPackage));

const generatedReadmeContent = genResult.files.find(f => f.path === 'README.md').content;
assertTrue('Generated README documents npm install', generatedReadmeContent.includes('npm install'));
assertTrue('Generated README documents .env.example', generatedReadmeContent.includes('.env.example'));
assertTrue('Generated README documents schema import', generatedReadmeContent.includes('database/schema.sql'));
assertTrue('Generated README labels shell schema import', generatedReadmeContent.includes('Command Prompt, Git Bash, or a Unix shell'));
assertTrue('Generated README provides PowerShell schema import', generatedReadmeContent.includes('mysql.exe -u root -p apiforge_db -e "source database/schema.sql"'));
assertTrue('Generated README documents npm start', generatedReadmeContent.includes('npm start'));
assertTrue('Generated README documents mounted student route', generatedReadmeContent.includes('`/students`'));
assertTrue('Generated README locates swagger.json', generatedReadmeContent.includes('`swagger.json`'));


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
assertTrue('dbConfig creates pool with DB_PORT', dbConfigContent.includes('Number(process.env.DB_PORT) || 3306'));

const envExampleContent = CodeGenerator.generateEnvExample();
assertTrue('envExample contains DB_NAME', envExampleContent.includes('DB_NAME=apiforge_db'));
assertTrue('envExample contains DB_PORT', envExampleContent.includes('DB_PORT=3306'));
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
assertEqual('13 files generated for 2 entities', fullRelResult.files.length, 13);
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
assertTrue('Plain Student model has findAll', plainStudentModel.includes('static async findAll(options = {})'));
assertTrue('Plain Student model has findById', plainStudentModel.includes('static async findById(id)'));
assertTrue('Plain Student model has create', plainStudentModel.includes('static async create(data)'));
assertTrue('Plain Student model has update', plainStudentModel.includes('static async update(id, data)'));
assertTrue('Plain Student model has delete', plainStudentModel.includes('static async delete(id)'));

// ── Codegen Test: MySQL reserved word backtick quoting ──
console.log('');
console.log('── Codegen Test: MySQL reserved word backtick quoting ──');
const orderIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Order', line: 1 },
        { op: 'ADD_FIELD', entity: 'Order', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], line: 2 },
        { op: 'ADD_FIELD', entity: 'Order', field: 'group', dataType: 'STRING', constraints: [], line: 3 },
        { op: 'ADD_FIELD', entity: 'Order', field: 'key', dataType: 'INT', constraints: [], line: 4 }
    ]
};
const orderSql = CodeGenerator.generateSQL(orderIR);
assertTrue('Reserved word table Order quoted with backticks', orderSql.includes('CREATE TABLE `Order` ('));
assertTrue('Reserved word column group quoted with backticks', orderSql.includes('`group` VARCHAR(255)'));
assertTrue('Reserved word column key quoted with backticks', orderSql.includes('`key` INT'));

// ── Codegen Test: Auto-inject PK when missing ──
console.log('');
console.log('── Codegen Test: Auto-inject PK when missing ──');
const noPkIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Item', line: 1 },
        { op: 'ADD_FIELD', entity: 'Item', field: 'title', dataType: 'STRING', constraints: ['REQUIRED'], line: 2 }
    ]
};
const noPkSql = CodeGenerator.generateSQL(noPkIR);
assertTrue('Auto-injected id PK column', noPkSql.includes('id INT PRIMARY KEY AUTO_INCREMENT'));

// ── Codegen Test: OpenAPI 3.0 path parameters and required fields ──
console.log('');
console.log('── Codegen Test: OpenAPI 3.0 path parameters and required ──');
const swaggerGenerated = JSON.parse(CodeGenerator.generateSwagger([
    {
        name: 'Student',
        fields: [
            { name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] },
            { name: 'name', dataType: 'STRING', constraints: ['REQUIRED'] }
        ]
    }
]));
assertTrue('Path /students/{id} has parameters', Array.isArray(swaggerGenerated.paths['/students/{id}'].parameters));
assertEqual('Path parameter name is id', swaggerGenerated.paths['/students/{id}'].parameters[0].name, 'id');
assertEqual('Path parameter in is path', swaggerGenerated.paths['/students/{id}'].parameters[0].in, 'path');
assertEqual('INT primary key path parameter type is integer', swaggerGenerated.paths['/students/{id}'].parameters[0].schema.type, 'integer');
assertTrue('Schema has required array', Array.isArray(swaggerGenerated.components.schemas.Student.required));
assertTrue('Schema required includes name', swaggerGenerated.components.schemas.Student.required.includes('name'));

// ── Codegen Test: OpenAPI path parameters follow entity PK types ──
console.log('');
console.log('── Codegen Test: OpenAPI primary-key path parameter types ──');
const mixedPkSwagger = JSON.parse(CodeGenerator.generateSwagger([
    {
        name: 'IntEntity',
        fields: [
            { name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] },
            { name: 'name', dataType: 'STRING', constraints: [] }
        ]
    },
    {
        name: 'StringEntity',
        fields: [
            { name: 'code', dataType: 'STRING', constraints: ['PRIMARY_KEY'] },
            { name: 'name', dataType: 'STRING', constraints: [] }
        ]
    }
], [
    { sourceEntity: 'IntEntity', relationName: 'LINKS', targetEntity: 'StringEntity', relationType: 'MANY_TO_MANY' },
    { sourceEntity: 'StringEntity', relationName: 'OWNS', targetEntity: 'IntEntity', relationType: 'ONE_TO_MANY' }
]));
const intCrudPath = mixedPkSwagger.paths['/intentities/{id}'];
const stringCrudPath = mixedPkSwagger.paths['/stringentities/{id}'];
assertEqual('INT PK CRUD path parameter type is integer', intCrudPath.parameters[0].schema.type, 'integer');
assertEqual('STRING PK CRUD path parameter type is string', stringCrudPath.parameters[0].schema.type, 'string');
assertTrue('STRING PK path parameter applies to GET, PUT, and DELETE', Boolean(stringCrudPath.get && stringCrudPath.put && stringCrudPath.delete));
assertEqual('Relationship source INT PK parameter type is integer', mixedPkSwagger.paths['/intentities/{id}/stringentities'].parameters[0].schema.type, 'integer');
assertEqual('Relationship source STRING PK parameter type is string', mixedPkSwagger.paths['/stringentities/{id}/intentities'].parameters[0].schema.type, 'string');
const mixedRelationshipParams = mixedPkSwagger.paths['/intentities/{id}/stringentities/{stringEntityId}'].parameters;
assertEqual('Relationship source parameter name remains id', mixedRelationshipParams[0].name, 'id');
assertEqual('Relationship target parameter name identifies StringEntity', mixedRelationshipParams[1].name, 'stringEntityId');
assertEqual('Relationship target STRING PK parameter type is string', mixedRelationshipParams[1].schema.type, 'string');

const implicitPkResult = e2eCompile('ENTITY ImplicitEntity\nname STRING');
assertTrue('Entity without explicit PK compiles successfully', implicitPkResult.valid);
const implicitPkSwaggerFile = implicitPkResult.files.find(f => f.path === 'swagger.json');
assertTrue('Entity without explicit PK generates swagger.json', Boolean(implicitPkSwaggerFile));
const implicitPkSwagger = JSON.parse(implicitPkSwaggerFile.content);
assertEqual('Implicit PK CRUD path parameter type is integer', implicitPkSwagger.paths['/implicitentities/{id}'].parameters[0].schema.type, 'integer');

// ── Codegen Test: Model update handles empty payload ──
console.log('');
console.log('── Codegen Test: Model update handles empty payload ──');
assertTrue('Model update guards empty data', plainStudentModel.includes('if (!data || Object.keys(data).length === 0)'));



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
            json(data) { data._statusCode = this._statusCode; this._data = data; resolve(data); }
        };
        handler(req, res);
    });
}

function simulateGet(routePath) {
    return new Promise((resolve) => {
        const route = compilerAPI.stack.find(layer => {
            return layer.route && layer.route.path === routePath && layer.route.methods.get;
        });
        if (!route) {
            resolve({ error: 'Route not found' });
            return;
        }
        const handler = route.route.stack[0].handle;
        const req = {};
        const res = {
            _statusCode: 200,
            _data: null,
            status(code) { this._statusCode = code; return this; },
            json(data) { data._statusCode = this._statusCode; this._data = data; resolve(data); }
        };
        handler(req, res);
    });
}

// ═════════════════════════════════════════════════════════════
// ERROR-UTILITIES, SUGGESTIONS, POSITION INFO & END-TO-END TESTS
// (added when hardening the compiler — error messages + coverage)
// ═════════════════════════════════════════════════════════════

const ErrUtil = require('../src/utils/errors');
const nodeFs = require('fs');
const nodePath = require('path');
const nodeOs = require('os');
const { spawnSync } = require('child_process');

const DT_CANDIDATES = ['INT', 'STRING', 'FLOAT', 'BOOLEAN'];
const RT_CANDIDATES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'];

/** Run the full 6-phase pipeline in-process (no disk writes). */
function e2eCompile(src) {
    const ast = lexAndParse(src);
    const sem = SemanticAnalyzer.analyze(ast);
    if (!sem.valid) {
        return { valid: false, errors: sem.errors, schema: '', files: [] };
    }
    const ir = IRGenerator.generate(ast, sem);
    const opt = Optimizer.optimize(ir);
    const gen = CodeGenerator.generate(opt.ir, false);
    const schemaFile = gen.files.find(f => f.path === 'database/schema.sql');
    return { valid: true, errors: [], schema: schemaFile ? schemaFile.content : '', files: gen.files };
}

/** Capture a thrown error message (or '' if nothing thrown). */
function captureThrow(fn) {
    try { fn(); return ''; } catch (e) { return e.message; }
}

// ── errors.js: levenshtein ──────────────────────────────────
currentPhase = 'other';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Error-Utilities Tests (errors.js)      ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('── errors.js: levenshtein ──');

assertEqual('levenshtein identical is 0',        ErrUtil.levenshtein('STRING', 'STRING'), 0);
assertEqual('levenshtein one substitution is 1', ErrUtil.levenshtein('STRING', 'STRIMG'), 1);
assertEqual('levenshtein rel-type typo is 1',    ErrUtil.levenshtein('MANY_TO_MANY', 'MANY_TO_MANU'), 1);
assertEqual('levenshtein empty vs abc is 3',     ErrUtil.levenshtein('', 'abc'), 3);
assertEqual('levenshtein kitten/sitting is 3',   ErrUtil.levenshtein('kitten', 'sitting'), 3);
assertTrue('levenshtein VARCHAR vs STRING > 2',  ErrUtil.levenshtein('VARCHAR', 'STRING') > 2);

// ── errors.js: suggestClosest ───────────────────────────────
console.log('');
console.log('── errors.js: suggestClosest ──');

assertEqual('suggestClosest STRIMG -> STRING',       ErrUtil.suggestClosest('STRIMG', DT_CANDIDATES), 'STRING');
assertEqual('suggestClosest MANY_TO_MANU -> MANY_TO_MANY', ErrUtil.suggestClosest('MANY_TO_MANU', RT_CANDIDATES), 'MANY_TO_MANY');
assertEqual('suggestClosest VARCHAR -> null (far)',  ErrUtil.suggestClosest('VARCHAR', DT_CANDIDATES), null);
assertEqual('suggestClosest INVALID -> null (far)',  ErrUtil.suggestClosest('INVALID', RT_CANDIDATES), null);
assertEqual('suggestClosest Studet -> Student',      ErrUtil.suggestClosest('Studet', ['Student', 'Course']), 'Student');
assertEqual('suggestClosest empty candidates -> null', ErrUtil.suggestClosest('anything', []), null);

// ── errors.js: didYouMeanSuffix ─────────────────────────────
console.log('');
console.log('── errors.js: didYouMeanSuffix ──');

assertEqual('didYouMeanSuffix near-miss phrase', ErrUtil.didYouMeanSuffix('STRIMG', DT_CANDIDATES), " Did you mean 'STRING'?");
assertEqual('didYouMeanSuffix far -> empty',     ErrUtil.didYouMeanSuffix('VARCHAR', DT_CANDIDATES), '');
assertEqual('didYouMeanSuffix exact -> empty',   ErrUtil.didYouMeanSuffix('STRING', DT_CANDIDATES), '');

// ── errors.js: formatCodeFrame ──────────────────────────────
console.log('');
console.log('── errors.js: formatCodeFrame ──');

const feFrame = ErrUtil.formatCodeFrame('a\nname INT\nb', 2, 1);
assertTrue('formatCodeFrame shows the source line', feFrame.includes('name INT'));
assertTrue('formatCodeFrame draws a caret',         feFrame.includes('^'));
assertEqual('formatCodeFrame out-of-range -> empty', ErrUtil.formatCodeFrame('one line', 5, 1), '');
assertEqual('formatCodeFrame line 0 -> empty',       ErrUtil.formatCodeFrame('one line', 0, 1), '');
const feCol = ErrUtil.formatCodeFrame('name INT', 1, 6, 1);
assertTrue('formatCodeFrame positions caret at column', feCol.includes('name INT') && feCol.includes('^'));
assertEqual('formatCodeFrame without column shows line only', ErrUtil.formatCodeFrame('name INT', 1), '1 | name INT');

// ── Parser: "did you mean?" suggestions ─────────────────────
currentPhase = 'parser';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Parser Suggestion Tests                ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('── Parser: datatype typo suggestion ──');

assertThrows('Datatype typo still says Expected DATATYPE',
    () => lexAndParse('ENTITY Student\nname STRIMG'),
    'Expected DATATYPE');
assertThrows('Datatype typo suggests STRING',
    () => lexAndParse('ENTITY Student\nname STRIMG'),
    "Did you mean 'STRING'?");

console.log('');
console.log('── Parser: relation-type typo suggestion ──');

const relTypoSrc = 'ENTITY A\nid INT PRIMARY KEY\n\nENTITY B\nid INT PRIMARY KEY\n\nRELATION A CONNECTS B MANY_TO_MANU';
assertThrows('Relation-type typo still says Expected RELATION_TYPE',
    () => lexAndParse(relTypoSrc),
    'Expected RELATION_TYPE');
assertThrows('Relation-type typo suggests MANY_TO_MANY',
    () => lexAndParse(relTypoSrc),
    "Did you mean 'MANY_TO_MANY'?");

console.log('');
console.log('── Parser: no suggestion for far-off tokens ──');

const varcharMsg = captureThrow(() => lexAndParse('ENTITY Student\nname VARCHAR'));
assertTrue('VARCHAR reports Expected DATATYPE', varcharMsg.includes('Expected DATATYPE'));
assertTrue('VARCHAR offers no suggestion',      !varcharMsg.includes('Did you mean'));

const charMsg = captureThrow(() => lexAndParse('ENTITY Student\nname CHAR'));
assertTrue('CHAR offers no suggestion', !charMsg.includes('Did you mean'));

const relInvalidSrc = 'ENTITY A\nid INT PRIMARY KEY\n\nENTITY B\nid INT PRIMARY KEY\n\nRELATION A CONNECTS B INVALID';
const relInvalidMsg = captureThrow(() => lexAndParse(relInvalidSrc));
assertTrue('INVALID rel-type reports Expected RELATION_TYPE', relInvalidMsg.includes('Expected RELATION_TYPE'));
assertTrue('INVALID rel-type offers no suggestion',           !relInvalidMsg.includes('Did you mean'));

// ── Semantic: column info + entity-name suggestions ─────────
currentPhase = 'semantic';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Semantic Position & Suggestion Tests   ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('── Semantic: errors carry a column ──');

const dupFieldRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\nname INT');
const dupFieldErr = dupFieldRes.errors.find(e => e.message.includes("Duplicate field 'name'"));
assertTrue('Duplicate-field error exists',            !!dupFieldErr);
assertTrue('Duplicate-field error carries numeric column', dupFieldErr && typeof dupFieldErr.column === 'number' && dupFieldErr.column >= 1);

const missingTargetRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nRELATION Student ENROLLS_IN Course MANY_TO_MANY');
const missingTargetErr = missingTargetRes.errors.find(e => e.message.includes("Target entity 'Course'"));
assertTrue('Missing-target error exists',             !!missingTargetErr);
assertTrue('Missing-target error carries numeric column', missingTargetErr && typeof missingTargetErr.column === 'number' && missingTargetErr.column >= 1);

const pkTypeRes = lexParseAnalyze('ENTITY Item\nid FLOAT PRIMARY KEY');
const pkTypeErr = pkTypeRes.errors.find(e => e.message.includes('requires INT or STRING'));
assertTrue('PK-type error exists',                    !!pkTypeErr);
assertTrue('PK-type error carries numeric column',    pkTypeErr && typeof pkTypeErr.column === 'number' && pkTypeErr.column >= 1);

const selfRelRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nRELATION Student LIKES Student ONE_TO_ONE');
const selfRelErr = selfRelRes.errors.find(e => e.message.includes('Self-referential'));
assertTrue('Self-referential error exists',           !!selfRelErr);
assertTrue('Self-referential error carries numeric column', selfRelErr && typeof selfRelErr.column === 'number' && selfRelErr.column >= 1);

// Defensive invalid-type path (parser blocks bad types, so build AST directly)
const badTypeProg = new ProgramNode();
const badTypeEnt = new EntityNode('Widget', 1, 8);
badTypeEnt.fields.push(new FieldNode('label', 'VARCHAR', [], 2, 1, 7));
badTypeProg.entities.push(badTypeEnt);
const badTypeSem = SemanticAnalyzer.analyze(badTypeProg);
const badTypeErr = badTypeSem.errors.find(e => e.message.includes("Invalid data type 'VARCHAR'"));
assertTrue('Invalid-type error exists',               !!badTypeErr);
assertEqual('Invalid-type error uses the type column', badTypeErr && badTypeErr.column, 7);
assertTrue('Invalid-type error offers no suggestion (VARCHAR far)', badTypeErr && !badTypeErr.message.includes('Did you mean'));

console.log('');
console.log('── Semantic: entity-name "did you mean?" ──');

const srcTypoRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nRELATION Studet ENROLLS_IN Student ONE_TO_MANY');
assertTrue('Undeclared source near-miss suggests Student',
    srcTypoRes.errors.some(e => e.message.includes("Source entity 'Studet'") && e.message.includes("Did you mean 'Student'?")));

const tgtTypoRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\n\nENTITY Course\nid INT PRIMARY KEY\n\nRELATION Course LINKS Studet MANY_TO_MANY');
assertTrue('Undeclared target near-miss suggests Student',
    tgtTypoRes.errors.some(e => e.message.includes("Target entity 'Studet'") && e.message.includes("Did you mean 'Student'?")));

const farMissRes = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nRELATION Student ENROLLS_IN GhostCourse MANY_TO_MANY');
assertTrue('Far-off target reports does-not-exist',
    farMissRes.errors.some(e => e.message.includes("Target entity 'GhostCourse'") && e.message.includes('does not exist')));
assertTrue('Far-off target offers no suggestion',
    farMissRes.errors.every(e => !e.message.includes('Did you mean')));

// ── End-to-end: full pipeline SQL generation ────────────────
currentPhase = 'codegen';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       End-to-End Pipeline Tests              ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('── E2E: MANY_TO_MANY junction table ──');

const mnRes = e2eCompile('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nENTITY Course\nid INT PRIMARY KEY\ntitle STRING REQUIRED\n\nRELATION Student ENROLLS_IN Course MANY_TO_MANY');
assertTrue('E2E M:N pipeline is valid',           mnRes.valid);
assertTrue('E2E M:N has Student table',           mnRes.schema.includes('CREATE TABLE Student ('));
assertTrue('E2E M:N has AUTO_INCREMENT PK',       mnRes.schema.includes('id INT PRIMARY KEY AUTO_INCREMENT'));
assertTrue('E2E M:N maps STRING to VARCHAR(255)', mnRes.schema.includes('name VARCHAR(255) NOT NULL'));
assertTrue('E2E M:N creates junction table',      mnRes.schema.includes('CREATE TABLE Student_Course ('));
assertTrue('E2E M:N junction composite PK',       mnRes.schema.includes('PRIMARY KEY (student_id, course_id)'));
assertTrue('E2E M:N junction FK source CASCADE',  mnRes.schema.includes('FOREIGN KEY (student_id) REFERENCES Student(id) ON DELETE CASCADE'));
assertTrue('E2E M:N junction FK target CASCADE',  mnRes.schema.includes('FOREIGN KEY (course_id) REFERENCES Course(id) ON DELETE CASCADE'));
assertEqual('E2E M:N generates 13 files',         mnRes.files.length, 13);

console.log('');
console.log('── E2E: ONE_TO_MANY foreign key ──');

const onRes = e2eCompile('ENTITY Department\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nENTITY Employee\nid INT PRIMARY KEY\nname STRING REQUIRED\n\nRELATION Department HAS Employee ONE_TO_MANY');
assertTrue('E2E 1:N pipeline is valid',       onRes.valid);
assertTrue('E2E 1:N adds FK column on many side', onRes.schema.includes('ALTER TABLE Employee ADD COLUMN department_id INT;'));
assertTrue('E2E 1:N FK references source',     onRes.schema.includes('REFERENCES Department(id)'));
assertTrue('E2E 1:N uses ON DELETE SET NULL',  onRes.schema.includes('ON DELETE SET NULL'));
assertTrue('E2E 1:N names the FK constraint',  onRes.schema.includes('fk_employee_department'));

console.log('');
console.log('── E2E: BOOLEAN data type mapping ──');

const boolRes = e2eCompile('ENTITY Flag\nid INT PRIMARY KEY\nactive BOOLEAN');
assertTrue('E2E BOOLEAN pipeline is valid', boolRes.valid);
assertTrue('E2E BOOLEAN maps to BOOLEAN',   boolRes.schema.includes('active BOOLEAN'));

console.log('');
console.log('── E2E: single-entity file count ──');

const singleRes = e2eCompile('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED');
assertTrue('E2E single-entity pipeline is valid', singleRes.valid);
assertEqual('E2E single entity generates 10 files', singleRes.files.length, 10);

// ── Sample-file coverage ────────────────────────────────────
currentPhase = 'other';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       Sample File Coverage Tests             ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('── Samples: documented behavior ──');

function readSample(name) {
    return nodeFs.readFileSync(nodePath.join(__dirname, '..', 'samples', name), 'utf-8');
}

const studentSampleRes = e2eCompile(readSample('student.apiforge'));
assertTrue('sample student.apiforge compiles clean', studentSampleRes.valid);
assertTrue('sample student.apiforge builds Student table', studentSampleRes.schema.includes('CREATE TABLE Student ('));
assertEqual('sample student.apiforge generates 10 files', studentSampleRes.files.length, 10);

const relSampleRes = e2eCompile(readSample('student_course_rel.apiforge'));
assertTrue('sample student_course_rel.apiforge compiles clean', relSampleRes.valid);
assertTrue('sample student_course_rel.apiforge builds junction table', relSampleRes.schema.includes('CREATE TABLE Student_Course ('));

const valSampleRes = e2eCompile(readSample('student_validation.apiforge'));
assertTrue('sample student_validation.apiforge compiles clean', valSampleRes.valid);
assertTrue('sample student_validation.apiforge has CHECK age', valSampleRes.schema.includes('CHECK (age >= 18 AND age <= 60)'));
assertTrue('sample student_validation.apiforge has DEFAULT 25', valSampleRes.schema.includes('DEFAULT 25'));
assertTrue('sample student_validation.apiforge has DEFAULT active', valSampleRes.schema.includes("DEFAULT 'active'"));

const o2oSampleRes = e2eCompile(readSample('one_to_one.apiforge'));
assertTrue('sample one_to_one.apiforge compiles clean', o2oSampleRes.valid);
assertTrue('sample one_to_one.apiforge alters Profile table', o2oSampleRes.schema.includes('ALTER TABLE Profile ADD COLUMN user_id INT UNIQUE;'));

const o2mSampleRes = e2eCompile(readSample('one_to_many.apiforge'));
assertTrue('sample one_to_many.apiforge compiles clean', o2mSampleRes.valid);
assertTrue('sample one_to_many.apiforge alters Employee table', o2mSampleRes.schema.includes('ALTER TABLE Employee ADD COLUMN department_id INT;'));

// ── Syntax validation: vm.Script parses all generated JS files without error ──
console.log('');
console.log('── Syntax Validation: vm.Script verifies generated JS ──');
const vm = require('vm');
const allGeneratedJs = [
    ...studentSampleRes.files,
    ...relSampleRes.files,
    ...valSampleRes.files,
    ...o2oSampleRes.files,
    ...o2mSampleRes.files
].filter(f => f.path.endsWith('.js'));

let allJsValid = true;
let syntaxErrorMsg = '';
for (const jsFile of allGeneratedJs) {
    try {
        new vm.Script(jsFile.content, { filename: jsFile.path });
    } catch (syntaxErr) {
        allJsValid = false;
        syntaxErrorMsg = `${jsFile.path}: ${syntaxErr.message}`;
        break;
    }
}
assertTrue(`Generated JS files pass vm.Script syntax validation (${allGeneratedJs.length} files checked)`, allJsValid);
assertEqual('No syntax errors in generated code', syntaxErrorMsg, '');

const dupSampleSem = lexParseAnalyze(readSample('dup_rel.apiforge'));
assertTrue('sample dup_rel.apiforge fails semantics', !dupSampleSem.valid);
assertTrue('sample dup_rel.apiforge reports duplicate relationship',
    dupSampleSem.errors.some(e => e.message.includes("Duplicate relationship 'ENROLLS_IN'")));

const invalidSampleSem = lexParseAnalyze(readSample('invalid_rel.apiforge'));
assertTrue('sample invalid_rel.apiforge fails semantics', !invalidSampleSem.valid);
assertTrue('sample invalid_rel.apiforge reports missing target entity',
    invalidSampleSem.errors.some(e => e.message.includes("Target entity 'Course'") && e.message.includes('does not exist')));

// ── Lexer Hardening: Negative numbers & UTF-8 BOM ──
currentPhase = 'lexer';
console.log('');
console.log('── Lexer: Negative numbers & BOM handling ──');
const bomTokens = Lexer.tokenize('\uFEFFENTITY Test\nid INT PRIMARY KEY');
assertEqual('BOM stripped cleanly', bomTokens[0].value, 'ENTITY');

const negTokens = Lexer.tokenize('ENTITY Temperature\nreading FLOAT DEFAULT -15.5\nminVal INT MIN -40 MAX -1');
const negReading = negTokens.find(t => t.type === 'NUMBER' && t.value === '-15.5');
const negMin = negTokens.find(t => t.type === 'NUMBER' && t.value === '-40');
const negMax = negTokens.find(t => t.type === 'NUMBER' && t.value === '-1');
assertTrue('Negative float parsed', !!negReading);
assertTrue('Negative int min parsed', !!negMin);
assertTrue('Negative int max parsed', !!negMax);

// Reset phase for the API tests that follow.
currentPhase = 'other';

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
assertTrue('API has generated package.json', apiTest1.generatedFiles.some(f => f.path === 'package.json'));
assertTrue('API has generated README.md', apiTest1.generatedFiles.some(f => f.path === 'README.md'));
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
assertTrue('Calculated files count is 10', filesCount === 10);


// ── API Test 13: Phase statuses on compilation failure ──────
console.log('');
console.log('── API Test 13: Phase statuses on compilation failure ──');

assertTrue('Parser failure: lexer is true', apiTest2.phases.lexer === true);
assertTrue('Parser failure: parser is false', apiTest2.phases.parser === false);
assertTrue('Parser failure: semantic is false', apiTest2.phases.semantic === false);
assertTrue('Parser failure: codegen is false', apiTest2.phases.codegen === false);


// ═════════════════════════════════════════════════════════════
// USER-FACING PARSER ERROR TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'parser';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       User-Facing Parser Error Tests         ║');
console.log('╚══════════════════════════════════════════════╝');

// ── User-Facing Test 1: Missing datatype at EOF ──────────────
console.log('');
console.log('── User-Facing: Missing field datatype at EOF ──');

let errMissingType = null;
try {
    lexAndParse('ENTITY Student\n\nid INT PRIMARY KEY\nname');
} catch (e) {
    errMissingType = e;
}

assertTrue('Missing datatype throws error', !!errMissingType);
assertEqual('Missing datatype error code', errMissingType.code, 'MISSING_DATATYPE');
assertEqual('Missing datatype line is 4', errMissingType.line, 4);
assertEqual('Missing datatype column is 5', errMissingType.column, 5);
assertEqual('Missing datatype userMessage', errMissingType.userMessage, "Missing data type for field 'name'.\nExpected one of: INT, STRING, FLOAT, BOOLEAN, ENUM.");
assertTrue('Missing datatype contains Expected DATATYPE for compatibility', errMissingType.message.includes('Expected DATATYPE'));

// ── User-Facing Test 2: Missing KEY after PRIMARY at EOF ─────
console.log('');
console.log('── User-Facing: Missing KEY after PRIMARY at EOF ──');

let errMissingKey = null;
try {
    lexAndParse('ENTITY Student\nid INT PRIMARY');
} catch (e) {
    errMissingKey = e;
}

assertTrue('Missing KEY throws error', !!errMissingKey);
assertEqual('Missing KEY error code', errMissingKey.code, 'MISSING_KEY_AFTER_PRIMARY');
assertEqual('Missing KEY line is 2', errMissingKey.line, 2);
assertEqual('Missing KEY column is 15', errMissingKey.column, 15);
assertEqual('Missing KEY userMessage', errMissingKey.userMessage, "Missing KEY after PRIMARY.\nExpected: KEY.");
assertTrue('Missing KEY contains Expected "KEY" after "PRIMARY"', errMissingKey.message.includes('Expected "KEY" after "PRIMARY"'));

// ── User-Facing Test 3: Missing relationship type at EOF ─────
console.log('');
console.log('── User-Facing: Missing relationship type at EOF ──');

let errMissingRelType = null;
try {
    lexAndParse('ENTITY Student\nid INT PRIMARY KEY\n\nENTITY Course\nid INT PRIMARY KEY\n\nRELATION Student ENROLLS_IN Course');
} catch (e) {
    errMissingRelType = e;
}

assertTrue('Missing relation type throws error', !!errMissingRelType);
assertEqual('Missing relation type error code', errMissingRelType.code, 'MISSING_RELATION_TYPE');
assertEqual('Missing relation type line is 7', errMissingRelType.line, 7);
assertEqual('Missing relation type column is 35', errMissingRelType.column, 35);
assertEqual('Missing relation type userMessage', errMissingRelType.userMessage, "Missing relationship type.\nExpected one of: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY.");
assertTrue('Missing relation type contains Expected RELATION_TYPE', errMissingRelType.message.includes('Expected RELATION_TYPE'));

// ── User-Facing Test 4: Missing entity name at EOF ───────────
console.log('');
console.log('── User-Facing: Missing entity name at EOF ──');

let errMissingEntName = null;
try {
    lexAndParse('ENTITY');
} catch (e) {
    errMissingEntName = e;
}

assertTrue('Missing entity name throws error', !!errMissingEntName);
assertEqual('Missing entity name error code', errMissingEntName.code, 'MISSING_ENTITY_NAME');
assertEqual('Missing entity name line is 1', errMissingEntName.line, 1);
assertEqual('Missing entity name column is 7', errMissingEntName.column, 7);
assertEqual('Missing entity name userMessage', errMissingEntName.userMessage, "Missing entity name.\nExpected an identifier after ENTITY.");
assertTrue('Missing entity name contains Expected IDENTIFIER', errMissingEntName.message.includes('Expected IDENTIFIER'));

// ── User-Facing Test 5: Lexer EOF token preserved ────────────
console.log('');
console.log('── User-Facing: Lexer EOF token preserved ──');

const tokensWithEof = Lexer.tokenize('ENTITY Student\nname');
const lastTok = tokensWithEof[tokensWithEof.length - 1];
assertEqual('Last token type is EOF', lastTok.type, 'EOF');
assertEqual('Last token value is EOF', lastTok.value, 'EOF');

// ── User-Facing Test 6: formatUserFacingError helper ─────────
console.log('');
console.log('── User-Facing: formatUserFacingError helper ──');

const { formatUserFacingError } = require('../src/utils/errors');
assertEqual('formatUserFacingError uses userMessage', formatUserFacingError(errMissingType), "Missing data type for field 'name'.\nExpected one of: INT, STRING, FLOAT, BOOLEAN, ENUM.");
assertEqual('formatUserFacingError cleans raw prefix', formatUserFacingError({ message: 'Syntax Error at line 1, column 2: Some error' }), 'Some error');

// ── User-Facing Test 7: API /compile returns userMessage and code ──
console.log('');
console.log('── User-Facing: API /compile returns userMessage and code ──');

const apiUserFacingTest = await simulatePost('/compile', {
    source: 'ENTITY Student\n\nid INT PRIMARY KEY\nname'
});

assertTrue('API returns success false for missing type', apiUserFacingTest.success === false);
assertEqual('API error phase is parser', apiUserFacingTest.phase, 'parser');
assertEqual('API error code is MISSING_DATATYPE', apiUserFacingTest.errors[0].code, 'MISSING_DATATYPE');
assertEqual('API error line is 4', apiUserFacingTest.errors[0].line, 4);
assertEqual('API error column is 5', apiUserFacingTest.errors[0].column, 5);
assertEqual('API error userMessage matches', apiUserFacingTest.errors[0].userMessage, "Missing data type for field 'name'.\nExpected one of: INT, STRING, FLOAT, BOOLEAN, ENUM.");



// ═════════════════════════════════════════════════════════════
// LEXER: FIELD VALIDATION & DEFAULT VALUE TOKENS
// ═════════════════════════════════════════════════════════════

currentPhase = 'lexer';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Lexer: Validation & Default Token Tests     ║');
console.log('╚══════════════════════════════════════════════╝');

// ── Lexer: MIN token ─────────────────────────────────────────
console.log('');
console.log('── Lexer: MIN token ──');

const tokMIN = Lexer.tokenize('MIN');
assertEqual('MIN token type is MODIFIER', tokMIN[0].type, 'MODIFIER');
assertEqual('MIN token value is MIN', tokMIN[0].value, 'MIN');

// ── Lexer: MAX token ─────────────────────────────────────────
console.log('');
console.log('── Lexer: MAX token ──');

const tokMAX = Lexer.tokenize('MAX');
assertEqual('MAX token type is MODIFIER', tokMAX[0].type, 'MODIFIER');
assertEqual('MAX token value is MAX', tokMAX[0].value, 'MAX');

// ── Lexer: DEFAULT token ────────────────────────────────────
console.log('');
console.log('── Lexer: DEFAULT token ──');

const tokDEF = Lexer.tokenize('DEFAULT');
assertEqual('DEFAULT token type is MODIFIER', tokDEF[0].type, 'MODIFIER');
assertEqual('DEFAULT token value is DEFAULT', tokDEF[0].value, 'DEFAULT');

// ── Lexer: integer number ───────────────────────────────────
console.log('');
console.log('── Lexer: integer number ──');

const tokInt = Lexer.tokenize('17');
assertEqual('Integer 17 type is NUMBER', tokInt[0].type, 'NUMBER');
assertEqual('Integer 17 value is "17"', tokInt[0].value, '17');

// ── Lexer: decimal number ───────────────────────────────────
console.log('');
console.log('── Lexer: decimal number ──');

const tokDec = Lexer.tokenize('8.5');
assertEqual('Decimal 8.5 type is NUMBER', tokDec[0].type, 'NUMBER');
assertEqual('Decimal 8.5 value is "8.5"', tokDec[0].value, '8.5');

// ── Lexer: zero ─────────────────────────────────────────────
console.log('');
console.log('── Lexer: zero ──');

const tokZero = Lexer.tokenize('0');
assertEqual('Zero type is NUMBER', tokZero[0].type, 'NUMBER');
assertEqual('Zero value is "0"', tokZero[0].value, '0');

// ── Lexer: string literal ───────────────────────────────────
console.log('');
console.log('── Lexer: string literal ──');

const tokStr = Lexer.tokenize('"active"');
assertEqual('String literal type', tokStr[0].type, 'STRING_LITERAL');
assertEqual('String literal value (no quotes)', tokStr[0].value, 'active');

// ── Lexer: empty string literal ─────────────────────────────
console.log('');
console.log('── Lexer: empty string literal ──');

const tokEmptyStr = Lexer.tokenize('""');
assertEqual('Empty string literal type', tokEmptyStr[0].type, 'STRING_LITERAL');
assertEqual('Empty string literal value', tokEmptyStr[0].value, '');

// ── Lexer: TRUE boolean literal ─────────────────────────────
console.log('');
console.log('── Lexer: TRUE boolean literal ──');

const tokTrue = Lexer.tokenize('TRUE');
assertEqual('TRUE type is BOOLEAN_LITERAL', tokTrue[0].type, 'BOOLEAN_LITERAL');
assertEqual('TRUE value is TRUE', tokTrue[0].value, 'TRUE');

// ── Lexer: FALSE boolean literal ────────────────────────────
console.log('');
console.log('── Lexer: FALSE boolean literal ──');

const tokFalse = Lexer.tokenize('FALSE');
assertEqual('FALSE type is BOOLEAN_LITERAL', tokFalse[0].type, 'BOOLEAN_LITERAL');
assertEqual('FALSE value is FALSE', tokFalse[0].value, 'FALSE');

// ── Lexer: line/column tracking for new tokens ──────────────
console.log('');
console.log('── Lexer: line/column tracking for new tokens ──');

const tokLineCol = Lexer.tokenize('age INT MIN 17 MAX 60');
// tokens: age(IDENT) INT(DATATYPE) MIN(MODIFIER) 17(NUMBER) MAX(MODIFIER) 60(NUMBER) EOF
assertEqual('age token line', tokLineCol[0].line, 1);
assertEqual('age token column', tokLineCol[0].column, 1);
assertEqual('MIN token column', tokLineCol[2].column, 9);
assertEqual('17 token column', tokLineCol[3].column, 13);
assertEqual('MAX token column', tokLineCol[4].column, 16);
assertEqual('60 token column', tokLineCol[5].column, 20);

// ── Lexer: string literal column tracking ───────────────────
console.log('');
console.log('── Lexer: string literal column tracking ──');

const tokStrCol = Lexer.tokenize('status STRING DEFAULT "active"');
// tokens: status(IDENT) STRING(DATATYPE) DEFAULT(MODIFIER) "active"(STRING_LITERAL) EOF
assertEqual('DEFAULT token column', tokStrCol[2].column, 15);
assertEqual('"active" token column', tokStrCol[3].column, 23);
assertEqual('"active" token type', tokStrCol[3].type, 'STRING_LITERAL');

// ── Lexer: multiline with new tokens ────────────────────────
console.log('');
console.log('── Lexer: multiline with new tokens ──');

const tokMulti = Lexer.tokenize('ENTITY Student\nage INT MIN 0\nactive BOOLEAN DEFAULT TRUE');
const ageTok = tokMulti.find(t => t.value === 'age');
const activeTok = tokMulti.find(t => t.value === 'active');
const trueTok = tokMulti.find(t => t.value === 'TRUE');
assertEqual('age token is on line 2', ageTok.line, 2);
assertEqual('active token is on line 3', activeTok.line, 3);
assertEqual('TRUE token is on line 3', trueTok.line, 3);
assertEqual('TRUE token type', trueTok.type, 'BOOLEAN_LITERAL');

// ── Lexer: EOF still works ──────────────────────────────────
console.log('');
console.log('── Lexer: EOF still works with new tokens ──');

const tokEofNew = Lexer.tokenize('MIN 5 MAX 10 DEFAULT "x" TRUE FALSE');
const eofNew = tokEofNew[tokEofNew.length - 1];
assertEqual('EOF type preserved', eofNew.type, 'EOF');
assertEqual('EOF value preserved', eofNew.value, 'EOF');

// ── Lexer: unterminated string literal ──────────────────────
console.log('');
console.log('── Lexer: unterminated string literal ──');

assertThrows('Unterminated string throws error',
    () => Lexer.tokenize('"hello'),
    'Unterminated string literal');

// ── Lexer: number followed by letter still errors ───────────
console.log('');
console.log('── Lexer: number-letter still errors ──');

assertThrows('3name still errors',
    () => Lexer.tokenize('3name'),
    'cannot start with a digit');

// ── Lexer: existing tokens unchanged ────────────────────────
console.log('');
console.log('── Lexer: existing tokens unchanged ──');

const tokExisting = Lexer.tokenize('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED UNIQUE');
const entityTok = tokExisting.find(t => t.value === 'ENTITY');
const primaryTok = tokExisting.find(t => t.value === 'PRIMARY');
const requiredTok = tokExisting.find(t => t.value === 'REQUIRED');
assertEqual('ENTITY still KEYWORD', entityTok.type, 'KEYWORD');
assertEqual('PRIMARY still MODIFIER', primaryTok.type, 'MODIFIER');
assertEqual('REQUIRED still MODIFIER', requiredTok.type, 'MODIFIER');

// ── Lexer: Negative number support ──────────────────────────
console.log('');
console.log('── Lexer: Negative number support ──');

const negTokens1 = Lexer.tokenize('ENTITY Student\n\nage INT MIN -10 MAX 100');
const negNumTokens = negTokens1.filter(t => t.type === 'NUMBER');
assertTrue('Negative number: -10 tokenized', negNumTokens.some(t => t.value === '-10'));
assertTrue('Positive number: 100 tokenized', negNumTokens.some(t => t.value === '100'));

const negTokens2 = Lexer.tokenize('ENTITY Test\n\nval FLOAT DEFAULT -3.14');
const negFloatTokens = negTokens2.filter(t => t.type === 'NUMBER');
assertTrue('Negative float: -3.14 tokenized', negFloatTokens.some(t => t.value === '-3.14'));

const negTokens3 = Lexer.tokenize('ENTITY Test\n\nval INT DEFAULT -1');
const negDefTokens = negTokens3.filter(t => t.type === 'NUMBER');
assertTrue('Negative integer: -1 tokenized', negDefTokens.some(t => t.value === '-1'));

const negTokens4 = Lexer.tokenize('ENTITY Test\n\nval INT MIN -100 MAX -1');
const negRangeTokens = negTokens4.filter(t => t.type === 'NUMBER');
assertTrue('Negative MIN: -100 tokenized', negRangeTokens.some(t => t.value === '-100'));
assertTrue('Negative MAX: -1 tokenized', negRangeTokens.some(t => t.value === '-1'));

// ── Lexer: Structured error metadata ────────────────────────
console.log('');
console.log('── Lexer: Structured error metadata ──');

try {
    Lexer.tokenize('ENTITY Test\n@invalid');
    assertTrue('Lexer error should have been thrown', false);
} catch (e) {
    assertTrue('Lexer error has line property', typeof e.line === 'number');
    assertTrue('Lexer error has column property', typeof e.column === 'number');
    assertTrue('Lexer error has code property', typeof e.code === 'string');
    assertTrue('Lexer error has userMessage property', typeof e.userMessage === 'string');
    assertEqual('Lexer error code is UNEXPECTED_CHARACTER', e.code, 'UNEXPECTED_CHARACTER');
}

try {
    Lexer.tokenize('ENTITY Test\n\nname STRING DEFAULT "hello');
    assertTrue('Unterminated string should throw', false);
} catch (e) {
    assertTrue('Unterminated string has line', typeof e.line === 'number');
    assertTrue('Unterminated string has code', typeof e.code === 'string');
    assertEqual('Unterminated string code', e.code, 'UNTERMINATED_STRING');
}


// ═════════════════════════════════════════════════════════════
// PARSER: FIELD VALIDATION & DEFAULT VALUE AST TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'parser';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Parser: Validation & Default AST Tests      ║');
console.log('╚══════════════════════════════════════════════╝');

// ── Parser: MIN validation ──────────────────────────────────
console.log('');
console.log('── Parser: MIN validation ──');

const astMin = lexAndParse('ENTITY Student\nage INT MIN 17');
const fMin = astMin.entities[0].fields[0];
assertEqual('MIN field name', fMin.name, 'age');
assertEqual('MIN field dataType', fMin.dataType, 'INT');
assertEqual('MIN field constraints empty', fMin.constraints, []);
assertEqual('MIN field validations length', fMin.validations.length, 1);
assertEqual('MIN validation type', fMin.validations[0].type, 'MIN');
assertEqual('MIN validation value', fMin.validations[0].value, 17);
assertEqual('MIN field defaultValue null', fMin.defaultValue, null);

// ── Parser: MAX validation ──────────────────────────────────
console.log('');
console.log('── Parser: MAX validation ──');

const astMax = lexAndParse('ENTITY Student\nage INT MAX 60');
const fMax = astMax.entities[0].fields[0];
assertEqual('MAX field validations length', fMax.validations.length, 1);
assertEqual('MAX validation type', fMax.validations[0].type, 'MAX');
assertEqual('MAX validation value', fMax.validations[0].value, 60);

// ── Parser: MIN + MAX combined ──────────────────────────────
console.log('');
console.log('── Parser: MIN + MAX combined ──');

const astMinMax = lexAndParse('ENTITY Student\nage INT MIN 17 MAX 60');
const fMinMax = astMinMax.entities[0].fields[0];
assertEqual('MIN+MAX field name', fMinMax.name, 'age');
assertEqual('MIN+MAX validations length', fMinMax.validations.length, 2);
assertEqual('MIN+MAX first validation type', fMinMax.validations[0].type, 'MIN');
assertEqual('MIN+MAX first validation value', fMinMax.validations[0].value, 17);
assertEqual('MIN+MAX second validation type', fMinMax.validations[1].type, 'MAX');
assertEqual('MIN+MAX second validation value', fMinMax.validations[1].value, 60);
assertEqual('MIN+MAX constraints empty', fMinMax.constraints, []);
assertEqual('MIN+MAX defaultValue null', fMinMax.defaultValue, null);

// ── Parser: DEFAULT string ──────────────────────────────────
console.log('');
console.log('── Parser: DEFAULT string ──');

const astDefStr = lexAndParse('ENTITY Student\nstatus STRING DEFAULT "active"');
const fDefStr = astDefStr.entities[0].fields[0];
assertEqual('DEFAULT string field name', fDefStr.name, 'status');
assertEqual('DEFAULT string defaultValue type', fDefStr.defaultValue.type, 'STRING');
assertEqual('DEFAULT string defaultValue value', fDefStr.defaultValue.value, 'active');
assertEqual('DEFAULT string validations empty', fDefStr.validations, []);

// ── Parser: DEFAULT number ──────────────────────────────────
console.log('');
console.log('── Parser: DEFAULT number ──');

const astDefNum = lexAndParse('ENTITY Student\nscore FLOAT DEFAULT 85.5');
const fDefNum = astDefNum.entities[0].fields[0];
assertEqual('DEFAULT number field name', fDefNum.name, 'score');
assertEqual('DEFAULT number defaultValue type', fDefNum.defaultValue.type, 'NUMBER');
assertEqual('DEFAULT number defaultValue value', fDefNum.defaultValue.value, 85.5);

// ── Parser: DEFAULT integer ─────────────────────────────────
console.log('');
console.log('── Parser: DEFAULT integer ──');

const astDefInt = lexAndParse('ENTITY Student\nage INT DEFAULT 18');
const fDefInt = astDefInt.entities[0].fields[0];
assertEqual('DEFAULT integer defaultValue type', fDefInt.defaultValue.type, 'NUMBER');
assertEqual('DEFAULT integer defaultValue value', fDefInt.defaultValue.value, 18);

// ── Parser: DEFAULT TRUE ────────────────────────────────────
console.log('');
console.log('── Parser: DEFAULT TRUE ──');

const astDefTrue = lexAndParse('ENTITY Student\nactive BOOLEAN DEFAULT TRUE');
const fDefTrue = astDefTrue.entities[0].fields[0];
assertEqual('DEFAULT TRUE field name', fDefTrue.name, 'active');
assertEqual('DEFAULT TRUE defaultValue type', fDefTrue.defaultValue.type, 'BOOLEAN');
assertEqual('DEFAULT TRUE defaultValue value', fDefTrue.defaultValue.value, true);

// ── Parser: DEFAULT FALSE ───────────────────────────────────
console.log('');
console.log('── Parser: DEFAULT FALSE ──');

const astDefFalse = lexAndParse('ENTITY Student\ndeleted BOOLEAN DEFAULT FALSE');
const fDefFalse = astDefFalse.entities[0].fields[0];
assertEqual('DEFAULT FALSE defaultValue type', fDefFalse.defaultValue.type, 'BOOLEAN');
assertEqual('DEFAULT FALSE defaultValue value', fDefFalse.defaultValue.value, false);

// ── Parser: multiple modifiers combined ─────────────────────
console.log('');
console.log('── Parser: multiple modifiers combined ──');

const astCombo = lexAndParse('ENTITY Student\nemail STRING REQUIRED UNIQUE\nage INT MIN 0 MAX 120 DEFAULT 18');
const fEmail = astCombo.entities[0].fields[0];
const fAge = astCombo.entities[0].fields[1];

assertEqual('email constraints', fEmail.constraints, ['REQUIRED', 'UNIQUE']);
assertEqual('email validations empty', fEmail.validations, []);
assertEqual('email defaultValue null', fEmail.defaultValue, null);

assertEqual('age constraints empty', fAge.constraints, []);
assertEqual('age validations length', fAge.validations.length, 2);
assertEqual('age validations[0] MIN 0', fAge.validations[0], { type: 'MIN', value: 0 });
assertEqual('age validations[1] MAX 120', fAge.validations[1], { type: 'MAX', value: 120 });
assertEqual('age defaultValue', fAge.defaultValue, { type: 'NUMBER', value: 18 });

// ── Parser: existing PRIMARY KEY / REQUIRED / UNIQUE ────────
console.log('');
console.log('── Parser: existing constraints preserved ──');

const astExisting = lexAndParse('ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\nemail STRING UNIQUE');
const fId = astExisting.entities[0].fields[0];
const fName = astExisting.entities[0].fields[1];
const fEmailEx = astExisting.entities[0].fields[2];

assertEqual('PRIMARY KEY constraint preserved', fId.constraints, ['PRIMARY_KEY']);
assertEqual('PRIMARY KEY validations empty', fId.validations, []);
assertEqual('PRIMARY KEY defaultValue null', fId.defaultValue, null);
assertEqual('REQUIRED constraint preserved', fName.constraints, ['REQUIRED']);
assertEqual('UNIQUE constraint preserved', fEmailEx.constraints, ['UNIQUE']);

// ── Parser: decimal MIN/MAX ─────────────────────────────────
console.log('');
console.log('── Parser: decimal MIN/MAX values ──');

const astDecVal = lexAndParse('ENTITY Product\nprice FLOAT MIN 0.01 MAX 9999.99');
const fPrice = astDecVal.entities[0].fields[0];
assertEqual('decimal MIN value', fPrice.validations[0].value, 0.01);
assertEqual('decimal MAX value', fPrice.validations[1].value, 9999.99);

// ── Parser: constraints + validations + default together ────
console.log('');
console.log('── Parser: constraints + validations + default ──');

const astAll = lexAndParse('ENTITY Student\nage INT REQUIRED MIN 0 MAX 120 DEFAULT 18');
const fAll = astAll.entities[0].fields[0];
assertEqual('all: constraints', fAll.constraints, ['REQUIRED']);
assertEqual('all: validations length', fAll.validations.length, 2);
assertEqual('all: defaultValue', fAll.defaultValue, { type: 'NUMBER', value: 18 });

// ── Parser error: missing MIN value ─────────────────────────
console.log('');
console.log('── Parser error: missing MIN value ──');

let errMinVal = null;
try {
    lexAndParse('ENTITY Student\nage INT MIN');
} catch (e) {
    errMinVal = e;
}
assertTrue('Missing MIN value throws error', !!errMinVal);
assertEqual('Missing MIN value error code', errMinVal.code, 'MISSING_MIN_VALUE');
assertTrue('Missing MIN value message has Expected NUMBER', errMinVal.message.includes('Expected NUMBER'));
assertTrue('Missing MIN value userMessage has Missing value after MIN', errMinVal.userMessage.includes('Missing value after MIN'));

// ── Parser error: missing MAX value ─────────────────────────
console.log('');
console.log('── Parser error: missing MAX value ──');

let errMaxVal = null;
try {
    lexAndParse('ENTITY Student\nage INT MAX');
} catch (e) {
    errMaxVal = e;
}
assertTrue('Missing MAX value throws error', !!errMaxVal);
assertEqual('Missing MAX value error code', errMaxVal.code, 'MISSING_MAX_VALUE');
assertTrue('Missing MAX value message has Expected NUMBER', errMaxVal.message.includes('Expected NUMBER'));
assertTrue('Missing MAX value userMessage has Missing value after MAX', errMaxVal.userMessage.includes('Missing value after MAX'));

// ── Parser error: missing DEFAULT value ─────────────────────
console.log('');
console.log('── Parser error: missing DEFAULT value ──');

let errDefVal = null;
try {
    lexAndParse('ENTITY Student\nstatus STRING DEFAULT');
} catch (e) {
    errDefVal = e;
}
assertTrue('Missing DEFAULT value throws error', !!errDefVal);
assertEqual('Missing DEFAULT value error code', errDefVal.code, 'MISSING_DEFAULT_VALUE');
assertTrue('Missing DEFAULT value userMessage has Missing default value', errDefVal.userMessage.includes('Missing default value'));

// ── Parser error: MIN with non-number ───────────────────────
console.log('');
console.log('── Parser error: MIN with non-number ──');

let errMinNonNum = null;
try {
    lexAndParse('ENTITY Student\nage INT MIN "hello"');
} catch (e) {
    errMinNonNum = e;
}
assertTrue('MIN with string throws error', !!errMinNonNum);
assertEqual('MIN non-number error code', errMinNonNum.code, 'MISSING_MIN_VALUE');
assertTrue('MIN non-number message', errMinNonNum.message.includes('Expected NUMBER'));

// ── Parser error: MAX with non-number ───────────────────────
console.log('');
console.log('── Parser error: MAX with non-number ──');

let errMaxNonNum = null;
try {
    lexAndParse('ENTITY Student\nage INT MAX TRUE');
} catch (e) {
    errMaxNonNum = e;
}
assertTrue('MAX with boolean throws error', !!errMaxNonNum);
assertEqual('MAX non-number error code', errMaxNonNum.code, 'MISSING_MAX_VALUE');

// ── Parser: field with DEFAULT then another field ───────────
console.log('');
console.log('── Parser: DEFAULT followed by next field ──');

const astNextField = lexAndParse('ENTITY Student\nstatus STRING DEFAULT "active"\nname STRING REQUIRED');
assertEqual('Two fields parsed', astNextField.entities[0].fields.length, 2);
assertEqual('First field has default', astNextField.entities[0].fields[0].defaultValue.value, 'active');
assertEqual('Second field has REQUIRED', astNextField.entities[0].fields[1].constraints, ['REQUIRED']);
assertEqual('Second field default is null', astNextField.entities[0].fields[1].defaultValue, null);

// ── Parser: validations/default empty when not specified ─────
console.log('');
console.log('── Parser: validations/default empty when not specified ──');

const astPlain = lexAndParse('ENTITY Student\nname STRING');
const fPlain = astPlain.entities[0].fields[0];
assertEqual('Plain field validations empty', fPlain.validations, []);
assertEqual('Plain field defaultValue null', fPlain.defaultValue, null);
assertEqual('Plain field type is Field', fPlain.type, 'Field');

// ── Parser: full entity with mixed modifiers ────────────────
console.log('');
console.log('── Parser: full entity with mixed modifiers ──');

const astFull = lexAndParse(
    'ENTITY Student\n' +
    'id INT PRIMARY KEY\n' +
    'name STRING REQUIRED\n' +
    'email STRING UNIQUE\n' +
    'age INT MIN 17 MAX 60\n' +
    'status STRING DEFAULT "active"\n' +
    'active BOOLEAN DEFAULT TRUE'
);
const eFull = astFull.entities[0];
assertEqual('Full entity has 6 fields', eFull.fields.length, 6);
assertEqual('id has PRIMARY_KEY', eFull.fields[0].constraints, ['PRIMARY_KEY']);
assertEqual('age has MIN 17', eFull.fields[3].validations[0], { type: 'MIN', value: 17 });
assertEqual('age has MAX 60', eFull.fields[3].validations[1], { type: 'MAX', value: 60 });
assertEqual('status default is active', eFull.fields[4].defaultValue, { type: 'STRING', value: 'active' });
assertEqual('active default is true', eFull.fields[5].defaultValue, { type: 'BOOLEAN', value: true });


// ═════════════════════════════════════════════════════════════
// SEMANTIC: FIELD VALIDATION & DEFAULT VALUE TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'semantic';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Semantic: Validation & Default Tests        ║');
console.log('╚══════════════════════════════════════════════╝');

// ── Test 1: INT + MIN valid ──
console.log('');
console.log('── Semantic: INT + MIN valid ──');
const sem1 = lexParseAnalyze('ENTITY Student\nage INT MIN 18');
assertTrue('INT + MIN is valid', sem1.valid);
assertEqual('sem1 errors empty', sem1.errors.length, 0);

// ── Test 2: INT + MAX valid ──
console.log('');
console.log('── Semantic: INT + MAX valid ──');
const sem2 = lexParseAnalyze('ENTITY Student\nage INT MAX 65');
assertTrue('INT + MAX is valid', sem2.valid);
assertEqual('sem2 errors empty', sem2.errors.length, 0);

// ── Test 3: FLOAT + MIN valid ──
console.log('');
console.log('── Semantic: FLOAT + MIN valid ──');
const sem3 = lexParseAnalyze('ENTITY Product\nprice FLOAT MIN 0.01');
assertTrue('FLOAT + MIN is valid', sem3.valid);
assertEqual('sem3 errors empty', sem3.errors.length, 0);

// ── Test 4: FLOAT + MAX valid ──
console.log('');
console.log('── Semantic: FLOAT + MAX valid ──');
const sem4 = lexParseAnalyze('ENTITY Product\nprice FLOAT MAX 9999.99');
assertTrue('FLOAT + MAX is valid', sem4.valid);
assertEqual('sem4 errors empty', sem4.errors.length, 0);

// ── Test 5: MIN + MAX valid ──
console.log('');
console.log('── Semantic: MIN + MAX valid ──');
const sem5 = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60');
assertTrue('MIN + MAX is valid', sem5.valid);
assertEqual('sem5 errors empty', sem5.errors.length, 0);

// ── Test 6: STRING + MIN rejected ──
console.log('');
console.log('── Semantic: STRING + MIN rejected ──');
const sem6 = lexParseAnalyze('ENTITY Student\nname STRING MIN 18');
assertTrue('STRING + MIN is invalid', !sem6.valid);
assertTrue('Error mentions MIN only allowed for INT or FLOAT', sem6.errors.some(e => e.message === "Validation 'MIN' is only allowed for INT or FLOAT fields."));

// ── Test 7: STRING + MAX rejected ──
console.log('');
console.log('── Semantic: STRING + MAX rejected ──');
const sem7 = lexParseAnalyze('ENTITY Student\nname STRING MAX 100');
assertTrue('STRING + MAX is invalid', !sem7.valid);
assertTrue('Error mentions MAX only allowed for INT or FLOAT', sem7.errors.some(e => e.message === "Validation 'MAX' is only allowed for INT or FLOAT fields."));

// ── Test 8: BOOLEAN + MIN rejected ──
console.log('');
console.log('── Semantic: BOOLEAN + MIN rejected ──');
const sem8 = lexParseAnalyze('ENTITY Student\nactive BOOLEAN MIN 1');
assertTrue('BOOLEAN + MIN is invalid', !sem8.valid);
assertTrue('Error mentions MIN only allowed for INT or FLOAT', sem8.errors.some(e => e.message === "Validation 'MIN' is only allowed for INT or FLOAT fields."));

// ── Test 9: BOOLEAN + MAX rejected ──
console.log('');
console.log('── Semantic: BOOLEAN + MAX rejected ──');
const sem9 = lexParseAnalyze('ENTITY Student\nactive BOOLEAN MAX 1');
assertTrue('BOOLEAN + MAX is invalid', !sem9.valid);
assertTrue('Error mentions MAX only allowed for INT or FLOAT', sem9.errors.some(e => e.message === "Validation 'MAX' is only allowed for INT or FLOAT fields."));

// ── Test 10: MIN > MAX rejected ──
console.log('');
console.log('── Semantic: MIN > MAX rejected ──');
const sem10 = lexParseAnalyze('ENTITY Student\nage INT MIN 60 MAX 17');
assertTrue('MIN > MAX is invalid', !sem10.valid);
assertTrue('Error mentions MIN value 60 cannot be greater than MAX value 17.', sem10.errors.some(e => e.message === "MIN value 60 cannot be greater than MAX value 17."));

// ── Test 11: INT + integer DEFAULT valid ──
console.log('');
console.log('── Semantic: INT + integer DEFAULT valid ──');
const sem11 = lexParseAnalyze('ENTITY Student\nage INT DEFAULT 20');
assertTrue('INT + integer DEFAULT is valid', sem11.valid);
assertEqual('sem11 errors empty', sem11.errors.length, 0);

// ── Test 12: INT + decimal DEFAULT rejected ──
console.log('');
console.log('── Semantic: INT + decimal DEFAULT rejected ──');
const sem12 = lexParseAnalyze('ENTITY Student\nage INT DEFAULT 8.5');
assertTrue('INT + decimal DEFAULT is invalid', !sem12.valid);
assertTrue('Error mentions INT default must be integer', sem12.errors.some(e => e.message.includes("Default value for INT field 'age' must be an integer")));

// ── Test 13: FLOAT + decimal DEFAULT valid ──
console.log('');
console.log('── Semantic: FLOAT + decimal DEFAULT valid ──');
const sem13 = lexParseAnalyze('ENTITY Student\ncgpa FLOAT DEFAULT 8.5');
assertTrue('FLOAT + decimal DEFAULT is valid', sem13.valid);
assertEqual('sem13 errors empty', sem13.errors.length, 0);

// ── Test 14: STRING + string DEFAULT valid ──
console.log('');
console.log('── Semantic: STRING + string DEFAULT valid ──');
const sem14 = lexParseAnalyze('ENTITY Student\nstatus STRING DEFAULT "active"');
assertTrue('STRING + string DEFAULT is valid', sem14.valid);
assertEqual('sem14 errors empty', sem14.errors.length, 0);

// ── Test 15: STRING + numeric DEFAULT rejected ──
console.log('');
console.log('── Semantic: STRING + numeric DEFAULT rejected ──');
const sem15 = lexParseAnalyze('ENTITY Student\nname STRING DEFAULT 20');
assertTrue('STRING + numeric DEFAULT is invalid', !sem15.valid);
assertTrue('Error mentions STRING default must be string', sem15.errors.some(e => e.message.includes("Default value for STRING field 'name' must be a string.")));

// ── Test 16: BOOLEAN + TRUE DEFAULT valid ──
console.log('');
console.log('── Semantic: BOOLEAN + TRUE DEFAULT valid ──');
const sem16 = lexParseAnalyze('ENTITY Student\nactive BOOLEAN DEFAULT TRUE');
assertTrue('BOOLEAN + TRUE DEFAULT is valid', sem16.valid);
assertEqual('sem16 errors empty', sem16.errors.length, 0);

// ── Test 17: BOOLEAN + FALSE DEFAULT valid ──
console.log('');
console.log('── Semantic: BOOLEAN + FALSE DEFAULT valid ──');
const sem17 = lexParseAnalyze('ENTITY Student\nactive BOOLEAN DEFAULT FALSE');
assertTrue('BOOLEAN + FALSE DEFAULT is valid', sem17.valid);
assertEqual('sem17 errors empty', sem17.errors.length, 0);

// ── Test 18: BOOLEAN + string DEFAULT rejected ──
console.log('');
console.log('── Semantic: BOOLEAN + string DEFAULT rejected ──');
const sem18 = lexParseAnalyze('ENTITY Student\nactive BOOLEAN DEFAULT "true"');
assertTrue('BOOLEAN + string DEFAULT is invalid', !sem18.valid);
assertTrue('Error mentions BOOLEAN default must be boolean', sem18.errors.some(e => e.message.includes("Default value for BOOLEAN field 'active' must be a boolean")));

// ── Test 19: REQUIRED + DEFAULT valid ──
console.log('');
console.log('── Semantic: REQUIRED + DEFAULT valid ──');
const sem19 = lexParseAnalyze('ENTITY Student\nstatus STRING REQUIRED DEFAULT "active"');
assertTrue('REQUIRED + DEFAULT is valid', sem19.valid);
assertEqual('sem19 errors empty', sem19.errors.length, 0);

// ── Test 20: PRIMARY KEY + DEFAULT behavior ──
console.log('');
console.log('── Semantic: PRIMARY KEY + DEFAULT behavior ──');
const sem20 = lexParseAnalyze('ENTITY Student\nid INT PRIMARY KEY DEFAULT 1');
assertTrue('PRIMARY KEY + DEFAULT is valid', sem20.valid);
assertEqual('sem20 errors empty', sem20.errors.length, 0);

// ── Test 21: MIN/MAX + DEFAULT inside range valid ──
console.log('');
console.log('── Semantic: MIN/MAX + DEFAULT inside range valid ──');
const sem21 = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 25');
assertTrue('MIN/MAX + DEFAULT inside range is valid', sem21.valid);
assertEqual('sem21 errors empty', sem21.errors.length, 0);

// ── Test 22: MIN/MAX + DEFAULT outside range rejected ──
console.log('');
console.log('── Semantic: MIN/MAX + DEFAULT outside range rejected ──');
const sem22a = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 12');
assertTrue('Default below range is invalid', !sem22a.valid);
assertTrue('Error says Default value 12 is outside the allowed range [18, 60].', sem22a.errors.some(e => e.message === "Default value 12 is outside the allowed range [18, 60]."));

const sem22b = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 75');
assertTrue('Default above range is invalid', !sem22b.valid);
assertTrue('Error says Default value 75 is outside the allowed range [18, 60].', sem22b.errors.some(e => e.message === "Default value 75 is outside the allowed range [18, 60]."));

const sem22c = lexParseAnalyze('ENTITY Student\nage INT MIN 18 DEFAULT 10');
assertTrue('Default below single MIN is invalid', !sem22c.valid);
assertTrue('Error mentions MIN value 18', sem22c.errors.some(e => e.message.includes("MIN value 18")));

// ── Test 23: Duplicate MIN rejected ──
console.log('');
console.log('── Semantic: Duplicate MIN rejected ──');
const sem23 = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MIN 20');
assertTrue('Duplicate MIN is invalid', !sem23.valid);
assertTrue('Error mentions Duplicate MIN validation for field \'age\'.', sem23.errors.some(e => e.message === "Duplicate MIN validation for field 'age'."));

// ── Test 24: Duplicate MAX rejected ──
console.log('');
console.log('── Semantic: Duplicate MAX rejected ──');
const sem24 = lexParseAnalyze('ENTITY Student\nage INT MAX 50 MAX 60');
assertTrue('Duplicate MAX is invalid', !sem24.valid);
assertTrue('Error mentions Duplicate MAX validation for field \'age\'.', sem24.errors.some(e => e.message === "Duplicate MAX validation for field 'age'."));

// ── Test 25: Duplicate DEFAULT rejected ──
console.log('');
console.log('── Semantic: Duplicate DEFAULT rejected ──');
const dupDefAST = new ProgramNode();
const dupDefEntity = new EntityNode('Student', 1);
const dupDefField = new FieldNode('status', 'STRING', [], 2, 1, 8, [], [{ type: 'STRING', value: 'active' }, { type: 'STRING', value: 'inactive' }]);
dupDefEntity.fields.push(dupDefField);
dupDefAST.entities.push(dupDefEntity);
const sem25 = SemanticAnalyzer.analyze(dupDefAST);
assertTrue('Duplicate DEFAULT is invalid', !sem25.valid);
assertTrue('Error mentions Duplicate DEFAULT value for field \'status\'.', sem25.errors.some(e => e.message === "Duplicate DEFAULT value for field 'status'."));

// ── Test 26: Symbol table preserves validations ──
console.log('');
console.log('── Semantic: Symbol table preserves validations ──');
const sem26 = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 25');
const fieldAge = sem26.symbolTable['Student'].fields['age'];
assertTrue('Field age has validations in symbol table', Array.isArray(fieldAge.validations));
assertEqual('Validations length is 2', fieldAge.validations.length, 2);
assertEqual('First validation is MIN 18', fieldAge.validations[0], { type: 'MIN', value: 18 });
assertEqual('Second validation is MAX 60', fieldAge.validations[1], { type: 'MAX', value: 60 });

// ── Test 27: Symbol table preserves defaultValue ──
console.log('');
console.log('── Semantic: Symbol table preserves defaultValue ──');
assertEqual('Field age defaultValue is NUMBER 25', fieldAge.defaultValue, { type: 'NUMBER', value: 25 });
const sem27Str = lexParseAnalyze('ENTITY Student\nstatus STRING DEFAULT "active"');
assertEqual('Field status defaultValue is STRING active', sem27Str.symbolTable['Student'].fields['status'].defaultValue, { type: 'STRING', value: 'active' });

// ── Test 28: Multiple validation/default errors collected together ──
console.log('');
console.log('── Semantic: Multiple validation/default errors collected ──');
const sem28 = lexParseAnalyze([
    'ENTITY BadEntity',
    'name STRING MIN 5',
    'active BOOLEAN MAX 1',
    'age INT MIN 60 MAX 17',
    'status INT DEFAULT "bad"'
].join('\n'));
assertTrue('Multiple errors entity is invalid', !sem28.valid);
assertTrue('At least 4 errors collected', sem28.errors.length >= 4);
assertTrue('Collected STRING MIN error', sem28.errors.some(e => e.message.includes("Validation 'MIN' is only allowed for INT or FLOAT")));
assertTrue('Collected BOOLEAN MAX error', sem28.errors.some(e => e.message.includes("Validation 'MAX' is only allowed for INT or FLOAT")));
assertTrue('Collected MIN > MAX error', sem28.errors.some(e => e.message.includes("MIN value 60 cannot be greater than MAX value 17")));
assertTrue('Collected INT default string error', sem28.errors.some(e => e.message.includes("Default value for INT field 'status' must be an integer")));

// ── Test 29: Duplicate DEFAULT in DSL ──
console.log('');
console.log('── Semantic: Duplicate DEFAULT in DSL rejected ──');
const semDupDefDsl = lexParseAnalyze('ENTITY Student\nstatus STRING DEFAULT "active" DEFAULT "inactive"');
assertTrue('Duplicate DEFAULT in DSL is invalid', !semDupDefDsl.valid);
assertTrue('Error mentions duplicate DEFAULT', semDupDefDsl.errors.some(e => e.message.includes("Duplicate DEFAULT value for field 'status'")));

// ── Test 30: INT field with non-integer MIN/MAX rejected ──
console.log('');
console.log('── Semantic: INT field with decimal MIN/MAX rejected ──');
const semIntDecMin = lexParseAnalyze('ENTITY Student\nage INT MIN 18.5');
assertTrue('INT with decimal MIN is invalid', !semIntDecMin.valid);
assertTrue('Error mentions integer for MIN', semIntDecMin.errors.some(e => e.message.includes("Validation 'MIN' value for INT field 'age' must be an integer")));

const semIntDecMax = lexParseAnalyze('ENTITY Student\nage INT MAX 60.5');
assertTrue('INT with decimal MAX is invalid', !semIntDecMax.valid);
assertTrue('Error mentions integer for MAX', semIntDecMax.errors.some(e => e.message.includes("Validation 'MAX' value for INT field 'age' must be an integer")));

// ── Test 31: Exact boundary defaults valid ──
console.log('');
console.log('── Semantic: Exact boundary defaults valid ──');
const semBoundMin = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 18');
assertTrue('DEFAULT equal to MIN is valid', semBoundMin.valid);
const semBoundMax = lexParseAnalyze('ENTITY Student\nage INT MIN 18 MAX 60 DEFAULT 60');
assertTrue('DEFAULT equal to MAX is valid', semBoundMax.valid);

// ── Test 32: Symbol table preserves first declaration on duplicates ──
console.log('');
console.log('── Semantic: Symbol table preserves first declaration on duplicates ──');
const semDupFieldTable = lexParseAnalyze('ENTITY Student\nname STRING\nname INT');
assertTrue('Duplicate field fails analysis', !semDupFieldTable.valid);
assertEqual('Symbol table preserves first field type', semDupFieldTable.symbolTable['Student'].fields['name'].dataType, 'STRING');

const semDupEntityTable = lexParseAnalyze('ENTITY Student\nid INT\nENTITY Student\ncode STRING');
assertTrue('Duplicate entity fails analysis', !semDupEntityTable.valid);
assertTrue('Symbol table preserves first entity fields', 'id' in semDupEntityTable.symbolTable['Student'].fields);
assertTrue('Symbol table does not contain second entity fields', !('code' in semDupEntityTable.symbolTable['Student'].fields));

const semDupRelTable = lexParseAnalyze([
    'ENTITY Student\nid INT',
    'ENTITY Course\nid INT',
    'RELATION Student ENROLLS Course ONE_TO_ONE',
    'RELATION Student ENROLLS Course MANY_TO_MANY'
].join('\n'));
assertTrue('Duplicate relation fails analysis', !semDupRelTable.valid);
assertEqual('Symbol table preserves first relation type', semDupRelTable.relations['ENROLLS'].relationType, 'ONE_TO_ONE');

// ── Test 33: Constraint validity & duplicate constraint detection ──
console.log('');
console.log('── Semantic: Constraint validity and duplicates ──');
const semDupConst = lexParseAnalyze('ENTITY Student\nname STRING REQUIRED REQUIRED');
assertTrue('Duplicate constraint fails analysis', !semDupConst.valid);
assertTrue('Error mentions duplicate constraint', semDupConst.errors.some(e => e.message.includes("Duplicate constraint 'REQUIRED'")));

const invalidConstAst = new ProgramNode();
const invConstEntity = new EntityNode('Student', 1);
invConstEntity.fields.push(new FieldNode('name', 'STRING', ['NOT_A_REAL_CONSTRAINT'], 2, 1, 6));
invalidConstAst.entities.push(invConstEntity);
const semInvConst = SemanticAnalyzer.analyze(invalidConstAst);
assertTrue('Invalid constraint fails analysis', !semInvConst.valid);
assertTrue('Error mentions invalid constraint', semInvConst.errors.some(e => e.message.includes("Invalid constraint 'NOT_A_REAL_CONSTRAINT'")));

// ── Test 34: Reserved word as relationship name ──
console.log('');
console.log('── Semantic: Reserved word as relationship name ──');
const relResAst = new ProgramNode();
const relResStudent = new EntityNode('Student', 1);
relResStudent.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 2));
const relResCourse = new EntityNode('Course', 3);
relResCourse.fields.push(new FieldNode('id', 'INT', ['PRIMARY_KEY'], 4));
relResAst.entities.push(relResStudent, relResCourse);
const { RelationNode } = require('../src/ast/ast');
relResAst.relations.push(new RelationNode('Student', 'ENTITY', 'Course', 'ONE_TO_ONE', 5));
const semRelResWord = SemanticAnalyzer.analyze(relResAst);
assertTrue('Reserved word relation name fails analysis', !semRelResWord.valid);
assertTrue('Error mentions reserved word', semRelResWord.errors.some(e => e.message.includes("Relationship name 'ENTITY' is a reserved word")));



// ═════════════════════════════════════════════════════════════
// IR GENERATOR: FIELD VALIDATION & DEFAULT VALUE TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'ir';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  IR: Validation & Default Tests              ║');
console.log('╚══════════════════════════════════════════════╝');

// ── IR Test: Field with MIN ──
console.log('');
console.log('── IR: Field with MIN ──');
const irMinAst = lexAndParse('ENTITY Student\nage INT MIN 18');
const irMinSem = SemanticAnalyzer.analyze(irMinAst);
const irMin = IRGenerator.generate(irMinAst, irMinSem);
const instMin = irMin.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'age');
assertTrue('ADD_FIELD for MIN found', !!instMin);
assertEqual('instMin validations', instMin.validations, [{ type: 'MIN', value: 18 }]);
assertEqual('instMin defaultValue is null', instMin.defaultValue, null);

// ── IR Test: Field with MAX ──
console.log('');
console.log('── IR: Field with MAX ──');
const irMaxAst = lexAndParse('ENTITY Student\nage INT MAX 65');
const irMaxSem = SemanticAnalyzer.analyze(irMaxAst);
const irMax = IRGenerator.generate(irMaxAst, irMaxSem);
const instMax = irMax.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'age');
assertEqual('instMax validations', instMax.validations, [{ type: 'MAX', value: 65 }]);

// ── IR Test: Field with MIN + MAX ──
console.log('');
console.log('── IR: Field with MIN + MAX ──');
const irMinMaxAst = lexAndParse('ENTITY Student\nage INT MIN 18 MAX 60');
const irMinMaxSem = SemanticAnalyzer.analyze(irMinMaxAst);
const irMinMax = IRGenerator.generate(irMinMaxAst, irMinMaxSem);
const instMinMax = irMinMax.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'age');
assertEqual('instMinMax validations length', instMinMax.validations.length, 2);
assertEqual('instMinMax validations', instMinMax.validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);

// ── IR Test: Field with string DEFAULT ──
console.log('');
console.log('── IR: Field with string DEFAULT ──');
const irDefStrAst = lexAndParse('ENTITY Student\nstatus STRING DEFAULT "active"');
const irDefStrSem = SemanticAnalyzer.analyze(irDefStrAst);
const irDefStr = IRGenerator.generate(irDefStrAst, irDefStrSem);
const instDefStr = irDefStr.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'status');
assertEqual('instDefStr defaultValue', instDefStr.defaultValue, { type: 'STRING', value: 'active' });
assertEqual('instDefStr validations empty', instDefStr.validations, []);

// ── IR Test: Field with numeric DEFAULT ──
console.log('');
console.log('── IR: Field with numeric DEFAULT ──');
const irDefNumAst = lexAndParse('ENTITY Student\nage INT DEFAULT 25\nscore FLOAT DEFAULT 98.5');
const irDefNumSem = SemanticAnalyzer.analyze(irDefNumAst);
const irDefNum = IRGenerator.generate(irDefNumAst, irDefNumSem);
const instDefAge = irDefNum.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'age');
const instDefScore = irDefNum.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'score');
assertEqual('instDefAge defaultValue is 25', instDefAge.defaultValue, { type: 'NUMBER', value: 25 });
assertEqual('instDefScore defaultValue is 98.5', instDefScore.defaultValue, { type: 'NUMBER', value: 98.5 });

// ── IR Test: Field with boolean DEFAULT ──
console.log('');
console.log('── IR: Field with boolean DEFAULT ──');
const irDefBoolAst = lexAndParse('ENTITY Student\nactive BOOLEAN DEFAULT TRUE\ndeleted BOOLEAN DEFAULT FALSE');
const irDefBoolSem = SemanticAnalyzer.analyze(irDefBoolAst);
const irDefBool = IRGenerator.generate(irDefBoolAst, irDefBoolSem);
const instDefActive = irDefBool.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'active');
const instDefDeleted = irDefBool.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'deleted');
assertEqual('instDefActive defaultValue is true', instDefActive.defaultValue, { type: 'BOOLEAN', value: true });
assertEqual('instDefDeleted defaultValue is false', instDefDeleted.defaultValue, { type: 'BOOLEAN', value: false });

// ── IR Test: Field with constraints + validations + default ──
console.log('');
console.log('── IR: Field with constraints + validations + default ──');
const irFullFieldAst = lexAndParse('ENTITY Student\nage INT REQUIRED MIN 18 MAX 60 DEFAULT 25');
const irFullFieldSem = SemanticAnalyzer.analyze(irFullFieldAst);
const irFullField = IRGenerator.generate(irFullFieldAst, irFullFieldSem);
const instFullField = irFullField.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'age');
assertEqual('instFullField constraints', instFullField.constraints, ['REQUIRED']);
assertEqual('instFullField validations', instFullField.validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);
assertEqual('instFullField defaultValue', instFullField.defaultValue, { type: 'NUMBER', value: 25 });

// ── IR Test: Null default ──
console.log('');
console.log('── IR: Null default ──');
const irNullDefAst = lexAndParse('ENTITY Student\nname STRING REQUIRED');
const irNullDefSem = SemanticAnalyzer.analyze(irNullDefAst);
const irNullDef = IRGenerator.generate(irNullDefAst, irNullDefSem);
const instNullDef = irNullDef.instructions.find(i => i.op === 'ADD_FIELD' && i.field === 'name');
assertEqual('instNullDef defaultValue is null', instNullDef.defaultValue, null);
assertEqual('instNullDef validations is empty array', instNullDef.validations, []);

// ── IR Test: Multiple fields with different validations/defaults ──
console.log('');
console.log('── IR: Multiple fields with different validations/defaults ──');
const irMultiAst = lexAndParse([
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'age INT MIN 18 MAX 60 DEFAULT 25',
    'status STRING DEFAULT "active"',
    'active BOOLEAN DEFAULT TRUE'
].join('\n'));
const irMultiSem = SemanticAnalyzer.analyze(irMultiAst);
const irMulti = IRGenerator.generate(irMultiAst, irMultiSem);
assertEqual('irMulti instructions length', irMulti.instructions.length, 6);
const addFields = irMulti.instructions.filter(i => i.op === 'ADD_FIELD');
assertEqual('addFields length is 5', addFields.length, 5);

// ── IR Test: Correct line preservation ──
console.log('');
console.log('── IR: Correct line preservation ──');
assertEqual('id line is 2', addFields[0].line, 2);
assertEqual('name line is 3', addFields[1].line, 3);
assertEqual('age line is 4', addFields[2].line, 4);
assertEqual('status line is 5', addFields[3].line, 5);
assertEqual('active line is 6', addFields[4].line, 6);

// ── IR Test: IR validator accepts valid validation structures ──
console.log('');
console.log('── IR: IR validator accepts valid validation structures ──');
const validIRWithValidations = {
    type: 'PROGRAM',
    instructions: [
        {
            op: 'CREATE_ENTITY',
            entity: 'Student'
        },
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: [],
            validations: [
                { type: 'MIN', value: 18 },
                { type: 'MAX', value: 60 }
            ],
            defaultValue: {
                type: 'NUMBER',
                value: 25
            }
        }
    ]
};
const valRes1 = IRGenerator.validate(validIRWithValidations);
assertTrue('validIRWithValidations is valid', valRes1.valid);
assertEqual('valRes1 errors empty', valRes1.errors.length, 0);

// ── IR Test: IR validator rejects invalid validation structure ──
console.log('');
console.log('── IR: IR validator rejects invalid validation structure ──');
const invalidValTypeIR = {
    type: 'PROGRAM',
    instructions: [
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: [],
            validations: [{ type: 'GREATER_THAN', value: 10 }]
        }
    ]
};
const valRes2 = IRGenerator.validate(invalidValTypeIR);
assertTrue('invalidValTypeIR is invalid', !valRes2.valid);
assertTrue('Error mentions invalid type', valRes2.errors.some(e => e.includes("invalid type 'GREATER_THAN'")));

const invalidValValueIR = {
    type: 'PROGRAM',
    instructions: [
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: [],
            validations: [{ type: 'MIN', value: 'eighteen' }]
        }
    ]
};
const valRes3 = IRGenerator.validate(invalidValValueIR);
assertTrue('invalidValValueIR is invalid', !valRes3.valid);
assertTrue('Error mentions numeric value', valRes3.errors.some(e => e.includes("must have a numeric 'value'")));

const invalidValNotArrayIR = {
    type: 'PROGRAM',
    instructions: [
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: [],
            validations: 'not-an-array'
        }
    ]
};
const valRes4 = IRGenerator.validate(invalidValNotArrayIR);
assertTrue('invalidValNotArrayIR is invalid', !valRes4.valid);
assertTrue('Error mentions validations array', valRes4.errors.some(e => e.includes("must have a 'validations' array")));

// ── IR Test: IR validator accepts valid default structures ──
console.log('');
console.log('── IR: IR validator accepts valid default structures ──');
const validDefaultsIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Test', field: 'f1', dataType: 'INT', constraints: [], defaultValue: { type: 'NUMBER', value: 42 } },
        { op: 'ADD_FIELD', entity: 'Test', field: 'f2', dataType: 'STRING', constraints: [], defaultValue: { type: 'STRING', value: 'hello' } },
        { op: 'ADD_FIELD', entity: 'Test', field: 'f3', dataType: 'BOOLEAN', constraints: [], defaultValue: { type: 'BOOLEAN', value: true } },
        { op: 'ADD_FIELD', entity: 'Test', field: 'f4', dataType: 'INT', constraints: [], defaultValue: null }
    ]
};
const valRes5 = IRGenerator.validate(validDefaultsIR);
assertTrue('validDefaultsIR is valid', valRes5.valid);
assertEqual('valRes5 errors empty', valRes5.errors.length, 0);

// ── IR Test: IR validator rejects invalid default structure ──
console.log('');
console.log('── IR: IR validator rejects invalid default structure ──');
const invalidDefTypeIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Test', field: 'f1', dataType: 'INT', constraints: [], defaultValue: { type: 'OBJECT', value: {} } }
    ]
};
const valRes6 = IRGenerator.validate(invalidDefTypeIR);
assertTrue('invalidDefTypeIR is invalid', !valRes6.valid);
assertTrue('Error mentions invalid type OBJECT', valRes6.errors.some(e => e.includes("invalid type 'OBJECT'")));

const invalidDefMismatchIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Test', field: 'f1', dataType: 'INT', constraints: [], defaultValue: { type: 'NUMBER', value: 'not-a-number' } }
    ]
};
const valRes7 = IRGenerator.validate(invalidDefMismatchIR);
assertTrue('invalidDefMismatchIR is invalid', !valRes7.valid);
assertTrue('Error mentions numeric value for NUMBER default', valRes7.errors.some(e => e.includes("must have a numeric value")));

const invalidDefNotObjIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Test', field: 'f1', dataType: 'INT', constraints: [], defaultValue: 'active' }
    ]
};
const valRes8 = IRGenerator.validate(invalidDefNotObjIR);
assertTrue('invalidDefNotObjIR is invalid', !valRes8.valid);
assertTrue('Error mentions must be an object or null', valRes8.errors.some(e => e.includes("must be an object or null")));


// ═════════════════════════════════════════════════════════════
// OPTIMIZER: FIELD VALIDATION & DEFAULT VALUE TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'optimizer';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Optimizer: Validation & Default Tests       ║');
console.log('╚══════════════════════════════════════════════╝');

// ── Test 1: No validations -> unchanged ──
console.log('');
console.log('── Optimizer: No validations unchanged ──');
const opt1_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], validations: [], defaultValue: null }
    ]
};
const opt1 = Optimizer.optimize(opt1_in);
assertEqual('opt1 instructions length', opt1.ir.instructions.length, 2);
assertEqual('opt1 validations still empty', opt1.ir.instructions[1].validations, []);
assertEqual('opt1 optimizations empty', opt1.optimizations.length, 0);

// ── Test 2: One MIN -> unchanged ──
console.log('');
console.log('── Optimizer: One MIN unchanged ──');
const opt2_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }], defaultValue: null }
    ]
};
const opt2 = Optimizer.optimize(opt2_in);
assertEqual('opt2 validations', opt2.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }]);
assertTrue('opt2 no validation normalization pass', !opt2.optimizations.some(o => o.pass === 'Validation Normalization'));

// ── Test 3: One MAX -> unchanged ──
console.log('');
console.log('── Optimizer: One MAX unchanged ──');
const opt3_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 65 }], defaultValue: null }
    ]
};
const opt3 = Optimizer.optimize(opt3_in);
assertEqual('opt3 validations', opt3.ir.instructions[0].validations, [{ type: 'MAX', value: 65 }]);

// ── Test 4: MIN + MAX already ordered -> unchanged ──
console.log('');
console.log('── Optimizer: MIN + MAX already ordered unchanged ──');
const opt4_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }], defaultValue: null }
    ]
};
const opt4 = Optimizer.optimize(opt4_in);
assertEqual('opt4 validations', opt4.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);
assertTrue('opt4 no validation normalization pass', !opt4.optimizations.some(o => o.pass === 'Validation Normalization'));

// ── Test 5: MAX + MIN -> normalized to MIN + MAX ──
console.log('');
console.log('── Optimizer: MAX + MIN normalized to MIN + MAX ──');
const opt5_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 60 }, { type: 'MIN', value: 18 }], defaultValue: null }
    ]
};
const opt5 = Optimizer.optimize(opt5_in);
assertEqual('opt5 normalized validations', opt5.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);
assertTrue('opt5 has Validation Normalization pass', opt5.optimizations.some(o => o.pass === 'Validation Normalization'));

// ── Test 6: Exact duplicate MIN removed ──
console.log('');
console.log('── Optimizer: Exact duplicate MIN removed ──');
const opt6_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MIN', value: 18 }], defaultValue: null }
    ]
};
const opt6 = Optimizer.optimize(opt6_in);
assertEqual('opt6 duplicate MIN eliminated', opt6.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }]);
assertTrue('opt6 has Duplicate Validation Elimination pass', opt6.optimizations.some(o => o.pass === 'Duplicate Validation Elimination'));

// ── Test 7: Exact duplicate MAX removed ──
console.log('');
console.log('── Optimizer: Exact duplicate MAX removed ──');
const opt7_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 60 }, { type: 'MAX', value: 60 }], defaultValue: null }
    ]
};
const opt7 = Optimizer.optimize(opt7_in);
assertEqual('opt7 duplicate MAX eliminated', opt7.ir.instructions[0].validations, [{ type: 'MAX', value: 60 }]);
assertTrue('opt7 has Duplicate Validation Elimination pass', opt7.optimizations.some(o => o.pass === 'Duplicate Validation Elimination'));

// ── Test 8: Different validation values preserved ──
console.log('');
console.log('── Optimizer: Different validation values preserved ──');
const opt8_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MIN', value: 20 }], defaultValue: null }
    ]
};
const opt8 = Optimizer.optimize(opt8_in);
assertEqual('opt8 preserves different MIN values', opt8.ir.instructions[0].validations.length, 2);
assertEqual('opt8 validations', opt8.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }, { type: 'MIN', value: 20 }]);

// ── Test 9: Default value preserved ──
console.log('');
console.log('── Optimizer: Default value preserved ──');
const opt9_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [], defaultValue: { type: 'NUMBER', value: 25 } }
    ]
};
const opt9 = Optimizer.optimize(opt9_in);
assertEqual('opt9 defaultValue', opt9.ir.instructions[0].defaultValue, { type: 'NUMBER', value: 25 });

// ── Test 10: String default preserved ──
console.log('');
console.log('── Optimizer: String default preserved ──');
const opt10_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'status', dataType: 'STRING', constraints: [], validations: [], defaultValue: { type: 'STRING', value: 'active' } }
    ]
};
const opt10 = Optimizer.optimize(opt10_in);
assertEqual('opt10 defaultValue', opt10.ir.instructions[0].defaultValue, { type: 'STRING', value: 'active' });

// ── Test 11: Boolean default preserved ──
console.log('');
console.log('── Optimizer: Boolean default preserved ──');
const opt11_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'active', dataType: 'BOOLEAN', constraints: [], validations: [], defaultValue: { type: 'BOOLEAN', value: true } }
    ]
};
const opt11 = Optimizer.optimize(opt11_in);
assertEqual('opt11 defaultValue', opt11.ir.instructions[0].defaultValue, { type: 'BOOLEAN', value: true });

// ── Test 12: Numeric default preserved ──
console.log('');
console.log('── Optimizer: Numeric default preserved ──');
const opt12_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Product', field: 'price', dataType: 'FLOAT', constraints: [], validations: [], defaultValue: { type: 'NUMBER', value: 19.99 } }
    ]
};
const opt12 = Optimizer.optimize(opt12_in);
assertEqual('opt12 defaultValue', opt12.ir.instructions[0].defaultValue, { type: 'NUMBER', value: 19.99 });

// ── Test 13: Validation + default together preserved ──
console.log('');
console.log('── Optimizer: Validation + default together preserved ──');
const opt13_in = {
    type: 'PROGRAM',
    instructions: [
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: ['REQUIRED'],
            validations: [{ type: 'MAX', value: 60 }, { type: 'MIN', value: 18 }],
            defaultValue: { type: 'NUMBER', value: 25 }
        }
    ]
};
const opt13 = Optimizer.optimize(opt13_in);
assertEqual('opt13 normalized validations', opt13.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);
assertEqual('opt13 defaultValue', opt13.ir.instructions[0].defaultValue, { type: 'NUMBER', value: 25 });
assertEqual('opt13 constraints', opt13.ir.instructions[0].constraints, ['REQUIRED']);

// ── Test 14: Multiple fields optimized independently ──
console.log('');
console.log('── Optimizer: Multiple fields optimized independently ──');
const opt14_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 60 }, { type: 'MIN', value: 18 }], defaultValue: null },
        { op: 'ADD_FIELD', entity: 'Student', field: 'score', dataType: 'FLOAT', constraints: [], validations: [{ type: 'MAX', value: 100 }, { type: 'MIN', value: 0 }], defaultValue: { type: 'NUMBER', value: 75 } }
    ]
};
const opt14 = Optimizer.optimize(opt14_in);
assertEqual('opt14 field 1 validations', opt14.ir.instructions[0].validations, [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }]);
assertEqual('opt14 field 2 validations', opt14.ir.instructions[1].validations, [{ type: 'MIN', value: 0 }, { type: 'MAX', value: 100 }]);
assertEqual('opt14 field 2 defaultValue', opt14.ir.instructions[1].defaultValue, { type: 'NUMBER', value: 75 });
const valNormPass = opt14.optimizations.find(o => o.pass === 'Validation Normalization');
assertTrue('opt14 has Validation Normalization count 2', valNormPass && valNormPass.count === 2);

// ── Test 15: Entity and field order preserved ──
console.log('');
console.log('── Optimizer: Entity and field order preserved ──');
const opt15_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], validations: [], defaultValue: null, line: 2 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'name', dataType: 'STRING', constraints: ['REQUIRED'], validations: [], defaultValue: null, line: 3 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 60 }, { type: 'MIN', value: 18 }], defaultValue: { type: 'NUMBER', value: 25 }, line: 4 }
    ]
};
const opt15 = Optimizer.optimize(opt15_in);
assertEqual('opt15 count is 4', opt15.ir.instructions.length, 4);
assertEqual('opt15 inst 0 is CREATE_ENTITY', opt15.ir.instructions[0].op, 'CREATE_ENTITY');
assertEqual('opt15 inst 1 field is id', opt15.ir.instructions[1].field, 'id');
assertEqual('opt15 inst 2 field is name', opt15.ir.instructions[2].field, 'name');
assertEqual('opt15 inst 3 field is age', opt15.ir.instructions[3].field, 'age');
assertEqual('opt15 lines preserved', [opt15.ir.instructions[0].line, opt15.ir.instructions[1].line, opt15.ir.instructions[2].line, opt15.ir.instructions[3].line], [1, 2, 3, 4]);

// ── Test 16: Optimized IR passes Phase 4 validation ──
console.log('');
console.log('── Optimizer: Optimized IR passes Phase 4 validation ──');
const opt16Val = IRGenerator.validate(opt15.ir);
assertTrue('opt15 optimized IR is valid in Phase 4 validator', opt16Val.valid);
assertEqual('opt16Val errors empty', opt16Val.errors.length, 0);

// ── Test 17: Duplicate field elimination pass considers validations & defaults ──
console.log('');
console.log('── Optimizer: Duplicate field elimination with validations & defaults ──');
const opt17_in = {
    type: 'PROGRAM',
    instructions: [
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }], defaultValue: { type: 'NUMBER', value: 25 } },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }], defaultValue: { type: 'NUMBER', value: 25 } }
    ]
};
const opt17 = Optimizer.optimize(opt17_in);
assertEqual('opt17 duplicate ADD_FIELD removed', opt17.ir.instructions.length, 1);
assertTrue('opt17 has Duplicate Field Elimination pass', opt17.optimizations.some(o => o.pass === 'Duplicate Field Elimination'));


// ═════════════════════════════════════════════════════════════
// CODE GENERATOR: FIELD VALIDATION & DEFAULT VALUE TESTS
// ═════════════════════════════════════════════════════════════

currentPhase = 'codegen';
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  Codegen: Validation & Default Tests         ║');
console.log('╚══════════════════════════════════════════════╝');

// ── Codegen Test: INT DEFAULT ──
console.log('');
console.log('── Codegen: INT DEFAULT ──');
const sqlIntDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], defaultValue: { type: 'NUMBER', value: 25 } }
    ]
});
assertTrue('SQL contains age INT DEFAULT 25', sqlIntDef.includes('age INT DEFAULT 25'));

// ── Codegen Test: FLOAT DEFAULT ──
console.log('');
console.log('── Codegen: FLOAT DEFAULT ──');
const sqlFloatDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'cgpa', dataType: 'FLOAT', constraints: [], defaultValue: { type: 'NUMBER', value: 8.5 } }
    ]
});
assertTrue('SQL contains cgpa FLOAT DEFAULT 8.5', sqlFloatDef.includes('cgpa FLOAT DEFAULT 8.5'));

// ── Codegen Test: STRING DEFAULT ──
console.log('');
console.log('── Codegen: STRING DEFAULT ──');
const sqlStrDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'status', dataType: 'STRING', constraints: [], defaultValue: { type: 'STRING', value: 'active' } }
    ]
});
assertTrue("SQL contains status VARCHAR(255) DEFAULT 'active'", sqlStrDef.includes("status VARCHAR(255) DEFAULT 'active'"));

// ── Codegen Test: BOOLEAN DEFAULT TRUE ──
console.log('');
console.log('── Codegen: BOOLEAN DEFAULT TRUE ──');
const sqlBoolTrue = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'active', dataType: 'BOOLEAN', constraints: [], defaultValue: { type: 'BOOLEAN', value: true } }
    ]
});
assertTrue('SQL contains active BOOLEAN DEFAULT TRUE', sqlBoolTrue.includes('active BOOLEAN DEFAULT TRUE'));

// ── Codegen Test: BOOLEAN DEFAULT FALSE ──
console.log('');
console.log('── Codegen: BOOLEAN DEFAULT FALSE ──');
const sqlBoolFalse = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'active', dataType: 'BOOLEAN', constraints: [], defaultValue: { type: 'BOOLEAN', value: false } }
    ]
});
assertTrue('SQL contains active BOOLEAN DEFAULT FALSE', sqlBoolFalse.includes('active BOOLEAN DEFAULT FALSE'));

// ── Codegen Test: MIN only ──
console.log('');
console.log('── Codegen: MIN only ──');
const sqlMinOnly = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }] }
    ]
});
assertTrue('SQL contains CHECK (age >= 18)', sqlMinOnly.includes('CHECK (age >= 18)'));

// ── Codegen Test: MAX only ──
console.log('');
console.log('── Codegen: MAX only ──');
const sqlMaxOnly = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MAX', value: 60 }] }
    ]
});
assertTrue('SQL contains CHECK (age <= 60)', sqlMaxOnly.includes('CHECK (age <= 60)'));

// ── Codegen Test: MIN + MAX ──
console.log('');
console.log('── Codegen: MIN + MAX ──');
const sqlMinMax = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }] }
    ]
});
assertTrue('SQL contains CHECK (age >= 18 AND age <= 60)', sqlMinMax.includes('CHECK (age >= 18 AND age <= 60)'));

// ── Codegen Test: REQUIRED + DEFAULT ──
console.log('');
console.log('── Codegen: REQUIRED + DEFAULT ──');
const sqlReqDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'status', dataType: 'STRING', constraints: ['REQUIRED'], defaultValue: { type: 'STRING', value: 'active' } }
    ]
});
assertTrue('SQL contains NOT NULL and DEFAULT', sqlReqDef.includes("status VARCHAR(255) NOT NULL DEFAULT 'active'"));

// ── Codegen Test: UNIQUE + DEFAULT ──
console.log('');
console.log('── Codegen: UNIQUE + DEFAULT ──');
const sqlUniqDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'status', dataType: 'STRING', constraints: ['UNIQUE'], defaultValue: { type: 'STRING', value: 'active' } }
    ]
});
assertTrue('SQL contains UNIQUE and DEFAULT', sqlUniqDef.includes("DEFAULT 'active'") && sqlUniqDef.includes('UNIQUE'));

// ── Codegen Test: PRIMARY KEY behavior (with and without default) ──
console.log('');
console.log('── Codegen: PRIMARY KEY behavior ──');
const sqlPkNoDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'] }
    ]
});
assertTrue('PK without default has AUTO_INCREMENT', sqlPkNoDef.includes('id INT PRIMARY KEY AUTO_INCREMENT'));

const sqlPkWithDef = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], defaultValue: { type: 'NUMBER', value: 1 } }
    ]
});
assertTrue('PK with default has DEFAULT 1 without AUTO_INCREMENT', sqlPkWithDef.includes('id INT PRIMARY KEY DEFAULT 1') && !sqlPkWithDef.includes('AUTO_INCREMENT'));

// ── Codegen Test: MIN/MAX + DEFAULT + REQUIRED ──
console.log('');
console.log('── Codegen: MIN/MAX + DEFAULT + REQUIRED ──');
const sqlCombined = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student' },
        {
            op: 'ADD_FIELD',
            entity: 'Student',
            field: 'age',
            dataType: 'INT',
            constraints: ['REQUIRED'],
            validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }],
            defaultValue: { type: 'NUMBER', value: 25 }
        }
    ]
});
assertTrue('SQL coherent combined definition', sqlCombined.includes('age INT NOT NULL DEFAULT 25 CHECK (age >= 18 AND age <= 60)'));

// ── Codegen Test: SQL string escaping ──
console.log('');
console.log('── Codegen: SQL string escaping ──');
const sqlEscaped = CodeGenerator.generateSQL({
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Book' },
        { op: 'ADD_FIELD', entity: 'Book', field: 'author', dataType: 'STRING', constraints: [], defaultValue: { type: 'STRING', value: "O'Reilly" } }
    ]
});
assertTrue("SQL escapes single quotes correctly", sqlEscaped.includes("author VARCHAR(255) DEFAULT 'O''Reilly'"));

// ── Codegen Test: API validation function in generated controller ──
console.log('');
console.log('── Codegen: API validation in controller ──');
const studentFields = [
    { name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], validations: [], defaultValue: null },
    { name: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }], defaultValue: { type: 'NUMBER', value: 25 } },
    { name: 'score', dataType: 'FLOAT', constraints: [], validations: [{ type: 'MIN', value: 0 }, { type: 'MAX', value: 100 }], defaultValue: null }
];
const ctrlContent = CodeGenerator.generateController('Student', studentFields);
assertTrue('Controller contains validateStudent function', ctrlContent.includes('function validateStudent(data)'));
assertTrue('Controller contains min check for age', ctrlContent.includes("data.age < 18"));
assertTrue('Controller contains max check for age', ctrlContent.includes("data.age > 60"));
assertTrue('Controller contains min check for score', ctrlContent.includes("data.score < 0"));
assertTrue('Controller contains max check for score', ctrlContent.includes("data.score > 100"));
assertTrue('Controller create calls validateStudent', ctrlContent.includes("const validationError = validateStudent(req.body)"));
assertTrue('Controller update calls validateStudent', ctrlContent.includes("const validationError = validateStudent(req.body)"));

// ── Codegen Test: Execute generated validation function directly via Function constructor ──
console.log('');
console.log('── Codegen: Execute validate function directly ──');
const fnMatch = ctrlContent.match(/function validateStudent\(data\) \{[\s\S]*?\n\}/);
assertTrue('Found validateStudent function implementation', !!fnMatch);
const validateStudentFn = new Function('data', fnMatch[0].replace('function validateStudent(data) {', '').replace(/\n\}$/, ''));

// API validation below MIN
assertEqual('Reject below MIN (age: 12)', validateStudentFn({ age: 12 }), "Field 'age' must be >= 18.");
// API validation above MAX
assertEqual('Reject above MAX (age: 75)', validateStudentFn({ age: 75 }), "Field 'age' must be <= 60.");
// API accepts valid value
assertEqual('Accept valid (age: 25)', validateStudentFn({ age: 25 }), null);
// API accepts boundary values
assertEqual('Accept min boundary (age: 18)', validateStudentFn({ age: 18 }), null);
assertEqual('Accept max boundary (age: 60)', validateStudentFn({ age: 60 }), null);
// API allows omitted field (relies on DB default)
assertEqual('Accept omitted field payload', validateStudentFn({ name: 'Aniketh' }), null);

// ── Codegen Test: Swagger Schema metadata (minimum, maximum, default) ──
console.log('');
console.log('── Codegen: Swagger schema metadata ──');
const swaggerDoc = JSON.parse(CodeGenerator.generateSwagger([
    {
        name: 'Student',
        fields: [
            { name: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], validations: [], defaultValue: null },
            { name: 'name', dataType: 'STRING', constraints: ['REQUIRED'], validations: [], defaultValue: { type: 'STRING', value: 'Guest' } },
            { name: 'age', dataType: 'INT', constraints: [], validations: [{ type: 'MIN', value: 18 }, { type: 'MAX', value: 60 }], defaultValue: { type: 'NUMBER', value: 25 } },
            { name: 'cgpa', dataType: 'FLOAT', constraints: [], validations: [{ type: 'MIN', value: 0.0 }, { type: 'MAX', value: 10.0 }], defaultValue: { type: 'NUMBER', value: 8.5 } },
            { name: 'active', dataType: 'BOOLEAN', constraints: [], validations: [], defaultValue: { type: 'BOOLEAN', value: true } }
        ]
    }
]));

const studentSchema = swaggerDoc.components.schemas.Student.properties;
assertEqual('Swagger age type is integer', studentSchema.age.type, 'integer');
assertEqual('Swagger age minimum is 18', studentSchema.age.minimum, 18);
assertEqual('Swagger age maximum is 60', studentSchema.age.maximum, 60);
assertEqual('Swagger age default is 25', studentSchema.age.default, 25);
assertEqual('Swagger name default is Guest', studentSchema.name.default, 'Guest');
assertEqual('Swagger cgpa minimum is 0', studentSchema.cgpa.minimum, 0);
assertEqual('Swagger cgpa maximum is 10', studentSchema.cgpa.maximum, 10);
assertEqual('Swagger cgpa default is 8.5', studentSchema.cgpa.default, 8.5);
assertEqual('Swagger active default is true', studentSchema.active.default, true);

// ── Codegen Test: Existing CRUD and relationship generation remains intact ──
console.log('');
console.log('── Codegen: Relationships and CRUD intact ──');
const relCodegenIR = {
    type: 'PROGRAM',
    instructions: [
        { op: 'CREATE_ENTITY', entity: 'Student', line: 1 },
        { op: 'ADD_FIELD', entity: 'Student', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], validations: [], defaultValue: null },
        { op: 'CREATE_ENTITY', entity: 'Course', line: 3 },
        { op: 'ADD_FIELD', entity: 'Course', field: 'id', dataType: 'INT', constraints: ['PRIMARY_KEY'], validations: [], defaultValue: null },
        { op: 'CREATE_RELATION', sourceEntity: 'Student', relationName: 'ENROLLS_IN', targetEntity: 'Course', relationType: 'MANY_TO_MANY', line: 5 }
    ]
};
const relFiles = CodeGenerator.generate(relCodegenIR, false);
assertTrue('Relationship code generation succeeds', relFiles.success);
const relSql = relFiles.files.find(f => f.path === 'database/schema.sql').content;
assertTrue('Contains Student_Course junction table', relSql.includes('CREATE TABLE Student_Course'));

// ── API Test: Health endpoint ───────────────────────────────
console.log('');
console.log('── API Test: GET /health ──');

const healthResult = await simulateGet('/health');
assertEqual('API health returns status ok', healthResult.status, 'ok');
assertEqual('API health returns version', healthResult.version, '1.0.0');

// ── API Test: Missing body ──────────────────────────────────
console.log('');
console.log('── API Test: Missing/undefined body ──');

const missingBodyResult = await simulatePost('/compile', undefined);
assertTrue('API missing body returns success false', missingBodyResult.success === false);
assertTrue('API missing body returns 400', missingBodyResult._statusCode === 400);

// ── API Test: Empty source string ───────────────────────────
console.log('');
console.log('── API Test: Empty source string ──');

const emptySourceResult = await simulatePost('/compile', { source: '' });
assertTrue('API empty source returns success false', emptySourceResult.success === false);
assertTrue('API empty source returns 422', emptySourceResult._statusCode === 422);
assertTrue('API empty source fails in semantic phase', emptySourceResult.phase === 'semantic');
assertEqual('API empty source error code', emptySourceResult.errors[0].code, 'MISSING_ENTITY_DECLARATION');

// ── API Test: Whitespace/comment-only sources ───────────────
console.log('');
console.log('── API Test: Whitespace/comment-only sources ──');

for (const [label, source] of [['whitespace-only', ' \t\r\n  '], ['comment-only', '// no entities']]) {
    const result = await simulatePost('/compile', { source });
    assertTrue(`API ${label} source returns 422`, result._statusCode === 422);
    assertTrue(`API ${label} source fails in semantic phase`, result.phase === 'semantic');
    assertEqual(`API ${label} source error code`, result.errors[0].code, 'MISSING_ENTITY_DECLARATION');
    assertTrue(`API ${label} source produces no generated files`, result.generatedFiles === undefined);
}

// ── CLI Test: Empty program stops before code generation ───
console.log('');
console.log('── CLI Test: Empty program stops before code generation ──');

const cliTempDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'apiforge-empty-cli-'));
try {
    const emptyCliSource = nodePath.join(cliTempDir, 'empty.apiforge');
    nodeFs.writeFileSync(emptyCliSource, '', 'utf8');
    const cliResult = spawnSync(process.execPath, [nodePath.resolve(__dirname, '..', 'index.js'), emptyCliSource], {
        cwd: cliTempDir,
        encoding: 'utf8'
    });
    assertTrue('CLI empty program exits nonzero', cliResult.status !== 0);
    assertTrue('CLI empty program reports the language rule',
        cliResult.stdout.includes('APIForge programs must contain at least one ENTITY.'));
    assertTrue('CLI empty program produces no output directory',
        !nodeFs.existsSync(nodePath.join(cliTempDir, 'output')));
} finally {
    nodeFs.rmSync(cliTempDir, { recursive: true, force: true });
}

// ── API Test: Non-string source ─────────────────────────────
console.log('');
console.log('── API Test: Non-string source ──');

const nonStringResult = await simulatePost('/compile', { source: 12345 });
assertTrue('API non-string source returns success false', nonStringResult.success === false);
assertTrue('API non-string source returns 400', nonStringResult._statusCode === 400);

// ── API Test: Lexer error returns 400 ───────────────────────
console.log('');
console.log('── API Test: Lexer error returns 400 ──');

const lexerErrResult = await simulatePost('/compile', { source: 'ENTITY Student\n@ invalid' });
assertTrue('API lexer error returns success false', lexerErrResult.success === false);
assertTrue('API lexer error returns 400', lexerErrResult._statusCode === 400);
assertTrue('API lexer error phase is lexer', lexerErrResult.phase === 'lexer');

// ── API Test: Parser error returns 400 ──────────────────────
console.log('');
console.log('── API Test: Parser error returns 400 ──');

const parserErrResult = await simulatePost('/compile', { source: 'ENTITY' });
assertTrue('API parser error returns 400', parserErrResult._statusCode === 400);
assertTrue('API parser error phase is parser', parserErrResult.phase === 'parser');

// ── API Test: Semantic error returns 422 ────────────────────
console.log('');
console.log('── API Test: Semantic error returns 422 ──');

const semErrResult = await simulatePost('/compile', { source: 'ENTITY Student\n\nname STRING\nname INT' });
assertTrue('API semantic error returns 422', semErrResult._statusCode === 422);
assertTrue('API semantic error phase is semantic', semErrResult.phase === 'semantic');

// ═════════════════════════════════════════════════════════════
// END-TO-END PIPELINE TEST: ALL SIX PHASES (PART 12)
// ═════════════════════════════════════════════════════════════

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  End-to-End Pipeline: All 6 Phases Test      ║');
console.log('╚══════════════════════════════════════════════╝');

const e2eDSL = [
    'ENTITY Student',
    '',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED',
    'age INT MIN 18 MAX 60 DEFAULT 25',
    'status STRING DEFAULT "active"',
    'cgpa FLOAT MIN 0.0 MAX 10.0 DEFAULT 8.5',
    'active BOOLEAN DEFAULT TRUE'
].join('\n');

// Phase 1: Lexer
const e2eTokens = Lexer.tokenize(e2eDSL);
assertTrue('E2E: Lexer produced tokens', Array.isArray(e2eTokens) && e2eTokens.length > 0);

// Phase 2: Parser
const e2eAST = Parser.parse(e2eTokens);
assertTrue('E2E: Parser produced AST', e2eAST && e2eAST.entities.length === 1);
assertEqual('E2E: Student entity parsed with 6 fields', e2eAST.entities[0].fields.length, 6);

// Phase 3: Semantic Analyzer
const e2eSem = SemanticAnalyzer.analyze(e2eAST);
assertTrue('E2E: Semantic analysis passed', e2eSem.valid);
assertEqual('E2E: Semantic errors empty', e2eSem.errors.length, 0);
assertTrue('E2E: Symbol table has Student', 'Student' in e2eSem.symbolTable);

// Phase 4: IR Generation
const e2eIR = IRGenerator.generate(e2eAST, e2eSem);
assertTrue('E2E: IR generated', e2eIR && e2eIR.instructions.length === 7);
const e2eIRVal = IRGenerator.validate(e2eIR);
assertTrue('E2E: IR passes validation', e2eIRVal.valid);

// Phase 5: Optimizer
const e2eOpt = Optimizer.optimize(e2eIR);
assertTrue('E2E: Optimizer produced valid IR', e2eOpt && e2eOpt.ir.instructions.length === 7);

// Phase 6: Code Generation
const e2eCodegen = CodeGenerator.generate(e2eOpt.ir, false);
assertTrue('E2E: Code generation succeeded', e2eCodegen.success);
assertTrue('E2E: 10 files generated', e2eCodegen.files.length === 10);

const e2eSql = e2eCodegen.files.find(f => f.path === 'database/schema.sql').content;
assertTrue('E2E SQL: contains age INT', e2eSql.includes('age INT'));
assertTrue('E2E SQL: contains DEFAULT 25', e2eSql.includes('DEFAULT 25'));
assertTrue('E2E SQL: contains CHECK for age >= 18 AND age <= 60', e2eSql.includes('CHECK (age >= 18 AND age <= 60)'));
assertTrue("E2E SQL: contains status DEFAULT 'active'", e2eSql.includes("status VARCHAR(255) DEFAULT 'active'"));
assertTrue('E2E SQL: contains cgpa CHECK (cgpa >= 0 AND cgpa <= 10)', e2eSql.includes('CHECK (cgpa >= 0 AND cgpa <= 10)'));
assertTrue('E2E SQL: contains cgpa DEFAULT 8.5', e2eSql.includes('DEFAULT 8.5'));
assertTrue('E2E SQL: contains active BOOLEAN DEFAULT TRUE', e2eSql.includes('active BOOLEAN DEFAULT TRUE'));

const e2eSwagger = JSON.parse(e2eCodegen.files.find(f => f.path === 'swagger.json').content);
const e2eSwaggerProps = e2eSwagger.components.schemas.Student.properties;
assertEqual('E2E Swagger: age minimum 18', e2eSwaggerProps.age.minimum, 18);
assertEqual('E2E Swagger: age maximum 60', e2eSwaggerProps.age.maximum, 60);
assertEqual('E2E Swagger: age default 25', e2eSwaggerProps.age.default, 25);
assertEqual('E2E Swagger: status default active', e2eSwaggerProps.status.default, 'active');
assertEqual('E2E Swagger: cgpa default 8.5', e2eSwaggerProps.cgpa.default, 8.5);
assertEqual('E2E Swagger: active default true', e2eSwaggerProps.active.default, true);


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
