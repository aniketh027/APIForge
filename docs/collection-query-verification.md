# Generated collection queries: contract and verification

Verified on 2026-10-01 against baseline main
`515af8e3f8cf2d3d193fc7f8dfb8d264d33d885a`.
Implementation commit: `b078a0522ca4b7f9d3947f74e3ec2e1a9acc5dac`.
Documentation and this review are delivered in a separate local commit.
No push is performed.

## Review result

**Ready. No blocking or correctness issues found in the reviewed scope.**

The requested repository skills were applied: apiforge-core,
apiforge-generated-backend, and apiforge-change-review. Review covered the full
implementation/test diff, emitted code, SQL binding, parsing boundaries, OpenAPI,
README, compatibility fixtures, real generated Express requests, MySQL, packaging,
and the compiler playground. Two minor findings were fixed before the final run:
generated property checks use `Object.prototype.hasOwnProperty.call` to avoid
introducing an `Object.hasOwn` runtime requirement, and OpenAPI permits empty ENUM
query values when an empty member is actually declared. The latter has a regression
check that executes the emitted parser and inspects its OpenAPI parameter.

## Audit before editing

| Question | Observed baseline and decision |
|---|---|
| Where is GET-all SQL generated? | `generateModel` emitted `findAll()` with unbounded `SELECT * FROM <entity>`. |
| Model or controller SQL? | Models own DB queries. Controllers call models and send JSON. Keep that division. |
| MySQL client? | Promise-based `mysql2/promise` pool, `pool.query`. |
| Existing parameterization? | Item reads and writes already use value placeholders and object binding; collection SELECT had no inputs. |
| Current collection body? | `{ success: true, data: [...] }`, rather than a bare array. |
| Would changing it break compatibility? | Yes. Preserve the entire envelope for unpaginated and paginated success. |
| Field whitelist source? | Codegen receives typed fields from validated optimized IR, including ENUM values. Generate trusted collection metadata in each model. |
| Type parsing? | Existing POST/PUT validation checks bounds/ENUM membership but does not parse query strings. Use one model parser for typed collection options, preserving write validation. |
| Implicit IDs represented in IR? | No. SQL prepends implicit INT id; collection target metadata adds it without changing compiler representations. |
| Existing OpenAPI queries? | Collection GET had no query parameters. Add optional controls/field filters and conditional response headers, preserving other operations/schemas. |

The baseline was captured before edits in an external temporary JSON snapshot.
The committed compatibility fixture stores representative sources, phase hashes,
protected generated sections, file lists, and exact diagnostic/warning assignments.

## Exact final contract

Scope is only `GET /<entities>` at existing root-level resource paths.
Item GET, POST, PUT, DELETE, relationship endpoints, and `/health` keep their routes
and behavior. No DSL syntax, phase architecture, diagnostic, or warning changes.

Examples for the representative Student entity:

```text
GET /students
GET /students?age=21
GET /students?status=active&active=true
GET /students?sort=name&order=desc
GET /students?page=2&limit=20
GET /students?status=active&age=21&sort=name&order=desc&page=2&limit=10
```

Success always returns `{ "success": true, "data": [...] }`.
No pagination object is added. Filters/sorting alone do not enable pagination.
Without page/limit the query remains unbounded and does not issue COUNT.

### Filters

Known declared fields and implicit INT id accept SQL exact equality. Multiple
filters combine with AND in declaration order, independent of query-string order.
Reserved names are `page`, `limit`, `sort`, `order`. A field bearing one of these
names remains sortable but cannot act as a filter.

| Type | Accepted query string |
|---|---|
| INT | Optional leading minus and decimal digits, converting to a safe integer. Leading zeros are accepted for filters; plus signs, decimals/exponents, whitespace and unsafe integers are rejected. |
| FLOAT | Signed finite decimal/exponent representation, including `.5`, `+3.2`, `1e-3`. Reject empty, whitespace, hex, NaN and Infinity. URL-encode literal plus signs as `%2B`. |
| BOOLEAN | Exactly lowercase `true` or `false`, converted to a boolean. |
| STRING | Raw query text, including empty strings, apostrophes, and injection-like text. |
| ENUM | Exact case-sensitive declared string membership, including empty only when declared. |

No special NULL syntax: STRING `null` is literal text; ENUM `null` works only if a
declared member; numeric/boolean `null` is invalid. No contains, wildcard, range,
OR, or relationship filtering is added. Query filters validate types/membership,
not POST/PUT field bounds. Equality retains MySQL column comparison semantics,
including existing STRING collation and FLOAT storage behavior.

