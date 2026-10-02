# APIForge Language Guide

Verified against compiler baseline `96a1d34a80cfb21e4b5bdbaddf810dbef576f670`
on 2026-10-01. Implementation and tests are the authority for this guide.
See [audit evidence and reproduction commands](language-guide-verification.md).

## 1. Overview

APIForge describes entities, fields, constraints, literal defaults, and
relationships. It generates MySQL DDL, an Express backend using `mysql2/promise`,
and an OpenAPI 3.0.0 document.

Compilation runs through lexer, parser/AST, semantic analysis, IR generation,
optimization, and code generation. Successful compilation means target files
were generated; it does not mean a database was created or the backend was
deployed. Target limitations are described below.

The smallest valid declaration consists of one entity and one field:

<!-- example: valid smallest warnings=WRN001 -->
~~~apiforge
ENTITY Item
value STRING
~~~

This succeeds with WRN001 because there is no explicit primary key. For a
resource with consistent generated item operations, declare the key explicitly:

<!-- example: valid explicit-minimal -->
~~~apiforge
ENTITY Item
id INT PRIMARY KEY
~~~

Save a complete program in a file, then run `node index.js <file.apiforge>`.
The CLI writes under `output/` relative to its working directory.
`npm run compile` compiles `samples/student.apiforge`; `npm run dev` starts the
compiler playground. The compiler HTTP API returns generated files in memory.
For backend setup, follow the generated README.md.

## 2. Lexical Syntax

### Identifiers and case

Identifiers match `[A-Za-z_][A-Za-z0-9_]*`. ASCII letters and underscores may start
a name; subsequent characters may also be decimal digits. Unicode letters,
hyphens, dots, quoted identifiers, and digit-first names are not identifier syntax.
`1name` produces LEX002; unsupported characters produce LEX001.

Entity, field, and relationship names are case-sensitive. Generated allocations
must also be distinct: SEM034 rejects Student/student, Foo/FOO, resource-path
collisions such as Category/Categorie, case-distinct physical columns and Windows
device model filenames. No suffix or public route rename is applied.
Prototype-sensitive names such as __proto__, constructor, toString, entities and
relations remain legal when their generated allocations are distinct. Own-key
registries preserve them through symbols, the playground and OpenAPI.
SEM034 also rejects relationship allocations that duplicate FK columns, junction
tables, constraints, helpers or API paths, including overlaps with declared
columns/tables and CRUD handlers. Different relation names do not create different
physical storage or routes for an otherwise identical endpoint pair. SQL identifiers
use the same quoting authority in DDL and all relationship helpers; values stay bound.
PascalCase entities and simple field names are conventions, not grammar rules.

These exact uppercase words are reserved:

| Category | Words |
|---|---|
| Declarations | `ENTITY`, `RELATION` |
| Datatypes | `INT`, `FLOAT`, `BOOLEAN`, `STRING`, `ENUM` |
| Modifiers | `PRIMARY`, `KEY`, `REQUIRED`, `UNIQUE`, `DEFAULT`, `MIN`, `MAX`, `MIN_LENGTH`, `MAX_LENGTH` |
| Boolean literals | `TRUE`, `FALSE` |
| Cardinalities | `ONE_TO_ONE`, `ONE_TO_MANY`, `MANY_TO_ONE`, `MANY_TO_MANY` |

Lowercase spellings are ordinary identifiers. They can be names in suitable
positions but do not act as keywords or datatypes. A reserved entity name such
as INT fails at the parser (PAR001); a reserved word in field-name position
normally produces PAR009. Reserved ENTITY/RELATION tokens instead delimit
declarations. The analyzer also checks reserved names for direct AST consumers
(SEM003, SEM006, SEM025).

### Whitespace, punctuation, and comments

Spaces, tabs, carriage returns, and line feeds separate tokens and are discarded.
Indentation and newlines do not delimit fields. A leading UTF-8 BOM is stripped.
An entity's field list ends at ENTITY, RELATION, or EOF.

`//` starts a comment through the next line feed or EOF, including after a
declaration. `//` inside a quoted string is ordinary text. Block comments and
`#` comments are unsupported. Only `(`, `)`, and `,` have punctuation tokens,
used by ENUM; braces, colons, semicolons, and assignment operators are not grammar.

This is a complete program despite being on one line:

<!-- example: valid compact -->
~~~apiforge
ENTITY Item id INT PRIMARY KEY label STRING // trailing comment
~~~

### Literal syntax

| Literal | Source form | Details |
|---|---|---|
| Number | `-?[0-9]+(\.[0-9]+)?` | Examples: `0`, `007`, `-12`, `8.5`, `-0.25`. No leading plus, exponent, hex, leading dot, or trailing dot. |
| String | Double quotes around text | Empty text is allowed. A line feed or EOF before the closing quote produces LEX003. |
| Boolean | `TRUE` or `FALSE` | Lowercase true/false are not boolean literal tokens. |

Numbers become JavaScript numbers through parseFloat. Integral decimal values
such as 1.0 satisfy integer checks; checks concern the parsed value.
The compiler does not generally enforce MySQL storage limits or safe-integer
precision on DSL literals. Use representable values; do not infer the collection
query's stricter numeric rules apply to source literals.

Strings have **no escape syntax**. Backslashes are literal characters:
`"C:\folder"` contains a backslash and `"line\n"` contains backslash followed by
n. `\"` does not embed a quote: the quote terminates the token. Apostrophes,
Unicode text, commas, and parentheses are allowed inside double quotes.
SQL/JSON output escaping is separate from DSL string syntax.

## 3. Entity Declarations

The parser grammar, with `*` meaning zero or more, is:

~~~text
Program    := (EntityDecl | RelationDecl)*
EntityDecl := ENTITY Identifier FieldDecl*
~~~

Semantic analysis requires at least one entity (SEM001), at least one field in
every entity (SEM004), and globally unique entity names (SEM002). The parser
alone can build an empty Program or an empty Entity.

Relationships may precede or appear between entities. Endpoint resolution checks
the whole program, so forward references work:

<!-- example: valid forward-reference -->
~~~apiforge
RELATION Student ENROLLS_IN Course MANY_TO_MANY
ENTITY Student
id INT PRIMARY KEY
ENTITY Course
code STRING PRIMARY KEY
~~~

Fields after a relationship need a new ENTITY declaration; there is no
reopening/extension syntax for an existing entity.

## 4. Field Declarations

~~~text
FieldDecl := Identifier DataType Modifier*
DataType  := INT | FLOAT | BOOLEAN | STRING | ENUM "(" String ("," String)* ")"
Modifier  := PRIMARY KEY | REQUIRED | UNIQUE
           | DEFAULT Literal
           | MIN Number | MAX Number
           | MIN_LENGTH Number | MAX_LENGTH Number
Literal   := Number | String | TRUE | FALSE
~~~

Number and String refer to the lexical forms in section 2. Grammar notation
is not literal source syntax. A datatype is mandatory and modifiers are optional.
Each field name must be unique within its entity (SEM005); another entity may
reuse the same field name.

Modifiers may appear in any order after the datatype. PRIMARY KEY requires
adjacent PRIMARY and KEY tokens, although ignored whitespace/comments may occur
between them. Constraints, each bound kind, and DEFAULT may each appear at most
once. Repetition is a semantic error even when values are identical; the
optimizer does not make duplicate DSL declarations legal.

<!-- example: valid modifier-order -->
~~~apiforge
ENTITY Item
id INT UNIQUE REQUIRED PRIMARY KEY
label STRING DEFAULT "ready" MAX_LENGTH 20 REQUIRED MIN_LENGTH 2 UNIQUE
~~~

## 5. Datatypes

| Type | Allowed modifiers | SQL | OpenAPI property type |
|---|---|---|---|
| INT | PRIMARY KEY, REQUIRED, UNIQUE, DEFAULT, MIN, MAX | INT | integer |
| FLOAT | REQUIRED, UNIQUE, DEFAULT, MIN, MAX | FLOAT | number |
| BOOLEAN | REQUIRED, UNIQUE, DEFAULT | BOOLEAN | boolean |
| STRING | PRIMARY KEY, REQUIRED, UNIQUE, DEFAULT, MIN_LENGTH, MAX_LENGTH | VARCHAR(255) or wider | string |
| ENUM(...) | REQUIRED, UNIQUE, member DEFAULT | Native ENUM(...) | string with enum |

### INT

INT defaults and numeric bounds must have integer values. Fractional bounds
produce SEM019; non-integer or non-number defaults produce SEM021.
Negative values and one-sided bounds are allowed. Length bounds produce SEM016.

<!-- example: valid datatype-int -->
~~~apiforge
ENTITY Counter
id INT PRIMARY KEY
delta INT REQUIRED MIN -10 MAX 10 DEFAULT 0
integralDecimal INT DEFAULT 1.0
~~~

### FLOAT

FLOAT accepts integer or decimal defaults and numeric bounds. It cannot be a
primary key (SEM011); length bounds produce SEM016, and non-number defaults
produce SEM021.

<!-- example: valid datatype-float -->
~~~apiforge
ENTITY Measurement
id INT PRIMARY KEY
temperature FLOAT MIN -40.5 MAX 100 DEFAULT 20.25
~~~

### BOOLEAN

BOOLEAN defaults use TRUE or FALSE. Numeric defaults, including 0/1, are
invalid (SEM021). PRIMARY KEY, numeric bounds, and length bounds produce
SEM011, SEM015, and SEM016 respectively.

<!-- example: valid datatype-boolean -->
~~~apiforge
ENTITY Flag
id INT PRIMARY KEY
enabled BOOLEAN REQUIRED DEFAULT TRUE
~~~

### STRING

STRING defaults are double-quoted literals. PRIMARY KEY and STRING length bounds
may be combined. Numeric bounds are invalid (SEM015); non-string defaults are
invalid (SEM021).

SQL capacity is `max(255, declared MIN_LENGTH, declared MAX_LENGTH)`, considering
bounds that exist. MAX_LENGTH 20 still uses VARCHAR(255) with a length
check; MAX_LENGTH 500 widens it to VARCHAR(500). A larger MIN_LENGTH alone
also widens capacity. There is no general compile-time check of physical MySQL
column/key limits. Without a length modifier, no controller string-length/type
check is generated for an ordinary STRING field.

<!-- example: valid datatype-string -->
~~~apiforge
ENTITY Article
slug STRING PRIMARY KEY MIN_LENGTH 1 MAX_LENGTH 80
body STRING MAX_LENGTH 500
title STRING REQUIRED DEFAULT "Untitled"
~~~

### ENUM

ENUM requires an inline list rather than a named enum definition. See section 8
for exact syntax, invalid combinations, and target differences.

<!-- example: valid datatype-enum -->
~~~apiforge
ENTITY Account
id INT PRIMARY KEY
status ENUM("active", "closed") DEFAULT "active"
~~~

## 6. Primary Keys

An entity may declare at most one PRIMARY KEY field (SEM010). Only INT and
STRING are permitted (SEM011). PRIMARY KEY may coexist with REQUIRED, UNIQUE,
applicable bounds, and a type-correct DEFAULT. Repeating the same constraint
produces SEM009. PRIMARY without KEY produces PAR014; standalone KEY
produces PAR015. Composite entity keys have no DSL syntax.

<!-- example: valid primary-key-policies -->
~~~apiforge
ENTITY AutoRecord
id INT PRIMARY KEY
ENTITY FixedRecord
id INT PRIMARY KEY DEFAULT 1
ENTITY NamedRecord
code STRING PRIMARY KEY REQUIRED MAX_LENGTH 80
~~~

| Declaration | Generated SQL behavior |
|---|---|
| INT PRIMARY KEY without DEFAULT | PRIMARY KEY AUTO_INCREMENT |
| INT PRIMARY KEY with DEFAULT | PRIMARY KEY DEFAULT value; no AUTO_INCREMENT |
| STRING PRIMARY KEY | PRIMARY KEY; no AUTO_INCREMENT |
| No explicit PRIMARY KEY | Prepends id INT PRIMARY KEY AUTO_INCREMENT |

