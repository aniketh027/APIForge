// Opt-in G24 integration: run only with configured APIFORGE_TEST_DB_* credentials.
// Every database mutation stays inside a newly created, guarded disposable DB.
const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const mysql = require('mysql2/promise');
const { compileProject, assertPortReleased, snapshotDirectory } = require('./generated-backend-test-helpers');
const { readServerConfig, createTemporaryDatabaseName, quoteTemporaryDatabaseName } = require('./generated-backend-mysql-helpers');

const source = [
    'ENTITY Event',
    'id INT PRIMARY KEY',
    'eventDate DATE REQUIRED UNIQUE',
    'createdAt TIMESTAMP REQUIRED UNIQUE',
    'defaultDate DATE DEFAULT "2026-01-01"',
    'defaultAt TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"',
    'optionalDate DATE',
    'optionalAt TIMESTAMP',
    'label STRING',
    ...['Child', 'Owner', 'Profile', 'Tag'].flatMap(name => [
        'ENTITY ' + name,
        'id INT PRIMARY KEY',
        'happenedOn DATE',
        'changedAt TIMESTAMP',
        ...(name === 'Tag' ? ['__proto__ DATE'] : [])
    ]),
    'RELATION Event contains Child ONE_TO_MANY',
    'RELATION Event ownedBy Owner MANY_TO_ONE',
    'RELATION Event has Profile ONE_TO_ONE',
    'RELATION Event taggedWith Tag MANY_TO_MANY'
].join('\n');

const repositoryOutput = path.resolve(__dirname, '../output');
const outputBefore = snapshotDirectory(repositoryOutput);
const database = createTemporaryDatabaseName();
const runtimeRequire = createRequire(path.resolve(__dirname, '../package.json'));
let admin, observer, generatedPool, server, serverPort, created = false;
let queryCount = 0, acquisitionCount = 0, checks = 0;
const zones = new Set();
const connectionIds = new Set();

function verify(actual, expected, label) {
    assert.deepEqual(actual, expected, label);
    checks += 1;
}

function generatedRuntime(files, configuration) {
    const modules = new Map();
    const environment = {
        DB_HOST: configuration.host,
        DB_PORT: String(configuration.port),
        DB_USER: configuration.user,
        DB_PASSWORD: configuration.password,
        DB_NAME: database
    };
    const mysqlAdapter = {
        createPool(options) {
            verify(options.timezone, 'Z', 'Generated mysql2 timezone must be UTC');
            verify(options.dateStrings, ['DATE', 'TIMESTAMP'], 'Only temporal columns use string returns');
            // A one-connection pool forces checkout reuse throughout this matrix.
            generatedPool = mysql.createPool({ ...options, connectionLimit: 1 });
            const acquire = generatedPool.getConnection.bind(generatedPool);
            generatedPool.getConnection = async () => {
                const connection = await acquire();
                acquisitionCount += 1;
                connectionIds.add(connection.threadId);
                const rawQuery = connection.query.bind(connection);
                const rawExecute = connection.execute.bind(connection);
                // Poison every new/reused session before the generated wrapper sees it.
                await rawQuery("SET SESSION time_zone = '+05:30'");
                const instrument = method => async (sql, values) => {
                    const text = typeof sql === 'string' ? sql : sql.sql;
                    if (!/^\s*SET\s+(?:SESSION\s+)?time_zone\s*=/i.test(text)) {
                        const [rows] = await rawQuery('SELECT @@session.time_zone AS zone');
                        verify(rows[0].zone, '+00:00', 'UTC initialization must finish before every application query');
                        zones.add(rows[0].zone);
                        queryCount += 1;
                    }
                    return method(sql, values);
                };
                connection.query = instrument(rawQuery);
                connection.execute = instrument(rawExecute);
                return connection;
            };
            return generatedPool;
        }
    };

    function get(name) {
        if (modules.has(name)) return modules.get(name);
        const file = files.find(item => item.path === name);
        assert.ok(file, 'Generated dependency must exist: ' + name);
        const module = { exports: {} };
        modules.set(name, module.exports);
        const localRequire = reference => {
            if (reference === 'mysql2/promise') return mysqlAdapter;
            if (reference === 'dotenv') return { config() {} };
            if (!reference.startsWith('.')) return runtimeRequire(reference);
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), reference));
            return get(target.endsWith('.js') ? target : target + '.js');
        };
        vm.compileFunction(file.content, ['require', 'module', 'exports', 'process'], { filename: name })(
            localRequire, module, module.exports, { env: environment }
        );
        modules.set(name, module.exports);
        return module.exports;
    }
    return get;
}

