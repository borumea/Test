// server/services/employee.service.js
// Employee and user management operations

const bcrypt = require('bcrypt');
const { pool, DB_NAME } = require('./db.service');
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
    if (rows && rows.length) return rows[0].TABLE_NAME;

    const guesses = ['Employees', 'employees', 'Employee', 'employee', 'users', 'Users'];
    for (const g of guesses) {
        const [r] = await pool.query(
            'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
            [DB_NAME, g]
        );
        if (r && r.length) return g;
    }

    return null;
}

/**
 * Refresh user permissions from database
 * Returns updated permissions object for the given username
 */
async function refreshUserPermissions(username) {
    const employeesTable = await detectEmployeesTable();
    if (!employeesTable) return null;

    const [rows] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ? LIMIT 1`,
        [username]
    );

    if (!rows || !rows.length) return null;

    const userRow = rows[0];
    const permissions = {};

    for (const [col, val] of Object.entries(userRow)) {
        if (['username', 'password', 'first_time_login'].includes(col)) continue;
        permissions[col] = bitToInt(val);
    }

    return permissions;
}

/**
 * Authenticate user and return user data with permissions
 */
async function authenticateUser(username, password) {
    const employeesTable = await detectEmployeesTable();
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

    const [rows] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username = ? LIMIT 1`,
        [username]
    );

    if (!rows || !rows.length) {
        return null; // User not found
    }

    const userRow = rows[0];
    const stored = (userRow.password || '').toString();

    let passwordMatches = false;
    let needsHashUpgrade = false;

    // Check if password is bcrypt hashed
    if (stored.startsWith('$2')) {
        passwordMatches = await bcrypt.compare(password, stored);
    } else if (password === stored) {
        // Plain text password (legacy)
        passwordMatches = true;
        needsHashUpgrade = true;
    }

    if (!passwordMatches) {
        return null; // Invalid credentials
    }

    // Upgrade plain text password to bcrypt
    if (needsHashUpgrade) {
        const newHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        await pool.query(
            `UPDATE \`${employeesTable}\` SET password=? WHERE username=?`,
            [newHash, username]
        );
    }

    // Build permissions object
    const permissions = {};
    for (const [col, val] of Object.entries(userRow)) {
        if (['username', 'password', 'first_time_login'].includes(col)) continue;
        permissions[col] = bitToInt(val);
    }

    return {
        username,
        first_time_login: bitToInt(userRow.first_time_login),
        permissions,
    };
}

/**
 * Change user password
 */
async function changeUserPassword(username, newPassword) {
    const employeesTable = await detectEmployeesTable();
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await pool.query(
        `UPDATE \`${employeesTable}\` SET password=?, first_time_login=0 WHERE username=?`,
        [hash, username]
    );
}

/**
 * Mark user as no longer first-time login
 */
async function keepCurrentPassword(username) {
    const employeesTable = await detectEmployeesTable();
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

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
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

    const [rows] = await pool.query(`SELECT * FROM \`${employeesTable}\``);

    return rows.map((r) => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
            if (k === 'password') continue; // Hide password
            if (k.toLowerCase() === 'emp_id') {
                out[k] = Math.abs(parseInt(v, 10)) || 0;
            } else if (k.toLowerCase() === 'username') {
                out[k] = String(v || '');
            } else {
                out[k] = bitToInt(v);
            }
        }
        return out;
    });
}

/**
 * Create or update a user
 */
async function createOrUpdateUser(creator, adminPassword, username, oneTimePassword, permissions) {
    const employeesTable = await detectEmployeesTable();
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

    // Verify creator has employees permission
    const [creatorRow] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username=?`,
        [creator]
    );

    if (!creatorRow || !creatorRow.length) {
        throw new Error('Creator not found');
    }

    const canManage = bitToInt(creatorRow[0].employees);
    if (!canManage) {
        throw new Error('Creator lacks permission for employees table');
    }

    // Verify admin password
    const creatorHashedPw = creatorRow[0].password?.toString() || '';
    let pwValid = false;

    if (creatorHashedPw.startsWith('$2')) {
        pwValid = await bcrypt.compare(adminPassword, creatorHashedPw);
    } else if (adminPassword === creatorHashedPw) {
        pwValid = true;
    }

    if (!pwValid) {
        throw new Error('Invalid admin password');
    }

    // Check if user exists
    const [existing] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username=?`,
        [username]
    );

    const cols = Object.keys(permissions || {});
    const colUpdates = cols.map((c) => `\`${c}\`=?`);
    const vals = cols.map((c) => bitToInt(permissions[c]));

    if (existing.length) {
        // Update existing user
        const sql = `UPDATE \`${employeesTable}\` SET ${colUpdates.join(', ')} WHERE username=?`;
        await pool.query(sql, [...vals, username]);
    } else {
        // Create new user
        const hash = oneTimePassword
            ? await bcrypt.hash(oneTimePassword, BCRYPT_SALT_ROUNDS)
            : await bcrypt.hash('changeme', BCRYPT_SALT_ROUNDS);

        const placeholders = cols.map(() => '?').join(', ');
        await pool.query(
            `INSERT INTO \`${employeesTable}\` (username, password, first_time_login, ${cols.join(', ')}) 
       VALUES (?, ?, 1, ${placeholders})`,
            [username, hash, ...vals]
        );
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
    if (!employeesTable) {
        throw new Error('Employees table not found');
    }

    // Verify creator permissions
    const [creatorRow] = await pool.query(
        `SELECT * FROM \`${employeesTable}\` WHERE username=?`,
        [creator]
    );

    if (!creatorRow || !creatorRow.length) {
        throw new Error('Creator not found');
    }

    const canManage = bitToInt(creatorRow[0].employees);
    if (!canManage) {
        throw new Error('Creator lacks permission to manage employees');
    }

    // Verify admin password
    const stored = creatorRow[0].password?.toString() || '';
    let pwValid = false;

    if (stored.startsWith('$2')) {
        pwValid = await bcrypt.compare(adminPassword, stored);
    } else if (adminPassword === stored) {
        pwValid = true;
    }

    if (!pwValid) {
        throw new Error('Invalid admin password');
    }

    // Check user exists
    const [target] = await pool.query(
        `SELECT username FROM \`${employeesTable}\` WHERE username=?`,
        [username]
    );

    if (!target.length) {
        throw new Error('User not found');
    }

    // Delete user
    await pool.query(`DELETE FROM \`${employeesTable}\` WHERE username=?`, [username]);
}

module.exports = {
    bitToInt,
    detectEmployeesTable,
    refreshUserPermissions,
    authenticateUser,
    changeUserPassword,
    keepCurrentPassword,
    getAllEmployees,
    createOrUpdateUser,
    deleteUser,
};