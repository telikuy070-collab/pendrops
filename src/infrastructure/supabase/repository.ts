/**
 * Supabase Schedule Repository - Implements IScheduleRepository
 * Handles all database operations for schedule data
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleData, Lesson, Sheet, Group } from '@core/domain/entities/types';
import type { IScheduleRepository } from '@core/domain/repositories/ports';
import { getSupabaseClient } from './client';

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

  constructor() {
    this.client = getSupabaseClient();
  }

  async loadFull(): Promise<ScheduleData> {
    // Load lessons with all related data
    const { data: lessons, error } = await this.client
      .from('lessons')
      .select('*')
      .order('day_order')
      .order('time');

    if (error) throw error;

    // Load version
    const { data: versionData } = await this.client
      .from('schedule_version')
      .select('version, updated_at')
      .single();

    return this.transformRows(lessons || [], versionData);
  }

  private transformRows(rows: LessonRow[], versionData: VersionRow | null): ScheduleData {
    const sheets = new Map<string, Lesson[]>();
    const sheetsMetaMap = new Map<string, { name: string; lessonCount: number; order: number }>();
    const groupsMap = new Map<string, { code: string; sheetId: string; subgroups: Set<string>; count: number }>();

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
        updatedAt: row.updated_at
      };

      // Group by sheet
      if (!sheets.has(row.sheet_id)) {
        sheets.set(row.sheet_id, []);
        sheetsMetaMap.set(row.sheet_id, { name: row.sheet_id, lessonCount: 0, order: row.day_order });
      }
      sheets.get(row.sheet_id)!.push(lesson);
      sheetsMetaMap.get(row.sheet_id)!.lessonCount++;

      // Track groups
      const groupKey = `${row.sheet_id}:${row.group_code}`;
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { code: row.group_code, sheetId: row.sheet_id, subgroups: new Set(), count: 0 });
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
        subgroups: Array.from(meta.subgroups).sort()
      });
    }

    // Default preferences
    const preferences = {
      currentSheetId: sheetsMeta[0]?.id || '',
      currentGroup: '',
      activeSubgroup: '',
      hiddenSheets: [] as string[]
    };

    this.cachedData = {
      sheets,
      sheetsMeta,
      groups,
      preferences,
      version: versionData?.version || 'unknown',
      updatedAt: versionData?.updated_at || new Date().toISOString()
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
      }
    };
  }

  private setupRealtime(): void {
    this.realtimeChannel = this.client
      .channel('schedule_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lessons' },
        (payload) => {
          // Ignore initial system event from Supabase realtime connection handshake
          // payload.eventType can be 'INSERT' | 'UPDATE' | 'DELETE' | 'SYSTEM'
          if ((payload as any).eventType === 'SYSTEM') return;
          this.handleRealtimeChange();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_version' },
        (payload) => {
          // Ignore initial system event from Supabase realtime connection handshake
          if ((payload as any).eventType === 'SYSTEM') return;
          this.handleRealtimeChange();
        }
      )
      .subscribe();
  }

  private async handleRealtimeChange(): Promise<void> {
    // Debounce: Supabase may fire multiple events for a single change
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
        console.error('[Supabase] Realtime refresh failed:', err);
      }
    }, 100);
  }

  async getVersion(): Promise<{ version: string; updatedAt: string }> {
    const { data, error } = await this.client
      .from('schedule_version')
      .select('version, updated_at')
      .single();

    if (error) throw error;
    return { version: data.version, updatedAt: data.updated_at };
  }

  async publish(lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void> {
    const now = new Date().toISOString();
    const version = `v${Date.now()}`;

    // Start transaction: delete all, insert new, update version
    const { error: deleteError } = await this.client
      .from('lessons')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) throw deleteError;

    // Insert new lessons in batches
    const batchSize = 500;
    for (let i = 0; i < lessons.length; i += batchSize) {
      const batch = lessons.slice(i, i + batchSize).map(l => ({
        sheet_id: l.sheetId,
        day: l.day,
        day_order: l.dayOrder,
        time: l.time,
        para: l.para,
        group_code: l.group,
        subgroup: l.subgroup || null,
        subject: l.subject,
        type: l.type,
        teacher: l.teacher || null,
        room: l.room || null,
        is_exam: l.isExam,
        created_at: now,
        updated_at: now
      }));

      const { error: insertError } = await this.client.from('lessons').insert(batch);
      if (insertError) throw insertError;
    }

    // Update version
    const { error: versionError } = await this.client
      .from('schedule_version')
      .upsert({ id: 1, version, updated_at: now });

    if (versionError) throw versionError;
  }

  async publishFromWorkbook(workbook: { SheetNames: string[]; Sheets: Record<string, any> }): Promise<void> {
    // Reuse existing sheet parser, load xlsx internally
    const { parseWorkbook } = await import('../../sheet');
    const XLSX = await this.loadXLSX();
    const sheets = parseWorkbook(workbook, XLSX);
    
    const lessons: Omit<Lesson, 'id' | 'createdAt' | 'updatedAt'>[] = [];
    const now = new Date().toISOString();
    
    let dayOrder = 0;
    const dayOrderMap = new Map<string, number>();
    const DAY_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

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
          isExam: lesson.isExam
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
      script.onload = () => (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('XLSX not loaded'));
      script.onerror = () => reject(new Error('Failed to load xlsx.full.min.js'));
      document.head.appendChild(script);
    });
  }
}