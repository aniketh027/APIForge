# APIForge language guide audit evidence

Verified on 2026-10-01 in `C:\Project\APIForge`.
Compiler baseline: `96a1d34a80cfb21e4b5bdbaddf810dbef576f670`.
Guide commit: `c43939bbb7670c59f01e65244f347f0612dd8b9a`.

## Scope and baseline

This is an audit/documentation change. The existing guide was replaced with a
verified specification of current behavior. Compiler phases, accepted source,
diagnostics/warning assignments, generated artifacts, dependencies, samples,
existing tests, README, and skills are unchanged.

Before editing:

~~~text
HEAD: 96a1d34a80cfb21e4b5bdbaddf810dbef576f670
Branch: main
HEAD...origin/main: 0 ahead, 0 behind
Live remote main: 96a1d34a80cfb21e4b5bdbaddf810dbef576f670

?? APIForge_Drive_Resources.zip
?? APIForge_Drive_Resources/
?? APIForge_Overleaf_Source/
?? APIForge_Overleaf_Source__FINAL.zip
~~~

No AGENTS.md was found in the repository or its applicable ancestor directories.
All four repository skills were inspected; core, generated-backend, and
change-review instructions guided the audit. No compiler-change workflow was
used to introduce a feature.

A 16-part internal language inventory was completed before the guide was edited.
The inventory covered syntax, case, required/optional components, combinations,
validation phase/codes, SQL/API/OpenAPI effects, and valid/invalid examples.
The following table summarizes that verified inventory; complete syntax,
examples, diagnostics, and target caveats are in the guide.

## Verified inventory and authority

| Construct | Accepted form / rules | Validation authority | Targets / guide coverage |
|---|---|---|---|
| Program, ENTITY, fields | ENTITY identifier followed by zero or more syntactic fields; semantics requires at least one entity and one field per entity | Parser; semantic SEM001/002/004/005 | Entity tables, root resource routers; sections 1/3/4 |
| Identifiers, whitespace, comments | ASCII identifiers; exact uppercase vocabulary; whitespace discarded; // comments; leading BOM stripped | Lexer; reserved source names fail parser before direct-AST reserved checks | Original SQL/model names; generated casing/pluralization; sections 2/12 |
| Literals | Optional minus plus digit-based integer/decimal; single-line double-quoted literal strings; TRUE/FALSE | Lexer LEX001–004; parser number/string/boolean operands | Parsed numeric values, literal backslashes; section 2 |
| INT | Integer-valued defaults/bounds; PK/REQUIRED/UNIQUE/DEFAULT/MIN/MAX | Semantic SEM019/021; inappropriate lengths SEM016 | INT, integer schema; sections 5/7/10 |
| FLOAT | Numeric defaults/bounds; REQUIRED/UNIQUE; no PK or length | Semantic SEM011/016/021 | FLOAT, number schema; sections 5/7/10 |
| BOOLEAN | TRUE/FALSE default; REQUIRED/UNIQUE; no PK or bounds | Semantic SEM011/015/016/021 | BOOLEAN, boolean schema; sections 5/10 |
| STRING | Quoted defaults; PK/REQUIRED/UNIQUE/length bounds | Semantic type, length, default rules | VARCHAR capacity, CHAR_LENGTH, code-point runtime length, string schema; sections 5/7 |
| Explicit primary key | PRIMARY KEY, INT/STRING, at most one field; constraints/bounds/default may coexist | Parser PAR014/015; semantic SEM009–011 | INT auto-increment unless default; STRING key; typed OpenAPI path; section 6 |
| Implicit primary key | No PK is semantically valid; WRN001 only for valid programs | Semantic warning, target-only ID generation | Injected SQL id; first-field item-model fallback documented; section 6 |
| REQUIRED, UNIQUE | Both permitted on all five types; once per field | Semantic SEM009 | NOT NULL/UNIQUE; OpenAPI required; no general omission/uniqueness controller check; section 7 |
| DEFAULT | Once; type-correct literal; respects numeric/length/membership rules | PAR020; SEM020–023/032 | SQL/OpenAPI defaults; no controller default injection; PUT omission retains value |
| MIN/MAX | INT/FLOAT, once each, inclusive and ordered; INT bounds integral | PAR016/017; SEM012/013/015/017/019/022 | CHECK, JavaScript comparisons, minimum/maximum |
| MIN_LENGTH/MAX_LENGTH | STRING, once each, non-negative integer, inclusive and ordered | PAR018/019; SEM012/014/016/018/023 | CHAR_LENGTH, widened VARCHAR, Array.from lengths, minLength/maxLength |
| ENUM | Nonempty ordered list of unique case-sensitive quoted strings, including empty member; member DEFAULT; REQUIRED/UNIQUE only | PAR001/022; SEM030–032 and existing type/key/bound codes | Native utf8mb4_bin ENUM, ENUM-specific escaping, exact supplied-value validation, string enum schemas |
| Relationships | Four cardinalities; globally unique name; declared endpoints anywhere; no self | Parser operands/cardinality; semantic SEM024–029 | Four SQL topologies, source-only target-named routes; output collisions documented |
| Diagnostics/warnings and collection queries | 61 errors, unchanged WRN001–005; HTTP query syntax separate from DSL | Central registry, analyzer/optimizer, generated model query parser, focused suites | Phase/status contracts; exact filters, whitelist sort/order, opt-in page/limit, envelope/headers; sections 11/12 |

