const assert = require('assert');
const dotenv = require('dotenv');

const {
    createTemporaryDatabaseName,
    quoteTemporaryDatabaseName,
    readServerConfig,
    serializeDotenv,
    temporaryDatabasePattern
} = require('./generated-backend-mysql-helpers');

assert.throws(
    () => readServerConfig({}),
    error => configurationNamesEverywhere(error.message),
    'Missing configuration should name every required environment variable'
);

function configurationNamesEverywhere(message) {
    return [
        'APIFORGE_TEST_DB_HOST',
        'APIFORGE_TEST_DB_PORT',
        'APIFORGE_TEST_DB_USER',
        'APIFORGE_TEST_DB_PASSWORD'
    ].every(name => message.includes(name));
}

const validEnvironment = {
    APIFORGE_TEST_DB_HOST: '127.0.0.1',
    APIFORGE_TEST_DB_PORT: '3307',
    APIFORGE_TEST_DB_USER: 'integration_user',
    APIFORGE_TEST_DB_PASSWORD: ''
};
assert.deepStrictEqual(readServerConfig(validEnvironment), {
    host: '127.0.0.1',
    port: 3307,
    user: 'integration_user',
    password: ''
});

for (const invalidPort of ['0', '65536', '3.3', 'mysql']) {
    assert.throws(
        () => readServerConfig({ ...validEnvironment, APIFORGE_TEST_DB_PORT: invalidPort }),
        /integer between 1 and 65535/,
        `Invalid MySQL port should fail: ${invalidPort}`
    );
}

const firstName = createTemporaryDatabaseName();
const secondName = createTemporaryDatabaseName();
assert.match(firstName, temporaryDatabasePattern);
assert.match(secondName, temporaryDatabasePattern);
assert.notStrictEqual(firstName, secondName, 'Temporary database names should be unique');
assert.strictEqual(quoteTemporaryDatabaseName(firstName), `\`${firstName}\``);

for (const unsafeName of [
    'apiforge_db',
    'mysql',
    'apiforge_e2e_short',
    'apiforge_e2e_valid123456`; DROP DATABASE mysql; --'
]) {
    assert.throws(
        () => quoteTemporaryDatabaseName(unsafeName),
        /Refusing destructive SQL/,
        `Unsafe database name should be rejected: ${unsafeName}`
    );
}

const dotenvValues = {
    PORT: '43210',
    DB_HOST: 'db.internal',
    DB_PORT: '3307',
    DB_USER: 'user name',
    DB_PASSWORD: 'p#ss"word\\with\nnewline',
    DB_NAME: firstName
};
assert.deepStrictEqual(dotenv.parse(serializeDotenv(dotenvValues)), dotenvValues);
assert.throws(
    () => serializeDotenv({ DB_PASSWORD: '\'"`\\n' }),
    /Cannot safely encode DB_PASSWORD/,
    'Values that dotenv cannot represent losslessly should fail closed'
);

console.log('Generated MySQL integration safety tests passed.');
