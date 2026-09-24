const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const SemanticAnalyzer = require('../src/semantic/analyzer');
const IRGenerator = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const CodeGenerator = require('../src/codegen/codegen');

const requestedPhase = process.argv[2] || 'all';
const validPhases = new Set(['all', 'lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen', 'integration', 'frontend']);

if (!validPhases.has(requestedPhase)) {
    throw new Error(`Unknown test phase '${requestedPhase}'.`);
}

let passed = 0;

function test(name, fn) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

function phase(name, fn) {
    if (requestedPhase === 'all' || requestedPhase === name) {
        console.log(`\n${name.toUpperCase()}`);
        fn();
    }
}

function parse(source) {
    return Parser.parse(Lexer.tokenize(source));
}

function analyze(source) {
    const ast = parse(source);
    return { ast, result: SemanticAnalyzer.analyze(ast) };
}

function expectSemanticError(source, messagePart) {
    const { result } = analyze(source);
    assert.strictEqual(result.valid, false);
    assert(result.errors.some(error => error.message.includes(messagePart)), JSON.stringify(result.errors));
}

function compile(source) {
    const tokens = Lexer.tokenize(source);
    const ast = Parser.parse(tokens);
    const semantic = SemanticAnalyzer.analyze(ast);
    assert.strictEqual(semantic.valid, true, JSON.stringify(semantic.errors));
    const ir = IRGenerator.generate(ast, semantic);
    const optimized = Optimizer.optimize(ir).ir;
    const generated = CodeGenerator.generate(optimized, false);
    return { tokens, ast, semantic, ir, optimized, generated };
}

phase('lexer', () => {
    test('recognizes MIN_LENGTH and MAX_LENGTH as uppercase modifiers', () => {
        const tokens = Lexer.tokenize('MIN_LENGTH MAX_LENGTH');
        assert.deepStrictEqual(tokens.slice(0, 2).map(token => [token.type, token.value]), [
            ['MODIFIER', 'MIN_LENGTH'],
            ['MODIFIER', 'MAX_LENGTH']
        ]);
    });

    test('preserves existing case-sensitive keyword behavior', () => {
        const tokens = Lexer.tokenize('min_length max_length');
        assert.deepStrictEqual(tokens.slice(0, 2).map(token => token.type), ['IDENTIFIER', 'IDENTIFIER']);
    });
});

phase('parser', () => {
    test('parses one-sided MIN_LENGTH and MAX_LENGTH validations', () => {
        const ast = parse('ENTITY User\nname STRING MIN_LENGTH 3\nbio STRING MAX_LENGTH 500');
        assert.deepStrictEqual(ast.entities[0].fields[0].validations, [{ type: 'MIN_LENGTH', value: 3 }]);
        assert.deepStrictEqual(ast.entities[0].fields[1].validations, [{ type: 'MAX_LENGTH', value: 500 }]);
    });

    test('parses both length modifiers with constraints and DEFAULT in source order', () => {
        const field = parse('ENTITY User\nrole STRING REQUIRED UNIQUE DEFAULT "student" MAX_LENGTH 20 MIN_LENGTH 3').entities[0].fields[0];
        assert.deepStrictEqual(field.constraints, ['REQUIRED', 'UNIQUE']);
        assert.deepStrictEqual(field.defaultValue, { type: 'STRING', value: 'student' });
        assert.deepStrictEqual(field.validations, [
            { type: 'MAX_LENGTH', value: 20 },
            { type: 'MIN_LENGTH', value: 3 }
        ]);
    });

    test('reports a positioned parser error for a missing length value', () => {
        assert.throws(
            () => parse('ENTITY User\nname STRING MIN_LENGTH'),
            error => error.code === 'MISSING_MIN_LENGTH_VALUE' && error.line === 2 && error.column > 0
        );
    });
});

