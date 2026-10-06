# ⚙ APIForge

### A Domain-Specific Language Compiler for Automatic REST API Generation

> **Academic Project** — Compiler Design Course

---

## 📌 What is APIForge?

APIForge is a **custom 6-phase compiler** that takes a simple Domain-Specific
Language (DSL) as input and generates a complete, runnable backend:

1. **MySQL database schema** — `CREATE TABLE` statements, foreign keys, and junction tables
2. **Express.js REST API** — models, controllers, CRUD routes, and a ready-to-run server
3. **OpenAPI / Swagger specification** — `swagger.json` describing every endpoint

Instead of hand-writing database schemas and API boilerplate, you describe your
entities and their relationships in a clean, readable `.apiforge` file and let the
compiler do the rest. A browser-based playground is included so you can edit DSL and
watch each compiler phase run live.

For the complete syntax, validation rules, and worked examples, read the
[APIForge Language Guide](docs/APIForge-Language-Guide.md).

G27 adds an explicit PostgreSQL 18 target while MySQL remains the default.
Use `node index.js source.apiforge --target postgres`, library options
`{ target: 'postgres' }`, or an HTTP compile body with `target: "postgres"`.
The browser continues to generate MySQL. See [the PostgreSQL contract](docs/postgres-target.md)
and [native verification](docs/postgres-target-verification.md).

G28 adds local filesystem imports with one global entity/relation namespace.
Put `IMPORT "./models/item.apiforge"` declarations before entities and relations,
then compile the entry with `node index.js project/main.apiforge` and optional
`--root project` / `--target postgres`. Nested and duplicate imports resolve once
per physical file before whole-program semantics. The browser remains single
source and reports INP010 for imports. G26 `--to` operations also accept imported
entry files. See [the module contract](docs/modules.md) and
[G28 verification](docs/modules-verification.md).

G26 provides a separate offline `migrate.js` CLI for physical snapshots,
explicit baselines, schema diffs, and immutable MySQL migration revisions.
It targets the certified `mysql-8.4-v1` profile and requires exact plan-bound
authorization for destructive operations and data-check prerequisites.
See [the migration workflow](docs/schema-migrations.md) and
[verification evidence](docs/schema-migrations-verification.md).

DATE and TIMESTAMP are first-class types. DATE uses Gregorian `YYYY-MM-DD`
strings (1000-01-01 through 9999-12-31); TIMESTAMP uses UTC
`YYYY-MM-DDTHH:mm:ssZ` strings (1970-01-01T00:00:01Z through
2038-01-19T03:14:07Z). Quoted static defaults, REQUIRED, UNIQUE, exact filters
and sorting are supported. Offsets, fractions, dynamic defaults and temporal
bounds are unavailable. Generated MySQL sessions await UTC initialization;
reads and private write copies preserve the public canonical representation.
See [G24 verification and limitations](docs/date-timestamp-verification.md).

---

## 📝 DSL Syntax Example

**Entities:**

```
ENTITY Student

    id      INT     PRIMARY KEY
    name    STRING  REQUIRED
    email   STRING  UNIQUE
    age     INT
    cgpa    FLOAT
    active  BOOLEAN
```

**Relationships** (declared between two entities):

```
ENTITY Student
    id    INT     PRIMARY KEY
    name  STRING  REQUIRED

ENTITY Course
    id     INT     PRIMARY KEY
    title  STRING  REQUIRED

RELATION Student ENROLLS_IN Course MANY_TO_MANY
```

This compiles into a MySQL schema (including the `Student_Course` junction table),
a full Express REST API for both entities, and an OpenAPI document — automatically.

---

## 🏗 Compiler Pipeline

The compiler follows the classic **6-phase compiler architecture**. Every phase is
fully implemented and its output is printed to the console when you compile a file.

```
Source Code (.apiforge)
       │
       ▼
┌─────────────────┐
│  1. LEXER        │  Breaks source code into tokens
│     (Tokenizer)  │  Input: raw string → Output: token array
└────────┬─────────┘
         ▼
┌─────────────────┐
│  2. PARSER       │  Builds Abstract Syntax Tree (AST)
│     (Syntax)     │  Input: tokens → Output: AST
└────────┬─────────┘
         ▼
┌─────────────────┐
│  3. SEMANTIC     │  Validates types, duplicates, relationships
│     ANALYZER     │  Collects ALL errors (line + column)
└────────┬─────────┘
         ▼
┌─────────────────┐
│  4. IR GENERATOR │  Creates intermediate representation
│                  │  Input: AST → Output: IR instructions
└────────┬─────────┘
         ▼
┌─────────────────┐
│  5. OPTIMIZER    │  Runs 6 IR optimization passes
│                  │  Input: IR → Output: optimized IR
└────────┬─────────┘
         ▼
┌─────────────────┐
│  6. CODE         │  Generates MySQL + Express API + OpenAPI
│     GENERATOR    │  Input: IR → Output: .sql + .js + .json
└─────────────────┘
```

