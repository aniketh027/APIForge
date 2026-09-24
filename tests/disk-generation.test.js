const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CodeGenerator = require('../src/codegen/codegen');

function projectIR(entityNames) {
    const instructions = [];
    for (const entity of entityNames) {
        instructions.push({ op: 'CREATE_ENTITY', entity, line: 1 });
        instructions.push({
            op: 'ADD_FIELD',
            entity,
            field: 'id',
            dataType: 'INT',
            constraints: ['PRIMARY_KEY'],
            validations: [],
            defaultValue: null,
            line: 2
        });
    }
    return { type: 'PROGRAM', instructions };
}

function assertExists(root, relativePath) {
    assert.ok(fs.existsSync(path.join(root, relativePath)), `Expected ${relativePath} to exist`);
}

const originalCwd = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-disk-generation-'));

try {
    process.chdir(temporaryRoot);

    CodeGenerator.generate(projectIR(['Student', 'Course']), true);
    for (const relativePath of [
        'models/Student.js',
        'models/Course.js',
        'controllers/studentController.js',
        'controllers/courseController.js',
        'routes/studentRoutes.js',
        'routes/courseRoutes.js'
    ]) {
        assertExists(path.join(temporaryRoot, 'output'), relativePath);
    }

    const outputRoot = path.join(temporaryRoot, 'output');
    const outsideFile = path.join(temporaryRoot, 'outside-user-file.txt');
    fs.writeFileSync(path.join(outputRoot, '.env'), 'DB_PASSWORD=user-secret\n');
    fs.writeFileSync(path.join(outputRoot, 'user-notes.txt'), 'keep me\n');
    fs.writeFileSync(outsideFile, 'outside managed output\n');
    fs.writeFileSync(path.join(outputRoot, 'config', 'legacy-config.js'), 'stale\n');
    fs.writeFileSync(path.join(outputRoot, 'database', 'legacy-schema.sql'), 'stale\n');

    CodeGenerator.generate(projectIR(['Student']), true);

    for (const relativePath of [
        'models/Course.js',
        'controllers/courseController.js',
        'routes/courseRoutes.js',
        'config/legacy-config.js',
        'database/legacy-schema.sql'
    ]) {
        assert.ok(!fs.existsSync(path.join(outputRoot, relativePath)), `Expected stale ${relativePath} to be removed`);
    }

    for (const relativePath of [
        'database/schema.sql',
        'config/db.js',
        '.env.example',
        'package.json',
        'README.md',
        'models/Student.js',
        'controllers/studentController.js',
        'routes/studentRoutes.js',
        'server.js',
        'swagger.json'
    ]) {
        assertExists(outputRoot, relativePath);
    }

    assert.strictEqual(fs.readFileSync(path.join(outputRoot, '.env'), 'utf8'), 'DB_PASSWORD=user-secret\n');
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'user-notes.txt'), 'utf8'), 'keep me\n');
    assert.strictEqual(fs.readFileSync(outsideFile, 'utf8'), 'outside managed output\n');

    const failureSentinel = path.join(outputRoot, 'models', 'failure-sentinel.js');
    fs.writeFileSync(failureSentinel, 'previous usable output\n');
    assert.throws(
        () => CodeGenerator.generate({ type: 'INVALID' }, true),
        /Cannot generate target code/
    );
    assert.strictEqual(fs.readFileSync(failureSentinel, 'utf8'), 'previous usable output\n');

    console.log('Disk generation regression tests passed.');
} finally {
    process.chdir(originalCwd);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
