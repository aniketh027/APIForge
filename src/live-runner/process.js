'use strict';
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { request } = require('./transport');
const { fail } = require('./errors');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer(); server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
    });
}
function launch(root, port, config, database) {
    // Exclude inherited NODE_OPTIONS, preload settings and unrelated secrets.
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
        .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    Object.assign(env, { PORT: String(port), DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user,
        DB_PASSWORD: config.password, DB_NAME: database, NODE_PATH: [path.resolve(__dirname, '../../node_modules')].join(path.delimiter) });
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'loopback.js'), path.join(root, 'server.js')], {
        cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
    });
    const state = { child, failed: false, output: Buffer.alloc(0) };
    child.on('error', () => { state.failed = true; });
    // Kept internal; never return child output or exceptions to clients.
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        state.output = Buffer.concat([state.output, chunk]).subarray(-12000);
    });
    return state;
}
async function health(state, port, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (state.failed || state.child.exitCode !== null || state.child.signalCode !== null) fail('LIVE_START_FAILED');
        try {
            const response = await request(port, 'GET', '/health', undefined, { timeoutMs: Math.min(500, end - Date.now()) });
            if (response.status === 200 && response.body?.status === 'UP') return;
        } catch { /* Retry bounded startup polling. */ }
        await delay(50);
    }
    fail('LIVE_START_FAILED');
}
async function stop(state) {
    if (!state?.child?.pid) return;
    const child = state.child;
    if (process.platform === 'win32') {
        if (child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve, reject) => {
                const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
                    ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
                killer.once('error', reject);
                killer.once('exit', code => code === 0 || child.exitCode !== null || child.signalCode !== null ? resolve() : reject(new Error('Process cleanup failed')));
            });
        }
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await delay(20);
    if (child.exitCode === null && child.signalCode === null) fail('LIVE_CLEANUP_FAILED');
    state.output = Buffer.alloc(0);
}
async function released(port) {
    if (!port) return;
    for (let attempt = 0; attempt < 50; attempt++) {
        const ok = await new Promise(resolve => {
            const server = net.createServer(); server.once('error', () => resolve(false));
            server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
        });
        if (ok) return;
        await delay(50);
    }
    fail('LIVE_CLEANUP_FAILED');
}
module.exports = { freePort, launch, health, stop, released };
