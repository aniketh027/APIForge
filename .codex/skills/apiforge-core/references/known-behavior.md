# Known current behavior

Treat these as implementation facts to verify when the relevant code changes, not as reasons to preserve accidental defects forever.

## Tests and pipeline

- `npm test` runs `node tests/test.js`. The harness reports per-phase and aggregate pass/fail totals and exits nonzero on failures.
- Current HEAD `024ba02` describes the suite as expanded to 1002 tests. The full suite was intentionally not rerun during this metadata-only skill creation, so always run the current suite for an authoritative live count and result.
- The CLI writes generated files; the compiler API generates the same file contents in memory and does not write them.

## Parser and language boundaries

- Keywords/modifiers/types/cardinalities/boolean literals are case-sensitive uppercase; identifiers are case-sensitive.
- Only `//` line comments are supported.
- Newlines are discarded by the lexer. They are readable conventions, not required field separators.
- The parser accepts an empty token stream as an empty `Program`, but semantic analysis rejects any program without at least one `ENTITY`. The HTTP compiler API reserves input-level 400 responses for missing or non-string source; empty, whitespace-only, and comment-only strings reach semantic analysis and return 422.
- An entity with no fields parses but fails semantic analysis.
- A relation declaration has exactly four operands after `RELATION`: source entity, relation name, target entity, and cardinality.

## Defaults, validation, and primary keys

- Defaults are typed AST/IR values: `NUMBER`, `STRING`, or `BOOLEAN`. Duplicate defaults and type/range mismatches are semantic errors.
- `MIN`/`MAX` are numeric-only; `INT` bounds must be integers; `MIN` cannot exceed `MAX`.
- `MIN_LENGTH`/`MAX_LENGTH` are STRING-only non-negative integer bounds; `MIN_LENGTH` cannot exceed `MAX_LENGTH`, and STRING defaults must satisfy the declared length range.
- Semantic analysis does not require an explicit primary key. During SQL generation, an entity without one receives `id INT PRIMARY KEY AUTO_INCREMENT`; the source AST/IR is not rewritten to add that field.
- Codegen's shared effective key governs SQL, item CRUD/create identity, relationships, collection metadata and OpenAPI. Implicit keys use id/INT; components mark id readOnly without requiring it. Model fields, AST/source symbols/IR/optimized IR remain source-declared. No-PK declared id/Id/ID/iD fails SEM033 at the field name without WRN001; explicit keys permit ordinary id-like fields.
- `INT PRIMARY KEY` normally becomes `PRIMARY KEY AUTO_INCREMENT`. With an explicit default, such as `INT PRIMARY KEY DEFAULT 1`, codegen omits `AUTO_INCREMENT` and emits the default.
- `STRING` primary keys are allowed and are not auto-incremented. `FLOAT`, `BOOLEAN` and `ENUM` primary keys are rejected.
- Create responses prefer a supplied explicit key, otherwise an auto-generated insertId, otherwise the typed declared key DEFAULT; no key is invented for a non-generated, non-defaulted omission. Other DB defaults are not reloaded. POST explicit-PK acceptance remains; PUT rejects any explicit own PK field with 400 before model access, including the same value/null. Implicit id stays unknown input. Models also guard own effective-key properties before SQL. PUT remains partial and empty PUT rereads the URL identity. Shared OpenAPI schemas still expose explicit keys generically; operation-specific mutability remains a G11 limitation.
- ENUM declares an ordered non-empty unique set of case-sensitive quoted strings.
  Defaults must be members; REQUIRED/UNIQUE are supported and all bound modifiers
  are rejected. AST/symbols/IR expose `enumValues`; native SQL uses binary collation,
  Express checks membership and OpenAPI emits string schemas with enum arrays.
- SQL uses `VARCHAR(255)` for STRING by default and widens the capacity when `MIN_LENGTH` or `MAX_LENGTH` requires more than 255 characters.

## Generated backend

Codegen returns or writes:

```text
database/schema.sql
config/db.js
.env.example
package.json
README.md
models/<Entity>.js
controllers/<entity>Controller.js
routes/<entity>Routes.js
server.js
swagger.json
```

