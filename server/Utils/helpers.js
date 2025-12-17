// server/utils/helpers.js
// Utility helper functions

/**
 * Sanitize a value for a given column meta
 * - Convert empty strings to null for nullable columns
 * - Keep buffers as-is (for file uploads)
 */
function sanitizeValueForColumn(val, colMeta) {
    if (Buffer.isBuffer(val)) return val;
    if (val === undefined) return undefined;
    if (val === "") {
        return colMeta.isNullable ? null : "";
    }
    if (val === "null" && colMeta.isNullable) return null;
    return val;
}

/**
 * Parse filters from a SQL view definition WHERE clause
 */
function parseFiltersFromViewDefinition(viewDef) {
    const filters = [];

    try {
        const whereMatch = viewDef.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+GROUP BY|\s*$)/i);
        if (!whereMatch) return filters;

        const whereClause = whereMatch[1].trim();
        const conditions = whereClause.split(/\s+AND\s+/i);

        for (const cond of conditions) {
            const trimmed = cond.trim();

            // Match IS NULL / IS NOT NULL
            let match = trimmed.match(/`?(\w+)`?\s+(IS\s+(?:NOT\s+)?NULL)/i);
            if (match) {
                filters.push({
                    column: match[1],
                    operator: match[2].toUpperCase(),
                    value: null
                });
                continue;
            }

            // Match BETWEEN
            match = trimmed.match(/`?(\w+)`?\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/i);
            if (match) {
                filters.push({
                    column: match[1],
                    operator: "BETWEEN",
                    value: [match[2], match[3]]
                });
                continue;
            }

            // Match IN
            match = trimmed.match(/`?(\w+)`?\s+IN\s+\((.+?)\)/i);
            if (match) {
                const values = match[2].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
                filters.push({
                    column: match[1],
                    operator: "IN",
                    value: values
                });
                continue;
            }

            // Match standard operators
            match = trimmed.match(/`?(\w+)`?\s*(=|!=|<>|>=?|<=?|LIKE)\s*'([^']*)'/i);
            if (match) {
                filters.push({
                    column: match[1],
                    operator: match[2].toUpperCase(),
                    value: match[3]
                });
            }
        }
    } catch (e) {
        console.warn("Failed to parse filters from view definition:", e);
    }

    return filters;
}

module.exports = {
    sanitizeValueForColumn,
    parseFiltersFromViewDefinition,
};