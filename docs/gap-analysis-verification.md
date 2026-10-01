# APIForge gap-analysis verification evidence

Baseline: `e8ccc0acfe13d31422400637e2e0f0bd70405c01`, main, initially 0 ahead/0 behind, independently matched live origin/main on 2026-10-01. Host: Windows PowerShell, Node v24.14.0. No behavior was changed. This companion records audit evidence for [APIForge-Gap-Analysis.md](APIForge-Gap-Analysis.md).

## Commands and limits

Commands were run from `C:\Project\APIForge` unless explicitly isolated:

~~~powershell
git status --short
git branch --show-current
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/main
git ls-remote origin refs/heads/main
npm test
node docs/verify-language-guide.js
node "$env:TEMP\apiforge-gap-probe.js"
git diff --check
git diff --cached --check
~~~

The scratch probe below used the installed runtime dependencies, compiled source through the real six-phase modules, loaded generated CommonJS modules, executed emitted handlers/routers, and captured queries with mock pools. It did not mutate compiler code or repository output. Local HTTP listeners used ephemeral ports and closed in finally blocks. Its disposable disk tree was removed after failure-path checks; no DB was created.

The existing offline command passed: main suite 1060 passed/0 failed; STRING length 25; disk generation PASS; MySQL safety PASS; diagnostics 53; warnings 26; ENUM 16; collection 9 groups. Counts mix individual assertions/groups and should not be summed as homogeneous tests. The guide verifier passed 18 valid/59 invalid examples, parsed 120 emitted JS files and ran 77 real CLI invocations in temporary directories.

No APIFORGE_TEST_DB_* integration credentials were set. A bounded read-only connection probe with the generated default host/port/root/empty password failed ER_ACCESS_DENIED_ERROR; connection closed, no schema/DB created. Opt-in npm-install/start and MySQL harnesses were inspected but not run. Database-specific conclusions use generated SQL plus linked official MySQL references in the report; they are not historical/live integration PASS claims.

## Captured observations

Probe totals: 864 validation-operation cases, 20 default/constraint cases, 12 relationship variants, 16 named cases, 10 generated HTTP writes and 6 compiler-API checks.

~~~json
{
  "implicitCreate": {
    "name": "Alice",
    "age": 20
  },
  "implicitQueries": [
    {
      "sql": "SELECT * FROM Student WHERE name = ?",
      "values": [
        42
      ]
    },
    {
      "sql": "UPDATE Student SET ? WHERE name = ?",
      "values": [
        {
          "age": 20
        },
        42
      ]
    },
    {
      "sql": "SELECT * FROM Student WHERE name = ?",
      "values": [
        42
      ]
    },
    {
      "sql": "DELETE FROM Student WHERE name = ?",
      "values": [
        42
      ]
    },
    {
      "sql": "INSERT INTO Student SET ?",
      "values": [
        {
          "name": "Alice",
          "age": 20
        }
      ]
    },
    {
      "sql": "SELECT * FROM Student WHERE id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
      "values": [
        42,
        20,
        0
      ]
    }
  ],
  "explicitCreate": {
    "id": 42,
    "name": "Alice",
    "age": 20
  },
  "implicitDeleteSimulator": {
    "returned": true,
    "remaining": 0,
    "queries": [
      {
        "sql": "DELETE FROM Student WHERE name = ?",
        "values": [
          "shared"
        ]
      }
    ]
  },
  "pkMutationSimulator": {
    "response": {
      "status": 404,
      "body": {
        "success": false,
        "error": "Item not found"
      }
    },
    "stored": {
      "key": "new",
      "name": "Alice"
    },
    "queries": [
      {
        "sql": "UPDATE Item SET ? WHERE `key` = ?",
        "values": [
          {
            "key": "new"
          },
          "old"
        ]
      },
      {
        "sql": "SELECT * FROM Item WHERE `key` = ?",
        "values": [
          "old"
        ]
      }
    ]
  },
  "defaultedPkResponses": [
    {
      "spec": "INT PRIMARY KEY DEFAULT 7",
      "response": {
        "key": 0,
        "name": "Alice"
      }
    },
    {
      "spec": "STRING PRIMARY KEY DEFAULT \"seed\"",
      "response": {
        "key": 0,
        "name": "Alice"
      }
    }
  ],
  "errorResponses": [
    {
      "fn": "createItem",
      "response": {
        "status": 500,
        "body": {
          "success": false,
          "error": "Duplicate entry 'private@example.com' for key 'User.email'"
        }
      }
    },
    {
      "fn": "updateItem",
      "response": {
        "status": 500,
        "body": {
          "success": false,
          "error": "SQL constraint failed: private table"
        }
      }
    },
    {
      "fn": "getItems",
      "response": {
        "status": 500,
        "body": {
          "success": false,
          "error": "Unable to retrieve collection."
        }
      }
    }
  ],
  "missingAssociation": {
    "status": 200,
    "body": {
      "success": true,
      "message": "Association removed successfully"
    }
  },
  "formatter": {
    "unknown": "UPDATE Item SET `unknown` = 1, `parent_id` = 2, `id` = 3 WHERE id = 42",
    "injection": "INSERT INTO Item SET `name` = 'x\\'; DROP TABLE Item; --'",
    "nested": "INSERT INTO Item SET `name` = '[object Object]'"
  },
  "booleanDriverPacket": {
    "active": 1
  },
  "diskFailure": {
    "error": "Cannot write generated output: 'config' must be a real directory.",
    "schemaChanged": true,
    "files": [
      "config",
      "database"
    ]
  },
  "unverifiedFileSymlink": {
    "unavailable": "EPERM"
  }
}
~~~

