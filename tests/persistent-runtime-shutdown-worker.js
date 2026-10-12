'use strict';
if (process.argv[2] !== '--persistent-shutdown-fixture') throw Error('Fixture required');
const mode = process.argv[3];
const f = require('./persistent-runtime-fakes').fixture();
const manager = f.makeManager(), api = require('../src/api/persistent-runtime-api'), factory = api.createPersistentApi;
if (mode === 'failure') f.processFault('stop');
if (mode === 'stuck') manager.shutdown = () => new Promise(() => {});
api.createPersistentApi = () => factory({ env: f.env, manager });
const express = require('express'), listen = express.application.listen;
express.application.listen = function (...args) {
    const server = listen.apply(this, args);
    server.once('listening', () => process.send?.({ event: 'listening', port: server.address().port, input: f.input() }));
    server.on('request', request => { if (request.url.startsWith('/api/persistent')) process.send?.({ event: 'request', url: request.url }); });
    return server;
};
const exit = process.exit.bind(process); let deadlines = 0;
const setTimer = global.setTimeout;
global.setTimeout = function (callback, milliseconds, ...args) { if (milliseconds === 30000) deadlines++; return setTimer(callback, milliseconds, ...args); };
process.exit = code => {
    const db = [...f.native.databases.values()][0];
    process.send?.({ event: 'exit-proof', code, deadlines, databasePresent: !!db, imports: db?.imports, claimOccupied: !!db?.record.runtime_owner,
        deleted: f.native.sql.some(entry => /DROP |TRUNCATE/i.test(entry.text)) }, () => exit(code));
};
process.on('message', message => { if (message.action === 'shutdown') { process.emit('SIGTERM'); process.emit('SIGINT'); } });
