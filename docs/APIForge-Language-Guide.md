# APIForge Language Guide

Verified against compiler baseline `96a1d34a80cfb21e4b5bdbaddf810dbef576f670`
on 2026-10-01. Implementation and tests are the authority for this guide.
See [audit evidence and reproduction commands](language-guide-verification.md).
DATE/TIMESTAMP additions verified on 2026-10-05 from approved main
`9ef005e18e875bdd83e3b73665c931588aa01ccf`; see
[G24 evidence](date-timestamp-verification.md).
UUID additions verified on 2026-10-05 from approved main
`b5b23024a4938c472b5fa73d0ebfd50e34ef75e8`; see [G25 evidence](uuid-verification.md).

G27 adds explicit `postgres` target selection on 2026-10-06; MySQL remains
the default. See [PostgreSQL target details](postgres-target.md) and
[native verification](postgres-target-verification.md). The grammar, six phases
and source IR are unchanged. `node index.js source.apiforge --target postgres`
or HTTP `{source, target: "postgres"}` selects PostgreSQL 18. Only exact
`mysql`/`postgres` values are accepted; invalid targets use INP003.
The browser and G26 migrations remain MySQL-only defaults.

PostgreSQL quotes original column spelling exactly (63 UTF-8 bytes), uses C
collation for STRING/ENUM, accepts trailing-space ENUM labels with named
CHECK membership, and sorts ENUM by declaration order. PostgreSQL generated
INT keys support MIN/MAX, with supplied keys intersecting nonnegative HTTP
policy; MySQL retains SEM037. PG generated-key zero stores zero, optional
null generates, and supplied values do not advance the sequence. A later
sequence collision returns 409; no reconciliation occurs. UUID contracts
remain canonical lowercase; DATE/TIMESTAMP public ranges/format remain
unchanged, with PG TIMESTAMPTZ(0), local text parsers and awaited UTC sessions.
All other descriptions below retain their default-MySQL context.

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
| Datatypes | `INT`, `FLOAT`, `BOOLEAN`, `STRING`, `ENUM`, `DATE`, `TIMESTAMP`, `UUID` |
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

Numbers retain raw token metadata non-enumerably while semantic checks run. INT
numeric defaults/bounds must be finite safe integers; raw nonzero fractional digits
cannot silently round into an integer. FLOAT operands must be finite. SEM035 rejects
unsafe/non-finite literals before targets. Integral decimal syntax such as 1.0 is
retained. MySQL scalar storage ranges remain database-authoritative.

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
DataType  := INT | FLOAT | BOOLEAN | STRING | ENUM "(" String ("," String)* ")" | DATE | TIMESTAMP | UUID
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
| DATE | REQUIRED, UNIQUE, canonical string DEFAULT | DATE | string/date with pattern |
| TIMESTAMP | REQUIRED, UNIQUE, canonical string DEFAULT | TIMESTAMP | string/date-time with pattern |
| UUID | PRIMARY KEY, REQUIRED, UNIQUE, canonical string DEFAULT | CHAR(36) CHARACTER SET ascii COLLATE ascii_bin | string/uuid with lowercase pattern |

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
also widens capacity. SEM037 preflights the supported utf8mb4 single-column and
indexed/composite-key limits. Whole-row layout remains database-authoritative.
All ordinary STRING writes are type-checked regardless of length modifiers.

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

### UUID

