/**
 * What changes when the picked file is published instead of what is in the
 * database now.
 *
 * The comparison is multiset-based: two lessons are "the same lesson" when
 * they share sheet, day, time, lesson number, group, subgroup and subject.
 * Teacher, room and type are deliberately *not* part of the identity — a
 * reassigned room changes a lesson, it does not make it disappear, and listing
 * every such change would bury the real losses.
 *
 * Only a handful of examples of each side is returned. A schedule loses lessons
 * by the hundred, and a diff that prints them all is a diff nobody reads.
 */
import type { Lesson, ScheduleData } from '../core/domain/entities/types';
import type { PublishLessonV1 } from '../parser/publishWire.ts';
import { DAY_ORDER_LOOKUP } from '../parser/draft.ts';

/** How many disappearing / appearing lessons the admin is shown. */
export const MAX_DIFF_SAMPLES = 5;

/** One lesson quoted in the diff, flattened for display. */
export interface DiffSample {
  sheetId: string;
  day: string;
  time: string;
  para: string;
  group: string;
  subgroup: string;
  subject: string;
  /** Ready-to-render one-liner. */
  text: string;
}

/** Per-sheet comparison, including the days the new file no longer has. */
export interface SheetDiff {
  sheetId: string;
  current: number;
  next: number;
  /** `next - current`; negative means the sheet shrinks. */
  delta: number;
  /** Weekdays present now but absent from the file. */
  lostDays: string[];
  /** Weekdays the file adds. */
  newDays: string[];
}

export interface ScheduleDiff {
  currentTotal: number;
  nextTotal: number;
  /** `nextTotal - currentTotal`. */
  delta: number;
  /** Every sheet on either side, sorted by name. */
  sheets: SheetDiff[];
  /** Sheets currently published that the file does not contain at all. */
  missingSheets: string[];
  /** Sheets the file adds. */
  newSheets: string[];
  disappearedCount: number;
  appearedCount: number;
  /** Up to `MAX_DIFF_SAMPLES` lessons that would vanish. */
  disappearing: DiffSample[];
  /** Up to `MAX_DIFF_SAMPLES` lessons that would appear. */
  appearing: DiffSample[];
  /** Weekdays per sheet in the current schedule. */
  currentDays: Record<string, string[]>;
  /** Weekdays per sheet in the file. */
  nextDays: Record<string, string[]>;
  /** True when the file would change nothing at all. */
  identical: boolean;
}

/**
 * Identity key of one lesson.
 *
 * Values are coerced rather than assumed: a malformed row from the database
 * must not be able to break the comparison the admin is reading.
 */
function key(parts: (string | number | boolean | null | undefined)[]): string {
  return parts
    .map((part) =>
      String(part ?? '')
        .trim()
        .toLowerCase()
    )
    .join('|');
}

/** Identity of a published lesson, in the shape the database holds. */
function currentKey(lesson: Lesson): string {
  return key([
    lesson.sheetId,
    lesson.day,
    lesson.time,
    lesson.para,
    lesson.group,
    lesson.subgroup,
    lesson.subject,
  ]);
}

/** Identity of a parsed lesson, in the same shape. */
function nextKey(record: PublishLessonV1): string {
  return key([
    record.sheet_id,
    record.day,
    record.time,
    record.para,
    record.group_code,
    record.subgroup,
    record.subject,
  ]);
}

function sample(
  sheetId: string,
  day: string,
  time: string,
  para: string,
  group: string,
  subgroup: string,
  subject: string
): DiffSample {
  const who = subgroup ? `${group} (${subgroup})` : group;
  return {
    sheetId,
    day,
    time,
    para,
    group,
    subgroup,
    subject,
    text: `${sheetId} · ${day} · ${time} · ${who} — ${subject}`,
  };
}

/** Flattens the schedule the app already holds into a lesson list. */
export function currentLessons(data: ScheduleData | null): Lesson[] {
  if (!data) return [];
  return Array.from(data.sheets.values()).flat();
}

function orderDays(days: Set<string>): string[] {
  return Array.from(days).sort(
    (left, right) => (DAY_ORDER_LOOKUP[left] ?? 99) - (DAY_ORDER_LOOKUP[right] ?? 99)
  );
}

