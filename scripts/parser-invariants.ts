/**
 * No-loss invariant harness.
 *
 * Re-derives the expected cell inventory straight from the sheet geometry —
 * without using any parser code — and compares it with what the parser
 * actually produced. A disagreement means an authored cell was dropped,
 * counted twice, or classified outside the coverage denominator by accident.
 *
 * The same harness runs on the real workbook and on synthetic tables that each
 * reproduce one of the historical defects, so a regression in any single rule
 * fails the gate on its own.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { ParserEngine, type ParseSheetResult } from '../src/parser/engine.ts';
import { buildGrid, cellAt, continuationAnchor, type MergeRangeLike } from '../src/parser/grid.ts';
import { buildRegions, regionGroupColumns } from '../src/parser/regions.ts';
import { classifyNonLesson } from '../src/parser/cellText.ts';

const GROUP_HEADER = /^[А-ЯA-Z]{2,3}-\d-\d{2}/;
const HEADER_DAY_RE = /апта\s*күндөрү|дни недели|расписание|day|день/i;

export interface InventoryExpectation {
  /** Every non-empty authored cell on the sheet. */
  totalNonEmpty: number;
  /** Non-empty authored cells inside recognised regions. */
  inRegions: number;
  /** Sorted `row,col` keys of the in-region cells. */
  inRegionKeys: string[];
  /**
   * Distinct `(row, group, subgroup)` slots of the EXPANDED grid.
   *
   * The ceiling the published lessons are measured against. Derived from the
   * raw sheet, so it cannot be satisfied by the engine agreeing with itself.
   */
  expandedGroupCells: number;
  /**
   * The same count with knowingly non-lesson cells removed.
   *
   * A signature line or a totals row sits in a group column but is not a
   * lesson, so it must not be charged against the lesson count. `accepted`
   * must reach this figure, and may legitimately exceed it when the source
   * authors the same slot in two separate cells.
   */
  lessonBearingSlots: number;
}

const HEADER_SYNTAX = {
  groupCodePattern: '^[А-ЯA-Z]{2,3}-\\d-\\d{2}',
  subgroupInGroupCode: true,
  subgroupPattern: '\\((\\d+)\\)',
  headerKeywords: ['апта күндөрү'],
};

/**
 * Independent count of what the inventory must contain.
 *
 * Deliberately written against the raw sheet rather than the engine, so a bug
 * in the engine's own region detection cannot hide behind itself.
 */
export function expectInventory(
  rows: unknown[][],
  merges: MergeRangeLike[] | null,
  sheetName: string
): InventoryExpectation {
  const grid = buildGrid(rows, merges);

  let totalNonEmpty = 0;
  for (let r = 0; r < grid.rowCount; r++) {
    for (let c = 0; c < grid.colCount; c++) {
      if (cellAt(grid, r, c)) totalNonEmpty++;
    }
  }

  const regions = buildRegions(grid, HEADER_SYNTAX, { minHeaderRow: 0, maxHeaderRow: 30 });
  const claimed = new Set<string>();
  const slots = new Set<string>();
  const lessonSlots = new Set<string>();
  for (const region of regions) {
    for (const col of regionGroupColumns(region)) {
      const group = region.blocks.flatMap((block) => block.groups).find((g) => g.col === col);
      for (let row = region.headerRow + 1; row < region.endRow; row++) {
        const text = cellAt(grid, row, col);
        if (!text) continue;
        // A merged region is one authored cell: count its anchor only.
        const anchor = continuationAnchor(grid, row, col);
        const key = anchor ?? `${row},${col}`;
        claimed.add(key);
        // The expanded grid is counted per subgroup, because a header printed
        // across two columns describes one group occupying two columns.
        if (!group) continue;
        const slot = `${row}|${group.code}|${group.subgroup}`;
        slots.add(slot);
        if (!classifyNonLesson(text).isNonLesson) lessonSlots.add(slot);
      }
    }
  }

  return {
    totalNonEmpty,
    inRegions: claimed.size,
    inRegionKeys: [...claimed].sort(),
    expandedGroupCells: slots.size,
    lessonBearingSlots: lessonSlots.size,
  };
}

export interface InvariantViolation {
  sheetName: string;
  kind:
    | 'missing_cell'
    | 'duplicate_cell'
    | 'count_mismatch'
    | 'coverage_mismatch'
    | 'unexpanded_merge'
    | 'under_filled_expansion'
    | 'fabricated_lesson';
  detail: string;
}

