'use strict';
// Explicit local storage lifecycle only; no compiler, HTTP or generated targets.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const bootstrap = require('../windows-bootstrap');
const { ProjectStoreError, fail, sanitized } = require('./errors');
const { validateRuntime, BUSY_TIMEOUT_MS } = require('./runtime');
const { APPLICATION_ID, SCHEMA_VERSION, FORMAT_VERSION, definitions } = require('./schema');
const DATABASE = 'projects.sqlite3';
const MAX_SOURCE_BYTES = 1048576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest();
function fields(input, allowed, required) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).some(key => !allowed.includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value')) ||
        required.some(key => !Object.hasOwn(input, key))) fail('PROJECT_INVALID_INPUT');
}
function validId(id) { if (typeof id !== 'string' || !UUID.test(id)) fail('PROJECT_INVALID_ID'); }
function validRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1) fail('PROJECT_INVALID_REVISION');
}
function validName(name) {
    if (typeof name !== 'string' || !name.isWellFormed() || !name.trim() || name.length > 256 ||
        Array.from(name).length > 128 || Buffer.byteLength(name, 'utf8') > 512 ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) fail('PROJECT_INVALID_NAME');
    return name; // Preserve even intentional leading/trailing spaces.
}
function validTarget(target) {
    if (target !== 'mysql' && target !== 'postgres') fail('PROJECT_INVALID_TARGET');
    return target;
}
function sourceBytes(source) {
    if (typeof source === 'string') {
        if (!source.isWellFormed() || Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) fail('PROJECT_INVALID_SOURCE');
        return Buffer.from(source, 'utf8');
    }
    if (!Buffer.isBuffer(source) || source.length > MAX_SOURCE_BYTES) fail('PROJECT_INVALID_SOURCE');
    try { decoder.decode(source); } catch { fail('PROJECT_INVALID_SOURCE'); }
    return Buffer.from(source);
}
function validTimestamp(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function sameFile(a, b) { return a && b && a.device === b.device && a.file === b.file && a.birth === b.birth; }
function sameStore(a, b) {
    return a.root === b.root && a.storeId === b.storeId && a.ownerSid === b.ownerSid && sameFile(a.sqlite.main, b.sqlite.main);
}
async function admission(identity) {
    const observed = await bootstrap.openPrivateStoreRoot({ root: identity.root });
    if (!observed.sqlite.main) fail('PROJECT_STORE_MISSING');
    if (!sameStore(identity, observed)) fail('PROJECT_STORE_IDENTITY_MISMATCH');
    // Journal identity/presence may legitimately change under SQLite's locks.
    return observed;
}
async function header(file, recoveryPossible = false) {
    let handle;
    try {
        handle = await fsp.open(file, 'r');
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) fail('PROJECT_STORE_CORRUPT');
        if (stat.size < 100n) { if (recoveryPossible) return; fail('PROJECT_STORE_CORRUPT'); }
        const bytes = Buffer.alloc(100);
        if ((await handle.read(bytes, 0, 100, 0)).bytesRead !== 100 ||
            bytes.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') {
            if (recoveryPossible) return;
            fail('PROJECT_STORE_CORRUPT');
        }
        if (bytes[18] !== 1 || bytes[19] !== 1) fail('PROJECT_STORE_INCOMPATIBLE');
    } finally { if (handle) await handle.close(); }
}
async function journalHeader(identity) {
    if (!identity.sqlite.journal) return false;
    let handle;
    try {
        handle = await fsp.open(path.join(identity.root, 'projects.sqlite3-journal'), 'r');
        const stat = await handle.stat({ bigint: true });
        const bytes = Buffer.alloc(28);
        if (stat.size < 512n || (await handle.read(bytes, 0, 28, 0)).bytesRead !== 28) fail('PROJECT_STORE_RECOVERY_REQUIRED');
        const magic = bytes.subarray(0, 8).toString('hex');
        const sector = bytes.readUInt32BE(20), page = bytes.readUInt32BE(24);
        const powerOfTwo = value => value >= 512 && value <= 65536 && (value & (value - 1)) === 0;
        if (!['d9d505f920a163d7', '0000000000000000'].includes(magic) || !powerOfTwo(sector) ||
            !powerOfTwo(page) || stat.size < BigInt(sector)) fail('PROJECT_STORE_RECOVERY_REQUIRED');
        // This only recognizes the rollback-journal envelope. SQLite alone
        // decides hotness, validates recovery records and performs recovery.
        return magic === 'd9d505f920a163d7';
    } catch (error) {
        if (error.code !== 'ENOENT') throw error; // A cooperating commit can remove it.
    } finally { if (handle) await handle.close(); }
}
function connect(sqlite, file) {
    const uri = pathToFileURL(file);
    uri.searchParams.set('mode', 'rw');
    return new sqlite.DatabaseSync(uri.href, {
        readOnly: false, timeout: BUSY_TIMEOUT_MS, defensive: true, allowExtension: false,
        enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false
    });
}
function configure(db, sqlite) {
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('PROJECT_STORE_INCOMPATIBLE');
    db.exec('PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;');
    db.enableLoadExtension(false);
    db.enableDefensive(true);
    const expected = { synchronous: 3, foreign_keys: 1, trusted_schema: 0, busy_timeout: BUSY_TIMEOUT_MS, temp_store: 2 };
    for (const [pragma, value] of Object.entries(expected)) {
        // Only application-owned constant identifiers are interpolated here.
        if (Object.values(db.prepare('PRAGMA ' + pragma).get())[0] !== value) fail('PROJECT_STORE_RUNTIME_UNSUPPORTED');
    }
    db.setAuthorizer((action, arg1, arg2) => {
        if (action === sqlite.constants.SQLITE_ATTACH || action === sqlite.constants.SQLITE_DETACH ||
            (action === sqlite.constants.SQLITE_FUNCTION && arg2 === 'load_extension') ||
            (action === sqlite.constants.SQLITE_PRAGMA && ['writable_schema', 'journal_mode', 'synchronous', 'foreign_keys', 'trusted_schema', 'busy_timeout', 'temp_store'].includes(arg1) && arg2 !== null)) return sqlite.constants.SQLITE_DENY;
        return sqlite.constants.SQLITE_OK;
    });
}
function transaction(db, action, write = true) {
    let committing = false;
    try {
        db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
        const result = action();
        if (!write) { db.exec('ROLLBACK'); return result; }
        committing = true;
        db.exec('COMMIT');
        return result;
    } catch (error) {
        const uncertain = write && committing && !db.isTransaction;
        if (db.isTransaction) {
            try { db.exec('ROLLBACK'); }
            catch { try { db.close(); } catch {} fail('PROJECT_STORE_RECOVERY_REQUIRED'); }
        }
        if (uncertain) fail('PROJECT_COMMIT_UNCERTAIN');
        throw sanitized(error);
    }
}
function verifySchema(db, identity) {
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        db.prepare('PRAGMA user_version').get().user_version !== SCHEMA_VERSION) fail('PROJECT_STORE_INCOMPATIBLE');
    const lengths = db.prepare("SELECT type,CASE WHEN length(CAST(name AS BLOB))<=128 THEN name END AS name,length(CAST(sql AS BLOB)) AS bytes FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name");
    let count = 0;
    for (const row of lengths.iterate()) {
        if (++count > Object.keys(definitions).length || !Object.hasOwn(definitions, row.name) ||
            row.bytes < 1 || row.bytes > 8192 || row.type !== (row.name.startsWith('store_') || ['projects', 'project_revisions'].includes(row.name) ? 'table' : 'trigger')) fail('PROJECT_STORE_INCOMPATIBLE');
        if (db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(row.name).sql !== definitions[row.name]) fail('PROJECT_STORE_INCOMPATIBLE');
    }
    if (count !== Object.keys(definitions).length) fail('PROJECT_STORE_INCOMPATIBLE');
    const indexes = [];
    for (const row of db.prepare('SELECT CASE WHEN length(CAST(name AS BLOB))<=128 THEN name END AS name,type,CASE WHEN length(CAST(tbl_name AS BLOB))<=128 THEN tbl_name END AS tbl_name FROM sqlite_schema WHERE sql IS NULL ORDER BY name').iterate()) {
        if (indexes.length === 2) fail('PROJECT_STORE_INCOMPATIBLE');
        indexes.push([row.name, row.type, row.tbl_name]);
    }
    if (JSON.stringify(indexes) !== JSON.stringify([
        ['sqlite_autoindex_project_revisions_1', 'index', 'project_revisions'], ['sqlite_autoindex_projects_1', 'index', 'projects']
    ])) fail('PROJECT_STORE_INCOMPATIBLE');
    const metaLengths = db.prepare('SELECT length(CAST(store_id AS BLOB)) AS id_bytes,length(CAST(created_at AS BLOB)) AS time_bytes FROM store_meta').iterate();
    let metaCount = 0;
    for (const row of metaLengths) { if (++metaCount > 1 || row.id_bytes !== 36 || row.time_bytes !== 24) fail('PROJECT_STORE_CORRUPT'); }
    if (metaCount !== 1) fail('PROJECT_STORE_CORRUPT');
    const meta = db.prepare('SELECT * FROM store_meta').get();
    if (meta.singleton !== 1 || meta.schema_version !== SCHEMA_VERSION || meta.format_version !== FORMAT_VERSION) fail('PROJECT_STORE_INCOMPATIBLE');
    if (meta.store_id !== identity.storeId) fail('PROJECT_STORE_IDENTITY_MISMATCH');
    if (!validTimestamp(meta.created_at)) fail('PROJECT_STORE_CORRUPT');
    return meta;
}
const currentLengths = `SELECT typeof(source) AS source_type,length(source) AS source_bytes,
typeof(source_hash) AS hash_type,length(source_hash) AS hash_bytes,
length(CAST(name AS BLOB)) AS name_bytes,length(CAST(target AS BLOB)) AS target_bytes,
length(CAST(id AS BLOB)) AS id_bytes,length(CAST(created_at AS BLOB)) AS created_bytes,
length(CAST(updated_at AS BLOB)) AS updated_bytes FROM projects WHERE id=?`;
const revisionLengths = `SELECT typeof(source) AS source_type,length(source) AS source_bytes,
typeof(source_hash) AS hash_type,length(source_hash) AS hash_bytes,
length(CAST(name AS BLOB)) AS name_bytes,length(CAST(target AS BLOB)) AS target_bytes,
length(CAST(project_id AS BLOB)) AS id_bytes,length(CAST(saved_at AS BLOB)) AS updated_bytes
FROM project_revisions WHERE project_id=? AND revision=?`;
function checkLengths(row) {
    if (row.source_type !== 'blob' || !Number.isSafeInteger(row.source_bytes) || row.source_bytes < 0 || row.source_bytes > MAX_SOURCE_BYTES ||
        row.hash_type !== 'blob' || row.hash_bytes !== 32 || row.name_bytes < 1 || row.name_bytes > 512 ||
        row.target_bytes < 5 || row.target_bytes > 8 || row.id_bytes !== 36 ||
        (Object.hasOwn(row, 'created_bytes') && row.created_bytes !== 24) || row.updated_bytes !== 24) fail('PROJECT_STORE_CORRUPT');
}
function readRecord(db, id, revision) {
    const historical = revision !== undefined;
    const parameters = historical ? [id, revision] : [id];
    const lengths = db.prepare(historical ? revisionLengths : currentLengths).get(...parameters);
    if (!lengths) fail('PROJECT_NOT_FOUND');
    checkLengths(lengths);
    const row = db.prepare(historical ? 'SELECT * FROM project_revisions WHERE project_id=? AND revision=?' : 'SELECT * FROM projects WHERE id=?').get(...parameters);
    try {
        validId(historical ? row.project_id : row.id); validRevision(row.revision); validName(row.name); validTarget(row.target);
        const timestamp = historical ? row.saved_at : row.updated_at;
        if (!validTimestamp(timestamp) || (!historical && (!validTimestamp(row.created_at) || row.created_at > timestamp))) throw new Error();
        const bytes = Buffer.from(row.source);
        if (!hash(bytes).equals(Buffer.from(row.source_hash))) throw new Error();
        const record = { id, name: row.name, target: row.target, revision: row.revision,
            source: decoder.decode(bytes), sourceHash: Buffer.from(row.source_hash).toString('hex') };
        return historical ? { ...record, savedAt: timestamp } : { ...record, createdAt: row.created_at, updatedAt: timestamp };
    } catch { fail('PROJECT_STORE_CORRUPT'); }
}
function verifyContent(db, identity) {
    return transaction(db, () => {
        const meta = verifySchema(db, identity);
        if (db.prepare('PRAGMA integrity_check(1)').get().integrity_check !== 'ok' ||
            db.prepare('PRAGMA foreign_key_check').get() !== undefined) fail('PROJECT_STORE_CORRUPT');
        for (const row of db.prepare('SELECT CASE WHEN length(CAST(id AS BLOB))=36 THEN id END AS id,length(CAST(id AS BLOB)) AS bytes FROM projects').iterate()) {
            if (row.bytes !== 36) fail('PROJECT_STORE_CORRUPT');
            const current = readRecord(db, row.id);
            const sequence = db.prepare('SELECT count(*) AS count,min(revision) AS first,max(revision) AS last FROM project_revisions WHERE project_id=?').get(row.id);
            if (sequence.count !== current.revision || sequence.first !== 1 || sequence.last !== current.revision || current.createdAt < meta.created_at) fail('PROJECT_STORE_CORRUPT');
            let previous = current.createdAt;
            for (const item of db.prepare('SELECT revision FROM project_revisions WHERE project_id=? ORDER BY revision').iterate(row.id)) {
                const snapshot = readRecord(db, row.id, item.revision);
                if (snapshot.savedAt < previous || (item.revision === 1 && snapshot.savedAt !== current.createdAt)) fail('PROJECT_STORE_CORRUPT');
                previous = snapshot.savedAt;
                if (item.revision === current.revision && ['name', 'target', 'source', 'sourceHash'].some(key => snapshot[key] !== current[key])) fail('PROJECT_STORE_CORRUPT');
            }
            if (previous !== current.updatedAt) fail('PROJECT_STORE_CORRUPT');
        }
        return meta;
    }, false);
}
function storeObject(db, identity, meta) {
    let closed = false;
    async function operation(action, write = false) {
        try {
            if (closed || !db.isOpen) fail('PROJECT_STORE_CLOSED');
            const observed = await admission(identity);
            const recoveryPossible = await journalHeader(observed);
            await header(path.join(identity.root, DATABASE), recoveryPossible);
            // close() may have run while Windows admission was pending.
            if (closed || !db.isOpen) fail('PROJECT_STORE_CLOSED');
            if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('PROJECT_STORE_INCOMPATIBLE');
            return transaction(db, action, write);
        } catch (error) { throw sanitized(error); }
    }
    const insertRevision = (id, revision, name, target, bytes, digest, timestamp) =>
        db.prepare('INSERT INTO project_revisions(project_id,revision,name,target,source,source_hash,saved_at) VALUES (?,?,?,?,?,?,?)').run(id, revision, name, target, bytes, digest, timestamp);
    return Object.freeze({
        storeId: identity.storeId,
        async createProject(input) {
            try {
                fields(input, ['name', 'target', 'source'], ['name', 'target', 'source']);
                const name = validName(input.name), target = validTarget(input.target), bytes = sourceBytes(input.source), digest = hash(bytes);
                return await operation(() => {
                    const id = crypto.randomUUID(), timestamp = new Date(Math.max(Date.now(), Date.parse(meta.created_at))).toISOString();
                    insertRevision(id, 1, name, target, bytes, digest, timestamp);
                    db.prepare('INSERT INTO projects(id,revision,name,target,source,source_hash,created_at,updated_at) VALUES (?,1,?,?,?,?,?,?)').run(id, name, target, bytes, digest, timestamp, timestamp);
                    return readRecord(db, id);
                }, true);
            } catch (error) { throw sanitized(error); }
        },
        async listProjects() {
            return operation(() => {
                const result = [];
                // Bounds and metadata only: never select the DSL source BLOB.
                for (const row of db.prepare('SELECT CASE WHEN length(CAST(id AS BLOB))=36 THEN id END AS id FROM projects ORDER BY id').iterate()) {
                    if (row.id === null) fail('PROJECT_STORE_CORRUPT');
                    const lengths = db.prepare(currentLengths).get(row.id); checkLengths(lengths);
                    const value = db.prepare('SELECT id,name,target,revision,hex(source_hash) AS sourceHash,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE id=?').get(row.id);
                    try { validId(value.id); validName(value.name); validTarget(value.target); validRevision(value.revision);
                        if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt) || value.createdAt > value.updatedAt) throw new Error();
                    } catch { fail('PROJECT_STORE_CORRUPT'); }
                    value.sourceHash = value.sourceHash.toLowerCase(); result.push({ ...value });
                }
                return result;
            });
        },
        async getProject(id) {
            try { validId(id); return await operation(() => readRecord(db, id)); }
            catch (error) { throw sanitized(error); }
        },
        async getProjectRevision(id, revision) {
            try { validId(id); validRevision(revision); return await operation(() => readRecord(db, id, revision)); }
            catch (error) { throw sanitized(error); }
        },
        async saveProject(id, expectedRevision, changes) {
            try {
                validId(id); validRevision(expectedRevision);
                fields(changes, ['name', 'target', 'source'], []);
                if (Reflect.ownKeys(changes).length === 0) fail('PROJECT_INVALID_INPUT');
                const updates = {};
                if (Object.hasOwn(changes, 'name')) updates.name = validName(changes.name);
                if (Object.hasOwn(changes, 'target')) updates.target = validTarget(changes.target);
                if (Object.hasOwn(changes, 'source')) updates.bytes = sourceBytes(changes.source);
                return await operation(() => {
                    const old = readRecord(db, id);
                    if (old.revision !== expectedRevision) fail('PROJECT_REVISION_CONFLICT');
                    if (old.revision === Number.MAX_SAFE_INTEGER) fail('PROJECT_REVISION_LIMIT');
                    const revision = old.revision + 1, name = updates.name ?? old.name, target = updates.target ?? old.target;
                    const bytes = updates.bytes ?? Buffer.from(old.source, 'utf8'), digest = hash(bytes);
                    const timestamp = new Date(Math.max(Date.now(), Date.parse(old.updatedAt))).toISOString();
                    insertRevision(id, revision, name, target, bytes, digest, timestamp);
                    const changed = db.prepare('UPDATE projects SET revision=?,name=?,target=?,source=?,source_hash=?,updated_at=? WHERE id=? AND revision=?').run(revision, name, target, bytes, digest, timestamp, id, expectedRevision);
                    if (changed.changes !== 1) fail('PROJECT_REVISION_CONFLICT');
                    return readRecord(db, id);
                }, true);
            } catch (error) { throw sanitized(error); }
        },
        close() {
            if (closed) return;
            closed = true;
            try { db.close(); } catch (error) { throw sanitized(error); }
        }
    });
}
async function initializeProjectStore(options) {
    let db;
    try {
        const sqlite = validateRuntime();
        const fresh = await bootstrap.initializePrivateStoreRoot(options);
        if (fresh.sqlite.main || fresh.sqlite.journal || fresh.sqlite.contentValidated !== false) fail('PROJECT_STORE_RECOVERY_REQUIRED');
        const observed = await bootstrap.openPrivateStoreRoot({ root: fresh.root });
        if (observed.storeId !== fresh.storeId || observed.sqlite.main || observed.sqlite.journal) fail('PROJECT_STORE_RECOVERY_REQUIRED');
        // Exclusive creation is limited to this freshly authenticated lifecycle.
        // This is the main database reservation, never an application lock file.
        const reservation = await fsp.open(path.join(fresh.root, DATABASE), 'wx', 0o600);
        await reservation.close();
        const identity = await bootstrap.openPrivateStoreRoot({ root: fresh.root });
        if (identity.storeId !== fresh.storeId || identity.ownerSid !== fresh.ownerSid || !identity.sqlite.main ||
            identity.sqlite.journal || identity.sqlite.contentValidated !== false) fail('PROJECT_STORE_IDENTITY_MISMATCH');
        db = connect(sqlite, path.join(identity.root, DATABASE));
        configure(db, sqlite);
        transaction(db, () => {
            for (const sql of Object.values(definitions)) db.exec(sql);
            db.exec('PRAGMA application_id=' + APPLICATION_ID + '; PRAGMA user_version=' + SCHEMA_VERSION + ';');
            db.prepare('INSERT INTO store_meta VALUES (1,?,?,?,?)').run(SCHEMA_VERSION, FORMAT_VERSION, identity.storeId, new Date().toISOString());
        });
        await header(path.join(identity.root, DATABASE));
        const meta = verifyContent(db, identity);
        await admission(identity);
        return storeObject(db, identity, meta);
    } catch (error) { if (db) { try { db.close(); } catch {} } throw sanitized(error); }
}
async function openProjectStore(options) {
    let db;
    try {
        const sqlite = validateRuntime();
        const identity = await bootstrap.openPrivateStoreRoot(options);
        if (!identity.sqlite.main) fail('PROJECT_STORE_MISSING');
        const current = await admission(identity);
        const recoveryPossible = await journalHeader(current);
        await header(path.join(identity.root, DATABASE), recoveryPossible);
        db = connect(sqlite, path.join(identity.root, DATABASE));
        configure(db, sqlite); // SQLite performs its own hot-journal recovery.
        const meta = verifyContent(db, identity);
        await header(path.join(identity.root, DATABASE));
        await admission(identity);
        return storeObject(db, identity, meta);
    } catch (error) { if (db) { try { db.close(); } catch {} } throw sanitized(error); }
}
module.exports = { initializeProjectStore, openProjectStore, ProjectStoreError };