The implicit delete and mutable-PK checks use stateful simulations of the captured emitted queries, not a substitute DB engine. Default-PK response checks inject a successful insertId=0 result; the code path is verified, while live default insertion remains unverified. A file-symlink test could not create its link (EPERM) and therefore proves no symlink-write exploit. This concern is excluded from the gap count.

### Naming observations

| Case | Symbols | Duplicate exact generated files | JS syntax errors | OpenAPI paths |
|---|---|---|---|---|
| case | Student, student | controllers/studentController.js, routes/studentRoutes.js | server.js: Identifier 'studentRoutes' has already been declared | /students, /students/{id} |
| lowercase | Foo, FOO | (none) | (none) | /foos, /foos/{id} |
| plural | Category, Categorie | (none) | (none) | /categories, /categories/{id} |
| columns | Item | (none) | (none) | /items, /items/{id} |
| repeatedMany | Parent, Child | (none) | (none) | /parents, /parents/{id}, /childs, /childs/{id}, /parents/{id}/childs, /parents/{id}/childs/{childId} |
| repeatedFk | Parent, Child | (none) | (none) | /parents, /parents/{id}, /childs, /childs/{id}, /parents/{id}/childs, /parents/{id}/child |
| existingFk | Parent, Child | (none) | (none) | /parents, /parents/{id}, /childs, /childs/{id}, /parents/{id}/childs |
| existingJunction | Parent, Child, Parent_Child | (none) | (none) | /parents, /parents/{id}, /childs, /childs/{id}, /parent_childs, /parent_childs/{id}, /parents/{id}/childs, /parents/{id}/childs/{childId} |
| collectionHandler | Category, Categorie | (none) | (none) | /categories, /categories/{id}, /categories/{id}/categories |
| relationProto | Parent, Child | (none) | (none) | /parents, /parents/{id}, /childs, /childs/{id}, /parents/{id}/childs |
| entityProto | (none) | (none) | (none) | /__proto__s, /__proto__s/{id} |
| entityConstructor | (none) | (none) | (none) | /constructors, /constructors/{id} |
| entityRelations | (none) | (none) | (none) | /relationses, /relationses/{id} |
| entityEntities | (none) | (none) | (none) | /entitieses, /entitieses/{id} |
| fieldProto | Item | (none) | (none) | /items, /items/{id} |
| pkProto | Item | (none) | (none) | /items, /items/{id} |

Exact-filename uniqueness is insufficient on Windows: Foo/FOO paths collide case-insensitively. Same-pair distinct source relation names compile; generated junction/helper/API names omit those names. Prototype field/schema omissions are visible in the probe's own Object.keys checks, not a claim of global prototype pollution.

### Real HTTP write observations

~~~json
[
  {
    "method": "POST",
    "body": {},
    "status": 201,
    "data": {
      "success": true,
      "data": {}
    }
  },
  {
    "method": "POST",
    "body": {
      "age": "20",
      "name": 123
    },
    "status": 201,
    "data": {
      "success": true,
      "data": {
        "age": "20",
        "name": 123
      }
    }
  },
  {
    "method": "POST",
    "body": {
      "id": 1.5
    },
    "status": 201,
    "data": {
      "success": true,
      "data": {
        "id": 1.5
      }
    }
  },
  {
    "method": "POST",
    "body": {
      "unknown": 5
    },
    "status": 201,
    "data": {
      "success": true,
      "data": {
        "unknown": 5
      }
    }
  },
  {
    "method": "POST",
    "body": [],
    "status": 201,
    "data": {
      "success": true,
      "data": []
    }
  },
  {
    "method": "PUT",
    "body": {},
    "status": 200,
    "data": {
      "success": true,
      "data": {}
    }
  },
  {
    "method": "PUT",
    "body": {
      "age": "20",
      "name": 123
    },
    "status": 200,
    "data": {
      "success": true,
      "data": {
        "age": "20",
        "name": 123
      }
    }
  },
  {
    "method": "PUT",
    "body": {
      "id": 1.5
    },
    "status": 200,
    "data": {
      "success": true,
      "data": {
        "id": 1.5
      }
    }
  },
  {
    "method": "PUT",
    "body": {
      "unknown": 5
    },
    "status": 200,
    "data": {
      "success": true,
      "data": {
        "unknown": 5
      }
    }
  },
  {
    "method": "PUT",
    "body": [],
    "status": 200,
    "data": {
      "success": true,
      "data": []
    }
  }
]
~~~

These successful HTTP statuses use mock model success, proving insufficient pre-DB validation. They do not establish that MySQL accepts those payloads. PUT omission/default policy is partial update; generated model code supplies only requested assignments and rereads for an empty payload.

## Reproduce the full probe

Extract the following javascript fence to `$env:TEMP\apiforge-gap-probe.js` and run the command above from the repository. The repository root may alternatively be supplied as its first argument. It writes `apiforge-gap-results.json` under the OS temporary directory for inspection. This is an audit script embedded in documentation, not a new npm test or feature implementation. Unexpected errors exit nonzero; accepted defects are captured as observations, not treated as passing corrective regressions.

