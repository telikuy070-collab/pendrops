/**
 * Canonical parser engine.
 *
 * ## The no-loss invariant
 *
 * Every non-empty cell inside a recognised schedule region produces exactly
 * one terminal `ParseCellOutcome`. There is no branch in which an authored
 * cell is inspected and then dropped without a record of what happened to it.
 *
 * The previous engine violated that invariant. Its main loop iterated over
 * *rows* (`#expandBlockDays`), visited only rows that already had content, and
 * filled missing axis cells by walking up the column and taking the first
 * non-empty value it met. Consequences:
 *
 *  - `#rowHasDirectContent` decided whether a row existed at all, so a row
 *    whose only content sat in the day column disappeared into `empty_row`;
 *  - a cell whose text split into an empty part produced an `empty_cell_part`
 *    diagnostic and never became a lesson;
 *  - a horizontally merged cell gave its text to the anchor column only, while
 *    the sibling subgroup columns silently inherited a value from an unrelated
 *    row further up — the classic "a day vanished" bug;
 *  - only the first header row on a sheet was used, so a second table on the
 *    same sheet was never parsed at all.
 *
 * ## Terminal statuses
 *
 * Each inventoried cell ends in exactly one of four states:
 *
 *  - `lesson`     — fully parsed, every field recognised from its own source;
 *  - `partial`    — a lesson exists but a field was not recognised (no room, no
 *                   teacher, type inferred from the column, day inherited).
 *                   Published as-is together with its warnings;
 *  - `non_lesson` — positively identified as not a lesson (a signature line, a
 *                   totals row, a service caption). Never lowers coverage;
 *  - `unresolved` — text is present, no lesson came out of it, and it is
 *                   unclear whether it was a lesson. The only state that
 *                   lowers coverage.
 *
 * ## Compatibility
 *
 * `parseWorkbook` / `parseSheetRows` keep their historical array-of-lessons
 * shape. `parseWorkbookDetailed` additionally exposes the per-cell inventory
 * (`cellOutcomes`) and coverage accounting, and keeps the legacy `outcomes` /
 * `accepted` / `rejected` / `ignored` projections derived from it so existing
 * consumers keep working unchanged.
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
import {
  buildGrid,
  cellAt,
  continuationAnchor,
  mergeAt,
  type Grid,
  type MergeRangeLike,
} from './grid.ts';
import {
  buildRegions,
  extractBlocks,
  groupColumnHas,
  groupColumnSpan,
  regionGroupColumns,
  type Block,
  type GroupRef,
  type HeaderSyntax,
  type Region,
} from './regions.ts';
import {
  classifyNonLesson,
  dominantType,
  hasTypeKeyword,
  splitCellParts,
  typeOf,
  type CellPart,
} from './cellText.ts';
import { DAY_AXIS, PARA_AXIS, TIME_AXIS, resolveAxis, type AxisReading } from './axis.ts';

export const PARSER_CONTRACT_VERSION = '1.1.0';

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
  sheetName: string;
  /** 1-based Excel row containing the source cell. */
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
  | 'non_lesson_row'
  | 'non_lesson_cell'
  | 'outside_region';

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

/**
 * Terminal status of one inventoried cell.
 *
 * `non_lesson` and `unresolved` are deliberately distinct: a signature line is
 * *known* not to be a lesson and must not drag the coverage figure down, while
 * `unresolved` is a genuine unknown and does.
 */
export type ParseCellStatus = 'lesson' | 'partial' | 'non_lesson' | 'unresolved';

export interface ParseCellOutcome {
  status: ParseCellStatus;
  /** Raw authored text of the cell, after merge expansion. */
  raw: string;
  /** Lessons produced by this cell (0 for `non_lesson` / `unresolved`). */
  lessons: ParsedLesson[];
  /**
   * Authored part index of each entry in `lessons`, positionally aligned.
   *
   * A cell holding `"A / / B"` publishes two lessons with part indices 0 and 2,
   * because the empty fragment in between is not dropped silently — its absence
   * is visible as a gap in this list.
   */
  partIndexes: number[];
  /** 0-based cell row inside the sheet. */
  row: number;
  /** 0-based cell column inside the sheet. */
  col: number;
  /** True when the cell sits in a group column of a recognised region. */
  inRegion: boolean;
  /** True when the cell counts toward the coverage denominator. */
  counted: boolean;
  warnings: string[];
  /** Human-readable explanation, always filled in. */
  reason: string;
  /** Critical fields that failed validation, when the cell stayed unresolved. */
  invalidFields: string[];
  /** Anchor of the merge this cell came from, when the cell is a continuation. */
  anchor?: { row: number; col: number };
  /**
   * True when every part of this cell restated a lesson that another cell in
   * the same row owns, so the cell published nothing.
   *
   * It is a fact about the FILE, not a parsing failure: the lesson is on the
   * schedule either way, so the cell must not be counted as a hole.
   */
  restated?: boolean;
  /** Region this cell belongs to, -1 when outside every region. */
  regionIndex: number;
}

export interface ParseSheetStats {
  totalRows: number;
  /** First header row, kept for compatibility. 0-based, -1 when absent. */
  headerRow: number;
  /** Every header row found on the sheet, 0-based. */
  headerRows: number[];
  /** Number of independent tables (regions) on the sheet. */
  regionCount: number;
  groupsFound: number;
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  ignoredNonLessonCount: number;
  /** Non-empty cells anywhere on the sheet (after merge expansion). */
  totalNonEmpty: number;
  /** Non-empty authored cells inside recognised regions — coverage denominator. */
  inRegions: number;
  /** Non-empty cells outside recognised regions. */
  outOfRegions: number;
  lessonCells: number;
  partialCells: number;
  nonLessonCells: number;
  unresolvedCells: number;
  /** `1 - unresolved / inRegions`, clamped to 0..1. */
  coverage: number;
  /** Merge regions declared by the sheet. */
  mergeCount: number;
  /** Merge regions whose anchor held text and were expanded into it. */
  mergeExpandedCount: number;
  /**
   * Cells that were empty before expansion and received the anchor's value.
   *
   * This is the number the no-loss invariant is stated over: a merged lesson
   * occupies several physical group columns, and each of them owes a lesson.
   */
  mergeExpandedCells: number;
  /** Distinct rows an expanded region covers. */
  mergeRowsCovered: number;
  /** Distinct columns an expanded region covers. */
  mergeColumnsCovered: number;
  /**
   * Non-empty group-column cells of the EXPANDED grid, one per covered
   * subgroup column.
   *
   * This is the largest number of lessons the sheet can possibly yield, and it
   * is what the "output equals input" contract is measured against.
   */
  expandedGroupCells: number;
}

