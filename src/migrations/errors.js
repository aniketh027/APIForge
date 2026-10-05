'use strict';
class MigrationError extends Error {
    constructor(code, message, details = {}) { super(message); this.name='MigrationError'; this.code=code; this.details=details; }
}
function fail(code, message, details) { throw new MigrationError(code,message,details); }
module.exports={MigrationError,fail};
