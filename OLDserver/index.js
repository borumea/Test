// server/index.js
// Main Express API server - now modularized with security improvements

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const dbConfig = require('./Config/db.config');
const securityConfig = require('./Config/security');
const { generalLimiter } = require('./Middleware/rateLimiter');

// Import route modules
const authRoutes = require('./Routes/auth.routes');
const tablesRoutes = require('./Routes/tables.routes');
const dataRoutes = require('./Routes/data.routes');
const viewsRoutes = require('./Routes/views.routes');

// --- Configuration ---
const PORT = dbConfig["port"] || process.env.PORT || 3001;
const DB_HOST = dbConfig["host"] || process.env.DB_HOST;
const DB_USER = dbConfig["user"] || process.env.DB_USER;
const DB_NAME = dbConfig["database"] || process.env.DB_NAME;

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
app.use('/api', tablesRoutes);              // Legacy routes (/api/tables, /api/columns)
app.use('/api', dataRoutes);                // Data operations (query, insert, update, delete)
app.use('/api/views', viewsRoutes);         // View management

// --- Legacy employee endpoint (redirect to auth routes) ---
const { authenticateToken, requireEmployeesPermission } = require('./Middleware/auth');
const employeeService = require('./Services/employee.service');

app.get('/api/employees', authenticateToken, requireEmployeesPermission, async (req, res) => {
    try {
        const employees = await employeeService.getAllEmployees();
        res.json(employees);
    } catch (err) {
        console.error('Fetch employees error:', err);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});

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
║  Address: http://127.0.0.1:${PORT}                     ║
║  Database: ${DB_USER}@${DB_HOST}/${DB_NAME}            ║
║  Security: Rate limiting + JWT auth enabled            ║
║  Environment: ${process.env.NODE_ENV || 'development'} ║
╚════════════════════════════════════════════════════════╝
  `);
});