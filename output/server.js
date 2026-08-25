/**
 * APIForge Express Server
 * Generated automatically by APIForge Compiler
 */

require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Registered Entity Routes
const studentRoutes = require('./routes/studentRoutes');

app.use('/students', studentRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'UP', message: 'APIForge server running smoothly' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`APIForge server listening on port ${PORT}`);
    });
}

module.exports = app;
