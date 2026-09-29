import { describe, expect, it } from 'vitest';
import { diffSchedules, currentLessons, MAX_DIFF_SAMPLES } from '../../src/admin/diff.ts';

/** A published lesson, in the shape the repository returns it. */
function lesson(overrides = {}) {
  return {
    id: 'id',
    sheetId: 'СЖ',
    day: 'Понедельник',
    dayOrder: 0,
    time: '08:30-10:05',
    para: '1',
    group: 'ЛД-11',
    subgroup: '',
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов И.И.',
    room: '101',
    isExam: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

/** A parsed lesson, in the shape the publish wire uses. */
function record(overrides = {}) {
  return {
    sheet_id: 'СЖ',
    day: 'Понедельник',
    day_order: 0,
    time: '08:30-10:05',
    para: '1',
    group_code: 'ЛД-11',
    subgroup: null,
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов И.И.',
    room: '101',
    is_exam: false,
    ...overrides,
  };
}

function scheduleOf(lessons, version = 'v1') {
  const sheets = new Map();
  for (const item of lessons) {
    const list = sheets.get(item.sheetId) || [];
    list.push(item);
    sheets.set(item.sheetId, list);
  }
  return {
    sheets,
    sheetsMeta: [],
    groups: new Map(),
    preferences: { currentSheetId: '', currentGroup: '', activeSubgroup: '', hiddenSheets: [] },
    version,
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('diffSchedules: totals', () => {
  it('counts what is live and what the file would publish', () => {
    const current = scheduleOf([lesson(), lesson({ para: '2' }), lesson({ para: '3' })]);

    const diff = diffSchedules(current, [record(), record({ para: '2' })]);

    expect(diff.currentTotal).toBe(3);
    expect(diff.nextTotal).toBe(2);
    expect(diff.delta).toBe(-1);
  });

  it('treats an empty database as "everything is new" instead of failing', () => {
    const diff = diffSchedules(null, [record(), record({ para: '2' })]);

    expect(diff.currentTotal).toBe(0);
    expect(diff.nextTotal).toBe(2);
    expect(diff.appearedCount).toBe(2);
    expect(diff.disappearedCount).toBe(0);
    expect(diff.identical).toBe(false);
  });

  it('reports an unchanged schedule as identical', () => {
    const lessons = [lesson(), lesson({ para: '2', subject: 'Химия' })];
    const next = lessons.map((item) =>
      record({ para: item.para, subject: item.subject, subgroup: null })
    );

    const diff = diffSchedules(scheduleOf(lessons), next);

    expect(diff.identical).toBe(true);
    expect(diff.delta).toBe(0);
    expect(diff.disappearing).toEqual([]);
    expect(diff.appearing).toEqual([]);
  });

  it('flattens the sheets map the app already holds', () => {
    const current = scheduleOf([
      lesson({ sheetId: 'СЖ' }),
      lesson({ sheetId: 'ПСТ' }),
      lesson({ sheetId: 'ПСТ' }),
    ]);

    expect(currentLessons(current)).toHaveLength(3);
    expect(currentLessons(null)).toEqual([]);
  });
});

describe('diffSchedules: what disappears and appears', () => {
  it('matches a moved room instead of reporting a lost lesson', () => {
    const current = scheduleOf([lesson({ room: '101' })]);

    const diff = diffSchedules(current, [record({ room: '202' })]);

    // A reassigned room changes a lesson; it does not make it vanish.
    expect(diff.identical).toBe(true);
    expect(diff.disappearedCount).toBe(0);
    expect(diff.appearedCount).toBe(0);
  });

  it('lists disappearing and appearing lessons with readable text', () => {
    const current = scheduleOf([lesson({ subject: 'Биология', para: '4' })]);

    const diff = diffSchedules(current, [record({ subject: 'Физика', para: '2' })]);

    expect(diff.disappearedCount).toBe(1);
    expect(diff.appearedCount).toBe(1);
    expect(diff.disappearing[0].text).toBe('СЖ · Понедельник · 08:30-10:05 · ЛД-11 — Биология');
    expect(diff.appearing[0].text).toBe('СЖ · Понедельник · 08:30-10:05 · ЛД-11 — Физика');
  });

  it('shows a subgroup in the sample text', () => {
    const current = scheduleOf([lesson({ subgroup: '2' })]);

    const diff = diffSchedules(current, []);

    expect(diff.disappearing[0].text).toContain('ЛД-11 (2)');
  });

  it('caps the examples but keeps the true counts', () => {
    const current = scheduleOf(
      Array.from({ length: 12 }, (_, index) => lesson({ para: String(index + 1) }))
    );
    const next = Array.from({ length: 4 }, (_, index) => record({ para: String(index + 1) }));

    const diff = diffSchedules(current, next);

    expect(diff.disappearedCount).toBe(8);
    expect(diff.appearing).toEqual([]);
    expect(diff.disappearing).toHaveLength(MAX_DIFF_SAMPLES);
  });

  it('pairs duplicates one by one instead of by identity of the whole list', () => {
    // Two identical lessons in the database, one in the file: exactly one of
    // them disappears, and the counters must say so.
    const current = scheduleOf([lesson(), lesson()]);

    const diff = diffSchedules(current, [record()]);

    expect(diff.disappearedCount).toBe(1);
    expect(diff.appearedCount).toBe(0);
    expect(diff.identical).toBe(false);
  });

  it('ignores case and padding differences between the two sides', () => {
    const current = scheduleOf([lesson({ group: 'ЛД-11', subject: ' Анатомия ' })]);

    const diff = diffSchedules(current, [record({ group: ' лд-11 ', subject: 'анатомия' })]);

    expect(diff.identical).toBe(true);
  });
});

describe('diffSchedules: per sheet', () => {
  it('splits the totals per sheet and marks added and removed sheets', () => {
    const current = scheduleOf([
      lesson({ sheetId: 'СЖ' }),
      lesson({ sheetId: 'СЖ' }),
      lesson({ sheetId: 'ЛД' }),
    ]);

    const diff = diffSchedules(current, [record({ sheet_id: 'СЖ' }), record({ sheet_id: 'ПСТ' })]);

    const byId = Object.fromEntries(diff.sheets.map((sheet) => [sheet.sheetId, sheet]));
    expect(byId['СЖ']).toMatchObject({ current: 2, next: 1, delta: -1 });
    expect(byId['ЛД']).toMatchObject({ current: 1, next: 0, delta: -1 });
    expect(byId['ПСТ']).toMatchObject({ current: 0, next: 1, delta: 1 });
    expect(diff.missingSheets).toEqual(['ЛД']);
    expect(diff.newSheets).toEqual(['ПСТ']);
  });

  it('names the weekdays a sheet loses and the ones it gains', () => {
    const current = scheduleOf([
      lesson({ day: 'Понедельник', time: '08:30-10:05' }),
      lesson({ day: 'Пятница', time: '08:30-10:05', para: '2' }),
    ]);

    const diff = diffSchedules(current, [
      record({ day: 'Понедельник', day_order: 0 }),
      record({ day: 'Среда', day_order: 2, time: '11:00-12:20' }),
    ]);

    const sheet = diff.sheets.find((entry) => entry.sheetId === 'СЖ');
    expect(sheet.lostDays).toEqual(['Пятница']);
    expect(sheet.newDays).toEqual(['Среда']);
    expect(diff.currentDays['СЖ']).toEqual(['Понедельник', 'Пятница']);
    expect(diff.nextDays['СЖ']).toEqual(['Понедельник', 'Среда']);
  });

  it('sorts the weekdays in week order, not alphabetically', () => {
    const diff = diffSchedules(null, [
      record({ day: 'Среда', day_order: 2 }),
      record({ day: 'Понедельник', day_order: 0 }),
      record({ day: 'Пятница', day_order: 4 }),
    ]);

    expect(diff.nextDays['СЖ']).toEqual(['Понедельник', 'Среда', 'Пятница']);
  });
});
