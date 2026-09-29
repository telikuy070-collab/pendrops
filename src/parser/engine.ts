/**
 * Canonical parser engine.
 *
 * The detailed APIs preserve every terminal parsing decision. The legacy APIs
 * return only accepted lessons for backwards compatibility.
 */
import { formatRegistry, FormatRegistry } from './registry.ts';
import { cellReader, type CellReader } from './cellReader.ts';
import { fieldExtractor, createFieldExtractor, type ExtractedAllFields } from './fieldExtractor.ts';
import { confidenceScorer, type ConfidenceResult } from './confidenceScorer.ts';
import { detectDay } from '../day.js';
import { norm } from '../text.js';
import { LessonSchema } from '../types/lesson.js';
import type { FormatConfig } from './types.ts';
import collegeFormat from './formats/college-kyrgyz-2024.json' with { type: 'json' };
import { TYPE_IDS } from '../constants.js';

export const PARSER_CONTRACT_VERSION = '1.0.0';

if (formatRegistry.size === 0) {
  formatRegistry.register(collegeFormat as FormatConfig);
}

export interface ParserEngineOptions {
  formatRegistry?: FormatRegistry;
  cellReader?: CellReader;
  fieldExtractor?: ReturnType<typeof createFieldExtractor>;
  minConfidence?: number;
}

export interface ParsedLesson {
  day: string;
  time: string;
  para: string;
  group: string;
  subgroup: string;
  subject: string;
  type: string;
  teacher: string;
  room: string;
  isExam: boolean;
  confidence: number;
  warnings: string[];
}

export interface ParseProvenance {
  /** 1-based Excel row containing the source cell. */
  sheetName: string;
  sourceRow: number;
  /** 1-based Excel column containing the source cell. */
  sourceColumn: number;
  /** 0-based part index when a cell contains slash-separated lessons. */
  partIndex: number;
}

export type ParseDiagnosticCode =
  | 'invalid_input'
  | 'empty_input'
  | 'unknown_format'
  | 'no_schedule_blocks'
  | 'critical_fields_invalid'
  | 'low_confidence'
  | 'empty_row'
  | 'day_without_lesson'
  | 'empty_group_cell'
  | 'empty_cell_part'
  | 'non_lesson_row';

export interface AcceptedParseOutcome {
  status: 'accepted';
  lesson: ParsedLesson;
  provenance: ParseProvenance;
}

export interface RejectedParseOutcome {
  status: 'rejected';
  code: ParseDiagnosticCode;
  message: string;
  provenance: ParseProvenance;
  details?: Record<string, unknown>;
}

export interface IgnoredParseOutcome {
  status: 'ignored';
  code: ParseDiagnosticCode;
  message: string;
  provenance: ParseProvenance;
}

export type ParseOutcome = AcceptedParseOutcome | RejectedParseOutcome | IgnoredParseOutcome;

export interface ParseSheetStats {
  totalRows: number;
  headerRow: number;
  groupsFound: number;
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  ignoredNonLessonCount: number;
}

export interface ParseSheetResult {
  sheetName: string;
  formatUsed: string;
  outcomes: ParseOutcome[];
  accepted: AcceptedParseOutcome[];
  rejected: RejectedParseOutcome[];
  ignored: IgnoredParseOutcome[];
  lessons: ParsedLesson[];
  stats: ParseSheetStats;
}

export interface ParseWorkbookReport extends Omit<
  ParseSheetStats,
  'totalRows' | 'headerRow' | 'groupsFound'
> {
  sheetCount: number;
}

export interface ParseWorkbookResult {
  sheets: Record<string, ParseSheetResult>;
  report: ParseWorkbookReport;
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
  dayOnly: boolean;
}

interface ExpandedBlock {
  days: DayInfo[];
  emptyRows: number[];
}

