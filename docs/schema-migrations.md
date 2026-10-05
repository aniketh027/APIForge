# G26 offline MySQL schema migrations

G26 generates and records one-shot migration SQL locally. It does not connect to a deployment database, apply migrations, create an applied-head table, generate DOWN SQL, or detect live drift. Immutable migration history records generated revisions; it does not prove that a database has applied them.

Before executing SQL outside APIForge, establish that the actual schema equals the previous physical snapshot, quiesce writes, verify every prerequisite, and review the complete ordered DDL. MySQL DDL can lock tables and commit implicitly. `SAFE` describes preservation of retained values and associations under these assumptions; it does not promise instant, online, inexpensive, or transactionally reversible execution.

## Certified profile

The immutable profile is `src/migrations/profiles/mysql-8.4-v1.json`. G26 V1 certification covers MySQL 8.4, tested on 8.4.11, with InnoDB, DYNAMIC rows, 16 KiB pages, `lower_case_table_names=0`, strict SQL mode, and `NO_BACKSLASH_ESCAPES` disabled. Database and inherited table defaults are `utf8mb4` / `utf8mb4_unicode_ci`. UUID columns use `ascii` / `ascii_bin`; ENUM uses `utf8mb4` / `utf8mb4_bin`.

The migration prologue sets client character handling to utf8mb4, session `time_zone='+00:00'`, and `explicit_defaults_for_timestamp=ON`. The profile records the CHECK syntax floor of 8.0.16; this is not certification for arbitrary MySQL 8.x servers. Switching profiles is deferred. Ordinary compilation retains its existing target compatibility.

## Explicit baseline and CLI

Use a workspace outside ordinary `output/`. Workspace root and revision inventories are closed: only `revisions/`, the writer's lock, and that writer's transient stage are permitted. Keep user documentation elsewhere.

```powershell
node migrate.js snapshot --to old.apiforge --out old.snapshot.json
node migrate.js baseline --snapshot old.snapshot.json --workspace .\schema-history
node migrate.js diff --workspace .\schema-history --to new.apiforge
```

Alternatively, start an intentionally empty history:

```powershell
node migrate.js baseline --empty --profile mysql-8.4-v1 --workspace .\schema-history
```

Baseline sequence `000000` contains a snapshot and manifest, with no SQL or plan. Baseline never derives state from a database, generated SQL, Git, or an earlier compilation. It refuses non-empty history. Snapshot `--out` refuses to overwrite an existing file; omit `--out` to print canonical snapshot JSON.

`diff` prints the validated head token, plan SHA-256, complete operation graph, safety facts, requirements, and blockers. An unsupported diff exits successfully because inspection succeeded. Copy the exact returned head token and plan SHA when creating the revision:

```powershell
node migrate.js create --workspace .\schema-history --to new.apiforge --expect-head "000000:<manifest-sha256>" --expect-plan "<plan-sha256>"
node migrate.js verify --workspace .\schema-history
```

Repeat `--allow-destructive <operation-id>` for each destructive operation and `--acknowledge-data-check <operation-id>` for each operation with prerequisites. There is no global destructive switch. Unknown or inapplicable IDs fail. Both permissions bind to the full exact plan SHA, and `UNSUPPORTED` cannot be authorized. Expanded operations are visible individually before authorization.

An acknowledgement means **the operator asserts that they verified the predicate**. APIForge never executes the prerequisite query. Each requirement includes its type, physical scope, and a deterministic `checkSpecification.checkSql`; success means that query returns zero rows against the previous physical schema, under the profile settings and with writes quiesced. SQL headers and manifests retain those facts and the acknowledged operation IDs prominently.

Both `diff` and `create` accept exactly one target input: `--to source.apiforge` or `--to-snapshot snapshot.json`. Standalone inspection is also supported:

```powershell
node migrate.js diff --from old.snapshot.json --to-snapshot new.snapshot.json
```

`create` requires an explicit existing baseline and exact `--expect-head` and `--expect-plan`, including for a no-op. Blocked creation publishes no revision. `verify` checks the entire local inventory and reconstructs plans, SQL and simulation; it does not inspect a live schema or rows.

## Snapshots and canonical bytes

The source path uses the existing lexer, parser, semantic analysis, IR, optimizer and complete shared codegen admission before building the MySQL Physical Snapshot from the admitted Effective Schema Plan. Production migration code never reparses `schema.sql`. `buildMysqlSnapshot` is the adapter for an already admitted plan; normal callers should use `compileSourceForSnapshot`.

