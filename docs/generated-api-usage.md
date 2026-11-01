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
