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
        maxRequests: 100, // Seems like a reasonable limit for general API requests
    },

    rateLimitAuth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5, // prevents brute force attacks on login
    },

    cors: {
        // CORS origin configuration
        // In development: allows localhost:3000 or custom CORS_ORIGIN
        // Use CORS_ALLOW_ALL=true to allow all origins (dev only)
        origin: process.env.CORS_ALLOW_ALL === 'true'
            ? true  // Allow all origins
            : (process.env.CORS_ORIGIN || 'http://localhost:3000'), // Specific origin(s)
        credentials: true,
    },
};