Each modifier is documented by name. Parser acceptance is distinguished from
semantic validity and backend operational limits. No supported vocabulary was
added or omitted from the lexer/parser inventory.

## Exact repository files inspected

Compiler and consumers:

~~~text
src/lexer/lexer.js
src/parser/parser.js
src/ast/ast.js
src/semantic/analyzer.js
src/ir/generator.js
src/optimizer/optimizer.js
src/codegen/codegen.js
src/utils/diagnostics.js
src/utils/errors.js
src/utils/source-frame.js
src/api/compiler-api.js
index.js
server.js
package.json
README.md
~~~

Samples (all nine were read and passed through the real pipeline):

~~~text
samples/student.apiforge
samples/student_validation.apiforge
samples/string_length_validation.apiforge
samples/enum_account.apiforge
samples/student_course_rel.apiforge
samples/one_to_one.apiforge
samples/one_to_many.apiforge
samples/dup_rel.apiforge
samples/invalid_rel.apiforge
~~~

Tests and compatibility evidence (full relevant focused cases, main-suite
language/codegen/sample sections, safety setup, and helper contracts):

~~~text
tests/test.js
tests/string-length-validation.test.js
tests/disk-generation.test.js
tests/generated-backend-mysql-safety.test.js
tests/diagnostics.test.js
tests/warnings.test.js
tests/enum.test.js
tests/collection-query.test.js
tests/generated-backend-test-helpers.js
tests/collection-query-test-helpers.js
tests/fixtures/warning-artifact-baseline.json
tests/fixtures/enum-compatibility.json
tests/fixtures/collection-query-compatibility.json
~~~

Existing language/generated-behavior documentation:

~~~text
docs/APIForge-Language-Guide.md (baseline and replacement)
docs/structured-diagnostics.md
docs/structured-diagnostics-verification.md
docs/compiler-warnings-verification.md
docs/enum-support-verification.md
docs/collection-query-verification.md
~~~

All existing repository skill files:

~~~text
.codex/skills/apiforge-core/SKILL.md
.codex/skills/apiforge-core/references/architecture.md
.codex/skills/apiforge-core/references/current-dsl.md
.codex/skills/apiforge-core/references/known-behavior.md
.codex/skills/apiforge-core/references/project-map.md
.codex/skills/apiforge-compiler-change/SKILL.md
.codex/skills/apiforge-compiler-change/references/semantic-design-checklist.md
.codex/skills/apiforge-compiler-change/references/compiler-change-checklist.md
.codex/skills/apiforge-generated-backend/SKILL.md
.codex/skills/apiforge-generated-backend/references/generated-project-contract.md
.codex/skills/apiforge-generated-backend/references/backend-verification-checklist.md
.codex/skills/apiforge-change-review/SKILL.md
.codex/skills/apiforge-change-review/references/review-checklist.md
.codex/skills/apiforge-change-review/references/review-report-template.md
~~~

The local dependency manifest `node_modules/express/package.json` was inspected
to verify its Node engine requirement. The new `docs/verify-language-guide.js`
was reviewed and executed. The user attachment was read as the task contract.
Protected report artifacts were read only for preservation comparisons.

