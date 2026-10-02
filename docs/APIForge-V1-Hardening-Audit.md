# APIForge V1 hardening final audit

Verified 2026-10-02, Windows PowerShell. **READY FOR EXTERNAL REVIEW; not merged.**
This is a fresh audit of the completed branch, not a rewrite of historical reports.

## 1. Branch and authoritative base

Branch: `apiforge-v1-hardening`; remote: `origin/apiforge-v1-hardening`.
Revised authoritative local/remote main and starting hardening base:
`a0168682254550dc99fa8782f14f2827402852b9`, ahead/behind 0/0.
Reviewed PK commits already included: `e644d1b07ef1d095e4a76bd0ba677f4eaced0af3`
and `a0168682254550dc99fa8782f14f2827402852b9`. No topology repair performed.

## 2. Sequential milestone commit ranges

| Stage | Range (exclusive start, inclusive end) |
|---|---|
| 1 naming | a0168682254550dc99fa8782f14f2827402852b9..143f735560203d3b9036d43c6541b371d0e05dc3 |
| 2 relationships | 143f735560203d3b9036d43c6541b371d0e05dc3..862dae2caf0a72c5ca230bd94ad291fd5c71d897 |
| 3 fidelity | 862dae2caf0a72c5ca230bd94ad291fd5c71d897..16cbac71a83ec2ff9603e2ef95f5547dda41f37a |
| 4 MySQL | 16cbac71a83ec2ff9603e2ef95f5547dda41f37a..817e60867c476fdad4bc440f4d69873e0c135bff |
| Final corrective audit | 817e60867c476fdad4bc440f4d69873e0c135bff..the commit containing this report |

Each implementation milestone passed full tests, guide verification, generated
integration, compatibility, syntax/diff checks and protected integrity before
its clean commit and ordinary push. Final commit identity is recorded in the
consolidated completion response; this document cannot contain its own hash.

## 3. Naming and collision result

Shared deterministic allocation preserves existing transforms and rejects
case-insensitive physical/file names, plural route collisions, Windows device
basenames and composed relationship collisions before target output. SEM034
reports the source name range, conflict and corrective hint. Null-prototype
registries preserve own entity/field names including metadata/prototype names;
frontend serialized inventory and real compiler HTTP/CLI behavior are tested.
No silent rename, truncation or new identifier grammar.

## 4. Relationship result

All four cardinalities use effective source/target keys and the shared identifier
quoting authority. Query values remain bound parameters. FK column, constraint,
junction table/column, route and helper allocations fail SEM034 on collision.
Final audit additionally reserves automatic junction `_ibfk_1/2` constraints
against explicit constraints and preserves a generated `__proto__` association
property with a computed object key. Thirty emitted helper calls exercise the
four cardinalities across five key configurations; noncolliding SQL/API output
is compared to the pinned baseline. Relation ownership/deletion policies unchanged.

## 5. OpenAPI and runtime result

OpenAPI 3.0 operation schemas are `Entity.Create`, `.Update`, `.Read`,
`.CreateResult` plus reusable success/error/message envelopes. The dot separator
cannot collide with DSL names; legacy source schemas remain for compatibility.
POST requiredness, partial PUT/immutable keys, constraints/defaults, optional
nullability, ordered nullable enums and synthetic readOnly FK columns reflect
runtime behavior. Implicit and explicit auto-generated keys are readOnly on Read.
CRUD/relationship/error responses use actual status/envelopes. Association echo
keys remain strings because they come from URL parameters. Only declared BOOLEAN
numeric reads normalize to booleans; null and arbitrary INT fields remain intact.
Tests execute 74 real HTTP requests against emitted controllers and validate the
emitted schema subset. This is not a complete independent OpenAPI validator.
Create does not reload arbitrary DB defaults; external physical schema changes
and DB storage constraints remain outside this schema contract.

## 6. MySQL robustness result

