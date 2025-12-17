// server/utils/validators.js
// Validation helper functions for SQL operations

/**
 * Check if an operator is valid for SQL queries
 */
function isValidOperator(op) {
    const validOps = new Set([
        "=", ">", "<", ">=", "<=", "!=", "<>",
        "LIKE", "IN", "IS", "IS NOT", "BETWEEN"
    ]);
    return validOps.has(String(op).toUpperCase().trim());
}

/**
 * Validate table/view name format
 */
function isValidTableName(name) {
    return /^[A-Za-z0-9_]+$/.test(String(name).trim());
}

/**
 * Validate column name format
 */
function isValidColumnName(name) {
    return /^[A-Za-z0-9_]+$/.test(String(name).trim());
}

/**
 * Validate aggregate function name
 */
function isValidAggregateFunction(func) {
    const allowedAggs = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
    return allowedAggs.has(String(func).toUpperCase());
}

/**
 * Sanitize view name (replace spaces with underscores)
 */
function sanitizeViewName(name) {
    return String(name).trim().replace(/\s+/g, '_');
}

module.exports = {
    isValidOperator,
    isValidTableName,
    isValidColumnName,
    isValidAggregateFunction,
    sanitizeViewName,
};