import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Paged reads from Supabase.
 *
 * PostgREST serves at most `max-rows` rows per request and reports no error
 * when it stops there, so a range-less read of a 1237-row table returns 1000
 * rows and looks complete. These tests pin the behaviour that makes the read
 * honest instead: the repository walks the table with `.range()`, and any
 * disagreement with the count the server reports is raised rather than shown
 * to the student as a schedule with days missing.
 */

const { clientDouble } = vi.hoisted(() => ({ clientDouble: { current: null } }));

vi.mock('../src/infrastructure/supabase/client', () => ({
  getSupabaseClient: () => clientDouble.current,
  resetSupabaseClient: () => {},
}));

const { SupabaseScheduleRepository } = await import('../src/infrastructure/supabase/repository.ts');
const { TruncatedScheduleReadError } = await import('../src/core/domain/errors.ts');

/** One lesson row, shaped like the `lessons` table. */
function makeRow(index) {
  return {
    id: `row-${String(index).padStart(4, '0')}`,
    sheet_id: 'ПСТ',
    day: 'Понедельник',
    day_order: 0,
    time: '08:00-09:20',
    para: String(index + 1),
    group_code: 'ПСТ-1-25',
    subgroup: '1',
    subject: `Предмет ${index}`,
    type: 'practice',
    teacher: '',
    room: '',
    is_exam: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

const PAGE = 1000;

/**
 * A client whose `lessons` reads are served by `servePage(from, to)`.
 *
 * `servePage` receives each requested range and answers the exact shape
 * PostgREST would send, so the repository cannot tell the double apart from the
 * real server. Every range that was asked for is recorded in `ranges`.
 */
function createPagedClient({
  total,
  servePage,
  version = { version: 'v1', updated_at: 'x' },
} = {}) {
  const ranges = [];
  const selects = [];
  const orders = [];

  const builderFor = (table) => {
    if (table === 'schedule_version') {
      const versionBuilder = {
        select: () => versionBuilder,
        eq: () => versionBuilder,
        limit: () => Promise.resolve({ data: [version], error: null }),
        maybeSingle: () => Promise.resolve({ data: version, error: null }),
      };
      return versionBuilder;
    }

    const builder = {
      select: (...args) => {
        selects.push(args);
        return builder;
      },
      order: (column) => {
        orders.push(column);
        return builder;
      },
      gt: () => builder,
      range: (from, to) => {
        ranges.push({ from, to });
        return Promise.resolve(servePage(from, to, total));
      },
    };
    return builder;
  };

  clientDouble.current = {
    from: builderFor,
    functions: { invoke: vi.fn() },
    removeChannel: vi.fn(),
    realtime: { getChannels: () => [] },
  };
  return { repository: new SupabaseScheduleRepository(), ranges, selects, orders };
}

/** The default server: honest paging over `total` rows, `count` on every page. */
function honestPage(total) {
  return (from, to) => {
    const rows = [];
    for (let i = from; i < Math.min(to + 1, total); i++) rows.push(makeRow(i));
    return { data: rows, error: null, count: total };
  };
}

beforeEach(() => {
  clientDouble.current = null;
});

describe('loadFull: paging through the whole table', () => {
  it('collects every row across four server pages', async () => {
    // 3500 rows is three full pages plus a short one, so the walk takes four
    // requests. A range-less read would have returned 1000 of 3500 and said
    // nothing about the rest.
    const total = 3500;
    const { repository, ranges } = createPagedClient({ total, servePage: honestPage(total) });

    const data = await repository.loadFull();

    const lessons = data.sheets.get('ПСТ');
    expect(lessons).toHaveLength(total);
    expect(lessons[0].id).toBe('row-0000');
    expect(lessons[total - 1].id).toBe(`row-${total - 1}`);

    expect(ranges).toEqual([
      { from: 0, to: PAGE - 1 },
      { from: PAGE, to: 2 * PAGE - 1 },
      { from: 2 * PAGE, to: 3 * PAGE - 1 },
      { from: 3 * PAGE, to: 4 * PAGE - 1 },
    ]);
  });

  it('collects all 1237 rows of the published table, not the first 1000', async () => {
    // The size of the real `lessons` table, and the case that produced "the
    // schedule sometimes misses a day": 1000 rows returned, 237 silently lost.
    const total = 1237;
    const { repository, ranges } = createPagedClient({ total, servePage: honestPage(total) });

    const data = await repository.loadFull();

    const lessons = data.sheets.get('ПСТ');
    expect(lessons).toHaveLength(1237);
    // Every id appears exactly once: paging must not repeat or skip a row.
    expect(new Set(lessons.map((l) => l.id)).size).toBe(1237);
    expect(ranges).toEqual([
      { from: 0, to: PAGE - 1 },
      { from: PAGE, to: 2 * PAGE - 1 },
    ]);
  });

  it('asks the server for the exact count so a shortfall can be detected', async () => {
    const total = 1237;
    const { repository, selects } = createPagedClient({ total, servePage: honestPage(total) });

    await repository.loadFull();

    // The query is rebuilt for every page, so every recorded select asks for
    // the count: without it a truncation could not be detected at all.
    expect(selects.length).toBeGreaterThan(0);
    for (const args of selects) expect(args).toEqual(['*', { count: 'exact' }]);
  });

  it('orders by a unique column so paging cannot repeat or skip a row', async () => {
    const total = 1237;
    const { repository, orders } = createPagedClient({ total, servePage: honestPage(total) });

    await repository.loadFull();

    // `day_order` and `time` repeat across a week, so paging over them alone is
    // not a total order. `id` is what makes page boundaries sound.
    expect(orders.slice(0, 3)).toEqual(['day_order', 'time', 'id']);
  });

  it('stops on a single page when the table is smaller than one page', async () => {
    const total = 12;
    const { repository, ranges } = createPagedClient({ total, servePage: honestPage(total) });

    const data = await repository.loadFull();

    expect(data.sheets.get('ПСТ')).toHaveLength(total);
    expect(ranges).toEqual([{ from: 0, to: PAGE - 1 }]);
  });

  it('reads an empty table without asking for a second page', async () => {
    const { repository, ranges } = createPagedClient({ total: 0, servePage: honestPage(0) });

    const data = await repository.loadFull();

    expect(data.sheets.size).toBe(0);
    expect(ranges).toHaveLength(1);
  });
});

describe('loadFull: a server that under-delivers', () => {
  // A truncated read is retried, and the real backoff between attempts costs
  // about seven seconds. The retries themselves are what these tests check, so
  // the delays are collapsed instead of being waited out: every attempt still
  // runs, the suite just does not spend half a minute asleep.
  let instantTimers;
  beforeEach(() => {
    instantTimers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 0;
    });
  });
  afterEach(() => {
    instantTimers.mockRestore();
  });
  it('fails instead of publishing a truncated schedule', async () => {
    // The server claims 1237 rows but the walk ends after 1000: exactly the
    // silent max-rows truncation this loop exists to catch.
    const servePage = (from) => ({
      data: from === 0 ? Array.from({ length: PAGE }, (_, i) => makeRow(i)) : [],
      error: null,
      count: 1237,
    });
    const { repository } = createPagedClient({ total: 1237, servePage });

    // The read is retried, and every attempt truncates the same way.
    await expect(repository.loadFull()).rejects.toBeInstanceOf(TruncatedScheduleReadError);
  });

  it('names the received and expected totals so the loss is legible', async () => {
    const servePage = (from) => ({
      data: from === 0 ? Array.from({ length: PAGE }, (_, i) => makeRow(i)) : [],
      error: null,
      count: 1237,
    });
    const { repository } = createPagedClient({ total: 1237, servePage });

    const error = await repository.loadFull().catch((e) => e);

    expect(error).toBeInstanceOf(TruncatedScheduleReadError);
    expect(error.received).toBe(1000);
    expect(error.expected).toBe(1237);
    expect(error.userMessage).toContain('1000');
    expect(error.userMessage).toContain('1237');
  });

  it('retries rather than showing a partial week when the count moves mid-read', async () => {
    let attempt = 0;
    // The first attempt reads a table that a publish replaced underneath it.
    // The second one sees a settled table, which is what a student needs.
    const servePage = (from, to) => {
      if (attempt === 0) {
        attempt++;
        return {
          data: from === 0 ? Array.from({ length: PAGE }, (_, i) => makeRow(i)) : [],
          error: null,
          count: 1237,
        };
      }
      return honestPage(1237)(from, to);
    };
    const { repository } = createPagedClient({ total: 1237, servePage });

    const data = await repository.loadFull();

    expect(attempt).toBe(1);
    expect(data.sheets.get('ПСТ')).toHaveLength(1237);
  });

  it('reports a missing count as a failed read rather than trusting full pages', async () => {
    // No `count` on any page and every page full: the read is provably
    // incomplete, so it must not be reported as a complete schedule.
    // The double restarts its page counter on `from === 0`, so the number is
    // the pages ONE attempt asked for.
    let pagesThisAttempt = 0;
    let maxPages = 0;
    const servePage = (from) => {
      if (from === 0) {
        maxPages = Math.max(maxPages, pagesThisAttempt);
        pagesThisAttempt = 0;
      }
      pagesThisAttempt++;
      return {
        data: Array.from({ length: PAGE }, (_, i) => makeRow(pagesThisAttempt * PAGE + i)),
        error: null,
      };
    };
    const { repository } = createPagedClient({ servePage });

    const error = await repository.loadFull().catch((e) => e);

    expect(error).toBeInstanceOf(TruncatedScheduleReadError);
    expect(error.expected).toBeNull();
    // Bounded by MAX_READ_PAGES rather than looping forever on a server that
    // ignores `range`.
    expect(maxPages).toBe(100);
  });
});

describe('getChangesSince: paging through the changes', () => {
  let instantTimers;
  beforeEach(() => {
    instantTimers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb) => {
      cb();
      return 0;
    });
  });
  afterEach(() => {
    instantTimers.mockRestore();
  });
  it('collects every changed row past the cursor', async () => {
    const total = 1237;
    const { repository, ranges, orders } = createPagedClient({
      total,
      servePage: honestPage(total),
    });

    const result = await repository.getChangesSince('v0');

    expect(result.lessons).toHaveLength(total);
    // One publish stamps every row with the same `updated_at`, so the
    // tiebreaker is what keeps the pages from overlapping.
    expect(orders.slice(0, 2)).toEqual(['updated_at', 'id']);
    expect(new Set(result.lessons.map((l) => l.id)).size).toBe(total);
  });

  it('fails instead of returning a partial change set', async () => {
    const servePage = (from) => ({
      data: from === 0 ? Array.from({ length: PAGE }, (_, i) => makeRow(i)) : [],
      error: null,
      count: 1237,
    });
    const { repository } = createPagedClient({ total: 1237, servePage });

    await expect(repository.getChangesSince('v0')).rejects.toBeInstanceOf(
      TruncatedScheduleReadError
    );
  });
});
