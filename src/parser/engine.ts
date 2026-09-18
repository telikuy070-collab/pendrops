/**
 * ParserEngine — новый движок парсинга расписания.
 * Объединяет FormatRegistry, cellReader, fieldExtractor, confidenceScorer.
 */

import { formatRegistry, FormatRegistry } from './registry.js';
import { cellReader, clearFillDownCache, type CellReader } from './cellReader.js';
import { fieldExtractor, createFieldExtractor, type ExtractedAllFields } from './fieldExtractor.js';
import { confidenceScorer, type ConfidenceResult } from './confidenceScorer.js';
import { detectDay } from '../day.js';
import { norm } from '../text.js';
import { parseLessons } from '../types/lesson.js';
import type { FormatConfig } from './types.js';
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

  /**
   * Парсит workbook (SheetJS формат) и возвращает уроки по листам.
   * @param workbook - SheetJS workbook объект
   * @param xlsx - опциональный инстанс XLSX библиотеки
   * @returns Record<sheetName, ParsedLesson[]>
   */
  parseWorkbook(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> {
    if (
      !workbook ||
      typeof workbook !== 'object' ||
      !Array.isArray(workbook.SheetNames) ||
      !workbook.Sheets
    ) {
      return {};
    }

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

  /**
   * Парсит строки листа в массив уроков.
   * @param rows - массив строк (как от sheet_to_json с header: 1)
   * @param sheetName - имя листа (для метаданных)
   * @returns ParsedLesson[]
   */
  parseSheetRows(rows: any[][], sheetName: string = 'Sheet1'): ParsedLesson[] {
    if (!Array.isArray(rows) || !rows.length) return [];

    // Clear fill-down cache for new sheet data
    clearFillDownCache();

    // 1. Находим заголовок
    const headerRowIdx = this.#findHeaderRow(rows);
    if (headerRowIdx === -1) return [];

    // 2. Извлекаем блоки (дни + группы)
    const blocks = this.#extractBlocks(rows, headerRowIdx);
    if (!blocks.length) return [];

    // 3. Парсим уроки
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

          // Разбиваем по разделителю подгрупп
          const parts = this.#splitSubs(raw);
          for (const part of parts) {
            const parsed = this.#parseCell(part);
            if (!parsed) continue;

            const lesson: ParsedLesson = {
              day: dayInfo.day,
              time,
              para,
              group: group.code,
              subgroup: group.subgroup,
              subject: parsed.subject,
              type: parsed.type,
              teacher: parsed.teacher,
              room: parsed.room,
              isExam: parsed.isExam,
              confidence: parsed.confidence,
              warnings: parsed.warnings,
            };

            // Фильтруем по минимальному confidence
            if (lesson.confidence >= this.#minConfidence) {
              lessons.push(lesson);
            }
          }
        }
      }
    }

    // Валидация через Zod (parseLessons)
    const validated = parseLessons(lessons.map(l => ({
      day: l.day,
      time: l.time,
      para: l.para,
      group: l.group,
      subgroup: l.subgroup,
      subject: l.subject,
      type: l.type,
      teacher: l.teacher,
      room: l.room,
      isExam: l.isExam,
    })));

    // Сохраняем confidence и warnings обратно
    return validated.map((v, i) => ({
      ...v,
      confidence: lessons[i]?.confidence ?? 0,
      warnings: lessons[i]?.warnings ?? [],
    }));
  }

  /**
   * Парсит одну ячейку через fieldExtractor + confidenceScorer.
   */
  #parseCell(raw: string): ParsedLesson | null {
    if (!raw || typeof raw !== 'string') return null;
    const s = norm(raw);
    if (!s) return null;

    // Извлекаем все поля
    const extracted: ExtractedAllFields = this.#fieldExtractor.extractAll(s);

    // Собираем урок для confidence scorer
    const lessonForScoring = {
      subject: extracted.subject.value,
      type: extracted.type?.value || 'other',
      room: extracted.room?.value || '',
      teacher: extracted.teacher?.value || '',
      isExam: false, // TODO: добавить детекцию экзаменов через transforms
      rawTypeConfidence: extracted.type?.confidence ?? 0,
      day: '',
      time: '',
      para: '',
      group: '',
    };

    const confidenceResult: ConfidenceResult = confidenceScorer.scoreLesson(lessonForScoring);

    return {
      day: '',
      time: '',
      para: '',
      group: '',
      subgroup: '',
      subject: extracted.subject.value,
      type: extracted.type?.value || 'other',
      teacher: extracted.teacher?.value || '',
      room: extracted.room?.value || '',
      isExam: false,
      confidence: confidenceResult.score,
      warnings: confidenceResult.warnings,
    };
  }

  /**
   * Находит строку заголовка по ключевым словам формата.
   */
  #findHeaderRow(rows: any[][]): number {
    // Используем дефолтный формат для детекции
    const format = this.#formatRegistry.getDefault();
    const { headerKeywords, minHeaderRow, maxHeaderRow } = format.detection;

    const limit = Math.min(rows.length, maxHeaderRow + 1);
    for (let i = minHeaderRow; i < limit; i++) {
      const row = rows[i] || [];
      const rowText = row.map(c => norm(c)).join(' ').toLowerCase();
      if (headerKeywords.some(kw => rowText.includes(kw.toLowerCase()))) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Извлекает блоки (структуру дней и групп) из строки заголовка.
   */
  #extractBlocks(rows: any[][], headerRowIdx: number): Block[] {
    const headerRow = rows[headerRowIdx] || [];
    const format = this.#formatRegistry.getDefault();
    const { groupCodePattern } = format.structure.header;
    const { subgroupInGroupCode, subgroupPattern } = format.parsing;

    const blocks: Block[] = [];
    let i = 0;

    while (i < headerRow.length) {
      const cell = norm(headerRow[i]);
      if (HEADER_DAY_RE.test(cell)) {
        const dayCol = i;
        const paraCol = i + 1;
        const timeCol = i + 2;
        const groups: GroupRef[] = [];
        let j = i + 3;

        while (j < headerRow.length) {
          const cellText = norm(headerRow[j]);
          if (HEADER_DAY_RE.test(cellText)) break;

          const codeMatch = cellText.match(new RegExp(groupCodePattern));
          if (codeMatch) {
            let code = codeMatch[0];
            let subgroup = '1';

            if (subgroupInGroupCode) {
              const subMatch = cellText.match(new RegExp(subgroupPattern));
              if (subMatch && subMatch[1]) {
                subgroup = subMatch[1];
                code = code.replace(subMatch[0], '').trim();
              }
            }

            groups.push({ col: j, code, subgroup, raw: cellText });
          }
          j++;
        }

        if (groups.length) {
          blocks.push({ dayCol, paraCol, timeCol, groups, headerRow: headerRowIdx });
        }
        i = j;
      } else {
        i++;
      }
    }

    return blocks;
  }

  /**
   * Расширяет блок на дни (находит строки с днями недели).
   */
  #expandBlockDays(rows: any[][], block: Block): DayInfo[] {
    const format = this.#formatRegistry.getDefault();
    const maxLookahead = 50; // можно вынести в конфиг

    const days: DayInfo[] = [];
    let r = block.headerRow + 1;
    let lastDay = '';
    const end = Math.min(rows.length, block.headerRow + maxLookahead);

    while (r < end) {
      const dRaw = this.#cellReader.readCell(rows, r, block.dayCol);
      const d = detectDay(dRaw);

      if (d) {
        lastDay = d;
        days.push({ row: r, day: d });
        r++;
        continue;
      }

      const hasContent =
        this.#cellReader.readCell(rows, r, block.paraCol) ||
        this.#cellReader.readCell(rows, r, block.timeCol) ||
        block.groups.some(g => this.#cellReader.readCell(rows, r, g.col));

      if (lastDay && hasContent) {
        days.push({ row: r, day: lastDay });
        r++;
        continue;
      }

      if (!lastDay && !hasContent) {
        r++;
        continue;
      }

      r++;
    }

    return days;
  }

  /**
   * Проверяет, есть ли контент в блоке для данного дня.
   */
  #blockHasContent(rows: any[][], block: Block, dayInfo: DayInfo): boolean {
    const { row } = dayInfo;
    return Boolean(
      this.#cellReader.readCell(rows, row, block.paraCol) ||
      this.#cellReader.readCell(rows, row, block.timeCol) ||
      block.groups.some(g => this.#cellReader.readCell(rows, row, g.col))
    );
  }

  /**
   * Разбивает ячейку по разделителю подгрупп.
   */
  #splitSubs(raw: string): string[] {
    if (!raw) return [];
    const format = this.#formatRegistry.getDefault();
    const separator = format.parsing.subgroupSeparator || '/';
    return String(raw)
      .split(separator)
      .map(s => s.trim())
      .filter(Boolean);
  }

  /**
   * Конвертирует SheetJS sheet в массив строк (fallback без XLSX.utils).
   */
  #sheetToJsonRows(sheet: any, lib: any): any[][] {
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

  /**
   * Статический метод для быстрого парсинга (использует глобальные синглтоны).
   */
  static parse(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> {
    const engine = new ParserEngine();
    return engine.parseWorkbook(workbook, xlsx);
  }

  /**
   * Статический метод для парсинга строк листа.
   */
  static parseSheetRows(rows: any[][], sheetName?: string): ParsedLesson[] {
    const engine = new ParserEngine();
    return engine.parseSheetRows(rows, sheetName);
  }
}

/**
 * Экспорт singleton для удобства
 */
export const parserEngine = new ParserEngine();

export default ParserEngine;