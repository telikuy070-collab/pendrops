/**
 * The admin's read-only view of one parse, before anything is published.
 *
 * Everything here is derived from what `ParserEngine` already reported: the
 * coverage figure, the merge and cell counters and the per-sheet breakdown are
 * carried through untouched rather than recomputed, so the preview cannot
 * disagree with the parser. The only thing this module adds is wording.
 *
 * Warnings never block a publish. They exist because a schedule is published by
 * a human who has one chance to notice that a sheet lost its Friday.
 */
import type { ScheduleData } from '../core/domain/entities/types';
import type { SchedulePreview } from '@core/domain/repositories/ports';
import { diffSchedules, type ScheduleDiff } from './diff.ts';

export type PreviewSeverity = 'error' | 'warn' | 'info';

export interface PreviewWarning {
  severity: PreviewSeverity;
  text: string;
}

export interface PreviewSheetRow {
  sheetId: string;
  lessonCount: number;
  coverageText: string;
  daysText: string;
  /** Weekdays this sheet has now but did not have in the current schedule. */
  lostDays: string[];
  /** Cells inside the parsed tables — the denominator of `coverageText`. */
  inRegions: number;
  /** Cells that held text and produced no lesson. */
  unresolvedCells: number;
}

export interface PreviewCounters {
  /** Merge regions the sheet declared. */
  merges: number;
  /** Cells that were empty until a merge filled them. */
  expandedGroupCells: number;
  /** Authored cells inside the parsed tables — the coverage denominator. */
  inRegions: number;
  /** Cells that held text and produced no lesson. */
  unresolved: number;
  /** Cells positively identified as not a lesson. */
  ignored: number;
  /** Candidates the parser refused. */
  rejected: number;
}

export interface PreviewView {
  totalLessons: number;
  coverage: number;
  coverageText: string;
  daysText: string;
  days: string[];
  sheets: PreviewSheetRow[];
  counters: PreviewCounters;
  countersText: string;
  warnings: PreviewWarning[];
  /** Up to five refused candidates, quoted so the numbers have a face. */
  rejectedSamples: string[];
  /** Comparison against what is published right now. */
  diff: ScheduleDiff;
}

/** `1234` → `1 234` with a non-breaking space, the way it reads in Russian. */
export function formatCount(value: number): string {
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return rounded < 0 ? `-${grouped}` : grouped;
}

/** `0.9642` → `96.4%`. Coverage below 100 % always shows one decimal. */
export function formatCoverage(coverage: number): string {
  const percent = Math.max(0, Math.min(1, coverage)) * 100;
  return percent >= 99.95 && percent <= 100 ? '100%' : `${percent.toFixed(1).replace('.', ',')}%`;
}

/** Days as one readable line; an empty sheet says so instead of showing blank. */
export function formatDays(days: readonly string[]): string {
  return days.length ? days.join(', ') : 'нет';
}

/**
 * Turns a parse into everything the admin dialog renders.
 *
 * `current` is the schedule the app already shows; when it is null the diff
 * degrades to "everything is new" and no day-loss warning can be made.
 */
export function buildPreviewView(
  preview: SchedulePreview,
  current: ScheduleData | null
): PreviewView {
  const report = preview.report;
  const diff = diffSchedules(current, preview.draft.lessons);

  const sheetRows: PreviewSheetRow[] = preview.sheets.map((sheet) => {
    const sheetDiff = diff.sheets.find((entry) => entry.sheetId === sheet.sheetName);
    return {
      sheetId: sheet.sheetName,
      lessonCount: sheet.lessonCount,
      coverageText: formatCoverage(sheet.stats.coverage),
      daysText: formatDays(sheet.days),
      lostDays: sheetDiff?.lostDays ?? [],
      inRegions: sheet.stats.inRegions,
      unresolvedCells: sheet.stats.unresolvedCells,
    };
  });

  const counters: PreviewCounters = {
    merges: report.mergeCount,
    expandedGroupCells: report.mergeExpandedCells,
    inRegions: report.inRegions,
    unresolved: report.unresolvedCells,
    ignored: report.ignoredNonLessonCount,
    rejected: report.rejectedCount,
  };

  const warnings = collectWarnings(preview, counters, diff, sheetRows);

  return {
    totalLessons: preview.draft.lessons.length,
    coverage: report.coverage,
    coverageText: formatCoverage(report.coverage),
    daysText: formatDays(preview.days),
    days: preview.days,
    sheets: sheetRows,
    counters,
    countersText: formatCounters(counters),
    warnings,
    rejectedSamples: preview.draft.diagnostics.map(
      (diagnostic) => `${diagnostic.sheet} · стр. ${diagnostic.row}: ${diagnostic.message}`
    ),
    diff,
  };
}

function formatCounters(counters: PreviewCounters): string {
  return [
    `объединений: ${formatCount(counters.merges)}`,
    `развёрнуто объединённых ячеек: ${formatCount(counters.expandedGroupCells)}`,
    `ячеек в таблицах: ${formatCount(counters.inRegions)}`,
    `не разобрано: ${formatCount(counters.unresolved)}`,
    `пропущено как не-занятия: ${formatCount(counters.ignored)}`,
    `отклонено: ${formatCount(counters.rejected)}`,
  ].join(' · ');
}

/**
 * Everything worth saying before publishing.
 *
 * Ordered by how much it matters: nothing publishable, then a sheet that would
 * vanish, then a day that would vanish, then the coverage figure, then the
 * parser's refusals. None of it stops the publish button.
 */
function collectWarnings(
  preview: SchedulePreview,
  counters: PreviewCounters,
  diff: ScheduleDiff,
  sheetRows: PreviewSheetRow[]
): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  const totalLessons = preview.draft.lessons.length;

  if (totalLessons === 0) {
    warnings.push({
      severity: 'error',
      text: 'В файле не найдено ни одного занятия. Публиковать нечего — скорее всего, выбран не тот файл.',
    });
  }

  for (const sheetId of diff.missingSheets) {
    warnings.push({
      severity: 'error',
      text: `Лист «${sheetId}» есть в текущем расписании, но в файле его нет — после публикации все его занятия исчезнут.`,
    });
  }

  for (const sheet of sheetRows) {
    if (!sheet.lostDays.length) continue;
    warnings.push({
      severity: 'warn',
      text: `Лист «${sheet.sheetId}»: ${formatDays(sheet.lostDays)} — в прошлой публикации были, в этом файле нет.`,
    });
  }

  if (counters.unresolved > 0) {
    warnings.push({
      severity: counters.unresolved / Math.max(1, counters.inRegions) > 0.05 ? 'warn' : 'info',
      text: `Покрытие разбора ${formatCoverage(preview.report.coverage)}: ${formatCount(counters.unresolved)} из ${formatCount(counters.inRegions)} ячеек не превратились в занятия.`,
    });
  }

  for (const sheet of sheetRows) {
    if (sheet.unresolvedCells === 0) continue;
    warnings.push({
      severity: 'info',
      text: `Лист «${sheet.sheetId}»: покрытие ${sheet.coverageText} — не разобрано ${formatCount(sheet.unresolvedCells)} из ${formatCount(sheet.inRegions)} ячеек.`,
    });
  }

  if (counters.rejected > 0) {
    warnings.push({
      severity: 'warn',
      text: `Парсер отклонил ${formatCount(counters.rejected)} кандидатов — эти занятия не попадут в расписание.`,
    });
  }

  return warnings;
}