Probe source SHA-256 (fence content without terminal newline): `e92a66c9bd90246f6e0f6c29911632e842cb8bd441f8c4758d73697901d3ba77`.

~~~javascript
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(process.argv[2] || process.cwd());
const from = p => require(path.join(root, p));
const Lexer = from('src/lexer/lexer');
const Parser = from('src/parser/parser');
const Semantic = from('src/semantic/analyzer');
const IR = from('src/ir/generator');
const Optimizer = from('src/optimizer/optimizer');
const Codegen = from('src/codegen/codegen');
const express = from('node_modules/express');
const results = {};
function compile(source) {
  const ast = Parser.parse(Lexer.tokenize(source));
  const semantic = Semantic.analyze(ast);
  assert.equal(semantic.valid, true, JSON.stringify(semantic.errors));
  const ir = IR.generate(ast, semantic);
  const optimized = Optimizer.optimize(ir).ir;
  const files = Codegen.generate(optimized, false).files;
  return { source, ast, semantic, ir, optimized, files };
}
const file = (c, p) => c.files.find(f => f.path === p).content;
function load(source, dependency) {
  const module = { exports: {} };
  vm.compileFunction(source, ['require', 'module'])(dependency, module);
  return module.exports;
}
function model(c, name, answer = sql => /^SELECT/.test(sql) ? [{ id: 42, name: 'Alice' }] : { insertId: 42, affectedRows: 1 }) {
  const calls = [];
  const m = load(file(c, `models/${name}.js`), () => ({ query: async (sql, values) => {
    calls.push({ sql, values }); return [answer(sql, values)];
  }}));
  return { m, calls };
}
async function invoke(handler, body, params = { id: '42' }) {
  let response;
  const res = { status(code) { this.code = code; return this; }, json(data) { response = { status: this.code, body: data }; return this; }, set() {} };
  await handler({ body, params, query: {} }, res);
  return response;
}
async function main() {
  const implicit = compile('ENTITY Student\nname STRING\nage INT');
  const explicit = compile('ENTITY Student\nid INT PRIMARY KEY\nname STRING\nage INT');
  results.pk = {};
  for (const [kind, c] of [['implicit', implicit], ['explicit', explicit]]) {
    const { m, calls } = model(c, 'Student');
    await m.findById(42); await m.update(42, { age: 20 }); await m.delete(42);
    const created = await m.create({ name: 'Alice', age: 20 });
    await m.findAll(m.parseQuery({ id: '42', page: '1' }));
    results.pk[kind] = { ast: c.ast.entities[0].fields.map(f => f.name), symbols: Object.keys(c.semantic.symbolTable.Student.fields), ir: c.ir.instructions, optimized: c.optimized.instructions, calls, created, sql: file(c, 'database/schema.sql'), swagger: JSON.parse(file(c, 'swagger.json')) };
  }
  assert.equal(results.pk.implicit.created.name, 'Alice');
  assert.equal(results.pk.implicit.created.id, undefined);
  assert.match(results.pk.implicit.calls[0].sql, /WHERE name =/);
  assert.match(results.pk.explicit.calls[0].sql, /WHERE id =/);
  const collision = compile('ENTITY Student\nid STRING\nname STRING');
  results.idCollision = { sql: file(collision, 'database/schema.sql'), swagger: JSON.parse(file(collision, 'swagger.json')) };
  results.validation = [];
  const specs = ['INT', 'INT MIN 18 MAX 60', 'FLOAT', 'FLOAT MIN 0 MAX 10', 'BOOLEAN', 'STRING', 'STRING MIN_LENGTH 2 MAX_LENGTH 4', 'ENUM("active", "inactive")'];
  const values = [['omitted', undefined], ['null', null], ['number', 20], ['fraction', 20.5], ['unsafe', 9007199254740992], ['infinity', Infinity], ['nan', NaN], ['numeric-string', '20'], ['nonnumeric-string', 'abc'], ['bool', false], ['bool-string', 'false'], ['short', 'a'], ['bounded-string', 'abc'], ['long', 'abcde'], ['enum-member', 'active'], ['enum-invalid', 'deleted'], ['array', [20]], ['object', {}], ['below-int',17], ['above-int',61], ['int-min',18], ['int-max',60], ['float-min',0], ['float-max',10], ['bounded-float',1.5], ['length-min','ab'], ['length-max','abcd']];
  for (const spec of specs) for (const required of [false, true]) {
    const c = compile(`ENTITY Item\nid INT PRIMARY KEY\nvalue ${spec}${required ? ' REQUIRED' : ''}`);
    const calls = [];
    const ctrl = load(file(c, 'controllers/itemController.js'), () => ({ create: async data => { calls.push(data); return data; }, update: async (id, data) => { calls.push(data); return data; } }));
    for (const operation of ['POST', 'PUT']) for (const [label, value] of values) {
      const body = value === undefined ? {} : { value };
      const before = calls.length;
      const response = await invoke(ctrl[operation === 'POST' ? 'createItem' : 'updateItem'], body);
      results.validation.push({ spec, required, operation, value: label, status: response.status, modelCalled: calls.length > before });
    }
  }
  results.specialWrites = [];
  for (const spec of ['INT PRIMARY KEY', 'STRING PRIMARY KEY', 'INT PRIMARY KEY DEFAULT 7', 'STRING PRIMARY KEY DEFAULT "seed"']) {
    const c = compile(`ENTITY Item\nkey ${spec}\nname STRING`);
    const { m, calls } = model(c, 'Item', sql => /^SELECT/.test(sql) ? [] : { insertId: 0, affectedRows: 1 });
    const ctrl = load(file(c, 'controllers/itemController.js'), () => m);
    const created = await m.create({ name: 'Alice' });
    const updated = await invoke(ctrl.updateItem, { key: 'new' }, { id: 'old' });
    results.specialWrites.push({ spec, created, updated, calls });
  }
  const write = compile('ENTITY Item\nid INT PRIMARY KEY\nname STRING REQUIRED\nvalue ENUM("active") DEFAULT "active"\nage INT DEFAULT 20');
  const calls = [];
  const ctrl = load(file(write, 'controllers/itemController.js'), () => ({ create: async data => { calls.push(data); return data; }, update: async (id, data) => { calls.push(data); return data; } }));
  results.body = [];
  for (const body of [{}, { id: 1.5 }, { id: 9007199254740992 }, { id: null }, { unknown: 1, item_id: 3 }, null, [], 'bad']) {
    for (const operation of ['POST', 'PUT']) results.body.push({ operation, body, response: await invoke(ctrl[operation === 'POST' ? 'createItem' : 'updateItem'], body) });
  }
  results.defaults = { calls, sql: file(write, 'database/schema.sql') };
  results.defaultMatrix = [];
  for (const spec of ['INT DEFAULT 20', 'FLOAT DEFAULT 1.5', 'BOOLEAN DEFAULT TRUE', 'STRING DEFAULT "abc"', 'ENUM("active") DEFAULT "active"']) for(const modifiers of ['', ' REQUIRED UNIQUE']) {
    const c = compile(`ENTITY Item\nid INT PRIMARY KEY\nvalue ${spec}${modifiers}`);
    const received = [];
    const controller = load(file(c, 'controllers/itemController.js'), () => ({ create: async d => { received.push(d); return d; }, update: async (id,d) => { received.push(d); return d; } }));
    for (const operation of ['POST', 'PUT']) results.defaultMatrix.push({ spec, modifiers, operation, response: await invoke(controller[operation === 'POST' ? 'createItem' : 'updateItem'], {}), received: received[received.length - 1] });
  }
  const mutation = compile('ENTITY Item\nkey STRING PRIMARY KEY\nname STRING');
  let stored = { key: 'old', name: 'Alice' };
  const mutationModel = model(mutation, 'Item', (sql, values) => {
    if (/^UPDATE/.test(sql) && values[1] === stored.key) { stored = { ...stored, ...values[0] }; return { affectedRows: 1 }; }
    if (/^SELECT/.test(sql)) return stored.key === values[0] ? [stored] : [];
    return { affectedRows: 0 };
  });
  const mutationController = load(file(mutation, 'controllers/itemController.js'), () => mutationModel.m);
  results.pkMutation = { response: await invoke(mutationController.updateItem, { key: 'new' }, { id: 'old' }), stored, queries: mutationModel.calls };
  const Packet = from('node_modules/mysql2/lib/packets/packet.js');
  const getParser = from('node_modules/mysql2/lib/parsers/text_parser.js');
  const fields = [{ name: 'active', columnType: 1, characterSet: 63, flags: 0, columnLength: 1, decimals: 0, table: 'Item' }];
  const Row = getParser(fields, {}, {}); const buffer = Buffer.from([0, 0, 0, 0, 1, 49]);
  results.booleanDriver = new Row(fields).next(new Packet(0, buffer, 0, buffer.length), fields, {});
  results.errors = [];
  const errorModel = { create: async () => { throw new Error("Duplicate entry 'private@example.com' for key 'User.email'"); }, update: async () => { throw new Error('SQL constraint failed: private table'); }, parseQuery: () => ({}), findAll: async () => { throw new Error('SQL private table'); } };
  const errorController = load(file(write, 'controllers/itemController.js'), () => errorModel);
  for (const fn of ['createItem', 'updateItem', 'getItems']) results.errors.push({ fn, response: await invoke(errorController[fn], {}) });
  results.binding = {};
  const mysql = from('node_modules/mysql2');
  results.binding.unknown = mysql.format('UPDATE Item SET ? WHERE id = ?', [{ unknown: 1, parent_id: 2, id: 3 }, 42]);
  results.binding.injection = mysql.format('INSERT INTO Item SET ?', [{ name: "x'; DROP TABLE Item; --" }]);
  results.binding.nested = mysql.format('INSERT INTO Item SET ?', [{ name: { injected: 1 } }]);
  let records = [{ id: 1, name: 'shared' }, { id: 2, name: 'shared' }];
  const deletes = model(implicit, 'Student', (sql, values) => {
    const before = records.length; records = records.filter(row => row.name !== values[0]); return { affectedRows: before - records.length };
  });
  results.implicitDelete = { returned: await deletes.m.delete('shared'), remaining: records.length, queries: deletes.calls };
  results.relationships = [];
  for (const kind of ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']) for (const pk of ['INT', 'STRING', 'implicit']) {
    const fields = pk === 'implicit' ? 'name STRING' : `key ${pk} PRIMARY KEY\nname STRING`;
    const c = compile(`ENTITY Parent\n${fields}\nENTITY Child\n${fields}\nRELATION Parent R Child ${kind}`);
    const { m, calls } = model(c, 'Parent');
    const method = kind === 'ONE_TO_MANY' || kind === 'MANY_TO_MANY' ? 'getChilds' : 'getChild';
    await m[method]('42');
    if (kind === 'MANY_TO_MANY') { await m.addChild('42', '9'); await m.removeChild('42', '9'); }
    results.relationships.push({ kind, pk, sql: file(c, 'database/schema.sql'), calls, routes: file(c, 'routes/parentRoutes.js'), swagger: JSON.parse(file(c, 'swagger.json')) });
  }
  const reserved = compile('ENTITY Parent\nselect STRING PRIMARY KEY\nENTITY Order\nkey INT PRIMARY KEY\nRELATION Parent R Order MANY_TO_MANY');
  const quoted = model(reserved, 'Parent'); await quoted.m.getOrders('a');
  results.reserved = { sql: file(reserved, 'database/schema.sql'), calls: quoted.calls };
  const missing = compile('ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nRELATION Parent R Child MANY_TO_MANY');
  const missingModel = model(missing, 'Parent', sql => /^SELECT/.test(sql) ? [] : { affectedRows: 0 });
  const missingController = load(file(missing, 'controllers/parentController.js'), () => missingModel.m);
  results.missingAssociation = await invoke(missingController.removeChild, {}, { id: '42', childId: '99' });
  const names = {
    case: 'ENTITY Student\nid INT PRIMARY KEY\nENTITY student\nid INT PRIMARY KEY',
    lowercase: 'ENTITY Foo\nid INT PRIMARY KEY\nENTITY FOO\nid INT PRIMARY KEY',
    plural: 'ENTITY Category\nid INT PRIMARY KEY\nENTITY Categorie\nid INT PRIMARY KEY',
    columns: 'ENTITY Item\nid INT PRIMARY KEY\nname STRING\nName INT',
    repeatedMany: 'ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nRELATION Parent R1 Child MANY_TO_MANY\nRELATION Parent R2 Child MANY_TO_MANY',
    repeatedFk: 'ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nRELATION Parent R1 Child ONE_TO_MANY\nRELATION Parent R2 Child ONE_TO_ONE',
    existingFk: 'ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nparent_id INT\nRELATION Parent R Child ONE_TO_MANY',
    existingJunction: 'ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nENTITY Parent_Child\nid INT PRIMARY KEY\nRELATION Parent R Child MANY_TO_MANY',
    collectionHandler: 'ENTITY Category\nid INT PRIMARY KEY\nENTITY Categorie\nid INT PRIMARY KEY\nRELATION Category R Categorie ONE_TO_MANY',
    relationProto: 'ENTITY Parent\nid INT PRIMARY KEY\nENTITY Child\nid INT PRIMARY KEY\nRELATION Parent __proto__ Child ONE_TO_MANY',
    entityProto: 'ENTITY __proto__\nid INT PRIMARY KEY',
    entityConstructor: 'ENTITY constructor\nid INT PRIMARY KEY',
    entityRelations: 'ENTITY relations\nid INT PRIMARY KEY',
    entityEntities: 'ENTITY entities\nid INT PRIMARY KEY',
    fieldProto: 'ENTITY Item\nid INT PRIMARY KEY\n__proto__ STRING',
    pkProto: 'ENTITY Item\n__proto__ STRING PRIMARY KEY'
  };
  results.names = {};
  for (const [label, source] of Object.entries(names)) {
    const c = compile(source);
    const syntaxErrors = [];
    for (const f of c.files.filter(f => f.path.endsWith('.js'))) try { vm.compileFunction(f.content, ['require', 'module']); } catch (e) { syntaxErrors.push({ file: f.path, message: e.message }); }
    const paths = c.files.map(f => f.path);
    const symbols = Object.keys(c.semantic.symbolTable);
    results.names[label] = { source, symbols, fieldSymbols: symbols.map(e => [e, Object.keys(c.semantic.symbolTable[e].fields || {})]), relations: Object.keys(c.semantic.relations), duplicateFiles: paths.filter((p, i) => paths.indexOf(p) !== i), syntaxErrors, sql: file(c, 'database/schema.sql'), models: c.files.filter(f => f.path.startsWith('models/')), controllers: c.files.filter(f => f.path.startsWith('controllers/')), routes: c.files.filter(f => f.path.startsWith('routes/')), swagger: JSON.parse(file(c, 'swagger.json')) };
  }
  results.extra = {};
  for (const [label, source] of Object.entries({ backslash: 'ENTITY Item\nid INT PRIMARY KEY\nvalue STRING DEFAULT "C:\\new"', trailingEnum: 'ENTITY Item\nid INT PRIMARY KEY\nvalue ENUM("a", "a ") DEFAULT "a "', longIdentifier: `ENTITY ${'A'.repeat(65)}\nid INT PRIMARY KEY`, hugeVarchar: 'ENTITY Item\nid INT PRIMARY KEY\nvalue STRING MAX_LENGTH 100000', hugeDefault: `ENTITY Item\nid INT PRIMARY KEY\nvalue FLOAT DEFAULT ${'9'.repeat(400)}`, roundedDefault: 'ENTITY Item\nid INT PRIMARY KEY\nvalue INT DEFAULT 9007199254740993' })) {
    const c = compile(source);
    results.extra[label] = { source, sql: file(c, 'database/schema.sql'), swagger: JSON.parse(file(c, 'swagger.json')), controller: file(c, c.files.find(f => f.path.startsWith('controllers/')).path) };
  }
  results.sampleResults = [];
  for (const name of fs.readdirSync(path.join(root, 'samples')).filter(p => p.endsWith('.apiforge'))) {
    const source = fs.readFileSync(path.join(root, 'samples', name), 'utf8');
    const ast = Parser.parse(Lexer.tokenize(source)); const semantic = Semantic.analyze(ast);
    if (semantic.valid) compile(source);
    results.sampleResults.push({ name, valid: semantic.valid, codes: semantic.diagnostics.map(d => d.code) });
  }
  const app = express(); app.use(express.json());
  app.use('/items', load(file(write, 'routes/itemRoutes.js'), p => p === 'express' ? express : ctrl));
  app.use('/api', from('src/api/compiler-api'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    results.http = [];
    for (const method of ['POST', 'PUT']) for (const body of [{}, { age: '20', name: 123 }, { id: 1.5 }, { unknown: 5 }, []]) {
      const response = await fetch(url + (method === 'POST' ? '/items' : '/items/42'), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      results.http.push({ method, body, status: response.status, data: await response.json() });
    }
    results.api = [];
    for (const label of ['entityProto', 'entityConstructor', 'entityRelations', 'entityEntities', 'fieldProto', 'case']) {
      const response = await fetch(url + '/api/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: names[label] }) });
      const data = await response.json();
      results.api.push({ label, status: response.status, success: data.success, symbols: Object.keys(data.symbolTable || {}), schemas: data.success ? Object.keys(JSON.parse(data.generatedFiles.find(f => f.path === 'swagger.json').content).components.schemas) : null });
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apiforge-gap-disk-'));
  const original = process.cwd();
  try {
    process.chdir(tmp);
    fs.mkdirSync(path.join(tmp, 'output', 'database'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'output', 'database', 'schema.sql'), 'previous schema');
    fs.writeFileSync(path.join(tmp, 'output', 'config'), 'not a directory');
    try { Codegen.generate(explicit.optimized, true); } catch (e) { results.diskFailure = { error: e.message, schemaChanged: fs.readFileSync(path.join(tmp, 'output', 'database', 'schema.sql'), 'utf8') !== 'previous schema', files: fs.readdirSync(path.join(tmp, 'output')) }; }
    fs.unlinkSync(path.join(tmp, 'output', 'config'));
    const sentinel = path.join(tmp, 'outside-user-file.txt'); fs.writeFileSync(sentinel, 'keep');
    try {
      fs.unlinkSync(path.join(tmp, 'output', 'database', 'schema.sql'));
      fs.symlinkSync(sentinel, path.join(tmp, 'output', 'database', 'schema.sql'), 'file');
      Codegen.generate(explicit.optimized, true);
      results.fileSymlink = { overwritten: fs.readFileSync(sentinel, 'utf8') !== 'keep' };
    } catch (e) { results.fileSymlink = { unavailable: e.code || e.message }; }
  } finally { process.chdir(original); const relative = path.relative(os.tmpdir(), tmp); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); fs.rmSync(tmp, { recursive: true, force: true }); }
  fs.writeFileSync(path.join(os.tmpdir(), 'apiforge-gap-results.json'), JSON.stringify(results, (k, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v, 2));
  console.log(JSON.stringify({ validationCases: results.validation.length, relationships: results.relationships.length, nameCases: Object.keys(results.names).length, samples: results.sampleResults, implicitCreated: results.pk.implicit.created, specialWrites: results.specialWrites.map(r => ({ spec: r.spec, created: r.created, updateStatus: r.updated.status })), api: results.api, disk: results.diskFailure }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
~~~

After inspecting results, remove only these named temporary probe/results files. No permanent reproduction project, database, listener or process remains from this audit. Reproduction extraction must preserve literal backslashes/newlines; do not paste the source through shell interpolation.

## Protected-artifact before/after manifest

Both snapshots covered exact full file paths, file counts, byte sizes, SHA-256, LastWriteTimeUtc and CreationTimeUtc. Snapshot comparison passed for all 36 files. PowerShell ConvertFrom-Json was called with DateKind String to preserve ISO timestamp text rather than automatically coercing it to DateTime. Re-enumeration with -Force confirmed no hidden extra files were omitted.

| Root | Files | Bytes |
|---|---|---|
| APIForge_Drive_Resources.zip | 1 | 4267514 |
| APIForge_Drive_Resources | 18 | 5489267 |
| APIForge_Overleaf_Source | 16 | 1191761 |
| APIForge_Overleaf_Source__FINAL.zip | 1 | 1029692 |

The following single manifest represents both matching snapshots. Times are UTC; hashes are SHA-256. Protected artifacts were not staged.

| Repository-relative path | Bytes | SHA-256 | Modified UTC | Created UTC |
|---|---|---|---|---|
| APIForge_Drive_Resources.zip | 4267514 | C7A6A95DB84CE16D4A2381DFFAF484ED35C6805225A9B767FD867BBAE7C2016F | 2026-09-25T11:26:58.2276552Z | 2026-09-25T10:44:59.5972535Z |
| APIForge_Drive_Resources/APIForge_Compiler_Architecture.pdf | 1114941 | 17F60546E50638A7B46B8E08B0577A965A5FCCDB062285622B49E86E1D8438A5 | 2026-09-25T10:56:47.5638583Z | 2026-09-25T06:33:20.8266865Z |
| APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-2_1.png | 313128 | 97E086C18B3A3276F82EA3309DA1279AF1043F2775C59130B6AE900B11C6BC26 | 2026-09-25T12:33:06.2808084Z | 2026-09-25T12:32:53.8394282Z |
| APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_1.png | 144469 | B89F4EBDA12496C5DC0C872911DB75F2E8B457CE68C010030A66114AD444972A | 2026-09-25T12:33:07.0916984Z | 2026-09-25T12:32:54.9628426Z |
| APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_2.png | 159916 | 29FCDF42BCDFF5DB9A2C02AEF3A183096604579F14F80D147E77F10F8B109B48 | 2026-09-25T12:33:07.5953826Z | 2026-09-25T12:32:55.7212546Z |
| APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report-3_3.png | 143478 | 471E9E8364BAEE8CF3B5BC4C0C07D53188AB6638A9FC0D5B4B37558EB15498E4 | 2026-09-25T12:33:08.3688595Z | 2026-09-25T12:32:56.2661293Z |
| APIForge_Drive_Resources/APIForge_Compiler_Lab_Project_Report.pdf | 1102750 | 5E90F1BF49CFACA997F8B89458C16A43F9DE0F2B9EFAC3613CB041ADF7EE5778 | 2026-09-25T11:23:16.1917813Z | 2026-09-25T06:33:20.7862670Z |
| APIForge_Drive_Resources/APIForge_Language_Guide.pdf | 520798 | A03C46877004956DECDE5B60DF7A03F1C5493EEE7DDEFC03040D17D8CE9BD750 | 2026-09-25T10:56:43.4376308Z | 2026-09-25T06:33:20.7983689Z |
| APIForge_Drive_Resources/APIForge_Quick_Start.pdf | 843174 | 1AA4154898768280C1ADDD5BAE066ACA4D3D99CCD7358395E36161191AE069EC | 2026-09-25T10:56:45.3825646Z | 2026-09-25T06:33:20.8096770Z |
| APIForge_Drive_Resources/DSL_Examples/basic_entity.apiforge | 152 | 0A26AA126AA93A45C80ACE44108519B4642ADDD31A417EA96EB489C841816567 | 2026-09-25T06:22:15.7532357Z | 2026-09-25T06:22:15.7532357Z |
| APIForge_Drive_Resources/DSL_Examples/complete_example.apiforge | 443 | 24C539DE30B1E4A9D94369476E605249016726FD857B59457B6D8122FDCF2722 | 2026-09-25T06:22:15.7571486Z | 2026-09-25T06:22:15.7571486Z |
| APIForge_Drive_Resources/DSL_Examples/relationships.apiforge | 201 | 08D07D450BDBBD3F9D54213A5D38AB5B014116E100DEFE6254799BF1626F9D65 | 2026-09-25T06:22:15.7561358Z | 2026-09-25T06:22:15.7561358Z |
| APIForge_Drive_Resources/DSL_Examples/validations.apiforge | 277 | 4C521F48F43F8BC37DE38E54918C84CBB2C12E0B145999591D180F38757556DA | 2026-09-25T06:22:15.7542404Z | 2026-09-25T06:22:15.7542404Z |
| APIForge_Drive_Resources/Screenshots/generated_api.png | 160133 | D8C7F2F375E761F8CDCBDE2100527662EDECDA70F0A7CBF9A6B83069F8521FE8 | 2026-09-25T06:55:37.5494659Z | 2026-09-25T06:22:02.7742888Z |
| APIForge_Drive_Resources/Screenshots/generated_sql.png | 235548 | 4D00D409D12315E16271ED404AEE5219BE7FBC79A0A180175A431F01925C342D | 2026-09-25T06:55:37.8432717Z | 2026-09-25T06:22:02.7812638Z |
| APIForge_Drive_Resources/Screenshots/lexer_error.png | 143635 | DE3F5ACF352DC8084AAF4104548E919127BC46FD50782A63BE8A8C73445986E9 | 2026-09-25T06:55:38.2243888Z | 2026-09-25T06:22:02.7832610Z |
| APIForge_Drive_Resources/Screenshots/openapi.png | 142443 | B7C8B853F2FE8FD8E62E947FF597A757EDA48BF4FA7B0C6BCE5A1F219AAD6230 | 2026-09-25T06:55:37.9953657Z | 2026-09-25T06:22:02.7887804Z |
| APIForge_Drive_Resources/Screenshots/semantic_error.png | 152739 | 82099209E727011CA806A568A80EDF0BE4D09E5F07D68C035FBB3BBF4F13B082 | 2026-09-25T06:55:38.4439090Z | 2026-09-25T06:22:02.7979179Z |
| APIForge_Drive_Resources/Screenshots/successful_compilation.png | 311042 | EB5EB0F35155110C0976D9E0DD7D06889DD3D8AAD8B583B2C10A743B35F0CD02 | 2026-09-25T06:55:37.3579774Z | 2026-09-25T06:22:02.8039222Z |
| APIForge_Overleaf_Source/apiforge-style.tex | 3846 | 7563FC6A9269C83F4FC4D4F89BD7305DF58D9F71EB2B3687D58659868F5FC386 | 2026-09-25T10:55:59.2799679Z | 2026-09-25T10:16:53.9695234Z |
| APIForge_Overleaf_Source/architecture.tex | 12452 | C4D71E8C823E1D6290FA3817E3A3A5F979DCB6E6BF20CA5C7D88F1DE07EC06F9 | 2026-09-25T10:47:25.1333404Z | 2026-09-25T10:20:00.6462880Z |
| APIForge_Overleaf_Source/language-guide.tex | 12692 | 1CAF325EF6862B9D0A28BF65B0DB8DF27AC425BC1D8F15930F054FF06E17A084 | 2026-09-25T10:30:54.1288611Z | 2026-09-25T10:18:47.7684611Z |
| APIForge_Overleaf_Source/quick-start.tex | 6425 | 253A4C3B261D5B02D61D4F85F33A3663296F2778748A25126CCC61AC3C282DEE | 2026-09-25T10:42:43.7969713Z | 2026-09-25T10:18:47.7721170Z |
| APIForge_Overleaf_Source/README.md | 1388 | 294DC75314CFB74D63DE6C2C536A17DBF65A1253852883D776C541317F1E564A | 2026-09-25T10:55:59.2814116Z | 2026-09-25T10:20:00.6496860Z |
| APIForge_Overleaf_Source/report.tex | 8345 | 61CCA730433AA7DD25C717B640B24B65B93BAEEDB7D81B894CD40E1EF25265EB | 2026-09-25T11:27:49.7218612Z | 2026-09-25T10:16:53.9707069Z |
| APIForge_Overleaf_Source/assets/generated_api.png | 160133 | D8C7F2F375E761F8CDCBDE2100527662EDECDA70F0A7CBF9A6B83069F8521FE8 | 2026-09-25T06:55:37.5494659Z | 2026-09-25T10:15:33.0000746Z |
| APIForge_Overleaf_Source/assets/generated_sql.png | 235548 | 4D00D409D12315E16271ED404AEE5219BE7FBC79A0A180175A431F01925C342D | 2026-09-25T06:55:37.8432717Z | 2026-09-25T10:15:33.0060718Z |
| APIForge_Overleaf_Source/assets/lexer_error.png | 143635 | DE3F5ACF352DC8084AAF4104548E919127BC46FD50782A63BE8A8C73445986E9 | 2026-09-25T06:55:38.2243888Z | 2026-09-25T10:15:32.9740723Z |
| APIForge_Overleaf_Source/assets/openapi.png | 142443 | B7C8B853F2FE8FD8E62E947FF597A757EDA48BF4FA7B0C6BCE5A1F219AAD6230 | 2026-09-25T06:55:37.9953657Z | 2026-09-25T10:15:33.0100738Z |
| APIForge_Overleaf_Source/assets/semantic_error.png | 152739 | 82099209E727011CA806A568A80EDF0BE4D09E5F07D68C035FBB3BBF4F13B082 | 2026-09-25T06:55:38.4439090Z | 2026-09-25T10:15:32.9790817Z |
| APIForge_Overleaf_Source/assets/successful_compilation.png | 311042 | EB5EB0F35155110C0976D9E0DD7D06889DD3D8AAD8B583B2C10A743B35F0CD02 | 2026-09-25T06:55:37.3579774Z | 2026-09-25T10:15:32.9670703Z |
| APIForge_Overleaf_Source/examples/basic_entity.apiforge | 152 | 0A26AA126AA93A45C80ACE44108519B4642ADDD31A417EA96EB489C841816567 | 2026-09-25T06:22:15.7532357Z | 2026-09-25T10:15:33.0340831Z |
| APIForge_Overleaf_Source/examples/complete_example.apiforge | 443 | 24C539DE30B1E4A9D94369476E605249016726FD857B59457B6D8122FDCF2722 | 2026-09-25T06:22:15.7571486Z | 2026-09-25T10:15:33.0390846Z |
| APIForge_Overleaf_Source/examples/relationships.apiforge | 201 | 08D07D450BDBBD3F9D54213A5D38AB5B014116E100DEFE6254799BF1626F9D65 | 2026-09-25T06:22:15.7561358Z | 2026-09-25T10:15:33.0430880Z |
| APIForge_Overleaf_Source/examples/validations.apiforge | 277 | 4C521F48F43F8BC37DE38E54918C84CBB2C12E0B145999591D180F38757556DA | 2026-09-25T06:22:15.7542404Z | 2026-09-25T10:15:33.0480835Z |
| APIForge_Overleaf_Source__FINAL.zip | 1029692 | E6BAF4A2B503A7BF174F59C92BE3A92EA0338933DE87208424497DBF733121EC | 2026-09-25T11:22:58.4073441Z | 2026-09-25T11:22:57.3946991Z |

## Deliverable boundaries

Only docs/APIForge-Gap-Analysis.md and this companion are committed. The final commit ID, ahead/behind and unchanged protected untracked paths are reported in the delivery message. Compiler, generated behavior and existing diagnostics/warnings remain untouched; no push occurred. The temporary script, results, logs, snapshot JSON and this evidence-writing helper were removed after the final checks.
