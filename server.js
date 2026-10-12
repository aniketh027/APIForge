/**
 * ============================================================
 * APIForge Dev Server
 * ============================================================
 *
 * Serves the web frontend and mounts the compiler API.
 * This is separate from the GENERATED server (output/server.js).
 *
 * Usage:  node server.js
 *         npm run dev
 *
 * Routes:
 *   GET  /              → frontend/index.html
 *   GET  /style.css     → frontend/style.css
 *   GET  /app.js        → frontend/app.js
 *   POST /api/compile   → compiler pipeline
 *   GET  /api/health    → health check
 *
 * ============================================================
 */

const express = require('express');
const path = require('path');
const { COMPILER_PHASES, createDiagnostic, internalDiagnostic } = require('./src/utils/diagnostics');

const app = express();
const PORT = process.env.DEV_PORT || 3001;

const { createManager } = require('./src/live-runner/manager');
const liveManager = createManager();
app.use('/api/live', require('./src/api/live-runner-api').createRouter(liveManager));

// Project requests have their own access checks and JSON size policy.
const projectApi = require('./src/api/project-api').createProjectApi();
app.use('/api/projects', projectApi.router);
app.locals.shutdownProjectApi = projectApi.shutdown;

const persistentApi = require('./src/api/persistent-runtime-api').createPersistentApi();
app.use('/api/persistent', persistentApi.router);
app.locals.shutdownPersistentApi = persistentApi.shutdown;

// ── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Serve frontend static files ─────────────────────────────
app.get('/source-frame.js', (req, res) => res.sendFile(path.join(__dirname, 'src/utils/source-frame.js')));
app.use(express.static(path.join(__dirname, 'frontend')));

// ── Mount compiler API ──────────────────────────────────────
const compilerAPI = require('./src/api/compiler-api');
app.use('/api', compilerAPI);

// ── Fallback: serve index.html for root ─────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Server Error]', err.stack);
    const diagnostic = err.type === 'entity.parse.failed'
        ? createDiagnostic('input', 'MALFORMED_JSON', 'Request body must contain valid JSON.')
        : internalDiagnostic('input');
    res.status(500).json({ success: false, error: 'Internal Server Error', phase: 'input',
        phases: Object.fromEntries(COMPILER_PHASES.map(phase => [phase, false])),
        phaseStates: Object.fromEntries(COMPILER_PHASES.map(phase => [phase, 'skipped'])),
        diagnostic, diagnostics: [diagnostic], errors: [{ message: 'Internal Server Error', diagnostic }] });
});

// ── Start server ────────────────────────────────────────────
if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║       APIForge Dev Server                    ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  Frontend:  http://localhost:${PORT}            ║`);
        console.log(`║  API:       http://localhost:${PORT}/api/compile ║`);
        console.log(`║  Health:    http://localhost:${PORT}/api/health  ║`);
        console.log('╚══════════════════════════════════════════════╝');
        console.log('');
    });
    // One deadline bounds HTTP draining AND application cleanup. Never wait again
    // after it fires; accepted work that misses it has no completion guarantee.
    const SHUTDOWN_GRACE_MS = 30000;
    const sockets = new Set();
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
        if (shuttingDown) return;
        shuttingDown = true;
        const deadline = setTimeout(() => {
            console.error('SHUTDOWN_DEADLINE_EXCEEDED');
            try {
                if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
                else for (const socket of sockets) socket.destroy(); // Node 18.0/18.1.
            } catch { console.error('HTTP_CLOSE_FAILED'); }
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        const httpClosed = new Promise((resolve, reject) => {
            try {
                server.close(error => error ? reject(error) : resolve());
                // Added in Node 18.2; never destroys an active request/response.
                server.closeIdleConnections?.();
            } catch (error) { reject(error); }
        });
        function cleanup(action, failureCode) {
            try {
                return Promise.resolve(action()).then(() => true, () => {
                    console.error(failureCode); return false;
                });
            } catch { console.error(failureCode); return Promise.resolve(false); }
        }
        // Mark the project queue as stopping synchronously, before awaiting Live.
        const projectCleanup = cleanup(() => projectApi.shutdown(), 'PROJECT_STORE_CLOSE_FAILED');
        const persistentCleanup = cleanup(() => persistentApi.shutdown(), 'PERSISTENT_CLEANUP_FAILED');
        const liveCleanup = cleanup(() => liveManager.shutdown(), 'LIVE_CLEANUP_FAILED');
        const httpCleanup = cleanup(() => httpClosed, 'HTTP_CLOSE_FAILED');
        Promise.all([projectCleanup, persistentCleanup, liveCleanup, httpCleanup]).then(results => {
            clearTimeout(deadline);
            process.exit(results.every(Boolean) ? 0 : 1);
        });
    });
}

module.exports = app;
