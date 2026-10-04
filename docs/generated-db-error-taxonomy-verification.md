# G06 generated database error taxonomy verification

## Audit before implementation

Audited approved main `1a3598e70d4bfd16636514c4e3c9e1b0d7c57e46` before code edits.
Local main, origin/main and live remote main matched after fetch. V1 tag object
`2e5368620ca210cfa240b1b62faf82be99b491ea` and peeled commit
`9d5b223b0af350a237625f4cd8dfbc700e35dd1b` matched the remote. Tracked
worktree/index were clean; only the four approved protected roots were untracked.
All 36 protected files were snapshotted with path, size, SHA-256 and timestamps
in the task-specific temporary manifest and verified with the existing workflow.

Current authority was `src/codegen/codegen.js`, `openapi-fidelity.js`, emitted
controllers/models/server, and request-validation, collection-query,
relationship-safety, openapi-fidelity and primary-key-contract tests.

| Area | Observed pre-G06 behavior |
|---|---|
| Create / update catches | Sanitized 500, respectively `Unable to create item.` / `Unable to update item.` |
| Collection catch | Exposes error.message for any statusCode=400; otherwise sanitized collection-specific 500 |
| Item / delete catches | Sanitized 500 `Unable to complete request.` |
| All four relationship reads and association add/remove catches | Sanitized 500 `Unable to complete request.` |
| Global Express handler | entity.parse.failed -> safe 400; other errors -> generic 500; server-side stack logging |
| CRUD models | Parameterized pool.query; create uses insertId; update rereads; absent item/update/delete -> existing 404 |
| Relationship models | Parameterized SELECT/INSERT/DELETE; list absence -> []; singular absence -> null/404; remove remains successful even if no association |
| Collection validation | parseQuery throws Error with statusCode=400 before SQL; findAll/countFiltered propagate driver errors |
| OpenAPI | .Error envelope for existing 400/404/500; no 409/503 |

Emitted-runtime reproduction: ER_DUP_ENTRY/1062 on create returned 500. A
collection DB Error with statusCode=400 exposed `private sql/table from spoof`.
No code/errno classification existed. Existing write and malformed JSON
validation were already safe and occurred before DB access.

Installed mysql2 is 3.23.4 (manifest ^3.23.4). Its packet.asError assigns code,
numeric errno, sqlState, sqlMessage and Error.message. The promise wrapper
preserves the original driver error. Its errors.js constants were inspected for
every included server identifier. Connection/query driver source confirms
PROTOCOL_CONNECTION_LOST, ETIMEDOUT and PROTOCOL_SEQUENCE_TIMEOUT; socket errors
retain Node machine-readable codes. Pool closed/queue-limit errors have no stable
code and must remain 500. Authentication/configuration errors must remain 500.

Identifiers also checked against the [official MySQL 8.4 server error reference](https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html).
In particular 1265 is WARN_DATA_TRUNCATED, not an invented ER_* alias.

## Final public taxonomy and exact identifiers

| Condition | HTTP | Safe client text |
|---|---:|---|
| Generated request validation, including malformed JSON | 400 | Existing generated validation message; malformed JSON: `Request body must contain valid JSON.` |
| Missing CRUD/item or singular related record | 404 | Existing `<Entity> not found` |
| Recognized write/delete conflict | 409 | `Request conflicts with existing data.` |
| Recognized rejected value on CRUD or association write | 400 | `Request contains a value rejected by the database.` |
| Recognized temporary connection/capacity/lock failure | 503 | `Database temporarily unavailable.` |
| Unknown/internal or inapplicable DB classification in controllers | 500 | `Unable to complete request.` |
| Any non-parser error in the generic global Express fallback | 500 | `Internal Server Error` |

