'use strict';
// Controlled connector/process faults, exclusively OFFLINE evidence.
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { compile } = require('../src/persistent-runtime/compile');
const database = require('../src/persistent-runtime/database');
const provenance = require('../src/persistent-runtime/provenance');
const { createManager } = require('../src/persistent-runtime/manager');
const SOURCE = 'ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED';
function fakeDatabase(target) {
    const databases = new Map(), sql = []; let fault, unavailable = false;
    function failAt(stage, after = false) {
        if (fault === stage + (after ? ':after' : ':before')) { fault = null; throw Error('PRIVATE_SECRET SQL C:\\private'); }
    }
    async function connector(name) {
        if (unavailable) throw Error('PRIVATE_SECRET');
        if (target === 'mysql' && name && !databases.has(name)) { const error = Error('PRIVATE_SECRET'); error.code = 'ER_BAD_DB_ERROR'; throw error; }
        return { destroy() {}, async end() { failAt('close'); },
            async query(input, values) {
                const text = typeof input === 'string' ? input : input.sql;
                const normalized = text.replace(/\$\d+/g, '?'); sql.push({ database: name, text: normalized });
                let rows = [], count = 0; const db = databases.get(name);
                if (normalized.startsWith('SELECT VERSION')) rows = [{ version: '8.4.11', autocommit: 1, engine: 'InnoDB', durable: 1,
                    mode: 'STRICT_TRANS_TABLES', page_size: 16384, row_format: 'dynamic' }];
                else if (normalized.startsWith("SELECT current_setting")) rows = [{ version: '180003', encoding: 'UTF8', fsync: 'on', durable: 'on' }];
                else if (normalized.includes('FROM information_schema.SCHEMATA') || normalized.includes('FROM pg_database')) rows = databases.has(values[0]) ? [{}] : [];
                else if (normalized.startsWith('CREATE DATABASE ')) {
                    failAt('create'); const databaseName = /[`"](apiforge_p_[mp]_[a-f0-9]{48})[`"]/.exec(normalized)[1];
                    if (databases.has(databaseName)) throw Error('collision');
                    databases.set(databaseName, { record: null, table: false, imports: 0, applicationRows: [] }); failAt('create', true);
                } else if (normalized.startsWith('CREATE TABLE ') && normalized.includes('__apiforge_runtime_v1')) {
                    if (!db || db.table) throw Error('collision'); db.table = true;
                } else if (normalized.startsWith('INSERT INTO ') && normalized.includes('__apiforge_runtime_v1')) {
                    failAt('marker'); db.record = { singleton: 1, format: 1, provenance: values[0], deployment_id: values[1], state: 'provisioning', runtime_owner: null };
                    failAt('marker', true);
                } else if (normalized.includes('FROM information_schema.TABLES')) rows = db?.table ? [{ ENGINE: 'InnoDB' }] : [];
                else if (normalized.includes('FROM pg_catalog.pg_class')) rows = db?.table ? [{ relkind: 'r', relpersistence: 'p' }] : [];
                else if (normalized.startsWith('SELECT CAST(singleton')) rows = db?.record ? [{ ...db.record }] : [];
                else if (normalized.startsWith('UPDATE ')) {
                    const record = db.record;
                    if (normalized.includes("SET state='ready'")) {
                        failAt('ready');
                        if (record.state === 'provisioning' && record.provenance === values[0] && record.runtime_owner === null) { record.state = 'ready'; count = 1; }
                        failAt('ready', true);
                    } else if (normalized.includes('SET runtime_owner=NULL')) {
                        failAt('release');
                        if (record.state === 'ready' && record.provenance === values[0] && record.deployment_id === values[1] && record.runtime_owner === values[2]) { record.runtime_owner = null; count = 1; }
                        failAt('release', true);
                    } else {
                        failAt('claim');
                        if (record.state === 'ready' && record.runtime_owner === null && record.provenance === values[1] && record.deployment_id === values[2]) { record.runtime_owner = values[0]; count = 1; }
                        failAt('claim', true);
                    }
                } else {
                    if (!db) throw Error('missing'); failAt('schema'); db.imports++; failAt('schema', true);
                }
                return target === 'mysql' ? [rows.length ? rows : { affectedRows: count }] : { rows, rowCount: count };
            } };
    }
    return { databases, sql, connector, fault(stage) { fault = stage; }, unavailable(value) { unavailable = value; } };
}
function fixture(target = 'mysql') {
    const storeId = randomUUID(), project = { id: randomUUID(), target, revision: 1, source: SOURCE, sourceHash: provenance.hash(SOURCE) };
    const native = fakeDatabase(target), events = [], children = [];
    let processFault, responseBody = { data: [] }, compileTransform = value => value;
    const prefix = target === 'mysql' ? 'APIFORGE_PERSISTENT_MYSQL_' : 'APIFORGE_PERSISTENT_PG_';
    const env = { APIFORGE_PERSISTENT_RUNNER: '1', APIFORGE_PROJECT_API: '1',
        [prefix + 'HOST']: '127.0.0.1', [prefix + 'PORT']: target === 'mysql' ? '3306' : '5432',
        [prefix + 'USER']: 'offline', [prefix + 'PASSWORD']: 'PRIVATE_SECRET' };
    const input = () => ({ projectId: project.id, target, expectedRevision: project.revision });
    const step = name => { events.push(name); if (processFault === name) throw Error('PRIVATE_SECRET C:\\private'); };
    const dependencies = {
        openStore: async () => { step('store'); return { storeId, getProject: async () => ({ ...project }),
            getProjectRevision: async () => ({ ...project }), close() { step('storeClose'); } }; },
        compile: (source, selected) => compileTransform(compile(source, selected)),
        resource: (identity, config) => database.resource(identity, config, { connector: native.connector }),
        createProject: async () => { step('directory'); return '/offline-owned'; },
        materialize: async () => step('materialize'), freePort: async () => { step('port'); return 34567; },
        launch: () => { step('launch'); const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.connected = true;
            const state = { child, failed: false, listenerReady: true };
            for (const event of ['disconnect', 'error', 'exit']) child.on(event, () => { state.failed = true; state.listenerReady = false; });
            child.disconnect = () => { child.connected = false; child.emit('disconnect'); };
            children.push(state); return state; },
        health: async () => step('health'),
        stop: async state => { step('stop'); if (state && state.child.exitCode === null) { state.child.exitCode = 0; state.child.emit('exit'); } },
        released: async () => step('released'), removeProject: async () => step('remove'),
        request: async () => ({ success: true, status: 200, headers: {}, body: responseBody })
    };
    const makeManager = () => createManager({ env, dependencies });
    return { target, env, input, project, native, events, children, dependencies, makeManager,
        identity: () => provenance.build(storeId, project, compile(project.source, target)),
        processFault(value) { processFault = value; }, response(value) { responseBody = value; }, transform(value) { compileTransform = value; } };
}
module.exports = { fixture, fakeDatabase, SOURCE };
