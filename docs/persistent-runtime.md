# Persistent generated API runtime and browser session recovery

This backend candidate implements explicit initialization, Run, Stop, status and
OpenAPI forwarding for a saved project's generated MySQL/PostgreSQL database.
Scoped native MySQL 8.4 and PostgreSQL 18 acceptance passed using fresh disposable
Docker databases and out-of-tree verification instrumentation. M2D-B provides an
independent Persistent API disclosure with Status, confirmed Initialize Database,
Run, known-session Stop and generated requests. M2D-C adds confirmed reconciliation
of a stale session reference already held in the browser page. The existing disposable Live runner retains its database deletion
and 15-minute lifetime; do not use it to reopen persistent data.

## Enablement and configuration

Both startup values must be exactly `1`:

```text
APIFORGE_PROJECT_API=1
APIFORGE_PERSISTENT_RUNNER=1
```

Disabled construction/startup/session requests do not import SQLite, open a store,
initialize a database or launch a child. Ordinary compiler startup supports Node
18+. Production operations reopen the published Project Store without arguments
and therefore require its Windows x64/Node 24.14.0+ private NTFS environment.
There is no store initialization, schema change, new SQLite table, root selector
or sidecar file in this feature. Initialize saved-project storage through M2B
separately, then save and acknowledge a project revision.

Configure the selected target explicitly; all four values are required:

| MySQL | PostgreSQL |
| --- | --- |
| `APIFORGE_PERSISTENT_MYSQL_HOST` | `APIFORGE_PERSISTENT_PG_HOST` |
| `APIFORGE_PERSISTENT_MYSQL_PORT` | `APIFORGE_PERSISTENT_PG_PORT` |
| `APIFORGE_PERSISTENT_MYSQL_USER` | `APIFORGE_PERSISTENT_PG_USER` |
| `APIFORGE_PERSISTENT_MYSQL_PASSWORD` | `APIFORGE_PERSISTENT_PG_PASSWORD` |

HOST must be literal `127.0.0.1` or `::1`; PORT is canonical decimal 1–65535.
An explicitly empty password is permitted, without falling back to another
password. PostgreSQL administration uses `APIFORGE_PERSISTENT_PG_ADMIN_DB`,
default `postgres`, restricted to a bounded simple identifier. The pg password
callback prevents its normal empty-string fallback to `PGPASSWORD`. SSL,
startup options, replication mode, encoding and application name are explicit.
Generated children receive a small OS environment plus exact dedicated `DB_*`
values; inherited PostgreSQL environment, NODE_OPTIONS and unrelated secrets
are excluded. No LIVE/TEST/general DB configuration, browser credentials, saved
secrets or generated `.env` file is consulted.

Use an operator-provided dedicated local database account with database creation,
schema import, metadata SELECT/UPDATE and generated application CRUD rights.
PostgreSQL's published runtime also requires public USAGE/CREATE and CRUD rights
on every generated table. The runtime creates no account, grant or service and
changes no global database setting. This first version uses the dedicated target
account in the generated child; it does not provide credential separation within
that trusted local account.

Supported profiles are MySQL 8.4/InnoDB/DYNAMIC/16 KiB pages, strict SQL mode,
NO_BACKSLASH_ESCAPES disabled, autocommit and
`innodb_flush_log_at_trx_commit=1`; PostgreSQL 18/UTF8, fsync enabled and
`synchronous_commit=on`. Unsupported profiles refuse before provisioning.
Connect/query/connection-close waits are bounded at 5/8/2 seconds; PostgreSQL
lock waits are 2 seconds. A timeout never proves SQL rolled back. Forced pg socket
cleanup uses the owned pg 8 client connection; actual target/driver certification
must include the native suite.

## Durable identity and provenance

One deployment is supported per genuine backend-issued project UUID and target.
The store authenticates its immutable storeId and project snapshots through the
unchanged Windows admission/SQLite implementation. HTTP accepts only a project
UUID, exact target and acknowledged revision. It accepts no database/SQL/path/
connection selector.

Database names are `apiforge_p_m_` or `apiforge_p_p_` plus 48 SHA-256 hex digits:
61 ASCII bytes, within MySQL's 64 and PostgreSQL's 63 byte limits. The hash input
is the JSON tuple `["apiforge:persistent:database:1",storeId,projectId,target]`.
Truncation never establishes ownership. Any name collision needs the complete
metadata attestation to match, and initialization still refuses existing data.

