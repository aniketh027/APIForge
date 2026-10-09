'use strict';
// Lazy runtime gate: importing the store remains safe on the compiler's Node 18.
const { fail } = require('./errors');
const BUSY_TIMEOUT_MS = 350;
function validateRuntime() {
    if (process.platform !== 'win32' || process.arch !== 'x64') fail('PROJECT_STORE_PLATFORM_UNSUPPORTED');
    let probe;
    try {
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < 24 || (major === 24 && minor < 14)) throw new Error();
        const sqlite = require('node:sqlite');
        if (typeof sqlite.DatabaseSync !== 'function' || !sqlite.constants ||
            !Number.isInteger(sqlite.constants.SQLITE_ATTACH) || !Number.isInteger(sqlite.constants.SQLITE_DENY)) throw new Error();
        let rwModeRecognized = false;
        try {
            // A URI cannot increase READONLY to READWRITE: rejection occurs in
            // SQLite's URI parser, before any filesystem open or creation.
            const impossible = new sqlite.DatabaseSync('file:apiforge-runtime-probe?mode=rw', { readOnly: true });
            impossible.close();
        } catch (error) { rwModeRecognized = error.errcode === 3; }
        if (!rwModeRecognized) throw new Error();
        // URI parsing must be active. A literal filename containing '?' cannot be
        // created on Windows if an unsupported engine treats this as a pathname.
        probe = new sqlite.DatabaseSync('file:apiforge-runtime-probe?mode=memory&cache=private', {
            timeout: BUSY_TIMEOUT_MS, defensive: true, allowExtension: false,
            enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false
        });
        for (const name of ['prepare', 'exec', 'close', 'location', 'setAuthorizer', 'enableDefensive', 'enableLoadExtension']) {
            if (typeof probe[name] !== 'function') throw new Error();
        }
        if (probe.location() !== null || probe.isTransaction !== false ||
            probe.prepare('PRAGMA journal_mode').get().journal_mode !== 'memory') throw new Error();
        probe.exec('PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF; CREATE TABLE runtime_probe(v BLOB NOT NULL) STRICT; BEGIN IMMEDIATE;');
        const statement = probe.prepare('INSERT INTO runtime_probe VALUES (?)');
        statement.run(Buffer.from([0, 239, 187, 191]));
        const bytes = probe.prepare('SELECT v FROM runtime_probe').get().v;
        if (!Buffer.from(bytes).equals(Buffer.from([0, 239, 187, 191])) || !probe.isTransaction ||
            probe.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 ||
            probe.prepare('PRAGMA synchronous').get().synchronous !== 3 ||
            probe.prepare('PRAGMA busy_timeout').get().timeout !== BUSY_TIMEOUT_MS ||
            probe.prepare('PRAGMA trusted_schema').get().trusted_schema !== 0) throw new Error();
        probe.exec('ROLLBACK');
        if (probe.isTransaction || typeof ''.isWellFormed !== 'function') throw new Error();
        return sqlite;
    } catch { fail('PROJECT_STORE_RUNTIME_UNSUPPORTED'); }
    finally { if (probe) { try { probe.close(); } catch {} } }
}
module.exports = { validateRuntime, BUSY_TIMEOUT_MS };