| Category | error.code | Numeric MySQL errno alias |
|---|---|---:|
| Conflict | ER_DUP_ENTRY | 1062 |
| Conflict | ER_NO_REFERENCED_ROW | 1216 |
| Conflict | ER_ROW_IS_REFERENCED | 1217 |
| Conflict | ER_NO_REFERENCED_ROW_2 | 1452 |
| Conflict | ER_ROW_IS_REFERENCED_2 | 1451 |
| Rejected value | ER_BAD_NULL_ERROR | 1048 |
| Rejected value | ER_NO_DEFAULT_FOR_FIELD | 1364 |
| Rejected value | ER_DATA_TOO_LONG | 1406 |
| Rejected value | ER_WARN_DATA_OUT_OF_RANGE | 1264 |
| Rejected value | ER_CHECK_CONSTRAINT_VIOLATED | 3819 |
| Rejected value | WARN_DATA_TRUNCATED | 1265 |
| Rejected value | ER_TRUNCATED_WRONG_VALUE | 1292 |
| Rejected value | ER_TRUNCATED_WRONG_VALUE_FOR_FIELD | 1366 |
| Temporary | ER_CON_COUNT_ERROR | 1040 |
| Temporary | ER_TOO_MANY_USER_CONNECTIONS | 1203 |
| Temporary | ER_LOCK_WAIT_TIMEOUT | 1205 |
| Temporary | ER_LOCK_DEADLOCK | 1213 |
| Temporary | ECONNREFUSED, ECONNRESET, EPIPE, ETIMEDOUT | None; platform errno is not aliased |
| Temporary | PROTOCOL_CONNECTION_LOST, PROTOCOL_SEQUENCE_TIMEOUT | None |

Recognized string code takes precedence. Numeric aliases apply only when code is
null/absent, with a numeric errno. Unknown present codes, stringified errnos,
arbitrary statusCode values, SQLSTATE and message text have no authority.
There is no message/SQL parsing or public database code. Warnings only map if the
driver actually throws them as errors; ordinary warning packets are unchanged.

## Architecture and endpoint coverage

`src/codegen/db-error-taxonomy.js` is the single compiler-side mapping and handler
emitter. Controllers embed its implementation; the generic global Express handler
does not emit or invoke it. No fixed
runtime file or dependency was added: seven fixed files plus three per entity
remains the contract. SQL, routes, writable fields, effective keys, all six
compiler phases, diagnostics/warnings and successful handler bodies remain intact.

Classification uses operation context: reads cannot create conflicts and a read
failure does not establish invalid client input. A recognized conflict/value code
on a read remains internal 500. DELETE accepts conflicts, while general CRUD
DELETE retains its existing absence/error status set. Association POST/DELETE
can reject bound URL values and use the association context. The DB taxonomy is
applied only at trusted generated controller/model operation boundaries. The
generic global fallback has no database provenance: matching code/errno values
do not establish that an error originated in a generated database operation.
Malformed JSON remains safe global 400 with `Request body must contain valid JSON.`;
every other global error retains existing server-side stack logging and returns
sanitized 500 with `Internal Server Error`, regardless of code/errno.
This restores the exact pre-G06 global response envelope; the controller 500
message remains `Unable to complete request.`. Endpoint OpenAPI is unchanged.

Each model keeps a private WeakMap from errors created by parseQuery to the
original generated message. The controller consults the registry only inside
the parseQuery boundary. Neither statusCode alone nor a spoofed marker exposes
text. Mutating a genuine validation Error.message cannot change its registered
message, and rethrowing that genuine error from findAll/countFiltered remains a
sanitized 500. Existing pre-DB write validation and ordering are unchanged.

| Operation | Successful status | Applicable failure statuses in OpenAPI/runtime |
|---|---:|---|
| Collection GET | 200 | 400, 500, 503 |
| Item GET | 200 | 404, 500, 503 |
| Create POST | 201 | 400, 409, 500, 503 |
| Update PUT | 200 | 400, 404, 409, 500, 503 |
| CRUD DELETE | 200 | 404, 409, 500, 503 |
| ONE_TO_MANY GET | 200 | 500, 503 |
| MANY_TO_ONE GET | 200 | 404, 500, 503 |
| ONE_TO_ONE GET | 200 | 404, 500, 503 |
| MANY_TO_MANY GET | 200 | 500, 503 |
| MANY_TO_MANY association POST | 201 | 400, 409, 500, 503 |
| MANY_TO_MANY association DELETE | 200 | 400, 409, 500, 503 |

