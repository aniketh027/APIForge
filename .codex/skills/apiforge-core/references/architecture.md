# Architecture

APIForge compiles a small declarative backend language into MySQL DDL, a modular Express.js REST service, runtime request validation, relationship operations, and an OpenAPI 3.0 document.

## Compiler phases

| Phase | Current owner | Boundary |
|---|---|---|
| Lexer | `src/lexer/lexer.js` | Converts source characters to positioned tokens; removes whitespace and `//` comments. |
| Parser / AST | `src/parser/parser.js`, `src/ast/ast.js` | Builds `ProgramNode` containing entity, field, and relation nodes; reports syntax errors. |
| Semantic analysis | `src/semantic/analyzer.js` | Enforces cross-node rules and owns the entity and relationship symbol tables. |
| IR generation | `src/ir/generator.js` | Lowers validated AST data to `CREATE_ENTITY`, `ADD_FIELD`, and `CREATE_RELATION` instructions and validates their schema. |
| Optimizer | `src/optimizer/optimizer.js` | Normalizes constraints/validations and removes exact duplicate entities, fields, and relationships while preserving conflicts with warnings. |
| Target code generation | `src/codegen/codegen.js` | Produces SQL, database configuration, models, controllers, routes, an Express server, environment template, and OpenAPI JSON. |

`index.js` runs the disk-writing CLI pipeline. `src/api/compiler-api.js` runs the same modules in memory for the web playground; it calls codegen with disk writes disabled.

## Information flow

- Field constraints, numeric `MIN`/`MAX`, STRING `MIN_LENGTH`/`MAX_LENGTH`, and typed defaults become structured AST properties, then target-independent `ADD_FIELD` data. Codegen maps them to MySQL constraints/defaults/checks, controller validation, and OpenAPI schema properties.
- A relationship becomes a `RelationNode`; semantic analysis verifies its unique name, endpoints, cardinality, and non-self-reference; the IR carries those facts in `CREATE_RELATION`. Codegen chooses the target-specific foreign-key or junction-table form and generates source-entity relationship handlers, routes, and OpenAPI paths.
- The optimizer must not silently choose between conflicting declarations. Exact duplicates may be removed; conflicts remain visible as warnings.
- ENUM remains `dataType: "ENUM"` with ordered `enumValues` through AST, symbols,
  IR and optimized IR. Duplicate-field comparison includes the exact value array.
  Only codegen lowers this to MySQL ENUM, Express membership checks and OpenAPI
  string schemas with enum arrays. ENUM source metadata survives IR normalization.

## IR boundary

DATE/TIMESTAMP use the existing dataType and STRING default representation
through AST, symbols, IR and all optimizer passes. IR explicitly validates the
eight supported types, canonical temporal defaults and canonical UUID defaults.
UUID has no numeric/length bounds but permits PRIMARY_KEY. The shared vocabulary
lives in src/utils/data-types.js, and uuid.js owns the pure emitted validator.
Effective-key generation modes are codegen metadata, outside source IR. SQL wire conversion,
UTC session initialization and row normalization remain target decisions.

Keep the IR about declared entities, fields, constraints, validations, defaults, and relationship meaning. SQL names, Express route wiring, HTTP handler structure, and MySQL-specific foreign-key layout belong in code generation unless an explicit architecture change decides otherwise.