Format 1 contains `formatVersion`, `target`, `sourcePlanVersions`, `tables`, and `relations`. Tables store physical IDs/names, logical references, entity/junction origin, identity intent, ordered columns, primary key, secondary indexes, CHECKs, and FKs. Columns retain semantic and effective physical defaults separately, exact physical types, character profile, nullability, generation, and type provenance. Ordered FK and index parts, junction PK order, column order, and ENUM order are significant. Relationship metadata binds storage and endpoints without copying columns.

The validator rejects unknown versions/profiles, extra record keys, malformed types/defaults/identities/references/topology, unsafe identifiers, duplicate namespaces, invalid FK support, and target capacity violations. Inherited and explicit character settings are fixed by the profile. CHECK and FK symbols have separate, case-insensitive schema namespaces; secondary indexes have a case-insensitive per-table namespace.

Canonical JSON uses UTF-8, LF, bytewise sorted object keys, and exactly one final newline. Tables, relations, indexes, CHECKs, FKs and purpose annotations have defined sorted collection order. Column, ENUM-member and key-part order is preserved. Finite JSON numbers follow JSON's representation, including normalization of negative zero. Cycles, functions, Map/Set, non-JSON prototypes, sparse/extended arrays, accessors, hidden properties, symbols, and malformed Unicode are rejected. Canonical input rejects duplicate keys, BOM/noncanonical whitespace, invalid UTF-8, or missing final LF.

`snapshotSha256` hashes the complete snapshot, including logical references, semantic defaults, identity intent and source-plan versions. `physicalSha256` hashes the observable physical projection under the fixed target envelope, excluding logical/provenance data, index purpose/implicit annotations and application-only identity intent. Effective FLOAT defaults are binary32 values; semantically different literals that store the same FLOAT share a physical fingerprint. BOOLEAN aliases and UTC TIMESTAMP default presentation are normalized deterministically.

Snapshots contain no source locations, AST/IR objects, runtime counters, timestamps or Git state. Full SHA-256 values are authoritative; shortened hashes in filenames are labels.

## Diff and safety contract

Structural diff precedes MySQL operations. It matches exact physical names and reports tables, columns, type/nullability/default/generation, PKs, indexes, CHECKs, FKs, retained-column ordering, and metadata. A physical rename produces drop plus add/create. There is no fuzzy matching, declaration-position matching or rename map.

| Change | G26 V1 result |
| --- | --- |
| Create an empty table | SAFE |
| Drop table, column, FK column or junction storage | DESTRUCTIVE |
| Add nullable column without a conflicting constraint | SAFE; new retained-row values are NULL |
| Add NOT NULL static-default column | SAFE only with valid effective defaults and statically proven constraints; otherwise prerequisites |
| Add NOT NULL without DEFAULT | REQUIRES_DATA_CHECK: TABLE_EMPTY; no invented backfill |
| Widen STRING with unchanged character semantics | SAFE subject to target capacity |
| Narrow STRING | REQUIRES_DATA_CHECK: VALUES_FIT_STRING_CAPACITY |
| Nullable to NOT NULL | REQUIRES_DATA_CHECK: NO_NULLS |
| NOT NULL to nullable | SAFE |
| Ordinary static default add/change/remove | SAFE for retained rows; future-write behavior recorded |
| Add UNIQUE over existing or non-null default-filled values | REQUIRES_DATA_CHECK: UNIQUE_VALUES |
| Add UNIQUE over newly NULL-filled storage | SAFE |
| Remove UNIQUE | SAFE, integrity warning |
| Add/tighten CHECK | REQUIRES_DATA_CHECK: VALUES_SATISFY_CHECK unless implied by previous bounds/capacity or proven effective default |
| Remove/relax CHECK | SAFE, integrity warning |
| Add FK over retained values | REQUIRES_DATA_CHECK: NO_ORPHAN_FOREIGN_KEYS |
| Add FK on newly NULL-filled generated storage | SAFE |
| Remove FK alone | SAFE, integrity warning; support index survives |
| Append ENUM with an exact old prefix and unchanged width class | SAFE |
| ENUM insertion, reordering, replacement, removal, or 255 to 256 members | UNSUPPORTED |
| Cross-type or character/generation conversion | UNSUPPORTED |
| Retained PK member/order/type/width/default/AUTO_INCREMENT change | UNSUPPORTED |
| Any cardinality or ownership conversion | UNSUPPORTED |
| Retained-column reorder | UNSUPPORTED |

