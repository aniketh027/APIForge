'use strict';
// Explicit test-owned factories are mandatory. Never fall back to the user Store.
const express = require('express');
const path = require('node:path');
const { createProjectApi } = require('../src/api/project-api');
const { createPersistentApi } = require('../src/api/persistent-runtime-api');
async function serve({ storeApi, manager, enabled = true } = {}) {
    if (!storeApi?.initializeProjectStore || !storeApi?.openProjectStore || !manager) throw Error('Explicit fixture factories required');
    const app = express(), calls = [], sockets = new Set();
    app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) res.on('finish', () => calls.push({ path: req.originalUrl, method: req.method, status: res.statusCode }));
        next();
    });
    const env = { APIFORGE_PROJECT_API: '1', APIFORGE_PERSISTENT_RUNNER: enabled ? '1' : '0' };
    const projects = createProjectApi({ env, storeApi }), persistent = createPersistentApi({ env, manager });
    app.use('/api/projects', projects.router); app.use('/api/persistent', persistent.router);
    app.use(express.json({ limit: '2mb' })); app.use('/api', require('../src/api/compiler-api'));
    app.get('/source-frame.js', (req, res) => res.sendFile(path.join(__dirname, '../src/utils/source-frame.js')));
    app.use(express.static(path.join(__dirname, '../frontend')));
    const listener = app.listen(0, '127.0.0.1');
    listener.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
    return { origin: 'http://127.0.0.1:' + listener.address().port, calls,
        async stop() {
            const closed = new Promise(resolve => listener.close(resolve));
            await Promise.all([projects.shutdown(), persistent.shutdown()]);
            sockets.forEach(socket => socket.destroy()); await closed;
        }
    };
}
module.exports = { serve };
