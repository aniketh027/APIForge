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
| **Duplicate Validation Elimination** | Removes redundant MIN/MAX validation rules on the same field |
| **Validation Order Normalization** | Canonically orders validations (MIN before MAX) for consistency |
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
│   ├── server.js
│   ├── swagger.json
│   └── .env.example
│
└── tests/                        # Custom test suite (988+ tests, no dependencies)
    └── test.js                   #   Per-phase + end-to-end + sample coverage
```

---

## 📦 Generated Artifacts

Compiling a `.apiforge` file writes a complete backend into `output/`:

| File | Description |
|------|-------------|
| `database/schema.sql` | MySQL DDL — tables, primary keys, foreign keys, junction tables |
| `config/db.js` | `mysql2/promise` connection pool |
| `.env.example` | Environment-variable template (DB host/user/password/name) |
| `models/<Entity>.js` | Data-access model per entity (parameterized queries + relationship helpers) |
| `controllers/<entity>Controller.js` | CRUD controller per entity |
| `routes/<entity>Routes.js` | Express router per entity |
| `server.js` | Express app that mounts every route |
| `swagger.json` | OpenAPI 3 specification for the generated API |

> A single-entity DSL produces **8 files**; each additional entity adds its model,
> controller, and routes.

---

## 🔗 Relationships

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
| `DEFAULT`   | Default column value (`DEFAULT val`)          |

## 📊 Supported Data Types

| Type      | Maps to MySQL     | Description              |
|-----------|-------------------|--------------------------|
| `INT`     | `INT`             | Integer numbers          |
| `STRING`  | `VARCHAR(255)`    | Text strings             |
| `FLOAT`   | `FLOAT`           | Decimal numbers          |
| `BOOLEAN` | `BOOLEAN`         | True/false values        |

> A `PRIMARY KEY` may only be declared on an `INT` or `STRING` field.

---

## 🛡 Field Validations & Default Values

Fields can declare numeric boundary constraints and default values:

```
ENTITY Student

    id      INT      PRIMARY KEY
    name    STRING   REQUIRED
    age     INT      MIN 18 MAX 60 DEFAULT 25
    cgpa    FLOAT    MIN 0.0 MAX 10.0 DEFAULT 8.5
    status  STRING   DEFAULT "active"
    active  BOOLEAN  DEFAULT TRUE
```

- **`MIN <number>`** & **`MAX <number>`**:
  - Allowed for `INT` and `FLOAT` fields (negative values such as `MIN -10` supported).
  - Semantic analysis verifies `MIN <= MAX` and ensures integer types have integer bounds.
  - Generates SQL `CHECK (age >= 18 AND age <= 60)` table constraints.
  - Adds OpenAPI `minimum` and `maximum` properties in `swagger.json`.
  - Generates input validation logic in Express controllers (`validateStudent(data)`).
- **`DEFAULT <literal>`**:
  - Type-checked against field data type (integers for `INT`, numbers for `FLOAT`, quoted strings for `STRING`, `TRUE`/`FALSE` for `BOOLEAN`).
  - Semantic analysis verifies default values fall within `[MIN, MAX]` boundaries.
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

Example:

```
[✗] Semantic analysis failed — 1 error(s):
    1. Line 9, Column 23: Target entity 'Studet' in relationship 'LINKS' does not exist. Did you mean 'Student'?
       9 | RELATION Course LINKS Studet MANY_TO_MANY
         |                       ^
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

---

## 🚀 How to Run

### Prerequisites
- Node.js (v14 or higher)

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

### Launch the Web Playground
```bash
npm run dev
```

### Run the Test Suite
```bash
npm test
```
Executes the comprehensive test suite (1000+ tests across all 6 compiler phases, error utilities, and end-to-end pipelines).

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
- [ ] Advanced IR optimizations
- [ ] Additional database targets (PostgreSQL, SQLite)
- [ ] Authentication scaffolding in generated APIs

---

## 👥 Authors

*Compiler Design Course Project*

---

## 📜 License

MIT
