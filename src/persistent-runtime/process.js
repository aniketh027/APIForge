'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const published = require('../live-runner/process');
const { fail } = require('./errors');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function ready(state) {
    return state?.listenerReady === true && state.failed === false && state.child?.connected === true
        && state.child.exitCode === null && state.child.signalCode === null;
}
function launch(root, port, config, database) {
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
        .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const nonce = crypto.randomBytes(32).toString('hex');
    Object.assign(env, { PORT: String(port), DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user,
        DB_PASSWORD: config.password, DB_NAME: database, APIFORGE_PERSISTENT_CHILD_NONCE: nonce,
        NODE_PATH: path.resolve(__dirname, '../../node_modules') });
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'loopback.js'), path.join(root, 'server.js')], {
        cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    const state = { child, failed: false, listenerReady: false, output: Buffer.alloc(0) };
    const invalidate = () => { state.listenerReady = false; state.failed = true; };
    child.on('disconnect', invalidate);
    child.on('error', invalidate);
    child.on('exit', invalidate);
    child.on('message', message => {
        if (!state.failed && child.connected === true && child.exitCode === null && child.signalCode === null
            && message?.nonce === nonce && message.port === port && ['listening', 'closed'].includes(message.event)) {
            state.listenerReady = message.event === 'listening';
        }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        state.output = Buffer.concat([state.output, chunk]).subarray(-12000);
    });
    return state;
}
async function health(state, port, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (!state.listenerReady && Date.now() < end) {
        if (state.failed || state.child.connected !== true || state.child.exitCode !== null || state.child.signalCode !== null) fail('PERSISTENT_START_FAILED');
        await delay(25);
    }
    if (!ready(state) || Date.now() >= end) fail('PERSISTENT_START_FAILED');
    await published.health(state, port, end - Date.now());
    if (!ready(state)) fail('PERSISTENT_START_FAILED');
}
async function stop(state) {
    const child = state?.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) { state.output = Buffer.alloc(0); return; }
    // Generated artifacts spawn no grandchildren. Node owns the native child
    // handle; do not use taskkill/unknown PIDs or adopt another process tree.
    if (!child.kill('SIGKILL')) fail('PERSISTENT_CLEANUP_FAILED');
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.removeListener('exit', done); reject(new Error()); }, 5000);
        function done() { clearTimeout(timer); resolve(); }
        child.once('exit', done);
        if (child.exitCode !== null || child.signalCode !== null) { child.removeListener('exit', done); done(); }
    }).catch(() => fail('PERSISTENT_CLEANUP_FAILED'));
    state.output = Buffer.alloc(0);
}
module.exports = { freePort: published.freePort, launch, health, ready, released: published.released, stop };
