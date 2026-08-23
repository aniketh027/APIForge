# ⚙ APIForge

### A Domain-Specific Language Compiler for Automatic REST API Generation

> **Academic Project** — Compiler Design Course

---

## 📌 What is APIForge?

APIForge is a **custom compiler** that takes a simple Domain-Specific Language (DSL) as input and generates:

1. **MySQL database schema** (CREATE TABLE statements)
2. **REST API backend** (Express.js CRUD routes) *(future)*

Instead of manually writing database schemas and API boilerplate, you define your entities in a clean, readable `.apiforge` file and let the compiler do the rest.

---

## 📝 DSL Syntax Example

```
ENTITY Student

    id      INT     PRIMARY KEY
    name    STRING  REQUIRED
    email   STRING  UNIQUE
    age     INT
    cgpa    FLOAT
```

This gets compiled into MySQL schema and REST API code automatically.

---

## 🏗 Compiler Pipeline

The compiler follows the classic **6-phase compiler architecture**:

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
│  3. SEMANTIC     │  Validates types, duplicates, logic
│     ANALYZER     │  Input: AST → Output: validated AST
└────────┬─────────┘
         ▼
┌─────────────────┐
│  4. IR GENERATOR │  Creates intermediate representation
│                  │  Input: AST → Output: IR instructions
└────────┬─────────┘
         ▼
┌─────────────────┐
│  5. OPTIMIZER    │  Optimizes the IR (future phase)
│                  │  Input: IR → Output: optimized IR
└────────┬─────────┘
         ▼
┌─────────────────┐
│  6. CODE         │  Generates MySQL + API code
│     GENERATOR    │  Input: IR → Output: .sql + .js files
└─────────────────┘
```

---

## 📁 Project Structure

```
APIForge/
├── index.js                    # Main entry point — runs the compiler pipeline
├── package.json                # Project configuration and scripts
├── README.md                   # This file
│
├── samples/                    # Sample .apiforge DSL files
│   └── student.apiforge        # Example: Student entity definition
│
├── src/                        # Compiler source code
│   ├── lexer/                  # Phase 1: Lexical Analysis (Tokenizer)
│   │   └── lexer.js            #   Converts source code → tokens
│   │
│   ├── parser/                 # Phase 2: Syntax Analysis (Parser)
│   │   └── parser.js           #   Converts tokens → AST
│   │
│   ├── ast/                    # AST Node Definitions
│   │   └── ast.js              #   ProgramNode, EntityNode, FieldNode
│   │
│   ├── semantic/               # Phase 3: Semantic Analysis
│   │   └── analyzer.js         #   Validates logic (duplicates, types, etc.)
│   │
│   ├── ir/                     # Phase 4: Intermediate Representation
│   │   └── generator.js        #   Converts AST → IR instructions
│   │
│   ├── optimizer/              # Phase 5: Code Optimization
│   │   └── optimizer.js        #   Optimizes IR (pass-through for now)
│   │
│   └── codegen/                # Phase 6: Target Code Generation
│       └── codegen.js          #   Generates MySQL schema + API code
│
├── frontend/                   # Web-based compiler interface (future)
│   └── index.html              #   Editor UI for writing and compiling DSL
│
├── output/                     # Generated output files
│   └── README.md               #   (schema.sql, routes/ will appear here)
│
└── tests/                      # Test suite
    └── test.js                 #   Tests for each compiler phase
```

---

## 🔑 Supported Keywords

| Keyword     | Description                           |
|-------------|---------------------------------------|
| `ENTITY`    | Declares a new database entity/table  |
| `PRIMARY`   | Marks a field as primary key (used with KEY) |
| `KEY`       | Used with PRIMARY to form PRIMARY KEY |
| `REQUIRED`  | Field cannot be null (NOT NULL)       |
| `UNIQUE`    | Field must have unique values         |

## 📊 Supported Data Types

| Type      | Maps to MySQL     | Description              |
|-----------|-------------------|--------------------------|
| `INT`     | `INT`             | Integer numbers          |
| `STRING`  | `VARCHAR(255)`    | Text strings             |
| `FLOAT`   | `FLOAT`           | Decimal numbers          |
| `BOOLEAN` | `TINYINT(1)`      | True/false values        |

---

## 🚀 How to Run

### Prerequisites
- Node.js (v14 or higher)

### Install Dependencies
```bash
npm install
```

### Compile a DSL File
```bash
npm run compile
```
This compiles the sample `samples/student.apiforge` file.

Or compile any file directly:
```bash
node index.js path/to/your/file.apiforge
```

### Run Tests
```bash
npm test
```

---

## 🛠 Tech Stack

| Technology    | Purpose                          |
|---------------|----------------------------------|
| Node.js       | Compiler runtime                 |
| JavaScript    | Implementation language          |
| Express.js    | REST API server (future)         |
| MySQL         | Target database (future)         |
| HTML/CSS/JS   | Frontend editor (future)         |

---

## 📋 Roadmap

- [x] Project structure and scaffolding
- [ ] Phase 1: Lexer implementation
- [ ] Phase 2: Parser implementation
- [ ] Phase 3: Semantic analyzer implementation
- [ ] Phase 4: IR generator implementation
- [ ] Phase 5: Optimizer implementation
- [ ] Phase 6: MySQL code generator
- [ ] Phase 6: REST API code generator
- [ ] Frontend web editor
- [ ] Entity relationships support
- [ ] Advanced optimizations

---

## 👥 Authors

*Compiler Design Course Project*

---

## 📜 License

MIT