/** Every way the "output equals input" contract can break. */
export function checkSheet(
  sheetName: string,
  result: ParseSheetResult,
  rows: unknown[][],
  merges: MergeRangeLike[] | null
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const expected = expectInventory(rows, merges, sheetName);
  const stats = result.stats;
  const grid = buildGrid(rows, merges);

  // (a) one outcome per non-empty authored cell, no more and no fewer.
  if (stats.totalNonEmpty !== expected.totalNonEmpty) {
    violations.push({
      sheetName,
      kind: 'count_mismatch',
      detail: `totalNonEmpty ${stats.totalNonEmpty} != independent count ${expected.totalNonEmpty}`,
    });
  }
  if (stats.inRegions !== expected.inRegions) {
    violations.push({
      sheetName,
      kind: 'count_mismatch',
      detail: `inRegions ${stats.inRegions} != independent count ${expected.inRegions}`,
    });
  }
  if (stats.expandedGroupCells !== expected.expandedGroupCells) {
    violations.push({
      sheetName,
      kind: 'count_mismatch',
      detail: `expandedGroupCells ${stats.expandedGroupCells} != independent count ${expected.expandedGroupCells}`,
    });
  }

  // (b) merges really were expanded, and the reported size of the expansion
  //     matches the sheet geometry. Without this the whole suite still passes
  //     when merge metadata stops reaching `buildGrid`: every surviving cell is
  //     still accounted for, so only the lesson count silently drops.
  if (stats.mergeCount !== (merges?.length ?? 0)) {
    violations.push({
      sheetName,
      kind: 'unexpanded_merge',
      detail: `mergeCount ${stats.mergeCount} != ${merges?.length ?? 0} declared on the sheet`,
    });
  }
  if (stats.mergeExpandedCells !== grid.mergeStats.filledCells) {
    violations.push({
      sheetName,
      kind: 'unexpanded_merge',
      detail: `mergeExpandedCells ${stats.mergeExpandedCells} != grid ${grid.mergeStats.filledCells}`,
    });
  }

  // (c) the expanded grid's slots are all served, and no lesson is invented.
  //     A slot whose text is a signature line or a totals row is knowingly not
  //     a lesson, so `lessonBearingSlots` — derived above straight from the
  //     sheet, without the engine — is the floor the lessons must reach.
  //     `accepted` may legitimately exceed it when the source authors the same
  //     slot in two cells; it must never fall short.
  if (result.accepted.length < expected.lessonBearingSlots) {
    violations.push({
      sheetName,
      kind: 'under_filled_expansion',
      detail: `only ${result.accepted.length} lessons for ${expected.lessonBearingSlots} lesson-bearing expanded group cells`,
    });
  }
  const gridAuthored = new Set<string>();
  for (let r = 0; r < grid.rowCount; r++) {
    for (let c = 0; c < grid.colCount; c++) if (cellAt(grid, r, c)) gridAuthored.add(`${r},${c}`);
  }
  for (const outcome of result.accepted) {
    const { provenance } = outcome;
    const r = provenance.sourceRow - 1;
    const c = provenance.sourceColumn - 1;
    const anchor = continuationAnchor(grid, r, c) ?? `${r},${c}`;
    if (gridAuthored.has(anchor)) continue;
    violations.push({
      sheetName,
      kind: 'fabricated_lesson',
      detail: `lesson at r${r + 1}c${c + 1} traces to an empty cell (fill-down)`,
    });
  }

  // (b) no cell is missing from the inventory, and none appears twice.
  const seen = new Map<string, number>();
  for (const cell of result.cellOutcomes) {
    const key = `${cell.row},${cell.col}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const key of expected.inRegionKeys) {
    if (!seen.has(key)) {
      violations.push({ sheetName, kind: 'missing_cell', detail: `cell ${key} vanished` });
    }
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      violations.push({
        sheetName,
        kind: 'duplicate_cell',
        detail: `cell ${key} claimed ${count}×`,
      });
    }
  }

  // (c) coverage is exactly `1 - unresolved / inRegions`, and every counted
  //     cell really is in a region.
  const expectedCoverage = stats.inRegions === 0 ? 1 : 1 - stats.unresolvedCells / stats.inRegions;
  if (Math.abs(stats.coverage - expectedCoverage) > 1e-9) {
    violations.push({
      sheetName,
      kind: 'coverage_mismatch',
      detail: `coverage ${stats.coverage} != 1 - ${stats.unresolvedCells}/${stats.inRegions}`,
    });
  }
  const counted = result.cellOutcomes.filter((cell) => cell.counted);
  if (counted.length !== stats.inRegions) {
    violations.push({
      sheetName,
      kind: 'count_mismatch',
      detail: `${counted.length} cells flagged counted, stats.inRegions says ${stats.inRegions}`,
    });
  }
  for (const cell of result.cellOutcomes) {
    if (cell.counted && !cell.inRegion) {
      violations.push({
        sheetName,
        kind: 'count_mismatch',
        detail: `cell ${cell.row},${cell.col} counted but outside every region`,
      });
    }
    // Every cell must reach a terminal status; none may be left undefined.
    if (!['lesson', 'partial', 'non_lesson', 'unresolved'].includes(cell.status)) {
      violations.push({
        sheetName,
        kind: 'count_mismatch',
        detail: `cell ${cell.row},${cell.col} has no terminal status (${String(cell.status)})`,
      });
    }
  }

  return violations;
}

export interface WorkbookCheck {
  violations: InvariantViolation[];
  sheetCount: number;
  totalNonEmpty: number;
  inRegions: number;
  unresolvedCells: number;
  coverage: number;
  acceptedCount: number;
  perSheet: Array<{
    name: string;
    merges: number;
    mergeFilledCells: number;
    groupCells: number;
    accepted: number;
    lesson: number;
    partial: number;
    nonLesson: number;
    unresolved: number;
    coverage: number;
  }>;
}

/** Run the full harness over a parsed workbook plus its raw rows/merges. */
export function checkWorkbook(
  parsed: { sheets: Record<string, ParseSheetResult>; report: { coverage: number } },
  raw: Record<string, { rows: unknown[][]; merges: MergeRangeLike[] | null }>
): WorkbookCheck {
  const violations: InvariantViolation[] = [];
  const perSheet: WorkbookCheck['perSheet'] = [];

  for (const [name, result] of Object.entries(parsed.sheets)) {
    const source = raw[name];
    if (source) violations.push(...checkSheet(name, result, source.rows, source.merges));
    perSheet.push({
      name,
      merges: result.stats.mergeCount,
      mergeFilledCells: result.stats.mergeExpandedCells,
      groupCells: result.stats.expandedGroupCells,
      accepted: result.accepted.length,
      lesson: result.stats.lessonCells,
      partial: result.stats.partialCells,
      nonLesson: result.stats.nonLessonCells,
      unresolved: result.stats.unresolvedCells,
      coverage: result.stats.coverage,
    });
  }

  return {
    violations,
    sheetCount: parsed.sheets ? Object.keys(parsed.sheets).length : 0,
    totalNonEmpty: parsed.sheets
      ? Object.values(parsed.sheets).reduce((sum, s) => sum + s.stats.totalNonEmpty, 0)
      : 0,
    inRegions: parsed.sheets
      ? Object.values(parsed.sheets).reduce((sum, s) => sum + s.stats.inRegions, 0)
      : 0,
    unresolvedCells: parsed.sheets
      ? Object.values(parsed.sheets).reduce((sum, s) => sum + s.stats.unresolvedCells, 0)
      : 0,
    coverage: parsed.sheets ? parsed.report.coverage : 0,
    acceptedCount: parsed.sheets
      ? Object.values(parsed.sheets).reduce((sum, s) => sum + s.accepted.length, 0)
      : 0,
    perSheet,
  };
}

/**
 * The tracked schedule, resolved from the repository root so the path works on
 * every machine and on the CI runner. A hardcoded absolute path makes the
 * invariant test fail everywhere except the author's laptop.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readRealWorkbook(file = resolve(REPO_ROOT, 'data/schedule.xls')) {
  const buffer = readFileSync(file);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const raw: Record<string, { rows: unknown[][]; merges: MergeRangeLike[] | null }> = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    raw[name] = {
      rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: true }),
      merges: (sheet['!merges'] as MergeRangeLike[] | undefined) ?? null,
    };
  }
  return { workbook, raw };
}

export { GROUP_HEADER, HEADER_DAY_RE, XLSX, ParserEngine };
