// server/routes/views.routes.js
// View creation, update, deletion, and listing endpoints

const express = require('express');
const router = express.Router();

const dbService = require('../Services/db.service');
const { parseFiltersFromViewDefinition } = require('../Utils/helpers');
const { sanitizeViewName } = require('../Utils/validators');
const { authenticateToken, requireEmployeesPermission } = require('../Middleware/auth');

// Multer for file uploads
const multer = (() => {
    try { return require('multer'); } catch (e) { return null; }
})();
const uploadMemory = multer ? multer({ storage: multer.memoryStorage() }) : null;

/**
 * POST /api/views/create
 * Create a new view with optional filters
 */
router.post(
    '/create',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            let baseTable, columns, viewName, filters;

            if (req.is('multipart/form-data')) {
                baseTable = req.body.baseTable;
                viewName = req.body.viewName;
                try { columns = JSON.parse(req.body.columns); } catch (e) { columns = req.body.columns; }
                try { filters = JSON.parse(req.body.filters || "[]"); } catch (e) { filters = []; }
            } else {
                const body = req.body || {};
                baseTable = body.baseTable;
                columns = body.columns;
                viewName = body.viewName;
                filters = Array.isArray(body.filters) ? body.filters : [];
            }

            if (!baseTable) {
                return res.status(400).json({ error: "baseTable is required" });
            }
            if (!Array.isArray(columns) || columns.length === 0) {
                return res.status(400).json({ error: "columns (array) is required" });
            }
            if (!viewName) {
                return res.status(400).json({ error: "viewName is required" });
            }

            const rawName = sanitizeViewName(viewName);
            if (!/^[A-Za-z0-9_]+$/.test(rawName)) {
                return res.status(400).json({
                    error: "viewName contains invalid characters; allowed: letters, numbers, underscore"
                });
            }
            const cleanViewName = rawName;

            // Validate base table exists
            const tables = await dbService.loadTables();
            if (!tables.includes(baseTable)) {
                return res.status(400).json({ error: `Unknown table ${baseTable}` });
            }

            // Validate columns exist on base table
            const colsMeta = await dbService.loadColumnsMeta(baseTable);
            const allowedCols = colsMeta.map(c => c.name);
            for (const c of columns) {
                if (!allowedCols.includes(c)) {
                    return res.status(400).json({ error: `Unknown column ${c} for table ${baseTable}` });
                }
            }

            // Ensure not colliding with real table name
            if (tables.includes(cleanViewName)) {
                return res.status(400).json({
                    error: `Name ${cleanViewName} conflicts with existing table`
                });
            }

            // Build WHERE clause from filters
            const whereParts = [];
            const validOps = new Set([
                "=", ">", "<", ">=", "<=", "!=", "<>", "LIKE",
                "IN", "IS NULL", "IS NOT NULL", "BETWEEN"
            ]);

            for (const f of filters) {
                if (!f || typeof f !== "object") continue;
                const col = f.column;
                let op = String(f.operator || "=").toUpperCase().trim();
                const val = f.value;

                if (!allowedCols.includes(col)) continue;
                if (!validOps.has(op)) continue;

                if (op === "IS NULL" || op === "IS NOT NULL") {
                    whereParts.push(`\`${col}\` ${op}`);
                } else if (op === "IN" && Array.isArray(val) && val.length > 0) {
                    whereParts.push(`\`${col}\` IN (${val.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')})`);
                } else if (op === "BETWEEN" && Array.isArray(val) && val.length >= 2) {
                    whereParts.push(`\`${col}\` BETWEEN '${String(val[0]).replace(/'/g, "''")}' AND '${String(val[1]).replace(/'/g, "''")}'`);
                } else if (val !== null && val !== undefined) {
                    const escapedVal = String(val).replace(/'/g, "''");
                    whereParts.push(`\`${col}\` ${op} '${escapedVal}'`);
                }
            }

            const whereSQL = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

            // Build CREATE VIEW SQL
            const selectedCols = columns.map(c => `\`${c}\``).join(', ');
            const createViewSql = `CREATE OR REPLACE VIEW \`${cleanViewName}\` AS SELECT ${selectedCols} FROM \`${baseTable}\`${whereSQL}`;

            const empColName = cleanViewName.toLowerCase();

            if (!/^[a-z0-9_]+$/.test(empColName)) {
                return res.status(400).json({ error: "Resulting Employees column name is invalid" });
            }

            // Execute in transaction
            const conn = await dbService.pool.getConnection();
            try {
                await conn.beginTransaction();

                // Create view
                await conn.query(createViewSql);

                // Check if Employees column exists
                const [exists] = await conn.query(
                    `SELECT COLUMN_NAME 
           FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME='Employees'
             AND COLUMN_NAME=?`,
                    [empColName]
                );

                if (exists.length === 0) {
                    await conn.query(
                        `ALTER TABLE \`Employees\` 
             ADD COLUMN \`${empColName}\` BIT NOT NULL DEFAULT b'0'`
                    );
                }

                // Auto-set permissions based on base table
                try {
                    await conn.query(
                        `UPDATE \`Employees\` e
             SET e.\`${empColName}\` = b'1'
             WHERE e.\`${baseTable}\` = b'1'`
                    );
                } catch (permErr) {
                    console.warn("Permissions auto-set skipped:", permErr.message || permErr);
                }

                await conn.commit();

                // Clear cache
                dbService.clearCache();
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }

            return res.json({ view: cleanViewName, employeesColumn: empColName });
        } catch (e) {
            console.error('View create error:', e);
            res.status(500).json({ error: e.message || "Failed to create view" });
        }
    }
);