No explicit key is required for semantic validity. Each valid entity without one
receives semantic WRN001. The injected ID is a target detail, absent from AST,
source field symbols, IR, and optimized IR. One code-generation effective key
authority selects the declared PRIMARY KEY or generated id/INT. SQL, item CRUD,
source/target relationship helpers, collection filtering/sorting/pagination and
OpenAPI identity metadata all consume it. Item lookup/update/delete and the
post-update reread use WHERE id = ? for implicit keys. A normal create with id
omitted returns the database insertId as id and preserves submitted fields.

OpenAPI components include implicit id as integer with readOnly: true; it is
never added to required request input. Model fields remain source-declared;
query/read metadata includes the generated identity. PUT remains a partial update.
Caller-supplied implicit id is rejected on POST/PUT with HTTP 400 before model
access; it is generated read identity, not a source-declared writable field.
Create identity is resolved once in the generated model, in this order:

1. A supplied own source-declared primary-key value in sanitized POST data wins,
   including an explicit INT AUTO_INCREMENT value supplied by the caller.
2. Otherwise a database auto-generated effective key uses result.insertId.
3. Otherwise an explicit primary key with DEFAULT uses that typed declared value.
4. Otherwise the database remains authoritative; no response key is invented.

Thus omitted implicit/explicit auto-generated INT keys return insertId, omitted
INT DEFAULT 7 returns 7, and omitted STRING DEFAULT "seed" returns "seed".
A supplied explicit STRING key preserves its spelling and value. Resolution
does not assume the primary key is the first field. The response copies submitted
fields, then safely defines the resolved own key; it does not mutate input or
reload other database defaults. Native MySQL modes for caller-supplied
AUTO_INCREMENT values remain a separate database verification concern.

PUT is partial and takes resource identity from the URL :id. Source-declared
primary-key fields are immutable: supplying the field, even with the same value,
null or an invalid type, returns HTTP 400 before model access with
`Field '<key>' is immutable.` Validation checks body shape, unknown own keys,
key immutability, then declaration-order presence/null/type/bounds, returning only
the first error. Implicit id retains its unknown-field rejection. A non-key PUT
updates and rereads using the original URL key; an empty PUT only rereads it.
Generated models also reject own effective-key properties before update SQL,
using the same generated policy and error wording.

Without an explicit PRIMARY KEY, a declared id, Id, ID or iD collides with the
case-insensitive MySQL column allocation and fails semantic analysis with SEM033
at that field name. Its hint is: Declare an explicit PRIMARY KEY or rename the
conflicting field. This invalid entity receives no WRN001 and later phases are
skipped. An explicit key permits ordinary id-like fields; none are promoted or
renamed. Normal implicit entities retain the same WRN001 wording and location.

## 7. Field Modifiers and Constraints

### PRIMARY KEY

Selects the key field as described in section 6. The parser stores the two-token
source spelling as PRIMARY_KEY internally; PRIMARY_KEY is not DSL syntax.
SQL enforces key uniqueness; OpenAPI does not automatically put the key in its
required array unless REQUIRED is written and omission cannot be supplied by
a declared DEFAULT or auto-generated key. Explicit source-declared keys remain
accepted on POST; submitting one on PUT returns HTTP 400 because keys are immutable.
PRIMARY KEY without REQUIRED, DEFAULT or generation does not itself require
presence on POST. An omitted non-REQUIRED STRING key may still reach and fail at
the database; validation does not invent a key or perform a uniqueness precheck.

### REQUIRED

Allowed on every supported datatype. Emits SQL NOT NULL. POST rejects an omitted
REQUIRED field unless it has DEFAULT or is a database-generated auto-increment
primary key. OpenAPI's required array reflects that POST presence rule.
PUT is partial: omitted REQUIRED fields retain their current values.
Supplied REQUIRED null is rejected for every datatype before model access.
REQUIRED does not mean non-empty text; use MIN_LENGTH for that.

### UNIQUE

Allowed on every supported datatype. Emits SQL UNIQUE. There is no generated
pre-insert uniqueness query or OpenAPI uniqueness property. Database errors are
caught through the normal controller error path.

<!-- example: valid required-unique -->
~~~apiforge
ENTITY Member
id INT PRIMARY KEY
email STRING REQUIRED UNIQUE MIN_LENGTH 1
badge ENUM("silver", "gold") UNIQUE
enabled BOOLEAN REQUIRED
~~~

### DEFAULT

Syntax is DEFAULT literal, once per field. The parser accepts a number,
double-quoted string, or uppercase boolean; absence/wrong token produces
PAR020. Semantic analysis checks datatype (SEM021), duplicates (SEM020),
numeric range (SEM022), STRING length (SEM023), and ENUM membership
(SEM032). INT requires an integer, FLOAT a number, BOOLEAN a boolean, STRING
a string, and ENUM a string member.

Defaults emit SQL DEFAULT and OpenAPI default. Express does not insert
default values into request bodies or reload the inserted record for create
responses. Omitted insert fields are left to MySQL; the response resolves an
omitted defaulted primary key from typed DEFAULT metadata as described in section
6, while other omitted defaults may remain absent. Omitted PUT fields retain
their existing values; PUT does not reset them to defaults. STRING SQL-backslash
default escaping remains the separate G15 target limitation.

### MIN

Syntax: `MIN <number>`. Sets an inclusive lower bound on INT/FLOAT.
The numeric operand is required; a missing/wrong token produces PAR016.

### MAX

Syntax: `MAX <number>`. Sets an inclusive upper bound on INT/FLOAT.
The numeric operand is required; a missing/wrong token produces PAR017.

Each takes a number and applies only to INT/FLOAT (SEM015 otherwise).
Each may appear independently, once per kind (SEM012 for repetition).
INT bounds must be integers (SEM019). MIN must not exceed MAX (SEM017).
Bounds are inclusive; defaults must satisfy them (SEM022).

