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
- The parser accepts an empty token stream as an empty `Program`, and semantic analysis currently considers that empty AST valid. The HTTP compiler API independently rejects missing, blank, or non-string source before lexing. Do not assume all entry points handle empty input identically.
- An entity with no fields parses but fails semantic analysis.
- A relation declaration has exactly four operands after `RELATION`: source entity, relation name, target entity, and cardinality.

## Defaults, validation, and primary keys

- Defaults are typed AST/IR values: `NUMBER`, `STRING`, or `BOOLEAN`. Duplicate defaults and type/range mismatches are semantic errors.
- `MIN`/`MAX` are numeric-only; `INT` bounds must be integers; `MIN` cannot exceed `MAX`.
- Semantic analysis does not require an explicit primary key. During SQL generation, an entity without one receives `id INT PRIMARY KEY AUTO_INCREMENT`; the source AST/IR is not rewritten to add that field.
- `INT PRIMARY KEY` normally becomes `PRIMARY KEY AUTO_INCREMENT`. With an explicit default, such as `INT PRIMARY KEY DEFAULT 1`, codegen omits `AUTO_INCREMENT` and emits the default.
- `STRING` primary keys are allowed and are not auto-incremented. `FLOAT` and `BOOLEAN` primary keys are rejected.

## Generated backend

Codegen returns or writes:

```text
database/schema.sql
config/db.js
.env.example
models/<Entity>.js
controllers/<entity>Controller.js
routes/<entity>Routes.js
server.js
swagger.json
```

It does not currently emit a generated `package.json`.

- Entity CRUD routers expose `GET /`, `GET /:id`, `POST /`, `PUT /:id`, and `DELETE /:id`.
- The generated server mounts each router directly at a lowercase plural path such as `/students`; it does not add `/api`. The repository development server uses `/api` only for the compiler endpoints (`/api/compile`, `/api/health`).
- Relationship endpoints are generated on the source entity router. `MANY_TO_MANY` gets list/add/remove routes; `ONE_TO_MANY` gets a list route; `MANY_TO_ONE` and `ONE_TO_ONE` get a singular target route.
- SQL relationship layout is target-specific: junction table for `MANY_TO_MANY`, target-side foreign key for `ONE_TO_MANY` and `ONE_TO_ONE`, and source-side foreign key for `MANY_TO_ONE`.

## Compiler HTTP status conventions

`POST /api/compile` returns:

| Condition | Status |
|---|---:|
| Missing/blank/non-string source | 400 |
| Lexer error | 400 |
| Parser error | 400 |
| Semantic error | 422 |
| IR, optimizer, codegen, or unexpected internal error | 500 |
| Successful compilation | 200 |

The current Language Guide's generated CRUD examples include an `/api/<plural>` prefix, but generated `output/server.js` mounts `/<plural>` directly. Follow the implementation and tests unless a task explicitly changes that contract.
