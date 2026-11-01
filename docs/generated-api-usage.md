# Generated API request walkthrough

This guide uses the existing generated HTTP contract. Examples are request
shapes, not evidence of requests executed against your database. For full
DSL rules, see the [language guide](APIForge-Language-Guide.md); for target
differences, see [PostgreSQL](postgres-target.md).

## Prepare the example backend

Compile this complete source, then follow the generated project's README
to configure its database, import `database/schema.sql`, and start its server:

```apiforge
ENTITY Student
id INT PRIMARY KEY
name STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
age INT MIN 18 MAX 65 DEFAULT 21
score FLOAT
active BOOLEAN DEFAULT TRUE
status ENUM("active", "inactive") DEFAULT "active"
```

Use the generated server's listening URL for the requests below. Resource
routes start at `/students`, without an `/api` prefix. `GET /health` reports
server availability; its handler does not query the database. Compiler
playground `/api/compile` and saved-project `/api/projects` are different APIs.

## Create a student

Send an object with JSON numbers and booleans, rather than quoted scalar values:

```http
POST /students
Content-Type: application/json

{"name":"Mira","age":21,"score":8.5,"active":false,"status":"active"}
```

Success returns HTTP 201 and `{ "success": true, "data": ... }`. Use the
resolved `data.id` for later item operations; do not assume the next key is 1.
Omitting `id` requests integer identity generation. Omitted ordinary defaults
can be stored without appearing in the create response, because create echoes
supplied fields plus resolved identity rather than reloading the row.

## Read the stored row

Replace `<student-id>` with the key acknowledged by the create response:

```text
GET /students/<student-id>
GET /students
```

Item success has one record in `data`; collection success has an array.
An absent item returns 404. A collection with no matches returns 200 with
`data: []`. A later item GET reads database defaults that were absent from
the create echo. Neither request implicitly creates or initializes a schema.

## Update only selected fields

```http
PUT /students/<student-id>
Content-Type: application/json

{"name":"Mira Rao","active":true}
```

PUT accepts partial declared-field changes; omitted fields retain their
stored values. Success returns the refreshed record. A supplied `id` is
refused as immutable, even if it equals the current key. `{}` performs an
existing-record lookup instead of clearing fields; an absent record is 404.
Use explicit `null` only for a field whose contract permits null.

## Delete an item deliberately

```text
DELETE /students/<student-id>
```

A successful delete returns HTTP 200 with `success` and `message`, rather
than HTTP 204 or a `data` record. Deleting a missing entity returns 404.
Relationship foreign keys can affect whether deletion succeeds and which
related rows are changed; inspect the generated schema before deleting
data you intend to retain. Sending the request again is another operation,
not an acknowledgment lookup for an earlier lost response.

## Filter collections by exact values

```text
GET /students?age=21
GET /students?status=active&active=false
GET /students?name=Mira%20Rao
```

Multiple filters combine with AND. These are equality filters, with STRING
comparison governed by the target column's collation. No contains, range,
OR, nested relationship, or special SQL NULL syntax is provided. A STRING
filter value `null` is literal text. Declared write bounds/defaults are not
reapplied as filter rules; a filter is not a write operation.

## Sort independently of pagination

```text
GET /students?sort=name&order=desc
GET /students?sort=age&page=1&limit=10
```

`sort` must name a known collection field. `order` is exactly `asc` or
`desc`, defaults to `asc`, and requires `sort`. Sorting alone leaves the
result unpaginated. With pagination, sorting a non-key field adds primary
key ASC as a tie-breaker; pagination without an explicit sort uses primary
key ASC. No automatic ordering is added to an unsorted, unpaginated query.

## Read pagination headers

Either `page` or `limit` enables pagination:

| Request | Effective page and limit |
| --- | --- |
| `/students?page=2` | Page 2, limit 20 |
| `/students?limit=5` | Page 1, limit 5 |
| `/students?page=2&limit=10` | Page 2, limit 10 |

The JSON body remains `success/data`; metadata arrives in `X-Total-Count`,
`X-Page`, `X-Limit`, and `X-Total-Pages` response headers. No matches means
zero total pages. A page beyond the last has an empty data array. Data and
count use separate SQL reads, so concurrent changes can affect agreement.
Without either control, results are unbounded and no count query runs.

