// website/src/lib/logger.js
// Frontend logging service with context

/**
 * Log levels
 */
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

/**
 * Log level priorities (lower number = higher priority)
 */
const LOG_PRIORITIES = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Get current log level from localStorage or default to INFO
const getCurrentLogLevel = () => {
    return localStorage.getItem('logLevel') || 'INFO';
};

/**
 * Format timestamp for logs
 */
const getTimestamp = () => {
    return new Date().toISOString();
};

/**
 * Check if log should be output based on current level
 */
const shouldLog = (level) => {
    const currentLevel = getCurrentLogLevel();
    return LOG_PRIORITIES[level] <= LOG_PRIORITIES[currentLevel];
};

/**
 * Format log message with styling
 */
const formatLog = (level, message, context) => {
    const timestamp = getTimestamp();
    const styles = {
        ERROR: 'color: #ff4444; font-weight: bold;',
        WARN: 'color: #ffaa00; font-weight: bold;',
        INFO: 'color: #4444ff;',
        DEBUG: 'color: #888888;'
    };

    return {
        message: `[${timestamp}] [${level}] ${message}`,
        style: styles[level] || '',
        context
    };
};

/**
 * Log to console
 */
const logToConsole = (level, message, context = {}) => {
    if (!shouldLog(level)) return;

    const formatted = formatLog(level, message, context);

    if (Object.keys(context).length > 0) {
        console.log(`%c${formatted.message}`, formatted.style, '\nContext:', context);
    } else {
        console.log(`%c${formatted.message}`, formatted.style);
    }
};

/**
 * Logger class
 */
class Logger {
    constructor(module = 'app') {
        this.module = module;
    }

    _addModuleContext(context = {}) {
        return {
            module: this.module,
            timestamp: getTimestamp(),
            ...context
        };
    }

    error(message, context = {}) {
        logToConsole(LOG_LEVELS.ERROR, `[${this.module}] ${message}`, this._addModuleContext(context));
    }

    warn(message, context = {}) {
        logToConsole(LOG_LEVELS.WARN, `[${this.module}] ${message}`, this._addModuleContext(context));
    }

    info(message, context = {}) {
        logToConsole(LOG_LEVELS.INFO, `[${this.module}] ${message}`, this._addModuleContext(context));
    }

    debug(message, context = {}) {
        logToConsole(LOG_LEVELS.DEBUG, `[${this.module}] ${message}`, this._addModuleContext(context));
    }

    /**
     * Log user action (always logged at INFO level)
     */
    action(actionName, details = {}) {
        this.info(`User action: ${actionName}`, {
            action: actionName,
            ...details
        });
    }

    /**
     * Log API request
     */
    apiRequest(endpoint, method, details = {}) {
        this.debug(`API ${method} ${endpoint}`, {
            endpoint,
            method,
            ...details
        });
    }

    /**
     * Log API response
     */
    apiResponse(endpoint, status, details = {}) {
        const level = status >= 400 ? LOG_LEVELS.ERROR : LOG_LEVELS.DEBUG;
        const message = `API response ${status} from ${endpoint}`;

        if (level === LOG_LEVELS.ERROR) {
            this.error(message, { endpoint, status, ...details });
        } else {
            this.debug(message, { endpoint, status, ...details });
        }
    }

    /**
     * Log navigation
     */
    navigate(from, to) {
        this.info(`Navigation: ${from} → ${to}`, { from, to });
    }
}

/**
 * Create logger instance
 */
export const createLogger = (module) => {
    return new Logger(module);
};

/**
 * Set log level
 */
export const setLogLevel = (level) => {
    if (LOG_LEVELS[level]) {
        localStorage.setItem('logLevel', level);
    }
};

/**
 * Get log level
 */
export const getLogLevel = () => {
    return getCurrentLogLevel();
};

// Default logger
const defaultLogger = new Logger('app');

export default {
    createLogger,
    setLogLevel,
    getLogLevel,
    error: defaultLogger.error.bind(defaultLogger),
    warn: defaultLogger.warn.bind(defaultLogger),
    info: defaultLogger.info.bind(defaultLogger),
    debug: defaultLogger.debug.bind(defaultLogger),
    action: defaultLogger.action.bind(defaultLogger)
};
