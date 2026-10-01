# Generated-backend verification checklist

Use only the sections affected by the change.

## Generation

- [ ] Inspect relevant codegen functions and tests before editing.
- [ ] Compile a representative DSL through the relevant CLI or in-memory path.
- [ ] Compare the returned file list with the intended contract.
- [ ] Check that disk output is not being confused with stale files from an earlier generation.

## Project structure

- [ ] Inspect the actual generated tree.
- [ ] Verify expected files exist and unexpected development files do not.
- [ ] Resolve every generated relative import and startup path.
- [ ] Verify declared dependencies/configuration if standalone operation is claimed.

## SQL

- [ ] Check datatype mapping, keys, auto-increment, defaults, `NOT NULL`, uniqueness, and checks.
- [ ] Check identifier quoting and literal escaping with relevant inputs.
- [ ] Check entity-before-relationship ordering, foreign keys, junction tables, and delete behavior.
- [ ] Keep target SQL out of target-independent IR.

## Express

- [ ] Inspect model CRUD queries and primary-key selection.
- [ ] Inspect controller success, validation, not-found, and error behavior.
- [ ] Compare route modules with server mount paths.
- [ ] Verify update and omitted-field behavior relevant to the change.

## Collection queries

- [ ] Preserve the current collection body with and without pagination.
- [ ] Validate all five filter types, implicit/STRING keys, reserved-name collisions, and repeated/unknown parameters before DB access.
- [ ] Assert trusted identifiers/fixed sort tokens, bound values/LIMIT/OFFSET, deterministic WHERE order, safe integers/offsets, and stable page ordering.
- [ ] Verify opt-in pagination, default/max limit, identical filtered count predicates, zero matches, and beyond-last-page metadata.
- [ ] Check SQL injection field/order rejection, literal bound STRING attacks, and live table/row integrity in an isolated DB.
- [ ] Compare OpenAPI parameters/headers and README behavior; preserve item/write/relationship methods, schema, and dependencies.

## Field validation and defaults

- [ ] Compare DSL meaning with SQL, Express runtime behavior, and OpenAPI.
- [ ] Test present, omitted, boundary, below-range, and above-range values as applicable.
- [ ] Record intentional differences instead of implying identical enforcement.

## Relationships

- [ ] Compare cardinality with SQL storage and foreign-key direction.
- [ ] Check source/target primary-key names and types.
- [ ] Check model/controller names, route segments, parameters, and status behavior.
- [ ] Compare Express relationship routes with OpenAPI paths.
- [ ] Check relevant duplicate or naming collisions.

## OpenAPI

- [ ] Parse `swagger.json` as JSON and confirm OpenAPI version.
- [ ] Compare paths and methods with generated Express routes.
- [ ] Check path parameters, request bodies, required fields, types, ranges, defaults, and relationships.
- [ ] Verify primary-key/path-parameter type fidelity when relevant.

## Packaging

- [ ] Inspect the source file list supplied to packaging.
- [ ] Open the produced ZIP and compare entry names and bytes with the generation result.
- [ ] Extract it and verify internal paths and imports.
- [ ] Confirm no APIForge-only source, secrets, or stale output leaks into it.
- [ ] Exercise and report any fallback download behavior.

## Syntax

- [ ] Run available JavaScript syntax checks over every generated `.js` file.
- [ ] Parse generated JSON artifacts.
- [ ] Check generated SQL with an appropriate parser or database when warranted.

## Runtime

- [ ] Install dependencies from the generated artifact if standalone behavior is claimed.
- [ ] Configure environment and start the generated server.
- [ ] Exercise `/health`, affected CRUD routes, validation failures, and relationships as relevant.
- [ ] Confirm observed responses match OpenAPI where modeled.

## Database integration

- [ ] Create/configure the target database and apply `schema.sql` when SQL behavior is central.
- [ ] Exercise affected constraints, defaults, CRUD queries, and relationship operations.
- [ ] Keep environment-dependent limits explicit when integration is not practical.

## Regression suite

- [ ] Run codegen-specific tests first.
- [ ] Inspect generated artifacts rather than relying only on string assertions.
- [ ] Run the full APIForge suite after compiler/application behavior changes.
- [ ] Use proportionate validation for documentation or metadata-only work.
- [ ] Report commands, results, unrun checks, and remaining risks.
