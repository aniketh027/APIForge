const COMPILER_PHASES = Object.freeze(['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen']);

// Stable public codes. Append new entries; never renumber or reuse a code.
const CODES = Object.freeze({
    lexer: Object.freeze({
        UNEXPECTED_CHARACTER: 'LEX001', INVALID_IDENTIFIER: 'LEX002',
        UNTERMINATED_STRING: 'LEX003', MALFORMED_NUMBER: 'LEX004'
    }),
    parser: Object.freeze({
        EXPECTED_TOKEN: 'PAR001', MISSING_ENTITY_NAME: 'PAR002',
        MISSING_SOURCE_ENTITY: 'PAR003', MISSING_RELATION_NAME: 'PAR004',
        MISSING_TARGET_ENTITY: 'PAR005', MISSING_IDENTIFIER: 'PAR006',
        EXPECTED_ENTITY_DECLARATION: 'PAR007', MISSING_FIELD_NAME: 'PAR008',
        INVALID_FIELD_TOKEN: 'PAR009', MISSING_RELATION_TYPE: 'PAR010',
        INVALID_RELATION_TYPE: 'PAR011', MISSING_DATATYPE: 'PAR012',
        INVALID_DATATYPE: 'PAR013', MISSING_KEY_AFTER_PRIMARY: 'PAR014',
        STANDALONE_KEY: 'PAR015', MISSING_MIN_VALUE: 'PAR016',
        MISSING_MAX_VALUE: 'PAR017', MISSING_MIN_LENGTH_VALUE: 'PAR018',
        MISSING_MAX_LENGTH_VALUE: 'PAR019', MISSING_DEFAULT_VALUE: 'PAR020',
        UNKNOWN_MODIFIER: 'PAR021', EXPECTED_ENUM_DELIMITER: 'PAR022'
    }),
    semantic: Object.freeze({
        MISSING_ENTITY_DECLARATION: 'SEM001', DUPLICATE_ENTITY: 'SEM002',
        RESERVED_ENTITY_NAME: 'SEM003', EMPTY_ENTITY: 'SEM004',
        DUPLICATE_FIELD: 'SEM005', RESERVED_FIELD_NAME: 'SEM006',
        INVALID_DATATYPE: 'SEM007', INVALID_CONSTRAINT: 'SEM008',
        DUPLICATE_CONSTRAINT: 'SEM009', MULTIPLE_PRIMARY_KEYS: 'SEM010',
        INVALID_PRIMARY_KEY_TYPE: 'SEM011', DUPLICATE_VALIDATION: 'SEM012',
        INVALID_NUMERIC_BOUND: 'SEM013', INVALID_LENGTH_BOUND: 'SEM014',
        NUMERIC_MODIFIER_TYPE_MISMATCH: 'SEM015', LENGTH_MODIFIER_TYPE_MISMATCH: 'SEM016',
        MIN_EXCEEDS_MAX: 'SEM017', MIN_LENGTH_EXCEEDS_MAX_LENGTH: 'SEM018',
        NON_INTEGER_BOUND: 'SEM019', DUPLICATE_DEFAULT: 'SEM020',
        INVALID_DEFAULT_TYPE: 'SEM021', DEFAULT_OUT_OF_RANGE: 'SEM022',
        DEFAULT_LENGTH_OUT_OF_RANGE: 'SEM023', DUPLICATE_RELATION: 'SEM024',
        RESERVED_RELATION_NAME: 'SEM025', INVALID_RELATION_TYPE: 'SEM026',
        SELF_RELATION: 'SEM027', UNKNOWN_SOURCE_ENTITY: 'SEM028', UNKNOWN_TARGET_ENTITY: 'SEM029',
        INVALID_ENUM_VALUES: 'SEM030', DUPLICATE_ENUM_VALUE: 'SEM031', INVALID_ENUM_DEFAULT: 'SEM032',
        IMPLICIT_PRIMARY_KEY_COLLISION: 'SEM033', GENERATED_NAME_COLLISION: 'SEM034'
    }),
    input: Object.freeze({ INVALID_SOURCE: 'INP001', MALFORMED_JSON: 'INP002' }),
    internal: Object.freeze({ FAILURE: 'INT001' })
});

// Separate, append-only warning namespace; phase and symbol remain independent.
const WARNING_CODES = Object.freeze({
    semantic: Object.freeze({ IMPLICIT_PRIMARY_KEY: 'WRN001' }),
    optimizer: Object.freeze({
        CONFLICTING_FIELD: 'WRN002', CONFLICTING_RELATION_TYPE: 'WRN003',
        CONFLICTING_RELATION_ENDPOINTS: 'WRN004', INVALID_IR: 'WRN005'
    })
});

function createDiagnostic(phase, symbol, message, location = {}, hint, { severity = 'error' } = {}) {
    if (severity !== 'error' && severity !== 'warning') throw new Error(`Unsupported diagnostic severity: ${severity}`);
    const registry = severity === 'warning' ? WARNING_CODES : CODES;
    const code = registry[phase]?.[symbol] ||
        (severity === 'error' && symbol === 'FAILURE' ? CODES.internal.FAILURE : null);
    if (!code) throw new Error(`Unregistered diagnostic: ${phase}.${symbol}`);
    const diagnostic = { phase, code, severity, message, symbol,
        line: Number.isInteger(location.line) && location.line > 0 ? location.line : null,
        column: Number.isInteger(location.column) && location.column > 0 ? location.column : null };
    if (diagnostic.line && diagnostic.column && Number.isInteger(location.endLine) &&
        Number.isInteger(location.endColumn) && location.endColumn > 0 &&
        (location.endLine > diagnostic.line ||
         (location.endLine === diagnostic.line && location.endColumn > diagnostic.column))) {
        diagnostic.endLine = location.endLine;
        diagnostic.endColumn = location.endColumn;
    }
    if (hint) diagnostic.hint = hint;
    return diagnostic;
}

function createWarningDiagnostic(phase, symbol, message, location = {}, hint) {
    return createDiagnostic(phase, symbol, message, location, hint, { severity: 'warning' });
}

// Known locations sort first. Exact ties retain emission order (stable sort).
function sortDiagnostics(diagnostics) {
    const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const phaseIndex = phase => {
        const index = COMPILER_PHASES.indexOf(phase);
        return index === -1 ? COMPILER_PHASES.length : index;
    };
    return [...diagnostics].sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) ||
        (a.line ?? Infinity) - (b.line ?? Infinity) ||
        (a.column ?? Infinity) - (b.column ?? Infinity) || compareText(a.code, b.code));
}

// Keep Error.message/code/userMessage intact for existing callers.
function attachDiagnostic(error, phase, location = error, symbol = error.code, hint) {
    error.diagnostic = createDiagnostic(phase, symbol || 'EXPECTED_TOKEN',
        error.userMessage || error.message, location, hint);
    return error;
}

function internalDiagnostic(phase) {
    return createDiagnostic(phase, 'FAILURE', `Internal compiler failure during ${phase}.`);
}

// Parsed AST metadata stays out of language values and generated artifacts.
function locate(node, key, fallbackColumn, occurrence = 0) {
    return node.sourceLocations?.[key]?.[occurrence] || { line: node.line, column: fallbackColumn };
}

module.exports = { COMPILER_PHASES, CODES, WARNING_CODES, createDiagnostic, createWarningDiagnostic,
    sortDiagnostics, attachDiagnostic, internalDiagnostic, locate };
