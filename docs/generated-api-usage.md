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
