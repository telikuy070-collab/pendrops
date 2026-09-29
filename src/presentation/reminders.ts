/**
 * Local lesson reminders.
 *
 * A browser PWA cannot wake itself up with the app closed, so this module is
 * deliberately modest: a local timer while the page lives, a list persisted in
 * localStorage so a reload keeps it, and the platform Notification API. No
 * server round-trip is involved, because there is nothing to notify a server
 * about.
 *
 * Every platform dependency is injected so the whole store is testable and
 * degrades to a no-op when the API is missing.
 */
import type { Lesson } from '@core/domain/entities/types';
import { lessonKey } from '@core/domain/scheduleDiff';
import {
  createReminder,
  dueReminders,
  pruneReminders,
  reminderSkipReason,
  sortReminders,
  DEFAULT_REMINDER_LEAD,
  REMINDER_LEAD_OPTIONS,
} from '@core/domain/reminder';
import type { Reminder, ReminderSkipReason } from '@core/domain/reminder';

export const REMINDERS_KEY = 'pendrops.reminders.v1';
export const REMINDER_LEAD_KEY = 'pendrops.reminderLead.v1';

/** How often the store looks for reminders that are due. */
export const TICK_MS = 15_000;

/**
 * A reminder that became due while the tab was backgrounded is still worth
 * showing when the student comes back — but only while the class is close.
 */
const LATE_GRACE_MS = 5 * 60_000;

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
export type AddResult =
  { ok: true; reminder: Reminder } | { ok: false; reason: ReminderSkipReason };

interface NotificationApiLike {
  permission: string;
  requestPermission?: () => Promise<string> | void;
  /** Shows a notification, swallowing engines that refuse the call. */
  show: (title: string, options: { body?: string; tag?: string }) => void;
}

export interface ReminderEnv {
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  notifications: NotificationApiLike | null;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

function safeLocalStorage(): ReminderEnv['storage'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private mode / blocked storage: reminders stay in memory for this visit.
    return null;
  }
}

function readNotifications(): NotificationApiLike | null {
  try {
    if (typeof Notification === 'undefined') return null;
    const api = Notification as unknown as {
      permission: string;
      requestPermission?: () => Promise<string>;
      new (title: string, options?: { body?: string; tag?: string }): unknown;
    };
    return {
      get permission() {
        return String(api.permission || 'default');
      },
      requestPermission: api.requestPermission ? () => api.requestPermission!() : undefined,
      show(title, options) {
        try {
          new api(title, options);
        } catch {
          // Some engines only allow notifications from a service worker.
        }
      },
    };
  } catch {
    return null;
  }
}

