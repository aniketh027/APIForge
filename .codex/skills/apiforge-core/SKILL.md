---
name: apiforge-core
description: Foundational project context and engineering rules for working on the APIForge DSL compiler and generated backend system. Use for APIForge implementation, debugging, reviews, documentation, compiler changes, code generation, tests, or repository planning.
---

# APIForge Core

APIForge is a custom DSL compiler for declaring backend entities, fields, constraints, validations, defaults, and relationships. It generates MySQL schema, an Express.js REST backend with CRUD and relationship endpoints, runtime validation, and Swagger/OpenAPI documentation. Treat the compiler—not the playground—as the project's central academic contribution.

## Preserve the compiler design

Keep the six phases distinct unless the task explicitly requires an architectural change:

```text
Source DSL
-> Lexer
-> Parser / AST
-> Semantic Analysis
-> Intermediate Representation
-> Optimizer
-> Target Code Generation
-> MySQL + Express + OpenAPI
```

The IR carries target-independent meaning. Do not add MySQL- or Express-specific decisions to it unless the current architecture intentionally models them there.

Read [references/architecture.md](references/architecture.md) when changing phase boundaries, data flow, validation propagation, relationships, optimization, or generated targets.

## Resolve sources in this order

When facts disagree, use:

1. Current repository implementation
2. Current automated tests
3. Current sample DSL files
4. `docs/APIForge-Language-Guide.md`
5. `README.md`
6. Historical handoff or context documents

Do not change working compiler behavior merely to make stale documentation correct unless the task explicitly changes the language contract.

## Work on APIForge

1. Inspect current behavior before editing and decide whether it is a defect or an intentional design choice.
2. Make the smallest scoped change that solves the task; avoid unrelated refactors and preserve backward compatibility unless semantic change is requested.
3. Do not invent DSL syntax without checking the lexer and parser and defining its semantic, IR, codegen, and documentation effects.
4. Add regression tests for behavioral changes and run targeted tests for the affected area.
5. Run the full suite before declaring compiler or application changes complete.
6. When relevant, exercise the real CLI, compiler API, or generated output rather than relying only on unit-level checks.
7. For codegen changes, keep SQL, Express runtime behavior, and OpenAPI mutually consistent.
8. Make documentation describe implemented behavior. Do not add features merely to increase feature count.

Use the references selectively:

- Read [references/current-dsl.md](references/current-dsl.md) for language syntax or semantics.
- Read [references/project-map.md](references/project-map.md) to locate ownership and entry points.
- Read [references/known-behavior.md](references/known-behavior.md) before changing defaults, primary keys, routes, parser boundaries, API errors, or generated project layout.

## Report completion

For implementation tasks, report:

- files changed and behavior changed
- tests run and their results
- manual, CLI, API, or generated-output verification performed
- unresolved issues or risks

Editing files alone is not evidence of success.

## G26 offline migration boundary

Use [the migration contract](../../../docs/schema-migrations.md) for `migrate.js` and `src/migrations/`. Ordinary compilation stays independent of migration state and retains its complete ordered file bytes. Migration workspaces are separate from generated `output/`; do not add migration artifacts or endpoints to ordinary generation. G26 V1 generates offline one-shot SQL for `mysql-8.4-v1`; APPLY, DOWN, drift, rename inference, backfills and cardinality conversions are deferred.

## G27 explicit PostgreSQL target

Read [the PostgreSQL contract](../../../docs/postgres-target.md) and [verification evidence](../../../docs/postgres-target-verification.md) for target work. MySQL is the default; select only exact mysql/postgres options. Keep tokens, AST, symbols, IR and serialized Effective Schema Plan target neutral. PostgreSQL owns physical admission/names/DDL/pg results/error classification; common HTTP policy stays shared. Legacy generateSQL remains unchecked MySQL. Preserve the approved-main G27 byte oracle and older G22/G26 baselines. Certify native PostgreSQL 18 DDL, emitted models and installed HTTP backend separately. G26 remains MySQL-only; do not add PostgreSQL migration claims or browser selection.
