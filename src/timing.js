import { JS_DAY_TO_NAME } from './constants.js';

/**
 * Returns today's day name in our normalized form (e.g. "Понедельник").
 * If today is not in the schedule, returns ''.
 */
export function getTodayName() {
  return JS_DAY_TO_NAME[new Date().getDay()] || '';
}

export function getCurrentTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Current time as minutes since midnight — easier for arithmetic than "HH:MM" strings. */
export function getNowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Parse "HH:MM" → minutes since midnight. Returns null on bad input. */
export function timeToMin(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Parse a time range string like "08:00-09:20" or single time like "08:00".
 * Returns { start: 'HH:MM', end: 'HH:MM' | null }
 */
export function parseTimeRange(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/(\d{1,2})[:.](\d{2})/g);
  if (!m || !m.length) return null;
  const norm = (t) => {
    const [h, mm] = t.split(/[:.]/);
    return `${String(h).padStart(2, '0')}:${mm}`;
  };
  return { start: norm(m[0]), end: m[1] ? norm(m[1]) : null };
}

/**
 * Determine lesson state based on current time:
 *  - 'now'   — идёт прямо сейчас
 *  - 'next'  — следующая пара (ещё не началась)
 *  - 'past'  — уже прошла
 *  - 'idle'  — вне диапазона пар
 */
export function lessonState(lesson, currentTime) {
  if (!lesson || typeof lesson !== 'object') return 'idle';
  const t = parseTimeRange(lesson.time);
  if (!t) return 'idle';
  const now = currentTime || getCurrentTime();
  if (now < t.start) return 'next';
  if (t.end && now > t.end) return 'past';
  if (now >= t.start && (!t.end || now <= t.end)) return 'now';
  return 'idle';
}

/**
 * For a list of lessons on a given day, return indexes of "now" and "next" (if any).
 * Если есть now → next = -1. Иначе next = первый 'next' (next по времени).
 */
export function highlightIndex(lessons, currentTime) {
  const states = lessons.map((l) => lessonState(l, currentTime));
  const nowIdx = states.indexOf('now');
  if (nowIdx >= 0) return { now: nowIdx, next: -1 };
  const nextIdx = states.indexOf('next');
  return { now: -1, next: nextIdx };
}

/**
 * Day-level status: что сейчас происходит на уровне всего дня.
 *  - 'before'  — все пары в будущем (ещё не начались)
 *  - 'between' — есть и прошедшие, и будущие → перемена
 *  - 'after'   — все пары прошли
 *  - 'empty'   — пар нет
 *  - 'live'    — сейчас идёт пара (есть now)
 */
export function dayStatus(lessons, currentTime) {
  if (!lessons || !lessons.length) return 'empty';
  const states = lessons.map((l) => lessonState(l, currentTime));
  if (states.includes('now')) return 'live';
  const hasPast = states.includes('past');
  const hasNext = states.includes('next');
  if (hasNext) {
    return hasPast ? 'between' : 'before';
  }
  if (hasPast) return 'after';
  return 'empty';
}

/**
 * Returns the next upcoming lesson (the one with index `next` from highlightIndex).
 * Returns null if no next.
 */
export function getNextLesson(lessons, currentTime) {
  const hl = highlightIndex(lessons, currentTime);
  if (hl.now >= 0) return { lesson: lessons[hl.now], isNow: true };
  if (hl.next >= 0) return { lesson: lessons[hl.next], isNow: false };
  return null;
}

/**
 * Countdown text: "8 мин", "1ч 12 мин", "12 сек".
 * @param {number} deltaMs — milliseconds until target
 */
export function formatCountdown(deltaMs) {
  if (deltaMs == null || deltaMs < 0) return '';
  const totalSec = Math.floor(deltaMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}ч ${m} мин`;
  if (m > 0) return `${m} мин`;
  return `${s} сек`;
}

/**
 * Returns tomorrow's day name (in the schedule's normalized form).
 */
export function getTomorrowName() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return JS_DAY_TO_NAME[d.getDay()] || '';
}

export { getTodayName as getCurrentDayName };