### Sorting and pagination

`sort` must name a known field, including implicit id or explicit STRING PK.
`order` permits lowercase `asc` or `desc`; omitted order defaults to asc.
Order without sort is invalid. Arbitrary SQL functions/identifiers are rejected.

Either page or limit enables pagination. Defaults are page 1 and limit 20; limit
maximum is 100. Page/limit require canonical positive decimal digits (no leading
zeros, signs, decimal points, exponents or whitespace). Safe integer checks apply
to page, limit, and `(page - 1) * limit`. SQL uses `LIMIT ? OFFSET ?`.
Pagination defaults to primary key ASC. Explicit non-primary sorting appends
primary key ASC to make ties deterministic. Unpaginated sorting has no added tie-breaker.

Paginated responses include:

| Header | Meaning |
|---|---|
| X-Total-Count | COUNT of rows matching the same filters. |
| X-Page | Requested page or default 1. |
| X-Limit | Requested limit or default 20. |
| X-Total-Pages | `ceil(total / limit)`, zero when total is zero. |

No matches and pages beyond the last return an empty data array. Counts use the
same `filterQuery` helper and parameter list, with no limit/offset or sorting.
Data and count are separate SQL reads; concurrent writes can alter the count
between reads. Pagination does not promise a transaction snapshot.

### Errors and SQL safety

Unknown parameters, repeated/array/object/non-string values, invalid typed values,
unknown sort fields, invalid order, invalid pagination, and unsafe offsets return
HTTP 400 before any DB access, using `{ success: false, error: "..." }`.
Caught collection DB errors return sanitized HTTP 500 with
`Unable to retrieve collection.`; existing unrelated handlers are unchanged.

HTTP strings are parsed once by the model helper invoked by the controller.
Models assemble SQL from code-generated trusted table/column metadata. The selected
sort column is looked up in that metadata; ASC/DESC are fixed strings. Filter
values, limit, and offset use mysql2 placeholders. No user value or unvalidated
identifier becomes executable SQL. No dependency is added.

## Intentionally changed artifacts and documentation

- `models/<Entity>.js`: collection metadata, query parser, shared WHERE helper,
  optional filtered/sorted/paginated findAll, and filtered count.
- `controllers/<entity>Controller.js`: only collection GET changes, with query
  validation, headers, unchanged success envelope, and sanitized DB error handling.
- `swagger.json`: optional page/limit/sort/order and non-reserved typed field
  filters; implicit id, ENUM/sort/order enums, pagination defaults/bounds,
  conditional four response headers, and collection 400 description.
- Generated `README.md`: concise collection contract, safety, scope, and examples.
- Project README, Language Guide generated-API section, core known behavior, and
  generated-backend contract/checklist references document the final behavior.
  Stale `/api` prefixes in the Language Guide route tables were corrected to the
  existing actual root-level paths; the implementation does not change routes.

Schema SQL, generated dependencies/package, configuration, environment template,
route modules, server, full model field semantics, item/write/relationship methods,
existing validation, and non-collection OpenAPI are unchanged for identical input.
No frontend source changes, new generated files, or checked-in output updates.

## Added tests and compatibility evidence

`tests/collection-query.test.js` adds nine focused groups:

1. Opt-in pagination/defaults/max limit, malformed values, safe integer/offset boundaries.
2. Valid/invalid filters for all five datatypes, raw STRING values and null policy.
3. Sorting/ordering whitelist, unknown keys, malformed scalar/repeated parameters and attacks.
4. Implicit id, STRING primary key, reserved SQL identifiers and reserved query-name collisions.
5. Deterministic SQL clauses/values, shared count filters, bound injection strings and no-argument findAll.
6. Actual emitted HTTP routes: success envelope, conditional headers, no COUNT without pagination,
   empty results, 400 before mocked DB access, and sanitized collection DB failure.
7. OpenAPI types/enums/defaults/bounds/headers, implicit id, reserved-name uniqueness and declared empty ENUM.
8. Eight frozen-source regressions: tokens, AST, symbol table, IR and optimized IR hashes,
   exact 61 error and five warning assignments, schemas, methods, dependencies/routes and emitted JS syntax.
9. Compiler HTTP artifacts and frontend ZIP entry names/content equality.

