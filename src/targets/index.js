'use strict';
const { createDiagnostic } = require('../utils/diagnostics');
function resolveTarget(options = {}) {
    const target = options.target === undefined ? 'mysql' : options.target;
    if (target !== 'mysql' && target !== 'postgres') {
        const error = new Error('Target must be exactly mysql or postgres.');
        error.code = 'INVALID_TARGET';
        error.diagnostic = createDiagnostic('input', 'INVALID_TARGET', error.message);
        throw error;
    }
    return target;
}
function adapter(options) {
    return resolveTarget(options) === 'mysql' ? require('./mysql') : require('./postgres');
}
function cliSelection(args) {
    if (!args.includes('--target')) return { file: args[0], target: 'mysql' };
    let target, seen = false; const files = [];
    for (let i=0;i<args.length;i++) {
        if (args[i] === '--target') {
            if (seen || i+1 === args.length || args[i+1].startsWith('--')) return resolveTarget({target:null});
            seen=true; target=args[++i];
        } else files.push(args[i]);
    }
    resolveTarget({target});
    if (files.length !== 1 || files[0].startsWith('--')) return resolveTarget({target:null});
    return {file:files[0],target};
}
module.exports = {resolveTarget,adapter,cliSelection};
