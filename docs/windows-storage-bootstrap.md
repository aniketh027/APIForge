# Windows private storage bootstrap (M2A-W)

This server-side library establishes a private directory and bootstrap identity.
It is independent of the compiler, HTTP server, frontend, Live API and Project
Store. It creates **no database**. SQLite remains a proposed later internal store;
generated backends continue to use MySQL or PostgreSQL.

## Run from an ordinary clone

The compiler's public Node **18+** requirement is unchanged. This module uses only
Node 18 built-ins and built-in **Windows PowerShell 5.1 / .NET Framework**, on
Windows 10/11 **x64**. No PowerShell 7, npm native binding, C++ compiler, Visual
Studio, downloadable helper binary or installation step is required. Windows
PowerShell must be present and permit FullLanguage execution; organization policy
may disable it, in which case bootstrap refuses with a fixed error. No execution
policy, machine policy or privileges are changed. Other Windows architectures
and native Windows 10 / Node 18 execution still require separate validation.

From the repository root, explicitly initialize once:

```js
const { initializePrivateStoreRoot, openPrivateStoreRoot } =
    require('./src/windows-bootstrap');

// First initialization is an explicit lifecycle decision.
const identity = await initializePrivateStoreRoot();
// On subsequent startup use only this operation, including after an error.
const reopened = await openPrivateStoreRoot();
```

These calls return promises, so use them inside an async function in a CommonJS
application. The default is the OS current user's `LocalApplicationData` known
folder plus **`APIForge-ProjectStore`**. Environment `LOCALAPPDATA` is not used to
choose storage. There is no fallback. A missing default parent or unsafe known
folder is an error; no ancestors are created or repaired.

Both operations accept `{ root: canonicalAbsoluteWindowsPath }` for an explicitly
selected disposable test root under the OS current user's profile. Its parent
must already exist and pass all checks. The override is for isolated tests, not
an HTTP input, general arbitrary-directory writer or production relocation UI.
Git checkout ancestry, paths outside the current profile, UNC/device namespaces,
relative/drive-relative paths, ADS, DOS devices, noncanonical components and paths
over 200 UTF-16 code units are refused. All provided options are validated.

The host's OS-provided `SystemRoot`, Windows installation, and checked-out helper
source are trusted application inputs. The absolute executable is
`SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`; no PATH executable
lookup occurs. Node passes fixed UTF-16LE encoded repository code as an argument
array with `shell: false`, hides the process window, and supplies request values
only as JSON stdin. System module discovery is restricted to the built-in Windows
module directory. No request value is interpolated into executable code. A
20-second helper limit refuses a stalled component; initialization may have left
private partial state, which is retained for manual inspection.

## Mechanism and admission policy

`security.ps1` uses .NET Framework Reflection.Emit to declare one in-memory
`CreateDirectoryW` P/Invoke and a small IL wrapper that captures its last error
immediately. This runs without Add-Type compilation or temporary source/DLL
files. The native call exclusively creates one directory, receiving a pinned
binary `DirectorySecurity` descriptor through x64 `SECURITY_ATTRIBUTES`.
`ERROR_ALREADY_EXISTS` is a refusal. The descriptor has the current user SID as
owner/group and a **protected DACL**, with inheritable FullControl allow ACEs for
exactly current user, SYSTEM and Administrators. It is applied **at creation**;
there is no broad directory followed by an `icacls` or ACL repair step.
[CreateDirectoryW contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw).

Built-in .NET APIs obtain binary owner/group/DACL information. Admission examines
the raw ACE structures and mapped masks, not SDDL substring matching. This is a
deliberately small conservative policy, **not a general Windows AccessCheck/Authz
engine**:

- Require owner/group and a non-null, nonempty, canonical DACL.
- Accept ordinary noncallback allow ACEs with known file rights/flags only.
  Map generic file masks; reject object/callback/opaque/unknown ACE structures.
- Reject **every deny ACE**, including overlapping current-user or group denies.
  This can refuse a harmless descriptor, but cannot treat a deny as an allow.
- For root, require owner=current SID, protected inheritance, exactly three
  distinct FullControl ACEs with ObjectInherit+ContainerInherit flags. For marker,
  require owner=current SID and exactly those three inherited FullControl ACEs.
  Membership in another group/capability never makes that trustee private.
- Inspect every existing ancestor through the drive root. Owners and effective
  modification trustees must be current user, SYSTEM, Administrators or the fixed
  TrustedInstaller SID. For other trustees, effective DELETE, DELETE_CHILD,
  WRITE_DAC, WRITE_OWNER, WRITE_DATA, WRITE_EA or WRITE_ATTRIBUTES is refused.
  Read/traverse and sibling directory creation may be admitted; InheritOnly ACEs
  do not apply to the ancestor itself. Each actual child is checked separately.

