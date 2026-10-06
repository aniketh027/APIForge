# G27 PostgreSQL target verification

G27 STATUS: CLOSED

Verified on 2026-10-06 on local branch `g27-postgres-target`, based on approved main `24a6289aabad9f24dcdee34d1854373c6727103a`. Gates A, B, C and D pass. Native PostgreSQL persistence, generated HTTP behavior, exact default/explicit MySQL compatibility and existing MySQL regressions were verified separately. No push, merge, main update, tag update, history rewrite or protected-artifact change was performed.

## Preflight and local history

Origin was fetched before implementation. Local main, origin/main and the live remote main were all `24a6289aabad9f24dcdee34d1854373c6727103a`. Local and remote `v1.0.0` peeled to `9d5b223b0af350a237625f4cd8dfbc700e35dd1b`; the remote annotated tag object remained `2e5368620ca210cfa240b1b62faf82be99b491ea`. The tracked worktree and index were clean. Only the four approved protected roots were untracked.

The established 36-file protected manifest was captured as `%TEMP%\apiforge-g27-protected-manifest.json`, SHA-256 `e2fc5717827e3af5115fe1f896289ddfb08d49a8bc1f21c3c2b24f9ce6f9786e`. Repeated checks compare each path, size, SHA-256, creation time and modification time with that baseline.

The local commit sequence is:

| Commit | Purpose |
|---|---|
| `634f754` | `test(g27): pin approved-main mysql compatibility oracle` |
| `ea8fc3e` | `refactor(targets): add target selection and admission seams` |
| `d3f5b31` | `feat(g27): add postgres naming physical plan and ddl` |
| `7daeff2` | `test(g27): certify postgres native ddl and target boundaries` |
| `77da060` | `feat(g27): add pg config and generated model runtime` |
| `931389d` | `test(g27): verify pg model identity parser and query contracts` |
| `60ffa66` | `feat(g27): expose cli api postgres target and generated project docs` |
| `372e386` | `fix(g27): enforce default capacity and PostgreSQL heap alignment` |
| `a19e28c` | `fix(g27): resolve generated integer identities from returning` |
| Report-bearing final commit | `test(g27): certify generated postgres backend and cross-target compatibility` |

Gates A/B/C passed before their dependent implementation stages. The two additional corrective commits address reproduced review findings: default representability and PostgreSQL fixed-type alignment, then generated-integer identity resolution. The latter reproduced a trusted direct-model input `"15"` stored as INTEGER 15 while the response echoed the string; resolution now uses the native `RETURNING` key for generated integer identities. Native model and generated-backend gates were rerun successfully after the correction. The report-bearing final commit completes ten local commits, **10 ahead / 0 behind** origin/main. Its SHA is available with `git rev-parse HEAD`, avoiding a self-referential hash in this committed report.

## Certified native environment

| Property | Observed or enforced value |
|---|---|
| Target profile | `postgresql-18-v1` |
| Server | PostgreSQL **18.6**, Debian `18.6-1.pgdg13+2`, x86_64, 64-bit |
| Server version number | `180006` |
| Official image tag | `postgres:18` |
| Tested image digest | `postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722` |
| Encoding / block size | UTF8 / 8192 bytes |
| Identifier / index-column limits | 63 UTF-8 bytes / 32 columns |
| Application schema | Existing `public` |
| Administrator defaults | TimeZone `Etc/UTC`, DateStyle `ISO, MDY` |
| DDL/application session | UTC, `ISO, YMD`, standard_conforming_strings on |
| Application search path/name | `pg_catalog, public` / `apiforge-postgresql-18-v1` |
| Text collation / index access method | `C` / ordinary B-tree |
| Native driver | `pg` **8.23.1**, declared range `^8.23.1` |
| Other installed root dependencies | dotenv 17.4.2, express 5.2.1, mysql2 3.23.4 |
| Generated Node floor | Node >=18 |

No configured PostgreSQL credentials were available; native gates used uniquely owned, loopback-only official PostgreSQL 18 Docker containers. Random credentials remained in memory and child environments. No credential `.env` file was created. The native database checks verify `public`, UTF8 and required schema/table privileges. Certification is specific to the frozen profile and tested minor release.

## Contract and coverage ledger

The following 52 entries cover the requested report items. Tests referenced here are in `tests/`; implementation details and user setup are documented in [postgres-target.md](postgres-target.md).

