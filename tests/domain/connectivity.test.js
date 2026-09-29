import { describe, expect, it } from 'vitest';
import { formatUpdatedClock, resolveConnectivity } from '../../src/core/domain/connectivity';

const online = (over = {}) => ({ browserOnline: true, loadFailed: false, hasData: true, ...over });

describe('formatUpdatedClock', () => {
  it('renders the local time of a schedule stamp', () => {
    const stamp = new Date(2026, 8, 30, 8, 12).toISOString();
    expect(formatUpdatedClock(stamp)).toBe('08:12');
  });

  it('is empty for a missing or unusable stamp', () => {
    expect(formatUpdatedClock(undefined)).toBe('');
    expect(formatUpdatedClock('вчера')).toBe('');
  });
});

describe('resolveConnectivity', () => {
  it('stays silent while everything works', () => {
    const result = resolveConnectivity(online({ updatedAt: '2026-09-30T05:12:00.000Z' }));
    expect(result).toEqual({ offline: false, text: '' });
  });

  it('reports the browser saying there is no network', () => {
    const result = resolveConnectivity(
      online({ browserOnline: false, updatedAt: new Date(2026, 8, 30, 8, 12).toISOString() })
    );
    expect(result.offline).toBe(true);
    expect(result.text).toBe('Офлайн · последнее обновление в 08:12');
  });

  it('trusts a failed load even when the browser claims to be online', () => {
    const result = resolveConnectivity(
      online({ loadFailed: true, updatedAt: new Date(2026, 8, 30, 8, 12).toISOString() })
    );
    expect(result.offline).toBe(true);
    expect(result.text).toContain('Офлайн');
  });

  it('clears itself as soon as a load succeeds', () => {
    expect(resolveConnectivity(online({ loadFailed: false })).offline).toBe(false);
    expect(resolveConnectivity(online({ browserOnline: true, loadFailed: false })).offline).toBe(
      false
    );
  });

  it('does not promise data it does not have', () => {
    expect(resolveConnectivity(online({ hasData: false, loadFailed: true })).text).toBe(
      'Офлайн · сохранённого расписания пока нет'
    );
    expect(resolveConnectivity(online({ hasData: true, loadFailed: true })).text).toBe(
      'Офлайн · показываем сохранённое расписание'
    );
  });
});