OpenAPI still references `.Error`, containing exactly `success` and `error`.
No raw driver schema, implementation code, SQLSTATE or public error ID was added.
List absence remains successful `[]`; removing an absent association remains the
existing 200 message. Ordinary item/update/delete and singular relation absence
remain 404.

## Deterministic safety and compatibility evidence

`npm run test:db-error-taxonomy` executes real emitted servers, routers, controllers
and models with a deterministic pool across all four cardinalities. Independent
expected mappings assert the installed mysql2 numeric constants, every code and
every included errno alias. The corrected suite has 1,436 error-envelope assertions
and 1,515 actual HTTP requests, including:

- duplicate create/update/association and both FK conflict directions;
- all eight invalid-value identifiers and all ten temporary identifiers;
- private email/value, table/index/constraint, SQL, SQLSTATE, hostname/port and
  credential-like driver text reduced to exact generic envelopes;
- unknown errors, message-only duplicate spoofing, unknown code plus known errno,
  string errno, statusCode/marker spoofing, auth errors and uncoded pool failures;
- model calls/SQL prevented for invalid bodies, queries and malformed JSON;
- registry provenance, mutated validation messages, parser spoofing, and genuine
  query errors rethrown from findAll/countFiltered;
- transient failures at collection COUNT; the same objects in the global Express
  fallback instead return sanitized 500;
- arbitrary global errors, ECONNREFUSED, ER_CON_COUNT_ERROR/1040,
  ER_DUP_ENTRY/1062, errno-only 1205 and ER_DATA_TOO_LONG/1406 return global 500;
  the same errors retain their applicable controller 409/400/503 mappings;
- global response privacy, zero DB calls and exact existing server-side stack
  logging; malformed JSON retains global 400;
- CRUD and singular relationship 404, and unchanged absent-association success;
- exact operation error-response sets and the unchanged `.Error` schema;
- byte-identical successful JSON and pagination headers against approved main.

For each of the four cardinalities, every non-server generated file is also
compared byte-for-byte with the approved G06 commit
`20d3d656cbb642a500c2d10fd2a3f945f8cfc7ff`. This includes all controllers, models,
routes, classifier output and OpenAPI. Generated server.js is byte-identical to
the pre-G06 server; no taxonomy helper remains in it.

Compatibility projections compare every byte outside exact G06 helper,
catch/parse boundary, provenance, OpenAPI additions and generated README changes
with approved main before applying older reviewed projections. Frozen fixtures
were not refreshed. The publication suite compares seven valid sample projects /
79 generated files with frozen V1 outside G06, then verifies current disk bytes
exactly match current in-memory output. Existing phase/registry checks still run.

## Regression results

The required checks below were rerun for the global provenance correction. Its
focused suite includes 60 sanitized global-500 requests across all cardinalities,
and pairs recognized identifiers with trusted controller/COUNT operations using
the same Error objects.

| Check | Result |
|---|---|
| npm test | PASS: all chained suites, including G06; core 1,060 passed / 0 failed |
| npm run test:disk-generation | PASS: disk regression and 22 atomic-publication groups |
| node docs/verify-language-guide.js | PASS: 18 valid and 67 invalid examples; 120 generated JS files; real CLI cases |
| npm run test:generated-integration | PASS: generated dependency install, start, health and process/project/output cleanup |
| git diff --check | PASS |
| Existing request validation | PASS: 9 groups, 848 controller writes, 43 HTTP requests |
| Existing primary-key contract | PASS: 11 groups, 67 HTTP requests |
| Existing collection-query, ENUM and compatibility suites | PASS in npm test |
| Existing relationship safety | PASS: 3 groups, 30 emitted helper calls |
| Existing OpenAPI fidelity | PASS: 3 groups, 74 HTTP requests |
| Existing generated naming / MySQL target / V1 final audit | PASS: 5 / 6 / 6 groups |

