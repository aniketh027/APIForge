const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const {
    createTemporaryDatabaseName,
    quoteTemporaryDatabaseName,
    readServerConfig,
    serializeDotenv
} = require('./generated-backend-mysql-helpers');

const {
    acquireFreePort,
    assertPortReleased,
    boundedOutput,
    compileProject,
    killProcessTreeSync,
    materializeGeneratedFiles,
    npmInvocation,
    removeTemporaryDirectory,
    requestHttp,
    runCommand,
    snapshotDirectory,
    startCommand,
    stopProcessTree,
    waitForHealth
} = require('./generated-backend-test-helpers');

const repositoryRoot = path.resolve(__dirname, '..');
const repositoryOutput = path.join(repositoryRoot, 'output');
const testDsl = [
    'ENTITY Student',
    'id INT PRIMARY KEY',
    'name STRING REQUIRED UNIQUE MIN_LENGTH 2 MAX_LENGTH 12',
    'age INT REQUIRED MIN 18 MAX 60',
    'active BOOLEAN DEFAULT TRUE',
    `status ENUM("active", "ACTIVE", "inactive", "O'Reilly", "C:\\folder") DEFAULT "active"`,
    `signature ENUM("O'Reilly") DEFAULT "O'Reilly"`,
    `folder ENUM("C:\\folder") DEFAULT "C:\\folder"`,
    '',
    'ENTITY Course',
    'id INT PRIMARY KEY',
    'title STRING REQUIRED UNIQUE MIN_LENGTH 2 MAX_LENGTH 40',
    'credits INT MIN 1 MAX 6 DEFAULT 3',
    '',
    'RELATION Student ENROLLED_IN Course MANY_TO_MANY'
].join('\n');

const resources = {
    activeChild: null,
    adminConnection: null,
    databaseConnection: null,
    databaseCreated: false,
    databaseName: null,
    outputBefore: null,
    serverConfig: null,
    serverPort: null,
    serverState: null,
    temporaryProjectRoot: null,
    cleanupPromise: null
};

let currentPhase = 'configuration';
let handlingSignal = false;

function redactSecrets(value) {
    let text = String(value);
    const password = resources.serverConfig && resources.serverConfig.password;
    if (password) text = text.split(password).join('[REDACTED]');
    return text;
}

function diagnosticError(error) {
    return redactSecrets(error && (error.stack || error.message) ? (error.stack || error.message) : error);
}

function makeGeneratedEnvironment(config, databaseName, port) {
    return {
        PORT: String(port),
        DB_HOST: config.host,
        DB_PORT: String(config.port),
        DB_USER: config.user,
        DB_PASSWORD: config.password,
        DB_NAME: databaseName
    };
}

function assertResponse(response, expectedStatus, label) {
    assert.strictEqual(
        response.statusCode,
        expectedStatus,
        `${label} returned HTTP ${response.statusCode}; body: ${boundedOutput(response.body, 4000)}`
    );
    assert.ok(response.json, `${label} did not return JSON; body: ${boundedOutput(response.body, 4000)}`);
    return response.json;
}

async function closeConnection(connection) {
    if (!connection) return;
    try {
        await connection.end();
    } catch (error) {
        if (!['PROTOCOL_CONNECTION_LOST', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)) throw error;
    }
}

