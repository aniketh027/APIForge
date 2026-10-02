# General primary-key create/update contract verification

Verified 2026-10-02 (Asia/Calcutta), Windows PowerShell, Node v24.14.0.
Scope: G12 and G13, with directly necessary runtime key metadata and documentation.
The gap analysis and earlier verification documents remain historical evidence.

## Baseline and audit

Initial branch: main. HEAD: `63cfc0c3e070e36a4638e1e2f70b1a93b0ce6bc2`.
main equaled origin/main, ahead/behind 0/0. No applicable AGENTS.md was found.
The four protected artifact roots were the only initial untracked paths.

Before implementation, read the gap analysis, its verification, implicit-PK
verification, request-validation verification and Language Guide. Traced
getEffectiveKey, SQL PRIMARY KEY/AUTO_INCREMENT/DEFAULT, model create/update/
findById, controllers, WRITE_FIELDS, required/default validation, OpenAPI,
generated README and the historical compatibility/runtime tests.

Audit answers:

1. Implicit create used `{ ...data, id: result.insertId }`; explicit create used
   `{ key: result.insertId, ...data }`. Supplied explicit own fields won by spread.
2. All omitted key forms therefore fell back to insertId, even non-auto-generated
   defaulted INT/STRING keys. A mocked successful insertId 0 returned the wrong key.
3. Explicit INT AUTO_INCREMENT and defaulted INT/STRING keys could be omitted.
   A non-REQUIRED STRING key without DEFAULT could also reach the DB when omitted.
   REQUIRED STRING without DEFAULT was rejected on omission.
4. Both INT and STRING primary keys can carry typed DEFAULT metadata. INT DEFAULT
   is not AUTO_INCREMENT. Implicit INT and explicit INT without DEFAULT are generated.
5. Supplied explicit INT/STRING keys, including explicit AUTO_INCREMENT INT, were
   accepted on POST and generally preserved by the old response spread order.
6. Auto-generated explicit INT omission was exempt from POST REQUIRED presence.
   Supplied INT still underwent finite safe-integer validation; native DB modes
   for supplied AUTO_INCREMENT values were not certified by these checks.
7. PUT recognized every declared field in WRITE_FIELDS, including the explicit PK.
8. Model.update executed SET data WHERE original key, then findById(original key).
   The stateful baseline simulation changed old to new and returned misleading 404.
9. Request-validation tests explicitly accepted PK PUT; frozen historical fixtures
   protected generated sections. Those expectations/projections needed narrow changes.
10. Models/controllers/README can change without SQL or upstream compiler changes.
    OpenAPI schemas were audited and deliberately retained byte-identically.

## Implemented contract

G12 fixed. The generated model resolves create identity once:

1. Supplied own source-declared explicit key in sanitized POST data.
2. Otherwise insertId, only when the effective key is auto-generated.
3. Otherwise the explicit key's typed declared DEFAULT value.
4. Otherwise no invented identity; retain the database-authoritative failure path.

The generated model copies data and defines the resolved own key afterward with
Object.defineProperty. Input is not mutated; prototype-sensitive key spellings
cannot replace the response prototype. No row reread or unrelated default injection
is added. Omitted non-key defaults can remain absent from the create response.

| Key form | Successful create identity |
|---|---|
| Implicit generated id, omitted | insertId 42 -> id 42; implicit id stays non-writable input |
| Explicit INT AUTO_INCREMENT, omitted | insertId 42 -> declared key 42; not newly required |
| Explicit INT AUTO_INCREMENT, supplied 100 | 100 wins even if mocked insertId differs |
| Explicit INT DEFAULT 7, omitted/supplied 9 | 7 / 9, never provisional insertId 0 |
| Explicit STRING, supplied | Exact supplied value/source field spelling |
| Explicit STRING DEFAULT seed, omitted/supplied custom | seed / custom |
| Key after other fields | Resolved by constraint/effective metadata, never fields[0] |

