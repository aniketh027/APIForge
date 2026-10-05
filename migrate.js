#!/usr/bin/env node
'use strict';
const fs = require('fs');
const M = require('./src/migrations');
const help = `APIForge G26 offline migrations (mysql-8.4-v1)
  snapshot --to source.apiforge [--out snapshot.json] [--profile mysql-8.4-v1]
  baseline --snapshot snapshot.json --workspace path
  baseline --empty --profile mysql-8.4-v1 --workspace path
  diff (--from old.snapshot.json | --workspace path) (--to source.apiforge | --to-snapshot snapshot.json)
  create --workspace path (--to source.apiforge | --to-snapshot snapshot.json) --expect-head sequence:manifestSHA --expect-plan planSHA
         [--allow-destructive operationID] [--acknowledge-data-check operationID]
  verify --workspace path
No APPLY, DOWN, database connection or drift detection. Inspect diff before create.
`;

function run(args) {
    if (!args.length || args[0] === '--help') { process.stdout.write(help); return; }
    const command = args.shift(), options = {}, repeat = new Set(['allow-destructive', 'acknowledge-data-check']);
    const permitted = {
        snapshot: ['to', 'out', 'profile'], baseline: ['snapshot', 'empty', 'profile', 'workspace'],
        diff: ['from', 'workspace', 'to', 'to-snapshot'],
        create: ['workspace', 'to', 'to-snapshot', 'expect-head', 'expect-plan', ...repeat], verify: ['workspace']
    };
    if (!permitted[command]) throw new M.MigrationError('MIGRATION_UNSUPPORTED_TRANSITION', 'Unknown offline migration command.');
    while (args.length) {
        const flag = args.shift();
        if (!flag.startsWith('--') || !permitted[command].includes(flag.slice(2)))
            throw new M.MigrationError('MIGRATION_UNSUPPORTED_TRANSITION', 'Unknown command option: ' + flag);
        const key = flag.slice(2);
        if (Object.hasOwn(options, key) && !repeat.has(key)) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Duplicate option: ' + flag);
        const value = key === 'empty' ? true : args.shift();
        if (!value || (typeof value === 'string' && value.startsWith('--'))) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Missing option value: ' + flag);
        if (repeat.has(key)) (options[key] ||= []).push(value); else options[key] = value;
    }
    const requireOption = key => { if (!options[key]) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Required --' + key); return options[key]; };
    const readSnapshot = file => M.validateSnapshot(M.parseCanonical(fs.readFileSync(file)));
    const target = () => {
        if (Boolean(options.to) === Boolean(options['to-snapshot'])) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Choose exactly one of --to and --to-snapshot.');
        return options.to ? M.compileSourceForSnapshot(fs.readFileSync(options.to, 'utf8'), options.profile) : readSnapshot(options['to-snapshot']);
    };
    let result;
    if (command === 'snapshot') {
        requireOption('to');
        const snapshot = target();
        if (options.out) { fs.writeFileSync(options.out, M.canonical(snapshot), { encoding: 'utf8', flag: 'wx' }); result = { snapshotSha256: M.snapshotSha256(snapshot), physicalSha256: M.physicalSha256(snapshot), file: options.out }; }
        else result = snapshot;
    } else if (command === 'baseline') {
        if (Boolean(options.snapshot) === Boolean(options.empty)) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Choose exactly one of --snapshot and --empty.');
        const snapshot = options.empty ? M.emptySnapshot(requireOption('profile')) : readSnapshot(options.snapshot);
        if (options.profile && options.profile !== M.profile.name) throw new M.MigrationError('MIGRATION_PROFILE_UNSUPPORTED', 'Only mysql-8.4-v1 is supported.');
        result = M.publishMigrationRevision(requireOption('workspace'), snapshot, { baseline: true });
    } else if (command === 'verify') {
        const history = M.readMigrationWorkspace(requireOption('workspace'));
        result = { verified: true, revisions: history.revisions.length, headToken: history.headToken, snapshotSha256: history.head.manifest.toSnapshotSha256, physicalSha256: history.head.manifest.toPhysicalSha256 };
    } else {
        const next = target();
        if (command === 'diff') {
            if (Boolean(options.from) === Boolean(options.workspace)) throw new M.MigrationError('MIGRATION_HISTORY_CORRUPT', 'Choose exactly one of --from and --workspace.');
            const history = options.workspace ? M.readMigrationWorkspace(options.workspace) : null;
            const old = history ? history.head.snapshot : readSnapshot(options.from);
            const plan = M.planMysqlMigration(old, next);
            result = { headToken: history?.headToken || null, planSha256: M.hash(plan), plan };
        } else {
            result = M.publishMigrationRevision(requireOption('workspace'), next, { expectHead: requireOption('expect-head'), expectPlan: requireOption('expect-plan'),
                allowDestructiveOperationIds: options['allow-destructive'], acknowledgeDataCheckOperationIds: options['acknowledge-data-check'] });
        }
    }
    process.stdout.write(M.canonical(result));
}
if (require.main === module) {
    try { run(process.argv.slice(2)); }
    catch (error) {
        const diagnostic = error.diagnostics || (error.diagnostic ? [error.diagnostic] : undefined);
        process.stderr.write(JSON.stringify({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(diagnostic ? { diagnostics: diagnostic } : {}), ...(error.details ? { details: error.details } : {}) }) + '\n');
        process.exitCode = 1;
    }
}
module.exports = { run };
