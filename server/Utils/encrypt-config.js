// server/Utils/encrypt-config.js
// Utility for encrypting and decrypting configuration values

const CryptoJS = require('crypto-js');

// Encryption key - should be set via environment variable
const ENCRYPTION_KEY = process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production';

/**
 * Encrypts a string value
 * @param {string} text - The text to encrypt
 * @returns {string} The encrypted text
 */
function encrypt(text) {
    if (!text) return text;
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Decrypts an encrypted string value
 * @param {string} encryptedText - The encrypted text
 * @returns {string} The decrypted text
 */
function decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;

    try {
        const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);

        if (!decrypted) {
            console.warn('Decryption resulted in empty string - value may not be encrypted or wrong key used');
            return encryptedText;
        }

        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error.message);
        return encryptedText;
    }
}

/**
 * Checks if a value appears to be encrypted
 * @param {string} value - The value to check
 * @returns {boolean} True if the value appears to be encrypted
 */
function isEncrypted(value) {
    if (!value || typeof value !== 'string') return false;

    // AES encrypted values from crypto-js typically start with "U2Fsd" (base64 of "Salted")
    // or are long base64 strings
    return value.length > 20 && /^[A-Za-z0-9+/=]+$/.test(value);
}

/**
 * Decrypts a value only if it appears to be encrypted
 * @param {string} value - The value to potentially decrypt
 * @returns {string} The decrypted value or original value if not encrypted
 */
function decryptIfNeeded(value) {
    if (!value || typeof value !== 'string') return value;

    // If it looks encrypted, try to decrypt it
    if (isEncrypted(value)) {
        return decrypt(value);
    }

    // Otherwise return as-is (plain text)
    return value;
}

// CLI interface for encrypting/decrypting values
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const value = args[1];

    if (!command || !value) {
        console.log(`
Usage:
  node encrypt-config.js encrypt <value>    - Encrypt a value
  node encrypt-config.js decrypt <value>    - Decrypt a value
  node encrypt-config.js check <value>      - Check if a value is encrypted

Environment Variables:
  CONFIG_ENCRYPTION_KEY - The encryption key to use (default: 'default-key-change-in-production')

Examples:
  node encrypt-config.js encrypt "myPassword123"
  node encrypt-config.js decrypt "U2FsdGVkX1..."
  CONFIG_ENCRYPTION_KEY=mykey node encrypt-config.js encrypt "myPassword123"
        `);
        process.exit(1);
    }

    switch (command.toLowerCase()) {
        case 'encrypt':
            console.log('Encrypted:', encrypt(value));
            break;
        case 'decrypt':
            console.log('Decrypted:', decrypt(value));
            break;
        case 'check':
            console.log('Is encrypted:', isEncrypted(value));
            if (isEncrypted(value)) {
                console.log('Decrypted value:', decrypt(value));
            }
            break;
        default:
            console.error('Unknown command:', command);
            process.exit(1);
    }
}

module.exports = {
    encrypt,
    decrypt,
    isEncrypted,
    decryptIfNeeded
};
