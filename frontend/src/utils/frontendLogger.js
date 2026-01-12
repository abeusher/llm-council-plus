/**
 * Frontend Logger - Captures browser errors, warnings, and fatal events
 * and sends them to the backend for logging to logs/frontend.log
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';

// Queue for batching log entries
let logQueue = [];
let flushTimeout = null;
const FLUSH_INTERVAL = 5000; // Flush every 5 seconds
const MAX_QUEUE_SIZE = 50; // Flush immediately if queue gets too large

/**
 * Send a log entry to the backend
 * @param {Object} entry - Log entry object
 */
async function sendLog(entry) {
  try {
    await fetch(`${API_BASE}/api/logs/frontend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(entry),
    });
  } catch (e) {
    // Silently fail - we don't want logging failures to cause more errors
    console.debug('[FrontendLogger] Failed to send log:', e);
  }
}

/**
 * Send queued log entries in batch
 */
async function flushQueue() {
  if (logQueue.length === 0) return;

  const entries = [...logQueue];
  logQueue = [];

  try {
    await fetch(`${API_BASE}/api/logs/frontend/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entries }),
    });
  } catch (e) {
    console.debug('[FrontendLogger] Failed to flush log queue:', e);
  }
}

/**
 * Queue a log entry for batched sending
 * @param {Object} entry - Log entry object
 */
function queueLog(entry) {
  logQueue.push(entry);

  // Flush immediately if queue is too large
  if (logQueue.length >= MAX_QUEUE_SIZE) {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    flushQueue();
    return;
  }

  // Schedule flush if not already scheduled
  if (!flushTimeout) {
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      flushQueue();
    }, FLUSH_INTERVAL);
  }
}

/**
 * Create a log entry object
 * @param {string} level - Log level (debug, info, warning, error, fatal)
 * @param {string} message - Log message
 * @param {Object} options - Additional options
 * @returns {Object} Log entry
 */
function createEntry(level, message, options = {}) {
  return {
    level,
    message: String(message).substring(0, 10000), // Limit message size
    timestamp: new Date().toISOString(),
    url: window.location.href,
    user_agent: navigator.userAgent,
    stack_trace: options.stackTrace || null,
    component: options.component || null,
    metadata: options.metadata || null,
  };
}

/**
 * Frontend Logger API
 */
export const frontendLogger = {
  debug(message, options = {}) {
    queueLog(createEntry('debug', message, options));
  },

  info(message, options = {}) {
    queueLog(createEntry('info', message, options));
  },

  warning(message, options = {}) {
    queueLog(createEntry('warning', message, options));
  },

  warn(message, options = {}) {
    this.warning(message, options);
  },

  error(message, options = {}) {
    // Errors are sent immediately, not queued
    sendLog(createEntry('error', message, options));
  },

  fatal(message, options = {}) {
    // Fatal errors are sent immediately
    sendLog(createEntry('fatal', message, options));
  },

  /**
   * Flush any queued logs immediately
   */
  flush() {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    return flushQueue();
  },
};

/**
 * Initialize global error handlers
 * Call this once at application startup
 */
export function initFrontendLogger() {
  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    frontendLogger.error(event.message || 'Unknown error', {
      stackTrace: event.error?.stack || null,
      component: 'window.onerror',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || String(event.reason) || 'Unhandled promise rejection';
    frontendLogger.error(message, {
      stackTrace: event.reason?.stack || null,
      component: 'unhandledrejection',
      metadata: {
        type: typeof event.reason,
      },
    });
  });

  // Intercept console.error to also log to backend
  const originalConsoleError = console.error;
  console.error = (...args) => {
    originalConsoleError.apply(console, args);

    // Convert args to message
    const message = args.map((arg) => {
      if (arg instanceof Error) {
        return arg.message;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Get stack trace if first arg is an Error
    const stackTrace = args[0] instanceof Error ? args[0].stack : null;

    frontendLogger.error(message, {
      stackTrace,
      component: 'console.error',
    });
  };

  // Intercept console.warn to also log to backend
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args);

    const message = args.map((arg) => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    frontendLogger.warning(message, {
      component: 'console.warn',
    });
  };

  // Flush logs before page unload
  window.addEventListener('beforeunload', () => {
    frontendLogger.flush();
  });

  // Also use visibilitychange for mobile browsers
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      frontendLogger.flush();
    }
  });

  frontendLogger.info('Frontend logger initialized', {
    component: 'FrontendLogger',
  });
}

export default frontendLogger;
