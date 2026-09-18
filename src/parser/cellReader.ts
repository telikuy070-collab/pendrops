/**
 * Smart Cell Reader - умное чтение ячеек с поддержкой merged cells и длинного текста
 */

import { norm } from '../text.js';

/**
 * Результат чтения ячейки с контекстом
 */
export interface CellReadResult {
  value: string;
  isMerged: boolean;
  sourceRow: number;
}

/**
 * Интерфейс CellReader
 */
export interface CellReader {
  readCell(rows: any[][], row: number, col: number): string;
  readCellWithContext(rows: any[][], row: number, col: number): CellReadResult;
  fillDownCache: Map<string, string>;
  clearCache(): void;
}

/**
 * Получает сырое значение ячейки (до нормализации), может быть null/undefined
 */
function getRawCellValue(rows: any[][], row: number, col: number): any {
  if (!rows || row < 0 || row >= rows.length) return undefined;
  const r = rows[row];
  if (!r || col < 0 || col >= r.length) return undefined;
  return r[col];
}

/**
 * Получает нормализованное значение ячейки
 */
function getRawCell(rows: any[][], row: number, col: number): string {
  const val = getRawCellValue(rows, row, col);
  return norm(val);
}

/**
 * Ключ кэша для fill-down
 */
function cacheKey(row: number, col: number): string {
  return `${row},${col}`;
}

/**
 * Singleton instance для удобства использования
 */
let singletonReader: CellReader | null = null;

/**
 * Создает экземпляр CellReader
 */
export function createCellReader(): CellReader {
  // Возвращаем singleton, чтобы clearFillDownCache работал для всех экземпляров
  if (singletonReader) {
    return singletonReader;
  }

  const fillDownCache = new Map<string, string>();

  /**
   * Читает ячейку с поддержкой fill-down для merged cells
   * Если ячейка пуста, идет вверх до первой непустой ячейки в том же столбце
   */
  function readCell(rows: any[][], row: number, col: number): string {
    // Handle null/undefined rows
    if (!rows) return '';

    // Out of bounds check - return empty string without fill-down
    if (row < 0 || row >= rows.length) return '';
    const r = rows[row];
    if (!r || col < 0 || col >= r.length) return '';

    // Check if cell is null/undefined - return empty without fill-down
    const rawCellValue = r[col];
    if (rawCellValue == null) return '';

    const key = cacheKey(row, col);

    // Проверяем кэш
    if (fillDownCache.has(key)) {
      return fillDownCache.get(key)!;
    }

    let value = getRawCell(rows, row, col);

    // Fill-down: если ячейка пуста (пустая строка), идем вверх
    // Не делаем fill-down для null/undefined ячеек (уже обработано выше)
    if (!value && row > 0) {
      for (let r = row - 1; r >= 0; r--) {
        const val = getRawCell(rows, r, col);
        if (val) {
          value = val;
          break;
        }
      }
    }

    const result = value || '';
    fillDownCache.set(key, result);
    return result;
  }

  /**
   * Читает ячейку с контекстом (значение, является ли merged, исходная строка)
   */
  function readCellWithContext(rows: any[][], row: number, col: number): CellReadResult {
    // Handle null/undefined rows
    if (!rows) {
      return { value: '', isMerged: false, sourceRow: -1 };
    }

    // Out of bounds check
    if (row < 0 || row >= rows.length) {
      return { value: '', isMerged: false, sourceRow: -1 };
    }
    const r = rows[row];
    if (!r || col < 0 || col >= r.length) {
      return { value: '', isMerged: false, sourceRow: -1 };
    }

    // Check if cell is null/undefined
    const rawCellValue = r[col];
    if (rawCellValue == null) {
      return { value: '', isMerged: false, sourceRow: -1 };
    }

    const key = cacheKey(row, col);

    // Проверяем кэш
    if (fillDownCache.has(key)) {
      const cachedValue = fillDownCache.get(key)!;
      // Для кэшированных значений нужно определить, было ли это merged
      const rawValue = getRawCell(rows, row, col);
      if (rawValue) {
        return { value: cachedValue, isMerged: false, sourceRow: row };
      }
      // Если raw пустой, но кэш есть - значит это было merged
      // Находим sourceRow
      for (let r = row - 1; r >= 0; r--) {
        if (getRawCell(rows, r, col)) {
          return { value: cachedValue, isMerged: true, sourceRow: r };
        }
      }
      return { value: cachedValue, isMerged: true, sourceRow: -1 };
    }

    const rawValue = getRawCell(rows, row, col);

    if (rawValue) {
      const result = { value: rawValue, isMerged: false, sourceRow: row };
      fillDownCache.set(key, rawValue);
      return result;
    }

    // Fill-down поиск
    if (row > 0) {
      for (let r = row - 1; r >= 0; r--) {
        const val = getRawCell(rows, r, col);
        if (val) {
          const result = { value: val, isMerged: true, sourceRow: r };
          fillDownCache.set(key, val);
          return result;
        }
      }
    }

    const result = { value: '', isMerged: false, sourceRow: -1 };
    fillDownCache.set(key, '');
    return result;
  }

  function clearCache(): void {
    fillDownCache.clear();
  }

  const reader = {
    readCell,
    readCellWithContext,
    fillDownCache,
    clearCache,
  };

  singletonReader = reader;
  return reader;
}

/**
 * Singleton instance для удобства использования
 */
export const cellReader = createCellReader();

/**
 * Очищает кэш fill-down (полезно при смене листа/данных)
 */
export function clearFillDownCache(): void {
  if (singletonReader) {
    singletonReader.clearCache();
  }
}