export interface ParseSheetResult {
  sheetName: string;
  formatUsed: string;
  /** Per-cell inventory: exactly one entry per non-empty cell of the sheet. */
  cellOutcomes: ParseCellOutcome[];
  /** Legacy projection kept for existing consumers. */
  outcomes: ParseOutcome[];
  accepted: AcceptedParseOutcome[];
  rejected: RejectedParseOutcome[];
  ignored: IgnoredParseOutcome[];
  lessons: ParsedLesson[];
  stats: ParseSheetStats;
}

export interface ParseWorkbookReport extends Omit<
  ParseSheetStats,
  'totalRows' | 'headerRow' | 'headerRows' | 'groupsFound'
> {
  sheetCount: number;
}

export interface ParseWorkbookResult {
  sheets: Record<string, ParseSheetResult>;
  report: ParseWorkbookReport;
}

/** Extra inputs a caller may supply when the raw sheet object is available. */
export interface ParseSheetOptions {
  /**
   * `sheet['!merges']`. When supplied, merged regions are expanded before
   * parsing; when omitted the rows are treated as an already dense grid.
   */
  merges?: MergeRangeLike[] | null;
}

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

/** One group column an authored cell speaks for. */
export interface Slot {
  group: GroupRef;
  /**
   * True when this cell owns the group's lesson.
   *
   * A cell that only reaches the group's continuation columns restates a lesson
   * the owning cell already publishes.
   */
  owned: boolean;
}

interface InventoryCell {
  row: number;
  col: number;
  inRegion: boolean;
  regionIndex: number;
}

interface TypeStats {
  byColumn: Map<number, string[]>;
  byRow: Map<number, string[]>;
}

interface BlockAxes {
  /** Keyed by absolute row index inside the sheet. */
  day: Map<number, AxisReading>;
  para: Map<number, AxisReading>;
  time: Map<number, AxisReading>;
}

/** Resolution of the day / lesson-number / time axis for one block. */
interface AxisContext {
  /**
   * Block owning a group column, keyed by region index and then by column.
   *
   * The region index must be part of the key: two regions on the same sheet
   * routinely reuse the same physical columns, and a single flat column map
   * would let the second region's block overwrite the first's, leaving the
   * first region's lessons with no day, time or lesson number at all.
   */
  blockByRegion: Map<number, Map<number, Block>>;
  axesByRegion: Map<number, Map<Block, BlockAxes>>;
}

interface AxisRowReadings {
  day: AxisReading;
  para: AxisReading;
  time: AxisReading;
}

