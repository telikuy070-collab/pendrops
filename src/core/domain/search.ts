/**
 * "Где у меня пара" — free-text lookup inside the student's own group.
 *
 * The search deliberately ignores the day filter: a student asking "где у меня
 * кабинет 204" wants every match in the week, and the currently selected day
 * must survive the search being cleared. The schedule itself keeps rendering
 * from the day filter, so search results live in their own block.
 */
import type { Lesson } from './entities/types';
import { DAY_ORDER } from '../../constants.js';

/** Fields a student can search by, all taken from the lesson itself. */
const SEARCHABLE = ['subject', 'teacher', 'room', 'group', 'subgroup', 'day', 'time'] as const;

/** Lower-cased, trimmed query. An empty query matches nothing. */
export function normalizeQuery(query: string): string {
  return String(query ?? '')
    .trim()
    .toLowerCase();
}

/** True when every whitespace-separated word is found somewhere in the lesson. */
export function matchesQuery(lesson: Lesson, query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return false;
  const haystack = SEARCHABLE.map((field) => String(lesson[field] ?? '').toLowerCase()).join(' ');
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** Weekday order first, then start time — "when is it" before "what is it". */
export function sortSearchResults(lessons: Lesson[]): Lesson[] {
  return lessons.slice().sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a.day);
    const ib = DAY_ORDER.indexOf(b.day);
    const da = ia === -1 ? 99 : ia;
    const db = ib === -1 ? 99 : ib;
    if (da !== db) return da - db;
    const at = a.time || '';
    const bt = b.time || '';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.subject || '').localeCompare(String(b.subject || ''), 'ru');
  });
}

/** Matches for a query, ordered for display. */
export function searchLessons(lessons: Lesson[], query: string): Lesson[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  return sortSearchResults(lessons.filter((lesson) => matchesQuery(lesson, query)));
}

/** What makes two results indistinguishable: same day, same slot, same group. */
function slotKey(lesson: Lesson): string {
  return `${lesson.day}|${lesson.time}|${lesson.group}`;
}

/**
 * True when the results hold more than one lesson of the same slot.
 *
 * Subgroups 1/2/3 of one pair render as visually identical rows, so the
 * subgroup is then the only thing that tells the student which row is theirs.
 * When every result stands on its own, the label would just be noise.
 */
export function resultsNeedSubgroup(lessons: Lesson[]): boolean {
  const seen = new Set<string>();
  for (const lesson of lessons) {
    const key = slotKey(lesson);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
