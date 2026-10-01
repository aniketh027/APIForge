# APIForge Language Guide

## 1. Introduction

APIForge is a domain-specific language (DSL) and six-phase optimizing compiler designed for rapid backend engineering. Instead of manually writing repetitive database schemas, SQL queries, data access objects, Express controllers, route definitions, and OpenAPI documentation, developers declare high-level data models and relationships using APIForge DSL.

The APIForge compiler takes a declarative `.apiforge` specification and compiles it into a production-ready, fully functional backend consisting of:

- **MySQL DDL Schema**: Complete `CREATE TABLE` scripts with primary keys, foreign keys, unique constraints, nullability, default values, and check constraints.
- **Express.js REST API**: Parameterized SQL models using `mysql2/promise`, controllers with input validation, modular routers, and an Express application entrypoint.
- **OpenAPI 3.0 Specification**: An interactive `swagger.json` document detailing all CRUD endpoints, relationship endpoints, request bodies, path parameters, and schema validations.

---

## 2. Quick Start

### Prerequisites
- **Node.js**: Version 14 or higher (v18+ recommended).
- **npm**: Version 6 or higher.

### Installation
Clone the repository and install dependencies:

```bash
npm install
```

### Running the Web Playground
APIForge includes an interactive browser-based playground with real-time compilation, phase-by-phase diagnostics, and project export:

```bash
npm run dev
# or
npm start
```

Open **http://localhost:3001** in your web browser.

### Compiling a .apiforge File via CLI
To compile the default sample file:

```bash
npm run compile
```

To compile any custom `.apiforge` file:

```bash
node index.js samples/student.apiforge
```

### Running the Test Suite
APIForge features a comprehensive test suite covering all compiler phases:

```bash
npm test
```

### Where Generated Files Appear
All generated target code is emitted directly into the `output/` directory:

```text
output/
├── config/
│   └── db.js                        # MySQL connection pool configuration
├── controllers/
│   └── <entity>Controller.js        # Request handlers & validation logic
├── database/
│   └── schema.sql                   # MySQL DDL schema and foreign keys
├── models/
│   └── <Entity>.js                  # Data access models with parameterized queries
├── routes/
│   └── <entity>Routes.js            # Express router with CRUD & relation routes
├── .env.example                     # Environment variable template
├── package.json                     # Runtime dependencies and npm start script
├── README.md                        # Generated-project setup guide
├── server.js                        # Express server entry point
└── swagger.json                     # OpenAPI 3.0 API specification
```

---

## 3. Compiler Pipeline

APIForge is built as a classic six-phase compiler. Each phase executes sequentially and passes its output to the subsequent phase:

```text
       Source Code (.apiforge file)
                  │
                  ▼
         ┌─────────────────┐
         │  1. LEXER       │  Character stream → Token stream
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  2. PARSER      │  Token stream → Abstract Syntax Tree (AST)
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  3. SEMANTIC    │  AST validation + Symbol Table construction
         │     ANALYZER    │  (Checks types, ranges, duplicates, relations)
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  4. IR          │  AST → Linear Intermediate Representation
         │     GENERATOR   │  (Target-independent instruction stream)
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  5. OPTIMIZER   │  6 target-independent optimization passes
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  6. CODE        │  Optimized IR → Target artifacts
         │     GENERATOR   │  (MySQL schema, Express API, OpenAPI spec)
         └─────────────────┘
```

### The 6 Phases Explained Simply:

1. **Phase 1: Lexical Analysis (Lexer)**
   Reads raw source text character-by-character, strips whitespace and comments, and groups characters into typed tokens (`KEYWORD`, `IDENTIFIER`, `DATATYPE`, `MODIFIER`, `NUMBER`, `STRING_LITERAL`, `BOOLEAN_LITERAL`).
2. **Phase 2: Syntax Analysis (Parser)**
   Uses recursive descent parsing to verify that tokens follow the language grammar rules and constructs a hierarchical Abstract Syntax Tree (AST).
3. **Phase 3: Semantic Analysis**
   Checks program logic and semantic rules that syntax alone cannot enforce (e.g., verifying that data types exist, checking range consistency, ensuring relationship targets exist, rejecting duplicates). Collects all errors and builds the symbol table.
4. **Phase 4: Intermediate Representation (IR) Generation**
   Converts the tree-shaped AST into a flat list of target-independent instructions (`CREATE_ENTITY`, `ADD_FIELD`, `CREATE_RELATION`).
5. **Phase 5: Optimization**
   Executes six target-independent optimization passes on the IR to normalize constraints and eliminate duplicate instructions before code generation.
6. **Phase 6: Code Generation**
   Translates the optimized IR into concrete target files: SQL DDL for MySQL, JavaScript modules for Express, and JSON for OpenAPI.

---

## 4. Language Basics

### Line Structure & Whitespace
- APIForge is a **free-form, line-friendly** language.
- Indentation (spaces or tabs) is ignored by the lexer and parser. You may indent fields under an entity for readability.
- Blank lines between entities or fields are permitted and ignored.
- Newlines serve as natural delimiters between declarations.

### Comments
- **Single-line comments** begin with `//` and continue to the end of the line:
  ```apiforge
  // This is a comment. It is ignored by the compiler.
  ENTITY Student // Comments can also appear at the end of a line
  ```
- **Block comments** (`/* ... */`) are **not supported**.

### Identifiers
Identifiers are user-defined names given to entities, fields, and relationships:
- Must begin with an ASCII letter (`a-z`, `A-Z`) or an underscore (`_`).
- Subsequent characters may be letters, digits (`0-9`), or underscores (`_`).
- **Cannot begin with a digit** (e.g., `1student` produces a lexical error).
- **Cannot be a reserved word** (e.g., `ENTITY`, `INT`, `REQUIRED`, `TRUE`).

### Case Sensitivity
- **All language keywords, data types, modifiers, relation types, and boolean literals are strictly UPPERCASE**:
  - Keywords: `ENTITY`, `RELATION`
  - Data Types: `INT`, `STRING`, `FLOAT`, `BOOLEAN`, `ENUM`
  - Modifiers: `PRIMARY`, `KEY`, `REQUIRED`, `UNIQUE`, `MIN`, `MAX`, `MIN_LENGTH`, `MAX_LENGTH`, `DEFAULT`
  - Relation Types: `ONE_TO_ONE`, `ONE_TO_MANY`, `MANY_TO_ONE`, `MANY_TO_MANY`
  - Boolean Literals: `TRUE`, `FALSE`
