'use strict';

// Load the complete compiler-local dependency closure from the reviewed Git
// tree. In particular, a historical codegen module must never require a live
// mysql-target, naming, temporal, UUID, IR, OpenAPI or package module.
const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { builtinModules } = require('module');
const { execFileSync } = require('child_process');

const PINNED_BASE = 'd91859e30a5ed0f91be9826a3d8d3a5c5b7261ce';
const CHECKOUT_POLICY = Object.freeze({ autocrlf: 'true', eol: 'crlf' });
const REPOSITORY = path.resolve(__dirname, '..');
const builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));

function createPinnedCompiler(options = {}) {
    const root = options.root || REPOSITORY;
    const revision = options.revision || PINNED_BASE;
    const git = args => execFileSync('git', args, {
        cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024
    });
    assert.equal(git(['rev-parse', revision + '^{commit}']).trim(), revision,
        'The oracle must pin an exact commit, never a moving ref.');
    const paths = git(['ls-tree', '-r', '--name-only', revision]).trim().split('\n');
    const pinnedPaths = new Set(paths);
    const localPaths = paths.filter(name => name.startsWith('src/') || name === 'package.json');

    // Git's --filters applies attributes from the worktree. Reject attributes
    // that could change the approved checkout bytes instead of silently using
    // current/global smudge filters. The reviewed tree has no .gitattributes.
    assert(!paths.some(name => /(^|\/)\.gitattributes$/.test(name)),
        'A new pinned attribute policy requires explicit oracle review.');
    const attributes = git(['check-attr', '--all', '-z', '--', ...localPaths]);
    assert.equal(attributes, '', 'Compiler checkout attributes differ from the pinned no-attributes policy.');

    const sources = new Map(), modules = new Map(), loaded = new Set();
    function readFile(relative) {
        const name = relative.replaceAll('\\', '/').replace(/^\.\//, '');
        assert(pinnedPaths.has(name), 'Missing pinned file: ' + name);
        if (!sources.has(name)) {
            sources.set(name, git(['-c', 'core.autocrlf=' + CHECKOUT_POLICY.autocrlf,
                '-c', 'core.eol=' + CHECKOUT_POLICY.eol, 'cat-file', '--filters', revision + ':' + name]));
        }
        return sources.get(name);
    }
    function resolveLocal(request, parent) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(parent), request));
        assert(!base.startsWith('../') && !path.posix.isAbsolute(base), 'Pinned require escapes its tree: ' + request);
        const resolved = [base, base + '.js', base + '.json', base + '/index.js']
            .find(candidate => pinnedPaths.has(candidate));
        assert(resolved, 'Pinned dependency is absent: ' + parent + ' -> ' + request);
        return resolved;
    }
    function load(relative) {
        const name = relative.replaceAll('\\', '/').replace(/^\.\//, '');
        assert(pinnedPaths.has(name), 'Missing pinned module: ' + name);
        if (modules.has(name)) return modules.get(name).exports;
        const module = { exports: {} };
        modules.set(name, module);
        loaded.add(name);
        if (name.endsWith('.json')) module.exports = JSON.parse(readFile(name));
        else {
            const requirePinned = request => {
                if (request.startsWith('.')) return load(resolveLocal(request, name));
                assert(builtins.has(request), 'Unpinned external dependency requested by ' + name + ': ' + request);
                return require(request);
            };
            const filename = path.resolve(root, name);
            vm.compileFunction(readFile(name), ['require', 'module', 'exports', '__dirname', '__filename'],
                { filename: 'pinned:' + revision + '/' + name })(requirePinned, module, module.exports,
                path.dirname(filename), filename);
        }
        return module.exports;
    }
    const compiler = {
        Lexer: load('src/lexer/lexer.js'), Parser: load('src/parser/parser.js'),
        Semantic: load('src/semantic/analyzer.js'), IR: load('src/ir/generator.js'),
        Optimizer: load('src/optimizer/optimizer.js'), Codegen: load('src/codegen/codegen.js')
    };
    return { revision, checkoutPolicy: CHECKOUT_POLICY, paths, readFile, load, compiler,
        loadedPaths: () => [...loaded], compile: source => compileSource(source, compiler) };
}

function currentCompiler() {
    return {
        Lexer: require('../src/lexer/lexer'), Parser: require('../src/parser/parser'),
        Semantic: require('../src/semantic/analyzer'), IR: require('../src/ir/generator'),
        Optimizer: require('../src/optimizer/optimizer'), Codegen: require('../src/codegen/codegen')
    };
}

function compileSource(source, compiler = currentCompiler()) {
    const phases = {}, warnings = [];
    let phase = 'lexer';
    try {
        phases.tokens = compiler.Lexer.tokenize(source);
        phase = 'parser'; phases.ast = compiler.Parser.parse(phases.tokens);
        phase = 'semantic'; phases.semantic = compiler.Semantic.analyze(phases.ast);
        if (!phases.semantic.valid) return { valid: false, phase, diagnostics: phases.semantic.diagnostics, phases };
        warnings.push(...phases.semantic.warnings);
        phase = 'ir'; phases.ir = compiler.IR.generate(phases.ast, phases.semantic);
        phase = 'optimizer'; phases.optimized = compiler.Optimizer.optimize(phases.ir);
        warnings.push(...phases.optimized.warnings);
        phase = 'codegen'; const generated = compiler.Codegen.generate(phases.optimized.ir, false);
        return { valid: true, files: generated.files, warnings, phases };
    } catch (error) {
        return { valid: false, phase, diagnostics: error.diagnostic ? [error.diagnostic] : [],
            error: { name: error.name, message: error.message, code: error.code || null }, phases };
    }
}

module.exports = { PINNED_BASE, CHECKOUT_POLICY, createPinnedCompiler, currentCompiler, compileSource };
