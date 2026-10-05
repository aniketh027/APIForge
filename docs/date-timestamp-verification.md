# G24 DATE and TIMESTAMP verification

Verified 2026-10-05 on branch `g24-date-timestamp-types`, from approved main
`9ef005e18e875bdd83e3b73665c931588aa01ccf`. Local main, fetched origin/main and
live remote main matched. Frozen v1.0.0 tag object was
`2e5368620ca210cfa240b1b62faf82be99b491ea`, peeled commit
`9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. The tracked worktree/index were clean;
only the four approved protected roots were untracked. All 36 protected files
were snapshotted by path, size, SHA-256, creation and modification timestamps.

## Current-main audit before implementation

Current repository implementation, tests and emitted consumer files were the
authority. These are the complete audited type assumptions and outcomes:

| Surface | Baseline assumption | G24 outcome |
|---|---|---|
| `src/lexer/lexer.js` DATA_TYPES | Five uppercase keywords; case-sensitive | Shared explicit seven-type set; lower/mixed case remains identifiers |
| `src/parser/parser.js` DATA_TYPES and allowed-type diagnostics | Five types, hardcoded list | Shared set and seven-type diagnostic list; existing codes preserved |
| `src/ast/ast.js` FieldNode | Generic dataType and typed default | Same public shape; STRING temporal defaults, literal source metadata |
| `src/semantic/analyzer.js` RESERVED_WORDS/VALID_DATA_TYPES | Separate five-type lists | Seven keywords/types; no new name syntax |
| Semantic primary keys | INT/STRING whitelist | Unchanged; temporal keys fail SEM011 |
| Semantic validation modifiers | MIN/MAX numeric; lengths STRING-only | Unchanged guards reject temporal bounds, SEM015/SEM016 |
| Semantic DEFAULT | Five datatype branches and typed literals | Shared strict temporal validation; SEM021/SEM038 at DEFAULT literal |
| Semantic symbol table | Copies generic dataType/default | DATE/TIMESTAMP and canonical STRING default preserved |
| `src/utils/diagnostics.js` | Highest semantic code SEM037; 66 errors | Append SEM038 only; 67 total; warnings unchanged |
| `src/ir/generator.js` lowering | Generic dataType/default; enum source metadata | Same existing literal representation; temporal metadata retained |
| IR validation | Any nonempty datatype string accepted | Explicit supported seven-type set; temporal defaults/PK/bounds rejected if forged |
| `src/optimizer/optimizer.js` all six passes | Opaque types; compare exact defaults/constraints | No production edit needed; preservation/conflict regressions added |
| `src/utils/mysql-target.js` | Numeric/STRING capacity/index and identifier checks | Audited unchanged; temporal widths/keys do not extend its rules |
| `src/codegen/codegen.js` MySQL type map | Four primitive entries plus ENUM branch | DATE→DATE, TIMESTAMP→TIMESTAMP; no DATETIME substitution |
| SQL default formatting | Generic STRING escaping | DATE quoted unchanged; TIMESTAMP canonical converted to SQL UTC text |
| Target preflight | Validates IR before extraction and target-specific checks | Unknown/invalid temporal IR fails before target output/publication |
| Generated request validation | Five switch branches, own-key authority | Strict temporal branches, shared deterministic calendar validators |
| Collection parsing/binding/sort | Numeric/boolean/enum special parsing, STRING passthrough | Strict temporal parse, private TIMESTAMP SQL binding; same trusted sorting |
| Model create/update writes | Binds provided data, echoes submitted create fields | Private validated temporal copy; req.body/data never mutated |
| CRUD read normalization | BOOLEAN-only own declared columns | DATE/string validation and TIMESTAMP SQL→T/Z; null preserved |
| Relationship read normalization | Target BOOLEAN names passed to same helper | Target temporal metadata for all four cardinalities |
| Generated `config/db.js` | mysql2/promise pool; private-column row-array wrapper | Conditional dateStrings/UTC config; awaited initialization/disposal; wrapper preserved |
| `src/codegen/openapi-fidelity.js` | Copies base property metadata into operation roles | No production edit needed; temporal schema properties propagate to every role |
| OpenAPI primitive/filter map | Five types; no temporal format | string/date or string/date-time plus pattern/description; canonical defaults |
| Generated README | Five-type writes/filters, existing create-default policy | Conditional temporal setup/representation section; policy unchanged |
| `frontend/app.js` | Generic phase datatype display, ENUM special display; SQL type highlighting | Narrow temporal example and TIMESTAMP highlighting; no redesign |
| README/language guide/repo skills | Five-type vocabulary and unsupported DATE example | Seven-type docs; DATETIME remains unsupported; verified marked examples |
| `docs/verify-language-guide.js` | Fixed 66-code count, ENUM property checks | Append-only SEM038 assertion; temporal role/default checks |
| Core/hardening/compatibility tests | Three parser list strings and several 66-code totals | Narrow expected-list/count updates; historical assignments/fixtures retained |
| Frozen fixtures and samples | Existing non-temporal compiler/generated hashes | No fixture edits or refreshes; all existing valid sample phase/output bytes match approved main |

Optimizer passes audited: constraint normalization, duplicate validation
elimination, validation order normalization, duplicate entity elimination,
duplicate field elimination and duplicate relationship elimination. None has a
five-type whitelist. Normalization preserves non-enumerable source descriptors;
duplicate comparison preserves typed defaults and detects conflicting values.

## Language and public JSON contract

```apiforge
ENTITY Event
id INT PRIMARY KEY
eventDate DATE REQUIRED
startDate DATE UNIQUE DEFAULT "2026-01-01"
createdAt TIMESTAMP
publishedAt TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"
```

DATE is a JavaScript string in exactly `YYYY-MM-DD` form, inclusive range
`1000-01-01`–`9999-12-31`. TIMESTAMP is a JavaScript string in exactly
`YYYY-MM-DDTHH:mm:ssZ` form, inclusive UTC range
`1970-01-01T00:00:01Z`–`2038-01-19T03:14:07Z`. Uppercase Z and second precision
are mandatory. Numeric values, Date objects, offsets, fractions, local timestamps,
whitespace and relaxed MySQL syntax are rejected. Explicit Gregorian validation
checks months, days, century/400-year leap rules, hours 00–23 and minutes/seconds
00–59. No Date parsing, locale or host timezone participates.

Both types support REQUIRED, UNIQUE and quoted canonical static DEFAULT strings.
Defaults remain typed STRING literals in AST, symbols and IR. Wrong primitive
defaults retain SEM021. SEM038 (`INVALID_TEMPORAL_DEFAULT`) reports malformed,
calendar-invalid or out-of-range strings at the literal, with format/range text.
No existing diagnostic code was changed. Duplicate constraints/defaults retain
SEM009/SEM020. Temporal PRIMARY KEY remains invalid (SEM011); MIN/MAX and
MIN_LENGTH/MAX_LENGTH remain invalid (SEM015/SEM016).

Dynamic `DEFAULT CURRENT_TIMESTAMP`, `DEFAULT NOW()`, `ON UPDATE`, automatic
createdAt/updatedAt fields, DATETIME/TIME/YEAR/UUID, migrations, range filters,
date arithmetic, timezone libraries and new runtime dependencies remain out of scope.

## SQL, driver and UTC strategy

DATE and TIMESTAMP map to their actual MySQL types without fractional precision.
DATE defaults remain `DEFAULT 'YYYY-MM-DD'`; TIMESTAMP defaults become
`DEFAULT 'YYYY-MM-DD HH:mm:ss'`. Before TIMESTAMP DDL the complete generated
schema runs:

```sql
SET SESSION time_zone = '+00:00';
SET SESSION explicit_defaults_for_timestamp = ON;
```

The first setting preserves the exact declared UTC instant during import. The
second prevents MySQL's legacy first-TIMESTAMP implicit CURRENT_TIMESTAMP and
ON UPDATE behavior, reproduced live with the setting OFF. Optional TIMESTAMP
columns explicitly use NULL. Required columns use NOT NULL. No automatic
temporal default or update attribute is generated. Import the complete schema;
extracting individual CREATE statements discards these session guarantees.

[MySQL's temporal type reference](https://dev.mysql.com/doc/refman/8.4/en/datetime.html)
documents TIMESTAMP's session-zone conversion and storage ranges.
[Automatic timestamp initialization](https://dev.mysql.com/doc/refman/8.4/en/timestamp-initialization.html)
documents the legacy implicit attributes and explicit-default setting.

Installed mysql2 **3.23.4** source was audited directly:

| Installed source | Verified behavior |
|---|---|
| `lib/connection_config.js:123,130–162` | dateStrings selection; timezone parsing/serialization only, no session time_zone initialization |
| `lib/parsers/static_text_parser.js:60–70` | DATE/TIMESTAMP ASCII strings when selected by dateStrings |
| `lib/parsers/static_binary_parser.js:52–60` | Prepared results use Packet.readDateTimeString under dateStrings |
| `lib/packets/packet.js:329–369`, `lib/helpers.js:56–64` | DATE-only/SQL timestamp string construction and selective type matching |
| `lib/promise/pool.js:24–35` | getConnection resolves an exclusively checked-out PromisePoolConnection |
| `lib/promise/connection.js:27–45`, `lib/promise/make_done_cb.js:5–12` | Awaited query resolves only after successful server result; errors reject |
| `lib/base/pool.js:73–109` | Pool connection event does not await asynchronous listeners |
| `lib/base/pool_connection.js:61–74` | destroy removes a connection from the pool; release after destruction is harmless |
| `lib/base/pool.js:232–309` | Native pool disposes selected read-only/failover failures |

Temporal programs configure `timezone: 'Z'` and `dateStrings: ['DATE', 'TIMESTAMP']`.
The exported promise pool wraps getConnection: await acquisition, await
`SET SESSION time_zone = '+00:00'`, then return the lease. Every reuse repeats
initialization, so a previous borrower's altered session is corrected. Failure
destroys the connection and propagates the error before any application query.
query/execute use that initialized lease and release it after completion. Failed
application queries conservatively destroy their lease, retaining driver error
codes for the unchanged G06 classifier. No fire-and-forget event initialization
is used. Numeric `+00:00` needs no named time-zone tables.

The existing prototype-sensitive column wrapper remains outside the awaited
query wrapper: rowsAsArray plus disableEval precedes Object.fromEntries. No
temporal runtime file or dependency is added. Non-temporal generated projects
retain their original configuration and artifact bytes.

## Reads, writes, collection queries and OpenAPI

Read normalization receives trusted declared field names/types for the source
or relationship target. DATE stays `YYYY-MM-DD`; TIMESTAMP SQL text becomes
`YYYY-MM-DDTHH:mm:ssZ`; null stays null. STRING fields resembling timestamps stay
untouched. Unexpected Date objects/invalid database temporal values fail safely
instead of leaking platform-dependent serialization. Collection, item, update
reread, ONE_TO_MANY, MANY_TO_ONE, ONE_TO_ONE and MANY_TO_MANY all use this helper.

Controller validation operates on canonical public values before model access.
Models also validate direct temporal write values, then convert only a private
copy to SQL form. Caller data, req.body, create responses and canonical defaults
stay unchanged. Optional null is supported; REQUIRED null is rejected. Supplied
create fields are echoed; omitted database-default fields are not invented or
reloaded, preserving the existing general default/create-response policy.

Exact equality filters use the same validator as HTTP bodies. Invalid values
return safe HTTP 400 before pool acquisition; valid TIMESTAMP binds SQL UTC text.
DATE/TIMESTAMP sort uses the existing field whitelist. No range operators or
null-filter syntax is added. G06 database error mappings/envelopes are unchanged.

OpenAPI DATE is string/date and TIMESTAMP string/date-time. Both include canonical
patterns and range/calendar descriptions. TIMESTAMP explicitly excludes offsets
and fractions otherwise allowed by generic date-time. Defaults use public T/Z
form. Base/Create/Update/Read/CreateResult properties and filter schemas agree;
existing success/error envelopes and status mappings are retained.

## Verification evidence and reproduction

- `npm test`: PASS, including all **1,060** core assertions and every discovered
  language/IR/optimizer/codegen/runtime/relationship/OpenAPI/G06/G19 suite.
- `npm run test:date-timestamp`: **21 groups / 1,581 counted assertions**, PASS.
  Covers A–L, exact source locations, rejected defaults/forged IR, leap/range/time
  boundaries, real generated HTTP controllers/models, direct model copying,
  prototype-sensitive fields, create-default omissions, all cardinalities,
  OpenAPI consistency, no model/SQL calls for invalid requests, init failure,
  query failure, concurrent/fresh/reused lease ordering and four Node TZ values.
- TZ subprocesses: UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Kiritimati.
  Validation, SQL defaults, bindings and public reads are identical.
- `npm run test:disk-generation`: PASS; G19 **22 groups**, disk/memory compatibility
  across seven sample projects/79 files; Windows junction preservation PASS.
  Three unprivileged symlink variants are conditionally skipped with EPERM.
- `node docs/verify-language-guide.js`: PASS; **19 valid / 73 invalid** examples,
  **125 generated JS** parsed, all examples also exercised through the real CLI.
- `npm run test:generated-integration`: PASS; installed generated dependencies,
  npm-start/health verified, process/port/temp project/output cleanup verified.
- `git diff --check`: PASS.

No historical fixture was regenerated. Dedicated compatibility compares all
existing valid non-temporal samples' lexer/AST/semantic/IR/optimized IR and every
generated byte with approved current main. Existing frozen V1/hardening
compatibility gates also pass. Intentional differences affect temporal programs
and seven-type parser prose/append-only diagnostic totals only.

## Live MySQL evidence

The configured endpoint refused connections; the running native MySQL service
rejected the supplied test credentials. Docker fallback succeeded with MySQL
**8.4.11**, default/global/session timezone **+05:30**, on an isolated ephemeral
port. Every harness run created and removed only a guarded disposable database;
no persistent database was used. Secrets were passed through process environment
and were never printed or written to source/evidence files.

`npm run test:date-timestamp-mysql` passes **431 checks per run** under Node
America/Los_Angeles and Asia/Kolkata. Each run observes **25 real application
queries / 25 poisoned acquisitions / three MySQL connection IDs**, including
fresh and reused sessions. The harness deliberately sets each lease to +05:30
before generated initialization and verifies +00:00 before every app query.
It imports the complete schema from +05:30 with explicit defaults OFF, then
asserts UTC, explicit defaults ON, and no implicit required TIMESTAMP default/update.

Live checks cover information_schema DATE/TIMESTAMP types; exact static defaults;
create/read/update/filter/sort; both DATE bounds and both TIMESTAMP bounds;
REQUIRED/UNIQUE behavior; all four relationship target reads; prototype-sensitive
temporal columns; prepared-execute strings; optional null; canonical create
echoes and omitted defaults. Invalid temporal writes/filters cause **zero pool
acquisitions and zero application SQL**. Explicit UTC/+05:30 observer sessions
show different SQL display strings for the same TIMESTAMP but identical stored
epoch; the generated API returns the declared UTC instant in both Node timezones.
Each run verifies DB/server/port cleanup and unchanged repository output.

The existing `npm run test:generated-mysql` live gate also passes on this server
for non-temporal CRUD, native ENUM, typed collection filters/sorting/pagination,
header/body compatibility and injection isolation. `npm run
test:db-error-taxonomy-mysql` passes **10 real classified failures**, including
duplicate POST/PUT/association conflicts, missing-target/restrictive-delete FK
conflicts, rejected long/range/required/null values and CHECK violation. Existing
safe 409/400 envelopes and driver identifiers are retained. Final admin inspection
confirms zero disposable test databases remain.

The opt-in harness is deterministic and runs with existing
APIFORGE_TEST_DB_HOST/PORT/USER/PASSWORD configuration. It never provisions a
server automatically. Standalone health-only checks and live database evidence
remain separately identified above.

## Limits and release state

DATE/TIMESTAMP do not add timezone offsets, fractions, local/numeric timestamps,
dynamic defaults, temporal bounds/keys, range filters or migrations. Existing
MySQL >=8.0.16/strict-mode/utf8mb4/InnoDB target conditions remain. Whole-row
layout and externally written invalid DB data remain database-authoritative;
invalid temporal read representations fail with safe existing runtime errors.
UTC setup adds one awaited statement per checkout. Application callers must use
the exported pool methods and must not deliberately change time_zone on an
already-held connection before their own queries.

All four protected roots / **36 files** remain unchanged by the pre/post manifest
workflow. Work is committed only on `g24-date-timestamp-types`; main and v1.0.0
are unchanged, with no branch/main push, merge or release change.