| # | Contract | Evidence and result |
|---|---|---|
| 1 | Preflight | Approved main/local/remote and peeled release SHAs matched; clean tracked/index state, four protected roots and 36-file baseline verified. |
| 2 | Commits | Ten meaningful local commits in the sequence above; eight planned stages plus two reproduced corrective fixes. No push or merge. |
| 3 | Scope and deferred scope | All eight existing types, native DDL, pg project/runtime, CRUD, validation, collections, four cardinalities, errors, OpenAPI, CLI/library/API selection and G19 are implemented. Deferred items remain deferred, as listed below. |
| 4 | Target selection | Only exact `mysql` / `postgres`; omission or undefined selects MySQL. Null, empty, aliases, case variants and wrong types produce appended `INP003`. Both CLI flag positions work; duplicate/missing values fail before publication. HTTP invalid target is 400, with source-validation precedence preserved. `target-selection.test.js` passes. |
| 5 | Semantic split | Common validations retain their original position. Adapter hooks own physical comparison, names and target admission. MySQL SEM036/SEM037 and diagnostic ordering remain exact; PostgreSQL admits trailing-space ENUM and bounded generated INT, with SEM040 source admission and GEN001 direct-IR admission. |
| 6 | Exact MySQL compatibility | Gate A compares omitted and explicit MySQL against approved main through all phases, diagnostics, warnings, symbols, IR, generation paths/bytes, CLI/API, browser ZIP and G22/G26 seams. Zero mismatches. |
| 7 | Profile | `postgresql-18-v1` assumptions are enforced; no arbitrary schema, custom search path, extension or broader version claim. Native profile is recorded above. |
| 8 | Versions | Native PostgreSQL 18.6 / pg 8.23.1; native MySQL regressions use MySQL 8.4.11 / mysql2 3.23.4. Both have independent persistence evidence. |
| 9 | Identifier policy | Always quoted, embedded quotes doubled, exact spelling; NUL, malformed Unicode, >63 UTF-8 bytes and real system columns reject. Native 62/63-byte names succeed; 64-byte names reject. Runtime malformed keys fail before SQL. Portable file/route rules remain independent. |
| 10 | Generated names | Frozen tokens `pk, uq, ck, fk, ix, seq, nn`; `af_<kind>_<40hex>` hashes the frozen profile/stable owner/ordered fields/purpose tuple. Independent expected-hash and byte-limit assertions pass. |
| 11 | Namespaces | Public tables/indexes/sequences share allocation, including PK/UNIQUE backing indexes; constraints also reserve per-table names. Native catalogs match names/schemas exactly. CREATE INDEX uses an unqualified name and qualified table; SEQUENCE NAME is qualified. |
| 12 | Type mappings | INTEGER, VARCHAR(n) C, REAL, BOOLEAN, TEXT C + CHECK, DATE + range CHECK, TIMESTAMPTZ(0) + range CHECK, UUID. Native types, typmods, order, collation, requiredness and evaluated typed defaults match the physical plan. |
| 13 | ENUM | Named membership CHECK, no native ENUM type. Exact case/Unicode/quotes/backslashes/empty/leading/trailing-space members, typed defaults, reads, filters and rejection tested. Declaration-order CASE sorting and NULL ordering pass. MySQL trailing-space rejection remains exact. |
| 14 | Identity strategy | INTEGER GENERATED BY DEFAULT AS IDENTITY, explicitly named sequence and PK; no SERIAL/ALWAYS. All six effective-key forms have native DDL/model/HTTP evidence. |
| 15 | Zero/null/supplied identity | HTTP omission/optional null generates; REQUIRED null rejects; zero and positive values store independently verified native keys; negative generated input rejects. Implicit id remains unknown HTTP input. Direct models may supply it and allow negative supplied integers; caller objects remain unchanged. |
| 16 | Sequence collision | Native sequence state is unchanged by supplied zero/positive keys. Inserting the naturally next value explicitly causes a later generated conflict, classified 409. No production reconciliation or sequence-reset shortcut is used. |
| 17 | UUID | Native UUID with canonical lowercase public text, all versions, nil/max, runtime/supplied identities, ordinary fields and static defaults. No normalization, database generation or extension. Returned UUID/FK values validate. |
| 18 | DATE/TIMESTAMPTZ | Existing DATE 1000-01-01..9999-12-31 and timestamp 1970-01-01T00:00:01Z..2038-01-19T03:14:07Z; whole seconds, canonical string binds. Native CHECKs and returned-value validation exclude infinity and expanded ranges. |
| 19 | Type parsers | Pool-local public `pg.types` provider for OIDs 1082/1184/1114; numeric offsets normalize deterministically to UTC. Infinity/fractions/format/range errors reject; other types delegate, including int8. No direct `pg-types` import/internal interface or global parser mutation. |
| 20 | Connection/session | Every application query awaits lease setup and profile checks before execution. UTC/ISO-YMD/standard strings/search path/application name are observed natively. Setup/query failure destroys the lease; idle errors emit a fixed safe message. |
| 21 | COUNT | COUNT int8 decimal text validates nonnegative/safe-integer range before Number conversion. Native filtered counts and headers pass; focused over-safe-range rejection is simulated. Global int8 parsing remains unchanged. |
| 22 | Placeholders | Per-statement bind builder starts at $1 for CRUD, count/filter/pagination and relationship/association statements. Native intercepted application queries verify numbering/parameters and injection isolation. |
| 23 | Dynamic create/update | Trusted own keys safely quoted; INSERT columns/VALUES, empty DEFAULT VALUES, immutable identity and empty-update reread. RETURNING includes only effective key; create echoes submitted fields plus resolved identity, without read-time defaults. Caller payloads stay unmodified. |
| 24 | Direct-model trust | No HTTP whitelist applied to direct models. Valid unknown/injection-shaped identifiers reach PG safely; malformed/NUL/oversize names reject before DB. Declared UUID/temporal values validate. Native and focused pre-DB assertions pass. |
| 25 | Results | rowMode array plus trusted field metadata/Object.fromEntries preserves own `__proto__`, `constructor`, `prototype`. Generated integer keys resolve native RETURNING values; update rereads, deletes/removals use rowCount, absence retains existing behavior. |
| 26 | Error taxonomy | Independent operation-sensitive PG classifier maps known data errors to 400, conflicts to 409, selected temporary/transport errors to 503, unknown/internal/config/permission to 500. Read 500/503 and G06 fixed envelopes/messages remain. No detail/code/SQL/credential leakage or retry. |
| 27 | Relationships | G22 logical topology retained: nullable O2M/M2O SET NULL, nullable UNIQUE O2O CASCADE, composite-PK M2M with two CASCADE FKs. Endpoint tables precede FK addition; native cycles import with enforcement enabled. |
| 28 | Support indexes | Deterministic full B-tree referencing support, deduplicated by leftmost-prefix coverage. O2O reuses UNIQUE; junction source reuses PK and target gets support. Independent catalogs verify ordered fields, uniqueness, validity, full index, method and collation. |
| 29 | Target preflight | PG-only identifier/system/namespace/default/name limits, 1600 columns, 32 parts, VARCHAR 10,485,760 maximum, conservative aligned fixed-heap and B-tree widths. Native declarations/boundaries back the model; no MySQL budgets reused. Source failures are SEM040; direct IR is structured GEN001. |
| 30 | Native DDL gate | Gate B PASS: independently import and compare all types/keys/defaults/bounds/lengths/ENUM/cardinalities/cycles/reserved/mixed/prototype/Unicode names and index boundaries. No catalog difference normalized away. |
| 31 | Catalog counts | Final Gate B: **38 tables, 89 columns, 131 constraints, 52 indexes, 11 sequences, 33 CHECKs and 180 native CHECK-boundary evaluations**. Catalog authority and boundary details follow below. |
| 32 | Runtime/model gate | Final Gate C PASS: **29 entities, 94 files, 154 native application queries**. CRUD, identities, scalars, direct-model trust, parsers, counts, parameters, relationship/absence contracts and nonmutation verified. |
| 33 | Generated backend gate | Final Gate D PASS: standalone project outside repository output, npm install, disposable DB, schema import, npm start and health followed by **150 counted HTTP requests** and **13 independent native errors**. Health/raw malformed-JSON requests are additional checks. |
| 34 | CRUD | Models and HTTP exercise six key forms plus static STRING default, empty create, submitted/read defaults, supplied/null keys, partial/empty updates, immutable identity, delete and missing resources; stored keys independently queried. |
| 35 | Collections | All scalar filter parsing, filtered count/header types, sort/order/limit/offset, stable pages, ENUM ordinal/NULL order, C case/Unicode/NFC-NFD/trailing-space comparisons and injection isolation pass. |
| 36 | Relationship evidence | Native model/HTTP helpers cover every cardinality, add/list/remove M2M, compatible mixed UUID/STRING and UUID/UUID keys, related DATE/TIMESTAMPTZ defaults and absence. Model false/null and existing HTTP removal-absence 200 are preserved; catalog delete actions and native SET NULL/CASCADE behavior pass. |
| 37 | Temporal timezone matrix | Native text under UTC, Asia/Kolkata, America/New_York and Pacific/Kiritimati decodes canonically. DATE bounds/leap/default/null/filter/related reads and timestamp min/max/default/null/filter/related reads pass. HTTP process host TZ is Pacific/Honolulu. Defensive timestamp/numeric-seconds offsets and invalid expanded values are checked. |
| 38 | UUID matrix | Nil, maximum, several versions, ordinary/static/runtime/supplied values, path/filter validation and both relationship key combinations across all four forms pass. Invalid public input fails pre-DB; no extension is installed/required. |
| 39 | ENUM matrix | Exact membership and declaration metadata, difficult labels/defaults/filters/reads, native CHECK failures, declaration sorting and both NULL directions pass. MySQL SEM036 remains pinned. |
| 40 | Identity matrix | Implicit INT, explicit generated INT, INT DEFAULT, STRING, runtime UUID, UUID DEFAULT plus STRING DEFAULT tested separately through models/HTTP; applicable omitted/null/zero/positive/negative/static/runtime/update cases and independent database key/sequence evidence pass. |
| 41 | DB error matrix | Native UNIQUE/FK/NOT NULL/CHECK/conversion/INTEGER/REAL/VARCHAR/temporal/encoding failures plus lock-not-available, serialization and deadlock. Owned-connection termination produces sanitized HTTP 503; controlled missing table produces 500 then recovery. 400/409/503/500 and sanitized envelopes pass. |
| 42 | OpenAPI | **262 common accepted programs** emit exact MySQL/PG Swagger bytes. PG-only generated INT bounds intersect declared bounds with nonnegative input policy. Generated backend verifies paths and public schemas; MySQL bytes remain pinned. |
| 43 | G19 target replacement | Real disk CLI accepts both positions. MySQL -> PG -> MySQL replaces a complete project while preserving opaque user `.env` and data roots. Admission failure preserves previous output hashes. Publisher production code is unchanged. |
| 44 | G26 regression | Explicit MySQL binding, no PG snapshot/history. PG CLI request rejects before filesystem mutation. All 547 approved-main source-to-snapshot success/failure results match; ten offline suites and native snapshot/migration gates pass. |
| 45 | Full compatibility counts | Gate A: **269 valid + 278 invalid sources, 3,479 exact generated files, 1,992 comparisons, 269 exact G26 snapshots + 278 exact failures, 26 pinned closure modules**. Includes direct IR/raw witnesses/structural precedence/CLI/API/ZIP. Older baselines/loaders/corpora are unchanged. |
| 46 | Existing suites | All 23 npm test suites pass; ten migration suites, generated install/start integration, six native MySQL harnesses and language-guide verifier pass. Evidence is separated in the regression table below. |
| 47 | Generated file counts | Seven fixed files + three per entity, same ordered path contract; Gates C/D use 29 entities -> 94 files. PG package has dotenv/express/pg; no generated lockfile. Exact MySQL package/README bytes remain unchanged. |
| 48 | Cleanup | Every native harness verifies its pools/observers/server/process/port/project/database cleanup. Owned containers removed; independent inventory finds no G27 containers or temporary G27 project directories. MySQL observer found no owned disposable databases before container removal. |
| 49 | Protected integrity | All **36** paths/sizes/SHA-256/creation/modification times match captured established manifest. Four protected roots remain untracked. Frontend, publisher and historical baseline files retain their approved contents. |
| 50 | Limitations | Frozen PostgreSQL 18 profile, C text comparison, conservative admission, explicit-key sequence collision and bound exhaustion, separate collection reads and trusted direct-model database authority remain documented. Deferred scope is listed below. |
| 51 | Ahead/behind | Final branch is ten local commits ahead and zero behind origin/main; main and peeled release remain approved, with matching live remote refs. Tracked worktree/index clean; only four protected roots untracked. |
| 52 | Status | **G27 STATUS: CLOSED**. Entire source-to-native-DDL-to-generated-HTTP chain and cross-target compatibility are verified. |

