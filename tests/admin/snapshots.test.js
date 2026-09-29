import { describe, expect, it, vi } from 'vitest';
import {
  byNewestFirst,
  createSnapshotStore,
  formatSnapshotDate,
  snapshotFromSchedule,
  MAX_SNAPSHOTS,
} from '../../src/admin/snapshots.ts';

/** An in-memory backend, so the store's own logic is what is under test. */
function memoryBackend() {
  const rows = new Map();
  return {
    rows,
    list: vi.fn(async () =>
      Array.from(rows.values()).map(({ lessons: _lessons, ...meta }) => meta)
    ),
    read: vi.fn(async (id) => rows.get(id) ?? null),
    write: vi.fn(async (snapshot) => {
      rows.set(snapshot.id, snapshot);
    }),
    remove: vi.fn(async (id) => {
      rows.delete(id);
    }),
  };
}

function lesson(sheetId = 'СЖ', subject = 'Анатомия') {
  return {
    id: 'id',
    sheetId,
    day: 'Понедельник',
    dayOrder: 0,
    time: '08:30-10:05',
    para: '1',
    group: 'ЛД-11',
    subgroup: '',
    subject,
    type: 'lecture',
    teacher: 'Иванов И.И.',
    room: '101',
    isExam: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

function scheduleOf(lessons, version = 'v42') {
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

function snapshot(id, fileName = 'week-38.xls') {
  return {
    id,
    createdAt: id,
    fileName,
    version: 'v1',
    count: 1,
    lessons: [
      {
        sheetId: 'СЖ',
        day: 'Понедельник',
        dayOrder: 0,
        time: '08:30-10:05',
        para: '1',
        group: 'ЛД-11',
        subgroup: '',
        subject: 'Анатомия',
        type: 'lecture',
        teacher: '',
        room: '',
        isExam: false,
      },
    ],
  };
}

describe('snapshotFromSchedule', () => {
  it('flattens every sheet into one restorable list', () => {
    const data = scheduleOf([lesson('СЖ'), lesson('ПСТ', 'Химия'), lesson('СЖ', 'Физика')]);

    const shot = snapshotFromSchedule(data, 'week-38.xls', new Date('2026-09-29T18:10:11Z'));

    expect(shot).not.toBeNull();
    expect(shot.count).toBe(3);
    // Flattened sheet by sheet, in the order the schedule holds them.
    expect(shot.lessons.map((l) => l.sheetId)).toEqual(['СЖ', 'СЖ', 'ПСТ']);
    // The restore path publishes these, so the id/timestamps must not travel.
    expect(shot.lessons[0]).not.toHaveProperty('id');
    expect(shot.lessons[0]).not.toHaveProperty('createdAt');
    expect(shot.lessons[0]).toMatchObject({ group: 'ЛД-11', subject: 'Анатомия' });
  });

  it('stamps the snapshot with the publish time, the file name and the version', () => {
    const data = scheduleOf([lesson()], 'v99');

    const shot = snapshotFromSchedule(data, 'week-39.xls', new Date('2026-09-29T18:10:11Z'));

    expect(shot.id).toBe('2026-09-29T18:10:11.000Z');
    expect(shot.createdAt).toBe(shot.id);
    expect(shot.fileName).toBe('week-39.xls');
    expect(shot.version).toBe('v99');
  });

  it('refuses to store nothing', () => {
    expect(snapshotFromSchedule(null, 'week-38.xls')).toBeNull();
    expect(snapshotFromSchedule(scheduleOf([]), 'week-38.xls')).toBeNull();
  });
});

describe('snapshot store retention', () => {
  it('lists snapshots newest first', async () => {
    const backend = memoryBackend();
    const store = createSnapshotStore(backend);

    await store.save(snapshot('2026-09-27T10:00:00.000Z'));
    await store.save(snapshot('2026-09-28T10:00:00.000Z'));
    await store.save(snapshot('2026-09-29T10:00:00.000Z'));

    const list = await store.list();
    expect(list.map((meta) => meta.id)).toEqual([
      '2026-09-29T10:00:00.000Z',
      '2026-09-28T10:00:00.000Z',
      '2026-09-27T10:00:00.000Z',
    ]);
  });

  it('keeps three snapshots and drops the oldest on the fourth save', async () => {
    const backend = memoryBackend();
    const store = createSnapshotStore(backend);

    for (const day of [27, 28, 29, 30]) {
      await store.save(snapshot(`2026-09-${day}T10:00:00.000Z`));
    }

    const list = await store.list();
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list.map((meta) => meta.id)).toEqual([
      '2026-09-30T10:00:00.000Z',
      '2026-09-29T10:00:00.000Z',
      '2026-09-28T10:00:00.000Z',
    ]);
    // The evicted snapshot is gone from storage, not just from the listing.
    expect(backend.rows.has('2026-09-27T10:00:00.000Z')).toBe(false);
  });

  it('honours a custom retention limit', async () => {
    const backend = memoryBackend();
    const store = createSnapshotStore(backend, 1);

    await store.save(snapshot('2026-09-28T10:00:00.000Z'));
    await store.save(snapshot('2026-09-29T10:00:00.000Z'));

    expect(await store.list()).toHaveLength(1);
    expect(backend.rows.size).toBe(1);
  });

  it('trims an overfull storage on read, not only on write', async () => {
    const backend = memoryBackend();
    const store = createSnapshotStore(backend);
    for (const day of [20, 21, 22, 23, 24]) {
      backend.rows.set(`2026-09-${day}T10:00:00.000Z`, snapshot(`2026-09-${day}T10:00:00.000Z`));
    }

    const list = await store.list();

    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(backend.rows.size).toBe(MAX_SNAPSHOTS);
  });

  it('orders same-millisecond saves deterministically', () => {
    const sameStamp = [
      { id: '2026-09-29T10:00:00.000Z', createdAt: '2026-09-29T10:00:00.000Z' },
      { id: '2026-09-29T10:00:00.001Z', createdAt: '2026-09-29T10:00:00.000Z' },
    ];

    expect(
      sameStamp
        .slice()
        .sort(byNewestFirst)
        .map((meta) => meta.id)
    ).toEqual(['2026-09-29T10:00:00.001Z', '2026-09-29T10:00:00.000Z']);
  });
});

describe('snapshot store retrieval', () => {
  it('reads a stored snapshot back with its lessons intact', async () => {
    const backend = memoryBackend();
    const store = createSnapshotStore(backend);
    const shot = snapshot('2026-09-29T10:00:00.000Z');

    await store.save(shot);
    const restored = await store.get(shot.id);

    expect(restored.lessons).toEqual(shot.lessons);
    expect(restored.fileName).toBe('week-38.xls');
  });

  it('returns null for a snapshot that is gone', async () => {
    const store = createSnapshotStore(memoryBackend());

    expect(await store.get('nope')).toBeNull();
  });

  it('surfaces a failing storage so the admin can be told the rollback is unavailable', async () => {
    const backend = memoryBackend();
    backend.list.mockRejectedValueOnce(new Error('IndexedDB недоступен'));
    const store = createSnapshotStore(backend);

    await expect(store.list()).rejects.toThrow('IndexedDB недоступен');
  });

  it('does not swallow a failed write', async () => {
    const backend = memoryBackend();
    backend.write.mockRejectedValueOnce(new Error('quota exceeded'));
    const store = createSnapshotStore(backend);

    await expect(store.save(snapshot('2026-09-29T10:00:00.000Z'))).rejects.toThrow(
      'quota exceeded'
    );
  });
});

describe('formatSnapshotDate', () => {
  it('renders a local date and time the admin recognises', () => {
    const when = new Date(2026, 8, 29, 18, 10, 11);

    expect(formatSnapshotDate(when.toISOString())).toBe('29.09.2026 18:10');
  });

  it('shows the raw value when it is not a date at all', () => {
    expect(formatSnapshotDate('не дата')).toBe('не дата');
  });
});