const HEADER_DAY_RE = /апта\s*күндөрү|дни недели|schedule|расписание|day|день/i;
const CANONICAL_DAYS = new Set([
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
]);
const VALID_TYPES = new Set<string>(Object.values(TYPE_IDS));
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?:-(?:[01]\d|2[0-3]):[0-5]\d)?$/;
const PARA_RE = /^\d+(?:\s*пар[аы])?$/i;

/**
 * Critical fields that describe *where in the grid* a lesson sits.
 *
 * When one of these is malformed the row is not a usable lesson, and the only
 * remaining question is whether the row was ever a lesson candidate at all.
 */
const STRUCTURAL_CRITICAL_FIELDS: ReadonlySet<string> = new Set(['time', 'para']);

export function validateCriticalFields(lesson: ParsedLesson | Record<string, unknown>): string[] {
  const invalid: string[] = [];
  if (typeof lesson.day !== 'string' || !CANONICAL_DAYS.has(lesson.day)) invalid.push('day');
  if (typeof lesson.time !== 'string' || !TIME_RE.test(lesson.time)) invalid.push('time');
  if (typeof lesson.para !== 'string' || !PARA_RE.test(lesson.para)) invalid.push('para');
  if (typeof lesson.group !== 'string' || !norm(lesson.group)) invalid.push('group');
  if (typeof lesson.subject !== 'string' || !norm(lesson.subject)) invalid.push('subject');
  if (typeof lesson.type !== 'string' || !VALID_TYPES.has(lesson.type)) invalid.push('type');
  if (typeof lesson.isExam !== 'boolean') invalid.push('isExam');

  if (typeof lesson.time === 'string' && lesson.time.includes('-')) {
    const [start, end] = lesson.time.split('-').map((part) => {
      const [hours, minutes] = part.split(':').map(Number);
      return hours * 60 + minutes;
    });
    if (start !== undefined && end !== undefined && end <= start) invalid.push('time');
  }

  return invalid;
}

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

  /** Legacy workbook API: accepted lessons only. */
  parseWorkbook(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> {
    if (
      !workbook ||
      typeof workbook !== 'object' ||
      !Array.isArray(workbook.SheetNames) ||
      !workbook.Sheets
    ) {
      return {};
    }

    const detailed = this.parseWorkbookDetailed(workbook, xlsx);
    return Object.fromEntries(
      Object.entries(detailed.sheets).map(([name, result]) => [name, result.lessons])
    );
  }

  /** Canonical workbook API with terminal diagnostics for every decision. */
  parseWorkbookDetailed(workbook: any, xlsx?: any): ParseWorkbookResult {
    if (
      !workbook ||
      typeof workbook !== 'object' ||
      !Array.isArray(workbook.SheetNames) ||
      !workbook.Sheets
    ) {
      return this.#invalidWorkbookResult();
    }

    const lib = xlsx || globalThis.XLSX;
    const sheets: Record<string, ParseSheetResult> = {};
    for (const name of workbook.SheetNames) {
      this.#cellReader.clearCache();
      const sheet = workbook.Sheets[name];
      const rows = lib?.utils?.sheet_to_json
        ? lib.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: true })
        : this.#sheetToJsonRows(sheet, lib);
      sheets[name] = this.parseSheetRowsDetailed(rows, name);
    }

    return { sheets, report: this.#aggregateReport(Object.values(sheets)) };
  }

  /** Legacy sheet API: accepted lessons only. */
  parseSheetRows(rows: any[][], sheetName = 'Sheet1'): ParsedLesson[] {
    return this.parseSheetRowsDetailed(rows, sheetName).lessons;
  }

  /** Canonical sheet API with accepted/rejected/ignored outcomes. */
  parseSheetRowsDetailed(rows: any[][], sheetName = 'Sheet1'): ParseSheetResult {
    this.#cellReader.clearCache();

    if (!Array.isArray(rows) || !rows.length) {
      return this.#emptySheetResult(sheetName, 'empty_input');
    }

    const headerRowIdx = this.#findHeaderRow(rows);
    if (headerRowIdx === -1) {
      return this.#failedSheetResult(
        sheetName,
        rows.length,
        -1,
        'unknown_format',
        'Формат расписания не распознан'
      );
    }

    const blocks = this.#extractBlocks(rows, headerRowIdx);
    if (!blocks.length) {
      return this.#failedSheetResult(
        sheetName,
        rows.length,
        headerRowIdx,
        'no_schedule_blocks',
        'В строке заголовка не найдены блоки групп'
      );
    }

    const outcomes: ParseOutcome[] = [];
    let groupsFound = 0;

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      groupsFound += block.groups.length;
      const nextHeaderRow = blocks
        .slice(blockIndex + 1)
        .map((candidate) => candidate.headerRow)
        .find((row) => row > block.headerRow);
      const endRow = nextHeaderRow ?? rows.length;
      const expanded = this.#expandBlockDays(rows, block, endRow);
      const days = expanded.days;
      const recordsIgnoredRows =
        blockIndex === 0 || blocks[blockIndex - 1].headerRow !== block.headerRow;

      if (recordsIgnoredRows) {
        for (const row of expanded.emptyRows) {
          outcomes.push(
            this.#ignored(
              'empty_row',
              'Пустая или декоративная строка',
              sheetName,
              row,
              block.dayCol,
              0
            )
          );
        }
      }

      for (const dayInfo of days) {
        if (dayInfo.dayOnly) {
          if (recordsIgnoredRows) {
            outcomes.push(
              this.#ignored(
                'day_without_lesson',
                'Строка дня не содержит данных урока',
                sheetName,
                dayInfo.row,
                block.dayCol,
                0
              )
            );
          }
          continue;
        }
        const para = this.#readDataCell(rows, dayInfo.row, block.paraCol, block.headerRow + 1);
        const time = this.#readDataCell(rows, dayInfo.row, block.timeCol, block.headerRow + 1);
        const rowHasLessonSignals = this.#rowHasLessonSignals(rows, dayInfo.row, block);

        for (const group of block.groups) {
          const raw = this.#readDataCell(rows, dayInfo.row, group.col, block.headerRow + 1);
          if (!raw) {
            outcomes.push(
              this.#ignored(
                'empty_group_cell',
                'Ячейка группы пуста',
                sheetName,
                dayInfo.row,
                group.col,
                0
              )
            );
            continue;
          }

          this.#splitSubs(raw).forEach((part, partIndex, parts) => {
            if (!part) {
              outcomes.push(
                this.#ignored(
                  'empty_cell_part',
                  'Пустая часть ячейки после разделения',
                  sheetName,
                  dayInfo.row,
                  group.col,
                  partIndex
                )
              );
              return;
            }
            outcomes.push(
              this.#parseCandidate(part, {
                day: dayInfo.day,
                time,
                para,
                group: group.code,
                subgroup: group.subgroup,
                sheetName,
                sourceRow: dayInfo.row,
                sourceColumn: group.col,
                partIndex,
                partCount: parts.length,
                rowHasLessonSignals,
              })
            );
          });
        }
      }
    }

    return this.#buildSheetResult(sheetName, rows.length, headerRowIdx, groupsFound, outcomes);
  }

  #parseCandidate(
    raw: string,
    context: {
      day: string;
      time: string;
      para: string;
      group: string;
      subgroup: string;
      sheetName: string;
      sourceRow: number;
      sourceColumn: number;
      partIndex: number;
      partCount: number;
      rowHasLessonSignals: boolean;
    }
  ): ParseOutcome {
    const provenance: ParseProvenance = {
      sheetName: context.sheetName,
      sourceRow: context.sourceRow + 1,
      sourceColumn: context.sourceColumn + 1,
      partIndex: context.partIndex,
    };
    const normalized = norm(raw);
    if (!normalized) {
      return this.#ignored(
        'empty_cell_part',
        'Исходная ячейка пуста',
        context.sheetName,
        context.sourceRow,
        context.sourceColumn,
        context.partIndex
      );
    }

    const extracted: ExtractedAllFields = this.#fieldExtractor.extractAll(normalized);
    const type = extracted.type?.value || TYPE_IDS.OTHER;
    const teacher = extracted.teacher?.value || '';
    const room = extracted.room?.value || '';
    const confidenceResult: ConfidenceResult = confidenceScorer.scoreLesson({
      subject: extracted.subject.value,
      type,
      room: room || '',
      teacher: teacher || '',
      isExam: extracted.isExam,
      rawTypeConfidence: extracted.type?.confidence ?? 0,
      day: context.day,
      time: context.time,
      para: context.para,
      group: context.group,
      subgroup: context.subgroup,
    });

    const lesson: ParsedLesson = {
      day: context.day,
      time: norm(context.time),
      para: norm(context.para),
      group: context.group,
      subgroup: context.subgroup,
      subject: extracted.subject.value,
      type,
      teacher,
      room,
      isExam: extracted.isExam,
      confidence: confidenceResult.score,
      warnings: confidenceResult.warnings,
    };

    const invalidFields = validateCriticalFields(lesson);
    if (invalidFields.length) {
      // A row that carries no lesson signal of its own is not a lesson candidate
      // at all. Merged cells are filled by looking upward, so a caption or
      // signature line written into the time column ("Медициналык колледждин
      // директору ...") would otherwise inherit the row above's lesson text and
      // be reported as a rejected lesson. Such a row is a non-lesson, and it is
      // ignored; `rejected` stays reserved for candidates that do look like
      // lessons but carry invalid data.
      const structuralInvalid = invalidFields.some((field) =>
        STRUCTURAL_CRITICAL_FIELDS.has(field)
      );
      if (structuralInvalid && !context.rowHasLessonSignals) {
        return this.#ignored(
          'non_lesson_row',
          'Строка не содержит признаков занятия и не является уроком',
          context.sheetName,
          context.sourceRow,
          context.sourceColumn,
          context.partIndex
        );
      }

      return {
        status: 'rejected',
        code: 'critical_fields_invalid',
        message: `Некорректные критические поля: ${invalidFields.join(', ')}`,
        provenance,
        details: { fields: invalidFields },
      };
    }

    const validation = LessonSchema.safeParse(lesson);
    if (!validation.success) {
      return {
        status: 'rejected',
        code: 'critical_fields_invalid',
        message: 'Урок не прошёл схему валидации',
        provenance,
        details: { fields: validation.error.issues.map((issue) => issue.path.join('.')) },
      };
    }

    if (lesson.confidence < this.#minConfidence) {
      return {
        status: 'rejected',
        code: 'low_confidence',
        message: `Confidence ${lesson.confidence.toFixed(2)} ниже порога ${this.#minConfidence.toFixed(2)}`,
        provenance,
        details: {
          confidence: lesson.confidence,
          minConfidence: this.#minConfidence,
          partCount: context.partCount,
        },
      };
    }

    return { status: 'accepted', lesson: validation.data as ParsedLesson, provenance };
  }

  #findHeaderRow(rows: any[][]): number {
    const format = this.#formatRegistry.getDefault();
    const { headerKeywords, minHeaderRow, maxHeaderRow } = format.detection;
    const limit = Math.min(rows.length, maxHeaderRow + 1);
    for (let i = minHeaderRow; i < limit; i++) {
      const row = rows[i] || [];
      if (
        headerKeywords.some((keyword) =>
          row
            .map((cell) => norm(cell))
            .join(' ')
            .toLowerCase()
            .includes(keyword.toLowerCase())
        )
      ) {
        return i;
      }
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
      if (!HEADER_DAY_RE.test(norm(headerRow[i]))) {
        i++;
        continue;
      }

      const dayCol = i;
      const paraCol = i + 1;
      const timeCol = i + 2;
      const groups: GroupRef[] = [];
      let j = i + 3;
      while (j < headerRow.length && !HEADER_DAY_RE.test(norm(headerRow[j]))) {
        const cellText = norm(headerRow[j]);
        const codeMatch = cellText.match(new RegExp(groupCodePattern));
        if (codeMatch) {
          let code = codeMatch[0];
          let subgroup = '1';
          if (subgroupInGroupCode) {
            const subMatch = cellText.match(new RegExp(subgroupPattern));
            if (subMatch?.[1]) {
              subgroup = subMatch[1];
              code = code.replace(subMatch[0], '').trim();
            }
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

  #expandBlockDays(rows: any[][], block: Block, endRow: number): ExpandedBlock {
    const days: DayInfo[] = [];
    const emptyRows: number[] = [];
    let lastDay = '';
    for (let row = block.headerRow + 1; row < endRow; row++) {
      const directDay = norm(rows[row]?.[block.dayCol]);
      const hasDirectContent = this.#rowHasDirectContent(rows, row, block);
      if (directDay && !hasDirectContent) {
        days.push({ row, day: detectDay(directDay), dayOnly: true });
        continue;
      }
      if (hasDirectContent) {
        const detected = directDay ? detectDay(directDay) : '';
        if (detected) lastDay = detected;
        days.push({ row, day: directDay ? detected : lastDay, dayOnly: false });
      } else {
        emptyRows.push(row);
      }
    }
    return { days, emptyRows };
  }

  #rowHasDirectContent(rows: any[][], row: number, block: Block): boolean {
    return Boolean(
      norm(rows[row]?.[block.paraCol]) ||
      norm(rows[row]?.[block.timeCol]) ||
      block.groups.some((group) => norm(rows[row]?.[group.col]))
    );
  }

  /**
   * Does the row itself look like a lesson?
   *
   * Deliberately reads the row's OWN cells and never the filled-down values.
   * `#rowHasDirectContent` only asks "is there anything at all here", which is
   * also true for a footer line parked in the time column. A row counts as a
   * lesson only when it carries lesson content of its own:
   *
   * - text in one of its own group cells (the normal case), or
   * - a well-formed time in its own time cell, or
   * - a well-formed lesson number in its own para cell.
   *
   * Everything else — captions, signatures, totals, notes — is a non-lesson
   * row even when fill-down would have lent it a lesson body.
   */
  #rowHasLessonSignals(rows: any[][], row: number, block: Block): boolean {
    if (block.groups.some((group) => norm(rows[row]?.[group.col]))) return true;

    const ownTime = norm(rows[row]?.[block.timeCol]);
    if (ownTime && TIME_RE.test(ownTime)) return true;

    const ownPara = norm(rows[row]?.[block.paraCol]);
    return Boolean(ownPara && PARA_RE.test(ownPara));
  }

  #readDataCell(rows: any[][], row: number, column: number, firstDataRow: number): string {
    const direct = norm(rows[row]?.[column]);
    if (direct) return direct;
    for (let sourceRow = row - 1; sourceRow >= firstDataRow; sourceRow--) {
      const value = norm(rows[sourceRow]?.[column]);
      if (value) return value;
    }
    return '';
  }

  #splitSubs(raw: string): string[] {
    const separator = this.#formatRegistry.getDefault().parsing.subgroupSeparator || '/';
    return String(raw)
      .split(separator)
      .map((part) => norm(part));
  }

  #sheetToJsonRows(sheet: any, lib: any): any[][] {
    const ref = sheet?.['!ref'];
    if (!ref || !lib?.utils) return [];
    const range = lib.utils.decode_range(ref);
    if (!range) return [];
    const out: any[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: any[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row.push(sheet[lib.utils.encode_cell({ r, c })]?.v ?? '');
      }
      out.push(row);
    }
    return out;
  }

  #ignored(
    code: ParseDiagnosticCode,
    message: string,
    sheetName: string,
    sourceRow: number,
    sourceColumn: number,
    partIndex: number
  ): IgnoredParseOutcome {
    return {
      status: 'ignored',
      code,
      message,
      provenance: {
        sheetName,
        sourceRow: sourceRow + 1,
        sourceColumn: sourceColumn + 1,
        partIndex,
      },
    };
  }

  #buildSheetResult(
    sheetName: string,
    totalRows: number,
    headerRow: number,
    groupsFound: number,
    outcomes: ParseOutcome[]
  ): ParseSheetResult {
    const accepted = outcomes.filter(
      (outcome): outcome is AcceptedParseOutcome => outcome.status === 'accepted'
    );
    const rejected = outcomes.filter(
      (outcome): outcome is RejectedParseOutcome => outcome.status === 'rejected'
    );
    const ignored = outcomes.filter(
      (outcome): outcome is IgnoredParseOutcome => outcome.status === 'ignored'
    );
    return {
      sheetName,
      formatUsed: this.#formatRegistry.defaultFormatId || 'none',
      outcomes,
      accepted,
      rejected,
      ignored,
      lessons: accepted.map((outcome) => outcome.lesson),
      stats: {
        totalRows,
        headerRow,
        groupsFound,
        candidateCount: accepted.length + rejected.length,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        ignoredNonLessonCount: ignored.length,
      },
    };
  }

  #emptySheetResult(sheetName: string, code: ParseDiagnosticCode): ParseSheetResult {
    const provenance: ParseProvenance = { sheetName, sourceRow: 0, sourceColumn: 0, partIndex: 0 };
    const outcome: IgnoredParseOutcome = {
      status: 'ignored',
      code,
      message: 'Лист пуст',
      provenance,
    };
    return this.#buildSheetResult(sheetName, 0, -1, 0, [outcome]);
  }

  #failedSheetResult(
    sheetName: string,
    totalRows: number,
    headerRow: number,
    code: ParseDiagnosticCode,
    message: string
  ): ParseSheetResult {
    const provenance: ParseProvenance = {
      sheetName,
      sourceRow: Math.max(headerRow + 1, 0),
      sourceColumn: 0,
      partIndex: 0,
    };
    const outcome: RejectedParseOutcome = { status: 'rejected', code, message, provenance };
    return this.#buildSheetResult(sheetName, totalRows, headerRow, 0, [outcome]);
  }

  #aggregateReport(sheets: ParseSheetResult[]): ParseWorkbookReport {
    const acceptedCount = sheets.reduce((sum, sheet) => sum + sheet.stats.acceptedCount, 0);
    const rejectedCount = sheets.reduce((sum, sheet) => sum + sheet.stats.rejectedCount, 0);
    return {
      sheetCount: sheets.length,
      candidateCount: acceptedCount + rejectedCount,
      acceptedCount,
      rejectedCount,
      ignoredNonLessonCount: sheets.reduce(
        (sum, sheet) => sum + sheet.stats.ignoredNonLessonCount,
        0
      ),
    };
  }

  #invalidWorkbookResult(): ParseWorkbookResult {
    const sheet = this.#failedSheetResult(
      '<workbook>',
      0,
      -1,
      'invalid_input',
      'Workbook имеет неверную структуру'
    );
    return { sheets: { '<workbook>': sheet }, report: this.#aggregateReport([sheet]) };
  }

  static parse(workbook: any, xlsx?: any): Record<string, ParsedLesson[]> {
    return new ParserEngine().parseWorkbook(workbook, xlsx);
  }

  static parseDetailed(workbook: any, xlsx?: any): ParseWorkbookResult {
    return new ParserEngine().parseWorkbookDetailed(workbook, xlsx);
  }

  static parseSheetRows(rows: any[][], sheetName?: string): ParsedLesson[] {
    return new ParserEngine().parseSheetRows(rows, sheetName);
  }

  static parseSheetRowsDetailed(rows: any[][], sheetName?: string): ParseSheetResult {
    return new ParserEngine().parseSheetRowsDetailed(rows, sheetName);
  }
}

export const parserEngine = new ParserEngine();
export default ParserEngine;
