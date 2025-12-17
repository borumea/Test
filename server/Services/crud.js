// server/Services/crud.js
// Generalized CRUD operations with multi-table view support

const { pool } = require('./db');
const { getEntityMetadata } = require('./metadata');
const { sanitizeValueForColumn } = require('../Utils/helpers');

/**
 * Group data by base tables for multi-table inserts/updates
 */
function groupDataByTable(data, files, metadata) {
    const tableDataMap = {};

    // Initialize map for each base table
    metadata.baseTables.forEach(table => {
        tableDataMap[table] = {};
    });

    // Route each column to its source table
    for (const [colName, sourceTable] of Object.entries(metadata.columnTableMap)) {
        const rawVal = files[colName] !== undefined ? files[colName] : data[colName];

        if (rawVal !== undefined) {
            tableDataMap[sourceTable][colName] = rawVal;
        }
    }

    return tableDataMap;
}

/**
 * Get column metadata for a specific base table
 */
async function getBaseTableColumnMeta(tableName, columnName) {
    const tableMetadata = await getEntityMetadata(tableName);
    return tableMetadata.columns.find(c => c.name === columnName);
}

/**
 * Find foreign key relationships between tables
 */
async function findTableRelationships(tables) {
    const relationships = [];

    for (let i = 0; i < tables.length; i++) {
        for (let j = i + 1; j < tables.length; j++) {
            const table1 = tables[i];
            const table2 = tables[j];

            // Check if table1 has FK to table2
            const meta1 = await getEntityMetadata(table1);
            const fkTo2 = meta1.columns.find(c =>
                c.isForeignKey && c.referencedTable === table2
            );

            if (fkTo2) {
                relationships.push({
                    fromTable: table1,
                    toTable: table2,
                    foreignKey: fkTo2.name,
                    referencedKey: fkTo2.referencedColumn
                });
                continue;
            }

            // Check if table2 has FK to table1
            const meta2 = await getEntityMetadata(table2);
            const fkTo1 = meta2.columns.find(c =>
                c.isForeignKey && c.referencedTable === table1
            );

            if (fkTo1) {
                relationships.push({
                    fromTable: table2,
                    toTable: table1,
                    foreignKey: fkTo1.name,
                    referencedKey: fkTo1.referencedColumn
                });
            }
        }
    }

    return relationships;
}

/**
 * Determine insert order based on foreign key dependencies
 */
function determineInsertOrder(tables, relationships) {
    const graph = {};
    const inDegree = {};

    // Initialize graph
    tables.forEach(table => {
        graph[table] = [];
        inDegree[table] = 0;
    });

    // Build dependency graph
    relationships.forEach(rel => {
        graph[rel.toTable].push(rel.fromTable); // toTable must be inserted before fromTable
        inDegree[rel.fromTable]++;
    });

    // Topological sort
    const queue = tables.filter(table => inDegree[table] === 0);
    const order = [];

    while (queue.length > 0) {
        const current = queue.shift();
        order.push(current);

        graph[current].forEach(dependent => {
            inDegree[dependent]--;
            if (inDegree[dependent] === 0) {
                queue.push(dependent);
            }
        });
    }

    // If cycle detected or incomplete, return original order
    if (order.length !== tables.length) {
        console.warn('Circular dependency detected, using provided table order');
        return tables;
    }

    return order;
}

/**
 * Generic INSERT operation (supports multi-table views)
 */
async function insertRecord(entityName, data, files = {}) {
    const metadata = await getEntityMetadata(entityName);

    // Simple case: single table (or direct table insert)
    if (!metadata.isMultiTable) {
        return await insertIntoSingleTable(entityName, data, files, metadata);
    }

    // Complex case: multi-table view
    return await insertIntoMultiTableView(entityName, data, files, metadata);
}

/**
 * Insert into a single table
 */
