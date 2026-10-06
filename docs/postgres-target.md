# PostgreSQL target (G27)

MySQL remains APIForge's default. PostgreSQL is selected explicitly; source syntax and the six compiler phases are unchanged. The browser continues to omit target and generates MySQL. G26 snapshots and migrations remain exclusively `mysql-8.4-v1`.

```powershell
node index.js samples/student.apiforge --target postgres
node index.js --target postgres samples/student.apiforge
```

Library callers pass `{ target: 'postgres' }` to `SemanticAnalyzer.analyze(ast, options)`, `Codegen.prepareAdmittedGeneration(ir, options)` and `Codegen.generate(ir, false, options)`. Disk generation uses `true`. Omission or `target: undefined` selects MySQL; `mysql` and `postgres` are the only exact values. Null, empty, aliases, case changes and wrong types fail with `INP003 INVALID_TARGET`. The CLI rejects duplicate/missing target flags before compilation or publication. HTTP `POST /api/compile` accepts `{ "source": "...", "target": "postgres" }`; invalid targets return 400. Source validation retains precedence. PG semantic admission uses `SEM040`; recognized direct-IR PG admission failure uses `GEN001` (HTTP 422), while unexpected compiler failures remain 500.

## Certified profile and architecture

`postgresql-18-v1` requires PostgreSQL major 18, UTF8, stock 64-bit 8192-byte blocks, 63-byte identifiers, 32 index columns, the existing `public` schema, standard conforming strings, ISO/YMD dates and UTC application sessions. The application user needs public USAGE/CREATE and table SELECT/INSERT/UPDATE/DELETE privileges. No schemas or extensions are created automatically. Native verification records the exact tested minor release and image digest in [the verification report](postgres-target-verification.md).

Target selection stays outside tokens, AST, symbols, IR, optimized IR and serialized Effective Schema Plan. One admitted plan feeds PostgreSQL physical planning; MySQL physical SQL is never transformed. `src/targets/postgres/names.js` owns identifiers/names, `ddl.js` owns physical admission/types/literals/DDL, `runtime.js` owns pg configuration/models/project metadata, and `errors.js` owns PG error classification. Common controllers, routes, server, request/query validation and OpenAPI consume existing logical roles. Legacy `Codegen.generateSQL(ir)` remains the unchecked MySQL compatibility export.

## Physical representation

| APIForge | PostgreSQL |
|---|---|
| INT | INTEGER |
| STRING | VARCHAR(n) COLLATE "C" |
| FLOAT | REAL with a finite-value CHECK |
| BOOLEAN | BOOLEAN |
| ENUM | TEXT COLLATE "C" with a named membership CHECK |
| DATE | DATE with the logical range CHECK |
| TIMESTAMP | TIMESTAMPTZ(0) with the logical range CHECK |
| UUID | UUID |

STRING capacity is the existing maximum of 255 and declared length bounds. Source ranges do not expand to native PostgreSQL ranges. Requiredness, typed static defaults, bounds and lengths are lowered independently. Referencing fields copy their key's physical type/collation/capacity, without its defaults, identity or source validation modifiers.

PostgreSQL VARCHAR assignment rejects excess non-space characters with `22001` (sanitized HTTP 400), but truncates excess characters when they are all spaces. For VARCHAR(255), 255 non-space characters store unchanged, 256 non-space characters reject, and 255 non-space characters followed by one or several excess spaces store just the 255 characters. Create responses echo the submitted string, so this edge case can produce a longer create echo than the independently stored value or later GET. HTTP applies declared MIN_LENGTH/MAX_LENGTH before the model: MAX_LENGTH 255 rejects that excess-space input before DB; a default STRING without a declared length bound permits the native assignment exception. Trusted direct models do not enforce scalar length bounds and leave assignment to PostgreSQL. The frozen VARCHAR representation is retained.

All tables/references use `"public"."OriginalName"`. Every identifier is double quoted and embedded quotes double. NUL, malformed Unicode, more than 63 UTF-8 bytes and exact system-column spellings (`tableoid`, `xmin`, `cmin`, `xmax`, `cmax`, `ctid`) are rejected. Quoted column comparison is exact, so `Value`, `value` and `Id` may coexist with an implicit `id`; portable route/file/helper collision rules still apply independently. Arbitrary direct-model property names undergo the same Unicode/NUL/byte checks before quoting; unknown valid names reach the database and fail normally if no column exists.

