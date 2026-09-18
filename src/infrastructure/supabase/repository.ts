/**
 * Supabase Schedule Repository - Implements IScheduleRepository
 * Handles all database operations for schedule data
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleData, Lesson, Sheet, Group } from '@core/domain/entities/types';
import type { IScheduleRepository } from '@core/domain/repositories/ports';
import { getSupabaseClient } from './client';
import { toAppError } from '@core/domain/errors';
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
    return withRetry(async () => {
      // Load lessons with all related data
      const { data: lessons, error } = await this.client
        .from('lessons')
        .select('*')
        .order('day_order')
        .order('time');

      if (error) throw toAppError(error);

      // Load version
      const { data: versionData } = await this.client
        .from('schedule_version')
        .select('version, updated_at')
        .single();

      return this.transformRows(lessons || [], versionData);
    }, { retries: 3, baseDelay: 1000, retryable: (e) => e.message.includes('network') || e.message.includes('timeout') });
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
    this.realtimeBreaker.execute(() => this.doSetupRealtime())
      .catch((err) => {
        logger.error('[Supabase] Failed to setup realtime', { context: 'realtime_setup' }, toAppError(err));
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      });
  }

  private async doSetupRealtime(): Promise<void> {
    if (this.isDestroyed) return;

    // Use retry utility for initial subscription attempt
    const attemptSubscription = async (): Promise<void> => {
      return new Promise((resolve, reject) => {
        this.realtimeChannel = this.client
          .channel('schedule_changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, (payload) => {
            if ((payload as any).eventType === 'SYSTEM') return;
            this.handleRealtimeChange();
          })
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
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              logger.warn('[Realtime] Subscription status', { status });
              reject(new Error(`Realtime subscription failed: ${status}`));
            }
          });
      });
    };

    await withRetry(attemptSubscription, { retries: 3, baseDelay: 1000, retryable: (e) => e.message.includes('network') || e.message.includes('timeout') || e.message.includes('Realtime subscription failed') });
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
        logger.error('[Supabase] Realtime refresh failed', { context: 'realtime_refresh' }, toAppError(err));
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
    return withRetry(async () => {
      const { data, error } = await this.client
        .from('schedule_version')
        .select('version, updated_at')
        .single();

      if (error) throw toAppError(error);
      return { version: data.version, updatedAt: data.updated_at };
    }, { retries: 3, baseDelay: 1000, retryable: (e) => e.message.includes('network') || e.message.includes('timeout') });
  }

  async getChangesSince(version: string): Promise<{ lessons: Lesson[]; version: string }> {
    return withRetry(async () => {
      // Get the updated_at timestamp for the given version to use as cursor
      const { data: versionData, error: versionError } = await this.client
        .from('schedule_version')
        .select('updated_at')
        .eq('version', version)
        .single();

      if (versionError) throw versionError;

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
        .single();

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
    }, { retries: 3, baseDelay: 1000, retryable: (e) => e.message.includes('network') || e.message.includes('timeout') });
  }

  async publish(lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void> {
    return withRetry(async () => {
      const version = `v${Date.now()}`;

      // Call Edge Function for secure server-side publishing with service_role
      const { data, error } = await this.client.functions.invoke('publish-schedule', {
        body: {
          lessons: lessons.map(l => ({
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
          })),
          version,
        },
      });

      if (error) throw new Error(error.message || 'Failed to publish schedule');
      if (data?.error) throw new Error(data.error);
    }, { retries: 3, baseDelay: 1000, retryable: (e) => e.message.includes('network') || e.message.includes('timeout') });
  }

  async publishFromWorkbook(workbook: {
    SheetNames: string[];
    Sheets: Record<string, any>;
  }): Promise<void> {
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

    await this.publish(lessons);
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
