'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Test-owned sources. Never extract schemas from frontend runtime code.
const PROFESSOR_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures/professor-workspace.apiforge'), 'utf8').trimEnd();
const STUDENT_SOURCE = 'ENTITY Student\nid INT PRIMARY KEY\nname STRING REQUIRED\nage INT';
const LIBRARY_SOURCE = `ENTITY Author
id INT PRIMARY KEY
name STRING REQUIRED
ENTITY Book
id INT PRIMARY KEY
title STRING REQUIRED
RELATION Author WRITES Book ONE_TO_MANY`;
const UUID_RELATION_SOURCE = `ENTITY User
id UUID PRIMARY KEY
email STRING REQUIRED UNIQUE
token UUID
ENTITY Group
id UUID PRIMARY KEY
label STRING
RELATION User JOINS Group MANY_TO_MANY`;

module.exports = { PROFESSOR_SOURCE, STUDENT_SOURCE, LIBRARY_SOURCE, UUID_RELATION_SOURCE };
