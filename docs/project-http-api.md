# Protected local project HTTP API (M2B)

M2B exposes the published [SQLite Project Store](sqlite-project-store.md) through
the development server. It saves exact source and immutable revisions without
compiling DSL, provisioning generated databases or launching generated servers.
It provides no project UI, deletion, restore, migration, repair, backup or export.

## Enablement and supported environment

The feature is disabled by default. Only the exact startup value
`APIFORGE_PROJECT_API=1` enables it. In an ordinary Windows PowerShell session:

```powershell
$env:APIFORGE_PROJECT_API = '1'
npm run dev
# To disable it for the next server process:
Remove-Item Env:APIFORGE_PROJECT_API
```

`DEV_PORT` and the server's existing bind behavior remain unchanged. Disabled
project requests return 403 `PROJECT_API_DISABLED`, without issuing a token,
loading SQLite, opening a store or calling the filesystem bootstrap. Compiler,
health, Live API and frontend static routes retain their existing contracts.
Enablement is captured when the router is created; restart to change it.

The ordinary compiler still supports Node 18+. Import and startup do not eagerly
load `node:sqlite`. Storage lifecycle requests require Windows x64, Node 24.14.0
or a compatible tested later runtime, built-in `node:sqlite`, and the unchanged
[private Windows NTFS bootstrap](windows-storage-bootstrap.md). Unsupported
runtime/platform requests return the controlled 503 codes below. M2B adds no
binding, dependency, fallback filesystem or runtime installation.

Production lifecycle calls pass **no arguments** to the published store. Its OS
profile-based `.apiforge-projects` location and ACL policy remain authoritative.
No request field, query parameter or environment variable selects storage paths,
database filenames or connection options. Existing stores require reopening;
their presence does not enable the API.

## Local browser security

Every project request must originate from a raw TCP loopback peer and supply
exactly one syntactically valid loopback Host authority. Accepted hosts are
`localhost`, literal IPv4 in `127.0.0.0/8`, IPv6 `::1`, and loopback IPv4-mapped
IPv6. The Host port must equal the actual socket's local listening port (omitted
port means 80 for HTTP or 443 for TLS). DNS names such as
`localhost.attacker.example`, numeric URL aliases, userinfo, zones, duplicate Host
fields and malformed authorities refuse. DNS is never resolved for admission.
This prevents an attacker-controlled DNS-rebinding Host from becoming local merely
because its TCP connection reaches the server.

The pure locality policy matches Live's existing helpers. M2B keeps its own small
checks because importing Live's router would also import its manager/compiler/DB
chain. Live code and its existing security contract are unchanged.

Origin, when present, must be the exact serialized origin constructed from the
validated Host and socket TLS state. `Origin: null`, duplicate origins and origin
aliases that identify a different browser origin refuse. Proxy-derived Express
protocol/hostname fields are not consulted. `X-Forwarded-*`, `Forwarded` and other
proxy identity headers confer no access, even with Express trust-proxy enabled.

