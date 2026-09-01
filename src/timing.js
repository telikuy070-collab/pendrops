import { JS_DAY_TO_NAME, PARS_TIMES } from './constants.js';

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
 */
export function highlightIndex(lessons, currentTime) {
  const states = lessons.map((l) => lessonState(l, currentTime));
  const nowIdx = states.indexOf('now');
  if (nowIdx >= 0) return { now: nowIdx, next: -1 };
  const nextIdx = states.indexOf('next');
  return { now: -1, next: nextIdx };
}

export { getTodayName as getCurrentDayName };
