'use strict';
const { createDiagnostic } = require('../utils/diagnostics');
const messages = Object.freeze({
    INVALID_IMPORT_PATH: ['Invalid import path.', 'Use a relative /-separated path ending in .apiforge.'],
    IMPORT_NOT_FOUND: ['Source file was not found.', 'Check the path relative to the importing module.'],
    IMPORT_OUTSIDE_ROOT: ['Source file is outside the compilation root.', 'Use --root to select a containing project directory.'],
    IMPORT_NOT_FILE: ['Source target is not a regular file.', 'Select a regular .apiforge file.'],
    IMPORT_READ_FAILED: ['Source file could not be read.', 'Check filesystem access and links.'],
    IMPORT_CYCLE: [null, 'Remove an import edge from this cycle.'],
    IMPORT_CONTEXT_UNSUPPORTED: ['Imports require a filesystem compilation context.', 'Use node index.js <entry.apiforge> or the file-aware compiler API.'],
    IMPORT_RESOURCE_LIMIT: ['Compilation source limit exceeded.', 'Reduce the graph or increase the explicit library limit.'],
    IMPORT_SOURCE_CHANGED: ['Source file changed during compilation.', 'Retry with a stable source tree.'],
    INVALID_COMPILATION_ROOT: ['Compilation root must be an accessible directory.', 'Provide an existing directory with --root.'],
    IMPORT_IDENTITY_AMBIGUOUS: ['Cannot establish an unambiguous module identity and import base.', 'Use stable file identities and one canonical import base per file.']
});
function moduleError(symbol, location = {}, message = messages[symbol][0]) {
    const error = new Error(message);
    error.code = symbol; error.userMessage = message;
    error.diagnostic = createDiagnostic('input', symbol, message, location, messages[symbol][1]);
    error.line = error.diagnostic.line; error.column = error.diagnostic.column;
    return error;
}
function fail(symbol, location, message) { throw moduleError(symbol, location, message); }
function filesystemError(error, location) {
    if (error.diagnostic) throw error;
    const symbol = error.code === 'ENOENT' ? 'IMPORT_NOT_FOUND' : error.code === 'ENOTDIR' ? 'IMPORT_NOT_FILE'
        : ['EINVAL','ENAMETOOLONG'].includes(error.code) ? 'INVALID_IMPORT_PATH' : 'IMPORT_READ_FAILED';
    throw moduleError(symbol, location);
}
module.exports = { moduleError, fail, filesystemError };
