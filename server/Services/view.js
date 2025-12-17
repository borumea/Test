// server/Services/view.js
// View management operations using generalized services

const { pool, DB_NAME } = require('./db');
const { getEntityMetadata, getAllEntities } = require('./metadata');
const { parseFiltersFromViewDefinition } = require('../Utils/helpers');
const { isValidOperator } = require('../Utils/validators');

/**
 * Build WHERE clause from filters
 */
function buildWhereClause(filters, allowedColumns) {
    const whereParts = [];
    const validOps = new Set([
        '=', '>', '<', '>=', '<=', '!=', '<>', 'LIKE',
        'IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN'
    ]);

    for (const filter of filters) {
        if (!filter || typeof filter !== 'object') continue;

        const { column, operator, value } = filter;

        if (!allowedColumns.includes(column)) continue;

        const op = String(operator || '=').toUpperCase().trim();
        if (!validOps.has(op)) continue;

        if (op === 'IS NULL' || op === 'IS NOT NULL') {
            whereParts.push(`\`${column}\` ${op}`);
        } else if (op === 'IN' && Array.isArray(value) && value.length > 0) {
            const escapedVals = value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
            whereParts.push(`\`${column}\` IN (${escapedVals})`);
        } else if (op === 'BETWEEN' && Array.isArray(value) && value.length >= 2) {
            const val1 = String(value[0]).replace(/'/g, "''");
            const val2 = String(value[1]).replace(/'/g, "''");
            whereParts.push(`\`${column}\` BETWEEN '${val1}' AND '${val2}'`);
        } else if (value !== null && value !== undefined) {
            const escapedVal = String(value).replace(/'/g, "''");
            whereParts.push(`\`${column}\` ${op} '${escapedVal}'`);
        }
    }

    return whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';
}

/**
 * Ensure Employees table has a column for this view
 */
async function ensureEmployeesColumn(viewName, baseTable) {
    const empColName = viewName.toLowerCase();

    if (!/^[a-z0-9_]+$/.test(empColName)) {
        throw new Error('Resulting Employees column name is invalid');
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if column exists
        const [exists] = await conn.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'Employees'
               AND COLUMN_NAME = ?`,
            [empColName]
        );

        // Create column if doesn't exist
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
            console.warn('Permissions auto-set skipped:', permErr.message);
        }

        await conn.commit();
        return empColName;

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Create a new view
 */
async function createView(viewName, baseTable, columns, filters, allowedColumns) {
    const whereClause = buildWhereClause(filters, allowedColumns);
    const selectedCols = columns.map(c => `\`${c}\``).join(', ');

    const createViewSql = `CREATE OR REPLACE VIEW \`${viewName}\` AS SELECT ${selectedCols} FROM \`${baseTable}\`${whereClause}`;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Create the view
        await conn.query(createViewSql);

        // Ensure Employees column exists and set permissions
        const empColName = await ensureEmployeesColumn(viewName, baseTable);

        await conn.commit();

        return {
            view: viewName,
            employeesColumn: empColName,
            baseTable,
            columns,
            filters
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Update an existing view
 */
async function updateView(oldViewName, newViewName, baseTable, columns, filters, allowedColumns) {
    const whereClause = buildWhereClause(filters, allowedColumns);
    const selectedCols = columns.map(c => `\`${c}\``).join(', ');

    const createNewViewSql = `CREATE OR REPLACE VIEW \`${newViewName}\` AS SELECT ${selectedCols} FROM \`${baseTable}\`${whereClause}`;

    const newEmpCol = newViewName.toLowerCase();
    const oldEmpCol = oldViewName.toLowerCase();

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Create/replace the new view definition
        await conn.query(createNewViewSql);

        // If rename happened, drop the old view
        if (oldViewName !== newViewName) {
            try {
                await conn.query(`DROP VIEW IF EXISTS \`${oldViewName}\``);
            } catch (dropErr) {
                console.warn('Failed to drop old view (non-fatal):', dropErr.message);
            }
        }

        // Ensure Employees column exists
        const [exists] = await conn.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'Employees'
               AND COLUMN_NAME = ?`,
            [newEmpCol]
        );

        if (exists.length === 0) {
            await conn.query(
                `ALTER TABLE \`Employees\` 
                 ADD COLUMN \`${newEmpCol}\` BIT NOT NULL DEFAULT b'0'`
            );
        }

        // If rename occurred, rename the Employees column
        if (oldViewName !== newViewName) {
            try {
                await conn.query(
                    `ALTER TABLE \`Employees\` 
                     RENAME COLUMN \`${oldEmpCol}\` TO \`${newEmpCol}\``
                );
            } catch (renameErr) {
                console.warn('Employees column rename failed (non-fatal):', renameErr.message);
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
            console.warn('Permissions auto-set skipped:', permErr.message);
        }

        await conn.commit();

        return {
            view: newViewName,
            employeesColumn: newEmpCol,
            replacedView: oldViewName !== newViewName ? oldViewName : null,
            baseTable,
            columns,
            filters
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Delete a view
 */
async function deleteView(viewName) {
    const empCol = viewName.toLowerCase();

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Drop the view
        await conn.query(`DROP VIEW IF EXISTS \`${viewName}\``);

        // Drop the Employees column if it exists
        const [colCheck] = await conn.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
               AND TABLE_NAME = 'Employees' 
               AND COLUMN_NAME = ?`,
            [empCol]
        );

        let columnDropped = false;
        if (colCheck && colCheck.length > 0) {
            await conn.query(`ALTER TABLE \`Employees\` DROP COLUMN \`${empCol}\``);
            columnDropped = true;
        }

        await conn.commit();

        return {
            view: viewName,
            employeesColumnDropped: columnDropped,
            success: true
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * List all views with metadata
 */
async function listAllViews() {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME AS view_name, VIEW_DEFINITION
         FROM INFORMATION_SCHEMA.VIEWS
         WHERE TABLE_SCHEMA = DATABASE()`
    );

    const views = [];

    for (const row of rows) {
        const viewName = row.view_name || row.VIEW_NAME;
        const definition = (row.VIEW_DEFINITION || '').replace(/\n/g, ' ').trim();

        try {
            const metadata = await getEntityMetadata(viewName);
            const filters = parseFiltersFromViewDefinition(definition);

            views.push({
                name: viewName,
                base_table: metadata.baseTables.length === 1 ? metadata.baseTables[0] : '',
                base_tables: metadata.baseTables,
                columns: metadata.columns.map(c => c.name),
                filters
            });

        } catch (err) {
            console.warn(`Failed to get metadata for view ${viewName}:`, err.message);

            // Fallback: Return basic info
            views.push({
                name: viewName,
                base_table: '',
                base_tables: [],
                columns: [],
                filters: []
            });
        }
    }

    return views;
}

/**
 * Get mapping of view names to base tables
 */
async function getViewBaseTableMap() {
    const entities = await getAllEntities();
    const viewNames = entities.filter(e => e.type === 'view').map(e => e.name);

    const mapping = {};

    for (const viewName of viewNames) {
        try {
            const metadata = await getEntityMetadata(viewName);
            mapping[viewName.toLowerCase()] = metadata.baseTables.map(t => t.toLowerCase());
        } catch (err) {
            console.warn(`Failed to get base tables for view ${viewName}:`, err.message);
            mapping[viewName.toLowerCase()] = [];
        }
    }

    return mapping;
}

module.exports = {
    createView,
    updateView,
    deleteView,
    listAllViews,
    getViewBaseTableMap,
};