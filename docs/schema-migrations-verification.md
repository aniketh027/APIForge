# G26 implementation verification

G26 STATUS: CLOSED

The approved conservative offline contract is implemented on local branch `g26-schema-migrations`. Generation remains offline. The closure evidence links admitted snapshots, native naming, structural diff, safety/prerequisite facts, exact authorization, ordered simulation, deterministic SQL, native state/data preservation, immutable publication, and pinned ordinary compatibility. There is no production APPLY or drift check.

## Preflight, branch and protected state

Preflight fetched origin and verified clean tracked/index state with only the four approved protected roots untracked. Local main, origin/main, and the approved implementation base were exactly `1caf927b5bcef627575a36c1d29800ce03e6f17c`. The frozen `v1.0.0` tag peeled to `9d5b223b0af350a237625f4cd8dfbc700e35dd1b`.

The established 36-file protected manifest was copied to a task-specific temporary manifest. Preflight and final `tests/verify-protected-artifacts.ps1` verification passed all paths, sizes, SHA-256, creation timestamps and modification timestamps. No protected root was staged or modified.

Implementation commits, in order:

| Commit | Work |
| --- | --- |
| `0eb25b5` | Independent approved-main compatibility oracle and migration contract tests |
| `3378fa1` | Complete shared admission and physical type/character descriptors; immediate exact compatibility |
| `1a7f8c4` | Deterministic validated snapshots and native physical naming gate |
| `a78d0b6` | Structural intents and conservative safety |
| `68834ed` | Explicit dependency graph and per-operation physical simulation |
| `83be778` | Complete deterministic offline SQL rendering |
| `6b5e9d0` | Separate CLI/library and immutable atomic history |
| `5beb59c` | Review corrections: strict provenance/topology, exact predicates, intermediate capacity and omission coverage |
| `b802367` | Effective binary32 FLOAT defaults and exact UTF-8 input validation |
| `test(g26): verify native transitions and document migration contract` | Final verification commit: native transition matrix, contract/report, focused safety regression, package scripts and narrow repository skill guidance |

Final main, origin/main and live remote main remained at the approved base. Local and live peeled `v1.0.0` remained frozen. The completed branch is 10 commits ahead and 0 behind approved main/origin/main; no feature remote branch was created. No pushes, merges, tag changes, rebases or amendments were performed. Tracked worktree and index are clean after the final verification commit; the four protected roots remain the only untracked entries.

## Snapshot format and native phase gate

`src/migrations/snapshot.js` defines format 1, the canonical serializer, full snapshot checksum and observable physical projection. `mysql-snapshot.js` consumes the admitted Effective Schema Plan and structured target descriptors, not parsed SQL. `compile-source.js` reuses the existing six-phase compiler and complete `prepareAdmittedGeneration` gate. The shared admission refactor immediately passed complete approved-main output/failure equivalence before snapshot development continued.

The hard native gate passed nine exact schemas **before** general diff/planner implementation. It covered all eight types, all six key forms, static/falsy defaults, nullability, numeric/length/both CHECK families, ordinals 9/10 and 99/100, all four cardinalities, mixed keys, support/unique reuse, ordered junction PKs, reserved/prototype names, 64-character identifiers, suffix collisions and PRIMARY naming. The final expanded gate passes ten exact schemas, adding supplementary Unicode/default and non-exact FLOAT evidence.

Native metadata reads independently use all seven required sources: COLUMNS, STATISTICS, TABLE_CONSTRAINTS, KEY_COLUMN_USAGE, REFERENTIAL_CONSTRAINTS, CHECK_CONSTRAINTS and TABLES. SHOW CREATE TABLE and typed native probes resolved presentation ambiguity. No table, column, key order, namespace, default, charset, action or constraint difference was normalized away.

MySQL 8.4.11 stores supplementary Unicode ENUM labels and static defaults correctly but its COLUMN_TYPE/COLUMN_DEFAULT/SHOW presentation can replace supplementary characters with `?`. The test-only oracle copies the native typed column into an isolated CTAS temporary table and reads numeric ENUM ordinals or the native DEFAULT value. It never fills those values from expected snapshots. Temporary copies are dropped in `finally`; deployment generation has no introspector or database dependency. A zero-row outer join was found unsuitable for reading defaults after data existed and was replaced with the isolated typed-copy probe.

