// server/services/db.service.js
// Database connection pool and metadata caching service

const mysql = require('mysql2/promise');
const dbConfig = require('../Config/db.config');

// --- Database configuration ---
const DB_HOST = dbConfig["host"] || process.env.DB_HOST;
const DB_USER = dbConfig["user"] || process.env.DB_USER;
const DB_PASS = dbConfig["password"] || process.env.DB_PASS;
const DB_NAME = dbConfig["database"] || process.env.DB_NAME;

// Create connection pool
const pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// --- Caching schema metadata ---
const cache = {
    tables: null,
    columns: {},
    columnsMeta: {}
};

/**
 * Load all tables AND views from database
 */
async function loadTables() {
    if (cache.tables !== null) return cache.tables;

    const [tableRows] = await pool.query(
        `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = ?`,
        [DB_NAME]
    );

    const [viewRows] = await pool.query(
        `SELECT table_name 
     FROM information_schema.views 
     WHERE table_schema = ?`,
        [DB_NAME]
    );

    const tables = [
        ...tableRows.map((r) => r.TABLE_NAME || r.table_name || Object.values(r)[0]),
        ...viewRows.map((r) => r.TABLE_NAME || r.table_name || Object.values(r)[0])
    ];

    const uniqueSet = new Set(tables);
    cache.tables = [...uniqueSet];
    return cache.tables;
}

/**
 * Load only base tables (exclude views)
 */
async function loadBaseTables() {
    const [tableRows] = await pool.query(
        `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = ? 
     AND table_type = 'BASE TABLE'`,
        [DB_NAME]
    );

    return tableRows.map((r) => r.TABLE_NAME || r.table_name || Object.values(r)[0]);
}

/**
 * Load column metadata for a table
 * Returns array of column objects with: name, type, isPrimary, isNullable, etc.
 */
async function loadColumnsMeta(table) {
    if (cache.columnsMeta && cache.columnsMeta[table]) {
        return cache.columnsMeta[table];
    }

    const [rows] = await pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE, COLUMN_TYPE, 
            CHARACTER_MAXIMUM_LENGTH, EXTRA
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ?
     ORDER BY ORDINAL_POSITION`,
        [DB_NAME, table]
    );

    const [fkRows] = await pool.query(
        `SELECT 
      kcu.COLUMN_NAME,
      kcu.REFERENCED_TABLE_NAME,
      kcu.REFERENCED_COLUMN_NAME,
      (SELECT IF(c.COLUMN_KEY = 'PRI', 1, 0)
       FROM information_schema.columns c
       WHERE c.table_schema = kcu.REFERENCED_TABLE_SCHEMA
         AND c.table_name = kcu.REFERENCED_TABLE_NAME
         AND c.column_name = kcu.REFERENCED_COLUMN_NAME) AS IS_REFERENCED_PRIMARY
     FROM information_schema.KEY_COLUMN_USAGE kcu
     WHERE kcu.table_schema = ?
       AND kcu.table_name = ?
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

    const cols = rows.map((r) => {
        const columnName = r.COLUMN_NAME || Object.values(r)[0];
        const fkInfo = fkMap[columnName];

        return {
            name: columnName,
            type: (r.DATA_TYPE || "").toLowerCase(),
            columnType: r.COLUMN_TYPE || "",
            isPrimary: (r.COLUMN_KEY || "").toUpperCase() === "PRI",
            isNullable: (r.IS_NULLABLE || "").toUpperCase() === "YES",
            maxLength: r.CHARACTER_MAXIMUM_LENGTH || null,
            isAutoIncrement: ((r.EXTRA || "") + "").toLowerCase().includes("auto_increment"),
            isUnique: (r.COLUMN_KEY || "").toUpperCase() === "UNI",
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
 * Load column names for a table (backwards compatible)
 */
async function loadColumns(table) {
    const meta = await loadColumnsMeta(table);
    return meta.map((c) => c.name);
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