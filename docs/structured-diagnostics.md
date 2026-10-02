# Structured compiler diagnostics

V1 hardening appends SEM034 / GENERATED_NAME_COLLISION. It identifies the source
construct, conflicting owner, generated namespace/name and a rename hint at the
source name range. The original 62 error assignments and WRN001–WRN005 remain
unchanged. A collision fails semantic analysis (HTTP 422, CLI exit 1); later
phases and artifact generation are skipped.

SEM034 also covers generated relationship FK columns, junction tables, constraint
names, model/controller helpers and paths. It reports the offending relationship
name range and the conflicting allocation owner. No additional code is needed
for the same target-allocation rule.

Milestone 4 appends:

| Code | Symbol | Meaning |
|---|---|---|
| SEM035 | UNSAFE_NUMERIC_LITERAL | Non-finite numeric operand or unsafe/lost-fraction INT/length operand; exact numeric token range |
| SEM036 | ENUM_TRAILING_SPACE | Native ENUM member ends in ASCII space; exact member range |
| SEM037 | MYSQL_TARGET_LIMIT | Source/composed identifier or STRING capacity exceeds supported MySQL assumptions; MIN/MAX CHECK constraints on an explicit auto-generated INT key are unrepresentable |

There are now 66 public error assignments. All original 62 and WRN001–WRN005
retain their mapping. Target errors are semantic HTTP 422/CLI exit 1; no artifacts
are generated. Raw numeric source metadata is non-enumerable and never enters IR.

APIForge exposes errors and non-fatal warnings through one JSON contract, implemented in
`src/utils/diagnostics.js`. The six compiler phases and DSL rules are unchanged.
Lexer and parser failures still stop immediately; semantic analysis retains its
existing collection of errors. Later phases never run after a failed phase.
Warnings never fail a phase or stop compilation. Fatal error behavior is unchanged.

```json
{
  "phase": "semantic",
  "code": "SEM017",
  "severity": "error",
  "message": "MIN value 60 cannot be greater than MAX value 18.",
  "symbol": "MIN_EXCEEDS_MAX",
  "line": 2,
  "column": 9,
  "endLine": 2,
  "endColumn": 15,
  "hint": "MIN must not exceed MAX."
}
```

The example is from `ENTITY Student` followed by `age INT MIN 60 MAX 18`.
Its range identifies `MIN 60`. Positions are **1-based**; end positions are
**exclusive**. Columns count JavaScript UTF-16 code units, matching the lexer.
The lexer strips a leading BOM before counting columns. Token ranges measure
consumed source text, including string quotes. EOF has only a start position.
Parser metadata retains actual token lines for declarations split across lines.
Semantic checks prefer the relevant name, datatype or modifier occurrence.
Direct AST clients without that metadata receive available declaration positions.

Unknown `line` and `column` values are consistently `null`. Unavailable
`endLine`, `endColumn` and `hint` fields are omitted. Ranges are included only
when actual token endpoints are available. Hints are optional deterministic
guidance; existing message-level suggestions remain for compatibility.

## Consumers and compatibility

- Thrown lexer/parser `Error` objects expose `.diagnostic`. Their original
  `.message`, `.userMessage`, `.line`, `.column` and symbolic `.code` remain.
  Malformed decimals such as `8.` now have the specific symbol `MALFORMED_NUMBER`
  and code `LEX004` instead of the previous unexpected-character error at the dot.
- Semantic results expose `.diagnostics` alongside `.errors`. Existing error
  messages remain, and legacy entries have symbolic `.code` and `.diagnostic`.
  `MISSING_ENTITY_DECLARATION` remains the symbol for `SEM001`.
  `.warnings` is a separate array of shared diagnostics with `severity: "warning"`.
  Valid programs may have warnings; `valid` still depends only on errors.
