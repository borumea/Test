// server/index.js
// Main Express API server - fully modularized with generalized services

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const dbConfig = require('./Config/db.config');
const securityConfig = require('./Config/security');
const { generalLimiter } = require('./Middleware/rateLimiter');

// Import route modules
const authRoutes = require('./Routes/auth');
const tablesRoutes = require('./Routes/tables');
const dataRoutes = require('./Routes/data');
const viewsRoutes = require('./Routes/views');

// --- Configuration (now handled by db.config.js with .env priority and auto-decryption) ---
const PORT = dbConfig.port;
const DB_HOST = dbConfig.host;
const DB_USER = dbConfig.user;
const DB_NAME = dbConfig.database;

// --- Initialize Express app ---
const app = express();
app.set('trust proxy', 1);

// --- Security middleware ---
app.use(helmet()); // Security headers
app.use(cors(securityConfig.cors)); // CORS with configuration
app.use(express.json({ limit: '10mb' })); // JSON body parser with size limit
app.use(generalLimiter); // Rate limiting

// --- Health check endpoint (no auth required) ---
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: DB_NAME
    });
});

// --- Mount route modules ---
app.use('/api/auth', authRoutes);           // Authentication & user management
app.use('/api/tables', tablesRoutes);       // Table metadata
app.use('/api', tablesRoutes);              // Legacy routes
app.use('/api', dataRoutes);                // Data operations (query, insert, update, delete)
app.use('/api/views', viewsRoutes);         // View management

// --- 404 handler ---
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// --- Start server ---
app.listen(PORT, '127.0.0.1', () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║     API Server Running                                 ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ║
║  Address: http://127.0.0.1:${PORT.toString().padEnd(28)}║
║  Database: ${DB_USER}@${DB_HOST}/${DB_NAME.padEnd(28)}║
║  Security: Rate limiting + JWT auth enabled            ║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(36)}║
╚════════════════════════════════════════════════════════╝
    `);
});