async function insertIntoSingleTable(tableName, data, files, metadata) {
    const insertCols = [];
    const placeholders = [];
    const params = [];

    for (const col of metadata.columns) {
        const colName = col.name;

        // Skip auto-increment columns
        if (col.isAutoIncrement) continue;

        // Skip last_modified (will be set to CURRENT_TIMESTAMP)
        if (colName.toLowerCase() === 'last_modified') continue;

        // Check if data or file provided for this column
        const rawVal = files[colName] !== undefined ? files[colName] : data[colName];
        if (rawVal === undefined) continue;

        const val = sanitizeValueForColumn(rawVal, col);

        insertCols.push(`\`${colName}\``);
        placeholders.push('?');
        params.push(val);
    }

    // Auto-append last_modified if present in schema
    const hasLastModified = metadata.columns.some(c => c.name.toLowerCase() === 'last_modified');
    if (hasLastModified) {
        insertCols.push('`last_modified`');
        placeholders.push('CURRENT_TIMESTAMP()');
    }

    if (insertCols.length === 0) {
        throw new Error('No valid columns provided for insert');
    }

    const sql = `INSERT INTO \`${tableName}\` (${insertCols.join(',')}) VALUES (${placeholders.join(',')})`;
    const [result] = await pool.query(sql, params);

    // Return inserted ID
    const pkCol = metadata.columns.find(c => c.isPrimary);
    let insertedId = null;

    if (pkCol?.isAutoIncrement) {
        insertedId = result.insertId;
    } else if (pkCol) {
        insertedId = data[pkCol.name];
    }

    return {
        insertedId,
        affectedRows: result.affectedRows || 0,
        entity: tableName
    };
}

/**
 * Insert into a multi-table view
 */
