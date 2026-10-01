# ENUM implementation and verification

Verified on 2026-10-01 in `C:\Project\APIForge`, using the repository's
apiforge-core, apiforge-compiler-change, apiforge-generated-backend and
apiforge-change-review skills. Implementation commit: `c408c05`.

## Result and language contract

```apiforge
ENTITY Account
id INT PRIMARY KEY
email STRING REQUIRED UNIQUE
status ENUM("active", "suspended", "closed") DEFAULT "active"
role ENUM("student", "faculty", "admin") REQUIRED
```

ENUM is an uppercase, case-sensitive datatype with a parenthesized, non-empty
list of quoted strings. Single values and multiline declarations work. Values
are unique and case-sensitive, preserve declaration order and retain literal
contents. DEFAULT must be a quoted member; REQUIRED and UNIQUE are supported.
MIN, MAX, MIN_LENGTH and MAX_LENGTH are rejected with existing type-mismatch
diagnostics. PRIMARY KEY remains INT/STRING only. Implicit-PK behavior is unchanged.

## Audit completed before editing

| Question | Finding and implementation decision |
|---|---|
| Existing punctuation | No parentheses or comma tokens existed; add only LPAREN, RPAREN and COMMA. |
| String representation | STRING_LITERAL contains contents without quotes; backslashes are literal and no escape syntax is introduced. |
| Source metadata | Parser sourceLocations is non-enumerable. Retain ENUM value tokens there and existing modifier spans. |
| Type-specific semantic rules | Analyzer owns datatype, default, PK and bound checks. Reuse existing SEM011, SEM015, SEM016 and SEM021. |
| Literal escaping | SQL defaults doubled apostrophes but did not preserve MySQL literal backslashes. Enable backslash escaping for ENUM values/defaults only. Generated JS uses JSON.stringify for arrays and messages. |
| OpenAPI mapping | Shared SWAGGER_TYPE_MAP exists. Add ENUM -> string and its structured enum array. |
| Explicit PK policy | PRIMARY_KEY_ALLOWED_TYPES is INT/STRING; keep it unchanged. |
| Optimizer property survival | Spread-based normalization preserves properties and non-enumerable metadata; duplicate-field comparison needed exact enumValues equality. |

Generated README describes project installation and routes, not field types;
no change is required there. Tokens render generically; AST, Symbols, IR and
Optimized IR needed a small shared datatype display helper. No frontend redesign,
new warning, dependency installation in npm test, or unrelated language change.

## Compiler representation and diagnostics

ENUM fields expose `dataType: "ENUM"` and ordered `enumValues` arrays in AST,
symbol tables and target-independent ADD_FIELD IR. Optimizer normalization
preserves values exactly; declarations with different arrays or different value
orders remain conflicts instead of being removed. ENUM token metadata survives
IR generation and normalization without entering serialized language values.
Non-ENUM fields do not acquire an enumValues property.

| Code | Meaning |
|---|---|
| PAR001, existing | Missing opening parenthesis, missing value, empty list or expected string token |
| PAR022, new | Expected comma or closing parenthesis after an ENUM value |
| SEM030, new | Direct AST ENUM lacks a non-empty array of strings |
| SEM031, new | Duplicate ENUM member |
| SEM032, new | String DEFAULT is outside the declared set |

All 57 original error assignments remain unchanged. Total errors are now 61.
WRN001–WRN005 remain unchanged; ENUM introduces no warning. Tests preserve the
original registry using both individual assignments and the pre-existing registry
hash. Duplicate diagnostics locate the second quoted literal, including quotes;
default errors locate the DEFAULT clause; bounds locate their modifier spans.
Multiline diagnostics use actual token lines. EOF retains its existing start-only
position. Hints list at most five values and cap preview text at 200 characters.

## Generated targets

- MySQL emits native ENUM with utf8mb4_bin collation, escaped values, DEFAULT,
  NOT NULL and UNIQUE according to existing modifier behavior. Live tests prove
  distinct active/ACTIVE values, apostrophe/backslash persistence and default
  round trips, and rejection of invalid direct database string writes.
- Express POST/PUT handlers reject non-string values and strings outside the
  set before model calls, using the existing HTTP 400 response format and a
  deterministic allowed-values message. Omitted optional fields remain allowed
  and receive database defaults. Optional null remains allowed; supplied REQUIRED
  null is rejected. Existing required-omission semantics remain database-enforced.
- OpenAPI properties use type string, the ordered enum array and optional default.
  Required arrays and shared POST/PUT component references remain consistent.
  Existing response descriptions, uniqueness representation, relationships and
  INT/STRING PK path parameter behavior remain unchanged.

