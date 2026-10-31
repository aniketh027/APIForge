# SQLite saved-project storage core (M2A)

This isolated CommonJS library stores local DSL projects and immutable committed
revisions. It does not compile DSL, provide HTTP endpoints or frontend UI, provision
MySQL/PostgreSQL, execute generated backends, migrate databases, or delete projects.
Generated targets remain MySQL and PostgreSQL; SQLite is internal local storage.

The ordinary compiler still requires **Node 18+**. Project Store operations require
**Windows x64, Node 24.14.0 or later, built-in `node:sqlite`, and the unchanged
[Windows private storage bootstrap](windows-storage-bootstrap.md)**. Importing the
module does not load SQLite or change normal compiler startup/tests. Node 24.14.0
is the initially demonstrated runtime, not blanket certification of later releases.
Native store tests use Node 24.14.0 / SQLite 3.51.2. The installed Node 24.19.0 /
SQLite 3.53.3 also passed the noncreating-open gate and a create/save smoke test
whose database and history were reopened by Node 24.14.0. This additional smoke
test is not the full concurrency/security matrix for Node 24.19.0.
Before calling the bootstrap or mutating storage, each lifecycle call checks the
runtime version, required SQLite APIs, URI memory behavior, STRICT tables, BLOB
round trips, transaction state, foreign keys, EXTRA synchronization, trusted-schema
behavior, and the bounded timeout. Unavailable support returns
`PROJECT_STORE_RUNTIME_UNSUPPORTED`; unsupported platforms return
`PROJECT_STORE_PLATFORM_UNSUPPORTED`. There is no generic filesystem fallback,
external SQLite binding, global runtime upgrade or repository-wide minimum change.

## Explicit lifecycle and API

Exports from `require('./src/project-store')` are exactly
`initializeProjectStore`, `openProjectStore`, and `ProjectStoreError`.
Both lifecycle functions return promises. The returned frozen store has `storeId`,
the six methods below, and no exposed native connection or filesystem path.
All project methods return promises; `close()` is synchronous and idempotent.

```js
const { initializeProjectStore, openProjectStore } = require('./src/project-store');

// Explicit first use only. A second initialization always refuses.
const store = await initializeProjectStore();
const project = await store.createProject({ name: 'Example', target: 'mysql', source: '' });
await store.saveProject(project.id, 1, { source: 'ENTITY Example\nid UUID PRIMARY KEY' });
const current = await store.getProject(project.id);
const first = await store.getProjectRevision(project.id, 1);
const summaries = await store.listProjects();
store.close();

// Subsequent startup, including following an error, uses only reopen.
const reopened = await openProjectStore();
reopened.close();
```

The bootstrap chooses the OS user's profile plus `.apiforge-projects`, subject to
its unchanged legacy-location, path, volume, ownership and ACL policy. An explicit
`{ root: canonicalAbsoluteWindowsPath }` is available for disposable profile-local
tests with an existing admitted parent. Tests never initialize/open the real store.

Initialization requires a newly created authenticated root. It reopens the marker-
only root, exclusively reserves `projects.sqlite3` using `wx`, verifies the new
file through bootstrap, and opens that reservation with SQLite URI `mode=rw`.
SQLite owns all transaction locks and journals. Schema, application identity,
metadata and bootstrap store ID are committed in one transaction. Full content
and final filesystem validation must succeed before a store object is returned.
There are no `.lock` files. Failures retain the root, marker, database and any
SQLite-owned journal for manual resolution; no takeover or cleanup is attempted.

