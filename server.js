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
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        const httpClosed = new Promise(resolve => server.close(resolve));
        const cleanup = await Promise.allSettled([liveManager.shutdown(), projectApi.shutdown()]);
        if (cleanup[0].status === 'rejected') console.error('LIVE_CLEANUP_FAILED');
        if (cleanup[1].status === 'rejected') console.error('PROJECT_STORE_CLOSE_FAILED');
        await httpClosed;
        process.exit(cleanup.some(result => result.status === 'rejected') ? 1 : 0);
    });
}

module.exports = app;
