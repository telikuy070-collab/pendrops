/**
 * FormatConfig — JSON Schema для конфигурации форматов парсера.
 * Валидируется через Zod.
 */
import { z } from 'zod';

/**
 * Конфигурация детекции формата
 */
export const DetectionConfigSchema = z.object({
  /** Ключевые слова для поиска заголовка расписания */
  headerKeywords: z.array(z.string()).min(1, 'At least one header keyword required'),
  /** Минимальный номер строки для поиска заголовка (0-based) */
  minHeaderRow: z.number().int().min(0).default(0),
  /** Максимальный номер строки для поиска заголовка (0-based) */
  maxHeaderRow: z.number().int().min(0).default(30),
  /** Обязательные колонки, которые должны присутствовать в заголовке */
  requiredColumns: z.array(z.string()).default([]),
});

/**
 * Конфигурация структуры таблицы
 */
export const StructureConfigSchema = z.object({
  header: z.object({
    /** Колонка с днями недели: 'auto' для автодетекта или номер колонки */
    dayColumn: z.union([z.literal('auto'), z.number().int().min(0)]).default('auto'),
    /** Колонка с номерами пар: 'auto' или номер колонки */
    paraColumn: z.union([z.literal('auto'), z.number().int().min(0)]).default('auto'),
    /** Колонка со временем: 'auto' или номер колонки */
    timeColumn: z.union([z.literal('auto'), z.number().int().min(0)]).default('auto'),
    /** Начальная колонка групп: 'auto' или номер колонки */
    groupColumnsStart: z.union([z.literal('auto'), z.number().int().min(0)]).default('auto'),
    /** Регулярное выражение для кода группы */
    groupCodePattern: z.string().default('^[А-ЯA-Z]{2,3}-\\d-\\d{2}'),
  }),
  /** Названия дней недели в разных языках/локалях */
  dayNames: z.record(z.string(), z.array(z.string())).default({}),
  /** Формат времени (например, "HH:MM-HH:MM" или "HH:MM") */
  timeFormat: z.string().default('HH:MM-HH:MM'),
  /** Формат номера пары (например, "1", "1 пара", "Пара 1") */
  paraFormat: z.string().default('\\d+'),
});

/**
 * Конфигурация парсинга
 */
export const ParsingConfigSchema = z.object({
  /** Пропускать пустые строки */
  skipEmptyRows: z.boolean().default(true),
  /** Пропускать пустые колонки */
  skipEmptyColumns: z.boolean().default(true),
  /** Стратегия обработки объединённых ячеек */
  mergedCellsStrategy: z.enum(['fill_down', 'ignore']).default('fill_down'),
  /** Разделитель подгрупп в ячейке */
  subgroupSeparator: z.string().default('/'),
  /** Подгруппа указана в коде группы (например, "СЖ-1-25 (1)") */
  subgroupInGroupCode: z.boolean().default(true),
  /** Паттерн для извлечения подгруппы из кода группы */
  subgroupPattern: z.string().default('\\((\\d+)\\)'),
});

/**
 * Конфигурация трансформации данных
 */
export const TransformConfigSchema = z.object({
  /** Тип трансформации */
  type: z.string(),
  /** Параметры трансформации */
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Полная конфигурация формата
 */
export const FormatConfigSchema = z.object({
  /** Уникальный идентификатор формата */
  formatId: z.string().min(1, 'formatId is required'),
  /** Человекочитаемое название формата */
  name: z.string().min(1, 'name is required'),
  /** Версия формата (semver) */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  /** Конфигурация детекции */
  detection: DetectionConfigSchema,
  /** Конфигурация структуры */
  structure: StructureConfigSchema,
  /** Конфигурация парсинга */
  parsing: ParsingConfigSchema,
  /** Массив трансформаций */
  transforms: z.array(TransformConfigSchema).default([]),
});

/** Тип конфигурации формата (инференс из Zod схемы) */
export type FormatConfig = z.infer<typeof FormatConfigSchema>;

/** Тип конфигурации детекции */
export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

/** Тип конфигурации структуры */
export type StructureConfig = z.infer<typeof StructureConfigSchema>;

/** Тип конфигурации парсинга */
export type ParsingConfig = z.infer<typeof ParsingConfigSchema>;

/** Тип конфигурации трансформации */
export type TransformConfig = z.infer<typeof TransformConfigSchema>;

/**
 * Валидирует объект конфигурации формата.
 * @throws {z.ZodError} если конфигурация невалидна
 */
export function validateFormatConfig(config: unknown): FormatConfig {
  return FormatConfigSchema.parse(config);
}

/**
 * Безопасно валидирует конфигурацию, возвращает результат с ошибками.
 */
export function safeValidateFormatConfig(config: unknown) {
  return FormatConfigSchema.safeParse(config);
}

export { FormatConfigSchema as default };