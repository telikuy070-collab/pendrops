// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReminderStore,
  REMINDERS_KEY,
  REMINDER_LEAD_KEY,
  TICK_MS,
} from '../../src/presentation/reminders';

/** In-memory storage with a spy, so persistence is observable. */
const fakeStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const fakeNotifications = (permission = 'granted') => {
  const shown = [];
  const api = {
    shown,
    permission,
    requestPermission: vi.fn(async () => {
      api.permission = 'granted';
      return 'granted';
    }),
    show: (title, options) => shown.push({ title, options }),
  };
  return api;
};

let clock = 0;
const env = (over = {}) => ({
  now: () => clock,
  storage: fakeStorage(),
  notifications: fakeNotifications(),
  setInterval: () => 1,
  clearInterval: () => {},
  ...over,
});

const lesson = (over = {}) => ({
  id: '1',
  sheetId: 'ЛД',
  day: 'Среда',
  dayOrder: 2,
  time: '14:00-15:20',
  para: '3',
  group: 'ЛД-11',
  subgroup: '',
  subject: 'Анатомия',
  type: 'lecture',
  teacher: 'Иванов',
  room: '201',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

// 2026-09-30 is a Wednesday.
const noon = new Date(2026, 8, 30, 12, 0).getTime();

beforeEach(() => {
  clock = noon;
});

describe('permission gate', () => {
  it('hides the reminder affordance while the permission is not granted', () => {
    const store = createReminderStore(env({ notifications: fakeNotifications('default') }));
    expect(store.canRemind()).toBe(false);
    expect(store.canAsk()).toBe(true);
  });

  it('hides the affordance entirely when the API is missing', () => {
    const store = createReminderStore(env({ notifications: null }));
    expect(store.permission()).toBe('unsupported');
    expect(store.canRemind()).toBe(false);
    expect(store.canAsk()).toBe(false);
  });

  it('asks once and reflects the answer', async () => {
    const store = createReminderStore(env({ notifications: fakeNotifications('default') }));
    expect(await store.request()).toBe('granted');
    expect(store.canRemind()).toBe(true);
  });

  it('does not ask again after a refusal', async () => {
    const notifications = fakeNotifications('denied');
    const store = createReminderStore(env({ notifications }));
    expect(store.canAsk()).toBe(false);
    expect(await store.request()).toBe('denied');
    expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
});

describe('scheduling', () => {
  it('stores the reminder so a reload keeps it', () => {
    const storage = fakeStorage();
    const store = createReminderStore(env({ storage }));
    const result = store.add(lesson());
    expect(result.ok).toBe(true);
    const saved = JSON.parse(storage.map.get(REMINDERS_KEY));
    expect(saved).toHaveLength(1);
    expect(saved[0].fireAt).toBe(new Date(2026, 8, 30, 13, 50).getTime());
    expect(saved[0].leadMinutes).toBe(10);

    // A fresh store over the same storage is what a page reload looks like.
    const reloaded = createReminderStore(env({ storage }));
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.keys().has(result.reminder.key)).toBe(true);
  });

  it('refuses a class that already started, with a reason the UI can explain', () => {
    const store = createReminderStore(env());
    const result = store.add(lesson({ time: '08:00-09:20' }));
    expect(result).toEqual({ ok: false, reason: 'passed' });
    expect(store.list()).toHaveLength(0);
  });

  it('refuses a class that starts sooner than the lead time', () => {
    const store = createReminderStore(env());
    expect(store.add(lesson({ time: '12:03-13:00' }))).toEqual({
      ok: false,
      reason: 'too-soon',
    });
  });

  it('replaces the reminder of the same lesson instead of duplicating it', () => {
    const store = createReminderStore(env());
    store.add(lesson());
    store.add(lesson());
    expect(store.list()).toHaveLength(1);
  });

  it('cancels one reminder and clears the rest', () => {
    const store = createReminderStore(env());
    store.add(lesson());
    store.add(lesson({ time: '16:00-17:20', room: '202' }));
    expect(store.list()).toHaveLength(2);
    store.cancel(store.list()[0].id);
    expect(store.list()).toHaveLength(1);
    store.clearAll();
    expect(store.list()).toHaveLength(0);
  });
});

describe('lead time', () => {
  it('defaults to 10 minutes and remembers the choice', () => {
    const storage = fakeStorage();
    const store = createReminderStore(env({ storage }));
    expect(store.lead()).toBe(10);
    store.setLead(30);
    expect(storage.map.get(REMINDER_LEAD_KEY)).toBe('30');
    expect(createReminderStore(env({ storage })).lead()).toBe(30);
  });

  it('ignores a value that is not offered', () => {
    const store = createReminderStore(env());
    store.setLead(7);
    expect(store.lead()).toBe(10);
  });
});

describe('firing', () => {
  it('notifies once the moment comes and then drops the reminder', () => {
    const notifications = fakeNotifications();
    let tick = () => {};
    const store = createReminderStore(
      env({ notifications, setInterval: (fn) => ((tick = fn), 1) })
    );
    const result = store.add(lesson());
    expect(result.ok).toBe(true);

    clock = new Date(2026, 8, 30, 13, 49).getTime();
    store.start();
    expect(notifications.shown).toHaveLength(0);

    clock = new Date(2026, 8, 30, 13, 50).getTime();
    tick();
    expect(notifications.shown).toEqual([
      {
        title: 'Пара скоро: Анатомия',
        options: { body: '14:00-15:20 · 201', tag: result.reminder.id },
      },
    ]);
    expect(store.list()).toHaveLength(0);
  });

  it('stays silent when the permission was revoked', () => {
    const notifications = fakeNotifications();
    let tick = () => {};
    const store = createReminderStore(
      env({ notifications, setInterval: (fn) => ((tick = fn), 1) })
    );
    store.add(lesson());
    notifications.permission = 'denied';
    clock = new Date(2026, 8, 30, 14, 0).getTime();
    tick();
    expect(notifications.shown).toHaveLength(0);
  });

  it('keeps ticking on its own schedule', () => {
    expect(TICK_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('unavailable storage', () => {
  it('still works for the current session', () => {
    const store = createReminderStore(env({ storage: null }));
    expect(store.add(lesson()).ok).toBe(true);
    expect(store.list()).toHaveLength(1);
  });
});