Combined changes retain the strongest class and every requirement. Unique checks exclude tuples containing NULL and use the declared column collations. String capacity uses `CHAR_LENGTH`. CHECK predicates retain SQL NULL semantics; FK predicates use MATCH SIMPLE behavior and exact referenced parts. New static columns are projected through their effective literal in pre-DDL queries; unknown new non-null values require table emptiness. A new referenced table is known empty. No query inserts data or chooses an implicit zero, empty string, boolean, date, UUID, or ENUM member.

All six identity forms can be snapshotted: implicit INT, explicit generated INT, INT DEFAULT, STRING PK, runtime UUID, and UUID DEFAULT. Implicit/explicit identity can be metadata-only only when the physical column, order, PK, default and generation are identical. A relationship label change is metadata-only only when storage and endpoints remain identical. Metadata-only changes still get a plan and immutable new snapshot; no executable SQL is stored. A byte-identical complete snapshot creates no revision.

## Planning, simulation and SQL

Format-1 plans contain stable fact-derived operation IDs, explicit dependencies and execution order. Stable Kahn sorting uses version-1 operation priorities, then bytewise table ID, object ID and operation ID; it never uses locale sorting. Drops release FKs, CHECKs, names, indexes and columns before dependent removals or growth. Endpoint tables and support precede FKs/junctions. Cyclic table deletion drops all cycle FKs first. Unresolved dependency cycles raise `MIGRATION_DEPENDENCY_CYCLE`.

The MySQL model distinguishes native implicit FK indexes from explicit indexes. Adding an FK can create support; a suitable later index can silently supersede generated support; dropping a FK leaves support behind; an index still required by another FK remains. Implicitness is model metadata, not an observable physical-fingerprint attribute.

Simulation clones OLD, checks exact before-state facts and dependencies, applies only each declared mutation and modeled index side effects, validates every statement boundary, and records its fingerprint. With NEW supplied, final physical **and complete metadata** state must equal NEW. It never assigns NEW to finish simulation. Omitting a required operation fails closure.

G16 geometry is reused for 64-character identifiers, 1017 columns, 64 total/63 secondary indexes with PRIMARY, 16 key parts, 3072 key bytes, logical row budget, DYNAMIC local-record admission and its ALTER allowance. ENUM limits, internal names, defaults and AUTO_INCREMENT restrictions are validated too. A valid final snapshot can still produce `MIGRATION_INTERMEDIATE_UNREPRESENTABLE` if an intermediate ALTER cannot fit.

Rendering rechecks the plan against both snapshots, verifies exact authorizations, and runs simulation. It uses shared MySQL type, identifier and literal presentation primitives. Every MODIFY emits the complete resulting type, width, character settings, NULL/NOT NULL, default and generation definition. New columns use FIRST/AFTER to preserve target order. New tables explicitly freeze the migration profile. Native unnamed junction FK generation and automatic support names are preserved.

SQL contains a deterministic prerequisite/authorization header and ordered one-shot statements. It contains no `IF EXISTS`, `IF NOT EXISTS`, `ALTER IGNORE`, or disabled foreign-key checks. Metadata-only rendering returns `sql: null`. The `statements` array exposes only ordered schema statements; execute the SQL profile prologue before those statements when consuming that array outside the test oracle.

## Immutable history and publication

```text
workspace/
  revisions/
    000000/
      snapshot.json
      manifest.json
    000001/
      snapshot.json
      plan.json
      000001_<from16>_<to16>.sql
      manifest.json
  .writer.lock                 # present only while owned, or after failed cleanup
  .stage-<nonce>/               # transient, owned by the active writer
```

There is no mutable HEAD file. Every manifest records format/version, canonical sequence, kind, target, predecessor manifest hash, full from/to snapshot and physical hashes, migration ID, exact file checksums/sizes, and authorization/check specifications. Migration ID is the SHA-256 of canonical plan bytes, excluding authorization. SQL has its own file hash. Baseline has no predecessor/plan/SQL; metadata revisions omit SQL.

