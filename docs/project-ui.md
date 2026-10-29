# Saved-project workspace (M2C)

The workbench adds **New**, **Open**, **Save**, an editable **Project name**, and
acknowledged revision/status feedback. Startup still has an empty editable source,
MySQL selected, neutral compiler panels and no automatic compilation. Rendering
the page and using New make no project session, storage, initialization or write
requests. No saved project is automatically selected.

## Workflow

1. Choose New to start an in-memory draft, or simply begin editing the initial
   workspace. Name the project and choose MySQL or PostgreSQL.
2. Write DSL, including incomplete or invalid DSL. Empty source is saveable.
3. Choose Save explicitly. A first save sends exactly `{name,target,source}` to
   `POST /api/projects`. Only an acknowledged successful response establishes the
   backend UUID and revision 1.
4. Choose Open to list backend summaries in their returned UUID order. Listing
   never fetches each project's DSL. Select one to request its current record and
   restore its name, source, target, UUID and acknowledged revision.
5. Edit and Save again. `PUT /api/projects/:id` sends the acknowledged
   `expectedRevision` and only changed fields in `changes`. A clean Save reports
   Already saved without creating an unnecessary revision.

Saving does not compile. Compilation uses the current editor source and target
directly, independently of the Project API, storage and revisions. Open/New use
the existing editor rendering and compilation/Live invalidation functions. They
clear diagnostics, generated output and download state without automatically
compiling. Save and project-name edits leave current compiler results alone.
Opening a workspace invalidates an existing Live session through the established
source/target safety behavior. It never starts a generated server; the existing
Live 15-minute disposal and explicit start/stop behavior are unchanged.

## Enablement and explicit initialization

Saved projects use the unchanged [protected M2B HTTP API](project-http-api.md).
Start the local development server with exactly `APIFORGE_PROJECT_API=1` to enable
it. Disabled project storage leaves the editor, compiler and downloads usable.
Storage requires the published Windows x64 private NTFS bootstrap and supported
Node 24.14.0+ built-in SQLite runtime. Compiler-only use retains Node 18+ support.

Expand **Saved-project storage** to find **Initialize Storage**. It asks for
confirmation that it creates the private local store, lazily obtains a session,
and sends exactly `POST /api/projects/initialize` with JSON `{}` and the required
token header. Initialization refuses existing, unsafe or incompatible storage
without repair/replacement. It never continues to Save automatically. Startup,
New, Open, Save, Compile and missing-store errors never initialize storage.
An established missing store requires manual resolution; initialization cannot
be used to adopt or repair it.

## Names and project identity

A project name is a preserved label, not a unique lookup key. Two saved
projects may have the same name and different backend UUIDs. Saving a
new draft with an existing name creates a separate project; it does not
select or overwrite the older one.

To edit a saved project, choose Open and deliberately select its record.
The workspace then retains that UUID and acknowledged revision for later
saves. Renaming that workspace changes the existing project's label rather
than creating another identity. New remains an in-memory draft until Save.

## Local state and asynchronous behavior

The module keeps the backend UUID, acknowledged revision and last acknowledged
`{name,target,source}` snapshot in JavaScript memory. Exact comparison of all three
fields drives Saved/Unsaved status. Reverting all fields restores Saved. A new
draft displays Not saved even before it has edits. Blank initial drafts need no
discard warning; name/source/target changes require confirmation before New/Open
replacement. Clear keeps a saved project's UUID/revision and modifies its source;
clearing unsaved edits in a named/project workspace requires confirmation.
Cancel preserves every workspace field. Dirty workspaces also request the
browser's standard beforeunload warning, subject to browser limitations.

A small operation/generation counter rejects abandoned List/Open responses.
Open also captures the edit counter and refuses replacement if any field changed
while its record request was pending. Canceling the native modal invalidates its
request and restores focus. Native dialog keyboard containment and Escape remain
available. Save locks New/Open and duplicate writes while source/name/target
editing remains available. A successful Save acknowledges the exact submitted
snapshot and returned revision without rewriting the editor; newer edits remain
dirty. Compile's existing revision/source/target checks remain intact.

