/**
 * Error Collector - сбор ошибок парсинга для обучения и анализа
 * Позволяет отслеживать паттерны ошибок и улучшать парсер
 */

export interface ParseError {
  /** Уникальный ID ошибки */
  id: string;
  /** Тип ошибки */
  type: 'parse' | 'validation' | 'extraction' | 'classification' | 'fallback';
  /** Сообщение ошибки */
  message: string;
  /** Контекст: сырые данные, которые вызвали ошибку */
  context: {
    rawText?: string;
    rowIndex?: number;
    colIndex?: number;
    sheetName?: string;
    parserStage?: 'main' | 'simple' | 'raw';
    lessonData?: Record<string, unknown>;
  };
  /** Stack trace если есть */
  stack?: string;
  /** Время возникновения */
  timestamp: number;
  /** Дополнительные метаданные */
  meta?: Record<string, unknown>;
}

export interface ErrorPattern {
  /** Паттерн ошибки (нормализованное сообщение) */
  pattern: string;
  /** Количество вхождений */
  count: number;
  /** Примеры контекстов */
  examples: ParseError[];
  /** Последнее появление */
  lastSeen: number;
  /** Тип ошибки */
  type: ParseError['type'];
}

export interface ErrorCollectorConfig {
  /** Максимальное количество хранимых ошибок */
  maxErrors?: number;
  /** Максимальное количество примеров на паттерн */
  maxExamplesPerPattern?: number;
  /** Колбэк при добавлении ошибки */
  onError?: (error: ParseError) => void;
}

/**
 * Коллектор ошибок парсинга с анализом паттернов
 */
export class ErrorCollector {
  private errors: ParseError[] = [];
  private patterns: Map<string, ErrorPattern> = new Map();
  private config: Required<ErrorCollectorConfig>;
  private errorIdCounter = 0;

  constructor(config: ErrorCollectorConfig = {}) {
    this.config = {
      maxErrors: config.maxErrors ?? 1000,
      maxExamplesPerPattern: config.maxExamplesPerPattern ?? 5,
      onError: config.onError ?? (() => {}),
    };
  }

  /**
   * Генерирует уникальный ID для ошибки
   */
  private generateId(): string {
    return `err_${Date.now()}_${++this.errorIdCounter}`;
  }