async function cleanupResources() {
    if (resources.cleanupPromise) return resources.cleanupPromise;

    resources.cleanupPromise = (async () => {
        const errors = [];

        try {
            if (!resources.serverState) killProcessTreeSync(resources.activeChild);
            await stopProcessTree(resources.serverState);
            if (resources.serverPort !== null) await assertPortReleased(resources.serverPort);
        } catch (error) {
            errors.push(`Process cleanup failed: ${diagnosticError(error)}`);
        }

        try {
            await closeConnection(resources.databaseConnection);
            resources.databaseConnection = null;
        } catch (error) {
            errors.push(`Database verification connection cleanup failed: ${diagnosticError(error)}`);
        }

        if (resources.databaseCreated) {
            try {
                const quotedName = quoteTemporaryDatabaseName(resources.databaseName);
                let lastDropError = null;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    try {
                        if (!resources.adminConnection) {
                            resources.adminConnection = await mysql.createConnection(resources.serverConfig);
                        }
                        await resources.adminConnection.query(`DROP DATABASE IF EXISTS ${quotedName}`);
                        const [remaining] = await resources.adminConnection.query(
                            'SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
                            [resources.databaseName]
                        );
                        assert.strictEqual(
                            Number(remaining[0].count),
                            0,
                            'Temporary database still exists after DROP DATABASE'
                        );
                        lastDropError = null;
                        break;
                    } catch (error) {
                        lastDropError = error;
                        try {
                            await closeConnection(resources.adminConnection);
                        } catch (closeError) {
                            // The reconnect below is the cleanup recovery path.
                        }
                        resources.adminConnection = null;
                    }
                }
                if (lastDropError) throw lastDropError;
                resources.databaseCreated = false;
            } catch (error) {
                errors.push(
                    `Temporary database cleanup failed for ${resources.databaseName}: ${diagnosticError(error)}`
                );
            }
        }

        try {
            await closeConnection(resources.adminConnection);
            resources.adminConnection = null;
        } catch (error) {
            errors.push(`MySQL administration connection cleanup failed: ${diagnosticError(error)}`);
        }

        try {
            removeTemporaryDirectory(resources.temporaryProjectRoot);
            assert.ok(
                !resources.temporaryProjectRoot || !fs.existsSync(resources.temporaryProjectRoot),
                `Temporary project still exists: ${resources.temporaryProjectRoot}`
            );
        } catch (error) {
            errors.push(`Temporary-directory cleanup failed: ${diagnosticError(error)}`);
        }

        try {
            assert.deepStrictEqual(
                snapshotDirectory(repositoryOutput),
                resources.outputBefore,
                'Repository output/ changed during generated MySQL integration'
            );
        } catch (error) {
            errors.push(diagnosticError(error));
        }

        return errors;
    })();

    return resources.cleanupPromise;
}

async function handleTerminationSignal(signal) {
    if (handlingSignal) return;
    handlingSignal = true;

    const cleanupErrors = await cleanupResources();
    if (cleanupErrors.length > 0) {
        console.error(`Cleanup after ${signal} failed:\n${cleanupErrors.join('\n')}`);
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => { void handleTerminationSignal('SIGINT'); });
process.on('SIGTERM', () => { void handleTerminationSignal('SIGTERM'); });

async function verifyImportedSchema(connection, databaseName) {
    const [tables] = await connection.query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
        [databaseName]
    );
    const tableNames = new Set(tables.map(row => row.TABLE_NAME.toLowerCase()));
    for (const expected of ['student', 'course', 'student_course']) {
        assert.ok(tableNames.has(expected), `Expected imported table ${expected}`);
    }

    const [columns] = await connection.query(
        'SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS ' +
        'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?)',
        [databaseName, 'Student', 'name', 'active']
    );
    const columnMap = new Map(columns.map(row => [row.COLUMN_NAME.toLowerCase(), row]));
    assert.strictEqual(columnMap.get('name').IS_NULLABLE, 'NO', 'Student.name should be NOT NULL in MySQL metadata');
    assert.ok(columnMap.get('active').COLUMN_DEFAULT !== null, 'Student.active should have a MySQL default');

    const [uniqueIndexes] = await connection.query(
        'SELECT COUNT(*) AS count FROM information_schema.STATISTICS ' +
        'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0',
        [databaseName, 'Student', 'name']
    );
    assert.ok(Number(uniqueIndexes[0].count) >= 1, 'Student.name UNIQUE constraint should exist in MySQL metadata');

    const [checks] = await connection.query(
        'SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?',
        [databaseName]
    );
    const ageCheck = checks.map(row => row.CHECK_CLAUSE).find(clause =>
        /age/i.test(clause) && /18/.test(clause) && /60/.test(clause)
    );
    assert.ok(ageCheck, 'Student.age MIN/MAX check should exist in MySQL metadata');

    let directConstraintError = null;
    try {
        await connection.query(
            'INSERT INTO `Student` (`name`, `age`) VALUES (?, ?)',
            ['DbReject', 17]
        );
    } catch (error) {
        directConstraintError = error;
    }
    assert.ok(directConstraintError, 'MySQL should reject a direct row violating Student.age MIN');
    const [rejectedRows] = await connection.query(
        'SELECT COUNT(*) AS count FROM `Student` WHERE `name` = ?',
        ['DbReject']
    );
    assert.strictEqual(Number(rejectedRows[0].count), 0, 'Constraint-violating row must not persist');
}

