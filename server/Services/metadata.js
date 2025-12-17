// server/Services/metadata.js
// Unified metadata service for tables and views with multi-table support

const { pool, DB_NAME } = require('./db.service');

/**
 * Get metadata for a table or view
 * Returns: { name, type: 'table'|'view', columns: [...], primaryKey, baseTables: [...], columnTableMap: {...} }
 */
async function getEntityMetadata(entityName) {
    // Check if it's a table or view
    const [tableCheck] = await pool.query(
        `SELECT TABLE_TYPE 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB_NAME, entityName]
    );

    if (!tableCheck || tableCheck.length === 0) {
        throw new Error(`Table or view '${entityName}' not found`);
    }

    const isView = tableCheck[0].TABLE_TYPE === 'VIEW';
    const type = isView ? 'view' : 'table';

    // Get column metadata
    const columns = await getColumnMetadata(entityName);

    // Get primary key
    const primaryKey = columns.find(c => c.isPrimary) ||
        columns.find(c => c.name.toLowerCase() === 'id') ||
        columns[0];

    // Get base tables (for views)
    let baseTables = [];
    let columnTableMap = {};

    if (isView) {
        baseTables = await getViewBaseTables(entityName);
        columnTableMap = await getViewColumnTableMap(entityName, baseTables);
    } else {
        baseTables = [entityName];
        // For regular tables, all columns map to itself
        columnTableMap = {};
        columns.forEach(col => {
            columnTableMap[col.name] = entityName;
        });
    }

    return {
        name: entityName,
        type,
        columns,
        primaryKey: primaryKey?.name || null,
        baseTables,
        columnTableMap, // Maps column name to source table
        isMultiTable: baseTables.length > 1,
    };
}

/**
 * Get column metadata for any table or view
 */
async function getColumnMetadata(entityName) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE, COLUMN_TYPE, 
                CHARACTER_MAXIMUM_LENGTH, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [DB_NAME, entityName]
    );

    // Get foreign key information
    const [fkRows] = await pool.query(
        `SELECT 
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            (SELECT IF(c.COLUMN_KEY = 'PRI', 1, 0)
             FROM INFORMATION_SCHEMA.COLUMNS c
             WHERE c.TABLE_SCHEMA = kcu.REFERENCED_TABLE_SCHEMA
               AND c.TABLE_NAME = kcu.REFERENCED_TABLE_NAME
               AND c.COLUMN_NAME = kcu.REFERENCED_COLUMN_NAME) AS IS_REFERENCED_PRIMARY
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         WHERE kcu.TABLE_SCHEMA = ?
           AND kcu.TABLE_NAME = ?
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
        [DB_NAME, entityName]
    );

    const fkMap = {};
    fkRows.forEach(fk => {
        fkMap[fk.COLUMN_NAME] = {
            referencedTable: fk.REFERENCED_TABLE_NAME,
            referencedColumn: fk.REFERENCED_COLUMN_NAME,
            isForeignKeyPrimary: fk.IS_REFERENCED_PRIMARY === 1
        };
    });

    return rows.map(r => {
        const columnName = r.COLUMN_NAME;
        const fkInfo = fkMap[columnName];

        return {
            name: columnName,
            type: (r.DATA_TYPE || '').toLowerCase(),
            columnType: r.COLUMN_TYPE || '',
            isPrimary: (r.COLUMN_KEY || '').toUpperCase() === 'PRI',
            isNullable: (r.IS_NULLABLE || '').toUpperCase() === 'YES',
            maxLength: r.CHARACTER_MAXIMUM_LENGTH || null,
            isAutoIncrement: ((r.EXTRA || '') + '').toLowerCase().includes('auto_increment'),
            isUnique: (r.COLUMN_KEY || '').toUpperCase() === 'UNI',
            isForeignKey: !!fkInfo,
            isForeignKeyPrimary: fkInfo ? fkInfo.isForeignKeyPrimary : false,
            referencedTable: fkInfo ? fkInfo.referencedTable : null,
            referencedColumn: fkInfo ? fkInfo.referencedColumn : null
        };
    });
}

/**
 * Get base tables for a view
 */
