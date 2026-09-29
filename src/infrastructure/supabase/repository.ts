/**
 * Supabase Schedule Repository - Implements IScheduleRepository
 * Handles all database operations for schedule data
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleData, Lesson, Sheet, Group } from '@core/domain/entities/types';
import type {
  IScheduleRepository,
  PublishFileMeta,
  PublishOptions,
  PublishResult,
} from '@core/domain/repositories/ports';
import { getSupabaseClient } from './client';
import { toAppError, PublishAbortedError, ValidationError } from '@core/domain/errors';
import { withRetry } from '@shared/retry';
import { logger } from '@shared/logger';
import { CircuitBreaker } from '@shared/circuitBreaker';

// Database row types (match your Supabase schema)
interface LessonRow {
  id: string;
  sheet_id: string;
  day: string;
  day_order: number;
  time: string;
  para: string;
  group_code: string;
  subgroup: string | null;
  subject: string;
  type: string;
  teacher: string | null;
  room: string | null;
  is_exam: boolean;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  version: string;
  updated_at: string;
}

/** Rows inserted per request. ~1300 lessons => 4 requests. */
const PUBLISH_CHUNK_SIZE = 400;

/**
 * Stable uuid v4 for a lesson row.
 * `crypto.randomUUID` needs a secure context, so insecure origins and old
 * browsers fall back to a random hex id — the column only requires a uuid.
 */