phase('semantic', () => {
    test('accepts independent, combined, zero, and valid DEFAULT length rules on STRING', () => {
        const { result } = analyze([
            'ENTITY User',
            'a STRING MIN_LENGTH 0',
            'b STRING MAX_LENGTH 10',
            'c STRING MIN_LENGTH 3 MAX_LENGTH 20 DEFAULT "student"'
        ].join('\n'));
        assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    });

    test('rejects MIN_LENGTH on INT, FLOAT, and BOOLEAN', () => {
        for (const type of ['INT', 'FLOAT', 'BOOLEAN']) {
            expectSemanticError(`ENTITY User\nvalue ${type} MIN_LENGTH 2`, "only allowed for STRING fields");
        }
    });

    test('rejects MAX_LENGTH on a non-STRING field', () => {
        expectSemanticError('ENTITY User\nvalue INT MAX_LENGTH 2', "MAX_LENGTH' is only allowed for STRING");
    });

    test('rejects negative and fractional length values', () => {
        expectSemanticError('ENTITY User\nname STRING MIN_LENGTH -1', 'must be a non-negative integer');
        expectSemanticError('ENTITY User\nname STRING MAX_LENGTH 2.5', 'must be a non-negative integer');
    });

    test('rejects duplicate MIN_LENGTH and MAX_LENGTH modifiers', () => {
        expectSemanticError('ENTITY User\nname STRING MIN_LENGTH 3 MIN_LENGTH 4', 'Duplicate MIN_LENGTH');
        expectSemanticError('ENTITY User\nname STRING MAX_LENGTH 10 MAX_LENGTH 20', 'Duplicate MAX_LENGTH');
    });

    test('rejects an inverted length range', () => {
        expectSemanticError('ENTITY User\nname STRING MIN_LENGTH 5 MAX_LENGTH 3', 'MIN_LENGTH value 5 cannot be greater');
    });

    test('rejects defaults that are too short or too long and accepts boundaries', () => {
        expectSemanticError('ENTITY User\nstatus STRING MIN_LENGTH 3 DEFAULT "ok"', 'less than MIN_LENGTH value 3');
        expectSemanticError('ENTITY User\nstatus STRING MAX_LENGTH 3 DEFAULT "draft"', 'greater than MAX_LENGTH value 3');
        assert.strictEqual(analyze('ENTITY User\nstatus STRING MIN_LENGTH 2 MAX_LENGTH 5 DEFAULT "ok"').result.valid, true);
        assert.strictEqual(analyze('ENTITY User\nstatus STRING MIN_LENGTH 2 MAX_LENGTH 5 DEFAULT "draft"').result.valid, true);
    });

    test('counts Unicode code points when validating STRING defaults', () => {
        assert.strictEqual(analyze('ENTITY User\nicon STRING MIN_LENGTH 1 MAX_LENGTH 1 DEFAULT "😀"').result.valid, true);
    });
});

phase('ir', () => {
    test('preserves length validations from AST through semantic symbols and IR', () => {
        const compiled = compile('ENTITY User\nname STRING MIN_LENGTH 3 MAX_LENGTH 20');
        const expected = [{ type: 'MIN_LENGTH', value: 3 }, { type: 'MAX_LENGTH', value: 20 }];
        assert.deepStrictEqual(compiled.ast.entities[0].fields[0].validations, expected);
        assert.deepStrictEqual(compiled.semantic.symbolTable.User.fields.name.validations, expected);
        assert.deepStrictEqual(compiled.ir.instructions[1].validations, expected);
    });

    test('accepts valid length validations in the IR schema', () => {
        const result = IRGenerator.validate({
            type: 'PROGRAM',
            instructions: [{ op: 'ADD_FIELD', entity: 'User', field: 'name', dataType: 'STRING', constraints: [], validations: [{ type: 'MIN_LENGTH', value: 0 }] }]
        });
        assert.strictEqual(result.valid, true, result.errors.join('\n'));
    });

    test('rejects negative and fractional length values in the IR schema', () => {
        for (const value of [-1, 1.5]) {
            const result = IRGenerator.validate({
                type: 'PROGRAM',
                instructions: [{ op: 'ADD_FIELD', entity: 'User', field: 'name', dataType: 'STRING', constraints: [], validations: [{ type: 'MAX_LENGTH', value }] }]
            });
            assert.strictEqual(result.valid, false);
            assert(result.errors.some(error => error.includes('non-negative integer')));
        }
    });
});

phase('optimizer', () => {
    test('deduplicates exact length validations and normalizes their order', () => {
        const optimized = Optimizer.optimize({
            type: 'PROGRAM',
            instructions: [{
                op: 'ADD_FIELD', entity: 'User', field: 'name', dataType: 'STRING', constraints: [],
                validations: [
                    { type: 'MAX_LENGTH', value: 20 },
                    { type: 'MIN_LENGTH', value: 3 },
                    { type: 'MIN_LENGTH', value: 3 }
                ]
            }]
        }).ir;
        assert.deepStrictEqual(optimized.instructions[0].validations, [
            { type: 'MIN_LENGTH', value: 3 },
            { type: 'MAX_LENGTH', value: 20 }
        ]);
    });

    test('preserves length validations in otherwise unchanged optimized IR', () => {
        const source = 'ENTITY User\nname STRING MIN_LENGTH 3 MAX_LENGTH 20';
        const compiled = compile(source);
        assert.deepStrictEqual(compiled.optimized.instructions[1].validations, compiled.ir.instructions[1].validations);
    });
});

