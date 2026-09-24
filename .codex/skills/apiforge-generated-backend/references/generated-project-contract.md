# Current generated-project contract

This reference describes current implementation behavior. It is not a promise that missing standalone-project features already exist.

## Generation modes and file set

`src/codegen/codegen.js` consumes validated optimized IR. `generate(ir, true)` writes under repository `output/`; `generate(ir, false)` returns the same `{ path, content }` entries without writing. The compiler API uses the in-memory form.

Current generation returns five fixed files plus three files per entity:

```text
database/schema.sql
config/db.js
.env.example
models/<Entity>.js
controllers/<entity>Controller.js
routes/<entity>Routes.js
server.js
swagger.json
```

- `database/schema.sql`: MySQL entity tables followed by relationship DDL.
- `config/db.js`: `mysql2/promise` pool configuration.
- `.env.example`: environment-variable template.
- `models/`: parameterized CRUD queries and source-side relationship query helpers.
- `controllers/`: CRUD handlers, range validation, relationship handlers, and JSON responses.
- `routes/`: per-entity CRUD and source-side relationship routes.
- `server.js`: dotenv loading, JSON middleware, route mounts, `/health`, global error handler, and startup.
- `swagger.json`: OpenAPI 3.0.0 paths and component schemas.

Disk generation creates directories and overwrites emitted files but does not clean old files from `output/`; inspect the returned file list when an exact current generation set matters.

## Dependencies and environment

Generated runtime code requires:

- `express`
- `dotenv`
- `mysql2` through `mysql2/promise`

No generated `package.json`, lockfile, README, install script, database bootstrap, or `.env` is currently emitted. `.env.example` contains `PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`, with code fallbacks for local MySQL and database `apiforge_db`.

Therefore the current extracted output/ZIP is not independently installable from its own dependency manifest. Do not call it standalone without additional implementation and end-to-end evidence.

## SQL contract

- Types map as `INT -> INT`, `STRING -> VARCHAR(255)`, `FLOAT -> FLOAT`, and `BOOLEAN -> BOOLEAN`.
- An explicit `INT` primary key without a default is auto-incremented. A primary key with a default omits auto-increment. If no primary key is declared, SQL prepends `id INT PRIMARY KEY AUTO_INCREMENT`.
- `REQUIRED`, `UNIQUE`, typed defaults, and numeric `MIN`/`MAX` become `NOT NULL`, `UNIQUE`, `DEFAULT`, and `CHECK` clauses as applicable.
- String defaults escape single quotes by doubling them. MySQL reserved or otherwise unsafe identifiers are backtick-quoted by the general identifier helper.
- Entity tables are emitted before relationship DDL.

Relationship SQL:

| Cardinality | Current storage |
|---|---|
| `MANY_TO_MANY` | `<Source>_<Target>` junction table, composite key, two cascading foreign keys. |
| `ONE_TO_MANY` | Nullable source foreign-key column on the target table with `ON DELETE SET NULL`. |
| `MANY_TO_ONE` | Nullable target foreign-key column on the source table with `ON DELETE SET NULL`. |
| `ONE_TO_ONE` | Unique source foreign-key column on the target table with `ON DELETE CASCADE`. |

## Express and route contract

- Models use promise-based MySQL queries with value placeholders and `INSERT/UPDATE ... SET ?` payload binding.
- Models select the declared primary key for record lookup; without one, current model generation falls back to the first declared field even though SQL injects an `id`. Verify no-primary-key cases explicitly.
- Controllers return `201` for create, `200` for successful reads/updates/deletes, `404` for missing CRUD or singular related records, `400` for generated validation failures, and `500` for caught database/runtime errors.
- Generated request validation currently enforces `MIN`/`MAX` only when a value is present. SQL enforces `NOT NULL`, uniqueness, defaults, and checks; OpenAPI marks `REQUIRED` fields and exposes ranges/defaults.
- Per-entity routers expose `GET /`, `GET /:id`, `POST /`, `PUT /:id`, and `DELETE /:id`.
- The generated server mounts routers directly at lowercase plural paths such as `/students`, without an `/api` prefix, and exposes `/health`.
- Relationship model/controller/routes are generated on the source entity. `MANY_TO_MANY` supports list/add/remove; `ONE_TO_MANY` supports list; `MANY_TO_ONE` and `ONE_TO_ONE` support singular lookup.

## OpenAPI contract

`swagger.json` uses OpenAPI 3.0.0. It describes CRUD and generated relationship paths without an `/api` prefix, maps DSL field types to JSON Schema types, marks `REQUIRED` fields, and includes numeric minimum/maximum and default metadata. The generated server does not currently serve Swagger UI or the JSON file.

Path parameter schemas are currently emitted as integers. Verify type fidelity explicitly when entities use non-integer primary keys.

## Download packaging

The web playground receives `generatedFiles` from `POST /api/compile` and builds `apiforge-project.zip` entirely in the browser. `frontend/app.js` writes a basic uncompressed ZIP whose entries are exactly the returned paths and contents. It does not package the repository's `output/` directory or APIForge development files.

If ZIP construction throws, the browser downloads a single `apiforge-generated-project.txt` concatenation instead. There is no server-side archive endpoint, generated dependency manifest, or current automated ZIP-content test.

## Desired future behavior when explicitly requested

A task may make generated projects standalone or expand packaging, but that is not current behavior. Such work must define the artifact contract, emit all installation/startup dependencies and instructions it claims, verify the extracted structure, and execute the consumer workflow through a running generated API before calling the result standalone.
