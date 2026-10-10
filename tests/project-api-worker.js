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
