# G19 atomic generated-output publication

Preservation correction verified 2026-10-04 (Asia/Calcutta), Windows PowerShell, Node v24.14.0,
libuv 1.51.0. Scope: handled filesystem failures during one disk generation.
This supersedes the preservation design in original G19 commit
`390a05a12667837fc2bc0f533dda5a7a4f60491d`; that commit is retained unchanged.

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
3. Write every generated file to staging, then read each back and compare its
   complete UTF-8 bytes with the in-memory file map. No published file is written
   or pruned during this preparation.
4. If output exists, reserve a unique sibling
   `.output.apiforge-g19-backup-<suffix>` container and rename `output/` to its
   previously absent `previous/` child. This keeps staging/backup on the same
   filesystem and avoids renaming onto an existing directory on Windows.
5. Enumerate only the immediate roots of `backup/previous`. Move each user-owned
   root with `renameSync(backup/previous/<entry>, staging/<entry>)`, recording
   successful transfers. Each root is an opaque filesystem object: the publisher
   never traverses, reads, copies, resolves or clones its contents or links.
   The same rule applies to `.env`, notes, nested trees and `node_modules`.
6. After every user root has transferred, rename staging to the absent
   destination. This is the commit point.
7. Remove the remaining backup containing obsolete generated material after
   commit. A successful return has no operation-owned
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
| Preflight, staging creation/write/readback | Old output remains byte-identical; absent output stays absent; staging cleanup is attempted |
| Backup reservation or first rename | Old output remains in place; operation-owned temporary directories are cleaned where possible |
| User-root enumeration/transfer fails | Reverse every successful transfer, then restore `backup/previous` to destination; original failure remains primary |
| Staging publication rename after moving user roots | Reverse all user-root transfers, restore `backup/previous` to destination, then clean staging and the empty backup container |
| Reversing a user-root transfer fails | Attempt the other reversals; retain both staging and backup; do not publish incomplete old output; report each surviving user-root path and intended restore path |
| Restoring the old directory fails after user roots are reversed | Preserve complete old output in backup with the original failure and rollback context; generated-only staging may be cleaned |
| Cleanup fails while handling an earlier error | Preserve the original Error object/OS code; attach `cleanupErrors` and remaining temporary paths |
| Backup deletion fails after successful publication | Keep the complete new output; throw the cleanup Error with `outputPublication.published = true` and the remaining backup path; never roll back |

Runtime context is carried on `error.outputPublication` with destination,
published status, remaining staging/backup/previous locations, and
`unrecoveredUserRoots` containing each surviving `path` and intended `restoreTo`.
The first rollback Error is also exposed as `rollbackError`; `rollbackErrors`
records all failures with entry/source/destination context. No cleanup operation
is attempted against a recovery tree still holding user data. The CLI keeps its
existing internal codegen diagnostic, abort message, and exit status 1, and adds
an `[OUTPUT]` stderr line for these failures so cleanup/rollback context is not
hidden. Codegen successful return shape and API/ZIP behavior remain unchanged.
There are no new public compiler diagnostic codes.

## Platform verification and limitations

The correction's real Windows test created a user-owned junction, moved it with
one root rename, and verified unchanged filesystem identity, link target and
outside target bytes. Directory, file and relative-file symlink variants are
conditional: creation was denied with EPERM on this host, so those variants were
explicitly skipped. Junction preservation passed without cloning the link or
requiring link-creation privileges during publication. Tests use actual Node filesystem operations with narrow
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

This sequence provides handled-failure transaction behavior. The destination is
absent from the backup rename through user-root transfers and the final rename,
so the gap includes one rename per user root. It does not provide uninterrupted readers,
concurrent-writer arbitration, recovery from killed processes/power loss, fsync
durability, deployment versions, or a filesystem journal. A filesystem can reject
both publication and rollback; in that case automatic restoration is impossible.
After a failed user-root rollback, old output is recoverable across the retained
staging and backup trees rather than assumed complete in either tree alone.
Windows locks, antivirus,
mount boundaries, or permissions may cause I/O failures; there is no cross-device
copy fallback. Preservation requires native rename permissions, not read access
to user-tree contents or duplicate storage for those trees. Temporary space is
needed for newly generated files. Native same-filesystem moves keep the original
user objects instead of reconstructing their metadata or links. Relative links
can resolve differently while parked in staging/backup; they are not followed by
the publisher and regain their original location after publication or complete
rollback. Mount points/cross-device user roots or locked objects may reject a
rename and require the documented rollback/recovery path. No permissions are
bypassed and no `node_modules` special case is used.

