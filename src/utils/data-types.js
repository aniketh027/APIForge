// Target-independent built-in datatype vocabulary, shared by compiler phases.
const SUPPORTED_DATA_TYPES = Object.freeze([
    'INT', 'STRING', 'FLOAT', 'BOOLEAN', 'ENUM', 'DATE', 'TIMESTAMP', 'UUID'
]);
module.exports = { SUPPORTED_DATA_TYPES };