async function exerciseGeneratedApi(connection, port) {
    currentPhase = 'runtime ENUM validation';
    for (const status of ['deleted', 'Active', 1, true]) {
        assertResponse(await requestHttp(port, 'POST', '/students', { name: 'Valid', age: 20, status }), 400, 'Invalid ENUM POST');
    }
    currentPhase = 'runtime numeric validation';
    const invalidAge = await requestHttp(port, 'POST', '/students', { name: 'Adult', age: 17 });
    assertResponse(invalidAge, 400, 'Invalid Student age');
    assert.match(invalidAge.json.error, />= 18/);

    currentPhase = 'runtime string-length validation';
    const tooShort = await requestHttp(port, 'POST', '/students', { name: '😀', age: 20 });
    assertResponse(tooShort, 400, 'Too-short Unicode Student name');
    assert.match(tooShort.json.error, /length must be >= 2/);

    const tooLong = await requestHttp(port, 'POST', '/students', { name: 'abcdefghijklmnop', age: 20 });
    assertResponse(tooLong, 400, 'Too-long Student name');
    assert.match(tooLong.json.error, /length must be <= 12/);

    const [beforeCreate] = await connection.query('SELECT COUNT(*) AS count FROM `Student`');
    assert.strictEqual(Number(beforeCreate[0].count), 0, 'Rejected requests must not create Student rows');

    currentPhase = 'Student POST and default persistence';
    const created = await requestHttp(port, 'POST', '/students', { name: 'A😀', age: 20 });
    const createdBody = assertResponse(created, 201, 'Student POST');
    assert.strictEqual(createdBody.success, true);
    const studentId = Number(createdBody.data.id);
    assert.ok(Number.isInteger(studentId) && studentId > 0, 'Student POST should return an inserted id');

    const [createdRows] = await connection.query('SELECT * FROM `Student` WHERE `id` = ?', [studentId]);
    assert.strictEqual(createdRows.length, 1, 'Student POST should persist one row');
    assert.strictEqual(createdRows[0].name, 'A😀');
    assert.strictEqual(Number(createdRows[0].age), 20);
    assert.strictEqual(Number(createdRows[0].active), 1, 'Omitted active field should receive its MySQL default');

    assert.strictEqual(createdRows[0].status, 'active', 'Omitted ENUM receives database default');
    assert.strictEqual(createdRows[0].signature, "O'Reilly", 'Apostrophe ENUM default round-trips');
    assert.strictEqual(createdRows[0].folder, 'C:\\folder', 'Backslash ENUM default round-trips');
    for (const status of ['deleted', 1, true]) {
        assertResponse(await requestHttp(port, 'PUT', `/students/${studentId}`, { status }), 400, 'Invalid ENUM PUT');
    }
    for (const status of ['ACTIVE', "O'Reilly", 'C:\\folder', 'inactive']) {
        const response = await requestHttp(port, 'PUT', `/students/${studentId}`, { status });
        assertResponse(response, 200, 'Valid ENUM PUT');
        assert.strictEqual(response.json.data.status, status);
    }
    for (const status of ['active', 'ACTIVE', "O'Reilly", 'C:\\folder']) {
        const response = await requestHttp(port, 'POST', '/students', { name: 'EnumTest', age: 20, status });
        assertResponse(response, 201, 'Valid ENUM POST');
        const [rows] = await connection.query('SELECT status FROM Student WHERE id = ?', [response.json.data.id]);
        assert.strictEqual(rows[0].status, status);
        await connection.query('DELETE FROM Student WHERE id = ?', [response.json.data.id]);
    }
    for (const status of ['deleted', 'Active']) {
        await assert.rejects(connection.query('UPDATE Student SET status = ? WHERE id = ?', [status, studentId]));
    }
    currentPhase = 'Student GET collection and item';
    const collection = await requestHttp(port, 'GET', '/students');
    const collectionBody = assertResponse(collection, 200, 'Student collection GET');
    assert.ok(collectionBody.data.some(row => Number(row.id) === studentId), 'Student collection should contain persisted row');

    const fetched = await requestHttp(port, 'GET', `/students/${studentId}`);
    const fetchedBody = assertResponse(fetched, 200, 'Student item GET');
    assert.strictEqual(fetchedBody.data.name, 'A😀');
    assert.strictEqual(Number(fetchedBody.data.active), 1, 'GET should expose the persisted default');

    currentPhase = 'Student PUT persistence';
    const updated = await requestHttp(port, 'PUT', `/students/${studentId}`, {
        name: 'Bea',
        age: 21,
        active: false
    });
    const updatedBody = assertResponse(updated, 200, 'Student PUT');
    assert.strictEqual(updatedBody.data.name, 'Bea');
    assert.strictEqual(Number(updatedBody.data.active), 0);

    const [updatedRows] = await connection.query('SELECT * FROM `Student` WHERE `id` = ?', [studentId]);
    assert.strictEqual(updatedRows[0].name, 'Bea', 'Student PUT should persist the new name');
    assert.strictEqual(Number(updatedRows[0].age), 21, 'Student PUT should persist the new age');
    assert.strictEqual(Number(updatedRows[0].active), 0, 'Student PUT should persist the boolean update');

    currentPhase = 'Course POST and default persistence';
    const courseCreated = await requestHttp(port, 'POST', '/courses', { title: 'Compiler Design' });
    const courseBody = assertResponse(courseCreated, 201, 'Course POST');
    const courseId = Number(courseBody.data.id);
    assert.ok(Number.isInteger(courseId) && courseId > 0, 'Course POST should return an inserted id');

    const courseFetched = await requestHttp(port, 'GET', `/courses/${courseId}`);
    const courseFetchedBody = assertResponse(courseFetched, 200, 'Course item GET');
    assert.strictEqual(Number(courseFetchedBody.data.credits), 3, 'Omitted credits should receive its MySQL default');

    currentPhase = 'MANY_TO_MANY relationship POST';
    const relationshipCreated = await requestHttp(
        port,
        'POST',
        `/students/${studentId}/courses/${courseId}`
    );
    assertResponse(relationshipCreated, 201, 'Student-Course relationship POST');

    const [junctionRows] = await connection.query(
        'SELECT * FROM `Student_Course` WHERE `student_id` = ? AND `course_id` = ?',
        [studentId, courseId]
    );
    assert.strictEqual(junctionRows.length, 1, 'Relationship POST should persist one junction row');

    currentPhase = 'MANY_TO_MANY relationship GET';
    const relationshipFetched = await requestHttp(port, 'GET', `/students/${studentId}/courses`);
    const relationshipBody = assertResponse(relationshipFetched, 200, 'Student-Course relationship GET');
    assert.ok(
        relationshipBody.data.some(row => Number(row.id) === courseId && row.title === 'Compiler Design'),
        'Relationship GET should return the related Course'
    );

    currentPhase = 'MANY_TO_MANY relationship DELETE';
    const relationshipDeleted = await requestHttp(
        port,
        'DELETE',
        `/students/${studentId}/courses/${courseId}`
    );
    assertResponse(relationshipDeleted, 200, 'Student-Course relationship DELETE');

    const [remainingJunctionRows] = await connection.query(
        'SELECT COUNT(*) AS count FROM `Student_Course` WHERE `student_id` = ? AND `course_id` = ?',
        [studentId, courseId]
    );
    assert.strictEqual(Number(remainingJunctionRows[0].count), 0, 'Relationship DELETE should remove the junction row');

    const relationshipAfterDelete = await requestHttp(port, 'GET', `/students/${studentId}/courses`);
    const relationshipAfterDeleteBody = assertResponse(relationshipAfterDelete, 200, 'Relationship GET after DELETE');
    assert.deepStrictEqual(relationshipAfterDeleteBody.data, []);

    currentPhase = 'Student DELETE persistence';
    const deleted = await requestHttp(port, 'DELETE', `/students/${studentId}`);
    assertResponse(deleted, 200, 'Student DELETE');

    const missing = await requestHttp(port, 'GET', `/students/${studentId}`);
    assertResponse(missing, 404, 'Student GET after DELETE');
    const [deletedRows] = await connection.query('SELECT COUNT(*) AS count FROM `Student` WHERE `id` = ?', [studentId]);
    assert.strictEqual(Number(deletedRows[0].count), 0, 'Student DELETE should remove the persisted row');
}

