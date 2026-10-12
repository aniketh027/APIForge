# M2D-A verification environment recovery

This supplement describes verification-only additions. The existing M2D-A
production sources, published Project Store/Windows Bootstrap, compiler, frontend,
historical fixtures, assertions and Git line-ending settings are unchanged.
Native persistent acceptance still requires separately verified disposable MySQL
8.4 and PostgreSQL 18 infrastructure.

## Default-store boundary

Do not execute the complete published `npm run test:windows-bootstrap` under a
real-default-store nonaccess policy. Its default/legacy observations are outside
that policy. Classify that command as **NOT RUN — prohibited real-default-store
access**. The earlier violating run is excluded from accepted verification.
Do not inspect real storage to establish preservation after that breach.

`tests/windows-bootstrap-fixture-only.test.js` creates a UUID-owned namespace
under the current profile and passes an explicit root on every Bootstrap call.
Its verification guard rejects missing/null/outside-namespace roots before
the production API can select its default. The unchanged Windows helper's
`resolve` operation receives an explicit root; its default-selection and legacy
probe branches never execute. The helper's known-folder retrieval remains part
of the published explicit-path admission policy.

The guard pins the published PowerShell helper's normalized Git blob, allows
only that helper and fixed verification ACL/snapshot programs, buffers complete
JSON stdin, validates its fixture operands, and only then launches PowerShell.
Unknown native programs and synchronous PowerShell calls are refused. This
boundary operates before native process creation, in addition to refusing Node
filesystem operations on prohibited default/legacy paths. It neither redirects
operations nor fabricates success. Guards are preloaded into the unchanged
regression tests and their inherited Node children. The fixture-only harness
also verifies omitted roots and native null-root requests issue no native child.

The native fixture suite covers private directory admission, immutable identity,
existing-root refusal, broad root/marker/ancestor ACLs, deny-write policy, static
junctions, marker replacement/hard links, missing root/marker, unknown entries,
simulated SQLite main/journal admission, orphan journal/WAL/SHM, directory and
hard-link SQLite entries, corrupt marker cases, file roots, Git ancestors, and
owned cleanup. Refusal snapshots compare fixture bytes, filesystem identities
and native security descriptors. Simulated SQLite bytes are not native SQLite
content/recovery evidence.

Cleanup checks this run's root device/file/birth identity, verified Bootstrap
store UUID and the exact healthy marker-only inventory immediately before
removing a root. Unknown, substituted and failed fixtures remain retained.
The surrounding UUID namespace and its test evidence remain retained.

This substitute deliberately excludes default/legacy selection and observations,
null-root default-folder simulations, elevation/second users, unsupported
volumes, Windows 10/Node 18, privileged symbolic links and descriptor installation,
synthetic raw-descriptor cases, initializer race/termination barriers, special
attribute variants, malformed/noncanonical paths outside the fixture namespace,
and power-loss/native SQLite recovery certification. The cumulative HANDOFF
lists original Bootstrap groups and the exact coverage differences. This is
not a full PASS for the original command.

## Exact Professor fixture loader

The frozen frontend tests read only
`tests/fixtures/professor-workspace.apiforge` through their original fixture
module and compare it with a textarea value. A Windows CRLF checkout contains
676 bytes (26 CRLF terminators); the approved Git blob contains 650 bytes
(26 LF terminators). The browser returns LF. Original failures must first be
reproduced on both the approved M2C export and candidate and their exact expected
and actual strings captured. Assertions and failing exit status remain intact.

`tests/verification-professor-fixture-loader.js` pins approved base
`f3c781c03641d2e421e517c5ac89a1e3804f4407` and fixture Git blob
`ca16552befad4c12b62d88522fdbb21e63303c13`. It verifies both the ref-to-blob
identity and raw Git object hash, proves the physical fixture differs only in
CRLF checkout conversion, and serves the committed LF contents only for the
configured exact absolute fixture path and its original UTF-8 synchronous read.
Unexpected modes or substantive physical changes fail closed. Every other read
delegates unchanged. No fixture or application bytes are written or substituted.
Compiler and generated output processing are unchanged.

Configure explicit `APIFORGE_VERIFY_FIXTURE_ROOT` and
`APIFORGE_VERIFY_GIT_REPOSITORY`, then preload the default-store guard and this
loader with `NODE_OPTIONS`. Apply this loader only to the two affected suites:
`test:frontend-empty-workspace` and `test:frontend-schema-diagram`. Report their
results as **PASS — fixture adjusted**. All original assertions still execute,
including both target outputs, exact ZIP comparisons and browser behavior.
`tests/verification-assertion-capture.js` is used only to record the original
AssertionError values; it preserves console errors and failing exit status.

The fresh M2C fixture export uses an external temporary Git index and the existing
checkout conversion policy. It is not a production checkout or Git worktree;
Git object reads use the existing repository. Candidate application files remain
the candidate files. Existing Playwright 1.63.0 and cached Chromium may be used
through a read-only `NODE_PATH`, without dependency installation or downloads.

## Native acceptance and reporting

Read-only Docker CLI/daemon/image checks do not authorize downloading images,
starting services or using unknown database accounts. If the configured daemon
or required official images are unavailable, native acceptance is **NOT RUN /
BLOCKED**. Do not substitute inherited DB, Live or generic test credentials.
Clear them and dedicated persistent test credentials in the verification process
environment when recording the unavailable-fixture native gate.

Offline connector tests and actual Node/TCP/shutdown tests remain separate from
real generated database CRUD, attestation, concurrent ownership, retained data
and APIForge parent-process restart. Neither process restart nor simulated
failure proves electrical power-loss durability. Both native targets must pass
before claiming full M2D-A native acceptance.

Export a new full-index binary-capable cumulative patch using an external
temporary index, preserve the actual worktree index and prior artifacts, and
record exact file inventory, size, SHA-256, command environments, exclusions and
logs in a new evidence directory. No commit or publication follows recovery.