Reopen requires the marker and main database, repeats filesystem/security admission
at the point of use, checks the formal SQLite header, and uses **noncreating
read/write URI `mode=rw`**. A pathname existence check is not its noncreation
guarantee. The native gate verifies both missing-file refusal and disappearance
after an existence observation, as well as actual read/write transactions. A
read-only connection cannot substitute for this recovery-capable open mode.
Node's versioned source uses `SQLITE_OPEN_URI` in `DatabaseSync::Open`:
[Node 24.14.0 source](https://github.com/nodejs/node/blob/v24.14.0/src/node_sqlite.cc),
[SQLite URI mode contract](https://sqlite.org/uri.html).

A rollback journal's bounded header is screened for a recognized SQLite envelope;
unrecognized/partial envelopes are preserved and refused. This is not journal
authentication or application recovery. SQLite alone decides whether a recognized
journal is hot and performs recovery under its locks. A recognized potentially hot
journal permits SQLite to recover an incomplete main-file header before strict
final header/content validation. Admission is repeated after
recovery, retaining the main file/store identity while permitting legitimate journal
creation/removal. Bootstrap's `contentValidated: false` is never used as a database
validity verdict. Missing, marker-only, corrupt, incompatible and unknown states
are not initialized, repaired, replaced or migrated.

### Close a reopened store after asynchronous work

For subsequent startup, a CommonJS caller can keep ownership of the
connection explicit. Run this from the repository directory on the
supported storage runtime:

```js
const { openProjectStore } = require('./src/project-store');

async function listSavedProjects() {
  const store = await openProjectStore();
  try {
    return await store.listProjects();
  } finally {
    store.close();
  }
}

listSavedProjects().then(console.log).catch(error => {
  console.error(error.code, error.message);
  process.exitCode = 1;
});
```

The `await` keeps the connection open until listing settles. Reopen
failure reaches the caller; this example never initializes a missing store.

## Schema, bytes and revisions

The single database has application ID `0x41504653`, user/schema version 1 and
format version 1. All three tables are STRICT:

- `store_meta`: singleton versions, canonical bootstrap UUID-v4 and immutable UTC
  creation timestamp. SQL triggers permit its initial insertion and prohibit
  subsequent insertion, replacement, update and deletion. A BEFORE INSERT guard
  rejects insertion whenever metadata already exists, including REPLACE and
  UPSERT conflict forms, with `recursive_triggers` either OFF or ON. The API does
  not issue metadata replacement statements.
- `projects`: canonical generated UUID-v4, name, exact `mysql`/`postgres` target,
  positive safe-integer revision, UTF-8 source BLOB, 32-byte SHA-256, and creation/
  update timestamps. A deferred composite foreign key references its snapshot.
- `project_revisions`: `(project_id, revision)` primary key, complete name/target/
  source/hash snapshot and UTC save timestamp. A deferred foreign key references
  its project. Triggers prohibit update/deletion and enforce contiguous insertion.

Current-state triggers require revision 1 at creation, exactly one revision of
advance per update, unchanged ID/creation timestamp, monotonic timestamps and an
identical matching snapshot. Projects cannot be deleted. Every successful explicit
save, including a supplied value equal to its old value, appends exactly one
snapshot. Duplicate project names are allowed; UUIDs are the identity. Listing is
ordered by UUID and returns metadata without selecting source BLOBs.

`createProject({name,target,source})` requires all three fields, including an
explicit empty source for an empty project. `saveProject(id, expectedRevision,
changes)` requires at least one own data field from `name`, `target`, `source`.
Omitted fields retain their saved values; `source: ''` intentionally clears source.
Unknown fields, accessors, arrays, non-plain objects and unexpected types refuse.
No field changes project ID. `getProjectRevision(id, revision)` reads committed
history. Missing projects/revisions return `PROJECT_NOT_FOUND`.

Names are nonempty after a whitespace check, at most 128 Unicode scalar values
and 512 UTF-8 bytes. Controls, format characters, line/paragraph separators and
ill-formed UTF-16 refuse. Names are never trimmed, rewritten or truncated: retained
leading/trailing spaces are intentional. Targets are case-sensitive exact values.
IDs are lowercase canonical UUID-v4. Revisions must be positive safe integers;
advancing past `Number.MAX_SAFE_INTEGER` refuses.

Source accepts a well-formed JavaScript string or a Buffer of valid UTF-8, at most
**1 MiB (1048576 bytes)**. Buffers are copied before asynchronous admission and
decoded with fatal UTF-8 validation. Returned source is a string; converting it
back with `Buffer.from(source, 'utf8')` reproduces the exact input bytes, including
BOM, CRLF/LF, Unicode, whitespace, NUL and empty content. No DSL validation or
normalization occurs. `sourceHash` is lowercase SHA-256 hex. Current records also
return `createdAt`/`updatedAt`; historical records return `savedAt`. Timestamps
use canonical 24-character ISO UTC representation.

## Transactions, validation and errors

Each native connection enforces DELETE journal mode, synchronous=EXTRA,
foreign_keys=ON, trusted_schema=OFF, temp_store=MEMORY and a **350 ms** SQLite busy
timeout. Extensions are disabled, defensive mode is enabled, and the authorizer
denies ATTACH/DETACH, extension loading and changes to these protected settings.
No WAL, SHM, other databases or application-managed locks are supported.
Every operation repeats Windows admission and header/journal screening; it checks
DELETE mode before beginning a transaction. Native SQLite lock waits are bounded
by 350 ms; Windows admission has its own bootstrap helper time bounds.

Writers use `BEGIN IMMEDIATE`, read and compare the explicit expected revision,
insert the snapshot, conditionally update current state, and COMMIT. Stale writers
receive `PROJECT_REVISION_CONFLICT`, without overwriting, appending history or
retrying against a new revision. Handled failures roll back open transactions.
SQLite BUSY/LOCKED becomes `PROJECT_STORE_BUSY`; callers may try again with their
original expected revision. Read operations use a coherent SQLite read transaction.

A failure after a successful COMMIT but before acknowledgment returns
`PROJECT_COMMIT_UNCERTAIN`: reopen/read before retrying. This accurately separates
acknowledgment from persistence. A process killed after COMMIT likewise may have
committed data even if the caller never received its result.

Opening checks header/journal format, application/user versions, exact application-
owned schema SQL and expected indexes, immutable store ID, canonical metadata,
`integrity_check(1)`, foreign-key consistency, contiguous history, timestamps, exact
current/snapshot equality, and every source's byte length, UTF-8 and SHA-256.
Unknown/older/future schemas refuse. An unpublished candidate database missing the
metadata INSERT guard also refuses as incompatible; there is no automatic
migration, metadata rewrite or deletion. Reads screen byte lengths before
materializing metadata/BLOBs, stream history during validation, and allocate at most one bounded
source per record. SQLite itself still parses pages/schema under its own compiled
limits; these application bounds are not an engine-wide memory sandbox.

Errors expose only the fixed `ProjectStoreError` name, `code` and sanitized message,
with no raw path, SQLite message, native numeric error or cause. Validation codes
are `PROJECT_INVALID_INPUT`, `PROJECT_INVALID_ID`, `PROJECT_INVALID_NAME`,
`PROJECT_INVALID_TARGET`, `PROJECT_INVALID_SOURCE`, `PROJECT_INVALID_REVISION`.
Lifecycle/content codes are `PROJECT_STORE_EXISTS`, `PROJECT_STORE_MISSING`,
`PROJECT_STORE_UNSAFE`, `PROJECT_STORE_IDENTITY_MISMATCH`,
`PROJECT_STORE_INCOMPATIBLE`, `PROJECT_STORE_CORRUPT`,
`PROJECT_STORE_RECOVERY_REQUIRED`, `PROJECT_STORE_STORAGE_FAILURE` and
`PROJECT_STORE_CLOSED`; revision/runtime/concurrency codes are documented above.
Parameters are bound to prepared statements. Only fixed application-owned SQL
identifiers are used.

## Verification and boundary

Run `npm run test:project-store` explicitly with a supported runtime. The dedicated
harness retains UUID-named disposable private roots and `results.json` under the
user profile. It exercises lifecycle refusal/preservation, exact bytes and input
bounds, immutable history, faults at each save stage, independent-process races,
bounded lock failures, corruption, ACL refusal, and externally terminated workers.
Hot-journal recovery counts as PASS only when a real journal magic/header and
spilled uncommitted database pages were observed before external termination.
An acknowledged failure after commit is tested separately from rollback.

The guarantee covers accidental loss/overwrite, stale writers and cooperating
processes within an **OS-private local Windows namespace**. Malicious processes
with the same effective authority and administrators are excluded. Repeated
pathname checks are detection within that boundary, not atomic hostile-process
confinement. Native second-user access, Windows 10, native Node 18 compiler runs,
Linux/macOS, unsupported volumes and sudden power loss require separate evidence.
EXTRA synchronization and process-crash recovery do not establish electrical
power-loss durability. No migrations, repair, backup policy or new platform
bootstrap are introduced in M2A.
