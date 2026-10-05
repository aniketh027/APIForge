'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./snapshot');
const { MigrationError, fail } = require('./errors');
const { planMysqlMigration } = require('./mysql-plan');
const { renderMysqlMigration } = require('./mysql-renderer');

const sequenceName = n => String(n).padStart(6, '0');
const headToken = head => head ? `${head.sequence}:${head.manifestSha256}` : null;
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function safePath(workspace, io) {
    const root = path.resolve(workspace);
    const generatedRoots = [path.resolve(__dirname, '../../..', 'output'), path.resolve(process.cwd(), 'output')];
    for (const generated of generatedRoots) {
        const relative = path.relative(generated, root);
        if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
            fail('MIGRATION_HISTORY_CORRUPT', 'Migration workspace must be separate from ordinary generated output.');
    }
    const parsed = path.parse(root);
    let current = parsed.root;
    for (const part of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (!io.existsSync(current)) continue;
        const stat = io.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(io.realpathSync(current), current))
            fail('MIGRATION_HISTORY_CORRUPT', 'Unsafe workspace ancestor, link, junction or path escape.');
    }
    return root;
}

function entry(io, file, directory = false) {
    if (!io.existsSync(file)) fail('MIGRATION_HISTORY_CORRUPT', 'Required history entry is missing.');
    const stat = io.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || !samePath(io.realpathSync(file), path.resolve(file)))
        fail('MIGRATION_HISTORY_CORRUPT', 'Unsafe history entry, link, junction or path escape.');
    return stat;
}

function readBytes(io, file) {
    entry(io, file);
    const bytes=io.readFileSync(file),text=bytes.toString('utf8');
    if(!Buffer.isBuffer(bytes)||!bytes.equals(Buffer.from(text,'utf8')))fail('MIGRATION_HISTORY_CORRUPT','History artifacts must be exact UTF-8 bytes.');
    return text;
}

function fileFacts(artifacts) {
    return Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, { sha256: S.hash(bytes), size: Buffer.byteLength(bytes, 'utf8') }]));
}

function revisionArtifacts(snapshot, n, previous, options) {
    S.validateSnapshot(snapshot);
    const sequence = sequenceName(n), toSnapshotSha256 = S.snapshotSha256(snapshot), toPhysicalSha256 = S.physicalSha256(snapshot);
    const artifacts = { 'snapshot.json': S.canonical(snapshot) };
    let plan = null, rendered = null, migrationId = null, kind = 'baseline';
    if (previous) {
        plan = planMysqlMigration(previous.snapshot, snapshot);
        rendered = renderMysqlMigration(previous.snapshot, snapshot, plan, options);
        migrationId = S.hash(plan);
        kind = rendered.sql ? 'migration' : 'metadata';
        artifacts['plan.json'] = S.canonical(plan);
        if (rendered.sql) artifacts[`${sequence}_${plan.fromSnapshotSha256.slice(0, 16)}_${plan.toSnapshotSha256.slice(0, 16)}.sql`] = rendered.sql;
    }
    const manifest = { formatVersion: 1, sequence, kind, target: snapshot.target,
        previous: previous ? { sequence: previous.sequence, manifestSha256: previous.manifestSha256 } : null,
        fromSnapshotSha256: previous ? S.snapshotSha256(previous.snapshot) : null, toSnapshotSha256,
        fromPhysicalSha256: previous ? S.physicalSha256(previous.snapshot) : null, toPhysicalSha256,
        migrationId, files: fileFacts(artifacts), authorization: rendered ? { ...rendered.authorization, requirements: rendered.requirements,
            acknowledgementMeaning: 'Operator asserts predicates were verified; APIForge did not execute prerequisite queries.' } : null };
    artifacts['manifest.json'] = S.canonical(manifest);
    return { sequence, snapshot, plan, manifest, manifestSha256: S.hash(artifacts['manifest.json']), artifacts };
}

