// server/Config/db.config.js
// Database configuration loader - prioritizes .env over fallback config with automatic decryption

const path = require('path');
const fs = require('fs');
const { decryptIfNeeded } = require('../Utils/encrypt-config');

// Load .env file FIRST (higher priority)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Try to load legacy db.config.js as fallback (lower priority)
let legacyConfig = {};
const legacyConfigPath = path.join(__dirname, 'db.config.legacy.js');
if (fs.existsSync(legacyConfigPath)) {
    try {
        legacyConfig = require('./db.config.legacy.js');
        console.log('📦 Loaded legacy db.config.legacy.js as fallback');
    } catch (error) {
        console.warn('⚠️  Failed to load db.config.legacy.js:', error.message);
    }
}

/**
 * Gets a config value with priority: .env > legacy config > default
 * Automatically decrypts encrypted values
 * @param {string} envKey - Environment variable key
 * @param {string} legacyKey - Legacy config object key
 * @param {any} defaultValue - Default value if neither source has the value
 * @returns {any} The configuration value (decrypted if needed)
 */
function getConfig(envKey, legacyKey, defaultValue = undefined) {
    // Priority 1: Environment variable from .env
    if (process.env[envKey]) {
        const value = process.env[envKey];
        // Auto-decrypt if needed
        return decryptIfNeeded(value);
    }

    // Priority 2: Legacy config file
    if (legacyConfig && legacyConfig[legacyKey] !== undefined) {
        const value = legacyConfig[legacyKey];
        // Auto-decrypt if needed (in case legacy config has encrypted values)
        return typeof value === 'string' ? decryptIfNeeded(value) : value;
    }

    // Priority 3: Default value
    return defaultValue;
}

// Export configuration with .env priority
const config = {
    host: getConfig('DB_HOST', 'host', 'localhost'),
    user: getConfig('DB_USER', 'user', 'root'),
    password: getConfig('DB_PASS', 'password', ''),
    database: getConfig('DB_NAME', 'database', 'test'),
    port: getConfig('PORT', 'port', 3001),
};

// Log configuration source (without sensitive data)
console.log('🔧 Database configuration loaded:');
console.log('   Host:', config.host, process.env.DB_HOST ? '(from .env)' : '(from fallback)');
console.log('   User:', config.user, process.env.DB_USER ? '(from .env)' : '(from fallback)');
console.log('   Database:', config.database, process.env.DB_NAME ? '(from .env)' : '(from fallback)');
console.log('   Password:', config.password ? '***SET***' : '***NOT SET***',
    process.env.DB_PASS ? '(from .env)' : '(from fallback)');
console.log('   Port:', config.port, process.env.PORT ? '(from .env)' : '(from fallback)');

module.exports = config;