function daysBySheet<T>(
  items: readonly T[],
  sheetOf: (item: T) => string,
  dayOf: (item: T) => string
): Record<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const item of items) {
    const sheetId = sheetOf(item);
    const day = dayOf(item);
    if (!day) continue;
    const days = grouped.get(sheetId) ?? new Set<string>();
    days.add(day);
    grouped.set(sheetId, days);
  }
  const out: Record<string, string[]> = {};
  for (const [sheetId, days] of grouped) out[sheetId] = orderDays(days);
  return out;
}

/**
 * Compares the published schedule with the file that is about to replace it.
 *
 * `current` may be null — the app has not loaded a schedule — in which case only
 * the incoming side is described and every lesson counts as new.
 */
export function diffSchedules(
  current: ScheduleData | null,
  next: readonly PublishLessonV1[]
): ScheduleDiff {
  const currentList = currentLessons(current);

  const currentKeys = new Map<string, number>();
  for (const lesson of currentList) {
    currentKeys.set(currentKey(lesson), (currentKeys.get(currentKey(lesson)) ?? 0) + 1);
  }
  const nextKeys = new Map<string, number>();
  for (const record of next) {
    nextKeys.set(nextKey(record), (nextKeys.get(nextKey(record)) ?? 0) + 1);
  }

  const remaining = new Map(nextKeys);
  const disappearing: DiffSample[] = [];
  let disappearedCount = 0;
  for (const lesson of currentList) {
    const lessonIdentity = currentKey(lesson);
    const left = remaining.get(lessonIdentity) ?? 0;
    if (left > 0) {
      remaining.set(lessonIdentity, left - 1);
      continue;
    }
    disappearedCount++;
    if (disappearing.length < MAX_DIFF_SAMPLES) {
      disappearing.push(
        sample(
          lesson.sheetId,
          lesson.day,
          lesson.time,
          lesson.para,
          lesson.group,
          lesson.subgroup,
          lesson.subject
        )
      );
    }
  }

  const remainingCurrent = new Map(currentKeys);
  const appearing: DiffSample[] = [];
  let appearedCount = 0;
  for (const record of next) {
    const identity = nextKey(record);
    const left = remainingCurrent.get(identity) ?? 0;
    if (left > 0) {
      remainingCurrent.set(identity, left - 1);
      continue;
    }
    appearedCount++;
    if (appearing.length < MAX_DIFF_SAMPLES) {
      appearing.push(
        sample(
          record.sheet_id,
          record.day,
          record.time,
          record.para,
          record.group_code,
          record.subgroup ?? '',
          record.subject
        )
      );
    }
  }

  const currentDays = daysBySheet(
    currentList,
    (lesson: Lesson) => lesson.sheetId,
    (lesson: Lesson) => lesson.day
  );
  const nextDays = daysBySheet(
    next,
    (record: PublishLessonV1) => record.sheet_id,
    (record: PublishLessonV1) => record.day
  );

  const sheetIds = Array.from(
    new Set([...Object.keys(currentDays), ...Object.keys(nextDays)])
  ).sort((left, right) => left.localeCompare(right, 'ru'));

  const currentCounts = countBySheet(currentList, (lesson) => lesson.sheetId);
  const nextCounts = countBySheet(next, (record) => record.sheet_id);

  const sheets: SheetDiff[] = sheetIds.map((sheetId) => {
    const before = currentCounts.get(sheetId) ?? 0;
    const after = nextCounts.get(sheetId) ?? 0;
    const has = (days: string[]) => new Set(days);
    const beforeDays = has(currentDays[sheetId] ?? []);
    const afterDays = has(nextDays[sheetId] ?? []);
    return {
      sheetId,
      current: before,
      next: after,
      delta: after - before,
      lostDays: (currentDays[sheetId] ?? []).filter((day) => !afterDays.has(day)),
      newDays: (nextDays[sheetId] ?? []).filter((day) => !beforeDays.has(day)),
    };
  });

  return {
    currentTotal: currentList.length,
    nextTotal: next.length,
    delta: next.length - currentList.length,
    sheets,
    missingSheets: sheets
      .filter((sheet) => sheet.current > 0 && sheet.next === 0)
      .map((s) => s.sheetId),
    newSheets: sheets
      .filter((sheet) => sheet.next > 0 && sheet.current === 0)
      .map((s) => s.sheetId),
    disappearedCount,
    appearedCount,
    disappearing,
    appearing,
    currentDays,
    nextDays,
    identical: disappearedCount === 0 && appearedCount === 0,
  };
}

function countBySheet<T>(items: readonly T[], sheetOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const sheetId = sheetOf(item);
    counts.set(sheetId, (counts.get(sheetId) ?? 0) + 1);
  }
  return counts;
}
