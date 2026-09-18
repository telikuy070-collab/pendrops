/**
 * Unified Error Taxonomy for PenDrops
 * Provides structured error handling with retry logic support
 */

export abstract class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(userMessage);
    this.name = this.constructor.name;
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NetworkError extends AppError {
  constructor(message: string, cause?: Error) {
    super('NETWORK_ERROR', 'Проблема с сетью. Проверьте подключение.', true, cause);
  }
}

export class AuthError extends AppError {
  constructor(message: string, cause?: Error) {
    super('AUTH_ERROR', 'Ошибка авторизации. Войдите снова.', false, cause);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: Error) {
    super('VALIDATION_ERROR', message, false, cause);
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: Error) {
    super('STORAGE_ERROR', 'Ошибка сохранения данных.', true, cause);
  }
}

export class ParseError extends AppError {
  constructor(message: string, cause?: Error) {
    super('PARSE_ERROR', 'Ошибка чтения файла расписания.', false, cause);
  }
}

export class UnknownError extends AppError {
  constructor(message: string, cause?: Error) {
    super('UNKNOWN_ERROR', message, false, cause);
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converts any error to an AppError instance
 * Preserves original error as cause for debugging
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    // Detect network-related errors
    const msg = error.message.toLowerCase();
    if (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('connection') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket')
    ) {
      return new NetworkError(error.message, error);
    }
    // Detect auth-related errors
    if (
      msg.includes('unauthorized') ||
      msg.includes('authentication') ||
      msg.includes('jwt') ||
      msg.includes('token') ||
      msg.includes('401') ||
      msg.includes('403')
    ) {
      return new AuthError(error.message, error);
    }
    // Detect validation errors
    if (
      msg.includes('validation') ||
      msg.includes('invalid') ||
      msg.includes('constraint') ||
      msg.includes('400')
    ) {
      return new ValidationError(error.message, error);
    }
    // Detect storage errors
    if (
      msg.includes('storage') ||
      msg.includes('quota') ||
      msg.includes('indexeddb') ||
      msg.includes('localstorage')
    ) {
      return new StorageError(error.message, error);
    }
    // Detect parse errors
    if (
      msg.includes('parse') ||
      msg.includes('syntax') ||
      msg.includes('json') ||
      msg.includes('xlsx') ||
      msg.includes('workbook')
    ) {
      return new ParseError(error.message, error);
    }
    return new UnknownError(error.message, error);
  }
  // Non-Error values (strings, null, undefined, objects)
  return new UnknownError(String(error), undefined);
}