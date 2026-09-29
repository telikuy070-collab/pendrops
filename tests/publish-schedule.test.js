import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the direct-write publish path in SupabaseScheduleRepository.
 *
 * The Supabase client is replaced by a recording double: every call is captured
 * in `calls` as `{ op, table, payload, options }` so both the call order and
 * the payload of each chunk can be asserted.
 */

const { clientDouble } = vi.hoisted(() => ({ clientDouble: { current: null } }));

vi.mock('../src/infrastructure/supabase/client', () => ({
  getSupabaseClient: () => clientDouble.current,
  resetSupabaseClient: () => {},
}));

const { SupabaseScheduleRepository } = await import('../src/infrastructure/supabase/repository.ts');

/**
 * Builds a query-builder double for one table.
 * `failures` maps an op to the PostgREST error that op should answer with,
 * which keeps the chain self-referential (`delete().lt()` returns the same
 * builder that carries the override).
 */
function makeBuilder(calls, table, failures = {}) {
  const record = (op, payload, options) => calls.push({ op, table, payload, options });
  const failure = (op) => ({ data: null, error: failures[op] ?? null });

  const builder = {
    select: (...args) => {
      record('select', args);
      return builder;
    },
    insert: (rows) => {
      record('insert', rows);
      return Promise.resolve(failure('insert'));
    },
    upsert: (rows, options) => {
      record('upsert', rows, options);
      return Promise.resolve(failure('upsert'));
    },
    delete: () => {
      record('delete');
      return builder;
    },
    lt: (column, value) => {
      record('lt', value, column);
      return Promise.resolve(failure('lt'));
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      record('maybeSingle');
      return Promise.resolve({ data: null, error: null });
    },
  };

  return builder;
}

/** Creates a repository wired to a recording client double. */
function createRepository(failures = {}) {
  const calls = [];

  clientDouble.current = {
    from: (table) => makeBuilder(calls, table, failures),
    functions: {
      invoke: vi.fn(async () => ({ data: null, error: null })),
    },
    removeChannel: vi.fn(),
    realtime: { getChannels: () => [] },
  };

  return { repository: new SupabaseScheduleRepository(), calls };
}

/** A minimal publishable lesson. */
function makeLesson(index = 0) {
  return {
    sheetId: 'СЖ',
    day: 'Понедельник',
    dayOrder: 0,
    time: '08:30-10:05',
    para: String(index + 1),
    group: 'ЛД-11',
    subgroup: '',
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов',
    room: '101',
    isExam: false,
  };
}

function makeLessons(count) {
  return Array.from({ length: count }, (_, i) => makeLesson(i));
}

beforeEach(() => {
  clientDouble.current = null;
});

