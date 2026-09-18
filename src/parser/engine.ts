/**
 * ParserEngine — новый движок парсинга расписания.
 * Объединяет FormatRegistry, cellReader, fieldExtractor, confidenceScorer.
 */

import { formatRegistry, FormatRegistry } from './registry.ts';
import { cellReader, clearFillDownCache, type CellReader } from './cellReader.ts';
import { fieldExtractor, createFieldExtractor, type ExtractedAllFields } from './fieldExtractor.ts';
import { confidenceScorer, type ConfidenceResult } from './confidenceScorer.ts';
import { detectDay } from '../day.js';
import { norm } from '../text.js';
import { parseLessons } from '../types/lesson.js';
import type { FormatConfig } from './types.ts';
import collegeFormat from './formats/college-kyrgyz-2024.json' with { type: 'json' };

// Регистрируем дефолтный формат при загрузке модуля
if (formatRegistry.size === 0) {
  formatRegistry.register(collegeFormat as FormatConfig);
}

export interface ParserEngineOptions {
  /** Реестр форматов (по умолчанию глобальный синглтон) */
  formatRegistry?: FormatRegistry;
  /** CellReader (по умолчанию глобальный синглтон) */
  cellReader?: CellReader;
  /** Кастомный экстрактор полей */
  fieldExtractor?: ReturnType<typeof createFieldExtractor>;
  /** Минимальный confidence для включения урока в результат */
  minConfidence?: number;
}

export interface ParsedLesson {
  day: string;
  time: string;
  para: string;
  group: string;
  subgroup?: string;
  subject: string;
  type: string;
  teacher?: string;
  room?: string;
  isExam: boolean;
  confidence: number;
  warnings: string[];
}

export interface ParseResult {
  lessons: ParsedLesson[];
  formatUsed: string;
  sheetName: string;
  stats: {
    totalRows: number;
    headerRow: number;
    groupsFound: number;
    lessonsParsed: number;
    lessonsKept: number;
  };
}

interface Block {
  dayCol: number;
  paraCol: number;
  timeCol: number;
  groups: GroupRef[];
  headerRow: number;
}

interface GroupRef {
  col: number;
  code: string;
  subgroup: string;
  raw: string;
}

interface DayInfo {
  row: number;
  day: string;
}

const HEADER_DAY_RE = /апта\s*күндөрү|дни недели|schedule|расписание|day|день/i;

/**
 * ParserEngine — основной класс парсера нового поколения.
 */
export class ParserEngine {
  #formatRegistry: FormatRegistry;
  #cellReader: CellReader;
  #fieldExtractor: ReturnType<typeof createFieldExtractor>;
  #minConfidence: number;

  constructor(options: ParserEngineOptions = {}) {
    this.#formatRegistry = options.formatRegistry || formatRegistry;
    this.#cellReader = options.cellReader || cellReader;
    this.#fieldExtractor = options.fieldExtractor || fieldExtractor;
    this.#minConfidence = options.minConfidence ?? 0.3;
  }