async function getViewBaseTables(viewName) {
    try {
        const [tableRefs] = await pool.query(
            `SELECT DISTINCT TABLE_NAME
             FROM INFORMATION_SCHEMA.VIEW_TABLE_USAGE
             WHERE VIEW_SCHEMA = DATABASE()
             AND VIEW_NAME = ?
             ORDER BY TABLE_NAME`,
            [viewName]
        );

        if (tableRefs && tableRefs.length > 0) {
            return tableRefs.map(t => t.TABLE_NAME);
        }
    } catch (err) {
        console.warn(`Failed to get base tables for view ${viewName}:`, err.message);
    }

    // Fallback: Parse view definition
    return await parseBaseTablesFromDefinition(viewName);
}

/**
 * Parse base tables from view definition (fallback)
 */
async function parseBaseTablesFromDefinition(viewName) {
    try {
        const [rows] = await pool.query(
            `SELECT VIEW_DEFINITION
             FROM INFORMATION_SCHEMA.VIEWS
             WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = ?`,
            [viewName]
        );

        if (!rows || rows.length === 0) return [];

        const def = (rows[0].VIEW_DEFINITION || '').replace(/\n/g, ' ').trim();
        const tableSet = new Set();

        // Match FROM clauses
        const fromMatches = def.matchAll(/FROM\s+(?:(?:`?[\w]+`?\.)?`?([\w]+)`?)/gi);
        for (const match of fromMatches) {
            if (match[1]) tableSet.add(match[1]);
        }

        // Match JOIN clauses
        const joinMatches = def.matchAll(/(?:LEFT|RIGHT|INNER|OUTER|CROSS)?\s*JOIN\s+(?:(?:`?[\w]+`?\.)?`?([\w]+)`?)/gi);
        for (const match of joinMatches) {
            if (match[1]) tableSet.add(match[1]);
        }

        return Array.from(tableSet).sort();
    } catch (err) {
        console.warn(`Failed to parse base tables from view definition:`, err.message);
        return [];
    }
}

/**
 * Get column-to-table mapping for a view
 * Returns object: { columnName: sourceTableName }
 */
async function getViewColumnTableMap(viewName, baseTables) {
    const columnMap = {};

    try {
        // Query view column usage to map columns to source tables
        const [rows] = await pool.query(
            `SELECT COLUMN_NAME, TABLE_NAME
             FROM INFORMATION_SCHEMA.VIEW_COLUMN_USAGE
             WHERE VIEW_SCHEMA = DATABASE()
             AND VIEW_NAME = ?`,
            [viewName]
        );

        if (rows && rows.length > 0) {
            rows.forEach(row => {
                columnMap[row.COLUMN_NAME] = row.TABLE_NAME;
            });
            return columnMap;
        }
    } catch (err) {
        console.warn(`Failed to query VIEW_COLUMN_USAGE for ${viewName}:`, err.message);
    }

    // Fallback: Match columns to base tables by querying each table's schema
    if (baseTables.length > 0) {
        const viewColumns = await getColumnMetadata(viewName);

        for (const baseTable of baseTables) {
            try {
                const baseColumns = await getColumnMetadata(baseTable);
                const baseColNames = baseColumns.map(c => c.name);

                viewColumns.forEach(viewCol => {
                    if (baseColNames.includes(viewCol.name) && !columnMap[viewCol.name]) {
                        columnMap[viewCol.name] = baseTable;
                    }
                });
            } catch (err) {
                console.warn(`Failed to get columns for base table ${baseTable}:`, err.message);
            }
        }
    }

    return columnMap;
}

/**
 * Get all tables and views
 */
async function getAllEntities() {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME, TABLE_TYPE
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [DB_NAME]
    );

    return rows.map(r => ({
        name: r.TABLE_NAME,
        type: r.TABLE_TYPE === 'VIEW' ? 'view' : 'table'
    }));
}

/**
 * Check if entity exists
 */
async function entityExists(entityName) {
    const [rows] = await pool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB_NAME, entityName]
    );
    return rows && rows.length > 0;
}

module.exports = {
    getEntityMetadata,
    getColumnMetadata,
    getViewBaseTables,
    getViewColumnTableMap,
    getAllEntities,
    entityExists,
};