### Phase 5 — Optimizer passes

The optimizer is **not** a pass-through. It applies six real, target-independent
passes to the IR and reports which ones fired:

| Pass | What it does |
|------|--------------|
| **Constraint Normalization** | De-duplicates and canonically orders each field's constraints |
| **Duplicate Validation Elimination** | Removes redundant numeric and STRING-length validation rules on the same field |
| **Validation Order Normalization** | Canonically orders `MIN`, `MAX`, `MIN_LENGTH`, and `MAX_LENGTH` for consistency |
| **Duplicate Entity Elimination** | Removes repeated `CREATE_ENTITY` instructions |
| **Duplicate Field Elimination** | Removes repeated fields (and flags conflicting re-declarations) |
| **Duplicate Relationship Elimination** | Removes identical `CREATE_RELATION` instructions |

---

## 📁 Project Structure

```
APIForge/
├── index.js                      # CLI entry point — runs the full 6-phase pipeline
├── server.js                     # Web playground server (Express, port 3001)
├── package.json                  # Project configuration and scripts
├── README.md                     # This file
│
├── samples/                      # Sample .apiforge DSL files
│   ├── student.apiforge          #   Single-entity example
│   ├── student_course_rel.apiforge  # MANY_TO_MANY relationship example
│   ├── student_validation.apiforge  # MIN, MAX, and DEFAULT validations example
│   ├── string_length_validation.apiforge # STRING length validation example
│   ├── one_to_one.apiforge       #   ONE_TO_ONE relationship example
│   ├── one_to_many.apiforge      #   ONE_TO_MANY relationship example
│   ├── dup_rel.apiforge          #   Duplicate-relationship (semantic error demo)
│   └── invalid_rel.apiforge      #   Missing-target-entity (semantic error demo)
│
├── src/                          # Compiler source code
│   ├── lexer/lexer.js            # Phase 1: source → tokens
│   ├── parser/parser.js          # Phase 2: tokens → AST
│   ├── ast/ast.js                # AST node definitions (Program/Entity/Field/Relation)
│   ├── semantic/analyzer.js      # Phase 3: validation + symbol table
│   ├── ir/generator.js           # Phase 4: AST → IR instructions
│   ├── optimizer/optimizer.js    # Phase 5: 6 IR optimization passes
│   ├── codegen/codegen.js        # Phase 6: MySQL + Express + OpenAPI generation
│   ├── api/compiler-api.js       # Programmatic pipeline wrapper (used by the web server)
│   └── utils/errors.js           # Levenshtein "did you mean?" + code-frame helpers
│
├── frontend/                     # Web-based compiler playground
│   ├── index.html                #   Editor UI
│   ├── app.js                    #   Calls /api/compile, renders per-phase output + errors
│   └── style.css                 #   Styling
│
├── output/                       # Generated artifacts (see below)
│   ├── database/schema.sql
│   ├── config/db.js
│   ├── models/*.js
│   ├── controllers/*.js
│   ├── routes/*.js
│   ├── package.json
│   ├── README.md
│   ├── server.js
│   ├── swagger.json
│   └── .env.example
│
└── tests/                        # Custom test suite (988+ tests, no dependencies)
    └── test.js                   #   Per-phase + end-to-end + sample coverage
```

---

## 📦 Generated Artifacts

Generated names are allocated without silent renaming. SEM034 rejects colliding
table/column names, case-insensitive model/controller/route files and pluralized
resource paths, including Student/student and Category/Categorie. Prototype-sensitive
identifiers remain supported through own-key registries. See
[naming verification](docs/generated-naming-collision-verification.md).

Compiling a `.apiforge` file writes a complete backend into `output/`:

| File | Description |
|------|-------------|
| `database/schema.sql` | MySQL DDL — tables, primary keys, foreign keys, junction tables |
| `config/db.js` | `mysql2/promise` connection pool |
| `.env.example` | Environment-variable template (DB host/port/user/password/name) |
| `package.json` | Generated backend metadata, runtime dependencies, and `npm start` script |
| `README.md` | Generated-project installation and startup guide |
| `models/<Entity>.js` | Data-access model per entity (parameterized queries + relationship helpers) |
| `controllers/<entity>Controller.js` | CRUD controller per entity |
| `routes/<entity>Routes.js` | Express router per entity |
| `server.js` | Express app that mounts every route |
| `swagger.json` | OpenAPI 3 specification for the generated API |

> A single-entity DSL produces **10 files**; each additional entity adds its model,
> controller, and routes.

Each successful CLI compilation reconciles the generator-owned `models/`,
`controllers/`, `routes/`, `config/`, and `database/` directories with the latest
project, so entity artifacts from older compilations do not remain. Root-level
user files that APIForge does not generate, such as `output/.env`, are preserved.
Generation writes and verifies a complete project in a unique sibling staging
directory before replacing `output/`. Handled publication failures restore the
previous project through reverse user-root moves; user entries are preserved
as whole filesystem objects with same-filesystem renames. If rollback itself
fails, recovery paths are reported and surviving user data is retained. The
new project remains published if backup cleanup fails after publication,
and the CLI reports the retained backup with exit status 1.
See [publication and failure behavior](docs/atomic-output-publication-verification.md).

Entities without an explicit primary key consistently use generated integer `id`
for item CRUD, create responses, relationships, collections and OpenAPI. WRN001
reports valid implicit-key use; a declared id in any casing without an explicit
key fails SEM033. Source AST/symbols/IR remain unchanged, and OpenAPI marks the
generated id readOnly without requiring it as request input.

### Generated write requests

POST and PUT bodies must be JSON objects containing only source-declared fields.
Unknown fields, implicit generated id and SQL-added relationship columns return
400 before model access. INT requires a finite safe integer, FLOAT a finite
number, BOOLEAN a boolean, STRING a string, and ENUM an exact member string.
Existing bounds and Unicode code-point lengths still apply.

POST requires REQUIRED fields unless DEFAULT or an auto-increment key supplies
omission. PUT remains partial, including `{}`. REQUIRED null is rejected;
optional null is accepted. Defaults remain database-applied. POST accepts explicit
primary keys; create responses prefer a supplied explicit key, then a generated
insertId, then the declared key DEFAULT, without reloading arbitrary defaults.
For explicit auto-generated INT keys only, supplied null or numeric zero uses
the actual insertId: generated values replace the input, and insertId zero
preserves stored zero under NO_AUTO_VALUE_ON_ZERO. Supplied nonzero keys and
defaulted INT/STRING key precedence remain unchanged.
An explicit INT PRIMARY KEY without DEFAULT is AUTO_INCREMENT. The generated
API rejects negative supplied keys with HTTP 400 before model/DB access; positive
safe integers, zero, omission and optional null remain supported. Ordinary INT
fields and INT keys WITH DEFAULT retain negative values. MIN/MAX on an INT key
without DEFAULT fails SEM037 because MySQL CHECK constraints cannot reference
AUTO_INCREMENT columns; bounded keys WITH DEFAULT remain supported.
PUT rejects any explicit key property with 400 before model access, even the same
value or null; identity comes from URL `:id`. OpenAPI uses distinct Create/Update/Read operation roles; Update omits the immutable
key and optional inputs are nullable. Generated DB errors use safe generic messages:
409 for known write/delete conflicts, 400 for DB-rejected write values, 503 for
known temporary connection/capacity/lock failures, and 500 for unknown failures.
Reads retain 500/503; collection validation remains 400 before database access.
Declared BOOLEAN database rows normalize to booleans, including related targets.
Read schemas expose SQL-added FK columns as readOnly; UNIQUE remains database-enforced. Generated malformed
JSON returns sanitized 400; the compiler API retains its 500/INP002 contract.
See [verification and remaining limits](docs/generated-request-validation-verification.md).
The [G06 database error taxonomy verification](docs/generated-db-error-taxonomy-verification.md)
lists exact driver identifiers, endpoint statuses, safety tests and live DB limitations.
The [primary-key contract verification](docs/primary-key-contract-verification.md)
records the G12/G13 correction and retained database/OpenAPI limits.


---

## Collection query options

Generated collection GET endpoints preserve `{ success: true, data: [...] }`.
For an entity with these fields, examples include:

```text
GET /students?age=21
GET /students?sort=name&order=asc
GET /students?page=2&limit=20
GET /students?status=active&sort=name&order=desc&page=1&limit=10
```

- Filters use SQL equality on query/read fields, including implicit `id`: INT requires
  a safe integer, FLOAT a finite decimal/exponent number, BOOLEAN exactly `true` or
  `false`, STRING raw text, and ENUM an exact declared member. Multiple filters use AND.
- `sort` accepts known fields; `order` accepts lowercase `asc` or `desc`, defaults
  to `asc`, and requires `sort`.
- Pagination starts only when `page` or `limit` is supplied. Defaults are page 1,
  limit 20; maximum limit is 100. Both require positive decimal integers without
  leading zeros, and the computed offset must be safe. Otherwise results remain
  unbounded with no COUNT query. Pagination uses primary-key ordering/tie-breaking.
- Paginated responses add `X-Total-Count`, `X-Page`, `X-Limit`, and `X-Total-Pages`
  headers. Counts apply the same filters; no matches means zero total pages, and
  pages beyond the last return an empty data array.
- `page`, `limit`, `sort`, and `order` are reserved. Fields with these names can be
  sorted but cannot be filtered. Unknown, repeated/non-scalar, or invalid query
  values return 400 before DB access. No special null-filter syntax exists.

Values, LIMIT, and OFFSET are bound SQL parameters; identifiers and ordering come
from trusted generated metadata. Item GET, write, and relationship routes retain
their existing behavior. Generated OpenAPI and README document this contract.
See [verification and compatibility evidence](docs/collection-query-verification.md).

---

## 🔗 Relationships

Relationships preserve their existing cardinality and route shapes. SEM034 rejects
duplicate generated FK/junction/helper/path allocations and conflicts with declared
columns/tables or CRUD handlers. All four cardinalities quote trusted SQL identifiers
consistently while keeping request values bound. See
[relationship verification](docs/relationship-generation-safety-verification.md).

APIForge supports all four cardinalities. Each maps to a specific SQL shape:

| Cardinality | SQL mapping |
|-------------|-------------|
| `MANY_TO_MANY` | Creates a junction table `Source_Target` with a **composite primary key** and two foreign keys, both `ON DELETE CASCADE` |
| `ONE_TO_MANY` | Adds a foreign-key column on the **many** side (the target), `ON DELETE SET NULL` |
| `MANY_TO_ONE` | Adds a foreign-key column on the **source** side, `ON DELETE SET NULL` |
| `ONE_TO_ONE` | Adds a `UNIQUE` foreign-key column on the target side, `ON DELETE CASCADE` |

Example — `RELATION Student ENROLLS_IN Course MANY_TO_MANY` produces:

```sql
CREATE TABLE Student_Course (
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES Student(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES Course(id) ON DELETE CASCADE
);
```

---

## 🔑 Supported Keywords

| Keyword     | Description                                   |
|-------------|-----------------------------------------------|
| `ENTITY`    | Declares a new database entity/table          |
| `RELATION`  | Declares a relationship between two entities   |
| `PRIMARY`   | Marks a field as primary key (used with `KEY`) |
| `KEY`       | Used with `PRIMARY` to form `PRIMARY KEY`      |
| `REQUIRED`  | Field cannot be null (`NOT NULL`)              |
| `UNIQUE`    | Field must have unique values                  |
| `MIN`       | Minimum numeric value constraint (`CHECK (col >= val)`) |
| `MAX`       | Maximum numeric value constraint (`CHECK (col <= val)`) |
| `MIN_LENGTH` | Minimum STRING length (`CHAR_LENGTH(col) >= val`) |
| `MAX_LENGTH` | Maximum STRING length (`CHAR_LENGTH(col) <= val`) |
| `DEFAULT`   | Default column value (`DEFAULT val`)          |

## 📊 Supported Data Types

