'use strict';
// Test-owned server. Storage roots are admitted here, never supplied by HTTP.
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const { createProjectApi } = require('../src/api/project-api');

async function serve({ storeApi, enabled = true, port = 0 } = {}) {
    if (typeof storeApi?.initializeProjectStore !== 'function' || typeof storeApi?.openProjectStore !== 'function') {
        throw new Error('A disposable or controlled test-owned store factory is required');
    }
    const app = express();
    const calls = [];
    app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) res.on('finish', () => calls.push({
            method: req.method, path: req.originalUrl, body: req.body, status: res.statusCode
        }));
        next();
    });
    const controller = createProjectApi({ env: { APIFORGE_PROJECT_API: enabled ? '1' : '0' }, storeApi });
    app.use('/api/projects', controller.router);
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', require('../src/api/compiler-api'));
    app.get('/source-frame.js', (req, res) => res.sendFile(path.join(__dirname, '../src/utils/source-frame.js')));
    app.use(express.static(path.join(__dirname, '../frontend')));
    const server = app.listen(port, '127.0.0.1');
    const sockets = new Set();
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    return { port: server.address().port, origin: 'http://127.0.0.1:' + server.address().port, calls,
        async stop() {
            const closed = new Promise(resolve => server.close(resolve));
            await controller.shutdown();
            // Chromium may preconnect a TCP socket without sending HTTP. Node's
            // close() can wait for it indefinitely. After accepted store work
            // drains, dispose the test listener's remaining connections.
            for (const socket of sockets) socket.destroy();
            await closed;
        }
    };
}
function nativeApi(root) {
    const relative = path.relative(os.homedir(), root);
    if (path.isAbsolute(relative) || !/^APIForge-M2C-UI-tests-[0-9a-f-]{36}[\\/][a-z0-9-]+$/.test(relative)) {
        throw new Error('Only disposable M2C test roots are permitted');
    }
    const api = require('../src/project-store');
    return { initializeProjectStore: () => api.initializeProjectStore({ root }), openProjectStore: () => api.openProjectStore({ root }) };
}
module.exports = { serve, nativeApi };

if (require.main === module) {
    let value;
    process.on('message', async message => {
        try {
            if (message.action === 'start') {
                value = await serve({ storeApi: nativeApi(message.root), port: message.port || 0 });
                process.send({ port: value.port, pid: process.pid });
            } else if (message.action === 'stop') {
                await value.stop(); process.send({ stopped: true }); process.disconnect();
            } else throw new Error('Unknown fixture command');
        } catch { process.send({ failed: true }); }
    });
    process.send({ ready: true });
}
