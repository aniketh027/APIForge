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