| Type      | Maps to MySQL     | Description              |
|-----------|-------------------|--------------------------|
| `INT`     | `INT`             | Integer numbers          |
| `STRING`  | `VARCHAR(255)` by default | Text strings; widened when a declared length bound exceeds 255 |
| `FLOAT`   | `FLOAT`           | Decimal numbers          |
| `BOOLEAN` | `BOOLEAN`         | True/false values        |
| `UUID` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` | Canonical lowercase UUID text; ordinary field or explicit primary key |
| `ENUM("a", "b")` | `ENUM('a', 'b')` | Finite set of case-sensitive strings |

ENUM fields declare one or more quoted strings in source order:

```apiforge
status ENUM("active", "inactive") DEFAULT "active"
role ENUM("student", "faculty", "admin") REQUIRED UNIQUE
```

Values are case-sensitive; duplicates are invalid. DEFAULT must be a quoted
member. REQUIRED and UNIQUE are allowed; PRIMARY KEY supports INT, STRING
and UUID. MIN/MAX and MIN_LENGTH/MAX_LENGTH are invalid on ENUM. Whitespace,
comments and multiline value lists follow the normal token grammar. Strings
retain literal backslashes; no string escape syntax is added.

Generation uses native MySQL ENUM with a case-sensitive binary collation,
escaped literals, Express POST/PUT membership checks and OpenAPI `type: "string"`
with `enum` and optional `default`. Omitted fields keep existing database-default
behavior. Optional null is allowed; supplied null for REQUIRED ENUM is rejected.
Try `samples/enum_account.apiforge` or the ENUM Account playground preset.

> A `PRIMARY KEY` may only be declared on an `INT`, `STRING` or `UUID` field.

UUID accepts exact lowercase `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` strings,
including all versions and nil/max values. REQUIRED, UNIQUE and quoted canonical
static DEFAULT values are supported; numeric and length bounds are rejected.
An explicit UUID key without DEFAULT generates with Node core `crypto.randomUUID()`
when omitted or supplied as optional null; REQUIRED null is rejected. Supplied keys
are preserved, and static UUID key defaults never generate. Ordinary UUID fields
never generate. Keys remain immutable on PUT. UUID bodies, equality filters and
item/relationship UUID path parameters fail with HTTP 400 before DB access when
invalid. All CRUD/relationship reads reject malformed stored UUIDs with sanitized
500 responses. OpenAPI includes string/uuid and the exact lowercase pattern.
See [G25 verification](docs/uuid-verification.md) and `samples/uuid.apiforge`.

---

## 🛡 Field Validations & Default Values

Fields can declare numeric bounds, STRING length bounds, and default values:

```
ENTITY Student

    id      INT      PRIMARY KEY
    name    STRING   REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
    age     INT      MIN 18 MAX 60 DEFAULT 25
    cgpa    FLOAT    MIN 0.0 MAX 10.0 DEFAULT 8.5
    status  STRING   DEFAULT "active" MIN_LENGTH 3 MAX_LENGTH 20
    active  BOOLEAN  DEFAULT TRUE
```

- **`MIN <number>`** & **`MAX <number>`**:
  - Allowed for `INT` and `FLOAT` fields (negative values such as `MIN -10` supported).
  - Semantic analysis verifies `MIN <= MAX` and ensures integer types have integer bounds.
  - Generates SQL `CHECK (age >= 18 AND age <= 60)` table constraints.
  - Adds OpenAPI `minimum` and `maximum` properties in `swagger.json`.
  - Generates input validation logic in Express controllers (`validateStudent(data)`).
- **`MIN_LENGTH <integer>`** & **`MAX_LENGTH <integer>`**:
  - Allowed only for `STRING` fields; values must be non-negative integers.
  - May be used independently or together; when combined, `MIN_LENGTH <= MAX_LENGTH` is required.
  - Generates MySQL `CHAR_LENGTH` checks (and widens `VARCHAR` capacity when a bound exceeds 255), Unicode-aware Express validation, and OpenAPI `minLength` / `maxLength` metadata.
  - STRING defaults are checked against the declared length bounds during semantic analysis.
- **`DEFAULT <literal>`**:
  - Type-checked against field data type (integers for `INT`, numbers for `FLOAT`, quoted strings for `STRING`, declared quoted members for `ENUM`, `TRUE`/`FALSE` for `BOOLEAN`).
  - Semantic analysis verifies default values satisfy applicable numeric or STRING-length boundaries.
  - Generates SQL `DEFAULT` clauses and OpenAPI `default` properties.

---

## 🧭 Error Handling

APIForge is designed to fail helpfully:

- **Line _and_ column** positions on lexer, parser, and semantic errors.
- **Source code frames** — the CLI prints the offending source line with a `^` caret
  pointing at the exact token.
- **"Did you mean?" suggestions** — a typo like `STRIMG` or `MANY_TO_MANU` is matched
  (via Levenshtein edit distance) to the closest valid keyword and suggested.
- **All-at-once semantic reporting** — the semantic analyzer collects every error in
  a single pass instead of stopping at the first one.

The compiler, CLI, HTTP API and playground share stable diagnostic codes,
optional source ranges and deterministic hints. Existing messages and symbolic
codes remain available. See [Structured compiler diagnostics](docs/structured-diagnostics.md)
for the format, full registry and compatibility details. Non-fatal warnings use
the same model and separate `WRN` codes: omitted primary keys produce `WRN001`,
and existing direct-IR optimizer warnings are structured too. Warning-only
compilations still generate all files, return HTTP 200 and exit 0 in the CLI.

Example:

```text
SEM017: MIN value 60 cannot be greater than MAX value 18.
  --> line 2, column 9
