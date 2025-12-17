/**
 * UX Helper utilities for improved user experience
 */

/**
 * Export data to CSV file
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Name of the file (without extension)
 */
export function exportToCSV(data, filename = 'export') {
    if (!data || data.length === 0) {
        alert('No data to export');
        return;
    }

    // Get all unique keys from all objects
    const allKeys = new Set();
    data.forEach(row => {
        Object.keys(row).forEach(key => allKeys.add(key));
    });
    const headers = Array.from(allKeys);

    // Create CSV content
    const csvContent = [
        // Header row
        headers.map(h => `"${h}"`).join(','),
        // Data rows
        ...data.map(row =>
            headers.map(header => {
                const value = row[header];
                // Handle nulls, numbers, and strings
                if (value === null || value === undefined) return '""';
                if (typeof value === 'object') return `"${JSON.stringify(value)}"`;
                // Escape quotes in strings
                return `"${String(value).replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with fallback
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
export async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        }
    } catch (err) {
        console.error('Copy failed:', err);
        return false;
    }
}

/**
 * Show a temporary toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of notification ('success', 'error', 'info', 'warning')
 * @param {number} duration - Duration in milliseconds
 */
export function showToast(message, type = 'info', duration = 3000) {
    // Remove any existing toasts
    const existingToast = document.getElementById('ux-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'ux-toast';
    toast.className = `ux-toast ux-toast-${type}`;
    toast.textContent = message;

    // Add styles if not already present
    if (!document.getElementById('ux-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'ux-toast-styles';
        style.textContent = `
            .ux-toast {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 6px;
                background: #333;
                color: white;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
                max-width: 400px;
            }
            .ux-toast-success { background: #10B981; }
            .ux-toast-error { background: #EF4444; }
            .ux-toast-warning { background: #F59E0B; }
            .ux-toast-info { background: #3B82F6; }
            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(400px); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Debounce function to limit rapid function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted size
 */
export function formatFileSize(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Setup keyboard shortcuts
 * @param {Object} shortcuts - Map of key combinations to handlers
 * @returns {Function} - Cleanup function
 *
 * Example:
 * const cleanup = setupKeyboardShortcuts({
 *   'ctrl+s': (e) => { e.preventDefault(); saveForm(); },
 *   'escape': () => closeModal(),
 *   'ctrl+k': (e) => { e.preventDefault(); openSearch(); }
 * });
 */
export function setupKeyboardShortcuts(shortcuts) {
    const handler = (e) => {
        const key = [
            e.ctrlKey && 'ctrl',
            e.shiftKey && 'shift',
            e.altKey && 'alt',
            e.metaKey && 'meta',
            e.key.toLowerCase()
        ].filter(Boolean).join('+');

        const callback = shortcuts[key];
        if (callback) {
            callback(e);
        }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}

/**
 * Confirm action with user
 * @param {string} message - Confirmation message
 * @param {string} title - Dialog title
 * @returns {Promise<boolean>} - User's choice
 */
export function confirmAction(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const confirmed = window.confirm(`${title}\n\n${message}`);
        resolve(confirmed);
    });
}

/**
 * Get column statistics for numeric columns
 * @param {Array} data - Array of row objects
 * @param {string} columnName - Column to analyze
 * @returns {Object} - Statistics (sum, avg, min, max, count)
 */
export function getColumnStats(data, columnName) {
    const values = data
        .map(row => row[columnName])
        .filter(val => val !== null && val !== undefined && !isNaN(val))
        .map(Number);

    if (values.length === 0) {
        return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }

    return {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values)
    };
}
