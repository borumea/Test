// server/Services/crypto.js
// Encryption/decryption service for sensitive configuration data

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('crypto');

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Prefix to identify encrypted values
const ENCRYPTED_PREFIX = 'ENC:';

/**
 * Get master encryption key from environment or key file
 */
function getMasterKey() {
    // Try environment variable first
    if (process.env.MASTER_ENCRYPTION_KEY) {
        return process.env.MASTER_ENCRYPTION_KEY;
    }

    // Try reading from key file
    const keyFilePath = path.join(__dirname, '..', '.encryption.key');
    if (fs.existsSync(keyFilePath)) {
        try {
            const key = fs.readFileSync(keyFilePath, 'utf8').trim();
            if (key) {
                logger.debug('Master key loaded from file');
                return key;
            }
        } catch (error) {
            logger.warn('Failed to read encryption key file', { error: error.message });
        }
    }

    // Generate and save a new key if none exists
    logger.warn('No master encryption key found, generating new key');
    const newKey = crypto.randomBytes(32).toString('hex');

    try {
        fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 });
        logger.info('New master encryption key generated and saved', {
            path: keyFilePath
        });
        return newKey;
    } catch (error) {
        logger.error('Failed to save encryption key file', { error: error.message });
        throw new Error('Could not initialize encryption key');
    }
}

/**
 * Derive encryption key from master key using PBKDF2
 */
function deriveKey(masterKey, salt) {
    return crypto.pbkdf2Sync(
        masterKey,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        'sha512'
    );
}

/**
 * Encrypt a value
 * Returns: ENC:base64(salt:iv:encrypted:tag)
 */
function encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
        throw new Error('Plaintext must be a non-empty string');
    }

    try {
        const masterKey = getMasterKey();
        const salt = crypto.randomBytes(SALT_LENGTH);
        const key = deriveKey(masterKey, salt);
        const iv = crypto.randomBytes(IV_LENGTH);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const tag = cipher.getAuthTag();

        // Combine salt, iv, encrypted data, and tag
        const combined = Buffer.concat([
            salt,
            iv,
            Buffer.from(encrypted, 'hex'),
            tag
        ]);

        return ENCRYPTED_PREFIX + combined.toString('base64');
    } catch (error) {
        logger.error('Encryption failed', { error: error.message });
        throw new Error('Encryption failed: ' + error.message);
    }
}

/**
 * Decrypt a value
 * Input: ENC:base64(salt:iv:encrypted:tag)
 * Returns: plaintext string
 */
function decrypt(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') {
        return ciphertext; // Return as-is if not a string
    }

    // Check if value is encrypted
    if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
        return ciphertext; // Not encrypted, return as-is
    }

    try {
        const masterKey = getMasterKey();

        // Remove prefix and decode base64
        const combined = Buffer.from(
            ciphertext.substring(ENCRYPTED_PREFIX.length),
            'base64'
        );

        // Extract components
        const salt = combined.slice(0, SALT_LENGTH);
        const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = combined.slice(combined.length - TAG_LENGTH);
        const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH, combined.length - TAG_LENGTH);

        // Derive key
        const key = deriveKey(masterKey, salt);

        // Decrypt
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        logger.error('Decryption failed', {
            error: error.message,
            valuePreview: ciphertext.substring(0, 20) + '...'
        });
        throw new Error('Decryption failed: ' + error.message);
    }
}

/**
 * Check if a value is encrypted
 */
function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Decrypt all encrypted values in an object
 */
function decryptObject(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const decrypted = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && isEncrypted(value)) {
            try {
                decrypted[key] = decrypt(value);
                logger.debug('Decrypted configuration value', { key });
            } catch (error) {
                logger.error('Failed to decrypt value', {
                    key,
                    error: error.message
                });
                throw error;
            }
        } else {
            decrypted[key] = value;
        }
    }
    return decrypted;
}

/**
 * Encrypt sensitive values in an object
 * Only encrypts values for specified keys
 */
function encryptObject(obj, keysToEncrypt = []) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const encrypted = { ...obj };
    for (const key of keysToEncrypt) {
        if (obj[key] && !isEncrypted(obj[key])) {
            encrypted[key] = encrypt(String(obj[key]));
            logger.info('Encrypted configuration value', { key });
        }
    }
    return encrypted;
}

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    decryptObject,
    encryptObject,
    ENCRYPTED_PREFIX,
    getMasterKey
};