When present, Fetch Metadata must have `Sec-Fetch-Site: same-origin` or `none`,
`Sec-Fetch-Mode: cors` or `same-origin`, and `Sec-Fetch-Dest: empty`; duplicates,
cross-site, same-site-but-different-origin, navigation and no-cors requests refuse.
These constraints are deliberately limited to programmatic API clients. Local
CLI clients without Origin/Fetch Metadata remain supported. Browser clients that
omit these headers still cannot read a cross-origin session response through
standard same-origin/CORS enforcement. All responses use `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`.
The router emits no CORS allow headers and no cookies; OPTIONS is unsupported.
See the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#cors-protocol) and
[Fetch Metadata specification](https://www.w3.org/TR/fetch-metadata/).

`GET /api/projects/session` returns a cryptographically random 32-byte token as
64 lowercase hex characters. It is stable for one router/server lifetime and
changes across independent instances/restarts. It performs no store interaction.
Every other documented endpoint requires exactly one
`X-APIForge-Project-Token` header containing that token. Validation checks canonical
format and compares equal-length bytes with `crypto.timingSafeEqual`. Query
parameters and cookies cannot supply the token. Tokens stay in process memory:
they are never logged, persisted, embedded in URLs or shared with generated servers.

This token protects against unintended browser-origin access; it is not account
authentication. A malicious process under the same OS authority, administrator,
or compromised same-origin page is outside this boundary. Direct loopback clients
are trusted. Reverse proxies terminating external connections locally are
unsupported: the socket identifies the proxy and cannot prove its original client.
The unchanged Windows namespace guarantee also excludes hostile same-authority
pathname substitution. No public-facing deployment claim is made.

## PowerShell session and listing example

Use the actual dev-server URL printed at startup. This example assumes
`http://localhost:3000`; change it to match your listening port:

```powershell
$base = 'http://localhost:3000'
$session = Invoke-RestMethod -Uri "$base/api/projects/session"
$headers = @{ 'X-APIForge-Project-Token' = $session.data.token }
$projects = Invoke-RestMethod -Uri "$base/api/projects" -Headers $headers
$projects.data | Select-Object id, name, target, revision
```

Session exchange creates no store. Listing opens an existing store and
can return `PROJECT_STORE_MISSING`; it does not initialize storage.
Keep the token in memory and repeat the session exchange after restart.

## Endpoint contract

All routes are literal, case-sensitive paths under `/api/projects`. There are no
query parameters. Percent-encoded aliases, malformed paths, extra/trailing path
components and unexpected methods refuse before store access. Root collection
requests accept `/api/projects` or `/api/projects/`. Project IDs are lowercase
canonical UUID-v4. Historical revision segments are canonical positive decimal
safe integers, without signs, leading zeroes, decimals, whitespace or escapes.

| Method | Path | JSON request | Status and `data` |
| --- | --- | --- | --- |
| GET | `/api/projects/session` | None; no token required | 200 `{token, tokenHeader: "x-apiforge-project-token"}` |
| POST | `/api/projects/initialize` | Exactly `{}` | 201 `{storeId}` |
| POST | `/api/projects` | Exactly `{name, target, source}` | 201 current project record, revision 1 |
| GET | `/api/projects` | None | 200 array of summaries ordered by UUID |
| GET | `/api/projects/:projectId` | None | 200 current project record |
| GET | `/api/projects/:projectId/revisions/:revision` | None | 200 historical record |
| PUT | `/api/projects/:projectId` | Exactly `{expectedRevision, changes}` | 200 newly committed current record |

All successes are exactly `{ "success": true, "data": ... }`. Current records:

```json
{
  "success": true,
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Student API",
    "target": "mysql",
    "revision": 1,
    "source": "ENTITY Student\nid INT PRIMARY KEY",
    "sourceHash": "<64 lowercase SHA-256 hex characters>",
    "createdAt": "2026-10-10T00:00:00.000Z",
    "updatedAt": "2026-10-10T00:00:00.000Z"
  }
}
```

Summaries have the same fields **except `source`**. Listing delegates to the
store's metadata-only deterministic query. Historical records have `id`, `name`,
`target`, `revision`, `source`, `sourceHash`, `savedAt`; they omit `createdAt` and
`updatedAt`. Timestamps are 24-character UTC ISO strings. Example save:

```json
{
  "expectedRevision": 3,
  "changes": {
    "name": "Updated Student API",
    "source": "ENTITY Student\nid UUID PRIMARY KEY"
  }
}
```

`expectedRevision` is mandatory and must be a positive JSON safe-integer number.
`changes` contains one or more of `name`, `target`, `source`; each must be a string.
Omitted fields keep their saved values, including when changing only target or
name. `source: ""` intentionally clears source. Each successful save advances
exactly one revision, even for unchanged supplied values. The HTTP layer never
retries a stale or potentially committed mutation. There is no PATCH or DELETE.

Arrays, primitives, missing bodies/fields, unexpected own fields (including `id`,
`root`, `filename`, `__proto__`, `constructor`), empty changes and invalid route
IDs/revisions refuse before dispatch to storage. Only known fields are copied to
fresh objects; client objects are never spread into store options or method names.
The published store remains the final authority for names, targets and source:
names retain intentional whitespace and its Unicode/byte/control bounds; targets
are exactly `mysql` or `postgres`.

Mutations require uncompressed `application/json` or `application/<subtype>+json`,
optionally with only `charset=utf-8` (quoted UTF-8 also accepted). Other media,
charset/extra parameters or compression return 415. JSON bytes must be valid
UTF-8; malformed JSON and invalid UTF-8 receive controlled 400 responses. GET
requests with bodies refuse. Unknown methods receive 404, including HEAD
(without a response body), OPTIONS, PATCH and DELETE; Express's automatic HEAD
and OPTIONS behavior is not used.

The dedicated parser's finite body limit is **6,299,648 bytes**
(`6 * 1,048,576 + 8,192`, or 6 MiB plus 8 KiB). A 1 MiB source made entirely of
one-byte characters escaped as `\u0000` consumes 6 MiB of JSON plus metadata;
the allowance covers valid worst-case escaping and bounded metadata. The store
still caps decoded source at **1,048,576 UTF-8 bytes**. Excess declared
Content-Length is refused before reading; chunked bodies are bounded by the
dedicated parser. Access and route/token checks run before body parsing. The
router mounts before the unrelated global 1 MiB compiler parser. Source text is
never trimmed, normalized or rewritten: BOM, CRLF, Unicode, NUL, whitespace and
empty strings round-trip exactly through the store's BLOB/hash representation.

## Error contract and exhaustive status mapping

Errors contain only fixed application codes/messages:

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_REVISION_CONFLICT",
    "message": "The expected project revision is stale."
  }
}
```

| HTTP | Exact codes |
| --- | --- |
| 400 | `PROJECT_API_REQUEST_INVALID`, `PROJECT_API_JSON_INVALID`, `PROJECT_INVALID_INPUT`, `PROJECT_INVALID_ID`, `PROJECT_INVALID_NAME`, `PROJECT_INVALID_TARGET`, `PROJECT_INVALID_SOURCE`, `PROJECT_INVALID_REVISION` |
| 403 | `PROJECT_API_DISABLED`, `PROJECT_API_NOT_LOCAL`, `PROJECT_API_ORIGIN_REFUSED`, `PROJECT_API_TOKEN_INVALID` |
| 404 | `PROJECT_API_ENDPOINT_NOT_FOUND`, `PROJECT_NOT_FOUND` |
| 409 | `PROJECT_STORE_EXISTS`, `PROJECT_REVISION_CONFLICT`, `PROJECT_REVISION_LIMIT` |
| 413 | `PROJECT_API_BODY_TOO_LARGE` |
| 415 | `PROJECT_API_MEDIA_UNSUPPORTED` |
| 503 | `PROJECT_API_STOPPING`, `PROJECT_STORE_MISSING`, `PROJECT_STORE_UNSAFE`, `PROJECT_STORE_IDENTITY_MISMATCH`, `PROJECT_STORE_INCOMPATIBLE`, `PROJECT_STORE_CORRUPT`, `PROJECT_STORE_RECOVERY_REQUIRED`, `PROJECT_STORE_BUSY`, `PROJECT_STORE_CLOSED`, `PROJECT_STORE_RUNTIME_UNSUPPORTED`, `PROJECT_STORE_PLATFORM_UNSUPPORTED` |
| 500 | `PROJECT_COMMIT_UNCERTAIN`, `PROJECT_STORE_STORAGE_FAILURE` |

Store codes are preserved only from recognized `ProjectStoreError` instances.
Their messages are reconstructed from the published fixed registry, not copied
from exception text. Unexpected errors become `PROJECT_STORE_STORAGE_FAILURE`.
No suffix/regex status inference is used. Missing/corrupt/unsafe/incompatible
storage is unavailable and requires manual resolution; HTTP never repairs it.
BUSY is bounded by the store's 350 ms SQLite timeout plus Windows admission time,
and is not retried by the server. A caller may retry with its original revision.

`PROJECT_COMMIT_UNCERTAIN` has the distinct 500 message:
"The commit may have succeeded; reopen and inspect the committed revision before
retrying." The connection is invalidated; a following ordinary read reopens and
validates the existing store. Inspect current state and history before deciding
whether another save is appropriate. Network disconnects can also lose an
acknowledgment; there is no idempotency or automatic replay mechanism.

The router contains its own parser/error handling and logs no requests, source,
tokens or native exceptions. Responses cannot expose native paths, SQL, SQLite
messages, credentials, user SIDs or stacks. Malformed HTTP rejected by Node before
Express may receive Node's generic 400 without this JSON envelope.

## Lifecycle and shutdown

Router construction/import/session exchange do not open or initialize storage.
Only an authorized `POST /initialize` with `{}` calls `initializeProjectStore()`.
Initialization returns 201 only after the published operation fully succeeds; it
never adopts existing, partial or incompatible storage. Ordinary create/list/get/
history/save requests call only `openProjectStore()` when a connection is needed.
Reopen failures do not trigger initialization, replacement, reset or migration.
Once this server has established a store, initialization remains refused even
after connection invalidation or disappearance. Across restarts the published
store/bootstrap lifecycle and namespace observations remain authoritative.

A FIFO promise queue serializes store opens, explicit initialization, reads and
writes within each router. Successful connections are reused. Stale revisions,
BUSY and input errors retain the connection; content/identity/unsafe/closed,
storage-failure and commit-uncertain errors close and invalidate it. There is no
automatic retry. Cross-process concurrency remains governed by SQLite and the
published expected-revision transaction contract. A close failure is sanitized,
retained as a lifecycle failure and reported on shutdown.

`createProjectApi()` returns `{router, shutdown}`. `shutdown()` immediately refuses
new work, drains queued accepted operations, closes the connection once and is
idempotent. The server exposes `app.locals.shutdownProjectApi` for embedded use;
call it when stopping an embedded listener. The standalone development server's
SIGINT/SIGTERM handler uses one fixed **30,000 ms grace deadline** for both HTTP
draining and application cleanup. It first calls `server.close()` to stop new
connections, closes idle HTTP connections when supported, marks the project
queue as stopping immediately, and runs project and Live cleanup independently.
Active requests and responses remain open during the grace period. Repeated
signals reuse the shutdown in progress; they never start duplicate cleanup.

The deadline allows the published Windows admission helper's bounded 20-second
wait, SQLite's 350 ms BUSY timeout, and ordinary Live forwarding/cleanup work
(10-second forwarding, 2-second process-exit polling and 2.5-second port-release
polling) time to finish. It is a grace budget, not a promise that every queue,
database driver or transaction will complete within it. It is not configurable
through HTTP inputs or an environment variable.

If both cleanups and HTTP close finish in time, the timer is cleared and the
process exits 0 only if all three succeeded. Rejections and synchronous throws
produce fixed `LIVE_CLEANUP_FAILED`, `PROJECT_STORE_CLOSE_FAILED` or
`HTTP_CLOSE_FAILED` logs and exit 1 after the other work settles. No native
exception text, paths, source, tokens, credentials or stacks are logged by this
shutdown handler. If any work remains at the deadline, it logs
`SHUTDOWN_DEADLINE_EXCEEDED`, force-closes remaining HTTP connections and exits 1
without a second wait. This is forced failure, not graceful success.

Accepted Project Store operations retain the router's FIFO drain and close-after-
work ordering during grace. If they miss the deadline, forced process termination
cannot guarantee their completion, connection-close cleanup or receipt of an
acknowledgment. A write may have committed before its response was lost; reopen
and inspect current state/history before deciding whether to retry. Shutdown does
not retry operations or claim that signal-time writes necessarily rolled back.
Live cleanup that misses the deadline may likewise leave resources requiring
manual inspection. JavaScript deadlines require a responsive event loop; they
cannot execute during a blocked synchronous/native call or an OS failure.

`closeIdleConnections()` and `closeAllConnections()` were added in Node 18.2.
Earlier Node 18 releases use tracked sockets' `destroy()` at the deadline; idle
closure is optional there. This preserves the compiler's Node 18+ runtime floor.
See [Node HTTP shutdown APIs](https://nodejs.org/download/release/v18.20.8/docs/api/http.html#servercloseallconnections).
Windows `child.kill('SIGTERM')`/`SIGINT` terminate without running Node's handler;
native shutdown tests therefore dispatch the same registered handler with IPC
and `process.emit` inside a disposable actual `server.js` process, using real TCP
clients and disposable storage. This proves handler behavior, not native Windows
OS-signal delivery. POSIX tests use child signals when run there. See
[Node signal limitations](https://nodejs.org/download/release/latest-hydrogen/docs/api/process.html#signal-events).

Tests inject application-owned factory functions returning disposable stores;
this JS-only seam is absent from HTTP/environment configuration. Test roots live
under UUID-named M2B fixtures in the OS profile. Tests never operate against the
real default storage directory or change published store/bootstrap code or ACLs.

## Verification

```powershell
npm run test:project-api
npm run test:project-store
npm run test:windows-bootstrap
npm test
npm run test:g27
npm run test:g28
npm run test:migrations
npm run test:live-api-runner
# Focused shutdown regressions, using the actual server process and 30 s deadline:
node tests/project-api.test.js --shutdown-only
```

M2B tests include real HTTP loopback IPv4/IPv6, raw duplicate Host/origin/token
headers, a nonloopback connection through an available local LAN interface,
same-origin and cross-origin Chromium requests when installed, disposable native
Windows SQLite lifecycle/revisions, independent HTTP server process reopen and
racing writers, BUSY, post-COMMIT fault injection, malformed/missing/corrupt/
incompatible/unsafe storage preservation, shutdown and public-route regression
guards. Shutdown regressions include incomplete compiler/project bodies, normal
cleanup, delayed native saves, refusal of new project work, repeated signals,
cleanup rejection/synchronous throws, HTTP-close callback errors and unresolved
cleanup promises. Test-only preloading instruments factories and handler dispatch;
it does not replace the standalone server's registered shutdown handler. Fake
stores are limited to security, mapping and controller-lifecycle
tests. Per-run `results.json` records PASS/FAIL/NOT RUN in the retained fixture
directory; unavailable interfaces/browser fixtures are classified explicitly.

Same-host LAN connections do not certify an external remote machine or proxy.
Simulated unsupported-runtime refusal does not certify native Node 18 execution.
Native generated MySQL/PostgreSQL execution, second-user access, Windows 10,
non-Windows storage, unsupported filesystems, installer policy and power-loss
durability require separate evidence. Process shutdown/crash tests do not prove
electrical power-loss durability.
