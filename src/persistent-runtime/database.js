'use strict';
// Deliberately no disposable Live database import and no deletion capability.
const crypto = require('node:crypto');
const { fail, safe } = require('./errors');
const { NAME, HEX, verify } = require('./provenance');
const TABLE = '__apiforge_runtime_v1';
const QUERY_MS = 8000;
function configuration(target, env) {
    if (!['mysql', 'postgres'].includes(target)) fail('PERSISTENT_REQUEST_INVALID');
    const prefix = target === 'mysql' ? 'APIFORGE_PERSISTENT_MYSQL_' : 'APIFORGE_PERSISTENT_PG_';
    if (['HOST', 'PORT', 'USER', 'PASSWORD'].some(key => typeof env[prefix + key] !== 'string') ||
        !['127.0.0.1', '::1'].includes(env[prefix + 'HOST']) || !env[prefix + 'USER'] ||
        !/^[1-9][0-9]{0,4}$/.test(env[prefix + 'PORT']) || Number(env[prefix + 'PORT']) > 65535) {
        fail('PERSISTENT_CONFIGURATION_UNAVAILABLE');
    }
    const adminDatabase = env.APIFORGE_PERSISTENT_PG_ADMIN_DB || 'postgres';
    if (target === 'postgres' && !/^[A-Za-z0-9_-]{1,63}$/.test(adminDatabase)) fail('PERSISTENT_CONFIGURATION_UNAVAILABLE');
    return { host: env[prefix + 'HOST'], port: Number(env[prefix + 'PORT']), user: env[prefix + 'USER'],
        password: env[prefix + 'PASSWORD'], ...(target === 'postgres' ? { adminDatabase } : {}) };
}
function postgresClient(config, database) {
    // pg's string password configuration treats an empty string as falsy and
    // falls back to PGPASSWORD. Its documented password callback avoids that.
    return new (require('pg').Client)({ host: config.host, port: config.port, user: config.user,
        password: () => config.password, database: database || config.adminDatabase, ssl: false,
        sslnegotiation: 'postgres', application_name: 'apiforge-persistent-v1', client_encoding: 'UTF8',
        options: '-c statement_timeout=8000', replication: 'false', binary: false,
        connectionTimeoutMillis: 5000, query_timeout: QUERY_MS, statement_timeout: QUERY_MS, lock_timeout: 2000 });
}
function resource(identity, config, { connector } = {}) {
    if (!NAME.test(identity.name)) fail('PERSISTENT_REQUEST_INVALID');
    const mysql = identity.target === 'mysql';
    const quote = name => mysql ? '`' + name + '`' : '"' + name + '"';
    const table = mysql ? quote(TABLE) : '"public".' + quote(TABLE);
    let establishedDeploymentId;
    async function open(database, importing = false) {
        if (connector) return connector(database, importing);
        if (mysql) return require('mysql2/promise').createConnection({ ...config,
            ...(database ? { database } : {}), charset: 'utf8mb4', connectTimeout: 5000, multipleStatements: importing });
        const client = postgresClient(config, database);
        client.on('error', () => {}); // Fixed public errors, never an unhandled raw driver exception.
        try { await client.connect(); return client; }
        catch (error) { client.connection.stream.destroy(); throw error; }
    }
    function destroy(connection) {
        try {
            if (mysql) connection.destroy();
            else connection.connection?.stream?.destroy(); // Owned pg 8 connection, never an arbitrary socket.
        } catch { /* The failed operation remains refused; never replay SQL. */ }
    }
    async function close(connection) {
        let timer;
        try {
            await Promise.race([connection.end(), new Promise((resolve, reject) => {
                timer = setTimeout(() => { destroy(connection); reject(new Error()); }, 2000);
            })]);
        } finally { clearTimeout(timer); }
    }
    async function withConnection(database, action, importing = false, missingAllowed = false) {
        let connection;
        try {
            connection = await open(database, importing);
            const query = async (text, values) => {
                let index = 0;
                const sql = !mysql && values ? text.replace(/\?/g, () => '$' + ++index) : text;
                const result = mysql ? await connection.query({ sql, timeout: QUERY_MS }, values)
                    : await connection.query(sql, values);
                return mysql ? { rows: Array.isArray(result[0]) ? result[0] : [], count: result[0]?.affectedRows }
                    : { rows: result.rows, count: result.rowCount };
            };
            const value = await action(query);
            await close(connection); connection = null;
            return value;
        } catch (error) {
            if (mysql && missingAllowed && !connection && error.code === 'ER_BAD_DB_ERROR') return false;
            throw safe(error);
        }
        finally {
            if (connection) {
                // mysql timeout does not imply SQL rollback; destruction never authorizes replay.
                destroy(connection);
            }
        }
    }
    async function profile(query) {
        if (mysql) {
            const { rows: [p] } = await query('SELECT VERSION() AS version, @@autocommit AS autocommit, @@default_storage_engine AS engine, @@innodb_flush_log_at_trx_commit AS durable, @@sql_mode AS mode, @@innodb_page_size AS page_size, @@innodb_default_row_format AS row_format');
            if (!/^8\.4\./.test(p?.version) || p.autocommit !== 1 || p.engine !== 'InnoDB' || p.durable !== 1 ||
                p.page_size !== 16384 || p.row_format?.toLowerCase() !== 'dynamic' || typeof p.mode !== 'string' ||
                !/(?:^|,)(?:STRICT_TRANS_TABLES|STRICT_ALL_TABLES)(?:,|$)/.test(p.mode) || p.mode.split(',').includes('NO_BACKSLASH_ESCAPES')) fail('PERSISTENT_PROFILE_UNSUPPORTED');
        } else {
            const { rows: [p] } = await query("SELECT current_setting('server_version_num') AS version, current_setting('server_encoding') AS encoding, current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS durable");
            if (Math.floor(Number(p?.version) / 10000) !== 18 || p.encoding !== 'UTF8' || p.fsync !== 'on' || p.durable !== 'on') fail('PERSISTENT_PROFILE_UNSUPPORTED');
        }
    }
    async function exists() {
        if (mysql) {
            await withConnection(undefined, profile);
            // MySQL catalogs hide inaccessible schemas. A hidden row cannot
            // establish absence; only a direct unknown-database refusal may.
            return withConnection(identity.name, async query => { await profile(query); return true; }, false, true);
        }
        return withConnection(undefined, async query => {
            await profile(query);
            const result = await query('SELECT datname FROM pg_database WHERE datname = ?', [identity.name]);
            return result.rows.length === 1;
        });
    }
    async function read(query) {
        if (mysql) {
            const result = await query('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [identity.name, TABLE]);
            if (result.rows.length !== 1 || result.rows[0].ENGINE !== 'InnoDB') fail('PERSISTENT_DATABASE_COLLISION');
        } else {
            const result = await query("SELECT relkind, relpersistence FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=?", [TABLE]);
            if (result.rows.length !== 1 || result.rows[0].relkind !== 'r' || result.rows[0].relpersistence !== 'p') fail('PERSISTENT_DATABASE_COLLISION');
        }
        // Bound unknown colliding metadata in SQL before the driver allocates it.
        const integer = mysql ? 'SIGNED' : 'INTEGER';
        const result = await query('SELECT CAST(singleton AS ' + integer + ') AS singleton, CAST(format AS ' + integer + ') AS format, '
            + 'CASE WHEN OCTET_LENGTH(provenance)<=1024 THEN provenance END AS provenance, '
            + 'CASE WHEN OCTET_LENGTH(deployment_id)=64 THEN deployment_id END AS deployment_id, '
            + 'CASE WHEN OCTET_LENGTH(state)<=12 THEN state END AS state, '
            + 'CASE WHEN runtime_owner IS NULL OR OCTET_LENGTH(runtime_owner)=64 THEN runtime_owner ELSE \'invalid\' END AS runtime_owner FROM '
            + table + ' LIMIT 2');
        if (result.rows.length !== 1 || result.rows[0].singleton !== 1) fail('PERSISTENT_DATABASE_COLLISION');
        const record = verify(result.rows[0], identity);
        if (establishedDeploymentId && establishedDeploymentId !== record.deployment_id) fail('PERSISTENT_OWNERSHIP_LOST');
        establishedDeploymentId = record.deployment_id;
        return record;
    }
    async function inspect() {
        if (!await exists()) return null;
        return withConnection(identity.name, async query => { await profile(query); return read(query); });
    }
    async function initialize() {
        if (await exists()) {
            const current = await inspect();
            fail(current?.state === 'ready' ? 'PERSISTENT_ALREADY_INITIALIZED' : 'PERSISTENT_INCOMPLETE');
        }
        // From the first DDL attempt, every failure is potentially committed.
        try {
            await withConnection(undefined, async query => {
                await profile(query);
                await query(mysql ? 'CREATE DATABASE ' + quote(identity.name) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
                    : 'CREATE DATABASE ' + quote(identity.name) + " TEMPLATE template0 ENCODING 'UTF8'");
            });
            await withConnection(identity.name, async query => {
                await profile(query);
                await query('CREATE TABLE ' + table + '(singleton INTEGER PRIMARY KEY CHECK(singleton=1), format INTEGER NOT NULL CHECK(format=1), '
                    + (mysql ? 'provenance VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, deployment_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, '
                        : 'provenance VARCHAR(1024) COLLATE "C" NOT NULL, deployment_id VARCHAR(64) COLLATE "C" NOT NULL, ')
                    + "state VARCHAR(12) NOT NULL CHECK(state IN ('provisioning','ready')), runtime_owner "
                    + (mysql ? 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin' : 'VARCHAR(64) COLLATE "C"') + ')'
                    + (mysql ? ' ENGINE=InnoDB' : ''));
                await query('INSERT INTO ' + table + "(singleton,format,provenance,deployment_id,state,runtime_owner) VALUES(1,1,?,?,'provisioning',NULL)",
                    [identity.text, crypto.randomBytes(32).toString('hex')]);
            });
            await withConnection(identity.name, async query => { await profile(query); await query(identity.schema); }, true);
            await withConnection(identity.name, async query => {
                await profile(query); const current = await read(query);
                if (current.state !== 'provisioning' || current.runtime_owner !== null) fail('PERSISTENT_INCOMPLETE');
                const result = await query('UPDATE ' + table + " SET state='ready' WHERE singleton=1 AND state='provisioning' AND provenance=? AND runtime_owner IS NULL", [identity.text]);
                if (result.count !== 1) fail('PERSISTENT_INCOMPLETE');
            });
            const record = await inspect();
            if (record?.state !== 'ready' || record.runtime_owner !== null) fail('PERSISTENT_INCOMPLETE');
            return record;
        } catch { fail('PERSISTENT_PROVISION_UNCERTAIN'); }
    }
    async function ownership(owner, releasing = false) {
        if (!HEX.test(owner)) fail('PERSISTENT_REQUEST_INVALID');
        if (!await exists()) fail('PERSISTENT_DATABASE_MISSING');
        let attempted = false;
        try { return await withConnection(identity.name, async query => {
            await profile(query); const current = await read(query);
            if (current.state !== 'ready') fail('PERSISTENT_INCOMPLETE');
            if (releasing ? current.runtime_owner !== owner : current.runtime_owner !== null) fail(releasing ? 'PERSISTENT_OWNERSHIP_LOST' : 'PERSISTENT_BUSY');
            let result;
            try {
                attempted = true;
                result = await query('UPDATE ' + table + (releasing ? ' SET runtime_owner=NULL' : ' SET runtime_owner=?')
                    + " WHERE singleton=1 AND state='ready' AND provenance=? AND deployment_id=? AND "
                    + (releasing ? 'runtime_owner=?' : 'runtime_owner IS NULL'),
                    releasing ? [identity.text, current.deployment_id, owner] : [owner, identity.text, current.deployment_id]);
            } catch { fail('PERSISTENT_CLAIM_UNCERTAIN'); }
            if (result.count !== 1) fail(releasing ? 'PERSISTENT_OWNERSHIP_LOST' : 'PERSISTENT_BUSY');
        }); } catch (error) {
            if (attempted && !['PERSISTENT_BUSY', 'PERSISTENT_OWNERSHIP_LOST'].includes(error.code)) fail('PERSISTENT_CLAIM_UNCERTAIN');
            throw error;
        }
    }
    return Object.freeze({ inspect, initialize, claim: owner => ownership(owner), release: owner => ownership(owner, true),
        async verifyClaim(owner) {
            const current = await inspect();
            if (current?.state !== 'ready' || current.runtime_owner !== owner) fail('PERSISTENT_OWNERSHIP_LOST');
        } });
}
module.exports = { configuration, postgresClient, resource, TABLE, QUERY_MS };
