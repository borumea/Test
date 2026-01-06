// server/Services/employee.js
// Employee and user management operations

const bcrypt = require('bcrypt');
const { pool, DB_NAME } = require('./db');
const securityConfig = require('../Config/security');

const BCRYPT_SALT_ROUNDS = securityConfig.bcrypt.saltRounds;

/**
 * Helper: Convert MySQL BIT(1) or Buffer values to 0/1 integers
 */
function bitToInt(v) {
    if (v === null || v === undefined) return 0;
    if (Buffer.isBuffer(v)) return v[0] ? 1 : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v ? 1 : 0;
    if (typeof v === 'string') return v === '1' ? 1 : 0;
    return 0;
}

/**
 * Detect the employees table (contains username & password columns)
 */
async function detectEmployeesTable() {
    // Try finding by username + password columns
    const sql = `
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND COLUMN_NAME IN ('username', 'password')
        GROUP BY TABLE_NAME
        HAVING COUNT(DISTINCT COLUMN_NAME) = 2
        LIMIT 1
    `;

    const [rows] = await pool.query(sql, [DB_NAME]);
    if (rows && rows.length) {
        return rows[0].TABLE_NAME;
    }

    // Fallback to common names
    const guesses = ['Employees', 'employees', 'Employee', 'employee', 'users', 'Users'];
    for (const guess of guesses) {
        const [result] = await pool.query(
            'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
            [DB_NAME, guess]
        );
        if (result && result.length) {
            return guess;
        }
    }

    throw new Error('Employees table not found');
}

/**
 * Build permissions object from user row
 */
function buildPermissions(userRow) {
    const permissions = {};

    for (const [col, val] of Object.entries(userRow)) {
        if (['username', 'password', 'first_time_login'].includes(col)) continue;
        permissions[col] = bitToInt(val);
    }

    return permissions;
}

/**
 * Verify password (handles both bcrypt and plain text)
 */
async function verifyPassword(plainPassword, storedPassword) {
    const stored = String(storedPassword || '');

    // Check if bcrypt hashed
    if (stored.startsWith('$2')) {
        return await bcrypt.compare(plainPassword, stored);
    }

    // Plain text comparison (legacy)
    return plainPassword === stored;
}

/**
 * Upgrade plain text password to bcrypt if needed
 */
async function upgradePasswordIfNeeded(username, plainPassword, storedPassword, employeesTable) {
    const stored = String(storedPassword || '');

    // If not bcrypt hashed, upgrade it
    if (!stored.startsWith('$2')) {
        const newHash = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
        await pool.query(
            `UPDATE \`${employeesTable}\` SET password = ? WHERE username = ?`,
            [newHash, username]
        );
    }
}

/**
 * Get user by username (without password verification)
 * Returns user object with username, first_time_login, and permissions
 */
async function getUserByUsername(username) {
    const employeesTable = await detectEmployeesTable();

    const [rows] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ? LIMIT 1`,
        [username]
    );

    if (!rows || !rows.length) {
        return null;
    }

    const userRow = rows[0];

    return {
        username,
        first_time_login: bitToInt(userRow.first_time_login),
        permissions: buildPermissions(userRow),
    };
}

/**
 * Refresh user permissions from database
 */
async function refreshUserPermissions(username) {
    const employeesTable = await detectEmployeesTable();

    const [rows] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ? LIMIT 1`,
        [username]
    );

    if (!rows || !rows.length) {
        return null;
    }

    return buildPermissions(rows[0]);
}

/**
 * Authenticate user and return user data with permissions
 */
async function authenticateUser(username, password) {
    const employeesTable = await detectEmployeesTable();

    const [rows] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ? LIMIT 1`,
        [username]
    );

    if (!rows || !rows.length) {
        return null; // User not found
    }

    const userRow = rows[0];

    // Verify password
    const passwordMatches = await verifyPassword(password, userRow.password);
    if (!passwordMatches) {
        return null; // Invalid credentials
    }

    // Upgrade password if needed
    await upgradePasswordIfNeeded(username, password, userRow.password, employeesTable);

    // Build and return user data
    return {
        username,
        first_time_login: bitToInt(userRow.first_time_login),
        permissions: buildPermissions(userRow),
    };
}

/**
 * Change user password
 */
async function changeUserPassword(username, newPassword) {
    const employeesTable = await detectEmployeesTable();

    const hash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    await pool.query(
        `UPDATE \`${employeesTable}\` SET password = ?, first_time_login = 0 WHERE username = ?`,
        [hash, username]
    );
}

/**
 * Mark user as no longer first-time login
 */
async function keepCurrentPassword(username) {
    const employeesTable = await detectEmployeesTable();

    await pool.query(
        `UPDATE \`${employeesTable}\` SET first_time_login = 0 WHERE username = ?`,
        [username]
    );
}