## Independent native evidence

Gate B reads PostgreSQL catalogs independently: pg_class/namespace/attribute/type/attrdef/constraint/index/am/collation/sequence and dependency ownership, with native expression/constraint/index deparsing where needed. Comparison includes exact relation inventory, physical column order and typmods, evaluated typed defaults, named NOT NULL/PK/UNIQUE/CHECK/FK constraints, referenced key columns/schema, actions, index fields/method/collation and sequence configuration/ownership. Same-type non-key UNIQUE columns and a non-first declared PK exercise correct FK binding.

The 180 CHECK evaluations execute actual catalog expressions at valid/invalid/NULL boundaries instead of weakening or text-normalizing away predicates. Boundary checks cover native 62/63-byte ASCII and Unicode identifiers, rejected 64-byte names, 32/33 index parts, 1600/1601 columns and VARCHAR's declaration maximum. Uncompressible B-tree values of 2640 bytes fit while 2720 bytes reject under the stock profile. Conservative declared STRING-key capacities 668/669 fit the admission budget and 670 rejects. The fixed-heap model respects PostgreSQL alignment for INTEGER/REAL/DATE, BOOLEAN/UUID and TIMESTAMPTZ; variable-width storage is intentionally outside a general heap simulator.

Gate C exercises actual emitted models against native tables, including trusted generated-integer string coercion returning a numeric identity, safe arbitrary columns, prototypes, unknown columns, caller nonmutation, all relationship helpers, returned scalar normalization, native timezone output and lease setup. Count overflow rejection and malformed runtime identifiers are focused synthetic/pre-query checks; they are distinguished from native persistence assertions.

