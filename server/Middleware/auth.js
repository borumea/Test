// server/middleware/auth.js
// JWT authentication middleware to protect routes

const jwt = require('jsonwebtoken');
const securityConfig = require('../Config/security');
const { getEntityMetadata, entityExists } = require('../Services/metadata');

/**
 * Middleware: Verify JWT token from Authorization header
 * Attaches decoded user info to req.user
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, securityConfig.jwt.secret, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        req.user = user; // { username, permissions, iat, exp }
        next();
    });
}

/**
 * Check if user has access to a specific table or view
 *
 * Access is granted if:
 * - Entity is 'Tags' or 'Ratings' (public access)
 * - User has direct permission to the entity (permission value of 1)
 * - Entity is a view AND user has permission to ALL base tables
 *
 * @param {string} entityName - table or view name
 * @param {object} permissions - user's permissions object
 * @returns {Promise<boolean>}
 */
async function hasAccessToEntity(entityName, permissions = {}) {
    const entityLower = entityName.toLowerCase();

    // Tags and Ratings are accessible to everyone
    if (entityLower === 'tags' || entityLower === 'ratings') {
        return true;
    }

    // Check for direct permission
    if (permissions[entityLower] === 1) {
        return true;
    }

    // Check if entity exists
    if (!await entityExists(entityName)) {
        return false;
    }

    // Get metadata to determine if it's a view
    try {
        const metadata = await getEntityMetadata(entityName);

        // If it's a base table, direct permission is required (already checked above)
        if (metadata.type === 'table') {
            return false;
        }

        // For views, check if user has access to ALL base tables
        if (metadata.type === 'view' && metadata.baseTables && metadata.baseTables.length > 0) {
            for (const baseTable of metadata.baseTables) {
                const baseTableLower = baseTable.toLowerCase();

                // Base Table can be tage or ratings since they are available to everyone
                if (baseTableLower === "tags" || baseTableLower === "ratings") {
                    continue;
                }

                // User must have permission to this base table
                if (!permissions[baseTableLower] || permissions[baseTableLower] !== 1) {
                    return false;
                }
            }

            // User has access to all base tables
            return true;
        }

        return false;
    } catch (err) {
        console.error(`Error checking access to ${entityName}:`, err);
        return false;
    }
}

/**
 * Middleware factory: Check if user has permission for a specific table/view
 * @param {string} tableParam - name of req.body or req.query property containing table name
 */
function requireTablePermission(tableParam = 'table') {
    return async (req, res, next) => {
        const table = req.body?.[tableParam] || req.query?.[tableParam];

        if (!table) {
            return res.status(400).json({ error: `${tableParam} parameter required` });
        }

        const permissions = req.user?.permissions || {};

        // Check access using the new logic
        try {
            const hasAccess = await hasAccessToEntity(table, permissions);

            if (!hasAccess) {
                return res.status(403).json({
                    error: `Access denied to table/view: ${table}`,
                    table: table
                });
            }

            next();
        } catch (err) {
            console.error('Permission check error:', err);
            return res.status(500).json({ error: 'Failed to check permissions' });
        }
    };
}

/**
 * Middleware: Check if user has employees table permission (for user management)
 */
function requireEmployeesPermission(req, res, next) {
    const permissions = req.user?.permissions || {};

    if (!permissions.employees || permissions.employees !== 1) {
        return res.status(403).json({
            error: 'Access denied: requires employee management permission'
        });
    }

    next();
}

module.exports = {
    authenticateToken,
    requireTablePermission,
    requireEmployeesPermission,
    hasAccessToEntity,
};