phase('codegen', () => {
    const source = [
        'ENTITY User',
        'id INT PRIMARY KEY',
        'username STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 20',
        'tag STRING MIN_LENGTH 2',
        'bio STRING MAX_LENGTH 500',
        'role STRING DEFAULT "student" MIN_LENGTH 3 MAX_LENGTH 20'
    ].join('\n');
    const compiled = compile(source);
    const sql = compiled.generated.files.find(file => file.path === 'database/schema.sql').content;
    const controller = compiled.generated.files.find(file => file.path === 'controllers/userController.js').content;
    const swagger = JSON.parse(compiled.generated.files.find(file => file.path === 'swagger.json').content);
    const properties = swagger.components.schemas.User.properties;

    test('generates combined and one-sided MySQL CHAR_LENGTH checks', () => {
        assert(sql.includes('CHECK (CHAR_LENGTH(username) >= 3 AND CHAR_LENGTH(username) <= 20)'));
        assert(sql.includes('CHECK (CHAR_LENGTH(tag) >= 2)'));
        assert(sql.includes('bio VARCHAR(500) CHECK (CHAR_LENGTH(bio) <= 500)'));
    });

    test('widens MySQL STRING capacity only when declared length bounds require it', () => {
        assert(sql.includes('username VARCHAR(255)'));
        assert(sql.includes('bio VARCHAR(500)'));
        assert(sql.includes('role VARCHAR(255)'));
    });

    test('uses existing identifier quoting inside string-length checks', () => {
        const quoted = CodeGenerator.generateSQL({
            type: 'PROGRAM',
            instructions: [
                { op: 'CREATE_ENTITY', entity: 'User' },
                { op: 'ADD_FIELD', entity: 'User', field: 'order', dataType: 'STRING', constraints: [], validations: [{ type: 'MIN_LENGTH', value: 1 }] }
            ]
        });
        assert(quoted.includes('CHAR_LENGTH(`order`) >= 1'));
    });

    test('generates Unicode-aware Express length validation with omitted/null behavior preserved', () => {
        const match = controller.match(/function validateUser\(data\) \{[\s\S]*?\n\}/);
        assert(match);
        const validate = new Function('data', match[0].replace('function validateUser(data) {', '').replace(/\n\}$/, ''));
        assert.strictEqual(validate({ username: 'ab' }), "Field 'username' length must be >= 3.");
        assert.strictEqual(validate({ username: 'abcdefghijklmnopqrstu' }), "Field 'username' length must be <= 20.");
        assert.strictEqual(validate({ username: 'abc' }), null);
        assert.strictEqual(validate({ tag: '😀😀' }), null);
        assert.strictEqual(validate({}), null);
        assert.strictEqual(validate({ username: null }), null);
        assert.strictEqual(validate({ username: 123 }), "Field 'username' must be a string.");
    });

    test('maps length rules and defaults into OpenAPI entity/request schemas', () => {
        assert.deepStrictEqual(
            { minLength: properties.username.minLength, maxLength: properties.username.maxLength },
            { minLength: 3, maxLength: 20 }
        );
        assert.strictEqual(properties.tag.minLength, 2);
        assert.strictEqual(properties.bio.maxLength, 500);
        assert.strictEqual(properties.role.default, 'student');
        assert.strictEqual(swagger.paths['/users'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/User');
        assert.strictEqual(swagger.paths['/users/{id}'].put.requestBody.content['application/json'].schema.$ref, '#/components/schemas/User');
    });
});

phase('integration', () => {
    test('compiles the STRING length validation sample through all six phases', () => {
        const sample = fs.readFileSync(path.join(__dirname, '..', 'samples', 'string_length_validation.apiforge'), 'utf8');
        const compiled = compile(sample);
        assert.strictEqual(compiled.generated.success, true);
        assert.strictEqual(compiled.generated.files.length, 10);
        assert.strictEqual(IRGenerator.validate(compiled.optimized).valid, true);
    });
});

phase('frontend', () => {
    test('keeps the playground example and generic validation renderers length-aware', () => {
        const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.js'), 'utf8');
        assert(frontend.includes('MIN_LENGTH 2 MAX_LENGTH 80'));
        assert(frontend.includes('field.validations.map(v => `${v.type} ${v.value}`)'));
        assert(frontend.includes('inst.validations.map(v => `${v.type} ${v.value}`)'));
    });
});

console.log(`\nString length validation: ${passed} tests passed (${requestedPhase}).`);