Supported assumptions: MySQL >=8.0.16, utf8mb4, InnoDB DYNAMIC, 16 KiB pages,
strict SQL mode with NO_BACKSLASH_ESCAPES disabled. Caller configures server/DB
defaults. See the milestone-4 report for official source links and boundaries.
STRING/ENUM share escaping; raw numeric token metadata prevents unsafe integer
rounding and nonfinite propagation without changing serialized AST/IR. Native
ENUM trailing ASCII spaces reject before output. Target preflight covers 64-char
source/composed/automatic names, single VARCHAR/default capacity, 3072-byte
individual indexed STRING and composite junction keys. Complete row/page layout,
column/index counts and INT/FLOAT storage ranges remain DB-authoritative.
Reserved quoting includes LATERAL/INTERSECT and formerly reserved ARRAY/MEMBER
across supported MySQL 8.0 versions. The [official keyword history](https://dev.mysql.com/doc/refman/8.0/en/keywords.html)
supports these corrections.

Installed mysql2 rejects five private property column names even in dynamic
array mode. Schemas containing those declared or composed columns conditionally
use `rowsAsArray:true, disableEval:true`, then reconstruct rows with
Object.fromEntries. Real installed-driver packet tests prove own property
preservation; the wrapper retains query-option overloads and ResultSetHeader.
Ordinary schemas retain the original pool config. Generated package/README and
root README specify Node >=18; dependencies and lockfile remain unchanged.

## 7. Diagnostics appended

66 public error assignments, 5 warning assignments. All original 62 error and
five warning symbol/code mappings remain unchanged. Additions only:

| Code | Symbol | Meaning |
|---|---|---|
| SEM034 | GENERATED_NAME_COLLISION | generated allocation conflict |
| SEM035 | UNSAFE_NUMERIC_LITERAL | nonfinite/unsafe integer literal |
| SEM036 | ENUM_TRAILING_SPACE | native ENUM membership mismatch |
| SEM037 | MYSQL_TARGET_LIMIT | supported deterministic target capacity |

Semantic failures skip IR/optimization/codegen, preserve located structured
diagnostics, return existing HTTP422/CLI1 behavior and emit no generated output.
Existing warnings are retained; implicit identity remains codegen-only.

## 8. Compiler compatibility

Fresh eight-program pinned-a016868 matrix compares serialized tokens, AST,
semantic/symbol results, IR, optimized IR and generated artifact compatibility.
It includes implicit/explicit INT/STRING/defaulted keys, every scalar type,
ENUM/defaults/nullability and all four cardinalities. All comparisons PASS.
Numeric source metadata is nonenumerable; no DSL type, syntax or phase order
added. New rejections are the deliberate safety boundaries above. Historical
diagnostic and request/key compatibility suites remain authoritative.

## 9. Generated artifact compatibility

Frozen fixture JSONs were not refreshed. A narrow projection checks approved
BOOLEAN helper/calls, sanitized errors, operation-role schemas, Node engine and
supported README changes against baseline; all other bytes remain compared.
New schema refs/roles are tested independently. Ordinary relationship SQL and
disjoint allocations retain baseline output. Intentional changes include quoting
reserved names, safe literals, corrected schemas/booleans/private-column reads
and stricter preflight. Root paths, methods, bound values, key/deletion policy,
pagination and source ownership remain stable. ZIP/frontend consume the same
generatedFiles inventory; protected bundles are not regenerated.

## 10. Security review

Reviewed CLI/server/frontend entrypoints, phase gates, extraction/optimization,
schema/model/controller/router/config/OpenAPI output and generated file lists.
DSL identifiers cannot contain filesystem separators; collision checks cover
portable filenames. Relationship values remain parameters; STRING/ENUM literals
use the supported-mode escaping authority. Own-property registries/body
selection and computed association keys preserve prototype names. Static array
driver parsing avoids private-name rejection without prototype assignment.
General DB failures are sanitized; existing write/query 400, missing404 and
server500 contracts remain. Authentication, authorization, DB error taxonomy,
transactional output publication and server-configuration enforcement are not
new capabilities in this run. No credentials or external messages introduced.

## 11. Complete test results

All four milestone full-suite/guide/integration runs PASS. Fresh final run:

- npm test: PASS; original main suite 1060 assertions, STRING25, diagnostics53,
  warnings26, ENUM16, collection9 groups, implicit-key9 groups, write9 groups
  (848 controller writes/43 HTTP requests), PK8 groups (36 HTTP requests),
  disk generation and MySQL safety; new naming5, relationship3, fidelity3,
  MySQL5 and final-audit6 groups.
- node docs/verify-language-guide.js: PASS; 18 valid, 64 invalid; 120 generated JS
  parses; 82 real isolated CLI invocations and exact diagnostic arrays.
- npm run test:generated-integration: PASS; dependency installation, generated
  server start and /health on ephemeral port62100, process/temporary-project
  cleanup and repository output preservation.
- Focused final suite: actual installed mysql2 packet parser, association own
  properties, auto/explicit FK collision, auto key Read role, reserved words and
  fresh compatibility matrix PASS. Pinned pre-audit output demonstrates the
  defects; unchanged baseline fixtures remain unchanged.
- Changed/generated JS parsing, git diff --check and protected comparison PASS.

Evidence logs outside repo: `%TEMP%/apiforge-v1-final-{test,guide,integration}.log`.

## 12. Live MySQL status

**UNAVAILABLE.** No APIFORGE_TEST_DB_* credentials exist; no temporary database
was created. SQL decoders, emitted queries, installed-driver packets and HTTP
integration are offline evidence, not a live CRUD/DDL claim. Opt-in MySQL suite
remains available and separate from fast offline npm test.

## 13. Original 28-gap status

| Gap | Final status | Evidence / boundary |
|---|---|---|
| G01 implicit key mismatch | FIXED | reviewed effective-key suite |
| G02 injected id collision | FIXED | SEM033 before IR |
| G03 required omission/null | FIXED | reviewed write regression suite |
| G04 scalar write validation | FIXED | reviewed scalar/integer/finite suite |
| G05 body/write authority | FIXED | own fields, shape and selection tests |
| G06 status/error consistency | PARTIALLY FIXED | sanitized modeled endpoints; richer DB error taxonomy deferred |
| G07 relationship quoting | FIXED | four-cardinality emitted helper matrix |
| G08 relationship collisions | FIXED | physical/API/auto constraint preflight |
| G09 transformed entity collisions | FIXED | shared allocation + HTTP/CLI tests |
| G10 case-distinct columns | FIXED | case-insensitive column allocation |
| G11 OpenAPI fidelity | FIXED | operation roles/envelopes and 74 HTTP checks; limits above |
| G12 defaulted PK response | FIXED | reviewed e644d1b/a016868 included |
| G13 PK mutation | FIXED | reviewed immutable PUT contract |
| G14 prototype/metadata names | FIXED | compiler/frontend/schema/driver/association tests |
| G15 STRING backslashes | FIXED | supported-mode literal decoder |
| G16 MySQL capacities | PARTIALLY FIXED | deterministic subset; full storage layout deferred |
| G17 numeric overflow/rounding | FIXED | finite/safe/raw literal checks; physical storage DB-authoritative |
| G18 ENUM trailing spaces | FIXED | located SEM036, exact members preserved |
| G19 partial disk output | INTENTIONALLY DEFERRED | filesystem transaction design remains |
| G20 corrective coverage | FIXED | baseline failures + focused/compatibility/full suites |
| G21 stale Node requirement | FIXED | Node18 in current/generated docs/package |
| G22 effective target plan | PARTIALLY FIXED | shared keys/names/preflight/roles; broader unified plan deferred |
| G23 BOOLEAN reads | FIXED | all row-returning paths, null/INT preservation |
| G24 DATE/TIMESTAMP | INTENTIONALLY DEFERRED | product capability outside V1 hardening |
| G25 UUID | INTENTIONALLY DEFERRED | product capability outside V1 hardening |
| G26 migrations | INTENTIONALLY DEFERRED | product capability outside V1 hardening |
| G27 PostgreSQL | INTENTIONALLY DEFERRED | product capability outside V1 hardening |
| G28 imports/modules | INTENTIONALLY DEFERRED | product capability outside V1 hardening |

## 14. Remaining open work

G06 richer DB errors, G16 complete server storage capacity, G19 atomic disk
publication, G22 broader schema planning, G24–28 new capabilities remain.
Fresh isolated G19 reproduction obstructed config/db.js with a regular config
file: generation rejected after schema.sql changed. This confirms partial disk
output remains observable; target-preflight failures themselves preserve output.
No transactional filesystem redesign is claimed. Live MySQL verification and
full independent OAS validation are explicit evidence limitations. No known
unresolved correctness finding remains inside the authorized fixed subset.

## 15. Protected integrity

All 36 protected files retain exact relative paths, sizes, SHA256, creation and
modification UTC timestamps against the external pre-run manifest. Compared at
every milestone and final boundary with tests/verify-protected-artifacts.ps1.
The only untracked roots remain APIForge_Drive_Resources.zip,
APIForge_Drive_Resources/, APIForge_Overleaf_Source/ and
APIForge_Overleaf_Source__FINAL.zip. Never staged or regenerated. Historical
reports, fixture JSONs, package-lock and repository output unchanged from base.

## 16. External review readiness

Independent read-only target and fidelity reviews found additional private
column/parser and reserved-word defects; both were corrected and pinned in the
final suite. Parent review additionally corrected association/FK/schema-role
edges. Full verification passed after corrections. Branch is ready for external
review with the explicit residuals above. Only ordinary pushes of
origin/apiforge-v1-hardening are authorized/performed. Main remains a016868,
no force push, merge, PR or history rewrite. Final clean/pushed hashes are
verified after the report commit and recorded in the completion response.

## Post-audit external review correction: AUTO_INCREMENT create identity

2026-10-02. External review of completed HEAD
`ab2cd493abf30a711c59b1c574886c949acf7221` found a blocking edge: the emitted
resolver prioritized every supplied explicit PK, so successful auto INT creates
with `{id:null}` or `{id:0}` could return null/zero despite insertId42. Pinned
ab2cd49 generated-model tests reproduce both failures. This supplements the
previous audit evidence; historical milestone verification files remain intact.

The resolver now uses the actual ResultSetHeader.insertId for a supplied own
key whose metadata is explicit/autoGenerated and whose value is null or numeric
zero. AutoGenerated is true only for INT keys without DEFAULT. The INSERT payload
and query count remain unchanged; no input mutation or reread is added.

| Input / key kind | Header insertId | Returned identity |
|---|---:|---|
| explicit auto INT, null | 42 | 42 |
| explicit auto INT, 0 (generation path) | 42 | 42 |
| explicit auto INT, 0 (stored zero) | 0 | 0 |
| explicit auto INT, supplied 100 | 999 (deliberately different mock) | 100 |
| implicit / explicit auto INT omitted | 42 | 42 |
| explicit INT DEFAULT / STRING / STRING DEFAULT | unchanged mocks | existing supplied/default precedence |

The [MySQL AUTO_INCREMENT reference](https://dev.mysql.com/doc/refman/8.0/en/example-auto-increment.html)
documents null generation, zero generation unless NO_AUTO_VALUE_ON_ZERO, and
nonzero explicit values. Stored zero is modeled with header insertId0; the
resolver does not infer a SQL mode from request data or query session state.
Tests use successful header simulations, not live MySQL persistence evidence.
Generated schema assumptions exclude application-added triggers that rewrite
ordinary supplied identities; no new trigger contract is claimed.

Optional-null request validation is unchanged, auto keys are not made REQUIRED,
nonzero caller keys retain precedence, and PUT rejects own key properties before
model/SQL access. OpenAPI Create remains nullable for non-REQUIRED keys;
CreateResult's explicit auto INT key is nonnullable after successful resolution.
Defaulted/non-generated CreateResult schemas and all Read/Update contracts remain
unchanged. No DSL, semantic/IR, SQL, route, status, diagnostic or dependency change.

Verification after the correction:

- npm test PASS, including all original/focused suites and unchanged frozen
  compiler/artifact fixtures. Compatibility projection admits only the exact
  resolver block and exact explanatory README sentence in addition to prior
  approved V1 differences; all other compared bytes remain enforced.
- Focused primary-key suite PASS: 10 groups / 64 actual HTTP requests. Added
  baseline defect proof and 14 real POST/PUT cases covering null, both zero
  headers, positive/negative supplied keys, omission, implicit identity,
  defaulted INT/STRING, prototype-sensitive key spelling, input preservation,
  bound payloads, REQUIRED-null rejection and response/request schema metadata.
- Final-audit suite PASS: 6 groups, including fresh compiler compatibility.
  OpenAPI fidelity suite PASS: 3 groups / 74 actual HTTP requests.
- Guide verifier PASS: 18 valid / 64 invalid; 120 generated JS parses and 82
  isolated real CLI invocations.
- Generated integration PASS on ephemeral port63355; process/project cleanup
  and repository output preservation confirmed.
- Changed and generated JS syntax checks, git diff --check and final protected
  manifest comparison PASS: all 36 paths, sizes, SHA256 and timestamps unchanged.
- LIVE MYSQL STILL UNAVAILABLE: no APIFORGE_TEST_DB_* credentials configured.

Evidence logs: `%TEMP%/apiforge-auto-identity-{before,primary,full,guide,integration}.log`.
Narrow self-review found no unresolved correctness issue in this correction.
The previously documented remaining work and evidence limits still apply.

Corrective commit: the single commit immediately after ab2cd49 titled
`fix: resolve AUTO_INCREMENT create identity for NULL and zero`, containing this
addendum (`ab2cd49..HEAD`). Its concrete SHA is recorded in the completion
response after commit; a document cannot embed its own containing commit hash.
Only origin/apiforge-v1-hardening is pushed. Main stays
`a0168682254550dc99fa8782f14f2827402852b9`; no merge, force push, topology repair
or protected staging. Ready for external re-review after verification and push.

## External re-review correction: supported AUTO_INCREMENT value and bound contract

2026-10-02. Re-review at `ff3dbde10ad07ca52b60eccb8828fb6d33a9c54c` confirmed
the preceding NULL/zero resolver fix and found two adjacent issues. General
safe-integer validation allowed negative explicit auto INT POST keys; target
preflight allowed MIN/MAX to generate CHECKs on the AUTO_INCREMENT key.
[MySQL InnoDB documentation](https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html)
defines negative AUTO_INCREMENT assignment as undefined; [CHECK rules](https://dev.mysql.com/doc/refman/8.0/en/create-table-check-constraints.html)
exclude AUTO_INCREMENT columns. These references establish target restrictions,
not a claim of live DB verification.

The generated controller now rejects negative safe integers on source-declared
explicit auto-generated INT keys during POST, after the existing type check:
`Field '<key>' must be zero or a positive integer.` HTTP400 occurs before model
or DB access. The accepted domain is omission, null under existing optional-null
rules, numeric zero and positive safe integers. Nonzero positive supplied keys
retain precedence; null/zero still use the actual insertId, including header0
for stored zero under NO_AUTO_VALUE_ON_ZERO. Ordinary INT fields and explicit
INT PKs WITH DEFAULT retain negative values. PUT immutability and implicit id
behavior are unchanged. Direct model general write validation is not redesigned.
The preceding addendum's negative auto-key acceptance expectation is superseded;
its regression case now checks a non-auto INT DEFAULT key, with a pinned
ff3dbde negative-auto failure proof retained separately.

Shared MySQL target preflight emits existing SEM037 / MYSQL_TARGET_LIMIT when
an explicit INT PRIMARY KEY has no DEFAULT and declares MIN and/or MAX.
The diagnostic explains the unrepresentable CHECK and points to the first
MIN/MAX modifier including its value; combined MIN/MAX produces one coherent
target diagnostic. A specific hint suggests removing bounds or declaring an
explicit DEFAULT for a non-auto key. Semantic rejection precedes IR/codegen;
direct IR codegen repeats preflight before any disk writes. Bounds are never
silently removed. Ordinary numeric bounds, valid bounded INT DEFAULT keys and
STRING PK length bounds remain supported with unchanged SQL.

Operation Create/CreateResult/Read schemas use minimum0 for explicit auto INT
keys. Create retains existing nullable/REQUIRED behavior, CreateResult remains
nonnullable, and Update omits the immutable PK. Legacy source-name component
schemas are unchanged. No syntax, type, parser/IR shape, dependency, route,
resolver, diagnostic mapping or warning mapping changes.

Corrective proofs and verification:

- Pinned ff3dbde generated controller accepts `{id:-5}`, reaches model/SQL and
  returns -5; corrected real HTTP tests reject id/code/prototype-sensitive auto
  key spellings with HTTP400 and zero model/DB calls. General type errors retain
  precedence; ordinary negative INT and negative INT DEFAULT keys pass.
- Pinned ff3dbde target checker permits MIN/MAX and its SQL emitter produces
  AUTO_INCREMENT plus CHECK. MIN, MAX, both and reversed source order now give
  one located SEM037. Actual compiler HTTP returns422 with IR/optimizer/codegen
  skipped; CLI exits1 with no output; direct IR generation cannot write output.
- All 66 diagnostics and WRN001–005 compare exactly with ff3dbde registries.
- Focused primary-key suite PASS: 11 groups / 67 actual HTTP requests, retaining
  NULL/zero, positive/omitted identity, reviewed G12/G13, immutability, input
  preservation and defaulted key coverage.
- MySQL-target suite PASS: 6 groups. OpenAPI-fidelity PASS: 3 groups / 74 actual
  HTTP requests. Final-audit PASS: 6 groups, including six-phase compatibility.
- Final npm test PASS across the complete existing and hardening suites. Frozen
  fixture JSONs are unchanged; the compatibility projection additionally admits
  only the exact new negative-key validation line and README paragraph.
- Guide verifier PASS: 18 valid / 67 invalid, 120 generated JS parses, 85
  isolated CLI invocations. New MIN/MAX examples assert SEM037.
- Generated integration PASS on ephemeral port53634, dependency installation,
  startup/health and process/project/output cleanup verified.
- All changed JS node --check, generated JS checks and git diff --check PASS.
  Protected manifest comparison PASS: 36 paths, sizes, SHA256 and creation/
  modification timestamps unchanged; protected artifacts never staged.
- Live MySQL remains UNAVAILABLE: APIFORGE_TEST_DB_* credentials absent.

Evidence: `%TEMP%/apiforge-auto-contract-{before,full,guide,integration}.log`.
Narrow self-review found no unresolved correctness finding in this correction.
Historical milestone reports remain unchanged. Previous residuals remain as
documented; this is not a general storage-limit or security certification.

Corrective commit: the single successor to ff3dbde titled
`fix: enforce supported AUTO_INCREMENT input and bound contract`, containing
this addendum. Concrete committed local/remote hashes are verified and reported
after ordinary push to origin/apiforge-v1-hardening. Main remains
`a0168682254550dc99fa8782f14f2827402852b9`; no merge, main push, force push,
history repair or protected staging. Ready for final external re-review.