const MISSING_AXIS: AxisReading = {
  value: '',
  own: false,
  inherited: false,
  unreadable: false,
};

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
    return Object.fromEntries(
      Object.entries(this.parseWorkbookDetailed(workbook, xlsx).sheets).map(
        ([name, result]) => [name, result.lessons] as const
      )
    );
  }

  /** Canonical workbook API with a terminal outcome for every authored cell. */
  parseWorkbookDetailed(workbook: any, xlsx?: any): ParseWorkbookResult {
    if (
      !workbook ||
      typeof workbook !== 'object' ||
      !Array.isArray(workbook.SheetNames) ||
      !workbook.Sheets
    ) {
      return this.#invalidWorkbookResult();
    }

    const lib = xlsx || (globalThis as Record<string, any>).XLSX;
    if (workbook.SheetNames.length === 0) {
      return { sheets: {}, report: this.#aggregateReport([]) };
    }
    if (!lib?.utils?.sheet_to_json) {
      // Reading a sheet object into rows is impossible without SheetJS. Saying
      // so is essential: falling through to an empty row set would make the
      // whole workbook look like a sheet of empty rows, which is a silent loss
      // of every cell rather than an honest failure.
      return this.#invalidWorkbookResult(
        'Не удалось прочитать лист: недоступна библиотека SheetJS'
      );
    }

    const sheets: Record<string, ParseSheetResult> = {};
    for (const name of workbook.SheetNames) {
      this.#cellReader.clearCache();
      const sheet = workbook.Sheets[name];
      const rows = lib.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: true,
        raw: true,
      });
      // Merge ranges come from the sheet object so merged regions can be
      // expanded before parsing instead of being patched up row by row.
      const merges = (sheet?.['!merges'] as MergeRangeLike[] | undefined) ?? null;
      sheets[name] = this.parseSheetRowsDetailed(rows, name, { merges });
    }

    return { sheets, report: this.#aggregateReport(Object.values(sheets)) };
  }

  /** Legacy sheet API: accepted lessons only. */
  parseSheetRows(rows: any[][], sheetName = 'Sheet1'): ParsedLesson[] {
    return this.parseSheetRowsDetailed(rows, sheetName).lessons;
  }

  /** Canonical sheet API with the per-cell inventory and coverage accounting. */
  parseSheetRowsDetailed(
    rows: any[][],
    sheetName = 'Sheet1',
    options: ParseSheetOptions = {}
  ): ParseSheetResult {
    this.#cellReader.clearCache();

    if (!Array.isArray(rows) || !rows.length) {
      return this.#emptySheetResult(sheetName, 'empty_input');
    }

    const grid = buildGrid(rows, options.merges);
    if (grid.lastContentRow < 0) {
      return this.#emptySheetResult(sheetName, 'empty_input');
    }

    const syntax = this.#headerSyntax();
    const window = this.#scanWindow();
    const regions = buildRegions(grid, syntax, window);

    if (!regions.length) {
      // No region parsed. Distinguish "not a schedule sheet at all" from "a
      // schedule sheet whose header carries no group columns" — the latter is
      // a data problem, the former is simply not our file.
      const code = this.#hasDayHeader(grid, window) ? 'no_schedule_blocks' : 'unknown_format';
      return this.#failedSheetResult(
        sheetName,
        grid.rowCount,
        this.#firstHeaderRow(grid, syntax, window),
        code,
        code === 'no_schedule_blocks'
          ? 'В строке заголовка не найдены блоки групп'
          : 'Формат расписания не распознан'
      );
    }

    const inventory = this.#inventory(grid, regions);
    const typeStats = this.#collectTypeStats(grid, inventory);
    const context = this.#axisContext(grid, regions);
    const owners = this.#groupOwners(grid, regions);

    const cellOutcomes: ParseCellOutcome[] = inventory.map((cell) => {
      if (!cell.inRegion) return this.#outsideOutcome(grid, cell);
      const region = regions[cell.regionIndex];
      const stats = typeStats.get(cell.regionIndex);
      return this.#parseCell(grid, region, cell, context, stats, owners);
    });

    const rowOutcomes = this.#rowDiagnostics(grid, regions, sheetName);
    // Administrative lines outside the tables (typically the director's
    // signature parked in a time column) stay visible in the legacy report.
    for (const cell of inventory) {
      if (cell.inRegion) continue;
      const outcome = this.#outsideIgnored(grid, cell, sheetName);
      if (outcome) rowOutcomes.push(outcome);
    }
    return this.#buildResult(sheetName, grid, regions, cellOutcomes, rowOutcomes);
  }

  // ------------------------------------------------------------------
  // Inventory
  // ------------------------------------------------------------------

  /**
   * Claim every non-empty cell of the sheet exactly once.
   *
   * Group-column cells inside a region form the coverage denominator. Every
   * other non-empty cell — header text, day/time/lesson-number axes, captions,
   * trailing notes — is still claimed and classified, so the report accounts
   * for the whole sheet instead of only the part we managed to parse.
   */
  #inventory(grid: Grid, regions: Region[]): InventoryCell[] {
    const claimed = new Set<string>();
    const cells: InventoryCell[] = [];

    const claim = (row: number, col: number, inRegion: boolean, regionIndex: number) => {
      const key = `${row},${col}`;
      if (claimed.has(key)) return;
      claimed.add(key);
      cells.push({ row, col, inRegion, regionIndex });
    };

    for (let index = 0; index < regions.length; index++) {
      const region = regions[index];
      for (const col of regionGroupColumns(region)) {
        for (let row = region.headerRow + 1; row < region.endRow; row++) {
          if (!cellAt(grid, row, col)) continue;
          // A merged region is ONE authored cell, however many group columns
          // it covers. Claim the anchor only: iterating the covered columns
          // separately is what made one merged cell publish a lesson per
          // subgroup column. When the anchor itself is not a group column of
          // this region, the covered cell is the closest authored cell and is
          // claimed in its place.
          const anchor = this.#anchorOf(grid, row, col);
          const anchorIsGroupCell = this.#isGroupColumn(region, anchor.col);
          const claimCol = anchorIsGroupCell ? anchor.col : col;
          claim(row, claimCol, true, index);
        }
      }
    }

    for (let row = 0; row < grid.rowCount; row++) {
      for (let col = 0; col < grid.colCount; col++) {
        if (!cellAt(grid, row, col)) continue;
        if (claimed.has(`${row},${col}`)) continue;
        claim(row, col, false, -1);
      }
    }

    cells.sort((left, right) => left.row - right.row || left.col - right.col);
    return cells;
  }

  #isGroupColumn(region: Region, col: number): boolean {
    return region.blocks.some((block) => block.groups.some((group) => groupColumnHas(group, col)));
  }

  /**
   * How many lessons the expanded grid of a sheet can possibly yield.
   *
   * Counted as distinct `(row, group, subgroup)` slots rather than as physical
   * cells, because a header printed across two columns describes ONE subgroup
   * (a merged `ПСТ-1-25 (2)` spanning E and F). Counting physical cells there
   * would demand a second lesson for a subgroup that occupies one slot, and the
   * published count would sit permanently below this figure.
   *
   * A group column is scanned across its whole width, so a slot whose text sits
   * in a continuation column of a merged header is still counted.
   *
   * The number is a ceiling, not a target: a source may legitimately author the
   * same slot in two separate cells, in which case the lessons legitimately
   * exceed it. What it rules out is lessons *below* it, which is exactly the
   * fill-down corruption the old engine produced.
   */
  #expandedGroupCells(grid: Grid, regions: Region[]): number {
    const slots = new Set<string>();
    for (const region of regions) {
      for (const block of region.blocks) {
        for (const group of block.groups) {
          for (let row = region.headerRow + 1; row < region.endRow; row++) {
            const hasText = groupColumnSpan(group).some((col) => cellAt(grid, row, col));
            if (!hasText) continue;
            slots.add(`${row}|${group.code}|${group.subgroup}`);
          }
        }
      }
    }
    return slots.size;
  }

  /**
   * Top-left cell of the authored region that covers this coordinate.
   *
   * The merge anchor map only contains anchors, so a cell covered by a merge
   * but not anchoring it has to be resolved through the continuation map.
   * Without that second lookup every covered column looked like its own
   * authored cell, and a merged cell produced one lesson per covered subgroup
   * column instead of one.
   */
  #anchorOf(grid: Grid, row: number, col: number): { row: number; col: number } {
    const continuation = continuationAnchor(grid, row, col);
    if (continuation) {
      const [anchorRow, anchorCol] = continuation.split(',').map(Number);
      return { row: anchorRow, col: anchorCol };
    }
    let anchorRow = row;
    let anchorCol = col;
    // Well-formed sheets never overlap merge regions, but legacy .xls exports
    // can. The guard keeps the walk terminating and deterministic.
    for (let hops = 0; hops < 64; hops++) {
      const span = mergeAt(grid, anchorRow, anchorCol);
      if (!span) break;
      if (span.row === anchorRow && span.col === anchorCol) break;
      anchorRow = span.row;
      anchorCol = span.col;
    }
    return { row: anchorRow, col: anchorCol };
  }

  // ------------------------------------------------------------------
  // Axes
  // ------------------------------------------------------------------

  #axisContext(grid: Grid, regions: Region[]): AxisContext {
    const blockByRegion = new Map<number, Map<number, Block>>();
    const axesByRegion = new Map<number, Map<Block, BlockAxes>>();

    regions.forEach((region, index) => {
      const blockByCol = new Map<number, Block>();
      const axes = new Map<Block, BlockAxes>();
      for (const block of region.blocks) {
        for (const group of block.groups) {
          // Every physical column of the group answers to the same block, so
          // a cell sitting in a continuation column of a merged header still
          // gets the block's day / lesson-number / time axes.
          for (const col of groupColumnSpan(group)) blockByCol.set(col, block);
        }
        const from = region.headerRow + 1;
        const to = region.endRow - 1;
        // Time and lesson number use a plausibility gate: a value only
        // continues the axis while it still parses as that kind. A caption or a
        // signature line parked in the time column therefore stops the axis
        // instead of poisoning every row underneath it.
        axes.set(block, {
          day: this.#axisRows(grid, block.dayCol, DAY_AXIS, from, to),
          para: this.#axisRows(grid, block.paraCol, PARA_AXIS, from, to),
          time: this.#axisRows(grid, block.timeCol, TIME_AXIS, from, to),
        });
      }
      blockByRegion.set(index, blockByCol);
      axesByRegion.set(index, axes);
    });

    return { blockByRegion, axesByRegion };
  }

  /**
   * Resolve one axis column over `[from, to]`, keyed by absolute row index.
   *
   * The result map always contains every row in the range, so a cell never has
   * to guess whether an axis value was missing or simply not looked up.
   */
  #axisRows(
    grid: Grid,
    column: number,
    spec: typeof DAY_AXIS,
    from: number,
    to: number
  ): Map<number, AxisReading> {
    const resolution = resolveAxis(
      (row) => cellAt(grid, row, column),
      from,
      to,
      spec,
      spec.kind === 'day' ? (raw: string) => detectDay(raw) : undefined
    );
    const rows = new Map<number, AxisReading>();
    for (let row = from; row <= to; row++) {
      rows.set(row, resolution.rows.get(row) ?? MISSING_AXIS);
    }
    return rows;
  }

  // ------------------------------------------------------------------
  // Type statistics (context inference)
  // ------------------------------------------------------------------

  /**
   * Distribution of explicitly stated lesson types per region column and row.
   *
   * Only cells that name a type themselves contribute, so the statistics can
   * never be polluted by a guess. A cell with no type keyword later consults
   * these numbers, which is how "the ninth cell in a lecture column without a
   * word in it is also a lecture" is decided from the file itself.
   */
  #collectTypeStats(grid: Grid, inventory: InventoryCell[]): Map<number, TypeStats> {
    const stats = new Map<number, TypeStats>();
    const get = (index: number): TypeStats => {
      let entry = stats.get(index);
      if (!entry) {
        entry = { byColumn: new Map(), byRow: new Map() };
        stats.set(index, entry);
      }
      return entry;
    };

    for (const cell of inventory) {
      if (!cell.inRegion) continue;
      const raw = cellAt(grid, cell.row, cell.col);
      if (!raw) continue;
      const separator = this.#separator();
      for (const part of splitCellParts(raw, separator)) {
        if (!hasTypeKeyword(part.text)) continue;
        const type = typeOf(part.fields);
        if (type === TYPE_IDS.OTHER) continue;
        // Statistics are kept per region: two regions on a sheet reuse the same
        // physical columns, so pooling them would let one table's majority type
        // decide the type of another table's cells.
        pushInto(get(cell.regionIndex).byColumn, cell.col, type);
        pushInto(get(cell.regionIndex).byRow, cell.row, type);
      }
    }
    return stats;
  }

  #separator(): string {
    return this.#formatRegistry.getDefault().parsing.subgroupSeparator || '/';
  }

  // ------------------------------------------------------------------
  // Per-cell parsing
  // ------------------------------------------------------------------

  /**
   * Which authored cell owns each group column in each row.
   *
   * A group column printed across several physical columns (a merged
   * `ПСТ-1-25 (2)` over E and F) is one group column, and a data row can reach
   * into it from either side. Ownership decides which of those cells publishes
   * the group's lesson, so it cannot be decided by one cell in isolation:
   *
   *  1. the cell written in the group's own FIRST column owns it — that is the
   *     column the header merge starts at, and the one a cell merged from the
   *     left reaches;
   *  2. when no cell wrote there, the leftmost cell that reaches one of the
   *     group's continuation columns owns it. Without this fallback the lesson
   *     would be dropped even though the file authored it, and the cell would
   *     be reported as a hole in the table;
   *  3. otherwise the group column holds no lesson in this row.
   *
   * Keyed `regionIndex:row:group.col`, and the value is the owning cell's
   * anchor column.
   */
  #groupOwners(grid: Grid, regions: Region[]): Map<string, number> {
    const owners = new Map<string, number>();
    regions.forEach((region, regionIndex) => {
      for (const block of region.blocks) {
        for (const group of block.groups) {
          for (let row = region.headerRow + 1; row < region.endRow; row++) {
            let owner = -1;
            if (cellAt(grid, row, group.col)) {
              owner = this.#anchorOf(grid, row, group.col).col;
            } else {
              for (const col of groupColumnSpan(group)) {
                if (col === group.col) continue;
                if (!cellAt(grid, row, col)) continue;
                owner = this.#anchorOf(grid, row, col).col;
                break;
              }
            }
            if (owner >= 0) owners.set(`${regionIndex}:${row}:${group.col}`, owner);
          }
        }
      }
    });
    return owners;
  }

  /**
   * Which group columns an authored cell speaks for.
   *
   * A merged cell covers several group columns at once, so the parts it holds
   * have to be shared out between them. A group column yields ONE slot even
   * when it spans several physical columns and the cell covers all of them: a
   * merge across both of a group's columns is one authored lesson for that
   * subgroup, not two.
   *
   * The interesting case is exactly that wide group column. Two cells on either
   * side of it both touch the subgroup, and publishing a lesson from each is
   * what showed the student two identical cards for one lesson. `owners` says
   * which of them owns the group; the other restates the same lesson, and its
   * part is dropped rather than published twice.
   *
   * Ownership is positional and comes from the sheet geometry. Lesson text is
   * never compared: two different lessons written into the same wide group
   * column both stay, and the surplus is reported instead of resolved, because
   * resolving it would be data loss.
   */
  #slotsFor(
    grid: Grid,
    region: Region,
    regionIndex: number,
    owners: Map<string, number>,
    row: number,
    col: number
  ): Slot[] {
    const span = mergeAt(grid, row, col);
    const from = span ? span.col : col;
    const to = span ? span.lastCol : col;

    // Restrict the search to the block that owns the anchor, so a wide merge
    // cannot reach into the neighbouring table's group columns.
    const owner =
      region.blocks.find((block) => block.groups.some((group) => groupColumnHas(group, from))) ??
      region.blocks.find((block) =>
        block.groups.some((group) => groupColumnSpan(group).some((c) => c >= from && c <= to))
      );

    const slots: Slot[] = [];
    for (const group of owner?.groups ?? []) {
      // The cell reaches this group when their column ranges overlap at all.
      if (group.lastCol < from || group.col > to) continue;
      slots.push({
        group,
        owned: owners.get(`${regionIndex}:${row}:${group.col}`) === col,
      });
    }
    return slots;
  }

  #parseCell(
    grid: Grid,
    region: Region,
    cell: InventoryCell,
    context: AxisContext,
    typeStats: TypeStats | undefined,
    owners: Map<string, number>
  ): ParseCellOutcome {
    const raw = cellAt(grid, cell.row, cell.col);
    const anchor = this.#anchorOf(grid, cell.row, cell.col);
    const isAnchor = anchor.row === cell.row && anchor.col === cell.col;

    const base = {
      row: cell.row,
      col: cell.col,
      inRegion: true,
      counted: true,
      regionIndex: cell.regionIndex,
      anchor: isAnchor ? undefined : anchor,
    };

    // A signature line, a totals row or a service caption is *known* not to be
    // a lesson. Classifying it here keeps it out of the coverage penalty
    // without discarding it from the report.
    const nonLesson = classifyNonLesson(raw);
    if (nonLesson.isNonLesson) {
      return {
        ...base,
        status: 'non_lesson',
        raw,
        lessons: [],
        partIndexes: [],
        warnings: [],
        invalidFields: [],
        reason: nonLesson.reason,
      };
    }

    const slots = this.#slotsFor(grid, region, cell.regionIndex, owners, cell.row, cell.col);
    if (!slots.length) {
      return {
        ...base,
        status: 'unresolved',
        raw,
        lessons: [],
        partIndexes: [],
        warnings: [],
        invalidFields: ['group'],
        reason: 'Ячейка в колонке группы, но группа не определена',
      };
    }

    const parts = splitCellParts(raw, this.#separator());
    if (!parts.length) {
      return {
        ...base,
        status: 'unresolved',
        raw,
        lessons: [],
        partIndexes: [],
        warnings: [],
        invalidFields: ['subject'],
        reason: 'Ячейка не содержит текста занятия',
      };
    }

    const assignments = distributeParts(parts, slots);
    const lessons: ParsedLesson[] = [];
    /** Authored part index per published lesson, for provenance. */
    const partIndexes: number[] = [];
    const cellWarnings = new Set<string>();
    const failures: string[] = [];
    const invalidFields = new Set<string>();
    const restated: string[] = [];
    let publishedSomething = false;
    let lostSlot = false;

    for (const assignment of assignments) {
      // A part that landed on a group column this cell does not own restates a
      // lesson another cell already publishes for that subgroup. Publishing it
      // would show the student the same card twice, so it is dropped here —
      // but it is reported rather than dropped in silence, because a source
      // that puts two DIFFERENT lessons in one wide group column loses one of
      // them either way and the admin has to know which.
      const owned = assignment.slots.filter((slot) => slot.owned);
      const foreign = assignment.slots.filter((slot) => !slot.owned);
      if (foreign.length) {
        const group = foreign[0].group;
        const names = foreign
          .map((slot) => `${slot.group.code}(${slot.group.subgroup})`)
          .join(', ');
        restated.push(`«${assignment.part.text}» → ${names} (уже объявлено в соседней ячейке)`);
      }
      for (const slot of owned) {
        const built = this.#buildLesson(
          assignment.part,
          context,
          cell.regionIndex,
          cell.row,
          slot.group,
          typeStats
        );
        for (const warning of built.warnings) cellWarnings.add(warning);

        if (built.invalidFields.length) {
          lostSlot = true;
          for (const field of built.invalidFields) invalidFields.add(field);
          failures.push(
            `${slot.group.code}(${slot.group.subgroup}): нет ${built.invalidFields.join(', ')}`
          );
          continue;
        }
        const validation = LessonSchema.safeParse(built.lesson);
        if (!validation.success) {
          lostSlot = true;
          const fields = validation.error.issues.map((issue) => issue.path.join('.'));
          failures.push(`${slot.group.code}(${slot.group.subgroup}): ${fields.join(', ')}`);
          continue;
        }
        const lesson = validation.data as ParsedLesson;
        if (lesson.confidence < this.#minConfidence) {
          // Recognised as a lesson but too weak to publish. The cell stays
          // `partial` — we do know what it is — while the legacy projection
          // still reports the confidence gate.
          publishedSomething = true;
          lostSlot = true;
          failures.push(
            `${slot.group.code}(${slot.group.subgroup}): confidence ${lesson.confidence.toFixed(2)}`
          );
          continue;
        }
        publishedSomething = true;
        lessons.push(lesson);
        partIndexes.push(assignment.part.partIndex);
      }
    }

    // The restatement itself is a property of the file, not of this cell's
    // parsing, so it is surfaced as a warning on the cell that carries it.
    if (restated.length) {
      for (const note of restated) cellWarnings.add(`restated_subgroup: ${note}`);
    }

    if (!lessons.length) {
      // A cell whose every part restates a lesson another cell owns published
      // nothing here, but it was never a hole: the lesson is on the schedule,
      // published from the owning cell. Reporting it as `unresolved` would
      // charge the file for a cell it authored correctly.
      const status: ParseCellStatus =
        publishedSomething || restated.length
          ? restated.length
            ? 'lesson'
            : 'partial'
          : 'unresolved';
      return {
        ...base,
        status,
        raw,
        lessons: [],
        partIndexes: [],
        warnings: [...cellWarnings],
        invalidFields: [...invalidFields],
        restated: restated.length > 0,
        reason: restated.length
          ? `Занятие объявлено в соседней ячейке — ${restated.join('; ')}`
          : failures.length
            ? `Занятие не собрано — ${failures.join('; ')}`
            : 'Занятие не собрано',
      };
    }

    const warned = cellWarnings.size > 0;
    return {
      ...base,
      status: lostSlot || warned ? 'partial' : 'lesson',
      raw,
      lessons,
      partIndexes,
      warnings: [...cellWarnings],
      invalidFields: [],
      restated: restated.length > 0,
      reason: lostSlot
        ? `Часть подгрупп не разобрана — ${failures.join('; ')}`
        : restated.length
          ? `Занятие собрано, часть подгрупп продублирована в соседней ячейке — ${restated.join('; ')}`
          : warned
            ? 'Занятие собрано с предупреждениями'
            : 'Занятие разобрано полностью',
    };
  }

  #buildLesson(
    part: CellPart,
    context: AxisContext,
    regionIndex: number,
    row: number,
    group: GroupRef,
    typeStats: TypeStats | undefined
  ): { lesson: ParsedLesson; invalidFields: string[]; warnings: string[] } {
    const readings = this.#readAxes(context, regionIndex, group.col, row);
    const warnings: string[] = [];
    if (readings.day.unreadable) warnings.push('inherited_day');
    if (readings.para.unreadable) warnings.push('unreadable_para');
    if (readings.time.unreadable) warnings.push('unreadable_time');

    const extracted: ExtractedAllFields = part.fields;
    const explicitType = hasTypeKeyword(part.text);
    let type = typeOf(extracted);
    if (!explicitType) {
      // The cell names no type. The column's own distribution decides, and the
      // row's is the fallback; both thresholds live in `dominantType`, so one
      // stray cell cannot flip a whole column. Nothing college-specific is
      // hardcoded — the distribution is measured from this very file.
      const inferred =
        dominantType(typeStats?.byColumn.get(group.col) ?? []) ??
        dominantType(typeStats?.byRow.get(row) ?? []);
      if (inferred) {
        type = inferred.type;
        warnings.push('inferred_type');
      }
    }

    // A subgroup written in the cell beats the one printed in the header.
    const subgroup = part.ownSubgroup || group.subgroup;

    const confidenceResult: ConfidenceResult = confidenceScorer.scoreLesson({
      subject: extracted.subject.value,
      type,
      room: extracted.room?.value || '',
      teacher: extracted.teacher?.value || '',
      isExam: extracted.isExam,
      rawTypeConfidence: extracted.type?.confidence ?? 0,
      day: readings.day.value,
      time: readings.time.value,
      para: readings.para.value,
      group: group.code,
      subgroup,
    });

    const lesson: ParsedLesson = {
      day: readings.day.value,
      time: norm(readings.time.value),
      para: norm(readings.para.value),
      group: group.code,
      subgroup,
      subject: extracted.subject.value,
      type,
      teacher: extracted.teacher?.value || '',
      room: extracted.room?.value || '',
      isExam: extracted.isExam,
      confidence: confidenceResult.score,
      warnings: [...confidenceResult.warnings, ...warnings],
    };

    return { lesson, invalidFields: validateCriticalFields(lesson), warnings };
  }

  #readAxes(context: AxisContext, regionIndex: number, col: number, row: number): AxisRowReadings {
    const block = context.blockByRegion.get(regionIndex)?.get(col);
    const axes = block ? context.axesByRegion.get(regionIndex)?.get(block) : undefined;
    if (!axes) {
      return { day: MISSING_AXIS, para: MISSING_AXIS, time: MISSING_AXIS };
    }
    return {
      day: axes.day.get(row) ?? MISSING_AXIS,
      para: axes.para.get(row) ?? MISSING_AXIS,
      time: axes.time.get(row) ?? MISSING_AXIS,
    };
  }

  // ------------------------------------------------------------------
  // Out-of-region and row-level cells
  // ------------------------------------------------------------------

  /**
   * A non-empty cell that is not a group cell of a region.
   *
   * These are the sheet's header labels, the day/lesson-number/time axis
   * values, captions and trailing notes. None of them is a lesson, so they are
   * classified `non_lesson` and excluded from the coverage denominator, but
   * they are still inventoried so the report shows exactly how much of the
   * sheet sits outside the parsed tables.
   */
  #outsideOutcome(grid: Grid, cell: InventoryCell): ParseCellOutcome {
    const raw = cellAt(grid, cell.row, cell.col);
    const anchor = this.#anchorOf(grid, cell.row, cell.col);
    const verdict = classifyNonLesson(raw);
    return {
      status: 'non_lesson',
      raw,
      lessons: [],
      partIndexes: [],
      row: cell.row,
      col: cell.col,
      inRegion: false,
      counted: false,
      regionIndex: -1,
      warnings: [],
      invalidFields: [],
      reason:
        verdict.kind !== 'none'
          ? `Вне области расписания: ${verdict.reason}`
          : 'Вне распознанной области расписания',
      anchor: anchor.row === cell.row && anchor.col === cell.col ? undefined : anchor,
    };
  }

  /**
   * Cells outside a region that still belong in the legacy `ignored` list.
   *
   * A signature line written into the time column is the case that matters: it
   * is the reason the old axis walk-up poisoned every row underneath it, so it
   * must stay visible in the report rather than disappear as sheet furniture.
   * Header labels and axis values are not reported here — they are furniture,
   * and they are all present in `cellOutcomes` regardless.
   */
  #outsideIgnored(grid: Grid, cell: InventoryCell, sheetName: string): IgnoredParseOutcome | null {
    const raw = cellAt(grid, cell.row, cell.col);
    const verdict = classifyNonLesson(raw);
    if (verdict.kind !== 'administrative') return null;
    return {
      status: 'ignored',
      code: 'non_lesson_row',
      message: verdict.reason,
      provenance: { sheetName, sourceRow: cell.row + 1, sourceColumn: cell.col + 1, partIndex: 0 },
    };
  }

  /**
   * Row-shaped diagnostics that are not authored cells.
   *
   * A blank separator row and a day-only row contain no cell of their own, so
   * they never appear in the inventory. They are still reported so the legacy
   * `ignored` list keeps its historical shape.
   */
  #rowDiagnostics(grid: Grid, regions: Region[], sheetName: string): IgnoredParseOutcome[] {
    const out: IgnoredParseOutcome[] = [];
    const seen = new Set<number>();

    for (const region of regions) {
      const groupColumns = regionGroupColumns(region);
      for (let row = region.headerRow + 1; row < region.endRow; row++) {
        if (seen.has(row)) continue;
        seen.add(row);
        if (!(grid.cells[row] ?? []).some((cell) => cell !== '')) {
          out.push(
            this.#ignored('empty_row', 'Пустая или декоративная строка', sheetName, row, 0, 0)
          );
          continue;
        }
        if (groupColumns.some((col) => cellAt(grid, row, col))) continue;
        // A row carrying only a day label introduces a weekday that holds no
        // lessons at all. It is a row-shaped fact rather than a cell, so it is
        // reported here instead of being invented as a cell outcome.
        if (region.blocks.some((block) => cellAt(grid, row, block.dayCol))) {
          out.push(
            this.#ignored(
              'day_without_lesson',
              'Строка дня не содержит данных урока',
              sheetName,
              row,
              0,
              0
            )
          );
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Result assembly
  // ------------------------------------------------------------------

  #buildResult(
    sheetName: string,
    grid: Grid,
    regions: Region[],
    cellOutcomes: ParseCellOutcome[],
    rowOutcomes: IgnoredParseOutcome[]
  ): ParseSheetResult {
    const accepted: AcceptedParseOutcome[] = [];
    const rejected: RejectedParseOutcome[] = [];
    const ignored: IgnoredParseOutcome[] = [...rowOutcomes];

    let lessonCells = 0;
    let partialCells = 0;
    let nonLessonCells = 0;
    let unresolvedCells = 0;
    let inRegions = 0;

    for (const cell of cellOutcomes) {
      if (cell.inRegion) inRegions++;
      if (cell.status === 'lesson') lessonCells++;
      else if (cell.status === 'partial') partialCells++;
      else if (cell.status === 'non_lesson') nonLessonCells++;
      else unresolvedCells++;

      const provenance = {
        sheetName,
        sourceRow: cell.row + 1,
        sourceColumn: cell.col + 1,
        partIndex: 0,
      };

      if (cell.status === 'non_lesson') {
        // Out-of-region cells stay in `cellOutcomes` only: the legacy ignored
        // list describes the tables, not the sheet furniture. In-region
        // non-lessons (a signature written into a group column) are reported
        // there because they are the interesting case.
        if (cell.inRegion) {
          ignored.push({
            status: 'ignored',
            code: 'non_lesson_row',
            message: cell.reason || 'Ячейка не является занятием',
            provenance,
          });
        }
        continue;
      }

      if (!cell.lessons.length) {
        if (cell.restated) {
          // Published by the cell that owns the group column; see the field
          // docs. Counting it as rejected would both invent a data problem and
          // put a rejection in the report for a correctly authored cell.
          continue;
        }
        if (cell.status === 'unresolved') {
          rejected.push({
            status: 'rejected',
            code: 'critical_fields_invalid',
            message: cell.reason || 'Занятие не удалось разобрать',
            provenance,
            details: { fields: cell.invalidFields },
          });
        } else {
          rejected.push({
            status: 'rejected',
            code: 'low_confidence',
            message: cell.reason || 'Занятие не прошло порог качества',
            provenance,
            details: { warnings: cell.warnings },
          });
        }
        continue;
      }

      cell.lessons.forEach((lesson, index) => {
        accepted.push({
          status: 'accepted',
          lesson,
          // The authored part index, not the position in the published list, so
          // a dropped empty fragment stays visible as a gap.
          provenance: { ...provenance, partIndex: cell.partIndexes[index] ?? index },
        });
      });
    }

    const totalNonEmpty = cellOutcomes.length;
    const coverage = inRegions === 0 ? 1 : Math.max(0, 1 - unresolvedCells / inRegions);

    return {
      sheetName,
      formatUsed: this.#formatRegistry.defaultFormatId || 'none',
      cellOutcomes,
      outcomes: [...accepted, ...rejected, ...ignored],
      accepted,
      rejected,
      ignored,
      lessons: accepted.map((outcome) => outcome.lesson),
      stats: {
        totalRows: grid.rowCount,
        headerRow: regions[0]?.headerRow ?? -1,
        headerRows: regions.map((region) => region.headerRow),
        regionCount: regions.length,
        groupsFound: regions.reduce(
          (sum, region) =>
            sum + region.blocks.reduce((count, block) => count + block.groups.length, 0),
          0
        ),
        candidateCount: accepted.length + rejected.length,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        ignoredNonLessonCount: ignored.length,
        totalNonEmpty,
        inRegions,
        outOfRegions: totalNonEmpty - inRegions,
        lessonCells,
        partialCells,
        nonLessonCells,
        unresolvedCells,
        coverage,
        mergeCount: grid.mergeStats.total,
        mergeExpandedCount: grid.mergeStats.expanded,
        mergeExpandedCells: grid.mergeStats.filledCells,
        mergeRowsCovered: grid.mergeStats.rowsCovered,
        mergeColumnsCovered: grid.mergeStats.columnsCovered,
        expandedGroupCells: this.#expandedGroupCells(grid, regions),
      },
    };
  }

  // ------------------------------------------------------------------
  // Config helpers
  // ------------------------------------------------------------------

  #headerSyntax(): HeaderSyntax {
    const format = this.#formatRegistry.getDefault();
    return {
      groupCodePattern: format.structure.header.groupCodePattern,
      subgroupInGroupCode: format.parsing.subgroupInGroupCode,
      subgroupPattern: format.parsing.subgroupPattern,
      headerKeywords: format.detection.headerKeywords,
    };
  }

  #scanWindow(): { minHeaderRow: number; maxHeaderRow: number } {
    const { minHeaderRow, maxHeaderRow } = this.#formatRegistry.getDefault().detection;
    return { minHeaderRow, maxHeaderRow };
  }

  #hasDayHeader(grid: Grid, window: { minHeaderRow: number; maxHeaderRow: number }): boolean {
    const limit = Math.min(grid.rowCount - 1, window.maxHeaderRow);
    for (let row = window.minHeaderRow; row <= limit; row++) {
      const text = (grid.cells[row] ?? []).join(' ').toLowerCase();
      if (/апта\s*күндөрү|дни недели|расписание/.test(text)) return true;
    }
    return false;
  }

  #firstHeaderRow(
    grid: Grid,
    syntax: HeaderSyntax,
    window: { minHeaderRow: number; maxHeaderRow: number }
  ): number {
    for (
      let row = window.minHeaderRow;
      row <= Math.min(window.maxHeaderRow, grid.rowCount - 1);
      row++
    ) {
      if (extractBlocks(grid, row, syntax).length) return row;
    }
    return -1;
  }

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------

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

  #emptySheetResult(sheetName: string, code: ParseDiagnosticCode): ParseSheetResult {
    const cellOutcomes: ParseCellOutcome[] = [
      {
        status: 'unresolved',
        raw: '',
        lessons: [],
        partIndexes: [],
        row: 0,
        col: 0,
        inRegion: false,
        counted: false,
        regionIndex: -1,
        warnings: [],
        invalidFields: [],
        reason: 'Лист пуст',
      },
    ];
    return this.#terminalResult(
      sheetName,
      0,
      cellOutcomes,
      [
        {
          status: 'ignored',
          code,
          message: 'Лист пуст',
          provenance: { sheetName, sourceRow: 0, sourceColumn: 0, partIndex: 0 },
        },
      ],
      -1,
      [],
      0
    );
  }

  #failedSheetResult(
    sheetName: string,
    totalRows: number,
    headerRow: number,
    code: ParseDiagnosticCode,
    message: string
  ): ParseSheetResult {
    const cellOutcomes: ParseCellOutcome[] = [
      {
        status: 'unresolved',
        raw: '',
        lessons: [],
        partIndexes: [],
        row: Math.max(headerRow, 0),
        col: 0,
        inRegion: false,
        counted: false,
        regionIndex: -1,
        warnings: [],
        invalidFields: [],
        reason: message,
      },
    ];
    return this.#terminalResult(
      sheetName,
      totalRows,
      cellOutcomes,
      [
        {
          status: 'rejected',
          code,
          message,
          provenance: {
            sheetName,
            sourceRow: Math.max(headerRow + 1, 0),
            sourceColumn: 0,
            partIndex: 0,
          },
        },
      ],
      headerRow,
      [],
      0
    );
  }

  #terminalResult(
    sheetName: string,
    totalRows: number,
    cellOutcomes: ParseCellOutcome[],
    outcomes: ParseOutcome[],
    headerRow: number,
    headerRows: number[],
    groupsFound: number
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
    const unresolvedCells = cellOutcomes.filter(
      (cell) => cell.inRegion && cell.status === 'unresolved'
    ).length;
    const totalNonEmpty = cellOutcomes.length;
    return {
      sheetName,
      formatUsed: this.#formatRegistry.defaultFormatId || 'none',
      cellOutcomes,
      outcomes,
      accepted,
      rejected,
      ignored,
      lessons: accepted.map((outcome) => outcome.lesson),
      stats: {
        totalRows,
        headerRow,
        headerRows,
        regionCount: 0,
        groupsFound,
        candidateCount: accepted.length + rejected.length,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        ignoredNonLessonCount: ignored.length,
        totalNonEmpty,
        inRegions: 0,
        outOfRegions: totalNonEmpty,
        lessonCells: cellOutcomes.filter((cell) => cell.status === 'lesson').length,
        partialCells: cellOutcomes.filter((cell) => cell.status === 'partial').length,
        nonLessonCells: cellOutcomes.filter((cell) => cell.status === 'non_lesson').length,
        unresolvedCells,
        coverage: 1,
        mergeCount: 0,
        mergeExpandedCount: 0,
        mergeExpandedCells: 0,
        mergeRowsCovered: 0,
        mergeColumnsCovered: 0,
        expandedGroupCells: 0,
      },
    };
  }

  #aggregateReport(sheets: ParseSheetResult[]): ParseWorkbookReport {
    const sum = (pick: (stats: ParseSheetStats) => number) =>
      sheets.reduce((total, sheet) => total + pick(sheet.stats), 0);
    const inRegions = sum((stats) => stats.inRegions);
    const unresolvedCells = sum((stats) => stats.unresolvedCells);
    const acceptedCount = sum((stats) => stats.acceptedCount);
    const rejectedCount = sum((stats) => stats.rejectedCount);
    return {
      sheetCount: sheets.length,
      regionCount: sum((stats) => stats.regionCount),
      candidateCount: acceptedCount + rejectedCount,
      acceptedCount,
      rejectedCount,
      ignoredNonLessonCount: sum((stats) => stats.ignoredNonLessonCount),
      totalNonEmpty: sum((stats) => stats.totalNonEmpty),
      inRegions,
      outOfRegions: sum((stats) => stats.outOfRegions),
      lessonCells: sum((stats) => stats.lessonCells),
      partialCells: sum((stats) => stats.partialCells),
      nonLessonCells: sum((stats) => stats.nonLessonCells),
      unresolvedCells,
      coverage: inRegions === 0 ? 1 : Math.max(0, 1 - unresolvedCells / inRegions),
      mergeCount: sum((stats) => stats.mergeCount),
      mergeExpandedCount: sum((stats) => stats.mergeExpandedCount),
      mergeExpandedCells: sum((stats) => stats.mergeExpandedCells),
      mergeRowsCovered: sum((stats) => stats.mergeRowsCovered),
      mergeColumnsCovered: sum((stats) => stats.mergeColumnsCovered),
      expandedGroupCells: sum((stats) => stats.expandedGroupCells),
    };
  }

  #invalidWorkbookResult(message = 'Workbook имеет неверную структуру'): ParseWorkbookResult {
    const sheet = this.#failedSheetResult('<workbook>', 0, -1, 'invalid_input', message);
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

  static parseSheetRowsDetailed(
    rows: any[][],
    sheetName?: string,
    options?: ParseSheetOptions
  ): ParseSheetResult {
    return new ParserEngine().parseSheetRowsDetailed(rows, sheetName, options);
  }
}

