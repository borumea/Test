// server/routes/tables.routes.js
// Table and column metadata endpoints

const express = require('express');
const router = express.Router();

const dbService = require('../Services/db.service');
const { authenticateToken } = require('../Middleware/auth');
const { validateTableQuery } = require('../Middleware/validation');

/**
 * GET /api/tables
 * Get all tables and views
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const tables = await dbService.loadTables();
        res.json(tables);
    } catch (e) {
        console.error('Failed to load tables:', e);
        res.status(500).json({ error: 'Failed to load tables' });
    }
});

/**
 * GET /api/base-tables
 * Get only base tables (excludes views)
 */
router.get('/base-tables', authenticateToken, async (req, res) => {
    try {
        const baseTables = await dbService.loadBaseTables();
        res.json(baseTables);
    } catch (e) {
        console.error('Failed to load base tables:', e);
        res.status(500).json({ error: 'Failed to load base tables' });
    }
});

/**
 * GET /api/columns?table=xxx
 * Get column metadata for a table
 */
router.get('/columns', authenticateToken, validateTableQuery, async (req, res) => {
    try {
        const table = req.query.table;

        const tables = await dbService.loadTables();
        if (!tables.includes(table)) {
            return res.status(400).json({ error: `Unknown table ${table}` });
        }

        const cols = await dbService.loadColumnsMeta(table);
        res.json(cols);
    } catch (e) {
        console.error('Failed to load columns:', e);
        res.status(500).json({ error: 'Failed to load columns' });
    }
});

/**
 * GET /api/primaryKey?table=xxx
 * Get primary key column for a table
 */
router.get('/primaryKey', authenticateToken, validateTableQuery, async (req, res) => {
    try {
        const table = req.query.table;

        const tables = await dbService.loadTables();
        if (!tables.includes(table)) {
            return res.status(400).json({ error: `Unknown table ${table}` });
        }

        const cols = await dbService.loadColumnsMeta(table);
        const pk = cols.find(c => c.isPrimary) ||
            cols.find(c => c.name.toLowerCase() === "id") ||
            cols[0];

        if (!pk) {
            return res.status(204).end();
        }

        return res.json({ primaryKey: pk.name });
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

        const tables = await dbService.loadTables();
        if (!tables.includes(table)) {
            return res.status(400).json({ error: `Unknown table: ${table}` });
        }

        // Check permission
        const tableLower = table.toLowerCase();
        const permissions = req.user?.permissions || {};
        if (!permissions[tableLower] || permissions[tableLower] !== 1) {
            return res.status(403).json({ error: `Access denied to table: ${table}` });
        }

        const colsMeta = await dbService.loadColumnsMeta(table);

        let searchColumn;
        if (key) {
            const colNames = colsMeta.map((c) => c.name);
            if (!colNames.includes(key)) {
                return res.status(400).json({ error: `Unknown column '${key}' in table ${table}` });
            }
            searchColumn = key;
        } else {
            searchColumn =
                (colsMeta.find((c) => c.isPrimary)?.name) ||
                (colsMeta.find((c) => c.name.toLowerCase() === "id")?.name) ||
                colsMeta[0].name;
        }

        const sql = `SELECT * FROM \`${table}\` WHERE \`${searchColumn}\` = ? LIMIT 1`;
        const [rows] = await dbService.pool.query(sql, [searchValue]);

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        return res.json(rows[0]);
    } catch (err) {
        console.error('Record fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch record' });
    }
});

module.exports = router;