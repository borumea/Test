/**
 * Client-side permissions helper
 * Implements the same permission logic as the server
 *
 * Access is granted if:
 * - Entity is 'Tags' or 'Ratings' (public access)
 * - User has direct permission to the entity
 * - Entity is a view AND user has permission to ALL base tables
 */

/**
 * Check if user has access to a specific table or view
 *
 * @param {string} entityName - table or view name
 * @param {object} permissions - user's permissions object {table_name: 0|1}
 * @param {object} viewBaseTableMap - mapping of view names to their base tables
 * @returns {boolean}
 */
export function hasAccessToEntity(entityName, permissions = {}, viewBaseTableMap = {}) {
    const entityLower = entityName.toLowerCase();

    // Tags and Ratings are accessible to everyone
    if (entityLower === 'tags' || entityLower === 'ratings') {
        return true;
    }

    // Check for direct permission
    if (permissions[entityLower] === 1) {
        return true;
    }

    // Check if it's a view and user has access to ALL base tables
    const baseTables = viewBaseTableMap[entityLower];

    if (baseTables && Array.isArray(baseTables) && baseTables.length > 0) {
        // This is a view - check if user has access to all base tables
        for (const baseTable of baseTables) {
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

    // Not a known view, and no direct permission
    return false;
}

/**
 * Filter a list of entities based on user permissions
 *
 * @param {string[]} entities - array of table/view names
 * @param {object} permissions - user's permissions object
 * @param {object} viewBaseTableMap - mapping of view names to their base tables
 * @returns {string[]} - filtered array of accessible entities
 */
export function filterAccessibleEntities(entities, permissions = {}, viewBaseTableMap = {}) {
    return entities.filter(entity =>
        hasAccessToEntity(entity, permissions, viewBaseTableMap)
    );
}

/**
 * Convert permissions array to object format
 * From: ['table1', 'table2'] to: {table1: 1, table2: 1}
 *
 * @param {string[]} permissionsArray - array of permission names
 * @returns {object} - permissions object
 */
export function normalizePermissionsArray(permissionsArray) {
    if (!Array.isArray(permissionsArray)) return {};

    const perms = {};
    permissionsArray.forEach(name => {
        perms[name.toLowerCase()] = 1;
    });
    return perms;
}

/**
 * Convert permissions object to array format
 * From: {table1: 1, table2: 0, table3: 1} to: ['table1', 'table3']
 *
 * @param {object} permissionsObject - permissions object
 * @returns {string[]} - array of accessible table names
 */
export function permissionsObjectToArray(permissionsObject) {
    if (!permissionsObject || typeof permissionsObject !== 'object') return [];

    return Object.keys(permissionsObject)
        .filter(key => permissionsObject[key] === 1);
}
