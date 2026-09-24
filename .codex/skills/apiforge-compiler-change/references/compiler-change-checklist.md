# Compiler change checklist

Use only the sections relevant to the change. Not every compiler phase must change.

## Before editing

- [ ] Read `$apiforge-core` and its task-relevant references.
- [ ] Inspect current implementation, nearby tests, samples, and language docs.
- [ ] Confirm whether the requested behavior already exists.
- [ ] Classify the change: lexical, syntactic, semantic, target-generation, presentation, or combined.
- [ ] Define the intended contract; surface unresolved material ambiguity.

## Syntax

- [ ] Specify valid and invalid source forms and boundary cases.
- [ ] Update token recognition only if the syntax introduces lexical vocabulary or literals.
- [ ] Preserve case-sensitivity, identifier, comment, and declaration conventions unless explicitly changing them.

## Parser / AST

- [ ] Parse the feature at the correct grammar location.
- [ ] Store its complete language meaning in the AST without target-specific details.
- [ ] Produce useful syntax diagnostics for malformed forms.
- [ ] Verify existing syntax remains backward compatible unless change is intentional.

## Semantics

- [ ] Enforce datatype applicability, duplicates, ranges, combinations, references, and defaults that apply.
- [ ] Prefer semantic errors for syntactically valid but meaningless input.
- [ ] Keep symbol-table data only when later analysis or phases require it.
- [ ] Test at least one valid and each materially distinct invalid behavior.

## IR

- [ ] Represent language meaning using current IR conventions.
- [ ] Verify AST-to-IR lowering preserves every required value.
- [ ] Extend IR validation when the IR schema changes.
- [ ] Keep SQL and Express syntax out of the IR.

## Optimizer

- [ ] Confirm the optimized IR preserves the new information.
- [ ] Add normalization, ordering, or deduplication only when semantics-preserving and useful.
- [ ] Preserve conflicts rather than silently choosing a declaration.

## Codegen

- [ ] Update only applicable targets.
- [ ] Keep SQL constraints and defaults correct.
- [ ] Keep Express runtime validation and behavior consistent with the DSL.
- [ ] Keep OpenAPI schemas and paths consistent with runtime behavior.
- [ ] Inspect generated artifacts, not only generator strings.

## Frontend

- [ ] Update playground displays only if affected structures or diagnostics are rendered.
- [ ] Verify compiler API payload rendering and escaping when presentation changes.

## Tests

- [ ] Cover affected lexer, parser, AST, semantic, IR, optimizer, and codegen boundaries as applicable.
- [ ] Cover modifier interactions, duplicates, boundaries, and regressions that carry distinct behavior.
- [ ] Cover compiler API, frontend-facing payloads, or sample compilation when relevant.
- [ ] Avoid redundant assertions added only to increase the count.

## Docs

- [ ] Update samples and documentation after behavior passes verification.
- [ ] Document actual syntax, semantics, diagnostics, and generated effects.
- [ ] Do not present planned behavior as supported.

## Final verification

- [ ] Run targeted tests.
- [ ] Compile a relevant CLI or sample input.
- [ ] Inspect affected generated files and run supported JavaScript syntax checks.
- [ ] Run practical database integration checks when SQL behavior warrants them.
- [ ] Run the full test suite.
- [ ] Review the diff for lost information, unrelated refactors, and cross-target disagreement.
- [ ] Report files, behavior, tests, manual/integration verification, and remaining risks.
