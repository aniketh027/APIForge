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