Gate D installs the emitted consumer package and starts its real server with host TZ Pacific/Honolulu. It exercises 150 counted HTTP requests, plus health and a raw malformed-JSON check. Ten independent native data SQLSTATEs are `23505`, `23503`, `23502`, `23514`, `22P02`, `22003`, `22001`, `22007`, `22008`, `22021`; controlled native temporary cases add `55P03`, `40001`, `40P01`. Each is checked against the emitted operation-sensitive classifier. HTTP also verifies conflicts/data errors, a safely terminated connection in the owned database yielding 503, and a temporarily renamed owned table yielding 500 followed by recovery. Read data errors remain 500. Responses expose only G06's fixed public messages, including the existing malformed-JSON message. No retry occurs.

## Existing regressions

| Gate/suite | Observed result |
|---|---|
| `npm test` | PASS, all 23 suites; includes core compiler, string length, disk generation/G19, generated safety, diagnostics/warnings/ENUM, collections, PK/write validation, G06, naming/relations/OpenAPI, G16, V1 audit, G24, G25 and G22. |
| Core compiler | 1,060 passing assertions, zero failures. |
| G06 offline | 1,436 taxonomy assertions and 1,515 mock HTTP requests PASS. Mock HTTP is separate from the native G06 evidence below. |
| G16 offline | Eight groups / 514 assertions PASS. |
| G24 offline | 21 groups / 1,581 assertions PASS. |
| G25 offline | 18 groups / 1,120 assertions PASS. |
| G22 plan | 21 groups / 2,616 assertions PASS. |
| Existing G22 equivalence | Unchanged pinned `d91859e30a5ed0f91be9826a3d8d3a5c5b7261ce` oracle: 498 sources, 235 valid / 263 invalid, 3,088 exact files, 1,913 parsed JS files, 12 direct-IR cases, 33 raw witnesses, four structural cases, 3,002 assertions, zero mismatches. |
| `npm run test:migrations` | All ten suites PASS: snapshot 289, diff 4, safety 60, planner 4, simulator 27, renderer 10, history 20, publication 53, CLI 14 checks; 247 admitted corpus snapshots. |
| Existing G26 compatibility | Unchanged pinned `1caf927b5bcef627575a36c1d29800ce03e6f17c`: 247 valid / 268 invalid, 3,235 exact files, 655 checks PASS. |
| Language guide verifier | 20 valid / 79 invalid exact diagnostic examples; 133 generated JavaScript files parsed; real CLI 20 valid and 79 invalid exact exits/output containment PASS. |
| Generated integration | Consumer npm install/start/health and process/port/project cleanup PASS. This is startup evidence; native persistence is proved by the database harnesses. |
| Native MySQL environment | MySQL 8.4.11, mysql2 3.23.4, owned loopback-only disposable instance; all six existing native harnesses PASS. |
| G16 native MySQL | 155 schemas: 53 imports / 102 structural rejections, 1,698 checks; cleanup PASS. |
| G24 native MySQL | 431 checks, 25 application queries, 25 deliberately non-UTC leases across three actual connections; all cardinalities/bounds/defaults/validation/filter/sort/UTC behavior; cleanup PASS. |
| G25 native MySQL | 289 assertions, 49 queries, 19 UUID columns, six compatible FKs, all cardinalities and G06 conflicts; cleanup PASS. |
| G26 native MySQL | Ten exact snapshot schemas; 48 native migrations, 75 intermediate comparisons, 67 preservation comparisons, 32 predicates, 106 omission checks PASS; cleanup PASS. |
| G06 native MySQL | Ten real constraint failures exercise 409/400 with independently observed driver codes and fixed public envelopes; cleanup PASS. |
| Generated native MySQL | Real package install/schema import/server/HTTP CRUD and typed collections, sorting/pages/headers/injection isolation PASS; server/database/project/port/output cleanup PASS. |
| G27 offline | Approved-main oracle, target-selection/publication and PG target-policy tests PASS; 262 common Swagger comparisons and generated JS parsing included. |
| Diff/scope | `git diff --check` PASS; no frontend/publisher edits or historical fixture/oracle baseline refresh. Registry count checks change only for appended INP003/SEM040/GEN001 (68 -> 71); retained diagnostic codes remain pinned. |