/**
 * POST /api/views/update
 * Update an existing view (rename, change columns, change filters)
 */
router.post(
    '/update',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            let oldViewName, newViewName, baseTable, columns, filters;

            if (req.is('multipart/form-data')) {
                oldViewName = req.body.oldViewName;
                newViewName = req.body.newViewName;
                baseTable = req.body.baseTable;
                try { columns = JSON.parse(req.body.columns); } catch (e) { columns = req.body.columns; }
                try { filters = JSON.parse(req.body.filters || "[]"); } catch (e) { filters = []; }
            } else {
                const body = req.body || {};
                oldViewName = body.oldViewName;
                newViewName = body.newViewName;
                baseTable = body.baseTable;
                columns = body.columns;
                filters = Array.isArray(body.filters) ? body.filters : [];
            }

            if (!oldViewName) {
                return res.status(400).json({ error: "oldViewName is required" });
            }
            if (!newViewName) {
                return res.status(400).json({ error: "newViewName is required" });
            }
            if (!baseTable) {
                return res.status(400).json({ error: "baseTable is required" });
            }
            if (!Array.isArray(columns) || columns.length === 0) {
                return res.status(400).json({ error: "columns (array) is required" });
            }

            const rawNew = sanitizeViewName(newViewName);
            const rawOld = sanitizeViewName(oldViewName);

            if (!/^[A-Za-z0-9_]+$/.test(rawNew) || !/^[A-Za-z0-9_]+$/.test(rawOld)) {
                return res.status(400).json({
                    error: "view names must contain only letters, numbers, underscore"
                });
            }

            const cleanNew = rawNew;
            const cleanOld = rawOld;
            const newEmpCol = cleanNew.toLowerCase();
            const oldEmpCol = cleanOld.toLowerCase();

            const tables = await dbService.loadTables();

            // Ensure new view doesn't collide with a real table
            if (tables.includes(cleanNew) && cleanNew !== cleanOld) {
                return res.status(400).json({
                    error: `Name ${cleanNew} conflicts with existing table`
                });
            }

            // Validate columns
            const colsMeta = await dbService.loadColumnsMeta(baseTable);
            const allowedCols = colsMeta.map(c => c.name);
            for (const c of columns) {
                if (!allowedCols.includes(c)) {
                    return res.status(400).json({
                        error: `Unknown column ${c} for table ${baseTable}`
                    });
                }
            }

            // Build WHERE clause from filters
            const whereParts = [];
            const validOps = new Set([
                "=", ">", "<", ">=", "<=", "!=", "<>", "LIKE",
                "IN", "IS NULL", "IS NOT NULL", "BETWEEN"
            ]);

            for (const f of filters) {
                if (!f || typeof f !== "object") continue;
                const col = f.column;
                let op = String(f.operator || "=").toUpperCase().trim();
                const val = f.value;

                if (!allowedCols.includes(col)) continue;
                if (!validOps.has(op)) continue;

                if (op === "IS NULL" || op === "IS NOT NULL") {
                    whereParts.push(`\`${col}\` ${op}`);
                } else if (op === "IN" && Array.isArray(val) && val.length > 0) {
                    whereParts.push(`\`${col}\` IN (${val.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')})`);
                } else if (op === "BETWEEN" && Array.isArray(val) && val.length >= 2) {
                    whereParts.push(`\`${col}\` BETWEEN '${String(val[0]).replace(/'/g, "''")}' AND '${String(val[1]).replace(/'/g, "''")}'`);
                } else if (val !== null && val !== undefined) {
                    const escapedVal = String(val).replace(/'/g, "''");
                    whereParts.push(`\`${col}\` ${op} '${escapedVal}'`);
                }
            }

            const whereSQL = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

            const selectedCols = columns.map(c => `\`${c}\``).join(', ');
            const createNewViewSql = `CREATE OR REPLACE VIEW \`${cleanNew}\` AS SELECT ${selectedCols} FROM \`${baseTable}\`${whereSQL}`;

            const conn = await dbService.pool.getConnection();
            try {
                await conn.beginTransaction();

                // Create/replace the new view definition
                await conn.query(createNewViewSql);

                // If rename happened, drop the old view
                if (cleanOld !== cleanNew) {
                    try {
                        await conn.query(`DROP VIEW IF EXISTS \`${cleanOld}\``);
                    } catch (dropErr) {
                        console.warn("Failed to drop old view (non-fatal):", dropErr.message || dropErr);
                    }
                }

                // Check if Employees column exists
                const [exists] = await conn.query(
                    `SELECT COLUMN_NAME 
           FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME='Employees'
             AND COLUMN_NAME=?`,
                    [newEmpCol]
                );

                if (exists.length === 0) {
                    await conn.query(
                        `ALTER TABLE \`Employees\` 
             ADD COLUMN \`${newEmpCol}\` BIT NOT NULL DEFAULT b'0'`
                    );
                }

                // If rename occurred, rename the Employees column
                if (cleanOld !== cleanNew) {
                    try {
                        await conn.query(
                            `ALTER TABLE \`Employees\` 
               RENAME COLUMN \`${oldEmpCol}\` TO \`${newEmpCol}\``
                        );
                    } catch (migrateErr) {
                        console.warn("Employees column migrate failed (non-fatal):", migrateErr.message || migrateErr);
                    }
                }

                // Auto-set permissions
                try {
                    await conn.query(
                        `UPDATE \`Employees\` e
             SET e.\`${newEmpCol}\` = b'1'
             WHERE e.\`${baseTable}\` = b'1'`
                    );
                } catch (permErr) {
                    console.warn("Permissions auto-set skipped:", permErr.message || permErr);
                }

                await conn.commit();

                // Clear cache
                dbService.clearCache();
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }

            return res.json({
                view: cleanNew,
                employeesColumn: newEmpCol,
                replacedView: cleanOld !== cleanNew ? cleanOld : null
            });
        } catch (e) {
            console.error('View update error:', e);
            res.status(500).json({ error: e.message || "Failed to update view" });
        }
    }
);

