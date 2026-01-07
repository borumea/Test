// server/Routes/data.js
// Data manipulation endpoints using generalized services

const express = require('express');
const router = express.Router();

const { pool, clearTagsAndRatingsCache } = require('../Services/db');
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
    let builtQuery = null;
    try {
        const { table, columns, filters, orderBy, groupBy, aggregate, limit, offset, includePrimaryKeys } = req.body || {};

        console.log('[API /query] Request received:', {
            table,
            columns,
            filters,
            orderBy,
            groupBy,
            aggregate,
            limit,
            offset
        });

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
        if (limit !== undefined && limit !== null) builder.limit(limit);
        if (offset !== undefined && offset !== null) builder.offset(offset);

        // Execute query
        builtQuery = builder.build();
        console.log('[API /query] Built SQL:', builtQuery.sql);
        console.log('[API /query] SQL params:', builtQuery.params);

        const [rows, fields] = await pool.query(builtQuery.sql, builtQuery.params);

        console.log(`[API /query] Query returned ${rows.length} rows`);

        // Extract column names
        const resultColumns = fields
            ? fields.map(f => f.name)
            : rows.length > 0 ? Object.keys(rows[0]) : [];

        // Include primary key information if requested
        const response = { rows, columns: resultColumns };

        if (includePrimaryKeys && metadata.isMultiTable && metadata.baseTables) {
            // For multi-table views, fetch and embed primary keys in each row
            const primaryKeys = {};
            const pkColumnsByTable = {};

            // Get primary key columns for each base table
            for (const baseTable of metadata.baseTables) {
                try {
                    const baseMeta = await getEntityMetadata(baseTable);
                    if (baseMeta.primaryKey) {
                        primaryKeys[baseTable] = baseMeta.primaryKey;
                        pkColumnsByTable[baseTable] = baseMeta.primaryKey;
                    }
                } catch (err) {
                    console.warn(`Failed to get PK for ${baseTable}:`, err.message);
                }
            }

            // Fetch primary key values for each row
            const enrichedRows = await Promise.all(rows.map(async (row) => {
                const pkData = {};

                for (const [baseTable, pkColumn] of Object.entries(pkColumnsByTable)) {
                    try {
                        // Find a column from this table that we can use to identify the row
                        const tableColumns = Object.keys(metadata.columnTableMap || {})
                            .filter(col => metadata.columnTableMap[col] === baseTable && row[col] !== undefined);

                        if (tableColumns.length > 0) {
                            // Build a query to fetch the PK value
                            const conditions = tableColumns.map(col => `\`${col}\` = ?`).join(' AND ');
                            const values = tableColumns.map(col => row[col]);

                            const [pkRows] = await pool.query(
                                `SELECT \`${pkColumn}\` FROM \`${baseTable}\` WHERE ${conditions} LIMIT 1`,
                                values
                            );

                            if (pkRows && pkRows.length > 0) {
                                // Store with table prefix to avoid conflicts
                                pkData[`__pk_${baseTable}`] = pkRows[0][pkColumn];
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to fetch PK for ${baseTable}:`, err.message);
                    }
                }

                // Merge PK data with row data
                return { ...row, ...pkData };
            }));

            response.rows = enrichedRows;
            response.primaryKeys = primaryKeys;
            response.pkColumnsByTable = pkColumnsByTable; // Map of table -> pk column name

        } else if (includePrimaryKeys) {
            // For regular tables, return single PK
            response.primaryKeys = { [table]: metadata.primaryKey };
        }

        return res.json(response);

    } catch (e) {
        console.error('[API /query] ERROR:', {
            message: e.message,
            stack: e.stack,
            requestBody: req.body,
            builtSQL: builtQuery?.sql,
            sqlParams: builtQuery?.params
        });

        // Return detailed error message
        const errorMessage = e.message || 'Query failed';
        const errorDetails = {
            error: errorMessage,
            table: req.body?.table,
            sql: builtQuery?.sql,
            sqlError: e.sqlMessage || e.code || undefined
        };

        res.status(500).json(errorDetails);
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

                // Clear tags/ratings cache if these tables were modified
                if (table === 'Tags' || table === 'Ratings') {
                    clearTagsAndRatingsCache();
                }

                return res.json(result);

            } else {
                table = req.body.table;
                data = req.body.data;

                if (!data || typeof data !== 'object') {
                    return res.status(400).json({ error: 'data object required' });
                }

                const result = await insertRecord(table, data);

                // Clear tags/ratings cache if these tables were modified
                if (table === 'Tags' || table === 'Ratings') {
                    clearTagsAndRatingsCache();
                }

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

                // Clear tags/ratings cache if these tables were modified
                if (table === 'Tags' || table === 'Ratings') {
                    clearTagsAndRatingsCache();
                }

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

                // Clear tags/ratings cache if these tables were modified
                if (table === 'Tags' || table === 'Ratings') {
                    clearTagsAndRatingsCache();
                }

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

            // Clear tags/ratings cache if these tables were modified
            if (table === 'Tags' || table === 'Ratings') {
                clearTagsAndRatingsCache();
            }

            return res.json(result);

        } catch (e) {
            console.error('Delete error:', e);
            res.status(500).json({ error: e.message || 'Delete failed' });
        }
    }
);

module.exports = router;