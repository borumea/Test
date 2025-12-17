// server/middleware/validation.js
// Input validation middleware for sanitizing and validating requests

const { body, query, validationResult } = require('express-validator');

/**
 * Middleware: Check validation results and return errors if any
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
}

/**
 * Validation rules for login endpoint
 */
const validateLogin = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required')
        .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 1, max: 255 }).withMessage('Password too long'),
    handleValidationErrors,
];

/**
 * Validation rules for change password endpoint
 */
const validateChangePassword = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required'),
    body('newPassword')
        .notEmpty().withMessage('New password is required')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    handleValidationErrors,
];

/**
 * Validation rules for table query parameter
 */
const validateTableQuery = [
    query('table')
        .trim()
        .notEmpty().withMessage('Table parameter is required')
        .matches(/^[A-Za-z0-9_]+$/).withMessage('Invalid table name format'),
    handleValidationErrors,
];

/**
 * Validation rules for view name
 */
const validateViewName = [
    body('viewName')
        .trim()
        .notEmpty().withMessage('View name is required')
        .matches(/^[A-Za-z0-9_]+$/).withMessage('View name can only contain letters, numbers, and underscores'),
    handleValidationErrors,
];

module.exports = {
    handleValidationErrors,
    validateLogin,
    validateChangePassword,
    validateTableQuery,
    validateViewName,
};