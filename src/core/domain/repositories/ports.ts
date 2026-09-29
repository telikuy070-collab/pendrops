/**
 * Repository Interface - Port for Schedule Data Access
 * Implemented by infrastructure layer (Supabase, LocalStorage, etc.)
 */
import type { ScheduleData, Lesson, Sheet, Group } from '@core/domain/entities/types';
import type { PublishLessonV1, PublishReportV1 } from '../../../parser/publishWire.ts';

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
  publish(lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void>;

  /** Admin: publish from parsed Excel workbook */
  publishFromWorkbook(
    workbook: { SheetNames: string[]; Sheets: Record<string, any> },
    xlsx: any
  ): Promise<void>;
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

export interface IFileParser {
  parseExcel(
    file: ArrayBuffer | File
  ): Promise<{ SheetNames: string[]; Sheets: Record<string, any> }>;

  /** Parse once into a publishable draft plus the full parser report. */
  parseSchedule(file: ArrayBuffer | File): Promise<ScheduleDraft>;
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