FLOAT defaults are rounded to binary32 by MySQL. Snapshots retain declared semantics separately from the effective physical default. The native oracle widens the actual temporary native value to DOUBLE to compare the exact binary32 value. This detects real stored-value differences rather than relying on the shortened INFORMATION_SCHEMA decimal spelling. Metadata-only FLOAT equivalence and native default addition/change have separate evidence.

Schema-scoped CHECK and FK symbol namespaces are independently case-insensitive; CHECK and FK symbols may share a name across their separate namespaces. Secondary indexes are per-table case-insensitive, with PRIMARY reserved. Automatic CHECK names and FK/index suffixes match native behavior exactly.

## Canonicalization, hashes and profile

Canonical bytes are UTF-8, bytewise sorted object keys, LF and final LF. Semantically unordered collections have explicit strict order; columns, index parts, PK parts and ENUM members retain meaningful order. Duplicate/noncanonical JSON, invalid UTF-8, unsupported prototypes, nonfinite/cyclic data, hidden/accessor/symbol properties, sparse/extended arrays, malformed Unicode and unknown record keys fail validation.

Full snapshot SHA includes provenance, semantic defaults, logical refs, source-plan versions and identity intent. Physical SHA excludes those application annotations and index-purpose/implicit annotations while retaining exact effective types/defaults, ordered columns/parts, profile table options, names, CHECKs, FKs and actions. Exact implicit/explicit identity and label changes can therefore change the complete snapshot while preserving the physical fingerprint.

Immutable `mysql-8.4-v1` data captures MySQL 8.4, CHECK syntax floor 8.0.16, InnoDB/DYNAMIC, 16384-byte pages, utf8mb4/utf8mb4_unicode_ci inheritance, case mode 0, strict SQL, disabled NO_BACKSLASH_ESCAPES, UTC and explicit TIMESTAMP defaults. Native server evidence was:

```json
{"version":"8.4.11","pages":16384,"casing":0,"mode":"IGNORE_SPACE,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION","strict":1,"engine":"InnoDB","rowFormat":"dynamic"}
```

Configured test credentials were present but the configured server refused connection. The authorized cached Docker fallback used a disposable MySQL 8.4 container bound only to loopback with an ephemeral host port. No credentials were printed or persisted. This certifies the tested profile, not every MySQL 8.x configuration. Ordinary target compatibility was unchanged.

## Diff, safety, requirements and authorization

`diff.js` is the structural change authority. Exact physical names match objects; renames are visible drop/add or drop/create. It detects table/column/type/nullability/default/generation, PK, index, CHECK, FK, order and logical metadata changes. No fuzzy inference or rename maps exist.