MIN/MAX emit SQL CHECK comparisons, supplied-value controller comparisons, and
OpenAPI minimum/maximum. Missing numeric operands produce PAR016/PAR017.
SEM013 covers nonnumeric bounds supplied through direct AST objects.

<!-- example: valid numeric-bounds -->
~~~apiforge
ENTITY Score
id INT PRIMARY KEY
points INT MAX 100 MIN 0 DEFAULT 50
adjustment FLOAT MIN -2.5
~~~

### MIN_LENGTH

Syntax: `MIN_LENGTH <number>`. Sets an inclusive lower STRING code-point bound.
The operand must have a non-negative integer value; missing/wrong token is PAR018.

### MAX_LENGTH

Syntax: `MAX_LENGTH <number>`. Sets an inclusive upper STRING code-point bound.
The operand must have a non-negative integer value; missing/wrong token is PAR019.

Each takes a non-negative integer value and applies only to STRING (SEM016
otherwise). Zero is valid. Negative/fractional values produce SEM014.
Each kind may occur once (SEM012); MIN_LENGTH must not exceed MAX_LENGTH
(SEM018). STRING defaults must satisfy the bounds (SEM023).

Semantic/default and Express lengths count Unicode code points using
`Array.from(value).length`, not bytes or grapheme clusters. SQL emits CHAR_LENGTH
checks; OpenAPI uses minLength/maxLength. SQL storage widens as in section 5.
Missing operands produce PAR018/PAR019.

<!-- example: valid length-bounds -->
~~~apiforge
ENTITY Label
id INT PRIMARY KEY
text STRING MIN_LENGTH 1 MAX_LENGTH 2 DEFAULT "😀"
optional STRING MIN_LENGTH 0
~~~

## 8. ENUM

~~~text
Identifier ENUM "(" String ("," String)* ")" Modifier*
~~~

Quoted punctuation denotes literal tokens. A declaration requires at least one
quoted string, commas between members, and a closing parenthesis.
Values are unique and case-sensitive; declaration order survives AST, symbols,
IR, optimization, SQL, and OpenAPI. Empty string members are allowed; an empty
list is not. Whitespace/comments may separate tokens, including across lines.

<!-- example: valid enum-details -->
~~~apiforge
ENTITY Choice
id INT PRIMARY KEY
value ENUM(
    "active", // case-distinct members are allowed
    "ACTIVE",
    "",
    "O'Reilly",
    "C:\folder"
) REQUIRED UNIQUE DEFAULT "active"
~~~

DEFAULT must be a quoted exact member. No unquoted enum constants or reusable
named enum type declarations exist. The same literal backslash/no-escape rules
as ordinary strings apply.

| Invalid condition | Phase / public code |
|---|---|
| Missing opening parenthesis, empty list, unquoted/non-string member, missing member after comma | Parser PAR001 |
| Missing comma or closing parenthesis after a member | Parser PAR022 |
| Duplicate exact member | Semantic SEM031 |
| String DEFAULT outside the set (including wrong case) | Semantic SEM032 |
| Non-string DEFAULT | Semantic SEM021 |
| PRIMARY KEY | Semantic SEM011 |
| MIN or MAX | Semantic SEM015 |
| MIN_LENGTH or MAX_LENGTH | Semantic SEM016 |
| Malformed direct AST value array | Semantic SEM030 (the source parser already rejects malformed lists) |

SQL uses native `ENUM(...) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`.
Apostrophes are doubled in SQL literals. ENUM members/defaults also double
literal backslashes, assuming MySQL's normal backslash-escaping mode.
Ordinary STRING defaults only double apostrophes; their legacy backslash
handling is different. Generated JavaScript/JSON represents ENUM values using
JSON escaping without changing the DSL values.