Checking the complete replacement boundary prevents admitted different-user
principals from replacing a private child through parent DELETE_CHILD rights or
changing an ancestor's ACL. Trusting a group because it contains the current user
would not establish this boundary. Denies and unsupported forms fail closed;
native directory creation and marker I/O additionally enforce the current token's
actual permissions. Native second-user access has not been tested.
[Windows file access](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights),
[AccessCheck scope](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-accesscheck).

Only a ready **fixed local NTFS** drive is admitted. DriveInfo uses Windows volume
information; NTFS and verified descriptors establish persistent ACL support.
Network/removable/other formats are refused. Node checks each entry with bigint
`lstat`, directory type and `realpath` equality; the helper also rejects reparse,
device, offline, compressed and encrypted attributes. Junctions, symbolic links,
mount points and canonical-path aliases are unsupported. Native tests of other
volume types require authorized fixtures; do not infer such test execution from
the admission code. Cloud synchronization is not supported or configured by this
module; do not select a synchronized directory as a test override.

On the implementation host, an extra capability SID has effective FullControl on
AppData / Local AppData. The policy refuses that ancestry. The real default store
was never initialized or changed, and no permissions were repaired. A normal
Windows installation with a private admitted ancestry can initialize; this host's
configuration requires manual resolution before default storage can be used.

## Initialization, reopening and identity

Initialization resolves the OS location, validates paths, existing parents, their
identity/security and the local volume **before mutation**, and refuses every
pre-existing destination. It creates one private directory with CreateDirectoryW,
then checks ownership, exact DACL, types, ancestry and filesystem identities again.
It creates `bootstrap.identity.json` exclusively (`wx`) with inherited private
permissions, verifies its descriptor before writing any identity bytes, writes
canonical UTF-8 JSON plus LF, flushes the file and verifies through the normal
reopen path before returning success. No unknown files are overwritten.

The record contains version 1, a random UUID-v4 store ID, current owner SID and
root/marker identities (Node bigint device, NTFS file ID and birth timestamp,
serialized as decimal strings). Reopen validates owner/DACL/ancestors/volume/types,
requires the directory to contain exactly that marker, rejects marker hard links,
reads at most 4096 bytes through an opened handle with `fstat`, validates exact
fields/encoding/canonical bytes/version and compares both identities. It checks
root/ancestor identities again before returning a frozen result:

```js
{ root, storeId, ownerSid, formatVersion: 1 }
```

The marker is a bootstrap binding, not an authenticated external registry. It
does not protect against a malicious process with the same effective filesystem
authority. NTFS IDs/birth timestamps are detection evidence, not permanent
nonreuse guarantees. If the entire root/marker disappear, this module has no
independent history: **ordinary startup must call reopen**, which returns
`BOOTSTRAP_ROOT_MISSING` and creates nothing. Explicit initialization is a separate
caller lifecycle decision; there is no automatic missing-store reset.

Concurrent initializers use exclusive native directory creation. One wins; the
other returns `BOOTSTRAP_ROOT_EXISTS`, including while the winner has not yet
published the marker. A crash before marker creation leaves an empty private root;
a crash during marker creation may leave an empty/partial identity file. Reopen
then returns recovery-required or corrupt-identity; initialization refuses the
existing destination. A crash after flush but before acknowledgement may leave a
valid root, which explicit reopen can verify. No cleanup or takeover is attempted.

Errors are `WindowsBootstrapError` with a fixed `code` and fixed sanitized message;
raw paths, native exceptions, credentials and causes are not exposed. See
`index.js` for the complete codes. Access/owner/ACL problems explicitly require
manual resolution. There is no repair/reset/deletion operation and no journal,
lock-file or database handling.

Separate pathname checks are **detection under the admitted trusted namespace**,
not atomic handle-relative confinement against malicious same-authority processes
or administrators. Returned success does not keep ancestor handles open or grant
future database operations a permanent confinement lease. Later integration must
retain this boundary and define its own database admission/lifecycle. File flush
does not claim directory durability after power loss; process termination evidence
does not establish kernel-crash, power-failure or media-failure durability.

## Verification and remaining platforms

```powershell
npm run test:windows-bootstrap
```

The focused harness creates UUID-named retained fixtures under the current user
profile, never in checkouts or the real application-data store. It tests native
private creation/reopening, ownership/DACLs, independent process initialization,
externally terminated initialization, conservative deny/group handling, unsafe
ancestors, junctions, file/root replacement, hard links, malformed paths/identity,
and unchanged rejected state. Raw-descriptor policy probes are explicitly synthetic.
Every result is PASS, FAIL, NOT RUN or BLOCKED, and the retained `results.json`
contains exact classifications. Unsupported symlink privileges, unprovided
cross-user credentials and unavailable volume/OS/runtime fixtures are reported
honestly. No Windows accounts are created and no privileges are elevated.

Linux/macOS need a separately reviewed owner/mode/ACL and filesystem policy,
private creation and reopen implementation, no-follow/identity handling,
concurrency/crash tests and native execution. Windows success supplies no POSIX
security certification. SQLite schema/project operations, HTTP/UI, credentials,
generated targets and persistent Live API are outside this milestone.
