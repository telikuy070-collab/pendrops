/**
 * Structured Logger with Sentry Integration
 * Provides consistent logging across the application with error telemetry
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: Error;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error) {
    const entry: LogEntry = { level, message, timestamp: new Date().toISOString(), context, error };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();

    // Console output
    const prefix = `[${level.toUpperCase()}]`;
    console[level](`${prefix} ${message}`, context || '', error || '');

    // Send to Sentry if configured
    if (import.meta.env.VITE_SENTRY_DSN && level === 'error') {
      // Dynamic import to avoid bundling Sentry when not needed
      // @ts-expect-error - runtime import from CDN
      import('https://esm.sh/@sentry/browser@8').then((Sentry: any) => {
        Sentry.captureException(error || new Error(message), { extra: context });
      }).catch(() => {});
    }
  }

  debug(message: string, context?: Record<string, unknown>) { this.log('debug', message, context); }
  info(message: string, context?: Record<string, unknown>) { this.log('info', message, context); }
  warn(message: string, context?: Record<string, unknown>) { this.log('warn', message, context); }
  error(message: string, context?: Record<string, unknown>, error?: Error) { this.log('error', message, context, error); }

  /** Get recent logs for debugging */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /** Clear log buffer */
  clear(): void {
    this.logs = [];
  }
}

export const logger = new Logger();