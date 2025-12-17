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
 * REMOVED: Views no longer create Employees permission columns
 *
 * Permission logic is now:
 * - User needs permission to ALL base tables to access a view
 * - No individual view permissions are stored
 * - Tags and Ratings are public (accessible to everyone)
 */

/**
 * Create a new view
 *
 * Views no longer create permission columns in Employees table.
 * Access is determined by permissions to underlying base tables.
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

        await conn.commit();

        return {
            view: viewName,
            baseTable,
            columns,
            filters,
            message: 'View created successfully. Access granted to users with permissions to base table(s).'
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
 *
 * Views no longer manage permission columns in Employees table.
 * Access is determined by permissions to underlying base tables.
 */
async function updateView(oldViewName, newViewName, baseTable, columns, filters, allowedColumns) {
    const whereClause = buildWhereClause(filters, allowedColumns);
    const selectedCols = columns.map(c => `\`${c}\``).join(', ');

    const createNewViewSql = `CREATE OR REPLACE VIEW \`${newViewName}\` AS SELECT ${selectedCols} FROM \`${baseTable}\`${whereClause}`;

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

        await conn.commit();

        return {
            view: newViewName,
            replacedView: oldViewName !== newViewName ? oldViewName : null,
            baseTable,
            columns,
            filters,
            message: 'View updated successfully. Access granted to users with permissions to base table(s).'
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
 *
 * Views no longer manage permission columns in Employees table.
 */
async function deleteView(viewName) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Drop the view
        await conn.query(`DROP VIEW IF EXISTS \`${viewName}\``);

        await conn.commit();

        return {
            view: viewName,
            success: true,
            message: 'View deleted successfully.'
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