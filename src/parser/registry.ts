/**
 * FormatRegistry — реестр форматов парсера.
 * Управляет регистрацией, загрузкой и получением конфигураций форматов.
 */
import type { FormatConfig } from './types.js';

/**
 * Класс реестра форматов.
 * Хранит конфигурации форматов в Map для быстрого доступа.
 */
export class FormatRegistry {
  #formats = new Map<string, FormatConfig>();
  #defaultFormatId: string | null = null;

  /**
   * Регистрирует формат в реестре.
   * @param config - Конфигурация формата
   * @throws {Error} если формат с таким formatId уже зарегистрирован
   */
  register(config: FormatConfig): void {
    if (this.#formats.has(config.formatId)) {
      throw new Error(`Format with id "${config.formatId}" is already registered`);
    }
    this.#formats.set(config.formatId, config);

    // Первый зарегистрированный формат становится дефолтным, если не задан явно
    if (this.#defaultFormatId === null) {
      this.#defaultFormatId = config.formatId;
    }
  }

  /**
   * Регистрирует формат, перезаписывая существующий (для тестов/переопределения).
   * @param config - Конфигурация формата
   */
  registerOrReplace(config: FormatConfig): void {
    this.#formats.set(config.formatId, config);
    if (this.#defaultFormatId === null) {
      this.#defaultFormatId = config.formatId;
    }
  }

  /**
   * Получает формат по ID.
   * @param formatId - Идентификатор формата
   * @returns Конфигурация формата или undefined, если не найден
   */
  get(formatId: string): FormatConfig | undefined {
    return this.#formats.get(formatId);
  }

  /**
   * Возвращает все зарегистрированные форматы.
   * @returns Массив конфигураций форматов
   */
  getAll(): FormatConfig[] {
    return Array.from(this.#formats.values());
  }

  /**
   * Возвращает дефолтный формат.
   * @returns Конфигурация дефолтного формата
   * @throws {Error} если дефолтный формат не установлен
   */
  getDefault(): FormatConfig {
    if (this.#defaultFormatId === null) {
      throw new Error('No default format registered');
    }
    const format = this.#formats.get(this.#defaultFormatId);
    if (!format) {
      throw new Error(`Default format "${this.#defaultFormatId}" not found`);
    }
    return format;
  }

  /**
   * Устанавливает дефолтный формат.
   * @param formatId - Идентификатор формата для установки как дефолтного
   * @throws {Error} если формат не найден
   */
  setDefault(formatId: string): void {
    if (!this.#formats.has(formatId)) {
      throw new Error(`Format "${formatId}" not found`);
    }
    this.#defaultFormatId = formatId;
  }

  /**
   * Проверяет, зарегистрирован ли формат.
   * @param formatId - Идентификатор формата
   * @returns true если формат зарегистрирован
   */
  has(formatId: string): boolean {
    return this.#formats.has(formatId);
  }

  /**
   * Удаляет формат из реестра.
   * @param formatId - Идентификатор формата
   * @returns true если формат был удален
   */
  delete(formatId: string): boolean {
    const deleted = this.#formats.delete(formatId);
    if (deleted && this.#defaultFormatId === formatId) {
      // Если удалили дефолтный, сбрасываем на первый доступный или null
      this.#defaultFormatId = this.#formats.keys().next().value ?? null;
    }
    return deleted;
  }

  /**
   * Очищает реестр.
   */
  clear(): void {
    this.#formats.clear();
    this.#defaultFormatId = null;
  }

  /**
   * Возвращает количество зарегистрированных форматов.
   */
  get size(): number {
    return this.#formats.size;
  }

  /**
   * Возвращает ID дефолтного формата.
   */
  get defaultFormatId(): string | null {
    return this.#defaultFormatId;
  }
}

/**
 * Глобальный синглтон реестра для удобства использования.
 */
export const formatRegistry = new FormatRegistry();

export default FormatRegistry;