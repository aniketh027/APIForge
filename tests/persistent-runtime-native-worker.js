'use strict';
// Test-only preload for the ACTUAL standalone dev server. Production has no
// store-root selector. Never load this without the explicit native fixture args.
if (process.argv[2] !== '--persistent-native-fixture') throw Error('Native fixture arguments required');
const fixture = JSON.parse(process.argv[3]);
const runtime = require('../src/persistent-runtime/process'), originalLaunch = runtime.launch, originalStop = runtime.stop;
let launched = 0, ownedChild, failedStop = false;
runtime.launch = (...args) => { const state = originalLaunch(...args); launched++; ownedChild = state.child; return state; };
if (fixture.mode === 'cleanup-failure') runtime.stop = async state => {
    if (!failedStop) { failedStop = true; throw Error('Controlled native cleanup fault'); }
    return originalStop(state);
};
if (fixture.mode === 'claim-ack') {
    const database = require('../src/persistent-runtime/database'), originalResource = database.resource;
    let injected = false;
    database.resource = (identity, config) => originalResource(identity, config, { connector: async (name, importing) => {
        let connection;
        if (identity.target === 'mysql') connection = await require('mysql2/promise').createConnection({ ...config, ...(name ? { database: name } : {}), multipleStatements: importing, connectTimeout: 5000 });
        else { connection = database.postgresClient(config, name); connection.on('error', () => {}); await connection.connect(); }
        const query = connection.query.bind(connection);
        connection.query = async (...args) => {
            const result = await query(...args), sql = typeof args[0] === 'string' ? args[0] : args[0].sql;
            if (!injected && /UPDATE .* SET runtime_owner=\?/.test(sql.replace(/\$\d+/g, '?'))) {
                injected = true;
                if (identity.target === 'mysql') connection.destroy(); else connection.connection.stream.destroy();
                throw Error('Controlled lost claim receipt after real commit');
            }
            return result;
        };
        return connection;
    } });
}
const store = require('../src/project-store'), originalOpen = store.openProjectStore;
store.openProjectStore = () => originalOpen({ root: fixture.root });
store.initializeProjectStore = () => { throw Error('The test fixture is already initialized'); };
const express = require('express'), listen = express.application.listen;
express.application.listen = function (...args) {
    const server = listen.apply(this, args);
    server.once('listening', () => process.send?.({ event: 'listening', port: server.address().port }));
    return server;
};
process.on('message', message => {
    if (message.action === 'shutdown') process.emit('SIGTERM');
    if (message.action === 'stats') process.send?.({ event: 'stats', launched, active: !!ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null });
    if (message.action === 'crash-owned-child' && ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill('SIGKILL');
});