function validateRevision(io, directory, n, previous) {
    entry(io, directory, true);
    const manifest = S.parseCanonical(readBytes(io, path.join(directory, 'manifest.json')));
    if (manifest.formatVersion !== 1) fail('MIGRATION_VERSION_UNSUPPORTED', 'Manifest formatVersion must be 1.');
    const snapshot = S.validateSnapshot(S.parseCanonical(readBytes(io, path.join(directory, 'snapshot.json'))));
    if (previous && S.snapshotSha256(previous.snapshot) === S.snapshotSha256(snapshot))
        fail('MIGRATION_HISTORY_CORRUPT', 'Byte-identical complete snapshots must not create a revision.');
    if (!manifest.files || typeof manifest.files !== 'object') fail('MIGRATION_HISTORY_CORRUPT', 'Invalid manifest inventory.');
    const names = io.readdirSync(directory).sort(S.compare);
    const listed = [...Object.keys(manifest.files), 'manifest.json'].sort(S.compare);
    if (S.canonical(names) !== S.canonical(listed) || listed.some(name => path.basename(name) !== name || /[/\\]/.test(name)))
        fail('MIGRATION_HISTORY_CORRUPT', 'Revision inventory is closed and must exactly match its manifest.');
    for (const [name, facts] of Object.entries(manifest.files)) {
        const bytes = readBytes(io, path.join(directory, name));
        if (S.canonical(facts) !== S.canonical({ sha256: S.hash(bytes), size: Buffer.byteLength(bytes, 'utf8') }))
            fail('MIGRATION_CHECKSUM_MISMATCH', 'Revision artifact checksum/size mismatch.', { sequence: sequenceName(n), file: name });
    }
    let options = {};
    if (previous) {
        if (!manifest.authorization) fail('MIGRATION_HISTORY_CORRUPT', 'Migration authorization record is missing.');
        options = { expectPlan: manifest.authorization.planSha256, allowDestructiveOperationIds: manifest.authorization.destructiveOperationIds,
            acknowledgeDataCheckOperationIds: manifest.authorization.dataCheckOperationIds };
    }
    const expected = revisionArtifacts(snapshot, n, previous, options);
    if (S.canonical(manifest) !== S.canonical(expected.manifest)) fail('MIGRATION_HISTORY_CORRUPT', 'Manifest, predecessor, snapshot or authorization mismatch.');
    for (const [name, bytes] of Object.entries(expected.artifacts))
        if (readBytes(io, path.join(directory, name)) !== bytes) fail('MIGRATION_HISTORY_CORRUPT', 'Plan or SQL does not match reconstructed policy and simulation.', { file: name });
    return expected;
}

function inventory(workspace, io, owned = {}, allowEmpty = false) {
    const root = safePath(workspace, io);
    if (!io.existsSync(root)) fail('MIGRATION_BASE_MISSING', 'Explicit baseline is required.');
    entry(io, root, true);
    const names = io.readdirSync(root);
    for (const name of names) {
        if (name === '.writer.lock') {
            entry(io, path.join(root, name));
            if (!owned.lockBytes || readBytes(io, path.join(root, name)) !== owned.lockBytes)
                fail('MIGRATION_WORKSPACE_BUSY', 'Workspace is locked. Stale or malformed locks require operator recovery.');
        } else if (name !== 'revisions' && name !== owned.stageName) fail('MIGRATION_HISTORY_CORRUPT', 'Unexpected workspace entry or unowned transient staging.');
    }
    const revisions = path.join(root, 'revisions');
    if (!io.existsSync(revisions)) {
        if (allowEmpty && names.every(name => name === '.writer.lock' || name === owned.stageName)) return { workspace: root, revisions: [], head: null, headToken: null };
        fail('MIGRATION_BASE_MISSING', 'Explicit baseline is required.');
    }
    entry(io, revisions, true);
    const sequences = io.readdirSync(revisions).sort(S.compare);
    if (sequences.some((name, n) => !/^\d{6}$/.test(name) || name !== sequenceName(n)))
        fail('MIGRATION_HISTORY_CORRUPT', 'Every revision must be a contiguous canonical six-digit sequence; malformed higher entries cannot be ignored.');
    if (!sequences.length && !allowEmpty) fail('MIGRATION_BASE_MISSING', 'Explicit baseline is required.');
    const records = [];
    for (const [n, name] of sequences.entries()) records.push(validateRevision(io, path.join(revisions, name), n, records[n - 1] || null));
    const head = records.at(-1) || null;
    return { workspace: root, revisions: records, head, headToken: headToken(head) };
}

function readMigrationWorkspace(workspace) {
    try { return inventory(workspace, fs); }
    catch (error) { if (error instanceof MigrationError) throw error; fail('MIGRATION_HISTORY_CORRUPT', 'Cannot safely read migration workspace.'); }
}

