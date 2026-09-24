const assert = require('assert');
const crypto = require('crypto');

const temporaryDatabasePattern = /^apiforge_e2e_[a-z0-9]{12,40}$/;
const configurationNames = [
    'APIFORGE_TEST_DB_HOST',
    'APIFORGE_TEST_DB_PORT',
    'APIFORGE_TEST_DB_USER',
    'APIFORGE_TEST_DB_PASSWORD'
];

function readServerConfig(environment) {
    const missing = configurationNames.filter(name => {
        if (!Object.prototype.hasOwnProperty.call(environment, name)) return true;
        return name !== 'APIFORGE_TEST_DB_PASSWORD' && environment[name].trim() === '';
    });

    if (missing.length > 0) {
        throw new Error(
            'MySQL integration configuration is incomplete. Set these environment variables before running ' +
            '`npm run test:generated-mysql`: ' + missing.join(', ') + '.'
        );
    }

    const portText = environment.APIFORGE_TEST_DB_PORT;
    if (!/^\d+$/.test(portText)) {
        throw new Error('APIFORGE_TEST_DB_PORT must be an integer between 1 and 65535.');
    }
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('APIFORGE_TEST_DB_PORT must be an integer between 1 and 65535.');
    }

    return {
        host: environment.APIFORGE_TEST_DB_HOST,
        port,
        user: environment.APIFORGE_TEST_DB_USER,
        password: environment.APIFORGE_TEST_DB_PASSWORD
    };
}

function createTemporaryDatabaseName() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    const name = `apiforge_e2e_${timestamp}${random}`;
    assert.ok(temporaryDatabasePattern.test(name), `Unsafe generated temporary database name: ${name}`);
    return name;
}

function quoteTemporaryDatabaseName(name) {
    if (!temporaryDatabasePattern.test(name)) {
        throw new Error(`Refusing destructive SQL for unsafe database name: ${name}`);
    }
    return `\`${name}\``;
}

function serializeDotenv(environment) {
    return Object.entries(environment)
        .map(([name, rawValue]) => {
            const value = String(rawValue);
            if (!value.includes("'")) return `${name}='${value}'`;
            if (!value.includes('`')) return `${name}=\`${value}\``;
            if (!value.includes('"') && !/\\[nr]/.test(value)) return `${name}="${value}"`;
            throw new Error(`Cannot safely encode ${name} in the generated .env file.`);
        })
        .join('\n') + '\n';
}

module.exports = {
    createTemporaryDatabaseName,
    quoteTemporaryDatabaseName,
    readServerConfig,
    serializeDotenv,
    temporaryDatabasePattern
};