describe('publish: writes directly to the database', () => {
  it('inserts the new rows before deleting the previous ones', async () => {
    const { repository, calls } = createRepository();

    await repository.publish(makeLessons(3));

    const ops = calls.map((c) => `${c.op}:${c.table}`);
    // Nothing may be deleted before the first insert landed.
    expect(ops).toEqual([
      'insert:lessons',
      'delete:lessons',
      'lt:lessons',
      'upsert:schedule_version',
    ]);
    expect(ops.indexOf('insert:lessons')).toBeLessThan(ops.indexOf('delete:lessons'));
  });

  it('never calls the publish-schedule Edge Function', async () => {
    const { repository } = createRepository();

    await repository.publish(makeLessons(1));

    expect(clientDouble.current.functions.invoke).not.toHaveBeenCalled();
  });

  it('splits the insert into chunks of 400 rows', async () => {
    const { repository, calls } = createRepository();

    await repository.publish(makeLessons(1001));

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(3);
    expect(inserts[0].payload).toHaveLength(400);
    expect(inserts[1].payload).toHaveLength(400);
    expect(inserts[2].payload).toHaveLength(201);
  });

  it('sends one insert request for a schedule that fits into a single chunk', async () => {
    const { repository, calls } = createRepository();

    await repository.publish(makeLessons(400));

    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('rejects an empty lesson list with a readable message', async () => {
    const { repository, calls } = createRepository();

    await expect(repository.publish([])).rejects.toThrow('В файле не найдено ни одного занятия');
    // A refused publish must not touch the database at all.
    expect(calls).toHaveLength(0);
  });

  it('stamps every new row with the same updated_at used by the delete cursor', async () => {
    const { repository, calls } = createRepository();

    await repository.publish(makeLessons(5));

    const rows = calls.find((c) => c.op === 'insert').payload;
    const stamps = new Set(rows.map((r) => r.updated_at));
    expect(stamps.size).toBe(1);
    // Strict `<` on the same timestamp is what keeps new rows alive.
    const cursor = calls.find((c) => c.op === 'lt').payload;
    expect(cursor).toBe(rows[0].updated_at);
  });

  it('gives every row a distinct non-empty id', async () => {
    const { repository, calls } = createRepository();

    await repository.publish(makeLessons(20));

    const rows = calls.find((c) => c.op === 'insert').payload;
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(20);
    for (const row of rows) expect(typeof row.id).toBe('string');
    for (const row of rows) expect(row.id.length).toBeGreaterThan(0);
  });

  it('maps lesson fields onto the lessons table columns', async () => {
    const { repository, calls } = createRepository();

    await repository.publish([makeLesson(0)]);

    const row = calls.find((c) => c.op === 'insert').payload[0];
    expect(row).toMatchObject({
      sheet_id: 'СЖ',
      day: 'Понедельник',
      day_order: 0,
      time: '08:30-10:05',
      group_code: 'ЛД-11',
      subject: 'Анатомия',
      is_exam: false,
    });
    expect(row.created_at).toBe(row.updated_at);
  });

  it('returns the applied version and the number of lessons', async () => {
    const { repository, calls } = createRepository();

    const result = await repository.publish(makeLessons(7));

    expect(result.count).toBe(7);
    expect(result.version).toMatch(/^v\d+$/);
    const upserted = calls.find((c) => c.op === 'upsert').payload;
    expect(upserted.version).toBe(result.version);
  });

  describe('schedule_version row', () => {
    it('upserts a single row pinned to id = 1', async () => {
      const { repository, calls } = createRepository();

      await repository.publish(makeLessons(1));

      const upsert = calls.find((c) => c.op === 'upsert');
      expect(upsert.table).toBe('schedule_version');
      expect(upsert.payload.id).toBe(1);
      expect(upsert.options).toEqual({ onConflict: 'id' });
    });

    it('records the source file name and size when the caller supplies them', async () => {
      const { repository, calls } = createRepository();

      await repository.publish(makeLessons(1), { fileName: 'week-38.xls', fileSize: 123456 });

      const upserted = calls.find((c) => c.op === 'upsert').payload;
      expect(upserted.file_name).toBe('week-38.xls');
      expect(upserted.file_size).toBe(123456);
    });

    it('falls back to a neutral file name and a null size when no metadata is known', async () => {
      const { repository, calls } = createRepository();

      await repository.publish(makeLessons(1));

      const upserted = calls.find((c) => c.op === 'upsert').payload;
      expect(upserted.file_name).toBe('schedule.xls');
      expect(upserted.file_size).toBeNull();
    });
  });

  describe('failure handling', () => {
    it('surfaces an insert failure and never reaches the delete', async () => {
      const { repository, calls } = createRepository({
        insert: { message: 'payload too large' },
      });

      await expect(repository.publish(makeLessons(10))).rejects.toThrow(
        'Не удалось загрузить расписание в базу'
      );
      expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
      expect(calls.some((c) => c.op === 'delete')).toBe(false);
    });

    it('surfaces a delete failure after the rows were inserted', async () => {
      const { repository, calls } = createRepository({ lt: { message: 'permission denied' } });

      await expect(repository.publish(makeLessons(2))).rejects.toThrow(
        'Не удалось удалить предыдущее расписание'
      );
      expect(calls.some((c) => c.op === 'insert')).toBe(true);
      // The version must not advance when the old rows are still there.
      expect(calls.some((c) => c.op === 'upsert')).toBe(false);
    });

    it('surfaces a version write failure', async () => {
      const { repository, calls } = createRepository({ upsert: { message: 'row-level security' } });

      await expect(repository.publish(makeLessons(2))).rejects.toThrow(
        'Не удалось сохранить версию расписания'
      );
      // The lessons are already swapped at this point, so the delete is expected.
      expect(calls.some((c) => c.op === 'delete')).toBe(true);
    });
  });
});

describe('version reads', () => {
  /** Wires a client whose schedule_version select resolves to `rows`. */
  function createVersionReader(rows, error = null) {
    const calls = [];

    /** Builder whose terminal calls resolve to real PostgREST-shaped data. */
    const builderFor = (table) => {
      const isVersion = table === 'schedule_version';
      const builder = {
        select: (...args) => {
          calls.push({ op: 'select', table, payload: args, options: null });
          return builder;
        },
        order: () => builder,
        limit: () => (isVersion ? terminal(rows, error) : builder),
        maybeSingle: () => {
          calls.push({ op: 'maybeSingle', table, payload: null, options: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (onFulfilled, onRejected) =>
          Promise.resolve(isVersion ? { data: null, error: null } : { data: [], error: null }).then(
            onFulfilled,
            onRejected
          ),
      };
      return builder;
    };

    function terminal(data, err) {
      return Promise.resolve({ data, error: err });
    }

    clientDouble.current = {
      from: builderFor,
      functions: { invoke: vi.fn() },
      removeChannel: vi.fn(),
      realtime: { getChannels: () => [] },
    };
    return { repository: new SupabaseScheduleRepository(), calls };
  }

  it('reads the first version row instead of requiring exactly one', async () => {
    const { repository, calls } = createVersionReader([
      { version: 'v1789750297354', updated_at: '2026-09-18T16:51:37Z' },
      { version: 'v-stale-duplicate', updated_at: '2026-09-01T00:00:00Z' },
    ]);

    const result = await repository.getVersion();

    // Two rows would be a PGRST116 under `maybeSingle()`; `limit(1)` succeeds.
    expect(result.version).toBe('v1789750297354');
    expect(calls.some((c) => c.op === 'maybeSingle')).toBe(false);
  });

  it('falls back to a synthetic version when the table is empty', async () => {
    const { repository } = createVersionReader([]);

    const result = await repository.getVersion();

    expect(result.version).toBe('local');
  });

  it('keeps loadFull working when no version row exists', async () => {
    const { repository } = createVersionReader([]);

    const data = await repository.loadFull();

    expect(data.version).toBe('unknown');
    expect(data.sheets.size).toBe(0);
  });
});