Compiler-owned names are `af_<kind>_<40 SHA256 hex>` from the JSON tuple `[profile, kind, stable owner ID, ordered field IDs, purpose]`. Frozen short tokens are `pk`, `uq`, `ck`, `fk`, `ix`, `seq`, `nn`; all names fit 63 bytes. Allocation reserves public tables, indexes and sequences together, including PK/UNIQUE backing indexes; constraint names also reserve their per-table namespace. Collisions reject without renaming. CREATE INDEX uses an unqualified quoted index name and a qualified table. Identity SEQUENCE NAME is schema qualified.

Admission covers identifier bytes/system columns, physical namespaces, 1600 table columns, 32 index parts, VARCHAR's 10,485,760-character declaration limit, literal/default representability, generated names, a conservative fixed-width heap feasibility check and PostgreSQL-specific full B-tree key width. The 2704-byte stock B-tree model reserves a 24-byte tuple header and rounds each worst-case datum to eight bytes; STRING uses four UTF-8 bytes per character plus varlena overhead. It may reject declarations whose particular values could fit. Variable-width heap values may use TOAST; this is not a general storage simulator. Remaining data-dependent failures are database-authoritative.

## Values, identity and sorting

ENUM labels preserve exact case, Unicode, apostrophes, literal backslashes, empty strings, leading/trailing spaces and declaration order. PostgreSQL accepts trailing-space members; MySQL retains `SEM036`. ENUM sorting uses CASE ordinals, with explicit ASC NULLS FIRST / DESC NULLS LAST. STRING and ENUM comparison use C collation, which differs from MySQL's `utf8mb4_unicode_ci` STRING behavior.

Generated integer keys use INTEGER GENERATED BY DEFAULT AS IDENTITY with an explicitly named sequence and PK. Omission and optional null generate; null is removed from a private SQL payload. REQUIRED null fails HTTP validation. Zero is stored as zero, positive supplied values are stored, and negative supplied generated keys fail HTTP validation. Safe integers outside INTEGER storage reach PG and produce sanitized 400. An implicit id remains an unknown HTTP write field; direct models may supply it, including zero or null for generation.

**Supplied integer values do not advance the identity sequence. A later generated value can collide and return 409. There is no automatic sequence reconciliation, `setval`, MAX+1 or retry.** Declared MIN/MAX on generated INT keys is supported only in PG; MySQL retains `SEM037`. PG OpenAPI intersects the declared range with nonnegative supplied-key policy. Generated values can later violate bounds and return 400; sequence start/range is unchanged.

UUID uses canonical lowercase 8-4-4-4-12 text of any version. No case normalization occurs. Runtime UUID identities use Node `crypto.randomUUID()` once for omission/optional null; REQUIRED null fails. Ordinary UUID fields never generate, and typed static defaults remain static. Paths, filters and declared writes validate before DB; returned UUID and UUID FKs validate before API use. No database UUID functions or extensions are required.

DATE stays within 1000-01-01 through 9999-12-31. TIMESTAMP stays within 1970-01-01T00:00:01Z through 2038-01-19T03:14:07Z, at seconds precision. Writes bind canonical strings, never user Date objects. Offsets/fractions/non-Z public timestamps reject. Native range CHECKs exclude infinity and expanded ranges. Pool-local public `getTypeParser` handlers for OIDs 1082/1184/1114 validate DATE text and deterministically convert numeric-offset timestamp text to UTC; other OIDs delegate to `pg.types`, including int8. Host timezone does not shift DATE.

## Generated runtime and setup

Projects retain seven fixed files plus three per entity, ordered as before. The generated package declares `dotenv`, `express`, `pg ^8.23.1`, Node >=18 and `npm start`; no lockfile is emitted. Set PORT, DB_HOST, DB_PORT (default 5432), DB_USER (default postgres), DB_PASSWORD and DB_NAME (default apiforge_db) using the environment template. Install dependencies, prepare a UTF8 database, then import and start:

```text
npm install
psql -h localhost -p 5432 -U postgres -d apiforge_db -v ON_ERROR_STOP=1 -f database/schema.sql
npm start
```

Each query acquires a connection, awaits UTC/ISO-YMD/standard strings/search_path `pg_catalog, public`/fixed application_name settings, checks the deployment profile, executes, then releases. Setup/query failures destroy the poisoned lease. Idle pool errors emit a fixed safe message. Configuration contains no mysql2 import.

