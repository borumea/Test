// server/middleware/rateLimiter.js
// Rate limiting middleware to prevent abuse

const rateLimit = require('express-rate-limit');
const securityConfig = require('../Config/security');

/**
 * General rate limiter for all API endpoints
 */
const generalLimiter = rateLimit({
    windowMs: securityConfig.rateLimit.windowMs,
    max: securityConfig.rateLimit.maxRequests,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Stricter rate limiter for authentication endpoints
 */
const authLimiter = rateLimit({
    windowMs: securityConfig.rateLimitAuth.windowMs,
    max: securityConfig.rateLimitAuth.maxRequests,
    message: { error: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // don't count successful logins
});

module.exports = {
    generalLimiter,
    authLimiter,
};