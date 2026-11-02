# Compiler HTTP client guide

Use `POST /api/compile` to inspect compilation results in memory. This
guide describes the current dev-server contract; examples are not a record
of requests executed against a running server. See the
[language guide](APIForge-Language-Guide.md) for DSL syntax and
[structured diagnostics](structured-diagnostics.md) for the full registry.

## Connect to the compiler server

From an installed APIForge checkout, `npm run dev` starts `server.js`.
Its default port is 3001; `DEV_PORT` overrides it. Use the printed URL
rather than the address of a separately started generated backend.
`GET /api/health` returns `{ "status": "ok", "version": "1.0.0" }`.
Health does not compile source or establish database readiness.

## Send source from PowerShell

Set `$base` to the dev-server URL. Construct JSON from an object so source
newlines and quotes are escaped correctly, and send explicit UTF-8 bytes:

```powershell
$base = 'http://localhost:3001'
$source = "ENTITY Student`nid INT PRIMARY KEY"
$json = @{ source = $source; target = 'mysql' } | ConvertTo-Json
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$result = Invoke-RestMethod -Method Post -Uri "$base/api/compile" `
    -ContentType 'application/json; charset=utf-8' -Body $bytes
$result.generatedFiles | Select-Object path
```

This success-path example leaves all returned files in memory. PowerShell
reports non-success HTTP statuses as errors; use a client that retains
their response bodies when investigating compiler diagnostics.

## Retain non-success response bodies with Fetch

For a Node 18+ client, parse the JSON body even when the HTTP status is
not successful. This helper returns the status and compiler result together:

```js
async function compileSource(base, source, target = 'mysql') {
  const response = await fetch(`${base}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target })
  });
  const result = await response.json();
  return { status: response.status, ok: response.ok, result };
}
```

A network failure or non-JSON response still rejects this helper. Keep that
transport failure distinct from a parsed `success: false` compiler result.
The helper does not publish files, retry requests, or launch generated code.

## Distinguish missing source from an empty program

| JSON body | Admission behavior |
| --- | --- |
| `{}` | 400 `INP001`: source is missing |
| `{"source":null}` | 400 `INP001`: source is not a string |
| `{"source":42}` | 400 `INP001`: source is not a string |
| `{"source":""}` | Enters compilation; semantic 422 `SEM001` |
| `{"source":"// only a comment"}` | Enters compilation; semantic 422 `SEM001` |

Do not trim the source to decide whether to send it. An empty string is
valid input to the HTTP surface even though the language requires an entity.
Source type validation precedes target resolution, so a request with both
an invalid source type and invalid target reports the source problem first.

## Select a target explicitly

```json
{"source":"ENTITY Student\nid INT PRIMARY KEY","target":"postgres"}
```

Omitting `target` selects MySQL. Only exact lowercase `mysql` and
`postgres` are accepted; `pg`, `Postgres`, empty text, numbers, and `null`
return 400 `INP003` after source admission. Target selection changes the
generated backend, not the DSL source or number of public compiler phases.
It does not configure a database connection. See the
[PostgreSQL target contract](postgres-target.md) before running its artifacts.

## Keep JSON transport separate from DSL string syntax

Use an encoder such as `JSON.stringify` or `ConvertTo-Json`, rather than
building a request body by concatenating source into quoted JSON. For example:

```json
{"source":"ENTITY Message\ntext STRING DEFAULT \"ready\""}
```

The JSON decoder produces a newline and quoted DSL text before the lexer
runs. JSON escape support does not add escape syntax to DSL strings:
backslashes inside a DSL string remain literal, and a quoted DSL string
cannot contain an actual line feed. Inspect the decoded source when a
transport-escaping mistake appears as a lexer/parser diagnostic.

## Read a successful compilation

HTTP 200 with `success: true` returns these existing fields:

| Field | Content |
| --- | --- |
| `tokens`, `ast`, `symbolTable` | Lexer, parser, and semantic results |
| `ir`, `optimizedIR` | IR generation and optimizer results |
| `optimizations` | Reported optimization actions |
| `phases`, `phaseStates` | Six successful phase flags and state strings |
| `warnings` | Structured non-fatal diagnostics, possibly empty |
| `generatedFiles` | Generated `{path, content}` records |

Success certifies generation for this request. It does not mean dependencies
were installed, SQL was imported, a backend was started, or a database was
migrated. The compiler API calls generation with disk writing disabled.

## Inspect one returned file

After checking `result.success`, select artifacts by path rather than a
hard-coded array index. For example, using the Fetch helper's parsed result:

```js
const schema = result.generatedFiles.find(file => file.path === 'database/schema.sql');
const openapiFile = result.generatedFiles.find(file => file.path === 'swagger.json');
if (schema) console.log(schema.content);
if (openapiFile) console.log(JSON.parse(openapiFile.content).openapi);
```

Compiling over HTTP does not update the repository's `output/` directory.
Use the ordinary file CLI when disk publication is the goal. Returned
JavaScript is artifact content to inspect; receiving it does not execute it.

## Treat warnings as successful output when compilation succeeds

This complete source has no explicit key:

```apiforge
ENTITY Item
value STRING
```

It produces `WRN001` for the implicit integer identity while remaining a
successful compilation. `warnings` contains diagnostic objects, not strings;
display `warning.code`, `warning.message`, and available locations. Do not
decide failure from a nonempty warnings array. Use `success`, fatal
diagnostics, and phase states; warnings do not enter generated artifact bytes.

## Investigate a syntax failure

For source `ENTITY Item` followed by a newline and `value`, the field has
no datatype at EOF. The parser reports 400 `PAR012`. The response can retain
successful lexer tokens while the parser is failed and later phases skipped.

Read `diagnostic` for the first shared error and `diagnostics` for the
reported collection. Legacy `errors` entries remain available. Match stable
public codes instead of parsing English message text. Locations are 1-based
UTF-16 coordinates with exclusive ends; unavailable positions remain absent
or null according to the shared contract, not fabricated at line one.

## Investigate a semantic refusal

```apiforge
ENTITY Student
age INT MIN 60 MAX 18
```

The contradictory bounds produce semantic 422 `SEM017`. Earlier tokens
and AST may remain available, but no generated backend is returned from
this failed request. Correct the source and submit a new request; partial
phase artifacts are inspection results rather than a deployable project.
Multiple semantic errors can be collected, unlike immediate lexer/parser
failure. Consult the full diagnostic array rather than only the first card.

## Use the filesystem surface for imports

The HTTP body supplies one source string, not an entry pathname or virtual
filesystem. A parsed `IMPORT "./models/item.apiforge"` declaration returns
400 `INP010`. The parser may have succeeded before that input-boundary refusal;
semantic analysis and later phases are skipped.

Do not place server-local paths in extra JSON fields expecting resolution.
Use the file CLI or `compileFile` library for source projects with imports,
following the [module guide](modules.md). The browser compiler shares this
single-source limitation. A malformed import can fail parsing before the
HTTP surface reaches its unsupported-import check.

## Separate compiler refusals from server parsing errors

| Status | Current contract |
| --- | --- |
| 400 | Input source/target refusal, lexer/parser diagnostics, unsupported HTTP imports |
| 422 | Semantic refusal or recognized PostgreSQL codegen admission `GEN001` |
| 500 | Unexpected compiler exception or existing global JSON-parser error handling |
| 200 | All phases succeeded, including warning-only success |

Malformed JSON reports `INP002` through the dev server's preserved global
500 handler; do not assume every JSON syntax error uses 400. The compiler
uses the server's `express.json({limit: '1mb'})` middleware. Transport limits
are separate from the saved-project API's larger dedicated parser. An input
body rejected by middleware never enters the six-phase pipeline.

## Inspect phase states explicitly

For the Fetch helper's parsed `result`, print the named states rather than
treating every false legacy flag as an additional failure:

```js
for (const phase of ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen']) {
  console.log(phase, result.phaseStates[phase]);
}
```

`succeeded`, `failed`, and `skipped` are distinct. An early input refusal
can leave all six public phases skipped. An import refusal can retain
successful lexer/parser states while its diagnostic phase is `input`.
Warnings already emitted by successful earlier phases may survive a later
failure; their presence does not imply that generation completed.
