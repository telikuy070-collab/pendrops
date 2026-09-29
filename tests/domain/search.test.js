import { describe, expect, it } from 'vitest';
import {
  matchesQuery,
  normalizeQuery,
  resultsNeedSubgroup,
  searchLessons,
} from '../../src/core/domain/search';
import { buildWeekPlan } from '../../src/core/domain/weekPlan';

const lesson = (over = {}) => ({
  id: '1',
  sheetId: 'ЛД',
  day: 'Понедельник',
  dayOrder: 0,
  time: '08:00-09:20',
  para: '1',
  group: 'ЛД-11',
  subgroup: '1',
  subject: 'Анатомия человека',
  type: 'lecture',
  teacher: 'Иванов И.И.',
  room: '201',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const week = [
  lesson(),
  lesson({ id: '2', day: 'Среда', time: '10:00-11:20', subject: 'Физика', room: '204' }),
  lesson({ id: '3', day: 'Среда', time: '08:30-09:50', subject: 'Химия', room: '101' }),
];

describe('search inside the own group', () => {
  it('normalises what the student typed', () => {
    expect(normalizeQuery('  Анатомия ')).toBe('анатомия');
    expect(normalizeQuery('')).toBe('');
  });

  it('finds by subject, teacher and room', () => {
    expect(matchesQuery(lesson(), 'анатомия')).toBe(true);
    expect(matchesQuery(lesson(), 'ИВАНОВ')).toBe(true);
    expect(matchesQuery(lesson(), '201')).toBe(true);
    expect(matchesQuery(lesson(), '2014')).toBe(false);
  });

  it('finds by subgroup, so a student can look up their own column', () => {
    expect(matchesQuery(lesson({ subgroup: '3' }), '3')).toBe(true);
    expect(matchesQuery(lesson({ subgroup: '3' }), '7')).toBe(false);
  });

  it('requires every word of a multi-word query', () => {
    expect(matchesQuery(lesson(), 'анатомия иванов')).toBe(true);
    expect(matchesQuery(lesson(), 'анатомия физика')).toBe(false);
  });

  it('returns nothing for an empty query', () => {
    expect(searchLessons(week, '   ')).toEqual([]);
  });

  it('ignores the selected day: every match of the week is returned', () => {
    const results = searchLessons(week, '0');
    expect(results).toHaveLength(3);
  });

  it('orders matches by weekday, then by start time', () => {
    const results = searchLessons(week, 'и');
    expect(results.map((l) => `${l.day} ${l.time}`)).toEqual([
      'Понедельник 08:00-09:20',
      'Среда 08:30-09:50',
      'Среда 10:00-11:20',
    ]);
  });
});

describe('subgroup label in the results', () => {
  const slot = (subgroup) =>
    lesson({ id: `s${subgroup}`, subgroup, subject: 'Анатомия человека', room: '225' });

  it('does not ask for the label when every result stands on its own', () => {
    const results = [
      lesson({ id: 'a', time: '08:00-09:20' }),
      lesson({ id: 'b', day: 'Вторник', time: '10:00-11:20' }),
    ];
    expect(resultsNeedSubgroup(results)).toBe(false);
  });

  it('asks for the label when one slot holds several subgroups', () => {
    const results = [slot('1'), slot('2'), slot('3')];
    expect(resultsNeedSubgroup(results)).toBe(true);
  });

  it('does not confuse the same time on different days for a collision', () => {
    const results = [
      lesson({ id: 'a', day: 'Понедельник', time: '08:00-09:20' }),
      lesson({ id: 'b', day: 'Вторник', time: '08:00-09:20' }),
    ];
    expect(resultsNeedSubgroup(results)).toBe(false);
  });

  it('is empty-safe', () => {
    expect(resultsNeedSubgroup([])).toBe(false);
    expect(resultsNeedSubgroup([lesson()])).toBe(false);
  });

  it('finds every subgroup of a colliding slot through one query', () => {
    const results = [slot('1'), slot('2'), slot('3')];
    expect(searchLessons(results, '225')).toHaveLength(3);
    expect(resultsNeedSubgroup(searchLessons(results, '225'))).toBe(true);
  });
});

describe('week plan', () => {
  it('groups lessons by day and drops days without classes', () => {
    const plan = buildWeekPlan(week, 'Среда');
    expect(plan.map((entry) => entry.day)).toEqual(['Понедельник', 'Среда']);
    expect(plan[1].count).toBe(2);
    expect(plan[1].isToday).toBe(true);
  });

  it('orders days by weekday, not by the order lessons arrived in', () => {
    const shuffled = [week[2], week[0], week[1]];
    expect(buildWeekPlan(shuffled, '').map((entry) => entry.day)).toEqual(['Понедельник', 'Среда']);
  });

  it('sorts the lessons inside a day by start time', () => {
    const plan = buildWeekPlan(week, '');
    expect(plan[1].items.map((l) => l.time)).toEqual(['08:30-09:50', '10:00-11:20']);
  });

  it('is empty for an empty selection', () => {
    expect(buildWeekPlan([], 'Понедельник')).toEqual([]);
  });
});
