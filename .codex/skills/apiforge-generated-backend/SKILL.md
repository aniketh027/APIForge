---
name: apiforge-generated-backend
description: Workflow and consistency rules for APIForge generated MySQL, Express REST APIs, runtime validation, OpenAPI, project structure, downloadable ZIP packaging, startup, and generated-project integration verification. Use for target-code and generated-backend work, not general DSL design alone.
---

# APIForge Generated Backend

Use `$apiforge-core` for project context. Add `$apiforge-compiler-change` when DSL semantics change, and `$apiforge-change-review` for a post-implementation review. This skill owns generated-target behavior and generated-project verification; it does not repeat general architecture, DSL syntax, language-design, or review procedure.

## Inspect reality first

Before changing generated output, inspect the relevant codegen functions, nearby tests, and actual generated files. Compile a representative DSL in memory or through the CLI when useful. Treat implementation and tests as authoritative over documentation.

Read [references/generated-project-contract.md](references/generated-project-contract.md) for the current file, routing, configuration, relationship, and packaging contract.

## Keep generated targets consistent

Trace each affected DSL meaning across applicable outputs:

```text
DSL semantics
├─ MySQL schema and constraints
├─ Express models, controllers, validation, routes, and startup
└─ OpenAPI schemas and paths
```

Check agreement on datatype, accepted values, required/optional behavior, defaults, ranges, identifiers, routes, parameters, and relationships. Document an intentional target difference; do not let targets contradict one another accidentally.

- For SQL changes, inspect type mapping, keys and auto-increment, defaults, `NOT NULL`, uniqueness, checks, identifier quoting, escaping, foreign keys, junction tables, ordering, and relationship constraints. Keep SQL syntax out of target-independent IR.
- For Express changes, inspect imports, model queries, controller validation, CRUD/update behavior, relationship handlers, status/error behavior, DB configuration, route mounting, and server startup. Generated JavaScript must parse; string-output assertions alone are insufficient.
- For OpenAPI changes, compare actual Express paths and methods with paths, parameters, request bodies, required properties, types, defaults, ranges, relationships, and modeled responses.
- For project-structure changes, verify every required file exists, internal imports resolve, paths and startup/config assumptions agree, environment setup is documented, and packaging includes the intended files.

Prefer targeted codegen improvements unless the task explicitly requires a generator redesign.

## Verify standalone and packaged artifacts honestly

Treat the backend as a consumer-facing project artifact, not only generated strings. Do not call it standalone unless this workflow succeeds:

```text
DSL -> compile -> obtain project or ZIP -> extract -> install declared dependencies
    -> configure environment -> prepare database -> start server -> exercise API
```

A successful compile is not sufficient. When ZIP/download behavior changes, inspect the archive entries and extracted tree, verify paths, confirm no generated files are omitted, and ensure APIForge development-only files do not leak into the artifact.

For validation/default changes, compare applicable SQL `DEFAULT`/`CHECK`, Express request behavior, and OpenAPI `default`/range metadata. For relationship changes, compare SQL topology, model/controller behavior, route names and parameters, collision handling, and OpenAPI paths.

## Verification order

```text
Codegen-specific tests
-> compile representative DSL
-> inspect generated tree and contents
-> syntax-check generated JavaScript
-> generated runtime/API check when relevant
-> database integration when relevant
-> full APIForge suite
```

Use [references/backend-verification-checklist.md](references/backend-verification-checklist.md). Keep checks proportional: metadata-only changes do not require expensive runtime or database work.

For G26, keep migration SQL separate from ordinary CREATE output and G19 publication. Reuse MySQL presentation primitives, emit complete MODIFY definitions, model implicit FK-index side effects, and validate every intermediate G16 boundary. Certify `mysql-8.4-v1` with native metadata and seeded preservation evidence. Prerequisite acknowledgement is an operator assertion; production G26 never executes data-check queries. See [the migration contract](../../../docs/schema-migrations.md).