UUID values match exactly:
`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
Lowercase hexadecimal text and exact hyphens are mandatory. All UUID versions and
canonical nil/max values are accepted. Uppercase, whitespace, compact form, braces
and urn prefixes are rejected without normalization.

<!-- example: valid uuid-fields-and-keys -->
~~~apiforge
ENTITY User
id UUID PRIMARY KEY
email STRING REQUIRED UNIQUE
token UUID
fixed UUID DEFAULT "550e8400-e29b-41d4-a716-446655440000"
ENTITY Group
id UUID PRIMARY KEY
label STRING
RELATION User JOINS Group MANY_TO_MANY
~~~

UUID supports PRIMARY KEY, REQUIRED, UNIQUE and quoted canonical static DEFAULT.
Wrong primitive defaults use SEM021; malformed strings use append-only SEM039 at
the DEFAULT literal. MIN/MAX use SEM015 and length bounds use SEM016. UUID remains
UUID through AST, symbols, IR and optimizer; it is not a STRING length-bound type.

A UUID PRIMARY KEY without DEFAULT uses runtime `crypto.randomUUID()` (v4, Node
core) once when omitted or supplied as optional null. REQUIRED rejects null while
permitting generation on omission. Supplied canonical keys win exactly. Static
key defaults never generate and resolve omitted create identity from the declared
default. Ordinary UUID fields never generate. Models validate/copy input privately,
insert the resolved key and return it; caller input remains unchanged. Arbitrary
DB defaults are not reread, and UUID keys remain immutable on PUT.

SQL fields/keys/FKs use CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, with no UUID
AUTO_INCREMENT or runtime SQL DEFAULT. All four relation cardinalities work with
UUID and mixed keys. Invalid UUID bodies, equality filters and item/relationship
URL keys return 400 before DB access. Sorting uses the existing whitelist. All
CRUD/relationship reads validate declared UUID and generated UUID FK columns;
canonical strings/optional null remain unchanged, malformed external values fail
sanitized 500 and STRING stays untouched. OpenAPI uses string/uuid plus the pattern
across entity roles, filters, paths, FK and association properties. Runtime keys
are optional in Create, nonnullable in Read/CreateResult; Update omits the key.
UUID-only projects do not trigger temporal pool configuration. BINARY(16), SQL
UUID() defaults, arrays, version selectors and migrations are absent.

### DATE and TIMESTAMP

DATE is a string in exactly `YYYY-MM-DD` form, inclusive range 1000-01-01 through
9999-12-31. TIMESTAMP is a string in exactly `YYYY-MM-DDTHH:mm:ssZ` form, inclusive
UTC range 1970-01-01T00:00:01Z through 2038-01-19T03:14:07Z. Validation explicitly
checks Gregorian month lengths and leap years, hours 00–23 and minutes/seconds
00–59. Uppercase literal Z is mandatory; offsets, fractions, local timestamps,
numeric timestamps and relaxed SQL date syntax are rejected.

<!-- example: valid datatype-temporal -->
~~~apiforge
ENTITY Event
id INT PRIMARY KEY
eventDate DATE REQUIRED
startDate DATE UNIQUE DEFAULT "2026-01-01"
createdAt TIMESTAMP
publishedAt TIMESTAMP DEFAULT "2026-10-05T12:30:00Z"
~~~

Both types support REQUIRED, UNIQUE and quoted canonical static DEFAULT strings.
Wrong DEFAULT literal types use SEM021; malformed/calendar-invalid/out-of-range
strings use SEM038 at the literal. DATE/TIMESTAMP PRIMARY KEY is invalid (SEM011).
Numeric bounds and length bounds remain invalid (SEM015/SEM016). Duplicate
modifiers use the existing diagnostics. Dynamic DEFAULT CURRENT_TIMESTAMP,
DEFAULT NOW(), ON UPDATE, and automatic timestamp fields are unavailable.

SQL uses DATE and TIMESTAMP without fractional precision. The complete TIMESTAMP
schema sets the import session to `+00:00` and enables explicit timestamp defaults,
so static SQL defaults preserve the UTC instant without legacy automatic attributes.
Generated pools use mysql2 `dateStrings: ['DATE', 'TIMESTAMP']` and `timezone: 'Z'`;
each checkout awaits `SET SESSION time_zone = '+00:00'` before application queries,
including reused connections. Initialization failures destroy the connection.
Reads normalize declared TIMESTAMP SQL strings to T/Z, including related targets;
DATE stays unchanged and optional null remains null. Private model write copies
convert TIMESTAMP to SQL form; request bodies and create echoes stay canonical.
Omitted database-default values remain omitted from create responses; GET reads them.

Collection exact filters use the same strict calendar/range validation and reject
invalid input with HTTP 400 before SQL. TIMESTAMP bindings use UTC SQL strings.
Both fields support existing whitelisted sorting; no range operators are added.
OpenAPI Create/Update/Read/default/filter metadata uses string/date or
string/date-time with canonical patterns and descriptions. Read
[G24 verification](date-timestamp-verification.md) for driver and live evidence.

## 6. Primary Keys

An entity may declare at most one PRIMARY KEY field (SEM010). Only INT and
STRING and UUID are permitted (SEM011). PRIMARY KEY may coexist with REQUIRED, UNIQUE,
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
| UUID PRIMARY KEY without DEFAULT | PRIMARY KEY; runtime generation on omission/optional null |
| UUID PRIMARY KEY with DEFAULT | PRIMARY KEY DEFAULT canonical text; no runtime generation |
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
   including a positive explicit INT AUTO_INCREMENT value supplied by
   the caller. For an explicit auto-generated INT key, supplied null or numeric
   zero instead resolves from the actual result.insertId: 42 returns 42; a
   header of zero preserves zero stored under NO_AUTO_VALUE_ON_ZERO.
2. Otherwise a database auto-generated effective key uses result.insertId.
3. Otherwise an explicit primary key with DEFAULT uses that typed declared value.
4. Otherwise the database remains authoritative; no response key is invented.

Thus omitted implicit/explicit auto-generated INT keys return insertId, omitted
INT DEFAULT 7 returns 7, and omitted STRING DEFAULT "seed" returns "seed".
A supplied explicit STRING key preserves its spelling and value. Resolution
does not assume the primary key is the first field. The response copies submitted
fields, then safely defines the resolved own key; it does not mutate input or
reload other database defaults. Optional null validation remains unchanged;
Create accepts nullable non-REQUIRED keys, while CreateResult's explicit
auto-generated key is nonnullable after successful identity resolution. Native
MySQL persistence and SQL modes require separate live database verification.

An explicit INT PRIMARY KEY without DEFAULT becomes AUTO_INCREMENT. Its generated
POST contract accepts omitted keys, optional null under existing REQUIRED rules,
numeric zero and positive safe integers. Negative supplied keys return HTTP 400
`Field '<key>' must be zero or a positive integer.` before model/DB access.
Ordinary INT fields and explicit INT keys WITH DEFAULT retain negative values.
Operation Create/CreateResult/Read schemas use minimum 0 for explicit auto keys;
CreateResult remains nonnullable, and Update omits immutable keys.

MIN/MAX on an explicit INT PRIMARY KEY without DEFAULT fails SEM037 target
preflight: MySQL forbids CHECK constraints referencing AUTO_INCREMENT columns.
The diagnostic points to the first MIN/MAX modifier; MIN plus MAX gives one
target error. No CHECK is silently dropped. Ordinary numeric bounds, bounded INT
keys WITH DEFAULT and STRING key length bounds remain supported.

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
numeric range (SEM022), STRING length (SEM023), ENUM membership (SEM032),
temporal values (SEM038), and canonical UUID text (SEM039). INT requires an integer,
FLOAT a number, BOOLEAN a boolean, STRING a string, ENUM a string member, and
DATE/TIMESTAMP/UUID a quoted canonical string.

Defaults emit SQL DEFAULT and OpenAPI default. Express does not insert
default values into request bodies or reload the inserted record for create
responses. Omitted insert fields are left to MySQL; the response resolves an
omitted defaulted primary key from typed DEFAULT metadata as described in section
6, while other omitted defaults may remain absent. Omitted PUT fields retain
their existing values; PUT does not reset them to defaults. STRING and ENUM literals
share apostrophe/backslash escaping for the documented supported SQL mode.

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
Apostrophes and backslashes are escaped by the same MySQL literal helper for
STRING and ENUM. This supports NO_BACKSLASH_ESCAPES disabled; source backslashes
remain literal. ENUM members ending in ASCII space fail SEM036 because MySQL
strips trailing declaration spaces. Leading spaces and empty members remain legal.

Native MySQL behavior remains relevant: trailing spaces in declared members are
removed, strict SQL mode affects direct database rejection, numeric indexes can
be used by direct database writers, and ENUM sorting follows declaration
indexes. These are target rules, not additional accepted DSL syntax.
See the [MySQL ENUM reference](https://dev.mysql.com/doc/refman/8.4/en/enum.html).
Members with trailing ASCII spaces are rejected by SEM036 before generation.

Generated POST/PUT validation rejects supplied non-strings and nonmembers before
model calls. Optional null is allowed; REQUIRED ENUM rejects supplied null.
POST requires omitted REQUIRED ENUM unless DEFAULT supplies it; PUT permits
omission. OpenAPI preserves type string, the ordered enum array and optional
default; required reflects POST presence. Optional null is represented
by operation-specific OpenAPI schemas, including nullable ENUM null membership.

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
VARCHAR capacity. UUID foreign keys/junction columns retain CHAR(36), ascii and
ascii_bin collation. Entity tables are emitted before relationship DDL.

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
do not become source DSL fields. They appear as readOnly nullable properties in
Entity.Read schemas, matching SELECT * output. Apart from
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

Generated database failures use the existing `{ success: false, error }` envelope.
Known write/delete conflicts return 409 (`Request conflicts with existing data.`).
Known DB-rejected values on POST/PUT and association writes return 400
(`Request contains a value rejected by the database.`). Known temporary
connection/capacity/lock failures return 503 (`Database temporarily unavailable.`).
Unknown/internal failures return 500 (`Unable to complete request.`).
Reads use 500/503; collection validation remains 400 before DB access. Missing CRUD
and singular related records retain 404. UNIQUE remains database-enforced without
prechecks. Only verified machine-readable driver identifiers are classified;
SQL, private values, driver codes and raw error messages never enter responses.
See [G06 verification](generated-db-error-taxonomy-verification.md) for exact mappings.
Explicit PK creation/default semantics (G12) and mutation (G13) remain separate.

## 11. Diagnostics

Public error codes have a prefix and three digits. The registry contains
71 errors: LEX001–LEX004, PAR001–PAR022, SEM001–SEM040, INP001–INP003, GEN001, and INT001.
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
directories; root user files such as output/.env are preserved. Complete output
is staged and its generated bytes verified before publication. Handled failures
before publication preserve the previous output; a failed publication rename
attempts reverse user-root moves followed by restoration of the old output.
User-owned roots move as opaque filesystem objects without recursive copying.
Failed rollback retains recovery material and reports exact paths.
Cleanup failures are reported, including whether the new
output is already published. See [disk-publication behavior](atomic-output-publication-verification.md).
Generated
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
named id even for a differently named STRING or UUID primary key. Invalid UUID
item/source/target URL parameters return 400 before model access; INT/STRING
path behavior is unchanged. Models bind request
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
| DATE | Canonical Gregorian YYYY-MM-DD, 1000-01-01 through 9999-12-31. |
| TIMESTAMP | Canonical UTC YYYY-MM-DDTHH:mm:ssZ, 1970-01-01T00:00:01Z through 2038-01-19T03:14:07Z; no offsets/fractions. |
| UUID | Exact lowercase 8-4-4-4-12 text, all versions/nil/max; directly bound strings. |

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
before any DB query. Only model-registered collection validation errors expose
their safe generated messages; arbitrary statusCode properties have no authority.
Collection DB failures return sanitized 503 for recognized temporary failures,
otherwise 500 (`Unable to complete request.`). Filter values, limit, and offset are bound
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

swagger.json documents root CRUD/relationship paths, query parameters and conditional
pagination headers. Entity.Create models POST writable fields and required-on-create
presence. Entity.Update omits immutable keys and has no required array for partial
PUT. Entity.Read models effective identity, declared fields and readOnly nullable
SQL-added FK columns. Optional declared inputs use nullable; REQUIRED inputs do not.
Optional ENUM role schemas append null while retaining source member order/case.
INT write schemas include safe-integer limits. Defaults and declared bounds remain.
Legacy source-name components are retained; operations use the new role components.

Reusable envelopes describe success/data, success/message and success/error bodies,
including 400/404/500 where the handlers emit them. CreateResult permits omitted
non-key database defaults because create echoes supplied fields plus resolved identity
without reloading the row. Association add echoes URL FK values as strings.

All row-returning models normalize numeric declared BOOLEAN columns to true/false,
including related target rows, preserving optional null and arbitrary INT fields.
The server does not load an OpenAPI runtime validator or serve Swagger UI.
See [fidelity verification](openapi-runtime-fidelity-verification.md).

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
| unsupported-datatype | `ENTITY Item ↵ value DATETIME` | `PAR013` |
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
| generated-column-collision | `ENTITY Item ↵ id INT PRIMARY KEY ↵ name STRING ↵ Name INT` | `SEM034` |
| unsafe-int-literal | `ENTITY Item ↵ value INT DEFAULT 9007199254740993` | `SEM035` |
| enum-trailing-space | `ENTITY Item ↵ value ENUM("a ")` | `SEM036` |
| mysql-varchar-capacity | `ENTITY Item ↵ value STRING MAX_LENGTH 100000` | `SEM037` |
| auto-key-min | `ENTITY Item ↵ id INT PRIMARY KEY MIN 1 ↵ name STRING` | `SEM037` |
| auto-key-max | `ENTITY Item ↵ id INT PRIMARY KEY MAX 100 ↵ name STRING` | `SEM037` |
| auto-key-both | `ENTITY Item ↵ id INT PRIMARY KEY MIN 1 MAX 100 ↵ name STRING` | `SEM037` |
| enum-nonstring-default | `ENTITY Item ↵ value ENUM("a") DEFAULT TRUE` | `SEM021` |
| date-invalid-calendar | `ENTITY Item ↵ value DATE DEFAULT "2026-02-30"` | `SEM038` |
| date-numeric-default | `ENTITY Item ↵ value DATE DEFAULT 123` | `SEM021` |
| timestamp-local-default | `ENTITY Item ↵ value TIMESTAMP DEFAULT "2026-10-05 12:30:00"` | `SEM038` |
| timestamp-range-default | `ENTITY Item ↵ value TIMESTAMP DEFAULT "2040-01-01T00:00:00Z"` | `SEM038` |
| date-key | `ENTITY Item ↵ value DATE PRIMARY KEY` | `SEM011` |
| timestamp-length-bound | `ENTITY Item ↵ value TIMESTAMP MAX_LENGTH 20` | `SEM016` |
| enum-key | `ENTITY Item ↵ value ENUM("a") PRIMARY KEY` | `SEM011` |
| uuid-uppercase-default | `ENTITY Item ↵ value UUID DEFAULT "550E8400-E29B-41D4-A716-446655440000"` | `SEM039` |
| uuid-malformed-default | `ENTITY Item ↵ value UUID DEFAULT "not-a-uuid"` | `SEM039` |
| uuid-numeric-default | `ENTITY Item ↵ value UUID DEFAULT 5` | `SEM021` |
| uuid-boolean-default | `ENTITY Item ↵ value UUID DEFAULT TRUE` | `SEM021` |
| uuid-numeric-bound | `ENTITY Item ↵ value UUID MIN 1` | `SEM015` |
| uuid-length-bound | `ENTITY Item ↵ value UUID MAX_LENGTH 36` | `SEM016` |
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

### Supported MySQL target and preflight

Generated SQL quotes reserved identifiers across supported MySQL 8.0 versions,
including LATERAL, INTERSECT, ARRAY and MEMBER. Valid declared columns named
`__proto__`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__` or
`__lookupSetter__` use mysql2 static array parsing and own-property row
reconstruction in generated config/db.js; composed relationship columns receive
the same protection. Automatic keys are readOnly in operation Read schemas.