`mysql-safety.js` is the safety authority. The vocabulary is exactly SAFE, REQUIRES_DATA_CHECK, DESTRUCTIVE and UNSUPPORTED. The complete matrix is documented in [the contract](schema-migrations.md#diff-and-safety-contract). Combined changes retain the strongest class and every prerequisite. Default/uniqueness/CHECK/FK weakening carries future-write or integrity warnings. Static CHECK proof uses effective physical values, so a FLOAT declared as 0.1 cannot incorrectly prove a `MAX 0.1` constraint after binary32 rounding.

The six structured requirements are TABLE_EMPTY, NO_NULLS, UNIQUE_VALUES, VALUES_FIT_STRING_CAPACITY, VALUES_SATISFY_CHECK and NO_ORPHAN_FOREIGN_KEYS. `mysql-requirements.js` provides deterministic read-only check specifications against OLD before DDL, with quiesced writes and profile settings. Collation-aware unique grouping excludes NULL tuples; capacity uses CHAR_LENGTH; CHECK predicates preserve NULL semantics; FK checks retain ordered parts and native comparisons. New static definitions project their effective values, unknown new non-null values require emptiness, and a newly created parent is known empty. Production never runs these queries.

Every acknowledgement and destructive permission selects an exact applicable operation ID and is bound to the exact plan hash. Requirements and IDs are retained in manifests and prominent canonical SQL comments. Authorization never changes a blocker into a supported operation, and acknowledgement never claims APIForge executed a predicate. Missing/changed plan hashes, absent/unknown/inapplicable IDs, missing data checks and unsupported creation fail before publication.

All six current identity forms are supported for snapshots/create/drop. Retained PK membership/order, key type/width, default policy or AUTO_INCREMENT conversion is unsupported. Exact implicit/explicit identity changes are metadata-only. ENUM preserves ordered utf8mb4_bin members; exact-prefix append within the same 1/2-byte class is supported, and 255 to 256 remains explicitly blocked. All 12 directed cardinality conversions are tested unsupported. Label-only changes require identical endpoints/storage. Removing relation columns/junctions is destructive; removing FK enforcement alone is safe with a warning and retained index.

## Graph, implicit indexes, simulation and renderer

`mysql-plan.js` is the dependency authority and `plan.js` implements stable Kahn sorting. Dependencies release FK/CHECK/name/capacity conflicts, precede references with endpoints/support, preserve added-column order and remove cyclic table FKs first. Version-1 tie-break uses fixed operation priority followed by bytewise table/object/operation IDs. Invalid/cyclic dependencies use MIGRATION_DEPENDENCY_CYCLE. SQL never disables foreign-key checks.

`mysql-snapshot.js` models implicit support creation and replacement; `simulate.js` applies that rule. Native differential cases cover no prior support, existing UNIQUE, existing secondary support, superseding implicit support, DROP FK retaining support, superseding after FK removal, and a composite support index still required by another FK. Native checks pass after every applicable statement, not merely final NEW.

Simulation clones OLD, checks exact before state/dependencies, mutates declared facts plus modeled index effects, validates each boundary, and records a fingerprint. It requires final physical state and, with NEW supplied, complete metadata equality. It never assigns NEW. Native plan coverage removes each of 106 required operations in turn and proves closure fails. Focused simulator coverage additionally checks immutable inputs, column/index release ordering, maximum capacity and ALTER allowance.

G16 planIssues/rowBudget/storage calculations are reused for identifiers, 1017 columns, 63 secondary/64 total indexes, 16 parts, 3072 key bytes, logical/DYNAMIC local budgets and altered-row allowance. Validators also cover single-VARCHAR/ENUM limits, internal names, default ranges, uniqueness/refs and AUTO_INCREMENT restrictions. A table valid at CREATE's local-record boundary but requiring one extra ALTER byte is rejected with MIGRATION_INTERMEDIATE_UNREPRESENTABLE. Capacity release-before-growth cases pass.

`mysql-renderer.js` reconstructs the exact plan from validated snapshots, authorizes, simulates and emits deterministic SQL. MySQL types/literals/identifiers and complete column presentation are shared in `mysql-target.js`; no second physical type/default mapping was introduced. MODIFY supplies every retained/resulting attribute. FIRST/AFTER preserves NEW order, new tables freeze the profile, and anonymous junction FK names remain native. SQL has a utf8mb4/UTC/TIMESTAMP prologue, canonical prerequisite/authorization header and ordered statements. Metadata revisions have no SQL. No IF EXISTS, IF NOT EXISTS, ALTER IGNORE or FOREIGN_KEY_CHECKS bypass exists.

## History, publication, locks, CLI and API

`workspace.js` is the history validation authority. Sequence 000000 is explicit snapshot+manifest baseline; later immutable sequences contain snapshot+plan, optional deterministic SQL filename, and manifest. There is no mutable HEAD. Full predecessor manifest hashes, artifact hashes/sizes, plan hash, from/to snapshot and physical hashes, target and exact authorization/check specifications are checked. Identical complete snapshots produce no revision; metadata-only revisions retain a plan/new snapshot without SQL.

The full closed inventory fails for gaps, malformed or unexpected higher sequences, incomplete revisions, extra/missing files, checksum corruption, predecessor/version mismatch, forged plan/SQL even with updated file checksums, unsafe paths/junctions/links, and unowned stages. Valid lower revisions never hide bad higher entries. Root user documents are not permitted; documentation belongs outside this workspace.

Publication uses exclusive local `wx` lock, complete validation, exact expected head, same-filesystem staging, flushed artifact writes/read-back, reconstructed simulator closure, a second history/head check, and one directory rename to an absent destination. Old revisions are never edited or overwritten. Injected faults before commit preserve the prior committed tree byte-for-byte. Post-rename cleanup failure returns committed=true with separate cleanup failures and keeps the immutable revision. Tests include staged-artifact faults, competing writer refusal, active/stale/malformed locks and a real Windows junction escape rejection.

There is no age/PID-based lock takeover. Operator recovery requires independently establishing that no writer owns the workspace before clearing a stale lock; orphan stages must be inspected, then full verify rerun. This is a cooperating local-writer workflow, not a distributed or hostile concurrent-filesystem defense, and it does not promise recovery from every power-loss/filesystem failure.

Separate `migrate.js` provides snapshot, baseline, diff, create and verify. Standalone --from/--to-snapshot and source/snapshot targets work. Exact --expect-head and --expect-plan are mandatory for creation. Blocked inspection succeeds; blocked creation leaves history unchanged. APPLY/DOWN/drift commands reject. Invalid new source keeps compiler diagnostics in the separate CLI error envelope.

`src/migrations/index.js` exposes compileSourceForSnapshot, buildMysqlSnapshot, validateSnapshot, canonical/hash helpers, diffSnapshots, planMysqlMigration, simulateMigration, renderMysqlMigration, readMigrationWorkspace, publishMigrationRevision, emptySnapshot and MigrationError. Pure logic and filesystem workflow are separate. Thirteen stable MIGRATION_* codes remain outside ordinary semantic diagnostics. No migration HTTP endpoint, browser UI, live database API or new dependency was added.

## Tests and exact compatibility counts

All commands completed successfully. G26 offline/native suites remain separate from existing `npm test`.

| Verification | Result |
| --- | --- |
| `npm test` | PASS; original core 1060/1060, plus all existing focused suites |
| G19 publication / disk generation | PASS; 22 atomic-publication groups, disk/safety checks |
| G16 offline | PASS; 8 groups / 514 assertions |
| G16 native | PASS; 155 schemas, 53 imports / 102 structural rejections, 1698 checks |
| G22 Effective Schema Plan | PASS; 21 groups / 2616 assertions |
| Original G22 pinned oracle | PASS unchanged; 498 sources, 235 valid / 263 invalid, 3088 ordinary + 117 direct-IR exact files, 33 raw SQL comparisons, 3002 assertions, zero mismatches |
| G24 offline / native | PASS; 21 groups / 1581 assertions; native 431 checks and 25 deliberately non-UTC acquisitions across 3 connections |
| G25 offline / native | PASS; 18 groups / 1120 assertions; native 289 assertions, 49 queries, 19 UUID columns, 6 compatible FKs |
| Generated install/start/health integration | PASS; ephemeral process/port/project cleanup |
| Generated live MySQL / collection | PASS; real persistence, typed filters, stable pages/sorts, headers and injection isolation; cleanup |
| G06 offline / native | PASS; offline 1436 error assertions / 1515 HTTP requests; native ten named constraint/storage errors and cleanup |
| OpenAPI, naming, relationships, request validation, PK, collection | PASS in full existing suite; request validation 848 emitted-controller writes / 43 HTTP requests, PK 67 HTTP requests |
| `node docs/verify-language-guide.js` | PASS; 20 valid / 79 exact-invalid examples, 133 emitted JS files, real CLI exit/bytes evidence |
| G26 snapshot | PASS; 289 checks, including all 247 admitted approved-main corpus sources |
| G26 diff / safety / plan | PASS; 4 / 60 / 4 reported checks |
| G26 simulator / renderer | PASS; 27 / 10 reported checks |
| G26 history / publication / CLI | PASS; 20 / 33 / 14 reported checks |
| G26 approved-main compatibility | PASS; 247 valid / 268 invalid, 3235 exact generated files, 655 reported comparisons/checks |
| G26 native snapshot | PASS; ten exact schemas; original nine passed before planner implementation |
| G26 native migrations | PASS; 48 cases, 75 per-statement physical comparisons, 67 retained-data comparisons, 32 prerequisite checks, 106 omission checks |
| Protected integrity and `git diff --check` | PASS |

G26 offline suites report 1116 checks in aggregate; the compatibility 655 count includes API/ZIP/public phases/direct-IR/raw SQL and real ordinary CLI checks with missing, populated and corrupt migration workspaces. Ordinary ordered file paths/content are compared exactly, without normalization or fixture refresh. UI Git blobs are unchanged; a deliberately CRLF-smudged compiler oracle is not used to compare the checkout's untouched LF stylesheet. The original G22 oracle remains unchanged.

## Native transition and data evidence

The 48 cases cover nullable additions across all types; valid required static defaults; effective FLOAT default addition/change/equivalence; STRING widening; default change/removal; nullability relaxation; CHECK removal/relaxation; ENUM prefix append including numeric ordinals; implicit/explicit identity metadata; UNIQUE removal; all key forms; table/column create/drop; each cardinality's relation addition/label/removal; satisfying datasets for all prerequisite types; all mandatory implicit-index cases; and cyclic table create/drop.

OLD ordinary schema is imported, introspected exactly, and adversarial data seeded. Retained tables are compared before/after using retained ordered columns, row counts, PKs, cells and FK/junction associations. New NULL/default values are checked explicitly. Seeds include NULL, zero, INT signed boundaries, negative values, empty strings, apostrophes, backslashes, supplementary Unicode, trailing spaces, collation-equivalent duplicates, VARCHAR capacity, nil/max UUIDs, leap/maximum dates, TIMESTAMP endpoints, FLOAT boundary values, ENUM labels and numeric ordinals.

Every prerequisite family has positive and negative row evidence before DDL. The independent test row oracle and the production-generated check query must agree; negative evidence is not merely a MySQL ALTER rejection. Duplicate `a` / `A ` exercises the inherited collation. NULL tightening, oversized strings, out-of-bound numeric values, existing rows for TABLE_EMPTY, and orphan values are detected. SAFE cases with relevant retained data compare exact cells/associations. Empty-table creation has vacuous preservation, and destructive cases retain surviving-table evidence while explicitly authorizing storage loss.

## Cleanup, changed files, self-review and limits

Every guarded database helper drops its disposable `apiforge_e2e_*` database in `finally`. Final live inventory found zero matching databases. The exact owned Docker container identity was checked, stopped and removed; a final container listing was empty. Generated processes, pools, ports and temporary projects were cleaned by their respective suites. Credentials were never printed or persisted. No deployment database was connected.

Changes are confined to the separate migration implementation/CLI, migration tests/native helper, two existing shared compiler target files, package test scripts, root README, two migration documents and four narrow repo-skill additions. `git diff --name-only <approved-base>` lists the reviewable inventory. Existing frontend/server/API routes, generated runtime/README/package output, fixtures, G19 publication, DSL/parser/semantic/IR/optimizer contracts and original G22 oracle are unchanged.

Self-review found and corrected effective FLOAT rounding, UTF-8 byte validation, complete metadata simulation closure, symbol namespace case handling, strict provenance/topology, all combined prerequisite retention, native Unicode presentation ambiguity, and owned-stage baseline revalidation. Production searches confirmed one authority each for canonical serialization, structural detection, safety, dependencies, shared complete MySQL column rendering and history validation. No blocking or correctness issue remains in the reviewed approved scope.

Known limits are explicit: one certified profile, cooperating local lock, offline generated history rather than applied state, one-shot DDL, externally established old-schema correspondence, quiesced writes and operator-verified predicates. No claim of lock-free/online/instant execution, automatic rollback, generic 8.x compatibility or production verification is made. G27 may reuse validated snapshot/diff/safety/graph/simulation APIs; APPLY/applied-head/drift/recovery/backfill/down/rename/cardinality/profile-switching/PostgreSQL/UI work remains deferred.

G26 STATUS: CLOSED

G26 SCHEMA MIGRATIONS — READY FOR EXTERNAL REVIEW

## External-review correction: workspace output isolation (2026-10-05)

External review of `76da0b1f4eb0484c88625b87ae2a1ec66367c208` found one blocking workspace-safety issue. The original closure record above is preserved as historical evidence; this section records the correction and revised readiness decision.

### Reproduce before correction

The following Windows path reproducer was executed and both results were asserted before changing production code:

```js
const assert = require('assert');
const path = require('path').win32;
const dirname = 'C:\\Project\\APIForge\\src\\migrations';
const incorrect = path.resolve(dirname, '../../..', 'output');
const expected = path.resolve(dirname, '../..', 'output');
assert.strictEqual(incorrect, 'C:\\Project\\output');
assert.strictEqual(expected, 'C:\\Project\\APIForge\\output');
```

Current incorrect resolved path at the reviewed tip: `C:\Project\output`. Expected repository output path: `C:\Project\APIForge\output`. `workspace.js` lives two directory levels below the repository root; walking three parents omitted the actual repository output from the protected roots. The cwd-derived guard masked that omission when invoked from the repository root, but an unrelated cwd allowed migration history into an ordinary output directory that generation can replace.

Before the production fix, the new regression was added to `tests/migration-publication.test.js` and executed with `node tests/migration-publication.test.js`. It passed the repository-cwd rejection, then failed on the unrelated-cwd/repository-output case with exit 1 and `AssertionError [ERR_ASSERTION]: Missing expected exception.` Publication had accepted the unique repository-output fixture and created its baseline instead of throwing `MIGRATION_HISTORY_CORRUPT`. The test's `finally` restored cwd and removed only its own unique fixture.

### Exact correction and regression coverage

The sole production change is in `src/migrations/workspace.js`:

```diff
-    const generatedRoots = [path.resolve(__dirname, '../../..', 'output'), path.resolve(process.cwd(), 'output')];
+    const generatedRoots = [path.resolve(__dirname, '../..', 'output'), path.resolve(process.cwd(), 'output')];
```

The repository-derived root now protects actual repository output independently of cwd, while the invocation-output guard remains. `safePath` rejects before `mkdirSync`, lock acquisition or revision staging. Both publication and history reads use that guard. G19 itself is unchanged.

The publication suite now reports 53 checks, including 20 new behavior checks:

| Required case | Observed result |
| --- | --- |
| A: repository cwd, workspace under repository `output/` | `MIGRATION_HISTORY_CORRUPT` for publication and read |
| B: unrelated temporary cwd, workspace under repository `output/` | Same rejection, independent of cwd |
| C: unrelated temporary cwd, workspace under invocation `output/` | Same rejection; invocation guard retained |
| D: external workspace from unrelated cwd | Baseline `000000` and migration `000001` publish successfully |
| E: rejection before artifacts | Each rejected case records zero mutating filesystem calls and the workspace remains absent; no lock, stage or revision is created |
| F: history behavior | Prior revision bytes remain identical; validated head matches publication; identical-snapshot no-op preserves the complete workspace bytes; all existing corruption/locking/fault tests still pass |

The test restores `process.cwd()` in `finally`. Its repository-output fixture is a unique child derived from its `mkdtemp` name, verified absent before use; cleanup verifies the exact parent and basename before removing only that fixture. Existing generated output entries are not removed by this fixture cleanup.

The audit command `rg -n '\.\./\.\./\.\.|__dirname|process\.cwd\(\)' src/migrations` returned only the corrected `workspace.js` root-guard line. No second three-parent repository-root assumption exists under `src/migrations/`.

### Rerun evidence and protected state

All required commands completed with exit 0 after the correction:

| Command | Result |
| --- | --- |
| `npm test` | PASS: original core 1060/1060 and all existing focused suites; G19 atomic publication 22 groups; original G22 oracle 3002 assertions, zero exact mismatches |
| `npm run test:migrations` | PASS: all ten offline suites, 1136 reported checks; publication increased from 33 to 53 |
| `node tests/migration-history.test.js` | PASS: 20 checks |
| `node tests/migration-publication.test.js` | PASS: 53 checks |
| `node tests/migration-cli.test.js` | PASS: 14 checks |
| `node tests/migration-compatibility.test.js` | PASS: 655 checks, 247 valid / 268 invalid sources, 3235 exact generated files against approved main `1caf927b5bcef627575a36c1d29800ce03e6f17c` |
| `git diff --check` and staged diff check | PASS |
| `tests/verify-protected-artifacts.ps1` with the original G26 manifest | PASS before and after correction: all 36 paths, sizes, SHA-256, creation and modification timestamps unchanged |

This is a workspace-path correction only. No snapshot, diff, safety, planner, simulator, renderer, SQL or native MySQL semantics changed. As requested, native MySQL suites were not rerun; their original evidence above remains the earlier implementation record.

### Corrective commit and revised closure

New corrective commit: `b684390c8144417fbe9111333ca4d623578460d3` (`fix(g26): isolate repository output across invocation directories`). It directly follows the reviewed tip and contains only the production guard correction and publication regression tests. This appended record is a separate documentation follow-up so it can record the actual corrective SHA without amending any commit.

Final local branch `g26-schema-migrations`, including this report-only follow-up: **12 ahead / 0 behind** both `main` and `origin/main`. Both remain at `1caf927b5bcef627575a36c1d29800ce03e6f17c`. Live remote inspection confirmed the same main SHA and no remote feature branch. Frozen `v1.0.0` remains tag object `2e5368620ca210cfa240b1b62faf82be99b491ea`, peeling to `9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. No push, merge, main/tag change, amend, rebase or force push occurred. Final tracked/index state is clean with only the original four protected roots untracked.

No blocking or correctness issues found in the reviewed correction scope. The external-review blocker is fixed and the required regression and integrity checks pass. Revised closure: the correction is complete locally and ready for external review; integration remains pending.

G26 WORKSPACE OUTPUT ISOLATION FIX — READY FOR EXTERNAL REVIEW
