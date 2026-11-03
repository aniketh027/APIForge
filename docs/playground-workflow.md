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
