# G28 imports / modules verification

Verification date: 2026-10-06. **G28 STATUS: CLOSED.** All implementation gates
passed. Changes are local on `g28-imports-modules`, ready for external review;
there was no push, merge, amend, rebase, reset, force push or tag modification.
The [module contract](modules.md) describes the implemented public behavior.

## Preflight, authority and local commits

The implementation approval pins main and the compatibility oracle to
`112a464ee4615c3956c686bfff59c9aa5d9f8497`. Origin was fetched before creating
the requested branch. Local main, origin/main and the remote main ref matched
that SHA. The v1.0.0 tag peeled to
`9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. The tracked worktree and index were
clean; only the four approved protected roots were untracked. All 36 protected
files passed the path/size/SHA-256/creation-time/modification-time manifest.

| Order | Local commit | Purpose |
| --- | --- | --- |
| 1 | `80f2bdf` | Pin approved-main no-import compatibility |
| 2 | `d256e41` | Contextual module parsing and hidden provenance |
| 3 | `466b3e0` | Secure deterministic filesystem resolution |
| 4 | `6a8658d` | Whole-program merge and compilation |
| 5 | `30eb5fa` | C1/C2 complete generation equivalence oracles |
| 6 | `43558ed` | CLI/G19 and HTTP context boundary |
| 7 | `5daaeab` | G26 file compilation with the shared resolver |
| 8 | `694f72f` | Native imported backends/migrations and expanded canaries |
| 9 | `b38d9e3` | Root precedence, recognized-entry parser frames and test adapters |
| 10 | `0c0215a` | Real filesystem link-loop rejection coverage |
| 11 | `docs(g28): document imports modules and verification` | This contract/report, narrow README/guide/repo skill updates |

The final documentation commit is named rather than embedding its own SHA in
the file it hashes. Closure topology is **11 ahead / 0 behind** both main and
origin/main. Both refs and the tag peel remain the approved values above. The
final tracked index/worktree is clean; the only untracked entries remain:

```text
APIForge_Drive_Resources.zip
APIForge_Drive_Resources/
APIForge_Overleaf_Source/
APIForge_Overleaf_Source__FINAL.zip
```

## Scope and architecture review

V1 implements filesystem imports, one global entity/relation namespace and
whole-program compilation on both targets. It adds a pure `parseModule`, a
filesystem adapter, an invocation-local graph coordinator/CompilationUnit,
hidden provenance, file-aware library/CLI diagnostics and G26 `--to` integration.
It does not add namespaces, MODULE/AS, exports, packages, remote imports,
browser multifile UI, virtual filesystems, incremental builds, persistent cache,
source copying or PostgreSQL migrations.

Source review covered the complete branch diff and searches for
`fs.readFileSync`, realpath, stat/fstat, IMPORT, source/module ownership,
`path.resolve` and `process.cwd`. New source filesystem operations are confined
to orchestration and the filesystem adapter. Parser, semantic processing, IR,
optimizer and target renderers do not resolve imports. Existing G19 publication
filesystem operations remain unchanged. Lexer keywords, target adapters,
Codegen/planning implementations, frontend files, frozen fixtures and
`src/migrations/compile-source.js` have no branch diff.

Ownership passes from captured tokens through original AST/sourceLocations and
numeric locations to IR and optimizer copies. It is non-enumerable. The merged
Program exposes exactly `type`, `entities`, `relations`; there is no import IR
operation. Generated-file and plan assertions reject `.apiforge` path leakage;
JSON diagnostics reject the temporary absolute root. Snapshot invariance
assertions compare complete canonical bytes and both hashes. No blocking or
correctness issues were found in the reviewed scope.

## Gate A: exact approved-main compatibility

`tests/g28-legacy-compatibility.test.js` loads the compiler closure from the
approved Git tree, including its corpus, rather than refreshing live fixtures.
It also runs historical and current real CLIs from disposable directories.

| Observation | Result |
| --- | --- |
| Unique source cases | 580: 289 valid, 291 invalid |
| Comparison checks | 2,693; zero mismatches |
| Ordered MySQL generated files in corpus | 3,691 exact files |
| PostgreSQL | Complete ordered generation compared for the valid corpus |
| G26 legacy source snapshots/failures | 289 exact snapshots, 291 exact failures |
| Historical local compiler modules loaded | 35 |
| HTTP, six phase states, warnings, browser ZIP | Exact no-import comparisons on both targets |
| Real CLI | Exit/stdout/stderr and written files exact; default/explicit target variants |
| Migration CLI | Exact snapshot/invalid-source output and status |
| Raw MySQL `generateSQL`, direct IR, plan admission | Pinned success/rejection behavior preserved |
| Lexer, legacy parser, AST, semantic/symbols, IR/optimized IR, plan | Compatibility projections exact |
| Frontend and frozen fixtures | Byte-preserved; no fixture refresh |

The older G22, G26 and G27 pinned oracles also pass. Appending PAR023 and
INP004–INP014 raises the diagnostic registry from 71 to 83 without changing any
previous assignments or the five warning codes. Existing registry-size tests
and the guide verifier were adjusted to the new total; their retained-code and
frozen behavior assertions remain. HTTP internal-exception injection now patches
`parseModule`, the route's authorized parser entry point.

## Gate B: contextual parsing, graph, identity and provenance

Dedicated parser checks: **18 passed**. Filesystem/graph checks: **84 on Windows,
88 on Linux**. Compilation/provenance checks: **40 passed**. The difference is
capability coverage described below, not ignored failures.

| Contract area | Executed evidence |
| --- | --- |
| Contextual IMPORT | Lexer still emits IDENTIFIER; legacy parse remains separate; entity/field IMPORT controls compile |
| Grammar | Preamble-only imports, comment/BOM handling, insignificant newlines, correct entity termination, keyword-span PAR023 |
| Module forms | No import, one/nested imports, import-only entry/intermediate, relation-only and empty modules |
| Deduplication | Duplicate and normalized alternate paths; diamond; same-parent hard link; case alias where supported |
| Traversal | Exact seven-module DFS postorder: Shared, A, Empty, B, Bridge, Relations, Main |
| Unique work | Instrumented read=7, lex=7, parse=7, with duplicate/diamond edges retained |
| Depth and budgets | Iterative graph of 1,101 modules; explicit unique-module/byte limits and invalid option errors |
| Local failure precedence | Importer LEX/PAR error causes exactly one entry read and zero dependency reads |
| Cycles | Self, two-node and three-node active-stack rejection; closing literal location and portable messages |
| Canonical identity | Bigint dev/ino only; unusable identity => INP014; no identity fallback |
| Alias base binding | Compatible hard links deduplicate; different-parent hard links reject in both discovery orders |
| Root | Canonical default entry directory, explicit wider root, invalid roots, contained parent traversal, outside entry |
| Link containment | Internal file symlink and directory link; escaping symlink/junction; cached physical file cannot legalize escape |
| Read stability | First fstat mismatch and post-read ctime change => INP012; read failure => INP008; descriptor closure checked |
| Safe OS mapping | EINVAL/ENAMETOOLONG => INP004; ENOENT => INP005; ENOTDIR => INP007; ELOOP/EACCES/EIO => INP008 |
| Whole graph | Cross-file entities/relations analyzed together, no partial semantic run, empty whole program => SEM001 |
| Global names | Cross-file SEM002/SEM024 with previous declaration related locations; prototype-like names retain null-prototype symbols |
| Imported diagnostics | LEX/PAR, SEM002, SEM024, SEM028/029, WRN001, SEM036, SEM037 and SEM040 retain owning sources |
| Ordering and frames | Warning order follows module ordinals; frames use owning source, literal/name ranges retain token locations, import chain is related |

The CLI entry error after a successfully recognized preamble retains its portable
filename even when the subsequent declaration fails. Explicit invalid root
validation precedes a missing entry. Imported parser frames use the dependency's
actual line text, e.g. `models/user.apiforge:4, column 8`, rather than the entry.
Legacy same-file diagnostics are independently covered by Gate A.

## Path security and platform evidence

| Input/edge class | Result |
| --- | --- |
| Empty, NUL, C0/control, DEL, leading `/`, UNC/device spelling | INP004 |
| `C:`, `C:x`, URI scheme, backslash/mixed separators, any colon | INP004 |
| Wildcards, repeated/trailing slash, wrong/uppercase extension, unpaired surrogate | INP004 |
| Unicode including supplementary character, spaces, `%`, `$`, `~` | Literal real-file resolution succeeds |
| Dot/parent segments | Normalize; admitted only under lexical and canonical containment |
| Root-prefix sibling and outside entry | INP006; no string-prefix test |
| Missing, directory, unreadable, FIFO | INP005, INP007, INP008, INP007 respectively where supported |
| Filesystem symlink loop | Real Linux loop produces INP008; not INP009 |
| Internal link and escaping links | Canonical containment enforced before cache acceptance |

Windows execution used Node **24.14.0**, PowerShell **7.6.5**, NTFS and Node path/fs
APIs. Actual hard links, case alias deduplication and internal/escaping junctions
passed. File symlink creation returned EPERM for both internal and escaping
cases, so those privileged file-link cases, including the loop case, were
unavailable here. POSIX mode-000 unreadability and FIFO creation are unavailable
on Windows; EACCES mapping was also tested through an adapter.

Linux execution used a Docker `node:24-bookworm-slim` image, Node **24.21.0**,
non-root `node` user, read-only repository mount and disposable `/tmp` fixtures.
Image digest: `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`.
Real internal/escaping symlinks, link loop, directory links, hard links,
mode-000 EACCES and mkfifo regular-file refusal all passed. Only case-alias
deduplication skipped, because the fixture filesystem was case-sensitive.
The parser, compilation, C1/C2, CLI/HTTP and migration suites also passed on Linux.
The pinned Git oracle ran on Windows, where Git is available.

The protected-artifact verifier was run directly in PowerShell 7. Invoking it
through legacy Windows PowerShell 5 produced an array-enumeration count failure;
rerunning in its verified PowerShell 7 environment passed every manifest property.
No protected artifact was changed to address that harness mismatch.

## Gates C1/C2 and G22/G26 invariance

Nine fixtures cover all eight scalar types; implicit, generated INT, runtime UUID,
static INT/STRING/UUID keys; falsy/typed defaults; a field named `line`; IMPORT
identifiers; prototype-like field names; and all four cardinalities. Each fixture
has a single-file form, coordinate-aligned split form, and moved/nested/renamed
form with an import-only bridge. All preserve effective declaration order.

| Gate | Observed result |
| --- | --- |
| C1 | 18 comparisons (9 fixtures x 2 targets); complete ordered arrays exact, 222 files across the fixture/target set |
| C2 | 18 order-preserving moved-source comparisons; semantic/IR projections and serialized Effective Schema Plan exact after schema-specific coordinate projection |
| Model exception | 64 full model metadata payload reconstructions across both compared organizations/targets |
| Negative canaries | 129 rejected alterations: executable SELECT bytes, datatype metadata on each side/model, and declaration reordering |
| MySQL snapshots | Both split organizations per fixture retain canonical snapshot bytes, snapshot SHA-256 and physical SHA-256 |

The C2 helper only changes the existing model field metadata's own `line`
properties, reconstructing the entire known JSON array payload once and comparing
the **entire model** to fixed-coordinate generation. It does not regex JavaScript,
discard models, or remove arbitrary keys named line. Every other generated file
is compared whole and in order. Numeric operands, datatypes, defaults, enum order,
constraints, nullability and executable SQL/runtime bytes remain authoritative.
Logical IDs and physical plan contain no source-organization identity.

## Gate D: real CLI/G19, HTTP, migrations and native backends

CLI/G19/HTTP checks: **93 passed**. Both targets publish exact library-generated
files. Existing `.env` and `node_modules` entries survive successful replacement.
Missing dependency, parser failure, semantic duplicate and cycle failure leave
the entire existing output unchanged. Existing G19's 22 fault-injection groups
also pass, including failed first publication, rollback and user-root preservation.
Sources/graphs are not published. Target selection and both replacement directions
are separately covered by G27 tests.

HTTP checks preload Node modules, then guard filesystem methods during handler
execution. Parsed imports return exact INP010 text/hint and first-literal span,
tokens/declaration AST, warnings [], no generated files, and exactly six states:
lexer/parser succeeded, four downstream phases skipped. This passes for omitted,
MySQL and PostgreSQL target selection. Parser errors and invalid targets retain
precedence. IMPORT entity/field controls return 200. Frontend/ZIP remain unchanged.

G26 offline imported checks: **18 passed**, including library canonical/hash
equivalence, source snapshot, baseline, diff/create, two-revision verify and
failed-source zero history mutation. `compileSourceForSnapshot` remains literally
unchanged and rejects IMPORT using its legacy PAR007 behavior. Unsupported profile
validation precedes missing-file access. Migration CLI failure output is JSON with
portable diagnostics, never human source frames.

The native test uses the same seven-file/five-entity logical project for both
targets: User (runtime UUID key and all eight scalar types), Group (STRING key),
Post and Profile (INT keys), Audit (implicit key), plus four relationship
cardinalities in a relation-only file. Nested/duplicate imports form a diamond.
Each target is generated by the real CLI, compared to the library's full **22-file**
array, installed from declared dependencies, schema-imported and started via
`npm start` with environment credentials. The backend passes health plus **20
HTTP requests** per target: create/read/update/delete, defaults, temporal reads,
validation rejection, collection filtering/sorting/pagination and relationship
reads/association mutation. Direct native queries confirm persisted data. Backend
processes terminate and their ports are verified released.

| Native target | Observed profile and evidence |
| --- | --- |
| MySQL | 8.4.11, 16,384-byte InnoDB pages, lower_case_table_names=0, dynamic row format; 22 files, 20 requests, persistence verified |
| PostgreSQL | 18.6, UTF8, 8,192-byte blocks; restricted application role; 22 files, 20 requests, persistence verified |

MySQL image:
`mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`.
PostgreSQL image:
`postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`.

For native G26, the imported baseline equals its single-file snapshot in complete
canonical bytes and both hashes. Native information_schema equals the baseline
physical projection. Editing the imported Post file adds
`summary STRING DEFAULT "new"`; real migration CLI diff/create produces a second
immutable revision. One rendered ALTER statement is executed against MySQL.
Complete native metadata then equals the new physical projection, the seeded
Post retains title `updated` and receives summary `new`, and history verifies
two revisions. Production G26 still emits offline SQL and does not execute it.

## Existing regression commands and results

| Command | Result |
| --- | --- |
| `npm test` | PASS all 23 suites; core 1,060/1,060; G24 1,581 assertions; G25 1,120; G22 plan 2,616 and pinned equivalence 3,002, zero mismatches |
| `npm run test:g28` | PASS Gate A/B/C1/C2 and offline CLI/HTTP/G26 checks above |
| `npm run test:g28-native` | PASS actual imported MySQL/PostgreSQL backends and imported MySQL migration |
| `npm run test:g28-mysql-regressions` | PASS five existing native suites: generated backend, DB error taxonomy, DATE/TIMESTAMP, UUID and G26 migrations |
| `npm run test:g27` | PASS 1,992-check oracle, 269 valid/278 invalid, 3,479 exact MySQL files; target selection and PostgreSQL target cases |
| `npm run test:migrations` | PASS all 10 suites; older oracle 655 checks, 247 valid/268 invalid, 3,235 exact files |
| `npm run test:postgres-native` | PASS review reproduction, native DDL, emitted runtime, installed HTTP backend under PostgreSQL 18 |
| `node docs/verify-language-guide.js` | PASS 20 valid/79 invalid examples, 133 parsed generated JS files, 99 real CLI cases |
| `git diff --check` and branch diff check | PASS |
| `./tests/verify-protected-artifacts.ps1` in PowerShell 7 | PASS all 36 files, all five manifest properties |

Existing PostgreSQL native coverage includes 38 tables, 89 columns, 131 constraints,
52 indexes, 11 sequences, 33 checks and 180 check evaluations; emitted models:
30 entities/97 files/170 SQL queries; installed backend: 165 HTTP requests and
13 native error cases under a restricted role. Existing MySQL native temporal
coverage executes 25 SQL queries/431 checks; UUID executes 49 SQL queries/289
assertions; migration regression verifies 10 exact schemas, 48 migrations,
75 intermediate states, 67 preservation cases, 32 predicates and 106 omission
checks. This evidence is separate from offline/generated mock assertions.

During the full-suite run, stale registry-size assertions and the HTTP parser
fault-injection seam failed before being updated in the corrective commit. The
initial HTTP filesystem guard also intercepted Node's module loader; the harness
now preloads dependencies before asserting zero source filesystem access. These
were fixed and the complete affected suites passed before gate closure.

## Cleanup, protected artifacts and limits

Tests own disposable temporary directories, databases, roles and Docker
containers; those resources were removed. No G28-labelled containers remain.
No credentials were written into generated `.env` files. Native tests compare
repository `output/` before/after and confirm it is unchanged. Docker Desktop was
started to make native checks available and remains running. Protected roots were
never staged; all 36 protected files retain their exact original path, size,
SHA-256, creation and modification timestamps.

Remaining limits are contractual: filesystem identity must be usable; stable-read
checks detect observed changes rather than creating an atomic graph snapshot;
there are no default resource caps; changing effective declaration order is
observable; C2 permits only the existing model field-line metadata exception;
browser/HTTP cannot resolve files; G26 remains MySQL-only and offline. Privileged
Windows file-symlink coverage is unavailable on this host and is covered by the
real Linux run. No deferred namespace/package/remote feature is claimed.

**G28 STATUS: CLOSED — ready for external review, local branch only.**

## External-review correction: cycle diagnostics and C2 canary matrix

Correction verified on 2026-10-06 against reviewed tip
`56997f73baf0a029fe976b3fecd757d6d0312a8e` (`56997f7`). The original closure
evidence above is retained. This section supersedes its related-location
completeness, negative-canary total and branch-ahead count.

### Cycle duplication reproduced before the production change

Added `tests/g28-cycle-diagnostics.test.js` first and ran it against the unchanged
reviewed production code. It evaluated the self-, two- and three-module cases
before failing the complete diagnostic comparisons for both longer cycles.
For the fixture literals, every related edge has line 1, column 8, endLine 1,
endColumn 20. The observed complete arrays were:

| Cycle | Pre-fix `related` result, in actual order |
| --- | --- |
| A -> A | Property absent |
| A -> B -> A | A span with `Cycle edge.`, followed by the same A span with `Imported here.` |
| A -> B -> C -> A | A and B spans with `Cycle edge.`, followed by those same A and B spans with `Imported here.` |

The failure therefore demonstrated two copies of each preceding cycle edge,
with different messages. The same new test also exposed ordinary-chain expansion
for a self-cycle below a non-cycle entry prefix. Production was changed only
after this reproduction; the failing run was expected reproduction evidence,
not a passed gate.

### Exact cycle diagnostic correction

`CompilationUnit.diagnostic()` now excludes `original.symbol === 'IMPORT_CYCLE'`
from ordinary firstInbound-chain expansion. The existing explicit active-cycle
edge list remains untouched. This is the only correction to production behavior.
Resolver traversal, cycle construction, primary ownership and formatting remain
unchanged. Self-cycle `related` remains omitted, including below an entry prefix.

For `a.apiforge -> b.apiforge -> a.apiforge`, the complete corrected array is:

```json
[
  {
    "message": "Cycle edge.",
    "source": "a.apiforge",
    "line": 1,
    "column": 8,
    "endLine": 1,
    "endColumn": 20
  }
]
```

For `a.apiforge -> b.apiforge -> c.apiforge -> a.apiforge`, it is:

```json
[
  {
    "message": "Cycle edge.",
    "source": "a.apiforge",
    "line": 1,
    "column": 8,
    "endLine": 1,
    "endColumn": 20
  },
  {
    "message": "Cycle edge.",
    "source": "b.apiforge",
    "line": 1,
    "column": 8,
    "endLine": 1,
    "endColumn": 20
  }
]
```

The complete primary diagnostic is asserted, including input phase, error
severity, INP009/IMPORT_CYCLE, exact message and hint. Messages remain
`Import cycle: a.apiforge -> a.apiforge.`,
`Import cycle: a.apiforge -> b.apiforge -> a.apiforge.` and
`Import cycle: a.apiforge -> b.apiforge -> c.apiforge -> a.apiforge.`
The hint remains `Remove an import edge from this cycle.` Primary source is the
closing importer (A, B or C respectively), at the closing literal's unchanged
range `(1, 8)` through exclusive `(1, 20)`. Paths remain portable; absolute
temporary paths and backslashes are rejected by the assertions.

All **9 focused checks pass**: exact self/two/three-module diagnostics; imported
self-cycle; a three-module active cycle below a non-cycle prefix; ordinary
imported LEX001, PAR012 and SEM004 complete root-to-leaf related arrays; and
SEM002's complete previous-declaration plus import-chain array. The correction
does not suppress ordinary imported errors or duplicate-declaration provenance.
The new suite is included in `npm run test:g28`.

### Complete C2 negative canary categories

The nine existing fixtures were reused. C1 remains **18** exact target/fixture
comparisons over **222** ordered files; C2 remains **18** moved-source comparisons
with **64** model payload reconstructions. The canary total increases from
**129 to 186**, adding **57** explicit rejected mutations. Both source
organizations are tested on both targets for each applicable feature; all four
relationship cardinalities are covered. Declaration ordering is now checked on
both targets.

| Canary category | MySQL | PostgreSQL | Confirmed mutation |
| --- | ---: | ---: | --- |
| Datatype metadata | 32 | 32 | Existing `dataType` property changed |
| DEFAULT metadata/value | 2 | 2 | Scalar.v typed NUMBER default 0 -> 1 |
| Constraint metadata | 2 | 2 | Scalar.k PRIMARY_KEY -> UNIQUE |
| Numeric validation metadata | 4 | 4 | Existing MAX 2 -> 3 in model fields and controller WRITE_FIELDS |
| String validation metadata | 4 | 4 | Existing MAX_LENGTH 300 -> 301 in model fields and controller WRITE_FIELDS |
| ENUM metadata/order | 2 | 2 | Existing draft/active array reversed |
| Executable SQL | 32 | 32 | Existing SELECT expression changed |
| Identity metadata | 2 | 2 | Existing PRIMARY_KEY runtime_uuid generation -> none |
| Runtime identity logic | 2 | 2 | Existing crypto.randomUUID() call replaced with a constant UUID |
| Write/runtime validator logic | 2 | 2 | Existing Number.isSafeInteger(value) -> Number.isInteger(value) |
| Relationship helper logic | 8 | 8 | Throw inserted into the confirmed generated getter body |
| Declaration ordering | 1 | 1 | Existing A/B entity order reversed |
| **Total** | **93** | **93** | **186 rejected canaries** |

Every artifact canary first asserts the selected artifact/operand exists and
the change alters both its content and compared file array. Structured metadata
mutations additionally assert existing field/default/constraint/bound/ENUM values
before changing them. Complete known model metadata payloads are located uniquely;
controller JSON formatting is confirmed before changing its validation payload.
Ordering canaries assert that the compared plan entity sequence actually changed.
Each then asserts that `assertModuleGenerationEquivalent` throws.

The helper itself is **unchanged**: its Git blob is
`da1ac77357c2d47e5257ab8c6f9d49dc662cd8f4` at both the reviewed tip and corrected
tip. No projection fields were removed, no JavaScript regex masking was added,
and the exception remains only existing `Model.fields[*]` own `line` values.
Positive C1/C2 comparisons and snapshot bytes/hash invariance continue to pass.

### Rerun commands and scope review

| Command | Correction result |
| --- | --- |
| `node tests/g28-cycle-diagnostics.test.js` | PASS 9 focused checks after the expected pre-fix failure |
| `node tests/g28-resolver.test.js` | PASS 84 Windows checks; original capability skips retained |
| `node tests/g28-compilation.test.js` | PASS 40 checks |
| `node tests/g28-equivalence.test.js` | PASS C1/C2 and all 186 category-counted canaries |
| `npm test` | PASS all 23 suites; core 1,060/1,060, G22 pinned equivalence zero mismatches |
| `npm run test:g28` | PASS all gates; Gate A 2,693 checks, 289 valid/291 invalid, 3,691 exact MySQL files, zero mismatches |
| `npm run test:migrations` | PASS all 10 suites and 655-check pinned oracle |
| `npm run test:g27` | PASS 1,992-check oracle, target selection and PostgreSQL target checks |
| `node docs/verify-language-guide.js` | PASS 20 valid/79 invalid, 133 generated JS files, 99 real CLI cases |
| `git diff --check`, correction and full branch diff checks | PASS |
| `./tests/verify-protected-artifacts.ps1` in PowerShell 7 | PASS all 36 files and five manifest properties, pre/post correction |

Review confirmed no correction diff in target adapters, codegen, planning,
generated runtime templates, G26 physical production code, IR/optimizer,
frontend, frozen fixtures or the equivalence helper. Native database reruns were
not required under the external-review correction contract and were not claimed.
The previous native evidence above remains the original implementation evidence.
The only package change adds the focused cycle suite to `test:g28`; generated
dependencies and package bytes retain Gate A compatibility.

### Corrective commits, postflight and revised closure

| Commit | Correction |
| --- | --- |
| `8d6e3f81f6685173a02256bae3f83979bbc88ae0` | Cycle-specific chain suppression, exact cycle/control tests and suite command |
| `72ad2ce9f01ff1281f4af35eb126fd8e848678be` | Complete C2 canary matrix, confirmed mutations and exact category totals |
| `docs(g28): append external-review correction evidence` | This appended section; the documentation commit is named to avoid embedding its own SHA |

Postflight: `g28-imports-modules` is **14 ahead / 0 behind** both main and
origin/main, including the documentation correction commit. The original 11
commits are retained without rewriting. Local main, origin/main and remote main
remain `112a464ee4615c3956c686bfff59c9aa5d9f8497`; local and remote v1.0.0 peel
remain `9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. Tracked worktree/index are clean;
only the original four protected roots are untracked. All 36 protected files
retain exact path, size, SHA-256, creation and modification timestamps. No
protected roots were staged or modified. No push, merge, amend, rebase, squash,
force push or tag change occurred. Test fixtures were temporary and cleaned.

**Revised G28 STATUS: CLOSED — both external-review corrections verified;
ready for external review, local branch only.**
