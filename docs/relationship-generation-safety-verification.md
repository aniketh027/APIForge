# Relationship generation safety verification

Milestone 2, 2026-10-02 (Asia/Calcutta), starts at milestone 1:
`143f735560203d3b9036d43c6541b371d0e05dc3`, pushed to origin/apiforge-v1-hardening
with ahead/behind 0/0 and protected integrity PASS. Local and live remote main
remain a0168682254550dc99fa8782f14f2827402852b9.

## Design and audit

The shared allocation checker now inventories generated relationship tables,
columns, constraint names, model/controller helpers, GET paths and association
paths. It compares source names with target allocations, including declared
entity tables/fields and source controller CRUD functions. It conservatively
uses case-insensitive portability checks. No public artifact is renamed.
SEM034 / GENERATED_NAME_COLLISION is reused with the relationship-name source
range and a rename hint. There are still 63 public errors and five unchanged
warnings. Direct IR generation repeats preflight before writing.

quoteIdentifier remains the single SQL identifier authority. All relationship
source/target/junction tables, qualified primary/FK columns and DDL constraints
use it. Identifiers are allocated from trusted declarations; request values
remain mysql2 placeholders. Composed names are constructed before quoting.

| Cardinality | DDL and delete behavior retained | Executed model method |
|---|---|---|
| ONE_TO_ONE | Target nullable UNIQUE source FK; CASCADE | singular target lookup |
| ONE_TO_MANY | Target nullable source FK; SET NULL | target list |
| MANY_TO_ONE | Source nullable target FK; SET NULL | joined singular lookup |
| MANY_TO_MANY | Junction composite PK; both CASCADE | list, add, remove |

Route ownership remains source-side; simple paths and response envelopes are
unchanged. Effective keys and full STRING widths are retained. Missing list
parents may still return an empty list; removal remains idempotent HTTP 200.
These are retained behavior, not mandatory relationship existence guarantees.

## Corrective evidence and compatibility

The pinned a016868 semantic analyzer accepts nine collision programs: repeated
relations in every cardinality, a declared FK field, a declared junction entity,
inverse relations allocating the same FK, plural/singular target GET overlap,
and a relationship getter overlapping getChildById. Corrective rejection fails
against that baseline and passes now. Direct IR preflight also rejects them.

The emitted helper suite executes 20 cardinality/key combinations (explicit
INT, widened reserved STRING key, implicit source, implicit target, both implicit),
30 helper calls total. Reserved table Order and keys select/key are quoted;
the injected-looking test value stays solely in bound values. Pinned old helpers
fail the same quoting assertion. DDL checks confirm effective FK types/widths,
CASCADE/SET NULL, OpenAPI source identifier types and unchanged routes. Generated
JS parses for every project.

Four ordinary projects with two disjoint relationships each match all generated
bytes against a016868. The existing frozen compatibility fixtures remain
unchanged, preserving all unrelated compiler/output behavior.

## Verification and limits

- npm test and node tests/relationship-safety.test.js: PASS, including three new
  relationship groups, five naming groups and every existing suite.
- node docs/verify-language-guide.js: PASS, 18 valid/60 invalid programs, 120 JS
  parses and 78 isolated CLI invocations.
- npm run test:generated-integration: PASS on ephemeral port 53406; temporary
  project, server process, port and repository output cleanup verified.
- Changed source/test JS node --check and git diff --check: PASS.
- Protected integrity: all 36 paths, sizes, hashes and timestamps unchanged.
- LIVE MYSQL UNAVAILABLE: no APIFORGE_TEST_DB_* credentials; no DB created.
  Captured SQL/helper execution is not native persistence/cascade evidence.

Self-review found no blocking/correctness issue in the milestone scope.
Relationship routes remain read-oriented for non-junction cardinalities; adding
FK mutation endpoints is outside scope. OpenAPI envelopes/nullability and BOOLEAN
rows are addressed next; composed identifier/storage limits in milestone 4.

Commit range: 143f735..the milestone-2 commit containing this report. Exact SHAs
and push boundary evidence are recorded in the final audit.