Raw local verification output is retained in `%TEMP%`: `g27-approved-main-oracle.log`, `g27-offline-final.log`, `g27-ddl-native.log`, `g27-model-native.log`, `g27-backend-native.log`, `g27-npm-test-final.log`, `g27-migrations.log`, `g27-language.log` and `g27-mysql-native-results.json`. The final three PostgreSQL gate logs supersede earlier intermediate runs. Credentials are not written into these reports or test logs. The committed test harnesses provide reproducible verification; local logs are supplemental evidence.

## Reproduction and closure checks

From the repository root:

```powershell
npm test
npm run test:g27
npm run test:migrations
node docs/verify-language-guide.js
npm run test:generated-integration
npm run test:postgres-native
git diff --check
./tests/verify-protected-artifacts.ps1 -Manifest "$env:TEMP\apiforge-g27-protected-manifest.json"
git rev-list --left-right --count origin/main...HEAD
git ls-remote origin refs/heads/main refs/tags/v1.0.0 'refs/tags/v1.0.0^{}'
```

For configured native PostgreSQL, supply all four `APIFORGE_TEST_PG_HOST`, `APIFORGE_TEST_PG_PORT`, `APIFORGE_TEST_PG_USER`, `APIFORGE_TEST_PG_PASSWORD` environment variables. Otherwise the harnesses own a loopback-only official PostgreSQL 18 Docker fallback. They permit only guarded disposable database names and remove their own resources. Existing native MySQL tests require their documented `APIFORGE_TEST_DB_*` environment; this verification supplied an owned disposable MySQL 8.4 server and ran `test:mysql-target-capacity-mysql`, `test:date-timestamp-mysql`, `test:uuid-mysql`, `test:migrations-mysql`, `test:db-error-taxonomy-mysql` and `test:generated-mysql`. Do not print credentials or persist them in generated output.

