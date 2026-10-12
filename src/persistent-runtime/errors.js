'use strict';
const registry = Object.freeze({
    PERSISTENT_DISABLED: [403, 'Persistent runtime requires explicit runtime and project API enablement.'],
    PERSISTENT_NOT_LOCAL: [403, 'A direct loopback peer and local listener authority are required.'],
    PERSISTENT_ORIGIN_REFUSED: [403, 'The browser request origin is not permitted.'],
    PERSISTENT_TOKEN_INVALID: [403, 'A valid persistent API token header is required.'],
    PERSISTENT_REQUEST_INVALID: [400, 'The request must match the version 1 persistent runtime contract.'],
    PERSISTENT_JSON_INVALID: [400, 'A valid UTF-8 JSON object is required.'],
    PERSISTENT_MEDIA_UNSUPPORTED: [415, 'An uncompressed UTF-8 JSON request is required.'],
    PERSISTENT_BODY_TOO_LARGE: [413, 'The request exceeds the permitted size.'],
    PERSISTENT_RESPONSE_TOO_LARGE: [502, 'The generated response exceeds the permitted size.'],
    PERSISTENT_ENDPOINT_NOT_FOUND: [404, 'The persistent endpoint or method was not found.'],
    PERSISTENT_ENDPOINT_NOT_ALLOWED: [400, 'The generated operation is not permitted.'],
    PERSISTENT_PROJECT_UNAVAILABLE: [503, 'The existing saved project store or project cannot be verified.'],
    PERSISTENT_REVISION_MISMATCH: [409, 'The acknowledged revision does not match the saved project or initialized deployment. Schema upgrades require a separate reviewed operation.'],
    PERSISTENT_COMPILE_FAILED: [422, 'The saved source cannot be compiled for this runtime. Imports are unsupported; the saved source limit is 1 MiB.'],
    PERSISTENT_SCHEMA_RESERVED: [422, 'The compiled schema conflicts with the reserved persistent metadata namespace.'],
    PERSISTENT_ARTIFACT_CHANGED: [409, 'Generated artifact provenance changed. Automatic deployment upgrades are refused.'],
    PERSISTENT_CONFIGURATION_UNAVAILABLE: [503, 'Dedicated literal-loopback database configuration is required.'],
    PERSISTENT_DATABASE_UNAVAILABLE: [503, 'The target database could not be accessed or verified.'],
    PERSISTENT_PROFILE_UNSUPPORTED: [503, 'The database profile or durable transaction settings are unsupported.'],
    PERSISTENT_DATABASE_MISSING: [409, 'The deployment database is absent. Run cannot initialize it.'],
    PERSISTENT_DATABASE_COLLISION: [409, 'An existing database has no matching ownership attestation. It will not be adopted or changed.'],
    PERSISTENT_ALREADY_INITIALIZED: [409, 'This deployment is already initialized. Initialization cannot be replayed.'],
    PERSISTENT_INCOMPLETE: [409, 'Provisioning is incomplete. Preserve the database and inspect it manually before recovery.'],
    PERSISTENT_PROVISION_UNCERTAIN: [500, 'Provisioning may have committed partly or completely. Preserve state and inspect before any explicit recovery.'],
    PERSISTENT_BUSY: [409, 'A durable runtime claim is occupied. No automatic expiry or process takeover is permitted.'],
    PERSISTENT_CLAIM_UNCERTAIN: [500, 'A runtime ownership change may have committed. No replacement process is authorized without inspection.'],
    PERSISTENT_OWNERSHIP_LOST: [409, 'The exact runtime ownership claim could not be verified. Replacement is refused.'],
    PERSISTENT_SESSION_INVALID: [403, 'A valid owned runtime session is required.'],
    PERSISTENT_START_FAILED: [503, 'The owned generated API did not become healthy.'],
    PERSISTENT_REQUEST_FAILED: [502, 'The owned generated API request failed.'],
    PERSISTENT_CLEANUP_FAILED: [503, 'Runtime cleanup was not fully verified. Ownership is retained and replacement is refused.'],
    PERSISTENT_STOPPING: [503, 'The persistent runtime is shutting down.']
});
class PersistentError extends Error {
    constructor(code) {
        const selected = Object.hasOwn(registry, code) ? code : 'PERSISTENT_DATABASE_UNAVAILABLE';
        super(registry[selected][1]); this.name = 'PersistentError'; this.code = selected;
    }
}
function fail(code) { throw new PersistentError(code); }
function safe(error, fallback = 'PERSISTENT_DATABASE_UNAVAILABLE') {
    return new PersistentError(error instanceof PersistentError ? error.code : fallback);
}
function fields(value, required, optional = []) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Reflect.ownKeys(value).some(key => ![...required, ...optional].includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) ||
        required.some(key => !Object.hasOwn(value, key))) fail('PERSISTENT_REQUEST_INVALID');
}
module.exports = { registry, PersistentError, fail, safe, fields };
