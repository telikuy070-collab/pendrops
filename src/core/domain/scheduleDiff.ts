/**
 * Schedule change detection.
 *
 * The application knows which version is on screen and keeps a compact digest
 * of the previously loaded version in the existing offline storage. Comparing
 * the two digests answers the only question a student has after a publish:
 * "что добавилось и что исчезло".
 *
 * Everything here is pure: the storage round-trip lives in the use-cases layer
 * so the comparison itself stays trivially testable.
 */
import type { Lesson, ScheduleData } from './entities/types';
import { DAY_ORDER } from '../../constants.js';

/** The comparable part of a lesson. Display and identity fields only. */
export interface LessonSnapshot {
  sheetId: string;
  day: string;
  time: string;
  para: string;
  group: string;
  subgroup: string;
  subject: string;
  teacher: string;
  room: string;
  type: string;
  isExam: boolean;
}

/** A whole schedule reduced to comparable rows plus its version. */
export interface ScheduleDigest {
  version: string;
  updatedAt: string;
  items: LessonSnapshot[];
}

/** What changed between two published versions. */
export interface ScheduleChanges {
  fromVersion: string;
  toVersion: string;
  added: LessonSnapshot[];
  removed: LessonSnapshot[];
}

/** Which slice of the schedule the user is currently looking at. */
export interface SelectionScope {
  sheetId?: string;
  group?: string;
  subgroup?: string;
}

const SEP = '';

const text = (value: unknown): string => (value == null ? '' : String(value));

/** Reduces a lesson to the fields a student would recognise it by. */
export function snapshotOf(lesson: Lesson): LessonSnapshot {
  return {
    sheetId: text(lesson.sheetId),
    day: text(lesson.day),
    time: text(lesson.time),
    para: text(lesson.para),
    group: text(lesson.group),
    subgroup: text(lesson.subgroup),
    subject: text(lesson.subject),
    teacher: text(lesson.teacher),
    room: text(lesson.room),
    type: text(lesson.type),
    isExam: Boolean(lesson.isExam),
  };
}

/**
 * Identity of a lesson across versions.
 *
 * Only the fields that identify *the same class* take part: moving it to
 * another weekday or time is a change the student must see, so day and time
 * are part of the key — a rescheduled lesson reads as one removal plus one
 * addition instead of silently disappearing.
 */
export function snapshotKey(snapshot: LessonSnapshot): string {
  return [
    snapshot.sheetId,
    snapshot.day,
    snapshot.time,
    snapshot.para,
    snapshot.group,
    snapshot.subgroup,
    snapshot.subject,
    snapshot.teacher,
    snapshot.room,
    snapshot.type,
  ].join(SEP);
}

/** Convenience wrapper for lessons coming straight from the store. */
export function lessonKey(lesson: Lesson): string {
  return snapshotKey(snapshotOf(lesson));
}

const dayIndex = (day: string): number => DAY_ORDER.indexOf(day);

/** Weekday order first, then start time — the order the week view renders in. */
export function compareSnapshots(a: LessonSnapshot, b: LessonSnapshot): number {
  const ia = dayIndex(a.day);
  const ib = dayIndex(b.day);
  if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  return a.subject.localeCompare(b.subject, 'ru');
}

/** Digest of a loaded schedule; cheap to store and to compare. */
export function buildDigest(data: ScheduleData): ScheduleDigest {
  const items: LessonSnapshot[] = [];
  for (const list of data.sheets.values()) {
    for (const lesson of list) items.push(snapshotOf(lesson));
  }
  items.sort(compareSnapshots);
  return { version: text(data.version), updatedAt: text(data.updatedAt), items };
}

/**
 * Added / removed lessons between two digests, or null when nothing changed.
 *
 * `null` is deliberately not "an empty change": the UI shows the section only
 * when there is something to read.
 */
export function diffDigests(
  previous: ScheduleDigest | null,
  next: ScheduleDigest
): ScheduleChanges | null {
  if (!previous) return null;

  const previousKeys = new Set(previous.items.map(snapshotKey));
  const nextKeys = new Set(next.items.map(snapshotKey));

  const added = next.items.filter((item) => !previousKeys.has(snapshotKey(item)));
  const removed = previous.items.filter((item) => !nextKeys.has(snapshotKey(item)));

  if (!added.length && !removed.length) return null;
  return { fromVersion: text(previous.version), toVersion: text(next.version), added, removed };
}

/** Total number of changed rows, used for the badge on the toggle. */
export function countChanges(changes: ScheduleChanges | null): number {
  if (!changes) return 0;
  return changes.added.length + changes.removed.length;
}

const inScope = (item: LessonSnapshot, scope: SelectionScope): boolean => {
  if (scope.sheetId && item.sheetId !== scope.sheetId) return false;
  if (scope.group && item.group !== scope.group) return false;
  if (scope.subgroup && String(item.subgroup) !== String(scope.subgroup)) return false;
  return true;
};

/**
 * Narrows the change set to what the user is currently looking at.
 *
 * A group that did not move should not drown the student in another
 * department's diff, so the same scoping rules as the schedule itself are
 * applied. An empty result means "no news for you" and hides the section.
 */
export function scopeChanges(
  changes: ScheduleChanges | null,
  scope: SelectionScope
): ScheduleChanges | null {
  if (!changes) return null;
  const added = changes.added.filter((item) => inScope(item, scope));
  const removed = changes.removed.filter((item) => inScope(item, scope));
  if (!added.length && !removed.length) return null;
  return { fromVersion: changes.fromVersion, toVersion: changes.toVersion, added, removed };
}
