'use strict';
const Lexer = require('../lexer/lexer'), Parser = require('../parser/parser');
const { FilesystemResolver } = require('./filesystem-resolver');
const { CompilationUnit } = require('./compilation-unit');
const { bindTree, setOwner, setRelated } = require('./provenance');
const { fail } = require('./errors');

// Iterative DFS avoids a call-stack-dependent graph-depth limit.
function resolveFile(entryPath, options = {}, preparedEntry) {
    const unit = new CompilationUnit();
    let adapter, current;
    try {
        adapter = preparedEntry?.adapter || new FilesystemResolver(entryPath, options);
        const cache = new Map(), stack = []; let bytes = 0;
        function admit(reference, edge) {
            const previous = cache.get(reference.key);
            if (previous) {
                if (JSON.stringify(previous.reference.base) !== JSON.stringify(reference.base)) fail('IMPORT_IDENTITY_AMBIGUOUS', edge?.location);
                previous.inbound.push(edge); return previous;
            }
            if (cache.size >= (options.maxModules ?? Infinity)) fail('IMPORT_RESOURCE_LIMIT', edge?.location);
            const sourceModule = { displayPath: reference.displayPath, source: '', tokens: null, ast: null,
                imports: [], inbound: edge ? [edge] : [], firstInbound: edge, state: 'active', emissionOrdinal: null };
            Object.defineProperty(sourceModule, 'reference', { value: reference });
            cache.set(reference.key, sourceModule); unit.sources.set(sourceModule.displayPath, sourceModule);
            if (!edge) unit.entry = sourceModule;
            current = sourceModule;
            const captured = !edge ? preparedEntry?.capture : undefined;
            const read = adapter.read(reference, edge?.location, (options.maxSourceBytes ?? Infinity)-bytes, captured);
            bytes += read.byteLength; sourceModule.source = read.source;
            try {
                sourceModule.tokens = !edge && preparedEntry?.tokens ? preparedEntry.tokens : Lexer.tokenize(read.source);
                bindTree(sourceModule.tokens, sourceModule);
                const parsed = !edge && preparedEntry?.parsed ? preparedEntry.parsed : Parser.parseModule(sourceModule.tokens);
                sourceModule.ast = parsed.ast; sourceModule.imports = parsed.imports;
                bindTree(parsed, sourceModule);
            } catch (error) {
                if (error.recognizedImport) unit.hasImports = true;
                throw unit.error(error, sourceModule);
            }
            if (sourceModule.imports.length) unit.hasImports = true;
            return sourceModule;
        }
        stack.push({ module: admit(adapter.entry), next: 0 });
        while (stack.length) {
            const frame = stack.at(-1); current = frame.module;
            if (frame.next === current.imports.length) {
                current.state = 'complete'; current.emissionOrdinal = unit.modules.length;
                unit.modules.push(current); stack.pop(); continue;
            }
            const declaration = current.imports[frame.next++];
            const edge = { importer: current, location: declaration.location };
            const reference = adapter.resolve(declaration.path, current.reference, edge.location);
            const existed = cache.has(reference.key), target = admit(reference, edge);
            Object.defineProperty(edge, 'target', { value: target });
            if (existed && target.state === 'active') {
                const start = stack.findIndex(f => f.module === target);
                const segment = stack.slice(start).map(f => f.module);
                try { fail('IMPORT_CYCLE', edge.location, 'Import cycle: '+[...segment,target].map(m=>m.displayPath).join(' -> ')+'.'); }
                catch (error) {
                    setRelated(error.diagnostic, segment.slice(1).map(m=>({message:'Cycle edge.',location:m.firstInbound.location})));
                    throw error;
                }
            }
            if (!existed) stack.push({ module: target, next: 0 });
        }
        unit.merge(); return unit;
    } catch (error) { throw unit.error(error, current); }
}
module.exports = { resolveFile };
