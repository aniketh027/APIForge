# Project map

| Path | Responsibility |
|---|---|
| `src/lexer/lexer.js` | Tokenization, source positions, comments, literals, and lexical errors. |
| `src/parser/parser.js` | Recursive-descent grammar, AST construction, and syntax diagnostics. |
| `src/ast/ast.js` | `ProgramNode`, `EntityNode`, `FieldNode`, and `RelationNode` shapes. |
| `src/semantic/analyzer.js` | Semantic rules; owner of entity/field and relationship symbol tables. |
| `src/ir/generator.js` | Target-independent IR generation and IR validation. |
| `src/optimizer/optimizer.js` | Six normalization and exact-duplicate-elimination passes. |
| `src/codegen/codegen.js` | MySQL, Express, runtime validation, relationship, and OpenAPI generation. |
| `src/utils/errors.js` | Suggestions, code frames, and user-facing error formatting. |
| `index.js` | CLI compiler driver; runs all phases and writes `output/`. |
| `src/api/compiler-api.js` | In-memory `GET /health` and `POST /compile` router for the playground. |
| `server.js` | Development server; serves `frontend/` and mounts the compiler router at `/api`. |
| `frontend/index.html` | Playground structure. |
| `frontend/app.js` | Editor samples, `POST /api/compile`, and phase/result rendering. |
| `frontend/style.css` | Playground presentation. |
| `samples/*.apiforge` | Current valid and invalid language examples. |
| `tests/test.js` | Custom unit, integration, compiler-API, codegen, and end-to-end test harness. |
| `docs/APIForge-Language-Guide.md` | Detailed language and generated-output guide; subordinate to code/tests. |
| `README.md` | Project overview, quick start, and high-level repository map. |
| `package.json` | Node entry point, dependencies, and `start`, `dev`, `compile`, and `test` commands. |
| `output/` | CLI-generated backend artifacts; `output/.env` is ignored. |

Use `npm test` for the full suite, `npm run compile` for the default sample, `node index.js <file.apiforge>` for another source file, and `npm run dev` for the playground.
