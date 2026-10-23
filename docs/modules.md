# G28 filesystem imports and modules

G28 V1 compiles local `.apiforge` files as one ordered logical program. The
entry file and its dependencies share the existing global entity namespace
and global relation-name namespace. MySQL remains the default target;
PostgreSQL 18 uses the same resolved program. See
[verification evidence](modules-verification.md) for the pinned compatibility
and native backend checks.

## Syntax and contextual IMPORT

`main.apiforge`:

```apiforge
IMPORT "./entities/account.apiforge"
IMPORT "./entities/message.apiforge"
IMPORT "./relations.apiforge"
```

`entities/account.apiforge`:

```apiforge
ENTITY Account
  key UUID PRIMARY KEY
  email STRING REQUIRED UNIQUE
```

`entities/message.apiforge`:

```apiforge
IMPORT "account.apiforge"
ENTITY Message
  key INT PRIMARY KEY
  body STRING REQUIRED
```

`relations.apiforge`:

```apiforge
RELATION Account MESSAGES Message ONE_TO_MANY
```

An import is uppercase identifier `IMPORT` followed by a string literal at a
declaration boundary. It is contextual: the lexer still produces an IDENTIFIER
for IMPORT. `ENTITY IMPORT id INT PRIMARY KEY` and
`ENTITY Item IMPORT STRING` retain their existing meanings. Newlines remain
insignificant; comments work normally; there are no semicolons or aliases.

The module grammar is `ImportDecl* (EntityDecl | RelationDecl)*`. Place every
import before the first entity or relation. A recognized import after a
declaration reports PAR023 at its IMPORT keyword:

> IMPORT declarations must precede ENTITY and RELATION declarations.

Its hint is `Move this IMPORT into the module's import preamble.` The module
parser distinguishes an IMPORT field followed by a datatype from an import
followed by a string literal, including at the end of an entity.

`Parser.parse(tokens)` retains the legacy single-source grammar and return
shape. `Parser.parseModule(tokens)` returns `{ ast, imports }` without reading
files. Its AST contains declarations only; each import records its literal
value and literal token location separately.

## Paths and root confinement

Import literals use `/` separators and end with exact lowercase `.apiforge`.
The leading `./` is optional. `.` and `..` segments are allowed if both the
lexical candidate and canonical target remain inside the compilation root.
Resolution uses the canonical importing file's directory, including for nested
imports. It does not use the invocation directory or the raw spelling of a link.

| Accepted literally | Rejected |
| --- | --- |
| Well-formed Unicode, spaces, `%`, `$`, `~` | Empty strings; unpaired UTF-16 surrogates |
| `models/item.apiforge`, `./models/item.apiforge` | Leading `/`, `//`, drives such as `C:` or `C:x` |
| `././item.apiforge`, contained `../item.apiforge` | URI schemes, all remaining `:`, backslashes, mixed separators |
| Unicode spelling exactly as supplied | U+0000–U+001F, U+007F, `*`, `?` |
| Existing files with an exact `.apiforge` suffix | Repeated or trailing `/`; other extensions; `.APIFORGE` |

There is no trimming, escape expansion, environment expansion, URI decoding,
Unicode normalization, extension guessing, package lookup or OS reserved-name
blacklist. Filesystem failures map to safe input diagnostics.

The default root is the canonical directory of the entry file. Use
`--root <directory>` or library option `root` when the entry is deeper inside
the project. Relative root and entry arguments resolve against the cwd captured
by the filesystem adapter at invocation. An explicit root must canonicalize to
an accessible directory; the entry must be contained in it. Containment uses
Node path operations and physical directory ancestry, never string prefixes.

### Example: entry and models in sibling directories

For your own project with `project/src/main.apiforge` and
`project/models/student.apiforge`, put this in the entry file:

```apiforge
IMPORT "../models/student.apiforge"
```

The model file can contain:

```apiforge
ENTITY Student
  id INT PRIMARY KEY
  name STRING REQUIRED
```

From the directory containing `project/`, compile with:

```bash
node index.js project/src/main.apiforge --root project
```

Without `--root project`, the default root is `project/src/`, so the sibling
model import escapes that root and is refused with `INP006`. The explicit
root admits both directories while preserving containment within `project/`.

## Identity, aliases and stable reads

