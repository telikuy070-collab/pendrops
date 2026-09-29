/**
 * Core Domain Types - Pure TypeScript, no external dependencies
 * These types define the business domain, independent of any infrastructure
 */

/** Day of week in Russian */
export type DayName =
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота' | 'Воскресенье';

/** Lesson type */
export type LessonType = 'lecture' | 'practice' | 'lab' | 'exam' | 'consultation';

/** Lesson entity - core domain object */
export interface Lesson {
  id: string;
  sheetId: string; // Which sheet/department (e.g., "Лечебное дело")
  day: DayName;
  dayOrder: number; // 0-6 for sorting
  time: string; // "08:30-10:05"
  para: string; // "1", "2", etc.
  group: string; // Group code (e.g., "ЛД-11")
  subgroup: string; // "1", "2", or ""
  subject: string;
  type: LessonType;
  teacher: string;
  room: string;
  isExam: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
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
  /**
   * The remembered "my schedule" selection.
   *
   * Browsing another department must not destroy the student's own selection,
   * so the picker only moves `current*`; these fields change when the student
   * explicitly says "это моя группа". Older stored preferences have none of
   * them, and fall back to the current selection.
   */
  mySheetId?: string;
  myGroup?: string;
  mySubgroup?: string;
  /**
   * The student chose "посмотреть всё расписание" instead of picking a group.
   * Remembered so the first-run chooser really is a first-run thing.
   */
  onboardingSkipped?: boolean;
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

// Repository and auth ports live in @core/domain/repositories/ports.
// They are deliberately not duplicated here: this module is the pure entity
// vocabulary that the presentation and application layers consume.
