'use strict';

// Documentation checks only. Compiler modules, output/, and package scripts
// are not modified. CLI execution uses a fresh directory under os.tmpdir().
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const Lexer = require('../src/lexer/lexer');
const Parser = require('../src/parser/parser');
const Semantic = require('../src/semantic/analyzer');
const IR = require('../src/ir/generator');
const Optimizer = require('../src/optimizer/optimizer');
const Codegen = require('../src/codegen/codegen');
const { CODES } = require('../src/utils/diagnostics');

const root = path.resolve(__dirname, '..');
const guide = fs.readFileSync(path.join(__dirname, 'APIForge-Language-Guide.md'), 'utf8').replace(/\r\n/g, '\n');
const valid = [...guide.matchAll(/<!-- example: valid ([\w-]+)(?: warnings=([\w,]+))? -->\n~~~apiforge\n([\s\S]*?)\n~~~/g)]
    .map(match => ({ id: match[1], warnings: match[2] ? match[2].split(',') : [], source: match[3] }));
const invalidSection = guide.split('## 14. Common Invalid Programs\n')[1]?.split('## 15.')[0];
assert(invalidSection, 'Invalid-program section is missing.');
const invalid = [...invalidSection.matchAll(/^\| ([\w-]+) \| `([^`]*)` \| `([A-Z0-9, ]+)` \|$/gm)]
    .map(match => ({ id: match[1], source: match[2].replace(/ *↵ */g, '\n'), codes: match[3].split(/, */) }));
assert.equal(valid.length, (guide.match(/^~~~apiforge$/gm) || []).length, 'Every DSL fence must have an expectation marker.');
assert.equal(invalid.length, invalidSection.split('\n').filter(line => /^\| [a-z][\w-]* \|/.test(line)).length,
    'Every invalid-program row must be executable and have expected codes.');
assert(valid.length > 0 && invalid.length > 0);
assert.equal(new Set([...valid, ...invalid].map(example => example.id)).size, valid.length + invalid.length,
    'Example IDs must be unique.');

function compile(source) {
    let ast, semantic;
    try {
        ast = Parser.parse(Lexer.tokenize(source));
        semantic = Semantic.analyze(ast);
    } catch (error) {
        if (!error.diagnostic) throw error;
        return { diagnostics: [error.diagnostic] };
    }
    if (!semantic.valid) return { diagnostics: semantic.diagnostics };
    const ir = IR.generate(ast, semantic);
    const optimized = Optimizer.optimize(ir);
    assert.equal(IR.validate(optimized.ir).valid, true);
    const files = Codegen.generate(optimized.ir, false).files;
    return { diagnostics: [], ast, semantic, ir, optimized, files };
}

function content(result, filename) {
    const file = result.files.find(file => file.path === filename);
    assert(file, 'Missing generated file: ' + filename);
    return file.content;
}

function loadModule(source, requireImpl) {
    const module = { exports: {} };
    vm.compileFunction(source, ['require', 'module'])(requireImpl, module);
    return module.exports;
}

function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function main() {
    const baselineCodes = require('../tests/fixtures/implicit-pk-compatibility.json').codes;
    const { IMPLICIT_PRIMARY_KEY_COLLISION, ...originalSemantic } = CODES.semantic;
    assert.equal(IMPLICIT_PRIMARY_KEY_COLLISION, 'SEM033');
    assert.deepEqual(require('../tests/v1-hardening-helpers').retainedCodes(CODES, baselineCodes), baselineCodes);
    assert.equal(Object.values(CODES).flatMap(Object.values).length, 83);
    assert.equal(CODES.parser.IMPORT_AFTER_DECLARATION, 'PAR023');
    assert.equal(CODES.input.IMPORT_CONTEXT_UNSUPPORTED, 'INP010');
    assert.equal(CODES.semantic.INVALID_UUID_DEFAULT, 'SEM039');
    assert.equal(CODES.semantic.INVALID_TEMPORAL_DEFAULT, 'SEM038');
    const compiled = new Map();
    let javascript = 0;
    for (const example of valid) {
        const result = compile(example.source);
        assert.deepEqual(result.diagnostics, [], example.id);
        assert.deepEqual([...result.semantic.warnings, ...result.optimized.warnings].map(d => d.code), example.warnings, example.id);
        assert.equal(result.files.length, 7 + 3 * result.ast.entities.length, example.id);
        for (const file of result.files.filter(file => file.path.endsWith('.js'))) {
            new vm.Script(file.content, { filename: file.path });
            javascript++;
        }
        const swagger = JSON.parse(content(result, 'swagger.json'));
        assert.equal(swagger.openapi, '3.0.0');
        assert(!Object.keys(swagger.paths).some(route => route.startsWith('/api/')));
        JSON.parse(content(result, 'package.json'));
        for (const entity of result.ast.entities) {
            for (const field of entity.fields.filter(field => ['DATE', 'TIMESTAMP'].includes(field.dataType))) {
                const instruction = result.optimized.ir.instructions.find(i => i.entity === entity.name && i.field === field.name);
                assert.equal(instruction.dataType, field.dataType);
                for (const role of ['', '.Create', '.Update', '.Read', '.CreateResult']) {
                    const property = swagger.components.schemas[entity.name + role].properties[field.name];
                    assert.equal(property.type, 'string');
                    assert.equal(property.format, field.dataType === 'DATE' ? 'date' : 'date-time');
                    assert(property.pattern && property.description);
                    if (field.defaultValue) assert.equal(property.default, field.defaultValue.value);
                }
            }
            for (const field of entity.fields.filter(field => field.dataType === 'ENUM')) {
                const instruction = result.optimized.ir.instructions.find(i => i.entity === entity.name && i.field === field.name);
                assert.deepEqual(instruction.enumValues, field.enumValues);
                assert.deepEqual(swagger.components.schemas[entity.name].properties[field.name].enum, field.enumValues);
            }
        }
        compiled.set(example.id, result);
    }
    for (const example of invalid) {
        const result = compile(example.source);
        assert.deepEqual(result.diagnostics.map(d => d.code), example.codes, example.id);
        assert(result.diagnostics.every(d => d.severity === 'error'));
    }
    console.log('Guide examples: ' + valid.length + ' valid compiled through six phases; ' + invalid.length + ' invalid exact diagnostic arrays matched.');
    console.log('Generated artifacts: ' + javascript + ' JavaScript files parsed; JSON, file counts, ENUM order and root OpenAPI paths checked.');

    // Check important target differences the guide explicitly documents.
    const implicit = compiled.get('smallest');
    assert(!implicit.ir.instructions.some(i => i.field === 'id'));
    assert.match(content(implicit, 'database/schema.sql'), /id INT PRIMARY KEY AUTO_INCREMENT/);
    const implicitSwagger = JSON.parse(content(implicit, 'swagger.json'));
    assert.deepEqual(implicitSwagger.components.schemas.Item.properties.id, { type: 'integer', readOnly: true });
    assert(!(implicitSwagger.components.schemas.Item.required || []).includes('id'));
    assert.equal(implicitSwagger.paths['/items/{id}'].parameters[0].schema.type, 'integer');
    const calls = [];
    const pool = { query: async (sql, values) => { calls.push({ sql, values }); return [[]]; } };
    const ImplicitModel = loadModule(content(implicit, 'models/Item.js'), () => pool);
    await ImplicitModel.findById(1);
    assert.equal(calls[0].sql, 'SELECT * FROM Item WHERE id = ?');
    calls.length = 0;
    await ImplicitModel.findAll(ImplicitModel.parseQuery({ page: '1' }));
    assert.equal(calls[0].sql, 'SELECT * FROM Item ORDER BY id ASC LIMIT ? OFFSET ?');

    const pk = compiled.get('primary-key-policies');
    const pkSql = content(pk, 'database/schema.sql');
    assert.match(pkSql, /CREATE TABLE AutoRecord \(\n    id INT PRIMARY KEY AUTO_INCREMENT/);
    assert.match(pkSql, /CREATE TABLE FixedRecord \(\n    id INT PRIMARY KEY DEFAULT 1/);
    assert.match(pkSql, /code VARCHAR\(255\) PRIMARY KEY NOT NULL CHECK/);
    assert.equal(JSON.parse(content(pk, 'swagger.json')).paths['/namedrecords/{id}'].parameters[0].schema.type, 'string');
    for (const [declaration, input, insertId, expected] of [
        ['name STRING', { name: 'Alice' }, 42, { name: 'Alice', id: 42 }],
        ['id INT PRIMARY KEY', {}, 42, { id: 42 }],
        ['id INT PRIMARY KEY', { id: 100 }, 999, { id: 100 }],
        ['key INT PRIMARY KEY DEFAULT 7', {}, 0, { key: 7 }],
        ['key STRING PRIMARY KEY', { key: 'aniketh' }, 0, { key: 'aniketh' }],
        ['key STRING PRIMARY KEY DEFAULT "seed"\nstatus STRING DEFAULT "new"', {}, 0, { key: 'seed' }],
        ['key STRING PRIMARY KEY DEFAULT "seed"', { key: 'custom' }, 0, { key: 'custom' }]
    ]) {
        const result = compile('ENTITY Item\n' + declaration), writes = [];
        const Model = loadModule(content(result, 'models/Item.js'), () => ({ query: async (sql, values) => {
            writes.push({ sql, values }); return [{ insertId }];
        } }));
        assert.deepEqual(await Model.create(input), expected);
        assert.equal(writes.length, 1); assert(writes[0].sql.startsWith('INSERT'));
        const key = Object.keys(expected).find(name => name !== 'name');
        if (key) {
            await assert.rejects(Model.update(String(expected[key]), { [key]: expected[key] }), { message: "Field '" + key + "' is immutable." });
            assert.equal(writes.length, 1, 'direct key update cannot run SQL');
        }
    }

    const required = loadModule(content(compiled.get('required-unique'), 'controllers/memberController.js'), () => ({}));
    assert.equal(required.validateMember({}), null);
    assert.equal(required.validateMember({ enabled: null }), "Field 'enabled' cannot be null.");
    assert.equal(required.validateMember({}, 'create'), "Field 'email' is required.");
    const account = loadModule(content(compiled.get('account-complete'), 'controllers/accountController.js'), () => ({}));
    assert.equal(account.validateAccount({}), null);
    assert(account.validateAccount({ role: null }));
    const student = compiled.get('student-complete');
    const studentController = loadModule(content(student, 'controllers/studentController.js'), () => ({}));
    assert.equal(studentController.validateStudent({ age: '21', cgpa: '8.5' }), "Field 'age' must be an integer.");
    assert.equal(studentController.validateStudent({ age: 21.5 }), "Field 'age' must be an integer.");
    assert.equal(studentController.validateStudent({ age: 21, cgpa: 8.5 }), null);
    assert.equal(studentController.validateStudent({ cgpa: '8.5' }), "Field 'cgpa' must be a finite number.");
    assert.equal(studentController.validateStudent({ id: 1.5 }), "Field 'id' is immutable.");
    assert.equal(studentController.validateStudent({ id: 1.5, name: 'Alice' }, 'create'), "Field 'id' must be an integer.");
    assert.equal(studentController.validateStudent({ id: 1 }), "Field 'id' is immutable.");
    assert.equal(studentController.validateStudent({ id: null }), "Field 'id' is immutable.");
    assert.equal(studentController.validateStudent({}, 'create'), "Field 'name' is required.");
    assert.equal(studentController.validateStudent({ age: null }), null);
    assert(studentController.validateStudent({ name: 123 }));
    const StudentModel = loadModule(content(student, 'models/Student.js'), () => pool);
    assert.equal(StudentModel.parseQuery({ age: '1' }).filters.age, 1); // Write MIN 18 is not a filter bound.

    const enumDetails = compiled.get('enum-details');
    assert.match(content(enumDetails, 'database/schema.sql'), /'O''Reilly'/);
    assert(content(enumDetails, 'database/schema.sql').includes("'C:\\\\folder'"));
    assert.equal(JSON.parse(content(enumDetails, 'swagger.json')).components.schemas.Choice.properties.value.nullable, undefined);

    const relationships = compiled.get('relationships-complete');
    const relationshipSql = content(relationships, 'database/schema.sql');
    assert.match(relationshipSql, /ALTER TABLE Profile ADD COLUMN user_id INT UNIQUE;/);
    assert.match(relationshipSql, /ALTER TABLE Employee ADD COLUMN department_code VARCHAR\(255\);/);
    assert.match(relationshipSql, /ALTER TABLE Invoice ADD COLUMN customer_code VARCHAR\(255\);/);
    assert.match(relationshipSql, /CREATE TABLE Student_Course/);
    const relationshipSwagger = JSON.parse(content(relationships, 'swagger.json'));
    for (const route of ['/users/{id}/profile', '/departments/{id}/employees', '/invoices/{id}/customer', '/students/{id}/courses', '/students/{id}/courses/{courseId}']) {
        assert(relationshipSwagger.paths[route], route);
    }
    assert(!relationshipSwagger.components.schemas.Employee.properties.department_code);
    assert.equal(relationshipSwagger.paths['/students/{id}/courses'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/Course.ListResponse');
    assert.equal(relationshipSwagger.components.schemas['Employee.Read'].properties.department_code.readOnly, true);
    assert.match(content(relationships, 'routes/invoiceRoutes.js'), /router.get\('\/:id\/customer'/);

    // Synthetic-id and repeated relationship target allocations are rejected.
    const duplicateId = compile('ENTITY Item\nid STRING');
    assert.deepEqual(duplicateId.diagnostics.map(d => d.code), ['SEM033']);
    assert.equal(duplicateId.files, undefined);
    const duplicatePair = compile('ENTITY A\nid INT PRIMARY KEY\nENTITY B\nid INT PRIMARY KEY\nRELATION A FIRST B MANY_TO_MANY\nRELATION A SECOND B MANY_TO_MANY');
    assert(duplicatePair.diagnostics.length > 0);
    assert(duplicatePair.diagnostics.every(d => d.code === 'SEM034'));
    assert.equal(duplicatePair.files, undefined);
    assert.equal(Codegen.pluralize('Person'), 'persons');
    assert.equal(Codegen.pluralize('Category'), 'categories');
    assert.equal(Codegen.pluralize('Box'), 'boxes');

    const diagnosticExample = [...guide.matchAll(/~~~json\n([\s\S]*?)\n~~~/g)][0];
    assert(diagnosticExample, 'Diagnostic JSON example missing.');
    assert.deepEqual(JSON.parse(diagnosticExample[1]), compile('ENTITY Student\nage INT MIN 60 MAX 18').diagnostics[0]);
    console.log('Documented target differences: implicit IDs, keys, required/default validation, ENUM escaping, all cardinalities, naming collisions and diagnostic JSON reproduced.');

    // Run the actual CLI on every documented program. Expected failures use their
    // own empty cwd, so success output cannot hide a write on the failure path.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-language-guide-'));
    assert(inside(os.tmpdir(), temp) && !inside(root, temp), 'CLI workspace must be outside the repository.');
    try {
        for (const example of [...valid, ...invalid]) {
            const cwd = path.resolve(temp, example.id);
            assert(inside(temp, cwd));
            fs.mkdirSync(cwd);
            const sourcePath = path.join(cwd, 'source.apiforge');
            fs.writeFileSync(sourcePath, example.source, 'utf8');
            const result = spawnSync(process.execPath, [path.join(root, 'index.js'), sourcePath], {
                cwd, encoding: 'utf8', timeout: 30000, windowsHide: true
            });
            assert.ifError(result.error);
            assert.equal(result.status, example.codes ? 1 : 0, example.id + ': ' + result.stdout + result.stderr);
            if (example.codes) {
                const printed = [...result.stdout.matchAll(/\b(?:LEX|PAR|SEM)\d{3}\b/g)].map(match => match[0]);
                assert.deepEqual(printed, example.codes, example.id + ' CLI diagnostic codes');
                assert(!fs.existsSync(path.join(cwd, 'output')), example.id + ': invalid CLI wrote output');
            } else {
                const printed = [...result.stdout.matchAll(/\bWRN\d{3}\b/g)].map(match => match[0]);
                assert.deepEqual(printed, example.warnings, example.id + ' CLI warning codes');
                for (const file of compiled.get(example.id).files) {
                    assert.equal(fs.readFileSync(path.join(cwd, 'output', file.path), 'utf8'), file.content, example.id + ': ' + file.path);
                }
            }
        }
    } finally {
        // Verify the resolved absolute path again before recursive cleanup.
        assert(inside(os.tmpdir(), path.resolve(temp)) && !inside(root, path.resolve(temp)));
        fs.rmSync(temp, { recursive: true, force: true });
    }
    console.log('Real CLI: ' + valid.length + ' valid exits 0 with exact output; ' + invalid.length + ' invalid exits 1 with exact codes and no output.');
    console.log('Language guide verification: PASS.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