2 | age INT MIN 60 MAX 18
  |         ^^^^^^
Hint: MIN must not exceed MAX.
```

---

## 🌐 Web Playground

A browser-based editor lets you write DSL and watch the compiler run live —
per-phase output, generated files, and inline error carets.

```bash
npm run dev
```

Then open **http://localhost:3001**.

The server exposes a small JSON API:

| Method & Path        | Description                                 |
|----------------------|---------------------------------------------|
| `GET  /`             | Serves the playground UI                    |
| `POST /api/compile`  | Runs the full pipeline on posted DSL source |
| `GET  /api/health`   | Health check                                |

The compile API returns generated files in memory. Downloading a project builds
the ZIP in your browser; neither action writes to the repository's `output/`.

---

## 🚀 How to Run

### Prerequisites
- Node.js (v18 or higher)

### Install Dependencies
```bash
npm install
```

### Compile the Sample File
```bash
npm run compile
```
This compiles `samples/student.apiforge` and writes the generated backend to `output/`.

### Compile Any File
```bash
node index.js samples/student_course_rel.apiforge
```

Run these commands from the APIForge repository directory. The CLI writes to
`output/` in the current working directory, regardless of the input file's location.

### Launch the Web Playground
```bash
npm run dev
```

### Run the Test Suite
```bash
npm test
```
Executes the comprehensive test suite (1000+ tests across all 6 compiler phases, error utilities, and end-to-end pipelines).

For a focused check of generated-output replacement, rollback, and stale-file
cleanup, run:

```bash
npm run test:disk-generation
```

These tests use temporary directories and do not need a MySQL server.

To verify a generated backend as a standalone consumer project, run the opt-in integration harness:

```bash
npm run test:generated-integration
```

This network-dependent check generates into a temporary directory, runs `npm install` and `npm start`, verifies `GET /health`, then stops the server and removes the temporary project. It is intentionally excluded from `npm test`.

To verify a generated backend end to end against an explicitly configured MySQL server, set these environment variables:

```text
APIFORGE_TEST_DB_HOST
APIFORGE_TEST_DB_PORT
APIFORGE_TEST_DB_USER
APIFORGE_TEST_DB_PASSWORD
```

Then run:

```bash
npm run test:generated-mysql
```

The MySQL harness creates a uniquely named `apiforge_e2e_*` database, imports the generated schema, exercises database-backed CRUD, defaults, validation, and a many-to-many relationship, and drops that database during cleanup. The configured user therefore needs permission to create and drop databases. The harness never uses a configured database name, does not install MySQL or require Docker, and reports missing configuration as an error. It is also excluded from `npm test`.

---

## 🛠 Tech Stack

| Technology    | Purpose                          |
|---------------|----------------------------------|
| Node.js       | Compiler runtime                 |
| JavaScript    | Implementation language          |
| Express.js    | Web playground + generated API   |
| MySQL (mysql2)| Target database for generated code |
| HTML/CSS/JS   | Frontend playground editor       |

---

## 📋 Roadmap

- [x] Project structure and scaffolding
- [x] Phase 1: Lexer implementation
- [x] Phase 2: Parser implementation
- [x] Phase 3: Semantic analyzer implementation
- [x] Phase 4: IR generator implementation
- [x] Phase 5: Optimizer (6 passes)
- [x] Phase 6: MySQL code generator
- [x] Phase 6: REST API code generator (Express + OpenAPI)
- [x] Frontend web playground
- [x] Entity relationships support (all 4 cardinalities)
- [x] Position-aware errors + "did you mean?" suggestions
- [x] Local filesystem imports and whole-program module compilation
- [ ] Advanced IR optimizations
- [ ] Additional database targets (PostgreSQL, SQLite)
- [ ] Authentication scaffolding in generated APIs

---

## 👥 Authors

*Compiler Design Course Project*

---

## 📜 License

MIT