function newRowId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class SupabaseScheduleRepository implements IScheduleRepository {
  private client: SupabaseClient;
  private realtimeChannel: ReturnType<SupabaseClient['channel']> | null = null;
  private subscribers: Set<(data: ScheduleData) => void> = new Set();
  private cachedData: ScheduleData | null = null;
  private realtimeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;
  private realtimeBreaker = new CircuitBreaker(5, 60000);

  constructor() {
    this.client = getSupabaseClient();
  }

  async loadFull(): Promise<ScheduleData> {
    return withRetry(
      async () => {
        // Load lessons with all related data
        const { data: lessons, error } = await this.client
          .from('lessons')
          .select('*')
          .order('day_order')
          .order('time');

        if (error) throw toAppError(error);

        // Load version. `limit(1)` + first row instead of `maybeSingle()`:
        // the result no longer depends on the table holding exactly one row,
        // so a duplicate can never turn into a PGRST116 failure.
        const { data: versionRows, error: versionError } = await this.client
          .from('schedule_version')
          .select('version, updated_at')
          .limit(1);

        if (versionError) {
          logger.warn('[Supabase] Version read failed', {
            context: 'load_full',
            code: versionError.code,
            message: versionError.message,
          });
        }

        const versionData = (versionRows?.[0] as VersionRow | undefined) ?? null;

        return this.transformRows(lessons || [], versionData);
      },
      {
        retries: 3,
        baseDelay: 1000,
        retryable: (e) => e.message.includes('network') || e.message.includes('timeout'),
      }
    );
  }

  private transformRows(rows: LessonRow[], versionData: VersionRow | null): ScheduleData {
    const sheets = new Map<string, Lesson[]>();
    const sheetsMetaMap = new Map<string, { name: string; lessonCount: number; order: number }>();
    const groupsMap = new Map<
      string,
      { code: string; sheetId: string; subgroups: Set<string>; count: number }
    >();

    for (const row of rows) {
      const lesson: Lesson = {
        id: row.id,
        sheetId: row.sheet_id,
        day: row.day as Lesson['day'],
        dayOrder: row.day_order,
        time: row.time,
        para: row.para,
        group: row.group_code,
        subgroup: row.subgroup || '',
        subject: row.subject,
        type: row.type as Lesson['type'],
        teacher: row.teacher || '',
        room: row.room || '',
        isExam: row.is_exam,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      // Group by sheet
      if (!sheets.has(row.sheet_id)) {
        sheets.set(row.sheet_id, []);
        sheetsMetaMap.set(row.sheet_id, {
          name: row.sheet_id,
          lessonCount: 0,
          order: row.day_order,
        });
      }
      sheets.get(row.sheet_id)!.push(lesson);
      sheetsMetaMap.get(row.sheet_id)!.lessonCount++;

      // Track groups
      const groupKey = `${row.sheet_id}:${row.group_code}`;
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          code: row.group_code,
          sheetId: row.sheet_id,
          subgroups: new Set(),
          count: 0,
        });
      }
      groupsMap.get(groupKey)!.count++;
      if (row.subgroup) groupsMap.get(groupKey)!.subgroups.add(row.subgroup);
    }

    // Build sheets meta
    const sheetsMeta: Sheet[] = Array.from(sheetsMetaMap.entries())
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => a.order - b.order);

    // Build groups
    const groups: Map<string, Group> = new Map();
    for (const [, meta] of groupsMap) {
      groups.set(meta.code, {
        code: meta.code,
        sheetId: meta.sheetId,
        lessonCount: meta.count,
        subgroups: Array.from(meta.subgroups).sort(),
      });
    }

    // Default preferences
    const preferences = {
      currentSheetId: sheetsMeta[0]?.id || '',
      currentGroup: '',
      activeSubgroup: '',
      hiddenSheets: [] as string[],
    };

    this.cachedData = {
      sheets,
      sheetsMeta,
      groups,
      preferences,
      version: versionData?.version || 'unknown',
      updatedAt: versionData?.updated_at || new Date().toISOString(),
    };

    return this.cachedData;
  }

  subscribe(callback: (data: ScheduleData) => void): () => void {
    this.subscribers.add(callback);

    // Send current cached data immediately if available
    if (this.cachedData) {
      callback(this.cachedData);
    }

    // Set up realtime subscription (only once)
    if (!this.realtimeChannel) {
      this.setupRealtime();
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0 && this.realtimeChannel) {
        this.client.removeChannel(this.realtimeChannel);
        this.realtimeChannel = null;

        // Clean up reconnection timer when no more subscribers
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.reconnectAttempt = 0;
      }
    };
  }

  private setupRealtime(): void {
    this.realtimeBreaker
      .execute(() => this.doSetupRealtime())
      .catch((err) => {
        logger.error(
          '[Supabase] Failed to setup realtime',
          { context: 'realtime_setup' },
          toAppError(err)
        );
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      });
  }

  private async doSetupRealtime(): Promise<void> {
    if (this.isDestroyed) return;

    // Anon-only app: no token to sync, but ensure realtime connection is ready
    this.client.realtime.getChannels();

    const attemptSubscription = async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const channel = this.client
          .channel('pendrops:realtime:v1')
          // Realtime on lessons — full reload since filters depend on group/sheet
          .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, (payload) => {
            if ((payload as any).eventType === 'SYSTEM') return;
            this.handleRealtimeChange();
          })
          // Realtime on schedule_version — single source of truth trigger
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'schedule_version' },
            (payload) => {
              if ((payload as any).eventType === 'SYSTEM') return;
              this.handleRealtimeChange();
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              logger.info('[Realtime] Subscribed to schedule_changes');
              this.reconnectAttempt = 0;
              resolve();
            } else if (
              status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT' ||
              status === 'CLOSED'
            ) {
              logger.warn('[Realtime] Subscription status', { status });
              reject(new Error(`Realtime subscription failed: ${status}`));
            }
          });

        // Store channel reference so we can remove it
        this.realtimeChannel = channel;
      });
    };

    await withRetry(attemptSubscription, {
      retries: 5,
      baseDelay: 2000,
      retryable: (e) => e.message.includes('Realtime subscription failed'),
    });
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;

    logger.info('[Realtime] Reconnecting', { delay, attempt: this.reconnectAttempt });

    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.setupRealtime();
      }
    }, delay);
  }

  private handleRealtimeChange(): void {
    // existing debounce logic
    if (this.realtimeDebounceTimer) {
      clearTimeout(this.realtimeDebounceTimer);
    }
    this.realtimeDebounceTimer = setTimeout(async () => {
      try {
        const fresh = await this.loadFull();
        for (const cb of this.subscribers) {
          cb(fresh);
        }
      } catch (err) {
        logger.error(
          '[Supabase] Realtime refresh failed',
          { context: 'realtime_refresh' },
          toAppError(err)
        );
      }
    }, 100);
  }

  /**
   * Clean up all resources - call when repository is no longer needed
   */
  destroy(): void {
    this.isDestroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.realtimeDebounceTimer) {
      clearTimeout(this.realtimeDebounceTimer);
      this.realtimeDebounceTimer = null;
    }

    if (this.realtimeChannel) {
      this.client.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }

    this.subscribers.clear();
    this.cachedData = null;
    this.reconnectAttempt = 0;
  }

  async getVersion(): Promise<{ version: string; updatedAt: string }> {
    return withRetry(
      async () => {
        // First row instead of `maybeSingle()`: the version row is written with an
        // explicit id=1, and reading it must never fail on a row count mismatch.
        const { data, error } = await this.client
          .from('schedule_version')
          .select('version, updated_at')
          .limit(1);

        if (error && error.code !== 'PGRST116') throw toAppError(error);
        if (error) {
          logger.warn('[Supabase] Version read failed', {
            context: 'get_version',
            code: error.code,
            message: error.message,
          });
        }

        const row = (data?.[0] as VersionRow | undefined) ?? null;
        if (!row) {
          // Fallback: return a synthetic version so the app doesn't crash
          return { version: 'local', updatedAt: new Date().toISOString() };
        }
        return { version: row.version, updatedAt: row.updated_at };
      },
      {
        retries: 3,
        baseDelay: 1000,
        retryable: (e) => e.message.includes('network') || e.message.includes('timeout'),
      }
    );
  }

  async getChangesSince(version: string): Promise<{ lessons: Lesson[]; version: string }> {
    return withRetry(
      async () => {
        // Get the updated_at timestamp for the given version to use as cursor
        const { data: versionData, error: versionError } = await this.client
          .from('schedule_version')
          .select('updated_at')
          .eq('version', version)
          .maybeSingle();

        if (versionError && versionError.code !== 'PGRST116') throw versionError;

        const cursor = versionData?.updated_at || new Date(0).toISOString();

        // Fetch lessons updated after the cursor
        const { data: lessons, error } = await this.client
          .from('lessons')
          .select('*')
          .gt('updated_at', cursor)
          .order('updated_at');

        if (error) throw toAppError(error);

        // Get current version
        const { data: currentVersionData } = await this.client
          .from('schedule_version')
          .select('version')
          .maybeSingle();

        // Transform rows to Lesson entities
        const transformedLessons: Lesson[] = (lessons || []).map((row: LessonRow) => ({
          id: row.id,
          sheetId: row.sheet_id,
          day: row.day as Lesson['day'],
          dayOrder: row.day_order,
          time: row.time,
          para: row.para,
          group: row.group_code,
          subgroup: row.subgroup || '',
          subject: row.subject,
          type: row.type as Lesson['type'],
          teacher: row.teacher || '',
          room: row.room || '',
          isExam: row.is_exam,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        return {
          lessons: transformedLessons,
          version: currentVersionData?.version || version,
        };
      },
      {
        retries: 3,
        baseDelay: 1000,
        retryable: (e) => e.message.includes('network') || e.message.includes('timeout'),
      }
    );
  }

  /**
   * Replace the whole schedule with `lessons`, writing straight to PostgREST.
   *
   * Order matters: every new row is inserted **before** the previous rows are
   * deleted, so the table is never empty and a failure halfway through leaves
   * the old schedule intact instead of an empty app.
   *
   * All new rows share one `updated_at` stamp, and the delete uses a strict
   * `<`, so freshly inserted rows can never delete themselves.
   *
   * `options` only observes and interrupts: the sequence above is unchanged when
   * it is absent. An abort is honoured between chunk requests, never inside one,
   * and it deliberately skips the delete and the version write — see
   * `PublishAbortedError` for what the database is left holding.
   */
  async publish(
    lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[],
    meta: PublishFileMeta = {},
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    return withRetry(
      async () => {
        if (!Array.isArray(lessons) || lessons.length === 0) {
          throw new ValidationError('В файле не найдено ни одного занятия');
        }

        const now = new Date().toISOString();
        const version = `v${Date.now()}`;

        const rows = lessons.map((l) => ({
          id: newRowId(),
          sheet_id: l.sheetId,
          day: l.day,
          day_order: l.dayOrder,
          time: l.time,
          para: l.para,
          group_code: l.group,
          subgroup: l.subgroup || '',
          subject: l.subject,
          type: l.type,
          teacher: l.teacher || '',
          room: l.room || '',
          is_exam: l.isExam,
          created_at: now,
          updated_at: now,
        }));

        // 1. Insert first — the schedule stays populated the whole time.
        const total = rows.length;
        const chunks = Math.ceil(total / PUBLISH_CHUNK_SIZE);
        let uploaded = 0;
        options.onProgress?.({ uploaded, total, chunk: 0, chunks, done: false });

        for (let offset = 0; offset < total; offset += PUBLISH_CHUNK_SIZE) {
          if (options.shouldAbort?.()) throw new PublishAbortedError(uploaded, total);

          const chunk = rows.slice(offset, offset + PUBLISH_CHUNK_SIZE);
          const { error } = await this.client.from('lessons').insert(chunk);
          if (error) {
            throw new ValidationError(
              `Не удалось загрузить расписание в базу (часть ${Math.floor(offset / PUBLISH_CHUNK_SIZE) + 1}): ${error.message}`
            );
          }

          uploaded += chunk.length;
          options.onProgress?.({
            uploaded,
            total,
            chunk: Math.floor(offset / PUBLISH_CHUNK_SIZE) + 1,
            chunks,
            done: uploaded >= total,
          });
        }

        // 2. Only now drop the previous rows. Strict `<` keeps the new ones.
        const { error: deleteError } = await this.client
          .from('lessons')
          .delete()
          .lt('updated_at', now);
        if (deleteError) {
          throw new ValidationError(
            `Не удалось удалить предыдущее расписание: ${deleteError.message}`
          );
        }

        // 3. Single version row, always id=1. An explicit conflict target keeps
        //    the table at exactly one row, so readers can never hit PGRST116.
        const { error: versionError } = await this.client.from('schedule_version').upsert(
          {
            id: 1,
            version,
            updated_at: now,
            file_name: meta.fileName ?? 'schedule.xls',
            file_size: meta.fileSize ?? null,
          },
          { onConflict: 'id' }
        );
        if (versionError) {
          throw new ValidationError(
            `Не удалось сохранить версию расписания: ${versionError.message}`
          );
        }

        logger.info('[Supabase] Schedule published', { version, count: rows.length });

        return { version, count: rows.length };
      },
      {
        retries: 3,
        baseDelay: 1000,
        retryable: (e) => e.message.includes('network') || e.message.includes('timeout'),
      }
    );
  }

  async publishFromWorkbook(
    workbook: {
      SheetNames: string[];
      Sheets: Record<string, any>;
    },
    _xlsx?: any,
    meta: PublishFileMeta = {}
  ): Promise<PublishResult> {
    // Reuse existing sheet parser, load xlsx internally
    const { parseWorkbook } = await import('../../sheet');
    const XLSX = await this.loadXLSX();
    const sheets = parseWorkbook(workbook, XLSX);

    const lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[] = [];
    const now = new Date().toISOString();

    const dayOrder = 0;
    const dayOrderMap = new Map<string, number>();
    const DAY_ORDER = [
      'Понедельник',
      'Вторник',
      'Среда',
      'Четверг',
      'Пятница',
      'Суббота',
      'Воскресенье',
    ];

    for (const [sheetName, sheetLessons] of Object.entries(sheets)) {
      for (const lesson of sheetLessons) {
        if (!dayOrderMap.has(lesson.day)) {
          dayOrderMap.set(lesson.day, DAY_ORDER.indexOf(lesson.day));
        }

        lessons.push({
          sheetId: sheetName,
          day: lesson.day as Lesson['day'],
          dayOrder: dayOrderMap.get(lesson.day) || 0,
          time: lesson.time,
          para: lesson.para,
          group: lesson.group,
          subgroup: lesson.subgroup,
          subject: lesson.subject,
          type: lesson.type as Lesson['type'],
          teacher: lesson.teacher,
          room: lesson.room,
          isExam: lesson.isExam,
        });
      }
    }

    return this.publish(lessons, meta);
  }

  private async loadXLSX(): Promise<any> {
    if ((window as any).XLSX) return (window as any).XLSX;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'xlsx.full.min.js';
      script.async = true;
      script.onload = () =>
        (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('XLSX not loaded'));
      script.onerror = () => reject(new Error('Failed to load xlsx.full.min.js'));
      document.head.appendChild(script);
    });
  }
}
