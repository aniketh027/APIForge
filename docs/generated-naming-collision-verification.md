# Generated naming and collision verification

Milestone 1, 2026-10-02 (Asia/Calcutta). Revised authoritative base:
`a0168682254550dc99fa8782f14f2827402852b9`, local main and live origin/main,
ahead/behind 0/0, explicitly approved by the user. Reviewed commits e644d1b and
a016868 are included. All work is on apiforge-v1-hardening. Main is untouched.

## Allocation audit and policy

| Namespace | Existing source transform | Safety |
|---|---|---|
| MySQL entity table | entity spelling | Case-insensitive portable collision rejection |
| MySQL column | declared field spelling; implicit id if needed | Case-insensitive rejection; SEM033 unchanged |
| Model file | models/Entity.js | Case-insensitive Windows collision and device-name rejection |
| Controller/route file | lowerFirst(Entity) + Controller/Routes.js | Case-insensitive collision rejection |
| Server import | lowerFirst(Entity) + Routes | Covered by file allocation uniqueness |
| Model class/controller model import | Entity + Model | Distinct source entities remain distinct |
| CRUD controller names | get + upperFirst(plural), getEntityById, create/update/deleteEntity | Distinct files isolate exports; relationship overlap checked in milestone 2 |
| Model methods | fixed CRUD/query names; relationship get/add/removeTarget | Fixed names independent of fields; relationship overlap checked in milestone 2 |
| Root resource/OpenAPI paths | unchanged pluralize(Entity), then /{id} | Pluralized path rejection |
| OpenAPI component/property keys | source entity/field spelling | Null-prototype own-key maps |
| Semantic entity/field/relation registries | source spelling | Null-prototype own-key maps |
| Playground inventory | Object.keys of serialized source symbol map | Executed real renderer; names retained |
| Relationship FK/junction/constraint names | lowerFirst(endpoint)_key, Source_Target, fk_owner_reference | Existing behavior audited; collision checks and quoting belong to milestone 2 |
| Relationship paths/functions | source route plus target plural/singular; get/add/remove target | Existing behavior audited; collision checks belong to milestone 2 |

No pluralization redesign or silent target/public-name suffixing. Appended
SEM034 / GENERATED_NAME_COLLISION uses the offending name range, names both
owners and the target namespace/name, and supplies a rename hint. Existing
exact-duplicate diagnostics are retained without redundant new collisions.
Source entity spelling is not rewritten. The pure transform module is shared
by semantic allocation and codegen; direct IR generation also rejects collisions
before any filesystem write.

Prototype names are supported, not globally banned. Symbols and relation/field
registries use Object.create(null); OpenAPI component/property maps likewise.
Non-enumerable legacy symbolTable.entities/relations aliases are attached only
when they would not overwrite an actual source entity. The authoritative result
already exposes separate entities and relations members. No prototype pollution
or process-wide exploit is claimed.

## Corrective evidence and compatibility

tests/generated-naming.test.js loads semantic/codegen modules from the pinned
base via git show. Student/student, Foo/FOO, Category/Categorie and name/Name are
accepted there; corrective rejection assertions fail against that implementation.
Student/student also produces duplicate filenames and unparseable emitted server
JS. The corrected compiler rejects them with SEM034, no warnings, HTTP 422,
skipped IR/codegen, CLI exit 1 and no output directory.

Prototype-sensitive entities __proto__, constructor, toString, entities, relations,
fields and relationship __proto__ retain own symbols and component properties.
Emitted JS parses. The actual frontend renderer runs against JSON-serialized
symbols, verifying that the own-key inventory survives the API boundary.

Three representative noncolliding programs (mixed case, a relationship, implicit
key) match every generated file byte-for-byte against the pinned generator.
Existing historical fixtures remain unchanged; tests compare their existing
diagnostic assignments by key so an appended diagnostic does not invalidate
the frozen mappings. All 62 old assignments and five warning assignments are
separately verified against Git history. No AST/IR synthetic metadata is added.

## Verification

- npm test: PASS, including original 1060/0 main assertions, all existing focused
  suites, and five new naming groups.
- node tests/generated-naming.test.js: PASS, including real compiler HTTP/CLI,
  emitted-JS parsing, frontend rendering and pinned baseline failures.
- node docs/verify-language-guide.js: PASS, 18 valid/60 invalid examples,
  120 generated JS parses and 78 isolated CLI invocations.
- npm run test:generated-integration: PASS; actual declared dependency install,
  server startup and health on ephemeral port 55091; process, port, temporary
  project and repository output cleanup verified.
- node --check for changed source/test/verifier JS and git diff --check: PASS.
- Protected integrity: 36 paths, sizes, SHA-256, creation/modification timestamps
  match the baseline manifest stored outside the repository. Protected roots
  remain untracked and are never staged.
- LIVE MYSQL UNAVAILABLE: APIFORGE_TEST_DB_* credentials absent. No DB created.

Remaining naming/relationship allocations are addressed sequentially in milestone
2; target identifier/storage limits in milestone 4. No unrelated capability work.
Self-review: no blocking or correctness issue found in the milestone scope.

Commit range: revised base a016868..the milestone-1 commit containing this report.
The final audit records concrete milestone SHAs and remote boundary state after
push, avoiding a self-referential commit hash in this file.
