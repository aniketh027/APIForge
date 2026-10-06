'use strict';
const MESSAGES = Object.freeze({
    LIVE_DISABLED: 'Live API runner is disabled.',
    LIVE_NOT_LOCAL: 'Live API runner requires a loopback client.',
    LIVE_TARGET_NOT_CONFIGURED: 'The selected target is not configured for Live API.',
    LIVE_COMPILE_FAILED: 'Compilation failed. Compile valid source without IMPORT before starting.',
    LIVE_DATABASE_SETUP_FAILED: 'Disposable database setup failed.',
    LIVE_START_FAILED: 'The generated API could not start.',
    LIVE_SESSION_INVALID: 'Live session stopped or expired. Start again.',
    LIVE_ENDPOINT_NOT_ALLOWED: 'This operation is not allowed by the generated OpenAPI.',
    LIVE_REQUEST_INVALID: 'Invalid Live API request.',
    LIVE_REQUEST_TIMEOUT: 'The generated API request timed out.',
    LIVE_RESPONSE_TOO_LARGE: 'The generated API response exceeded the capture limit.',
    LIVE_REQUEST_FAILED: 'The generated API request failed.',
    LIVE_CLEANUP_FAILED: 'Some disposable resources could not be cleaned up. Stop or retry before starting.'
});
class LiveError extends Error {
    constructor(code) { super(MESSAGES[code] || MESSAGES.LIVE_REQUEST_FAILED); this.code = code; }
}
function fail(code) { throw new LiveError(code); }
function publicError(error) {
    const code = error instanceof LiveError && Object.hasOwn(MESSAGES, error.code) ? error.code : 'LIVE_REQUEST_FAILED';
    return { success: false, code, error: MESSAGES[code] };
}
function exactKeys(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('LIVE_REQUEST_INVALID');
}
module.exports = { LiveError, fail, publicError, exactKeys };
