/**
 * Core Domain Types - Pure TypeScript, no external dependencies
 * These types define the business domain, independent of any infrastructure
 */

/** Day of week in Russian */
export type DayName = 'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота' | 'Воскресенье';

/** Lesson type */
export type LessonType = 'lecture' | 'practice' | 'lab' | 'exam' | 'consultation';

/** Lesson entity - core domain object */
export interface Lesson {
  id: string;
  sheetId: string;          // Which sheet/department (e.g., "Лечебное дело")
  day: DayName;
  dayOrder: number;         // 0-6 for sorting
  time: string;             // "08:30-10:05"
  para: string;             // "1", "2", etc.
  group: string;            // Group code (e.g., "ЛД-11")
  subgroup: string;         // "1", "2", or ""
  subject: string;
  type: LessonType;
  teacher: string;
  room: string;
  isExam: boolean;
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
}

/** Sheet/Department entity */
export interface Sheet {
  id: string;
  name: string;
  order: number;
  lessonCount: number;
}

/** Group entity */
export interface Group {
  code: string;
  sheetId: string;
  lessonCount: number;
  subgroups: string[];
}

/** User preferences (stored locally) */
export interface UserPreferences {
  currentSheetId: string;
  currentGroup: string;
  activeSubgroup: string;
  hiddenSheets: string[];
}

/** Schedule aggregate - what the UI consumes */
export interface ScheduleData {
  sheets: Map<string, Lesson[]>;
  sheetsMeta: Sheet[];
  groups: Map<string, Group>;
  preferences: UserPreferences;
  version: string;
  updatedAt: string;
}

/** Repository port - infrastructure implements this */
export interface IScheduleRepository {
  /** Load full schedule for offline-first UX */
  loadFull(): Promise<ScheduleData>;
  
  /** Subscribe to realtime changes */
  subscribe(callback: (data: ScheduleData) => void): () => void;
  
  /** Get current version for update checks */
  getVersion(): Promise<{ version: string; updatedAt: string }>;
  
  /** Admin: publish new schedule (replace all) */
  publish(schedule: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void>;
}

/** Auth port */
export interface IAuthProvider {
  verifyPin(pin: string): Promise<boolean>;
  isAdmin(): boolean;
}

/** Storage port */
export interface IStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}