// server/routes/data.routes.js
// Data manipulation endpoints: query, insert, update, delete

const express = require('express');
const router = express.Router();

const dbService = require('../Services/db.service');
const { sanitizeValueForColumn } = require('../Utils/helpers');
const { isValidOperator, isValidAggregateFunction } = require('../Utils/validators');
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
        const body = req.body || {};
        const table = body.table;

        const tables = await dbService.loadTables();
        if (!tables.includes(table)) {
            return res.status(400).json({ error: `Unknown table ${table}` });
        }

        const allowedCols = await dbService.loadColumns(table);
        const columns = Array.isArray(body.columns)
            ? body.columns.filter((c) => allowedCols.includes(c))
            : [];

        const groupBy = body.groupBy;
        const aggregate = body.aggregate;
        const filters = Array.isArray(body.filters) ? body.filters : [];

        // Validate groupBy
        if (groupBy && !allowedCols.includes(groupBy)) {
            return res.status(400).json({ error: `Invalid groupBy column: ${groupBy}` });
        }

        // Validate aggregate
        if (aggregate && typeof aggregate === "object" && aggregate.column) {
            if (!(aggregate.column === "*" || allowedCols.includes(aggregate.column))) {
                return res.status(400).json({ error: `Invalid aggregate column: ${aggregate.column}` });
            }
        }

        // Build WHERE clause
        const whereParts = [];
        const params = [];

        for (const f of filters) {
            if (!f || typeof f !== "object") continue;
            const col = f.column;
            let op = String(f.operator || "=").toUpperCase().trim();
            const val = f.value;

            if (!allowedCols.includes(col)) continue;
            if (!isValidOperator(op)) continue;

            if (op === "IN" && Array.isArray(val) && val.length > 0) {
                whereParts.push(`\`${col}\` IN (${val.map(() => '?').join(',')})`);
                params.push(...val);
            } else if (op === "BETWEEN" && Array.isArray(val) && val.length >= 2) {
                whereParts.push(`\`${col}\` BETWEEN ? AND ?`);
                params.push(val[0], val[1]);
            } else if (op === "IS" || op === "IS NOT") {
                if (val === null || val === undefined) {
                    whereParts.push(`\`${col}\` ${op} NULL`);
                } else {
                    whereParts.push(`\`${col}\` ${op} ?`);
                    params.push(val);
                }
            } else {
                whereParts.push(`\`${col}\` ${op} ?`);
                params.push(val);
            }
        }

        const whereSQL = whereParts.length ? ('WHERE ' + whereParts.join(' AND ')) : '';

        // Handle aggregate function
        let aggFunc = null;
        let aggColumn = null;
        if (aggregate && typeof aggregate === "object") {
            aggFunc = String(aggregate.type || aggregate.func || "COUNT").toUpperCase();
            if (!isValidAggregateFunction(aggFunc)) {
                return res.status(400).json({ error: `Invalid aggregate function: ${aggFunc}` });
            }
            aggColumn = (aggregate.column === "*" ? "*" : `\`${aggregate.column}\``);
        }

        // Build SQL based on query type
        if (aggFunc && groupBy) {
            // Grouped aggregate
            const sql = `
        SELECT \`${groupBy}\` AS \`group\`, ${aggFunc}(${aggColumn}) AS \`value\`
        FROM \`${table}\`
        ${whereSQL}
        GROUP BY \`${groupBy}\`
        ORDER BY \`value\` DESC
      `;
            const [rows] = await dbService.pool.query(sql, params);
            return res.json({ rows, columns: ["group", "value"] });
        } else if (aggFunc && !groupBy) {
            // Single aggregate value
            const sql = `SELECT ${aggFunc}(${aggColumn}) AS \`value\` FROM \`${table}\` ${whereSQL}`;
            const [rows] = await dbService.pool.query(sql, params);
            return res.json({ rows, columns: ["value"] });
        } else if (!aggregate && groupBy) {
            // Group without aggregate (count)
            const sql = `
        SELECT \`${groupBy}\` AS \`group\`, COUNT(*) AS \`value\`
        FROM \`${table}\`
        ${whereSQL}
        GROUP BY \`${groupBy}\`
        ORDER BY \`value\` DESC
      `;
            const [rows] = await dbService.pool.query(sql, params);
            return res.json({ rows, columns: ["group", "value"] });
        } else {
            // Regular select
            const selectCols =
                columns && columns.length
                    ? columns.map((c) => `\`${c}\``).join(", ")
                    : "*";

            // Build ORDER BY clause
            let orderClause = "";
            if (body.orderBy) {
                const orderParts = [];
                for (const obj of [].concat(body.orderBy)) {
                    if (obj == null || obj == "") continue;

                    const rawOrder = String(obj).trim();
                    const parts = rawOrder.split(/\s+/);
                    const col = parts.slice(0, -1).join(" ");

                    if (allowedCols.includes(col)) {
                        let dir = "ASC";
                        const lastPart = parts[parts.length - 1].toUpperCase();
                        if (lastPart.startsWith("DESC")) {
                            dir = "DESC";
                        } else if (lastPart.startsWith("ASC")) {
                            dir = "ASC";
                        }
                        orderParts.push(`\`${col}\` ${dir}`);
                    }
                }

                if (orderParts.length > 0) {
                    orderClause = "ORDER BY " + orderParts.join(", ");
                }
            }

            const sql = `
        SELECT ${selectCols}
        FROM \`${table}\`
        ${whereSQL}
        ${orderClause}
      `;
            const [rows, fields] = await dbService.pool.query(sql, params);
            const cols = fields
                ? fields.map((f) => f.name)
                : rows.length
                    ? Object.keys(rows[0])
                    : [];
            return res.json({ rows, columns: cols });
        }
    } catch (e) {
        console.error('Query error:', e);
        res.status(500).json({ error: e.message || "Server error" });
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
            let table = req.body && req.body.table;
            let data = null;

            if (req.is('multipart/form-data')) {
                const files = req.files || [];
                data = {};
                for (const k of Object.keys(req.body || {})) {
                    if (k === 'table') continue;
                    try {
                        data[k] = JSON.parse(req.body[k]);
                    } catch (e) {
                        data[k] = req.body[k];
                    }
                }
                for (const f of files) {
                    data[f.fieldname] = f.buffer;
                }
            } else {
                const body = req.body || {};
                table = body.table;
                data = body.data;
            }

            if (!table) {
                return res.status(400).json({ error: "table is required" });
            }

            const tables = await dbService.loadTables();
            if (!tables.includes(table)) {
                return res.status(400).json({ error: `Unknown table ${table}` });
            }

            if (!data || typeof data !== 'object') {
                return res.status(400).json({ error: "data object is required" });
            }

            const colsMeta = await dbService.loadColumnsMeta(table);
            const allowedCols = colsMeta.map(c => c.name);

            const insertCols = [];
            const placeholders = [];
            const params = [];

            for (const c of colsMeta) {
                const k = c.name;

                // Skip auto-increment columns
                if (c.isAutoIncrement) continue;

                // Skip last_modified (will be set to CURRENT_TIMESTAMP)
                if (k.toLowerCase() === "last_modified") continue;

                if (!Object.prototype.hasOwnProperty.call(data, k)) {
                    continue;
                }

                const rawVal = data[k];
                const val = sanitizeValueForColumn(rawVal, c);

                insertCols.push(`\`${k}\``);
                placeholders.push('?');
                params.push(val);
            }

            // Auto-append last_modified if present in schema
            const hasLastModified = colsMeta.some(c => c.name.toLowerCase() === "last_modified");
            if (hasLastModified) {
                insertCols.push("`last_modified`");
                placeholders.push("CURRENT_TIMESTAMP()");
            }

            if (insertCols.length === 0) {
                return res.status(400).json({ error: "No valid columns provided" });
            }

            const sql = `INSERT INTO \`${table}\` (${insertCols.join(',')}) VALUES (${placeholders.join(',')})`;
            const [result] = await dbService.pool.query(sql, params);

            const primaryKeyCol = colsMeta.find(c => c.isPrimary);
            let primaryKeyValue = "";
            if (primaryKeyCol?.isAutoIncrement && primaryKeyCol?.name) {
                primaryKeyValue = result.insertId;
            } else if (primaryKeyCol?.name) {
                primaryKeyValue = data[primaryKeyCol.name];
            }

            return res.json({
                insertedId: primaryKeyValue,
                affectedRows: result.affectedRows || 0
            });
        } catch (e) {
            console.error('Insert error:', e);
            res.status(500).json({ error: e.message || "Failed to insert" });
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
            let table = req.body && req.body.table;
            let data = null;
            let pkColumn = req.body && req.body.pkColumn;
            let pkValue = req.body && req.body.pkValue;

            if (req.is('multipart/form-data')) {
                const files = req.files || [];
                data = {};
                for (const k of Object.keys(req.body || {})) {
                    if (['table', 'pkColumn', 'pkValue'].includes(k)) continue;
                    try {
                        data[k] = JSON.parse(req.body[k]);
                    } catch (e) {
                        data[k] = req.body[k];
                    }
                }
                for (const f of files) {
                    data[f.fieldname] = f.buffer;
                }
                if (!table) table = req.body.table;
                if (!pkColumn) pkColumn = req.body.pkColumn;
                if (!pkValue) pkValue = req.body.pkValue;
            } else {
                const body = req.body || {};
                table = body.table;
                data = body.data;
                pkColumn = body.pkColumn;
                pkValue = body.pkValue;
            }

            if (!table) {
                return res.status(400).json({ error: "table is required" });
            }

            const tables = await dbService.loadTables();
            if (!tables.includes(table)) {
                return res.status(400).json({ error: `Unknown table ${table}` });
            }

            if (!data || typeof data !== 'object') {
                return res.status(400).json({ error: "data object is required" });
            }

            if (!pkValue) {
                return res.status(400).json({ error: "pkValue is required" });
            }

            const colsMeta = await dbService.loadColumnsMeta(table);
            const allowedCols = colsMeta.map(c => c.name);

            // Determine pkColumn if not provided
            if (!pkColumn) {
                const pkMeta = colsMeta.find(c => c.isPrimary) ||
                    colsMeta.find(c => c.name.toLowerCase() === 'id') ||
                    colsMeta[0];
                pkColumn = pkMeta.name;
            }

            const setParts = [];
            const params = [];

            for (const c of colsMeta) {
                const k = c.name;

                // Do NOT update primary key
                if (c.isPrimary) continue;

                // Always update last_modified to CURRENT_TIMESTAMP
                if (k.toLowerCase() === "last_modified") {
                    setParts.push("`last_modified` = CURRENT_TIMESTAMP()");
                    continue;
                }

                if (!Object.prototype.hasOwnProperty.call(data, k)) continue;

                const rawVal = data[k];
                const val = sanitizeValueForColumn(rawVal, c);

                setParts.push(`\`${k}\` = ?`);
                params.push(val);
            }

            if (setParts.length === 0) {
                return res.status(400).json({ error: "No valid columns to update" });
            }

            params.push(pkValue);
            const sql = `UPDATE \`${table}\` SET ${setParts.join(', ')} WHERE \`${pkColumn}\` = ?`;
            const [result] = await dbService.pool.query(sql, params);

            return res.json({
                pkCol: pkColumn,
                pkVal: pkValue,
                affectedRows: result.affectedRows || 0
            });
        } catch (e) {
            console.error('Update error:', e);
            res.status(500).json({ error: e.message || "Failed to update" });
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
                const body = req.body || {};
                table = body.table;
                pkColumn = body.pkColumn;
                pkValue = body.pkValue;
                pkValues = body.pkValues;
            }

            if (!table) {
                return res.status(400).json({ error: "table is required" });
            }

            const tables = await dbService.loadTables();
            if (!tables.includes(table)) {
                return res.status(400).json({ error: `Unknown table ${table}` });
            }

            // Normalize pkValues
            if (pkValue && !pkValues) pkValues = [pkValue];
            if (!Array.isArray(pkValues) || pkValues.length === 0) {
                return res.status(400).json({ error: "pkValue or pkValues is required" });
            }

            // Determine pkColumn if not provided
            const colsMeta = await dbService.loadColumnsMeta(table);
            if (!pkColumn) {
                const pkMeta =
                    colsMeta.find(c => c.isPrimary) ||
                    colsMeta.find(c => c.name.toLowerCase() === "id") ||
                    colsMeta[0];
                pkColumn = pkMeta.name;
            }

            const placeholders = pkValues.map(() => "?").join(", ");
            const sql = `DELETE FROM \`${table}\` WHERE \`${pkColumn}\` IN (${placeholders})`;

            const [result] = await dbService.pool.query(sql, pkValues);

            return res.json({
                table,
                pkColumn,
                pkValues,
                affectedRows: result.affectedRows || 0,
            });
        } catch (e) {
            console.error('Delete error:', e);
            res.status(500).json({ error: e.message || "Failed to delete" });
        }
    }
);

module.exports = router;