import { detectDay } from './day.js';
import { parseCell, parseGroupCode, splitSubs } from './cell.js';
import { norm } from './text.js';
import { MAX_HEADER_SCAN_ROWS, MAX_DAY_LOOKAHEAD } from './constants.js';

const HEADER_DAY_RE = /апта\s*күндөрү/i;

/**
 * @typedef {{ col: number, code: string, subgroup: string, raw: string }} GroupRef
 * @typedef {{ dayCol: number, paraCol: number, timeCol: number, groups: GroupRef[], headerRow: number }} Block
 * @typedef {{ day: string, time: string, para: string, group: string, subgroup: string,
 *             subject: string, type: string, teacher: string, room: string }} Lesson
 */

const cellAt = (rows, r, c) => {
  if (r < 0 || r >= rows.length) return '';
  const row = rows[r] || [];
  return c >= 0 && c < row.length ? norm(row[c]) : '';
};

const WEEK2_MARK_RE = /(?:^|[\s.,;:(])(2|ii|вторая|чётн\w*|четн\w*|жұп)\s*(?:нед|неделя|жұма)/i;
const WEEK1_MARK_RE = /(?:^|[\s.,;:(])(1|i|первая|нечётн\w*|нечетн\w*|тақ)\s*(?:нед|неделя|жұма)/i;

function detectWeek(raw) {
  if (!raw) return '1';
  if (WEEK2_MARK_RE.test(raw)) return '2';
  if (WEEK1_MARK_RE.test(raw)) return '1';
  return '1';
}

function findHeaderRows(rows) {
  const out = [];
  const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] || [];
    if (r.some((c) => HEADER_DAY_RE.test(String(c)))) out.push(i);
  }
  return out;
}

function extractBlocks(headerRow) {
  const blocks = [];
  let i = 0;
  while (i < headerRow.length) {
    if (HEADER_DAY_RE.test(String(headerRow[i] || ''))) {
      const dayCol = i;
      const paraCol = i + 1;
      const timeCol = i + 2;
      const groups = [];
      let j = i + 3;
      while (j < headerRow.length) {
        const cell = norm(headerRow[j]);
        if (HEADER_DAY_RE.test(cell)) break;
        const code = parseGroupCode(cell);
        if (code) groups.push({ col: j, ...code });
        j++;
      }
      if (groups.length) blocks.push({ dayCol, paraCol, timeCol, groups });
      i = j;
    } else { i++; }
  }
  return blocks;
}

function expandBlockDays(rows, block) {
  /** @type {{ row: number, day: string }[]} */
  const days = [];
  let r = block.headerRow + 1;
  let lastDay = '';
  const end = Math.min(rows.length, block.headerRow + MAX_DAY_LOOKAHEAD);
  while (r < end) {
    const dRaw = cellAt(rows, r, block.dayCol);
    const d = detectDay(dRaw);
    if (d) { lastDay = d; days.push({ row: r, day: d }); r++; continue; }
    const hasContent = cellAt(rows, r, block.paraCol) ||
                       cellAt(rows, r, block.timeCol) ||
                       block.groups.some((g) => cellAt(rows, r, g.col));
    if (lastDay && hasContent) { days.push({ row: r, day: lastDay }); r++; continue; }
    if (!lastDay && !hasContent) { r++; continue; }
    r++;
  }
  return days;
}

function blockHasContent(rows, block, dayInfo) {
  const { row } = dayInfo;
  return Boolean(
    cellAt(rows, row, block.paraCol) ||
    cellAt(rows, row, block.timeCol) ||
    block.groups.some((g) => cellAt(rows, row, g.col))
  );
}

/**
 * Парсит один лист в плоский массив занятий.
 * @param {any[][] | null | undefined} rows
 * @returns {Lesson[]}
 */
export function parseSheetRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headerIdxs = findHeaderRows(rows);
  const blocks = [];
  for (const hi of headerIdxs) {
    const header = rows[hi] || [];
    for (const b of extractBlocks(header)) {
      blocks.push({ ...b, headerRow: hi });
    }
  }

  const lessons = [];
  for (const block of blocks) {
    const days = expandBlockDays(rows, block);
    for (const info of days) {
      if (!blockHasContent(rows, block, info)) continue;
      const para = cellAt(rows, info.row, block.paraCol);
      const time = cellAt(rows, info.row, block.timeCol);
      for (const g of block.groups) {
        const raw = cellAt(rows, info.row, g.col);
        if (!raw) continue;
        for (const part of splitSubs(raw)) {
          const parsed = parseCell(part);
          if (!parsed) continue;
          lessons.push({
            day: info.day,
            time, para,
            group: g.code,
            subgroup: g.subgroup,
            subject: parsed.subject,
            type: parsed.type,
            teacher: parsed.teacher,
            room: parsed.room,
            // Неделя вычисляется из маркера «II неделя» и т.п. в ячейке.
            week: detectWeek(part)
          });
        }
      }
    }
  }

  // Если в файле нет ни одной записи с week='2' — сбрасываем метки в null.
  // Иначе фильтр недели, выставленный в '1' или '2', будет показывать не всё.
  const hasWeek2 = lessons.some((l) => l.week === '2');
  if (!hasWeek2) {
    for (const l of lessons) l.week = null;
  }
  return lessons;
}

/**
 * Принимает SheetJS workbook, парсит все листы.
 * @param {{ SheetNames?: string[], Sheets?: Record<string, any> } | null | undefined} workbook
 * @param {any} [xlsx] — опциональный инстанс XLSX (нужен для браузерного теста без window).
 * @returns {Record<string, Lesson[]>}
 */
export function parseWorkbook(workbook, xlsx) {
  if (!workbook || typeof workbook !== 'object' || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) return {};
  const lib = xlsx || globalThis.XLSX;
  /** @type {Record<string, Lesson[]>} */
  const result = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = lib?.utils?.sheet_to_json
      ? lib.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: true })
      : sheetToJsonRows(sheet, lib);
    result[name] = parseSheetRows(rows);
  }
  return result;
}

function sheetToJsonRows(sheet, lib) {
  const ref = sheet['!ref'];
  if (!ref || !lib) return [];
  const range = lib.utils.decode_range(ref);
  if (!range) return [];
  const out = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = lib.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      row.push(cell ? (cell.v ?? '') : '');
    }
    out.push(row);
  }
  return out;
}
