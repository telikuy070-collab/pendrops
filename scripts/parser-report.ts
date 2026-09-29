/**
 * Parser report for the real workbook.
 *
 * Prints the no-loss accounting that `tests/parser/no-loss.test.js` asserts:
 * how many cells exist, how each ended up, and what the resulting coverage is.
 * Run with `npm run report:parser`.
 */
import { ParserEngine } from '../src/parser/engine.ts';
import { checkWorkbook, readRealWorkbook, XLSX } from './parser-invariants.ts';

const { workbook, raw } = readRealWorkbook();
const parsed = new ParserEngine().parseWorkbookDetailed(workbook, XLSX);
const report = checkWorkbook(parsed, raw);
const stats = parsed.report;

console.log('=== data/schedule.xls ===');
console.log('sheets             ', stats.sheetCount);
console.log('regions            ', stats.regionCount);
console.log('');
console.log('merged cells (expanded before parsing)');
console.log('  merges declared  ', stats.mergeCount);
console.log('  merges expanded  ', stats.mergeExpandedCount);
console.log(
  '  cells filled     ',
  stats.mergeExpandedCells,
  '(empty cells that received an anchor value)'
);
console.log('  rows covered     ', stats.mergeRowsCovered);
console.log('  columns covered  ', stats.mergeColumnsCovered);
console.log(
  '  group cells      ',
  stats.expandedGroupCells,
  '(lessons the expanded grid can yield)'
);
console.log('');
console.log(
  'non-empty cells    ',
  stats.totalNonEmpty,
  `(${stats.inRegions} in regions, ${stats.outOfRegions} outside)`
);
console.log('');
console.log('terminal status of every cell:');
console.log('  lesson           ', stats.lessonCells);
console.log('  partial          ', stats.partialCells);
console.log('  non_lesson       ', stats.nonLessonCells);
console.log('  unresolved       ', stats.unresolvedCells);
console.log('');
console.log('coverage           ', `${(stats.coverage * 100).toFixed(2)}%`);
console.log('lessons published  ', stats.acceptedCount);
console.log('rejected           ', stats.rejectedCount);
console.log('ignored            ', stats.ignoredNonLessonCount);
console.log('');

console.log('per sheet');
for (const sheet of report.perSheet) {
  console.log(
    `  ${sheet.name.padEnd(4)} merges=${String(sheet.merges).padStart(3)}` +
      `  filled=${String(sheet.mergeFilledCells).padStart(3)}` +
      `  groupCells=${String(sheet.groupCells).padStart(4)}` +
      `  lessons=${String(sheet.accepted).padStart(4)}` +
      `  lesson=${String(sheet.lesson).padStart(4)}` +
      `  partial=${String(sheet.partial).padStart(3)}` +
      `  non_lesson=${String(sheet.nonLesson).padStart(5)}` +
      `  unresolved=${sheet.unresolved}` +
      `  coverage=${(sheet.coverage * 100).toFixed(2)}%`
  );
}

console.log('');
if (report.violations.length === 0) {
  console.log('invariant: OK — every authored cell accounted for exactly once');
} else {
  console.log(`invariant: ${report.violations.length} VIOLATIONS`);
  for (const violation of report.violations.slice(0, 20)) {
    console.log(`  ${violation.kind} ${violation.sheetName}: ${violation.detail}`);
  }
  process.exitCode = 1;
}

const unresolved = Object.entries(parsed.sheets).flatMap(([name, sheet]) =>
  sheet.cellOutcomes
    .filter((cell) => cell.status === 'unresolved')
    .map((cell) => `  ${name} r${cell.row + 1} c${cell.col + 1}: ${cell.reason}`)
);
console.log('');
console.log(
  unresolved.length === 0
    ? 'unresolved cells: none — coverage is 100%'
    : `unresolved cells (${unresolved.length}):\n${unresolved.join('\n')}`
);
if (unresolved.length) process.exitCode = 1;
