// server/config/security.js
// Security configuration for the API

module.exports = {
    jwt: {
        secret: process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION',
        expiresIn: '5s',
        issuer: 'SQL Interactinator',
        audience: 'web',
    },

    bcrypt: {
        saltRounds: 10,
    },

    rateLimit: {
        windowMs: 1 * 60 * 1000, // 1 minute
        maxRequests: 60000, // Limit each IP to 60 requests per windowMs
    },

    rateLimitAuth: {
        windowMs: 1 * 60 * 1000, // 1 minute
        maxRequests: 50000, // Limit for auth endpoints
    },

    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true,
    },
};