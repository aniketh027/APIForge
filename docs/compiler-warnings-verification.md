# Compiler warning implementation verification

Verified on 2026-10-01 against baseline commit
`170b4e3a043d4ba0e706d38ab5cabc462cf7dd7d`.

## Audit and final contract

Before editing, the optimizer returned four kinds of strings: conflicting field
declarations, conflicting relationship cardinalities, conflicting relationship
endpoints, and the invalid-IR fallback. CLI, HTTP and the optimized-IR playground
tab exposed these strings. No semantic, IR-generator or code-generator warning
collection existed. Normal duplicate DSL declarations fail semantic analysis.
Exact duplicate IR instructions are removed; conflicts remain intact.

`generateSQL` in `src/codegen/codegen.js` injects the implicit
`id INT PRIMARY KEY AUTO_INCREMENT` column for entities without explicit keys.
`getPrimaryKeyField` supplies the corresponding fallback identifier for other
targets. AST/IR is not rewritten. This behavior is unchanged.

The existing shared diagnostic factory now defaults to error severity and also
supports warnings. `createWarningDiagnostic` fixes severity to `warning` and
requires registration in the separate append-only WRN namespace. Error codes,
error shapes, messages, phase boundaries, statuses and malformed-JSON handling
are preserved. No warning suppressions, style rules or language syntax were added.

| Code | Symbol | Origin |
|---|---|---|
| WRN001 | IMPLICIT_PRIMARY_KEY | New semantic report of existing implicit integer id behavior, for valid programs. |
| WRN002 | CONFLICTING_FIELD | Migrated optimizer warning. |
| WRN003 | CONFLICTING_RELATION_TYPE | Migrated optimizer warning. |
| WRN004 | CONFLICTING_RELATION_ENDPOINTS | Migrated optimizer warning. |
| WRN005 | INVALID_IR | Migrated non-throwing optimizer fallback; invalid IR remains invalid input for later phases. |

The canonical `.warnings` collection contains structured objects, including an
empty array when none exist. Former string consumers must read `.message`.
Semantic validity depends only on errors. Successful HTTP responses remain 200
and include six succeeded phase states and generated files. CLI warning-only
compilation exits 0 and generates normal output. Warnings are never mixed into
fatal diagnostics. Ordering is phase, known line, known column, stable code, then
stable emission order for ties. Unknown coordinates are null, without invented
ranges. Existing parser-style non-enumerable metadata survives normalization.

## Automated verification

Final `npm test` completed with exit code 0:

| Suite | Result |
|---|---|
| Main compiler suite (`tests/test.js`) | 1,060 passed, 0 failed. |
| String length validation | 25 passed. |
| Disk generation regression | Passed. |
| Generated MySQL harness safety (offline) | Passed. |
| Structured diagnostics | 53 passed (51 existing plus 2 warning-model cases). |
| Compiler warnings | 26 passed. |

`node tests/warnings.test.js` and `node tests/diagnostics.test.js` also passed
independently. Syntax checks passed for the changed diagnostic, semantic,
optimizer, API, CLI, frontend and warning-test JavaScript. `git diff --check`
passed with no whitespace errors; Git emitted its existing LF-to-CRLF conversion
notices. Live MySQL CRUD and the separate network/install integration suite were
not run: this change does not modify generated SQL or runtime artifacts.

The new cases cover registry stability/uniqueness, severity validation, JSON
serialization, unavailable optional fields, ranges, implicit/explicit/defaulted
keys, direct AST fallback positions, fatal duplicate DSL declarations, exact IR
deduplication and conflict preservation, all migrated warnings, metadata through
normalization, deterministic ordering, successful HTTP responses and safe fatal
responses, CLI output/exit/disk behavior, frontend escaping/summary/state handling,
and generated ZIP contents. Optimizer conflict aggregation is exercised at the
API/CLI boundary using real direct-IR diagnostics, because normal DSL conflicts
are rejected earlier.

## Generated artifact comparison

Before implementation, four valid programs and their in-memory IR, optimized IR,
and generated files were captured from the baseline. The committed fixture
`tests/fixtures/warning-artifact-baseline.json` records those sources, provenance,
and SHA-256 digests, including the exact 57-code error registry digest.

| Program | Files compared | Result |
|---|---:|---|
| Explicit integer primary key | 10 | All contents unchanged. |
| Implicit integer primary key | 10 | All contents unchanged; exactly one semantic warning. |
| Many-to-many relationship | 13 | All contents unchanged. |
| String-length bounds/default | 10 | All contents unchanged. |

All 43 file contents, all four IR/optimized-IR pairs, and all 57 error assignments
match the pre-change digests. CLI disk output also matches the ten implicit-key
baseline files. The playground ZIP builder's ten entries match the same hashes.

## Browser verification

The real local compiler server was exercised in the Codex in-app browser at
1920x1080 and approximately 1000px width (1000x900 viewport).

- Explicit primary key: green success summary, no warning metric/list, six
  successful phase buttons, and download control visible.
- Implicit primary key: green success summary, one warning metric, amber
  Semantic/WRN001 item, entity-name excerpt with seven carets, deterministic
  hint, six successful phases, generated outputs and download control available.
- Existing SEM018 semantic error: red fatal card/editor highlighting, accurate
  excerpt/hint, semantic phase failed, later phases skipped, success summary and
  stale warnings cleared. Subsequent successful compilation recovered cleanly.
- Layout: warning summary remains within the inspector at both widths. The
  narrow viewport uses the existing stacked layout; no document horizontal
  overflow was observed. Warning headings use the existing amber token while
  success headings use the existing green token. Screenshots were captured
  outside the repository.

The download control was clicked, with no browser console error. The in-app
browser did not expose a completed download event, and Chrome was unavailable,
so an actual browser-saved ZIP is **unverified**. The ZIP builder and its complete
file contents are separately verified by the automated regression test. No
normal DSL program reaches the optimizer conflict warnings; direct-IR and
boundary tests verify those conditions instead.

## Self-review

Review used `apiforge-change-review` and the compiler-change checklist, including
the complete implementation diff, tests, contracts, error statuses, phase state
handling, source metadata, warning emission counts and artifact comparisons.

Two integration issues were fixed and covered:

1. The old frontend `phaseStates` branch assumed failure. Successful responses
   now supply explicit states, so its pipeline label must honor `success`.
2. Optimizer normalization spread copies could lose non-enumerable source
   metadata. They now preserve its descriptor, without changing normalization,
   conflict handling, declared IR values or generated output.

No blocking or correctness issues found in the reviewed scope. Ready, with the
browser download-completion limitation recorded above.

## Changed files and Git scope

- Shared model and compiler: `src/utils/diagnostics.js`,
  `src/semantic/analyzer.js`, `src/optimizer/optimizer.js`.
- Consumers: `src/api/compiler-api.js`, `index.js`, `frontend/app.js`,
  `frontend/style.css`.
- Tests: `tests/diagnostics.test.js`, `tests/test.js`, `tests/warnings.test.js`,
  `tests/fixtures/warning-artifact-baseline.json`, `package.json`.
- Documentation: `docs/structured-diagnostics.md`,
  `docs/APIForge-Language-Guide.md`, `README.md`, this verification record, and
  `.codex/skills/apiforge-core/references/known-behavior.md`.

Only these task files are committed. Existing untracked report artifacts are
preserved: `APIForge_Drive_Resources.zip`, `APIForge_Drive_Resources/`,
`APIForge_Overleaf_Source/`, `APIForge_Overleaf_Source__FINAL.zip`. No push or
history rewrite is performed. Commit hashes are reported in the completion
message rather than embedded into their own commit.
