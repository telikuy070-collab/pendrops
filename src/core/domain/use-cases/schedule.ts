/**
 * Use Cases - Business Logic Operations
 * Pure functions operating on domain entities and repository ports
 */
import type {
  ScheduleData,
  Lesson,
  UserPreferences,
  Sheet,
  Group,
} from '@core/domain/entities/types';
import type { IScheduleRepository, IStorage } from '@core/domain/repositories/ports';

/** Load schedule with fallback chain: cache → DB → empty */
export async function loadScheduleUseCase(
  repository: IScheduleRepository,
  storage: IStorage
): Promise<ScheduleData> {
  // 1. Try cached data first (instant UI)
  const cached = await storage.get<ScheduleData>('schedule_cache');
  if (cached && cached.sheets && cached.sheets.size > 0) {
    return cached;
  }

  // 2. Load from repository (DB)
  const data = await repository.loadFull();

  // 3. Cache for next instant load
  await storage.set('schedule_cache', data);

  return data;
}

/** Subscribe to realtime updates */
export function subscribeScheduleUseCase(
  repository: IScheduleRepository,
  onUpdate: (data: ScheduleData) => void
): () => void {
  return repository.subscribe(onUpdate);
}

/** Check for updates (version comparison) with incremental sync support */
export async function checkUpdatesUseCase(
  repository: IScheduleRepository,
  currentVersion: string
): Promise<{ hasUpdate: boolean; version: string; updatedAt: string; changes?: Lesson[] }> {
  const remote = await repository.getVersion();
  if (remote.version !== currentVersion) {
    const changes = await repository.getChangesSince(currentVersion);
    return {
      hasUpdate: true,
      version: remote.version,
      updatedAt: remote.updatedAt,
      changes: changes.lessons,
    };
  }
  return {
    hasUpdate: false,
    version: remote.version,
    updatedAt: remote.updatedAt,
  };
}

/** Save user preferences */
export async function savePreferencesUseCase(
  storage: IStorage,
  prefs: Partial<UserPreferences>
): Promise<void> {
  const current = (await storage.get<UserPreferences>('user_prefs')) || {
    currentSheetId: '',
    currentGroup: '',
    activeSubgroup: '',
    hiddenSheets: [],
  };
  await storage.set('user_prefs', { ...current, ...prefs });
}

/** Load user preferences */
export async function loadPreferencesUseCase(storage: IStorage): Promise<UserPreferences> {
  return (
    (await storage.get<UserPreferences>('user_prefs')) || {
      currentSheetId: '',
      currentGroup: '',
      activeSubgroup: '',
      hiddenSheets: [],
    }
  );
}

/** Filter lessons by current preferences */
export function filterLessonsUseCase(
  lessons: Lesson[],
  prefs: UserPreferences,
  filters: { day?: string; search?: string }
): Lesson[] {
  let result = lessons;

  if (prefs.currentGroup) {
    result = result.filter((l) => l.group === prefs.currentGroup);
  }
  if (prefs.activeSubgroup) {
    result = result.filter((l) => l.subgroup === prefs.activeSubgroup);
  }
  if (filters.day) {
    result = result.filter((l) => l.day === filters.day);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter((l) =>
      `${l.day} ${l.time} ${l.group} ${l.subject} ${l.teacher} ${l.room}`.toLowerCase().includes(q)
    );
  }
  return result;
}

/** Get unique sheets from lessons */
export function getSheetsUseCase(lessons: Lesson[]): Sheet[] {
  const sheetMap = new Map<string, { name: string; lessonCount: number; order: number }>();

  for (const lesson of lessons) {
    const existing = sheetMap.get(lesson.sheetId);
    if (!existing) {
      sheetMap.set(lesson.sheetId, {
        name: lesson.sheetId,
        lessonCount: 1,
        order: lesson.dayOrder,
      });
    } else {
      existing.lessonCount++;
    }
  }

  return Array.from(sheetMap.entries())
    .map(([id, meta]) => ({ id, ...meta }))
    .sort((a, b) => a.order - b.order);
}

/** Get unique groups for a sheet */
export function getGroupsUseCase(lessons: Lesson[], sheetId: string): Group[] {
  const sheetLessons = lessons.filter((l) => l.sheetId === sheetId);
  const groupMap = new Map<string, { code: string; subgroups: Set<string> }>();

  for (const lesson of sheetLessons) {
    const existing = groupMap.get(lesson.group);
    if (!existing) {
      groupMap.set(lesson.group, {
        code: lesson.group,
        subgroups: new Set([lesson.subgroup].filter(Boolean)),
      });
    } else {
      if (lesson.subgroup) existing.subgroups.add(lesson.subgroup);
    }
  }

  return Array.from(groupMap.entries()).map(([code, meta]) => ({
    code,
    sheetId,
    lessonCount: sheetLessons.filter((l) => l.group === code).length,
    subgroups: Array.from(meta.subgroups).sort(),
  }));
}