The newly created target database reserves `__apiforge_runtime_v1` (qualified
`public` in PostgreSQL). Schemas mentioning `__apiforge_runtime_`, including
inside literals, refuse conservatively before DDL. The singleton metadata stores
format 1, a random deployment ID, provisioning/ready state, an optional runtime
owner nonce and a canonical provenance tuple:

```text
[1,storeId,projectId,target,savedRevision,sourceSHA256,schemaSHA256,artifactsSHA256]
```

The schema hash covers exact UTF-8 schema bytes. The artifact hash covers JSON
`["apiforge:persistent:artifacts:1",target,[[path,content],...]]`, preserving the
complete compiler array order and every generated file byte. JSON tuple encoding
provides unambiguous boundaries. Runtime file materialization uses those same
files. SQLite stores no deployment metadata or secret. A live resource pins the
observed deployment ID so replacement during that lifecycle refuses.

The saved source is limited to the Store's 1 MiB. Compilation uses the published
lexer/parser/semantic/IR/optimizer/codegen and target admission in memory. Imports
are unsupported. Invalid source, reserved schema names or changed complete
generated artifacts refuse without DDL. Installed dependency releases are not
vendored into the artifact hash; the published dependency contracts remain in
place and upgrades still require separate runtime verification.

## Explicit initialization and uncertainty

Only protected POST `/initialize` may create a database. After reading the
acknowledged current project and its matching immutable snapshot, it compiles,
checks configuration/profile and checks the exact derived database identity.
An existing database is never adopted by this operation. Matching ready metadata
returns `PERSISTENT_ALREADY_INITIALIZED`; matching provisioning metadata returns
`PERSISTENT_INCOMPLETE`; unknown metadata returns a collision refusal.

For an absent database, initialization creates exactly that database without
`IF NOT EXISTS`, creates and commits its provisioning metadata, imports the
compiler schema once, and marks ready only after successful import. MySQL schema
DDL may commit in parts; PostgreSQL's multi-statement query normally executes as
one implicit transaction. Neither behavior is treated as guaranteed rollback
after a network failure. No failed step is replayed or automatically deleted.

Failure from the first CREATE attempt returns `PERSISTENT_PROVISION_UNCERTAIN`.
A database without a complete marker is unknown and cannot Run. A provisioning
marker is incomplete and cannot Run or initialize again. A lost final response
may leave fully verified ready metadata: inspect it, then explicitly Run rather
than repeating initialization. HTTP disconnects do not imply cancellation.

Status, Run, Save, Compile, reopening, server startup and reconnecting never
provision. Inaccessible credentials/metadata are errors, never represented as
an absent database. An absent catalog identity means only that it is absent;
this database-only design cannot distinguish never-created from externally
deleted storage across restarts. Run refuses either case. Nothing initializes
automatically in response to absence. MySQL catalog visibility is insufficient:
absence requires a direct `ER_BAD_DB_ERROR` refusal after the admin profile check.
Access-denied errors remain unavailable and cannot trigger initialization.

## Run, Stop and process ownership

Run checks the acknowledged current revision and matching immutable historical
snapshot, then recompiles and verifies all stored provenance before taking a
runtime claim. Later saves do not change the running code or database. Requests
submitted after a revision/target change refuse a mismatched deployment, including
name-only saves that advance the revision. There is no equivalence upgrade,
schema import, reset, migration or source selection from an unsaved draft.

