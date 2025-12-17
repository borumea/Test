// server/Routes/data.js
// Data manipulation endpoints using generalized services

const express = require('express');
const router = express.Router();

const { pool } = require('../Services/db');
const { createQueryBuilder } = require('../Services/queryBuilder');
const { getEntityMetadata } = require('../Services/metadata');
const { insertRecord, updateRecord, deleteRecords, getRecordByKey } = require('../Services/crud');
const { authenticateToken, requireTablePermission } = require('../Middleware/auth');

// Multer for file uploads
const multer = (() => {
    try { return require('multer'); } catch (e) { return null; }
})();
const uploadMemory = multer ? multer({ storage: multer.memoryStorage() }) : null;

/**
 * POST /api/query
 * Execute a query with filters, grouping, and aggregation
 */
router.post('/query', authenticateToken, requireTablePermission('table'), async (req, res) => {
    try {
        const { table, columns, filters, orderBy, groupBy, aggregate, limit, offset } = req.body || {};

        // Get metadata
        const metadata = await getEntityMetadata(table);
        const allowedCols = metadata.columns.map(c => c.name);

        // Build query
        const builder = createQueryBuilder(table);

        // Add columns
        if (columns && Array.isArray(columns) && columns.length > 0) {
            const validCols = columns.filter(c => allowedCols.includes(c));
            builder.select(validCols);
        } else {
            builder.select('*');
        }

        // Add filters
        builder.where(filters, allowedCols);

        // Add ordering
        builder.orderBy(orderBy, allowedCols);

        // Add grouping
        if (groupBy) {
            builder.groupBy(groupBy, allowedCols);
        }

        // Add aggregation
        if (aggregate) {
            builder.aggregate(aggregate, allowedCols);
        }

        // Add limits
        if (limit) builder.limit(limit);
        if (offset) builder.offset(offset);

        // Execute query
        const { sql, params } = builder.build();
        const [rows, fields] = await pool.query(sql, params);

        // Extract column names
        const resultColumns = fields
            ? fields.map(f => f.name)
            : rows.length > 0 ? Object.keys(rows[0]) : [];

        return res.json({ rows, columns: resultColumns });

    } catch (e) {
        console.error('Query error:', e);
        res.status(500).json({ error: e.message || 'Query failed' });
    }
});

/**
 * POST /api/insert
 * Insert a new record (supports multipart/form-data for file uploads)
 */
router.post(
    '/insert',
    authenticateToken,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    requireTablePermission('table'),
    async (req, res) => {
        try {
            let table, data;

            if (req.is('multipart/form-data')) {
                table = req.body.table;
                data = {};

                // Parse form fields
                for (const [key, value] of Object.entries(req.body || {})) {
                    if (key === 'table') continue;
                    try {
                        data[key] = JSON.parse(value);
                    } catch (e) {
                        data[key] = value;
                    }
                }

                // Add files
                const files = {};
                for (const file of (req.files || [])) {
                    files[file.fieldname] = file.buffer;
                }

                const result = await insertRecord(table, data, files);
                return res.json(result);

            } else {
                table = req.body.table;
                data = req.body.data;

                if (!data || typeof data !== 'object') {
                    return res.status(400).json({ error: 'data object required' });
                }

                const result = await insertRecord(table, data);
                return res.json(result);
            }

        } catch (e) {
            console.error('Insert error:', e);
            res.status(500).json({ error: e.message || 'Insert failed' });
        }
    }
);

/**
 * POST /api/update
 * Update an existing record (supports multipart/form-data for file uploads)
 */
router.post(
    '/update',
    authenticateToken,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    requireTablePermission('table'),
    async (req, res) => {
        try {
            let table, data, pkColumn, pkValue;

            if (req.is('multipart/form-data')) {
                table = req.body.table;
                pkColumn = req.body.pkColumn;
                pkValue = req.body.pkValue;
                data = {};

                // Parse form fields
                for (const [key, value] of Object.entries(req.body || {})) {
                    if (['table', 'pkColumn', 'pkValue'].includes(key)) continue;
                    try {
                        data[key] = JSON.parse(value);
                    } catch (e) {
                        data[key] = value;
                    }
                }

                // Add files
                const files = {};
                for (const file of (req.files || [])) {
                    files[file.fieldname] = file.buffer;
                }

                const result = await updateRecord(table, pkColumn, pkValue, data, files);
                return res.json(result);

            } else {
                table = req.body.table;
                data = req.body.data;
                pkColumn = req.body.pkColumn;
                pkValue = req.body.pkValue;

                if (!data || typeof data !== 'object') {
                    return res.status(400).json({ error: 'data object required' });
                }

                if (!pkValue) {
                    return res.status(400).json({ error: 'pkValue required' });
                }

                const result = await updateRecord(table, pkColumn, pkValue, data);
                return res.json(result);
            }

        } catch (e) {
            console.error('Update error:', e);
            res.status(500).json({ error: e.message || 'Update failed' });
        }
    }
);

/**
 * POST /api/delete
 * Delete one or more records
 */
router.post(
    '/delete',
    authenticateToken,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    requireTablePermission('table'),
    async (req, res) => {
        try {
            let table, pkColumn, pkValue, pkValues;

            if (req.is('multipart/form-data')) {
                table = req.body.table;
                pkColumn = req.body.pkColumn;
                pkValue = req.body.pkValue;
                try {
                    pkValues = JSON.parse(req.body.pkValues);
                } catch (e) {
                    pkValues = req.body.pkValues;
                }
            } else {
                table = req.body.table;
                pkColumn = req.body.pkColumn;
                pkValue = req.body.pkValue;
                pkValues = req.body.pkValues;
            }

            if (!table) {
                return res.status(400).json({ error: 'table required' });
            }

            // Normalize to array
            const values = pkValues || (pkValue ? [pkValue] : []);
            if (values.length === 0) {
                return res.status(400).json({ error: 'pkValue or pkValues required' });
            }

            const result = await deleteRecords(table, pkColumn, values);
            return res.json(result);

        } catch (e) {
            console.error('Delete error:', e);
            res.status(500).json({ error: e.message || 'Delete failed' });
        }
    }
);

module.exports = router;