- Typing keywords in lowercase (e.g., `entity`, `int`, `string`) will cause the lexer to treat them as identifiers, resulting in syntax errors.
- **Identifiers are case-sensitive**: `Student` and `student` are considered different names.

### End of File (EOF) Behavior
- The compiler expects a clean termination. Trailing comments, blank lines, or whitespace at the end of the file are ignored.
- A program must contain at least one `ENTITY`. Empty, whitespace-only, comment-only, and relation-only programs produce a semantic error.

---

## 5. ENTITY

An entity represents a database table and a complete REST resource.

### Syntax
```apiforge
ENTITY <EntityName>
    <field_declaration>
    ...
```

### Example
```apiforge
ENTITY Student
    id INT PRIMARY KEY
    name STRING REQUIRED
```

### Rules & Boundaries
1. **Naming**: Must be a valid identifier in PascalCase (recommended) or snake_case, and cannot match any reserved word.
2. **Uniqueness**: Entity names must be unique within the source file. Duplicate entity declarations cause a semantic error.
3. **Fields Requirement**: Every entity **must contain at least one field**. An empty entity declaration is rejected by semantic analysis.
4. **Boundaries**: An entity declaration begins with the `ENTITY` keyword and continues until the next `ENTITY` keyword, the next `RELATION` keyword, or the end of the file (`EOF`).

---

## 6. Data Types

APIForge supports four built-in primitive data types. Every field must declare exactly one data type.

| DSL Data Type | Description | MySQL Column Type | OpenAPI / Swagger Type |
|:---|:---|:---|:---|
| `INT` | 32-bit signed integer numbers | `INT` | `integer` |
| `STRING` | Text string | `VARCHAR(255)` by default; widened when a declared length bound exceeds 255 | `string` |
| `FLOAT` | Floating-point decimal numbers | `FLOAT` | `number` |
| `BOOLEAN` | Logical boolean flag (`TRUE` or `FALSE`) | `BOOLEAN` | `boolean` |
| `ENUM("a", "b")` | Finite case-sensitive set of strings | `ENUM('a', 'b')` | `string` with `enum` |

### ENUM datatype

```apiforge
status ENUM("active", "inactive") DEFAULT "active"
role ENUM(
    "student",
    "faculty",
    "admin"
) REQUIRED UNIQUE
```

An ENUM declaration needs at least one double-quoted string. Values retain
declaration order and literal contents. Comparison is case-sensitive, so
`"ACTIVE"` and `"active"` are distinct. Duplicate values are semantic errors;
bare identifiers, empty lists and missing delimiters are parser errors. The
lexer does not decode backslash escapes or allow literal newlines inside strings.

DEFAULT must be a string member of the declared set. REQUIRED and UNIQUE are
allowed. MIN/MAX and MIN_LENGTH/MAX_LENGTH are invalid; ENUM already defines
the finite accepted values. Explicit PRIMARY KEY remains INT/STRING only;
implicit integer primary-key behavior is unchanged.

AST fields, symbols and ADD_FIELD IR carry `dataType: "ENUM"` and an ordered
`enumValues` array. Source metadata is non-enumerable; duplicate diagnostics
identify the repeated quoted value, default errors identify the DEFAULT clause,
and illegal bounds identify their modifier. Optimization preserves values exactly.

