'use strict';
// Test-only independent HTTP process; roots are private disposable fixtures.
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { createProjectApi } = require('../src/api/project-api');
let server, controller;
function fixtureRoot(root) {
    const relative = path.relative(os.homedir(), root);
    if (path.isAbsolute(relative) || !/^APIForge-M2B-HTTP-tests-[0-9a-f-]{36}\\[a-z0-9-]+$/.test(relative)) {
        throw new Error('Only disposable M2B test roots are permitted');
    }
}
// Preloaded only by disposable shutdown tests. server.js remains the actual main
// module; no production HTTP/env option enables these factory/IPC test seams.
if (process.argv[2] === '--shutdown-fixture') {
    const configuration = JSON.parse(process.argv[3]);
    fixtureRoot(configuration.root);
    const Module = require('node:module');
    const http = require('node:http');
    const originalLoad = Module._load;
    const mainFile = path.resolve(__dirname, '../server.js');
    const send = (event, data = {}) => process.send?.({ event, ...data });
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const secretError = () => new Error('PRIVATE_SECRET_NATIVE C:\\secret SELECT password token');
    const mode = configuration.mode;
    let deadlineTimer;
    const originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
    global.setTimeout = function(action, ms, ...args) {
        const timer = originalTimeout(action, ms, ...args);
        if (ms === 30000) { deadlineTimer = timer; send('deadlineStarted'); }
        return timer;
    };
    global.clearTimeout = function(timer) {
        if (timer === deadlineTimer) send('deadlineCleared');
        return originalClear(timer);
    };
    Module._load = function(id, parent, isMain) {
        const exported = originalLoad.call(this, id, parent, isMain);
        if (parent?.filename !== mainFile) return exported;
        if (id === './src/live-runner/manager') return { ...exported, createManager(...args) {
            const manager = exported.createManager(...args), shutdown = manager.shutdown.bind(manager);
            manager.shutdown = () => {
                send('liveCleanupStarted');
                if (mode === 'live-throw') throw secretError();
                return Promise.resolve(shutdown()).then(async () => {
                    if (mode === 'stuck-live') return new Promise(() => {});
                    if (mode === 'delayed-cleanup') await delay(500);
                    send('liveCleanupFinished');
                    if (['live-reject', 'both-reject'].includes(mode)) throw secretError();
                });
            };
            return manager;
        } };
        if (id === './src/api/project-api') return { ...exported, createProjectApi(options = {}) {
            const api = require('../src/project-store');
            const controller = exported.createProjectApi({ ...options, storeApi: {
                initializeProjectStore: () => { throw new Error('Initialization is not permitted in shutdown fixtures'); },
                openProjectStore: async () => {
                    const store = await api.openProjectStore({ root: configuration.root });
                    return { ...store,
                        saveProject(...args) {
                            send('operationAccepted');
                            if (mode === 'stuck-project') return new Promise(() => {});
                            return delay(750).then(() => store.saveProject(...args)).then(result => {
                                send('operationCommitted', { revision: result.revision }); return result;
                            });
                        },
                        close() { send('storeCloseStarted'); store.close(); send('storeClosed'); }
                    };
                }
            } });
            const shutdown = controller.shutdown;
            controller.shutdown = () => {
                send('projectCleanupStarted');
                return Promise.resolve(shutdown()).then(async () => {
                    if (mode === 'delayed-cleanup') await delay(750);
                    send('projectCleanupFinished');
                    if (['project-reject', 'both-reject'].includes(mode)) throw secretError();
                });
            };
            return controller;
        } };
        return exported;
    };
    const originalListen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
        const originalClose = this.close, originalForce = this.closeAllConnections, originalIdle = this.closeIdleConnections;
        this.close = function(callback) {
            send('httpCloseStarted');
            // Modern Node's close() calls this method internally. Keep that
            // implementation working while the application sees the absent
            // Node 18.0/18.1 convenience APIs; this remains a simulation.
            if (mode === 'early-node18') this.closeIdleConnections = originalIdle;
            let result;
            try {
                result = originalClose.call(this, error => {
                    send('httpClosed'); callback(mode === 'http-close-error' ? secretError() : error);
                });
            } finally { if (mode === 'early-node18') this.closeIdleConnections = undefined; }
            if (mode === 'http-close-throw') throw secretError();
            return result;
        };
        this.on('request', request => send('httpRequest', { path: request.originalUrl || request.url }));
        if (mode === 'early-node18') {
            this.closeIdleConnections = undefined; this.closeAllConnections = undefined;
        } else this.closeAllConnections = function() { send('httpForced'); return originalForce.call(this); };
        this.once('listening', () => send('listening', { port: this.address().port }));
        return originalListen.apply(this, args);
    };
    process.on('message', message => {
        if (message.action !== 'signal') return;
        // Windows subprocess.kill(SIGTERM) terminates without invoking Node's
        // listener. IPC dispatches the SAME registered handler; this is not OS
        // signal certification. POSIX tests use the real child signal instead.
        send('signalDispatched');
        for (const signal of message.signals) process.emit(signal, signal);
    });
} else {
process.on('message', async message => {
    try {
        if (message.action === 'start') {
            fixtureRoot(message.root);
            if (message.unsupportedRuntime) Object.defineProperty(process.versions, 'node', { value: '18.20.0' });
            const store = require('../src/project-store');
            controller = createProjectApi({ env: { APIFORGE_PROJECT_API: '1' }, storeApi: {
                initializeProjectStore: () => store.initializeProjectStore({ root: message.root }),
                openProjectStore: () => store.openProjectStore({ root: message.root })
            } });
            const app = express();
            app.use('/api/projects', controller.router);
            server = app.listen(0, '127.0.0.1');
            await new Promise(resolve => server.once('listening', resolve));
            process.send({ port: server.address().port, pid: process.pid });
        } else if (message.action === 'stop') {
            const closed = new Promise(resolve => server.close(resolve));
            await controller.shutdown();
            await closed;
            process.send({ closed: true });
            process.disconnect();
        } else throw new Error('Unknown test command');
    } catch { process.send({ failed: true }); }
});
process.send({ ready: true });
}
