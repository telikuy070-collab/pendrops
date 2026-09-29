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

    // Maintains proper stack trace in V8 environments without requiring Node typings.
    const captureStackTrace = (
      Error as ErrorConstructor & {
        captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void;
      }
    ).captureStackTrace;
    captureStackTrace?.(this, this.constructor);
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

/**
 * The admin stopped a chunked publish between two requests.
 *
 * Not a failure and not retryable: the rows the database already accepted stay
 * there, and the previous schedule was deliberately *not* deleted, so the app
 * shows the old rows plus whatever the aborted run had already inserted. The
 * next full publish removes them, because it deletes on a strict `<` cursor and
 * the leftovers are older than its own timestamp.
 */
export class PublishAbortedError extends AppError {
  constructor(
    public readonly uploaded: number,
    public readonly total: number
  ) {
    super(
      'PUBLISH_ABORTED',
      `Публикация остановлена: загружено ${uploaded} из ${total}. Загруженная часть осталась в базе — опубликуйте файл заново целиком, чтобы убрать её.`,
      false
    );
  }
}

/**
 * A paged read came back short.
 *
 * PostgREST caps every response at its `max-rows` setting, so a read that asks
 * for no explicit range silently stops at that cap: 1000 of 1237 lessons, with
 * no error and no signal that anything is missing. The repository therefore
 * pages explicitly and compares what it collected against the exact count the
 * server reports; a shortfall is reported here rather than shown to the student
 * as a schedule with days and lessons missing.
 *
 * Retryable: the usual cause is a publish that replaced the table while the
 * pages were being read, which makes the snapshot inconsistent rather than
 * the schedule itself broken.
 */
export class TruncatedScheduleReadError extends AppError {
  constructor(
    public readonly received: number,
    /** Rows the server counted, or null when it reported no count at all. */
    public readonly expected: number | null
  ) {
    super(
      'SCHEDULE_TRUNCATED',
      expected === null
        ? `Расписание загружено не полностью: получено ${received} строк, а сервер не сообщил их общее количество. Обновите страницу.`
        : `Расписание загружено не полностью: получено ${received} строк из ${expected}. Обновите страницу.`,
      true
    );
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
