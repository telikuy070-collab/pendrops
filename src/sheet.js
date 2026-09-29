import { ParserEngine, parserEngine } from './parser/engine.ts';

/**
 * Legacy compatibility facade. All extraction and validation semantics live in
 * ParserEngine; this module only selects the detailed or array-shaped API.
 *
 * @param {any[][] | null | undefined} rows
 * @returns {import('./parser/engine.ts').ParsedLesson[]}
 */
export function parseSheetRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return parserEngine.parseSheetRows(rows);
}

/**
 * @param {{ SheetNames?: string[], Sheets?: Record<string, any> } | null | undefined} workbook
 * @param {any} [xlsx]
 * @returns {Record<string, import('./parser/engine.ts').ParsedLesson[]>}
 */
export function parseWorkbook(workbook, xlsx) {
  return parserEngine.parseWorkbook(workbook, xlsx);
}

/**
 * Canonical detailed API. Every candidate is accepted, rejected, or ignored.
 * @param {{ SheetNames?: string[], Sheets?: Record<string, any> } | null | undefined} workbook
 * @param {any} [xlsx]
 * @returns {import('./parser/engine.ts').ParseWorkbookResult}
 */
export function parseWorkbookDetailed(workbook, xlsx) {
  return parserEngine.parseWorkbookDetailed(workbook, xlsx);
}

/**
 * @param {any[][]} rows
 * @param {string} [sheetName]
 * @returns {import('./parser/engine.ts').ParseSheetResult}
 */
export function parseSheetRowsDetailed(rows, sheetName) {
  return parserEngine.parseSheetRowsDetailed(rows, sheetName);
}

export { ParserEngine, parserEngine } from './parser/engine.ts';
