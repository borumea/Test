// server/Routes/tables.js
// Table and column metadata endpoints using unified metadata service

const express = require('express');
const router = express.Router();

const { getAllEntities, getEntityMetadata, entityExists } = require('../Services/metadata');
const { getRecordByKey } = require('../Services/crud');
const dbService = require('../Services/db');
const { authenticateToken, hasAccessToEntity } = require('../Middleware/auth');
const { validateTableQuery } = require('../Middleware/validation');

/**
 * GET /api/tables
 * Get all tables and views
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const entities = await getAllEntities();
        const names = entities.map(e => e.name);
        res.json(names);
    } catch (e) {
        console.error('Failed to load tables:', e);
        res.status(500).json({ error: 'Failed to load tables' });
    }
});

/**
 * GET /api/tables/detailed
 * Get all tables and views with type information
 */
router.get('/detailed', authenticateToken, async (req, res) => {
    try {
        const entities = await getAllEntities();
        res.json(entities);
    } catch (e) {
        console.error('Failed to load entities:', e);
        res.status(500).json({ error: 'Failed to load entities' });
    }
});

/**
 * GET /api/base-tables
 * Get only base tables (excludes views)
 */
router.get('/base-tables', authenticateToken, async (req, res) => {
    try {
        const entities = await getAllEntities();
        const baseTables = entities.filter(e => e.type === 'table').map(e => e.name);
        res.json(baseTables);
    } catch (e) {
        console.error('Failed to load base tables:', e);
        res.status(500).json({ error: 'Failed to load base tables' });
    }
});

/**
 * GET /api/columns?table=xxx
 * Get column metadata for a table or view
 */
router.get('/columns', authenticateToken, validateTableQuery, async (req, res) => {
    try {
        const table = req.query.table;

        if (!await entityExists(table)) {
            return res.status(400).json({ error: `Unknown table or view: ${table}` });
        }

        const metadata = await getEntityMetadata(table);
        res.json(metadata.columns);

    } catch (e) {
        console.error('Failed to load columns:', e);
        res.status(500).json({ error: 'Failed to load columns' });
    }
});

/**
 * GET /api/metadata?table=TableName
 * Get metadata for a specific table or view
 */
router.get('/metadata', authenticateToken, async (req, res) => {
    try {
        const { table } = req.query;
        
        if (!table) {
            return res.status(400).json({ error: 'table parameter required' });
        }

        const metadata = await getEntityMetadata(table);
        return res.json(metadata);

    } catch (e) {
        console.error('Metadata error:', e);
        res.status(500).json({ error: e.message || 'Failed to get metadata' });
    }
});

/**
 * GET /api/primaryKey?table=xxx
 * Get primary key column for a table
 */
router.get('/primaryKey', authenticateToken, validateTableQuery, async (req, res) => {
    try {
        const table = req.query.table;

        if (!await entityExists(table)) {
            return res.status(400).json({ error: `Unknown table or view: ${table}` });
        }

        const metadata = await getEntityMetadata(table);

        if (!metadata.primaryKey) {
            return res.status(204).end();
        }

        return res.json({ primaryKey: metadata.primaryKey });

    } catch (e) {
        console.error('Primary key error:', e);
        res.status(500).json({ error: 'Failed to determine primary key' });
    }
});

/**
 * GET /api/record?table=xxx&key=columnName&value=someValue
 * Fetch a single record by a specific column
 */
router.get('/record', authenticateToken, async (req, res) => {
    try {
        const { table, key, value, pk } = req.query;

        if (!table) {
            return res.status(400).json({ error: 'Missing ?table parameter' });
        }

        const searchValue = value ?? pk;
        if (!searchValue) {
            return res.status(400).json({ error: 'Missing ?value (or ?pk) parameter' });
        }

        if (!await entityExists(table)) {
            return res.status(400).json({ error: `Unknown table: ${table}` });
        }

        // Check permissions
        const permissions = req.user?.permissions || {};
        const hasAccess = await hasAccessToEntity(table, permissions);

        if (!hasAccess) {
            return res.status(403).json({ error: `Access denied to table: ${table}` });
        }

        const record = await getRecordByKey(table, key, searchValue);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        return res.json(record);

    } catch (err) {
        console.error('Record fetch error:', err);
        res.status(500).json({ error: err.message || 'Failed to fetch record' });
    }
});

module.exports = router;