// server/Services/config.js
// Secure configuration loader with automatic decryption

const path = require('path');
const fs = require('fs');
const { decrypt, decryptObject } = require('./crypto');
const { createLogger } = require('./logger');

const logger = createLogger('config');

/**
 * Load and decrypt .env file
 */
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
        logger.warn('.env file not found, using environment variables only');
        return {};
    }

    try {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        const env = {};

        lines.forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) {
                return;
            }

            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();

                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                // Decrypt if encrypted
                try {
                    env[key] = decrypt(value);
                    if (value !== env[key]) {
                        logger.debug('Decrypted environment variable', { key });
                    }
                } catch (error) {
                    logger.error('Failed to decrypt environment variable', {
                        key,
                        error: error.message
                    });
                    throw error;
                }

                // Set in process.env if not already set
                if (!process.env[key]) {
                    process.env[key] = env[key];
                }
            }
        });

        logger.info('Environment configuration loaded', {
            variableCount: Object.keys(env).length
        });

        return env;
    } catch (error) {
        logger.error('Failed to load .env file', { error: error.message });
        throw error;
    }
}

/**
 * Load and decrypt database configuration
 */
function loadDbConfig() {
    // Load .env first to ensure MASTER_ENCRYPTION_KEY is available
    loadEnv();

    const configPath = path.join(__dirname, '..', 'Config', 'db.config.js');

    // Try to load db.config.js
    if (fs.existsSync(configPath)) {
        try {
            delete require.cache[require.resolve(configPath)];
            const dbConfig = require(configPath);

            // Decrypt sensitive values
            const decrypted = decryptObject(dbConfig);

            logger.info('Database configuration loaded from db.config.js');

            return decrypted;
        } catch (error) {
            logger.error('Failed to load db.config.js', { error: error.message });
            throw error;
        }
    }

    // Fall back to environment variables
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || '3306', 10)
    };

    // Decrypt password if encrypted
    if (config.password) {
        config.password = decrypt(config.password);
    }

    logger.info('Database configuration loaded from environment variables');

    return config;
}

/**
 * Get configuration value with decryption
 */
function getConfig(key, defaultValue = undefined) {
    const value = process.env[key] || defaultValue;
    if (!value) return value;

    try {
        return decrypt(value);
    } catch (error) {
        logger.warn('Failed to decrypt config value, using as-is', {
            key,
            error: error.message
        });
        return value;
    }
}

/**
 * Get all configuration as an object
 */
function getAllConfig() {
    return decryptObject(process.env);
}

module.exports = {
    loadEnv,
    loadDbConfig,
    getConfig,
    getAllConfig
};
