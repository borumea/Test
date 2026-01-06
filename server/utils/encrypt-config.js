#!/usr/bin/env node
// server/utils/encrypt-config.js
// Utility to encrypt sensitive values in configuration files

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { encrypt, decrypt, isEncrypted } = require('../Services/crypto');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

// Sensitive keys that should be encrypted
const SENSITIVE_KEYS = [
    'DB_PASS',
    'DB_PASSWORD',
    'JWT_SECRET',
    'MASTER_ENCRYPTION_KEY' // Don't encrypt this one, but list it
];

const DB_CONFIG_SENSITIVE_KEYS = [
    'password'
];

/**
 * Parse .env file
 */
function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const parsed = {};

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

            parsed[key] = value;
        }
    });

    return parsed;
}

/**
 * Write .env file
 */
function writeEnvFile(filePath, data) {
    const lines = [];

    for (const [key, value] of Object.entries(data)) {
        // Skip MASTER_ENCRYPTION_KEY - it shouldn't be in .env
        if (key === 'MASTER_ENCRYPTION_KEY') {
            continue;
        }

        // Add quotes to values containing special characters or spaces
        const needsQuotes = /[\s#$]/.test(value);
        const formattedValue = needsQuotes ? `"${value}"` : value;

        lines.push(`${key}=${formattedValue}`);
    }

    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Encrypt sensitive values in .env file
 */
async function encryptEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');

    console.log('🔒 Encrypting sensitive values in .env file');
    console.log('='.repeat(50));

    const env = parseEnvFile(envPath);
    if (!env) return;

    let changed = false;

    for (const key of SENSITIVE_KEYS) {
        if (env[key] && !isEncrypted(env[key])) {
            if (key === 'MASTER_ENCRYPTION_KEY') {
                console.log(`⚠️  Skipping ${key} (should not be encrypted)`);
                continue;
            }

            console.log(`🔐 Encrypting ${key}...`);
            env[key] = encrypt(env[key]);
            changed = true;
        } else if (env[key] && isEncrypted(env[key])) {
            console.log(`✓  ${key} is already encrypted`);
        }
    }

    if (changed) {
        // Backup original file
        const backupPath = envPath + '.backup';
        fs.copyFileSync(envPath, backupPath);
        console.log(`📦 Backup created: ${backupPath}`);

        // Write encrypted file
        writeEnvFile(envPath, env);
        console.log(`✅ Encrypted values written to ${envPath}`);
    } else {
        console.log('ℹ️  No changes needed');
    }
}

/**
 * Decrypt sensitive values in .env file (for viewing/editing)
 */
async function decryptEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');

    console.log('🔓 Decrypting sensitive values in .env file');
    console.log('='.repeat(50));

    const env = parseEnvFile(envPath);
    if (!env) return;

    let changed = false;

    for (const key of SENSITIVE_KEYS) {
        if (env[key] && isEncrypted(env[key])) {
            console.log(`🔑 Decrypting ${key}...`);
            try {
                env[key] = decrypt(env[key]);
                changed = true;
            } catch (error) {
                console.error(`❌ Failed to decrypt ${key}: ${error.message}`);
            }
        }
    }

    if (changed) {
        // Backup encrypted file
        const backupPath = envPath + '.encrypted';
        fs.copyFileSync(envPath, backupPath);
        console.log(`📦 Encrypted backup: ${backupPath}`);

        // Write decrypted file
        writeEnvFile(envPath, env);
        console.log(`✅ Decrypted values written to ${envPath}`);
        console.log('⚠️  WARNING: File now contains plaintext secrets!');
    } else {
        console.log('ℹ️  No encrypted values found');
    }
}

/**
 * Encrypt a single value
 */
async function encryptValue() {
    const value = await question('Enter value to encrypt: ');
    if (!value) {
        console.log('❌ No value provided');
        return;
    }

    try {
        const encrypted = encrypt(value);
        console.log('\n🔒 Encrypted value:');
        console.log(encrypted);
        console.log('\n✅ Copy this value to your .env or config file');
    } catch (error) {
        console.error(`❌ Encryption failed: ${error.message}`);
    }
}

/**
 * Decrypt a single value
 */
async function decryptValue() {
    const value = await question('Enter encrypted value to decrypt: ');
    if (!value) {
        console.log('❌ No value provided');
        return;
    }

    try {
        const decrypted = decrypt(value);
        console.log('\n🔓 Decrypted value:');
        console.log(decrypted);
    } catch (error) {
        console.error(`❌ Decryption failed: ${error.message}`);
    }
}

/**
 * Main menu
 */
async function main() {
    console.log('\n🔐 Configuration Encryption Utility');
    console.log('='.repeat(50));
    console.log('1. Encrypt sensitive values in .env file');
    console.log('2. Decrypt sensitive values in .env file');
    console.log('3. Encrypt a single value');
    console.log('4. Decrypt a single value');
    console.log('5. Exit');
    console.log('');

    const choice = await question('Select an option (1-5): ');

    switch (choice.trim()) {
        case '1':
            await encryptEnvFile();
            break;
        case '2':
            await decryptEnvFile();
            break;
        case '3':
            await encryptValue();
            break;
        case '4':
            await decryptValue();
            break;
        case '5':
            console.log('👋 Goodbye!');
            rl.close();
            process.exit(0);
            return;
        default:
            console.log('❌ Invalid option');
    }

    console.log('');
    rl.close();
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = { encryptEnvFile, decryptEnvFile };
