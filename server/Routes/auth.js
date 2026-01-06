// server/Routes/auth.js
// Authentication and user management endpoints

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const employeeService = require('../Services/employee');
const securityConfig = require('../Config/security');
const { authenticateToken, requireEmployeesPermission } = require('../Middleware/auth');
const { authLimiter } = require('../Middleware/rateLimiter');
const { validateLogin, validateChangePassword } = require('../Middleware/validation');
const { createLogger } = require('../Services/logger');

const logger = createLogger('auth-routes');

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', authLimiter, validateLogin, async (req, res) => {
    try {
        const { username, password } = req.body;

        logger.info('Login request received', { username });

        const user = await employeeService.authenticateUser(username, password);

        if (!user) {
            logger.warn('Login failed: Invalid credentials', { username });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                username: user.username,
                permissions: user.permissions
            },
            securityConfig.jwt.secret,
            {
                expiresIn: securityConfig.jwt.expiresIn,
                issuer: securityConfig.jwt.issuer,
                audience: securityConfig.jwt.audience,
            }
        );

        logger.info('Login successful, JWT generated', {
            username: user.username,
            firstTimeLogin: user.first_time_login,
            tokenExpiry: securityConfig.jwt.expiresIn
        });

        return res.json({
            success: true,
            token,
            username: user.username,
            first_time_login: user.first_time_login,
            permissions: user.permissions,
        });

    } catch (err) {
        logger.error('Login error occurred', {
            error: err.message,
            stack: err.stack
        });
        return res.status(500).json({ error: 'Login failed' });
    }
});

/**
 * POST /api/auth/change-password
 * Change user password (requires authentication)
 */
router.post('/change-password', authenticateToken, validateChangePassword, async (req, res) => {
    try {
        const { username, newPassword } = req.body;

        // Ensure user can only change their own password
        if (req.user.username !== username) {
            return res.status(403).json({ error: 'Can only change your own password' });
        }

        await employeeService.changeUserPassword(username, newPassword);

        return res.json({ success: true });

    } catch (err) {
        console.error('Change password error:', err);
        return res.status(500).json({ error: 'Failed to change password' });
    }
});

/**
 * POST /api/auth/keep-current-password
 * Mark user as no longer first-time without changing password
 */
router.post('/keep-current-password', authenticateToken, async (req, res) => {
    try {
        const { username } = req.body;

        // Ensure user can only update their own status
        if (req.user.username !== username) {
            return res.status(403).json({ error: 'Can only update your own status' });
        }

        await employeeService.keepCurrentPassword(username);

        return res.json({ success: true });

    } catch (err) {
        console.error('Keep current password error:', err);
        return res.status(500).json({ error: 'Failed to update user status' });
    }
});

/**
 * POST /api/auth/refresh-token
 * Refresh JWT token with a new expiration time
 * Requires valid existing token
 */
router.post('/refresh-token', authenticateToken, async (req, res) => {
    try {
        const { username } = req.user;

        logger.info('Token refresh requested', { username });

        // Get current user data to ensure user still exists
        const user = await employeeService.getUserByUsername(username);

        if (!user) {
            logger.warn('Token refresh failed: User not found', { username });
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate new JWT token with fresh expiration
        const newToken = jwt.sign(
            {
                username: user.username,
                permissions: user.permissions
            },
            securityConfig.jwt.secret,
            {
                expiresIn: securityConfig.jwt.expiresIn,
                issuer: securityConfig.jwt.issuer,
                audience: securityConfig.jwt.audience,
            }
        );

        logger.info('Token refreshed successfully', {
            username,
            tokenExpiry: securityConfig.jwt.expiresIn
        });

        return res.json({
            success: true,
            token: newToken,
            username: user.username,
            permissions: user.permissions,
        });

    } catch (err) {
        logger.error('Token refresh error', {
            error: err.message,
            username: req.user?.username
        });
        return res.status(500).json({ error: 'Failed to refresh token' });
    }
});

/**
 * POST /api/auth/refresh-permissions
 * Get updated permissions for a user
 */
router.post('/refresh-permissions', authenticateToken, async (req, res) => {
    try {
        const { username } = req.body;

        // Ensure user can only refresh their own permissions
        if (req.user.username !== username) {
            return res.status(403).json({ error: 'Can only refresh your own permissions' });
        }

        const permissions = await employeeService.refreshUserPermissions(username);

        if (!permissions) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ success: true, permissions });

    } catch (err) {
        console.error('Refresh permissions error:', err);
        return res.status(500).json({ error: 'Failed to refresh permissions' });
    }
});

/**
 * GET /api/employees
 * Get all employees (requires employees permission)
 */
router.get('/employees', authenticateToken, requireEmployeesPermission, async (req, res) => {
    try {
        const employees = await employeeService.getAllEmployees();
        res.json(employees);
    } catch (err) {
        console.error('Fetch employees error:', err);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});

/**
 * POST /api/auth/create-or-update-user
 * Create or update a user (requires employees permission)
 */
router.post('/create-or-update-user', authenticateToken, requireEmployeesPermission, async (req, res) => {
    try {
        const { creator, adminPassword, username, oneTimePassword, permissions } = req.body;

        // Validate required fields
        if (!creator || !adminPassword || !username) {
            return res.status(400).json({ 
                error: 'creator, adminPassword, and username are required' 
            });
        }

        // Ensure creator matches authenticated user
        if (req.user.username !== creator) {
            return res.status(403).json({ error: 'Creator mismatch' });
        }

        await employeeService.createOrUpdateUser(
            creator,
            adminPassword,
            username,
            oneTimePassword,
            permissions
        );

        res.json({ success: true });

    } catch (err) {
        console.error('Create/update user error:', err);

        if (err.message.includes('permission') || err.message.includes('password')) {
            return res.status(403).json({ error: err.message });
        }

        res.status(500).json({ error: 'Failed to create or update user' });
    }
});

/**
 * POST /api/auth/delete-user
 * Delete a user (requires employees permission)
 */
router.post('/delete-user', authenticateToken, requireEmployeesPermission, async (req, res) => {
    try {
        const { creator, adminPassword, username } = req.body;

        // Validate required fields
        if (!creator || !adminPassword || !username) {
            return res.status(400).json({ 
                error: 'creator, adminPassword, and username are required' 
            });
        }

        // Ensure creator matches authenticated user
        if (req.user.username !== creator) {
            return res.status(403).json({ error: 'Creator mismatch' });
        }

        await employeeService.deleteUser(creator, adminPassword, username);

        return res.json({ success: true });

    } catch (err) {
        console.error('Delete user error:', err);

        if (err.message.includes('cannot delete your own account')) {
            return res.status(400).json({ error: err.message });
        }

        if (err.message.includes('permission') || err.message.includes('password')) {
            return res.status(403).json({ error: err.message });
        }

        if (err.message.includes('not found')) {
            return res.status(404).json({ error: err.message });
        }

        res.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router;