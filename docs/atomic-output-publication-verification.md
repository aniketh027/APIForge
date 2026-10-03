# G19 atomic generated-output publication

Verified 2026-10-03 (Asia/Calcutta), Windows PowerShell, Node v24.14.0,
libuv 1.51.0. Scope: handled filesystem failures during one disk generation.

## Root cause and entry points

Frozen V1 commit `9d5b223b0af350a237625f4cd8dfbc700e35dd1b` produced the
complete `{ path, content }` array in `CodeGenerator.generate` before writing.
Its private `writeGeneratedFiles` then wrote directly into published `output/`,
file by file, and pruned obsolete files from five managed directories afterward.
There was no filesystem transaction. A disposable reproduction with an old
`database/schema.sql` and a regular file at `output/config` overwrote the schema
before throwing the existing real-directory error. The new regression verifies
that this exact failure preserves the old schema and entire directory snapshot.

`index.js` calls `CodeGenerator.generate(optimizedIR, true)`. Direct callers also
publish when the flag is true or omitted. These share the new helper.
`src/api/compiler-api.js` passes false and returns the in-memory file map; browser
ZIP creation uses that map. Neither publishes a server-side directory.
Generated integration/MySQL test harnesses materialize in-memory projects only
inside disposable test directories; they are not production publication paths.

## Publication algorithm

1. Validate generated paths/contents and the destination/managed-directory shape
   before mutation. Destination and managed roots must be real directories;
   traversal, duplicate paths, and linked roots are rejected.
2. Reserve `.output.apiforge-g19-stage-<mkdtemp suffix>` beside `output/`.
   Copy user-owned root entries into staging without dereferencing links.
3. Write every generated file to staging, then read each back and compare its
   complete UTF-8 bytes with the in-memory file map. No published file is written
   or pruned during this preparation.
4. If output exists, reserve a unique sibling
   `.output.apiforge-g19-backup-<suffix>` container and rename `output/` to its
   previously absent `previous/` child. This keeps staging/backup on the same
   filesystem and avoids renaming onto an existing directory on Windows.
5. Rename staging to the absent destination. This is the commit point.
6. Remove the backup after commit. A successful return has no operation-owned
   staging/backup directories. Old interrupted-run directories are never reused
   or deleted by a later operation.

The published generated file set is exactly the new map. Existing compatibility
requires preserving user-owned root entries such as `.env`, notes, and user
directories in addition to that map. Obsolete artifacts and empty nested
directories inside models/controllers/routes/config/database disappear.
No emitted SQL, runtime JavaScript, README, environment template, package
metadata, OpenAPI contents, dependency ranges, compiler phases, or diagnostics
were changed by G19.

## Failure and cleanup policy

| Failure | Result |
|---|---|
| Preflight, copy, staging creation/write/readback | Old output remains byte-identical; absent output stays absent; staging cleanup is attempted |
| Backup reservation or first rename | Old output remains in place; operation-owned temporary directories are cleaned where possible |
| Staging publication rename after moving old output | Restore `backup/previous` to destination, then clean staging and the empty backup container |
| Rollback itself fails | Preserve the old backup; throw the original publication error with `rollbackError` and the recovery path; clean staging where possible |
| Cleanup fails while handling an earlier error | Preserve the original Error object/OS code; attach `cleanupErrors` and remaining temporary paths |
| Backup deletion fails after successful publication | Keep the complete new output; throw the cleanup Error with `outputPublication.published = true` and the remaining backup path; never roll back |

Runtime context is carried on `error.outputPublication` with destination,
published status, and remaining staging/backup locations. The CLI keeps its
existing internal codegen diagnostic, abort message, and exit status 1, and adds
an `[OUTPUT]` stderr line for these failures so cleanup/rollback context is not
hidden. Codegen successful return shape and API/ZIP behavior remain unchanged.
There are no new public compiler diagnostic codes.

## Platform verification and limitations

The real Windows probe rejected direct replacement of a nonempty directory
with `EPERM`, successfully renamed populated sibling directories for publication
and rollback, and preserved the old backup when rollback was obstructed by an
existing destination. Tests use actual Node filesystem operations with narrow
injected failures rather than permissions, scheduling, or OS races.