function publishMigrationRevision(workspace, snapshot, options = {}) {
    S.validateSnapshot(snapshot);
    const io = options.fileSystem || fs; // Fault-injection seam; no policy lives here.
    const root = safePath(workspace, io), lock = path.join(root, '.writer.lock');
    try{io.mkdirSync(root, { recursive: true });}catch(error){fail('MIGRATION_PUBLICATION_FAILED','Cannot initialize migration workspace.',{committed:false});}
    safePath(root, io);
    const lockBytes = S.canonical({ formatVersion: 1, nonce: crypto.randomUUID(), pid: process.pid });
    let fd;
    try { fd = io.openSync(lock, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') fail('MIGRATION_WORKSPACE_BUSY', 'Writer lock exists; no age or PID-based takeover.'); fail('MIGRATION_PUBLICATION_FAILED', 'Cannot acquire writer lock.'); }
    let stageName = null, committed = false, result, failure;
    const cleanupFailures = [];
    try {
        io.writeFileSync(fd, lockBytes, 'utf8'); io.fsyncSync(fd); io.closeSync(fd); fd = null;
        const before = inventory(root, io, { lockBytes }, options.baseline === true);
        if (options.baseline === true && before.head) fail('MIGRATION_HEAD_MISMATCH', 'Baseline over non-empty history is forbidden.');
        if (options.baseline !== true && !before.head) fail('MIGRATION_BASE_MISSING', 'Explicit baseline is required.');
        if (before.head && options.expectHead !== before.headToken) fail('MIGRATION_HEAD_MISMATCH', 'Exact validated head token is required.', { actualHead: before.headToken });
        if (before.head && S.snapshotSha256(before.head.snapshot) === S.snapshotSha256(snapshot)) {
            // Even a no-op must bind inspection/authorization to the exact plan.
            renderMysqlMigration(before.head.snapshot, snapshot, planMysqlMigration(before.head.snapshot, snapshot), options);
            result = { committed: false, noOp: true, sequence: before.head.sequence, headToken: before.headToken };
        } else {
            const n = before.revisions.length;
            if (n > 999999) fail('MIGRATION_PUBLICATION_FAILED', 'Six-digit migration sequence exhausted.');
            const revision = revisionArtifacts(snapshot, n, before.head, options);
            stageName = '.stage-' + crypto.randomUUID();
            const stage = path.join(root, stageName);
            io.mkdirSync(stage);
            for (const [name, bytes] of Object.entries(revision.artifacts)) {
                const artifactFd = io.openSync(path.join(stage, name), 'wx');
                try { io.writeFileSync(artifactFd, bytes, 'utf8'); io.fsyncSync(artifactFd); } finally { io.closeSync(artifactFd); }
            }
            validateRevision(io, stage, n, before.head);
            const after = inventory(root, io, { lockBytes, stageName }, options.baseline === true);
            if (after.headToken !== before.headToken) fail('MIGRATION_HEAD_MISMATCH', 'History changed during publication.');
            const revisions = path.join(root, 'revisions');
            if (!io.existsSync(revisions)) io.mkdirSync(revisions);
            entry(io, revisions, true);
            const destination = path.join(revisions, revision.sequence);
            if (io.existsSync(destination)) fail('MIGRATION_HEAD_MISMATCH', 'Revision destination already exists.');
            io.renameSync(stage, destination); // Commit point: only an absent immutable destination.
            committed = true; stageName = null;
            result = { committed: true, noOp: false, sequence: revision.sequence, headToken: headToken(revision), migrationId: revision.manifest.migrationId };
        }
    } catch (error) { failure = error; }
    finally {
        if (fd !== null && fd !== undefined) try { io.closeSync(fd); } catch (error) { cleanupFailures.push('lock descriptor cleanup failed'); }
        if (stageName) try { io.rmSync(path.join(root, stageName), { recursive: true, force: false }); } catch (error) { cleanupFailures.push('owned staging cleanup failed'); }
        try { if (readBytes(io, lock) !== lockBytes) throw Error('ownership changed'); io.unlinkSync(lock); }
        catch (error) { cleanupFailures.push('writer lock cleanup failed; operator recovery required'); }
    }
    if (failure) {
        if (failure instanceof MigrationError) { failure.details = { ...failure.details, committed, cleanupFailures }; throw failure; }
        fail('MIGRATION_PUBLICATION_FAILED', 'Revision publication failed before commit.', { committed, cleanupFailures });
    }
    return { ...result, cleanupFailures };
}

function emptySnapshot(profile = 'mysql-8.4-v1') {
    if (profile !== S.profile.name) fail('MIGRATION_PROFILE_UNSUPPORTED', 'Only mysql-8.4-v1 is supported.');
    return { formatVersion: 1, target: { kind: 'mysql', contractVersion: 1, physicalNamingVersion: 1, profile: S.clone(S.profile) },
        sourcePlanVersions: { effectiveFormatVersion: 1, policyVersion: 1, namingVersion: 1 }, tables: [], relations: [] };
}

module.exports = { readMigrationWorkspace, publishMigrationRevision, emptySnapshot };
