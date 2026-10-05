---
name: apiforge-compiler-change
description: Workflow for safely changing APIForge DSL syntax, compiler semantics, validations, constraints, datatypes, relationships, or behavior that propagates through compiler phases. Use when implementing or modifying APIForge language behavior; use apiforge-core for general repository context.
---

# APIForge Compiler Change

Use this skill alongside `$apiforge-core`. Read the core skill and only the core references relevant to the task; they own repository architecture, current DSL facts, paths, and general engineering rules. This skill governs how to design and propagate a language change.

## Design before editing

1. Inspect the relevant implementation, nearby tests, samples, and current language documentation. Confirm whether the requested behavior already exists, then classify the change as syntax, semantics, target generation, or a combination.
2. Define the language contract: valid and invalid forms, applicable datatypes, duplicates and ordering, interactions with existing modifiers, defaults and boundaries, diagnostics, and generated behavior. Surface materially ambiguous semantics instead of inventing them; resolve small implementation details by existing APIForge conventions.
3. Trace only the affected path through the architecture:

```text
Source -> Lexer -> Parser / AST -> Semantic Analysis -> Symbol Table if relevant
       -> IR -> Optimizer -> Codegen -> SQL / Express / OpenAPI
       -> Playground if displayed -> Samples / Docs / Tests
```

Not every change belongs in every component. A lexical-only change may stop after lexer, tests, and docs; a codegen-only correction should not reshape the parser or IR.

Use [references/semantic-design-checklist.md](references/semantic-design-checklist.md) to settle a proposed feature's contract before implementation.

## Preserve meaning through the pipeline

- Once parsed, verify affected information survives AST, semantic processing, IR, optimized IR, and codegen. Locate the exact boundary if it disappears.
- Reject well-formed but meaningless combinations in semantic analysis as early as that phase permits. Do not defer semantic rules to codegen merely because a generator can detect them.
- Keep IR target-independent and follow current IR conventions. Store language meaning, not SQL expressions or Express implementation details.
- Inspect optimizer handling whenever IR shape or contents change. Preserve new information; normalize, reorder, or deduplicate only for a real semantics-preserving purpose.
- When generated validation or constraints change, keep applicable SQL, Express runtime behavior, and OpenAPI definitions consistent.
- Update playground rendering only when displayed tokens, AST, symbol table, IR, diagnostics, generated code, or phase status actually changes.

## Verify and document

Test the compiler boundaries affected by the change: recognition, representation, valid and invalid semantics, duplicate/interactions, preservation, optimization, generated targets, API/playground, samples, and regressions as applicable. Prefer meaningful boundary assertions over test-count inflation.

Verify in this order:

```text
Targeted tests
-> relevant CLI or sample compilation
-> generated-artifact inspection
-> full test suite
```

Run supported syntax checks for changed generated JavaScript. Use available database integration checks when SQL behavior changes and running them is practical.

Update samples and documentation only after implementation is verified. Describe implemented syntax and semantics, never planned behavior.

Use [references/compiler-change-checklist.md](references/compiler-change-checklist.md) during implementation and final review.

For G26 snapshot work, reuse the complete `prepareAdmittedGeneration` admission path and admitted Effective Schema Plan. Preserve failure order/messages and the independent approved-main G26 oracle; do not weaken the G22 oracle. Verify native physical naming before extending diff/planning. Migration behavior does not introduce new DSL syntax or compiler phases; see [the migration contract](../../../docs/schema-migrations.md).