Final cleanup verifies owned containers/databases, pools, observers, child processes, bound ports and temporary generated projects are gone. Protected checks still pass for all 36 files, the captured manifest itself is unchanged, and local/live main and v1.0.0 refs retain their approved values. The final tracked worktree/index is clean with only these approved roots untracked: `APIForge_Drive_Resources.zip`, `APIForge_Drive_Resources/`, `APIForge_Overleaf_Source/`, `APIForge_Overleaf_Source__FINAL.zip`.

## Limitations and deferred work

Generated PostgreSQL behavior is certified for the frozen PostgreSQL 18 UTF8/public/8192-byte/64-bit profile. STRING and ENUM use C collation; STRING comparison differs from MySQL utf8mb4_unicode_ci. The conservative B-tree admission model may reject declarations whose particular stored values could fit, and the fixed-heap check is not a general storage simulator. Data-dependent failures remain database-authoritative.

Explicit generated-integer keys do not advance sequences. A later natural generated value can conflict and return 409. Generated INT bounds can eventually reject a sequence value with sanitized 400; sequence starts/ranges are unchanged. There is no automatic reconciliation or retry. Trusted direct models preserve database authority for valid arbitrary keys; HTTP validation retains its own narrower field/value contract. Count and page data are separate reads. G19 replacement preserves user roots, including dependencies, and does not implement live database switching.

Deferred exactly as approved: PostgreSQL migrations, G26 snapshots/history/ALTER planner, APPLY/DOWN/drift, live target switching, browser selector/redesign, configurable schemas/search paths, arrays/JSONB/custom types or syntax, native ENUM, database-generated UUIDs, pgcrypto/uuid-ossp/other extensions, custom SSL settings, sequence reconciliation and runtime retries. Browser requests continue to omit target and produce the exact MySQL project/ZIP. G26 remains exclusively mysql-8.4-v1.

G27 POSTGRESQL TARGET — READY FOR EXTERNAL REVIEW

## External-review correction: privileges and VARCHAR assignment (2026-10-06)

The original closure record above describes reviewed tip `fdcf9cb4a6242c9cfb61d8a0ebf8c29bf3d2e2c2` and is retained unchanged. External review identified an overbroad privilege check and missing VARCHAR assignment evidence. This section records the corrections and the revised closure decision.

### Reproduction and privilege root cause

Before editing production, `tests/postgres-review-reproduction.test.js` loaded the complete compiler dependency closure pinned to the reviewed tip and generated `ENTITY Witness value STRING`. An administrator imported its schema into an owned disposable UTF8 PostgreSQL 18.6 database. A separate random LOGIN role received database CONNECT, public USAGE/CREATE and SELECT/INSERT/UPDATE/DELETE on the generated Witness table only. The role was independently verified NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Sequence USAGE/SELECT/UPDATE were all false. Generated identity INSERT succeeded before the unrelated table was added.

The administrator then created ordinary public table `Private_4af445717107c1094ae04ec8`, with no application grants. The reviewed generated model's next read failed with exactly `Unsupported PostgreSQL deployment profile.` This reproduced the blocker before the production correction. The initial output is retained in `%TEMP%\g27-review-reproduction.log`.

The committed reproduction continues replaying the reviewed tip independently of the fixed code. Its final replay used database `apiforge_g27_c70a221d0a115d3ddb531cfe`, application role `apiforge_g27_app_8d63fdcea8f3b4d13fab21cf` and unrelated table `Private_99e217534cec7efff004feb5`, with the same failure. Every unrelated fixture is checked for different ownership and absence of all four application DML privileges. Passwords are random in-memory values and are never printed or written to project files.