The adapter uses `fs.realpathSync.native(..., { encoding: 'utf8' })` without
lowercasing or Unicode normalization. Bigint stat/fstat identity must have
`dev >= 0n` and `ino > 0n`; the invocation-local Map key is the pair `(dev, ino)`.
There is no path, content-hash, size or timestamp fallback for identity.

Each physical file is also bound to its canonical parent directory and ordered
physical directory ancestry from the root. Compatible aliases, including
same-parent hard links and case aliases on a filesystem that supports them,
deduplicate. A hard link reached from a different import base reports INP014
on the later edge, in either discovery order. This rule applies even if the
file currently has no imports.

Internal symlinks and junctions are allowed. A canonical target outside the root
reports INP006. Both containment checks run before cached identity can be
accepted, so an escaping alias cannot borrow a previously admitted file's identity.

For a first read, the adapter verifies a regular file, compares stat with the
opened descriptor's bigint fstat, captures bytes, and compares identity, size,
mtimeNs and ctimeNs again. Observed replacement or modification reports INP012.
Descriptors close on success and failure. The CLI adopts its already captured
entry contents and opened-file evidence when imports are recognized, avoiding
a second entry read. Cache contents exist only for one compilation invocation.

These checks detect observed races; they are not an atomic filesystem snapshot
or a guarantee against an adversarial filesystem changing directory ancestry
between checks. Filesystems with unusable physical identities fail with INP014.

## Graph order and whole-program semantics

Imports are visited in source order using iterative dependency-first DFS
postorder. For `main -> A, B`, `A -> Shared`, `B -> Shared`, emission is
`Shared, A, B, main`. Every unique physical module is read, tokenized, parsed and
emitted once. Duplicate edges are silent and retained internally for provenance.
There is no default module, byte or depth cap.

An active DFS target closes a graph cycle and reports INP009 at the closing
path literal. Its message is `Import cycle: <portable path chain>.` The chain
is the active-stack segment, without rotation or sorting. A filesystem link
loop is an INP008 filesystem failure, separate from a graph cycle.

Every current module completes lexical analysis and parsing before its
dependencies are followed. The entire graph resolves before semantic analysis
runs once. Entity-only, relation-only, import-only and empty modules are legal;
the whole program still requires an entity (SEM001), and each declared entity
still needs a field (SEM004). Relations can reference entities anywhere in the
graph. Duplicate entity/relation names retain SEM002/SEM024.

The merged Program has exactly the enumerable `type`, `entities`, `relations`
shape and uses the original declaration objects in postorder. Entities, fields
and relations are never sorted to manufacture invariance. Changing effective
declaration order is observable and falls outside module-layout equivalence.

## Provenance and diagnostics

Non-enumerable ownership follows tokens, AST nodes, existing sourceLocations,
numeric literal locations, IR instructions and optimizer copies. AST and IR
line values retain their actual per-file coordinates. There is no IMPORT IR
instruction. Paths, file identities, source hashes and graphs do not enter
serialized IR, the Effective Schema Plan, snapshots, history or generated files.

File-aware boundaries copy diagnostics with a portable, root-relative `source`.
They can add `related` locations for the original declaration and the import
chain. Pure phase APIs retain their legacy enumerable diagnostics. Ordering is
compiler phase, module emission ordinal, line, column, code, then stable ties.
Missing positions sort last. Frames select the owning file's captured source:

```text
  --> entities/message.apiforge:4, column 3
```

Recognized multi-module CLI diagnostics include filenames and related locations;
ordinary no-import CLI formatting retains its approved-main bytes. Canonical
absolute paths and physical IDs stay internal. The existing CLI informational
entry argument remains unchanged for compatibility.

| Code | Meaning |
| --- | --- |
| PAR023 | Recognized import after a declaration |
| INP004 | Invalid import literal; filesystem EINVAL/ENAMETOOLONG |
| INP005 | Source not found; ENOENT |
| INP006 | Entry/import escapes the root |
| INP007 | Target is not a regular file; ENOTDIR |
| INP008 | Other canonicalization/open/read failures, including link loops |
| INP009 | Graph cycle |
| INP010 | Imports need a filesystem context |
| INP011 | Explicit library resource budget crossed |
| INP012 | Observed source instability |
| INP013 | Invalid explicit compilation root |
| INP014 | Unusable physical identity or incompatible alias import base |

