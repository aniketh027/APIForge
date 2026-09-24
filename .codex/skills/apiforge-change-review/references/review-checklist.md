# Review checklist

Use only checks relevant to the reviewed change. Verify claims with code, tests, or observable output; distinguish defects from intentional current behavior.

## Scope

- [ ] Identify the implementation request and acceptance criteria, or state that they are unavailable.
- [ ] Define the Git comparison, files, and behavior in scope.
- [ ] Keep the review read-only unless fixes were explicitly requested.

## Git diff

- [ ] Inspect status, unstaged diff/stat, staged diff/stat, or the requested commit/branch comparison.
- [ ] Explain each changed file's apparent role.
- [ ] Separate necessary supporting changes, formatting, scope expansion, and unrelated refactoring.
- [ ] Check for unexpected generated, dependency, configuration, or secret-bearing files.

## Architecture

- [ ] Review only compiler layers and application surfaces relevant to the change.
- [ ] Confirm phase boundaries and target-independent IR remain intact where applicable.
- [ ] Do not penalize legitimate multi-layer propagation.

## Correctness

- [ ] Compare implemented behavior with explicit requirements.
- [ ] Verify both success and failure behavior where applicable.
- [ ] Check diagnostics, defaults, compatibility, and public/API behavior affected by the change.

## Propagation

- [ ] Trace affected information across each relevant boundary.
- [ ] Confirm semantic meaning is not lost or changed in IR or optimized IR.
- [ ] Confirm each applicable generated target receives the intended meaning.

## Edge cases

- [ ] Exercise meaningful boundaries, duplicates, empty/omitted values, malformed input, and incompatible combinations.
- [ ] Check datatype, modifier, relationship, identifier, case, or default interactions only when relevant.

## Tests

- [ ] Confirm behavioral changes have regression coverage.
- [ ] Check valid, invalid, and boundary cases appropriate to the contract.
- [ ] Determine whether weak assertions could pass with broken behavior.
- [ ] Check for unjustified deletion, weakening, or bypassing of existing tests.
- [ ] Do not treat test-count growth as evidence by itself.

## Generated outputs

- [ ] Inspect affected generated artifacts rather than only generator source.
- [ ] Compare applicable DSL, SQL, Express, and OpenAPI behavior.
- [ ] For relationships, compare generated routes and OpenAPI paths.
- [ ] Syntax-check generated JavaScript and run practical integration checks when warranted.

## Docs

- [ ] Check affected Language Guide, README, and samples for accuracy.
- [ ] Do not require unrelated documentation changes.

## Regression risk

- [ ] Inspect nearby behavior reasonably reachable from the changed code path.
- [ ] Avoid unrelated refactors and repo-wide speculative checks.
- [ ] Record unverified high-risk areas explicitly.

## Verification

- [ ] Run relevant targeted tests.
- [ ] Run relevant CLI, sample, API, or integration checks.
- [ ] Run the full suite when compiler/application behavior changed.
- [ ] For metadata-only changes, use proportionate validation instead.
- [ ] Report exact commands/results and any checks not run.

## Findings

- [ ] Support every defect with a location and evidence.
- [ ] Assign severity from impact, not preference.
- [ ] Recommend a focused fix without silently implementing it.
- [ ] State clearly when no blocking or correctness issue was found.