The old NOT EXISTS predicate inspected **every ordinary table in public**, although the contract permits unrelated applications in that schema. An inaccessible unrelated table therefore made every APIForge lease fail. The original native runtime/backend gates used administrator/superuser DB_USER, so has_table_privilege returned true even for unrelated administrator-owned tables; that witness could not reveal the restrictive-role defect.

### Production correction and restricted-role certification

`src/targets/postgres/runtime.js` now consumes the generation context in generateDBConfig and embeds the exact `context.physical.tables` name inventory, including entity and junction tables. The certification query binds that inventory as `$1::text[]`, unnests it and LEFT JOINs the public catalog by exact table name with explicit C collation. Each expected ordinary table must exist and have SELECT/INSERT/UPDATE/DELETE; a missing catalog row or any missing required privilege fails certification. Unrelated public relations never enter the expected inventory. Application values/names are not interpolated into this SQL.

Version 18, UTF8, 8192-byte block, public USAGE/CREATE and all awaited session settings remain enforced. Lease failure still destroys the connection; HTTP errors remain sanitized. Production config creates no roles, grants or schemas and assumes no wildcard privileges. Target-neutral plans, MySQL codegen and shared production modules are unchanged.

Gates C and D now run the generated code with separate owned application roles and keep administrator DDL/catalog/error fixtures on separate connections. Gate C checks current_user through the actual emitted configuration; Gate D independently checks installed-backend pg_stat_activity.usename against its application role. Native role flags are verified false for superuser/createdb/createrole/replication/bypassrls. No sequence grants are issued; native has_sequence_privilege checks confirm no USAGE, SELECT or UPDATE before generated identity writes.

| Restricted-role witness | Final result |
|---|---|
| Connect and access generated inventory | PASS under the separate LOGIN role. |
| Private unrelated public table | PASS: all generated CRUD, collection and relationship operations work with no rights on that table. Final Gate C private table is `Private_2d58f4ffd9bd9cc03aaf91e2`; Gate D is `Private_a45fac35dac07160566cce75`. |
| Missing generated junction privilege | REVOKE DELETE on `"public"."Source3_Target3"`; an operation on another entity fails certification. Model receives the fixed profile error; HTTP returns 500 `{success:false,error:"Unable to complete request."}`. GRANT DELETE restores operation. |
| Missing exact generated table | Rename `"Implicit"` to `"implicit"`; certification fails even though a same-spelling/different-case ordinary table with unchanged grants exists. Restore the exact name and native operations resume. |
| Generated INT identity | PASS for implicit and declared generated keys, omission/null/zero/supplied keys and sequence collision, with no sequence grants. Stored identities are independently selected by the administrator. |
| CRUD/collections/relationships | All existing Gate C/D matrices pass under restricted roles, including all four cardinalities and junction add/list/remove. |
| Sanitization | Fixed 400/409/503/500 envelopes pass. No profile diagnostic, role, database, private table, password, SQLSTATE or internal constraint detail appears in error responses. Administrator-only native error fixtures remain separate. |

### Native VARCHAR(255) assignment matrix and retained policy

All rows below use parameterized INSERT assignment into a real PostgreSQL 18.6 VARCHAR(255) column; independently selected stored strings are compared exactly. This matrix was reproduced before the production change and is retained in native model/backend regressions.

| Input | Input characters | Native assignment/storage | Direct-model create | HTTP create, no declared length bound |
|---|---:|---|---|---|
| 255 non-space `x` characters | 255 | Stored unchanged, exactly 255 `x` characters | Echo length 255; native stored/read length 255 | 201; echo 255, stored/GET 255 |
| 256 non-space `x` characters | 256 | Rejects SQLSTATE 22001 | Rejects native 22001 | Sanitized 400, `Request contains a value rejected by the database.` |
| 255 `x` characters + one space | 256 | Excess space discarded; stores exactly 255 `x` characters | Echo length 256; independently stored/read length 255 | 201; echo 256, stored/GET 255 |
| 255 `x` characters + four spaces | 259 | Four excess spaces discarded; stores exactly 255 `x` characters | Echo length 259; independently stored/read length 255 | 201; echo 259, stored/GET 255 |

Create echoes can therefore differ from storage for this retained PostgreSQL assignment exception. Native direct-model tests also assert caller payloads remain unmodified.

HTTP and trusted direct models have separate validation contracts. With a declared `MAX_LENGTH 255`, HTTP rejects both excess-space inputs before the model with `Field 'textValue' length must be <= 255.` and unchanged native row counts. The trusted direct model for that same declared-bound entity still sends the value to PostgreSQL: VARCHAR truncates the excess spaces, the stored length CHECK sees 255, and the create echo retains the submitted length. Native tests verify that distinction explicitly.

