/**
 * Week mode.
 *
 * "Неделя" is the same data as "День", grouped and ordered instead of sliced:
 * a vertical list of days with separators. No new concepts, no new data — the
 * grouping is derived entirely from the lessons that are already on screen.
 */
import type { Lesson } from './entities/types';
import { DAY_ORDER } from '../../constants.js';

export interface DayPlan {
  day: string;
  items: Lesson[];
  count: number;
  isToday: boolean;
}

const dayIndex = (day: string): number => DAY_ORDER.indexOf(day);

/** Lessons of one day, earliest first. */
export function sortByTime(lessons: Lesson[]): Lesson[] {
  return lessons.slice().sort((a, b) => {
    const at = a.time || '';
    const bt = b.time || '';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.para || '').localeCompare(b.para || '', 'ru');
  });
}

/**
 * Days that actually have classes, in weekday order.
 *
 * Days without a single lesson are dropped instead of rendered as empty
 * separators: the college timetable is not seven equal days.
 */
export function buildWeekPlan(lessons: Lesson[], today: string): DayPlan[] {
  const byDay = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = lesson.day || '';
    if (!key) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(lesson);
    else byDay.set(key, [lesson]);
  }

  return Array.from(byDay.entries())
    .map(([day, items]) => ({
      day,
      items: sortByTime(items),
      count: items.length,
      isToday: day === today,
    }))
    .sort((a, b) => {
      const ia = dayIndex(a.day);
      const ib = dayIndex(b.day);
      if (ia === -1 && ib === -1) return a.day.localeCompare(b.day, 'ru');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
}
