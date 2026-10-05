const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { source, UUID, OTHER, valid, compileProject } = require('./uuid-test-helpers');
const { isUuid } = require('../src/utils/uuid');
const { readServerConfig, createTemporaryDatabaseName, quoteTemporaryDatabaseName } = require('./generated-backend-mysql-helpers');
const { snapshotDirectory } = require('./generated-backend-test-helpers');

const database = createTemporaryDatabaseName(), quotedDatabase = quoteTemporaryDatabaseName(database);
const outputPath = path.resolve(__dirname, '../output'), outputBefore = snapshotDirectory(outputPath);
let admin, observer, pool, server, created = false, port, queries = 0, generated = 0, assertions = 0;
const verify = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
function runtime(files, config) {
    const modules = new Map(), runtimeRequire = createRequire(path.resolve(__dirname, '../package.json'));
    const env = { DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user,
        DB_PASSWORD: config.password, DB_NAME: database };
    function get(name) {
        if (modules.has(name)) return modules.get(name);
        const file = files.find(f => f.path === name); assert(file, name);
        const module = { exports: {} };
        const localRequire = ref => {
            if (ref === 'mysql2/promise') return { createPool(options) {
                pool = mysql.createPool({ ...options, port: config.port });
                const query = pool.query.bind(pool);
                pool.query = (...args) => { queries++; return query(...args); };
                return pool;
            } };
            if (ref === 'crypto') return { randomUUID() { generated++; return crypto.randomUUID(); } };
            if (ref === 'dotenv') return { config() {} };
            if (!ref.startsWith('.')) return runtimeRequire(ref);
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), ref));
            return get(target.endsWith('.js') ? target : target + '.js');
        };
        vm.compileFunction(file.content, ['require', 'module', 'exports', 'process'], { filename: name })(localRequire, module, module.exports, { env });
        modules.set(name, module.exports); return module.exports;
    }
    return get;
}
async function call(method, url, body, status = 200) {
    const result = await fetch(`http://127.0.0.1:${port}${url}`, { method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const json = await result.json(); verify(result.status, status, method + ' ' + url + ': ' + JSON.stringify(json));
    verify(json.success, status < 400, 'Existing response envelope'); return json.data;
}
async function rejected(method, url, body) {
    const before = [queries, generated]; await call(method, url, body, 400);
    verify([queries, generated], before, 'Invalid UUID input performs zero SQL calls or generation');
}
async function main() {
    const config = { ...readServerConfig(process.env), connectTimeout: 5000 };
    admin = await mysql.createConnection(config);
    const [version] = await admin.query('SELECT VERSION() AS version');
    console.log('G25 live server: ' + version[0].version + '; mysql2 ' + require('mysql2/package.json').version);
    const files = compileProject(source + `\nENTITY Seed\nuid UUID PRIMARY KEY DEFAULT "${UUID}"\nENTITY RequiredKey\nid UUID PRIMARY KEY REQUIRED`);
    await admin.query('CREATE DATABASE ' + quotedDatabase + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true;
    observer = await mysql.createConnection({ ...config, database });
    for (const sql of files.find(f => f.path === 'database/schema.sql').content.split(';').filter(s => s.trim())) await observer.query(sql);
    const [columns] = await observer.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [database]);
    const byColumn = new Map(columns.map(c => [c.TABLE_NAME + '.' + c.COLUMN_NAME, c]));
    const uuidColumns = columns.filter(c => c.DATA_TYPE === 'char');
    verify(uuidColumns.length >= 18, true, 'Entity, FK and junction UUID columns exist');
    for (const c of uuidColumns) {
        verify([c.COLUMN_TYPE, Number(c.CHARACTER_MAXIMUM_LENGTH), c.CHARACTER_SET_NAME, c.COLLATION_NAME, c.EXTRA],
            ['char(36)', 36, 'ascii', 'ascii_bin', ''], c.TABLE_NAME + '.' + c.COLUMN_NAME + ' exact UUID physical contract');
    }
    verify(byColumn.get('User.uid').COLUMN_DEFAULT, null, 'Runtime key has no SQL default');
    verify(byColumn.get('Seed.uid').COLUMN_DEFAULT, UUID, 'Static key default is preserved');
    const [foreignKeys] = await observer.query('SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL', [database]);
    verify(foreignKeys.length, 6, 'All four cardinalities, mixed keys and junction constraints import');
    for (const fk of foreignKeys) {
        const a = byColumn.get(fk.TABLE_NAME + '.' + fk.COLUMN_NAME), b = byColumn.get(fk.REFERENCED_TABLE_NAME + '.' + fk.REFERENCED_COLUMN_NAME);
        verify([a.COLUMN_TYPE, a.CHARACTER_SET_NAME, a.COLLATION_NAME], [b.COLUMN_TYPE, b.CHARACTER_SET_NAME, b.COLLATION_NAME], 'FK columns physically match referenced UUID keys');
    }
    const get = runtime(files, config); server = get('server.js').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve)); port = server.address().port;
    const body = { email: 'first@example.com', requiredUuid: UUID, token: OTHER, label: 'not-a-uuid' };
    const beforeGeneration = generated, user = await call('POST', '/users', body, 201);
    verify(generated, beforeGeneration + 1, 'Exactly one UUID per omitted-PK create'); verify(isUuid(user.uid), true, 'Generated UUID canonical');
    verify(Object.hasOwn(user, 'fixed'), false, 'Arbitrary DB default omitted from create echo');
    const [inserted] = await observer.query('SELECT uid, token, fixed FROM User WHERE uid = ?', [user.uid]);
    verify(inserted[0], { uid: user.uid, token: OTHER, fixed: UUID }, 'Generated identity and ordinary UUID/default persist exactly');
    const fetched = await call('GET', '/users/' + user.uid);
    verify([fetched.uid, fetched.token, fetched.fixed, fetched.label], [user.uid, OTHER, UUID, 'not-a-uuid'], 'UUID reads and unrelated STRING contract');
    const ids = [user.uid];
    for (const [index, id] of valid.entries()) {
        const count = generated, made = await call('POST', '/users', { uid: id, email: `supplied${index}@example.com`, requiredUuid: UUID }, 201);
        verify(made.uid, id, 'All canonical versions/nil/max accepted unchanged'); verify(generated, count, 'Supplied UUID does not generate');
    }
    for (let index = 0; index < 3; index++) {
        const made = await call('POST', '/users', { email: `generated${index}@example.com`, requiredUuid: UUID, ...(index === 0 ? { uid: null } : {}) }, 201);
        verify(isUuid(made.uid), true, 'Omitted/optional-null key generates'); ids.push(made.uid);
    }
    verify(new Set(ids).size, ids.length, 'Multiple generated keys are distinct and stored');
    await call('POST', '/users', { ...body, email: 'unique-token@example.com' }, 409);
    await call('POST', '/users', { email: body.email, requiredUuid: UUID }, 409);
    await rejected('POST', '/users', { email: 'missing@example.com' });
    await rejected('POST', '/users', { email: 'null@example.com', requiredUuid: null });
    const required = await call('POST', '/requiredkeys', {}, 201); verify(isUuid(required.id), true, 'REQUIRED key omission generates');
    await rejected('POST', '/requiredkeys', { id: null });
    const seedGeneration = generated; verify((await call('POST', '/seeds', {}, 201)).uid, UUID, 'Declared-default identity response');
    verify(generated, seedGeneration, 'Static DEFAULT never calls randomUUID'); await call('POST', '/seeds', {}, 409);
    await call('POST', '/seeds', { uid: OTHER }, 201);
    for (const value of [UUID.toUpperCase(), 'bad', UUID + '\n', UUID + ' ', UUID.replaceAll('-', ''), 3, true, {}, []]) {
        await rejected('POST', '/users', { ...body, token: value });
        await rejected('PUT', '/users/' + user.uid, { token: value });
        await rejected('POST', '/users', { ...body, uid: value });
    }
    await rejected('PUT', '/users/' + user.uid, { uid: user.uid });
    for (const method of ['GET', 'PUT', 'DELETE']) await rejected(method, '/users/BAD', method === 'PUT' ? {} : undefined);
    await rejected('GET', '/users?token=' + UUID.toUpperCase());
    verify((await call('GET', '/users?uid=' + user.uid))[0].uid, user.uid, 'UUID key equality filter');
    verify((await call('GET', '/users?token=' + OTHER))[0].uid, user.uid, 'Ordinary UUID equality filter');
    const sorted = await call('GET', '/users?sort=uid&order=desc'); verify(sorted.map(r => r.uid), sorted.map(r => r.uid).sort().reverse(), 'ASCII UUID sort');
    const updated = await call('PUT', '/users/' + user.uid, { token: UUID }); verify(updated.token, UUID, 'Ordinary UUID update/reread');
    verify((await call('PUT', '/users/' + user.uid, { token: null })).token, null, 'Optional UUID NULL remains NULL');
    const profile = await call('POST', '/profiles', { token: UUID }, 201), post = await call('POST', '/posts', { token: UUID }, 201);
    const company = await call('POST', '/companies', { token: UUID }, 201), group = await call('POST', '/groups', { token: UUID }, 201);
    const member = await call('POST', '/members', {}, 201);
    // FK write authority remains unchanged: generated API does not accept synthetic FK fields.
    await observer.query('UPDATE Profile SET user_uid = ? WHERE id = ?', [user.uid, profile.id]);
    await observer.query('UPDATE Post SET user_uid = ? WHERE id = ?', [user.uid, post.id]);
    await observer.query('UPDATE User SET company_id = ? WHERE uid = ?', [company.id, user.uid]);
    await observer.query('UPDATE Member SET company_id = ? WHERE id = ?', [company.id, member.id]);
    verify((await call('GET', '/users/' + user.uid + '/profile')).id, profile.id, 'UUID/UUID ONE_TO_ONE lookup');
    verify((await call('GET', '/users/' + user.uid + '/posts'))[0].id, post.id, 'UUID/INT ONE_TO_MANY lookup');
    verify((await call('GET', '/users/' + user.uid + '/company')).id, company.id, 'UUID/UUID MANY_TO_ONE join');
    verify((await call('GET', '/members/' + member.id + '/company')).id, company.id, 'INT/UUID MANY_TO_ONE join');
    const association = `/users/${user.uid}/groups/${group.code}`;
    verify(await call('POST', association, undefined, 201), { user_uid: user.uid, group_code: group.code }, 'M2M exact UUID echoes');
    verify((await call('GET', `/users/${user.uid}/groups`))[0].code, group.code, 'UUID M2M join');
    await call('DELETE', association); verify(await call('GET', `/users/${user.uid}/groups`), [], 'M2M remove persists');
    await call('POST', association, undefined, 201);
    for (const suffix of ['profile', 'posts', 'company', 'groups']) await rejected('GET', '/users/bad/' + suffix);
    for (const method of ['POST', 'DELETE']) {
        await rejected(method, '/users/bad/groups/' + group.code); await rejected(method, '/users/' + user.uid + '/groups/BAD');
    }
    // External writes can bypass the application validator. Every read route fails safely.
    await observer.query('UPDATE User SET token = ? WHERE uid = ?', ['BAD', user.uid]);
    await call('GET', '/users/' + user.uid, undefined, 500); await call('GET', '/users?uid=' + user.uid, undefined, 500);
    await call('PUT', '/users/' + user.uid, {}, 500); await observer.query('UPDATE User SET token = NULL WHERE uid = ?', [user.uid]);
    for (const [table, key, id, suffix] of [['Profile', 'id', profile.id, 'profile'], ['Post', 'id', post.id, 'posts'],
        ['Company', 'id', company.id, 'company'], ['Group', 'code', group.code, 'groups']]) {
        await observer.query('UPDATE `' + table + '` SET token = ? WHERE `' + key + '` = ?', [UUID.toUpperCase(), id]);
        await call('GET', '/users/' + user.uid + '/' + suffix, undefined, 500);
        await observer.query('UPDATE `' + table + '` SET token = ? WHERE `' + key + '` = ?', [UUID, id]);
    }
    await call('DELETE', '/users/' + user.uid);
    await call('GET', '/profiles/' + profile.id, undefined, 404);
    verify((await call('GET', '/posts/' + post.id)).user_uid, null, 'ONE_TO_MANY ON DELETE SET NULL');
    const [junction] = await observer.query('SELECT COUNT(*) AS total FROM User_Group WHERE user_uid = ?', [user.uid]); verify(Number(junction[0].total), 0, 'M2M cascade on source deletion');
    await call('DELETE', '/companies/' + company.id);
    verify((await call('GET', '/members/' + member.id)).company_id, null, 'MANY_TO_ONE ON DELETE SET NULL');
    console.log(`G25 live MySQL PASS: ${assertions} assertions, ${queries} generated SQL queries, ${uuidColumns.length} UUID columns, ${foreignKeys.length} compatible FK constraints; all cardinalities and G06 conflicts verified.`);
}
async function cleanup() {
    const failures = [];
    for (const action of [async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
        async () => { if (pool) await pool.end(); }, async () => { if (observer) await observer.end(); },
        async () => { if (created) { await admin.query('DROP DATABASE ' + quotedDatabase);
            const [rows] = await admin.query('SELECT COUNT(*) AS total FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
            verify(Number(rows[0].total), 0, 'Disposable DB removed'); created = false; } },
        async () => { if (admin) await admin.end(); }, async () => { verify(snapshotDirectory(outputPath), outputBefore, 'output/ unchanged'); }]) {
        try { await action(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'G25 cleanup failed');
    console.log('G25 live cleanup PASS: HTTP server, pool, observer and guarded disposable database removed; output/ unchanged.');
}
(async () => { let failure;
    try { await main(); } catch (error) { failure = error; }
    try { await cleanup(); } catch (error) { failure = failure || error; }
    if (failure) { console.error('G25 live verification failed:', failure.code || failure.name, failure.code ? '' : failure.message); process.exitCode = 1; }
})().catch(error => { console.error('G25 live failure:', error.code || error.name); process.exitCode = 1; });