G13 fixed. Primary keys are immutable via generated PUT. Any own explicit PK
property, including the same value, a different value, null, invalid type or
in-process undefined, returns HTTP 400 `{ success: false, error: "Field '<key>' is
immutable." }` before model access/SQL. Implicit id keeps its unknown-field error.

Validation order is shape, unknown own fields in Object.keys order, key immutability,
then declaration-order REQUIRED/null/type/bounds. Only one error returns. Ordinary
partial updates still update/reread by the original URL :id, including STRING keys.
Empty PUT remains allowed and only rereads; absent rows retain 404.

Defense choice: model rejection as well as controller validation. One codegen helper
emits the same PRIMARY_KEY metadata and primaryKeyUpdateError into both modules.
Direct model updates reject own effective keys, including implicit id, before SQL;
they throw the same immutable message. Public implicit requests still fail unknown
field first. Direct models remain internal methods, not a second HTTP error mapper.
WRITE_FIELDS stays the trusted create-authorized source-declared set; PRIMARY_KEY
separately carries name/origin/autoGenerated/typed default and narrows update policy.
Synthetic fields do not become writable. The installed mysql2 object formatter
also ignores inherited properties; HTTP forwarding copies only own declared values.

POST REQUIRED means REQUIRED + no DEFAULT + not generated. PUT omission remains
allowed; REQUIRED null remains rejected; optional null remains accepted on POST
and non-key PUT. PRIMARY KEY alone does not imply REQUIRED. Missing non-REQUIRED
STRING PK without DEFAULT may still fail at the DB. UNIQUE remains DB-authoritative
without prequeries. POST/PUT unexpected DB failures stay sanitized 500.

## OpenAPI and remaining scope

OpenAPI bytes/structure are preserved. Marking a shared explicit PK readOnly would
misrepresent the retained caller-supplied POST capability. Separating operation
schemas would expand this correction into broader G11 work. The Language Guide,
README and generated project contract explicitly document that reused schemas may
still expose the PK generically despite runtime PUT immutability. Partial PUT
requiredness, nullable values and broader response modeling remain G11 limitations.
Implicit id remains integer/readOnly and absent from required input.

G07/G08 relationship quoting/naming, G09 generated names, G11 broader fidelity,
G14 prototype symbol tables and G15 STRING SQL-backslash/default escaping remain
independent. Prototype-safe response handling does not repair G14's compiler
symbol/component registries. DATE/TIMESTAMP, UUID, migrations, PostgreSQL, BOOLEAN
read normalization, physical numeric preflight and other G15-G28 work are excluded.
G03-G06 fixes remain intact; general GET/DELETE/relationship raw-error paths remain
unchanged and outside this milestone. No new DSL syntax or compiler diagnostic.

## Compatibility and baseline-failure evidence

Captured tests/fixtures/primary-key-contract-compatibility.json from the pinned
baseline BEFORE generator edits. Nine programs cover implicit id, explicit INT
AUTO_INCREMENT, INT DEFAULT, STRING, STRING DEFAULT, non-first PK, ENUM, collection
and a relationship with a widened STRING parent key/implicit child.

The focused suite loads the pinned generator directly from Git history and
reproduces every captured file SHA-256. Tokens/AST/complete semantic results/IR/
optimization hashes match for every program. SQL, routes, generated package.json,
OpenAPI, server/config/environment and file lists match byte-for-byte. Only generated
models, controllers and README intentionally change. Historical fixtures are not
recaptured: a new narrow projection checks all unaffected sections against this
baseline before the existing write-validation projection checks older baselines.

Corrective assertions executed against old emitted runtime fail for both defaulted
INT and STRING keys (observed 0 instead of 7/seed), and key-changing STRING PUT
(stored key new, SELECT old, observed 404). The current emitted runtime passes.
The stateful simulator interprets the actual emitted WHERE column rather than
assuming fixture identity. Actual Express routers are exercised over loopback;
no simulation is represented as native DB persistence.

## Verification results

