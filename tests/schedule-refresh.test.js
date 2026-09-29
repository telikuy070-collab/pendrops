import { describe, expect, it, vi } from 'vitest';
import {
  loadCachedScheduleUseCase,
  refreshScheduleUseCase,
  loadScheduleUseCase,
} from '../src/core/domain/use-cases/schedule.ts';

/** @param {{version?: string, lessons?: number}} options */
function makeData(options = {}) {
  const lessons = Array.from({ length: options.lessons ?? 2 }, (_, index) => ({
    id: String(index),
    day: 'Понедельник',
    subject: `Пара ${index}`,
  }));
  return {
    version: options.version ?? 'W1',
    updatedAt: '2026-09-12T20:50:16.582Z',
    sheets: new Map([['СЖ', lessons]]),
    sheetsMeta: [{ id: 'СЖ', name: 'СЖ', lessonCount: lessons.length, order: 0 }],
    groups: new Map(),
    preferences: { currentSheetId: 'СЖ', currentGroup: '', activeSubgroup: '', hiddenSheets: [] },
  };
}

function makeStorage({ cached = null, setResult = true } = {}) {
  return {
    get: vi.fn(async () => cached),
    set: vi.fn(async () => setResult),
    remove: vi.fn(async () => {}),
  };
}

describe('cached first render', () => {
  it('returns the cached snapshot so the first render is not blocked', async () => {
    const cached = makeData({ version: 'W1' });
    const storage = makeStorage({ cached });
    await expect(loadCachedScheduleUseCase(storage)).resolves.toBe(cached);
  });

  it('returns null when there is no usable cache', async () => {
    const storage = makeStorage({ cached: null });
    await expect(loadCachedScheduleUseCase(storage)).resolves.toBeNull();
    const empty = makeStorage({ cached: { sheets: new Map() } });
    await expect(loadCachedScheduleUseCase(empty)).resolves.toBeNull();
  });
});

describe('authoritative refresh', () => {
  it('applies fresh data and refreshes the offline cache', async () => {
    const fresh = makeData({ version: 'W2' });
    const storage = makeStorage();
    const repository = { loadFull: vi.fn(async () => fresh) };

    const result = await refreshScheduleUseCase(repository, storage);

    expect(result.data).toBe(fresh);
    expect(result.cacheUpdated).toBe(true);
    expect(storage.set).toHaveBeenCalledWith('schedule_cache', fresh);
  });

  it('reports a failed cache write without throwing and without losing data', async () => {
    const fresh = makeData({ version: 'W2' });
    const storage = makeStorage({ setResult: false });
    const repository = { loadFull: vi.fn(async () => fresh) };

    const result = await refreshScheduleUseCase(repository, storage);

    expect(result.data).toBe(fresh);
    expect(result.cacheUpdated).toBe(false);
  });

  it('propagates repository failures so the caller can offer a retry', async () => {
    const storage = makeStorage();
    const repository = {
      loadFull: vi.fn(async () => {
        throw new Error('network down');
      }),
    };
    await expect(refreshScheduleUseCase(repository, storage)).rejects.toThrow('network down');
    // A failed load must not attempt to overwrite the cached schedule.
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('falls back to the repository when the cache is empty', async () => {
    const fresh = makeData({ version: 'W3' });
    const storage = makeStorage();
    const repository = { loadFull: vi.fn(async () => fresh) };
    await expect(loadScheduleUseCase(repository, storage)).resolves.toBe(fresh);
  });
});
