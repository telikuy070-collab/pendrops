import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  countChanges,
  diffDigests,
  lessonKey,
  scopeChanges,
  snapshotKey,
  snapshotOf,
} from '../../src/core/domain/scheduleDiff';
import {
  loadScheduleDigestUseCase,
  recordScheduleChangesUseCase,
  SCHEDULE_DIGEST_KEY,
} from '../../src/core/domain/use-cases/schedule';

const lesson = (over = {}) => ({
  id: '1',
  sheetId: 'Лечебное дело',
  day: 'Понедельник',
  dayOrder: 0,
  time: '08:00-09:20',
  para: '1',
  group: 'ЛД-11',
  subgroup: '1',
  subject: 'Анатомия',
  type: 'lecture',
  teacher: 'Иванов',
  room: '201',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const scheduleOf = (items) => ({
  sheets: new Map([['Лечебное дело', items]]),
  sheetsMeta: [{ id: 'Лечебное дело', name: 'Лечебное дело', order: 0, lessonCount: items.length }],
  groups: new Map(),
  preferences: {
    currentSheetId: 'Лечебное дело',
    currentGroup: 'ЛД-11',
    activeSubgroup: '',
    hiddenSheets: [],
  },
  version: 'W38',
  updatedAt: '2026-09-29T05:12:00.000Z',
});

/** Minimal in-memory IStorage. */
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => {
      map.set(key, value);
      return true;
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
};

describe('lesson identity', () => {
  it('ignores database ids and timestamps', () => {
    const a = snapshotKey(snapshotOf(lesson({ id: 'a', createdAt: 'x', updatedAt: 'y' })));
    const b = snapshotKey(snapshotOf(lesson({ id: 'b', createdAt: '', updatedAt: '' })));
    expect(a).toBe(b);
  });

  it('treats a moved lesson as a different lesson', () => {
    const before = lessonKey(lesson({ time: '08:00-09:20' }));
    const after = lessonKey(lesson({ time: '10:00-11:20' }));
    expect(before).not.toBe(after);
  });

  it('treats a renamed room as a different lesson', () => {
    expect(lessonKey(lesson({ room: '201' }))).not.toBe(lessonKey(lesson({ room: '204' })));
  });
});

describe('diffDigests', () => {
  const base = buildDigest(
    scheduleOf([lesson(), lesson({ id: '2', time: '09:30-10:50', subject: 'Физика' })])
  );

  it('returns null for the very first version — there is nothing to compare with', () => {
    expect(diffDigests(null, base)).toBeNull();
  });

  it('returns null when the same lessons came back under a new version', () => {
    const same = { ...base, version: 'W39' };
    expect(diffDigests(base, same)).toBeNull();
  });

  it('reports an added and a removed lesson', () => {
    const next = buildDigest(
      scheduleOf([lesson({ subject: 'Анатомия', room: '301' }), lesson({ id: '2' })])
    );
    const changes = diffDigests(base, next);
    expect(changes).not.toBeNull();
    expect(changes.removed.map((l) => l.room)).toEqual(['201']);
    expect(changes.added.map((l) => l.room)).toEqual(['301']);
    expect(changes.fromVersion).toBe('W38');
    expect(countChanges(changes)).toBe(2);
  });

  it('orders changes by weekday and start time', () => {
    const next = buildDigest(
      scheduleOf([
        lesson({ id: '3', day: 'Среда', time: '08:00-09:20' }),
        lesson({ id: '4', day: 'Понедельник', time: '18:00-19:20' }),
        lesson(),
        lesson({ id: '2', time: '09:30-10:50', subject: 'Физика' }),
      ])
    );
    const changes = diffDigests(base, next);
    expect(changes.added.map((l) => `${l.day} ${l.time}`)).toEqual([
      'Понедельник 18:00-19:20',
      'Среда 08:00-09:20',
    ]);
  });
});

describe('scopeChanges', () => {
  const previous = buildDigest(scheduleOf([lesson({ sheetId: 'Лечебное дело', group: 'ЛД-11' })]));
  const next = buildDigest(
    scheduleOf([
      lesson({ sheetId: 'Лечебное дело', group: 'ЛД-11' }),
      lesson({ sheetId: 'Стоматология', group: 'СТ-22', subject: 'Гигиена' }),
    ])
  );

  it('keeps only the rows of the selected group', () => {
    const all = diffDigests(previous, next);
    expect(all.added).toHaveLength(1);
    expect(scopeChanges(all, { sheetId: 'Лечебное дело', group: 'ЛД-11' })).toBeNull();
  });

  it('hides the section when the selected group did not change', () => {
    const all = diffDigests(previous, next);
    expect(all.added).toHaveLength(1);
    expect(scopeChanges(all, { sheetId: 'Лечебное дело', group: 'ЛД-11' })).toBeNull();
  });

  it('shows the rows of the group that actually changed', () => {
    const all = diffDigests(previous, next);
    const scoped = scopeChanges(all, { sheetId: 'Стоматология', group: 'СТ-22' });
    expect(scoped.added.map((l) => l.subject)).toEqual(['Гигиена']);
    expect(scoped.removed).toHaveLength(0);
  });

  it('narrows by subgroup as well', () => {
    const prevSub = buildDigest(scheduleOf([lesson({ subgroup: '1' })]));
    const nextSub = buildDigest(scheduleOf([lesson({ subgroup: '2' })]));
    const all = diffDigests(prevSub, nextSub);
    expect(scopeChanges(all, { subgroup: '1' }).removed).toHaveLength(1);
    expect(scopeChanges(all, { subgroup: '2' }).added).toHaveLength(1);
  });
});

describe('change baseline in the offline storage', () => {
  it('reports nothing on the first run and remembers the version', async () => {
    const storage = memoryStorage();
    expect(await recordScheduleChangesUseCase(storage, scheduleOf([lesson()]))).toBeNull();
    const stored = await loadScheduleDigestUseCase(storage);
    expect(stored.version).toBe('W38');
    expect(stored.items).toHaveLength(1);
  });

  it('reports the difference on the next version', async () => {
    const storage = memoryStorage();
    await recordScheduleChangesUseCase(storage, scheduleOf([lesson()]));
    const changed = scheduleOf([lesson({ room: '404' })]);
    changed.version = 'W39';
    const changes = await recordScheduleChangesUseCase(storage, changed);
    expect(changes.added.map((l) => l.room)).toEqual(['404']);
    expect(changes.removed.map((l) => l.room)).toEqual(['201']);
  });

  it('re-applied version is not a new version', async () => {
    const storage = memoryStorage();
    const data = scheduleOf([lesson()]);
    await recordScheduleChangesUseCase(storage, data);
    expect(await recordScheduleChangesUseCase(storage, data)).toBeNull();
  });

  it('survives a corrupted baseline instead of breaking the schedule', async () => {
    const storage = memoryStorage({ [SCHEDULE_DIGEST_KEY]: { version: 5 } });
    expect(await loadScheduleDigestUseCase(storage)).toBeNull();
    expect(await recordScheduleChangesUseCase(storage, scheduleOf([lesson()]))).toBeNull();
  });
});
