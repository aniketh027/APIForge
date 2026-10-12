'use strict';
// Exact evidence only; retain the original console output and failing exit status.
const fs = require('node:fs');
const original = console.error;
console.error = function(...values) {
    for (const error of values) if (error?.name === 'AssertionError' && process.env.APIFORGE_VERIFY_ASSERTION_LOG) {
        fs.writeFileSync(process.env.APIFORGE_VERIFY_ASSERTION_LOG, JSON.stringify({
            name: error.name, message: error.message, stack: error.stack, operator: error.operator,
            expected: error.expected, actual: error.actual
        }, null, 2) + '\n', { flag: 'wx' });
    }
    return original.apply(this, values);
};