Native MySQL behavior remains relevant: trailing spaces in declared members are
removed, strict SQL mode affects direct database rejection, numeric indexes can
be used by direct database writers, and ENUM sorting follows declaration
indexes. These are target rules, not additional accepted DSL syntax.
See the [MySQL ENUM reference](https://dev.mysql.com/doc/refman/8.4/en/enum.html).
Prefer members without trailing spaces.

Generated POST/PUT validation rejects supplied non-strings and nonmembers before
model calls. Optional null is allowed; REQUIRED ENUM rejects supplied null.
POST requires omitted REQUIRED ENUM unless DEFAULT supplies it; PUT permits
omission. OpenAPI preserves type string, the ordered enum array and optional
default; required reflects POST presence. Optional null is not fully represented
by the reused OpenAPI components (G11 remains separate).

## 9. Relationships

~~~text
RelationDecl := RELATION SourceIdentifier RelationIdentifier TargetIdentifier Cardinality
Cardinality  := ONE_TO_ONE | ONE_TO_MANY | MANY_TO_ONE | MANY_TO_MANY
~~~

Both endpoints must be declared somewhere in the program (SEM028 source,
SEM029 target). Names resolve case-sensitively. Relationship names are globally
unique (SEM024) and cannot be reserved. A relationship cannot connect an entity
to itself (SEM027). Missing/invalid cardinality is a parser error
(PAR010/PAR011). An explicit endpoint key is not semantically mandatory;
implicit endpoints consistently use the generated integer id described in section 6.

For source S, target T, and their key fields, foreign-key column names use the
entity name with only its first character lowercased, followed by an underscore
and the referenced key name. STRING key foreign keys retain the generated
VARCHAR capacity. Entity tables are emitted before relationship DDL.

| Cardinality | Generated storage | Generated source-router operation |
|---|---|---|
| ONE_TO_ONE | Nullable, UNIQUE S-key column on T; FK references S, ON DELETE CASCADE | GET singular T |
| ONE_TO_MANY | Nullable S-key column on T; FK references S, ON DELETE SET NULL | GET list of T |
| MANY_TO_ONE | Nullable T-key column on S; FK references T, ON DELETE SET NULL | GET singular T |
| MANY_TO_MANY | S_T junction table; two NOT NULL FK columns, composite PK, both ON DELETE CASCADE | GET list, POST association, DELETE association |

ONE_TO_ONE enforces at most one target per non-null source key; it does not
require every source record to have a target. The DSL cannot customize
nullability, referential actions, foreign-key names, or relationship column names.

Relationship routes are generated on the source only. Path segments and
handler names derive from T, not the relationship name. SQL-added FK columns
do not become source DSL fields or OpenAPI component properties. Apart from
MANY_TO_MANY association routes, no dedicated linking/unlinking endpoint is
generated. See section 12 for paths and section 13 for all four forms.

Different relationship names must also have distinct generated allocations.
SEM034 rejects duplicated junction tables, FK columns, handlers, routes or
OpenAPI paths before IR generation, including overlaps with declared constructs.

## 10. Defaults and Validation

Compile-time validation checks declarations and literal defaults. Runtime
validation checks supplied request data. The generated OpenAPI schema is
documentation; the server does not load a schema validator.

| Rule | Compile time | Generated POST/PUT | SQL / OpenAPI |
|---|---|---|---|
| Default type/range/length/membership | Enforced by semantics | No default injection | DEFAULT / default |
| Numeric MIN/MAX | Type/range consistency, inclusive default check | Typed finite values, inclusive comparisons | CHECK / minimum, maximum |
| STRING length | Non-negative integer bounds and code-point default length | String type and code-point length | CHAR_LENGTH CHECK / minLength, maxLength |
| ENUM membership | Unique members and exact default membership | Exact case-sensitive member string | Native ENUM / ordered string enum |
| REQUIRED | Valid modifier; duplicate rejected | POST presence unless DEFAULT/generated key; supplied null rejected; PUT partial | NOT NULL / POST required array |
| UNIQUE / key | Valid declaration/type; duplicate rejected | No uniqueness precheck; declared PK write acceptance preserved | Database constraint; no OpenAPI uniqueness marker |

POST/PUT require JSON objects. Unknown own properties, synthetic implicit id,
and SQL-added relationship FK properties are rejected. The controller forwards a
new object containing only approved supplied source fields, never raw req.body.
Inherited properties do not authorize writes. JSON parsing retains its usual
last-key behavior for duplicate properties; duplicate detection is not added.

Non-null supplied INT must be a JavaScript number, finite and a safe integer.
FLOAT must be a finite number (integer-valued numbers accepted); BOOLEAN a
boolean; STRING a string even without length bounds; ENUM an exact member string.
No JSON scalar coercion is performed. Optional null is accepted; REQUIRED null
is rejected. MIN/MAX remain inclusive; STRING length uses Array.from(value).length.
Safe-integer validation does not enforce MySQL's INT32 range. Physical numeric
capacity and other database target limits remain separate work.

POST REQUIRED omission is rejected unless DEFAULT or an auto-increment primary
key supplies it. DEFAULT values are never injected in Express: POST omission lets
MySQL apply defaults, and PUT omission retains stored values. Empty POST is valid
when required values can be supplied; its model uses a database default-row insert.
PUT remains partial and an empty object returns the current record.

Validation returns HTTP 400 with `{ "success": false, "error": "<message>" }`.
Only the first error is returned: body shape; unknown own keys in received
Object.keys order; fields in declaration order, each checking POST required
omission, required null, datatype, then MIN/MAX/length/membership. ENUM type and
membership share their existing exact-member message. Strict Express JSON
parsing rejects scalar JSON before the controller and emits a sanitized 400;
arrays reach the controller shape check. Malformed JSON also returns sanitized
400 in the generated backend. The separate compiler API retains 500/INP002.

POST/PUT database failures return HTTP 500 with `Unable to create item.` or
`Unable to update item.` instead of private SQL/driver messages. UNIQUE remains
database-enforced without a race-prone precheck; duplicate-key failures are not
mapped to 409. Item GET, DELETE and relationship error semantics are unchanged.
Explicit PK creation/default semantics (G12) and mutation (G13) remain separate.

## 11. Diagnostics

Public error codes have a prefix and three digits. The registry contains
62 errors: LEX001–LEX004, PAR001–PAR022, SEM001–SEM033, INP001–INP002, and INT001.
The symbolic identifier is separate: a semantic compatibility error may have
`code: "DUPLICATE_FIELD"`, while its nested diagnostic has `code: "SEM005"`.
Do not confuse the legacy symbolic code with the public code.

~~~json
{
  "phase": "semantic",
  "code": "SEM017",
  "severity": "error",
  "message": "MIN value 60 cannot be greater than MAX value 18.",
  "symbol": "MIN_EXCEEDS_MAX",
  "line": 2,
  "column": 9,
  "endLine": 2,
  "endColumn": 15,
  "hint": "MIN must not exceed MAX."
}
~~~

Positions are 1-based; end ranges are exclusive. Unknown starts are null.
Unavailable ranges and hints are omitted. Lexer/parser errors stop immediately;
semantics collects errors, then the pipeline stops before IR/codegen.
See [the full diagnostic registry](structured-diagnostics.md).

Warnings use the same shape with severity warning and a separate collection:

| Code | Symbol / phase | Actual condition |
|---|---|---|
| WRN001 | IMPLICIT_PRIMARY_KEY / semantic | Each otherwise valid entity without an explicit key; SQL injects integer id. |
| WRN002 | CONFLICTING_FIELD / optimizer | Direct-IR repeated entity/field with differing type, ENUM members/order, constraints, validations, or default; both remain. |
| WRN003 | CONFLICTING_RELATION_TYPE / optimizer | Direct-IR same relationship name/endpoints but different cardinality; both remain. |
| WRN004 | CONFLICTING_RELATION_ENDPOINTS / optimizer | Direct-IR same relationship name but different endpoints; both remain. |
| WRN005 | INVALID_IR / optimizer | Non-object/missing-instructions-array fallback; returns input unchanged with no optimizations. |

WRN002–WRN005 describe direct optimizer inputs, not permission to write conflicting
DSL. Ordinary duplicate declarations fail semantics; exact IR duplicates may be
removed without warnings. Invalid-IR fallback does not establish that later
codegen can succeed. No ENUM-specific or style warning exists.

Warnings are ordered by compiler phase, line, column, then code; unavailable
positions sort after known ones. Ties preserve emission order. They do not change
semantic validity or generated contents. Warning-only CLI compilation exits 0;
compiler HTTP success remains 200 with six succeeded phases. API warnings is
an array of diagnostic objects, including an empty array when none exist.

The repository compiler endpoint is `POST /api/compile`, distinct from generated
resource routes. Missing/non-string source (INP001) and lexer/parser failures
return 400; semantic failures return 422; internal failures use safe INT001 with
500. Malformed JSON retains the existing 500/INP002 behavior. Empty, blank, and
comment-only strings reach semantic SEM001. The CLI exits 1 for compiler failures.

## 12. Generated API Behavior

This section describes emitted backend behavior, not additional DSL syntax.

### Files and naming

Generation returns seven fixed files plus three per entity:

~~~text
database/schema.sql
config/db.js
.env.example
package.json
README.md
server.js
swagger.json
models/<Entity>.js
controllers/<lowerFirstEntity>Controller.js
routes/<lowerFirstEntity>Routes.js
~~~

Entity SQL names retain spelling; the general SQL identifier helper quotes its
recognized MySQL reserved words. Model filenames retain entity spelling.
Controller/router filenames lowercase only the first letter. Resource routes
lowercase the whole entity name and pluralize: consonant+y becomes ies; endings
s/ch/sh/x add es; otherwise add s. Examples: Student → students, Category →
categories, Box → boxes, Person → persons. There is no irregular-noun dictionary.
All relationship DDL and model queries use the shared identifier-quoting helper;
request values remain bound separately from SQL identifiers.

The CLI reconciles generator-owned models/controllers/routes/config/database
directories; root user files such as output/.env are preserved. Generated
dependencies are dotenv, express, and mysql2. No lockfile, live .env, or
automatic database/schema bootstrap is emitted. /health checks the server.
The server does not serve Swagger UI or swagger.json.

### CRUD and responses

For Student, the server mounts directly at /students:

| Method | Path | Success | Typical failure |
|---|---|---|---|
| GET | `/students` | 200, success/data array | 400 invalid query; 500 DB error |
| GET | `/students/:id` | 200, success/data record | 404 absent; 500 DB error |
| POST | `/students` | 201, success/data result | 400 generated validation; 500 DB error |
| PUT | `/students/:id` | 200, success/data refreshed record | 400 generated validation; 404 absent; 500 DB error |
| DELETE | `/students/:id` | 200, success/message | 404 absent; 500 DB error |

There is no /api prefix on generated resource routes. Path parameters remain
named id even for a differently named STRING primary key. Models bind request
values with mysql2 placeholders/object binding. PUT with an empty payload looks
up the existing record. A supplied explicit primary-key field in PUT returns
400 before model access. Create returns submitted data plus the resolved key
described in section 6, without re-reading arbitrary database defaults.

### Collection GET queries

Only collection GET supports these options. Item GET, writes, and relationship
routes do not apply collection-query validation or filtering.

For the Student program in section 13:

~~~text
GET /students?age=21
GET /students?status=active&active=false
GET /students?sort=name&order=desc
GET /students?page=2&limit=20
GET /students?status=active&age=21&sort=name&order=desc&page=2&limit=10
~~~

Known fields (plus implicit integer id when needed) support SQL equality.
Multiple filters use AND in declaration order. SQL-added relationship FK columns
are not automatically included in the query whitelist. Write bounds/defaults
are not reapplied to filters.

| Filter datatype | Accepted decoded HTTP string |
|---|---|
| INT | Optional minus followed by digits, converting to a safe integer; leading zeros allowed. No plus, whitespace, decimals, or exponents. |
| FLOAT | Finite signed decimal/exponent; .5, +3.2, 1e-3 work. URL-encode a literal plus as %2B. No whitespace, hex, NaN, Infinity, or overflow. |
| BOOLEAN | Exactly lowercase true or false. |
| STRING | Raw text, including empty strings; equality follows SQL column collation. |
| ENUM | Exact declared member, case-sensitive; empty only if declared. |

No special NULL filter exists: STRING null is text; ENUM null must be a declared
member. Wildcard/contains, ranges, OR, and nested relationship filters have no
query syntax.

`sort=<field>` must name a known field. order accepts lowercase asc/desc,
defaults to asc, and requires sort. No automatic ordering occurs without sort
or pagination. Sorting does not by itself enable pagination.

Either page or limit enables pagination, with defaults page=1, limit=20,
and maximum limit=100. Each must use positive decimal digits with no leading
zeros; page/limit and `(page-1)*limit` must be safe integers. Pagination without
sort orders by primary key ASC. Sorting a different field adds primary key ASC
as a tie-breaker.

Success always preserves `{ "success": true, "data": [...] }`. Pagination adds
X-Total-Count, X-Page, X-Limit, X-Total-Pages headers. Count uses the same
filters. Zero matches means zero total pages; beyond-last pages have empty data.
Data and count are separate SQL reads, so concurrent writes can affect agreement.
Without page/limit, results are unbounded and there is no COUNT query.

page, limit, sort, order are reserved control names. Fields with those
names may be sorted but cannot be filtered. Unknown keys, repeated/non-string
values, invalid datatype values, and invalid sorting/pagination return 400
before any DB query. Collection DB failures return sanitized 500 error
`Unable to retrieve collection.`. Filter values, limit, and offset are bound
parameters; column names and direction tokens come from trusted whitelists.

### Relationship routes

| Cardinality/example | Routes |
|---|---|
| Student → Course MANY_TO_MANY | GET `/students/:id/courses`; POST/DELETE `/students/:id/courses/:courseId` |
| Department → Employee ONE_TO_MANY | GET `/departments/:id/employees` |
| Invoice → Customer MANY_TO_ONE | GET `/invoices/:id/customer` |
| User → Profile ONE_TO_ONE | GET `/users/:id/profile` |

Singular target segments lowercase only the first character (AccountProfile →
accountProfile). List routes return success/data arrays, singular routes return
success/data records or 404, association POST returns 201 with success/data,
and association DELETE returns 200 with success/message. Association DELETE's
controller does not turn a missing association into 404.

### OpenAPI

swagger.json describes CRUD/relationship paths at the root, shared POST/PUT
entity schemas, POST required arrays, defaults, numeric/length bounds, ENUM members,
typed collection filters, sort/order controls, pagination bounds and conditional
headers. Path parameter type follows the owning explicit key (INT → integer,
STRING → string), or implicit integer id.

The generated specification is not a complete runtime response contract: most
CRUD responses have descriptions only, and relationship response schemas describe
the related array/object without modeling its success/data envelope. Component
schemas include implicit integer IDs with readOnly: true, omit SQL-added
relationship columns, and are reused for PUT despite the runtime's omitted-field
tolerance. Write schemas reject additional properties and exempt defaulted/generated keys
from POST presence requirements. PUT still reuses the schema despite partial
updates and may still expose an explicit key generically despite PUT immutability;
nullable response/write modeling remains incomplete (G11). No operation-specific
schema hierarchy was introduced for the primary-key contract.

## 13. Complete Examples

All apiforge blocks are complete valid programs. They were compiled through all
six real phases and their generated JavaScript was parsed. Invalid programs are
tabulated separately in section 14. Syntax templates above use text fences.

### All field datatypes and collection-query fields

<!-- example: valid student-complete -->
~~~apiforge
ENTITY Student
id INT PRIMARY KEY
name STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
email STRING UNIQUE
age INT MIN 18 MAX 65 DEFAULT 21
cgpa FLOAT MIN 0 MAX 10 DEFAULT 8.5
active BOOLEAN DEFAULT TRUE
status ENUM("active", "inactive", "suspended") DEFAULT "active"
~~~

### STRING primary key and enum constraints

<!-- example: valid account-complete -->
~~~apiforge
ENTITY Account
code STRING PRIMARY KEY REQUIRED MIN_LENGTH 3 MAX_LENGTH 40
email STRING REQUIRED UNIQUE
role ENUM("student", "faculty", "admin") REQUIRED DEFAULT "student"
enabled BOOLEAN DEFAULT FALSE
~~~

### All relationship cardinalities

Distinct endpoint pairs avoid generated naming collisions:

<!-- example: valid relationships-complete -->
~~~apiforge
ENTITY User
id INT PRIMARY KEY
username STRING REQUIRED UNIQUE
ENTITY Profile
id INT PRIMARY KEY
bio STRING MAX_LENGTH 500
ENTITY Department
code STRING PRIMARY KEY MAX_LENGTH 40
name STRING REQUIRED
ENTITY Employee
id INT PRIMARY KEY
name STRING REQUIRED
ENTITY Invoice
id INT PRIMARY KEY
amount FLOAT MIN 0 DEFAULT 0
ENTITY Customer
code STRING PRIMARY KEY MAX_LENGTH 40
name STRING REQUIRED
ENTITY Student
id INT PRIMARY KEY
name STRING REQUIRED
ENTITY Course
code STRING PRIMARY KEY MAX_LENGTH 40
title STRING REQUIRED

RELATION User HAS_PROFILE Profile ONE_TO_ONE
RELATION Department HAS_EMPLOYEES Employee ONE_TO_MANY
RELATION Invoice BELONGS_TO Customer MANY_TO_ONE
RELATION Student ENROLLS_IN Course MANY_TO_MANY
~~~

## 14. Common Invalid Programs

Each row below is a complete independent source program. In the compact source
column, `↵` denotes an actual newline. Expected values are the exact public
diagnostic code arrays, not legacy symbolic identifiers. The documentation
verifier runs every row and checks the entire array; examples may produce more
than one semantic diagnostic.

| Case | Complete source (`↵` = newline) | Expected public codes |
|---|---|---|
| comment-only | `// no entities` | `SEM001` |
| empty-entity | `ENTITY Item` | `SEM004` |
| lowercase-keyword | `entity Item ↵ id INT` | `PAR007` |
| digit-name | `ENTITY 1Item ↵ id INT` | `LEX002` |
| unsupported-punctuation | `ENTITY Item {` | `LEX001` |
| malformed-number | `ENTITY Item ↵ value FLOAT DEFAULT 8.` | `LEX004` |
| unterminated-string | `ENTITY Item ↵ value STRING DEFAULT "open` | `LEX003` |
| reserved-entity | `ENTITY INT ↵ id INT` | `PAR001` |
| reserved-field | `ENTITY Item ↵ STRING INT` | `PAR009` |
| missing-entity-name | `ENTITY` | `PAR002` |
| missing-datatype | `ENTITY Item ↵ value` | `PAR012` |
| datatype-replaced-by-modifier | `ENTITY Item ↵ value REQUIRED` | `PAR013` |
| unsupported-datatype | `ENTITY Item ↵ value DATE` | `PAR013` |
| lowercase-datatype | `ENTITY Item ↵ value string` | `PAR013` |
| primary-without-key | `ENTITY Item ↵ id INT PRIMARY` | `PAR014` |
| standalone-key | `ENTITY Item ↵ id INT KEY` | `PAR015` |
| missing-min | `ENTITY Item ↵ value INT MIN` | `PAR016` |
| missing-max | `ENTITY Item ↵ value FLOAT MAX` | `PAR017` |
| missing-min-length | `ENTITY Item ↵ value STRING MIN_LENGTH` | `PAR018` |
| missing-max-length | `ENTITY Item ↵ value STRING MAX_LENGTH` | `PAR019` |
| missing-default | `ENTITY Item ↵ value STRING DEFAULT` | `PAR020` |
| duplicate-entity | `ENTITY Item ↵ id INT PRIMARY KEY ↵ ENTITY Item ↵ code STRING` | `SEM002` |
| duplicate-field | `ENTITY Item ↵ name STRING ↵ name INT` | `SEM005` |
| duplicate-constraint | `ENTITY Item ↵ value STRING REQUIRED REQUIRED` | `SEM009` |
| multiple-keys | `ENTITY Item ↵ id INT PRIMARY KEY ↵ code STRING PRIMARY KEY` | `SEM010` |
| float-key | `ENTITY Item ↵ value FLOAT PRIMARY KEY` | `SEM011` |
| boolean-key | `ENTITY Item ↵ value BOOLEAN PRIMARY KEY` | `SEM011` |
| duplicate-bound | `ENTITY Item ↵ value INT MIN 1 MIN 1` | `SEM012` |
| fractional-int-bound | `ENTITY Item ↵ value INT MIN 1.5` | `SEM019` |
| numeric-bound-on-string | `ENTITY Item ↵ value STRING MIN 1` | `SEM015` |
| numeric-bound-on-boolean | `ENTITY Item ↵ value BOOLEAN MAX 1` | `SEM015` |
| length-bound-on-int | `ENTITY Item ↵ value INT MAX_LENGTH 4` | `SEM016` |
| negative-length | `ENTITY Item ↵ value STRING MIN_LENGTH -1` | `SEM014` |
| fractional-length | `ENTITY Item ↵ value STRING MAX_LENGTH 2.5` | `SEM014` |
| reversed-numeric-range | `ENTITY Item ↵ value INT MIN 60 MAX 18` | `SEM017` |
| reversed-length-range | `ENTITY Item ↵ value STRING MIN_LENGTH 5 MAX_LENGTH 3` | `SEM018` |
| duplicate-default | `ENTITY Item ↵ value STRING DEFAULT "a" DEFAULT "b"` | `SEM020` |
| wrong-default-type | `ENTITY Item ↵ value BOOLEAN DEFAULT 1` | `SEM021` |
| fractional-int-default | `ENTITY Item ↵ value INT DEFAULT 4.5` | `SEM021` |
| numeric-default-outside | `ENTITY Item ↵ value INT MIN 18 MAX 60 DEFAULT 12` | `SEM022` |
| string-default-outside | `ENTITY Item ↵ value STRING MIN_LENGTH 3 DEFAULT "ok"` | `SEM023` |
| enum-empty-list | `ENTITY Item ↵ value ENUM()` | `PAR001` |
| enum-unquoted-member | `ENTITY Item ↵ value ENUM(active)` | `PAR001` |
| enum-trailing-comma | `ENTITY Item ↵ value ENUM("a",)` | `PAR001` |
| enum-missing-comma | `ENTITY Item ↵ value ENUM("a" "b")` | `PAR022` |
| enum-missing-close | `ENTITY Item ↵ value ENUM("a"` | `PAR022` |
| enum-duplicate | `ENTITY Item ↵ value ENUM("a", "a")` | `SEM031` |
| enum-wrong-case-default | `ENTITY Item ↵ value ENUM("active") DEFAULT "ACTIVE"` | `SEM032` |
| implicit-id-collision | `ENTITY Item ↵ ID STRING ↵ name STRING` | `SEM033` |
| enum-nonstring-default | `ENTITY Item ↵ value ENUM("a") DEFAULT TRUE` | `SEM021` |
| enum-key | `ENTITY Item ↵ value ENUM("a") PRIMARY KEY` | `SEM011` |
| enum-numeric-bound | `ENTITY Item ↵ value ENUM("a") MIN 1` | `SEM015` |
| enum-length-bound | `ENTITY Item ↵ value ENUM("a") MAX_LENGTH 1` | `SEM016` |
| missing-cardinality | `ENTITY Item ↵ id INT ↵ RELATION Item LINKS Other` | `PAR010` |
| invalid-cardinality | `ENTITY Item ↵ id INT ↵ RELATION Item LINKS Other one_to_many` | `PAR011` |
| missing-source | `ENTITY Item ↵ value INT ↵ RELATION Other LINKS Item MANY_TO_ONE` | `SEM028` |
| missing-target | `ENTITY Item ↵ value INT ↵ RELATION Item LINKS Other ONE_TO_MANY` | `SEM029` |
| self-relation | `ENTITY Item ↵ value INT ↵ RELATION Item LINKS Item ONE_TO_ONE` | `SEM027` |
| duplicate-relation | `ENTITY A ↵ value INT ↵ ENTITY B ↵ value INT ↵ RELATION A LINKS B MANY_TO_MANY ↵ RELATION A LINKS B ONE_TO_MANY` | `SEM024` |
| relation-only | `RELATION A LINKS B MANY_TO_ONE` | `SEM001, SEM028, SEM029` |

Parser codes depend on the actual token position: missing datatype at EOF is
PAR012, whereas `value REQUIRED` produces PAR013. Unrecognized modifier
spellings are ordinary identifiers and may start an attempted next field; do
not assume they produce the registry's direct-token PAR021.

## 15. Current Language Boundaries

The current source language has no block scopes/braces, semicolon terminators,
imports, namespaces, entity extension, inheritance, reusable named enums,
arrays/objects, expressions/functions, loops, conditional statements, migrations,
custom endpoints, authentication declarations, or alternate database targets.

Only the five listed datatypes exist. DATE/TIMESTAMP, UUID, JSON, DECIMAL,
VARCHAR(n), NULL defaults, regex/email constraints, indexes, composite entity
primary keys, explicit FOREIGN KEY constraints, and configurable delete actions have
no DSL construct. SQL composite junction keys are generated from MANY_TO_MANY,
not declared by composite-key syntax.

Strings have no escapes or multiline form. Source numbers have no plus prefix,
scientific notation, or hexadecimal form, even though HTTP FLOAT filters accept
some of those representations. Self-relations are rejected. Duplicate DSL
declarations are errors, not optimizer deduplication requests.

The compiler does not guarantee that every semantically accepted name/combination
produces an operational backend. Naming/relationship collisions are rejected and
relationship identifiers quoted consistently. Current target limits include
physical database limits and incomplete request/response schema enforcement.
These remaining limits are separate from the implicit-key consistency repair.