- Failed HTTP compilations expose `.diagnostic` (first error), `.diagnostics`
  (all existing errors), `.phase`, boolean `.phases`, and explicit `.phaseStates`
  (`succeeded`, `failed`, `skipped`). Legacy `.errors` and successful partial
  results remain available. Internal exceptions use a safe `INT001` message;
  exception details and stacks are not sent to clients.
- The CLI prints stable code, message, location, source frame and optional hint.
  Failures still exit with code 1 before generating any backend output.
- The playground uses those same fields in its existing error cards. Source
  excerpts and caret ranges use `src/utils/source-frame.js`, also used by the
  CLI and the legacy `formatCodeFrame` utility. Start-only locations use one
  caret. Multi-line ranges highlight each covered line. Empty strings reach
  semantic analysis, consistently with the HTTP API.

## Warnings

For `ENTITY Student` followed by `name STRING`, semantic analysis returns:

```json
{
  "phase": "semantic",
  "code": "WRN001",
  "severity": "warning",
  "message": "Entity 'Student' has no explicit primary key. APIForge will generate an implicit integer id field.",
  "symbol": "IMPLICIT_PRIMARY_KEY",
  "line": 1,
  "column": 8,
  "endLine": 1,
  "endColumn": 15,
  "hint": "Declare an explicit PRIMARY KEY to control the identifier."
}
```

`createDiagnostic()` defaults to `error`, preserving existing error shapes.
`createWarningDiagnostic()` uses the same factory with a fixed warning severity
and a separate central registry. Unknown conditions, conditions registered for
the wrong severity, and unsupported severities throw rather than silently assign
a code. Optional fields and source ranges follow the same rules for both severities.

Warning codes use the **WRN plus three explicit digits** namespace, independently
of phase. `WARNING_CODES` in `src/utils/diagnostics.js` owns the append-only
assignments: never renumber or reuse them. All 57 original error assignments are
unchanged; ENUM appends four errors and implicit-key collision appends SEM033
(62 total). `symbol` describes the condition;
`phase` identifies its emitter.

ENUM additions are append-only:

| Phase | Code | Symbol | Condition |
|---|---|---|---|
| Parser | PAR022 | EXPECTED_ENUM_DELIMITER | Expected comma or closing parenthesis after a value |
| Semantic | SEM030 | INVALID_ENUM_VALUES | Direct AST ENUM has no non-empty string array |
| Semantic | SEM031 | DUPLICATE_ENUM_VALUE | Repeated case-sensitive member |
| Semantic | SEM032 | INVALID_ENUM_DEFAULT | String default is not a declared member |

Missing opening parentheses, empty lists, non-string values and missing values
reuse PAR001 (EXPECTED_TOKEN). Non-string defaults reuse SEM021. Bounds reuse
SEM015/SEM016; ENUM primary keys reuse SEM011. Duplicate-value ranges include
the repeated string's quotes. Defaults and bounds retain modifier ranges.
Membership hints list at most five values and cap the preview at 200 characters.
No ENUM warning is introduced; WRN001–WRN005 remain unchanged.

SEM033 (`IMPLICIT_PRIMARY_KEY_COLLISION`) is a semantic error when an entity
without an explicit PRIMARY KEY declares id in any casing (id/Id/ID/iD),
conflicting with MySQL's case-insensitive generated column allocation. It points
at the conflicting field-name range and uses the deterministic hint:
`Declare an explicit PRIMARY KEY or rename the conflicting field.`
Compilation fails before IR/optimizer/codegen, produces no generated files,
returns HTTP 422 and CLI exit 1, and emits no WRN001 for the invalid program.
Explicit keys allow ordinary id-like fields. Valid implicit entities retain
WRN001's existing wording, severity and source location. All previous 61 error
assignments and WRN001–WRN005 remain unchanged.