async function call(method, url, body, status = 200) {
    const response = await fetch('http://127.0.0.1:' + serverPort + url, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    const result = await response.json();
    verify(response.status, status, `${method} ${url}: ${JSON.stringify(result)}`);
    verify(result.success, status < 400, 'Preserve generated success/error envelope');
    return result.data;
}

async function rejected(method, url, body) {
    const before = queryCount;
    const acquisitionsBefore = acquisitionCount;
    await call(method, url, body, 400);
    verify(queryCount, before, 'Invalid temporal HTTP input must execute zero DB queries');
    verify(acquisitionCount, acquisitionsBefore, 'Invalid temporal HTTP input must not acquire a DB connection');
}

async function main() {
    const config = { ...readServerConfig(process.env), connectTimeout: 5000 };
    admin = await mysql.createConnection(config);
    const [metadata] = await admin.query('SELECT VERSION() AS version, @@global.time_zone AS globalZone, @@session.time_zone AS sessionZone');
    console.log('G24 live server: ' + JSON.stringify(metadata[0]) + '; mysql2 ' + require('mysql2/package.json').version);

    const files = compileProject(source);
    await admin.query('CREATE DATABASE ' + quoteTemporaryDatabaseName(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    created = true;
    observer = await mysql.createConnection({ ...config, database, timezone: 'Z', dateStrings: ['DATE', 'TIMESTAMP'] });
    // Import DDL from non-UTC and legacy implicit-TIMESTAMP session settings.
    await observer.query("SET SESSION time_zone = '+05:30'");
    await observer.query('SET SESSION explicit_defaults_for_timestamp = OFF');
    const schema = files.find(file => file.path === 'database/schema.sql').content;
    for (const statement of schema.split(';').filter(statement => statement.trim())) await observer.query(statement);
    const [importSettings] = await observer.query('SELECT @@session.explicit_defaults_for_timestamp AS explicitDefaults');
    verify(Number(importSettings[0].explicitDefaults), 1, 'DDL must disable legacy implicit TIMESTAMP defaults');
    await observer.query("SET SESSION time_zone = '+00:00'");
    const [columns] = await observer.query(
        'SELECT COLUMN_NAME, DATA_TYPE, DATETIME_PRECISION, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [database, 'Event']
    );
    const columnMap = new Map(columns.map(column => [column.COLUMN_NAME, column]));
    verify(columnMap.get('eventDate').DATA_TYPE, 'date', 'DATE must remain DATE');
    verify(columnMap.get('createdAt').DATA_TYPE, 'timestamp', 'TIMESTAMP must remain TIMESTAMP');
    verify(Number(columnMap.get('createdAt').DATETIME_PRECISION), 0, 'No fractional SQL precision');
    verify(columnMap.get('eventDate').IS_NULLABLE, 'NO', 'REQUIRED DATE imports as NOT NULL');
    verify(columnMap.get('createdAt').IS_NULLABLE, 'NO', 'REQUIRED TIMESTAMP imports as NOT NULL');
    verify(columnMap.get('createdAt').COLUMN_DEFAULT, null, 'REQUIRED TIMESTAMP acquires no implicit dynamic default');
    verify(columnMap.get('createdAt').EXTRA, '', 'TIMESTAMP acquires no ON UPDATE behavior');
    verify(columnMap.get('defaultDate').COLUMN_DEFAULT, '2026-01-01', 'DATE default metadata');
    verify(columnMap.get('defaultAt').COLUMN_DEFAULT, '2026-10-05 12:30:00', 'UTC TIMESTAMP default metadata');

    const get = generatedRuntime(files, config);
    server = get('server.js').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    serverPort = server.address().port;
    const valid = { eventDate: '2026-10-05', createdAt: '2026-10-05T12:30:00Z', label: '2026-10-05 12:30:00' };
    const first = await call('POST', '/events', valid, 201);
    verify(first.eventDate, valid.eventDate, 'DATE create echo');
    verify(first.createdAt, valid.createdAt, 'TIMESTAMP create echo remains canonical');
    verify(Object.hasOwn(first, 'defaultDate'), false, 'Omitted database DATE default stays omitted on create');
    verify(Object.hasOwn(first, 'defaultAt'), false, 'Omitted database TIMESTAMP default stays omitted on create');
    const id = first.id;
    const read = await call('GET', '/events/' + id);
    verify(read.defaultDate, '2026-01-01', 'DATE default persists and reads');
    verify(read.defaultAt, '2026-10-05T12:30:00Z', 'TIMESTAMP default preserves UTC instant through non-UTC DDL import');
    verify(read.label, valid.label, 'Ordinary STRING fields are never normalized');
    verify(read.optionalDate, null, 'DATE NULL remains NULL');
    verify(read.optionalAt, null, 'TIMESTAMP NULL remains NULL');

    const boundaries = [
        { eventDate: '1000-01-01', createdAt: '1970-01-01T00:00:01Z' },
        { eventDate: '9999-12-31', createdAt: '2038-01-19T03:14:07Z' }
    ];
    for (const value of boundaries) {
        const inserted = await call('POST', '/events', value, 201);
        const fetched = await call('GET', '/events/' + inserted.id);
        verify(fetched.eventDate, value.eventDate, 'Live DATE boundary');
        verify(fetched.createdAt, value.createdAt, 'Live TIMESTAMP boundary');
    }
    verify((await call('GET', '/events?sort=eventDate')).map(row => row.eventDate), ['1000-01-01', '2026-10-05', '9999-12-31'], 'DATE whitelist sorting');
    verify((await call('GET', '/events?sort=createdAt&order=desc')).map(row => row.createdAt), ['2038-01-19T03:14:07Z', valid.createdAt, '1970-01-01T00:00:01Z'], 'TIMESTAMP whitelist sorting');
    for (const [field, value] of [['eventDate', valid.eventDate], ['createdAt', valid.createdAt]]) {
        verify((await call('GET', '/events?' + field + '=' + encodeURIComponent(value))).map(row => row.id), [id], field + ' exact equality binding');
    }

    const invalidDates = ['2026-2-03', '2026/02/03', '2026-02-30', '2025-02-29', '0999-12-31', '10000-01-01', '', 123, true, {}, [], null];
    const invalidTimestamps = ['1970-01-01T00:00:00Z', '2038-01-19T03:14:08Z', '2026-02-30T10:00:00Z', '2026-10-05 12:30:00', '2026-10-05T12:30:00+05:30', '2026-10-05T12:30:00.123Z', '2026-10-05T24:00:00Z', '2026-10-05T12:60:00Z', '2026-10-05T12:30:60Z', '2026-10-05T12:30:00z', '', 123, true, {}, [], null];
    for (const [field, values] of [['eventDate', invalidDates], ['createdAt', invalidTimestamps]]) {
        for (const value of values) {
            await rejected('POST', '/events', { ...valid, [field]: value });
            await rejected('PUT', '/events/' + id, { [field]: value });
            if (typeof value === 'string') await rejected('GET', '/events?' + field + '=' + encodeURIComponent(value));
        }
    }
    await rejected('POST', '/events', { createdAt: valid.createdAt });
    await rejected('POST', '/events', { eventDate: valid.eventDate });
    await call('POST', '/events', { eventDate: valid.eventDate, createdAt: '2026-10-06T00:00:01Z' }, 409);
    await call('POST', '/events', { eventDate: '2026-10-06', createdAt: valid.createdAt }, 409);
    const updated = await call('PUT', '/events/' + id, { eventDate: '2024-02-29', createdAt: '2024-02-29T23:59:59Z', optionalDate: null, optionalAt: null });
    verify(updated.eventDate, '2024-02-29', 'Leap DATE update reread');
    verify(updated.createdAt, '2024-02-29T23:59:59Z', 'TIMESTAMP update reread');
    verify(updated.optionalAt, null, 'Explicit optional TIMESTAMP NULL writes');
    verify(updated.optionalDate, null, 'Explicit optional DATE NULL writes');

    const publicTime = '2024-02-29T23:59:59Z';
    const [utcRows] = await observer.query('SELECT eventDate, createdAt, UNIX_TIMESTAMP(createdAt) AS epoch FROM `Event` WHERE id = ?', [id]);
    verify(utcRows[0].eventDate, '2024-02-29', 'UTC observer DATE');
    verify(utcRows[0].createdAt, '2024-02-29 23:59:59', 'UTC observer SQL TIMESTAMP');
    verify(Number(utcRows[0].epoch), Date.parse(publicTime) / 1000, 'Underlying TIMESTAMP epoch matches supplied UTC instant');
    await observer.query("SET SESSION time_zone = '+05:30'");
    const [localRows] = await observer.query('SELECT eventDate, createdAt, UNIX_TIMESTAMP(createdAt) AS epoch FROM `Event` WHERE id = ?', [id]);
    verify(localRows[0].eventDate, '2024-02-29', 'Non-UTC observer does not shift DATE');
    verify(localRows[0].createdAt, '2024-03-01 05:29:59', 'Non-UTC SQL representation demonstrates same stored instant');
    verify(Number(localRows[0].epoch), Number(utcRows[0].epoch), 'Epoch is stable under non-UTC observer session');
    await observer.query("SET SESSION time_zone = '+00:00'");
    verify((await call('GET', '/events/' + id)).createdAt, publicTime, 'Generated app reads UTC after observer timezone change');

    const targetValue = { happenedOn: '2000-02-29', changedAt: '2026-10-05T12:30:45Z' };
    const targetIds = {};
    for (const [name, route] of [['Child', '/childs'], ['Owner', '/owners'], ['Profile', '/profiles'], ['Tag', '/tags']]) {
        const body = name === 'Tag' ? JSON.parse(JSON.stringify(targetValue).slice(0, -1) + ',"__proto__":"2026-10-05"}') : targetValue;
        const value = await call('POST', route, body, 201);
        targetIds[name] = value.id;
        verify(value.changedAt, targetValue.changedAt, name + ' canonical create response');
    }
    // Generated FK columns are intentionally not public body-write fields.
    await observer.query('UPDATE `Child` SET event_id = ? WHERE id = ?', [id, targetIds.Child]);
    await observer.query('UPDATE `Event` SET owner_id = ? WHERE id = ?', [targetIds.Owner, id]);
    await observer.query('UPDATE `Profile` SET event_id = ? WHERE id = ?', [id, targetIds.Profile]);
    await call('POST', '/events/' + id + '/tags/' + targetIds.Tag, undefined, 201);
    for (const [cardinality, suffix, plural] of [['ONE_TO_MANY', 'childs', true], ['MANY_TO_ONE', 'owner', false], ['ONE_TO_ONE', 'profile', false], ['MANY_TO_MANY', 'tags', true]]) {
        const result = await call('GET', '/events/' + id + '/' + suffix);
        const row = plural ? result[0] : result;
        verify(row.happenedOn, targetValue.happenedOn, cardinality + ' target DATE normalization');
        verify(row.changedAt, targetValue.changedAt, cardinality + ' target TIMESTAMP normalization');
        if (cardinality === 'MANY_TO_MANY') {
            verify(Object.hasOwn(row, '__proto__'), true, 'Preserve own prototype-sensitive temporal target field');
            verify(row.__proto__, '2026-10-05', 'Prototype-sensitive DATE read');
        }
    }
    const [executeRows] = await generatedPool.execute('SELECT createdAt FROM `Event` WHERE id = ?', [id]);
    verify(executeRows[0].createdAt, '2024-02-29 23:59:59', 'Prepared binary protocol returns SQL TIMESTAMP string in UTC');
    assert.ok(acquisitionCount > 20, 'Many reused pool acquisitions exercised');
    assert.ok(acquisitionCount > connectionIds.size, 'Real MySQL connections must be reused across checkouts');
    verify([...zones], ['+00:00'], 'Every application query observed UTC despite checkout poisoning');
    console.log(`G24 live PASS: ${checks} checks, ${queryCount} application queries, ${acquisitionCount} deliberately non-UTC pool acquisitions across ${connectionIds.size} actual connections; all cardinalities, bounds, defaults, validation, filters, sort, UTC epoch and prototype-sensitive fields.`);
}

async function cleanup() {
    const errors = [];
    for (const action of [
        async () => { if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (serverPort) await assertPortReleased(serverPort); },
        async () => { if (generatedPool) await generatedPool.end(); },
        async () => { if (observer) await observer.end(); },
        async () => {
            if (!created) return;
            await admin.query('DROP DATABASE ' + quoteTemporaryDatabaseName(database));
            const [remaining] = await admin.query('SELECT COUNT(*) AS total FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
            verify(Number(remaining[0].total), 0, 'Disposable DB must be removed');
            created = false;
        },
        async () => { if (admin) await admin.end(); },
        async () => { verify(snapshotDirectory(repositoryOutput), outputBefore, 'Protected output/ stays byte-identical'); }
    ]) {
        try { await action(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'G24 cleanup failed');
    console.log('G24 live cleanup PASS: disposable database, generated pool, observer, HTTP server and port; protected output/ unchanged.');
}

(async () => {
    let failure;
    try { await main(); } catch (error) { failure = error; }
    try { await cleanup(); } catch (error) { failure = failure || error; }
    if (failure) {
        // Driver failures expose only a code; never print connection options/credentials.
        console.error('G24 live verification failed:', failure.code || failure.name, failure.code ? '' : failure.message);
        process.exitCode = 1;
    }
})().catch(error => { console.error('G24 live failure:', error.code || error.name); process.exitCode = 1; });
