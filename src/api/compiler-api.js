/**
 * ============================================================
 * Compiler API - Express Router
 * ============================================================
 *
 * Wraps the existing six-phase APIForge compiler pipeline
 * into a REST API endpoint for the web frontend.
 *
 * POST /compile   — Runs the full pipeline, returns all results
 * GET  /health    — Health check
 *
 * This module does NOT duplicate compiler logic. It calls the
 * existing phase modules in sequence.
 *
 * ============================================================
 */

const { COMPILER_PHASES, createDiagnostic, internalDiagnostic, sortDiagnostics } = require('../utils/diagnostics');
const express = require('express');
const router = express.Router();

// ── Import compiler phases ──────────────────────────────────
const Lexer = require('../lexer/lexer');
const Parser = require('../parser/parser');
const SemanticAnalyzer = require('../semantic/analyzer');
const IRGenerator = require('../ir/generator');
const Optimizer = require('../optimizer/optimizer');
const CodeGenerator = require('../codegen/codegen');

function failure(res, status, result) {
    const diagnostics = result.errors.map(error => error.diagnostic || internalDiagnostic(result.phase));
    return res.status(status).json({ ...result, warnings: sortDiagnostics(result.warnings || []),
        diagnostic: diagnostics[0], diagnostics,
        phaseStates: Object.fromEntries(COMPILER_PHASES.map(phase => [phase,
            result.phases[phase] ? 'succeeded' : phase === result.phase ? 'failed' : 'skipped'])) });
}

function compilerError(error) {
    return { message: error.message, userMessage: error.userMessage || null,
        code: error.code || null, line: error.line || null, column: error.column || null,
        diagnostic: error.diagnostic };
}

function internalError(phase) {
    const diagnostic = internalDiagnostic(phase);
    return { message: diagnostic.message, diagnostic };
}

// ── GET /health ─────────────────────────────────────────────

router.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});

// ── POST /compile ───────────────────────────────────────────

router.post('/compile', (req, res) => {
    const source = req.body ? req.body.source : undefined;

    // Validate input
    if (typeof source !== 'string') {
        return failure(res, 400, {
            success: false,
            phase: 'input',
            phases: {
                lexer: false,
                parser: false,
                semantic: false,
                ir: false,
                optimizer: false,
                codegen: false
            },
            errors: [{ message: 'Source code is required and must be a string.',
                diagnostic: createDiagnostic('input', 'INVALID_SOURCE', 'Source code is required and must be a string.') }]
        });
    }

    let targetOptions;
    try { targetOptions = {target:require('../targets').resolveTarget({target:req.body?.target})}; }
    catch (error) { return failure(res, 400, {success:false,phase:'input',
        phases:Object.fromEntries(COMPILER_PHASES.map(phase => [phase,false])),
        errors:[compilerError(error)]}); }

    // Track phase results
    const phases = {
        lexer: false,
        parser: false,
        semantic: false,
        ir: false,
        optimizer: false,
        codegen: false
    };

    // Partial results (populated as phases succeed)
    let tokens = null;
    let ast = null;
    let symbolTable = null;
    let ir = null;
    let optimizedIR = null;
    let optimizations = [];
    let warnings = [];
    let generatedFiles = [];
    let imports = [];

    // ── Phase 1: Lexical Analysis ───────────────────────────
    try {
        tokens = Lexer.tokenize(source);
        phases.lexer = true;
    } catch (err) {
        return failure(res, err.diagnostic ? 400 : 500, {
            success: false,
            phase: 'lexer',
            phases,
            errors: [err.diagnostic ? compilerError(err) : internalError('lexer')]
        });
    }

    // ── Phase 2: Syntax Analysis ────────────────────────────
    try {
        const parsed = Parser.parseModule(tokens);
        ast = parsed.ast; imports = parsed.imports;
        phases.parser = true;
    } catch (err) {
        return failure(res, err.diagnostic ? 400 : 500, {
            success: false,
            phase: 'parser',
            phases,
            tokens,
            errors: [err.diagnostic ? compilerError(err) : internalError('parser')]
        });
    }

    if (imports.length) {
        const error = require('../modules/errors').moduleError('IMPORT_CONTEXT_UNSUPPORTED', imports[0].location);
        return failure(res,400,{success:false,phase:'input',phases,tokens,ast,
            errors:[compilerError(error)],warnings:[]});
    }

    // ── Phase 3: Semantic Analysis ──────────────────────────
    try {
        const semanticResult = SemanticAnalyzer.analyze(ast, targetOptions);

        if (!semanticResult.valid) {
            return failure(res, 422, {
                success: false,
                phase: 'semantic',
                phases: { ...phases, semantic: false },
                tokens,
                ast,
                symbolTable: semanticResult.symbolTable,
                errors: semanticResult.errors
            });
        }

        symbolTable = semanticResult.symbolTable;
        warnings = semanticResult.warnings || [];
        phases.semantic = true;

        // ── Phase 4: IR Generation ──────────────────────────
        try {
            ir = IRGenerator.generate(ast, semanticResult);
            phases.ir = true;
        } catch (err) {
            return failure(res, 500, {
                success: false,
                phase: 'ir',
                phases,
                tokens,
                ast,
                symbolTable,
                warnings,
                errors: [internalError('ir')]
            });
        }

        // ── Phase 5: Optimization ───────────────────────────
        try {
            const optResult = Optimizer.optimize(ir);
            optimizedIR = optResult.ir;
            optimizations = optResult.optimizations || [];
            warnings = sortDiagnostics([...warnings, ...(optResult.warnings || [])]);
            phases.optimizer = true;
        } catch (err) {
            return failure(res, 500, {
                success: false,
                phase: 'optimizer',
                phases,
                tokens,
                ast,
                symbolTable,
                ir,
                warnings,
                errors: [internalError('optimizer')]
            });
        }

        // ── Phase 6: Code Generation ────────────────────────
        try {
            // Pass false to avoid writing files to disk from the API
            const codegenResult = CodeGenerator.generate(optimizedIR, false, targetOptions);
            generatedFiles = codegenResult.files;
            phases.codegen = true;
        } catch (err) {
            return failure(res, err.diagnostic?.code === 'GEN001' ? 422 : 500, {
                success: false,
                phase: 'codegen',
                phases,
                tokens,
                ast,
                symbolTable,
                ir,
                optimizedIR,
                optimizations,
                warnings,
                errors: [err.diagnostic?.code === 'GEN001' ? compilerError(err) : internalError('codegen')]
            });
        }

    } catch (err) {
        // Unexpected semantic phase error
        return failure(res, 500, {
            success: false,
            phase: 'semantic',
            phases,
            tokens,
            ast,
            errors: [internalError('semantic')]
        });
    }

    // ── All phases succeeded ────────────────────────────────
    res.json({
        success: true,
        phases,
        phaseStates: Object.fromEntries(COMPILER_PHASES.map(phase => [phase, 'succeeded'])),
        tokens,
        ast,
        symbolTable,
        ir,
        optimizedIR,
        optimizations,
        warnings,
        generatedFiles
    });
});

module.exports = router;