| Phase | Code | Symbol | Existing behavior reported |
|---|---|---|---|
| semantic | WRN001 | IMPLICIT_PRIMARY_KEY | Valid entity lacks an explicit PK; SQL generation adds `id INT PRIMARY KEY AUTO_INCREMENT`. |
| optimizer | WRN002 | CONFLICTING_FIELD | Direct-IR duplicate field has differing type, constraints, validations or default; both declarations remain. |
| optimizer | WRN003 | CONFLICTING_RELATION_TYPE | Direct-IR relationship name/endpoints match but cardinality differs; both declarations remain. |
| optimizer | WRN004 | CONFLICTING_RELATION_ENDPOINTS | Direct-IR relationship name matches but endpoints differ; both declarations remain. |
| optimizer | WRN005 | INVALID_IR | Existing non-throwing invalid-IR fallback returns the input unchanged and no optimizations. This does not promise that invalid IR can be generated into a backend. |

Only WRN001 adds a new reported condition. The four optimizer conditions already
returned warning strings. Ordinary conflicting DSL declarations still fail
semantic analysis before optimization. Exact IR duplicates are removed without
warnings. No style or performance policies are added. Implicit-PK warnings are
reported for valid semantic programs only, where code generation can proceed.

Successful compiler API responses always include `warnings: []` when no warnings
exist. Responses remain HTTP 200 with `success: true`, six `phases: true` values, six
`phaseStates: "succeeded"` values, and all generated files. Errors remain in fatal
`diagnostic`/`diagnostics` and compatible `errors` collections on failures;
warnings never enter them. Failed phase responses preserve warnings already
emitted by successful earlier phases. Warning metadata does not enter AST/IR,
symbol-table values, or generated SQL, JavaScript, package files or OpenAPI.

The existing optimizer/API `.warnings` array now contains structured diagnostic
objects rather than strings. This is the single canonical representation;
external string consumers should use `warning.message`. Messages and optimizer
conflict handling are preserved. No parallel string array is maintained.

All collections use the same deterministic order: compiler phase order, source
line, source column, then stable code. Known positions precede unknown positions;
exact ties preserve emission order. Optimizer warnings use existing IR line or
column/range metadata when present; unknown coordinates stay null. Legacy field
IR carries line numbers; ENUM field IR also retains non-enumerable token metadata.

CLI warnings print once with a `[!]` label, phase, public code, shared source
frame and optional hint. Warning-only compilations generate output and exit 0.
The playground retains its green success summary and six successful phases,
adds an inline warning count when nonzero, and shows compact amber warning items
using the shared source-frame utility. Zero-warning success appearance is unchanged.

## HTTP statuses

| Condition | Status |
|---|---:|
| Missing body/source or non-string source | 400 |
| Lexer or parser diagnostic | 400 |
| Semantic diagnostic, including empty/comment-only source | 422 |
| Unexpected exception in any compiler phase | 500 |
| Malformed JSON body | 500 (existing server behavior preserved) |
| Successful compilation | 200 |

Malformed JSON has input diagnostic `INP002`; the compatibility `error` field
remains `Internal Server Error`. The audit found that JSON parse errors already
reached the server's generic 500 handler. This task preserves that status.
Fixing that request-status policy can be considered separately.

One existing position defect was corrected: skipped comment characters now
advance the column counter, so EOF after a comment identifies its true position.
This changes positions only, not accepted programs or compiler semantics.

## Stable code registry

Codes use a phase prefix and three digits. Numeric assignments are explicit in
the central registry; append new entries without renumbering or reusing codes.
`symbol` retains the meaningful condition name. The 62 codes comprise 4 lexical,
22 parser, 33 semantic, 2 input, and 1 internal code. The original 61 assignments
are unchanged. `INT001` uses the actual
failed phase in its `phase` field and has no invented source location.