## Regression evidence

The revised `tests/atomic-output-publication.test.js` has 22 groups:

- A/B: an actual partial staging write followed by injected ENOSPC at each of
  the 13 generated files, with and without previous output; snapshots also verify
  unchanged published bytes during every staging write.
- C: final publication failure after all user roots move, reverse transfers,
  full old-output restoration, original Error propagation and temporary cleanup.
- D/E/F: successful first generation, replacements and repeated generations;
  exact file inventory, stale/empty managed-directory removal, binary `.env`,
  notes and nested user-directory preservation, and no temporary residue.
- G: compare all seven valid repository samples with the pinned V1 generator;
  all 79 generated files are byte-identical in memory and on disk.
- First rename/first publication failures, rollback failure, staging and backup
  cleanup errors, user-root enumeration/readback failures, silent write corruption, and staging/
  backup reservation failures.
- Path escape/duplicate rejection, the original G19 filesystem-shape reproduction,
  Windows junction/linked-root rejection, interrupted-run name isolation, and
  real CLI write/transfer/publication/cleanup failures via deterministic preload injection.
- Every Nth transfer in a four-root old project fails deterministically; all
  earlier moves reverse and the complete old-output snapshot is restored.
- User-root rollback failures during both transfer and final-publication failure,
  with one or multiple failed reversals: original Error/OS code remains primary,
  other reversals continue, both trees survive, and their surviving-user-root
  union exactly reconstructs the old output. Exact recovery paths are asserted.
- A 1,000-file, 50-package `node_modules` tree causes one root transfer, zero
  user-tree traversal/copy operations, and unchanged root object identity.
  `.env`, notes and another nested user directory also retain their identities.
  Copy APIs are made to throw, and production source contains no `cpSync`.
- Creatable user-owned Windows junction survives one rename with unchanged
  identity/target; conditional symlink variants report their actual availability.

| Check | Result |
|---|---|
| `npm run test:disk-generation` | PASS: original disk regression and all 22 revised groups |
| `npm test` | PASS: core 1,060 assertions, all additional suites, all 22 revised groups; 0 failures |
| `node docs/verify-language-guide.js` | PASS: 18 valid + 67 invalid examples, 120 emitted JS files parsed, 85 real CLI invocations |
| `npm run test:generated-integration` | PASS: install/start/health on ephemeral port; process/temp/repository-output cleanup verified |
| Generated MySQL safety, naming, relationship, OpenAPI, target and V1 audit suites | PASS within `npm test` |
| `git diff --check` | PASS |

Live MySQL was not required or run: no generated runtime/schema behavior changed.
Install/start/health evidence is not database persistence evidence.

## Protected artifacts and Git boundary

The original G19 baseline was the frozen V1 SHA. Before this correction,
development HEAD was `005e3c48a3361b94be66e7ad3eaf46c77aa49627` and main/origin/main
were `8d7318a29ae27565cb9a88a2c1b3125d5d48046d` after three separately authorized
documentation commits. The annotated `v1.0.0` tag still peeled to frozen commit
`9d5b223b0af350a237625f4cd8dfbc700e35dd1b`. Tracked worktree/index were clean;
only the four approved protected roots were untracked. This correction stays on
`g19-atomic-output-publication`, adds a new commit, does not amend the original
G19 commit, and does not merge, push, or change main/the tag.
The existing protected-artifact workflow snapshots and
compares all 36 paths, sizes, SHA-256 hashes, creation timestamps and modification
timestamps before and after work. The final comparison passed: all 36 files
remained unchanged in every recorded
property; repository `output/` remained unchanged as well.

No blocking or correctness issues found in the reviewed scope.