The SQL escaping addition is ENUM-only, avoiding unapproved changes to legacy
STRING output. Native MySQL ENUM target constraints still apply: declaration
trailing spaces are removed, direct writes can use numeric indexes, and strict
SQL mode controls rejection. Generated literal backslash escaping assumes normal
MySQL backslash handling rather than NO_BACKSLASH_ESCAPES. These limits are
documented in the Language Guide and the
[MySQL ENUM reference](https://dev.mysql.com/doc/refman/8.4/en/enum.html).

## Verification results

The original offline suite passed before editing. Final `npm test` exits 0:

| Suite | Result |
|---|---|
| Main compiler suite | 1060 passed, 0 failed: lexer 122, parser 242, semantic 186, IR 86, optimizer 78, codegen 252, other 94 |
| STRING length | 25 passed |
| Disk generation | Passed |
| MySQL harness safety | Passed |
| Structured diagnostics | 53 passed |
| Structured warnings | 26 passed |
| ENUM support | 16 focused test groups passed |

`node tests/enum.test.js` checks lexer ranges/BOM/comments/casing, valid and
malformed parsing, default membership/types, all incompatible bounds, PK policy,
direct AST/IR validation, multiline locations, sample compilation, optimizer
preservation/conflicts, generated SQL, emitted JavaScript syntax, OpenAPI, real
emitted HTTP routers using mocked model methods, compiler HTTP status/phase
states, CLI success/exit-1 behavior and frontend datatype rendering.

Valid CLI compilation runs in a temporary working directory; invalid CLI
compilations exit 1. Repository output remains unchanged. Every emitted JS file
for the representative ENUM program parses. The ENUM sample generates all ten
expected project files. Existing test assertions were updated only for the
expanded datatype list and append-only registry size; old assignments and
artifact baselines were retained.

The opt-in generated-backend MySQL harness passed against the available local
service using existing ignored local connection configuration. It materialized
the generated project, installed declared dependencies, imported generated SQL,
started through npm start, exercised health/CRUD/relationships and ENUM POST/PUT,
and verified SQL defaults, string escaping, case-sensitive persistence and invalid
direct writes. Its temporary database, project, server process and port were
cleaned up; repository output remained unchanged. No credentials are recorded.

## Compatibility evidence

Before editing, generated files were captured for five representative programs.
The committed fixture stores their original SHA-256 values. Every filename and
every content hash matches after ENUM implementation:

| Baseline program | Generated files | Result |
|---|---:|---|
| Explicit INT primary key | 10 | Identical |
| Explicit STRING primary key | 10 | Identical |
| Implicit primary key | 10 | Identical |
| Relationship model | 13 | Identical |
| STRING length/default model | 10 | Identical |

All 53 compared files are byte-identical. Existing additional warning-artifact
baselines also pass. No non-ENUM generated-output drift was accepted.

## Browser verification and review

The real playground was started and tested through its UI. At a 1440px desktop
viewport and a 1000px viewport (990px content width with scrollbar), the ENUM
Account preset compiles with six successful phases. Tokens, AST, Symbols, IR,
Optimized IR, SQL, generated controller and OpenAPI were inspected. Values and
default were visible and correct; the original default preset remains first.

Duplicate members show SEM031 at line 3, column 23 with the full repeated-string
range. Invalid DEFAULT shows SEM032 at line 2, column 35 with the DEFAULT clause
range and allowed-values hint. Both fail semantic analysis; IR, optimizer and
codegen are skipped. SQL displays its unavailable state. A successful implicit-PK
compilation followed by invalid DEFAULT confirms old warnings, success summaries
and downloadable output are cleared. Temporary viewport overrides were reset.
Browser screenshots are stored outside the repository in this chat's visualization
directory, including enum-final.jpg, enum-1000.jpg, enum-duplicate.jpg and
enum-invalid-default.jpg.

Self-review using apiforge-change-review: **No blocking or correctness issues
found in the reviewed scope. Ready.** Review covered phase boundaries, malformed
syntax, source ranges, order/case preservation, illegal modifiers, defaults,
escaping, emitted JS execution, OpenAPI consistency, old artifacts and frontend
escaping. Review fixes strengthened malformed direct-AST handling and restored
the original example order. SQL target limits above remain explicit.

## Changed files and repository hygiene

Compiler and targets: src/lexer/lexer.js, src/parser/parser.js,
src/semantic/analyzer.js, src/ir/generator.js, src/optimizer/optimizer.js,
src/codegen/codegen.js, src/utils/diagnostics.js and frontend/app.js.
Tests and sample: package.json, samples/enum_account.apiforge, tests/enum.test.js,
tests/fixtures/enum-compatibility.json, tests/diagnostics.test.js,
tests/generated-backend-mysql.test.js, tests/test.js and tests/warnings.test.js.
Documentation: README.md, docs/APIForge-Language-Guide.md,
docs/structured-diagnostics.md, this verification report, core skill references
architecture.md/current-dsl.md/known-behavior.md and generated-backend reference
generated-project-contract.md.

The four pre-existing untracked report artifacts remain untouched:
APIForge_Drive_Resources.zip, APIForge_Drive_Resources/,
APIForge_Overleaf_Source/ and APIForge_Overleaf_Source__FINAL.zip.
Exact file lists and SHA-256 hashes of all 36 contained files were checked against
the before-edit snapshot. Only explicit feature/documentation paths are staged.
No push, amend, squash or unrelated history rewrite was performed.
