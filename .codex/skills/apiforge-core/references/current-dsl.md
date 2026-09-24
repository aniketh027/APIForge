# Current DSL

This describes syntax implemented by the current lexer, parser, and semantic analyzer.

## Declarations

```text
Program      := (EntityDecl | RelationDecl)*
EntityDecl   := ENTITY Identifier FieldDecl*
FieldDecl    := Identifier DataType Modifier*
RelationDecl := RELATION SourceIdentifier RelationIdentifier TargetIdentifier Cardinality
```

The parser permits zero fields syntactically, but semantic analysis rejects an entity without fields.
The parser also permits a declaration-free token stream syntactically, but semantic analysis requires every program to contain at least one `ENTITY`.

Example:

```apiforge
ENTITY Student
id INT PRIMARY KEY
name STRING REQUIRED
age INT MIN 18 MAX 60 DEFAULT 25

ENTITY Course
id INT PRIMARY KEY
title STRING UNIQUE

RELATION Student ENROLLS_IN Course MANY_TO_MANY
```

## Supported vocabulary

| Category | Supported forms |
|---|---|
| Data types | `INT`, `STRING`, `FLOAT`, `BOOLEAN` |
| Constraints | `PRIMARY KEY`, `REQUIRED`, `UNIQUE` |
| Validations | `MIN <number>`, `MAX <number>`, `MIN_LENGTH <number>`, `MAX_LENGTH <number>` |
| Default | `DEFAULT <number>`, `DEFAULT "text"`, `DEFAULT TRUE`, `DEFAULT FALSE` |
| Cardinality | `ONE_TO_ONE`, `ONE_TO_MANY`, `MANY_TO_ONE`, `MANY_TO_MANY` |

`PRIMARY` and `KEY` are separate adjacent tokens and must appear together in that order. Modifiers may be combined after a field type.

`MIN` and `MAX` apply only to numeric fields. `INT` bounds and defaults must be integers; `FLOAT` accepts numeric literals. `MIN_LENGTH` and `MAX_LENGTH` apply only to `STRING`, require non-negative integer values, and require `MIN_LENGTH <= MAX_LENGTH` when combined. A default must match the field type, satisfy applicable numeric or STRING-length bounds, and occur at most once. Each validation modifier may appear at most once per field.

## Lexical and declaration behavior

- Reserved words, data types, cardinalities, and boolean literals are uppercase and case-sensitive. Lowercase spellings are ordinary identifiers and usually cause a later syntax error.
- Identifiers start with a letter or underscore and continue with letters, digits, or underscores. Identifier matching is case-sensitive.
- `//` starts a comment through the end of its line. Block comments and `#` comments are not supported.
- String defaults use double quotes. The lexer does not implement string escape sequences.
- Numbers may be integers or decimals and may have a leading minus sign.
- Spaces, tabs, carriage returns, and newlines do not become tokens. Newlines are conventional, not strict field delimiters: fields can be separated by other whitespace. A field list ends when the parser encounters top-level `ENTITY`, `RELATION`, or EOF.
- Relations are top-level declarations and may be interleaved with entity declarations, but semantic analysis requires both referenced entity names to exist in the program.

Semantic analysis also rejects duplicate entity or field names, duplicate relationship names, reserved identifiers, more than one primary key per entity, primary keys on `FLOAT`/`BOOLEAN`, invalid ranges, missing relationship endpoints, and self-referential relationships.
