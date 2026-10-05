---
name: apiforge-change-review
description: Evidence-driven post-implementation review of APIForge changes, bug fixes, diffs, and completed features. Use to verify requirements, scope, compiler propagation, generated targets, tests, regressions, and readiness; report findings without fixing unless explicitly requested.
---

# APIForge Change Review

Use this skill with `$apiforge-core` for current project facts. Also use `$apiforge-compiler-change` when reviewing changes to DSL syntax or compiler semantics. Do not repeat their architecture or design guidance in the report.

This is review-only by default. Inspect and report before editing. Fix findings only when the user explicitly asks for fixes.

## Review workflow

1. Establish the review contract from the current request, recent instructions, changed files, nearby tests, and relevant docs. If the original implementation request is unavailable, review against current APIForge behavior and architecture and state that limitation.
2. Inspect repository state before judging the change. Normally examine `git status`, `git diff --stat`, and the full diff; inspect staged changes separately. For a commit or branch review, choose the comparison that matches that scope.
3. Map each changed file to its apparent purpose and the requirement it supports. Distinguish necessary cross-phase work, harmless formatting, suspicious expansion, and unrelated refactoring. Several changed compiler layers may be necessary.
4. Review behavior, not only style. Inspect only relevant lexer, parser/AST, semantic, symbol-table, IR, optimizer, codegen, SQL, Express, OpenAPI, playground, CLI/API, sample, documentation, and test surfaces.
5. For compiler changes, trace affected information through the applicable boundaries:

```text
Source -> tokens -> AST -> semantic representation -> IR -> optimized IR -> generated targets
```

Look for meaning that parses correctly but is lost, altered, or inconsistently generated later.

6. Exercise meaningful edge cases proportional to the change: boundaries, empties, duplicates, incompatible combinations, defaults, relationships, reserved names, casing, omitted data, and malformed input only when relevant.
7. Inspect tests critically. Check that changed behavior has useful valid, invalid, boundary, and regression coverage; that assertions observe behavior rather than implementation trivia; that a broken implementation could not trivially pass; and that existing tests were not weakened or removed without reason.
8. Verify efficiently:

```text
Relevant targeted tests
-> relevant CLI, sample, or integration check
-> full suite when compiler/application behavior changed
```

For metadata-only or documentation-only changes, do not run the full compiler suite automatically. For codegen changes, inspect generated artifacts; syntax-check generated JavaScript where supported; run practical runtime/database checks when central to the task.

9. Compare applicable generated behavior across DSL semantics, SQL, Express runtime behavior, and OpenAPI. For relationships, also compare routes with OpenAPI paths.
10. Check only documentation and nearby behavior reasonably affected by the implementation. Avoid repo-wide speculative auditing.

Use [references/review-checklist.md](references/review-checklist.md) while reviewing.

## Evidence and severity

Do not infer correctness merely from passing tests, or incorrectness merely from a broad diff. Support findings with a tight file/location, observable behavior, code path, failing test, generated artifact, or reproducible command result.

| Severity | Meaning |
|---|---|
| `BLOCKER` | Core breakage, data loss/corruption, unusable compilation/runtime, or fundamental failure of the requested feature. |
| `HIGH` | Significant correctness failure, serious regression, or major unmet requirement. |
| `MEDIUM` | Real behavioral defect or important edge case that should normally be fixed before completion. |
| `LOW` | Limited-impact issue, small inconsistency, or non-critical missing coverage. |
| `NOTE` | Non-defect observation, optional improvement, or clarification. |

Use the lowest severity that accurately represents impact. Do not use an overall numeric score.

## Report

Put findings first, ordered by severity. For each finding, state title, file/location, problem, impact, evidence, and a focused recommended fix. Do not invent findings to fill a template.

Then summarize verification performed, reviewed scope, unverified areas or remaining risks, and conclude with `Ready`, `Not ready`, or `Ready after listed fixes`. Readiness is relative to the requested implementation, not a quality ranking.

If no meaningful issue is found, state: `No blocking or correctness issues found in the reviewed scope.` Then summarize verification and any remaining limits.

Use [references/review-report-template.md](references/review-report-template.md) for a compact output shape; omit irrelevant empty sections.

For G26 reviews, require native snapshot naming evidence, exact final/intermediate physical comparisons, SAFE seeded-data preservation, and positive/negative prerequisite evidence. Check exact plan-bound operation authorizations, unsupported-transition refusal, simulator omission failures, complete strict history inventory, immutable publication, lock contention and committed cleanup-failure reporting. Verify ordinary compatibility independently of missing/populated/corrupt migration history and preserve both pinned oracles. See [the migration contract](../../../docs/schema-migrations.md) and [verification report](../../../docs/schema-migrations-verification.md).
