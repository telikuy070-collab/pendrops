/**
 * Schedule regions: header detection and table splitting.
 *
 * A sheet may contain several independent tables ("regions"), each introduced
 * by its own header row. The previous implementation returned only the FIRST
 * header row it found (`#findHeaderRow`) and then treated everything below it
 * as one table, so a second table on the same sheet was never parsed at all —
 * which is exactly how a whole day disappears from the schedule.
 *
 * This module finds every header row and cuts the sheet into regions, each
 * running from its own header row to the next header row (or to the end of the
 * sheet's content).
 */
import { norm } from '../text.js';
import type { Grid } from './grid.ts';

export interface GroupRef {
  /** 0-based column index. */
  col: number;
  /** Group code without the subgroup suffix, e.g. `ПСТ-1-25`. */
  code: string;
  /** Subgroup taken from the header cell, e.g. `1` in `ПСТ-1-25 (1)`. */
  subgroup: string;
  /** Raw header text, kept for diagnostics. */
  raw: string;
}

export interface Block {
  /** 0-based day column. */
  dayCol: number;
  /** 0-based lesson-number column. */
  paraCol: number;
  /** 0-based time column. */
  timeCol: number;
  /** Group columns belonging to this table. */
  groups: GroupRef[];
}

export interface Region {
  /** 0-based header row of this region. */
  headerRow: number;
  /** 0-based exclusive end row (next header row, or end of sheet content). */
  endRow: number;
  /** Tables laid out side by side inside this region. */
  blocks: Block[];
}

/**
 * Header-cell marker for the day column. The day header is the anchor of every
 * table: the two columns to its right are the lesson number and the time, and
 * every column up to the next day header belongs to the same table.
 */
const HEADER_DAY_RE = /апта\s*күндөрү|дни недели|schedule|расписание|day|день/i;

export interface HeaderSyntax {
  /** Regex source matching a group code at the start of a header cell. */
  groupCodePattern: string;
  /** Whether the subgroup can be written inside the group code cell. */
  subgroupInGroupCode: boolean;
  /** Regex source with one capture group for the subgroup digit. */
  subgroupPattern: string;
  /** Keywords that mark a row as a schedule header. */
  headerKeywords: string[];
}

function headerDayCell(text: string): boolean {
  return HEADER_DAY_RE.test(text);
}

/** Parse the group columns that follow a day header in one header row. */
export function extractBlocks(grid: Grid, headerRow: number, syntax: HeaderSyntax): Block[] {
  const header = grid.cells[headerRow] ?? [];
  const codeRe = new RegExp(syntax.groupCodePattern);
  const subgroupRe = syntax.subgroupInGroupCode ? new RegExp(syntax.subgroupPattern) : null;
  const blocks: Block[] = [];

  let i = 0;
  while (i < header.length) {
    if (!headerDayCell(norm(header[i]))) {
      i++;
      continue;
    }
    const dayCol = i;
    const paraCol = i + 1;
    const timeCol = i + 2;
    const groups: GroupRef[] = [];

    let j = i + 3;
    while (j < header.length && !headerDayCell(norm(header[j]))) {
      const cellText = norm(header[j]);
      if (cellText) {
        const codeMatch = cellText.match(codeRe);
        if (codeMatch) {
          let code = codeMatch[0];
          let subgroup = '1';
          if (subgroupRe) {
            const subMatch = cellText.match(subgroupRe);
            if (subMatch?.[1]) {
              subgroup = subMatch[1];
              code = code.replace(subMatch[0], '').trim();
            }
          }
          groups.push({ col: j, code, subgroup, raw: cellText });
        }
      }
      j++;
    }
    if (groups.length) blocks.push({ dayCol, paraCol, timeCol, groups });
    i = j;
  }

  return blocks;
}

/** Does this row look like a schedule header (day header plus at least one group)? */
export function isHeaderRow(grid: Grid, row: number, syntax: HeaderSyntax): boolean {
  const text = (grid.cells[row] ?? []).map(norm).filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  const matchesKeyword = syntax.headerKeywords.some((keyword) =>
    text.includes(keyword.toLowerCase())
  );
  const hasDayHeader = (grid.cells[row] ?? []).some((cell) => headerDayCell(norm(cell)));
  if (!matchesKeyword && !hasDayHeader) return false;
  return extractBlocks(grid, row, syntax).length > 0;
}

/**
 * Every header row on the sheet, in order.
 *
 * The first header is still constrained by the format's scan window so that
 * unknown-format detection keeps its old meaning; later headers are searched
 * across the whole sheet, because a second table can start anywhere.
 */
export function findHeaderRows(
  grid: Grid,
  syntax: HeaderSyntax,
  options: { minHeaderRow: number; maxHeaderRow: number }
): number[] {
  const found: number[] = [];
  for (let r = 0; r < grid.rowCount; r++) {
    const withinScanWindow = r >= options.minHeaderRow && r <= options.maxHeaderRow;
    // A row that is not inside the first scan window is still accepted when it
    // is a structurally valid header; the keyword check inside
    // `isHeaderRow` keeps stray text from matching.
    if (!withinScanWindow && !hasFullHeaderShape(grid, r, syntax)) continue;
    if (isHeaderRow(grid, r, syntax)) found.push(r);
  }
  return found;
}

function hasFullHeaderShape(grid: Grid, row: number, syntax: HeaderSyntax): boolean {
  return extractBlocks(grid, row, syntax).length > 0;
}

/** Split the sheet into regions, one per header row. */
export function buildRegions(
  grid: Grid,
  syntax: HeaderSyntax,
  scanWindow: { minHeaderRow: number; maxHeaderRow: number }
): Region[] {
  const headerRows = findHeaderRows(grid, syntax, scanWindow);
  const contentEnd = grid.lastContentRow + 1;
  const regions: Region[] = [];

  for (let index = 0; index < headerRows.length; index++) {
    const headerRow = headerRows[index];
    const blocks = extractBlocks(grid, headerRow, syntax);
    if (!blocks.length) continue;
    const nextHeader = headerRows.slice(index + 1).find((row) => row > headerRow);
    // The region ends at the next header, or at the end of the sheet's content.
    //
    // Content end is used rather than the raw row count because a .xls export
    // can carry tens of thousands of empty trailing rows (ФЯ has 14 252). Those
    // rows hold no cells, so they are not part of any table. Blank *separator*
    // rows between content rows are inside the region and are reported as
    // `empty_row` diagnostics.
    const endRow = nextHeader !== undefined ? nextHeader : contentEnd;
    if (endRow <= headerRow) continue;
    regions.push({ headerRow, endRow, blocks });
  }

  return regions;
}

/** All group columns of a region, deduplicated and sorted. */
export function regionGroupColumns(region: Region): number[] {
  const columns = new Set<number>();
  for (const block of region.blocks) for (const group of block.groups) columns.add(group.col);
  return [...columns].sort((a, b) => a - b);
}

/** True when the cell coordinate belongs to a group column of this region. */
export function isRegionCell(region: Region, row: number, col: number): boolean {
  if (row < region.headerRow) return false;
  for (const block of region.blocks) {
    if (block.groups.some((group) => group.col === col)) return true;
  }
  return false;
}
