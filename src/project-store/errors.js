'use strict';
const messages = Object.freeze({
    PROJECT_STORE_RUNTIME_UNSUPPORTED: 'The SQLite Project Store runtime is unsupported.',
    PROJECT_STORE_PLATFORM_UNSUPPORTED: 'The Project Store requires Windows x64 and its private storage bootstrap.',
    PROJECT_INVALID_INPUT: 'Invalid project arguments.',
    PROJECT_INVALID_ID: 'A canonical UUID-v4 project identifier is required.',
    PROJECT_INVALID_NAME: 'A nonempty project name of at most 128 Unicode characters and 512 UTF-8 bytes is required.',
    PROJECT_INVALID_TARGET: 'The project target must be mysql or postgres.',
    PROJECT_INVALID_SOURCE: 'Source must be valid UTF-8 with at most 1048576 bytes.',
    PROJECT_INVALID_REVISION: 'A positive safe integer revision is required.',
    PROJECT_NOT_FOUND: 'The project or committed revision was not found.',
    PROJECT_REVISION_CONFLICT: 'The expected project revision is stale.',
    PROJECT_REVISION_LIMIT: 'The project revision limit has been reached.',
    PROJECT_STORE_EXISTS: 'Storage already exists; initialization cannot adopt it.',
    PROJECT_STORE_MISSING: 'Established storage is missing; manual resolution is required.',
    PROJECT_STORE_UNSAFE: 'Windows storage admission failed; manual resolution is required.',
    PROJECT_STORE_IDENTITY_MISMATCH: 'Storage identity changed; manual resolution is required.',
    PROJECT_STORE_INCOMPATIBLE: 'The database format or schema is incompatible.',
    PROJECT_STORE_CORRUPT: 'The project database is malformed or inconsistent.',
    PROJECT_STORE_RECOVERY_REQUIRED: 'Storage is incomplete or unexpected; manual resolution is required.',
    PROJECT_STORE_BUSY: 'The project database is busy; try again with the same expected revision.',
    PROJECT_STORE_CLOSED: 'The project store is closed.',
    PROJECT_COMMIT_UNCERTAIN: 'The commit may have succeeded; reopen and inspect the committed revision before retrying.',
    PROJECT_STORE_STORAGE_FAILURE: 'The project storage operation failed.'
});
class ProjectStoreError extends Error {
    constructor(code) {
        const safe = Object.hasOwn(messages, code) ? code : 'PROJECT_STORE_STORAGE_FAILURE';
        super(messages[safe]);
        this.name = 'ProjectStoreError';
        this.code = safe;
        // Public errors retain no native exception or source-file pathname.
        this.stack = this.name + ': ' + this.message;
    }
}
function fail(code) { throw new ProjectStoreError(code); }
function sanitized(error) {
    if (error instanceof ProjectStoreError) return error;
    if (error && error.name === 'WindowsBootstrapError') {
        const codes = {
            BOOTSTRAP_ROOT_EXISTS: 'PROJECT_STORE_EXISTS',
            BOOTSTRAP_ROOT_MISSING: 'PROJECT_STORE_MISSING',
            BOOTSTRAP_IDENTITY_MISMATCH: 'PROJECT_STORE_IDENTITY_MISMATCH',
            BOOTSTRAP_RECOVERY_REQUIRED: 'PROJECT_STORE_RECOVERY_REQUIRED',
            BOOTSTRAP_CORRUPT_IDENTITY: 'PROJECT_STORE_RECOVERY_REQUIRED',
            BOOTSTRAP_UNSUPPORTED_PLATFORM: 'PROJECT_STORE_PLATFORM_UNSUPPORTED',
            BOOTSTRAP_INVALID_OPTIONS: 'PROJECT_INVALID_INPUT',
            BOOTSTRAP_INVALID_PATH: 'PROJECT_INVALID_INPUT'
        };
        return new ProjectStoreError(codes[error.code] || 'PROJECT_STORE_UNSAFE');
    }
    const sqliteCode = error && Number.isInteger(error.errcode) ? error.errcode & 255 : null;
    if (sqliteCode === 5 || sqliteCode === 6) return new ProjectStoreError('PROJECT_STORE_BUSY');
    if (sqliteCode === 11 || sqliteCode === 26) return new ProjectStoreError('PROJECT_STORE_CORRUPT');
    if (sqliteCode === 14 || (error && error.code === 'ENOENT')) return new ProjectStoreError('PROJECT_STORE_MISSING');
    return new ProjectStoreError('PROJECT_STORE_STORAGE_FAILURE');
}
module.exports = { ProjectStoreError, fail, sanitized };
