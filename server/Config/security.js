// server/config/security.js
// Security configuration for the API

module.exports = {
    jwt: {
        secret: process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h', // Changed from 5s to 24h for proper session management
        issuer: 'SQL Interactinator',
        audience: 'web',
    },

    bcrypt: {
        saltRounds: 10,
    },

    rateLimit: {
        windowMs: 1 * 60 * 1000, // 1 minute
        maxRequests: 100, // Changed from 60000 to 100 - reasonable limit for general API requests
    },

    rateLimitAuth: {
        windowMs: 15 * 60 * 1000, // Changed to 15 minutes for better brute force protection
        maxRequests: 5, // Changed from 50000 to 5 - prevents brute force attacks on login
    },

    cors: {
        // Allow multiple origins: localhost and environment-specified origin
        origin: function (origin, callback) {
            const allowedOrigins = [
                'http://localhost:3000',
                process.env.CORS_ORIGIN
            ].filter(Boolean); // Remove undefined values

            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

            if (allowedOrigins.indexOf(origin) !== -1 || process.env.CORS_ALLOW_ALL === 'true') {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    },
};