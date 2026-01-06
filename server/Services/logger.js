// server/Services/logger.js
// Structured logging service for the application

/**
 * ANSI color codes for terminal output
 */
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
};

/**
 * Colorize text with ANSI codes
 */
function colorize(text, color) {
    return `${color}${text}${colors.reset}`;
}

/**
 * Log levels with colors and priorities
 */
const LOG_LEVELS = {
    ERROR: { priority: 0, color: colors.red, label: 'ERROR' },
    WARN: { priority: 1, color: colors.yellow, label: 'WARN ' },
    INFO: { priority: 2, color: colors.blue, label: 'INFO ' },
    DEBUG: { priority: 3, color: colors.gray, label: 'DEBUG' },
};

/**
 * Get current log level from environment (defaults to INFO)
 */
const currentLogLevel = process.env.LOG_LEVEL || 'INFO';
const currentPriority = LOG_LEVELS[currentLogLevel]?.priority ?? LOG_LEVELS.INFO.priority;

/**
 * Format timestamp
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString();
}

/**
 * Format log message with context
 */
function formatMessage(level, message, context = {}) {
    const timestamp = getTimestamp();
    const levelConfig = LOG_LEVELS[level] || LOG_LEVELS.INFO;

    // Build base message
    let output = `[${timestamp}] ${colorize(levelConfig.label, levelConfig.color)} ${message}`;

    // Add context if provided
    if (Object.keys(context).length > 0) {
        const contextStr = JSON.stringify(context, null, 2);
        output += `\n${colorize('Context:', colors.gray)} ${contextStr}`;
    }

    return output;
}

/**
 * Log function that respects log level priority
 */
function log(level, message, context = {}) {
    const levelConfig = LOG_LEVELS[level];
    if (!levelConfig || levelConfig.priority > currentPriority) {
        return; // Skip if level is below current threshold
    }

    const formatted = formatMessage(level, message, context);

    // Output to appropriate stream
    if (level === 'ERROR') {
        console.error(formatted);
    } else if (level === 'WARN') {
        console.warn(formatted);
    } else {
        console.log(formatted);
    }
}

/**
 * Logger class with convenient methods
 */
class Logger {
    constructor(module = 'app') {
        this.module = module;
    }

    /**
     * Add module context to log entries
     */
    _withModule(context = {}) {
        return { module: this.module, ...context };
    }

    /**
     * Log error message
     */
    error(message, context = {}) {
        log('ERROR', message, this._withModule(context));
    }

    /**
     * Log warning message
     */
    warn(message, context = {}) {
        log('WARN', message, this._withModule(context));
    }

    /**
     * Log info message
     */
    info(message, context = {}) {
        log('INFO', message, this._withModule(context));
    }

    /**
     * Log debug message
     */
    debug(message, context = {}) {
        log('DEBUG', message, this._withModule(context));
    }

    /**
     * Log with custom level
     */
    log(level, message, context = {}) {
        log(level, message, this._withModule(context));
    }
}

/**
 * Create logger instance for a module
 */
function createLogger(module) {
    return new Logger(module);
}

// Default logger instance
const defaultLogger = new Logger('app');

module.exports = {
    createLogger,
    Logger,
    error: defaultLogger.error.bind(defaultLogger),
    warn: defaultLogger.warn.bind(defaultLogger),
    info: defaultLogger.info.bind(defaultLogger),
    debug: defaultLogger.debug.bind(defaultLogger),
    log: defaultLogger.log.bind(defaultLogger),
};