A durable non-expiring claim is acquired through one conditional UPDATE on the
authenticated singleton row: ready state, exact provenance/deployment ID, and
NULL runtime_owner. MySQL InnoDB and PostgreSQL conflicting row updates give one
winner. The owner is random and distinct from the browser's runtime token.
Only acknowledged acquisition permits launch. The claim remains committed when
the acquiring connection closes or breaks; another manager refuses while it is
occupied. This deliberately avoids automatic advisory-lock or heartbeat expiry.
See the [MySQL commit contract](https://dev.mysql.com/doc/refman/8.4/en/innodb-autocommit-commit-rollback.html)
and [PostgreSQL conflicting UPDATE behavior](https://www.postgresql.org/docs/18/transaction-iso.html).

Each server manager runs at most one API at a time. Run materializes a fresh
disposable OS temp directory, uses the unchanged generated server with the
published loopback listener rule and installed dependencies. A dedicated preload
acknowledges its listener port and fresh nonce over the owned child's IPC channel
before the published HTTP health check, within the same 10-second startup bound.
Another process's public health response cannot establish listener ownership.
Readiness requires an acknowledged listener, no process failure, a connected IPC
channel (`child.connected === true`) and no exit or termination signal. Disconnect,
error or exit immediately clears readiness and makes failure sticky; queued or
late listener messages cannot restore it. Run verifies this before and after HTTP
health admission and again after durable claim verification before issuing a token.
Status reports running only for the local owned identity, matching durable owner
and full readiness. A living disconnected child with a held claim reports occupied.
Forwarding checks the durable claim and readiness before sending and after transport
completion. A response cannot establish success after either is lost; an uncertain
request is never replayed. Run then issues a fresh opaque session token.
Starting another project
does not stop the first: it returns BUSY. There is no runtime TTL.
The published path validation and exclusive file creation are reused within a
trusted OS temp namespace. This does not certify hostile directory/junction
substitution or access by a second OS account.

Stop validates the runtime token, terminates the exact owned Node ChildProcess
through its native handle (5-second wait), verifies port release, removes only
its owned disposable runtime files, then conditionally releases its exact claim.
Stock generated code launches no grandchildren; unknown processes/PIDs are never
adopted or killed. The persistent adapter exposes no DROP capability. Process
cleanup uses the owned handle even when IPC has disconnected. Disconnect alone
never releases the durable claim or authorizes replacement. Process
death closes generated application pools. Repeated successful Stop with the most
recent stopped token is idempotent within that manager. Older/restarted tokens
refuse. Failed cleanup retains a failed local session and blocks that manager's
replacement; Stop or shutdown can retry only its own known cleanup. Failures
before claim release leave the durable claim occupied. A lost release receipt
can leave NULL after the process, port and files were already verified cleaned;
another manager may acquire that independently verified empty claim. The failed
manager cannot clear a later owner's nonce or relaunch its old session.

An owned child crash observed by its living manager schedules the same cleanup
and conditional release. Hard supervisor termination may leave an orphan child
or a durable claim without an accessible session token. A fresh manager reports
occupied and refuses Run. Tokens/PIDs/ages are insufficient grounds for takeover.
No automatic crash adoption or claim reset is implemented. Clean Stop or clean
server shutdown releases the claim, allowing a fresh server to explicitly Run
the same database and records after authenticated Store reopen.

The standalone server includes persistent cleanup in its existing single
30-second deadline, alongside Project, Live and HTTP cleanup. Stalled HTTP bodies
or cleanup force connection closure and exit 1 at the deadline. Hard termination
or power loss cannot certify asynchronous cleanup.

### Why a name-only save can cause revision refusal

Persistent deployments pin the acknowledged saved revision as part of
their provenance, not only the source text. A changed project name can
advance that revision even when the generated schema would be identical.
The deployment does not silently accept an equivalent newer snapshot.

Saving does not migrate the database or replace the already running
process. Preserve the known session so its owned Stop remains available.
Do not repeat Initialize Database to bypass a revision mismatch; reopening,
reconnecting, or recompiling does not upgrade deployment provenance.

## Browser memory and verified stopped deployments

**Initialize Storage** prepares saved-project storage through the Project API.
**Initialize Database** separately provisions the saved project's generated database
once, with confirmation. A browser-held ephemeral session ID addresses an owned
runtime; it is distinct from the Persistent API connection token, the durable
database attestation and the non-expiring runtime ownership claim. These IDs and
tokens stay in JavaScript memory and are never placed in browser storage or URLs.

Clean Stop terminates the owned child and releases its exact claim while retaining
records. Clean server shutdown follows that lifecycle. After an orderly server
restart, an existing browser page may still hold its obsolete session reference.
Reconnect Persistent API explicitly, then Refresh Status. Only a fresh, successful,
validated `stopped` response for the identical acknowledged project UUID, target
and saved revision enables **Forget Stale Browser Session** for that held reference.
The proof is bound to the current connection generation and status operation.
Project/revision changes, reconnection, newer operations, failed status or a
browser offline event invalidate eligibility. Unsaved edits do not change the
acknowledged deployment; they never cause a mutation or automatic recovery.
Pending saved-project operations and the project selection dialog also disable
forgetting and invalidate its proof, even before the saved identity changes.
An unconfirmed/conflicting Save must be resolved through the existing project
workflow before a new Status can establish eligibility. Known-session Stop is
independent of these recovery-only checks.

The action requires a click and confirmation explaining its limited effect.
Cancellation changes no state and sends no request. Confirmation synchronously
rechecks the proof, clears the exact local session reference, cached generated
operations and old response, and invalidates async tickets. It sends **no HTTP
request**. Run remains disabled until another explicit Refresh Status verifies
stopped; Run still requires its own click. Nothing reconnects, initializes, runs,
stops or sends a generated request automatically. Closing the disclosure retains
the session. Known-session Stop remains available across unsaved edits, project
switches and request/Stop errors; an invalid session error alone cannot justify
forgetting. An uncertain Stop retains ownership in the page until an explicit
authoritative status inspection establishes the deployment's state.

Reload loses session IDs; successful Status cannot reconstruct a lost ID. `running`
or `occupied` never permits this action or competing Start. Use the existing safe
lifecycle or a separately reviewed operator assessment. `absent`, `incomplete`,
collision, unavailable database and uncertain provisioning preserve state and
offer no recovery/repair shortcut. A PID, port, timeout, invalid token, restart
assumption, claim age or old cached Status is never proof of stopped ownership.

Forgetting does not clear an occupied backend claim, stop a child process, change
the database, recover a lost token, certify power-loss recovery, implement migrations
or create backups. There is no Force Stop, Reset, Unlock or Takeover control. The
read-only status proof describes the response at inspection time; it does not
certify continuous server reachability or prevent another manager acquiring a
claim afterward. Explicit Run revalidates ownership through the unchanged backend.

### Choose the operation that matches the state

| Operation | Scope |
| --- | --- |
| Reconnect Persistent API | Obtains a new connection token; does not run or stop a deployment |
| Refresh Status | Inspects the selected acknowledged deployment; does not reconstruct lost session IDs |
| Known-session Stop | Terminates the owned process and releases its claim after cleanup; preserves database records |
| Forget Stale Browser Session | Clears only a held browser reference after a fresh matching stopped proof and confirmation |

Forgetting sends no HTTP request and cannot stop a process or clear an
occupied claim. After forgetting, obtain another explicit Status before
an explicit Run. Running, occupied, incomplete, and uncertain states do
not become stopped merely because a page was reloaded.

## Manual recovery boundary

Preserve unknown/provisioning/occupied databases and all metadata. Before any
operator recovery, authenticate the original private Store, project, revision,
target, exact database and provenance, and record a reviewed backup/evidence.
An occupied claim requires verifying that every involved manager and generated
child has terminated and that no lifecycle can still run. A PID, missing TCP
listener, old claim or broken SQL connection is not enough by itself. Only then
may a separately reviewed administrative operation conditionally clear that
exact owner nonce. There is no HTTP reset, takeover, delete or repair route.

Incomplete initialization requires inspecting actual DDL/schema/data and the
commit outcome. APIForge will not replay the schema, mark unknown schema ready,
drop/recreate the database, execute G26 SQL or repair provenance. Any reconstruction,
restoration or schema upgrade needs a separate precise recovery decision. G26
remains offline and MySQL-specific; PostgreSQL migration is not implemented.

## Version 1 HTTP contract

All paths are literal and case-sensitive; aliases, queries, trailing components,
wrong methods and extra fields refuse. Successes use `{success:true,data:...}`.
Errors use `{success:false,error:{code,message}}`, with only fixed registry text.

| Method/path under `/api/persistent` | Exact JSON | Result |
| --- | --- | --- |
| GET `/session` | None | `{formatVersion:1,token,tokenHeader:"x-apiforge-persistent-token"}` |
| POST `/status` | `{projectId,target,expectedRevision}` | Identity/revision and `absent`, `incomplete`, `stopped`, `running` or `occupied` |
| POST `/initialize` | Same selection | 201 verified stopped deployment |
| POST `/start` | Same selection | Running identity/revision, `sessionId`, `endpointCount` |
| POST `/stop` | `{sessionId}` | Stopped; no database deletion |
| POST `/request` | `{sessionId,method,path,body?}` | Generated status, approved headers/body and duration |

Every request requires raw TCP loopback and one literal loopback Host at the
actual listener port, exact same-origin Origin when present, and admitted Fetch
Metadata. Proxy authority headers confer no access. There is no CORS, cookie,
query-token or SQL route. Every route except session requires exactly one
`x-apiforge-persistent-token`, 64 lowercase random hex characters compared with
timingSafeEqual. It is independent of M2B's token and rotates across servers.
Runtime-session tokens also use timing-safe comparison, stay ephemeral and are
not written into ownership metadata. No token/source/exception logging is added.

Mutations/status require uncompressed UTF-8 JSON or +json, optionally only an
UTF-8 charset. The envelope limit is 72 KiB. Forwarded serialized bodies are
64 KiB, generated responses 1 MiB and final HTTP envelopes 2 MiB. Forwarding
reuses the published OpenAPI method/path validation and fixed owned loopback
transport; arbitrary URLs, traversal, encoded separators, SQL and destinations
refuse. The JSON parser retains Express's handling of duplicate object members
(last member); field names/types and every resulting selector remain validated.

The trust boundary is the cooperating local OS authority and its direct browser
origin. Administrators, hostile same-authority processes, compromised same-origin
scripts, externally terminating proxies and manual database replacement/restore
are outside the guarantee. This is not production hosting or power-loss proof.

## Verification

`npm run test:frontend-persistent-recovery` runs a separate deterministic Chromium
suite against controlled HTTP fixtures, including a simulated clean restart with
an old page-held session and a new server token reporting stopped. This is browser
behavior evidence, separate from native MySQL/PostgreSQL restart acceptance.
`APIFORGE_M2DC_EVIDENCE` optionally captures screenshots and results. Manual
screen-reader certification and power-loss recovery are not established by this suite.

`npm run test:persistent-runtime` is deterministic offline/controlled-connector
evidence, with actual Node child, TCP and standalone shutdown checks. Windows
shutdown handlers are invoked through IPC `process.emit`; that is not native
OS signal-delivery certification. No real target database is selected by it.

`npm run test:persistent-runtime-native` requires explicit, isolated test-owned
accounts named `af_persist_test_<12 lowercase hex>` and the four
`APIFORGE_PERSISTENT_TEST_MYSQL_*` / `APIFORGE_PERSISTENT_TEST_PG_*`
HOST/PORT/USER/PASSWORD variables. Optional PostgreSQL admin database uses
`APIFORGE_PERSISTENT_TEST_PG_ADMIN_DB`. There is no generic/production credential
or Docker fallback. Operators supply the accounts/services; this command does
not install or provision them. Missing fixtures exit nonzero as NATIVE NOT RUN /
BLOCKED. Both target results are required for NATIVE COMPLETE.

The native harness uses UUID-owned private Store fixtures, actual standalone
server processes, real CRUD surviving Stop/rerun/server restart, independent
claim races, child failure, collision/missing/incomplete/provenance/revision/
credential refusals, a test-owned unrelated sentinel and exact marker-verified
cleanup. Its lost-receipt check injects failure after a real committed query;
that is distinct from wire-level packet-loss certification. Failed/unknown
cleanup preserves resources. Database DROP exists only in this opt-in test
harness, after exact test-created identity/markers and process cleanup checks.

The 2026-10-12 scoped native acceptance passed on MySQL 8.4 and PostgreSQL 18:
real generated CRUD retained records across Stop/Run and an actual APIForge parent
restart with authenticated Store reopen; stable provenance, durable claim races,
cleanup failure and revision refusal were exercised. These runs used fresh
disposable Docker databases, UUID-owned Store fixtures and out-of-tree SQL/HTTP/
browser instrumentation. They are not an unqualified rerun of the uninstrumented
`npm run test:persistent-runtime-native` alias. The instrumented acceptance retained
databases until positively identified fixture-container disposal rather than
performing the package harness's SQL DROP cleanup.

Two earlier PostgreSQL verification-observer errors remain in the historical
evidence: one observer interfered with the lost-receipt injection, and another
misread the driver's multi-result shape. Their two failed PostgreSQL fixture
containers and volumes are intentionally retained. Corrected observer runs passed;
the failed fixtures and reports were not rewritten or cleaned up.

The IPC correction's focused suite distinguishes controlled connectors from actual
Node ChildProcess IPC disconnects. An isolated test-only copy with disconnect
invalidation disabled must fail the specific readiness assertion. Scoped native
verification also checks a living disconnected generated child, occupied status,
refused forwarding, claim retention after cleanup failure, safe owned Stop and
unchanged native data/provenance.

Power loss, native OS-delivered Windows signals, other platforms and hostile
same-authority namespace races remain unverified. The original default-store-
probing Windows Bootstrap suite remains NOT RUN under strict nonaccess;
fixture-only Bootstrap evidence is separate. Consult the external HANDOFF and
logs for exact current regression results and review/publication blockers.