async function main() {
    resources.outputBefore = snapshotDirectory(repositoryOutput);
    let failure = null;
    let failurePhase = null;

    try {
        resources.serverConfig = readServerConfig(process.env);
        resources.databaseName = createTemporaryDatabaseName();

        currentPhase = 'MySQL server connection';
        resources.adminConnection = await mysql.createConnection(resources.serverConfig);

        currentPhase = 'temporary database creation';
        const quotedDatabase = quoteTemporaryDatabaseName(resources.databaseName);
        await resources.adminConnection.query(
            `CREATE DATABASE ${quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        resources.databaseCreated = true;

        currentPhase = 'generated project materialization';
        resources.temporaryProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-generated-mysql-'));
        const generatedFiles = compileProject(testDsl);
        materializeGeneratedFiles(resources.temporaryProjectRoot, generatedFiles);

        const expectedFiles = [
            'database/schema.sql',
            'package.json',
            'server.js',
            'swagger.json',
            'models/Student.js',
            'models/Course.js',
            'routes/studentRoutes.js',
            'routes/courseRoutes.js'
        ];
        for (const relativePath of expectedFiles) {
            assert.ok(fs.existsSync(path.join(resources.temporaryProjectRoot, relativePath)), `Expected generated ${relativePath}`);
        }

        currentPhase = 'generated environment configuration';
        resources.serverPort = await acquireFreePort();
        const generatedEnvironment = makeGeneratedEnvironment(
            resources.serverConfig,
            resources.databaseName,
            resources.serverPort
        );
        const envContent = serializeDotenv(generatedEnvironment);
        fs.writeFileSync(path.join(resources.temporaryProjectRoot, '.env'), envContent, 'utf8');
        assert.deepStrictEqual(dotenv.parse(envContent), generatedEnvironment, 'Generated .env values should round-trip safely');

        currentPhase = 'schema import';
        resources.databaseConnection = await mysql.createConnection({
            ...resources.serverConfig,
            database: resources.databaseName,
            charset: 'utf8mb4',
            multipleStatements: true
        });
        const schemaSql = fs.readFileSync(
            path.join(resources.temporaryProjectRoot, 'database', 'schema.sql'),
            'utf8'
        );
        await resources.databaseConnection.query(schemaSql);

        currentPhase = 'imported schema verification';
        await verifyImportedSchema(resources.databaseConnection, resources.databaseName);

        const swagger = JSON.parse(fs.readFileSync(
            path.join(resources.temporaryProjectRoot, 'swagger.json'),
            'utf8'
        ));
        assert.ok(swagger.paths['/students'].post, 'OpenAPI should describe Student POST');
        assert.ok(swagger.paths['/students/{id}'].get, 'OpenAPI should describe Student item GET');
        assert.ok(swagger.paths['/students/{id}'].put, 'OpenAPI should describe Student PUT');
        assert.ok(swagger.paths['/students/{id}'].delete, 'OpenAPI should describe Student DELETE');
        assert.ok(swagger.paths['/students/{id}/courses'].get, 'OpenAPI should describe relationship GET');
        assert.ok(swagger.paths['/students/{id}/courses/{courseId}'].post, 'OpenAPI should describe relationship POST');
        assert.ok(swagger.paths['/students/{id}/courses/{courseId}'].delete, 'OpenAPI should describe relationship DELETE');

        assert.deepStrictEqual(swagger.components.schemas.Student.properties.status, {
            type: 'string', enum: ['active', 'ACTIVE', 'inactive', "O'Reilly", 'C:\\folder'], default: 'active'
        });
        currentPhase = 'generated dependency installation';
        const install = npmInvocation(['install', '--no-audit', '--no-fund', '--loglevel=error']);
        const installResult = await runCommand(install.command, install.args, {
            cwd: resources.temporaryProjectRoot,
            timeoutMs: 300000,
            env: { ...process.env, npm_config_update_notifier: 'false' },
            onChild: child => { resources.activeChild = child; }
        });
        assert.ok(
            !installResult.timedOut && installResult.code === 0,
            `npm install failed${installResult.timedOut ? ' (timed out)' : ''} ` +
            `(exit ${installResult.code}, signal ${installResult.signal || 'none'}).\n` +
            `stdout:\n${boundedOutput(installResult.stdout)}\n` +
            `stderr:\n${boundedOutput(installResult.stderr)}`
        );

        currentPhase = 'generated backend startup';
        const start = npmInvocation(['start']);
        resources.serverState = startCommand(start.command, start.args, {
            cwd: resources.temporaryProjectRoot,
            env: { ...process.env, ...generatedEnvironment },
            onChild: child => { resources.activeChild = child; }
        });
        await waitForHealth(resources.serverPort, resources.serverState, 30000);

        await exerciseGeneratedApi(resources.databaseConnection, resources.serverPort);
        console.log(`Generated MySQL integration passed with temporary database ${resources.databaseName}.`);
    } catch (error) {
        failure = error;
        failurePhase = currentPhase;
    }

    currentPhase = 'cleanup';
    const cleanupErrors = await cleanupResources();
    if (failure || cleanupErrors.length > 0) {
        const messages = [];
        if (failure) {
            messages.push(
                `Generated MySQL integration failed during phase "${failurePhase}"` +
                `${resources.databaseName ? ` using temporary database ${resources.databaseName}` : ''}.\n${diagnosticError(failure)}`
            );
            if (resources.serverState) {
                messages.push(
                    `Generated server stdout:\n${boundedOutput(resources.serverState.stdout)}\n` +
                    `Generated server stderr:\n${boundedOutput(resources.serverState.stderr)}`
                );
            }
        }
        messages.push(...cleanupErrors);
        throw new Error(messages.join('\n\n'));
    }

    console.log('Server, temporary database, temporary project, port, and repository output cleanup verified.');
}

main().catch(error => {
    console.error(redactSecrets(error.stack || error.message));
    process.exitCode = 1;
});