## Encode typed filter values

| Filter in this example | Accepted spelling | Refused spelling |
| --- | --- | --- |
| INT `age` | `age=21` or `age=021` | `age=21.0` or `age=2e1` |
| FLOAT `score` | `score=.5`, `score=1e-3`, or `score=%2B3.2` | `score=NaN` |
| BOOLEAN `active` | `active=true` or `active=false` | `active=TRUE` or `active=1` |
| ENUM `status` | `status=active` | `status=ACTIVE` |

Query values arrive as decoded strings. Encode a literal plus as `%2B`;
an unescaped plus can decode as a space. This HTTP filter syntax is
separate from DSL numeric literal syntax and JSON write types. For example,
`{"age":"21"}` is not the numeric JSON input used by a generated INT write.

## Check a rejected collection query

These examples return 400 before a database query:

| Request suffix | Reason |
| --- | --- |
| `?unknown=1` | Field is not in the collection whitelist |
| `?age=21&age=22` | Repeated parameter is not one string value |
| `?order=desc` | Missing `sort` |
| `?page=01` or `?page=0` | Page must be canonical positive decimal digits |
| `?limit=101` | Maximum page size is 100 |

Page, limit, and the computed offset must also be safe integers. The names
`page`, `limit`, `sort`, and `order` are reserved controls; a declared field
with one of those names can be sorted but cannot use equality filtering.
Collection controls do not apply to item, write, or relationship routes.

## Use a generated many-to-many relationship

For a separate compilation, append these declarations to the example source:

```apiforge
ENTITY Course
id INT PRIMARY KEY
title STRING REQUIRED
RELATION Student ENROLLS_IN Course MANY_TO_MANY
```

After setting up that generated schema and creating both endpoint rows:

```text
POST /students/<student-id>/courses/<course-id>
GET /students/<student-id>/courses
DELETE /students/<student-id>/courses/<course-id>
```

POST adds the association and returns 201; GET returns related rows in an
array. DELETE removes the association and returns 200 with a message even
if no association was found. It does not delete the Course entity. Synthetic
FK fields are not ordinary declared HTTP write/filter fields. Recompilation
alone does not migrate an already populated database; plan schema changes separately.

## Interpret generated API errors

Generated handler errors use `{ "success": false, "error": "..." }`.
This string-valued error differs from the saved-project API's code/message
object and from compiler diagnostic arrays.

| Status | Typical generated-handler meaning |
| --- | --- |
| 400 | Invalid write/query input, malformed JSON, or recognized database value refusal on a write |
| 404 | Missing CRUD item or missing singular related record |
| 409 | Recognized database uniqueness/FK conflict on a write, delete, or association |
| 503 | Recognized temporary database connection, capacity, or lock failure |
| 500 | Unexpected or operation-inapplicable database failure |

Classification depends on the operation: a database code mapped to a write
conflict does not become a read conflict. SQL, driver codes, credentials,
and constraint details are withheld. Generated handlers do not retry failed
database operations automatically.

## Choose the operation's OpenAPI schema

Inspect `swagger.json` in the generated project. The server does not serve
that file or Swagger UI automatically. Operation schemas have distinct roles:

| Role | Use |
| --- | --- |
| `Student.Create` | POST fields and required-on-create presence |
| `Student.Update` | Partial PUT fields, excluding the immutable identity |
| `Student.Read` | Stored record, including effective identity and applicable synthetic FKs |
| `Student.CreateResult` | Create echo plus resolved identity, permitting omitted non-key defaults |

The generated server does not install an OpenAPI runtime validator. Use
the emitted controller contract when investigating a response; a successful
compile or schema document alone does not prove database deployment readiness.

## Keep HTTP and direct-model boundaries distinct

The examples above address generated HTTP endpoints. Their controllers
accept declared fields and apply request validation before model access.
Direct generated-model calls use trusted payloads and do not reproduce all
HTTP field whitelists or ordinary scalar bounds. Declared UUID/temporal
checks and identity-update refusal still apply at the model boundary.

Use the HTTP endpoint when you depend on its validation contract. A
successful direct-model call does not establish that the equivalent HTTP
request is accepted. Database constraints remain authoritative for stored
values. For complete role and relationship policy, consult the
[Effective Schema Plan](effective-schema-plan.md).
