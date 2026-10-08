'use strict';
const fs = require('node:fs/promises');
const { initializePrivateStoreRoot, openPrivateStoreRoot } = require('../src/windows-bootstrap');
process.on('message', async message => {
    if (message.pauseBeforeMarker || message.pauseAfterMarker) {
        const original = fs.open;
        fs.open = async (file, ...args) => {
            if (message.pauseBeforeMarker && file.endsWith('bootstrap.identity.json')) {
                process.send({ barrier: 'private-directory-created' });
                await new Promise(() => {});
            }
            const handle = await original(file, ...args);
            if (message.pauseAfterMarker && file.endsWith('bootstrap.identity.json')) {
                handle.writeFile = async () => { process.send({ barrier: 'empty-marker-created' }); await new Promise(() => {}); };
            }
            return handle;
        };
    }
    try {
        const value = await (message.open ? openPrivateStoreRoot : initializePrivateStoreRoot)({ root: message.root });
        process.send({ ok: true, value });
    } catch (error) { process.send({ ok: false, code: error.code, message: error.message }); }
    process.disconnect();
});
process.send({ ready: true });