/**
 * POST /api/views/delete
 * Delete a view and its corresponding Employees column
 */
router.post(
    '/delete',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            let viewName;

            if (req.is('multipart/form-data')) {
                viewName = req.body.viewName;
            } else {
                const body = req.body || {};
                viewName = body.viewName;
            }

            if (!viewName) {
                return res.status(400).json({ error: "viewName is required" });
            }

            const raw = sanitizeViewName(viewName);
            if (!/^[A-Za-z0-9_]+$/.test(raw)) {
                return res.status(400).json({ error: "viewName contains invalid characters" });
            }

            const clean = raw;
            const empCol = clean.toLowerCase();

            // Ensure this is truly a view (not a table)
            const [viewCheck] = await dbService.pool.query(
                `SELECT TABLE_NAME 
         FROM INFORMATION_SCHEMA.VIEWS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ?`,
                [clean]
            );

            if (!viewCheck || viewCheck.length === 0) {
                return res.status(400).json({ error: `${clean} is not recognized as a view` });
            }

            const conn = await dbService.pool.getConnection();
            try {
                await conn.beginTransaction();

                // Drop the view
                await conn.query(`DROP VIEW IF EXISTS \`${clean}\``);

                // Drop the Employees column if it exists
                const [colCheck] = await conn.query(
                    `SELECT COLUMN_NAME 
           FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() 
           AND TABLE_NAME = 'Employees' 
           AND COLUMN_NAME = ?`,
                    [empCol]
                );

                if (colCheck && colCheck.length > 0) {
                    await conn.query(`ALTER TABLE \`Employees\` DROP COLUMN \`${empCol}\``);
                }

                await conn.commit();

                // Clear cache
                dbService.clearCache();

                return res.json({
                    view: clean,
                    employeesColumnDropped: colCheck && colCheck.length > 0,
                    success: true
                });
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }
        } catch (e) {
            console.error('View delete error:', e);
            res.status(500).json({ error: e.message || "Failed to delete view" });
        }
    }
);

/**
 * GET /api/views/list
 * List all views with their base tables, columns, and filters
 */
