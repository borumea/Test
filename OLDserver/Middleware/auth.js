// server/middleware/auth.js
// JWT authentication middleware to protect routes

const jwt = require('jsonwebtoken');
const securityConfig = require('../Config/security');

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
 * Middleware factory: Check if user has permission for a specific table/view
 * @param {string} tableParam - name of req.body or req.query property containing table name
 */
function requireTablePermission(tableParam = 'table') {
    return (req, res, next) => {
        const table = req.body?.[tableParam] || req.query?.[tableParam];

        if (!table) {
            return res.status(400).json({ error: `${tableParam} parameter required` });
        }

        const tableLower = table.toLowerCase();
        const permissions = req.user?.permissions || {};

        // Check if user has permission for this table (permission value of 1)
        if (!permissions[tableLower] || permissions[tableLower] !== 1) {
            return res.status(403).json({
                error: `Access denied to table/view: ${table}`,
                table: table
            });
        }

        next();
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
};