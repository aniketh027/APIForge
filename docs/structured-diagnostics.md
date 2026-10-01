# Structured compiler diagnostics

APIForge exposes error diagnostics through one JSON contract, implemented in
`src/utils/diagnostics.js`. The six compiler phases and DSL rules are unchanged.
Lexer and parser failures still stop immediately; semantic analysis retains its
existing collection of errors. Later phases never run after a failed phase.
This contract introduces no warning or recovery behavior.

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
`symbol` retains the meaningful condition name. The 57 codes comprise 4 lexical,
21 parser, 29 semantic, 2 input, and 1 internal code. `INT001` uses the actual
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
| input | INP001 | INVALID_SOURCE |
| input | INP002 | MALFORMED_JSON |
| internal | INT001 | FAILURE |