router.get('/list', authenticateToken, async (req, res) => {
    try {
        const [rows] = await dbService.pool.query(
            `SELECT TABLE_NAME AS view_name, VIEW_DEFINITION
       FROM INFORMATION_SCHEMA.VIEWS
       WHERE TABLE_SCHEMA = DATABASE()`
        );

        const out = [];

        for (const r of rows) {
            const viewName = r.view_name || r.VIEW_NAME;
            const def = (r.VIEW_DEFINITION || "").replace(/\n/g, ' ').trim();

            let base_tables = [];
            let columns = [];

            // Query all tables referenced by this view
            try {
                const [tableRefs] = await dbService.pool.query(
                    `SELECT DISTINCT TABLE_NAME
           FROM INFORMATION_SCHEMA.VIEW_TABLE_USAGE
           WHERE VIEW_SCHEMA = DATABASE()
           AND VIEW_NAME = ?
           ORDER BY TABLE_NAME`,
                    [viewName]
                );

                if (tableRefs && tableRefs.length > 0) {
                    base_tables = tableRefs.map(t => t.TABLE_NAME);
                }
            } catch (metaErr) {
                console.warn(`Failed to query VIEW_TABLE_USAGE for ${viewName}:`, metaErr);
            }

            // Fallback: Parse FROM/JOIN clauses
            if (base_tables.length === 0) {
                try {
                    const tableSet = new Set();

                    const fromMatches = def.matchAll(/FROM\s+(?:(?:`?[\w]+`?\.)?`?([\w]+)`?)/gi);
                    for (const match of fromMatches) {
                        if (match[1]) tableSet.add(match[1]);
                    }

                    const joinMatches = def.matchAll(/(?:LEFT|RIGHT|INNER|OUTER|CROSS)?\s*JOIN\s+(?:(?:`?[\w]+`?\.)?`?([\w]+)`?)/gi);
                    for (const match of joinMatches) {
                        if (match[1]) tableSet.add(match[1]);
                    }

                    base_tables = Array.from(tableSet).sort();
                } catch (parseErr) {
                    console.warn(`Failed to parse view ${viewName}:`, parseErr);
                }
            }

            // Extract columns from SELECT clause
            try {
                const selectMatch = def.match(/SELECT\s+(.*?)\s+FROM/i);
                if (selectMatch) {
                    const colsPart = selectMatch[1];
                    columns = colsPart
                        .split(',')
                        .map(s => {
                            let col = s.trim().split(/\s+AS\s+/i)[0];
                            col = col.replace(/^.*\./, '').replace(/[`"']/g, '').trim();
                            return col;
                        })
                        .filter(s => s.length > 0 && s !== '*');
                }
            } catch (parseErr) {
                console.warn(`Failed to parse columns for view ${viewName}:`, parseErr);
            }

            // Fallback: Query columns from view itself
            if (columns.length === 0) {
                try {
                    const [viewCols] = await dbService.pool.query(
                        `SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
                        [viewName]
                    );

                    columns = viewCols.map(c => c.COLUMN_NAME);
                } catch (colErr) {
                    console.warn(`Failed to query columns for view ${viewName}:`, colErr);
                }
            }

            // Extract filters from WHERE clause
            const filters = parseFiltersFromViewDefinition(def);

            out.push({
                name: viewName,
                base_table: base_tables.length === 1 ? base_tables[0] : "",
                base_tables: base_tables,
                columns: columns,
                filters: filters
            });
        }

        return res.json({ rows: out });
    } catch (e) {
        console.error('Views list error:', e);
        res.status(500).json({ error: e.message || "Failed to list views" });
    }
});

/**
 * GET /api/views/base-table-map
 * Returns mapping of view names to their base tables
 */
router.get('/base-table-map', authenticateToken, async (req, res) => {
    try {
        const [rows] = await dbService.pool.query(
            `SELECT TABLE_NAME AS view_name
       FROM INFORMATION_SCHEMA.VIEWS
       WHERE TABLE_SCHEMA = DATABASE()`
        );

        const mapping = {};

        for (const r of rows) {
            const viewName = r.view_name || r.VIEW_NAME;

            let base_tables = [];

            try {
                const [tableRefs] = await dbService.pool.query(
                    `SELECT DISTINCT TABLE_NAME
           FROM INFORMATION_SCHEMA.VIEW_TABLE_USAGE
           WHERE VIEW_SCHEMA = DATABASE()
           AND VIEW_NAME = ?
           ORDER BY TABLE_NAME`,
                    [viewName]
                );

                if (tableRefs && tableRefs.length > 0) {
                    base_tables = tableRefs.map(t => t.TABLE_NAME.toLowerCase());
                }
            } catch (metaErr) {
                console.warn(`Failed to query VIEW_TABLE_USAGE for ${viewName}:`, metaErr);
            }

            if (base_tables.length > 0) {
                mapping[viewName.toLowerCase()] = base_tables;
            }
        }

        return res.json(mapping);
    } catch (e) {
        console.error('Views base-table-map error:', e);
        res.status(500).json({ error: e.message || "Failed to get view-to-table mapping" });
    }
});

module.exports = router;