The application role needs database CONNECT, public USAGE/CREATE and SELECT/INSERT/UPDATE/DELETE on every generated entity and junction table. The profile check binds the exact physical-plan table inventory and requires every exact, case-sensitive table to exist with those rights. Unrelated public tables are ignored and require no grants. Production config creates no roles/grants. Native identity INSERT works under a non-superuser application role without sequence grants; administrative catalog/error fixtures use a separate connection.

Per-statement `bind(value)` starts at `$1` for every CRUD, filter, count, pagination and relationship statement. Values are parameterized; arbitrary own create/update property names are validated and quoted. Empty create uses DEFAULT VALUES; empty update rereads. Direct models preserve trusted payloads, check declared UUID/temporal values and forbid any own identity update. Private copies handle generated keys without mutating callers.

INSERT RETURNING selects only the effective key. Generated integer identity resolution always uses the returned native INTEGER, including trusted direct inputs that PostgreSQL coerces. Create echoes submitted fields plus the resolved key, without exposing arbitrary defaults or synthetic fields through a reload. Updates retain reread/404 behavior. Deletes and model association removal return `rowCount > 0`; the existing association HTTP handler still returns 200 when removal finds nothing. Reads use rowMode array and trusted server field metadata with Object.fromEntries, preserving own `__proto__`, `constructor` and `prototype` data safely.

COUNT(*) remains int8 text; the count helper checks nonnegative decimal representation and Number.MAX_SAFE_INTEGER before conversion. No global int8 override or SQL integer cast is used. Filters, sort/order whitelists, pagination, headers and tie-breakers retain existing contracts; count/data queries remain separate reads.

ONE_TO_MANY and MANY_TO_ONE use nullable FKs with SET NULL; ONE_TO_ONE uses nullable UNIQUE with CASCADE; MANY_TO_MANY uses a composite-PK junction and two cascading FKs. All entity tables exist before FK additions, permitting cycles. Deterministic full B-tree indexes support FK referencing fields unless an existing full index supplies a leftmost prefix. ONE_TO_ONE reuses UNIQUE; a junction reuses its PK source prefix and adds target support.

## Sanitized database errors

| SQLSTATE / transport | Operation-sensitive result |
|---|---|
| 23505, 23503 | 409 for writes/deletes/associations; read 500 |
| 23502, 23514, 22P02, 22003, 22001, 22007, 22008, 22021 | 400 for value writes/associations; read/delete 500 |
| 08000, 08001, 08003, 08006, 08007, 40001, 40P01, 55P03, 53300, 57P01, 57P02, 57P03; ECONNREFUSED, ECONNRESET, EPIPE, ETIMEDOUT | 503 |
| Other/internal/configuration/permission errors | 500 |

G06's existing four fixed messages and `{success:false,error}` envelope are retained. No SQL, detail, constraints, schema/table/column internals, codes or credentials are exposed. 404 is model absence. Generic global Express errors do not gain DB provenance from a code; malformed JSON retains the existing sanitized 400. No retries occur.

## Boundaries and verification

G19 publishes a complete selected project atomically and preserves opaque user roots across MySQL/PG replacement. It does not switch a live installed project's database or reconcile its user-owned dependencies. G26 rejects an explicit PostgreSQL target before filesystem work.

Deferred: PostgreSQL migrations/snapshots/history, alternate schemas/search paths, browser selection, new DSL syntax/types, arrays/JSONB, native ENUM, database UUIDs/extensions, custom TLS setup, sequence reconciliation, retries, APPLY/DOWN/drift. Common accepted programs emit identical Swagger bytes; approved PG-only semantic differences can change their own schemas.

Run `npm run test:g27` for exact compatibility/selection/target policy and `npm run test:postgres-native` for gates B/C/D. Native tests use all four `APIFORGE_TEST_PG_HOST/PORT/USER/PASSWORD` variables when present, or create a uniquely owned loopback-only official PostgreSQL 18 Docker container. They create only owned disposable databases, pass credentials in memory/child environments, and clean servers, pools, ports, databases, projects and owned containers.

Native test credentials must permit administrator fixture setup, including creating/dropping guarded databases and owned LOGIN roles. Runtime/backend gates connect generated code as separate restricted application roles; administrator connections handle catalog, DDL and native error fixtures. Owned roles are dropped and their absence asserted in final cleanup. The native command also replays the reviewed-tip privilege failure and VARCHAR boundary observations through the pinned compiler loader.