The helper snapshots protected model fields and item/write/relationship suffixes,
controller validation/create prefix and item/write/relationship suffix, and all
non-collection OpenAPI. Eight programs cover explicit INT key, STRING key, implicit
key, relationship, STRING bounds, ENUM, all datatypes, and reserved names.
Existing historical warning/ENUM fixtures were preserved. Their whole-artifact
assertions now exclude only the intentionally changed artifact classes; new frozen
section-level checks cover those files. Existing core signature assertions were
updated for optional findAll options, with all tests retained.

## Verification results

| Command/check | Final result |
|---|---|
| `npm test` | PASS: 1,060 core checks; 25 STRING-length, 53 diagnostics, 26 warnings, 16 ENUM, 9 collection groups; disk-generation and MySQL-safety suites also pass. |
| `node tests/collection-query.test.js` | PASS: all 9 groups; also included in npm test. |
| `npm run test:generated-integration` | PASS: standalone dependency installation, npm start, /health and complete cleanup on an ephemeral port. |
| `node tests/generated-backend-mysql.test.js` with local opt-in test config | PASS after final code fixes: isolated native MySQL schema/CRUD/ENUM/relationships and new collection/injection checks. |
| Generated JS and JSON | All emitted JS parses across the eight programs; OpenAPI/manifest JSON parsed in tests. |
| `git diff --check` | PASS. |
| Preserved artifacts | All four report roots: exact file list and 36 SHA-256 hashes match the before-edit snapshot. Repository output snapshot also unchanged. |

Test logs are outside the repository under the user's temporary directory:
`apiforge-query-final.log` and `apiforge-query-mysql-final.log`.
No credentials are included in artifacts or logs.

### Live MySQL and injection results

The final harness used and dropped
`apiforge_e2e_mupoor838603a0bbeee2c525`. Five Student rows enabled real checks:
age 21 filtering; exact STRING, ENUM active, BOOLEAN true/false and FLOAT 8.5
filtering; ascending/default and descending sorting; page 2/limit 2 with expected
IDs and headers 5/2/2/3; combined active + age 21 + name DESC + page 2/limit 1
returning Ada with filtered count 2; zero matches, beyond-last page, and max limit.

Field/sort/order injection, unknown keys, invalid typed values, repetitions and
overflow returned 400. The STRING attack `' OR 1=1 --` returned no rows as bound
literal data. A subsequent collection read still found the same five rows and
intact table. Mocked SQL checks independently confirm the injection text occurs
only in the bound parameter array. The fixture rows were deleted before the
original CRUD/relationship checks continued.

Existing item GET (including an unrelated query parameter), POST/PUT/DELETE,
defaults/constraints, native ENUM casing/membership/escaping, many-to-many
list/add/remove, and /health checks pass. The harness verified server process,
temporary DB/project, port release and unchanged repository output. Other
relationship cardinalities are covered by unchanged generated-section and core
tests, rather than new live MySQL scenarios.

### Manual playground verification

Compiled the representative six-field Student source through the real playground.
All six phases succeeded and produced 10 files. Inspected API model/parser,
controller/body/headers and generated README in the UI; OpenAPI tab displayed
the four controls, typed field filters, enums, pagination bounds and headers.
Generated route content was inspected in the downloaded artifact and preserved
by compatibility checks.

The actual browser download at `C:\Users\anike\Downloads\apiforge-project.zip`
contains exactly the 10 current generated paths and contents, compared byte-for-byte
with the current compiler for the same source. ZIP SHA-256:
`89316b9ea7572502128d47ae8e1d8a0de6d4fec3d2b9d53ae6eb7b50169f2ed7`.
The native browser saved the file successfully even though the automation download
event timed out; the actual downloaded file was independently verified.
Screenshots were saved outside the repository under the current visualization
directory as `collection-query-openapi.jpg` and
`collection-query-playground-download.jpg`. The temporary viewport override was
reset and the playground server started for this verification was stopped.

## Scope and delivery confirmation

Existing compiler diagnostic codes and WRN001-WRN005 assignments are exactly
unchanged. ENUM language, schema and POST/PUT runtime behavior are unchanged.
Collection success response compatibility is preserved. Relationship routes and
logic are unchanged. Two scoped commits are created locally without amendment,
squash, rebase or push; final hashes and Git status are reported in the completion
message.

These pre-existing untracked report artifacts were excluded from staging and remain
unchanged:

```text
APIForge_Drive_Resources.zip
APIForge_Drive_Resources/
APIForge_Overleaf_Source/
APIForge_Overleaf_Source__FINAL.zip
```
