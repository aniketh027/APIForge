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

const app = express();
const PORT = process.env.DEV_PORT || 3001;

// ── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Serve frontend static files ─────────────────────────────
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
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ── Start server ────────────────────────────────────────────
if (require.main === module) {
    app.listen(PORT, () => {
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
}

module.exports = app;
