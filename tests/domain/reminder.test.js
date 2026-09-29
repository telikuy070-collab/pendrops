import { describe, expect, it } from 'vitest';
import {
  createReminder,
  computeReminderAt,
  DEFAULT_REMINDER_LEAD,
  dueReminders,
  parseStartMinutes,
  pruneReminders,
  reminderSkipReason,
  REMINDER_LEAD_OPTIONS,
} from '../../src/core/domain/reminder';

/** 2026-09-30 is a Wednesday, built in the local timezone. */
const at = (day, hours, minutes = 0) => new Date(2026, 8, day, hours, minutes, 0, 0).getTime();
/** October 2026 (month index 9) — the days a week-over wrap lands on. */
const inOctober = (day, hours, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes, 0, 0).getTime();
const WEDNESDAY = at(30, 12, 0);
const WEDNESDAY_NAME = 'Среда';

describe('parseStartMinutes', () => {
  it('reads the start of a time range', () => {
    expect(parseStartMinutes('08:30-09:50')).toBe(510);
    expect(parseStartMinutes('8.05')).toBe(485);
  });

  it('rejects what it cannot understand', () => {
    expect(parseStartMinutes('')).toBeNull();
    expect(parseStartMinutes('по паре')).toBeNull();
    expect(parseStartMinutes('99:00')).toBeNull();
    expect(parseStartMinutes('10:99')).toBeNull();
  });
});

describe('reminder lead options', () => {
  it('offers 5/10/15/30 minutes and defaults to 10', () => {
    expect([...REMINDER_LEAD_OPTIONS]).toEqual([5, 10, 15, 30]);
    expect(DEFAULT_REMINDER_LEAD).toBe(10);
  });
});

describe('computeReminderAt', () => {
  it('fires the chosen lead time before a class later today', () => {
    const now = at(30, 12, 0);
    const fireAt = computeReminderAt({ day: WEDNESDAY_NAME, time: '14:00-15:20' }, 10, now);
    expect(fireAt).toBe(at(30, 13, 50));
  });

  it('honours a different lead time', () => {
    const now = at(30, 12, 0);
    expect(computeReminderAt({ day: WEDNESDAY_NAME, time: '14:00' }, 30, now)).toBe(at(30, 13, 30));
    expect(computeReminderAt({ day: WEDNESDAY_NAME, time: '14:00' }, 5, now)).toBe(at(30, 13, 55));
  });

  it('targets the next occurrence of a later weekday', () => {
    // Wednesday 30 Sep → the next Friday is 2 October.
    expect(computeReminderAt({ day: 'Пятница', time: '09:00' }, 10, WEDNESDAY)).toBe(
      inOctober(2, 8, 50)
    );
  });

  it('wraps to next week when the weekday already passed', () => {
    // Wednesday 30 Sep → the next Monday is 5 October.
    expect(computeReminderAt({ day: 'Понедельник', time: '08:30' }, 15, WEDNESDAY)).toBe(
      inOctober(5, 8, 15)
    );
  });

  it('refuses a class that already started today', () => {
    const now = at(30, 12, 0);
    expect(computeReminderAt({ day: WEDNESDAY_NAME, time: '08:00-09:20' }, 10, now)).toBeNull();
    expect(reminderSkipReason({ day: WEDNESDAY_NAME, time: '08:00-09:20' }, 10, now)).toBe(
      'passed'
    );
  });

  it('refuses a class that starts sooner than the lead time', () => {
    const now = at(30, 12, 0);
    const request = { day: WEDNESDAY_NAME, time: '12:05-13:00' };
    expect(computeReminderAt(request, 10, now)).toBeNull();
    expect(reminderSkipReason(request, 10, now)).toBe('too-soon');
    // The very same class with a shorter lead is perfectly schedulable.
    expect(computeReminderAt({ ...request, time: '12:06-13:00' }, 5, now)).toBe(at(30, 12, 1));
  });

  it('reports a missing time instead of guessing', () => {
    expect(reminderSkipReason({ day: WEDNESDAY_NAME, time: '' }, 10, WEDNESDAY)).toBe('no-time');
    expect(reminderSkipReason({ day: '', time: '08:00' }, 10, WEDNESDAY)).toBe('no-time');
  });
});

describe('createReminder', () => {
  it('carries everything the notification and the card need', () => {
    const reminder = createReminder(
      {
        day: WEDNESDAY_NAME,
        time: '14:00-15:20',
        subject: 'Анатомия',
        teacher: 'Иванов',
        room: '201',
        key: 'k1',
      },
      15,
      WEDNESDAY,
      'id-1'
    );
    expect(reminder).toEqual({
      id: 'id-1',
      fireAt: at(30, 13, 45),
      leadMinutes: 15,
      day: WEDNESDAY_NAME,
      time: '14:00-15:20',
      subject: 'Анатомия',
      teacher: 'Иванов',
      room: '201',
      key: 'k1',
    });
  });

  it('returns null instead of a reminder in the past', () => {
    expect(
      createReminder({ day: WEDNESDAY_NAME, time: '08:00' }, 10, WEDNESDAY, 'id-2')
    ).toBeNull();
  });
});

describe('reminder list maintenance', () => {
  const list = [
    {
      id: 'a',
      fireAt: 1000,
      leadMinutes: 10,
      day: '',
      time: '',
      subject: '',
      teacher: '',
      room: '',
    },
    {
      id: 'b',
      fireAt: 2000,
      leadMinutes: 10,
      day: '',
      time: '',
      subject: '',
      teacher: '',
      room: '',
    },
    {
      id: 'c',
      fireAt: 3000,
      leadMinutes: 10,
      day: '',
      time: '',
      subject: '',
      teacher: '',
      room: '',
    },
  ];

  it('lists the due ones', () => {
    expect(dueReminders(list, 2500).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('drops what already fired so the list cannot grow forever', () => {
    expect(pruneReminders(list, 2500).map((r) => r.id)).toEqual(['c']);
  });

  it('drops corrupted entries', () => {
    const broken = [...list, { id: 'x', fireAt: Number.NaN }];
    expect(pruneReminders(broken, 500).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the earliest reminder first', () => {
    expect(pruneReminders([list[2], list[0], list[1]], 0).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