SQL uses native ENUM and `utf8mb4_bin` collation for case-sensitive membership.
Apostrophes are doubled, and literal backslashes are doubled under MySQL's
normal backslash-escaping SQL mode. The generated schema assumes that mode;
`NO_BACKSLASH_ESCAPES` requires adapting SQL literal escaping. MySQL's native
ENUM semantics still apply, including removal of trailing spaces in declaration
members and strict-mode enforcement for direct database writes. Prefer values
without trailing spaces. These target constraints do not rewrite AST or IR values.
See the [MySQL ENUM reference](https://dev.mysql.com/doc/refman/8.4/en/enum.html)
for native storage, SQL-mode and numeric-index behavior.

Generated POST and PUT handlers reject supplied non-string values and strings
outside the set with HTTP 400 and the existing `{ success: false, error }` style.
Optional null remains allowed; REQUIRED ENUM rejects supplied null. Omission
keeps existing behavior, allowing database defaults; REQUIRED omission remains
database-enforced. OpenAPI properties use `type: "string"`, the declared `enum`
array and optional `default`; REQUIRED fields stay in the entity required array.
Request operations share that component schema. Existing response descriptions
and uniqueness representation remain unchanged.

See `samples/enum_account.apiforge`, `npm run test:enum` and the opt-in
`npm run test:generated-mysql` for offline and native-database verification.

### Examples
```apiforge
ENTITY Product
    id INT PRIMARY KEY
    title STRING REQUIRED
    price FLOAT REQUIRED
    inStock BOOLEAN DEFAULT TRUE
```

---

## 7. Fields

Fields define the attributes (database columns and JSON properties) of an entity.

### Syntax
```apiforge
<fieldName> <DataType> [<Modifiers>...]
```

### Examples
```apiforge
name STRING
age INT
email STRING REQUIRED UNIQUE
rating FLOAT MIN 0.0 MAX 5.0 DEFAULT 5.0
```

### Rules
1. **Field Name**: Must be a valid identifier.
2. **Field Name Uniqueness**: Field names must be unique within the declaring entity. Two fields with the same name in the same entity cause a semantic error.
3. **Data Type Required**: A valid data type must immediately follow the field name.
4. **Reserved Names**: Field names cannot be reserved words (e.g., you cannot name a field `INT`, `PRIMARY`, or `ENTITY`).

---

## 8. Constraints

Constraints enforce structural rules and integrity on fields. Constraints follow the data type in any order.

| Constraint | DSL Syntax | Meaning | Generated MySQL DDL | Generated OpenAPI |
|:---|:---|:---|:---|:---|
| **Primary Key** | `PRIMARY KEY` | Unique record identifier | `INT PRIMARY KEY AUTO_INCREMENT` | Included in schema |
| **Required** | `REQUIRED` | Mandatory field (cannot be null) | `NOT NULL` | Added to `required: [...]` |
| **Unique** | `UNIQUE` | Values must be distinct across table | `UNIQUE` | Documented in schema |

### 1. PRIMARY KEY
- Marks the unique primary identifier for the entity.
- **Allowed Data Types**: Only `INT` or `STRING` fields may be declared as `PRIMARY KEY`.
- **Single Primary Key**: An entity can have **at most one** primary key. Declaring multiple primary keys causes a semantic error.
- **Auto-Increment Behavior**: For `INT` primary keys without an explicit default value, the code generator automatically adds `AUTO_INCREMENT` in MySQL.
- **Auto-Injection**: If an entity omits an explicit primary key, APIForge automatically injects an `id INT PRIMARY KEY AUTO_INCREMENT` column during code generation.
  Valid programs receive the non-fatal `WRN001 / IMPLICIT_PRIMARY_KEY` warning at
  the entity name. Compilation succeeds and generated artifacts are unchanged.
  Declare an explicit `PRIMARY KEY` to control the identifier. See
  [structured diagnostics](structured-diagnostics.md) for the warning contract.

### 2. REQUIRED
- Specifies that the field must not be null.
- Translates to `NOT NULL` in MySQL.
- Adds the field name to the OpenAPI schema's `required` array.

### 3. UNIQUE
- Guarantees that no two records have the same value for this column.
- Translates to the `UNIQUE` column constraint in MySQL.

### Constraint Combination Example
```apiforge
ENTITY User
    id INT PRIMARY KEY
    username STRING REQUIRED UNIQUE
    email STRING REQUIRED UNIQUE
```

---

## 9. Validation Rules

APIForge supports numeric value bounds and STRING length bounds. These are separate modifier pairs: `MIN` / `MAX` for numeric fields, and `MIN_LENGTH` / `MAX_LENGTH` for STRING fields.

### Numeric Value Validation: MIN / MAX

#### Syntax
```apiforge
<fieldName> <DataType> MIN <number>
<fieldName> <DataType> MAX <number>
<fieldName> <DataType> MIN <number> MAX <number>
```

#### Allowed Data Types
- `MIN` and `MAX` are **only allowed on numeric data types**: `INT` and `FLOAT`.
  - Applying `MIN` or `MAX` to `STRING`, `BOOLEAN` or `ENUM` fields produces a semantic error.

#### Numeric Rules
- **For `INT` fields**: The validation value **must be an integer** (e.g., `MIN 18`). Decimal bounds (such as `MIN 18.5`) on `INT` fields are rejected with a semantic error.
- **For `FLOAT` fields**: The validation value may be an integer or decimal (e.g., `MIN 0.0 MAX 10.0`).
- **Negative Numbers**: Negative numbers are fully supported (e.g., `MIN -50 MAX -10`).

#### Range Consistency
- When both `MIN` and `MAX` are specified on the same field, the compiler enforces that **`MIN <= MAX`**.
- If `MIN > MAX` (e.g., `MIN 60 MAX 18`), the semantic analyzer raises an error.
- Duplicate `MIN` or duplicate `MAX` modifiers on the same field are rejected.

#### Code Generation Effects
1. **MySQL DDL**: Generates an SQL table check constraint:
   ```sql
   CHECK (age >= 18 AND age <= 60)
   ```
2. **Express Controllers**: Generates validation checks in `validate<Entity>(data)`:
   ```javascript
   if (data.age !== undefined && data.age !== null && data.age < 18) {
       return "Field 'age' must be >= 18.";
   }
   ```
3. **OpenAPI / Swagger**: Populates `minimum` and `maximum` properties in `swagger.json`.

#### Valid Examples
```apiforge
age INT MIN 18 MAX 65
score FLOAT MIN 0.0 MAX 100.0
offset INT MIN -100 MAX 100
temperature FLOAT MIN -40.0
```

#### Invalid Examples (Compiler Rejections)
```apiforge
// ✗ Error: MIN not allowed on STRING
name STRING MIN 5

// ✗ Error: Float bound on INT field
age INT MIN 18.5

// ✗ Error: MIN cannot be greater than MAX
discount INT MIN 50 MAX 10

// ✗ Error: Duplicate MIN modifier
level INT MIN 1 MIN 5
```

### STRING Length Validation: MIN_LENGTH / MAX_LENGTH

Use `MIN_LENGTH` and `MAX_LENGTH` to constrain the number of Unicode characters in a `STRING` value:

```apiforge
<fieldName> STRING MIN_LENGTH <non-negative-integer>
<fieldName> STRING MAX_LENGTH <non-negative-integer>
<fieldName> STRING MIN_LENGTH <non-negative-integer> MAX_LENGTH <non-negative-integer>
```

The modifiers may appear independently or together and may be combined with `REQUIRED`, `UNIQUE`, `PRIMARY KEY`, and `DEFAULT`. Each modifier may appear at most once per field. Values must be non-negative integers; when both are present, `MIN_LENGTH <= MAX_LENGTH` is required.

For a STRING field with `DEFAULT`, semantic analysis counts Unicode code points in the default and requires its length to satisfy all declared bounds. Generated Express validation uses the same code-point counting behavior for supplied non-null values. Omitted fields and `null` keep the existing runtime behavior, allowing database defaults and constraints to apply.

Code generation maps the rules consistently:

- MySQL uses `CHECK (CHAR_LENGTH(column) ...)` expressions and widens the default `VARCHAR(255)` capacity when a declared bound exceeds 255.
- Express returns HTTP 400 through the existing generated validation path when a supplied value is not a string or violates a bound.
- OpenAPI uses `minLength` and `maxLength` on the entity schema referenced by generated `POST` and `PUT` request bodies.

Valid examples:

```apiforge
username STRING REQUIRED MIN_LENGTH 3 MAX_LENGTH 20
bio STRING MAX_LENGTH 500
role STRING DEFAULT "student" MIN_LENGTH 3 MAX_LENGTH 20
nickname STRING MIN_LENGTH 0
```

Invalid examples:

```apiforge
// ✗ Length validation applies only to STRING
age INT MIN_LENGTH 2

// ✗ Length values cannot be negative or fractional
name STRING MIN_LENGTH -1
alias STRING MAX_LENGTH 2.5

// ✗ MIN_LENGTH cannot exceed MAX_LENGTH
code STRING MIN_LENGTH 5 MAX_LENGTH 3

// ✗ Each length modifier may appear only once
name STRING MIN_LENGTH 3 MIN_LENGTH 4

// ✗ The default is shorter than MIN_LENGTH
status STRING MIN_LENGTH 3 DEFAULT "ok"
```

---

## 10. DEFAULT

The `DEFAULT` modifier specifies a default value for a field when no value is provided during insertion.

### Syntax
```apiforge
<fieldName> <DataType> DEFAULT <LiteralValue>
```

### Supported Literal Forms
Every default value must match the data type of the field:

| Data Type | Allowed Default Literal Form | Example DSL | Generated SQL |
|:---|:---|:---|:---|
| `INT` | Integer number literal (positive or negative) | `age INT DEFAULT 25` | `DEFAULT 25` |
| `FLOAT` | Decimal or integer number literal | `cgpa FLOAT DEFAULT 8.5` | `DEFAULT 8.5` |
| `STRING` | Double-quoted string literal | `status STRING DEFAULT "active"` | `DEFAULT 'active'` |
| `BOOLEAN` | Boolean literal (`TRUE` or `FALSE`) | `active BOOLEAN DEFAULT TRUE` | `DEFAULT TRUE` |
| `ENUM` | A quoted declared member | `status ENUM("active", "inactive") DEFAULT "active"` | `DEFAULT 'active'` |

### Semantic Rules
1. **Type Compatibility**: The default value literal must strictly match the field's declared type. Declaring `age INT DEFAULT "young"` or `active BOOLEAN DEFAULT 1` produces a semantic error.
2. **Validation Conformance**: Numeric defaults must satisfy `MIN` / `MAX`; STRING defaults must satisfy `MIN_LENGTH` / `MAX_LENGTH`.
3. **Single Default**: A field can have at most one `DEFAULT` clause. Duplicate defaults on the same field are rejected.
4. **String Escaping**: Single quotes inside string defaults are safely escaped by doubling them (`''`) in generated SQL to prevent injection.

### Primary Key and DEFAULT Interaction
In MySQL, columns marked with `AUTO_INCREMENT` cannot have an explicit `DEFAULT` clause. Therefore:
- `id INT PRIMARY KEY`: Generates `PRIMARY KEY AUTO_INCREMENT`.
- `id INT PRIMARY KEY DEFAULT 1`: Generates `PRIMARY KEY DEFAULT 1` (omitting `AUTO_INCREMENT`).

### Valid Examples
```apiforge
age INT MIN 18 MAX 60 DEFAULT 25
status STRING DEFAULT "pending" MIN_LENGTH 3 MAX_LENGTH 20
rating FLOAT MIN 0.0 MAX 5.0 DEFAULT 5.0
isVerified BOOLEAN DEFAULT FALSE
```

### Invalid Examples (Compiler Rejections)
```apiforge
// ✗ Error: Default value outside range [18, 60]
age INT MIN 18 MAX 60 DEFAULT 10

// ✗ Error: Float default on INT field
count INT DEFAULT 4.5

// ✗ Error: Type mismatch (string on INT)
total INT DEFAULT "zero"

// ✗ Error: Duplicate DEFAULT clause
status STRING DEFAULT "draft" DEFAULT "published"

// ✗ Error: STRING default is shorter than MIN_LENGTH
role STRING MIN_LENGTH 3 DEFAULT "ok"
```

---

## 11. Relationships

Relationships declare associations between entities. APIForge supports all four relational cardinalities.

### Syntax
```apiforge
RELATION <sourceEntity> <relationName> <targetEntity> <relationshipType>
```

### Parameters
- **`<sourceEntity>`**: The originating entity name (must exist).
- **`<relationName>`**: Unique identifier for this relationship across the entire program (cannot be a reserved word).
- **`<targetEntity>`**: The destination entity name (must exist).
- **`<relationshipType>`**: One of the four cardinalities listed below.

---

### 1. ONE_TO_ONE
**Meaning**: Exactly one source record is linked to one target record (e.g., a User has one Profile).

```apiforge
RELATION User HAS_PROFILE Profile ONE_TO_ONE
```

- **Generated MySQL**: Adds a unique foreign key column on the target table referencing the source entity's primary key with cascading deletes:
  ```sql
  ALTER TABLE Profile ADD COLUMN user_id INT UNIQUE;
  ALTER TABLE Profile ADD CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE;
  ```
- **Generated REST API**:
  - `GET /users/:id/profile`: Retrieves the profile associated with the user.

---

### 2. ONE_TO_MANY
**Meaning**: One source record is associated with many target records (e.g., a Department has many Employees).

```apiforge
RELATION Department HAS_EMPLOYEES Employee ONE_TO_MANY
```

- **Generated MySQL**: Adds a nullable foreign key column on the target table referencing the source entity:
  ```sql
  ALTER TABLE Employee ADD COLUMN department_id INT;
  ALTER TABLE Employee ADD CONSTRAINT fk_employee_department FOREIGN KEY (department_id) REFERENCES Department(id) ON DELETE SET NULL;
  ```
- **Generated REST API**:
  - `GET /departments/:id/employees`: Retrieves all employees belonging to the department.

---

### 3. MANY_TO_ONE
**Meaning**: Many source records reference one target record (e.g., many Orders belong to one Customer).

```apiforge
RELATION Order PLACED_BY Customer MANY_TO_ONE
```

- **Generated MySQL**: Adds a foreign key column on the source table referencing the target entity:
  ```sql
  ALTER TABLE `Order` ADD COLUMN customer_id INT;
  ALTER TABLE `Order` ADD CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES Customer(id) ON DELETE SET NULL;
  ```
- **Generated REST API**:
  - `GET /orders/:id/customer`: Retrieves the customer for a specific order.

---

### 4. MANY_TO_MANY
**Meaning**: Multiple source records associate with multiple target records (e.g., Students enroll in Courses).

```apiforge
RELATION Student ENROLLS_IN Course MANY_TO_MANY
```

- **Generated MySQL**: Generates an intermediary junction table named `<Source>_<Target>` with a composite primary key and foreign keys to both tables:
  ```sql
  CREATE TABLE Student_Course (
      student_id INT NOT NULL,
      course_id INT NOT NULL,
      PRIMARY KEY (student_id, course_id),
      FOREIGN KEY (student_id) REFERENCES Student(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES Course(id) ON DELETE CASCADE
  );
  ```
- **Generated REST API**:
  - `GET /students/:id/courses`: Retrieves all courses for a student.
  - `POST /students/:id/courses/:courseId`: Enrolls a student into a course (inserts into junction table).
  - `DELETE /students/:id/courses/:courseId`: Drops a student from a course (deletes from junction table).

---

### Relationship Semantic Rules
1. **Existence**: Both `<sourceEntity>` and `<targetEntity>` must be defined in the same source file.
2. **No Self-References**: Self-referential relationships (e.g., `RELATION User HAS_FRIEND User ONE_TO_ONE`) are not supported and are rejected.
3. **Unique Names**: The relationship name must be globally unique across all relationships.
4. **Non-Reserved**: Relationship names cannot match reserved keywords.

---

## 12. Complete DSL Example

Below is a complete, realistic DSL file demonstrating entities, primitive types, constraints, numeric and STRING-length validations, default values, and relationships.

```apiforge
// ============================================
// University Management System
// File: university.apiforge
// ============================================

ENTITY Department
    id INT PRIMARY KEY
    name STRING REQUIRED UNIQUE
    budget FLOAT MIN 10000.0 DEFAULT 50000.0

ENTITY Student
    id INT PRIMARY KEY
    fullName STRING REQUIRED MIN_LENGTH 2 MAX_LENGTH 80
    email STRING REQUIRED UNIQUE
    age INT MIN 17 MAX 65 DEFAULT 20
    gpa FLOAT MIN 0.0 MAX 4.0 DEFAULT 3.0
    isActive BOOLEAN DEFAULT TRUE

ENTITY Course
    id INT PRIMARY KEY
    code STRING REQUIRED UNIQUE
    title STRING REQUIRED
    credits INT MIN 1 MAX 6 DEFAULT 3

// Relationships
RELATION Department OFFERS Course ONE_TO_MANY
RELATION Student ENROLLS_IN Course MANY_TO_MANY
```

### Section-by-Section Explanation:

1. **Department Entity**:
   - `id`: Integer primary key with auto-increment.
   - `name`: Unique, mandatory department name.
   - `budget`: Float with minimum budget validation ($10,000.00) and a default of $50,000.00.
2. **Student Entity**:
   - `id`: Integer primary key with auto-increment.
   - `fullName`: Mandatory text string between 2 and 80 Unicode code points.
   - `email`: Mandatory and unique string.
   - `age`: Integer with bounded range (`MIN 17 MAX 65`) and default of 20.
   - `gpa`: Decimal with grade scale bounds (`MIN 0.0 MAX 4.0`) and default of 3.0.
   - `isActive`: Boolean flag defaulting to `TRUE`.
3. **Course Entity**:
   - `id`: Integer primary key.
   - `code`: Mandatory unique course code (e.g., "CS101").
   - `title`: Mandatory course title.
   - `credits`: Integer bounded between 1 and 6, defaulting to 3.
4. **Relationships**:
   - `Department OFFERS Course ONE_TO_MANY`: Adds `department_id` foreign key on the `Course` table.
   - `Student ENROLLS_IN Course MANY_TO_MANY`: Generates the `Student_Course` junction table with association endpoints.

---

## 13. Compilation Walkthrough

When you run `node index.js university.apiforge`, the compiler processes the file through all six phases:

### Step 1: Lexical Analysis
The lexer converts the character stream into 85 tokens, including the final EOF token. Whitespace and comments are stripped.

```text
  ┌───────┬──────────────┬──────────────┬──────┬────────┐
  │  #    │ Type         │ Value        │ Line │ Column │
  ├───────┼──────────────┼──────────────┼──────┼────────┤
  │    1  │ KEYWORD      │ ENTITY       │    6 │     1  │
  │    2  │ IDENTIFIER   │ Department   │    6 │     8  │
  │    3  │ IDENTIFIER   │ id           │    7 │     5  │
  │    4  │ DATATYPE     │ INT          │    7 │     8  │
  ...
```

### Step 2: Syntax Analysis (Parser)
The parser constructs an AST containing 3 `EntityNode` instances and 2 `RelationNode` instances:

```text
Program
├── Entity: "Department"
│   ├── Field: id (INT) [PRIMARY_KEY]
│   ├── Field: name (STRING) [REQUIRED, UNIQUE]
│   └── Field: budget (FLOAT) [MIN 10000, DEFAULT 50000]
├── Entity: "Student"
│   ├── Field: id (INT) [PRIMARY_KEY]
│   ├── Field: fullName (STRING) [REQUIRED] [MIN_LENGTH 2, MAX_LENGTH 80]
│   ├── Field: email (STRING) [REQUIRED, UNIQUE]
│   ├── Field: age (INT) [MIN 17, MAX 65, DEFAULT 20]
│   ├── Field: gpa (FLOAT) [MIN 0, MAX 4, DEFAULT 3]
│   └── Field: isActive (BOOLEAN) [DEFAULT true]
├── Entity: "Course"
│   ├── Field: id (INT) [PRIMARY_KEY]
│   ├── Field: code (STRING) [REQUIRED, UNIQUE]
│   ├── Field: title (STRING) [REQUIRED]
│   └── Field: credits (INT) [MIN 1, MAX 6, DEFAULT 3]
├── Relation: Department OFFERS Course (ONE_TO_MANY)
└── Relation: Student ENROLLS_IN Course (MANY_TO_MANY)
```

### Step 3: Semantic Analysis
The analyzer checks:
- Entity and field names are unique and non-reserved.
- Primary keys are valid and unique per entity.
- `MIN` and `MAX` boundaries are numerically consistent (`17 <= 65`, `0.0 <= 4.0`, `1 <= 6`).
- `MIN_LENGTH` and `MAX_LENGTH` boundaries are non-negative integers in a consistent range (`2 <= 80`).
- Defaults are type-compatible and satisfy applicable numeric and STRING-length validations.
- Relationship source and target entities exist without self-references.
- Populates the global Symbol Table.

### Step 4: IR Generation
Emits linear instructions:
1. `CREATE_ENTITY Department`
2. `ADD_FIELD Department.id INT [PRIMARY_KEY]`
3. `ADD_FIELD Department.name STRING [REQUIRED, UNIQUE]`
4. `ADD_FIELD Department.budget FLOAT [MIN 10000, DEFAULT 50000]`
5. `CREATE_ENTITY Student`
...
16. `CREATE_RELATION Department OFFERS Course ONE_TO_MANY`
17. `CREATE_RELATION Student ENROLLS_IN Course MANY_TO_MANY`

### Step 5: Optimization
Runs the 6 optimization passes:
- Canonical constraint ordering (`PRIMARY_KEY` -> `REQUIRED` -> `UNIQUE`).
- Duplicate validation and field elimination.
- Confirms IR passes internal schema validation.

### Step 6: Code Generation
Writes all target files into `output/` with database schemas, models, controllers, routers, and documentation.

---

## 14. Generated Output

The compiler generates a modular Express.js project in `output/`:

| File / Folder | Purpose |
|:---|:---|
| `output/database/schema.sql` | MySQL DDL table creations, constraints, and relationships. |
| `output/config/db.js` | MySQL2 connection pool with environment variable fallbacks. |
| `output/.env.example` | Template for port and database credentials (`DB_HOST`, `DB_USER`, etc.). |
| `output/package.json` | Generated backend metadata, runtime dependencies, and `npm start` script. |
| `output/README.md` | Installation, database setup, route, and startup instructions for the generated project. |
| `output/models/<Entity>.js` | Asynchronous CRUD queries and relationship helper methods. |
| `output/controllers/<entity>Controller.js` | Express request handlers with automatic `validate<Entity>()` logic. |
| `output/routes/<entity>Routes.js` | REST routes and relationship sub-routes. |
| `output/server.js` | Express server registering all routes, JSON parsing, and error handling. |
| `output/swagger.json` | OpenAPI 3.0 API documentation for all endpoints and schemas. |

---

## 15. Generated REST API

For each declared entity, APIForge generates standard RESTful CRUD endpoints under the pluralized resource path (`/<plural>`).

### Standard CRUD Endpoints

| HTTP Method | Route Path | Description | Success Code | Error Codes |
|:---|:---|:---|:---:|:---:|
| `GET` | `/api/<plural>` | Fetch all records | `200 OK` | `500 Internal Error` |
| `GET` | `/api/<plural>/:id` | Fetch single record by ID | `200 OK` | `404 Not Found`, `500` |
| `POST` | `/api/<plural>` | Create new record | `201 Created` | `400 Bad Request`, `500` |
| `PUT` | `/api/<plural>/:id` | Update record by ID | `200 OK` | `400 Bad Request`, `404`, `500` |
| `DELETE` | `/api/<plural>/:id` | Delete record by ID | `200 OK` | `404 Not Found`, `500` |

### Relationship Endpoints

Depending on the cardinality, relationship endpoints are automatically appended to the source entity's router:

| Cardinality | Method & Path | Description | Status Code |
|:---|:---|:---|:---:|
| **MANY_TO_MANY** | `GET /api/<sources>/:id/<targets>` | List associated target records | `200 OK` |
| **MANY_TO_MANY** | `POST /api/<sources>/:id/<targets>/:<target>Id` | Link target record to source | `201 Created` |
| **MANY_TO_MANY** | `DELETE /api/<sources>/:id/<targets>/:<target>Id` | Unlink target record from source | `200 OK` |
| **ONE_TO_MANY** | `GET /api/<sources>/:id/<targets>` | List children associated with source | `200 OK` |
| **MANY_TO_ONE** | `GET /api/<sources>/:id/<target>` | Get parent associated with source | `200 OK` / `404` |
| **ONE_TO_ONE** | `GET /api/<sources>/:id/<target>` | Get single related target record | `200 OK` / `404` |

### Validation Behavior
When a `POST` or `PUT` request is made:
1. The controller invokes `validate<Entity>(req.body)`.
2. If any field violates numeric or STRING length bounds, the API immediately returns:
   ```json
   {
       "success": false,
       "error": "Field 'username' length must be >= 3."
   }
   ```
   with an **HTTP 400 Bad Request** status code.
3. Omitted fields in `PUT` updates are tolerated, relying on database defaults.

---

## 16. Generated SQL

The generated `output/database/schema.sql` uses standard MySQL DDL.

### Representative Example

```sql
-- ============================================================
-- MySQL Database Schema
-- Generated automatically by APIForge Compiler
-- ============================================================

CREATE TABLE `Department` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL UNIQUE,
    `budget` FLOAT DEFAULT 50000 CHECK (`budget` >= 10000)
);

CREATE TABLE `Student` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `fullName` VARCHAR(255) NOT NULL CHECK (CHAR_LENGTH(`fullName`) >= 2 AND CHAR_LENGTH(`fullName`) <= 80),
    `email` VARCHAR(255) NOT NULL UNIQUE,
    `age` INT DEFAULT 20 CHECK (`age` >= 17 AND `age` <= 65),
    `gpa` FLOAT DEFAULT 3 CHECK (`gpa` >= 0 AND `gpa` <= 4),
    `isActive` BOOLEAN DEFAULT TRUE
);

CREATE TABLE `Course` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `code` VARCHAR(255) NOT NULL UNIQUE,
    `title` VARCHAR(255) NOT NULL,
    `credits` INT DEFAULT 3 CHECK (`credits` >= 1 AND `credits` <= 6)
);

-- ============================================================
-- Relationship Tables & Foreign Key Constraints
-- ============================================================

-- Relationship: Department OFFERS Course (ONE_TO_MANY)
ALTER TABLE `Course` ADD COLUMN `department_id` INT;
ALTER TABLE `Course` ADD CONSTRAINT `fk_course_department` FOREIGN KEY (`department_id`) REFERENCES `Department`(`id`) ON DELETE SET NULL;

-- Relationship: Student ENROLLS_IN Course (MANY_TO_MANY)
CREATE TABLE `Student_Course` (
    `student_id` INT NOT NULL,
    `course_id` INT NOT NULL,
    PRIMARY KEY (`student_id`, `course_id`),
    FOREIGN KEY (`student_id`) REFERENCES `Student`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`course_id`) REFERENCES `Course`(`id`) ON DELETE CASCADE
);
```

### Key SQL Characteristics:
- **MySQL Reserved Words**: Identifiers matching MySQL keywords (e.g. `Order`, `Group`, `Key`) are quoted with backticks.
- **Foreign Key Constraints**: Formed using deterministic naming (`fk_<target>_<source>`).
- **Check Constraints**: Numeric checks are synthesized from `MIN` / `MAX`; STRING checks use `CHAR_LENGTH` for `MIN_LENGTH` / `MAX_LENGTH`.

---

## 17. Swagger/OpenAPI

APIForge generates an OpenAPI 3.0.0 specification in `output/swagger.json`.

### Specification Features:
1. **Path Definitions**: Defines paths for all entity CRUD routes and relationship operations.
2. **Parameters**: Path parameters (`id`, `targetId`) are documented with `in: "path"`, `required: true`, and type `integer`.
3. **Request Bodies**: `POST` and `PUT` endpoints declare `requestBody` referencing the entity schema under `#/components/schemas/<Entity>`.
4. **Schema Properties**:
   - `INT` maps to `type: "integer"`.
   - `STRING` maps to `type: "string"`.
   - `FLOAT` maps to `type: "number"`.
   - `BOOLEAN` maps to `type: "boolean"`.
   - `MIN` / `MAX` map to `minimum` and `maximum` properties.
   - `MIN_LENGTH` / `MAX_LENGTH` map to `minLength` and `maxLength` properties.
   - `DEFAULT` maps to the `default` property.
   - `REQUIRED` populates the schema's `required: [...]` array.

---

## 18. Error Handling

APIForge is built to provide actionable, human-friendly compiler errors.

### Diagnostics Architecture:

Compiler failures expose the shared JSON diagnostic contract: phase, stable code,
severity, message, symbolic identifier, 1-based line/column, optional exclusive
end positions and deterministic hint. Unknown positions are null; unavailable
ranges and hints are omitted. Existing error messages and symbolic identifiers
remain available for compatibility. See [Structured compiler diagnostics](structured-diagnostics.md)
for the complete code registry, HTTP statuses and consumer contract.

Lexer/parser failures stop immediately. Semantic analysis retains its existing
collection of errors; subsequent phases are skipped on failure. Existing typo
suggestions remain in messages. The CLI and playground share source-frame
calculation and render actual ranges or a single caret when only a start is known.

### Compiler Error Examples:

#### 1. Malformed Decimal

```text
LEX004: Malformed numeric literal: expected a digit after the decimal point.
  --> line 2, column 21
2 | cgpa FLOAT DEFAULT 8.
  |                     ^
Hint: A decimal point must be followed by a digit, for example 8.0.
[ABORT] Compilation stopped during lexer.
```

#### 2. Missing Field Datatype

```text
PAR012: Missing data type for field 'age'.
Expected one of: INT, STRING, FLOAT, BOOLEAN.
  --> line 2, column 4
2 | age
  |    ^
[ABORT] Compilation stopped during parser.
```

#### 3. Reversed Numeric Bounds

```text
SEM017: MIN value 60 cannot be greater than MAX value 18.
  --> line 2, column 9
2 | age INT MIN 60 MAX 18
  |         ^^^^^^
Hint: MIN must not exceed MAX.
```

---

## 19. Common Mistakes

Here are frequent mistakes and how the compiler responds:

| Mistake | Example Code | Compiler Diagnostic | How to Fix |
|:---|:---|:---|:---|
| **Lowercase Keywords** | `entity Student` | `Expected ENTITY declaration but found IDENTIFIER "entity"` | Always use uppercase `ENTITY`. |
| **Lowercase Datatype** | `name string` | `Expected DATATYPE but found IDENTIFIER "string". Did you mean 'STRING'?` | Always use uppercase `STRING`. |
| **Missing Datatype** | `name REQUIRED` | `Expected DATATYPE but found MODIFIER "REQUIRED"` | Specify data type before modifier: `name STRING REQUIRED`. |
| **Self-Referential Relation** | `RELATION User HAS User ONE_TO_ONE` | `Self-referential relationships are not supported: 'User' cannot relate to itself` | Remove or model relationship via separate entities. |
| **Non-Existent Relation Target** | `RELATION Student IN Class ONE_TO_ONE` | `Target entity 'Class' in relationship 'IN' does not exist.` | Declare the `ENTITY Class` before referencing it. |
| **Float Bound on INT** | `age INT MIN 18.5` | `Validation 'MIN' value for INT field 'age' must be an integer, but found 18.5.` | Use integer values for INT bounds (`MIN 18`). |
| **Inverted MIN/MAX** | `age INT MIN 65 MAX 18` | `MIN value 65 cannot be greater than MAX value 18.` | Ensure `MIN <= MAX`. |
| **Length Rule on Non-STRING** | `age INT MIN_LENGTH 2` | `Validation 'MIN_LENGTH' is only allowed for STRING fields.` | Use `MIN_LENGTH` / `MAX_LENGTH` only on `STRING`; use `MIN` / `MAX` for numeric fields. |
| **Negative STRING Length** | `name STRING MIN_LENGTH -1` | `Validation 'MIN_LENGTH' value on field 'name' must be a non-negative integer.` | Use zero or a positive integer. |
| **Inverted STRING Length** | `name STRING MIN_LENGTH 5 MAX_LENGTH 3` | `MIN_LENGTH value 5 cannot be greater than MAX_LENGTH value 3.` | Ensure `MIN_LENGTH <= MAX_LENGTH`. |
| **Default Outside Bounds** | `age INT MIN 18 MAX 60 DEFAULT 12` | `Default value 12 is less than MIN value 18.` | Choose a default value within `[MIN, MAX]`. |
| **Multiple Primary Keys** | `id INT PRIMARY KEY`<br>`uuid STRING PRIMARY KEY` | `Entity 'User' cannot have multiple primary keys.` | Use at most one primary key per entity. |
| **Duplicate Fields** | `email STRING`<br>`email STRING` | `Duplicate field 'email' in entity 'User'.` | Remove the duplicate field name. |

---

## 20. Full Example

The following standalone `.apiforge` specification demonstrates all supported features in a single, fully compilable program.

You can save this file as `samples/ecommerce.apiforge` and compile it immediately:

```apiforge
// ============================================
// APIForge DSL - E-Commerce Store Example
// File: ecommerce.apiforge
// ============================================

ENTITY Customer
    id INT PRIMARY KEY
    username STRING REQUIRED UNIQUE
    email STRING REQUIRED UNIQUE
    age INT MIN 18 MAX 100 DEFAULT 25
    loyaltyPoints INT MIN 0 DEFAULT 0
    isVip BOOLEAN DEFAULT FALSE

ENTITY Order
    id INT PRIMARY KEY
    orderNumber STRING REQUIRED UNIQUE
    totalAmount FLOAT MIN 0.0 DEFAULT 0.0
    status STRING DEFAULT "pending"

ENTITY Product
    id INT PRIMARY KEY
    sku STRING REQUIRED UNIQUE
    name STRING REQUIRED
    price FLOAT MIN 0.01 DEFAULT 9.99
    stockCount INT MIN 0 DEFAULT 100

// 1. One Customer places many Orders (ONE_TO_MANY)
RELATION Customer PLACED Order ONE_TO_MANY

// 2. Orders contain many Products, Products appear in many Orders (MANY_TO_MANY)
RELATION Order CONTAINS Product MANY_TO_MANY
```

To compile this specification:
```bash
node index.js samples/ecommerce.apiforge
```

---

## 21. CLI Reference

All CLI commands are defined in `package.json` and executed via npm or node:

### 1. `npm install`
Installs project dependencies (`express`, `mysql2`, `dotenv`).

### 2. `npm run dev`
Launches the interactive Web Playground server at **http://localhost:3001** via `server.js`.

### 3. `npm start`
Alias for launching the Web Playground server (`node server.js`).

### 4. `npm test`
Runs the complete test suite (`node tests/test.js`). Executes 1000+ unit, integration, and end-to-end tests across all compiler phases.

### 5. `npm run compile`
Executes the CLI compiler on the baseline sample file:
```bash
node index.js samples/student.apiforge
```

### 6. `node index.js <path-to-file>`
Compiles an arbitrary `.apiforge` file into `output/`. Prints phase-by-phase diagnostics (Token Table, AST, Symbol Table, IR instructions, Optimizer passes, and generated files summary).

---

## 22. Generated Project Usage

Once you compile a DSL file, follow these steps to run and test the generated backend:

### Step 1: Enter the Generated Project and Install Dependencies
```bash
cd output
npm install
```

### Step 2: Configure Environment
Copy `.env.example` to `.env` and adjust your MySQL credentials:
```bash
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=apiforge_db
```

### Step 3: Create the MySQL Database & Import Schema
Run the schema script against your MySQL instance:
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS apiforge_db;"
mysql -u root -p apiforge_db < database/schema.sql
```

### Step 4: Start the Generated API Server
Run the generated Express server through its package script:
```bash
npm start
```
The server starts listening on port 3000:
```text
APIForge server listening on port 3000
```

### Step 5: Test Endpoints
Test the health check:
```bash
curl http://localhost:3000/health
```

Create a new customer (POST):
```bash
curl -X POST http://localhost:3000/customers \
     -H "Content-Type: application/json" \
     -d '{"username": "john_doe", "email": "john@example.com", "age": 28}'
```

Fetch all customers (GET):
```bash
curl http://localhost:3000/customers
```

Trigger input validation error (age < 18):
```bash
curl -X POST http://localhost:3000/customers \
     -H "Content-Type: application/json" \
     -d '{"username": "kid", "email": "kid@example.com", "age": 15}'
```
Response (HTTP 400):
```json
{
    "success": false,
    "error": "Field 'age' must be >= 18."
}
```

---

## 23. FAQ

### What is APIForge?
APIForge is a domain-specific language (DSL) and compiler for rapid backend development. It enables developers to define data schemas and relationships in a simple declarative syntax and automatically generates a production-ready MySQL database schema, an Express.js REST API with models and controllers, and an OpenAPI 3.0 specification.

### Is APIForge a programming language?
APIForge is a **domain-specific declarative language**, not a general-purpose programming language. It lacks control-flow primitives like loops (`for`, `while`) or arbitrary conditional branching (`if/else`). It is designed specifically for expressing data structures, validations, and entity relationships.

### Is SQL the language being compiled?
No. APIForge DSL is the input language. SQL is one of the target languages emitted by the compiler's code generator.

### Why is MySQL involved?
MySQL is the relational database target for APIForge code generation. The compiler produces relational DDL tables, foreign keys, and parameterized queries designed for the `mysql2/promise` driver.

### Why do we have IR (Intermediate Representation)?
The Intermediate Representation (IR) decouples the front-end (lexer, parser, semantic analyzer) from the back-end (code generator). By converting the AST into target-independent IR instructions (`CREATE_ENTITY`, `ADD_FIELD`, `CREATE_RELATION`), the compiler can:
1. Apply general optimizations (Passes 1-6) without caring about MySQL or Express syntax.
2. Allow adding future database targets (e.g., PostgreSQL, SQLite) without modifying the parser.

### What does the optimizer do?
The optimizer executes six target-independent passes on the IR:
1. **Constraint Normalization**: De-duplicates and sorts field constraints deterministically (`PRIMARY_KEY` -> `REQUIRED` -> `UNIQUE`).
2. **Duplicate Validation Elimination**: Removes redundant identical validation rules on the same field.
3. **Validation Order Normalization**: Orders validations consistently (`MIN` before `MAX`).
4. **Duplicate Entity Elimination**: Removes redundant entity definitions.
5. **Duplicate Field Elimination**: Removes identical duplicate field declarations.
6. **Duplicate Relationship Elimination**: Removes redundant relationship instructions.

### What happens when compilation fails?
The compiler stops and prints formatted diagnostics:
- For lexical or syntax errors: It stops immediately, displays the error code, message, line, column, and draws a code frame with a caret under the error.
- For semantic errors: It collects all errors across the file and reports them together in a consolidated list with line and column positions.
- When an error occurs, no output files are written.

### What gets generated?
Every successful compilation produces ten core components in `output/`:
1. `database/schema.sql` (MySQL DDL schema)
2. `config/db.js` (MySQL connection pool configuration)
3. `.env.example` (Environment variables template)
4. `package.json` (Generated project metadata, runtime dependencies, and start script)
5. `README.md` (Generated-project setup guide)
6. `models/<Entity>.js` (Data access objects with SQL queries)
7. `controllers/<entity>Controller.js` (Request handlers & boundary validation)
8. `routes/<entity>Routes.js` (Express router endpoints)
9. `server.js` (Express application entry point)
10. `swagger.json` (OpenAPI 3.0 API document)