function pushInto(map: Map<number, string[]>, key: number, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Share the parts of one authored cell out across the group columns it covers.
 *
 * A merged cell is a single authored cell that speaks for several group
 * columns. Replicating every part onto every column would publish the same
 * lesson several times for one subgroup, while assigning parts by column index
 * alone would mislabel them whenever the part count does not match the column
 * count. The rules keep every part and every covered group:
 *
 *  - one group column, any number of parts — all parts belong to that group;
 *  - one part, several groups — that part is the lesson for each of them;
 *  - as many parts as groups — positional, which is how a merged subgroup cell
 *    is authored;
 *  - more parts than groups — positional, remainder attached to the last group;
 *  - fewer parts than groups — the groups are split into contiguous blocks, one
 *    block per part.
 */
export function distributeParts(
  parts: CellPart[],
  slots: Slot[]
): Array<{ part: CellPart; slots: Slot[] }> {
  if (slots.length <= 1) return parts.map((part) => ({ part, slots }));
  if (parts.length === 1) return [{ part: parts[0], slots }];
  if (parts.length >= slots.length) {
    const out: Array<{ part: CellPart; slots: Slot[] }> = [];
    for (let i = 0; i < slots.length; i++) out.push({ part: parts[i], slots: [slots[i]] });
    for (let i = slots.length; i < parts.length; i++) {
      out.push({ part: parts[i], slots: [slots[slots.length - 1]] });
    }
    return out;
  }
  const out: Array<{ part: CellPart; slots: Slot[] }> = [];
  const base = Math.floor(slots.length / parts.length);
  const remainder = slots.length % parts.length;
  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    const size = base + (i < remainder ? 1 : 0);
    const slice = slots.slice(index, index + size);
    index += size;
    if (slice.length) out.push({ part: parts[i], slots: slice });
  }
  return out;
}

export const parserEngine = new ParserEngine();
export default ParserEngine;
