import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVisitStore,
  describeVisitError,
  unavailableVisitStats,
  VISITS_TABLE,
} from '../../src/admin/visits.ts';

/**
 * The optional `app_visits` table, with the table missing.
 *
 * The table is applied by the project owner by hand, so "no table" is the state
 * every install is in until then. These tests pin the two promises that make
 * that safe: the app behaves exactly as before (no throw, no console noise), and
 * the visit write never blocks the first render nor breaks when it fails.
 */

const UUID = '3f2b1a44-9c8d-4e17-9a55-0b6d2f7c81ab';
const MISSING_TABLE = { code: '42P01', message: 'relation "app_visits" does not exist' };
const DENIED = { code: '42501', message: 'new row violates row-level security policy' };

/**
 * A client double whose `from()` returns a chainable, awaitable builder — the
 * same shape supabase-js hands back for `select(...).gte(...)`.
 */
function makeClient(config = {}) {
  const calls = [];

  function resultFor(gte) {
    if (config.error) return { count: null, error: config.error };
    if (config.throws) throw config.throws;
    if (gte) {
      const value = config.counts?.bySince?.[gte.value];
      if (value === undefined) return { count: null, error: { code: 'COUNT_MISSING' } };
      return { count: value, error: null };
    }
    return { count: config.counts?.total ?? 0, error: null };
  }

  const client = {
    from(table) {
      calls.push({ op: 'from', table });

      /** An awaitable that can still be filtered, exactly like a PostgREST builder. */
      function chain(gte) {
        const awaitable = Promise.resolve(resultFor(gte));
        awaitable.gte = (column, value) => {
          calls.push({ op: 'gte', table, column, value });
          return chain({ column, value });
        };
        return awaitable;
      }

      return {
        select(columns, options) {
          calls.push({ op: 'select', table, columns, options });
          return chain(null);
        },
        upsert(rows, options) {
          calls.push({ op: 'upsert', table, rows, options });
          if (config.writeThrows) return Promise.reject(config.writeThrows);
          return Promise.resolve({ error: config.writeError ?? config.error ?? null });
        },
      };
    },
  };

  return { client, calls };
}

const NOW = new Date('2026-09-29T12:00:00.000Z');

let consoleSpies;