[Node documents synchronous rename](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrenamesyncoldpath-newpath).
The [matching libuv Windows implementation](https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c#L2109-L2116)
uses `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`.
[Microsoft documents](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
that directory moves must remain on the same drive and an existing directory
cannot be replaced with that flag.
[libuv's filesystem contract](https://docs.libuv.org/en/v1.x/fs.html#c.uv_fs_rename)
maps rename to the POSIX operation. The algorithm uses unused targets and does
not depend on POSIX replacement of existing directories. Linux/macOS were not
executed on this host; their behavior is supported by these platform contracts.
All used Node APIs are available under the repository's Node >=18 requirement.

This sequence provides handled-failure transaction behavior, with a brief absent
destination between the two renames. It does not provide uninterrupted readers,
concurrent-writer arbitration, recovery from killed processes/power loss, fsync
durability, deployment versions, or a filesystem journal. A filesystem can reject
both publication and rollback; in that case automatic restoration is impossible
and the complete old backup is retained for recovery. Windows locks, antivirus,
mount boundaries, or permissions may cause I/O failures; there is no cross-device
copy fallback. Copying user-owned entries requires read/copy permissions and
temporary disk space. In a real Windows probe, cloning a user-owned junction via
Node's copy API failed with EPERM on this host; the old output remained intact.
User-owned entry contents and timestamps are copied, but filesystem object
identity, extended metadata/ACL equivalence, and links requiring unavailable
creation privileges are not guaranteed. These are reported failures rather than
permission bypasses or partially exposed output.

## Regression evidence

`tests/atomic-output-publication.test.js` adds 18 groups:

- A/B: an actual partial staging write followed by injected ENOSPC at each of
  the 13 generated files, with and without previous output; snapshots also verify
  unchanged published bytes during every staging write.
- C: second rename failure, complete old backup observation, rollback, original
  Error propagation, and temporary cleanup.
- D/E/F: successful first generation, replacements and repeated generations;
  exact file inventory, stale/empty managed-directory removal, binary `.env`,
  notes and nested user-directory preservation, and no temporary residue.
- G: compare all seven valid repository samples with the pinned V1 generator;
  all 79 generated files are byte-identical in memory and on disk.
- First rename/first publication failures, rollback failure, staging and backup
  cleanup errors, copy/readback failures, silent write corruption, and staging/
  backup reservation failures.
- Path escape/duplicate rejection, the original G19 filesystem-shape reproduction,
  Windows junction/linked-root rejection, interrupted-run name isolation, and
  real CLI write/publication/cleanup failures via deterministic preload injection.

| Check | Result |
|---|---|
| `npm run test:disk-generation` | PASS: original disk regression and all 18 new groups |
| `npm test` | PASS: core 1,060 assertions, all additional suites, all 18 new groups; 0 failures |
| `node docs/verify-language-guide.js` | PASS: 18 valid + 67 invalid examples, 120 emitted JS files parsed, 85 real CLI invocations |
| `npm run test:generated-integration` | PASS: install/start/health on ephemeral port; process/temp/repository-output cleanup verified |
| Generated MySQL safety, naming, relationship, OpenAPI, target and V1 audit suites | PASS within `npm test` |
| `git diff --check` | PASS |

Live MySQL was not required or run: no generated runtime/schema behavior changed.
Install/start/health evidence is not database persistence evidence.

## Protected artifacts and Git boundary

Before implementation, main, origin/main, and live remote main matched the frozen
V1 SHA; the annotated `v1.0.0` tag still peeled to that commit. Tracked worktree
and index were clean; only the four approved protected roots were untracked.
Work remains on `g19-atomic-output-publication`; main and the tag were untouched,
with no merge or push. The existing protected-artifact workflow snapshots and
compares all 36 paths, sizes, SHA-256 hashes, creation timestamps and modification
timestamps before and after work. The final comparison passed: all 36 files
remained unchanged in every recorded
property; repository `output/` remained unchanged as well.

No blocking or correctness issues found in the reviewed scope.
