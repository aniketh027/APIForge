/**
 * ============================================================
 * APIForge Compiler - Main Entry Point
 * ============================================================
 * 
 * This is the main driver that orchestrates the entire
 * compiler pipeline. Each phase runs sequentially, passing
 * its output to the next phase — just like a real compiler.
 * 
 * Compiler Pipeline:
 * 
 *   Source Code (.apiforge file)
 *        │
 *        ▼
 *   ┌─────────────────┐
 *   │  1. LEXER        │  Breaks source into tokens
 *   └────────┬─────────┘
 *            ▼
 *   ┌─────────────────┐
 *   │  2. PARSER       │  Builds Abstract Syntax Tree (AST)
 *   └────────┬─────────┘
 *            ▼
 *   ┌─────────────────┐
 *   │  3. SEMANTIC     │  Validates types, duplicates, etc.
 *   │     ANALYZER     │
 *   └────────┬─────────┘
 *            ▼
 *   ┌─────────────────┐
 *   │  4. IR GENERATOR │  Creates intermediate representation
 *   └────────┬─────────┘
 *            ▼
 *   ┌─────────────────┐
 *   │  5. OPTIMIZER    │  Runs 4 IR optimization passes
 *   └────────┬─────────┘
 *            ▼
 *   ┌─────────────────┐
 *   │  6. CODE         │  Generates MySQL + REST API code
 *   │     GENERATOR    │
 *   └─────────────────┘
 * 
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// ── Import compiler phases ──────────────────────────────────
// Each phase is a separate module in the src/ directory.
// We will implement them one by one in upcoming tasks.

const Lexer = require('./src/lexer/lexer');
const Parser = require('./src/parser/parser');
const SemanticAnalyzer = require('./src/semantic/analyzer');
const IRGenerator = require('./src/ir/generator');
const Optimizer = require('./src/optimizer/optimizer');
const CodeGenerator = require('./src/codegen/codegen');
const { formatCodeFrame } = require('./src/utils/errors');

// ── Read the source .apiforge file ──────────────────────────

const filePath = process.argv[2]; // e.g., node index.js samples/student.apiforge

if (!filePath) {
    console.error('╔══════════════════════════════════════════════╗');
    console.error('║         APIForge Compiler v1.0.0             ║');
    console.error('╠══════════════════════════════════════════════╣');
    console.error('║  Usage:  node index.js <file.apiforge>       ║');
    console.error('║  Example: node index.js samples/student.apiforge ║');
    console.error('╚══════════════════════════════════════════════╝');
    process.exit(1);
}

// Check if the file exists
if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] File not found: ${filePath}`);
    process.exit(1);
}

// Read the source code from the file
const sourceCode = fs.readFileSync(filePath, 'utf-8');

console.log('╔══════════════════════════════════════════════╗');
console.log('║       APIForge Compiler v1.0.0               ║');
console.log('║  Domain-Specific Language for REST APIs       ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log(`[INFO] Compiling: ${filePath}`);
console.log('');

// ── Fatal-error reporter (lexer / parser throws) ────────────
// The lexer and parser fail fast by throwing on the first error.
// Rather than let Node dump a raw stack trace, we catch the
// error, print its message, and — when the message carries a
// "line X, column Y" position — render a source frame with a
// caret, mirroring the semantic-error output further below.
function reportFatalError(err) {
    console.log('');
    const displayMsg = err.userMessage ? `Syntax Error: ${err.userMessage}` : err.message;
    console.log(`[✗] ${displayMsg}`);
    const line = err.line || (err.message && /line (\d+)/i.exec(err.message) ? parseInt(/line (\d+)/i.exec(err.message)[1], 10) : null);
    const column = err.column || (err.message && /column (\d+)/i.exec(err.message) ? parseInt(/column (\d+)/i.exec(err.message)[1], 10) : null);
    if (line) {
        const frame = formatCodeFrame(sourceCode, line, column);
        if (frame) {
            frame.split('\n').forEach(frameLine => console.log(`       ${frameLine}`));
        }
    }
    console.log('');
    console.log('[ABORT] Compilation stopped due to a syntax error.');
    process.exit(1);
}

// ── PHASE 1: Lexical Analysis ───────────────────────────────
// The lexer (tokenizer) reads the raw source code character by
// character and groups them into meaningful tokens like
// KEYWORD, IDENTIFIER, DATATYPE, MODIFIER, etc.

console.log('─── Phase 1: Lexical Analysis ───');
let tokens;
try {
    tokens = Lexer.tokenize(sourceCode);
} catch (err) {
    reportFatalError(err);
}
console.log(`[✓] Lexer produced ${tokens.length} tokens`);
console.log('');

// Display the token table so we can see exactly what the lexer produced.
// This is the output of Phase 1 — a flat list of classified tokens.
console.log('  ┌───────┬──────────────┬──────────────┬──────┬────────┐');
console.log('  │  #    │ Type         │ Value        │ Line │ Column │');
console.log('  ├───────┼──────────────┼──────────────┼──────┼────────┤');
tokens.forEach((token, index) => {
    const num = String(index + 1).padStart(4);
    const type = token.type.padEnd(12);
    const value = token.value.padEnd(12);
    const line = String(token.line).padStart(4);
    const col = String(token.column).padStart(5);
    console.log(`  │ ${num}  │ ${type} │ ${value} │ ${line} │ ${col}  │`);
});
console.log('  └───────┴──────────────┴──────────────┴──────┴────────┘');
console.log('');

// ── PHASE 2: Syntax Analysis (Parsing) ──────────────────────
// The parser takes the flat list of tokens and builds a
// hierarchical Abstract Syntax Tree (AST) that represents
// the structure of the DSL program.

console.log('─── Phase 2: Syntax Analysis ───');
let ast;
try {
    ast = Parser.parse(tokens);
} catch (err) {
    reportFatalError(err);
}
const relCount = ast.relations ? ast.relations.length : 0;
const relStr = relCount > 0 ? `, ${relCount} relation/relations` : '';
console.log(`[✓] Parser built the AST (${ast.entities.length} entity/entities${relStr})`);
console.log('');

// Display the AST as a readable tree.
// This is the output of Phase 2 — a hierarchical view of the parsed program.
console.log('  Abstract Syntax Tree:');
console.log('  ─────────────────────');
console.log('  Program');

const hasRelations = ast.relations && ast.relations.length > 0;

ast.entities.forEach((entity, eIdx) => {
    const isLastEntity = !hasRelations && (eIdx === ast.entities.length - 1);
    const entityPrefix = isLastEntity ? '  └── ' : '  ├── ';
    const childPrefix  = isLastEntity ? '      ' : '  │   ';

    console.log(`${entityPrefix}Entity: "${entity.name}" (line ${entity.line})`);

    entity.fields.forEach((field, fIdx) => {
        const isLastField = fIdx === entity.fields.length - 1;
        const fieldBranch = isLastField ? '└── ' : '├── ';
        const constraintStr = field.constraints.length > 0
            ? ` [${field.constraints.join(', ')}]`
            : '';

        console.log(`${childPrefix}${fieldBranch}Field: ${field.name} (${field.dataType})${constraintStr}`);
    });
});

if (hasRelations) {
    ast.relations.forEach((rel, rIdx) => {
        const isLastRel = rIdx === ast.relations.length - 1;
        const relPrefix = isLastRel ? '  └── ' : '  ├── ';
        console.log(`${relPrefix}Relation: ${rel.sourceEntity} --${rel.name}--> ${rel.targetEntity} [${rel.relationType}]`);
    });
}
console.log('');


// ── PHASE 3: Semantic Analysis ──────────────────────────────
// The semantic analyzer walks the AST and checks for logical
// errors that the parser cannot catch, such as:
// - Duplicate entity names
// - Duplicate field names within an entity
// - Invalid data type usage
// - Missing primary key, etc.

console.log('─── Phase 3: Semantic Analysis ───');
const semanticResult = SemanticAnalyzer.analyze(ast);

if (semanticResult.valid) {
    console.log('[✓] Semantic analysis passed — no errors found');
} else {
    console.log(`[✗] Semantic analysis failed — ${semanticResult.errors.length} error(s):`);
    semanticResult.errors.forEach((err, i) => {
        const pos = err.column ? `Line ${err.line}, Column ${err.column}` : `Line ${err.line}`;
        console.log(`    ${i + 1}. ${pos}: ${err.message}`);

        // Show a source excerpt with a caret under the offending token.
        const frame = formatCodeFrame(sourceCode, err.line, err.column);
        if (frame) {
            frame.split('\n').forEach(frameLine => console.log(`       ${frameLine}`));
        }
    });
    console.log('');
    console.log('[ABORT] Compilation stopped due to semantic errors.');
    process.exit(1);
}
console.log('');

// Display the symbol table built during semantic analysis.
// The symbol table records every entity and field — later
// phases (IR, code gen) will consume this table.
console.log('  Symbol Table:');
console.log('  ─────────────');

const entityNames = Object.keys(semanticResult.symbolTable);
entityNames.forEach((entityName, eIdx) => {
    const entity = semanticResult.symbolTable[entityName];
    const isLast = eIdx === entityNames.length - 1;
    const prefix = isLast ? '  └── ' : '  ├── ';
    const child  = isLast ? '      ' : '  │   ';

    console.log(`${prefix}Entity: ${entityName} (line ${entity.line})`);

    const fieldNames = Object.keys(entity.fields);
    fieldNames.forEach((fieldName, fIdx) => {
        const field = entity.fields[fieldName];
        const isLastField = fIdx === fieldNames.length - 1;
        const fBranch = isLastField ? '└── ' : '├── ';
        const cStr = field.constraints.length > 0
            ? `  [${field.constraints.join(', ')}]`
            : '';
        const typeStr = field.dataType.padEnd(7);
        console.log(`${child}${fBranch}${fieldName.padEnd(10)} ${typeStr}${cStr}`);
    });
});
console.log('');

if (semanticResult.relations && Object.keys(semanticResult.relations).length > 0) {
    console.log('  Relationships:');
    console.log('  ──────────────');
    const relNames = Object.keys(semanticResult.relations);
    relNames.forEach((relName, rIdx) => {
        const rel = semanticResult.relations[relName];
        const isLast = rIdx === relNames.length - 1;
        const prefix = isLast ? '  └── ' : '  ├── ';
        console.log(`${prefix}${rel.sourceEntity} --${relName}--> ${rel.targetEntity} [${rel.relationType}]`);
    });
    console.log('');
}


// ── PHASE 4: Intermediate Representation ────────────────────
// Converts the validated AST into a simpler, uniform IR
// that is easier to optimize and transform into target code.

console.log('─── Phase 4: IR Generation ───');
const ir = IRGenerator.generate(ast, semanticResult);
console.log(`[✓] Intermediate representation generated (${ir.instructions.length} instruction(s))`);
console.log('');

console.log('  IR Instructions:');
console.log('  ────────────────');
ir.instructions.forEach((inst, index) => {
    const num = `${index + 1}.`.padEnd(3);
    if (inst.op === 'CREATE_ENTITY') {
        console.log(`  ${num} CREATE_ENTITY ${inst.entity}`);
    } else if (inst.op === 'ADD_FIELD') {
        const cStr = inst.constraints.length > 0 ? ` [${inst.constraints.join(', ')}]` : '';
        console.log(`  ${num} ADD_FIELD ${inst.entity}.${inst.field} ${inst.dataType}${cStr}`);
    } else if (inst.op === 'CREATE_RELATION') {
        console.log(`  ${num} CREATE_RELATION ${inst.sourceEntity} --${inst.relationName}--> ${inst.targetEntity} [${inst.relationType}]`);
    }
});
console.log('');

// ── PHASE 5: Optimization ──────────────────────────────────
// Applies target-independent optimizations to the IR:
// - Constraint normalization
// - Duplicate entity elimination
// - Duplicate field elimination

console.log('─── Phase 5: Optimization ───');
const optResult = Optimizer.optimize(ir);
const optimizedIR = optResult.ir;

const countBefore = ir.instructions.length;
const countAfter = optimizedIR.instructions.length;

if (optResult.optimizations.length === 0) {
    console.log('[✓] Optimization complete — No optimizations required');
    console.log(`    Instructions count: ${countBefore} (unchanged)`);
} else {
    console.log(`[✓] Optimization complete (${countBefore} -> ${countAfter} instruction(s))`);
    console.log('  Passes Applied:');
    optResult.optimizations.forEach(opt => {
        console.log(`    • ${opt.pass}: ${opt.description}`);
    });
}

if (optResult.warnings.length > 0) {
    console.log('  Warnings:');
    optResult.warnings.forEach(warn => {
        console.log(`    ⚠ ${warn}`);
    });
}

console.log('');
console.log('  Optimized IR Instructions:');
console.log('  ──────────────────────────');
optimizedIR.instructions.forEach((inst, index) => {
    const num = `${index + 1}.`.padEnd(3);
    if (inst.op === 'CREATE_ENTITY') {
        console.log(`  ${num} CREATE_ENTITY ${inst.entity}`);
    } else if (inst.op === 'ADD_FIELD') {
        const cStr = inst.constraints.length > 0 ? ` [${inst.constraints.join(', ')}]` : '';
        console.log(`  ${num} ADD_FIELD ${inst.entity}.${inst.field} ${inst.dataType}${cStr}`);
    } else if (inst.op === 'CREATE_RELATION') {
        console.log(`  ${num} CREATE_RELATION ${inst.sourceEntity} --${inst.relationName}--> ${inst.targetEntity} [${inst.relationType}]`);
    }
});
console.log('');

// ── PHASE 6: Target Code Generation ─────────────────────────
// Takes the optimized IR and produces all target artifacts:
// - MySQL DDL Schema (output/database/schema.sql)
// - Express Models (output/models/*.js)
// - Express Controllers (output/controllers/*.js)
// - Express Routes (output/routes/*.js)
// - Express Server (output/server.js)
// - OpenAPI / Swagger Specification (output/swagger.json)

console.log('─── Phase 6: Code Generation ───');
const codegenResult = CodeGenerator.generate(optimizedIR, true);
console.log(`[✓] Code generation completed (${codegenResult.files.length} file(s) generated)`);
console.log('');

const entitiesInIR = CodeGenerator.extractEntitiesFromIR(optimizedIR);
if (entitiesInIR.length > 0) {
    console.log('  Generated Entities:');
    entitiesInIR.forEach(e => {
        console.log(`  ✓ ${e.name}`);
    });
    console.log('');
}

const relationsInIR = CodeGenerator.extractRelationsFromIR(optimizedIR);
if (relationsInIR.length > 0) {
    console.log('  Generated Relationships:');
    relationsInIR.forEach(r => {
        console.log(`  ✓ ${r.sourceEntity} --${r.relationName}--> ${r.targetEntity} [${r.relationType}]`);
    });
    console.log('');
}

console.log('  Generated Output Files:');
console.log('  ───────────────────────');
codegenResult.files.forEach(file => {
    console.log(`  ✓ output/${file.path}`);
});
console.log('');

console.log('╔══════════════════════════════════════════════╗');
console.log('║       Compilation Complete!                   ║');
console.log('╚══════════════════════════════════════════════╝');
