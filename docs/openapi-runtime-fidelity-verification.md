# OpenAPI and runtime fidelity verification

Milestone 3, 2026-10-02 (Asia/Calcutta), starts at
`862dae2caf0a72c5ca230bd94ad291fd5c71d897` (milestone 2), pushed with 0/0
ahead/behind and protected integrity PASS. Revised main/base remains a016868.

## Observed runtime and schema design

Actual emitted routers use success/data envelopes for collection, item, create,
update and relationship reads/association add; success/message for delete and
association remove; success/error for validation, missing records and DB errors.
The fresh suite executes these handlers over loopback, including 400, 404 and
500. All caught generated DB errors are now sanitized, including item/delete and
relationships. Existing POST/PUT and collection error wording is preserved.
Statuses, root paths, write authority, partial PUT, key immutability and
relationship cardinality/deletion behavior are retained.

Operation components use Entity.Create, Entity.Update and Entity.Read. Dots cannot
occur in source identifiers, so a source entity ItemRead cannot collide with an
operation role. Legacy source-name components remain available unchanged for
compatibility; every operation now references its correct role or envelope.

- Create: declared POST fields only, explicit keys permitted, implicit id absent,
  exact required-on-create rule, bounds/defaults and additionalProperties false.
- Update: declared non-key fields, no required array, additionalProperties false.
- Read: declared fields, effective key and SQL-added nullable FK columns. Synthetic
  identity/FKs are readOnly. Runtime SELECT * exposure is retained; no new writable
  relationship fields are introduced.
- CreateResult: only echoed supplied declared fields and resolved identity. It
  does not require fields whose database defaults were not reloaded, and preserves
  the existing optional explicit-null key response policy.
- Optional declared fields are nullable; REQUIRED write fields are not. Optional
  ENUM properties append null to the ordered case-sensitive enum list in operation
  roles; legacy source components retain their exact source members.
- INT write roles include safe-integer limits and retain narrower declared bounds.
- Reused Response/ListResponse/CreateResponse and .Error/.Message components model
  envelopes. Association add documents echoed URL FK values as strings, matching
  actual Express parameters, even when database/path keys are INT.
- Path identifier types, ENUM case/order, default/bounds, query options and
  pagination headers remain intact. Local refs resolve for representative projects.

OpenAPI 3.0 nullable does not erase enum constraints; null must also be listed for
nullable enums. Verified against [OAS 3.0.3](https://spec.openapis.org/oas/v3.0.3)
and [Swagger enum guidance](https://swagger.io/docs/specification/v3_0/data-models/enums/).
The emitted document remains OpenAPI 3.0.0; no dependency added.

## BOOLEAN normalization

Generated normalizeRow uses trusted declared BOOLEAN-name arrays. Collection,
item, create, update-reread and all relationship GET paths invoke it, with target
metadata for related rows. Numeric DB BOOLEAN values become false for zero and
true for nonzero; null and existing booleans remain unchanged. Arbitrary INT fields
and target-undeclared fields are untouched. Driver rows are copied, not mutated.
No global driver type cast or dependency is introduced.

Pinned a016868 reads return enabled:1; the corrective boolean-type assertion
fails there. Current emitted paths pass across all cardinalities. Current schema
roles likewise exist only after the repair; the pinned shared schema lacks them.

## Compatibility and verification

Historical fixture files are never regenerated. A narrow hardening projection
removes only normalization helpers/calls, the approved general error sanitization,
and operation-role/response schemas before prior compatibility checks run.
It checks every other emitted byte, retained legacy component, path/method,
parameter, request-body metadata and pagination header against a016868. New
response/request-role content is verified by the corrective suite rather than
treated as unchanged historical bytes. Tokens/AST/symbols/IR/optimizer hashes,
62 original diagnostics, SEM034 and five warnings continue to match.

- npm test: PASS, including all existing suites and the three fidelity groups.
- node tests/openapi-fidelity.test.js: PASS, 74 actual HTTP requests plus model
  BOOLEAN checks across all four cardinalities, operation-role metadata and refs.
- node docs/verify-language-guide.js: PASS, 18 valid/60 invalid examples, 120 JS
  parses and 78 isolated CLI invocations.
- npm run test:generated-integration: PASS; actual dependency install/start/health
  and cleanup, with repository output preserved.
- Changed/generated JS node --check, git diff --check and protected comparison:
  PASS. All 36 protected files retain paths/sizes/hashes/creation/modification times.
- LIVE MYSQL UNAVAILABLE: APIFORGE_TEST_DB_* credentials absent; no DB created.

The test schema validator covers the emitted schema subset and actual responses;
it is not a full independent OpenAPI conformance validator. No such validator is
already installed, and no heavy dependency is added only for these tests.

Remaining fidelity limits: database scalar capacity/modes remain DB-authoritative;
create does not reload arbitrary defaults; custom physical columns added outside
the generated schema are outside the documented model. Key null/missing/supplied
auto-increment behavior retains the reviewed write contract. G11's original
shared-PUT/nullability/envelope/FK gaps and G23 are corrected in generated paths.
Self-review found no blocking/correctness issue in this scope.

Commit range: 862dae2..the milestone-3 commit containing this report. The final
audit records concrete commit SHAs and remote boundary state after push.
