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
import { buildDigest, diffDigests } from '@core/domain/scheduleDiff';
import type { ScheduleChanges, ScheduleDigest } from '@core/domain/scheduleDiff';

/**
 * Key of the previously loaded version inside the existing offline storage.
 *
 * Reusing the same IStorage port and the same browser store keeps one cache
 * mechanism instead of a second one next to it.
 */
export const SCHEDULE_DIGEST_KEY = 'schedule_cache_previous';

/** Load schedule with fallback chain: cache → DB → empty */
export async function loadScheduleUseCase(
  repository: IScheduleRepository,
  storage: IStorage
): Promise<ScheduleData> {
  // 1. Try cached data first (instant UI)
  const cached = await loadCachedScheduleUseCase(storage);
  if (cached) {
    return cached;
  }

  // 2. Load from repository (DB)
  const { data } = await refreshScheduleUseCase(repository, storage);
  return data;
}

/**
 * Cached schedule for an instant, non-blocking first render.
 * Returns null when there is no usable cache — the caller then shows a loading
 * state instead of pretending the cache is authoritative.
 */
export async function loadCachedScheduleUseCase(storage: IStorage): Promise<ScheduleData | null> {
  const cached = await storage.get<ScheduleData>('schedule_cache');
  if (cached && cached.sheets && cached.sheets.size > 0) {
    return cached;
  }
  return null;
}

/** Result of an authoritative reload. */
export interface FreshSchedule {
  data: ScheduleData;
  /** False when the offline copy could not be refreshed (retryable warning). */
  cacheUpdated: boolean;
}

/**
 * Authoritative reload: fetch from the repository, then best-effort refresh the
 * offline cache.
 *
 * The apply/cache order is deliberate: the caller applies `data` immediately
 * and never blocks on the cache write, and a failed write never deletes or
 * invalidates the previously cached schedule.
 */
export async function refreshScheduleUseCase(
  repository: IScheduleRepository,
  storage: IStorage
): Promise<FreshSchedule> {
  const data = await repository.loadFull();
  const cacheUpdated = await storage.set('schedule_cache', data);
  return { data, cacheUpdated };
}

/** Subscribe to realtime updates */
export function subscribeScheduleUseCase(
  repository: IScheduleRepository,
  onUpdate: (data: ScheduleData) => void
): () => void {
  return repository.subscribe(onUpdate);
}

/**
 * Digest of the version that was on screen before this one, or null when the
 * app has never stored a baseline. Malformed stored data is treated as "no
 * baseline": a broken cache must not break the schedule.
 */
export async function loadScheduleDigestUseCase(storage: IStorage): Promise<ScheduleDigest | null> {
  const stored = await storage.get<ScheduleDigest>(SCHEDULE_DIGEST_KEY);
  if (!stored || !Array.isArray(stored.items) || typeof stored.version !== 'string') {
    return null;
  }
  return stored;
}

/**
 * Compares an applied version with the stored baseline and makes the applied
 * version the new baseline.
 *
 * Returns null when there is nothing to show (first run, same version, or no
 * actual difference) so the UI never renders an empty "Изменения" section.
 * The baseline is written even when the comparison yields nothing, and a
 * failed write only costs the next comparison — never the schedule.
 */
export async function recordScheduleChangesUseCase(
  storage: IStorage,
  data: ScheduleData
): Promise<ScheduleChanges | null> {
  const next = buildDigest(data);
  const previous = await loadScheduleDigestUseCase(storage);
  if (previous && previous.version === next.version) return null;
  const changes = diffDigests(previous, next);
  await storage.set(SCHEDULE_DIGEST_KEY, next);
  return changes;
}

/**
 * Check for updates by comparing versions only.
 *
 * The check deliberately does NOT call `getChangesSince`: on a version
 * mismatch its cursor falls back to the epoch, so it downloads the entire
 * lessons table, the result was always discarded by every caller, and any of
 * its errors blocked an otherwise valid update. A version comparison is a
 * single-row SELECT and the caller reloads authoritatively on a match.
 */
export async function checkUpdatesUseCase(
  repository: IScheduleRepository,
  currentVersion: string
): Promise<{ hasUpdate: boolean; version: string; updatedAt: string }> {
  const remote = await repository.getVersion();
  return {
    hasUpdate: remote.version !== currentVersion,
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
