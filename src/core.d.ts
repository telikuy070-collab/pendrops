// Type declarations for existing core modules (JS files)

// cell.js
export function parseCell(
  text: string
): { subject: string; type: string; teacher: string; room: string; isExam: boolean } | null;
export function parseGroupCode(text: string): { code: string; subgroup: string } | null;
export function splitSubs(text: string): string[];

// day.js
export function detectDay(
  text: string
): 'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота' | 'Воскресенье' | null;

// timing.js
export function parseTimeRange(time: string): { start: string; end: string };
export function lessonState(
  lesson: { time?: string | null },
  currentTime: string
): 'upcoming' | 'now' | 'past' | 'idle';
export function getCurrentTime(): string;
export function getTodayName():
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота' | 'Воскресенье';

// constants.js
export const MAX_HEADER_SCAN_ROWS: number;
export const MAX_DAY_LOOKAHEAD: number;
export const STORAGE_KEY: string;
export const DAY_ORDER: string[];

// sheet.js
export function parseSheetRows(rows: any[][]): any[];
export function parseWorkbook(workbook: any, xlsx?: any): Record<string, any[]>;

// store.js
export function emptyState(): { sheets: Record<string, any[]>; current: string; group: string };
export function loadState(): Promise<{
  sheets: Record<string, any[]>;
  current: string;
  group: string;
}>;
export function saveState(state: any): Promise<'ls' | 'idb' | 'none'>;
export function clearState(): Promise<void>;
export function saveHandle(name: string, handle: any): Promise<boolean>;
export function loadHandle(name: string): Promise<any | null>;
