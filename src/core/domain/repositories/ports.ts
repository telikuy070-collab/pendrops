/**
 * Repository Interface - Port for Schedule Data Access
 * Implemented by infrastructure layer (Supabase, LocalStorage, etc.)
 */
import type { ScheduleData, Lesson, Sheet, Group } from '@core/domain/entities/types';
import type { PublishLessonV1, PublishReportV1 } from '../../../parser/publishWire.ts';
// Type-only: the preview surfaces the parser's own report verbatim instead of
// re-declaring a parallel set of counters that could drift from the engine.
import type { ParseSheetStats, ParseWorkbookReport } from '../../../parser/engine.ts';

/** Outcome of a successful publish, reported back to the admin UI. */
export interface PublishResult {
  version: string;
  count: number;
}

/** Optional source-file metadata recorded alongside the published version. */
export interface PublishFileMeta {
  fileName?: string | null;
  fileSize?: number | null;
}

/** How far a chunked publish has got. */
export interface PublishProgress {
  /** Rows accepted by the database so far. */
  uploaded: number;
  /** Rows the publish will write in total. */
  total: number;
  /** 1-based index of the request currently in flight, 0 before the first one. */
  chunk: number;
  /** How many requests this publish needs. */
  chunks: number;
  /** True once every chunk has landed. */
  done: boolean;
}

/**
 * Caller-side control of a running publish.
 *
 * Neither field changes what a successful publish writes — insert, then delete
 * the previous rows, then bump the version. `shouldAbort` only lets the admin
 * stop *between* chunk requests; the rows already accepted stay in the table,
 * which is why the abort is reported separately from a failure.
 */
export interface PublishOptions {
  onProgress?: (progress: PublishProgress) => void;
  shouldAbort?: () => boolean;
}

export interface IScheduleRepository {
  /** Load complete schedule for offline-first UX */
  loadFull(): Promise<ScheduleData>;

  /** Subscribe to realtime changes */
  subscribe(callback: (data: ScheduleData) => void): () => void;

  /** Get current version for update checks */
  getVersion(): Promise<{ version: string; updatedAt: string }>;

  /** Get incremental changes since a version */
  getChangesSince(version: string): Promise<{ lessons: Lesson[]; version: string }>;

  /** Admin: publish new schedule (replace all) */
  publish(
    lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[],
    meta?: PublishFileMeta,
    options?: PublishOptions
  ): Promise<PublishResult>;

  /** Admin: publish from parsed Excel workbook */
  publishFromWorkbook(
    workbook: { SheetNames: string[]; Sheets: Record<string, any> },
    xlsx?: any,
    meta?: PublishFileMeta
  ): Promise<PublishResult>;
}

export interface IAuthProvider {
  verifyPin(pin: string): Promise<boolean>;
  isAdmin(): boolean;
  getSession(): Promise<{ user: any; accessToken: string } | null>;
}

export interface IStorage {
  get<T>(key: string): Promise<T | null>;
  /** Resolves to false when the write failed and the previous value was kept. */
  set<T>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<void>;
}

/** One sheet of the admin preview, carrying the engine's own sheet stats. */
export interface ParseSheetPreview {
  sheetName: string;
  /** Lessons this sheet would publish. */
  lessonCount: number;
  /** Weekdays that hold at least one parsed lesson on this sheet. */
  days: string[];
  stats: ParseSheetStats;
}

/**
 * Everything the admin needs to decide whether to publish — produced by a
 * single parse, and reused verbatim when the publish actually runs.
 */
export interface SchedulePreview {
  draft: ScheduleDraft;
  sheets: ParseSheetPreview[];
  /** Weekdays found anywhere in the workbook, in week order. */
  days: string[];
  /** The engine's aggregate report: coverage, counters, nothing re-derived. */
  report: ParseWorkbookReport;
}

export interface IFileParser {
  parseExcel(
    file: ArrayBuffer | File
  ): Promise<{ SheetNames: string[]; Sheets: Record<string, any> }>;

  /** Parse once into a publishable draft plus the full parser report. */
  parseSchedule(file: ArrayBuffer | File): Promise<ScheduleDraft>;

  /**
   * Parse once into a publishable draft *and* the report the admin preview
   * shows. The draft is part of the result so publishing never parses again.
   */
  previewWorkbook(file: ArrayBuffer | File): Promise<SchedulePreview>;
}

/** One rejected parser candidate, reported instead of being dropped silently. */
export interface ParseDiagnostic {
  sheet: string;
  row: number;
  code: string;
  message: string;
}

/** A parse result: accepted records, aggregate counters and rejects. */
export interface ScheduleDraft {
  lessons: PublishLessonV1[];
  report: PublishReportV1;
  diagnostics: ParseDiagnostic[];
}