export function defaultEnv(): ReminderEnv {
  return {
    now: () => Date.now(),
    storage: safeLocalStorage(),
    notifications: readNotifications(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

export interface ReminderStore {
  permission(): PermissionState;
  /** True when a reminder button may be shown at all. */
  canRemind(): boolean;
  /** True when asking the browser could still succeed. */
  canAsk(): boolean;
  request(): Promise<PermissionState>;
  lead(): number;
  setLead(minutes: number): void;
  leadOptions(): readonly number[];
  list(): Reminder[];
  keys(): Set<string>;
  add(lesson: Lesson): AddResult;
  cancel(id: string): void;
  clearAll(): void;
  start(): void;
  stop(): void;
  onChange(listener: () => void): () => void;
}

export function createReminderStore(env: ReminderEnv = defaultEnv()): ReminderStore {
  let reminders: Reminder[] = load();
  let lead = loadLead();
  let timer: unknown = null;
  /** @type {(() => void) | null} */
  let onVisibility: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function load(): Reminder[] {
    const raw = env.storage?.getItem(REMINDERS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return pruneReminders(parsed as Reminder[], env.now());
    } catch {
      return [];
    }
  }

  function loadLead(): number {
    const raw = env.storage?.getItem(REMINDER_LEAD_KEY);
    const parsed = Number(raw);
    return REMINDER_LEAD_OPTIONS.includes(parsed) ? parsed : DEFAULT_REMINDER_LEAD;
  }

  function persist(): void {
    try {
      env.storage?.setItem(REMINDERS_KEY, JSON.stringify(reminders));
    } catch {
      // A full or unavailable storage must not break reminders that are
      // already armed; they simply do not survive the next reload.
    }
  }

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function permission(): PermissionState {
    const api = env.notifications;
    if (!api) return 'unsupported';
    const value = String(api.permission || 'default');
    return value === 'granted' || value === 'denied' ? value : 'default';
  }

  function canRemind(): boolean {
    return permission() === 'granted';
  }

  function canAsk(): boolean {
    const state = permission();
    return state === 'default' || state === 'granted';
  }

  async function request(): Promise<PermissionState> {
    const api = env.notifications;
    if (!api) return 'unsupported';
    if (permission() === 'denied') return 'denied';
    if (permission() === 'granted') return 'granted';
    try {
      await api.requestPermission?.();
    } catch {
      // A browser that refuses to ask stays at "default"; the UI keeps the
      // enable button and no reminder button.
    }
    const state = permission();
    emit();
    return state;
  }

  function notify(reminder: Reminder): void {
    const api = env.notifications;
    if (!api || !canRemind()) return;
    const parts = [reminder.time, reminder.room].filter(Boolean);
    api.show(`Пара скоро: ${reminder.subject || 'занятие'}`, {
      body: parts.join(' · '),
      tag: reminder.id,
    });
  }

  /** Fires everything that is due, then drops it from the list. */
  function check(): void {
    const now = env.now();
    const due = dueReminders(reminders, now).filter(
      (reminder) => now - reminder.fireAt <= LATE_GRACE_MS
    );
    for (const reminder of due) notify(reminder);
    const next = pruneReminders(reminders, now);
    if (next.length !== reminders.length) {
      reminders = next;
      persist();
      emit();
    }
  }

  function start(): void {
    if (timer) return;
    check();
    timer = env.setInterval(check, TICK_MS);
    // Coming back to a backgrounded tab is the most common moment for a due
    // reminder: check immediately instead of waiting for the next tick.
    if (typeof document !== 'undefined' && !onVisibility) {
      onVisibility = () => {
        if (document.visibilityState === 'visible') check();
      };
      document.addEventListener('visibilitychange', onVisibility);
    }
  }

  function stop(): void {
    if (timer) env.clearInterval(timer);
    timer = null;
    if (onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
    onVisibility = null;
  }

  function add(lesson: Lesson): AddResult {
    const now = env.now();
    const request = {
      day: lesson.day,
      time: lesson.time,
      subject: lesson.subject,
      teacher: lesson.teacher,
      room: lesson.room,
      key: lessonKey(lesson),
    };
    const reminder = createReminder(request, lead, now, `${request.key}:${now}`);
    if (!reminder) {
      return { ok: false, reason: reminderSkipReason(request, lead, now) || 'passed' };
    }
    // One reminder per lesson: re-tapping replaces the old one.
    reminders = pruneReminders(
      [...reminders.filter((item) => item.key !== reminder.key), reminder],
      now
    );
    persist();
    emit();
    return { ok: true, reminder };
  }

  return {
    permission,
    canRemind,
    canAsk,
    request,
    lead: () => lead,
    setLead(minutes: number) {
      if (!REMINDER_LEAD_OPTIONS.includes(minutes)) return;
      lead = minutes;
      try {
        env.storage?.setItem(REMINDER_LEAD_KEY, String(minutes));
      } catch {
        // Non-fatal: the choice simply does not survive the reload.
      }
      emit();
    },
    leadOptions: () => REMINDER_LEAD_OPTIONS,
    list: () => sortReminders(reminders),
    keys: () => new Set(reminders.map((item) => item.key).filter(Boolean) as string[]),
    add,
    cancel(id: string) {
      const next = reminders.filter((item) => item.id !== id);
      if (next.length === reminders.length) return;
      reminders = next;
      persist();
      emit();
    },
    clearAll() {
      if (!reminders.length) return;
      reminders = [];
      persist();
      emit();
    },
    start,
    stop,
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