  parseWorkbook(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> {
    if (!workbook || typeof workbook !== 'object' || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) return {};
    const lib = xlsx || globalThis.XLSX;
    const result: Record<string, ParsedLesson[]> = {};
    for (const name of workbook.SheetNames) {
      clearFillDownCache();
      const sheet = workbook.Sheets[name];
      const rows = lib?.utils?.sheet_to_json
        ? lib.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: true })
        : this.#sheetToJsonRows(sheet, lib);
      result[name] = this.parseSheetRows(rows, name);
    }
    return result;
  }

  parseSheetRows(rows: any[][], sheetName: string = 'Sheet1'): ParsedLesson[] {
    if (!Array.isArray(rows) || !rows.length) return [];
    clearFillDownCache();
    const headerRowIdx = this.#findHeaderRow(rows);
    if (headerRowIdx === -1) return [];
    const blocks = this.#extractBlocks(rows, headerRowIdx);
    if (!blocks.length) return [];
    const lessons: ParsedLesson[] = [];
    for (const block of blocks) {
      const days = this.#expandBlockDays(rows, block);
      for (const dayInfo of days) {
        if (!this.#blockHasContent(rows, block, dayInfo)) continue;
        const para = this.#cellReader.readCell(rows, dayInfo.row, block.paraCol);
        const time = this.#cellReader.readCell(rows, dayInfo.row, block.timeCol);
        for (const group of block.groups) {
          const raw = this.#cellReader.readCell(rows, dayInfo.row, group.col);
          if (!raw) continue;
          for (const part of this.#splitSubs(raw)) {
            const parsed = this.#parseCell(part);
            if (!parsed) continue;
            const lesson: ParsedLesson = { day: dayInfo.day, time, para, group: group.code, subgroup: group.subgroup, subject: parsed.subject, type: parsed.type, teacher: parsed.teacher, room: parsed.room, isExam: parsed.isExam, confidence: parsed.confidence, warnings: parsed.warnings };
            if (lesson.confidence >= this.#minConfidence) lessons.push(lesson);
          }
        }
      }
    }
    const validated = parseLessons(lessons.map(l => ({ day: l.day, time: l.time, para: l.para, group: l.group, subgroup: l.subgroup, subject: l.subject, type: l.type, teacher: l.teacher, room: l.room, isExam: l.isExam })));
    return validated.map((v, i) => ({ ...v, confidence: lessons[i]?.confidence ?? 0, warnings: lessons[i]?.warnings ?? [] }));
  }

  #parseCell(raw: string): ParsedLesson | null {
    if (!raw || typeof raw !== 'string') return null;
    const s = norm(raw);
    if (!s) return null;
    const extracted: ExtractedAllFields = this.#fieldExtractor.extractAll(s);
    const confidenceResult: ConfidenceResult = confidenceScorer.scoreLesson({ subject: extracted.subject.value, type: extracted.type?.value || 'other', room: extracted.room?.value || '', teacher: extracted.teacher?.value || '', isExam: false, rawTypeConfidence: extracted.type?.confidence ?? 0, day: '', time: '', para: '', group: '' });
    return { day: '', time: '', para: '', group: '', subgroup: '', subject: extracted.subject.value, type: extracted.type?.value || 'other', teacher: extracted.teacher?.value || '', room: extracted.room?.value || '', isExam: false, confidence: confidenceResult.score, warnings: confidenceResult.warnings };
  }

  #findHeaderRow(rows: any[][]): number {
    const format = this.#formatRegistry.getDefault();
    const { headerKeywords, minHeaderRow, maxHeaderRow } = format.detection;
    const limit = Math.min(rows.length, maxHeaderRow + 1);
    for (let i = minHeaderRow; i < limit; i++) {
      const row = rows[i] || [];
      if (headerKeywords.some(kw => row.map(c => norm(c)).join(' ').toLowerCase().includes(kw.toLowerCase()))) return i;
    }
    return -1;
  }

  #extractBlocks(rows: any[][], headerRowIdx: number): Block[] {
    const headerRow = rows[headerRowIdx] || [];
    const format = this.#formatRegistry.getDefault();
    const { groupCodePattern } = format.structure.header;
    const { subgroupInGroupCode, subgroupPattern } = format.parsing;
    const blocks: Block[] = [];
    let i = 0;
    while (i < headerRow.length) {
      const cell = norm(headerRow[i]);
      if (!HEADER_DAY_RE.test(cell)) { i++; continue; }
      const dayCol = i, paraCol = i + 1, timeCol = i + 2;
      const groups: GroupRef[] = [];
      let j = i + 3;
      while (j < headerRow.length && !HEADER_DAY_RE.test(norm(headerRow[j]))) {
        const cellText = norm(headerRow[j]);
        const codeMatch = cellText.match(new RegExp(groupCodePattern));
        if (codeMatch) {
          let code = codeMatch[0], subgroup = '1';
          if (subgroupInGroupCode) {
            const subMatch = cellText.match(new RegExp(subgroupPattern));
            if (subMatch?.[1]) { subgroup = subMatch[1]; code = code.replace(subMatch[0], '').trim(); }
          }
          groups.push({ col: j, code, subgroup, raw: cellText });
        }
        j++;
      }
      if (groups.length) blocks.push({ dayCol, paraCol, timeCol, groups, headerRow: headerRowIdx });
      i = j;
    }
    return blocks;
  }

  #expandBlockDays(rows: any[][], block: Block): DayInfo[] {
    const days: DayInfo[] = [];
    let r = block.headerRow + 1, lastDay = '';
    const end = Math.min(rows.length, block.headerRow + 50);
    while (r < end) {
      const d = detectDay(this.#cellReader.readCell(rows, r, block.dayCol));
      if (d) { lastDay = d; days.push({ row: r++, day: d }); continue; }
      const hasContent = this.#cellReader.readCell(rows, r, block.paraCol) || this.#cellReader.readCell(rows, r, block.timeCol) || block.groups.some(g => this.#cellReader.readCell(rows, r, g.col));
      if (lastDay && hasContent) days.push({ row: r, day: lastDay });
      r++;
    }
    return days;
  }

  #blockHasContent(rows: any[][], block: Block, dayInfo: DayInfo): boolean {
    return Boolean(this.#cellReader.readCell(rows, dayInfo.row, block.paraCol) || this.#cellReader.readCell(rows, dayInfo.row, block.timeCol) || block.groups.some(g => this.#cellReader.readCell(rows, dayInfo.row, g.col)));
  }

  #splitSubs(raw: string): string[] {
    const separator = this.#formatRegistry.getDefault().parsing.subgroupSeparator || '/';
    return String(raw).split(separator).map(s => s.trim()).filter(Boolean);
  }

  #sheetToJsonRows(sheet: any, lib: any): any[][] {
    const ref = sheet['!ref'];
    if (!ref || !lib) return [];
    const range = lib.utils.decode_range(ref);
    if (!range) return [];
    const out: any[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: any[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) row.push(sheet[lib.utils.encode_cell({ r, c })]?.v ?? '');
      out.push(row);
    }
    return out;
  }

  static parse(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> { return new ParserEngine().parseWorkbook(workbook, xlsx); }
  static parseSheetRows(rows: any[][], sheetName?: string): ParsedLesson[] { return new ParserEngine().parseSheetRows(rows, sheetName); }
}

export const parserEngine = new ParserEngine();
export default ParserEngine;