beforeEach(() => {
  // The logger writes through `console`, so spying here is how a test proves
  // that a missing table is handled silently.
  consoleSpies = ['debug', 'info', 'warn', 'error', 'log'].map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {})
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/** Lets the deferred write and its promise settle. */
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('visit stats: the table exists', () => {
  it('reports devices over 7 days, 30 days and in total', async () => {
    const { client, calls } = makeClient({
      counts: {
        total: 120,
        bySince: { '2026-09-22T12:00:00.000Z': 40, '2026-08-30T12:00:00.000Z': 95 },
      },
    });
    const store = createVisitStore({ client, now: () => NOW });

    const stats = await store.load();

    expect(stats).toEqual({
      available: true,
      devices7d: 40,
      devices30d: 95,
      devicesTotal: 120,
      reason: null,
    });
    // One probe plus two windows, all counted by PostgREST — no row is fetched.
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(3);
    expect(calls.every((c) => c.table === VISITS_TABLE)).toBe(true);
    expect(calls.filter((c) => c.op === 'select').every((c) => c.options.head === true)).toBe(true);
  });
});

describe('visit stats: the table is missing', () => {
  it('reports the numbers as unavailable instead of failing', async () => {
    const { client, calls } = makeClient({ error: MISSING_TABLE });
    const store = createVisitStore({ client, now: () => NOW });

    const stats = await store.load();

    expect(stats.available).toBe(false);
    expect(stats.devices7d).toBeNull();
    expect(stats.devices30d).toBeNull();
    expect(stats.devicesTotal).toBeNull();
    expect(stats.reason).toContain('не установлена');
    // The first probe already answered; the two window reads are pointless.
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(1);
  });

  it('stays completely silent: no console output for a documented state', async () => {
    const { client } = makeClient({ error: MISSING_TABLE });
    const store = createVisitStore({ client, now: () => NOW });

    await store.load();

    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('never tries to create the table', async () => {
    const { client, calls } = makeClient({ error: MISSING_TABLE });
    const store = createVisitStore({ client, now: () => NOW });

    await store.load();
    store.recordVisit(UUID);
    await flush();

    const verbs = new Set(calls.map((c) => c.op));
    expect(verbs.has('from')).toBe(true);
    // Only reads and an upsert: no rpc, no create, no schema change.
    expect(verbs.has('rpc')).toBe(false);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });

  it('names the RLS policy when the table exists but refuses the read', async () => {
    const { client } = makeClient({ error: DENIED });
    const store = createVisitStore({ client, now: () => NOW });

    const stats = await store.load();

    expect(stats.available).toBe(false);
    expect(stats.reason).toContain('RLS');
  });

  it('refuses to invent a zero when PostgREST answers without a count', async () => {
    const { client } = makeClient({ counts: { total: 0, bySince: {} } });
    const store = createVisitStore({ client, now: () => NOW });

    const stats = await store.load();
    expect(stats.available).toBe(false);
  });

  it('survives a client that throws instead of answering', async () => {
    const { client } = makeClient({ throws: new Error('network down') });
    const store = createVisitStore({ client, now: () => NOW });

    await expect(store.load()).resolves.toMatchObject({ available: false });
  });
});

describe('visit recording: fire-and-forget', () => {
  it('writes nothing before it returns to the caller', () => {
    const { client, calls } = makeClient();
    const store = createVisitStore({ client, now: () => NOW });

    const returned = store.recordVisit(UUID);

    // Not a promise, not a throw: the app's first render is never waiting on it.
    expect(returned).toBeUndefined();
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
  });

  it('writes only the anonymous device id and the date, later', async () => {
    const { client, calls } = makeClient();
    const store = createVisitStore({ client, now: () => NOW });

    store.recordVisit(UUID);
    await flush();

    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert.rows).toEqual({ device_id: UUID, last_seen_at: NOW.toISOString() });
    expect(upsert.options).toEqual({ onConflict: 'device_id' });
    // Nothing that could identify a person: no group, no user agent, no IP.
    expect(Object.keys(upsert.rows).sort()).toEqual(['device_id', 'last_seen_at']);
  });

  it('does not break the app when the insert is rejected', async () => {
    const { client } = makeClient({ error: DENIED });
    const store = createVisitStore({ client, now: () => NOW });

    expect(() => store.recordVisit(UUID)).not.toThrow();
    await flush();

    // No unhandled rejection, no console noise.
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('does not break the app when the request itself fails', async () => {
    const { client } = makeClient({ writeThrows: new Error('offline') });
    const store = createVisitStore({ client, now: () => NOW });

    expect(() => store.recordVisit(UUID)).not.toThrow();
    await flush();
  });

  it('stops writing for the session once the table is known to be missing', async () => {
    const { client, calls } = makeClient({ error: MISSING_TABLE });
    const store = createVisitStore({ client, now: () => NOW });

    store.recordVisit(UUID);
    await flush();
    store.recordVisit(UUID);
    await flush();

    // One useless request per launch is the whole budget.
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });

  it('keeps trying after a transport hiccup', async () => {
    let failNext = true;
    const calls = [];
    const client = {
      from() {
        return {
          select: () => Promise.resolve({ count: 0, error: null }),
          upsert: (rows) => {
            calls.push(rows);
            if (failNext) {
              failNext = false;
              return Promise.resolve({ error: { code: 'PGRST116', message: 'timeout' } });
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const store = createVisitStore({ client, now: () => NOW });

    store.recordVisit(UUID);
    await flush();
    store.recordVisit(UUID);
    await flush();

    // A flaky network must not cost the student their visit for the day.
    expect(calls).toHaveLength(2);
  });

  it('ignores an id the uuid column would reject', async () => {
    const { client, calls } = makeClient();
    const store = createVisitStore({ client, now: () => NOW });

    store.recordVisit('not-a-uuid');
    await flush();

    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
  });
});

describe('visit error wording', () => {
  it('always returns a sentence, even for an error with nothing in it', () => {
    expect(describeVisitError(null)).toMatch(/неизвестная ошибка/);
    expect(describeVisitError({})).toMatch(/ошибка чтения/);
    expect(unavailableVisitStats('почему').reason).toBe('почему');
  });
});