async function insertIntoMultiTableView(viewName, data, files, metadata) {
    const tableDataMap = groupDataByTable(data, files, metadata);

    // Find relationships between tables
    const relationships = await findTableRelationships(metadata.baseTables);

    // Determine insert order
    const insertOrder = determineInsertOrder(metadata.baseTables, relationships);

    const conn = await pool.getConnection();
    const insertedIds = {};

    try {
        await conn.beginTransaction();

        // Insert into each table in dependency order
        for (const tableName of insertOrder) {
            const tableData = tableDataMap[tableName];

            // Skip if no data for this table
            if (Object.keys(tableData).length === 0) continue;

            // Resolve foreign key values from previous inserts
            for (const rel of relationships) {
                if (rel.fromTable === tableName && insertedIds[rel.toTable]) {
                    // Auto-populate FK from related table's insert
                    if (tableData[rel.foreignKey] === undefined) {
                        tableData[rel.foreignKey] = insertedIds[rel.toTable][rel.referencedKey];
                    }
                }
            }

            // Get table metadata
            const tableMetadata = await getEntityMetadata(tableName);

            const insertCols = [];
            const placeholders = [];
            const params = [];

            for (const col of tableMetadata.columns) {
                const colName = col.name;

                // Skip auto-increment
                if (col.isAutoIncrement) continue;

                // Skip last_modified
                if (colName.toLowerCase() === 'last_modified') continue;

                if (tableData[colName] === undefined) continue;

                const val = sanitizeValueForColumn(tableData[colName], col);

                insertCols.push(`\`${colName}\``);
                placeholders.push('?');
                params.push(val);
            }

            // Add last_modified
            const hasLastModified = tableMetadata.columns.some(c => c.name.toLowerCase() === 'last_modified');
            if (hasLastModified) {
                insertCols.push('`last_modified`');
                placeholders.push('CURRENT_TIMESTAMP()');
            }

            if (insertCols.length === 0) continue;

            const sql = `INSERT INTO \`${tableName}\` (${insertCols.join(',')}) VALUES (${placeholders.join(',')})`;
            const [result] = await conn.query(sql, params);

            // Store inserted IDs for FK resolution
            insertedIds[tableName] = {};

            const pkCol = tableMetadata.columns.find(c => c.isPrimary);
            if (pkCol) {
                if (pkCol.isAutoIncrement) {
                    insertedIds[tableName][pkCol.name] = result.insertId;
                } else {
                    insertedIds[tableName][pkCol.name] = tableData[pkCol.name];
                }
            }
        }

        await conn.commit();

        return {
            success: true,
            insertedIds,
            affectedTables: insertOrder.filter(t => Object.keys(tableDataMap[t]).length > 0),
            entity: viewName
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Generic UPDATE operation (supports multi-table views)
 */
async function updateRecord(entityName, pkColumn, pkValue, data, files = {}) {
    const metadata = await getEntityMetadata(entityName);

    // Simple case: single table
    if (!metadata.isMultiTable) {
        return await updateSingleTable(entityName, pkColumn, pkValue, data, files, metadata);
    }

    // Complex case: multi-table view
    return await updateMultiTableView(entityName, pkColumn, pkValue, data, files, metadata);
}

/**
 * Update a single table
 */
async function updateSingleTable(tableName, pkColumn, pkValue, data, files, metadata) {
    // Determine primary key if not provided
    const actualPkColumn = pkColumn || metadata.primaryKey;
    if (!actualPkColumn) {
        throw new Error('Primary key column not determined');
    }

    const setParts = [];
    const params = [];

    for (const col of metadata.columns) {
        const colName = col.name;

        // Do NOT update primary key
        if (col.isPrimary) continue;

        // Always update last_modified to CURRENT_TIMESTAMP
        if (colName.toLowerCase() === 'last_modified') {
            setParts.push('`last_modified` = CURRENT_TIMESTAMP()');
            continue;
        }

        // Check if data or file provided for this column
        const rawVal = files[colName] !== undefined ? files[colName] : data[colName];
        if (rawVal === undefined) continue;

        const val = sanitizeValueForColumn(rawVal, col);

        setParts.push(`\`${colName}\` = ?`);
        params.push(val);
    }

    if (setParts.length === 0) {
        throw new Error('No valid columns to update');
    }

    params.push(pkValue);
    const sql = `UPDATE \`${tableName}\` SET ${setParts.join(', ')} WHERE \`${actualPkColumn}\` = ?`;
    const [result] = await pool.query(sql, params);

    return {
        pkColumn: actualPkColumn,
        pkValue,
        affectedRows: result.affectedRows || 0,
        entity: tableName
    };
}

/**
 * Update a multi-table view
 */
async function updateMultiTableView(viewName, pkColumn, pkValue, data, files, metadata) {
    const tableDataMap = groupDataByTable(data, files, metadata);

    // Find relationships between tables
    const relationships = await findTableRelationships(metadata.baseTables);

    const conn = await pool.getConnection();
    let totalAffectedRows = 0;
    const updatedTables = [];

    try {
        await conn.beginTransaction();

        // Update each table that has data
        for (const tableName of metadata.baseTables) {
            const tableData = tableDataMap[tableName];

            // Skip if no data for this table
            if (Object.keys(tableData).length === 0) continue;

            const tableMetadata = await getEntityMetadata(tableName);

            // Determine how to identify the record in this table
            let whereColumn = null;
            let whereValue = null;

            // Check if this table has the primary key column from the view
            const viewPkInTable = tableMetadata.columns.find(c =>
                c.name === (pkColumn || metadata.primaryKey)
            );

            if (viewPkInTable) {
                whereColumn = viewPkInTable.name;
                whereValue = pkValue;
            } else {
                // Try to find via foreign key relationship
                const relToThisTable = relationships.find(r => r.fromTable === tableName);
                if (relToThisTable) {
                    // Use the foreign key as the where clause
                    whereColumn = relToThisTable.foreignKey;
                    whereValue = pkValue;
                } else {
                    // Use this table's own primary key if it's in the data
                    const tablePk = tableMetadata.primaryKey;
                    if (tablePk && tableData[tablePk] !== undefined) {
                        whereColumn = tablePk;
                        whereValue = tableData[tablePk];
                        delete tableData[tablePk]; // Don't update PK
                    }
                }
            }

            if (!whereColumn) {
                console.warn(`Cannot determine WHERE clause for table ${tableName}, skipping`);
                continue;
            }

            const setParts = [];
            const params = [];

            for (const col of tableMetadata.columns) {
                const colName = col.name;

                // Don't update primary key
                if (col.isPrimary) continue;

                // Always update last_modified
                if (colName.toLowerCase() === 'last_modified') {
                    setParts.push('`last_modified` = CURRENT_TIMESTAMP()');
                    continue;
                }

                if (tableData[colName] === undefined) continue;

                const val = sanitizeValueForColumn(tableData[colName], col);

                setParts.push(`\`${colName}\` = ?`);
                params.push(val);
            }

            if (setParts.length === 0) continue;

            params.push(whereValue);
            const sql = `UPDATE \`${tableName}\` SET ${setParts.join(', ')} WHERE \`${whereColumn}\` = ?`;
            const [result] = await conn.query(sql, params);

            totalAffectedRows += result.affectedRows || 0;
            updatedTables.push(tableName);
        }

        await conn.commit();

        return {
            success: true,
            pkColumn: pkColumn || metadata.primaryKey,
            pkValue,
            affectedRows: totalAffectedRows,
            updatedTables,
            entity: viewName
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Generic DELETE operation (supports multi-table views)
 */
async function deleteRecords(entityName, pkColumn, pkValues) {
    const metadata = await getEntityMetadata(entityName);

    // Normalize to array
    const values = Array.isArray(pkValues) ? pkValues : [pkValues];
    if (values.length === 0) {
        throw new Error('No values provided for deletion');
    }

    // Simple case: single table
    if (!metadata.isMultiTable) {
        return await deleteFromSingleTable(entityName, pkColumn, values, metadata);
    }

    // Complex case: multi-table view
    return await deleteFromMultiTableView(entityName, pkColumn, values, metadata);
}

/**
 * Delete from a single table
 */
async function deleteFromSingleTable(tableName, pkColumn, values, metadata) {
    // Determine primary key if not provided
    const actualPkColumn = pkColumn || metadata.primaryKey;
    if (!actualPkColumn) {
        throw new Error('Primary key column not determined');
    }

    const placeholders = values.map(() => '?').join(', ');
    const sql = `DELETE FROM \`${tableName}\` WHERE \`${actualPkColumn}\` IN (${placeholders})`;

    const [result] = await pool.query(sql, values);

    return {
        table: tableName,
        pkColumn: actualPkColumn,
        pkValues: values,
        affectedRows: result.affectedRows || 0,
        entity: tableName
    };
}

/**
 * Delete from a multi-table view (cascading delete based on FK relationships)
 */
async function deleteFromMultiTableView(viewName, pkColumn, values, metadata) {
    const relationships = await findTableRelationships(metadata.baseTables);

    // Determine delete order (reverse of insert order for cascade)
    const insertOrder = determineInsertOrder(metadata.baseTables, relationships);
    const deleteOrder = [...insertOrder].reverse();

    const conn = await pool.getConnection();
    let totalAffectedRows = 0;
    const deletedFromTables = [];

    try {
        await conn.beginTransaction();

        // Delete from each table in reverse dependency order
        for (const tableName of deleteOrder) {
            const tableMetadata = await getEntityMetadata(tableName);

            // Determine which column to use for WHERE clause
            let whereColumn = null;

            // Check if table has the view's PK column
            const viewPkInTable = tableMetadata.columns.find(c =>
                c.name === (pkColumn || metadata.primaryKey)
            );

            if (viewPkInTable) {
                whereColumn = viewPkInTable.name;
            } else {
                // Try to find via FK relationship
                const relToThisTable = relationships.find(r => r.fromTable === tableName);
                if (relToThisTable) {
                    whereColumn = relToThisTable.foreignKey;
                } else {
                    // Use table's own PK
                    whereColumn = tableMetadata.primaryKey;
                }
            }

            if (!whereColumn) {
                console.warn(`Cannot determine WHERE clause for table ${tableName}, skipping`);
                continue;
            }

            const placeholders = values.map(() => '?').join(', ');
            const sql = `DELETE FROM \`${tableName}\` WHERE \`${whereColumn}\` IN (${placeholders})`;

            const [result] = await conn.query(sql, values);

            if (result.affectedRows > 0) {
                totalAffectedRows += result.affectedRows;
                deletedFromTables.push(tableName);
            }
        }

        await conn.commit();

        return {
            success: true,
            pkColumn: pkColumn || metadata.primaryKey,
            pkValues: values,
            affectedRows: totalAffectedRows,
            deletedFromTables,
            entity: viewName
        };

    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Generic SELECT operation (single record by key)
 */
async function getRecordByKey(entityName, keyColumn, keyValue) {
    const metadata = await getEntityMetadata(entityName);

    const searchColumn = keyColumn || metadata.primaryKey;
    if (!searchColumn) {
        throw new Error('Search column not determined');
    }

    // Validate column exists
    if (!metadata.columns.find(c => c.name === searchColumn)) {
        throw new Error(`Column '${searchColumn}' not found in ${entityName}`);
    }

    const sql = `SELECT * FROM \`${entityName}\` WHERE \`${searchColumn}\` = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [keyValue]);

    return rows && rows.length > 0 ? rows[0] : null;
}

module.exports = {
    insertRecord,
    updateRecord,
    deleteRecords,
    getRecordByKey,
};