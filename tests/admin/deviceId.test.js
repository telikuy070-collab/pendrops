import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDeviceId, isUuid, newDeviceId, resetDeviceIdCache } from '../../src/admin/deviceId.ts';

/**
 * The anonymous device id behind both counters.
 *
 * The `app_visits.device_id` column is `uuid`, and the value is the only thing
 * that ever leaves the device, so it has to be a real uuid that survives a
 * reload — and a browser that refuses localStorage must not break the app.
 */

afterEach(() => {
  resetDeviceIdCache();
});

/** A localStorage double that can also be told to refuse every write. */
function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('device id', () => {
  it('generates a valid uuid', () => {
    expect(isUuid(newDeviceId())).toBe(true);
    // Two calls must not collide: this id is a primary key.
    expect(newDeviceId()).not.toBe(newDeviceId());
  });

  it('recognises what the uuid column would accept and reject', () => {
    expect(isUuid('3f2b1a44-9c8d-4e17-9a55-0b6d2f7c81ab')).toBe(true);
    expect(isUuid('3F2B1A44-9C8D-4E17-9A55-0B6D2F7C81AB')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('keeps the same id across calls and reloads', () => {
    const storage = makeStorage();
    const first = getDeviceId(storage);

    resetDeviceIdCache();
    expect(getDeviceId(storage)).toBe(first);
    expect(storage.data['pendrops.device_id.v1']).toBe(first);
  });

  it('reuses an id a previous install wrote', () => {
    const stored = '11111111-2222-4333-8444-555555555555';
    const storage = makeStorage({ 'pendrops.device_id.v1': stored });

    expect(getDeviceId(storage)).toBe(stored);
  });

  it('replaces a stored value the uuid column would reject', () => {
    const storage = makeStorage({ 'pendrops.device_id.v1': 'garbage' });

    const id = getDeviceId(storage);

    expect(isUuid(id)).toBe(true);
    expect(storage.data['pendrops.device_id.v1']).toBe(id);
  });

  it('still works when the browser refuses local storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {},
    };

    const id = getDeviceId(blocked);

    // A session-scoped id instead of a crash: the app has no other way to tell
    // devices apart, and an unusable id must not take the timetable down.
    expect(isUuid(id)).toBe(true);
    resetDeviceIdCache();
    expect(getDeviceId(blocked)).not.toBe('');
  });

  it('does not blow up when there is no storage at all', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(isUuid(getDeviceId(null))).toBe(true);
  });
});