Read validation examines the entire inventory and requires contiguous canonical six-digit sequences. Gaps, malformed or unexpected higher entries, partly formed revisions, extra/missing files, bad checksums, incorrect predecessors, unsupported versions, mismatched snapshots/plans/SQL, unsafe links/junctions/reparse ancestors, path escapes, or unowned temporary entries fail closed. Valid `000000` never permits silently ignoring broken `000001` or unexpected `000002`. Artifacts are reconstructed from snapshots and verified against the recorded bytes; editing checksums alone cannot legitimize forged plans or SQL.

Publication acquires an exclusive `wx` writer lock, validates all history and expected head, stages complete artifacts on the same filesystem, flushes files, reads them back, reconstructs policy/simulation, revalidates history/head, and renames the whole stage to an absent revision destination. It never modifies old revisions or overwrites an existing revision. Failure before that rename leaves committed history unchanged. Cleanup failure after rename returns `committed: true` and `cleanupFailures`; the committed revision is retained and never rolled back destructively.

The lock is a local cooperating-writer contract, not a distributed lock. Active, stale and malformed locks all fail closed. Neither lock age nor PID alone authorizes takeover. An operator may clear a stale lock only after establishing that no writer owns the workspace; inspect any remaining owned stage before removing it, then run `verify`. The implementation does not promise power-loss durability beyond the underlying filesystem's rename and flushed-file behavior.

## Library API and errors

```javascript
const fs = require('fs');
const M = require('./src/migrations');
const next = M.compileSourceForSnapshot(fs.readFileSync('new.apiforge', 'utf8'));
const history = M.readMigrationWorkspace('schema-history');
const plan = M.planMysqlMigration(history.head.snapshot, next);
const inspected = { expectHead: history.headToken, expectPlan: M.hash(plan) };
// Review plan and its exact operation IDs; add selected authorizations if required.
const rendered = M.renderMysqlMigration(history.head.snapshot, next, plan, inspected);
const result = M.publishMigrationRevision('schema-history', next, inspected);
```

Other exports include `buildMysqlSnapshot`, `validateSnapshot`, `canonical`, `parseCanonical`, `snapshotSha256`, `physicalSha256`, `diffSnapshots`, `simulateMigration`, `emptySnapshot`, and `MigrationError`. Pass validated snapshots to physical projection/fingerprint functions; pass OLD, a generated plan, and NEW to simulation for complete closure. Pure schema logic is separate from filesystem workflow. The `fileSystem` publication option is a test fault-injection seam.

Migration errors have their own domain: `MIGRATION_BASE_MISSING`, `MIGRATION_HEAD_MISMATCH`, `MIGRATION_HISTORY_CORRUPT`, `MIGRATION_CHECKSUM_MISMATCH`, `MIGRATION_VERSION_UNSUPPORTED`, `MIGRATION_PROFILE_UNSUPPORTED`, `MIGRATION_PLAN_CHANGED`, `MIGRATION_AUTHORIZATION_REQUIRED`, `MIGRATION_UNSUPPORTED_TRANSITION`, `MIGRATION_DEPENDENCY_CYCLE`, `MIGRATION_INTERMEDIATE_UNREPRESENTABLE`, `MIGRATION_WORKSPACE_BUSY`, and `MIGRATION_PUBLICATION_FAILED`. Invalid source retains existing compiler diagnostics; the ordinary semantic registry is unchanged.

## Compatibility, verification and G27 boundary

Ordinary `Codegen.generate`, `index.js`, HTTP compilation, playground and ZIP generation do not read migration state or add snapshots/manifests/migration paths to ordinary output. Existing generated file counts, ordered paths and bytes remain pinned to approved main. G19 publication is unchanged. There are no new dependencies or generated README/package changes.

Run `npm run test:migrations` for offline validation and the independent approved-main compatibility oracle. Run `npm run test:migrations-mysql` separately with guarded `APIFORGE_TEST_DB_*` configuration for the native MySQL oracle; it verifies the certified profile and removes every disposable database. Native tests may resolve MySQL metadata presentation ambiguity using isolated typed temporary copies and numeric ENUM ordinals. Those test-only probes are not production drift/introspection APIs.

See [verification evidence](schema-migrations-verification.md). G27 can reuse validated snapshots, intents, safety facts, graph and closure evidence through explicit APIs. Live APPLY, an applied-head table, drift discovery, recovery orchestration, backfills, DOWN SQL, renames, cardinality conversion, PostgreSQL, HTTP/browser migration surfaces and profile switching require separate design and authorization.
