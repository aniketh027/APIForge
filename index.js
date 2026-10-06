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
 *   │  5. OPTIMIZER    │  Runs 6 IR optimization passes
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
const { formatDiagnostic } = require('./src/utils/source-frame');
const { internalDiagnostic, sortDiagnostics } = require('./src/utils/diagnostics');

// ── Read the source .apiforge file ──────────────────────────

let selection;
try { selection = require('./src/modules/cli-selection').fileSelection(process.argv.slice(2)); }
catch (error) { console.error(formatDiagnostic('', error.diagnostic)); process.exit(1); }
const filePath = selection.file;
const targetOptions = {target:selection.target};

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
if (selection.root === undefined && !fs.existsSync(filePath)) {
    console.error(`[ERROR] File not found: ${filePath}`);
    process.exit(1);
}

// Read the source code from the file
let preparedEntry;
let compilationUnit;
let sourceCode;
if (selection.root !== undefined) {
    try {
        const adapter = new (require('./src/modules/filesystem-resolver').FilesystemResolver)(filePath, {root:selection.root});
        const read = adapter.read(adapter.entry);
        preparedEntry = {adapter,read}; sourceCode = read.source;
    } catch (error) { console.error(formatDiagnostic('',error.diagnostic || internalDiagnostic('input'))); process.exit(1); }
} else {
    const capture = require('./src/modules/filesystem-resolver').captureEntry(filePath);
    preparedEntry = {capture}; sourceCode = capture.source;
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║       APIForge Compiler v1.0.0               ║');
console.log('║  Domain-Specific Language for REST APIs       ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log(`[INFO] Compiling: ${filePath}`);
if (selection.target === 'postgres') console.log('[INFO] Target: postgres (postgresql-18-v1)');
console.log('');

// Fatal phase failures use the same diagnostic formatter as semantic errors.
// Structured locations avoid extracting coordinates from presentation text.
function reportFatalError(err, phase) {
    console.log('');
    const unit = err.compilationUnit || compilationUnit;
    const diagnostic = err.diagnostic || internalDiagnostic(phase);
    if (unit) console.log(unit.format(diagnostic));
    else if (err.recognizedImport) {
        const display = selection.root === undefined ? path.basename(filePath) : path.relative(preparedEntry.adapter.root,preparedEntry.adapter.entry.canonical).split(path.sep).join('/');
        console.log(formatDiagnostic(sourceCode,diagnostic).replace(`  --> line ${diagnostic.line}`,`  --> ${display}:${diagnostic.line}`));
    } else console.log(formatDiagnostic(sourceCode, diagnostic));
    if (err.outputPublication) console.error(`[OUTPUT] ${err.message}`);
    console.log('');
    console.log(`[ABORT] Compilation stopped during ${phase}.`);
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
    reportFatalError(err, 'lexer');
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
    const parsed = Parser.parseModule(tokens);
    ast = parsed.ast;
    if (parsed.imports.length) {
        compilationUnit = require('./src/modules/resolver').resolveFile(filePath,{root:selection.root},{...preparedEntry,tokens,parsed});
        ast = compilationUnit.ast;
        console.log(`[INFO] Resolved ${compilationUnit.modules.length} modules`);
        compilationUnit.modules.forEach(m=>console.log(`[INFO] Module ${m.displayPath}: ${m.tokens.length} tokens`));
    }
} catch (err) {
    reportFatalError(err, err.diagnostic?.phase || 'parser');
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
// Warnings (such as an implicit primary key) do not fail this phase.

console.log('─── Phase 3: Semantic Analysis ───');
let semanticResult;
try {
    semanticResult = SemanticAnalyzer.analyze(ast, targetOptions);
} catch (err) {
    reportFatalError(err, 'semantic');
}

if (semanticResult.valid) {
    console.log('[✓] Semantic analysis passed — no errors found');
} else {
    console.log(`[✗] Semantic analysis failed — ${semanticResult.errors.length} error(s):`);
    const diagnostics = compilationUnit ? compilationUnit.sort(semanticResult.diagnostics.map(d=>compilationUnit.diagnostic(d))) : semanticResult.diagnostics;
    diagnostics.forEach(diagnostic => {
        console.log(compilationUnit ? compilationUnit.format(diagnostic) : formatDiagnostic(sourceCode, diagnostic));
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
        const cStr = field.constraints && field.constraints.length > 0
            ? `  [${field.constraints.join(', ')}]`
            : '';
        const vStr = field.validations && field.validations.length > 0
            ? `  Validations: ${field.validations.map(v => `${v.type} ${v.value}`).join(', ')}`
            : '';
        let dStr = '';
        if (field.defaultValue !== null && field.defaultValue !== undefined) {
            const defVal = field.defaultValue.type === 'STRING'
                ? `"${field.defaultValue.value}"`
                : (field.defaultValue.type === 'BOOLEAN' ? (field.defaultValue.value ? 'TRUE' : 'FALSE') : field.defaultValue.value);
            dStr = `  Default: ${defVal}`;
        }
        const typeStr = field.dataType.padEnd(7);
        console.log(`${child}${fBranch}${fieldName.padEnd(10)} ${typeStr}${cStr}${vStr}${dStr}`);
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
let ir;
try {
    ir = IRGenerator.generate(ast, semanticResult);
} catch (err) {
    reportFatalError(err, 'ir');
}
console.log(`[✓] Intermediate representation generated (${ir.instructions.length} instruction(s))`);
console.log('');

console.log('  IR Instructions:');
console.log('  ────────────────');
ir.instructions.forEach((inst, index) => {
    const num = `${index + 1}.`.padEnd(3);
    if (inst.op === 'CREATE_ENTITY') {
        console.log(`  ${num} CREATE_ENTITY ${inst.entity}`);
    } else if (inst.op === 'ADD_FIELD') {
        const cStr = inst.constraints && inst.constraints.length > 0 ? ` [${inst.constraints.join(', ')}]` : '';
        const vStr = inst.validations && inst.validations.length > 0 ? `  Validations: ${inst.validations.map(v => `${v.type} ${v.value}`).join(', ')}` : '';
        let dStr = '';
        if (inst.defaultValue !== null && inst.defaultValue !== undefined) {
            const defVal = inst.defaultValue.type === 'STRING'
                ? `"${inst.defaultValue.value}"`
                : (inst.defaultValue.type === 'BOOLEAN' ? (inst.defaultValue.value ? 'TRUE' : 'FALSE') : inst.defaultValue.value);
            dStr = `  Default: ${defVal}`;
        }
        console.log(`  ${num} ADD_FIELD ${inst.entity}.${inst.field} ${inst.dataType}${cStr}${vStr}${dStr}`);
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
let optResult;
let optimizedIR;
try {
    optResult = Optimizer.optimize(ir);
    optimizedIR = optResult.ir;
} catch (err) {
    reportFatalError(err, 'optimizer');
}

const countBefore = ir.instructions.length;
const countAfter = optimizedIR.instructions.length;

if (optResult.optimizations.length === 0) {
    console.log('[✓] Optimization complete — No optimizations required');
    console.log(`    Instructions count: ${countBefore} (unchanged)`);
} else {
    const changeStr = countBefore !== countAfter
        ? `(${countBefore} -> ${countAfter} instruction(s))`
        : `(${countAfter} instruction(s) - metadata optimized)`;
    console.log(`[✓] Optimization complete ${changeStr}`);
    console.log('  Passes Applied:');
    optResult.optimizations.forEach(opt => {
        console.log(`    • ${opt.pass}: ${opt.description}`);
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
        const cStr = inst.constraints && inst.constraints.length > 0 ? ` [${inst.constraints.join(', ')}]` : '';
        const vStr = inst.validations && inst.validations.length > 0 ? `  Validations: ${inst.validations.map(v => `${v.type} ${v.value}`).join(', ')}` : '';
        let dStr = '';
        if (inst.defaultValue !== null && inst.defaultValue !== undefined) {
            const defVal = inst.defaultValue.type === 'STRING'
                ? `"${inst.defaultValue.value}"`
                : (inst.defaultValue.type === 'BOOLEAN' ? (inst.defaultValue.value ? 'TRUE' : 'FALSE') : inst.defaultValue.value);
            dStr = `  Default: ${defVal}`;
        }
        console.log(`  ${num} ADD_FIELD ${inst.entity}.${inst.field} ${inst.dataType}${cStr}${vStr}${dStr}`);
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
let codegenResult;
try {
    codegenResult = CodeGenerator.generate(optimizedIR, true, targetOptions);
} catch (err) {
    reportFatalError(err, 'codegen');
}
console.log(`[✓] Code generation completed (${codegenResult.files.length} file(s) generated)`);
console.log('');

const entitiesInIR = CodeGenerator.extractEntitiesFromIR(optimizedIR);
if (entitiesInIR.length > 0) {
    console.log('  Generated Entities:');
    entitiesInIR.forEach(e => {
        console.log(`  ✓ ${e.name}`);
        e.fields.forEach(f => {
            const hasVal = f.validations && f.validations.length > 0;
            const hasDef = f.defaultValue !== null && f.defaultValue !== undefined;
            if (hasVal || hasDef) {
                const vStr = hasVal ? `Validations: ${f.validations.map(v => `${v.type} ${v.value}`).join(', ')}` : '';
                let dStr = '';
                if (hasDef) {
                    const defVal = f.defaultValue.type === 'STRING'
                        ? `"${f.defaultValue.value}"`
                        : (f.defaultValue.type === 'BOOLEAN' ? (f.defaultValue.value ? 'TRUE' : 'FALSE') : f.defaultValue.value);
                    dStr = `Default: ${defVal}`;
                }
                const parts = [vStr, dStr].filter(Boolean).join('  ');
                console.log(`      • ${f.name} (${f.dataType}): ${parts}`);
            }
        });
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

const collectedWarnings = [...(semanticResult.warnings || []), ...(optResult.warnings || [])];
const warnings = compilationUnit ? compilationUnit.sort(collectedWarnings.map(d=>compilationUnit.diagnostic(d))) : sortDiagnostics(collectedWarnings);
if (warnings.length > 0) {
    console.log(`[!] ${warnings.length} warning${warnings.length === 1 ? '' : 's'} — compilation succeeded`);
    warnings.forEach(warning => {
        console.log(`[!] ${warning.phase} warning`);
        console.log(compilationUnit ? compilationUnit.format(warning) : formatDiagnostic(sourceCode, warning));
        console.log('');
    });
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║       Compilation Complete!                   ║');
console.log('╚══════════════════════════════════════════════╝');
