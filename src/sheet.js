import { ParserEngine, parserEngine } from './parser/engine.ts';
import { parseLessons } from './types/lesson.js';

/**
 * Парсит один лист в плоский массив занятий.
 * Делегирует к новому ParserEngine для обратной совместимости.
 * @param {any[][] | null | undefined} rows
 * @returns {Lesson[]}
 */
export function parseSheetRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  // Используем новый движок
  const parsed = parserEngine.parseSheetRows(rows);
  // Конвертируем в старый формат (без confidence/warnings)
  return parseLessons(parsed.map(p => ({
    day: p.day,
    time: p.time,
    para: p.para,
    group: p.group,
    subgroup: p.subgroup,
    subject: p.subject,
    type: p.type,
    teacher: p.teacher,
    room: p.room,
    isExam: p.isExam,
  })));
}

/**
 * Принимает SheetJS workbook, парсит все листы.
 * Делегирует к новому ParserEngine для обратной совместимости.
 * @param {{ SheetNames?: string[], Sheets?: Record<string, any> } | null | undefined} workbook
 * @param {any} [xlsx] — опциональный инстанс XLSX (нужен для браузерного теста без window).
 * @returns {Record<string, Lesson[]>}
 */
export function parseWorkbook(workbook, xlsx) {
  if (
    !workbook ||
    typeof workbook !== 'object' ||
    !Array.isArray(workbook.SheetNames) ||
    !workbook.Sheets
  )
    return {};

  // Используем новый движок
  const parsed = parserEngine.parseWorkbook(workbook, xlsx);
  // Конвертируем в старый формат
  const result = {};
  for (const [name, lessons] of Object.entries(parsed)) {
    result[name] = parseLessons(lessons.map(p => ({
      day: p.day,
      time: p.time,
      para: p.para,
      group: p.group,
      subgroup: p.subgroup,
      subject: p.subject,
      type: p.type,
      teacher: p.teacher,
      room: p.room,
      isExam: p.isExam,
    })));
  }
  return result;
}

/**
 * Новый API: парсит workbook с полной информацией (confidence, warnings).
 * @param {{ SheetNames?: string[], Sheets?: Record<string, any> } | null | undefined} workbook
 * @param {any} [xlsx]
 * @returns {Record<string, import('./parser/engine.ts').ParsedLesson[]>}
 */
export function parseWorkbookDetailed(workbook, xlsx) {
  return parserEngine.parseWorkbook(workbook, xlsx);
}

/**
 * Новый API: парсит строки листа с полной информацией.
 * @param {any[][]} rows
 * @param {string} [sheetName]
 * @returns {import('./parser/engine.ts').ParsedLesson[]}
 */
export function parseSheetRowsDetailed(rows, sheetName) {
  return parserEngine.parseSheetRows(rows, sheetName);
}

// Реэкспорт для удобства
export { ParserEngine, parserEngine } from './parser/engine.ts';