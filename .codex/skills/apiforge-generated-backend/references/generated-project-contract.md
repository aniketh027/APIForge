# Current generated-project contract

This reference describes current implementation behavior. It is not a promise that missing standalone-project features already exist.

## Generation modes and file set

`src/codegen/codegen.js` consumes validated optimized IR. `generate(ir, true)` writes under repository `output/`; `generate(ir, false)` returns the same `{ path, content }` entries without writing. The compiler API uses the in-memory form.

Current generation returns seven fixed files plus three files per entity:

```text
database/schema.sql
config/db.js
.env.example
package.json
README.md
models/<Entity>.js
controllers/<entity>Controller.js
routes/<entity>Routes.js
server.js
swagger.json
```

- `database/schema.sql`: MySQL entity tables followed by relationship DDL.
- `config/db.js`: `mysql2/promise` pool configuration.
- `.env.example`: environment-variable template.
- `package.json`: generated-project metadata, `npm start`, and the required runtime dependencies using APIForge-compatible version ranges.
- `README.md`: concise install, environment, MySQL schema-import, startup, route, and OpenAPI-location instructions.
- `models/`: parameterized CRUD queries and source-side relationship query helpers.
- `controllers/`: CRUD handlers, numeric and STRING-length validation, relationship handlers, and JSON responses.
- `routes/`: per-entity CRUD and source-side relationship routes.
- `server.js`: dotenv loading, JSON middleware, route mounts, `/health`, global error handler, and startup.
- `swagger.json`: OpenAPI 3.0.0 paths and component schemas.

After writing the complete new file collection, disk generation removes files not in that collection from the generator-owned `models/`, `controllers/`, `routes/`, `config/`, and `database/` directories. Those subdirectories are reserved for generated artifacts. Root-level files that APIForge does not generate, including a user-created `.env`, are preserved, as are files outside `output/`. Invalid IR and content-generation failures occur before disk output is written or reconciled.

## Dependencies and environment

Generated runtime code requires:

- `express`
- `dotenv`
- `mysql2` through `mysql2/promise`

The generated `package.json` declares only `express`, `dotenv`, and `mysql2`, using the version ranges from APIForge's own dependency manifest, and defines `npm start` as `node server.js`. No lockfile, database bootstrap, or `.env` is emitted. `.env.example` contains `PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`, with code fallbacks for local MySQL and database `apiforge_db`.

The generated README documents dependency installation, `.env` creation, MySQL database and schema preparation, startup, mounted route prefixes, and the root-level `swagger.json`. The generated server does not automate database creation or schema import.

## SQL contract

- Types map as `INT -> INT`, `STRING -> VARCHAR(255)` by default, `FLOAT -> FLOAT`, and `BOOLEAN -> BOOLEAN`. A STRING length bound above 255 widens the generated `VARCHAR` capacity to that bound; relationship foreign-key types use the same resolution when the primary key is a STRING.
- An explicit `INT` primary key without a default is auto-incremented. A primary key with a default omits auto-increment. If no primary key is declared, SQL prepends `id INT PRIMARY KEY AUTO_INCREMENT`.
- `REQUIRED`, `UNIQUE`, typed defaults, numeric `MIN`/`MAX`, and STRING `MIN_LENGTH`/`MAX_LENGTH` become `NOT NULL`, `UNIQUE`, `DEFAULT`, and `CHECK` clauses as applicable. STRING-length checks use `CHAR_LENGTH`.
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
- Generated request validation enforces `MIN`/`MAX` and `MIN_LENGTH`/`MAX_LENGTH` only when a value is present and non-null. STRING-length validation rejects non-string supplied values and counts Unicode code points with `Array.from(value).length`. SQL enforces `NOT NULL`, uniqueness, defaults, and checks; OpenAPI marks `REQUIRED` fields and exposes ranges, lengths, and defaults.
- Per-entity routers expose `GET /`, `GET /:id`, `POST /`, `PUT /:id`, and `DELETE /:id`.
- The generated server mounts routers directly at lowercase plural paths such as `/students`, without an `/api` prefix, and exposes `/health`.
- Relationship model/controller/routes are generated on the source entity. `MANY_TO_MANY` supports list/add/remove; `ONE_TO_MANY` supports list; `MANY_TO_ONE` and `ONE_TO_ONE` support singular lookup.

## OpenAPI contract

`swagger.json` uses OpenAPI 3.0.0. It describes CRUD and generated relationship paths without an `/api` prefix, maps DSL field types to JSON Schema types, marks `REQUIRED` fields, and includes numeric minimum/maximum, STRING minLength/maxLength, and default metadata. The generated server does not currently serve Swagger UI or the JSON file.

Path parameter schemas derive from the owning entity's primary-key datatype. Entities without an explicit primary key use the generated integer `id` column.

## Download packaging

The web playground receives `generatedFiles` from `POST /api/compile` and builds `apiforge-project.zip` entirely in the browser. `frontend/app.js` writes a basic uncompressed ZIP whose entries are exactly the returned paths and contents. It does not package the repository's `output/` directory or APIForge development files.

If ZIP construction throws, the browser downloads a single `apiforge-generated-project.txt` concatenation instead. There is no server-side archive endpoint or current automated ZIP-content test.

## Standalone verification boundary

The opt-in `npm run test:generated-integration` harness verifies the generated project as a consumer artifact without mutating repository `output/`: it compiles representative DSL, materializes the in-memory files in a temporary directory, installs declared dependencies, starts the backend through `npm start` on an ephemeral port, confirms `GET /health`, stops the process tree, and removes the temporary project. It is intentionally excluded from the offline-friendly `npm test` command. The absence of a generated lockfile means compatible dependency releases may vary between integration runs.

This harness proves generated-project install and server startup, not database behavior. A complete DB-backed standalone claim still requires configuring MySQL, importing `database/schema.sql`, and exercising CRUD, validation, constraints, and relationships against that database.