The [official MySQL ENUM reference](https://dev.mysql.com/doc/refman/8.4/en/enum.html)
was checked for the guide's native target caveats: trailing spaces, strict-mode
rejection, numeric indexes, and declaration-order sorting. These external target
facts are explicitly separated from the compiler's accepted language.

## Unsupported forms and newly explicit limitations

The guide excludes unsupported block/escape/multiline-string syntax, plus/exponent/
hex source numbers, NULL defaults, additional datatypes, reusable enums, composite
entity keys, explicit FOREIGN KEY constraints, self-relations, imports/extension,
expressions/control flow, custom routes/authentication, migrations, and alternate
database targets. HTTP FLOAT filter exponent/plus support is not DSL support.

Previously incomplete or misleading documentation is clarified for:

- Integer-valued decimal defaults/bounds, zero STRING-length bounds, literal
  backslashes, empty/case-distinct ENUM members, and forward relationships.
- Semantic duplicate rejection versus direct-IR optimizer deduplication/warnings.
- Implicit target ID absent from AST/IR/component schema, with item model fallback
  to the first declared field; undeclared-key id collisions.
- No general REQUIRED omission check, numeric body type/integrality validation,
  or controller default application; optional/null ENUM differences.
- Nullable ONE_TO_ONE storage, target-derived relationship names, collision
  acceptance, incomplete relationship SQL quoting, and physical database limits.
- Collection filtering distinct from write bounds, reserved control-name fields,
  STRING-primary-key/implicit-id metadata, pagination opt-in and count consistency.
- OpenAPI shared PUT schemas and response schemas that do not fully represent
  actual success envelopes.

These are descriptions of unchanged behavior, not fixes or new restrictions.

## Contradictions and stale claims in existing documentation

| Location at baseline | Claim/problem | Current implementation / disposition |
|---|---|---|
| Old guide, Language Basics | Newlines described as delimiters | Lexer discards newlines; compact valid program verified. Corrected in guide. |
| Old guide, entity naming rule | Suggested only PascalCase/snake_case name forms | Parser accepts any non-reserved lexical identifier. Convention clarified. |
| Old guide, datatype introduction/table | Listed four primitive types; ENUM was described separately | All five implemented datatypes now inventoried together. |
| Old guide, ONE_TO_ONE | Described exactly one linked record | SQL-added unique FK is nullable; no required association. Corrected. |
| Old guide, validation behavior | Omitted PUT fields described as relying on defaults | Model updates supplied fields; omitted fields retain old values. Corrected. |
| Old guide, OpenAPI parameters | All path parameters described as integer | Explicit STRING keys yield string parameters. Corrected. |
| Old guide, missing-target example | Claimed entity must be declared before reference | Analyzer resolves endpoints across the program; forward reference compiled. Corrected. |
| Old guide, default-range example | With both bounds, quoted a one-sided error message | Real SEM022 message describes the full allowed range. New examples check codes directly. |
| Old guide, complete example | Claimed to demonstrate all supported features but omitted ENUM/length and some cardinalities | Replaced by progressive examples plus all-four-cardinality program. |
| Old guide, overview/FAQ | Production-ready/fully functional guarantee; interactive JSON description | Compiler generates files; known operational/validation/schema limits exist. Swagger JSON is not an interactive UI. Corrected. |
| Old guide / core known-behavior reference | npm test described as only node tests/test.js | package.json runs eight existing suites. Guide avoids stale single-suite claim; skill reference left unchanged. |
| README.md:393 | Node 14+ prerequisite | Installed Express 5.2.1 manifest requires Node >=18. Reported only; README unchanged. |
| Core known-behavior reference:8 | Historical SHA described as current HEAD | Current audited baseline is 96a1d34; report flags stale snapshot. Skill unchanged. |

README's collection/ENUM contracts and current structured-diagnostics registry
agree with this guide. Historical implementation verification reports retain their
original baselines/counts; those dated results are not treated as current test
results or rewritten. No stale generated resource /api path appears in the new
guide. /api/compile is correctly identified as the repository compiler endpoint.

## Verification commands and exact results

Run from the repository root:

~~~text
npm test
node docs/verify-language-guide.js
node --check docs/verify-language-guide.js
git diff --check
git diff --cached --check
~~~

`npm test` passed both before drafting and after drafting, exit 0. Final results:

| Existing suite | Exact result |
|---|---|
| tests/test.js | 1,060 passed, 0 failed |
| tests/string-length-validation.test.js | 25 passed |
| tests/disk-generation.test.js | Disk generation regression tests passed |
| tests/generated-backend-mysql-safety.test.js | Generated MySQL integration safety tests passed |
| tests/diagnostics.test.js | 53 passed |
| tests/warnings.test.js | 26 passed |
| tests/enum.test.js | 16 passed |
| tests/collection-query.test.js | 9 test groups passed |

The suites with explicit individual counters total 1,180. The nine query groups
and two pass-only regression/safety suites are additional; their internal
assertions are not invented as individual test counts.

The documentation verifier passed, exit 0:

~~~text
Guide examples: 18 valid compiled through six phases; 59 invalid exact diagnostic arrays matched.
Generated artifacts: 120 JavaScript files parsed; JSON, file counts, ENUM order and root OpenAPI paths checked.
Documented target differences: implicit IDs, keys, required/default validation, ENUM escaping, all cardinalities, naming collisions and diagnostic JSON reproduced.
Real CLI: 18 valid exits 0 with exact output; 59 invalid exits 1 with exact codes and no output.
Language guide verification: PASS.
~~~

Every valid DSL fence has an expectation marker, and every invalid-program table
row is extracted. Uncovered fences/rows, duplicate IDs, unexpected warnings, any
extra/missing diagnostic, internal failure, artifact mismatch, CLI timeout, or
incorrect exit/output behavior fail verification. Grammar templates are not
misclassified as complete programs. The diagnostic JSON example is compared to
the actual analyzer diagnostic, including positions/range/hint.

The verifier calls unmodified real modules; codegen uses its in-memory mode.
It then runs the actual CLI for all 77 programs in separate temporary working
directories. Valid disk output is compared to in-memory generated bytes.
Every invalid CLI run checks the exact printed codes and absence of output.
Temporary cleanup verifies absolute paths stay outside the repository and inside
the temporary root. Repository output and report artifacts are not generated into.

A separate read-only in-memory sample sweep produced:

~~~text
dup_rel.apiforge: SEM024
invalid_rel.apiforge: SEM029
7 valid samples compiled; 2 intended invalid samples rejected.
44 generated sample JavaScript files parsed.
~~~

The existing full suite includes relevant diagnostic/warning/ENUM CLI tests,
real generated Express requests with mocked model/pool calls, query SQL binding,
OpenAPI and compatibility-hash checks. These establish generated behavior cheaply
without new database/network integration.

`node --check` passed. `git diff --check` and staged whitespace checks passed
with no whitespace errors. Git's existing LF-to-CRLF notices are conversion
notices. No compiler/source/test/dependency/sample/README/skill/output diff exists
against the baseline.

Raw final test and verifier logs are outside the repository:

~~~text
%TEMP%\apiforge-language-npm-test-final.log
%TEMP%\apiforge-language-guide-verification.log
~~~

## Self-review, preservation, and delivery

No blocking or correctness issue was found in the documentation scope after
reviewing the final guide diff, executable expectations, source/semantic/codegen
claims, code assignments, route paths, ENUM ordering/escaping, query contract,
and changed-file allowlist.

Changed files are exactly:

~~~text
docs/APIForge-Language-Guide.md
docs/verify-language-guide.js
docs/language-guide-verification.md
~~~

Two scoped local commits separate the verified guide from its reproducible audit
evidence. Only explicit documentation paths are staged. Commit hashes and final
Git status are reported with delivery; no push, tag, or history rewrite is done.

All four protected untracked entries remain in place. A read-only manifest
comparison found the same 36 files, identical lengths, SHA-256 hashes, and last-
write timestamps. Protected directory/archive timestamps also match the initial
snapshot. None was modified, regenerated, staged, moved, or deleted.

There is no unresolved syntax/example/diagnostic uncertainty for this baseline.
SQL was inspected but not imported into a live database during this documentation
task; dependency installation/startup integration and a new browser/manual download
check were not run. This audit does not newly certify a particular MySQL server,
SQL mode, deployment, or dependency installation. Current target limitations are
explicitly documented rather than silently repaired.