| Phase | Code | Symbol |
|---|---|---|
| lexer | LEX001 | UNEXPECTED_CHARACTER |
| lexer | LEX002 | INVALID_IDENTIFIER |
| lexer | LEX003 | UNTERMINATED_STRING |
| lexer | LEX004 | MALFORMED_NUMBER |
| parser | PAR001 | EXPECTED_TOKEN |
| parser | PAR002 | MISSING_ENTITY_NAME |
| parser | PAR003 | MISSING_SOURCE_ENTITY |
| parser | PAR004 | MISSING_RELATION_NAME |
| parser | PAR005 | MISSING_TARGET_ENTITY |
| parser | PAR006 | MISSING_IDENTIFIER |
| parser | PAR007 | EXPECTED_ENTITY_DECLARATION |
| parser | PAR008 | MISSING_FIELD_NAME |
| parser | PAR009 | INVALID_FIELD_TOKEN |
| parser | PAR010 | MISSING_RELATION_TYPE |
| parser | PAR011 | INVALID_RELATION_TYPE |
| parser | PAR012 | MISSING_DATATYPE |
| parser | PAR013 | INVALID_DATATYPE |
| parser | PAR014 | MISSING_KEY_AFTER_PRIMARY |
| parser | PAR015 | STANDALONE_KEY |
| parser | PAR016 | MISSING_MIN_VALUE |
| parser | PAR017 | MISSING_MAX_VALUE |
| parser | PAR018 | MISSING_MIN_LENGTH_VALUE |
| parser | PAR019 | MISSING_MAX_LENGTH_VALUE |
| parser | PAR020 | MISSING_DEFAULT_VALUE |
| parser | PAR021 | UNKNOWN_MODIFIER |
| parser | PAR022 | EXPECTED_ENUM_DELIMITER |
| semantic | SEM001 | MISSING_ENTITY_DECLARATION |
| semantic | SEM002 | DUPLICATE_ENTITY |
| semantic | SEM003 | RESERVED_ENTITY_NAME |
| semantic | SEM004 | EMPTY_ENTITY |
| semantic | SEM005 | DUPLICATE_FIELD |
| semantic | SEM006 | RESERVED_FIELD_NAME |
| semantic | SEM007 | INVALID_DATATYPE |
| semantic | SEM008 | INVALID_CONSTRAINT |
| semantic | SEM009 | DUPLICATE_CONSTRAINT |
| semantic | SEM010 | MULTIPLE_PRIMARY_KEYS |
| semantic | SEM011 | INVALID_PRIMARY_KEY_TYPE |
| semantic | SEM012 | DUPLICATE_VALIDATION |
| semantic | SEM013 | INVALID_NUMERIC_BOUND |
| semantic | SEM014 | INVALID_LENGTH_BOUND |
| semantic | SEM015 | NUMERIC_MODIFIER_TYPE_MISMATCH |
| semantic | SEM016 | LENGTH_MODIFIER_TYPE_MISMATCH |
| semantic | SEM017 | MIN_EXCEEDS_MAX |
| semantic | SEM018 | MIN_LENGTH_EXCEEDS_MAX_LENGTH |
| semantic | SEM019 | NON_INTEGER_BOUND |
| semantic | SEM020 | DUPLICATE_DEFAULT |
| semantic | SEM021 | INVALID_DEFAULT_TYPE |
| semantic | SEM022 | DEFAULT_OUT_OF_RANGE |
| semantic | SEM023 | DEFAULT_LENGTH_OUT_OF_RANGE |
| semantic | SEM024 | DUPLICATE_RELATION |
| semantic | SEM025 | RESERVED_RELATION_NAME |
| semantic | SEM026 | INVALID_RELATION_TYPE |
| semantic | SEM027 | SELF_RELATION |
| semantic | SEM028 | UNKNOWN_SOURCE_ENTITY |
| semantic | SEM029 | UNKNOWN_TARGET_ENTITY |
| semantic | SEM030 | INVALID_ENUM_VALUES |
| semantic | SEM031 | DUPLICATE_ENUM_VALUE |
| semantic | SEM032 | INVALID_ENUM_DEFAULT |
| semantic | SEM033 | IMPLICIT_PRIMARY_KEY_COLLISION |
| input | INP001 | INVALID_SOURCE |
| input | INP002 | MALFORMED_JSON |
| internal | INT001 | FAILURE |