  /**
   * Нормализует паттерны комнат/аудиторий в сообщении
   * Обрабатывает варианты: №7 корпус 315, № 7 корпус 315, ауд. 123, аудитория 123, каб. 123
   */
  private normalizeRoomPattern(message: string): string {
    return message
      // №7 корпус 315, № 7 корпус 315, №7корпус315
      .replace(/№\s*\d+\s*(?:корп\.?|корпус)\s*\d+/gi, '<ROOM>')
      // ауд. 123, ауд 123, аудитория 123
      .replace(/ауд\.?\s*\d+/gi, '<ROOM>')
      .replace(/аудитория\s+\d+/gi, '<ROOM>')
      // каб. 123, каб 123, кабинет 123
      .replace(/каб\.?\s*\d+/gi, '<ROOM>')
      .replace(/кабинет\s+\d+/gi, '<ROOM>');
  }

/**
   * Нормализует сообщение ошибки для группировки в паттерны
   */
  private normalizeErrorMessage(message: string): string {
    return message
      // Сначала специфичные паттерны (с цифрами), потом общие
      .replace(/[А-ЯA-Z]{2,}-\d-\d{2}/g, '<GROUP>')
      .replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?/g, '<TEACHER>')
      // Room patterns: handle optional spaces after №, support корп./корпус/корп
      .replace(/№\s*\d+\s*(?:корп\.?|корпус)\s*\d+/g, '<ROOM>')
      .replace(/ауд\.?\s*\d+/gi, '<ROOM>')
      // Общая замена чисел в конце
      .replace(/\d+/g, '<NUM>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Записывает ошибку
   */
  record(error: Error | string, context: (ParseError['context'] & { meta?: Record<string, unknown> }) = {}): ParseError {
    const errorObj: ParseError = {
      id: this.generateId(),
      type: context.parserStage ? (context.parserStage === 'main' ? 'parse' : 'fallback') : 'parse',
      message: error instanceof Error ? error.message : String(error),
      context,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: Date.now(),
      meta: context.meta,
    };

    // Добавляем в общий список
    this.errors.push(errorObj);

    // Ограничиваем размер
    if (this.errors.length > this.config.maxErrors) {
      this.errors.shift();
    }

    // Обновляем паттерны
    this.updatePattern(errorObj);

    // Вызываем колбэк
    this.config.onError(errorObj);

    return errorObj;
  }

  /**
   * Обновляет статистику паттернов
   */
  private updatePattern(error: ParseError): void {
    const patternKey = this.normalizeErrorMessage(error.message);
    const existing = this.patterns.get(patternKey);

    if (existing) {
      existing.count++;
      existing.lastSeen = error.timestamp;
      if (existing.examples.length < this.config.maxExamplesPerPattern) {
        existing.examples.push(error);
      }
    } else {
      this.patterns.set(patternKey, {
        pattern: patternKey,
        count: 1,
        examples: [error],
        lastSeen: error.timestamp,
        type: error.type,
      });
    }
  }

  /**
   * Возвращает все ошибки
   */
  getErrors(): ParseError[] {
    return [...this.errors];
  }

  /**
   * Возвращает ошибки по типу
   */
  getErrorsByType(type: ParseError['type']): ParseError[] {
    return this.errors.filter((e) => e.type === type);
  }

  /**
   * Возвращает последние N ошибок
   */
  getRecentErrors(limit: number = 50): ParseError[] {
    return this.errors.slice(-limit);
  }

  /**
   * Возвращает частые паттерны ошибок для анализа
   */
  getPatterns(minCount: number = 2): ErrorPattern[] {
    return Array.from(this.patterns.values())
      .filter((p) => p.count >= minCount)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Возвращает топ-N самых частых паттернов
   */
  getTopPatterns(limit: number = 10): ErrorPattern[] {
    return this.getPatterns().slice(0, limit);
  }

  /**
   * Возвращает статистику по типам ошибок
   */
  getStats(): Record<ParseError['type'], number> {
    const stats: Record<ParseError['type'], number> = {
      parse: 0,
      validation: 0,
      extraction: 0,
      classification: 0,
      fallback: 0,
    };

    for (const error of this.errors) {
      stats[error.type]++;
    }

    return stats;
  }

  /**
   * Очищает все ошибки и паттерны
   */
  clear(): void {
    this.errors = [];
    this.patterns.clear();
    this.errorIdCounter = 0;
  }

  /**
   * Экспортирует ошибки для анализа/обучения
   */
  export(): {
    errors: ParseError[];
    patterns: ErrorPattern[];
    stats: Record<ParseError['type'], number>;
    exportedAt: number;
  } {
    return {
      errors: this.getErrors(),
      patterns: this.getPatterns(),
      stats: this.getStats(),
      exportedAt: Date.now(),
    };
  }

  /**
   * Импортирует ошибки (например, из сохраненного состояния)
   */
  import(data: { errors: ParseError[]; patterns?: ErrorPattern[] }): void {
    if (data.errors) {
      this.errors = data.errors.slice(-this.config.maxErrors);
      this.errorIdCounter = this.errors.length;
    }
    if (data.patterns) {
      this.patterns.clear();
      for (const pattern of data.patterns) {
        this.patterns.set(pattern.pattern, pattern);
      }
    }
  }
}

/**
 * Singleton instance для удобства использования
 */
export const errorCollector = new ErrorCollector();

/**
 * Удобная функция для записи ошибки с контекстом парсера
 */
export function logParseError(
  error: Error | string,
  context: {
    rawText?: string;
    rowIndex?: number;
    colIndex?: number;
    sheetName?: string;
    parserStage?: 'main' | 'simple' | 'raw';
    lessonData?: Record<string, unknown>;
  } = {}
): ParseError {
  return errorCollector.record(error, context);
}

export { ErrorCollector as default };