Codegen emits seven fixed files plus three files per entity. The generated `package.json` declares `dotenv`, `express`, and `mysql2` with APIForge's own compatible version ranges and starts the root-level `server.js`. The generated `README.md` documents installation, environment configuration, manual MySQL schema import, route mounts, startup, and the location of `swagger.json`. It does not emit a lockfile, `.env`, or database bootstrap.

- Entity CRUD routers expose `GET /`, `GET /:id`, `POST /`, `PUT /:id`, and `DELETE /:id`.
- Entity collection GET supports typed exact filters, whitelisted sort/order, and opt-in page/limit (defaults 1/20, maximum 100). It preserves `{ success: true, data: [...] }`; pagination headers carry filtered counts. Unknown/repeated/invalid parameters return 400 before DB access. Query options do not extend to item, write, or relationship routes. See the generated-backend contract for parsing and reserved-name details.
- Generated POST/PUT require JSON objects, reject unknown/synthetic own fields and forward only declared supplied fields in a fresh object. INT is a finite safe integer, FLOAT a finite number, BOOLEAN boolean, STRING string and ENUM an exact member string. REQUIRED null is rejected; optional null accepted. POST requires omitted REQUIRED fields unless DEFAULT or an auto-generated key supplies them; PUT stays partial. Bounds and Unicode code-point lengths remain inclusive. POST/PUT DB errors are sanitized 500 responses; generated malformed JSON is sanitized 400. SQL constraints/defaults are unchanged; UNIQUE has no precheck or status mapper. Shared OpenAPI components reflect POST requiredness and disallow additional properties, with partial-PUT/nullability limitations remaining.
- The generated server mounts each router directly at a lowercase plural path such as `/students`; it does not add `/api`. The repository development server uses `/api` only for the compiler endpoints (`/api/compile`, `/api/health`).
- Relationship endpoints are generated on the source entity router. `MANY_TO_MANY` gets list/add/remove routes; `ONE_TO_MANY` gets a list route; `MANY_TO_ONE` and `ONE_TO_ONE` get a singular target route.
- SQL relationship layout is target-specific: junction table for `MANY_TO_MANY`, target-side foreign key for `ONE_TO_MANY` and `ONE_TO_ONE`, and source-side foreign key for `MANY_TO_ONE`.

## Compiler HTTP status conventions

`POST /api/compile` returns:

| Condition | Status |
|---|---:|
| Missing body/source or non-string source | 400 |
| Lexer error | 400 |
| Parser error | 400 |
| Semantic error (including empty/blank/comment-only source) | 422 |
| IR, optimizer, codegen, or unexpected internal error | 500 |
| Malformed JSON body (existing global handler) | 500 |
| Successful compilation | 200 |

The Language Guide and generated server use `/<plural>` directly for generated CRUD and relationship routes. `/api` belongs to the repository's compiler HTTP endpoints.

## Structured diagnostics

`src/utils/diagnostics.js` owns the stable LEX/PAR/SEM/INP/INT error registry
and the separate append-only WRN warning registry. Errors default to severity
`error`; `createWarningDiagnostic` uses the same model with severity `warning`.
Thrown lexer/parser errors have `.diagnostic`; semantic results have `.diagnostics`
alongside compatible `.errors` entries. HTTP failures expose `diagnostic`,
`diagnostics`, legacy `errors`, and explicit `phaseStates`. Internal exceptions
produce safe INT001 diagnostics. Positions are 1-based with exclusive end ranges;
unknown starts are null and unavailable ranges/hints are omitted. CLI and browser
use `src/utils/source-frame.js`. See `docs/structured-diagnostics.md` for the full
contract. Blank browser input reaches the same semantic rule as API/CLI input.

Semantic results expose separate structured `warnings` without changing `valid`.
Valid entities without explicit primary keys receive WRN001 at their names;
SQL generation retains its implicit integer id behavior. Existing direct-IR
optimizer field/type/endpoint conflicts and invalid-IR fallback use WRN002-005
instead of strings (use `.message` for text). CLI/API/playground aggregate
warnings in phase/location/code order; warning-only compilation remains successful,
HTTP 200, CLI exit 0, with six succeeded phases and unchanged generated files.