Use MySQL >=8.0.16, utf8mb4, InnoDB DYNAMIC row format and pages >=16 KiB,
with strict mode and NO_BACKSLASH_ESCAPES disabled for import and runtime connections.
Configure server/database defaults; generated DDL does not override them. Ordinary
STRING equality uses the configured collation; native ENUM uses utf8mb4_bin.
SEM037 checks 64-character table/column/FK/junction/constraint identifiers, including
automatic CHECK/FK composed names; single VARCHAR capacity floor((65535-2)/4)=16383;
3072-byte full-column indexes (UUID costs 36 ASCII bytes); 1017 physical columns,
including implicit keys and relationship columns; 64 secondary indexes and the
stock MySQL limit of 64 total indexes including PRIMARY (effectively 63 secondary);
16 index parts; a 65,535-byte logical row budget with VARCHAR length/nullable bytes;
and a conservative DYNAMIC local-record admission budget for 16 KiB pages.
ENUM permits <=65,535 members, each <=255 characters / <=1020 utf8mb4 bytes.
Final physical columns cannot use DB_ROW_ID, DB_TRX_ID or DB_ROLL_PTR in any casing.
INT/FLOAT DEFAULT literals must fit their generated storage types; HTTP numeric
contracts and legal wide CHECK bounds are unchanged. Invalid configurations reject
with located SEM037 before IR or disk publication; direct IR repeats the check.
No truncation, silent renaming, or generated table-option rewrite occurs.
Server version, page size, engine, row format, charset and sql_mode remain deployment
prerequisites requiring live verification. Passing preflight does not simulate all
runtime row values or later schema migrations. See
[G16 verification](mysql-target-preflight-completion-verification.md) for the model,
native boundaries, differential evidence and limitations. G19 disk publication handles
operation failures with staging and reversible user-root renames as described
in the generated-output section. Node.js >=18 is required by generated Express dependencies.

## 15. Current Language Boundaries

The current source language has no block scopes/braces, semicolon terminators,
imports, namespaces, entity extension, inheritance, reusable named enums,
arrays/objects, expressions/functions, loops, conditional statements, migrations,
custom endpoints, authentication declarations, or alternate database targets.

Only the eight listed datatypes exist. DATETIME, TIME, YEAR, JSON, DECIMAL,
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
