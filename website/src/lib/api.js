// lib/api.js
import { getAuthToken } from "./auth"
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

    const response = await fetch(`/api/${endpoint}`, {
        ...options,
        headers,
    });

    // Handle 401 (unauthorized) - token expired or invalid
    if (response.status === 401) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('permissions');
        window.location.href = '/login';
        throw new Error('Session expired, please login again');
    }

    return response;
};