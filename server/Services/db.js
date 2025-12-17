// server/Services/db.js
// Database connection pool and metadata caching service

const mysql = require('mysql2/promise');
const dbConfig = require('../Config/db.config');

// --- Database configuration ---
const DB_HOST = dbConfig.host || process.env.DB_HOST;
const DB_USER = dbConfig.user || process.env.DB_USER;
const DB_PASS = dbConfig.password || process.env.DB_PASS;
const DB_NAME = dbConfig.database || process.env.DB_NAME;

// Create connection pool
const pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// --- Caching schema metadata (legacy support) ---
const cache = {
    tables: null,
    columns: {},
    columnsMeta: {}
};

/**
 * Load all tables AND views from database (LEGACY - use metadata.service instead)
 */
async function loadTables() {
    if (cache.tables !== null) return cache.tables;

    const [tableRows] = await pool.query(
        `SELECT TABLE_NAME 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = ?`,
        [DB_NAME]
    );

    const tables = tableRows.map(r => r.TABLE_NAME);
    cache.tables = [...new Set(tables)];
    
    return cache.tables;
}

/**
 * Load only base tables (LEGACY - use metadata.service instead)
 */
async function loadBaseTables() {
    const [tableRows] = await pool.query(
        `SELECT TABLE_NAME 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = ? 
           AND TABLE_TYPE = 'BASE TABLE'`,
        [DB_NAME]
    );

    return tableRows.map(r => r.TABLE_NAME);
}

/**
 * Load column metadata for a table (LEGACY - use metadata.service instead)
 */
async function loadColumnsMeta(table) {
    if (cache.columnsMeta && cache.columnsMeta[table]) {
        return cache.columnsMeta[table];
    }

    const [rows] = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE, COLUMN_TYPE, 
                CHARACTER_MAXIMUM_LENGTH, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [DB_NAME, table]
    );

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
        [DB_NAME, table]
    );

    const fkMap = {};
    fkRows.forEach(fk => {
        fkMap[fk.COLUMN_NAME] = {
            referencedTable: fk.REFERENCED_TABLE_NAME,
            referencedColumn: fk.REFERENCED_COLUMN_NAME,
            isForeignKeyPrimary: fk.IS_REFERENCED_PRIMARY === 1
        };
    });

    const cols = rows.map(r => {
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

    if (!cache.columnsMeta) cache.columnsMeta = {};
    cache.columnsMeta[table] = cols;
    
    return cols;
}

/**
 * Load column names for a table (LEGACY - use metadata.service instead)
 */
async function loadColumns(table) {
    const meta = await loadColumnsMeta(table);
    return meta.map(c => c.name);
}

/**
 * Clear all caches (useful after schema changes)
 */
function clearCache() {
    cache.tables = null;
    cache.columns = {};
    cache.columnsMeta = {};
}

module.exports = {
    pool,
    DB_NAME,
    DB_HOST,
    DB_USER,
    cache,
    loadTables,
    loadBaseTables,
    loadColumns,
    loadColumnsMeta,
    clearCache,
};