Atomic-publication tests conditionally skip unavailable Windows file/directory
symlink creation (EPERM); the creatable junction variant passed. Generated
integration demonstrates install/start/health, not live persistence.

## Live MySQL evidence and limitations

Docker CLI is installed, but `docker version` and `docker ps` cannot connect to
the Docker Desktop Linux engine pipe; no daemon was available. All four
APIFORGE_TEST_DB_* configuration names are present, but the actual mysql2
connection probe returned ECONNREFUSED/-4078. Server version could not be read.
No MySQL 8.4.x version or live constraint result is claimed.
The corrective task rechecked Docker and made a fresh mysql2 connection probe:
the daemon pipe remained unavailable and the configured server again returned
ECONNREFUSED/-4078. Live constraint verification remains pending.

Both `npm run test:db-error-taxonomy-mysql` and `npm run test:generated-mysql`
were attempted and failed at server connection with ECONNREFUSED, before any
CREATE DATABASE. No database or container was created or modified.

The new opt-in G06 live harness is ready for a configured server and remains
outside npm test. It allocates only validated disposable apiforge_e2e_* names,
imports emitted schema, uses session strict mode, observes actual code/errno and
asserts safe HTTP responses for duplicate UNIQUE/create/update/association,
missing-row FK, oversized VARCHAR, INT storage overflow, no-default and null
violations. It adds an explicitly supplemental restrictive FK and narrower CHECK
only inside that disposable DB to reach delete/CHECK failures through real
routes; generated relationships cascade and generated declared CHECK bounds are
normally stopped by pre-DB validation. The harness drops and verifies removal of
its own database. This live harness is unverified beyond the connection preflight
until a real server is available.

Lock/connection failures are deterministically tested; no retry middleware,
transaction retry, Retry-After policy, new validation rules or status-driven
recovery guarantee is introduced. Unrecognized/version-specific DB identifiers,
authentication/configuration, SQL syntax/missing tables and uncoded pool errors
remain internal 500. Non-strict MySQL can accept/coerce some invalid values;
the supported target continues to require strict mode.

## Files and review state

Runtime generation: `src/codegen/db-error-taxonomy.js`, `src/codegen/codegen.js`,
`src/codegen/openapi-fidelity.js`.

Tests/commands: `package.json`, `tests/db-error-taxonomy.test.js`,
`tests/db-error-taxonomy-mysql.test.js`, `tests/db-error-taxonomy-test-helpers.js`,
`tests/hardening-compatibility.js`, `tests/atomic-output-publication.test.js`,
`tests/collection-query.test.js`, `tests/request-validation.test.js`,
`tests/primary-key-contract.test.js`.

Documentation: this report, `README.md`, `docs/APIForge-Language-Guide.md`, and
`.codex/skills/apiforge-generated-backend/references/generated-project-contract.md`.

External review of original G06 commit
`20d3d656cbb642a500c2d10fd2a3f945f8cfc7ff` found a blocker: the global fallback
called sendDatabaseError for unprovenanced application/middleware errors, so an
arbitrary ECONNREFUSED error became a misleading database-unavailable 503.
The corrective commit restores the pre-G06 global 500 envelope, removes the
unused generated server classifier and changes global provenance tests. The
approved controller classifier and endpoint OpenAPI remain unchanged.
The original commit is preserved; correction is a new local commit.
The pending live verification is explicitly retained as a limitation. All 36
protected paths, sizes, SHA-256 digests, creation and modification timestamps
passed the task-specific before/after workflow. Main/origin/main and both local
and remote V1 tag identities remain unchanged. Work stays on
`g06-generated-db-error-taxonomy`, committed locally for external review, with
no branch push, merge, release or tag modification.
