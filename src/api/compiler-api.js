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

const express = require('express');
const router = express.Router();

// ── Import compiler phases ──────────────────────────────────
const Lexer = require('../lexer/lexer');
const Parser = require('../parser/parser');
const SemanticAnalyzer = require('../semantic/analyzer');
const IRGenerator = require('../ir/generator');
const Optimizer = require('../optimizer/optimizer');
const CodeGenerator = require('../codegen/codegen');

// ── GET /health ─────────────────────────────────────────────

router.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});

// ── POST /compile ───────────────────────────────────────────

router.post('/compile', (req, res) => {
    const source = req.body ? req.body.source : undefined;

    // Validate input
    if (!source || typeof source !== 'string' || source.trim().length === 0) {
        return res.status(400).json({
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
            errors: [{ message: 'Source code is required and must be a non-empty string.' }]
        });
    }

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

    // ── Phase 1: Lexical Analysis ───────────────────────────
    try {
        tokens = Lexer.tokenize(source);
        phases.lexer = true;
    } catch (err) {
        let line = err.line || null;
        let column = err.column || null;
        if (!line && err.message) {
            const lineMatch = err.message.match(/line\s+(\d+)/i);
            if (lineMatch) line = parseInt(lineMatch[1], 10);
        }
        if (!column && err.message) {
            const colMatch = err.message.match(/column\s+(\d+)/i);
            if (colMatch) column = parseInt(colMatch[1], 10);
        }
        return res.status(400).json({
            success: false,
            phase: 'lexer',
            phases,
            errors: [{ message: err.message, line, column }]
        });
    }

    // ── Phase 2: Syntax Analysis ────────────────────────────
    try {
        ast = Parser.parse(tokens);
        phases.parser = true;
    } catch (err) {
        let line = err.line || null;
        let column = err.column || null;
        if (!line && err.message) {
            const lineMatch = err.message.match(/line\s+(\d+)/i);
            if (lineMatch) line = parseInt(lineMatch[1], 10);
        }
        if (!column && err.message) {
            const colMatch = err.message.match(/column\s+(\d+)/i);
            if (colMatch) column = parseInt(colMatch[1], 10);
        }
        return res.status(400).json({
            success: false,
            phase: 'parser',
            phases,
            tokens,
            errors: [{
                message: err.message,
                userMessage: err.userMessage || null,
                code: err.code || null,
                line,
                column
            }]
        });
    }

    // ── Phase 3: Semantic Analysis ──────────────────────────
    try {
        const semanticResult = SemanticAnalyzer.analyze(ast);

        if (!semanticResult.valid) {
            return res.status(422).json({
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
        phases.semantic = true;

        // ── Phase 4: IR Generation ──────────────────────────
        try {
            ir = IRGenerator.generate(ast, semanticResult);
            phases.ir = true;
        } catch (err) {
            return res.status(500).json({
                success: false,
                phase: 'ir',
                phases,
                tokens,
                ast,
                symbolTable,
                errors: [{ message: err.message }]
            });
        }

        // ── Phase 5: Optimization ───────────────────────────
        try {
            const optResult = Optimizer.optimize(ir);
            optimizedIR = optResult.ir;
            optimizations = optResult.optimizations || [];
            warnings = optResult.warnings || [];
            phases.optimizer = true;
        } catch (err) {
            return res.status(500).json({
                success: false,
                phase: 'optimizer',
                phases,
                tokens,
                ast,
                symbolTable,
                ir,
                errors: [{ message: err.message }]
            });
        }

        // ── Phase 6: Code Generation ────────────────────────
        try {
            // Pass false to avoid writing files to disk from the API
            const codegenResult = CodeGenerator.generate(optimizedIR, false);
            generatedFiles = codegenResult.files;
            phases.codegen = true;
        } catch (err) {
            return res.status(500).json({
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
                errors: [{ message: err.message }]
            });
        }

    } catch (err) {
        // Unexpected semantic phase error
        return res.status(500).json({
            success: false,
            phase: 'semantic',
            phases,
            tokens,
            ast,
            errors: [{ message: err.message }]
        });
    }

    // ── All phases succeeded ────────────────────────────────
    res.json({
        success: true,
        phases,
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
