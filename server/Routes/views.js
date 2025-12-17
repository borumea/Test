// server/Routes/views.js
// View management using generalized services

const express = require('express');
const router = express.Router();

const { pool, clearCache } = require('../Services/db');
const { getEntityMetadata, entityExists } = require('../Services/metadata');
const { parseFiltersFromViewDefinition } = require('../Utils/helpers');
const { sanitizeViewName, isValidOperator } = require('../Utils/validators');
const { authenticateToken, requireEmployeesPermission } = require('../Middleware/auth');
const viewService = require('../Services/view');

// Multer for file uploads
const multer = (() => {
    try { return require('multer'); } catch (e) { return null; }
})();
const uploadMemory = multer ? multer({ storage: multer.memoryStorage() }) : null;

/**
 * Helper: Parse multipart or JSON request body
 */
function parseRequestBody(req) {
    if (req.is('multipart/form-data')) {
        const parsed = {};
        for (const [key, value] of Object.entries(req.body || {})) {
            try {
                parsed[key] = JSON.parse(value);
            } catch (e) {
                parsed[key] = value;
            }
        }
        return parsed;
    }
    return req.body || {};
}

/**
 * POST /api/views/create
 * Create a new view with optional filters
 */
router.post(
    '/create',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            const { baseTable, columns, viewName, filters = [] } = parseRequestBody(req);

            // Validate input
            if (!baseTable) {
                return res.status(400).json({ error: 'baseTable is required' });
            }
            if (!Array.isArray(columns) || columns.length === 0) {
                return res.status(400).json({ error: 'columns (array) is required' });
            }
            if (!viewName) {
                return res.status(400).json({ error: 'viewName is required' });
            }

            // Sanitize and validate view name
            const cleanViewName = sanitizeViewName(viewName);
            if (!/^[A-Za-z0-9_]+$/.test(cleanViewName)) {
                return res.status(400).json({
                    error: 'viewName contains invalid characters; allowed: letters, numbers, underscore'
                });
            }

            // Check if base table exists
            if (!await entityExists(baseTable)) {
                return res.status(400).json({ error: `Unknown table: ${baseTable}` });
            }

            // Check for name collision
            if (await entityExists(cleanViewName)) {
                return res.status(400).json({
                    error: `Name ${cleanViewName} conflicts with existing table or view`
                });
            }

            // Validate columns exist on base table
            const baseMetadata = await getEntityMetadata(baseTable);
            const allowedCols = baseMetadata.columns.map(c => c.name);
            
            for (const col of columns) {
                if (!allowedCols.includes(col)) {
                    return res.status(400).json({ 
                        error: `Unknown column ${col} for table ${baseTable}` 
                    });
                }
            }

            // Create view using service
            const result = await viewService.createView(
                cleanViewName,
                baseTable,
                columns,
                filters,
                allowedCols
            );

            clearCache();
            return res.json(result);

        } catch (e) {
            console.error('View create error:', e);
            res.status(500).json({ error: e.message || 'Failed to create view' });
        }
    }
);

/**
 * POST /api/views/update
 * Update an existing view (rename, change columns, change filters)
 */
router.post(
    '/update',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            const { oldViewName, newViewName, baseTable, columns, filters = [] } = parseRequestBody(req);

            // Validate input
            if (!oldViewName) {
                return res.status(400).json({ error: 'oldViewName is required' });
            }
            if (!newViewName) {
                return res.status(400).json({ error: 'newViewName is required' });
            }
            if (!baseTable) {
                return res.status(400).json({ error: 'baseTable is required' });
            }
            if (!Array.isArray(columns) || columns.length === 0) {
                return res.status(400).json({ error: 'columns (array) is required' });
            }

            // Sanitize names
            const cleanOld = sanitizeViewName(oldViewName);
            const cleanNew = sanitizeViewName(newViewName);

            if (!/^[A-Za-z0-9_]+$/.test(cleanNew) || !/^[A-Za-z0-9_]+$/.test(cleanOld)) {
                return res.status(400).json({
                    error: 'view names must contain only letters, numbers, underscore'
                });
            }

            // Ensure old view exists
            const oldMetadata = await getEntityMetadata(cleanOld);
            if (oldMetadata.type !== 'view') {
                return res.status(400).json({ 
                    error: `${cleanOld} is not a view` 
                });
            }

            // Check for collision if renaming
            if (cleanOld !== cleanNew && await entityExists(cleanNew)) {
                return res.status(400).json({
                    error: `Name ${cleanNew} conflicts with existing table or view`
                });
            }

            // Validate base table and columns
            if (!await entityExists(baseTable)) {
                return res.status(400).json({ error: `Unknown table: ${baseTable}` });
            }

            const baseMetadata = await getEntityMetadata(baseTable);
            const allowedCols = baseMetadata.columns.map(c => c.name);
            
            for (const col of columns) {
                if (!allowedCols.includes(col)) {
                    return res.status(400).json({
                        error: `Unknown column ${col} for table ${baseTable}`
                    });
                }
            }

            // Update view using service
            const result = await viewService.updateView(
                cleanOld,
                cleanNew,
                baseTable,
                columns,
                filters,
                allowedCols
            );

            clearCache();
            return res.json(result);

        } catch (e) {
            console.error('View update error:', e);
            res.status(500).json({ error: e.message || 'Failed to update view' });
        }
    }
);

/**
 * POST /api/views/delete
 * Delete a view and its corresponding Employees column
 */
router.post(
    '/delete',
    authenticateToken,
    requireEmployeesPermission,
    uploadMemory ? uploadMemory.any() : (req, res, next) => next(),
    async (req, res) => {
        try {
            const { viewName } = parseRequestBody(req);

            if (!viewName) {
                return res.status(400).json({ error: 'viewName is required' });
            }

            const cleanViewName = sanitizeViewName(viewName);
            if (!/^[A-Za-z0-9_]+$/.test(cleanViewName)) {
                return res.status(400).json({ 
                    error: 'viewName contains invalid characters' 
                });
            }

            // Ensure this is truly a view
            const metadata = await getEntityMetadata(cleanViewName);
            if (metadata.type !== 'view') {
                return res.status(400).json({ 
                    error: `${cleanViewName} is not a view` 
                });
            }

            // Delete view using service
            const result = await viewService.deleteView(cleanViewName);

            clearCache();
            return res.json(result);

        } catch (e) {
            console.error('View delete error:', e);
            res.status(500).json({ error: e.message || 'Failed to delete view' });
        }
    }
);

/**
 * GET /api/views/list
 * List all views with their base tables, columns, and filters
 */
router.get('/list', authenticateToken, async (req, res) => {
    try {
        const views = await viewService.listAllViews();
        return res.json({ rows: views });

    } catch (e) {
        console.error('Views list error:', e);
        res.status(500).json({ error: e.message || 'Failed to list views' });
    }
});

/**
 * GET /api/views/base-table-map
 * Returns mapping of view names to their base tables
 */
router.get('/base-table-map', authenticateToken, async (req, res) => {
    try {
        const mapping = await viewService.getViewBaseTableMap();
        return res.json(mapping);

    } catch (e) {
        console.error('Views base-table-map error:', e);
        res.status(500).json({ error: e.message || 'Failed to get view-to-table mapping' });
    }
});

module.exports = router;