# APIForge playground workflow

The browser playground sends one source string and the selected target to
the compiler API. It displays phase results and generated files in the page.
This guide describes the current local UI; it does not claim that an example
was run against a live server. For JSON client requests, see the
[compiler HTTP client guide](compiler-http-client.md).

## Start the local playground

From the APIForge checkout, run `npm run dev` and open the URL printed by
the development server. Its default port is 3001; `DEV_PORT` can select
another port. The compiler's `/api/health` route reports server availability.
It does not start a generated backend or check its database.

## Enter one complete source program

Type or paste a complete APIForge program into the source editor, then
choose **Compile**. The editor is a single-source input: it does not load
files named by `IMPORT` declarations. Parsed filesystem imports are refused
with `INP010`; use the file CLI or `compileFile` library for a module tree.

The playground sends the source as entered. It does not wrap text in braces,
rewrite field declarations, or make JSON escaping part of DSL string syntax.
For grammar, literal rules, and working source examples, use the
[language guide](APIForge-Language-Guide.md).

## Choose MySQL or PostgreSQL before compiling

The target buttons begin with MySQL selected. PostgreSQL must be selected
explicitly. Changing the target invalidates the displayed compilation and
asks for a fresh Compile so the outputs match the selected target.

Target selection changes generated artifacts; it does not provision a
database, import SQL, or switch a running generated project. G26 schema
migrations remain MySQL-only. Read the
[PostgreSQL target guide](postgres-target.md) before using its output.

## Read compile progress

While a request is pending, the Compile button shows a busy state and
the phase pipeline reports that compilation is running. On success all six
phases are marked complete. On a compiler response, the UI uses the returned
`phaseStates`: `succeeded`, `failed`, and `skipped` have distinct displays.

A network failure is shown as compiler unavailable. It is not a lexer,
parser, semantic, IR, optimizer, or code-generation diagnostic. Check that
the local dev server is running and retry after restoring connectivity.

## Interpret a partial pipeline

The compiler stops after a failed phase. Earlier results can remain visible;
the failed phase is marked failed and later phases are skipped. A skipped
phase was not evaluated, so it is not a second compiler error.

Output panes that depend on phases that did not complete show an unavailable
state instead of presenting stale results as current. Input refusal can
also occur before the public six-phase pipeline; read the diagnostic's
phase together with the individual status markers.

## Use error cards to return to the source

Compiler error cards show the public diagnostic code and message, available
source location, and a formatted excerpt when captured source context exists.
Located lines are highlighted in the editor. Some internal or input errors
have no source location, so the UI cannot highlight a line for them.

Compiler positions are 1-based UTF-16 coordinates and range ends are
exclusive. If you map a diagnostic into an external editor, preserve those
conventions; supplementary Unicode characters can occupy two UTF-16 code
units. See [structured diagnostics](structured-diagnostics.md).
