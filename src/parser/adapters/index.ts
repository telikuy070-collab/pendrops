/**
 * Parser Adapter System - интерфейсы для плагинов парсера
 * Позволяет расширять функциональность парсера через систему адаптеров
 */

import type { FormatConfig } from '../types.js';

/**
 * Контекст выполнения парсера, передаваемый адаптерам
 */
export interface ParseContext {
  /** Рабочая книга (workbook) из xlsx */
  workbook: any;
  /** Конфигурация формата */
  config: FormatConfig;
  /** Имя текущего листа */
  currentSheet: string;
  /** Текущая строка (0-based) */
  row: number;
  /** Текущая колонка (0-based) */
  col: number;
  /** Дополнительные данные контекста */
  metadata?: Record<string, any>;
}

/**
 * Базовый интерфейс адаптера парсера
 */
export interface ParserAdapter {
  /** Уникальное имя адаптера */
  name: string;
  /** Версия адаптера (semver) */
  version: string;
  /** Инициализация адаптера с конфигурацией формата */
  initialize(config: FormatConfig): Promise<void>;
  /** Обработка данных адаптером */
  process(data: any, context: ParseContext): Promise<any>;
}

/**
 * Тип адаптера для категоризации
 */
export type AdapterType = 'classifier' | 'extractor' | 'reader' | 'scorer' | 'custom';

/**
 * Расширенный интерфейс адаптера с типом
 */
export interface TypedParserAdapter extends ParserAdapter {
  /** Тип адаптера */
  adapterType: AdapterType;
  /** Приоритет выполнения (чем выше, тем раньше выполняется) */
  priority?: number;
}

/**
 * Фабрика для создания адаптеров
 */
export interface AdapterFactory<T extends ParserAdapter = ParserAdapter> {
  /** Создает экземпляр адаптера */
  create(config?: any): T;
  /** Имя адаптера, который создает эта фабрика */
  adapterName: string;
}

/**
 * Результат выполнения адаптера
 */
export interface AdapterResult<T = any> {
  /** Успешность выполнения */
  success: boolean;
  /** Данные результата */
  data?: T;
  /** Ошибка, если выполнение неуспешное */
  error?: Error;
  /** Время выполнения в мс */
  durationMs: number;
  /** Имя адаптера */
  adapterName: string;
}

export type { FormatConfig } from '../types.js';