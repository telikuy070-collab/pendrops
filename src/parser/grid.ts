/**
 * Grid materialisation.
 *
 * The parser used to read cells straight out of `sheet_to_json`, where a merged
 * cell only exists in its top-left corner. Every covered cell came back as an
 * empty string, and `#readDataCell` then "repaired" it by walking UP the column
 * and taking the first non-empty value it found.
 *
 * That repair was the single largest source of silent data loss and corruption:
 *
 *  - a caption written into the time column (e.g. the director's signature line)
 *    was picked up as the time of every row below it, because the walk-up took
 *    the first non-empty value regardless of whether it was even a time;
 *  - a lesson cell covered by a horizontal merge produced its text for the anchor
 *    column only, while the sibling subgroup columns received a value belonging
 *    to a completely different row further up.
 *
 * Merged regions are therefore expanded into a dense grid BEFORE any parsing
 * happens, so every physical cell holds the value Excel visually shows for it.
 * The merge index is kept so the engine can still tell that a group of columns
 * came from one authored cell and can distribute slash-separated parts across
 * those columns (see `regions.ts`).
 */

import { norm } from '../text.js';

/** SheetJS range shape (`{s:{r,c}, e:{r,c}}`) accepted for merge ranges. */
export interface MergeRangeLike {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface MergeSpan {
  /** 0-based anchor row (top-left of the merged region). */
  row: number;
  /** 0-based anchor column. */
  col: number;
  /** 0-based inclusive last column of the region. */
  lastCol: number;
  /** 0-based inclusive last row of the region. */
  lastRow: number;
  /** True when the region spans more than one column. */
  horizontal: boolean;
  /** True when the region spans more than one row. */
  vertical: boolean;
}

/**
 * What merge expansion actually did to this sheet.
 *
 * The no-loss invariant is stated over the EXPANDED grid, so the size of the
 * expansion has to be visible rather than implied. Without these numbers a
 * silent regression — merges no longer being handed to `buildGrid` — would
 * still leave the parser "passing", because every cell that survived would
 * still be accounted for; only the lessons would quietly disappear.
 */
export interface MergeStats {
  /** Merge regions declared by the sheet. */
  total: number;
  /** Regions that carried text in their anchor and were expanded into it. */
  expanded: number;
  /** Regions whose anchor was empty, so there was nothing to copy. */
  emptyAnchors: number;
  /** Cells that were empty before expansion and received the anchor's value. */
  filledCells: number;
  /** Distinct rows touched by an expanded region. */
  rowsCovered: number;
  /** Distinct columns touched by an expanded region. */
  columnsCovered: number;
}

export interface Grid {
  /** Dense rectangular grid of normalised strings. */
  cells: string[][];
  /** Number of rows (may be larger than `cells.length` if the input was sparse). */
  rowCount: number;
  /** Number of columns. */
  colCount: number;
  /** Merge regions, keyed by `row,col` of the anchor cell. */
  merges: Map<string, MergeSpan>;
  /** Cells covered by a merge but not its anchor, mapped to the anchor key. */
  continuations: Map<string, string>;
  /** Rows that hold at least one non-empty value. */
  lastContentRow: number;
  /** Accounting for the expansion described above. */
  mergeStats: MergeStats;
}

function key(row: number, col: number): string {
  return `${row},${col}`;
}

function normaliseRange(range: MergeRangeLike): MergeSpan | null {
  const s = range?.s;
  const e = range?.e;
  if (!s || !e) return null;
  if (!Number.isFinite(s.r) || !Number.isFinite(s.c)) return null;
  const row = Math.min(s.r, e.r);
  const lastRow = Math.max(s.r, e.r);
  const col = Math.min(s.c, e.c);
  const lastCol = Math.max(s.c, e.c);
  return {
    row,
    col,
    lastRow,
    lastCol,
    horizontal: lastCol > col,
    vertical: lastRow > row,
  };
}

/** Number of columns required to hold every merge and every row of the sheet. */
function measureColumns(rows: unknown[][], spans: MergeSpan[]): number {
  let columns = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  for (const span of spans) columns = Math.max(columns, span.lastCol + 1);
  return columns;
}

/**
 * Build a dense grid in which merged regions are expanded.
 *
 * Expansion copies the anchor value only into cells that are actually empty.
 * A sheet that stores a value in a covered cell (which Excel allows but does
 * not display) therefore keeps that value instead of being overwritten.
 *
 * @param rows Raw `sheet_to_json` output, still containing unexpanded merges.
 * @param mergeRanges `sheet['!merges']`, or `undefined` when the caller has no
 *   merge metadata (for example a plain array of rows handed to the parser).
 */
export function buildGrid(rows: unknown[][], mergeRanges?: MergeRangeLike[] | null): Grid {
  const source = Array.isArray(rows) ? rows : [];
  const spans: MergeSpan[] = [];
  for (const range of mergeRanges ?? []) {
    const span = normaliseRange(range);
    if (span) spans.push(span);
  }

  const rowCount = source.length;
  const colCount = measureColumns(source as unknown[][], spans);
  const cells: string[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(''));

  for (let r = 0; r < rowCount; r++) {
    const row = source[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length && c < colCount; c++) cells[r][c] = norm(row[c]);
  }

  const merges = new Map<string, MergeSpan>();
  const continuations = new Map<string, string>();
  const rowsCovered = new Set<number>();
  const columnsCovered = new Set<number>();
  let expanded = 0;
  let emptyAnchors = 0;

  for (const span of spans) {
    const value = cells[span.row]?.[span.col] ?? '';
    merges.set(key(span.row, span.col), span);
    if (!value) {
      emptyAnchors++;
      continue;
    }
    expanded++;
    let filled = 0;
    for (let r = span.row; r <= span.lastRow; r++) {
      if (r >= rowCount) break;
      for (let c = span.col; c <= span.lastCol; c++) {
        // Only fill genuinely empty cells: a value stored in a covered cell is
        // real authored data even though Excel hides it behind the merge.
        if (cells[r][c]) continue;
        cells[r][c] = value;
        if (r !== span.row || c !== span.col) {
          continuations.set(key(r, c), key(span.row, span.col));
          rowsCovered.add(r);
          columnsCovered.add(c);
          filled++;
        }
      }
    }
    // A single-cell "merge" is a formatting artefact with nothing to expand,
    // but it still counts as touched geometry for the row/column report.
    if (!filled) {
      rowsCovered.add(span.row);
      columnsCovered.add(span.col);
    }
  }

  const mergeStats: MergeStats = {
    total: spans.length,
    expanded,
    emptyAnchors,
    filledCells: continuations.size,
    rowsCovered: rowsCovered.size,
    columnsCovered: columnsCovered.size,
  };

  let lastContentRow = -1;
  for (let r = rowCount - 1; r >= 0; r--) {
    if (cells[r].some((cell) => cell !== '')) {
      lastContentRow = r;
      break;
    }
  }

  return { cells, rowCount, colCount, merges, continuations, lastContentRow, mergeStats };
}

/** Read a cell of the materialised grid; out-of-range reads yield `''`. */
export function cellAt(grid: Grid, row: number, col: number): string {
  if (row < 0 || col < 0) return '';
  return grid.cells[row]?.[col] ?? '';
}

/** Merge span anchored at this cell, if any. */
export function mergeAt(grid: Grid, row: number, col: number): MergeSpan | undefined {
  return grid.merges.get(key(row, col));
}

/** True when the cell sits inside a merge but is not its anchor. */
export function isMergeContinuation(grid: Grid, row: number, col: number): boolean {
  return grid.continuations.has(key(row, col));
}

/** Anchor key of the merge that covers this cell, if the cell is a continuation. */
export function continuationAnchor(grid: Grid, row: number, col: number): string | undefined {
  return grid.continuations.get(key(row, col));
}
