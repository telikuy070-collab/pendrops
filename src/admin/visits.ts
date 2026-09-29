/**
 * Статистика «устройства за период» из таблицы `app_visits`.
 *
 * Здесь честно разведены две вещи, которые легко спутать:
 *
 *  - «Сейчас онлайн» (см. `presence.ts`) считается точно и без базы;
 *  - «устройств за 7/30 дней и всего» — это накопительный счётчик, и без
 *    таблицы в базе его взять неоткуда. Поэтому таблица сделана ОПЦИОНАЛЬНОЙ:
 *    приложение читает её, если она есть, и работает ровно как раньше, если её
 *    нет. Оно никогда не пытается её создать и никогда не падает из-за неё.
 *
 * Таблица содержит только анонимный идентификатор устройства (случайный UUID из
 * localStorage) и даты первого/последнего открытия. Ни имён, ни групп, ни IP.
 * Создаётся файлом `supabase/migrations/20260929210000_app_visits.sql`, который
 * применяет владелец проекта вручную.
 */
import { logger } from '@shared/logger';
import { isUuid } from './deviceId';
import { getSupabaseClient } from '../infrastructure/supabase/client';

/** Postgres / PostgREST codes that mean "the table is not there" or "no access". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST200']);
const DENIED_CODES = new Set(['42501', 'PGRST301', 'PGRST302']);

export const VISITS_TABLE = 'app_visits';

export interface VisitStats {
  /** False when the table is missing or RLS refuses the read. */
  available: boolean;
  devices7d: number | null;
  devices30d: number | null;
  devicesTotal: number | null;
  /** Why the numbers are missing, in words the admin can act on. */
  reason: string | null;
}

export interface VisitStore {
  /** Never rejects: an unusable table comes back as `available: false`. */
  load(): Promise<VisitStats>;
  /**
   * Records one open of the app. Fire-and-forget by contract: returns nothing,
   * never throws and never blocks the caller. The write is deferred so it can
   * not compete with the first render.
   */
  recordVisit(deviceId: string): void;
}

/** Structural slice of the supabase client, so tests can substitute a double. */
interface VisitTable {
  select(
    columns: string,
    options: { count: 'exact'; head: true }
  ): VisitTable & Promise<{ count: number | null; error: PostgrestLikeError | null }>;
  gte(
    column: string,
    value: string
  ): VisitTable &
    Promise<{
      count: number | null;
      error: PostgrestLikeError | null;
    }>;
  upsert(
    rows: Record<string, unknown>,
    options: { onConflict: string }
  ): Promise<{ error: PostgrestLikeError | null }>;
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

export interface VisitStoreOptions {
  client: { from(table: string): VisitTable };
  /** Overridable so a test can observe the write without a timer. */
  defer?: (run: () => void) => void;
  now?: () => Date;
}

/** The one answer for "the table is not usable", with the reason attached. */
export function unavailableVisitStats(reason: string): VisitStats {
  return {
    available: false,
    devices7d: null,
    devices30d: null,
    devicesTotal: null,
    reason,
  };
}

/** A short, actionable explanation for the admin, never a stack trace. */
export function describeVisitError(error: PostgrestLikeError | null | undefined): string {
  if (!error) return 'неизвестная ошибка чтения статистики';
  const code = error.code || '';
  if (MISSING_TABLE_CODES.has(code)) {
    return `таблица ${VISITS_TABLE} не установлена — примените SQL из supabase/migrations`;
  }
  if (DENIED_CODES.has(code)) {
    return `RLS не пускает анонимную роль в ${VISITS_TABLE} — проверьте политики`;
  }
  return `ошибка чтения ${VISITS_TABLE}${code ? ` (${code})` : ''}`;
}

/** A transport hiccup is worth another launch; a missing table is not. */
function isPermanent(error: PostgrestLikeError | null | undefined): boolean {
  const code = error?.code || '';
  return MISSING_TABLE_CODES.has(code) || DENIED_CODES.has(code);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createVisitStore(options: VisitStoreOptions): VisitStore {
  const {
    client,
    defer = (run) => {
      setTimeout(run, 0);
    },
    now = () => new Date(),
  } = options;

  /**
   * A missing table is the expected state until the owner applies the SQL, so
   * after the first such answer this session stops writing — one useless request
   * per launch is enough.
   */
  let writesDisabled = false;

  async function countDevices(gte?: string): Promise<number> {
    let query = client.from(VISITS_TABLE).select('device_id', { count: 'exact', head: true });
    if (gte) query = query.gte('last_seen_at', gte);
    const { count, error } = await query;
    if (error) throw error;
    // A missing count is not a zero: refuse to invent one.
    if (typeof count !== 'number') throw { code: 'COUNT_MISSING' } satisfies PostgrestLikeError;
    return count;
  }

  async function write(deviceId: string): Promise<void> {
    try {
      const { error } = await client
        .from(VISITS_TABLE)
        .upsert(
          { device_id: deviceId, last_seen_at: now().toISOString() },
          { onConflict: 'device_id' }
        );
      if (error) {
        if (isPermanent(error)) {
          writesDisabled = true;
          // Expected state, not an incident: no console noise.
          return;
        }
        logger.debug('[Visits] write skipped', { code: error.code });
      }
    } catch (err) {
      // A failed visit must never surface as an app error.
      logger.debug('[Visits] write failed', { error: err as Error });
    }
  }

  return {
    async load(): Promise<VisitStats> {
      try {
        // The total first: when it fails, one request is enough to learn that
        // the table is unusable, and the other two are not worth making.
        const devicesTotal = await countDevices();
        const at = now();
        const [devices7d, devices30d] = await Promise.all([
          countDevices(new Date(at.getTime() - 7 * DAY_MS).toISOString()),
          countDevices(new Date(at.getTime() - 30 * DAY_MS).toISOString()),
        ]);
        return { available: true, devices7d, devices30d, devicesTotal, reason: null };
      } catch (err) {
        const error = err as PostgrestLikeError;
        if (!isPermanent(error)) {
          logger.debug('[Visits] read failed', { code: error?.code });
        }
        return unavailableVisitStats(describeVisitError(error));
      }
    },

    recordVisit(deviceId: string): void {
      // Anything but a UUID cannot be stored and would only produce a rejected
      // insert, which looks like a broken app in the network tab.
      if (writesDisabled || !isUuid(deviceId)) return;
      defer(() => {
        void write(deviceId);
      });
    },
  };
}

/**
 * The production wiring: the same singleton client the schedule repository uses.
 *
 * The cast is confined to this one function — supabase-js types `from()` with the
 * full PostgREST builder chain, and pinning that type here would make every test
 * of this store construct a real query builder.
 */
export function createSupabaseVisitStore(): VisitStore {
  return createVisitStore({
    client: getSupabaseClient() as unknown as VisitStoreOptions['client'],
  });
}