The frozen VARCHAR(n) representation is retained. No TEXT+CHECK replacement, trigger, normalization or additional direct-model scalar validation was introduced. `docs/postgres-target.md` and the generated PostgreSQL README now explicitly describe the excess-space exception, echo/storage difference and declared HTTP length validation. The generated README also documents exact generated-table privilege scope and identity INSERT without sequence grants.

### Final regression results

The native profile remains PostgreSQL 18.6, UTF8, stock x86_64/64-bit/8192-byte blocks, official `postgres:18` image digest `postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`, pg 8.23.1. Generated sessions retain UTC, ISO/YMD, standard strings, pg_catalog/public and the fixed application name.

| Required command | Result |
|---|---|
| `npm test` | PASS, all 23 suites; core 1,060/1,060 and existing G22 equivalence zero mismatches. |
| `npm run test:g27` | PASS: Gate A 269 valid / 278 invalid, 3,479 exact generated files, 1,992 comparisons, 269 exact G26 snapshots / 278 exact failures, 26 pinned closure modules, **zero MySQL mismatch**; target selection/G19/G26 refusal and 262 common Swagger comparisons pass. |
| `npm run test:migrations` | PASS, all ten suites; existing G26 pinned corpus 247 valid / 268 invalid, 3,235 exact files, 655 checks. |
| `npm run test:postgres-native` | PASS, including pinned reviewed-tip reproduction and fresh Gates B/C/D under the revised role contract. |
| Native Gate B | PASS: 38 tables, 89 columns, 131 constraints, 52 indexes, 11 sequences, 33 CHECKs / 180 evaluations. Physical DDL is unchanged. |
| Native Gate C | PASS: **30 entities, 97 files, 170 application model queries**; restricted role, private-table coexistence, missing privilege/exact table, identity without sequence grants and native VARCHAR/model evidence. |
| Native Gate D | PASS: **30 entities, 97 files, 165 counted HTTP requests, 13 independent native errors**, plus health/raw malformed JSON; independently observed restricted-role connection and VARCHAR/default/declared-bound HTTP evidence. |
| `node docs/verify-language-guide.js` | PASS: 20 valid / 79 invalid exact examples and real CLI cases; 133 generated JS files parsed. |
| `git diff --check` | PASS. |

Raw final logs are `%TEMP%\g27-review-native-final.log`, `g27-review-npm-test.log`, `g27-review-g27.log`, `g27-review-migrations.log` and `g27-review-language.log`. The native final log supersedes intermediate review runs. The only changed production module relative to the reviewed tip is PostgreSQL runtime/config/README generation; no shared MySQL/codegen production change occurred. As authorized by the correction request, a fresh native MySQL rerun was unnecessary. Original native MySQL evidence remains historical; the fresh exact MySQL and G26 offline gates above establish correction compatibility without refreshing any baseline.

### Protected integrity, cleanup, commits and revised closure

All 36 protected paths, sizes, SHA-256 values, creation times and modification times match the established captured manifest. Main/origin/main/live remote main remain `24a6289aabad9f24dcdee34d1854373c6727103a`; local/remote v1.0.0 still peel to `9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. Frontend, MySQL production paths, publisher, historical fixtures and pinned loaders/baselines remain unchanged relative to the reviewed tip. No push, merge, amend, rebase, force push or tag change was performed.

Every native session drops its owned disposable databases, then its tracked uniquely named LOGIN roles, and independently queries catalogs to assert both inventories are empty before closing the administrator connection. Generated pools and child processes are stopped; ports and temporary projects are removed; owned containers are removed. Final host inventory finds no G27 containers, temporary G27 project directories or corresponding generated node processes. Repository output remains unchanged.

The corrective implementation/test/documentation commit is **`c28500a5004e29fc213c333e98b2aa81ece5b38c`**, `fix(g27): scope postgres privileges and document varchar assignment`. This appended certification is in the following `docs(g27): record external-review correction verification` commit; its self-referential SHA is resolved with `git log -1 --format=%H -- docs/postgres-target-verification.md` and is reported with the final result. All ten original G27 commits are retained without amendment or rebasing. Final branch `g27-postgres-target` is **12 ahead / 0 behind** origin/main, with a clean tracked worktree/index and only the four approved protected roots untracked.

No blocking or correctness issues remain in the requested correction scope. **Revised G27 STATUS: CLOSED.** Native restricted-role privilege scope and the frozen VARCHAR assignment exception are verified and documented; readiness is for external review, with no merge or push performed.

G27 POSTGRES PRIVILEGE AND VARCHAR CORRECTION — READY FOR EXTERNAL REVIEW
