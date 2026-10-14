'use strict';
const { randomBytes } = require('crypto');
const { fail } = require('./errors');
const NAME_PATTERN = /^apiforge_live_[a-f0-9]{24}$/;
function configuration(target, env) {
    if (!['mysql', 'postgres'].includes(target)) fail('LIVE_REQUEST_INVALID');
    const prefix = target === 'mysql' ? 'APIFORGE_LIVE_MYSQL_' : 'APIFORGE_LIVE_PG_';
    if (['HOST', 'PORT', 'USER', 'PASSWORD'].some(key => typeof env[prefix + key] !== 'string'
        || (key !== 'PASSWORD' && !env[prefix + key].trim()))) return null;
    const port = Number(env[prefix + 'PORT']);
    if (!/^\d+$/.test(env[prefix + 'PORT']) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: env[prefix + 'HOST'], port, user: env[prefix + 'USER'], password: env[prefix + 'PASSWORD'],
        ...(target === 'postgres' ? { adminDatabase: env.APIFORGE_LIVE_PG_ADMIN_DB || 'postgres' } : {}) };
}
function databaseResource(target, config) {
    if (!['mysql', 'postgres'].includes(target)) fail('LIVE_REQUEST_INVALID');
    const name = 'apiforge_live_' + randomBytes(12).toString('hex');
    const connections = new Set();
    // Only an acknowledged CREATE grants deletion authority. Uncertain outcomes
    // stay blocked for operator assessment; a known collision grants no ownership.
    let creation = 'not-issued', setupStarted = false;
    function quote() { if (!NAME_PATTERN.test(name)) fail('LIVE_DATABASE_SETUP_FAILED'); return target === 'mysql' ? '`' + name + '`' : '"' + name + '"'; }
    async function connect(database, schemaImport = false) {
        if (target === 'mysql') {
            const connection = await require('mysql2/promise').createConnection({
                host: config.host, port: config.port, user: config.user, password: config.password,
                ...(database ? { database } : {}), connectTimeout: 5000,
                charset: 'utf8mb4', multipleStatements: schemaImport
            });
            connections.add(connection); return connection;
        }
        // The optional native/libpq driver has a different ambient configuration
        // contract. Refuse it before issuing SQL rather than inheriting that contract.
        if (process.env.NODE_PG_FORCE_NATIVE) fail('LIVE_DATABASE_SETUP_FAILED');
        const client = new (require('pg').Client)({ host: config.host, port: config.port, user: config.user,
            password: () => config.password, database: database || config.adminDatabase,
            ssl: false, sslnegotiation: 'postgres', application_name: 'apiforge-live-v1', client_encoding: 'UTF8',
            options: '-c statement_timeout=10000', replication: 'false', binary: false, connectionTimeoutMillis: 5000,
            query_timeout: 10000, statement_timeout: 10000 });
        client.on('error', () => {}); // Raw driver errors never become unhandled public output.
        connections.add(client); await client.connect(); return client;
    }
    async function close(connection) { await connection.end(); connections.delete(connection); }
    return { name,
        async setup(schema) {
            if (setupStarted) fail('LIVE_DATABASE_SETUP_FAILED');
            setupStarted = true;
            const sql = target === 'mysql'
                ? 'CREATE DATABASE ' + quote() + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
                : 'CREATE DATABASE ' + quote() + " TEMPLATE template0 ENCODING 'UTF8'";
            const admin = await connect();
            creation = 'uncertain';
            try { await admin.query(sql); creation = 'owned'; }
            catch (error) {
                if (error.code === (target === 'mysql' ? 'ER_DB_CREATE_EXISTS' : '42P04')) creation = 'refused';
                throw error;
            }
            await close(admin);
            // Only trusted compiler schema reaches this adapter. MySQL multi-statements are scoped to this import connection.
            const importer = await connect(name, true);
            await importer.query(schema);
            await close(importer);
        },
        async close() {
            const results = await Promise.allSettled([...connections].map(close));
            if (results.some(result => result.status === 'rejected')) fail('LIVE_CLEANUP_FAILED');
        },
        async drop() {
            if (creation === 'uncertain') fail('LIVE_CLEANUP_FAILED');
            if (creation !== 'owned') return;
            if (connections.size) fail('LIVE_CLEANUP_FAILED');
            const admin = await connect();
            try {
                await admin.query(target === 'mysql' ? 'DROP DATABASE IF EXISTS ' + quote()
                    : 'DROP DATABASE IF EXISTS ' + quote() + ' WITH (FORCE)');
                creation = 'removed';
            } finally { await close(admin); }
        }
    };
}
module.exports = { configuration, databaseResource, NAME_PATTERN };