External source/target/root validation precedes entry reads. Then current-module
lexing, parsing and source-order recursive resolution precede merge, semantic
analysis, IR, optimization and target admission. Thus local LEX/PAR failure
beats a bad import; a bad import beats SEM001; imported LEX/PAR retains its code.

## CLI and file-aware library

```sh
node index.js project/main.apiforge
node index.js project/main.apiforge --target postgres
node index.js project/src/main.apiforge --root project --target mysql
```

Resolved imports may print `[INFO] Resolved N modules` and portable per-module
token summaries. All graph resolution and compilation/admission finishes before
the existing G19 output publisher runs. Failed resolution or compilation causes
no output publication. Sources are not copied into the generated project.

```js
const { resolveFile, compileFile } = require('./src/compiler');
const unit = resolveFile('project/main.apiforge', { root: 'project' });
const result = compileFile('project/main.apiforge', {
  target: 'postgres', root: 'project', maxModules: 100, maxSourceBytes: 1000000
});
// result.generatedFiles is the ordered in-memory { path, content } array.
```

`resolveFile` resolves and merges without semantic analysis or generation.
`compileFile` runs whole-program compilation and generates in memory; it never
publishes output. Target accepts only exact `mysql`/`postgres`, defaulting to
MySQL. Optional limits are positive safe integers and count the entry plus
unique physical modules and their captured byte lengths; duplicate edges do
not consume a second allowance. Invalid limit values are programmer TypeErrors.

Successful compilation exposes `ast`, `semantic`, `symbolTable`, `ir`,
`optimizedIR`, `optimizations`, `warnings`, `plan`, `generatedFiles` and the
existing six phase states. Its non-enumerable `compilationUnit` provides captured
source/frame context. Failures throw with file-aware `diagnostic`/`diagnostics`
and, after a unit exists, non-enumerable `compilationUnit`. Pure Lexer, Parser,
SemanticAnalyzer, IRGenerator, Optimizer and Codegen APIs never resolve imports.

## HTTP, browser and G26

HTTP remains `{ source, target? }`. After successful module parsing, any imports
return HTTP 400, input-phase INP010 at the first import path literal:

> Imports require a filesystem compilation context.

The hint is `Use node index.js <entry.apiforge> or the file-aware compiler API.`
Lexer/parser are succeeded; semantic/IR/optimizer/codegen are skipped. Tokens,
the declaration AST and `warnings: []` are returned, with no later artifacts.
No source filesystem access occurs. A parser error takes precedence over this
context check. Ordinary IMPORT identifiers still compile. The unchanged browser
uses this same response and six-phase visualization; there is no multifile UI.

G26 keeps `compileSourceForSnapshot(source, profile)` literally unchanged.
`compileFileForSnapshot(entryPath, profile = 'mysql-8.4-v1', options = {})`
uses the shared resolver and complete target admission. The migration CLI's
`snapshot --to`, `diff --to` and `create --to` compile entry files and accept
optional `--root`. Canonical snapshots and their snapshot/physical SHA-256
values depend on physical schema, never source organization or coordinates.
History/publication safeguards are unchanged. G26 remains offline and MySQL-only;
native tests execute generated migration SQL separately.

## Equivalence and deferred scope

G28 preserves approved-main no-import behavior against commit
`112a464ee4615c3956c686bfff59c9aa5d9f8497`, without refreshing frozen fixtures.
Coordinate-aligned, order-preserving single-file/module arrangements compare
complete ordered generated arrays byte for byte on both targets.

For source moves that change coordinates while preserving effective entity,
field and relation order, semantic/physical equivalence permits only the
existing generated model metadata `Model.fields[*]` **own `line` values** to
change. SQL, executable model code, validation, routes, controllers, OpenAPI,
configuration and all other bytes must remain exact. The oracle reconstructs
that complete known metadata payload and compares the entire model; it does
not apply arbitrary JavaScript regex masking or remove other `line` keys.

MODULE declarations, AS/aliases, qualified/selective imports, exports/private
symbols, re-exports, manifests, package/npm/git/HTTP imports, virtual filesystems,
watchers, incremental builds, persistent caches and PostgreSQL migrations are
deferred. Module identity is never a physical schema or target policy input.
