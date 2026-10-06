'use strict';
const { ProgramNode } = require('../ast/ast');
const { COMPILER_PHASES } = require('../utils/diagnostics');
const { owner, setOwner, related } = require('./provenance');
const { formatDiagnostic } = require('../utils/source-frame');
class CompilationUnit {
    constructor() {
        this.modules = []; this.sources = new Map(); this.entry = null;
        this.hasImports = false; this.ast = null;
    }
    merge() {
        const ast = new ProgramNode();
        for (const sourceModule of this.modules) {
            ast.entities.push(...sourceModule.ast.entities); ast.relations.push(...sourceModule.ast.relations);
        }
        this.ast = setOwner(ast, this.entry); return ast;
    }
    diagnostic(original, includeChain = true) {
        const sourceModule = owner(original) || this.entry;
        const diagnostic = setOwner({ ...original }, sourceModule);
        if (sourceModule) diagnostic.source = sourceModule.displayPath;
        const locations = related(original).map(r => this.relatedLocation(r.message, r.location));
        if (includeChain && sourceModule) {
            const chain = []; let current = sourceModule;
            while (current.firstInbound) { chain.push(current.firstInbound); current = current.firstInbound.importer; }
            for (const edge of chain.reverse()) locations.push(this.relatedLocation('Imported here.', edge.location));
        }
        const useful = locations.filter(Boolean);
        if (useful.length) diagnostic.related = useful;
        return diagnostic;
    }
    relatedLocation(message, location) {
        const sourceModule = owner(location);
        if (!sourceModule) return null;
        const result = { message, source: sourceModule.displayPath, line: location.line || null, column: location.column || null };
        for (const key of ['endLine','endColumn']) if (location[key] !== undefined) result[key] = location[key];
        return result;
    }
    sort(diagnostics) {
        const rank = phase => { const index = COMPILER_PHASES.indexOf(phase); return index < 0 ? COMPILER_PHASES.length : index; };
        return [...diagnostics].sort((a,b) => rank(a.phase)-rank(b.phase) ||
            (owner(a)?.emissionOrdinal ?? Infinity)-(owner(b)?.emissionOrdinal ?? Infinity) ||
            (a.line ?? Infinity)-(b.line ?? Infinity) || (a.column ?? Infinity)-(b.column ?? Infinity) ||
            (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    }
    error(error, sourceModule) {
        if (error.compilationUnit === this) return error;
        if (error.diagnostic) {
            if (!owner(error.diagnostic)) setOwner(error.diagnostic, sourceModule || this.entry);
            error.diagnostic = this.diagnostic(error.diagnostic);
            error.diagnostics = [error.diagnostic];
        }
        Object.defineProperty(error, 'compilationUnit', { value: this, configurable: true });
        return error;
    }
    format(diagnostic) {
        const sourceModule = owner(diagnostic) || this.sources.get(diagnostic.source) || this.entry;
        const legacy = formatDiagnostic(sourceModule?.source || '', diagnostic);
        if (!this.hasImports) return legacy;
        const output = legacy.split('\n');
        if (diagnostic.line) output[1] = `  --> ${diagnostic.source || sourceModule.displayPath}:${diagnostic.line}${diagnostic.column ? ', column '+diagnostic.column : ''}`;
        for (const item of diagnostic.related || []) output.push(`Related: ${item.message} ${item.source}:${item.line ?? '?'}, column ${item.column ?? '?'}`);
        return output.join('\n');
    }
}
module.exports = { CompilationUnit };