/**
 * Get all employees with their permissions
 */
async function getAllEmployees() {
    const employeesTable = await detectEmployeesTable();

    const [rows] = await pool.query(`SELECT * FROM \`${employeesTable}\``);

    return rows.map(row => {
        const employee = {};

        for (const [key, value] of Object.entries(row)) {
            if (key === 'password') continue; // Hide password

            if (key.toLowerCase() === 'emp_id') {
                employee[key] = Math.abs(parseInt(value, 10)) || 0;
            } else if (key.toLowerCase() === 'username') {
                employee[key] = String(value || '');
            } else {
                employee[key] = bitToInt(value);
            }
        }

        return employee;
    });
}

/**
 * Verify admin has permission and correct password
 */
async function verifyAdminAccess(creator, adminPassword, employeesTable) {
    const [creatorRow] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ?`,
        [creator]
    );

    if (!creatorRow || !creatorRow.length) {
        throw new Error('Creator not found');
    }

    const userData = creatorRow[0];

    // Check employees permission
    const canManage = bitToInt(userData.employees);
    if (!canManage) {
        throw new Error('Creator lacks permission for employees table');
    }

    // Verify password
    const passwordValid = await verifyPassword(adminPassword, userData.password);
    if (!passwordValid) {
        throw new Error('Invalid admin password');
    }

    return userData;
}

/**
 * Get valid permission columns from employees table
 * Filters out special columns like username, password, first_time_login
 */
async function getValidPermissionColumns(employeesTable) {
    const [columns] = await pool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB_NAME, employeesTable]
    );

    const specialColumns = ['username', 'password', 'first_time_login', 'emp_id', 'employee_id'];
    return columns
        .map(c => c.COLUMN_NAME)
        .filter(col => !specialColumns.includes(col.toLowerCase()));
}

/**
 * Create or update a user
 */
async function createOrUpdateUser(creator, adminPassword, username, oneTimePassword, permissions) {
    const employeesTable = await detectEmployeesTable();

    // Verify admin access
    await verifyAdminAccess(creator, adminPassword, employeesTable);

    // Get valid permission columns that actually exist in the employees table
    const validColumns = await getValidPermissionColumns(employeesTable);
    const validColumnSet = new Set(validColumns.map(c => c.toLowerCase()));

    // Filter permissions to only include columns that exist
    const permCols = Object.keys(permissions || {}).filter(col =>
        validColumnSet.has(col.toLowerCase())
    );
    const permVals = permCols.map(col => bitToInt(permissions[col]));

    // Check if user exists
    const [existing] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ?`,
        [username]
    );

    if (existing.length) {
        // Update existing user - only update columns that exist
        if (permCols.length > 0) {
            const colUpdates = permCols.map(col => `\`${col}\` = ?`);
            const sql = `UPDATE \`${employeesTable}\` SET ${colUpdates.join(', ')} WHERE username = ?`;
            await pool.query(sql, [...permVals, username]);
        }
    } else {
        // Create new user
        const hash = oneTimePassword
            ? await bcrypt.hash(oneTimePassword, BCRYPT_SALT_ROUNDS)
            : await bcrypt.hash('changeme', BCRYPT_SALT_ROUNDS);

        if (permCols.length > 0) {
            const placeholders = permCols.map(() => '?').join(', ');
            const sql = `
                INSERT INTO \`${employeesTable}\`
                (username, password, first_time_login, ${permCols.map(c => `\`${c}\``).join(', ')})
                VALUES (?, ?, 1, ${placeholders})
            `;
            await pool.query(sql, [username, hash, ...permVals]);
        } else {
            // No permission columns, just create with username and password
            const sql = `
                INSERT INTO \`${employeesTable}\`
                (username, password, first_time_login)
                VALUES (?, ?, 1)
            `;
            await pool.query(sql, [username, hash]);
        }
    }
}

/**
 * Delete a user
 */
async function deleteUser(creator, adminPassword, username) {
    if (creator === username) {
        throw new Error('You cannot delete your own account');
    }

    const employeesTable = await detectEmployeesTable();

    // Verify admin access
    await verifyAdminAccess(creator, adminPassword, employeesTable);

    // Check user exists
    const [target] = await pool.query(
        `SELECT username FROM \`${employeesTable}\` WHERE username = ?`,
        [username]
    );

    if (!target.length) {
        throw new Error('User not found');
    }

    // Delete user
    await pool.query(
        `DELETE FROM \`${employeesTable}\` WHERE username = ?`,
        [username]
    );
}

module.exports = {
    detectEmployeesTable,
    getUserByUsername,
    refreshUserPermissions,
    authenticateUser,
    changeUserPassword,
    keepCurrentPassword,
    getAllEmployees,
    createOrUpdateUser,
    deleteUser,
};