Names are never trimmed or truncated by the browser. The Project Store remains
the validation authority. User/API text uses textContent or input values, never
project-generated HTML. Textareas expose CRLF/CR as LF; the workspace retains an
opened record's exact underlying source string while its displayed text matches,
including after a revert. Thus name-only/target-only saves preserve BOM, CRLF,
Unicode, NUL and whitespace bytes. Once source actually changes, Save records the
browser editor's current string without further normalization. This milestone
adds no file-import mechanism or custom line-ending editor.

## Conflicts, uncertain acknowledgments and reconnecting

On `PROJECT_REVISION_CONFLICT`, the losing draft and acknowledged revision remain
unchanged. Save is blocked until explicit recovery. **Keep editing locally**
focuses the editor without advancing the revision. **Inspect latest saved version**
reads and previews the server's source/name/target/revision while preserving the
draft. **Load saved version** requires discard confirmation before replacing it.
After that choice, later saves use the newly acknowledged loaded revision. There
is no automatic merge, fetch-and-replace, retry or revision advancement.

`PROJECT_COMMIT_UNCERTAIN` receives distinct feedback using the published safe
message. Network loss, timeout, malformed responses and unexpected acknowledgments
after mutations are also treated conservatively as unconfirmed. The local draft
and revision remain intact; Save is blocked while the user inspects saved state.
For an existing UUID, inspect the latest saved version. For an unacknowledged
first save, **Inspect saved projects** lists saved summaries so the user can select
a candidate deliberately. A first-save acknowledgment can be lost after creation;
its UUID may be unknown, duplicate names are permitted, and another first save
can create a duplicate. There is no idempotency protocol or automatic replay.
Inspection/loading after conflict or uncertainty intentionally discards local
changes only with the user's confirmation. The user may keep editing or explicitly
start another draft after acknowledging discard/duplicate risks.

### Choose a conflict-recovery action

| Choice | Effect on the current draft |
| --- | --- |
| Keep editing locally | Preserves draft and acknowledged revision; does not resolve the blocked Save |
| Inspect latest saved version | Reads a preview while preserving the draft |
| Load saved version | Replaces the draft only after discard confirmation and acknowledges the loaded revision |
| Reconnect Project API | Acquires a new connection token; does not replay Save or advance a revision |

Before choosing replacement, retain any source changes you still need.
A lost first-save response needs deliberate saved-project inspection
because the created UUID may be unknown and repeating a first save can
create a second project with the same name.

An invalid restart token is cleared from memory and displayed as
`PROJECT_API_TOKEN_INVALID`. Use **Reconnect Project API** to request a new session,
then choose the desired action explicitly. Reconnection never replays a mutation.
Read failures do not replace source or change compiler availability. Fixed safe
messages distinguish disabled, missing/existing, busy, unsupported platform/runtime,
not-found, validation, conflict, uncertainty, network and unexpected responses.
Unsafe server fields, stacks, paths and native exceptions are never rendered.

## Client security and verification

Requests use relative same-origin URLs, `credentials: omit`, JSON, no-store cache
policy, a 45-second abort deadline, and `X-APIForge-Project-Token` on protected
routes. Session acquisition is lazy and coalesced. Tokens stay in closure memory;
source/tokens never enter URLs, cookies, browser storage or diagnostic logs. The
client accepts the expected envelope/status and record shapes, validates canonical
UUIDs/revisions/targets, and checks Save acknowledgments against the submitted
snapshot. There is no browser filesystem root/SQLite option or direct Store call.
The backend's access checks, protocol and CORS behavior are unchanged.

Run `npm run test:frontend-projects` with existing Playwright dependencies and
Chromium, or set `APIFORGE_BROWSER_EXECUTABLE`. A test-owned Express server mounts
the unchanged router and compiler, using application-owned factory injection.
Native persistence/revision/process-reopen tests use retained UUID-named disposable
profile-local Windows stores. Controlled fake stores/routes cover delayed requests,
errors and lost acknowledgments; those checks are not native persistence evidence.
The suite retains results.json and 1440/900/390 screenshots. Existing frontend and
all eight backend regression commands remain required for milestone verification.

The inherited trust boundary is a private local Windows namespace with cooperating
same-authority processes. Same-user hostile processes, administrators and compromised
same-origin scripts are excluded. Other platforms/runtimes, second-user access,
unsupported filesystems, native generated MySQL/PostgreSQL lifecycle and sudden
power loss require separate evidence. M2C adds no database provisioning, deletion,
repair, backup/import/export, autosave, automatic compilation or persistent generated
backend processes.
