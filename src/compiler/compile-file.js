'use strict';
const { resolveTarget } = require('../targets');
const { resolveFile } = require('../modules/resolver');
const Semantic = require('../semantic/analyzer'), IR = require('../ir/generator');
const Optimizer = require('../optimizer/optimizer'), Codegen = require('../codegen/codegen');
const { COMPILER_PHASES, internalDiagnostic } = require('../utils/diagnostics');

// File-aware boundary copies diagnostics; pure phase APIs retain their old shapes.
function compileUnit(unit, options = {}) {
    const target = resolveTarget(options);
    let phase = 'semantic';
    try {
        const semantic = Semantic.analyze(unit.ast, { target });
        const diagnostics = unit.sort(semantic.diagnostics.map(d=>unit.diagnostic(d)));
        const warnings = unit.sort(semantic.warnings.map(d=>unit.diagnostic(d)));
        if (!semantic.valid) {
            const error = new Error(semantic.errors.map(e=>e.message || e).join('\n'));
            error.diagnostics = diagnostics; error.diagnostic = diagnostics[0];
            Object.defineProperty(error, 'semanticResult', { value: semantic });
            throw error;
        }
        phase = 'ir'; const ir = IR.generate(unit.ast, semantic);
        phase = 'optimizer'; const optimized = Optimizer.optimize(ir);
        const allWarnings = unit.sort([...warnings,...optimized.warnings.map(d=>unit.diagnostic(d))]);
        phase = 'codegen'; const admission = Codegen.prepareAdmittedGeneration(optimized.ir, { target });
        const generated = options.admitOnly ? null : Codegen.generate(optimized.ir, false, { target });
        const result = { success: true, phases: Object.fromEntries(COMPILER_PHASES.map(p=>[p,true])),
            phaseStates: Object.fromEntries(COMPILER_PHASES.map(p=>[p,'succeeded'])),
            ast: unit.ast, semantic: {...semantic,diagnostics,warnings}, symbolTable: semantic.symbolTable,
            ir, optimizedIR: optimized.ir, optimizations: optimized.optimizations, warnings: allWarnings,
            plan: admission.candidate.plan, generatedFiles: generated?.files || [] };
        Object.defineProperty(result, 'compilationUnit', { value: unit });
        return result;
    } catch (error) {
        if (!error.diagnostic) error.diagnostic = unit.diagnostic(internalDiagnostic(phase));
        if (!error.diagnostics) error.diagnostics = [unit.diagnostic(error.diagnostic)];
        error.diagnostic = error.diagnostics[0];
        Object.defineProperty(error,'compilationUnit',{value:unit,configurable:true});
        Object.defineProperty(error,'compilerPhase',{value:phase,configurable:true});
        throw error;
    }
}
function compileFile(entryPath, options = {}) {
    resolveTarget(options); // Target validation precedes every filesystem operation.
    return compileUnit(resolveFile(entryPath, options), options);
}
module.exports = { resolveFile, compileFile, compileUnit };
