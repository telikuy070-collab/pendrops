/**
 * Lesson reminders.
 *
 * Pure timing rules for a local, on-device reminder: when a class is about to
 * start, when the notification should fire, and which reminders are still
 * worth keeping. Nothing here touches storage, the Notification API or the
 * DOM — the wiring lives in src/presentation/reminders.ts.
 */
import { JS_DAY_TO_NAME } from '../../constants.js';

/** Offered lead times, in minutes. */
export const REMINDER_LEAD_OPTIONS: readonly number[] = Object.freeze([5, 10, 15, 30]);

/** Default lead time, in minutes. */
export const DEFAULT_REMINDER_LEAD = 10;

/** The minimal lesson shape a reminder needs. */
export interface ReminderRequest {
  day: string;
  time: string;
  subject?: string;
  teacher?: string;
  room?: string;
  /**
   * Stable identity of the lesson (see `scheduleDiff.lessonKey`). Stored with
   * the reminder so a card can show "reminder set" after a reload, even
   * though the reminder itself only keeps what the notification prints.
   */
  key?: string;
}

export interface Reminder {
  id: string;
  /** Epoch milliseconds at which the notification fires. */
  fireAt: number;
  leadMinutes: number;
  day: string;
  time: string;
  subject: string;
  teacher: string;
  room: string;
  /** Optional identity of the lesson this reminder was created from. */
  key?: string;
}

/** Why a reminder was not created. */
export type ReminderSkipReason =
  /** The lesson has no recognisable day or start time. */
  | 'no-time'
  /** The lesson already started. */
  | 'passed'
  /** The lesson starts sooner than the chosen lead time. */
  | 'too-soon';

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

/** Weekday name for a date, in the schedule's own vocabulary. */
function weekdayName(date: Date): string {
  return (JS_DAY_TO_NAME as unknown as Record<number, string>)[date.getDay()] || '';
}

/** "08:30-09:50" / "08.30" / "8:00" → minutes since midnight, or null. */
export function parseStartMinutes(time: string): number | null {
  if (!time) return null;
  const match = String(time).match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

interface Occurrence {
  at: number;
  /** The class had already started at `now`. */
  inPast: boolean;
}

/**
 * The next start of a lesson, within the coming week.
 *
 * A class later today is the same class later today; a class later this week
 * keeps its weekday. A class that already started today has no valid
 * occurrence in this schedule view, and is reported as past.
 */
function nextOccurrence(request: ReminderRequest, now: number): Occurrence | null {
  const startMinutes = parseStartMinutes(request.time);
  if (!request.day || startMinutes === null) return null;

  const todayName = weekdayName(new Date(now));
  const at = (offsetDays: number): number => {
    const date = new Date(now);
    date.setDate(date.getDate() + offsetDays);
    date.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    return date.getTime();
  };

  if (request.day === todayName) {
    const today = at(0);
    return { at: today, inPast: today <= now };
  }

  for (let offset = 1; offset <= 7; offset++) {
    if (weekdayName(new Date(now + offset * DAY_MS)) === request.day) {
      return { at: at(offset), inPast: false };
    }
  }
  return null;
}

/**
 * Epoch ms at which the notification should fire, or null when a reminder
 * makes no sense: no time to parse, the class already started, or the class
 * begins earlier than the chosen lead time.
 */
export function computeReminderAt(
  request: ReminderRequest,
  leadMinutes: number,
  now: number
): number | null {
  const occurrence = nextOccurrence(request, now);
  if (!occurrence || occurrence.inPast) return null;
  const fireAt = occurrence.at - leadMinutes * MINUTE;
  return fireAt > now ? fireAt : null;
}

/** Same decision as `computeReminderAt`, with the reason instead of null. */
export function reminderSkipReason(
  request: ReminderRequest,
  leadMinutes: number,
  now: number
): ReminderSkipReason | null {
  const occurrence = nextOccurrence(request, now);
  if (!occurrence) return 'no-time';
  if (occurrence.inPast) return 'passed';
  return occurrence.at - leadMinutes * MINUTE > now ? null : 'too-soon';
}

/** Builds a storable reminder, or null when it must not be created. */
export function createReminder(
  request: ReminderRequest,
  leadMinutes: number,
  now: number,
  id: string
): Reminder | null {
  const fireAt = computeReminderAt(request, leadMinutes, now);
  if (fireAt === null) return null;
  return {
    id,
    fireAt,
    leadMinutes,
    day: request.day,
    time: request.time,
    subject: request.subject || '',
    teacher: request.teacher || '',
    room: request.room || '',
    key: request.key,
  };
}

/** Earliest first. */
export function sortReminders(reminders: Reminder[]): Reminder[] {
  return reminders.slice().sort((a, b) => a.fireAt - b.fireAt);
}

/** Reminders whose moment has come. */
export function dueReminders(reminders: Reminder[], now: number): Reminder[] {
  return reminders.filter((reminder) => reminder.fireAt <= now);
}

/**
 * Drops everything that already fired or expired, plus anything with a
 * corrupted timestamp, so a stale list cannot grow forever in localStorage.
 */
export function pruneReminders(reminders: Reminder[], now: number): Reminder[] {
  return sortReminders(
    reminders.filter(
      (reminder) => reminder && Number.isFinite(reminder.fireAt) && reminder.fireAt > now
    )
  );
}
