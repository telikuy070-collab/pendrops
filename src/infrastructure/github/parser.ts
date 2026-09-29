/**
 * Excel File Parser - Wraps the canonical SheetJS parser.
 * Implements the IFileParser port.
 *
 * `parseSchedule` returns a typed draft plus the full parser report, including
 * rejected-record diagnostics. The draft is a candidate, not an authority: the
 * Edge Function re-validates it and refuses to publish while rejects exist.
 *
 * `previewWorkbook` runs the very same parse once and returns both the draft
 * and the report, so the admin can inspect a file before publishing and then
 * publish exactly what was inspected.
 */
import type {
  IFileParser,
  ScheduleDraft,
  SchedulePreview,
  ParseDiagnostic,
  ParseSheetPreview,
} from '@core/domain/repositories/ports';
import { ParserEngine, type ParseWorkbookResult } from '../../parser/engine.ts';
import { MAX_REPORTED_DIAGNOSTICS, DAY_ORDER_LOOKUP, toPublishDraft } from '../../parser/draft.ts';

export const PARSER_VERSION = '1.0.0';

interface WorkbookLike {
  SheetNames: string[];
  Sheets: Record<string, any>;
}

export class ExcelFileParser implements IFileParser {
  private xlsxPromise: Promise<any> | null = null;
  private engine = new ParserEngine();

  async parseExcel(file: ArrayBuffer | File): Promise<WorkbookLike> {
    const XLSX = await this.loadXLSX();
    const buffer = file instanceof File ? await file.arrayBuffer() : file;
    // SheetJS browser build treats a bare ArrayBuffer as a generic array and
    // misparses binary XLSX. A Uint8Array is the supported binary input shape.
    const input = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    const workbook = XLSX.read(input, { type: 'array', cellDates: true });
    return { SheetNames: workbook.SheetNames, Sheets: workbook.Sheets };
  }

  /**
   * Parse once into a draft + report.
   *
   * `ignoredNonLessonCount` is reported separately from rejects: empty and
   * decorative rows are expected, rejected candidates are not.
   */
  async parseSchedule(file: ArrayBuffer | File): Promise<ScheduleDraft> {
    const { draft, diagnostics } = await this.#parseOnce(file);
    return { ...draft, diagnostics };
  }

  /** The admin preview: the same single parse, plus its per-sheet report. */
  async previewWorkbook(file: ArrayBuffer | File): Promise<SchedulePreview> {
    const { parsed, draft, diagnostics } = await this.#parseOnce(file);
    const sheets = describeSheets(parsed);
    return {
      draft: { ...draft, diagnostics },
      sheets,
      days: orderedDays(new Set(sheets.flatMap((sheet) => sheet.days))),
      report: parsed.report,
    };
  }

  /**
   * The one and only parse of a workbook.
   *
   * Both public entry points route through here, so the numbers the admin sees
   * in the preview and the rows that reach the database can never come from
   * two different runs of the engine.
   */
  async #parseOnce(file: ArrayBuffer | File): Promise<{
    parsed: ParseWorkbookResult;
    draft: Omit<ScheduleDraft, 'diagnostics'>;
    diagnostics: ParseDiagnostic[];
  }> {
    const XLSX = await this.loadXLSX();
    const workbook = await this.parseExcel(file);
    const parsed = this.engine.parseWorkbookDetailed(workbook, XLSX);

    const diagnostics: ParseDiagnostic[] = [];
    for (const sheet of Object.values(parsed.sheets)) {
      for (const outcome of sheet.outcomes) {
        if (outcome.status !== 'rejected') continue;
        if (diagnostics.length >= MAX_REPORTED_DIAGNOSTICS) continue;
        diagnostics.push({
          sheet: outcome.provenance.sheetName,
          row: outcome.provenance.sourceRow,
          code: outcome.code,
          message: outcome.message,
        });
      }
    }

    // Shared projection: the offline oracle compares against exactly this shape.
    const { lessons, report } = toPublishDraft(parsed);

    return { parsed, draft: { lessons, report }, diagnostics };
  }

  private async loadXLSX(): Promise<any> {
    if (this.xlsxPromise) return this.xlsxPromise;

    this.xlsxPromise = new Promise((resolve, reject) => {
      if ((window as any).XLSX) return resolve((window as any).XLSX);

      const script = document.createElement('script');
      script.src = 'xlsx.full.min.js';
      script.async = true;
      script.onload = () =>
        (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('XLSX not loaded'));
      script.onerror = () => reject(new Error('Failed to load xlsx.full.min.js'));
      document.head.appendChild(script);
    });

    return this.xlsxPromise;
  }
}

/** Weekdays holding at least one accepted lesson, in week order. */
function orderedDays(days: Set<string>): string[] {
  return Array.from(days).sort(
    (left, right) => (DAY_ORDER_LOOKUP[left] ?? 99) - (DAY_ORDER_LOOKUP[right] ?? 99)
  );
}

function describeSheets(parsed: ParseWorkbookResult): ParseSheetPreview[] {
  return Object.values(parsed.sheets).map((sheet) => ({
    sheetName: sheet.sheetName,
    lessonCount: sheet.stats.acceptedCount,
    days: orderedDays(new Set(sheet.accepted.map((outcome) => outcome.lesson.day))),
    stats: sheet.stats,
  }));
}
