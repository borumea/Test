// src/lib/auth.js
// Small auth helper using the API endpoints added on the server.
// Stores currentUser in localStorage under 'app_current_user'

import { apiRequest } from './api';
import { createLogger } from './logger';

const logger = createLogger('auth');
const STORAGE_KEY = 'app_current_user';

export function getStoredUser() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

export function getAuthToken() {
    return localStorage.getItem('authToken');
}

export function storeUser(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    localStorage.removeItem('permissions');
}

export async function login(username, password) {
    logger.info('Login attempt', { username });

    try {
        const res = await fetch(`/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            logger.warn('Login failed', {
                username,
                status: res.status,
                error: err.error
            });
            throw new Error(err.error || 'Login failed');
        }

        const data = await res.json();

        // Store the JWT token
        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('permissions', JSON.stringify(data.permissions));

            logger.info('Login successful', {
                username: data.username,
                firstTimeLogin: data.first_time_login,
                permissionCount: Object.keys(data.permissions || {}).length
            });
        }

        // Store user info (username, permissions, first_time_login)
        const user = {
            username: data.username,
            permissions: data.permissions || {},
            first_time_login: data.first_time_login || 0,
        };
        storeUser(user);
        return user;
    } catch (error) {
        logger.error('Login error', {
            username,
            error: error.message
        });
        throw error;
    }
}

export async function changePassword(username, newPassword) {
    const res = await fetch(`/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, newPassword }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Change password failed');
    }
    // update stored user first_time_login
    const user = getStoredUser();
    if (user && user.username === username) {
        user.first_time_login = 0;
        storeUser(user);
    }
    return true;
}

/**
 * creatorUsername must be the currently logged-in username (frontend should pass it).
 * optionalPermissions is an object { colName: 0/1, ... } - keys will be used if those columns exist.
 */
export async function createUser(creatorUsername, username, oneTimePassword, optionalPermissions) {
    const res = await fetch(`/api/auth/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorUsername, username, oneTimePassword, optionalPermissions }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Create user failed');
    }
    const payload = await res.json();
    return payload;
}

// Logout function
export const logout = () => {
    const username = localStorage.getItem('username');
    logger.info('User logout', { username });
    clearStoredUser();
    window.location.href = '/login';
};

// Check if user is authenticated
export const isAuthenticated = () => {
    return !!localStorage.getItem('authToken');
};

// Refresh JWT token
export async function refreshToken() {
    const token = getAuthToken();
    if (!token) {
        logger.error('Refresh token failed: No token available');
        throw new Error('No token to refresh');
    }

    logger.info('Refreshing JWT token');

    try {
        const res = await fetch(`/api/auth/refresh-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            logger.error('Token refresh failed', {
                status: res.status,
                error: err.error
            });
            throw new Error(err.error || 'Token refresh failed');
        }

        const data = await res.json();

        // Update stored token and user data
        if (data.success && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('permissions', JSON.stringify(data.permissions));

            // Update user object as well
            const user = getStoredUser();
            if (user) {
                user.permissions = data.permissions;
                storeUser(user);
            }

            logger.info('Token refreshed successfully', {
                username: data.username
            });
        }

        return data;
    } catch (error) {
        logger.error('Token refresh error', { error: error.message });
        throw error;
    }
}

// --- Forgot / Reset password helper functions ---
export async function forgotPassword(username) {
    const res = await fetch(`/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed');
    }
    return await res.json();
}

export async function verifyResetToken(username, token) {
    const res = await fetch(`/api/auth/verify-reset-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, token })
    });
    return await res.json();
}

export async function resetPassword(username, token, newPassword) {
    const res = await fetch(`/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, token, newPassword })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed');
    }
    return await res.json();
}