| Command/check | Result |
|---|---|
| npm test | PASS: main 1060/0; STRING length 25; disk generation PASS; MySQL safety PASS; diagnostics 53; warnings 26; ENUM 16; collection 9 groups; implicit PK 9 groups; request validation 9 groups; PK contract 8 groups |
| node tests/primary-key-contract.test.js | PASS: eight groups, 36 actual HTTP requests, full create matrix, own-key defense, prototype/falsy/default cases, normal/empty PUT and baseline failures |
| node tests/primary-key-contract.test.js --baseline-proof | PASS: verifies old G12/G13 fail corrective assertions before implementation |
| request-validation suite within npm test | PASS: 848 emitted-controller writes and 43 actual HTTP requests; shape/types/authority/defaults/REQUIRED/JSON/DB sanitization retained |
| implicit-PK suite within npm test | PASS: SEM033/WRN001, CRUD identity, 20 relationship variants/all four cardinalities, FK widths, routes, CLI/API/ZIP |
| node docs/verify-language-guide.js | PASS: 18 valid/60 invalid examples, 120 emitted JS parses, 78 isolated real CLI invocations, emitted create/immutable-update checks |
| npm run test:generated-integration | PASS: install/start/health, ephemeral port 54510, process/project/port cleanup and repository output preservation |
| node --check | PASS: changed JS and generated JS for all nine focused compatibility projects (also 17 request-validation projects) |
| git diff --check / staged diff checks | PASS |
| registry comparison | All 62 public error assignments, SEM033 and WRN001-WRN005 unchanged |
| protected manifest comparison | Exact match for every path, size, SHA-256, creation/last-write timestamp |
| live MySQL persistence | Unavailable: no APIFORGE_TEST_DB_* credentials configured; not run; no database created |

Counts mix groups, assertions and HTTP cases; they are not a single total. Native
MySQL default persistence, explicit supplied AUTO_INCREMENT behavior and DB modes
remain unverified. No new dependencies or dependency versions are introduced.

## Protected integrity, self-review and commits

Before edits, recursively enumerated the four protected roots with -Force and
saved absolute paths, file counts/sizes, SHA-256, CreationTimeUtc and LastWriteTimeUtc
ISO strings. The after serialization matches exactly: 36 files, 11,978,234 bytes.

| Protected root | Files | Bytes |
|---|---:|---:|
| APIForge_Drive_Resources.zip | 1 | 4267514 |
| APIForge_Drive_Resources/ | 18 | 5489267 |
| APIForge_Overleaf_Source/ | 16 | 1191761 |
| APIForge_Overleaf_Source__FINAL.zip | 1 | 1029692 |

Applied apiforge-core, apiforge-generated-backend and apiforge-change-review.
No blocking or correctness issues found in the reviewed scope. Ready for review.
Review confirmed no universal insertId fallback, spread override, first-field key
fallback, own-key update bypass, raw-body forwarding or write-error leakage. Direct
implicit model create retains its previous internal insertId behavior; HTTP implicit
id submission is rejected. General item/relationship error paths are unchanged.

Changed files: src/codegen/codegen.js; package.json (test scripts only);
tests/primary-key-contract.test.js; tests/primary-key-contract-test-helpers.js;
tests/fixtures/primary-key-contract-compatibility.json;
tests/request-validation.test.js; tests/request-validation-test-helpers.js;
README.md; docs/APIForge-Language-Guide.md; docs/verify-language-guide.js;
this document; .codex/skills/apiforge-core/references/known-behavior.md;
.codex/skills/apiforge-generated-backend/references/generated-project-contract.md.

No frontend, lexer/parser/semantic/IR/optimizer/diagnostic modules, dependency lock,
repository output or historical verification documents are changed. Protected roots
are never staged. Two scoped local commits group runtime/tests and docs/verifier;
their exact hashes, final ahead/behind and status are reported at delivery, avoiding
a self-referential documentation commit hash. No amend/squash/rebase or push.

PRIMARY KEY CONTRACT COMPLETE — READY FOR REVIEW
