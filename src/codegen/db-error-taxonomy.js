// Verified against mysql2 3.23.4 constants/driver and MySQL 8.4 error reference.
// One compiler-side source; emitted controllers need no extra runtime module.
const groups = [
    { status: 409, message: 'Request conflicts with existing data.', codes: {
        ER_DUP_ENTRY: 1062, ER_NO_REFERENCED_ROW: 1216, ER_ROW_IS_REFERENCED: 1217,
        ER_NO_REFERENCED_ROW_2: 1452, ER_ROW_IS_REFERENCED_2: 1451
    } },
    { status: 400, message: 'Request contains a value rejected by the database.', codes: {
        ER_BAD_NULL_ERROR: 1048, ER_NO_DEFAULT_FOR_FIELD: 1364, ER_DATA_TOO_LONG: 1406,
        ER_WARN_DATA_OUT_OF_RANGE: 1264, ER_CHECK_CONSTRAINT_VIOLATED: 3819,
        WARN_DATA_TRUNCATED: 1265, ER_TRUNCATED_WRONG_VALUE: 1292,
        ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: 1366
    } },
    { status: 503, message: 'Database temporarily unavailable.', codes: {
        ER_CON_COUNT_ERROR: 1040, ER_TOO_MANY_USER_CONNECTIONS: 1203,
        ER_LOCK_WAIT_TIMEOUT: 1205, ER_LOCK_DEADLOCK: 1213,
        ECONNREFUSED: null, ECONNRESET: null, EPIPE: null, ETIMEDOUT: null,
        PROTOCOL_CONNECTION_LOST: null, PROTOCOL_SEQUENCE_TIMEOUT: null
    } }
];

function generateDatabaseErrorHandler() {
    return `// Database error taxonomy\n` +
        `const DATABASE_ERRORS = ${JSON.stringify(groups, null, 4)};\n\n` +
        `function sendDatabaseError(res, error, operation = 'read') {\n` +
        `    // Prefer code. Numeric errno aliases apply only when code is absent.\n` +
        `    const known = DATABASE_ERRORS.find(group =>\n` +
        `        (typeof error?.code === 'string' && Object.prototype.hasOwnProperty.call(group.codes, error.code)) ||\n` +
        `        (error?.code == null && typeof error?.errno === 'number' && Object.values(group.codes).includes(error.errno)));\n` +
        `    // Reads cannot create conflicts; only value-writing operations blame input.\n` +
        `    const applicable = known && (known.status === 503 ||\n` +
        `        (known.status === 409 && operation !== 'read') ||\n` +
        `        (known.status === 400 && (operation === 'write' || operation === 'association')));\n` +
        `    return res.status(applicable ? known.status : 500).json({ success: false,\n` +
        `        error: applicable ? known.message : 'Unable to complete request.' });\n` +
        `}\n// End database error taxonomy\n\n`;
}

module.exports = { generateDatabaseErrorHandler };
