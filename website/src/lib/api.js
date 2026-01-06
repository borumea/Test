// lib/api.js
import { getAuthToken } from "./auth";
import { createLogger } from "./logger";

const logger = createLogger('api');

export const apiRequest = async (endpoint, options = {}) => {
    const token = getAuthToken();

    const headers = {
        ...options.headers,
    };

    // Add JWT token to Authorization header
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Add Content-Type for JSON requests
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }

    logger.apiRequest(endpoint, options.method || 'GET', {
        hasToken: !!token,
        hasBody: !!options.body
    });

    try {
        const response = await fetch(`/api/${endpoint}`, {
            ...options,
            headers,
        });

        logger.apiResponse(endpoint, response.status, {
            ok: response.ok,
            method: options.method || 'GET'
        });

        // Handle 401 (unauthorized) or 403 (forbidden) - token expired or invalid
        if (response.status === 401 || response.status === 403) {
            // Check if it's a token expiration error
            const errorData = await response.json().catch(() => ({ error: 'Unauthorized' }));

            if (errorData.error && (
                errorData.error.includes('token') ||
                errorData.error.includes('expired') ||
                errorData.error.includes('Access token required')
            )) {
                logger.warn('Token expired or invalid, logging out user', {
                    endpoint,
                    status: response.status,
                    error: errorData.error
                });

                // Clear all authentication data
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
                localStorage.removeItem('permissions');
                localStorage.removeItem('app_current_user');
                localStorage.removeItem('allowedPermissions');

                // Redirect to login
                window.location.href = '/login';
                throw new Error('Session expired, please login again');
            }

            logger.debug('Non-token 403/401 error', {
                endpoint,
                error: errorData.error
            });

            // If not token-related, return the response for normal handling
            return new Response(JSON.stringify(errorData), {
                status: response.status,
                headers: response.headers
            });
        }

        return response;
    } catch (error) {
        logger.error('API request failed', {
            endpoint,
            method: options.method || 'GET',
            error: error.message
        });
        throw error;
    }
};